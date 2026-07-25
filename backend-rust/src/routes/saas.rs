use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult},
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        saas_service::{
            self, BillingRunInput, InvoiceIssueInput, InvoicePaymentInput, PlanInput,
            SalonOnboardingInput, SubscriptionCreate, SubscriptionUpdate, TicketCreateInput,
            TicketMessageInput, TicketUpdateInput, UsageEventInput,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/saas/context", get(tenant_context))
        .route("/saas/onboarding", post(onboard_salon))
        .route("/saas/tickets", get(tenant_tickets).post(create_ticket))
        .route("/saas/tickets/:id", get(tenant_ticket_detail))
        .route("/saas/tickets/:id/messages", post(tenant_ticket_message))
        .route("/platform/saas/overview", get(platform_overview))
        .route("/platform/saas/tenants", get(platform_tenants))
        .route(
            "/platform/saas/plans",
            get(platform_plans).post(create_plan),
        )
        .route("/platform/saas/plans/:id", patch(update_plan))
        .route(
            "/platform/saas/subscriptions",
            get(platform_subscriptions).post(create_subscription),
        )
        .route(
            "/platform/saas/subscriptions/:id",
            patch(update_subscription),
        )
        .route(
            "/platform/saas/usage",
            get(platform_usage).post(record_usage),
        )
        .route("/platform/saas/invoices", get(platform_invoices))
        .route("/platform/saas/invoices/issue", post(issue_invoice))
        .route("/platform/saas/invoices/run", post(run_billing))
        .route("/platform/saas/invoices/:id/payments", post(record_payment))
        .route("/platform/saas/tickets", get(platform_tickets))
        .route(
            "/platform/saas/tickets/:id",
            get(platform_ticket_detail).patch(update_ticket),
        )
        .route(
            "/platform/saas/tickets/:id/messages",
            post(platform_ticket_message),
        )
}

async fn onboard_salon(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<SalonOnboardingInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::onboard_salon(&state.db, &claims.sub, payload).await?,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanQuery {
    include_inactive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TenantFilter {
    tenant_id: Option<String>,
}

async fn tenant_context(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::tenant_context(&state.db, &tenant).await?,
    )))
}
async fn tenant_tickets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::tickets(&state.db, Some(&tenant)).await?,
    )))
}
async fn create_ticket(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<TicketCreateInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::create_ticket(&state.db, &tenant, &branch, &claims.sub, payload).await?,
    )))
}
async fn tenant_ticket_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::ticket_detail(&state.db, &id, Some(&tenant), false).await?,
    )))
}
async fn tenant_ticket_message(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TicketMessageInput>,
) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::add_message(&state.db, &id, Some(&tenant), &claims.sub, false, payload)
            .await?,
    )))
}

async fn platform_overview(State(state): State<AppState>) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::platform_overview(&state.db).await?,
    )))
}
async fn platform_tenants(State(state): State<AppState>) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::tenants(&state.db).await?,
    )))
}
async fn platform_plans(
    State(state): State<AppState>,
    Query(query): Query<PlanQuery>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::plans(&state.db, query.include_inactive.unwrap_or(true)).await?,
    )))
}
async fn create_plan(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<PlanInput>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::create_plan(&state.db, &claims.sub, payload).await?,
    )))
}
async fn update_plan(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<PlanInput>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::update_plan(&state.db, &id, &claims.sub, payload).await?,
    )))
}
async fn platform_subscriptions(
    State(state): State<AppState>,
    Query(query): Query<TenantFilter>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::subscriptions(&state.db, query.tenant_id.as_deref()).await?,
    )))
}
async fn create_subscription(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<SubscriptionCreate>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::create_subscription(&state.db, &claims.sub, payload).await?,
    )))
}
async fn update_subscription(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<SubscriptionUpdate>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::update_subscription(&state.db, &id, &claims.sub, payload).await?,
    )))
}
async fn platform_usage(
    State(state): State<AppState>,
    Query(query): Query<TenantFilter>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::usage(&state.db, query.tenant_id.as_deref()).await?,
    )))
}
async fn record_usage(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<UsageEventInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::record_usage(&state.db, &claims.sub, payload).await?,
    )))
}
async fn platform_invoices(
    State(state): State<AppState>,
    Query(query): Query<TenantFilter>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::invoices(&state.db, query.tenant_id.as_deref()).await?,
    )))
}
async fn issue_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<InvoiceIssueInput>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::issue_invoice(&state.db, &claims.sub, payload).await?,
    )))
}
async fn run_billing(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<BillingRunInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::run_billing(&state.db, &claims.sub, payload).await?,
    )))
}
async fn record_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<InvoicePaymentInput>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::record_payment(&state.db, &id, &claims.sub, payload).await?,
    )))
}
async fn platform_tickets(
    State(state): State<AppState>,
    Query(query): Query<TenantFilter>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        saas_service::tickets(&state.db, query.tenant_id.as_deref()).await?,
    )))
}
async fn platform_ticket_detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::ticket_detail(&state.db, &id, None, true).await?,
    )))
}
async fn platform_ticket_message(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<TicketMessageInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::add_message(&state.db, &id, None, &claims.sub, true, payload).await?,
    )))
}
async fn update_ticket(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<TicketUpdateInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::update_ticket(&state.db, &id, &claims.sub, payload).await?,
    )))
}
