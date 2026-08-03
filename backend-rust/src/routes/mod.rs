use crate::{
    config::is_local_env,
    middleware::{
        auth as auth_middleware, request_timing as request_timing_middleware,
        security_headers as security_headers_middleware, tenant as tenant_middleware,
    },
    state::AppState,
};
use axum::{
    http::{header, HeaderName, HeaderValue, Method},
    middleware::from_fn_with_state,
    Router,
};
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};

pub mod ai_concierge;
pub mod ai_copilot;
pub mod appointment_activity;
pub mod appointments;
pub mod auth;
pub mod availability;
pub mod balance_sheet;
pub mod birthday_anniversary;
pub mod booking_extensions;
pub mod booking_portal;
pub mod booking_portal_v2;
pub mod branches;
pub mod cash_drawer;
pub mod clients;
pub(crate) mod context;
pub mod customer_portal;
pub mod fitness;
pub mod health;
pub mod integrations;
pub mod inventory;
pub mod inventory_governance;
pub mod inventory_transfers;
pub mod invoice_webhooks;
pub mod kiosk;
pub mod language_settings;
pub mod laundry;
pub mod marketing_leads;
pub mod membership_enterprise;
pub mod memberships;
pub mod metrics;
pub mod notifications;
pub mod operations;
pub mod organization;
pub mod outgoing_funds;
pub mod packages;
pub mod payment_platform;
pub mod pos;
pub mod pos_enterprise;
pub mod pos_legacy_completion;
pub mod purchase_bill_drafts;
pub mod purchases;
pub mod realtime;
pub mod reports;
pub mod retention;
pub mod saas;
pub mod scim;
pub mod security;
pub mod services;
pub mod staff;
pub mod staff_advance;
pub mod staff_advanced;
pub mod staff_attendance;
pub mod staff_enterprise;
pub mod staff_hrms;
pub mod staff_leave;
pub mod staff_operations;
pub mod staff_payroll;
pub mod staff_schedule;
pub mod stock_audit;
pub mod wallets;
pub mod whatsapp;

pub fn build_router(state: AppState) -> Router {
    let with_state = state.clone();
    let cors = cors_layer(&state);
    let public_api = Router::new()
        .route("/health", axum::routing::get(health::health))
        .route("/", axum::routing::get(health::root))
        .merge(auth::router())
        .merge(ai_concierge::public_router())
        .merge(booking_portal::router())
        .merge(booking_portal_v2::router())
        .merge(fitness::public_router())
        .merge(kiosk::public_router())
        .merge(customer_portal::router())
        .merge(realtime::router())
        .merge(invoice_webhooks::router())
        .route(
            "/booking-payments/webhook/razorpay",
            axum::routing::post(invoice_webhooks::receive_razorpay_webhook),
        )
        .merge(staff_advanced::public_router())
        .merge(staff_schedule::public_router())
        .merge(membership_enterprise::public_router())
        .merge(booking_extensions::public_router())
        .merge(pos_enterprise::public_router())
        .merge(payment_platform::public_router())
        .merge(scim::router())
        .merge(integrations::public_router())
        .merge(operations::public_router());

    let protected_api = Router::new()
        .merge(auth::protected_router())
        .merge(ai_concierge::router())
        .merge(ai_copilot::router())
        .merge(balance_sheet::router())
        .merge(branches::router())
        .merge(birthday_anniversary::router())
        .merge(clients::router())
        .merge(staff::router())
        .merge(staff_advance::router())
        .merge(staff_advanced::router())
        .merge(staff_enterprise::router())
        .merge(staff_attendance::router())
        .merge(staff_leave::router())
        .merge(staff_hrms::router())
        .merge(staff_operations::router())
        .merge(staff_payroll::router())
        .merge(staff_schedule::router())
        .merge(services::router())
        .merge(wallets::router())
        .merge(appointment_activity::router())
        .merge(appointments::router())
        .merge(availability::router())
        .merge(fitness::router())
        .merge(kiosk::router())
        .merge(pos::router())
        .merge(pos_enterprise::router())
        .merge(pos_legacy_completion::router())
        .merge(payment_platform::router())
        .merge(purchases::router())
        .merge(purchase_bill_drafts::router())
        .merge(cash_drawer::router())
        .merge(inventory::router())
        .merge(inventory_governance::router())
        .merge(inventory_reorder_forecasts::router())
        .merge(stock_audit::router())
        .merge(inventory_transfers::router())
        .merge(language_settings::router())
        .merge(memberships::router())
        .merge(membership_enterprise::router())
        .merge(packages::router())
        .merge(outgoing_funds::router())
        .merge(reports::router())
        .merge(retention::router())
        .merge(saas::router())
        .merge(security::router())
        .merge(booking_extensions::protected_router())
        .merge(integrations::router())
        .merge(laundry::router())
        .merge(marketing_leads::router())
        .merge(notifications::router())
        .merge(operations::router())
        .merge(organization::router())
        .merge(whatsapp::router())
        .route_layer(from_fn_with_state(
            with_state.clone(),
            tenant_middleware::require_inventory_idempotency,
        ))
        .route_layer(from_fn_with_state(
            with_state.clone(),
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
        // Deliberately outside /api/v1: scrapers hit it without a tenant, and it
        // carries its own bearer token rather than a session.
        .route("/metrics", axum::routing::get(metrics::metrics))
        .nest("/api/v1", api.clone())
        .nest("/api", api)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(from_fn_with_state(
            state.clone(),
            request_timing_middleware::request_timing,
        ))
        .layer(cors)
        .layer(from_fn_with_state(
            state.clone(),
            security_headers_middleware::add_security_headers,
        ))
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
            HeaderName::from_static("x-api-key"),
            HeaderName::from_static("x-device-id"),
            HeaderName::from_static("x-request-id"),
            HeaderName::from_static("idempotency-key"),
        ])
        .allow_credentials(true)
}

pub mod inventory_reorder_forecasts;
