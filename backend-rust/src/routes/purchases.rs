use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::purchase_repository,
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        purchase_service::{self, ReceiptDetails, ReceiptInput, ReceiptLineInput},
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/purchases/grn", get(list).post(receive))
        .route("/purchases/grn/:id", get(get_receipt))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptRequest {
    supplier_name: String,
    supplier_gstin: String,
    supplier_invoice_number: String,
    received_date: Option<String>,
    idempotency_key: String,
    lines: Vec<ReceiptLineRequest>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptLineRequest {
    inventory_item_id: String,
    quantity: i32,
    unit_cost_paise: i64,
    gst_percent: Option<i32>,
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<purchase_repository::PurchaseReceipt>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = purchase_repository::list(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list GRNs"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_receipt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ReceiptDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn receive(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ReceiptRequest>,
) -> ApiResult<ReceiptDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = ReceiptInput {
        supplier_name: payload.supplier_name,
        supplier_gstin: payload.supplier_gstin,
        supplier_invoice_number: payload.supplier_invoice_number,
        received_date: payload.received_date,
        idempotency_key: payload.idempotency_key,
        lines: payload
            .lines
            .into_iter()
            .map(|line| ReceiptLineInput {
                inventory_item_id: line.inventory_item_id,
                quantity: line.quantity,
                unit_cost_paise: line.unit_cost_paise,
                gst_percent: line.gst_percent,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::receive(&state, &tenant_id, &branch_id, &claims.sub, input).await?,
    )))
}
