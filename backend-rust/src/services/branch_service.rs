use std::collections::HashSet;

use chrono::{Datelike, FixedOffset, NaiveDate, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::branch_repository::{self, BranchRecord, RoyaltyRuleInput},
    services::accounting_service,
};

const FRANCHISE_OVERRIDE_FIELDS: &[&str] = &[
    "name",
    "category",
    "durationMinutes",
    "pricePaise",
    "gstPercent",
    "sacCode",
    "waitTimeMinutes",
    "cleanupTimeMinutes",
    "bufferTimeMinutes",
    "active",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FranchiseControls {
    pub central_branch_id: String,
    pub allowed_override_fields: Vec<String>,
    pub override_options: &'static [&'static str],
    pub branches: Vec<BranchRecord>,
    pub central_masters: Vec<branch_repository::CentralServiceMasterRecord>,
    pub central_product_masters: Vec<branch_repository::CentralProductMasterRecord>,
    pub royalty_statements: Vec<branch_repository::RoyaltyStatementRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchConflict {
    pub kind: &'static str,
    pub branch_id: String,
    pub branch_name: String,
    pub severity: &'static str,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchCommandCenter {
    pub comparisons: Vec<branch_repository::BranchComparisonRecord>,
    pub conflicts: Vec<MultiBranchConflict>,
    pub approvals: Vec<branch_repository::MultiBranchApprovalRecord>,
    pub audit: Vec<branch_repository::MultiBranchAuditRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchApprovalDecision {
    pub approval: branch_repository::MultiBranchApprovalRecord,
    pub published: u64,
}

pub struct BranchUpdateInput {
    pub name: Option<String>,
    pub code: Option<String>,
    pub region_name: Option<String>,
    pub zone_name: Option<String>,
    pub cluster_name: Option<String>,
    pub address: Option<String>,
    pub latitude: Option<Option<f64>>,
    pub longitude: Option<Option<f64>>,
    pub booking_deposit_percent: Option<i32>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    query: Option<&str>,
) -> Result<Vec<BranchRecord>, AppError> {
    let query = query.unwrap_or("").trim();
    if query.chars().count() > 100 {
        return Err(AppError::validation(
            "branch search must be at most 100 characters",
        ));
    }
    branch_repository::list(db, tenant_id, query)
        .await
        .map_err(|_| AppError::internal("failed to load branches"))
}

pub async fn create(
    db: &PgPool,
    tenant_id: &str,
    name: String,
    code: String,
    region_name: String,
    zone_name: String,
    cluster_name: String,
    address: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    booking_deposit_percent: i32,
) -> Result<BranchRecord, AppError> {
    let name = normalize_name(&name)?;
    let code = normalize_code(&code)?;
    let (region_name, zone_name, cluster_name) =
        normalize_hierarchy(&region_name, &zone_name, &cluster_name)?;
    let address = normalize_address(&address)?;
    validate_coordinates(latitude, longitude)?;
    let booking_deposit_percent = normalize_deposit_percent(booking_deposit_percent)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start branch creation"))?;
    if !branch_repository::lock_tenant(&mut tx, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate tenant"))?
    {
        return Err(AppError::not_found("tenant was not found"));
    }
    let branch = branch_repository::create(
        &mut tx,
        tenant_id,
        &name,
        &code,
        &region_name,
        &zone_name,
        &cluster_name,
        &address,
        latitude,
        longitude,
        booking_deposit_percent,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::not_found("tenant was not found"))?;
    branch_repository::grant_management_access(&mut tx, tenant_id, &branch.id)
        .await
        .map_err(|_| AppError::internal("failed to grant branch access"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit branch creation"))?;
    Ok(branch)
}

pub async fn update(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    branch_id: &str,
    input: BranchUpdateInput,
) -> Result<BranchRecord, AppError> {
    let branch_id = branch_id.trim();
    if branch_id.is_empty() || branch_id.len() > 128 {
        return Err(AppError::validation("invalid branch id"));
    }
    if input.name.is_none()
        && input.code.is_none()
        && input.region_name.is_none()
        && input.zone_name.is_none()
        && input.cluster_name.is_none()
        && input.address.is_none()
        && input.latitude.is_none()
        && input.longitude.is_none()
        && input.booking_deposit_percent.is_none()
        && input.active.is_none()
    {
        return Err(AppError::validation(
            "at least one branch field is required",
        ));
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start branch update"))?;
    if !branch_repository::lock_tenant(&mut tx, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate tenant"))?
    {
        return Err(AppError::not_found("tenant was not found"));
    }
    let current = branch_repository::get_for_update(&mut tx, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load branch"))?
        .ok_or_else(|| AppError::not_found("branch was not found"))?;
    let name = input
        .name
        .as_deref()
        .map(normalize_name)
        .transpose()?
        .unwrap_or(current.name);
    let code = input
        .code
        .as_deref()
        .map(normalize_code)
        .transpose()?
        .unwrap_or(current.code);
    let (region_name, zone_name, cluster_name) = normalize_hierarchy(
        input.region_name.as_deref().unwrap_or(&current.region_name),
        input.zone_name.as_deref().unwrap_or(&current.zone_name),
        input
            .cluster_name
            .as_deref()
            .unwrap_or(&current.cluster_name),
    )?;
    let address = input
        .address
        .as_deref()
        .map(normalize_address)
        .transpose()?
        .unwrap_or(current.address);
    let latitude = input.latitude.unwrap_or(current.latitude);
    let longitude = input.longitude.unwrap_or(current.longitude);
    validate_coordinates(latitude, longitude)?;
    let booking_deposit_percent = normalize_deposit_percent(
        input
            .booking_deposit_percent
            .unwrap_or(current.booking_deposit_percent),
    )?;
    let active = input.active.unwrap_or(current.active);
    if current.active && !active {
        if branch_id == current_branch_id {
            return Err(AppError::conflict(
                "switch to another branch before deactivating this branch",
            ));
        }
        if branch_repository::active_count(&mut tx, tenant_id)
            .await
            .map_err(|_| AppError::internal("failed to validate active branches"))?
            <= 1
        {
            return Err(AppError::conflict(
                "the tenant must keep at least one active branch",
            ));
        }
    }
    let branch = branch_repository::update(
        &mut tx,
        tenant_id,
        branch_id,
        &name,
        &code,
        &region_name,
        &zone_name,
        &cluster_name,
        &address,
        latitude,
        longitude,
        booking_deposit_percent,
        active,
    )
    .await
    .map_err(map_write_error)?
    .ok_or_else(|| AppError::not_found("branch was not found"))?;
    if !current.active && branch.active {
        branch_repository::grant_management_access(&mut tx, tenant_id, &branch.id)
            .await
            .map_err(|_| AppError::internal("failed to restore branch access"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit branch update"))?;
    Ok(branch)
}

pub async fn franchise_controls(
    db: &PgPool,
    tenant_id: &str,
) -> Result<FranchiseControls, AppError> {
    let policy = branch_repository::franchise_policy(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load franchise policy"))?;
    let central_branch_id = policy
        .as_ref()
        .map(|item| item.central_branch_id.clone())
        .unwrap_or_default();
    let allowed_override_fields = policy
        .map(|item| item.allowed_override_fields)
        .unwrap_or_else(|| {
            vec![
                "pricePaise".into(),
                "durationMinutes".into(),
                "active".into(),
            ]
        });
    let branches = branch_repository::list(db, tenant_id, "")
        .await
        .map_err(|_| AppError::internal("failed to load franchise branches"))?;
    let central_masters = if central_branch_id.is_empty() {
        Vec::new()
    } else {
        branch_repository::central_service_masters(db, tenant_id, &central_branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load central masters"))?
    };
    let central_product_masters = if central_branch_id.is_empty() {
        Vec::new()
    } else {
        branch_repository::central_product_masters(db, tenant_id, &central_branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load central product masters"))?
    };
    let royalty_statements = branch_repository::royalty_statements(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load royalty statements"))?;
    Ok(FranchiseControls {
        central_branch_id,
        allowed_override_fields,
        override_options: FRANCHISE_OVERRIDE_FIELDS,
        branches,
        central_masters,
        central_product_masters,
        royalty_statements,
    })
}

pub async fn save_franchise_controls(
    db: &PgPool,
    tenant_id: &str,
    actor: &str,
    central_branch_id: &str,
    allowed_override_fields: Vec<String>,
    royalty_rules: Vec<RoyaltyRuleInput>,
) -> Result<FranchiseControls, AppError> {
    let central_branch_id = central_branch_id.trim();
    if central_branch_id.is_empty() || central_branch_id.len() > 128 {
        return Err(AppError::validation("central branch is required"));
    }
    let allowed_override_fields = normalize_override_fields(allowed_override_fields)?;
    if royalty_rules.len() > 500 {
        return Err(AppError::validation("too many royalty rules"));
    }
    let mut branch_ids = HashSet::new();
    for rule in &royalty_rules {
        if rule.branch_id.trim().is_empty()
            || !branch_ids.insert(rule.branch_id.trim().to_string())
            || !(0..=10_000).contains(&rule.royalty_bps)
            || rule.minimum_paise < 0
        {
            return Err(AppError::validation("royalty rule is invalid"));
        }
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start franchise update"))?;
    if !branch_repository::branch_in_tenant(&mut tx, tenant_id, central_branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate central branch"))?
    {
        return Err(AppError::not_found("central branch was not found"));
    }
    branch_repository::save_franchise_policy(
        &mut tx,
        tenant_id,
        central_branch_id,
        &allowed_override_fields,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save franchise policy"))?;
    let updated = branch_repository::save_royalty_rules(&mut tx, tenant_id, &royalty_rules)
        .await
        .map_err(|_| AppError::internal("failed to save royalty rules"))?;
    if updated != royalty_rules.len() as u64 {
        return Err(AppError::validation(
            "a royalty branch is outside this tenant",
        ));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit franchise update"))?;
    franchise_controls(db, tenant_id).await
}

pub async fn multi_branch_command_center(
    db: &PgPool,
    tenant_id: &str,
) -> Result<MultiBranchCommandCenter, AppError> {
    let comparisons = branch_repository::branch_comparison(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load branch comparison"))?;
    let policy = branch_repository::franchise_policy(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load franchise policy"))?;
    let approvals = branch_repository::multi_branch_approvals(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load branch approvals"))?;
    let audit = branch_repository::multi_branch_audit(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load branch audit"))?;
    let conflicts = multi_branch_conflicts(&comparisons, policy.is_some());
    Ok(MultiBranchCommandCenter {
        comparisons,
        conflicts,
        approvals,
        audit,
    })
}

pub async fn request_multi_branch_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    session_id: Option<&str>,
    note: &str,
) -> Result<branch_repository::MultiBranchApprovalRecord, AppError> {
    let note = note.trim();
    if note.chars().count() > 500 {
        return Err(AppError::validation("approval note is too long"));
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start branch approval"))?;
    branch_repository::franchise_policy_for_update(&mut tx, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load franchise policy"))?
        .ok_or_else(|| AppError::conflict("configure a central branch first"))?;
    let approval =
        branch_repository::create_multi_branch_approval(&mut tx, tenant_id, branch_id, actor, note)
            .await
            .map_err(|error| {
                if error
                    .as_database_error()
                    .and_then(|value| value.code())
                    .as_deref()
                    == Some("23505")
                {
                    AppError::conflict("a central master publish approval is already pending")
                } else {
                    AppError::internal("failed to request branch approval")
                }
            })?;
    branch_repository::audit_multi_branch(
        &mut tx,
        tenant_id,
        branch_id,
        actor,
        session_id,
        "multi_branch.approval.requested",
        json!({"approvalId": approval.id, "action": approval.action}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit branch approval"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit branch approval"))?;
    Ok(approval)
}

pub async fn decide_multi_branch_approval(
    db: &PgPool,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    session_id: Option<&str>,
    id: &str,
    version: i32,
    decision: &str,
    note: &str,
) -> Result<MultiBranchApprovalDecision, AppError> {
    let id = id.trim();
    let decision = decision.trim().to_ascii_lowercase();
    let note = note.trim();
    if id.is_empty() || id.len() > 128 || version < 1 {
        return Err(AppError::validation("invalid approval request"));
    }
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation("approval decision is invalid"));
    }
    if note.chars().count() > 500 {
        return Err(AppError::validation("decision note is too long"));
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start approval decision"))?;
    let current = branch_repository::multi_branch_approval_for_update(&mut tx, tenant_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load branch approval"))?
        .ok_or_else(|| AppError::not_found("branch approval was not found"))?;
    if current.status != "pending" || current.version != version {
        return Err(AppError::conflict(
            "branch approval changed before decision",
        ));
    }
    let published = if decision == "approved" {
        let policy = branch_repository::franchise_policy_for_update(&mut tx, tenant_id)
            .await
            .map_err(|_| AppError::internal("failed to load franchise policy"))?
            .ok_or_else(|| AppError::conflict("configure a central branch first"))?;
        branch_repository::publish_central_services(&mut tx, tenant_id, &policy.central_branch_id)
            .await
            .map_err(|_| AppError::internal("failed to publish central masters"))?
    } else {
        0
    };
    let approval = branch_repository::decide_multi_branch_approval(
        &mut tx, tenant_id, id, version, &decision, actor, note,
    )
    .await
    .map_err(|_| AppError::internal("failed to decide branch approval"))?
    .ok_or_else(|| AppError::conflict("branch approval changed before decision"))?;
    branch_repository::audit_multi_branch(
        &mut tx,
        tenant_id,
        current_branch_id,
        actor,
        session_id,
        if decision == "approved" {
            "multi_branch.approval.approved"
        } else {
            "multi_branch.approval.rejected"
        },
        json!({"approvalId": approval.id, "action": approval.action, "published": published}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit approval decision"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit approval decision"))?;
    Ok(MultiBranchApprovalDecision {
        approval,
        published,
    })
}

fn multi_branch_conflicts(
    comparisons: &[branch_repository::BranchComparisonRecord],
    central_configured: bool,
) -> Vec<MultiBranchConflict> {
    let mut conflicts = Vec::new();
    if !central_configured {
        conflicts.push(MultiBranchConflict {
            kind: "central_branch_missing",
            branch_id: String::new(),
            branch_name: "Network".into(),
            severity: "high",
            message: "Central branch is not configured".into(),
        });
    }
    let sharing_enabled = comparisons
        .iter()
        .any(|branch| branch.active && branch.sharing_enabled);
    for branch in comparisons.iter().filter(|branch| branch.active) {
        if branch.region_name.trim().is_empty() {
            conflicts.push(MultiBranchConflict {
                kind: "hierarchy_missing",
                branch_id: branch.branch_id.clone(),
                branch_name: branch.branch_name.clone(),
                severity: "medium",
                message: "Branch region is not configured".into(),
            });
        }
        if branch.service_sync_gap > 0 || branch.product_sync_gap > 0 {
            conflicts.push(MultiBranchConflict {
                kind: "master_sync_gap",
                branch_id: branch.branch_id.clone(),
                branch_name: branch.branch_name.clone(),
                severity: "high",
                message: format!(
                    "{} service and {} product masters are not synchronized",
                    branch.service_sync_gap, branch.product_sync_gap
                ),
            });
        }
        if sharing_enabled && !branch.accept_inbound {
            conflicts.push(MultiBranchConflict {
                kind: "sharing_inbound_disabled",
                branch_id: branch.branch_id.clone(),
                branch_name: branch.branch_name.clone(),
                severity: "medium",
                message: "Inbound membership benefits are disabled".into(),
            });
        }
    }
    conflicts
}

pub async fn publish_central_masters(db: &PgPool, tenant_id: &str) -> Result<u64, AppError> {
    let policy = branch_repository::franchise_policy(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load franchise policy"))?
        .ok_or_else(|| AppError::conflict("configure a central branch first"))?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start central publish"))?;
    if !branch_repository::branch_in_tenant(&mut tx, tenant_id, &policy.central_branch_id)
        .await
        .map_err(|_| AppError::internal("failed to validate central branch"))?
    {
        return Err(AppError::conflict("central branch is inactive or missing"));
    }
    let published =
        branch_repository::publish_central_services(&mut tx, tenant_id, &policy.central_branch_id)
            .await
            .map_err(|_| AppError::internal("failed to publish central masters"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit central publish"))?;
    Ok(published)
}

pub async fn generate_royalties(
    db: &PgPool,
    tenant_id: &str,
    actor: &str,
    period_start: NaiveDate,
) -> Result<usize, AppError> {
    validate_royalty_period(period_start)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start royalty generation"))?;
    let statements =
        branch_repository::create_royalty_drafts(&mut tx, tenant_id, period_start, actor)
            .await
            .map_err(|_| AppError::internal("failed to calculate royalties"))?;
    for statement in &statements {
        let journal_id = accounting_service::post_royalty_accrual(
            &mut tx,
            tenant_id,
            &statement.branch_id,
            &statement.id,
            period_start,
            statement.royalty_paise,
            actor,
        )
        .await?
        .ok_or_else(|| AppError::conflict("royalty statement was already posted"))?;
        branch_repository::mark_royalty_posted(&mut tx, tenant_id, &statement.id, &journal_id)
            .await
            .map_err(|_| AppError::internal("failed to post royalty statement"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit royalty generation"))?;
    Ok(statements.len())
}

pub async fn pay_royalty(
    db: &PgPool,
    tenant_id: &str,
    actor: &str,
    statement_id: &str,
    payment_method: &str,
) -> Result<branch_repository::RoyaltyStatementRecord, AppError> {
    let payment_method = match payment_method.trim().to_ascii_lowercase().as_str() {
        "cash" => "cash",
        "bank" | "bank_transfer" => "bank_transfer",
        _ => return Err(AppError::validation("royalty payment method is invalid")),
    };
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start royalty payment"))?;
    let statement = branch_repository::royalty_for_update(&mut tx, tenant_id, statement_id)
        .await
        .map_err(|_| AppError::internal("failed to load royalty statement"))?
        .ok_or_else(|| AppError::not_found("royalty statement was not found"))?;
    if statement.status == "paid" {
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to finish royalty payment"))?;
        return Ok(statement);
    }
    if statement.status != "posted" {
        return Err(AppError::conflict("royalty statement is not posted"));
    }
    let journal_id = accounting_service::post_royalty_payment(
        &mut tx,
        tenant_id,
        &statement.branch_id,
        &statement.id,
        Utc::now().date_naive(),
        statement.royalty_paise,
        payment_method,
        actor,
    )
    .await?
    .ok_or_else(|| AppError::conflict("royalty payment was already posted"))?;
    branch_repository::mark_royalty_paid(&mut tx, tenant_id, &statement.id, &journal_id, actor)
        .await
        .map_err(|_| AppError::internal("failed to mark royalty paid"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit royalty payment"))?;
    branch_repository::royalty_statements(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to reload royalty statement"))?
        .into_iter()
        .find(|item| item.id == statement.id)
        .ok_or_else(|| AppError::not_found("royalty statement was not found"))
}

fn normalize_override_fields(fields: Vec<String>) -> Result<Vec<String>, AppError> {
    let mut normalized = fields
        .into_iter()
        .map(|field| field.trim().to_string())
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    if normalized
        .iter()
        .any(|field| !FRANCHISE_OVERRIDE_FIELDS.contains(&field.as_str()))
    {
        return Err(AppError::validation("franchise override field is invalid"));
    }
    Ok(normalized)
}

fn validate_royalty_period(period_start: NaiveDate) -> Result<(), AppError> {
    let india = FixedOffset::east_opt(19_800)
        .ok_or_else(|| AppError::internal("failed to calculate royalty period"))?;
    let today = Utc::now().with_timezone(&india).date_naive();
    let current_month = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
        .ok_or_else(|| AppError::internal("failed to calculate current month"))?;
    if period_start.day() != 1
        || period_start > current_month
        || period_start < current_month - chrono::Duration::days(1_100)
    {
        return Err(AppError::validation(
            "royalty period must be a recent month start",
        ));
    }
    Ok(())
}

fn normalize_address(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.chars().count() > 300 || value.chars().any(char::is_control) {
        return Err(AppError::validation(
            "branch address must be at most 300 characters",
        ));
    }
    Ok(value.to_string())
}

fn validate_coordinates(latitude: Option<f64>, longitude: Option<f64>) -> Result<(), AppError> {
    if latitude.is_some() != longitude.is_some()
        || latitude.is_some_and(|value| !(-90.0..=90.0).contains(&value))
        || longitude.is_some_and(|value| !(-180.0..=180.0).contains(&value))
    {
        return Err(AppError::validation(
            "latitude and longitude must both be valid coordinates",
        ));
    }
    Ok(())
}

fn normalize_deposit_percent(value: i32) -> Result<i32, AppError> {
    (0..=100)
        .contains(&value)
        .then_some(value)
        .ok_or_else(|| AppError::validation("booking deposit percent must be between 0 and 100"))
}

fn normalize_name(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if !(2..=100).contains(&value.chars().count()) || value.chars().any(char::is_control) {
        return Err(AppError::validation(
            "branch name must be between 2 and 100 characters",
        ));
    }
    Ok(value.to_string())
}

fn normalize_code(value: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_uppercase();
    if !(2..=24).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::validation(
            "branch code must be 2 to 24 letters, numbers, hyphens, or underscores",
        ));
    }
    Ok(value)
}

fn normalize_hierarchy(
    region_name: &str,
    zone_name: &str,
    cluster_name: &str,
) -> Result<(String, String, String), AppError> {
    let normalize = |value: &str| {
        let value = value.trim();
        if value.chars().count() > 100 || value.chars().any(char::is_control) {
            Err(AppError::validation(
                "region, zone and cluster names must be at most 100 characters",
            ))
        } else {
            Ok(value.to_string())
        }
    };
    let region_name = normalize(region_name)?;
    let zone_name = normalize(zone_name)?;
    let cluster_name = normalize(cluster_name)?;
    if (!zone_name.is_empty() && region_name.is_empty())
        || (!cluster_name.is_empty() && zone_name.is_empty())
    {
        return Err(AppError::validation(
            "zone requires a region and cluster requires a zone",
        ));
    }
    Ok((region_name, zone_name, cluster_name))
}

fn map_write_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|database_error| database_error.is_unique_violation())
    {
        AppError::conflict("branch code already exists")
    } else {
        AppError::internal("failed to save branch")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decide_multi_branch_approval, normalize_code, normalize_deposit_percent,
        normalize_hierarchy, normalize_name, normalize_override_fields,
        request_multi_branch_approval, validate_coordinates,
    };
    use crate::repositories::branch_repository;
    use sqlx::PgPool;

    #[test]
    fn branch_identity_is_normalized_and_validated() {
        assert_eq!(normalize_name("  Enrich Mumbai ").unwrap(), "Enrich Mumbai");
        assert_eq!(normalize_code(" br-001 ").unwrap(), "BR-001");
        assert!(normalize_code("bad code").is_err());
        assert!(normalize_hierarchy("West", "Mumbai", "Central").is_ok());
        assert!(normalize_hierarchy("", "Mumbai", "").is_err());
        assert!(validate_coordinates(Some(19.076), Some(72.8777)).is_ok());
        assert!(validate_coordinates(Some(91.0), Some(72.8777)).is_err());
        assert!(normalize_deposit_percent(25).is_ok());
        assert!(normalize_deposit_percent(101).is_err());
        assert_eq!(
            normalize_override_fields(vec!["pricePaise".into(), "pricePaise".into()]).unwrap(),
            vec!["pricePaise"]
        );
        assert!(normalize_override_fields(vec!["unknown".into()]).is_err());
    }

    #[sqlx::test(migrations = false)]
    async fn multi_branch_approval_is_tenant_scoped_and_atomic(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
            CREATE TABLE tenants(id TEXT PRIMARY KEY,scope_id TEXT NOT NULL DEFAULT '');
            CREATE TABLE branches(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,scope_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE);
            CREATE TABLE franchise_policies(tenant_id TEXT PRIMARY KEY,central_branch_id TEXT NOT NULL,allowed_override_fields TEXT[] NOT NULL DEFAULT '{}',created_by TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
            CREATE TABLE services(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',duration_minutes INTEGER NOT NULL DEFAULT 0,price_paise INTEGER NOT NULL DEFAULT 0,gst_percent INTEGER NOT NULL DEFAULT 0,sac_code TEXT NOT NULL DEFAULT '',wait_time_minutes INTEGER NOT NULL DEFAULT 0,cleanup_time_minutes INTEGER NOT NULL DEFAULT 0,buffer_time_minutes INTEGER NOT NULL DEFAULT 0,product_consumption_json JSONB NOT NULL DEFAULT '[]',active BOOLEAN NOT NULL DEFAULT TRUE,central_master_service_id TEXT,franchise_override_fields TEXT[] NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ);
            CREATE UNIQUE INDEX uq_test_service_master ON services(tenant_id,branch_id,central_master_service_id) WHERE central_master_service_id IS NOT NULL;
            CREATE TABLE inventory_items(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sku TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT 'pcs',stock_quantity INTEGER NOT NULL DEFAULT 0,reorder_point INTEGER NOT NULL DEFAULT 0,unit_cost_paise BIGINT NOT NULL DEFAULT 0,hsn_code TEXT NOT NULL DEFAULT '',gst_percent INTEGER NOT NULL DEFAULT 0,barcode TEXT NOT NULL DEFAULT '',batch_tracked BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,central_master_item_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ);
            CREATE UNIQUE INDEX uq_test_item_master ON inventory_items(tenant_id,branch_id,central_master_item_id) WHERE central_master_item_id IS NOT NULL;
            CREATE TABLE auth_audit_logs(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,user_id TEXT,session_id TEXT,branch_id TEXT,event_type TEXT NOT NULL,outcome TEXT NOT NULL,details_json JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0172_multi_branch_command_center.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(
            r#"
            INSERT INTO tenants VALUES('tenant-1',''),('tenant-2','');
            INSERT INTO branches VALUES('central-1','tenant-1','','Central 1',TRUE),('target-1','tenant-1','','Target 1',TRUE),('central-2','tenant-2','','Central 2',TRUE),('target-2','tenant-2','','Target 2',TRUE);
            INSERT INTO franchise_policies(tenant_id,central_branch_id,created_by,updated_by) VALUES('tenant-1','central-1','owner-1','owner-1'),('tenant-2','central-2','owner-2','owner-2');
            INSERT INTO services(id,tenant_id,branch_id,name) VALUES('service-1','tenant-1','central-1','Hair Cut');
            INSERT INTO inventory_items(id,tenant_id,branch_id,sku,name) VALUES('item-1','tenant-1','central-1','SKU-1','Shampoo');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let tenant_one =
            request_multi_branch_approval(&pool, "tenant-1", "central-1", "owner-1", None, "")
                .await
                .unwrap();
        request_multi_branch_approval(&pool, "tenant-2", "central-2", "owner-2", None, "")
            .await
            .unwrap();
        let tenant_one_rows = branch_repository::multi_branch_approvals(&pool, "tenant-1")
            .await
            .unwrap();
        assert_eq!(tenant_one_rows.len(), 1);
        assert_eq!(tenant_one_rows[0].id, tenant_one.id);

        sqlx::query("DROP TABLE auth_audit_logs")
            .execute(&pool)
            .await
            .unwrap();
        assert!(decide_multi_branch_approval(
            &pool,
            "tenant-1",
            "central-1",
            "owner-1",
            None,
            &tenant_one.id,
            tenant_one.version,
            "approved",
            "",
        )
        .await
        .is_err());
        let status: String = sqlx::query_scalar(
            "SELECT status FROM multi_branch_approvals WHERE tenant_id='tenant-1' AND id=$1",
        )
        .bind(&tenant_one.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let linked: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM services WHERE tenant_id='tenant-1' AND branch_id='target-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(linked, 0);

        sqlx::query("CREATE TABLE auth_audit_logs(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,user_id TEXT,session_id TEXT,branch_id TEXT,event_type TEXT NOT NULL,outcome TEXT NOT NULL,details_json JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
            .execute(&pool).await.unwrap();
        let decided = decide_multi_branch_approval(
            &pool,
            "tenant-1",
            "central-1",
            "owner-1",
            None,
            &tenant_one.id,
            tenant_one.version,
            "approved",
            "",
        )
        .await
        .unwrap();
        assert_eq!(decided.approval.status, "approved");
        assert_eq!(decided.published, 2);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM services WHERE tenant_id='tenant-1' AND branch_id='target-1' AND central_master_service_id='service-1'")
                .fetch_one(&pool).await.unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM auth_audit_logs WHERE tenant_id='tenant-1' AND event_type='multi_branch.approval.approved'")
                .fetch_one(&pool).await.unwrap(),
            1
        );
    }
}
