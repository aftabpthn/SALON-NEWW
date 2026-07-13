use crate::{
    config::is_local_env,
    middleware::{auth as auth_middleware, tenant as tenant_middleware},
    state::AppState,
};
use axum::{
    http::{header, HeaderName, HeaderValue, Method},
    middleware::from_fn_with_state,
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

pub mod appointment_activity;
pub mod appointments;
pub mod auth;
pub mod availability;
pub mod booking_extensions;
pub mod booking_portal;
pub mod booking_portal_v2;
pub mod cash_drawer;
pub mod clients;
mod context;
pub mod health;
pub mod inventory;
pub mod inventory_transfers;
pub mod invoice_webhooks;
pub mod membership_enterprise;
pub mod memberships;
pub mod notifications;
pub mod packages;
pub mod pos;
pub mod purchases;
pub mod realtime;
pub mod reports;
pub mod services;
pub mod staff;
pub mod staff_schedule;
pub mod wallets;

pub fn build_router(state: AppState) -> Router {
    let with_state = state.clone();
    let cors = cors_layer(&state);
    let public_api = Router::new()
        .route("/health", axum::routing::get(health::health))
        .route("/", axum::routing::get(health::root))
        .merge(auth::router())
        .merge(booking_portal::router())
        .merge(booking_portal_v2::router())
        .merge(realtime::router())
        .merge(invoice_webhooks::router())
        .merge(booking_extensions::public_router());

    let protected_api = Router::new()
        .merge(clients::router())
        .merge(staff::router())
        .merge(staff_schedule::router())
        .merge(services::router())
        .merge(wallets::router())
        .merge(appointment_activity::router())
        .merge(appointments::router())
        .merge(availability::router())
        .merge(pos::router())
        .merge(purchases::router())
        .merge(cash_drawer::router())
        .merge(inventory::router())
        .merge(inventory_transfers::router())
        .merge(memberships::router())
        .merge(membership_enterprise::router())
        .merge(packages::router())
        .merge(reports::router())
        .merge(booking_extensions::protected_router())
        .merge(notifications::router())
        .route_layer(axum::middleware::from_fn(
            tenant_middleware::require_route_role,
        ))
        .route_layer(from_fn_with_state(
            with_state.clone(),
            tenant_middleware::require_tenant_id,
        ))
        .route_layer(from_fn_with_state(
            with_state,
            auth_middleware::require_auth,
        ));

    let api = public_api.merge(protected_api);

    Router::new()
        .route("/", axum::routing::get(health::root))
        .route("/health", axum::routing::get(health::health))
        .nest("/api/v1", api.clone())
        .nest("/api", api)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

fn cors_layer(state: &AppState) -> CorsLayer {
    if state.settings.cors_allowed_origins.is_empty() {
        if is_local_env(&state.settings.app_env) {
            return CorsLayer::permissive();
        }

        return CorsLayer::new();
    }

    let origins = state
        .settings
        .cors_allowed_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect::<Vec<_>>();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            HeaderName::from_static("x-tenant-id"),
            HeaderName::from_static("x-branch-id"),
            HeaderName::from_static("x-public-booking-token"),
        ])
        .allow_credentials(true)
}
