use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json, Router,
};
use chrono::TimeZone;
use chrono::{DateTime, Duration, Utc};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::appointments::{
    self, ApiError, AppointmentCreatePayload, AppointmentPayload, AppointmentServiceSelection,
    ListAppointmentQuery,
};
use crate::{
    services::{booking_service, invoice_delivery},
    state::AppState,
};

#[derive(Deserialize)]
pub(crate) struct PublicTenantPath {
    tenant_slug: String,
}

#[derive(Deserialize)]
struct V2ScopeQuery {
    #[serde(rename = "tenantId")]
    tenant_id: Option<String>,
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
}

#[derive(Deserialize)]
struct PublicSessionBody {
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    source: Option<String>,
    #[serde(rename = "deviceType")]
    device_type: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct SlotRequest {
    #[serde(rename = "branchId")]
    pub(crate) branch_id: Option<String>,
    #[serde(rename = "serviceIds")]
    pub(crate) service_ids: Option<Vec<String>>,
    pub(crate) date: Option<String>,
    #[serde(default)]
    pub(crate) duration: Option<i64>,
    #[serde(rename = "limit")]
    pub(crate) count: Option<i64>,
}

#[derive(Deserialize)]
struct NearbyAlternativesRequest {
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    #[serde(rename = "serviceIds")]
    service_ids: Option<Vec<String>>,
    date: Option<String>,
    #[serde(rename = "limit")]
    count: Option<i64>,
}

#[derive(Deserialize)]
struct OtpVerifyRequest {
    mobile: String,
    otp: String,
    purpose: Option<String>,
}

#[derive(Deserialize)]
struct HoldRequest {
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    #[serde(rename = "slotId")]
    slot_id: Option<String>,
    #[serde(rename = "appointmentId")]
    appointment_id: Option<String>,
    #[serde(rename = "serviceIds")]
    service_ids: Option<Vec<String>>,
    #[serde(rename = "startAt")]
    start_at: Option<String>,
    #[serde(rename = "endAt")]
    end_at: Option<String>,
    mobile: Option<String>,
}

#[derive(Deserialize)]
struct ConfirmRequest {
    #[serde(rename = "slot")]
    _slot: Option<Value>,
    #[serde(rename = "clientId")]
    client_id: Option<String>,
    #[serde(rename = "staffId")]
    staff_id: Option<String>,
    #[serde(rename = "serviceIds")]
    service_ids: Option<Vec<String>>,
    #[serde(rename = "serviceId")]
    service_id: Option<String>,
    #[serde(rename = "startAt")]
    start_at: Option<String>,
    #[serde(rename = "endAt")]
    end_at: Option<String>,
    notes: Option<String>,
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    #[serde(rename = "otpVerified")]
    _otp_verified: Option<bool>,
    #[serde(rename = "mobile")]
    mobile: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "holdId")]
    hold_id: Option<String>,
    #[serde(default, rename = "serviceSelections")]
    service_selections: Vec<AppointmentServiceSelection>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct QuoteRequest {
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    #[serde(default, rename = "serviceIds")]
    service_ids: Vec<String>,
    #[serde(default, rename = "serviceSelections")]
    service_selections: Vec<AppointmentServiceSelection>,
    #[serde(default, rename = "staffId")]
    staff_id: String,
    #[serde(rename = "startsAt")]
    starts_at: String,
}

#[derive(Deserialize)]
struct MyBookingQuery {
    #[serde(rename = "clientId")]
    client_id: Option<String>,
}

#[derive(Deserialize)]
struct PublicSessionEventBody {
    #[serde(rename = "eventName")]
    event_name: String,
    #[serde(rename = "eventData")]
    event_data: Option<Value>,
    #[serde(rename = "stepOrder")]
    step_order: Option<i64>,
}

#[derive(Deserialize)]
struct MultiServiceBody {
    services: Option<Value>,
}

#[derive(Deserialize)]
struct SessionListQuery {
    #[serde(rename = "tenantId")]
    tenant_id: Option<String>,
}

const DEFAULT_SLOT_MINUTES: i64 = 45;
const DEFAULT_SLOT_COUNT: i64 = 8;
const OTP_SEND_RATE_LIMIT_MAX: i64 = 3;
const OTP_SEND_RATE_LIMIT_SECONDS: i64 = 900;
const OTP_VERIFY_RATE_LIMIT_MAX: i64 = 5;
const OTP_VERIFY_RATE_LIMIT_SECONDS: i64 = 300;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/booking-portal/v2/public/:tenant_slug",
            axum::routing::get(booking_portal_v2_public_tenant),
        )
        .route(
            "/booking-portal/v2/sessions",
            axum::routing::post(booking_portal_v2_create_session),
        )
        .route(
            "/booking-portal/v2/sessions/:id/events",
            axum::routing::post(booking_portal_v2_session_event),
        )
        .route(
            "/booking-portal/v2/services",
            axum::routing::get(booking_portal_v2_services),
        )
        .route(
            "/booking-portal/v2/staff",
            axum::routing::get(booking_portal_v2_staff),
        )
        .route(
            "/booking-portal/v2/slots",
            axum::routing::post(booking_portal_v2_slots),
        )
        .route(
            "/booking-portal/v2/nearby-alternatives",
            axum::routing::post(booking_portal_v2_nearby_alternatives),
        )
        .route(
            "/booking-portal/v2/holds",
            axum::routing::post(booking_portal_v2_holds),
        )
        .route(
            "/booking-portal/v2/otps/send",
            axum::routing::post(booking_portal_v2_send_otp),
        )
        .route(
            "/booking-portal/v2/otps/verify",
            axum::routing::post(booking_portal_v2_verify_otp),
        )
        .route(
            "/booking-portal/v2/multi-service/timeline",
            axum::routing::post(booking_portal_v2_multi_service_timeline),
        )
        .route(
            "/booking-portal/v2/multi-service/confirm",
            axum::routing::post(booking_portal_v2_multi_service_confirm),
        )
        .route(
            "/booking-portal/v2/confirm",
            axum::routing::post(booking_portal_v2_confirm),
        )
        .route(
            "/booking-portal/v2/quote",
            axum::routing::post(booking_portal_v2_quote),
        )
        .route(
            "/booking-portal/v2/my-bookings",
            axum::routing::get(booking_portal_v2_my_bookings),
        )
        .route(
            "/booking-portal/v2/sessions",
            axum::routing::get(booking_portal_v2_sessions),
        )
        .route(
            "/booking-portal/v2/abandonments",
            axum::routing::get(booking_portal_v2_abandonments),
        )
}

async fn booking_portal_v2_public_tenant(
    State(state): State<AppState>,
    Path(path): Path<PublicTenantPath>,
) -> Result<Json<Value>, ApiError> {
    let tenant_slug = path.tenant_slug;
    let tenant = sqlx::query(
        "SELECT id::text as id, name FROM tenants WHERE slug=$1 OR id::text=$1 LIMIT 1",
    )
    .bind(&tenant_slug)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load tenant"))?
    .ok_or_else(|| ApiError::not_found(format!("tenant not found: {tenant_slug}")))?;
    let tenant_id: String = tenant.try_get("id").unwrap_or_default();
    let branch_rows = sqlx::query("SELECT id::text as id, name, address, latitude, longitude, booking_deposit_percent, created_at FROM branches WHERE tenant_id = $1::uuid AND active = true")
        .bind(&tenant_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let mut branches = Vec::new();
    for row in branch_rows {
        let branch_id = row.try_get::<String, _>("id").unwrap_or_default();
        let booking_token = appointments::issue_public_booking_token(
            &state, &tenant_id, &branch_id, None, None, "confirm", 30,
        )?;
        branches.push(json!({
            "id": branch_id,
            "name": row.try_get::<String, _>("name").unwrap_or_default(),
            "address": row.try_get::<String, _>("address").unwrap_or_default(),
            "latitude": row.try_get::<Option<f64>, _>("latitude").unwrap_or_default(),
            "longitude": row.try_get::<Option<f64>, _>("longitude").unwrap_or_default(),
            "bookingDepositPercent": row.try_get::<i32, _>("booking_deposit_percent").unwrap_or(0),
            "bookingToken": booking_token,
        }));
    }

    Ok(Json(json!({
        "tenant": {
            "id": tenant_id,
            "name": tenant.try_get::<String,_>("name").unwrap_or_default(),
        },
        "branches": branches,
        "captcha": {
            "provider": "turnstile",
            "required": state.settings.turnstile_enabled(),
            "siteKey": state.settings.turnstile_site_key.as_deref().unwrap_or_default(),
        }
    })))
}

async fn booking_portal_v2_create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PublicSessionBody>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) =
        match appointments::require_public_booking_claims(&state, &headers, "confirm") {
            Ok(claims) => (claims.tenant_id, claims.branch_id),
            Err(_) => scope_for_query(&headers, None, body.branch_id.as_deref()),
        };
    let id = Uuid::new_v4().to_string();
    let source = body.source.unwrap_or_else(|| "portal".to_string());
    let device_type = body.device_type.unwrap_or_default();
    sqlx::query("INSERT INTO public_booking_sessions (id,tenant_id,branch_id,source,device_type) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&source).bind(&device_type)
        .execute(&state.db).await
        .map_err(|_| ApiError::internal("failed to create booking session"))?;
    sqlx::query("INSERT INTO public_booking_session_events (tenant_id,branch_id,session_id,event_name,step_order) VALUES ($1,$2,$3,'session_started',0)")
        .bind(&tenant_id).bind(&branch_id).bind(&id).execute(&state.db).await
        .map_err(|_| ApiError::internal("failed to record booking session"))?;
    if let Some(reference) = source.strip_prefix("marketing_campaign:") {
        let mut parts = reference.split(':');
        if let (Some(campaign_id), Some(client_id), None) =
            (parts.next(), parts.next(), parts.next())
        {
            sqlx::query("INSERT INTO marketing_campaign_events(tenant_id,branch_id,campaign_id,client_id,channel,event_type) SELECT DISTINCT tenant_id,branch_id,$3,$4,channel,'clicked' FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$4 AND source_type='marketing_campaign' AND payload_json->>'campaignId'=$3 ON CONFLICT DO NOTHING")
                .bind(&tenant_id).bind(&branch_id).bind(campaign_id).bind(client_id).execute(&state.db).await
                .map_err(|_| ApiError::internal("failed to record campaign click"))?;
        }
    }
    Ok(Json(json!({
        "id": id,
        "tenantId": tenant_id,
        "branchId": branch_id,
        "source": source,
        "deviceType": device_type,
        "createdAt": Utc::now().to_rfc3339(),
        "status": "created"
    })))
}

async fn booking_portal_v2_session_event(
    State(state): State<AppState>,
    _headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PublicSessionEventBody>,
) -> Result<Json<Value>, ApiError> {
    let session =
        sqlx::query("SELECT tenant_id,branch_id FROM public_booking_sessions WHERE id=$1")
            .bind(&id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::internal("failed to load booking session"))?
            .ok_or_else(|| ApiError::not_found("booking session was not found"))?;
    let tenant_id = session
        .try_get::<String, _>("tenant_id")
        .unwrap_or_default();
    let branch_id = session
        .try_get::<String, _>("branch_id")
        .unwrap_or_default();
    if body.event_name.trim().is_empty() {
        return Err(ApiError::bad_request("eventName is required"));
    }
    let event_name = body.event_name.trim();
    let mut event_data = body.event_data.unwrap_or_else(|| json!({}));
    let contact_value = if event_name == "otp_verified" {
        event_data
            .get("mobile")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| value.len() >= 8 && value.len() <= 20)
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    };
    if let Some(data) = event_data.as_object_mut() {
        data.remove("mobile");
    }
    let step_order = body.step_order.unwrap_or(0).clamp(0, 100) as i32;
    let event_id = Uuid::new_v4().to_string();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to record booking event"))?;
    sqlx::query("INSERT INTO public_booking_session_events (id,tenant_id,branch_id,session_id,event_name,step_order,event_data) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&event_id).bind(&tenant_id).bind(&branch_id).bind(&id).bind(event_name).bind(step_order).bind(&event_data)
        .execute(&mut *tx).await.map_err(|_| ApiError::internal("failed to record booking event"))?;
    sqlx::query("UPDATE public_booking_sessions SET last_event=$2,last_step=GREATEST(last_step,$3),event_data=$4,contact_value=CASE WHEN $5='' THEN contact_value ELSE $5 END,last_event_at=NOW() WHERE id=$1 AND status='active'")
        .bind(&id).bind(event_name).bind(step_order).bind(&event_data).bind(&contact_value).execute(&mut *tx).await
        .map_err(|_| ApiError::internal("failed to update booking session"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to record booking event"))?;
    Ok(Json(json!({
        "id": event_id,
        "tenantId": tenant_id,
        "branchId": branch_id,
        "sessionId": id,
        "event": event_name,
        "eventData": event_data,
        "stepOrder": step_order,
        "createdAt": Utc::now().to_rfc3339(),
        "status": "recorded"
    })))
}

async fn booking_portal_v2_services(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<V2ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = required_scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    )?;
    let rows = sqlx::query(
        "SELECT service.id, service.name, service.category, service.duration_minutes, service.price_paise,
                COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',item.id,'name',item.name,'priceDeltaPaise',item.price_delta_paise,'durationDeltaMinutes',item.duration_delta_minutes) ORDER BY item.created_at,item.id) FROM service_variants item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id AND item.active=TRUE),'[]'::jsonb) AS variants,
                COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',item.id,'name',item.name,'pricePaise',item.price_paise,'durationMinutes',item.duration_minutes) ORDER BY item.created_at,item.id) FROM service_addons item WHERE item.tenant_id=service.tenant_id AND item.branch_id=service.branch_id AND item.service_id=service.id AND item.active=TRUE),'[]'::jsonb) AS addons
           FROM services service WHERE service.tenant_id=$1 AND service.branch_id=$2 AND service.active=true ORDER BY service.name LIMIT 200",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking services"))?;
    let services = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "durationMinutes": row.try_get::<i32, _>("duration_minutes").unwrap_or_default(),
                "pricePaise": row.try_get::<i64, _>("price_paise").unwrap_or_default(),
                "variants": row.try_get::<Value, _>("variants").unwrap_or_else(|_| json!([])),
                "addons": row.try_get::<Value, _>("addons").unwrap_or_else(|_| json!([]))
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "services": services
    })))
}

async fn booking_portal_v2_staff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<V2ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = required_scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    )?;
    let rows = sqlx::query(
        "SELECT id, first_name, last_name, appointment_display_name, job_title FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=true ORDER BY appointment_display_name, first_name LIMIT 200",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking staff"))?;
    let staff = rows
        .into_iter()
        .map(|row| {
            let first_name = row.try_get::<String, _>("first_name").unwrap_or_default();
            let last_name = row.try_get::<String, _>("last_name").unwrap_or_default();
            let display_name = row
                .try_get::<String, _>("appointment_display_name")
                .unwrap_or_default();
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "name": if display_name.trim().is_empty() { format!("{} {}", first_name, last_name).trim().to_string() } else { display_name },
                "jobTitle": row.try_get::<String, _>("job_title").unwrap_or_default()
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "staff": staff
    })))
}

pub(crate) async fn booking_portal_v2_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SlotRequest>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) =
        required_scope_for_query(&headers, None, payload.branch_id.as_deref())?;
    let service_ids = payload.service_ids.unwrap_or_default();
    if service_ids.is_empty() {
        return Err(ApiError::bad_request("serviceIds are required"));
    }
    let date = payload
        .date
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let duration = real_booking_duration_minutes(&state, &tenant_id, &branch_id, &service_ids)
        .await?
        .unwrap_or_else(|| payload.duration.unwrap_or(DEFAULT_SLOT_MINUTES).max(15));
    let count = payload.count.unwrap_or(DEFAULT_SLOT_COUNT).clamp(1, 24);
    let slots = generate_slots(
        &state,
        &tenant_id,
        &date,
        branch_id.clone(),
        service_ids,
        count,
        duration,
    )
    .await?;
    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "slots": slots,
        "recommendations": slots,
        "cache": "MISS"
    })))
}

async fn booking_portal_v2_nearby_alternatives(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<NearbyAlternativesRequest>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, origin_branch_id) =
        required_scope_for_query(&headers, None, payload.branch_id.as_deref())?;
    let service_ids = payload.service_ids.unwrap_or_default();
    if service_ids.is_empty() {
        return Err(ApiError::bad_request("serviceIds are required"));
    }
    let source_rows = sqlx::query(
        "SELECT id,COALESCE(NULLIF(central_master_service_id,''),id) AS master_id FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND id=ANY($3)",
    )
    .bind(&tenant_id)
    .bind(&origin_branch_id)
    .bind(&service_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate booking services"))?;
    if source_rows.len() != service_ids.len() {
        return Err(ApiError::bad_request(
            "one or more services are unavailable",
        ));
    }
    let master_by_service = source_rows
        .into_iter()
        .filter_map(|row| {
            Some((
                row.try_get::<String, _>("id").ok()?,
                row.try_get::<String, _>("master_id").ok()?,
            ))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let master_ids = ordered_service_mapping(&service_ids, &master_by_service)
        .ok_or_else(|| ApiError::bad_request("one or more services are unavailable"))?;
    let date = payload
        .date
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let count = payload.count.unwrap_or(3).clamp(1, 12);
    let branches = sqlx::query(
        "SELECT id::TEXT AS id,name,address,latitude,longitude FROM branches WHERE tenant_id=$1::uuid AND active=TRUE AND id::TEXT<>$2 ORDER BY name LIMIT 12",
    )
    .bind(&tenant_id)
    .bind(&origin_branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load nearby branches"))?;
    let mut alternatives = Vec::new();
    for branch in branches {
        let branch_id = branch.try_get::<String, _>("id").unwrap_or_default();
        let mapped_rows = sqlx::query(
            "SELECT id,COALESCE(NULLIF(central_master_service_id,''),id) AS master_id FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND COALESCE(NULLIF(central_master_service_id,''),id)=ANY($3) ORDER BY id",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&master_ids)
        .fetch_all(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to map branch services"))?;
        let mapped_by_master = mapped_rows
            .into_iter()
            .filter_map(|row| {
                Some((
                    row.try_get::<String, _>("master_id").ok()?,
                    row.try_get::<String, _>("id").ok()?,
                ))
            })
            .collect::<std::collections::HashMap<_, _>>();
        let Some(mapped_service_ids) = ordered_service_mapping(&master_ids, &mapped_by_master)
        else {
            continue;
        };
        let Some(duration) =
            real_booking_duration_minutes(&state, &tenant_id, &branch_id, &mapped_service_ids)
                .await?
        else {
            continue;
        };
        let slots = generate_slots(
            &state,
            &tenant_id,
            &date,
            branch_id.clone(),
            mapped_service_ids.clone(),
            count,
            duration,
        )
        .await?;
        if slots.is_empty() {
            continue;
        }
        alternatives.push(json!({
            "branchId": branch_id,
            "branchName": branch.try_get::<String, _>("name").unwrap_or_default(),
            "address": branch.try_get::<String, _>("address").unwrap_or_default(),
            "latitude": branch.try_get::<Option<f64>, _>("latitude").unwrap_or_default(),
            "longitude": branch.try_get::<Option<f64>, _>("longitude").unwrap_or_default(),
            "serviceIds": mapped_service_ids,
            "slots": slots,
        }));
    }
    Ok(Json(json!({
        "tenantId": tenant_id,
        "originBranchId": origin_branch_id,
        "date": date,
        "alternatives": alternatives,
    })))
}

async fn booking_portal_v2_holds(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<HoldRequest>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) =
        required_scope_for_query(&headers, None, payload.branch_id.as_deref())?;
    let start_at = payload
        .start_at
        .ok_or_else(|| ApiError::bad_request("startAt is required for hold"))?;
    let end_at = payload
        .end_at
        .ok_or_else(|| ApiError::bad_request("endAt is required for hold"))?;
    parse_rfc3339_utc(&start_at, "startAt")?;
    parse_rfc3339_utc(&end_at, "endAt")?;
    let service_ids = payload.service_ids.unwrap_or_default();
    if service_ids.is_empty() {
        return Err(ApiError::bad_request("serviceIds are required for hold"));
    }
    if real_booking_duration_minutes(&state, &tenant_id, &branch_id, &service_ids)
        .await?
        .is_none()
    {
        return Err(ApiError::bad_request(
            "one or more services are unavailable",
        ));
    }
    let hold_id = Uuid::new_v4().to_string();
    let slot_id = payload.slot_id.unwrap_or_else(|| hold_id.clone());
    let expires_at = Utc::now() + Duration::minutes(5);
    let hold = json!({
        "holdId": hold_id,
        "tenantId": tenant_id,
        "branchId": branch_id,
        "slotId": slot_id,
        "appointmentId": payload.appointment_id.unwrap_or_default(),
        "serviceIds": service_ids,
        "startAt": start_at,
        "endAt": end_at,
        "mobile": payload.mobile.unwrap_or_default(),
        "expiresAt": expires_at.to_rfc3339()
    });
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to hold store"))?;
    let _: () = redis::cmd("SETEX")
        .arg(booking_hold_key(
            hold["holdId"].as_str().unwrap_or_default(),
        ))
        .arg(300)
        .arg(hold.to_string())
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to save booking hold"))?;
    Ok(Json(json!({
        "holdId": hold["holdId"],
        "tenantId": hold["tenantId"],
        "branchId": hold["branchId"],
        "slotId": hold["slotId"],
        "appointmentId": hold["appointmentId"],
        "expiresAt": hold["expiresAt"],
        "status": "held"
    })))
}

async fn booking_portal_v2_send_otp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PublicSessionQuery>,
) -> Result<Json<Value>, ApiError> {
    let mobile = query.mobile.trim().to_string();
    if mobile.is_empty() {
        return Err(ApiError::bad_request("mobile required"));
    }
    let purpose = query.purpose.unwrap_or_else(|| "booking".to_string());
    let language = query.language.unwrap_or_else(|| "en".to_string());
    verify_turnstile(&state, &headers).await?;
    if state.settings.invoice_delivery_webhook_url.is_none() {
        return Err(ApiError::with_status(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "otp delivery provider is not configured",
        ));
    }
    enforce_redis_rate_limit(
        &state,
        &otp_send_rate_key(&mobile, &purpose),
        OTP_SEND_RATE_LIMIT_MAX,
        OTP_SEND_RATE_LIMIT_SECONDS,
    )
    .await?;
    let otp = generate_otp();
    let key = otp_key(&mobile, &purpose);
    let hash = otp_hash(&mobile, &purpose, &otp, &state.settings.jwt_refresh_secret);
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to otp store"))?;
    let _: () = redis::cmd("SETEX")
        .arg(&key)
        .arg(300)
        .arg(hash)
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to save otp"))?;

    let delivery = booking_otp_delivery_payload(&mobile, &purpose, &language, &otp);
    let provider_message_id = match invoice_delivery::deliver(&state.settings, &delivery).await {
        Ok(message_id) => message_id,
        Err(_) => {
            let _: () = redis::cmd("DEL")
                .arg(&key)
                .query_async(&mut redis)
                .await
                .map_err(|_| ApiError::internal("failed to clear undelivered otp"))?;
            return Err(ApiError::with_status(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "otp delivery provider is unavailable",
            ));
        }
    };

    Ok(Json(json!({
        "mobile": mobile,
        "purpose": purpose,
        "language": language,
        "ttl": 300,
        "sent": true,
        "providerMessageId": provider_message_id,
        "requestId": Uuid::new_v4().to_string()
    })))
}

#[derive(Deserialize)]
struct TurnstileVerification {
    success: bool,
}

async fn verify_turnstile(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if !state.settings.turnstile_enabled() {
        return Ok(());
    }
    let token = headers
        .get("x-turnstile-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("captcha verification is required"))?;
    let secret = state
        .settings
        .turnstile_secret_key
        .as_deref()
        .ok_or_else(|| ApiError::internal("captcha provider is not configured"))?;
    let response = reqwest::Client::new()
        .post("https://challenges.cloudflare.com/turnstile/v0/siteverify")
        .form(&[("secret", secret), ("response", token)])
        .send()
        .await
        .map_err(|_| {
            ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "captcha provider is unavailable",
            )
        })?;
    if !response.status().is_success() {
        return Err(ApiError::with_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "captcha provider rejected verification",
        ));
    }
    let verification = response
        .json::<TurnstileVerification>()
        .await
        .map_err(|_| ApiError::internal("captcha provider returned an invalid response"))?;
    if !verification.success {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "captcha verification failed",
        ));
    }
    Ok(())
}

fn booking_otp_delivery_payload(mobile: &str, purpose: &str, language: &str, otp: &str) -> Value {
    json!({
        "channel": "sms",
        "recipient": mobile,
        "templateKind": "bookingOtp",
        "template": "booking_otp",
        "code": otp,
        "purpose": purpose,
        "language": language,
        "ttlSeconds": 300,
        "message": format!("Your booking verification code is {otp}. It expires in 5 minutes.")
    })
}

#[derive(Deserialize)]
struct PublicSessionQuery {
    mobile: String,
    purpose: Option<String>,
    language: Option<String>,
}

async fn booking_portal_v2_verify_otp(
    State(state): State<AppState>,
    Json(body): Json<OtpVerifyRequest>,
) -> Result<Json<Value>, ApiError> {
    let mobile = body.mobile.trim().to_string();
    if mobile.is_empty() || body.otp.trim().is_empty() {
        return Err(ApiError::bad_request("mobile and otp required"));
    }
    let purpose = body.purpose.unwrap_or_else(|| "booking".to_string());
    enforce_redis_rate_limit(
        &state,
        &otp_verify_rate_key(&mobile, &purpose),
        OTP_VERIFY_RATE_LIMIT_MAX,
        OTP_VERIFY_RATE_LIMIT_SECONDS,
    )
    .await?;
    let key = otp_key(&mobile, &purpose);
    let expected = otp_hash(
        &mobile,
        &purpose,
        &body.otp,
        &state.settings.jwt_refresh_secret,
    );
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to otp store"))?;
    let stored: Option<String> = redis::cmd("GET")
        .arg(&key)
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to read otp"))?;
    let verified = stored.as_deref() == Some(expected.as_str());
    if verified {
        let _: () = redis::cmd("DEL")
            .arg(&key)
            .query_async(&mut redis)
            .await
            .map_err(|_| ApiError::internal("failed to clear otp"))?;
        let _: () = redis::cmd("DEL")
            .arg(otp_verify_rate_key(&mobile, &purpose))
            .query_async(&mut redis)
            .await
            .map_err(|_| ApiError::internal("failed to clear otp attempts"))?;
        let _: () = redis::cmd("SETEX")
            .arg(otp_verified_key(&mobile, &purpose))
            .arg(600)
            .arg("1")
            .query_async(&mut redis)
            .await
            .map_err(|_| ApiError::internal("failed to save otp verification"))?;
    }
    Ok(Json(json!({
        "mobile": mobile,
        "purpose": purpose,
        "verified": verified
    })))
}

async fn booking_portal_v2_multi_service_timeline(
    Json(body): Json<MultiServiceBody>,
) -> Result<Json<Value>, ApiError> {
    let services = body.services.unwrap_or_else(|| json!([]));
    Ok(Json(json!({
        "services": services,
        "timeline": [
            {
                "step": "intake",
                "status": "ok"
            },
            {
                "step": "availability",
                "status": "ok"
            }
        ]
    })))
}

async fn booking_portal_v2_multi_service_confirm(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Json<MultiServiceBody>,
) -> Result<Json<Value>, ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "confirm")?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id;
    let requested_services = body.0.services.unwrap_or_else(|| json!([]));
    let fallback_services = requested_services.clone();
    let service_items = match requested_services {
        Value::Array(items) => items,
        Value::Object(item) => vec![Value::Object(item)],
        _ => Vec::new(),
    };
    let mobile = service_items
        .iter()
        .find_map(|item| item.get("mobile").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("mobile is required for otp verification"))?;
    ensure_booking_otp_verified(&state, mobile, "booking").await?;

    let mut created_appointments = Vec::new();
    let mut skipped_count = 0usize;

    for item in service_items.iter() {
        let mut service_ids = item
            .get("serviceIds")
            .and_then(Value::as_array)
            .map(|value| {
                value
                    .iter()
                    .filter_map(|raw| raw.as_str())
                    .map(str::trim)
                    .filter(|raw| !raw.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if service_ids.is_empty() {
            if let Some(value) = item
                .get("serviceId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                service_ids.push(value.to_string());
            }
        }

        if service_ids.is_empty() {
            skipped_count += 1;
            continue;
        }

        let start_at = item
            .get("startAt")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let mut end_at = item
            .get("endAt")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| add_minutes(&start_at, DEFAULT_SLOT_MINUTES));
        if DateTime::parse_from_rfc3339(&start_at).is_err() {
            skipped_count += 1;
            continue;
        }
        if DateTime::parse_from_rfc3339(&end_at).is_err() {
            end_at = add_minutes(&start_at, DEFAULT_SLOT_MINUTES);
        }

        let branch_override = item
            .get("branchId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if branch_override.is_some_and(|requested| requested != branch_id.as_str()) {
            skipped_count += 1;
            continue;
        }

        let client_id = item
            .get("clientId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                item.get("mobile")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| format!("anon-{}", Uuid::new_v4()));

        let create = AppointmentCreatePayload {
            tenant_id: Some(tenant_id.clone()),
            branch_id: Some(branch_id.clone()),
            requested_staff_id: item
                .get("staffId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            staff_preference: "preferred".to_string(),
            staff_id: item
                .get("staffId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            client_id,
            service_ids,
            start_at,
            end_at,
            notes: item
                .get("notes")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status: "booked".to_string(),
            booking_group_id: String::new(),
            source_channel: Some("booking-portal-v2".to_string()),
            source: Some("public-booking".to_string()),
            chair_room_id: String::new(),
            service_selections: Vec::new(),
        };

        if let Ok(json_payload) =
            appointments::create_appointment(State(state.clone()), headers.clone(), Json(create))
                .await
        {
            created_appointments.push(json_payload.0);
        } else {
            skipped_count += 1;
        }
    }

    if created_appointments.is_empty() {
        return Ok(Json(json!({
            "services": fallback_services,
            "status": "accepted"
        })));
    }

    Ok(Json(json!({
        "services": fallback_services,
        "status": "accepted",
        "appointments": created_appointments,
        "createdCount": created_appointments.len(),
        "skippedCount": skipped_count
    })))
}

async fn booking_portal_v2_confirm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ConfirmRequest>,
) -> Result<Json<Value>, ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "confirm")?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id;
    if payload
        .branch_id
        .as_deref()
        .is_some_and(|requested| requested != branch_id.as_str())
    {
        return Err(ApiError::with_status(
            axum::http::StatusCode::FORBIDDEN,
            "public booking token is not valid for this branch",
        ));
    }
    let mobile = payload
        .mobile
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("mobile is required for otp verification"))?
        .to_string();
    ensure_booking_otp_verified(&state, &mobile, "booking").await?;
    let hold_id = payload
        .hold_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("holdId is required before confirm"))?;
    let hold = read_booking_hold(&state, hold_id).await?;
    validate_booking_hold(&hold, &tenant_id, &branch_id, &mobile)?;

    let client_id = payload
        .client_id
        .unwrap_or_else(|| format!("anon-{}", mobile));
    if client_id.trim().is_empty() {
        return Err(ApiError::bad_request("clientId is required"));
    }
    let hold_services = hold_service_ids(&hold)?;
    let services = match payload.service_ids {
        Some(ids) if !ids.is_empty() => {
            if ids != hold_services {
                return Err(ApiError::bad_request(
                    "requested services do not match booking hold",
                ));
            }
            ids
        }
        _ => match payload.service_id {
            Some(id) if !id.trim().is_empty() => {
                let single = vec![id];
                if single != hold_services {
                    return Err(ApiError::bad_request(
                        "requested service does not match booking hold",
                    ));
                }
                single
            }
            _ => hold_services,
        },
    };
    let hold_start_at = hold["startAt"].as_str().unwrap_or_default().to_string();
    let hold_end_at = hold["endAt"].as_str().unwrap_or_default().to_string();
    if payload
        .start_at
        .as_deref()
        .is_some_and(|requested| requested != hold_start_at)
        || payload
            .end_at
            .as_deref()
            .is_some_and(|requested| requested != hold_end_at)
    {
        return Err(ApiError::bad_request(
            "requested time does not match booking hold",
        ));
    }
    let start_at = hold_start_at;
    let mut end_at = hold_end_at;
    if DateTime::parse_from_rfc3339(&start_at).is_err() {
        return Err(ApiError::bad_request("startAt must be RFC3339"));
    }
    if DateTime::parse_from_rfc3339(&end_at).is_err() {
        end_at = add_minutes(&start_at, DEFAULT_SLOT_MINUTES);
    }

    let staff_id = payload.staff_id.unwrap_or_default();
    let service_selections = payload.service_selections;
    let total_paise = appointments::validate_service_pricing(
        &state,
        &tenant_id,
        &branch_id,
        &staff_id,
        &services,
        &service_selections,
        DateTime::parse_from_rfc3339(&start_at)
            .map_err(|_| ApiError::bad_request("startAt must be RFC3339"))?
            .with_timezone(&Utc),
    )
    .await?;
    let deposit_quote =
        booking_service::deposit_quote(&state.db, &tenant_id, &branch_id, total_paise)
            .await
            .map_err(|_| ApiError::internal("failed to load booking deposit policy"))?;
    let deposit_amount = deposit_quote.deposit_paise;
    let deposit = deposit_quote.as_json();
    let source = payload
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| {
            matches!(
                *value,
                "website" | "instagram" | "facebook" | "google" | "whatsapp" | "voice"
            )
        })
        .unwrap_or("public-booking")
        .to_string();
    let create = AppointmentCreatePayload {
        tenant_id: Some(tenant_id),
        branch_id: Some(branch_id.clone()),
        requested_staff_id: staff_id.clone(),
        staff_preference: "preferred".to_string(),
        staff_id,
        client_id,
        service_ids: services,
        start_at,
        end_at,
        notes: payload.notes.unwrap_or_default(),
        status: "booked".to_string(),
        booking_group_id: String::new(),
        source_channel: Some("booking-portal-v2".to_string()),
        source: Some(source),
        chair_room_id: String::new(),
        service_selections,
    };
    let created =
        appointments::create_appointment(State(state.clone()), headers, Json(create)).await?;
    let appointment = created.0;
    clear_booking_hold(&state, hold_id).await?;
    if let Some(session_id) = payload
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        sqlx::query("UPDATE public_booking_sessions SET status=CASE WHEN status='recovery_queued' THEN 'recovered' ELSE 'converted' END,client_id=$2,appointment_id=$3,last_event='booking_confirmed',last_event_at=NOW(),converted_at=NOW(),recovered_at=CASE WHEN status='recovery_queued' THEN NOW() ELSE recovered_at END WHERE id=$1 AND tenant_id=$4 AND branch_id=$5 AND status IN ('active','abandoned','recovery_queued')")
            .bind(session_id).bind(&appointment.client_id).bind(&appointment.id).bind(&appointment.tenant_id).bind(&appointment.branch_id)
            .execute(&state.db).await
            .map_err(|_| ApiError::internal("failed to complete booking funnel session"))?;
        sqlx::query("INSERT INTO public_booking_session_events (tenant_id,branch_id,session_id,event_name,step_order,event_data) SELECT tenant_id,branch_id,id,'booking_confirmed',100,jsonb_build_object('appointmentId',$2) FROM public_booking_sessions WHERE id=$1")
            .bind(session_id).bind(&appointment.id).execute(&state.db).await
            .map_err(|_| ApiError::internal("failed to record booking conversion"))?;
    }
    let action_token = appointments::issue_public_booking_token(
        &state,
        &appointment.tenant_id,
        &appointment.branch_id,
        Some(&appointment.id),
        Some(&appointment.client_id),
        "action",
        60 * 24 * 14,
    )?;
    let public_actions = json!({
        "view": action_token.clone(),
        "edit": action_token
    });
    Ok(Json(json!({
        "appointmentId": appointment.id,
        "version": appointment.version,
        "appointment": appointment,
        "deposit": deposit,
        "paymentLink": null,
        "paymentStatus": if deposit_amount > 0 { "pending" } else { "not_required" },
        "publicActions": public_actions,
        "requiredActions": if deposit_amount > 0 { vec!["deposit"] } else { Vec::<&str>::new() }
    })))
}

async fn booking_portal_v2_quote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<QuoteRequest>,
) -> Result<Json<Value>, ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "confirm")?;
    if payload
        .branch_id
        .as_deref()
        .is_some_and(|branch_id| branch_id != claims.branch_id)
    {
        return Err(ApiError::with_status(
            axum::http::StatusCode::FORBIDDEN,
            "public booking token is not valid for this branch",
        ));
    }
    if payload.service_ids.is_empty() {
        return Err(ApiError::bad_request("serviceIds are required"));
    }
    let starts_at = DateTime::parse_from_rfc3339(&payload.starts_at)
        .map_err(|_| ApiError::bad_request("startsAt must be RFC3339"))?
        .with_timezone(&Utc);
    let total_paise = appointments::validate_service_pricing(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        &payload.staff_id,
        &payload.service_ids,
        &payload.service_selections,
        starts_at,
    )
    .await?;
    let quote = booking_service::deposit_quote(
        &state.db,
        &claims.tenant_id,
        &claims.branch_id,
        total_paise,
    )
    .await
    .map_err(|_| ApiError::internal("failed to load booking deposit policy"))?;
    Ok(Json(quote.as_json()))
}

async fn booking_portal_v2_my_bookings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MyBookingQuery>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "action")?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id;
    let claim_client_id = claims.client_id.clone();
    let client_id = query
        .client_id
        .filter(|value| !value.trim().is_empty())
        .or(claim_client_id.clone())
        .ok_or_else(|| ApiError::bad_request("clientId is required"))?;
    if claim_client_id
        .as_deref()
        .is_some_and(|owned_client_id| owned_client_id != client_id)
    {
        return Err(ApiError::with_status(
            axum::http::StatusCode::FORBIDDEN,
            "public booking token is not valid for this client",
        ));
    }
    let list = appointments::list_appointments(
        State(state),
        headers,
        Query(ListAppointmentQuery {
            tenant_id: Some(tenant_id),
            branch_id: Some(branch_id),
            status: None,
            client_id: Some(client_id),
        }),
    )
    .await?;
    Ok(list)
}

async fn booking_portal_v2_sessions(
    State(state): State<AppState>,
    Query(query): Query<SessionListQuery>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(&headers, query.tenant_id.as_deref(), None);
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'source',source,'deviceType',device_type,'status',status,'lastEvent',last_event,'lastStep',last_step,'createdAt',created_at,'lastEventAt',last_event_at) FROM public_booking_sessions WHERE tenant_id=$1 AND ($2='' OR branch_id=$2) ORDER BY created_at DESC LIMIT 200")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking sessions"))?;
    Ok(Json(json!({
        "tenantId": tenant_id,
        "sessions": rows
    })))
}

async fn booking_portal_v2_abandonments(
    State(state): State<AppState>,
    Query(query): Query<SessionListQuery>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(&headers, query.tenant_id.as_deref(), None);
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'source',source,'deviceType',device_type,'status',status,'lastEvent',last_event,'lastStep',last_step,'createdAt',created_at,'abandonedAt',abandoned_at,'recoveredAt',recovered_at) FROM public_booking_sessions WHERE tenant_id=$1 AND ($2='' OR branch_id=$2) AND status IN ('abandoned','recovery_queued','recovered') ORDER BY COALESCE(abandoned_at,last_event_at) DESC LIMIT 200")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking abandonments"))?;
    Ok(Json(json!({
        "tenantId": tenant_id,
        "abandonments": rows
    })))
}

fn scope_for_query(
    headers: &HeaderMap,
    tenant_id: Option<&str>,
    branch_id: Option<&str>,
) -> (String, String) {
    appointments::scope_from_headers(headers, tenant_id, branch_id)
}

fn required_scope_for_query(
    headers: &HeaderMap,
    tenant_id: Option<&str>,
    branch_id: Option<&str>,
) -> Result<(String, String), ApiError> {
    let tenant = headers
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| tenant_id.map(str::trim).filter(|value| !value.is_empty()))
        .ok_or_else(|| ApiError::bad_request("tenantId is required"))?;
    let branch = headers
        .get("x-branch-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| branch_id.map(str::trim).filter(|value| !value.is_empty()))
        .ok_or_else(|| ApiError::bad_request("branchId is required"))?;
    Ok((tenant.to_string(), branch.to_string()))
}

fn parse_rfc3339_utc(value: &str, field: &str) -> Result<DateTime<Utc>, ApiError> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .map_err(|_| ApiError::bad_request(format!("{} must be RFC3339", field)))
}

fn add_minutes(value: &str, minutes: i64) -> String {
    match DateTime::parse_from_rfc3339(value) {
        Ok(start) => (start + Duration::minutes(minutes))
            .with_timezone(&Utc)
            .to_rfc3339(),
        Err(_) => value.to_string(),
    }
}

fn generate_otp() -> String {
    format!("{:06}", OsRng.next_u32() % 1_000_000)
}

fn otp_key(mobile: &str, purpose: &str) -> String {
    format!(
        "booking_otp:{}:{}",
        purpose.trim().to_lowercase(),
        mobile.trim()
    )
}

fn otp_verified_key(mobile: &str, purpose: &str) -> String {
    format!(
        "booking_otp_verified:{}:{}",
        purpose.trim().to_lowercase(),
        mobile.trim()
    )
}

fn booking_hold_key(hold_id: &str) -> String {
    format!("booking_hold:{}", hold_id.trim())
}

async fn ensure_booking_otp_verified(
    state: &AppState,
    mobile: &str,
    purpose: &str,
) -> Result<(), ApiError> {
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to otp store"))?;
    let verified: Option<String> = redis::cmd("GET")
        .arg(otp_verified_key(mobile, purpose))
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to read otp verification"))?;
    if verified.as_deref() != Some("1") {
        return Err(ApiError::bad_request(
            "otp verification required before confirm",
        ));
    }
    Ok(())
}

async fn read_booking_hold(state: &AppState, hold_id: &str) -> Result<Value, ApiError> {
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to hold store"))?;
    let raw: Option<String> = redis::cmd("GET")
        .arg(booking_hold_key(hold_id))
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to read booking hold"))?;
    let raw = raw.ok_or_else(|| ApiError::bad_request("booking hold is missing or expired"))?;
    serde_json::from_str(&raw).map_err(|_| ApiError::internal("invalid booking hold"))
}

async fn clear_booking_hold(state: &AppState, hold_id: &str) -> Result<(), ApiError> {
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to hold store"))?;
    let _: () = redis::cmd("DEL")
        .arg(booking_hold_key(hold_id))
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to clear booking hold"))?;
    Ok(())
}

fn validate_booking_hold(
    hold: &Value,
    tenant_id: &str,
    branch_id: &str,
    mobile: &str,
) -> Result<(), ApiError> {
    if hold["tenantId"].as_str() != Some(tenant_id) || hold["branchId"].as_str() != Some(branch_id)
    {
        return Err(ApiError::with_status(
            axum::http::StatusCode::FORBIDDEN,
            "booking hold is not valid for this tenant or branch",
        ));
    }
    let hold_mobile = hold["mobile"].as_str().unwrap_or_default().trim();
    if !hold_mobile.is_empty() && hold_mobile != mobile.trim() {
        return Err(ApiError::bad_request(
            "booking hold mobile does not match otp mobile",
        ));
    }
    parse_rfc3339_utc(hold["startAt"].as_str().unwrap_or_default(), "hold.startAt")?;
    parse_rfc3339_utc(hold["endAt"].as_str().unwrap_or_default(), "hold.endAt")?;
    hold_service_ids(hold)?;
    Ok(())
}

fn hold_service_ids(hold: &Value) -> Result<Vec<String>, ApiError> {
    let ids = hold["serviceIds"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        return Err(ApiError::bad_request("booking hold has no services"));
    }
    Ok(ids)
}

fn otp_send_rate_key(mobile: &str, purpose: &str) -> String {
    format!(
        "booking_otp_send_rate:{}:{}",
        purpose.trim().to_lowercase(),
        mobile.trim()
    )
}

fn otp_verify_rate_key(mobile: &str, purpose: &str) -> String {
    format!(
        "booking_otp_verify_rate:{}:{}",
        purpose.trim().to_lowercase(),
        mobile.trim()
    )
}

async fn enforce_redis_rate_limit(
    state: &AppState,
    key: &str,
    max_attempts: i64,
    ttl_seconds: i64,
) -> Result<(), ApiError> {
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| ApiError::internal("failed to connect to rate limit store"))?;
    let count: i64 = redis::cmd("INCR")
        .arg(key)
        .query_async(&mut redis)
        .await
        .map_err(|_| ApiError::internal("failed to update rate limit"))?;
    if count == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(key)
            .arg(ttl_seconds)
            .query_async(&mut redis)
            .await
            .map_err(|_| ApiError::internal("failed to expire rate limit"))?;
    }
    if count > max_attempts {
        return Err(ApiError::with_status(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "too many otp attempts; try again later",
        ));
    }
    Ok(())
}

fn otp_hash(mobile: &str, purpose: &str, otp: &str, secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(mobile.trim().as_bytes());
    hasher.update(b"|");
    hasher.update(purpose.trim().to_lowercase().as_bytes());
    hasher.update(b"|");
    hasher.update(otp.trim().as_bytes());
    hasher.update(b"|");
    hasher.update(secret.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{booking_otp_delivery_payload, ordered_service_mapping};

    #[test]
    fn booking_otp_uses_real_sms_provider_payload() {
        let payload = booking_otp_delivery_payload("+919876543210", "booking", "en", "123456");

        assert_eq!(payload["channel"], "sms");
        assert_eq!(payload["recipient"], "+919876543210");
        assert_eq!(payload["template"], "booking_otp");
        assert_eq!(payload["code"], "123456");
        assert_eq!(payload["ttlSeconds"], 300);
    }

    #[test]
    fn nearby_branch_mapping_requires_every_selected_service() {
        let mapping = HashMap::from([("master-cut".to_string(), "branch-cut".to_string())]);

        assert_eq!(
            ordered_service_mapping(&["master-cut".to_string()], &mapping),
            Some(vec!["branch-cut".to_string()])
        );
        assert_eq!(
            ordered_service_mapping(
                &["master-cut".to_string(), "master-color".to_string()],
                &mapping
            ),
            None
        );
    }
}

async fn real_booking_duration_minutes(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
) -> Result<Option<i64>, ApiError> {
    if service_ids.is_empty() {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS matched_count, COALESCE(SUM(duration_minutes), 0)::BIGINT AS duration_minutes FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=true AND id = ANY($3)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_ids)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate booking services"))?;
    let matched_count = row.try_get::<i64, _>("matched_count").unwrap_or(0);
    if matched_count != service_ids.len() as i64 {
        return Ok(None);
    }
    Ok(Some(
        row.try_get::<i64, _>("duration_minutes")
            .unwrap_or(DEFAULT_SLOT_MINUTES)
            .max(15),
    ))
}

fn ordered_service_mapping(
    source_ids: &[String],
    target_by_source: &std::collections::HashMap<String, String>,
) -> Option<Vec<String>> {
    source_ids
        .iter()
        .map(|id| target_by_source.get(id).cloned())
        .collect()
}

pub(crate) async fn marketplace_availability(
    state: &AppState,
    branch_id: &str,
    service_id: &str,
    date: Option<&str>,
    count: Option<i64>,
) -> Result<Value, ApiError> {
    let row = sqlx::query(
        "SELECT COALESCE(NULLIF(t.slug,''),t.name,b.tenant_id::TEXT) AS tenant_id, COALESCE(NULLIF(b.code,''),b.name,b.id::TEXT) AS branch_id FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND b.active=TRUE",
    )
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate marketplace branch"))?
    .ok_or_else(|| ApiError::not_found("marketplace business was not found"))?;
    let tenant_id = row.try_get::<String, _>("tenant_id").unwrap_or_default();
    let branch_id = row.try_get::<String, _>("branch_id").unwrap_or_default();
    let services = vec![service_id.trim().to_string()];
    if services[0].is_empty() {
        return Err(ApiError::bad_request("serviceId is required"));
    }
    let duration = real_booking_duration_minutes(state, &tenant_id, &branch_id, &services)
        .await?
        .ok_or_else(|| ApiError::not_found("service is not available for online booking"))?;
    let date = date
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let slots = generate_slots(
        state,
        &tenant_id,
        &date,
        branch_id.clone(),
        services,
        count.unwrap_or(DEFAULT_SLOT_COUNT).clamp(1, 48),
        duration,
    )
    .await?;
    Ok(json!({"tenantId":tenant_id,"branchId":branch_id,"date":date,"slots":slots}))
}

async fn generate_slots(
    state: &AppState,
    tenant_id: &str,
    date: &str,
    branch_id: String,
    service_ids: Vec<String>,
    count: i64,
    duration_minutes: i64,
) -> Result<Vec<Value>, ApiError> {
    let now = Utc::now();
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap_or_else(|_| now.date_naive())
        .and_hms_opt(9, 0, 0)
        .unwrap_or_else(|| chrono::NaiveDateTime::default());
    let staff_rows = sqlx::query(
        "SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=true ORDER BY appointment_display_name, first_name LIMIT 200",
    )
    .bind(tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load staff availability"))?;
    let staff_ids = staff_rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .collect::<Vec<_>>();
    if staff_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut slots = Vec::new();
    for idx in 0..count {
        let step = duration_minutes.max(15);
        let minutes = idx * step;
        let slot_start = Utc
            .from_utc_datetime(&(day + chrono::Duration::hours((minutes / 60) as i64)))
            + Duration::minutes(minutes % 60);
        let slot_end = slot_start + Duration::minutes(step);
        let busy_rows = sqlx::query("SELECT staff_id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('cancelled','no-show') AND start_at < $4 AND end_at > $3 AND staff_id <> ''")
                .bind(tenant_id)
                .bind(&branch_id)
                .bind(slot_start)
                .bind(slot_end)
                .fetch_all(&state.db)
                .await
                .map_err(|_| ApiError::internal("failed to load appointment conflicts"))?;
        let busy_staff = busy_rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("staff_id").ok())
            .collect::<std::collections::HashSet<_>>();
        let available_staff = staff_ids
            .iter()
            .filter(|id| !busy_staff.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        if available_staff.is_empty() {
            continue;
        }
        slots.push(json!({
            "slotId": Uuid::new_v4().to_string(),
            "startAt": slot_start.to_rfc3339(),
            "endAt": slot_end.to_rfc3339(),
            "serviceIds": service_ids.clone(),
            "branchId": branch_id,
            "availableStaffIds": available_staff,
            "confidence": 100
        }));
    }
    Ok(slots)
}
