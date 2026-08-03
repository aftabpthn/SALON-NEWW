use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    config::PAYMENT_PROVIDERS,
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::cash_drawer_repository,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, cash_drawer_service, security_service},
    state::AppState,
};

const MAX_FINANCIAL_AMOUNT_PAISE: i64 = 100_000_000_000;
const MAX_REFERENCE_LEN: usize = 120;
const MAX_NOTES_LEN: usize = 1_000;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/cash-drawer/current", get(current))
        .route(
            "/pos/cash-drawer/settings",
            get(cash_control_settings).put(save_cash_control_settings),
        )
        .route("/pos/cash-drawer/open", post(open))
        .route(
            "/pos/cash-drawer/movements",
            get(list_movements).post(record_movement),
        )
        .route(
            "/pos/cash-drawer/movements/:id/reverse",
            post(reverse_movement),
        )
        .route("/pos/cash-drawer/handover", post(handover))
        .route("/pos/cash-drawer/close", post(close))
        .route(
            "/pos/cash-drawer/:id/deposits",
            get(list_deposits).post(create_deposit),
        )
        .route(
            "/pos/cash-drawer/:id/tills",
            get(list_tills).post(create_till),
        )
        .route("/pos/cash-drawer/tills/:id/close", post(close_till))
        .route("/pos/cash-drawer/tills/:id/approve", post(approve_till))
        .route(
            "/pos/cash-drawer/deposits/:id/confirm",
            post(confirm_deposit),
        )
        .route("/pos/cash-drawer/deposits/:id/cancel", post(cancel_deposit))
        .route("/pos/cash-drawer/deposits/:id", put(amend_deposit))
        .route("/pos/cash-drawer/:id/approve", post(approve))
        .route(
            "/pos/provider-reconciliations",
            get(list_provider_reconciliations).post(create_provider_reconciliation),
        )
        .route(
            "/pos/provider-reconciliations/import",
            post(import_provider_reconciliations),
        )
        .route(
            "/pos/provider-reconciliations/:id/review",
            post(review_provider_reconciliation),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BusinessDateQuery {
    pub(crate) business_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    pub(crate) opening_cash_paise: i64,
    pub(crate) business_date: Option<String>,
    pub(crate) notes: Option<String>,
    #[serde(default)]
    pub(crate) holiday_exception: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MovementRequest {
    pub(crate) movement_type: String,
    pub(crate) amount_paise: i64,
    pub(crate) business_date: Option<String>,
    pub(crate) reference_type: Option<String>,
    pub(crate) reference_id: Option<String>,
    pub(crate) notes: String,
    pub(crate) mfa_code: Option<String>,
    pub(crate) cash_drawer_till_id: Option<String>,
    pub(crate) idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseRequest {
    pub(crate) counted_cash_paise: Option<i64>,
    pub(crate) denomination_breakdown: Option<cash_drawer_service::CashCountBreakdown>,
    pub(crate) business_date: Option<String>,
    pub(crate) notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoverRequest {
    business_date: Option<String>,
    to_staff_id: String,
    notes: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositRequest {
    amount_paise: i64,
    bank_name: String,
    reference: String,
    notes: Option<String>,
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositAmendmentRequest {
    amount_paise: i64,
    bank_name: String,
    reference: String,
    notes: Option<String>,
    amendment_note: String,
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CorrectionRequest {
    reason: String,
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderReconciliationRequest {
    pub(crate) provider: String,
    pub(crate) settlement_date: String,
    pub(crate) statement_reference: String,
    pub(crate) statement_gross_paise: i64,
    pub(crate) fee_paise: i64,
    pub(crate) bank_net_paise: i64,
    pub(crate) notes: Option<String>,
    pub(crate) mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderReconciliationImportRequest {
    rows: Vec<ProviderReconciliationRequest>,
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewRequest {
    pub(crate) review_note: String,
    pub(crate) mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TillRequest {
    till_code: String,
    till_name: String,
    terminal_id: Option<String>,
    opening_cash_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CashControlSettingsRequest {
    max_cash_paise: i64,
    variance_alert_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TillCloseRequest {
    counted_cash_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalRequest {
    pub(crate) approval_note: Option<String>,
    pub(crate) mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionMfaRequest {
    mfa_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DrawerResponse {
    id: String,
    business_date: NaiveDate,
    opening_cash_paise: i64,
    expected_cash_paise: Option<i64>,
    counted_cash_paise: Option<i64>,
    variance_paise: Option<i64>,
    status: String,
    opened_at: chrono::DateTime<Utc>,
    closed_at: Option<chrono::DateTime<Utc>>,
    close_requested_at: Option<chrono::DateTime<Utc>>,
    approved_at: Option<chrono::DateTime<Utc>>,
    denomination_breakdown: serde_json::Value,
    handover_to_staff_id: String,
    handover_note: String,
    handover_at: Option<chrono::DateTime<Utc>>,
    blind: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TillResponse {
    id: String,
    drawer_session_id: String,
    till_code: String,
    till_name: String,
    terminal_id: Option<String>,
    opening_cash_paise: i64,
    expected_cash_paise: Option<i64>,
    counted_cash_paise: Option<i64>,
    variance_paise: Option<i64>,
    status: String,
    opened_at: chrono::DateTime<Utc>,
    close_requested_at: Option<chrono::DateTime<Utc>>,
    approved_at: Option<chrono::DateTime<Utc>>,
    closed_at: Option<chrono::DateTime<Utc>>,
    blind: bool,
}

pub(crate) async fn current(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BusinessDateQuery>,
) -> ApiResult<Option<DrawerResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = cash_drawer_repository::current(
        &state.db,
        &tenant_id,
        &branch_id,
        parse_date(query.business_date.as_deref())?,
    )
    .await
    .map_err(|_| AppError::internal("failed to load cash drawer"))?;
    Ok(Json(ApiResponse::ok(session.map(|value| {
        let reveal_expected = reveal_drawer_expected(&claims.role, &value.status);
        response(value, reveal_expected)
    }))))
}

pub(crate) async fn open(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OpenRequest>,
) -> ApiResult<DrawerResponse> {
    if payload.opening_cash_paise < 0 || payload.opening_cash_paise > MAX_FINANCIAL_AMOUNT_PAISE {
        return Err(AppError::validation("openingCashPaise cannot be negative"));
    }
    validate_optional_text(payload.notes.as_deref(), "notes", MAX_NOTES_LEN)?;
    if payload.holiday_exception
        && (!is_approver(&claims.role)
            || payload
                .notes
                .as_deref()
                .is_none_or(|value| value.trim().is_empty()))
    {
        return Err(AppError::forbidden(
            "holiday exception requires owner, admin, or manager access and notes",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = cash_drawer_service::open(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        parse_date(payload.business_date.as_deref())?,
        payload.opening_cash_paise,
        payload.notes.as_deref().unwrap_or_default(),
        payload.holiday_exception,
    )
    .await?;
    publish_cash_drawer(&state, &tenant_id, &branch_id, &session.id, "drawer.opened");
    Ok(Json(ApiResponse::ok(response(session, false))))
}

async fn cash_control_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<cash_drawer_repository::CashControlSettings> {
    if !can_manage_financial(&claims) {
        return Err(AppError::forbidden(
            "financial management access is required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_repository::control_settings(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load cash control settings"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn save_cash_control_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CashControlSettingsRequest>,
) -> ApiResult<cash_drawer_repository::CashControlSettings> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can change cash controls",
        ));
    }
    if !(0..=MAX_FINANCIAL_AMOUNT_PAISE).contains(&payload.max_cash_paise)
        || !(0..=MAX_FINANCIAL_AMOUNT_PAISE).contains(&payload.variance_alert_paise)
    {
        return Err(AppError::validation(
            "cash control values are outside the allowed range",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_repository::save_control_settings(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload.max_cash_paise,
        payload.variance_alert_paise,
    )
    .await
    .map_err(|_| AppError::internal("failed to save cash control settings"))?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "cash_drawer",
        &branch_id,
        "cash.controls_updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

pub(crate) async fn record_movement(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MovementRequest>,
) -> ApiResult<DrawerResponse> {
    if payload.amount_paise <= 0
        || payload.amount_paise > MAX_FINANCIAL_AMOUNT_PAISE
        || payload.notes.trim().is_empty()
    {
        return Err(AppError::validation(
            "amountPaise is outside the allowed range or notes are missing",
        ));
    }
    validate_text(&payload.notes, "notes", MAX_NOTES_LEN)?;
    validate_optional_text(
        payload.reference_type.as_deref(),
        "referenceType",
        MAX_REFERENCE_LEN,
    )?;
    validate_optional_text(
        payload.reference_id.as_deref(),
        "referenceId",
        MAX_REFERENCE_LEN,
    )?;
    let idempotency_key = validate_idempotency_key(&payload.idempotency_key)?;
    let movement_type = payload.movement_type.trim().to_ascii_lowercase();
    let amount = match movement_type.as_str() {
        "cash_in" => payload.amount_paise,
        "cash_out" | "refund_cash" => -payload.amount_paise,
        _ => {
            return Err(AppError::validation(
                "movementType must be cash_in, cash_out, or refund_cash",
            ))
        }
    };
    if movement_type == "refund_cash"
        && payload
            .reference_id
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(AppError::validation("refund_cash requires referenceId"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::enforce_role_limit(
        claims.max_cash_movement_paise,
        payload.amount_paise,
        "cash movement",
    )?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.movement",
    )
    .await?;
    let session = cash_drawer_service::add_movement(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        parse_date(payload.business_date.as_deref())?,
        &movement_type,
        amount,
        payload.reference_type.as_deref().unwrap_or_default(),
        payload.reference_id.as_deref().unwrap_or_default(),
        payload.notes.trim(),
        payload
            .cash_drawer_till_id
            .as_deref()
            .unwrap_or_default()
            .trim(),
        &idempotency_key,
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &session.id,
        "drawer.movement_recorded",
    );
    Ok(Json(ApiResponse::ok(response(session, false))))
}

pub(crate) async fn list_movements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BusinessDateQuery>,
) -> ApiResult<Vec<cash_drawer_repository::CashDrawerMovement>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let date = parse_date(query.business_date.as_deref())?;
    let session = cash_drawer_repository::current(&state.db, &tenant_id, &branch_id, date)
        .await
        .map_err(|_| AppError::internal("failed to load cash drawer"))?;
    let Some(session) = session else {
        return Ok(Json(ApiResponse::ok(Vec::new())));
    };
    let rows =
        cash_drawer_repository::list_movements(&state.db, &tenant_id, &branch_id, &session.id)
            .await
            .map_err(|_| AppError::internal("failed to load cash movements"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn reverse_movement(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CorrectionRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerMovement> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can correct cash movements",
        ));
    }
    validate_text(&payload.reason, "reason", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.movement.reverse",
    )
    .await?;
    let row = cash_drawer_service::reverse_movement(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.reason.trim(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        "drawer.movement_reversed",
    );
    Ok(Json(ApiResponse::ok(row)))
}

pub(crate) async fn close(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CloseRequest>,
) -> ApiResult<DrawerResponse> {
    if payload
        .counted_cash_paise
        .is_some_and(|amount| !(0..=MAX_FINANCIAL_AMOUNT_PAISE).contains(&amount))
    {
        return Err(AppError::validation(
            "countedCashPaise is outside the allowed range",
        ));
    }
    validate_optional_text(payload.notes.as_deref(), "notes", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = cash_drawer_service::close(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        parse_date(payload.business_date.as_deref())?,
        payload.counted_cash_paise,
        payload.denomination_breakdown,
        payload.notes.as_deref().unwrap_or_default(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &session.id,
        "drawer.close_requested",
    );
    Ok(Json(ApiResponse::ok(response(session, false))))
}

async fn handover(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<HandoverRequest>,
) -> ApiResult<DrawerResponse> {
    if payload.to_staff_id.trim().is_empty() || payload.notes.trim().is_empty() {
        return Err(AppError::validation(
            "toStaffId and handover notes are required",
        ));
    }
    validate_text(&payload.notes, "notes", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = cash_drawer_service::handover(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        parse_date(payload.business_date.as_deref())?,
        payload.to_staff_id.trim(),
        payload.notes.trim(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &session.id,
        "drawer.handed_over",
    );
    Ok(Json(ApiResponse::ok(response(session, false))))
}

pub(crate) async fn approve(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ApprovalRequest>,
) -> ApiResult<DrawerResponse> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can approve a cash variance",
        ));
    }
    if payload
        .approval_note
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        return Err(AppError::validation(
            "approvalNote is required for a cash variance",
        ));
    }
    validate_text(
        payload.approval_note.as_deref().unwrap_or_default(),
        "approvalNote",
        MAX_NOTES_LEN,
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.variance.approve",
    )
    .await?;
    let session = cash_drawer_service::approve(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.approval_note.as_deref().unwrap_or_default(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &session.id,
        "drawer.variance_approved",
    );
    Ok(Json(ApiResponse::ok(response(session, true))))
}

async fn list_deposits(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<cash_drawer_repository::CashDrawerBankDeposit>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = cash_drawer_repository::list_deposits(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load bank deposits"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DepositRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    if payload.amount_paise <= 0
        || payload.amount_paise > MAX_FINANCIAL_AMOUNT_PAISE
        || payload.bank_name.trim().is_empty()
        || payload.reference.trim().is_empty()
    {
        return Err(AppError::validation(
            "amountPaise, bankName and reference are required",
        ));
    }
    validate_text(&payload.bank_name, "bankName", MAX_REFERENCE_LEN)?;
    validate_text(&payload.reference, "reference", MAX_REFERENCE_LEN)?;
    validate_optional_text(payload.notes.as_deref(), "notes", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::enforce_role_limit(
        claims.max_cash_movement_paise,
        payload.amount_paise,
        "cash movement",
    )?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.deposit",
    )
    .await?;
    let row = cash_drawer_service::create_deposit(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.amount_paise,
        payload.bank_name.trim(),
        payload.reference.trim(),
        payload.notes.as_deref().unwrap_or_default().trim(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        "drawer.deposit_created",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn amend_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DepositAmendmentRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can amend bank deposits",
        ));
    }
    if payload.amount_paise <= 0 || payload.amount_paise > MAX_FINANCIAL_AMOUNT_PAISE {
        return Err(AppError::validation(
            "amountPaise is outside the allowed range",
        ));
    }
    validate_text(&payload.bank_name, "bankName", MAX_REFERENCE_LEN)?;
    validate_text(&payload.reference, "reference", MAX_REFERENCE_LEN)?;
    validate_optional_text(payload.notes.as_deref(), "notes", MAX_NOTES_LEN)?;
    validate_text(&payload.amendment_note, "amendmentNote", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::enforce_role_limit(
        claims.max_cash_movement_paise,
        payload.amount_paise,
        "cash movement",
    )?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.deposit.amend",
    )
    .await?;
    let row = cash_drawer_service::amend_deposit(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.amount_paise,
        payload.bank_name.trim(),
        payload.reference.trim(),
        payload.notes.as_deref().unwrap_or_default().trim(),
        payload.amendment_note.trim(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        "drawer.deposit_amended",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn confirm_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ActionMfaRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    change_deposit_status(
        state,
        claims,
        headers,
        id,
        "confirmed",
        payload.mfa_code.as_deref(),
    )
    .await
}

async fn cancel_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ActionMfaRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    change_deposit_status(
        state,
        claims,
        headers,
        id,
        "cancelled",
        payload.mfa_code.as_deref(),
    )
    .await
}

async fn change_deposit_status(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    id: String,
    status: &str,
    mfa_code: Option<&str>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can review bank deposits",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        mfa_code,
        if status == "confirmed" {
            "cash.deposit.confirm"
        } else {
            "cash.deposit.cancel"
        },
    )
    .await?;
    let row = cash_drawer_service::update_deposit_status(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        status,
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        if status == "confirmed" {
            "drawer.deposit_confirmed"
        } else {
            "drawer.deposit_cancelled"
        },
    );
    Ok(Json(ApiResponse::ok(row)))
}

pub(crate) async fn list_provider_reconciliations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BusinessDateQuery>,
) -> ApiResult<Vec<cash_drawer_repository::ProviderReconciliationRun>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let date = parse_date(query.business_date.as_deref())?;
    let rows = cash_drawer_repository::list_provider_reconciliations(
        &state.db, &tenant_id, &branch_id, date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load provider reconciliations"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

pub(crate) async fn create_provider_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ProviderReconciliationRequest>,
) -> ApiResult<cash_drawer_repository::ProviderReconciliationRun> {
    if !can_manage_financial(&claims) {
        return Err(AppError::forbidden(
            "management permission is required for provider reconciliation",
        ));
    }
    let input = validated_provider_statement(&payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.reconciliation.create",
    )
    .await?;
    let row = cash_drawer_service::create_provider_reconciliation(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &input.provider,
        input.settlement_date,
        &input.statement_reference,
        input.statement_gross_paise,
        input.fee_paise,
        input.bank_net_paise,
        &input.notes,
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.id,
        "drawer.reconciliation_created",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn import_provider_reconciliations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ProviderReconciliationImportRequest>,
) -> ApiResult<Vec<cash_drawer_repository::ProviderReconciliationRun>> {
    if !can_manage_financial(&claims) {
        return Err(AppError::forbidden(
            "management permission is required for provider reconciliation import",
        ));
    }
    if payload.rows.is_empty() || payload.rows.len() > 500 {
        return Err(AppError::validation(
            "provider statement import must contain 1 to 500 rows",
        ));
    }
    let rows = payload
        .rows
        .iter()
        .map(validated_provider_statement)
        .collect::<Result<Vec<_>, AppError>>()?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.reconciliation.import",
    )
    .await?;
    let imported = cash_drawer_service::import_provider_reconciliations(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        rows,
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &imported[0].id,
        "drawer.reconciliation_imported",
    );
    Ok(Json(ApiResponse::ok(imported)))
}

pub(crate) async fn review_provider_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReviewRequest>,
) -> ApiResult<cash_drawer_repository::ProviderReconciliationRun> {
    if !can_manage_financial(&claims) {
        return Err(AppError::forbidden(
            "management permission is required to review reconciliation",
        ));
    }
    if payload.review_note.trim().is_empty() {
        return Err(AppError::validation("reviewNote is required"));
    }
    validate_text(&payload.review_note, "reviewNote", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.reconciliation.review",
    )
    .await?;
    let row = cash_drawer_service::review_provider_reconciliation(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.review_note.trim(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.id,
        "drawer.reconciliation_reviewed",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_tills(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<TillResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = cash_drawer_repository::list_tills(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load cash tills"))?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter()
            .map(|row| {
                let reveal = reveal_till_expected(&claims.role, &row.status);
                till_response(row, reveal)
            })
            .collect(),
    )))
}

async fn create_till(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TillRequest>,
) -> ApiResult<TillResponse> {
    if payload.till_code.trim().is_empty()
        || payload.till_name.trim().is_empty()
        || payload.opening_cash_paise < 0
        || payload.opening_cash_paise > MAX_FINANCIAL_AMOUNT_PAISE
    {
        return Err(AppError::validation(
            "tillCode, tillName and valid openingCashPaise are required",
        ));
    }
    validate_text(&payload.till_code, "tillCode", MAX_REFERENCE_LEN)?;
    validate_text(&payload.till_name, "tillName", MAX_REFERENCE_LEN)?;
    validate_optional_text(payload.notes.as_deref(), "notes", MAX_NOTES_LEN)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_service::create_till(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.till_code.trim(),
        payload.till_name.trim(),
        payload
            .terminal_id
            .as_deref()
            .filter(|value| !value.trim().is_empty()),
        payload.opening_cash_paise,
        payload.notes.as_deref().unwrap_or_default().trim(),
    )
    .await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        "drawer.till_created",
    );
    Ok(Json(ApiResponse::ok(till_response(row, false))))
}

async fn close_till(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TillCloseRequest>,
) -> ApiResult<TillResponse> {
    if !(0..=MAX_FINANCIAL_AMOUNT_PAISE).contains(&payload.counted_cash_paise) {
        return Err(AppError::validation("countedCashPaise cannot be negative"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_service::close_till(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.counted_cash_paise,
    )
    .await?;
    let reveal = reveal_till_expected(&claims.role, &row.status);
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        "drawer.till_close_requested",
    );
    Ok(Json(ApiResponse::ok(till_response(row, reveal))))
}

async fn approve_till(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ActionMfaRequest>,
) -> ApiResult<TillResponse> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can approve till variance",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "cash.till.variance.approve",
    )
    .await?;
    let row =
        cash_drawer_service::approve_till(&state, &tenant_id, &branch_id, &claims.sub, &id).await?;
    publish_cash_drawer(
        &state,
        &tenant_id,
        &branch_id,
        &row.drawer_session_id,
        "drawer.till_approved",
    );
    Ok(Json(ApiResponse::ok(till_response(row, true))))
}

fn publish_cash_drawer(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    entity_id: &str,
    action: &str,
) {
    state.publish_pos_event(tenant_id, branch_id, "cash_drawer", entity_id, action);
}

fn parse_date(value: Option<&str>) -> Result<NaiveDate, AppError> {
    let raw = value
        .filter(|raw| !raw.trim().is_empty())
        .ok_or_else(|| AppError::validation("businessDate is required"))?;
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| AppError::validation("businessDate must be YYYY-MM-DD"))
}

fn validated_provider_statement(
    row: &ProviderReconciliationRequest,
) -> Result<cash_drawer_service::ProviderStatementInput, AppError> {
    let provider = row.provider.trim().to_ascii_lowercase();
    if !PAYMENT_PROVIDERS.contains(&provider.as_str()) {
        return Err(AppError::validation(
            "provider must be razorpay, cashfree, or phonepe",
        ));
    }
    validate_text(
        &row.statement_reference,
        "statementReference",
        MAX_REFERENCE_LEN,
    )?;
    validate_optional_text(row.notes.as_deref(), "notes", MAX_NOTES_LEN)?;
    if row.statement_gross_paise < 0
        || row.statement_gross_paise > MAX_FINANCIAL_AMOUNT_PAISE
        || row.fee_paise < 0
        || row.fee_paise > row.statement_gross_paise
        || row.bank_net_paise < 0
        || row.bank_net_paise > MAX_FINANCIAL_AMOUNT_PAISE
    {
        return Err(AppError::validation("invalid provider statement totals"));
    }
    Ok(cash_drawer_service::ProviderStatementInput {
        provider,
        settlement_date: parse_date(Some(&row.settlement_date))?,
        statement_reference: row.statement_reference.trim().to_string(),
        statement_gross_paise: row.statement_gross_paise,
        fee_paise: row.fee_paise,
        bank_net_paise: row.bank_net_paise,
        notes: row.notes.as_deref().unwrap_or_default().trim().to_string(),
    })
}

fn validate_idempotency_key(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if !(10..=120).contains(&value.len())
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        return Err(AppError::validation("invalid idempotencyKey"));
    }
    Ok(value.to_string())
}

fn validate_text(value: &str, field: &str, max: usize) -> Result<(), AppError> {
    let length = value.trim().chars().count();
    if length == 0 || length > max {
        return Err(AppError::validation(format!(
            "{field} must contain 1 to {max} characters"
        )));
    }
    Ok(())
}

fn validate_optional_text(value: Option<&str>, field: &str, max: usize) -> Result<(), AppError> {
    if value.is_some_and(|value| value.trim().chars().count() > max) {
        return Err(AppError::validation(format!(
            "{field} cannot exceed {max} characters"
        )));
    }
    Ok(())
}

fn can_manage_financial(claims: &AuthClaims) -> bool {
    let permissions = ["management.write", "finance.write"];
    !claims
        .denied_permissions
        .iter()
        .any(|denied| permissions.contains(&denied.as_str()))
        && (is_approver(&claims.role)
            || claims
                .permissions
                .iter()
                .any(|granted| permissions.contains(&granted.as_str())))
}

fn is_approver(role: &str) -> bool {
    ["owner", "admin", "manager"]
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(role))
}

fn reveal_drawer_expected(role: &str, status: &str) -> bool {
    status != "open" && is_approver(role)
}

fn reveal_till_expected(role: &str, status: &str) -> bool {
    status == "closed" || (status == "pending_approval" && is_approver(role))
}

fn response(
    session: cash_drawer_repository::CashDrawerSession,
    reveal_expected: bool,
) -> DrawerResponse {
    DrawerResponse {
        id: session.id,
        business_date: session.business_date,
        opening_cash_paise: session.opening_cash_paise,
        expected_cash_paise: reveal_expected.then_some(session.expected_cash_paise),
        counted_cash_paise: session.counted_cash_paise,
        variance_paise: reveal_expected.then_some(session.variance_paise).flatten(),
        status: session.status,
        opened_at: session.opened_at,
        closed_at: session.closed_at,
        close_requested_at: session.close_requested_at,
        approved_at: session.approved_at,
        denomination_breakdown: session.denomination_breakdown_json,
        handover_to_staff_id: session.handover_to_staff_id,
        handover_note: session.handover_note,
        handover_at: session.handover_at,
        blind: !reveal_expected,
    }
}

fn till_response(
    till: cash_drawer_repository::CashDrawerTill,
    reveal_expected: bool,
) -> TillResponse {
    TillResponse {
        id: till.id,
        drawer_session_id: till.drawer_session_id,
        till_code: till.till_code,
        till_name: till.till_name,
        terminal_id: till.terminal_id,
        opening_cash_paise: till.opening_cash_paise,
        expected_cash_paise: reveal_expected.then_some(till.expected_cash_paise),
        counted_cash_paise: till.counted_cash_paise,
        variance_paise: reveal_expected.then_some(till.variance_paise).flatten(),
        status: till.status,
        opened_at: till.opened_at,
        close_requested_at: till.close_requested_at,
        approved_at: till.approved_at,
        closed_at: till.closed_at,
        blind: !reveal_expected,
    }
}

#[cfg(test)]
mod tests {
    use super::{reveal_drawer_expected, reveal_till_expected};

    #[test]
    fn blind_close_hides_expected_cash_from_cashier_and_receptionist() {
        for role in ["cashier", "receptionist"] {
            assert!(!reveal_drawer_expected(role, "pending_approval"));
            assert!(!reveal_till_expected(role, "pending_approval"));
        }
        for role in ["owner", "manager"] {
            assert!(reveal_drawer_expected(role, "pending_approval"));
            assert!(reveal_till_expected(role, "pending_approval"));
        }
        assert!(!reveal_drawer_expected("owner", "open"));
    }
}
