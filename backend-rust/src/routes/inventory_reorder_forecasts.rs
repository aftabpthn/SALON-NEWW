use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, inventory_reorder_forecast_service, purchase_service},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TermsRequest {
    supplier_id: String,
    inventory_item_id: String,
    lead_time_days: i32,
    minimum_order_quantity: i32,
    pack_size: i32,
    safety_stock_days: i32,
}
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inventory/reorder-forecasts", get(latest).post(run))
        .route("/inventory/reorder-forecasts/:id", get(detail))
        .route("/inventory/reorder-supplier-terms", post(save_terms))
        .route(
            "/inventory/reorder-recommendations/:id/approve",
            post(approve),
        )
}
async fn latest(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Option<inventory_reorder_forecast_service::ForecastDetail>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_reorder_forecast_service::latest(&state, &t, &b).await?,
    )))
}
async fn run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<inventory_reorder_forecast_service::ForecastDetail> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_reorder_forecast_service::run(&state, &t, &b, &claims.sub).await?,
    )))
}
async fn detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<inventory_reorder_forecast_service::ForecastDetail> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_reorder_forecast_service::detail(&state, &t, &b, &id).await?,
    )))
}
async fn approve(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
) -> ApiResult<purchase_service::OrderDetails> {
    if !matches!(
        claims.role.as_str(),
        "owner" | "admin" | "manager" | "inventory_manager"
    ) {
        return Err(AppError::forbidden("inventory approval role is required"));
    }
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        inventory_reorder_forecast_service::approve_to_po(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn save_terms(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<TermsRequest>,
) -> ApiResult<()> {
    let (t, b) = tenant_branch(&headers)?;
    inventory_reorder_forecast_service::save_terms(
        &state,
        &t,
        &b,
        &payload.supplier_id,
        &payload.inventory_item_id,
        payload.lead_time_days,
        payload.minimum_order_quantity,
        payload.pack_size,
        payload.safety_stock_days,
    )
    .await?;
    Ok(Json(ApiResponse::ok(())))
}
