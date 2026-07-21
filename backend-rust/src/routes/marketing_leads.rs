use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::marketing_leads_repository as repo,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, marketing_advisor_service, security_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/marketing/leads", get(list).post(create))
        .route("/marketing/leads/owners", get(owners))
        .route("/marketing/leads/advice", get(lead_advice))
        .route("/marketing/win-back", get(win_back))
        .route("/marketing/win-back/results", get(win_back_results))
        .route("/marketing/attribution", get(marketing_attribution))
        .route("/marketing/client-intelligence", get(client_intelligence))
        .route("/marketing/advisor/recommend", post(marketing_advisor))
        .route("/marketing/advisor/review", post(review_marketing_advisor))
        .route(
            "/marketing/offers",
            get(list_marketing_offers).post(create_marketing_offer),
        )
        .route(
            "/marketing/offers/:id/approve",
            post(approve_marketing_offer),
        )
        .route("/marketing/automations", get(list_automations))
        .route(
            "/marketing/governance",
            get(marketing_governance).patch(update_marketing_governance),
        )
        .route(
            "/marketing/governance/exclusions/:id",
            axum::routing::patch(update_marketing_exclusion),
        )
        .route(
            "/marketing/automations/:id",
            axum::routing::patch(update_automation),
        )
        .route("/marketing/leads/:id", axum::routing::patch(update))
        .route(
            "/marketing/leads/:id/activities",
            get(activities).post(add_activity),
        )
        .route("/marketing/leads/:id/convert", post(convert))
}

async fn marketing_attribution(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_named_permission(&claims, "analytics.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let attribution = repo::campaign_attribution(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load campaign attribution"))?;
    Ok(Json(ApiResponse::ok(attribution)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeadListQuery {
    stage: Option<String>,
    owner_user_id: Option<String>,
    q: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WinBackQuery {
    inactive_days: Option<i32>,
    q: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClientIntelligenceQuery {
    q: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingAdvisorRequest {
    scope: String,
    scope_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingAdvisorReviewRequest {
    scope: String,
    scope_id: String,
    decision: String,
    recommendation: String,
    comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingOfferRequest {
    code: String,
    benefit_type: String,
    benefit_value: Option<i64>,
    target_client_id: Option<String>,
    complimentary_service_id: Option<String>,
    target_service_ids: Option<Vec<String>>,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    minimum_bill_paise: Option<i64>,
    usage_limit: Option<i64>,
    per_client_limit: Option<i64>,
    allow_membership_stacking: Option<bool>,
    allow_package_stacking: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AutomationUpdateRequest {
    status: String,
    config: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingGovernanceRequest {
    frequency_cap_days: i32,
    quiet_start: String,
    quiet_end: String,
    timezone: String,
    offer_approval_threshold_bps: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketingExclusionRequest {
    excluded: bool,
}

async fn marketing_governance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    crate::repositories::benefit_notification_repository::ensure_marketing_governance(
        &state.db, &tenant_id, &branch_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to initialize marketing governance"))?;
    let settings = sqlx::query_scalar::<_, Value>("SELECT JSONB_BUILD_OBJECT('frequencyCapDays',frequency_cap_days,'quietStart',quiet_start::TEXT,'quietEnd',quiet_end::TEXT,'timezone',timezone,'offerApprovalThresholdBps',offer_approval_threshold_bps) FROM marketing_governance_settings WHERE tenant_id=$1 AND branch_id=$2").bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to load marketing governance"))?;
    let exclusions = sqlx::query_scalar::<_, Value>("SELECT JSONB_BUILD_OBJECT('clientId',id,'clientName',CONCAT_WS(' ',first_name,last_name)) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL AND marketing_sensitive_excluded=TRUE ORDER BY first_name,last_name,id").bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await.map_err(|_| AppError::internal("failed to load marketing exclusions"))?;
    Ok(Json(ApiResponse::ok(
        json!({"settings":settings,"exclusions":exclusions}),
    )))
}

async fn update_marketing_governance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<MarketingGovernanceRequest>,
) -> ApiResult<Value> {
    require_named_permission(&claims, "marketing.manage")?;
    if !(0..=365).contains(&body.frequency_cap_days)
        || !(0..=10_000).contains(&body.offer_approval_threshold_bps)
        || body.timezone.trim().is_empty()
    {
        return Err(AppError::validation(
            "marketing governance settings are invalid",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let valid_timezone = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)",
    )
    .bind(body.timezone.trim())
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate timezone"))?;
    if !valid_timezone {
        return Err(AppError::validation("timezone is not supported"));
    }
    let settings = sqlx::query_scalar::<_, Value>("INSERT INTO marketing_governance_settings(tenant_id,branch_id,frequency_cap_days,quiet_start,quiet_end,timezone,offer_approval_threshold_bps,updated_by) VALUES($1,$2,$3,$4::TIME,$5::TIME,$6,$7,$8) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET frequency_cap_days=EXCLUDED.frequency_cap_days,quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,timezone=EXCLUDED.timezone,offer_approval_threshold_bps=EXCLUDED.offer_approval_threshold_bps,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING JSONB_BUILD_OBJECT('frequencyCapDays',frequency_cap_days,'quietStart',quiet_start::TEXT,'quietEnd',quiet_end::TEXT,'timezone',timezone,'offerApprovalThresholdBps',offer_approval_threshold_bps)").bind(&tenant_id).bind(&branch_id).bind(body.frequency_cap_days).bind(body.quiet_start.trim()).bind(body.quiet_end.trim()).bind(body.timezone.trim()).bind(body.offer_approval_threshold_bps).bind(&claims.sub).fetch_one(&state.db).await.map_err(|_| AppError::validation("quiet hours are invalid"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.governance.updated",
        settings.clone(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(settings)))
}

async fn update_marketing_exclusion(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MarketingExclusionRequest>,
) -> ApiResult<Value> {
    require_named_permission(&claims, "marketing.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let updated = sqlx::query_scalar::<_, String>("UPDATE clients SET marketing_sensitive_excluded=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL RETURNING id").bind(&tenant_id).bind(&branch_id).bind(id.trim()).bind(body.excluded).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to update marketing exclusion"))?.ok_or_else(|| AppError::not_found("client was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.client_exclusion.updated",
        json!({"clientId":updated,"excluded":body.excluded}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"clientId":updated,"excluded":body.excluded}),
    )))
}

async fn list_automations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    repo::ensure_automation_rules(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to initialize marketing automations"))?;
    let rows = repo::automation_rules(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load marketing automations"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn update_automation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<AutomationUpdateRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let status = body.status.trim().to_ascii_lowercase();
    if !matches!(status.as_str(), "active" | "paused") {
        return Err(AppError::validation("automation status is invalid"));
    }
    let channels = body
        .config
        .get("channels")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::validation("automation channels are required"))?;
    if channels.is_empty()
        || channels.iter().any(|channel| {
            !channel
                .as_str()
                .is_some_and(|value| matches!(value, "whatsapp" | "sms" | "email"))
        })
    {
        return Err(AppError::validation("automation channel is invalid"));
    }
    if !body.config.get("conditions").is_some_and(Value::is_array)
        || !body.config.get("exclusions").is_some_and(Value::is_array)
    {
        return Err(AppError::validation(
            "automation conditions and exclusions are required",
        ));
    }
    let cap = body
        .config
        .get("frequencyCapDays")
        .and_then(Value::as_i64)
        .ok_or_else(|| AppError::validation("automation frequency cap is required"))?;
    if !(0..=3650).contains(&cap)
        || !matches!(
            body.config
                .get("approvalMode")
                .and_then(Value::as_str)
                .unwrap_or(""),
            "automatic" | "manual"
        )
        || body
            .config
            .get("sendTime")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err(AppError::validation(
            "automation timing, frequency cap or approval mode is invalid",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if let Some(offer_id) = body
        .config
        .get("offerId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        let approved = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND approval_status='approved' AND (ends_at IS NULL OR ends_at>=NOW()))").bind(&tenant_id).bind(&branch_id).bind(offer_id.trim()).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate automation offer"))?;
        if !approved {
            return Err(AppError::validation(
                "automation offer is not approved or has expired",
            ));
        }
    }
    let row = repo::update_automation_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        id.trim(),
        &status,
        &body.config,
    )
    .await
    .map_err(|_| AppError::internal("failed to update marketing automation"))?
    .ok_or_else(|| AppError::not_found("automation was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.automation.updated",
        json!({"automationId":id.trim(),"status":status}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_marketing_offers(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_scalar::<_, Value>(r#"SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
      'id',id,'code',code,'benefitType',marketing_benefit_type,'benefitValue',benefit_value,
      'targetClientId',target_client_id,'complimentaryServiceId',complimentary_service_id,
      'targetServiceIds',target_service_ids,'startsAt',starts_at,'endsAt',ends_at,
      'minimumBillPaise',min_subtotal_paise,'usageLimit',usage_limit,'usedCount',used_count,
      'perClientLimit',per_client_limit,'approvalStatus',approval_status,'active',active,
      'allowMembershipStacking',allow_membership_stacking,'allowPackageStacking',allow_package_stacking,
      'createdAt',created_at,'approvedAt',approved_at) ORDER BY created_at DESC),'[]'::JSONB)
      FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND created_by<>''"#)
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to load marketing offers"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<MarketingOfferRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let code = body.code.trim().to_ascii_uppercase();
    let benefit_type = body.benefit_type.trim().to_ascii_lowercase();
    let allowed = [
        "percentage_discount",
        "fixed_discount",
        "complimentary_add_on",
        "loyalty_points",
        "wallet_credit",
        "gift_card",
        "package_upgrade",
        "priority_appointment",
        "off_peak_deal",
        "last_minute_slot",
    ];
    if code.is_empty() || !allowed.contains(&benefit_type.as_str()) {
        return Err(AppError::validation(
            "offer code or benefit type is invalid",
        ));
    }
    if body
        .starts_at
        .zip(body.ends_at)
        .is_some_and(|(start, end)| end <= start)
    {
        return Err(AppError::validation("offer expiry must be after its start"));
    }
    let value = body.benefit_value.unwrap_or(0);
    if value <= 0
        && !matches!(
            benefit_type.as_str(),
            "priority_appointment" | "package_upgrade"
        )
    {
        return Err(AppError::validation("offer benefit value is required"));
    }
    if body.usage_limit.is_some_and(|v| v <= 0) || body.per_client_limit.unwrap_or(1) <= 0 {
        return Err(AppError::validation("offer usage limits must be positive"));
    }
    if benefit_type == "complimentary_add_on"
        && body
            .complimentary_service_id
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err(AppError::validation("complimentary service is required"));
    }
    let target_client = body
        .target_client_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if let Some(client_id) = target_client {
        let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL)")
            .bind(&tenant_id).bind(&branch_id).bind(client_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate offer client"))?;
        if !exists {
            return Err(AppError::validation(
                "offer client is not valid for this branch",
            ));
        }
    }
    let service_ids = body
        .target_service_ids
        .unwrap_or_default()
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    let discount_type = if benefit_type == "percentage_discount" {
        "percent"
    } else {
        "amount"
    };
    let discount_bps = if benefit_type == "percentage_discount" {
        value
    } else {
        0
    };
    let discount_value = if benefit_type == "fixed_discount" {
        value
    } else {
        0
    };
    if discount_bps > 10_000 {
        return Err(AppError::validation(
            "percentage discount cannot exceed 100%",
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(r#"INSERT INTO pos_coupons(id,tenant_id,branch_id,code,discount_type,discount_value_paise,discount_bps,
      min_subtotal_paise,active,starts_at,ends_at,usage_limit,per_client_limit,offer_type,target_service_ids,
      marketing_benefit_type,benefit_value,target_client_id,complimentary_service_id,approval_status,created_by,
      allow_membership_stacking,allow_package_stacking)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending',$19,$20,$21)"#)
      .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&code).bind(discount_type).bind(discount_value).bind(discount_bps)
      .bind(body.minimum_bill_paise.unwrap_or(0).max(0)).bind(body.starts_at).bind(body.ends_at).bind(body.usage_limit)
      .bind(body.per_client_limit.unwrap_or(1)).bind(if service_ids.is_empty() { "generic" } else { "service_specific" }).bind(service_ids)
      .bind(&benefit_type).bind(value).bind(target_client).bind(body.complimentary_service_id.as_deref().map(str::trim).filter(|v| !v.is_empty()))
      .bind(&claims.sub).bind(body.allow_membership_stacking.unwrap_or(false)).bind(body.allow_package_stacking.unwrap_or(false))
      .execute(&state.db).await.map_err(|_| AppError::validation("offer code already exists or offer is invalid"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.created",
        json!({"offerId":id,"code":code,"benefitType":benefit_type}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"approvalStatus":"pending"}),
    )))
}

async fn approve_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let offer = sqlx::query_as::<_, (String,i64,i64,Option<DateTime<Utc>>)>("SELECT marketing_benefit_type,benefit_value,min_subtotal_paise,ends_at FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND approval_status='pending'")
      .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to load offer"))?.ok_or_else(|| AppError::not_found("pending offer was not found"))?;
    let approval_threshold = sqlx::query_scalar::<_, i32>("SELECT COALESCE((SELECT offer_approval_threshold_bps FROM marketing_governance_settings WHERE tenant_id=$1 AND branch_id=$2),1000)")
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to load offer approval threshold"))?;
    require_named_permission(
        &claims,
        if offer.0 == "percentage_discount" && offer.1 >= i64::from(approval_threshold) {
            "offers.approve"
        } else {
            "marketing.manage"
        },
    )?;
    if offer.3.is_some_and(|expiry| expiry <= Utc::now()) {
        return Err(AppError::validation("expired offer cannot be approved"));
    }
    if matches!(offer.0.as_str(), "percentage_discount" | "fixed_discount") {
        let ceiling = sqlx::query_as::<_, (i64,i64)>("SELECT COALESCE(MIN(NULLIF(max_discount_bps,0)),0),COALESCE(MIN(NULLIF(max_discount_paise,0)),0) FROM pos_discount_rules WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW())")
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to load margin safety limits"))?;
        if (offer.0 == "percentage_discount" && (ceiling.0 <= 0 || offer.1 > ceiling.0))
            || (offer.0 == "fixed_discount" && (ceiling.1 <= 0 || offer.1 > ceiling.1))
        {
            return Err(AppError::validation(
                "offer exceeds the configured margin-safe discount ceiling",
            ));
        }
    }
    sqlx::query("UPDATE pos_coupons SET approval_status='approved',active=TRUE,approved_by=$4,approved_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
      .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&claims.sub).execute(&state.db).await.map_err(|_| AppError::internal("failed to approve offer"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.approved",
        json!({"offerId":id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"approvalStatus":"approved"}),
    )))
}

async fn marketing_advisor(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<MarketingAdvisorRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let recommendation = marketing_advisor_service::recommend(
        &state,
        &tenant_id,
        &branch_id,
        body.scope.trim(),
        body.scope_id.trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(recommendation)))
}

async fn review_marketing_advisor(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<MarketingAdvisorReviewRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let decision = body.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "accepted" | "rejected")
        || !matches!(body.scope.trim(), "client" | "segment")
        || body.scope_id.trim().is_empty()
        || body.recommendation.trim().is_empty()
    {
        return Err(AppError::validation("invalid marketing advisor review"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::record_audit(&state.db, &tenant_id, &branch_id, &claims.sub, "marketing.advisor.reviewed", json!({"scope":body.scope.trim(),"scopeId":body.scope_id.trim(),"decision":decision,"recommendation":body.recommendation.trim(),"comment":body.comment.as_deref().unwrap_or("").trim()})).await?;
    Ok(Json(ApiResponse::ok(
        json!({"decision":decision,"reviewed":true}),
    )))
}

async fn client_intelligence(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ClientIntelligenceQuery>,
) -> ApiResult<Vec<repo::ClientIntelligenceRecord>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = repo::client_intelligence(
        &state.db,
        &tenant_id,
        &branch_id,
        query.q.as_deref().unwrap_or("").trim(),
        query.limit.unwrap_or(200).clamp(1, 500),
    )
    .await
    .map_err(|_| AppError::internal("failed to load client intelligence"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn win_back(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<WinBackQuery>,
) -> ApiResult<Vec<repo::WinBackCandidate>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let days = query.inactive_days.unwrap_or(60).clamp(1, 3650);
    let rows = repo::win_back_candidates(
        &state.db,
        &tenant_id,
        &branch_id,
        days,
        query.q.as_deref().unwrap_or("").trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load win-back clients"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn win_back_results(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<repo::WinBackResults> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = repo::win_back_results(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load win-back results"))?;
    Ok(Json(ApiResponse::ok(result)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LeadCreateRequest {
    first_name: String,
    last_name: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    source: Option<String>,
    stage: Option<String>,
    qualification_status: Option<String>,
    score: Option<i32>,
    owner_user_id: Option<String>,
    next_follow_up_date: Option<NaiveDate>,
    notes: Option<String>,
    client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LeadUpdateRequest {
    stage: Option<String>,
    qualification_status: Option<String>,
    score: Option<i32>,
    owner_user_id: Option<String>,
    next_follow_up_date: Option<NaiveDate>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LeadActivityRequest {
    activity_type: String,
    body: String,
    next_follow_up_date: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LeadConvertRequest {
    client_id: Option<String>,
    appointment_id: Option<String>,
}

async fn list(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<LeadListQuery>,
) -> ApiResult<Vec<repo::MarketingLeadRecord>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let stage = query.stage.unwrap_or_default().trim().to_ascii_lowercase();
    if !stage.is_empty() {
        validate_stage(&stage)?;
    }
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(100).clamp(1, 200);
    let rows = repo::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &stage,
        query.owner_user_id.as_deref().unwrap_or("").trim(),
        query.q.as_deref().unwrap_or("").trim(),
        page,
        page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to load marketing leads"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn owners(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<repo::MarketingLeadOwner>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        repo::owners(&state.db, &tenant_id, &branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load lead owners"))?,
    )))
}

async fn lead_advice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let advice = repo::lead_advice(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load lead advice"))?;
    Ok(Json(ApiResponse::ok(advice)))
}

async fn create(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<LeadCreateRequest>,
) -> ApiResult<repo::MarketingLeadRecord> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let first_name = text(&body.first_name, 120, "firstName")?;
    let last_name = optional_text(body.last_name.as_deref(), 120, "lastName")?;
    let phone = optional_text(body.phone.as_deref(), 40, "phone")?;
    let email = optional_text(body.email.as_deref(), 254, "email")?.to_ascii_lowercase();
    let source = optional_text(body.source.as_deref(), 80, "source")?;
    let source = if source.is_empty() {
        "other".to_string()
    } else {
        source
    };
    let stage = body
        .stage
        .unwrap_or_else(|| "new".to_string())
        .trim()
        .to_ascii_lowercase();
    let qualification_status = body
        .qualification_status
        .unwrap_or_else(|| "unqualified".to_string())
        .trim()
        .to_ascii_lowercase();
    validate_stage(&stage)?;
    validate_qualification(&qualification_status)?;
    let score = body.score.unwrap_or(0);
    if !(0..=100).contains(&score) {
        return Err(AppError::validation("score must be between 0 and 100"));
    }
    let owner_user_id = optional_text(body.owner_user_id.as_deref(), 120, "ownerUserId")?;
    validate_owner(&state, &tenant_id, &branch_id, &owner_user_id).await?;
    let client_id = body
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    validate_client(&state, &tenant_id, &branch_id, client_id).await?;
    let notes = optional_text(body.notes.as_deref(), 4000, "notes")?;
    let row = repo::create(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &first_name,
        &last_name,
        &phone,
        &email,
        &source,
        &stage,
        &qualification_status,
        score,
        &owner_user_id,
        body.next_follow_up_date,
        &notes,
        client_id,
    )
    .await
    .map_err(map_write_error)?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.lead.created",
        json!({"leadId":row.id,"stage":row.stage}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<LeadUpdateRequest>,
) -> ApiResult<repo::MarketingLeadRecord> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let stage = body
        .stage
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase);
    if let Some(value) = stage.as_deref() {
        validate_stage(value)?;
    }
    let qualification_status = body
        .qualification_status
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase);
    if let Some(value) = qualification_status.as_deref() {
        validate_qualification(value)?;
    }
    if let Some(score) = body.score {
        if !(0..=100).contains(&score) {
            return Err(AppError::validation("score must be between 0 and 100"));
        }
    }
    let owner_user_id = match body.owner_user_id.as_deref() {
        Some(value) => Some(optional_text(Some(value), 120, "ownerUserId")?),
        None => None,
    };
    if let Some(value) = owner_user_id.as_deref() {
        validate_owner(&state, &tenant_id, &branch_id, value).await?;
    }
    let notes = match body.notes.as_deref() {
        Some(value) => Some(optional_text(Some(value), 4000, "notes")?),
        None => None,
    };
    let row = repo::update(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        stage.as_deref(),
        qualification_status.as_deref(),
        body.score,
        owner_user_id.as_deref(),
        body.next_follow_up_date,
        notes.as_deref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to update marketing lead"))?
    .ok_or_else(|| AppError::not_found("marketing lead was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.lead.updated",
        json!({"leadId":row.id,"stage":row.stage}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn activities(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<repo::MarketingLeadActivity>> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        repo::activities(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| AppError::internal("failed to load lead activities"))?,
    )))
}

async fn add_activity(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<LeadActivityRequest>,
) -> ApiResult<repo::MarketingLeadActivity> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let activity_type = body.activity_type.trim().to_ascii_lowercase();
    if !matches!(
        activity_type.as_str(),
        "note" | "call" | "message" | "follow_up" | "qualification" | "conversion"
    ) {
        return Err(AppError::validation("activityType is invalid"));
    }
    let body_text = text(&body.body, 4000, "body")?;
    let activity = repo::add_activity(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        &activity_type,
        &body_text,
        body.next_follow_up_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to save lead activity"))?
    .ok_or_else(|| AppError::not_found("marketing lead was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.lead.activity_added",
        json!({"leadId":id,"activityId":activity.id,"activityType":activity.activity_type}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(activity)))
}

async fn convert(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<LeadConvertRequest>,
) -> ApiResult<repo::MarketingLeadRecord> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let client_id = body
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let appointment_id = body
        .appointment_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    validate_client(&state, &tenant_id, &branch_id, client_id).await?;
    validate_appointment(&state, &tenant_id, &branch_id, appointment_id).await?;
    let row = repo::convert(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        client_id,
        appointment_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to convert marketing lead"))?
    .ok_or_else(|| AppError::not_found("marketing lead was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.lead.converted",
        json!({"leadId":row.id,"clientId":row.client_id,"appointmentId":row.converted_appointment_id}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

fn require_permission(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    let allowed = if matches!(claims.role.as_str(), "owner" | "admin" | "manager") {
        true
    } else if write {
        claims.permissions.iter().any(|permission| {
            matches!(
                permission.as_str(),
                "marketing.manage" | "clients.manage" | "management.write"
            )
        })
    } else {
        claims.permissions.iter().any(|permission| {
            matches!(
                permission.as_str(),
                "marketing.read"
                    | "marketing.manage"
                    | "clients.read"
                    | "clients.manage"
                    | "tenant.read"
            )
        })
    };
    if allowed {
        Ok(())
    } else {
        Err(AppError::forbidden("marketing lead permission is required"))
    }
}

fn require_named_permission(claims: &AuthClaims, permission: &str) -> Result<(), AppError> {
    if matches!(claims.role.as_str(), "owner" | "admin")
        || claims.permissions.iter().any(|value| value == permission)
    {
        Ok(())
    } else {
        Err(AppError::forbidden(format!(
            "{permission} permission is required"
        )))
    }
}

fn validate_stage(value: &str) -> Result<(), AppError> {
    if matches!(
        value,
        "new" | "contacted" | "qualified" | "converted" | "lost"
    ) {
        Ok(())
    } else {
        Err(AppError::validation("stage is invalid"))
    }
}

fn validate_qualification(value: &str) -> Result<(), AppError> {
    if matches!(value, "unqualified" | "qualified" | "disqualified") {
        Ok(())
    } else {
        Err(AppError::validation("qualificationStatus is invalid"))
    }
}

fn text(value: &str, max_len: usize, label: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{label} is required and must be at most {max_len} characters"
        )));
    }
    Ok(value.to_string())
}

fn optional_text(value: Option<&str>, max_len: usize, label: &str) -> Result<String, AppError> {
    let value = value.unwrap_or("").trim();
    if value.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(value.to_string())
}

async fn validate_owner(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    owner_user_id: &str,
) -> Result<(), AppError> {
    if owner_user_id.is_empty() {
        return Ok(());
    }
    if !repo::owner_exists(&state.db, tenant_id, branch_id, owner_user_id)
        .await
        .map_err(|_| AppError::internal("failed to validate lead owner"))?
    {
        return Err(AppError::validation(
            "ownerUserId is not active in this branch",
        ));
    }
    Ok(())
}

async fn validate_client(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
) -> Result<(), AppError> {
    let Some(client_id) = client_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let exists = repo::client_exists(&state.db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to validate lead client"))?;
    if !exists {
        return Err(AppError::not_found(
            "lead client was not found in this branch",
        ));
    }
    Ok(())
}

async fn validate_appointment(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: Option<&str>,
) -> Result<(), AppError> {
    let Some(appointment_id) = appointment_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let exists = repo::appointment_exists(&state.db, tenant_id, branch_id, appointment_id)
        .await
        .map_err(|_| AppError::internal("failed to validate lead appointment"))?;
    if !exists {
        return Err(AppError::not_found(
            "lead appointment was not found in this branch",
        ));
    }
    Ok(())
}

fn map_write_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        if database.code().as_deref() == Some("23505") {
            return AppError::conflict("an active lead with this phone already exists");
        }
    }
    AppError::internal("failed to create marketing lead")
}

#[cfg(test)]
mod tests {
    use super::{text, validate_qualification, validate_stage};

    #[test]
    fn lead_stage_and_qualification_values_are_strict() {
        assert!(validate_stage("new").is_ok());
        assert!(validate_stage("converted").is_ok());
        assert!(validate_stage("pending").is_err());
        assert!(validate_qualification("qualified").is_ok());
        assert!(validate_qualification("unknown").is_err());
    }

    #[test]
    fn lead_text_rejects_blank_and_accepts_trimmed_values() {
        assert!(text("   ", 20, "firstName").is_err());
        assert_eq!(text("  Asha  ", 20, "firstName").unwrap(), "Asha");
    }
}
