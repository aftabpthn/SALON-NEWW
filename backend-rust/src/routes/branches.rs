use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::json;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository, auth_repository::AuthAuditInput, branch_repository::BranchRecord,
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, branch_service},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct BranchListQuery {
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCreateRequest {
    pub name: String,
    pub code: String,
    #[serde(default)]
    pub region_name: String,
    #[serde(default)]
    pub zone_name: String,
    #[serde(default)]
    pub cluster_name: String,
    #[serde(default)]
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    #[serde(default)]
    pub booking_deposit_percent: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchUpdateRequest {
    pub name: Option<String>,
    pub code: Option<String>,
    pub region_name: Option<String>,
    pub zone_name: Option<String>,
    pub cluster_name: Option<String>,
    pub address: Option<String>,
    pub latitude: Option<Option<f64>>,
    pub longitude: Option<Option<f64>>,
    pub booking_deposit_percent: Option<i32>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyRuleRequest {
    pub branch_id: String,
    pub royalty_bps: i32,
    pub minimum_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FranchiseSaveRequest {
    pub central_branch_id: String,
    #[serde(default)]
    pub allowed_override_fields: Vec<String>,
    #[serde(default)]
    pub royalty_rules: Vec<RoyaltyRuleRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyGenerateRequest {
    pub period_start: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoyaltyPaymentRequest {
    pub payment_method: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchApprovalRequest {
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchDecisionRequest {
    pub decision: String,
    pub version: i32,
    #[serde(default)]
    pub note: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/branches", axum::routing::get(list).post(create))
        .route("/settings/branches/:id", axum::routing::patch(update))
        .route(
            "/settings/franchise-controls",
            axum::routing::get(franchise_controls).put(save_franchise_controls),
        )
        .route(
            "/settings/franchise-controls/publish",
            axum::routing::post(publish_central_masters),
        )
        .route(
            "/settings/franchise-controls/royalties",
            axum::routing::post(generate_royalties),
        )
        .route(
            "/settings/franchise-controls/royalties/:id/pay",
            axum::routing::post(pay_royalty),
        )
        .route(
            "/settings/multi-branch/command-center",
            axum::routing::get(multi_branch_command_center),
        )
        .route(
            "/settings/multi-branch/approvals",
            axum::routing::post(request_multi_branch_approval),
        )
        .route(
            "/settings/multi-branch/approvals/:id",
            axum::routing::patch(decide_multi_branch_approval),
        )
}

async fn multi_branch_command_center(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<branch_service::MultiBranchCommandCenter> {
    require_branch_access(&claims, false)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::multi_branch_command_center(&state.db, &tenant_id).await?,
    )))
}

async fn request_multi_branch_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MultiBranchApprovalRequest>,
) -> ApiResult<crate::repositories::branch_repository::MultiBranchApprovalRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::request_multi_branch_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            &payload.note,
        )
        .await?,
    )))
}

async fn decide_multi_branch_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<MultiBranchDecisionRequest>,
) -> ApiResult<branch_service::MultiBranchApprovalDecision> {
    require_branch_access(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::decide_multi_branch_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            &id,
            payload.version,
            &payload.decision,
            &payload.note,
        )
        .await?,
    )))
}

async fn franchise_controls(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<branch_service::FranchiseControls> {
    require_branch_access(&claims, false)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        branch_service::franchise_controls(&state.db, &tenant_id).await?,
    )))
}

async fn save_franchise_controls(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<FranchiseSaveRequest>,
) -> ApiResult<branch_service::FranchiseControls> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let controls = branch_service::save_franchise_controls(
        &state.db,
        &tenant_id,
        &claims.sub,
        &payload.central_branch_id,
        payload.allowed_override_fields,
        payload
            .royalty_rules
            .into_iter()
            .map(
                |rule| crate::repositories::branch_repository::RoyaltyRuleInput {
                    branch_id: rule.branch_id,
                    royalty_bps: rule.royalty_bps,
                    minimum_paise: rule.minimum_paise,
                },
            )
            .collect(),
    )
    .await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.controls.updated",
        json!({"centralBranchId": controls.central_branch_id}),
    )
    .await;
    Ok(Json(ApiResponse::ok(controls)))
}

async fn publish_central_masters(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let published = branch_service::publish_central_masters(&state.db, &tenant_id).await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.masters.published",
        json!({"published": published}),
    )
    .await;
    Ok(Json(ApiResponse::ok(json!({"published": published}))))
}

async fn generate_royalties(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<RoyaltyGenerateRequest>,
) -> ApiResult<serde_json::Value> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let period_start = NaiveDate::parse_from_str(payload.period_start.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("royalty periodStart is invalid"))?;
    let generated =
        branch_service::generate_royalties(&state.db, &tenant_id, &claims.sub, period_start)
            .await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.royalties.generated",
        json!({"periodStart": period_start, "generated": generated}),
    )
    .await;
    Ok(Json(ApiResponse::ok(json!({"generated": generated}))))
}

async fn pay_royalty(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<RoyaltyPaymentRequest>,
) -> ApiResult<crate::repositories::branch_repository::RoyaltyStatementRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let statement = branch_service::pay_royalty(
        &state.db,
        &tenant_id,
        &claims.sub,
        &id,
        &payload.payment_method,
    )
    .await?;
    audit_franchise(
        &state,
        &claims,
        &current_branch_id,
        "franchise.royalty.paid",
        json!({"statementId": statement.id, "branchId": statement.branch_id}),
    )
    .await;
    Ok(Json(ApiResponse::ok(statement)))
}

async fn list(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BranchListQuery>,
) -> ApiResult<Vec<BranchRecord>> {
    require_branch_access(&claims, false)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let branches = branch_service::list(&state.db, &tenant_id, query.q.as_deref()).await?;
    Ok(Json(ApiResponse::ok(branches)))
}

async fn create(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BranchCreateRequest>,
) -> ApiResult<BranchRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let branch = branch_service::create(
        &state.db,
        &tenant_id,
        payload.name,
        payload.code,
        payload.region_name,
        payload.zone_name,
        payload.cluster_name,
        payload.address,
        payload.latitude,
        payload.longitude,
        payload.booking_deposit_percent,
    )
    .await?;
    audit(
        &state,
        &claims,
        &current_branch_id,
        "branch.created",
        &branch,
    )
    .await;
    Ok(Json(ApiResponse::ok(branch)))
}

async fn update(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<BranchUpdateRequest>,
) -> ApiResult<BranchRecord> {
    require_branch_access(&claims, true)?;
    let (tenant_id, current_branch_id) = tenant_branch(&headers)?;
    let branch = branch_service::update(
        &state.db,
        &tenant_id,
        &current_branch_id,
        &id,
        branch_service::BranchUpdateInput {
            name: payload.name,
            code: payload.code,
            region_name: payload.region_name,
            zone_name: payload.zone_name,
            cluster_name: payload.cluster_name,
            address: payload.address,
            latitude: payload.latitude,
            longitude: payload.longitude,
            booking_deposit_percent: payload.booking_deposit_percent,
            active: payload.active,
        },
    )
    .await?;
    audit(
        &state,
        &claims,
        &current_branch_id,
        "branch.updated",
        &branch,
    )
    .await;
    Ok(Json(ApiResponse::ok(branch)))
}

fn require_branch_access(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    if branch_access_allowed(&claims.role, &claims.permissions, write) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "branch management permission is required",
        ))
    }
}

fn branch_access_allowed(role: &str, permissions: &[String], write: bool) -> bool {
    role.eq_ignore_ascii_case("owner")
        || permissions.iter().any(|permission| {
            if write {
                matches!(permission.as_str(), "settings.manage" | "management.write")
            } else {
                matches!(
                    permission.as_str(),
                    "settings.read" | "settings.manage" | "tenant.read"
                )
            }
        })
}

async fn audit(
    state: &AppState,
    claims: &AuthClaims,
    current_branch_id: &str,
    event_type: &'static str,
    branch: &BranchRecord,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &claims.tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(current_branch_id),
            identity: None,
            event_type,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({
                "managedBranchId": branch.id,
                "code": branch.code,
                "regionName": branch.region_name,
                "zoneName": branch.zone_name,
                "clusterName": branch.cluster_name,
                "bookingDepositPercent": branch.booking_deposit_percent,
                "active": branch.active,
            }),
        },
    )
    .await;
}

async fn audit_franchise(
    state: &AppState,
    claims: &AuthClaims,
    current_branch_id: &str,
    event_type: &'static str,
    details: serde_json::Value,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &claims.tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(current_branch_id),
            identity: None,
            event_type,
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details,
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::branch_access_allowed;

    #[test]
    fn branch_access_matches_route_permission_mapping() {
        assert!(branch_access_allowed("Owner", &[], true));
        assert!(branch_access_allowed(
            "Regional Lead",
            &["settings.read".into()],
            false
        ));
        assert!(!branch_access_allowed(
            "Regional Lead",
            &["settings.read".into()],
            true
        ));
        assert!(branch_access_allowed(
            "Regional Lead",
            &["settings.manage".into()],
            true
        ));
    }
}
