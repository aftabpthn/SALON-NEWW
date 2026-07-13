use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::cash_drawer_repository,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, cash_drawer_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos/cash-drawer/current", get(current))
        .route("/pos/cash-drawer/open", post(open))
        .route("/pos/cash-drawer/movements", post(record_movement))
        .route("/pos/cash-drawer/close", post(close))
        .route("/pos/cash-drawer/:id/approve", post(approve))
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseRequest {
    counted_cash_paise: i64,
    business_date: Option<String>,
    notes: Option<String>,
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

async fn close(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CloseRequest>,
) -> ApiResult<DrawerResponse> {
    if payload.counted_cash_paise < 0 {
        return Err(AppError::validation("countedCashPaise cannot be negative"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let session = cash_drawer_service::close(
        &state,
        &tenant_id,
        &branch_id,
        &claims.sub,
        parse_date(payload.business_date.as_deref())?,
        payload.counted_cash_paise,
        payload.notes.as_deref().unwrap_or_default(),
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
        blind: !reveal_expected,
    }
}
