use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::get,
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{purchase_order_event_repository, purchase_repository},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        purchase_service::{
            self, OrderDetails, OrderInput, OrderLineInput, ReceiptDetails, ReceiptInput,
            ReceiptLineInput, ReturnInput, ReturnLineInput, SupplierPaymentInput,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/purchases/suppliers",
            get(list_suppliers).post(create_supplier),
        )
        .route(
            "/purchases/suppliers/:id",
            axum::routing::patch(update_supplier),
        )
        .route("/purchases/orders", get(list_orders).post(create_order))
        .route("/purchases/orders/:id", get(get_order))
        .route(
            "/purchases/orders/:id/submit",
            axum::routing::post(submit_order),
        )
        .route(
            "/purchases/orders/:id/approve",
            axum::routing::post(approve_order),
        )
        .route(
            "/purchases/orders/:id/reject",
            axum::routing::post(reject_order),
        )
        .route(
            "/purchases/orders/:id/send",
            axum::routing::post(send_order),
        )
        .route(
            "/purchases/orders/:id/close",
            axum::routing::post(close_order),
        )
        .route(
            "/purchases/orders/:id/cancel",
            axum::routing::post(cancel_order),
        )
        .route(
            "/purchases/orders/:id/reopen",
            axum::routing::post(reopen_order),
        )
        .route("/purchases/orders/:id/events", get(order_events))
        .route("/purchases/grn", get(list_receipts).post(receive))
        .route("/purchases/grn/:id", get(get_receipt))
        .route("/purchases/returns", get(list_returns).post(create_return))
        .route("/purchases/payables", get(list_payables))
        .route("/purchases/payments", axum::routing::post(create_payment))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierRequest {
    code: String,
    name: String,
    gstin: Option<String>,
    contact_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    payment_terms_days: Option<i32>,
    active: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderRequest {
    supplier_id: String,
    expected_date: Option<String>,
    notes: Option<String>,
    lines: Vec<OrderLineRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderLineRequest {
    inventory_item_id: String,
    quantity: i32,
    unit_cost_paise: i64,
    gst_percent: i32,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRequest {
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptRequest {
    supplier_id: Option<String>,
    purchase_order_id: Option<String>,
    supplier_name: String,
    supplier_gstin: String,
    supplier_invoice_number: String,
    received_date: Option<String>,
    due_date: Option<String>,
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
    batch_number: Option<String>,
    batch_barcode: Option<String>,
    expiry_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReturnRequest {
    purchase_receipt_id: String,
    reason: String,
    idempotency_key: String,
    lines: Vec<ReturnLineRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReturnLineRequest {
    purchase_receipt_line_id: String,
    quantity: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentRequest {
    purchase_receipt_id: String,
    amount_paise: i64,
    payment_method: String,
    reference: Option<String>,
    idempotency_key: String,
}

async fn list_suppliers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<purchase_repository::SupplierRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = purchase_repository::list_suppliers(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list suppliers"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_supplier(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SupplierRequest>,
) -> ApiResult<purchase_repository::SupplierRecord> {
    save_supplier(state, headers, None, payload).await
}

async fn update_supplier(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SupplierRequest>,
) -> ApiResult<purchase_repository::SupplierRecord> {
    save_supplier(state, headers, Some(id), payload).await
}

async fn save_supplier(
    state: AppState,
    headers: HeaderMap,
    id: Option<String>,
    payload: SupplierRequest,
) -> ApiResult<purchase_repository::SupplierRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let code = required(&payload.code, "code is required", 80)?;
    let name = required(&payload.name, "name is required", 160)?;
    let gstin = payload
        .gstin
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase();
    if !gstin.is_empty()
        && (gstin.len() != 15 || !gstin.chars().all(|ch| ch.is_ascii_alphanumeric()))
    {
        return Err(AppError::validation(
            "gstin must be 15 alphanumeric characters",
        ));
    }
    let terms = payload.payment_terms_days.unwrap_or(0);
    if !(0..=3650).contains(&terms) {
        return Err(AppError::validation(
            "paymentTermsDays must be between 0 and 3650",
        ));
    }
    let row = purchase_repository::save_supplier(
        &state.db,
        &tenant_id,
        &branch_id,
        id.as_deref(),
        &code,
        &name,
        &gstin,
        &limited(payload.contact_name, 160)?,
        &limited(payload.phone, 40)?,
        &limited(payload.email, 254)?,
        &limited(payload.address, 1000)?,
        terms,
        payload.active.unwrap_or(true),
    )
    .await
    .map_err(|_| AppError::conflict("supplier code already exists"))?
    .ok_or_else(|| AppError::not_found("supplier was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<purchase_repository::PurchaseOrderRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = purchase_repository::list_orders(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list purchase orders"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<OrderDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::order_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn create_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OrderRequest>,
) -> ApiResult<OrderDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = OrderInput {
        supplier_id: payload.supplier_id,
        expected_date: payload.expected_date,
        notes: payload.notes.unwrap_or_default(),
        lines: payload
            .lines
            .into_iter()
            .map(|line| OrderLineInput {
                inventory_item_id: line.inventory_item_id,
                quantity: line.quantity,
                unit_cost_paise: line.unit_cost_paise,
                gst_percent: line.gst_percent,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::create_order(&state, &tenant_id, &branch_id, &claims.sub, input).await?,
    )))
}

async fn submit_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    order_action(state, claims, headers, id, "submit", payload).await
}

async fn approve_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    require_approver(&claims)?;
    order_action(state, claims, headers, id, "approve", payload).await
}

async fn reject_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    require_approver(&claims)?;
    order_action(state, claims, headers, id, "reject", payload).await
}

async fn send_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    order_action(state, claims, headers, id, "send", payload).await
}
async fn close_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    order_action(state, claims, headers, id, "close", payload).await
}
async fn cancel_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    order_action(state, claims, headers, id, "cancel", payload).await
}
async fn reopen_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DecisionRequest>,
) -> ApiResult<OrderDetails> {
    order_action(state, claims, headers, id, "reopen", payload).await
}
async fn order_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<purchase_order_event_repository::PurchaseOrderEventRecord>> {
    let (t, b) = tenant_branch(&headers)?;
    purchase_service::order_details(&state, &t, &b, &id).await?;
    let rows = purchase_order_event_repository::list(&state.db, &t, &b, &id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase order events"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn order_action(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    id: String,
    action: &str,
    payload: DecisionRequest,
) -> ApiResult<OrderDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::transition_order(
            &state,
            &tenant_id,
            &branch_id,
            &id,
            &claims.sub,
            action,
            payload.note.as_deref().unwrap_or_default(),
        )
        .await?,
    )))
}

async fn list_receipts(
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
        supplier_id: payload.supplier_id,
        purchase_order_id: payload.purchase_order_id,
        supplier_name: payload.supplier_name,
        supplier_gstin: payload.supplier_gstin,
        supplier_invoice_number: payload.supplier_invoice_number,
        received_date: payload.received_date,
        due_date: payload.due_date,
        idempotency_key: payload.idempotency_key,
        lines: payload
            .lines
            .into_iter()
            .map(|line| ReceiptLineInput {
                inventory_item_id: line.inventory_item_id,
                quantity: line.quantity,
                unit_cost_paise: line.unit_cost_paise,
                gst_percent: line.gst_percent,
                batch_number: line.batch_number,
                batch_barcode: line.batch_barcode,
                expiry_date: line.expiry_date,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::receive(&state, &tenant_id, &branch_id, &claims.sub, input).await?,
    )))
}

async fn list_returns(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<purchase_repository::PurchaseReturnRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = purchase_repository::list_returns(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list purchase returns"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_return(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ReturnRequest>,
) -> ApiResult<purchase_service::CreatedId> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = ReturnInput {
        purchase_receipt_id: payload.purchase_receipt_id,
        reason: payload.reason,
        idempotency_key: payload.idempotency_key,
        lines: payload
            .lines
            .into_iter()
            .map(|line| ReturnLineInput {
                purchase_receipt_line_id: line.purchase_receipt_line_id,
                quantity: line.quantity,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::create_return(&state, &tenant_id, &branch_id, &claims.sub, input).await?,
    )))
}

async fn list_payables(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<purchase_repository::PayableRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = purchase_repository::list_payables(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list supplier payables"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PaymentRequest>,
) -> ApiResult<purchase_repository::SupplierPaymentRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = SupplierPaymentInput {
        purchase_receipt_id: payload.purchase_receipt_id,
        amount_paise: payload.amount_paise,
        payment_method: payload.payment_method,
        reference: payload.reference.unwrap_or_default(),
        idempotency_key: payload.idempotency_key,
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::pay_supplier(&state, &tenant_id, &branch_id, &claims.sub, input).await?,
    )))
}

fn require_approver(claims: &AuthClaims) -> Result<(), AppError> {
    let role = claims.role.trim().to_ascii_lowercase();
    if matches!(
        role.as_str(),
        "owner" | "admin" | "manager" | "inventory manager"
    ) || claims
        .permissions
        .iter()
        .any(|value| value == "purchases.approve" || value == "inventory.manage")
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "purchase order approval permission is required",
        ))
    }
}

fn required(value: &str, message: &'static str, max: usize) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::validation(message));
    }
    if value.chars().count() > max {
        return Err(AppError::validation("value is too long"));
    }
    Ok(value.to_string())
}

fn limited(value: Option<String>, max: usize) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_string();
    if value.chars().count() > max {
        return Err(AppError::validation("value is too long"));
    }
    Ok(value)
}
