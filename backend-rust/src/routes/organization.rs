use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post, put},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        organization_service::{
            self, BrandInput, ConfigInput, DepartmentInput, FeatureOverrideInput, HolidayInput,
            LocationOperationsInput, OrganizationProfileInput, OrganizationUnitInput,
            RollbackInput, TenantLifecycleInput, UsageQuotaInput,
        },
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformSnapshotQuery {
    branch_id: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/organization/control-plane", get(tenant_snapshot))
        .route(
            "/settings/organization/profile",
            put(update_organization_profile),
        )
        .route("/settings/organization/brands", post(create_brand))
        .route("/settings/organization/brands/:id", patch(update_brand))
        .route(
            "/settings/organization/departments",
            post(create_department),
        )
        .route(
            "/settings/organization/departments/:id",
            patch(update_department),
        )
        .route("/settings/organization/units", post(create_unit))
        .route("/settings/organization/units/:id", patch(update_unit))
        .route(
            "/settings/organization/locations/:id/operations",
            put(save_location_operations),
        )
        .route(
            "/settings/organization/locations/:id/holidays",
            put(save_location_holiday),
        )
        .route(
            "/settings/organization/config/:key",
            put(save_central_config),
        )
        .route(
            "/settings/organization/config/:key/rollback/:version",
            post(rollback_central_config),
        )
        .route(
            "/settings/organization/locations/:id/config/:key",
            put(save_location_config),
        )
        .route(
            "/settings/organization/locations/:id/config/:key/rollback/:version",
            post(rollback_location_config),
        )
        .route(
            "/platform/saas/tenants/:id/control-plane",
            get(platform_snapshot),
        )
        .route(
            "/platform/saas/tenants/:id/lifecycle",
            patch(update_tenant_lifecycle),
        )
        .route(
            "/platform/saas/tenants/:id/features/:key",
            put(save_tenant_feature),
        )
        .route(
            "/platform/saas/tenants/:id/usage-quotas",
            put(save_tenant_usage_quota),
        )
}

async fn tenant_snapshot(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Query(query): Query<PlatformSnapshotQuery>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let requested_branch = query.branch_id.as_deref().unwrap_or(&branch_id);
    if requested_branch != branch_id
        && !matches!(
            claims.role.to_ascii_lowercase().as_str(),
            "owner" | "admin" | "super-admin" | "superadmin"
        )
    {
        return Err(AppError::forbidden(
            "cross-location organization settings require tenant administrator access",
        ));
    }
    Ok(Json(ApiResponse::ok(
        organization_service::snapshot(&state.db, &tenant_id, requested_branch).await?,
    )))
}

async fn update_organization_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OrganizationProfileInput>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::update_profile(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}

async fn create_brand(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BrandInput>,
) -> ApiResult<Value> {
    save_brand(state, claims, headers, None, payload).await
}

async fn update_brand(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<BrandInput>,
) -> ApiResult<Value> {
    save_brand(state, claims, headers, Some(id), payload).await
}

async fn save_brand(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    id: Option<String>,
    payload: BrandInput,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::save_brand(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            id.as_deref(),
            payload,
        )
        .await?,
    )))
}

async fn create_department(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<DepartmentInput>,
) -> ApiResult<Value> {
    save_department(state, claims, headers, None, payload).await
}

async fn update_department(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DepartmentInput>,
) -> ApiResult<Value> {
    save_department(state, claims, headers, Some(id), payload).await
}

async fn save_department(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    id: Option<String>,
    payload: DepartmentInput,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::save_department(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            id.as_deref(),
            payload,
        )
        .await?,
    )))
}

async fn create_unit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OrganizationUnitInput>,
) -> ApiResult<Value> {
    save_unit(state, claims, headers, None, payload).await
}

async fn update_unit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OrganizationUnitInput>,
) -> ApiResult<Value> {
    save_unit(state, claims, headers, Some(id), payload).await
}

async fn save_unit(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    id: Option<String>,
    payload: OrganizationUnitInput,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::save_unit(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            id.as_deref(),
            payload,
        )
        .await?,
    )))
}

async fn save_location_operations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<LocationOperationsInput>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::save_location_operations(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn save_location_holiday(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<HolidayInput>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::save_holiday(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn save_central_config(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(payload): Json<ConfigInput>,
) -> ApiResult<Value> {
    save_config(state, claims, headers, None, key, payload).await
}

async fn save_location_config(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, key)): Path<(String, String)>,
    Json(payload): Json<ConfigInput>,
) -> ApiResult<Value> {
    save_config(state, claims, headers, Some(id), key, payload).await
}

async fn save_config(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    location_id: Option<String>,
    key: String,
    payload: ConfigInput,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::save_config(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            location_id.as_deref(),
            &key,
            payload,
        )
        .await?,
    )))
}

async fn rollback_central_config(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((key, version)): Path<(String, i32)>,
    Json(payload): Json<RollbackInput>,
) -> ApiResult<Value> {
    rollback_config(state, claims, headers, None, key, version, payload).await
}

async fn rollback_location_config(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, key, version)): Path<(String, String, i32)>,
    Json(payload): Json<RollbackInput>,
) -> ApiResult<Value> {
    rollback_config(state, claims, headers, Some(id), key, version, payload).await
}

#[allow(clippy::too_many_arguments)]
async fn rollback_config(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    location_id: Option<String>,
    key: String,
    version: i32,
    payload: RollbackInput,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        organization_service::rollback_config(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            location_id.as_deref(),
            &key,
            version,
            payload,
        )
        .await?,
    )))
}

async fn platform_snapshot(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<PlatformSnapshotQuery>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        organization_service::platform_snapshot(&state.db, &id, query.branch_id.as_deref()).await?,
    )))
}

async fn update_tenant_lifecycle(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<TenantLifecycleInput>,
) -> ApiResult<Value> {
    organization_service::update_lifecycle(&state.db, &id, &claims.sub, payload).await?;
    Ok(Json(ApiResponse::ok(
        organization_service::platform_snapshot(&state.db, &id, None).await?,
    )))
}

async fn save_tenant_feature(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path((id, key)): Path<(String, String)>,
    Json(payload): Json<FeatureOverrideInput>,
) -> ApiResult<Value> {
    organization_service::save_feature_override(&state.db, &id, &key, &claims.sub, payload).await?;
    Ok(Json(ApiResponse::ok(
        organization_service::platform_snapshot(&state.db, &id, None).await?,
    )))
}

async fn save_tenant_usage_quota(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<UsageQuotaInput>,
) -> ApiResult<Value> {
    organization_service::save_usage_quota(&state.db, &id, &claims.sub, payload).await?;
    Ok(Json(ApiResponse::ok(
        organization_service::platform_snapshot(&state.db, &id, None).await?,
    )))
}
