use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Row, Transaction};

use crate::{
    models::common::AppError,
    repositories::membership_lifecycle_repository::{self, ActiveMembershipRecord},
    repositories::membership_repository::{
        self, CreateMembership, MembershipRecord, UpdateMembership,
    },
    repositories::{clients_repository, membership_advanced_repository},
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipCheckoutIntent {
    pub client_id: String,
    pub plan_id: String,
    pub plan_name: String,
    pub price_paise: i64,
    pub source: &'static str,
    pub reference_id: String,
}

pub struct MembershipClient360 {
    pub client: clients_repository::ClientRecord,
    pub memberships: Vec<ActiveMembershipRecord>,
    pub wallet: Vec<membership_lifecycle_repository::MembershipWalletCreditRecord>,
    pub ledger: Vec<membership_lifecycle_repository::LifecycleLedgerRecord>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RewardAdjustmentResult {
    pub id: String,
    pub client_id: String,
    pub transaction_type: String,
    pub points: i32,
    pub balance_after: i32,
    pub staff_id: String,
    pub note: String,
    pub created_at: DateTime<Utc>,
}

pub async fn active_memberships(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ActiveMembershipRecord>, AppError> {
    membership_lifecycle_repository::list(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list active memberships"))
}

pub async fn confirm_renewal(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_sale_id: &str,
) -> Result<Option<ActiveMembershipRecord>, AppError> {
    membership_lifecycle_repository::by_source_sale(db, tenant_id, branch_id, source_sale_id)
        .await
        .map_err(|_| AppError::internal("failed to confirm membership renewal"))
}

pub async fn cancel_membership(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    reason: &str,
) -> Result<bool, AppError> {
    membership_lifecycle_repository::cancel(db, tenant_id, branch_id, id, reason)
        .await
        .map_err(|_| AppError::internal("failed to cancel membership"))
}

pub async fn freeze_membership(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    days: i32,
    reason: &str,
) -> Result<bool, AppError> {
    membership_lifecycle_repository::freeze(db, tenant_id, branch_id, id, days, reason)
        .await
        .map_err(|_| AppError::internal("failed to freeze membership"))
}

pub async fn resume_membership(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, AppError> {
    membership_lifecycle_repository::resume(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to resume membership"))
}

pub async fn lifecycle_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<membership_lifecycle_repository::LifecycleLedgerRecord>, AppError> {
    membership_lifecycle_repository::ledger(db, tenant_id, branch_id, limit)
        .await
        .map_err(|_| AppError::internal("failed to list membership lifecycle ledger"))
}

pub async fn expiring_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i64,
) -> Result<Vec<membership_lifecycle_repository::RenewalQueueRecord>, AppError> {
    membership_lifecycle_repository::reminders(db, tenant_id, branch_id, days)
        .await
        .map_err(|_| AppError::internal("failed to list membership reminders"))
}

pub async fn auto_renew_queue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i64,
) -> Result<Vec<membership_lifecycle_repository::RenewalQueueRecord>, AppError> {
    membership_lifecycle_repository::renewal_queue(db, tenant_id, branch_id, days)
        .await
        .map_err(|_| AppError::internal("failed to list auto-renew queue"))
}

pub async fn set_auto_renew(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    enabled: bool,
) -> Result<bool, AppError> {
    membership_lifecycle_repository::set_auto_renew(db, tenant_id, branch_id, id, enabled)
        .await
        .map_err(|_| AppError::internal("failed to update auto-renew preference"))
}

pub async fn lifecycle_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<membership_lifecycle_repository::MembershipReportRecord, AppError> {
    membership_lifecycle_repository::report(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership report"))
}

pub async fn client_eligibility(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<membership_lifecycle_repository::ClientMembershipEligibilityRecord>, AppError> {
    membership_lifecycle_repository::client_eligibility(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership eligibility"))
}

pub async fn client_wallet(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<membership_lifecycle_repository::MembershipWalletCreditRecord>, AppError> {
    membership_lifecycle_repository::client_wallet(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership wallet"))
}

pub async fn sale_checkout_intent(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    plan_id: &str,
) -> Result<MembershipCheckoutIntent, AppError> {
    let client = clients_repository::get(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .filter(|client| client.active)
        .ok_or_else(|| AppError::not_found("active client was not found"))?;
    let plan = membership_repository::get(db, tenant_id, branch_id, plan_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership plan"))?
        .filter(|plan| plan.active)
        .ok_or_else(|| AppError::not_found("active membership plan was not found"))?;
    Ok(MembershipCheckoutIntent {
        client_id: client.id,
        plan_id: plan.id,
        plan_name: plan.name,
        price_paise: plan.price_paise,
        source: "membership",
        reference_id: String::new(),
    })
}

pub async fn renewal_checkout_intent(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
) -> Result<MembershipCheckoutIntent, AppError> {
    let membership =
        membership_lifecycle_repository::by_id(db, tenant_id, branch_id, client_membership_id)
            .await
            .map_err(|_| AppError::internal("failed to load client membership"))?
            .filter(|membership| membership.active)
            .ok_or_else(|| AppError::not_found("active membership was not found"))?;
    let mut intent = sale_checkout_intent(
        db,
        tenant_id,
        branch_id,
        &membership.client_id,
        &membership.membership_id,
    )
    .await?;
    if let Some(change) =
        membership_lifecycle_repository::list_plan_changes(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load scheduled plan change"))?
            .into_iter()
            .find(|change| {
                change.client_membership_id == client_membership_id && change.status == "scheduled"
            })
    {
        let target =
            membership_repository::get(db, tenant_id, branch_id, &change.target_membership_id)
                .await
                .map_err(|_| AppError::internal("failed to load target membership plan"))?
                .ok_or_else(|| AppError::not_found("target membership plan was not found"))?;
        intent.plan_id = target.id;
        intent.plan_name = target.name;
        intent.price_paise = target.price_paise;
        intent.reference_id = change.id;
        intent.source = "membership_plan_change";
    } else {
        intent.source = "membership_renewal";
        intent.reference_id = client_membership_id.to_string();
    }
    Ok(intent)
}

pub async fn change_plan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    target_membership_id: &str,
    effective_at: &str,
) -> Result<
    (
        membership_lifecycle_repository::PlanChangeRecord,
        Option<MembershipCheckoutIntent>,
    ),
    AppError,
> {
    if !matches!(effective_at, "now" | "renewal") {
        return Err(AppError::validation("effectiveAt must be now or renewal"));
    }
    let context = membership_lifecycle_repository::plan_change_context(
        db,
        tenant_id,
        branch_id,
        client_membership_id,
        target_membership_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load plan change context"))?
    .ok_or_else(|| AppError::not_found("active membership or target plan was not found"))?;
    if context.from_membership_id == context.target_membership_id {
        return Err(AppError::validation("target plan must be different"));
    }
    let (remaining_days, charge_paise, credit_paise) = prorated_amounts(
        context.from_price_paise,
        context.target_price_paise,
        context.from_validity_days,
        context.expires_at,
        chrono::Utc::now(),
    );
    let change_type = if context.target_price_paise >= context.from_price_paise {
        "upgrade"
    } else {
        "downgrade"
    };
    let change = membership_lifecycle_repository::create_plan_change(
        db,
        tenant_id,
        branch_id,
        membership_lifecycle_repository::NewPlanChange {
            client_membership_id,
            client_id: &context.client_id,
            from_membership_id: &context.from_membership_id,
            target_membership_id: &context.target_membership_id,
            change_type,
            effective_at,
            remaining_days,
            charge_paise,
            credit_paise,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create plan change"))?;
    let intent = (effective_at == "now").then(|| MembershipCheckoutIntent {
        client_id: context.client_id,
        plan_id: context.target_membership_id,
        plan_name: context.target_membership_name,
        price_paise: charge_paise,
        source: "membership_plan_change",
        reference_id: change.id.clone(),
    });
    Ok((change, intent))
}

pub async fn plan_changes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<membership_lifecycle_repository::PlanChangeRecord>, AppError> {
    membership_lifecycle_repository::list_plan_changes(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list plan changes"))
}

pub async fn family_members(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<membership_lifecycle_repository::FamilyMemberRecord>, AppError> {
    membership_lifecycle_repository::list_family_members(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list family members"))
}

pub async fn add_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    member_client_id: &str,
    relationship: &str,
) -> Result<membership_lifecycle_repository::FamilyMemberRecord, AppError> {
    let (owner_id, limit, count) = membership_lifecycle_repository::family_capacity(
        db,
        tenant_id,
        branch_id,
        client_membership_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to inspect family membership"))?
    .ok_or_else(|| AppError::validation("active family membership was not found"))?;
    if owner_id == member_client_id {
        return Err(AppError::validation(
            "owner cannot be added as a family member",
        ));
    }
    if count >= limit {
        return Err(AppError::validation("family member limit reached"));
    }
    membership_lifecycle_repository::add_family_member(
        db,
        tenant_id,
        branch_id,
        client_membership_id,
        &owner_id,
        member_client_id,
        relationship.trim(),
    )
    .await
    .map_err(|_| AppError::validation("family member is invalid or already linked"))
}

pub async fn remove_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, AppError> {
    membership_lifecycle_repository::remove_family_member(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to remove family member"))
}

pub async fn self_service_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<membership_lifecycle_repository::SelfServiceRequestRecord>, AppError> {
    membership_lifecycle_repository::list_self_service_requests(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list self-service requests"))
}

pub async fn create_self_service_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    request_type: &str,
    target_membership_id: Option<&str>,
    reason: &str,
    credit_delta: i32,
    service_id: &str,
    payment_reference: &str,
) -> Result<membership_lifecycle_repository::SelfServiceRequestRecord, AppError> {
    if !matches!(
        request_type,
        "renew"
            | "cancel"
            | "upgrade"
            | "downgrade"
            | "payment_method_update"
            | "credit_adjustment"
    ) {
        return Err(AppError::validation("invalid requestType"));
    }
    if matches!(request_type, "upgrade" | "downgrade")
        && target_membership_id.unwrap_or("").is_empty()
    {
        return Err(AppError::validation("targetMembershipId is required"));
    }
    if request_type == "credit_adjustment" && (credit_delta == 0 || service_id.trim().is_empty()) {
        return Err(AppError::validation(
            "serviceId and non-zero creditDelta are required",
        ));
    }
    if request_type == "payment_method_update" && payment_reference.trim().is_empty() {
        return Err(AppError::validation("paymentReference is required"));
    }
    if payment_reference.trim().len() > 200 {
        return Err(AppError::validation("paymentReference is too long"));
    }
    membership_lifecycle_repository::create_self_service_request(
        db,
        tenant_id,
        branch_id,
        client_membership_id,
        request_type,
        target_membership_id,
        reason.trim(),
        credit_delta,
        service_id.trim(),
        payment_reference.trim(),
    )
    .await
    .map_err(|_| AppError::validation("active membership or target plan was not found"))
}

pub async fn resolve_self_service_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    note: &str,
) -> Result<bool, AppError> {
    if !matches!(status, "approved" | "rejected" | "completed") {
        return Err(AppError::validation("invalid status"));
    }
    membership_lifecycle_repository::resolve_self_service_request(
        db,
        tenant_id,
        branch_id,
        id,
        status,
        note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve self-service request"))
}

pub async fn set_auto_renew_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<bool, AppError> {
    if !matches!(status, "active" | "paused" | "disabled") {
        return Err(AppError::validation("invalid auto-renew status"));
    }
    membership_lifecycle_repository::set_auto_renew_status(db, tenant_id, branch_id, id, status)
        .await
        .map_err(|_| AppError::internal("failed to update auto-renew status"))
}

pub async fn retry_auto_renew(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<
    (
        membership_lifecycle_repository::AutoRenewAttemptRecord,
        MembershipCheckoutIntent,
    ),
    AppError,
> {
    let attempt =
        membership_lifecycle_repository::create_auto_renew_attempt(db, tenant_id, branch_id, id)
            .await
            .map_err(|_| AppError::validation("membership is not eligible for auto-renew retry"))?;
    let mut intent = renewal_checkout_intent(db, tenant_id, branch_id, id).await?;
    intent.source = "membership_auto_renew";
    intent.reference_id = attempt.id.clone();
    Ok((attempt, intent))
}

pub async fn auto_renew_attempts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<membership_lifecycle_repository::AutoRenewAttemptRecord>, AppError> {
    membership_lifecycle_repository::list_auto_renew_attempts(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list auto-renew attempts"))
}

pub async fn process_due_auto_renewals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let due = auto_renew_queue(db, tenant_id, branch_id, 0).await?;
    let mut attempts = Vec::with_capacity(due.len());
    for membership in due {
        let (attempt, intent) = retry_auto_renew(db, tenant_id, branch_id, &membership.id).await?;
        attempts.push(json!({"attempt":attempt,"checkout":intent}));
    }
    Ok(json!({"processed":attempts.len(),"attempts":attempts}))
}

fn prorated_amounts(
    old_price: i64,
    new_price: i64,
    validity_days: i32,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> (i32, i64, i64) {
    let validity = validity_days.max(1) as i64;
    let remaining = expires_at
        .map(|expiry| ((expiry - now).num_seconds().max(0) + 86_399) / 86_400)
        .unwrap_or(0)
        .min(validity);
    let raw_delta = (new_price - old_price).saturating_mul(remaining);
    let delta = rounded_div(raw_delta, validity);
    (remaining as i32, delta.max(0), (-delta).max(0))
}

fn rounded_div(value: i64, divisor: i64) -> i64 {
    if divisor <= 0 || value == 0 {
        return 0;
    }
    let sign = value.signum();
    ((value.abs() + (divisor / 2)) / divisor) * sign
}

pub async fn client_360(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<MembershipClient360, AppError> {
    let client = clients_repository::get(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;
    let memberships =
        membership_lifecycle_repository::history_for_client(db, tenant_id, branch_id, client_id)
            .await
            .map_err(|_| AppError::internal("failed to load membership history"))?;
    let wallet =
        membership_lifecycle_repository::client_wallet(db, tenant_id, branch_id, client_id)
            .await
            .map_err(|_| AppError::internal("failed to load membership wallet"))?;
    let ledger =
        membership_lifecycle_repository::ledger_for_client(db, tenant_id, branch_id, client_id)
            .await
            .map_err(|_| AppError::internal("failed to load membership lifecycle ledger"))?;
    Ok(MembershipClient360 {
        client,
        memberships,
        wallet,
        ledger,
    })
}

pub struct MembershipPlanInput {
    pub name: Option<String>,
    pub code: Option<String>,
    pub plan_type: Option<String>,
    pub price: Option<i64>,
    pub price_paise: Option<i64>,
    pub points_required: Option<i32>,
    pub discount_percent: Option<i32>,
    pub validity_days: Option<i32>,
    pub notes: Option<String>,
    pub service_ids: Option<Vec<String>>,
    pub benefit_rules: Option<Value>,
    pub active: Option<bool>,
}

pub async fn list_plans(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<MembershipRecord>, AppError> {
    membership_repository::list(db, tenant_id, branch_id, q, limit, offset)
        .await
        .map_err(|_| AppError::internal("failed to list membership plans"))
}

pub async fn create_plan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: MembershipPlanInput,
) -> Result<MembershipRecord, AppError> {
    let name = required_text(input.name.as_deref(), "name is required")?;
    let plan_type = plan_type(input.plan_type.as_deref())?;
    let service_ids_json = serde_json::to_string(&input.service_ids.unwrap_or_default())
        .unwrap_or_else(|_| "[]".to_string());
    let benefit_rules_json = serde_json::to_string(
        &input
            .benefit_rules
            .unwrap_or(Value::Object(Default::default())),
    )
    .unwrap_or_else(|_| "{}".to_string());
    membership_repository::create(
        db,
        CreateMembership {
            tenant_id,
            branch_id,
            name,
            plan_type,
            price_paise: price_paise(input.price, input.price_paise)?,
            points_required: non_negative_i32(input.points_required, "pointsRequired")?,
            discount_percent: non_negative_i32(input.discount_percent, "discountPercent")?,
            validity_days: non_negative_i32(input.validity_days, "validityDays")?,
            notes: input.notes.as_deref().unwrap_or(""),
            service_ids_json: &service_ids_json,
            benefit_rules_json: &benefit_rules_json,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to create membership plan"))
}

pub async fn update_plan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    input: MembershipPlanInput,
) -> Result<Option<MembershipRecord>, AppError> {
    let service_ids_json = input
        .service_ids
        .as_ref()
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string()));
    let benefit_rules_json = input
        .benefit_rules
        .as_ref()
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()));
    let plan_type = input
        .plan_type
        .as_deref()
        .map(|value| plan_type(Some(value)))
        .transpose()?;
    membership_repository::update(
        db,
        UpdateMembership {
            tenant_id,
            branch_id,
            id,
            name: input.name.as_deref().map(str::trim),
            code: input.code.as_deref().map(str::trim),
            plan_type,
            price_paise: if input.price.is_some() || input.price_paise.is_some() {
                Some(price_paise(input.price, input.price_paise)?)
            } else {
                None
            },
            points_required: input.points_required.map(|value| value.max(0)),
            discount_percent: input.discount_percent.map(|value| value.max(0)),
            validity_days: input.validity_days.map(|value| value.max(0)),
            notes: input.notes.as_deref(),
            service_ids_json: service_ids_json.as_deref(),
            benefit_rules_json: benefit_rules_json.as_deref(),
            active: input.active,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update membership plan"))
}

pub async fn membership_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let saved = membership_advanced_repository::get_settings(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership settings"))?
        .unwrap_or_else(|| json!({}));
    Ok(merge_known_settings(&default_membership_settings(), &saved))
}

pub async fn save_membership_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: &Value,
) -> Result<Value, AppError> {
    if !input.is_object() {
        return Err(AppError::validation("settings must be an object"));
    }
    let settings = merge_known_settings(&default_membership_settings(), input);
    validate_retention_settings(&settings)?;
    membership_advanced_repository::save_settings(db, tenant_id, branch_id, &settings)
        .await
        .map_err(|_| AppError::internal("failed to save membership settings"))
}

pub async fn generate_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i32,
) -> Result<Value, AppError> {
    let count = membership_advanced_repository::generate_reminders(
        db,
        tenant_id,
        branch_id,
        days.clamp(1, 365),
    )
    .await
    .map_err(|_| AppError::internal("failed to generate membership reminders"))?;
    Ok(json!({"count":count}))
}

pub async fn reminder_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<membership_advanced_repository::MembershipReminderRecord>, AppError> {
    membership_advanced_repository::list_reminders(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list membership reminders"))
}

pub async fn approve_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, AppError> {
    membership_advanced_repository::approve_reminder(db, tenant_id, branch_id, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to approve membership reminder"))
}

pub async fn commission_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let rows = membership_advanced_repository::commission_rows(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership commission report"))?;
    let mut by_staff: HashMap<String, (String, i64, i64, i64)> = HashMap::new();
    for row in &rows {
        let entry =
            by_staff
                .entry(row.staff_id.clone())
                .or_insert((row.staff_name.clone(), 0, 0, 0));
        entry.1 += row.revenue_paise;
        entry.2 += row.commission_paise;
        entry.3 += 1;
    }
    let mut staff=by_staff.into_iter().map(|(staff_id,(staff_name,revenue_paise,commission_paise,sale_count))|
        json!({"staffId":staff_id,"staffName":staff_name,"revenuePaise":revenue_paise,"commissionPaise":commission_paise,"saleCount":sale_count}))
        .collect::<Vec<_>>();
    staff.sort_by_key(|row| {
        -row.get("commissionPaise")
            .and_then(Value::as_i64)
            .unwrap_or(0)
    });
    let revenue_paise = rows.iter().map(|row| row.revenue_paise).sum::<i64>();
    let commission_paise = rows.iter().map(|row| row.commission_paise).sum::<i64>();
    Ok(
        json!({"metrics":{"totalRevenuePaise":revenue_paise,"commissionPaise":commission_paise,"saleCount":rows.len(),"staffCount":staff.len()},"staff":staff,"entries":rows}),
    )
}

pub async fn risk_report(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<Value, AppError> {
    let memberships = active_memberships(db, tenant_id, branch_id).await?;
    let reviews = membership_advanced_repository::list_risk_reviews(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load membership risk reviews"))?;
    let review_by_id = reviews
        .into_iter()
        .map(|row| (row.signal_id.clone(), row))
        .collect::<HashMap<_, _>>();
    let now = chrono::Utc::now();
    let mut signals = Vec::new();
    for item in memberships {
        let mut candidates: Vec<(&str, &str, i64, &str)> = Vec::new();
        if item.active && item.expires_at.is_some_and(|expiry| expiry < now) {
            candidates.push((
                "active_after_expiry",
                "critical",
                98,
                "Membership is still active after expiry.",
            ));
        }
        if matches!(
            item.auto_renew_status.as_str(),
            "failed" | "payment_required"
        ) {
            candidates.push((
                "auto_renew_payment_failed",
                "high",
                88,
                "Auto-renew payment requires attention.",
            ));
        }
        if item.active
            && !item.auto_renew_enabled
            && item.expires_at.is_some_and(|expiry| {
                (expiry - now).num_days() >= 0 && (expiry - now).num_days() <= 30
            })
        {
            candidates.push((
                "renewal_follow_up",
                "medium",
                62,
                "Membership expires within 30 days without auto-renew.",
            ));
        }
        if !item.active && item.cancelled_at.is_some() && item.cancel_reason.trim().is_empty() {
            candidates.push((
                "cancellation_reason_missing",
                "medium",
                70,
                "Cancelled membership has no reason.",
            ));
        }
        for (code, level, score, reason) in candidates {
            let signal_id = format!("{}:{code}", item.id);
            let review = review_by_id.get(&signal_id);
            signals.push(json!({"id":signal_id,"code":code,"riskLevel":level,"riskScore":score,"reason":reason,"membershipId":item.id,"membershipName":item.membership_name,"clientId":item.client_id,"clientName":item.client_name,"reviewStatus":review.map(|row|row.review_status.as_str()).unwrap_or("pending"),"reviewedBy":review.map(|row|row.reviewed_by.as_str()).unwrap_or(""),"reviewNote":review.map(|row|row.note.as_str()).unwrap_or("")}));
        }
    }
    let metric = |level: &str| {
        signals
            .iter()
            .filter(|row| row.get("riskLevel").and_then(Value::as_str) == Some(level))
            .count()
    };
    Ok(
        json!({"metrics":{"total":signals.len(),"pending":signals.iter().filter(|row|row.get("reviewStatus").and_then(Value::as_str)==Some("pending")).count(),"reviewed":signals.iter().filter(|row|row.get("reviewStatus").and_then(Value::as_str)==Some("reviewed")).count(),"critical":metric("critical"),"high":metric("high"),"medium":metric("medium"),"low":metric("low")},"signals":signals}),
    )
}

pub async fn review_risk(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    signal_id: &str,
    payload: &Value,
    actor: &str,
) -> Result<membership_advanced_repository::MembershipRiskReviewRecord, AppError> {
    let status = payload
        .get("reviewStatus")
        .and_then(Value::as_str)
        .unwrap_or("reviewed");
    if !matches!(status, "pending" | "reviewed" | "dismissed") {
        return Err(AppError::validation("invalid reviewStatus"));
    }
    membership_advanced_repository::review_risk(
        db,
        tenant_id,
        branch_id,
        signal_id,
        payload
            .get("membershipId")
            .and_then(Value::as_str)
            .unwrap_or(""),
        payload
            .get("clientId")
            .and_then(Value::as_str)
            .unwrap_or(""),
        payload
            .get("riskLevel")
            .and_then(Value::as_str)
            .unwrap_or(""),
        status,
        payload.get("note").and_then(Value::as_str).unwrap_or(""),
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to review membership risk"))
}

pub async fn rewards_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<membership_advanced_repository::MembershipRewardRecord>, AppError> {
    membership_advanced_repository::reward_ledger(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load rewards ledger"))
}

pub async fn adjust_reward_balance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    points: i32,
    note: &str,
    idempotency_key: &str,
    actor: &str,
) -> Result<RewardAdjustmentResult, AppError> {
    let client_id = required_text(Some(client_id), "clientId is required")?;
    let note = required_text(Some(note), "note is required")?;
    let key = required_text(Some(idempotency_key), "idempotencyKey is required")?;
    if points == 0 || !(-1_000_000..=1_000_000).contains(&points) {
        return Err(AppError::validation(
            "points must be between -1000000 and 1000000 and cannot be 0",
        ));
    }
    if note.len() > 500 {
        return Err(AppError::validation("note must be at most 500 characters"));
    }
    if key.len() < 8
        || key.len() > 120
        || !key
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err(AppError::validation(
            "idempotencyKey must be 8-120 letters, numbers, hyphens, or underscores",
        ));
    }

    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start reward adjustment"))?;
    let client_exists = sqlx::query_scalar::<_, String>(
        "SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to lock reward client"))?;
    if client_exists.is_none() {
        return Err(AppError::not_found("client not found"));
    }
    if let Some(existing) = load_reward_adjustment(&mut tx, tenant_id, branch_id, key).await? {
        if existing.client_id != client_id || existing.points != points || existing.note != note {
            return Err(AppError::conflict(
                "idempotencyKey is already used by another reward adjustment",
            ));
        }
        return Ok(existing);
    }

    let balance = reward_balance(&mut tx, tenant_id, branch_id, client_id).await?;
    let next_balance = balance
        .checked_add(points)
        .filter(|value| *value >= 0)
        .ok_or_else(|| AppError::validation("reward adjustment exceeds available balance"))?;
    let inserted = sqlx::query_as::<_, RewardAdjustmentResult>(
        "INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,transaction_type,points,balance_after,staff_id,note,idempotency_key) VALUES ($1,$2,$3,'adjusted',$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id,client_id,transaction_type,points,balance_after,staff_id,note,created_at",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(points)
    .bind(next_balance)
    .bind(actor)
    .bind(note)
    .bind(key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to post reward adjustment"))?;
    let result = if let Some(inserted) = inserted {
        inserted
    } else {
        let existing = load_reward_adjustment(&mut tx, tenant_id, branch_id, key)
            .await?
            .ok_or_else(|| AppError::conflict("reward adjustment could not be replayed"))?;
        if existing.client_id != client_id || existing.points != points || existing.note != note {
            return Err(AppError::conflict(
                "idempotencyKey is already used by another reward adjustment",
            ));
        }
        existing
    };
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit reward adjustment"))?;
    Ok(result)
}

pub async fn reverse_rewards_for_refund(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    staff_id: &str,
    sale_id: &str,
    refund_id: &str,
    cumulative_refund_paise: i64,
    sale_total_paise: i64,
) -> Result<(), AppError> {
    if client_id.is_empty() || cumulative_refund_paise <= 0 || sale_total_paise <= 0 {
        return Ok(());
    }
    sqlx::query("SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock refund reward balance"))?;
    if sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND source_refund_id=$3)")
        .bind(tenant_id).bind(branch_id).bind(refund_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate reward refund replay"))?
    {
        return Ok(());
    }
    let (earned, redeemed) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COALESCE(SUM(CASE WHEN transaction_type='earned' THEN points ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN transaction_type='redeemed' THEN points ELSE 0 END),0)::BIGINT FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(sale_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load sale rewards"))?;
    let net_sale_points = earned.saturating_sub(redeemed);
    if net_sale_points == 0 {
        return Ok(());
    }
    let refunded = cumulative_refund_paise.min(sale_total_paise);
    let target = if refunded == sale_total_paise {
        net_sale_points.saturating_neg()
    } else {
        (net_sale_points.saturating_mul(refunded) / sale_total_paise).saturating_neg()
    };
    let reversed = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(points),0)::BIGINT FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4 AND transaction_type='reversed'")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load prior reward reversals"))?;
    let balance = reward_balance(tx, tenant_id, branch_id, client_id).await?;
    let delta = target
        .saturating_sub(reversed)
        .clamp(-i64::from(balance), i64::from(i32::MAX - balance)) as i32;
    if delta == 0 {
        return Ok(());
    }
    sqlx::query("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,source_sale_id,source_refund_id,transaction_type,points,balance_after,staff_id,note) VALUES ($1,$2,$3,$4,$5,'reversed',$6,$7,$8,'POS refund reward reversal') ON CONFLICT DO NOTHING")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(refund_id)
        .bind(delta).bind(balance + delta).bind(staff_id).execute(&mut **tx).await
        .map_err(|_| AppError::internal("failed to post refund reward reversal"))?;
    Ok(())
}

async fn reward_balance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<i32, AppError> {
    sqlx::query_scalar::<_, i32>("SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(&mut **tx).await
        .map(|value| value.unwrap_or(0)).map_err(|_| AppError::internal("failed to load reward balance"))
}

async fn load_reward_adjustment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    key: &str,
) -> Result<Option<RewardAdjustmentResult>, AppError> {
    sqlx::query_as::<_, RewardAdjustmentResult>("SELECT id,client_id,transaction_type,points,balance_after,staff_id,note,created_at FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant_id).bind(branch_id).bind(key).fetch_optional(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load reward adjustment replay"))
}

pub async fn rewards_roi(db: &PgPool, tenant_id: &str, branch_id: &str) -> Result<Value, AppError> {
    let ledger = rewards_ledger(db, tenant_id, branch_id).await?;
    let revenue = membership_advanced_repository::reward_revenue(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load reward revenue"))?;
    let reward_clients = ledger
        .iter()
        .map(|row| row.client_id.clone())
        .collect::<HashSet<_>>();
    let earned = ledger
        .iter()
        .filter(|row| row.transaction_type == "earned")
        .map(|row| row.points as i64)
        .sum::<i64>();
    let redeemed = ledger
        .iter()
        .filter(|row| row.transaction_type == "redeemed")
        .map(|row| row.points.abs() as i64)
        .sum::<i64>();
    let reward_revenue = revenue
        .iter()
        .filter(|row| reward_clients.contains(&row.client_id))
        .map(|row| row.total_sale_paise)
        .sum::<i64>();
    let non_reward_revenue = revenue
        .iter()
        .filter(|row| !reward_clients.contains(&row.client_id))
        .map(|row| row.total_sale_paise)
        .sum::<i64>();
    Ok(
        json!({"metrics":{"totalRewardClients":reward_clients.len(),"totalPointsEarned":earned,"totalPointsRedeemed":redeemed,"rewardUsersRevenuePaise":reward_revenue,"nonRewardUsersRevenuePaise":non_reward_revenue},"rows":revenue.into_iter().filter(|row|reward_clients.contains(&row.client_id)).collect::<Vec<_>>() }),
    )
}

pub async fn expiring_rewards(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i64,
) -> Result<Vec<Value>, AppError> {
    let ledger = rewards_ledger(db, tenant_id, branch_id).await?;
    let today = chrono::Utc::now().date_naive();
    let mut seen = HashSet::new();
    Ok(ledger.into_iter().filter_map(|row|{
        if !seen.insert(row.client_id.clone())||row.balance_after<=0{return None;}
        let expiry=row.expires_at?;let days_left=(expiry-today).num_days();
        (days_left>=0&&days_left<=days).then(||json!({"clientId":row.client_id,"clientName":row.client_name,"pointsExpiring":row.balance_after,"expiryDate":expiry,"daysLeft":days_left}))
    }).collect())
}

pub async fn reward_abuse_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, AppError> {
    let ledger = rewards_ledger(db, tenant_id, branch_id).await?;
    let mut totals: HashMap<String, (String, i64, i64, i64)> = HashMap::new();
    for row in ledger {
        let entry = totals
            .entry(row.client_id)
            .or_insert((row.client_name, 0, 0, 0));
        match row.transaction_type.as_str() {
            "earned" => entry.1 += row.points as i64,
            "redeemed" => entry.2 += row.points.abs() as i64,
            "adjusted" => entry.3 += 1,
            _ => {}
        }
    }
    Ok(totals.into_iter().filter_map(|(client_id,(client_name,earned,redeemed,adjustments))|{
        if redeemed>earned{Some(json!({"clientId":client_id,"clientName":client_name,"riskLevel":"critical","alertType":"Redeemed points exceed earned points","earned":earned,"redeemed":redeemed}))}
        else if adjustments>=2{Some(json!({"clientId":client_id,"clientName":client_name,"riskLevel":"medium","alertType":"Repeated reward adjustment","adjustments":adjustments}))}else{None}
    }).collect())
}

pub async fn create_status_link(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    client_membership_id: Option<&str>,
) -> Result<membership_advanced_repository::PublicMembershipStatusRecord, AppError> {
    membership_advanced_repository::create_self_service_token(
        db,
        tenant_id,
        branch_id,
        client_id,
        client_membership_id,
    )
    .await
    .map_err(|_| AppError::validation("client or membership was not found"))
}

pub async fn public_status(db: &PgPool, token: &str) -> Result<Value, AppError> {
    let status = membership_advanced_repository::public_status(db, token)
        .await
        .map_err(|_| AppError::internal("failed to load membership status"))?
        .ok_or_else(|| AppError::not_found("membership status link is invalid or expired"))?;
    let credits = membership_lifecycle_repository::client_wallet(
        db,
        &status.tenant_id,
        &status.branch_id,
        &status.client_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load membership credits"))?;
    Ok(json!({
        "token":status.token,
        "clientId":status.client_id,
        "clientName":status.client_name,
        "clientMembershipId":status.client_membership_id,
        "membershipName":status.membership_name,
        "status":status.status,
        "expiresAt":status.expires_at,
        "tokenExpiresAt":status.token_expires_at,
        "credits":credits
    }))
}

pub async fn public_renew_request(
    db: &PgPool,
    token: &str,
) -> Result<membership_lifecycle_repository::SelfServiceRequestRecord, AppError> {
    let status = membership_advanced_repository::public_status(db, token)
        .await
        .map_err(|_| AppError::internal("failed to load membership status"))?
        .ok_or_else(|| AppError::not_found("membership status link is invalid or expired"))?;
    let membership_id = status
        .client_membership_id
        .ok_or_else(|| AppError::validation("active membership is required"))?;
    create_self_service_request(
        db,
        &status.tenant_id,
        &status.branch_id,
        &membership_id,
        "renew",
        None,
        "Requested from self-service link",
        0,
        "",
        "",
    )
    .await
}

pub async fn public_self_service_request(
    db: &PgPool,
    token: &str,
    request_type: &str,
    reason: &str,
    credit_delta: i32,
    service_id: &str,
    payment_reference: &str,
) -> Result<membership_lifecycle_repository::SelfServiceRequestRecord, AppError> {
    if !matches!(
        request_type,
        "renew" | "cancel" | "payment_method_update" | "credit_adjustment"
    ) {
        return Err(AppError::validation("invalid public requestType"));
    }
    let status = membership_advanced_repository::public_status(db, token)
        .await
        .map_err(|_| AppError::internal("failed to load membership status"))?
        .ok_or_else(|| AppError::not_found("membership status link is invalid or expired"))?;
    let membership_id = status
        .client_membership_id
        .ok_or_else(|| AppError::validation("active membership is required"))?;
    create_self_service_request(
        db,
        &status.tenant_id,
        &status.branch_id,
        &membership_id,
        request_type,
        None,
        reason,
        credit_delta,
        service_id,
        payment_reference,
    )
    .await
}

pub async fn proration_preview(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    target_membership_id: &str,
) -> Result<Value, AppError> {
    let context = membership_lifecycle_repository::plan_change_context(
        db,
        tenant_id,
        branch_id,
        client_membership_id,
        target_membership_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load proration context"))?
    .ok_or_else(|| AppError::not_found("active membership or target plan was not found"))?;
    let (remaining_days, charge_paise, credit_paise) = prorated_amounts(
        context.from_price_paise,
        context.target_price_paise,
        context.from_validity_days,
        context.expires_at,
        chrono::Utc::now(),
    );
    Ok(
        json!({"clientMembershipId":client_membership_id,"fromMembershipId":context.from_membership_id,"fromMembershipName":context.from_membership_name,"targetMembershipId":context.target_membership_id,"targetMembershipName":context.target_membership_name,"remainingDays":remaining_days,"chargePaise":charge_paise,"creditPaise":credit_paise,"changeType":if context.target_price_paise>=context.from_price_paise{"upgrade"}else{"downgrade"}}),
    )
}

pub async fn enterprise_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let (summary, memberships, ledger, commission, risk, reminders, auto_renew) = tokio::try_join!(
        lifecycle_report(db, tenant_id, branch_id),
        active_memberships(db, tenant_id, branch_id),
        lifecycle_ledger(db, tenant_id, branch_id, 1000),
        commission_report(db, tenant_id, branch_id),
        risk_report(db, tenant_id, branch_id),
        reminder_rows(db, tenant_id, branch_id),
        auto_renew_queue(db, tenant_id, branch_id, 30)
    )?;
    let now = chrono::Utc::now();
    let expiring = memberships
        .iter()
        .filter(|item| {
            item.active
                && item
                    .expires_at
                    .is_some_and(|expiry| expiry >= now && (expiry - now).num_days() <= 30)
        })
        .count();
    let customer_sales = sqlx::query("SELECT ps.client_id,COALESCE(NULLIF(CONCAT_WS(' ',c.first_name,c.last_name),''),ps.client_id) client_name,COUNT(DISTINCT ps.id)::BIGINT sale_count,COALESCE(SUM(psl.line_total_paise),0)::BIGINT revenue_paise FROM pos_sale_lines psl JOIN pos_sales ps ON ps.id=psl.sale_id AND ps.tenant_id=psl.tenant_id AND ps.branch_id=psl.branch_id LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id WHERE psl.tenant_id=$1 AND psl.branch_id=$2 AND psl.line_type='membership' AND ps.status NOT IN ('draft','cancelled','voided') GROUP BY ps.client_id,c.first_name,c.last_name ORDER BY revenue_paise DESC")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
        .map_err(|_| AppError::internal("failed to load membership customer sales"))?
        .into_iter().map(|row| json!({"clientId":row.get::<String,_>("client_id"),"clientName":row.get::<String,_>("client_name"),"saleCount":row.get::<i64,_>("sale_count"),"revenuePaise":row.get::<i64,_>("revenue_paise")})).collect::<Vec<_>>();
    let redemption = sqlx::query("SELECT pmr.client_id,COALESCE(NULLIF(CONCAT_WS(' ',c.first_name,c.last_name),''),pmr.client_id) client_name,pmr.membership_name,pmr.service_name,COALESCE(SUM(pmr.quantity),0)::BIGINT quantity,COUNT(DISTINCT pmr.sale_id)::BIGINT visit_count FROM pos_membership_redemptions pmr LEFT JOIN clients c ON c.id=pmr.client_id AND c.tenant_id=pmr.tenant_id AND c.branch_id=pmr.branch_id WHERE pmr.tenant_id=$1 AND pmr.branch_id=$2 GROUP BY pmr.client_id,c.first_name,c.last_name,pmr.membership_name,pmr.service_name ORDER BY quantity DESC")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
        .map_err(|_| AppError::internal("failed to load membership redemption report"))?
        .into_iter().map(|row| json!({"clientId":row.get::<String,_>("client_id"),"clientName":row.get::<String,_>("client_name"),"membershipName":row.get::<String,_>("membership_name"),"serviceName":row.get::<String,_>("service_name"),"quantity":row.get::<i64,_>("quantity"),"visitCount":row.get::<i64,_>("visit_count")})).collect::<Vec<_>>();
    let profitability =
        membership_advanced_repository::profitability_rows(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load membership profitability"))?;
    let service_cost_paise = profitability
        .iter()
        .map(|row| row.service_cost_paise)
        .sum::<i64>();
    let redeemed_value_paise = profitability
        .iter()
        .map(|row| row.redeemed_value_paise)
        .sum::<i64>();
    let net_profit_paise = profitability
        .iter()
        .map(|row| row.net_profit_paise)
        .sum::<i64>();
    let contribution_paise = net_profit_paise;
    Ok(
        json!({"metrics":{"activeMembers":summary.active_members,"expiredMembers":summary.expired_members,"cancelledMembers":summary.cancelled_members,"membershipSalesPaise":summary.membership_sales_paise,"commissionPaise":summary.commission_paise,"serviceCostPaise":service_cost_paise,"redeemedValuePaise":redeemed_value_paise,"netProfitPaise":net_profit_paise,"contributionPaise":contribution_paise,"creditLiability":summary.credit_liability,"redeemedCredits":summary.redeemed_credits,"expiringSoon":expiring},"memberships":memberships.into_iter().map(|item|json!({"id":item.id,"clientId":item.client_id,"clientName":item.client_name,"membershipId":item.membership_id,"membershipName":item.membership_name,"assignedAt":item.assigned_at,"expiresAt":item.expires_at,"active":item.active,"remainingCredits":item.remaining_credits,"autoRenewStatus":item.auto_renew_status})).collect::<Vec<_>>(),"ledger":ledger,"commission":commission,"risk":risk,"reminders":reminders,"autoRenew":auto_renew,"customerSales":customer_sales,"redemption":redemption,"profitability":profitability}),
    )
}

fn default_membership_settings() -> Value {
    json!({
        "membershipCatalog":{"membershipSalesEnabled":true,"visibleInPos":true,"visibleOnline":true,"freeMembershipEnabled":true,"paidMembershipEnabled":true},
        "creditsBenefits":{"serviceCreditsEnabled":true,"walletCreditsEnabled":true,"rewardPointsEnabled":true,"rewardPointsPer100Rupees":0,"rewardPointValuePaise":100,"discountBenefitsEnabled":true,"allowBenefitStacking":false},
        "renewalExpiry":{"autoRenewEnabled":false,"expiryDaysEnabled":true,"defaultValidityDays":365,"renewalReminderDays":30,"expiredBenefitAction":"block"},
        "paymentBilling":{"allowDueOnMembershipSale":true,"membershipTaxApplicable":true,"taxInclusiveMembershipPrice":false,"invoiceMembershipSnapshot":true},
        "redemptionRules":{"blockRedemptionWhenExpired":true,"requireStaffConfirmation":true,"allowPartialCredits":true,"allowFamilySharing":true},
        "crossLocation":{"enabled":false,"acceptInbound":false,"scope":"tenant","allowDiscounts":true,"allowServiceCredits":true,"allowGiftCards":false,"allowLoyaltyPoints":false},
        "notificationsRisk":{"renewalReminder":true,"lowCreditReminder":true,"ownerAlertForHighBalance":true,"highBalanceThreshold":1000000},
        "loyaltyTiers":{"enabled":true,"tiers":[{"code":"bronze","name":"Bronze","minimumPoints":0},{"code":"silver","name":"Silver","minimumPoints":1000},{"code":"gold","name":"Gold","minimumPoints":5000}]},
        "referrals":{"enabled":true,"referrerRewardPoints":100,"referredRewardPoints":50},
        "rewards":{"allowNonMembers":false,"enableForProducts":false,"enableForPackages":false,"enableForMemberships":false,"enableForServices":false,"rewardValuePaise":10000,"rewardPoints":5,"minimumRedemptionPoints":100,"bonusRules":[{"minBillPaise":0,"rewardType":"percentage","rewardValue":0}]},
        // `eligibleLineTypes` is a boolean map rather than a string array
        // because merge_known_settings keeps only object elements inside
        // arrays; a string array would be silently emptied on every save.
        // Stamp balances are branch-scoped in Phase 1B, so there is no
        // `scope` knob: a configurable tenant scope that still behaved
        // branch-scoped would mislead owners. Tenant-wide cards are Phase 1D.
        "stampCards":[{"code":"","name":"","active":false,"stampsRequired":10,"rewardPointsOnCompletion":0,"earnRule":{"minimumBillPaise":0,"eligibleLineTypes":{"service":true,"product":false,"package":false,"membership":false}}}],
        "defaults":{"defaultStatus":"active","defaultMembershipType":"paid"}
    })
}

fn merge_known_settings(defaults: &Value, input: &Value) -> Value {
    match (defaults, input) {
        (Value::Object(defaults), Value::Object(input)) => Value::Object(
            defaults
                .iter()
                .map(|(key, default)| {
                    let value = input
                        .get(key)
                        .map(|candidate| merge_known_settings(default, candidate))
                        .unwrap_or_else(|| default.clone());
                    (key.clone(), value)
                })
                .collect(),
        ),
        (Value::Bool(_), Value::Bool(_)) | (Value::String(_), Value::String(_)) => input.clone(),
        (Value::Number(_), Value::Number(number))
            if number.as_i64().is_some_and(|value| value >= 0) =>
        {
            input.clone()
        }
        (Value::Array(defaults), Value::Array(input)) if !defaults.is_empty() => Value::Array(
            input
                .iter()
                .filter(|value| value.is_object())
                .take(10)
                .map(|value| merge_known_settings(&defaults[0], value))
                .collect(),
        ),
        _ => defaults.clone(),
    }
}

fn validate_retention_settings(settings: &Value) -> Result<(), AppError> {
    let cross_location_scope = settings
        .pointer("/crossLocation/scope")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !matches!(
        cross_location_scope,
        "tenant" | "region" | "zone" | "cluster"
    ) {
        return Err(AppError::validation("invalid cross-location scope"));
    }
    let tiers = settings
        .pointer("/loyaltyTiers/tiers")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::validation("loyalty tiers are required"))?;
    if tiers.is_empty() {
        return Err(AppError::validation(
            "at least one loyalty tier is required",
        ));
    }
    let mut codes = HashSet::new();
    for tier in tiers {
        let code = tier
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let name = tier
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if code.is_empty()
            || code.len() > 32
            || !code
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || value == '_')
        {
            return Err(AppError::validation(
                "loyalty tier code must be 1-32 letters, numbers, or underscores",
            ));
        }
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::validation(
                "loyalty tier name must be 1-64 characters",
            ));
        }
        if !codes.insert(code.to_ascii_lowercase()) {
            return Err(AppError::validation("loyalty tier codes must be unique"));
        }
    }
    let reward_points = settings
        .pointer("/rewards/rewardPoints")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let reward_value_paise = settings
        .pointer("/rewards/rewardValuePaise")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if reward_points > 0 && reward_value_paise <= 0 {
        return Err(AppError::validation(
            "reward value must be greater than zero when reward points are set",
        ));
    }
    if let Some(rules) = settings
        .pointer("/rewards/bonusRules")
        .and_then(Value::as_array)
    {
        for rule in rules {
            let reward_type = rule
                .get("rewardType")
                .and_then(Value::as_str)
                .unwrap_or("");
            if !matches!(reward_type, "percentage" | "flat") {
                return Err(AppError::validation(
                    "reward bonus rule type must be percentage or flat",
                ));
            }
            let bonus_value = rule.get("rewardValue").and_then(Value::as_i64).unwrap_or(0);
            if reward_type == "percentage" && bonus_value > 1000 {
                return Err(AppError::validation(
                    "reward bonus percentage cannot exceed 1000",
                ));
            }
        }
    }
    Ok(())
}

fn required_text<'a>(value: Option<&'a str>, message: &'static str) -> Result<&'a str, AppError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation(message))
}

fn plan_type(value: Option<&str>) -> Result<&str, AppError> {
    let value = value.unwrap_or("discount").trim();
    matches!(
        value,
        "discount"
            | "prepaid_credit"
            | "visit_pack"
            | "service_credit"
            | "combo"
            | "unlimited"
            | "family"
            | "corporate"
            | "tiered"
    )
    .then_some(value)
    .ok_or_else(|| AppError::validation("invalid planType"))
}

fn non_negative_i32(value: Option<i32>, field: &'static str) -> Result<i32, AppError> {
    value
        .unwrap_or(0)
        .ge(&0)
        .then_some(value.unwrap_or(0))
        .ok_or_else(|| AppError::validation(format!("{field} must be 0 or greater")))
}

fn price_paise(price: Option<i64>, price_paise: Option<i64>) -> Result<i64, AppError> {
    let value = price_paise
        .or_else(|| price.and_then(|rupees| rupees.checked_mul(100)))
        .unwrap_or(0);
    (value >= 0)
        .then_some(value)
        .ok_or_else(|| AppError::validation("price must be 0 or greater"))
}

#[cfg(test)]
mod tests {
    use super::{
        adjust_reward_balance, default_membership_settings, membership_settings,
        merge_known_settings, prorated_amounts, reverse_rewards_for_refund,
        save_membership_settings, validate_retention_settings,
    };
    use chrono::{Duration, Utc};
    use serde_json::json;
    use sqlx::PgPool;

    /// Phase 1A: `rewards.allowNonMembers` is part of the persisted settings
    /// contract, defaults to false for backward compatibility, and survives a
    /// settings save. `merge_known_settings` only keeps keys present in the
    /// defaults, so a missing default would silently discard the owner's
    /// choice on every save.
    #[test]
    fn allow_non_members_defaults_off_and_round_trips_through_settings() {
        let defaults = default_membership_settings();
        assert_eq!(
            defaults.pointer("/rewards/allowNonMembers"),
            Some(&json!(false)),
            "non-member earning must default to off"
        );

        // An owner enabling the toggle is persisted.
        let enabled = merge_known_settings(&defaults, &json!({ "rewards": { "allowNonMembers": true } }));
        assert_eq!(enabled.pointer("/rewards/allowNonMembers"), Some(&json!(true)));

        // Existing reward configuration is untouched by the new key.
        assert_eq!(
            enabled.pointer("/rewards/minimumRedemptionPoints"),
            defaults.pointer("/rewards/minimumRedemptionPoints")
        );
        assert_eq!(
            enabled.pointer("/redemptionRules"),
            defaults.pointer("/redemptionRules"),
            "redemption rules must be unchanged by Phase 1A"
        );

        // A tenant that never sends the key keeps the members-only default.
        let untouched = merge_known_settings(&defaults, &json!({ "rewards": { "enableForServices": true } }));
        assert_eq!(untouched.pointer("/rewards/allowNonMembers"), Some(&json!(false)));

        // Turning it back off is persisted too.
        let disabled = merge_known_settings(&enabled, &json!({ "rewards": { "allowNonMembers": false } }));
        assert_eq!(disabled.pointer("/rewards/allowNonMembers"), Some(&json!(false)));
    }

    /// Phase 1B: `stampCards` programs must survive a settings save.
    /// `merge_known_settings` uses the first default array element as the
    /// shape template and keeps only object elements, so the template must
    /// cover every field an owner can configure.
    #[test]
    fn stamp_card_programs_round_trip_through_settings() {
        let defaults = default_membership_settings();
        let template = defaults
            .pointer("/stampCards/0")
            .expect("stampCards template must exist in defaults");
        assert_eq!(template.pointer("/active"), Some(&json!(false)));
        assert_eq!(template.pointer("/code"), Some(&json!("")));

        let saved = merge_known_settings(
            &defaults,
            &json!({ "stampCards": [{
                "code": "coffee",
                "name": "Coffee card",
                "active": true,
                "stampsRequired": 6,
                "rewardPointsOnCompletion": 40,
                "earnRule": {
                    "minimumBillPaise": 50_000,
                    "eligibleLineTypes": { "service": true, "product": true }
                }
            }] }),
        );
        assert_eq!(saved.pointer("/stampCards/0/code"), Some(&json!("coffee")));
        assert_eq!(saved.pointer("/stampCards/0/active"), Some(&json!(true)));
        assert_eq!(saved.pointer("/stampCards/0/stampsRequired"), Some(&json!(6)));
        assert_eq!(
            saved.pointer("/stampCards/0/rewardPointsOnCompletion"),
            Some(&json!(40))
        );
        assert_eq!(
            saved.pointer("/stampCards/0/earnRule/minimumBillPaise"),
            Some(&json!(50_000))
        );
        // Phase 1B is branch-only: no scope knob is exposed, so an owner
        // cannot configure a tenant-wide card that would silently behave as
        // branch-scoped. Tenant scope arrives in Phase 1D.
        assert!(saved.pointer("/stampCards/0/scope").is_none());
        assert!(defaults.pointer("/stampCards/0/scope").is_none());
        // An unknown key sent by a client is dropped by the merge.
        let injected = merge_known_settings(
            &defaults,
            &json!({ "stampCards": [{ "code": "c", "scope": "tenant" }] }),
        );
        assert!(injected.pointer("/stampCards/0/scope").is_none());
        // The boolean line-type map survives; a string array would be dropped
        // by the object-only array filter in merge_known_settings.
        assert_eq!(
            saved.pointer("/stampCards/0/earnRule/eligibleLineTypes/service"),
            Some(&json!(true))
        );
        assert_eq!(
            saved.pointer("/stampCards/0/earnRule/eligibleLineTypes/product"),
            Some(&json!(true))
        );
        assert_eq!(
            saved.pointer("/stampCards/0/earnRule/eligibleLineTypes/package"),
            Some(&json!(false))
        );

        // Phase 1A reward settings are untouched by the new block.
        assert_eq!(
            saved.pointer("/rewards/allowNonMembers"),
            defaults.pointer("/rewards/allowNonMembers")
        );
        assert_eq!(
            saved.pointer("/redemptionRules"),
            defaults.pointer("/redemptionRules")
        );

        // A tenant that never configures a card keeps the inactive template.
        let untouched = merge_known_settings(&defaults, &json!({ "rewards": { "allowNonMembers": true } }));
        assert_eq!(untouched.pointer("/stampCards/0/active"), Some(&json!(false)));
    }

    #[test]
    fn proration_returns_charge_or_credit_for_remaining_term() {
        let now = Utc::now();
        assert_eq!(
            prorated_amounts(10_000, 20_000, 30, Some(now + Duration::days(15)), now),
            (15, 5_000, 0)
        );
        assert_eq!(
            prorated_amounts(20_000, 10_000, 30, Some(now + Duration::days(15)), now),
            (15, 0, 5_000)
        );
        assert_eq!(
            prorated_amounts(10_000, 20_000, 3, Some(now + Duration::days(2)), now),
            (2, 6_667, 0)
        );
        assert_eq!(
            prorated_amounts(20_000, 10_000, 3, Some(now + Duration::days(2)), now),
            (2, 0, 6_667)
        );
    }

    #[test]
    fn membership_settings_keep_known_typed_values_only() {
        let merged = merge_known_settings(
            &default_membership_settings(),
            &json!({"renewalExpiry":{"defaultValidityDays":90,"autoRenewEnabled":true,"unknown":true},"creditsBenefits":"invalid","crossLocation":{"enabled":true,"scope":"zone"}}),
        );
        assert_eq!(merged["renewalExpiry"]["defaultValidityDays"], 90);
        assert_eq!(merged["renewalExpiry"]["autoRenewEnabled"], true);
        assert_eq!(merged["creditsBenefits"]["rewardPointValuePaise"], 100);
        assert!(merged["renewalExpiry"].get("unknown").is_none());
        assert!(merged["creditsBenefits"].is_object());
        assert_eq!(merged["crossLocation"]["enabled"], true);
        assert_eq!(merged["crossLocation"]["scope"], "zone");
        assert!(validate_retention_settings(&merged).is_ok());
    }

    #[sqlx::test(migrations = false)]
    async fn membership_settings_save_reload_is_complete_and_tenant_scoped(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE membership_settings(tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,settings_json JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ,PRIMARY KEY(tenant_id,branch_id))",
        )
        .execute(&pool)
        .await
        .unwrap();
        let payload = json!({
            "membershipCatalog":{"membershipSalesEnabled":false},
            "crossLocation":{"enabled":true,"acceptInbound":true,"scope":"zone","allowDiscounts":false,"allowServiceCredits":true,"allowGiftCards":true,"allowLoyaltyPoints":true},
            "renewalExpiry":{"defaultValidityDays":180}
        });
        let saved = save_membership_settings(&pool, "tenant-1", "branch-1", &payload)
            .await
            .unwrap();
        let reloaded = membership_settings(&pool, "tenant-1", "branch-1")
            .await
            .unwrap();
        assert_eq!(reloaded, saved);
        assert_eq!(reloaded["crossLocation"]["scope"], "zone");
        assert_eq!(reloaded["crossLocation"]["allowGiftCards"], true);
        assert_eq!(reloaded["crossLocation"]["allowLoyaltyPoints"], true);
        assert_eq!(
            reloaded["membershipCatalog"]["membershipSalesEnabled"],
            false
        );
        assert_eq!(reloaded["renewalExpiry"]["defaultValidityDays"], 180);
        assert_eq!(
            membership_settings(&pool, "tenant-2", "branch-1")
                .await
                .unwrap()["crossLocation"]["enabled"],
            false
        );
    }

    #[sqlx::test(migrations = false)]
    async fn reward_adjustment_and_refund_reversal_are_idempotent(pool: PgPool) {
        for statement in [
            "CREATE TABLE clients (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL)",
            "CREATE TABLE membership_reward_ledger (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, client_id TEXT NOT NULL REFERENCES clients(id), source_sale_id TEXT NOT NULL DEFAULT '', transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earned','redeemed','reversed','adjusted')), points INTEGER NOT NULL, balance_after INTEGER NOT NULL CHECK (balance_after >= 0), expires_at DATE, staff_id TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE UNIQUE INDEX idx_membership_reward_ledger_sale_type ON membership_reward_ledger (tenant_id,branch_id,source_sale_id,transaction_type) WHERE source_sale_id <> ''",
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0086_loyalty_ledger_writers.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO clients VALUES ('client-1','tenant-1','branch-1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,source_sale_id,transaction_type,points,balance_after) VALUES ('tenant-1','branch-1','client-1','sale-1','earned',100,100)")
            .execute(&pool).await.unwrap();

        let adjustment = adjust_reward_balance(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            25,
            "Service recovery",
            "adjust-001",
            "owner-1",
        )
        .await
        .unwrap();
        let replay = adjust_reward_balance(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            25,
            "Service recovery",
            "adjust-001",
            "owner-1",
        )
        .await
        .unwrap();
        assert_eq!(adjustment.id, replay.id);

        for (refund_id, cumulative) in [
            ("refund-1", 5_000),
            ("refund-1", 5_000),
            ("refund-2", 10_000),
        ] {
            let mut tx = pool.begin().await.unwrap();
            reverse_rewards_for_refund(
                &mut tx, "tenant-1", "branch-1", "client-1", "staff-1", "sale-1", refund_id,
                cumulative, 10_000,
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }

        assert_eq!(
            sqlx::query_scalar::<_, i32>("SELECT balance_after FROM membership_reward_ledger WHERE client_id='client-1' ORDER BY created_at DESC,id DESC LIMIT 1")
                .fetch_one(&pool).await.unwrap(),
            25
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM membership_reward_ledger WHERE transaction_type='reversed'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            2
        );
        assert!(adjust_reward_balance(
            &pool,
            "tenant-1",
            "branch-1",
            "client-1",
            -30,
            "Invalid deduction",
            "adjust-002",
            "owner-1",
        )
        .await
        .is_err());
    }
}
