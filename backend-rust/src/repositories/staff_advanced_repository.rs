use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IncentiveRuleRecord {
    pub id: String,
    pub target_type: String,
    pub assignee_type: String,
    pub assignee_id: String,
    pub assignee_name: String,
    pub role_scope: String,
    pub slabs: Value,
    pub notes: String,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct IncentiveRuleInput {
    pub target_type: String,
    pub assignee_type: String,
    pub assignee_id: String,
    pub assignee_name: String,
    pub role_scope: String,
    pub slabs: Value,
    pub notes: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollAdjustmentRuleRecord {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub amount_paise: i64,
    pub trigger_type: String,
    pub trigger_count: i32,
    pub application_mode: String,
    pub auto_apply: bool,
    pub notes: String,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct PayrollAdjustmentRuleInput {
    pub kind: String,
    pub name: String,
    pub amount_paise: i64,
    pub trigger_type: String,
    pub trigger_count: i32,
    pub application_mode: String,
    pub auto_apply: bool,
    pub notes: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PayrollStructureRecord {
    pub id: String,
    pub name: String,
    pub provident_fund: Value,
    pub professional_tax: Value,
    pub esic: Value,
    pub tds: Value,
    pub notes: String,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct PayrollStructureInput {
    pub name: String,
    pub provident_fund: Value,
    pub professional_tax: Value,
    pub esic: Value,
    pub tds: Value,
    pub notes: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffTaskRecord {
    pub id: String,
    pub staff_id: Option<String>,
    pub staff_name: String,
    pub title: String,
    pub description: String,
    pub task_type: String,
    pub priority: String,
    pub due_at: Option<DateTime<Utc>>,
    pub status: String,
    pub assigned_by: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StaffTaskInput {
    pub staff_id: Option<String>,
    pub title: String,
    pub description: String,
    pub task_type: String,
    pub priority: String,
    pub due_at: Option<DateTime<Utc>>,
    pub status: String,
    /// The AI action draft this task was created from, when there is one.
    ///
    /// Carried into a unique index so a retried or crashed approval finds the
    /// task it already created instead of writing a second one. Tasks created
    /// from the staff screen leave this `None`.
    pub origin_action_draft_id: Option<String>,
    pub client_id: Option<String>,
    pub appointment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffServiceTargetRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub assignment_type: String,
    pub assignment_label: String,
    pub service_id: String,
    pub service_name: String,
    pub target_count: i64,
    pub achieved_count: i64,
    pub progress_percent: i32,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
    pub reward_type: String,
    pub reward_amount_paise: i64,
    pub reward_description: String,
    pub progress_status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct StaffServiceTargetInput {
    pub assignee_type: String,
    pub assignee_value: String,
    pub service_id: String,
    pub target_count: i64,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
    pub reward_type: String,
    pub reward_amount_paise: i64,
    pub reward_description: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffTaskCommentRecord {
    pub id: String,
    pub task_id: String,
    pub actor_user_id: String,
    pub comment_text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct PerformanceSourceRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub target_revenue_paise: Option<i64>,
    pub appointments_count: i64,
    pub completed_appointments: i64,
    pub unique_clients: i64,
    pub repeat_clients: i64,
    pub revenue_paise: i64,
    pub rating: Option<f64>,
    pub present_days: i64,
    pub absent_days: i64,
    pub worked_minutes: i64,
    pub overtime_minutes: i64,
    pub late_minutes: i64,
    pub early_leave_minutes: i64,
    pub scheduled_minutes: i64,
    pub operation_task_completed: i64,
    pub operation_task_missed: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BiometricDeviceRecord {
    pub id: String,
    pub provider: String,
    pub device_code: String,
    pub device_name: String,
    pub connection_mode: String,
    pub health_status: String,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct BiometricDeviceInput {
    pub provider: String,
    pub device_code: String,
    pub device_name: String,
    pub connection_mode: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BiometricGatewayRecord {
    pub id: String,
    pub gateway_code: String,
    pub display_name: String,
    pub provider_scope: Value,
    pub version_label: String,
    pub health_status: String,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct BiometricGatewayAuthRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub api_key_hash: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BiometricMappingRecord {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub staff_id: String,
    pub staff_name: String,
    pub external_user_id: String,
    pub status: String,
    pub approved_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BiometricConsentRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub purpose: String,
    pub status: String,
    pub granted_at: Option<DateTime<Utc>>,
    pub withdrawn_at: Option<DateTime<Utc>>,
    pub deletion_requested_at: Option<DateTime<Utc>>,
    pub notes: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BiometricEventRecord {
    pub id: String,
    pub staff_id: Option<String>,
    pub external_event_id: String,
    pub punch_type: String,
    pub punch_at: DateTime<Utc>,
    pub status: String,
    pub rejection_reason: String,
    pub created_at: DateTime<Utc>,
    pub processed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffMobileDeviceRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub device_uid: String,
    pub platform: String,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffMobileDeviceAuthRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub sync_token_hash: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MobilePushSubscriptionRecord {
    pub device_id: String,
    pub push_enabled: bool,
    pub push_registered_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffMobileSyncRecord {
    pub id: String,
    pub idempotency_key: String,
    pub action_type: String,
    pub payload_hash: String,
    pub status: String,
    pub result_json: Value,
    pub created_at: DateTime<Utc>,
    pub processed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffMobileConflictRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub device_id: String,
    pub sync_request_id: String,
    pub conflict_type: String,
    pub local_payload: Value,
    pub reason_code: String,
    pub resolution: String,
    pub status: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MobileStaffSummary {
    pub id: String,
    pub employee_code: Option<String>,
    pub display_name: String,
    pub job_title: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MobileScheduleSummary {
    pub id: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub status: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MobileAttendanceSummary {
    pub id: String,
    pub business_date: NaiveDate,
    pub clock_in_at: Option<DateTime<Utc>>,
    pub clock_out_at: Option<DateTime<Utc>>,
    pub status: String,
    pub source: String,
    pub worked_minutes: i32,
    pub overtime_minutes: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MobilePayrollSummary {
    pub id: String,
    pub payroll_run_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub status: String,
    pub gross_paise: i64,
    pub deductions_paise: i64,
    pub net_paise: i64,
    pub paid_at: Option<DateTime<Utc>>,
}

pub async fn list_incentive_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    target_type: &str,
    assignee_id: &str,
    active: Option<bool>,
) -> Result<Vec<IncentiveRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,
               notes,active,version,created_at,updated_at
        FROM staff_incentive_rules
        WHERE tenant_id=$1 AND branch_id=$2
          AND ($3='' OR target_type=$3)
          AND ($4='' OR assignee_id=$4)
          AND ($5::BOOLEAN IS NULL OR active=$5)
        ORDER BY target_type,role_scope,assignee_name,id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(target_type)
    .bind(assignee_id)
    .bind(active)
    .fetch_all(db)
    .await
}

pub async fn create_incentive_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: &IncentiveRuleInput,
) -> Result<IncentiveRuleRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_incentive_rules(
          tenant_id,branch_id,target_type,assignee_type,assignee_id,assignee_name,
          role_scope,slabs,notes,active,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,
                  notes,active,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.target_type)
    .bind(&input.assignee_type)
    .bind(&input.assignee_id)
    .bind(&input.assignee_name)
    .bind(&input.role_scope)
    .bind(&input.slabs)
    .bind(&input.notes)
    .bind(input.active)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

pub async fn update_incentive_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    input: &IncentiveRuleInput,
) -> Result<Option<IncentiveRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE staff_incentive_rules SET
          target_type=$5,assignee_type=$6,assignee_id=$7,assignee_name=$8,
          role_scope=$9,slabs=$10,notes=$11,active=$12,version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
        RETURNING id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,
                  notes,active,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(&input.target_type)
    .bind(&input.assignee_type)
    .bind(&input.assignee_id)
    .bind(&input.assignee_name)
    .bind(&input.role_scope)
    .bind(&input.slabs)
    .bind(&input.notes)
    .bind(input.active)
    .fetch_optional(db)
    .await
}

pub async fn copy_incentive_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_id: &str,
    actor_user_id: &str,
    targets: &[(String, String, String)],
) -> Result<Vec<IncentiveRuleRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let source: IncentiveRuleRecord = sqlx::query_as(
        r#"
        SELECT id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,
               notes,active,version,created_at,updated_at
        FROM staff_incentive_rules WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(source_id)
    .fetch_one(&mut *tx)
    .await?;
    let mut saved = Vec::with_capacity(targets.len());
    for (assignee_type, assignee_id, assignee_name) in targets {
        saved.push(
            upsert_incentive_copy(
                &mut tx,
                tenant_id,
                branch_id,
                actor_user_id,
                &source,
                assignee_type,
                assignee_id,
                assignee_name,
            )
            .await?,
        );
    }
    tx.commit().await?;
    Ok(saved)
}

#[allow(clippy::too_many_arguments)]
async fn upsert_incentive_copy(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    source: &IncentiveRuleRecord,
    assignee_type: &str,
    assignee_id: &str,
    assignee_name: &str,
) -> Result<IncentiveRuleRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_incentive_rules(
          tenant_id,branch_id,target_type,assignee_type,assignee_id,assignee_name,
          role_scope,slabs,notes,active,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10)
        ON CONFLICT(tenant_id,branch_id,target_type,assignee_type,assignee_id,role_scope)
        DO UPDATE SET assignee_name=EXCLUDED.assignee_name,slabs=EXCLUDED.slabs,
          notes=EXCLUDED.notes,active=TRUE,version=staff_incentive_rules.version+1,updated_at=NOW()
        RETURNING id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,
                  notes,active,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&source.target_type)
    .bind(assignee_type)
    .bind(assignee_id)
    .bind(assignee_name)
    .bind(&source.role_scope)
    .bind(&source.slabs)
    .bind(&source.notes)
    .bind(actor_user_id)
    .fetch_one(&mut **tx)
    .await
}

pub async fn list_adjustment_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: &str,
    active: Option<bool>,
) -> Result<Vec<PayrollAdjustmentRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,kind,name,amount_paise,trigger_type,trigger_count,application_mode,
               auto_apply,notes,active,version,created_at,updated_at
        FROM staff_payroll_adjustment_rules
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR kind=$3)
          AND ($4::BOOLEAN IS NULL OR active=$4)
        ORDER BY kind,name,id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(kind)
    .bind(active)
    .fetch_all(db)
    .await
}

pub async fn create_adjustment_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: &PayrollAdjustmentRuleInput,
) -> Result<PayrollAdjustmentRuleRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_payroll_adjustment_rules(
          tenant_id,branch_id,kind,name,amount_paise,trigger_type,trigger_count,
          application_mode,auto_apply,notes,active,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id,kind,name,amount_paise,trigger_type,trigger_count,application_mode,
                  auto_apply,notes,active,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.kind)
    .bind(&input.name)
    .bind(input.amount_paise)
    .bind(&input.trigger_type)
    .bind(input.trigger_count)
    .bind(&input.application_mode)
    .bind(input.auto_apply)
    .bind(&input.notes)
    .bind(input.active)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

pub async fn update_adjustment_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    input: &PayrollAdjustmentRuleInput,
) -> Result<Option<PayrollAdjustmentRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE staff_payroll_adjustment_rules SET
          kind=$5,name=$6,amount_paise=$7,trigger_type=$8,trigger_count=$9,
          application_mode=$10,auto_apply=$11,notes=$12,active=$13,
          version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
        RETURNING id,kind,name,amount_paise,trigger_type,trigger_count,application_mode,
                  auto_apply,notes,active,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(&input.kind)
    .bind(&input.name)
    .bind(input.amount_paise)
    .bind(&input.trigger_type)
    .bind(input.trigger_count)
    .bind(&input.application_mode)
    .bind(input.auto_apply)
    .bind(&input.notes)
    .bind(input.active)
    .fetch_optional(db)
    .await
}

pub async fn get_payroll_structure(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<PayrollStructureRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,name,provident_fund,professional_tax,esic,tds,notes,active,
               version,created_at,updated_at
        FROM staff_payroll_structures WHERE tenant_id=$1 AND branch_id=$2
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_payroll_structure(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    version: Option<i32>,
    input: &PayrollStructureInput,
) -> Result<Option<PayrollStructureRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_payroll_structures(
          tenant_id,branch_id,name,provident_fund,professional_tax,esic,tds,
          notes,active,created_by
        ) VALUES($1,$2,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
          name=EXCLUDED.name,provident_fund=EXCLUDED.provident_fund,
          professional_tax=EXCLUDED.professional_tax,esic=EXCLUDED.esic,tds=EXCLUDED.tds,
          notes=EXCLUDED.notes,active=EXCLUDED.active,version=staff_payroll_structures.version+1,
          updated_at=NOW()
        WHERE $3::INTEGER IS NOT NULL AND staff_payroll_structures.version=$3
        RETURNING id,name,provident_fund,professional_tax,esic,tds,notes,active,
                  version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(version)
    .bind(&input.name)
    .bind(&input.provident_fund)
    .bind(&input.professional_tax)
    .bind(&input.esic)
    .bind(&input.tds)
    .bind(&input.notes)
    .bind(input.active)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await
}

pub async fn list_tasks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT t.id,t.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),'') AS staff_name,
          t.title,t.description,t.task_type,t.priority,t.due_at,t.status,t.assigned_by,
          t.completed_at,t.version,t.created_at,t.updated_at,t.client_id,t.appointment_id
        FROM staff_tasks t
        LEFT JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id
        WHERE t.tenant_id=$1 AND t.branch_id=$2
          AND ($3='' OR t.staff_id=$3)
          AND ($4='' OR t.status=$4)
        ORDER BY (t.status='completed'),t.due_at NULLS LAST,t.created_at DESC
        LIMIT 500
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: &StaffTaskInput,
) -> Result<Option<StaffTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH inserted AS (
          INSERT INTO staff_tasks(
            tenant_id,branch_id,staff_id,title,description,task_type,priority,due_at,status,
            assigned_by,completed_at,origin_action_draft_id,client_id,appointment_id
          )
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 CASE WHEN $9='completed' THEN NOW() ELSE NULL END,$11,$12,$13
          WHERE ($3::TEXT IS NULL OR EXISTS(
            SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
          ))
          AND ($12::TEXT IS NULL OR EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$12))
          AND ($13::TEXT IS NULL OR EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$13))
          -- A task already written for this draft is the same task, not a new
          -- one: a retry after a crash must not duplicate it.
          ON CONFLICT (origin_action_draft_id) WHERE origin_action_draft_id IS NOT NULL
            DO NOTHING
          RETURNING *
        )
        SELECT t.id,t.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),'') AS staff_name,
          t.title,t.description,t.task_type,t.priority,t.due_at,t.status,t.assigned_by,
          t.completed_at,t.version,t.created_at,t.updated_at,t.client_id,t.appointment_id
        FROM inserted t
        LEFT JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.staff_id)
    .bind(&input.title)
    .bind(&input.description)
    .bind(&input.task_type)
    .bind(&input.priority)
    .bind(input.due_at)
    .bind(&input.status)
    .bind(actor_user_id)
    .bind(&input.origin_action_draft_id)
    .bind(&input.client_id)
    .bind(&input.appointment_id)
    .fetch_optional(db)
    .await
}

/// Finds the task an AI action draft already produced, if any.
///
/// This is the recovery read: after a crash between the CRM write and the
/// approval, it is how the retry learns the task exists.
pub async fn task_by_action_origin(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    draft_id: &str,
) -> Result<Option<StaffTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT t.id,t.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),'') AS staff_name,
          t.title,t.description,t.task_type,t.priority,t.due_at,t.status,t.assigned_by,
          t.completed_at,t.version,t.created_at,t.updated_at,t.client_id,t.appointment_id
        FROM staff_tasks t
        LEFT JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id
        WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.origin_action_draft_id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(draft_id)
    .fetch_optional(db)
    .await
}

pub async fn list_service_targets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffServiceTargetRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH target_rows AS (
          SELECT target.id,target.staff_id,
            COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(staff.first_name || ' ' || staff.last_name),'') AS staff_name,
            target.assignment_type,target.assignment_label,target.service_id,target.service_name,target.target_count,
            COALESCE(progress.achieved_count,0)::BIGINT AS achieved_count,
            LEAST(100,COALESCE(progress.achieved_count,0)*100/target.target_count)::INTEGER AS progress_percent,
            target.starts_on,target.ends_on,target.reward_type,target.reward_amount_paise,target.reward_description,
            CASE WHEN target.status='cancelled' THEN 'cancelled'
                 WHEN COALESCE(progress.achieved_count,0)>=target.target_count THEN 'completed'
                 WHEN CURRENT_DATE>target.ends_on THEN 'expired' ELSE 'active' END AS progress_status,
            target.created_at
          FROM staff_service_targets target
          JOIN staff ON staff.tenant_id=target.tenant_id AND staff.branch_id=target.branch_id AND staff.id=target.staff_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(line.quantity),0)::BIGINT AS achieved_count
            FROM pos_sale_lines line
            JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
            WHERE line.tenant_id=target.tenant_id AND line.branch_id=target.branch_id
              AND line.line_type='service' AND line.item_id=target.service_id
              AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN target.starts_on AND target.ends_on
              AND sale.status NOT IN ('draft','cancelled','voided','refunded')
              AND (line.staff_id=target.staff_id OR EXISTS (
                SELECT 1 FROM JSONB_ARRAY_ELEMENTS(COALESCE(line.staff_splits,'[]'::JSONB)) split(value)
                WHERE split.value->>'staffId'=target.staff_id
              ))
          ) progress ON TRUE
          WHERE target.tenant_id=$1 AND target.branch_id=$2 AND ($3='' OR target.staff_id=$3)
        )
        SELECT * FROM target_rows WHERE $4='' OR progress_status=$4
        ORDER BY (progress_status='active') DESC,ends_on,staff_name,service_name,id
        LIMIT 1000
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_service_targets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: &StaffServiceTargetInput,
) -> Result<Vec<StaffServiceTargetRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH inserted AS (
          INSERT INTO staff_service_targets(
            tenant_id,branch_id,staff_id,assignment_type,assignment_label,service_id,service_name,
            target_count,starts_on,ends_on,reward_type,reward_amount_paise,reward_description,created_by
          )
          SELECT $1,$2,staff.id,$3,
            CASE WHEN $3='job_title' THEN staff.job_title ELSE COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(staff.first_name || ' ' || staff.last_name),'') END,
            service.id,service.name,$6,$7,$8,$9,$10,$11,$12
          FROM staff
          JOIN services service ON service.tenant_id=staff.tenant_id AND service.branch_id=staff.branch_id AND service.id=$5 AND service.active=TRUE
          WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
            AND (($3='staff' AND staff.id=$4) OR ($3='job_title' AND staff.job_title=$4))
          ON CONFLICT DO NOTHING
          RETURNING *
        )
        SELECT inserted.id,inserted.staff_id,
          COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(staff.first_name || ' ' || staff.last_name),'') AS staff_name,
          inserted.assignment_type,inserted.assignment_label,inserted.service_id,inserted.service_name,
          inserted.target_count,0::BIGINT AS achieved_count,0::INTEGER AS progress_percent,
          inserted.starts_on,inserted.ends_on,inserted.reward_type,inserted.reward_amount_paise,
          inserted.reward_description,'active'::TEXT AS progress_status,inserted.created_at
        FROM inserted
        JOIN staff ON staff.tenant_id=inserted.tenant_id AND staff.branch_id=inserted.branch_id AND staff.id=inserted.staff_id
        ORDER BY staff_name,inserted.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.assignee_type)
    .bind(&input.assignee_value)
    .bind(&input.service_id)
    .bind(input.target_count)
    .bind(input.starts_on)
    .bind(input.ends_on)
    .bind(&input.reward_type)
    .bind(input.reward_amount_paise)
    .bind(&input.reward_description)
    .bind(actor_user_id)
    .fetch_all(db)
    .await
}

pub async fn update_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    input: &StaffTaskInput,
) -> Result<Option<StaffTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH updated AS (
          UPDATE staff_tasks SET
            staff_id=$5,title=$6,description=$7,task_type=$8,priority=$9,due_at=$10,
            status=$11,completed_at=CASE WHEN $11='completed' THEN COALESCE(completed_at,NOW()) ELSE NULL END,
            client_id=$12,appointment_id=$13,version=version+1,updated_at=NOW()
          WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
            AND ($5::TEXT IS NULL OR EXISTS(
              SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$5
            ))
            AND ($12::TEXT IS NULL OR EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$12))
            AND ($13::TEXT IS NULL OR EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$13))
          RETURNING *
        )
        SELECT t.id,t.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),'') AS staff_name,
          t.title,t.description,t.task_type,t.priority,t.due_at,t.status,t.assigned_by,
          t.completed_at,t.version,t.created_at,t.updated_at,t.client_id,t.appointment_id
        FROM updated t
        LEFT JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(&input.staff_id)
    .bind(&input.title)
    .bind(&input.description)
    .bind(&input.task_type)
    .bind(&input.priority)
    .bind(input.due_at)
    .bind(&input.status)
    .bind(&input.client_id)
    .bind(&input.appointment_id)
    .fetch_optional(db)
    .await
}

pub async fn add_task_comment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    task_id: &str,
    actor_user_id: &str,
    comment_text: &str,
) -> Result<Option<StaffTaskCommentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_task_comments(tenant_id,branch_id,task_id,actor_user_id,comment_text)
        SELECT $1,$2,$3,$4,$5
        WHERE EXISTS(
          SELECT 1 FROM staff_tasks WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        )
        RETURNING id,task_id,actor_user_id,comment_text,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(task_id)
    .bind(actor_user_id)
    .bind(comment_text)
    .fetch_optional(db)
    .await
}

pub async fn performance_sources(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_id: &str,
) -> Result<Vec<PerformanceSourceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH appointment_metrics AS (
          SELECT staff_id,
            COUNT(*)::BIGINT AS appointments_count,
            COUNT(*) FILTER (WHERE LOWER(status) IN ('completed','billed','paid','closed'))::BIGINT AS completed_appointments
          FROM appointments
          WHERE tenant_id=$1 AND branch_id=$2
            AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
            AND staff_id<>''
          GROUP BY staff_id
        ),
        sale_metrics AS (
          SELECT l.staff_id,
            COUNT(DISTINCT s.client_id)::BIGINT AS unique_clients,
            COALESCE(SUM(l.taxable_paise),0)::BIGINT AS revenue_paise
          FROM pos_sale_lines l
          JOIN pos_sales s ON s.id=l.sale_id AND s.tenant_id=l.tenant_id AND s.branch_id=l.branch_id
          WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.business_date BETWEEN $3 AND $4
            AND l.staff_id<>'' AND LOWER(s.status) NOT IN ('void','cancelled','canceled')
          GROUP BY l.staff_id
        ),
        repeat_metrics AS (
          SELECT staff_id,COUNT(*)::BIGINT AS repeat_clients
          FROM (
            SELECT l.staff_id,s.client_id
            FROM pos_sale_lines l
            JOIN pos_sales s ON s.id=l.sale_id AND s.tenant_id=l.tenant_id AND s.branch_id=l.branch_id
            WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.business_date BETWEEN $3 AND $4
              AND l.staff_id<>'' AND s.client_id<>'' AND LOWER(s.status) NOT IN ('void','cancelled','canceled')
            GROUP BY l.staff_id,s.client_id
            HAVING COUNT(DISTINCT s.id)>1
          ) repeated
          GROUP BY staff_id
        ),
        review_metrics AS (
          SELECT staff_id,ROUND(AVG(score)::NUMERIC/20,1)::DOUBLE PRECISION AS rating
          FROM staff_performance_reviews
          WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('shared','acknowledged','closed')
            AND period_start<=$4 AND period_end>=$3
          GROUP BY staff_id
        ),
        attendance_metrics AS (
          SELECT staff_id,
            COUNT(*) FILTER (WHERE status IN ('clocked_in','clocked_out','present'))::BIGINT AS present_days,
            COUNT(*) FILTER (WHERE status='absent')::BIGINT AS absent_days,
            COALESCE(SUM(worked_minutes),0)::BIGINT AS worked_minutes,
            COALESCE(SUM(overtime_minutes),0)::BIGINT AS overtime_minutes,
            COALESCE(SUM(late_minutes),0)::BIGINT AS late_minutes,
            COALESCE(SUM(early_leave_minutes),0)::BIGINT AS early_leave_minutes
          FROM staff_attendance_records
          WHERE tenant_id=$1 AND branch_id=$2 AND business_date BETWEEN $3 AND $4
          GROUP BY staff_id
        ),
        schedule_metrics AS (
          SELECT staff_id,COALESCE(SUM(
            CASE WHEN status='working' THEN
              COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0) +
              COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0)
            ELSE 0 END
          ),0)::BIGINT AS scheduled_minutes
          FROM staff_schedules
          WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN $3 AND $4
          GROUP BY staff_id
        ), operation_task_metrics AS (
          SELECT task.staff_id,
                 COUNT(*) FILTER (WHERE schedule.operation_type IN ('deep_cleaning','hygiene_audit','cleaning_task') AND task.status IN ('completed','approved'))::BIGINT AS operation_task_completed,
                 COUNT(*) FILTER (WHERE schedule.operation_type IN ('deep_cleaning','hygiene_audit','cleaning_task') AND task.status='missed')::BIGINT AS operation_task_missed
          FROM staff_operation_tasks task
          JOIN staff_operation_schedules schedule ON schedule.tenant_id=task.tenant_id AND schedule.branch_id=task.branch_id AND schedule.id=task.operation_id
          WHERE task.tenant_id=$1 AND task.branch_id=$2 AND schedule.scheduled_date BETWEEN $3 AND $4
          GROUP BY task.staff_id
        )
        SELECT s.id AS staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          p.target_revenue_paise,
          COALESCE(a.appointments_count,0)::BIGINT AS appointments_count,
          COALESCE(a.completed_appointments,0)::BIGINT AS completed_appointments,
          COALESCE(sm.unique_clients,0)::BIGINT AS unique_clients,
          COALESCE(rm.repeat_clients,0)::BIGINT AS repeat_clients,
          COALESCE(sm.revenue_paise,0)::BIGINT AS revenue_paise,
          review.rating,
          COALESCE(am.present_days,0)::BIGINT AS present_days,
          COALESCE(am.absent_days,0)::BIGINT AS absent_days,
          COALESCE(am.worked_minutes,0)::BIGINT AS worked_minutes,
          COALESCE(am.overtime_minutes,0)::BIGINT AS overtime_minutes,
          COALESCE(am.late_minutes,0)::BIGINT AS late_minutes,
          COALESCE(am.early_leave_minutes,0)::BIGINT AS early_leave_minutes,
          COALESCE(scm.scheduled_minutes,0)::BIGINT AS scheduled_minutes,
          COALESCE(otm.operation_task_completed,0)::BIGINT AS operation_task_completed,
          COALESCE(otm.operation_task_missed,0)::BIGINT AS operation_task_missed
        FROM staff s
        LEFT JOIN staff_profiles p ON p.staff_id=s.id AND p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id
        LEFT JOIN appointment_metrics a ON a.staff_id=s.id
        LEFT JOIN sale_metrics sm ON sm.staff_id=s.id
        LEFT JOIN repeat_metrics rm ON rm.staff_id=s.id
        LEFT JOIN review_metrics review ON review.staff_id=s.id
        LEFT JOIN attendance_metrics am ON am.staff_id=s.id
        LEFT JOIN schedule_metrics scm ON scm.staff_id=s.id
        LEFT JOIN operation_task_metrics otm ON otm.staff_id=s.id
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE
          AND ($5='' OR s.id=$5)
        ORDER BY staff_name,s.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(date_from)
    .bind(date_to)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn list_biometric_devices(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricDeviceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,provider,device_code,device_name,connection_mode,health_status,last_seen_at,
               active,version,created_at,updated_at
        FROM staff_biometric_devices
        WHERE tenant_id=$1 AND branch_id=$2
        ORDER BY active DESC,device_name,device_code
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_biometric_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: &BiometricDeviceInput,
) -> Result<BiometricDeviceRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_biometric_devices(
          tenant_id,branch_id,provider,device_code,device_name,connection_mode,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7)
        RETURNING id,provider,device_code,device_name,connection_mode,health_status,last_seen_at,
                  active,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&input.provider)
    .bind(&input.device_code)
    .bind(&input.device_name)
    .bind(&input.connection_mode)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

pub async fn create_biometric_gateway(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    gateway_code: &str,
    display_name: &str,
    api_key_hash: &str,
    provider_scope: &Value,
    version_label: &str,
) -> Result<BiometricGatewayRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_biometric_gateways(
          tenant_id,branch_id,gateway_code,display_name,api_key_hash,provider_scope,
          version_label,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id,gateway_code,display_name,provider_scope,version_label,health_status,
                  last_seen_at,active,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(gateway_code)
    .bind(display_name)
    .bind(api_key_hash)
    .bind(provider_scope)
    .bind(version_label)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

pub async fn list_biometric_gateways(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricGatewayRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,gateway_code,display_name,provider_scope,version_label,health_status,
               last_seen_at,active,created_at
        FROM staff_biometric_gateways
        WHERE tenant_id=$1 AND branch_id=$2
        ORDER BY active DESC,COALESCE(last_seen_at,created_at) DESC,gateway_code
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn biometric_gateway_auth(
    db: &PgPool,
    gateway_id: &str,
) -> Result<Option<BiometricGatewayAuthRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,tenant_id,branch_id,api_key_hash,active FROM staff_biometric_gateways WHERE id=$1",
    )
    .bind(gateway_id)
    .fetch_optional(db)
    .await
}

pub async fn heartbeat_biometric_gateway(
    db: &PgPool,
    gateway_id: &str,
    version_label: &str,
) -> Result<Option<BiometricGatewayRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE staff_biometric_gateways SET health_status='online',last_seen_at=NOW(),
          version_label=CASE WHEN $2='' THEN version_label ELSE $2 END,updated_at=NOW()
        WHERE id=$1 AND active=TRUE
        RETURNING id,gateway_code,display_name,provider_scope,version_label,health_status,
                  last_seen_at,active,created_at
        "#,
    )
    .bind(gateway_id)
    .bind(version_label)
    .fetch_optional(db)
    .await
}

pub async fn list_biometric_mappings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricMappingRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT m.id,m.device_id,d.device_name,m.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          m.external_user_id,m.status,m.approved_at,m.version,m.created_at
        FROM staff_biometric_mappings m
        JOIN staff_biometric_devices d ON d.id=m.device_id AND d.tenant_id=m.tenant_id AND d.branch_id=m.branch_id
        JOIN staff s ON s.id=m.staff_id AND s.tenant_id=m.tenant_id AND s.branch_id=m.branch_id
        WHERE m.tenant_id=$1 AND m.branch_id=$2
        ORDER BY m.status,m.created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_biometric_mapping(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    device_id: &str,
    staff_id: &str,
    external_user_id: &str,
) -> Result<Option<BiometricMappingRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH inserted AS (
          INSERT INTO staff_biometric_mappings(
            tenant_id,branch_id,device_id,staff_id,external_user_id,created_by
          )
          SELECT $1,$2,$3,$4,$5,$6
          WHERE EXISTS(SELECT 1 FROM staff_biometric_devices WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)
            AND EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$4 AND active=TRUE)
          RETURNING *
        )
        SELECT m.id,m.device_id,d.device_name,m.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          m.external_user_id,m.status,m.approved_at,m.version,m.created_at
        FROM inserted m
        JOIN staff_biometric_devices d ON d.id=m.device_id
        JOIN staff s ON s.id=m.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(device_id)
    .bind(staff_id)
    .bind(external_user_id)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await
}

pub async fn approve_biometric_mapping(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    actor_user_id: &str,
) -> Result<Option<BiometricMappingRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH updated AS (
          UPDATE staff_biometric_mappings SET status='approved',approved_by=$5,
            approved_at=NOW(),version=version+1,updated_at=NOW()
          WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
          RETURNING *
        )
        SELECT m.id,m.device_id,d.device_name,m.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          m.external_user_id,m.status,m.approved_at,m.version,m.created_at
        FROM updated m
        JOIN staff_biometric_devices d ON d.id=m.device_id
        JOIN staff s ON s.id=m.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await
}

pub async fn list_biometric_consents(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<BiometricConsentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT c.id,c.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          c.purpose,c.status,c.granted_at,c.withdrawn_at,c.deletion_requested_at,
          c.notes,c.version,c.created_at,c.updated_at
        FROM staff_biometric_consents c
        JOIN staff s ON s.id=c.staff_id AND s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id
        WHERE c.tenant_id=$1 AND c.branch_id=$2
        ORDER BY staff_name,c.purpose
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn upsert_biometric_consent(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    staff_id: &str,
    purpose: &str,
    status: &str,
    notes: &str,
    version: Option<i32>,
) -> Result<Option<BiometricConsentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH changed AS (
          INSERT INTO staff_biometric_consents(
            tenant_id,branch_id,staff_id,purpose,status,granted_at,withdrawn_at,notes,created_by
          )
          SELECT $1,$2,$3,$4,$5,
            CASE WHEN $5='granted' THEN NOW() ELSE NULL END,
            CASE WHEN $5='withdrawn' THEN NOW() ELSE NULL END,$6,$7
          WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)
          ON CONFLICT(tenant_id,branch_id,staff_id,purpose) DO UPDATE SET
            status=EXCLUDED.status,
            granted_at=CASE WHEN EXCLUDED.status='granted' THEN NOW() ELSE staff_biometric_consents.granted_at END,
            withdrawn_at=CASE WHEN EXCLUDED.status='withdrawn' THEN NOW() ELSE staff_biometric_consents.withdrawn_at END,
            notes=EXCLUDED.notes,version=staff_biometric_consents.version+1,updated_at=NOW()
          WHERE $8::INTEGER IS NOT NULL AND staff_biometric_consents.version=$8
          RETURNING *
        )
        SELECT c.id,c.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          c.purpose,c.status,c.granted_at,c.withdrawn_at,c.deletion_requested_at,
          c.notes,c.version,c.created_at,c.updated_at
        FROM changed c JOIN staff s ON s.id=c.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(purpose)
    .bind(status)
    .bind(notes)
    .bind(actor_user_id)
    .bind(version)
    .fetch_optional(db)
    .await
}

pub async fn request_biometric_deletion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
) -> Result<Option<BiometricConsentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH changed AS (
          UPDATE staff_biometric_consents SET status='deletion_requested',
            deletion_requested_at=NOW(),version=version+1,updated_at=NOW()
          WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
          RETURNING *
        )
        SELECT c.id,c.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          c.purpose,c.status,c.granted_at,c.withdrawn_at,c.deletion_requested_at,
          c.notes,c.version,c.created_at,c.updated_at
        FROM changed c JOIN staff s ON s.id=c.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .fetch_optional(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn record_biometric_event(
    db: &PgPool,
    gateway: &BiometricGatewayAuthRecord,
    device_code: &str,
    external_user_id: &str,
    external_event_id: &str,
    punch_type: &str,
    punch_at: DateTime<Utc>,
    payload_hash: &str,
) -> Result<Option<BiometricEventRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let device_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM staff_biometric_devices WHERE tenant_id=$1 AND branch_id=$2 AND device_code=$3 AND active=TRUE FOR SHARE",
    )
    .bind(&gateway.tenant_id)
    .bind(&gateway.branch_id)
    .bind(device_code)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(device_id) = device_id else {
        tx.rollback().await?;
        return Ok(None);
    };
    let staff_id = sqlx::query_scalar::<_, String>(
        "SELECT staff_id FROM staff_biometric_mappings WHERE tenant_id=$1 AND branch_id=$2 AND device_id=$3 AND external_user_id=$4 AND status='approved' FOR SHARE",
    )
    .bind(&gateway.tenant_id)
    .bind(&gateway.branch_id)
    .bind(&device_id)
    .bind(external_user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let consent_granted = if let Some(staff_id) = staff_id.as_deref() {
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM staff_biometric_consents WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND purpose='attendance' FOR SHARE",
        )
        .bind(&gateway.tenant_id)
        .bind(&gateway.branch_id)
        .bind(staff_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some_and(|status| status == "granted")
    } else {
        false
    };
    let (status, reason) = if staff_id.is_none() {
        ("rejected", "mapping_not_approved")
    } else if !consent_granted {
        ("rejected", "consent_not_granted")
    } else {
        ("received", "")
    };
    let event = sqlx::query_as(
        r#"
        INSERT INTO staff_biometric_events(
          tenant_id,branch_id,gateway_id,device_id,staff_id,external_user_id,
          external_event_id,punch_type,punch_at,payload_hash,status,rejection_reason
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(tenant_id,gateway_id,external_event_id) DO NOTHING
        RETURNING id,staff_id,external_event_id,punch_type,punch_at,status,rejection_reason,
                  created_at,processed_at
        "#,
    )
    .bind(&gateway.tenant_id)
    .bind(&gateway.branch_id)
    .bind(&gateway.id)
    .bind(device_id)
    .bind(staff_id)
    .bind(external_user_id)
    .bind(external_event_id)
    .bind(punch_type)
    .bind(punch_at)
    .bind(payload_hash)
    .bind(status)
    .bind(reason)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(event)
}

pub async fn set_biometric_event_status(
    db: &PgPool,
    event_id: &str,
    status: &str,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE staff_biometric_events SET status=$2,rejection_reason=$3,processed_at=NOW() WHERE id=$1",
    )
    .bind(event_id)
    .bind(status)
    .bind(reason)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn get_biometric_event(
    db: &PgPool,
    tenant_id: &str,
    gateway_id: &str,
    external_event_id: &str,
) -> Result<Option<BiometricEventRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,staff_id,external_event_id,punch_type,punch_at,status,rejection_reason,
               created_at,processed_at
        FROM staff_biometric_events
        WHERE tenant_id=$1 AND gateway_id=$2 AND external_event_id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(gateway_id)
    .bind(external_event_id)
    .fetch_optional(db)
    .await
}

pub async fn list_biometric_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    exceptions_only: bool,
) -> Result<Vec<BiometricEventRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,staff_id,external_event_id,punch_type,punch_at,status,rejection_reason,
               created_at,processed_at
        FROM staff_biometric_events
        WHERE tenant_id=$1 AND branch_id=$2
          AND ($3='' OR status=$3)
          AND (NOT $4 OR status IN ('ignored','rejected'))
        ORDER BY punch_at DESC,created_at DESC
        LIMIT 1000
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .bind(exceptions_only)
    .fetch_all(db)
    .await
}

pub async fn register_mobile_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    device_uid: &str,
    platform: &str,
    sync_token_hash: &str,
) -> Result<Option<StaffMobileDeviceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH changed AS (
          INSERT INTO staff_mobile_devices(
            tenant_id,branch_id,staff_id,device_uid,platform,sync_token_hash
          )
          SELECT $1,$2,$3,$4,$5,$6
          WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)
          ON CONFLICT(tenant_id,device_uid) DO UPDATE SET
            branch_id=EXCLUDED.branch_id,staff_id=EXCLUDED.staff_id,platform=EXCLUDED.platform,
            sync_token_hash=EXCLUDED.sync_token_hash,active=TRUE,version=staff_mobile_devices.version+1,
            updated_at=NOW()
          RETURNING *
        )
        SELECT d.id,d.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          d.device_uid,d.platform,d.last_sync_at,d.active,d.version,d.created_at
        FROM changed d JOIN staff s ON s.id=d.staff_id AND s.tenant_id=d.tenant_id AND s.branch_id=d.branch_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(device_uid)
    .bind(platform)
    .bind(sync_token_hash)
    .fetch_optional(db)
    .await
}

pub async fn mobile_device_auth(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    device_id: &str,
) -> Result<Option<StaffMobileDeviceAuthRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,tenant_id,branch_id,staff_id,sync_token_hash,active
        FROM staff_mobile_devices
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(device_id)
    .fetch_optional(db)
    .await
}

pub async fn record_mobile_device_telemetry(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    user_id: &str,
    device_uid: &str,
    platform: &str,
    app_version: &str,
    event_type: &str,
    network_type: &str,
    online: bool,
    metadata: &Value,
    occurred_at: DateTime<Utc>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"INSERT INTO staff_mobile_device_telemetry
           (tenant_id,branch_id,staff_id,user_id,device_uid,platform,app_version,event_type,network_type,online,metadata_json,occurred_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
           WHERE EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(user_id)
    .bind(device_uid)
    .bind(platform)
    .bind(app_version)
    .bind(event_type)
    .bind(network_type)
    .bind(online)
    .bind(metadata)
    .bind(occurred_at)
    .fetch_one(db)
    .await
}

pub async fn list_mobile_device_telemetry(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
             'id',telemetry.id,'staffId',telemetry.staff_id,
             'staffName',COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),staff.id),
             'deviceUid',telemetry.device_uid,'platform',telemetry.platform,'appVersion',telemetry.app_version,
             'eventType',telemetry.event_type,'networkType',telemetry.network_type,'online',telemetry.online,
             'metadata',telemetry.metadata_json,'occurredAt',telemetry.occurred_at
           )
           FROM staff_mobile_device_telemetry telemetry
           JOIN staff ON staff.tenant_id=telemetry.tenant_id AND staff.branch_id=telemetry.branch_id AND staff.id=telemetry.staff_id
           WHERE telemetry.tenant_id=$1 AND telemetry.branch_id=$2
           ORDER BY telemetry.occurred_at DESC LIMIT 500"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn save_mobile_push_subscription(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    device_id: &str,
    token_ciphertext: Option<&str>,
    token_fingerprint: Option<&str>,
    subscription_json: &Value,
    enabled: bool,
) -> Result<Option<MobilePushSubscriptionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE staff_mobile_devices
              SET push_token_ciphertext=$4,push_token_fingerprint=$5,push_subscription_json=$6,push_enabled=$7,
                  push_registered_at=CASE WHEN $7 THEN NOW() ELSE push_registered_at END,
                  updated_at=NOW(),version=version+1
            WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE
            RETURNING id AS device_id,push_enabled,push_registered_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(device_id)
    .bind(token_ciphertext)
    .bind(token_fingerprint)
    .bind(subscription_json)
    .bind(enabled)
    .fetch_optional(db)
    .await
}

pub async fn mobile_staff_summary(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
) -> Result<Option<MobileStaffSummary>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,employee_code,
          COALESCE(NULLIF(appointment_display_name,''),NULLIF(TRIM(CONCAT_WS(' ',first_name,last_name)),''),id) AS display_name,
          job_title
        FROM staff
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE
        "#,
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .fetch_optional(db)
    .await
}

pub async fn mobile_schedule(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
    business_date: NaiveDate,
) -> Result<Option<MobileScheduleSummary>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,schedule_date,shift1_start,shift1_end,shift2_start,shift2_end,status,notes FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date=$4",
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .bind(business_date)
    .fetch_optional(db)
    .await
}

pub async fn mobile_attendance(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
    business_date: NaiveDate,
) -> Result<Option<MobileAttendanceSummary>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,business_date,clock_in_at,clock_out_at,status,source,worked_minutes,overtime_minutes FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date=$4",
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .bind(business_date)
    .fetch_optional(db)
    .await
}

pub async fn mobile_tasks(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
) -> Result<Vec<StaffTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT t.id,t.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),'') AS staff_name,
          t.title,t.description,t.task_type,t.priority,t.due_at,t.status,t.assigned_by,
          t.completed_at,t.version,t.created_at,t.updated_at,t.client_id,t.appointment_id
        FROM staff_tasks t
        LEFT JOIN staff s ON s.id=t.staff_id AND s.tenant_id=t.tenant_id AND s.branch_id=t.branch_id
        WHERE t.tenant_id=$1 AND t.branch_id=$2 AND t.staff_id=$3
          AND t.status IN ('open','in_progress','blocked')
        ORDER BY t.due_at NULLS LAST,t.created_at DESC
        LIMIT 50
        "#,
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .fetch_all(db)
    .await
}

pub async fn mobile_payroll(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
) -> Result<Vec<MobilePayrollSummary>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT item.id,item.payroll_run_id,run.period_start,run.period_end,item.status,
          item.gross_paise,item.deductions_paise,item.net_paise,run.paid_at
        FROM staff_payroll_items item
        JOIN staff_payroll_runs run ON run.id=item.payroll_run_id
          AND run.tenant_id=item.tenant_id AND run.branch_id=item.branch_id
        WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3
        ORDER BY run.period_end DESC,item.created_at DESC
        LIMIT 12
        "#,
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .fetch_all(db)
    .await
}

pub async fn mobile_targets(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
) -> Result<Vec<IncentiveRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,notes,
          active,version,created_at,updated_at
        FROM staff_incentive_rules
        WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
          AND ((assignee_type='staff' AND assignee_id=$3) OR assignee_type IN ('branch','standard'))
        ORDER BY target_type,assignee_type,created_at DESC
        "#,
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .fetch_all(db)
    .await
}

pub async fn self_targets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<IncentiveRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,target_type,assignee_type,assignee_id,assignee_name,role_scope,slabs,notes,
          active,version,created_at,updated_at
        FROM staff_incentive_rules
        WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
          AND ((assignee_type='staff' AND assignee_id=$3) OR assignee_type IN ('branch','standard'))
        ORDER BY target_type,assignee_type,created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn update_self_task_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    id: &str,
    version: i32,
    status: &str,
) -> Result<Option<StaffTaskRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as(
        r#"
        UPDATE staff_tasks SET
          status=$6,
          completed_at=CASE WHEN $6='completed' THEN NOW() ELSE NULL END,
          version=version+1,
          updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND version=$5
        RETURNING id,staff_id,''::TEXT AS staff_name,title,description,task_type,priority,due_at,status,
          assigned_by,completed_at,version,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(id)
    .bind(version)
    .bind(status)
    .fetch_optional(&mut *tx)
    .await?;
    if status == "completed" {
        sqlx::query(
            "UPDATE staff_coaching_goals goal SET status='completed',version=version+1,updated_at=NOW() WHERE goal.tenant_id=$1 AND goal.branch_id=$2 AND goal.status='active' AND EXISTS(SELECT 1 FROM staff_tasks task WHERE task.tenant_id=$1 AND task.branch_id=$2 AND task.id=$3 AND task.coaching_goal_id=goal.id) AND NOT EXISTS(SELECT 1 FROM staff_tasks open_task WHERE open_task.tenant_id=$1 AND open_task.branch_id=$2 AND open_task.coaching_goal_id=goal.id AND open_task.status NOT IN ('completed','cancelled'))",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(row)
}

pub async fn begin_mobile_sync(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
    action_type: &str,
    idempotency_key: &str,
    payload_hash: &str,
) -> Result<Option<StaffMobileSyncRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO staff_mobile_sync_requests(
          tenant_id,branch_id,staff_id,device_id,action_type,idempotency_key,payload_hash
        ) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(tenant_id,device_id,idempotency_key) DO NOTHING
        RETURNING id,idempotency_key,action_type,payload_hash,status,result_json,created_at,processed_at
        "#,
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .bind(&device.id)
    .bind(action_type)
    .bind(idempotency_key)
    .bind(payload_hash)
    .fetch_optional(db)
    .await
}

pub async fn get_mobile_sync(
    db: &PgPool,
    tenant_id: &str,
    device_id: &str,
    idempotency_key: &str,
) -> Result<Option<StaffMobileSyncRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,idempotency_key,action_type,payload_hash,status,result_json,created_at,processed_at
        FROM staff_mobile_sync_requests
        WHERE tenant_id=$1 AND device_id=$2 AND idempotency_key=$3
        "#,
    )
    .bind(tenant_id)
    .bind(device_id)
    .bind(idempotency_key)
    .fetch_optional(db)
    .await
}

pub async fn finish_mobile_sync(
    db: &PgPool,
    sync_id: &str,
    device_id: &str,
    status: &str,
    result_json: &Value,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE staff_mobile_sync_requests SET status=$2,result_json=$3,processed_at=NOW() WHERE id=$1",
    )
    .bind(sync_id)
    .bind(status)
    .bind(result_json)
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE staff_mobile_devices SET last_sync_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn create_mobile_conflict(
    db: &PgPool,
    device: &StaffMobileDeviceAuthRecord,
    sync_request_id: &str,
    conflict_type: &str,
    local_payload: &Value,
    reason_code: &str,
) -> Result<StaffMobileConflictRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH inserted AS (
          INSERT INTO staff_mobile_conflicts(
            tenant_id,branch_id,staff_id,device_id,sync_request_id,conflict_type,
            local_payload,reason_code
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
        )
        SELECT c.id,c.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          c.device_id,c.sync_request_id,c.conflict_type,c.local_payload,c.reason_code,
          c.resolution,c.status,c.version,c.created_at,c.resolved_at
        FROM inserted c JOIN staff s ON s.id=c.staff_id
        "#,
    )
    .bind(&device.tenant_id)
    .bind(&device.branch_id)
    .bind(&device.staff_id)
    .bind(&device.id)
    .bind(sync_request_id)
    .bind(conflict_type)
    .bind(local_payload)
    .bind(reason_code)
    .fetch_one(db)
    .await
}

pub async fn list_mobile_conflicts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<StaffMobileConflictRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT c.id,c.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          c.device_id,c.sync_request_id,c.conflict_type,c.local_payload,c.reason_code,
          c.resolution,c.status,c.version,c.created_at,c.resolved_at
        FROM staff_mobile_conflicts c
        JOIN staff s ON s.id=c.staff_id AND s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id
        WHERE c.tenant_id=$1 AND c.branch_id=$2 AND ($3='' OR c.status=$3)
        ORDER BY c.created_at DESC LIMIT 500
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn resolve_mobile_conflict(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    version: i32,
    resolution: &str,
    actor_user_id: &str,
) -> Result<Option<StaffMobileConflictRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH changed AS (
          UPDATE staff_mobile_conflicts SET resolution=$5,status='resolved',resolved_by=$6,
            resolved_at=NOW(),version=version+1,updated_at=NOW()
          WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
          RETURNING *
        )
        SELECT c.id,c.staff_id,
          COALESCE(NULLIF(s.appointment_display_name,''),TRIM(s.first_name || ' ' || s.last_name),s.id) AS staff_name,
          c.device_id,c.sync_request_id,c.conflict_type,c.local_payload,c.reason_code,
          c.resolution,c.status,c.version,c.created_at,c.resolved_at
        FROM changed c JOIN staff s ON s.id=c.staff_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .bind(resolution)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await
}

pub async fn complete_mobile_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    task_id: &str,
    version: i32,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        r#"
        UPDATE staff_tasks SET status='completed',completed_at=NOW(),version=version+1,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4 AND version=$5
          AND status NOT IN ('completed','cancelled')
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(task_id)
    .bind(version)
    .execute(db)
    .await?
    .rows_affected()
        == 1)
}

pub async fn update_mobile_appointment_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    appointment_id: &str,
    target_status: &str,
) -> Result<bool, sqlx::Error> {
    let allowed_previous = if target_status == "in-service" {
        vec!["booked", "confirmed", "arrived"]
    } else {
        vec!["in-service", "arrived"]
    };
    Ok(sqlx::query(
        "UPDATE appointments SET status=$1,version=version+1,updated_at=NOW()
         WHERE tenant_id=$2 AND branch_id=$3 AND staff_id=$4 AND id=$5 AND status=ANY($6)",
    )
    .bind(target_status)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(appointment_id)
    .bind(allowed_previous)
    .execute(db)
    .await?
    .rows_affected()
        == 1)
}
