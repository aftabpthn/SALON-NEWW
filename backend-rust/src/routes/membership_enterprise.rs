use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{
        invoice_pdf,
        membership_service::{self, MembershipPlanInput},
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/membership-enterprise/plans",
            axum::routing::get(list_plans).post(create_plan),
        )
        .route(
            "/membership-enterprise/plans/:id",
            axum::routing::patch(update_plan),
        )
        .route(
            "/membership-enterprise/active",
            axum::routing::get(list_active_memberships),
        )
        .route(
            "/membership-enterprise/active/:id/cancel",
            axum::routing::post(cancel_membership),
        )
        .route(
            "/membership-enterprise/renewals/:source_sale_id",
            axum::routing::get(confirm_renewal),
        )
        .route(
            "/membership-enterprise/ledger",
            axum::routing::get(list_ledger),
        )
        .route(
            "/membership-enterprise/reminders",
            axum::routing::get(list_generated_reminders),
        )
        .route(
            "/membership-enterprise/reminders/expiring",
            axum::routing::get(list_reminders),
        )
        .route(
            "/membership-enterprise/reminders/generate",
            axum::routing::post(generate_reminders),
        )
        .route(
            "/membership-enterprise/reminders/:id/approve",
            axum::routing::post(approve_reminder),
        )
        .route(
            "/membership-enterprise/auto-renew/queue",
            axum::routing::get(list_auto_renew_queue),
        )
        .route(
            "/membership-enterprise/active/:id/auto-renew",
            axum::routing::patch(set_auto_renew),
        )
        .route(
            "/membership-enterprise/reports/lifecycle",
            axum::routing::get(lifecycle_report),
        )
        .route(
            "/membership-enterprise/reports/commission",
            axum::routing::get(commission_report),
        )
        .route(
            "/membership-enterprise/reports/risk",
            axum::routing::get(risk_report),
        )
        .route(
            "/membership-enterprise/reports/enterprise",
            axum::routing::get(enterprise_report),
        )
        .route(
            "/membership-enterprise/reports/redeem",
            axum::routing::get(redeem_report),
        )
        .route(
            "/membership-enterprise/reports/sales-by-customer",
            axum::routing::get(sales_by_customer_report),
        )
        .route(
            "/membership-enterprise/reports/export",
            axum::routing::get(export_report),
        )
        .route(
            "/membership-enterprise/settings",
            axum::routing::get(get_membership_settings).patch(save_membership_settings),
        )
        .route(
            "/membership-enterprise/rewards/ledger",
            axum::routing::get(rewards_ledger),
        )
        .route(
            "/membership-enterprise/rewards/roi",
            axum::routing::get(rewards_roi),
        )
        .route(
            "/membership-enterprise/rewards/expiring",
            axum::routing::get(expiring_rewards),
        )
        .route(
            "/membership-enterprise/rewards/abuse-alerts",
            axum::routing::get(reward_abuse_alerts),
        )
        .route(
            "/membership-enterprise/risk-signals/:id/review",
            axum::routing::post(review_risk_signal),
        )
        .route(
            "/membership-enterprise/client/:client_id/eligibility",
            axum::routing::get(client_eligibility),
        )
        .route(
            "/membership-enterprise/client/:client_id/wallet",
            axum::routing::get(client_wallet),
        )
        .route(
            "/membership-enterprise/client/:client_id/360",
            axum::routing::get(client_360),
        )
        .route(
            "/membership-enterprise/client/:client_id/self-service/status-link",
            axum::routing::post(create_status_link),
        )
        .route(
            "/membership-enterprise/self-service/public/:token",
            axum::routing::get(public_status),
        )
        .route(
            "/membership-enterprise/sell",
            axum::routing::post(sale_checkout_intent),
        )
        .route(
            "/membership-enterprise/memberships/:id/renew",
            axum::routing::post(renewal_checkout_intent),
        )
        .route(
            "/membership-enterprise/memberships/:id/proration-preview",
            axum::routing::post(proration_preview),
        )
        .route(
            "/membership-enterprise/memberships/:id/360",
            axum::routing::get(membership_360),
        )
        .route(
            "/membership-enterprise/plan-changes",
            axum::routing::get(list_plan_changes),
        )
        .route(
            "/membership-enterprise/active/:id/change-plan",
            axum::routing::post(change_plan),
        )
        .route(
            "/membership-enterprise/family",
            axum::routing::get(list_family_members).post(add_family_member),
        )
        .route(
            "/membership-enterprise/family/:id",
            axum::routing::delete(remove_family_member),
        )
        .route(
            "/membership-enterprise/self-service",
            axum::routing::get(list_self_service_requests).post(create_self_service_request),
        )
        .route(
            "/membership-enterprise/self-service/:id",
            axum::routing::patch(resolve_self_service_request),
        )
        .route(
            "/membership-enterprise/auto-renew/attempts",
            axum::routing::get(list_auto_renew_attempts),
        )
        .route(
            "/membership-enterprise/active/:id/auto-renew/status",
            axum::routing::patch(update_auto_renew_status),
        )
        .route(
            "/membership-enterprise/active/:id/auto-renew/retry",
            axum::routing::post(retry_auto_renew),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanQuery {
    q: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanRequest {
    name: Option<String>,
    code: Option<String>,
    plan_type: Option<String>,
    price: Option<i64>,
    price_paise: Option<i64>,
    points_required: Option<i32>,
    discount_percent: Option<i32>,
    validity_days: Option<i32>,
    notes: Option<String>,
    service_ids: Option<Vec<String>>,
    benefit_rules: Option<Value>,
    active: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanResponse {
    id: String,
    name: String,
    code: String,
    plan_type: String,
    price: i64,
    price_paise: i64,
    points_required: i32,
    discount_percent: i32,
    validity_days: i32,
    notes: String,
    service_ids: Value,
    benefit_rules: Value,
    active: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelRequest {
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    days: Option<i64>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRemindersRequest {
    days: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusLinkRequest {
    client_membership_id: Option<String>,
}

#[derive(Deserialize)]
struct ExportQuery {
    format: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoRenewRequest {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipSaleRequest {
    client_id: String,
    plan_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanChangeRequest {
    target_membership_id: String,
    effective_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FamilyMemberRequest {
    client_membership_id: String,
    member_client_id: String,
    relationship: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelfServiceRequest {
    client_membership_id: String,
    request_type: String,
    target_membership_id: Option<String>,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveSelfServiceRequest {
    status: String,
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoRenewStatusRequest {
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveMembershipResponse {
    id: String,
    client_id: String,
    client_name: String,
    membership_id: String,
    membership_name: String,
    price_paise: i64,
    discount_percent: i32,
    source_sale_id: String,
    assigned_at: chrono::DateTime<chrono::Utc>,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    active: bool,
    cancelled_at: Option<chrono::DateTime<chrono::Utc>>,
    cancel_reason: String,
    remaining_credits: i64,
    status: &'static str,
    auto_renew_enabled: bool,
    auto_renew_status: String,
    pending_membership_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MembershipEligibilityResponse {
    eligible: bool,
    membership_id: String,
    membership_name: String,
    plan_type: String,
    discount_percent: i32,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MembershipCheckoutIntentResponse {
    client_id: String,
    plan_id: String,
    plan_name: String,
    price_paise: i64,
    source: &'static str,
    pos_sale: Value,
    reference_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MembershipClientResponse {
    id: String,
    name: String,
    phone: String,
    email: String,
    wallet_balance_paise: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MembershipClient360Response {
    client: MembershipClientResponse,
    memberships: Vec<ActiveMembershipResponse>,
    wallet: Vec<crate::repositories::membership_lifecycle_repository::MembershipWalletCreditRecord>,
    ledger: Vec<crate::repositories::membership_lifecycle_repository::LifecycleLedgerRecord>,
}

async fn list_plans(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PlanQuery>,
) -> ApiResult<Vec<PlanResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = membership_service::list_plans(
        &state.db,
        &tenant_id,
        &branch_id,
        &query.q.unwrap_or_default(),
        query.limit.unwrap_or(100).clamp(1, 1000),
        query.offset.unwrap_or(0).max(0),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(PlanResponse::from).collect(),
    )))
}

async fn create_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PlanRequest>,
) -> ApiResult<PlanResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let plan =
        membership_service::create_plan(&state.db, &tenant_id, &branch_id, payload.into()).await?;
    Ok(Json(ApiResponse::ok(plan.into())))
}

async fn update_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlanRequest>,
) -> ApiResult<PlanResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let plan =
        membership_service::update_plan(&state.db, &tenant_id, &branch_id, &id, payload.into())
            .await?
            .ok_or_else(|| AppError::not_found("membership plan was not found"))?;
    Ok(Json(ApiResponse::ok(plan.into())))
}

async fn list_active_memberships(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<ActiveMembershipResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = membership_service::active_memberships(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter()
            .map(ActiveMembershipResponse::from)
            .collect(),
    )))
}

async fn cancel_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CancelRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let cancelled = membership_service::cancel_membership(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload.reason.as_deref().unwrap_or("").trim(),
    )
    .await?;
    if !cancelled {
        return Err(AppError::not_found("active membership was not found"));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "cancelled": true, "id": id }),
    )))
}

async fn confirm_renewal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(source_sale_id): Path<String>,
) -> ApiResult<ActiveMembershipResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        membership_service::confirm_renewal(&state.db, &tenant_id, &branch_id, &source_sale_id)
            .await?
            .ok_or_else(|| {
                AppError::not_found("membership assignment was not found for this POS sale")
            })?;
    Ok(Json(ApiResponse::ok(row.into())))
}

async fn list_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::LifecycleLedgerRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::lifecycle_ledger(
            &state.db,
            &tenant_id,
            &branch_id,
            query.limit.unwrap_or(100).clamp(1, 1000),
        )
        .await?,
    )))
}

async fn list_reminders(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::RenewalQueueRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::expiring_reminders(
            &state.db,
            &tenant_id,
            &branch_id,
            query.days.unwrap_or(30).clamp(1, 30),
        )
        .await?,
    )))
}

async fn list_generated_reminders(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::membership_advanced_repository::MembershipReminderRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::reminder_rows(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn generate_reminders(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GenerateRemindersRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::generate_reminders(
            &state.db,
            &tenant_id,
            &branch_id,
            payload.days.unwrap_or(30),
        )
        .await?,
    )))
}

async fn approve_reminder(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !membership_service::approve_reminder(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &actor(&headers),
    )
    .await?
    {
        return Err(AppError::not_found("queued reminder was not found"));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"id":id,"status":"approved"}),
    )))
}

async fn list_auto_renew_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::RenewalQueueRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::auto_renew_queue(
            &state.db,
            &tenant_id,
            &branch_id,
            query.days.unwrap_or(30).clamp(1, 30),
        )
        .await?,
    )))
}

async fn set_auto_renew(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AutoRenewRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !membership_service::set_auto_renew(&state.db, &tenant_id, &branch_id, &id, payload.enabled)
        .await?
    {
        return Err(AppError::not_found("active membership was not found"));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "id": id, "autoRenewEnabled": payload.enabled }),
    )))
}

async fn lifecycle_report(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<crate::repositories::membership_lifecycle_repository::MembershipReportRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::lifecycle_report(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn commission_report(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::commission_report(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn risk_report(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::risk_report(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn enterprise_report(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::enterprise_report(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn redeem_report(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = membership_service::enterprise_report(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"summary":report["metrics"],"rows":report["memberships"]}),
    )))
}

async fn sales_by_customer_report(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = membership_service::enterprise_report(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"summary":report["metrics"],"rows":report["memberships"]}),
    )))
}

async fn get_membership_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::membership_settings(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_membership_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::save_membership_settings(&state.db, &tenant_id, &branch_id, &payload)
            .await?,
    )))
}

async fn rewards_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::membership_advanced_repository::MembershipRewardRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::rewards_ledger(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn rewards_roi(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::rewards_roi(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn expiring_rewards(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<Vec<Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::expiring_rewards(
            &state.db,
            &tenant_id,
            &branch_id,
            query.days.unwrap_or(30).clamp(1, 365),
        )
        .await?,
    )))
}

async fn reward_abuse_alerts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::reward_abuse_alerts(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn review_risk_signal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> ApiResult<crate::repositories::membership_advanced_repository::MembershipRiskReviewRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::review_risk(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &payload,
            &actor(&headers),
        )
        .await?,
    )))
}

async fn export_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ExportQuery>,
) -> Result<Response, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = membership_service::lifecycle_report(&state.db, &tenant_id, &branch_id).await?;
    let rows = vec![
        ("Active members", report.active_members.to_string()),
        ("Expired members", report.expired_members.to_string()),
        ("Cancelled members", report.cancelled_members.to_string()),
        ("At-risk members", report.at_risk_members.to_string()),
        ("Auto-renew failed", report.auto_renew_failed.to_string()),
        (
            "Membership sales paise",
            report.membership_sales_paise.to_string(),
        ),
        ("Commission paise", report.commission_paise.to_string()),
        ("Redeemed credits", report.redeemed_credits.to_string()),
        ("Credit liability", report.credit_liability.to_string()),
    ];
    let format = query.format.as_deref().unwrap_or("csv");
    let (body, content_type, file_name) = if format.eq_ignore_ascii_case("pdf") {
        let lines = rows
            .iter()
            .map(|(label, value)| format!("{label}: {value}"))
            .collect::<Vec<_>>();
        (
            invoice_pdf::render_text_report("Membership Report", &lines),
            "application/pdf",
            "membership-report.pdf",
        )
    } else {
        let csv = format!(
            "Metric,Value\n{}\n",
            rows.iter()
                .map(|(label, value)| format!("{label},{value}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        (
            csv.into_bytes(),
            "text/csv; charset=utf-8",
            "membership-report.csv",
        )
    };
    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{file_name}\" "))
            .map_err(|_| AppError::internal("failed to build export header"))?,
    );
    Ok(response)
}

async fn client_eligibility(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<MembershipEligibilityResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = membership_service::client_eligibility(&state.db, &tenant_id, &branch_id, &client_id)
        .await?;
    Ok(Json(ApiResponse::ok(match row {
        Some(row) => MembershipEligibilityResponse {
            eligible: eligibility_active(row.expires_at),
            membership_id: row.membership_id,
            membership_name: row.membership_name,
            plan_type: row.plan_type,
            discount_percent: row.discount_percent,
            expires_at: row.expires_at,
        },
        None => MembershipEligibilityResponse {
            eligible: false,
            membership_id: String::new(),
            membership_name: String::new(),
            plan_type: String::new(),
            discount_percent: 0,
            expires_at: None,
        },
    })))
}

async fn client_wallet(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<
    Vec<crate::repositories::membership_lifecycle_repository::MembershipWalletCreditRecord>,
> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::client_wallet(&state.db, &tenant_id, &branch_id, &client_id).await?,
    )))
}

async fn client_360(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> ApiResult<MembershipClient360Response> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let details =
        membership_service::client_360(&state.db, &tenant_id, &branch_id, &client_id).await?;
    Ok(Json(ApiResponse::ok(MembershipClient360Response {
        client: MembershipClientResponse {
            id: details.client.id,
            name: format!("{} {}", details.client.first_name, details.client.last_name)
                .trim()
                .to_string(),
            phone: details.client.phone,
            email: details.client.email,
            wallet_balance_paise: details.client.wallet_balance_paise,
        },
        memberships: details
            .memberships
            .into_iter()
            .map(ActiveMembershipResponse::from)
            .collect(),
        wallet: details.wallet,
        ledger: details.ledger,
    })))
}

async fn create_status_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Json(payload): Json<StatusLinkRequest>,
) -> ApiResult<crate::repositories::membership_advanced_repository::PublicMembershipStatusRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::create_status_link(
            &state.db,
            &tenant_id,
            &branch_id,
            &client_id,
            payload.client_membership_id.as_deref(),
        )
        .await?,
    )))
}

async fn public_status(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<crate::repositories::membership_advanced_repository::PublicMembershipStatusRecord> {
    Ok(Json(ApiResponse::ok(
        membership_service::public_status(&state.db, &token).await?,
    )))
}

async fn proration_preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlanChangeRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::proration_preview(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &payload.target_membership_id,
        )
        .await?,
    )))
}

async fn membership_360(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let membership = membership_service::active_memberships(&state.db, &tenant_id, &branch_id)
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::not_found("membership was not found"))?;
    let client_id = membership.client_id.clone();
    let details =
        membership_service::client_360(&state.db, &tenant_id, &branch_id, &client_id).await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "membership":ActiveMembershipResponse::from(membership),
        "client":{"id":details.client.id,"name":format!("{} {}",details.client.first_name,details.client.last_name).trim(),"phone":details.client.phone,"email":details.client.email,"walletBalancePaise":details.client.wallet_balance_paise},
        "wallet":details.wallet,"ledger":details.ledger
    }))))
}

async fn sale_checkout_intent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<MembershipSaleRequest>,
) -> ApiResult<MembershipCheckoutIntentResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let intent = membership_service::sale_checkout_intent(
        &state.db,
        &tenant_id,
        &branch_id,
        &payload.client_id,
        &payload.plan_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(checkout_intent_response(intent))))
}

async fn renewal_checkout_intent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<MembershipCheckoutIntentResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let intent =
        membership_service::renewal_checkout_intent(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(checkout_intent_response(intent))))
}

async fn list_plan_changes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::PlanChangeRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::plan_changes(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn change_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlanChangeRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (change, intent) = membership_service::change_plan(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.target_membership_id,
        payload.effective_at.as_deref().unwrap_or("now"),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"change":change,"checkout":intent.map(checkout_intent_response)}),
    )))
}

async fn list_family_members(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::FamilyMemberRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::family_members(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn add_family_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<FamilyMemberRequest>,
) -> ApiResult<crate::repositories::membership_lifecycle_repository::FamilyMemberRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::add_family_member(
            &state.db,
            &tenant_id,
            &branch_id,
            &payload.client_membership_id,
            &payload.member_client_id,
            payload.relationship.as_deref().unwrap_or(""),
        )
        .await?,
    )))
}

async fn remove_family_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !membership_service::remove_family_member(&state.db, &tenant_id, &branch_id, &id).await? {
        return Err(AppError::not_found("family member was not found"));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"removed":true,"id":id}),
    )))
}

async fn list_self_service_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::SelfServiceRequestRecord>>
{
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::self_service_requests(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn create_self_service_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SelfServiceRequest>,
) -> ApiResult<crate::repositories::membership_lifecycle_repository::SelfServiceRequestRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::create_self_service_request(
            &state.db,
            &tenant_id,
            &branch_id,
            &payload.client_membership_id,
            &payload.request_type,
            payload.target_membership_id.as_deref(),
            payload.reason.as_deref().unwrap_or(""),
        )
        .await?,
    )))
}

async fn resolve_self_service_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ResolveSelfServiceRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !membership_service::resolve_self_service_request(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.status,
        payload.note.as_deref().unwrap_or(""),
    )
    .await?
    {
        return Err(AppError::not_found(
            "pending self-service request was not found",
        ));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"id":id,"status":payload.status}),
    )))
}

async fn list_auto_renew_attempts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::membership_lifecycle_repository::AutoRenewAttemptRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        membership_service::auto_renew_attempts(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn update_auto_renew_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AutoRenewStatusRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !membership_service::set_auto_renew_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.status,
    )
    .await?
    {
        return Err(AppError::not_found("active membership was not found"));
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"id":id,"status":payload.status}),
    )))
}

async fn retry_auto_renew(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (attempt, intent) =
        membership_service::retry_auto_renew(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"attempt":attempt,"checkout":checkout_intent_response(intent)}),
    )))
}

fn checkout_intent_response(
    intent: membership_service::MembershipCheckoutIntent,
) -> MembershipCheckoutIntentResponse {
    MembershipCheckoutIntentResponse {
        client_id: intent.client_id.clone(),
        plan_id: intent.plan_id.clone(),
        plan_name: intent.plan_name.clone(),
        price_paise: intent.price_paise,
        source: intent.source,
        reference_id: intent.reference_id.clone(),
        pos_sale: serde_json::json!({ "clientId": intent.client_id, "source": intent.source, "referenceId": intent.reference_id, "lines": [{ "lineType": "membership", "itemId": intent.plan_id, "itemName": intent.plan_name, "quantity": 1, "unitPricePaise": intent.price_paise }] }),
    }
}

fn actor(headers: &HeaderMap) -> String {
    headers
        .get("x-user-id")
        .or_else(|| headers.get("x-user-role"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("system")
        .to_string()
}

impl From<PlanRequest> for MembershipPlanInput {
    fn from(value: PlanRequest) -> Self {
        Self {
            name: value.name,
            code: value.code,
            plan_type: value.plan_type,
            price: value.price,
            price_paise: value.price_paise,
            points_required: value.points_required,
            discount_percent: value.discount_percent,
            validity_days: value.validity_days,
            notes: value.notes,
            service_ids: value.service_ids,
            benefit_rules: value.benefit_rules,
            active: value.active,
        }
    }
}

impl From<crate::repositories::membership_repository::MembershipRecord> for PlanResponse {
    fn from(value: crate::repositories::membership_repository::MembershipRecord) -> Self {
        Self {
            id: value.id,
            name: value.name,
            code: value.code,
            plan_type: value.plan_type,
            price: value.price_paise / 100,
            price_paise: value.price_paise,
            points_required: value.points_required,
            discount_percent: value.discount_percent,
            validity_days: value.validity_days,
            notes: value.notes,
            service_ids: serde_json::from_str(&value.service_ids_json)
                .unwrap_or(Value::Array(vec![])),
            benefit_rules: serde_json::from_str(&value.benefit_rules_json)
                .unwrap_or(Value::Object(Default::default())),
            active: value.active,
        }
    }
}

impl From<crate::repositories::membership_lifecycle_repository::ActiveMembershipRecord>
    for ActiveMembershipResponse
{
    fn from(
        value: crate::repositories::membership_lifecycle_repository::ActiveMembershipRecord,
    ) -> Self {
        let status = membership_status(value.active, value.expires_at);
        Self {
            id: value.id,
            client_id: value.client_id,
            client_name: value.client_name,
            membership_id: value.membership_id,
            membership_name: value.membership_name,
            price_paise: value.price_paise,
            discount_percent: value.discount_percent,
            source_sale_id: value.source_sale_id,
            assigned_at: value.assigned_at,
            expires_at: value.expires_at,
            active: value.active,
            cancelled_at: value.cancelled_at,
            cancel_reason: value.cancel_reason,
            remaining_credits: value.remaining_credits,
            status,
            auto_renew_enabled: value.auto_renew_enabled,
            auto_renew_status: value.auto_renew_status,
            pending_membership_id: value.pending_membership_id,
        }
    }
}

fn membership_status(
    active: bool,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) -> &'static str {
    if !active {
        "cancelled"
    } else if expires_at.is_some_and(|date| date < chrono::Utc::now()) {
        "expired"
    } else {
        "active"
    }
}

fn eligibility_active(expires_at: Option<chrono::DateTime<chrono::Utc>>) -> bool {
    expires_at.map_or(true, |date| date >= chrono::Utc::now())
}

#[cfg(test)]
mod tests {
    use super::{checkout_intent_response, eligibility_active, membership_status};
    use crate::services::membership_service::MembershipCheckoutIntent;
    use chrono::{Duration, Utc};

    #[test]
    fn lifecycle_status_prioritizes_cancellation_and_expiry() {
        assert_eq!(membership_status(false, None), "cancelled");
        assert_eq!(
            membership_status(true, Some(Utc::now() - Duration::days(1))),
            "expired"
        );
        assert_eq!(
            membership_status(true, Some(Utc::now() + Duration::days(1))),
            "active"
        );
    }

    #[test]
    fn eligibility_excludes_expired_memberships() {
        assert!(eligibility_active(None));
        assert!(eligibility_active(Some(Utc::now() + Duration::days(1))));
        assert!(!eligibility_active(Some(Utc::now() - Duration::days(1))));
    }

    #[test]
    fn checkout_intent_uses_the_existing_pos_membership_line() {
        let response = checkout_intent_response(MembershipCheckoutIntent {
            client_id: "client-id".to_string(),
            plan_id: "plan-id".to_string(),
            plan_name: "Plan".to_string(),
            price_paise: 50000,
            source: "membership",
            reference_id: String::new(),
        });
        assert_eq!(response.pos_sale["lines"][0]["lineType"], "membership");
        assert_eq!(response.pos_sale["lines"][0]["unitPricePaise"], 50000);
    }
}
