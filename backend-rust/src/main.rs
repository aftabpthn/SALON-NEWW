mod config;
mod handlers;
mod infrastructure;
mod middleware;
mod models;
mod repositories;
mod routes;
mod services;
mod state;

use std::{net::SocketAddr, time::Duration};

use anyhow::Result;
use axum::serve;
use chrono::Utc;
use state::AppState;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new("info"))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let settings = config::Settings::load()?;
    let db = infrastructure::db::create_pool(&settings.database_url).await?;
    let redis = infrastructure::cache::create_client(&settings.redis_url).await?;
    let state = AppState::new(settings.clone(), db, redis);

    if state.settings.invoice_delivery_configured() {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            let mut last_reminder_date = None;
            loop {
                interval.tick().await;
                let today = Utc::now().date_naive();
                if last_reminder_date != Some(today) {
                    match routes::pos::schedule_due_invoice_reminders_worker(&worker_state).await {
                        Ok(_) => last_reminder_date = Some(today),
                        Err(_) => tracing::warn!("invoice due-reminder scheduling failed"),
                    }
                }
                if routes::pos::run_invoice_outbox_worker(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("invoice delivery worker cycle failed");
                }
            }
        });
    }

    let app = routes::build_router(state);
    let addr: SocketAddr = format!("{}:{}", settings.app_host, settings.app_port).parse()?;

    let listener = TcpListener::bind(addr).await?;
    tracing::info!("aura-shine-backend listening on {}", addr);
    serve(listener, app).await?;

    Ok(())
}
