use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::Response,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::marketing_leads_repository as repo,
    routes::context::tenant_branch,
    services::{
        auth_service::AuthClaims, marketing_advisor_service, marketing_lead_scoring_service,
        security_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/marketing/leads", get(list).post(create))
        .route("/marketing/leads/owners", get(owners))
        .route("/marketing/leads/advice", get(lead_advice))
        .route("/marketing/leads/score/refresh", post(refresh_lead_scores))
        .route("/marketing/leads/:id/score", get(lead_score))
        .route(
            "/marketing/leads/:id/score/mode",
            patch(set_lead_score_mode),
        )
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
        .route("/marketing/offers/:id/submit", post(submit_marketing_offer))
        .route("/marketing/offers/:id/stop", post(stop_marketing_offer))
        .route(
            "/marketing/offers/:id",
            patch(update_marketing_offer).delete(delete_marketing_offer),
        )
        .route(
            "/marketing/offers/:id/share-pack",
            get(marketing_offer_share_pack),
        )
        .route(
            "/marketing/offers/performance",
            get(marketing_offer_performance),
        )
        .route(
            "/marketing/offers/:id/creative",
            get(get_marketing_offer_creative)
                .put(upload_marketing_offer_creative)
                .layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
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
    title: Option<String>,
    customer_description: Option<String>,
    staff_instructions: Option<String>,
    benefit_type: String,
    benefit_value: Option<i64>,
    target_client_id: Option<String>,
    complimentary_service_id: Option<String>,
    target_service_ids: Option<Vec<String>>,
    target_package_ids: Option<Vec<String>>,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    minimum_bill_paise: Option<i64>,
    usage_limit: Option<i64>,
    per_client_limit: Option<i64>,
    allow_membership_stacking: Option<bool>,
    allow_package_stacking: Option<bool>,
    show_in_staff_app: Option<bool>,
    show_in_customer_app: Option<bool>,
    submit_for_approval: Option<bool>,
}

struct ValidatedMarketingOffer {
    code: String,
    title: String,
    customer_description: String,
    staff_instructions: String,
    benefit_type: String,
    benefit_value: i64,
    target_client_id: Option<String>,
    complimentary_service_id: Option<String>,
    service_ids: Vec<String>,
    package_ids: Vec<String>,
    discount_type: &'static str,
    discount_value: i64,
    discount_bps: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OfferCreativeQuery {
    file_name: String,
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
    control_group_bps: Option<i32>,
    attribution_window_days: Option<i32>,
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
    let settings = sqlx::query_scalar::<_, Value>("SELECT JSONB_BUILD_OBJECT('frequencyCapDays',frequency_cap_days,'quietStart',quiet_start::TEXT,'quietEnd',quiet_end::TEXT,'timezone',timezone,'offerApprovalThresholdBps',offer_approval_threshold_bps,'controlGroupBps',control_group_bps,'attributionWindowDays',attribution_window_days) FROM marketing_governance_settings WHERE tenant_id=$1 AND branch_id=$2").bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to load marketing governance"))?;
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
    let control_group_bps = body.control_group_bps.unwrap_or(0);
    let attribution_window_days = body.attribution_window_days.unwrap_or(30);
    if !(0..=365).contains(&body.frequency_cap_days)
        || !(0..=10_000).contains(&body.offer_approval_threshold_bps)
        || !(0..=5_000).contains(&control_group_bps)
        || !(1..=365).contains(&attribution_window_days)
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
    let settings = sqlx::query_scalar::<_, Value>("INSERT INTO marketing_governance_settings(tenant_id,branch_id,frequency_cap_days,quiet_start,quiet_end,timezone,offer_approval_threshold_bps,control_group_bps,attribution_window_days,updated_by) VALUES($1,$2,$3,$4::TIME,$5::TIME,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET frequency_cap_days=EXCLUDED.frequency_cap_days,quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,timezone=EXCLUDED.timezone,offer_approval_threshold_bps=EXCLUDED.offer_approval_threshold_bps,control_group_bps=EXCLUDED.control_group_bps,attribution_window_days=EXCLUDED.attribution_window_days,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING JSONB_BUILD_OBJECT('frequencyCapDays',frequency_cap_days,'quietStart',quiet_start::TEXT,'quietEnd',quiet_end::TEXT,'timezone',timezone,'offerApprovalThresholdBps',offer_approval_threshold_bps,'controlGroupBps',control_group_bps,'attributionWindowDays',attribution_window_days)").bind(&tenant_id).bind(&branch_id).bind(body.frequency_cap_days).bind(body.quiet_start.trim()).bind(body.quiet_end.trim()).bind(body.timezone.trim()).bind(body.offer_approval_threshold_bps).bind(control_group_bps).bind(attribution_window_days).bind(&claims.sub).fetch_one(&state.db).await.map_err(|_| AppError::validation("marketing governance is invalid"))?;
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
      'id',id,'code',code,'title',COALESCE(NULLIF(title,''),code),
      'customerDescription',customer_description,'staffInstructions',staff_instructions,
      'benefitType',marketing_benefit_type,'benefitValue',benefit_value,
      'targetClientId',target_client_id,'complimentaryServiceId',complimentary_service_id,
      'targetServiceIds',target_service_ids,'targetPackageIds',target_package_ids,
      'startsAt',starts_at,'endsAt',ends_at,
      'minimumBillPaise',min_subtotal_paise,'usageLimit',usage_limit,'usedCount',used_count,
      'perClientLimit',per_client_limit,'approvalStatus',approval_status,'active',active,
      'showInStaffApp',show_in_staff_app,'showInCustomerApp',show_in_customer_app,
      'hasCreative',EXISTS(SELECT 1 FROM marketing_offer_creatives creative WHERE creative.tenant_id=pos_coupons.tenant_id AND creative.branch_id=pos_coupons.branch_id AND creative.offer_id=pos_coupons.id),
      'creativePath',CASE WHEN EXISTS(SELECT 1 FROM marketing_offer_creatives creative WHERE creative.tenant_id=pos_coupons.tenant_id AND creative.branch_id=pos_coupons.branch_id AND creative.offer_id=pos_coupons.id) THEN '/api/v1/marketing/offers/'||id||'/creative' ELSE NULL END,
      'lifecycleStatus',CASE WHEN approval_status='rejected' THEN 'rejected' WHEN approval_status='draft' THEN 'draft' WHEN approval_status='pending' THEN 'pending' WHEN active=FALSE THEN 'inactive' WHEN starts_at>NOW() THEN 'scheduled' WHEN ends_at<NOW() THEN 'expired' ELSE 'live' END,
      'allowMembershipStacking',allow_membership_stacking,'allowPackageStacking',allow_package_stacking,
      'createdAt',created_at,'approvedAt',approved_at) ORDER BY created_at DESC),'[]'::JSONB)
      FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND created_by<>''"#)
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to load marketing offers"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn marketing_offer_performance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_named_permission(&claims, "analytics.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let tenant_wide = matches!(claims.role.to_ascii_lowercase().as_str(), "owner" | "admin");
    let rows = sqlx::query_scalar::<_, Value>(r#"WITH scoped_offers AS (
      SELECT offer.*,branch.id::TEXT AS resolved_branch_id,branch.name AS branch_name
      FROM pos_coupons offer
      JOIN branches branch ON offer.branch_id IN (branch.id::TEXT,COALESCE(branch.code,''),branch.name)
      JOIN tenants tenant ON tenant.id=branch.tenant_id AND offer.tenant_id IN (tenant.id::TEXT,COALESCE(tenant.slug,''),tenant.name)
      WHERE offer.created_by<>'' AND offer.tenant_id=$1 AND ($3 OR offer.branch_id=$2)
    ), event_totals AS (
      SELECT event.offer_id,
        COUNT(*) FILTER (WHERE event.event_type='view')::BIGINT AS app_views,
        COUNT(*) FILTER (WHERE event.event_type='click')::BIGINT AS link_clicks
      FROM marketing_offer_events event JOIN scoped_offers offer ON offer.id=event.offer_id
      WHERE event.tenant_id=$1 GROUP BY event.offer_id
    ), booking_totals AS (
      SELECT offer.id AS offer_id,COUNT(appointment.id)::BIGINT AS bookings
      FROM scoped_offers offer LEFT JOIN appointments appointment
        ON appointment.tenant_id=offer.tenant_id AND appointment.branch_id=offer.branch_id
       AND appointment.source LIKE 'marketing_offer:'||offer.id||':%'
       AND appointment.status NOT IN ('cancelled','no_show')
      GROUP BY offer.id
    ), sale_totals AS (
      SELECT offer.id AS offer_id,COUNT(sale.id)::BIGINT AS redemptions,
        COALESCE(SUM(sale.coupon_discount_paise),0)::BIGINT AS discount_paise,
        COALESCE(SUM(GREATEST(sale.subtotal_paise-sale.discount_paise,0)),0)::BIGINT AS revenue_after_discount_paise
      FROM scoped_offers offer LEFT JOIN pos_sales sale
        ON sale.tenant_id=offer.tenant_id AND sale.branch_id=offer.branch_id AND sale.coupon_code=offer.code
       AND sale.finalized_at IS NOT NULL AND sale.status NOT IN ('draft','voided','cancelled','refunded')
      GROUP BY offer.id
    ), performance AS (
      SELECT offer.id,offer.code,COALESCE(NULLIF(offer.title,''),offer.code) AS title,
        offer.resolved_branch_id AS branch_id,offer.branch_name,offer.ends_at,
        CASE WHEN offer.approval_status='rejected' THEN 'rejected' WHEN offer.approval_status='draft' THEN 'draft'
          WHEN offer.approval_status='pending' THEN 'pending' WHEN offer.active=FALSE THEN 'inactive'
          WHEN offer.starts_at>NOW() THEN 'scheduled' WHEN offer.ends_at<NOW() THEN 'expired' ELSE 'live' END AS lifecycle_status,
        COALESCE(event.app_views,0) AS app_views,COALESCE(event.link_clicks,0) AS link_clicks,
        COALESCE(booking.bookings,0) AS bookings,COALESCE(sale.redemptions,0) AS pos_redemptions,
        COALESCE(sale.discount_paise,0) AS discount_paise,
        COALESCE(sale.revenue_after_discount_paise,0) AS revenue_after_discount_paise
      FROM scoped_offers offer
      LEFT JOIN event_totals event ON event.offer_id=offer.id
      LEFT JOIN booking_totals booking ON booking.offer_id=offer.id
      LEFT JOIN sale_totals sale ON sale.offer_id=offer.id
    ) SELECT JSONB_BUILD_OBJECT(
      'offers',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'offerId',id,'code',code,'title',title,'branchId',branch_id,'branchName',branch_name,
        'lifecycleStatus',lifecycle_status,'endsAt',ends_at,'appViews',app_views,'linkClicks',link_clicks,
        'bookings',bookings,'posRedemptions',pos_redemptions,'discountPaise',discount_paise,
        'revenueAfterDiscountPaise',revenue_after_discount_paise) ORDER BY ends_at DESC NULLS FIRST,title) FROM performance),'[]'::JSONB),
      'branchResults',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'branchId',branch_id,'branchName',branch_name,'appViews',app_views,'linkClicks',link_clicks,
        'bookings',bookings,'posRedemptions',pos_redemptions,'discountPaise',discount_paise,
        'revenueAfterDiscountPaise',revenue_after_discount_paise) ORDER BY branch_name) FROM (
          SELECT branch_id,branch_name,SUM(app_views)::BIGINT app_views,SUM(link_clicks)::BIGINT link_clicks,
            SUM(bookings)::BIGINT bookings,SUM(pos_redemptions)::BIGINT pos_redemptions,
            SUM(discount_paise)::BIGINT discount_paise,SUM(revenue_after_discount_paise)::BIGINT revenue_after_discount_paise
          FROM performance GROUP BY branch_id,branch_name
        ) branch_performance),'[]'::JSONB)
    )"#)
        .bind(&tenant_id).bind(&branch_id).bind(tenant_wide).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to load offer performance"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn marketing_offer_share_pack(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let offer = sqlx::query_scalar::<_, Value>(r#"SELECT JSONB_BUILD_OBJECT(
      'id',offer.id,'code',offer.code,'title',COALESCE(NULLIF(offer.title,''),offer.code),
      'customerDescription',offer.customer_description,'endsAt',offer.ends_at,
      'targetServiceIds',offer.target_service_ids,'branchId',branch.id::TEXT,
      'hasCreative',EXISTS(SELECT 1 FROM marketing_offer_creatives creative
        WHERE creative.tenant_id=offer.tenant_id AND creative.branch_id=offer.branch_id AND creative.offer_id=offer.id),
      'trackedBookings',(SELECT COUNT(*) FROM appointments appointment
        WHERE appointment.tenant_id=offer.tenant_id AND appointment.branch_id=offer.branch_id
          AND appointment.source LIKE 'marketing_offer:'||offer.id||':%'
          AND appointment.status NOT IN ('cancelled','no_show'))
    ) FROM pos_coupons offer
    JOIN branches branch ON offer.branch_id IN (branch.id::TEXT,COALESCE(branch.code,''),branch.name)
    WHERE offer.tenant_id=$1 AND offer.branch_id=$2 AND offer.id=$3 AND branch.active=TRUE
      AND offer.active=TRUE AND offer.approval_status='approved' AND offer.show_in_customer_app=TRUE
      AND (offer.starts_at IS NULL OR offer.starts_at<=NOW())
      AND (offer.ends_at IS NULL OR offer.ends_at>=NOW())"#)
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load offer sharing details"))?
        .ok_or_else(|| AppError::not_found("active approved offer was not found"))?;
    let policy = sqlx::query_scalar::<_, Value>(r#"SELECT JSONB_BUILD_OBJECT(
      'consentRequired',TRUE,
      'frequencyCapDays',COALESCE((SELECT frequency_cap_days FROM marketing_governance_settings WHERE tenant_id=$1 AND branch_id=$2),7),
      'consentedClients',COUNT(*) FILTER(WHERE client.whatsapp_opt_in IS TRUE AND COALESCE(client.phone,'')<>''),
      'eligibleClients',COUNT(*) FILTER(WHERE client.whatsapp_opt_in IS TRUE AND COALESCE(client.phone,'')<>'' AND NOT EXISTS(
        SELECT 1 FROM benefit_notification_outbox prior
        WHERE prior.tenant_id=client.tenant_id AND prior.branch_id=client.branch_id AND prior.client_id=client.id
          AND prior.source_type='marketing_campaign' AND prior.status IN ('queued','processing','sent')
          AND prior.created_at>=NOW()-MAKE_INTERVAL(days=>COALESCE((SELECT frequency_cap_days FROM marketing_governance_settings WHERE tenant_id=$1 AND branch_id=$2),7))))
    ) FROM clients client WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE
      AND client.merged_into_client_id IS NULL AND client.marketing_sensitive_excluded=FALSE"#)
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to load WhatsApp sharing policy"))?;
    let offer_id = offer["id"].as_str().unwrap_or_default();
    let code = offer["code"].as_str().unwrap_or_default();
    let title = offer["title"].as_str().unwrap_or(code);
    let description = offer["customerDescription"].as_str().unwrap_or_default();
    let services = offer["targetServiceIds"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    let booking_url = |channel: &str| {
        format!(
            "{}/business/{}/book?serviceIds={}&offer={}&source=marketing_offer:{}:{}",
            state.settings.customer_app_base_url,
            utf8_percent_encode(
                offer["branchId"].as_str().unwrap_or_default(),
                NON_ALPHANUMERIC,
            ),
            utf8_percent_encode(&services, NON_ALPHANUMERIC),
            utf8_percent_encode(code, NON_ALPHANUMERIC),
            utf8_percent_encode(offer_id, NON_ALPHANUMERIC),
            channel,
        )
    };
    let caption = if description.is_empty() {
        format!("{title}\nUse code {code}")
    } else {
        format!("{title}\n{description}\nUse code {code}")
    };
    Ok(Json(ApiResponse::ok(json!({
        "offerId":offer_id,"title":title,"caption":caption,
        "instagramBookingUrl":booking_url("instagram"),
        "whatsappBookingUrl":booking_url("whatsapp"),
        "creativeDownloadPath":if offer["hasCreative"].as_bool().unwrap_or(false) { Value::String(format!("/api/v1/marketing/offers/{offer_id}/creative")) } else { Value::Null },
        "whatsappPolicy":policy,"trackedBookings":offer["trackedBookings"]
    }))))
}

async fn validate_marketing_offer(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    body: &MarketingOfferRequest,
) -> Result<ValidatedMarketingOffer, AppError> {
    let code = body.code.trim().to_ascii_uppercase();
    let title = clean_offer_text(body.title.as_deref().unwrap_or(&code), 120, "offer title")?;
    let customer_description = clean_offer_text(
        body.customer_description.as_deref().unwrap_or(""),
        1000,
        "customer description",
    )?;
    let staff_instructions = clean_offer_text(
        body.staff_instructions.as_deref().unwrap_or(""),
        2000,
        "staff instructions",
    )?;
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
        .as_ref()
        .zip(body.ends_at.as_ref())
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
    let target_client_id = body
        .target_client_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned);
    if let Some(client_id) = target_client_id.as_deref() {
        let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL)")
            .bind(&tenant_id).bind(&branch_id).bind(client_id).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to validate offer client"))?;
        if !exists {
            return Err(AppError::validation(
                "offer client is not valid for this branch",
            ));
        }
    }
    let service_ids = clean_offer_ids(body.target_service_ids.clone().unwrap_or_default());
    let package_ids = clean_offer_ids(body.target_package_ids.clone().unwrap_or_default());
    validate_offer_scope_ids(&state, &tenant_id, &branch_id, &service_ids, &package_ids).await?;
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
    Ok(ValidatedMarketingOffer {
        code,
        title,
        customer_description,
        staff_instructions,
        benefit_type,
        benefit_value: value,
        target_client_id,
        complimentary_service_id: body
            .complimentary_service_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        service_ids,
        package_ids,
        discount_type,
        discount_value,
        discount_bps,
    })
}

async fn create_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(body): Json<MarketingOfferRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let offer = validate_marketing_offer(&state, &tenant_id, &branch_id, &body).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let approval_status = if body.submit_for_approval.unwrap_or(true) {
        "pending"
    } else {
        "draft"
    };
    sqlx::query(r#"INSERT INTO pos_coupons(id,tenant_id,branch_id,code,discount_type,discount_value_paise,discount_bps,
      min_subtotal_paise,active,starts_at,ends_at,usage_limit,per_client_limit,offer_type,target_service_ids,
      marketing_benefit_type,benefit_value,target_client_id,complimentary_service_id,approval_status,created_by,
      allow_membership_stacking,allow_package_stacking,title,customer_description,staff_instructions,
      target_package_ids,show_in_staff_app,show_in_customer_app)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,FALSE,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)"#)
      .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&offer.code).bind(offer.discount_type).bind(offer.discount_value).bind(offer.discount_bps)
      .bind(body.minimum_bill_paise.unwrap_or(0).max(0)).bind(body.starts_at).bind(body.ends_at).bind(body.usage_limit)
      .bind(body.per_client_limit.unwrap_or(1)).bind(if offer.service_ids.is_empty() { "generic" } else { "service_specific" }).bind(offer.service_ids)
      .bind(&offer.benefit_type).bind(offer.benefit_value).bind(offer.target_client_id).bind(offer.complimentary_service_id)
      .bind(approval_status).bind(&claims.sub).bind(body.allow_membership_stacking.unwrap_or(false)).bind(body.allow_package_stacking.unwrap_or(false))
      .bind(&offer.title).bind(&offer.customer_description).bind(&offer.staff_instructions).bind(offer.package_ids)
      .bind(body.show_in_staff_app.unwrap_or(true)).bind(body.show_in_customer_app.unwrap_or(false))
      .execute(&state.db).await.map_err(|_| AppError::validation("offer code already exists or offer is invalid"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.created",
        json!({"offerId":id,"code":offer.code,"benefitType":offer.benefit_type,"approvalStatus":approval_status}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"approvalStatus":approval_status}),
    )))
}

async fn update_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MarketingOfferRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let offer = validate_marketing_offer(&state, &tenant_id, &branch_id, &body).await?;
    let updated = sqlx::query_scalar::<_, String>(r#"UPDATE pos_coupons offer SET
      code=$4,discount_type=$5,discount_value_paise=$6,discount_bps=$7,min_subtotal_paise=$8,
      starts_at=$9,ends_at=$10,usage_limit=$11,per_client_limit=$12,offer_type=$13,target_service_ids=$14,
      marketing_benefit_type=$15,benefit_value=$16,target_client_id=$17,complimentary_service_id=$18,
      approval_status='draft',approved_by=NULL,approved_at=NULL,allow_membership_stacking=$19,
      allow_package_stacking=$20,title=$21,customer_description=$22,staff_instructions=$23,
      target_package_ids=$24,show_in_staff_app=$25,show_in_customer_app=$26,updated_at=NOW()
      WHERE offer.tenant_id=$1 AND offer.branch_id=$2 AND offer.id=$3 AND offer.active=FALSE AND offer.used_count=0
        AND NOT EXISTS(SELECT 1 FROM pos_sales sale WHERE sale.tenant_id=offer.tenant_id AND sale.branch_id=offer.branch_id AND sale.coupon_code=offer.code AND sale.finalized_at IS NOT NULL)
      RETURNING offer.id"#)
      .bind(&tenant_id).bind(&branch_id).bind(id.trim()).bind(&offer.code).bind(offer.discount_type)
      .bind(offer.discount_value).bind(offer.discount_bps).bind(body.minimum_bill_paise.unwrap_or(0).max(0))
      .bind(body.starts_at).bind(body.ends_at).bind(body.usage_limit).bind(body.per_client_limit.unwrap_or(1))
      .bind(if offer.service_ids.is_empty() { "generic" } else { "service_specific" }).bind(offer.service_ids)
      .bind(&offer.benefit_type).bind(offer.benefit_value).bind(offer.target_client_id).bind(offer.complimentary_service_id)
      .bind(body.allow_membership_stacking.unwrap_or(false)).bind(body.allow_package_stacking.unwrap_or(false))
      .bind(&offer.title).bind(&offer.customer_description).bind(&offer.staff_instructions).bind(offer.package_ids)
      .bind(body.show_in_staff_app.unwrap_or(true)).bind(body.show_in_customer_app.unwrap_or(false))
      .fetch_optional(&state.db).await.map_err(|_| AppError::validation("offer code already exists or offer is invalid"))?
      .ok_or_else(|| AppError::validation("stop the offer first; redeemed offers cannot be edited"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.updated",
        json!({"offerId":updated,"code":offer.code,"approvalStatus":"draft"}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":updated,"approvalStatus":"draft"}),
    )))
}

async fn submit_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let updated = sqlx::query_scalar::<_, String>("UPDATE pos_coupons SET approval_status='pending',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND approval_status='draft' RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to submit offer"))?
        .ok_or_else(|| AppError::not_found("draft offer was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.submitted",
        json!({"offerId":updated}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        json!({"id":updated,"approvalStatus":"pending"}),
    )))
}

async fn upload_marketing_offer_creative(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<OfferCreativeQuery>,
    bytes: Bytes,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if query.file_name.trim().is_empty()
        || query.file_name.trim().chars().count() > 255
        || bytes.is_empty()
        || bytes.len() > 5 * 1024 * 1024
        || !offer_media_content_matches_type(&bytes, &content_type)
    {
        return Err(AppError::validation(
            "offer creative must be a JPG, PNG or WebP file up to 5 MB",
        ));
    }
    let editable = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND approval_status IN ('draft','pending'))")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_one(&state.db).await
        .map_err(|_| AppError::internal("failed to validate offer"))?;
    if !editable {
        return Err(AppError::validation(
            "only draft or pending offers can change their creative",
        ));
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let creative_id: String = sqlx::query_scalar("INSERT INTO marketing_offer_creatives(tenant_id,branch_id,offer_id,file_name,content_type,content_sha256,content_bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,branch_id,offer_id) DO UPDATE SET file_name=EXCLUDED.file_name,content_type=EXCLUDED.content_type,content_sha256=EXCLUDED.content_sha256,content_bytes=EXCLUDED.content_bytes,uploaded_by=EXCLUDED.uploaded_by,updated_at=NOW() RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).bind(query.file_name.trim())
        .bind(&content_type).bind(&digest).bind(bytes.to_vec()).bind(&claims.sub)
        .fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to store offer creative"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.creative_uploaded",
        json!({"offerId":id.trim(),"creativeId":creative_id,"sha256":digest}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(json!({
        "id":creative_id,
        "offerId":id.trim(),
        "fileName":query.file_name.trim(),
        "contentType":content_type,
        "contentPath":format!("/api/v1/marketing/offers/{}/creative", id.trim())
    }))))
}

async fn get_marketing_offer_creative(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row: Option<(String, String, Vec<u8>)> = sqlx::query_as("SELECT file_name,content_type,content_bytes FROM marketing_offer_creatives WHERE tenant_id=$1 AND branch_id=$2 AND offer_id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load offer creative"))?;
    let (file_name, content_type, content) =
        row.ok_or_else(|| AppError::not_found("offer creative was not found"))?;
    let safe_name = file_name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-') {
                value
            } else {
                '_'
            }
        })
        .collect::<String>();
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&content_type)
                .map_err(|_| AppError::internal("invalid stored media type"))?,
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{safe_name}\""),
        )
        .body(Body::from(content))
        .map_err(|_| AppError::internal("failed to stream offer creative"))
}

fn clean_offer_text(value: &str, max_chars: usize, field: &str) -> Result<String, AppError> {
    let cleaned = value.trim().to_string();
    if cleaned.chars().count() > max_chars {
        return Err(AppError::validation(format!(
            "{field} cannot exceed {max_chars} characters"
        )));
    }
    Ok(cleaned)
}

fn clean_offer_ids(values: Vec<String>) -> Vec<String> {
    let mut values = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

async fn validate_offer_scope_ids(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
    package_ids: &[String],
) -> Result<(), AppError> {
    if !service_ids.is_empty() {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND id=ANY($3)")
            .bind(tenant_id).bind(branch_id).bind(service_ids).fetch_one(&state.db).await
            .map_err(|_| AppError::internal("failed to validate offer services"))?;
        if count != service_ids.len() as i64 {
            return Err(AppError::validation(
                "one or more offer services are invalid for this branch",
            ));
        }
    }
    if !package_ids.is_empty() {
        let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND id=ANY($3)")
            .bind(tenant_id).bind(branch_id).bind(package_ids).fetch_one(&state.db).await
            .map_err(|_| AppError::internal("failed to validate offer packages"))?;
        if count != package_ids.len() as i64 {
            return Err(AppError::validation(
                "one or more offer packages are invalid for this branch",
            ));
        }
    }
    Ok(())
}

fn offer_media_content_matches_type(bytes: &[u8], content_type: &str) -> bool {
    match content_type {
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
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
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "offer",
        id.trim(),
        "marketing.offer.approved",
    );
    Ok(Json(ApiResponse::ok(
        json!({"id":id,"approvalStatus":"approved"}),
    )))
}

async fn stop_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let stopped = sqlx::query_scalar::<_, String>("UPDATE pos_coupons SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE RETURNING id")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to stop offer"))?
        .ok_or_else(|| AppError::not_found("active offer was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.stopped",
        json!({"offerId":stopped}),
    )
    .await?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "offer",
        &stopped,
        "marketing.offer.stopped",
    );
    Ok(Json(ApiResponse::ok(json!({"id":stopped,"active":false}))))
}

async fn delete_marketing_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let deleted = sqlx::query_as::<_, (String, String)>(r#"DELETE FROM pos_coupons offer
      WHERE offer.tenant_id=$1 AND offer.branch_id=$2 AND offer.id=$3 AND offer.active=FALSE AND offer.used_count=0
        AND NOT EXISTS(SELECT 1 FROM pos_sales sale WHERE sale.tenant_id=offer.tenant_id AND sale.branch_id=offer.branch_id AND sale.coupon_code=offer.code AND sale.finalized_at IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM birthday_anniversary_client_offers issued WHERE issued.coupon_id=offer.id)
      RETURNING offer.id,offer.code"#)
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to delete offer"))?
        .ok_or_else(|| AppError::validation("stop the offer first; redeemed or issued offers cannot be deleted"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.offer.deleted",
        json!({"offerId":deleted.0,"code":deleted.1}),
    )
    .await?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "offer",
        &deleted.0,
        "marketing.offer.deleted",
    );
    Ok(Json(ApiResponse::ok(json!({"id":deleted.0}))))
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
    capture_channel: Option<String>,
    external_source_id: Option<String>,
    sla_hours: Option<i64>,
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

/// Why a lead scores what it does, and what the policy would score it today.
///
/// Read-only: it recomputes for display without touching the stored value, so
/// a manager can compare a manual score against the policy before switching the
/// lead over.
async fn lead_score(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_permission(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let explanation =
        marketing_lead_scoring_service::explain(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(explanation)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeadScoreModeRequest {
    automatic: bool,
}

/// Opts one lead into or out of automatic scoring.
async fn set_lead_score_mode(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<LeadScoreModeRequest>,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    marketing_lead_scoring_service::set_score_source(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        input.automatic,
    )
    .await?;
    if input.automatic {
        marketing_lead_scoring_service::rescore_branch(&state.db, &tenant_id, &branch_id).await?;
    }
    let explanation =
        marketing_lead_scoring_service::explain(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(explanation)))
}

/// Rescores the branch now instead of waiting for the hourly worker, for use
/// after a bulk import or a run of conversions.
async fn refresh_lead_scores(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_permission(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let updated =
        marketing_lead_scoring_service::rescore_branch(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(json!({
        "rescored": updated,
        "modelVersion": marketing_lead_scoring_service::MODEL_VERSION,
    }))))
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
    let capture_channel = body
        .capture_channel
        .as_deref()
        .unwrap_or("other")
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        capture_channel.as_str(),
        "phone"
            | "sms"
            | "whatsapp"
            | "web_form"
            | "social"
            | "referral"
            | "walk_in"
            | "api"
            | "other"
    ) {
        return Err(AppError::validation("captureChannel is invalid"));
    }
    let external_source_id =
        optional_text(body.external_source_id.as_deref(), 200, "externalSourceId")?;
    let sla_hours = body.sla_hours.unwrap_or(24);
    if !(1..=720).contains(&sla_hours) {
        return Err(AppError::validation("slaHours must be between 1 and 720"));
    }
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
    let supplied_client_id = body
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if phone.is_empty()
        && email.is_empty()
        && supplied_client_id.is_none()
        && external_source_id.is_empty()
    {
        return Err(AppError::validation(
            "phone, email, clientId or externalSourceId is required",
        ));
    }
    validate_client(&state, &tenant_id, &branch_id, supplied_client_id).await?;
    let matched_client_id = if supplied_client_id.is_none() {
        repo::matching_client_id(&state.db, &tenant_id, &branch_id, &phone, &email)
            .await
            .map_err(|_| AppError::internal("failed to match existing client"))?
    } else {
        None
    };
    let client_id = supplied_client_id.or(matched_client_id.as_deref());
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
        &capture_channel,
        &external_source_id,
        Utc::now() + Duration::hours(sla_hours),
    )
    .await
    .map_err(map_write_error)?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "marketing.lead.created",
        json!({"leadId":row.id,"stage":row.stage,"captureChannel":row.capture_channel,"clientId":row.client_id}),
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
    let existing_client_id = repo::lead_client_id(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load lead client"))?;
    validate_appointment(&state, &tenant_id, &branch_id, appointment_id).await?;
    let appointment_client_id = match appointment_id {
        Some(id) => repo::appointment_client_id(&state.db, &tenant_id, &branch_id, id)
            .await
            .map_err(|_| AppError::internal("failed to validate appointment client"))?,
        None => None,
    };
    if client_id.is_some()
        && appointment_client_id
            .as_deref()
            .is_some_and(|id| Some(id) != client_id)
    {
        return Err(AppError::conflict(
            "appointment belongs to a different client",
        ));
    }
    let effective_client_id = client_id
        .or(appointment_client_id.as_deref())
        .or(existing_client_id.as_deref());
    if effective_client_id.is_none() {
        return Err(AppError::conflict("appointment is not linked to a client"));
    }
    validate_client(&state, &tenant_id, &branch_id, effective_client_id).await?;
    let row = repo::convert(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        effective_client_id,
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
            return AppError::conflict("this lead was already captured");
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
