use crate::config::Settings;
use crate::infrastructure::{cache::RedisClient, db::DbPool};
use sqlx::PgPool;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tokio::sync::{broadcast, RwLock};

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
    pub event_type: String,
    pub message_id: String,
    pub sender_user_id: String,
}

#[derive(Clone)]
pub struct AppSessionCacheEntry {
    pub tenant_id: String,
    pub user_id: String,
    pub branch_id: Option<String>,
    pub role_name: String,
    pub role_id: Option<String>,
    pub permissions: Vec<String>,
    pub denied_permissions: Vec<String>,
    pub masked_fields: Vec<String>,
    pub max_discount_paise: Option<i64>,
    pub max_refund_paise: Option<i64>,
    pub max_cash_movement_paise: Option<i64>,
    pub permission_version: i64,
    pub must_change_password: bool,
    pub last_session_check: Instant,
    pub expires_at: Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub settings: Settings,
    pub db: DbPool,
    #[allow(dead_code)]
    pub redis: RedisClient,
    pub auth_cache: Arc<RwLock<HashMap<String, AppSessionCacheEntry>>>,
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
            auth_cache: Arc::new(RwLock::new(HashMap::new())),
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
