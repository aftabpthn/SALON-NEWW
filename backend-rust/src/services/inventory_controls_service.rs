use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;

use crate::{
    models::common::AppError,
    repositories::{
        branch_repository,
        inventory_repository::{
            self, InventoryBatchRecord, InventoryControlCounts, InventoryControlItem,
        },
    },
    services::accounting_service::INVENTORY_ASSET_ACCOUNT,
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
    pub control: String,
    pub required_role: String,
    pub pending: i64,
    pub gate: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLock {
    pub lock: String,
    pub locked: i64,
    pub reason: String,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryControlRow {
    pub product_id: String,
    pub product_name: String,
    pub batch_number: String,
    pub expiry_date: String,
    pub days_to_expiry: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadStockRow {
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
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub amount_paise: i64,
    pub route: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlAuditRow {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub memo: String,
    pub amount_paise: i64,
    pub created_at: DateTime<Utc>,
}

pub async fn advanced_controls(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    dead_stock_days: i64,
    expiry_window_days: i64,
    limit: usize,
) -> Result<AdvancedControlsResponse, AppError> {
    let (items, counts, batches) = tokio::try_join!(
        inventory_repository::control_items(&state.db, tenant_id, branch_id),
        inventory_repository::control_counts(&state.db, tenant_id, branch_id),
        inventory_repository::list_batches(&state.db, tenant_id, branch_id),
    )
    .map_err(|_| AppError::internal("failed to load inventory controls"))?;

    Ok(build_response(
        items,
        counts,
        batches,
        Utc::now(),
        dead_stock_days,
        expiry_window_days,
        limit,
    ))
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
) -> Result<GlReconciliationResponse, AppError> {
    let (snapshot, audit_rows, branches) = tokio::try_join!(
        inventory_repository::gl_reconciliation_snapshot(
            &state.db,
            tenant_id,
            branch_id,
            as_of,
            INVENTORY_ASSET_ACCOUNT,
        ),
        inventory_repository::gl_reconciliation_audit(
            &state.db,
            tenant_id,
            branch_id,
            as_of,
            INVENTORY_ASSET_ACCOUNT,
            100,
        ),
        branch_repository::list(&state.db, tenant_id, ""),
    )
    .map_err(|_| AppError::internal("failed to load inventory GL reconciliation"))?;

    let branch_name = branches
        .into_iter()
        .find(|branch| branch.id == branch_id)
        .map(|branch| branch.name)
        .unwrap_or_else(|| branch_id.to_string());
    let difference_paise = snapshot
        .inventory_value_paise
        .saturating_sub(snapshot.gl_value_paise);
    let status = reconciliation_status(difference_paise, snapshot.missing_cost_products);
    let mut exception_rows = Vec::new();

    if difference_paise.saturating_abs() > 1 {
        exception_rows.push(GlException {
            severity: "critical".into(),
            title: "Inventory value does not match the GL stock balance".into(),
            detail: format!("Account {INVENTORY_ASSET_ACCOUNT}"),
            amount_paise: difference_paise,
            route: "/inventory/gl-reconciliation".into(),
        });
    }
    if snapshot.missing_cost_products > 0 {
        exception_rows.push(GlException {
            severity: "warning".into(),
            title: "Products with stock are missing unit cost".into(),
            detail: format!("{} products", snapshot.missing_cost_products),
            amount_paise: 0,
            route: "/inventory".into(),
        });
    }

    let row = GlBranchRow {
        branch_id: branch_id.to_string(),
        branch_name,
        product_count: snapshot.product_count,
        inventory_value_paise: snapshot.inventory_value_paise,
        gl_value_paise: snapshot.gl_value_paise,
        difference_paise,
        missing_cost_products: snapshot.missing_cost_products,
        status: status.into(),
    };
    let unreconciled = usize::from(status != "matched");

    Ok(GlReconciliationResponse {
        as_of_date: as_of,
        account_code: INVENTORY_ASSET_ACCOUNT.into(),
        valuation_method: "ledger movement cost".into(),
        summary: GlReconciliationSummary {
            inventory_value_paise: row.inventory_value_paise,
            gl_value_paise: row.gl_value_paise,
            difference_paise: row.difference_paise,
            unreconciled,
        },
        rows: vec![row],
        exception_rows,
        audit_rows: audit_rows
            .into_iter()
            .map(|row| GlAuditRow {
                id: row.id,
                source_type: row.source_type,
                source_id: row.source_id,
                memo: row.memo,
                amount_paise: row.amount_paise,
                created_at: row.created_at,
            })
            .collect(),
    })
}

fn build_response(
    items: Vec<InventoryControlItem>,
    counts: InventoryControlCounts,
    batches: Vec<InventoryBatchRecord>,
    now: DateTime<Utc>,
    dead_stock_days: i64,
    expiry_window_days: i64,
    limit: usize,
) -> AdvancedControlsResponse {
    let mut exception_rows = Vec::new();
    let mut dead_stock_rows = Vec::new();
    let mut expiring_rows = batches
        .into_iter()
        .filter_map(|batch| {
            let expiry = batch.expiry_date?;
            let days = (expiry - now.date_naive()).num_days();
            (batch.quantity > 0 && days <= expiry_window_days).then_some(ExpiryControlRow {
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
                product_id: item.id.clone(),
                product_name: item.name.clone(),
                sku: item.sku.clone(),
                stock_quantity: item.stock_quantity,
                inactive_days,
                value_paise: value_paise.max(0),
                last_outbound_at: item.last_outbound_at,
            });
            exception_rows.push(ControlException {
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
            control: "Purchase order approval".into(),
            required_role: "Owner, admin, manager or inventory manager".into(),
            pending: counts.pending_purchase_orders,
            gate: "Pending orders require approval before receiving".into(),
            route: "/purchase-orders".into(),
        }],
        audit_locks: vec![
            AuditLock {
                lock: "Stock adjustment ledger".into(),
                locked: counts.adjustment_entries,
                reason: "Stock corrections are recorded as ledger entries".into(),
                route: "/inventory".into(),
            },
            AuditLock {
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
    use super::{build_reorder_suggestions, inactive_days, reconciliation_status};
    use crate::repositories::inventory_repository::InventoryControlItem;
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
}
