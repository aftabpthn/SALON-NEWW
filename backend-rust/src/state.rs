use crate::config::Settings;
use crate::infrastructure::{
    cache::RedisClient,
    db::DbPool,
    realtime::{cluster_channel, ClusterSender},
};
use sqlx::PgPool;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tokio::sync::RwLock;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct AppointmentEvent {
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct PosEvent {
    pub tenant_id: String,
    pub branch_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub action: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
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
    pub appointment_events: ClusterSender<AppointmentEvent>,
    pub pos_events: ClusterSender<PosEvent>,
    pub team_chat_events: ClusterSender<TeamChatEvent>,
}

impl AppState {
    pub fn new(settings: Settings, db: PgPool, redis: RedisClient) -> Self {
        let appointment_events =
            cluster_channel(redis.clone(), "aurashine:realtime:appointments:v1", 256);
        let pos_events = cluster_channel(redis.clone(), "aurashine:realtime:pos:v1", 512);
        let team_chat_events =
            cluster_channel(redis.clone(), "aurashine:realtime:team-chat:v1", 512);
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
