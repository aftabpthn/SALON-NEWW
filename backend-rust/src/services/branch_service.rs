use std::collections::HashSet;

use chrono::{Datelike, FixedOffset, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::branch_repository::{self, BranchRecord, RoyaltyRuleInput},
    services::{accounting_service, entitlement_service},
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
    "sku",
    "unit",
    "hsnCode",
    "barcode",
    "batchTracked",
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
    pub range_start: NaiveDate,
    pub range_end: NaiveDate,
    pub summary: MultiBranchSummary,
    pub comparisons: Vec<branch_repository::BranchComparisonRecord>,
    pub conflicts: Vec<MultiBranchConflict>,
    pub approvals: Vec<branch_repository::MultiBranchApprovalRecord>,
    pub audit: Vec<branch_repository::MultiBranchAuditRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiBranchSummary {
    pub branch_count: usize,
    pub active_branch_count: usize,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub refund_paise: i64,
    pub tip_paise: i64,
    pub average_ticket_paise: i64,
    pub sale_count: i64,
    pub appointment_count: i64,
    pub lost_appointment_count: i64,
    pub booked_minutes: i64,
    pub scheduled_minutes: i64,
    pub utilization_bps: i64,
    pub void_count: i64,
    pub cash_variance_paise: i64,
    pub open_till_count: i64,
    pub transfer_count: i64,
    pub shortage_count: i64,
    pub inventory_value_paise: i64,
    pub membership_liability_paise: i64,
    pub membership_redeemed_paise: i64,
    pub cross_location_redeemed_paise: i64,
    pub gift_card_liability_paise: i64,
    pub loyalty_points_balance: i64,
    pub shared_customer_count: i64,
    pub royalty_outstanding_paise: i64,
    pub sync_gap_count: i64,
    pub pending_approval_count: usize,
    pub conflict_count: usize,
}

#[derive(Debug, Default)]
pub struct MultiBranchFilterInput {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub region: Option<String>,
    pub zone: Option<String>,
    pub cluster: Option<String>,
    pub branch_id: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPage {
    pub items: Vec<BranchRecord>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchBulkFailure {
    pub row: usize,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchBulkPreview {
    pub total_rows: usize,
    pub valid_rows: usize,
    pub invalid_rows: usize,
    pub failures: Vec<BranchBulkFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchBulkImportResult {
    pub import_id: String,
    pub created_count: usize,
    pub branches: Vec<BranchRecord>,
    pub mode: String,
    pub failures: Vec<BranchBulkFailure>,
    pub replayed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BranchBulkImportMode {
    FullRollback,
    Partial,
}

impl BranchBulkImportMode {
    pub(crate) fn parse(value: Option<&str>) -> Result<Self, AppError> {
        match value.unwrap_or("full").trim().to_ascii_lowercase().as_str() {
            "partial" => Ok(Self::Partial),
            "full" => Ok(Self::FullRollback),
            "" => Ok(Self::FullRollback),
            value => Err(AppError::validation(format!(
                "unsupported branch import mode: {value}"
            ))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::FullRollback => "full",
            Self::Partial => "partial",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BranchCsvRow {
    #[serde(default)]
    name: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    region_name: String,
    #[serde(default)]
    zone_name: String,
    #[serde(default)]
    cluster_name: String,
    #[serde(default)]
    address: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    booking_deposit_percent: Option<i32>,
}

struct PreparedBranch {
    row: usize,
    name: String,
    code: String,
    region_name: String,
    zone_name: String,
    cluster_name: String,
    address: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    booking_deposit_percent: i32,
}

struct PreparedBranchBulk {
    total_rows: usize,
    branches: Vec<PreparedBranch>,
    failures: Vec<BranchBulkFailure>,
}

const BRANCH_IMPORT_TEMPLATE: &str =
    "name,code,regionName,zoneName,clusterName,address,latitude,longitude,bookingDepositPercent\n";
const MAX_BRANCH_IMPORT_BYTES: usize = 2 * 1024 * 1024;
const MAX_BRANCH_IMPORT_ROWS: usize = 1000;

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

pub async fn list_page(
    db: &PgPool,
    tenant_id: &str,
    query: Option<&str>,
    cursor: Option<&str>,
    limit: Option<i64>,
) -> Result<BranchPage, AppError> {
    let query = query.unwrap_or("").trim();
    if query.chars().count() > 100 {
        return Err(AppError::validation(
            "branch search must be at most 100 characters",
        ));
    }
    let cursor = cursor
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(uuid::Uuid::parse_str)
        .transpose()
        .map_err(|_| AppError::validation("invalid branch cursor"))?
        .map(|value| value.to_string());
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let mut items =
        branch_repository::list_page(db, tenant_id, query, cursor.as_deref(), limit + 1)
            .await
            .map_err(|_| AppError::internal("failed to load branches"))?;
    let next_cursor = (items.len() as i64 > limit).then(|| {
        items.truncate(limit as usize);
        items.last().map(|item| item.id.clone())
    });
    Ok(BranchPage {
        items,
        next_cursor: next_cursor.flatten(),
    })
}

pub fn branch_import_template() -> &'static str {
    BRANCH_IMPORT_TEMPLATE
}

pub async fn preview_bulk(
    db: &PgPool,
    tenant_id: &str,
    csv_bytes: &[u8],
) -> Result<BranchBulkPreview, AppError> {
    let mut prepared = parse_bulk_csv(csv_bytes)?;
    let existing = branch_repository::existing_branch_keys(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate existing branches"))?;
    reject_existing_branches(&mut prepared, &existing);
    if !prepared.branches.is_empty() {
        entitlement_service::ensure_can_create_branches(
            db,
            tenant_id,
            prepared.branches.len() as i64,
        )
        .await?;
    }
    Ok(bulk_preview(&prepared))
}

#[allow(clippy::too_many_arguments)]
pub async fn import_bulk(
    db: &PgPool,
    tenant_id: &str,
    requested_from_branch_id: &str,
    actor_user_id: &str,
    idempotency_key: &str,
    mode: BranchBulkImportMode,
    csv_bytes: &[u8],
) -> Result<BranchBulkImportResult, AppError> {
    let idempotency_key = normalize_idempotency_key(idempotency_key)?;
    let request_fingerprint = format!("{:x}", Sha256::digest(csv_bytes));
    let mut prepared = parse_bulk_csv(csv_bytes)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start branch import"))?;
    branch_repository::lock_bulk_import_key(&mut tx, tenant_id, &idempotency_key)
        .await
        .map_err(|_| AppError::internal("failed to lock branch import"))?;
    if let Some(replay) =
        branch_repository::bulk_import_replay(&mut tx, tenant_id, &idempotency_key)
            .await
            .map_err(|_| AppError::internal("failed to validate branch import replay"))?
    {
        if replay.request_fingerprint != request_fingerprint {
            return Err(AppError::conflict(
                "idempotency key was already used with different CSV content",
            ));
        }
        if replay.import_mode.as_str() != mode.as_str() {
            return Err(AppError::conflict(
                "idempotency key was already used with different import mode",
            ));
        }
        let mut result: BranchBulkImportResult = serde_json::from_value(replay.result_json)
            .map_err(|_| AppError::internal("stored branch import result is invalid"))?;
        result.replayed = true;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to finish branch import replay"))?;
        return Ok(result);
    }
    if !branch_repository::lock_tenant(&mut tx, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate tenant"))?
    {
        return Err(AppError::not_found("tenant was not found"));
    }
    let existing = branch_repository::existing_branch_keys_tx(&mut tx, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to validate existing branches"))?;
    reject_existing_branches(&mut prepared, &existing);
    if mode == BranchBulkImportMode::FullRollback && !prepared.failures.is_empty() {
        return Err(AppError::validation("CSV contains invalid branch rows")
            .with_details(json!(bulk_preview(&prepared))));
    }

    if prepared.branches.is_empty() {
        return Ok(BranchBulkImportResult {
            import_id: uuid::Uuid::new_v4().to_string(),
            created_count: 0,
            branches: Vec::new(),
            mode: mode.as_str().to_string(),
            failures: prepared.failures,
            replayed: false,
        });
    }

    entitlement_service::ensure_can_create_branches_tx(
        &mut tx,
        tenant_id,
        prepared.branches.len() as i64,
    )
    .await?;

    let mut branches = Vec::with_capacity(prepared.branches.len());
    for row in prepared.branches {
        let created = if mode == BranchBulkImportMode::Partial {
            branch_repository::create_if_not_exists(
                &mut tx,
                tenant_id,
                &row.name,
                &row.code,
                &row.region_name,
                &row.zone_name,
                &row.cluster_name,
                &row.address,
                row.latitude,
                row.longitude,
                row.booking_deposit_percent,
            )
            .await
            .map_err(map_write_error)?
        } else {
            branch_repository::create(
                &mut tx,
                tenant_id,
                &row.name,
                &row.code,
                &row.region_name,
                &row.zone_name,
                &row.cluster_name,
                &row.address,
                row.latitude,
                row.longitude,
                row.booking_deposit_percent,
            )
            .await
            .map_err(map_write_error)?
        };

        let branch = match created {
            Some(branch) => branch,
            None => {
                if mode == BranchBulkImportMode::Partial {
                    prepared.failures.push(BranchBulkFailure {
                        row: row.row,
                        code: "CODE_EXISTS".into(),
                        message: format!("branch code {} already exists", row.code),
                    });
                    continue;
                }
                return Err(AppError::not_found("tenant was not found"));
            }
        };

        branch_repository::grant_management_access(&mut tx, tenant_id, &branch.id)
            .await
            .map_err(|_| AppError::internal("failed to grant branch access"))?;
        branches.push(branch);
    }
    let import_id = uuid::Uuid::new_v4().to_string();
    let result = BranchBulkImportResult {
        import_id: import_id.clone(),
        created_count: branches.len(),
        branches,
        mode: mode.as_str().to_string(),
        failures: prepared.failures,
        replayed: false,
    };
    let result_json = serde_json::to_value(&result)
        .map_err(|_| AppError::internal("failed to save branch import result"))?;
    if !branch_repository::save_bulk_import(
        &mut tx,
        &import_id,
        tenant_id,
        requested_from_branch_id,
        &idempotency_key,
        mode.as_str(),
        &request_fingerprint,
        prepared.total_rows as i32,
        result.created_count as i32,
        &result_json,
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save branch import"))?
    {
        return Err(AppError::not_found("current branch was not found"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit branch import"))?;
    Ok(result)
}

pub fn branch_failure_report_csv(failures: &[BranchBulkFailure]) -> Result<String, AppError> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(["row", "code", "message"])
        .map_err(|_| AppError::internal("failed to create branch failure report"))?;
    for failure in failures {
        writer
            .write_record([
                failure.row.to_string(),
                failure.code.clone(),
                failure.message.clone(),
            ])
            .map_err(|_| AppError::internal("failed to create branch failure report"))?;
    }
    String::from_utf8(
        writer
            .into_inner()
            .map_err(|_| AppError::internal("failed to finish branch failure report"))?,
    )
    .map_err(|_| AppError::internal("failed to encode branch failure report"))
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
    entitlement_service::ensure_can_create_branch(&mut tx, tenant_id).await?;
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
    if !current.active && active {
        entitlement_service::ensure_can_create_branch(&mut tx, tenant_id).await?;
    }
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

pub async fn franchise_controls_scoped(
    db: &PgPool,
    tenant_id: &str,
    actor_user_id: &str,
    unrestricted: bool,
) -> Result<FranchiseControls, AppError> {
    let mut controls = franchise_controls(db, tenant_id).await?;
    if unrestricted {
        return Ok(controls);
    }
    let visible = branch_repository::accessible_branch_ids(db, tenant_id, actor_user_id)
        .await
        .map_err(|_| AppError::internal("failed to load assigned branches"))?
        .into_iter()
        .collect::<HashSet<_>>();
    controls
        .branches
        .retain(|branch| visible.contains(&branch.id));
    controls
        .royalty_statements
        .retain(|statement| visible.contains(&statement.branch_id));
    Ok(controls)
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
    actor_user_id: &str,
    unrestricted: bool,
    input: MultiBranchFilterInput,
) -> Result<MultiBranchCommandCenter, AppError> {
    let (range_start, range_end, region, zone, cluster, branch_id) =
        normalize_multi_branch_filters(input)?;
    let comparisons = branch_repository::branch_comparison(
        db,
        tenant_id,
        range_start,
        range_end,
        &region,
        &zone,
        &cluster,
        &branch_id,
        actor_user_id,
        unrestricted,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch comparison"))?;
    let policy = branch_repository::franchise_policy(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load franchise policy"))?;
    let approvals =
        branch_repository::multi_branch_approvals(db, tenant_id, actor_user_id, unrestricted)
            .await
            .map_err(|_| AppError::internal("failed to load branch approvals"))?;
    let audit = branch_repository::multi_branch_audit(db, tenant_id, actor_user_id, unrestricted)
        .await
        .map_err(|_| AppError::internal("failed to load branch audit"))?;
    let conflicts = multi_branch_conflicts(&comparisons, policy.is_some());
    let sale_count = comparisons.iter().fold(0_i64, |total, branch| {
        total.saturating_add(branch.sale_count)
    });
    let revenue_paise = comparisons.iter().fold(0_i64, |total, branch| {
        total.saturating_add(branch.revenue_paise)
    });
    let booked_minutes = comparisons.iter().fold(0_i64, |total, branch| {
        total.saturating_add(branch.booked_minutes)
    });
    let scheduled_minutes = comparisons.iter().fold(0_i64, |total, branch| {
        total.saturating_add(branch.scheduled_minutes)
    });
    let summary = MultiBranchSummary {
        branch_count: comparisons.len(),
        active_branch_count: comparisons.iter().filter(|branch| branch.active).count(),
        revenue_paise,
        discount_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.discount_paise)
        }),
        tax_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.tax_paise)
        }),
        refund_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.refund_paise)
        }),
        tip_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.tip_paise)
        }),
        average_ticket_paise: if sale_count == 0 {
            0
        } else {
            revenue_paise / sale_count
        },
        sale_count,
        appointment_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.appointment_count)
        }),
        lost_appointment_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.lost_appointment_count)
        }),
        booked_minutes,
        scheduled_minutes,
        utilization_bps: if scheduled_minutes == 0 {
            0
        } else {
            booked_minutes
                .saturating_mul(10_000)
                .saturating_div(scheduled_minutes)
                .min(10_000)
        },
        void_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.void_count)
        }),
        cash_variance_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.cash_variance_paise)
        }),
        open_till_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.open_till_count)
        }),
        transfer_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.transfer_count)
        }),
        shortage_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.shortage_count)
        }),
        inventory_value_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.inventory_value_paise)
        }),
        membership_liability_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.membership_liability_paise)
        }),
        membership_redeemed_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.membership_redeemed_paise)
        }),
        cross_location_redeemed_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.cross_location_redeemed_paise)
        }),
        gift_card_liability_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.gift_card_liability_paise)
        }),
        loyalty_points_balance: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.loyalty_points_balance)
        }),
        shared_customer_count: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.shared_customer_count)
        }),
        royalty_outstanding_paise: comparisons.iter().fold(0_i64, |total, branch| {
            total.saturating_add(branch.royalty_outstanding_paise)
        }),
        sync_gap_count: comparisons.iter().fold(0_i64, |total, branch| {
            total
                .saturating_add(branch.service_sync_gap)
                .saturating_add(branch.product_sync_gap)
        }),
        pending_approval_count: approvals
            .iter()
            .filter(|approval| approval.status == "pending")
            .count(),
        conflict_count: conflicts.len(),
    };
    Ok(MultiBranchCommandCenter {
        range_start,
        range_end,
        summary,
        comparisons,
        conflicts,
        approvals,
        audit,
    })
}

pub async fn multi_branch_drilldown(
    db: &PgPool,
    tenant_id: &str,
    actor_user_id: &str,
    unrestricted: bool,
    kind: &str,
    input: MultiBranchFilterInput,
) -> Result<Vec<serde_json::Value>, AppError> {
    let kind = kind.trim();
    if !matches!(
        kind,
        "sales"
            | "appointments"
            | "refunds"
            | "transfers"
            | "membershipRedemptions"
            | "registerClosings"
            | "conflicts"
            | "interBranchSettlements"
    ) {
        return Err(AppError::validation(
            "multi-branch drilldown kind is invalid",
        ));
    }
    let (range_start, range_end, region, zone, cluster, branch_id) =
        normalize_multi_branch_filters(input)?;
    branch_repository::multi_branch_drilldown(
        db,
        tenant_id,
        range_start,
        range_end,
        &region,
        &zone,
        &cluster,
        &branch_id,
        actor_user_id,
        unrestricted,
        kind,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch drilldown"))
}

#[allow(clippy::too_many_arguments)]
pub async fn settle_inter_branch_redemption(
    db: &PgPool,
    tenant_id: &str,
    actor: &str,
    session_id: Option<&str>,
    unrestricted: bool,
    redemption_id: &str,
    version: i32,
    payment_method: &str,
    settlement_reference: &str,
) -> Result<branch_repository::InterBranchSettlementRecord, AppError> {
    if version != 0 {
        return Err(AppError::conflict(
            "inter-branch settlement changed before save",
        ));
    }
    let payment_method = match payment_method.trim().to_ascii_lowercase().as_str() {
        "cash" => "cash",
        "bank" | "bank_transfer" => "bank_transfer",
        _ => return Err(AppError::validation("settlement payment method is invalid")),
    };
    let settlement_reference = settlement_reference.trim();
    if settlement_reference.is_empty() || settlement_reference.chars().count() > 120 {
        return Err(AppError::validation(
            "settlement reference must be between 1 and 120 characters",
        ));
    }
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inter-branch settlement"))?;
    let redemption =
        branch_repository::inter_branch_redemption_for_update(&mut tx, tenant_id, redemption_id)
            .await
            .map_err(|_| AppError::internal("failed to load inter-branch redemption"))?
            .ok_or_else(|| AppError::not_found("inter-branch redemption was not found"))?;
    if redemption.amount_paise <= 0 {
        return Err(AppError::conflict(
            "inter-branch redemption has no settlement value",
        ));
    }
    if !unrestricted {
        let source_visible = branch_repository::has_assigned_branch_access(
            &mut tx,
            tenant_id,
            actor,
            &redemption.source_branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate branch scope"))?;
        let target_visible = branch_repository::has_assigned_branch_access(
            &mut tx,
            tenant_id,
            actor,
            &redemption.redemption_branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate branch scope"))?;
        if !source_visible || !target_visible {
            return Err(AppError::forbidden(
                "both settlement branches must be assigned to the current user",
            ));
        }
    }
    if let Some(existing) =
        branch_repository::inter_branch_settlement_for_update(&mut tx, tenant_id, redemption_id)
            .await
            .map_err(|_| AppError::internal("failed to load inter-branch settlement"))?
    {
        if existing.payment_method == payment_method
            && existing.settlement_reference == settlement_reference
        {
            tx.commit()
                .await
                .map_err(|_| AppError::internal("failed to finish inter-branch settlement"))?;
            return Ok(existing);
        }
        return Err(AppError::conflict(
            "inter-branch redemption is already settled",
        ));
    }

    let settlement_id = uuid::Uuid::new_v4().to_string();
    let payment_account = if payment_method == "cash" {
        "CASH_ON_HAND"
    } else {
        "BANK_CLEARING"
    };
    let source_accrual = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        &redemption.source_branch_id,
        "inter_branch_accrual",
        &settlement_id,
        redemption.business_date,
        "Cross-location membership redemption payable",
        actor,
        &[
            accounting_service::ManualJournalLine {
                account_code: "DEFERRED_REVENUE".into(),
                debit_paise: redemption.amount_paise,
                credit_paise: 0,
            },
            accounting_service::ManualJournalLine {
                account_code: "ACCOUNTS_PAYABLE".into(),
                debit_paise: 0,
                credit_paise: redemption.amount_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("source settlement accrual was already posted"))?;
    let target_accrual = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        &redemption.redemption_branch_id,
        "inter_branch_accrual",
        &settlement_id,
        redemption.business_date,
        "Cross-location membership redemption receivable",
        actor,
        &[
            accounting_service::ManualJournalLine {
                account_code: "ACCOUNTS_RECEIVABLE".into(),
                debit_paise: redemption.amount_paise,
                credit_paise: 0,
            },
            accounting_service::ManualJournalLine {
                account_code: "SALES_REVENUE".into(),
                debit_paise: 0,
                credit_paise: redemption.amount_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("target settlement accrual was already posted"))?;
    let source_payment = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        &redemption.source_branch_id,
        "inter_branch_payment",
        &settlement_id,
        Utc::now().date_naive(),
        "Cross-location membership settlement paid",
        actor,
        &[
            accounting_service::ManualJournalLine {
                account_code: "ACCOUNTS_PAYABLE".into(),
                debit_paise: redemption.amount_paise,
                credit_paise: 0,
            },
            accounting_service::ManualJournalLine {
                account_code: payment_account.into(),
                debit_paise: 0,
                credit_paise: redemption.amount_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("source settlement payment was already posted"))?;
    let target_payment = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        &redemption.redemption_branch_id,
        "inter_branch_payment",
        &settlement_id,
        Utc::now().date_naive(),
        "Cross-location membership settlement received",
        actor,
        &[
            accounting_service::ManualJournalLine {
                account_code: payment_account.into(),
                debit_paise: redemption.amount_paise,
                credit_paise: 0,
            },
            accounting_service::ManualJournalLine {
                account_code: "ACCOUNTS_RECEIVABLE".into(),
                debit_paise: 0,
                credit_paise: redemption.amount_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("target settlement payment was already posted"))?;
    let settlement = branch_repository::insert_inter_branch_settlement(
        &mut tx,
        &settlement_id,
        tenant_id,
        &redemption,
        payment_method,
        settlement_reference,
        &source_accrual,
        &target_accrual,
        &source_payment,
        &target_payment,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save inter-branch settlement"))?;
    branch_repository::audit_multi_branch(
        &mut tx,
        tenant_id,
        &redemption.source_branch_id,
        actor,
        session_id,
        "multi_branch.settlement.settled",
        json!({
            "settlementId": settlement.id,
            "redemptionId": redemption.id,
            "sourceBranchId": redemption.source_branch_id,
            "redemptionBranchId": redemption.redemption_branch_id,
            "amountPaise": redemption.amount_paise,
            "paymentMethod": payment_method,
            "reference": settlement_reference,
            "before": {"status":"open","version":0},
            "after": {"status":"settled","version":settlement.version},
            "journals": {
                "sourceAccrual": source_accrual,
                "targetAccrual": target_accrual,
                "sourcePayment": source_payment,
                "targetPayment": target_payment
            }
        }),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit inter-branch settlement"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inter-branch settlement"))?;
    Ok(settlement)
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
    if current.requested_by == actor {
        return Err(AppError::forbidden(
            "approval must be decided by a different manager",
        ));
    }
    let mut before_sync_gap = (0_i64, 0_i64);
    let mut after_sync_gap = (0_i64, 0_i64);
    let published = if decision == "approved" {
        let policy = branch_repository::franchise_policy_for_update(&mut tx, tenant_id)
            .await
            .map_err(|_| AppError::internal("failed to load franchise policy"))?
            .ok_or_else(|| AppError::conflict("configure a central branch first"))?;
        before_sync_gap = branch_repository::central_sync_gap_snapshot(
            &mut tx,
            tenant_id,
            &policy.central_branch_id,
        )
        .await
        .map_err(|e| AppError::internal(&format!("prepublish: {e}")))?;
        let published = branch_repository::publish_central_services(
            &mut tx,
            tenant_id,
            &policy.central_branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to publish central masters"))?;
        after_sync_gap = branch_repository::central_sync_gap_snapshot(
            &mut tx,
            tenant_id,
            &policy.central_branch_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to capture post-publish state"))?;
        published
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
        json!({
            "approvalId": approval.id,
            "action": approval.action,
            "published": published,
            "before": {"serviceSyncGap": before_sync_gap.0, "productSyncGap": before_sync_gap.1},
            "after": {"serviceSyncGap": after_sync_gap.0, "productSyncGap": after_sync_gap.1}
        }),
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

fn normalize_multi_branch_filters(
    input: MultiBranchFilterInput,
) -> Result<(NaiveDate, NaiveDate, String, String, String, String), AppError> {
    let india = FixedOffset::east_opt(19_800)
        .ok_or_else(|| AppError::internal("failed to calculate report range"))?;
    let today = Utc::now().with_timezone(&india).date_naive();
    let end = input
        .end_date
        .as_deref()
        .map(|value| NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d"))
        .transpose()
        .map_err(|_| AppError::validation("endDate must use YYYY-MM-DD"))?
        .unwrap_or(today);
    let start = input
        .start_date
        .as_deref()
        .map(|value| NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d"))
        .transpose()
        .map_err(|_| AppError::validation("startDate must use YYYY-MM-DD"))?
        .unwrap_or(end - chrono::Duration::days(29));
    if start > end || end.signed_duration_since(start).num_days() > 366 {
        return Err(AppError::validation(
            "report range must be between 1 and 367 days",
        ));
    }
    let normalize = |value: Option<String>, name: &str, max: usize| {
        let value = value.unwrap_or_default().trim().to_string();
        if value.chars().count() > max || value.chars().any(char::is_control) {
            Err(AppError::validation(format!("{name} filter is invalid")))
        } else {
            Ok(value)
        }
    };
    Ok((
        start,
        end,
        normalize(input.region, "region", 120)?,
        normalize(input.zone, "zone", 120)?,
        normalize(input.cluster, "cluster", 120)?,
        normalize(input.branch_id, "branchId", 128)?,
    ))
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

fn parse_bulk_csv(csv_bytes: &[u8]) -> Result<PreparedBranchBulk, AppError> {
    if csv_bytes.is_empty() || csv_bytes.len() > MAX_BRANCH_IMPORT_BYTES {
        return Err(AppError::validation(
            "branch CSV must be between 1 byte and 2 MB",
        ));
    }
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(csv_bytes);
    let headers = reader
        .headers()
        .map_err(|_| AppError::validation("branch CSV header is invalid"))?
        .clone();
    for required in ["name", "code"] {
        if !headers.iter().any(|header| header == required) {
            return Err(AppError::validation(format!(
                "branch CSV is missing required {required} column"
            )));
        }
    }

    let mut prepared = PreparedBranchBulk {
        total_rows: 0,
        branches: Vec::new(),
        failures: Vec::new(),
    };
    let mut codes = HashSet::new();
    let mut city_names = HashSet::new();
    for (index, result) in reader.deserialize::<BranchCsvRow>().enumerate() {
        prepared.total_rows += 1;
        if prepared.total_rows > MAX_BRANCH_IMPORT_ROWS {
            return Err(AppError::validation(
                "branch CSV supports at most 1000 rows",
            ));
        }
        let row_number = index + 2;
        let row = match result {
            Ok(row) => row,
            Err(_) => {
                prepared.failures.push(BranchBulkFailure {
                    row: row_number,
                    code: "CSV_ROW_INVALID".into(),
                    message: "row does not match the branch CSV template".into(),
                });
                continue;
            }
        };
        let branch = match normalize_csv_branch(row_number, row) {
            Ok(branch) => branch,
            Err(message) => {
                prepared.failures.push(BranchBulkFailure {
                    row: row_number,
                    code: "BRANCH_INVALID".into(),
                    message,
                });
                continue;
            }
        };
        if !codes.insert(branch.code.to_ascii_lowercase()) {
            prepared.failures.push(BranchBulkFailure {
                row: row_number,
                code: "DUPLICATE_CODE".into(),
                message: format!("branch code {} is duplicated in the CSV", branch.code),
            });
            continue;
        }
        if !branch.zone_name.is_empty()
            && !city_names.insert((
                branch.zone_name.to_ascii_lowercase(),
                branch.name.to_ascii_lowercase(),
            ))
        {
            prepared.failures.push(BranchBulkFailure {
                row: row_number,
                code: "DUPLICATE_CITY_BRANCH".into(),
                message: "branch name is duplicated in the same zone/city".into(),
            });
            continue;
        }
        prepared.branches.push(branch);
    }
    if prepared.total_rows == 0 {
        return Err(AppError::validation("branch CSV has no data rows"));
    }
    Ok(prepared)
}

fn normalize_csv_branch(row: usize, value: BranchCsvRow) -> Result<PreparedBranch, String> {
    let name = normalize_name(&value.name)
        .map_err(|_| "branch name must be between 2 and 100 characters".to_string())?;
    let code = normalize_code(&value.code).map_err(|_| {
        "branch code must be 2 to 24 letters, numbers, hyphens, or underscores".to_string()
    })?;
    let (region_name, zone_name, cluster_name) =
        normalize_hierarchy(&value.region_name, &value.zone_name, &value.cluster_name)
            .map_err(|_| "zone requires a region and cluster requires a zone".to_string())?;
    let address = normalize_address(&value.address)
        .map_err(|_| "branch address must be at most 300 characters".to_string())?;
    validate_coordinates(value.latitude, value.longitude)
        .map_err(|_| "latitude and longitude must both be valid coordinates".to_string())?;
    let booking_deposit_percent =
        normalize_deposit_percent(value.booking_deposit_percent.unwrap_or(0))
            .map_err(|_| "booking deposit percent must be between 0 and 100".to_string())?;
    Ok(PreparedBranch {
        row,
        name,
        code,
        region_name,
        zone_name,
        cluster_name,
        address,
        latitude: value.latitude,
        longitude: value.longitude,
        booking_deposit_percent,
    })
}

fn reject_existing_branches(
    prepared: &mut PreparedBranchBulk,
    existing: &[branch_repository::BranchKeyRecord],
) {
    let codes = existing
        .iter()
        .map(|branch| branch.code.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let city_names = existing
        .iter()
        .filter(|branch| !branch.zone_name.is_empty())
        .map(|branch| {
            (
                branch.zone_name.to_ascii_lowercase(),
                branch.name.to_ascii_lowercase(),
            )
        })
        .collect::<HashSet<_>>();
    let mut valid = Vec::with_capacity(prepared.branches.len());
    for branch in prepared.branches.drain(..) {
        if codes.contains(&branch.code.to_ascii_lowercase()) {
            prepared.failures.push(BranchBulkFailure {
                row: branch.row,
                code: "CODE_EXISTS".into(),
                message: format!("branch code {} already exists", branch.code),
            });
        } else if !branch.zone_name.is_empty()
            && city_names.contains(&(
                branch.zone_name.to_ascii_lowercase(),
                branch.name.to_ascii_lowercase(),
            ))
        {
            prepared.failures.push(BranchBulkFailure {
                row: branch.row,
                code: "CITY_BRANCH_EXISTS".into(),
                message: "branch name already exists in the same zone/city".into(),
            });
        } else {
            valid.push(branch);
        }
    }
    prepared.branches = valid;
}

fn bulk_preview(prepared: &PreparedBranchBulk) -> BranchBulkPreview {
    BranchBulkPreview {
        total_rows: prepared.total_rows,
        valid_rows: prepared.branches.len(),
        invalid_rows: prepared.failures.len(),
        failures: prepared.failures.clone(),
    }
}

fn normalize_idempotency_key(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if !(8..=128).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(AppError::validation(
            "Idempotency-Key must use 8 to 128 letters, numbers, dots, colons, hyphens or underscores",
        ));
    }
    Ok(value.to_string())
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
        normalize_hierarchy, normalize_multi_branch_filters, normalize_name,
        normalize_override_fields, parse_bulk_csv, request_multi_branch_approval,
        settle_inter_branch_redemption, validate_coordinates, MultiBranchFilterInput,
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
        let (start, end, region, zone, cluster, branch_id) =
            normalize_multi_branch_filters(MultiBranchFilterInput {
                start_date: Some("2026-07-01".into()),
                end_date: Some("2026-07-21".into()),
                region: Some(" West ".into()),
                zone: Some("Mumbai".into()),
                cluster: None,
                branch_id: Some("BR-01".into()),
            })
            .unwrap();
        assert_eq!(start.to_string(), "2026-07-01");
        assert_eq!(end.to_string(), "2026-07-21");
        assert_eq!(
            (
                region.as_str(),
                zone.as_str(),
                cluster.as_str(),
                branch_id.as_str()
            ),
            ("West", "Mumbai", "", "BR-01")
        );
        assert!(normalize_multi_branch_filters(MultiBranchFilterInput {
            start_date: Some("2025-01-01".into()),
            end_date: Some("2026-07-21".into()),
            ..Default::default()
        })
        .is_err());

        let csv = b"name,code,regionName,zoneName\nMumbai One,MUM-01,West,Mumbai\nMumbai Two,MUM-01,West,Mumbai\n";
        let prepared = parse_bulk_csv(csv).unwrap();
        assert_eq!(prepared.total_rows, 2);
        assert_eq!(prepared.branches.len(), 1);
        assert_eq!(prepared.failures[0].code, "DUPLICATE_CODE");
    }

    #[sqlx::test(migrations = false)]
    async fn new_branch_uses_one_canonical_uuid(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
            CREATE TABLE tenants(
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              scope_id TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active'
            );
            CREATE TABLE branches(
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id UUID NOT NULL REFERENCES tenants(id),
              scope_id TEXT NOT NULL,
              name TEXT NOT NULL,
              code TEXT NOT NULL,
              region_name TEXT NOT NULL DEFAULT '',
              zone_name TEXT NOT NULL DEFAULT '',
              cluster_name TEXT NOT NULL DEFAULT '',
              address TEXT NOT NULL DEFAULT '',
              latitude DOUBLE PRECISION,
              longitude DOUBLE PRECISION,
              booking_deposit_percent INTEGER NOT NULL DEFAULT 0,
              royalty_bps INTEGER NOT NULL DEFAULT 0,
              royalty_minimum_paise BIGINT NOT NULL DEFAULT 0,
              active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let tenant_id: String = sqlx::query_scalar(
            "WITH tenant AS (SELECT gen_random_uuid() id) INSERT INTO tenants(id,scope_id) SELECT id,id::TEXT FROM tenant RETURNING id::TEXT",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        let branch = branch_repository::create(
            &mut tx,
            &tenant_id,
            "Mumbai Central",
            "MUM-01",
            "West",
            "Mumbai",
            "Central",
            "",
            None,
            None,
            0,
        )
        .await
        .unwrap()
        .unwrap();
        tx.commit().await.unwrap();
        let scope_id: String =
            sqlx::query_scalar("SELECT scope_id FROM branches WHERE id::TEXT=$1")
                .bind(&branch.id)
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(branch.id, scope_id);
    }

    #[sqlx::test(migrations = false)]
    async fn assigned_branch_scope_is_tenant_and_validity_isolated(pool: PgPool) {
        sqlx::query(
            r#"CREATE TABLE user_branch_roles(
              tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,branch_id TEXT NOT NULL,
              active BOOLEAN NOT NULL DEFAULT TRUE,access_type TEXT NOT NULL DEFAULT 'permanent',
              valid_from DATE,valid_until DATE)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(
            r#"INSERT INTO user_branch_roles VALUES
              ('tenant-1','regional-1','branch-a',TRUE,'permanent',NULL,NULL),
              ('tenant-1','regional-1','branch-b',TRUE,'deputation',CURRENT_DATE-1,CURRENT_DATE+1),
              ('tenant-1','regional-1','expired',TRUE,'deputation',CURRENT_DATE-3,CURRENT_DATE-2),
              ('tenant-2','regional-1','other-tenant',TRUE,'permanent',NULL,NULL),
              ('tenant-1','other-user','other-user-branch',TRUE,'permanent',NULL,NULL)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut visible = branch_repository::accessible_branch_ids(&pool, "tenant-1", "regional-1")
            .await
            .unwrap();
        visible.sort();
        assert_eq!(visible, vec!["branch-a", "branch-b"]);
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
            CREATE TABLE inventory_items(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sku TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',unit TEXT NOT NULL DEFAULT 'pcs',stock_quantity INTEGER NOT NULL DEFAULT 0,reorder_point INTEGER NOT NULL DEFAULT 0,unit_cost_paise BIGINT NOT NULL DEFAULT 0,hsn_code TEXT NOT NULL DEFAULT '',gst_percent INTEGER NOT NULL DEFAULT 0,barcode TEXT NOT NULL DEFAULT '',batch_tracked BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,central_master_item_id TEXT,franchise_override_fields TEXT[] NOT NULL DEFAULT '{}',subcategory TEXT NOT NULL DEFAULT '',brand TEXT NOT NULL DEFAULT '',product_usage TEXT NOT NULL DEFAULT 'retail',package_unit TEXT NOT NULL DEFAULT 'pcs',units_per_package INTEGER NOT NULL DEFAULT 1,alert_level INTEGER NOT NULL DEFAULT 0,desired_level INTEGER NOT NULL DEFAULT 0,order_level INTEGER NOT NULL DEFAULT 0,safety_stock_level INTEGER NOT NULL DEFAULT 0,dual_use_stock BOOLEAN NOT NULL DEFAULT FALSE,center_available BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ);
            CREATE UNIQUE INDEX uq_test_item_master ON inventory_items(tenant_id,branch_id,central_master_item_id) WHERE central_master_item_id IS NOT NULL;
            CREATE TABLE auth_audit_logs(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,user_id TEXT,session_id TEXT,branch_id TEXT,event_type TEXT NOT NULL,outcome TEXT NOT NULL,details_json JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
            CREATE TABLE user_branch_roles(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,branch_id TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,access_type TEXT NOT NULL DEFAULT 'permanent',valid_from DATE,valid_until DATE);
            CREATE TABLE inventory_item_barcodes(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,inventory_item_id TEXT NOT NULL,barcode TEXT NOT NULL,is_primary BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(tenant_id,branch_id,barcode));
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
        sqlx::raw_sql(include_str!(
            "../../migrations/0215_multi_branch_approval_separation.sql"
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
        let tenant_one_rows =
            branch_repository::multi_branch_approvals(&pool, "tenant-1", "owner-1", true)
                .await
                .unwrap();
        assert_eq!(tenant_one_rows.len(), 1);
        assert_eq!(tenant_one_rows[0].id, tenant_one.id);

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

        sqlx::query("DROP TABLE auth_audit_logs")
            .execute(&pool)
            .await
            .unwrap();
        assert!(decide_multi_branch_approval(
            &pool,
            "tenant-1",
            "central-1",
            "approver-1",
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
            "approver-1",
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

    #[sqlx::test(migrations = false)]
    async fn inter_branch_settlement_is_atomic_idempotent_and_tenant_scoped(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE EXTENSION IF NOT EXISTS pgcrypto;
            CREATE TABLE pos_sales(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,status TEXT NOT NULL,business_date DATE NOT NULL);
            CREATE TABLE client_membership_credits(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,unit_value_paise BIGINT NOT NULL);
            CREATE TABLE pos_membership_redemptions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,sale_id TEXT NOT NULL,client_membership_credit_id TEXT NOT NULL,quantity INTEGER NOT NULL,redeemed_value_paise BIGINT NOT NULL);
            CREATE TABLE accounting_journal_entries(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,memo TEXT NOT NULL DEFAULT '',entry_date DATE,created_by_user_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(tenant_id,branch_id,source_type,source_id));
            CREATE TABLE accounting_journal_lines(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,journal_entry_id TEXT NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,account_code TEXT NOT NULL,debit_paise BIGINT NOT NULL DEFAULT 0,credit_paise BIGINT NOT NULL DEFAULT 0,CHECK ((debit_paise=0)<>(credit_paise=0)));
            CREATE TABLE auth_audit_logs(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,user_id TEXT,session_id TEXT,branch_id TEXT,event_type TEXT NOT NULL,outcome TEXT NOT NULL,details_json JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
            INSERT INTO pos_sales VALUES('sale-1','tenant-1','redeem-1','completed','2026-07-21'),('sale-2','tenant-1','redeem-1','completed','2026-07-21');
            INSERT INTO client_membership_credits VALUES('credit-1','tenant-1','source-1',5000),('credit-2','tenant-1','source-1',5000);
            INSERT INTO pos_membership_redemptions VALUES('redemption-1','tenant-1','redeem-1','sale-1','credit-1',1,5000),('redemption-2','tenant-1','redeem-1','sale-2','credit-2',1,5000);
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0222_multi_branch_settlement_ledger.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        assert!(settle_inter_branch_redemption(
            &pool,
            "tenant-2",
            "owner-1",
            None,
            true,
            "redemption-1",
            0,
            "bank_transfer",
            "UTR-1",
        )
        .await
        .is_err());
        let settled = settle_inter_branch_redemption(
            &pool,
            "tenant-1",
            "owner-1",
            None,
            true,
            "redemption-1",
            0,
            "bank_transfer",
            "UTR-1",
        )
        .await
        .unwrap();
        assert_eq!(settled.amount_paise, 5000);
        assert_eq!(settled.status, "settled");
        let retry = settle_inter_branch_redemption(
            &pool,
            "tenant-1",
            "owner-1",
            None,
            true,
            "redemption-1",
            0,
            "bank_transfer",
            "UTR-1",
        )
        .await
        .unwrap();
        assert_eq!(retry.id, settled.id);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM accounting_journal_entries")
                .fetch_one(&pool)
                .await
                .unwrap(),
            4
        );

        sqlx::query("DROP TABLE auth_audit_logs")
            .execute(&pool)
            .await
            .unwrap();
        assert!(settle_inter_branch_redemption(
            &pool,
            "tenant-1",
            "owner-1",
            None,
            true,
            "redemption-2",
            0,
            "cash",
            "CASH-1",
        )
        .await
        .is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM multi_branch_settlements")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM accounting_journal_entries")
                .fetch_one(&pool)
                .await
                .unwrap(),
            4
        );
    }
}
