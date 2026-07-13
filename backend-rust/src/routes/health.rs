use axum::{extract::State, Json};
use serde::Serialize;
use serde_json::json;

use crate::infrastructure::cache;
use crate::models::common::{ApiResponse, ApiResult, AppError};
use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
    service: &'static str,
    environment: String,
    dependencies: DependencyStatus,
}

#[derive(Serialize)]
pub struct DependencyStatus {
    postgres: &'static str,
    redis: &'static str,
}

#[derive(Serialize)]
pub struct RootResponse {
    service: &'static str,
    api_version: &'static str,
    health_path: &'static str,
}

pub async fn health(State(state): State<AppState>) -> ApiResult<HealthResponse> {
    let postgres_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    let redis_ok = cache::ping(&state.redis).await.is_ok();

    if !postgres_ok || !redis_ok {
        return Err(AppError::service_unavailable(
            "DEPENDENCY_UNAVAILABLE",
            "A required backend dependency is unavailable",
        )
        .with_details(json!({
            "postgres": if postgres_ok { "ok" } else { "down" },
            "redis": if redis_ok { "ok" } else { "down" }
        })));
    }

    Ok(Json(ApiResponse::ok(HealthResponse {
        status: "ok",
        service: "aura-shine-backend",
        environment: state.settings.app_env,
        dependencies: DependencyStatus {
            postgres: "ok",
            redis: "ok",
        },
    })))
}

pub async fn root() -> Json<ApiResponse<RootResponse>> {
    Json(ApiResponse::ok(RootResponse {
        service: "aura-shine-backend",
        api_version: "v1",
        health_path: "/api/v1/health",
    }))
}
