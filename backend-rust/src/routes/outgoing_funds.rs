use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};

use crate::{
    models::{
        common::{ApiResponse, ApiResult},
        outgoing_funds::{
            OutgoingFundCategory, OutgoingFundCreateRequest, OutgoingFundDecisionRequest,
            OutgoingFundListQuery, OutgoingFundPage, OutgoingFundResponse,
            OutgoingFundUpdateRequest,
        },
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, outgoing_funds_service, security_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/finance/outgoing-funds/categories", get(categories))
        .route("/finance/outgoing-funds/export", get(export_rows))
        .route("/finance/outgoing-funds", get(list).post(create))
        .route(
            "/finance/outgoing-funds/:id",
            get(get_one).patch(update).delete(cancel),
        )
        .route("/finance/outgoing-funds/:id/submit", post(submit))
        .route("/finance/outgoing-funds/:id/approve", post(approve))
        .route("/finance/outgoing-funds/:id/reject", post(reject))
        .route("/finance/outgoing-funds/:id/reverse", post(reverse))
}

async fn categories(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<OutgoingFundCategory>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = outgoing_funds_service::categories(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<OutgoingFundListQuery>,
) -> ApiResult<OutgoingFundPage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = outgoing_funds_service::list(&state.db, &tenant_id, &branch_id, query).await?;
    Ok(Json(ApiResponse::ok(page)))
}

async fn export_rows(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OutgoingFundListQuery>,
) -> ApiResult<Vec<OutgoingFundResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        outgoing_funds_service::export_rows(&state.db, &tenant_id, &branch_id, query).await?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "outgoing_funds.exported",
        serde_json::json!({"rowCount":rows.len()}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_one(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = outgoing_funds_service::get(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn create(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OutgoingFundCreateRequest>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        outgoing_funds_service::create(&state.db, &tenant_id, &branch_id, &claims.sub, payload)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OutgoingFundUpdateRequest>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = outgoing_funds_service::update(
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

async fn submit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        outgoing_funds_service::submit(&state.db, &tenant_id, &branch_id, &id, &claims.sub).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = outgoing_funds_service::approve(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        &claims.role,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn reject(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OutgoingFundDecisionRequest>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = outgoing_funds_service::reject(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        &claims.role,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn reverse(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OutgoingFundDecisionRequest>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = outgoing_funds_service::reverse(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        &claims.role,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn cancel(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<OutgoingFundResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        outgoing_funds_service::cancel(&state.db, &tenant_id, &branch_id, &id, &claims.sub).await?;
    Ok(Json(ApiResponse::ok(row)))
}
