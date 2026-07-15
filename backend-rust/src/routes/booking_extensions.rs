use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, post, put},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

use crate::routes::{
    appointments::{self, ApiError},
    clients,
};
use crate::state::AppState;
use crate::{repositories::clients_repository, services::auth_service::AuthClaims};

type QueryMap = HashMap<String, String>;

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
            "/public-booking/:token/reschedule/options",
            post(public_booking_reschedule_options),
        )
        .route(
            "/public-booking/:token/reschedule/confirm",
            post(public_booking_reschedule_confirm),
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
        .route(
            "/booking-intelligence/no-show-risk/:customer_id",
            get(booking_intelligence_no_show_risk),
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
            "/booking-payments/webhook/razorpay",
            post(booking_payments_webhook),
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

fn unsupported(feature: &'static str) -> ApiError {
    ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        format!("{feature} is not implemented"),
    )
}

async fn booking_settings_get(Query(_query): Query<QueryMap>) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking settings storage"))
}

async fn booking_settings_save(
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let _ = query;
    if payload.is_null() {
        return Err(ApiError::bad_request("booking settings payload required"));
    }
    let _ = payload;

    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "booking settings storage is not configured",
    ))
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

async fn public_booking_details(Path(token): Path<String>) -> Result<Json<Value>, ApiError> {
    if token.trim().is_empty() {
        return Err(ApiError::bad_request("token is required"));
    }
    Err(unsupported("public booking token details"))
}

async fn public_booking_cancel(
    Path(token): Path<String>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _ = payload;
    if token.trim().is_empty() {
        return Err(ApiError::bad_request("token is required"));
    }
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "public booking cancellation storage is not configured",
    ))
}

async fn public_booking_reschedule_options(
    Path(token): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if token.trim().is_empty() {
        return Err(ApiError::bad_request("token is required"));
    }
    let _ = payload;
    Err(unsupported("public booking reschedule options"))
}

async fn public_booking_reschedule_confirm(
    Path(token): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let _ = payload;
    if token.trim().is_empty() {
        return Err(ApiError::bad_request("token is required"));
    }
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "public booking reschedule storage is not configured",
    ))
}

async fn booking_intelligence_no_show_risk(
    Path(_customer_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking no-show intelligence"))
}

async fn booking_intelligence_rebooking_suggestion(
    Path(_customer_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking rebooking intelligence"))
}

async fn booking_intelligence_rebooking_queue(
    Path(customer_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _ = customer_id;
    let _ = payload;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "rebooking queue storage is not configured",
    ))
}

async fn booking_intelligence_churn_risk(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking churn intelligence"))
}

async fn booking_intelligence_churn_risk_customer(
    Path(_customer_id): Path<String>,
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("customer churn intelligence"))
}

async fn booking_intelligence_upsell_suggestions(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking upsell intelligence"))
}

async fn booking_analytics_funnel(Query(_query): Query<QueryMap>) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking funnel analytics"))
}

async fn booking_analytics_conversion_rates(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking conversion analytics"))
}

async fn booking_analytics_abandonments(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking abandonment analytics"))
}

async fn booking_analytics_detect_abandonments(
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _ = query;
    let _ = payload;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "abandonment detection storage is not configured",
    ))
}

async fn booking_analytics_recover_abandonment(
    Path(id): Path<String>,
    Query(query): Query<QueryMap>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _ = id;
    let _ = query;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "abandonment recovery storage is not configured",
    ))
}

async fn booking_analytics_recovery_stats(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("booking recovery analytics"))
}

async fn booking_payments_webhook(Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
    let _ = payload;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "payment webhook processing is not configured",
    ))
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

async fn booking_payments_payment_link_create(
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let amount = payload
        .get("amountPaise")
        .and_then(Value::as_i64)
        .or_else(|| {
            payload
                .get("amount")
                .and_then(Value::as_f64)
                .map(|value| (value * 100.0).round() as i64)
        })
        .unwrap_or(0);
    if amount <= 0 {
        return Err(ApiError::bad_request("amountPaise is required"));
    }
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "payment link provider is not configured",
    ))
}

async fn booking_payments_status(
    Path(appointment_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _ = appointment_id;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "payment status provider is not configured",
    ))
}

async fn booking_payments_refund(
    Path(appointment_id): Path<String>,
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _ = query;
    let _ = payload;
    if appointment_id.trim().is_empty() {
        return Err(ApiError::bad_request("appointmentId is required"));
    }
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "refund provider is not configured",
    ))
}

async fn appointment_sms_queue(
    Path(appointment_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if appointment_id.trim().is_empty() || payload.is_null() {
        return Err(ApiError::bad_request(
            "appointmentId and message are required",
        ));
    }
    Err(unsupported("appointment SMS queue"))
}

async fn appointment_salonist_report_detail_list(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("appointment detail report"))
}

async fn appointment_salonist_report_staff_appointments(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("staff appointment report"))
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
    let percent = sqlx::query_scalar::<_, i32>(
        "SELECT booking_deposit_percent FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1 AND COALESCE(NULLIF(b.scope_id,''),b.id::text)=$2 AND b.active=TRUE",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking deposit policy"))?
    .unwrap_or(0);
    let deposit_paise = total_paise.saturating_mul(i64::from(percent)) / 100;
    Ok(Json(json!({
        "totalPaise": total_paise,
        "depositPercent": percent,
        "depositPaise": deposit_paise,
        "required": deposit_paise > 0,
        "currency": "INR"
    })))
}

async fn appointment_deposits_multi_service_bookings(
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let _ = query;
    let _ = payload;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "multi-service deposit booking storage is not configured",
    ))
}

async fn appointment_deposits_report(
    Query(_query): Query<QueryMap>,
) -> Result<Json<Value>, ApiError> {
    Err(unsupported("appointment deposit report"))
}

async fn appointment_deposits_update_followup(
    Path(payment_link_id): Path<String>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let _ = payment_link_id;
    let _ = payload;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "payment follow-up storage is not configured",
    ))
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

async fn appointment_jobs_list() -> Result<Json<Value>, ApiError> {
    Err(unsupported("appointment job queue"))
}

async fn appointment_jobs_retry(Path(_id): Path<String>) -> Result<Json<Value>, ApiError> {
    Err(unsupported("appointment job retry"))
}

async fn appointment_jobs_delete(Path(_id): Path<String>) -> Result<Json<Value>, ApiError> {
    Err(unsupported("appointment job deletion"))
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
    use super::{
        appointment_jobs_retry, booking_intelligence_no_show_risk, booking_settings_get,
        payload_amount_paise, QueryMap,
    };
    use axum::{extract::Path, extract::Query, http::StatusCode, response::IntoResponse};

    #[tokio::test]
    async fn unsupported_booking_placeholders_fail_closed() {
        let statuses = [
            booking_settings_get(Query(QueryMap::new()))
                .await
                .unwrap_err()
                .into_response()
                .status(),
            booking_intelligence_no_show_risk(Path("client-1".to_string()))
                .await
                .unwrap_err()
                .into_response()
                .status(),
            appointment_jobs_retry(Path("job-1".to_string()))
                .await
                .unwrap_err()
                .into_response()
                .status(),
        ];
        assert!(statuses
            .into_iter()
            .all(|status| status == StatusCode::NOT_IMPLEMENTED));
    }

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
