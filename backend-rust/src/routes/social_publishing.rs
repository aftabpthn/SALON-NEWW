use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::social_publishing_repository::SocialPublication,
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, social_publishing_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/marketing/social-publications", get(list).post(create))
        .route("/marketing/social-publications/:id/cancel", post(cancel))
        .route("/marketing/social-publications/:id/retry", post(retry))
}

async fn list(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<SocialPublication>> {
    require_permission(&claims, false)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        social_publishing_service::list(&state, &tenant, &branch).await?,
    )))
}

async fn create(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<social_publishing_service::SocialPublicationWrite>,
) -> ApiResult<SocialPublication> {
    require_permission(&claims, true)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        social_publishing_service::create(&state, &tenant, &branch, &claims.sub, request).await?,
    )))
}

async fn cancel(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<SocialPublication> {
    require_permission(&claims, true)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        social_publishing_service::cancel(&state, &tenant, &branch, &claims.sub, id).await?,
    )))
}

async fn retry(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<uuid::Uuid>,
) -> ApiResult<SocialPublication> {
    require_permission(&claims, true)?;
    let (tenant, branch) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        social_publishing_service::retry(&state, &tenant, &branch, &claims.sub, id).await?,
    )))
}

fn require_permission(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    let allowed = matches!(claims.role.as_str(), "owner" | "admin")
        || claims.permissions.iter().any(|permission| {
            if write {
                matches!(permission.as_str(), "marketing.manage" | "marketing.send")
            } else {
                matches!(
                    permission.as_str(),
                    "marketing.read" | "marketing.manage" | "marketing.send"
                )
            }
        });
    if allowed {
        Ok(())
    } else {
        Err(AppError::forbidden("marketing permission is required"))
    }
}
