use axum::{
    extract::{Path, Query, State},
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
            ReceiptLineInput, ReturnInput, ReturnLineInput, SupplierAdvanceInput,
            SupplierPaymentInput,
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
        .route("/purchases/suppliers/:id/ledger", get(supplier_ledger))
        .route("/purchases/orders", get(list_orders).post(create_order))
        .route(
            "/purchases/orders/bulk-raise",
            axum::routing::post(bulk_raise_orders),
        )
        .route(
            "/purchases/orders/import",
            axum::routing::post(import_order),
        )
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
        .route("/purchases/grn/:id/barcode-labels", get(grn_barcode_labels))
        .route(
            "/purchases/price-update-requests",
            get(price_update_requests),
        )
        .route(
            "/purchases/price-update-requests/:id/review",
            axum::routing::post(review_price_update),
        )
        .route("/purchases/returns", get(list_returns).post(create_return))
        .route("/purchases/quarantine", get(list_quarantine))
        .route(
            "/purchases/quarantine/:id/dispositions",
            axum::routing::post(dispose_quarantine),
        )
        .route("/purchases/payables", get(list_payables))
        .route("/purchases/payment-summary", get(payment_summary))
        .route("/purchases/payments", axum::routing::post(create_payment))
        .route(
            "/purchases/supplier-advances",
            axum::routing::post(create_supplier_advance),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierRequest {
    #[serde(default)]
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
    #[serde(default)]
    shipping_paise: i64,
    #[serde(default)]
    handling_paise: i64,
    lines: Vec<OrderLineRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderLineRequest {
    inventory_item_id: String,
    quantity: i32,
    #[serde(default)]
    retail_quantity: i32,
    #[serde(default)]
    consumable_quantity: i32,
    unit_cost_paise: i64,
    #[serde(default)]
    discount_bps: i32,
    gst_percent: i32,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionRequest {
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BulkOrderRequest {
    ids: Vec<String>,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptRequest {
    supplier_id: Option<String>,
    purchase_order_id: Option<String>,
    supplier_name: String,
    supplier_gstin: String,
    supplier_invoice_number: String,
    supplier_invoice_date: Option<String>,
    received_date: Option<String>,
    due_date: Option<String>,
    #[serde(default)]
    challan_number: String,
    #[serde(default)]
    delivery_reference: String,
    #[serde(default)]
    shipping_paise: i64,
    #[serde(default)]
    handling_paise: i64,
    #[serde(default)]
    round_off_paise: i64,
    idempotency_key: String,
    #[serde(default)]
    backdated_operational_approval: bool,
    #[serde(default)]
    accept_excess: bool,
    #[serde(default)]
    request_master_price_updates: Vec<String>,
    lines: Vec<ReceiptLineRequest>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptLineRequest {
    inventory_item_id: String,
    quantity: i32,
    retail_quantity: Option<i32>,
    consumable_quantity: Option<i32>,
    #[serde(default)]
    free_quantity: i32,
    unit_cost_paise: i64,
    #[serde(default)]
    discount_bps: i32,
    gst_percent: Option<i32>,
    #[serde(default)]
    damaged_quantity: i32,
    #[serde(default)]
    rejected_quantity: i32,
    #[serde(default)]
    variance_reason: String,
    batch_number: Option<String>,
    batch_barcode: Option<String>,
    expiry_date: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReturnRequest {
    purchase_receipt_id: String,
    return_date: String,
    credit_note_number: String,
    credit_note_date: String,
    evidence_reference: String,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuarantineDispositionRequest {
    action: String,
    quantity: i32,
    reason: String,
    evidence_reference: String,
    credit_note_number: Option<String>,
    idempotency_key: String,
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierAdvanceRequest {
    supplier_id: String,
    amount_paise: i64,
    payment_method: String,
    reference: Option<String>,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseListQuery {
    page: Option<i64>,
    page_size: Option<i64>,
    with_count: Option<bool>,
    supplier_id: Option<String>,
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
    let code = limited(Some(payload.code), 80)?;
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
    Query(query): Query<PurchaseListQuery>,
) -> ApiResult<Vec<purchase_repository::PurchaseOrderRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (limit, offset) = resolve_purchase_pagination(&query, Some(200));
    let rows = purchase_repository::list_orders(&state.db, &tenant_id, &branch_id, limit, offset)
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
    require_cost_visibility(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = OrderInput {
        supplier_id: payload.supplier_id,
        expected_date: payload.expected_date,
        notes: payload.notes.unwrap_or_default(),
        shipping_paise: payload.shipping_paise,
        handling_paise: payload.handling_paise,
        lines: payload
            .lines
            .into_iter()
            .map(|line| OrderLineInput {
                inventory_item_id: line.inventory_item_id,
                quantity: line.quantity,
                retail_quantity: line.retail_quantity,
                consumable_quantity: line.consumable_quantity,
                unit_cost_paise: line.unit_cost_paise,
                discount_bps: line.discount_bps,
                gst_percent: line.gst_percent,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::create_order(&state, &tenant_id, &branch_id, &claims.sub, input).await?,
    )))
}

async fn import_order(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PurchaseOrderImportRequest>,
) -> ApiResult<purchase_service::PurchaseOrderImportResult> {
    require_purchase_import(&claims)?;
    require_cost_visibility(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::import_order_csv(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.file_name,
            &payload.csv,
        )
        .await?,
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

async fn bulk_raise_orders(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BulkOrderRequest>,
) -> ApiResult<Vec<OrderDetails>> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let rows = purchase_service::bulk_raise_orders(
        &state,
        &tenant,
        &branch,
        &claims.sub,
        payload.ids,
        &payload.note,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_receipts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PurchaseListQuery>,
) -> ApiResult<Vec<purchase_repository::PurchaseReceipt>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (limit, offset) = resolve_purchase_pagination(&query, Some(100));
    let rows = purchase_repository::list(&state.db, &tenant_id, &branch_id, limit, offset)
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

async fn grn_barcode_labels(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<BarcodeLabelQuery>,
) -> ApiResult<Vec<purchase_repository::PurchaseBarcodeLabel>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    purchase_service::details(&state, &tenant_id, &branch_id, &id).await?;
    let usage = query.product_usage.unwrap_or_else(|| "all".to_owned());
    if !matches!(usage.as_str(), "all" | "retail" | "consumable") {
        return Err(AppError::validation(
            "productUsage must be all, retail, or consumable",
        ));
    }
    let mut rows = purchase_repository::barcode_labels(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load GRN barcode labels"))?;
    rows.retain(|row| {
        !row.barcode.is_empty()
            && match usage.as_str() {
                "retail" => row.retail_quantity > 0,
                "consumable" => row.consumable_quantity > 0,
                _ => row.retail_quantity + row.consumable_quantity > 0,
            }
    });
    Ok(Json(ApiResponse::ok(rows)))
}

async fn price_update_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PriceUpdateQuery>,
) -> ApiResult<Vec<purchase_repository::PurchasePriceUpdateRequest>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if query
        .status
        .as_deref()
        .is_some_and(|status| !matches!(status, "pending" | "approved" | "rejected"))
    {
        return Err(AppError::validation(
            "status must be pending, approved, or rejected",
        ));
    }
    let rows = purchase_repository::list_price_update_requests(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load master price requests"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn review_price_update(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PriceUpdateReviewRequest>,
) -> ApiResult<purchase_service::PriceUpdateReviewResult> {
    require_approver(&claims)?;
    require_cost_visibility(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::review_price_update(
            &state,
            &tenant_id,
            &branch_id,
            &id,
            &claims.sub,
            payload.approve,
            &payload.note,
        )
        .await?,
    )))
}

async fn receive(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ReceiptRequest>,
) -> ApiResult<ReceiptDetails> {
    require_cost_visibility(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = ReceiptInput {
        supplier_id: payload.supplier_id,
        purchase_order_id: payload.purchase_order_id,
        supplier_name: payload.supplier_name,
        supplier_gstin: payload.supplier_gstin,
        supplier_invoice_number: payload.supplier_invoice_number,
        supplier_invoice_date: payload.supplier_invoice_date,
        received_date: payload.received_date,
        due_date: payload.due_date,
        challan_number: payload.challan_number,
        delivery_reference: payload.delivery_reference,
        shipping_paise: payload.shipping_paise,
        handling_paise: payload.handling_paise,
        round_off_paise: payload.round_off_paise,
        tax_totals: None,
        idempotency_key: payload.idempotency_key,
        backdated_operational_approval: payload.backdated_operational_approval,
        accept_excess: payload.accept_excess,
        request_master_price_updates: payload.request_master_price_updates.into_iter().collect(),
        lines: payload
            .lines
            .into_iter()
            .map(|line| ReceiptLineInput {
                inventory_item_id: line.inventory_item_id,
                quantity: line.quantity,
                retail_quantity: line.retail_quantity,
                consumable_quantity: line.consumable_quantity,
                free_quantity: line.free_quantity,
                unit_cost_paise: line.unit_cost_paise,
                discount_bps: line.discount_bps,
                gst_percent: line.gst_percent,
                damaged_quantity: line.damaged_quantity,
                rejected_quantity: line.rejected_quantity,
                variance_reason: line.variance_reason,
                batch_number: line.batch_number,
                batch_barcode: line.batch_barcode,
                expiry_date: line.expiry_date,
            })
            .collect(),
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::receive(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            can_receive_excess(&claims),
            input,
        )
        .await?,
    )))
}

async fn list_returns(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PurchaseListQuery>,
) -> ApiResult<Vec<purchase_repository::PurchaseReturnRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (limit, offset) = resolve_purchase_pagination(&query, None);
    let rows = purchase_repository::list_returns(&state.db, &tenant_id, &branch_id, limit, offset)
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
        return_date: payload.return_date,
        credit_note_number: payload.credit_note_number,
        credit_note_date: payload.credit_note_date,
        evidence_reference: payload.evidence_reference,
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

async fn list_quarantine(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<purchase_repository::ReceivingQuarantineRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::list_quarantine(&state, &tenant_id, &branch_id).await?,
    )))
}

async fn dispose_quarantine(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<QuarantineDispositionRequest>,
) -> ApiResult<purchase_repository::ReceivingQuarantineRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        purchase_service::dispose_quarantine(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            purchase_service::QuarantineDispositionInput {
                action: payload.action,
                quantity: payload.quantity,
                reason: payload.reason,
                evidence_reference: payload.evidence_reference,
                credit_note_number: payload.credit_note_number.unwrap_or_default(),
                idempotency_key: payload.idempotency_key,
            },
        )
        .await?,
    )))
}

async fn list_payables(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PurchaseListQuery>,
) -> ApiResult<Vec<purchase_repository::PayableRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (limit, offset) = resolve_purchase_pagination(&query, None);
    let rows = purchase_repository::list_payables(
        &state.db,
        &tenant_id,
        &branch_id,
        query.supplier_id.as_deref(),
        limit,
        offset,
    )
    .await
    .map_err(|_| AppError::internal("failed to list supplier payables"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn payment_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<purchase_repository::SupplierPaymentSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let summary = purchase_repository::supplier_payment_summary(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load supplier payment summary"))?;
    Ok(Json(ApiResponse::ok(summary)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PurchaseOrderImportRequest {
    file_name: String,
    csv: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PriceUpdateReviewRequest {
    approve: bool,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PriceUpdateQuery {
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BarcodeLabelQuery {
    product_usage: Option<String>,
}

async fn supplier_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<purchase_repository::SupplierLedgerResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let ledger = purchase_repository::supplier_ledger(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load supplier ledger"))?
        .ok_or_else(|| AppError::not_found("supplier was not found"))?;
    Ok(Json(ApiResponse::ok(ledger)))
}

async fn create_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PaymentRequest>,
) -> ApiResult<purchase_repository::SupplierPaymentRecord> {
    require_supplier_payment_access(&claims)?;
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

async fn create_supplier_advance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SupplierAdvanceRequest>,
) -> ApiResult<purchase_repository::SupplierAdvanceRecord> {
    require_supplier_payment_access(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let input = SupplierAdvanceInput {
        supplier_id: payload.supplier_id,
        amount_paise: payload.amount_paise,
        payment_method: payload.payment_method,
        reference: payload.reference.unwrap_or_default(),
        idempotency_key: payload.idempotency_key,
    };
    Ok(Json(ApiResponse::ok(
        purchase_service::record_supplier_advance(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            input,
        )
        .await?,
    )))
}

fn resolve_purchase_pagination(
    query: &PurchaseListQuery,
    default_limit: Option<i64>,
) -> (Option<i64>, Option<i64>) {
    let _ = query.with_count;
    if query.page_size.is_none() && query.page.is_none() {
        return default_limit
            .map(|value| (Some(value.clamp(1, 500)), Some(0)))
            .unwrap_or((None, None));
    }

    let requested_limit = query.page_size.unwrap_or(50).clamp(1, 500);
    let page = query.page.unwrap_or(1).max(1);
    let offset = (page - 1).saturating_mul(requested_limit);
    (Some(requested_limit), Some(offset))
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

fn require_cost_visibility(claims: &AuthClaims) -> Result<(), AppError> {
    if claims.has_field_mask("inventory.cost") {
        Err(AppError::forbidden(
            "product cost visibility permission is required for this purchase action",
        ))
    } else {
        Ok(())
    }
}

fn can_receive_excess(claims: &AuthClaims) -> bool {
    matches!(
        claims.role.trim().to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "inventory manager"
    ) || claims.permissions.iter().any(|value| {
        matches!(
            value.as_str(),
            "purchases.receive_excess" | "inventory.manage"
        )
    })
}

fn require_purchase_import(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(
        claims.role.trim().to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "inventory manager"
    ) || claims
        .permissions
        .iter()
        .any(|value| matches!(value.as_str(), "purchases.import" | "inventory.manage"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "purchase order import permission is required",
        ))
    }
}

fn require_supplier_payment_access(claims: &AuthClaims) -> Result<(), AppError> {
    let role = claims.role.trim().to_ascii_lowercase();
    if matches!(
        role.as_str(),
        "owner" | "admin" | "manager" | "accountant" | "inventory manager"
    ) || claims.permissions.iter().any(|value| {
        matches!(
            value.as_str(),
            "finance.write" | "inventory.manage" | "purchases.pay"
        )
    }) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "supplier payment permission is required",
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
