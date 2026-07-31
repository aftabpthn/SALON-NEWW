use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    models::common::AppError,
    repositories::{
        benefit_notification_repository::{self, NewBenefitDelivery},
        operations_repository as repository,
    },
    routes::appointments::{self, AppointmentCreatePayload},
    services::{client_service, security_service},
    state::AppState,
};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZoneInput {
    pub name: String,
    #[serde(default)]
    pub service_area: String,
    pub travel_minutes: i32,
    pub max_distance_meters: Option<i32>,
    pub base_surcharge_paise: Option<i64>,
    pub per_km_surcharge_paise: Option<i64>,
    pub staff_per_km_paise: Option<i64>,
    pub sla_minutes: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddressInput {
    pub client_id: String,
    #[serde(default)]
    pub label: String,
    pub address: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobInput {
    pub appointment_id: String,
    pub staff_id: Option<String>,
    pub travel_zone_id: String,
    pub address: String,
    pub travel_minutes: Option<i32>,
    pub priority: Option<i16>,
    pub destination_latitude: Option<f64>,
    pub destination_longitude: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocationInput {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_meters: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofInput {
    pub customer_name: String,
    pub customer_confirmed: bool,
    #[serde(default)]
    pub completion_note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInput {
    pub provider: String,
    pub display_name: String,
    #[serde(default)]
    pub external_account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketplaceBooking {
    pub event_id: String,
    pub event_type: String,
    pub external_booking_id: String,
    pub client_id: String,
    pub staff_id: Option<String>,
    pub service_ids: Vec<String>,
    pub start_at: String,
    pub end_at: String,
    pub address: String,
    pub travel_zone_id: String,
    pub destination_latitude: Option<f64>,
    pub destination_longitude: Option<f64>,
}

pub async fn summary(state: &AppState, tenant: &str, branch: &str) -> Result<Value, AppError> {
    let mut value = repository::dispatch_summary(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load dispatch operations"))?;
    value["mapsProvider"] = json!({
        "provider": "google",
        "configured": state.settings.google_maps_api_key.is_some(),
        "live": false,
        "reason": "Customer address sharing requires explicit approval"
    });
    value["messagingProviders"] = json!({
        "whatsapp": state.settings.whatsapp_cloud_enabled() || state.settings.invoice_delivery_webhook_url.is_some(),
        "sms": state.settings.invoice_delivery_webhook_url.is_some()
    });
    Ok(value)
}

pub async fn save_zone(
    db: &sqlx::PgPool,
    tenant: &str,
    branch: &str,
    input: &ZoneInput,
) -> Result<String, AppError> {
    if input.name.trim().is_empty()
        || !(0..=1440).contains(&input.travel_minutes)
        || input.max_distance_meters.is_some_and(|value| value < 0)
        || input.base_surcharge_paise.unwrap_or(0) < 0
        || input.per_km_surcharge_paise.unwrap_or(0) < 0
        || input.staff_per_km_paise.unwrap_or(0) < 0
        || !(1..=1440).contains(&input.sla_minutes.unwrap_or(120))
    {
        return Err(AppError::validation("travel zone settings are invalid"));
    }
    sqlx::query_scalar("INSERT INTO travel_zones(tenant_id,branch_id,name,service_area,travel_minutes,max_distance_meters,base_surcharge_paise,per_km_surcharge_paise,staff_per_km_paise,sla_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(tenant_id,branch_id,name) DO UPDATE SET service_area=EXCLUDED.service_area,travel_minutes=EXCLUDED.travel_minutes,max_distance_meters=EXCLUDED.max_distance_meters,base_surcharge_paise=EXCLUDED.base_surcharge_paise,per_km_surcharge_paise=EXCLUDED.per_km_surcharge_paise,staff_per_km_paise=EXCLUDED.staff_per_km_paise,sla_minutes=EXCLUDED.sla_minutes,active=TRUE,updated_at=NOW() RETURNING id")
        .bind(tenant).bind(branch).bind(input.name.trim()).bind(input.service_area.trim())
        .bind(input.travel_minutes).bind(input.max_distance_meters).bind(input.base_surcharge_paise.unwrap_or(0))
        .bind(input.per_km_surcharge_paise.unwrap_or(0)).bind(input.staff_per_km_paise.unwrap_or(0)).bind(input.sla_minutes.unwrap_or(120))
        .fetch_one(db).await.map_err(|_| AppError::internal("failed to save travel zone"))
}

pub async fn save_address(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &AddressInput,
) -> Result<String, AppError> {
    if input.client_id.trim().is_empty()
        || input.address.trim().is_empty()
        || !valid_coordinates(input.latitude, input.longitude)
    {
        return Err(AppError::validation(
            "client service address or coordinates are invalid",
        ));
    }
    repository::save_address(
        &state.db,
        tenant,
        branch,
        input.client_id.trim(),
        if input.label.trim().is_empty() {
            "Service address"
        } else {
            input.label.trim()
        },
        input.address.trim(),
        actor,
        input.latitude,
        input.longitude,
        input.latitude.map(|_| "verified_coordinates"),
    )
    .await
    .map_err(|_| AppError::internal("failed to save client service address"))
}

pub async fn create_job(
    state: &AppState,
    tenant: &str,
    branch: &str,
    input: &JobInput,
) -> Result<String, AppError> {
    if input.appointment_id.trim().is_empty()
        || input.travel_zone_id.trim().is_empty()
        || input.address.trim().is_empty()
        || input
            .priority
            .is_some_and(|value| !(1..=5).contains(&value))
        || !valid_coordinates(input.destination_latitude, input.destination_longitude)
    {
        return Err(AppError::validation(
            "appointment field job details are invalid",
        ));
    }
    let origin = repository::branch_origin(&state.db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load branch location"))?;
    let route = match (
        origin.and_then(|row| row.1.zip(row.2)),
        input.destination_latitude.zip(input.destination_longitude),
    ) {
        (Some((from_lat, from_lng)), Some((to_lat, to_lng))) => {
            let distance = haversine_meters(from_lat, from_lng, to_lat, to_lng);
            Some((
                to_lat,
                to_lng,
                distance,
                ((distance as f64 / 35_000.0) * 3600.0).ceil() as i32,
            ))
        }
        _ => None,
    };
    let minutes = route
        .map(|value| ((value.3 + 59) / 60).clamp(0, 1440))
        .unwrap_or(input.travel_minutes.unwrap_or(0));
    repository::save_appointment_address(
        &state.db,
        tenant,
        branch,
        input.appointment_id.trim(),
        input.address.trim(),
        input.destination_latitude,
        input.destination_longitude,
        "system",
    )
    .await
    .map_err(|_| AppError::internal("failed to save appointment service address"))?;
    repository::create_job(
        &state.db,
        tenant,
        branch,
        input.appointment_id.trim(),
        input
            .staff_id
            .as_deref()
            .filter(|value| !value.trim().is_empty()),
        input.travel_zone_id.trim(),
        input.address.trim(),
        minutes,
        route,
        input.priority.unwrap_or(3),
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database| database.is_unique_violation())
        {
            AppError::conflict("this appointment already has an active field job")
        } else {
            AppError::internal("failed to create appointment field job")
        }
    })?
    .ok_or_else(|| {
        AppError::validation("appointment, staff, or travel zone is not available in this branch")
    })
}

pub fn valid_transition(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("created", "assigned" | "cancelled")
            | ("assigned", "accepted" | "en_route" | "cancelled")
            | ("accepted", "en_route" | "cancelled")
            | ("en_route", "arrived" | "cancelled")
            | ("arrived", "completed" | "cancelled")
    )
}

pub async fn set_status(
    db: &sqlx::PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: Option<&str>,
    next: &str,
    actor: &str,
) -> Result<(), AppError> {
    if !matches!(
        next,
        "assigned" | "accepted" | "en_route" | "arrived" | "completed" | "cancelled"
    ) {
        return Err(AppError::validation("invalid field job status"));
    }
    let current = repository::current_job_status(db, tenant, branch, id, staff)
        .await
        .map_err(|_| AppError::internal("failed to load field job"))?
        .ok_or_else(|| AppError::not_found("field job was not found"))?;
    if !valid_transition(&current, next) {
        return Err(AppError::conflict(
            "field job status transition is not allowed",
        ));
    }
    if next == "completed" {
        let proof: Option<Option<Value>> = sqlx::query_scalar(
            "SELECT proof_json FROM field_jobs WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
        )
        .bind(id)
        .bind(tenant)
        .bind(branch)
        .fetch_optional(db)
        .await
        .map_err(|_| AppError::internal("failed to verify service proof"))?;
        if proof.flatten().is_none() {
            return Err(AppError::conflict(
                "service proof is required before completion",
            ));
        }
    }
    if !repository::update_job_status(db, tenant, branch, id, staff, &current, next, actor)
        .await
        .map_err(|_| AppError::internal("failed to update field job"))?
    {
        return Err(AppError::conflict(
            "field job changed; reload and try again",
        ));
    }
    Ok(())
}

pub async fn assign_job(
    db: &sqlx::PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    actor: &str,
) -> Result<(), AppError> {
    if staff.trim().is_empty() {
        return Err(AppError::validation("staff assignment is required"));
    }
    if !repository::assign_job(db, tenant, branch, id, staff.trim(), actor)
        .await
        .map_err(|_| AppError::internal("failed to assign field job"))?
    {
        return Err(AppError::conflict(
            "field job is not unassigned or staff is unavailable",
        ));
    }
    Ok(())
}

pub async fn record_location(
    db: &sqlx::PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    input: &LocationInput,
) -> Result<(), AppError> {
    if !valid_coordinates(Some(input.latitude), Some(input.longitude))
        || input
            .accuracy_meters
            .is_some_and(|value| value < 0.0 || value > 10_000.0)
    {
        return Err(AppError::validation(
            "GPS coordinates or accuracy are invalid",
        ));
    }
    if !repository::record_location(
        db,
        tenant,
        branch,
        id,
        staff,
        input.latitude,
        input.longitude,
        input.accuracy_meters,
    )
    .await
    .map_err(|_| AppError::internal("failed to save field job location"))?
    {
        return Err(AppError::conflict(
            "location sharing is not allowed for this field job state",
        ));
    }
    if let Some((Some(latitude), Some(longitude))) =
        repository::job_destination(db, tenant, branch, id, staff)
            .await
            .map_err(|_| AppError::internal("failed to load field job destination"))?
    {
        let distance = haversine_meters(input.latitude, input.longitude, latitude, longitude);
        repository::update_remaining_eta(
            db,
            tenant,
            branch,
            id,
            staff,
            ((distance as f64 / 35_000.0) * 3600.0).ceil() as i32,
        )
        .await
        .map_err(|_| AppError::internal("failed to update live ETA"))?;
    }
    Ok(())
}

pub async fn save_proof(
    db: &sqlx::PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    staff: &str,
    input: &ProofInput,
) -> Result<(), AppError> {
    if input.customer_name.trim().is_empty()
        || !input.customer_confirmed
        || input.completion_note.chars().count() > 1000
    {
        return Err(AppError::validation(
            "customer confirmation and a valid signer name are required",
        ));
    }
    let proof = json!({"customerName":input.customer_name.trim(),"customerConfirmed":true,"completionNote":input.completion_note.trim(),"capturedAt":Utc::now()});
    if !repository::save_proof(db, tenant, branch, id, staff, &proof)
        .await
        .map_err(|_| AppError::internal("failed to save service proof"))?
    {
        return Err(AppError::conflict(
            "service proof is only allowed after arrival",
        ));
    }
    Ok(())
}

pub async fn create_tracking(
    state: &AppState,
    tenant: &str,
    branch: &str,
    job: &str,
    actor: &str,
) -> Result<String, AppError> {
    let token = random_token(32);
    if !repository::insert_tracking_link(&state.db, tenant, branch, job, &hash(&token), actor)
        .await
        .map_err(|_| AppError::internal("failed to create tracking link"))?
    {
        return Err(AppError::not_found("field job with a client was not found"));
    }
    Ok(format!(
        "{}/track/{}",
        state.settings.customer_app_base_url, token
    ))
}

pub async fn queue_eta(
    state: &AppState,
    tenant: &str,
    branch: &str,
    job: &str,
    channel: &str,
    tracking_url: &str,
) -> Result<bool, AppError> {
    if !matches!(channel, "whatsapp" | "sms") {
        return Err(AppError::validation("notification channel is invalid"));
    }
    if channel == "whatsapp"
        && !(state.settings.whatsapp_cloud_enabled()
            || state.settings.invoice_delivery_webhook_url.is_some())
    {
        return Err(AppError::service_unavailable(
            "WHATSAPP_NOT_CONFIGURED",
            "WhatsApp delivery provider is not configured",
        ));
    }
    if channel == "sms" && state.settings.invoice_delivery_webhook_url.is_none() {
        return Err(AppError::service_unavailable(
            "SMS_NOT_CONFIGURED",
            "SMS delivery provider is not configured",
        ));
    }
    let (client, recipient, status) = repository::job_contact(&state.db, tenant, branch, job)
        .await
        .map_err(|_| AppError::internal("failed to load field job client"))?
        .ok_or_else(|| AppError::not_found("field job client was not found"))?;
    if recipient.trim().is_empty()
        || !client_service::communication_allowed(&state.db, tenant, branch, &client, channel)
            .await
            .map_err(|_| AppError::internal("failed to verify communication consent"))?
    {
        return Err(AppError::conflict(
            "client phone or communication consent is missing",
        ));
    }
    let source_id = format!("{job}:{status}");
    let payload = json!({"channel":channel,"recipient":recipient,"message":format!("Your service professional is on the way. Track ETA or reschedule: {tracking_url}"),"templateKind":"field_job_eta","trackingUrl":tracking_url,"fieldJobId":job});
    benefit_notification_repository::enqueue(
        &state.db,
        NewBenefitDelivery {
            tenant_id: tenant,
            branch_id: branch,
            source_type: "field_job_eta",
            source_id: &source_id,
            client_id: &client,
            channel,
            recipient: &recipient,
            payload: &payload,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to queue ETA notification"))
}

pub async fn public_tracking(db: &sqlx::PgPool, token: &str) -> Result<Value, AppError> {
    if token.len() < 32 || token.len() > 128 {
        return Err(AppError::not_found("tracking link was not found"));
    }
    repository::public_tracking(db, &hash(token))
        .await
        .map_err(|_| AppError::internal("failed to load tracking status"))?
        .ok_or_else(|| AppError::not_found("tracking link is invalid or expired"))
}

pub async fn create_connection(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    input: &ConnectionInput,
) -> Result<Value, AppError> {
    let provider = input.provider.trim().to_ascii_lowercase();
    if provider.is_empty()
        || provider.len() > 80
        || input.display_name.trim().is_empty()
        || input.display_name.chars().count() > 120
    {
        return Err(AppError::validation(
            "marketplace provider or name is invalid",
        ));
    }
    let key = state
        .settings
        .security_encryption_key
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "CONNECTOR_ENCRYPTION_NOT_CONFIGURED",
                "SECURITY_ENCRYPTION_KEY is required for marketplace connectors",
            )
        })?;
    let secret = random_token(32);
    let ciphertext = security_service::encrypt_secret(key, &secret)?;
    let last_four = secret
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let id = repository::insert_connection(
        &state.db,
        tenant,
        branch,
        &provider,
        input.display_name.trim(),
        input.external_account_id.trim(),
        &ciphertext,
        &last_four,
        actor,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database| database.is_unique_violation())
        {
            AppError::conflict("marketplace connection already exists")
        } else {
            AppError::internal("failed to create marketplace connection")
        }
    })?;
    Ok(
        json!({"id":id,"webhookSecret":secret,"webhookPath":format!("/api/v1/operations/marketplace/webhooks/{id}"),"availabilityPath":format!("/api/v1/operations/marketplace/connections/{id}/availability")}),
    )
}

pub async fn verify_connection(
    state: &AppState,
    id: &str,
    timestamp: &str,
    signature: &str,
    body: &[u8],
) -> Result<(String, String), AppError> {
    let issued = timestamp
        .parse::<i64>()
        .map_err(|_| AppError::unauthenticated("marketplace timestamp is invalid"))?;
    if (Utc::now().timestamp() - issued).abs() > 300 {
        return Err(AppError::unauthenticated(
            "marketplace request timestamp expired",
        ));
    }
    let (tenant, branch, ciphertext, status) = repository::connection_secret(&state.db, id)
        .await
        .map_err(|_| AppError::internal("failed to load marketplace connection"))?
        .ok_or_else(|| AppError::not_found("marketplace connection was not found"))?;
    if status != "active" {
        return Err(AppError::forbidden("marketplace connection is not active"));
    }
    let key = state
        .settings
        .security_encryption_key
        .as_deref()
        .ok_or_else(|| {
            AppError::service_unavailable(
                "CONNECTOR_ENCRYPTION_NOT_CONFIGURED",
                "marketplace connector encryption is not configured",
            )
        })?;
    let secret = security_service::decrypt_secret(key, &ciphertext)?;
    let signed = [timestamp.as_bytes(), b".", body].concat();
    let provided = decode_hex(signature)
        .ok_or_else(|| AppError::unauthenticated("marketplace signature is invalid"))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::internal("failed to verify marketplace signature"))?;
    mac.update(&signed);
    mac.verify_slice(&provided)
        .map_err(|_| AppError::unauthenticated("marketplace signature is invalid"))?;
    Ok((tenant, branch))
}

pub async fn accept_marketplace_booking(
    state: &AppState,
    connection: &str,
    tenant: &str,
    branch: &str,
    body: &[u8],
) -> Result<Value, AppError> {
    let booking: MarketplaceBooking = serde_json::from_slice(body)
        .map_err(|_| AppError::validation("marketplace booking payload is invalid"))?;
    if booking.event_type != "booking.created"
        || booking.event_id.trim().is_empty()
        || booking.external_booking_id.trim().is_empty()
        || booking.client_id.trim().is_empty()
        || booking.service_ids.is_empty()
        || booking.address.trim().is_empty()
        || !valid_coordinates(booking.destination_latitude, booking.destination_longitude)
    {
        return Err(AppError::validation(
            "marketplace booking fields are invalid",
        ));
    }
    let raw: Value = serde_json::from_slice(body)
        .map_err(|_| AppError::validation("marketplace booking payload is invalid"))?;
    let (event_id, inserted) = repository::record_marketplace_event(
        &state.db,
        connection,
        tenant,
        branch,
        booking.event_id.trim(),
        &booking.event_type,
        &raw,
    )
    .await
    .map_err(|_| AppError::internal("failed to record marketplace webhook"))?;
    if !inserted
        && repository::marketplace_event_status(&state.db, &event_id)
            .await
            .map_err(|_| AppError::internal("failed to load marketplace event"))?
            .as_deref()
            != Some("failed")
    {
        return Ok(json!({"accepted":true,"duplicate":true}));
    }
    if let Some(existing) = repository::marketplace_existing_appointment(
        &state.db,
        tenant,
        branch,
        booking.external_booking_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to verify duplicate booking"))?
    {
        if let Some(job) =
            repository::field_job_for_appointment(&state.db, tenant, branch, &existing)
                .await
                .map_err(|_| AppError::internal("failed to verify duplicate field job"))?
        {
            repository::mark_marketplace_event(
                &state.db,
                &event_id,
                "duplicate",
                None,
                Some(&existing),
                Some(&job),
            )
            .await
            .map_err(|_| AppError::internal("failed to close duplicate marketplace event"))?;
            return Ok(
                json!({"accepted":true,"duplicate":true,"appointmentId":existing,"fieldJobId":job}),
            );
        }
        let job = create_job(
            state,
            tenant,
            branch,
            &JobInput {
                appointment_id: existing.clone(),
                staff_id: booking.staff_id,
                travel_zone_id: booking.travel_zone_id,
                address: booking.address,
                travel_minutes: None,
                priority: Some(3),
                destination_latitude: booking.destination_latitude,
                destination_longitude: booking.destination_longitude,
            },
        )
        .await?;
        repository::link_marketplace_job(
            &state.db,
            tenant,
            branch,
            &job,
            connection,
            &booking.external_booking_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to link marketplace field job"))?;
        repository::mark_marketplace_event(
            &state.db,
            &event_id,
            "completed",
            None,
            Some(&existing),
            Some(&job),
        )
        .await
        .map_err(|_| AppError::internal("failed to complete marketplace retry"))?;
        return Ok(
            json!({"accepted":true,"appointmentId":existing,"fieldJobId":job,"retried":true}),
        );
    }
    let external_booking_id = booking.external_booking_id.clone();
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-tenant-id",
        HeaderValue::from_str(tenant)
            .map_err(|_| AppError::internal("invalid marketplace tenant"))?,
    );
    headers.insert(
        "x-branch-id",
        HeaderValue::from_str(branch)
            .map_err(|_| AppError::internal("invalid marketplace branch"))?,
    );
    let appointment = appointments::create_appointment(
        State(state.clone()),
        headers,
        Json(AppointmentCreatePayload {
            tenant_id: Some(tenant.into()),
            branch_id: Some(branch.into()),
            staff_id: booking.staff_id.clone().unwrap_or_default(),
            requested_staff_id: String::new(),
            staff_preference: String::new(),
            client_id: booking.client_id.clone(),
            service_ids: booking.service_ids,
            start_at: booking.start_at,
            end_at: booking.end_at,
            notes: String::new(),
            status: "booked".into(),
            booking_group_id: external_booking_id.clone(),
            source_channel: Some(connection.into()),
            source: Some("marketplace".into()),
            chair_room_id: String::new(),
            service_selections: Vec::new(),
        }),
    )
    .await
    .map_err(|_| AppError::conflict("marketplace appointment could not be created"))?
    .0;
    let job_result = create_job(
        state,
        tenant,
        branch,
        &JobInput {
            appointment_id: appointment.id.clone(),
            staff_id: booking.staff_id,
            travel_zone_id: booking.travel_zone_id,
            address: booking.address,
            travel_minutes: None,
            priority: Some(3),
            destination_latitude: booking.destination_latitude,
            destination_longitude: booking.destination_longitude,
        },
    )
    .await;
    match job_result {
        Ok(job) => {
            repository::link_marketplace_job(
                &state.db,
                tenant,
                branch,
                &job,
                connection,
                &external_booking_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to link marketplace field job"))?;
            repository::mark_marketplace_event(
                &state.db,
                &event_id,
                "completed",
                None,
                Some(&appointment.id),
                Some(&job),
            )
            .await
            .map_err(|_| AppError::internal("failed to complete marketplace event"))?;
            Ok(json!({"accepted":true,"appointmentId":appointment.id,"fieldJobId":job}))
        }
        Err(error) => {
            let _ = repository::mark_marketplace_event(
                &state.db,
                &event_id,
                "failed",
                Some(error.message()),
                Some(&appointment.id),
                None,
            )
            .await;
            Err(error)
        }
    }
}

pub async fn availability(
    state: &AppState,
    connection: &str,
    timestamp: &str,
    signature: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Value, AppError> {
    if to <= from || to - from > chrono::Duration::days(31) {
        return Err(AppError::validation(
            "availability period must be between 1 minute and 31 days",
        ));
    }
    let message = format!("{from}|{to}");
    let (tenant, branch) =
        verify_connection(state, connection, timestamp, signature, message.as_bytes()).await?;
    repository::availability(&state.db, &tenant, &branch, from, to)
        .await
        .map_err(|_| AppError::internal("failed to load marketplace availability"))
}

pub async fn retry_marketplace_event(
    state: &AppState,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, AppError> {
    let (connection, payload, attempts, max_attempts) =
        repository::marketplace_event_for_retry(&state.db, tenant, branch, id)
            .await
            .map_err(|_| AppError::internal("failed to load marketplace retry"))?
            .ok_or_else(|| AppError::not_found("failed marketplace event was not found"))?;
    if attempts >= max_attempts {
        return Err(AppError::conflict(
            "marketplace event retry limit was reached",
        ));
    }
    let body = serde_json::to_vec(&payload)
        .map_err(|_| AppError::internal("failed to prepare marketplace retry"))?;
    accept_marketplace_booking(state, &connection, tenant, branch, &body).await
}

pub async fn process_marketplace_retries(state: &AppState) -> Result<u64, AppError> {
    let rows = repository::due_marketplace_retries(&state.db, 25)
        .await
        .map_err(|_| AppError::internal("failed to load marketplace retries"))?;
    let mut completed = 0;
    for (id, tenant, branch) in rows {
        if retry_marketplace_event(state, &tenant, &branch, &id)
            .await
            .is_ok()
        {
            completed += 1;
        }
    }
    Ok(completed)
}

pub async fn run_escalation_worker(db: &sqlx::PgPool) -> Result<u64, AppError> {
    repository::escalate_overdue(db)
        .await
        .map_err(|_| AppError::internal("field job escalation failed"))
}

pub async fn audit(
    state: &AppState,
    tenant: &str,
    branch: &str,
    actor: &str,
    action: &str,
    details: Value,
) -> Result<(), AppError> {
    security_service::record_audit(&state.db, tenant, branch, actor, action, details).await
}

fn valid_coordinates(latitude: Option<f64>, longitude: Option<f64>) -> bool {
    matches!((latitude, longitude), (None, None))
        || matches!((latitude, longitude), (Some(lat), Some(lng)) if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng))
}

fn haversine_meters(from_lat: f64, from_lng: f64, to_lat: f64, to_lng: f64) -> i32 {
    let radius = 6_371_000.0_f64;
    let d_lat = (to_lat - from_lat).to_radians();
    let d_lng = (to_lng - from_lng).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + from_lat.to_radians().cos() * to_lat.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    (radius * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())).round() as i32
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{decode_hex, haversine_meters, valid_coordinates, valid_transition};

    #[test]
    fn dispatch_contract_is_forward_only_and_coordinates_are_validated() {
        assert!(valid_transition("assigned", "accepted"));
        assert!(valid_transition("arrived", "completed"));
        assert!(!valid_transition("created", "completed"));
        assert!(valid_coordinates(Some(17.385), Some(78.4867)));
        assert!(!valid_coordinates(Some(100.0), Some(78.4867)));
        assert!((haversine_meters(17.385, 78.4867, 17.395, 78.4967) - 1_530).abs() < 100);
        assert_eq!(decode_hex("00ff"), Some(vec![0, 255]));
    }
}
