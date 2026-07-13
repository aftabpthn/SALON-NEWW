use axum::{
    body::Body,
    extract::{Request, State},
    http::HeaderValue,
    middleware::Next,
    response::Response,
};

use crate::{
    config::is_local_env,
    models::common::AppError,
    repositories::auth_repository,
    services::auth_service::{self, AuthClaims},
    state::AppState,
};

#[allow(dead_code)]
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthenticated("missing bearer token"))?;

    let mut claims = auth_service::decode_access_token(token, &state.settings.jwt_access_secret)
        .map_err(|_| AppError::unauthenticated("invalid or expired bearer token"))?;

    if claims.token_type != "access" {
        return Err(AppError::unauthenticated("invalid token type"));
    }

    if !(is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin")
    {
        let user = auth_repository::find_user_by_id(&state.db, &claims.tenant_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to validate user session"))?
            .ok_or_else(|| AppError::unauthenticated("user is not active"))?;

        claims.tenant_id = user.tenant_id;
        claims.branch_id = user.branch_id;
        claims.role = user.role_name;
    }

    if let Some(header_tenant_id) = req
        .headers()
        .get("x-tenant-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if header_tenant_id != claims.tenant_id {
            return Err(AppError::forbidden("tenant context does not match token"));
        }
    }

    if let Some(claim_branch_id) = claims
        .branch_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(header_branch_id) = req
            .headers()
            .get("x-branch-id")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if header_branch_id != claim_branch_id {
                return Err(AppError::forbidden("branch context does not match token"));
            }
        }
    }

    let tenant_header = HeaderValue::from_str(&claims.tenant_id)
        .map_err(|_| AppError::unauthenticated("invalid tenant claim"))?;
    req.headers_mut().insert("x-tenant-id", tenant_header);
    if let Some(branch_id) = claims
        .branch_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let branch_header = HeaderValue::from_str(branch_id)
            .map_err(|_| AppError::unauthenticated("invalid branch claim"))?;
        req.headers_mut().insert("x-branch-id", branch_header);
    }

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}

#[allow(dead_code)]
pub fn current_claims(req: &Request<Body>) -> Option<&AuthClaims> {
    req.extensions().get::<AuthClaims>()
}
