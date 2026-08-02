use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult},
    routes::context::{current_business_date, tenant_branch},
    services::{auth_service::AuthClaims, stock_audit_service as service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inventory/stock-audits", get(list).post(create))
        .route("/inventory/stock-audits/:id", get(details))
        .route("/inventory/stock-audits/:id/counts", post(count))
        .route(
            "/inventory/stock-audits/:id/counts/import",
            post(import_counts),
        )
        .route(
            "/inventory/stock-audits/:id/close-counting",
            post(close_counting),
        )
        .route("/inventory/stock-audits/:id/submit", post(submit))
        .route("/inventory/stock-audits/:id/approve", post(approve))
        .route("/inventory/stock-audits/:id/reject", post(reject))
        .route("/inventory/stock-audits/:id/resubmit", post(resubmit))
        .route(
            "/inventory/stock-audits/:id/items/:item_id/reason",
            axum::routing::patch(reason),
        )
        .route(
            "/inventory/stock-audits/:id/items/:item_id/findings",
            post(finding),
        )
        .route(
            "/inventory/stock-audits/:id/items/:item_id/reconciliation",
            axum::routing::patch(reconciliation),
        )
        .route("/inventory/scanner-events", get(scanner_events).post(scan))
        .route("/inventory/barcode-aliases", get(aliases).post(save_alias))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateRequest {
    name: String,
    blind_counting: bool,
    required_counters: i32,
    recount_threshold: i32,
    business_date: Option<NaiveDate>,
    #[serde(default = "default_full")]
    audit_scope: String,
    #[serde(default = "default_all")]
    product_scope: String,
    #[serde(default = "default_require_count")]
    unaudited_policy: String,
    #[serde(default)]
    item_ids: Vec<String>,
}
fn default_full() -> String {
    "full".into()
}
fn default_all() -> String {
    "all".into()
}
fn default_require_count() -> String {
    "require_count".into()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CountRequest {
    inventory_item_id: String,
    counted_quantity: i32,
    device_id: String,
    idempotency_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CountImportRequest {
    device_id: String,
    idempotency_key: String,
    rows: Vec<CountImportRow>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CountImportRow {
    inventory_item_id: String,
    counted_quantity: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReasonRequest {
    reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReconciliationRequest {
    reconciled_quantity: i32,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    notes: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FindingRequest {
    finding_type: String,
    notes: String,
    evidence: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RejectRequest {
    reason: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScanRequest {
    device_id: String,
    workflow: String,
    code: String,
    client_event_id: String,
    captured_at: Option<DateTime<Utc>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AliasRequest {
    code: String,
    alias_type: String,
    target_id: String,
    inventory_item_id: Option<String>,
    active: bool,
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::stock_audit_repository::SessionRecord>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(service::list(&state, &t, &b).await?)))
}
async fn details(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::details(&state, &t, &b, &id).await?,
    )))
}
async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Json(p): Json<CreateRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    let elevated = matches!(claims.role.as_str(), "owner" | "admin")
        || claims
            .permissions
            .iter()
            .any(|permission| permission == "inventory.approve");
    Ok(Json(ApiResponse::ok(
        service::create(
            &state,
            &t,
            &b,
            &claims.sub,
            &p.name,
            p.blind_counting,
            p.required_counters,
            p.recount_threshold,
            p.business_date.unwrap_or_else(current_business_date),
            &p.audit_scope,
            &p.product_scope,
            &p.unaudited_policy,
            p.item_ids,
            elevated,
            elevated,
        )
        .await?,
    )))
}
async fn import_counts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(p): Json<CountImportRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::import_counts(
            &state,
            &t,
            &b,
            &claims.sub,
            &id,
            &p.device_id,
            &p.idempotency_key,
            p.rows
                .into_iter()
                .map(|row| (row.inventory_item_id, row.counted_quantity))
                .collect(),
        )
        .await?,
    )))
}
async fn count(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(p): Json<CountRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::record_count(
            &state,
            &t,
            &b,
            &claims.sub,
            &id,
            &p.inventory_item_id,
            p.counted_quantity,
            &p.device_id,
            &p.idempotency_key,
        )
        .await?,
    )))
}
async fn close_counting(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::close_counting(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn reason(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path((id, item)): Path<(String, String)>,
    Json(p): Json<ReasonRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::set_variance_reason(&state, &t, &b, &claims.sub, &id, &item, &p.reason).await?,
    )))
}
async fn reconciliation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path((id, item)): Path<(String, String)>,
    Json(p): Json<ReconciliationRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::save_reconciliation(
            &state,
            &t,
            &b,
            &claims.sub,
            &id,
            &item,
            p.reconciled_quantity,
            &p.reason,
            &p.notes,
        )
        .await?,
    )))
}
async fn finding(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path((id, item)): Path<(String, String)>,
    Json(p): Json<FindingRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::add_finding(
            &state,
            &t,
            &b,
            &claims.sub,
            &id,
            &item,
            &p.finding_type,
            &p.notes,
            p.evidence,
        )
        .await?,
    )))
}
async fn submit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::submit_for_approval(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn approve(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::approve(&state, &t, &b, &claims.sub, &claims.role, &id).await?,
    )))
}
async fn reject(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(p): Json<RejectRequest>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::reject(&state, &t, &b, &claims.sub, &id, &p.reason).await?,
    )))
}
async fn resubmit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
) -> ApiResult<service::SessionDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::resubmit(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn scan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Json(p): Json<ScanRequest>,
) -> ApiResult<service::ScanResult> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::scan(
            &state,
            &t,
            &b,
            &claims.sub,
            &p.device_id,
            &p.workflow,
            &p.code,
            &p.client_event_id,
            p.captured_at.unwrap_or_else(Utc::now),
        )
        .await?,
    )))
}
async fn scanner_events(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::stock_audit_repository::ScannerEventRecord>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::scanner_events(&state, &t, &b).await?,
    )))
}
async fn save_alias(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Json(p): Json<AliasRequest>,
) -> ApiResult<crate::repositories::stock_audit_repository::BarcodeAliasRecord> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::save_alias(
            &state,
            &t,
            &b,
            &claims.sub,
            &p.code,
            &p.alias_type,
            &p.target_id,
            p.inventory_item_id.as_deref(),
            p.active,
        )
        .await?,
    )))
}
async fn aliases(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::stock_audit_repository::BarcodeAliasRecord>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::aliases(&state, &t, &b).await?,
    )))
}
