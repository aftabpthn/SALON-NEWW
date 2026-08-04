//! AI Scribe: consent-gated treatment transcription and reviewed form drafts.
//!
//! Migration 0388 created `staff_ai_scribe_sessions` and
//! `staff_ai_scribe_events` and nothing ever reached them — the tables were the
//! only part of the capability that existed. The schema is doing real work
//! though, and this module follows it rather than replacing it: the status
//! lifecycle, the consent columns and the audit table are all taken as given.
//!
//! Three rules the schema encodes and this module enforces:
//!
//! * **Audio is never stored.** `CHECK (audio_retained = FALSE AND
//!   audio_retention_until IS NULL)` means the database will reject a row that
//!   claims otherwise. Uploaded audio is forwarded to the provider and dropped;
//!   only the transcript it produced is kept, and only until
//!   `transcript_retention_until`.
//! * **Consent comes first.** A session cannot exist without a recorded
//!   decision, and a refusal is stored rather than discarded, so "we asked and
//!   they said no" is evidence. Revocation purges the transcript.
//! * **Drafts are drafts.** The provider's field suggestions never become a form
//!   submission on their own. A staff member submits the values they reviewed,
//!   and those values — not the suggestions — are what gets written.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    services::{ai_workforce_service, auth_service::AuthClaims},
    state::AppState,
};

/// Mirrors `CHECK (byte_size BETWEEN 0 AND 26214400)`.
pub const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
/// Mirrors `CHECK (duration_seconds BETWEEN 0 AND 5700)`.
const MAX_DURATION_SECONDS: i32 = 5700;
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionInput {
    pub appointment_id: String,
    pub client_id: String,
    pub staff_id: String,
    #[serde(default)]
    pub service_id: String,
    pub form_definition_id: String,
    /// `true` when the guest is present and consenting in person.
    #[serde(default = "default_true")]
    pub guest_participant: bool,
    /// `granted` or `refused`. A refusal is recorded, not dropped.
    pub consent_status: String,
    #[serde(default)]
    pub consent_name: String,
    #[serde(default)]
    pub language_code: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveInput {
    /// The values the staff member reviewed, keyed by form field. These are
    /// written to the submission; the provider's suggestions are not.
    pub responses: Value,
    pub version: i32,
    #[serde(default)]
    pub signature_name: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScribeSession {
    pub id: String,
    pub appointment_id: String,
    pub client_id: String,
    pub staff_id: String,
    pub service_id: String,
    pub form_definition_id: String,
    pub form_submission_id: Option<String>,
    pub guest_participant: bool,
    pub consent_version: String,
    pub consent_status: String,
    pub consent_name: String,
    pub status: String,
    pub duration_seconds: i32,
    pub provider: String,
    pub model: String,
    pub language_code: String,
    pub provider_error_code: String,
    pub transcript: String,
    pub structured_summary: Value,
    pub form_suggestions: Value,
    pub version: i32,
}

/// Appends to the audit trail. Every state change goes through here, so the
/// event table is a complete record of who did what to a recording.
async fn record_event(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    event_type: &str,
    actor_user_id: &str,
    details: Value,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO staff_ai_scribe_events
             (tenant_id, branch_id, session_id, event_type, actor_user_id, details_json)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(event_type)
    .bind(actor_user_id)
    .bind(details)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to record scribe audit event"))?;
    Ok(())
}

/// Starts a session by recording the consent decision.
///
/// A refusal produces a session too. Without it there is no evidence the guest
/// was asked, which is exactly what a consent audit needs to see.
pub async fn start_session(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    input: &StartSessionInput,
) -> Result<ScribeSession, AppError> {
    ai_workforce_service::require_enabled_and_consume(&state.db, tenant_id, branch_id).await?;

    let consent_status = match input.consent_status.trim() {
        "granted" => "granted",
        "refused" => "refused",
        _ => {
            return Err(AppError::validation(
                "consentStatus must be granted or refused",
            ))
        }
    };
    if consent_status == "granted" && input.consent_name.trim().is_empty() {
        return Err(AppError::validation(
            "the name of the person granting consent is required",
        ));
    }
    let status = if consent_status == "granted" {
        "consent_granted"
    } else {
        "refused"
    };

    // The evidence hash binds the consent to this appointment, guest and moment
    // without storing a signature image. It is reproducible from the same
    // inputs, so a dispute can be checked rather than merely asserted.
    let mut hasher = Sha256::new();
    hasher.update(input.appointment_id.trim().as_bytes());
    hasher.update(b"|");
    hasher.update(input.client_id.trim().as_bytes());
    hasher.update(b"|");
    hasher.update(input.consent_name.trim().to_lowercase().as_bytes());
    hasher.update(b"|");
    hasher.update(consent_status.as_bytes());
    let consent_evidence = format!("{:x}", hasher.finalize());

    let language_code = if input.language_code.trim().is_empty() {
        "en-IN"
    } else {
        input.language_code.trim()
    };

    let session: ScribeSession = sqlx::query_as(
        r#"INSERT INTO staff_ai_scribe_sessions
             (tenant_id, branch_id, appointment_id, client_id, staff_id, service_id,
              form_definition_id, guest_participant, consent_status, consent_name,
              consent_evidence_sha256, consent_at, status, language_code, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   CASE WHEN $9 = 'granted' THEN NOW() END, $12, $13, $14)
           RETURNING id, appointment_id, client_id, staff_id, service_id, form_definition_id,
                     form_submission_id, guest_participant, consent_version, consent_status,
                     consent_name, status, duration_seconds, provider, model, language_code,
                     provider_error_code, transcript, structured_summary, form_suggestions, version"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(input.appointment_id.trim())
    .bind(input.client_id.trim())
    .bind(input.staff_id.trim())
    .bind(input.service_id.trim())
    .bind(input.form_definition_id.trim())
    .bind(input.guest_participant)
    .bind(consent_status)
    .bind(input.consent_name.trim())
    .bind(&consent_evidence)
    .bind(status)
    .bind(language_code)
    .bind(&claims.sub)
    .fetch_one(&state.db)
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(inner) if inner.is_foreign_key_violation() => {
            AppError::validation("appointment, client, staff or form definition was not found")
        }
        _ => AppError::internal("failed to start the scribe session"),
    })?;

    record_event(
        &state.db,
        tenant_id,
        branch_id,
        &session.id,
        if consent_status == "granted" {
            "consent_granted"
        } else {
            "consent_refused"
        },
        &claims.sub,
        json!({
            "consentVersion": session.consent_version,
            "guestParticipant": input.guest_participant,
            "consentEvidenceSha256": consent_evidence,
        }),
    )
    .await?;

    Ok(session)
}

/// What the provider returned for one recording.
#[derive(Debug, Deserialize)]
struct TranscriptionResult {
    #[serde(default)]
    transcript: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    summary: Value,
    #[serde(default)]
    suggestions: Value,
}

#[derive(Debug, Deserialize)]
struct TranscriptionEnvelope {
    data: TranscriptionResult,
}

/// Sends audio to the transcription provider and stores what comes back.
///
/// The audio itself is held only for the duration of this call. Nothing writes
/// it to disk or to the database, and the schema will not accept a row that
/// claims it was retained.
pub async fn transcribe(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    session_id: &str,
    audio: Vec<u8>,
    content_type: &str,
    duration_seconds: i32,
) -> Result<ScribeSession, AppError> {
    ai_workforce_service::require_enabled_and_consume(&state.db, tenant_id, branch_id).await?;

    if audio.is_empty() {
        return Err(AppError::validation("no audio was received"));
    }
    if audio.len() > MAX_AUDIO_BYTES {
        return Err(AppError::validation(
            "recording is larger than the 25 MB limit",
        ));
    }
    if !(0..=MAX_DURATION_SECONDS).contains(&duration_seconds) {
        return Err(AppError::validation(
            "recording is longer than the 95 minute limit",
        ));
    }

    let current = load(&state.db, tenant_id, branch_id, session_id).await?;
    if current.consent_status != "granted" {
        return Err(AppError::forbidden(
            "this session has no granted consent, so it cannot be transcribed",
        ));
    }
    if !matches!(
        current.status.as_str(),
        "consent_granted" | "recording" | "failed"
    ) {
        return Err(AppError::validation(format!(
            "a session in status {} cannot accept a recording",
            current.status
        )));
    }

    let url = state.settings.ai_service_url.as_deref().ok_or_else(|| {
        AppError::service_unavailable("AI_SERVICE_NOT_CONFIGURED", "AI service is not configured")
    })?;
    let token = state.settings.ai_service_token.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "AI_SERVICE_TOKEN_NOT_CONFIGURED",
            "AI service token is not configured",
        )
    })?;

    let byte_size = audio.len() as i32;
    mark_status(
        &state.db,
        tenant_id,
        branch_id,
        session_id,
        "processing",
        byte_size,
        duration_seconds,
        content_type,
    )
    .await?;
    record_event(
        &state.db,
        tenant_id,
        branch_id,
        session_id,
        "recording_submitted",
        &claims.sub,
        json!({ "byteSize": byte_size, "durationSeconds": duration_seconds, "contentType": content_type }),
    )
    .await?;

    let fields = form_fields(&state.db, tenant_id, branch_id, &current.form_definition_id).await?;
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/v1/staff-ai/scribe/transcribe",
            url.trim_end_matches('/')
        ))
        .bearer_auth(token)
        .timeout(PROVIDER_TIMEOUT)
        .json(&json!({
            "languageCode": current.language_code,
            "contentType": content_type,
            "durationSeconds": duration_seconds,
            "formFields": fields,
            // Base64 rather than multipart so the payload stays one JSON body
            // through the same authenticated path every other AI call uses.
            "audioBase64": base64_encode(&audio),
        }))
        .send()
        .await;

    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            let code = format!("provider_http_{}", response.status().as_u16());
            mark_failed(&state.db, tenant_id, branch_id, session_id, &code).await;
            record_event(
                &state.db,
                tenant_id,
                branch_id,
                session_id,
                "transcription_failed",
                &claims.sub,
                json!({ "errorCode": code }),
            )
            .await?;
            return Err(AppError::service_unavailable(
                "SCRIBE_PROVIDER_FAILED",
                "the transcription provider rejected the recording",
            ));
        }
        Err(_) => {
            mark_failed(
                &state.db,
                tenant_id,
                branch_id,
                session_id,
                "provider_unreachable",
            )
            .await;
            record_event(
                &state.db,
                tenant_id,
                branch_id,
                session_id,
                "transcription_failed",
                &claims.sub,
                json!({ "errorCode": "provider_unreachable" }),
            )
            .await?;
            return Err(AppError::service_unavailable(
                "SCRIBE_PROVIDER_UNREACHABLE",
                "the transcription provider could not be reached",
            ));
        }
    };

    let envelope: TranscriptionEnvelope = response.json().await.map_err(|_| {
        AppError::service_unavailable(
            "SCRIBE_PROVIDER_INVALID_RESPONSE",
            "the transcription provider returned an unreadable response",
        )
    })?;
    let result = envelope.data;
    if result.transcript.trim().is_empty() {
        mark_failed(
            &state.db,
            tenant_id,
            branch_id,
            session_id,
            "empty_transcript",
        )
        .await;
        return Err(AppError::service_unavailable(
            "SCRIBE_EMPTY_TRANSCRIPT",
            "the provider returned no transcript for this recording",
        ));
    }

    let session: ScribeSession = sqlx::query_as(
        r#"UPDATE staff_ai_scribe_sessions
              SET status = 'draft_ready',
                  transcript = $4,
                  structured_summary = $5,
                  form_suggestions = $6,
                  provider = $7,
                  model = $8,
                  provider_error_code = '',
                  version = version + 1,
                  updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING id, appointment_id, client_id, staff_id, service_id, form_definition_id,
                  form_submission_id, guest_participant, consent_version, consent_status,
                  consent_name, status, duration_seconds, provider, model, language_code,
                  provider_error_code, transcript, structured_summary, form_suggestions, version"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(result.transcript.trim())
    .bind(if result.summary.is_object() {
        result.summary
    } else {
        json!({})
    })
    .bind(if result.suggestions.is_array() {
        result.suggestions
    } else {
        json!([])
    })
    .bind(&result.provider)
    .bind(&result.model)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to store the transcript"))?;

    record_event(
        &state.db,
        tenant_id,
        branch_id,
        session_id,
        "draft_ready",
        &claims.sub,
        json!({ "provider": session.provider, "model": session.model }),
    )
    .await?;

    Ok(session)
}

/// Turns a reviewed draft into a real form submission.
///
/// The values written are the ones the staff member submits, not the ones the
/// provider suggested. That is the whole point of the review step: a suggestion
/// that was never looked at must not be able to reach a client's record.
pub async fn approve(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    session_id: &str,
    input: &ApproveInput,
) -> Result<ScribeSession, AppError> {
    if !input.responses.is_object() {
        return Err(AppError::validation("responses must be an object"));
    }
    let current = load(&state.db, tenant_id, branch_id, session_id).await?;
    if current.status != "draft_ready" {
        return Err(AppError::validation(format!(
            "a session in status {} cannot be approved",
            current.status
        )));
    }
    if current.version != input.version {
        return Err(AppError::conflict(
            "this draft changed since it was opened; reload and review it again",
        ));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to open a transaction"))?;

    let definition: (String, String, String, i32, bool) = sqlx::query_as(
        r#"SELECT form_key, name, form_type, version, requires_signature
             FROM client_form_definitions
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&current.form_definition_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to load the form definition"))?
    .ok_or_else(|| AppError::validation("the form definition was not found"))?;

    if definition.4 && input.signature_name.trim().is_empty() {
        return Err(AppError::validation(
            "this form requires a signature name before it can be submitted",
        ));
    }

    let signature_sha256 = if input.signature_name.trim().is_empty() {
        String::new()
    } else {
        let mut hasher = Sha256::new();
        hasher.update(input.signature_name.trim().to_lowercase().as_bytes());
        hasher.update(b"|");
        hasher.update(session_id.as_bytes());
        format!("{:x}", hasher.finalize())
    };

    let submission_id: String = sqlx::query_scalar(
        r#"INSERT INTO client_form_submissions
             (tenant_id, branch_id, client_id, definition_id, form_key, form_name, form_type,
              form_version, responses_json, signature_name, signature_sha256,
              signed_at, submitted_by, appointment_id, service_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   CASE WHEN $10 <> '' THEN NOW() END, $12, $13, $14)
           RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&current.client_id)
    .bind(&current.form_definition_id)
    .bind(&definition.0)
    .bind(&definition.1)
    .bind(&definition.2)
    .bind(definition.3)
    .bind(&input.responses)
    .bind(input.signature_name.trim())
    .bind(&signature_sha256)
    .bind(&claims.sub)
    .bind(&current.appointment_id)
    .bind(&current.service_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record the form submission"))?;

    let session: ScribeSession = sqlx::query_as(
        r#"UPDATE staff_ai_scribe_sessions
              SET status = 'approved',
                  form_submission_id = $4,
                  approved_by = $5,
                  approved_at = NOW(),
                  version = version + 1,
                  updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 AND version = $6
        RETURNING id, appointment_id, client_id, staff_id, service_id, form_definition_id,
                  form_submission_id, guest_participant, consent_version, consent_status,
                  consent_name, status, duration_seconds, provider, model, language_code,
                  provider_error_code, transcript, structured_summary, form_suggestions, version"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(&submission_id)
    .bind(&claims.sub)
    .bind(input.version)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to approve the scribe draft"))?
    .ok_or_else(|| {
        AppError::conflict("this draft changed since it was opened; reload and review it again")
    })?;

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit the approval"))?;

    record_event(
        &state.db,
        tenant_id,
        branch_id,
        session_id,
        "approved",
        &claims.sub,
        json!({ "formSubmissionId": submission_id, "fieldCount": input.responses.as_object().map_or(0, |map| map.len()) }),
    )
    .await?;

    Ok(session)
}

/// Withdraws consent and destroys the transcript.
///
/// Revocation is not a status flag alone: the transcript and the derived
/// summary and suggestions are cleared in the same statement, because the point
/// of withdrawing consent is that the content stops existing.
pub async fn revoke(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    session_id: &str,
    reason: &str,
) -> Result<ScribeSession, AppError> {
    let session: ScribeSession = sqlx::query_as(
        r#"UPDATE staff_ai_scribe_sessions
              SET status = 'revoked',
                  consent_status = 'revoked',
                  revoked_at = NOW(),
                  transcript = '',
                  structured_summary = '{}'::JSONB,
                  form_suggestions = '[]'::JSONB,
                  version = version + 1,
                  updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3 AND status <> 'revoked'
        RETURNING id, appointment_id, client_id, staff_id, service_id, form_definition_id,
                  form_submission_id, guest_participant, consent_version, consent_status,
                  consent_name, status, duration_seconds, provider, model, language_code,
                  provider_error_code, transcript, structured_summary, form_suggestions, version"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to revoke the scribe session"))?
    .ok_or_else(|| AppError::not_found("scribe session was not found or is already revoked"))?;

    record_event(
        &state.db,
        tenant_id,
        branch_id,
        session_id,
        "consent_revoked",
        &claims.sub,
        json!({ "reason": reason }),
    )
    .await?;

    Ok(session)
}

async fn load(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
) -> Result<ScribeSession, AppError> {
    sqlx::query_as(
        r#"SELECT id, appointment_id, client_id, staff_id, service_id, form_definition_id,
                  form_submission_id, guest_participant, consent_version, consent_status,
                  consent_name, status, duration_seconds, provider, model, language_code,
                  provider_error_code, transcript, structured_summary, form_suggestions, version
             FROM staff_ai_scribe_sessions
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load the scribe session"))?
    .ok_or_else(|| AppError::not_found("scribe session was not found"))
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
) -> Result<ScribeSession, AppError> {
    load(db, tenant_id, branch_id, session_id).await
}

/// Sessions recorded against one appointment, newest first.
pub async fn list_for_appointment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
) -> Result<Vec<ScribeSession>, AppError> {
    sqlx::query_as(
        r#"SELECT id, appointment_id, client_id, staff_id, service_id, form_definition_id,
                  form_submission_id, guest_participant, consent_version, consent_status,
                  consent_name, status, duration_seconds, provider, model, language_code,
                  provider_error_code, transcript, structured_summary, form_suggestions, version
             FROM staff_ai_scribe_sessions
            WHERE tenant_id = $1 AND branch_id = $2 AND appointment_id = $3
            ORDER BY created_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(appointment_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load scribe sessions"))
}

/// The audit trail for one session.
pub async fn events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
) -> Result<Vec<Value>, AppError> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
                    'id', id, 'eventType', event_type, 'actorUserId', actor_user_id,
                    'details', details_json, 'createdAt', created_at)
             FROM staff_ai_scribe_events
            WHERE tenant_id = $1 AND branch_id = $2 AND session_id = $3
            ORDER BY created_at, id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load scribe audit events"))
}

/// The field list the provider maps its suggestions onto.
async fn form_fields(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    definition_id: &str,
) -> Result<Value, AppError> {
    sqlx::query_scalar::<_, Value>(
        r#"SELECT fields_json FROM client_form_definitions
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(definition_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load the form definition"))?
    .ok_or_else(|| AppError::validation("the form definition was not found"))
}

/// Records a provider failure without masking the original error: the caller
/// still returns the service-unavailable it decided on, this only makes the
/// reason visible on the session itself.
async fn mark_failed(db: &PgPool, tenant_id: &str, branch_id: &str, session_id: &str, code: &str) {
    let _ = sqlx::query(
        r#"UPDATE staff_ai_scribe_sessions
              SET status = 'failed', provider_error_code = $4, updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(code)
    .execute(db)
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn mark_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    session_id: &str,
    status: &str,
    byte_size: i32,
    duration_seconds: i32,
    content_type: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"UPDATE staff_ai_scribe_sessions
              SET status = $4, byte_size = $5, duration_seconds = $6, content_type = $7,
                  updated_at = NOW()
            WHERE tenant_id = $1 AND branch_id = $2 AND id = $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(session_id)
    .bind(status)
    .bind(byte_size)
    .bind(duration_seconds)
    .bind(content_type)
    .execute(db)
    .await
    .map_err(|_| AppError::internal("failed to update the scribe session"))?;
    Ok(())
}

/// Clears transcripts whose retention window has closed.
///
/// The approved form submission survives — that is the clinical record the
/// business is required to keep. What expires is the raw transcript it was
/// drafted from.
pub async fn purge_expired_transcripts(db: &PgPool) -> Result<u64, AppError> {
    sqlx::query(
        r#"UPDATE staff_ai_scribe_sessions
              SET transcript = '',
                  structured_summary = '{}'::JSONB,
                  form_suggestions = '[]'::JSONB,
                  updated_at = NOW()
            WHERE transcript <> '' AND transcript_retention_until < NOW()"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
    .map_err(|_| AppError::internal("failed to apply scribe transcript retention"))
}

/// Minimal base64 so audio can ride the same authenticated JSON path as every
/// other AI call, without pulling multipart handling into this route.
fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consent_evidence_is_reproducible_and_binds_to_the_guest() {
        let hash = |client: &str, name: &str| {
            let mut hasher = Sha256::new();
            hasher.update(b"appt-1");
            hasher.update(b"|");
            hasher.update(client.as_bytes());
            hasher.update(b"|");
            hasher.update(name.to_lowercase().as_bytes());
            hasher.update(b"|");
            hasher.update(b"granted");
            format!("{:x}", hasher.finalize())
        };
        // Same inputs reproduce the hash, so a consent claim can be checked.
        assert_eq!(hash("client-1", "Asha"), hash("client-1", "asha"));
        // A different guest cannot share another guest's consent evidence.
        assert_ne!(hash("client-1", "Asha"), hash("client-2", "Asha"));
    }

    #[test]
    fn audio_limits_match_the_schema_constraints() {
        // staff_ai_scribe_sessions enforces these; a mismatch here would turn a
        // clear validation error into a failed insert at the end of an upload.
        assert_eq!(MAX_AUDIO_BYTES, 26_214_400);
        assert_eq!(MAX_DURATION_SECONDS, 5_700);
    }

    #[test]
    fn base64_round_trips() {
        use base64::Engine;
        let encoded = base64_encode(&[0, 1, 2, 250, 251]);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert_eq!(decoded, vec![0, 1, 2, 250, 251]);
    }
}
