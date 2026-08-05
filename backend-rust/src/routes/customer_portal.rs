use std::net::SocketAddr;

use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::{
    config::is_local_env,
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        customer_portal_repository as repo,
        membership_lifecycle_repository as membership_lifecycle_repo,
    },
    routes::{appointments, booking_extensions, booking_portal_v2, pos},
    services::{
        auth_service, customer_portal_service as service, invoice_delivery,
        live_consultation_service, retention_service,
    },
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
        .route("/customer/auth/firebase", post(firebase_login))
        .route("/customer/auth/dev-session", post(customer_dev_session))
        .route("/customer/me", get(me).patch(update_me).delete(delete_me))
        .route(
            "/customer/me/memory",
            get(customer_memory).delete(forget_customer_memory),
        )
        .route(
            "/customer/me/memory/:id/dispute",
            post(dispute_customer_memory),
        )
        .route("/customer/me/phone/request-otp", post(request_phone_change))
        .route("/customer/me/phone/verify", post(verify_phone_change))
        .route(
            "/customer/me/email/request-code",
            post(request_email_change),
        )
        .route("/customer/me/email/verify", post(verify_email_change))
        .route(
            "/customer/sessions",
            get(sessions).delete(revoke_all_sessions),
        )
        .route("/customer/sessions/:id", delete(revoke_session))
        .route("/customer/security-events", get(security_events))
        .route("/customer/rewards", get(customer_rewards))
        .route("/customer/rewards/redeem", post(redeem_customer_rewards))
        .route("/customer/wallet", get(customer_wallet))
        .route(
            "/customer/memberships",
            get(customer_memberships).post(purchase_customer_membership),
        )
        .route(
            "/customer/memberships/:id/freeze",
            post(freeze_customer_membership),
        )
        .route(
            "/customer/memberships/:id/resume",
            post(resume_customer_membership),
        )
        .route(
            "/customer/memberships/:id/cancel",
            post(cancel_customer_membership),
        )
        .route(
            "/customer/memberships/:id/auto-renew",
            post(update_customer_membership_auto_renew),
        )
        .route(
            "/customer/packages",
            get(customer_packages).post(purchase_customer_package),
        )
        .route(
            "/customer/products/checkout",
            post(purchase_customer_product),
        )
        .route(
            "/customer/gift-cards",
            get(customer_gift_cards).post(purchase_customer_gift_card),
        )
        .route(
            "/customer/gift-cards/redeem",
            post(redeem_customer_gift_card),
        )
        .route("/customer/gift-cards/claim", post(claim_customer_gift_card))
        .route("/customer/invoices", get(customer_invoices))
        .route(
            "/customer/invoices/:id/payment-link",
            post(customer_invoice_payment_link),
        )
        .route("/customer/payments", get(customer_payments))
        .route("/customer/payment-methods", get(customer_payment_methods))
        .route("/customer/refunds", get(customer_refunds))
        .route("/customer/notifications", get(customer_notifications))
        .route(
            "/customer/notifications/push-proof",
            get(customer_push_proof),
        )
        .route(
            "/customer/support/tickets",
            get(customer_support_tickets).post(create_customer_support_ticket),
        )
        .route(
            "/customer/support/tickets/:id/messages",
            get(customer_support_messages).post(add_customer_support_message),
        )
        .route("/customer/referrals", get(customer_referrals))
        .route("/customer/offers", get(customer_offers))
        .route("/customer/marketing-offers", get(customer_marketing_offers))
        .route(
            "/customer/marketing-offers/events",
            post(customer_marketing_offer_event),
        )
        .route(
            "/customer/marketing-offers/:id/creative",
            get(customer_marketing_offer_creative),
        )
        .route(
            "/customer/referrals/code",
            post(create_customer_referral_code),
        )
        .route(
            "/customer/family",
            get(customer_family).post(create_customer_family_member),
        )
        .route("/customer/corporate", get(customer_corporate))
        .route("/customer/gallery", get(customer_gallery))
        .route(
            "/customer/goals",
            get(customer_goals).post(create_customer_goal),
        )
        .route("/customer/favorites", get(customer_favorites))
        .route(
            "/customer/favorites/:branch_id",
            post(add_customer_favorite).delete(remove_customer_favorite),
        )
        .route("/customer/ai/recommendations", get(customer_ai))
        .route("/public/live-consultations", post(live_consultation))
        .route("/marketplace/businesses", get(businesses))
        .route("/marketplace/categories", get(categories))
        .route("/marketplace/offers", get(marketplace_offers))
        .route("/marketplace/offers/events", post(marketplace_offer_event))
        .route(
            "/marketplace/offers/:id/creative",
            get(marketplace_offer_creative),
        )
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
            "/marketplace/businesses/:id/packages",
            get(business_packages),
        )
        .route(
            "/marketplace/businesses/:id/products",
            get(business_products),
        )
        .route(
            "/marketplace/businesses/:id/availability",
            get(business_availability),
        )
        .route(
            "/customer/bookings",
            get(customer_bookings).post(create_customer_booking),
        )
        .route("/customer/bookings/:id", get(customer_booking))
        .route(
            "/customer/bookings/:id/waitlist",
            post(join_customer_booking_waitlist),
        )
        .route(
            "/customer/bookings/:id/waitlist-offer/accept",
            post(accept_customer_waitlist_offer),
        )
        .route(
            "/customer/bookings/:id/waitlist-offer/decline",
            post(decline_customer_waitlist_offer),
        )
        .route(
            "/customer/bookings/:id/review",
            post(create_customer_booking_review),
        )
        .route(
            "/customer/bookings/:id/payment-link",
            post(customer_booking_payment_link),
        )
        .route(
            "/customer/bookings/:id/contactless",
            get(customer_booking_contactless),
        )
        .route(
            "/customer/bookings/:id/receipt",
            get(customer_booking_receipt),
        )
        .route(
            "/customer/bookings/:id/contactless-form",
            post(submit_customer_booking_contactless_form),
        )
        .route(
            "/customer/bookings/:id/check-in",
            post(customer_booking_check_in),
        )
        .route(
            "/customer/bookings/:id/self-pay-link",
            post(customer_booking_self_pay_link),
        )
        .route(
            "/customer/bookings/:id/chat",
            post(open_customer_booking_chat),
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
struct FirebaseAuthRequest {
    id_token: String,
    provider: String,
    #[serde(default)]
    device: service::DeviceInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerDevSessionRequest {
    tenant_id: String,
    branch_id: String,
    email: Option<String>,
    phone: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    #[serde(default)]
    device: service::DeviceInput,
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
struct MarketplaceOffersQuery {
    branch_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MarketplaceOfferEventRequest {
    offer_id: String,
    channel: String,
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
    #[serde(default)]
    service_selections: Vec<appointments::AppointmentServiceSelection>,
    client_id: Option<String>,
    #[serde(default)]
    additional_client_ids: Vec<String>,
    package_credit_id: Option<String>,
    staff_id: Option<String>,
    start_at: String,
    end_at: String,
    notes: Option<String>,
    rebook_from_booking_id: Option<String>,
    source: Option<String>,
    offer_code: Option<String>,
    #[serde(default = "default_payment_mode")]
    payment_mode: String,
    #[serde(default)]
    card_guarantee_accepted: bool,
    idempotency_key: Option<String>,
}

fn default_payment_mode() -> String {
    "pay_at_venue".to_string()
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerWaitlistRequest {
    preferred_date: Option<String>,
    preferred_start_date: Option<String>,
    preferred_end_date: Option<String>,
    reason: Option<String>,
    priority: Option<String>,
}

#[derive(Deserialize)]
struct CustomerReviewRequest {
    rating: i32,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipPurchaseRequest {
    plan_id: String,
    branch_id: Option<String>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipFreezeRequest {
    days: i32,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipCancelRequest {
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MembershipAutoRenewRequest {
    enabled: Option<bool>,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GiftCardPurchaseRequest {
    amount_paise: i64,
    branch_id: Option<String>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackagePurchaseRequest {
    package_id: String,
    branch_id: Option<String>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductPurchaseRequest {
    product_id: String,
    branch_id: String,
    quantity: i64,
    coupon_code: Option<String>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GiftCardClaimRequest {
    code: String,
    branch_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerInvoicePaymentLinkRequest {
    provider: Option<String>,
    amount_paise: Option<i64>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerRewardRedeemRequest {
    invoice_id: String,
    points: i32,
    amount_paise: i64,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerBookingContactlessRequest {
    allergies: Option<String>,
    sensitivities: Option<String>,
    patch_test_notes: Option<String>,
    goals: Option<String>,
    budget: Option<String>,
    timeframe: Option<String>,
    preferences: Option<String>,
    pregnancy_context: Option<String>,
    #[serde(default)]
    consent_accepted: bool,
    signature_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerBookingCheckInRequest {
    eta_minutes: i32,
    latitude: Option<f64>,
    longitude: Option<f64>,
    accuracy_meters: Option<f64>,
    idempotency_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerBookingSelfPayRequest {
    provider: Option<String>,
    amount_paise: Option<i64>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerBookingChatRequest {
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerGiftCardRedeemRequest {
    code: String,
    invoice_id: String,
    amount_paise: i64,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerBranchRequest {
    branch_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerSupportTicketRequest {
    branch_id: Option<String>,
    subject: String,
    body: Option<String>,
    category: Option<String>,
    priority: Option<String>,
    booking_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerSupportMessageRequest {
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerFamilyMemberRequest {
    branch_id: Option<String>,
    first_name: String,
    last_name: Option<String>,
    phone: Option<String>,
    relationship_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerGoalRequest {
    branch_id: Option<String>,
    title: String,
    goal_type: Option<String>,
    target_date: Option<NaiveDate>,
    notes: Option<String>,
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
    headers: HeaderMap,
    Json(body): Json<RefreshRequest>,
) -> ApiResult<service::TokenBundle> {
    Ok(Json(ApiResponse::ok(
        service::refresh(
            &state.db,
            &state.settings,
            body.refresh_token.trim(),
            header_text(&headers, header::USER_AGENT.as_str()),
            &ip_hash(&headers),
        )
        .await?,
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

async fn firebase_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<FirebaseAuthRequest>,
) -> ApiResult<service::TokenBundle> {
    enforce_customer_rate_limit(
        &state,
        &format!("customer:firebase:{}", ip_hash(&headers)),
        30,
        900,
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        service::exchange_firebase_token(
            &state.db,
            &state.settings,
            &body.id_token,
            &body.provider,
            &body.device,
            header_text(&headers, header::USER_AGENT.as_str()),
            &ip_hash(&headers),
        )
        .await?,
    )))
}

async fn live_consultation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult<Value> {
    enforce_customer_rate_limit(
        &state,
        &format!("customer:consultation:{}", ip_hash(&headers)),
        20,
        900,
    )
    .await?;
    Ok(Json(ApiResponse::ok(live_consultation_service::create(
        &payload,
    )?)))
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

async fn delete_me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let deleted = repo::soft_delete_account(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to delete customer account"))?;
    if !deleted {
        return Err(AppError::not_found("customer account was not found"));
    }
    Ok(Json(ApiResponse::ok(
        json!({"deleted":true,"id":claims.sub}),
    )))
}

async fn customer_dev_session(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<CustomerDevSessionRequest>,
) -> ApiResult<service::TokenBundle> {
    if !is_local_env(&state.settings.app_env) || !state.settings.enable_dev_session {
        return Err(AppError::not_found("customer dev session is not available"));
    }
    require_loopback_dev_request(peer)?;
    let expected = state
        .settings
        .dev_session_secret
        .as_deref()
        .ok_or_else(|| AppError::not_found("customer dev session is not available"))?;
    let provided = headers
        .get("x-dev-session-secret")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return Err(AppError::not_found("customer dev session is not available"));
    }
    let email = body.email.as_deref().unwrap_or("").trim();
    let phone = body.phone.as_deref().unwrap_or("").trim();
    Ok(Json(ApiResponse::ok(
        service::issue_dev_session(
            &state.db,
            &state.settings,
            email,
            phone,
            body.tenant_id.trim(),
            body.branch_id.trim(),
            body.first_name.as_deref().unwrap_or("Dev"),
            body.last_name.as_deref().unwrap_or("Customer"),
            &body.device,
            header_text(&headers, header::USER_AGENT.as_str()),
            &ip_hash(&headers),
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

/// The guest's own account activity: sign-ins, new devices, rejected refreshes.
///
/// customer_security_events has existed since the portal shipped with nothing
/// writing to or reading from it. Showing a guest where their account has been
/// used is how an account takeover gets noticed by the only person who can
/// recognise it.
async fn security_events(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let rows = repo::security_events(&state.db, &claims.sub, 50)
        .await
        .map_err(|_| AppError::internal("failed to load customer security events"))?;
    Ok(Json(ApiResponse::ok(json!({ "events": rows }))))
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

async fn revoke_all_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let revoked = repo::revoke_all_sessions(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to revoke customer sessions"))?;
    Ok(Json(ApiResponse::ok(json!({"revoked":revoked}))))
}

async fn customer_rewards(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_rewards(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer rewards"))?,
    )))
}

async fn redeem_customer_rewards(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CustomerRewardRedeemRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    let points = i64::from(body.points);
    if points <= 0 || body.amount_paise <= 0 {
        return Err(AppError::validation(
            "points and amountPaise must be greater than zero",
        ));
    }
    let max_amount = points.saturating_mul(100);
    if body.amount_paise > max_amount {
        return Err(AppError::validation(
            "amountPaise exceeds the selected reward point value",
        ));
    }
    let idempotency_key = format!(
        "customer-loyalty:{}:{}",
        claims.sub,
        body.idempotency_key.trim()
    );
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start loyalty redemption"))?;
    let sale = sqlx::query_as::<_, (String, String, String, i64, i64, i64, String)>(
        "SELECT s.tenant_id,s.branch_id,s.client_id,s.total_paise,s.paid_paise,GREATEST(s.total_paise-s.paid_paise,0)::BIGINT,s.status FROM pos_sales s JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=s.tenant_id AND l.branch_id=s.branch_id AND l.client_id=s.client_id WHERE s.id=$2 FOR UPDATE",
    )
    .bind(&claims.sub)
    .bind(body.invoice_id.trim())
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to validate customer invoice"))?
    .ok_or_else(|| AppError::not_found("customer invoice was not found"))?;
    let (tenant_id, branch_id, client_id, total_paise, paid_paise, balance_paise, status) = sale;
    if matches!(status.as_str(), "paid" | "voided" | "cancelled") || balance_paise <= 0 {
        return Err(AppError::validation("customer invoice is not payable"));
    }
    if body.amount_paise > balance_paise {
        return Err(AppError::validation(
            "reward amount exceeds the payable invoice balance",
        ));
    }
    if let Some(existing) = sqlx::query_as::<_, (String, i32)>(
        "SELECT id,balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&idempotency_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to read loyalty redemption retry"))?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish loyalty retry"))?;
        return Ok(Json(ApiResponse::ok(json!({
            "redemptionId": existing.0,
            "invoiceId": body.invoice_id,
            "points": body.points,
            "amountPaise": body.amount_paise,
            "balanceAfterPoints": existing.1
        }))));
    }
    sqlx::query("SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&client_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to lock loyalty balance"))?;
    let current_points: i32 = sqlx::query_scalar(
        "SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&client_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to load loyalty balance"))?
    .unwrap_or(0);
    if points > i64::from(current_points) {
        return Err(AppError::validation(
            "reward points balance is insufficient",
        ));
    }
    let payment_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO pos_payments (id,tenant_id,branch_id,sale_id,method,amount_paise,method_reference,label,notes,idempotency_key,paid_at,created_at) VALUES ($1,$2,$3,$4,'store_credit',$5,$6,'Customer Loyalty','Customer portal loyalty redemption',$7,NOW(),NOW())")
        .bind(&payment_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(body.invoice_id.trim())
        .bind(body.amount_paise)
        .bind(format!("LOYALTY:{}", body.points))
        .bind(&idempotency_key)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to post loyalty payment"))?;
    let new_paid = paid_paise.saturating_add(body.amount_paise);
    let new_status = if new_paid >= total_paise {
        "paid"
    } else {
        "partially_paid"
    };
    sqlx::query("UPDATE pos_sales SET paid_paise=$4,status=$5,locked_at=CASE WHEN $5='paid' THEN COALESCE(locked_at,NOW()) ELSE locked_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(body.invoice_id.trim())
        .bind(new_paid)
        .bind(new_status)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to update loyalty payment status"))?;
    let balance_after = current_points.saturating_sub(body.points);
    let redemption_id: String = sqlx::query_scalar("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,source_sale_id,transaction_type,points,balance_after,note,idempotency_key) VALUES ($1,$2,$3,$4,'redeemed',$5,$6,'Customer portal loyalty redemption',$7) RETURNING id")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&client_id)
        .bind(body.invoice_id.trim())
        .bind(body.points)
        .bind(balance_after)
        .bind(&idempotency_key)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::conflict("loyalty has already been redeemed for this invoice"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit loyalty redemption"))?;
    Ok(Json(ApiResponse::ok(json!({
        "redemptionId": redemption_id,
        "invoiceId": body.invoice_id,
        "points": body.points,
        "amountPaise": body.amount_paise,
        "balanceAfterPoints": balance_after
    }))))
}

async fn customer_wallet(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_wallet(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer wallet"))?,
    )))
}

async fn customer_memberships(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_memberships(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer memberships"))?,
    )))
}

async fn purchase_customer_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MembershipPurchaseRequest>,
) -> ApiResult<pos::CustomerCommerceCheckout> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    let branch_id = body.branch_id.as_deref().unwrap_or("").trim();
    let plan = repo::membership_checkout_plan(&state.db, body.plan_id.trim(), branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership plan"))?
        .ok_or_else(|| AppError::not_found("active membership plan was not found"))?;
    let account = repo::account(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer account"))?
        .ok_or_else(|| AppError::unauthenticated("customer account is not active"))?;
    let client_id = repo::ensure_client_link(&state.db, &account, &plan.tenant_id, &plan.branch_id)
        .await
        .map_err(|_| AppError::internal("failed to link customer to membership branch"))?;
    let line = pos::customer_membership_checkout_line(
        &state,
        &plan.tenant_id,
        &plan.branch_id,
        plan.id,
        plan.name,
        plan.price_paise,
    )
    .await?;
    let checkout = pos::create_customer_commerce_checkout(
        &state,
        &plan.tenant_id,
        &plan.branch_id,
        &client_id,
        "customer_membership_purchase",
        &body.idempotency_key,
        line,
        None,
    )
    .await?;
    Ok(Json(ApiResponse::ok(checkout)))
}

async fn freeze_customer_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MembershipFreezeRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let membership = owned_customer_membership(&state, &claims.sub, &id).await?;
    let reason = clean_optional(body.reason.as_deref(), 500, "reason")?;
    let changed = membership_lifecycle_repo::freeze(
        &state.db,
        &membership.tenant_id,
        &membership.branch_id,
        &id,
        body.days,
        if reason.is_empty() {
            "customer requested freeze"
        } else {
            reason.as_str()
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to freeze customer membership"))?;
    if !changed {
        return Err(AppError::validation(
            "membership cannot be frozen; choose 1-366 days and an active non-frozen membership",
        ));
    }
    Ok(Json(ApiResponse::ok(json!({
        "id": id,
        "status": "frozen",
        "days": body.days
    }))))
}

async fn resume_customer_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let membership = owned_customer_membership(&state, &claims.sub, &id).await?;
    let changed = membership_lifecycle_repo::resume(
        &state.db,
        &membership.tenant_id,
        &membership.branch_id,
        &id,
    )
    .await
    .map_err(|_| AppError::internal("failed to resume customer membership"))?;
    if !changed {
        return Err(AppError::validation(
            "membership cannot be resumed because it is not currently frozen",
        ));
    }
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":"active"}))))
}

async fn cancel_customer_membership(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MembershipCancelRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let membership = owned_customer_membership(&state, &claims.sub, &id).await?;
    let reason = clean_optional(body.reason.as_deref(), 500, "reason")?;
    let reason = if reason.is_empty() {
        "customer requested cancellation"
    } else {
        reason.as_str()
    };
    let changed = membership_lifecycle_repo::cancel(
        &state.db,
        &membership.tenant_id,
        &membership.branch_id,
        &id,
        &reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to cancel customer membership"))?;
    if !changed {
        return Err(AppError::validation(
            "membership cannot be cancelled because it is not active",
        ));
    }
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":"cancelled"}))))
}

async fn update_customer_membership_auto_renew(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<MembershipAutoRenewRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let membership = owned_customer_membership(&state, &claims.sub, &id).await?;
    let requested_status = body
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| {
            if body.enabled.unwrap_or(false) {
                "active".to_string()
            } else {
                "disabled".to_string()
            }
        });
    let status = clean_choice(
        &requested_status,
        &["active", "paused", "disabled"],
        "status",
    )?;
    let changed = membership_lifecycle_repo::set_auto_renew_status(
        &state.db,
        &membership.tenant_id,
        &membership.branch_id,
        &id,
        &status,
    )
    .await
    .map_err(|_| AppError::internal("failed to update membership auto-renew"))?;
    if !changed {
        return Err(AppError::validation(
            "auto-renew could not be updated; active status requires a saved recurring payment mandate",
        ));
    }
    Ok(Json(ApiResponse::ok(json!({
        "id": id,
        "autoRenewStatus": status,
        "autoRenew": status != "disabled"
    }))))
}

async fn customer_packages(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_packages(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer packages"))?,
    )))
}

async fn purchase_customer_package(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PackagePurchaseRequest>,
) -> ApiResult<pos::CustomerCommerceCheckout> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    let branch_id = body.branch_id.as_deref().unwrap_or("").trim();
    let package = repo::package_checkout_plan(&state.db, body.package_id.trim(), branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load package plan"))?
        .ok_or_else(|| AppError::not_found("active package plan was not found"))?;
    let account = repo::account(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer account"))?
        .ok_or_else(|| AppError::unauthenticated("customer account is not active"))?;
    let client_id =
        repo::ensure_client_link(&state.db, &account, &package.tenant_id, &package.branch_id)
            .await
            .map_err(|_| AppError::internal("failed to link customer to package branch"))?;
    let checkout = pos::create_customer_commerce_checkout(
        &state,
        &package.tenant_id,
        &package.branch_id,
        &client_id,
        "customer_package_purchase",
        &body.idempotency_key,
        pos::customer_package_checkout_line(package.id, package.name, package.price_paise),
        None,
    )
    .await?;
    Ok(Json(ApiResponse::ok(checkout)))
}

async fn purchase_customer_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ProductPurchaseRequest>,
) -> ApiResult<pos::CustomerCommerceCheckout> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    if !(1..=20).contains(&body.quantity) {
        return Err(AppError::validation("quantity must be between 1 and 20"));
    }
    let coupon_code = clean_optional(body.coupon_code.as_deref(), 80, "couponCode")?;
    let product =
        repo::product_checkout_plan(&state.db, body.product_id.trim(), body.branch_id.trim())
            .await
            .map_err(|_| AppError::internal("failed to load Webstore product"))?
            .ok_or_else(|| AppError::not_found("available Webstore product was not found"))?;
    if i64::from(product.stock_quantity) < body.quantity {
        return Err(AppError::conflict(
            "requested product quantity is not available",
        ));
    }
    if pos::configured_customer_payment_provider(&state, &product.tenant_id, &product.branch_id)
        .await?
        .is_none()
    {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "online product checkout is not configured for this location",
        ));
    }
    let account = repo::account(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer account"))?
        .ok_or_else(|| AppError::unauthenticated("customer account is not active"))?;
    let client_id =
        repo::ensure_client_link(&state.db, &account, &product.tenant_id, &product.branch_id)
            .await
            .map_err(|_| AppError::internal("failed to link customer to product branch"))?;
    let checkout = pos::create_customer_commerce_checkout(
        &state,
        &product.tenant_id,
        &product.branch_id,
        &client_id,
        "customer_product_purchase",
        &body.idempotency_key,
        pos::customer_product_checkout_line(
            product.id,
            product.name,
            body.quantity,
            product.price_paise,
            product.gst_percent,
            product.hsn_code,
        ),
        (!coupon_code.is_empty()).then_some(coupon_code.as_str()),
    )
    .await?;
    Ok(Json(ApiResponse::ok(checkout)))
}

async fn customer_gift_cards(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_gift_cards(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer gift cards"))?,
    )))
}

async fn purchase_customer_gift_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GiftCardPurchaseRequest>,
) -> ApiResult<pos::CustomerCommerceCheckout> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    if body.amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    let context =
        customer_branch_context(&state, &claims.sub, body.branch_id.as_deref().unwrap_or(""))
            .await?;
    let checkout = pos::create_customer_commerce_checkout(
        &state,
        &context.tenant_id,
        &context.branch_id,
        &context.client_id,
        "customer_gift_card_purchase",
        &body.idempotency_key,
        pos::customer_gift_card_checkout_line(body.amount_paise),
        None,
    )
    .await?;
    Ok(Json(ApiResponse::ok(checkout)))
}

async fn claim_customer_gift_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GiftCardClaimRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let code = clean_required(&body.code, 80, "code")?;
    let context =
        customer_branch_context(&state, &claims.sub, body.branch_id.as_deref().unwrap_or(""))
            .await?;
    let card = repo::claim_gift_card(&state.db, &context, &code)
        .await
        .map_err(|_| AppError::internal("failed to claim customer gift card"))?
        .ok_or_else(|| AppError::not_found("active unclaimed gift card was not found"))?;
    Ok(Json(ApiResponse::ok(card)))
}

async fn customer_invoice_payment_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerInvoicePaymentLinkRequest>,
) -> ApiResult<pos::PosPaymentLinkResponse> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    let invoice = repo::owned_invoice(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer invoice"))?
        .ok_or_else(|| AppError::not_found("customer invoice was not found"))?;
    if invoice.balance_paise <= 0
        || matches!(invoice.status.as_str(), "paid" | "voided" | "cancelled")
    {
        return Err(AppError::validation("customer invoice is not payable"));
    }
    let provider = match body.provider {
        Some(provider) => Some(provider),
        None => pos::configured_customer_payment_provider(
            &state,
            &invoice.tenant_id,
            &invoice.branch_id,
        )
        .await?
        .map(str::to_string),
    };
    if provider.is_none() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "an online payment provider and signed webhook must be configured",
        ));
    }
    let link = pos::create_payment_link_for_invoice(
        &state,
        &invoice.tenant_id,
        &invoice.branch_id,
        &id,
        pos::PosPaymentLinkRequest {
            provider,
            amount_paise: body.amount_paise,
            expires_at: None,
            idempotency_key: Some(format!(
                "customer-invoice:{}:{}",
                claims.sub,
                body.idempotency_key.trim()
            )),
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(link)))
}

async fn redeem_customer_gift_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CustomerGiftCardRedeemRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    if body.amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    let invoice = repo::owned_invoice(&state.db, &claims.sub, body.invoice_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to validate customer invoice"))?
        .ok_or_else(|| AppError::not_found("customer invoice was not found"))?;
    if invoice.balance_paise < body.amount_paise
        || matches!(invoice.status.as_str(), "paid" | "voided" | "cancelled")
    {
        return Err(AppError::validation(
            "gift card amount exceeds the payable invoice balance",
        ));
    }
    let card = repo::owned_gift_card(
        &state.db,
        &claims.sub,
        &invoice.tenant_id,
        &invoice.branch_id,
        &body.code,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate customer gift card"))?
    .ok_or_else(|| AppError::not_found("customer gift card was not found"))?;
    if card.status != "active" || card.balance_paise < body.amount_paise {
        return Err(AppError::conflict(
            "gift card is not active or has insufficient balance",
        ));
    }
    let payment_key = format!(
        "customer-gift-card:{}:{}",
        claims.sub,
        body.idempotency_key.trim()
    );
    let _ = pos::add_pos_payment(
        State(state.clone()),
        tenant_branch_headers(&invoice.tenant_id, &invoice.branch_id)?,
        Path(body.invoice_id.clone()),
        Json(pos::PosPaymentInput {
            method: Some("gift_card".to_string()),
            amount_paise: Some(body.amount_paise),
            method_reference: Some(body.code.trim().to_ascii_uppercase()),
            label: Some("Customer Gift Card".to_string()),
            notes: Some("Customer portal gift card redemption".to_string()),
            idempotency_key: Some(payment_key),
            ..pos::PosPaymentInput::default()
        }),
    )
    .await?;
    let updated = repo::owned_gift_card(
        &state.db,
        &claims.sub,
        &invoice.tenant_id,
        &invoice.branch_id,
        &body.code,
    )
    .await
    .map_err(|_| AppError::internal("failed to reload customer gift card"))?
    .ok_or_else(|| AppError::not_found("customer gift card was not found"))?;
    Ok(Json(ApiResponse::ok(json!({
        "giftCardId": card.id,
        "invoiceId": body.invoice_id,
        "amountPaise": body.amount_paise,
        "balanceAfterPaise": updated.balance_paise
    }))))
}

async fn customer_invoices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_invoices(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer invoices"))?,
    )))
}

async fn customer_payments(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_payments(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer payments"))?,
    )))
}

async fn customer_payment_methods(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_payment_methods(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer payment methods"))?,
    )))
}

async fn customer_refunds(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_refunds(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer refunds"))?,
    )))
}

async fn customer_notifications(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_notifications(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer notifications"))?,
    )))
}

async fn customer_push_proof(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let notifications = repo::account_notifications(&state.db, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load notification proof"))?;
    let payment_providers: Vec<Value> = crate::config::PAYMENT_PROVIDERS
        .iter()
        .map(|provider| {
            json!({
                "provider": provider,
                "enabled": state.settings.payment_provider_enabled(provider),
                "webhookConfigured": state.settings.payment_provider_webhook_configured(provider)
            })
        })
        .collect();
    Ok(Json(ApiResponse::ok(json!({
        "mobilePushProviderConfigured": state.settings.mobile_push_provider_enabled(),
        "latestCustomerNotifications": notifications.len(),
        "paymentProviderEnvironment": state.settings.payment_provider_environment.clone(),
        "paymentProviders": payment_providers,
        "proofLevel": if state.settings.mobile_push_provider_enabled() { "provider_configured" } else { "database_only" },
        "note": "Delivery proof requires provider credentials, webhook delivery logs, and device registration in runtime."
    }))))
}

async fn customer_support_tickets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_support_tickets(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer support tickets"))?,
    )))
}

async fn customer_support_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::support_messages(&state.db, &claims.sub, &id)
            .await
            .map_err(|_| AppError::internal("failed to load customer support messages"))?,
    )))
}

async fn create_customer_support_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CustomerSupportTicketRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let context =
        customer_branch_context(&state, &claims.sub, branch_request(&body.branch_id)).await?;
    let subject = clean_required(&body.subject, 160, "subject")?;
    let message = clean_optional(body.body.as_deref(), 4000, "body")?;
    let category = clean_choice(
        body.category.as_deref().unwrap_or("other"),
        &["booking", "payment", "service", "account", "other"],
        "category",
    )?;
    let priority = clean_choice(
        body.priority.as_deref().unwrap_or("normal"),
        &["normal", "urgent"],
        "priority",
    )?;
    let booking_id = body.booking_id.as_deref().unwrap_or("").trim();
    if !booking_id.is_empty() {
        let owned = repo::owned_booking(&state.db, &claims.sub, booking_id)
            .await
            .map_err(|_| AppError::internal("failed to validate customer booking"))?
            .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
        if owned.tenant_id != context.tenant_id || owned.branch_id != context.branch_id {
            return Err(AppError::validation(
                "bookingId must belong to the selected branch",
            ));
        }
    }
    Ok(Json(ApiResponse::ok(
        repo::create_support_ticket(
            &state.db,
            &claims.sub,
            &context,
            &subject,
            &category,
            &priority,
            booking_id,
            &message,
        )
        .await
        .map_err(|_| AppError::internal("failed to create customer support ticket"))?,
    )))
}

async fn add_customer_support_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerSupportMessageRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let message = clean_required(&body.body, 4000, "body")?;
    let saved = repo::add_support_message(&state.db, &claims.sub, &id, &message)
        .await
        .map_err(|_| AppError::internal("failed to add customer support message"))?
        .ok_or_else(|| AppError::not_found("open customer support ticket was not found"))?;
    Ok(Json(ApiResponse::ok(saved)))
}

async fn customer_referrals(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_referrals(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer referrals"))?,
    )))
}

async fn customer_offers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_recovery_offers(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer offers"))?,
    )))
}

async fn create_customer_referral_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CustomerBranchRequest>,
) -> ApiResult<crate::repositories::retention_repository::ReferralCodeRecord> {
    let claims = active_customer_claims(&state, &headers).await?;
    let context =
        customer_branch_context(&state, &claims.sub, branch_request(&body.branch_id)).await?;
    Ok(Json(ApiResponse::ok(
        retention_service::ensure_referral_code(
            &state.db,
            &context.tenant_id,
            &context.branch_id,
            &context.client_id,
            "customer_portal",
        )
        .await?,
    )))
}

async fn customer_family(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_family(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer family profiles"))?,
    )))
}

async fn create_customer_family_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CustomerFamilyMemberRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let context =
        customer_branch_context(&state, &claims.sub, branch_request(&body.branch_id)).await?;
    let first_name = clean_required(&body.first_name, 80, "firstName")?;
    let last_name = clean_optional(body.last_name.as_deref(), 80, "lastName")?;
    let phone = clean_optional(body.phone.as_deref(), 32, "phone")?;
    let relationship_type = clean_choice(
        body.relationship_type.as_deref().unwrap_or("other"),
        &[
            "spouse",
            "parent",
            "child",
            "sibling",
            "guardian",
            "dependent",
            "partner",
            "other",
        ],
        "relationshipType",
    )?;
    let member = repo::create_family_member(
        &state.db,
        &claims.sub,
        &context,
        &first_name,
        &last_name,
        &phone,
        &relationship_type,
    )
    .await
    .map_err(|_| AppError::internal("failed to save customer family profile"))?;
    Ok(Json(ApiResponse::ok(member)))
}

async fn customer_corporate(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_corporate(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer corporate benefits"))?,
    )))
}

async fn customer_gallery(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_gallery(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer gallery"))?,
    )))
}

async fn customer_goals(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_goals(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer goals"))?,
    )))
}

async fn create_customer_goal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CustomerGoalRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let context =
        customer_branch_context(&state, &claims.sub, branch_request(&body.branch_id)).await?;
    let title = clean_required(&body.title, 160, "title")?;
    let notes = clean_optional(body.notes.as_deref(), 2000, "notes")?;
    let goal_type = clean_choice(
        body.goal_type.as_deref().unwrap_or("other"),
        &["hair", "skin", "wellness", "event", "other"],
        "goalType",
    )?;
    Ok(Json(ApiResponse::ok(
        repo::create_goal(
            &state.db,
            &claims.sub,
            &context,
            &title,
            &goal_type,
            body.target_date,
            &notes,
        )
        .await
        .map_err(|_| AppError::internal("failed to create customer goal"))?,
    )))
}

async fn customer_favorites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        repo::account_favorites(&state.db, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load customer favorites"))?,
    )))
}

async fn add_customer_favorite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let business = repo::business(&state.db, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate marketplace business"))?
        .ok_or_else(|| AppError::not_found("marketplace business was not found"))?;
    let tenant_id = business
        .get("tenantId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::internal("marketplace business scope is invalid"))?;
    Ok(Json(ApiResponse::ok(
        repo::add_account_favorite(&state.db, &claims.sub, tenant_id, &branch_id)
            .await
            .map_err(|_| AppError::internal("failed to save customer favorite"))?,
    )))
}

async fn remove_customer_favorite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let removed = repo::remove_account_favorite(&state.db, &claims.sub, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to remove customer favorite"))?;
    Ok(Json(ApiResponse::ok(json!({"removed":removed}))))
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
    let mut rows = repo::businesses(
        &state.db,
        query.q.as_deref().unwrap_or("").trim(),
        query.category.as_deref().unwrap_or("").trim(),
        query.limit.unwrap_or(48).clamp(1, 100),
    )
    .await
    .map_err(|_| AppError::internal("failed to search marketplace businesses"))?;
    for row in &mut rows {
        decorate_marketplace_payment_modes(&state, row);
    }
    Ok(Json(ApiResponse::ok(rows)))
}
async fn categories(State(state): State<AppState>) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::categories(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to load marketplace categories"))?,
    )))
}

async fn marketplace_offers(
    State(state): State<AppState>,
    Query(query): Query<MarketplaceOffersQuery>,
) -> ApiResult<Vec<Value>> {
    let branch_id = query.branch_id.as_deref().unwrap_or("").trim();
    if branch_id.len() > 120 {
        return Err(AppError::validation("branchId is invalid"));
    }
    let rows = repo::marketplace_offers(&state.db, branch_id, "")
        .await
        .map_err(|_| AppError::internal("failed to load marketplace offers"))?;
    let offer_ids = rows
        .iter()
        .filter_map(|offer| offer.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    if !offer_ids.is_empty() {
        sqlx::query("INSERT INTO marketing_offer_events(tenant_id,branch_id,offer_id,event_type,channel) SELECT tenant_id,branch_id,id,'view','customer_app' FROM pos_coupons WHERE id=ANY($1)")
            .bind(&offer_ids).execute(&state.db).await
            .map_err(|_| AppError::internal("failed to track customer offer views"))?;
    }
    Ok(Json(ApiResponse::ok(rows)))
}

async fn marketplace_offer_event(
    State(state): State<AppState>,
    Json(body): Json<MarketplaceOfferEventRequest>,
) -> ApiResult<Value> {
    record_marketing_offer_click(&state, &body, "").await
}

async fn record_marketing_offer_click(
    state: &AppState,
    body: &MarketplaceOfferEventRequest,
    account_id: &str,
) -> ApiResult<Value> {
    let channel = body.channel.trim().to_ascii_lowercase();
    if body.offer_id.trim().is_empty()
        || body.offer_id.trim().len() > 120
        || !matches!(channel.as_str(), "customer_app" | "instagram" | "whatsapp")
    {
        return Err(AppError::validation("offer event is invalid"));
    }
    let recorded = sqlx::query_scalar::<_, String>(r#"INSERT INTO marketing_offer_events(tenant_id,branch_id,offer_id,event_type,channel)
      SELECT tenant_id,branch_id,id,'click',$2 FROM pos_coupons
      WHERE id=$1 AND active=TRUE AND approval_status='approved' AND show_in_customer_app=TRUE
        AND (target_client_id IS NULL OR ($3<>'' AND EXISTS(SELECT 1 FROM customer_account_clients link
          WHERE link.account_id=$3 AND link.tenant_id=pos_coupons.tenant_id AND link.branch_id=pos_coupons.branch_id AND link.client_id=pos_coupons.target_client_id)))
        AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW()) RETURNING id"#)
        .bind(body.offer_id.trim()).bind(&channel).bind(account_id).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to track offer click"))?
        .ok_or_else(|| AppError::not_found("active offer was not found"))?;
    Ok(Json(ApiResponse::ok(
        json!({"recorded":!recorded.is_empty()}),
    )))
}

async fn marketplace_offer_creative(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let row = repo::marketplace_offer_creative(&state.db, id.trim(), "")
        .await
        .map_err(|_| AppError::internal("failed to load marketplace offer creative"))?
        .ok_or_else(|| AppError::not_found("offer creative was not found"))?;
    Response::builder()
        .header(header::CONTENT_TYPE, row.0)
        .header(header::CACHE_CONTROL, "public, max-age=300")
        .body(Body::from(row.1))
        .map_err(|_| AppError::internal("failed to stream marketplace offer creative"))
}

async fn customer_marketing_offers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MarketplaceOffersQuery>,
) -> ApiResult<Vec<Value>> {
    let claims = active_customer_claims(&state, &headers).await?;
    let branch_id = query.branch_id.as_deref().unwrap_or("").trim();
    if branch_id.len() > 120 {
        return Err(AppError::validation("branchId is invalid"));
    }
    let rows = repo::marketplace_offers(&state.db, branch_id, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer offers"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn customer_marketing_offer_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MarketplaceOfferEventRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    record_marketing_offer_click(&state, &body, &claims.sub).await
}

async fn customer_marketing_offer_creative(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    let claims = active_customer_claims(&state, &headers).await?;
    let row = repo::marketplace_offer_creative(&state.db, id.trim(), &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load customer offer creative"))?
        .ok_or_else(|| AppError::not_found("offer creative was not found"))?;
    Response::builder()
        .header(header::CONTENT_TYPE, row.0)
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(row.1))
        .map_err(|_| AppError::internal("failed to stream customer offer creative"))
}
async fn business(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Value> {
    let mut profile = repo::business(&state.db, &id)
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
    let products = repo::business_products(&state.db, &id)
        .await
        .map_err(|_| AppError::internal("failed to load Webstore products"))?;
    decorate_marketplace_payment_modes(&state, &mut profile);
    if let Some(object) = profile.as_object_mut() {
        object.insert("services".to_string(), json!(services));
        object.insert("staff".to_string(), json!(staff));
        object.insert("reviews".to_string(), json!(reviews));
        object.insert("membershipPlans".to_string(), json!(memberships));
        object.insert("products".to_string(), json!(products));
    }
    Ok(Json(ApiResponse::ok(profile)))
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

async fn business_packages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::business_packages(&state.db, &id)
            .await
            .map_err(|_| AppError::internal("failed to load package plans"))?,
    )))
}

async fn business_products(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    Ok(Json(ApiResponse::ok(
        repo::business_products(&state.db, &id)
            .await
            .map_err(|_| AppError::internal("failed to load Webstore products"))?,
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

async fn customer_booking(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let booking = repo::account_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to load customer booking"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    Ok(Json(ApiResponse::ok(booking)))
}

async fn create_customer_booking(
    State(state): State<AppState>,
    mut headers: HeaderMap,
    Json(body): Json<BookingRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let payment_mode = body.payment_mode.trim().to_ascii_lowercase();
    if !matches!(payment_mode.as_str(), "pay_at_venue" | "online") {
        return Err(appointments::ApiError::bad_request(
            "paymentMode must be pay_at_venue or online",
        ));
    }
    if body.tenant_id.trim().is_empty()
        || body.branch_id.trim().is_empty()
        || body.service_ids.is_empty()
    {
        return Err(appointments::ApiError::bad_request(
            "tenantId, branchId and serviceIds are required",
        ));
    }
    let business = repo::business(&state.db, &body.branch_id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate marketplace business"))?
        .ok_or_else(|| appointments::ApiError::not_found("marketplace business was not found"))?;
    let public_tenant_id = business
        .get("tenantId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let booking_tenant_id = business
        .get("tenantSlug")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(public_tenant_id);
    let public_branch_id = business
        .get("branchId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let booking_branch_id = business
        .get("branchCode")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| business.get("branchName").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(public_branch_id);
    if public_tenant_id != body.tenant_id.trim() && booking_tenant_id != body.tenant_id.trim() {
        return Err(appointments::ApiError::bad_request(
            "branch does not belong to the selected tenant",
        ));
    }
    if payment_mode == "online" {
        let deposit_percent = business
            .get("bookingDepositPercent")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        if deposit_percent <= 0 || !state.settings.razorpay_payment_links_enabled() {
            return Err(appointments::ApiError::bad_request(
                "online deposit is not available for this branch",
            ));
        }
        if !body.card_guarantee_accepted {
            return Err(appointments::ApiError::bad_request(
                "cardGuaranteeAccepted is required for online deposit bookings",
            ));
        }
    }
    let requested_client_id = body.client_id.as_deref().unwrap_or("").trim();
    let client_id = if requested_client_id.is_empty() {
        service::ensure_client_link(&state.db, &claims.sub, booking_tenant_id, booking_branch_id)
            .await
            .map_err(|_| {
                appointments::ApiError::internal("failed to link customer booking profile")
            })?
    } else {
        repo::customer_booking_client_id(
            &state.db,
            &claims.sub,
            booking_tenant_id,
            booking_branch_id,
            requested_client_id,
        )
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate family booking profile"))?
        .ok_or_else(|| {
            appointments::ApiError::bad_request("customer profile is not available for booking")
        })?
    };
    let service_ids = body.service_ids.clone();
    let booking_source = if let Some(source) = body
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let parts = source.split(':').collect::<Vec<_>>();
        if parts.len() != 3
            || parts[0] != "marketing_offer"
            || !matches!(parts[2], "customer_app" | "instagram" | "whatsapp")
        {
            return Err(appointments::ApiError::bad_request(
                "booking source is invalid",
            ));
        }
        let offer_code = body.offer_code.as_deref().unwrap_or("").trim();
        if offer_code.len() > 120 {
            return Err(appointments::ApiError::bad_request("offerCode is invalid"));
        }
        let valid = sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM pos_coupons offer
          WHERE offer.tenant_id=$1 AND offer.branch_id=$2 AND offer.id=$3
            AND offer.active=TRUE AND offer.approval_status='approved' AND offer.show_in_customer_app=TRUE
            AND (offer.target_client_id IS NULL OR EXISTS(SELECT 1 FROM customer_account_clients link
              WHERE link.account_id=$6 AND link.tenant_id=offer.tenant_id AND link.branch_id=offer.branch_id AND link.client_id=offer.target_client_id))
            AND (offer.starts_at IS NULL OR offer.starts_at<=NOW()) AND (offer.ends_at IS NULL OR offer.ends_at>=NOW())
            AND (CARDINALITY(offer.target_service_ids)=0 OR offer.target_service_ids && $4)
            AND ($5='' OR UPPER(offer.code)=UPPER($5)))"#)
            .bind(booking_tenant_id).bind(booking_branch_id).bind(parts[1]).bind(&service_ids).bind(offer_code).bind(&claims.sub)
            .fetch_one(&state.db).await
            .map_err(|_| appointments::ApiError::internal("failed to validate booking source"))?;
        if !valid {
            return Err(appointments::ApiError::bad_request(
                "offer is not applicable to this booking",
            ));
        }
        source.to_string()
    } else {
        "public-booking".to_string()
    };
    let rebook_from_booking_id = body
        .rebook_from_booking_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(source_booking_id) = rebook_from_booking_id {
        let source_booking = repo::account_booking(&state.db, &claims.sub, source_booking_id)
            .await
            .map_err(|_| appointments::ApiError::internal("failed to validate source rebooking"))?
            .ok_or_else(|| {
                appointments::ApiError::bad_request("source booking is not available")
            })?;
        if source_booking
            .get("tenantId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            != booking_tenant_id
            || source_booking
                .get("branchId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                != booking_branch_id
        {
            return Err(appointments::ApiError::bad_request(
                "source booking does not belong to this business",
            ));
        }
    }
    let package_credit_id = body.package_credit_id.clone().unwrap_or_default();
    if !package_credit_id.trim().is_empty() {
        validate_customer_package_credit_booking(
            &state,
            booking_tenant_id,
            booking_branch_id,
            &client_id,
            &service_ids,
            &package_credit_id,
        )
        .await?;
    }
    if !body.additional_client_ids.is_empty() {
        if !package_credit_id.trim().is_empty() {
            return Err(appointments::ApiError::bad_request(
                "package credit cannot be shared across a group booking",
            ));
        }
        return create_customer_group_booking(
            &state,
            headers,
            &claims.sub,
            booking_tenant_id,
            booking_branch_id,
            &client_id,
            &booking_source,
            &payment_mode,
            &body,
        )
        .await;
    }
    let token = appointments::issue_public_booking_token(
        &state,
        booking_tenant_id,
        booking_branch_id,
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
    let Json(appointment) = appointments::create_appointment(
        State(state.clone()),
        headers,
        Json(appointments::AppointmentCreatePayload {
            tenant_id: Some(booking_tenant_id.to_string()),
            branch_id: Some(booking_branch_id.to_string()),
            requested_staff_id: body.staff_id.clone().unwrap_or_default(),
            staff_preference: "preferred".to_string(),
            staff_id: body.staff_id.unwrap_or_default(),
            client_id,
            service_ids,
            start_at: body.start_at,
            end_at: body.end_at,
            notes: body.notes.unwrap_or_default(),
            status: "booked".to_string(),
            booking_group_id: String::new(),
            source_channel: Some("customer-app".to_string()),
            source: Some(
                rebook_from_booking_id
                    .map(|id| format!("public-booking:rebook:{id}"))
                    .unwrap_or(booking_source),
            ),
            chair_room_id: String::new(),
            service_selections: body.service_selections,
        }),
    )
    .await?;
    if !package_credit_id.trim().is_empty() {
        sqlx::query("INSERT INTO appointment_package_reservations (tenant_id,branch_id,appointment_id,client_package_credit_id,quantity,status) VALUES ($1,$2,$3,$4,1,'reserved')")
            .bind(&appointment.tenant_id)
            .bind(&appointment.branch_id)
            .bind(&appointment.id)
            .bind(package_credit_id.trim())
            .execute(&state.db)
            .await
            .map_err(|_| appointments::ApiError::internal("failed to reserve package credit"))?;
    }
    if payment_mode == "online" {
        let owned = repo::OwnedBooking {
            tenant_id: appointment.tenant_id.clone(),
            branch_id: appointment.branch_id.clone(),
            client_id: appointment.client_id.clone(),
        };
        let _ = create_owned_booking_payment_link(
            &state,
            HeaderMap::new(),
            &claims.sub,
            &appointment.id,
            &owned,
        )
        .await;
    }
    let booking = repo::account_booking(&state.db, &claims.sub, &appointment.id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to load created customer booking"))?
        .ok_or_else(|| {
            appointments::ApiError::internal("created customer booking was not found")
        })?;
    Ok(Json(json!({"success":true,"data":booking})))
}

#[allow(clippy::too_many_arguments)]
async fn create_customer_group_booking(
    state: &AppState,
    mut headers: HeaderMap,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
    primary_client_id: &str,
    source: &str,
    payment_mode: &str,
    body: &BookingRequest,
) -> Result<Json<Value>, appointments::ApiError> {
    if body.service_ids.len() != 1 {
        return Err(appointments::ApiError::bad_request(
            "couple and group Webstore bookings require one service per participant",
        ));
    }
    let mut client_ids = vec![primary_client_id.to_string()];
    for requested in &body.additional_client_ids {
        let client_id = repo::customer_booking_client_id(
            &state.db,
            account_id,
            tenant_id,
            branch_id,
            requested.trim(),
        )
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate group profile"))?
        .ok_or_else(|| {
            appointments::ApiError::bad_request("group profile is not available for booking")
        })?;
        if client_ids.iter().any(|existing| existing == &client_id) {
            return Err(appointments::ApiError::bad_request(
                "group booking profiles must be unique",
            ));
        }
        client_ids.push(client_id);
    }
    if !(2..=6).contains(&client_ids.len()) {
        return Err(appointments::ApiError::bad_request(
            "couple/group booking requires two to six guests",
        ));
    }
    let start_at = DateTime::parse_from_rfc3339(&body.start_at)
        .map_err(|_| appointments::ApiError::bad_request("startAt must be RFC3339"))?
        .with_timezone(&Utc);
    let end_at = DateTime::parse_from_rfc3339(&body.end_at)
        .map_err(|_| appointments::ApiError::bad_request("endAt must be RFC3339"))?
        .with_timezone(&Utc);
    let service_id = body.service_ids[0].trim();
    let candidate_rows = sqlx::query(
        "SELECT staff.id FROM staff WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE AND (EXISTS(SELECT 1 FROM staff_service_assignments assignment WHERE assignment.tenant_id=$1 AND assignment.branch_id=$2 AND assignment.staff_id=staff.id AND assignment.service_id=$3) OR EXISTS(SELECT 1 FROM staff_catalog_assignments assignment WHERE assignment.tenant_id=$1 AND assignment.branch_id=$2 AND assignment.staff_id=staff.id AND assignment.item_type='service' AND assignment.item_id=$3)) ORDER BY CASE WHEN staff.id=$4 THEN 0 ELSE 1 END,staff.appointment_display_name,staff.first_name",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .bind(body.staff_id.as_deref().unwrap_or_default())
    .fetch_all(&state.db)
    .await
    .map_err(|_| appointments::ApiError::internal("failed to load group providers"))?;
    let candidates = candidate_rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .collect::<Vec<_>>();
    let mut used_staff: Vec<String> = Vec::new();
    for index in 0..client_ids.len() {
        let required = (index == 0)
            .then(|| body.staff_id.as_deref().unwrap_or_default().trim())
            .filter(|value| !value.is_empty());
        let mut selected = None;
        for staff_id in candidates.iter().filter(|candidate| {
            !used_staff.contains(candidate)
                && required.map_or(true, |required_id| candidate.as_str() == required_id)
        }) {
            match appointments::validate_staff_blackout(
                state, tenant_id, branch_id, staff_id, start_at, end_at,
            )
            .await
            {
                Ok(()) => {}
                Err(error) if error.status_code() == StatusCode::CONFLICT => continue,
                Err(error) => return Err(error),
            }
            match appointments::validate_staff_booking_availability(
                state,
                tenant_id,
                branch_id,
                staff_id,
                &body.service_ids,
                start_at,
                end_at,
                None,
            )
            .await
            {
                Ok(()) => {
                    selected = Some(staff_id.clone());
                    break;
                }
                Err(error) if error.status_code() == StatusCode::CONFLICT => continue,
                Err(error) => return Err(error),
            }
        }
        used_staff.push(selected.ok_or_else(|| {
            appointments::ApiError::conflict(
                "enough distinct providers are not available for this group slot",
            )
        })?);
    }
    let selection = body
        .service_selections
        .iter()
        .find(|selection| selection.service_id == service_id);
    let group_id = uuid::Uuid::new_v4().to_string();
    let lines = client_ids
        .iter()
        .zip(used_staff.iter())
        .enumerate()
        .map(
            |(index, (client_id, staff_id))| appointments::AppointmentBatchLinePayload {
                appointment_id: String::new(),
                expected_version: None,
                client_id: client_id.clone(),
                staff_id: staff_id.clone(),
                requested_staff_id: if index == 0 {
                    body.staff_id.clone().unwrap_or_default()
                } else {
                    String::new()
                },
                staff_preference: if index == 0
                    && body
                        .staff_id
                        .as_deref()
                        .is_some_and(|id| !id.trim().is_empty())
                {
                    "preferred".into()
                } else {
                    "first_available".into()
                },
                staff_change_approval: String::new(),
                staff_change_reason: String::new(),
                recommended_staff_id: String::new(),
                recommendation_override_reason: String::new(),
                service_id: service_id.to_string(),
                start_at: body.start_at.clone(),
                end_at: body.end_at.clone(),
                chair_room_id: String::new(),
                notes: body.notes.clone().unwrap_or_default(),
                variant_id: selection
                    .map(|value| value.variant_id.clone())
                    .unwrap_or_default(),
                addon_ids: selection
                    .map(|value| value.addon_ids.clone())
                    .unwrap_or_default(),
                price_override_paise: None,
                price_override_reason: String::new(),
                service_mode: String::new(),
                segment_label: String::new(),
                sequence_no: Some(index as i32 + 1),
            },
        )
        .collect();
    headers.insert(
        "x-tenant-id",
        HeaderValue::from_str(tenant_id)
            .map_err(|_| appointments::ApiError::bad_request("tenantId is invalid"))?,
    );
    headers.insert(
        "x-branch-id",
        HeaderValue::from_str(branch_id)
            .map_err(|_| appointments::ApiError::bad_request("branchId is invalid"))?,
    );
    let Json(created) = appointments::save_appointment_batch(
        State(state.clone()),
        headers,
        Json(appointments::AppointmentBatchPayload {
            client_id: primary_client_id.to_string(),
            status: "booked".into(),
            booking_group_id: group_id.clone(),
            removed_appointment_ids: Vec::new(),
            recurrence_count: None,
            recurrence_interval_days: None,
            lines,
            advance_payment: None,
            idempotency_key: body
                .idempotency_key
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            booking_type: if client_ids.len() == 2 {
                "couple"
            } else {
                "group"
            }
            .into(),
            day_package_id: String::new(),
            host_client_id: primary_client_id.to_string(),
            group_name: String::new(),
            group_notes: body.notes.clone().unwrap_or_default(),
            is_surprise: false,
            virtual_meeting_url: String::new(),
            outside_hours_override_reason: String::new(),
        }),
    )
    .await?;
    let appointment_ids = created
        .iter()
        .map(|appointment| appointment.id.clone())
        .collect::<Vec<_>>();
    sqlx::query("UPDATE appointments SET source_channel='customer-app',source=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND booking_group_id=$3")
        .bind(tenant_id).bind(branch_id).bind(&group_id).bind(source).execute(&state.db).await
        .map_err(|_| appointments::ApiError::internal("failed to preserve group booking source"))?;
    if payment_mode == "online" {
        for appointment in &created {
            let owned = repo::OwnedBooking {
                tenant_id: tenant_id.to_string(),
                branch_id: branch_id.to_string(),
                client_id: appointment.client_id.clone(),
            };
            create_owned_booking_payment_link(
                state,
                HeaderMap::new(),
                account_id,
                &appointment.id,
                &owned,
            )
            .await?;
        }
    }
    let mut booking = repo::account_booking(&state.db, account_id, &appointment_ids[0])
        .await
        .map_err(|_| appointments::ApiError::internal("failed to load created group booking"))?
        .ok_or_else(|| appointments::ApiError::internal("created group booking was not found"))?;
    if let Some(object) = booking.as_object_mut() {
        object.insert("groupBookingIds".into(), json!(appointment_ids));
        object.insert(
            "bookingType".into(),
            json!(if client_ids.len() == 2 {
                "couple"
            } else {
                "group"
            }),
        );
    }
    Ok(Json(json!({"success":true,"data":booking})))
}

async fn customer_booking_payment_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate customer booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    let payment =
        create_owned_booking_payment_link(&state, headers, &claims.sub, &id, &owned).await?;
    Ok(Json(json!({"success":true,"data":payment})))
}

async fn customer_booking_contactless(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let booking = repo::account_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to load contactless journey"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    Ok(Json(ApiResponse::ok(booking)))
}

async fn customer_booking_receipt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let claims = active_customer_claims(&state, &headers).await?;
    let receipt = repo::booking_receipt(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to load customer receipt"))?
        .ok_or_else(|| AppError::not_found("customer receipt was not found"))?;
    Ok(Html(render_customer_receipt_html(&receipt)).into_response())
}

fn customer_receipt_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn customer_receipt_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn customer_receipt_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn customer_receipt_money(paise: i64) -> String {
    format!("₹{}", paise / 100)
}

fn render_customer_receipt_html(receipt: &Value) -> String {
    let lines = receipt
        .get("lines")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|line| {
                    format!(
                        "<tr><td>{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td></tr>",
                        customer_receipt_escape(&customer_receipt_text(line, "itemName")),
                        customer_receipt_i64(line, "quantity"),
                        customer_receipt_money(customer_receipt_i64(line, "totalPaise"))
                    )
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|html| !html.is_empty())
        .unwrap_or_else(|| {
            "<tr><td colspan=\"3\" class=\"empty\">No line items</td></tr>".to_string()
        });
    let payments = receipt
        .get("payments")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|payment| {
                    format!(
                        "<tr><td>{}</td><td>{}</td><td class=\"num\">{}</td></tr>",
                        customer_receipt_escape(&customer_receipt_text(payment, "method")),
                        customer_receipt_escape(&customer_receipt_text(payment, "reference")),
                        customer_receipt_money(customer_receipt_i64(payment, "amountPaise"))
                    )
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|html| !html.is_empty())
        .unwrap_or_else(|| {
            "<tr><td colspan=\"3\" class=\"empty\">No payments yet</td></tr>".to_string()
        });
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>Receipt {invoice}</title>
<style>body{{margin:0;padding:24px;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif}}main{{max-width:760px;margin:auto;background:#fff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden}}header,section{{padding:22px 26px;border-bottom:1px solid #e5edf6}}h1,h2,p{{margin:0}}.muted{{color:#64748b}}.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}.box{{border:1px solid #e5edf6;border-radius:14px;padding:12px}}.label{{color:#64748b;font-size:11px;text-transform:uppercase;font-weight:700}}.value{{margin-top:6px;font-weight:700}}table{{width:100%;border-collapse:collapse}}th,td{{padding:12px;border-bottom:1px solid #e5edf6;text-align:left}}th{{font-size:11px;text-transform:uppercase;color:#475569;background:#f8fafc}}.num{{text-align:right}}.total{{font-size:18px;font-weight:700}}.empty{{text-align:center;color:#64748b}}</style></head>
<body><main><header><h1>AuraShine receipt</h1><p class="muted">{salon} · {invoice}</p></header>
<section class="grid"><div class="box"><div class="label">Booking</div><div class="value">{booking}</div></div><div class="box"><div class="label">Status</div><div class="value">{status}</div></div><div class="box"><div class="label">Appointment</div><div class="value">{start}</div></div></section>
<section><h2>Items</h2><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Total</th></tr></thead><tbody>{lines}</tbody></table></section>
<section><h2>Payments</h2><table><thead><tr><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>{payments}</tbody></table></section>
<section class="grid"><div class="box"><div class="label">Tip</div><div class="value">{tip}</div></div><div class="box"><div class="label">Paid</div><div class="value">{paid}</div></div><div class="box"><div class="label">Balance</div><div class="value total">{balance}</div></div></section></main></body></html>"#,
        invoice = customer_receipt_escape(&customer_receipt_text(receipt, "invoiceNumber")),
        salon = customer_receipt_escape(&customer_receipt_text(receipt, "businessName")),
        booking = customer_receipt_escape(&customer_receipt_text(receipt, "bookingId")),
        status = customer_receipt_escape(&customer_receipt_text(receipt, "status")),
        start = customer_receipt_escape(&customer_receipt_text(receipt, "startAt")),
        lines = lines,
        payments = payments,
        tip = customer_receipt_money(customer_receipt_i64(receipt, "tipPaise")),
        paid = customer_receipt_money(customer_receipt_i64(receipt, "paidPaise")),
        balance = customer_receipt_money(customer_receipt_i64(receipt, "balancePaise"))
    )
}

async fn submit_customer_booking_contactless_form(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerBookingContactlessRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer booking"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    if !body.consent_accepted {
        return Err(AppError::validation("consentAccepted is required"));
    }
    let signature_name = clean_required(
        body.signature_name.as_deref().unwrap_or(""),
        200,
        "signatureName",
    )?;
    if signature_name.chars().count() < 2 {
        return Err(AppError::validation("signatureName is required"));
    }
    let allergies = clean_optional(body.allergies.as_deref(), 5000, "allergies")?;
    let sensitivities = clean_optional(body.sensitivities.as_deref(), 2000, "sensitivities")?;
    let patch_test_notes =
        clean_optional(body.patch_test_notes.as_deref(), 2000, "patchTestNotes")?;
    let goals = clean_optional(body.goals.as_deref(), 2000, "goals")?;
    let budget = clean_optional(body.budget.as_deref(), 200, "budget")?;
    let timeframe = clean_optional(body.timeframe.as_deref(), 200, "timeframe")?;
    let preferences = clean_optional(body.preferences.as_deref(), 5000, "preferences")?;
    let pregnancy_context =
        clean_optional(body.pregnancy_context.as_deref(), 1000, "pregnancyContext")?;
    let responses = json!({
        "allergies": allergies,
        "sensitivities": sensitivities,
        "patchTestNotes": patch_test_notes,
        "goals": goals,
        "budget": budget,
        "timeframe": timeframe,
        "preferences": preferences,
        "pregnancyContext": pregnancy_context,
        "consentAccepted": body.consent_accepted
    });
    let fields = json!([
        {"key":"allergies","label":"Allergies","type":"text","required":false},
        {"key":"sensitivities","label":"Sensitivities","type":"text","required":false},
        {"key":"patchTestNotes","label":"Patch test context","type":"text","required":false},
        {"key":"goals","label":"Goals","type":"text","required":false},
        {"key":"budget","label":"Budget","type":"text","required":false},
        {"key":"timeframe","label":"Timeframe","type":"text","required":false},
        {"key":"preferences","label":"Preferences","type":"text","required":false},
        {"key":"pregnancyContext","label":"Pregnancy context","type":"text","required":false},
        {"key":"consentAccepted","label":"Consent accepted","type":"boolean","required":true}
    ]);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start contactless form transaction"))?;
    let definition_id: String = sqlx::query_scalar(
        "WITH existing AS (
            SELECT id FROM client_form_definitions
             WHERE tenant_id=$1 AND branch_id=$2 AND form_key='customer-contactless-consent' AND active=TRUE
             ORDER BY version DESC LIMIT 1
         ), inserted AS (
            INSERT INTO client_form_definitions (tenant_id,branch_id,form_key,name,form_type,version,body,fields_json,requires_signature,created_by)
            SELECT $1,$2,'customer-contactless-consent','Customer contactless consent','consent',1,'Customer contactless journey consent and safety context',$3::jsonb,TRUE,$4
            WHERE NOT EXISTS (SELECT 1 FROM existing)
            ON CONFLICT DO NOTHING
            RETURNING id
         )
         SELECT id FROM inserted UNION ALL SELECT id FROM existing LIMIT 1",
    )
    .bind(&owned.tenant_id)
    .bind(&owned.branch_id)
    .bind(&fields)
    .bind(&claims.sub)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to prepare customer consent form"))?;
    sqlx::query("INSERT INTO client_clinical_profiles (tenant_id,branch_id,client_id,allergies,preferences,updated_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,branch_id,client_id) DO UPDATE SET allergies=EXCLUDED.allergies,preferences=EXCLUDED.preferences,version=client_clinical_profiles.version+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()")
        .bind(&owned.tenant_id)
        .bind(&owned.branch_id)
        .bind(&owned.client_id)
        .bind(&allergies)
        .bind(&preferences)
        .bind(&claims.sub)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to save customer safety profile"))?;
    let signature_sha256 = auth_service::token_hash(&format!(
        "{}:{}:{}",
        owned.client_id, definition_id, signature_name
    ));
    let saved: Value = sqlx::query_scalar("INSERT INTO client_form_submissions (tenant_id,branch_id,client_id,definition_id,form_key,form_name,form_type,form_version,responses_json,signature_name,signature_sha256,signed_at,submitted_by) SELECT $1,$2,$3,d.id,d.form_key,d.name,d.form_type,d.version,$5::jsonb,$6,$7,NOW(),$8 FROM client_form_definitions d WHERE d.id=$4 RETURNING jsonb_build_object('id',id,'bookingId',$9,'definitionId',definition_id,'formKey',form_key,'formName',form_name,'submittedAt',submitted_at)")
        .bind(&owned.tenant_id)
        .bind(&owned.branch_id)
        .bind(&owned.client_id)
        .bind(&definition_id)
        .bind(&responses)
        .bind(&signature_name)
        .bind(&signature_sha256)
        .bind(&claims.sub)
        .bind(&id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to submit customer consent form"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to save customer contactless form"))?;
    Ok(Json(ApiResponse::ok(saved)))
}

async fn customer_booking_check_in(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerBookingCheckInRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer booking"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    if !(0..=240).contains(&body.eta_minutes) {
        return Err(AppError::validation("etaMinutes must be between 0 and 240"));
    }
    if let Some(key) = body.idempotency_key.as_deref() {
        validate_commerce_idempotency_key(key)?;
    }
    let distance = crate::services::kiosk_service::validate_customer_geofence(
        &state,
        &owned.tenant_id,
        &owned.branch_id,
        body.eta_minutes,
        body.latitude,
        body.longitude,
        body.accuracy_meters,
    )
    .await?;
    let appointment = sqlx::query("SELECT staff_id,start_at FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND client_id=$4")
        .bind(&owned.tenant_id)
        .bind(&owned.branch_id)
        .bind(&id)
        .bind(&owned.client_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load customer booking"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    let staff_id: String = appointment.try_get("staff_id").unwrap_or_default();
    let saved: Value = sqlx::query_scalar("INSERT INTO appointment_arrival_updates (tenant_id,branch_id,appointment_id,client_id,eta_minutes,status,source,distance_meters,idempotency_key) VALUES ($1,$2,$3,$4,$5,CASE WHEN $5=0 THEN 'arrived' ELSE 'arriving' END,'customer_app',$6,$7) ON CONFLICT (tenant_id,branch_id,appointment_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING jsonb_build_object('appointmentId',appointment_id,'etaMinutes',eta_minutes,'status',status,'distanceMeters',distance_meters,'updatedAt',updated_at)")
        .bind(&owned.tenant_id)
        .bind(&owned.branch_id)
        .bind(&id)
        .bind(&owned.client_id)
        .bind(body.eta_minutes)
        .bind(distance.map(|value| value.round() as i32))
        .bind(body.idempotency_key.as_deref())
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to save customer check-in"))?;
    if !staff_id.trim().is_empty() {
        sqlx::query("INSERT INTO staff_notification_queue (tenant_id,branch_id,requested_by,staff_id,channel,notification_type,recipient,title,message_body,sensitive,requires_approval,status,scheduled_at,metadata_json) SELECT $1,$2,'client',$3,'in_app','CLIENT_ARRIVAL_ETA','',$4,$5,FALSE,FALSE,'queued',NOW(),$6::jsonb WHERE EXISTS (SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)")
            .bind(&owned.tenant_id)
            .bind(&owned.branch_id)
            .bind(&staff_id)
            .bind("Client check-in")
            .bind(format!("Client ETA: {} minutes", body.eta_minutes))
            .bind(json!({"appointmentId":id,"clientId":owned.client_id,"etaMinutes":body.eta_minutes}).to_string())
            .execute(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to queue customer check-in alert"))?;
    }
    Ok(Json(ApiResponse::ok(saved)))
}

async fn customer_booking_self_pay_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerBookingSelfPayRequest>,
) -> ApiResult<pos::PosPaymentLinkResponse> {
    let claims = active_customer_claims(&state, &headers).await?;
    validate_commerce_idempotency_key(&body.idempotency_key)?;
    let invoice = repo::owned_booking_invoice(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer booking invoice"))?
        .ok_or_else(|| AppError::not_found("customer booking invoice was not found"))?;
    if invoice.balance_paise <= 0
        || matches!(invoice.status.as_str(), "paid" | "voided" | "cancelled")
    {
        return Err(AppError::validation(
            "customer booking invoice is not payable",
        ));
    }
    let provider = match body.provider {
        Some(provider) => Some(provider),
        None => pos::configured_customer_payment_provider(
            &state,
            &invoice.tenant_id,
            &invoice.branch_id,
        )
        .await?
        .map(str::to_string),
    };
    if provider.is_none() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "an online payment provider and signed webhook must be configured",
        ));
    }
    let link = pos::create_payment_link_for_invoice(
        &state,
        &invoice.tenant_id,
        &invoice.branch_id,
        &invoice.invoice_id,
        pos::PosPaymentLinkRequest {
            provider,
            amount_paise: body.amount_paise,
            expires_at: None,
            idempotency_key: Some(format!(
                "customer-booking-self-pay:{}:{}",
                claims.sub,
                body.idempotency_key.trim()
            )),
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(link)))
}

async fn open_customer_booking_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerBookingChatRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer booking"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    let message = clean_optional(body.body.as_deref(), 4000, "body")?;
    if let Some(ticket_id) = sqlx::query_scalar::<_, String>("SELECT id FROM customer_support_tickets WHERE account_id=$1 AND tenant_id=$2 AND branch_id=$3 AND booking_id=$4 AND status NOT IN ('resolved','closed') ORDER BY updated_at DESC LIMIT 1")
        .bind(&claims.sub)
        .bind(&owned.tenant_id)
        .bind(&owned.branch_id)
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load booking chat"))?
    {
        if message.is_empty() {
            return Ok(Json(ApiResponse::ok(json!({"id":ticket_id,"bookingId":id,"recordType":"supportTicket"}))));
        }
        let saved = repo::add_support_message(&state.db, &claims.sub, &ticket_id, &message)
            .await
            .map_err(|_| AppError::internal("failed to add booking chat message"))?
            .ok_or_else(|| AppError::not_found("open booking chat was not found"))?;
        return Ok(Json(ApiResponse::ok(saved)));
    }
    let context = repo::CustomerBranchContext {
        tenant_id: owned.tenant_id,
        branch_id: owned.branch_id,
        client_id: owned.client_id,
    };
    let ticket = repo::create_support_ticket(
        &state.db,
        &claims.sub,
        &context,
        "Booking chat",
        "booking",
        "normal",
        &id,
        if message.is_empty() {
            "Customer opened booking chat."
        } else {
            &message
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to open booking chat"))?;
    Ok(Json(ApiResponse::ok(ticket)))
}

async fn join_customer_booking_waitlist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerWaitlistRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let (preferred_date, _) = customer_waitlist_date_range(&body)?;
    let reason = customer_waitlist_reason(&body);
    let entry = repo::add_booking_waitlist(
        &state.db,
        &claims.sub,
        &id,
        preferred_date.as_deref(),
        &reason,
    )
    .await
    .map_err(|error| {
        if matches!(error, sqlx::Error::RowNotFound) {
            AppError::not_found("customer booking was not found")
        } else {
            AppError::internal("failed to join customer waitlist")
        }
    })?;
    Ok(Json(ApiResponse::ok(entry)))
}

fn customer_waitlist_date_range(
    body: &CustomerWaitlistRequest,
) -> Result<(Option<String>, Option<String>), AppError> {
    let start = body
        .preferred_start_date
        .as_deref()
        .or(body.preferred_date.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let end = body
        .preferred_end_date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let parsed_start = match start {
        Some(value) => Some(
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| AppError::validation("preferredStartDate must be YYYY-MM-DD"))?,
        ),
        None => None,
    };
    let parsed_end = match end {
        Some(value) => Some(
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| AppError::validation("preferredEndDate must be YYYY-MM-DD"))?,
        ),
        None => None,
    };
    if let (Some(start_date), Some(end_date)) = (parsed_start, parsed_end) {
        if end_date < start_date {
            return Err(AppError::validation(
                "preferredEndDate cannot be before preferredStartDate",
            ));
        }
    }
    Ok((start.map(str::to_string), end.map(str::to_string)))
}

fn customer_waitlist_reason(body: &CustomerWaitlistRequest) -> String {
    let mut parts = Vec::new();
    if let (Some(start), Some(end)) = (&body.preferred_start_date, &body.preferred_end_date) {
        if !start.is_empty() && !end.is_empty() && start != end {
            parts.push(format!("Preferred date range: {start} to {end}."));
        }
    }
    if matches!(body.priority.as_deref(), Some("high")) {
        parts.push("Priority: high.".to_string());
    }
    if let Some(reason) = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(reason.to_string());
    }
    parts.join(" ")
}

async fn validate_customer_package_credit_booking(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    service_ids: &[String],
    credit_id: &str,
) -> Result<(), appointments::ApiError> {
    let credit = sqlx::query_as::<_, (String, i32, i64)>(
        "SELECT c.service_id,c.remaining_qty,COUNT(r.id)::BIGINT FROM client_package_credits c JOIN packages p ON p.id=c.package_id AND p.tenant_id=c.tenant_id AND p.branch_id=c.branch_id LEFT JOIN appointment_package_reservations r ON r.client_package_credit_id=c.id AND r.status='reserved' WHERE c.id=$1 AND c.tenant_id=$2 AND c.branch_id=$3 AND c.client_id=$4 AND c.active=TRUE AND c.remaining_qty>0 AND (c.expires_at IS NULL OR c.expires_at>=CURRENT_DATE) AND p.active=TRUE AND (p.show_mobile_app=TRUE OR p.show_online_booking=TRUE) GROUP BY c.service_id,c.remaining_qty",
    )
    .bind(credit_id.trim())
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| appointments::ApiError::internal("failed to validate package credit"))?
    .ok_or_else(|| appointments::ApiError::bad_request("package credit is not available"))?;
    if credit.1 <= credit.2 as i32 {
        return Err(appointments::ApiError::bad_request(
            "package credit is already reserved",
        ));
    }
    if !service_ids.iter().any(|service_id| service_id == &credit.0) {
        return Err(appointments::ApiError::bad_request(
            "package credit does not match the booked service",
        ));
    }
    Ok(())
}

async fn accept_customer_waitlist_offer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to accept waitlist offer"))?;
    let offer = sqlx::query("SELECT o.id,o.waitlist_id FROM appointment_waitlist_offers o JOIN appointment_waitlist w ON w.id=o.waitlist_id JOIN appointments a ON a.id=o.offered_appointment_id JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id WHERE o.offered_appointment_id=$2 AND o.status='offered' AND o.expires_at>NOW() FOR UPDATE")
        .bind(&claims.sub).bind(&id).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to load waitlist offer"))?
        .ok_or_else(|| AppError::not_found("active waitlist offer was not found"))?;
    let offer_id: String = offer.try_get("id").unwrap_or_default();
    let waitlist_id: String = offer.try_get("waitlist_id").unwrap_or_default();
    let changed = sqlx::query("UPDATE appointments SET status='confirmed',version=version+1,updated_at=NOW() WHERE id=$1 AND status='waitlist_offer'")
        .bind(&id).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to confirm waitlist offer"))?.rows_affected();
    if changed != 1 {
        return Err(AppError::conflict("waitlist offer is no longer available"));
    }
    sqlx::query("UPDATE appointment_waitlist_offers SET status='accepted',responded_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(&offer_id).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to accept waitlist offer"))?;
    sqlx::query("UPDATE appointment_waitlist SET status='promoted',updated_at=NOW() WHERE id=$1")
        .bind(&waitlist_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to update waitlist entry"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit waitlist acceptance"))?;
    let booking = repo::account_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| AppError::internal("failed to load confirmed booking"))?
        .ok_or_else(|| AppError::not_found("customer booking was not found"))?;
    Ok(Json(ApiResponse::ok(booking)))
}

async fn decline_customer_waitlist_offer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to decline waitlist offer"))?;
    let offer = sqlx::query("SELECT o.id,o.waitlist_id,o.source_appointment_id,a.tenant_id,a.branch_id FROM appointment_waitlist_offers o JOIN appointments a ON a.id=o.offered_appointment_id JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id WHERE o.offered_appointment_id=$2 AND o.status='offered' FOR UPDATE")
        .bind(&claims.sub).bind(&id).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to load waitlist offer"))?
        .ok_or_else(|| AppError::not_found("active waitlist offer was not found"))?;
    let offer_id: String = offer.try_get("id").unwrap_or_default();
    let waitlist_id: String = offer.try_get("waitlist_id").unwrap_or_default();
    let source_appointment_id: String = offer.try_get("source_appointment_id").unwrap_or_default();
    let tenant_id: String = offer.try_get("tenant_id").unwrap_or_default();
    let branch_id: String = offer.try_get("branch_id").unwrap_or_default();
    sqlx::query("UPDATE appointments SET status='cancelled',version=version+1,updated_at=NOW() WHERE id=$1 AND status='waitlist_offer'")
        .bind(&id).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to release waitlist slot"))?;
    sqlx::query("UPDATE appointment_waitlist_offers SET status='declined',responded_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(&offer_id).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to decline waitlist offer"))?;
    sqlx::query("UPDATE appointment_waitlist SET status='declined',updated_at=NOW() WHERE id=$1")
        .bind(&waitlist_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to update waitlist entry"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit waitlist decline"))?;
    if let Ok(source) =
        appointments::find_appointment(&state, &tenant_id, &branch_id, &source_appointment_id).await
    {
        let _ = appointments::offer_waitlist_for_cancelled_appointment(&state, &source).await;
    }
    Ok(Json(ApiResponse::ok(json!({"id":id,"status":"declined"}))))
}

async fn create_customer_booking_review(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CustomerReviewRequest>,
) -> ApiResult<Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    if !(1..=5).contains(&body.rating) || body.text.chars().count() > 2000 {
        return Err(AppError::validation(
            "rating must be 1-5 and review text must be at most 2000 characters",
        ));
    }
    let review =
        repo::add_booking_review(&state.db, &claims.sub, &id, body.rating, body.text.trim())
            .await
            .map_err(|error| {
                if matches!(error, sqlx::Error::RowNotFound) {
                    AppError::validation("only completed customer bookings can be reviewed")
                } else {
                    AppError::internal("failed to save customer review")
                }
            })?;
    Ok(Json(ApiResponse::ok(review)))
}

async fn cancel_customer_booking(
    State(state): State<AppState>,
    mut headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<CancelRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate customer booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    authorize_booking_action(&state, &mut headers, &id, &owned)?;
    let _ = appointments::cancel_appointment(
        State(state.clone()),
        headers,
        Path(id.clone()),
        Json(appointments::StatusPayload {
            status: "cancelled".to_string(),
            reason: body.reason.unwrap_or_default(),
            apply_group: false,
        }),
    )
    .await?;
    let booking = repo::account_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to reload cancelled booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    Ok(Json(json!({"success":true,"data":booking})))
}

async fn reschedule_customer_booking(
    State(state): State<AppState>,
    mut headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<RescheduleRequest>,
) -> Result<Json<Value>, appointments::ApiError> {
    let claims = active_booking_claims(&state, &headers).await?;
    let owned = repo::owned_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to validate customer booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    authorize_booking_action(&state, &mut headers, &id, &owned)?;
    let pending_approval = appointments::create_client_reschedule_request(
        &state,
        &owned.tenant_id,
        &owned.branch_id,
        &id,
        &owned.client_id,
        &body.start_at,
        body.end_at.as_deref(),
        body.staff_id.as_deref().unwrap_or_default(),
        body.reason.as_deref().unwrap_or_default(),
    )
    .await?;
    if pending_approval {
        return Ok(Json(
            json!({"success":true,"pendingApproval":true,"data":null}),
        ));
    }
    let _ = appointments::reschedule_appointment(
        State(state.clone()),
        None,
        headers,
        Path(id.clone()),
        Json(appointments::ReschedulePayload {
            expected_version: None,
            start_at: body.start_at,
            end_at: body.end_at,
            reason: body.reason.unwrap_or_default(),
            staff_id: body.staff_id.unwrap_or_default(),
            staff_change_approval: "client-approved".to_string(),
            staff_change_reason: String::new(),
            service_ids: Vec::new(),
            branch_id: owned.branch_id,
            chair_room_id: String::new(),
            booking_group_id: String::new(),
            change_mode: "official".to_string(),
            actor_source: "client".to_string(),
            outside_hours_override_reason: String::new(),
        }),
    )
    .await?;
    let booking = repo::account_booking(&state.db, &claims.sub, &id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to reload rescheduled booking"))?
        .ok_or_else(|| appointments::ApiError::not_found("customer booking was not found"))?;
    Ok(Json(json!({"success":true,"data":booking})))
}

async fn create_owned_booking_payment_link(
    state: &AppState,
    mut headers: HeaderMap,
    account_id: &str,
    appointment_id: &str,
    owned: &repo::OwnedBooking,
) -> Result<Value, appointments::ApiError> {
    authorize_booking_action(state, &mut headers, appointment_id, owned)?;
    let mobile = repo::account(&state.db, account_id)
        .await
        .map_err(|_| appointments::ApiError::internal("failed to load customer payment profile"))?
        .map(|account| account.phone)
        .unwrap_or_default();
    let (_, Json(payment)) = booking_extensions::booking_payments_payment_link_create(
        State(state.clone()),
        headers,
        Json(booking_extensions::BookingPaymentCreateBody {
            appointment_id: appointment_id.to_string(),
            mobile,
        }),
    )
    .await?;
    Ok(payment)
}

fn decorate_marketplace_payment_modes(state: &AppState, business: &mut Value) {
    let deposit_percent = business
        .get("bookingDepositPercent")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let modes = if deposit_percent > 0 && state.settings.razorpay_payment_links_enabled() {
        json!(["online", "pay_at_venue"])
    } else {
        json!(["pay_at_venue"])
    };
    if let Some(object) = business.as_object_mut() {
        object.insert("paymentModes".to_string(), modes);
    }
}

fn validate_commerce_idempotency_key(value: &str) -> Result<(), AppError> {
    let key = value.trim();
    if key.is_empty() || key.len() > 200 {
        return Err(AppError::validation(
            "idempotencyKey is required and must be at most 200 characters",
        ));
    }
    Ok(())
}

fn branch_request(value: &Option<String>) -> &str {
    value.as_deref().unwrap_or("").trim()
}

fn clean_required(value: &str, max_len: usize, label: &str) -> Result<String, AppError> {
    let cleaned = value.trim();
    if cleaned.is_empty() || cleaned.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{label} is required and must be at most {max_len} characters"
        )));
    }
    Ok(cleaned.to_string())
}

fn clean_optional(value: Option<&str>, max_len: usize, label: &str) -> Result<String, AppError> {
    let cleaned = value.unwrap_or("").trim();
    if cleaned.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(cleaned.to_string())
}

fn clean_choice(value: &str, allowed: &[&str], label: &str) -> Result<String, AppError> {
    let cleaned = value.trim().to_ascii_lowercase();
    if !allowed.contains(&cleaned.as_str()) {
        return Err(AppError::validation(format!("{label} is invalid")));
    }
    Ok(cleaned)
}

fn require_loopback_dev_request(peer: SocketAddr) -> Result<(), AppError> {
    if peer.ip().is_loopback() {
        Ok(())
    } else {
        Err(AppError::not_found("customer dev session is not available"))
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

async fn customer_branch_context(
    state: &AppState,
    account_id: &str,
    requested_branch_id: &str,
) -> Result<repo::CustomerBranchContext, AppError> {
    let branch_id = requested_branch_id.trim();
    let linked = repo::linked_branch_contexts(&state.db, account_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load customer branch"))?;
    if !branch_id.is_empty() && !linked.is_empty() {
        return linked
            .into_iter()
            .next()
            .ok_or_else(|| AppError::internal("failed to resolve customer branch"));
    }
    if linked.len() == 1 {
        return linked
            .into_iter()
            .next()
            .ok_or_else(|| AppError::internal("failed to resolve customer branch"));
    }
    if branch_id.is_empty() {
        return Err(AppError::validation(
            "branchId is required when the customer has zero or multiple linked branches",
        ));
    }
    let tenant_id = repo::branch_tenant(&state.db, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer branch"))?
        .ok_or_else(|| AppError::not_found("active customer branch was not found"))?;
    let account = repo::account(&state.db, account_id)
        .await
        .map_err(|_| AppError::internal("failed to load customer account"))?
        .ok_or_else(|| AppError::unauthenticated("customer account is not active"))?;
    let client_id = repo::ensure_client_link(&state.db, &account, &tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to link customer to branch"))?;
    Ok(repo::CustomerBranchContext {
        tenant_id,
        branch_id: branch_id.to_string(),
        client_id,
    })
}

async fn owned_customer_membership(
    state: &AppState,
    account_id: &str,
    membership_id: &str,
) -> Result<repo::OwnedMembership, AppError> {
    repo::owned_membership(&state.db, account_id, membership_id)
        .await
        .map_err(|_| AppError::internal("failed to validate customer membership"))?
        .ok_or_else(|| AppError::not_found("customer membership was not found"))
}

fn tenant_branch_headers(tenant_id: &str, branch_id: &str) -> Result<HeaderMap, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-tenant-id",
        HeaderValue::from_str(tenant_id)
            .map_err(|_| AppError::validation("tenantId is invalid"))?,
    );
    headers.insert(
        "x-branch-id",
        HeaderValue::from_str(branch_id)
            .map_err(|_| AppError::validation("branchId is invalid"))?,
    );
    Ok(headers)
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
/// What the salon's assistant remembers about this customer.
///
/// Their own information, so they may see it and erase it. Sensitive notes are
/// excluded from the read: a portal page is not the place to surface a health
/// note a staff member wrote and may never have discussed with them.
async fn customer_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::ai_memory_repository::MemoryNote>> {
    let claims = active_customer_claims(&state, &headers).await?;
    Ok(Json(ApiResponse::ok(
        crate::services::ai_memory_service::for_customer_account(&state.db, &claims.sub).await?,
    )))
}

/// Erases everything remembered about this customer, on their own request.
async fn forget_customer_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    let removed =
        crate::services::ai_memory_service::forget_for_customer_account(&state.db, &claims.sub)
            .await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"forgotten": removed}),
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryDisputeRequest {
    #[serde(default)]
    reason: String,
}

/// A customer telling the salon that something remembered about them is wrong.
///
/// The note stops being used immediately, before anybody reviews it — waiting
/// would mean the assistant kept acting on something the client has just said
/// is incorrect. They cannot rewrite it: a memory the subject could edit would
/// stop being a record of what was said.
async fn dispute_customer_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(note_id): Path<String>,
    Json(payload): Json<MemoryDisputeRequest>,
) -> ApiResult<serde_json::Value> {
    let claims = active_customer_claims(&state, &headers).await?;
    crate::services::ai_memory_service::dispute_for_customer_account(
        &state.db,
        &claims.sub,
        &note_id,
        &payload.reason,
    )
    .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "disputed": true,
        "message": "Thanks — we have stopped using that and the salon will review it."
    }))))
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

async fn enforce_customer_rate_limit(
    state: &AppState,
    key: &str,
    maximum: i64,
    ttl_seconds: i64,
) -> Result<(), AppError> {
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| AppError::internal("failed to connect to customer rate limit store"))?;
    let count: i64 = redis::cmd("INCR")
        .arg(key)
        .query_async(&mut redis)
        .await
        .map_err(|_| AppError::internal("failed to update customer rate limit"))?;
    if count == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(key)
            .arg(ttl_seconds)
            .query_async(&mut redis)
            .await
            .map_err(|_| AppError::internal("failed to expire customer rate limit"))?;
    }
    if count > maximum {
        return Err(AppError::rate_limited(
            "too many customer requests; try again later",
        ));
    }
    Ok(())
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
