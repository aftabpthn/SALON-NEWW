//! HTTP surface for the scope-aware AI copilot.
//!
//! Every handler resolves the caller's data scope from their login before any
//! CRM data is read, and each response carries the scope it used so the client
//! can show what the answer covers.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult},
    repositories::ai_scope_repository::{AiCopilotAlertRecord, AiCopilotApprovalRecord},
    routes::context::tenant_branch,
    services::{
        ai_copilot_governance::{self, AlertScanResult, DecideActionRequest, ProposeActionRequest},
        ai_scope_service::{self, AnswerEnvelope, ScopeRequest},
        ai_scoped_copilot_tools::{self, ToolRequest},
        auth_service::AuthClaims,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ai/copilot/scope", get(get_scope))
        .route("/ai/copilot/tools", get(get_tools))
        .route("/ai/copilot/ask", post(ask))
        .route("/ai/copilot/alerts", get(list_alerts))
        .route("/ai/copilot/alerts/scan", post(scan_alerts))
        .route("/ai/copilot/alerts/:id/status", post(update_alert_status))
        .route(
            "/ai/copilot/actions",
            get(list_actions).post(propose_action),
        )
        .route("/ai/copilot/actions/:id/decision", post(decide_action))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScopeQuery {
    level: Option<String>,
    region: Option<String>,
    zone: Option<String>,
    cluster: Option<String>,
    branch_id: Option<String>,
    staff_id: Option<String>,
    language: Option<String>,
}

impl ScopeQuery {
    fn to_request(&self) -> ScopeRequest {
        ScopeRequest {
            level: self.level.clone(),
            region: self.region.clone(),
            zone: self.zone.clone(),
            cluster: self.cluster.clone(),
            branch_id: self.branch_id.clone(),
            staff_id: self.staff_id.clone(),
        }
    }
}

/// What this login may read, and which tools that unlocks.
async fn get_scope(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ScopeQuery>,
) -> ApiResult<Value> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    let language = ai_scope_service::detect_language("", query.language.as_deref());
    let scope = ai_scope_service::resolve_scope(
        &state.db,
        &tenant_id,
        &claims,
        &query.to_request(),
        language.language,
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({
        "scope": scope,
        "tools": ai_scoped_copilot_tools::available_tools(&claims),
    }))))
}

/// The allow-listed tools this login is permitted to run.
async fn get_tools(Extension(claims): Extension<AuthClaims>) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        ai_scoped_copilot_tools::available_tools(&claims),
    )))
}

/// Run one allow-listed tool and return the full answer envelope.
async fn ask(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ToolRequest>,
) -> ApiResult<AnswerEnvelope> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_scoped_copilot_tools::execute(&state.db, &tenant_id, &branch_id, &claims, &payload)
            .await?,
    )))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlertQuery {
    status: Option<String>,
}

async fn list_alerts(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<AlertQuery>,
) -> ApiResult<Vec<AiCopilotAlertRecord>> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_copilot_governance::list_alerts(
            &state.db,
            &tenant_id,
            &claims,
            query.status.as_deref().unwrap_or("open"),
        )
        .await?,
    )))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanRequest {
    #[serde(default)]
    scope: ScopeRequest,
    #[serde(default)]
    start_date: Option<NaiveDate>,
    #[serde(default)]
    end_date: Option<NaiveDate>,
}

/// Run the proactive detectors across the caller's scope.
async fn scan_alerts(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ScanRequest>,
) -> ApiResult<AlertScanResult> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_copilot_governance::scan_alerts(
            &state.db,
            &tenant_id,
            &claims,
            &payload.scope,
            payload.start_date,
            payload.end_date,
        )
        .await?,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlertStatusRequest {
    status: String,
}

async fn update_alert_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(alert_id): Path<String>,
    Json(payload): Json<AlertStatusRequest>,
) -> ApiResult<AiCopilotAlertRecord> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_copilot_governance::update_alert_status(
            &state.db,
            &tenant_id,
            &claims,
            &alert_id,
            &payload.status,
        )
        .await?,
    )))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionQuery {
    status: Option<String>,
}

async fn list_actions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ActionQuery>,
) -> ApiResult<Vec<AiCopilotApprovalRecord>> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_copilot_governance::list_actions(
            &state.db,
            &tenant_id,
            &claims,
            query.status.as_deref().unwrap_or(""),
        )
        .await?,
    )))
}

/// Record a proposed action. Nothing is executed here: money-moving and
/// outbound actions are stored pending until a permitted human decides.
async fn propose_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ProposeActionRequest>,
) -> ApiResult<AiCopilotApprovalRecord> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_copilot_governance::propose_action(&state.db, &tenant_id, &claims, &payload).await?,
    )))
}

async fn decide_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(action_id): Path<String>,
    Json(payload): Json<DecideActionRequest>,
) -> ApiResult<AiCopilotApprovalRecord> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        ai_copilot_governance::decide_action(&state.db, &tenant_id, &claims, &action_id, &payload)
            .await?,
    )))
}
