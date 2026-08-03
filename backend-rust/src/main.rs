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

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result};
use axum::serve;
use chrono::{NaiveDate, Utc};
use infrastructure::worker;
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

    // A `--migrate-only` run is the deploy pipeline's dedicated schema step, so
    // it always migrates regardless of how the serving tasks are configured.
    let migrate_only = std::env::args().any(|arg| arg == "--migrate-only");
    let run_migrations = migrate_only || infrastructure::db::migrations_on_boot_enabled();

    let db = infrastructure::db::create_pool(&settings.database_url, run_migrations)
        .await
        .context("Unable to initialize PostgreSQL pool")?;

    services::staff_payroll_service::protect_legacy_statutory_pii(
        &db,
        settings.security_encryption_key.as_deref(),
    )
    .await
    .map_err(|error| anyhow::anyhow!("Unable to protect statutory PII: {}", error.message()))?;

    if migrate_only {
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
    // Every worker below runs on whichever replica wins its advisory lock for
    // that cycle. Before this, all of them ran in all replicas at once, so a
    // service scaled to eight tasks did eight copies of the same scan.
    // `worker::spawn` names each lock, so the names must stay stable across
    // releases.

    worker::spawn(
        &state,
        "staff_attendance_notifications",
        Duration::from_secs(60),
        |state| async move {
            if services::staff_attendance_service::schedule_forgot_clock_out_reminders(&state.db)
                .await
                .is_err()
            {
                worker::note_failure(
                    "staff_attendance_notifications",
                    "forgot_clock_out_reminders",
                );
            }
            if services::staff_notification_service::process_automation(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("staff_attendance_notifications", "notification_automation");
            }
        },
    );

    worker::spawn(
        &state,
        "support_sla_escalation",
        Duration::from_secs(60),
        |state| async move {
            if services::saas_service::escalate_due_tickets(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("support_sla_escalation", "escalate_due_tickets");
            }
        },
    );

    worker::spawn(
        &state,
        "report_export",
        Duration::from_secs(15),
        |state| async move {
            if services::report_export_service::process_due(&state)
                .await
                .is_err()
            {
                worker::note_failure("report_export", "process_due");
            }
        },
    );

    worker::spawn(
        &state,
        "client_intelligence_snapshots",
        Duration::from_secs(900),
        |state| async move {
            if services::client_service::refresh_intelligence_snapshots(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("client_intelligence_snapshots", "refresh_snapshots");
            }
        },
    );

    worker::spawn(
        &state,
        "appointment_waitlist_expiry",
        Duration::from_secs(60),
        |state| async move {
            if routes::appointments::expire_waitlist_offers(&state)
                .await
                .is_err()
            {
                worker::note_failure("appointment_waitlist_expiry", "expire_offers");
            }
        },
    );

    worker::spawn(
        &state,
        "ai_transcript_retention",
        Duration::from_secs(21_600),
        |state| async move {
            if services::ai_concierge_service::purge_expired_transcripts(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("ai_transcript_retention", "purge_transcripts");
            }
            if repositories::communication_repository::redact_expired_content(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("ai_transcript_retention", "redact_communications");
            }
        },
    );

    worker::spawn(
        &state,
        "staff_hrms_operations_intelligence",
        Duration::from_secs(21_600),
        |state| async move {
            if services::staff_hrms_service::run_scheduled_operations_intelligence(&state.db)
                .await
                .is_err()
            {
                worker::note_failure(
                    "staff_hrms_operations_intelligence",
                    "run_scheduled_operations",
                );
            }
        },
    );

    // Proactive briefing. Six-hourly rather than daily so a restart cannot
    // skip a day; the per-signal cooldown is what stops it repeating.
    worker::spawn(
        &state,
        "ai_daily_briefing",
        Duration::from_secs(services::ai_briefing_service::BRIEFING_WORKER_INTERVAL_SECONDS),
        |state| async move {
            if services::ai_briefing_service::run_daily_briefing_worker(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("ai_daily_briefing", "run_briefing");
            }
        },
    );

    worker::spawn(
        &state,
        "happy_hours_auto_sunset",
        Duration::from_secs(21_600),
        |state| async move {
            if services::happy_hours_service::run_auto_sunset_worker(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("happy_hours_auto_sunset", "auto_sunset");
            }
        },
    );

    if state.settings.invoice_delivery_configured() {
        // Reminder scheduling is once-a-day work sharing a minute-by-minute
        // delivery loop. The memo is per-process and therefore best-effort: if
        // leadership moves, the new leader re-checks, and the scheduler itself
        // is responsible for not double-sending.
        let last_reminder_date: Arc<Mutex<Option<NaiveDate>>> = Arc::new(Mutex::new(None));
        worker::spawn(
            &state,
            "invoice_delivery",
            Duration::from_secs(60),
            move |state| {
                let last_reminder_date = Arc::clone(&last_reminder_date);
                async move {
                    let today = Utc::now().date_naive();
                    let already_scheduled = last_reminder_date
                        .lock()
                        .map(|date| *date == Some(today))
                        .unwrap_or(false);
                    if !already_scheduled {
                        match routes::pos::schedule_due_invoice_reminders_worker(&state).await {
                            Ok(_) => {
                                if let Ok(mut date) = last_reminder_date.lock() {
                                    *date = Some(today);
                                }
                            }
                            Err(_) => {
                                worker::note_failure("invoice_delivery", "schedule_reminders");
                            }
                        }
                    }
                    if routes::pos::run_invoice_outbox_worker(&state)
                        .await
                        .is_err()
                    {
                        worker::note_failure("invoice_delivery", "invoice_outbox");
                    }
                    if services::saas_service::process_support_email_outbox(
                        &state.db,
                        &state.settings,
                    )
                    .await
                    .is_err()
                    {
                        worker::note_failure("invoice_delivery", "support_email_outbox");
                    }
                    if routes::pos_legacy_completion::process_due_daily_reports_worker(&state)
                        .await
                        .is_err()
                    {
                        worker::note_failure("invoice_delivery", "daily_reports");
                    }
                    if services::analytics_service::process_due_custom_reports(&state)
                        .await
                        .is_err()
                    {
                        worker::note_failure("invoice_delivery", "custom_reports");
                    }
                    if services::inventory_governance_service::process_due_communications(&state)
                        .await
                        .is_err()
                    {
                        worker::note_failure("invoice_delivery", "supplier_communications");
                    }
                }
            },
        );
    }

    if state.settings.benefit_delivery_configured() {
        worker::spawn(
            &state,
            "benefit_delivery",
            Duration::from_secs(60),
            |state| async move {
                if services::benefit_notification_service::schedule(&state)
                    .await
                    .is_err()
                {
                    worker::note_failure("benefit_delivery", "schedule");
                }
                if services::benefit_notification_service::process_due(&state)
                    .await
                    .is_err()
                {
                    worker::note_failure("benefit_delivery", "process_due");
                }
            },
        );
    }

    if state.settings.security_encryption_key.is_some() {
        worker::spawn(
            &state,
            "integration_delivery",
            Duration::from_secs(30),
            |state| async move {
                if services::integration_service::process_webhooks(&state.db, &state.settings)
                    .await
                    .is_err()
                {
                    worker::note_failure("integration_delivery", "webhooks");
                }
                if services::integration_service::process_connector_sync_jobs(
                    &state.db,
                    &state.settings,
                )
                .await
                .is_err()
                {
                    worker::note_failure("integration_delivery", "connector_sync");
                }
            },
        );
    }

    if state.settings.mobile_push_provider_enabled() {
        worker::spawn(
            &state,
            "mobile_push_delivery",
            Duration::from_secs(15),
            |state| async move {
                if services::team_chat_service::process_push_deliveries(
                    &state.db,
                    state
                        .settings
                        .mobile_push_provider_url
                        .as_deref()
                        .unwrap_or_default(),
                    state
                        .settings
                        .mobile_push_provider_token
                        .as_deref()
                        .unwrap_or_default(),
                    state
                        .settings
                        .security_encryption_key
                        .as_deref()
                        .unwrap_or_default(),
                )
                .await
                .is_err()
                {
                    worker::note_failure("mobile_push_delivery", "push_deliveries");
                }
            },
        );
    }

    worker::spawn(
        &state,
        "data_import",
        Duration::from_secs(5),
        |state| async move {
            if services::migration_service::process_due(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("data_import", "import_jobs");
            }
            if services::purchase_bill_drafts_service::process_due_historical_bulk(&state)
                .await
                .is_err()
            {
                worker::note_failure("data_import", "historical_bulk");
            }
        },
    );

    worker::spawn(
        &state,
        "field_operations",
        Duration::from_secs(60),
        |state| async move {
            if services::operations_service::run_escalation_worker(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("field_operations", "sla_escalation");
            }
            if services::operations_service::process_marketplace_retries(&state)
                .await
                .is_err()
            {
                worker::note_failure("field_operations", "marketplace_retries");
            }
        },
    );

    if state.settings.compliance_provider_enabled() {
        worker::spawn(
            &state,
            "invoice_compliance",
            Duration::from_secs(60),
            |state| async move {
                if services::compliance_provider_service::process_due(&state)
                    .await
                    .is_err()
                {
                    worker::note_failure("invoice_compliance", "process_due");
                }
            },
        );
    }

    if state.settings.razorpay_payment_links_enabled() {
        worker::spawn(
            &state,
            "membership_auto_renew",
            Duration::from_secs(300),
            |state| async move {
                if services::membership_auto_renew_service::process_due(&state)
                    .await
                    .is_err()
                {
                    worker::note_failure("membership_auto_renew", "process_due");
                }
            },
        );
    }

    worker::spawn(
        &state,
        "pos_integrity_monitor",
        Duration::from_secs(300),
        |state| async move {
            if services::pos_enterprise_service::run_integrity_monitor(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("pos_integrity_monitor", "integrity_monitor");
            }
            if services::inventory_controls_service::process_due_automation(&state)
                .await
                .is_err()
            {
                worker::note_failure("pos_integrity_monitor", "inventory_automation");
            }
        },
    );

    worker::spawn(
        &state,
        "profit_action_queue",
        Duration::from_secs(60),
        |state| async move {
            if services::profit_governance_service::process_automated_action_queue(&state.db)
                .await
                .is_err()
            {
                worker::note_failure("profit_action_queue", "action_queue");
            }
        },
    );

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
