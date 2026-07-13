use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        staff_configuration_repository::{
            CatalogAssignmentInput, CommissionRuleInput, LeavePolicyInput, PayRateInput,
            ReplaceConfigurationInput,
        },
        staff_repository::{self, CreateStaff, StaffProfileRecord, StaffRecord, UpdateStaff},
    },
    routes::context::tenant_branch,
    services::staff_service,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff", get(list_staff).post(create_staff))
        .route("/staff/list", get(list_staff_page))
        .route(
            "/staff/:id/profile",
            get(get_staff_profile).patch(update_staff_profile),
        )
        .route(
            "/staff/:id/configuration",
            get(get_staff_configuration).put(update_staff_configuration),
        )
        .route("/staff/:id/password", post(set_staff_password))
        .route("/staff/:id/terminate", post(terminate_staff))
        .route("/staff/:id", get(get_staff).patch(update_staff))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffListQuery {
    pub q: Option<String>,
    pub job: Option<String>,
    pub active: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffListPage {
    pub items: Vec<StaffResponse>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub jobs: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffWriteRequest {
    pub employee_code: Option<String>,
    pub first_name: Option<String>,
    pub middle_name: Option<String>,
    pub last_name: Option<String>,
    pub appointment_display_name: Option<String>,
    pub email: Option<String>,
    pub mobile_phone: Option<String>,
    pub home_phone: Option<String>,
    pub work_phone: Option<String>,
    pub job_title: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffResponse {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffProfileWriteRequest {
    pub designation: Option<String>,
    pub company_name: Option<String>,
    pub mandatory_break_minutes: Option<i32>,
    pub work_tasks: Option<Vec<String>>,
    pub max_work_hours: Option<i32>,
    pub target_revenue_paise: Option<i64>,
    pub vacation_days: Option<i32>,
    pub special_leave_days: Option<i32>,
    pub tenure_start_date: Option<NaiveDate>,
    pub booking_interval_minutes: Option<i32>,
    pub restrict_booking_to_returning_guests: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffProfileResponse {
    pub staff: StaffResponse,
    pub designation: String,
    pub company_name: String,
    pub mandatory_break_minutes: Option<i32>,
    pub work_tasks: Vec<String>,
    pub max_work_hours: Option<i32>,
    pub target_revenue_paise: Option<i64>,
    pub vacation_days: Option<i32>,
    pub special_leave_days: Option<i32>,
    pub tenure_start_date: Option<NaiveDate>,
    pub booking_interval_minutes: Option<i32>,
    pub restrict_booking_to_returning_guests: bool,
    pub linked_login: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPasswordRequest {
    pub new_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPasswordResponse {
    pub password_updated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffConfigurationWriteRequest {
    #[serde(default)]
    pub role_ids: Vec<String>,
    #[serde(default)]
    pub catalog_assignments: Vec<CatalogAssignmentRequest>,
    #[serde(default)]
    pub commission_rules: Vec<CommissionRuleRequest>,
    #[serde(default)]
    pub pay_rates: Vec<PayRateRequest>,
    #[serde(default)]
    pub leave_policies: Vec<LeavePolicyRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAssignmentRequest {
    pub item_type: String,
    pub item_id: String,
    pub commission_percent: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommissionRuleRequest {
    pub name: String,
    pub applies_to: String,
    pub rate_percent: i32,
    pub effective_from: Option<NaiveDate>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayRateRequest {
    pub rate_type: String,
    pub amount_paise: i64,
    pub effective_from: Option<NaiveDate>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeavePolicyRequest {
    pub name: String,
    pub leave_type: String,
    pub annual_days: i32,
    pub active: Option<bool>,
}

async fn list_staff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StaffListQuery>,
) -> ApiResult<Vec<StaffResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = staff_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list staff"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(StaffResponse::from).collect(),
    )))
}

async fn list_staff_page(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StaffListQuery>,
) -> ApiResult<StaffListPage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(25).clamp(1, 100);
    let filters = staff_repository::StaffListFilters {
        query: query.q.as_deref().unwrap_or("").trim(),
        job: query.job.as_deref().unwrap_or("").trim(),
        active: query.active,
    };
    let sort_column = staff_sort_column(query.sort_by.as_deref());
    let sort_direction = staff_sort_direction(query.sort_direction.as_deref());
    let offset = (page - 1) * page_size;

    let (rows, total, jobs) = tokio::try_join!(
        staff_repository::list_filtered(
            &state.db,
            &tenant_id,
            &branch_id,
            &filters,
            sort_column,
            sort_direction,
            page_size,
            offset,
        ),
        staff_repository::count_filtered(&state.db, &tenant_id, &branch_id, &filters),
        staff_repository::list_job_titles(&state.db, &tenant_id, &branch_id),
    )
    .map_err(|_| AppError::internal("failed to list staff"))?;

    Ok(Json(ApiResponse::ok(StaffListPage {
        items: rows.into_iter().map(StaffResponse::from).collect(),
        total,
        page,
        page_size,
        jobs,
    })))
}

async fn get_staff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<StaffResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .ok_or_else(|| AppError::not_found("staff was not found"))?;

    Ok(Json(ApiResponse::ok(StaffResponse::from(row))))
}

async fn create_staff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<StaffWriteRequest>,
) -> ApiResult<StaffResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let first_name = required_text(payload.first_name.as_deref(), "firstName is required")?;

    let row = staff_repository::create(
        &state.db,
        CreateStaff {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            employee_code: payload
                .employee_code
                .as_deref()
                .filter(|value| !value.trim().is_empty()),
            first_name,
            middle_name: payload.middle_name.as_deref().unwrap_or(""),
            last_name: payload.last_name.as_deref().unwrap_or(""),
            appointment_display_name: payload
                .appointment_display_name
                .as_deref()
                .unwrap_or(first_name),
            email: payload.email.as_deref().unwrap_or(""),
            mobile_phone: payload.mobile_phone.as_deref().unwrap_or(""),
            home_phone: payload.home_phone.as_deref().unwrap_or(""),
            work_phone: payload.work_phone.as_deref().unwrap_or(""),
            job_title: payload.job_title.as_deref().unwrap_or(""),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create staff"))?;

    Ok(Json(ApiResponse::ok(StaffResponse::from(row))))
}

async fn update_staff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffWriteRequest>,
) -> ApiResult<StaffResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_repository::update(
        &state.db,
        UpdateStaff {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            employee_code: payload.employee_code.as_deref(),
            first_name: payload.first_name.as_deref(),
            middle_name: payload.middle_name.as_deref(),
            last_name: payload.last_name.as_deref(),
            appointment_display_name: payload.appointment_display_name.as_deref(),
            email: payload.email.as_deref(),
            mobile_phone: payload.mobile_phone.as_deref(),
            home_phone: payload.home_phone.as_deref(),
            work_phone: payload.work_phone.as_deref(),
            job_title: payload.job_title.as_deref(),
            active: payload.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update staff"))?
    .ok_or_else(|| AppError::not_found("staff was not found"))?;

    Ok(Json(ApiResponse::ok(StaffResponse::from(row))))
}

async fn get_staff_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<StaffProfileResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff = staff_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .ok_or_else(|| AppError::not_found("staff was not found"))?;
    let profile = staff_repository::get_profile(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load staff profile"))?;
    let linked_login = staff_service::has_linked_login(&state.db, &tenant_id, &staff.email).await?;

    Ok(Json(ApiResponse::ok(profile_response(
        staff,
        profile,
        linked_login,
    ))))
}

async fn update_staff_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffProfileWriteRequest>,
) -> ApiResult<StaffProfileResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff = staff_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .ok_or_else(|| AppError::not_found("staff was not found"))?;
    ensure_non_negative(
        payload.mandatory_break_minutes.map(i64::from),
        "mandatoryBreakMinutes",
    )?;
    ensure_non_negative(payload.max_work_hours.map(i64::from), "maxWorkHours")?;
    ensure_non_negative(payload.target_revenue_paise, "targetRevenuePaise")?;
    ensure_non_negative(payload.vacation_days.map(i64::from), "vacationDays")?;
    ensure_non_negative(
        payload.special_leave_days.map(i64::from),
        "specialLeaveDays",
    )?;
    ensure_non_negative(
        payload.booking_interval_minutes.map(i64::from),
        "bookingIntervalMinutes",
    )?;

    let work_tasks = payload
        .work_tasks
        .unwrap_or_default()
        .into_iter()
        .map(|task| task.trim().to_string())
        .filter(|task| !task.is_empty())
        .collect::<Vec<_>>();
    if work_tasks.len() > 50 {
        return Err(AppError::validation("workTasks supports up to 50 tasks"));
    }

    let profile = staff_repository::upsert_profile(
        &state.db,
        staff_repository::UpsertStaffProfile {
            staff_id: &id,
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            designation: payload.designation.as_deref().unwrap_or("").trim(),
            company_name: payload.company_name.as_deref().unwrap_or("").trim(),
            mandatory_break_minutes: payload.mandatory_break_minutes,
            work_tasks_json: json!(work_tasks),
            max_work_hours: payload.max_work_hours,
            target_revenue_paise: payload.target_revenue_paise,
            vacation_days: payload.vacation_days,
            special_leave_days: payload.special_leave_days,
            tenure_start_date: payload.tenure_start_date,
            booking_interval_minutes: payload.booking_interval_minutes,
            restrict_booking_to_returning_guests: payload
                .restrict_booking_to_returning_guests
                .unwrap_or(false),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to save staff profile"))?;
    let linked_login = staff_service::has_linked_login(&state.db, &tenant_id, &staff.email).await?;

    Ok(Json(ApiResponse::ok(profile_response(
        staff,
        Some(profile),
        linked_login,
    ))))
}

async fn get_staff_configuration(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<staff_service::StaffConfigurationData> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let configuration =
        staff_service::load_configuration(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(configuration)))
}

async fn update_staff_configuration(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffConfigurationWriteRequest>,
) -> ApiResult<staff_service::StaffConfigurationData> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let configuration = staff_service::save_configuration(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        ReplaceConfigurationInput {
            role_ids: payload
                .role_ids
                .into_iter()
                .map(|id| id.trim().to_string())
                .collect(),
            catalog_assignments: payload
                .catalog_assignments
                .into_iter()
                .map(|item| CatalogAssignmentInput {
                    item_type: item.item_type.trim().to_lowercase(),
                    item_id: item.item_id.trim().to_string(),
                    commission_percent: item.commission_percent,
                })
                .collect(),
            commission_rules: payload
                .commission_rules
                .into_iter()
                .map(|rule| CommissionRuleInput {
                    name: rule.name.trim().to_string(),
                    applies_to: rule.applies_to.trim().to_lowercase(),
                    rate_percent: rule.rate_percent,
                    effective_from: rule.effective_from,
                    active: rule.active.unwrap_or(true),
                })
                .collect(),
            pay_rates: payload
                .pay_rates
                .into_iter()
                .map(|rate| PayRateInput {
                    rate_type: rate.rate_type.trim().to_lowercase(),
                    amount_paise: rate.amount_paise,
                    effective_from: rate.effective_from,
                    active: rate.active.unwrap_or(true),
                })
                .collect(),
            leave_policies: payload
                .leave_policies
                .into_iter()
                .map(|policy| LeavePolicyInput {
                    name: policy.name.trim().to_string(),
                    leave_type: policy.leave_type.trim().to_lowercase(),
                    annual_days: policy.annual_days,
                    active: policy.active.unwrap_or(true),
                })
                .collect(),
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(configuration)))
}

async fn set_staff_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffPasswordRequest>,
) -> ApiResult<StaffPasswordResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    staff_service::set_password(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload.new_password.trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(StaffPasswordResponse {
        password_updated: true,
    })))
}

async fn terminate_staff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<StaffResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff = staff_service::terminate(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(StaffResponse::from(staff))))
}

fn required_text<'a>(value: Option<&'a str>, message: &'static str) -> Result<&'a str, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation(message))
}

fn staff_sort_column(value: Option<&str>) -> &'static str {
    match value.unwrap_or("firstName") {
        "employeeCode" => "employee_code",
        "firstName" => "first_name",
        "lastName" => "last_name",
        "mobilePhone" => "mobile_phone",
        "jobTitle" => "job_title",
        "active" => "active",
        "branchId" => "branch_id",
        _ => "first_name",
    }
}

fn staff_sort_direction(value: Option<&str>) -> &'static str {
    if value.is_some_and(|direction| direction.eq_ignore_ascii_case("desc")) {
        "DESC"
    } else {
        "ASC"
    }
}

fn ensure_non_negative(value: Option<i64>, field: &'static str) -> Result<(), AppError> {
    if value.is_some_and(|number| number < 0) {
        return Err(AppError::validation(format!(
            "{field} must not be negative"
        )));
    }
    Ok(())
}

fn profile_response(
    staff: StaffRecord,
    profile: Option<StaffProfileRecord>,
    linked_login: bool,
) -> StaffProfileResponse {
    let profile = profile;
    let work_tasks = profile
        .as_ref()
        .and_then(|record| record.work_tasks_json.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    StaffProfileResponse {
        staff: StaffResponse::from(staff),
        designation: profile
            .as_ref()
            .map(|record| record.designation.clone())
            .unwrap_or_default(),
        company_name: profile
            .as_ref()
            .map(|record| record.company_name.clone())
            .unwrap_or_default(),
        mandatory_break_minutes: profile
            .as_ref()
            .and_then(|record| record.mandatory_break_minutes),
        work_tasks,
        max_work_hours: profile.as_ref().and_then(|record| record.max_work_hours),
        target_revenue_paise: profile
            .as_ref()
            .and_then(|record| record.target_revenue_paise),
        vacation_days: profile.as_ref().and_then(|record| record.vacation_days),
        special_leave_days: profile
            .as_ref()
            .and_then(|record| record.special_leave_days),
        tenure_start_date: profile.as_ref().and_then(|record| record.tenure_start_date),
        booking_interval_minutes: profile
            .as_ref()
            .and_then(|record| record.booking_interval_minutes),
        restrict_booking_to_returning_guests: profile
            .as_ref()
            .is_some_and(|record| record.restrict_booking_to_returning_guests),
        linked_login,
    }
}

impl From<StaffRecord> for StaffResponse {
    fn from(record: StaffRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            employee_code: record.employee_code,
            first_name: record.first_name,
            middle_name: record.middle_name,
            last_name: record.last_name,
            appointment_display_name: record.appointment_display_name,
            email: record.email,
            mobile_phone: record.mobile_phone,
            home_phone: record.home_phone,
            work_phone: record.work_phone,
            job_title: record.job_title,
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_non_negative, staff_sort_column, staff_sort_direction};

    #[test]
    fn staff_listing_sort_is_allowlisted() {
        assert_eq!(staff_sort_column(Some("firstName")), "first_name");
        assert_eq!(staff_sort_column(Some("DROP TABLE staff")), "first_name");
        assert_eq!(staff_sort_direction(Some("DESC")), "DESC");
        assert_eq!(staff_sort_direction(Some("invalid")), "ASC");
    }

    #[test]
    fn staff_profile_numbers_reject_negative_values() {
        assert!(ensure_non_negative(Some(0), "vacationDays").is_ok());
        assert!(ensure_non_negative(None, "vacationDays").is_ok());
        assert!(ensure_non_negative(Some(-1), "vacationDays").is_err());
    }
}
