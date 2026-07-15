use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json, Router,
};
use chrono::{DateTime, Duration, TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use super::appointments::{
    self, ApiError, AppointmentCreatePayload, AppointmentPayload, AppointmentResponse,
    ReschedulePayload, StatusPayload,
};
use crate::state::AppState;

#[derive(Deserialize)]
pub(crate) struct BookingPortalContextQuery {
    #[serde(rename = "tenantId")]
    tenant_id: Option<String>,
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    #[serde(default)]
    domain: Option<String>,
}

#[derive(Deserialize)]
struct SlotRequest {
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    #[serde(rename = "serviceId")]
    service_id: Option<String>,
    #[serde(rename = "serviceIds")]
    service_ids: Option<Vec<String>>,
    date: Option<String>,
    #[serde(default)]
    duration: Option<i64>,
    #[serde(rename = "limit")]
    count: Option<i64>,
    #[serde(rename = "staffId")]
    staff_id: Option<String>,
}

#[derive(Deserialize)]
struct SlotReference {
    #[serde(rename = "startAt")]
    start_at: Option<String>,
    #[serde(rename = "endAt")]
    end_at: Option<String>,
    #[serde(rename = "staffId")]
    staff_id: Option<String>,
}

#[derive(Deserialize)]
struct ConfirmRequest {
    #[serde(rename = "clientId")]
    client_id: Option<String>,
    #[serde(rename = "serviceId")]
    service_id: Option<String>,
    #[serde(rename = "serviceIds")]
    service_ids: Option<Vec<String>>,
    #[serde(rename = "slot")]
    slot: Option<SlotReference>,
    #[serde(rename = "startAt")]
    start_at: Option<String>,
    #[serde(rename = "endAt")]
    end_at: Option<String>,
    #[serde(rename = "staffId")]
    staff_id: Option<String>,
    notes: Option<String>,
    #[serde(rename = "packageCreditId")]
    package_credit_id: Option<String>,
}

#[derive(Deserialize)]
struct CancelRequest {
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
struct RescheduleRequest {
    #[serde(rename = "slot")]
    slot: Option<SlotReference>,
    #[serde(rename = "startAt")]
    start_at: Option<String>,
    #[serde(rename = "endAt")]
    end_at: Option<String>,
    #[serde(rename = "staffId")]
    _staff_id: Option<String>,
    #[serde(rename = "branchId")]
    branch_id: Option<String>,
    reason: Option<String>,
}

const DEFAULT_SLOT_MINUTES: i64 = 45;
const DEFAULT_SLOT_COUNT: i64 = 8;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/booking-portal/context",
            axum::routing::get(booking_portal_context),
        )
        .route(
            "/booking-portal/slots",
            axum::routing::post(booking_portal_slots),
        )
        .route(
            "/booking-portal/confirm",
            axum::routing::post(booking_portal_confirm),
        )
        .route(
            "/booking-portal/appointments/:id/cancel",
            axum::routing::patch(booking_portal_cancel),
        )
        .route(
            "/booking-portal/appointments/:id/reschedule",
            axum::routing::patch(booking_portal_reschedule),
        )
}

async fn booking_portal_context(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BookingPortalContextQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let token = issue_confirm_token_if_branch_exists(&state, &tenant_id, &branch_id).await?;
    let branch_rows = sqlx::query(
        "SELECT id::text AS id, name FROM branches WHERE tenant_id::text=$1 AND ($2='' OR id::text=$2) AND active=true ORDER BY name LIMIT 50",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking branches"))?;
    let branches = branch_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "city": ""
            })
        })
        .collect::<Vec<_>>();
    let services = load_booking_services(&state, &tenant_id, &branch_id).await?;
    let staff = load_booking_staff(&state, &tenant_id, &branch_id).await?;
    let package_booking = load_booking_packages(&state, &tenant_id, &branch_id).await?;

    Ok(Json(json!({
        "tenantId": tenant_id,
        "tenant": { "id": tenant_id.clone() },
        "selectedBranchId": branch_id,
        "publicBookingToken": token,
        "domain": query.domain.unwrap_or_default(),
        "branding": { "captureMode": "ready-for-provider" },
        "branches": branches,
        "services": services,
        "staff": staff,
        "packages": package_booking.0,
        "packageClientPurchaseEnabled": package_booking.1,
        "paymentReady": {
            "onlinePayment": true,
            "modes": ["upi","card","wallet"],
            "captureMode": "ready-for-provider"
        }
    })))
}

async fn booking_portal_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SlotRequest>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(&headers, None, payload.branch_id.as_deref());
    let services = resolve_service_ids(&payload.service_id, payload.service_ids.as_deref());
    if services.is_empty() {
        return Err(ApiError::bad_request("serviceId or serviceIds required"));
    }

    let date = payload
        .date
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let duration = real_booking_duration_minutes(&state, &tenant_id, &branch_id, &services)
        .await?
        .unwrap_or_else(|| payload.duration.unwrap_or(DEFAULT_SLOT_MINUTES).max(15));
    let count = payload.count.unwrap_or(DEFAULT_SLOT_COUNT).clamp(1, 24);
    let slots = generate_slots(
        &state,
        &tenant_id,
        &date,
        branch_id.clone(),
        services.clone(),
        count,
        duration,
        payload.staff_id.clone(),
    )
    .await?;
    let recommendations = slots.clone();

    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "services": services,
        "slots": slots,
        "recommendations": recommendations,
        "predictive": { "status": "enabled", "cache": "MISS", "reason": "simple heuristic" }
    })))
}

async fn booking_portal_confirm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ConfirmRequest>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "confirm")?;
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id;
    let client_id = payload
        .client_id
        .unwrap_or_else(|| "online-guest".to_string());
    if client_id.trim().is_empty() {
        return Err(ApiError::bad_request("clientId is required"));
    }

    let services = resolve_service_ids(&payload.service_id, payload.service_ids.as_deref());
    if services.is_empty() {
        return Err(ApiError::bad_request("serviceId or serviceIds required"));
    }

    let slot = payload.slot.unwrap_or(SlotReference {
        start_at: payload.start_at,
        end_at: payload.end_at,
        staff_id: payload.staff_id,
    });
    let start_at = slot
        .start_at
        .ok_or_else(|| ApiError::bad_request("slot.startAt or startAt is required"))?;
    let end_at = slot
        .end_at
        .unwrap_or_else(|| add_minutes(&start_at, DEFAULT_SLOT_MINUTES));
    let staff_id = slot.staff_id.unwrap_or_default();

    let package_credit_id = payload.package_credit_id.unwrap_or_default();
    if !package_credit_id.trim().is_empty() {
        validate_package_credit_booking(
            &state,
            &tenant_id,
            &branch_id,
            &client_id,
            &services,
            &package_credit_id,
        )
        .await?;
    }

    let request = AppointmentCreatePayload {
        tenant_id: Some(tenant_id.clone()),
        branch_id: Some(branch_id.clone()),
        staff_id,
        client_id: client_id.clone(),
        service_ids: services.clone(),
        start_at,
        end_at,
        notes: payload.notes.unwrap_or_default(),
        status: "booked".to_string(),
        booking_group_id: String::new(),
        source_channel: Some("booking-portal".to_string()),
        source: Some("public-booking".to_string()),
        chair_room_id: String::new(),
        service_selections: Vec::new(),
    };

    let created =
        appointments::create_appointment(State(state.clone()), headers, Json(request)).await?;
    if !package_credit_id.trim().is_empty() {
        sqlx::query("INSERT INTO appointment_package_reservations (tenant_id,branch_id,appointment_id,client_package_credit_id,quantity,status) VALUES ($1,$2,$3,$4,1,'reserved')")
            .bind(&tenant_id).bind(&branch_id).bind(&created.0.id).bind(&package_credit_id)
            .execute(&state.db).await
            .map_err(|_| ApiError::internal("failed to reserve package credit"))?;
    }
    Ok(created)
}

async fn booking_portal_cancel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CancelRequest>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    appointments::require_public_booking_mutation_owner(&state, &headers, &id, None).await?;
    let status = StatusPayload {
        status: "cancelled".to_string(),
        reason: payload.reason.unwrap_or_default(),
        apply_group: false,
    };
    let response =
        appointments::cancel_appointment(State(state.clone()), headers, Path(id), Json(status))
            .await?;
    sqlx::query("UPDATE appointment_package_reservations SET status='released',updated_at=NOW() WHERE appointment_id=$1 AND status='reserved'")
        .bind(&response.0.appointment.id).execute(&state.db).await
        .map_err(|_| ApiError::internal("failed to release package reservation"))?;
    Ok(response)
}

async fn booking_portal_reschedule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<RescheduleRequest>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    appointments::require_public_booking_mutation_owner(
        &state,
        &headers,
        &id,
        payload.branch_id.as_deref(),
    )
    .await?;
    let slot = payload.slot;
    let requested_start = slot
        .as_ref()
        .and_then(|s| s.start_at.clone())
        .or(payload.start_at);
    let requested_end = slot
        .as_ref()
        .and_then(|s| s.end_at.clone())
        .or(payload.end_at);
    if requested_start.is_none() {
        return Err(ApiError::bad_request("slot.startAt or startAt is required"));
    }

    let reschedule = ReschedulePayload {
        start_at: requested_start.unwrap(),
        end_at: requested_end,
        reason: payload.reason.unwrap_or_default(),
        staff_id: slot.and_then(|s| s.staff_id).unwrap_or_default(),
        service_ids: Vec::new(),
        branch_id: payload.branch_id.unwrap_or_default(),
        chair_room_id: String::new(),
        booking_group_id: String::new(),
    };
    let response =
        appointments::reschedule_appointment(State(state), headers, Path(id), Json(reschedule))
            .await?;
    Ok(response)
}

fn scope_for_query(
    headers: &HeaderMap,
    tenant_id: Option<&str>,
    branch_id: Option<&str>,
) -> (String, String) {
    appointments::scope_from_headers(headers, tenant_id, branch_id)
}

async fn issue_confirm_token_if_branch_exists(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, ApiError> {
    if tenant_id == "default-tenant" || branch_id == "default-branch" {
        return Ok(None);
    }

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM branches WHERE tenant_id::text=$1 AND id::text=$2 AND active = true)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate public booking scope"))?;
    if !exists {
        return Ok(None);
    }

    appointments::issue_public_booking_token(state, tenant_id, branch_id, None, None, "confirm", 30)
        .map(Some)
}

fn resolve_service_ids(
    primary_service_id: &Option<String>,
    all_services: Option<&[String]>,
) -> Vec<String> {
    let mut ids = all_services.unwrap_or(&[]).to_vec();
    if ids.is_empty() {
        if let Some(primary) = primary_service_id {
            if !primary.trim().is_empty() {
                ids.push(primary.clone());
            }
        }
    }
    ids.into_iter().filter(|id| !id.trim().is_empty()).collect()
}

fn add_minutes(value: &str, minutes: i64) -> String {
    match DateTime::parse_from_rfc3339(value) {
        Ok(start) => (start + Duration::minutes(minutes))
            .with_timezone(&Utc)
            .to_rfc3339(),
        Err(_) => value.to_string(),
    }
}

async fn load_booking_services(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx::query("SELECT id, name, category, duration_minutes, price_paise FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=true ORDER BY name LIMIT 200")
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to load booking services"))?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "durationMinutes": row.try_get::<i32, _>("duration_minutes").unwrap_or_default(),
                "pricePaise": row.try_get::<i32, _>("price_paise").unwrap_or_default()
            })
        })
        .collect())
}

async fn load_booking_packages(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(Vec<Value>, bool), ApiError> {
    let settings = sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM package_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load package booking settings"))?
    .unwrap_or_else(|| json!({}));
    let show_packages = settings
        .pointer("/onlineBooking/showPackages")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let allow_purchase = settings
        .pointer("/onlineBooking/allowClientPurchase")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !show_packages {
        return Ok((Vec::new(), allow_purchase));
    }
    let rows = sqlx::query("SELECT id,name,description,price_paise,validity_days,service_rows_json FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND show_online_booking=TRUE ORDER BY name LIMIT 100")
        .bind(tenant_id).bind(branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking packages"))?;
    Ok((
        rows.into_iter()
            .map(|row| json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "name": row.try_get::<String,_>("name").unwrap_or_default(),
                "description": row.try_get::<String,_>("description").unwrap_or_default(),
                "pricePaise": row.try_get::<i64,_>("price_paise").unwrap_or_default(),
                "validityDays": row.try_get::<i32,_>("validity_days").unwrap_or_default(),
                "services": row.try_get::<Value,_>("service_rows_json").unwrap_or_else(|_| json!([]))
            }))
            .collect(),
        allow_purchase,
    ))
}

async fn validate_package_credit_booking(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    service_ids: &[String],
    credit_id: &str,
) -> Result<(), ApiError> {
    let settings = sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM package_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load package booking settings"))?
    .unwrap_or_else(|| json!({}));
    if !settings
        .pointer("/onlineBooking/allowPackageServiceBooking")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        return Err(ApiError::bad_request("package-service booking is disabled"));
    }
    let allow_cross_service = settings
        .pointer("/creditsRedemption/allowCrossService")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let credit = sqlx::query_as::<_, (String, i32, i64)>(
        r#"SELECT pc.service_id,pc.remaining_qty,COUNT(r.id)::BIGINT
             FROM client_package_credits pc
             JOIN packages p ON p.id=pc.package_id AND p.tenant_id=pc.tenant_id AND p.branch_id=pc.branch_id
             LEFT JOIN appointment_package_reservations r ON r.client_package_credit_id=pc.id AND r.status='reserved'
            WHERE pc.id=$1 AND pc.tenant_id=$2 AND pc.branch_id=$3 AND pc.client_id=$4
              AND pc.active=TRUE AND pc.remaining_qty>0
              AND (pc.expires_at IS NULL OR pc.expires_at>=CURRENT_DATE)
              AND p.active=TRUE AND p.show_online_booking=TRUE
            GROUP BY pc.service_id,pc.remaining_qty"#,
    )
    .bind(credit_id).bind(tenant_id).bind(branch_id).bind(client_id)
    .fetch_optional(&state.db).await
    .map_err(|_| ApiError::internal("failed to validate package credit"))?
    .ok_or_else(|| ApiError::bad_request("package credit is not available for booking"))?;
    if credit.1 <= credit.2 as i32 {
        return Err(ApiError::bad_request("package credit is already reserved"));
    }
    if !allow_cross_service && !service_ids.iter().any(|service_id| service_id == &credit.0) {
        return Err(ApiError::bad_request(
            "package credit does not match the booked service",
        ));
    }
    Ok(())
}

async fn load_booking_staff(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx::query("SELECT id, first_name, last_name, appointment_display_name, job_title FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=true ORDER BY appointment_display_name, first_name LIMIT 200")
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_all(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to load booking staff"))?;
    Ok(rows.into_iter().map(|row| {
        let first_name = row.try_get::<String, _>("first_name").unwrap_or_default();
        let last_name = row.try_get::<String, _>("last_name").unwrap_or_default();
        let display_name = row.try_get::<String, _>("appointment_display_name").unwrap_or_default();
        json!({
            "id": row.try_get::<String, _>("id").unwrap_or_default(),
            "name": if display_name.trim().is_empty() { format!("{} {}", first_name, last_name).trim().to_string() } else { display_name },
            "jobTitle": row.try_get::<String, _>("job_title").unwrap_or_default()
        })
    }).collect())
}

async fn real_booking_duration_minutes(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
) -> Result<Option<i64>, ApiError> {
    let row = sqlx::query("SELECT COUNT(*)::BIGINT AS matched_count, COALESCE(SUM(duration_minutes),0)::BIGINT AS duration_minutes FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=true AND id = ANY($3)")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(service_ids)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to validate booking services"))?;
    if row.try_get::<i64, _>("matched_count").unwrap_or(0) != service_ids.len() as i64 {
        return Ok(None);
    }
    Ok(Some(
        row.try_get::<i64, _>("duration_minutes")
            .unwrap_or(DEFAULT_SLOT_MINUTES)
            .max(15),
    ))
}

async fn generate_slots(
    state: &AppState,
    tenant_id: &str,
    date: &str,
    branch_id: String,
    services: Vec<String>,
    count: i64,
    duration_minutes: i64,
    staff_id: Option<String>,
) -> Result<Vec<Value>, ApiError> {
    let base = Utc::now();
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap_or_else(|_| base.date_naive())
        .and_hms_opt(9, 0, 0)
        .unwrap_or_else(|| chrono::NaiveDateTime::default());
    let branch = branch_id.clone();
    let staff_hint = staff_id.unwrap_or_default();
    let staff_rows = sqlx::query("SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=true AND ($3='' OR id=$3) ORDER BY appointment_display_name, first_name LIMIT 200")
        .bind(tenant_id)
        .bind(&branch_id)
        .bind(&staff_hint)
        .fetch_all(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to load booking staff"))?;
    let staff_ids = staff_rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .collect::<Vec<_>>();
    if staff_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut slots = Vec::new();
    for idx in 0..count {
        let offset = (idx % 12) as i64;
        let day_offset = idx / 12;
        let slot_start = Utc.from_utc_datetime(&(day + chrono::Duration::days(day_offset)))
            + Duration::minutes(offset * duration_minutes.max(15) + 45 * (idx / 12) as i64);
        let slot_end = slot_start + Duration::minutes(duration_minutes.max(15));
        let busy_rows = sqlx::query("SELECT staff_id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('cancelled','no-show') AND start_at < $4 AND end_at > $3 AND staff_id <> ''")
                .bind(tenant_id)
                .bind(&branch_id)
                .bind(slot_start)
                .bind(slot_end)
                .fetch_all(&state.db)
                .await
                .map_err(|_| ApiError::internal("failed to load appointment conflicts"))?;
        let busy = busy_rows
            .into_iter()
            .filter_map(|row| row.try_get::<String, _>("staff_id").ok())
            .collect::<std::collections::HashSet<_>>();
        let available_staff = staff_ids
            .iter()
            .filter(|id| !busy.contains(*id))
            .cloned()
            .collect::<Vec<_>>();
        if available_staff.is_empty() {
            continue;
        }
        slots.push(json!({
            "slotId": Uuid::new_v4().to_string(),
            "startAt": slot_start.to_rfc3339(),
            "endAt": slot_end.to_rfc3339(),
            "serviceIds": services.clone(),
            "staffId": available_staff.first().cloned().unwrap_or_default(),
            "availableStaffIds": available_staff,
            "chair": "",
            "room": "",
            "branchId": branch,
            "confidence": 100,
        }));
    }
    Ok(slots)
}
