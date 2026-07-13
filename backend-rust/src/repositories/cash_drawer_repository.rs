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
}

pub async fn active_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<Option<CashDrawerSession>, sqlx::Error> {
    sqlx::query_as("SELECT id, business_date, opening_cash_paise, expected_cash_paise, counted_cash_paise, variance_paise, status, opened_at, closed_at, close_requested_at, approved_at FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status IN ('open','pending_approval') ORDER BY opened_at DESC LIMIT 1 FOR UPDATE")
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
    sqlx::query_as("SELECT id, business_date, opening_cash_paise, expected_cash_paise, counted_cash_paise, variance_paise, status, opened_at, closed_at, close_requested_at, approved_at FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 ORDER BY opened_at DESC LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_optional(db).await
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
    sqlx::query_as("INSERT INTO cash_drawer_sessions (id, tenant_id, branch_id, opened_by_user_id, business_date, opening_cash_paise, expected_cash_paise, notes) SELECT gen_random_uuid()::TEXT, $1,$2,$3,$4,$5,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$4 AND status IN ('open','pending_approval')) RETURNING id, business_date, opening_cash_paise, expected_cash_paise, counted_cash_paise, variance_paise, status, opened_at, closed_at, close_requested_at, approved_at")
        .bind(tenant_id).bind(branch_id).bind(actor_user_id).bind(business_date).bind(opening_cash_paise).bind(notes).fetch_optional(&mut **tx).await
}

pub async fn totals(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
    drawer_session_id: &str,
) -> Result<(i64, i64), sqlx::Error> {
    let cash_sales = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(pp.amount_paise),0)::BIGINT FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.method='cash' AND COALESCE(ps.finalized_at, ps.created_at)::DATE=$3")
        .bind(tenant_id).bind(branch_id).bind(business_date).fetch_one(&mut **tx).await?;
    let movement_delta = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND drawer_session_id=$3 AND movement_type IN ('cash_in','cash_out','refund_cash','closing_adjustment')")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).fetch_one(&mut **tx).await?;
    Ok((cash_sales, movement_delta))
}

pub async fn insert_movement(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    movement_type: &str,
    amount_paise: i64,
    reference_type: &str,
    reference_id: &str,
    actor_user_id: &str,
    notes: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO cash_drawer_movements (tenant_id, branch_id, drawer_session_id, movement_type, amount_paise, reference_type, reference_id, actor_user_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(movement_type).bind(amount_paise).bind(reference_type).bind(reference_id).bind(actor_user_id).bind(notes).execute(&mut **tx).await?;
    Ok(())
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
) -> Result<CashDrawerSession, sqlx::Error> {
    sqlx::query_as("UPDATE cash_drawer_sessions SET expected_cash_paise=$4, counted_cash_paise=$5, variance_paise=$6, status=$7, notes=$8, close_requested_by_user_id=$9, close_requested_at=NOW(), closed_by_user_id=CASE WHEN $7='closed' THEN $9 ELSE '' END, closed_at=CASE WHEN $7='closed' THEN NOW() ELSE NULL END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id, business_date, opening_cash_paise, expected_cash_paise, counted_cash_paise, variance_paise, status, opened_at, closed_at, close_requested_at, approved_at")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(expected_cash_paise).bind(counted_cash_paise).bind(variance_paise).bind(status).bind(notes).bind(actor_user_id).fetch_one(&mut **tx).await
}

pub async fn approve_close(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    drawer_session_id: &str,
    actor_user_id: &str,
    approval_note: &str,
) -> Result<CashDrawerSession, sqlx::Error> {
    sqlx::query_as("UPDATE cash_drawer_sessions SET status='closed', approved_by_user_id=$4, approved_at=NOW(), approval_note=$5, closed_by_user_id=$4, closed_at=NOW(), updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval' AND close_requested_by_user_id <> $4 RETURNING id, business_date, opening_cash_paise, expected_cash_paise, counted_cash_paise, variance_paise, status, opened_at, closed_at, close_requested_at, approved_at")
        .bind(tenant_id).bind(branch_id).bind(drawer_session_id).bind(actor_user_id).bind(approval_note).fetch_one(&mut **tx).await
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
