use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult},
    repositories::birthday_anniversary_repository::{
        BirthdayAnniversaryAuditRecord, ReminderRecord, VoucherRecord,
    },
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims,
        birthday_anniversary_service::{
            self as service, ApproveInput, CampaignSendInput, DraftBatchInput, SettingsUpdate,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/birthday-anniversary/overview", get(overview))
        .route("/birthday-anniversary/morning-brief", get(morning_brief))
        .route("/birthday-anniversary/home-widget", get(home_widget))
        .route(
            "/birthday-anniversary/settings",
            get(get_settings).patch(update_settings),
        )
        .route("/birthday-anniversary/reminders", get(list_reminders))
        .route("/birthday-anniversary/drafts", post(generate_drafts))
        .route(
            "/birthday-anniversary/reminders/:id/approve",
            post(approve_reminder),
        )
        .route(
            "/birthday-anniversary/reminders/:id/send",
            post(queue_reminder),
        )
        .route(
            "/birthday-anniversary/reminders/:id/cancel",
            post(cancel_reminder),
        )
        .route("/birthday-anniversary/auto-send", post(run_auto_send))
        .route("/birthday-anniversary/vouchers", get(list_vouchers))
        .route(
            "/birthday-anniversary/vouchers/:id/redeem",
            post(redeem_voucher),
        )
        .route("/birthday-anniversary/audit-logs", get(list_audit_logs))
        .route("/birthday-campaign/summary", get(campaign_summary))
        .route("/birthday-campaign/prepare-month", post(prepare_month))
        .route("/birthday-campaign/send", post(send_campaign))
        .route("/birthday-campaign/send-bulk", post(send_campaign_bulk))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DateQuery {
    date: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsRequest {
    workflow_mode: Option<String>,
    popup_enabled: Option<bool>,
    approval_required: Option<bool>,
    auto_send_enabled: Option<bool>,
    default_send_time: Option<String>,
    timezone: Option<String>,
    days_ahead: Option<i16>,
    channels: Option<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderListQuery {
    client_id: Option<String>,
    status: Option<String>,
    event_type: Option<String>,
    from_date: Option<NaiveDate>,
    to_date: Option<NaiveDate>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftRequest {
    date: Option<NaiveDate>,
    filters: Option<Vec<String>>,
    client_id: Option<String>,
    event_type: Option<String>,
    channels: Option<Vec<String>>,
    message_options: Option<Value>,
    selected_message: Option<String>,
    coupon_id: Option<String>,
    scheduled_send_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApproveRequest {
    selected_message: Option<String>,
    coupon_id: Option<String>,
    scheduled_send_at: Option<DateTime<Utc>>,
    expected_version: Option<i32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelRequest {
    reason: String,
    expected_version: Option<i32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoSendRequest {
    limit: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoucherListQuery {
    client_id: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RedeemRequest {
    sale_id: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditListQuery {
    client_id: Option<String>,
    reminder_id: Option<String>,
    action: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignSummaryQuery {
    date: Option<NaiveDate>,
    days_ahead: Option<i16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignSendRequest {
    client_id: String,
    message: String,
    channels: Option<Vec<String>>,
    coupon_id: Option<String>,
    scheduled_send_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MonthPrepareRequest {
    date: Option<NaiveDate>,
    channels: Option<Vec<String>>,
    coupon_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignBulkRequest {
    mode: Option<String>,
    days_ahead: Option<i16>,
    limit: Option<i64>,
    message: String,
    channels: Option<Vec<String>>,
    coupon_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ItemList<T> {
    items: Vec<T>,
}

async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DateQuery>,
) -> ApiResult<service::Overview> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::overview(&state.db, &tenant_id, &branch_id, query.date).await?,
    )))
}

async fn morning_brief(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DateQuery>,
) -> ApiResult<service::MorningBrief> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::morning_brief(&state.db, &tenant_id, &branch_id, query.date).await?,
    )))
}

async fn home_widget(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DateQuery>,
) -> ApiResult<service::HomeWidget> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::home_widget(&state.db, &tenant_id, &branch_id, query.date).await?,
    )))
}

async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<service::SettingsView> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::settings(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn update_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SettingsRequest>,
) -> ApiResult<service::SettingsView> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::update_settings(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            SettingsUpdate {
                workflow_mode: payload.workflow_mode,
                popup_enabled: payload.popup_enabled,
                approval_required: payload.approval_required,
                auto_send_enabled: payload.auto_send_enabled,
                default_send_time: payload.default_send_time,
                timezone: payload.timezone,
                days_ahead: payload.days_ahead,
                channels: payload.channels,
            },
        )
        .await?,
    )))
}

async fn list_reminders(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReminderListQuery>,
) -> ApiResult<ItemList<ReminderRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let items = service::reminders(
        &state.db,
        &tenant_id,
        &branch_id,
        query.client_id.as_deref(),
        query.status.as_deref(),
        query.event_type.as_deref(),
        query.from_date,
        query.to_date,
        query.limit.unwrap_or(200),
        query.offset.unwrap_or(0),
    )
    .await?;
    Ok(Json(ApiResponse::ok(ItemList { items })))
}

async fn generate_drafts(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<DraftRequest>,
) -> ApiResult<service::DraftBatchResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::generate_drafts(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            DraftBatchInput {
                date: payload.date,
                filters: payload.filters.unwrap_or_default(),
                client_id: payload.client_id,
                event_type: payload.event_type,
                channels: payload.channels,
                message_options_json: payload.message_options.unwrap_or_else(|| json!([])),
                selected_message: payload.selected_message.unwrap_or_default(),
                coupon_id: payload.coupon_id,
                scheduled_send_at: payload.scheduled_send_at,
            },
        )
        .await?,
    )))
}

async fn approve_reminder(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ApproveRequest>,
) -> ApiResult<ReminderRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::approve_reminder(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &claims.sub,
            ApproveInput {
                selected_message: payload.selected_message,
                coupon_id: payload.coupon_id,
                scheduled_send_at: payload.scheduled_send_at,
                expected_version: payload.expected_version,
            },
        )
        .await?,
    )))
}

async fn queue_reminder(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SendRequest>,
) -> ApiResult<service::QueueResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::queue_reminder(
            &state,
            &tenant_id,
            &branch_id,
            &id,
            &claims.sub,
            payload.message.as_deref(),
        )
        .await?,
    )))
}

async fn cancel_reminder(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CancelRequest>,
) -> ApiResult<ReminderRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::cancel_reminder(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &payload.reason,
            &claims.sub,
            payload.expected_version,
        )
        .await?,
    )))
}

async fn run_auto_send(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<AutoSendRequest>,
) -> ApiResult<service::AutoSendResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::run_auto_send(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload.limit.unwrap_or(250),
        )
        .await?,
    )))
}

async fn list_vouchers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<VoucherListQuery>,
) -> ApiResult<ItemList<VoucherRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let items = service::vouchers(
        &state.db,
        &tenant_id,
        &branch_id,
        query.client_id.as_deref(),
        query.status.as_deref(),
        query.limit.unwrap_or(200),
        query.offset.unwrap_or(0),
        true,
    )
    .await?;
    Ok(Json(ApiResponse::ok(ItemList { items })))
}

async fn redeem_voucher(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<RedeemRequest>,
) -> ApiResult<VoucherRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::redeem_voucher(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &payload.sale_id,
            &claims.sub,
        )
        .await?,
    )))
}

async fn list_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditListQuery>,
) -> ApiResult<ItemList<BirthdayAnniversaryAuditRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let items = service::audit_logs(
        &state.db,
        &tenant_id,
        &branch_id,
        query.client_id.as_deref(),
        query.reminder_id.as_deref(),
        query.action.as_deref(),
        query.limit.unwrap_or(100),
        query.offset.unwrap_or(0),
    )
    .await?;
    Ok(Json(ApiResponse::ok(ItemList { items })))
}

async fn campaign_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CampaignSummaryQuery>,
) -> ApiResult<service::CampaignSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::campaign_summary(
            &state.db,
            &tenant_id,
            &branch_id,
            query.date,
            query.days_ahead,
        )
        .await?,
    )))
}

async fn send_campaign(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CampaignSendRequest>,
) -> ApiResult<service::QueueResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::send_campaign(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            CampaignSendInput {
                client_id: payload.client_id,
                message: payload.message,
                channels: payload.channels,
                coupon_id: payload.coupon_id,
                scheduled_send_at: payload.scheduled_send_at,
            },
        )
        .await?,
    )))
}

async fn prepare_month(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MonthPrepareRequest>,
) -> ApiResult<service::MonthPrepareResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::prepare_month_campaign(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            service::MonthPrepareInput {
                date: payload.date,
                channels: payload.channels,
                coupon_id: payload.coupon_id,
            },
        )
        .await?,
    )))
}

async fn send_campaign_bulk(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CampaignBulkRequest>,
) -> ApiResult<service::CampaignBulkResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::send_campaign_bulk(
            &state,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload.mode.as_deref().unwrap_or("all"),
            payload.days_ahead,
            payload.limit.unwrap_or(100),
            &payload.message,
            payload.channels,
            payload.coupon_id,
        )
        .await?,
    )))
}
