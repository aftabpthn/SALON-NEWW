use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct ComplianceJob {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub sale_id: String,
    pub document_type: String,
    pub attempt_count: i32,
}

pub async fn recover_expired(db: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE pos_invoice_compliance c SET e_invoice_status=CASE WHEN j.document_type='e_invoice' THEN 'failed' ELSE c.e_invoice_status END, e_way_bill_status=CASE WHEN j.document_type='e_way_bill' THEN 'failed' ELSE c.e_way_bill_status END, updated_at=NOW() FROM pos_compliance_jobs j WHERE j.tenant_id=c.tenant_id AND j.branch_id=c.branch_id AND j.sale_id=c.sale_id AND j.status='processing' AND j.attempt_count>=5 AND j.next_attempt_at<=NOW()",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE pos_compliance_jobs SET status=CASE WHEN attempt_count>=5 THEN 'failed' ELSE 'queued' END, last_error='worker lease expired', updated_at=NOW() WHERE status='processing' AND next_attempt_at<=NOW()",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub async fn claim_due(db: &PgPool) -> Result<Option<ComplianceJob>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH candidate AS (
          SELECT id FROM pos_compliance_jobs
          WHERE status='queued' AND attempt_count < 5 AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE pos_compliance_jobs job
        SET status='processing', attempt_count=job.attempt_count+1,
            next_attempt_at=NOW()+INTERVAL '5 minutes', updated_at=NOW()
        FROM candidate
        WHERE job.id=candidate.id
        RETURNING job.id, job.tenant_id, job.branch_id, job.sale_id,
                  job.document_type, job.attempt_count
        "#,
    )
    .fetch_optional(db)
    .await
}

pub async fn invoice_payload(
    db: &PgPool,
    job: &ComplianceJob,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
          'invoiceId', sale.id,
          'invoiceNumber', sale.invoice_number,
          'invoiceType', sale.invoice_type,
          'businessDate', sale.business_date,
          'sellerGstin', sale.seller_gstin,
          'sellerStateCode', sale.seller_state_code,
          'buyerGstin', sale.buyer_gstin,
          'placeOfSupplyStateCode', sale.place_of_supply_state_code,
          'taxMode', sale.tax_mode,
          'reverseCharge', sale.reverse_charge,
          'subtotalPaise', sale.subtotal_paise,
          'discountPaise', sale.discount_paise,
          'taxPaise', sale.tax_paise,
          'cgstPaise', sale.cgst_paise,
          'sgstPaise', sale.sgst_paise,
          'igstPaise', sale.igst_paise,
          'totalPaise', sale.total_paise,
          'lines', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'lineType', line.line_type,
              'itemId', line.item_id,
              'itemName', line.item_name,
              'quantity', line.quantity,
              'unitPricePaise', line.unit_price_paise,
              'grossPaise', line.gross_paise,
              'discountPaise', line.discount_paise,
              'taxablePaise', line.taxable_paise,
              'gstPercent', line.tax_percent,
              'gstPaise', line.gst_paise,
              'cgstPaise', line.cgst_paise,
              'sgstPaise', line.sgst_paise,
              'igstPaise', line.igst_paise,
              'hsnSacCode', line.hsn_sac_code,
              'lineTotalPaise', line.line_total_paise
            ) ORDER BY line.created_at, line.id)
            FROM pos_sale_lines line
            WHERE line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
          ), '[]'::jsonb)
        )
        FROM pos_sales sale
        WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$3 AND sale.finalized_at IS NOT NULL
        "#,
    )
    .bind(&job.tenant_id)
    .bind(&job.branch_id)
    .bind(&job.sale_id)
    .fetch_optional(db)
    .await
}

pub async fn save_payload(db: &PgPool, job_id: &str, payload: &Value) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE pos_compliance_jobs SET payload_json=$2, updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(job_id)
        .bind(payload)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn mark_submitted(
    db: &PgPool,
    job: &ComplianceJob,
    provider_reference: &str,
    result: &Value,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let updated = sqlx::query("UPDATE pos_compliance_jobs SET status='submitted', provider_reference=$2, result_json=$3, last_error='', submitted_at=NOW(), updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(&job.id).bind(provider_reference).bind(result).execute(&mut *tx).await?;
    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(());
    }
    sqlx::query("UPDATE pos_invoice_compliance SET e_invoice_status=CASE WHEN $4='e_invoice' THEN 'submitted' ELSE e_invoice_status END, e_way_bill_status=CASE WHEN $4='e_way_bill' THEN 'submitted' ELSE e_way_bill_status END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.sale_id).bind(&job.document_type).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO pos_invoice_events (tenant_id, branch_id, sale_id, event_type, actor_user_id, payload_json) VALUES ($1,$2,$3,$4,'compliance-worker',$5)")
        .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.sale_id)
        .bind(format!("compliance.{}_submitted", job.document_type))
        .bind(serde_json::json!({"jobId":job.id,"providerReference":provider_reference,"attemptCount":job.attempt_count}))
        .execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn mark_failed(db: &PgPool, job: &ComplianceJob, error: &str) -> Result<(), sqlx::Error> {
    let final_failure = job.attempt_count >= 5;
    let status = if final_failure { "failed" } else { "queued" };
    let error = error.chars().take(500).collect::<String>();
    let mut tx = db.begin().await?;
    let updated = sqlx::query("UPDATE pos_compliance_jobs SET status=$2, last_error=$3, next_attempt_at=NOW()+INTERVAL '5 minutes', updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(&job.id).bind(status).bind(error).execute(&mut *tx).await?;
    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(());
    }
    if final_failure {
        sqlx::query("UPDATE pos_invoice_compliance SET e_invoice_status=CASE WHEN $4='e_invoice' THEN 'failed' ELSE e_invoice_status END, e_way_bill_status=CASE WHEN $4='e_way_bill' THEN 'failed' ELSE e_way_bill_status END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3")
            .bind(&job.tenant_id).bind(&job.branch_id).bind(&job.sale_id).bind(&job.document_type).execute(&mut *tx).await?;
    }
    tx.commit().await
}
