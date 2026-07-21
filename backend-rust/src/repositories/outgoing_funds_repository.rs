use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow)]
pub struct OutgoingFundRecord {
    pub id: String,
    pub voucher_number: String,
    pub business_date: NaiveDate,
    pub payment_account_code: String,
    pub payment_mode: String,
    pub fund_source: String,
    pub cash_drawer_session_id: Option<String>,
    pub cash_drawer_till_id: Option<String>,
    pub opening_balance_paise: Option<i64>,
    pub closing_balance_paise: Option<i64>,
    pub reference_number: Option<String>,
    pub cheque_number: Option<String>,
    pub cheque_date: Option<NaiveDate>,
    pub linked_party_type: String,
    pub linked_party_id: Option<String>,
    pub linked_party_name: Option<String>,
    pub bill_reference: Option<String>,
    pub attachment_url: Option<String>,
    pub remarks: Option<String>,
    pub status: String,
    pub journal_entry_id: Option<String>,
    pub reversal_journal_entry_id: Option<String>,
    pub approval_policy_reason: Option<String>,
    pub version: i64,
    pub created_by_user_id: String,
    pub submitted_by_user_id: Option<String>,
    pub approved_by_user_id: Option<String>,
    pub rejected_by_user_id: Option<String>,
    pub reversed_by_user_id: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub approved_at: Option<DateTime<Utc>>,
    pub rejected_at: Option<DateTime<Utc>>,
    pub reversed_at: Option<DateTime<Utc>>,
    pub rejection_reason: Option<String>,
    pub reversal_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub lines_json: Value,
    pub attachments_json: Value,
    pub audit_json: Value,
}

#[derive(Debug, Clone, FromRow)]
pub struct OutgoingFundCategoryRecord {
    pub category_key: String,
    pub label: String,
    pub account_code: Option<String>,
    pub manual_entry: bool,
    pub workflow_path: Option<String>,
    pub workflow_label: Option<String>,
    pub requires_party: bool,
    pub requires_bill_reference: bool,
    pub requires_attachment: bool,
    pub approval_threshold_paise: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NewOutgoingFundLine {
    pub category_key: String,
    pub account_code: String,
    pub amount_paise: i64,
    pub gst_treatment: String,
    pub gst_paise: i64,
    pub subcategory: Option<String>,
    pub cost_center_id: Option<String>,
    pub department: Option<String>,
    pub linked_party_type: String,
    pub linked_party_id: Option<String>,
    pub linked_party_name: Option<String>,
    pub source_reference_type: Option<String>,
    pub source_reference_id: Option<String>,
    pub receipt_number: Option<String>,
    pub tax_invoice: bool,
    pub reimbursement: bool,
    pub remarks: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewOutgoingFundAttachment {
    pub line_number: Option<i32>,
    pub file_url: String,
    pub file_type: Option<String>,
}

pub struct NewOutgoingFundVoucher<'a> {
    pub business_date: NaiveDate,
    pub payment_account_code: &'a str,
    pub payment_mode: &'a str,
    pub fund_source: &'a str,
    pub cash_drawer_till_id: Option<&'a str>,
    pub reference_number: Option<&'a str>,
    pub cheque_number: Option<&'a str>,
    pub cheque_date: Option<NaiveDate>,
    pub linked_party_type: &'a str,
    pub linked_party_id: Option<&'a str>,
    pub linked_party_name: Option<&'a str>,
    pub bill_reference: Option<&'a str>,
    pub attachment_url: Option<&'a str>,
    pub remarks: Option<&'a str>,
    pub status: &'a str,
    pub idempotency_key: &'a str,
}

pub struct UpdateOutgoingFundVoucher<'a> {
    pub business_date: NaiveDate,
    pub payment_account_code: &'a str,
    pub payment_mode: &'a str,
    pub fund_source: &'a str,
    pub cash_drawer_till_id: Option<&'a str>,
    pub reference_number: Option<&'a str>,
    pub cheque_number: Option<&'a str>,
    pub cheque_date: Option<NaiveDate>,
    pub linked_party_type: &'a str,
    pub linked_party_id: Option<&'a str>,
    pub linked_party_name: Option<&'a str>,
    pub bill_reference: Option<&'a str>,
    pub attachment_url: Option<&'a str>,
    pub remarks: Option<&'a str>,
    pub expected_version: i64,
}

const RECORD_SELECT: &str = r#"
  SELECT v.id,v.voucher_number,v.business_date,v.payment_account_code,v.payment_mode,
         v.fund_source,v.cash_drawer_session_id,v.cash_drawer_till_id,
         v.opening_balance_paise,v.closing_balance_paise,
         v.reference_number,v.cheque_number,v.cheque_date,v.linked_party_type,
         v.linked_party_id,v.linked_party_name,v.bill_reference,v.attachment_url,v.remarks,
         v.status,v.journal_entry_id,v.reversal_journal_entry_id,v.approval_policy_reason,v.version,
         v.created_by_user_id,v.submitted_by_user_id,v.approved_by_user_id,
         v.rejected_by_user_id,v.reversed_by_user_id,v.submitted_at,v.approved_at,
         v.rejected_at,v.reversed_at,v.rejection_reason,v.reversal_reason,
         v.created_at,v.updated_at,
         COALESCE((
           SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
             'id',line.id,'lineNumber',line.line_number,'categoryKey',line.category_key,
             'accountCode',line.account_code,'amountPaise',line.amount_paise,
             'gstTreatment',line.gst_treatment,'gstPaise',line.gst_paise,
             'subcategory',line.subcategory,'costCenterId',line.cost_center_id,
             'department',line.department,'linkedPartyType',line.line_party_type,
             'linkedPartyId',line.line_party_id,'linkedPartyName',line.line_party_name,
             'sourceReferenceType',line.source_reference_type,
             'sourceReferenceId',line.source_reference_id,'receiptNumber',line.receipt_number,
             'taxInvoice',line.tax_invoice,'reimbursement',line.reimbursement,
             'remarks',line.remarks
           ) ORDER BY line.line_number)
           FROM outgoing_fund_lines line
           WHERE line.tenant_id=v.tenant_id AND line.branch_id=v.branch_id AND line.voucher_id=v.id
         ), '[]'::JSONB) AS lines_json,
         COALESCE((
           SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
             'id',attachment.id,'lineNumber',attachment.line_number,
             'fileUrl',attachment.file_url,'fileType',attachment.file_type,
             'uploadedByUserId',attachment.uploaded_by_user_id,'createdAt',attachment.created_at
           ) ORDER BY attachment.created_at DESC)
           FROM outgoing_fund_attachments attachment
           WHERE attachment.tenant_id=v.tenant_id AND attachment.branch_id=v.branch_id AND attachment.voucher_id=v.id
         ), '[]'::JSONB) AS attachments_json,
         COALESCE((
           SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
             'id',event.id,'eventType',event.event_type,'actorUserId',event.actor_user_id,
             'details',event.details_json,'createdAt',event.created_at
           ) ORDER BY event.created_at DESC)
           FROM outgoing_fund_audit_events event
           WHERE event.tenant_id=v.tenant_id AND event.branch_id=v.branch_id AND event.voucher_id=v.id
         ), '[]'::JSONB) AS audit_json
  FROM outgoing_fund_vouchers v
"#;

pub async fn list_categories(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<OutgoingFundCategoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT category_key,label,account_code,manual_entry,workflow_path,workflow_label,
                  requires_party,requires_bill_reference,requires_attachment,approval_threshold_paise
           FROM outgoing_fund_categories
           WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
           ORDER BY label"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_date: Option<NaiveDate>,
    to_date: Option<NaiveDate>,
    status: &str,
    query: &str,
    category: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<OutgoingFundRecord>, sqlx::Error> {
    let sql = format!(
        "{RECORD_SELECT} WHERE v.tenant_id=$1 AND v.branch_id=$2
         AND ($3::DATE IS NULL OR v.business_date >= $3)
         AND ($4::DATE IS NULL OR v.business_date <= $4)
         AND ($5='' OR v.status=$5)
         AND ($6='' OR CONCAT_WS(' ',v.voucher_number,v.reference_number,v.linked_party_name,v.bill_reference,v.remarks) ILIKE '%' || $6 || '%')
         AND ($7='' OR EXISTS(SELECT 1 FROM outgoing_fund_lines filter_line WHERE filter_line.tenant_id=v.tenant_id AND filter_line.branch_id=v.branch_id AND filter_line.voucher_id=v.id AND filter_line.category_key=$7))
         ORDER BY v.business_date DESC,v.created_at DESC LIMIT $8 OFFSET $9"
    );
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(from_date)
        .bind(to_date)
        .bind(status)
        .bind(query)
        .bind(category)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn count(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_date: Option<NaiveDate>,
    to_date: Option<NaiveDate>,
    status: &str,
    query: &str,
    category: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT COUNT(*)::BIGINT FROM outgoing_fund_vouchers v
           WHERE v.tenant_id=$1 AND v.branch_id=$2
             AND ($3::DATE IS NULL OR v.business_date >= $3)
             AND ($4::DATE IS NULL OR v.business_date <= $4)
             AND ($5='' OR v.status=$5)
             AND ($6='' OR CONCAT_WS(' ',v.voucher_number,v.reference_number,v.linked_party_name,v.bill_reference,v.remarks) ILIKE '%' || $6 || '%')
             AND ($7='' OR EXISTS(SELECT 1 FROM outgoing_fund_lines filter_line WHERE filter_line.tenant_id=v.tenant_id AND filter_line.branch_id=v.branch_id AND filter_line.voucher_id=v.id AND filter_line.category_key=$7))"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from_date)
    .bind(to_date)
    .bind(status)
    .bind(query)
    .bind(category)
    .fetch_one(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_date: Option<NaiveDate>,
    to_date: Option<NaiveDate>,
    status: &str,
    query: &str,
    category: &str,
) -> Result<(i64, i64, i64, i64), sqlx::Error> {
    sqlx::query_as(
        r#"WITH filtered AS (
             SELECT v.* FROM outgoing_fund_vouchers v
             WHERE v.tenant_id=$1 AND v.branch_id=$2
               AND ($3::DATE IS NULL OR v.business_date >= $3)
               AND ($4::DATE IS NULL OR v.business_date <= $4)
               AND ($5='' OR v.status=$5)
               AND ($6='' OR CONCAT_WS(' ',v.voucher_number,v.reference_number,v.linked_party_name,v.bill_reference,v.remarks) ILIKE '%' || $6 || '%')
               AND ($7='' OR EXISTS(SELECT 1 FROM outgoing_fund_lines filter_line WHERE filter_line.tenant_id=v.tenant_id AND filter_line.branch_id=v.branch_id AND filter_line.voucher_id=v.id AND filter_line.category_key=$7))
           )
           SELECT COUNT(*)::BIGINT,
                  COALESCE(SUM((SELECT SUM(line.amount_paise) FROM outgoing_fund_lines line WHERE line.tenant_id=filtered.tenant_id AND line.branch_id=filtered.branch_id AND line.voucher_id=filtered.id)) FILTER (WHERE status='approved'),0)::BIGINT,
                  COUNT(*) FILTER (WHERE status='pending')::BIGINT,
                  COALESCE(SUM((SELECT SUM(line.gst_paise) FROM outgoing_fund_lines line WHERE line.tenant_id=filtered.tenant_id AND line.branch_id=filtered.branch_id AND line.voucher_id=filtered.id)) FILTER (WHERE status='approved'),0)::BIGINT
           FROM filtered"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from_date)
    .bind(to_date)
    .bind(status)
    .bind(query)
    .bind(category)
    .fetch_one(db)
    .await
}

pub async fn find(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<OutgoingFundRecord>, sqlx::Error> {
    let sql = format!("{RECORD_SELECT} WHERE v.tenant_id=$1 AND v.branch_id=$2 AND v.id=$3");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn find_by_idempotency(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<OutgoingFundRecord>, sqlx::Error> {
    let sql =
        format!("{RECORD_SELECT} WHERE v.tenant_id=$1 AND v.branch_id=$2 AND v.idempotency_key=$3");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(key)
        .fetch_optional(db)
        .await
}

pub async fn lock(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<OutgoingFundRecord>, sqlx::Error> {
    let sql = format!(
        "{RECORD_SELECT} WHERE v.tenant_id=$1 AND v.branch_id=$2 AND v.id=$3 FOR UPDATE OF v"
    );
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn accounting_journal_id(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type=$3 AND source_id=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(source_type)
    .bind(source_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn create(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: NewOutgoingFundVoucher<'_>,
    lines: &[NewOutgoingFundLine],
    attachments: &[NewOutgoingFundAttachment],
) -> Result<String, sqlx::Error> {
    let id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO outgoing_fund_vouchers(
             tenant_id,branch_id,voucher_number,business_date,payment_account_code,payment_mode,
             fund_source,cash_drawer_till_id,
             reference_number,cheque_number,cheque_date,linked_party_type,linked_party_id,
             linked_party_name,bill_reference,attachment_url,remarks,status,idempotency_key,
             created_by_user_id,submitted_by_user_id,submitted_at
           ) VALUES(
             $1,$2,'OF-'||TO_CHAR($4,'YYYYMMDD')||'-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 8)),
             $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$3,
             CASE WHEN $18='pending' THEN $3 ELSE NULL END,
             CASE WHEN $18='pending' THEN NOW() ELSE NULL END
           ) RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_user_id)
    .bind(input.business_date)
    .bind(input.payment_account_code)
    .bind(input.payment_mode)
    .bind(input.fund_source)
    .bind(input.cash_drawer_till_id)
    .bind(input.reference_number)
    .bind(input.cheque_number)
    .bind(input.cheque_date)
    .bind(input.linked_party_type)
    .bind(input.linked_party_id)
    .bind(input.linked_party_name)
    .bind(input.bill_reference)
    .bind(input.attachment_url)
    .bind(input.remarks)
    .bind(input.status)
    .bind(input.idempotency_key)
    .fetch_one(&mut **tx)
    .await?;
    insert_lines(tx, tenant_id, branch_id, &id, lines).await?;
    insert_attachments(tx, tenant_id, branch_id, &id, actor_user_id, attachments).await?;
    audit(
        tx,
        tenant_id,
        branch_id,
        &id,
        "created",
        actor_user_id,
        serde_json::json!({"status":input.status}),
    )
    .await?;
    Ok(id)
}

pub async fn update_draft(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    input: UpdateOutgoingFundVoucher<'_>,
    lines: &[NewOutgoingFundLine],
    attachments: &[NewOutgoingFundAttachment],
) -> Result<bool, sqlx::Error> {
    let updated = sqlx::query(
        r#"UPDATE outgoing_fund_vouchers SET
             business_date=$5,payment_account_code=$6,payment_mode=$7,fund_source=$8,
             cash_drawer_till_id=$9,reference_number=$10,
             cheque_number=$11,cheque_date=$12,linked_party_type=$13,linked_party_id=$14,
             linked_party_name=$15,bill_reference=$16,attachment_url=$17,remarks=$18,
             status='draft',rejected_by_user_id=NULL,rejected_at=NULL,rejection_reason=NULL,
             version=version+1,updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status IN ('draft','rejected')"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(input.expected_version)
    .bind(input.business_date)
    .bind(input.payment_account_code)
    .bind(input.payment_mode)
    .bind(input.fund_source)
    .bind(input.cash_drawer_till_id)
    .bind(input.reference_number)
    .bind(input.cheque_number)
    .bind(input.cheque_date)
    .bind(input.linked_party_type)
    .bind(input.linked_party_id)
    .bind(input.linked_party_name)
    .bind(input.bill_reference)
    .bind(input.attachment_url)
    .bind(input.remarks)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        == 1;
    if !updated {
        return Ok(false);
    }
    sqlx::query(
        "DELETE FROM outgoing_fund_lines WHERE tenant_id=$1 AND branch_id=$2 AND voucher_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "DELETE FROM outgoing_fund_attachments WHERE tenant_id=$1 AND branch_id=$2 AND voucher_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .execute(&mut **tx)
    .await?;
    insert_lines(tx, tenant_id, branch_id, id, lines).await?;
    insert_attachments(tx, tenant_id, branch_id, id, actor_user_id, attachments).await?;
    audit(
        tx,
        tenant_id,
        branch_id,
        id,
        "updated",
        actor_user_id,
        serde_json::json!({"version":input.expected_version + 1}),
    )
    .await?;
    Ok(true)
}

async fn insert_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    voucher_id: &str,
    lines: &[NewOutgoingFundLine],
) -> Result<(), sqlx::Error> {
    for (index, line) in lines.iter().enumerate() {
        sqlx::query(
            "INSERT INTO outgoing_fund_lines(tenant_id,branch_id,voucher_id,line_number,category_key,account_code,amount_paise,gst_treatment,gst_paise,subcategory,cost_center_id,department,line_party_type,line_party_id,line_party_name,source_reference_type,source_reference_id,receipt_number,tax_invoice,reimbursement,remarks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(voucher_id)
        .bind(index as i32 + 1)
        .bind(&line.category_key)
        .bind(&line.account_code)
        .bind(line.amount_paise)
        .bind(&line.gst_treatment)
        .bind(line.gst_paise)
        .bind(line.subcategory.as_deref())
        .bind(line.cost_center_id.as_deref())
        .bind(line.department.as_deref())
        .bind(&line.linked_party_type)
        .bind(line.linked_party_id.as_deref())
        .bind(line.linked_party_name.as_deref())
        .bind(line.source_reference_type.as_deref())
        .bind(line.source_reference_id.as_deref())
        .bind(line.receipt_number.as_deref())
        .bind(line.tax_invoice)
        .bind(line.reimbursement)
        .bind(line.remarks.as_deref())
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn insert_attachments(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    voucher_id: &str,
    actor_user_id: &str,
    attachments: &[NewOutgoingFundAttachment],
) -> Result<(), sqlx::Error> {
    for attachment in attachments {
        sqlx::query("INSERT INTO outgoing_fund_attachments(tenant_id,branch_id,voucher_id,line_number,file_url,file_type,uploaded_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(voucher_id)
            .bind(attachment.line_number)
            .bind(&attachment.file_url)
            .bind(attachment.file_type.as_deref())
            .bind(actor_user_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

pub async fn mark_submitted(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query("UPDATE outgoing_fund_vouchers SET status='pending',submitted_by_user_id=$4,submitted_at=NOW(),updated_at=NOW(),version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('draft','rejected')")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).execute(&mut **tx).await?.rows_affected()==1;
    if changed {
        audit(
            tx,
            tenant_id,
            branch_id,
            id,
            "submitted",
            actor,
            serde_json::json!({}),
        )
        .await?;
    }
    Ok(changed)
}

pub async fn mark_approved(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    journal_entry_id: &str,
    cash_drawer_session_id: Option<&str>,
    cash_drawer_till_id: Option<&str>,
    opening_balance_paise: Option<i64>,
    closing_balance_paise: Option<i64>,
    approval_policy_reason: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query("UPDATE outgoing_fund_vouchers SET status='approved',journal_entry_id=$5,cash_drawer_session_id=$6,cash_drawer_till_id=COALESCE($7,cash_drawer_till_id),opening_balance_paise=$8,closing_balance_paise=$9,approval_policy_reason=$10,approved_by_user_id=$4,approved_at=NOW(),updated_at=NOW(),version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(journal_entry_id)
        .bind(cash_drawer_session_id).bind(cash_drawer_till_id).bind(opening_balance_paise)
        .bind(closing_balance_paise).bind(approval_policy_reason)
        .execute(&mut **tx).await?.rows_affected()==1;
    if changed {
        audit(
            tx,
            tenant_id,
            branch_id,
            id,
            "approved",
            actor,
            serde_json::json!({"journalEntryId":journal_entry_id}),
        )
        .await?;
    }
    Ok(changed)
}

pub async fn mark_rejected(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query("UPDATE outgoing_fund_vouchers SET status='rejected',rejected_by_user_id=$4,rejected_at=NOW(),rejection_reason=$5,updated_at=NOW(),version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(reason).execute(&mut **tx).await?.rows_affected()==1;
    if changed {
        audit(
            tx,
            tenant_id,
            branch_id,
            id,
            "rejected",
            actor,
            serde_json::json!({"reason":reason}),
        )
        .await?;
    }
    Ok(changed)
}

pub async fn mark_reversed(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    reason: &str,
    journal_entry_id: &str,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query("UPDATE outgoing_fund_vouchers SET status='reversed',reversal_journal_entry_id=$6,reversed_by_user_id=$4,reversed_at=NOW(),reversal_reason=$5,updated_at=NOW(),version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='approved'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).bind(reason).bind(journal_entry_id).execute(&mut **tx).await?.rows_affected()==1;
    if changed {
        audit(
            tx,
            tenant_id,
            branch_id,
            id,
            "reversed",
            actor,
            serde_json::json!({"reason":reason,"journalEntryId":journal_entry_id}),
        )
        .await?;
    }
    Ok(changed)
}

pub async fn mark_cancelled(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let changed = sqlx::query("UPDATE outgoing_fund_vouchers SET status='cancelled',updated_at=NOW(),version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('draft','rejected')")
        .bind(tenant_id).bind(branch_id).bind(id).execute(&mut **tx).await?.rows_affected()==1;
    if changed {
        audit(
            tx,
            tenant_id,
            branch_id,
            id,
            "cancelled",
            actor,
            serde_json::json!({}),
        )
        .await?;
    }
    Ok(changed)
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    voucher_id: &str,
    event_type: &str,
    actor: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO outgoing_fund_audit_events(tenant_id,branch_id,voucher_id,event_type,actor_user_id,details_json) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(voucher_id).bind(event_type).bind(actor).bind(details).execute(&mut **tx).await?;
    Ok(())
}
