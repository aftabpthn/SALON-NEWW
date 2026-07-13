use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::{
    models::common::{ApiResponse, ApiResult},
    routes::context::tenant_branch,
    services::wallet_service,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/clients/:id/wallet", get(get_wallet))
        .route(
            "/clients/:id/wallet-transactions",
            post(post_wallet_transaction),
        )
        .route("/clients/:id/wallet/recharge", post(recharge_wallet))
        .route("/clients/:id/wallet/use", post(use_wallet))
        .route("/clients/:id/wallet/refund", post(refund_wallet))
        .route(
            "/clients/:id/store-credits",
            get(list_store_credits).post(issue_store_credit),
        )
        .route(
            "/clients/:id/store-credits/:credit_id/redemptions",
            post(redeem_store_credit),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WalletWriteRequest {
    transaction_type: Option<String>,
    amount_paise: i64,
    reference_type: Option<String>,
    reference_id: Option<String>,
    idempotency_key: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreCreditIssueRequest {
    amount_paise: i64,
    source_type: String,
    source_id: String,
    expires_at: Option<NaiveDate>,
    reason: Option<String>,
    idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreCreditRedeemRequest {
    amount_paise: i64,
    reference_type: String,
    reference_id: String,
    idempotency_key: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletResponse {
    balance_paise: i64,
    transactions: Vec<crate::repositories::wallet_repository::WalletTransactionRecord>,
}

async fn get_wallet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<WalletResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (balance_paise, transactions) =
        wallet_service::wallet_snapshot(&state.db, &tenant_id, &branch_id, &client_id).await?;
    Ok(Json(ApiResponse::ok(WalletResponse {
        balance_paise,
        transactions,
    })))
}

async fn post_wallet_transaction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<WalletWriteRequest>,
) -> ApiResult<crate::repositories::wallet_repository::WalletTransactionRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let record = wallet_service::post_wallet_transaction(
        &state.db,
        &tenant_id,
        &branch_id,
        &client_id,
        payload.transaction_type.as_deref().unwrap_or(""),
        payload.amount_paise,
        payload.reference_type.as_deref().unwrap_or(""),
        payload.reference_id.as_deref().unwrap_or(""),
        payload.idempotency_key.as_deref().unwrap_or(""),
        payload.notes.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(record)))
}

async fn recharge_wallet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<WalletWriteRequest>,
) -> ApiResult<crate::repositories::wallet_repository::WalletTransactionRecord> {
    post_wallet_action(&state, headers, client_id, "recharge", payload).await
}

async fn use_wallet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<WalletWriteRequest>,
) -> ApiResult<crate::repositories::wallet_repository::WalletTransactionRecord> {
    post_wallet_action(&state, headers, client_id, "use", payload).await
}

async fn refund_wallet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<WalletWriteRequest>,
) -> ApiResult<crate::repositories::wallet_repository::WalletTransactionRecord> {
    post_wallet_action(&state, headers, client_id, "refund", payload).await
}

async fn post_wallet_action(
    state: &AppState,
    headers: HeaderMap,
    client_id: String,
    transaction_type: &str,
    payload: WalletWriteRequest,
) -> ApiResult<crate::repositories::wallet_repository::WalletTransactionRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let record = wallet_service::post_wallet_transaction(
        &state.db,
        &tenant_id,
        &branch_id,
        &client_id,
        transaction_type,
        payload.amount_paise,
        payload.reference_type.as_deref().unwrap_or(""),
        payload.reference_id.as_deref().unwrap_or(""),
        payload.idempotency_key.as_deref().unwrap_or(""),
        payload.notes.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(record)))
}

async fn list_store_credits(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<Vec<crate::repositories::wallet_repository::StoreCreditRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let credits =
        wallet_service::list_store_credits(&state.db, &tenant_id, &branch_id, &client_id).await?;
    Ok(Json(ApiResponse::ok(credits)))
}

async fn issue_store_credit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<StoreCreditIssueRequest>,
) -> ApiResult<crate::repositories::wallet_repository::StoreCreditRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let credit = wallet_service::issue_store_credit(
        &state.db,
        &tenant_id,
        &branch_id,
        &client_id,
        payload.amount_paise,
        &payload.source_type,
        &payload.source_id,
        payload.expires_at,
        payload.reason.as_deref().unwrap_or(""),
        payload.idempotency_key.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(credit)))
}

async fn redeem_store_credit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((client_id, credit_id)): Path<(String, String)>,
    Json(payload): Json<StoreCreditRedeemRequest>,
) -> ApiResult<crate::repositories::wallet_repository::StoreCreditRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let credit = wallet_service::redeem_store_credit(
        &state.db,
        &tenant_id,
        &branch_id,
        &client_id,
        &credit_id,
        payload.amount_paise,
        &payload.reference_type,
        &payload.reference_id,
        payload.idempotency_key.as_deref().unwrap_or(""),
        payload.notes.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(credit)))
}
