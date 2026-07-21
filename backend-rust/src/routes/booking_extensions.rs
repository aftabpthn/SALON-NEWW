use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    routing::{delete, get, patch, post, put},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

use crate::routes::{
    appointments::{self, ApiError},
    booking_portal_v2, clients,
};
use crate::state::AppState;
use crate::{
    models::common::AppError,
    repositories::{
        benefit_notification_repository::{self, NewBenefitDelivery},
        booking_intelligence_repository, booking_repository, clients_repository,
    },
    services::{
        appointment_reporting_service, auth_service::AuthClaims, booking_intelligence_service,
        booking_service, client_service, invoice_delivery, payment_gateway_service,
        razorpay_payment_service,
    },
};

type QueryMap = HashMap<String, String>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookingIntelligencePreviewLineBody {
    id: String,
    service_id: String,
    #[serde(default)]
    staff_id: String,
    start_at: DateTime<Utc>,
    #[serde(default)]
    parallel: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookingIntelligencePreviewBody {
    #[serde(default)]
    client_id: String,
    lines: Vec<BookingIntelligencePreviewLineBody>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBookingGuardBody {
    #[serde(default)]
    requires_consultation: bool,
    #[serde(default)]
    requires_patch_test: bool,
    #[serde(default)]
    consultation_form_definition_id: String,
    #[serde(default = "default_patch_test_valid_days")]
    patch_test_valid_days: i32,
}

fn default_patch_test_valid_days() -> i32 {
    30
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicBookingActionBody {
    #[serde(default)]
    reason: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    start_at: String,
    #[serde(default)]
    end_at: String,
    #[serde(default)]
    staff_id: String,
    #[serde(default)]
    eta_minutes: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookingPaymentCreateBody {
    pub(crate) appointment_id: String,
    #[serde(default)]
    pub(crate) mobile: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookingPaymentRefundBody {
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositBookingLineBody {
    #[serde(default)]
    appointment_id: String,
    #[serde(default)]
    service_id: String,
    #[serde(default)]
    staff_id: String,
    #[serde(default)]
    start_at: String,
    #[serde(default)]
    end_at: String,
    #[serde(default = "default_booking_duration")]
    duration_minutes: i64,
    #[serde(default)]
    chair_room_id: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    variant_id: String,
    #[serde(default)]
    addon_ids: Vec<String>,
}

fn default_booking_duration() -> i64 {
    30
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositBookingBody {
    #[serde(default)]
    branch_id: String,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    staff_id: String,
    #[serde(default)]
    start_at: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    booking_group_id: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    mobile: String,
    #[serde(default = "default_deposit_expiry")]
    deposit_expires_in_minutes: i64,
    #[serde(default)]
    lines: Vec<DepositBookingLineBody>,
}

fn default_deposit_expiry() -> i64 {
    60
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepositFollowupBody {
    #[serde(default)]
    status: String,
    #[serde(default)]
    reminder_channel: String,
    #[serde(default)]
    reminder_sent_at: Option<DateTime<Utc>>,
    #[serde(default)]
    done_at: Option<DateTime<Utc>>,
    #[serde(default)]
    note: String,
    #[serde(default)]
    invoice_id: String,
}

#[derive(sqlx::FromRow)]
struct BookingPaymentLinkRow {
    id: String,
    appointment_id: String,
    provider: String,
    provider_link_id: String,
    provider_payment_id: String,
    amount_paise: i64,
    status: String,
    link_url: String,
    expires_at: Option<DateTime<Utc>>,
    paid_at: Option<DateTime<Utc>>,
    refunded_at: Option<DateTime<Utc>>,
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/booking-profile/:tenant_slug", get(booking_profile_single))
        .route(
            "/booking-profile/:tenant_slug/:branch_slug",
            get(booking_profile),
        )
        .route(
            "/public-booking/:token/details",
            get(public_booking_details),
        )
        .route("/public-booking/:token/cancel", post(public_booking_cancel))
        .route(
            "/public-booking/:token/arrival",
            post(public_booking_arrival),
        )
        .route(
            "/public-booking/:token/reschedule/options",
            post(public_booking_reschedule_options),
        )
        .route(
            "/public-booking/:token/reschedule/confirm",
            post(public_booking_reschedule_confirm),
        )
        .route(
            "/booking-payments/deposit/calculate",
            post(booking_payments_deposit_calculate),
        )
        .route(
            "/booking-payments/payment-link/create",
            post(booking_payments_payment_link_create),
        )
        .route(
            "/booking-payments/:appointment_id/status",
            get(booking_payments_status),
        )
        .route(
            "/booking-payments/:appointment_id/refund",
            post(booking_payments_refund),
        )
        .route(
            "/public/client-forms/:definition_id",
            get(public_client_form),
        )
        .route(
            "/public/client-forms/:definition_id/submissions",
            post(public_client_form_submission),
        )
}

pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/settings/booking", get(booking_settings_get))
        .route("/settings/booking", patch(booking_settings_save))
        .route("/settings/booking", post(booking_settings_save))
        .route("/settings/booking", put(booking_settings_save))
        .route(
            "/booking-intelligence/no-show-risk/:customer_id",
            get(booking_intelligence_no_show_risk),
        )
        .route(
            "/booking-intelligence/preview",
            post(booking_intelligence_preview),
        )
        .route(
            "/booking-intelligence/service-guards/:service_id",
            get(booking_intelligence_service_guard_get)
                .put(booking_intelligence_service_guard_save),
        )
        .route(
            "/booking-intelligence/rebooking-suggestion/:customer_id",
            get(booking_intelligence_rebooking_suggestion),
        )
        .route(
            "/booking-intelligence/rebooking-suggestion/:customer_id/queue",
            post(booking_intelligence_rebooking_queue),
        )
        .route(
            "/booking-intelligence/churn-risk",
            get(booking_intelligence_churn_risk),
        )
        .route(
            "/booking-intelligence/churn-risk/:customer_id",
            get(booking_intelligence_churn_risk_customer),
        )
        .route(
            "/booking-intelligence/upsell-suggestions",
            get(booking_intelligence_upsell_suggestions),
        )
        .route("/booking-analytics/funnel", get(booking_analytics_funnel))
        .route(
            "/booking-analytics/conversion-rates",
            get(booking_analytics_conversion_rates),
        )
        .route(
            "/booking-analytics/abandonments",
            get(booking_analytics_abandonments),
        )
        .route(
            "/booking-analytics/abandonments/detect",
            post(booking_analytics_detect_abandonments),
        )
        .route(
            "/booking-analytics/abandonments/:id/recover",
            post(booking_analytics_recover_abandonment),
        )
        .route(
            "/booking-analytics/recovery-stats",
            get(booking_analytics_recovery_stats),
        )
        .route(
            "/appointment-sms/appointments/:appointment_id/queue",
            post(appointment_sms_queue),
        )
        .route(
            "/reports/appointment-detail-list",
            get(appointment_salonist_report_detail_list),
        )
        .route(
            "/reports/staff-appointments",
            get(appointment_salonist_report_staff_appointments),
        )
        .route(
            "/appointment-deposits/quote",
            post(appointment_deposit_quote),
        )
        .route(
            "/appointment-deposits/multi-service-bookings",
            post(appointment_deposits_multi_service_bookings),
        )
        .route(
            "/appointment-deposits/report",
            get(appointment_deposits_report),
        )
        .route(
            "/appointment-deposits/followups/:payment_link_id",
            patch(appointment_deposits_update_followup),
        )
        .route(
            "/appointments/:id/touchup-eligibility",
            get(appointment_touchup_eligibility),
        )
        .route(
            "/appointments/:id/create-touchup",
            post(appointment_create_touchup),
        )
        .route("/calendar/tokens", post(appointment_calendar_tokens_create))
        .route(
            "/calendar/tokens/:id",
            delete(appointment_calendar_token_revoke),
        )
        .route("/jobs", get(appointment_jobs_list))
        .route("/jobs/:id/retry", post(appointment_jobs_retry))
        .route("/jobs/:id", delete(appointment_jobs_delete))
        .route(
            "/booking-wizard/state",
            put(appointments::save_wizard_state),
        )
        .route(
            "/clients/:id/preferences",
            get(clients::get_client_preferences).patch(clients::save_client_preferences),
        )
        .route("/clients/:id/family-members", get(client_family_members))
        .route("/clients/:id/link-member", post(client_family_link_member))
        .route(
            "/clients/:id/link-member/:member_id",
            delete(client_family_unlink_member),
        )
        .route("/clients/family-tree", get(client_family_tree))
        .route(
            "/clients/:id/forms/:definition_id/kiosk-token",
            post(client_form_kiosk_token),
        )
        .route(
            "/customers/:id/preferences",
            get(clients::get_client_preferences).patch(clients::save_client_preferences),
        )
        .route(
            "/customers/:id/family-members",
            get(customer_family_members),
        )
        .route(
            "/customers/:id/link-member",
            post(customer_family_link_member),
        )
        .route(
            "/customers/:id/link-member/:member_id",
            delete(customer_family_unlink_member),
        )
        .route("/customers/family-tree", get(customer_family_tree))
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

async fn booking_settings_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let settings = booking_service::settings(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(booking_settings_storage_error)?;
    Ok(Json(json!({"branchId":branch_id,"settings":settings})))
}

async fn booking_settings_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let payload_branch = payload.get("branchId").and_then(Value::as_str);
    let (tenant_id, branch_id) = appointments::scope_from_headers(
        &headers,
        query
            .get("tenantId")
            .or_else(|| query.get("tenant_id"))
            .map(String::as_str),
        query
            .get("branchId")
            .or_else(|| query.get("branch_id"))
            .map(String::as_str)
            .or(payload_branch),
    );
    let settings = booking_service::save_settings(&state.db, &tenant_id, &branch_id, &payload)
        .await
        .map_err(|error| match error {
            booking_service::BookingSettingsError::Validation(message) => {
                ApiError::bad_request(message)
            }
            booking_service::BookingSettingsError::Storage(error) => {
                booking_settings_storage_error(error)
            }
        })?;
    Ok(Json(json!({"branchId":branch_id,"settings":settings})))
}

fn booking_settings_storage_error(error: sqlx::Error) -> ApiError {
    if matches!(error, sqlx::Error::RowNotFound) {
        ApiError::not_found("booking branch was not found")
    } else {
        ApiError::internal("failed to access booking settings")
    }
}

async fn booking_profile(
    State(state): State<AppState>,
    Path((tenant_slug, branch_slug)): Path<(String, String)>,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    profile_with_branch_slug(&state, tenant_slug, branch_slug, query).await
}

async fn profile_with_branch_slug(
    state: &AppState,
    tenant_slug: String,
    branch_slug: String,
    query: QueryMap,
) -> Result<Json<Value>, ApiError> {
    let branch_slug = query
        .get("branch")
        .or_else(|| query.get("branchSlug"))
        .or_else(|| query.get("branchId"))
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .unwrap_or(branch_slug);
    let tenant = sqlx::query(
        "SELECT id::text AS id, name, slug FROM tenants WHERE slug=$1 OR id::text=$1 LIMIT 1",
    )
    .bind(&tenant_slug)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking tenant"))?
    .ok_or_else(|| ApiError::not_found("booking tenant was not found"))?;
    let tenant_id = tenant.try_get::<String, _>("id").unwrap_or_default();
    let branch = sqlx::query("SELECT id::text AS id, name, code FROM branches WHERE tenant_id::text=$1 AND active=true AND ($2='' OR id::text=$2 OR code=$2) ORDER BY name LIMIT 1")
        .bind(&tenant_id)
        .bind(&branch_slug)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to load booking branch"))?;
    let branch_id = branch
        .as_ref()
        .and_then(|row| row.try_get::<String, _>("id").ok())
        .unwrap_or_default();
    let (services, staff) = if branch_id.is_empty() {
        (Vec::new(), Vec::new())
    } else {
        (
            load_profile_services(state, &tenant_id, &branch_id).await?,
            load_profile_staff(state, &tenant_id, &branch_id).await?,
        )
    };
    let profile = json!({
        "tenant": {
            "slug": tenant.try_get::<String, _>("slug").unwrap_or_default(),
            "id": tenant_id,
            "name": tenant.try_get::<String, _>("name").unwrap_or_default()
        },
        "branch": {
            "slug": branch_slug,
            "id": branch_id,
            "name": branch.as_ref().and_then(|row| row.try_get::<String, _>("name").ok()).unwrap_or_default()
        },
        "services": services,
        "staff": staff,
        "salonPicks": [],
        "generatedAt": now_iso()
    });
    Ok(Json(profile))
}

async fn booking_profile_single(
    State(state): State<AppState>,
    Path(tenant_slug): Path<String>,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let branch_slug = query
        .get("branch")
        .or_else(|| query.get("branchSlug"))
        .or_else(|| query.get("branchId"))
        .cloned()
        .unwrap_or_default();
    profile_with_branch_slug(&state, tenant_slug, branch_slug, query).await
}

async fn load_profile_services(
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

async fn load_profile_staff(
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

fn public_action_headers(
    state: &AppState,
    token: &str,
) -> Result<(appointments::PublicBookingClaims, HeaderMap), ApiError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-public-booking-token",
        HeaderValue::from_str(token)
            .map_err(|_| ApiError::bad_request("public booking token is invalid"))?,
    );
    let claims = appointments::require_public_booking_claims(state, &headers, "action")?;
    headers.insert(
        "x-tenant-id",
        HeaderValue::from_str(&claims.tenant_id)
            .map_err(|_| ApiError::bad_request("tenant scope is invalid"))?,
    );
    headers.insert(
        "x-branch-id",
        HeaderValue::from_str(&claims.branch_id)
            .map_err(|_| ApiError::bad_request("branch scope is invalid"))?,
    );
    Ok((claims, headers))
}

async fn public_booking_details(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (claims, headers) = public_action_headers(&state, token.trim())?;
    let appointment_id = claims
        .appointment_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("appointment scope is required"))?;
    appointments::require_public_booking_mutation_owner(&state, &headers, appointment_id, None)
        .await?;
    let appointment = appointments::find_appointment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        appointment_id,
    )
    .await?;
    let payment =
        load_booking_payment(&state, &claims.tenant_id, &claims.branch_id, appointment_id).await?;
    Ok(Json(
        json!({"appointment": appointment, "payment": payment.map(payment_json)}),
    ))
}

async fn public_booking_cancel(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(payload): Json<PublicBookingActionBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (claims, headers) = public_action_headers(&state, token.trim())?;
    let appointment_id = claims
        .appointment_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("appointment scope is required"))?;
    appointments::require_public_booking_mutation_owner(&state, &headers, appointment_id, None)
        .await?;
    let result = appointments::cancel_appointment(
        State(state),
        headers,
        Path(appointment_id.to_string()),
        Json(appointments::StatusPayload {
            status: "cancelled".into(),
            reason: payload.reason,
            apply_group: false,
        }),
    )
    .await?;
    Ok((
        StatusCode::OK,
        Json(json!({"appointment": result.0.appointment})),
    ))
}

async fn public_booking_arrival(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(payload): Json<PublicBookingActionBody>,
) -> Result<Json<Value>, ApiError> {
    if !(0..=240).contains(&payload.eta_minutes) {
        return Err(ApiError::bad_request(
            "etaMinutes must be between 0 and 240",
        ));
    }
    let (claims, headers) = public_action_headers(&state, token.trim())?;
    let appointment_id = claims
        .appointment_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("appointment scope is required"))?;
    appointments::require_public_booking_mutation_owner(&state, &headers, appointment_id, None)
        .await?;
    let appointment = appointments::find_appointment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        appointment_id,
    )
    .await?;
    sqlx::query("INSERT INTO appointment_arrival_updates (tenant_id,branch_id,appointment_id,client_id,eta_minutes,status) VALUES ($1,$2,$3,$4,$5,'arriving')")
        .bind(&claims.tenant_id).bind(&claims.branch_id).bind(appointment_id).bind(&appointment.client_id).bind(payload.eta_minutes)
        .execute(&state.db).await
        .map_err(|_| ApiError::internal("failed to save arrival update"))?;
    sqlx::query("INSERT INTO staff_notification_queue (tenant_id,branch_id,requested_by,staff_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,metadata_json) VALUES ($1,$2,'client',$3,'in_app','CLIENT_ARRIVAL_ETA','',$4,$5,FALSE,FALSE,'queued',NOW(),$6::jsonb)")
        .bind(&claims.tenant_id).bind(&claims.branch_id).bind(&appointment.staff_id)
        .bind("Client is arriving").bind(format!("Client arrival ETA: {} minutes", payload.eta_minutes))
        .bind(json!({"appointmentId":appointment_id,"clientId":appointment.client_id.clone(),"etaMinutes":payload.eta_minutes}).to_string())
        .execute(&state.db).await
        .map_err(|_| ApiError::internal("failed to queue staff arrival alert"))?;
    appointments::insert_activity(
        &state,
        &claims.tenant_id,
        Some(&appointment),
        &appointment,
        "CLIENT_ARRIVAL_ETA",
        &format!("client arrival ETA: {} minutes", payload.eta_minutes),
    )
    .await?;
    Ok(Json(
        json!({"appointmentId":appointment_id,"etaMinutes":payload.eta_minutes,"status":"arriving"}),
    ))
}
async fn public_booking_reschedule_options(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(payload): Json<PublicBookingActionBody>,
) -> Result<Json<Value>, ApiError> {
    let (claims, headers) = public_action_headers(&state, token.trim())?;
    let appointment_id = claims
        .appointment_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("appointment scope is required"))?;
    appointments::require_public_booking_mutation_owner(&state, &headers, appointment_id, None)
        .await?;
    let appointment = appointments::find_appointment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        appointment_id,
    )
    .await?;
    booking_portal_v2::booking_portal_v2_slots(
        State(state),
        headers,
        Json(booking_portal_v2::SlotRequest {
            branch_id: Some(claims.branch_id),
            service_ids: Some(appointment.service_ids),
            date: (!payload.date.trim().is_empty()).then_some(payload.date),
            duration: None,
            count: Some(24),
        }),
    )
    .await
}

async fn public_booking_reschedule_confirm(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(payload): Json<PublicBookingActionBody>,
) -> Result<Json<Value>, ApiError> {
    if payload.start_at.trim().is_empty() {
        return Err(ApiError::bad_request("startAt is required"));
    }
    let (claims, headers) = public_action_headers(&state, token.trim())?;
    let appointment_id = claims
        .appointment_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("appointment scope is required"))?;
    appointments::require_public_booking_mutation_owner(&state, &headers, appointment_id, None)
        .await?;
    let appointment = appointments::reschedule_appointment(
        State(state),
        headers,
        Path(appointment_id.to_string()),
        Json(appointments::ReschedulePayload {
            start_at: payload.start_at,
            end_at: (!payload.end_at.trim().is_empty()).then_some(payload.end_at),
            reason: payload.reason,
            staff_id: payload.staff_id,
            staff_change_approval: "client-approved".to_string(),
            staff_change_reason: String::new(),
            service_ids: Vec::new(),
            branch_id: claims.branch_id,
            chair_room_id: String::new(),
            booking_group_id: String::new(),
            change_mode: "official".to_string(),
            actor_source: "client".to_string(),
        }),
    )
    .await?;
    Ok(Json(json!({"appointment": appointment.0})))
}

async fn booking_intelligence_preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BookingIntelligencePreviewBody>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    if payload.lines.is_empty() || payload.lines.len() > 20 {
        return Err(ApiError::bad_request(
            "between 1 and 20 booking lines are required",
        ));
    }
    if payload
        .lines
        .iter()
        .any(|line| line.service_id.trim().is_empty())
    {
        return Err(ApiError::bad_request(
            "serviceId is required for every booking line",
        ));
    }
    let lines = payload
        .lines
        .into_iter()
        .map(|line| booking_intelligence_service::PreviewLine {
            id: line.id,
            service_id: line.service_id,
            staff_id: line.staff_id,
            starts_at: line.start_at,
            parallel: line.parallel,
        })
        .collect::<Vec<_>>();
    let preview = booking_intelligence_service::preview(
        &state.db,
        &tenant_id,
        &branch_id,
        &payload.client_id,
        &lines,
    )
    .await
    .map_err(|_| ApiError::internal("failed to build booking intelligence preview"))?;
    Ok(Json(preview))
}

async fn booking_intelligence_service_guard_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let guards = booking_intelligence_repository::service_booking_guards(
        &state.db,
        &tenant_id,
        &branch_id,
        &[service_id.clone()],
    )
    .await
    .map_err(|_| ApiError::internal("failed to load service booking guard"))?;
    let guard = guards.into_iter().next().map(|value| json!({
        "serviceId":value.service_id,"requiresConsultation":value.requires_consultation,
        "requiresPatchTest":value.requires_patch_test,"consultationFormDefinitionId":value.consultation_form_definition_id,
        "patchTestValidDays":value.patch_test_valid_days
    }));
    Ok(Json(json!({"guard":guard})))
}

async fn booking_intelligence_service_guard_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(service_id): Path<String>,
    Json(payload): Json<ServiceBookingGuardBody>,
) -> Result<Json<Value>, ApiError> {
    if (payload.requires_consultation || payload.requires_patch_test)
        && payload.consultation_form_definition_id.trim().is_empty()
    {
        return Err(ApiError::bad_request(
            "consultationFormDefinitionId is required when a booking guard is enabled",
        ));
    }
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let valid_service = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM services WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND active=TRUE)")
        .bind(&service_id).bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::internal("failed to validate service booking guard scope"))?;
    let valid_form = !(payload.requires_consultation || payload.requires_patch_test) || sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM client_form_definitions WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND active=TRUE)")
        .bind(payload.consultation_form_definition_id.trim()).bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::internal("failed to validate consultation form scope"))?;
    if !valid_service || !valid_form {
        return Err(ApiError::not_found(
            "active service or consultation form was not found in this branch",
        ));
    }
    let guard = booking_intelligence_repository::ServiceBookingGuard {
        service_id,
        requires_consultation: payload.requires_consultation,
        requires_patch_test: payload.requires_patch_test,
        consultation_form_definition_id: payload.consultation_form_definition_id.trim().to_string(),
        patch_test_valid_days: payload.patch_test_valid_days.clamp(1, 365),
    };
    let saved = booking_intelligence_repository::upsert_service_booking_guard(
        &state.db, &tenant_id, &branch_id, &guard,
    )
    .await
    .map_err(|_| {
        ApiError::bad_request("service or consultation form was not found in this branch")
    })?;
    Ok(Json(json!({
        "serviceId":saved.service_id,"requiresConsultation":saved.requires_consultation,
        "requiresPatchTest":saved.requires_patch_test,"consultationFormDefinitionId":saved.consultation_form_definition_id,
        "patchTestValidDays":saved.patch_test_valid_days
    })))
}
async fn booking_intelligence_no_show_risk(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let row = sqlx::query("SELECT COUNT(*)::BIGINT total,COUNT(*) FILTER (WHERE status='no-show')::BIGINT no_shows,COUNT(*) FILTER (WHERE status='cancelled')::BIGINT cancellations,COUNT(*) FILTER (WHERE status IN ('completed','billed','paid'))::BIGINT completed FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND start_at>=NOW()-INTERVAL '365 days'")
        .bind(&tenant_id).bind(&branch_id).bind(&customer_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::internal("failed to calculate no-show risk"))?;
    let total = row.try_get::<i64, _>("total").unwrap_or_default();
    let no_shows = row.try_get::<i64, _>("no_shows").unwrap_or_default();
    let cancellations = row.try_get::<i64, _>("cancellations").unwrap_or_default();
    let completed = row.try_get::<i64, _>("completed").unwrap_or_default();
    let score = if total == 0 {
        0
    } else {
        ((no_shows * 100 + cancellations * 35) / total).clamp(0, 100)
    };
    Ok(Json(
        json!({"customerId":customer_id,"riskScore":score,"riskLevel":if score>=60{"high"}else if score>=30{"medium"}else{"low"},"appointments":total,"noShows":no_shows,"cancellations":cancellations,"completed":completed}),
    ))
}

async fn booking_intelligence_rebooking_suggestion(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let row = sqlx::query("SELECT id,service_ids_json,start_at,(SELECT COALESCE(AVG(gap_days),42)::BIGINT FROM (SELECT EXTRACT(DAY FROM start_at-LAG(start_at) OVER (ORDER BY start_at)) gap_days FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND status IN ('completed','billed','paid')) gaps WHERE gap_days>0) interval_days FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND status IN ('completed','billed','paid') ORDER BY start_at DESC LIMIT 1")
        .bind(&tenant_id).bind(&branch_id).bind(&customer_id).fetch_optional(&state.db).await
        .map_err(|_| ApiError::internal("failed to calculate rebooking suggestion"))?;
    let Some(row) = row else {
        return Ok(Json(json!({"customerId":customer_id,"suggestion":null})));
    };
    let last_at = row
        .try_get::<DateTime<Utc>, _>("start_at")
        .unwrap_or_else(|_| Utc::now());
    let interval_days = row
        .try_get::<i64, _>("interval_days")
        .unwrap_or(42)
        .clamp(7, 365);
    let service_ids = row
        .try_get::<String, _>("service_ids_json")
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!([]));
    Ok(Json(
        json!({"customerId":customer_id,"suggestion":{"sourceAppointmentId":row.try_get::<String,_>("id").unwrap_or_default(),"serviceIds":service_ids,"lastVisitAt":last_at,"recommendedAt":last_at+Duration::days(interval_days),"intervalDays":interval_days}}),
    ))
}

async fn booking_intelligence_rebooking_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO notifications (id,tenant_id,branch_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json) VALUES ($1,$2,$3,'booking-intelligence','rebooking','Rebooking reminder',COALESCE(NULLIF($4->>'message',''),'Rebooking reminder queued'),'client',$5,$4)")
        .bind(&id).bind(&tenant_id).bind(&branch_id).bind(&payload).bind(&customer_id).execute(&state.db).await
        .map_err(|_| ApiError::internal("failed to queue rebooking reminder"))?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id,"customerId":customer_id,"status":"queued"})),
    ))
}

async fn booking_intelligence_churn_risk(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('customerId',client_id,'lastVisitAt',MAX(start_at),'daysSinceVisit',EXTRACT(DAY FROM NOW()-MAX(start_at))::BIGINT,'completedVisits',COUNT(*) FILTER (WHERE status IN ('completed','billed','paid')),'riskLevel',CASE WHEN MAX(start_at)<NOW()-INTERVAL '180 days' THEN 'high' WHEN MAX(start_at)<NOW()-INTERVAL '90 days' THEN 'medium' ELSE 'low' END) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id<>'' GROUP BY client_id HAVING MAX(start_at)<NOW()-INTERVAL '60 days' ORDER BY MAX(start_at) LIMIT 500")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to calculate churn risk"))?;
    Ok(Json(
        json!({"tenantId":tenant_id,"branchId":branch_id,"customers":rows}),
    ))
}

async fn booking_intelligence_churn_risk_customer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(customer_id): Path<String>,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let row: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('customerId',client_id,'lastVisitAt',MAX(start_at),'daysSinceVisit',EXTRACT(DAY FROM NOW()-MAX(start_at))::BIGINT,'completedVisits',COUNT(*) FILTER (WHERE status IN ('completed','billed','paid')),'riskLevel',CASE WHEN MAX(start_at)<NOW()-INTERVAL '180 days' THEN 'high' WHEN MAX(start_at)<NOW()-INTERVAL '90 days' THEN 'medium' ELSE 'low' END) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 GROUP BY client_id")
        .bind(&tenant_id).bind(&branch_id).bind(&customer_id).fetch_optional(&state.db).await
        .map_err(|_| ApiError::internal("failed to calculate customer churn risk"))?;
    Ok(Json(row.unwrap_or_else(|| json!({"customerId":customer_id,"lastVisitAt":null,"daysSinceVisit":null,"completedVisits":0,"riskLevel":"unknown"}))))
}

async fn booking_intelligence_upsell_suggestions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let selected: Vec<String> = query
        .get("serviceIds")
        .or_else(|| query.get("service_ids"))
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('serviceId',s.id,'name',s.name,'category',s.category,'pricePaise',s.price_paise,'durationMinutes',s.duration_minutes) FROM services s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.active=TRUE AND NOT (s.id=ANY($3)) ORDER BY s.price_paise,s.name LIMIT 8")
        .bind(&tenant_id).bind(&branch_id).bind(&selected).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking upsell suggestions"))?;
    Ok(Json(
        json!({"tenantId":tenant_id,"branchId":branch_id,"suggestions":rows}),
    ))
}

async fn booking_analytics_funnel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('event',event_name,'sessions',COUNT(DISTINCT session_id),'events',COUNT(*),'maxStep',MAX(step_order)) FROM public_booking_session_events WHERE tenant_id=$1 AND branch_id=$2 GROUP BY event_name ORDER BY MAX(step_order),event_name")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking funnel"))?;
    Ok(Json(
        json!({"tenantId":tenant_id,"branchId":branch_id,"steps":rows}),
    ))
}

async fn booking_analytics_conversion_rates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let row = sqlx::query("SELECT COUNT(*)::BIGINT total,COUNT(*) FILTER (WHERE status IN ('converted','recovered'))::BIGINT converted,COUNT(*) FILTER (WHERE abandoned_at IS NOT NULL)::BIGINT abandoned,COUNT(*) FILTER (WHERE status='recovered')::BIGINT recovered FROM public_booking_sessions WHERE tenant_id=$1 AND branch_id=$2")
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::internal("failed to calculate booking conversion"))?;
    let total = row.try_get::<i64, _>("total").unwrap_or_default();
    let converted = row.try_get::<i64, _>("converted").unwrap_or_default();
    let abandoned = row.try_get::<i64, _>("abandoned").unwrap_or_default();
    let recovered = row.try_get::<i64, _>("recovered").unwrap_or_default();
    Ok(Json(
        json!({"tenantId":tenant_id,"branchId":branch_id,"sessions":total,"converted":converted,"abandoned":abandoned,"recovered":recovered,"conversionRate":percentage(converted,total),"recoveryRate":percentage(recovered,abandoned)}),
    ))
}

async fn booking_analytics_abandonments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'source',source,'deviceType',device_type,'status',status,'lastEvent',last_event,'lastStep',last_step,'eventData',event_data,'createdAt',created_at,'abandonedAt',abandoned_at,'recoveredAt',recovered_at) FROM public_booking_sessions WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('abandoned','recovery_queued','recovered') ORDER BY COALESCE(abandoned_at,last_event_at) DESC LIMIT 500")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking abandonments"))?;
    Ok(Json(
        json!({"tenantId":tenant_id,"branchId":branch_id,"abandonments":rows}),
    ))
}

async fn booking_analytics_detect_abandonments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
    Json(_payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let idle_minutes = query
        .get("idleMinutes")
        .or_else(|| query.get("idle_minutes"))
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(30)
        .clamp(5, 1440);
    let rows: Vec<Value> = sqlx::query_scalar("UPDATE public_booking_sessions SET status='abandoned',abandoned_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND status='active' AND last_event_at < NOW()-($3::TEXT||' minutes')::INTERVAL RETURNING jsonb_build_object('id',id,'lastEvent',last_event,'lastStep',last_step,'abandonedAt',abandoned_at)")
        .bind(&tenant_id).bind(&branch_id).bind(idle_minutes).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to detect booking abandonments"))?;
    Ok((
        StatusCode::OK,
        Json(json!({"detected":rows.len(),"abandonments":rows})),
    ))
}

async fn booking_analytics_recover_abandonment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<QueryMap>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let channel = query.get("channel").map(String::as_str).unwrap_or("sms");
    if !matches!(channel, "sms" | "whatsapp" | "email") {
        return Err(ApiError::bad_request(
            "channel must be sms, whatsapp or email",
        ));
    }
    let contact_value: String = sqlx::query_scalar(
        "SELECT contact_value FROM public_booking_sessions WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status IN ('abandoned','recovery_queued')",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking recovery contact"))?
    .filter(|value: &String| !value.trim().is_empty())
    .ok_or_else(|| ApiError::bad_request("verified booking contact is unavailable"))?;
    if channel == "email" && !contact_value.contains('@') {
        return Err(ApiError::bad_request(
            "verified email is unavailable for this booking session",
        ));
    }
    let delivery_payload = json!({
        "channel": channel,
        "recipient": contact_value,
        "templateKind": if channel == "whatsapp" { "conversation" } else { "bookingRecovery" },
        "template": "booking_recovery",
        "sessionId": id,
        "message": "Complete your AuraShine booking.",
    });
    let requested_queue_id = Uuid::new_v4().to_string();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to queue booking recovery"))?;
    let updated=sqlx::query("UPDATE public_booking_sessions SET status='recovery_queued',last_event='recovery_queued',last_event_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status IN ('abandoned','recovery_queued')")
        .bind(&id).bind(&tenant_id).bind(&branch_id).execute(&mut *tx).await.map_err(|_|ApiError::internal("failed to queue booking recovery"))?.rows_affected();
    if updated == 0 {
        return Err(ApiError::not_found("booking abandonment was not found"));
    }
    let queued = sqlx::query("INSERT INTO booking_recovery_queue (id,tenant_id,branch_id,session_id,channel,payload_json) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (session_id,channel) DO UPDATE SET status=CASE WHEN booking_recovery_queue.status='sent' THEN 'sent' ELSE 'queued' END,payload_json=EXCLUDED.payload_json,created_at=CASE WHEN booking_recovery_queue.status='sent' THEN booking_recovery_queue.created_at ELSE NOW() END RETURNING id,status")
        .bind(&requested_queue_id).bind(&tenant_id).bind(&branch_id).bind(&id).bind(channel).bind(&delivery_payload).fetch_one(&mut *tx).await.map_err(|_|ApiError::internal("failed to queue booking recovery"))?;
    let queue_id = queued
        .try_get::<String, _>("id")
        .unwrap_or(requested_queue_id);
    let queue_status = queued
        .try_get::<String, _>("status")
        .unwrap_or_else(|_| "queued".to_string());
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to queue booking recovery"))?;
    if queue_status == "sent" {
        return Ok((
            StatusCode::OK,
            Json(
                json!({"id":queue_id,"sessionId":id,"channel":channel,"status":"sent","idempotent":true}),
            ),
        ));
    }
    match invoice_delivery::deliver(&state.settings, &delivery_payload).await {
        Ok(provider_message_id) => {
            sqlx::query("UPDATE booking_recovery_queue SET status='sent',sent_at=NOW(),payload_json=payload_json || jsonb_build_object('providerMessageId',$2) WHERE id=$1 AND status='queued'")
                .bind(&queue_id).bind(&provider_message_id).execute(&state.db).await.map_err(|_|ApiError::internal("booking recovery was delivered but its status could not be saved"))?;
        }
        Err(_) => {
            sqlx::query(
                "UPDATE booking_recovery_queue SET status='failed' WHERE id=$1 AND status='queued'",
            )
            .bind(&queue_id)
            .execute(&state.db)
            .await
            .map_err(|_| ApiError::internal("failed to save booking recovery delivery failure"))?;
            return Err(ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "booking recovery provider is not configured or unavailable",
            ));
        }
    }
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":queue_id,"sessionId":id,"channel":channel,"status":"sent"})),
    ))
}

async fn booking_analytics_recovery_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let row=sqlx::query("SELECT COUNT(*)::BIGINT queued,COUNT(*) FILTER (WHERE status='sent')::BIGINT sent,COUNT(*) FILTER (WHERE status='failed')::BIGINT failed FROM booking_recovery_queue WHERE tenant_id=$1 AND branch_id=$2")
        .bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await.map_err(|_|ApiError::internal("failed to load recovery stats"))?;
    let recovered:i64=sqlx::query_scalar("SELECT COUNT(*)::BIGINT FROM public_booking_sessions WHERE tenant_id=$1 AND branch_id=$2 AND status='recovered'").bind(&tenant_id).bind(&branch_id).fetch_one(&state.db).await.map_err(|_|ApiError::internal("failed to load recovery stats"))?;
    Ok(Json(
        json!({"tenantId":tenant_id,"branchId":branch_id,"queued":row.try_get::<i64,_>("queued").unwrap_or_default(),"sent":row.try_get::<i64,_>("sent").unwrap_or_default(),"failed":row.try_get::<i64,_>("failed").unwrap_or_default(),"recovered":recovered}),
    ))
}

fn analytics_scope(headers: &HeaderMap, query: &QueryMap) -> (String, String) {
    appointments::scope_from_headers(
        headers,
        query
            .get("tenantId")
            .or_else(|| query.get("tenant_id"))
            .map(String::as_str),
        query
            .get("branchId")
            .or_else(|| query.get("branch_id"))
            .map(String::as_str),
    )
}

fn percentage(value: i64, total: i64) -> f64 {
    if total <= 0 {
        0.0
    } else {
        (value as f64 * 10000.0 / total as f64).round() / 100.0
    }
}

async fn booking_payments_deposit_calculate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(_query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let total_paise = payload_amount_paise(&payload);
    if total_paise <= 0 {
        return Err(ApiError::bad_request("amount is required"));
    }
    booking_deposit_quote(&state, &headers, total_paise).await
}

pub(crate) async fn booking_payments_payment_link_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BookingPaymentCreateBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "action")?;
    if claims.appointment_id.as_deref() != Some(payload.appointment_id.trim()) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "public booking token does not own this appointment",
        ));
    }
    appointments::require_public_booking_mutation_owner(
        &state,
        &headers,
        payload.appointment_id.trim(),
        None,
    )
    .await?;
    create_booking_payment_link(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        payload.appointment_id.trim(),
        payload.mobile.trim(),
        "",
        "",
        None,
        30,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn create_booking_payment_link(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    mobile: &str,
    customer_name: &str,
    customer_email: &str,
    amount_override_paise: Option<i64>,
    expires_in_minutes: i64,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let appointment = sqlx::query(
        "SELECT booked_total_paise,COALESCE(booking_group_id,'') booking_group_id
         FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking deposit"))?
    .ok_or_else(|| ApiError::not_found("appointment was not found"))?;
    let total_paise = appointment
        .try_get::<i64, _>("booked_total_paise")
        .unwrap_or_default();
    let booking_group_id = appointment
        .try_get::<String, _>("booking_group_id")
        .unwrap_or_default();
    let amount_paise = match amount_override_paise {
        Some(amount) => amount,
        None => {
            booking_service::deposit_quote(&state.db, tenant_id, branch_id, total_paise)
                .await
                .map_err(booking_settings_storage_error)?
                .deposit_paise
        }
    };
    if amount_paise <= 0 {
        return Err(ApiError::bad_request(
            "this booking does not require a deposit",
        ));
    }
    let payment_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO appointment_payment_links (id,tenant_id,branch_id,appointment_id,amount_paise,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,branch_id,appointment_id) DO UPDATE SET amount_paise=EXCLUDED.amount_paise,updated_at=NOW() WHERE appointment_payment_links.status IN ('pending','failed') AND appointment_payment_links.link_url=''")
        .bind(&payment_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(appointment_id)
        .bind(amount_paise)
        .bind(format!("booking-deposit-{appointment_id}"))
        .execute(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to reserve booking payment"))?;
    let existing = load_booking_payment(state, tenant_id, branch_id, appointment_id)
        .await?
        .ok_or_else(|| ApiError::internal("failed to load booking payment"))?;
    if !existing.link_url.is_empty() || matches!(existing.status.as_str(), "paid" | "refunded") {
        return Ok((StatusCode::OK, Json(payment_json(existing))));
    }
    let reserved = sqlx::query_scalar::<_, String>("UPDATE appointment_payment_links SET status='creating',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND status IN ('pending','failed') RETURNING id")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(appointment_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to reserve booking payment provider call"))?;
    if reserved.is_none() {
        return Err(ApiError::conflict(
            "booking payment is already being created",
        ));
    }
    let expires_at = Utc::now() + Duration::minutes(expires_in_minutes.clamp(5, 1440));
    let provider_link = payment_gateway_service::create_payment_link(
        &state.settings,
        "razorpay",
        payment_gateway_service::CreatePaymentLink {
            reference_id: existing.id.clone(),
            amount_paise,
            description: format!("Booking deposit for {appointment_id}"),
            expires_at: Some(expires_at),
            notes: json!({"appointmentId":appointment_id,"bookingGroupId":booking_group_id,"localPaymentLinkId":existing.id}),
            customer_name: customer_name.to_string(),
            customer_phone: mobile.to_string(),
            customer_email: customer_email.to_string(),
        },
    )
    .await;
    let provider_link = match provider_link {
        Ok(link) => link,
        Err(_) => {
            let _ = sqlx::query("UPDATE appointment_payment_links SET status='failed',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND status='creating'")
                .bind(tenant_id).bind(branch_id).bind(appointment_id).execute(&state.db).await;
            return Err(ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "Razorpay payment provider is not configured or unavailable",
            ));
        }
    };
    sqlx::query("UPDATE appointment_payment_links SET provider_link_id=$4,link_url=$5,status='issued',payload_json=$6::jsonb,expires_at=$7,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(appointment_id)
        .bind(provider_link.provider_link_id)
        .bind(provider_link.short_url)
        .bind(provider_link.payload.to_string())
        .bind(expires_at)
        .execute(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to save booking payment link"))?;
    let payment = load_booking_payment(state, tenant_id, branch_id, appointment_id)
        .await?
        .ok_or_else(|| ApiError::internal("failed to load booking payment"))?;
    Ok((StatusCode::CREATED, Json(payment_json(payment))))
}

async fn booking_payments_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "action")?;
    appointments::require_public_booking_mutation_owner(&state, &headers, &appointment_id, None)
        .await?;
    let mut payment = load_booking_payment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        &appointment_id,
    )
    .await?
    .ok_or_else(|| ApiError::not_found("booking payment was not found"))?;
    if payment.status == "issued" && !payment.provider_link_id.is_empty() {
        let remote = payment_gateway_service::fetch_payment_link(
            &state.settings,
            &payment.provider,
            &payment.provider_link_id,
        )
        .await
        .map_err(|_| {
            ApiError::with_status(
                StatusCode::SERVICE_UNAVAILABLE,
                "payment status is temporarily unavailable",
            )
        })?;
        let status = normalized_booking_payment_status(&remote.status);
        let provider_payment_id = provider_payment_id_from_payload(&remote.payload);
        let old = appointments::find_appointment(
            &state,
            &claims.tenant_id,
            &claims.branch_id,
            &appointment_id,
        )
        .await?;
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|_| ApiError::internal("failed to update booking payment"))?;
        sqlx::query("UPDATE appointment_payment_links SET status=$4,provider_payment_id=COALESCE(NULLIF($5,''),provider_payment_id),payload_json=$6::jsonb,paid_at=CASE WHEN $4='paid' THEN COALESCE(paid_at,NOW()) ELSE paid_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3")
            .bind(&claims.tenant_id).bind(&claims.branch_id).bind(&appointment_id).bind(&status).bind(&provider_payment_id).bind(remote.payload.to_string()).execute(&mut *tx).await
            .map_err(|_| ApiError::internal("failed to update booking payment status"))?;
        if status == "paid" {
            sqlx::query("UPDATE appointments a SET status='confirmed',version=version+1,updated_at=NOW() WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.status IN ('booked','rescheduled') AND (a.id=$3 OR a.booking_group_id=NULLIF((SELECT source.booking_group_id FROM appointments source WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.id=$3),''))")
                .bind(&claims.tenant_id).bind(&claims.branch_id).bind(&appointment_id).execute(&mut *tx).await
                .map_err(|_| ApiError::internal("failed to confirm paid booking"))?;
        }
        tx.commit()
            .await
            .map_err(|_| ApiError::internal("failed to commit booking payment status"))?;
        if status == "paid" {
            let updated = appointments::find_appointment(
                &state,
                &claims.tenant_id,
                &claims.branch_id,
                &appointment_id,
            )
            .await?;
            if old.status != updated.status {
                appointments::insert_activity(
                    &state,
                    &claims.tenant_id,
                    Some(&old),
                    &updated,
                    "DEPOSIT_PAID",
                    "Razorpay booking deposit paid",
                )
                .await?;
            }
        }
        payment = load_booking_payment(
            &state,
            &claims.tenant_id,
            &claims.branch_id,
            &appointment_id,
        )
        .await?
        .ok_or_else(|| ApiError::not_found("booking payment was not found"))?;
    }
    Ok(Json(payment_json(payment)))
}

async fn booking_payments_refund(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Json(payload): Json<BookingPaymentRefundBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let claims = appointments::require_public_booking_claims(&state, &headers, "action")?;
    appointments::require_public_booking_mutation_owner(&state, &headers, &appointment_id, None)
        .await?;
    if payload.idempotency_key.len() < 10
        || !payload
            .idempotency_key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(ApiError::bad_request("idempotencyKey is invalid"));
    }
    let payment = load_booking_payment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        &appointment_id,
    )
    .await?
    .ok_or_else(|| ApiError::not_found("booking payment was not found"))?;
    if payment.status == "refunded" {
        return Ok((StatusCode::OK, Json(payment_json(payment))));
    }
    if payment.status != "paid" || payment.provider_payment_id.is_empty() {
        return Err(ApiError::conflict(
            "paid booking deposit is required before refund",
        ));
    }
    let existing = sqlx::query_scalar::<_, String>("SELECT id FROM appointment_payment_refunds WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND idempotency_key=$4")
        .bind(&claims.tenant_id).bind(&claims.branch_id).bind(&appointment_id).bind(&payload.idempotency_key).fetch_optional(&state.db).await
        .map_err(|_| ApiError::internal("failed to check booking refund"))?;
    if existing.is_some() {
        return Ok((StatusCode::OK, Json(payment_json(payment))));
    }
    let refund = razorpay_payment_service::create_payment_refund(
        &state.settings,
        &payment.provider_payment_id,
        payment.amount_paise,
        &payload.idempotency_key,
        &format!("booking-{}", appointment_id),
    )
    .await
    .map_err(|_| {
        ApiError::with_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "Razorpay refund is not configured or unavailable",
        )
    })?;
    let refund_id = Uuid::new_v4().to_string();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to save booking refund"))?;
    sqlx::query("INSERT INTO appointment_payment_refunds (id,tenant_id,branch_id,appointment_id,payment_link_id,provider_refund_id,amount_paise,status,idempotency_key,payload_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)")
        .bind(&refund_id).bind(&claims.tenant_id).bind(&claims.branch_id).bind(&appointment_id).bind(&payment.id).bind(refund.provider_refund_id).bind(payment.amount_paise).bind(refund.status).bind(&payload.idempotency_key).bind(refund.payload.to_string()).execute(&mut *tx).await
        .map_err(|_| ApiError::internal("failed to record booking refund"))?;
    sqlx::query("UPDATE appointment_payment_links SET status='refunded',refunded_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&claims.tenant_id).bind(&claims.branch_id).bind(&payment.id).execute(&mut *tx).await
        .map_err(|_| ApiError::internal("failed to update booking refund"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to commit booking refund"))?;
    let appointment = appointments::find_appointment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        &appointment_id,
    )
    .await?;
    appointments::insert_activity(
        &state,
        &claims.tenant_id,
        None,
        &appointment,
        "DEPOSIT_REFUNDED",
        "Razorpay booking deposit refunded",
    )
    .await?;
    let payment = load_booking_payment(
        &state,
        &claims.tenant_id,
        &claims.branch_id,
        &appointment_id,
    )
    .await?
    .ok_or_else(|| ApiError::not_found("booking payment was not found"))?;
    Ok((StatusCode::CREATED, Json(payment_json(payment))))
}

async fn load_booking_payment(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
) -> Result<Option<BookingPaymentLinkRow>, ApiError> {
    sqlx::query_as::<_, BookingPaymentLinkRow>("SELECT id,appointment_id,provider,provider_link_id,provider_payment_id,amount_paise,status,link_url,expires_at,paid_at,refunded_at FROM appointment_payment_links WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3")
        .bind(tenant_id).bind(branch_id).bind(appointment_id).fetch_optional(&state.db).await
        .map_err(|_| ApiError::internal("failed to load booking payment"))
}

fn payment_json(payment: BookingPaymentLinkRow) -> Value {
    json!({
        "id": payment.id,
        "appointmentId": payment.appointment_id,
        "provider": payment.provider,
        "amountPaise": payment.amount_paise,
        "status": payment.status,
        "url": payment.link_url,
        "expiresAt": payment.expires_at,
        "paidAt": payment.paid_at,
        "refundedAt": payment.refunded_at
    })
}

fn normalized_booking_payment_status(status: &str) -> String {
    match status.trim().to_ascii_lowercase().as_str() {
        "paid" => "paid",
        "expired" => "expired",
        "cancelled" | "canceled" => "cancelled",
        "failed" => "failed",
        _ => "issued",
    }
    .to_string()
}

fn provider_payment_id_from_payload(payload: &Value) -> String {
    payload
        .get("payload")
        .and_then(|value| value.get("payment"))
        .and_then(|value| value.get("entity"))
        .and_then(|value| value.get("id"))
        .or_else(|| {
            payload
                .get("payments")
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(|value| value.get("payment_id").or_else(|| value.get("id")))
        })
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod booking_payment_tests {
    use super::normalized_booking_payment_status;

    #[test]
    fn normalizes_provider_payment_link_states() {
        assert_eq!(normalized_booking_payment_status("paid"), "paid");
        assert_eq!(normalized_booking_payment_status("cancelled"), "cancelled");
        assert_eq!(normalized_booking_payment_status("expired"), "expired");
        assert_eq!(normalized_booking_payment_status("created"), "issued");
    }
}

pub(crate) async fn settle_razorpay_booking_payment(
    state: &AppState,
    event_type: &str,
    provider_link_id: &str,
    body: &Bytes,
    payload: &Value,
) -> Result<Json<Value>, AppError> {
    let link = sqlx::query("SELECT id,tenant_id,branch_id,appointment_id,status FROM appointment_payment_links WHERE provider='razorpay' AND provider_link_id=$1")
        .bind(provider_link_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to locate booking payment link"))?;
    let Some(link) = link else {
        return Ok(Json(json!({"received": true, "matched": false})));
    };
    let id = link.try_get::<String, _>("id").unwrap_or_default();
    let tenant_id = link.try_get::<String, _>("tenant_id").unwrap_or_default();
    let branch_id = link.try_get::<String, _>("branch_id").unwrap_or_default();
    let appointment_id = link
        .try_get::<String, _>("appointment_id")
        .unwrap_or_default();
    let current_status = link.try_get::<String, _>("status").unwrap_or_default();
    let provider_event_id = format!("{:x}", Sha256::digest(body));
    let provider_payment_id = provider_payment_id_from_payload(payload);
    let next_status = match event_type {
        "payment_link.paid" => "paid",
        "payment_link.expired" => "expired",
        "payment_link.cancelled" => "cancelled",
        _ => current_status.as_str(),
    };
    let old = appointments::find_appointment(state, &tenant_id, &branch_id, &appointment_id)
        .await
        .map_err(|_| AppError::internal("failed to load booking for payment"))?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start booking payment webhook"))?;
    let inserted = sqlx::query_scalar::<_, String>("INSERT INTO appointment_payment_events (id,tenant_id,branch_id,appointment_id,payment_link_id,provider_event_id,event_type,payload_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (provider_event_id) DO NOTHING RETURNING id")
        .bind(Uuid::new_v4().to_string()).bind(&tenant_id).bind(&branch_id).bind(&appointment_id).bind(&id).bind(&provider_event_id).bind(event_type).bind(payload.to_string())
        .fetch_optional(&mut *tx).await.map_err(|_| AppError::internal("failed to record booking payment webhook"))?;
    if inserted.is_none() {
        tx.rollback().await.map_err(|_| {
            AppError::internal("failed to finish duplicate booking payment webhook")
        })?;
        return Ok(Json(
            json!({"received": true, "matched": true, "duplicate": true}),
        ));
    }
    sqlx::query("UPDATE appointment_payment_links SET status=$4,provider_payment_id=COALESCE(NULLIF($5,''),provider_payment_id),payload_json=$6::jsonb,paid_at=CASE WHEN $4='paid' THEN COALESCE(paid_at,NOW()) ELSE paid_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(next_status).bind(&provider_payment_id).bind(payload.to_string()).execute(&mut *tx).await
        .map_err(|_| AppError::internal("failed to update booking payment webhook"))?;
    if next_status == "paid" {
        sqlx::query("UPDATE appointments a SET status='confirmed',version=version+1,updated_at=NOW() WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.status IN ('booked','rescheduled') AND (a.id=$3 OR a.booking_group_id=NULLIF((SELECT source.booking_group_id FROM appointments source WHERE source.tenant_id=$1 AND source.branch_id=$2 AND source.id=$3),''))")
            .bind(&tenant_id).bind(&branch_id).bind(&appointment_id).execute(&mut *tx).await
            .map_err(|_| AppError::internal("failed to confirm paid booking"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit booking payment webhook"))?;
    if next_status == "paid" {
        let updated =
            appointments::find_appointment(state, &tenant_id, &branch_id, &appointment_id)
                .await
                .map_err(|_| AppError::internal("failed to reload paid booking"))?;
        if old.status != updated.status {
            appointments::insert_activity(
                state,
                &tenant_id,
                Some(&old),
                &updated,
                "DEPOSIT_PAID",
                "Razorpay booking deposit paid",
            )
            .await
            .map_err(|_| AppError::internal("failed to record paid booking activity"))?;
        }
    }
    Ok(Json(
        json!({"received": true, "matched": true, "status": next_status}),
    ))
}

async fn appointment_sms_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if appointment_id.trim().is_empty() || payload.is_null() {
        return Err(ApiError::bad_request(
            "appointmentId and message are required",
        ));
    }
    if state.settings.invoice_delivery_webhook_url.is_none() {
        return Err(ApiError::with_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "SMS and email delivery provider is not configured",
        ));
    }
    let channel = payload
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or("sms")
        .trim()
        .to_ascii_lowercase();
    if !matches!(channel.as_str(), "sms" | "email") {
        return Err(ApiError::bad_request("channel must be SMS or email"));
    }
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 1_000)
        .ok_or_else(|| ApiError::bad_request("appointment message is required"))?;
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let recipient = sqlx::query_as::<_, (String, String)>(
        "SELECT appointment.client_id, CASE WHEN $4='sms' THEN REGEXP_REPLACE(COALESCE(client.phone,''),'[^0-9]','','g') ELSE LOWER(TRIM(COALESCE(client.email,''))) END FROM appointments appointment JOIN clients client ON client.id=appointment.client_id AND client.tenant_id=appointment.tenant_id AND client.branch_id=appointment.branch_id WHERE appointment.id=$1 AND appointment.tenant_id=$2 AND appointment.branch_id=$3 AND client.active=TRUE AND client.merged_into_client_id IS NULL",
    )
    .bind(&appointment_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&channel)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment recipient"))?
    .ok_or_else(|| ApiError::not_found("appointment was not found"))?;
    let destination_valid = if channel == "sms" {
        (8..=15).contains(&recipient.1.len())
    } else {
        recipient.1.contains('@')
    };
    if !destination_valid
        || !client_service::communication_allowed(
            &state.db,
            &tenant_id,
            &branch_id,
            &recipient.0,
            &channel,
        )
        .await
        .map_err(|_| ApiError::internal("failed to verify appointment communication consent"))?
    {
        return Err(ApiError::conflict(
            "client destination or communication consent is missing",
        ));
    }
    let source_id = format!("{}:{}", appointment_id, Uuid::new_v4());
    let delivery = json!({
        "appointmentId": appointment_id,
        "channel": channel,
        "recipient": recipient.1,
        "message": message,
        "subject": "Appointment update",
        "templateKind": "appointment"
    });
    benefit_notification_repository::enqueue(
        &state.db,
        NewBenefitDelivery {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            source_type: "appointment_message",
            source_id: &source_id,
            client_id: &recipient.0,
            channel: delivery["channel"].as_str().unwrap_or_default(),
            recipient: delivery["recipient"].as_str().unwrap_or_default(),
            payload: &delivery,
        },
    )
    .await
    .map_err(|_| ApiError::internal("failed to queue appointment message"))?;
    Ok(Json(
        json!({"queued":true,"sourceId":source_id,"channel":channel}),
    ))
}

async fn appointment_salonist_report_detail_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let (from, to, options) = appointment_report_options(&query)?;
    let rows =
        booking_repository::appointment_report_records(&state.db, &tenant_id, &branch_id, from, to)
            .await
            .map_err(|_| ApiError::internal("failed to load appointment detail report"))?;
    Ok(Json(appointment_reporting_service::detail_report(
        &rows, &branch_id, &options,
    )))
}

async fn appointment_salonist_report_staff_appointments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let (from, to, options) = appointment_report_options(&query)?;
    let rows =
        booking_repository::appointment_report_records(&state.db, &tenant_id, &branch_id, from, to)
            .await
            .map_err(|_| ApiError::internal("failed to load staff appointment report"))?;
    let staff = booking_repository::appointment_report_staff(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| ApiError::internal("failed to load staff appointment report"))?;
    Ok(Json(appointment_reporting_service::staff_report(
        &rows, &staff, &branch_id, &options,
    )))
}

async fn appointment_deposit_quote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(_query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let total_paise = payload_amount_paise(&payload);
    if total_paise <= 0 {
        return Err(ApiError::bad_request("totalAmount is required"));
    }
    booking_deposit_quote(&state, &headers, total_paise).await
}

fn payload_amount_paise(payload: &Value) -> i64 {
    payload
        .get("amountPaise")
        .or_else(|| payload.get("totalPaise"))
        .and_then(Value::as_i64)
        .or_else(|| {
            payload
                .get("amount")
                .or_else(|| payload.get("totalAmount"))
                .and_then(Value::as_f64)
                .map(|amount| (amount * 100.0).round() as i64)
        })
        .unwrap_or(0)
}

async fn booking_deposit_quote(
    state: &AppState,
    headers: &HeaderMap,
    total_paise: i64,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(headers, None, None);
    let quote = booking_service::deposit_quote(&state.db, &tenant_id, &branch_id, total_paise)
        .await
        .map_err(booking_settings_storage_error)?;
    Ok(Json(quote.as_json()))
}

async fn appointment_deposits_multi_service_bookings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
    Json(payload): Json<DepositBookingBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(
        &headers,
        query
            .get("tenantId")
            .or_else(|| query.get("tenant_id"))
            .map(String::as_str),
        query
            .get("branchId")
            .or_else(|| query.get("branch_id"))
            .map(String::as_str)
            .or_else(|| {
                (!payload.branch_id.trim().is_empty()).then_some(payload.branch_id.as_str())
            }),
    );
    if payload.client_id.trim().is_empty() || payload.lines.is_empty() {
        return Err(ApiError::bad_request(
            "clientId and at least one service line are required",
        ));
    }
    let booking_group_id = if payload.booking_group_id.trim().is_empty() {
        Uuid::new_v4().to_string()
    } else {
        payload.booking_group_id.trim().to_string()
    };
    let mut total_paise = 0i64;
    let mut lines = Vec::with_capacity(payload.lines.len());
    for line in &payload.lines {
        let staff_id = if line.staff_id.trim().is_empty() {
            payload.staff_id.trim()
        } else {
            line.staff_id.trim()
        };
        let start_at = if line.start_at.trim().is_empty() {
            payload.start_at.trim()
        } else {
            line.start_at.trim()
        };
        if line.service_id.trim().is_empty() || staff_id.is_empty() || start_at.is_empty() {
            return Err(ApiError::bad_request(
                "every service line needs serviceId, staffId and startAt",
            ));
        }
        let starts_at = DateTime::parse_from_rfc3339(start_at)
            .map_err(|_| ApiError::bad_request("startAt must be RFC3339"))?
            .with_timezone(&Utc);
        let duration_minutes = line.duration_minutes.clamp(1, 1440);
        let end_at = if line.end_at.trim().is_empty() {
            (starts_at + Duration::minutes(duration_minutes)).to_rfc3339()
        } else {
            line.end_at.trim().to_string()
        };
        let selection = appointments::AppointmentServiceSelection {
            service_id: line.service_id.trim().to_string(),
            variant_id: line.variant_id.trim().to_string(),
            addon_ids: line.addon_ids.clone(),
        };
        total_paise = total_paise.saturating_add(
            appointments::validate_service_pricing(
                &state,
                &tenant_id,
                &branch_id,
                staff_id,
                std::slice::from_ref(&selection.service_id),
                std::slice::from_ref(&selection),
                starts_at,
            )
            .await?,
        );
        lines.push(appointments::AppointmentBatchLinePayload {
            appointment_id: line.appointment_id.trim().to_string(),
            client_id: payload.client_id.trim().to_string(),
            staff_id: staff_id.to_string(),
            requested_staff_id: String::new(),
            staff_preference: "any".to_string(),
            staff_change_approval: String::new(),
            staff_change_reason: String::new(),
            service_id: line.service_id.trim().to_string(),
            start_at: start_at.to_string(),
            end_at,
            chair_room_id: line.chair_room_id.trim().to_string(),
            notes: if line.notes.trim().is_empty() {
                payload.notes.trim().to_string()
            } else {
                line.notes.trim().to_string()
            },
            variant_id: line.variant_id.trim().to_string(),
            addon_ids: line.addon_ids.clone(),
        });
    }
    let quote = booking_service::deposit_quote(&state.db, &tenant_id, &branch_id, total_paise)
        .await
        .map_err(booking_settings_storage_error)?;
    if quote.required() && !state.settings.razorpay_payment_links_enabled() {
        return Err(ApiError::with_status(
            StatusCode::SERVICE_UNAVAILABLE,
            "Razorpay payment provider is not configured",
        ));
    }
    let contact = booking_repository::booking_client_contact(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.client_id.trim(),
    )
    .await
    .map_err(|_| ApiError::internal("failed to load booking client"))?
    .ok_or_else(|| ApiError::not_found("booking client was not found"))?;
    let appointments = appointments::save_appointment_batch(
        State(state.clone()),
        headers,
        Json(appointments::AppointmentBatchPayload {
            client_id: payload.client_id.trim().to_string(),
            status: if payload.status.trim().is_empty() {
                "booked".to_string()
            } else {
                payload.status.trim().to_string()
            },
            booking_group_id: booking_group_id.clone(),
            removed_appointment_ids: Vec::new(),
            recurrence_count: Some(1),
            recurrence_interval_days: None,
            lines,
        }),
    )
    .await?
    .0;
    let first_appointment_id = appointments
        .first()
        .map(|appointment| appointment.id.clone())
        .ok_or_else(|| ApiError::internal("booking did not create any appointments"))?;
    let payment = if quote.required() {
        let mobile = if payload.mobile.trim().is_empty() {
            contact.phone.as_str()
        } else {
            payload.mobile.trim()
        };
        let (_, Json(payment)) = create_booking_payment_link(
            &state,
            &tenant_id,
            &branch_id,
            &first_appointment_id,
            mobile,
            &contact.name,
            &contact.email,
            Some(quote.deposit_paise),
            payload.deposit_expires_in_minutes,
        )
        .await?;
        Some(payment)
    } else {
        None
    };
    let mut deposit = quote.as_json();
    if let Some(object) = deposit.as_object_mut() {
        object.insert(
            "status".to_string(),
            json!(payment
                .as_ref()
                .and_then(|value| value.get("status"))
                .and_then(Value::as_str)
                .unwrap_or("not_required")),
        );
        object.insert("appointmentId".to_string(), json!(first_appointment_id));
        object.insert(
            "paymentLinkId".to_string(),
            json!(payment
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("")),
        );
        object.insert(
            "paymentLink".to_string(),
            json!(payment
                .as_ref()
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str)
                .unwrap_or("")),
        );
        object.insert(
            "expiresAt".to_string(),
            payment
                .as_ref()
                .and_then(|value| value.get("expiresAt"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        object.insert(
            "payment".to_string(),
            payment.clone().unwrap_or(Value::Null),
        );
    }
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "tenantId":tenant_id,
            "branchId":branch_id,
            "bookingGroupId":booking_group_id,
            "appointments":appointments,
            "deposit":deposit
        })),
    ))
}

async fn appointment_deposits_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = analytics_scope(&headers, &query);
    let from = report_date(&query, "from")?;
    let to = report_date(&query, "to")?;
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(ApiError::bad_request("from must be on or before to"));
    }
    let rows =
        booking_repository::appointment_deposit_report(&state.db, &tenant_id, &branch_id, from, to)
            .await
            .map_err(|_| ApiError::internal("failed to load appointment deposit report"))?;
    let mut total_paise = 0i64;
    let mut paid_paise = 0i64;
    let mut pending_paise = 0i64;
    let mut refunded_paise = 0i64;
    for row in &rows {
        let amount = row.get("amountPaise").and_then(Value::as_i64).unwrap_or(0);
        total_paise = total_paise.saturating_add(amount);
        match row
            .get("depositStatus")
            .and_then(Value::as_str)
            .unwrap_or("")
        {
            "paid" => paid_paise = paid_paise.saturating_add(amount),
            "refunded" => {
                paid_paise = paid_paise.saturating_add(amount);
                refunded_paise = refunded_paise.saturating_add(amount);
            }
            _ => pending_paise = pending_paise.saturating_add(amount),
        }
    }
    Ok(Json(json!({
        "stats":{
            "count":rows.len(),
            "totalAmountPaise":total_paise,
            "paidAmountPaise":paid_paise,
            "pendingAmountPaise":pending_paise,
            "refundedAmountPaise":refunded_paise,
            "forfeitedAmountPaise":0,
            "totalAmount":total_paise as f64/100.0,
            "paidAmount":paid_paise as f64/100.0,
            "pendingAmount":pending_paise as f64/100.0,
            "refundedAmount":refunded_paise as f64/100.0,
            "forfeitedAmount":0
        },
        "rows":rows
    })))
}

async fn appointment_deposits_update_followup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(payment_link_id): Path<String>,
    Json(payload): Json<DepositFollowupBody>,
) -> Result<Json<Value>, ApiError> {
    if payment_link_id.trim().is_empty() {
        return Err(ApiError::bad_request("paymentLinkId is required"));
    }
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let status = match payload.status.trim().to_ascii_lowercase().as_str() {
        "" | "pending" => "pending",
        "reminder_sent" => "reminder_sent",
        "done" => "done",
        _ => {
            return Err(ApiError::bad_request(
                "status must be pending, reminder_sent or done",
            ))
        }
    };
    let reminder_channel = payload.reminder_channel.trim().to_ascii_lowercase();
    if !matches!(
        reminder_channel.as_str(),
        "" | "sms" | "whatsapp" | "email" | "phone"
    ) {
        return Err(ApiError::bad_request(
            "reminderChannel must be sms, whatsapp, email or phone",
        ));
    }
    let reminder_sent_at = if status == "reminder_sent" {
        Some(payload.reminder_sent_at.unwrap_or_else(Utc::now))
    } else {
        payload.reminder_sent_at
    };
    let done_at = if status == "done" {
        Some(payload.done_at.unwrap_or_else(Utc::now))
    } else {
        None
    };
    let note = payload.note.trim().chars().take(2000).collect::<String>();
    let saved = booking_repository::save_deposit_followup(
        &state.db,
        booking_repository::DepositFollowupInput {
            payment_link_id: payment_link_id.trim(),
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            invoice_id: payload.invoice_id.trim(),
            status,
            reminder_channel: &reminder_channel,
            reminder_sent_at,
            done_at,
            note: &note,
            actor_user_id: &claims.sub,
        },
    )
    .await
    .map_err(|_| ApiError::internal("failed to save deposit follow-up"))?
    .ok_or_else(|| ApiError::not_found("deposit payment link was not found"))?;
    Ok(Json(saved))
}

fn report_date(query: &QueryMap, key: &str) -> Result<Option<chrono::NaiveDate>, ApiError> {
    query
        .get(key)
        .map(|value| {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| ApiError::bad_request(format!("{key} must be YYYY-MM-DD")))
        })
        .transpose()
}

fn appointment_report_options(
    query: &QueryMap,
) -> Result<
    (
        Option<chrono::NaiveDate>,
        Option<chrono::NaiveDate>,
        appointment_reporting_service::ReportOptions,
    ),
    ApiError,
> {
    let from = report_date(query, "from")?;
    let to = report_date(query, "to")?;
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(ApiError::bad_request("from must be on or before to"));
    }
    let options = appointment_reporting_service::ReportOptions {
        from: from
            .map(|value| value.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "0000-00-00".to_string()),
        to: to
            .map(|value| value.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "9999-12-31".to_string()),
        report_type: query.get("type").cloned().unwrap_or_default(),
        status: query.get("status").cloned().unwrap_or_default(),
        mode: query.get("mode").cloned().unwrap_or_default(),
        search: query.get("search").cloned().unwrap_or_default(),
        limit: query_limit(query, "limit", 25, 500)?,
        offset: query_limit(query, "offset", 0, 1_000_000)?,
    };
    Ok((from, to, options))
}

fn query_limit(
    query: &QueryMap,
    key: &str,
    default: usize,
    maximum: usize,
) -> Result<usize, ApiError> {
    query
        .get(key)
        .map(|value| {
            value
                .parse::<usize>()
                .map(|value| value.min(maximum))
                .map_err(|_| ApiError::bad_request(format!("{key} must be a non-negative integer")))
        })
        .transpose()
        .map(|value| value.unwrap_or(default))
}

async fn appointment_touchup_eligibility(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let appointment = appointments::find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let reasons = match appointment.status.as_str() {
        "cancelled" => vec!["Appointment already cancelled".to_string()],
        "no-show" => vec!["No-show appointments cannot be touched up".to_string()],
        _ => Vec::new(),
    };
    Ok(Json(json!({
        "appointmentId": id,
        "tenantId": tenant_id,
        "status": appointment.status,
        "eligible": reasons.is_empty(),
        "reasons": reasons,
        "checkedAt": now_iso()
    })))
}

async fn appointment_create_touchup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let appointment = appointments::find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let touchup_service_ids = parse_service_ids_from_payload(
        payload
            .get("serviceIds")
            .or_else(|| payload.get("service_ids"))
            .cloned()
            .unwrap_or_else(|| json!(appointment.service_ids)),
        &appointment.service_ids,
    );
    let touchup_id = Uuid::new_v4().to_string();
    let row = sqlx::query(
        "INSERT INTO appointment_touchups (
            id, tenant_id, appointment_id, service_ids_json, reason, notes, status, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'created',NOW(),NOW())
          RETURNING id, tenant_id, appointment_id, service_ids_json, reason, notes, status, created_at",
    )
    .bind(&touchup_id)
    .bind(&tenant_id)
    .bind(&id)
    .bind(services_json(&touchup_service_ids))
    .bind(payload.get("reason").and_then(Value::as_str).unwrap_or_default())
    .bind(payload.get("notes").and_then(Value::as_str).unwrap_or_default())
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to create touchup appointment"))?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "touchupId": row.try_get::<String,_>("id").unwrap_or(touchup_id),
            "tenantId": row.try_get::<String,_>("tenant_id").unwrap_or(tenant_id),
            "appointmentId": row.try_get::<String,_>("appointment_id").unwrap_or(id),
            "serviceIds": parse_json_array(row.try_get::<String,_>("service_ids_json").ok().as_deref()),
            "status": row.try_get::<String,_>("status").unwrap_or_default(),
            "reason": row.try_get::<String,_>("reason").unwrap_or_default(),
            "notes": row.try_get::<String,_>("notes").unwrap_or_default(),
            "createdAt": row
                .try_get::<DateTime<Utc>,_>("created_at")
                .unwrap_or_else(|_| Utc::now())
                .to_rfc3339()
        })),
    ))
}

async fn appointment_calendar_tokens_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (tenant_id, _branch_id) = appointments::scope_from_headers(&headers, None, None);
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let scope = payload
        .get("scope")
        .and_then(Value::as_str)
        .unwrap_or("calendar");
    let scope_id = payload
        .get("scopeId")
        .or_else(|| payload.get("scope_id"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let expires_at = payload
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(|raw| raw.parse::<DateTime<Utc>>().ok())
        .unwrap_or_else(|| Utc::now() + Duration::hours(24));
    let token_id = Uuid::new_v4().to_string();
    let row = sqlx::query(
        "INSERT INTO appointment_calendar_tokens (
            id, tenant_id, token, scope, scope_id, expires_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
          ON CONFLICT(token) DO UPDATE SET
            scope=EXCLUDED.scope,
            scope_id=EXCLUDED.scope_id,
            expires_at=EXCLUDED.expires_at,
            updated_at=NOW()
          RETURNING id, tenant_id, token, scope, scope_id, expires_at",
    )
    .bind(&token_id)
    .bind(&tenant_id)
    .bind(&token)
    .bind(scope)
    .bind(scope_id)
    .bind(expires_at)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to create calendar token"))?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "tokenId": row.try_get::<String,_>("id").unwrap_or(token_id),
            "tenantId": row.try_get::<String,_>("tenant_id").unwrap_or(tenant_id),
            "token": row.try_get::<String,_>("token").unwrap_or(token),
            "scope": row.try_get::<String,_>("scope").unwrap_or("calendar".to_string()),
            "scopeId": row.try_get::<String,_>("scope_id").unwrap_or_default(),
            "expiresAt": row
                .try_get::<DateTime<Utc>,_>("expires_at")
                .unwrap_or(expires_at)
                .to_rfc3339(),
            "status": "issued",
            "issuedAt": now_iso()
        })),
    ))
}

async fn appointment_calendar_token_revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, _branch_id) = appointments::scope_from_headers(&headers, None, None);
    let row = sqlx::query(
        "SELECT token FROM appointment_calendar_tokens WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL",
    )
    .bind(&id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load calendar token"))?
    .map(|r| r.try_get::<String,_>("token").unwrap_or_else(|_| id.clone()));
    let affected = sqlx::query(
        "UPDATE appointment_calendar_tokens
         SET revoked_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL",
    )
    .bind(&id)
    .bind(&tenant_id)
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to revoke calendar token"))?
    .rows_affected();

    if affected == 0 {
        return Err(ApiError::not_found("calendar token not found"));
    }

    Ok(Json(json!({
        "tokenId": id,
        "token": row.unwrap_or_default(),
        "status": "revoked",
        "revokedAt": now_iso()
    })))
}

async fn appointment_jobs_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let status = query
        .get("status")
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(
        status.as_str(),
        "" | "pending" | "running" | "completed" | "failed" | "dead_letter"
    ) {
        return Err(ApiError::bad_request("unsupported job status filter"));
    }
    let job_type = query
        .get("jobType")
        .or_else(|| query.get("job_type"))
        .map(|value| value.trim())
        .unwrap_or_default();
    let limit = query_limit(&query, "limit", 50, 200)? as i64;
    let jobs = booking_repository::appointment_jobs(
        &state.db, &tenant_id, &branch_id, &status, job_type, limit,
    )
    .await
    .map_err(|_| ApiError::internal("failed to load appointment job queue"))?;
    Ok(Json(json!(jobs)))
}

async fn appointment_jobs_retry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let status = booking_repository::appointment_job_status(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| ApiError::internal("failed to load appointment job"))?
        .ok_or_else(|| ApiError::not_found("appointment job was not found"))?;
    if status == "processing" {
        return Err(ApiError::conflict(
            "a running appointment job cannot be retried",
        ));
    }
    let job = booking_repository::retry_appointment_job(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| ApiError::internal("failed to retry appointment job"))?
        .ok_or_else(|| ApiError::conflict("appointment job state changed; retry again"))?;
    Ok(Json(job))
}

async fn appointment_jobs_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let deleted =
        booking_repository::delete_appointment_job(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| ApiError::internal("failed to delete appointment job"))?;
    Ok(Json(json!({"deleted":deleted})))
}

async fn client_form_kiosk_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((client_id, definition_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    if !clients_repository::client_exists(&state.db, &tenant_id, &branch_id, &client_id)
        .await
        .map_err(|_| ApiError::internal("failed to load client"))?
    {
        return Err(ApiError::not_found("client was not found"));
    }
    let definition =
        clients_repository::get_form_definition(&state.db, &tenant_id, &branch_id, &definition_id)
            .await
            .map_err(|_| ApiError::internal("failed to load client form"))?
            .filter(|row| row.active)
            .ok_or_else(|| ApiError::not_found("client form was not found"))?;
    let token = appointments::issue_public_booking_token(
        &state,
        &tenant_id,
        &branch_id,
        None,
        Some(&client_id),
        &format!("client-form-kiosk:{definition_id}"),
        30,
    )?;
    Ok(Json(json!({
        "success":true,
        "data":{
            "token":token,
            "expiresInMinutes":30,
            "definitionId":definition.id,
            "formName":definition.name,
            "endpoint":format!("/api/v1/public/client-forms/{}", definition.id)
        }
    })))
}

async fn public_client_form(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(definition_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let claims = appointments::require_public_booking_claims(
        &state,
        &headers,
        &format!("client-form-kiosk:{definition_id}"),
    )?;
    let definition = clients_repository::get_form_definition(
        &state.db,
        &claims.tenant_id,
        &claims.branch_id,
        &definition_id,
    )
    .await
    .map_err(|_| ApiError::internal("failed to load client form"))?
    .filter(|row| row.active)
    .ok_or_else(|| ApiError::not_found("client form was not found"))?;
    Ok(Json(json!({"success":true,"data":definition})))
}

async fn public_client_form_submission(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(definition_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let claims = appointments::require_public_booking_claims(
        &state,
        &headers,
        &format!("client-form-kiosk:{definition_id}"),
    )?;
    let client_id = claims
        .client_id
        .as_deref()
        .ok_or_else(|| ApiError::unauthorized("client form token is invalid"))?;
    let definition = clients_repository::get_form_definition(
        &state.db,
        &claims.tenant_id,
        &claims.branch_id,
        &definition_id,
    )
    .await
    .map_err(|_| ApiError::internal("failed to load client form"))?
    .filter(|row| row.active)
    .ok_or_else(|| ApiError::not_found("client form was not found"))?;
    let responses = payload
        .get("responses")
        .cloned()
        .unwrap_or_else(|| json!({}));
    clients::validate_form_responses(&definition.fields_json, &responses)
        .map_err(|_| ApiError::bad_request("invalid client form responses"))?;
    let signature_name = payload
        .get("signatureName")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let consent_accepted = payload
        .get("consentAccepted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if definition.requires_signature && (!consent_accepted || signature_name.chars().count() < 2) {
        return Err(ApiError::bad_request(
            "consent and signatureName are required",
        ));
    }
    if signature_name.chars().count() > 200 || (!signature_name.is_empty() && !consent_accepted) {
        return Err(ApiError::bad_request("invalid signature evidence"));
    }
    let signature_sha256 = if signature_name.is_empty() {
        String::new()
    } else {
        format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}:{}:{}:{}",
                    client_id, definition.id, definition.version, signature_name
                )
                .as_bytes()
            )
        )
    };
    let row = clients_repository::create_form_submission(
        &state.db,
        &claims.tenant_id,
        &claims.branch_id,
        client_id,
        &definition.id,
        &responses,
        signature_name,
        &signature_sha256,
        "kiosk",
    )
    .await
    .map_err(|_| ApiError::internal("failed to submit client form"))?
    .ok_or_else(|| ApiError::not_found("client was not found"))?;
    Ok(Json(json!({"success":true,"data":row})))
}

async fn client_family_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    if !clients_repository::client_exists(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| ApiError::internal("failed to load client"))?
    {
        return Err(ApiError::not_found("client was not found"));
    }
    let rows = clients_repository::list_family_members(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| ApiError::internal("failed to load family members"))?;
    Ok(Json(json!({"success":true,"data":rows})))
}

async fn client_family_link_member(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let related_client_id = payload
        .get("relatedClientId")
        .or_else(|| payload.get("memberId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    let relationship = payload
        .get("relationshipType")
        .or_else(|| payload.get("relationship"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_lowercase();
    if related_client_id.is_empty()
        || related_client_id == id
        || !matches!(
            relationship.as_str(),
            "spouse"
                | "parent"
                | "child"
                | "sibling"
                | "guardian"
                | "dependent"
                | "partner"
                | "other"
        )
    {
        return Err(ApiError::bad_request("invalid family relationship"));
    }
    let reverse_relationship = match relationship.as_str() {
        "parent" => "child",
        "child" => "parent",
        "guardian" => "dependent",
        "dependent" => "guardian",
        value => value,
    };
    let row = clients_repository::link_family_member(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        related_client_id,
        &relationship,
        reverse_relationship,
        &claims.sub,
    )
    .await
    .map_err(|_| ApiError::internal("failed to link family member"))?
    .ok_or_else(|| ApiError::not_found("client or family member was not found"))?;
    Ok(Json(json!({"success":true,"data":row})))
}

async fn client_family_unlink_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, member_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = appointments::scope_from_headers(&headers, None, None);
    let removed = clients_repository::unlink_family_member(
        &state.db, &tenant_id, &branch_id, &id, &member_id,
    )
    .await
    .map_err(|_| ApiError::internal("failed to unlink family member"))?;
    if !removed {
        return Err(ApiError::not_found("family relationship was not found"));
    }
    Ok(Json(
        json!({"success":true,"data":{"memberId":member_id,"unlinked":true}}),
    ))
}

async fn client_family_tree(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    let client_id = query
        .get("clientId")
        .or_else(|| query.get("customerId"))
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("clientId is required"))?;
    client_family_members(State(state), headers, Path(client_id.to_owned())).await
}

async fn customer_family_members(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    client_family_members(State(state), headers, Path(id)).await
}

async fn customer_family_link_member(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    client_family_link_member(
        State(state),
        Extension(claims),
        headers,
        Path(id),
        Json(payload),
    )
    .await
}

async fn customer_family_unlink_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    client_family_unlink_member(State(state), headers, Path(path)).await
}

async fn customer_family_tree(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    client_family_tree(State(state), headers, Query(query)).await
}

fn parse_service_ids_from_payload(payload: Value, fallback: &[String]) -> Vec<String> {
    let from_payload = match payload {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(ToString::to_string))
            .collect::<Vec<String>>(),
        Value::String(raw) => raw
            .split(',')
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect(),
        _ => Vec::new(),
    };

    if from_payload.is_empty() {
        fallback.to_vec()
    } else {
        from_payload
    }
}

fn services_json(service_ids: &[String]) -> String {
    serde_json::to_string(service_ids).unwrap_or_else(|_| "[]".to_string())
}

fn parse_json_array(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|raw| serde_json::from_str::<Vec<String>>(raw).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::payload_amount_paise;

    #[test]
    fn deposit_amount_accepts_paise_and_rupees_without_mixing_units() {
        assert_eq!(
            payload_amount_paise(&serde_json::json!({ "amountPaise": 1250 })),
            1250
        );
        assert_eq!(
            payload_amount_paise(&serde_json::json!({ "totalAmount": 12.5 })),
            1250
        );
    }
}
