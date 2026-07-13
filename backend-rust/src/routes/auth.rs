use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    config::is_local_env,
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::auth_repository,
    services::auth_service,
    state::AppState,
};

const LOGIN_RATE_LIMIT_MAX: i64 = 10;
const LOGIN_RATE_LIMIT_SECONDS: usize = 60;
const MAX_FAILED_LOGIN_ATTEMPTS: i32 = 5;
const LOGIN_LOCK_MINUTES: i32 = 15;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub user_id: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role: String,
}

#[derive(Serialize)]
pub struct LogoutResponse {
    pub revoked: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/dev-session", post(dev_session))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
}

pub async fn dev_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<auth_service::TokenPair> {
    if !is_local_env(&state.settings.app_env) || !state.settings.enable_dev_session {
        return Err(AppError::not_found("auth dev session is not available"));
    }
    let expected = state
        .settings
        .dev_session_secret
        .as_deref()
        .ok_or_else(|| AppError::not_found("auth dev session is not available"))?;
    let provided = headers
        .get("x-dev-session-secret")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return Err(AppError::not_found("auth dev session is not available"));
    }

    let (tokens, _) = auth_service::issue_token_pair(
        "dev-admin",
        "tenant_aura",
        Some("branch_hyd".to_string()),
        "owner",
        &state.settings.jwt_access_secret,
        &state.settings.jwt_refresh_secret,
        state.settings.jwt_access_ttl_minutes,
        state.settings.jwt_refresh_ttl_days,
    )
    .map_err(|_| AppError::internal("failed to issue dev session"))?;

    Ok(Json(ApiResponse::ok(tokens)))
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

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> ApiResult<auth_service::TokenPair> {
    if payload.email.is_empty() || payload.password.is_empty() {
        return Err(AppError::validation("email and password are required"));
    }

    let tenant_id = required_tenant_id(&headers)?;
    enforce_login_rate_limit(&state, &tenant_id, &payload.email, &headers).await?;
    let user = auth_repository::find_user_by_email(&state.db, &tenant_id, &payload.email)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("invalid email or password"))?;

    if user
        .locked_until
        .as_ref()
        .is_some_and(|locked_until| *locked_until > Utc::now())
    {
        return Err(AppError::rate_limited(
            "account is temporarily locked; try again later",
        ));
    }

    if !auth_service::verify_password(&payload.password, &user.password_hash) {
        auth_repository::mark_login_failure(
            &state.db,
            &user.id,
            MAX_FAILED_LOGIN_ATTEMPTS,
            LOGIN_LOCK_MINUTES,
        )
        .await
        .map_err(|_| AppError::internal("failed to update login state"))?;
        return Err(AppError::unauthenticated("invalid email or password"));
    }

    let (tokens, refresh_expires_at) = auth_service::issue_token_pair(
        &user.id,
        &user.tenant_id,
        user.branch_id.clone(),
        &user.role_name,
        &state.settings.jwt_access_secret,
        &state.settings.jwt_refresh_secret,
        state.settings.jwt_access_ttl_minutes,
        state.settings.jwt_refresh_ttl_days,
    )
    .map_err(|_| AppError::internal("failed to issue tokens"))?;

    auth_repository::save_refresh_token(
        &state.db,
        &user.tenant_id,
        &user.id,
        &auth_service::token_hash(&tokens.refresh_token),
        refresh_expires_at,
    )
    .await
    .map_err(|_| AppError::internal("failed to save refresh token"))?;

    auth_repository::mark_login_success(&state.db, &user.id)
        .await
        .map_err(|_| AppError::internal("failed to update login state"))?;

    Ok(Json(ApiResponse::ok(tokens)))
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> ApiResult<auth_service::TokenPair> {
    let claims = auth_service::decode_refresh_token(
        &payload.refresh_token,
        &state.settings.jwt_refresh_secret,
    )
    .map_err(|_| AppError::unauthenticated("invalid or expired refresh token"))?;

    if claims.token_type != "refresh" {
        return Err(AppError::unauthenticated("invalid token type"));
    }

    let old_hash = auth_service::token_hash(&payload.refresh_token);
    let user = auth_repository::find_user_by_id(&state.db, &claims.tenant_id, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("user is not active"))?;

    let (tokens, refresh_expires_at) = auth_service::issue_token_pair(
        &user.id,
        &user.tenant_id,
        user.branch_id.clone(),
        &user.role_name,
        &state.settings.jwt_access_secret,
        &state.settings.jwt_refresh_secret,
        state.settings.jwt_access_ttl_minutes,
        state.settings.jwt_refresh_ttl_days,
    )
    .map_err(|_| AppError::internal("failed to issue tokens"))?;

    auth_repository::rotate_refresh_token(
        &state.db,
        &user.tenant_id,
        &user.id,
        &old_hash,
        &auth_service::token_hash(&tokens.refresh_token),
        refresh_expires_at,
    )
    .await
    .map_err(|_| AppError::internal("failed to rotate refresh token"))?
    .ok_or_else(|| AppError::unauthenticated("refresh token is not active"))?;

    Ok(Json(ApiResponse::ok(tokens)))
}

pub async fn logout(
    State(state): State<AppState>,
    Json(payload): Json<LogoutRequest>,
) -> ApiResult<LogoutResponse> {
    auth_repository::revoke_refresh_token(
        &state.db,
        &auth_service::token_hash(&payload.refresh_token),
    )
    .await
    .map_err(|_| AppError::internal("failed to revoke refresh token"))?;

    Ok(Json(ApiResponse::ok(LogoutResponse { revoked: true })))
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<MeResponse> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthenticated("missing bearer token"))?;

    let claims = auth_service::decode_access_token(token, &state.settings.jwt_access_secret)
        .map_err(|_| AppError::unauthenticated("invalid or expired bearer token"))?;

    if claims.token_type != "access" {
        return Err(AppError::unauthenticated("invalid token type"));
    }

    if is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin"
    {
        return Ok(Json(ApiResponse::ok(MeResponse {
            user_id: claims.sub,
            tenant_id: claims.tenant_id,
            branch_id: claims.branch_id,
            role: claims.role,
        })));
    }

    let user = auth_repository::find_user_by_id(&state.db, &claims.tenant_id, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("user is not active"))?;

    Ok(Json(ApiResponse::ok(MeResponse {
        user_id: user.id,
        tenant_id: user.tenant_id,
        branch_id: user.branch_id,
        role: user.role_name,
    })))
}

fn required_tenant_id(headers: &HeaderMap) -> Result<String, AppError> {
    headers
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation("x-tenant-id is required"))
}

async fn enforce_login_rate_limit(
    state: &AppState,
    tenant_id: &str,
    email: &str,
    headers: &HeaderMap,
) -> Result<(), AppError> {
    let identity = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("direct");
    let key = format!(
        "auth_login_rate:{}:{}:{}",
        tenant_id.trim().to_lowercase(),
        email.trim().to_lowercase(),
        identity
    );
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "RATE_LIMIT_STORE_UNAVAILABLE",
                "login rate limit store is unavailable",
            )
        })?;
    let count: i64 = redis::cmd("INCR")
        .arg(&key)
        .query_async(&mut redis)
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "RATE_LIMIT_STORE_UNAVAILABLE",
                "login rate limit store is unavailable",
            )
        })?;
    if count == 1 {
        let _: () = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(LOGIN_RATE_LIMIT_SECONDS)
            .query_async(&mut redis)
            .await
            .map_err(|_| {
                AppError::service_unavailable(
                    "RATE_LIMIT_STORE_UNAVAILABLE",
                    "login rate limit store is unavailable",
                )
            })?;
    }
    if count > LOGIN_RATE_LIMIT_MAX {
        return Err(AppError::rate_limited(
            "too many login attempts; try again later",
        ));
    }
    Ok(())
}
