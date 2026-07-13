use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::membership_lifecycle_repository::{self, ActiveMembershipRecord},
    repositories::membership_repository::{
        self, CreateMembership, MembershipRecord, UpdateMembership,
    },
    repositories::{clients_repository, membership_advanced_repository},
};

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
) -> Result<membership_lifecycle_repository::SelfServiceRequestRecord, AppError> {
    if !matches!(request_type, "renew" | "cancel" | "upgrade" | "downgrade") {
        return Err(AppError::validation("invalid requestType"));
    }
    if matches!(request_type, "upgrade" | "downgrade")
        && target_membership_id.unwrap_or("").is_empty()
    {
        return Err(AppError::validation("targetMembershipId is required"));
    }
    membership_lifecycle_repository::create_self_service_request(
        db,
        tenant_id,
        branch_id,
        client_membership_id,
        request_type,
        target_membership_id,
        reason.trim(),
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
    let delta = (new_price - old_price).saturating_mul(remaining) / validity;
    (remaining as i32, delta.max(0), (-delta).max(0))
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
            code: input.code.as_deref().unwrap_or("").trim(),
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
    Ok(
        membership_advanced_repository::get_settings(db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load membership settings"))?
            .unwrap_or_else(default_membership_settings),
    )
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

pub async fn public_status(
    db: &PgPool,
    token: &str,
) -> Result<membership_advanced_repository::PublicMembershipStatusRecord, AppError> {
    membership_advanced_repository::public_status(db, token)
        .await
        .map_err(|_| AppError::internal("failed to load membership status"))?
        .ok_or_else(|| AppError::not_found("membership status link is invalid or expired"))
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
    Ok(
        json!({"metrics":{"activeMembers":summary.active_members,"expiredMembers":summary.expired_members,"cancelledMembers":summary.cancelled_members,"membershipSalesPaise":summary.membership_sales_paise,"creditLiability":summary.credit_liability,"redeemedCredits":summary.redeemed_credits,"expiringSoon":expiring},"memberships":memberships.into_iter().map(|item|json!({"id":item.id,"clientId":item.client_id,"clientName":item.client_name,"membershipId":item.membership_id,"membershipName":item.membership_name,"assignedAt":item.assigned_at,"expiresAt":item.expires_at,"active":item.active,"remainingCredits":item.remaining_credits,"autoRenewStatus":item.auto_renew_status})).collect::<Vec<_>>(),"ledger":ledger,"commission":commission,"risk":risk,"reminders":reminders,"autoRenew":auto_renew}),
    )
}

fn default_membership_settings() -> Value {
    json!({
        "membershipCatalog":{"membershipSalesEnabled":true,"visibleInPos":true,"visibleOnline":true,"freeMembershipEnabled":true,"paidMembershipEnabled":true},
        "creditsBenefits":{"serviceCreditsEnabled":true,"walletCreditsEnabled":true,"rewardPointsEnabled":true,"discountBenefitsEnabled":true,"allowBenefitStacking":false},
        "renewalExpiry":{"autoRenewEnabled":false,"expiryDaysEnabled":true,"defaultValidityDays":365,"renewalReminderDays":30,"expiredBenefitAction":"block"},
        "paymentBilling":{"allowDueOnMembershipSale":true,"membershipTaxApplicable":true,"taxInclusiveMembershipPrice":false,"invoiceMembershipSnapshot":true},
        "redemptionRules":{"blockRedemptionWhenExpired":true,"requireStaffConfirmation":true,"allowPartialCredits":true,"allowFamilySharing":true},
        "notificationsRisk":{"renewalReminder":true,"lowCreditReminder":true,"ownerAlertForHighBalance":true,"highBalanceThreshold":1000000},
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
        _ => defaults.clone(),
    }
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
    use super::{default_membership_settings, merge_known_settings, prorated_amounts};
    use chrono::{Duration, Utc};
    use serde_json::json;

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
    }

    #[test]
    fn membership_settings_keep_known_typed_values_only() {
        let merged = merge_known_settings(
            &default_membership_settings(),
            &json!({"renewalExpiry":{"defaultValidityDays":90,"autoRenewEnabled":true,"unknown":true},"creditsBenefits":"invalid"}),
        );
        assert_eq!(merged["renewalExpiry"]["defaultValidityDays"], 90);
        assert_eq!(merged["renewalExpiry"]["autoRenewEnabled"], true);
        assert!(merged["renewalExpiry"].get("unknown").is_none());
        assert!(merged["creditsBenefits"].is_object());
    }
}
