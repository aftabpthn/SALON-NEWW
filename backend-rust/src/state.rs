use crate::config::Settings;
use crate::infrastructure::{cache::RedisClient, db::DbPool};
use sqlx::PgPool;
use tokio::sync::broadcast;

#[derive(Clone, serde::Serialize)]
pub struct AppointmentEvent {
    pub tenant_id: String,
    pub branch_id: String,
    pub appointment_id: String,
    pub action: String,
}

#[derive(Clone)]
pub struct AppState {
    pub settings: Settings,
    pub db: DbPool,
    #[allow(dead_code)]
    pub redis: RedisClient,
    pub appointment_events: broadcast::Sender<AppointmentEvent>,
}

impl AppState {
    pub fn new(settings: Settings, db: PgPool, redis: RedisClient) -> Self {
        let (appointment_events, _) = broadcast::channel(256);
        Self {
            settings,
            db,
            redis,
            appointment_events,
        }
    }
}
