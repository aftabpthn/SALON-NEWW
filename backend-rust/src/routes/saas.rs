use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::saas_repository,
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        saas_service::{
            self, BillingRunInput, InvoiceIssueInput, InvoicePaymentInput, PlanInput,
            ProviderRefundInput, RazorpayCheckoutInput, SalonOnboardingInput,
            SubscriptionActionInput, SubscriptionCreate, SubscriptionPlanChangeInput,
            SubscriptionUpdate, TenantAdminCreateInput, TicketCreateInput, TicketCsatInput,
            TicketMergeInput, TicketMessageInput, TicketUpdateInput, UsageEventInput,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/saas/context", get(tenant_context))
        .route(
            "/saas/subscriptions/checkout",
            post(create_razorpay_checkout),
        )
        .route("/saas/subscriptions/:id/actions", post(subscription_action))
        .route(
            "/saas/subscriptions/:id/change-plan",
            post(change_subscription_plan),
        )
        .route("/saas/onboarding", post(onboard_salon))
        .route("/saas/admins", get(tenant_admins).post(create_tenant_admin))
        .route("/saas/tickets", get(tenant_tickets).post(create_ticket))
        .route("/saas/tickets/:id", get(tenant_ticket_detail))
        .route("/saas/tickets/:id/messages", post(tenant_ticket_message))
        .route("/saas/tickets/:id/csat", post(tenant_ticket_csat))
        .route(
            "/saas/tickets/:id/attachments/:attachment_id",
            get(tenant_ticket_attachment),
        )
        .route("/platform/saas/overview", get(platform_overview))
        .route("/platform/saas/reports", get(platform_reports))
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
        .route(
            "/platform/saas/provider-payments/:id/refunds",
            post(refund_provider_payment),
        )
        .route("/platform/saas/tickets", get(platform_tickets))
        .route(
            "/platform/saas/tickets/:id",
            get(platform_ticket_detail).patch(update_ticket),
        )
        .route(
            "/platform/saas/tickets/:id/messages",
            post(platform_ticket_message),
        )
        .route(
            "/platform/saas/tickets/:id/actions",
            post(platform_ticket_action),
        )
        .route(
            "/platform/saas/tickets/:id/attachments/:attachment_id",
            get(platform_ticket_attachment),
        )
        .route("/platform/saas/tickets/escalate", post(escalate_tickets))
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

async fn tenant_admins(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<saas_repository::TenantAdminRecord>> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::tenant_admins(&state.db, &tenant_id).await?,
    )))
}

async fn create_tenant_admin(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<TenantAdminCreateInput>,
) -> ApiResult<saas_repository::TenantAdminRecord> {
    if !claims.role.eq_ignore_ascii_case("owner") {
        return Err(crate::models::common::AppError::forbidden(
            "only the Salon Owner can create a Tenant Admin",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::create_tenant_admin(&state.db, &tenant_id, &branch_id, &claims.sub, payload)
            .await?,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanQuery {
    include_inactive: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ReportQuery {
    days: Option<i32>,
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
async fn create_razorpay_checkout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<RazorpayCheckoutInput>,
) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::create_razorpay_checkout(
            &state.db,
            &state.settings,
            &tenant,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}
async fn subscription_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SubscriptionActionInput>,
) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::subscription_action(
            &state.db,
            &state.settings,
            &tenant,
            &id,
            &claims.sub,
            payload,
        )
        .await?,
    )))
}
async fn change_subscription_plan(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SubscriptionPlanChangeInput>,
) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::change_subscription_plan(
            &state.db,
            &state.settings,
            &tenant,
            &id,
            &claims.sub,
            payload,
        )
        .await?,
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

async fn tenant_ticket_csat(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TicketCsatInput>,
) -> ApiResult<Value> {
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        saas_service::submit_csat(&state.db, &id, &tenant, &claims.sub, payload).await?,
    )))
}

async fn tenant_ticket_attachment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    let (tenant, _) = tenant_branch(&headers)?;
    attachment_response(
        saas_service::ticket_attachment(&state.db, &id, &attachment_id, Some(&tenant), false)
            .await?,
    )
}

async fn platform_overview(State(state): State<AppState>) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::platform_overview(&state.db).await?,
    )))
}
async fn platform_reports(
    State(state): State<AppState>,
    Query(query): Query<ReportQuery>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::platform_reports(&state.db, query.days.unwrap_or(30)).await?,
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
async fn refund_provider_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<ProviderRefundInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::refund_provider_payment(
            &state.db,
            &state.settings,
            &id,
            &claims.sub,
            payload,
        )
        .await?,
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

async fn platform_ticket_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(id): Path<String>,
    Json(payload): Json<TicketMergeInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        saas_service::merge_ticket(&state.db, &id, &claims.sub, payload).await?,
    )))
}

async fn platform_ticket_attachment(
    State(state): State<AppState>,
    Path((id, attachment_id)): Path<(String, String)>,
) -> Result<Response, AppError> {
    attachment_response(
        saas_service::ticket_attachment(&state.db, &id, &attachment_id, None, true).await?,
    )
}

async fn escalate_tickets(State(state): State<AppState>) -> ApiResult<Value> {
    let escalated = saas_service::escalate_due_tickets(&state.db).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"escalated":escalated}),
    )))
}

fn attachment_response(
    file: saas_repository::SupportAttachmentDownload,
) -> Result<Response, AppError> {
    let safe_name: String = file
        .file_name
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || matches!(value, ' ' | '.' | '-' | '_'))
        .collect();
    let mut response = file.content.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&file.content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"{}\"",
            if safe_name.is_empty() {
                "attachment"
            } else {
                &safe_name
            }
        ))
        .map_err(|_| AppError::internal("invalid attachment filename"))?,
    );
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}
