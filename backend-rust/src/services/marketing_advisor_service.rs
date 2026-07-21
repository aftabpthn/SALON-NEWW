use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{models::common::AppError, repositories::marketing_leads_repository, state::AppState};

#[derive(Deserialize)]
struct AdvisorEnvelope {
    data: Value,
}

pub async fn recommend(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    scope: &str,
    scope_id: &str,
) -> Result<Value, AppError> {
    let url = state.settings.ai_service_url.as_deref().ok_or_else(|| {
        AppError::service_unavailable("AI_SERVICE_NOT_CONFIGURED", "AI service is not configured")
    })?;
    let token = state.settings.ai_service_token.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "AI_SERVICE_TOKEN_NOT_CONFIGURED",
            "AI service token is not configured",
        )
    })?;
    // ponytail: a live 500-client cohort avoids a second segment query; move filtering into
    // PostgreSQL when a branch can exceed this advisor ceiling.
    let mut clients =
        marketing_leads_repository::client_intelligence(&state.db, tenant_id, branch_id, "", 500)
            .await
            .map_err(|_| AppError::internal("failed to load marketing intelligence"))?;
    match scope {
        "client" => clients.retain(|client| client.client_id == scope_id),
        "segment" => clients.retain(|client| client.segment_keys.iter().any(|key| key == scope_id)),
        _ => return Err(AppError::validation("advisor scope is invalid")),
    }
    if clients.is_empty() {
        return Err(AppError::not_found(
            "no eligible clients were found for this advisor scope",
        ));
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| AppError::service_unavailable("AI_CLIENT_INIT_FAILED", "AI client could not be initialized"))?
        .post(format!("{url}/api/v1/marketing-advisor/recommendation"))
        .bearer_auth(token)
        .json(&json!({"tenant_id":tenant_id,"branch_id":branch_id,"scope":scope,"scope_id":scope_id,"clients":clients}))
        .send()
        .await
        .map_err(|_| AppError::service_unavailable("AI_ADVISOR_UNAVAILABLE", "AI marketing advisor is unavailable"))?;
    if !response.status().is_success() {
        return Err(AppError::service_unavailable(
            "AI_ADVISOR_REJECTED",
            "AI marketing advisor rejected the request",
        ));
    }
    response
        .json::<AdvisorEnvelope>()
        .await
        .map(|envelope| envelope.data)
        .map_err(|_| AppError::internal("AI marketing advisor returned an invalid response"))
}
