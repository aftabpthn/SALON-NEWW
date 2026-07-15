use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::customer_portal_repository as repo,
    routes::{appointments, booking_portal_v2},
    services::{auth_service, customer_portal_service as service, invoice_delivery},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/customer/auth/phone/request-otp", post(request_phone_otp))
        .route("/customer/auth/phone/verify", post(verify_phone_otp))
        .route("/customer/auth/request-otp", post(request_phone_otp))
        .route("/customer/auth/verify-otp", post(verify_phone_otp))
        .route(
            "/customer/auth/email/request-code",
            post(request_email_code),
        )
        .route("/customer/auth/email/verify", post(verify_email_code))
        .route(
            "/customer/auth/request-email-code",
            post(request_email_code),
        )
        .route("/customer/auth/verify-email-code", post(verify_email_code))
        .route("/customer/auth/refresh", post(refresh))
        .route("/customer/auth/logout", post(logout))
        .route("/customer/me", get(me).patch(update_me))
        .route("/customer/me/phone/request-otp", post(request_phone_change))
        .route("/customer/me/phone/verify", post(verify_phone_change))
        .route(
            "/customer/me/email/request-code",
            post(request_email_change),
        )
        .route("/customer/me/email/verify", post(verify_email_change))
        .route("/customer/sessions", get(sessions))
        .route("/customer/sessions/:id", delete(revoke_session))
        .route("/customer/ai/recommendations", get(customer_ai))
        .route("/marketplace/businesses", get(businesses))
        .route("/marketplace/categories", get(categories))
        .route("/marketplace/businesses/:id", get(business))
        .route(
            "/marketplace/businesses/:id/services",
            get(business_services),
        )
        .route("/marketplace/businesses/:id/staff", get(business_staff))
        .route("/marketplace/businesses/:id/reviews", get(business_reviews))
        .route(
            "/marketplace/businesses/:id/membership-plans",
            get(business_memberships),
        )
        .route(
            "/marketplace/businesses/:id/availability",
            get(business_availability),
        )
        .route(
            "/customer/bookings",
            get(customer_bookings).post(create_customer_booking),
        )
        .route(
            "/customer/bookings/:id/cancel",
            post(cancel_customer_booking),
        )
        .route(
            "/customer/bookings/:id/reschedule",
            post(reschedule_customer_booking),
        )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChallengeRequest {
    phone: Option<String>,
    email: Option<String>,
    tenant_id: Option<String>,
    branch_id: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRequest {
    phone: Option<String>,
    email: Option<String>,
    code: String,
    #[serde(default)]
    device: service::DeviceInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileUpdate {
    first_name: Option<String>,
    last_name: Option<String>,
    communication_preferences: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceQuery {
    q: Option<String>,
    category: Option<String>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AvailabilityQuery {
    service_id: String,
    date: Option<String>,
    count: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerAiQuery {
    tenant_id: String,
    branch_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookingRequest {
    tenant_id: String,
    branch_id: String,
    service_ids: Vec<String>,
    staff_id: Option<String>,
    start_at: String,
    end_at: String,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CancelRequest {
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RescheduleRequest {
    start_at: String,
    end_at: Option<String>,
    staff_id: Option<String>,
    reason: Option<String>,
}

async fn request_phone_otp(
    State(state): State<AppState>,
    Json(body): Json<ChallengeRequest>,
) -> ApiResult<Value> {
    request_login_challenge(&state, body, "phone").await
}
async fn request_email_code(
    State(state): State<AppState>,
    Json(body): Json<ChallengeRequest>,
) -> ApiResult<Value> {
    request_login_challenge(&state, body, "email").await
}

async fn request_login_challenge(
    state: &AppState,
    body: ChallengeRequest,
    target_type: &str,
) -> ApiResult<Value> {
    let target = target_value(&body, target_type);
    let pending = service::request_challenge(
        &state.db,
        &state.settings,
        None,
        target_type,
        target,
        "login",
        body.tenant_id.as_deref().unwrap_or(""),
        body.branch_id.as_deref().unwrap_or(""),
        body.first_name.as_deref().unwrap_or(""),
        body.last_name.as_deref().unwrap_or(""),
    )
    .await?;
    deliver_challenge(state, &pending).await?;
    Ok(Json(ApiResponse::ok(
        json!({"sent":true,"target":masked_target(&pending.target,pending.target_type.as_str()),"expiresIn":600}),
    )))
}

async fn verify_phone_otp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<VerifyRequest>,
) -> ApiResult<service::TokenBundle> {
    verify_login(&state, &headers, body, "phone").await
}
async fn verify_email_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<VerifyRequest>,
) -> ApiResult<service::TokenBundle> {
    verify_login(&state, &headers, body, "email").await
}

async fn verify_login(
    state: &AppState,
    headers: &HeaderMap,
    body: VerifyRequest,
    target_type: &str,
) -> ApiResult<service::TokenBundle> {
    let target = if target_type == "phone" {
        body.phone.as_deref().unwrap_or("")
    } else {
        body.email.as_deref().unwrap_or("")
    };
    Ok(Json(ApiResponse::ok(
        service::verify_login(
            &state.db,
            &state.settings,
            target_type,
            target,
            &body.code,
            &body.device,
            header_text(headers, header::USER_AGENT.as_str()),
            &ip_hash(headers),
        )
        .await?,
    )))
}

async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> ApiResult<service::TokenBundle> {
    Ok(Json(ApiResponse::ok(
        service::refresh(&state.db, &state.settings, body.refresh_token.trim()).await?,
    )))
}

async fn logout(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> ApiResult<Value> {
    let revoked = repo::revoke_refresh(
        &state.db,
        &auth_service::token_hash(body.refresh_token.trim()),
    )
    .await
    .map_err(|_| AppError::internal("failed to revoke customer session"))?;
    Ok(Json(ApiResponse::ok(json!({"revoked":revoked}))))
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<repo::AccountRecord> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        service::account(&state.db, &claims.sub).await?,
    )))
}

async fn update_me(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ProfileUpdate>,
) -> ApiResult<repo::AccountRecord> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        service::update_profile(
            &state.db,
            &claims.sub,
            body.first_name.as_deref(),
            body.last_name.as_deref(),
            body.communication_preferences,
        )
        .await?,
    )))
}

async fn request_phone_change(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChallengeRequest>,
) -> ApiResult<Value> {
    request_profile_challenge(&state, &headers, body, "phone").await
}
async fn request_email_change(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChallengeRequest>,
) -> ApiResult<Value> {
    request_profile_challenge(&state, &headers, body, "email").await
}

async fn request_profile_challenge(
    state: &AppState,
    headers: &HeaderMap,
    body: ChallengeRequest,
    target_type: &str,
) -> ApiResult<Value> {
    let claims = active_customer_claims(state, headers).await?;
    let purpose = if target_type == "phone" {
        "change_phone"
    } else {
        "change_email"
    };
    let pending = service::request_challenge(
        &state.db,
        &state.settings,
        Some(&claims.sub),
        target_type,
        target_value(&body, target_type),
        purpose,
        "",
        "",
        "",
        "",
    )
    .await?;
    deliver_challenge(state, &pending).await?;
    Ok(Json(ApiResponse::ok(
        json!({"sent":true,"target":masked_target(&pending.target,target_type),"expiresIn":600}),
    )))
}

async fn verify_phone_change(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<VerifyRequest>,
) -> ApiResult<repo::AccountRecord> {
    verify_profile_change(&state, &headers, body, "phone").await
}
async fn verify_email_change(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<VerifyRequest>,
) -> ApiResult<repo::AccountRecord> {
    verify_profile_change(&state, &headers, body, "email").await
}
async fn verify_profile_change(
    state: &AppState,
    headers: &HeaderMap,
    body: VerifyRequest,
    target_type: &str,
) -> ApiResult<repo::AccountRecord> {
    let claims = active_customer_claims(state, headers).await?;
    let target = if target_type == "phone" {
        body.phone.as_deref().unwrap_or("")
    } else {
        body.email.as_deref().unwrap_or("")
    };
    Ok(Json(ApiResponse::ok(
        service::verify_profile_target(
            &state.db,
            &state.settings,
            &claims.sub,
            target_type,
            target,
            &body.code,
        )
        .await?,
    )))
}

async fn sessions(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let rows = repo::sessions(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer sessions"))?;
    Ok(Json(ApiResponse::ok(
        json!({"currentSessionId":claims.session_id,"sessions":rows}),
    )))
}

async fn revoke_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let revoked = repo::revoke_session(&state.db, &claims.sub, &id, "customer_revoked")
        .await
        .map_err(|_| AppError::internal("failed to revoke customer session"))?;
    if !revoked {
        return Err(AppError::not_found("customer session was not found"));
    }
    Ok(Json(ApiResponse::ok(
        json!({"revoked":true,"sessionId":id}),
    )))
}

async fn customer_ai(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<CustomerAiQuery>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let tenant_id = query.tenant_id.trim();
    let branch_id = query.branch_id.trim();
    if tenant_id.is_empty()
        || branch_id.is_empty()
        || tenant_id.len() > 120
        || branch_id.len() > 120
    {
        return Err(AppError::validation(
            "valid tenantId and branchId are required",
        ));
    }
    Ok(Json(ApiResponse::ok(
        service::customer_ai(
            &state.db,
            &state.settings,
            &claims.sub,
            tenant_id,
            branch_id,
        )
        .await?,
    )))
}

async fn businesses(
    State(state): State<AppState>,
    Query(query): Query<MarketplaceQuery>,
) -> ApiResult<Vec<Value>> {
    let rows = repo::businesses(
        &state.db,
        query.q.as_deref().unwrap_or("").trim(),
        query.category.as_deref().unwrap_or("").trim(),
        query.limit.unwrap_or(48).clamp(1, 100),
    )
    .await
    .map_err(|_| AppError::internal("failed to search marketplace businesses"))?;
    Ok(Json(ApiResponse::ok(rows)))
}
async fn categories(State(state): State<AppState>) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::categories(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to load marketplace categories"))?,
    )))
}
async fn business(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Value> {
    let profile = repo::business(&state.db, &id)
        .await
        .map_err(|_| AppError::internal("failed to load business profile"))?
        .ok_or_else(|| AppError::not_found("business was not found"))?;
    let services = repo::business_services(&state.db, &id)
        .await
        .map_err(|_| AppError::internal("failed to load business services"))?;
    let staff = repo::business_staff(&state.db, &id)
        .await
        .map_err(|_| AppError::internal("failed to load business staff"))?;
    let reviews = repo::business_reviews(&state.db, &id)
        .await
        .map_err(|_| AppError::internal("failed to load business reviews"))?;
    let memberships = repo::business_memberships(&state.db, &id)
        .await
        .map_err(|_| AppError::internal("failed to load membership plans"))?;
    Ok(Json(ApiResponse::ok(
        json!({"profile":profile,"services":services,"staff":staff,"reviews":reviews,"membershipPlans":memberships}),
    )))
}
async fn business_services(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::business_services(&state.db, &id)
            .await
            .map_err(|_| AppError::internal("failed to load business services"))?,
    )))
}
async fn business_staff(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::business_staff(&state.db, &id)
            .await
            .map_err(|_| AppError::internal("failed to load business staff"))?,
    )))
}
async fn business_reviews(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::business_reviews(&state.db, &id)
            .await
            .map_err(|_| AppError::internal("failed to load business reviews"))?,
    )))
}
async fn business_memberships(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::business_memberships(&state.db, &id)
            .await
            .map_err(|_| AppError::internal("failed to load membership plans"))?,
    )))
}

async fn business_availability(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<AvailabilityQuery>,
) -> Result<Json<Value>, appointments::ApiError> {
    booking_portal_v2::marketplace_availability(
        &state,
        &id,
        &query.service_id,
        query.date.as_deref(),
        query.count,
    )
    .await
    .map(Json)
}

async fn customer_bookings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_bookings(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer bookings"))?,
    )))
}

async fn create_customer_booking(
    State(state): State<AppState>,
    mut headers: HeaderMap,
    Json(body): Json<BookingRequest>,
) -> Result<Json<appointments::AppointmentPayload>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let client_id =
        service::ensure_client_link(&state.db, &claims.sub, &body.tenant_id, &body.branch_id)
            .await
            .map_err(|_| {
                appointments::ApiError::internal("failed to link customer booking profile")
            })?;
    let token = appointments::issue_public_booking_token(
        &state,
        &body.tenant_id,
        &body.branch_id,
        None,
        Some(&client_id),
        "confirm",
        15,
    )?;
    headers.insert(
        "x-public-booking-token",
        HeaderValue::from_str(&token).map_err(|_| {
            appointments::ApiError::internal("failed to prepare booking authorization")
        })?,
    );
    appointments::create_appointment(
        State(state),
        headers,
        Json(appointments::AppointmentCreatePayload {
            tenant_id: Some(body.tenant_id),
            branch_id: Some(body.branch_id),
            staff_id: body.staff_id.unwrap_or_default(),
            client_id,
            service_ids: body.service_ids,
            start_at: body.start_at,
            end_at: body.end_at,
            notes: body.notes.unwrap_or_default(),
            status: "booked".to_string(),
            booking_group_id: String::new(),
            source_channel: Some("booking-portal-v2".to_string()),
            source: Some("public-booking".to_string()),
            chair_room_id: String::new(),
            service_selections: Vec::new(),
        }),
    )
    .await
}

async fn cancel_customer_booking(
    State(state): State<AppState>,
    mut headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CancelRequest>,
) -> Result<Json<appointments::AppointmentResponse>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate customer booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    authorize_booking_action(&state, &mut headers, &id, &owned)?;
    appointments::cancel_appointment(
        State(state),
        headers,
        Path(id),
        Json(appointments::StatusPayload {
            status: "cancelled".to_string(),
            reason: body.reason.unwrap_or_default(),
            apply_group: false,
        }),
    )
    .await
}

async fn reschedule_customer_booking(
    State(state): State<AppState>,
    mut headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<RescheduleRequest>,
) -> Result<Json<appointments::AppointmentPayload>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate customer booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    authorize_booking_action(&state, &mut headers, &id, &owned)?;
    appointments::reschedule_appointment(
        State(state),
        headers,
        Path(id),
        Json(appointments::ReschedulePayload {
            start_at: body.start_at,
            end_at: body.end_at,
            reason: body.reason.unwrap_or_default(),
            staff_id: body.staff_id.unwrap_or_default(),
            service_ids: Vec::new(),
            branch_id: owned.branch_id,
            chair_room_id: String::new(),
            booking_group_id: String::new(),
        }),
    )
    .await
}

fn authorize_booking_action(
    state: &AppState,
    headers: &mut HeaderMap,
    id: &str,
    owned: &repo::OwnedBooking,
) -> Result<(), appointments::ApiError> {
    let token = appointments::issue_public_booking_token(
        state,
        &owned.tenant_id,
        &owned.branch_id,
        Some(id),
        Some(&owned.client_id),
        "action",
        15,
    )?;
    headers.insert(
        "x-public-booking-token",
        HeaderValue::from_str(&token).map_err(|_| {
            appointments::ApiError::internal("failed to prepare booking authorization")
        })?,
    );
    Ok(())
}

async fn deliver_challenge(
    state: &AppState,
    pending: &service::PendingChallenge,
) -> Result<(), AppError> {
    let channel = if pending.target_type == "phone" {
        "sms"
    } else {
        "email"
    };
    let payload = json!({"channel":channel,"recipient":pending.target,"templateKind":"customerVerification","template":"customer_verification","code":pending.code,"purpose":pending.purpose,"ttlSeconds":600,"message":format!("Your AuraShine verification code is {}. It expires in 10 minutes.",pending.code)});
    if let Err(error) = invoice_delivery::deliver(&state.settings, &payload).await {
        service::discard_challenge(&state.db, &pending.id).await?;
        return Err(error);
    }
    Ok(())
}

fn customer_claims(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<service::CustomerClaims, AppError> {
    service::require_access(
        &state.settings,
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok()),
    )
}
async fn active_customer_claims(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<service::CustomerClaims, AppError> {
    let claims = customer_claims(state, headers)?;
    let active = repo::session_is_active(&state.db, &claims.sub, &claims.session_id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer session"))?;
    if !active {
        return Err(AppError::unauthenticated(
            "customer session is expired or revoked",
        ));
    }
    Ok(claims)
}
async fn active_booking_claims(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<service::CustomerClaims, appointments::ApiError> {
    active_customer_claims(state, headers).await.map_err(|_| {
        appointments::ApiError::unauthorized("valid customer access token is required")
    })
}
fn target_value<'a>(body: &'a ChallengeRequest, target_type: &str) -> &'a str {
    if target_type == "phone" {
        body.phone.as_deref().unwrap_or("")
    } else {
        body.email.as_deref().unwrap_or("")
    }
}
fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}
fn ip_hash(headers: &HeaderMap) -> String {
    auth_service::token_hash(
        header_text(headers, "x-forwarded-for")
            .split(',')
            .next()
            .unwrap_or("")
            .trim(),
    )
}
fn masked_target(value: &str, target_type: &str) -> String {
    if target_type == "email" {
        let mut parts = value.splitn(2, '@');
        let name = parts.next().unwrap_or("");
        let domain = parts.next().unwrap_or("");
        format!("{}***@{}", name.chars().next().unwrap_or('*'), domain)
    } else {
        format!(
            "***{}",
            value
                .chars()
                .rev()
                .take(4)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        )
    }
}
