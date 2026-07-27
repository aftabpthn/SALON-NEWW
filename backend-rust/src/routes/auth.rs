use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    config::is_local_env,
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::auth_repository::{
        self, AuthAuditInput, AuthUser, BranchAccess, SessionTokenInput,
    },
    services::{
        auth_service::{self, TokenScope},
        entitlement_service, security_service, sso_service, webauthn_service,
    },
    state::AppState,
};

const LOGIN_RATE_LIMIT_MAX: i64 = 10;
const LOGIN_RATE_LIMIT_SECONDS: usize = 60;
const MAX_FAILED_LOGIN_ATTEMPTS: i32 = 5;
const LOGIN_LOCK_MINUTES: i32 = 15;
const REFRESH_COOKIE: &str = "aurashine_refresh_token";
/// Double-submit CSRF cookie. Readable by the browser (unlike the refresh
/// cookie) so the client can echo it back in the `x-csrf-token` header.
const CSRF_COOKIE: &str = "aurashine_csrf";
const CSRF_HEADER: &str = "x-csrf-token";

type AuthApiResult<T> = Result<(HeaderMap, Json<ApiResponse<T>>), AppError>;

#[derive(Deserialize)]
pub struct LoginRequest {
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default, alias = "loginId")]
    pub login_id: Option<String>,
    pub password: String,
    #[serde(default, alias = "branchId")]
    pub branch_id: Option<String>,
    #[serde(default, alias = "deviceId")]
    pub device_id: Option<String>,
    #[serde(default, alias = "mfaCode")]
    pub mfa_code: Option<String>,
}

#[derive(Default, Deserialize)]
pub struct RefreshRequest {
    #[serde(default, alias = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(default, alias = "deviceId")]
    pub device_id: Option<String>,
}

#[derive(Default, Deserialize)]
pub struct LogoutRequest {
    #[serde(default, alias = "refreshToken")]
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
pub struct SelectBranchRequest {
    #[serde(alias = "selectionToken")]
    pub selection_token: String,
    #[serde(alias = "branchId")]
    pub branch_id: String,
    #[serde(default, alias = "deviceId")]
    pub device_id: Option<String>,
}

#[derive(Default, Deserialize)]
pub struct SwitchBranchRequest {
    #[serde(alias = "branchId")]
    pub branch_id: String,
    #[serde(default, alias = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(default, alias = "deviceId")]
    pub device_id: Option<String>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum LoginResponse {
    Authenticated(auth_service::TokenPair),
    BranchSelection(BranchSelectionResponse),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSelectionResponse {
    pub requires_branch_selection: bool,
    pub selection_token: String,
    pub branches: Vec<BranchAccess>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeResponse {
    pub user_id: String,
    pub tenant_id: String,
    pub branch_id: Option<String>,
    pub role_id: Option<String>,
    pub role: String,
    pub permissions: Vec<String>,
    pub permission_version: i64,
    pub session_id: String,
    pub branches: Vec<BranchAccess>,
    pub must_change_password: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub new_password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordResponse {
    pub password_changed: bool,
    pub reauthentication_required: bool,
}

#[derive(Serialize)]
pub struct LogoutResponse {
    pub revoked: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyLoginStartRequest {
    pub login_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyLoginFinishRequest {
    pub challenge_id: String,
    pub credential: passkey_auth::AuthenticationResponse,
    #[serde(default)]
    pub device_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoStartQuery {
    pub tenant: String,
    pub return_uri: String,
}

#[derive(Default, Deserialize)]
pub struct SsoProvidersQuery {
    pub tenant: Option<String>,
}

#[derive(Deserialize)]
pub struct SsoCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoExchangeRequest {
    pub code: String,
    #[serde(default)]
    pub device_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsrfResponse {
    pub csrf_token: String,
    pub expires_at: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/csrf", get(csrf))
        .route("/auth/login", post(login))
        .route("/auth/sso/providers", get(sso_providers))
        .route("/auth/sso/:provider/start", get(start_sso))
        .route("/auth/sso/:provider/callback", get(finish_sso))
        .route("/auth/sso/exchange", post(exchange_sso))
        .route("/auth/webauthn/login/begin", post(begin_passkey_login))
        .route("/auth/webauthn/login/finish", post(finish_passkey_login))
        .route("/auth/select-branch", post(select_branch))
        .route("/auth/switch-branch", post(switch_branch))
        .route("/auth/dev-session", post(dev_session))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
}

/// Issues a CSRF token and sets it as a readable cookie so browser clients can
/// echo it back in `x-csrf-token` (double-submit). Cookie-borne refresh
/// requests are rejected without a matching header.
pub async fn csrf(State(state): State<AppState>) -> Result<Response, AppError> {
    let csrf_token = Uuid::new_v4().to_string();
    let expires_at = (Utc::now() + chrono::Duration::hours(12)).to_rfc3339();
    let cookie = csrf_cookie(&state, &csrf_token, 12 * 3_600)?;
    let mut response = Json(ApiResponse::ok(CsrfResponse {
        csrf_token,
        expires_at,
    }))
    .into_response();
    response.headers_mut().append(header::SET_COOKIE, cookie);
    Ok(response)
}

fn csrf_cookie(
    state: &AppState,
    value: &str,
    max_age: u64,
) -> Result<HeaderValue, AppError> {
    let secure = if is_local_env(&state.settings.app_env) {
        ""
    } else {
        "; Secure"
    };
    // Deliberately not HttpOnly: the double-submit pattern requires the
    // client to read this value and send it back as a header.
    HeaderValue::from_str(&format!(
        "{CSRF_COOKIE}={value}; Path=/api; SameSite=Strict; Max-Age={max_age}{secure}"
    ))
    .map_err(|_| AppError::internal("failed to create CSRF cookie"))
}
pub async fn sso_providers(
    State(state): State<AppState>,
    Query(query): Query<SsoProvidersQuery>,
) -> ApiResult<sso_service::ProviderAvailability> {
    let Some(tenant_context) = query
        .tenant
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    else {
        return Ok(Json(ApiResponse::ok(sso_service::availability(
            &state.settings,
        ))));
    };
    let tenant_id = auth_repository::resolve_auth_tenant_id(&state.db, tenant_context)
        .await
        .map_err(|_| AppError::internal("failed to resolve salon workspace"))?
        .ok_or_else(|| AppError::not_found("salon workspace was not found"))?;
    Ok(Json(ApiResponse::ok(
        sso_service::availability_for_tenant(&state.db, &state.settings, &tenant_id).await?,
    )))
}

pub async fn start_sso(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(query): Query<SsoStartQuery>,
) -> Result<Redirect, AppError> {
    let provider = sso_service::OidcProvider::parse(&provider)?;
    let tenant_id = auth_repository::resolve_auth_tenant_id(&state.db, query.tenant.trim())
        .await
        .map_err(|_| AppError::internal("failed to resolve salon workspace"))?
        .ok_or_else(|| AppError::not_found("salon workspace was not found"))?;
    entitlement_service::ensure_can_login(&state.db, &tenant_id).await?;
    let url = sso_service::begin(&state, &tenant_id, provider, query.return_uri.trim()).await?;
    Ok(Redirect::temporary(&url))
}

pub async fn finish_sso(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(query): Query<SsoCallbackQuery>,
) -> Result<Redirect, AppError> {
    if query.error.is_some() {
        return Err(AppError::unauthenticated(
            "SSO sign-in was cancelled or denied",
        ));
    }
    let code = query
        .code
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SSO authorization code is required"))?;
    let state_value = query
        .state
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("SSO state is required"))?;
    let provider = sso_service::OidcProvider::parse(&provider)?;
    let (return_url, _) = sso_service::finish(&state, provider, code, state_value).await?;
    Ok(Redirect::temporary(&return_url))
}

pub async fn exchange_sso(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SsoExchangeRequest>,
) -> AuthApiResult<LoginResponse> {
    let handoff = crate::repositories::sso_repository::consume_sso_handoff(
        &state.db,
        &sso_service::token_hash(payload.code.trim()),
    )
    .await
    .map_err(|_| AppError::internal("failed to validate SSO handoff"))?
    .ok_or_else(|| AppError::unauthenticated("invalid or expired SSO handoff"))?;
    entitlement_service::ensure_can_login(&state.db, &handoff.tenant_id).await?;
    let user = auth_repository::find_user_by_id(&state.db, &handoff.tenant_id, &handoff.user_id)
        .await
        .map_err(|_| AppError::internal("failed to load SSO user"))?
        .ok_or_else(|| AppError::unauthenticated("SSO user is not active"))?;
    auth_repository::mark_login_success(&state.db, &user.id)
        .await
        .map_err(|_| AppError::internal("failed to update login state"))?;
    let identity = user.login_id.as_deref().unwrap_or(&user.email);
    complete_login(
        &state,
        &headers,
        &user,
        None,
        payload.device_id.as_deref(),
        identity,
        "login.sso",
        &format!("oidc:{}", handoff.provider),
    )
    .await
}

pub fn protected_router() -> Router<AppState> {
    Router::new().route("/auth/change-password", post(change_password))
}

pub async fn dev_session(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> ApiResult<auth_service::TokenPair> {
    if !is_local_env(&state.settings.app_env) || !state.settings.enable_dev_session {
        return Err(AppError::not_found("auth dev session is not available"));
    }
    require_loopback_dev_request(peer)?;
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

pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> AuthApiResult<LoginResponse> {
    let identity = payload
        .email
        .as_deref()
        .or(payload.login_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("email or loginId is required"))?;
    if payload.password.is_empty() {
        return Err(AppError::validation("password is required"));
    }

    let tenant_id = resolve_tenant_id(&state, &headers).await?;
    entitlement_service::ensure_can_login(&state.db, &tenant_id).await?;
    enforce_login_rate_limit(&state, &tenant_id, identity, &headers).await?;
    let client = ClientContext::from_headers(&headers);
    let user = auth_repository::find_user_by_identity(&state.db, &tenant_id, identity)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?;
    let Some(user) = user else {
        audit(
            &state,
            &tenant_id,
            None,
            None,
            None,
            Some(identity),
            "login",
            "denied",
            &client,
            json!({"reason":"invalid_credentials"}),
        )
        .await;
        return Err(AppError::unauthenticated("invalid email or password"));
    };

    if user
        .locked_until
        .as_ref()
        .is_some_and(|until| *until > Utc::now())
    {
        audit(
            &state,
            &tenant_id,
            Some(&user.id),
            None,
            None,
            Some(identity),
            "login",
            "denied",
            &client,
            json!({"reason":"locked"}),
        )
        .await;
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
        audit(
            &state,
            &tenant_id,
            Some(&user.id),
            None,
            None,
            Some(identity),
            "login",
            "denied",
            &client,
            json!({"reason":"invalid_credentials"}),
        )
        .await;
        return Err(AppError::unauthenticated("invalid email or password"));
    }
    enforce_sso_policy(&state, &headers, &user, identity, "password").await?;

    let risk = security_service::assess_login_risk(
        &state.db,
        &tenant_id,
        &user.id,
        payload.device_id.as_deref(),
        client.ip_address.as_deref(),
    )
    .await?;
    if risk.score > 0 {
        audit(
            &state,
            &tenant_id,
            Some(&user.id),
            None,
            None,
            Some(identity),
            "login.risk_assessed",
            risk.level,
            &client,
            json!({"score":risk.score,"signals":risk.signals,"stepUpRequired":risk.step_up_required}),
        )
        .await;
    }

    let mfa_verified = match security_service::verify_login_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &user.id,
        payload.mfa_code.as_deref(),
        risk.step_up_required,
    )
    .await
    {
        Ok(verified) => verified,
        Err(error) => {
            audit(
                &state,
                &tenant_id,
                Some(&user.id),
                None,
                None,
                Some(identity),
                "login.mfa",
                "denied",
                &client,
                json!({"reason":"mfa_required_or_invalid"}),
            )
            .await;
            return Err(error);
        }
    };

    auth_repository::mark_login_success(&state.db, &user.id)
        .await
        .map_err(|_| AppError::internal("failed to update login state"))?;
    complete_login(
        &state,
        &headers,
        &user,
        payload.branch_id.as_deref(),
        payload.device_id.as_deref(),
        identity,
        "login",
        if mfa_verified {
            "password+mfa"
        } else {
            "password"
        },
    )
    .await
}

pub async fn begin_passkey_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyLoginStartRequest>,
) -> ApiResult<webauthn_service::AuthenticationStart> {
    let identity = payload.login_id.trim();
    if identity.is_empty() {
        return Err(AppError::validation("loginId is required"));
    }
    let tenant_id = resolve_tenant_id(&state, &headers).await?;
    entitlement_service::ensure_can_login(&state.db, &tenant_id).await?;
    enforce_login_rate_limit(&state, &tenant_id, identity, &headers).await?;
    let user = auth_repository::find_user_by_identity(&state.db, &tenant_id, identity)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("passkey sign-in is unavailable"))?;
    if user
        .locked_until
        .as_ref()
        .is_some_and(|until| *until > Utc::now())
    {
        return Err(AppError::rate_limited(
            "account is temporarily locked; try again later",
        ));
    }
    Ok(Json(ApiResponse::ok(
        webauthn_service::begin_authentication(&state.db, &state.settings, &tenant_id, &user.id)
            .await?,
    )))
}

pub async fn finish_passkey_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PasskeyLoginFinishRequest>,
) -> AuthApiResult<LoginResponse> {
    let expected_tenant_id = resolve_tenant_id(&state, &headers).await?;
    entitlement_service::ensure_can_login(&state.db, &expected_tenant_id).await?;
    let (tenant_id, user_id) = webauthn_service::finish_authentication(
        &state.db,
        &state.settings,
        &expected_tenant_id,
        &payload.challenge_id,
        payload.credential,
    )
    .await?;
    let user = auth_repository::find_user_by_id(&state.db, &tenant_id, &user_id)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
    let identity = user.login_id.as_deref().unwrap_or(&user.email);
    enforce_sso_policy(&state, &headers, &user, identity, "passkey").await?;
    auth_repository::mark_login_success(&state.db, &user.id)
        .await
        .map_err(|_| AppError::internal("failed to update login state"))?;
    complete_login(
        &state,
        &headers,
        &user,
        None,
        payload.device_id.as_deref(),
        identity,
        "login.passkey",
        "passkey",
    )
    .await
}

async fn enforce_sso_policy(
    state: &AppState,
    headers: &HeaderMap,
    user: &AuthUser,
    identity: &str,
    method: &str,
) -> Result<(), AppError> {
    if !sso_service::local_login_requires_sso(&state.db, &user.tenant_id, &user.role_name).await? {
        return Ok(());
    }
    audit(
        state,
        &user.tenant_id,
        Some(&user.id),
        None,
        None,
        Some(identity),
        "login.sso_enforced",
        "denied",
        &ClientContext::from_headers(headers),
        json!({ "method": method, "role": user.role_name }),
    )
    .await;
    Err(AppError::forbidden(
        "SSO sign-in is required for this account",
    ))
}

async fn resolve_tenant_id(state: &AppState, headers: &HeaderMap) -> Result<String, AppError> {
    let tenant_context = required_tenant_id(headers)?;
    auth_repository::resolve_auth_tenant_id(&state.db, &tenant_context)
        .await
        .map_err(|_| AppError::internal("failed to resolve salon workspace"))
        .and_then(|tenant_id| {
            tenant_id.ok_or_else(|| AppError::not_found("salon workspace was not found"))
        })
}

async fn complete_login(
    state: &AppState,
    headers: &HeaderMap,
    user: &AuthUser,
    requested_branch_id: Option<&str>,
    device_id: Option<&str>,
    identity: &str,
    event_type: &str,
    method: &str,
) -> AuthApiResult<LoginResponse> {
    let branches = auth_repository::list_branch_access(&state.db, user)
        .await
        .map_err(|_| AppError::internal("failed to load branch access"))?;
    let selected = match requested_branch_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(branch_id) => Some(required_branch(&branches, branch_id)?),
        None if branches.len() == 1 => branches.first(),
        None => None,
    };
    let client = ClientContext::from_headers(headers);

    if let Some(access) = selected {
        let tokens = issue_new_session(state, user, Some(access), device_id, &client).await?;
        let claims = auth_service::decode_access_token(
            &tokens.access_token,
            &state.settings.jwt_access_secret,
        )
        .map_err(|_| AppError::internal("failed to verify issued session"))?;
        audit(
            state,
            &user.tenant_id,
            Some(&user.id),
            Some(&claims.session_id),
            Some(&access.branch_id),
            Some(identity),
            event_type,
            "success",
            &client,
            json!({"role":access.role_name,"method":method}),
        )
        .await;
        let cookie = refresh_cookie(state, &tokens.refresh_token, None)?;
        return auth_response(LoginResponse::Authenticated(tokens), cookie);
    }

    if branches.is_empty() && is_platform_user(user) {
        let tokens = issue_new_session(state, user, None, device_id, &client).await?;
        let claims = auth_service::decode_access_token(
            &tokens.access_token,
            &state.settings.jwt_access_secret,
        )
        .map_err(|_| AppError::internal("failed to verify issued session"))?;
        audit(
            state,
            &user.tenant_id,
            Some(&user.id),
            Some(&claims.session_id),
            None,
            Some(identity),
            event_type,
            "success",
            &client,
            json!({"role":user.role_name,"method":method}),
        )
        .await;
        let cookie = refresh_cookie(state, &tokens.refresh_token, None)?;
        return auth_response(LoginResponse::Authenticated(tokens), cookie);
    }

    if branches.is_empty() {
        return Err(AppError::forbidden(
            "this login has no active branch access",
        ));
    }

    let selection_token = auth_service::issue_branch_selection_token(
        &user.id,
        &user.tenant_id,
        user.permission_version,
        &state.settings.jwt_access_secret,
    )
    .map_err(|_| AppError::internal("failed to issue branch selection"))?;
    let branch_event = format!("{event_type}.branch_selection");
    audit(
        state,
        &user.tenant_id,
        Some(&user.id),
        None,
        None,
        Some(identity),
        &branch_event,
        "required",
        &client,
        json!({"branchCount":branches.len(),"method":method}),
    )
    .await;
    auth_response(
        LoginResponse::BranchSelection(BranchSelectionResponse {
            requires_branch_selection: true,
            selection_token,
            branches,
        }),
        None,
    )
}

pub async fn select_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SelectBranchRequest>,
) -> AuthApiResult<auth_service::TokenPair> {
    let claims = auth_service::decode_access_token(
        &payload.selection_token,
        &state.settings.jwt_access_secret,
    )
    .map_err(|_| AppError::unauthenticated("invalid or expired branch selection token"))?;
    if claims.token_type != "branch_selection" {
        return Err(AppError::unauthenticated("invalid token type"));
    }
    let user = current_user(&state, &claims).await?;
    validate_permission_version(&user, &claims)?;
    let access = auth_repository::find_branch_access(&state.db, &user, payload.branch_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load branch access"))?
        .ok_or_else(|| {
            AppError::forbidden("this user does not have access to the requested branch")
        })?;
    consume_branch_selection_token(&state, &claims.jti).await?;
    let client = ClientContext::from_headers(&headers);
    let tokens = issue_new_session(
        &state,
        &user,
        Some(&access),
        payload.device_id.as_deref(),
        &client,
    )
    .await?;
    let issued =
        auth_service::decode_access_token(&tokens.access_token, &state.settings.jwt_access_secret)
            .map_err(|_| AppError::internal("failed to verify issued session"))?;
    audit(
        &state,
        &user.tenant_id,
        Some(&user.id),
        Some(&issued.session_id),
        Some(&access.branch_id),
        user.login_id.as_deref().or(Some(&user.email)),
        "branch.select",
        "success",
        &client,
        json!({"role":access.role_name}),
    )
    .await;
    let cookie = refresh_cookie(&state, &tokens.refresh_token, None)?;
    auth_response(tokens, cookie)
}

pub async fn switch_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<SwitchBranchRequest>>,
) -> AuthApiResult<auth_service::TokenPair> {
    let payload = payload.map(|Json(value)| value).unwrap_or_default();
    if payload.branch_id.trim().is_empty() {
        return Err(AppError::validation("branchId is required"));
    }
    let refresh_token = request_refresh_token(&headers, payload.refresh_token.as_deref())?;
    let claims = valid_refresh_claims(&state, &refresh_token)?;
    let user = current_user(&state, &claims).await?;
    validate_permission_version(&user, &claims)?;
    let access = auth_repository::find_branch_access(&state.db, &user, payload.branch_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load branch access"))?
        .ok_or_else(|| {
            AppError::forbidden("this user does not have access to the requested branch")
        })?;
    let client = ClientContext::from_headers(&headers);
    let tokens = rotate_session(
        &state,
        &user,
        &claims,
        &refresh_token,
        Some(&access),
        payload.device_id.as_deref(),
        &client,
    )
    .await?;
    audit(
        &state,
        &user.tenant_id,
        Some(&user.id),
        Some(&claims.session_id),
        Some(&access.branch_id),
        user.login_id.as_deref().or(Some(&user.email)),
        "branch.switch",
        "success",
        &client,
        json!({"role":access.role_name}),
    )
    .await;
    let cookie = refresh_cookie(&state, &tokens.refresh_token, None)?;
    auth_response(tokens, cookie)
}

pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<RefreshRequest>>,
) -> AuthApiResult<auth_service::TokenPair> {
    let payload = payload.map(|Json(value)| value).unwrap_or_default();
    let refresh_token = request_refresh_token(&headers, payload.refresh_token.as_deref())?;
    let claims = valid_refresh_claims(&state, &refresh_token)?;
    let user = current_user(&state, &claims).await?;
    validate_permission_version(&user, &claims)?;
    let branches = auth_repository::list_branch_access(&state.db, &user)
        .await
        .map_err(|_| AppError::internal("failed to load branch access"))?;
    let access = match claims.branch_id.as_deref() {
        Some(branch_id) => Some(required_branch(&branches, branch_id)?),
        None if branches.len() == 1 => branches.first(),
        None => None,
    };
    if access.is_none() && !branches.is_empty() && !is_platform_user(&user) {
        return Err(AppError::forbidden(
            "refresh token has no valid branch scope",
        ));
    }
    let client = ClientContext::from_headers(&headers);
    let tokens = rotate_session(
        &state,
        &user,
        &claims,
        &refresh_token,
        access,
        payload.device_id.as_deref(),
        &client,
    )
    .await?;
    let cookie = refresh_cookie(&state, &tokens.refresh_token, None)?;
    auth_response(tokens, cookie)
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<LogoutRequest>>,
) -> AuthApiResult<LogoutResponse> {
    let payload = payload.map(|Json(value)| value).unwrap_or_default();
    if let Ok(refresh_token) = request_refresh_token(&headers, payload.refresh_token.as_deref()) {
        if let Ok(claims) = valid_refresh_claims(&state, &refresh_token) {
            if claims.session_id.is_empty() {
                auth_repository::revoke_refresh_token(
                    &state.db,
                    &auth_service::token_hash(&refresh_token),
                )
                .await
                .ok();
            } else {
                auth_repository::revoke_session(
                    &state.db,
                    &claims.tenant_id,
                    &claims.sub,
                    &claims.session_id,
                    "logout",
                )
                .await
                .ok();
            }
        }
    }
    auth_response(
        LogoutResponse { revoked: true },
        Some(clear_refresh_cookie(&state)?),
    )
}

pub async fn me(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> ApiResult<MeResponse> {
    let token = bearer_token(&headers)?;
    let claims = auth_service::decode_access_token(token, &state.settings.jwt_access_secret)
        .map_err(|_| AppError::unauthenticated("invalid or expired bearer token"))?;
    if claims.token_type != "access" {
        return Err(AppError::unauthenticated("invalid token type"));
    }
    if is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin"
    {
        require_loopback_dev_request(peer)?;
        return Ok(Json(ApiResponse::ok(MeResponse {
            user_id: claims.sub,
            tenant_id: claims.tenant_id,
            branch_id: claims.branch_id,
            role_id: claims.role_id,
            role: claims.role,
            permissions: claims.permissions,
            permission_version: claims.permission_version,
            session_id: claims.session_id,
            branches: Vec::new(),
            must_change_password: false,
        })));
    }
    let user = current_user(&state, &claims).await?;
    validate_permission_version(&user, &claims)?;
    validate_session(&state, &claims).await?;
    let branches = auth_repository::list_branch_access(&state.db, &user)
        .await
        .map_err(|_| AppError::internal("failed to load branch access"))?;
    let access = claims
        .branch_id
        .as_deref()
        .and_then(|id| branches.iter().find(|item| item.branch_id == id));
    if claims.branch_id.is_some() && access.is_none() {
        return Err(AppError::forbidden("current branch access was removed"));
    }
    Ok(Json(ApiResponse::ok(MeResponse {
        user_id: user.id,
        tenant_id: user.tenant_id,
        branch_id: access
            .map(|item| item.branch_id.clone())
            .or(claims.branch_id),
        role_id: access
            .and_then(|item| item.role_id.clone())
            .or(user.role_id),
        role: access
            .map(|item| item.role_name.clone())
            .unwrap_or(user.role_name),
        permissions: access
            .map(|item| item.permissions.clone())
            .unwrap_or_default(),
        permission_version: user.permission_version,
        session_id: claims.session_id,
        branches,
        must_change_password: user.must_change_password,
    })))
}

fn require_loopback_dev_request(peer: SocketAddr) -> Result<(), AppError> {
    if peer.ip().is_loopback() {
        Ok(())
    } else {
        Err(AppError::not_found("auth dev session is not available"))
    }
}

pub async fn change_password(
    State(state): State<AppState>,
    Extension(claims): Extension<auth_service::AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ChangePasswordRequest>,
) -> AuthApiResult<ChangePasswordResponse> {
    if !auth_service::password_meets_policy(&payload.new_password) {
        return Err(AppError::validation(
            "newPassword must contain 12 to 128 characters",
        ));
    }
    let password_hash = auth_service::hash_password(&payload.new_password)
        .map_err(|_| AppError::internal("failed to secure password"))?;
    let changed = auth_repository::change_password_and_revoke_sessions(
        &state.db,
        &claims.tenant_id,
        &claims.sub,
        &password_hash,
    )
    .await
    .map_err(|_| AppError::internal("failed to change password"))?;
    if !changed {
        return Err(AppError::not_found("active user was not found"));
    }
    let client = ClientContext::from_headers(&headers);
    audit(
        &state,
        &claims.tenant_id,
        Some(&claims.sub),
        Some(&claims.session_id),
        claims.branch_id.as_deref(),
        None,
        "password.changed",
        "success",
        &client,
        json!({"reauthenticationRequired":true}),
    )
    .await;
    auth_response(
        ChangePasswordResponse {
            password_changed: true,
            reauthentication_required: true,
        },
        Some(clear_refresh_cookie(&state)?),
    )
}

async fn issue_new_session(
    state: &AppState,
    user: &AuthUser,
    access: Option<&BranchAccess>,
    device_id: Option<&str>,
    client: &ClientContext,
) -> Result<auth_service::TokenPair, AppError> {
    let session_id = Uuid::new_v4().to_string();
    let role = access
        .map(|item| item.role_name.as_str())
        .unwrap_or(&user.role_name);
    let permissions = access
        .map(|item| item.permissions.as_slice())
        .unwrap_or(&[]);
    let mfa_enrollment_required = security_service::mfa_enrollment_required(
        &state.db,
        &user.tenant_id,
        &user.id,
        role,
        permissions,
    )
    .await?;
    security_service::ensure_device_allowed(
        &state.db,
        &user.tenant_id,
        access.map(|item| item.branch_id.as_str()),
        &user.id,
        device_id,
    )
    .await?;
    let (tokens, expires_at) = auth_service::issue_scoped_token_pair(
        TokenScope {
            user_id: &user.id,
            tenant_id: &user.tenant_id,
            branch_id: access.map(|item| item.branch_id.as_str()),
            role_id: access
                .and_then(|item| item.role_id.as_deref())
                .or(user.role_id.as_deref()),
            role,
            permissions,
            permission_version: user.permission_version,
            session_id: &session_id,
            must_change_password: user.must_change_password,
            mfa_enrollment_required,
        },
        &state.settings.jwt_access_secret,
        &state.settings.jwt_refresh_secret,
        state.settings.jwt_access_ttl_minutes,
        state.settings.jwt_refresh_ttl_days,
    )
    .map_err(|_| AppError::internal("failed to issue tokens"))?;
    let token_hash = auth_service::token_hash(&tokens.refresh_token);
    auth_repository::save_refresh_token(
        &state.db,
        &SessionTokenInput {
            tenant_id: &user.tenant_id,
            user_id: &user.id,
            session_id: &session_id,
            token_hash: &token_hash,
            branch_id: access.map(|item| item.branch_id.as_str()),
            role_name: role,
            permission_version: user.permission_version,
            device_id,
            ip_address: client.ip_address.as_deref(),
            user_agent: client.user_agent.as_deref(),
            expires_at,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to save session"))?;
    Ok(tokens)
}

async fn rotate_session(
    state: &AppState,
    user: &AuthUser,
    claims: &auth_service::AuthClaims,
    old_refresh_token: &str,
    access: Option<&BranchAccess>,
    device_id: Option<&str>,
    client: &ClientContext,
) -> Result<auth_service::TokenPair, AppError> {
    let old_token_hash = auth_service::token_hash(old_refresh_token);
    let session_id = if claims.session_id.is_empty() {
        auth_repository::session_id_for_token(&state.db, &user.tenant_id, &user.id, &old_token_hash)
            .await
            .map_err(|_| AppError::internal("failed to load session"))?
            .ok_or_else(|| AppError::unauthenticated("refresh token is not active"))?
    } else {
        claims.session_id.clone()
    };
    let role = access
        .map(|item| item.role_name.as_str())
        .unwrap_or(&user.role_name);
    let permissions = access
        .map(|item| item.permissions.as_slice())
        .unwrap_or(&[]);
    let mfa_enrollment_required = security_service::mfa_enrollment_required(
        &state.db,
        &user.tenant_id,
        &user.id,
        role,
        permissions,
    )
    .await?;
    security_service::ensure_device_allowed(
        &state.db,
        &user.tenant_id,
        access.map(|item| item.branch_id.as_str()),
        &user.id,
        device_id,
    )
    .await?;
    let (tokens, expires_at) = auth_service::issue_scoped_token_pair(
        TokenScope {
            user_id: &user.id,
            tenant_id: &user.tenant_id,
            branch_id: access.map(|item| item.branch_id.as_str()),
            role_id: access
                .and_then(|item| item.role_id.as_deref())
                .or(user.role_id.as_deref()),
            role,
            permissions,
            permission_version: user.permission_version,
            session_id: &session_id,
            must_change_password: user.must_change_password,
            mfa_enrollment_required,
        },
        &state.settings.jwt_access_secret,
        &state.settings.jwt_refresh_secret,
        state.settings.jwt_access_ttl_minutes,
        state.settings.jwt_refresh_ttl_days,
    )
    .map_err(|_| AppError::internal("failed to issue tokens"))?;
    let token_hash = auth_service::token_hash(&tokens.refresh_token);
    let rotated = auth_repository::rotate_refresh_token(
        &state.db,
        &old_token_hash,
        &SessionTokenInput {
            tenant_id: &user.tenant_id,
            user_id: &user.id,
            session_id: &session_id,
            token_hash: &token_hash,
            branch_id: access.map(|item| item.branch_id.as_str()),
            role_name: role,
            permission_version: user.permission_version,
            device_id,
            ip_address: client.ip_address.as_deref(),
            user_agent: client.user_agent.as_deref(),
            expires_at,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to rotate refresh token"))?;
    if !rotated {
        auth_repository::revoke_session(
            &state.db,
            &user.tenant_id,
            &user.id,
            &session_id,
            "refresh_reuse_detected",
        )
        .await
        .ok();
        return Err(AppError::unauthenticated("refresh token is not active"));
    }
    Ok(tokens)
}

fn required_branch<'a>(
    branches: &'a [BranchAccess],
    branch_id: &str,
) -> Result<&'a BranchAccess, AppError> {
    branches
        .iter()
        .find(|access| access.branch_id == branch_id)
        .ok_or_else(|| {
            AppError::forbidden("this user does not have access to the requested branch")
        })
}

async fn current_user(
    state: &AppState,
    claims: &auth_service::AuthClaims,
) -> Result<AuthUser, AppError> {
    entitlement_service::ensure_can_login(&state.db, &claims.tenant_id).await?;
    auth_repository::find_user_by_id(&state.db, &claims.tenant_id, &claims.sub)
        .await
        .map_err(|_| AppError::internal("failed to load user"))?
        .ok_or_else(|| AppError::unauthenticated("user is not active"))
}

fn validate_permission_version(
    user: &AuthUser,
    claims: &auth_service::AuthClaims,
) -> Result<(), AppError> {
    if claims.permission_version != 0 && claims.permission_version != user.permission_version {
        return Err(AppError::unauthenticated(
            "user permissions changed; please sign in again",
        ));
    }
    Ok(())
}

async fn validate_session(
    state: &AppState,
    claims: &auth_service::AuthClaims,
) -> Result<(), AppError> {
    if claims.session_id.is_empty() {
        return Ok(());
    }
    let active = auth_repository::is_session_active(
        &state.db,
        &claims.tenant_id,
        &claims.sub,
        &claims.session_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate session"))?;
    if !active {
        return Err(AppError::unauthenticated("session is no longer active"));
    }
    Ok(())
}

fn valid_refresh_claims(
    state: &AppState,
    token: &str,
) -> Result<auth_service::AuthClaims, AppError> {
    let claims = auth_service::decode_refresh_token(token, &state.settings.jwt_refresh_secret)
        .map_err(|_| AppError::unauthenticated("invalid or expired refresh token"))?;
    if claims.token_type != "refresh" {
        return Err(AppError::unauthenticated("invalid token type"));
    }
    Ok(claims)
}

fn required_tenant_id(headers: &HeaderMap) -> Result<String, AppError> {
    headers
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation("x-tenant-id is required"))
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthenticated("missing bearer token"))
}

/// Returns the refresh token and whether it came from the cookie. A token
/// supplied in the request body is not an ambient credential (native clients
/// hold it themselves), so CSRF does not apply to it; a cookie-borne token is
/// ambient and must be accompanied by a matching CSRF token.
fn request_refresh_token_with_source(
    headers: &HeaderMap,
    body_token: Option<&str>,
) -> Result<(String, bool), AppError> {
    if let Some(token) = body_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    {
        return Ok((token, false));
    }
    cookie(headers, REFRESH_COOKIE)
        .map(|token| (token, true))
        .ok_or_else(|| AppError::unauthenticated("refresh token is required"))
}

fn request_refresh_token(
    headers: &HeaderMap,
    body_token: Option<&str>,
) -> Result<String, AppError> {
    let (token, from_cookie) = request_refresh_token_with_source(headers, body_token)?;
    if from_cookie {
        verify_csrf(headers)?;
    }
    Ok(token)
}

/// Double-submit check: the `x-csrf-token` header must match the CSRF cookie.
/// Both are set by `GET /auth/csrf`; an attacker on another origin can send
/// the cookie but cannot read it to populate the header.
fn verify_csrf(headers: &HeaderMap) -> Result<(), AppError> {
    let cookie_token = cookie(headers, CSRF_COOKIE)
        .ok_or_else(|| AppError::forbidden("CSRF token is required for cookie sessions"))?;
    let header_token = headers
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::forbidden("CSRF token is required for cookie sessions"))?;
    if !constant_time_eq(cookie_token.as_bytes(), header_token.as_bytes()) {
        return Err(AppError::forbidden("CSRF token mismatch"));
    }
    Ok(())
}


fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|item| {
                let (key, value) = item.trim().split_once('=')?;
                (key == name).then(|| value.to_string())
            })
        })
}

fn refresh_cookie(
    state: &AppState,
    refresh_token: &str,
    max_age: Option<u64>,
) -> Result<Option<HeaderValue>, AppError> {
    let max_age = max_age.unwrap_or(state.settings.jwt_refresh_ttl_days * 86_400);
    Ok(Some(cookie_header(state, refresh_token, max_age)?))
}

fn clear_refresh_cookie(state: &AppState) -> Result<HeaderValue, AppError> {
    cookie_header(state, "", 0)
}

fn cookie_header(state: &AppState, value: &str, max_age: u64) -> Result<HeaderValue, AppError> {
    let secure = if is_local_env(&state.settings.app_env) {
        ""
    } else {
        "; Secure"
    };
    HeaderValue::from_str(&format!(
        "{REFRESH_COOKIE}={value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"
    ))
    .map_err(|_| AppError::internal("failed to create secure session cookie"))
}

fn auth_response<T>(data: T, cookie: Option<HeaderValue>) -> AuthApiResult<T> {
    let mut headers = HeaderMap::new();
    if let Some(cookie) = cookie {
        headers.insert(header::SET_COOKIE, cookie);
    }
    Ok((headers, Json(ApiResponse::ok(data))))
}

fn is_platform_user(user: &AuthUser) -> bool {
    user.tenant_id.eq_ignore_ascii_case("platform")
        && user.role_name.to_ascii_lowercase().replace(['-', '_'], "") == "superadmin"
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

#[derive(Default)]
struct ClientContext {
    ip_address: Option<String>,
    user_agent: Option<String>,
}

impl ClientContext {
    fn from_headers(headers: &HeaderMap) -> Self {
        Self {
            ip_address: headers
                .get("x-aurashine-source-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            user_agent: headers
                .get(header::USER_AGENT)
                .and_then(|value| value.to_str().ok())
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn audit(
    state: &AppState,
    tenant_id: &str,
    user_id: Option<&str>,
    session_id: Option<&str>,
    branch_id: Option<&str>,
    identity: Option<&str>,
    event_type: &str,
    outcome: &str,
    client: &ClientContext,
    details: serde_json::Value,
) {
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id,
            user_id,
            session_id,
            branch_id,
            identity,
            event_type,
            outcome,
            ip_address: client.ip_address.as_deref(),
            user_agent: client.user_agent.as_deref(),
            details,
        },
    )
    .await;
}

async fn enforce_login_rate_limit(
    state: &AppState,
    tenant_id: &str,
    identity: &str,
    headers: &HeaderMap,
) -> Result<(), AppError> {
    let ip = ClientContext::from_headers(headers)
        .ip_address
        .unwrap_or_else(|| "direct".to_string());
    let key = format!(
        "auth_login_rate:{}:{}:{}",
        tenant_id.trim().to_lowercase(),
        identity.trim().to_lowercase(),
        ip
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

async fn consume_branch_selection_token(state: &AppState, jti: &str) -> Result<(), AppError> {
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "AUTH_STATE_STORE_UNAVAILABLE",
                "branch selection state store is unavailable",
            )
        })?;
    let consumed: Option<String> = redis::cmd("SET")
        .arg(format!("auth_branch_selection:{jti}"))
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(300)
        .query_async(&mut redis)
        .await
        .map_err(|_| {
            AppError::service_unavailable(
                "AUTH_STATE_STORE_UNAVAILABLE",
                "branch selection state store is unavailable",
            )
        })?;
    if consumed.is_none() {
        return Err(AppError::unauthenticated(
            "branch selection token was already used",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use axum::http::{header, HeaderMap, HeaderValue};

    use super::{request_refresh_token, request_refresh_token_with_source, verify_csrf};

    fn headers(cookie: Option<&str>, csrf_header: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(cookie) = cookie {
            headers.insert(header::COOKIE, HeaderValue::from_str(cookie).unwrap());
        }
        if let Some(csrf) = csrf_header {
            headers.insert("x-csrf-token", HeaderValue::from_str(csrf).unwrap());
        }
        headers
    }

    #[test]
    fn body_refresh_tokens_are_not_ambient_and_skip_csrf() {
        let (token, from_cookie) =
            request_refresh_token_with_source(&HeaderMap::new(), Some("native-token")).unwrap();
        assert_eq!(token, "native-token");
        assert!(!from_cookie);
        // Native clients hold the token themselves, so no CSRF is required.
        assert!(request_refresh_token(&HeaderMap::new(), Some("native-token")).is_ok());
    }

    #[test]
    fn cookie_refresh_requires_a_matching_csrf_token() {
        let cookie = "aurashine_refresh_token=refresh-1; aurashine_csrf=csrf-1";
        let (token, from_cookie) =
            request_refresh_token_with_source(&headers(Some(cookie), None), None).unwrap();
        assert_eq!(token, "refresh-1");
        assert!(from_cookie);

        // Missing header, wrong header, and missing cookie all fail.
        assert!(request_refresh_token(&headers(Some(cookie), None), None).is_err());
        assert!(request_refresh_token(&headers(Some(cookie), Some("wrong")), None).is_err());
        assert!(request_refresh_token(
            &headers(Some("aurashine_refresh_token=refresh-1"), Some("csrf-1")),
            None
        )
        .is_err());

        // Matching double-submit succeeds.
        assert!(request_refresh_token(&headers(Some(cookie), Some("csrf-1")), None).is_ok());
    }

    #[test]
    fn csrf_comparison_rejects_partial_and_empty_matches() {
        let cookie = "aurashine_csrf=abcdef";
        assert!(verify_csrf(&headers(Some(cookie), Some("abcdef"))).is_ok());
        assert!(verify_csrf(&headers(Some(cookie), Some("abcde"))).is_err());
        assert!(verify_csrf(&headers(Some(cookie), Some("abcdefg"))).is_err());
        assert!(verify_csrf(&headers(Some(cookie), Some("   "))).is_err());
        assert!(verify_csrf(&headers(None, Some("abcdef"))).is_err());
    }
}
