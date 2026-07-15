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
    repositories::pos_enterprise_repository,
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
    terminal_code: String,
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
    account_code: String,
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
    if p.terminal_code.trim().is_empty() || p.terminal_name.trim().is_empty() {
        return Err(AppError::validation(
            "terminalCode and terminalName are required",
        ));
    }
    let (tenant, branch) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::create_terminal(
        &state.db,
        &tenant,
        &branch,
        &claims.sub,
        p.terminal_code.trim(),
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
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"dayLock":lock,"zReport":report}),
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
    let pending:i64=sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status IN ('open','pending_approval')").bind(&t).bind(&b).bind(date).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to validate business day"))?;
    if pending > 0 {
        return Err(AppError::conflict(
            "cash drawers must be closed before locking the day",
        ));
    }
    let row = pos_enterprise_repository::day_lock(
        &state.db,
        &t,
        &b,
        &claims.sub,
        date,
        p.reason.trim(),
        "locked",
    )
    .await
    .map_err(|_| AppError::internal("failed to lock business day"))?;
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
    let row = pos_enterprise_repository::day_lock(
        &state.db,
        &t,
        &b,
        &claims.sub,
        date,
        p.reason.trim(),
        "reopened",
    )
    .await
    .map_err(|_| AppError::internal("failed to reopen business day"))?;
    Ok(Json(ApiResponse::ok(row)))
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
    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&row.report_json)
            .map_err(|_| AppError::internal("failed to export Z-report"))?,
        "csv" => z_report_csv(&row.report_json),
        "tally" => tally_xml(&row.report_json, date),
        _ => return Err(AppError::validation("format must be json, csv, or tally")),
    };
    Ok(Json(ApiResponse::ok(
        json!({"businessDate":date,"version":row.version,"format":format,"sha256":row.sha256,"content":content}),
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
    let id:String=sqlx::query_scalar("INSERT INTO pos_eod_accounting_batches (tenant_id,branch_id,business_date,z_report_id,z_report_version,journal_entry_count,gross_sales_paise,tax_paise,payment_total_paise,posted_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id,branch_id,business_date,z_report_version) DO UPDATE SET journal_entry_count=EXCLUDED.journal_entry_count,gross_sales_paise=EXCLUDED.gross_sales_paise,tax_paise=EXCLUDED.tax_paise,payment_total_paise=EXCLUDED.payment_total_paise RETURNING id").bind(&t).bind(&b).bind(date).bind(&z.id).bind(z.version).bind(journal_count).bind(gross).bind(tax).bind(payments).bind(&claims.sub).fetch_one(&state.db).await.map_err(|_|AppError::internal("failed to post EOD accounting batch"))?;
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

async fn payment_providers(State(state): State<AppState>) -> ApiResult<Value> {
    let rows = ["razorpay", "cashfree", "phonepe"]
        .into_iter()
        .map(|provider| {
            json!({
                "provider": provider,
                "enabled": state.settings.payment_provider_enabled(provider),
                "webhookConfigured": state.settings.payment_provider_webhook_configured(provider),
                "environment": state.settings.payment_provider_environment,
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
    if p.account_code.trim().is_empty()
        || p.account_name.trim().is_empty()
        || p.credit_limit_paise < 0
        || !(0..=365).contains(&p.payment_terms_days)
    {
        return Err(AppError::validation(
            "valid accountCode, accountName, creditLimitPaise, and paymentTermsDays are required",
        ));
    }
    let (t, b) = tenant_branch(&headers)?;
    let row = pos_enterprise_repository::create_corporate_account(
        &state.db,
        &t,
        &b,
        &claims.sub,
        p.account_code.trim(),
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
fn tally_xml(report: &Value, date: NaiveDate) -> String {
    let total = report
        .pointer("/sales/totalPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0) as f64
        / 100.0;
    let tax = report
        .pointer("/sales/taxPaise")
        .and_then(Value::as_i64)
        .unwrap_or(0) as f64
        / 100.0;
    format!("<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE><VOUCHER VCHTYPE=\"Sales\"><DATE>{}</DATE><NARRATION>POS Z Report</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>-{total:.2}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Output GST</LEDGERNAME><AMOUNT>-{tax:.2}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>",date.format("%Y%m%d"))
}
