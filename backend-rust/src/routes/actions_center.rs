use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    routing::{get, post},
    Extension, Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Duration, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::clients_repository::{self, CreateClient},
    routes::{
        appointments::{
            self, AppointmentCreatePayload, AppointmentPayload, ReschedulePayload, StatusPayload,
        },
        booking_portal_v2,
        context::tenant_branch,
        security::{require_security_manage, require_security_read},
    },
    services::{auth_service::AuthClaims, client_pii_backfill_service, client_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/settings/integrations/reserve-with-google",
        get(settings).put(save_settings),
    )
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/actions-center/v3/HealthCheck", get(health_check))
        .route(
            "/actions-center/v3/BatchAvailabilityLookup",
            post(batch_availability),
        )
        .route(
            "/actions-center/v3/CheckAvailability",
            post(check_availability),
        )
        .route("/actions-center/v3/CreateBooking", post(create_booking))
        .route("/actions-center/v3/UpdateBooking", post(update_booking))
        .route(
            "/actions-center/v3/GetBookingStatus",
            post(get_booking_status),
        )
        .route("/actions-center/v3/ListBookings", post(list_bookings))
        .route(
            "/actions-center/v3/SetMarketingPreference",
            post(set_marketing_preference),
        )
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct ResourceIds {
    #[serde(default, alias = "staffId")]
    staff_id: String,
    #[serde(default, alias = "roomId")]
    room_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Slot {
    #[serde(alias = "merchantId")]
    merchant_id: String,
    #[serde(alias = "serviceId")]
    service_id: String,
    #[serde(alias = "startSec")]
    start_sec: i64,
    #[serde(alias = "durationSec")]
    duration_sec: i64,
    #[serde(default, alias = "availabilityTag")]
    availability_tag: String,
    #[serde(default, alias = "resourceIds")]
    resources: ResourceIds,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SlotTime {
    #[serde(alias = "serviceId")]
    service_id: String,
    #[serde(alias = "startSec")]
    start_sec: i64,
    #[serde(default, alias = "durationSec")]
    duration_sec: i64,
    #[serde(default, alias = "availabilityTag")]
    availability_tag: String,
    #[serde(default, alias = "resourceIds")]
    resource_ids: ResourceIds,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct UserInformation {
    #[serde(alias = "userId")]
    user_id: String,
    #[serde(alias = "givenName")]
    given_name: String,
    #[serde(default, alias = "familyName")]
    family_name: String,
    telephone: String,
    email: String,
}

#[derive(Deserialize)]
struct BatchAvailabilityRequest {
    #[serde(alias = "merchantId")]
    merchant_id: String,
    #[serde(default, alias = "slotTime")]
    slot_time: Vec<SlotTime>,
}

#[derive(Deserialize)]
struct CheckAvailabilityRequest {
    slot: Slot,
}

#[derive(Deserialize, Serialize)]
struct CreateBookingRequest {
    slot: Slot,
    #[serde(alias = "userInformation")]
    user_information: UserInformation,
    #[serde(alias = "idempotencyToken")]
    idempotency_token: String,
    #[serde(default, alias = "additionalRequest")]
    additional_request: String,
}

#[derive(Deserialize, Serialize)]
struct BookingUpdate {
    #[serde(alias = "bookingId")]
    booking_id: String,
    slot: Option<Slot>,
    #[serde(default)]
    status: String,
}

#[derive(Deserialize, Serialize)]
struct UpdateBookingRequest {
    booking: BookingUpdate,
}

#[derive(Deserialize)]
struct BookingIdRequest {
    #[serde(alias = "bookingId")]
    booking_id: String,
}

#[derive(Deserialize)]
struct ListBookingsRequest {
    #[serde(alias = "userId")]
    user_id: String,
}

#[derive(Deserialize)]
struct MarketingPreferenceRequest {
    #[serde(alias = "userInformation")]
    user_information: UserInformation,
    #[serde(alias = "userToReceiveMarketing")]
    user_to_receive_marketing: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MerchantWrite {
    merchant_id: String,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MerchantView {
    merchant_id: String,
    enabled: bool,
    server_credentials_configured: bool,
    booking_server_path: &'static str,
    status: &'static str,
}

struct MerchantScope {
    tenant_id: String,
    branch_id: String,
}

async fn settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<MerchantView> {
    require_security_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query(
        "SELECT merchant_id,enabled FROM actions_center_merchants WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load Reserve with Google settings"))?;
    let configured = credentials_configured(&state);
    let merchant_id = row
        .as_ref()
        .and_then(|row| row.try_get("merchant_id").ok())
        .unwrap_or_default();
    let enabled = row
        .as_ref()
        .and_then(|row| row.try_get("enabled").ok())
        .unwrap_or(false);
    Ok(Json(ApiResponse::ok(MerchantView {
        merchant_id,
        enabled,
        server_credentials_configured: configured,
        booking_server_path: "/actions-center/v3",
        status: if enabled && configured {
            "ready"
        } else {
            "configuration_required"
        },
    })))
}

async fn save_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<MerchantWrite>,
) -> ApiResult<MerchantView> {
    require_security_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let merchant_id = request.merchant_id.trim();
    if !(1..=200).contains(&merchant_id.chars().count())
        || !merchant_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.:".contains(character))
    {
        return Err(AppError::validation(
            "Actions Center merchant ID is invalid",
        ));
    }
    if request.enabled && !credentials_configured(&state) {
        return Err(AppError::validation(
            "ACTIONS_CENTER_USERNAME and ACTIONS_CENTER_PASSWORD are required before enabling",
        ));
    }
    sqlx::query(
        "INSERT INTO actions_center_merchants(merchant_id,tenant_id,branch_id,enabled,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET merchant_id=EXCLUDED.merchant_id,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()",
    )
    .bind(merchant_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(request.enabled)
    .bind(&claims.sub)
    .execute(&state.db)
    .await
    .map_err(|_| AppError::conflict("merchant ID is already mapped or has immutable booking history"))?;
    Ok(Json(ApiResponse::ok(MerchantView {
        merchant_id: merchant_id.into(),
        enabled: request.enabled,
        server_credentials_configured: true,
        booking_server_path: "/actions-center/v3",
        status: if request.enabled { "ready" } else { "disabled" },
    })))
}

async fn health_check(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, appointments::ApiError> {
    authenticate(&state, &headers)?;
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .map_err(|_| {
            appointments::ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "booking database is unavailable",
            )
        })?;
    Ok(StatusCode::OK)
}

async fn batch_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<BatchAvailabilityRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    let scope = merchant_scope(&state, &request.merchant_id).await?;
    let mut availability = Vec::with_capacity(request.slot_time.len());
    for slot in request.slot_time {
        let duration = service_duration_seconds(&state, &scope, &slot.service_id).await?;
        let available = if duration > 0 && (slot.duration_sec == 0 || slot.duration_sec == duration)
        {
            exact_staff(
                &state,
                &scope,
                &slot.service_id,
                slot.start_sec,
                duration,
                &slot.resource_ids,
                None,
            )
            .await?
            .is_some()
        } else {
            false
        };
        availability.push(json!({"slot_time":slot,"available":available}));
    }
    Ok(Json(json!({"slot_time_availability":availability})))
}

async fn check_availability(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CheckAvailabilityRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    let scope = merchant_scope(&state, &request.slot.merchant_id).await?;
    let available = exact_staff(
        &state,
        &scope,
        &request.slot.service_id,
        request.slot.start_sec,
        request.slot.duration_sec,
        &request.slot.resources,
        None,
    )
    .await?
    .is_some();
    Ok(Json(
        json!({"slot":request.slot,"count_available":if available {1} else {0}}),
    ))
}

async fn create_booking(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateBookingRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    validate_create(&request)?;
    let scope = merchant_scope(&state, &request.slot.merchant_id).await?;
    let hash = payload_hash(&request)?;
    if let Some(existing) = existing_create_response(&state, &request, &hash).await? {
        return Ok(Json(existing));
    }
    let Some(staff_id) = exact_staff(
        &state,
        &scope,
        &request.slot.service_id,
        request.slot.start_sec,
        request.slot.duration_sec,
        &request.slot.resources,
        None,
    )
    .await?
    else {
        return Ok(Json(booking_failure(
            "SLOT_UNAVAILABLE",
            "requested slot is no longer available",
        )));
    };
    let client_id = match resolve_client(&state, &scope, &request.user_information).await {
        Ok(client_id) => client_id,
        Err(error) if error.status_code() == StatusCode::BAD_REQUEST => {
            return Ok(Json(booking_failure(
                "UNSUPPORTED_PHONE_NUMBER",
                error.message(),
            )))
        }
        Err(_) => {
            return Err(appointments::ApiError::internal(
                "failed to resolve booking client",
            ))
        }
    };
    let inserted = sqlx::query(
        "INSERT INTO actions_center_bookings(merchant_id,idempotency_token,request_hash,client_id,slot_json,user_json) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
    )
    .bind(&request.slot.merchant_id)
    .bind(&request.idempotency_token)
    .bind(&hash)
    .bind(&client_id)
    .bind(json!(request.slot))
    .bind(json!(request.user_information))
    .execute(&state.db)
    .await
    .map_err(|_| appointments::ApiError::internal("failed to reserve booking idempotency token"))?
    .rows_affected();
    if inserted == 0 {
        if let Some(existing) = existing_create_response(&state, &request, &hash).await? {
            return Ok(Json(existing));
        }
        return Err(appointments::ApiError::with_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "booking request is still processing",
        ));
    }
    let start_at = timestamp(request.slot.start_sec)?;
    let end_at = start_at + Duration::seconds(request.slot.duration_sec);
    let scoped_headers = booking_headers(&state, &scope)?;
    let created = appointments::create_appointment(
        State(state.clone()),
        scoped_headers,
        Json(AppointmentCreatePayload {
            tenant_id: Some(scope.tenant_id.clone()),
            branch_id: Some(scope.branch_id.clone()),
            staff_id: staff_id.clone(),
            requested_staff_id: request.slot.resources.staff_id.clone(),
            staff_preference: if request.slot.resources.staff_id.is_empty() {
                "any".into()
            } else {
                "required".into()
            },
            client_id,
            service_ids: vec![request.slot.service_id.clone()],
            start_at: start_at.to_rfc3339(),
            end_at: end_at.to_rfc3339(),
            notes: request.additional_request.clone(),
            status: "booked".into(),
            booking_group_id: String::new(),
            source_channel: Some("booking-portal-v2".into()),
            source: Some("google".into()),
            chair_room_id: request.slot.resources.room_id.clone(),
            service_selections: Vec::new(),
        }),
    )
    .await;
    let appointment = match created {
        Ok(created) => created.0,
        Err(error) if error.status_code() == StatusCode::CONFLICT => {
            delete_processing_booking(
                &state,
                &request.slot.merchant_id,
                &request.idempotency_token,
            )
            .await?;
            return Ok(Json(booking_failure(
                "SLOT_UNAVAILABLE",
                "requested slot is no longer available",
            )));
        }
        Err(error) => return Err(error),
    };
    let response =
        json!({"booking":booking_json(&appointment, &request.slot, &request.user_information)});
    sqlx::query("UPDATE actions_center_bookings SET appointment_id=$4,response_json=$5,status='confirmed',updated_at=NOW() WHERE merchant_id=$1 AND idempotency_token=$2 AND request_hash=$3")
        .bind(&request.slot.merchant_id).bind(&request.idempotency_token).bind(&hash).bind(&appointment.id).bind(&response)
        .execute(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to finalize booking idempotency record"))?;
    Ok(Json(response))
}

async fn update_booking(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<UpdateBookingRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    let hash = payload_hash(&request)?;
    let row = sqlx::query("SELECT booking.merchant_id,booking.slot_json,booking.user_json,booking.last_update_hash,booking.last_update_response_json,merchant.tenant_id,merchant.branch_id FROM actions_center_bookings booking JOIN actions_center_merchants merchant USING(merchant_id) WHERE booking.appointment_id=$1 AND merchant.enabled=TRUE")
        .bind(request.booking.booking_id.trim()).fetch_optional(&state.db).await
        .map_err(|_| appointments::ApiError::internal("failed to load booking mapping"))?
        .ok_or_else(|| appointments::ApiError::not_found("booking was not found"))?;
    if row
        .try_get::<Option<String>, _>("last_update_hash")
        .ok()
        .flatten()
        .as_deref()
        == Some(&hash)
    {
        if let Ok(Some(response)) = row.try_get::<Option<Value>, _>("last_update_response_json") {
            return Ok(Json(response));
        }
    }
    let scope = MerchantScope {
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        branch_id: row.try_get("branch_id").unwrap_or_default(),
    };
    let mut appointment = appointments::find_appointment(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        request.booking.booking_id.trim(),
    )
    .await?;
    let mut slot: Slot = serde_json::from_value(row.try_get("slot_json").unwrap_or(Value::Null))
        .map_err(|_| appointments::ApiError::internal("invalid stored booking slot"))?;
    let user: UserInformation =
        serde_json::from_value(row.try_get("user_json").unwrap_or(Value::Null))
            .map_err(|_| appointments::ApiError::internal("invalid stored booking user"))?;
    let scoped_headers = booking_headers(&state, &scope)?;
    if request.booking.status.eq_ignore_ascii_case("CANCELED") {
        if appointment.status != "cancelled" {
            appointment = appointments::cancel_appointment(
                State(state.clone()),
                scoped_headers,
                Path(appointment.id.clone()),
                Json(StatusPayload {
                    status: "cancelled".into(),
                    reason: "Cancelled through Reserve with Google".into(),
                    apply_group: false,
                }),
            )
            .await?
            .0
            .appointment;
        }
    } else if let Some(next_slot) = request.booking.slot {
        if next_slot.merchant_id != slot.merchant_id {
            return Ok(Json(booking_failure(
                "SLOT_UNAVAILABLE",
                "merchant cannot be changed",
            )));
        }
        let resources = if next_slot.resources.staff_id.is_empty() {
            ResourceIds {
                staff_id: appointment.staff_id.clone(),
                room_id: next_slot.resources.room_id.clone(),
            }
        } else {
            next_slot.resources.clone()
        };
        let Some(staff_id) = exact_staff(
            &state,
            &scope,
            &next_slot.service_id,
            next_slot.start_sec,
            next_slot.duration_sec,
            &resources,
            Some(&appointment.id),
        )
        .await?
        else {
            return Ok(Json(booking_failure(
                "SLOT_UNAVAILABLE",
                "requested slot is no longer available",
            )));
        };
        let start_at = timestamp(next_slot.start_sec)?;
        appointment = appointments::reschedule_appointment(
            State(state.clone()),
            None,
            scoped_headers,
            Path(appointment.id.clone()),
            Json(ReschedulePayload {
                expected_version: Some(appointment.version),
                start_at: start_at.to_rfc3339(),
                end_at: Some((start_at + Duration::seconds(next_slot.duration_sec)).to_rfc3339()),
                reason: "Updated through Reserve with Google".into(),
                staff_id,
                staff_change_approval: "Actions Center user update".into(),
                staff_change_reason: "Actions Center user update".into(),
                service_ids: vec![next_slot.service_id.clone()],
                branch_id: scope.branch_id.clone(),
                chair_room_id: next_slot.resources.room_id.clone(),
                booking_group_id: String::new(),
                change_mode: "actions-center".into(),
                actor_source: "client".into(),
                outside_hours_override_reason: String::new(),
            }),
        )
        .await?
        .0;
        slot = next_slot;
    } else {
        return Err(appointments::ApiError::bad_request(
            "booking status or slot update is required",
        ));
    }
    let response = json!({"booking":booking_json(&appointment, &slot, &user)});
    sqlx::query("UPDATE actions_center_bookings SET slot_json=$2,last_update_hash=$3,last_update_response_json=$4,status=$5,updated_at=NOW() WHERE appointment_id=$1")
        .bind(&appointment.id).bind(json!(slot)).bind(hash).bind(&response).bind(if appointment.status == "cancelled" { "cancelled" } else { "confirmed" })
        .execute(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to save booking update result"))?;
    Ok(Json(response))
}

async fn get_booking_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<BookingIdRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    let (tenant, branch) = booking_scope(&state, &request.booking_id).await?;
    let appointment =
        appointments::find_appointment(&state, &tenant, &branch, &request.booking_id).await?;
    Ok(Json(
        json!({"booking_id":appointment.id,"booking_status":booking_status(&appointment.status),"prepayment_status":"PREPAYMENT_NOT_PROVIDED"}),
    ))
}

async fn list_bookings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ListBookingsRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    if request.user_id.trim().is_empty() {
        return Err(appointments::ApiError::bad_request("user_id is required"));
    }
    let rows = sqlx::query("SELECT booking.appointment_id,booking.slot_json,booking.user_json,merchant.tenant_id,merchant.branch_id FROM actions_center_bookings booking JOIN actions_center_merchants merchant USING(merchant_id) WHERE booking.user_json->>'user_id'=$1 AND booking.appointment_id IS NOT NULL ORDER BY booking.created_at DESC LIMIT 200")
        .bind(request.user_id.trim()).fetch_all(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to list bookings"))?;
    let mut bookings = Vec::with_capacity(rows.len());
    for row in rows {
        let appointment_id: String = row.try_get("appointment_id").unwrap_or_default();
        let tenant: String = row.try_get("tenant_id").unwrap_or_default();
        let branch: String = row.try_get("branch_id").unwrap_or_default();
        if let Ok(appointment) =
            appointments::find_appointment(&state, &tenant, &branch, &appointment_id).await
        {
            let slot: Slot =
                serde_json::from_value(row.try_get("slot_json").unwrap_or(Value::Null))
                    .map_err(|_| appointments::ApiError::internal("invalid stored booking slot"))?;
            let user: UserInformation =
                serde_json::from_value(row.try_get("user_json").unwrap_or(Value::Null))
                    .map_err(|_| appointments::ApiError::internal("invalid stored booking user"))?;
            bookings.push(booking_json(&appointment, &slot, &user));
        }
    }
    Ok(Json(json!({"bookings":bookings})))
}

async fn set_marketing_preference(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<MarketingPreferenceRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    authenticate(&state, &headers)?;
    if request.user_information.user_id.trim().is_empty() {
        return Err(appointments::ApiError::bad_request("user_id is required"));
    }
    sqlx::query("INSERT INTO actions_center_marketing_preferences(user_id,user_json,receive_marketing) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET user_json=EXCLUDED.user_json,receive_marketing=EXCLUDED.receive_marketing,updated_at=NOW()")
        .bind(request.user_information.user_id.trim()).bind(json!(request.user_information)).bind(request.user_to_receive_marketing)
        .execute(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to save marketing preference"))?;
    Ok(Json(
        json!({"user_information":request.user_information,"user_to_receive_marketing":request.user_to_receive_marketing}),
    ))
}

async fn merchant_scope(
    state: &AppState,
    merchant_id: &str,
) -> Result<MerchantScope, appointments::ApiError> {
    sqlx::query("SELECT tenant_id,branch_id FROM actions_center_merchants WHERE merchant_id=$1 AND enabled=TRUE")
        .bind(merchant_id.trim()).fetch_optional(&state.db).await
        .map_err(|_| appointments::ApiError::internal("failed to resolve merchant"))?
        .map(|row| MerchantScope { tenant_id: row.try_get("tenant_id").unwrap_or_default(), branch_id: row.try_get("branch_id").unwrap_or_default() })
        .ok_or_else(|| appointments::ApiError::not_found("merchant was not found"))
}

async fn booking_scope(
    state: &AppState,
    appointment_id: &str,
) -> Result<(String, String), appointments::ApiError> {
    sqlx::query("SELECT merchant.tenant_id,merchant.branch_id FROM actions_center_bookings booking JOIN actions_center_merchants merchant USING(merchant_id) WHERE booking.appointment_id=$1 AND merchant.enabled=TRUE")
        .bind(appointment_id.trim()).fetch_optional(&state.db).await
        .map_err(|_| appointments::ApiError::internal("failed to resolve booking"))?
        .map(|row| (row.try_get("tenant_id").unwrap_or_default(), row.try_get("branch_id").unwrap_or_default()))
        .ok_or_else(|| appointments::ApiError::not_found("booking was not found"))
}

async fn service_duration_seconds(
    state: &AppState,
    scope: &MerchantScope,
    service_id: &str,
) -> Result<i64, appointments::ApiError> {
    sqlx::query_scalar::<_, i64>("SELECT duration_minutes::BIGINT*60 FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(&scope.tenant_id).bind(&scope.branch_id).bind(service_id.trim()).fetch_optional(&state.db).await
        .map_err(|_| appointments::ApiError::internal("failed to load service duration"))?.ok_or_else(|| appointments::ApiError::not_found("service was not found"))
}

async fn exact_staff(
    state: &AppState,
    scope: &MerchantScope,
    service_id: &str,
    start_sec: i64,
    duration_sec: i64,
    resources: &ResourceIds,
    exclude: Option<&str>,
) -> Result<Option<String>, appointments::ApiError> {
    if duration_sec <= 0 || duration_sec > 86_400 {
        return Ok(None);
    }
    let start_at = timestamp(start_sec)?;
    booking_portal_v2::exact_booking_availability(
        state,
        &scope.tenant_id,
        &scope.branch_id,
        service_id.trim(),
        start_at,
        start_at + Duration::seconds(duration_sec),
        Some(&resources.staff_id),
        Some(&resources.room_id),
        exclude,
    )
    .await
}

async fn resolve_client(
    state: &AppState,
    scope: &MerchantScope,
    user: &UserInformation,
) -> Result<String, AppError> {
    validate_user(user)?;
    let normalized_phone = client_service::normalize_phone(&user.telephone)?;
    if let Some(id) = sqlx::query_scalar::<_, String>("SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id IS NULL AND ((normalized_phone<>'' AND normalized_phone=$3) OR (email<>'' AND LOWER(email)=LOWER($4))) ORDER BY created_at LIMIT 1")
        .bind(&scope.tenant_id).bind(&scope.branch_id).bind(&normalized_phone).bind(user.email.trim()).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to resolve booking client"))? { return Ok(id); }
    let client = clients_repository::create(
        &state.db,
        CreateClient {
            tenant_id: &scope.tenant_id,
            branch_id: &scope.branch_id,
            first_name: user.given_name.trim(),
            last_name: user.family_name.trim(),
            phone: user.telephone.trim(),
            normalized_phone: &normalized_phone,
            email: user.email.trim(),
            membership_label: "",
            categories_json: "[]",
            birthday: None,
            anniversary: None,
            notes: Some("Created from Reserve with Google"),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create booking client"))?;
    client_pii_backfill_service::encrypt_client(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &client.id,
        user.telephone.trim(),
        user.email.trim(),
    )
    .await?;
    Ok(client.id)
}

fn validate_user(user: &UserInformation) -> Result<(), AppError> {
    if user.user_id.trim().is_empty()
        || !(1..=40).contains(&user.given_name.trim().chars().count())
        || user.family_name.trim().chars().count() > 40
        || user.email.trim().len() > 254
        || !user.email.contains('@')
    {
        return Err(AppError::validation(
            "Actions Center user information is invalid",
        ));
    }
    Ok(())
}

fn validate_create(request: &CreateBookingRequest) -> Result<(), appointments::ApiError> {
    if request.idempotency_token.trim().is_empty()
        || request.idempotency_token.len() > 200
        || request.slot.merchant_id.trim().is_empty()
        || request.slot.service_id.trim().is_empty()
        || request.additional_request.chars().count() > 2000
    {
        return Err(appointments::ApiError::bad_request(
            "invalid CreateBooking request",
        ));
    }
    Ok(())
}

async fn existing_create_response(
    state: &AppState,
    request: &CreateBookingRequest,
    hash: &str,
) -> Result<Option<Value>, appointments::ApiError> {
    let row = sqlx::query("SELECT booking.request_hash,booking.response_json,booking.client_id,booking.updated_at,merchant.tenant_id,merchant.branch_id FROM actions_center_bookings booking JOIN actions_center_merchants merchant USING(merchant_id) WHERE booking.merchant_id=$1 AND booking.idempotency_token=$2")
        .bind(request.slot.merchant_id.trim()).bind(request.idempotency_token.trim()).fetch_optional(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to read booking idempotency record"))?;
    let Some(row) = row else { return Ok(None) };
    if row.try_get::<String, _>("request_hash").unwrap_or_default() != hash {
        return Ok(Some(booking_failure(
            "SLOT_ALREADY_BOOKED_BY_USER",
            "idempotency token was reused with different booking data",
        )));
    }
    if let Some(response) = row
        .try_get::<Option<Value>, _>("response_json")
        .ok()
        .flatten()
    {
        return Ok(Some(response));
    }
    let tenant_id: String = row.try_get("tenant_id").unwrap_or_default();
    let branch_id: String = row.try_get("branch_id").unwrap_or_default();
    let client_id: String = row.try_get("client_id").unwrap_or_default();
    let start_at = timestamp(request.slot.start_sec)?;
    let end_at = start_at + Duration::seconds(request.slot.duration_sec);
    let recovered = sqlx::query_scalar::<_, String>("SELECT id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source='google' AND start_at=$4 AND end_at=$5 AND service_ids_json::jsonb ? $6 ORDER BY created_at DESC LIMIT 1")
        .bind(&tenant_id).bind(&branch_id).bind(&client_id).bind(start_at).bind(end_at).bind(&request.slot.service_id)
        .fetch_optional(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to recover booking retry"))?;
    if let Some(appointment_id) = recovered {
        let appointment =
            appointments::find_appointment(state, &tenant_id, &branch_id, &appointment_id).await?;
        let response =
            json!({"booking":booking_json(&appointment, &request.slot, &request.user_information)});
        sqlx::query("UPDATE actions_center_bookings SET appointment_id=$3,response_json=$4,status='confirmed',updated_at=NOW() WHERE merchant_id=$1 AND idempotency_token=$2")
            .bind(&request.slot.merchant_id).bind(&request.idempotency_token).bind(&appointment_id).bind(&response)
            .execute(&state.db).await.map_err(|_| appointments::ApiError::internal("failed to repair booking retry"))?;
        return Ok(Some(response));
    }
    let updated_at: DateTime<Utc> = row.try_get("updated_at").unwrap_or_else(|_| Utc::now());
    if updated_at < Utc::now() - Duration::seconds(30) {
        delete_processing_booking(state, &request.slot.merchant_id, &request.idempotency_token)
            .await?;
    }
    Ok(None)
}

async fn delete_processing_booking(
    state: &AppState,
    merchant_id: &str,
    token: &str,
) -> Result<(), appointments::ApiError> {
    sqlx::query("DELETE FROM actions_center_bookings WHERE merchant_id=$1 AND idempotency_token=$2 AND response_json IS NULL")
        .bind(merchant_id.trim()).bind(token.trim()).execute(&state.db).await
        .map_err(|_| appointments::ApiError::internal("failed to release booking retry"))?;
    Ok(())
}

fn booking_headers(
    state: &AppState,
    scope: &MerchantScope,
) -> Result<HeaderMap, appointments::ApiError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-tenant-id",
        HeaderValue::from_str(&scope.tenant_id)
            .map_err(|_| appointments::ApiError::internal("invalid tenant scope"))?,
    );
    headers.insert(
        "x-branch-id",
        HeaderValue::from_str(&scope.branch_id)
            .map_err(|_| appointments::ApiError::internal("invalid branch scope"))?,
    );
    let token = appointments::issue_public_booking_token(
        state,
        &scope.tenant_id,
        &scope.branch_id,
        None,
        None,
        "confirm",
        10,
    )?;
    headers.insert(
        "x-public-booking-token",
        HeaderValue::from_str(&token)
            .map_err(|_| appointments::ApiError::internal("invalid booking token"))?,
    );
    Ok(headers)
}

fn booking_json(appointment: &AppointmentPayload, slot: &Slot, user: &UserInformation) -> Value {
    json!({"booking_id":appointment.id,"slot":slot,"user_information":user,"status":booking_status(&appointment.status)})
}

fn booking_status(status: &str) -> &'static str {
    match status {
        "cancelled" => "CANCELED",
        "no-show" => "NO_SHOW",
        _ => "CONFIRMED",
    }
}

fn booking_failure(cause: &str, description: &str) -> Value {
    json!({"booking_failure":{"cause":cause,"description":description}})
}

fn timestamp(seconds: i64) -> Result<DateTime<Utc>, appointments::ApiError> {
    Utc.timestamp_opt(seconds, 0)
        .single()
        .ok_or_else(|| appointments::ApiError::bad_request("slot start_sec is invalid"))
}

fn payload_hash<T: Serialize>(payload: &T) -> Result<String, appointments::ApiError> {
    let bytes = serde_json::to_vec(payload)
        .map_err(|_| appointments::ApiError::bad_request("request payload is invalid"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn credentials_configured(state: &AppState) -> bool {
    state.settings.actions_center_username.is_some()
        && state.settings.actions_center_password.is_some()
}

fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<(), appointments::ApiError> {
    let username = state
        .settings
        .actions_center_username
        .as_deref()
        .ok_or_else(|| {
            appointments::ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "Actions Center credentials are not configured",
            )
        })?;
    let password = state
        .settings
        .actions_center_password
        .as_deref()
        .ok_or_else(|| {
            appointments::ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "Actions Center credentials are not configured",
            )
        })?;
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Basic "))
        .and_then(|value| STANDARD.decode(value).ok())
        .unwrap_or_default();
    let expected = format!("{username}:{password}");
    if !constant_time_eq(&provided, expected.as_bytes()) {
        return Err(appointments::ApiError::unauthorized(
            "invalid Actions Center credentials",
        ));
    }
    Ok(())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_hash_and_auth_comparison_are_deterministic() {
        let request = CreateBookingRequest {
            slot: Slot {
                merchant_id: "merchant".into(),
                service_id: "service".into(),
                start_sec: 1_800_000_000,
                duration_sec: 3600,
                availability_tag: String::new(),
                resources: ResourceIds::default(),
            },
            user_information: UserInformation {
                user_id: "user".into(),
                given_name: "Guest".into(),
                family_name: String::new(),
                telephone: "+919876543210".into(),
                email: "guest@example.com".into(),
            },
            idempotency_token: "request-12345678".into(),
            additional_request: String::new(),
        };
        assert_eq!(payload_hash(&request).ok(), payload_hash(&request).ok());
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"other"));
    }
}
