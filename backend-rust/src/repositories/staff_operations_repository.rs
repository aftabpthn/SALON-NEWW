use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
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
