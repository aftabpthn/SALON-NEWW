use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult},
    routes::context::tenant_branch,
    services::retention_service,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/retention/clients/:client_id", get(client_snapshot))
        .route(
            "/retention/clients/:client_id/referral-code",
            post(create_referral_code),
        )
        .route(
            "/retention/clients/:client_id/referrals",
            post(create_referral),
        )
        .route(
            "/retention/referrals/:referral_id/complete",
            post(complete_referral),
        )
        .route("/retention/gift-cards", get(list_gift_cards))
        .route("/retention/gift-cards/:gift_card_id", get(gift_card_detail))
        .route(
            "/retention/gift-cards/:gift_card_id/void",
            post(void_gift_card),
        )
        .route(
            "/retention/gift-cards/:gift_card_id/reissue",
            post(reissue_gift_card),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GiftListQuery {
    client_id: Option<String>,
    status: Option<String>,
    code: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MutationRequest {
    reason: String,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReissueRequest {
    code: Option<String>,
    expires_at: Option<NaiveDate>,
    reason: String,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferralRequest {
    referred_client_id: String,
    idempotency_key: String,
}

async fn client_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::client_snapshot(&state.db, &tenant_id, &branch_id, &client_id).await?,
    )))
}
async fn list_gift_cards(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GiftListQuery>,
) -> ApiResult<Vec<crate::repositories::retention_repository::GiftCardListRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::gift_cards(
            &state.db,
            &tenant_id,
            &branch_id,
            query.client_id.as_deref(),
            query.status.as_deref(),
            query.code.as_deref(),
        )
        .await?,
    )))
}
async fn gift_card_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::gift_card_detail(&state.db, &tenant_id, &branch_id, &id).await?,
    )))
}
async fn void_gift_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<MutationRequest>,
) -> ApiResult<crate::repositories::retention_repository::GiftCardRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::void_gift_card(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &payload.reason,
            &payload.idempotency_key,
            &actor(&headers),
        )
        .await?,
    )))
}
async fn reissue_gift_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReissueRequest>,
) -> ApiResult<crate::repositories::retention_repository::GiftCardRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::reissue_gift_card(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            payload.code.as_deref(),
            payload.expires_at,
            &payload.reason,
            &payload.idempotency_key,
            &actor(&headers),
        )
        .await?,
    )))
}
async fn create_referral_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<crate::repositories::retention_repository::ReferralCodeRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::ensure_referral_code(
            &state.db,
            &tenant_id,
            &branch_id,
            &client_id,
            &actor(&headers),
        )
        .await?,
    )))
}
async fn create_referral(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<ReferralRequest>,
) -> ApiResult<crate::repositories::retention_repository::ReferralRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::create_referral(
            &state.db,
            &tenant_id,
            &branch_id,
            &client_id,
            &payload.referred_client_id,
            &payload.idempotency_key,
            &actor(&headers),
        )
        .await?,
    )))
}
async fn complete_referral(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<crate::repositories::retention_repository::ReferralRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        retention_service::complete_referral(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &actor(&headers),
        )
        .await?,
    )))
}
fn actor(headers: &HeaderMap) -> String {
    headers
        .get("x-user-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("system")
        .to_string()
}
