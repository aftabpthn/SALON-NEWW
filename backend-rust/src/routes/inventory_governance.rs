use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, inventory_governance_service as svc},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupplierQuery {
    supplier_id: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/inventory/policy", get(get_policy).put(save_policy))
        .route("/inventory/master-data", get(master_data))
        .route("/inventory/master-data/values", post(save_master_value))
        .route("/inventory/supplier-governance", get(supplier_governance))
        .route("/inventory/supplier-governance/prices", post(save_price))
        .route("/inventory/operations-health", get(operations_health))
        .route(
            "/inventory/supplier-governance/communications/:id/retry",
            post(retry_communication),
        )
        .route(
            "/inventory/supplier-governance/communications",
            post(queue_communication),
        )
        .route(
            "/inventory/negative-stock-requests",
            get(negative_stock_requests).post(request_negative_stock),
        )
        .route(
            "/inventory/negative-stock-requests/:id/review",
            post(review_negative_stock),
        )
        .route(
            "/inventory/backbar-containers",
            get(containers).post(create_container),
        )
        .route(
            "/inventory/backbar-containers/:id/label",
            get(container_label),
        )
        .route(
            "/inventory/backbar-containers/:id/open",
            post(open_container),
        )
        .route(
            "/inventory/backbar-containers/:id/consume",
            post(consume_container),
        )
        .route(
            "/inventory/backbar-containers/:id/overrides",
            post(request_override),
        )
        .route(
            "/inventory/backbar-overrides/:id/review",
            post(review_override),
        )
        .route("/inventory/floor-control", get(floor_control))
        .route("/inventory/checkouts", post(checkout))
        .route("/inventory/conversions", post(convert))
        .route(
            "/inventory/operational-movements/:id/reverse",
            post(reverse_movement),
        )
        .route("/inventory/floor-locations", post(save_floor_location))
        .route(
            "/inventory/backbar-containers/:id/custody",
            post(transfer_container_custody),
        )
        .route("/inventory/floor-closings", post(create_floor_closing))
        .route(
            "/inventory/floor-closings/:id/review",
            post(review_floor_closing),
        )
}
fn manager(c: &AuthClaims) -> Result<(), AppError> {
    if matches!(
        c.role.as_str(),
        "owner"
            | "admin"
            | "manager"
            | "inventory manager"
            | "inventory_manager"
            | "inventoryManager"
    ) || c.permissions.iter().any(|permission| {
        matches!(
            permission.as_str(),
            "inventory.manage" | "inventory.write" | "inventory.approve"
        )
    }) {
        Ok(())
    } else {
        Err(AppError::forbidden("inventory management role is required"))
    }
}
fn owner(c: &AuthClaims) -> Result<(), AppError> {
    if matches!(c.role.as_str(), "owner" | "admin") {
        Ok(())
    } else {
        Err(AppError::forbidden("owner approval role is required"))
    }
}
async fn get_policy(State(s): State<AppState>, h: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(svc::policy(&s.db, &t, &b).await?)))
}
async fn save_policy(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::PolicyWrite>,
) -> ApiResult<Value> {
    owner(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::save_policy(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn supplier_governance(
    State(s): State<AppState>,
    h: HeaderMap,
    Query(q): Query<SupplierQuery>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::supplier_governance(&s.db, &t, &b, q.supplier_id.as_deref()).await?,
    )))
}
async fn save_price(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::PriceWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::save_price(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn queue_communication(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::CommunicationWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::queue_communication(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn operations_health(State(s): State<AppState>, h: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::operations_health(&s.db, &t, &b).await?,
    )))
}
async fn retry_communication(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::retry_communication(&s.db, &t, &b, &id).await?,
    )))
}
async fn containers(State(s): State<AppState>, h: HeaderMap) -> ApiResult<Vec<Value>> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(svc::containers(&s.db, &t, &b).await?)))
}
async fn container_label(
    State(s): State<AppState>,
    h: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::container_label(&s.db, &t, &b, &id).await?,
    )))
}
async fn create_container(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::ContainerWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::create_container(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn open_container(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::ContainerAction>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::open_container(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}
async fn consume_container(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::ConsumeWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::consume_container(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}
async fn request_override(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::OverrideWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::request_override(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}
async fn review_override(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::OverrideReview>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::review_override(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}
async fn master_data(State(s): State<AppState>, h: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::master_data(&s.db, &t, &b).await?,
    )))
}
async fn save_master_value(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::MasterValueWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::save_master_value(&s.db, &t, &b, &c.sub, p).await?,
    )))
}

async fn floor_control(State(s): State<AppState>, h: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::floor_control(&s.db, &t, &b).await?,
    )))
}
async fn checkout(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::CheckoutWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t,b)=tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(svc::checkout(&s.db,&t,&b,&c.sub,p).await?)))
}
async fn convert(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::ConversionWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t,b)=tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(svc::convert(&s.db,&t,&b,&c.sub,p).await?)))
}
async fn reverse_movement(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::MovementReversalWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t,b)=tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(svc::reverse_movement(&s.db,&t,&b,&c.sub,&id,p).await?)))
}
async fn save_floor_location(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::FloorLocationWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::save_floor_location(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn transfer_container_custody(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::ContainerCustodyWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::transfer_container_custody(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}
async fn create_floor_closing(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::FloorClosingWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::create_floor_closing(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn review_floor_closing(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::FloorClosingReview>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::review_floor_closing(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}

async fn negative_stock_requests(State(s): State<AppState>, h: HeaderMap) -> ApiResult<Vec<Value>> {
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::negative_stock_requests(&s.db, &t, &b).await?,
    )))
}
async fn request_negative_stock(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Json(p): Json<svc::NegativeStockWrite>,
) -> ApiResult<Value> {
    manager(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::request_negative_stock(&s.db, &t, &b, &c.sub, p).await?,
    )))
}
async fn review_negative_stock(
    State(s): State<AppState>,
    Extension(c): Extension<AuthClaims>,
    h: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<svc::NegativeStockReview>,
) -> ApiResult<Value> {
    owner(&c)?;
    let (t, b) = tenant_branch(&h)?;
    Ok(Json(ApiResponse::ok(
        svc::review_negative_stock(&s.db, &t, &b, &c.sub, &id, p).await?,
    )))
}
