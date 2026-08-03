use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service, auth_service::AuthClaims, fitness_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/fitness/summary", get(summary))
        .route("/fitness/queue", post(create_queue_entry))
        .route("/fitness/queue/:id", patch(update_queue_entry))
        .route("/fitness/class-templates", post(create_class_template))
        .route("/fitness/class-sessions", post(create_class_sessions))
        .route(
            "/fitness/class-sessions/:id/registrations",
            post(register_for_class),
        )
        .route(
            "/fitness/class-registrations/:id",
            patch(update_registration),
        )
        .route(
            "/fitness/class-registrations/:id/fee-waive",
            post(waive_fee),
        )
        .route(
            "/fitness/class-registrations/:id/fee-reverse",
            post(reverse_fee),
        )
        .route("/fitness/amenities", post(create_amenity))
        .route("/fitness/lockers/:id/assign", post(assign_locker))
        .route(
            "/fitness/locker-assignments/:id/release",
            post(release_locker),
        )
        .route("/fitness/challenges", post(create_challenge))
        .route("/fitness/challenges/:id/participants", post(join_challenge))
        .route("/fitness/kiosk-devices", post(create_kiosk_device))
        .route("/fitness/reports/utilization", get(utilization_report))
}

pub fn public_router() -> Router<AppState> {
    Router::new().route("/fitness/kiosk/check-in", post(kiosk_check_in))
}

async fn summary(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::summary(&state, &tenant, &branch).await?,
    )))
}

async fn create_queue_entry(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::QueueInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::create_queue_entry(&state, &tenant, &branch, &claims.sub, &input).await?,
    )))
}

async fn update_queue_entry(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<fitness_service::QueueActionInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::update_queue_entry(&state, &tenant, &branch, &claims.sub, &id, &input)
            .await?,
    )))
}

async fn create_class_template(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::ClassTemplateInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::create_class_template(&state, &tenant, &branch, &claims.sub, &input)
            .await?,
    )))
}

async fn create_class_sessions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::ClassSessionInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::create_class_sessions(&state, &tenant, &branch, &claims.sub, &input)
            .await?,
    )))
}

async fn register_for_class(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<fitness_service::RegistrationInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::register_for_class(&state, &tenant, &branch, &claims.sub, &id, &input)
            .await?,
    )))
}

async fn update_registration(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<fitness_service::RegistrationActionInput>,
) -> ApiResult<Value> {
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::update_registration(&state, &tenant, &branch, &claims.sub, &id, &input)
            .await?,
    )))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FeeAction {
    reason: String,
}

async fn waive_fee(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<FeeAction>,
) -> ApiResult<Value> {
    require_fee_permission(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::set_fee_status(
            &state,
            &tenant,
            &branch,
            &claims.sub,
            &id,
            "waived",
            &input.reason,
        )
        .await?,
    )))
}

async fn reverse_fee(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<FeeAction>,
) -> ApiResult<Value> {
    require_fee_permission(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::set_fee_status(
            &state,
            &tenant,
            &branch,
            &claims.sub,
            &id,
            "reversed",
            &input.reason,
        )
        .await?,
    )))
}

async fn create_amenity(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::AmenityInput>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::create_amenity(&state, &t, &b, &claims.sub, &input).await?,
    )))
}
async fn assign_locker(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<fitness_service::LockerAssignmentInput>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::assign_locker(&state, &t, &b, &claims.sub, &id, &input).await?,
    )))
}
async fn release_locker(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::release_locker(&state, &t, &b, &claims.sub, &id).await?,
    )))
}
async fn create_challenge(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::ChallengeInput>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::create_challenge(&state, &t, &b, &claims.sub, &input).await?,
    )))
}
async fn join_challenge(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<fitness_service::ChallengeParticipantInput>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::join_challenge(&state, &t, &b, &claims.sub, &id, &input).await?,
    )))
}
async fn create_kiosk_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::KioskDeviceInput>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::create_kiosk_device(&state, &t, &b, &claims.sub, &input).await?,
    )))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReportQuery {
    from: DateTime<Utc>,
    to: DateTime<Utc>,
}

async fn utilization_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReportQuery>,
) -> ApiResult<Value> {
    let (t, b) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        fitness_service::utilization_report(&state, &t, &b, query.from, query.to).await?,
    )))
}

async fn kiosk_check_in(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<fitness_service::KioskCheckInInput>,
) -> ApiResult<Value> {
    let token = headers
        .get("x-public-booking-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    Ok(Json(ApiResponse::ok(
        fitness_service::kiosk_check_in(&state, token, &input).await?,
    )))
}

fn require_fee_permission(claims: &AuthClaims) -> Result<(), AppError> {
    if auth_service::staff_app_permission_allowed(
        claims,
        "appointments.fees.waive",
        &["owner", "admin", "manager"],
        &[],
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "appointment fee waiver permission is required",
        ))
    }
}

#[allow(dead_code)]
fn _route_contract_marker() -> Value {
    json!({"domain":"fitness"})
}
