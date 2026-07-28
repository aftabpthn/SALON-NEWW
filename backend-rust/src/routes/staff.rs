use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_configuration_repository::{
            AttendanceRuleInput, CatalogAssignmentInput, CommissionRuleInput, LeavePolicyInput,
            PayRateInput, ReplaceConfigurationInput, ReplaceStaffMastersInput, ShiftTemplateInput,
            StaffCategoryInput, StaffPricingLevelInput,
        },
        staff_hr_repository::{
            self, BulkStaffInput, SaveStaffDocument, StaffDocumentRecord, StaffHistoryRecord,
        },
        staff_repository::{self, CreateStaff, StaffProfileRecord, StaffRecord, UpdateStaff},
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, staff_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff", get(list_staff).post(create_staff))
        .route("/staff/list", get(list_staff_page))
        .route("/staff/bulk-imports", post(import_staff_bulk))
        .route("/staff/files/:file_id", get(get_staff_file))
        .route(
            "/staff/:id/files",
            post(upload_staff_file).layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
        )
        .route(
            "/staff/masters",
            get(get_staff_masters).put(update_staff_masters),
        )
        .route(
            "/staff/auth-roles",
            get(list_auth_roles).post(create_auth_role),
        )
        .route(
            "/staff/auth-roles/:role_id",
            axum::routing::put(update_auth_role),
        )
        .route(
            "/staff/:id/profile",
            get(get_staff_profile).patch(update_staff_profile),
        )
        .route(
            "/staff/:id/documents",
            get(list_staff_documents).post(create_staff_document),
        )
        .route(
            "/staff/:id/documents/:document_id",
            axum::routing::patch(update_staff_document),
        )
        .route("/staff/:id/hr-history", get(list_staff_history))
        .route(
            "/staff/:id/configuration",
            get(get_staff_configuration).put(update_staff_configuration),
        )
        .route(
            "/staff/:id/branch-access",
            get(get_staff_branch_access).put(update_staff_branch_access),
        )
        .route("/staff/:id/login", post(provision_staff_login))
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
    pub photo_url: String,
    pub service_ids: Vec<String>,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffProfileWriteRequest {
    pub category_id: Option<String>,
    pub shift_template_id: Option<String>,
    pub pricing_level_id: Option<String>,
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
    pub photo_url: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub joining_date: Option<NaiveDate>,
    pub gender: Option<String>,
    pub employment_type: Option<String>,
    pub department: Option<String>,
    pub reporting_manager_id: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state_name: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub emergency_contact_name: Option<String>,
    pub emergency_contact_relationship: Option<String>,
    pub emergency_contact_phone: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffProfileResponse {
    pub staff: StaffResponse,
    pub category_id: Option<String>,
    pub shift_template_id: Option<String>,
    pub pricing_level_id: Option<String>,
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
    pub linked_login: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffDocumentWriteRequest {
    pub document_type: String,
    pub document_name: String,
    pub document_url: String,
    pub verification_status: Option<String>,
    pub expiry_date: Option<NaiveDate>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFileUploadQuery {
    pub kind: String,
    pub file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFileUploadResponse {
    pub file_id: String,
    pub file_url: String,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffBulkImportRequest {
    pub batch_id: String,
    pub rows: Vec<StaffBulkImportRowRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffBulkImportRowRequest {
    pub employee_code: String,
    pub first_name: String,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub mobile_phone: Option<String>,
    pub job_title: Option<String>,
    pub active: Option<bool>,
    pub photo_url: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub joining_date: Option<NaiveDate>,
    pub gender: Option<String>,
    pub employment_type: Option<String>,
    pub department: Option<String>,
    pub reporting_manager_id: Option<String>,
    pub category_id: Option<String>,
    pub shift_template_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffMastersWriteRequest {
    #[serde(default)]
    pub categories: Vec<StaffCategoryRequest>,
    #[serde(default)]
    pub pricing_levels: Vec<StaffPricingLevelRequest>,
    #[serde(default)]
    pub shift_templates: Vec<ShiftTemplateRequest>,
    pub attendance_rule: AttendanceRuleRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffCategoryRequest {
    pub id: Option<String>,
    pub code: String,
    pub name: String,
    pub designation: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPricingLevelRequest {
    pub id: Option<String>,
    pub code: String,
    pub name: String,
    pub rank: Option<i32>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftTemplateRequest {
    pub id: Option<String>,
    pub code: String,
    pub name: String,
    pub shift1_start: NaiveTime,
    pub shift1_end: NaiveTime,
    pub shift2_start: Option<NaiveTime>,
    pub shift2_end: Option<NaiveTime>,
    pub break_minutes: Option<i32>,
    #[serde(default)]
    pub weekly_off_days: Vec<i16>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendanceRuleRequest {
    pub grace_minutes: Option<i32>,
    pub half_day_after_minutes: Option<i32>,
    pub absent_after_minutes: Option<i32>,
    pub overtime_after_minutes: Option<i32>,
    pub early_leave_grace_minutes: Option<i32>,
    pub deduct_breaks: Option<bool>,
    pub minimum_overtime_minutes: Option<i32>,
    pub overtime_rounding_minutes: Option<i32>,
    pub maximum_overtime_minutes: Option<i32>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPasswordRequest {
    pub new_password: String,
    pub must_change_password: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffLoginProvisionRequest {
    pub login_id: String,
    pub email: String,
    pub initial_password: String,
    pub role_id: String,
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
pub struct StaffBranchAccessWriteRequest {
    #[serde(default)]
    pub assignments: Vec<StaffBranchAccessAssignmentRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffBranchAccessAssignmentRequest {
    pub branch_id: String,
    pub role_id: Option<String>,
    pub access_type: Option<String>,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub is_default: Option<bool>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRoleWriteRequest {
    pub name: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub denied_permissions: Vec<String>,
    #[serde(default)]
    pub masked_fields: Vec<String>,
    pub max_discount_paise: Option<i64>,
    pub max_refund_paise: Option<i64>,
    pub max_cash_movement_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAssignmentRequest {
    pub item_type: String,
    pub item_id: String,
    pub commission_percent: Option<i32>,
    pub pricing_level_price_paise: Option<i64>,
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
    let q = query.q.as_deref().unwrap_or("").trim();
    let filters = staff_repository::StaffListFilters {
        query: q,
        job: query.job.as_deref().unwrap_or("").trim(),
        active: query.active,
    };

    let rows = staff_repository::list_filtered(
        &state.db,
        &tenant_id,
        &branch_id,
        &filters,
        "created_at",
        "DESC",
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list staff"))?;

    let rows = staff_responses_with_service_ids(&state, &tenant_id, &branch_id, rows).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn staff_responses_with_service_ids(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    rows: Vec<StaffRecord>,
) -> Result<Vec<StaffResponse>, AppError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let staff_ids = rows
        .iter()
        .map(|staff| staff.id.clone())
        .collect::<Vec<_>>();
    let service_rows = sqlx::query(
        "SELECT staff_id, service_id
         FROM staff_service_assignments
         WHERE tenant_id=$1 AND branch_id=$2 AND staff_id = ANY($3::TEXT[])
         UNION
         SELECT staff_id, item_id AS service_id
         FROM staff_catalog_assignments
         WHERE tenant_id=$1 AND branch_id=$2 AND item_type='service' AND staff_id = ANY($3::TEXT[])",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load staff service assignments"))?;
    let photo_rows = sqlx::query(
        "SELECT staff_id, photo_url
         FROM staff_profiles
         WHERE tenant_id=$1 AND branch_id=$2 AND staff_id = ANY($3::TEXT[])",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load staff photos"))?;

    let mut service_ids_by_staff: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for row in service_rows {
        let staff_id = row.try_get::<String, _>("staff_id").unwrap_or_default();
        let service_id = row.try_get::<String, _>("service_id").unwrap_or_default();
        if !staff_id.is_empty() && !service_id.is_empty() {
            service_ids_by_staff
                .entry(staff_id)
                .or_default()
                .push(service_id);
        }
    }
    let mut photo_url_by_staff = photo_rows
        .into_iter()
        .filter_map(|row| {
            let staff_id = row.try_get::<String, _>("staff_id").ok()?;
            let photo_url = row.try_get::<String, _>("photo_url").ok()?;
            (!staff_id.is_empty() && !photo_url.is_empty()).then_some((staff_id, photo_url))
        })
        .collect::<std::collections::HashMap<_, _>>();

    Ok(rows
        .into_iter()
        .map(|staff| {
            let mut response = StaffResponse::from(staff);
            response.service_ids = service_ids_by_staff
                .remove(&response.id)
                .unwrap_or_default();
            response.photo_url = photo_url_by_staff.remove(&response.id).unwrap_or_default();
            response
        })
        .collect())
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

    let items = staff_responses_with_service_ids(&state, &tenant_id, &branch_id, rows).await?;
    Ok(Json(ApiResponse::ok(StaffListPage {
        items,
        total,
        page,
        page_size,
        jobs,
    })))
}

async fn get_staff_masters(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<staff_service::StaffMastersData> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let masters = staff_service::load_masters(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(masters)))
}

async fn update_staff_masters(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<StaffMastersWriteRequest>,
) -> ApiResult<staff_service::StaffMastersData> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let category_count = payload.categories.len();
    let shift_count = payload.shift_templates.len();
    let pricing_level_count = payload.pricing_levels.len();
    let masters = staff_service::save_masters(
        &state.db,
        &tenant_id,
        &branch_id,
        ReplaceStaffMastersInput {
            categories: payload
                .categories
                .into_iter()
                .map(|item| StaffCategoryInput {
                    id: item.id.unwrap_or_default().trim().to_string(),
                    code: item.code.trim().to_lowercase(),
                    name: item.name.trim().to_string(),
                    designation: item.designation.unwrap_or_default().trim().to_string(),
                    active: item.active.unwrap_or(true),
                })
                .collect(),
            pricing_levels: payload
                .pricing_levels
                .into_iter()
                .map(|item| StaffPricingLevelInput {
                    id: item.id.unwrap_or_default().trim().to_string(),
                    code: item.code.trim().to_lowercase(),
                    name: item.name.trim().to_string(),
                    rank: item.rank.unwrap_or(0),
                    active: item.active.unwrap_or(true),
                })
                .collect(),
            shift_templates: payload
                .shift_templates
                .into_iter()
                .map(|item| ShiftTemplateInput {
                    id: item.id.unwrap_or_default().trim().to_string(),
                    code: item.code.trim().to_lowercase(),
                    name: item.name.trim().to_string(),
                    shift1_start: item.shift1_start,
                    shift1_end: item.shift1_end,
                    shift2_start: item.shift2_start,
                    shift2_end: item.shift2_end,
                    break_minutes: item.break_minutes.unwrap_or(0),
                    weekly_off_days: item.weekly_off_days,
                    active: item.active.unwrap_or(true),
                })
                .collect(),
            attendance_rule: AttendanceRuleInput {
                grace_minutes: payload.attendance_rule.grace_minutes.unwrap_or(0),
                half_day_after_minutes: payload.attendance_rule.half_day_after_minutes.unwrap_or(0),
                absent_after_minutes: payload.attendance_rule.absent_after_minutes.unwrap_or(0),
                overtime_after_minutes: payload.attendance_rule.overtime_after_minutes.unwrap_or(0),
                early_leave_grace_minutes: payload
                    .attendance_rule
                    .early_leave_grace_minutes
                    .unwrap_or(0),
                deduct_breaks: payload.attendance_rule.deduct_breaks.unwrap_or(true),
                minimum_overtime_minutes: payload
                    .attendance_rule
                    .minimum_overtime_minutes
                    .unwrap_or(0),
                overtime_rounding_minutes: payload
                    .attendance_rule
                    .overtime_rounding_minutes
                    .unwrap_or(0),
                maximum_overtime_minutes: payload
                    .attendance_rule
                    .maximum_overtime_minutes
                    .unwrap_or(0),
                active: payload.attendance_rule.active.unwrap_or(true),
            },
        },
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.masters.updated",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "categories": category_count, "pricingLevels": pricing_level_count, "shiftTemplates": shift_count }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(masters)))
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
    let linked_login =
        staff_service::has_linked_login(&state.db, &tenant_id, staff.user_id.as_deref()).await?;

    Ok(Json(ApiResponse::ok(profile_response(
        staff,
        profile,
        linked_login,
    ))))
}

async fn update_staff_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
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
    staff_service::validate_master_assignment(
        &state.db,
        &tenant_id,
        &branch_id,
        "category",
        payload.category_id.as_deref(),
    )
    .await?;

    validate_hr_profile(&payload, &id)?;
    let reporting_manager_id = normalized(payload.reporting_manager_id.as_deref());
    if let Some(manager_id) = reporting_manager_id {
        staff_repository::get(&state.db, &tenant_id, &branch_id, manager_id)
            .await
            .map_err(|_| AppError::internal("failed to validate reporting manager"))?
            .filter(|manager| manager.active)
            .ok_or_else(|| AppError::validation("invalid reportingManagerId"))?;
    }
    staff_service::validate_master_assignment(
        &state.db,
        &tenant_id,
        &branch_id,
        "shift",
        payload.shift_template_id.as_deref(),
    )
    .await?;
    staff_service::validate_master_assignment(
        &state.db,
        &tenant_id,
        &branch_id,
        "pricingLevel",
        payload.pricing_level_id.as_deref(),
    )
    .await?;

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
            category_id: payload
                .category_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            shift_template_id: payload
                .shift_template_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            pricing_level_id: payload
                .pricing_level_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
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
            photo_url: normalized(payload.photo_url.as_deref()).unwrap_or(""),
            date_of_birth: payload.date_of_birth,
            joining_date: payload.joining_date,
            gender: normalized(payload.gender.as_deref()).unwrap_or(""),
            employment_type: normalized(payload.employment_type.as_deref()).unwrap_or(""),
            department: normalized(payload.department.as_deref()).unwrap_or(""),
            reporting_manager_id,
            address_line1: normalized(payload.address_line1.as_deref()).unwrap_or(""),
            address_line2: normalized(payload.address_line2.as_deref()).unwrap_or(""),
            city: normalized(payload.city.as_deref()).unwrap_or(""),
            state_name: normalized(payload.state_name.as_deref()).unwrap_or(""),
            postal_code: normalized(payload.postal_code.as_deref()).unwrap_or(""),
            country: normalized(payload.country.as_deref()).unwrap_or(""),
            emergency_contact_name: normalized(payload.emergency_contact_name.as_deref())
                .unwrap_or(""),
            emergency_contact_relationship: normalized(
                payload.emergency_contact_relationship.as_deref(),
            )
            .unwrap_or(""),
            emergency_contact_phone: normalized(payload.emergency_contact_phone.as_deref())
                .unwrap_or(""),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to save staff profile"))?;
    let linked_login =
        staff_service::has_linked_login(&state.db, &tenant_id, staff.user_id.as_deref()).await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.hr_profile.updated",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "staffId": id }),
        },
    )
    .await;

    Ok(Json(ApiResponse::ok(profile_response(
        staff,
        Some(profile),
        linked_login,
    ))))
}

async fn list_staff_documents(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<StaffDocumentRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ensure_staff_scope(&state, &tenant_id, &branch_id, &id).await?;
    let rows = staff_hr_repository::list_documents(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load staff documents"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn upload_staff_file(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Query(query): Query<StaffFileUploadQuery>,
    bytes: Bytes,
) -> ApiResult<StaffFileUploadResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ensure_staff_scope(&state, &tenant_id, &branch_id, &staff_id).await?;
    let kind = query.kind.trim().to_lowercase();
    let file_name = query.file_name.trim();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let allowed = matches!(
        content_type.as_str(),
        "image/jpeg"
            | "image/png"
            | "image/webp"
            | "application/pdf"
            | "application/msword"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    if !matches!(kind.as_str(), "photo" | "document")
        || file_name.is_empty()
        || file_name.chars().count() > 180
        || file_name.chars().any(char::is_control)
        || bytes.is_empty()
        || bytes.len() > 5 * 1024 * 1024
        || !allowed
    {
        return Err(AppError::validation("invalid staff file"));
    }
    if kind == "photo" && !is_supported_staff_photo(file_name, &content_type, &bytes) {
        return Err(AppError::validation(
            "staff photo must be a valid JPG or PNG image",
        ));
    }
    let row = staff_hr_repository::save_file(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &kind,
        file_name,
        &content_type,
        bytes.to_vec(),
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to upload staff file"))?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.file.uploaded",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "staffId": staff_id, "fileId": row.id, "kind": kind }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(StaffFileUploadResponse {
        file_url: format!("/staff/files/{}", row.id),
        file_id: row.id,
        file_name: row.file_name,
        content_type: row.content_type,
        byte_size: row.byte_size,
    })))
}

async fn get_staff_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_hr_repository::get_file(&state.db, &tenant_id, &branch_id, &file_id)
        .await
        .map_err(|_| AppError::internal("failed to load staff file"))?
        .ok_or_else(|| AppError::not_found("staff file was not found"))?;
    let safe_name = row
        .file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&row.content_type)
                .map_err(|_| AppError::internal("invalid stored file type"))?,
        )
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{safe_name}\""),
        )
        .body(Body::from(row.content))
        .map_err(|_| AppError::internal("failed to stream staff file"))
}

async fn create_staff_document(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffDocumentWriteRequest>,
) -> ApiResult<StaffDocumentRecord> {
    save_staff_document(state, claims, headers, id, None, payload).await
}

async fn update_staff_document(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, document_id)): Path<(String, String)>,
    Json(payload): Json<StaffDocumentWriteRequest>,
) -> ApiResult<StaffDocumentRecord> {
    save_staff_document(state, claims, headers, id, Some(document_id), payload).await
}

async fn save_staff_document(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    staff_id: String,
    document_id: Option<String>,
    payload: StaffDocumentWriteRequest,
) -> ApiResult<StaffDocumentRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ensure_staff_scope(&state, &tenant_id, &branch_id, &staff_id).await?;
    let document_type = payload.document_type.trim();
    let document_name = payload.document_name.trim();
    let document_url = payload.document_url.trim();
    let verification_status = payload
        .verification_status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pending");
    let notes = payload.notes.as_deref().unwrap_or("").trim();
    if document_type.is_empty()
        || document_type.chars().count() > 80
        || document_name.is_empty()
        || document_name.chars().count() > 180
        || document_url.len() > 2048
        || !(document_url.starts_with("https://") || document_url.starts_with('/'))
        || !matches!(verification_status, "pending" | "verified" | "rejected")
        || notes.chars().count() > 1000
    {
        return Err(AppError::validation("invalid staff document"));
    }
    let row = staff_hr_repository::save_document(
        &state.db,
        SaveStaffDocument {
            id: document_id.as_deref(),
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            staff_id: &staff_id,
            document_type,
            document_name,
            document_url,
            verification_status,
            expiry_date: payload.expiry_date,
            notes,
            created_by: &claims.sub,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to save staff document"))?
    .ok_or_else(|| AppError::not_found("staff document was not found"))?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: if document_id.is_some() {
                "staff.document.updated"
            } else {
                "staff.document.created"
            },
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "staffId": staff_id, "documentId": row.id }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_staff_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<StaffHistoryRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    ensure_staff_scope(&state, &tenant_id, &branch_id, &id).await?;
    let rows = staff_hr_repository::list_history(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load staff history"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn import_staff_bulk(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<StaffBulkImportRequest>,
) -> ApiResult<staff_hr_repository::BulkImportResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = payload
        .rows
        .into_iter()
        .map(|row| BulkStaffInput {
            employee_code: row.employee_code.trim().to_string(),
            first_name: row.first_name.trim().to_string(),
            last_name: trimmed(row.last_name),
            email: trimmed(row.email).map(|value| value.to_ascii_lowercase()),
            mobile_phone: trimmed(row.mobile_phone),
            job_title: trimmed(row.job_title),
            active: row.active,
            photo_url: trimmed(row.photo_url),
            date_of_birth: row.date_of_birth,
            joining_date: row.joining_date,
            gender: trimmed(row.gender).map(|value| value.to_ascii_lowercase()),
            employment_type: trimmed(row.employment_type).map(|value| value.to_ascii_lowercase()),
            department: trimmed(row.department),
            reporting_manager_id: trimmed(row.reporting_manager_id),
            category_id: trimmed(row.category_id),
            shift_template_id: trimmed(row.shift_template_id),
        })
        .collect::<Vec<_>>();
    let result = staff_service::apply_bulk_import(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.batch_id.trim(),
        &claims.sub,
        &rows,
    )
    .await?;
    let staff_ids = result.staff_ids.clone();
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.bulk_import.completed",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({
                "batchId": result.batch_key,
                "staffIds": staff_ids,
                "totalRows": result.total_rows,
                "createdRows": result.created_rows,
                "updatedRows": result.updated_rows
            }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(result)))
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
                    pricing_level_price_paise: item.pricing_level_price_paise,
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

async fn get_staff_branch_access(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<staff_service::StaffBranchAccessData> {
    require_auth_admin(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let access = staff_service::load_branch_access(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(access)))
}

async fn provision_staff_login(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffLoginProvisionRequest>,
) -> ApiResult<staff_service::StaffBranchAccessData> {
    require_auth_admin(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let login_id = payload.login_id.trim().to_string();
    let access = staff_service::provision_login(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        staff_service::StaffLoginProvision {
            login_id: payload.login_id,
            email: payload.email,
            initial_password: payload.initial_password,
            role_id: payload.role_id,
        },
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: Some(&login_id),
            event_type: "staff.login.provisioned",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "staffId": id, "mustChangePassword": true }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(access)))
}

async fn update_staff_branch_access(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffBranchAccessWriteRequest>,
) -> ApiResult<staff_service::StaffBranchAccessData> {
    require_auth_admin(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let assignment_count = payload.assignments.len();
    let access = staff_service::save_branch_access(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload
            .assignments
            .into_iter()
            .map(|assignment| staff_service::BranchAccessAssignment {
                branch_id: assignment.branch_id,
                role_id: assignment.role_id,
                access_type: assignment.access_type.unwrap_or_else(|| "permanent".into()),
                valid_from: assignment.valid_from,
                valid_until: assignment.valid_until,
                is_default: assignment.is_default.unwrap_or(false),
                active: assignment.active.unwrap_or(false),
            })
            .collect(),
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.branch_access.updated",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "staffId": id, "assignments": assignment_count }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(access)))
}

async fn list_auth_roles(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<staff_service::AuthRoleManagementData> {
    require_auth_admin(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let roles = staff_service::load_auth_roles(&state.db, &tenant_id).await?;
    Ok(Json(ApiResponse::ok(roles)))
}

async fn create_auth_role(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<AuthRoleWriteRequest>,
) -> ApiResult<staff_service::AuthRoleManagementData> {
    require_auth_admin(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let role_name = payload.name.clone();
    let roles = staff_service::create_auth_role(
        &state.db,
        &tenant_id,
        payload.name,
        payload.permissions,
        staff_service::AuthRoleSecurityInput {
            denied_permissions: payload.denied_permissions,
            masked_fields: payload.masked_fields,
            max_discount_paise: payload.max_discount_paise,
            max_refund_paise: payload.max_refund_paise,
            max_cash_movement_paise: payload.max_cash_movement_paise,
        },
    )
    .await?;
    audit_auth_role_change(
        &state, &claims, &tenant_id, &branch_id, "created", None, role_name,
    )
    .await;
    Ok(Json(ApiResponse::ok(roles)))
}

async fn update_auth_role(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(role_id): Path<String>,
    Json(payload): Json<AuthRoleWriteRequest>,
) -> ApiResult<staff_service::AuthRoleManagementData> {
    require_auth_admin(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let role_name = payload.name.clone();
    let roles = staff_service::update_auth_role(
        &state.db,
        &tenant_id,
        &role_id,
        payload.name,
        payload.permissions,
        staff_service::AuthRoleSecurityInput {
            denied_permissions: payload.denied_permissions,
            masked_fields: payload.masked_fields,
            max_discount_paise: payload.max_discount_paise,
            max_refund_paise: payload.max_refund_paise,
            max_cash_movement_paise: payload.max_cash_movement_paise,
        },
    )
    .await?;
    audit_auth_role_change(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        "updated",
        Some(role_id),
        role_name,
    )
    .await;
    Ok(Json(ApiResponse::ok(roles)))
}

async fn audit_auth_role_change(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    action: &str,
    role_id: Option<String>,
    role_name: String,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(branch_id),
            identity: None,
            event_type: "auth.role.changed",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "action": action, "roleId": role_id, "roleName": role_name }),
        },
    )
    .await;
}

async fn set_staff_password(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffPasswordRequest>,
) -> ApiResult<StaffPasswordResponse> {
    require_auth_admin(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let must_change_password = payload.must_change_password.unwrap_or(true);
    staff_service::set_password(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload.new_password.trim(),
        must_change_password,
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: if must_change_password {
                "staff.password.reset"
            } else {
                "staff.password.updated"
            },
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({ "staffId": id, "mustChangePassword": must_change_password }),
        },
    )
    .await;
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

fn require_auth_admin(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(claims.role.to_ascii_lowercase().as_str(), "owner" | "admin") {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "only Owner or Admin can manage authentication access",
        ))
    }
}

async fn ensure_staff_scope(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<(), AppError> {
    staff_repository::get(&state.db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .map(|_| ())
        .ok_or_else(|| AppError::not_found("staff was not found"))
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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

fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn validate_hr_profile(payload: &StaffProfileWriteRequest, staff_id: &str) -> Result<(), AppError> {
    let today = Utc::now().date_naive();
    if payload.date_of_birth.is_some_and(|date| date > today)
        || payload.joining_date.is_some_and(|date| date > today)
    {
        return Err(AppError::validation(
            "HR profile dates cannot be in the future",
        ));
    }
    let gender = normalized(payload.gender.as_deref()).unwrap_or("");
    if !matches!(
        gender,
        "" | "female" | "male" | "non_binary" | "prefer_not_to_say"
    ) {
        return Err(AppError::validation("invalid gender"));
    }
    let employment_type = normalized(payload.employment_type.as_deref()).unwrap_or("");
    if !matches!(
        employment_type,
        "" | "full_time" | "part_time" | "contract" | "intern"
    ) {
        return Err(AppError::validation("invalid employmentType"));
    }
    if normalized(payload.reporting_manager_id.as_deref()).is_some_and(|id| id == staff_id) {
        return Err(AppError::validation(
            "an employee cannot report to themselves",
        ));
    }
    if let Some(url) = normalized(payload.photo_url.as_deref()) {
        if url.len() > 2048 || !staff_service::is_supported_photo_url(url) {
            return Err(AppError::validation(
                "photoUrl must point to a JPG or PNG image",
            ));
        }
    }
    for (value, field, limit) in [
        (payload.department.as_deref(), "department", 120),
        (payload.address_line1.as_deref(), "addressLine1", 200),
        (payload.address_line2.as_deref(), "addressLine2", 200),
        (payload.city.as_deref(), "city", 100),
        (payload.state_name.as_deref(), "stateName", 100),
        (payload.postal_code.as_deref(), "postalCode", 30),
        (payload.country.as_deref(), "country", 100),
        (
            payload.emergency_contact_name.as_deref(),
            "emergencyContactName",
            120,
        ),
        (
            payload.emergency_contact_relationship.as_deref(),
            "emergencyContactRelationship",
            80,
        ),
        (
            payload.emergency_contact_phone.as_deref(),
            "emergencyContactPhone",
            40,
        ),
    ] {
        if value.is_some_and(|text| text.trim().chars().count() > limit) {
            return Err(AppError::validation(format!("{field} is too long")));
        }
    }
    Ok(())
}

fn is_supported_staff_photo(file_name: &str, content_type: &str, bytes: &[u8]) -> bool {
    let name = file_name.to_ascii_lowercase();
    match content_type {
        "image/jpeg" if name.ends_with(".jpg") || name.ends_with(".jpeg") => {
            bytes.starts_with(&[0xff, 0xd8, 0xff])
        }
        "image/png" if name.ends_with(".png") => {
            bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
        }
        _ => false,
    }
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
        category_id: profile
            .as_ref()
            .and_then(|record| record.category_id.clone()),
        shift_template_id: profile
            .as_ref()
            .and_then(|record| record.shift_template_id.clone()),
        pricing_level_id: profile
            .as_ref()
            .and_then(|record| record.pricing_level_id.clone()),
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
        photo_url: profile
            .as_ref()
            .map(|record| record.photo_url.clone())
            .unwrap_or_default(),
        date_of_birth: profile.as_ref().and_then(|record| record.date_of_birth),
        joining_date: profile.as_ref().and_then(|record| record.joining_date),
        gender: profile
            .as_ref()
            .map(|record| record.gender.clone())
            .unwrap_or_default(),
        employment_type: profile
            .as_ref()
            .map(|record| record.employment_type.clone())
            .unwrap_or_default(),
        department: profile
            .as_ref()
            .map(|record| record.department.clone())
            .unwrap_or_default(),
        reporting_manager_id: profile
            .as_ref()
            .and_then(|record| record.reporting_manager_id.clone()),
        address_line1: profile
            .as_ref()
            .map(|record| record.address_line1.clone())
            .unwrap_or_default(),
        address_line2: profile
            .as_ref()
            .map(|record| record.address_line2.clone())
            .unwrap_or_default(),
        city: profile
            .as_ref()
            .map(|record| record.city.clone())
            .unwrap_or_default(),
        state_name: profile
            .as_ref()
            .map(|record| record.state_name.clone())
            .unwrap_or_default(),
        postal_code: profile
            .as_ref()
            .map(|record| record.postal_code.clone())
            .unwrap_or_default(),
        country: profile
            .as_ref()
            .map(|record| record.country.clone())
            .unwrap_or_default(),
        emergency_contact_name: profile
            .as_ref()
            .map(|record| record.emergency_contact_name.clone())
            .unwrap_or_default(),
        emergency_contact_relationship: profile
            .as_ref()
            .map(|record| record.emergency_contact_relationship.clone())
            .unwrap_or_default(),
        emergency_contact_phone: profile
            .as_ref()
            .map(|record| record.emergency_contact_phone.clone())
            .unwrap_or_default(),
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
            photo_url: String::new(),
            service_ids: Vec::new(),
            active: record.active,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_non_negative, is_supported_staff_photo, staff_sort_column, staff_sort_direction,
    };
    use crate::services::staff_service;

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

    #[test]
    fn staff_photos_only_allow_jpg_or_png() {
        assert!(is_supported_staff_photo(
            "profile.jpg",
            "image/jpeg",
            &[0xff, 0xd8, 0xff, 0x00]
        ));
        assert!(is_supported_staff_photo(
            "profile.png",
            "image/png",
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
        ));
        assert!(!is_supported_staff_photo(
            "profile.webp",
            "image/webp",
            b"RIFF"
        ));
        assert!(staff_service::is_supported_photo_url(
            "https://cdn.example.com/profile.JPG?size=200"
        ));
        assert!(staff_service::is_supported_photo_url(
            "/staff/files/file_123"
        ));
        assert!(!staff_service::is_supported_photo_url(
            "https://example.com/profile.webp"
        ));
    }
}
