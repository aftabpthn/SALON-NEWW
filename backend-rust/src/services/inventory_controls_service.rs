use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use crate::{
    models::common::AppError,
    repositories::{
        branch_repository,
        inventory_repository::{
            self, InventoryAutomationAction, InventoryAutomationPolicy, InventoryBatchRecord,
            InventoryCommandCenterMetrics, InventoryControlCounts, InventoryControlItem,
            InventoryExceptionEvidence, InventoryExceptionReviewRecord,
            InventoryTransferOpportunity,
        },
    },
    services::{
        accounting_service::INVENTORY_ASSET_ACCOUNT, inventory_reorder_forecast_service,
        inventory_transfer_service, purchase_service,
    },
    state::AppState,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedControlsResponse {
    pub summary: ControlSummary,
    pub capabilities: ControlCapabilities,
    pub exception_rows: Vec<ControlException>,
    pub approval_matrix: Vec<ApprovalControl>,
    pub audit_locks: Vec<AuditLock>,
    pub expiring_rows: Vec<ExpiryControlRow>,
    pub dead_stock_rows: Vec<DeadStockRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlSummary {
    pub critical: usize,
    pub warnings: usize,
    pub pending_approvals: i64,
    pub expiry_alerts: Option<i64>,
    pub dead_stock: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlCapabilities {
    pub approval_matrix: bool,
    pub audit_locks: bool,
    pub expiry: bool,
    pub dead_stock: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlException {
    pub branch_id: String,
    pub branch_name: String,
    pub severity: String,
    pub control: String,
    pub title: String,
    pub value_paise: i64,
    pub evidence: String,
    pub owner: String,
    pub status: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalControl {
    pub branch_id: String,
    pub branch_name: String,
    pub control: String,
    pub required_role: String,
    pub pending: i64,
    pub gate: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLock {
    pub branch_id: String,
    pub branch_name: String,
    pub lock: String,
    pub locked: i64,
    pub reason: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryControlRow {
    pub branch_id: String,
    pub branch_name: String,
    pub batch_id: String,
    pub product_id: String,
    pub product_name: String,
    pub batch_number: String,
    pub expiry_date: String,
    pub days_to_expiry: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadStockRow {
    pub branch_id: String,
    pub branch_name: String,
    pub product_id: String,
    pub product_name: String,
    pub sku: String,
    pub stock_quantity: i32,
    pub inactive_days: i64,
    pub value_paise: i64,
    pub last_outbound_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderSuggestion {
    pub product_id: String,
    pub product_name: String,
    pub sku: String,
    pub current_stock: i32,
    pub reorder_level: i32,
    pub suggested_quantity: i32,
    pub priority: String,
    pub reason: String,
    pub estimated_value_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlReconciliationResponse {
    pub as_of_date: NaiveDate,
    pub account_code: String,
    pub valuation_method: String,
    pub summary: GlReconciliationSummary,
    pub rows: Vec<GlBranchRow>,
    pub exception_rows: Vec<GlException>,
    pub audit_rows: Vec<GlAuditRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlReconciliationSummary {
    pub inventory_value_paise: i64,
    pub gl_value_paise: i64,
    pub difference_paise: i64,
    pub unreconciled: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlBranchRow {
    pub branch_id: String,
    pub branch_name: String,
    pub product_count: i64,
    pub inventory_value_paise: i64,
    pub gl_value_paise: i64,
    pub difference_paise: i64,
    pub missing_cost_products: i64,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlException {
    pub branch_id: String,
    pub branch_name: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub amount_paise: i64,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlAuditRow {
    pub branch_id: String,
    pub branch_name: String,
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub memo: String,
    pub amount_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryCommandCenterResponse {
    pub summary: InventoryCommandCenterSummary,
    pub signals: Vec<InventoryCommandCenterSignal>,
    pub recommendations: Vec<InventoryExceptionRecommendation>,
    pub transfer_opportunities: Vec<InventoryTransferOpportunity>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryExceptionRecommendation {
    pub key: String,
    pub category: String,
    pub evidence_hash: String,
    pub severity: String,
    pub title: String,
    pub explanation: String,
    pub recommended_action: String,
    pub confidence_bps: i32,
    pub evidence: serde_json::Value,
    pub route: String,
    pub approval: InventoryRecommendationApproval,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRecommendationApproval {
    pub required: bool,
    pub status: String,
    pub mode: String,
    pub route: String,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub review_note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryCommandCenterSummary {
    pub total_stock_value_paise: i64,
    pub stockout_risk: i64,
    pub overstock_risk: i64,
    pub expiry_risk: i64,
    pub dead_stock: i64,
    pub open_purchase_orders: i64,
    pub in_transit_stock: i64,
    pub consumption_variance_quantity: i64,
    pub consumption_variance_bps: i64,
    pub audit_exceptions: i64,
    pub gl_mismatch_paise: i64,
    pub pending_approvals: i64,
    pub supplier_risk: i64,
    pub transfer_opportunities: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryCommandCenterSignal {
    pub key: String,
    pub group: String,
    pub label: String,
    pub detail: String,
    pub severity: String,
    pub metric: String,
    pub metric_value: i64,
    pub route: String,
    pub action_label: String,
}

#[derive(Debug, Clone)]
pub struct PurchaseOptimizerLine {
    pub inventory_item_id: String,
    pub quantity: i32,
    pub unit_cost_paise: i64,
}

#[derive(Debug, Clone)]
pub struct InventoryAutomationPolicyInput {
    pub enabled: bool,
    pub auto_transfer_drafts: bool,
    pub auto_po_drafts: bool,
    pub monthly_budget_paise: i64,
    pub category_budgets_paise: Option<Value>,
    pub expiry_rescue_days: i32,
    pub run_interval_minutes: i32,
    pub escalation_minutes: i32,
    pub min_confidence_bps: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAutomationOverview {
    pub persisted: bool,
    pub policy: InventoryAutomationPolicy,
    pub actions: Vec<InventoryAutomationAction>,
    pub summary: InventoryAutomationSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAutomationSummary {
    pub pending_approval: usize,
    pub failed: usize,
    pub completed: usize,
    pub budget_committed_paise: i64,
    pub pending_expense_paise: i64,
    pub available_cash_paise: i64,
    pub budget_remaining_paise: i64,
}

pub async fn advanced_controls(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    dead_stock_days: i64,
    expiry_window_days: i64,
    limit: usize,
    all_branches: bool,
) -> Result<AdvancedControlsResponse, AppError> {
    let branches = branch_repository::list(&state.db, tenant_id, "")
        .await
        .map_err(|_| AppError::internal("failed to load inventory branches"))?;
    let selected = if all_branches {
        branches
            .into_iter()
            .map(|branch| (branch.id, branch.name))
            .collect::<Vec<_>>()
    } else {
        let name = branches
            .into_iter()
            .find(|branch| branch.id == branch_id)
            .map(|branch| branch.name)
            .unwrap_or_else(|| branch_id.to_string());
        vec![(branch_id.to_string(), name)]
    };
    let mut combined = AdvancedControlsResponse {
        summary: ControlSummary {
            critical: 0,
            warnings: 0,
            pending_approvals: 0,
            expiry_alerts: Some(0),
            dead_stock: 0,
        },
        capabilities: ControlCapabilities {
            approval_matrix: true,
            audit_locks: true,
            expiry: true,
            dead_stock: true,
        },
        exception_rows: Vec::new(),
        approval_matrix: Vec::new(),
        audit_locks: Vec::new(),
        expiring_rows: Vec::new(),
        dead_stock_rows: Vec::new(),
    };
    for (selected_id, selected_name) in selected {
        let (items, counts, batches) = tokio::try_join!(
            inventory_repository::control_items(&state.db, tenant_id, &selected_id),
            inventory_repository::control_counts(&state.db, tenant_id, &selected_id),
            inventory_repository::list_batches(&state.db, tenant_id, &selected_id),
        )
        .map_err(|_| AppError::internal("failed to load inventory controls"))?;
        let response = build_response(
            items,
            counts,
            batches,
            Utc::now(),
            dead_stock_days,
            expiry_window_days,
            limit,
            &selected_id,
            &selected_name,
        );
        combined.summary.critical += response.summary.critical;
        combined.summary.warnings += response.summary.warnings;
        combined.summary.pending_approvals += response.summary.pending_approvals;
        combined.summary.expiry_alerts = Some(
            combined.summary.expiry_alerts.unwrap_or(0)
                + response.summary.expiry_alerts.unwrap_or(0),
        );
        combined.summary.dead_stock += response.summary.dead_stock;
        combined.exception_rows.extend(response.exception_rows);
        combined.approval_matrix.extend(response.approval_matrix);
        combined.audit_locks.extend(response.audit_locks);
        combined.expiring_rows.extend(response.expiring_rows);
        combined.dead_stock_rows.extend(response.dead_stock_rows);
    }
    combined.exception_rows.sort_by(|a, b| {
        severity_rank(&b.severity)
            .cmp(&severity_rank(&a.severity))
            .then_with(|| b.value_paise.cmp(&a.value_paise))
    });
    combined.exception_rows.truncate(limit);
    combined.expiring_rows.sort_by_key(|row| row.days_to_expiry);
    combined.expiring_rows.truncate(limit);
    combined
        .dead_stock_rows
        .sort_by(|a, b| b.value_paise.cmp(&a.value_paise));
    combined.dead_stock_rows.truncate(limit);
    Ok(combined)
}

pub async fn reorder_suggestions(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ReorderSuggestion>, AppError> {
    let items = inventory_repository::control_items(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load reorder suggestions"))?;
    Ok(build_reorder_suggestions(items))
}

pub async fn gl_reconciliation(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    as_of: NaiveDate,
    all_branches: bool,
) -> Result<GlReconciliationResponse, AppError> {
    let branches = branch_repository::list(&state.db, tenant_id, "")
        .await
        .map_err(|_| AppError::internal("failed to load inventory branches"))?;
    let selected = if all_branches {
        branches
            .into_iter()
            .map(|branch| (branch.id, branch.name))
            .collect::<Vec<_>>()
    } else {
        let name = branches
            .into_iter()
            .find(|branch| branch.id == branch_id)
            .map(|branch| branch.name)
            .unwrap_or_else(|| branch_id.to_string());
        vec![(branch_id.to_string(), name)]
    };
    let mut rows = Vec::new();
    let mut exception_rows = Vec::new();
    let mut audit_rows = Vec::new();
    for (selected_id, selected_name) in selected {
        let (snapshot, branch_audit) = tokio::try_join!(
            inventory_repository::gl_reconciliation_snapshot(
                &state.db,
                tenant_id,
                &selected_id,
                as_of,
                INVENTORY_ASSET_ACCOUNT
            ),
            inventory_repository::gl_reconciliation_audit(
                &state.db,
                tenant_id,
                &selected_id,
                as_of,
                INVENTORY_ASSET_ACCOUNT,
                100
            ),
        )
        .map_err(|_| AppError::internal("failed to load inventory GL reconciliation"))?;
        let difference_paise = snapshot
            .inventory_value_paise
            .saturating_sub(snapshot.gl_value_paise);
        let status = reconciliation_status(difference_paise, snapshot.missing_cost_products);
        if difference_paise.saturating_abs() > 1 {
            exception_rows.push(GlException {
                branch_id: selected_id.clone(),
                branch_name: selected_name.clone(),
                severity: "critical".into(),
                title: "Inventory value does not match the GL stock balance".into(),
                detail: format!("{} · account {INVENTORY_ASSET_ACCOUNT}", selected_name),
                amount_paise: difference_paise,
                route: "/inventory/gl-reconciliation".into(),
            });
        }
        if snapshot.missing_cost_products > 0 {
            exception_rows.push(GlException {
                branch_id: selected_id.clone(),
                branch_name: selected_name.clone(),
                severity: "warning".into(),
                title: "Products with stock are missing unit cost".into(),
                detail: format!(
                    "{} · {} products",
                    selected_name, snapshot.missing_cost_products
                ),
                amount_paise: 0,
                route: "/inventory".into(),
            });
        }
        audit_rows.extend(branch_audit.into_iter().map(|audit| GlAuditRow {
            branch_id: selected_id.clone(),
            branch_name: selected_name.clone(),
            id: audit.id,
            source_type: audit.source_type,
            source_id: audit.source_id,
            memo: audit.memo,
            amount_paise: audit.amount_paise,
            created_at: audit.created_at,
        }));
        rows.push(GlBranchRow {
            branch_id: selected_id,
            branch_name: selected_name,
            product_count: snapshot.product_count,
            inventory_value_paise: snapshot.inventory_value_paise,
            gl_value_paise: snapshot.gl_value_paise,
            difference_paise,
            missing_cost_products: snapshot.missing_cost_products,
            status: status.into(),
        });
    }
    audit_rows.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    audit_rows.truncate(250);
    let inventory_value_paise = rows.iter().map(|row| row.inventory_value_paise).sum();
    let gl_value_paise = rows.iter().map(|row| row.gl_value_paise).sum();
    let difference_paise = inventory_value_paise - gl_value_paise;
    let unreconciled = rows.iter().filter(|row| row.status != "matched").count();

    Ok(GlReconciliationResponse {
        as_of_date: as_of,
        account_code: INVENTORY_ASSET_ACCOUNT.into(),
        valuation_method: "ledger movement cost".into(),
        summary: GlReconciliationSummary {
            inventory_value_paise,
            gl_value_paise,
            difference_paise,
            unreconciled,
        },
        rows,
        exception_rows,
        audit_rows,
    })
}

pub async fn command_center(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InventoryCommandCenterResponse, AppError> {
    let policy =
        crate::services::inventory_governance_service::policy(&state.db, tenant_id, branch_id)
            .await?;
    let expiry_window_days = policy
        .get("expiryWindowDays")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(30)
        .clamp(1, 3650);
    let variance_threshold_bps = policy
        .get("countVarianceThresholdBps")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(500)
        .clamp(0, 10_000);
    let today = Utc::now().date_naive();
    let (controls, reconciliation, metrics, transfer_opportunities, evidence, reviews) = tokio::try_join!(
        advanced_controls(
            state,
            tenant_id,
            branch_id,
            90,
            expiry_window_days,
            80,
            false,
        ),
        gl_reconciliation(state, tenant_id, branch_id, today, false),
        async {
            inventory_repository::command_center_metrics(&state.db, tenant_id, branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load inventory command center"))
        },
        async {
            inventory_repository::transfer_opportunities(&state.db, tenant_id, branch_id, 20)
                .await
                .map_err(|_| AppError::internal("failed to load inventory transfer opportunities"))
        },
        async {
            inventory_repository::exception_evidence(
                &state.db,
                tenant_id,
                branch_id,
                variance_threshold_bps,
                80,
            )
            .await
            .map_err(|_| AppError::internal("failed to load inventory exception evidence"))
        },
        async {
            inventory_repository::exception_reviews(&state.db, tenant_id, branch_id)
                .await
                .map_err(|_| AppError::internal("failed to load inventory exception reviews"))
        },
    )?;
    let summary = command_center_summary(
        &metrics,
        &controls,
        &reconciliation,
        transfer_opportunities.len() as i64,
    );
    let signals = command_center_signals(&summary, variance_threshold_bps);
    let mut recommendations = exception_recommendations(evidence, &controls.expiring_rows, 50);
    apply_exception_reviews(&mut recommendations, reviews);
    Ok(InventoryCommandCenterResponse {
        summary,
        signals,
        recommendations,
        transfer_opportunities,
        generated_at: Utc::now(),
    })
}

pub async fn optimize_purchase(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    lines: Vec<PurchaseOptimizerLine>,
) -> Result<Vec<InventoryTransferOpportunity>, AppError> {
    if lines.is_empty()
        || lines.len() > 100
        || lines.iter().any(|line| {
            line.inventory_item_id.trim().is_empty()
                || line.quantity <= 0
                || line.unit_cost_paise < 0
        })
    {
        return Err(AppError::validation(
            "optimizer requires 1 to 100 valid purchase lines",
        ));
    }
    let requested = lines
        .into_iter()
        .map(|line| {
            (
                line.inventory_item_id,
                (line.quantity, line.unit_cost_paise),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut rows =
        inventory_repository::transfer_opportunities(&state.db, tenant_id, branch_id, 250)
            .await
            .map_err(|_| AppError::internal("failed to optimize cross-branch inventory"))?;
    rows.retain_mut(|row| {
        let Some((requested_quantity, quoted_unit_cost)) =
            requested.get(&row.destination_inventory_item_id)
        else {
            return false;
        };
        let original_quantity = i64::from(row.suggested_quantity.max(1));
        row.suggested_quantity = row.suggested_quantity.min(*requested_quantity);
        let quantity = i64::from(row.suggested_quantity);
        row.purchase_unit_cost_paise = Some(*quoted_unit_cost);
        row.stock_transfer_cost_paise = row
            .transfer_unit_cost_paise
            .map(|cost| cost.saturating_mul(quantity));
        row.handling_cost_paise = row
            .handling_cost_paise
            .map(|cost| cost / original_quantity * quantity);
        row.delay_cost_paise = row
            .delay_cost_paise
            .map(|cost| cost / original_quantity * quantity);
        row.estimated_transfer_cost_paise = match (
            row.stock_transfer_cost_paise,
            row.transport_cost_paise,
            row.handling_cost_paise,
            row.delay_cost_paise,
        ) {
            (Some(stock), Some(transport), Some(handling), Some(delay)) => Some(
                stock
                    .saturating_add(transport)
                    .saturating_add(handling)
                    .saturating_add(delay),
            ),
            _ => None,
        };
        row.estimated_purchase_cost_paise = Some(quoted_unit_cost.saturating_mul(quantity));
        row.savings_paise = row
            .estimated_purchase_cost_paise
            .zip(row.estimated_transfer_cost_paise)
            .map(|(purchase, transfer)| purchase.saturating_sub(transfer));
        row.cost_decision = cost_decision(
            row.estimated_transfer_cost_paise,
            row.estimated_purchase_cost_paise,
        )
        .into();
        row.source_coverage_days_after = coverage_days(
            row.source_stock_quantity - row.suggested_quantity,
            row.source_daily_usage,
        );
        row.destination_coverage_days_after = coverage_days(
            row.destination_stock_quantity + row.suggested_quantity,
            row.destination_daily_usage,
        );
        if row.cost_decision == "purchase" && !row.owner_approval_required {
            row.owner_approval_required = true;
            row.approval_reason = "Quoted purchase cost is lower than landed transfer cost".into();
        }
        row.suggested_quantity > 0
    });
    rows.sort_by(|left, right| {
        left.owner_approval_required
            .cmp(&right.owner_approval_required)
            .then_with(|| right.savings_paise.cmp(&left.savings_paise))
            .then_with(|| left.earliest_expiry_date.cmp(&right.earliest_expiry_date))
    });
    Ok(rows)
}

pub async fn automation_overview(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InventoryAutomationOverview, AppError> {
    let (saved, actions, budget) = tokio::try_join!(
        inventory_repository::automation_policy(&state.db, tenant_id, branch_id),
        inventory_repository::automation_actions(&state.db, tenant_id, branch_id, 200),
        inventory_repository::automation_budget_position(&state.db, tenant_id, branch_id),
    )
    .map_err(|_| AppError::internal("failed to load autonomous inventory operations"))?;
    let persisted = saved.is_some();
    let policy = saved.unwrap_or_else(|| default_automation_policy(tenant_id, branch_id));
    let summary = InventoryAutomationSummary {
        pending_approval: actions
            .iter()
            .filter(|row| row.status == "pending_approval")
            .count(),
        failed: actions.iter().filter(|row| row.status == "failed").count(),
        completed: actions
            .iter()
            .filter(|row| row.status == "completed")
            .count(),
        budget_committed_paise: budget.purchase_commitment_paise,
        pending_expense_paise: budget.pending_expense_paise,
        available_cash_paise: budget.available_cash_paise,
        budget_remaining_paise: spendable_budget(policy.monthly_budget_paise, &budget),
    };
    Ok(InventoryAutomationOverview {
        persisted,
        policy,
        actions,
        summary,
    })
}

pub async fn save_automation_policy(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: InventoryAutomationPolicyInput,
) -> Result<InventoryAutomationOverview, AppError> {
    if input.monthly_budget_paise < 0
        || !(1..=365).contains(&input.expiry_rescue_days)
        || !(60..=10_080).contains(&input.run_interval_minutes)
        || !(30..=10_080).contains(&input.escalation_minutes)
        || !(0..=10_000).contains(&input.min_confidence_bps)
    {
        return Err(AppError::validation(
            "autonomous inventory policy is invalid",
        ));
    }
    let category_budgets_paise = match input.category_budgets_paise {
        Some(value) => normalize_category_budgets(value)?,
        None => inventory_repository::automation_policy(&state.db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load autonomous inventory policy"))?
            .map(|policy| policy.category_budgets_paise)
            .unwrap_or_else(|| serde_json::json!({})),
    };
    inventory_repository::save_automation_policy(
        &state.db,
        tenant_id,
        branch_id,
        input.enabled,
        input.auto_transfer_drafts,
        input.auto_po_drafts,
        input.monthly_budget_paise,
        &category_budgets_paise,
        input.expiry_rescue_days,
        input.run_interval_minutes,
        input.escalation_minutes,
        input.min_confidence_bps,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save autonomous inventory policy"))?;
    automation_overview(state, tenant_id, branch_id).await
}

pub async fn run_automation(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
) -> Result<InventoryAutomationOverview, AppError> {
    let policy = inventory_repository::automation_policy(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load autonomous inventory policy"))?
        .filter(|row| row.enabled)
        .ok_or_else(|| AppError::validation("autonomous inventory operations are disabled"))?;
    if !inventory_repository::touch_automation_policy(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to schedule autonomous inventory run"))?
    {
        return Err(AppError::conflict(
            "autonomous inventory policy changed; reload and try again",
        ));
    }
    execute_automation_cycle_locked(state, &policy, actor).await?;
    automation_overview(state, tenant_id, branch_id).await
}

pub async fn process_due_automation(state: &AppState) -> Result<usize, AppError> {
    inventory_repository::recover_stale_automation_actions(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to recover autonomous inventory actions"))?;
    let policies = inventory_repository::claim_due_automation_policies(&state.db, 20)
        .await
        .map_err(|_| AppError::internal("failed to claim autonomous inventory runs"))?;
    let mut completed = 0;
    for policy in policies {
        match execute_automation_cycle_locked(state, &policy, "inventory-autopilot").await {
            Ok(()) => completed += 1,
            Err(_) => {
                tracing::warn!(tenant_id = %policy.tenant_id, branch_id = %policy.branch_id, "autonomous inventory cycle failed")
            }
        }
    }
    inventory_repository::escalate_due_automation_actions(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to escalate autonomous inventory approvals"))?;
    Ok(completed)
}

async fn execute_automation_cycle_locked(
    state: &AppState,
    policy: &InventoryAutomationPolicy,
    actor: &str,
) -> Result<(), AppError> {
    let lock_key = format!(
        "inventory-automation:{}:{}",
        policy.tenant_id, policy.branch_id
    );
    let mut connection = state
        .db
        .acquire()
        .await
        .map_err(|_| AppError::internal("failed to acquire autonomous inventory lock"))?;
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(hashtextextended($1,0))")
        .bind(&lock_key)
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| AppError::internal("failed to lock autonomous inventory run"))?;
    if !acquired {
        return Err(AppError::conflict(
            "an autonomous inventory run is already active",
        ));
    }
    let result = execute_automation_cycle(state, policy, actor).await;
    let _ = sqlx::query_scalar::<_, bool>("SELECT pg_advisory_unlock(hashtextextended($1,0))")
        .bind(&lock_key)
        .fetch_one(&mut *connection)
        .await;
    result
}

pub async fn review_automation_action(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    decision: &str,
    note: &str,
) -> Result<InventoryAutomationAction, AppError> {
    if decision == "reject" {
        if note.trim().is_empty() {
            return Err(AppError::validation("reviewNote is required for rejection"));
        }
        return inventory_repository::reject_automation_action(
            &state.db,
            tenant_id,
            branch_id,
            id,
            actor,
            note.trim(),
        )
        .await
        .map_err(|_| AppError::internal("failed to reject autonomous inventory action"))?
        .ok_or_else(|| {
            AppError::conflict("action changed, was already reviewed, or maker-checker failed")
        });
    }
    if decision != "approve" {
        return Err(AppError::validation("decision must be approve or reject"));
    }
    let action = inventory_repository::claim_automation_action(
        &state.db,
        tenant_id,
        branch_id,
        id,
        actor,
        note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to claim autonomous inventory action"))?
    .ok_or_else(|| {
        AppError::conflict("action changed, was already reviewed, or maker-checker failed")
    })?;
    match execute_approved_action(state, tenant_id, branch_id, actor, &action).await {
        Ok((resource_type, resource_id)) => inventory_repository::finish_automation_action(
            &state.db,
            tenant_id,
            branch_id,
            id,
            &resource_type,
            &resource_id,
        )
        .await
        .map_err(|_| AppError::internal("action completed but audit status could not be saved"))?
        .ok_or_else(|| AppError::conflict("autonomous inventory action status changed")),
        Err(error) => {
            inventory_repository::fail_automation_action(
                &state.db,
                tenant_id,
                branch_id,
                id,
                "approved action could not be executed; retry after reviewing live inventory",
            )
            .await
            .map_err(|_| {
                AppError::internal("failed to save autonomous inventory action failure")
            })?;
            Err(error)
        }
    }
}

async fn execute_automation_cycle(
    state: &AppState,
    policy: &InventoryAutomationPolicy,
    actor: &str,
) -> Result<(), AppError> {
    let tenant_id = policy.tenant_id.as_str();
    let branch_id = policy.branch_id.as_str();
    let bucket = Utc::now().timestamp() / (i64::from(policy.run_interval_minutes) * 60);
    let transfer_options = if policy.auto_transfer_drafts || policy.auto_po_drafts {
        inventory_repository::transfer_opportunities(&state.db, tenant_id, branch_id, 250)
            .await
            .map_err(|_| AppError::internal("failed to load autonomous transfer candidates"))?
    } else {
        Vec::new()
    };
    let (budget, category_commitments) = tokio::try_join!(
        inventory_repository::automation_budget_position(&state.db, tenant_id, branch_id),
        inventory_repository::inventory_category_commitments(&state.db, tenant_id, branch_id),
    )
    .map_err(|_| AppError::internal("failed to load purchase budget position"))?;
    let mut remaining_budget = spendable_budget(policy.monthly_budget_paise, &budget);
    let committed_by_category: HashMap<_, _> = category_commitments
        .into_iter()
        .map(|row| (row.category, row.committed_paise))
        .collect();
    let mut category_remaining: HashMap<String, i64> = policy
        .category_budgets_paise
        .as_object()
        .into_iter()
        .flat_map(|budgets| budgets.iter())
        .filter_map(|(category, limit)| {
            limit.as_i64().map(|limit| {
                (
                    category.clone(),
                    limit.saturating_sub(*committed_by_category.get(category).unwrap_or(&0)),
                )
            })
        })
        .collect();

    if policy.auto_transfer_drafts || policy.auto_po_drafts {
        let forecast = inventory_reorder_forecast_service::run(
            state,
            tenant_id,
            branch_id,
            "inventory-autopilot",
        )
        .await?;
        for recommendation in forecast.recommendations {
            if recommendation.confidence_bps < policy.min_confidence_bps {
                continue;
            }
            if let Some(option) = transfer_options.iter().find(|row| {
                row.destination_inventory_item_id == recommendation.inventory_item_id
                    && row.source_safe
                    && row.cost_decision != "purchase"
            }) {
                if policy.auto_transfer_drafts {
                    let dedupe = format!(
                        "transfer:{}:{}:{}:{bucket}",
                        option.source_branch_id,
                        option.destination_branch_id,
                        option.destination_inventory_item_id
                    );
                    let payload = serde_json::json!({
                        "sourceBranchId": option.source_branch_id,
                        "destinationBranchId": option.destination_branch_id,
                        "sourceInventoryItemId": option.source_inventory_item_id,
                        "destinationInventoryItemId": option.destination_inventory_item_id,
                        "quantity": option.suggested_quantity,
                        "idempotencyKey": format!("inventory-autopilot:{dedupe}"),
                        "notes": format!("Autonomous transfer draft for {}", option.product_name),
                        "earliestBatchNumber": option.earliest_batch_number,
                        "earliestExpiryDate": option.earliest_expiry_date,
                    });
                    queue_automation_action(
                        state,
                        policy,
                        "transfer_draft",
                        "pending_approval",
                        &dedupe,
                        &format!("Transfer {} units of {}", option.suggested_quantity, option.product_name),
                        &format!("{} has safe excess stock; destination coverage improves without a supplier purchase", option.source_branch_name),
                        recommendation.confidence_bps,
                        option.estimated_transfer_cost_paise.unwrap_or_default().max(0),
                        &payload,
                        actor,
                        "",
                        "",
                    )
                    .await?;
                }
                continue;
            }
            if !policy.auto_po_drafts {
                continue;
            }
            let cost = recommendation_cost_paise(&recommendation);
            let category = recommendation.product_category.trim().to_ascii_lowercase();
            if !budget_allows(remaining_budget, cost)
                || category_remaining
                    .get(&category)
                    .is_some_and(|remaining| !budget_allows(*remaining, cost))
            {
                continue;
            }
            let order = inventory_reorder_forecast_service::approve_to_po(
                state,
                tenant_id,
                branch_id,
                "inventory-autopilot",
                &recommendation.id,
            )
            .await?;
            remaining_budget = remaining_budget.saturating_sub(cost);
            if let Some(remaining) = category_remaining.get_mut(&category) {
                *remaining = remaining.saturating_sub(cost);
            }
            let dedupe = format!("po:{}", recommendation.id);
            let payload = serde_json::json!({"purchaseOrderId":order.order.id,"forecastRecommendationId":recommendation.id,"supplierId":recommendation.supplier_id});
            queue_automation_action(
                state,
                policy,
                "po_draft",
                "pending_approval",
                &dedupe,
                &format!("Review PO draft for {}", recommendation.product_name),
                &format!("Selected supplier uses the lowest effective item price, then shortest lead time; draft remains approval controlled"),
                recommendation.confidence_bps,
                cost,
                &payload,
                actor,
                "purchase_order",
                &order.order.id,
            )
            .await?;
        }
    }

    let controls = advanced_controls(
        state,
        tenant_id,
        branch_id,
        90,
        i64::from(policy.expiry_rescue_days),
        100,
        false,
    )
    .await?;
    let mut expiry_transfer_options = Vec::new();
    if !controls.expiring_rows.is_empty() {
        for destination in branch_repository::list(&state.db, tenant_id, "")
            .await
            .map_err(|_| AppError::internal("failed to load expiry rescue branches"))?
        {
            if destination.id == branch_id {
                continue;
            }
            expiry_transfer_options.extend(
                inventory_repository::transfer_opportunities(
                    &state.db,
                    tenant_id,
                    &destination.id,
                    250,
                )
                .await
                .map_err(|_| AppError::internal("failed to optimize expiry rescue"))?
                .into_iter()
                .filter(|option| {
                    option.source_branch_id == branch_id
                        && option.source_safe
                        && option.cost_decision != "purchase"
                }),
            );
        }
    }
    for row in controls.expiring_rows {
        if row.days_to_expiry < 0 {
            continue;
        }
        let Some(option) = expiry_transfer_options.iter().find(|option| {
            option.source_inventory_item_id == row.product_id
                && option.earliest_batch_id.as_deref() == Some(row.batch_id.as_str())
                && option.suggested_quantity > 0
        }) else {
            continue;
        };
        let quantity = option
            .earliest_batch_quantity
            .unwrap_or(option.suggested_quantity)
            .min(option.suggested_quantity);
        if quantity <= 0 {
            continue;
        }
        let dedupe = format!(
            "expiry:{}:{}:{}",
            row.batch_id, row.expiry_date, option.destination_branch_id
        );
        let payload = serde_json::json!({
            "batchId": row.batch_id,
            "productId": row.product_id,
            "sourceBranchId": option.source_branch_id,
            "destinationBranchId": option.destination_branch_id,
            "sourceInventoryItemId": option.source_inventory_item_id,
            "destinationInventoryItemId": option.destination_inventory_item_id,
            "quantity": quantity,
            "idempotencyKey": format!("inventory-autopilot:{dedupe}"),
            "notes": format!("Expiry rescue transfer for batch {}", row.batch_number),
            "route": "/inventory/transfers"
        });
        queue_automation_action(
            state,
            policy,
            "expiry_rescue",
            "pending_approval",
            &dedupe,
            &format!("Transfer {} units of batch {}", quantity, row.batch_number),
            &format!(
                "{} expires in {} days; live demand and safety checks support transfer to {}",
                row.product_name, row.days_to_expiry, option.destination_branch_name
            ),
            9_000,
            option
                .estimated_transfer_cost_paise
                .unwrap_or_default()
                .max(0),
            &payload,
            actor,
            "inventory_batch",
            &row.batch_id,
        )
        .await?;
    }

    let reconciliation =
        gl_reconciliation(state, tenant_id, branch_id, Utc::now().date_naive(), false).await?;
    let metrics = inventory_repository::command_center_metrics(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to reconcile digital twin inventory"))?;
    let issue_count = reconciliation.summary.unreconciled as i64 + metrics.ledger_trust_exceptions;
    let status = if issue_count == 0 {
        "completed"
    } else {
        "pending_approval"
    };
    let payload = serde_json::json!({"glDifferencePaise":reconciliation.summary.difference_paise,"unreconciledBranches":reconciliation.summary.unreconciled,"ledgerTrustExceptions":metrics.ledger_trust_exceptions,"route":"/inventory/gl-reconciliation"});
    queue_automation_action(
        state,
        policy,
        "reconciliation",
        status,
        &format!("reconciliation:{bucket}"),
        if issue_count == 0 {
            "Scheduled inventory reconciliation matched"
        } else {
            "Scheduled inventory reconciliation needs review"
        },
        if issue_count == 0 {
            "Digital Twin stock and GL checks passed"
        } else {
            "Digital Twin or GL evidence contains mismatches; no automatic adjustment was posted"
        },
        10_000,
        reconciliation.summary.difference_paise.saturating_abs(),
        &payload,
        actor,
        "inventory_reconciliation",
        "",
    )
    .await?;
    inventory_repository::escalate_automation_actions(
        &state.db,
        tenant_id,
        branch_id,
        policy.escalation_minutes,
    )
    .await
    .map_err(|_| AppError::internal("failed to escalate autonomous inventory approvals"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn queue_automation_action(
    state: &AppState,
    policy: &InventoryAutomationPolicy,
    action_type: &str,
    status: &str,
    dedupe_key: &str,
    title: &str,
    rationale: &str,
    confidence_bps: i32,
    estimated_cost_paise: i64,
    payload: &serde_json::Value,
    actor: &str,
    resource_type: &str,
    resource_id: &str,
) -> Result<(), AppError> {
    if let Some(action) = inventory_repository::create_automation_action(
        &state.db,
        &policy.tenant_id,
        &policy.branch_id,
        action_type,
        status,
        dedupe_key,
        title,
        rationale,
        confidence_bps,
        estimated_cost_paise,
        payload,
        actor,
        resource_type,
        resource_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to queue autonomous inventory action"))?
    {
        if action.status != "completed" {
            inventory_repository::notify_automation_action(
                &state.db,
                &policy.tenant_id,
                &policy.branch_id,
                &action,
            )
            .await
            .map_err(|_| AppError::internal("failed to notify autonomous inventory action"))?;
        }
    }
    Ok(())
}

async fn execute_approved_action(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    action: &InventoryAutomationAction,
) -> Result<(String, String), AppError> {
    match action.action_type.as_str() {
        "transfer_draft" | "expiry_rescue" => {
            let transfer = execute_approved_transfer(
                state,
                tenant_id,
                branch_id,
                actor,
                &action.payload_json,
                action.action_type == "expiry_rescue",
            )
            .await?;
            Ok(("inventory_transfer".into(), transfer.transfer.id))
        }
        "po_draft" => {
            let order_id = json_text(&action.payload_json, "purchaseOrderId")?;
            let current =
                purchase_service::order_details(state, tenant_id, branch_id, &order_id).await?;
            if current.order.status == "draft" {
                purchase_service::transition_order(
                    state,
                    tenant_id,
                    branch_id,
                    &order_id,
                    actor,
                    "submit",
                    "Autonomous PO draft reviewed",
                )
                .await?;
            } else if !matches!(
                current.order.status.as_str(),
                "pending_approval" | "approved" | "partially_received" | "closed"
            ) {
                return Err(AppError::conflict(
                    "purchase order draft is no longer reviewable",
                ));
            }
            Ok(("purchase_order".into(), order_id))
        }
        "reconciliation" => {
            let today = Utc::now().date_naive();
            let reconciliation =
                gl_reconciliation(state, tenant_id, branch_id, today, false).await?;
            let metrics =
                inventory_repository::command_center_metrics(&state.db, tenant_id, branch_id)
                    .await
                    .map_err(|_| {
                        AppError::internal("failed to revalidate inventory reconciliation")
                    })?;
            let issue_count =
                reconciliation.summary.unreconciled as i64 + metrics.ledger_trust_exceptions;
            if issue_count > 0 {
                return Err(AppError::conflict(
                    "inventory reconciliation still has unresolved GL or Digital Twin exceptions",
                ));
            }
            Ok(("inventory_reconciliation".into(), today.to_string()))
        }
        _ => Err(AppError::validation(
            "autonomous inventory action type is invalid",
        )),
    }
}

async fn execute_approved_transfer(
    state: &AppState,
    tenant_id: &str,
    action_branch_id: &str,
    actor: &str,
    payload: &serde_json::Value,
    source_scoped: bool,
) -> Result<inventory_transfer_service::TransferDetails, AppError> {
    let source_branch = json_text(payload, "sourceBranchId")?;
    let destination_branch = json_text(payload, "destinationBranchId")?;
    let expected_action_branch = if source_scoped {
        &source_branch
    } else {
        &destination_branch
    };
    if expected_action_branch != action_branch_id {
        return Err(AppError::conflict(
            "transfer scope no longer matches the approved action branch",
        ));
    }
    let source_item = json_text(payload, "sourceInventoryItemId")?;
    let destination_item = json_text(payload, "destinationInventoryItemId")?;
    let quantity = payload["quantity"]
        .as_i64()
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| AppError::validation("transfer draft quantity is invalid"))?;
    let batch_id = payload["batchId"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let today = Utc::now().date_naive();
    let still_safe = inventory_repository::transfer_opportunities(
        &state.db,
        tenant_id,
        &destination_branch,
        250,
    )
    .await
    .map_err(|_| AppError::internal("failed to revalidate transfer draft"))?
    .into_iter()
    .any(|option| {
        option.source_branch_id == source_branch
            && option.destination_branch_id == destination_branch
            && option.source_inventory_item_id == source_item
            && option.destination_inventory_item_id == destination_item
            && option.suggested_quantity >= quantity
            && option.source_safe
            && option.cost_decision != "purchase"
            && match batch_id {
                Some(batch_id) => {
                    option.earliest_batch_id.as_deref() == Some(batch_id)
                        && matches!(option.earliest_expiry_date, Some(date) if date >= today)
                        && option.earliest_batch_quantity.unwrap_or_default() >= quantity
                }
                None => true,
            }
    });
    if !still_safe {
        return Err(AppError::conflict(if batch_id.is_some() {
            "expiry rescue is stale; the batch, demand, safety, quantity, or cost changed"
        } else {
            "transfer draft is stale; live stock, demand, safety, or cost no longer supports it"
        }));
    }
    inventory_transfer_service::dispatch(
        state,
        tenant_id,
        &source_branch,
        actor,
        inventory_transfer_service::TransferInput {
            destination_branch_id: destination_branch,
            idempotency_key: json_text(payload, "idempotencyKey")?,
            notes: json_text(payload, "notes")?,
            lines: vec![inventory_transfer_service::TransferLineInput {
                source_inventory_item_id: source_item,
                destination_inventory_item_id: destination_item,
                quantity,
            }],
        },
    )
    .await
}

fn json_text(value: &serde_json::Value, key: &str) -> Result<String, AppError> {
    value[key]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation(format!("automation payload {key} is missing")))
}

fn recommendation_cost_paise(
    recommendation: &crate::repositories::inventory_reorder_forecast_repository::Recommendation,
) -> i64 {
    let taxable =
        i64::from(recommendation.suggested_quantity).saturating_mul(recommendation.unit_cost_paise);
    let gst = recommendation.explanation["gstPercent"]
        .as_i64()
        .unwrap_or_default()
        .clamp(0, 100);
    taxable.saturating_add(taxable.saturating_mul(gst) / 100)
}

fn budget_allows(remaining_paise: i64, cost_paise: i64) -> bool {
    cost_paise > 0 && cost_paise <= remaining_paise
}

fn spendable_budget(
    monthly_budget_paise: i64,
    position: &inventory_repository::InventoryAutomationBudgetPosition,
) -> i64 {
    monthly_budget_paise
        .saturating_sub(position.purchase_commitment_paise)
        .min(
            position
                .available_cash_paise
                .saturating_sub(position.pending_expense_paise)
                .saturating_sub(position.purchase_commitment_paise),
        )
        .max(0)
}

fn normalize_category_budgets(value: Value) -> Result<Value, AppError> {
    let budgets = value
        .as_object()
        .ok_or_else(|| AppError::validation("category budgets must be an object"))?;
    if budgets.len() > 100 {
        return Err(AppError::validation(
            "category budgets cannot exceed 100 categories",
        ));
    }
    let mut normalized = Map::new();
    for (category, value) in budgets {
        let category = category.trim().to_ascii_lowercase();
        let amount = value
            .as_i64()
            .filter(|amount| *amount >= 0)
            .ok_or_else(|| AppError::validation("category budget must be non-negative paise"))?;
        if category.is_empty()
            || category.len() > 120
            || normalized.insert(category, amount.into()).is_some()
        {
            return Err(AppError::validation(
                "category budget names are invalid or duplicated",
            ));
        }
    }
    Ok(Value::Object(normalized))
}

fn default_automation_policy(tenant_id: &str, branch_id: &str) -> InventoryAutomationPolicy {
    let now = Utc::now();
    InventoryAutomationPolicy {
        tenant_id: tenant_id.into(),
        branch_id: branch_id.into(),
        enabled: false,
        auto_transfer_drafts: true,
        auto_po_drafts: true,
        monthly_budget_paise: 0,
        category_budgets_paise: serde_json::json!({}),
        expiry_rescue_days: 30,
        run_interval_minutes: 1_440,
        escalation_minutes: 240,
        min_confidence_bps: 7_000,
        last_run_at: None,
        next_run_at: now,
        updated_at: now,
    }
}

fn cost_decision(transfer: Option<i64>, purchase: Option<i64>) -> &'static str {
    match (transfer, purchase) {
        (Some(transfer), Some(purchase)) if transfer < purchase => "transfer",
        (Some(transfer), Some(purchase)) if transfer > purchase => "purchase",
        (Some(_), Some(_)) => "equal",
        _ => "cost_review",
    }
}

fn coverage_days(stock: i32, daily_usage: f64) -> Option<f64> {
    (daily_usage > 0.0).then(|| ((f64::from(stock) / daily_usage) * 10.0).round() / 10.0)
}

fn exception_recommendations(
    evidence_rows: Vec<InventoryExceptionEvidence>,
    expiring_rows: &[ExpiryControlRow],
    limit: usize,
) -> Vec<InventoryExceptionRecommendation> {
    let mut rows = evidence_rows
        .into_iter()
        .filter_map(exception_recommendation)
        .collect::<Vec<_>>();
    rows.extend(expiring_rows.iter().map(|row| {
        seal_recommendation(InventoryExceptionRecommendation {
            key: format!("near_expiry:{}:{}", row.product_id, row.batch_id),
            category: "near_expiry".into(),
            evidence_hash: String::new(),
            severity: if row.days_to_expiry < 0 { "critical" } else { "warning" }.into(),
            title: format!("{} · batch {}", row.product_name, row.batch_number),
            explanation: if row.days_to_expiry < 0 {
                format!("Batch expired {} days ago; FEFO must not issue it.", row.days_to_expiry.saturating_abs())
            } else {
                format!("Batch reaches expiry in {} days and is inside the branch policy window.", row.days_to_expiry)
            },
            recommended_action: "Review FEFO allocation; approve transfer, consumption priority or disposal with batch evidence.".into(),
            confidence_bps: 10_000,
            evidence: serde_json::json!({
                "productId": row.product_id,
                "batchId": row.batch_id,
                "batchNumber": row.batch_number,
                "expiryDate": row.expiry_date,
                "daysToExpiry": row.days_to_expiry,
            }),
            route: "/inventory/advanced-controls".into(),
            approval: recommendation_approval(),
        })
    }));
    rows.sort_by(|left, right| {
        severity_rank(&right.severity)
            .cmp(&severity_rank(&left.severity))
            .then_with(|| right.confidence_bps.cmp(&left.confidence_bps))
            .then_with(|| left.key.cmp(&right.key))
    });
    rows.truncate(limit);
    rows
}

fn exception_recommendation(
    row: InventoryExceptionEvidence,
) -> Option<InventoryExceptionRecommendation> {
    let number = |key: &str| {
        row.evidence
            .get(key)
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0)
    };
    let (category, title, explanation, recommended_action, route) = match row.exception_type.as_str() {
        "consumption_variance" => (
            "consumption_variance",
            format!("{} · consumption variance", row.subject),
            format!("Expected {} but recorded {}; the difference crossed the branch variance policy.", number("expectedQuantity"), number("actualQuantity")),
            "Review service, staff and container evidence; approve wastage or correction before stock posting.",
            "/inventory/backbar",
        ),
        "unusual_usage" => (
            "unusual_staff_product_usage",
            format!("{} · unusual usage", row.subject),
            format!("7-day usage is {} versus {} across the preceding 21 days, above the normalized baseline.", number("current7DayQuantity"), number("prior21DayQuantity")),
            "Compare appointments and staff attribution; approve any correction through the governed backbar flow.",
            "/inventory/backbar",
        ),
        "irregular_purchase" => (
            "duplicate_or_irregular_purchase",
            format!("{} · purchase review", row.subject),
            if number("duplicateCount") > 1 {
                format!("The same supplier and bill number appears {} times.", number("duplicateCount"))
            } else {
                format!("Bill extraction carries {} warning(s) and needs human verification.", number("warningCount"))
            },
            "Hold confirmation; match supplier, bill number, PO and GRN before approval.",
            "/purchase-bill-drafts",
        ),
        "supplier_delay" => (
            "supplier_delay",
            format!("{} · supplier delay", row.subject),
            format!("The approved purchase order is {} days past its expected date.", number("daysOverdue")),
            "Review supplier status, escalate communication and approve any replacement or PO change.",
            "/purchase-orders",
        ),
        "negative_stock" => (
            "negative_stock",
            format!("{} · negative stock", row.subject),
            format!("Current stock is {}; a pending negative-stock request is included when present.", number("stockQuantity")),
            "Stop further issue, verify the ledger and resolve only through negative-stock approval.",
            "/inventory/advanced-controls",
        ),
        "missing_recipe" => (
            "missing_recipe",
            format!("{} · missing recipe", row.subject),
            format!("No product recipe exists while {} appointment(s) are scheduled in the next 15 days.", number("upcomingAppointments")),
            "Create the service recipe, review quantities and obtain inventory approval before consumption.",
            "/inventory/recipes",
        ),
        "suspicious_adjustment" => (
            "suspicious_adjustment",
            format!("{} · adjustment review", row.subject),
            format!("Quantity changed by {} from a stock-before value of {}; {} related adjustment(s) occurred within 24 hours.", number("quantityDelta"), number("stockBeforeQuantity"), number("repeatCount24h")),
            "Verify reason, actor and count evidence; post any correction only through the audited approval workflow.",
            "/inventory/advanced-controls",
        ),
        "container_violation" => (
            "container_rule_violation",
            format!("{} · container rule violation", row.subject),
            format!("Persisted container state conflicts with its lifecycle evidence ({} open container(s), {} remaining).", number("openCount"), number("remainingQuantity")),
            "Block consumption and use a maker-checker container override to restore the lifecycle state.",
            "/inventory/backbar/containers",
        ),
        _ => return None,
    };
    Some(seal_recommendation(InventoryExceptionRecommendation {
        key: format!("{}:{}", category, row.entity_id),
        category: category.into(),
        evidence_hash: String::new(),
        severity: row.severity,
        title,
        explanation,
        recommended_action: recommended_action.into(),
        confidence_bps: row.confidence_bps.clamp(0, 10_000),
        evidence: row.evidence,
        route: route.into(),
        approval: recommendation_approval(),
    }))
}

fn recommendation_approval() -> InventoryRecommendationApproval {
    InventoryRecommendationApproval {
        required: true,
        status: "review_required".into(),
        mode: "manual_maker_checker".into(),
        route: String::new(),
        reviewed_by: None,
        reviewed_at: None,
        review_note: String::new(),
    }
}

fn seal_recommendation(
    mut recommendation: InventoryExceptionRecommendation,
) -> InventoryExceptionRecommendation {
    let mut hasher = Sha256::new();
    hasher.update(recommendation.key.as_bytes());
    hasher.update(recommendation.category.as_bytes());
    hasher.update(serde_json::to_vec(&recommendation.evidence).unwrap_or_default());
    recommendation.evidence_hash = format!("{:x}", hasher.finalize());
    recommendation.approval.route = format!(
        "/api/v1/inventory/exception-recommendations/{}/review",
        recommendation.key
    );
    recommendation
}

fn apply_exception_reviews(
    recommendations: &mut [InventoryExceptionRecommendation],
    reviews: Vec<InventoryExceptionReviewRecord>,
) {
    let reviews = reviews
        .into_iter()
        .map(|review| {
            (
                (
                    review.recommendation_key.clone(),
                    review.evidence_hash.clone(),
                ),
                review,
            )
        })
        .collect::<HashMap<_, _>>();
    for recommendation in recommendations {
        if let Some(review) = reviews.get(&(
            recommendation.key.clone(),
            recommendation.evidence_hash.clone(),
        )) {
            recommendation.approval.status = review.decision.clone();
            recommendation.approval.reviewed_by = Some(review.reviewed_by.clone());
            recommendation.approval.reviewed_at = Some(review.reviewed_at.to_owned());
            recommendation.approval.review_note = review.review_note.clone();
        }
    }
}

pub async fn review_exception_recommendation(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    recommendation_key: &str,
    evidence_hash: &str,
    decision: &str,
    review_note: &str,
    reviewed_by: &str,
) -> Result<InventoryExceptionReviewRecord, AppError> {
    let decision = match decision.trim().to_ascii_lowercase().as_str() {
        "approve" | "approved" => "approved",
        "reject" | "rejected" => "rejected",
        _ => return Err(AppError::validation("decision must be approve or reject")),
    };
    if decision == "rejected" && review_note.trim().is_empty() {
        return Err(AppError::validation(
            "reviewNote is required when rejecting",
        ));
    }
    let recommendation = command_center(state, tenant_id, branch_id)
        .await?
        .recommendations
        .into_iter()
        .find(|row| row.key == recommendation_key && row.evidence_hash == evidence_hash)
        .ok_or_else(|| {
            AppError::validation("recommendation evidence is stale or no longer active")
        })?;
    inventory_repository::record_exception_review(
        &state.db,
        tenant_id,
        branch_id,
        recommendation_key,
        &recommendation.category,
        evidence_hash,
        decision,
        review_note.trim(),
        reviewed_by,
    )
    .await
    .map_err(|_| AppError::internal("failed to record inventory exception review"))
}

fn command_center_summary(
    metrics: &InventoryCommandCenterMetrics,
    controls: &AdvancedControlsResponse,
    reconciliation: &GlReconciliationResponse,
    transfer_opportunities: i64,
) -> InventoryCommandCenterSummary {
    let consumption_variance_quantity = metrics
        .consumption_actual_quantity
        .saturating_sub(metrics.consumption_expected_quantity);
    let consumption_variance_bps = if metrics.consumption_expected_quantity == 0 {
        i64::from(metrics.consumption_actual_quantity > 0) * 10_000
    } else {
        consumption_variance_quantity.saturating_mul(10_000) / metrics.consumption_expected_quantity
    };
    InventoryCommandCenterSummary {
        total_stock_value_paise: reconciliation.summary.inventory_value_paise,
        stockout_risk: metrics.stockout_risk,
        overstock_risk: metrics.overstock_risk,
        expiry_risk: controls.summary.expiry_alerts.unwrap_or(0),
        dead_stock: controls.summary.dead_stock as i64,
        open_purchase_orders: metrics.open_purchase_orders,
        in_transit_stock: metrics.in_transit_stock,
        consumption_variance_quantity,
        consumption_variance_bps,
        audit_exceptions: metrics
            .open_stock_audits
            .saturating_add(metrics.ledger_trust_exceptions),
        gl_mismatch_paise: reconciliation.summary.difference_paise,
        pending_approvals: metrics.pending_approvals,
        supplier_risk: metrics.supplier_risk,
        transfer_opportunities,
    }
}

fn command_center_signals(
    summary: &InventoryCommandCenterSummary,
    variance_threshold_bps: i64,
) -> Vec<InventoryCommandCenterSignal> {
    let signal = |key: &str,
                  group: &str,
                  label: &str,
                  detail: String,
                  severity: &str,
                  metric: &str,
                  metric_value: i64,
                  route: &str| InventoryCommandCenterSignal {
        key: key.into(),
        group: group.into(),
        label: label.into(),
        detail,
        severity: severity.into(),
        metric: metric.into(),
        metric_value,
        route: route.into(),
        action_label: "Open".into(),
    };
    vec![
        signal(
            "stock_value",
            "stock",
            "Total stock value",
            "Ledger movement-cost valuation".into(),
            "info",
            "money",
            summary.total_stock_value_paise,
            "/inventory/valuation",
        ),
        signal(
            "stock_risk",
            "stock",
            "Stockout / overstock risk",
            format!(
                "{} stockout · {} overstock",
                summary.stockout_risk, summary.overstock_risk
            ),
            if summary.stockout_risk > 0 {
                "critical"
            } else if summary.overstock_risk > 0 {
                "warning"
            } else {
                "healthy"
            },
            "count",
            summary.stockout_risk.saturating_add(summary.overstock_risk),
            "/inventory/reorder",
        ),
        signal(
            "expiry_dead_stock",
            "stock",
            "Expiry / dead stock",
            format!(
                "{} expiry · {} dead stock",
                summary.expiry_risk, summary.dead_stock
            ),
            if summary.expiry_risk > 0 || summary.dead_stock > 0 {
                "warning"
            } else {
                "healthy"
            },
            "count",
            summary.expiry_risk.saturating_add(summary.dead_stock),
            "/inventory/advanced-controls",
        ),
        signal(
            "purchase_flow",
            "flow",
            "Open PO / in-transit stock",
            format!(
                "{} open PO · {} transfers",
                summary.open_purchase_orders, summary.in_transit_stock
            ),
            if summary.open_purchase_orders > 0 || summary.in_transit_stock > 0 {
                "info"
            } else {
                "healthy"
            },
            "count",
            summary
                .open_purchase_orders
                .saturating_add(summary.in_transit_stock),
            "/purchase-orders",
        ),
        signal(
            "consumption_variance",
            "flow",
            "Consumption variance",
            format!(
                "30 days · quantity variance {}",
                summary.consumption_variance_quantity
            ),
            if summary.consumption_variance_bps.saturating_abs() > variance_threshold_bps {
                "warning"
            } else {
                "healthy"
            },
            "percent",
            summary.consumption_variance_bps,
            "/inventory/backbar",
        ),
        signal(
            "audit_gl",
            "flow",
            "Audit / GL mismatch",
            format!("{} audit exceptions", summary.audit_exceptions),
            if summary.audit_exceptions > 0 || summary.gl_mismatch_paise.saturating_abs() > 1 {
                "critical"
            } else {
                "healthy"
            },
            if summary.gl_mismatch_paise.saturating_abs() > 1 {
                "money"
            } else {
                "count"
            },
            if summary.gl_mismatch_paise.saturating_abs() > 1 {
                summary.gl_mismatch_paise.saturating_abs()
            } else {
                summary.audit_exceptions
            },
            "/inventory/gl-reconciliation",
        ),
        signal(
            "pending_approvals",
            "governance",
            "Pending approvals",
            "PO, usage, stock and audit approvals".into(),
            if summary.pending_approvals > 0 {
                "warning"
            } else {
                "healthy"
            },
            "count",
            summary.pending_approvals,
            "/inventory/advanced-controls",
        ),
        signal(
            "supplier_risk",
            "governance",
            "Supplier risk",
            "Delivery, fill-rate and recent return evidence".into(),
            if summary.supplier_risk > 0 {
                "warning"
            } else {
                "healthy"
            },
            "count",
            summary.supplier_risk,
            "/suppliers",
        ),
        signal(
            "transfer_opportunities",
            "governance",
            "Branch transfer opportunities",
            "Same-SKU shortage matched to branch surplus".into(),
            if summary.transfer_opportunities > 0 {
                "info"
            } else {
                "healthy"
            },
            "count",
            summary.transfer_opportunities,
            "/inventory/transfers",
        ),
    ]
}

fn build_response(
    items: Vec<InventoryControlItem>,
    counts: InventoryControlCounts,
    batches: Vec<InventoryBatchRecord>,
    now: DateTime<Utc>,
    dead_stock_days: i64,
    expiry_window_days: i64,
    limit: usize,
    branch_id: &str,
    branch_name: &str,
) -> AdvancedControlsResponse {
    let mut exception_rows = Vec::new();
    let mut dead_stock_rows = Vec::new();
    let mut expiring_rows = batches
        .into_iter()
        .filter_map(|batch| {
            let expiry = batch.expiry_date?;
            let days = (expiry - now.date_naive()).num_days();
            (batch.quantity > 0 && days <= expiry_window_days).then_some(ExpiryControlRow {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                batch_id: batch.id,
                product_id: batch.inventory_item_id,
                product_name: batch.product_name,
                batch_number: batch.batch_number,
                expiry_date: expiry.to_string(),
                days_to_expiry: days,
            })
        })
        .collect::<Vec<_>>();
    expiring_rows.sort_by_key(|row| row.days_to_expiry);
    expiring_rows.truncate(limit);

    for item in items {
        let value_paise = i64::from(item.stock_quantity).saturating_mul(item.unit_cost_paise);
        if item.stock_quantity > 0 && item.unit_cost_paise <= 0 {
            exception_rows.push(ControlException {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                severity: "critical".into(),
                control: "Costing".into(),
                title: format!("{} has stock without unit cost", item.name),
                value_paise: 0,
                evidence: item.sku.clone(),
                owner: "Inventory".into(),
                status: "open".into(),
                route: "/inventory".into(),
            });
        }
        if item.stock_quantity <= item.reorder_point {
            exception_rows.push(ControlException {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                severity: "warning".into(),
                control: "Reorder".into(),
                title: format!("{} is at or below reorder point", item.name),
                value_paise: value_paise.max(0),
                evidence: format!(
                    "stock {} / reorder {}",
                    item.stock_quantity, item.reorder_point
                ),
                owner: "Inventory".into(),
                status: "open".into(),
                route: "/inventory".into(),
            });
        }

        let inactive_days = inactive_days(item.last_outbound_at, item.created_at, now);
        if item.stock_quantity > 0 && inactive_days >= dead_stock_days {
            let severity = if inactive_days >= dead_stock_days.saturating_mul(2) {
                "critical"
            } else {
                "warning"
            };
            dead_stock_rows.push(DeadStockRow {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                product_id: item.id.clone(),
                product_name: item.name.clone(),
                sku: item.sku.clone(),
                stock_quantity: item.stock_quantity,
                inactive_days,
                value_paise: value_paise.max(0),
                last_outbound_at: item.last_outbound_at,
            });
            exception_rows.push(ControlException {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                severity: severity.into(),
                control: "Dead stock".into(),
                title: format!(
                    "{} has no outbound movement for {} days",
                    item.name, inactive_days
                ),
                value_paise: value_paise.max(0),
                evidence: item.sku,
                owner: "Inventory".into(),
                status: "open".into(),
                route: "/inventory".into(),
            });
        }
    }

    if counts.in_transit_transfers > 0 {
        exception_rows.push(ControlException {
            branch_id: branch_id.to_string(),
            branch_name: branch_name.to_string(),
            severity: "warning".into(),
            control: "Transfers".into(),
            title: "Inventory transfers are awaiting receipt".into(),
            value_paise: 0,
            evidence: format!("{} in transit", counts.in_transit_transfers),
            owner: "Receiving".into(),
            status: "open".into(),
            route: "/inventory".into(),
        });
    }
    for row in &expiring_rows {
        exception_rows.push(ControlException {
            branch_id: branch_id.to_string(),
            branch_name: branch_name.to_string(),
            severity: if row.days_to_expiry < 0 {
                "critical"
            } else {
                "warning"
            }
            .into(),
            control: "Expiry".into(),
            title: format!(
                "{} batch {} {}",
                row.product_name,
                row.batch_number,
                if row.days_to_expiry < 0 {
                    "has expired"
                } else {
                    "is nearing expiry"
                }
            ),
            value_paise: 0,
            evidence: format!("{} days", row.days_to_expiry),
            owner: "Inventory".into(),
            status: "open".into(),
            route: "/inventory/advanced-controls".into(),
        });
    }

    exception_rows.sort_by(|a, b| {
        severity_rank(&b.severity)
            .cmp(&severity_rank(&a.severity))
            .then_with(|| b.value_paise.cmp(&a.value_paise))
    });
    exception_rows.truncate(limit);
    dead_stock_rows.sort_by(|a, b| b.value_paise.cmp(&a.value_paise));
    dead_stock_rows.truncate(limit);

    let critical = exception_rows
        .iter()
        .filter(|row| row.severity == "critical")
        .count();
    let warnings = exception_rows.len().saturating_sub(critical);

    AdvancedControlsResponse {
        summary: ControlSummary {
            critical,
            warnings,
            pending_approvals: counts.pending_purchase_orders,
            expiry_alerts: Some(expiring_rows.len() as i64),
            dead_stock: dead_stock_rows.len(),
        },
        capabilities: ControlCapabilities {
            approval_matrix: true,
            audit_locks: true,
            expiry: true,
            dead_stock: true,
        },
        approval_matrix: vec![ApprovalControl {
            branch_id: branch_id.to_string(),
            branch_name: branch_name.to_string(),
            control: "Purchase order approval".into(),
            required_role: "Owner, admin, manager or inventory manager".into(),
            pending: counts.pending_purchase_orders,
            gate: "Pending orders require approval before receiving".into(),
            route: "/purchase-orders".into(),
        }],
        audit_locks: vec![
            AuditLock {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                lock: "Stock adjustment ledger".into(),
                locked: counts.adjustment_entries,
                reason: "Stock corrections are recorded as ledger entries".into(),
                route: "/inventory".into(),
            },
            AuditLock {
                branch_id: branch_id.to_string(),
                branch_name: branch_name.to_string(),
                lock: "In-transit stock".into(),
                locked: counts.in_transit_transfers,
                reason: "Dispatched stock remains in transit until received or cancelled".into(),
                route: "/inventory".into(),
            },
        ],
        expiring_rows,
        dead_stock_rows,
        exception_rows,
    }
}

fn build_reorder_suggestions(items: Vec<InventoryControlItem>) -> Vec<ReorderSuggestion> {
    let mut rows = items
        .into_iter()
        .filter(|item| item.stock_quantity <= item.reorder_point)
        .map(|item| {
            let suggested_quantity = item
                .reorder_point
                .saturating_sub(item.stock_quantity)
                .max(1);
            let priority = if item.stock_quantity <= 0 {
                "critical"
            } else if item.stock_quantity < item.reorder_point {
                "high"
            } else {
                "medium"
            };
            ReorderSuggestion {
                product_id: item.id,
                product_name: item.name,
                sku: item.sku,
                current_stock: item.stock_quantity,
                reorder_level: item.reorder_point,
                suggested_quantity,
                priority: priority.into(),
                reason: if item.stock_quantity <= 0 {
                    "Out of stock".into()
                } else {
                    "At or below reorder level".into()
                },
                estimated_value_paise: i64::from(suggested_quantity)
                    .saturating_mul(item.unit_cost_paise.max(0)),
            }
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| {
        severity_rank(&b.priority)
            .cmp(&severity_rank(&a.priority))
            .then_with(|| a.product_name.cmp(&b.product_name))
    });
    rows
}

fn inactive_days(
    last_outbound_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> i64 {
    (now - last_outbound_at.unwrap_or(created_at))
        .num_days()
        .max(0)
}

fn severity_rank(value: &str) -> u8 {
    match value {
        "critical" => 2,
        "high" | "warning" => 1,
        _ => 0,
    }
}

fn reconciliation_status(difference_paise: i64, missing_cost_products: i64) -> &'static str {
    if difference_paise.saturating_abs() <= 1 && missing_cost_products == 0 {
        "matched"
    } else {
        "unreconciled"
    }
}

#[cfg(test)]
mod tests {
    use super::{
        budget_allows, build_reorder_suggestions, command_center_signals, cost_decision,
        coverage_days, exception_recommendations, inactive_days, reconciliation_status,
        spendable_budget, ExpiryControlRow, InventoryCommandCenterSummary,
    };
    use crate::repositories::inventory_repository::{
        self, InventoryControlItem, InventoryExceptionEvidence,
    };
    use chrono::{TimeZone, Utc};

    #[test]
    fn inactivity_uses_latest_real_outbound_date() {
        let created = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let outbound = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 14, 0, 0, 0).unwrap();
        assert_eq!(inactive_days(Some(outbound), created, now), 13);
        assert_eq!(inactive_days(None, created, now), 194);
    }

    #[test]
    fn reconciliation_allows_one_paise_rounding_only_when_costs_exist() {
        assert_eq!(reconciliation_status(1, 0), "matched");
        assert_eq!(reconciliation_status(-1, 0), "matched");
        assert_eq!(reconciliation_status(2, 0), "unreconciled");
        assert_eq!(reconciliation_status(0, 1), "unreconciled");
    }

    #[test]
    fn reorder_suggestions_use_real_stock_gap_and_prioritize_stockouts() {
        let now = Utc.with_ymd_and_hms(2026, 7, 14, 0, 0, 0).unwrap();
        let rows = build_reorder_suggestions(vec![
            InventoryControlItem {
                id: "low".into(),
                sku: "LOW".into(),
                name: "Low".into(),
                stock_quantity: 3,
                reorder_point: 5,
                unit_cost_paise: 100,
                created_at: now,
                last_outbound_at: None,
            },
            InventoryControlItem {
                id: "out".into(),
                sku: "OUT".into(),
                name: "Out".into(),
                stock_quantity: 0,
                reorder_point: 4,
                unit_cost_paise: 250,
                created_at: now,
                last_outbound_at: None,
            },
            InventoryControlItem {
                id: "ok".into(),
                sku: "OK".into(),
                name: "Ok".into(),
                stock_quantity: 8,
                reorder_point: 5,
                unit_cost_paise: 100,
                created_at: now,
                last_outbound_at: None,
            },
        ]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].product_id, "out");
        assert_eq!(rows[0].suggested_quantity, 4);
        assert_eq!(rows[1].suggested_quantity, 2);
    }

    #[test]
    fn command_center_exposes_nine_direct_actions() {
        let summary = InventoryCommandCenterSummary {
            total_stock_value_paise: 10_000,
            stockout_risk: 1,
            overstock_risk: 2,
            expiry_risk: 3,
            dead_stock: 4,
            open_purchase_orders: 5,
            in_transit_stock: 6,
            consumption_variance_quantity: 2,
            consumption_variance_bps: 750,
            audit_exceptions: 1,
            gl_mismatch_paise: 500,
            pending_approvals: 2,
            supplier_risk: 1,
            transfer_opportunities: 3,
        };
        let signals = command_center_signals(&summary, 500);
        assert_eq!(signals.len(), 9);
        assert!(signals.iter().all(|signal| signal.route.starts_with('/')));
        assert_eq!(signals[4].severity, "warning");
    }

    #[test]
    fn exception_engine_covers_nine_explainable_approval_controlled_categories() {
        let evidence = [
            ("consumption_variance", serde_json::json!({"expectedQuantity": 1, "actualQuantity": 2})),
            ("unusual_usage", serde_json::json!({"current7DayQuantity": 4, "prior21DayQuantity": 2})),
            ("irregular_purchase", serde_json::json!({"duplicateCount": 2})),
            ("supplier_delay", serde_json::json!({"daysOverdue": 5})),
            ("negative_stock", serde_json::json!({"stockQuantity": -1})),
            ("missing_recipe", serde_json::json!({"upcomingAppointments": 2})),
            ("suspicious_adjustment", serde_json::json!({"quantityDelta": 8, "stockBeforeQuantity": 10, "repeatCount24h": 3})),
            ("container_violation", serde_json::json!({"openCount": 2, "remainingQuantity": 4})),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, (exception_type, evidence))| InventoryExceptionEvidence {
            exception_type: exception_type.into(),
            entity_id: index.to_string(),
            subject: "Real entity".into(),
            severity: "warning".into(),
            confidence_bps: 8_500,
            evidence,
        })
        .collect();
        let expiry = vec![ExpiryControlRow {
            branch_id: "branch".into(),
            branch_name: "Branch".into(),
            batch_id: "batch-id".into(),
            product_id: "product".into(),
            product_name: "Product".into(),
            batch_number: "batch".into(),
            expiry_date: "2026-07-30".into(),
            days_to_expiry: 7,
        }];
        let rows = exception_recommendations(evidence, &expiry, 50);
        assert_eq!(rows.len(), 9);
        assert!(rows.iter().all(|row| {
            !row.explanation.is_empty()
                && !row.recommended_action.is_empty()
                && (0..=10_000).contains(&row.confidence_bps)
                && row.route.starts_with('/')
                && row.evidence_hash.len() == 64
                && row.approval.required
                && row.approval.status == "review_required"
                && row.approval.route.ends_with("/review")
        }));
    }

    #[test]
    fn optimizer_compares_real_unit_cost_and_coverage() {
        assert_eq!(cost_decision(Some(900), Some(1_100)), "transfer");
        assert_eq!(cost_decision(Some(1_200), Some(1_100)), "purchase");
        assert_eq!(cost_decision(None, Some(1_100)), "cost_review");
        assert_eq!(coverage_days(15, 2.0), Some(7.5));
        assert_eq!(coverage_days(15, 0.0), None);
    }

    #[test]
    fn automation_budget_never_overcommits() {
        assert!(budget_allows(10_000, 10_000));
        assert!(!budget_allows(9_999, 10_000));
        assert!(!budget_allows(10_000, 0));
        let position = inventory_repository::InventoryAutomationBudgetPosition {
            purchase_commitment_paise: 2_000,
            pending_expense_paise: 1_000,
            available_cash_paise: 8_000,
        };
        assert_eq!(spendable_budget(10_000, &position), 5_000);
    }
}
