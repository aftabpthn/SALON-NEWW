use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySettingsRecord {
    pub policy_json: Value,
    pub updated_by: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAuditRecord {
    pub id: String,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub branch_id: Option<String>,
    pub identity: Option<String>,
    pub event_type: String,
    pub outcome: String,
    pub ip_address: Option<String>,
    pub details_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FieldAuditRecord {
    pub id: String,
    pub actor_user_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub field_group: String,
    pub field_name: String,
    pub access_type: String,
    pub masking_applied: bool,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuditChainStatus {
    pub valid: bool,
    pub events: i64,
    pub sealed_events: i64,
    pub head_hash: String,
    pub failed_event_id: Option<String>,
    pub failed_at: Option<i64>,
    pub sealed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySessionRecord {
    pub session_id: String,
    pub user_id: String,
    pub branch_id: Option<String>,
    pub role_name: Option<String>,
    pub device_id: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityDeviceRecord {
    pub user_id: String,
    pub device_id: String,
    pub status: String,
    pub active_sessions: i64,
    pub ip_count: i64,
    pub user_agent_count: i64,
    pub first_seen_at: Option<DateTime<Utc>>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub trusted_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegedSessionRecord {
    pub user_id: String,
    pub session_id: String,
    pub action_scope: String,
    pub verification_method: String,
    pub verified_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAlertRecord {
    pub id: String,
    pub alert_type: String,
    pub severity: String,
    pub status: String,
    pub summary: String,
    pub source_ip: Option<String>,
    pub user_id: Option<String>,
    pub details_json: Value,
    pub detected_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolved_by: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityBlockRecord {
    pub id: String,
    pub ip_address: Option<String>,
    pub user_id: Option<String>,
    pub reason: String,
    pub severity: String,
    pub blocked_until: Option<DateTime<Utc>>,
    pub unblocked_at: Option<DateTime<Utc>>,
    pub unblocked_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FraudWarningRecord {
    pub id: String,
    pub title: String,
    pub message: String,
    pub severity: String,
    pub status: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityApprovalRecord {
    pub id: String,
    pub requested_by: String,
    pub decided_by: Option<String>,
    pub action_type: String,
    pub summary: String,
    pub details_json: Value,
    pub status: String,
    pub decision_note: String,
    pub decided_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAccessRuleRecord {
    pub id: String,
    pub rule_type: String,
    pub match_value: String,
    pub effect: String,
    pub reason: String,
    pub status: String,
    pub created_by: String,
    pub disabled_by: Option<String>,
    pub disabled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct LoginRiskSignals {
    pub has_history: bool,
    pub known_device: bool,
    pub known_ip: bool,
    pub recent_other_ip: bool,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TemporaryElevationRecord {
    pub id: String,
    pub user_id: String,
    pub permissions_json: Value,
    pub source: String,
    pub approval_id: Option<String>,
    pub reason: String,
    pub created_by: String,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub revoked_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IncidentPlaybookRecord {
    pub id: String,
    pub playbook_key: String,
    pub title: String,
    pub severity: String,
    pub checklist_json: Value,
    pub status: String,
    pub created_by: String,
    pub disabled_by: Option<String>,
    pub disabled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyRequestRecord {
    pub id: String,
    pub requester_id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub request_type: String,
    pub summary: String,
    pub status: String,
    pub resolution_note: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DisclosureReportRecord {
    pub id: String,
    pub reporter_name: String,
    pub reporter_contact: String,
    pub summary: String,
    pub details: String,
    pub severity: String,
    pub status: String,
    pub resolution_note: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityCounts {
    pub open_alerts: i64,
    pub active_blocks: i64,
    pub active_sessions: i64,
    pub audit_events: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceEvidenceCounts {
    pub mfa_enabled_users: i64,
    pub active_api_clients: i64,
    pub trusted_devices: i64,
    pub active_privileged_sessions: i64,
    pub field_audit_events: i64,
    pub open_fraud_risks: i64,
    pub active_fraud_warnings: i64,
    pub active_playbooks: i64,
    pub open_privacy_requests: i64,
    pub new_disclosure_reports: i64,
    pub pending_approvals: i64,
    pub active_access_rules: i64,
    pub policy_enabled_sso_providers: i64,
    pub enforced_sso_roles: i64,
}

#[derive(Debug, FromRow)]
pub struct MfaFactorRecord {
    pub secret_ciphertext: String,
    pub recovery_code_hashes: Value,
    pub enabled: bool,
    pub verified_at: Option<DateTime<Utc>>,
}

pub async fn get_mfa_factor(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<MfaFactorRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT secret_ciphertext, recovery_code_hashes, enabled, verified_at
        FROM auth_mfa_factors
        WHERE tenant_id=$1 AND user_id=$2
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn save_pending_mfa_factor(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    secret_ciphertext: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        INSERT INTO auth_mfa_factors (tenant_id, user_id, secret_ciphertext)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
          secret_ciphertext=EXCLUDED.secret_ciphertext,
          recovery_code_hashes='{}'::jsonb,
          verified_at=NULL,
          updated_at=NOW()
        WHERE auth_mfa_factors.enabled=FALSE
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(secret_ciphertext)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn enable_mfa_factor(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    recovery_code_hashes: Value,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE auth_mfa_factors
        SET enabled=TRUE, recovery_code_hashes=$3, verified_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND user_id=$2 AND enabled=FALSE
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(recovery_code_hashes)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn consume_recovery_code(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    code_hash: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE auth_mfa_factors
        SET recovery_code_hashes=recovery_code_hashes - $3, updated_at=NOW()
        WHERE tenant_id=$1 AND user_id=$2 AND enabled=TRUE
          AND recovery_code_hashes ? $3
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(code_hash)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_mfa_factor(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM auth_mfa_factors WHERE tenant_id=$1 AND user_id=$2 AND enabled=TRUE",
    )
    .bind(tenant_id)
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebauthnCredentialRecord {
    pub id: String,
    pub credential_id: String,
    pub label: String,
    #[serde(skip_serializing)]
    pub passkey_json: Value,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
pub struct WebauthnChallengeRecord {
    pub tenant_id: String,
    pub user_id: String,
    pub state_json: Value,
    pub label: Option<String>,
}

pub async fn list_webauthn_credentials(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Vec<WebauthnCredentialRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, credential_id, label, passkey_json, created_at, last_used_at
        FROM auth_webauthn_credentials
        WHERE tenant_id=$1 AND user_id=$2
        ORDER BY created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_all(db)
    .await
}

pub async fn save_webauthn_challenge(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    ceremony: &str,
    state_json: Value,
    label: Option<&str>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        INSERT INTO auth_webauthn_challenges (tenant_id, user_id, ceremony, state_json, label)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(ceremony)
    .bind(state_json)
    .bind(label)
    .fetch_one(db)
    .await
}

pub async fn take_webauthn_challenge(
    db: &PgPool,
    challenge_id: &str,
    ceremony: &str,
    tenant_id: Option<&str>,
    user_id: Option<&str>,
) -> Result<Option<WebauthnChallengeRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        DELETE FROM auth_webauthn_challenges
        WHERE id=$1 AND ceremony=$2 AND expires_at > NOW()
          AND ($3::text IS NULL OR tenant_id=$3)
          AND ($4::text IS NULL OR user_id=$4)
        RETURNING tenant_id, user_id, state_json, label
        "#,
    )
    .bind(challenge_id)
    .bind(ceremony)
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn create_webauthn_credential(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    credential_id: &str,
    label: &str,
    passkey_json: Value,
) -> Result<WebauthnCredentialRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO auth_webauthn_credentials
          (tenant_id, user_id, credential_id, label, passkey_json)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, credential_id, label, passkey_json, created_at, last_used_at
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(credential_id)
    .bind(label)
    .bind(passkey_json)
    .fetch_one(db)
    .await
}

pub async fn update_webauthn_credential(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    credential_id: &str,
    passkey_json: Value,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE auth_webauthn_credentials
        SET passkey_json=$4, last_used_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND user_id=$2 AND credential_id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(credential_id)
    .bind(passkey_json)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_webauthn_credential(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    credential_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM auth_webauthn_credentials WHERE tenant_id=$1 AND user_id=$2 AND credential_id=$3",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(credential_id)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn get_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<SecuritySettingsRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT policy_json, updated_by, updated_at FROM security_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    policy: Value,
    actor_id: &str,
) -> Result<SecuritySettingsRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_settings (tenant_id, branch_id, policy_json, updated_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, branch_id) DO UPDATE SET
          policy_json=EXCLUDED.policy_json,
          updated_by=EXCLUDED.updated_by,
          updated_at=NOW()
        RETURNING policy_json, updated_by, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(policy)
    .bind(actor_id)
    .fetch_one(db)
    .await
}

pub async fn counts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SecurityCounts, sqlx::Error> {
    let row = sqlx::query_as::<_, (i64, i64, i64, i64)>(
        r#"
        SELECT
          (SELECT COUNT(*) FROM security_alerts WHERE tenant_id=$1 AND branch_id=$2 AND status='open'),
          (SELECT COUNT(*) FROM security_blocklist WHERE tenant_id=$1 AND branch_id=$2
             AND unblocked_at IS NULL AND (blocked_until IS NULL OR blocked_until > NOW())),
          (SELECT COUNT(DISTINCT session_id) FROM auth_refresh_tokens WHERE tenant_id=$1
             AND branch_id=$2 AND revoked_at IS NULL AND expires_at > NOW()),
          (SELECT COUNT(*) FROM auth_audit_logs WHERE tenant_id=$1
             AND (branch_id=$2 OR branch_id IS NULL))
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await?;
    Ok(SecurityCounts {
        open_alerts: row.0,
        active_blocks: row.1,
        active_sessions: row.2,
        audit_events: row.3,
    })
}

pub async fn compliance_evidence_counts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<ComplianceEvidenceCounts, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          (SELECT COUNT(*) FROM auth_mfa_factors WHERE tenant_id=$1 AND enabled=TRUE) AS mfa_enabled_users,
          (SELECT COUNT(*) FROM integration_api_keys WHERE tenant_id=$1 AND branch_id=$2 AND status='active' AND (expires_at IS NULL OR expires_at > NOW())) AS active_api_clients,
          (SELECT COUNT(*) FROM security_trusted_devices WHERE tenant_id=$1 AND branch_id=$2 AND status='trusted') AS trusted_devices,
          (SELECT COUNT(*) FROM security_privileged_sessions WHERE tenant_id=$1 AND branch_id=$2 AND revoked_at IS NULL AND expires_at > NOW()) AS active_privileged_sessions,
          (SELECT COUNT(*) FROM security_field_audit_events WHERE tenant_id=$1 AND branch_id=$2) AS field_audit_events,
          (SELECT COUNT(*) FROM pos_financial_risk_cases WHERE tenant_id=$1 AND branch_id=$2 AND status='open') AS open_fraud_risks,
          (SELECT COUNT(*) FROM security_fraud_warnings WHERE tenant_id=$1 AND branch_id=$2 AND status='active') AS active_fraud_warnings,
          (SELECT COUNT(*) FROM security_incident_playbooks WHERE tenant_id=$1 AND branch_id=$2 AND status='active') AS active_playbooks,
          (SELECT COUNT(*) FROM security_privacy_requests WHERE tenant_id=$1 AND branch_id=$2 AND status='open') AS open_privacy_requests,
          (SELECT COUNT(*) FROM security_disclosure_reports WHERE tenant_id=$1 AND branch_id=$2 AND status='new') AS new_disclosure_reports,
          (SELECT COUNT(*) FROM security_approval_requests WHERE tenant_id=$1 AND branch_id=$2 AND status='pending') AS pending_approvals,
          (SELECT COUNT(*) FROM security_access_rules WHERE tenant_id=$1 AND branch_id=$2 AND status='active') AS active_access_rules,
          COALESCE((SELECT (google_enabled::INT + microsoft_enabled::INT + saml_enabled::INT)::BIGINT FROM auth_sso_policies WHERE tenant_id=$1), 0) AS policy_enabled_sso_providers,
          COALESCE((SELECT CARDINALITY(enforced_roles)::BIGINT FROM auth_sso_policies WHERE tenant_id=$1), 0) AS enforced_sso_roles
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn list_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: &str,
    retention_days: i64,
    limit: i64,
) -> Result<Vec<SecurityAuditRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, user_id, session_id, branch_id, identity, event_type, outcome,
               ip_address, details_json, created_at
        FROM auth_audit_logs
        WHERE tenant_id=$1 AND (branch_id=$2 OR branch_id IS NULL)
          AND ($3='' OR event_type ILIKE '%' || $3 || '%' OR outcome ILIKE '%' || $3 || '%'
               OR COALESCE(identity, '') ILIKE '%' || $3 || '%')
          AND created_at >= NOW() - ($4 * INTERVAL '1 day')
        ORDER BY created_at DESC
        LIMIT $5
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(query)
    .bind(retention_days)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn list_field_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    field_filter: &str,
) -> Result<Vec<FieldAuditRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, actor_user_id, entity_type, entity_id, field_group, field_name,
               access_type, masking_applied, reason, created_at
        FROM security_field_audit_events
        WHERE tenant_id=$1 AND (branch_id=$2 OR branch_id='')
          AND ($3='' OR field_group ILIKE '%' || $3 || '%' OR field_name ILIKE '%' || $3 || '%'
               OR entity_type ILIKE '%' || $3 || '%' OR actor_user_id ILIKE '%' || $3 || '%')
        ORDER BY created_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(field_filter)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn record_field_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    entity_type: &str,
    entity_id: &str,
    field_group: &str,
    field_name: &str,
    access_type: &str,
    masking_applied: bool,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO security_field_audit_events (
          tenant_id, branch_id, actor_user_id, entity_type, entity_id,
          field_group, field_name, access_type, masking_applied, reason
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_user_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(field_group)
    .bind(field_name)
    .bind(access_type)
    .bind(masking_applied)
    .bind(reason)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn verify_audit_chain(
    db: &PgPool,
    tenant_id: &str,
) -> Result<AuditChainStatus, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH ordered AS (
          SELECT
            audit.*,
            COALESCE(LAG(entry_hash) OVER (ORDER BY chain_sequence), '') AS expected_previous
          FROM auth_audit_logs audit
          WHERE tenant_id=$1
        ),
        checked AS (
          SELECT
            ordered.*,
            previous_hash=expected_previous
              AND entry_hash=auth_audit_entry_hash(
                chain_sequence, id, tenant_id, user_id, session_id, branch_id,
                identity, event_type, outcome, ip_address, user_agent, details_json,
                created_at, previous_hash
              ) AS valid
          FROM ordered
        ),
        aggregate AS (
          SELECT
            COALESCE(BOOL_AND(valid), TRUE) AS rows_valid,
            COUNT(*)::BIGINT AS events,
            COUNT(entry_hash)::BIGINT AS sealed_events,
            COALESCE((ARRAY_AGG(entry_hash ORDER BY chain_sequence DESC))[1], '') AS head_hash,
            MAX(created_at) AS sealed_at
          FROM checked
        )
        SELECT
          aggregate.rows_valid
            AND COALESCE(head.event_count, 0)=aggregate.events
            AND COALESCE(head.head_hash, '')=aggregate.head_hash AS valid,
          aggregate.events,
          aggregate.sealed_events,
          aggregate.head_hash,
          (SELECT id FROM checked WHERE NOT valid ORDER BY chain_sequence LIMIT 1) AS failed_event_id,
          (SELECT chain_sequence FROM checked WHERE NOT valid ORDER BY chain_sequence LIMIT 1) AS failed_at,
          aggregate.sealed_at
        FROM aggregate
        LEFT JOIN auth_audit_chain_heads head ON head.tenant_id=$1
        "#,
    )
    .bind(tenant_id)
    .fetch_one(db)
    .await
}

pub async fn list_sessions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SecuritySessionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT DISTINCT ON (session_id)
          session_id, user_id, branch_id, role_name, device_id, ip_address, user_agent,
          created_at, last_used_at, expires_at
        FROM auth_refresh_tokens
        WHERE tenant_id=$1 AND branch_id=$2 AND revoked_at IS NULL AND expires_at > NOW()
        ORDER BY session_id, created_at DESC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn revoke_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE auth_refresh_tokens
        SET revoked_at=NOW(), revoke_reason=$4
        WHERE tenant_id=$1 AND branch_id=$2 AND session_id=$3 AND revoked_at IS NULL
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(reason)
    .execute(db)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_devices(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SecurityDeviceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH token_devices AS (
          SELECT
            user_id,
            BTRIM(device_id) AS device_id,
            COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::BIGINT AS active_sessions,
            COUNT(DISTINCT NULLIF(BTRIM(ip_address), ''))::BIGINT AS ip_count,
            COUNT(DISTINCT NULLIF(BTRIM(user_agent), ''))::BIGINT AS user_agent_count,
            MIN(created_at) AS first_seen_at,
            MAX(COALESCE(last_used_at, created_at)) AS last_seen_at
          FROM auth_refresh_tokens
          WHERE tenant_id=$1 AND branch_id=$2 AND COALESCE(BTRIM(device_id), '') <> ''
          GROUP BY user_id, BTRIM(device_id)
        ),
        known_devices AS (
          SELECT user_id, device_id FROM token_devices
          UNION
          SELECT user_id, device_id
          FROM security_trusted_devices
          WHERE tenant_id=$1 AND branch_id=$2
        )
        SELECT
          k.user_id,
          k.device_id,
          COALESCE(t.status, 'trusted') AS status,
          COALESCE(d.active_sessions, 0)::BIGINT AS active_sessions,
          COALESCE(d.ip_count, 0)::BIGINT AS ip_count,
          COALESCE(d.user_agent_count, 0)::BIGINT AS user_agent_count,
          d.first_seen_at,
          d.last_seen_at,
          t.trusted_at,
          t.revoked_at
        FROM known_devices k
        LEFT JOIN token_devices d ON d.user_id=k.user_id AND d.device_id=k.device_id
        LEFT JOIN security_trusted_devices t
          ON t.tenant_id=$1 AND t.branch_id=$2 AND t.user_id=k.user_id AND t.device_id=k.device_id
        ORDER BY COALESCE(d.last_seen_at, t.updated_at, t.created_at) DESC NULLS LAST
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn device_revoked(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    device_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT EXISTS(
          SELECT 1 FROM security_trusted_devices
          WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND device_id=$4 AND status='revoked'
        )
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(device_id)
    .fetch_one(db)
    .await
}

pub async fn trust_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    user_id: &str,
    device_id: &str,
) -> Result<SecurityDeviceRecord, sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO security_trusted_devices(
          tenant_id,branch_id,user_id,device_id,status,trusted_at,trusted_by
        ) VALUES ($1,$2,$3,$4,'trusted',NOW(),$5)
        ON CONFLICT (tenant_id,branch_id,user_id,device_id) DO UPDATE SET
          status='trusted',
          trusted_at=NOW(),
          trusted_by=EXCLUDED.trusted_by,
          revoked_at=NULL,
          revoked_by=NULL,
          updated_at=NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(device_id)
    .bind(actor_id)
    .execute(db)
    .await?;
    get_device(db, tenant_id, branch_id, user_id, device_id).await
}

pub async fn revoke_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    user_id: &str,
    device_id: &str,
) -> Result<SecurityDeviceRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO security_trusted_devices(
          tenant_id,branch_id,user_id,device_id,status,revoked_at,revoked_by
        ) VALUES ($1,$2,$3,$4,'revoked',NOW(),$5)
        ON CONFLICT (tenant_id,branch_id,user_id,device_id) DO UPDATE SET
          status='revoked',
          revoked_at=NOW(),
          revoked_by=EXCLUDED.revoked_by,
          updated_at=NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(device_id)
    .bind(actor_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        UPDATE auth_refresh_tokens
        SET revoked_at=NOW(), revoke_reason='security_device_revoked'
        WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND BTRIM(device_id)=$4
          AND revoked_at IS NULL
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(device_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    get_device(db, tenant_id, branch_id, user_id, device_id).await
}

pub async fn sign_out_user_devices(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        r#"
        UPDATE auth_refresh_tokens
        SET revoked_at=NOW(), revoke_reason='security_all_devices_signout'
        WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND revoked_at IS NULL
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .execute(db)
    .await?
    .rows_affected())
}

async fn get_device(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    device_id: &str,
) -> Result<SecurityDeviceRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          $3::TEXT AS user_id,
          $4::TEXT AS device_id,
          COALESCE(t.status, 'trusted') AS status,
          COALESCE(d.active_sessions, 0)::BIGINT AS active_sessions,
          COALESCE(d.ip_count, 0)::BIGINT AS ip_count,
          COALESCE(d.user_agent_count, 0)::BIGINT AS user_agent_count,
          d.first_seen_at,
          d.last_seen_at,
          t.trusted_at,
          t.revoked_at
        FROM (SELECT 1) seed
        LEFT JOIN (
          SELECT
            COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::BIGINT AS active_sessions,
            COUNT(DISTINCT NULLIF(BTRIM(ip_address), ''))::BIGINT AS ip_count,
            COUNT(DISTINCT NULLIF(BTRIM(user_agent), ''))::BIGINT AS user_agent_count,
            MIN(created_at) AS first_seen_at,
            MAX(COALESCE(last_used_at, created_at)) AS last_seen_at
          FROM auth_refresh_tokens
          WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND BTRIM(device_id)=$4
        ) d ON TRUE
        LEFT JOIN security_trusted_devices t
          ON t.tenant_id=$1 AND t.branch_id=$2 AND t.user_id=$3 AND t.device_id=$4
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(device_id)
    .fetch_one(db)
    .await
}

pub async fn active_privileged_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    action_scope: &str,
) -> Result<Option<PrivilegedSessionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT user_id,session_id,action_scope,verification_method,verified_at,expires_at
        FROM security_privileged_sessions
        WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND session_id=$4
          AND action_scope=$5 AND revoked_at IS NULL AND expires_at>NOW()
        ORDER BY expires_at DESC
        LIMIT 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(session_id)
    .bind(action_scope)
    .fetch_optional(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert_privileged_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
    action_scope: &str,
    verification_method: &str,
    ttl_minutes: i64,
) -> Result<PrivilegedSessionRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_privileged_sessions(
          tenant_id,branch_id,user_id,session_id,action_scope,verification_method,expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW()+($7::BIGINT*INTERVAL '1 minute'))
        ON CONFLICT (tenant_id,branch_id,user_id,session_id,action_scope) DO UPDATE SET
          verification_method=EXCLUDED.verification_method,
          verified_at=NOW(),
          expires_at=EXCLUDED.expires_at,
          revoked_at=NULL,
          updated_at=NOW()
        RETURNING user_id,session_id,action_scope,verification_method,verified_at,expires_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(session_id)
    .bind(action_scope)
    .bind(verification_method)
    .bind(ttl_minutes)
    .fetch_one(db)
    .await
}

pub async fn revoke_privileged_session(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    session_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        r#"
        UPDATE security_privileged_sessions
        SET revoked_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND user_id=$3 AND session_id=$4
          AND revoked_at IS NULL AND expires_at>NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(session_id)
    .execute(db)
    .await?
    .rows_affected()
        > 0)
}

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, requested_by, decided_by, action_type, summary, details_json,
               status, decision_note, decided_at, created_at, updated_at
        FROM security_approval_requests
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3)
        ORDER BY created_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn get_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    approval_id: &str,
) -> Result<Option<SecurityApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, requested_by, decided_by, action_type, summary, details_json,
               status, decision_note, decided_at, created_at, updated_at
        FROM security_approval_requests
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(approval_id)
    .fetch_optional(db)
    .await
}

pub async fn create_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    action_type: &str,
    summary: &str,
    details: &Value,
) -> Result<SecurityApprovalRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_approval_requests(
          tenant_id,branch_id,requested_by,action_type,summary,details_json
        ) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id, requested_by, decided_by, action_type, summary, details_json,
                  status, decision_note, decided_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_id)
    .bind(action_type)
    .bind(summary)
    .bind(details)
    .fetch_one(db)
    .await
}

pub async fn decide_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    approval_id: &str,
    actor_id: &str,
    decision: &str,
    note: &str,
) -> Result<Option<SecurityApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_approval_requests
        SET status=$5, decided_by=$4, decision_note=$6, decided_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'
          AND requested_by<>$4
        RETURNING id, requested_by, decided_by, action_type, summary, details_json,
                  status, decision_note, decided_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(approval_id)
    .bind(actor_id)
    .bind(decision)
    .bind(note)
    .fetch_optional(db)
    .await
}

pub async fn list_access_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityAccessRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, rule_type, match_value, effect, reason, status, created_by,
               disabled_by, disabled_at, created_at, updated_at
        FROM security_access_rules
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3)
        ORDER BY updated_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_access_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    match_value: &str,
    effect: &str,
    reason: &str,
) -> Result<SecurityAccessRuleRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_access_rules(
          tenant_id,branch_id,rule_type,match_value,effect,reason,created_by
        ) VALUES ($1,$2,'ip',$3,$4,$5,$6)
        RETURNING id, rule_type, match_value, effect, reason, status, created_by,
                  disabled_by, disabled_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(match_value)
    .bind(effect)
    .bind(reason)
    .bind(actor_id)
    .fetch_one(db)
    .await
}

pub async fn disable_access_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    rule_id: &str,
    actor_id: &str,
) -> Result<Option<SecurityAccessRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_access_rules
        SET status='disabled', disabled_by=$4, disabled_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active'
        RETURNING id, rule_type, match_value, effect, reason, status, created_by,
                  disabled_by, disabled_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(rule_id)
    .bind(actor_id)
    .fetch_optional(db)
    .await
}

pub async fn login_risk_signals(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    device_id: Option<&str>,
    ip_address: Option<&str>,
) -> Result<LoginRiskSignals, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          EXISTS(SELECT 1 FROM auth_refresh_tokens WHERE tenant_id=$1 AND user_id=$2) AS has_history,
          EXISTS(
            SELECT 1 FROM auth_refresh_tokens
            WHERE tenant_id=$1 AND user_id=$2 AND $3::TEXT IS NOT NULL
              AND BTRIM(device_id)=BTRIM($3)
          ) AS known_device,
          EXISTS(
            SELECT 1 FROM auth_refresh_tokens
            WHERE tenant_id=$1 AND user_id=$2 AND $4::TEXT IS NOT NULL
              AND BTRIM(ip_address)=BTRIM($4)
          ) AS known_ip,
          EXISTS(
            SELECT 1 FROM auth_refresh_tokens
            WHERE tenant_id=$1 AND user_id=$2 AND $4::TEXT IS NOT NULL
              AND COALESCE(BTRIM(ip_address),'')<>'' AND BTRIM(ip_address)<>BTRIM($4)
              AND COALESCE(last_used_at,created_at)>NOW()-INTERVAL '30 minutes'
          ) AS recent_other_ip
        "#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(device_id)
    .bind(ip_address)
    .fetch_one(db)
    .await
}

pub async fn active_elevated_permissions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT DISTINCT permission
        FROM security_temporary_elevations e,
             LATERAL JSONB_ARRAY_ELEMENTS_TEXT(e.permissions_json) permission
        WHERE e.tenant_id=$1 AND e.branch_id=$2 AND e.user_id=$3
          AND e.revoked_at IS NULL AND e.expires_at>NOW()
        ORDER BY permission
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_temporary_elevation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    permissions: &Value,
    source: &str,
    approval_id: Option<&str>,
    reason: &str,
    actor_id: &str,
    ttl_minutes: i64,
) -> Result<TemporaryElevationRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_temporary_elevations(
          tenant_id,branch_id,user_id,permissions_json,source,approval_id,reason,created_by,expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()+($9::BIGINT*INTERVAL '1 minute'))
        RETURNING id,user_id,permissions_json,source,approval_id,reason,created_by,
                  expires_at,revoked_at,revoked_by,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(permissions)
    .bind(source)
    .bind(approval_id)
    .bind(reason)
    .bind(actor_id)
    .bind(ttl_minutes)
    .fetch_one(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn approve_temporary_elevation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    approval_id: &str,
    actor_id: &str,
    note: &str,
    user_id: &str,
    permissions: &Value,
    reason: &str,
    ttl_minutes: i64,
) -> Result<Option<(SecurityApprovalRecord, TemporaryElevationRecord)>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let approval = sqlx::query_as::<_, SecurityApprovalRecord>(
        r#"
        UPDATE security_approval_requests
        SET status='approved',decided_by=$4,decision_note=$5,decided_at=NOW(),updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'
          AND requested_by<>$4 AND action_type='temporary_elevation'
        RETURNING id,requested_by,decided_by,action_type,summary,details_json,
                  status,decision_note,decided_at,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(approval_id)
    .bind(actor_id)
    .bind(note)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(approval) = approval else {
        tx.rollback().await?;
        return Ok(None);
    };
    let elevation = sqlx::query_as::<_, TemporaryElevationRecord>(
        r#"
        INSERT INTO security_temporary_elevations(
          tenant_id,branch_id,user_id,permissions_json,source,approval_id,reason,created_by,expires_at
        ) VALUES ($1,$2,$3,$4,'approval',$5,$6,$7,NOW()+($8::BIGINT*INTERVAL '1 minute'))
        RETURNING id,user_id,permissions_json,source,approval_id,reason,created_by,
                  expires_at,revoked_at,revoked_by,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(permissions)
    .bind(approval_id)
    .bind(reason)
    .bind(actor_id)
    .bind(ttl_minutes)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some((approval, elevation)))
}

pub async fn list_temporary_elevations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<TemporaryElevationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,user_id,permissions_json,source,approval_id,reason,created_by,
               expires_at,revoked_at,revoked_by,created_at
        FROM security_temporary_elevations
        WHERE tenant_id=$1 AND branch_id=$2
        ORDER BY created_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn revoke_temporary_elevation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    elevation_id: &str,
    actor_id: &str,
) -> Result<Option<TemporaryElevationRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_temporary_elevations
        SET revoked_at=NOW(),revoked_by=$4,updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
          AND revoked_at IS NULL AND expires_at>NOW()
        RETURNING id,user_id,permissions_json,source,approval_id,reason,created_by,
                  expires_at,revoked_at,revoked_by,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(elevation_id)
    .bind(actor_id)
    .fetch_optional(db)
    .await
}

pub async fn list_incident_playbooks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<IncidentPlaybookRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, playbook_key, title, severity, checklist_json, status, created_by,
               disabled_by, disabled_at, created_at, updated_at
        FROM security_incident_playbooks
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3)
        ORDER BY
          CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
          title
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_incident_playbook(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    playbook_key: &str,
    title: &str,
    severity: &str,
    checklist: &Value,
) -> Result<IncidentPlaybookRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_incident_playbooks(
          tenant_id,branch_id,playbook_key,title,severity,checklist_json,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, playbook_key, title, severity, checklist_json, status, created_by,
                  disabled_by, disabled_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(playbook_key)
    .bind(title)
    .bind(severity)
    .bind(checklist)
    .bind(actor_id)
    .fetch_one(db)
    .await
}

pub async fn disable_incident_playbook(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    playbook_id: &str,
    actor_id: &str,
) -> Result<Option<IncidentPlaybookRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_incident_playbooks
        SET status='disabled', disabled_by=$4, disabled_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active'
        RETURNING id, playbook_key, title, severity, checklist_json, status, created_by,
                  disabled_by, disabled_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(playbook_id)
    .bind(actor_id)
    .fetch_optional(db)
    .await
}

pub async fn list_privacy_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<PrivacyRequestRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, requester_id, subject_type, subject_id, request_type, summary, status,
               resolution_note, resolved_by, resolved_at, created_at, updated_at
        FROM security_privacy_requests
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3)
        ORDER BY created_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_privacy_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    requester_id: &str,
    subject_type: &str,
    subject_id: &str,
    request_type: &str,
    summary: &str,
) -> Result<PrivacyRequestRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_privacy_requests(
          tenant_id, branch_id, requester_id, subject_type, subject_id, request_type, summary
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, requester_id, subject_type, subject_id, request_type, summary, status,
                  resolution_note, resolved_by, resolved_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(requester_id)
    .bind(subject_type)
    .bind(subject_id)
    .bind(request_type)
    .bind(summary)
    .fetch_one(db)
    .await
}

pub async fn resolve_privacy_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    request_id: &str,
    actor_id: &str,
    resolution_note: &str,
) -> Result<Option<PrivacyRequestRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_privacy_requests
        SET status='resolved', resolution_note=$5, resolved_by=$4, resolved_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open'
        RETURNING id, requester_id, subject_type, subject_id, request_type, summary, status,
                  resolution_note, resolved_by, resolved_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(request_id)
    .bind(actor_id)
    .bind(resolution_note)
    .fetch_optional(db)
    .await
}

pub async fn list_disclosure_reports(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<DisclosureReportRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, reporter_name, reporter_contact, summary, details, severity, status,
               resolution_note, resolved_by, resolved_at, created_at, updated_at
        FROM security_disclosure_reports
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3)
        ORDER BY created_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn create_disclosure_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reporter_name: &str,
    reporter_contact: &str,
    summary: &str,
    details: &str,
    severity: &str,
) -> Result<DisclosureReportRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_disclosure_reports(
          tenant_id, branch_id, reporter_name, reporter_contact, summary, details, severity
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, reporter_name, reporter_contact, summary, details, severity, status,
                  resolution_note, resolved_by, resolved_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reporter_name)
    .bind(reporter_contact)
    .bind(summary)
    .bind(details)
    .bind(severity)
    .fetch_one(db)
    .await
}

pub async fn resolve_disclosure_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    report_id: &str,
    actor_id: &str,
    resolution_note: &str,
) -> Result<Option<DisclosureReportRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_disclosure_reports
        SET status='resolved', resolution_note=$5, resolved_by=$4, resolved_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='new'
        RETURNING id, reporter_name, reporter_contact, summary, details, severity, status,
                  resolution_note, resolved_by, resolved_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(report_id)
    .bind(actor_id)
    .bind(resolution_note)
    .fetch_optional(db)
    .await
}

pub async fn list_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityAlertRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, alert_type, severity, status, summary, source_ip, user_id,
               details_json, detected_at, resolved_at, resolved_by
        FROM security_alerts
        WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3)
        ORDER BY detected_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn resolve_alert(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    alert_id: &str,
    actor_id: &str,
) -> Result<Option<SecurityAlertRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_alerts SET status='resolved', resolved_at=NOW(), resolved_by=$4
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open'
        RETURNING id, alert_type, severity, status, summary, source_ip, user_id,
                  details_json, detected_at, resolved_at, resolved_by
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(alert_id)
    .bind(actor_id)
    .fetch_optional(db)
    .await
}

pub async fn list_blocks(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
) -> Result<Vec<SecurityBlockRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, ip_address, user_id, reason, severity, blocked_until,
               unblocked_at, unblocked_by, created_at
        FROM security_blocklist
        WHERE tenant_id=$1 AND branch_id=$2
          AND ($3='all'
            OR ($3='active' AND unblocked_at IS NULL AND (blocked_until IS NULL OR blocked_until > NOW()))
            OR ($3='inactive' AND (unblocked_at IS NOT NULL OR blocked_until <= NOW())))
        ORDER BY created_at DESC
        LIMIT 250
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .fetch_all(db)
    .await
}

pub async fn unblock(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    block_id: &str,
    actor_id: &str,
) -> Result<Option<SecurityBlockRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE security_blocklist
        SET unblocked_at=NOW(), unblocked_by=$4, updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND unblocked_at IS NULL
        RETURNING id, ip_address, user_id, reason, severity, blocked_until,
                  unblocked_at, unblocked_by, created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(block_id)
    .bind(actor_id)
    .fetch_optional(db)
    .await
}

pub async fn list_fraud_warnings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<FraudWarningRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,title,message,severity,status,created_by,created_at,updated_at
        FROM security_fraud_warnings
        WHERE tenant_id=$1 AND branch_id=$2 AND status='active'
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_fraud_warning(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    title: &str,
    message: &str,
    severity: &str,
) -> Result<FraudWarningRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO security_fraud_warnings(
          tenant_id,branch_id,title,message,severity,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id,title,message,severity,status,created_by,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(title)
    .bind(message)
    .bind(severity)
    .bind(actor_id)
    .fetch_one(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn record_intrusion_detection(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: Option<&str>,
    source_ip: Option<&str>,
    details: &Value,
    blocked: bool,
    block_seconds: i64,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let (alert_type, severity, summary) = if blocked {
        (
            "intrusion_auto_block",
            "critical",
            "Repeated suspicious probes automatically blocked",
        )
    } else {
        ("intrusion_probe", "warning", "Suspicious probe detected")
    };
    sqlx::query(
        r#"
        INSERT INTO security_alerts(
          tenant_id,branch_id,alert_type,severity,summary,source_ip,user_id,details_json
        )
        SELECT $1,$2,$3,$4,$5,$6,$7,$8
        WHERE NOT EXISTS (
          SELECT 1 FROM security_alerts
          WHERE tenant_id=$1 AND branch_id=$2 AND alert_type=$3 AND status='open'
            AND source_ip IS NOT DISTINCT FROM $6
            AND detected_at > NOW()-INTERVAL '15 minutes'
        )
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(alert_type)
    .bind(severity)
    .bind(summary)
    .bind(source_ip)
    .bind(user_id)
    .bind(details)
    .execute(&mut *tx)
    .await?;
    if blocked {
        sqlx::query(
            r#"
            INSERT INTO security_blocklist(
              tenant_id,branch_id,ip_address,reason,severity,blocked_until
            )
            SELECT $1,$2,$3,'Repeated suspicious probes','critical',
                   NOW()+($4::BIGINT*INTERVAL '1 second')
            WHERE $3::TEXT IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM security_blocklist
              WHERE tenant_id=$1 AND branch_id=$2 AND ip_address=$3
                AND unblocked_at IS NULL AND (blocked_until IS NULL OR blocked_until>NOW())
            )
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(source_ip)
        .bind(block_seconds)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}
