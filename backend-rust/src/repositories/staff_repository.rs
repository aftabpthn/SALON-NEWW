use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct StaffRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
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

pub struct CreateStaff<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub employee_code: Option<&'a str>,
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
}

pub struct UpsertStaffProfile<'a> {
    pub staff_id: &'a str,
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
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
          id, tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
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
          id, tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
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

pub async fn get_profile(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Option<StaffProfileRecord>, sqlx::Error> {
    sqlx::query_as::<_, StaffProfileRecord>(
        r#"
        SELECT staff_id, designation, company_name, mandatory_break_minutes, work_tasks_json,
               max_work_hours, target_revenue_paise, vacation_days, special_leave_days,
               tenure_start_date, booking_interval_minutes, restrict_booking_to_returning_guests
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

pub async fn upsert_profile(
    db: &PgPool,
    input: UpsertStaffProfile<'_>,
) -> Result<StaffProfileRecord, sqlx::Error> {
    sqlx::query_as::<_, StaffProfileRecord>(
        r#"
        INSERT INTO staff_profiles (
          staff_id, tenant_id, branch_id, designation, company_name, mandatory_break_minutes,
          work_tasks_json, max_work_hours, target_revenue_paise, vacation_days,
          special_leave_days, tenure_start_date, booking_interval_minutes,
          restrict_booking_to_returning_guests
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (staff_id) DO UPDATE SET
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
          updated_at = NOW()
        RETURNING staff_id, designation, company_name, mandatory_break_minutes, work_tasks_json,
                  max_work_hours, target_revenue_paise, vacation_days, special_leave_days,
                  tenure_start_date, booking_interval_minutes, restrict_booking_to_returning_guests
        "#,
    )
    .bind(input.staff_id)
    .bind(input.tenant_id)
    .bind(input.branch_id)
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
    .fetch_one(db)
    .await
}

pub async fn create(db: &PgPool, input: CreateStaff<'_>) -> Result<StaffRecord, sqlx::Error> {
    sqlx::query_as::<_, StaffRecord>(
        r#"
        INSERT INTO staff (
          tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone, job_title
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING
          id, tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
          appointment_display_name, email, mobile_phone, home_phone, work_phone,
          job_title, active, created_at, updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
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
    .fetch_one(db)
    .await
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
          id, tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
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
