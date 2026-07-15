use crate::config::Settings;
use crate::infrastructure::{cache::RedisClient, db::DbPool};
use sqlx::PgPool;
use tokio::sync::broadcast;

#[derive(Clone, serde::Serialize)]
pub struct AppointmentEvent {
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
}

#[derive(Clone, serde::Serialize)]
pub struct PosEvent {
    pub tenant_id: String,
    pub branch_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
}

#[derive(Clone, serde::Serialize)]
pub struct TeamChatEvent {
    pub tenant_id: String,
    pub branch_id: String,
    pub message_id: String,
    pub sender_user_id: String,
}

#[derive(Clone)]
pub struct AppState {
    pub settings: Settings,
    pub db: DbPool,
    #[allow(dead_code)]
    pub redis: RedisClient,
    pub appointment_events: broadcast::Sender<AppointmentEvent>,
    pub pos_events: broadcast::Sender<PosEvent>,
    pub team_chat_events: broadcast::Sender<TeamChatEvent>,
}

impl AppState {
    pub fn new(settings: Settings, db: PgPool, redis: RedisClient) -> Self {
        let (appointment_events, _) = broadcast::channel(256);
        // ponytail: in-process fanout is enough for one API replica; switch this sender to
        // Redis pub/sub when production runs more than one backend replica.
        let (pos_events, _) = broadcast::channel(512);
        let (team_chat_events, _) = broadcast::channel(512);
        Self {
            settings,
            db,
            redis,
            appointment_events,
            pos_events,
            team_chat_events,
        }
    }

    pub fn publish_pos_event(
        &self,
        tenant_id: &str,
        branch_id: &str,
        entity_type: &str,
        entity_id: &str,
        action: &str,
    ) {
        let _ = self.pos_events.send(PosEvent {
            tenant_id: tenant_id.to_string(),
            branch_id: branch_id.to_string(),
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
            action: action.to_string(),
        });
    }
}
