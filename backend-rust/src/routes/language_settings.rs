use axum::{extract::State, http::HeaderMap, routing::get, Extension, Json, Router};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, language_settings_service as service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/language", get(get_settings))
        .route(
            "/settings/language/tenant",
            axum::routing::patch(save_tenant),
        )
        .route("/settings/language/me", axum::routing::patch(save_me))
}

async fn get_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<service::LanguageSettingsView> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        service::settings(&state.db, &tenant_id, &claims.sub, can_manage(&claims)).await?,
    )))
}

async fn save_tenant(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<service::TenantLanguageSettings>,
) -> ApiResult<service::LanguageSettingsView> {
    if !can_manage(&claims) {
        return Err(AppError::forbidden(
            "settings management permission is required",
        ));
    }
    let (tenant_id, _) = tenant_branch(&headers)?;
    service::save_tenant_settings(&state.db, &tenant_id, &claims.sub, payload).await?;
    Ok(Json(ApiResponse::ok(
        service::settings(&state.db, &tenant_id, &claims.sub, true).await?,
    )))
}

async fn save_me(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<service::UserLanguagePreference>,
) -> ApiResult<service::LanguageSettingsView> {
    let (tenant_id, _) = tenant_branch(&headers)?;
    service::save_user_preference(&state.db, &tenant_id, &claims.sub, payload).await?;
    Ok(Json(ApiResponse::ok(
        service::settings(&state.db, &tenant_id, &claims.sub, can_manage(&claims)).await?,
    )))
}

fn can_manage(claims: &AuthClaims) -> bool {
    !claims
        .denied_permissions
        .iter()
        .any(|permission| permission == "settings.manage")
        && (matches!(claims.role.to_ascii_lowercase().as_str(), "owner" | "admin")
            || claims
                .permissions
                .iter()
                .any(|permission| permission == "settings.manage"))
}
