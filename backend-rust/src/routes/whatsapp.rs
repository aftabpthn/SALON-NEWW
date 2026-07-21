use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::whatsapp_repository,
    routes::context::tenant_branch,
    services::auth_service::AuthClaims,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/whatsapp/summary", axum::routing::get(summary))
        .route("/whatsapp/threads", axum::routing::get(threads))
        .route("/whatsapp/messages", axum::routing::get(messages))
        .route("/whatsapp/rules", axum::routing::get(rules))
        .route(
            "/whatsapp/handoffs",
            axum::routing::get(handoffs).post(create_handoff),
        )
        .route(
            "/whatsapp/handoffs/:id",
            axum::routing::patch(update_handoff),
        )
        .route(
            "/whatsapp-campaign-planner/plans",
            axum::routing::get(campaign_plans).post(create_campaign_plan),
        )
        .route(
            "/whatsapp-campaign-planner/plans/:id/approve",
            axum::routing::post(approve_campaign_plan),
        )
        .route(
            "/whatsapp-campaign-planner/plans/:id/schedule",
            axum::routing::post(schedule_campaign_plan),
        )
        .route(
            "/whatsapp-campaign-planner/outcomes",
            axum::routing::get(campaign_outcomes),
        )
        .route(
            "/message-templates",
            axum::routing::get(templates).post(create_template),
        )
        .route(
            "/settings/message-history",
            axum::routing::get(history_settings).put(save_history_settings),
        )
        .route("/whatsapp/inbound", axum::routing::post(inbound))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagesQuery {
    client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboundRequest {
    phone: String,
    body: String,
    provider_message_id: Option<String>,
    client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoffRequest {
    thread_id: String,
    client_id: Option<String>,
    reason: String,
    priority: Option<String>,
    assigned_to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoffUpdate {
    status: String,
    assigned_to: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CampaignPlanRequest {
    campaign_type: String,
    title: String,
    objective: Option<String>,
    message_text: String,
    segment_key: Option<String>,
    criteria: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleRequest {
    scheduled_for: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateRequest {
    template_key: String,
    name: String,
    channel: String,
    audience: Option<String>,
    event_key: Option<String>,
    body: String,
    provider_template_id: Option<String>,
    language: Option<String>,
    branch_specific: Option<bool>,
    service_id: Option<String>,
    occasion_key: Option<String>,
    offer_id: Option<String>,
    target_client_id: Option<String>,
}

fn actor(headers: &HeaderMap) -> String {
    headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("system")
        .to_string()
}

async fn summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<whatsapp_repository::WhatsAppSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = whatsapp_repository::summary(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load WhatsApp summary"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn threads(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<whatsapp_repository::WhatsAppThread>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::threads(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load WhatsApp threads"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MessagesQuery>,
) -> ApiResult<Vec<whatsapp_repository::WhatsAppMessage>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::messages(
        &state.db,
        &tenant_id,
        &branch_id,
        query.client_id.as_deref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load WhatsApp messages"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn inbound(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<InboundRequest>,
) -> ApiResult<whatsapp_repository::WhatsAppMessage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let phone = payload.phone.trim();
    let body = payload.body.trim();
    if phone.is_empty() || body.is_empty() || body.chars().count() > 4_000 {
        return Err(AppError::validation("phone and body are required"));
    }
    let client_id = match payload
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(client_id) => {
            let exists =
                whatsapp_repository::client_exists(&state.db, &tenant_id, &branch_id, client_id)
                    .await
                    .map_err(|_| AppError::internal("failed to validate WhatsApp client"))?;
            if !exists {
                return Err(AppError::not_found("matching client was not found"));
            }
            client_id.to_string()
        }
        None => whatsapp_repository::find_client_by_phone(&state.db, &tenant_id, &branch_id, phone)
            .await
            .map_err(|_| AppError::internal("failed to resolve WhatsApp client"))?
            .ok_or_else(|| AppError::not_found("matching client was not found"))?,
    };
    let provider_message_id = payload
        .provider_message_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("manual:{}", uuid::Uuid::new_v4()));
    let row = whatsapp_repository::insert_inbound(
        &state.db,
        &tenant_id,
        &branch_id,
        &client_id,
        phone,
        body,
        &provider_message_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to record inbound WhatsApp message"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<whatsapp_repository::WhatsAppRule>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::rules(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load WhatsApp automation rules"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn handoffs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<whatsapp_repository::WhatsAppHandoff>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::handoffs(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load WhatsApp handoffs"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_handoff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<HandoffRequest>,
) -> ApiResult<whatsapp_repository::WhatsAppHandoff> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if payload.thread_id.trim().is_empty() || payload.reason.trim().is_empty() {
        return Err(AppError::validation("threadId and reason are required"));
    }
    let priority = payload.priority.as_deref().unwrap_or("normal");
    if !["low", "normal", "high", "urgent"].contains(&priority) {
        return Err(AppError::validation("invalid handoff priority"));
    }
    let row = whatsapp_repository::create_handoff(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.thread_id.trim(),
        payload.client_id.as_deref(),
        payload.reason.trim(),
        priority,
        payload.assigned_to.as_deref().unwrap_or(""),
    )
    .await
    .map_err(|_| AppError::internal("failed to create WhatsApp handoff"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_handoff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<HandoffUpdate>,
) -> ApiResult<whatsapp_repository::WhatsAppHandoff> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = whatsapp_repository::update_handoff(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload.status.trim(),
        payload.assigned_to.as_deref().unwrap_or(""),
        payload.note.as_deref().unwrap_or(""),
    )
    .await
    .map_err(|_| AppError::internal("failed to update WhatsApp handoff"))?
    .ok_or_else(|| AppError::not_found("WhatsApp handoff was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn campaign_plans(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<whatsapp_repository::WhatsAppCampaignPlan>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::campaign_plans(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load WhatsApp campaign plans"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_campaign_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CampaignPlanRequest>,
) -> ApiResult<whatsapp_repository::WhatsAppCampaignPlan> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if payload.campaign_type.trim().is_empty()
        || payload.title.trim().is_empty()
        || payload.message_text.trim().is_empty()
    {
        return Err(AppError::validation(
            "campaign type, title and messageText are required",
        ));
    }
    if payload.message_text.chars().count() > 4000 {
        return Err(AppError::validation("messageText is too long"));
    }
    let row = whatsapp_repository::create_campaign_plan(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.campaign_type.trim(),
        payload.title.trim(),
        payload.objective.as_deref().unwrap_or(""),
        payload.message_text.trim(),
        payload.segment_key.as_deref().unwrap_or(""),
        payload.criteria.as_ref().unwrap_or(&json!({})),
        &actor(&headers),
    )
    .await
    .map_err(|_| AppError::internal("failed to create WhatsApp campaign plan"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve_campaign_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<whatsapp_repository::WhatsAppCampaignPlan> {
    change_campaign_status(state, headers, id, "approved", None).await
}

async fn schedule_campaign_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ScheduleRequest>,
) -> ApiResult<whatsapp_repository::WhatsAppCampaignPlan> {
    let scheduled = payload
        .scheduled_for
        .as_deref()
        .map(|value| DateTime::parse_from_rfc3339(value).map(|v| v.with_timezone(&Utc)))
        .transpose()
        .map_err(|_| AppError::validation("scheduledFor must be ISO-8601"))?;
    change_campaign_status(state, headers, id, "scheduled", scheduled).await
}

async fn change_campaign_status(
    state: AppState,
    headers: HeaderMap,
    id: String,
    status: &str,
    scheduled: Option<DateTime<Utc>>,
) -> ApiResult<whatsapp_repository::WhatsAppCampaignPlan> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = whatsapp_repository::update_campaign_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        status,
        &actor(&headers),
        scheduled,
    )
    .await
    .map_err(|_| AppError::internal("failed to update WhatsApp campaign plan"))?
    .ok_or_else(|| AppError::not_found("WhatsApp campaign plan was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn campaign_outcomes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<whatsapp_repository::WhatsAppCampaignOutcome>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::campaign_outcomes(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load WhatsApp campaign outcomes"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn templates(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<whatsapp_repository::MessageTemplate>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = whatsapp_repository::templates(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load message templates"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_template(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<TemplateRequest>,
) -> ApiResult<whatsapp_repository::MessageTemplate> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !matches!(claims.role.as_str(), "owner" | "admin")
        && !claims
            .permissions
            .iter()
            .any(|permission| permission == "templates.manage")
    {
        return Err(AppError::forbidden(
            "templates.manage permission is required",
        ));
    }
    if payload.template_key.trim().is_empty()
        || payload.name.trim().is_empty()
        || payload.body.trim().is_empty()
    {
        return Err(AppError::validation(
            "templateKey, name and body are required",
        ));
    }
    if !["sms", "whatsapp", "email"].contains(&payload.channel.as_str()) {
        return Err(AppError::validation("invalid template channel"));
    }
    let language = payload
        .language
        .as_deref()
        .unwrap_or("english")
        .trim()
        .to_ascii_lowercase();
    if !matches!(language.as_str(), "english" | "hindi") {
        return Err(AppError::validation("template language is invalid"));
    }
    validate_template_content(payload.body.trim())?;
    let service_id = payload.service_id.as_deref().unwrap_or("").trim();
    if !service_id.is_empty() {
        let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)").bind(&tenant_id).bind(&branch_id).bind(service_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate template service"))?;
        if !exists {
            return Err(AppError::validation(
                "template service is not valid for this branch",
            ));
        }
    }
    let offer_id = payload.offer_id.as_deref().unwrap_or("").trim();
    if let Some(percent) = largest_percent_claim(payload.body.trim()) {
        if offer_id.is_empty() {
            return Err(AppError::validation(
                "discount claim requires an approved offer",
            ));
        }
        let ceiling = sqlx::query_scalar::<_, i64>("SELECT benefit_value FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND approval_status='approved' AND marketing_benefit_type='percentage_discount' AND (ends_at IS NULL OR ends_at>=NOW())").bind(&tenant_id).bind(&branch_id).bind(offer_id).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to validate template offer"))?.ok_or_else(|| AppError::validation("template offer is not an approved percentage discount"))?;
        if percent > ceiling {
            return Err(AppError::validation(
                "template discount exceeds the approved offer",
            ));
        }
    } else if !offer_id.is_empty() {
        let approved = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND approval_status='approved' AND (ends_at IS NULL OR ends_at>=NOW()))").bind(&tenant_id).bind(&branch_id).bind(offer_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate template offer"))?;
        if !approved {
            return Err(AppError::validation(
                "template offer is not approved or has expired",
            ));
        }
    }
    if let Some(client_id) = payload
        .target_client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let consented = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL AND CASE $4 WHEN 'whatsapp' THEN whatsapp_opt_in IS TRUE AND phone<>'' WHEN 'sms' THEN sms_opt_in IS TRUE AND phone<>'' WHEN 'email' THEN email_opt_in IS TRUE AND email<>'' ELSE FALSE END)").bind(&tenant_id).bind(&branch_id).bind(client_id).bind(&payload.channel).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate template consent"))?;
        if !consented {
            return Err(AppError::conflict(
                "target client consent or contact is missing",
            ));
        }
    }
    let template_branch = if payload.branch_specific.unwrap_or(true) {
        branch_id.as_str()
    } else {
        ""
    };
    let row = whatsapp_repository::create_template(
        &state.db,
        &tenant_id,
        template_branch,
        payload.template_key.trim(),
        payload.name.trim(),
        payload.channel.as_str(),
        payload.audience.as_deref().unwrap_or("client"),
        payload.event_key.as_deref().unwrap_or("custom"),
        payload.body.trim(),
        payload.provider_template_id.as_deref().unwrap_or(""),
        &language,
        service_id,
        payload.occasion_key.as_deref().unwrap_or("").trim(),
        offer_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to create message template"))?;
    Ok(Json(ApiResponse::ok(row)))
}

const TEMPLATE_VARIABLES: &[&str] = &[
    "client_name",
    "service_name",
    "last_visit_date",
    "days_inactive",
    "preferred_staff",
    "offer_code",
    "offer_expiry",
    "booking_link",
    "branch_name",
];

fn validate_template_content(body: &str) -> Result<(), AppError> {
    let lower = body.to_ascii_lowercase();
    if [
        "guaranteed result",
        "100% result",
        "permanent cure",
        "risk-free treatment",
        "best in india",
        "गारंटीड रिजल्ट",
        "100% परिणाम",
        "स्थायी इलाज",
    ]
    .iter()
    .any(|claim| lower.contains(claim))
    {
        return Err(AppError::validation("template contains a prohibited claim"));
    }
    let mut remaining = body;
    while let Some(start) = remaining.find("{{") {
        let after = &remaining[start + 2..];
        let end = after
            .find("}}")
            .ok_or_else(|| AppError::validation("template variable is not closed"))?;
        let variable = after[..end].trim();
        if !TEMPLATE_VARIABLES.contains(&variable) {
            return Err(AppError::validation("template variable is invalid"));
        }
        remaining = &after[end + 2..];
    }
    if remaining.contains("}}") {
        return Err(AppError::validation("template variable is invalid"));
    }
    Ok(())
}

fn largest_percent_claim(body: &str) -> Option<i64> {
    body.split_whitespace()
        .filter_map(|word| {
            word.trim_matches(|c: char| c == ',' || c == '.' || c == ')' || c == '(')
                .strip_suffix('%')?
                .parse::<f64>()
                .ok()
        })
        .filter(|value| *value > 0.0)
        .map(|value| (value * 100.0).round() as i64)
        .max()
}

async fn history_settings(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let data = whatsapp_repository::settings(&state.db, &tenant_id, &branch_id).await.map_err(|_| AppError::internal("failed to load message history settings"))?.map(|row| json!({ "branchId": row.branch_id, "settings": row.settings_json, "updatedBy": row.updated_by, "updatedAt": row.updated_at })).unwrap_or_else(|| json!({ "branchId": branch_id, "settings": {} }));
    Ok(Json(ApiResponse::ok(data)))
}

async fn save_history_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult<whatsapp_repository::MessageHistorySettings> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let settings = payload.get("settings").cloned().unwrap_or(payload);
    let row = whatsapp_repository::save_settings(
        &state.db,
        &tenant_id,
        &branch_id,
        &settings,
        &actor(&headers),
    )
    .await
    .map_err(|_| AppError::internal("failed to save message history settings"))?;
    Ok(Json(ApiResponse::ok(row)))
}

#[cfg(test)]
mod template_tests {
    use super::{largest_percent_claim, validate_template_content};

    #[test]
    fn template_guard_accepts_only_supported_variables_and_safe_claims() {
        assert!(validate_template_content(
            "Hi {{client_name}}, book {{service_name}} at {{branch_name}}."
        )
        .is_ok());
        assert!(validate_template_content("Hi {{unknown_name}}").is_err());
        assert!(validate_template_content("Guaranteed result for every client").is_err());
        assert_eq!(largest_percent_claim("Save 10% today, not 25%"), Some(2500));
    }
}
