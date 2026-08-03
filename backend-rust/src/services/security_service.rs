use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use std::{
    collections::{BTreeSet, HashSet},
    net::IpAddr,
};

use crate::{
    infrastructure::cache::RedisClient,
    models::common::AppError,
    repositories::{
        auth_repository::{self, AuthAuditInput},
        security_repository::{
            self, AuditChainStatus, DisclosureReportRecord, FieldAuditRecord, FraudWarningRecord,
            IncidentPlaybookRecord, PrivacyRequestRecord, SecurityAccessRuleRecord,
            SecurityAlertRecord, SecurityApprovalRecord, SecurityAuditRecord, SecurityBlockRecord,
            SecurityDeviceRecord, SecuritySessionRecord, TemporaryElevationRecord,
        },
    },
    services::auth_service,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct SecurityPolicy {
    pub audit_retention_days: i64,
    pub audit_page_size: i64,
    pub session_revocation_enabled: bool,
    pub staff_app_inactivity_minutes: i64,
    pub staff_app_geofence_mode: String,
    pub staff_app_geofence_radius_meters: i64,
    pub staff_app_geofence_exempt_roles: Vec<String>,
    pub staff_contact_verification_required: bool,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            audit_retention_days: 90,
            audit_page_size: 100,
            session_revocation_enabled: true,
            staff_app_inactivity_minutes: 15,
            staff_app_geofence_mode: "full_access".into(),
            staff_app_geofence_radius_meters: 200,
            staff_app_geofence_exempt_roles: Vec::new(),
            staff_contact_verification_required: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPolicyView {
    pub settings: SecurityPolicy,
    pub persisted: bool,
    pub updated_by: Option<String>,
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySummary {
    pub counts: security_repository::SecurityCounts,
    pub policy: SecurityPolicyView,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceSummary {
    pub password_hashing: bool,
    pub refresh_rotation: bool,
    pub server_side_rbac: bool,
    pub tenant_isolation: bool,
    pub append_only_auth_audit: bool,
    pub security_headers: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceEvidenceExport {
    pub bundle_id: String,
    pub generated_at: chrono::DateTime<chrono::Utc>,
    pub tenant_id: String,
    pub branch_id: String,
    pub exported_by: String,
    pub frameworks: [&'static str; 6],
    pub controls: ComplianceSummary,
    pub counts: security_repository::ComplianceEvidenceCounts,
    pub security: security_repository::SecurityCounts,
    pub audit_chain: AuditChainStatus,
    pub governance: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaStatus {
    pub enabled: bool,
    pub required: bool,
    pub pending: bool,
    pub recovery_codes_remaining: usize,
    pub verified_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaSetup {
    pub secret: String,
    pub otp_auth_uri: String,
    pub algorithm: &'static str,
    pub digits: u8,
    pub period: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaEnableResult {
    pub enabled: bool,
    pub recovery_codes: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct MfaDisableResult {
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegedSessionStatus {
    pub active: bool,
    pub user_id: String,
    pub session_id: String,
    pub action_scope: String,
    pub verification_method: Option<String>,
    pub verified_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub ttl_seconds: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRiskAssessment {
    pub score: i32,
    pub level: &'static str,
    pub step_up_required: bool,
    pub signals: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSimulation {
    pub user_id: String,
    pub branch_id: String,
    pub role_name: String,
    pub base_permissions: Vec<String>,
    pub elevated_permissions: Vec<String>,
    pub denied_permissions: Vec<String>,
    pub effective_permissions: Vec<String>,
}

const PRIVILEGED_SESSION_TTL_MINUTES: i64 = 10;
const DEFAULT_PRIVILEGED_SCOPE: &str = "sensitive_action";
const ADAPTIVE_MFA_THRESHOLD: i32 = 70;

pub async fn summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SecuritySummary, AppError> {
    Ok(SecuritySummary {
        counts: security_repository::counts(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load security summary"))?,
        policy: get_policy(db, tenant_id, branch_id).await?,
    })
}

pub async fn get_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SecurityPolicyView, AppError> {
    let record = security_repository::get_settings(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load security settings"))?;
    match record {
        Some(record) => Ok(SecurityPolicyView {
            settings: serde_json::from_value(record.policy_json)
                .map_err(|_| AppError::internal("stored security settings are invalid"))?,
            persisted: true,
            updated_by: Some(record.updated_by),
            updated_at: Some(record.updated_at),
        }),
        None => Ok(SecurityPolicyView {
            settings: SecurityPolicy::default(),
            persisted: false,
            updated_by: None,
            updated_at: None,
        }),
    }
}

pub async fn save_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    policy: SecurityPolicy,
) -> Result<SecurityPolicyView, AppError> {
    validate_policy(&policy)?;
    let record = security_repository::save_settings(
        db,
        tenant_id,
        branch_id,
        serde_json::to_value(&policy)
            .map_err(|_| AppError::internal("failed to serialize security settings"))?,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save security settings"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.policy.updated",
        json!({ "settings": policy }),
    )
    .await;
    Ok(SecurityPolicyView {
        settings: serde_json::from_value(record.policy_json)
            .map_err(|_| AppError::internal("saved security settings are invalid"))?,
        persisted: true,
        updated_by: Some(record.updated_by),
        updated_at: Some(record.updated_at),
    })
}

pub async fn list_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: &str,
) -> Result<Vec<SecurityAuditRecord>, AppError> {
    let policy = get_policy(db, tenant_id, branch_id).await?.settings;
    security_repository::list_audit(
        db,
        tenant_id,
        branch_id,
        query.trim(),
        policy.audit_retention_days,
        policy.audit_page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to load security audit"))
}

pub async fn list_field_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    field_filter: &str,
) -> Result<Vec<FieldAuditRecord>, AppError> {
    security_repository::list_field_audit(db, tenant_id, branch_id, field_filter.trim())
        .await
        .map_err(|_| AppError::internal("failed to load field audit"))
}

#[allow(clippy::too_many_arguments)]
pub async fn record_field_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: Option<&str>,
    actor_user_id: &str,
    entity_type: &str,
    entity_id: &str,
    field_group: &str,
    field_name: &str,
    access_type: &str,
    masking_applied: bool,
    reason: &str,
) -> Result<(), AppError> {
    let branch_id = branch_id.unwrap_or("").trim();
    let entity_type = compact_token(entity_type, 120);
    let entity_id = compact_token(entity_id, 240);
    let field_group = compact_token(field_group, 80);
    let field_name = compact_token(field_name, 80);
    let reason = compact_token(reason, 120);
    if actor_user_id.trim().is_empty()
        || entity_type.is_empty()
        || entity_id.is_empty()
        || field_group.is_empty()
        || field_name.is_empty()
        || !matches!(access_type, "view" | "export" | "mask" | "blocked_export")
    {
        return Err(AppError::validation("invalid field audit event"));
    }
    security_repository::record_field_audit(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        &entity_type,
        &entity_id,
        &field_group,
        &field_name,
        access_type,
        masking_applied,
        &reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to record field audit"))
}

pub async fn verify_audit_chain(
    db: &PgPool,
    tenant_id: &str,
) -> Result<AuditChainStatus, AppError> {
    security_repository::verify_audit_chain(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to verify security audit chain"))
}

pub async fn seal_audit_chain(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
) -> Result<AuditChainStatus, AppError> {
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "audit-chain.sealed",
        json!({}),
    )
    .await?;
    verify_audit_chain(db, tenant_id).await
}

pub async fn record_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    action: &str,
    details: Value,
) -> Result<(), AppError> {
    let action = audit_action(action, &details)?;
    auth_repository::audit(
        db,
        AuthAuditInput {
            tenant_id,
            user_id: Some(actor_id),
            session_id: None,
            branch_id: Some(branch_id),
            identity: None,
            event_type: &format!("security.{action}"),
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to record security audit"))
}

pub async fn record_audit_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    action: &str,
    details: Value,
) -> Result<(), AppError> {
    let action = audit_action(action, &details)?;
    auth_repository::audit_tx(
        tx,
        AuthAuditInput {
            tenant_id,
            user_id: Some(actor_id),
            session_id: None,
            branch_id: Some(branch_id),
            identity: None,
            event_type: &format!("security.{action}"),
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to record security audit"))
}

fn audit_action(action: &str, details: &Value) -> Result<String, AppError> {
    let action = action.trim().to_ascii_lowercase();
    if !(3..=80).contains(&action.len())
        || !action
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
        || !details.is_object()
    {
        return Err(AppError::validation("invalid security audit event"));
    }
    Ok(action)
}

pub async fn list_sessions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SecuritySessionRecord>, AppError> {
    security_repository::list_sessions(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load security sessions"))
}

pub async fn revoke_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    session_id: &str,
) -> Result<(), AppError> {
    if !get_policy(db, tenant_id, branch_id)
        .await?
        .settings
        .session_revocation_enabled
    {
        return Err(AppError::forbidden(
            "session revocation is disabled by policy",
        ));
    }
    let revoked = security_repository::revoke_session(
        db,
        tenant_id,
        branch_id,
        session_id,
        "security_admin_revoked",
    )
    .await
    .map_err(|_| AppError::internal("failed to revoke security session"))?;
    if !revoked {
        return Err(AppError::not_found("active session was not found"));
    }
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.session.revoked",
        json!({ "sessionId": session_id }),
    )
    .await;
    Ok(())
}

pub async fn list_devices(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SecurityDeviceRecord>, AppError> {
    security_repository::list_devices(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load security devices"))
}

pub async fn ensure_device_allowed(
    db: &PgPool,
    tenant_id: &str,
    branch_id: Option<&str>,
    user_id: &str,
    device_id: Option<&str>,
) -> Result<(), AppError> {
    let Some(branch_id) = branch_id else {
        return Ok(());
    };
    let Some(device_id) = clean_device_id(device_id)? else {
        return Ok(());
    };
    let revoked =
        security_repository::device_revoked(db, tenant_id, branch_id, user_id, &device_id)
            .await
            .map_err(|_| AppError::internal("failed to verify device trust"))?;
    if revoked {
        Err(AppError::forbidden("this device has been revoked"))
    } else {
        Ok(())
    }
}

pub async fn trust_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    user_id: &str,
    device_id: &str,
) -> Result<SecurityDeviceRecord, AppError> {
    let device_id = required_device_id(device_id)?;
    let device =
        security_repository::trust_device(db, tenant_id, branch_id, actor_id, user_id, &device_id)
            .await
            .map_err(|_| AppError::internal("failed to trust device"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.device.trusted",
        json!({ "userId": user_id, "deviceId": device.device_id }),
    )
    .await;
    Ok(device)
}

pub async fn revoke_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    user_id: &str,
    device_id: &str,
) -> Result<SecurityDeviceRecord, AppError> {
    let device_id = required_device_id(device_id)?;
    let device =
        security_repository::revoke_device(db, tenant_id, branch_id, actor_id, user_id, &device_id)
            .await
            .map_err(|_| AppError::internal("failed to revoke device"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.device.revoked",
        json!({ "userId": user_id, "deviceId": device.device_id }),
    )
    .await;
    Ok(device)
}

pub async fn sign_out_user_devices(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    user_id: &str,
) -> Result<u64, AppError> {
    let user_id = user_id.trim();
    if user_id.is_empty() || user_id.len() > 120 {
        return Err(AppError::validation("userId is required"));
    }
    let revoked = security_repository::sign_out_user_devices(db, tenant_id, branch_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to sign out devices"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.devices.signed_out",
        json!({ "userId": user_id, "revokedSessions": revoked }),
    )
    .await;
    Ok(revoked)
}

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityApprovalRecord>, AppError> {
    let status = list_status(status, &["pending", "approved", "rejected", "all"])?;
    security_repository::list_approvals(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load security approvals"))
}

pub async fn create_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    action_type: &str,
    summary: &str,
    details: Value,
) -> Result<SecurityApprovalRecord, AppError> {
    let action_type = action_type.trim().to_ascii_lowercase();
    let summary = summary.trim();
    if !(3..=80).contains(&action_type.len())
        || !action_type
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(AppError::validation("actionType is invalid"));
    }
    if !(3..=200).contains(&summary.len()) {
        return Err(AppError::validation(
            "summary must be between 3 and 200 characters",
        ));
    }
    if !details.is_object() || details.to_string().len() > 10_000 {
        return Err(AppError::validation(
            "details must be an object not exceeding 10000 characters",
        ));
    }
    let approval = security_repository::create_approval(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &action_type,
        summary,
        &details,
    )
    .await
    .map_err(|_| AppError::internal("failed to create security approval"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.approval.requested",
        json!({ "approvalId": approval.id, "actionType": approval.action_type }),
    )
    .await;
    Ok(approval)
}

pub async fn decide_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    approval_id: &str,
    decision: &str,
    note: Option<&str>,
) -> Result<SecurityApprovalRecord, AppError> {
    if !matches!(decision, "approved" | "rejected") {
        return Err(AppError::validation("approval decision is invalid"));
    }
    let note = note.unwrap_or("").trim();
    if note.len() > 500 {
        return Err(AppError::validation(
            "decision note must not exceed 500 characters",
        ));
    }
    let existing = security_repository::get_approval(db, tenant_id, branch_id, approval_id)
        .await
        .map_err(|_| AppError::internal("failed to load security approval"))?
        .ok_or_else(|| AppError::not_found("security approval was not found"))?;
    if existing.status != "pending" {
        return Err(AppError::conflict("security approval is already decided"));
    }
    if existing.requested_by == actor_id {
        return Err(AppError::forbidden(
            "requester cannot decide their own security approval",
        ));
    }
    if decision == "approved" && existing.action_type == "temporary_elevation" {
        let spec = elevation_spec(&existing.details_json, 60)?;
        let (approval, elevation) = security_repository::approve_temporary_elevation(
            db,
            tenant_id,
            branch_id,
            approval_id,
            actor_id,
            note,
            &spec.user_id,
            &json!(spec.permissions),
            &spec.reason,
            spec.duration_minutes,
        )
        .await
        .map_err(|_| AppError::internal("failed to approve temporary elevation"))?
        .ok_or_else(|| AppError::conflict("security approval is already decided"))?;
        audit_change(
            db,
            tenant_id,
            branch_id,
            actor_id,
            "security.elevation.activated",
            json!({ "approvalId": approval.id, "elevationId": elevation.id, "userId": elevation.user_id, "expiresAt": elevation.expires_at }),
        )
        .await;
        return Ok(approval);
    }
    let approval = security_repository::decide_approval(
        db,
        tenant_id,
        branch_id,
        approval_id,
        actor_id,
        decision,
        note,
    )
    .await
    .map_err(|_| AppError::internal("failed to decide security approval"))?
    .ok_or_else(|| AppError::conflict("security approval is already decided"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &format!("security.approval.{decision}"),
        json!({ "approvalId": approval.id, "requestedBy": approval.requested_by }),
    )
    .await;
    Ok(approval)
}

pub async fn request_temporary_elevation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    user_id: &str,
    permissions: Vec<String>,
    duration_minutes: i64,
    reason: &str,
) -> Result<SecurityApprovalRecord, AppError> {
    let spec = validate_elevation(user_id, permissions, duration_minutes, reason, 60)?;
    let user = auth_repository::find_user_by_id(db, tenant_id, &spec.user_id)
        .await
        .map_err(|_| AppError::internal("failed to load elevation user"))?
        .ok_or_else(|| AppError::not_found("active user was not found"))?;
    if auth_repository::find_branch_access(db, &user, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate branch access"))?
        .is_none()
    {
        return Err(AppError::forbidden(
            "target user has no access to this branch",
        ));
    }
    create_approval(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "temporary_elevation",
        &format!("Temporary access for {}", spec.user_id),
        json!({
            "userId": spec.user_id,
            "permissions": spec.permissions,
            "durationMinutes": spec.duration_minutes,
            "reason": spec.reason,
        }),
    )
    .await
}

pub async fn activate_break_glass(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    session_id: &str,
    role: &str,
    permissions: Vec<String>,
    duration_minutes: i64,
    reason: &str,
) -> Result<TemporaryElevationRecord, AppError> {
    if !role.eq_ignore_ascii_case("owner") {
        return Err(AppError::forbidden(
            "only the tenant owner can activate break-glass access",
        ));
    }
    if security_repository::active_privileged_session(
        db,
        tenant_id,
        branch_id,
        actor_id,
        session_id,
        DEFAULT_PRIVILEGED_SCOPE,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate privileged session"))?
    .is_none()
    {
        return Err(
            AppError::forbidden("verified privileged session is required")
                .with_details(json!({ "stepUpMfaRequired": true })),
        );
    }
    let spec = validate_elevation(actor_id, permissions, duration_minutes, reason, 15)?;
    let elevation = security_repository::create_temporary_elevation(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &json!(spec.permissions),
        "break_glass",
        None,
        &spec.reason,
        actor_id,
        spec.duration_minutes,
    )
    .await
    .map_err(|_| AppError::internal("failed to activate break-glass access"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.break_glass.activated",
        json!({ "elevationId": elevation.id, "permissions": elevation.permissions_json, "expiresAt": elevation.expires_at, "reason": elevation.reason }),
    )
    .await;
    Ok(elevation)
}

pub async fn list_temporary_elevations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<TemporaryElevationRecord>, AppError> {
    security_repository::list_temporary_elevations(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load temporary elevations"))
}

pub async fn revoke_temporary_elevation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    elevation_id: &str,
) -> Result<TemporaryElevationRecord, AppError> {
    let elevation = security_repository::revoke_temporary_elevation(
        db,
        tenant_id,
        branch_id,
        elevation_id,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to revoke temporary elevation"))?
    .ok_or_else(|| AppError::not_found("active temporary elevation was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.elevation.revoked",
        json!({ "elevationId": elevation.id, "userId": elevation.user_id }),
    )
    .await;
    Ok(elevation)
}

pub async fn simulate_permissions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<PermissionSimulation, AppError> {
    let user = auth_repository::find_user_by_id(db, tenant_id, user_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load simulation user"))?
        .ok_or_else(|| AppError::not_found("active user was not found"))?;
    let access = auth_repository::find_branch_access(db, &user, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load branch permissions"))?
        .ok_or_else(|| AppError::forbidden("user has no access to this branch"))?;
    let elevated_permissions =
        security_repository::active_elevated_permissions(db, tenant_id, branch_id, &user.id)
            .await
            .map_err(|_| AppError::internal("failed to load elevated permissions"))?;
    let denied: BTreeSet<_> = access.denied_permissions.iter().cloned().collect();
    let effective_permissions = access
        .permissions
        .iter()
        .chain(elevated_permissions.iter())
        .filter(|permission| !denied.contains(*permission))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(PermissionSimulation {
        user_id: user.id,
        branch_id: access.branch_id,
        role_name: access.role_name,
        base_permissions: access.permissions,
        elevated_permissions,
        denied_permissions: access.denied_permissions,
        effective_permissions,
    })
}

pub async fn list_access_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityAccessRuleRecord>, AppError> {
    let status = list_status(status, &["active", "disabled", "all"])?;
    security_repository::list_access_rules(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load security access rules"))
}

pub async fn create_access_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    rule_type: &str,
    match_value: &str,
    effect: &str,
    reason: &str,
) -> Result<SecurityAccessRuleRecord, AppError> {
    let (match_value, effect, reason) =
        validate_access_rule(rule_type, match_value, effect, reason)?;
    let rule = security_repository::create_access_rule(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &match_value,
        &effect,
        &reason,
    )
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(database) if database.is_unique_violation() => {
            AppError::conflict("an active access rule already exists for this IP")
        }
        _ => AppError::internal("failed to create security access rule"),
    })?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.access_rule.created",
        json!({ "ruleId": rule.id, "effect": rule.effect, "matchValue": rule.match_value }),
    )
    .await;
    Ok(rule)
}

pub async fn disable_access_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    rule_id: &str,
) -> Result<SecurityAccessRuleRecord, AppError> {
    let rule =
        security_repository::disable_access_rule(db, tenant_id, branch_id, rule_id, actor_id)
            .await
            .map_err(|_| AppError::internal("failed to disable security access rule"))?
            .ok_or_else(|| AppError::not_found("active security access rule was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.access_rule.disabled",
        json!({ "ruleId": rule.id, "matchValue": rule.match_value }),
    )
    .await;
    Ok(rule)
}

pub async fn list_incident_playbooks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<IncidentPlaybookRecord>, AppError> {
    let status = list_status(status, &["active", "disabled", "all"])?;
    security_repository::list_incident_playbooks(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load incident playbooks"))
}

pub async fn create_incident_playbook(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    playbook_key: &str,
    title: &str,
    severity: &str,
    checklist: Vec<String>,
) -> Result<IncidentPlaybookRecord, AppError> {
    let (playbook_key, title, severity, checklist) =
        validate_incident_playbook(playbook_key, title, severity, &checklist)?;
    let checklist_json = serde_json::to_value(checklist)
        .map_err(|_| AppError::internal("failed to serialize incident checklist"))?;
    let playbook = security_repository::create_incident_playbook(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &playbook_key,
        &title,
        &severity,
        &checklist_json,
    )
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(database) if database.is_unique_violation() => {
            AppError::conflict("an active incident playbook already uses this key")
        }
        _ => AppError::internal("failed to create incident playbook"),
    })?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.incident_playbook.created",
        json!({ "playbookId": playbook.id, "playbookKey": playbook.playbook_key, "severity": playbook.severity }),
    )
    .await;
    Ok(playbook)
}

pub async fn disable_incident_playbook(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    playbook_id: &str,
) -> Result<IncidentPlaybookRecord, AppError> {
    let playbook = security_repository::disable_incident_playbook(
        db,
        tenant_id,
        branch_id,
        playbook_id,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to disable incident playbook"))?
    .ok_or_else(|| AppError::not_found("active incident playbook was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.incident_playbook.disabled",
        json!({ "playbookId": playbook.id, "playbookKey": playbook.playbook_key }),
    )
    .await;
    Ok(playbook)
}

pub async fn list_privacy_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<PrivacyRequestRecord>, AppError> {
    let status = list_status(status, &["open", "resolved", "all"])?;
    security_repository::list_privacy_requests(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load privacy requests"))
}

pub async fn create_privacy_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    subject_type: &str,
    subject_id: &str,
    request_type: &str,
    summary: &str,
) -> Result<PrivacyRequestRecord, AppError> {
    let (subject_type, subject_id, request_type, summary) =
        validate_privacy_request(subject_type, subject_id, request_type, summary)?;
    let request = security_repository::create_privacy_request(
        db,
        tenant_id,
        branch_id,
        actor_id,
        &subject_type,
        &subject_id,
        &request_type,
        &summary,
    )
    .await
    .map_err(|_| AppError::internal("failed to create privacy request"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.privacy_request.created",
        json!({ "requestId": request.id, "requestType": request.request_type, "subjectType": request.subject_type }),
    )
    .await;
    Ok(request)
}

pub async fn resolve_privacy_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    request_id: &str,
    resolution_note: &str,
) -> Result<PrivacyRequestRecord, AppError> {
    let resolution_note = validate_resolution_note(resolution_note)?;
    let request = security_repository::resolve_privacy_request(
        db,
        tenant_id,
        branch_id,
        request_id,
        actor_id,
        &resolution_note,
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve privacy request"))?
    .ok_or_else(|| AppError::not_found("open privacy request was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.privacy_request.resolved",
        json!({ "requestId": request.id, "requestType": request.request_type }),
    )
    .await;
    Ok(request)
}

pub async fn data_governance_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    security_repository::data_governance_snapshot(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load data governance"))
}

#[allow(clippy::too_many_arguments)]
pub async fn save_retention_policy(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    record_class: &str,
    retention_days: i32,
    disposition: &str,
    legal_basis: &str,
    owner_user_id: &str,
    version: Option<i32>,
) -> Result<Value, AppError> {
    let record_class = safe_identifier(record_class, 2, 80, "recordClass")?;
    if !(1..=36500).contains(&retention_days) {
        return Err(AppError::validation(
            "retentionDays must be between 1 and 36500",
        ));
    }
    let disposition = disposition.trim().to_ascii_lowercase();
    if !matches!(disposition.as_str(), "delete" | "anonymize" | "review") {
        return Err(AppError::validation("disposition is invalid"));
    }
    let legal_basis = clean_text(legal_basis, 500, true, "legalBasis")?;
    let owner_user_id = clean_text(owner_user_id, 120, true, "ownerUserId")?;
    let row = security_repository::save_retention_policy(
        db,
        tenant_id,
        branch_id,
        &record_class,
        retention_days,
        &disposition,
        &legal_basis,
        &owner_user_id,
        actor_id,
        version,
    )
    .await
    .map_err(|_| AppError::internal("failed to save retention policy"))?
    .ok_or_else(|| AppError::conflict("owner user or policy version is invalid"))?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.retention_policy.saved",
        json!({"recordClass":record_class,"ownerUserId":owner_user_id}),
    )
    .await?;
    Ok(row)
}

pub async fn create_legal_hold(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    subject_type: &str,
    subject_id: &str,
    reason: &str,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, AppError> {
    let subject_type = safe_identifier(subject_type, 2, 40, "subjectType")?;
    if !matches!(
        subject_type.as_str(),
        "client" | "staff" | "user" | "tenant"
    ) {
        return Err(AppError::validation("subjectType is invalid"));
    }
    let subject_id = clean_text(subject_id, 120, true, "subjectId")?;
    let reason = clean_text(reason, 500, true, "reason")?;
    if expires_at.is_some_and(|value| value <= chrono::Utc::now()) {
        return Err(AppError::validation("expiresAt must be in the future"));
    }
    let row = security_repository::create_legal_hold(
        db,
        tenant_id,
        branch_id,
        &subject_type,
        &subject_id,
        &reason,
        expires_at,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to create legal hold"))?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.legal_hold.created",
        json!({"holdId":row["id"],"subjectType":subject_type,"subjectId":subject_id}),
    )
    .await?;
    Ok(row)
}

pub async fn release_legal_hold(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    hold_id: &str,
) -> Result<Value, AppError> {
    let hold_id = clean_text(hold_id, 120, true, "holdId")?;
    let row = security_repository::release_legal_hold(db, tenant_id, branch_id, &hold_id, actor_id)
        .await
        .map_err(|_| AppError::internal("failed to release legal hold"))?
        .ok_or_else(|| AppError::not_found("active legal hold was not found"))?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.legal_hold.released",
        json!({"holdId":hold_id}),
    )
    .await?;
    Ok(row)
}

pub async fn request_pii_export(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    subject_id: &str,
    row_limit: i32,
    reason: &str,
) -> Result<Value, AppError> {
    let subject_id = clean_text(subject_id, 120, false, "subjectId")?;
    if !(1..=10000).contains(&row_limit) {
        return Err(AppError::validation("rowLimit must be between 1 and 10000"));
    }
    let reason = clean_text(reason, 500, true, "reason")?;
    if !subject_id.is_empty() {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&subject_id)
        .fetch_one(db)
        .await
        .map_err(|_| AppError::internal("failed to validate export subject"))?;
        if !exists {
            return Err(AppError::not_found("client was not found"));
        }
    }
    let row = security_repository::create_pii_export(
        db,
        tenant_id,
        branch_id,
        &subject_id,
        row_limit,
        &reason,
        actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to request PII export"))?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.pii_export.requested",
        json!({"exportId":row["id"],"subjectId":subject_id,"rowLimit":row_limit,"reason":reason}),
    )
    .await?;
    Ok(row)
}

pub async fn decide_pii_export(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    export_id: &str,
    decision: &str,
    note: &str,
) -> Result<Value, AppError> {
    let export_id = clean_text(export_id, 120, true, "exportId")?;
    let decision = decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision must be approved or rejected",
        ));
    }
    let note = clean_text(note, 500, decision == "rejected", "approvalNote")?;
    let token = (decision == "approved").then(|| crate::services::sso_service::random_token(32));
    let token_hash = token
        .as_deref()
        .map(crate::services::sso_service::token_hash)
        .unwrap_or_default();
    let expires_at = token
        .as_ref()
        .map(|_| chrono::Utc::now() + chrono::Duration::minutes(15));
    let mut row = security_repository::decide_pii_export(
        db,
        tenant_id,
        branch_id,
        &export_id,
        actor_id,
        &decision,
        &note,
        &token_hash,
        expires_at,
    )
    .await
    .map_err(|_| AppError::internal("failed to decide PII export"))?
    .ok_or_else(|| {
        AppError::conflict("pending export was not found or maker-checker approval failed")
    })?;
    if let Some(token) = token {
        row["downloadToken"] = Value::String(token);
    }
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.pii_export.decided",
        json!({"exportId":export_id,"decision":decision,"note":note}),
    )
    .await?;
    Ok(row)
}

pub async fn download_pii_export(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    export_id: &str,
    token: &str,
) -> Result<Value, AppError> {
    let export_id = clean_text(export_id, 120, true, "exportId")?;
    let token = clean_text(token, 200, true, "downloadToken")?;
    let hash = crate::services::sso_service::token_hash(&token);
    let row = security_repository::download_pii_export(
        db, tenant_id, branch_id, &export_id, &hash, actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to download PII export"))?
    .ok_or_else(|| AppError::forbidden("download token is invalid, expired, or already used"))?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.pii_export.downloaded",
        json!({"exportId":export_id}),
    )
    .await?;
    Ok(row)
}

pub async fn approve_privacy_deletion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    request_id: &str,
) -> Result<PrivacyRequestRecord, AppError> {
    let request = security_repository::approve_privacy_deletion(
        db, tenant_id, branch_id, request_id, actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to approve privacy deletion"))?
    .ok_or_else(|| {
        AppError::conflict("pending deletion was not found or maker-checker approval failed")
    })?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.privacy_deletion.approved",
        json!({"requestId":request.id,"subjectId":request.subject_id}),
    )
    .await?;
    Ok(request)
}

pub async fn execute_privacy_deletion(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    request_id: &str,
) -> Result<Value, AppError> {
    match security_repository::execute_client_deletion(
        db, tenant_id, branch_id, request_id, actor_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to execute privacy deletion"))?
    {
        security_repository::PrivacyDeletionOutcome::Completed(summary) => {
            record_audit(
                db,
                tenant_id,
                branch_id,
                actor_id,
                "security.privacy_deletion.completed",
                json!({"requestId":request_id,"summary":summary}),
            )
            .await?;
            Ok(summary)
        }
        security_repository::PrivacyDeletionOutcome::LegalHold => {
            record_audit(
                db,
                tenant_id,
                branch_id,
                actor_id,
                "security.privacy_deletion.blocked",
                json!({"requestId":request_id,"reason":"active_legal_hold"}),
            )
            .await?;
            Err(AppError::conflict("active legal hold blocks deletion"))
        }
        security_repository::PrivacyDeletionOutcome::NotFound => Err(AppError::not_found(
            "approved deletion request or client was not found",
        )),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn save_compliance_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    framework: &str,
    control_key: &str,
    title: &str,
    owner_user_id: &str,
    status: &str,
    evidence_reference: &str,
    independent_assessor: &str,
    valid_until: Option<&str>,
    notes: &str,
    version: Option<i32>,
) -> Result<Value, AppError> {
    let framework = safe_identifier(framework, 2, 20, "framework")?;
    if !matches!(
        framework.as_str(),
        "soc1" | "soc2" | "iso27001" | "gdpr" | "hipaa" | "pci"
    ) {
        return Err(AppError::validation("framework is invalid"));
    }
    let control_key = safe_identifier(control_key, 2, 80, "controlKey")?;
    let title = clean_text(title, 200, true, "title")?;
    let owner_user_id = clean_text(owner_user_id, 120, true, "ownerUserId")?;
    let status = safe_identifier(status, 2, 30, "status")?;
    if !matches!(
        status.as_str(),
        "planned" | "in_progress" | "ready" | "verified" | "not_applicable"
    ) {
        return Err(AppError::validation("status is invalid"));
    }
    let evidence_reference = clean_text(evidence_reference, 500, false, "evidenceReference")?;
    let independent_assessor = clean_text(independent_assessor, 200, false, "independentAssessor")?;
    let valid_until = valid_until
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| {
            chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d")
                .map(|d| d.format("%Y-%m-%d").to_string())
                .map_err(|_| AppError::validation("validUntil must be YYYY-MM-DD"))
        })
        .transpose()?;
    let notes = clean_text(notes, 2000, false, "notes")?;
    let row = security_repository::save_compliance_evidence(
        db,
        tenant_id,
        branch_id,
        &framework,
        &control_key,
        &title,
        &owner_user_id,
        &status,
        &evidence_reference,
        &independent_assessor,
        valid_until.as_deref(),
        &notes,
        actor_id,
        version,
    )
    .await
    .map_err(|_| AppError::internal("failed to save compliance evidence"))?
    .ok_or_else(|| AppError::conflict("owner user or evidence version is invalid"))?;
    record_audit(db,tenant_id,branch_id,actor_id,"security.compliance_evidence.saved",json!({"framework":framework,"controlKey":control_key,"ownerUserId":owner_user_id,"status":status})).await?;
    Ok(row)
}

#[allow(clippy::too_many_arguments)]
pub async fn save_pen_test_finding(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    finding_id: Option<&str>,
    title: &str,
    severity: &str,
    status: &str,
    owner_user_id: &str,
    remediation_note: &str,
    risk_acceptance_reason: &str,
    risk_acceptance_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    version: Option<i32>,
) -> Result<Value, AppError> {
    let title = clean_text(title, 240, true, "title")?;
    let severity = safe_identifier(severity, 2, 20, "severity")?;
    if !matches!(
        severity.as_str(),
        "critical" | "high" | "medium" | "low" | "info"
    ) {
        return Err(AppError::validation("severity is invalid"));
    }
    let status = safe_identifier(status, 2, 30, "status")?;
    if !matches!(status.as_str(), "open" | "resolved" | "risk_accepted") {
        return Err(AppError::validation("status is invalid"));
    }
    let owner_user_id = clean_text(owner_user_id, 120, true, "ownerUserId")?;
    let remediation_note = clean_text(
        remediation_note,
        2000,
        status == "resolved",
        "remediationNote",
    )?;
    let risk_acceptance_reason = clean_text(
        risk_acceptance_reason,
        1000,
        status == "risk_accepted",
        "riskAcceptanceReason",
    )?;
    if status == "risk_accepted"
        && risk_acceptance_expires_at.map_or(true, |value| value <= chrono::Utc::now())
    {
        return Err(AppError::validation(
            "future riskAcceptanceExpiresAt is required",
        ));
    }
    let row = security_repository::save_pen_test_finding(
        db,
        tenant_id,
        branch_id,
        finding_id,
        &title,
        &severity,
        &status,
        &owner_user_id,
        &remediation_note,
        &risk_acceptance_reason,
        risk_acceptance_expires_at,
        actor_id,
        version,
    )
    .await
    .map_err(|_| AppError::internal("failed to save pen-test finding"))?
    .ok_or_else(|| AppError::conflict("owner user or finding version is invalid"))?;
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.pen_test_finding.saved",
        json!({"findingId":row["id"],"status":status,"ownerUserId":owner_user_id}),
    )
    .await?;
    Ok(row)
}

pub async fn list_disclosure_reports(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<DisclosureReportRecord>, AppError> {
    let status = list_status(status, &["new", "resolved", "all"])?;
    security_repository::list_disclosure_reports(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load disclosure reports"))
}

pub async fn create_disclosure_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    reporter_name: &str,
    reporter_contact: &str,
    summary: &str,
    details: &str,
    severity: &str,
) -> Result<DisclosureReportRecord, AppError> {
    let (reporter_name, reporter_contact, summary, details, severity) =
        validate_disclosure_report(reporter_name, reporter_contact, summary, details, severity)?;
    let report = security_repository::create_disclosure_report(
        db,
        tenant_id,
        branch_id,
        &reporter_name,
        &reporter_contact,
        &summary,
        &details,
        &severity,
    )
    .await
    .map_err(|_| AppError::internal("failed to create disclosure report"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.disclosure_report.created",
        json!({ "reportId": report.id, "severity": report.severity }),
    )
    .await;
    Ok(report)
}

pub async fn resolve_disclosure_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    report_id: &str,
    resolution_note: &str,
) -> Result<DisclosureReportRecord, AppError> {
    let resolution_note = validate_resolution_note(resolution_note)?;
    let report = security_repository::resolve_disclosure_report(
        db,
        tenant_id,
        branch_id,
        report_id,
        actor_id,
        &resolution_note,
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve disclosure report"))?
    .ok_or_else(|| AppError::not_found("new disclosure report was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.disclosure_report.resolved",
        json!({ "reportId": report.id, "severity": report.severity }),
    )
    .await;
    Ok(report)
}

pub async fn list_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityAlertRecord>, AppError> {
    let status = list_status(status, &["open", "resolved", "all"])?;
    security_repository::list_alerts(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load security alerts"))
}

pub async fn resolve_alert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    alert_id: &str,
) -> Result<SecurityAlertRecord, AppError> {
    let alert = security_repository::resolve_alert(db, tenant_id, branch_id, alert_id, actor_id)
        .await
        .map_err(|_| AppError::internal("failed to resolve security alert"))?
        .ok_or_else(|| AppError::not_found("open security alert was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.alert.resolved",
        json!({ "alertId": alert_id }),
    )
    .await;
    Ok(alert)
}

pub async fn list_blocks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityBlockRecord>, AppError> {
    let status = list_status(status, &["active", "inactive", "all"])?;
    security_repository::list_blocks(db, tenant_id, branch_id, status)
        .await
        .map_err(|_| AppError::internal("failed to load security blocklist"))
}

pub async fn unblock(
    db: &PgPool,
    redis: &RedisClient,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    block_id: &str,
) -> Result<SecurityBlockRecord, AppError> {
    let block = security_repository::unblock(db, tenant_id, branch_id, block_id, actor_id)
        .await
        .map_err(|_| AppError::internal("failed to update security blocklist"))?
        .ok_or_else(|| AppError::not_found("active security block was not found"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.block.unblocked",
        json!({ "blockId": block_id }),
    )
    .await;
    if let Some(ip) = block.ip_address.as_deref() {
        if clear_intrusion_block(redis, ip).await.is_err() {
            tracing::warn!(source_ip = ip, "intrusion block cache clear failed");
        }
    }
    Ok(block)
}

pub async fn list_fraud_warnings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<FraudWarningRecord>, AppError> {
    security_repository::list_fraud_warnings(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load fraud warnings"))
}

pub async fn create_fraud_warning(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    title: &str,
    message: &str,
    severity: &str,
) -> Result<FraudWarningRecord, AppError> {
    let title = title.trim();
    let message = message.trim();
    let severity = severity.trim().to_ascii_lowercase();
    if title.is_empty() || title.len() > 120 {
        return Err(AppError::validation(
            "title is required and must not exceed 120 characters",
        ));
    }
    if message.is_empty() || message.len() > 500 {
        return Err(AppError::validation(
            "message is required and must not exceed 500 characters",
        ));
    }
    if !matches!(severity.as_str(), "info" | "warning" | "critical") {
        return Err(AppError::validation("severity is invalid"));
    }
    let warning = security_repository::create_fraud_warning(
        db, tenant_id, branch_id, actor_id, title, message, &severity,
    )
    .await
    .map_err(|_| AppError::internal("failed to create fraud warning"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "security.fraud_warning.created",
        json!({ "warningId": warning.id, "title": warning.title, "severity": warning.severity }),
    )
    .await;
    Ok(warning)
}

const INTRUSION_WINDOW_SECONDS: i64 = 600;
const INTRUSION_BLOCK_SECONDS: i64 = 3600;
const INTRUSION_BLOCK_AFTER: i64 = 3;

pub async fn intrusion_source_blocked(redis: &RedisClient, source_ip: &str) -> bool {
    let mut connection = match redis.get_multiplexed_async_connection().await {
        Ok(connection) => connection,
        Err(error) => {
            tracing::warn!(error = ?error, "intrusion block store unavailable");
            return false;
        }
    };
    let result: Result<i64, redis::RedisError> = redis::cmd("EXISTS")
        .arg(intrusion_block_key(source_ip))
        .query_async(&mut connection)
        .await;
    match result {
        Ok(value) => value > 0,
        Err(error) => {
            tracing::warn!(error = ?error, "intrusion block lookup failed");
            false
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn record_intrusion_probe(
    db: &PgPool,
    redis: &RedisClient,
    tenant_id: &str,
    branch_id: &str,
    user_id: Option<&str>,
    source_ip: Option<&str>,
    method: &str,
    path: &str,
    signal: &str,
    user_agent: Option<&str>,
) -> Result<(), AppError> {
    let attempts = if let Some(ip) = source_ip {
        match intrusion_attempts(redis, ip).await {
            Ok(attempts) => attempts,
            Err(error) => {
                tracing::warn!(error = ?error, "intrusion counter unavailable");
                1
            }
        }
    } else {
        1
    };
    let blocked = if attempts >= INTRUSION_BLOCK_AFTER {
        if let Some(ip) = source_ip {
            set_intrusion_block(redis, ip).await
        } else {
            false
        }
    } else {
        false
    };
    let user_agent = user_agent.map(|value| value.chars().take(512).collect::<String>());
    let details = json!({
        "signal": signal,
        "path": path.chars().take(512).collect::<String>(),
        "method": method,
        "attempts": attempts,
        "blocked": blocked,
    });
    security_repository::record_intrusion_detection(
        db,
        tenant_id,
        branch_id,
        user_id,
        source_ip,
        &details,
        blocked,
        INTRUSION_BLOCK_SECONDS,
    )
    .await
    .map_err(|_| AppError::internal("failed to record intrusion detection"))?;
    auth_repository::audit(
        db,
        AuthAuditInput {
            tenant_id,
            user_id,
            session_id: None,
            branch_id: Some(branch_id),
            identity: None,
            event_type: "security.intrusion.probe",
            outcome: if blocked { "blocked" } else { "detected" },
            ip_address: source_ip,
            user_agent: user_agent.as_deref(),
            details,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to audit intrusion detection"))
}

async fn intrusion_attempts(
    redis: &RedisClient,
    source_ip: &str,
) -> Result<i64, redis::RedisError> {
    let key = format!("security:intrusion:attempts:{source_ip}");
    let mut connection = redis.get_multiplexed_async_connection().await?;
    let attempts: i64 = redis::cmd("INCR")
        .arg(&key)
        .query_async(&mut connection)
        .await?;
    if attempts == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(INTRUSION_WINDOW_SECONDS)
            .query_async(&mut connection)
            .await?;
    }
    Ok(attempts)
}

async fn set_intrusion_block(redis: &RedisClient, source_ip: &str) -> bool {
    let Ok(mut connection) = redis.get_multiplexed_async_connection().await else {
        return false;
    };
    let result: Result<(), redis::RedisError> = redis::cmd("SET")
        .arg(intrusion_block_key(source_ip))
        .arg("1")
        .arg("EX")
        .arg(INTRUSION_BLOCK_SECONDS)
        .query_async(&mut connection)
        .await;
    result.is_ok()
}

async fn clear_intrusion_block(
    redis: &RedisClient,
    source_ip: &str,
) -> Result<(), redis::RedisError> {
    let mut connection = redis.get_multiplexed_async_connection().await?;
    let _: i64 = redis::cmd("DEL")
        .arg(intrusion_block_key(source_ip))
        .query_async(&mut connection)
        .await?;
    Ok(())
}

fn intrusion_block_key(source_ip: &str) -> String {
    format!("security:intrusion:block:{source_ip}")
}

pub fn compliance() -> ComplianceSummary {
    ComplianceSummary {
        password_hashing: true,
        refresh_rotation: true,
        server_side_rbac: true,
        tenant_isolation: true,
        append_only_auth_audit: true,
        security_headers: true,
    }
}

pub async fn export_compliance_evidence(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
) -> Result<ComplianceEvidenceExport, AppError> {
    let generated_at = chrono::Utc::now();
    let counts = security_repository::compliance_evidence_counts(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load compliance evidence counts"))?;
    let security = security_repository::counts(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load security evidence"))?;
    let audit_chain = verify_audit_chain(db, tenant_id).await?;
    let governance = data_governance_snapshot(db, tenant_id, branch_id).await?;
    let bundle_id = evidence_bundle_id(
        tenant_id,
        branch_id,
        &generated_at.to_rfc3339(),
        &audit_chain.head_hash,
    );
    let export = ComplianceEvidenceExport {
        bundle_id,
        generated_at,
        tenant_id: tenant_id.to_string(),
        branch_id: branch_id.to_string(),
        exported_by: actor_id.to_string(),
        frameworks: ["SOC1", "SOC2", "ISO27001", "GDPR", "HIPAA", "PCI"],
        controls: compliance(),
        counts,
        security,
        audit_chain,
        governance,
    };
    record_audit(
        db,
        tenant_id,
        branch_id,
        actor_id,
        "compliance_evidence.exported",
        json!({ "bundleId": export.bundle_id }),
    )
    .await?;
    Ok(export)
}

fn evidence_bundle_id(
    tenant_id: &str,
    branch_id: &str,
    generated_at: &str,
    head_hash: &str,
) -> String {
    let digest = Sha256::digest(format!(
        "{tenant_id}|{branch_id}|{generated_at}|{head_hash}"
    ));
    format!("evidence_{:x}", digest)[..21].to_string()
}

pub async fn mfa_status(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<MfaStatus, AppError> {
    let factor = security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA status"))?;
    Ok(match factor {
        Some(factor) => MfaStatus {
            enabled: factor.enabled,
            required: false,
            pending: !factor.enabled,
            recovery_codes_remaining: factor
                .recovery_code_hashes
                .as_object()
                .map_or(0, serde_json::Map::len),
            verified_at: factor.verified_at,
        },
        None => MfaStatus {
            enabled: false,
            required: false,
            pending: false,
            recovery_codes_remaining: 0,
            verified_at: None,
        },
    })
}

pub async fn setup_mfa(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    user_id: &str,
) -> Result<MfaSetup, AppError> {
    let encryption_key = required_encryption_key(encryption_key)?;
    if security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA factor"))?
        .is_some_and(|factor| factor.enabled)
    {
        return Err(AppError::conflict("MFA is already enabled"));
    }

    let mut secret_bytes = [0_u8; 20];
    OsRng.fill_bytes(&mut secret_bytes);
    let secret = base32_encode(&secret_bytes);
    let encrypted = encrypt_secret(encryption_key, &secret)?;
    let saved = security_repository::save_pending_mfa_factor(db, tenant_id, user_id, &encrypted)
        .await
        .map_err(|_| AppError::internal("failed to save MFA setup"))?;
    if !saved {
        return Err(AppError::conflict("MFA is already enabled"));
    }

    let issuer = "AuraShine CRM";
    let otp_auth_uri = format!(
        "otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits=6&period=30",
        percent_encode(issuer),
        percent_encode(user_id),
        secret,
        percent_encode(issuer),
    );
    Ok(MfaSetup {
        secret,
        otp_auth_uri,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
    })
}

pub async fn enable_mfa(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    user_id: &str,
    code: &str,
) -> Result<MfaEnableResult, AppError> {
    let encryption_key = required_encryption_key(encryption_key)?;
    let factor = security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA setup"))?
        .ok_or_else(|| AppError::validation("start MFA setup before enabling"))?;
    if factor.enabled {
        return Err(AppError::conflict("MFA is already enabled"));
    }
    let secret = decrypt_secret(encryption_key, &factor.secret_ciphertext)?;
    if !verify_totp(&secret, code, unix_time_seconds()) {
        return Err(AppError::unauthenticated("invalid authenticator code"));
    }

    let recovery_codes = generate_recovery_codes(10);
    let recovery_hashes = recovery_codes
        .iter()
        .map(|code| (hash_recovery_code(code), Value::Bool(true)))
        .collect::<serde_json::Map<String, Value>>();
    let enabled = security_repository::enable_mfa_factor(
        db,
        tenant_id,
        user_id,
        Value::Object(recovery_hashes),
    )
    .await
    .map_err(|_| AppError::internal("failed to enable MFA"))?;
    if !enabled {
        return Err(AppError::conflict("MFA setup changed; start again"));
    }
    Ok(MfaEnableResult {
        enabled: true,
        recovery_codes,
    })
}

pub async fn disable_mfa(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    user_id: &str,
    code: &str,
) -> Result<MfaDisableResult, AppError> {
    if !verify_enabled_mfa(db, encryption_key, tenant_id, user_id, code).await? {
        return Err(AppError::unauthenticated(
            "invalid authenticator or recovery code",
        ));
    }
    let deleted = security_repository::delete_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to disable MFA"))?;
    if !deleted {
        return Err(AppError::validation("MFA is not enabled"));
    }
    Ok(MfaDisableResult { enabled: false })
}

pub async fn assess_login_risk(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    device_id: Option<&str>,
    ip_address: Option<&str>,
) -> Result<LoginRiskAssessment, AppError> {
    let signals = security_repository::login_risk_signals(
        db,
        tenant_id,
        user_id,
        clean_device_id(device_id)?.as_deref(),
        ip_address.map(str::trim).filter(|value| !value.is_empty()),
    )
    .await
    .map_err(|_| AppError::internal("failed to assess login risk"))?;
    Ok(login_risk_assessment(
        signals.has_history,
        device_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some(),
        signals.known_device,
        ip_address
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some(),
        signals.known_ip,
        signals.recent_other_ip,
    ))
}

pub async fn verify_login_mfa(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    user_id: &str,
    code: Option<&str>,
    force: bool,
) -> Result<bool, AppError> {
    let factor = security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to verify MFA"))?;
    if !factor.is_some_and(|factor| factor.enabled) {
        if force {
            return Err(AppError::forbidden("high-risk login requires enrolled MFA")
                .with_details(json!({ "mfaEnrollmentRequired": true, "adaptiveRisk": true })));
        }
        return Ok(false);
    }
    let code = code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::unauthenticated("MFA code is required")
                .with_details(json!({ "mfaRequired": true }))
        })?;
    if verify_enabled_mfa(db, encryption_key, tenant_id, user_id, code).await? {
        Ok(true)
    } else {
        Err(
            AppError::unauthenticated("invalid authenticator or recovery code")
                .with_details(json!({ "mfaRequired": true })),
        )
    }
}

pub async fn mfa_enrollment_required(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    role: &str,
    permissions: &[String],
) -> Result<bool, AppError> {
    if !scope_requires_mfa(role, permissions) {
        return Ok(false);
    }
    let enabled = security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA requirement"))?
        .is_some_and(|factor| factor.enabled);
    Ok(!enabled)
}

pub fn scope_requires_mfa(role: &str, permissions: &[String]) -> bool {
    let normalized = role
        .chars()
        .filter(|value| value.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "owner" | "admin" | "superadmin" | "accountant" | "finance" | "financemanager"
    ) || permissions.iter().any(|permission| {
        matches!(
            permission.as_str(),
            "finance.write" | "pos.refund" | "security.manage" | "staff.payroll.manage"
        )
    })
}

pub fn enforce_role_limit(
    limit_paise: Option<i64>,
    amount_paise: i64,
    limit_name: &str,
) -> Result<(), AppError> {
    if amount_paise < 0 {
        return Err(AppError::validation("amount must not be negative"));
    }
    if limit_paise.is_some_and(|limit| amount_paise > limit) {
        return Err(
            AppError::forbidden(format!("{limit_name} exceeds the role limit")).with_details(
                json!({
                    "limitName": limit_name,
                    "limitPaise": limit_paise,
                    "requestedPaise": amount_paise,
                }),
            ),
        );
    }
    Ok(())
}

pub async fn privileged_session_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    action_scope: Option<&str>,
) -> Result<PrivilegedSessionStatus, AppError> {
    let action_scope = privileged_scope(action_scope)?;
    let active = security_repository::active_privileged_session(
        db,
        tenant_id,
        branch_id,
        user_id,
        session_id,
        &action_scope,
    )
    .await
    .map_err(|_| AppError::internal("failed to load privileged session"))?;
    Ok(match active {
        Some(active) => {
            let ttl_seconds = (active.expires_at - chrono::Utc::now())
                .num_seconds()
                .max(0);
            PrivilegedSessionStatus {
                active: true,
                user_id: active.user_id,
                session_id: active.session_id,
                action_scope: active.action_scope,
                verification_method: Some(active.verification_method),
                verified_at: Some(active.verified_at),
                expires_at: Some(active.expires_at),
                ttl_seconds,
            }
        }
        None => PrivilegedSessionStatus {
            active: false,
            user_id: user_id.to_string(),
            session_id: session_id.to_string(),
            action_scope,
            verification_method: None,
            verified_at: None,
            expires_at: None,
            ttl_seconds: 0,
        },
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn verify_privileged_session(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    mfa_code: Option<&str>,
    password: Option<&str>,
    action_scope: Option<&str>,
) -> Result<PrivilegedSessionStatus, AppError> {
    if session_id.trim().is_empty() {
        return Err(AppError::unauthenticated("active session is required"));
    }
    let action_scope = privileged_scope(action_scope)?;
    let method = if security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA requirement"))?
        .is_some_and(|factor| factor.enabled)
    {
        let code = mfa_code
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::validation("mfaCode is required"))?;
        if !verify_enabled_mfa(db, encryption_key, tenant_id, user_id, code).await? {
            return Err(AppError::unauthenticated(
                "invalid authenticator or recovery code",
            ));
        }
        "mfa"
    } else {
        let password = password
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::validation("password is required"))?;
        let user = auth_repository::find_user_by_id(db, tenant_id, user_id)
            .await
            .map_err(|_| AppError::internal("failed to load user"))?
            .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
        if !auth_service::verify_password(password, &user.password_hash) {
            return Err(AppError::unauthenticated("invalid password"));
        }
        "password"
    };
    let session = security_repository::upsert_privileged_session(
        db,
        tenant_id,
        branch_id,
        user_id,
        session_id,
        &action_scope,
        method,
        PRIVILEGED_SESSION_TTL_MINUTES,
    )
    .await
    .map_err(|_| AppError::internal("failed to verify privileged session"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        user_id,
        "security.privileged_session.verified",
        json!({ "sessionId": session_id, "actionScope": action_scope, "method": method }),
    )
    .await;
    Ok(PrivilegedSessionStatus {
        active: true,
        user_id: session.user_id,
        session_id: session.session_id,
        action_scope: session.action_scope,
        verification_method: Some(session.verification_method),
        verified_at: Some(session.verified_at),
        expires_at: Some(session.expires_at),
        ttl_seconds: PRIVILEGED_SESSION_TTL_MINUTES * 60,
    })
}

pub async fn revoke_privileged_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
) -> Result<PrivilegedSessionStatus, AppError> {
    security_repository::revoke_privileged_session(db, tenant_id, branch_id, user_id, session_id)
        .await
        .map_err(|_| AppError::internal("failed to revoke privileged session"))?;
    audit_change(
        db,
        tenant_id,
        branch_id,
        user_id,
        "security.privileged_session.revoked",
        json!({ "sessionId": session_id }),
    )
    .await;
    privileged_session_status(
        db,
        tenant_id,
        branch_id,
        user_id,
        session_id,
        Some(DEFAULT_PRIVILEGED_SCOPE),
    )
    .await
}

pub async fn require_action_mfa(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    code: Option<&str>,
    action: &str,
) -> Result<(), AppError> {
    if security_repository::active_privileged_session(
        db,
        tenant_id,
        branch_id,
        user_id,
        session_id,
        DEFAULT_PRIVILEGED_SCOPE,
    )
    .await
    .map_err(|_| AppError::internal("failed to load privileged session"))?
    .is_some()
    {
        audit_action_mfa(
            db,
            tenant_id,
            branch_id,
            user_id,
            session_id,
            action,
            "privileged_session",
        )
        .await;
        return Ok(());
    }
    let error = || {
        AppError::forbidden("authenticator or recovery code is required for this action")
            .with_details(json!({ "stepUpMfaRequired": true, "action": action }))
    };
    let factor_enabled = security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA requirement"))?
        .is_some_and(|factor| factor.enabled);
    let code = code.map(str::trim).filter(|value| !value.is_empty());
    if !factor_enabled || code.is_none() {
        audit_action_mfa(
            db, tenant_id, branch_id, user_id, session_id, action, "denied",
        )
        .await;
        return Err(error());
    }
    if !verify_enabled_mfa(db, encryption_key, tenant_id, user_id, code.unwrap()).await? {
        audit_action_mfa(
            db, tenant_id, branch_id, user_id, session_id, action, "denied",
        )
        .await;
        return Err(error());
    }
    audit_action_mfa(
        db, tenant_id, branch_id, user_id, session_id, action, "success",
    )
    .await;
    let _ = security_repository::upsert_privileged_session(
        db,
        tenant_id,
        branch_id,
        user_id,
        session_id,
        DEFAULT_PRIVILEGED_SCOPE,
        "mfa",
        PRIVILEGED_SESSION_TTL_MINUTES,
    )
    .await;
    Ok(())
}

async fn audit_action_mfa(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    action: &str,
    outcome: &str,
) {
    let _ = auth_repository::audit(
        db,
        AuthAuditInput {
            tenant_id,
            user_id: Some(user_id),
            session_id: (!session_id.is_empty()).then_some(session_id),
            branch_id: Some(branch_id),
            identity: None,
            event_type: "security.step_up_mfa",
            outcome,
            ip_address: None,
            user_agent: None,
            details: json!({ "action": action }),
        },
    )
    .await;
}

async fn verify_enabled_mfa(
    db: &PgPool,
    encryption_key: Option<&str>,
    tenant_id: &str,
    user_id: &str,
    code: &str,
) -> Result<bool, AppError> {
    let encryption_key = required_encryption_key(encryption_key)?;
    let factor = security_repository::get_mfa_factor(db, tenant_id, user_id)
        .await
        .map_err(|_| AppError::internal("failed to load MFA factor"))?
        .filter(|factor| factor.enabled)
        .ok_or_else(|| AppError::validation("MFA is not enabled"))?;
    let secret = decrypt_secret(encryption_key, &factor.secret_ciphertext)?;
    if verify_totp(&secret, code, unix_time_seconds()) {
        return Ok(true);
    }
    let recovery_hash = hash_recovery_code(code);
    let consumed =
        security_repository::consume_recovery_code(db, tenant_id, user_id, &recovery_hash)
            .await
            .map_err(|_| AppError::internal("failed to verify recovery code"))?;
    Ok(consumed)
}

fn required_encryption_key(value: Option<&str>) -> Result<&str, AppError> {
    value.ok_or_else(|| {
        AppError::service_unavailable("MFA_NOT_CONFIGURED", "MFA encryption is not configured")
    })
}

pub(crate) fn encrypt_secret(encryption_key: &str, secret: &str) -> Result<String, AppError> {
    let key = Sha256::digest(encryption_key.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| AppError::internal("failed to initialize MFA encryption"))?;
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let nonce = Nonce::from(nonce);
    let ciphertext = cipher
        .encrypt(&nonce, secret.as_bytes())
        .map_err(|_| AppError::internal("failed to encrypt MFA secret"))?;
    let mut stored = nonce.to_vec();
    stored.extend(ciphertext);
    Ok(URL_SAFE_NO_PAD.encode(stored))
}

pub(crate) fn decrypt_secret(encryption_key: &str, stored: &str) -> Result<String, AppError> {
    let stored = URL_SAFE_NO_PAD
        .decode(stored)
        .map_err(|_| AppError::internal("stored MFA secret is invalid"))?;
    if stored.len() <= 12 {
        return Err(AppError::internal("stored MFA secret is invalid"));
    }
    let key = Sha256::digest(encryption_key.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| AppError::internal("failed to initialize MFA encryption"))?;
    let nonce: [u8; 12] = stored[..12]
        .try_into()
        .map_err(|_| AppError::internal("stored MFA secret is invalid"))?;
    let nonce = Nonce::from(nonce);
    let plaintext = cipher
        .decrypt(&nonce, &stored[12..])
        .map_err(|_| AppError::internal("failed to decrypt MFA secret"))?;
    String::from_utf8(plaintext).map_err(|_| AppError::internal("stored MFA secret is invalid"))
}

fn base32_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut output = String::new();
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    for byte in input {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    output
}

fn base32_decode(input: &str) -> Option<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    for value in input.bytes().filter(|value| !value.is_ascii_whitespace()) {
        let value = match value.to_ascii_uppercase() {
            b'A'..=b'Z' => value.to_ascii_uppercase() - b'A',
            b'2'..=b'7' => value - b'2' + 26,
            b'=' => continue,
            _ => return None,
        };
        buffer = (buffer << 5) | u32::from(value);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(output)
}

fn verify_totp(secret: &str, code: &str, now_seconds: u64) -> bool {
    let code = code.trim().replace(' ', "");
    if code.len() != 6 || !code.bytes().all(|value| value.is_ascii_digit()) {
        return false;
    }
    let counter = now_seconds / 30;
    (-1_i64..=1).any(|offset| {
        let candidate_counter = (counter as i64 + offset).max(0) as u64;
        hotp(secret, candidate_counter)
            .is_some_and(|candidate| constant_time_eq(candidate.as_bytes(), code.as_bytes()))
    })
}

fn hotp(secret: &str, counter: u64) -> Option<String> {
    let key = base32_decode(secret)?;
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(&key).ok()?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[19] & 0x0f);
    let binary = (u32::from(digest[offset] & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    Some(format!("{:06}", binary % 1_000_000))
}

fn generate_recovery_codes(count: usize) -> Vec<String> {
    (0..count)
        .map(|_| {
            let mut value = [0_u8; 5];
            OsRng.fill_bytes(&mut value);
            let hex = value
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect::<String>();
            format!("{}-{}", &hex[..5], &hex[5..])
        })
        .collect()
}

fn hash_recovery_code(code: &str) -> String {
    let normalized = code.trim().to_ascii_uppercase();
    format!("{:x}", Sha256::digest(normalized.as_bytes()))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

fn unix_time_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn validate_policy(policy: &SecurityPolicy) -> Result<(), AppError> {
    if !(1..=3650).contains(&policy.audit_retention_days) {
        return Err(AppError::validation(
            "auditRetentionDays must be between 1 and 3650",
        ));
    }
    if !(10..=250).contains(&policy.audit_page_size) {
        return Err(AppError::validation(
            "auditPageSize must be between 10 and 250",
        ));
    }
    if !(1..=480).contains(&policy.staff_app_inactivity_minutes) {
        return Err(AppError::validation(
            "staffAppInactivityMinutes must be between 1 and 480",
        ));
    }
    if !matches!(
        policy.staff_app_geofence_mode.as_str(),
        "full_access" | "read_only" | "blocked"
    ) {
        return Err(AppError::validation("invalid staffAppGeofenceMode"));
    }
    if !(25..=5000).contains(&policy.staff_app_geofence_radius_meters) {
        return Err(AppError::validation(
            "staffAppGeofenceRadiusMeters must be between 25 and 5000",
        ));
    }
    if policy.staff_app_geofence_exempt_roles.len() > 50
        || policy.staff_app_geofence_exempt_roles.iter().any(|role| {
            role.trim().is_empty()
                || role.chars().count() > 80
                || role.chars().any(char::is_control)
        })
    {
        return Err(AppError::validation(
            "staffAppGeofenceExemptRoles is invalid",
        ));
    }
    Ok(())
}

fn login_risk_assessment(
    has_history: bool,
    device_present: bool,
    known_device: bool,
    ip_present: bool,
    known_ip: bool,
    recent_other_ip: bool,
) -> LoginRiskAssessment {
    if !has_history {
        return LoginRiskAssessment {
            score: 0,
            level: "low",
            step_up_required: false,
            signals: Vec::new(),
        };
    }
    let mut score = 0;
    let mut signals = Vec::new();
    if !device_present {
        score += 30;
        signals.push("missing_device_id");
    } else if !known_device {
        score += 35;
        signals.push("new_device");
    }
    if ip_present && !known_ip {
        score += 25;
        signals.push("new_ip");
    }
    if recent_other_ip {
        score += 25;
        signals.push("rapid_ip_change");
    }
    LoginRiskAssessment {
        score,
        level: if score >= ADAPTIVE_MFA_THRESHOLD {
            "high"
        } else if score >= 35 {
            "medium"
        } else {
            "low"
        },
        step_up_required: score >= ADAPTIVE_MFA_THRESHOLD,
        signals,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ElevationSpec {
    user_id: String,
    permissions: Vec<String>,
    duration_minutes: i64,
    reason: String,
}

fn elevation_spec(value: &Value, max_minutes: i64) -> Result<ElevationSpec, AppError> {
    let spec: ElevationSpec = serde_json::from_value(value.clone())
        .map_err(|_| AppError::validation("temporary elevation details are invalid"))?;
    validate_elevation(
        &spec.user_id,
        spec.permissions,
        spec.duration_minutes,
        &spec.reason,
        max_minutes,
    )
}

fn validate_elevation(
    user_id: &str,
    permissions: Vec<String>,
    duration_minutes: i64,
    reason: &str,
    max_minutes: i64,
) -> Result<ElevationSpec, AppError> {
    let user_id = user_id.trim();
    let reason = reason.trim();
    if user_id.is_empty() || user_id.len() > 120 {
        return Err(AppError::validation("userId is required"));
    }
    if !(5..=max_minutes).contains(&duration_minutes) {
        return Err(AppError::validation(format!(
            "durationMinutes must be between 5 and {max_minutes}"
        )));
    }
    if !(5..=240).contains(&reason.len()) {
        return Err(AppError::validation(
            "reason must be between 5 and 240 characters",
        ));
    }
    let catalog: HashSet<&str> = auth_service::TENANT_PERMISSION_CATALOG
        .iter()
        .map(|permission| permission.code)
        .collect();
    let permissions = permissions
        .into_iter()
        .map(|permission| permission.trim().to_ascii_lowercase())
        .filter(|permission| !permission.is_empty())
        .collect::<BTreeSet<_>>();
    if permissions.is_empty()
        || permissions.len() > 20
        || permissions
            .iter()
            .any(|permission| !catalog.contains(permission.as_str()))
    {
        return Err(AppError::validation(
            "permissions must contain 1 to 20 known permission codes",
        ));
    }
    Ok(ElevationSpec {
        user_id: user_id.to_string(),
        permissions: permissions.into_iter().collect(),
        duration_minutes,
        reason: reason.to_string(),
    })
}

fn list_status<'a>(status: &'a str, allowed: &[&str]) -> Result<&'a str, AppError> {
    let status = status.trim();
    if allowed.contains(&status) {
        Ok(status)
    } else {
        Err(AppError::validation("invalid status filter"))
    }
}

fn validate_access_rule(
    rule_type: &str,
    match_value: &str,
    effect: &str,
    reason: &str,
) -> Result<(String, String, String), AppError> {
    if !rule_type.trim().eq_ignore_ascii_case("ip") {
        return Err(AppError::validation("only IP access rules are supported"));
    }
    let match_value = match_value
        .trim()
        .parse::<IpAddr>()
        .map_err(|_| AppError::validation("matchValue must be a valid IP address"))?
        .to_string();
    let effect = effect.trim().to_ascii_lowercase();
    if !matches!(effect.as_str(), "allow" | "watch" | "deny") {
        return Err(AppError::validation("access-rule effect is invalid"));
    }
    let reason = reason.trim();
    if reason.len() > 240 || (effect == "deny" && reason.is_empty()) {
        return Err(AppError::validation(
            "reason is required for deny rules and must not exceed 240 characters",
        ));
    }
    Ok((match_value, effect, reason.to_string()))
}

fn validate_incident_playbook(
    playbook_key: &str,
    title: &str,
    severity: &str,
    checklist: &[String],
) -> Result<(String, String, String, Vec<String>), AppError> {
    let playbook_key = playbook_key.trim().to_ascii_lowercase();
    if !(3..=80).contains(&playbook_key.len())
        || !playbook_key
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-'))
    {
        return Err(AppError::validation("playbookKey is invalid"));
    }
    let title = title.trim();
    if !(3..=120).contains(&title.len()) || title.chars().any(char::is_control) {
        return Err(AppError::validation(
            "title must be between 3 and 120 characters",
        ));
    }
    let severity = severity.trim().to_ascii_lowercase();
    if !matches!(severity.as_str(), "info" | "warning" | "critical") {
        return Err(AppError::validation("incident severity is invalid"));
    }
    if !(1..=20).contains(&checklist.len()) {
        return Err(AppError::validation(
            "checklist must contain between 1 and 20 steps",
        ));
    }
    let mut seen = HashSet::new();
    let mut steps = Vec::with_capacity(checklist.len());
    for step in checklist {
        let step = step.trim();
        if !(3..=200).contains(&step.len()) || step.chars().any(char::is_control) {
            return Err(AppError::validation(
                "each checklist step must be between 3 and 200 characters",
            ));
        }
        if !seen.insert(step.to_ascii_lowercase()) {
            return Err(AppError::validation("checklist steps must be unique"));
        }
        steps.push(step.to_string());
    }
    Ok((playbook_key, title.to_string(), severity, steps))
}

fn validate_privacy_request(
    subject_type: &str,
    subject_id: &str,
    request_type: &str,
    summary: &str,
) -> Result<(String, String, String, String), AppError> {
    let subject_type = safe_identifier(subject_type, 2, 40, "subjectType")?;
    let request_type = safe_identifier(request_type, 2, 80, "requestType")?;
    let subject_id = clean_text(subject_id, 120, false, "subjectId")?;
    let summary = clean_text(summary, 500, true, "summary")?;
    Ok((subject_type, subject_id, request_type, summary))
}

fn validate_disclosure_report(
    reporter_name: &str,
    reporter_contact: &str,
    summary: &str,
    details: &str,
    severity: &str,
) -> Result<(String, String, String, String, String), AppError> {
    let reporter_name = clean_text(reporter_name, 120, false, "reporterName")?;
    let reporter_contact = clean_text(reporter_contact, 180, false, "reporterContact")?;
    let summary = clean_text(summary, 500, true, "summary")?;
    let details = clean_text(details, 4000, false, "details")?;
    let severity = severity.trim().to_ascii_lowercase();
    if !matches!(severity.as_str(), "info" | "warning" | "critical") {
        return Err(AppError::validation("disclosure severity is invalid"));
    }
    Ok((reporter_name, reporter_contact, summary, details, severity))
}

fn validate_resolution_note(value: &str) -> Result<String, AppError> {
    clean_text(value, 500, false, "resolutionNote")
}

fn safe_identifier(
    value: &str,
    min_len: usize,
    max_len: usize,
    field: &str,
) -> Result<String, AppError> {
    let value = value.trim().to_ascii_lowercase();
    if !(min_len..=max_len).contains(&value.len())
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(AppError::validation(format!("{field} is invalid")));
    }
    Ok(value)
}

fn clean_text(
    value: &str,
    max_len: usize,
    required: bool,
    field: &str,
) -> Result<String, AppError> {
    let value = value.trim();
    if (required && value.is_empty())
        || value.len() > max_len
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(AppError::validation(format!(
            "{field} must {}exceed {max_len} characters",
            if required { "not be empty or " } else { "not " }
        )));
    }
    Ok(value.to_string())
}

fn compact_token(value: &str, max_len: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|value| !value.is_control())
        .take(max_len)
        .collect()
}

fn privileged_scope(value: Option<&str>) -> Result<String, AppError> {
    let value = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PRIVILEGED_SCOPE);
    if value.len() > 80
        || !value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err(AppError::validation("actionScope is invalid"));
    }
    Ok(value.to_string())
}

fn required_device_id(device_id: &str) -> Result<String, AppError> {
    clean_device_id(Some(device_id))?.ok_or_else(|| AppError::validation("deviceId is required"))
}

fn clean_device_id(device_id: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(device_id) = device_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if device_id.len() > 180 {
        return Err(AppError::validation(
            "deviceId must not exceed 180 characters",
        ));
    }
    Ok(Some(device_id.to_string()))
}

async fn audit_change(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    event_type: &str,
    details: Value,
) {
    let _ = auth_repository::audit(
        db,
        AuthAuditInput {
            tenant_id,
            user_id: Some(actor_id),
            session_id: None,
            branch_id: Some(branch_id),
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
    use super::{
        base32_decode, base32_encode, enforce_role_limit, hotp, scope_requires_mfa,
        validate_policy, verify_totp, SecurityPolicy,
    };

    #[test]
    fn policy_rejects_unbounded_audit_queries() {
        let mut policy = SecurityPolicy::default();
        assert!(validate_policy(&policy).is_ok());
        policy.audit_page_size = 251;
        assert!(validate_policy(&policy).is_err());
        policy.audit_page_size = 100;
        policy.audit_retention_days = 0;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn totp_matches_rfc_6238_sha1_vector() {
        let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        assert_eq!(hotp(secret, 1).as_deref(), Some("287082"));
        assert!(verify_totp(secret, "287082", 59));
    }

    #[test]
    fn base32_round_trip_preserves_secret_bytes() {
        let bytes = b"AuraShine MFA secret";
        assert_eq!(
            base32_decode(&base32_encode(bytes)).as_deref(),
            Some(bytes.as_slice())
        );
    }

    #[test]
    fn privileged_scopes_require_mfa() {
        assert!(scope_requires_mfa("Owner", &[]));
        assert!(scope_requires_mfa(
            "Regional Lead",
            &["finance.write".into()]
        ));
        assert!(scope_requires_mfa("Regional Lead", &["pos.refund".into()]));
        assert!(!scope_requires_mfa(
            "Receptionist",
            &["clients.manage".into()]
        ));
    }

    #[test]
    fn role_limits_are_optional_and_inclusive() {
        assert!(enforce_role_limit(None, 10_000, "refund").is_ok());
        assert!(enforce_role_limit(Some(10_000), 10_000, "refund").is_ok());
        assert!(enforce_role_limit(Some(10_000), 10_001, "refund").is_err());
    }

    #[test]
    fn device_id_validation_allows_absent_legacy_clients() {
        assert!(super::clean_device_id(None).unwrap().is_none());
        assert!(super::clean_device_id(Some(" ")).unwrap().is_none());
        assert_eq!(
            super::clean_device_id(Some(" device-1 "))
                .unwrap()
                .as_deref(),
            Some("device-1")
        );
        assert!(super::clean_device_id(Some(&"x".repeat(181))).is_err());
    }

    #[test]
    fn rapid_new_device_and_ip_requires_step_up() {
        let risk = super::login_risk_assessment(true, true, false, true, false, true);
        assert_eq!(risk.score, 85);
        assert!(risk.step_up_required);
        assert_eq!(
            super::login_risk_assessment(false, true, false, true, false, true).score,
            0
        );
    }

    #[test]
    fn privileged_scope_accepts_safe_action_ids_only() {
        assert_eq!(
            super::privileged_scope(None).unwrap(),
            super::DEFAULT_PRIVILEGED_SCOPE
        );
        assert_eq!(
            super::privileged_scope(Some(" finance.refund ")).unwrap(),
            "finance.refund"
        );
        assert!(super::privileged_scope(Some("refund now")).is_err());
        assert!(super::privileged_scope(Some(&"x".repeat(81))).is_err());
    }

    #[test]
    fn access_rule_validation_accepts_only_ip_values_and_known_effects() {
        let rule = super::validate_access_rule("ip", " 203.0.113.10 ", "WATCH", "").unwrap();
        assert_eq!(rule, ("203.0.113.10".into(), "watch".into(), "".into()));
        assert!(super::validate_access_rule("ip", "not-an-ip", "watch", "").is_err());
        assert!(super::validate_access_rule("ip", "203.0.113.10", "block", "").is_err());
        assert!(super::validate_access_rule("ip", "203.0.113.10", "deny", "").is_err());
    }

    #[test]
    fn incident_playbooks_require_unique_bounded_steps() {
        let checklist = vec![
            "Preserve audit evidence".into(),
            "Revoke affected sessions".into(),
        ];
        let playbook = super::validate_incident_playbook(
            "account_takeover",
            "Account Takeover",
            "critical",
            &checklist,
        )
        .unwrap();
        assert_eq!(playbook.3, checklist);
        assert!(super::validate_incident_playbook(
            "account_takeover",
            "Account Takeover",
            "critical",
            &["Repeat".into(), "repeat".into()],
        )
        .is_err());
    }

    #[test]
    fn privacy_and_disclosure_inputs_are_bounded() {
        let request = super::validate_privacy_request(
            " client ",
            "client-42",
            "data_export",
            "Export requested records",
        )
        .unwrap();
        assert_eq!(request.0, "client");
        assert!(
            super::validate_privacy_request("client record", "", "export", "Valid summary")
                .is_err()
        );
        assert!(super::validate_disclosure_report("", "", "Issue", "", "urgent").is_err());
    }

    #[test]
    fn compliance_bundle_id_is_stable_and_scope_bound() {
        let first =
            super::evidence_bundle_id("tenant-a", "branch-a", "2026-07-14T00:00:00Z", "hash");
        assert_eq!(
            first,
            super::evidence_bundle_id("tenant-a", "branch-a", "2026-07-14T00:00:00Z", "hash")
        );
        assert_ne!(
            first,
            super::evidence_bundle_id("tenant-a", "branch-b", "2026-07-14T00:00:00Z", "hash")
        );
    }
}
