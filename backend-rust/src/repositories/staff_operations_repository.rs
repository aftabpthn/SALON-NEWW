use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSwapRecord {
    pub id: String,
    pub schedule_id: String,
    pub schedule_date: NaiveDate,
    pub shift1_start: Option<NaiveTime>,
    pub shift1_end: Option<NaiveTime>,
    pub from_staff_id: String,
    pub from_staff_name: String,
    pub to_staff_id: String,
    pub to_staff_name: String,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub decision_note: String,
    pub decided_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BranchTransferRecord {
    pub id: String,
    pub source_branch_id: String,
    pub source_branch_name: String,
    pub target_branch_id: String,
    pub target_branch_name: String,
    pub staff_id: String,
    pub staff_name: String,
    pub role_id: String,
    pub role_name: String,
    pub transfer_type: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub reason: String,
    pub status: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub decision_note: String,
    pub decided_at: Option<DateTime<Utc>>,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SkillLicenseRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub skill_name: String,
    pub issuer: String,
    pub license_number: String,
    pub issued_on: Option<NaiveDate>,
    pub expires_on: Option<NaiveDate>,
    pub verification_status: String,
    pub document_url: String,
    pub notes: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceReviewRecord {
    pub id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub reviewer_user_id: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub score: Option<i32>,
    pub strengths: String,
    pub improvement_areas: String,
    pub goals: String,
    pub employee_comments: String,
    pub status: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub shared_at: Option<DateTime<Utc>>,
    pub acknowledged_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffOperationTemplateRecord {
    pub id: String,
    pub name: String,
    pub operation_type: String,
    pub frequency: String,
    pub checklist_json: Value,
    pub active: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffOperationScheduleRecord {
    pub id: String,
    pub template_id: Option<String>,
    pub title: String,
    pub operation_type: String,
    pub frequency: String,
    pub scheduled_date: NaiveDate,
    pub scheduled_time: Option<NaiveTime>,
    pub assigned_staff_ids: Value,
    pub owner_user_id: String,
    pub status: String,
    pub checklist_json: Value,
    pub notes: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cancelled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffOperationTaskRecord {
    pub id: String,
    pub operation_id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub task_title: String,
    pub status: String,
    pub proof_url: String,
    pub notes: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffOperationAttendanceRecord {
    pub id: String,
    pub operation_id: String,
    pub staff_id: String,
    pub staff_name: String,
    pub status: String,
    pub recorded_by: String,
    pub recorded_at: DateTime<Utc>,
    pub notes: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OperationReportOperationRow {
    pub id: String,
    pub title: String,
    pub operation_type: String,
    pub scheduled_date: NaiveDate,
    pub scheduled_time: Option<NaiveTime>,
    pub status: String,
    pub assigned_staff_count: i64,
    pub completed_task_count: i64,
    pub missed_task_count: i64,
    pub pending_approval_count: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OperationMeetingAttendanceRow {
    pub staff_id: String,
    pub staff_name: String,
    pub present_count: i64,
    pub absent_count: i64,
    pub late_count: i64,
    pub excused_count: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OperationCleaningScoreRow {
    pub staff_id: String,
    pub staff_name: String,
    pub completed_count: i64,
    pub missed_count: i64,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OperationHygieneComplianceRow {
    pub operation_type: String,
    pub planned_count: i64,
    pub completed_count: i64,
    pub missed_count: i64,
    pub compliance_percent: f64,
}

#[derive(Debug, Clone, FromRow)]
pub struct OperationAutomationTargetRow {
    pub operation_id: String,
    pub task_id: Option<String>,
    pub staff_id: String,
    pub staff_name: String,
    pub mobile_phone: String,
    pub title: String,
    pub operation_type: String,
    pub scheduled_date: NaiveDate,
    pub status: String,
}
const SWAP_COLUMNS: &str = r#"
  swap.id,swap.schedule_id,schedule.schedule_date,schedule.shift1_start,schedule.shift1_end,
  swap.from_staff_id,TRIM(CONCAT_WS(' ',source.first_name,NULLIF(source.last_name,''))) AS from_staff_name,
  swap.to_staff_id,TRIM(CONCAT_WS(' ',target.first_name,NULLIF(target.last_name,''))) AS to_staff_name,
  swap.reason,swap.status,swap.requested_by,swap.decided_by,swap.decision_note,swap.decided_at,
  swap.version,swap.created_at
"#;

pub async fn list_shift_swaps(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<ShiftSwapRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {SWAP_COLUMNS} FROM staff_shift_swap_requests swap
         JOIN staff_schedules schedule ON schedule.id=swap.schedule_id
         JOIN staff source ON source.id=swap.from_staff_id
         JOIN staff target ON target.id=swap.to_staff_id
         WHERE swap.tenant_id=$1 AND swap.branch_id=$2 AND ($3='' OR swap.status=$3)
         ORDER BY swap.created_at DESC"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_shift_swap(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    schedule_id: &str,
    to_staff_id: &str,
    reason: &str,
    actor_user_id: &str,
) -> Result<Option<ShiftSwapRecord>, sqlx::Error> {
    let id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO staff_shift_swap_requests(
          tenant_id,branch_id,schedule_id,from_staff_id,to_staff_id,reason,requested_by
        )
        SELECT $1,$2,schedule.id,schedule.staff_id,target.id,$5,$6
        FROM staff_schedules schedule
        JOIN staff target ON target.tenant_id=$1 AND target.branch_id=$2 AND target.id=$4 AND target.active=TRUE
        WHERE schedule.tenant_id=$1 AND schedule.branch_id=$2 AND schedule.id=$3
          AND schedule.staff_id<>target.id
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(schedule_id)
    .bind(to_staff_id)
    .bind(reason)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await?;
    match id {
        Some(id) => get_shift_swap(db, tenant_id, branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn decide_shift_swap(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    decision: &str,
    note: &str,
    actor_user_id: &str,
    version: i32,
) -> Result<Option<ShiftSwapRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let swap = sqlx::query_as::<_, (String, String, NaiveDate)>(
        r#"SELECT swap.schedule_id,swap.to_staff_id,schedule.schedule_date
           FROM staff_shift_swap_requests swap
           JOIN staff_schedules schedule ON schedule.id=swap.schedule_id
           WHERE swap.tenant_id=$1 AND swap.branch_id=$2 AND swap.id=$3
             AND swap.status='pending' AND swap.version=$4 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(version)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((schedule_id, to_staff_id, schedule_date)) = swap else {
        tx.rollback().await?;
        return Ok(None);
    };
    if decision == "approved" {
        let conflict = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date=$4 AND id<>$5)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&to_staff_id)
        .bind(schedule_date)
        .bind(&schedule_id)
        .fetch_one(&mut *tx)
        .await?;
        if conflict {
            return Err(sqlx::Error::Protocol(
                "target employee already has a schedule for this date".into(),
            ));
        }
        sqlx::query("UPDATE staff_schedules SET staff_id=$1,updated_at=NOW() WHERE id=$2")
            .bind(&to_staff_id)
            .bind(&schedule_id)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query(
        "UPDATE staff_shift_swap_requests SET status=$1,decision_note=$2,decided_by=$3,decided_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$4",
    )
    .bind(decision)
    .bind(note)
    .bind(actor_user_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    get_shift_swap(db, tenant_id, branch_id, id).await
}

async fn get_shift_swap(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<ShiftSwapRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {SWAP_COLUMNS} FROM staff_shift_swap_requests swap
         JOIN staff_schedules schedule ON schedule.id=swap.schedule_id
         JOIN staff source ON source.id=swap.from_staff_id
         JOIN staff target ON target.id=swap.to_staff_id
         WHERE swap.tenant_id=$1 AND swap.branch_id=$2 AND swap.id=$3"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

const TRANSFER_COLUMNS: &str = r#"
  transfer.id,transfer.source_branch_id,source.name AS source_branch_name,
  transfer.target_branch_id,target.name AS target_branch_name,transfer.staff_id,
  TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))) AS staff_name,
  transfer.role_id,role.name AS role_name,transfer.transfer_type,transfer.valid_from,transfer.valid_until,
  transfer.reason,transfer.status,transfer.requested_by,transfer.decided_by,transfer.decision_note,
  transfer.decided_at,transfer.version,transfer.created_at
"#;

pub async fn list_branch_transfers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<BranchTransferRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {TRANSFER_COLUMNS} FROM staff_branch_transfer_requests transfer
         JOIN branches source ON source.id=transfer.source_branch_id AND source.tenant_id=transfer.tenant_id
         JOIN branches target ON target.id=transfer.target_branch_id AND target.tenant_id=transfer.tenant_id
         JOIN staff ON staff.id=transfer.staff_id
         JOIN roles role ON role.id=transfer.role_id AND role.tenant_id=transfer.tenant_id
         WHERE transfer.tenant_id=$1 AND transfer.source_branch_id=$2 AND ($3='' OR transfer.status=$3)
         ORDER BY transfer.created_at DESC"
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_branch_transfer(
    db: &PgPool,
    tenant_id: &str,
    source_branch_id: &str,
    target_branch_id: &str,
    staff_id: &str,
    role_id: &str,
    transfer_type: &str,
    valid_from: Option<NaiveDate>,
    valid_until: Option<NaiveDate>,
    reason: &str,
    actor_user_id: &str,
) -> Result<Option<BranchTransferRecord>, sqlx::Error> {
    let id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO staff_branch_transfer_requests(
          tenant_id,source_branch_id,target_branch_id,staff_id,role_id,transfer_type,
          valid_from,valid_until,reason,requested_by
        )
        SELECT $1,$2,target.id,staff.id,role.id,$6,$7,$8,$9,$10
        FROM staff
        JOIN branches target ON target.tenant_id=$1 AND target.id=$3 AND target.active=TRUE
        JOIN roles role ON role.tenant_id=$1 AND role.id=$5
        WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$4 AND staff.active=TRUE
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(source_branch_id)
    .bind(target_branch_id)
    .bind(staff_id)
    .bind(role_id)
    .bind(transfer_type)
    .bind(valid_from)
    .bind(valid_until)
    .bind(reason)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await?;
    match id {
        Some(id) => get_branch_transfer(db, tenant_id, source_branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn decide_branch_transfer(
    db: &PgPool,
    tenant_id: &str,
    source_branch_id: &str,
    id: &str,
    decision: &str,
    note: &str,
    actor_user_id: &str,
    version: i32,
) -> Result<Option<BranchTransferRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let transfer = sqlx::query_as::<_, (String, String, String, String, String, Option<NaiveDate>, Option<NaiveDate>)>(
        r#"SELECT staff_id,target_branch_id,role_id,transfer_type,source_branch_id,valid_from,valid_until
           FROM staff_branch_transfer_requests
           WHERE tenant_id=$1 AND source_branch_id=$2 AND id=$3 AND status='pending' AND version=$4
           FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(source_branch_id)
    .bind(id)
    .bind(version)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((
        staff_id,
        target_branch_id,
        role_id,
        transfer_type,
        source_branch_id,
        valid_from,
        valid_until,
    )) = transfer
    else {
        tx.rollback().await?;
        return Ok(None);
    };
    if decision == "approved" {
        let user_id = sqlx::query_scalar::<_, Option<String>>(
            "SELECT user_id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
        )
        .bind(tenant_id)
        .bind(&source_branch_id)
        .bind(&staff_id)
        .fetch_one(&mut *tx)
        .await?;
        if let Some(user_id) = user_id.filter(|value| !value.is_empty()) {
            if transfer_type == "permanent" {
                sqlx::query("UPDATE user_branch_roles SET is_default=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND is_default=TRUE")
                    .bind(tenant_id).bind(&user_id).execute(&mut *tx).await?;
            }
            sqlx::query(
                r#"INSERT INTO user_branch_roles(
                     tenant_id,user_id,branch_id,role_id,role_name,access_type,valid_from,valid_until,is_default,active
                   ) SELECT $1,$2,$3,role.id,role.name,$5,$6,$7,$8,TRUE FROM roles role
                   WHERE role.tenant_id=$1 AND role.id=$4
                   ON CONFLICT(tenant_id,user_id,branch_id) DO UPDATE SET
                     role_id=EXCLUDED.role_id,role_name=EXCLUDED.role_name,access_type=EXCLUDED.access_type,
                     valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,
                     is_default=EXCLUDED.is_default,active=TRUE,updated_at=NOW()"#,
            )
            .bind(tenant_id)
            .bind(&user_id)
            .bind(&target_branch_id)
            .bind(&role_id)
            .bind(&transfer_type)
            .bind(valid_from)
            .bind(valid_until)
            .bind(transfer_type == "permanent")
            .execute(&mut *tx)
            .await?;
            if transfer_type == "permanent" {
                sqlx::query("UPDATE users SET branch_id=$3,role_id=$4,role_name=(SELECT name FROM roles WHERE tenant_id=$1 AND id=$4),updated_at=NOW() WHERE tenant_id=$1 AND id=$2")
                    .bind(tenant_id).bind(&user_id).bind(&target_branch_id).bind(&role_id).execute(&mut *tx).await?;
            }
        }
        if transfer_type == "permanent" {
            for table in [
                "staff_profiles",
                "staff_role_assignments",
                "staff_catalog_assignments",
                "staff_commission_rules",
                "staff_pay_rates",
                "staff_leave_policies",
                "staff_documents",
                "staff_mobile_devices",
                "staff_biometric_consents",
                "staff_skill_licenses",
                "staff_operation_tasks",
                "staff_operation_attendance",
            ] {
                sqlx::query(&format!(
                    "UPDATE {table} SET branch_id=$1 WHERE tenant_id=$2 AND branch_id=$3 AND staff_id=$4"
                ))
                .bind(&target_branch_id)
                .bind(tenant_id)
                .bind(&source_branch_id)
                .bind(&staff_id)
                .execute(&mut *tx)
                .await?;
            }
            sqlx::query("UPDATE staff_tasks SET branch_id=$1,updated_at=NOW() WHERE tenant_id=$2 AND branch_id=$3 AND staff_id=$4 AND status IN ('open','in_progress','blocked')")
                .bind(&target_branch_id).bind(tenant_id).bind(&source_branch_id).bind(&staff_id).execute(&mut *tx).await?;
            sqlx::query("UPDATE staff_coaching_goals SET branch_id=$1,updated_at=NOW() WHERE tenant_id=$2 AND branch_id=$3 AND staff_id=$4 AND status='active'")
                .bind(&target_branch_id).bind(tenant_id).bind(&source_branch_id).bind(&staff_id).execute(&mut *tx).await?;
            sqlx::query("UPDATE staff SET branch_id=$1,updated_at=NOW() WHERE tenant_id=$2 AND branch_id=$3 AND id=$4")
                .bind(&target_branch_id).bind(tenant_id).bind(&source_branch_id).bind(&staff_id).execute(&mut *tx).await?;
        }
    }
    sqlx::query("UPDATE staff_branch_transfer_requests SET status=$1,decision_note=$2,decided_by=$3,decided_at=NOW(),version=version+1,updated_at=NOW() WHERE id=$4")
        .bind(decision).bind(note).bind(actor_user_id).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    get_branch_transfer(db, tenant_id, &source_branch_id, id).await
}

async fn get_branch_transfer(
    db: &PgPool,
    tenant_id: &str,
    source_branch_id: &str,
    id: &str,
) -> Result<Option<BranchTransferRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {TRANSFER_COLUMNS} FROM staff_branch_transfer_requests transfer
         JOIN branches source ON source.id=transfer.source_branch_id AND source.tenant_id=transfer.tenant_id
         JOIN branches target ON target.id=transfer.target_branch_id AND target.tenant_id=transfer.tenant_id
         JOIN staff ON staff.id=transfer.staff_id JOIN roles role ON role.id=transfer.role_id
         WHERE transfer.tenant_id=$1 AND transfer.source_branch_id=$2 AND transfer.id=$3"
    ))
    .bind(tenant_id)
    .bind(source_branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn list_skill_licenses(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<SkillLicenseRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT license.id,license.staff_id,
           TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))) AS staff_name,
           license.skill_name,license.issuer,license.license_number,license.issued_on,license.expires_on,
           CASE WHEN license.expires_on<CURRENT_DATE THEN 'expired' ELSE license.verification_status END AS verification_status,
           license.document_url,license.notes,license.version,license.created_at,license.updated_at
           FROM staff_skill_licenses license JOIN staff ON staff.id=license.staff_id
           WHERE license.tenant_id=$1 AND license.branch_id=$2 AND ($3='' OR license.staff_id=$3)
           ORDER BY license.expires_on NULLS LAST,license.skill_name"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_skill_license(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: Option<&str>,
    staff_id: &str,
    skill_name: &str,
    issuer: &str,
    license_number: &str,
    issued_on: Option<NaiveDate>,
    expires_on: Option<NaiveDate>,
    verification_status: &str,
    document_url: &str,
    notes: &str,
    actor_user_id: &str,
    version: Option<i32>,
) -> Result<Option<SkillLicenseRecord>, sqlx::Error> {
    let saved_id = if let Some(id) = id.filter(|value| !value.is_empty()) {
        sqlx::query_scalar::<_, String>(
            r#"UPDATE staff_skill_licenses SET skill_name=$4,issuer=$5,license_number=$6,issued_on=$7,
               expires_on=$8,verification_status=$9,document_url=$10,notes=$11,version=version+1,updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$12 RETURNING id"#,
        )
        .bind(tenant_id).bind(branch_id).bind(id).bind(skill_name).bind(issuer).bind(license_number)
        .bind(issued_on).bind(expires_on).bind(verification_status).bind(document_url).bind(notes)
        .bind(version.unwrap_or_default()).fetch_optional(db).await?
    } else {
        sqlx::query_scalar::<_, String>(
            r#"INSERT INTO staff_skill_licenses(
               tenant_id,branch_id,staff_id,skill_name,issuer,license_number,issued_on,expires_on,
               verification_status,document_url,notes,created_by)
               SELECT $1,$2,staff.id,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM staff
               WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$3 AND staff.active=TRUE RETURNING id"#,
        )
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(skill_name).bind(issuer).bind(license_number)
        .bind(issued_on).bind(expires_on).bind(verification_status).bind(document_url).bind(notes)
        .bind(actor_user_id).fetch_optional(db).await?
    };
    let Some(saved_id) = saved_id else {
        return Ok(None);
    };
    sqlx::query_as(
        r#"SELECT license.id,license.staff_id,TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))) AS staff_name,
           license.skill_name,license.issuer,license.license_number,license.issued_on,license.expires_on,
           license.verification_status,license.document_url,license.notes,license.version,license.created_at,license.updated_at
           FROM staff_skill_licenses license JOIN staff ON staff.id=license.staff_id
           WHERE license.tenant_id=$1 AND license.branch_id=$2 AND license.id=$3"#,
    )
    .bind(tenant_id).bind(branch_id).bind(saved_id).fetch_optional(db).await
}

pub async fn list_reviews(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<PerformanceReviewRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT review.id,review.staff_id,TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))) AS staff_name,
           review.reviewer_user_id,review.period_start,review.period_end,review.score,review.strengths,
           review.improvement_areas,review.goals,review.employee_comments,review.status,review.version,
           review.created_at,review.updated_at,review.shared_at,review.acknowledged_at
           FROM staff_performance_reviews review JOIN staff ON staff.id=review.staff_id
           WHERE review.tenant_id=$1 AND review.branch_id=$2 AND ($3='' OR review.staff_id=$3)
           ORDER BY review.period_end DESC,review.created_at DESC"#,
    )
    .bind(tenant_id).bind(branch_id).bind(staff_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_review(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: Option<&str>,
    staff_id: &str,
    reviewer_user_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    score: Option<i32>,
    strengths: &str,
    improvement_areas: &str,
    goals: &str,
    employee_comments: &str,
    status: &str,
    version: Option<i32>,
) -> Result<Option<PerformanceReviewRecord>, sqlx::Error> {
    let saved_id = if let Some(id) = id.filter(|value| !value.is_empty()) {
        sqlx::query_scalar::<_, String>(
            r#"UPDATE staff_performance_reviews SET period_start=$4,period_end=$5,score=$6,strengths=$7,
               improvement_areas=$8,goals=$9,employee_comments=$10,status=$11,
               shared_at=CASE WHEN $11='shared' AND shared_at IS NULL THEN NOW() ELSE shared_at END,
               acknowledged_at=CASE WHEN $11='acknowledged' AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
               version=version+1,updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$12 RETURNING id"#,
        )
        .bind(tenant_id).bind(branch_id).bind(id).bind(period_start).bind(period_end).bind(score)
        .bind(strengths).bind(improvement_areas).bind(goals).bind(employee_comments).bind(status)
        .bind(version.unwrap_or_default()).fetch_optional(db).await?
    } else {
        sqlx::query_scalar::<_, String>(
            r#"INSERT INTO staff_performance_reviews(
               tenant_id,branch_id,staff_id,reviewer_user_id,period_start,period_end,score,strengths,
               improvement_areas,goals,employee_comments,status,shared_at)
               SELECT $1,$2,staff.id,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               CASE WHEN $12='shared' THEN NOW() ELSE NULL END FROM staff
               WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$3 RETURNING id"#,
        )
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(reviewer_user_id).bind(period_start)
        .bind(period_end).bind(score).bind(strengths).bind(improvement_areas).bind(goals)
        .bind(employee_comments).bind(status).fetch_optional(db).await?
    };
    let Some(saved_id) = saved_id else {
        return Ok(None);
    };
    sqlx::query_as(
        r#"SELECT review.id,review.staff_id,TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))) AS staff_name,
           review.reviewer_user_id,review.period_start,review.period_end,review.score,review.strengths,
           review.improvement_areas,review.goals,review.employee_comments,review.status,review.version,
           review.created_at,review.updated_at,review.shared_at,review.acknowledged_at
           FROM staff_performance_reviews review JOIN staff ON staff.id=review.staff_id
           WHERE review.tenant_id=$1 AND review.branch_id=$2 AND review.id=$3"#,
    )
    .bind(tenant_id).bind(branch_id).bind(saved_id).fetch_optional(db).await
}
pub async fn list_operation_templates(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_type: &str,
    active_only: bool,
) -> Result<Vec<StaffOperationTemplateRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,name,operation_type,frequency,checklist_json,active,created_by,created_at,updated_at
           FROM staff_operation_templates
           WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR operation_type=$3) AND ($4=FALSE OR active=TRUE)
           ORDER BY active DESC, operation_type, name"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(operation_type)
    .bind(active_only)
    .fetch_all(db)
    .await
}

pub async fn list_operation_schedules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    status: &str,
    operation_type: &str,
) -> Result<Vec<StaffOperationScheduleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,template_id,title,operation_type,frequency,scheduled_date,scheduled_time,
           assigned_staff_ids,owner_user_id,status,checklist_json,notes,created_by,created_at,
           updated_at,completed_at,cancelled_at
           FROM staff_operation_schedules
           WHERE tenant_id=$1 AND branch_id=$2 AND scheduled_date BETWEEN $3 AND $4
             AND ($5='' OR status=$5) AND ($6='' OR operation_type=$6)
           ORDER BY scheduled_date, scheduled_time NULLS LAST, created_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(status)
    .bind(operation_type)
    .fetch_all(db)
    .await
}

pub async fn list_operation_tasks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffOperationTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT task.id,task.operation_id,task.staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),task.staff_id) AS staff_name,
           task.task_title,task.status,task.proof_url,task.notes,task.completed_at,task.approved_by,
           task.approved_at,task.created_at,task.updated_at
           FROM staff_operation_tasks task
           JOIN staff ON staff.tenant_id=task.tenant_id AND staff.branch_id=task.branch_id AND staff.id=task.staff_id
           WHERE task.tenant_id=$1 AND task.branch_id=$2 AND ($3='' OR task.operation_id=$3)
             AND ($4='' OR task.staff_id=$4) AND ($5='' OR task.status=$5)
           ORDER BY task.created_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(operation_id)
    .bind(staff_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn list_operation_attendance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    staff_id: &str,
    status: &str,
) -> Result<Vec<StaffOperationAttendanceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT attendance.id,attendance.operation_id,attendance.staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),attendance.staff_id) AS staff_name,
           attendance.status,attendance.recorded_by,attendance.recorded_at,attendance.notes,
           attendance.created_at,attendance.updated_at
           FROM staff_operation_attendance attendance
           JOIN staff ON staff.tenant_id=attendance.tenant_id AND staff.branch_id=attendance.branch_id AND staff.id=attendance.staff_id
           WHERE attendance.tenant_id=$1 AND attendance.branch_id=$2 AND ($3='' OR attendance.operation_id=$3)
             AND ($4='' OR attendance.staff_id=$4) AND ($5='' OR attendance.status=$5)
           ORDER BY attendance.recorded_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(operation_id)
    .bind(staff_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn active_staff_count(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND id=ANY($3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_ids)
    .fetch_one(db)
    .await
}

pub async fn operation_template_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    template_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM staff_operation_templates WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(template_id)
    .fetch_one(db)
    .await
}

pub async fn create_operation_template(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    operation_type: &str,
    frequency: &str,
    checklist_json: &Value,
    active: bool,
    actor_user_id: &str,
) -> Result<StaffOperationTemplateRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO staff_operation_templates(
             tenant_id,branch_id,name,operation_type,frequency,checklist_json,active,created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id,name,operation_type,frequency,checklist_json,active,created_by,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(operation_type)
    .bind(frequency)
    .bind(checklist_json)
    .bind(active)
    .bind(actor_user_id)
    .fetch_one(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_operation_schedules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    template_id: Option<&str>,
    title: &str,
    operation_type: &str,
    frequency: &str,
    scheduled_dates: &[NaiveDate],
    scheduled_time: Option<NaiveTime>,
    assigned_staff_ids: &Value,
    owner_user_id: &str,
    checklist_json: &Value,
    notes: &str,
    actor_user_id: &str,
) -> Result<Vec<StaffOperationScheduleRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let mut ids = Vec::with_capacity(scheduled_dates.len());
    for scheduled_date in scheduled_dates {
        let id = sqlx::query_scalar::<_, String>(
            r#"INSERT INTO staff_operation_schedules(
                 tenant_id,branch_id,template_id,title,operation_type,frequency,scheduled_date,scheduled_time,
                 assigned_staff_ids,owner_user_id,checklist_json,notes,created_by
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
               RETURNING id"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(template_id)
        .bind(title)
        .bind(operation_type)
        .bind(frequency)
        .bind(*scheduled_date)
        .bind(scheduled_time)
        .bind(assigned_staff_ids)
        .bind(owner_user_id)
        .bind(checklist_json)
        .bind(notes)
        .bind(actor_user_id)
        .fetch_one(&mut *tx)
        .await?;
        ids.push(id);
    }
    tx.commit().await?;
    get_operation_schedules_by_ids(db, tenant_id, branch_id, &ids).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_operation_schedule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    title: Option<&str>,
    scheduled_date: Option<NaiveDate>,
    scheduled_time: Option<NaiveTime>,
    assigned_staff_ids: Option<&Value>,
    status: Option<&str>,
    checklist_json: Option<&Value>,
    notes: Option<&str>,
) -> Result<Option<StaffOperationScheduleRecord>, sqlx::Error> {
    let saved_id = sqlx::query_scalar::<_, String>(
        r#"UPDATE staff_operation_schedules SET
             title=COALESCE($4,title),
             scheduled_date=COALESCE($5,scheduled_date),
             scheduled_time=COALESCE($6,scheduled_time),
             assigned_staff_ids=COALESCE($7,assigned_staff_ids),
             status=COALESCE($8,status),
             checklist_json=COALESCE($9,checklist_json),
             notes=COALESCE($10,notes),
             completed_at=CASE WHEN $8='completed' THEN COALESCE(completed_at,NOW()) WHEN $8 IN ('planned','in_progress') THEN NULL ELSE completed_at END,
             cancelled_at=CASE WHEN $8='cancelled' THEN COALESCE(cancelled_at,NOW()) WHEN $8 IN ('planned','in_progress') THEN NULL ELSE cancelled_at END,
             updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(title)
    .bind(scheduled_date)
    .bind(scheduled_time)
    .bind(assigned_staff_ids)
    .bind(status)
    .bind(checklist_json)
    .bind(notes)
    .fetch_optional(db)
    .await?;
    match saved_id {
        Some(saved_id) => get_operation_schedule(db, tenant_id, branch_id, &saved_id).await,
        None => Ok(None),
    }
}

async fn get_operation_schedule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<StaffOperationScheduleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,template_id,title,operation_type,frequency,scheduled_date,scheduled_time,
           assigned_staff_ids,owner_user_id,status,checklist_json,notes,created_by,created_at,
           updated_at,completed_at,cancelled_at
           FROM staff_operation_schedules
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

async fn get_operation_schedules_by_ids(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    ids: &[String],
) -> Result<Vec<StaffOperationScheduleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,template_id,title,operation_type,frequency,scheduled_date,scheduled_time,
           assigned_staff_ids,owner_user_id,status,checklist_json,notes,created_by,created_at,
           updated_at,completed_at,cancelled_at
           FROM staff_operation_schedules
           WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)
           ORDER BY scheduled_date, scheduled_time NULLS LAST, created_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(ids)
    .fetch_all(db)
    .await
}

pub async fn create_operation_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    staff_id: &str,
    task_title: &str,
    notes: &str,
) -> Result<Option<StaffOperationTaskRecord>, sqlx::Error> {
    let saved_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO staff_operation_tasks(tenant_id,branch_id,operation_id,staff_id,task_title,notes)
           SELECT $1,$2,operation.id,staff.id,$5,$6
           FROM staff_operation_schedules operation
           JOIN staff ON staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$4 AND staff.active=TRUE
           WHERE operation.tenant_id=$1 AND operation.branch_id=$2 AND operation.id=$3
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(operation_id)
    .bind(staff_id)
    .bind(task_title)
    .bind(notes)
    .fetch_optional(db)
    .await?;
    match saved_id {
        Some(saved_id) => get_operation_task(db, tenant_id, branch_id, &saved_id).await,
        None => Ok(None),
    }
}

pub async fn update_operation_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: Option<&str>,
    proof_url: Option<&str>,
    notes: Option<&str>,
    actor_user_id: Option<&str>,
) -> Result<Option<StaffOperationTaskRecord>, sqlx::Error> {
    let saved_id = sqlx::query_scalar::<_, String>(
        r#"UPDATE staff_operation_tasks SET
             status=COALESCE($4,status),
             proof_url=COALESCE($5,proof_url),
             notes=COALESCE($6,notes),
             completed_at=CASE WHEN $4 IN ('completed','approved') THEN COALESCE(completed_at,NOW()) WHEN $4 IN ('planned','in_progress') THEN NULL ELSE completed_at END,
             approved_by=CASE WHEN $4 IN ('approved','rejected') THEN $7 ELSE approved_by END,
             approved_at=CASE WHEN $4 IN ('approved','rejected') THEN NOW() ELSE approved_at END,
             updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(status)
    .bind(proof_url)
    .bind(notes)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await?;
    match saved_id {
        Some(saved_id) => get_operation_task(db, tenant_id, branch_id, &saved_id).await,
        None => Ok(None),
    }
}

async fn get_operation_task(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<StaffOperationTaskRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT task.id,task.operation_id,task.staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),task.staff_id) AS staff_name,
           task.task_title,task.status,task.proof_url,task.notes,task.completed_at,task.approved_by,
           task.approved_at,task.created_at,task.updated_at
           FROM staff_operation_tasks task
           JOIN staff ON staff.tenant_id=task.tenant_id AND staff.branch_id=task.branch_id AND staff.id=task.staff_id
           WHERE task.tenant_id=$1 AND task.branch_id=$2 AND task.id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_operation_attendance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    operation_id: &str,
    staff_id: &str,
    status: &str,
    notes: &str,
    actor_user_id: &str,
) -> Result<Option<StaffOperationAttendanceRecord>, sqlx::Error> {
    let saved_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO staff_operation_attendance(
             tenant_id,branch_id,operation_id,staff_id,status,notes,recorded_by
           )
           SELECT $1,$2,operation.id,staff.id,$5,$6,$7
           FROM staff_operation_schedules operation
           JOIN staff ON staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$4 AND staff.active=TRUE
           WHERE operation.tenant_id=$1 AND operation.branch_id=$2 AND operation.id=$3
           ON CONFLICT(tenant_id,branch_id,operation_id,staff_id) DO UPDATE SET
             status=EXCLUDED.status,
             notes=EXCLUDED.notes,
             recorded_by=EXCLUDED.recorded_by,
             recorded_at=NOW(),
             updated_at=NOW()
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(operation_id)
    .bind(staff_id)
    .bind(status)
    .bind(notes)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await?;
    match saved_id {
        Some(saved_id) => get_operation_attendance(db, tenant_id, branch_id, &saved_id).await,
        None => Ok(None),
    }
}

async fn get_operation_attendance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<StaffOperationAttendanceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT attendance.id,attendance.operation_id,attendance.staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),attendance.staff_id) AS staff_name,
           attendance.status,attendance.recorded_by,attendance.recorded_at,attendance.notes,
           attendance.created_at,attendance.updated_at
           FROM staff_operation_attendance attendance
           JOIN staff ON staff.tenant_id=attendance.tenant_id AND staff.branch_id=attendance.branch_id AND staff.id=attendance.staff_id
           WHERE attendance.tenant_id=$1 AND attendance.branch_id=$2 AND attendance.id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn operation_report_operation_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    staff_id: &str,
    operation_type: &str,
    bucket: &str,
) -> Result<Vec<OperationReportOperationRow>, sqlx::Error> {
    let condition = match bucket {
        "completed" => {
            "operation.status='completed' OR COALESCE(BOOL_OR(task.status IN ('completed','approved')), FALSE)"
        }
        "missed" => {
            "operation.status='missed' OR COALESCE(BOOL_OR(task.status='missed'), FALSE) OR (operation.scheduled_date < CURRENT_DATE AND operation.status IN ('planned','in_progress') AND NOT COALESCE(BOOL_OR(task.status IN ('completed','approved')), FALSE))"
        }
        "pending_approval" => {
            "COUNT(*) FILTER (WHERE task.status='completed' AND task.approved_at IS NULL) > 0"
        }
        _ => "FALSE",
    };
    sqlx::query_as(&format!(
        r#"SELECT operation.id,operation.title,operation.operation_type,operation.scheduled_date,operation.scheduled_time,
           operation.status,
           JSONB_ARRAY_LENGTH(operation.assigned_staff_ids)::BIGINT AS assigned_staff_count,
           COUNT(*) FILTER (WHERE task.status IN ('completed','approved'))::BIGINT AS completed_task_count,
           COUNT(*) FILTER (WHERE task.status='missed')::BIGINT AS missed_task_count,
           COUNT(*) FILTER (WHERE task.status='completed' AND task.approved_at IS NULL)::BIGINT AS pending_approval_count
           FROM staff_operation_schedules operation
           LEFT JOIN staff_operation_tasks task
             ON task.tenant_id=operation.tenant_id AND task.branch_id=operation.branch_id AND task.operation_id=operation.id
           WHERE operation.tenant_id=$1 AND operation.branch_id=$2 AND operation.scheduled_date BETWEEN $3 AND $4
             AND ($5='' OR operation.assigned_staff_ids ? $5 OR EXISTS(
               SELECT 1 FROM staff_operation_tasks st WHERE st.tenant_id=operation.tenant_id AND st.branch_id=operation.branch_id AND st.operation_id=operation.id AND st.staff_id=$5
             ) OR EXISTS(
               SELECT 1 FROM staff_operation_attendance sa WHERE sa.tenant_id=operation.tenant_id AND sa.branch_id=operation.branch_id AND sa.operation_id=operation.id AND sa.staff_id=$5
             ))
             AND ($6='' OR operation.operation_type=$6)
           GROUP BY operation.id,operation.title,operation.operation_type,operation.scheduled_date,operation.scheduled_time,operation.status,operation.assigned_staff_ids
           HAVING {condition}
           ORDER BY operation.scheduled_date DESC, operation.scheduled_time NULLS LAST, operation.title"#
    ))
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(staff_id)
    .bind(operation_type)
    .fetch_all(db)
    .await
}

pub async fn operation_meeting_attendance_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    staff_id: &str,
) -> Result<Vec<OperationMeetingAttendanceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT attendance.staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),attendance.staff_id) AS staff_name,
           COUNT(*) FILTER (WHERE attendance.status='present')::BIGINT AS present_count,
           COUNT(*) FILTER (WHERE attendance.status='absent')::BIGINT AS absent_count,
           COUNT(*) FILTER (WHERE attendance.status='late')::BIGINT AS late_count,
           COUNT(*) FILTER (WHERE attendance.status='excused')::BIGINT AS excused_count
           FROM staff_operation_attendance attendance
           JOIN staff_operation_schedules operation ON operation.tenant_id=attendance.tenant_id AND operation.branch_id=attendance.branch_id AND operation.id=attendance.operation_id
           JOIN staff ON staff.tenant_id=attendance.tenant_id AND staff.branch_id=attendance.branch_id AND staff.id=attendance.staff_id
           WHERE attendance.tenant_id=$1 AND attendance.branch_id=$2 AND operation.scheduled_date BETWEEN $3 AND $4
             AND operation.operation_type IN ('staff_meeting','performance_review','training_session')
             AND ($5='' OR attendance.staff_id=$5)
           GROUP BY attendance.staff_id,staff.first_name,staff.last_name
           ORDER BY staff_name"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn operation_cleaning_score_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    staff_id: &str,
) -> Result<Vec<OperationCleaningScoreRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT staff.id AS staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),staff.id) AS staff_name,
           COUNT(task.id) FILTER (WHERE operation.id IS NOT NULL AND task.status IN ('completed','approved'))::BIGINT AS completed_count,
           COUNT(task.id) FILTER (WHERE operation.id IS NOT NULL AND task.status='missed')::BIGINT AS missed_count,
           CASE WHEN COUNT(task.id) FILTER (WHERE operation.id IS NOT NULL AND task.status IN ('completed','approved','missed')) = 0 THEN 0::DOUBLE PRECISION
                ELSE ROUND((COUNT(task.id) FILTER (WHERE operation.id IS NOT NULL AND task.status IN ('completed','approved'))::NUMERIC * 100) /
                  NULLIF(COUNT(task.id) FILTER (WHERE operation.id IS NOT NULL AND task.status IN ('completed','approved','missed'))::NUMERIC,0), 2)::DOUBLE PRECISION END AS score
           FROM staff
           LEFT JOIN staff_operation_tasks task ON task.tenant_id=staff.tenant_id AND task.branch_id=staff.branch_id AND task.staff_id=staff.id
           LEFT JOIN staff_operation_schedules operation ON operation.tenant_id=task.tenant_id AND operation.branch_id=task.branch_id AND operation.id=task.operation_id
             AND operation.scheduled_date BETWEEN $3 AND $4
             AND operation.operation_type IN ('opening_checklist','closing_checklist','tool_sanitization','stock_linen_check','cleaning_task','deep_cleaning','hygiene_audit')
           WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE AND ($5='' OR staff.id=$5)
           GROUP BY staff.id,staff.first_name,staff.last_name
           HAVING COUNT(task.id) FILTER (WHERE operation.id IS NOT NULL) > 0
           ORDER BY score DESC, staff_name"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn operation_hygiene_compliance_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    operation_type: &str,
) -> Result<Vec<OperationHygieneComplianceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT operation.operation_type,
           COUNT(DISTINCT operation.id)::BIGINT AS planned_count,
           COUNT(DISTINCT operation.id) FILTER (WHERE operation.status='completed' OR task_completed.operation_id IS NOT NULL)::BIGINT AS completed_count,
           COUNT(DISTINCT operation.id) FILTER (WHERE operation.status='missed' OR task_missed.operation_id IS NOT NULL)::BIGINT AS missed_count,
           CASE WHEN COUNT(DISTINCT operation.id)=0 THEN 0::DOUBLE PRECISION
                ELSE ROUND((COUNT(DISTINCT operation.id) FILTER (WHERE operation.status='completed' OR task_completed.operation_id IS NOT NULL)::NUMERIC * 100) /
                  NULLIF(COUNT(DISTINCT operation.id)::NUMERIC,0), 2)::DOUBLE PRECISION END AS compliance_percent
           FROM staff_operation_schedules operation
           LEFT JOIN (SELECT DISTINCT tenant_id,branch_id,operation_id FROM staff_operation_tasks WHERE status IN ('completed','approved')) task_completed
             ON task_completed.tenant_id=operation.tenant_id AND task_completed.branch_id=operation.branch_id AND task_completed.operation_id=operation.id
           LEFT JOIN (SELECT DISTINCT tenant_id,branch_id,operation_id FROM staff_operation_tasks WHERE status='missed') task_missed
             ON task_missed.tenant_id=operation.tenant_id AND task_missed.branch_id=operation.branch_id AND task_missed.operation_id=operation.id
           WHERE operation.tenant_id=$1 AND operation.branch_id=$2 AND operation.scheduled_date BETWEEN $3 AND $4
             AND operation.operation_type IN ('opening_checklist','closing_checklist','tool_sanitization','stock_linen_check','cleaning_task','deep_cleaning','hygiene_audit')
             AND ($5='' OR operation.operation_type=$5)
           GROUP BY operation.operation_type
           ORDER BY operation.operation_type"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(operation_type)
    .fetch_all(db)
    .await
}

pub async fn missed_operation_targets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Vec<OperationAutomationTargetRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT operation.id AS operation_id, task.id AS task_id, staff.id AS staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),staff.id) AS staff_name,
           COALESCE(staff.mobile_phone,'') AS mobile_phone,
           operation.title,operation.operation_type,operation.scheduled_date,task.status
           FROM staff_operation_tasks task
           JOIN staff_operation_schedules operation ON operation.tenant_id=task.tenant_id AND operation.branch_id=task.branch_id AND operation.id=task.operation_id
           JOIN staff ON staff.tenant_id=task.tenant_id AND staff.branch_id=task.branch_id AND staff.id=task.staff_id
           WHERE task.tenant_id=$1 AND task.branch_id=$2 AND operation.scheduled_date BETWEEN $3 AND $4
             AND task.status='missed' AND staff.active=TRUE
           ORDER BY operation.scheduled_date DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}

pub async fn upcoming_operation_targets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    operation_types: &[String],
) -> Result<Vec<OperationAutomationTargetRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT operation.id AS operation_id, NULL::TEXT AS task_id, staff.id AS staff_id,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.last_name,''))),''),staff.id) AS staff_name,
           COALESCE(staff.mobile_phone,'') AS mobile_phone,
           operation.title,operation.operation_type,operation.scheduled_date,operation.status
           FROM staff_operation_schedules operation
           JOIN staff ON staff.tenant_id=operation.tenant_id AND staff.branch_id=operation.branch_id
             AND (operation.assigned_staff_ids ? staff.id)
           WHERE operation.tenant_id=$1 AND operation.branch_id=$2 AND operation.scheduled_date BETWEEN $3 AND $4
             AND operation.operation_type=ANY($5) AND operation.status IN ('planned','in_progress') AND staff.active=TRUE
           ORDER BY operation.scheduled_date, operation.scheduled_time NULLS LAST"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .bind(operation_types)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn queue_staff_operation_notification(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    staff_id: &str,
    notification_type: &str,
    recipient: &str,
    title: &str,
    body: &str,
    scheduled_at: DateTime<Utc>,
    metadata: &Value,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    let row: Option<String> = sqlx::query_scalar(
        r#"INSERT INTO staff_notification_queue(
             tenant_id,branch_id,requested_by,staff_id,template_id,channel,notification_type,recipient,title,message_body,
             sensitive,requires_approval,status,scheduled_at,metadata_json,next_attempt_at
           )
           SELECT $1,$2,$3,staff.id,NULL,'in_app',$5,COALESCE(NULLIF($6,''),staff.id),$7,$8,
             FALSE,FALSE,'queued',$9,$10,$9
           FROM staff
           WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$4 AND staff.active=TRUE
             AND NOT EXISTS(
               SELECT 1 FROM staff_notification_queue existing
               WHERE existing.tenant_id=$1 AND existing.branch_id=$2 AND existing.staff_id=$4
                 AND existing.notification_type=$5 AND existing.metadata_json->>'idempotencyKey'=$11
             )
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_user_id)
    .bind(staff_id)
    .bind(notification_type)
    .bind(recipient)
    .bind(title)
    .bind(body)
    .bind(scheduled_at)
    .bind(metadata)
    .bind(idempotency_key)
    .fetch_optional(db)
    .await?;
    Ok(row.is_some())
}

pub async fn queue_owner_operation_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    title: &str,
    body: &str,
    metadata: &Value,
    idempotency_key: &str,
) -> Result<bool, sqlx::Error> {
    let row: Option<String> = sqlx::query_scalar(
        r#"INSERT INTO notifications(
             tenant_id,branch_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json
           )
           SELECT $1,$2,$3,'staff_operations_monthly_summary',$4,$5,'staff_operations',$8,$6
           WHERE NOT EXISTS(
             SELECT 1 FROM notifications existing
             WHERE existing.tenant_id=$1 AND existing.branch_id=$2
               AND existing.notification_type='staff_operations_monthly_summary'
               AND existing.metadata_json->>'idempotencyKey'=$7
           )
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_user_id)
    .bind(title)
    .bind(body)
    .bind(metadata)
    .bind(idempotency_key)
    .bind(idempotency_key)
    .fetch_optional(db)
    .await?;
    Ok(row.is_some())
}
