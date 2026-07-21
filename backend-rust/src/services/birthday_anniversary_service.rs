use std::collections::BTreeSet;

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::birthday_anniversary_repository::{
        self as repository, ApproveReminder, AuditFilter, BirthdayAnniversaryAuditRecord,
        BirthdayAnniversarySettingsRecord, BirthdayAnniversarySettingsWrite, DraftWrite,
        OccasionRecord, ReminderDeliveryWrite, ReminderFilter, ReminderRecord, VoucherFilter,
        VoucherRecord,
    },
    services::client_service,
    state::AppState,
};

const DEFAULT_TIMEZONE: &str = "Asia/Kolkata";
const DEFAULT_SEND_TIME: &str = "09:00";
const MAX_MESSAGE_LENGTH: usize = 4_000;
const EVENT_TYPES: &[&str] = &["birthday", "anniversary"];
const CHANNELS: &[&str] = &["whatsapp", "sms", "email"];
const REMINDER_STATUSES: &[&str] = &[
    "draft",
    "approved",
    "queued",
    "sent",
    "failed",
    "blocked",
    "cancelled",
];
const VOUCHER_STATUSES: &[&str] = &["created", "sent", "redeemed", "expired", "cancelled"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub tenant_id: String,
    pub branch_id: String,
    pub workflow_mode: String,
    pub popup_enabled: bool,
    pub approval_required: bool,
    pub auto_send_enabled: bool,
    pub default_send_time: String,
    pub timezone: String,
    pub days_ahead: i16,
    pub channels: Vec<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub updated_by: String,
}

impl SettingsView {
    fn defaults(tenant_id: &str, branch_id: &str) -> Self {
        Self {
            tenant_id: tenant_id.to_string(),
            branch_id: branch_id.to_string(),
            workflow_mode: "legacy_auto".into(),
            popup_enabled: true,
            approval_required: true,
            auto_send_enabled: false,
            default_send_time: DEFAULT_SEND_TIME.into(),
            timezone: DEFAULT_TIMEZONE.into(),
            days_ahead: 30,
            channels: vec!["whatsapp".into()],
            created_at: None,
            updated_at: None,
            updated_by: String::new(),
        }
    }
}

impl From<BirthdayAnniversarySettingsRecord> for SettingsView {
    fn from(value: BirthdayAnniversarySettingsRecord) -> Self {
        Self {
            tenant_id: value.tenant_id,
            branch_id: value.branch_id,
            workflow_mode: value.workflow_mode,
            popup_enabled: value.popup_enabled,
            approval_required: value.approval_required,
            auto_send_enabled: value.auto_send_enabled,
            default_send_time: value.default_send_time.format("%H:%M").to_string(),
            timezone: value.timezone,
            days_ahead: value.days_ahead,
            channels: value.channels,
            created_at: Some(value.created_at),
            updated_at: Some(value.updated_at),
            updated_by: value.updated_by,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SettingsUpdate {
    pub workflow_mode: Option<String>,
    pub popup_enabled: Option<bool>,
    pub approval_required: Option<bool>,
    pub auto_send_enabled: Option<bool>,
    pub default_send_time: Option<String>,
    pub timezone: Option<String>,
    pub days_ahead: Option<i16>,
    pub channels: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OccasionView {
    #[serde(flatten)]
    pub occasion: OccasionRecord,
    pub event_window: String,
    pub is_vip: bool,
    pub gift_recommendation: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewMetrics {
    pub today_birthdays: usize,
    pub today_anniversaries: usize,
    pub month_birthdays: usize,
    pub month_anniversaries: usize,
    pub pending_approvals: usize,
    pub approved: usize,
    pub queued: usize,
    pub sent: usize,
    pub failed: usize,
    pub gift_sent: usize,
    pub gift_prepared: usize,
    pub gift_redeemed: usize,
    pub gift_expired: usize,
    pub gift_prepared_value_paise: i64,
    pub gift_redeemed_value_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub date: NaiveDate,
    pub settings: SettingsView,
    pub metrics: OverviewMetrics,
    pub today: Vec<OccasionView>,
    pub week: Vec<OccasionView>,
    pub month: Vec<OccasionView>,
    pub clients: Vec<OccasionView>,
    pub reminders: Vec<ReminderRecord>,
    pub vouchers: Vec<VoucherRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MorningBrief {
    pub date: NaiveDate,
    pub popup_enabled: bool,
    pub today_birthdays: Vec<OccasionView>,
    pub today_anniversaries: Vec<OccasionView>,
    pub month_birthdays: Vec<OccasionView>,
    pub month_anniversaries: Vec<OccasionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeWidget {
    pub date: NaiveDate,
    pub clients: Vec<OccasionView>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct DraftBatchInput {
    pub date: Option<NaiveDate>,
    pub filters: Vec<String>,
    pub client_id: Option<String>,
    pub event_type: Option<String>,
    pub channels: Option<Vec<String>>,
    pub message_options_json: Value,
    pub selected_message: String,
    pub coupon_id: Option<String>,
    pub scheduled_send_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftBatchResult {
    pub created: usize,
    pub updated: usize,
    pub skipped: usize,
    pub drafts: Vec<ReminderRecord>,
}

#[derive(Debug, Clone)]
pub struct ApproveInput {
    pub selected_message: Option<String>,
    pub coupon_id: Option<String>,
    pub scheduled_send_at: Option<DateTime<Utc>>,
    pub expected_version: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueResult {
    pub reminder: ReminderRecord,
    pub voucher: Option<VoucherRecord>,
    pub queued_channels: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSendItem {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSendResult {
    pub auto_send_enabled: bool,
    pub queued: usize,
    pub failed: usize,
    pub results: Vec<AutoSendItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignMetrics {
    pub current_birthdays: usize,
    pub upcoming_birthdays: usize,
    pub reachable_clients: usize,
    pub message_suggestions: usize,
    pub offer_suggestions: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignSummary {
    pub date: NaiveDate,
    pub days_ahead: i16,
    pub metrics: CampaignMetrics,
    pub clients: Vec<OccasionView>,
    pub current: Vec<OccasionView>,
    pub upcoming: Vec<OccasionView>,
    pub message_suggestions: Vec<Value>,
    pub offer_suggestions: Vec<Value>,
}

#[derive(Debug, Clone)]
pub struct CampaignSendInput {
    pub client_id: String,
    pub message: String,
    pub channels: Option<Vec<String>>,
    pub coupon_id: Option<String>,
    pub scheduled_send_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignBulkItem {
    pub client_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignBulkResult {
    pub mode: String,
    pub requested: usize,
    pub attempted: usize,
    pub queued: usize,
    pub failed: usize,
    pub results: Vec<CampaignBulkItem>,
}

#[derive(Debug, Clone)]
pub struct MonthPrepareInput {
    pub date: Option<NaiveDate>,
    pub channels: Option<Vec<String>>,
    pub coupon_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthPrepareResult {
    pub month: NaiveDate,
    pub prepared: usize,
    pub updated: usize,
    pub skipped: usize,
    pub drafts: Vec<ReminderRecord>,
}

pub async fn settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SettingsView, AppError> {
    repository::get_settings(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load birthday and anniversary settings"))
        .map(|row| {
            row.map(SettingsView::from)
                .unwrap_or_else(|| SettingsView::defaults(tenant_id, branch_id))
        })
}

pub async fn update_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: SettingsUpdate,
) -> Result<SettingsView, AppError> {
    let current = settings(db, tenant_id, branch_id).await?;
    let workflow_mode = input.workflow_mode.unwrap_or(current.workflow_mode);
    if !matches!(workflow_mode.as_str(), "legacy_auto" | "managed") {
        return Err(AppError::validation("workflowMode is invalid"));
    }
    let timezone = input
        .timezone
        .unwrap_or(current.timezone)
        .trim()
        .to_string();
    if timezone.is_empty() || timezone.len() > 100 {
        return Err(AppError::validation("timezone is invalid"));
    }
    if !repository::timezone_exists(db, &timezone)
        .await
        .map_err(|_| AppError::internal("failed to validate timezone"))?
    {
        return Err(AppError::validation("timezone is not supported"));
    }
    let send_time_text = input.default_send_time.unwrap_or(current.default_send_time);
    let default_send_time = parse_send_time(&send_time_text)?;
    let days_ahead = input.days_ahead.unwrap_or(current.days_ahead);
    if !(1..=366).contains(&days_ahead) {
        return Err(AppError::validation("daysAhead must be between 1 and 366"));
    }
    let channels = validate_channels(input.channels.unwrap_or(current.channels))?;

    repository::upsert_settings(
        db,
        BirthdayAnniversarySettingsWrite {
            tenant_id,
            branch_id,
            workflow_mode: &workflow_mode,
            popup_enabled: input.popup_enabled.unwrap_or(current.popup_enabled),
            approval_required: input.approval_required.unwrap_or(current.approval_required),
            auto_send_enabled: input.auto_send_enabled.unwrap_or(current.auto_send_enabled),
            default_send_time,
            timezone: &timezone,
            days_ahead,
            channels,
            actor_user_id,
        },
    )
    .await
    .map(SettingsView::from)
    .map_err(|_| AppError::internal("failed to update birthday and anniversary settings"))
}

pub async fn overview(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    requested_date: Option<NaiveDate>,
) -> Result<Overview, AppError> {
    let settings = settings(db, tenant_id, branch_id).await?;
    let date = resolve_date(db, requested_date, &settings.timezone).await?;
    let occasions =
        occasion_views(db, tenant_id, branch_id, date, month_end(date)?, "", 1000).await?;
    let reminders = reminders(
        db, tenant_id, branch_id, None, None, None, None, None, 500, 0,
    )
    .await?;
    let vouchers = vouchers(db, tenant_id, branch_id, None, None, 500, 0, false).await?;

    let today = occasions
        .iter()
        .filter(|row| row.occasion.days_until == 0)
        .cloned()
        .collect::<Vec<_>>();
    let week = occasions
        .iter()
        .filter(|row| (0..=7).contains(&row.occasion.days_until))
        .cloned()
        .collect::<Vec<_>>();
    let month = occasions.clone();
    let metrics = OverviewMetrics {
        today_birthdays: occasions
            .iter()
            .filter(|row| row.occasion.days_until == 0 && row.occasion.event_type == "birthday")
            .count(),
        today_anniversaries: occasions
            .iter()
            .filter(|row| row.occasion.days_until == 0 && row.occasion.event_type == "anniversary")
            .count(),
        month_birthdays: occasions
            .iter()
            .filter(|row| row.occasion.event_type == "birthday")
            .count(),
        month_anniversaries: occasions
            .iter()
            .filter(|row| row.occasion.event_type == "anniversary")
            .count(),
        pending_approvals: reminders.iter().filter(|row| row.status == "draft").count(),
        approved: reminders
            .iter()
            .filter(|row| row.status == "approved")
            .count(),
        queued: reminders
            .iter()
            .filter(|row| row.status == "queued")
            .count(),
        sent: reminders.iter().filter(|row| row.status == "sent").count(),
        failed: reminders
            .iter()
            .filter(|row| matches!(row.status.as_str(), "failed" | "blocked"))
            .count(),
        gift_sent: vouchers
            .iter()
            .filter(|row| matches!(row.status.as_str(), "sent" | "redeemed"))
            .count(),
        gift_prepared: vouchers.len(),
        gift_redeemed: vouchers
            .iter()
            .filter(|row| row.status == "redeemed" || row.redeemed_at.is_some())
            .count(),
        gift_expired: vouchers
            .iter()
            .filter(|row| row.status == "expired")
            .count(),
        gift_prepared_value_paise: vouchers
            .iter()
            .map(|row| row.discount_value_paise.max(0))
            .sum(),
        gift_redeemed_value_paise: vouchers
            .iter()
            .filter(|row| row.status == "redeemed" || row.redeemed_at.is_some())
            .map(|row| row.discount_value_paise.max(0))
            .sum(),
    };

    Ok(Overview {
        date,
        settings,
        metrics,
        today,
        week,
        month,
        clients: occasions,
        reminders,
        vouchers,
    })
}

pub async fn morning_brief(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    requested_date: Option<NaiveDate>,
) -> Result<MorningBrief, AppError> {
    let overview = overview(db, tenant_id, branch_id, requested_date).await?;
    Ok(MorningBrief {
        date: overview.date,
        popup_enabled: overview.settings.popup_enabled,
        today_birthdays: filter_event(&overview.today, "birthday"),
        today_anniversaries: filter_event(&overview.today, "anniversary"),
        month_birthdays: filter_event(&overview.month, "birthday"),
        month_anniversaries: filter_event(&overview.month, "anniversary"),
    })
}

pub async fn home_widget(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    requested_date: Option<NaiveDate>,
) -> Result<HomeWidget, AppError> {
    let overview = overview(db, tenant_id, branch_id, requested_date).await?;
    let mut clients = overview.clients;
    clients.sort_by(|left, right| {
        right
            .occasion
            .lifetime_value_paise
            .cmp(&left.occasion.lifetime_value_paise)
            .then_with(|| {
                right
                    .occasion
                    .completed_visits
                    .cmp(&left.occasion.completed_visits)
            })
            .then_with(|| left.occasion.client_id.cmp(&right.occasion.client_id))
    });
    clients.truncate(10);
    Ok(HomeWidget {
        date: overview.date,
        clients,
        generated_at: Utc::now(),
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    status: Option<&str>,
    event_type: Option<&str>,
    from_date: Option<NaiveDate>,
    to_date: Option<NaiveDate>,
    limit: i64,
    offset: i64,
) -> Result<Vec<ReminderRecord>, AppError> {
    validate_optional(status, REMINDER_STATUSES, "reminder status")?;
    validate_optional(event_type, EVENT_TYPES, "event type")?;
    repository::list_reminders(
        db,
        tenant_id,
        branch_id,
        ReminderFilter {
            client_id: clean_optional(client_id),
            status: clean_optional(status),
            event_type: clean_optional(event_type),
            from_date,
            to_date,
            limit: limit.clamp(1, 1000),
            offset: offset.max(0),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to load birthday and anniversary reminders"))
}

pub async fn generate_drafts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: DraftBatchInput,
) -> Result<DraftBatchResult, AppError> {
    validate_optional(input.event_type.as_deref(), EVENT_TYPES, "event type")?;
    validate_message_options(&input.message_options_json)?;
    validate_message(&input.selected_message, false)?;
    let settings = settings(db, tenant_id, branch_id).await?;
    let date = resolve_date(db, input.date, &settings.timezone).await?;
    let filters = input
        .filters
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let to_date = if filters.contains("today") {
        date
    } else if filters.contains("week") {
        add_days(date, 7)?
    } else if filters.contains("month") {
        month_end(date)?
    } else {
        add_days(date, i64::from(settings.days_ahead))?
    };
    let channels = validate_channels(input.channels.unwrap_or(settings.channels))?;
    let event_type = input.event_type.as_deref().unwrap_or("");
    let mut occasions = if let Some(client_id) = input.client_id.as_deref() {
        repository::list_client_occasions(
            db, tenant_id, branch_id, client_id, date, to_date, event_type, 10,
        )
        .await
    } else {
        repository::list_occasions(db, tenant_id, branch_id, date, to_date, event_type, 1000).await
    }
    .map_err(|_| AppError::internal("failed to load birthday and anniversary occasions"))?;
    if filters.contains("vip") {
        occasions.retain(|row| is_vip(&row.categories_json));
    }

    let mut result = DraftBatchResult {
        created: 0,
        updated: 0,
        skipped: 0,
        drafts: Vec::new(),
    };
    for occasion in occasions {
        let existed = occasion.reminder_id.is_some();
        let message_options_json = if input
            .message_options_json
            .as_array()
            .is_some_and(Vec::is_empty)
        {
            message_suggestions_for(&[occasion.clone()], &occasion.event_type)
        } else {
            input.message_options_json.clone()
        };
        let selected_message = match input.selected_message.trim() {
            "" => first_message(&message_options_json)
                .unwrap_or("")
                .to_string(),
            value => value.to_string(),
        };
        let Some(mut reminder) = repository::upsert_draft(
            db,
            DraftWrite {
                tenant_id,
                branch_id,
                client_id: &occasion.client_id,
                event_type: &occasion.event_type,
                event_date: occasion.event_date,
                channels: channels.clone(),
                message_options_json: &message_options_json,
                selected_message: selected_message.trim(),
                coupon_id: clean_optional(input.coupon_id.as_deref()),
                scheduled_send_at: input.scheduled_send_at,
                actor_user_id,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to save birthday and anniversary draft"))?
        else {
            result.skipped += 1;
            continue;
        };
        if reminder.status != "draft" {
            result.skipped += 1;
            continue;
        }
        if !settings.approval_required && !selected_message.trim().is_empty() {
            reminder = repository::approve_reminder(
                db,
                ApproveReminder {
                    tenant_id,
                    branch_id,
                    reminder_id: &reminder.id,
                    selected_message: selected_message.trim(),
                    coupon_id: clean_optional(input.coupon_id.as_deref()),
                    scheduled_send_at: input.scheduled_send_at,
                    actor_user_id,
                    expected_version: reminder.version,
                },
            )
            .await
            .map_err(|_| AppError::internal("failed to auto-approve reminder"))?
            .ok_or_else(|| AppError::conflict("reminder changed before approval"))?;
        }
        if existed {
            result.updated += 1;
        } else {
            result.created += 1;
        }
        result.drafts.push(reminder);
    }
    Ok(result)
}

pub async fn approve_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    actor_user_id: &str,
    input: ApproveInput,
) -> Result<ReminderRecord, AppError> {
    let existing = get_reminder(db, tenant_id, branch_id, reminder_id).await?;
    if existing.status != "draft" {
        return Err(AppError::conflict("only a draft reminder can be approved"));
    }
    let selected_message = input
        .selected_message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            (!existing.selected_message.trim().is_empty())
                .then_some(existing.selected_message.trim())
        })
        .or_else(|| first_message(&existing.message_options_json))
        .ok_or_else(|| AppError::validation("selectedMessage is required"))?;
    validate_message(selected_message, true)?;
    let coupon_id = input.coupon_id.as_deref().or(existing.coupon_id.as_deref());
    repository::approve_reminder(
        db,
        ApproveReminder {
            tenant_id,
            branch_id,
            reminder_id,
            selected_message,
            coupon_id: clean_optional(coupon_id),
            scheduled_send_at: input.scheduled_send_at.or(existing.scheduled_send_at),
            actor_user_id,
            expected_version: input.expected_version.unwrap_or(existing.version),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to approve reminder"))?
    .ok_or_else(|| AppError::conflict("reminder changed or coupon is not active"))
}

pub async fn queue_reminder(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    actor_user_id: &str,
    message: Option<&str>,
) -> Result<QueueResult, AppError> {
    let reminder = get_reminder(&state.db, tenant_id, branch_id, reminder_id).await?;
    if matches!(reminder.status.as_str(), "queued" | "sent") {
        let voucher =
            repository::get_voucher_for_reminder(&state.db, tenant_id, branch_id, reminder_id)
                .await
                .map_err(|_| AppError::internal("failed to load reminder voucher"))?;
        return Ok(QueueResult {
            queued_channels: reminder.channels.clone(),
            reminder,
            voucher,
        });
    }
    if reminder.status != "approved" {
        return Err(AppError::conflict(
            "reminder must be approved before it can be queued",
        ));
    }
    let approved_message = reminder.selected_message.trim();
    validate_message(approved_message, true)?;
    if message
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|value| value != approved_message)
    {
        return Err(AppError::conflict(
            "edited message must be approved before sending",
        ));
    }

    let voucher = if reminder.coupon_id.is_some() {
        Some(
            repository::create_voucher_for_reminder(
                &state.db,
                tenant_id,
                branch_id,
                reminder_id,
                actor_user_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to create reminder voucher"))?
            .ok_or_else(|| AppError::conflict("approved coupon is no longer active"))?,
        )
    } else {
        None
    };
    let delivered_message = voucher
        .as_ref()
        .filter(|voucher| !approved_message.contains(&voucher.coupon_code))
        .map(|voucher| format!("{approved_message}\nVoucher: {}", voucher.coupon_code))
        .unwrap_or_else(|| approved_message.to_string());

    let mut deliveries = Vec::new();
    let mut provider_missing = false;
    for channel in &reminder.channels {
        let recipient = match channel.as_str() {
            "whatsapp" | "sms" => reminder.client_phone.trim(),
            "email" => reminder.client_email.trim(),
            _ => continue,
        };
        if recipient.is_empty() {
            continue;
        }
        let configured = match channel.as_str() {
            "whatsapp" => {
                state.settings.whatsapp_cloud_enabled() || state.settings.whatsapp_benefit_enabled()
            }
            "sms" | "email" => state.settings.invoice_delivery_webhook_url.is_some(),
            _ => false,
        };
        if !configured {
            provider_missing = true;
            continue;
        }
        if !client_service::communication_allowed(
            &state.db,
            tenant_id,
            branch_id,
            &reminder.client_id,
            channel,
        )
        .await
        .map_err(|_| AppError::internal("failed to verify client communication consent"))?
        {
            continue;
        }
        deliveries.push(ReminderDeliveryWrite {
            channel: channel.clone(),
            recipient: recipient.to_string(),
            payload_json: json!({
                "channel": channel,
                "recipient": recipient,
                "message": delivered_message,
                "clientName": reminder.client_name,
                "templateKind": "conversation",
                "reminderId": reminder.id,
                "voucherId": voucher.as_ref().map(|row| row.id.as_str()),
                "voucherCode": voucher.as_ref().map(|row| row.coupon_code.as_str()),
                "eventType": reminder.event_type,
                "source": "birthday-anniversary"
            }),
        });
    }
    if deliveries.is_empty() {
        return if provider_missing {
            Err(AppError::service_unavailable(
                "DELIVERY_NOT_CONFIGURED",
                "no selected birthday delivery provider is configured",
            ))
        } else {
            Err(AppError::conflict(
                "no selected channel has both recipient data and client consent",
            ))
        };
    }
    let queued_channels = deliveries
        .iter()
        .map(|delivery| delivery.channel.clone())
        .collect();
    let reminder = repository::queue_reminder_deliveries(
        &state.db,
        tenant_id,
        branch_id,
        reminder_id,
        actor_user_id,
        reminder.version,
        &deliveries,
    )
    .await
    .map_err(|_| AppError::internal("failed to queue reminder delivery"))?
    .ok_or_else(|| AppError::conflict("reminder changed before it could be queued"))?;
    Ok(QueueResult {
        reminder,
        voucher,
        queued_channels,
    })
}

pub async fn cancel_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    reason: &str,
    actor_user_id: &str,
    expected_version: Option<i32>,
) -> Result<ReminderRecord, AppError> {
    let reason = reason.trim();
    if reason.is_empty() || reason.chars().count() > 500 {
        return Err(AppError::validation("cancel reason is required"));
    }
    let reminder = get_reminder(db, tenant_id, branch_id, reminder_id).await?;
    repository::cancel_reminder(
        db,
        tenant_id,
        branch_id,
        reminder_id,
        reason,
        actor_user_id,
        expected_version.unwrap_or(reminder.version),
    )
    .await
    .map_err(|_| AppError::internal("failed to cancel reminder"))?
    .ok_or_else(|| AppError::conflict("reminder cannot be cancelled from its current state"))
}

pub async fn run_auto_send(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    limit: i64,
) -> Result<AutoSendResult, AppError> {
    let settings = settings(&state.db, tenant_id, branch_id).await?;
    if !settings.auto_send_enabled {
        return Ok(AutoSendResult {
            auto_send_enabled: false,
            queued: 0,
            failed: 0,
            results: Vec::new(),
        });
    }
    let due = repository::list_due_approved_reminders(
        &state.db,
        tenant_id,
        branch_id,
        limit.clamp(1, 250),
    )
    .await
    .map_err(|_| AppError::internal("failed to load due birthday reminders"))?;
    let mut result = AutoSendResult {
        auto_send_enabled: true,
        queued: 0,
        failed: 0,
        results: Vec::with_capacity(due.len()),
    };
    for reminder in due {
        match queue_reminder(
            state,
            tenant_id,
            branch_id,
            &reminder.id,
            actor_user_id,
            None,
        )
        .await
        {
            Ok(row) => {
                result.queued += 1;
                result.results.push(AutoSendItem {
                    id: row.reminder.id,
                    status: row.reminder.status,
                });
            }
            Err(_) => {
                result.failed += 1;
                result.results.push(AutoSendItem {
                    id: reminder.id,
                    status: "failed".into(),
                });
            }
        }
    }
    Ok(result)
}

pub async fn vouchers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    status: Option<&str>,
    limit: i64,
    offset: i64,
    expire_first: bool,
) -> Result<Vec<VoucherRecord>, AppError> {
    validate_optional(status, VOUCHER_STATUSES, "voucher status")?;
    if expire_first {
        repository::expire_vouchers(db, tenant_id, branch_id, "system")
            .await
            .map_err(|_| AppError::internal("failed to expire birthday vouchers"))?;
    }
    repository::list_vouchers(
        db,
        tenant_id,
        branch_id,
        VoucherFilter {
            client_id: clean_optional(client_id),
            status: clean_optional(status),
            limit: limit.clamp(1, 1000),
            offset: offset.max(0),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to load birthday vouchers"))
}

pub async fn redeem_voucher(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    voucher_id: &str,
    sale_id: &str,
    actor_user_id: &str,
) -> Result<VoucherRecord, AppError> {
    let sale_id = sale_id.trim();
    if sale_id.is_empty() {
        return Err(AppError::validation("saleId is required"));
    }
    if let Some(existing) = repository::get_voucher(db, tenant_id, branch_id, voucher_id)
        .await
        .map_err(|_| AppError::internal("failed to load birthday voucher"))?
    {
        if existing.status == "redeemed" && existing.redeemed_sale_id.as_deref() == Some(sale_id) {
            return Ok(existing);
        }
    } else {
        return Err(AppError::not_found("birthday voucher not found"));
    }
    repository::redeem_voucher(db, tenant_id, branch_id, voucher_id, sale_id, actor_user_id)
        .await
        .map_err(|_| AppError::internal("failed to redeem birthday voucher"))?
        .ok_or_else(|| {
            AppError::conflict(
                "voucher is unavailable or sale does not belong to the same client and branch",
            )
        })
}

#[allow(clippy::too_many_arguments)]
pub async fn audit_logs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    reminder_id: Option<&str>,
    action: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<BirthdayAnniversaryAuditRecord>, AppError> {
    if action.is_some_and(|value| value.trim().len() > 100) {
        return Err(AppError::validation("audit action is invalid"));
    }
    repository::list_audit_events(
        db,
        tenant_id,
        branch_id,
        AuditFilter {
            client_id: clean_optional(client_id),
            reminder_id: clean_optional(reminder_id),
            action: clean_optional(action),
            limit: limit.clamp(1, 500),
            offset: offset.max(0),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to load birthday audit events"))
}

pub async fn campaign_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    requested_date: Option<NaiveDate>,
    days_ahead: Option<i16>,
) -> Result<CampaignSummary, AppError> {
    let settings = settings(db, tenant_id, branch_id).await?;
    let date = resolve_date(db, requested_date, &settings.timezone).await?;
    let days_ahead = days_ahead.unwrap_or(settings.days_ahead).clamp(1, 366);
    let clients = occasion_views(
        db,
        tenant_id,
        branch_id,
        date,
        add_days(date, i64::from(days_ahead))?,
        "birthday",
        1000,
    )
    .await?;
    let current = clients
        .iter()
        .filter(|row| row.occasion.days_until == 0)
        .cloned()
        .collect::<Vec<_>>();
    let upcoming = clients
        .iter()
        .filter(|row| row.occasion.days_until > 0)
        .cloned()
        .collect::<Vec<_>>();
    let reachable_clients = clients
        .iter()
        .filter(|row| {
            !row.occasion.phone.trim().is_empty() || !row.occasion.email.trim().is_empty()
        })
        .count();
    let message_suggestions = message_suggestions_for_views(&clients, "birthday");
    let offer_suggestions = offer_suggestions_for_views(&clients);
    Ok(CampaignSummary {
        date,
        days_ahead,
        metrics: CampaignMetrics {
            current_birthdays: current.len(),
            upcoming_birthdays: upcoming.len(),
            reachable_clients,
            message_suggestions: message_suggestions.len(),
            offer_suggestions: offer_suggestions.len(),
        },
        clients,
        current,
        upcoming,
        message_suggestions,
        offer_suggestions,
    })
}

pub async fn send_campaign(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: CampaignSendInput,
) -> Result<QueueResult, AppError> {
    let client_id = input.client_id.trim();
    if client_id.is_empty() {
        return Err(AppError::validation("clientId is required"));
    }
    validate_message(&input.message, true)?;
    let settings = settings(&state.db, tenant_id, branch_id).await?;
    let today = resolve_date(&state.db, None, &settings.timezone).await?;
    let occasion = repository::list_client_occasions(
        &state.db,
        tenant_id,
        branch_id,
        client_id,
        today,
        add_days(today, 366)?,
        "birthday",
        1,
    )
    .await
    .map_err(|_| AppError::internal("failed to load client birthday"))?
    .into_iter()
    .next()
    .ok_or_else(|| AppError::not_found("active client birthday was not found"))?;
    let channels = validate_channels(input.channels.unwrap_or(settings.channels))?;
    let options = json!([{"id":"custom","source":"user","text":input.message.trim()}]);
    let reminder = repository::upsert_draft(
        &state.db,
        DraftWrite {
            tenant_id,
            branch_id,
            client_id,
            event_type: "birthday",
            event_date: occasion.event_date,
            channels,
            message_options_json: &options,
            selected_message: input.message.trim(),
            coupon_id: clean_optional(input.coupon_id.as_deref()),
            scheduled_send_at: input.scheduled_send_at,
            actor_user_id,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to save birthday campaign draft"))?
    .ok_or_else(|| AppError::not_found("active client was not found"))?;
    let reminder = if reminder.status == "draft" {
        repository::approve_reminder(
            &state.db,
            ApproveReminder {
                tenant_id,
                branch_id,
                reminder_id: &reminder.id,
                selected_message: input.message.trim(),
                coupon_id: clean_optional(input.coupon_id.as_deref()),
                scheduled_send_at: input.scheduled_send_at,
                actor_user_id,
                expected_version: reminder.version,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to approve birthday campaign"))?
        .ok_or_else(|| AppError::conflict("birthday campaign changed before approval"))?
    } else {
        reminder
    };
    queue_reminder(
        state,
        tenant_id,
        branch_id,
        &reminder.id,
        actor_user_id,
        Some(input.message.trim()),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_campaign_bulk(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    mode: &str,
    days_ahead: Option<i16>,
    limit: i64,
    message: &str,
    channels: Option<Vec<String>>,
    coupon_id: Option<String>,
) -> Result<CampaignBulkResult, AppError> {
    validate_message(message, true)?;
    let mode = mode.trim().to_ascii_lowercase();
    if !matches!(mode.as_str(), "today" | "upcoming" | "all") {
        return Err(AppError::validation("campaign mode is invalid"));
    }
    let summary = campaign_summary(&state.db, tenant_id, branch_id, None, days_ahead).await?;
    let source = match mode.as_str() {
        "today" => summary.current,
        "upcoming" => summary.upcoming,
        _ => summary.clients,
    };
    let requested = source.len();
    let selected = source
        .into_iter()
        .take(limit.clamp(1, 500) as usize)
        .collect::<Vec<_>>();
    let attempted = selected.len();
    let mut results = Vec::with_capacity(attempted);
    let mut queued = 0usize;
    for client in selected {
        let client_id = client.occasion.client_id;
        let send = send_campaign(
            state,
            tenant_id,
            branch_id,
            actor_user_id,
            CampaignSendInput {
                client_id: client_id.clone(),
                message: message.to_string(),
                channels: channels.clone(),
                coupon_id: coupon_id.clone(),
                scheduled_send_at: None,
            },
        )
        .await;
        let status = match send {
            Ok(result) => {
                queued += 1;
                result.reminder.status
            }
            Err(_) => "failed".into(),
        };
        results.push(CampaignBulkItem { client_id, status });
    }
    Ok(CampaignBulkResult {
        mode,
        requested,
        attempted,
        queued,
        failed: attempted.saturating_sub(queued),
        results,
    })
}

pub async fn prepare_month_campaign(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: MonthPrepareInput,
) -> Result<MonthPrepareResult, AppError> {
    let settings = settings(db, tenant_id, branch_id).await?;
    let date = resolve_date(db, input.date, &settings.timezone).await?;
    let channels = validate_channels(input.channels.unwrap_or(settings.channels))?;
    let occasions = repository::list_occasions(
        db,
        tenant_id,
        branch_id,
        date,
        month_end(date)?,
        "birthday",
        1000,
    )
    .await
    .map_err(|_| AppError::internal("failed to load birthday month clients"))?;
    let mut result = MonthPrepareResult {
        month: NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
            .ok_or_else(|| AppError::validation("date range is invalid"))?,
        prepared: 0,
        updated: 0,
        skipped: 0,
        drafts: Vec::new(),
    };
    for occasion in occasions {
        let options = message_suggestions_for(&[occasion.clone()], "birthday");
        let selected_message = first_message(&options).unwrap_or("");
        let existed = occasion.reminder_id.is_some();
        let Some(draft) = repository::upsert_draft(
            db,
            DraftWrite {
                tenant_id,
                branch_id,
                client_id: &occasion.client_id,
                event_type: "birthday",
                event_date: occasion.event_date,
                channels: channels.clone(),
                message_options_json: &options,
                selected_message,
                coupon_id: clean_optional(input.coupon_id.as_deref()),
                scheduled_send_at: None,
                actor_user_id,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to prepare birthday month draft"))?
        else {
            result.skipped += 1;
            continue;
        };
        if draft.status != "draft" {
            result.skipped += 1;
            continue;
        }
        if existed {
            result.updated += 1;
        } else {
            result.prepared += 1;
        }
        result.drafts.push(draft);
    }
    Ok(result)
}

async fn get_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
) -> Result<ReminderRecord, AppError> {
    repository::get_reminder(db, tenant_id, branch_id, reminder_id)
        .await
        .map_err(|_| AppError::internal("failed to load birthday reminder"))?
        .ok_or_else(|| AppError::not_found("birthday reminder not found"))
}

fn message_suggestions_for_views(rows: &[OccasionView], event_type: &str) -> Vec<Value> {
    message_suggestion_rows(
        &rows
            .iter()
            .map(|row| row.occasion.clone())
            .collect::<Vec<_>>(),
        event_type,
    )
}

fn message_suggestions_for(rows: &[OccasionRecord], event_type: &str) -> Value {
    Value::Array(message_suggestion_rows(rows, event_type))
}

fn message_suggestion_rows(rows: &[OccasionRecord], event_type: &str) -> Vec<Value> {
    let occasion = if event_type == "anniversary" {
        "anniversary"
    } else {
        "birthday"
    };
    let service = top_service_name(rows);
    [
        format!("Happy {occasion}! Your {service} gift is ready for this month."),
        format!("Wishing you a happy {occasion}. Visit us for a special {service} treat."),
        format!("Your {occasion} gift is waiting: a special offer on {service}."),
        format!("Happy {occasion}! Celebrate with your favourite {service} at AuraShine."),
        format!("This {occasion} month, enjoy a handpicked {service} gift from us."),
        format!("Best wishes on your {occasion}. Your {service} reward is ready."),
        format!("Celebrate your {occasion} with a special {service} salon gift."),
        format!("A warm {occasion} wish from AuraShine. Your {service} benefit is ready."),
        format!("Happy {occasion}! Book your {service} visit and use your birthday gift."),
        format!("Your {occasion} deserves a glow-up. Your {service} gift is ready."),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, text)| {
        json!({
            "id": format!("service-history-{}", index + 1),
            "source": "service-history",
            "serviceName": service,
            "eventType": occasion,
            "text": text,
        })
    })
    .collect()
}

fn offer_suggestions_for_views(rows: &[OccasionView]) -> Vec<Value> {
    let occasions = rows
        .iter()
        .map(|row| row.occasion.clone())
        .collect::<Vec<_>>();
    let service = top_service_name(&occasions);
    let gift = occasions
        .first()
        .map(gift_recommendation)
        .unwrap_or_else(|| json!({"title":"Birthday Gift","giftType":"free_addon"}));
    [
        ("service_discount", format!("Discount on {service}")),
        ("free_addon", format!("Free add-on with {service}")),
        ("upgrade", format!("Complimentary {service} upgrade")),
        (
            "priority_slot",
            format!("Priority birthday slot for {service}"),
        ),
        ("combo", format!("{service} celebration combo")),
        (
            "loyalty_bonus",
            format!("Extra loyalty points on {service}"),
        ),
        (
            "friend_pass",
            format!("Bring-a-friend benefit for {service}"),
        ),
        ("repeat_visit", format!("Next visit reward after {service}")),
        ("consultation", format!("Free consultation with {service}")),
        ("premium_pack", format!("Premium care pack with {service}")),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (kind, title))| {
        json!({
        "id": format!("service-offer-{}", index + 1),
            "kind": kind,
            "source": "service-history",
            "serviceName": service,
            "recommendedGift": gift.clone(),
            "title": title,
        })
    })
    .collect()
}

fn gift_recommendation(row: &OccasionRecord) -> Value {
    let service = row.most_used_service_name.trim();
    let service = if service.is_empty() {
        "favorite service"
    } else {
        service
    };
    let inactive_days = row
        .last_visit_at
        .map(|last| (Utc::now() - last).num_days())
        .unwrap_or(999);
    let (segment, gift_type, title, description, value_paise) = if inactive_days > 90 {
        (
            "inactive",
            "comeback_offer",
            format!("{service} Comeback Gift"),
            format!("Free consultation plus a comeback benefit on {service}"),
            150_000,
        )
    } else if row.lifetime_value_paise >= 100_000 || row.completed_visits >= 12 {
        (
            "high_spender",
            "premium_service",
            format!("Premium {service} Gift"),
            format!("Complimentary upgrade or premium benefit on {service}"),
            250_000,
        )
    } else if row.lifetime_value_paise >= 30_000 || row.completed_visits >= 5 {
        (
            "medium_spender",
            "discount_coupon",
            format!("{service} Priority Discount"),
            format!("Priority birthday discount on {service}"),
            100_000,
        )
    } else {
        (
            "low_spender",
            "free_addon",
            format!("Free Add-on With {service}"),
            format!("Complimentary add-on with the next {service} visit"),
            50_000,
        )
    };
    json!({
        "segment": segment,
        "giftType": gift_type,
        "title": title,
        "description": description,
        "valuePaise": value_paise,
        "serviceId": row.most_used_service_id.as_deref(),
        "serviceName": service,
    })
}

fn top_service_name(rows: &[OccasionRecord]) -> String {
    rows.iter()
        .filter_map(|row| {
            let name = row.most_used_service_name.trim();
            (!name.is_empty()).then_some((name, row.most_used_service_visits))
        })
        .max_by(|left, right| left.1.cmp(&right.1).then_with(|| right.0.cmp(left.0)))
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| "favorite service".to_string())
}

#[allow(clippy::too_many_arguments)]
async fn occasion_views(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    event_type: &str,
    limit: i64,
) -> Result<Vec<OccasionView>, AppError> {
    repository::list_occasions(
        db, tenant_id, branch_id, from_date, to_date, event_type, limit,
    )
    .await
    .map_err(|_| AppError::internal("failed to load birthday and anniversary occasions"))
    .map(|rows| {
        rows.into_iter()
            .map(|occasion| OccasionView {
                event_window: event_window(occasion.days_until, occasion.event_date, from_date),
                is_vip: is_vip(&occasion.categories_json),
                gift_recommendation: gift_recommendation(&occasion),
                occasion,
            })
            .collect()
    })
}

async fn resolve_date(
    db: &PgPool,
    requested: Option<NaiveDate>,
    timezone: &str,
) -> Result<NaiveDate, AppError> {
    match requested {
        Some(date) => Ok(date),
        None => repository::today_in_timezone(db, timezone)
            .await
            .map_err(|_| AppError::internal("failed to resolve branch date")),
    }
}

fn validate_channels(channels: Vec<String>) -> Result<Vec<String>, AppError> {
    let channels = channels
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>();
    if channels.is_empty()
        || channels.len() > 3
        || channels
            .iter()
            .any(|channel| !CHANNELS.contains(&channel.as_str()))
    {
        return Err(AppError::validation(
            "channels must contain WhatsApp, SMS, or email",
        ));
    }
    Ok(channels.into_iter().collect())
}

fn validate_message(message: &str, required: bool) -> Result<(), AppError> {
    let length = message.trim().chars().count();
    if (required && length == 0) || length > MAX_MESSAGE_LENGTH {
        return Err(AppError::validation(
            "message must contain between 1 and 4000 characters",
        ));
    }
    Ok(())
}

fn validate_message_options(value: &Value) -> Result<(), AppError> {
    let options = value
        .as_array()
        .ok_or_else(|| AppError::validation("messageOptions must be an array"))?;
    if options.len() > 20 {
        return Err(AppError::validation(
            "messageOptions cannot contain more than 20 items",
        ));
    }
    Ok(())
}

fn validate_optional(value: Option<&str>, supported: &[&str], label: &str) -> Result<(), AppError> {
    if value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|value| !supported.contains(&value))
    {
        Err(AppError::validation(format!("invalid {label}")))
    } else {
        Ok(())
    }
}

fn clean_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn first_message(options: &Value) -> Option<&str> {
    options
        .as_array()?
        .iter()
        .find_map(|value| value.get("text")?.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn filter_event(rows: &[OccasionView], event_type: &str) -> Vec<OccasionView> {
    rows.iter()
        .filter(|row| row.occasion.event_type == event_type)
        .cloned()
        .collect()
}

fn event_window(days_until: i32, event_date: NaiveDate, from_date: NaiveDate) -> String {
    if days_until == 0 {
        "today"
    } else if (0..=7).contains(&days_until) {
        "week"
    } else if event_date.year() == from_date.year() && event_date.month() == from_date.month() {
        "month"
    } else {
        "later"
    }
    .into()
}

fn is_vip(value: &Value) -> bool {
    match value {
        Value::String(value) => value.trim().eq_ignore_ascii_case("vip"),
        Value::Array(values) => values.iter().any(is_vip),
        Value::Object(values) => values.values().any(is_vip),
        _ => false,
    }
}

fn parse_send_time(value: &str) -> Result<NaiveTime, AppError> {
    NaiveTime::parse_from_str(value.trim(), "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(value.trim(), "%H:%M:%S"))
        .map_err(|_| AppError::validation("defaultSendTime must use HH:mm"))
}

fn add_days(date: NaiveDate, days: i64) -> Result<NaiveDate, AppError> {
    date.checked_add_signed(Duration::days(days))
        .ok_or_else(|| AppError::validation("date range is invalid"))
}

fn month_end(date: NaiveDate) -> Result<NaiveDate, AppError> {
    let (year, month) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    NaiveDate::from_ymd_opt(year, month, 1)
        .and_then(|next| next.pred_opt())
        .ok_or_else(|| AppError::validation("date range is invalid"))
}

#[cfg(test)]
mod tests {
    use super::{event_window, is_vip, parse_send_time, validate_channels};
    use chrono::NaiveDate;
    use serde_json::json;

    #[test]
    fn validates_channels_and_real_category_vip_only() {
        assert_eq!(
            validate_channels(vec!["SMS".into(), "whatsapp".into(), "sms".into()]).unwrap(),
            vec!["sms".to_string(), "whatsapp".to_string()]
        );
        assert!(validate_channels(vec!["push".into()]).is_err());
        assert!(is_vip(&json!([{"name":"VIP"}])));
        assert!(!is_vip(&json!([{"name":"Premium"}])));
    }

    #[test]
    fn formats_windows_and_send_time_without_browser_date_assumptions() {
        let base = NaiveDate::from_ymd_opt(2027, 2, 1).unwrap();
        assert_eq!(event_window(0, base, base), "today");
        assert_eq!(
            event_window(6, NaiveDate::from_ymd_opt(2027, 2, 7).unwrap(), base),
            "week"
        );
        assert_eq!(
            parse_send_time("09:30")
                .unwrap()
                .format("%H:%M")
                .to_string(),
            "09:30"
        );
    }
}
