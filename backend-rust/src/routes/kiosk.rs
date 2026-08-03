use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    config::is_local_env,
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service, auth_service::AuthClaims, kiosk_service},
    state::AppState,
};

const DEVICE_COOKIE: &str = "aura_kiosk_device";
const GUEST_COOKIE: &str = "aura_kiosk_guest";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/kiosk/devices", get(list_devices).post(create_device))
        .route("/kiosk/devices/:id", patch(update_device))
        .route("/kiosk/devices/:id/revoke", post(revoke_device))
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/public/kiosk/activate", post(activate))
        .route("/public/kiosk/context", get(context))
        .route("/public/kiosk/branch", post(switch_branch))
        .route("/public/kiosk/identify", post(identify))
        .route("/public/kiosk/session", get(session))
        .route("/public/kiosk/forms/:id/token", post(form_token))
        .route("/public/kiosk/check-in", post(check_in))
        .route("/public/kiosk/profile", patch(fill_missing_profile))
        .route("/public/kiosk/add-on-request", post(request_add_on))
        .route("/public/kiosk/checkout", get(checkout))
        .route("/public/kiosk/unlock", post(unlock))
        .route("/public/kiosk/reset", post(reset))
        .route("/public/kiosk/deactivate", post(deactivate))
}

async fn list_devices(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    require_manage(&claims)?;
    let (tenant, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        kiosk_service::list_devices(&state, &tenant).await?,
    )))
}

async fn create_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::DeviceInput>,
) -> ApiResult<Value> {
    require_manage(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        kiosk_service::create_device(&state, &tenant, &branch, &claims.sub, &input).await?,
    )))
}

async fn update_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<kiosk_service::DeviceUpdateInput>,
) -> ApiResult<Value> {
    require_manage(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        kiosk_service::update_device(&state, &tenant, &branch, &claims.sub, &id, &input).await?,
    )))
}

async fn revoke_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_manage(&claims)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        kiosk_service::revoke_device(&state, &tenant, &branch, &claims.sub, &id).await?,
    )))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivationInput {
    activation_code: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BranchInput {
    branch_id: String,
}

async fn activate(
    State(state): State<AppState>,
    Json(input): Json<ActivationInput>,
) -> Result<Response, AppError> {
    let (token, value) = kiosk_service::activate(&state, &input.activation_code).await?;
    response_with_cookie(
        &state,
        value,
        cookie(&state, DEVICE_COOKIE, &token, 60 * 60 * 24 * 365),
    )
}

async fn context(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::context(&state, &cookie_value(&headers, DEVICE_COOKIE)).await?,
    )))
}

async fn switch_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<BranchInput>,
) -> Result<Response, AppError> {
    let value = kiosk_service::switch_branch(
        &state,
        &cookie_value(&headers, DEVICE_COOKIE),
        input.branch_id.trim(),
    )
    .await?;
    response_with_cookie(&state, value, clear_cookie(&state, GUEST_COOKIE))
}

async fn identify(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::IdentifyInput>,
) -> Result<Response, AppError> {
    let (token, value) =
        kiosk_service::identify(&state, &cookie_value(&headers, DEVICE_COOKIE), &input).await?;
    response_with_cookie(&state, value, cookie(&state, GUEST_COOKIE, &token, 600))
}

async fn session(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::session(
            &state,
            &cookie_value(&headers, DEVICE_COOKIE),
            &cookie_value(&headers, GUEST_COOKIE),
        )
        .await?,
    )))
}

async fn form_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::form_token(
            &state,
            &cookie_value(&headers, DEVICE_COOKIE),
            &cookie_value(&headers, GUEST_COOKIE),
            &id,
        )
        .await?,
    )))
}

async fn check_in(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::CheckInInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::check_in(
            &state,
            &cookie_value(&headers, DEVICE_COOKIE),
            &cookie_value(&headers, GUEST_COOKIE),
            &input,
        )
        .await?,
    )))
}

async fn fill_missing_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::ProfileInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::fill_missing_profile(
            &state,
            &cookie_value(&headers, DEVICE_COOKIE),
            &cookie_value(&headers, GUEST_COOKIE),
            &input,
        )
        .await?,
    )))
}

async fn request_add_on(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::AddOnRequestInput>,
) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::request_add_on(
            &state,
            &cookie_value(&headers, DEVICE_COOKIE),
            &cookie_value(&headers, GUEST_COOKIE),
            &input,
        )
        .await?,
    )))
}

async fn checkout(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Value> {
    Ok(Json(ApiResponse::ok(
        kiosk_service::checkout_context(
            &state,
            &cookie_value(&headers, DEVICE_COOKIE),
            &cookie_value(&headers, GUEST_COOKIE),
        )
        .await?,
    )))
}

async fn unlock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::UnlockInput>,
) -> ApiResult<Value> {
    kiosk_service::unlock(&state, &cookie_value(&headers, DEVICE_COOKIE), &input.pin).await?;
    Ok(Json(ApiResponse::ok(json!({"unlocked":true}))))
}

async fn reset(State(state): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    let value = kiosk_service::reset(
        &state,
        &cookie_value(&headers, DEVICE_COOKIE),
        &cookie_value(&headers, GUEST_COOKIE),
    )
    .await?;
    response_with_cookie(&state, value, clear_cookie(&state, GUEST_COOKIE))
}

async fn deactivate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<kiosk_service::UnlockInput>,
) -> Result<Response, AppError> {
    let token = cookie_value(&headers, DEVICE_COOKIE);
    kiosk_service::unlock(&state, &token, &input.pin).await?;
    let value = kiosk_service::deactivate(&state, &token).await?;
    let mut response = Json(ApiResponse::ok(value)).into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&clear_cookie(&state, DEVICE_COOKIE))
            .map_err(|_| AppError::internal("failed to clear kiosk device"))?,
    );
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&clear_cookie(&state, GUEST_COOKIE))
            .map_err(|_| AppError::internal("failed to clear kiosk guest"))?,
    );
    Ok(response)
}

fn require_manage(claims: &AuthClaims) -> Result<(), AppError> {
    if auth_service::staff_app_permission_allowed(
        claims,
        "appointments.manage",
        &["owner", "admin", "manager"],
        &[],
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "appointments.manage permission is required",
        ))
    }
}

fn cookie_value(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .split(';')
                .map(str::trim)
                .find_map(|part| part.strip_prefix(&format!("{name}=")).map(str::to_string))
        })
        .unwrap_or_default()
}

fn cookie(state: &AppState, name: &str, value: &str, max_age: i64) -> String {
    format!(
        "{name}={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}{}",
        if is_local_env(&state.settings.app_env) {
            ""
        } else {
            "; Secure"
        }
    )
}

fn clear_cookie(state: &AppState, name: &str) -> String {
    cookie(state, name, "", 0)
}

fn response_with_cookie(
    state: &AppState,
    value: Value,
    set_cookie: String,
) -> Result<Response, AppError> {
    let mut response = Json(ApiResponse::ok(value)).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&set_cookie)
            .map_err(|_| AppError::internal("failed to secure kiosk session"))?,
    );
    let _ = state;
    Ok(response)
}
