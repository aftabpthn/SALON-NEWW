use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

use crate::routes::appointments::{self, ApiError};
use crate::state::AppState;

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
        .route("/clients/:id/preferences", get(client_preferences_get))
        .route("/clients/:id/preferences", patch(client_preferences_update))
        .route("/clients/:id/family-members", get(client_family_members))
        .route("/clients/:id/link-member", post(client_family_link_member))
        .route(
            "/clients/:id/link-member/:member_id",
            delete(client_family_unlink_member),
        )
        .route("/clients/family-tree", get(client_family_tree))
        .route("/customers/:id/preferences", get(customer_preferences_get))
        .route(
            "/customers/:id/preferences",
            patch(customer_preferences_update),
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

fn tenant_id(query: &QueryMap) -> String {
    query
        .get("tenantId")
        .or_else(|| query.get("tenant_id"))
        .cloned()
        .unwrap_or_else(|| "default-tenant".to_string())
}

fn branch_id(query: &QueryMap) -> String {
    query
        .get("branchId")
        .or_else(|| query.get("branch_id"))
        .cloned()
        .unwrap_or_default()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

async fn booking_settings_get(Query(query): Query<QueryMap>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "tenantId": tenant_id(&query),
            "branchId": branch_id(&query),
            "status": "ready",
            "allowSelfService": true,
            "depositRequired": false,
            "depositAmount": 0,
            "updatedAt": now_iso(),
        })),
    )
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
    Ok(Json(json!({
        "token": token,
        "status": "ready",
        "booking": null,
        "generatedAt": now_iso()
    })))
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
    let date = payload.get("date").and_then(Value::as_str).unwrap_or("");
    Ok(Json(json!({
        "token": token,
        "date": date,
        "options": []
    })))
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

async fn booking_intelligence_no_show_risk(Path(customer_id): Path<String>) -> Json<Value> {
    Json(json!({
        "customerId": customer_id,
        "score": null,
        "level": null,
        "recommendation": null,
        "generatedAt": now_iso()
    }))
}

async fn booking_intelligence_rebooking_suggestion(Path(customer_id): Path<String>) -> Json<Value> {
    Json(json!({
        "customerId": customer_id,
        "message": null,
        "confidence": null,
        "generatedAt": now_iso()
    }))
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

async fn booking_intelligence_churn_risk(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "scope": "all",
        "count": 0,
        "generatedAt": now_iso()
    }))
}

async fn booking_intelligence_churn_risk_customer(
    Path(customer_id): Path<String>,
    Query(query): Query<QueryMap>,
) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "customerId": customer_id,
        "score": null,
        "risk": null,
        "generatedAt": now_iso()
    }))
}

async fn booking_intelligence_upsell_suggestions(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "serviceIds": query.get("serviceIds").cloned().unwrap_or_default(),
        "customerId": query.get("customerId").cloned().unwrap_or_default(),
        "suggestions": []
    }))
}

async fn booking_analytics_funnel(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "metric": "funnel",
        "conversion": null,
        "generatedAt": now_iso()
    }))
}

async fn booking_analytics_conversion_rates(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "metric": "conversionRates",
        "rates": [],
        "generatedAt": now_iso()
    }))
}

async fn booking_analytics_abandonments(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "reasons": [],
        "generatedAt": now_iso()
    }))
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

async fn booking_analytics_recovery_stats(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "recoveryRate": null,
        "activeRecoveries": 0,
        "generatedAt": now_iso()
    }))
}

async fn booking_payments_webhook(Json(payload): Json<Value>) -> Result<Json<Value>, ApiError> {
    let _ = payload;
    Err(ApiError::with_status(
        StatusCode::NOT_IMPLEMENTED,
        "payment webhook processing is not configured",
    ))
}

async fn booking_payments_deposit_calculate(
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let amount = payload
        .get("amount")
        .and_then(Value::as_f64)
        .or_else(|| payload.get("amountPaise").and_then(Value::as_f64))
        .unwrap_or(0.0);
    if amount <= 0.0 {
        return Err(ApiError::bad_request("amount is required"));
    }
    Ok(Json(json!({
        "tenantId": tenant_id(&query),
        "calculation": {
            "amount": amount,
            "depositPaise": (amount * 100.0) as i64
        },
        "generatedAt": now_iso()
    })))
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
) -> (StatusCode, Json<Value>) {
    (
        StatusCode::CREATED,
        Json(json!({
            "appointmentId": appointment_id,
            "message": payload,
            "queuedAt": now_iso(),
            "status": "queued"
        })),
    )
}

async fn appointment_salonist_report_detail_list(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "rows": [],
        "generatedAt": now_iso()
    }))
}

async fn appointment_salonist_report_staff_appointments(
    Query(query): Query<QueryMap>,
) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "rows": [],
        "generatedAt": now_iso()
    }))
}

async fn appointment_deposit_quote(
    Query(query): Query<QueryMap>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let total = payload
        .get("totalAmount")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if total <= 0.0 {
        return Err(ApiError::bad_request("totalAmount is required"));
    }
    Ok(Json(json!({
        "tenantId": tenant_id(&query),
        "totalAmount": total,
        "requiredDeposit": total * 0.2,
        "currency": payload.get("currency").and_then(Value::as_str).unwrap_or("INR"),
        "updatedAt": now_iso()
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

async fn appointment_deposits_report(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "tenantId": tenant_id(&query),
        "metrics": {
            "totalQuotes": 0,
            "totalBooked": 0,
            "totalDepositsCollected": 0
        },
        "generatedAt": now_iso()
    }))
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

async fn appointment_jobs_list() -> Json<Value> {
    Json(json!({
        "jobs": [],
        "status": "ready",
        "generatedAt": now_iso()
    }))
}

async fn appointment_jobs_retry(Path(id): Path<String>) -> Json<Value> {
    Json(json!({
        "jobId": id,
        "status": "retried",
        "retriedAt": now_iso()
    }))
}

async fn appointment_jobs_delete(Path(id): Path<String>) -> Json<Value> {
    Json(json!({
        "jobId": id,
        "status": "deleted",
        "deletedAt": now_iso()
    }))
}

async fn client_preferences_get(Path(id): Path<String>) -> Json<Value> {
    Json(json!({
        "clientId": id,
        "preferences": {
            "sms": true,
            "email": true
        }
    }))
}

async fn client_preferences_update(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    Json(json!({
        "clientId": id,
        "preferences": payload,
        "status": "updated"
    }))
}

async fn client_family_members(Path(id): Path<String>) -> Json<Value> {
    Json(json!({
        "clientId": id,
        "members": [],
        "total": 0
    }))
}

async fn client_family_link_member(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    (
        StatusCode::CREATED,
        Json(json!({
            "clientId": id,
            "member": payload,
            "status": "linked"
        })),
    )
}

async fn client_family_unlink_member(Path((id, member_id)): Path<(String, String)>) -> Json<Value> {
    Json(json!({
        "clientId": id,
        "memberId": member_id,
        "status": "unlinked"
    }))
}

async fn client_family_tree(Query(query): Query<QueryMap>) -> Json<Value> {
    Json(json!({
        "phone": query.get("phone").cloned().unwrap_or_default(),
        "tree": []
    }))
}

async fn customer_preferences_get(Path(id): Path<String>) -> Json<Value> {
    client_preferences_get(Path(id)).await
}

async fn customer_preferences_update(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> Json<Value> {
    client_preferences_update(Path(id), Json(payload)).await
}

async fn customer_family_members(Path(id): Path<String>) -> Json<Value> {
    client_family_members(Path(id)).await
}

async fn customer_family_link_member(
    Path(id): Path<String>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    client_family_link_member(Path(id), Json(payload)).await
}

async fn customer_family_unlink_member(Path(path): Path<(String, String)>) -> Json<Value> {
    client_family_unlink_member(Path(path)).await
}

async fn customer_family_tree(Query(query): Query<QueryMap>) -> Json<Value> {
    client_family_tree(Query(query)).await
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
