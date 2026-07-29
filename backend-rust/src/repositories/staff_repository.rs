use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgConnection, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct StaffRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub user_id: Option<String>,
    pub employee_code: Option<String>,
    pub first_name: String,
    pub middle_name: String,
    pub last_name: String,
    pub appointment_display_name: String,
    pub email: String,
    pub mobile_phone: String,
    pub home_phone: String,
    pub work_phone: String,
    pub job_title: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffBranchAccessRecord {
    pub branch_id: String,
    pub branch_name: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub role_id: Option<String>,
    pub role_name: String,
    pub access_type: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub is_default: bool,
    pub active: bool,
    pub effective: bool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuthRoleOptionRecord {
    pub id: String,
    pub name: String,
}

pub fn is_staff_assignable_role_name(name: &str) -> bool {
    let normalized = name
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "");
    !matches!(normalized.as_str(), "owner" | "admin" | "superadmin")
}

#[derive(Debug, Clone, FromRow)]
pub struct AuthRoleRecord {
    pub id: String,
    pub name: String,
    pub permissions_json: Value,
    pub denied_permissions_json: Value,
    pub masked_fields_json: Value,
    pub max_discount_paise: Option<i64>,
    pub max_refund_paise: Option<i64>,
    pub max_cash_movement_paise: Option<i64>,
    pub is_system: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffLoginRecord {
    pub login_id: Option<String>,
    pub email: String,
    pub must_change_password: bool,
}

pub struct BranchRoleAssignmentInput {
    pub branch_id: String,
    pub role_id: String,
    pub access_type: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub is_default: bool,
    pub active: bool,
}

pub struct ProvisionStaffLoginInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub staff_id: &'a str,
    pub login_id: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
    pub full_name: &'a str,
    pub role_id: &'a str,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffLoginInviteRecord {
    pub id: String,
    pub email: String,
    pub role_id: String,
    pub role_name: String,
    pub status: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub delivery_status: String,
    pub delivery_provider: String,
    pub provider_message_id: String,
    pub delivery_attempts: i32,
    pub last_delivery_error: String,
    pub last_sent_at: Option<DateTime<Utc>>,
    pub delivered_at: Option<DateTime<Utc>>,
    pub bounced_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffLoginInvitePreviewRecord {
    pub tenant_name: String,
    pub branch_name: String,
    pub staff_name: String,
    pub email: String,
    pub role_name: String,
    pub expires_at: DateTime<Utc>,
}

pub struct CreateStaffLoginInviteInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub staff_id: &'a str,
    pub role_id: &'a str,
    pub email: &'a str,
    pub token_hash: &'a str,
    pub expires_at: DateTime<Utc>,
    pub actor_user_id: &'a str,
}

#[derive(Debug)]
pub struct AcceptedStaffLoginInvite {
    pub tenant_id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub user_id: String,
}

pub struct CreateStaff<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub first_name: &'a str,
    pub middle_name: &'a str,
    pub last_name: &'a str,
    pub appointment_display_name: &'a str,
    pub email: &'a str,
    pub mobile_phone: &'a str,
    pub home_phone: &'a str,
    pub work_phone: &'a str,
    pub job_title: &'a str,
}

pub struct UpdateStaff<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub employee_code: Option<&'a str>,
    pub first_name: Option<&'a str>,
    pub middle_name: Option<&'a str>,
    pub last_name: Option<&'a str>,
    pub appointment_display_name: Option<&'a str>,
    pub email: Option<&'a str>,
    pub mobile_phone: Option<&'a str>,
    pub home_phone: Option<&'a str>,
    pub work_phone: Option<&'a str>,
    pub job_title: Option<&'a str>,
    pub active: Option<bool>,
}

pub struct StaffListFilters<'a> {
    pub query: &'a str,
    pub job: &'a str,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffProfileRecord {
    pub staff_id: String,
    pub category_id: Option<String>,
    pub shift_template_id: Option<String>,
    pub pricing_level_id: Option<String>,
    pub designation: String,
    pub company_name: String,
    pub mandatory_break_minutes: Option<i32>,
    pub work_tasks_json: Value,
    pub max_work_hours: Option<i32>,
    pub target_revenue_paise: Option<i64>,
    pub vacation_days: Option<i32>,
    pub special_leave_days: Option<i32>,
    pub tenure_start_date: Option<NaiveDate>,
    pub booking_interval_minutes: Option<i32>,
    pub restrict_booking_to_returning_guests: bool,
    pub photo_url: String,
    pub date_of_birth: Option<NaiveDate>,
    pub joining_date: Option<NaiveDate>,
    pub gender: String,
    pub employment_type: String,
    pub department: String,
    pub reporting_manager_id: Option<String>,
    pub address_line1: String,
    pub address_line2: String,
    pub city: String,
    pub state_name: String,
    pub postal_code: String,
    pub country: String,
    pub emergency_contact_name: String,
    pub emergency_contact_relationship: String,
    pub emergency_contact_phone: String,
}

pub struct UpsertStaffProfile<'a> {
    pub staff_id: &'a str,
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub category_id: Option<&'a str>,
    pub shift_template_id: Option<&'a str>,
    pub pricing_level_id: Option<&'a str>,
    pub designation: &'a str,
    pub company_name: &'a str,
    pub mandatory_break_minutes: Option<i32>,
    pub work_tasks_json: Value,
    pub max_work_hours: Option<i32>,
    pub target_revenue_paise: Option<i64>,
    pub vacation_days: Option<i32>,
    pub special_leave_days: Option<i32>,
    pub tenure_start_date: Option<NaiveDate>,
    pub booking_interval_minutes: Option<i32>,
    pub restrict_booking_to_returning_guests: bool,
    pub photo_url: &'a str,
    pub date_of_birth: Option<NaiveDate>,
    pub joining_date: Option<NaiveDate>,
    pub gender: &'a str,
    pub employment_type: &'a str,
    pub department: &'a str,
    pub reporting_manager_id: Option<&'a str>,
    pub address_line1: &'a str,
    pub address_line2: &'a str,
    pub city: &'a str,
    pub state_name: &'a str,
    pub postal_code: &'a str,
    pub country: &'a str,
    pub emergency_contact_name: &'a str,
    pub emergency_contact_relationship: &'a str,
    pub emergency_contact_phone: &'a str,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<StaffRecord>, sqlx::Error> {
    list_filtered(
        db,
        tenant_id,
        branch_id,
        &StaffListFilters {
            query: q,
            job: "",
            active: None,
        },
        "created_at",
        "DESC",
        limit,
        offset,
    )
    .await
}

pub async fn list_filtered(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    filters: &StaffListFilters<'_>,
    sort_column: &str,
    sort_direction: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<StaffRecord>, sqlx::Error> {
    let sql = format!(
        r#"
        SELECT
          id, tenant_id, branch_id, user_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone,
          job_title, active, created_at, updated_at
        FROM staff
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            $3 = ''
            OR employee_code ILIKE '%' || $3 || '%'
            OR first_name ILIKE '%' || $3 || '%'
            OR last_name ILIKE '%' || $3 || '%'
            OR mobile_phone ILIKE '%' || $3 || '%'
            OR email ILIKE '%' || $3 || '%'
            OR job_title ILIKE '%' || $3 || '%'
          )
          AND ($4 = '' OR job_title = $4)
          AND ($5::boolean IS NULL OR active = $5)
        ORDER BY {sort_column} {sort_direction}, id ASC
        LIMIT $6 OFFSET $7
        "#,
    );

    sqlx::query_as::<_, StaffRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(filters.query)
        .bind(filters.job)
        .bind(filters.active)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await
}

pub async fn count_filtered(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    filters: &StaffListFilters<'_>,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM staff
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            $3 = ''
            OR employee_code ILIKE '%' || $3 || '%'
            OR first_name ILIKE '%' || $3 || '%'
            OR last_name ILIKE '%' || $3 || '%'
            OR mobile_phone ILIKE '%' || $3 || '%'
            OR email ILIKE '%' || $3 || '%'
            OR job_title ILIKE '%' || $3 || '%'
          )
          AND ($4 = '' OR job_title = $4)
          AND ($5::boolean IS NULL OR active = $5)
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(filters.query)
    .bind(filters.job)
    .bind(filters.active)
    .fetch_one(db)
    .await
}

pub async fn list_job_titles(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT DISTINCT job_title
        FROM staff
        WHERE tenant_id = $1 AND branch_id = $2 AND job_title <> ''
        ORDER BY job_title
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<StaffRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffRecord>(
        r#"
        SELECT
          id, tenant_id, branch_id, user_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone,
          job_title, active, created_at, updated_at
        FROM staff
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn list_branch_access(
    db: &PgPool,
    tenant_id: &str,
    user_id: Option<&str>,
) -> Result<Vec<StaffBranchAccessRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffBranchAccessRecord>(
        r#"
        SELECT COALESCE(NULLIF(b.scope_id, ''), b.id::text) AS branch_id,
               b.name AS branch_name,
               b.region_name,
               b.zone_name,
               b.cluster_name,
               ubr.role_id,
               COALESCE(r.name, ubr.role_name, '') AS role_name,
               COALESCE(ubr.access_type, 'permanent') AS access_type,
               ubr.valid_from,
               ubr.valid_until,
               COALESCE(ubr.is_default, FALSE) AS is_default,
               COALESCE(ubr.active, FALSE) AS active,
               COALESCE(ubr.active, FALSE) AND (
                 COALESCE(ubr.access_type, 'permanent')='permanent'
                 OR (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN ubr.valid_from AND ubr.valid_until
               ) AS effective
        FROM tenants t
        JOIN branches b ON b.tenant_id = t.id AND b.active = TRUE
        LEFT JOIN user_branch_roles ubr
          ON ubr.tenant_id = $1
         AND ubr.user_id = COALESCE($2, '')
         AND ubr.branch_id = COALESCE(NULLIF(b.scope_id, ''), b.id::text)
        LEFT JOIN roles r ON r.tenant_id = ubr.tenant_id AND r.id = ubr.role_id
        WHERE COALESCE(NULLIF(t.scope_id, ''), t.id::text) = $1
        ORDER BY COALESCE(ubr.is_default, FALSE) DESC,
                 b.region_name, b.zone_name, b.cluster_name, b.name ASC
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_all(db)
    .await
}

pub async fn list_auth_roles(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<AuthRoleOptionRecord>, sqlx::Error> {
    let mut roles = sqlx::query_as::<_, AuthRoleOptionRecord>(
        "SELECT id, name FROM roles WHERE tenant_id=$1 ORDER BY name ASC",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await?;
    roles.retain(|role| is_staff_assignable_role_name(&role.name));
    Ok(roles)
}

pub async fn find_staff_login(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Option<StaffLoginRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffLoginRecord>(
        r#"
        SELECT u.login_id, u.email, u.must_change_password
        FROM staff s
        JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id AND u.active=TRUE
        WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_optional(db)
    .await
}

pub async fn provision_staff_login(
    db: &PgPool,
    input: &ProvisionStaffLoginInput<'_>,
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let user_id = insert_staff_login(tx.as_mut(), input, true).await?;
    sqlx::query(
        "UPDATE staff_login_invitations SET revoked_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(user_id)
}

async fn insert_staff_login(
    connection: &mut PgConnection,
    input: &ProvisionStaffLoginInput<'_>,
    must_change_password: bool,
) -> Result<String, sqlx::Error> {
    let staff_exists = sqlx::query_scalar::<_, String>(
        "SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND user_id IS NULL FOR UPDATE",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .fetch_optional(&mut *connection)
    .await?;
    if staff_exists.is_none() {
        return Err(sqlx::Error::RowNotFound);
    }

    let branch_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
          SELECT 1
          FROM tenants t
          JOIN branches b ON b.tenant_id=t.id AND b.active=TRUE
          WHERE COALESCE(NULLIF(t.scope_id, ''), t.id::text)=$1
            AND COALESCE(NULLIF(b.scope_id, ''), b.id::text)=$2
        )
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .fetch_one(&mut *connection)
    .await?;
    if !branch_exists {
        return Err(sqlx::Error::RowNotFound);
    }

    let role_name = sqlx::query_scalar::<_, String>(
        "SELECT name FROM roles WHERE tenant_id=$1 AND id=$2 LIMIT 1",
    )
    .bind(input.tenant_id)
    .bind(input.role_id)
    .fetch_optional(&mut *connection)
    .await?;
    let Some(role_name) = role_name else {
        return Err(sqlx::Error::RowNotFound);
    };
    if !is_staff_assignable_role_name(&role_name) {
        return Err(sqlx::Error::RowNotFound);
    }

    let user_id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO users (
          tenant_id, branch_id, role_id, role_name, login_id, email, password_hash,
          full_name, active, must_change_password
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9)
        RETURNING id
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.role_id)
    .bind(&role_name)
    .bind(input.login_id)
    .bind(input.email)
    .bind(input.password_hash)
    .bind(input.full_name)
    .bind(must_change_password)
    .fetch_one(&mut *connection)
    .await?;

    sqlx::query(
        "UPDATE staff SET user_id=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND user_id IS NULL",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .bind(&user_id)
    .execute(&mut *connection)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO user_branch_roles (
          tenant_id, user_id, branch_id, role_id, role_name, is_default, active
        ) VALUES ($1,$2,$3,$4,$5,TRUE,TRUE)
        "#,
    )
    .bind(input.tenant_id)
    .bind(&user_id)
    .bind(input.branch_id)
    .bind(input.role_id)
    .bind(&role_name)
    .execute(&mut *connection)
    .await?;
    Ok(user_id)
}

pub async fn create_staff_login_invite(
    db: &PgPool,
    input: &CreateStaffLoginInviteInput<'_>,
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE staff_login_invitations SET revoked_at=NOW(),revoked_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .bind(input.actor_user_id)
    .execute(&mut *tx)
    .await?;

    let staff_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND user_id IS NULL FOR UPDATE)",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .fetch_one(&mut *tx)
    .await?;
    let role_name = sqlx::query_scalar::<_, String>(
        "SELECT name FROM roles WHERE tenant_id=$1 AND id=$2 LIMIT 1",
    )
    .bind(input.tenant_id)
    .bind(input.role_id)
    .fetch_optional(&mut *tx)
    .await?;
    if !staff_exists
        || !role_name
            .as_deref()
            .is_some_and(is_staff_assignable_role_name)
    {
        return Err(sqlx::Error::RowNotFound);
    }

    let id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO staff_login_invitations (
          tenant_id,branch_id,staff_id,role_id,email,token_hash,expires_at,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .bind(input.role_id)
    .bind(input.email)
    .bind(input.token_hash)
    .bind(&input.expires_at)
    .bind(input.actor_user_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(id)
}

pub async fn latest_staff_login_invite(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Option<StaffLoginInviteRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffLoginInviteRecord>(
        r#"
        SELECT i.id,i.email,i.role_id,r.name role_name,
          CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
               WHEN i.revoked_at IS NOT NULL THEN 'revoked'
               WHEN i.expires_at<=NOW() THEN 'expired' ELSE 'pending' END status,
          i.expires_at,i.created_at,i.accepted_at,i.revoked_at,
          i.delivery_status,i.delivery_provider,i.provider_message_id,i.delivery_attempts,
          i.last_delivery_error,i.last_sent_at,i.delivered_at,i.bounced_at
        FROM staff_login_invitations i
        JOIN roles r ON r.tenant_id=i.tenant_id AND r.id=i.role_id
        WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.staff_id=$3
        ORDER BY i.created_at DESC LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_optional(db)
    .await
}

pub async fn staff_login_invite_by_id(
    db: &PgPool,
    tenant_id: &str,
    id: &str,
) -> Result<Option<StaffLoginInviteRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffLoginInviteRecord>(
        r#"
        SELECT i.id,i.email,i.role_id,r.name role_name,
          CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
               WHEN i.revoked_at IS NOT NULL THEN 'revoked'
               WHEN i.expires_at<=NOW() THEN 'expired' ELSE 'pending' END status,
          i.expires_at,i.created_at,i.accepted_at,i.revoked_at,
          i.delivery_status,i.delivery_provider,i.provider_message_id,i.delivery_attempts,
          i.last_delivery_error,i.last_sent_at,i.delivered_at,i.bounced_at
        FROM staff_login_invitations i
        JOIN roles r ON r.tenant_id=i.tenant_id AND r.id=i.role_id
        WHERE i.tenant_id=$1 AND i.id=$2
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn record_staff_login_invite_delivery_attempt(
    db: &PgPool,
    tenant_id: &str,
    id: &str,
    status: &str,
    provider_message_id: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE staff_login_invitations
           SET delivery_status=$3,delivery_provider='webhook',provider_message_id=$4,
               delivery_attempts=delivery_attempts+1,last_delivery_error=$5,
               last_sent_at=CASE WHEN $3='sent' THEN NOW() ELSE last_sent_at END,updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2"#,
    )
    .bind(tenant_id)
    .bind(id)
    .bind(status)
    .bind(provider_message_id)
    .bind(error)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn revoke_staff_login_invite(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE staff_login_invitations SET revoked_at=NOW(),revoked_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(actor_user_id)
    .execute(db)
    .await?
    .rows_affected()
        > 0)
}

pub async fn preview_staff_login_invite(
    db: &PgPool,
    token_hash: &str,
) -> Result<Option<StaffLoginInvitePreviewRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffLoginInvitePreviewRecord>(
        r#"
        SELECT t.name tenant_name,b.name branch_name,
          COALESCE(NULLIF(CONCAT_WS(' ',s.first_name,NULLIF(s.middle_name,''),NULLIF(s.last_name,'')),''),'Staff') staff_name,
          i.email,r.name role_name,i.expires_at
        FROM staff_login_invitations i
        JOIN staff s ON s.tenant_id=i.tenant_id AND s.branch_id=i.branch_id AND s.id=i.staff_id
        JOIN roles r ON r.tenant_id=i.tenant_id AND r.id=i.role_id
        JOIN tenants t ON COALESCE(NULLIF(t.scope_id,''),t.id::TEXT)=i.tenant_id
        JOIN branches b ON b.tenant_id=t.id AND COALESCE(NULLIF(b.scope_id,''),b.id::TEXT)=i.branch_id
        WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at>NOW() AND s.active=TRUE AND s.user_id IS NULL
        LIMIT 1
        "#,
    )
    .bind(token_hash)
    .fetch_optional(db)
    .await
}

#[derive(FromRow)]
struct AcceptableStaffLoginInvite {
    id: String,
    tenant_id: String,
    branch_id: String,
    staff_id: String,
    role_id: String,
    email: String,
    full_name: String,
}

pub async fn accept_staff_login_invite(
    db: &PgPool,
    token_hash: &str,
    login_id: &str,
    password_hash: &str,
) -> Result<AcceptedStaffLoginInvite, sqlx::Error> {
    let mut tx = db.begin().await?;
    let invite = sqlx::query_as::<_, AcceptableStaffLoginInvite>(
        r#"
        SELECT i.id,i.tenant_id,i.branch_id,i.staff_id,i.role_id,i.email,
          COALESCE(NULLIF(CONCAT_WS(' ',s.first_name,NULLIF(s.middle_name,''),NULLIF(s.last_name,'')),''),'Staff') full_name
        FROM staff_login_invitations i
        JOIN staff s ON s.tenant_id=i.tenant_id AND s.branch_id=i.branch_id AND s.id=i.staff_id
        WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at>NOW()
        FOR UPDATE OF i
        "#,
    )
    .bind(token_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(sqlx::Error::RowNotFound)?;
    let user_id = insert_staff_login(
        tx.as_mut(),
        &ProvisionStaffLoginInput {
            tenant_id: &invite.tenant_id,
            branch_id: &invite.branch_id,
            staff_id: &invite.staff_id,
            login_id,
            email: &invite.email,
            password_hash,
            full_name: &invite.full_name,
            role_id: &invite.role_id,
        },
        false,
    )
    .await?;
    let consumed = sqlx::query(
        "UPDATE staff_login_invitations SET accepted_at=NOW(),accepted_user_id=$2,updated_at=NOW() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(&invite.id)
    .bind(&user_id)
    .execute(&mut *tx)
    .await?;
    if consumed.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    tx.commit().await?;
    Ok(AcceptedStaffLoginInvite {
        tenant_id: invite.tenant_id,
        branch_id: invite.branch_id,
        staff_id: invite.staff_id,
        user_id,
    })
}

pub async fn list_managed_auth_roles(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<AuthRoleRecord>, sqlx::Error> {
    sqlx::query_as::<_, AuthRoleRecord>(
        "SELECT id, name, permissions_json, denied_permissions_json, masked_fields_json, max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system FROM roles WHERE tenant_id=$1 ORDER BY is_system DESC, name ASC",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

pub async fn get_auth_role(
    db: &PgPool,
    tenant_id: &str,
    role_id: &str,
) -> Result<Option<AuthRoleRecord>, sqlx::Error> {
    sqlx::query_as::<_, AuthRoleRecord>(
        "SELECT id, name, permissions_json, denied_permissions_json, masked_fields_json, max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system FROM roles WHERE tenant_id=$1 AND id=$2",
    )
    .bind(tenant_id)
    .bind(role_id)
    .fetch_optional(db)
    .await
}

pub async fn create_auth_role(
    db: &PgPool,
    tenant_id: &str,
    name: &str,
    permissions_json: Value,
    denied_permissions_json: Value,
    masked_fields_json: Value,
    max_discount_paise: Option<i64>,
    max_refund_paise: Option<i64>,
    max_cash_movement_paise: Option<i64>,
) -> Result<AuthRoleRecord, sqlx::Error> {
    sqlx::query_as::<_, AuthRoleRecord>(
        r#"
        INSERT INTO roles (
          tenant_id, name, permissions_json, denied_permissions_json, masked_fields_json,
          max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)
        RETURNING id, name, permissions_json, denied_permissions_json, masked_fields_json,
                  max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system
        "#,
    )
    .bind(tenant_id)
    .bind(name)
    .bind(permissions_json)
    .bind(denied_permissions_json)
    .bind(masked_fields_json)
    .bind(max_discount_paise)
    .bind(max_refund_paise)
    .bind(max_cash_movement_paise)
    .fetch_one(db)
    .await
}

pub async fn update_auth_role(
    db: &PgPool,
    tenant_id: &str,
    role_id: &str,
    name: &str,
    permissions_json: Value,
    denied_permissions_json: Value,
    masked_fields_json: Value,
    max_discount_paise: Option<i64>,
    max_refund_paise: Option<i64>,
    max_cash_movement_paise: Option<i64>,
) -> Result<Option<AuthRoleRecord>, sqlx::Error> {
    sqlx::query_as::<_, AuthRoleRecord>(
        r#"
        UPDATE roles
        SET name=$3, permissions_json=$4, denied_permissions_json=$5, masked_fields_json=$6,
            max_discount_paise=$7, max_refund_paise=$8, max_cash_movement_paise=$9,
            updated_at=NOW()
        WHERE tenant_id=$1 AND id=$2 AND is_system=FALSE
        RETURNING id, name, permissions_json, denied_permissions_json, masked_fields_json,
                  max_discount_paise, max_refund_paise, max_cash_movement_paise, is_system
        "#,
    )
    .bind(tenant_id)
    .bind(role_id)
    .bind(name)
    .bind(permissions_json)
    .bind(denied_permissions_json)
    .bind(masked_fields_json)
    .bind(max_discount_paise)
    .bind(max_refund_paise)
    .bind(max_cash_movement_paise)
    .fetch_optional(db)
    .await
}

pub async fn replace_branch_access(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    assignments: &[BranchRoleAssignmentInput],
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        "UPDATE user_branch_roles SET active=FALSE, is_default=FALSE, updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    for assignment in assignments {
        let result = sqlx::query(
            r#"
            INSERT INTO user_branch_roles (
              tenant_id, user_id, branch_id, role_id, role_name, access_type,
              valid_from, valid_until, is_default, active, updated_at
            )
            SELECT $1, $2, $3, role.id, role.name, $5, $6, $7, $8, $9, NOW()
            FROM roles role
            WHERE role.tenant_id=$1 AND role.id=$4
              AND REGEXP_REPLACE(LOWER(role.name), '[-_ ]', '', 'g') NOT IN ('owner','admin','superadmin')
            ON CONFLICT (tenant_id, user_id, branch_id) DO UPDATE SET
              role_id=EXCLUDED.role_id,
              role_name=EXCLUDED.role_name,
              access_type=EXCLUDED.access_type,
              valid_from=EXCLUDED.valid_from,
              valid_until=EXCLUDED.valid_until,
              is_default=EXCLUDED.is_default,
              active=EXCLUDED.active,
              updated_at=NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(&assignment.branch_id)
        .bind(&assignment.role_id)
        .bind(&assignment.access_type)
        .bind(assignment.valid_from)
        .bind(assignment.valid_until)
        .bind(assignment.is_default)
        .bind(assignment.active)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            tx.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }
    }

    if let Some(default) = assignments
        .iter()
        .find(|assignment| assignment.active && assignment.is_default)
    {
        sqlx::query(
            r#"
            UPDATE users user_account
            SET branch_id=$3, role_id=role.id, role_name=role.name, updated_at=NOW()
            FROM roles role
            WHERE user_account.tenant_id=$1 AND user_account.id=$2
              AND role.tenant_id=$1 AND role.id=$4
            "#,
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(&default.branch_id)
        .bind(&default.role_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE users SET branch_id=NULL, role_id=NULL, updated_at=NOW() WHERE tenant_id=$1 AND id=$2",
        )
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "UPDATE auth_refresh_tokens SET revoked_at=NOW(), revoke_reason='branch_access_changed' WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL",
    )
    .bind(tenant_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub async fn get_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Option<StaffProfileRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffProfileRecord>(
        r#"
        SELECT staff_id, category_id, shift_template_id, pricing_level_id, designation, company_name, mandatory_break_minutes, work_tasks_json,
               max_work_hours, target_revenue_paise, vacation_days, special_leave_days,
               tenure_start_date, booking_interval_minutes, restrict_booking_to_returning_guests,
               photo_url, date_of_birth, joining_date, gender, employment_type, department,
               reporting_manager_id, address_line1, address_line2, city, state_name, postal_code,
               country, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
        FROM staff_profiles
        WHERE tenant_id = $1 AND branch_id = $2 AND staff_id = $3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_optional(db)
    .await
}

#[cfg(test)]
mod security_tests {
    use super::{replace_branch_access, BranchRoleAssignmentInput};
    use sqlx::PgPool;

    #[sqlx::test(migrations = false)]
    async fn staff_security_protected_roles_cannot_replace_branch_access(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE TABLE roles(id TEXT, tenant_id TEXT, name TEXT, PRIMARY KEY(tenant_id,id));
            CREATE TABLE user_branch_roles(
              tenant_id TEXT,user_id TEXT,branch_id TEXT,role_id TEXT,role_name TEXT,
              access_type TEXT,valid_from DATE,valid_until DATE,is_default BOOLEAN,
              active BOOLEAN,updated_at TIMESTAMPTZ,
              PRIMARY KEY(tenant_id,user_id,branch_id)
            );
            CREATE TABLE users(
              id TEXT,tenant_id TEXT,branch_id TEXT,role_id TEXT,role_name TEXT,
              updated_at TIMESTAMPTZ,PRIMARY KEY(tenant_id,id)
            );
            CREATE TABLE auth_refresh_tokens(
              tenant_id TEXT,user_id TEXT,revoked_at TIMESTAMPTZ,revoke_reason TEXT
            );
            INSERT INTO roles VALUES
              ('manager','tenant-1','Manager'),
              ('owner','tenant-1','Owner');
            INSERT INTO users(id,tenant_id) VALUES('user-1','tenant-1');
            INSERT INTO auth_refresh_tokens(tenant_id,user_id) VALUES('tenant-1','user-1');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let assignment = |role_id: &str| BranchRoleAssignmentInput {
            branch_id: "branch-1".into(),
            role_id: role_id.into(),
            access_type: "permanent".into(),
            valid_from: None,
            valid_until: None,
            is_default: true,
            active: true,
        };
        replace_branch_access(&pool, "tenant-1", "user-1", &[assignment("manager")])
            .await
            .unwrap();
        assert!(matches!(
            replace_branch_access(&pool, "tenant-1", "user-1", &[assignment("owner")]).await,
            Err(sqlx::Error::RowNotFound)
        ));

        let role: (String, bool) = sqlx::query_as(
            "SELECT role_name,active FROM user_branch_roles WHERE tenant_id='tenant-1' AND user_id='user-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(role, ("Manager".into(), true));
    }
}

pub async fn upsert_profile(
    db: &PgPool,
    input: UpsertStaffProfile<'_>,
) -> Result<StaffProfileRecord, sqlx::Error> {
    sqlx::query_as::<_, StaffProfileRecord>(
        r#"
        INSERT INTO staff_profiles (
          staff_id, tenant_id, branch_id, category_id, shift_template_id, pricing_level_id,
          designation, company_name, mandatory_break_minutes,
          work_tasks_json, max_work_hours, target_revenue_paise, vacation_days,
          special_leave_days, tenure_start_date, booking_interval_minutes,
          restrict_booking_to_returning_guests, photo_url, date_of_birth, joining_date, gender,
          employment_type, department, reporting_manager_id, address_line1, address_line2, city,
          state_name, postal_code, country, emergency_contact_name,
          emergency_contact_relationship, emergency_contact_phone
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
        ON CONFLICT (staff_id) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          shift_template_id = EXCLUDED.shift_template_id,
          pricing_level_id = EXCLUDED.pricing_level_id,
          designation = EXCLUDED.designation,
          company_name = EXCLUDED.company_name,
          mandatory_break_minutes = EXCLUDED.mandatory_break_minutes,
          work_tasks_json = EXCLUDED.work_tasks_json,
          max_work_hours = EXCLUDED.max_work_hours,
          target_revenue_paise = EXCLUDED.target_revenue_paise,
          vacation_days = EXCLUDED.vacation_days,
          special_leave_days = EXCLUDED.special_leave_days,
          tenure_start_date = EXCLUDED.tenure_start_date,
          booking_interval_minutes = EXCLUDED.booking_interval_minutes,
          restrict_booking_to_returning_guests = EXCLUDED.restrict_booking_to_returning_guests,
          photo_url = EXCLUDED.photo_url,
          date_of_birth = EXCLUDED.date_of_birth,
          joining_date = EXCLUDED.joining_date,
          gender = EXCLUDED.gender,
          employment_type = EXCLUDED.employment_type,
          department = EXCLUDED.department,
          reporting_manager_id = EXCLUDED.reporting_manager_id,
          address_line1 = EXCLUDED.address_line1,
          address_line2 = EXCLUDED.address_line2,
          city = EXCLUDED.city,
          state_name = EXCLUDED.state_name,
          postal_code = EXCLUDED.postal_code,
          country = EXCLUDED.country,
          emergency_contact_name = EXCLUDED.emergency_contact_name,
          emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
          emergency_contact_phone = EXCLUDED.emergency_contact_phone,
          updated_at = NOW()
        RETURNING staff_id, category_id, shift_template_id, pricing_level_id, designation, company_name, mandatory_break_minutes, work_tasks_json,
                  max_work_hours, target_revenue_paise, vacation_days, special_leave_days,
                  tenure_start_date, booking_interval_minutes, restrict_booking_to_returning_guests,
                  photo_url, date_of_birth, joining_date, gender, employment_type, department,
                  reporting_manager_id, address_line1, address_line2, city, state_name, postal_code,
                  country, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
        "#,
    )
    .bind(input.staff_id)
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.category_id)
    .bind(input.shift_template_id)
    .bind(input.pricing_level_id)
    .bind(input.designation)
    .bind(input.company_name)
    .bind(input.mandatory_break_minutes)
    .bind(input.work_tasks_json)
    .bind(input.max_work_hours)
    .bind(input.target_revenue_paise)
    .bind(input.vacation_days)
    .bind(input.special_leave_days)
    .bind(input.tenure_start_date)
    .bind(input.booking_interval_minutes)
    .bind(input.restrict_booking_to_returning_guests)
    .bind(input.photo_url)
    .bind(input.date_of_birth)
    .bind(input.joining_date)
    .bind(input.gender)
    .bind(input.employment_type)
    .bind(input.department)
    .bind(input.reporting_manager_id)
    .bind(input.address_line1)
    .bind(input.address_line2)
    .bind(input.city)
    .bind(input.state_name)
    .bind(input.postal_code)
    .bind(input.country)
    .bind(input.emergency_contact_name)
    .bind(input.emergency_contact_relationship)
    .bind(input.emergency_contact_phone)
    .fetch_one(db)
    .await
}

pub async fn create(db: &PgPool, input: CreateStaff<'_>) -> Result<StaffRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("staff-employee-code:{}", input.tenant_id))
        .execute(&mut *tx)
        .await?;
    let next_code = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COALESCE(MAX(employee_code::BIGINT), 0) + 1
        FROM staff
        WHERE tenant_id = $1 AND employee_code ~ '^[0-9]{1,18}$'
        "#,
    )
    .bind(input.tenant_id)
    .fetch_one(&mut *tx)
    .await?;
    let employee_code = format!("{next_code:04}");

    let row = sqlx::query_as::<_, StaffRecord>(
        r#"
        INSERT INTO staff (
          tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone, job_title
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING
          id, tenant_id, branch_id, user_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone,
          job_title, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(employee_code)
    .bind(input.first_name)
    .bind(input.middle_name)
    .bind(input.last_name)
    .bind(input.appointment_display_name)
    .bind(input.email)
    .bind(input.mobile_phone)
    .bind(input.home_phone)
    .bind(input.work_phone)
    .bind(input.job_title)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn update(
    db: &PgPool,
    input: UpdateStaff<'_>,
) -> Result<Option<StaffRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffRecord>(
        r#"
        UPDATE staff
        SET
          employee_code = COALESCE($4, employee_code),
          first_name = COALESCE($5, first_name),
          middle_name = COALESCE($6, middle_name),
          last_name = COALESCE($7, last_name),
          appointment_display_name = COALESCE($8, appointment_display_name),
          email = COALESCE($9, email),
          mobile_phone = COALESCE($10, mobile_phone),
          home_phone = COALESCE($11, home_phone),
          work_phone = COALESCE($12, work_phone),
          job_title = COALESCE($13, job_title),
          active = COALESCE($14, active),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id, tenant_id, branch_id, user_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone,
          job_title, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.employee_code)
    .bind(input.first_name)
    .bind(input.middle_name)
    .bind(input.last_name)
    .bind(input.appointment_display_name)
    .bind(input.email)
    .bind(input.mobile_phone)
    .bind(input.home_phone)
    .bind(input.work_phone)
    .bind(input.job_title)
    .bind(input.active)
    .fetch_optional(db)
    .await
}
