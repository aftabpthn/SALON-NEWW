use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Datelike, Duration, FixedOffset, Months, TimeZone, Timelike, Utc, Weekday};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::collections::BTreeSet;
use uuid::Uuid;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::saas_repository::{
        self, BillingContext, PlanWrite, SlaWrite, SupportAttachmentDownload,
        SupportAttachmentWrite, SupportEmailWrite,
    },
    services::{
        auth_service::{hash_password, password_meets_policy, TENANT_PERMISSION_CATALOG},
        invoice_delivery, razorpay_payment_service, security_service, staff_service,
    },
};

const SEVERITIES: &[&str] = &["low", "medium", "high", "critical"];
const MANAGER_PERMISSION_CODES: &[&str] = &[
    "analytics.read",
    "appointments.manage",
    "appointments.outside_hours.override",
    "appointments.read",
    "appointments.settings.manage",
    "appointments.fees.waive",
    "bookings.manage",
    "bookings.read",
    "clients.audit.read",
    "clients.cross_location.read",
    "clients.consent.manage",
    "clients.forms.manage",
    "clients.manage",
    "clients.merge",
    "clients.read",
    "finance.read",
    "inventory.approve",
    "inventory.manage",
    "inventory.read",
    "management.write",
    "marketing.approve",
    "marketing.manage",
    "marketing.read",
    "marketing.send",
    "memberships.manage",
    "memberships.read",
    "notifications.manage",
    "notifications.read",
    "offers.approve",
    "packages.manage",
    "packages.read",
    "pos.manage",
    "pos.read",
    "pos.refund",
    "pos.void",
    "purchases.approve",
    "purchases.manage",
    "purchases.read",
    "reports.export",
    "reports.read",
    "security.read",
    "services.manage",
    "services.read",
    "settings.read",
    "staff.analytics.read",
    "staff.attendance.manage",
    "staff.attendance.read",
    "staff.leave.manage",
    "staff.leave.read",
    "staff.manage",
    "staff.hrms.manage",
    "staff.hrms.read",
    "staff.payroll.read",
    "staff.read",
    "staff.schedule.manage",
    "staff.schedule.read",
    "templates.manage",
    "tenant.read",
];
const STAFF_PERMISSION_CODES: &[&str] = &[
    "appointments.read",
    "clients.read",
    "notifications.read",
    "services.read",
    "staff.attendance.read",
    "staff.leave.read",
    "staff.schedule.read",
    "staff.self_manage",
    "staff_self.write",
    "tenant.read",
];

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
pub struct SalonOnboardingInput {
    pub idempotency_key: String,
    pub salon_name: String,
    pub salon_slug: String,
    pub plan_id: String,
    pub owner_full_name: String,
    pub owner_email: String,
    pub owner_password: String,
    pub branch_name: String,
    pub branch_code: String,
    #[serde(default)]
    pub branch_address: String,
    pub trial_ends_at: Option<DateTime<Utc>>,
    pub domain: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TenantAdminCreateInput {
    pub full_name: String,
    pub login_id: String,
    pub email: String,
    pub initial_password: String,
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
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub communication_channel: String,
    #[serde(default)]
    pub unit_cost_paise: i64,
    #[serde(default = "default_currency")]
    pub currency: String,
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
pub struct RazorpayCheckoutInput {
    pub plan_id: String,
    pub idempotency_key: String,
    pub total_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionActionInput {
    pub action: String,
    #[serde(default)]
    pub cancel_at_cycle_end: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionPlanChangeInput {
    pub plan_id: String,
    pub effective: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderRefundInput {
    pub amount_paise: i64,
    pub reason: String,
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
    #[serde(default)]
    pub attachments: Vec<TicketAttachmentInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketMessageInput {
    pub body: String,
    #[serde(default = "customer_visibility")]
    pub visibility: String,
    #[serde(default)]
    pub attachments: Vec<TicketAttachmentInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketUpdateInput {
    pub status: String,
    pub priority: String,
    pub assigned_to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketAttachmentInput {
    pub file_name: String,
    pub content_type: String,
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketMergeInput {
    pub action: String,
    pub target_ticket_id: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketCsatInput {
    pub rating: i16,
    #[serde(default)]
    pub comment: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportEmailInput {
    pub event_id: String,
    pub ses_message_id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub text_body: String,
    pub message_id: String,
    #[serde(default)]
    pub in_reply_to: String,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub spam_verdict: String,
    #[serde(default)]
    pub virus_verdict: String,
    #[serde(default)]
    pub attachments: Vec<TicketAttachmentInput>,
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
fn default_currency() -> String {
    "INR".into()
}

pub async fn platform_overview(db: &PgPool) -> Result<Value, AppError> {
    saas_repository::platform_overview(db)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS overview"))
}

pub async fn platform_reports(db: &PgPool, days: i32) -> Result<Value, AppError> {
    if !(7..=365).contains(&days) {
        return Err(AppError::validation(
            "SaaS report period must be 7 to 365 days",
        ));
    }
    saas_repository::platform_reports(db, days)
        .await
        .map_err(|_| AppError::internal("failed to load SaaS reports"))
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

pub async fn onboard_salon(
    db: &PgPool,
    actor: &str,
    payload: SalonOnboardingInput,
) -> Result<Value, AppError> {
    let idempotency_key = payload.idempotency_key.trim();
    let salon_name = payload.salon_name.trim();
    let salon_slug = payload.salon_slug.trim().to_ascii_lowercase();
    let plan_id = payload.plan_id.trim();
    let owner_full_name = payload.owner_full_name.trim();
    let owner_email = staff_service::normalize_login_email(&payload.owner_email)?;
    let branch_name = payload.branch_name.trim();
    let branch_code = payload.branch_code.trim().to_ascii_uppercase();
    let branch_address = payload.branch_address.trim();
    let domain = payload
        .domain
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_domain)
        .transpose()?;

    if idempotency_key.is_empty()
        || idempotency_key.len() > 160
        || !(2..=120).contains(&salon_name.chars().count())
        || !(2..=80).contains(&salon_slug.len())
        || salon_slug.starts_with('-')
        || salon_slug.ends_with('-')
        || !salon_slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || plan_id.is_empty()
        || plan_id.len() > 160
        || !(2..=120).contains(&owner_full_name.chars().count())
        || !(2..=120).contains(&branch_name.chars().count())
        || !(2..=40).contains(&branch_code.len())
        || !branch_code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || branch_address.chars().count() > 500
    {
        return Err(AppError::validation(
            "salon, owner or first branch details are invalid",
        ));
    }
    if !password_meets_policy(&payload.owner_password) {
        return Err(AppError::validation(
            "owner password must contain 12 to 128 characters",
        ));
    }

    let request_fingerprint = json!({
        "salonName": salon_name,
        "salonSlug": salon_slug,
        "planId": plan_id,
        "ownerFullName": owner_full_name,
        "ownerEmail": owner_email,
        "branchName": branch_name,
        "branchCode": branch_code,
        "branchAddress": branch_address,
        "trialEndsAt": payload.trial_ends_at,
        "domain": domain,
    });
    let request_fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&request_fingerprint)
                .map_err(|_| AppError::internal("failed to prepare onboarding request"))?
        )
    );
    let started_at = Utc::now();
    let trial_ends_at = payload
        .trial_ends_at
        .unwrap_or_else(|| started_at + Duration::days(14));
    let owner_password_hash = hash_password(&payload.owner_password)
        .map_err(|_| AppError::internal("failed to secure owner password"))?;
    let owner_permissions = json!(TENANT_PERMISSION_CATALOG
        .iter()
        .map(|permission| permission.code)
        .collect::<Vec<_>>());

    let input = saas_repository::OnboardingWrite {
        idempotency_key: idempotency_key.to_string(),
        request_fingerprint,
        salon_name: salon_name.to_string(),
        salon_slug,
        plan_id: plan_id.to_string(),
        owner_full_name: owner_full_name.to_string(),
        owner_email,
        owner_password_hash,
        owner_permissions,
        manager_permissions: json!(MANAGER_PERMISSION_CODES),
        staff_permissions: json!(STAFF_PERMISSION_CODES),
        branch_name: branch_name.to_string(),
        branch_code,
        branch_address: branch_address.to_string(),
        domain,
        started_at,
        trial_ends_at,
        actor: actor.to_string(),
    };
    let result = saas_repository::onboard_salon(db, &input)
        .await
        .map_err(map_onboarding_error)?;
    Ok(json!(result))
}

pub async fn tenant_admins(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<saas_repository::TenantAdminRecord>, AppError> {
    saas_repository::list_tenant_admins(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load Tenant Admin accounts"))
}

pub async fn create_tenant_admin(
    db: &PgPool,
    tenant_id: &str,
    default_branch_id: &str,
    actor: &str,
    payload: TenantAdminCreateInput,
) -> Result<saas_repository::TenantAdminRecord, AppError> {
    if tenant_id.eq_ignore_ascii_case("platform") {
        return Err(AppError::forbidden("Tenant Admin requires a salon tenant"));
    }
    let full_name = payload.full_name.trim();
    if !(2..=120).contains(&full_name.chars().count()) {
        return Err(AppError::validation(
            "fullName must contain 2 to 120 characters",
        ));
    }
    let login_id = staff_service::normalize_login_id(&payload.login_id)?;
    let email = staff_service::normalize_login_email(&payload.email)?;
    if !password_meets_policy(&payload.initial_password) {
        return Err(AppError::validation(
            "initialPassword must contain 12 to 128 characters",
        ));
    }
    let password_hash = hash_password(&payload.initial_password)
        .map_err(|_| AppError::internal("failed to secure Tenant Admin password"))?;
    saas_repository::create_tenant_admin(
        db,
        &saas_repository::TenantAdminWrite {
            tenant_id,
            default_branch_id,
            full_name,
            login_id: &login_id,
            email: &email,
            password_hash: &password_hash,
            actor,
        },
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database_error| database_error.is_unique_violation())
        {
            AppError::conflict("login ID or email is already in use")
        } else if matches!(error, sqlx::Error::RowNotFound) {
            AppError::conflict("Admin role or default branch is unavailable")
        } else {
            AppError::internal("failed to create Tenant Admin")
        }
    })
}

fn normalize_domain(value: &str) -> Result<String, AppError> {
    let domain = value.trim().trim_end_matches('.').to_ascii_lowercase();
    let labels = domain.split('.').collect::<Vec<_>>();
    let valid = (3..=253).contains(&domain.len())
        && labels.len() >= 2
        && labels.iter().all(|label| {
            (1..=63).contains(&label.len())
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        });
    if !valid {
        return Err(AppError::validation(
            "domain must be a valid hostname without scheme or path",
        ));
    }
    Ok(domain)
}

fn map_onboarding_error(error: saas_repository::OnboardingError) -> AppError {
    match error {
        saas_repository::OnboardingError::IdempotencyConflict => AppError::conflict(
            "idempotency key was already used for a different onboarding request",
        ),
        saas_repository::OnboardingError::PlanUnavailable => {
            AppError::not_found("active SaaS plan was not found")
        }
        saas_repository::OnboardingError::TrialOutsideFirstPeriod => AppError::validation(
            "trial end must be after onboarding and inside the first billing period",
        ),
        saas_repository::OnboardingError::Database(error) => {
            let constraint = error
                .as_database_error()
                .and_then(|database_error| database_error.constraint());
            let detail = error.to_string();
            let matches_index = |name: &str| constraint == Some(name) || detail.contains(name);
            if matches_index("idx_tenants_slug") {
                AppError::conflict("salon slug is already in use")
            } else if matches_index("idx_tenant_domain_mappings_domain") {
                AppError::conflict("domain is already mapped to another salon")
            } else if matches_index("idx_users_tenant_email")
                || matches_index("idx_users_tenant_login_id")
            {
                AppError::conflict("owner login email is already in use")
            } else {
                tracing::error!(error = %error, "failed to onboard salon");
                AppError::internal("failed to onboard salon")
            }
        }
    }
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
        || !matches!(status.as_str(), "pending" | "trialing" | "active")
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
        "pending" | "trialing" | "active" | "past_due" | "paused" | "cancelled"
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

pub async fn create_razorpay_checkout(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    actor: &str,
    payload: RazorpayCheckoutInput,
) -> Result<Value, AppError> {
    let key = payload.idempotency_key.trim();
    if !provider_idempotency_key(key) {
        return Err(AppError::validation("checkout idempotency key is invalid"));
    }
    if let Some(existing) = saas_repository::checkout_request(db, tenant_id, key)
        .await
        .map_err(|_| AppError::internal("failed to inspect checkout request"))?
    {
        return match existing.get("status").and_then(Value::as_str) {
            Some("ready") => Ok(existing),
            Some("creating") => Err(AppError::conflict(
                "checkout creation is already in progress",
            )),
            _ => Err(AppError::conflict(
                "previous checkout failed; start a new checkout",
            )),
        };
    }
    let plan = saas_repository::provider_plan_context(db, payload.plan_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load SaaS plan"))?
        .ok_or_else(|| AppError::not_found("active SaaS plan was not found"))?;
    if plan.base_price_paise <= 0 {
        return Err(AppError::validation(
            "Razorpay checkout requires a paid plan",
        ));
    }
    let total_count = payload
        .total_count
        .unwrap_or(if plan.billing_interval == "monthly" {
            12
        } else {
            1
        });
    if !(1..=120).contains(&total_count) {
        return Err(AppError::validation(
            "subscription billing cycle count is invalid",
        ));
    }
    if !saas_repository::reserve_checkout(db, tenant_id, &plan.id, key, actor)
        .await
        .map_err(|_| AppError::internal("failed to reserve checkout"))?
    {
        return Err(AppError::conflict(
            "tenant already has a current subscription or checkout",
        ));
    }
    let provider_plan_ref = match saas_repository::provider_plan_ref(db, &plan.id, plan.version)
        .await
        .map_err(|_| AppError::internal("failed to load Razorpay plan mapping"))?
    {
        Some(reference) => reference,
        None => {
            let remote = match razorpay_payment_service::create_subscription_plan(
                settings,
                &plan.name,
                &plan.billing_interval,
                plan.base_price_paise,
                &plan.id,
            )
            .await
            {
                Ok(remote) => remote,
                Err(error) => {
                    let _ = saas_repository::fail_checkout(
                        db,
                        tenant_id,
                        key,
                        "provider plan creation failed",
                    )
                    .await;
                    return Err(error);
                }
            };
            saas_repository::save_provider_plan_ref(db, &plan, &remote.provider_plan_id)
                .await
                .map_err(|_| AppError::internal("failed to save Razorpay plan mapping"))?
        }
    };
    let checkout = match razorpay_payment_service::create_subscription_checkout(
        settings,
        &provider_plan_ref,
        total_count,
        tenant_id,
    )
    .await
    {
        Ok(checkout) if !checkout.short_url.is_empty() => checkout,
        Ok(_) => {
            let _ =
                saas_repository::fail_checkout(db, tenant_id, key, "provider checkout URL missing")
                    .await;
            return Err(AppError::service_unavailable(
                "PAYMENT_PROVIDER_UNAVAILABLE",
                "Razorpay checkout response is incomplete",
            ));
        }
        Err(error) => {
            let _ = saas_repository::fail_checkout(
                db,
                tenant_id,
                key,
                "provider checkout creation failed",
            )
            .await;
            return Err(error);
        }
    };
    let start = DateTime::from_timestamp(checkout.current_start, 0).unwrap_or_else(Utc::now);
    let end = DateTime::from_timestamp(checkout.current_end, 0)
        .filter(|end| *end > start)
        .unwrap_or(next_period(start, &plan.billing_interval)?);
    let result = match saas_repository::complete_checkout(
        db,
        tenant_id,
        &plan.id,
        key,
        &checkout.provider_subscription_id,
        &checkout.status,
        &checkout.short_url,
        start,
        end,
        actor,
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            let _ =
                saas_repository::fail_checkout(db, tenant_id, key, "checkout persistence failed")
                    .await;
            return Err(AppError::internal("failed to save Razorpay checkout"));
        }
    };
    tenant_audit(
        db,
        tenant_id,
        "global",
        actor,
        "saas.checkout.created",
        json!({"planId":plan.id,"subscriptionId":checkout.provider_subscription_id}),
    )
    .await;
    Ok(result)
}

pub async fn subscription_action(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    subscription_id: &str,
    actor: &str,
    payload: SubscriptionActionInput,
) -> Result<Value, AppError> {
    let action = payload.action.trim().to_ascii_lowercase();
    if !matches!(action.as_str(), "pause" | "resume" | "cancel") {
        return Err(AppError::validation("subscription action is invalid"));
    }
    let subscription =
        saas_repository::provider_subscription_context(db, tenant_id, subscription_id)
            .await
            .map_err(|_| AppError::internal("failed to load subscription"))?
            .ok_or_else(|| AppError::not_found("Razorpay subscription was not found"))?;
    if action == "pause" && !matches!(subscription.status.as_str(), "active" | "past_due")
        || action == "resume" && subscription.status != "paused"
        || action == "cancel" && subscription.status == "cancelled"
    {
        return Err(AppError::conflict(
            "subscription action is not valid in its current state",
        ));
    }
    let remote = match action.as_str() {
        "pause" => {
            razorpay_payment_service::pause_subscription(
                settings,
                &subscription.provider_subscription_ref,
            )
            .await?
        }
        "resume" => {
            razorpay_payment_service::resume_subscription(
                settings,
                &subscription.provider_subscription_ref,
            )
            .await?
        }
        _ => {
            razorpay_payment_service::cancel_subscription(
                settings,
                &subscription.provider_subscription_ref,
                payload.cancel_at_cycle_end,
            )
            .await?
        }
    };
    saas_repository::record_provider_action(
        db,
        &subscription.id,
        &action,
        &remote.status,
        payload.cancel_at_cycle_end,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save subscription action"))?;
    tenant_audit(db, tenant_id, &subscription.branch_id, actor, "saas.subscription.action", json!({"subscriptionId":subscription.id,"action":action,"cancelAtCycleEnd":payload.cancel_at_cycle_end})).await;
    Ok(
        json!({"subscriptionId":subscription.id,"action":action,"providerStatus":remote.status,"cancelAtCycleEnd":payload.cancel_at_cycle_end}),
    )
}

pub async fn change_subscription_plan(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    subscription_id: &str,
    actor: &str,
    payload: SubscriptionPlanChangeInput,
) -> Result<Value, AppError> {
    let effective = payload.effective.trim().to_ascii_lowercase();
    if !matches!(effective.as_str(), "now" | "cycle_end") {
        return Err(AppError::validation(
            "plan change effective value is invalid",
        ));
    }
    let subscription =
        saas_repository::provider_subscription_context(db, tenant_id, subscription_id)
            .await
            .map_err(|_| AppError::internal("failed to load subscription"))?
            .ok_or_else(|| AppError::not_found("Razorpay subscription was not found"))?;
    let plan = saas_repository::provider_plan_context(db, payload.plan_id.trim())
        .await
        .map_err(|_| AppError::internal("failed to load SaaS plan"))?
        .ok_or_else(|| AppError::not_found("active SaaS plan was not found"))?;
    if subscription.plan_id == plan.id {
        return Err(AppError::conflict("subscription already uses this plan"));
    }
    let provider_plan_ref = match saas_repository::provider_plan_ref(db, &plan.id, plan.version)
        .await
        .map_err(|_| AppError::internal("failed to load Razorpay plan mapping"))?
    {
        Some(reference) => reference,
        None => {
            let remote = razorpay_payment_service::create_subscription_plan(
                settings,
                &plan.name,
                &plan.billing_interval,
                plan.base_price_paise,
                &plan.id,
            )
            .await?;
            saas_repository::save_provider_plan_ref(db, &plan, &remote.provider_plan_id)
                .await
                .map_err(|_| AppError::internal("failed to save Razorpay plan mapping"))?
        }
    };
    let remote = razorpay_payment_service::update_subscription_plan(
        settings,
        &subscription.provider_subscription_ref,
        &provider_plan_ref,
        &effective,
    )
    .await?;
    saas_repository::record_plan_change(
        db,
        &subscription.id,
        &plan.id,
        &effective,
        &remote.status,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save subscription plan change"))?;
    tenant_audit(
        db,
        tenant_id,
        &subscription.branch_id,
        actor,
        "saas.subscription.plan_changed",
        json!({"subscriptionId":subscription.id,"planId":plan.id,"effective":effective}),
    )
    .await;
    Ok(
        json!({"subscriptionId":subscription.id,"planId":plan.id,"effective":effective,"providerStatus":remote.status}),
    )
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
    let provider = payload.provider.trim().to_ascii_lowercase();
    let channel = payload.communication_channel.trim().to_ascii_lowercase();
    let currency = payload.currency.trim().to_ascii_uppercase();
    if !matches!(
        metric.as_str(),
        "api_calls"
            | "messages"
            | "storage_mb"
            | "provider_units"
            | "sms"
            | "whatsapp"
            | "email"
            | "ai_tokens"
            | "custom"
    ) || !(1..=1_000_000_000).contains(&payload.quantity)
        || key.is_empty()
        || key.len() > 160
        || payload.metadata.as_object().is_none()
        || provider.len() > 80
        || !matches!(
            channel.as_str(),
            "" | "sms" | "whatsapp" | "email" | "push" | "voice"
        )
        || !(0..=1_000_000_000).contains(&payload.unit_cost_paise)
        || currency.len() != 3
        || !currency.bytes().all(|byte| byte.is_ascii_uppercase())
    {
        return Err(AppError::validation("usage event is invalid"));
    }
    let outcome = saas_repository::record_usage(
        db,
        payload.tenant_id.trim(),
        payload.branch_id.trim(),
        payload.subscription_id.trim(),
        &metric,
        payload.quantity,
        key,
        payload.occurred_at.unwrap_or_else(Utc::now),
        &payload.metadata,
        &provider,
        &channel,
        payload.unit_cost_paise,
        &currency,
    )
    .await
    .map_err(|_| AppError::internal("failed to record SaaS usage"))?;
    use saas_repository::UsageRecordOutcome;
    if outcome == UsageRecordOutcome::QuotaExceeded {
        return Err(AppError::conflict("usage quota exceeded").with_details(json!({
            "tenantId":payload.tenant_id,"subscriptionId":payload.subscription_id,"metric":metric,"quantity":payload.quantity
        })));
    }
    if outcome == UsageRecordOutcome::SubscriptionUnavailable {
        return Err(AppError::conflict(
            "subscription does not accept usage events",
        ));
    }
    let replayed = outcome == UsageRecordOutcome::Replayed;
    platform_audit(
        db,
        actor,
        "saas.usage.recorded",
        json!({"tenantId":payload.tenant_id,"metric":metric,"provider":provider,"communicationChannel":channel,
          "unitCostPaise":payload.unit_cost_paise,"currency":currency,"replayed":replayed}),
    )
    .await;
    Ok(json!({"recorded":!replayed,"replayed":replayed}))
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
    )
    .saturating_add(usage.provider_cost_paise)
    .saturating_add(usage.quota_overage_paise);
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

pub async fn reconcile_razorpay_webhook(
    db: &PgPool,
    provider_event_id: &str,
    payload_sha256: &str,
    event_type: &str,
    payload: &Value,
) -> Result<Value, AppError> {
    let provider_created_at =
        json_i64(payload, &["created_at"]).and_then(|value| DateTime::from_timestamp(value, 0));
    if event_type.starts_with("refund.") {
        let refund_ref = json_text(payload, &["payload", "refund", "entity", "id"]);
        let raw_status = json_text(payload, &["payload", "refund", "entity", "status"]);
        let status = if event_type == "refund.processed" || raw_status == "processed" {
            "processed"
        } else if event_type == "refund.failed" || raw_status == "failed" {
            "failed"
        } else {
            "pending"
        };
        return saas_repository::reconcile_provider_refund(
            db,
            provider_event_id,
            event_type,
            payload_sha256,
            &refund_ref,
            status,
            provider_created_at,
        )
        .await
        .map_err(|_| AppError::internal("failed to reconcile Razorpay refund"));
    }
    let subscription_ref = {
        let direct = json_text(payload, &["payload", "subscription", "entity", "id"]);
        if direct.is_empty() {
            json_text(
                payload,
                &["payload", "payment", "entity", "subscription_id"],
            )
        } else {
            direct
        }
    };
    let provider_status = json_text(payload, &["payload", "subscription", "entity", "status"]);
    let provider_plan_ref = json_text(payload, &["payload", "subscription", "entity", "plan_id"]);
    let local_status = match event_type {
        "subscription.activated"
        | "subscription.charged"
        | "subscription.resumed"
        | "payment.captured" => Some("active"),
        "subscription.pending" | "subscription.halted" | "payment.failed" => Some("past_due"),
        "subscription.paused" => Some("paused"),
        "subscription.cancelled" | "subscription.completed" | "subscription.expired" => {
            Some("cancelled")
        }
        "subscription.updated" => match provider_status.as_str() {
            "active" => Some("active"),
            "pending" | "halted" => Some("past_due"),
            "paused" => Some("paused"),
            "cancelled" | "completed" | "expired" => Some("cancelled"),
            _ => None,
        },
        _ => None,
    };
    let period_start = json_i64(
        payload,
        &["payload", "subscription", "entity", "current_start"],
    )
    .and_then(|value| DateTime::from_timestamp(value, 0));
    let period_end = json_i64(
        payload,
        &["payload", "subscription", "entity", "current_end"],
    )
    .and_then(|value| DateTime::from_timestamp(value, 0));
    let payment_ref = json_text(payload, &["payload", "payment", "entity", "id"]);
    let payment_status = json_text(payload, &["payload", "payment", "entity", "status"]);
    let payment_currency = json_text(payload, &["payload", "payment", "entity", "currency"]);
    let payment_method = json_text(payload, &["payload", "payment", "entity", "method"]);
    let result = saas_repository::reconcile_provider_event(
        db,
        &saas_repository::ProviderEventWrite {
            provider_event_id,
            event_type,
            payload_sha256,
            provider_created_at,
            provider_subscription_ref: &subscription_ref,
            provider_status: &provider_status,
            local_status,
            provider_plan_ref: &provider_plan_ref,
            period_start,
            period_end,
            payment_ref: &payment_ref,
            payment_amount_paise: json_i64(payload, &["payload", "payment", "entity", "amount"])
                .unwrap_or(0),
            payment_currency: &payment_currency,
            payment_method: &payment_method,
            payment_status: &payment_status,
            dunning: matches!(
                event_type,
                "subscription.pending" | "subscription.halted" | "payment.failed"
            ),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to reconcile Razorpay subscription"))?;
    Ok(result)
}

pub async fn refund_provider_payment(
    db: &PgPool,
    settings: &Settings,
    provider_payment_id: &str,
    actor: &str,
    payload: ProviderRefundInput,
) -> Result<Value, AppError> {
    let reason = payload.reason.trim();
    let key = payload.idempotency_key.trim();
    if !(1..=1_000_000_000).contains(&payload.amount_paise)
        || !(3..=500).contains(&reason.chars().count())
        || !provider_idempotency_key(key)
    {
        return Err(AppError::validation("SaaS refund request is invalid"));
    }
    let reservation = saas_repository::reserve_refund(
        db,
        provider_payment_id,
        payload.amount_paise,
        reason,
        key,
        actor,
    )
    .await
    .map_err(|error| {
        if error
            .to_string()
            .contains("exceeds provider payment balance")
        {
            AppError::conflict("refund exceeds provider payment balance")
        } else if matches!(error, sqlx::Error::RowNotFound) {
            AppError::not_found("captured Razorpay payment was not found")
        } else {
            AppError::internal("failed to reserve SaaS refund")
        }
    })?;
    if reservation.replayed {
        return Ok(
            json!({"refundId":reservation.refund_id,"providerRefundId":reservation.provider_refund_ref,"status":reservation.status,"replayed":true}),
        );
    }
    let remote = match razorpay_payment_service::create_payment_refund(
        settings,
        &reservation.provider_payment_ref,
        payload.amount_paise,
        key,
        &format!(
            "saas-{}",
            &reservation.refund_id[..reservation.refund_id.len().min(20)]
        ),
    )
    .await
    {
        Ok(remote) => remote,
        Err(error) => {
            let _ = saas_repository::fail_refund(
                db,
                &reservation.refund_id,
                "provider refund request failed",
            )
            .await;
            return Err(error);
        }
    };
    let credit_note_number = format!(
        "SCN-{}-{}",
        Utc::now().format("%Y%m"),
        &Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase()
    );
    let result = saas_repository::complete_refund(
        db,
        &reservation.refund_id,
        &remote.provider_refund_id,
        &remote.status,
        &credit_note_number,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save SaaS refund and credit note"))?;
    platform_audit(db, actor, "saas.refund.created", json!({"refundId":reservation.refund_id,"tenantId":reservation.tenant_id,"amountPaise":payload.amount_paise})).await;
    Ok(result)
}

fn provider_idempotency_key(value: &str) -> bool {
    (10..=160).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn json_text(payload: &Value, path: &[&str]) -> String {
    path.iter()
        .try_fold(payload, |value, key| value.get(*key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn json_i64(payload: &Value, path: &[&str]) -> Option<i64> {
    path.iter()
        .try_fold(payload, |value, key| value.get(*key))
        .and_then(Value::as_i64)
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
    let attachments = decode_ticket_attachments(payload.attachments)?;
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
        &attachments,
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
    let attachments = decode_ticket_attachments(payload.attachments)?;
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
        &attachments,
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

pub async fn submit_csat(
    db: &PgPool,
    id: &str,
    tenant: &str,
    actor: &str,
    payload: TicketCsatInput,
) -> Result<Value, AppError> {
    let comment = payload.comment.trim();
    if !(1..=5).contains(&payload.rating) || comment.chars().count() > 1000 {
        return Err(AppError::validation("ticket CSAT is invalid"));
    }
    if !saas_repository::submit_ticket_csat(db, id, tenant, actor, payload.rating, comment)
        .await
        .map_err(|_| AppError::internal("failed to save ticket CSAT"))?
    {
        return Err(AppError::conflict(
            "only resolved or closed tickets can receive CSAT",
        ));
    }
    tenant_audit(
        db,
        tenant,
        "global",
        actor,
        "saas.ticket.csat",
        json!({"ticketId":id,"rating":payload.rating}),
    )
    .await;
    ticket_detail(db, id, Some(tenant), false).await
}

pub async fn merge_ticket(
    db: &PgPool,
    id: &str,
    actor: &str,
    payload: TicketMergeInput,
) -> Result<Value, AppError> {
    let action = payload.action.trim().to_ascii_lowercase();
    let target = payload.target_ticket_id.trim();
    let reason = payload.reason.trim();
    if !matches!(action.as_str(), "merge" | "duplicate")
        || target.is_empty()
        || !(3..=500).contains(&reason.chars().count())
    {
        return Err(AppError::validation("ticket merge details are invalid"));
    }
    if !saas_repository::merge_ticket(db, id, target, actor, action == "duplicate", reason)
        .await
        .map_err(|_| AppError::internal("failed to consolidate support tickets"))?
    {
        return Err(AppError::conflict(
            "tickets must be different, open and in the same tenant",
        ));
    }
    platform_audit(
        db,
        actor,
        "saas.ticket.merged",
        json!({"sourceTicketId":id,"targetTicketId":target,"action":action}),
    )
    .await;
    ticket_detail(db, target, None, true).await
}

pub async fn ticket_attachment(
    db: &PgPool,
    ticket_id: &str,
    attachment_id: &str,
    tenant: Option<&str>,
    internal: bool,
) -> Result<SupportAttachmentDownload, AppError> {
    saas_repository::ticket_attachment(db, ticket_id, attachment_id, tenant, internal)
        .await
        .map_err(|_| AppError::internal("failed to load support attachment"))?
        .ok_or_else(|| AppError::not_found("support attachment was not found"))
}

pub async fn escalate_due_tickets(db: &PgPool) -> Result<u64, AppError> {
    saas_repository::escalate_due_tickets(db)
        .await
        .map_err(|_| AppError::internal("failed to escalate support SLA"))
}

pub async fn process_support_email_outbox(
    db: &PgPool,
    settings: &Settings,
) -> Result<u64, AppError> {
    let mut processed = 0u64;
    for _ in 0..20 {
        let Some(row) = saas_repository::reserve_support_email_delivery(db)
            .await
            .map_err(|_| AppError::internal("failed to reserve support email delivery"))?
        else {
            break;
        };
        let payload = json!({
            "channel":"email","recipient":row.recipient,"subject":row.subject,"message":row.body,
            "messageId":row.outbound_message_id,"inReplyTo":row.in_reply_to,"references":row.references_header,
        });
        match invoice_delivery::deliver(settings, &payload).await {
            Ok(provider_id) => {
                saas_repository::complete_support_email_delivery(db, &row.id, &provider_id)
                    .await
                    .map_err(|_| AppError::internal("failed to complete support email delivery"))?;
                processed += 1;
            }
            Err(error) => {
                saas_repository::fail_support_email_delivery(db, &row.id, error.message())
                    .await
                    .map_err(|_| AppError::internal("failed to defer support email delivery"))?;
            }
        }
    }
    Ok(processed)
}

pub async fn ingest_support_email(
    db: &PgPool,
    payload_sha256: &str,
    payload: SupportEmailInput,
) -> Result<Value, AppError> {
    if payload.spam_verdict.trim() != "PASS" || payload.virus_verdict.trim() != "PASS" {
        return Err(AppError::forbidden("SES spam and virus verdicts must pass"));
    }
    let tenant = payload.tenant_id.trim();
    let branch = payload.branch_id.trim();
    let sender = extract_email(&payload.from)
        .ok_or_else(|| AppError::validation("sender email is invalid"))?;
    if tenant.is_empty()
        || branch.is_empty()
        || extract_email(&payload.to).is_none()
        || payload.event_id.trim().is_empty()
        || payload.ses_message_id.trim().is_empty()
        || payload.message_id.trim().is_empty()
    {
        return Err(AppError::validation(
            "SES support email identity is invalid",
        ));
    }
    if !saas_repository::tenant_branch_exists(db, tenant, branch)
        .await
        .map_err(|_| AppError::internal("failed to validate support email scope"))?
    {
        return Err(AppError::forbidden(
            "SES support email tenant and branch do not match",
        ));
    }
    let subject = payload.subject.trim().chars().take(160).collect::<String>();
    let body = payload
        .text_body
        .trim()
        .chars()
        .take(10_000)
        .collect::<String>();
    if subject.is_empty() || body.is_empty() {
        return Err(AppError::validation("SES support email content is empty"));
    }
    let category = match payload.category.trim().to_ascii_lowercase().as_str() {
        "billing" => "billing",
        "account" => "account",
        "data" => "data",
        "security" => "security",
        "other" => "other",
        _ => "technical",
    };
    let severity = match payload.severity.trim().to_ascii_lowercase().as_str() {
        "low" => "low",
        "high" => "high",
        "critical" => "critical",
        _ => "medium",
    };
    let attachments = decode_ticket_attachments(payload.attachments)?;
    let sla = saas_repository::ticket_sla_context(db, tenant, severity)
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
    let number = format!(
        "SUP-{}-{}",
        now.format("%Y%m%d"),
        &Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase()
    );
    let queue = if category == "other" {
        "general"
    } else {
        category
    };
    let (ticket_id, replayed) = saas_repository::ingest_support_email(
        db,
        &SupportEmailWrite {
            provider_event_id: payload.event_id.trim(),
            ses_message_id: payload.ses_message_id.trim(),
            payload_sha256,
            tenant_id: tenant,
            branch_id: branch,
            sender_email: &sender,
            subject: &subject,
            body: &body,
            email_message_id: payload.message_id.trim(),
            in_reply_to: payload.in_reply_to.trim(),
            references: &payload.references,
            category,
            severity,
            priority: if severity == "critical" {
                "urgent"
            } else {
                "normal"
            },
            queue_key: queue,
            ticket_number: &number,
            subscription_id: &subscription_id,
            plan_id: &plan_id,
            first_response_due_at: add_sla_minutes(now, response_minutes, business_hours),
            resolution_due_at: add_sla_minutes(now, resolution_minutes, business_hours),
            attachments: &attachments,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to ingest SES support email"))?;
    if ticket_id.is_empty() {
        return Err(AppError::conflict(
            "SES support email is already being processed",
        ));
    }
    let detail = ticket_detail(db, &ticket_id, None, true).await?;
    Ok(
        json!({"received":true,"replayed":replayed,"ticket":detail.get("ticket"),"ticketId":ticket_id}),
    )
}

fn decode_ticket_attachments(
    attachments: Vec<TicketAttachmentInput>,
) -> Result<Vec<SupportAttachmentWrite>, AppError> {
    if attachments.len() > 10 {
        return Err(AppError::validation(
            "support message supports up to 10 attachments",
        ));
    }
    let mut total = 0usize;
    attachments
        .into_iter()
        .map(|item| {
            let file_name = item.file_name.trim();
            let content_type = item.content_type.trim().to_ascii_lowercase();
            if file_name.is_empty()
                || file_name.chars().count() > 180
                || file_name.contains(['/', '\\'])
                || !matches!(
                    content_type.as_str(),
                    "application/pdf"
                        | "image/jpeg"
                        | "image/png"
                        | "image/webp"
                        | "text/plain"
                        | "text/csv"
                        | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )
            {
                return Err(AppError::validation(
                    "support attachment type or name is invalid",
                ));
            }
            let encoded = item
                .data_base64
                .rsplit_once(',')
                .map(|(_, value)| value)
                .unwrap_or(item.data_base64.as_str());
            let bytes = BASE64
                .decode(encoded)
                .map_err(|_| AppError::validation("support attachment data is invalid"))?;
            if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
                return Err(AppError::validation(
                    "support attachment must be 1 byte to 5 MB",
                ));
            }
            total += bytes.len();
            if total > 10 * 1024 * 1024 {
                return Err(AppError::validation(
                    "support message attachments exceed 10 MB",
                ));
            }
            let sha256 = format!("{:x}", Sha256::digest(&bytes));
            Ok(SupportAttachmentWrite {
                file_name: file_name.to_string(),
                content_type,
                bytes,
                sha256,
            })
        })
        .collect()
}

fn extract_email(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let candidate = trimmed
        .rsplit_once('<')
        .and_then(|(_, rest)| rest.strip_suffix('>'))
        .unwrap_or(trimmed)
        .trim()
        .to_ascii_lowercase();
    (candidate.len() <= 320
        && candidate
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.')))
    .then_some(candidate)
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
    use super::{
        add_sla_minutes, decode_ticket_attachments, extract_email, usage_charge, BillingContext,
        TicketAttachmentInput, MANAGER_PERMISSION_CODES, STAFF_PERMISSION_CODES,
        TENANT_PERMISSION_CATALOG,
    };
    use chrono::{TimeZone, Utc};
    #[test]
    fn onboarding_role_templates_are_registered_and_least_privilege() {
        for code in MANAGER_PERMISSION_CODES
            .iter()
            .chain(STAFF_PERMISSION_CODES)
        {
            assert!(TENANT_PERMISSION_CATALOG
                .iter()
                .any(|permission| permission.code == *code));
        }
        assert!(MANAGER_PERMISSION_CODES.contains(&"staff.manage"));
        assert!(!MANAGER_PERMISSION_CODES.contains(&"security.manage"));
        assert!(STAFF_PERMISSION_CODES.contains(&"staff.self_manage"));
        assert!(!STAFF_PERMISSION_CODES.contains(&"staff.read"));
        assert!(!STAFF_PERMISSION_CODES.contains(&"management.write"));
    }
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
    #[test]
    fn support_email_identity_and_attachment_boundary_are_enforced() {
        assert_eq!(
            extract_email("Aura User <USER@example.com>").as_deref(),
            Some("user@example.com")
        );
        assert!(extract_email("not-an-email").is_none());
        let attachments = decode_ticket_attachments(vec![TicketAttachmentInput {
            file_name: "evidence.txt".into(),
            content_type: "text/plain".into(),
            data_base64: "aGVsbG8=".into(),
        }])
        .unwrap();
        assert_eq!(attachments[0].bytes, b"hello");
        assert!(decode_ticket_attachments(vec![TicketAttachmentInput {
            file_name: "unsafe.exe".into(),
            content_type: "application/octet-stream".into(),
            data_base64: "aGVsbG8=".into(),
        }])
        .is_err());
    }
}
