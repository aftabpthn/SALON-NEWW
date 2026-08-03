use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository,
        pos_enterprise_repository::RiskCase,
        security_repository::{
            AuditChainStatus, DisclosureReportRecord, FieldAuditRecord, FraudWarningRecord,
            IncidentPlaybookRecord, PrivacyRequestRecord, SecurityAccessRuleRecord,
            SecurityAlertRecord, SecurityApprovalRecord, SecurityAuditRecord, SecurityBlockRecord,
            SecurityDeviceRecord, SecuritySessionRecord, TemporaryElevationRecord,
            WebauthnCredentialRecord,
        },
        sso_repository,
    },
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims, client_export_governance_service, pos_enterprise_service,
        security_service, sso_service, staff_service, webauthn_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/security/summary", get(summary))
        .route("/security/audit", get(list_audit).post(record_audit))
        .route("/security/field-audit", get(list_field_audit))
        .route("/security/client-exports", get(list_client_exports))
        .route("/security/client-exports/usage", get(client_export_usage))
        .route("/security/audit-chain/verify", get(verify_audit_chain))
        .route("/security/audit-chain/seal", post(seal_audit_chain))
        .route("/security/sessions", get(list_sessions))
        .route(
            "/security/sessions/:session_id/revoke",
            patch(revoke_session),
        )
        .route("/security/devices", get(list_devices))
        .route("/security/devices/trust", post(trust_device))
        .route("/security/devices/revoke", post(revoke_device))
        .route(
            "/security/devices/sign-out-all",
            post(sign_out_user_devices),
        )
        .route("/security/permission-matrix", get(permission_matrix))
        .route("/security/policy", get(get_policy).put(save_policy))
        .route("/settings/security", get(get_policy).put(save_policy))
        .route(
            "/security/privileged-session",
            get(privileged_session_status),
        )
        .route(
            "/security/privileged-session/verify",
            post(verify_privileged_session),
        )
        .route(
            "/security/privileged-session/revoke",
            post(revoke_privileged_session),
        )
        .route(
            "/security/approvals",
            get(list_approvals).post(create_approval),
        )
        .route(
            "/security/approvals/:approval_id/approve",
            post(approve_approval),
        )
        .route(
            "/security/approvals/:approval_id/reject",
            post(reject_approval),
        )
        .route(
            "/security/access-rules",
            get(list_access_rules).post(create_access_rule),
        )
        .route(
            "/security/access-rules/:rule_id/disable",
            post(disable_access_rule),
        )
        .route("/security/elevations", get(list_elevations))
        .route(
            "/security/elevations/request",
            post(request_temporary_elevation),
        )
        .route(
            "/security/elevations/:elevation_id/revoke",
            post(revoke_temporary_elevation),
        )
        .route("/security/break-glass", post(activate_break_glass))
        .route("/security/permission-simulator", post(simulate_permissions))
        .route(
            "/security/playbooks",
            get(list_incident_playbooks).post(create_incident_playbook),
        )
        .route(
            "/security/playbooks/:playbook_id/disable",
            post(disable_incident_playbook),
        )
        .route(
            "/security/privacy-requests",
            get(list_privacy_requests).post(create_privacy_request),
        )
        .route(
            "/security/privacy-requests/:request_id/resolve",
            post(resolve_privacy_request),
        )
        .route(
            "/security/privacy-requests/:request_id/approve-deletion",
            post(approve_privacy_deletion),
        )
        .route(
            "/security/privacy-requests/:request_id/execute-deletion",
            post(execute_privacy_deletion),
        )
        .route("/security/data-governance", get(data_governance))
        .route(
            "/security/data-governance/retention-policies/:record_class",
            axum::routing::put(save_retention_policy),
        )
        .route(
            "/security/data-governance/legal-holds",
            post(create_legal_hold),
        )
        .route(
            "/security/data-governance/legal-holds/:hold_id/release",
            post(release_legal_hold),
        )
        .route("/security/pii-exports", post(request_pii_export))
        .route(
            "/security/pii-exports/:export_id/decision",
            post(decide_pii_export),
        )
        .route(
            "/security/pii-exports/:export_id/download",
            post(download_pii_export),
        )
        .route(
            "/security/compliance-evidence/:framework/:control_key",
            axum::routing::put(save_compliance_evidence),
        )
        .route("/security/pen-test-findings", post(create_pen_test_finding))
        .route(
            "/security/pen-test-findings/:finding_id",
            patch(update_pen_test_finding),
        )
        .route(
            "/security/disclosure-reports",
            get(list_disclosure_reports).post(create_disclosure_report),
        )
        .route(
            "/security/disclosure-reports/:report_id/resolve",
            post(resolve_disclosure_report),
        )
        .route("/security/alerts", get(list_alerts))
        .route("/security/alerts/:alert_id/resolve", post(resolve_alert))
        .route("/security/blocklist", get(list_blocks))
        .route("/security/blocklist/:block_id/unblock", post(unblock))
        .route(
            "/security/fraud-risks",
            get(list_fraud_risks).post(scan_fraud_risks),
        )
        .route(
            "/security/fraud-warnings",
            get(list_fraud_warnings).post(create_fraud_warning),
        )
        .route("/security/compliance", get(compliance))
        .route(
            "/security/compliance-evidence/export",
            get(export_compliance_evidence),
        )
        .route(
            "/security/scim-token",
            get(scim_token_status)
                .post(rotate_scim_token)
                .delete(revoke_scim_token),
        )
        .route("/security/sso-policy", get(sso_policy).put(save_sso_policy))
        .route("/auth/mfa/status", get(mfa_status))
        .route("/auth/mfa/setup", post(setup_mfa))
        .route("/auth/mfa/enable", post(enable_mfa))
        .route("/auth/mfa/disable", post(disable_mfa))
        .route("/auth/webauthn/credentials", get(list_passkeys))
        .route(
            "/auth/webauthn/credentials/:credential_id",
            axum::routing::delete(delete_passkey),
        )
        .route(
            "/auth/webauthn/register/begin",
            post(begin_passkey_registration),
        )
        .route(
            "/auth/webauthn/register/finish",
            post(finish_passkey_registration),
        )
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListQuery {
    q: Option<String>,
    status: Option<String>,
    field: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditRequest {
    action: String,
    #[serde(default = "empty_object")]
    details: Value,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PolicyPayload {
    Direct(security_service::SecurityPolicy),
    Wrapped {
        settings: security_service::SecurityPolicy,
    },
}

#[derive(Serialize)]
struct AuditList {
    events: Vec<SecurityAuditRecord>,
}

#[derive(Serialize)]
struct FieldAuditList {
    events: Vec<FieldAuditRecord>,
}

#[derive(Serialize)]
struct SessionList {
    sessions: Vec<SecuritySessionRecord>,
}

#[derive(Serialize)]
struct DeviceList {
    devices: Vec<SecurityDeviceRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceRequest {
    user_id: String,
    device_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserDevicesRequest {
    user_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivilegedSessionVerifyRequest {
    #[serde(default)]
    mfa_code: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    action_scope: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignOutDevicesResult {
    revoked_sessions: u64,
}

#[derive(Serialize)]
struct AlertList {
    alerts: Vec<SecurityAlertRecord>,
}

#[derive(Serialize)]
struct BlockList {
    blocks: Vec<SecurityBlockRecord>,
}

#[derive(Serialize)]
struct FraudRiskList {
    risks: Vec<RiskCase>,
}

#[derive(Serialize)]
struct FraudWarningList {
    warnings: Vec<FraudWarningRecord>,
}

#[derive(Serialize)]
struct ApprovalList {
    approvals: Vec<SecurityApprovalRecord>,
}

#[derive(Serialize)]
struct AccessRuleList {
    rules: Vec<SecurityAccessRuleRecord>,
}

#[derive(Serialize)]
struct IncidentPlaybookList {
    playbooks: Vec<IncidentPlaybookRecord>,
}

#[derive(Serialize)]
struct PrivacyRequestList {
    requests: Vec<PrivacyRequestRecord>,
}

#[derive(Serialize)]
struct DisclosureReportList {
    reports: Vec<DisclosureReportRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalCreateRequest {
    action_type: String,
    summary: String,
    #[serde(default = "empty_object")]
    details: Value,
}

#[derive(Default, Deserialize)]
struct ApprovalDecisionRequest {
    note: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessRuleCreateRequest {
    #[serde(default)]
    rule_type: Option<String>,
    match_value: String,
    effect: String,
    #[serde(default)]
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ElevationRequest {
    user_id: String,
    permissions: Vec<String>,
    duration_minutes: i64,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BreakGlassRequest {
    permissions: Vec<String>,
    duration_minutes: i64,
    reason: String,
}

#[derive(Serialize)]
struct ElevationList {
    elevations: Vec<TemporaryElevationRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionSimulationRequest {
    user_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IncidentPlaybookCreateRequest {
    playbook_key: String,
    title: String,
    severity: String,
    checklist: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivacyRequestCreateRequest {
    #[serde(default = "default_subject_type")]
    subject_type: String,
    #[serde(default)]
    subject_id: String,
    request_type: String,
    summary: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveRequest {
    #[serde(default)]
    resolution_note: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RetentionPolicyRequest {
    retention_days: i32,
    disposition: String,
    legal_basis: String,
    owner_user_id: String,
    version: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegalHoldRequest {
    subject_type: String,
    subject_id: String,
    reason: String,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiiExportRequest {
    #[serde(default)]
    subject_id: String,
    row_limit: i32,
    reason: String,
    mfa_code: Option<String>,
}

#[derive(Deserialize)]
struct PiiExportDecisionRequest {
    decision: String,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiiExportDownloadRequest {
    download_token: String,
    mfa_code: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MfaReauthenticationRequest {
    mfa_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceEvidenceRequest {
    title: String,
    owner_user_id: String,
    status: String,
    #[serde(default)]
    evidence_reference: String,
    #[serde(default)]
    independent_assessor: String,
    valid_until: Option<String>,
    #[serde(default)]
    notes: String,
    version: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PenTestFindingRequest {
    title: String,
    severity: String,
    status: String,
    owner_user_id: String,
    #[serde(default)]
    remediation_note: String,
    #[serde(default)]
    risk_acceptance_reason: String,
    risk_acceptance_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    version: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisclosureReportCreateRequest {
    #[serde(default)]
    reporter_name: String,
    #[serde(default)]
    reporter_contact: String,
    summary: String,
    #[serde(default)]
    details: String,
    #[serde(default = "default_warning_severity")]
    severity: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FraudRiskScanRequest {
    business_date: String,
}

#[derive(Deserialize)]
struct FraudWarningRequest {
    title: String,
    message: String,
    severity: String,
}

#[derive(Serialize)]
struct MutationResult {
    updated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScimTokenRotation {
    token: String,
    status: sso_repository::ScimTokenStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SsoPolicyRequest {
    google_enabled: bool,
    microsoft_enabled: bool,
    saml_enabled: bool,
    #[serde(default)]
    enforced_roles: Vec<String>,
}

#[derive(Deserialize)]
struct MfaCodeRequest {
    code: String,
}

#[derive(Deserialize)]
struct PasskeyRegistrationStartRequest {
    label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyRegistrationFinishRequest {
    challenge_id: String,
    credential: passkey_auth::RegistrationResponse,
}

#[derive(Serialize)]
struct PasskeyList {
    credentials: Vec<WebauthnCredentialRecord>,
}

async fn list_passkeys(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<PasskeyList> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(PasskeyList {
        credentials: webauthn_service::list_credentials(&state.db, &tenant_id, &claims.sub).await?,
    })))
}

async fn begin_passkey_registration(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyRegistrationStartRequest>,
) -> ApiResult<webauthn_service::RegistrationStart> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    let user = auth_repository::find_user_by_id(&state.db, &tenant_id, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
    let user_name = user.login_id.as_deref().unwrap_or(&user.email);
    Ok(Json(ApiResponse::ok(
        webauthn_service::begin_registration(
            &state.db,
            &state.settings,
            &tenant_id,
            &claims.sub,
            user_name,
            &payload.label,
        )
        .await?,
    )))
}

async fn finish_passkey_registration(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyRegistrationFinishRequest>,
) -> ApiResult<WebauthnCredentialRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let credential = webauthn_service::finish_registration(
        &state.db,
        &state.settings,
        &tenant_id,
        &claims.sub,
        &payload.challenge_id,
        payload.credential,
    )
    .await?;
    let _ = security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "passkey.registered",
        serde_json::json!({ "credentialId": credential.credential_id }),
    )
    .await;
    Ok(Json(ApiResponse::ok(credential)))
}

async fn delete_passkey(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(credential_id): Path<String>,
) -> ApiResult<MutationResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    webauthn_service::delete_credential(&state.db, &tenant_id, &claims.sub, &credential_id).await?;
    let _ = security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "passkey.deleted",
        serde_json::json!({ "credentialId": credential_id }),
    )
    .await;
    Ok(Json(ApiResponse::ok(MutationResult { updated: true })))
}

async fn mfa_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::MfaStatus> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    let mut status = security_service::mfa_status(&state.db, &tenant_id, &claims.sub).await?;
    status.required = security_service::scope_requires_mfa(&claims.role, &claims.permissions);
    Ok(Json(ApiResponse::ok(status)))
}

async fn setup_mfa(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::MfaSetup> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let setup = security_service::setup_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &claims.sub,
    )
    .await?;
    let _ = security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "mfa.setup.started",
        serde_json::json!({}),
    )
    .await;
    Ok(Json(ApiResponse::ok(setup)))
}

async fn enable_mfa(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MfaCodeRequest>,
) -> ApiResult<security_service::MfaEnableResult> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = security_service::enable_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &claims.sub,
        payload.code.trim(),
    )
    .await?;
    let _ = security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "mfa.enabled",
        serde_json::json!({}),
    )
    .await;
    Ok(Json(ApiResponse::ok(result)))
}

async fn disable_mfa(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<MfaCodeRequest>,
) -> ApiResult<security_service::MfaDisableResult> {
    if security_service::scope_requires_mfa(&claims.role, &claims.permissions) {
        return Err(AppError::forbidden("MFA is required for this role"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = security_service::disable_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &claims.sub,
        payload.code.trim(),
    )
    .await?;
    let _ = security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "mfa.disabled",
        serde_json::json!({}),
    )
    .await;
    Ok(Json(ApiResponse::ok(result)))
}

async fn summary(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::SecuritySummary> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::summary(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn list_audit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<AuditList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(AuditList {
        events: security_service::list_audit(
            &state.db,
            &tenant_id,
            &branch_id,
            query.q.as_deref().unwrap_or_default(),
        )
        .await?,
    })))
}

async fn list_field_audit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<FieldAuditList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(FieldAuditList {
        events: security_service::list_field_audit(
            &state.db,
            &tenant_id,
            &branch_id,
            query
                .field
                .as_deref()
                .or(query.q.as_deref())
                .unwrap_or_default(),
        )
        .await?,
    })))
}

async fn verify_audit_chain(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<AuditChainStatus> {
    require_security_read(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::verify_audit_chain(&state.db, &tenant_id).await?,
    )))
}

async fn seal_audit_chain(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<AuditChainStatus> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::seal_audit_chain(&state.db, &tenant_id, &branch_id, &claims.sub).await?,
    )))
}

async fn record_audit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<AuditRequest>,
) -> ApiResult<MutationResult> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &payload.action,
        payload.details,
    )
    .await?;
    Ok(Json(ApiResponse::ok(MutationResult { updated: true })))
}

async fn list_sessions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<SessionList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(SessionList {
        sessions: security_service::list_sessions(&state.db, &tenant_id, &branch_id).await?,
    })))
}

async fn revoke_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> ApiResult<MutationResult> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::revoke_session(&state.db, &tenant_id, &branch_id, &claims.sub, &session_id)
        .await?;
    Ok(Json(ApiResponse::ok(MutationResult { updated: true })))
}

async fn list_devices(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<DeviceList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(DeviceList {
        devices: security_service::list_devices(&state.db, &tenant_id, &branch_id).await?,
    })))
}

async fn trust_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<DeviceRequest>,
) -> ApiResult<SecurityDeviceRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::trust_device(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.user_id,
            &payload.device_id,
        )
        .await?,
    )))
}

async fn revoke_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<DeviceRequest>,
) -> ApiResult<SecurityDeviceRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::revoke_device(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.user_id,
            &payload.device_id,
        )
        .await?,
    )))
}

async fn sign_out_user_devices(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<UserDevicesRequest>,
) -> ApiResult<SignOutDevicesResult> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let revoked_sessions = security_service::sign_out_user_devices(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &payload.user_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(SignOutDevicesResult {
        revoked_sessions,
    })))
}

async fn permission_matrix(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<staff_service::AuthRoleManagementData> {
    require_security_read(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_service::load_auth_roles(&state.db, &tenant_id).await?,
    )))
}

async fn privileged_session_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::PrivilegedSessionStatus> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::privileged_session_status(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.session_id,
            None,
        )
        .await?,
    )))
}

async fn verify_privileged_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PrivilegedSessionVerifyRequest>,
) -> ApiResult<security_service::PrivilegedSessionStatus> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::verify_privileged_session(
            &state.db,
            state.settings.security_encryption_key.as_deref(),
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.session_id,
            payload.mfa_code.as_deref(),
            payload.password.as_deref(),
            payload.action_scope.as_deref(),
        )
        .await?,
    )))
}

async fn revoke_privileged_session(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::PrivilegedSessionStatus> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::revoke_privileged_session(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.session_id,
        )
        .await?,
    )))
}

async fn list_approvals(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<ApprovalList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(ApprovalList {
        approvals: security_service::list_approvals(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("all"),
        )
        .await?,
    })))
}

async fn create_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ApprovalCreateRequest>,
) -> ApiResult<SecurityApprovalRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.action_type,
            &payload.summary,
            payload.details,
        )
        .await?,
    )))
}

async fn approve_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(approval_id): Path<String>,
    Json(payload): Json<ApprovalDecisionRequest>,
) -> ApiResult<SecurityApprovalRecord> {
    decide_approval(state, claims, headers, approval_id, payload, "approved").await
}

async fn reject_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(approval_id): Path<String>,
    Json(payload): Json<ApprovalDecisionRequest>,
) -> ApiResult<SecurityApprovalRecord> {
    decide_approval(state, claims, headers, approval_id, payload, "rejected").await
}

async fn decide_approval(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    approval_id: String,
    payload: ApprovalDecisionRequest,
    decision: &str,
) -> ApiResult<SecurityApprovalRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::decide_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &approval_id,
            decision,
            payload.note.as_deref(),
        )
        .await?,
    )))
}

async fn list_access_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<AccessRuleList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(AccessRuleList {
        rules: security_service::list_access_rules(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("all"),
        )
        .await?,
    })))
}

async fn create_access_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<AccessRuleCreateRequest>,
) -> ApiResult<SecurityAccessRuleRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_access_rule(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            payload.rule_type.as_deref().unwrap_or("ip"),
            &payload.match_value,
            &payload.effect,
            &payload.reason,
        )
        .await?,
    )))
}

async fn disable_access_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(rule_id): Path<String>,
) -> ApiResult<SecurityAccessRuleRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::disable_access_rule(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &rule_id,
        )
        .await?,
    )))
}

async fn list_elevations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<ElevationList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(ElevationList {
        elevations: security_service::list_temporary_elevations(&state.db, &tenant_id, &branch_id)
            .await?,
    })))
}

async fn request_temporary_elevation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ElevationRequest>,
) -> ApiResult<SecurityApprovalRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::request_temporary_elevation(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.user_id,
            payload.permissions,
            payload.duration_minutes,
            &payload.reason,
        )
        .await?,
    )))
}

async fn revoke_temporary_elevation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(elevation_id): Path<String>,
) -> ApiResult<TemporaryElevationRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::revoke_temporary_elevation(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &elevation_id,
        )
        .await?,
    )))
}

async fn activate_break_glass(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BreakGlassRequest>,
) -> ApiResult<TemporaryElevationRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::activate_break_glass(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.session_id,
            &claims.role,
            payload.permissions,
            payload.duration_minutes,
            &payload.reason,
        )
        .await?,
    )))
}

async fn simulate_permissions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PermissionSimulationRequest>,
) -> ApiResult<security_service::PermissionSimulation> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::simulate_permissions(&state.db, &tenant_id, &branch_id, &payload.user_id)
            .await?,
    )))
}

async fn list_incident_playbooks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<IncidentPlaybookList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(IncidentPlaybookList {
        playbooks: security_service::list_incident_playbooks(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("all"),
        )
        .await?,
    })))
}

async fn create_incident_playbook(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<IncidentPlaybookCreateRequest>,
) -> ApiResult<IncidentPlaybookRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_incident_playbook(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.playbook_key,
            &payload.title,
            &payload.severity,
            payload.checklist,
        )
        .await?,
    )))
}

async fn disable_incident_playbook(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(playbook_id): Path<String>,
) -> ApiResult<IncidentPlaybookRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::disable_incident_playbook(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &playbook_id,
        )
        .await?,
    )))
}

async fn list_privacy_requests(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<PrivacyRequestList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(PrivacyRequestList {
        requests: security_service::list_privacy_requests(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("all"),
        )
        .await?,
    })))
}

async fn create_privacy_request(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PrivacyRequestCreateRequest>,
) -> ApiResult<PrivacyRequestRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_privacy_request(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.subject_type,
            &payload.subject_id,
            &payload.request_type,
            &payload.summary,
        )
        .await?,
    )))
}

async fn resolve_privacy_request(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<ResolveRequest>,
) -> ApiResult<PrivacyRequestRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::resolve_privacy_request(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &request_id,
            &payload.resolution_note,
        )
        .await?,
    )))
}

async fn data_governance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::data_governance_snapshot(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_retention_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(record_class): Path<String>,
    Json(payload): Json<RetentionPolicyRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::save_retention_policy(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &record_class,
            payload.retention_days,
            &payload.disposition,
            &payload.legal_basis,
            &payload.owner_user_id,
            payload.version,
        )
        .await?,
    )))
}

async fn create_legal_hold(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<LegalHoldRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_legal_hold(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.subject_type,
            &payload.subject_id,
            &payload.reason,
            payload.expires_at,
        )
        .await?,
    )))
}

async fn release_legal_hold(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(hold_id): Path<String>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::release_legal_hold(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &hold_id,
        )
        .await?,
    )))
}

async fn request_pii_export(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PiiExportRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    if !claims.masked_fields.is_empty() {
        return Err(AppError::forbidden(
            "roles with field masking cannot request PII exports",
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
        "pii.export",
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        security_service::request_pii_export(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.subject_id,
            payload.row_limit,
            &payload.reason,
        )
        .await?,
    )))
}

async fn decide_pii_export(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(export_id): Path<String>,
    Json(payload): Json<PiiExportDecisionRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    if !claims.masked_fields.is_empty() {
        return Err(AppError::forbidden(
            "roles with field masking cannot approve PII exports",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::decide_pii_export(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &export_id,
            &payload.decision,
            &payload.note,
        )
        .await?,
    )))
}

async fn download_pii_export(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(export_id): Path<String>,
    Json(payload): Json<PiiExportDownloadRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    if !claims.masked_fields.is_empty() {
        return Err(AppError::forbidden(
            "roles with field masking cannot download PII exports",
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
        "pii.export.download",
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        security_service::download_pii_export(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &export_id,
            &payload.download_token,
        )
        .await?,
    )))
}

async fn approve_privacy_deletion(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
) -> ApiResult<PrivacyRequestRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::approve_privacy_deletion(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &request_id,
        )
        .await?,
    )))
}

async fn execute_privacy_deletion(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<MfaReauthenticationRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "privacy.deletion",
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        security_service::execute_privacy_deletion(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &request_id,
        )
        .await?,
    )))
}

async fn save_compliance_evidence(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((framework, control_key)): Path<(String, String)>,
    Json(payload): Json<ComplianceEvidenceRequest>,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::save_compliance_evidence(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &framework,
            &control_key,
            &payload.title,
            &payload.owner_user_id,
            &payload.status,
            &payload.evidence_reference,
            &payload.independent_assessor,
            payload.valid_until.as_deref(),
            &payload.notes,
            payload.version,
        )
        .await?,
    )))
}

async fn create_pen_test_finding(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PenTestFindingRequest>,
) -> ApiResult<Value> {
    save_pen_test_finding(state, claims, headers, None, payload).await
}

async fn update_pen_test_finding(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(finding_id): Path<String>,
    Json(payload): Json<PenTestFindingRequest>,
) -> ApiResult<Value> {
    save_pen_test_finding(state, claims, headers, Some(finding_id), payload).await
}

async fn save_pen_test_finding(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    finding_id: Option<String>,
    payload: PenTestFindingRequest,
) -> ApiResult<Value> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::save_pen_test_finding(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            finding_id.as_deref(),
            &payload.title,
            &payload.severity,
            &payload.status,
            &payload.owner_user_id,
            &payload.remediation_note,
            &payload.risk_acceptance_reason,
            payload.risk_acceptance_expires_at,
            payload.version,
        )
        .await?,
    )))
}

async fn list_disclosure_reports(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<DisclosureReportList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(DisclosureReportList {
        reports: security_service::list_disclosure_reports(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("all"),
        )
        .await?,
    })))
}

async fn create_disclosure_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<DisclosureReportCreateRequest>,
) -> ApiResult<DisclosureReportRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_disclosure_report(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.reporter_name,
            &payload.reporter_contact,
            &payload.summary,
            &payload.details,
            &payload.severity,
        )
        .await?,
    )))
}

async fn resolve_disclosure_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(report_id): Path<String>,
    Json(payload): Json<ResolveRequest>,
) -> ApiResult<DisclosureReportRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::resolve_disclosure_report(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &report_id,
            &payload.resolution_note,
        )
        .await?,
    )))
}

async fn get_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::SecurityPolicyView> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::get_policy(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PolicyPayload>,
) -> ApiResult<security_service::SecurityPolicyView> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let policy = match payload {
        PolicyPayload::Direct(policy) | PolicyPayload::Wrapped { settings: policy } => policy,
    };
    Ok(Json(ApiResponse::ok(
        security_service::save_policy(&state.db, &tenant_id, &branch_id, &claims.sub, policy)
            .await?,
    )))
}

async fn list_alerts(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<AlertList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(AlertList {
        alerts: security_service::list_alerts(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("open"),
        )
        .await?,
    })))
}

async fn resolve_alert(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(alert_id): Path<String>,
) -> ApiResult<SecurityAlertRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::resolve_alert(&state.db, &tenant_id, &branch_id, &claims.sub, &alert_id)
            .await?,
    )))
}

async fn list_blocks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> ApiResult<BlockList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(BlockList {
        blocks: security_service::list_blocks(
            &state.db,
            &tenant_id,
            &branch_id,
            query.status.as_deref().unwrap_or("active"),
        )
        .await?,
    })))
}

async fn unblock(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(block_id): Path<String>,
) -> ApiResult<SecurityBlockRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::unblock(
            &state.db,
            &state.redis,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &block_id,
        )
        .await?,
    )))
}

async fn list_fraud_risks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<FraudRiskList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let risks = crate::repositories::pos_enterprise_repository::list_risk_cases(
        &state.db, &tenant_id, &branch_id, "open",
    )
    .await
    .map_err(|_| AppError::internal("failed to load fraud risks"))?;
    Ok(Json(ApiResponse::ok(FraudRiskList { risks })))
}

async fn scan_fraud_risks(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<FraudRiskScanRequest>,
) -> ApiResult<FraudRiskList> {
    require_security_manage(&claims)?;
    let date = NaiveDate::parse_from_str(payload.business_date.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation("businessDate must use YYYY-MM-DD"))?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let risks = pos_enterprise_service::scan_risks(&state.db, &tenant_id, &branch_id, date).await?;
    Ok(Json(ApiResponse::ok(FraudRiskList { risks })))
}

async fn list_fraud_warnings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<FraudWarningList> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(FraudWarningList {
        warnings: security_service::list_fraud_warnings(&state.db, &tenant_id, &branch_id).await?,
    })))
}

async fn create_fraud_warning(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<FraudWarningRequest>,
) -> ApiResult<FraudWarningRecord> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::create_fraud_warning(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &payload.title,
            &payload.message,
            &payload.severity,
        )
        .await?,
    )))
}

async fn compliance(
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<security_service::ComplianceSummary> {
    require_security_read(&claims)?;
    Ok(Json(ApiResponse::ok(security_service::compliance())))
}

async fn export_compliance_evidence(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<security_service::ComplianceEvidenceExport> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        security_service::export_compliance_evidence(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
        )
        .await?,
    )))
}

async fn scim_token_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<sso_repository::ScimTokenStatus> {
    require_security_read(&claims)?;
    let status = sso_repository::scim_token_status(&state.db, &claims.tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load SCIM token status"))?;
    Ok(Json(ApiResponse::ok(status)))
}

async fn sso_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<sso_service::SsoPolicyView> {
    require_security_read(&claims)?;
    Ok(Json(ApiResponse::ok(
        sso_service::policy_view(&state.db, &state.settings, &claims.tenant_id).await?,
    )))
}

async fn save_sso_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SsoPolicyRequest>,
) -> ApiResult<sso_service::SsoPolicyView> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let policy = sso_service::save_policy(
        &state.db,
        &state.settings,
        &tenant_id,
        &claims.sub,
        payload.google_enabled,
        payload.microsoft_enabled,
        payload.saml_enabled,
        &payload.enforced_roles,
    )
    .await?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "sso_policy.saved",
        serde_json::json!({
            "googleEnabled": policy.google_enabled,
            "microsoftEnabled": policy.microsoft_enabled,
            "samlEnabled": policy.saml_enabled,
            "enforcedRoles": &policy.enforced_roles,
        }),
    )
    .await?;
    Ok(Json(ApiResponse::ok(policy)))
}

async fn rotate_scim_token(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<ScimTokenRotation> {
    require_security_manage(&claims)?;
    let token = format!("ascim_{}", sso_service::random_token(32));
    let last_four = token
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    sso_repository::rotate_scim_token(
        &state.db,
        &claims.tenant_id,
        &sso_service::token_hash(&token),
        &last_four,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to rotate SCIM token"))?;
    let status = sso_repository::scim_token_status(&state.db, &claims.tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load SCIM token status"))?;
    Ok(Json(ApiResponse::ok(ScimTokenRotation { token, status })))
}

async fn revoke_scim_token(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
) -> ApiResult<MutationResult> {
    require_security_manage(&claims)?;
    sso_repository::revoke_scim_token(&state.db, &claims.tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to revoke SCIM token"))?;
    Ok(Json(ApiResponse::ok(MutationResult { updated: true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportHistoryQuery {
    limit: Option<i64>,
}

/// Who exported client data, when, how much, and under what filter.
///
/// The master client audit records changes; this records reads in bulk, which
/// is the half that was missing and the half an insider uses.
async fn list_client_exports(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ExportHistoryQuery>,
) -> ApiResult<Vec<Value>> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let events = client_export_governance_service::history(
        &state.db,
        &tenant_id,
        &branch_id,
        query.limit.unwrap_or(100),
    )
    .await?;
    Ok(Json(ApiResponse::ok(events)))
}

/// The caller's own standing against today's budget.
///
/// Deliberately not gated on security.read: a user is entitled to know the
/// limit they are working against before they hit it.
async fn client_export_usage(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<client_export_governance_service::ExportUsage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let usage =
        client_export_governance_service::usage(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(usage)))
}

pub(crate) fn require_security_read(claims: &AuthClaims) -> Result<(), AppError> {
    if security_role(claims)
        || claims
            .permissions
            .iter()
            .any(|permission| matches!(permission.as_str(), "security.read" | "security.manage"))
    {
        Ok(())
    } else {
        Err(AppError::forbidden("security read permission is required"))
    }
}

pub(crate) fn require_security_manage(claims: &AuthClaims) -> Result<(), AppError> {
    if security_role(claims)
        || claims
            .permissions
            .iter()
            .any(|permission| permission == "security.manage")
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "security management permission is required",
        ))
    }
}

fn security_role(claims: &AuthClaims) -> bool {
    ["owner", "admin", "superadmin", "super-admin"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
}

fn empty_object() -> Value {
    serde_json::json!({})
}

fn default_subject_type() -> String {
    "client".to_string()
}

fn default_warning_severity() -> String {
    "warning".to_string()
}

#[cfg(test)]
mod tests {
    use super::{require_security_manage, require_security_read};
    use crate::services::auth_service::AuthClaims;

    fn claims(role: &str, permissions: &[&str]) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: role.into(),
            role_id: None,
            permissions: permissions.iter().map(|value| value.to_string()).collect(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            mfa_enrollment_required: false,
            session_id: "session-1".into(),
            token_type: "access".into(),
            jti: "token-1".into(),
            iat: 1,
            exp: usize::MAX,
        }
    }

    #[test]
    fn security_access_is_admin_or_explicit_permission_only() {
        assert!(require_security_manage(&claims("owner", &[])).is_ok());
        assert!(require_security_manage(&claims("super-admin", &[])).is_ok());
        assert!(require_security_read(&claims("custom", &["security.read"])).is_ok());
        assert!(require_security_manage(&claims("custom", &["security.manage"])).is_ok());
        assert!(require_security_manage(&claims("custom", &["security.read"])).is_err());
        assert!(require_security_read(&claims("manager", &[])).is_err());
    }
}
