use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow)]
pub struct CashDrawerSession {
    pub id: String,
    pub business_date: NaiveDate,
    pub opening_cash_paise: i64,
    pub expected_cash_paise: i64,
    pub counted_cash_paise: Option<i64>,
    pub variance_paise: Option<i64>,
    pub status: String,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub close_requested_at: Option<DateTime<Utc>>,
    pub approved_at: Option<DateTime<Utc>>,
    pub denomination_breakdown_json: Value,
    pub handover_to_staff_id: String,
    pub handover_note: String,
    pub handover_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashDrawerBankDeposit {
    pub id: String,
    pub drawer_session_id: String,
    pub amount_paise: i64,
    pub bank_name: String,
    pub reference: String,
    pub status: String,
    pub deposited_by_user_id: String,
    pub confirmed_by_user_id: String,
    pub notes: String,
    pub deposited_at: DateTime<Utc>,
    pub confirmed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderReconciliationRun {
    pub id: String,
    pub provider: String,
    pub settlement_date: NaiveDate,
    pub statement_reference: String,
    pub system_gross_paise: i64,
    pub statement_gross_paise: i64,
    pub fee_paise: i64,
    pub bank_net_paise: i64,
    pub gross_difference_paise: i64,
    pub net_difference_paise: i64,
    pub status: String,
    pub notes: String,
    pub review_note: String,
    pub created_by_user_id: String,
    pub reviewed_by_user_id: String,
    pub created_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashDrawerTill {
    pub id: String,
    pub drawer_session_id: String,
    pub till_code: String,
    pub till_name: String,
    pub opening_cash_paise: i64,
    pub expected_cash_paise: i64,
    pub counted_cash_paise: Option<i64>,
    pub variance_paise: Option<i64>,
    pub status: String,
    pub opened_at: DateTime<Utc>,
    pub close_requested_at: Option<DateTime<Utc>>,
    pub approved_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashDrawerMovement {
    pub id: String,
    pub drawer_session_id: String,
    pub cash_drawer_till_id: Option<String>,
    pub movement_type: String,
    pub amount_paise: i64,
    pub reference_type: String,
    pub reference_id: String,
    pub actor_user_id: String,
    pub notes: String,
    pub reverses_movement_id: Option<String>,
    pub reversed_by_id: Option<String>,
    pub correction_reason: String,
    pub created_at: DateTime<Utc>,
}

const SESSION_COLUMNS: &str = "id, business_date, opening_cash_paise, expected_cash_paise, counted_cash_paise, variance_paise, status, opened_at, closed_at, close_requested_at, approved_at, denomination_breakdown_json, handover_to_staff_id, handover_note, handover_at";

pub async fn lock_business_date(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':' || $3::TEXT, 0))",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(business_date)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn is_day_locked(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_day_locks WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='locked')")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(business_date)
        .fetch_one(&mut **tx)
        .await
}

pub async fn active_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<Option<CashDrawerSession>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SESSION_COLUMNS} FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status IN ('open','pending_approval') ORDER BY opened_at DESC LIMIT 1 FOR UPDATE"))
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_optional(&mut **tx).await
}

pub async fn is_open_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='open')")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_one(&mut **tx).await
}

pub async fn current(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<Option<CashDrawerSession>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SESSION_COLUMNS} FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 ORDER BY opened_at DESC LIMIT 1"))
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_optional(db).await
}

pub async fn by_id_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<CashDrawerSession>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {SESSION_COLUMNS} FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"))
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn movement_session_by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT drawer_session_id FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(idempotency_key)
        .fetch_optional(&mut **tx)
        .await
}

pub async fn open(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    opening_cash_paise: i64,
    notes: &str,
) -> Result<Option<CashDrawerSession>, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO cash_drawer_sessions (id, tenant_id, branch_id, opened_by_user_id, business_date, opening_cash_paise, expected_cash_paise, notes) SELECT gen_random_uuid()::TEXT, $1,$2,$3,$4,$5,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$4) RETURNING {SESSION_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(actor_user_id).bind(business_date).bind(opening_cash_paise).bind(notes).fetch_optional(&mut **tx).await
}

pub async fn totals(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
    drawer_session_id: &str,
) -> Result<(i64, i64), sqlx::Error> {
    let cash_sales = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(pp.amount_paise),0)::BIGINT FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.method='cash' AND ps.business_date=$3")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_one(&mut **tx).await?;
    let movement_delta = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3 AND movement_type IN ('cash_in','cash_out','refund_cash','closing_adjustment')")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_one(&mut **tx).await?;
    let outgoing_cash = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(line.amount_paise),0)::BIGINT FROM outgoing_fund_vouchers voucher JOIN outgoing_fund_lines line ON line.tenant_id=voucher.tenant_id AND line.branch_id=voucher.branch_id AND line.voucher_id=voucher.id WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2 AND voucher.business_date=$3 AND voucher.payment_account_code='CASH_ON_HAND' AND voucher.status='approved'")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_one(&mut **tx).await?;
    Ok((cash_sales, movement_delta.saturating_sub(outgoing_cash)))
}

pub async fn movement_delta_for_date(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(movement.amount_paise),0)::BIGINT FROM cash_drawer_movements movement JOIN cash_drawer_sessions session ON session.id=movement.drawer_session_id AND session.tenant_id=movement.tenant_id AND session.branch_id=movement.branch_id WHERE movement.tenant_id=$1 AND movement.branch_id=$2 AND session.business_date=$3 AND movement.movement_type IN ('cash_in','cash_out','refund_cash','closing_adjustment')")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_one(db).await
}

pub async fn approved_outgoing_cash_for_date(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(line.amount_paise),0)::BIGINT FROM outgoing_fund_vouchers voucher JOIN outgoing_fund_lines line ON line.tenant_id=voucher.tenant_id AND line.branch_id=voucher.branch_id AND line.voucher_id=voucher.id WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2 AND voucher.business_date=$3 AND voucher.payment_account_code='CASH_ON_HAND' AND voucher.status='approved'")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_one(db).await
}

pub async fn invoice_refund_accounting_variance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
) -> Result<i64, sqlx::Error> {
    let movement_total = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(ABS(amount_paise)),0)::BIGINT FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3 AND movement_type='refund_cash' AND reference_type='invoice_refund'")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_one(&mut **tx).await?;
    let journal_total = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(line.credit_paise),0)::BIGINT FROM cash_drawer_movements movement JOIN accounting_journal_entries entry ON entry.tenant_id=movement.tenant_id AND entry.branch_id=movement.branch_id AND entry.source_type='refund' AND entry.source_id=movement.reference_id JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id AND line.account_code='CASH_ON_HAND' WHERE movement.tenant_id=$1 AND movement.branch_id=$2 AND movement.drawer_session_id=$3 AND movement.movement_type='refund_cash' AND movement.reference_type='invoice_refund'")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_one(&mut **tx).await?;
    Ok(movement_total.saturating_sub(journal_total))
}

pub async fn insert_movement(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    cash_drawer_till_id: Option<&str>,
    movement_type: &str,
    amount_paise: i64,
    reference_type: &str,
    reference_id: &str,
    actor_user_id: &str,
    notes: &str,
    idempotency_key: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("INSERT INTO cash_drawer_movements (tenant_id, branch_id, drawer_session_id, cash_drawer_till_id, movement_type, amount_paise, reference_type, reference_id, actor_user_id, notes, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id, branch_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(cash_drawer_till_id).bind(movement_type).bind(amount_paise).bind(reference_type).bind(reference_id).bind(actor_user_id).bind(notes).bind(idempotency_key).execute(&mut **tx).await?;
    Ok(result.rows_affected() == 1)
}

pub async fn list_movements(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
) -> Result<Vec<CashDrawerMovement>, sqlx::Error> {
    sqlx::query_as("SELECT m.id,m.drawer_session_id,m.cash_drawer_till_id,m.movement_type,m.amount_paise,m.reference_type,m.reference_id,m.actor_user_id,m.notes,m.reverses_movement_id,(SELECT reversal.id FROM cash_drawer_movements reversal WHERE reversal.tenant_id=m.tenant_id AND reversal.branch_id=m.branch_id AND reversal.reverses_movement_id=m.id LIMIT 1) reversed_by_id,m.correction_reason,m.created_at FROM cash_drawer_movements m WHERE m.tenant_id=$1 AND m.branch_id=$2 AND m.drawer_session_id=$3 ORDER BY m.created_at DESC")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_all(db).await
}

pub async fn reverse_movement(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    movement_id: &str,
    actor_user_id: &str,
    reason: &str,
) -> Result<Option<CashDrawerMovement>, sqlx::Error> {
    sqlx::query_as("WITH original AS MATERIALIZED (SELECT m.* FROM cash_drawer_movements m JOIN cash_drawer_sessions s ON s.id=m.drawer_session_id AND s.tenant_id=m.tenant_id AND s.branch_id=m.branch_id WHERE m.tenant_id=$1 AND m.branch_id=$2 AND m.id=$3 AND s.status='open' AND m.movement_type IN ('cash_in','cash_out','refund_cash','closing_adjustment') AND m.reverses_movement_id IS NULL FOR UPDATE OF m), inserted AS (INSERT INTO cash_drawer_movements (tenant_id,branch_id,drawer_session_id,cash_drawer_till_id,movement_type,amount_paise,reference_type,reference_id,actor_user_id,notes,reverses_movement_id,correction_reason) SELECT tenant_id,branch_id,drawer_session_id,cash_drawer_till_id,'closing_adjustment',-amount_paise,'movement_reversal',id,$4,$5,id,$5 FROM original RETURNING *) SELECT id,drawer_session_id,cash_drawer_till_id,movement_type,amount_paise,reference_type,reference_id,actor_user_id,notes,reverses_movement_id,NULL::TEXT reversed_by_id,correction_reason,created_at FROM inserted")
        .bind(tenant_id).bind(branch_id).bind(movement_id).bind(actor_user_id).bind(reason).fetch_optional(&mut **tx).await
}

pub async fn request_close(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    actor_user_id: &str,
    expected_cash_paise: i64,
    counted_cash_paise: i64,
    variance_paise: i64,
    status: &str,
    notes: &str,
    denomination_breakdown: Value,
) -> Result<CashDrawerSession, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE cash_drawer_sessions SET expected_cash_paise=$4, counted_cash_paise=$5, variance_paise=$6, status=$7, notes=$8, close_requested_by_user_id=$9, close_requested_at=NOW(), denomination_breakdown_json=$10, closed_by_user_id=CASE WHEN $7='closed' THEN $9 ELSE '' END, closed_at=CASE WHEN $7='closed' THEN NOW() ELSE NULL END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING {SESSION_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(expected_cash_paise).bind(counted_cash_paise).bind(variance_paise).bind(status).bind(notes).bind(actor_user_id).bind(denomination_breakdown).fetch_one(&mut **tx).await
}

pub async fn approve_close(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    actor_user_id: &str,
    approval_note: &str,
) -> Result<CashDrawerSession, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE cash_drawer_sessions SET status='closed', approved_by_user_id=$4, approved_at=NOW(), approval_note=$5, closed_by_user_id=$4, closed_at=NOW(), updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' AND close_requested_by_user_id <> $4 RETURNING {SESSION_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(actor_user_id).bind(approval_note).fetch_one(&mut **tx).await
}

pub async fn active_staff_name(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT TRIM(CONCAT_WS(' ', first_name, NULLIF(middle_name,''), NULLIF(last_name,''))) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_optional(&mut **tx).await
}

pub async fn record_handover(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    actor_user_id: &str,
    staff_id: &str,
    notes: &str,
) -> Result<CashDrawerSession, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE cash_drawer_sessions SET handover_to_staff_id=$4, handover_by_user_id=$5, handover_note=$6, handover_at=NOW(), updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' RETURNING {SESSION_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(staff_id).bind(actor_user_id).bind(notes).fetch_one(&mut **tx).await
}

pub async fn list_deposits(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
) -> Result<Vec<CashDrawerBankDeposit>, sqlx::Error> {
    sqlx::query_as("SELECT id, drawer_session_id, amount_paise, bank_name, reference, status, deposited_by_user_id, confirmed_by_user_id, notes, deposited_at, confirmed_at, cancelled_at FROM cash_drawer_bank_deposits WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3 ORDER BY deposited_at DESC")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_all(db).await
}

pub async fn active_deposit_total(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM cash_drawer_bank_deposits WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3 AND status <> 'cancelled'")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_one(&mut **tx).await
}

pub async fn insert_deposit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    actor_user_id: &str,
    amount_paise: i64,
    bank_name: &str,
    reference: &str,
    notes: &str,
) -> Result<CashDrawerBankDeposit, sqlx::Error> {
    sqlx::query_as("INSERT INTO cash_drawer_bank_deposits (tenant_id, branch_id, drawer_session_id, amount_paise, bank_name, reference, deposited_by_user_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, drawer_session_id, amount_paise, bank_name, reference, status, deposited_by_user_id, confirmed_by_user_id, notes, deposited_at, confirmed_at, cancelled_at")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(amount_paise).bind(bank_name).bind(reference).bind(actor_user_id).bind(notes).fetch_one(&mut **tx).await
}

pub async fn update_deposit_status(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    status: &str,
) -> Result<Option<CashDrawerBankDeposit>, sqlx::Error> {
    sqlx::query_as("UPDATE cash_drawer_bank_deposits SET status=$5, confirmed_by_user_id=CASE WHEN $5='confirmed' THEN $4 ELSE confirmed_by_user_id END, confirmed_at=CASE WHEN $5='confirmed' THEN NOW() ELSE confirmed_at END, cancelled_at=CASE WHEN $5='cancelled' THEN NOW() ELSE cancelled_at END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' AND ($5<>'confirmed' OR deposited_by_user_id<>$4) RETURNING id, drawer_session_id, amount_paise, bank_name, reference, status, deposited_by_user_id, confirmed_by_user_id, notes, deposited_at, confirmed_at, cancelled_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor_user_id).bind(status).fetch_optional(&mut **tx).await
}

pub async fn amend_pending_deposit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    amount_paise: i64,
    bank_name: &str,
    reference: &str,
    notes: &str,
    amendment_note: &str,
) -> Result<Option<CashDrawerBankDeposit>, sqlx::Error> {
    sqlx::query_as("UPDATE cash_drawer_bank_deposits SET amount_paise=$5,bank_name=$6,reference=$7,notes=$8,amended_by_user_id=$4,amendment_note=$9,amended_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' RETURNING id,drawer_session_id,amount_paise,bank_name,reference,status,deposited_by_user_id,confirmed_by_user_id,notes,deposited_at,confirmed_at,cancelled_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor_user_id).bind(amount_paise).bind(bank_name).bind(reference).bind(notes).bind(amendment_note).fetch_optional(&mut **tx).await
}

pub async fn system_provider_gross(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    settlement_date: NaiveDate,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM pos_payment_links WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(provider)=LOWER($3) AND status='paid' AND updated_at::DATE=$4")
        .bind(tenant_id).bind(branch_id).bind(provider).bind(settlement_date).fetch_one(&mut **tx).await
}

pub async fn insert_provider_reconciliation(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    provider: &str,
    settlement_date: NaiveDate,
    statement_reference: &str,
    system_gross_paise: i64,
    statement_gross_paise: i64,
    fee_paise: i64,
    bank_net_paise: i64,
    status: &str,
    actor_user_id: &str,
    notes: &str,
) -> Result<ProviderReconciliationRun, sqlx::Error> {
    let gross_difference = statement_gross_paise.saturating_sub(system_gross_paise);
    let net_difference =
        bank_net_paise.saturating_sub(statement_gross_paise.saturating_sub(fee_paise));
    sqlx::query_as("INSERT INTO pos_provider_reconciliation_runs (tenant_id,branch_id,provider,settlement_date,statement_reference,system_gross_paise,statement_gross_paise,fee_paise,bank_net_paise,gross_difference_paise,net_difference_paise,status,notes,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,provider,settlement_date,statement_reference,system_gross_paise,statement_gross_paise,fee_paise,bank_net_paise,gross_difference_paise,net_difference_paise,status,notes,review_note,created_by_user_id,reviewed_by_user_id,created_at,reviewed_at")
        .bind(tenant_id).bind(branch_id).bind(provider).bind(settlement_date).bind(statement_reference)
        .bind(system_gross_paise).bind(statement_gross_paise).bind(fee_paise).bind(bank_net_paise)
        .bind(gross_difference).bind(net_difference).bind(status).bind(notes).bind(actor_user_id)
        .fetch_one(&mut **tx).await
}

pub async fn list_provider_reconciliations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settlement_date: NaiveDate,
) -> Result<Vec<ProviderReconciliationRun>, sqlx::Error> {
    sqlx::query_as("SELECT id,provider,settlement_date,statement_reference,system_gross_paise,statement_gross_paise,fee_paise,bank_net_paise,gross_difference_paise,net_difference_paise,status,notes,review_note,created_by_user_id,reviewed_by_user_id,created_at,reviewed_at FROM pos_provider_reconciliation_runs WHERE tenant_id=$1 AND branch_id=$2 AND settlement_date=$3 ORDER BY created_at DESC")
        .bind(tenant_id).bind(branch_id).bind(settlement_date).fetch_all(db).await
}

pub async fn review_provider_reconciliation(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    review_note: &str,
) -> Result<Option<ProviderReconciliationRun>, sqlx::Error> {
    sqlx::query_as("UPDATE pos_provider_reconciliation_runs SET status='reviewed',reviewed_by_user_id=$4,review_note=$5,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='review_required' AND created_by_user_id<>$4 RETURNING id,provider,settlement_date,statement_reference,system_gross_paise,statement_gross_paise,fee_paise,bank_net_paise,gross_difference_paise,net_difference_paise,status,notes,review_note,created_by_user_id,reviewed_by_user_id,created_at,reviewed_at")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor_user_id).bind(review_note).fetch_optional(&mut **tx).await
}

const TILL_COLUMNS: &str = "id,drawer_session_id,till_code,till_name,opening_cash_paise,expected_cash_paise,counted_cash_paise,variance_paise,status,opened_at,close_requested_at,approved_at,closed_at";

pub async fn list_tills(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
) -> Result<Vec<CashDrawerTill>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TILL_COLUMNS} FROM cash_drawer_tills WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3 ORDER BY opened_at,till_name"))
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_all(db).await
}

pub async fn insert_till(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    till_code: &str,
    till_name: &str,
    opening_cash_paise: i64,
    actor_user_id: &str,
    notes: &str,
) -> Result<CashDrawerTill, sqlx::Error> {
    sqlx::query_as(&format!("INSERT INTO cash_drawer_tills (tenant_id,branch_id,drawer_session_id,till_code,till_name,opening_cash_paise,expected_cash_paise,opened_by_user_id,notes) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING {TILL_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(till_code).bind(till_name)
        .bind(opening_cash_paise).bind(actor_user_id).bind(notes).fetch_one(&mut **tx).await
}

pub async fn till_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<CashDrawerTill>, sqlx::Error> {
    sqlx::query_as(&format!("SELECT {TILL_COLUMNS} FROM cash_drawer_tills WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"))
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut **tx).await
}

pub async fn till_cash_sales(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    till_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(pp.amount_paise),0)::BIGINT FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND ps.cash_drawer_till_id=$3 AND pp.method='cash'")
        .bind(tenant_id).bind(branch_id).bind(till_id).fetch_one(&mut **tx).await
}

pub async fn till_movement_delta(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    till_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND cash_drawer_till_id=$3 AND movement_type IN ('cash_in','cash_out','refund_cash','closing_adjustment')")
        .bind(tenant_id).bind(branch_id).bind(till_id).fetch_one(&mut **tx).await
}

pub async fn till_outgoing_cash(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    till_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COALESCE(SUM(line.amount_paise),0)::BIGINT FROM outgoing_fund_vouchers voucher JOIN outgoing_fund_lines line ON line.tenant_id=voucher.tenant_id AND line.branch_id=voucher.branch_id AND line.voucher_id=voucher.id WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2 AND voucher.cash_drawer_till_id=$3 AND voucher.payment_account_code='CASH_ON_HAND' AND voucher.status='approved'")
        .bind(tenant_id).bind(branch_id).bind(till_id).fetch_one(&mut **tx).await
}

pub async fn close_till(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
    expected: i64,
    counted: i64,
    variance: i64,
    status: &str,
) -> Result<CashDrawerTill, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE cash_drawer_tills SET expected_cash_paise=$5,counted_cash_paise=$6,variance_paise=$7,status=$8,close_requested_by_user_id=$4,close_requested_at=NOW(),closed_at=CASE WHEN $8='closed' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' RETURNING {TILL_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor_user_id).bind(expected).bind(counted).bind(variance).bind(status).fetch_one(&mut **tx).await
}

pub async fn approve_till(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor_user_id: &str,
) -> Result<Option<CashDrawerTill>, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE cash_drawer_tills SET status='closed',approved_by_user_id=$4,approved_at=NOW(),closed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' AND close_requested_by_user_id<>$4 RETURNING {TILL_COLUMNS}"))
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor_user_id).fetch_optional(&mut **tx).await
}

pub async fn open_till_ids_for_cash(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
    requested_till_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT till.id FROM cash_drawer_tills till JOIN cash_drawer_sessions session ON session.id=till.drawer_session_id AND session.tenant_id=till.tenant_id AND session.branch_id=till.branch_id WHERE till.tenant_id=$1 AND till.branch_id=$2 AND session.business_date=$3 AND session.status='open' AND till.status='open' AND ($4='' OR till.id=$4) ORDER BY till.opened_at")
        .bind(tenant_id).bind(branch_id).bind(business_date).bind(requested_till_id).fetch_all(&mut **tx).await
}

pub async fn till_close_summary(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
) -> Result<(i64, i64, i64, i64, i64), sqlx::Error> {
    sqlx::query_as("SELECT COUNT(*)::BIGINT, COUNT(*) FILTER (WHERE status<>'closed')::BIGINT, COALESCE(SUM(opening_cash_paise),0)::BIGINT, COALESCE(SUM(expected_cash_paise),0)::BIGINT, COALESCE(SUM(counted_cash_paise),0)::BIGINT FROM cash_drawer_tills WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_one(&mut **tx).await
}

pub async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    actor_user_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO cash_drawer_audit_events (tenant_id, branch_id, drawer_session_id, actor_user_id, event_type, payload_json) VALUES ($1,$2,$3,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(actor_user_id).bind(event_type).bind(payload).execute(&mut **tx).await?;
    Ok(())
}
