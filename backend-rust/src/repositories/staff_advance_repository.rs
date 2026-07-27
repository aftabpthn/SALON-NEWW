use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

const RECORD_COLUMNS: &str = "id,staff_id,requested_amount_paise,approved_amount_paise,disbursed_amount_paise,\
outstanding_paise,installment_count,installment_amount_paise,pending_carry_forward_paise,recovery_start_period,\
reason,status,requested_by,decided_by,decided_at,decision_note,disbursed_by,disbursed_at,disbursement_method,\
disbursement_reference,waived_by,waived_at,waiver_reason,cancelled_by,cancelled_at,cancellation_reason,\
closed_at,version,created_at,updated_at";

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffAdvanceRecord {
    pub id: String,
    pub staff_id: String,
    pub requested_amount_paise: i64,
    pub approved_amount_paise: Option<i64>,
    pub disbursed_amount_paise: i64,
    pub outstanding_paise: i64,
    pub installment_count: i32,
    pub installment_amount_paise: i64,
    pub pending_carry_forward_paise: i64,
    pub recovery_start_period: NaiveDate,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_note: String,
    pub disbursed_by: Option<String>,
    pub disbursed_at: Option<DateTime<Utc>>,
    pub disbursement_method: Option<String>,
    pub disbursement_reference: String,
    pub waived_by: Option<String>,
    pub waived_at: Option<DateTime<Utc>>,
    pub waiver_reason: String,
    pub cancelled_by: Option<String>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancellation_reason: String,
    pub closed_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceRecoveryRecord {
    pub id: String,
    pub advance_id: String,
    pub payroll_run_id: String,
    pub staff_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub scheduled_paise: i64,
    pub recovered_paise: i64,
    pub carried_forward_paise: i64,
    pub outstanding_after_paise: i64,
    pub applied: bool,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
}

pub async fn create_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    requested_amount_paise: i64,
    installment_count: i32,
    recovery_start_period: NaiveDate,
    reason: &str,
) -> Result<StaffAdvanceRecord, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        INSERT INTO staff_salary_advances(
          tenant_id,branch_id,staff_id,requested_amount_paise,installment_count,
          recovery_start_period,reason,requested_by
        )
        SELECT $1,$2,$3,$4,$5,$6,$7,$8
          FROM staff
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE
        RETURNING {RECORD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(requested_amount_paise)
    .bind(installment_count)
    .bind(recovery_start_period)
    .bind(reason)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {RECORD_COLUMNS} FROM staff_salary_advances WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT {RECORD_COLUMNS} FROM staff_salary_advances
         WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR staff_id=$3) AND ($4='' OR status=$4)
         ORDER BY created_at DESC
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn decide(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
    decision: &str,
    approved_amount_paise: Option<i64>,
    note: &str,
) -> Result<Option<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_salary_advances SET
          status=$5,approved_amount_paise=$6,decided_by=$7,decided_at=NOW(),decision_note=$8,
          version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='pending'
        RETURNING {RECORD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(decision)
    .bind(approved_amount_paise)
    .bind(actor_user_id)
    .bind(note)
    .fetch_optional(db)
    .await
}

pub async fn cancel(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
    reason: &str,
) -> Result<Option<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_salary_advances SET
          status='cancelled',cancelled_by=$5,cancelled_at=NOW(),cancellation_reason=$6,
          version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status IN ('pending','approved')
        RETURNING {RECORD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(actor_user_id)
    .bind(reason)
    .fetch_optional(db)
    .await
}

pub async fn lock_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {RECORD_COLUMNS} FROM staff_salary_advances WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn disbursement_replay_exists(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM staff_salary_advances WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 \
         AND disbursement_idempotency_key=$4 AND status NOT IN ('pending','approved','rejected','cancelled'))",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(idempotency_key)
    .fetch_one(&mut **tx)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn complete_disbursement(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
    method: &str,
    reference: &str,
    idempotency_key: &str,
    amount_paise: i64,
    installment_amount_paise: i64,
) -> Result<Option<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_salary_advances SET
          status='disbursed',disbursed_amount_paise=$9,outstanding_paise=$9,installment_amount_paise=$10,
          disbursed_by=$5,disbursed_at=NOW(),disbursement_method=$6,disbursement_reference=$7,
          disbursement_idempotency_key=$8,version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND status='approved'
        RETURNING {RECORD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(actor_user_id)
    .bind(method)
    .bind(reference)
    .bind(idempotency_key)
    .bind(amount_paise)
    .bind(installment_amount_paise)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn complete_waiver(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
    note: &str,
) -> Result<Option<StaffAdvanceRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        UPDATE staff_salary_advances SET
          status='waived',outstanding_paise=0,pending_carry_forward_paise=0,
          waived_by=$5,waived_at=NOW(),waiver_reason=$6,closed_at=NOW(),version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
          AND status IN ('disbursed','recovering') AND outstanding_paise>0
        RETURNING {RECORD_COLUMNS}
        "#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(actor_user_id)
    .bind(note)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn recoveries_for_advance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    advance_id: &str,
) -> Result<Vec<AdvanceRecoveryRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,advance_id,payroll_run_id,staff_id,period_start,period_end,scheduled_paise,recovered_paise,\
         carried_forward_paise,outstanding_after_paise,applied,recorded_by,recorded_at \
         FROM staff_advance_recoveries WHERE tenant_id=$1 AND branch_id=$2 AND advance_id=$3 ORDER BY period_start DESC",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(advance_id)
    .fetch_all(db)
    .await
}
