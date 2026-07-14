use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        staff_operations_service::{
            self, BranchTransferRequest, DecisionRequest, PerformanceReviewRequest,
            ShiftSwapRequest, SkillLicenseRequest,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff/shift-swaps",
            get(list_shift_swaps).post(create_shift_swap),
        )
        .route("/staff/shift-swaps/:id/decision", post(decide_shift_swap))
        .route(
            "/staff/branch-transfers",
            get(list_branch_transfers).post(create_branch_transfer),
        )
        .route(
            "/staff/branch-transfers/:id/decision",
            post(decide_branch_transfer),
        )
        .route(
            "/staff/skill-licenses",
            get(list_skill_licenses).post(save_skill_license),
        )
        .route(
            "/staff/performance-reviews",
            get(list_reviews).post(save_review),
        )
}

#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffQuery {
    staff_id: Option<String>,
}

async fn list_shift_swaps(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::ShiftSwapRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_shift_swaps(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_shift_swap(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ShiftSwapRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::ShiftSwapRecord> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::create_shift_swap(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_shift_swap(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::ShiftSwapRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::decide_shift_swap(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_branch_transfers(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StatusQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::BranchTransferRecord>> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_branch_transfers(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_branch_transfer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BranchTransferRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::BranchTransferRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::create_branch_transfer(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn decide_branch_transfer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::BranchTransferRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::decide_branch_transfer(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_skill_licenses(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::SkillLicenseRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_skill_licenses(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_skill_license(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SkillLicenseRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::SkillLicenseRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::save_skill_license(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_reviews(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffQuery>,
) -> ApiResult<Vec<crate::repositories::staff_operations_repository::PerformanceReviewRecord>> {
    ensure_staff_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_operations_service::list_reviews(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_review(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PerformanceReviewRequest>,
) -> ApiResult<crate::repositories::staff_operations_repository::PerformanceReviewRecord> {
    ensure_staff_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_operations_service::save_review(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

fn ensure_staff_read(claims: &AuthClaims) -> Result<(), AppError> {
    const ALLOWED: &[&str] = &[
        "owner",
        "admin",
        "manager",
        "accountant",
        "receptionist",
        "staff",
    ];
    if ALLOWED
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff access is restricted"))
    }
}

fn ensure_staff_manage(claims: &AuthClaims) -> Result<(), AppError> {
    const ALLOWED: &[&str] = &["owner", "admin", "manager"];
    if ALLOWED
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("staff management access is restricted"))
    }
}
