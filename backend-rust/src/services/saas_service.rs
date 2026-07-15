use chrono::{DateTime, Datelike, Duration, FixedOffset, Months, TimeZone, Timelike, Utc, Weekday};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::BTreeSet;
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::saas_repository::{self, BillingContext, PlanWrite, SlaWrite},
    services::security_service,
};

const SEVERITIES: &[&str] = &["low", "medium", "high", "critical"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlaPolicyInput {
    pub severity: String,
    pub first_response_minutes: i32,
    pub resolution_minutes: i32,
    #[serde(default)]
    pub business_hours_only: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanInput {
    pub version: Option<i32>,
    pub code: String,
    pub name: String,
    pub billing_interval: String,
    pub base_price_paise: i64,
    pub included_branches: i32,
    pub included_users: i32,
    pub included_appointments: i32,
    pub overage_branch_paise: i64,
    pub overage_user_paise: i64,
    pub overage_appointment_paise: i64,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default = "default_true")]
    pub active: bool,
    pub sla: Vec<SlaPolicyInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionCreate {
    pub tenant_id: String,
    pub plan_id: String,
    pub status: String,
    pub starts_at: Option<DateTime<Utc>>,
    pub trial_ends_at: Option<DateTime<Utc>>,
    #[serde(default = "manual_provider")]
    pub provider: String,
    #[serde(default)]
    pub provider_customer_ref: String,
    #[serde(default)]
    pub provider_subscription_ref: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionUpdate {
    pub version: i32,
    pub plan_id: String,
    pub status: String,
    #[serde(default)]
    pub cancel_at_period_end: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageEventInput {
    pub tenant_id: String,
    pub branch_id: String,
    pub subscription_id: String,
    pub metric: String,
    pub quantity: i64,
    pub idempotency_key: String,
    pub occurred_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvoiceIssueInput {
    pub subscription_id: String,
    #[serde(default)]
    pub tax_bps: i32,
    #[serde(default = "default_due_days")]
    pub due_days: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BillingRunInput {
    #[serde(default)]
    pub tax_bps: i32,
    #[serde(default = "default_due_days")]
    pub due_days: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvoicePaymentInput {
    pub amount_paise: i64,
    pub payment_method: String,
    #[serde(default)]
    pub reference: String,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketCreateInput {
    pub subject: String,
    pub category: String,
    pub severity: String,
    #[serde(default = "normal_priority")]
    pub priority: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketMessageInput {
    pub body: String,
    #[serde(default = "customer_visibility")]
    pub visibility: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketUpdateInput {
    pub status: String,
    pub priority: String,
    pub assigned_to: Option<String>,
}

fn default_true() -> bool {
    true
}
fn manual_provider() -> String {
    "manual".into()
}
fn default_due_days() -> i64 {
    7
}
fn normal_priority() -> String {
    "normal".into()
}
fn customer_visibility() -> String {
    "customer".into()
}

pub async fn platform_overview(db: &PgPool) -> Result<Value, AppError> {
    saas_repository::platform_overview(db)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS overview"))
}

pub async fn tenants(db: &PgPool) -> Result<Vec<Value>, AppError> {
    saas_repository::list_tenants(db)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS tenants"))
}

pub async fn plans(db: &PgPool, include_inactive: bool) -> Result<Vec<Value>, AppError> {
    saas_repository::list_plans(db, include_inactive)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS plans"))
}

pub async fn create_plan(
    db: &PgPool,
    actor: &str,
    payload: PlanInput,
) -> Result<Vec<Value>, AppError> {
    let plan = validate_plan(payload)?;
    saas_repository::create_plan(db, actor, &plan)
        .await
        .map_err(|error| {
            if error
                .to_string()
                .contains("saas_plans_tenant_id_branch_id_code_key")
            {
                AppError::conflict("SaaS plan code already exists")
            } else {
                AppError::internal("failed to create SaaS plan")
            }
        })?;
    platform_audit(db, actor, "saas.plan.created", json!({"code":plan.code})).await;
    plans(db, true).await
}

pub async fn update_plan(
    db: &PgPool,
    id: &str,
    actor: &str,
    payload: PlanInput,
) -> Result<Vec<Value>, AppError> {
    let version = payload
        .version
        .ok_or_else(|| AppError::validation("plan version is required"))?;
    let plan = validate_plan(payload)?;
    if !saas_repository::update_plan(db, id, actor, version, &plan)
        .await
        .map_err(|_| AppError::internal("failed to update SaaS plan"))?
    {
        return Err(AppError::conflict(
            "SaaS plan changed; reload and try again",
        ));
    }
    platform_audit(
        db,
        actor,
        "saas.plan.updated",
        json!({"planId":id,"version":version}),
    )
    .await;
    plans(db, true).await
}

fn validate_plan(payload: PlanInput) -> Result<PlanWrite, AppError> {
    let code = payload.code.trim().to_ascii_uppercase();
    let name = payload.name.trim();
    let interval = payload.billing_interval.trim().to_ascii_lowercase();
    if !(2..=40).contains(&code.len())
        || !code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        || !(2..=100).contains(&name.chars().count())
        || !matches!(interval.as_str(), "monthly" | "yearly")
    {
        return Err(AppError::validation("SaaS plan identity is invalid"));
    }
    for value in [
        payload.base_price_paise,
        payload.overage_branch_paise,
        payload.overage_user_paise,
        payload.overage_appointment_paise,
    ] {
        if !(0..=1_000_000_000).contains(&value) {
            return Err(AppError::validation("SaaS plan amount is invalid"));
        }
    }
    for value in [
        payload.included_branches,
        payload.included_users,
        payload.included_appointments,
    ] {
        if !(0..=1_000_000).contains(&value) {
            return Err(AppError::validation("SaaS plan allowance is invalid"));
        }
    }
    let mut features = BTreeSet::new();
    for value in payload.features {
        let feature = value.trim();
        if feature.is_empty() || feature.chars().count() > 100 {
            return Err(AppError::validation("SaaS plan feature is invalid"));
        }
        features.insert(feature.to_string());
    }
    if features.len() > 100 {
        return Err(AppError::validation(
            "SaaS plan supports at most 100 features",
        ));
    }
    if payload.sla.len() != 4 {
        return Err(AppError::validation(
            "SLA requires low, medium, high and critical policies",
        ));
    }
    let mut severities = BTreeSet::new();
    let mut sla = Vec::with_capacity(4);
    for policy in payload.sla {
        let severity = policy.severity.trim().to_ascii_lowercase();
        if !SEVERITIES.contains(&severity.as_str())
            || !severities.insert(severity.clone())
            || !(1..=43_200).contains(&policy.first_response_minutes)
            || !(policy.first_response_minutes..=129_600).contains(&policy.resolution_minutes)
        {
            return Err(AppError::validation("SLA policy is invalid"));
        }
        sla.push(SlaWrite {
            severity,
            first_response_minutes: policy.first_response_minutes,
            resolution_minutes: policy.resolution_minutes,
            business_hours_only: policy.business_hours_only,
        });
    }
    Ok(PlanWrite {
        code,
        name: name.to_string(),
        billing_interval: interval,
        base_price_paise: payload.base_price_paise,
        included_branches: payload.included_branches,
        included_users: payload.included_users,
        included_appointments: payload.included_appointments,
        overage_branch_paise: payload.overage_branch_paise,
        overage_user_paise: payload.overage_user_paise,
        overage_appointment_paise: payload.overage_appointment_paise,
        features: json!(features.into_iter().collect::<Vec<_>>()),
        active: payload.active,
        sla,
    })
}

pub async fn subscriptions(db: &PgPool, tenant: Option<&str>) -> Result<Vec<Value>, AppError> {
    saas_repository::list_subscriptions(db, tenant)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS subscriptions"))
}

pub async fn create_subscription(
    db: &PgPool,
    actor: &str,
    payload: SubscriptionCreate,
) -> Result<Vec<Value>, AppError> {
    let tenant = payload.tenant_id.trim();
    let status = payload.status.trim().to_ascii_lowercase();
    let provider = payload.provider.trim().to_ascii_lowercase();
    if tenant.is_empty()
        || tenant.eq_ignore_ascii_case("platform")
        || !matches!(status.as_str(), "trialing" | "active")
        || !matches!(provider.as_str(), "manual" | "razorpay" | "stripe")
        || payload.provider_customer_ref.chars().count() > 160
        || payload.provider_subscription_ref.chars().count() > 160
    {
        return Err(AppError::validation(
            "SaaS subscription details are invalid",
        ));
    }
    if !saas_repository::tenant_exists(db, tenant)
        .await
        .map_err(|_| AppError::internal("failed to validate tenant"))?
    {
        return Err(AppError::not_found("active tenant was not found"));
    }
    let plan = saas_repository::list_plans(db, false)
        .await
        .map_err(|_| AppError::internal("failed to validate plan"))?
        .into_iter()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(payload.plan_id.trim()))
        .ok_or_else(|| AppError::not_found("active SaaS plan was not found"))?;
    let interval = plan
        .get("billingInterval")
        .and_then(Value::as_str)
        .unwrap_or("monthly");
    let start = payload.starts_at.unwrap_or_else(Utc::now);
    let end = next_period(start, interval)?;
    if payload
        .trial_ends_at
        .is_some_and(|value| value <= start || value > end)
    {
        return Err(AppError::validation(
            "trial end must be inside the first billing period",
        ));
    }
    saas_repository::create_subscription(
        db,
        tenant,
        payload.plan_id.trim(),
        &status,
        start,
        end,
        payload.trial_ends_at,
        &provider,
        payload.provider_customer_ref.trim(),
        payload.provider_subscription_ref.trim(),
        actor,
    )
    .await
    .map_err(|error| {
        if error
            .to_string()
            .contains("idx_saas_subscription_one_current")
        {
            AppError::conflict("tenant already has a current subscription")
        } else {
            AppError::internal("failed to create SaaS subscription")
        }
    })?;
    platform_audit(
        db,
        actor,
        "saas.subscription.created",
        json!({"tenantId":tenant,"planId":payload.plan_id}),
    )
    .await;
    subscriptions(db, None).await
}

pub async fn update_subscription(
    db: &PgPool,
    id: &str,
    actor: &str,
    payload: SubscriptionUpdate,
) -> Result<Vec<Value>, AppError> {
    let status = payload.status.trim().to_ascii_lowercase();
    if !matches!(
        status.as_str(),
        "trialing" | "active" | "past_due" | "paused" | "cancelled"
    ) {
        return Err(AppError::validation("subscription status is invalid"));
    }
    if !saas_repository::update_subscription(
        db,
        id,
        payload.plan_id.trim(),
        &status,
        payload.cancel_at_period_end,
        actor,
        payload.version,
    )
    .await
    .map_err(|_| AppError::internal("failed to update SaaS subscription"))?
    {
        return Err(AppError::conflict(
            "subscription changed; reload and try again",
        ));
    }
    platform_audit(
        db,
        actor,
        "saas.subscription.updated",
        json!({"subscriptionId":id,"status":status}),
    )
    .await;
    subscriptions(db, None).await
}

pub async fn usage(db: &PgPool, tenant: Option<&str>) -> Result<Vec<Value>, AppError> {
    saas_repository::list_usage(db, tenant)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS usage"))
}

pub async fn record_usage(
    db: &PgPool,
    actor: &str,
    payload: UsageEventInput,
) -> Result<Value, AppError> {
    let metric = payload.metric.trim().to_ascii_lowercase();
    let key = payload.idempotency_key.trim();
    if !matches!(
        metric.as_str(),
        "api_calls" | "messages" | "storage_mb" | "custom"
    ) || !(1..=1_000_000_000).contains(&payload.quantity)
        || key.is_empty()
        || key.len() > 160
        || payload.metadata.as_object().is_none()
    {
        return Err(AppError::validation("usage event is invalid"));
    }
    let created = saas_repository::record_usage(
        db,
        payload.tenant_id.trim(),
        payload.branch_id.trim(),
        payload.subscription_id.trim(),
        &metric,
        payload.quantity,
        key,
        payload.occurred_at.unwrap_or_else(Utc::now),
        &payload.metadata,
    )
    .await
    .map_err(|_| AppError::internal("failed to record SaaS usage"))?;
    platform_audit(
        db,
        actor,
        "saas.usage.recorded",
        json!({"tenantId":payload.tenant_id,"metric":metric,"replayed":!created}),
    )
    .await;
    Ok(json!({"recorded":created,"replayed":!created}))
}

pub async fn invoices(db: &PgPool, tenant: Option<&str>) -> Result<Vec<Value>, AppError> {
    saas_repository::list_invoices(db, tenant)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS invoices"))
}

pub async fn issue_invoice(
    db: &PgPool,
    actor: &str,
    payload: InvoiceIssueInput,
) -> Result<Vec<Value>, AppError> {
    if !(0..=10_000).contains(&payload.tax_bps) || !(1..=90).contains(&payload.due_days) {
        return Err(AppError::validation("invoice tax or due days are invalid"));
    }
    let context = saas_repository::billing_context(db, payload.subscription_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load billing context"))?
        .ok_or_else(|| AppError::not_found("subscription was not found"))?;
    if matches!(context.status.as_str(), "cancelled" | "paused") {
        return Err(AppError::conflict(
            "subscription cannot be billed in its current status",
        ));
    }
    if context.current_period_start > Utc::now() {
        return Err(AppError::conflict("next billing period has not started"));
    }
    if context
        .trial_ends_at
        .is_some_and(|value| value > Utc::now())
    {
        return Err(AppError::conflict("subscription trial has not ended"));
    }
    let invoice_number =
        issue_context(db, actor, &context, payload.tax_bps, payload.due_days).await?;
    platform_audit(
        db,
        actor,
        "saas.invoice.issued",
        json!({"subscriptionId":context.subscription_id,"invoiceNumber":invoice_number}),
    )
    .await;
    invoices(db, None).await
}

pub async fn run_billing(
    db: &PgPool,
    actor: &str,
    payload: BillingRunInput,
) -> Result<Value, AppError> {
    if !(0..=10_000).contains(&payload.tax_bps) || !(1..=90).contains(&payload.due_days) {
        return Err(AppError::validation(
            "billing run tax or due days are invalid",
        ));
    }
    let prepared = saas_repository::prepare_billing_run(db, actor)
        .await
        .map_err(|_| AppError::internal("failed to prepare billing run"))?;
    let contexts = saas_repository::billable_contexts(db)
        .await
        .map_err(|_| AppError::internal("failed to load billable subscriptions"))?;
    let mut generated = 0usize;
    for context in contexts {
        issue_context(db, actor, &context, payload.tax_bps, payload.due_days).await?;
        generated += 1;
    }
    platform_audit(
        db,
        actor,
        "saas.billing.run",
        json!({"generated":generated,"taxBps":payload.tax_bps,"prepared":prepared}),
    )
    .await;
    Ok(json!({"generated":generated,"prepared":prepared,"invoices":invoices(db,None).await?}))
}

async fn issue_context(
    db: &PgPool,
    actor: &str,
    context: &BillingContext,
    tax_bps: i32,
    due_days: i64,
) -> Result<String, AppError> {
    let usage = saas_repository::usage_snapshot(db, &context)
        .await
        .map_err(|_| AppError::internal("failed to calculate subscription usage"))?;
    let usage_amount = usage_charge(
        &context,
        usage.branch_count,
        usage.active_user_count,
        usage.appointment_count,
    );
    let taxable = context.base_price_paise + usage_amount;
    let tax = taxable.saturating_mul(i64::from(tax_bps)) / 10_000;
    let key = format!(
        "saas-cycle:{}:{}",
        context.subscription_id,
        context.current_period_start.format("%Y%m%d%H%M%S")
    );
    let invoice_number = format!(
        "SAS-{}-{}",
        Utc::now().format("%Y%m"),
        &Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase()
    );
    let next_end = next_period(context.current_period_end, &context.billing_interval)?;
    saas_repository::issue_invoice(
        db,
        &context,
        &invoice_number,
        usage_amount,
        tax,
        Utc::now() + Duration::days(due_days),
        &key,
        next_end,
        actor,
    )
    .await
    .map_err(|error| {
        if matches!(error, sqlx::Error::RowNotFound) {
            AppError::conflict("billing period changed; reload and try again")
        } else {
            AppError::internal("failed to issue SaaS invoice")
        }
    })?;
    Ok(invoice_number)
}

pub async fn record_payment(
    db: &PgPool,
    id: &str,
    actor: &str,
    payload: InvoicePaymentInput,
) -> Result<Vec<Value>, AppError> {
    let method = payload.payment_method.trim().to_ascii_lowercase();
    let key = payload.idempotency_key.trim();
    if !(1..=1_000_000_000).contains(&payload.amount_paise)
        || !matches!(
            method.as_str(),
            "bank" | "upi" | "cash" | "card" | "provider"
        )
        || key.is_empty()
        || key.len() > 160
        || payload.reference.chars().count() > 160
    {
        return Err(AppError::validation("SaaS invoice payment is invalid"));
    }
    saas_repository::record_payment(
        db,
        id,
        payload.amount_paise,
        &method,
        payload.reference.trim(),
        key,
        actor,
    )
    .await
    .map_err(|error| {
        if error.to_string().contains("exceeds invoice balance") {
            AppError::conflict("payment exceeds invoice balance")
        } else {
            AppError::internal("failed to record SaaS payment")
        }
    })?
    .ok_or_else(|| AppError::not_found("open SaaS invoice was not found"))?;
    platform_audit(
        db,
        actor,
        "saas.payment.recorded",
        json!({"invoiceId":id,"amountPaise":payload.amount_paise}),
    )
    .await;
    invoices(db, None).await
}

pub async fn tenant_context(db: &PgPool, tenant: &str) -> Result<Value, AppError> {
    let subscription = saas_repository::current_subscription(db, tenant)
        .await
        .map_err(|_| AppError::internal("failed to load tenant subscription"))?;
    let usage = if let Some(id) = subscription
        .as_ref()
        .and_then(|row| row.get("id"))
        .and_then(Value::as_str)
    {
        if let Some(context) = saas_repository::billing_context(db, id)
            .await
            .map_err(|_| AppError::internal("failed to load usage context"))?
        {
            Some(
                saas_repository::usage_snapshot(db, &context)
                    .await
                    .map_err(|_| AppError::internal("failed to calculate tenant usage"))?,
            )
        } else {
            None
        }
    } else {
        None
    };
    let invoices = invoices(db, Some(tenant)).await?;
    let tickets = tickets(db, Some(tenant)).await?;
    let plans = plans(db, false).await?;
    Ok(
        json!({"subscription":subscription,"usage":usage,"invoices":invoices,"tickets":tickets,"plans":plans}),
    )
}

pub async fn tickets(db: &PgPool, tenant: Option<&str>) -> Result<Vec<Value>, AppError> {
    saas_repository::list_tickets(db, tenant)
        .await
        .map_err(|_| AppError::internal("failed to load support tickets"))
}

pub async fn create_ticket(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    payload: TicketCreateInput,
) -> Result<Value, AppError> {
    let subject = payload.subject.trim();
    let category = payload.category.trim().to_ascii_lowercase();
    let severity = payload.severity.trim().to_ascii_lowercase();
    let priority = payload.priority.trim().to_ascii_lowercase();
    let message = payload.message.trim();
    if !(3..=160).contains(&subject.chars().count())
        || !matches!(
            category.as_str(),
            "billing" | "technical" | "account" | "data" | "security" | "other"
        )
        || !SEVERITIES.contains(&severity.as_str())
        || !matches!(priority.as_str(), "normal" | "urgent")
        || !(3..=5000).contains(&message.chars().count())
    {
        return Err(AppError::validation("support ticket details are invalid"));
    }
    let sla = saas_repository::ticket_sla_context(db, tenant, &severity)
        .await
        .map_err(|_| AppError::internal("failed to load support SLA"))?;
    let (subscription_id, plan_id, response_minutes, resolution_minutes, business_hours) = sla
        .map(|value| {
            (
                value.subscription_id,
                value.plan_id,
                value.first_response_minutes,
                value.resolution_minutes,
                value.business_hours_only,
            )
        })
        .unwrap_or_else(|| ("".into(), "".into(), 1440, 4320, false));
    let now = Utc::now();
    let first_due = add_sla_minutes(now, response_minutes, business_hours);
    let resolution_due = add_sla_minutes(now, resolution_minutes, business_hours);
    let number = format!(
        "SUP-{}-{}",
        now.format("%Y%m%d"),
        &Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase()
    );
    let id = saas_repository::create_ticket(
        db,
        tenant,
        branch,
        actor,
        &number,
        subject,
        &category,
        &severity,
        &priority,
        message,
        &subscription_id,
        &plan_id,
        first_due,
        resolution_due,
    )
    .await
    .map_err(|_| AppError::internal("failed to create support ticket"))?;
    tenant_audit(
        db,
        tenant,
        branch,
        actor,
        "saas.ticket.created",
        json!({"ticketId":id,"ticketNumber":number}),
    )
    .await;
    ticket_detail(db, &id, Some(tenant), false).await
}

pub async fn ticket_detail(
    db: &PgPool,
    id: &str,
    tenant: Option<&str>,
    internal: bool,
) -> Result<Value, AppError> {
    saas_repository::ticket_detail(db, id, tenant, internal)
        .await
        .map_err(|_| AppError::internal("failed to load support ticket"))?
        .ok_or_else(|| AppError::not_found("support ticket was not found"))
}

pub async fn add_message(
    db: &PgPool,
    id: &str,
    tenant: Option<&str>,
    actor: &str,
    is_support: bool,
    payload: TicketMessageInput,
) -> Result<Value, AppError> {
    let body = payload.body.trim();
    let visibility = payload.visibility.trim().to_ascii_lowercase();
    if !(1..=5000).contains(&body.chars().count())
        || !matches!(visibility.as_str(), "customer" | "internal")
        || (!is_support && visibility != "customer")
    {
        return Err(AppError::validation("support message is invalid"));
    }
    if !saas_repository::add_ticket_message(
        db,
        id,
        tenant,
        actor,
        if is_support { "support" } else { "customer" },
        &visibility,
        body,
    )
    .await
    .map_err(|_| AppError::internal("failed to add support message"))?
    {
        return Err(AppError::not_found("support ticket was not found"));
    }
    let detail = ticket_detail(db, id, tenant, is_support).await?;
    if is_support {
        platform_audit(
            db,
            actor,
            "saas.ticket.message",
            json!({"ticketId":id,"visibility":visibility}),
        )
        .await;
    } else if let Some(tenant_id) = tenant {
        let branch = detail
            .get("ticket")
            .and_then(|value| value.get("branchId"))
            .and_then(Value::as_str)
            .unwrap_or("global");
        tenant_audit(
            db,
            tenant_id,
            branch,
            actor,
            "saas.ticket.message",
            json!({"ticketId":id}),
        )
        .await;
    }
    Ok(detail)
}

pub async fn update_ticket(
    db: &PgPool,
    id: &str,
    actor: &str,
    payload: TicketUpdateInput,
) -> Result<Value, AppError> {
    let status = payload.status.trim().to_ascii_lowercase();
    let priority = payload.priority.trim().to_ascii_lowercase();
    let assigned = payload
        .assigned_to
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if !matches!(
        status.as_str(),
        "open" | "in_progress" | "waiting_customer" | "resolved" | "closed"
    ) || !matches!(priority.as_str(), "normal" | "urgent")
        || assigned.is_some_and(|v| v.chars().count() > 120)
    {
        return Err(AppError::validation("support ticket update is invalid"));
    }
    if !saas_repository::update_ticket(db, id, actor, &status, assigned, &priority)
        .await
        .map_err(|_| AppError::internal("failed to update support ticket"))?
    {
        return Err(AppError::not_found("support ticket was not found"));
    }
    platform_audit(
        db,
        actor,
        "saas.ticket.updated",
        json!({"ticketId":id,"status":status,"priority":priority}),
    )
    .await;
    ticket_detail(db, id, None, true).await
}

fn next_period(start: DateTime<Utc>, interval: &str) -> Result<DateTime<Utc>, AppError> {
    start
        .checked_add_months(Months::new(if interval == "yearly" { 12 } else { 1 }))
        .ok_or_else(|| AppError::validation("billing period is invalid"))
}
fn usage_charge(context: &BillingContext, branches: i64, users: i64, appointments: i64) -> i64 {
    (branches - i64::from(context.included_branches))
        .max(0)
        .saturating_mul(context.overage_branch_paise)
        + (users - i64::from(context.included_users))
            .max(0)
            .saturating_mul(context.overage_user_paise)
        + (appointments - i64::from(context.included_appointments))
            .max(0)
            .saturating_mul(context.overage_appointment_paise)
}
fn add_sla_minutes(start: DateTime<Utc>, minutes: i32, business_hours_only: bool) -> DateTime<Utc> {
    if !business_hours_only {
        return start + Duration::minutes(i64::from(minutes));
    }
    let offset = FixedOffset::east_opt(19_800).expect("valid IST offset");
    let mut local = start.with_timezone(&offset);
    let mut remaining = i64::from(minutes);
    loop {
        let date = local.date_naive();
        if date.weekday() == Weekday::Sun || local.hour() >= 18 {
            let mut next = date.succ_opt().expect("SLA date range");
            while next.weekday() == Weekday::Sun {
                next = next.succ_opt().expect("SLA date range");
            }
            local = offset
                .from_local_datetime(&next.and_hms_opt(9, 0, 0).expect("valid business time"))
                .single()
                .expect("fixed offset time");
            continue;
        }
        if local.hour() < 9 {
            local = offset
                .from_local_datetime(&date.and_hms_opt(9, 0, 0).expect("valid business time"))
                .single()
                .expect("fixed offset time");
        }
        let end = offset
            .from_local_datetime(
                &local
                    .date_naive()
                    .and_hms_opt(18, 0, 0)
                    .expect("valid business time"),
            )
            .single()
            .expect("fixed offset time");
        let available = (end - local).num_minutes();
        if remaining <= available {
            return (local + Duration::minutes(remaining)).with_timezone(&Utc);
        }
        remaining -= available;
        local = end;
    }
}
async fn platform_audit(db: &PgPool, actor: &str, action: &str, details: Value) {
    let _ = security_service::record_audit(db, "platform", "global", actor, action, details).await;
}
async fn tenant_audit(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    action: &str,
    details: Value,
) {
    let _ = security_service::record_audit(db, tenant, branch, actor, action, details).await;
}

#[cfg(test)]
mod tests {
    use super::{add_sla_minutes, usage_charge, BillingContext};
    use chrono::{TimeZone, Utc};
    #[test]
    fn usage_billing_only_charges_overages() {
        let c = BillingContext {
            subscription_id: "s".into(),
            tenant_id: "t".into(),
            branch_id: "global".into(),
            status: "active".into(),
            trial_ends_at: None,
            billing_interval: "monthly".into(),
            base_price_paise: 10000,
            included_branches: 2,
            included_users: 5,
            included_appointments: 100,
            overage_branch_paise: 500,
            overage_user_paise: 100,
            overage_appointment_paise: 10,
            current_period_start: Utc::now(),
            current_period_end: Utc::now(),
        };
        assert_eq!(usage_charge(&c, 2, 5, 100), 0);
        assert_eq!(usage_charge(&c, 3, 7, 110), 800);
    }
    #[test]
    fn business_sla_skips_sunday() {
        let saturday = Utc.with_ymd_and_hms(2026, 7, 18, 11, 30, 0).unwrap();
        let due = add_sla_minutes(saturday, 120, true);
        assert_eq!(due, Utc.with_ymd_and_hms(2026, 7, 20, 4, 30, 0).unwrap());
    }
}
