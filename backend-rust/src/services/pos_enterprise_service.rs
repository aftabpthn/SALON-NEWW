use chrono::{NaiveDate, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        cash_drawer_repository,
        pos_enterprise_repository::{self, RiskCase, ZReport},
    },
};

pub async fn add_corporate_member(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    account_id: &str,
    client_id: &str,
    employee_code: &str,
    department: &str,
    spending_limit_paise: i64,
) -> Result<pos_enterprise_repository::CorporateMember, AppError> {
    if spending_limit_paise < 0 {
        return Err(AppError::validation(
            "spendingLimitPaise cannot be negative",
        ));
    }
    sqlx::query_as("INSERT INTO corporate_account_members (tenant_id,branch_id,corporate_account_id,client_id,employee_code,department,spending_limit_paise,created_by_user_id) SELECT $1,$2,a.id,c.id,$5,$6,$7,$8 FROM corporate_billing_accounts a JOIN clients c ON c.tenant_id=a.tenant_id AND c.branch_id=a.branch_id AND c.id=$4 WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.id=$3 AND a.status='active' ON CONFLICT (tenant_id,branch_id,corporate_account_id,client_id) DO UPDATE SET employee_code=EXCLUDED.employee_code,department=EXCLUDED.department,spending_limit_paise=EXCLUDED.spending_limit_paise,status='active',updated_at=NOW() RETURNING id,corporate_account_id,client_id,(SELECT TRIM(CONCAT_WS(' ',cx.first_name,cx.last_name)) FROM clients cx WHERE cx.tenant_id=$1 AND cx.branch_id=$2 AND cx.id=corporate_account_members.client_id) client_name,(SELECT cx.phone FROM clients cx WHERE cx.tenant_id=$1 AND cx.branch_id=$2 AND cx.id=corporate_account_members.client_id) client_phone,employee_code,department,spending_limit_paise,status,created_at")
        .bind(tenant).bind(branch).bind(account_id).bind(client_id)
        .bind(employee_code).bind(department).bind(spending_limit_paise).bind(actor)
        .fetch_optional(db).await
        .map_err(|error| if error.as_database_error().and_then(|value| value.constraint()).is_some() { AppError::conflict("corporate member already exists") } else { AppError::internal("failed to save corporate member") })?
        .ok_or_else(|| AppError::not_found("corporate account or client was not found"))
}

pub async fn convert_invoice_to_corporate_credit(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    sale_id: &str,
    account_id: &str,
    reference: &str,
) -> Result<Value, AppError> {
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start corporate credit conversion"))?;
    let account: Option<(String, i64, i32)> = sqlx::query_as("SELECT account_name,credit_limit_paise,payment_terms_days FROM corporate_billing_accounts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active' FOR UPDATE")
        .bind(tenant).bind(branch).bind(account_id).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to lock corporate account"))?;
    let (account_name, credit_limit, terms) =
        account.ok_or_else(|| AppError::not_found("active corporate account was not found"))?;
    let sale: Option<(String, String, i64, i64, String)> = sqlx::query_as("SELECT invoice_number,client_id,total_paise,paid_paise,status FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant).bind(branch).bind(sale_id).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to lock invoice"))?;
    let (invoice_number, client_id, total, paid, status) =
        sale.ok_or_else(|| AppError::not_found("invoice was not found"))?;
    if matches!(
        status.as_str(),
        "draft" | "cancelled" | "voided" | "refunded"
    ) || total <= paid
    {
        return Err(AppError::conflict(
            "only a finalized invoice with balance due can be converted",
        ));
    }
    let amount = total - paid;
    let member_counts: (i64, i64, i64) = sqlx::query_as("SELECT COUNT(*)::BIGINT,COUNT(*) FILTER (WHERE client_id=$4 AND status='active')::BIGINT,COALESCE(MAX(spending_limit_paise) FILTER (WHERE client_id=$4 AND status='active'),0)::BIGINT FROM corporate_account_members WHERE tenant_id=$1 AND branch_id=$2 AND corporate_account_id=$3")
        .bind(tenant).bind(branch).bind(account_id).bind(&client_id).fetch_one(&mut *tx).await
        .map_err(|_| AppError::internal("failed to validate corporate member"))?;
    if member_counts.0 > 0 && member_counts.1 == 0 {
        return Err(AppError::conflict(
            "invoice client is not an active member of this corporate account",
        ));
    }
    if member_counts.2 > 0 && amount > member_counts.2 {
        return Err(AppError::conflict(
            "invoice exceeds the member spending limit",
        ));
    }
    let outstanding: i64 = sqlx::query_scalar("SELECT (COALESCE((SELECT SUM(outstanding_paise) FROM corporate_credit_invoices WHERE tenant_id=$1 AND branch_id=$2 AND corporate_account_id=$3 AND status IN ('open','partially_paid')),0)+COALESCE((SELECT SUM(s.total_paise-s.paid_paise) FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.corporate_account_id=$3 AND s.status NOT IN ('voided','cancelled','refunded') AND NOT EXISTS (SELECT 1 FROM corporate_credit_invoices ci WHERE ci.tenant_id=s.tenant_id AND ci.branch_id=s.branch_id AND ci.sale_id=s.id)),0))::BIGINT")
        .bind(tenant).bind(branch).bind(account_id).fetch_one(&mut *tx).await
        .map_err(|_| AppError::internal("failed to calculate corporate outstanding"))?;
    if outstanding.saturating_add(amount) > credit_limit {
        return Err(AppError::conflict(
            "corporate credit limit would be exceeded",
        ));
    }
    let row: (String, NaiveDate) = sqlx::query_as("INSERT INTO corporate_credit_invoices (tenant_id,branch_id,corporate_account_id,sale_id,due_date,original_amount_paise,outstanding_paise,converted_by_user_id) VALUES ($1,$2,$3,$4,CURRENT_DATE + $5,$6,$6,$7) ON CONFLICT (tenant_id,branch_id,sale_id) DO NOTHING RETURNING id,due_date")
        .bind(tenant).bind(branch).bind(account_id).bind(sale_id).bind(terms).bind(amount).bind(actor)
        .fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to create corporate credit invoice"))?
        .ok_or_else(|| AppError::conflict("invoice is already in the corporate credit ledger"))?;
    sqlx::query("UPDATE pos_sales SET corporate_account_id=$4,corporate_reference=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND NOT EXISTS (SELECT 1 FROM pos_day_locks lock WHERE lock.tenant_id=pos_sales.tenant_id AND lock.branch_id=pos_sales.branch_id AND lock.business_date=pos_sales.business_date AND lock.status='locked')")
        .bind(tenant).bind(branch).bind(sale_id).bind(account_id).bind(reference).execute(&mut *tx).await
        .map_err(|_| AppError::internal("failed to link corporate invoice"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit corporate credit invoice"))?;
    Ok(
        json!({"creditInvoiceId":row.0,"saleId":sale_id,"invoiceNumber":invoice_number,"accountId":account_id,"accountName":account_name,"amountPaise":amount,"dueDate":row.1,"outstandingPaise":outstanding + amount}),
    )
}

pub async fn record_corporate_payment(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    account_id: &str,
    amount_paise: i64,
    method: &str,
    reference: &str,
    idempotency_key: &str,
) -> Result<Value, AppError> {
    if amount_paise <= 0 || reference.is_empty() || idempotency_key.is_empty() {
        return Err(AppError::validation(
            "positive amountPaise, reference and idempotencyKey are required",
        ));
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start corporate payment"))?;
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM corporate_credit_payments WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant).bind(branch).bind(idempotency_key).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to check corporate payment"))?;
    if let Some(id) = existing {
        tx.rollback().await.ok();
        return Ok(json!({"paymentId":id,"idempotentReplay":true}));
    }
    let invoices: Vec<(String, String, i64)> = sqlx::query_as("SELECT id,sale_id,outstanding_paise FROM corporate_credit_invoices WHERE tenant_id=$1 AND branch_id=$2 AND corporate_account_id=$3 AND status IN ('open','partially_paid') ORDER BY due_date,created_at FOR UPDATE")
        .bind(tenant).bind(branch).bind(account_id).fetch_all(&mut *tx).await
        .map_err(|_| AppError::internal("failed to lock corporate invoices"))?;
    let balances = invoices.iter().map(|row| row.2).collect::<Vec<_>>();
    let allocations = fifo_allocations(amount_paise, &balances)?;
    let payment_id: String = sqlx::query_scalar("INSERT INTO corporate_credit_payments (tenant_id,branch_id,corporate_account_id,amount_paise,payment_method,payment_reference,idempotency_key,received_by_user_id) SELECT $1,$2,id,$4,$5,$6,$7,$8 FROM corporate_billing_accounts WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active' RETURNING id")
        .bind(tenant).bind(branch).bind(account_id).bind(amount_paise).bind(method).bind(reference).bind(idempotency_key).bind(actor)
        .fetch_optional(&mut *tx).await.map_err(|error| if error.as_database_error().is_some() { AppError::conflict("corporate payment reference already exists") } else { AppError::internal("failed to save corporate payment") })?
        .ok_or_else(|| AppError::not_found("active corporate account was not found"))?;
    let mut response_allocations = Vec::new();
    for ((invoice_id, sale_id, _), allocated) in
        invoices.iter().zip(allocations).filter(|row| row.1 > 0)
    {
        sqlx::query("INSERT INTO corporate_credit_payment_allocations (tenant_id,branch_id,payment_id,credit_invoice_id,sale_id,amount_paise) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(tenant).bind(branch).bind(&payment_id).bind(invoice_id).bind(sale_id).bind(allocated).execute(&mut *tx).await
            .map_err(|_| AppError::internal("failed to allocate corporate payment"))?;
        sqlx::query("UPDATE corporate_credit_invoices SET paid_paise=paid_paise+$4,outstanding_paise=outstanding_paise-$4,status=CASE WHEN outstanding_paise-$4=0 THEN 'paid' ELSE 'partially_paid' END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant).bind(branch).bind(invoice_id).bind(allocated).execute(&mut *tx).await
            .map_err(|_| AppError::internal("failed to update corporate invoice"))?;
        response_allocations
            .push(json!({"creditInvoiceId":invoice_id,"saleId":sale_id,"amountPaise":allocated}));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit corporate payment"))?;
    Ok(
        json!({"paymentId":payment_id,"amountPaise":amount_paise,"allocations":response_allocations,"idempotentReplay":false}),
    )
}

fn fifo_allocations(amount: i64, balances: &[i64]) -> Result<Vec<i64>, AppError> {
    let total = balances
        .iter()
        .try_fold(0_i64, |sum, value| sum.checked_add(*value))
        .ok_or_else(|| AppError::validation("corporate outstanding is too large"))?;
    if amount <= 0 || amount > total {
        return Err(AppError::validation(
            "payment exceeds corporate outstanding",
        ));
    }
    let mut remaining = amount;
    Ok(balances
        .iter()
        .map(|balance| {
            let value = remaining.min(*balance);
            remaining -= value;
            value
        })
        .collect())
}

pub async fn generate_z_report(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    date: NaiveDate,
) -> Result<ZReport, AppError> {
    let day_lock = pos_enterprise_repository::get_day_lock(db, tenant, branch, date)
        .await
        .map_err(|_| AppError::internal("failed to read day lock"))?
        .filter(|row| row.status == "locked")
        .ok_or_else(|| {
            AppError::conflict("business day must be locked before Z-report generation")
        })?;

    let open_drawers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status IN ('open','pending_approval')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to validate cash drawers"))?;
    if open_drawers > 0 {
        return Err(AppError::conflict(
            "all cash drawers must be closed and approved before Z-report generation",
        ));
    }

    let reconciliation = eod_reconciliation(db, tenant, branch, date).await?;
    if !reconciliation
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(AppError::conflict(
            "invoice, payment, register, and accounting totals must reconcile before Z-report generation",
        ));
    }

    let sales: (i64, i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT,COALESCE(SUM(subtotal_paise),0)::BIGINT,COALESCE(SUM(discount_paise),0)::BIGINT,COALESCE(SUM(tax_paise),0)::BIGINT,COALESCE(SUM(cgst_paise),0)::BIGINT,COALESCE(SUM(sgst_paise),0)::BIGINT,COALESCE(SUM(igst_paise),0)::BIGINT,COALESCE(SUM(total_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status NOT IN ('voided','cancelled')",
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to aggregate Z-report sales"))?;
    let payments: Vec<(String, i64)> = sqlx::query_as(
        "SELECT p.method,COALESCE(SUM(p.amount_paise),0)::BIGINT FROM pos_payments p JOIN pos_sales s ON s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id WHERE p.tenant_id=$1 AND p.branch_id=$2 AND s.business_date=$3 AND s.status NOT IN ('voided','cancelled') GROUP BY p.method ORDER BY p.method",
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to aggregate Z-report payments"))?;
    let cash: (i64, i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(opening_cash_paise),0)::BIGINT,COALESCE(SUM(counted_cash_paise),0)::BIGINT,COALESCE(SUM(variance_paise),0)::BIGINT FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='closed'",
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to aggregate Z-report cash"))?;
    let tax_register: Vec<(String, i32, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT COALESCE(NULLIF(hsn_sac_code,''),'UNCLASSIFIED'),tax_percent,COALESCE(SUM(line_total_paise-cgst_paise-sgst_paise-igst_paise),0)::BIGINT,COALESCE(SUM(cgst_paise),0)::BIGINT,COALESCE(SUM(sgst_paise),0)::BIGINT,COALESCE(SUM(igst_paise),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id AND s.tenant_id=l.tenant_id AND s.branch_id=l.branch_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.business_date=$3 AND s.status NOT IN ('voided','cancelled') GROUP BY COALESCE(NULLIF(hsn_sac_code,''),'UNCLASSIFIED'),tax_percent ORDER BY 1,2",
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to build tax register"))?;

    let report = json!({
        "schemaVersion": 1,
        "businessDate": date,
        "dayLockId": day_lock.id,
        "sales": {"invoiceCount": sales.0,"subtotalPaise":sales.1,"discountPaise":sales.2,"taxPaise":sales.3,"cgstPaise":sales.4,"sgstPaise":sales.5,"igstPaise":sales.6,"totalPaise":sales.7},
        "payments": payments.into_iter().map(|(method,amount)| json!({"method":method,"amountPaise":amount})).collect::<Vec<_>>(),
        "cash": {"openingPaise":cash.0,"countedPaise":cash.1,"variancePaise":cash.2},
        "reconciliation": reconciliation,
        "taxRegister": tax_register.into_iter().map(|(code,rate,taxable,cgst,sgst,igst)| json!({"hsnSacCode":code,"taxPercent":rate,"taxablePaise":taxable,"cgstPaise":cgst,"sgstPaise":sgst,"igstPaise":igst})).collect::<Vec<_>>()
    });
    let digest = format!("{:x}", Sha256::digest(report.to_string().as_bytes()));
    pos_enterprise_repository::insert_z_report(db, tenant, branch, actor, date, report, &digest)
        .await
        .map_err(|_| AppError::internal("failed to store immutable Z-report"))
}

pub async fn eod_reconciliation(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
) -> Result<Value, AppError> {
    let invoices: (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT,COALESCE(SUM(total_paise),0)::BIGINT,COALESCE(SUM(paid_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status NOT IN ('draft','voided','cancelled')",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to reconcile EOD invoices"))?;
    let payment_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(payment.amount_paise),0)::BIGINT FROM pos_payments payment JOIN pos_sales sale ON sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id AND sale.id=payment.sale_id WHERE payment.tenant_id=$1 AND payment.branch_id=$2 AND sale.business_date=$3 AND sale.status NOT IN ('draft','voided','cancelled')",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to reconcile EOD payments"))?;
    let invoice_journal_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(line.debit_paise),0)::BIGINT FROM accounting_journal_entries entry JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id AND line.account_code='ACCOUNTS_RECEIVABLE' JOIN pos_sales sale ON sale.tenant_id=entry.tenant_id AND sale.branch_id=entry.branch_id AND sale.id=entry.source_id WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.source_type='invoice' AND sale.business_date=$3 AND sale.status NOT IN ('draft','voided','cancelled')",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to reconcile EOD invoice journals"))?;
    let payment_journal_total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(line.debit_paise),0)::BIGINT FROM accounting_journal_entries entry JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id AND line.account_code<>'ACCOUNTS_RECEIVABLE' JOIN pos_payments payment ON payment.tenant_id=entry.tenant_id AND payment.branch_id=entry.branch_id AND payment.id=entry.source_id JOIN pos_sales sale ON sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id AND sale.id=payment.sale_id WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.source_type='payment' AND sale.business_date=$3 AND sale.status NOT IN ('draft','voided','cancelled')",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to reconcile EOD payment journals"))?;
    let missing_invoice_journals: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date=$3 AND sale.total_paise<>0 AND sale.status NOT IN ('draft','voided','cancelled') AND NOT EXISTS(SELECT 1 FROM accounting_journal_entries entry WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id AND entry.source_type='invoice' AND entry.source_id=sale.id)",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to verify EOD invoice journal coverage"))?;
    let missing_payment_journals: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM pos_payments payment JOIN pos_sales sale ON sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id AND sale.id=payment.sale_id WHERE payment.tenant_id=$1 AND payment.branch_id=$2 AND sale.business_date=$3 AND payment.amount_paise<>0 AND sale.status NOT IN ('draft','voided','cancelled') AND NOT EXISTS(SELECT 1 FROM accounting_journal_entries entry WHERE entry.tenant_id=payment.tenant_id AND entry.branch_id=payment.branch_id AND entry.source_type='payment' AND entry.source_id=payment.id)",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to verify EOD payment journal coverage"))?;
    let unbalanced_journals: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM (SELECT entry.id FROM accounting_journal_entries entry JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.entry_date=$3 GROUP BY entry.id HAVING SUM(line.debit_paise)<>SUM(line.credit_paise)) mismatch",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to validate balanced EOD journals"))?;
    let drawer: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT,COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM cash_drawer_tills till WHERE till.tenant_id=session.tenant_id AND till.branch_id=session.branch_id AND till.drawer_session_id=session.id) THEN (SELECT COALESCE(SUM(till.opening_cash_paise),0)::BIGINT FROM cash_drawer_tills till WHERE till.tenant_id=session.tenant_id AND till.branch_id=session.branch_id AND till.drawer_session_id=session.id) ELSE session.opening_cash_paise END),0)::BIGINT,COALESCE(SUM(session.expected_cash_paise),0)::BIGINT,COUNT(*) FILTER(WHERE session.status IN ('open','pending_approval'))::BIGINT FROM cash_drawer_sessions session WHERE session.tenant_id=$1 AND session.branch_id=$2 AND session.business_date=$3",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to reconcile EOD register"))?;
    let cash_payments: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(payment.amount_paise),0)::BIGINT FROM pos_payments payment JOIN pos_sales sale ON sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id AND sale.id=payment.sale_id WHERE payment.tenant_id=$1 AND payment.branch_id=$2 AND sale.business_date=$3 AND payment.method='cash' AND sale.status NOT IN ('draft','voided','cancelled')",
    )
    .bind(tenant).bind(branch).bind(date).fetch_one(db).await
    .map_err(|_| AppError::internal("failed to reconcile EOD cash payments"))?;
    let movement_delta = cash_drawer_repository::movement_delta_for_date(db, tenant, branch, date)
        .await
        .map_err(|_| AppError::internal("failed to reconcile EOD cash movements"))?;
    let outgoing_cash =
        cash_drawer_repository::approved_outgoing_cash_for_date(db, tenant, branch, date)
            .await
            .map_err(|_| AppError::internal("failed to reconcile EOD outgoing cash"))?;
    let snapshots: i64 = sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM cash_drawer_close_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3")
        .bind(tenant).bind(branch).bind(date).fetch_one(db).await
        .map_err(|_| AppError::internal("failed to verify EOD close snapshots"))?;
    let closed_drawers: i64 = sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='closed'")
        .bind(tenant).bind(branch).bind(date).fetch_one(db).await
        .map_err(|_| AppError::internal("failed to verify EOD closed drawers"))?;
    let settlement_exceptions: i64 = sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM pos_provider_reconciliation_runs WHERE tenant_id=$1 AND branch_id=$2 AND settlement_date=$3 AND status='review_required'")
        .bind(tenant).bind(branch).bind(date).fetch_one(db).await.unwrap_or(0);

    let invoice_payment_gap = invoices.2.saturating_sub(payment_total);
    let invoice_accounting_gap = invoices.1.saturating_sub(invoice_journal_total);
    let payment_accounting_gap = payment_total.saturating_sub(payment_journal_total);
    let calculated_register = drawer
        .1
        .saturating_add(cash_payments)
        .saturating_add(movement_delta)
        .saturating_sub(outgoing_cash);
    let register_gap = if drawer.0 == 0 {
        cash_payments
    } else {
        calculated_register.saturating_sub(drawer.2)
    };
    let ready = drawer.3 == 0
        && invoice_payment_gap == 0
        && invoice_accounting_gap == 0
        && payment_accounting_gap == 0
        && register_gap == 0
        && missing_invoice_journals == 0
        && missing_payment_journals == 0
        && unbalanced_journals == 0
        && snapshots == closed_drawers
        && settlement_exceptions == 0;
    Ok(json!({
        "ready": ready,
        "invoiceCount": invoices.0,
        "invoiceTotalPaise": invoices.1,
        "invoicePaidPaise": invoices.2,
        "paymentTotalPaise": payment_total,
        "invoiceJournalTotalPaise": invoice_journal_total,
        "paymentJournalTotalPaise": payment_journal_total,
        "invoicePaymentGapPaise": invoice_payment_gap,
        "invoiceAccountingGapPaise": invoice_accounting_gap,
        "paymentAccountingGapPaise": payment_accounting_gap,
        "calculatedRegisterPaise": calculated_register,
        "storedExpectedRegisterPaise": drawer.2,
        "registerGapPaise": register_gap,
        "openDrawerCount": drawer.3,
        "closedDrawerCount": closed_drawers,
        "closeSnapshotCount": snapshots,
        "missingInvoiceJournals": missing_invoice_journals,
        "missingPaymentJournals": missing_payment_journals,
        "unbalancedJournals": unbalanced_journals,
        "settlementExceptions": settlement_exceptions
    }))
}

pub async fn scan_risks(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    date: NaiveDate,
) -> Result<Vec<RiskCase>, AppError> {
    let cash_controls = cash_drawer_repository::control_settings(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load cash control settings"))?;
    let eod = eod_reconciliation(db, tenant, branch, date).await?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start risk scan"))?;
    let drawers: Vec<(String, i64)> = sqlx::query_as("SELECT id,COALESCE(variance_paise,0)::BIGINT FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='closed' AND COALESCE(variance_paise,0)<>0")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await.map_err(|_| AppError::internal("failed to scan drawer variances"))?;
    for (id, variance) in drawers {
        let high_variance = variance.abs() >= cash_controls.variance_alert_paise;
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "CASH_VARIANCE",
            if high_variance { "high" } else { "medium" },
            if high_variance { 80 } else { 55 },
            "cash_drawer",
            &id,
            variance.unsigned_abs().min(i64::MAX as u64) as i64,
            json!({"variancePaise":variance}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save drawer risk"))?;
    }
    let current_cash = eod
        .get("calculatedRegisterPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if cash_controls.max_cash_paise > 0 && current_cash > cash_controls.max_cash_paise {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "CASH_LIMIT_EXCEEDED",
            "high",
            85,
            "branch",
            branch,
            current_cash - cash_controls.max_cash_paise,
            json!({"currentCashPaise":current_cash,"maxCashPaise":cash_controls.max_cash_paise,"excessPaise":current_cash-cash_controls.max_cash_paise}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save cash limit risk"))?;
    }
    let reconciliations: Vec<(String, i64, i64)> = sqlx::query_as("SELECT id,gross_difference_paise,net_difference_paise FROM pos_provider_reconciliation_runs WHERE tenant_id=$1 AND branch_id=$2 AND settlement_date=$3 AND status='review_required'")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await.map_err(|_| AppError::internal("failed to scan settlement exceptions"))?;
    for (id, gross, net) in reconciliations {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "SETTLEMENT_EXCEPTION",
            "high",
            75,
            "provider_reconciliation",
            &id,
            gross.abs().max(net.abs()),
            json!({"grossDifferencePaise":gross,"netDifferencePaise":net}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save settlement risk"))?;
    }
    let open_tills: Vec<(String,)> = sqlx::query_as("SELECT id FROM cash_drawer_tills WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='open'")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await.map_err(|_| AppError::internal("failed to scan open tills"))?;
    for (id,) in open_tills {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "OPEN_TILL",
            "medium",
            50,
            "cash_drawer_till",
            &id,
            0,
            json!({"businessDate":date}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save till risk"))?;
    }
    let duplicate_references: Vec<(String, i64, i64)> = sqlx::query_as("SELECT p.method_reference,COUNT(DISTINCT p.sale_id)::BIGINT,COALESCE(SUM(p.amount_paise),0)::BIGINT FROM pos_payments p JOIN pos_sales s ON s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id WHERE p.tenant_id=$1 AND p.branch_id=$2 AND s.business_date=$3 AND p.method_reference<>'' GROUP BY p.method_reference HAVING COUNT(DISTINCT p.sale_id)>1")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await.map_err(|_| AppError::internal("failed to scan duplicate payment references"))?;
    for (reference, invoice_count, amount) in duplicate_references {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "DUPLICATE_PAYMENT_REFERENCE",
            "high",
            85,
            "payment_reference",
            &reference,
            amount,
            json!({"invoiceCount":invoice_count,"amountPaise":amount}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save payment-reference risk"))?;
    }
    let overpaid: Vec<(String, i64, i64)> = sqlx::query_as("SELECT id,total_paise,paid_paise FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND paid_paise>total_paise")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await.map_err(|_| AppError::internal("failed to scan overpaid invoices"))?;
    for (sale_id, total, paid) in overpaid {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "OVERPAID_INVOICE",
            "critical",
            100,
            "pos_sale",
            &sale_id,
            paid - total,
            json!({"totalPaise":total,"paidPaise":paid,"overpaymentPaise":paid-total}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save overpayment risk"))?;
    }
    let excessive_discounts: Vec<(String, i64, i64, i64)> = sqlx::query_as("SELECT COALESCE(NULLIF(staff_id,''),'unassigned'),COUNT(*)::BIGINT,COALESCE(SUM(discount_paise),0)::BIGINT,COALESCE(SUM(subtotal_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status NOT IN ('voided','cancelled') GROUP BY COALESCE(NULLIF(staff_id,''),'unassigned') HAVING SUM(discount_paise)>=10000 OR (SUM(subtotal_paise)>0 AND SUM(discount_paise)*100>SUM(subtotal_paise)*25)")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await
        .map_err(|_| AppError::internal("failed to scan excessive discounts"))?;
    for (staff_id, invoice_count, discount, subtotal) in excessive_discounts {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx, tenant, branch, date, "EXCESSIVE_DISCOUNTS", "high", 78,
            "staff", &staff_id, discount,
            json!({"invoiceCount":invoice_count,"discountPaise":discount,"subtotalPaise":subtotal,"threshold":{"amountPaise":10000,"percent":25}}),
        ).await.map_err(|_| AppError::internal("failed to save discount risk"))?;
    }
    let repeated_voids: Vec<(String, i64, i64)> = sqlx::query_as("SELECT COALESCE(NULLIF(v.actor_user_id,''),'unassigned'),COUNT(*)::BIGINT,COALESCE(SUM(s.total_paise),0)::BIGINT FROM pos_invoice_voids v JOIN pos_sales s ON s.tenant_id=v.tenant_id AND s.branch_id=v.branch_id AND s.id=v.sale_id WHERE v.tenant_id=$1 AND v.branch_id=$2 AND v.created_at::DATE=$3 GROUP BY COALESCE(NULLIF(v.actor_user_id,''),'unassigned') HAVING COUNT(*)>=3")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await
        .map_err(|_| AppError::internal("failed to scan repeated voids"))?;
    for (actor, void_count, amount) in repeated_voids {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "REPEATED_VOIDS",
            "high",
            82,
            "user",
            &actor,
            amount,
            json!({"voidCount":void_count,"amountPaise":amount,"thresholdCount":3}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save void risk"))?;
    }
    let refund_abuse: Vec<(String, i64, i64)> = sqlx::query_as("SELECT COALESCE(NULLIF(actor_user_id,''),'unassigned'),COUNT(*)::BIGINT,COALESCE(SUM(amount_paise),0)::BIGINT FROM pos_invoice_refunds WHERE tenant_id=$1 AND branch_id=$2 AND created_at::DATE=$3 GROUP BY COALESCE(NULLIF(actor_user_id,''),'unassigned') HAVING COUNT(*)>=3 OR SUM(amount_paise)>=10000")
        .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await
        .map_err(|_| AppError::internal("failed to scan refund abuse"))?;
    for (actor, refund_count, amount) in refund_abuse {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx, tenant, branch, date, "REFUND_ABUSE", if amount>=50000{"critical"}else{"high"}, if amount>=50000{92}else{80},
            "user", &actor, amount,
            json!({"refundCount":refund_count,"amountPaise":amount,"threshold":{"count":3,"amountPaise":10000}}),
        ).await.map_err(|_| AppError::internal("failed to save refund risk"))?;
    }
    let payment_mismatches: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT sale.id,sale.paid_paise,COALESCE(SUM(payment.amount_paise),0)::BIGINT FROM pos_sales sale LEFT JOIN pos_payments payment ON payment.tenant_id=sale.tenant_id AND payment.branch_id=sale.branch_id AND payment.sale_id=sale.id WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date=$3 AND sale.status NOT IN ('draft','voided','cancelled','refunded') GROUP BY sale.id,sale.paid_paise HAVING sale.paid_paise<>COALESCE(SUM(payment.amount_paise),0)::BIGINT",
    )
    .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await
    .map_err(|_| AppError::internal("failed to match invoice payments"))?;
    for (sale_id, recorded_paid, payment_total) in payment_mismatches {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx, tenant, branch, date, "PAYMENT_LEDGER_MISMATCH", "critical", 96,
            "pos_sale", &sale_id, (recorded_paid-payment_total).abs(),
            json!({"recordedPaidPaise":recorded_paid,"paymentTotalPaise":payment_total,"differencePaise":recorded_paid-payment_total}),
        ).await.map_err(|_| AppError::internal("failed to save payment mismatch"))?;
    }
    let unbalanced_journals: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT entry.id,COALESCE(SUM(line.debit_paise),0)::BIGINT,COALESCE(SUM(line.credit_paise),0)::BIGINT FROM accounting_journal_entries entry JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.entry_date=$3 GROUP BY entry.id HAVING SUM(line.debit_paise)<>SUM(line.credit_paise)",
    )
    .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await
    .map_err(|_| AppError::internal("failed to verify accounting journals"))?;
    for (entry_id, debit, credit) in unbalanced_journals {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "UNBALANCED_JOURNAL",
            "critical",
            100,
            "accounting_journal_entry",
            &entry_id,
            (debit - credit).abs(),
            json!({"debitPaise":debit,"creditPaise":credit,"differencePaise":debit-credit}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save journal mismatch"))?;
    }
    let missing_journals: Vec<(String, i64)> = sqlx::query_as(
        "SELECT sale.id,sale.total_paise FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.business_date=$3 AND sale.status NOT IN ('draft','voided','cancelled','refunded') AND NOT EXISTS (SELECT 1 FROM accounting_journal_entries entry WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id AND entry.source_type='invoice' AND entry.source_id=sale.id)",
    )
    .bind(tenant).bind(branch).bind(date).fetch_all(&mut *tx).await
    .map_err(|_| AppError::internal("failed to verify invoice journals"))?;
    for (sale_id, amount) in missing_journals {
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "MISSING_INVOICE_JOURNAL",
            "critical",
            98,
            "pos_sale",
            &sale_id,
            amount,
            json!({"invoiceTotalPaise":amount}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save missing journal risk"))?;
    }
    let renewal_anomalies: Vec<(String, String, i32, i64, NaiveDate)> = sqlx::query_as(
        "SELECT cm.id,cm.auto_renew_status,cm.auto_renew_failure_count,m.price_paise,COALESCE(cm.updated_at,cm.assigned_at)::DATE FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.active=TRUE AND cm.auto_renew_enabled=TRUE AND cm.auto_renew_status IN ('failed','payment_required') AND cm.auto_renew_failure_count>=3 AND COALESCE(cm.updated_at,cm.assigned_at)::DATE<=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(date)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to scan subscription renewal anomalies"))?;
    for (membership_id, status, failure_count, price, detected_date) in renewal_anomalies {
        let critical = failure_count >= 4;
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            detected_date,
            "SUBSCRIPTION_RENEWAL_ANOMALY",
            if critical { "critical" } else { "high" },
            if critical { 90 } else { 75 },
            "client_membership",
            &membership_id,
            price,
            json!({"failureCount":failure_count,"status":status,"thresholdCount":3}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save subscription risk"))?;
    }
    let account_activity: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT user_id,COUNT(DISTINCT NULLIF(BTRIM(device_id),''))::BIGINT,COUNT(DISTINCT NULLIF(BTRIM(ip_address),''))::BIGINT,COUNT(DISTINCT session_id)::BIGINT FROM auth_refresh_tokens WHERE tenant_id=$1 AND branch_id=$2 AND revoked_at IS NULL AND expires_at>NOW() GROUP BY user_id",
    )
    .bind(tenant)
    .bind(branch)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to scan account sharing signals"))?;
    for (user_id, device_count, ip_count, session_count) in account_activity {
        let Some((severity, score)) = account_sharing_risk(device_count, ip_count) else {
            continue;
        };
        pos_enterprise_repository::upsert_risk_case(
            &mut tx,
            tenant,
            branch,
            date,
            "ACCOUNT_SHARING_SIGNAL",
            severity,
            score,
            "user",
            &user_id,
            0,
            json!({"deviceCount":device_count,"ipCount":ip_count,"sessionCount":session_count,"thresholdCount":4}),
        )
        .await
        .map_err(|_| AppError::internal("failed to save account sharing risk"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to finish risk scan"))?;
    pos_enterprise_repository::list_risk_cases(db, tenant, branch, "open")
        .await
        .map_err(|_| AppError::internal("failed to load risk cases"))
}

#[allow(clippy::too_many_arguments)]
pub async fn record_payment_guard_mismatch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant: &str,
    branch: &str,
    sale_id: &str,
    payment_link_id: &str,
    provider: &str,
    expected_amount_paise: i64,
    received_amount_paise: i64,
    provider_payment_id_present: bool,
) -> Result<(), sqlx::Error> {
    let date: NaiveDate = sqlx::query_scalar(
        "SELECT business_date FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(sale_id)
    .fetch_one(&mut **tx)
    .await?;
    let amount_at_risk = if provider_payment_id_present {
        expected_amount_paise
            .saturating_sub(received_amount_paise)
            .unsigned_abs()
            .min(i64::MAX as u64) as i64
    } else {
        expected_amount_paise
    };
    pos_enterprise_repository::upsert_risk_case(
        tx,
        tenant,
        branch,
        date,
        "PAYMENT_IDENTITY_OR_AMOUNT_MISMATCH",
        "critical",
        95,
        "payment_link",
        payment_link_id,
        amount_at_risk,
        json!({
            "provider":provider,
            "expectedAmountPaise":expected_amount_paise,
            "receivedAmountPaise":received_amount_paise,
            "providerPaymentIdPresent":provider_payment_id_present
        }),
    )
    .await?;
    Ok(())
}

fn account_sharing_risk(device_count: i64, ip_count: i64) -> Option<(&'static str, i32)> {
    let signal_count = device_count.max(ip_count);
    if signal_count >= 6 {
        Some(("critical", 92))
    } else if signal_count >= 4 {
        Some(("high", 82))
    } else {
        None
    }
}

pub async fn reliability_snapshot(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, AppError> {
    let started = std::time::Instant::now();
    let row = pos_enterprise_repository::reliability_snapshot(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load POS reliability snapshot"))?;
    let latency_ms = started.elapsed().as_millis() as u64;
    let attention = row.invoice_dead_letter > 0
        || row.print_dead_letter > 0
        || row.compliance_dead_letter > 0
        || row.open_integrity_cases > 0
        || row.payment_mismatches > 0
        || row.settlement_exceptions > 0;
    Ok(json!({
        "status": if attention { "attention" } else { "healthy" },
        "database": { "status": "ok", "latencyMs": latency_ms, "poolSize": db.size(), "idleConnections": db.num_idle() },
        "queues": {
            "invoice": { "pending": row.invoice_pending, "deadLetter": row.invoice_dead_letter, "oldestLagSeconds": row.invoice_oldest_lag_seconds },
            "print": { "pending": row.print_pending, "deadLetter": row.print_dead_letter, "oldestLagSeconds": row.print_oldest_lag_seconds },
            "compliance": { "pending": row.compliance_pending, "deadLetter": row.compliance_dead_letter }
        },
        "integrity": { "openCases": row.open_integrity_cases, "paymentMismatches": row.payment_mismatches, "settlementExceptions": row.settlement_exceptions },
        "measuredAt": Utc::now()
    }))
}

pub async fn run_integrity_monitor(db: &PgPool) -> Result<usize, AppError> {
    let scopes = pos_enterprise_repository::active_pos_scopes(db)
        .await
        .map_err(|_| AppError::internal("failed to load active POS scopes"))?;
    let count = scopes.len();
    for (tenant, branch, date) in scopes {
        scan_risks(db, &tenant, &branch, date).await?;
    }
    Ok(count)
}

pub async fn float_suggestion(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, AppError> {
    let values: Vec<(NaiveDate, i64)> = sqlx::query_as("SELECT business_date,opening_cash_paise FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND status='closed' AND opening_cash_paise>0 ORDER BY business_date DESC LIMIT 14")
        .bind(tenant).bind(branch).fetch_all(db).await.map_err(|_| AppError::internal("failed to calculate float suggestion"))?;
    let suggested = if values.is_empty() {
        0
    } else {
        values.iter().map(|row| row.1).sum::<i64>() / values.len() as i64
    };
    Ok(
        json!({"suggestedOpeningCashPaise":suggested,"basis":"average_closed_drawer_opening_cash","sampleDays":values.len(),"history":values.into_iter().map(|(date,amount)| json!({"businessDate":date,"openingCashPaise":amount})).collect::<Vec<_>>() }),
    )
}

#[cfg(test)]
mod tests {
    use super::{account_sharing_risk, fifo_allocations};

    #[test]
    fn corporate_payment_allocates_oldest_balance_first() {
        assert_eq!(
            fifo_allocations(12_000, &[5_000, 10_000, 20_000]).unwrap(),
            vec![5_000, 7_000, 0]
        );
        assert!(fifo_allocations(36_000, &[5_000, 10_000, 20_000]).is_err());
    }

    #[test]
    fn account_sharing_requires_multiple_observed_devices_or_ips() {
        assert_eq!(account_sharing_risk(3, 3), None);
        assert_eq!(account_sharing_risk(4, 2), Some(("high", 82)));
        assert_eq!(account_sharing_risk(2, 6), Some(("critical", 92)));
    }
}
