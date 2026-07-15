use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::cash_drawer_repository,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, cash_drawer_service, security_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/cash-drawer/current", get(current))
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
struct BusinessDateQuery {
    business_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    opening_cash_paise: i64,
    business_date: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovementRequest {
    movement_type: String,
    amount_paise: i64,
    business_date: Option<String>,
    reference_type: Option<String>,
    reference_id: Option<String>,
    notes: String,
    mfa_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    counted_cash_paise: Option<i64>,
    denomination_breakdown: Option<cash_drawer_service::CashCountBreakdown>,
    business_date: Option<String>,
    notes: Option<String>,
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
struct ProviderReconciliationRequest {
    provider: String,
    settlement_date: String,
    statement_reference: String,
    statement_gross_paise: i64,
    fee_paise: i64,
    bank_net_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderReconciliationImportRequest {
    rows: Vec<ProviderReconciliationRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewRequest {
    review_note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TillRequest {
    till_code: String,
    till_name: String,
    opening_cash_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TillCloseRequest {
    counted_cash_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalRequest {
    approval_note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DrawerResponse {
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

async fn current(
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
        let reveal_expected = is_approver(&claims.role) && value.status != "open";
        response(value, reveal_expected)
    }))))
}

async fn open(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<OpenRequest>,
) -> ApiResult<DrawerResponse> {
    if payload.opening_cash_paise < 0 {
        return Err(AppError::validation("openingCashPaise cannot be negative"));
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
    )
    .await?;
    Ok(Json(ApiResponse::ok(response(session, false))))
}

async fn record_movement(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MovementRequest>,
) -> ApiResult<DrawerResponse> {
    if payload.amount_paise <= 0 || payload.notes.trim().is_empty() {
        return Err(AppError::validation(
            "amountPaise must be positive and notes are required",
        ));
    }
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
    )
    .await?;
    Ok(Json(ApiResponse::ok(response(session, false))))
}

async fn list_movements(
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
    Ok(Json(ApiResponse::ok(row)))
}

async fn close(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CloseRequest>,
) -> ApiResult<DrawerResponse> {
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
    Ok(Json(ApiResponse::ok(response(session, false))))
}

async fn approve(
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
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = cash_drawer_service::approve(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.approval_note.as_deref().unwrap_or_default(),
    )
    .await?;
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
        || payload.bank_name.trim().is_empty()
        || payload.reference.trim().is_empty()
    {
        return Err(AppError::validation(
            "amountPaise, bankName and reference are required",
        ));
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
    Ok(Json(ApiResponse::ok(row)))
}

async fn confirm_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    change_deposit_status(state, claims, headers, id, "confirmed").await
}

async fn cancel_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    change_deposit_status(state, claims, headers, id, "cancelled").await
}

async fn change_deposit_status(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    id: String,
    status: &str,
) -> ApiResult<cash_drawer_repository::CashDrawerBankDeposit> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can review bank deposits",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_service::update_deposit_status(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        status,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_provider_reconciliations(
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

async fn create_provider_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ProviderReconciliationRequest>,
) -> ApiResult<cash_drawer_repository::ProviderReconciliationRun> {
    if payload.provider.trim().is_empty()
        || payload.statement_reference.trim().is_empty()
        || payload.statement_gross_paise < 0
        || payload.fee_paise < 0
        || payload.bank_net_paise < 0
        || payload.fee_paise > payload.statement_gross_paise
    {
        return Err(AppError::validation("invalid provider statement totals"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let date = parse_date(Some(&payload.settlement_date))?;
    let row = cash_drawer_service::create_provider_reconciliation(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload.provider.trim(),
        date,
        payload.statement_reference.trim(),
        payload.statement_gross_paise,
        payload.fee_paise,
        payload.bank_net_paise,
        payload.notes.as_deref().unwrap_or_default().trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn import_provider_reconciliations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ProviderReconciliationImportRequest>,
) -> ApiResult<Vec<cash_drawer_repository::ProviderReconciliationRun>> {
    if payload.rows.is_empty() || payload.rows.len() > 500 {
        return Err(AppError::validation(
            "provider statement import must contain 1 to 500 rows",
        ));
    }
    let rows = payload
        .rows
        .into_iter()
        .map(|row| {
            if row.provider.trim().is_empty()
                || row.statement_reference.trim().is_empty()
                || row.statement_gross_paise < 0
                || row.fee_paise < 0
                || row.bank_net_paise < 0
                || row.fee_paise > row.statement_gross_paise
            {
                return Err(AppError::validation("invalid provider statement row"));
            }
            Ok(cash_drawer_service::ProviderStatementInput {
                provider: row.provider.trim().to_string(),
                settlement_date: parse_date(Some(&row.settlement_date))?,
                statement_reference: row.statement_reference.trim().to_string(),
                statement_gross_paise: row.statement_gross_paise,
                fee_paise: row.fee_paise,
                bank_net_paise: row.bank_net_paise,
                notes: row.notes.unwrap_or_default().trim().to_string(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let imported = cash_drawer_service::import_provider_reconciliations(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        rows,
    )
    .await?;
    Ok(Json(ApiResponse::ok(imported)))
}

async fn review_provider_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReviewRequest>,
) -> ApiResult<cash_drawer_repository::ProviderReconciliationRun> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can review reconciliation",
        ));
    }
    if payload.review_note.trim().is_empty() {
        return Err(AppError::validation("reviewNote is required"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_repository::review_provider_reconciliation(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        payload.review_note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to review provider reconciliation"))?
    .ok_or_else(|| AppError::conflict("reconciliation is not awaiting review"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_tills(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<cash_drawer_repository::CashDrawerTill>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = cash_drawer_repository::list_tills(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load cash tills"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_till(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TillRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerTill> {
    if payload.till_code.trim().is_empty()
        || payload.till_name.trim().is_empty()
        || payload.opening_cash_paise < 0
    {
        return Err(AppError::validation(
            "tillCode, tillName and valid openingCashPaise are required",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = cash_drawer_service::create_till(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        payload.till_code.trim(),
        payload.till_name.trim(),
        payload.opening_cash_paise,
        payload.notes.as_deref().unwrap_or_default().trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn close_till(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<TillCloseRequest>,
) -> ApiResult<cash_drawer_repository::CashDrawerTill> {
    if payload.counted_cash_paise < 0 {
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
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve_till(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<cash_drawer_repository::CashDrawerTill> {
    if !is_approver(&claims.role) {
        return Err(AppError::forbidden(
            "only owner, admin, or manager can approve till variance",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        cash_drawer_service::approve_till(&state, &tenant_id, &branch_id, &claims.sub, &id).await?;
    Ok(Json(ApiResponse::ok(row)))
}

fn parse_date(value: Option<&str>) -> Result<NaiveDate, AppError> {
    value
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map_err(|_| AppError::validation("businessDate must be YYYY-MM-DD"))
        })
        .transpose()
        .map(|date| date.unwrap_or_else(|| Utc::now().date_naive()))
}

fn is_approver(role: &str) -> bool {
    ["owner", "admin", "manager"]
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(role))
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
