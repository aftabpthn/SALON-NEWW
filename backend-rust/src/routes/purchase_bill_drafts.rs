use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::Response,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        purchase_bill_drafts_service::{
            self as drafts, DraftDetails, HeaderInput, LineInput, UploadInput,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/purchases/bill-drafts", get(list))
        .route(
            "/purchases/bill-drafts/upload",
            post(upload).layer(DefaultBodyLimit::max(10 * 1024 * 1024)),
        )
        .route("/purchases/bill-drafts/:id", get(detail).patch(save_header))
        .route("/purchases/bill-drafts/:id/source", get(source))
        .route("/purchases/bill-drafts/:id/match", post(run_match))
        .route("/purchases/bill-drafts/:id/confirm", post(confirm))
        .route("/purchases/bill-drafts/:id/cancel", post(cancel))
        .route("/purchases/bill-drafts/:id/lines", post(add_line))
        .route(
            "/purchases/bill-drafts/:id/lines/:line_id",
            axum::routing::patch(save_line).delete(remove_line),
        )
}

#[derive(Default, Deserialize)]
struct ListQuery {
    status: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadQuery {
    file_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HeaderRequest {
    supplier_id: Option<String>,
    purchase_order_id: Option<String>,
    supplier_name: String,
    supplier_gstin: String,
    bill_number: String,
    bill_date: Option<String>,
    subtotal_paise: i64,
    discount_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    total_paise: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LineRequest {
    raw_name: String,
    supplier_sku: String,
    inventory_item_id: Option<String>,
    hsn_sac: String,
    purchase_quantity: i32,
    pack_size: i32,
    conversion_factor: i32,
    quantity: i32,
    unit_cost_paise: i64,
    discount_bps: i32,
    discount_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    total_paise: i64,
    batch_number: String,
    expiry_date: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Vec<crate::repositories::purchase_bill_draft_repository::DraftRecord>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::list(&state, &t, &b, query.status.as_deref().unwrap_or_default()).await?,
    )))
}
async fn detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::details(&state, &t, &b, &id).await?,
    )))
}
async fn source(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let (t, b) = tenant_branch(&headers)?;
    let source = drafts::source(&state, &t, &b, &id).await?;
    let content_type = HeaderValue::from_str(&source.content_type)
        .map_err(|_| AppError::internal("purchase bill content type is invalid"))?;
    let mut response = Response::new(Body::from(source.bytes));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline"),
    );
    Ok(response)
}
async fn upload(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<UploadQuery>,
    bytes: Bytes,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if query.file_name.trim().is_empty() {
        return Err(AppError::validation("fileName is required"));
    }
    Ok(Json(ApiResponse::ok(
        drafts::upload(
            &state,
            &t,
            &b,
            &claims.sub,
            UploadInput {
                file_name: query.file_name,
                content_type,
                bytes: bytes.to_vec(),
            },
        )
        .await?,
    )))
}
async fn save_header(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<HeaderRequest>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::save_header(
            &state,
            &t,
            &b,
            &claims.sub,
            &id,
            HeaderInput {
                supplier_id: p.supplier_id,
                purchase_order_id: p.purchase_order_id,
                supplier_name: p.supplier_name,
                supplier_gstin: p.supplier_gstin,
                bill_number: p.bill_number,
                bill_date: p.bill_date,
                subtotal_paise: p.subtotal_paise,
                discount_paise: p.discount_paise,
                cgst_paise: p.cgst_paise,
                sgst_paise: p.sgst_paise,
                igst_paise: p.igst_paise,
                total_paise: p.total_paise,
            },
        )
        .await?,
    )))
}
async fn run_match(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::match_draft(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn confirm(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::confirm(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn cancel(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::cancel(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
fn line(p: LineRequest) -> LineInput {
    LineInput {
        raw_name: p.raw_name,
        supplier_sku: p.supplier_sku,
        inventory_item_id: p.inventory_item_id,
        hsn_sac: p.hsn_sac,
        purchase_quantity: p.purchase_quantity,
        pack_size: p.pack_size,
        conversion_factor: p.conversion_factor,
        quantity: p.quantity,
        unit_cost_paise: p.unit_cost_paise,
        discount_bps: p.discount_bps,
        discount_paise: p.discount_paise,
        gst_percent: p.gst_percent,
        taxable_paise: p.taxable_paise,
        cgst_paise: p.cgst_paise,
        sgst_paise: p.sgst_paise,
        igst_paise: p.igst_paise,
        total_paise: p.total_paise,
        batch_number: p.batch_number,
        expiry_date: p.expiry_date,
    }
}
async fn add_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<LineRequest>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::add_line(&state, &t, &b, &claims.sub, &id, line(p)).await?,
    )))
}
async fn save_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, line_id)): Path<(String, String)>,
    Json(p): Json<LineRequest>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::save_line(&state, &t, &b, &claims.sub, &id, &line_id, line(p)).await?,
    )))
}
async fn remove_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, line_id)): Path<(String, String)>,
) -> ApiResult<DraftDetails> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        drafts::remove_line(&state, &t, &b, &claims.sub, &id, &line_id).await?,
    )))
}
