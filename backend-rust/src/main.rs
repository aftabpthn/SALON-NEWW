#![recursion_limit = "256"]

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

use anyhow::{Context, Result};
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
    let db = infrastructure::db::create_pool(&settings.database_url)
        .await
        .context("Unable to initialize PostgreSQL pool")?;

    services::staff_payroll_service::protect_legacy_statutory_pii(
        &db,
        settings.security_encryption_key.as_deref(),
    )
    .await
    .map_err(|error| anyhow::anyhow!("Unable to protect statutory PII: {}", error.message()))?;

    if std::env::args().any(|arg| arg == "--migrate-only") {
        tracing::info!("database migrations completed");
        db.close().await;
        return Ok(());
    }

    tokio::time::timeout(
        Duration::from_secs(5),
        sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&db),
    )
    .await
    .context("Database readiness check timed out")?
    .context("Database readiness check failed")?;

    let redis = infrastructure::cache::create_client(&settings.redis_url)
        .await
        .context("Unable to initialize Redis client")?;

    tokio::time::timeout(Duration::from_secs(5), infrastructure::cache::ping(&redis))
        .await
        .context("Redis ping timed out")?
        .context("Redis ping check failed")?;
    let state = AppState::new(settings.clone(), db, redis);
    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if services::staff_attendance_service::schedule_forgot_clock_out_reminders(
                    &worker_state.db,
                )
                .await
                .is_err()
                {
                    tracing::warn!("forgot-clock-out reminder cycle failed");
                }
                if services::staff_notification_service::process_automation(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("staff notification automation cycle failed");
                }
            }
        });
    }
    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if services::saas_service::escalate_due_tickets(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("support SLA escalation cycle failed");
                }
            }
        });
    }
    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                if services::report_export_service::process_due(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("report export worker cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(900));
            loop {
                interval.tick().await;
                if services::client_service::refresh_intelligence_snapshots(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("client intelligence snapshot refresh failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if routes::appointments::expire_waitlist_offers(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("waitlist offer expiry cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(21_600));
            loop {
                interval.tick().await;
                if services::ai_concierge_service::purge_expired_transcripts(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("AI transcript retention cycle failed");
                }
                if repositories::communication_repository::redact_expired_content(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("communication retention cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(21_600));
            loop {
                interval.tick().await;
                if services::staff_hrms_service::run_scheduled_operations_intelligence(
                    &worker_state.db,
                )
                .await
                .is_err()
                {
                    tracing::warn!("scheduled HRMS owner-summary cycle failed");
                }
            }
        });
    }

    {
        // Proactive briefing. Six-hourly rather than daily so a restart cannot
        // skip a day; the per-signal cooldown is what stops it repeating.
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(
                services::ai_briefing_service::BRIEFING_WORKER_INTERVAL_SECONDS,
            ));
            loop {
                interval.tick().await;
                if services::ai_briefing_service::run_daily_briefing_worker(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("AI daily briefing cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(21_600));
            loop {
                interval.tick().await;
                if services::happy_hours_service::run_auto_sunset_worker(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("Happy Hours auto-sunset cycle failed");
                }
            }
        });
    }

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
                if services::saas_service::process_support_email_outbox(
                    &worker_state.db,
                    &worker_state.settings,
                )
                .await
                .is_err()
                {
                    tracing::warn!("support email delivery worker cycle failed");
                }
                if routes::pos_legacy_completion::process_due_daily_reports_worker(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("POS daily-report delivery cycle failed");
                }
                if services::analytics_service::process_due_custom_reports(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("custom report delivery cycle failed");
                }
                if services::inventory_governance_service::process_due_communications(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("inventory supplier communication cycle failed");
                }
            }
        });
    }

    if state.settings.benefit_delivery_configured() {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if services::benefit_notification_service::schedule(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("benefit and campaign scheduling failed");
                }
                if services::benefit_notification_service::process_due(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("benefit and campaign delivery cycle failed");
                }
            }
        });
    }

    if state.settings.security_encryption_key.is_some() {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                if services::integration_service::process_webhooks(
                    &worker_state.db,
                    &worker_state.settings,
                )
                .await
                .is_err()
                {
                    tracing::warn!("integration webhook delivery cycle failed");
                }
                if services::integration_service::process_connector_sync_jobs(
                    &worker_state.db,
                    &worker_state.settings,
                )
                .await
                .is_err()
                {
                    tracing::warn!("integration connector sync cycle failed");
                }
            }
        });
    }

    if state.settings.mobile_push_provider_enabled() {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                if services::team_chat_service::process_push_deliveries(
                    &worker_state.db,
                    worker_state
                        .settings
                        .mobile_push_provider_url
                        .as_deref()
                        .unwrap_or_default(),
                    worker_state
                        .settings
                        .mobile_push_provider_token
                        .as_deref()
                        .unwrap_or_default(),
                    worker_state
                        .settings
                        .security_encryption_key
                        .as_deref()
                        .unwrap_or_default(),
                )
                .await
                .is_err()
                {
                    tracing::warn!("mobile push delivery cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                interval.tick().await;
                if services::migration_service::process_due(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("data import worker cycle failed");
                }
                if services::purchase_bill_drafts_service::process_due_historical_bulk(
                    &worker_state,
                )
                .await
                .is_err()
                {
                    tracing::warn!("historical purchase bulk worker cycle failed");
                }
            }
        });
    }
    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if services::operations_service::run_escalation_worker(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("field job SLA escalation cycle failed");
                }
                if services::operations_service::process_marketplace_retries(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("marketplace webhook retry cycle failed");
                }
            }
        });
    }

    if state.settings.compliance_provider_enabled() {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if services::compliance_provider_service::process_due(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("invoice compliance worker cycle failed");
                }
            }
        });
    }

    if state.settings.razorpay_payment_links_enabled() {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                if services::membership_auto_renew_service::process_due(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("membership auto-renew worker cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                if services::pos_enterprise_service::run_integrity_monitor(&worker_state.db)
                    .await
                    .is_err()
                {
                    tracing::warn!("POS financial integrity monitor cycle failed");
                }
                if services::inventory_controls_service::process_due_automation(&worker_state)
                    .await
                    .is_err()
                {
                    tracing::warn!("autonomous inventory cycle failed");
                }
            }
        });
    }

    {
        let worker_state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if services::profit_governance_service::process_automated_action_queue(
                    &worker_state.db,
                )
                .await
                .is_err()
                {
                    tracing::warn!("automated profit action scan cycle failed");
                }
            }
        });
    }

    let app = routes::build_router(state);
    let addr: SocketAddr = format!("{}:{}", settings.app_host, settings.app_port).parse()?;

    let listener = TcpListener::bind(addr).await?;
    tracing::info!("aura-shine-backend listening on {}", addr);
    serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
