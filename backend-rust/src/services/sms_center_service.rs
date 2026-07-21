use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::sms_center_repository::{
        self, SmsCenterCampaignRecord, SmsCenterHistoryRecord, SmsCenterRecipient,
    },
    services::auth_service::AuthClaims,
};

const AUDIENCES: &[&str] = &[
    "clients_all",
    "clients_paid",
    "clients_unpaid",
    "clients_wallet",
    "staff_all",
    "staff_salary",
];
const CATEGORIES: &[&str] = &[
    "general",
    "appointment",
    "appointment_confirmation",
    "appointment_reminder",
    "appointment_reschedule",
    "appointment_cancellation",
    "product",
    "product_offer",
    "inventory",
    "inventory_low_stock",
    "service_promotion",
    "paid",
    "paid_invoice_receipt",
    "unpaid",
    "unpaid_payment_reminder",
    "wallet",
    "wallet_balance",
    "staff_announcement",
    "staff_shift",
    "staff_attendance",
    "salary",
    "birthday",
    "anniversary",
    "membership_renewal",
    "package_renewal",
    "client_follow_up",
    "feedback_review",
    "festival_campaign",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsCenterCampaignRequest {
    pub channel: String,
    pub audience: String,
    pub category: String,
    pub subject: Option<String>,
    pub message: String,
    pub confirmed_sensitive: Option<bool>,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsCenterSummary {
    pub eligible_recipients: usize,
    pub campaigns: Vec<SmsCenterHistoryRecord>,
}

pub async fn summary(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    audience: &str,
    channel: &str,
) -> Result<SmsCenterSummary, AppError> {
    validate_channel_audience(channel, audience)?;
    let eligible_recipients =
        sms_center_repository::recipients(db, tenant, branch, audience, channel)
            .await
            .map_err(|_| AppError::internal("failed to load SMS Center audience"))?
            .len();
    let campaigns = sms_center_repository::recent_campaigns(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to load SMS Center history"))?;
    Ok(SmsCenterSummary {
        eligible_recipients,
        campaigns,
    })
}

pub async fn create_campaign(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    claims: &AuthClaims,
    request: SmsCenterCampaignRequest,
) -> Result<SmsCenterHistoryRecord, AppError> {
    let channel = request.channel.trim().to_ascii_lowercase();
    let audience = request.audience.trim().to_ascii_lowercase();
    let category = request.category.trim().to_ascii_lowercase();
    validate_channel_audience(&channel, &audience)?;
    if !CATEGORIES.contains(&category.as_str()) {
        return Err(AppError::validation("SMS Center category is invalid"));
    }
    if staff_only_category(&category) && !audience.starts_with("staff_") {
        return Err(AppError::validation(
            "this SMS Center category must target staff",
        ));
    }
    if client_only_category(&category) && !audience.starts_with("clients_") {
        return Err(AppError::validation(
            "this SMS Center category must target clients",
        ));
    }
    if category == "salary" || audience == "staff_salary" {
        if category != "salary" || audience != "staff_salary" {
            return Err(AppError::validation(
                "salary messages require the Staff - Salary audience",
            ));
        }
        require_payroll_access(claims)?;
        if request.confirmed_sensitive != Some(true) {
            return Err(AppError::validation(
                "salary message confirmation is required",
            ));
        }
    }
    let body = required_text(&request.message, 1000, "message is required")?;
    let subject = match channel.as_str() {
        "email" => required_text(
            request.subject.as_deref().unwrap_or(""),
            160,
            "email subject is required",
        )?,
        _ => request
            .subject
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(category.as_str())
            .to_string(),
    };
    let key = request.idempotency_key.trim();
    if !(8..=100).contains(&key.len())
        || !key
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | ':'))
    {
        return Err(AppError::validation("idempotency key is invalid"));
    }
    let eligible = sms_center_repository::recipients(db, tenant, branch, &audience, &channel)
        .await
        .map_err(|_| AppError::internal("failed to validate SMS Center audience"))?;
    if eligible.is_empty() {
        return Err(AppError::conflict(
            "no eligible recipients have a valid destination and required consent",
        ));
    }
    let metadata = json!({
        "channel":channel,"audience":audience,"category":category,"status":"scheduled",
        "eligibleRecipients":eligible.len(),"recipientCount":0,"deliveredCount":0,"failedCount":0,
        "blockedCount":0,"lastError":"","idempotencyKey":key,"sensitive":category=="salary"
    });
    if let Some(row) = sms_center_repository::insert_campaign(
        db,
        tenant,
        branch,
        &claims.sub,
        &subject,
        &body,
        &metadata,
    )
    .await
    .map_err(|_| AppError::internal("failed to create SMS Center campaign"))?
    {
        return Ok(row);
    }
    sms_center_repository::campaign_by_idempotency(db, tenant, branch, key)
        .await
        .map_err(|_| AppError::internal("failed to load SMS Center campaign"))?
        .ok_or_else(|| AppError::conflict("SMS Center request already exists"))
}

pub async fn schedule_due(db: &PgPool) -> Result<usize, AppError> {
    let campaigns = sms_center_repository::due_campaigns(db, 25)
        .await
        .map_err(|_| AppError::internal("failed to load due SMS Center campaigns"))?;
    let mut total = 0;
    for campaign in campaigns {
        let recipients = sms_center_repository::recipients(
            db,
            &campaign.tenant_id,
            &campaign.branch_id,
            &campaign.audience,
            &campaign.channel,
        )
        .await
        .map_err(|_| AppError::internal("failed to load SMS Center recipients"))?;
        let mut queued = 0;
        for recipient in recipients {
            let payload = delivery_payload(&campaign, &recipient);
            queued += sms_center_repository::enqueue_recipient(db, &campaign, &recipient, &payload)
                .await
                .map_err(|_| AppError::internal("failed to queue SMS Center delivery"))?
                as usize;
        }
        sms_center_repository::mark_campaign_queued(db, &campaign, queued)
            .await
            .map_err(|_| AppError::internal("failed to update SMS Center campaign"))?;
        total += queued;
    }
    Ok(total)
}

pub async fn refresh_campaign_statuses(db: &PgPool) -> Result<(), AppError> {
    sms_center_repository::refresh_campaign_statuses(db)
        .await
        .map_err(|_| AppError::internal("failed to refresh SMS Center campaign status"))
}

pub async fn staff_delivery_allowed(
    db: &PgPool,
    row: &crate::repositories::benefit_notification_repository::BenefitDeliveryRecord,
) -> Result<bool, AppError> {
    let staff_id = row
        .payload_json
        .get("staffId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let recipient = row
        .payload_json
        .get("recipient")
        .and_then(Value::as_str)
        .unwrap_or("");
    let salary = row.payload_json.get("category").and_then(Value::as_str) == Some("salary");
    if staff_id.is_empty() || recipient.is_empty() {
        return Ok(false);
    }
    sms_center_repository::staff_delivery_allowed(
        db,
        &row.tenant_id,
        &row.branch_id,
        staff_id,
        &row.channel,
        recipient,
        salary,
    )
    .await
    .map_err(|_| AppError::internal("failed to recheck staff SMS Center recipient"))
}

fn delivery_payload(campaign: &SmsCenterCampaignRecord, recipient: &SmsCenterRecipient) -> Value {
    let message = render_message(&campaign.body, recipient);
    json!({
        "campaignId":campaign.id,"channel":campaign.channel,"recipient":recipient.recipient,
        "message":message,"subject":campaign.title,"category":campaign.category,
        "recipientKind":recipient.recipient_kind,"staffId":if recipient.recipient_kind=="staff" { recipient.recipient_id.as_str() } else { "" },
        "clientName":recipient.display_name,"templateKind":"conversation"
    })
}

fn render_message(template: &str, recipient: &SmsCenterRecipient) -> String {
    template
        .replace("{{name}}", &recipient.display_name)
        .replace("{{staffName}}", &recipient.display_name)
        .replace(
            "{{walletBalance}}",
            &format_paise(recipient.wallet_balance_paise),
        )
        .replace(
            "{{outstandingAmount}}",
            &format_paise(recipient.outstanding_paise),
        )
        .replace(
            "{{lastPaidAmount}}",
            &format_paise(recipient.last_paid_paise),
        )
        .replace("{{salary}}", &format_paise(recipient.salary_paise))
        .replace(
            "{{periodStart}}",
            &recipient
                .period_start
                .map(|value| value.format("%d/%m/%Y").to_string())
                .unwrap_or_default(),
        )
        .replace(
            "{{periodEnd}}",
            &recipient
                .period_end
                .map(|value| value.format("%d/%m/%Y").to_string())
                .unwrap_or_default(),
        )
}

fn format_paise(value: i64) -> String {
    format!("₹{}.{:02}", value / 100, value.abs() % 100)
}

fn staff_only_category(category: &str) -> bool {
    matches!(
        category,
        "inventory"
            | "inventory_low_stock"
            | "staff_announcement"
            | "staff_shift"
            | "staff_attendance"
            | "salary"
    )
}

fn client_only_category(category: &str) -> bool {
    matches!(
        category,
        "appointment"
            | "appointment_confirmation"
            | "appointment_reminder"
            | "appointment_reschedule"
            | "appointment_cancellation"
            | "product_offer"
            | "service_promotion"
            | "paid"
            | "paid_invoice_receipt"
            | "unpaid"
            | "unpaid_payment_reminder"
            | "wallet"
            | "wallet_balance"
            | "birthday"
            | "anniversary"
            | "membership_renewal"
            | "package_renewal"
            | "client_follow_up"
            | "feedback_review"
            | "festival_campaign"
    )
}

fn validate_channel_audience(channel: &str, audience: &str) -> Result<(), AppError> {
    if !matches!(channel, "whatsapp" | "sms" | "email") {
        return Err(AppError::validation(
            "channel must be WhatsApp, SMS or email",
        ));
    }
    if !AUDIENCES.contains(&audience) {
        return Err(AppError::validation("SMS Center audience is invalid"));
    }
    Ok(())
}

fn required_text(value: &str, max: usize, message: &'static str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::validation(message));
    }
    Ok(value.to_string())
}

fn require_payroll_access(claims: &AuthClaims) -> Result<(), AppError> {
    let permissions = ["staff.payroll.manage", "staff.manage", "management.write"];
    if claims
        .denied_permissions
        .iter()
        .any(|value| permissions.contains(&value.as_str()))
    {
        return Err(AppError::forbidden("salary messaging permission is denied"));
    }
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
        || claims
            .permissions
            .iter()
            .any(|value| permissions.contains(&value.as_str()))
    {
        return Ok(());
    }
    Err(AppError::forbidden(
        "salary messaging requires payroll management permission",
    ))
}

#[cfg(test)]
mod tests {
    use super::{render_message, SmsCenterRecipient};

    #[test]
    fn renders_real_recipient_values_and_unicode() {
        let recipient = SmsCenterRecipient {
            recipient_id: "staff-1".into(),
            recipient_kind: "staff".into(),
            display_name: "Asha".into(),
            recipient: "919999999999".into(),
            wallet_balance_paise: 0,
            outstanding_paise: 0,
            last_paid_paise: 0,
            salary_paise: 125050,
            period_start: None,
            period_end: None,
        };
        assert_eq!(
            render_message("Hi {{staffName}} 😊 Salary {{salary}}", &recipient),
            "Hi Asha 😊 Salary ₹1250.50"
        );
    }
}
