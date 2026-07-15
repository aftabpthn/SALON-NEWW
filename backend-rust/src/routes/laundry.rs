use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        laundry_service::{
            self, CreateLaundryOrder, LaundryIssueResolution, LaundryIssueWrite, LaundryTransition,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inventory/laundry/summary", get(summary))
        .route("/inventory/laundry/orders", get(list).post(create))
        .route("/inventory/laundry/orders/:id", get(detail))
        .route("/inventory/laundry/orders/:id/transition", post(transition))
        .route("/inventory/laundry/orders/:id/issues", post(create_issue))
        .route("/inventory/laundry/issues/:id/resolve", post(resolve_issue))
        .route("/inventory/laundry/items/scan/:barcode", get(scan))
}

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
    q: Option<String>,
}
async fn summary(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::summary(&s.db, &t, &b).await?,
    )))
}
async fn list(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> ApiResult<Vec<Value>> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::list(
            &s.db,
            &t,
            &b,
            q.status.as_deref().filter(|v| !v.is_empty()),
            q.q.as_deref(),
        )
        .await?,
    )))
}
async fn detail(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::detail(&s.db, &t, &b, &id).await?,
    )))
}
async fn create(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<CreateLaundryOrder>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::create(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn transition(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<LaundryTransition>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::transition(&s.db, &t, &b, &id, &c.sub, p).await?,
    )))
}
async fn create_issue(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<LaundryIssueWrite>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::create_issue(&s.db, &t, &b, &id, &c.sub, p).await?,
    )))
}
async fn resolve_issue(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<LaundryIssueResolution>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::resolve_issue(&s.db, &t, &b, &id, &c.sub, p).await?,
    )))
}
async fn scan(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(barcode): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        laundry_service::scan(&s.db, &t, &b, &barcode).await?,
    )))
}
