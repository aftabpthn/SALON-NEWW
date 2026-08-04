use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post, put},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{cash_drawer_repository, pos_enterprise_repository},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, invoice_delivery, pos_enterprise_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/terminals", get(list_terminals).post(create_terminal))
        .route("/pos/terminals/:id/status", patch(set_terminal_status))
        .route("/pos/terminals/:id/heartbeat", post(terminal_heartbeat))
        .route(
            "/pos/terminals/:id/sessions/start",
            post(start_terminal_session),
        )
        .route(
            "/pos/terminals/:id/sessions/end",
            post(end_terminal_session),
        )
        .route("/pos/terminals/:id/sales", get(terminal_sales))
        .route(
            "/pos/print-devices",
            get(list_print_devices).post(create_print_device),
        )
        .route(
            "/pos/print-jobs",
            get(list_print_jobs).post(create_print_job),
        )
        .route("/pos/print-jobs/next", get(claim_next_print_job))
        .route("/pos/print-jobs/:id/result", post(complete_print_job))
        .route("/pos/print-jobs/:id/retry", post(retry_print_job))
        .route("/pos/day-close/:date", get(day_close_status))
        .route("/pos/day-close/:date/lock", post(lock_day))
        .route("/pos/day-close/:date/reopen", post(reopen_day))
        // GET only, and deliberately so: an X-report has nothing to POST
        // because it produces no document and changes no state.
        .route("/pos/x-reports/:date", get(get_x_report))
        .route(
            "/pos/z-reports/:date",
            get(get_z_report).post(generate_z_report),
        )
        .route("/pos/z-reports/:date/export", get(export_z_report))
        .route(
            "/pos/z-reports/:date/post-accounting",
            post(post_eod_accounting),
        )
        .route("/pos/risk-cases", get(list_risk_cases))
        .route("/pos/risk-scan/:date", post(scan_risks))
        .route("/pos/risk-cases/:id/resolve", post(resolve_risk_case))
        .route("/pos/reliability", get(reliability_snapshot))
        .route("/pos/float-suggestion", get(float_suggestion))
        .route("/pos/payment-providers", get(payment_providers))
        .route(
            "/pos/cash-drawer/:id/approval-link",
            post(create_approval_link),
        )
        .route(
            "/invoice-notifications/profile",
            get(get_notification_profile).put(save_notification_profile),
        )
        .route(
            "/invoice-notifications/profile/verify-provider",
            post(verify_notification_provider),
        )
        .route(
            "/pos/corporate-accounts",
            get(list_corporate_accounts).post(create_corporate_account),
        )
        .route("/pos/invoices/:id/corporate", put(assign_corporate_sale))
}

pub fn public_router() -> Router<AppState> {
    Router::new().route(
        "/public/cash-drawer-approval/:token",
        get(public_approval_details).post(public_approval_review),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalRequest {
    #[serde(default, rename = "terminalCode")]
    _terminal_code: String,
    terminal_name: String,
    device_fingerprint: Option<String>,
    assigned_counter: Option<String>,
}
#[derive(Deserialize)]
struct StatusRequest {
    status: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatRequest {
    device_fingerprint: Option<String>,
}
#[derive(Deserialize)]
struct DateRangeQuery {
    from: String,
    to: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintDeviceRequest {
    terminal_id: String,
    device_name: String,
    device_type: String,
    connection_type: String,
    config: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintJobRequest {
    terminal_id: String,
    device_id: Option<String>,
    sale_id: String,
    format: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalQuery {
    terminal_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintResultRequest {
    status: String,
    error: Option<String>,
}
#[derive(Deserialize)]
struct ReasonRequest {
    reason: String,
}
#[derive(Deserialize)]
struct ExportQuery {
    format: Option<String>,
}
#[derive(Deserialize)]
struct StatusQuery {
    status: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolutionRequest {
    status: String,
    resolution_note: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalLinkRequest {
    recipient: Option<String>,
    channel: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicReviewRequest {
    decision: String,
    reviewer_name: String,
    note: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationProfileRequest {
    sender_email: Option<String>,
    sender_phone: Option<String>,
    logo_url: Option<String>,
    signature_url: Option<String>,
    owner_email: Option<String>,
    owner_phone: Option<String>,
    reporting_email: Option<String>,
    client_email_enabled: Option<bool>,
    client_whatsapp_enabled: Option<bool>,
    owner_email_enabled: Option<bool>,
    owner_whatsapp_enabled: Option<bool>,
    daily_report_enabled: Option<bool>,
    daily_report_time: Option<String>,
    daily_report_timezone: Option<String>,
}
#[derive(Deserialize)]
struct VerifyProviderRequest {
    kind: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorporateAccountRequest {
    #[serde(default, rename = "accountCode")]
    _account_code: String,
    account_name: String,
    billing_email: Option<String>,
    phone: Option<String>,
    gstin: Option<String>,
    credit_limit_paise: i64,
    payment_terms_days: i32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorporateSaleRequest {
    account_id: String,
    reference: String,
}

async fn list_terminals(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<pos_enterprise_repository::PosTerminal>> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let rows = pos_enterprise_repository::list_terminals(&state.db, &tenant, &branch)
        .await
        .map_err(|_| AppError::internal("failed to load POS terminals"))?;
    Ok(Json(ApiResponse::ok(rows)))
}
async fn create_terminal(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<TerminalRequest>,
) -> ApiResult<pos_enterprise_repository::PosTerminal> {
    require_manager(&claims)?;
    if p.terminal_name.trim().is_empty() {
        return Err(AppError::validation("terminalName is required"));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::create_terminal(
        &state.db,
        &tenant,
        &branch,
        &claims.sub,
        p.terminal_name.trim(),
        p.device_fingerprint.as_deref().unwrap_or_default(),
        p.assigned_counter.as_deref().unwrap_or_default(),
    )
    .await
    .map_err(|error| db_conflict(error, "terminal code already exists"))?;
    state.publish_pos_event(&tenant, &branch, "terminal", &row.id, "terminal.created");
    Ok(Json(ApiResponse::ok(row)))
}
async fn set_terminal_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<StatusRequest>,
) -> ApiResult<pos_enterprise_repository::PosTerminal> {
    require_manager(&claims)?;
    let status = normalized(&p.status, &["active", "suspended"])?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let row =
        pos_enterprise_repository::set_terminal_status(&state.db, &tenant, &branch, &id, status)
            .await
            .map_err(|_| AppError::internal("failed to update terminal"))?
            .ok_or_else(|| AppError::not_found("terminal was not found"))?;
    state.publish_pos_event(&tenant, &branch, "terminal", &id, "terminal.status_updated");
    Ok(Json(ApiResponse::ok(row)))
}
async fn terminal_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<HeartbeatRequest>,
) -> ApiResult<pos_enterprise_repository::PosTerminal> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::heartbeat(
        &state.db,
        &tenant,
        &branch,
        &id,
        p.device_fingerprint.as_deref().unwrap_or_default(),
    )
    .await
    .map_err(|_| AppError::internal("failed to update terminal heartbeat"))?
    .ok_or_else(|| AppError::not_found("active terminal was not found"))?;
    state.publish_pos_event(&tenant, &branch, "terminal", &id, "terminal.heartbeat");
    Ok(Json(ApiResponse::ok(row)))
}
async fn start_terminal_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let session_id = pos_enterprise_repository::start_terminal_session(
        &state.db,
        &tenant,
        &branch,
        &id,
        &claims.sub,
    )
    .await
    .map_err(|error| db_conflict(error, "terminal session is already active"))?;
    state.publish_pos_event(
        &tenant,
        &branch,
        "terminal",
        &id,
        "terminal.session_started",
    );
    Ok(Json(ApiResponse::ok(
        json!({"sessionId":session_id,"terminalId":id,"status":"active"}),
    )))
}
async fn end_terminal_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let session_id = pos_enterprise_repository::end_terminal_session(
        &state.db,
        &tenant,
        &branch,
        &id,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to end terminal session"))?
    .ok_or_else(|| AppError::not_found("active terminal session was not found"))?;
    state.publish_pos_event(&tenant, &branch, "terminal", &id, "terminal.session_ended");
    Ok(Json(ApiResponse::ok(
        json!({"sessionId":session_id,"terminalId":id,"status":"closed"}),
    )))
}
async fn terminal_sales(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<DateRangeQuery>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let from = parse_date(&q.from)?;
    let to = parse_date(&q.to)?;
    if from > to {
        return Err(AppError::validation("from must be on or before to"));
    }
    let row = pos_enterprise_repository::terminal_sales(&state.db, &tenant, &branch, &id, from, to)
        .await
        .map_err(|_| AppError::internal("failed to load terminal sales"))?;
    Ok(Json(ApiResponse::ok(
        json!({"terminalId":id,"from":from,"to":to,"invoiceCount":row.0,"totalPaise":row.1,"paidPaise":row.2}),
    )))
}

async fn list_print_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<pos_enterprise_repository::PrintDevice>> {
    let (t, b) = tenant_branch(&headers)?;
    let rows = pos_enterprise_repository::list_print_devices(&state.db, &t, &b)
        .await
        .map_err(|_| AppError::internal("failed to load print devices"))?;
    Ok(Json(ApiResponse::ok(rows)))
}
async fn create_print_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<PrintDeviceRequest>,
) -> ApiResult<pos_enterprise_repository::PrintDevice> {
    require_manager(&claims)?;
    let kind = normalized(&p.device_type, &["thermal", "a4"])?;
    let connection = normalized(&p.connection_type, &["browser", "network", "usb"])?;
    if p.device_name.trim().is_empty() {
        return Err(AppError::validation("deviceName is required"));
    }
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::create_print_device(
        &state.db,
        &t,
        &b,
        &p.terminal_id,
        p.device_name.trim(),
        kind,
        connection,
        p.config.unwrap_or_else(|| json!({})),
    )
    .await
    .map_err(|_| AppError::validation("active terminal was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn list_print_jobs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<pos_enterprise_repository::PrintJob>> {
    let (t, b) = tenant_branch(&headers)?;
    let rows = pos_enterprise_repository::list_print_jobs(&state.db, &t, &b)
        .await
        .map_err(|_| AppError::internal("failed to load print jobs"))?;
    Ok(Json(ApiResponse::ok(rows)))
}
async fn create_print_job(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<PrintJobRequest>,
) -> ApiResult<pos_enterprise_repository::PrintJob> {
    let format = normalized(&p.format, &["thermal", "a4"])?;
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::create_print_job(
        &state.db,
        &t,
        &b,
        &claims.sub,
        &p.terminal_id,
        p.device_id.as_deref(),
        &p.sale_id,
        format,
    )
    .await
    .map_err(|_| AppError::validation("active terminal or invoice was not found"))?;
    state.publish_pos_event(&t, &b, "print_job", &row.id, "print.queued");
    Ok(Json(ApiResponse::ok(row)))
}
async fn claim_next_print_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<TerminalQuery>,
) -> ApiResult<Option<pos_enterprise_repository::PrintJob>> {
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::claim_next_print_job(&state.db, &t, &b, &q.terminal_id)
        .await
        .map_err(|_| AppError::internal("failed to claim print job"))?;
    if let Some(job) = &row {
        state.publish_pos_event(&t, &b, "print_job", &job.id, "print.processing");
    }
    Ok(Json(ApiResponse::ok(row)))
}
async fn complete_print_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<PrintResultRequest>,
) -> ApiResult<pos_enterprise_repository::PrintJob> {
    let status = normalized(&p.status, &["printed", "failed"])?;
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::complete_print_job(
        &state.db,
        &t,
        &b,
        &id,
        status,
        p.error.as_deref().unwrap_or_default(),
    )
    .await
    .map_err(|_| AppError::internal("failed to complete print job"))?
    .ok_or_else(|| AppError::not_found("processing print job was not found"))?;
    let event = match row.status.as_str() {
        "queued" => "print.retry_scheduled",
        "failed" => "print.dead_lettered",
        _ => "print.completed",
    };
    state.publish_pos_event(&t, &b, "print_job", &id, event);
    Ok(Json(ApiResponse::ok(row)))
}
async fn retry_print_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<pos_enterprise_repository::PrintJob> {
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::retry_print_job(&state.db, &t, &b, &id)
        .await
        .map_err(|_| AppError::internal("failed to retry print job"))?
        .ok_or_else(|| AppError::not_found("failed print job was not found"))?;
    state.publish_pos_event(&t, &b, "print_job", &id, "print.retried");
    Ok(Json(ApiResponse::ok(row)))
}

async fn day_close_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<Value> {
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let lock = pos_enterprise_repository::get_day_lock(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load day lock"))?;
    let report = pos_enterprise_repository::latest_z_report(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load Z-report"))?;
    let reconciliation =
        pos_enterprise_service::eod_reconciliation(&state.db, &t, &b, date).await?;
    let close_snapshot = cash_drawer_repository::latest_close_snapshot(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load cash close snapshot"))?;
    let events = pos_enterprise_repository::list_day_lock_events(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load day close history"))?;
    let holiday = pos_enterprise_repository::branch_holiday(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load branch holiday"))?;
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"dayLock":lock,"zReport":report,"reconciliation":reconciliation,"closeSnapshot":close_snapshot,"events":events,"holiday":holiday}),
    )))
}
async fn lock_day(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(date): Path<String>,
    Json(p): Json<ReasonRequest>,
) -> ApiResult<pos_enterprise_repository::DayLock> {
    require_manager(&claims)?;
    if p.reason.trim().is_empty() {
        return Err(AppError::validation("reason is required"));
    }
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let reconciliation =
        pos_enterprise_service::eod_reconciliation(&state.db, &t, &b, date).await?;
    if !reconciliation
        .get("ready")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(AppError::conflict(
            "invoice, payment, register, and accounting totals must reconcile before locking the day",
        ));
    }
    let holiday = pos_enterprise_repository::branch_holiday(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load branch holiday"))?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start business day lock"))?;
    cash_drawer_repository::lock_business_date(&mut tx, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to lock business date"))?;
    let pending:i64=sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status IN ('open','pending_approval')").bind(&t).bind(&b).bind(date).fetch_one(&mut *tx).await.map_err(|_|AppError::internal("failed to validate business day"))?;
    if pending > 0 {
        return Err(AppError::conflict(
            "cash drawers must be closed before locking the day",
        ));
    }
    let row = pos_enterprise_repository::day_lock(
        &mut tx,
        &t,
        &b,
        &claims.sub,
        date,
        p.reason.trim(),
        "locked",
    )
    .await
    .map_err(|_| AppError::internal("failed to lock business day"))?;
    pos_enterprise_repository::insert_day_lock_event(
        &mut tx,
        &t,
        &b,
        &claims.sub,
        date,
        "locked",
        p.reason.trim(),
        holiday
            .as_ref()
            .filter(|value| value.get("closed").and_then(Value::as_bool) == Some(true))
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit business day lock"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit business day lock"))?;
    state.publish_pos_event(&t, &b, "day_close", &date.to_string(), "day.locked");
    Ok(Json(ApiResponse::ok(row)))
}
async fn reopen_day(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(date): Path<String>,
    Json(p): Json<ReasonRequest>,
) -> ApiResult<pos_enterprise_repository::DayLock> {
    require_manager(&claims)?;
    if p.reason.trim().is_empty() {
        return Err(AppError::validation("reopen reason is required"));
    }
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let current = pos_enterprise_repository::get_day_lock(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load business day lock"))?;
    if current.as_ref().is_none_or(|row| row.status != "locked") {
        return Err(AppError::conflict(
            "only a locked business day can be reopened",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start business day reopen"))?;
    cash_drawer_repository::lock_business_date(&mut tx, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to lock business date"))?;
    let row = pos_enterprise_repository::day_lock(
        &mut tx,
        &t,
        &b,
        &claims.sub,
        date,
        p.reason.trim(),
        "reopened",
    )
    .await
    .map_err(|_| AppError::internal("failed to reopen business day"))?;
    pos_enterprise_repository::insert_day_lock_event(
        &mut tx,
        &t,
        &b,
        &claims.sub,
        date,
        "reopened",
        p.reason.trim(),
        None,
    )
    .await
    .map_err(|_| AppError::internal("failed to audit business day reopen"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit business day reopen"))?;
    state.publish_pos_event(&t, &b, "day_close", &date.to_string(), "day.reopened");
    Ok(Json(ApiResponse::ok(row)))
}
/// The register as it stands right now, mid-shift.
///
/// Unlike the Z-report this needs no locked day and no closed drawer, and it
/// writes nothing — so a manager can check the till at any hour without ending
/// the trading day to find out.
async fn get_x_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<Value> {
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let report = pos_enterprise_service::x_report(&state.db, &t, &b, date).await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn get_z_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<pos_enterprise_repository::ZReport> {
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::latest_z_report(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load Z-report"))?
        .ok_or_else(|| AppError::not_found("Z-report was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn generate_z_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<pos_enterprise_repository::ZReport> {
    require_manager(&claims)?;
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let row =
        pos_enterprise_service::generate_z_report(&state.db, &t, &b, &claims.sub, date).await?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn export_z_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(date): Path<String>,
    Query(q): Query<ExportQuery>,
) -> ApiResult<Value> {
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::latest_z_report(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load Z-report"))?
        .ok_or_else(|| AppError::not_found("Z-report was not found"))?;
    let format = q
        .format
        .unwrap_or_else(|| "json".into())
        .to_ascii_lowercase();
    let accounting_lines = if matches!(format.as_str(), "tally" | "busy" | "quickbooks-desktop") {
        pos_enterprise_repository::daily_accounting_export_lines(&state.db, &t, &b, date)
            .await
            .map_err(|_| AppError::internal("failed to load accounting export lines"))?
    } else {
        Vec::new()
    };
    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&row.report_json)
            .map_err(|_| AppError::internal("failed to export Z-report"))?,
        "csv" => z_report_csv(&row.report_json),
        "tally" => tally_xml(&accounting_lines)?,
        "busy" => busy_csv(&accounting_lines)?,
        "quickbooks-desktop" => quickbooks_iif(&accounting_lines)?,
        _ => {
            return Err(AppError::validation(
                "format must be json, csv, tally, busy, or quickbooks-desktop",
            ))
        }
    };
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"version":row.version,"format":format,"sha256":row.sha256,"journalLineCount":accounting_lines.len(),"content":content}),
    )))
}
async fn post_eod_accounting(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let z = pos_enterprise_repository::latest_z_report(&state.db, &t, &b, date)
        .await
        .map_err(|_| AppError::internal("failed to load Z-report"))?
        .ok_or_else(|| AppError::conflict("generate Z-report before posting EOD accounting"))?;
    let gross = z
        .report_json
        .pointer("/sales/totalPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let tax = z
        .report_json
        .pointer("/sales/taxPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let payments = z
        .report_json
        .get("payments")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|v| v.get("amountPaise").and_then(Value::as_i64))
                .sum()
        })
        .unwrap_or(0);
    let journal_count:i64=sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND entry_date=$3").bind(&t).bind(&b).bind(date).fetch_one(&state.db).await.unwrap_or(0);
    let inserted:Option<String>=sqlx::query_scalar("INSERT INTO pos_eod_accounting_batches (tenant_id,branch_id,business_date,z_report_id,z_report_version,journal_entry_count,gross_sales_paise,tax_paise,payment_total_paise,posted_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id,branch_id,business_date,z_report_version) DO NOTHING RETURNING id").bind(&t).bind(&b).bind(date).bind(&z.id).bind(z.version).bind(journal_count).bind(gross).bind(tax).bind(payments).bind(&claims.sub).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to post EOD accounting batch"))?;
    let id = if let Some(id) = inserted {
        id
    } else {
        sqlx::query_scalar("SELECT id FROM pos_eod_accounting_batches WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND z_report_version=$4").bind(&t).bind(&b).bind(date).bind(z.version).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to load EOD accounting batch"))?
    };
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"businessDate":date,"zReportVersion":z.version,"journalEntryCount":journal_count,"grossSalesPaise":gross,"taxPaise":tax,"paymentTotalPaise":payments,"status":"posted"}),
    )))
}

async fn list_risk_cases(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(q): Query<StatusQuery>,
) -> ApiResult<Vec<pos_enterprise_repository::RiskCase>> {
    require_manager(&claims)?;
    let status = q.status.unwrap_or_default();
    if !status.is_empty() {
        normalized(&status, &["open", "resolved", "dismissed"])?;
    }
    let (t, b) = tenant_branch(&headers)?;
    let rows = pos_enterprise_repository::list_risk_cases(&state.db, &t, &b, &status)
        .await
        .map_err(|_| AppError::internal("failed to load risk cases"))?;
    Ok(Json(ApiResponse::ok(rows)))
}
async fn scan_risks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(date): Path<String>,
) -> ApiResult<Vec<pos_enterprise_repository::RiskCase>> {
    require_manager(&claims)?;
    let date = parse_date(&date)?;
    let (t, b) = tenant_branch(&headers)?;
    let rows = pos_enterprise_service::scan_risks(&state.db, &t, &b, date).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn reliability_snapshot(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    let value = pos_enterprise_service::reliability_snapshot(&state.db, &tenant, &branch).await?;
    Ok(Json(ApiResponse::ok(value)))
}

async fn resolve_risk_case(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<ResolutionRequest>,
) -> ApiResult<pos_enterprise_repository::RiskCase> {
    require_manager(&claims)?;
    let status = normalized(&p.status, &["resolved", "dismissed"])?;
    if p.resolution_note.trim().is_empty() {
        return Err(AppError::validation("resolutionNote is required"));
    }
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::resolve_risk_case(
        &state.db,
        &t,
        &b,
        &claims.sub,
        &id,
        status,
        p.resolution_note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve risk case"))?
    .ok_or_else(|| AppError::not_found("open risk case was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn float_suggestion(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    let value = pos_enterprise_service::float_suggestion(&state.db, &t, &b).await?;
    Ok(Json(ApiResponse::ok(value)))
}

async fn payment_providers(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    let controls = sqlx::query_as::<_, (String, bool)>(
        "SELECT provider,enabled FROM payment_provider_branch_controls WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant)
    .bind(&branch)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment provider controls"))?;
    let rows = crate::config::PAYMENT_PROVIDER_CATALOG
        .iter()
        .map(|entry| {
            let configured = entry.implemented && state.settings.payment_provider_enabled(entry.provider);
            let branch_enabled = controls.iter().find(|row| row.0 == entry.provider).map(|row| row.1).unwrap_or(true);
            json!({
                "provider": entry.provider,
                "displayName": entry.display_name,
                "regions": entry.regions,
                "countries": entry.countries,
                "currencies": entry.currencies,
                "documentationUrl": entry.documentation_url,
                "recommended": entry.recommended,
                "integrationStatus": if entry.implemented { "available" } else { "planned" },
                "configured": configured,
                "enabled": configured && branch_enabled,
                "webhookConfigured": entry.implemented && state.settings.payment_provider_webhook_configured(entry.provider),
                "environment": if entry.implemented { Some(state.settings.payment_provider_environment.as_str()) } else { None },
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(ApiResponse::ok(json!(rows))))
}

async fn create_approval_link(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<ApprovalLinkRequest>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending_approval')").bind(&t).bind(&b).bind(&id).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to validate drawer approval"))?;
    if !pending {
        return Err(AppError::conflict("drawer is not pending approval"));
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = hash_token(&token);
    let token_id:String=sqlx::query_scalar("INSERT INTO cash_drawer_approval_tokens (tenant_id,branch_id,drawer_session_id,token_hash,expires_at,requested_by_user_id) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '2 hours',$5) RETURNING id").bind(&t).bind(&b).bind(&id).bind(&hash).bind(&claims.sub).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to create approval link"))?;
    let path = format!("/cash-drawer-approval/{token}");
    let mut delivery_status = "not_requested".to_string();
    if let (Some(recipient), Some(channel)) = (p.recipient.as_deref(), p.channel.as_deref()) {
        if !recipient.trim().is_empty() {
            let payload = json!({"channel":format!("approval_{}",channel.trim().to_ascii_lowercase()),"recipient":recipient.trim(),"approvalPath":path,"drawerSessionId":id,"expiresInMinutes":120});
            delivery_status = match invoice_delivery::deliver(&state.settings, &payload).await {
                Ok(_) => "sent".into(),
                Err(_) => "provider_unavailable".into(),
            };
        }
    }
    Ok(Json(ApiResponse::ok(
        json!({"id":token_id,"approvalPath":path,"expiresAt":Utc::now()+chrono::Duration::hours(2),"deliveryStatus":delivery_status}),
    )))
}
async fn public_approval_details(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> ApiResult<Value> {
    let hash = hash_token(&token);
    let row:Option<(String,String,String,NaiveDate,i64,i64,i64,String,chrono::DateTime<Utc>)>=sqlx::query_as("SELECT tok.id,tok.status,d.id,d.business_date,d.expected_cash_paise,COALESCE(d.counted_cash_paise,0),COALESCE(d.variance_paise,0),d.status,tok.expires_at FROM cash_drawer_approval_tokens tok JOIN cash_drawer_sessions d ON d.id=tok.drawer_session_id AND d.tenant_id=tok.tenant_id AND d.branch_id=tok.branch_id WHERE tok.token_hash=$1").bind(hash).fetch_optional(&state.db).await.map_err(|_|AppError::internal("failed to load approval request"))?;
    let row = row.ok_or_else(|| AppError::not_found("approval link was not found"))?;
    if row.8 < Utc::now() {
        return Err(AppError::conflict("approval link has expired"));
    }
    Ok(Json(ApiResponse::ok(
        json!({"id":row.0,"tokenStatus":row.1,"drawerSessionId":row.2,"businessDate":row.3,"expectedCashPaise":row.4,"countedCashPaise":row.5,"variancePaise":row.6,"drawerStatus":row.7,"expiresAt":row.8}),
    )))
}
async fn public_approval_review(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(p): Json<PublicReviewRequest>,
) -> ApiResult<Value> {
    let decision = normalized(&p.decision, &["approved", "rejected"])?;
    if p.reviewer_name.trim().is_empty() || p.note.trim().is_empty() {
        return Err(AppError::validation("reviewerName and note are required"));
    }
    let hash = hash_token(&token);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start approval review"))?;
    let row:Option<(String,String,String)>=sqlx::query_as("SELECT id,tenant_id,drawer_session_id FROM cash_drawer_approval_tokens WHERE token_hash=$1 AND status='pending' AND expires_at>NOW() FOR UPDATE").bind(hash).fetch_optional(&mut *tx).await.map_err(|_|AppError::internal("failed to validate approval link"))?;
    let (token_id, tenant, drawer_id) =
        row.ok_or_else(|| AppError::conflict("approval link is expired or already used"))?;
    if decision == "approved" {
        let changed=sqlx::query("UPDATE cash_drawer_sessions SET status='closed',approved_by_user_id=$2,approved_at=NOW(),approval_note=$3,closed_by_user_id=$2,closed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$4 AND status='pending_approval'").bind(&tenant).bind(format!("public:{token_id}")).bind(p.note.trim()).bind(&drawer_id).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to approve drawer"))?.rows_affected();
        if changed != 1 {
            return Err(AppError::conflict("drawer is no longer pending approval"));
        }
    }
    sqlx::query("UPDATE cash_drawer_approval_tokens SET status=$2,reviewed_by_name=$3,review_note=$4,reviewed_at=NOW() WHERE id=$1").bind(&token_id).bind(decision).bind(p.reviewer_name.trim()).bind(p.note.trim()).execute(&mut *tx).await.map_err(|_|AppError::internal("failed to save approval decision"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to finish approval review"))?;
    Ok(Json(ApiResponse::ok(
        json!({"id":token_id,"drawerSessionId":drawer_id,"status":decision}),
    )))
}

async fn get_notification_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Option<pos_enterprise_repository::NotificationProfile>> {
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::get_notification_profile(&state.db, &t, &b)
        .await
        .map_err(|_| AppError::internal("failed to load notification profile"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn save_notification_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<NotificationProfileRequest>,
) -> ApiResult<pos_enterprise_repository::NotificationProfile> {
    require_manager(&claims)?;
    let email = p.sender_email.as_deref().unwrap_or_default().trim();
    let phone = p.sender_phone.as_deref().unwrap_or_default().trim();
    let logo = p.logo_url.as_deref().unwrap_or_default().trim();
    let signature = p.signature_url.as_deref().unwrap_or_default().trim();
    let owner_email = p.owner_email.as_deref().unwrap_or_default().trim();
    let owner_phone = p.owner_phone.as_deref().unwrap_or_default().trim();
    let reporting_email = p.reporting_email.as_deref().unwrap_or_default().trim();
    for (label, value) in [
        ("senderEmail", email),
        ("ownerEmail", owner_email),
        ("reportingEmail", reporting_email),
    ] {
        if !value.is_empty() && (!value.contains('@') || value.chars().any(char::is_whitespace)) {
            return Err(AppError::validation(format!("{label} is invalid")));
        }
    }
    if !phone.is_empty() && phone.chars().filter(|value| value.is_ascii_digit()).count() < 8 {
        return Err(AppError::validation("senderPhone is invalid"));
    }
    if !owner_phone.is_empty()
        && owner_phone
            .chars()
            .filter(|value| value.is_ascii_digit())
            .count()
            < 8
    {
        return Err(AppError::validation("ownerPhone is invalid"));
    }
    if [logo, signature]
        .into_iter()
        .any(|value| !value.is_empty() && !value.starts_with("https://"))
    {
        return Err(AppError::validation("media URLs must use HTTPS"));
    }
    let (t, b) = tenant_branch(&headers)?;
    let report_time_value = p.daily_report_time.as_deref().unwrap_or("21:00");
    let report_time = chrono::NaiveTime::parse_from_str(report_time_value, "%H:%M")
        .or_else(|_| chrono::NaiveTime::parse_from_str(report_time_value, "%H:%M:%S"))
        .map_err(|_| AppError::validation("dailyReportTime must use HH:mm"))?;
    let timezone = p
        .daily_report_timezone
        .as_deref()
        .unwrap_or("Asia/Kolkata")
        .trim();
    if timezone != "Asia/Kolkata" {
        return Err(AppError::validation(
            "dailyReportTimezone must be Asia/Kolkata",
        ));
    }
    let row = pos_enterprise_repository::save_notification_profile(
        &state.db,
        &t,
        &b,
        &claims.sub,
        email,
        phone,
        logo,
        signature,
        owner_email,
        owner_phone,
        reporting_email,
        p.client_email_enabled.unwrap_or(true),
        p.client_whatsapp_enabled.unwrap_or(true),
        p.owner_email_enabled.unwrap_or(false),
        p.owner_whatsapp_enabled.unwrap_or(false),
        p.daily_report_enabled.unwrap_or(false),
        report_time,
        timezone,
    )
    .await
    .map_err(|_| AppError::internal("failed to save notification profile"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn verify_notification_provider(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<VerifyProviderRequest>,
) -> ApiResult<pos_enterprise_repository::NotificationProfile> {
    require_manager(&claims)?;
    let kind = normalized(&p.kind, &["email", "phone"])?;
    let configured = if kind == "email" {
        state.settings.invoice_delivery_webhook_url.is_some()
    } else {
        state.settings.whatsapp_cloud_enabled()
    };
    if !configured {
        return Err(AppError::service_unavailable(
            "DELIVERY_NOT_CONFIGURED",
            format!("{kind} delivery provider is not configured"),
        ));
    }
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::get_notification_profile(&state.db, &t, &b)
        .await
        .map_err(|_| AppError::internal("failed to load notification profile"))?
        .ok_or_else(|| AppError::not_found("notification profile was not found"))?;
    let contact = if kind == "email" {
        &row.sender_email
    } else {
        &row.sender_phone
    };
    if contact.trim().is_empty() {
        return Err(AppError::validation(format!("sender {kind} is required")));
    }
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_corporate_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<pos_enterprise_repository::CorporateAccount>> {
    let (t, b) = tenant_branch(&headers)?;
    let rows = pos_enterprise_repository::list_corporate_accounts(&state.db, &t, &b)
        .await
        .map_err(|_| AppError::internal("failed to load corporate accounts"))?;
    Ok(Json(ApiResponse::ok(rows)))
}
async fn create_corporate_account(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(p): Json<CorporateAccountRequest>,
) -> ApiResult<pos_enterprise_repository::CorporateAccount> {
    require_manager(&claims)?;
    if p.account_name.trim().is_empty()
        || p.credit_limit_paise < 0
        || !(0..=365).contains(&p.payment_terms_days)
    {
        return Err(AppError::validation(
            "valid accountName, creditLimitPaise, and paymentTermsDays are required",
        ));
    }
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::create_corporate_account(
        &state.db,
        &t,
        &b,
        &claims.sub,
        p.account_name.trim(),
        p.billing_email.as_deref().unwrap_or_default().trim(),
        p.phone.as_deref().unwrap_or_default().trim(),
        p.gstin.as_deref().unwrap_or_default().trim(),
        p.credit_limit_paise,
        p.payment_terms_days,
    )
    .await
    .map_err(|e| db_conflict(e, "corporate account code already exists"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn assign_corporate_sale(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(p): Json<CorporateSaleRequest>,
) -> ApiResult<Value> {
    require_manager(&claims)?;
    if p.reference.trim().is_empty() {
        return Err(AppError::validation("corporate reference is required"));
    }
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::assign_corporate_sale(
        &state.db,
        &t,
        &b,
        &id,
        &p.account_id,
        p.reference.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to assign corporate invoice"))?
    .ok_or_else(|| AppError::conflict("account was not found or credit limit would be exceeded"))?;
    Ok(Json(ApiResponse::ok(
        json!({"saleId":row.0,"accountName":row.1,"creditLimitPaise":row.2,"outstandingPaise":row.3,"reference":p.reference}),
    )))
}

fn require_manager(claims: &AuthClaims) -> Result<(), AppError> {
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(claims.role.trim()))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "owner, admin, or manager access is required",
        ))
    }
}
fn parse_date(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("date must use YYYY-MM-DD"))
}
fn normalized<'a>(value: &'a str, allowed: &[&'a str]) -> Result<&'a str, AppError> {
    let value = value.trim();
    if allowed.iter().any(|item| item.eq_ignore_ascii_case(value)) {
        Ok(allowed
            .iter()
            .copied()
            .find(|item| item.eq_ignore_ascii_case(value))
            .unwrap_or(value))
    } else {
        Err(AppError::validation(format!(
            "value must be one of: {}",
            allowed.join(", ")
        )))
    }
}
fn db_conflict(error: sqlx::Error, message: &str) -> AppError {
    if matches!(error, sqlx::Error::Database(_)) {
        AppError::conflict(message)
    } else {
        AppError::internal("database operation failed")
    }
}
fn hash_token(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
fn z_report_csv(report: &Value) -> String {
    let sales = report.get("sales").cloned().unwrap_or_else(|| json!({}));
    format!("metric,amount_paise\nsubtotal,{}\ndiscount,{}\ntax,{}\ncgst,{}\nsgst,{}\nigst,{}\ntotal,{}\n",sales.get("subtotalPaise").and_then(Value::as_i64).unwrap_or(0),sales.get("discountPaise").and_then(Value::as_i64).unwrap_or(0),sales.get("taxPaise").and_then(Value::as_i64).unwrap_or(0),sales.get("cgstPaise").and_then(Value::as_i64).unwrap_or(0),sales.get("sgstPaise").and_then(Value::as_i64).unwrap_or(0),sales.get("igstPaise").and_then(Value::as_i64).unwrap_or(0),sales.get("totalPaise").and_then(Value::as_i64).unwrap_or(0))
}
fn tally_xml(
    lines: &[pos_enterprise_repository::DailyAccountingExportLine],
) -> Result<String, AppError> {
    validate_accounting_export_lines(lines)?;
    let mut body = String::new();
    let mut current = "";
    for line in lines {
        if current != line.journal_entry_id {
            if !current.is_empty() {
                body.push_str("</VOUCHER></TALLYMESSAGE>");
            }
            current = &line.journal_entry_id;
            body.push_str(&format!(
                "<TALLYMESSAGE><VOUCHER VCHTYPE=\"Journal\"><DATE>{}</DATE><VOUCHERNUMBER>{}</VOUCHERNUMBER><NARRATION>{}</NARRATION>",
                line.business_date.format("%Y%m%d"),
                xml_escape(&line.source_id),
                xml_escape(&line.memo)
            ));
        }
        let signed_paise = line.debit_paise - line.credit_paise;
        body.push_str(&format!(
            "<ALLLEDGERENTRIES.LIST><LEDGERNAME>{}</LEDGERNAME><ISDEEMEDPOSITIVE>{}</ISDEEMEDPOSITIVE><AMOUNT>{}</AMOUNT></ALLLEDGERENTRIES.LIST>",
            xml_escape(&line.account_code),
            if signed_paise < 0 { "Yes" } else { "No" },
            paise_text(signed_paise)
        ));
    }
    body.push_str("</VOUCHER></TALLYMESSAGE>");
    Ok(format!("<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDATA>{body}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"))
}

fn busy_csv(
    lines: &[pos_enterprise_repository::DailyAccountingExportLine],
) -> Result<String, AppError> {
    validate_accounting_export_lines(lines)?;
    let mut content = String::from(
        "Date,Voucher Type,Voucher Number,Account,Debit,Credit,Narration,Source Type,Source ID\r\n",
    );
    for line in lines {
        content.push_str(&format!(
            "{},{},{},{},{},{},{},{},{}\r\n",
            line.business_date.format("%d-%m-%Y"),
            "Journal",
            csv_field(&line.journal_entry_id),
            csv_field(&line.account_code),
            paise_text(line.debit_paise),
            paise_text(line.credit_paise),
            csv_field(&line.memo),
            csv_field(&line.source_type),
            csv_field(&line.source_id)
        ));
    }
    Ok(content)
}

fn quickbooks_iif(
    lines: &[pos_enterprise_repository::DailyAccountingExportLine],
) -> Result<String, AppError> {
    validate_accounting_export_lines(lines)?;
    let mut content = String::from(
        "!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO\n!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO\n!ENDTRNS\n",
    );
    let mut current = "";
    for line in lines {
        let row_type = if current == line.journal_entry_id {
            "SPL"
        } else {
            if !current.is_empty() {
                content.push_str("ENDTRNS\n");
            }
            current = &line.journal_entry_id;
            "TRNS"
        };
        content.push_str(&format!(
            "{row_type}\tGENERAL JOURNAL\t{}\t{}\t{}\t{}\t{}\n",
            line.business_date.format("%m/%d/%Y"),
            tsv_field(&line.account_code),
            paise_text(line.debit_paise - line.credit_paise),
            tsv_field(&line.source_id),
            tsv_field(&line.memo)
        ));
    }
    content.push_str("ENDTRNS\n");
    Ok(content)
}

fn validate_accounting_export_lines(
    lines: &[pos_enterprise_repository::DailyAccountingExportLine],
) -> Result<(), AppError> {
    if lines.is_empty() {
        return Err(AppError::conflict(
            "no posted accounting journals exist for this date",
        ));
    }
    let mut journals = std::collections::HashMap::<&str, (i64, i64)>::new();
    for line in lines {
        let totals = journals.entry(&line.journal_entry_id).or_default();
        totals.0 = totals.0.saturating_add(line.debit_paise);
        totals.1 = totals.1.saturating_add(line.credit_paise);
    }
    if journals
        .values()
        .any(|(debit, credit)| *debit <= 0 || debit != credit)
    {
        return Err(AppError::conflict(
            "accounting export is blocked because journals do not balance",
        ));
    }
    Ok(())
}

fn paise_text(paise: i64) -> String {
    let negative = paise < 0;
    let absolute = paise.unsigned_abs();
    format!(
        "{}{}.{:02}",
        if negative { "-" } else { "" },
        absolute / 100,
        absolute % 100
    )
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn tsv_field(value: &str) -> String {
    value.replace(['\t', '\r', '\n'], " ")
}

#[cfg(test)]
mod accounting_export_tests {
    use super::*;

    fn line(
        journal: &str,
        account: &str,
        debit_paise: i64,
        credit_paise: i64,
    ) -> pos_enterprise_repository::DailyAccountingExportLine {
        pos_enterprise_repository::DailyAccountingExportLine {
            journal_entry_id: journal.into(),
            business_date: NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(),
            source_type: "invoice".into(),
            source_id: "INV-1".into(),
            memo: "Daily close".into(),
            account_code: account.into(),
            debit_paise,
            credit_paise,
        }
    }

    #[test]
    fn accounting_exports_require_each_journal_to_balance() {
        let balanced = vec![
            line("j1", "CASH", 10_050, 0),
            line("j1", "SALES", 0, 10_050),
        ];
        assert!(tally_xml(&balanced).unwrap().contains("100.50"));
        assert!(busy_csv(&balanced).unwrap().contains("100.50"));
        assert!(quickbooks_iif(&balanced).unwrap().contains("-100.50"));

        let cross_balanced = vec![
            line("j1", "CASH", 10_000, 0),
            line("j2", "SALES", 0, 10_000),
        ];
        assert!(validate_accounting_export_lines(&cross_balanced).is_err());
    }
}
