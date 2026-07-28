//! Read-only what-if simulation.
//!
//! A simulation answers "what would happen if" without anything happening. It
//! reads current figures, projects a range, and returns. It writes nothing: no
//! offer is created, no campaign is queued, no governance evaluation is
//! recorded. That is not a convention here, it is the point of the module, and
//! there is a test that fails if a write ever appears.
//!
//! Discount scenarios reach their verdict through the same
//! `profit_governance_service::discount_policy` the recorded evaluation uses, so
//! a simulation cannot approve something the real path would block. Reusing the
//! policy rather than restating it is what keeps the two from drifting apart.
//!
//! Every answer is a range. A projection stated as a single number would read
//! as a promise, and the inputs do not support one.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{ai_copilot_repository as copilot_repository, membership_lifecycle_repository},
    services::profit_governance_service,
};

/// Window every simulation reads its baseline from.
const BASELINE_DAYS: i32 = 30;
/// Rows to consider when a scenario scans a list.
const ROW_LIMIT: i64 = 25;
/// How wide a projected range is, either side of the point estimate.
///
/// A fifth is not a statistical interval; it is an honest admission that a
/// projection from one month of history is approximate.
const SPREAD_BPS: i64 = 2_000;

/// What is being simulated.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "scenario", rename_all = "camelCase")]
pub enum WhatIf {
    /// "What would a 10% discount do to profit?"
    #[serde(rename_all = "camelCase")]
    ServiceDiscount {
        /// Empty means the whole branch rather than one service.
        #[serde(default)]
        service_id: String,
        discount_percent: i64,
    },
    /// "What would two more weekday slots do to utilization?"
    #[serde(rename_all = "camelCase")]
    AddSlots {
        /// ISO weekday, 1 = Monday. Zero means spread across the week.
        #[serde(default)]
        weekday: i32,
        added_slots: i64,
        /// Minutes per slot; defaults to a standard appointment.
        #[serde(default)]
        slot_minutes: i64,
    },
    /// "What would a membership price change do to renewals?"
    #[serde(rename_all = "camelCase")]
    MembershipPrice { change_percent: i64 },
}

/// A projected quantity, always as a range.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactRange {
    pub label: String,
    /// The figure as it stands today, for comparison.
    pub baseline: String,
    pub lower: String,
    pub upper: String,
    pub unit: String,
    /// `up`, `down` or `flat` against the baseline.
    pub direction: String,
}

/// The outcome of a simulation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatIfResult {
    pub scenario: String,
    pub headline: String,
    /// Figures read from the CRM. Kept separate from the projection so a reader
    /// can always tell a recorded fact from an estimate.
    pub facts: Vec<String>,
    /// Projected effects. Estimates, never recorded values.
    pub impacts: Vec<ImpactRange>,
    /// Why the projection came out this way.
    pub reason: String,
    pub confidence: String,
    /// Set when the scenario would lose money or breach policy.
    pub warnings: Vec<String>,
    /// `allowed`, `needs_approval` or `blocked`, from Profit Governance.
    pub governance_decision: String,
    pub governance_reasons: Vec<String>,
    /// Always true. A simulation that changed anything would be a bug.
    pub read_only: bool,
    pub baseline_period_days: i32,
    pub data_sufficient: bool,
}

impl WhatIfResult {
    fn new(scenario: &str, headline: impl Into<String>) -> Self {
        Self {
            scenario: scenario.into(),
            headline: headline.into(),
            facts: Vec::new(),
            impacts: Vec::new(),
            reason: String::new(),
            confidence: "low".into(),
            warnings: Vec::new(),
            governance_decision: "not_applicable".into(),
            governance_reasons: Vec::new(),
            read_only: true,
            baseline_period_days: BASELINE_DAYS,
            data_sufficient: false,
        }
    }

    fn unavailable(scenario: &str, why: impl Into<String>) -> Self {
        let mut result = Self::new(scenario, format!("Data unavailable: {}", why.into()));
        result.reason = "There is not enough recorded history to project from.".into();
        result
    }
}

fn rupees(paise: i64) -> String {
    format!("₹{}.{:02}", paise / 100, (paise % 100).abs())
}

fn direction(baseline: i64, projected: i64) -> String {
    match projected.cmp(&baseline) {
        std::cmp::Ordering::Greater => "up",
        std::cmp::Ordering::Less => "down",
        std::cmp::Ordering::Equal => "flat",
    }
    .into()
}

/// Bounds around a point estimate, widened by `SPREAD_BPS`.
fn spread(value: i64) -> (i64, i64) {
    let margin = value.saturating_mul(SPREAD_BPS) / 10_000;
    (
        value.saturating_sub(margin.abs()),
        value.saturating_add(margin.abs()),
    )
}

/// Runs a simulation. Reads only.
pub async fn simulate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    scenario: WhatIf,
) -> Result<WhatIfResult, AppError> {
    // Every scenario projects money or capacity, so it is management
    // information. The check happens before any figure is read.
    if !can_simulate(role) {
        return Err(AppError::forbidden(
            "what-if simulation is not available for your role",
        ));
    }
    match scenario {
        WhatIf::ServiceDiscount {
            service_id,
            discount_percent,
        } => service_discount(db, tenant_id, branch_id, &service_id, discount_percent).await,
        WhatIf::AddSlots {
            weekday,
            added_slots,
            slot_minutes,
        } => add_slots(db, tenant_id, branch_id, weekday, added_slots, slot_minutes).await,
        WhatIf::MembershipPrice { change_percent } => {
            membership_price(db, tenant_id, branch_id, change_percent).await
        }
    }
}

fn can_simulate(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "accountant" | "analyst"
    )
}

/// "What would a discount do to profit?"
///
/// The verdict comes from Profit Governance rather than a local rule, so a
/// simulation cannot bless a discount the recorded evaluation would block.
async fn service_discount(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    discount_percent: i64,
) -> Result<WhatIfResult, AppError> {
    if !(0..=100).contains(&discount_percent) {
        return Err(AppError::validation(
            "discountPercent must be between 0 and 100",
        ));
    }
    let rows = copilot_repository::service_performance_trend(
        db,
        tenant_id,
        branch_id,
        BASELINE_DAYS,
        ROW_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service baseline"))?;

    let selected: Vec<_> = if service_id.is_empty() {
        rows.iter().collect()
    } else {
        rows.iter().filter(|row| row.service_id == service_id).collect()
    };
    if selected.is_empty() {
        return Ok(WhatIfResult::unavailable(
            "service_discount",
            "no service activity in the last 30 days to project from",
        ));
    }

    let revenue: i64 = selected.iter().map(|row| row.current_revenue_paise).sum();
    let product_cost: i64 = selected
        .iter()
        .map(|row| row.current_product_cost_paise)
        .sum();
    let bookings: i64 = selected.iter().map(|row| row.current_bookings).sum();
    if revenue <= 0 {
        return Ok(WhatIfResult::unavailable(
            "service_discount",
            "no recorded revenue in the last 30 days to project from",
        ));
    }

    let discount_paise = revenue.saturating_mul(discount_percent) / 100;
    let baseline_profit = revenue.saturating_sub(product_cost);
    // Held deliberately flat: this projects the price change alone, not a
    // guess at extra demand. Assuming volume growth is how a discount gets
    // talked into looking profitable.
    let projected_profit = revenue
        .saturating_sub(discount_paise)
        .saturating_sub(product_cost);
    let (lower, upper) = spread(projected_profit);

    // The same rules, and the same decision, as a recorded evaluation.
    let rules = profit_governance_service::list_rules(db, tenant_id, branch_id).await?;
    let margin_bps = projected_profit.saturating_mul(10_000) / revenue;
    let discount_bps = discount_paise.saturating_mul(10_000) / revenue;
    let outcome = profit_governance_service::discount_policy(
        &rules,
        projected_profit,
        margin_bps,
        discount_bps,
        discount_paise,
    );

    let mut warnings = Vec::new();
    if projected_profit < 0 {
        warnings.push(format!(
            "This discount is loss-making: projected profit {}.",
            rupees(projected_profit)
        ));
    }
    if projected_profit >= 0 && baseline_profit > 0 && projected_profit * 2 < baseline_profit {
        warnings.push("This discount removes more than half of the current profit.".into());
    }
    if rules.is_empty() {
        warnings
            .push("No profit governance rule is configured, so no policy limit was applied.".into());
    }

    let mut result = WhatIfResult::new(
        "service_discount",
        format!(
            "A {discount_percent}% discount projects profit of {} to {}.",
            rupees(lower),
            rupees(upper)
        ),
    );
    result.facts = vec![
        format!("Recorded revenue {} over the last 30 days.", rupees(revenue)),
        format!("Recorded product cost {}.", rupees(product_cost)),
        format!("Recorded profit {}.", rupees(baseline_profit)),
        format!("{bookings} bookings in the window."),
    ];
    result.impacts = vec![
        ImpactRange {
            label: "Profit".into(),
            baseline: rupees(baseline_profit),
            lower: rupees(lower),
            upper: rupees(upper),
            unit: "currency".into(),
            direction: direction(baseline_profit, projected_profit),
        },
        ImpactRange {
            label: "Discount given away".into(),
            baseline: rupees(0),
            lower: rupees(discount_paise),
            upper: rupees(discount_paise),
            unit: "currency".into(),
            direction: "up".into(),
        },
    ];
    result.reason = if projected_profit < 0 {
        "The discount is larger than the margin the service currently earns.".into()
    } else {
        "Projected at today's volume; extra demand is not assumed.".into()
    };
    result.warnings = warnings;
    result.governance_decision = outcome.decision.into();
    result.governance_reasons = outcome.reasons.iter().map(|value| (*value).to_string()).collect();
    result.confidence = if bookings >= 20 { "medium" } else { "low" }.into();
    result.data_sufficient = bookings > 0;
    Ok(result)
}

/// "What would extra slots do to utilization?"
async fn add_slots(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    weekday: i32,
    added_slots: i64,
    slot_minutes: i64,
) -> Result<WhatIfResult, AppError> {
    if !(1..=50).contains(&added_slots) {
        return Err(AppError::validation("addedSlots must be between 1 and 50"));
    }
    let slot_minutes = if slot_minutes > 0 { slot_minutes } else { 60 };
    let rows = copilot_repository::weekday_demand(db, tenant_id, branch_id, BASELINE_DAYS, "")
        .await
        .map_err(|_| AppError::internal("failed to load demand baseline"))?;

    let selected: Vec<_> = if weekday == 0 {
        rows.iter().collect()
    } else {
        rows.iter().filter(|row| row.weekday == weekday).collect()
    };
    let booked: i64 = selected.iter().map(|row| row.booked_minutes).sum();
    let scheduled: i64 = selected.iter().map(|row| row.scheduled_minutes).sum();
    if scheduled <= 0 {
        return Ok(WhatIfResult::unavailable(
            "add_slots",
            "nobody was rostered in this window, so utilization cannot be projected",
        ));
    }

    let added_minutes = added_slots.saturating_mul(slot_minutes);
    let baseline_utilization = booked.saturating_mul(100) / scheduled;
    // Adding capacity without adding demand lowers utilization. Showing that
    // plainly is the point: it is the honest read, and the opposite of what
    // "add slots" is usually assumed to do.
    let projected_utilization = booked.saturating_mul(100) / (scheduled + added_minutes);
    let (lower, upper) = spread(projected_utilization);

    let mut result = WhatIfResult::new(
        "add_slots",
        format!(
            "Adding {added_slots} slot(s) projects utilization of {}%–{}%, from {baseline_utilization}% now.",
            lower.max(0),
            upper.min(100)
        ),
    );
    result.facts = vec![
        format!("{booked} booked minutes against {scheduled} rostered."),
        format!("Current utilization {baseline_utilization}%."),
        format!("{added_slots} slot(s) of {slot_minutes} minutes adds {added_minutes} minutes."),
    ];
    result.impacts = vec![ImpactRange {
        label: "Utilization".into(),
        baseline: format!("{baseline_utilization}%"),
        lower: format!("{}%", lower.max(0)),
        upper: format!("{}%", upper.min(100)),
        unit: "percent".into(),
        direction: direction(baseline_utilization, projected_utilization),
    }];
    result.reason =
        "Capacity is projected to rise while demand is held flat, so utilization falls unless the new slots are filled."
            .into();
    if projected_utilization < baseline_utilization / 2 {
        result
            .warnings
            .push("This would more than halve utilization unless demand grows to match.".into());
    }
    result.confidence = if booked > 0 { "medium" } else { "low" }.into();
    result.data_sufficient = booked > 0;
    Ok(result)
}

/// "What would a membership price change do to renewals?"
async fn membership_price(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    change_percent: i64,
) -> Result<WhatIfResult, AppError> {
    if !(-90..=200).contains(&change_percent) {
        return Err(AppError::validation(
            "changePercent must be between -90 and 200",
        ));
    }
    let queue = membership_lifecycle_repository::renewal_queue(db, tenant_id, branch_id, 60)
        .await
        .map_err(|_| AppError::internal("failed to load renewal baseline"))?;
    if queue.is_empty() {
        return Ok(WhatIfResult::unavailable(
            "membership_price",
            "no memberships are due for renewal in the next 60 days",
        ));
    }

    let due = queue.len() as i64;
    let already_failing = queue.iter().filter(|row| row.failure_count > 0).count() as i64;
    // A deliberately simple elasticity: each 10% of price change moves renewal
    // intent by roughly 5%. It is a stated assumption, not a fitted model, and
    // the answer says so rather than implying precision it does not have.
    let sensitivity = change_percent.saturating_mul(5) / 10;
    let expected_renewals = ((due - already_failing).saturating_mul(100 - sensitivity) / 100)
        .clamp(0, due);
    let (lower, upper) = spread(expected_renewals);

    let mut result = WhatIfResult::new(
        "membership_price",
        format!(
            "A {change_percent}% price change projects {}–{} renewals of the {due} due.",
            lower.clamp(0, due),
            upper.clamp(0, due)
        ),
    );
    result.facts = vec![
        format!("{due} memberships are due for renewal in the next 60 days."),
        format!("{already_failing} have already had an auto-renew attempt fail."),
    ];
    result.impacts = vec![ImpactRange {
        label: "Expected renewals".into(),
        baseline: (due - already_failing).to_string(),
        lower: lower.clamp(0, due).to_string(),
        upper: upper.clamp(0, due).to_string(),
        unit: "count".into(),
        direction: direction(due - already_failing, expected_renewals),
    }];
    result.reason =
        "Uses a stated assumption that each 10% of price change moves renewal intent by about 5%. It is not a fitted model."
            .into();
    if change_percent > 0 {
        result.warnings.push(
            "A price rise is modelled on an assumption, not on this branch's own price history."
                .into(),
        );
    }
    // Never better than low: the elasticity is assumed rather than measured.
    result.confidence = "low".into();
    result.data_sufficient = true;
    Ok(result)
}

#[cfg(test)]
mod phase4_what_if_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    #[test]
    fn simulation_is_closed_to_roles_without_financial_rights() {
        for role in ["staff", "frontdesk", "receptionist", "inventorymanager"] {
            assert!(!can_simulate(role), "{role} must not simulate");
        }
        for role in ["owner", "admin", "manager", "accountant", "analyst"] {
            assert!(can_simulate(role));
        }
    }

    #[test]
    fn a_projection_is_always_a_range_around_the_estimate() {
        let (lower, upper) = spread(100_000);
        assert!(lower < 100_000 && upper > 100_000);
        // A zero estimate has no width, but still reads as a range.
        assert_eq!(spread(0), (0, 0));
        // A negative estimate must not invert its bounds.
        let (low, high) = spread(-50_000);
        assert!(low <= high, "a loss projected as {low}..{high} is inverted");
    }

    /// The headline guarantee: a simulation must not change anything.
    #[tokio::test]
    async fn a_simulation_writes_nothing() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase4_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        // Governance evaluations are what a discount check would write if it
        // used the recording path, so they are the sharpest thing to count.
        let counted = |db: PgPool, tenant: String| async move {
            let mut totals = Vec::new();
            for table in [
                "profit_governance_evaluations",
                "profit_governance_audit",
                "pos_coupons",
                "ai_prediction_runs",
            ] {
                let count: i64 = sqlx::query_scalar(&format!(
                    "SELECT COUNT(*)::BIGINT FROM {table} WHERE tenant_id=$1"
                ))
                .bind(&tenant)
                .fetch_one(&db)
                .await
                .unwrap_or_default();
                totals.push((table, count));
            }
            totals
        };

        let before = counted(db.clone(), tenant.clone()).await;
        for scenario in [
            WhatIf::ServiceDiscount {
                service_id: String::new(),
                discount_percent: 10,
            },
            WhatIf::AddSlots {
                weekday: 0,
                added_slots: 2,
                slot_minutes: 60,
            },
            WhatIf::MembershipPrice { change_percent: 15 },
        ] {
            let result = simulate(&db, &tenant, branch, "owner", scenario)
                .await
                .expect("a simulation answers even on an empty branch");
            assert!(result.read_only, "every result must declare itself read-only");
        }
        let after = counted(db.clone(), tenant.clone()).await;
        assert_eq!(
            before, after,
            "a what-if simulation must not write to any table"
        );
    }

    /// A discount that wipes out the margin must be flagged, not quietly priced.
    #[tokio::test]
    async fn a_loss_making_discount_is_flagged_and_governed() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase4_loss_{}", Uuid::new_v4().simple());
        let branch = "branch1";

        // A service sold at ₹1000 with ₹900 of product cost: a 10% margin.
        sqlx::query(
            "INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
             VALUES ($1||'svc',$1,$2,'Thin Margin Spa','Hair',60,100000,TRUE)",
        )
        .bind(&tenant)
        .bind(branch)
        .execute(&db)
        .await
        .expect("service seeded");
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,business_date,finalized_at,created_at)
             VALUES ($1||'sale',$1,$2,$1||'c1','INV-L',100000,100000,100000,'paid',CURRENT_DATE-5,NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days')",
        )
        .bind(&tenant)
        .bind(branch)
        .execute(&db)
        .await
        .expect("sale seeded");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             VALUES ($1||'line',$1,$2,$1||'sale','service',$1||'svc','Thin Margin Spa',1,100000,100000)",
        )
        .bind(&tenant)
        .bind(branch)
        .execute(&db)
        .await
        .expect("line seeded");
        // Product cost of ₹900 against ₹1000 revenue: a 10% margin, so any
        // meaningful discount takes it negative. Cost comes from the stock
        // ledger, which is where the profit calculation actually reads it.
        sqlx::query(
            "INSERT INTO inventory_items(id,tenant_id,branch_id,sku,name,category,unit,stock_quantity,reorder_point,unit_cost_paise,active)
             VALUES ($1||'item',$1,$2,'SKU-W','Spa Consumable','Hair','pcs',50,5,90000,TRUE)",
        )
        .bind(&tenant)
        .bind(branch)
        .execute(&db)
        .await
        .expect("item seeded");
        sqlx::query(
            "INSERT INTO inventory_stock_ledger(id,tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise)
             VALUES ($1||'led',$1,$2,$1||'item',$1||'sale',$1||'line','sale',-1,90000)",
        )
        .bind(&tenant)
        .bind(branch)
        .execute(&db)
        .await
        .expect("stock ledger seeded");

        // A 90% discount on a 10% margin must be loss-making.
        let result = simulate(
            &db,
            &tenant,
            branch,
            "owner",
            WhatIf::ServiceDiscount {
                service_id: String::new(),
                discount_percent: 90,
            },
        )
        .await
        .expect("simulation runs");

        assert!(
            result
                .warnings
                .iter()
                .any(|warning| warning.contains("loss-making")),
            "a loss-making discount must be flagged, got {:?}",
            result.warnings
        );
        assert_eq!(
            result.governance_decision, "blocked",
            "negative profit must be blocked by governance, not merely warned about"
        );
        // Facts and projections stay separable.
        assert!(!result.facts.is_empty());
        assert!(!result.impacts.is_empty());
        assert!(result.read_only);

        for table in [
            "inventory_stock_ledger",
            "inventory_items",
            "pos_sale_lines",
            "pos_sales",
            "services",
        ] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(&tenant)
                .execute(&db)
                .await;
        }
    }

    /// An empty branch produces an explicit unavailable, not a confident zero.
    #[tokio::test]
    async fn an_empty_branch_reports_unavailable() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase4_empty_{}", Uuid::new_v4().simple());

        let result = simulate(
            &db,
            &tenant,
            "branch1",
            "owner",
            WhatIf::ServiceDiscount {
                service_id: String::new(),
                discount_percent: 10,
            },
        )
        .await
        .expect("simulation runs");
        assert!(result.headline.contains("Data unavailable"));
        assert!(!result.data_sufficient);
        assert_eq!(result.confidence, "low");
    }

    /// Out-of-range inputs are rejected rather than silently clamped.
    #[tokio::test]
    async fn impossible_inputs_are_rejected() {
        let Some(db) = connect().await else { return };
        let tenant = format!("phase4_bad_{}", Uuid::new_v4().simple());

        for scenario in [
            WhatIf::ServiceDiscount {
                service_id: String::new(),
                discount_percent: 150,
            },
            WhatIf::AddSlots {
                weekday: 0,
                added_slots: 0,
                slot_minutes: 60,
            },
            WhatIf::MembershipPrice {
                change_percent: 500,
            },
        ] {
            assert!(
                simulate(&db, &tenant, "branch1", "owner", scenario)
                    .await
                    .is_err(),
                "an out-of-range scenario must be rejected"
            );
        }
    }
}
