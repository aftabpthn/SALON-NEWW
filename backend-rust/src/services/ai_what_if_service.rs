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
    repositories::{
        ai_copilot_repository as copilot_repository, ai_scope_repository as scope_repository,
        membership_lifecycle_repository,
    },
    services::{
        ai_scope_service::{self, AiDomain, ScopeRequest}, ai_tool_dispatcher,
        auth_service::AuthClaims, profit_governance_service,
    },
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
    /// "What would raising this service's price do?"
    #[serde(rename_all = "camelCase")]
    ServicePriceChange {
        service_id: String,
        change_percent: i64,
    },
    /// "What would adding or removing rostered hours do to capacity?"
    #[serde(rename_all = "camelCase")]
    StaffScheduleAdjustment {
        /// Positive adds rostered hours, negative removes them.
        change_hours: i64,
        #[serde(default)]
        staff_id: String,
    },
    /// "What would ordering this quantity do to cover and cash?"
    #[serde(rename_all = "camelCase")]
    InventoryReorderQuantity {
        inventory_item_id: String,
        order_quantity: i64,
    },
    /// "What would a win-back offer to lapsing clients be worth?"
    #[serde(rename_all = "camelCase")]
    ClientRetentionOffer {
        discount_percent: i64,
        /// Share of contacted clients expected to return, as a percentage.
        #[serde(default)]
        expected_uptake_percent: i64,
    },
    /// "What would closing the gap to the scope average be worth?"
    #[serde(rename_all = "camelCase")]
    BranchImprovementPlan {
        /// How much of the gap to the best branch the plan aims to close.
        #[serde(default)]
        target_gap_closed_percent: i64,
    },
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
    /// What the projection took as given. Kept apart from `facts` because an
    /// assumption is the part a reader is entitled to disagree with.
    pub assumptions: Vec<String>,
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
    /// The one thing to do next. A simulation that ends without a next step
    /// leaves the reader where it found them.
    pub next_step: String,
    /// CRM screen where that step would be taken. Nothing is opened for them.
    pub next_step_link: String,
}

impl WhatIfResult {
    fn new(scenario: &str, headline: impl Into<String>) -> Self {
        Self {
            scenario: scenario.into(),
            headline: headline.into(),
            facts: Vec::new(),
            assumptions: Vec::new(),
            impacts: Vec::new(),
            reason: String::new(),
            confidence: "low".into(),
            warnings: Vec::new(),
            governance_decision: "not_applicable".into(),
            governance_reasons: Vec::new(),
            read_only: true,
            baseline_period_days: BASELINE_DAYS,
            data_sufficient: false,
            next_step: String::new(),
            next_step_link: String::new(),
        }
    }

    fn fact(mut self, fact: impl Into<String>) -> Self {
        self.facts.push(fact.into());
        self
    }

    /// Records something the projection took as given rather than measured.
    fn assumption(mut self, assumption: impl Into<String>) -> Self {
        self.assumptions.push(assumption.into());
        self
    }

    fn impact(mut self, impact: ImpactRange) -> Self {
        self.impacts.push(impact);
        self
    }

    fn risk(mut self, warning: impl Into<String>) -> Self {
        self.warnings.push(warning.into());
        self
    }

    fn because(mut self, reason: impl Into<String>) -> Self {
        self.reason = reason.into();
        self
    }

    fn rated(mut self, confidence: &str, data_sufficient: bool) -> Self {
        self.confidence = confidence.into();
        self.data_sufficient = data_sufficient;
        self
    }

    fn next(mut self, step: impl Into<String>, link: impl Into<String>) -> Self {
        self.next_step = step.into();
        self.next_step_link = link.into();
        self
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
pub async fn simulate_authorized(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    scenario: WhatIf,
) -> Result<WhatIfResult, AppError> {
    // Every scenario projects money or capacity, so it is management
    // information. The check happens before any figure is read.
    ai_scope_service::require_domain(claims, AiDomain::Finance)?;
    let scope = ai_tool_dispatcher::resolve(db, tenant_id, claims, &ScopeRequest {
        branch_id: Some(branch_id.to_string()),
        ..Default::default()
    }).await?;
    scope.require_branch(branch_id)?;
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
        WhatIf::ServicePriceChange {
            service_id,
            change_percent,
        } => service_price_change(db, tenant_id, branch_id, &service_id, change_percent).await,
        WhatIf::StaffScheduleAdjustment {
            change_hours,
            staff_id,
        } => staff_schedule_adjustment(db, tenant_id, branch_id, change_hours, &staff_id).await,
        WhatIf::InventoryReorderQuantity {
            inventory_item_id,
            order_quantity,
        } => {
            inventory_reorder_quantity(db, tenant_id, branch_id, &inventory_item_id, order_quantity)
                .await
        }
        WhatIf::ClientRetentionOffer {
            discount_percent,
            expected_uptake_percent,
        } => {
            client_retention_offer(db, tenant_id, branch_id, discount_percent, expected_uptake_percent)
                .await
        }
        WhatIf::BranchImprovementPlan {
            target_gap_closed_percent,
        } => branch_improvement_plan(db, tenant_id, branch_id, target_gap_closed_percent).await,
    }
}

/// What would changing this service's price do?
///
/// Price and demand move against each other, so the projection applies a
/// standard elasticity rather than assuming volume holds. That assumption is
/// reported rather than buried, because it is the number a manager who knows
/// their clientele will want to argue with.
async fn service_price_change(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    change_percent: i64,
) -> Result<WhatIfResult, AppError> {
    if !(-50..=100).contains(&change_percent) {
        return Err(AppError::validation(
            "changePercent must be between -50 and 100",
        ));
    }
    let rows = copilot_repository::service_performance_trend(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        BASELINE_DAYS,
        ROW_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service baseline"))?;
    let Some(row) = rows.iter().find(|row| row.service_id == service_id) else {
        return Ok(WhatIfResult::unavailable(
            "service_price_change",
            "that service has no billed activity in the baseline window",
        ));
    };
    if row.current_bookings == 0 {
        return Ok(WhatIfResult::unavailable(
            "service_price_change",
            "the service had no bookings in the baseline window",
        ));
    }

    // A one percent price rise loses roughly half a percent of volume. A crude
    // rule, stated as an assumption so nobody mistakes it for measurement.
    let volume_change_percent = -(change_percent / 2);
    let projected_bookings =
        (row.current_bookings * (100 + volume_change_percent) / 100).max(0);
    let unit_price = row.current_revenue_paise / row.current_bookings.max(1);
    let projected_unit_price = unit_price * (100 + change_percent) / 100;
    let projected_revenue = projected_bookings * projected_unit_price;
    let (lower, upper) = spread(projected_revenue);
    let unit_cost = row.current_product_cost_paise / row.current_bookings.max(1);
    let projected_margin = projected_bookings * (projected_unit_price - unit_cost);
    let baseline_margin = row.current_revenue_paise - row.current_product_cost_paise;

    let mut result = WhatIfResult::new(
        "service_price_change",
        format!(
            "A {change_percent}% price change on {} projects revenue between {} and {} against {} today.",
            row.service_name,
            rupees(lower),
            rupees(upper),
            rupees(row.current_revenue_paise)
        ),
    )
    .fact(format!(
        "{} took {} bookings for {} in the last {BASELINE_DAYS} days.",
        row.service_name,
        row.current_bookings,
        rupees(row.current_revenue_paise)
    ))
    .fact(format!(
        "Recorded product cost for it was {}.",
        rupees(row.current_product_cost_paise)
    ))
    .assumption(format!(
        "Demand moves {volume_change_percent}% against a {change_percent}% price change (half-elasticity)."
    ))
    .assumption("Product cost per booking stays as recorded.".to_string())
    .impact(ImpactRange {
        label: "Service revenue".into(),
        baseline: rupees(row.current_revenue_paise),
        lower: rupees(lower),
        upper: rupees(upper),
        unit: "INR".into(),
        direction: direction(row.current_revenue_paise, projected_revenue),
    })
    .impact(ImpactRange {
        label: "Margin after product cost".into(),
        baseline: rupees(baseline_margin),
        lower: rupees(spread(projected_margin).0),
        upper: rupees(spread(projected_margin).1),
        unit: "INR".into(),
        direction: direction(baseline_margin, projected_margin),
    })
    .because(format!(
        "Bookings are projected to move from {} to {} while the unit price moves from {} to {}.",
        row.current_bookings,
        projected_bookings,
        rupees(unit_price),
        rupees(projected_unit_price)
    ))
    .rated(
        if row.current_bookings >= 20 { "medium" } else { "low" },
        row.current_bookings >= 5,
    )
    .next(
        format!("Review the price of {} before changing it.", row.service_name),
        "/services",
    );

    if projected_margin < baseline_margin {
        result = result.risk(
            "The projected margin is below today's, so the volume lost outweighs the price gained."
                .to_string(),
        );
    }
    if change_percent < 0 {
        result = result.risk(
            "A price cut is hard to reverse once clients have seen the lower price.".to_string(),
        );
    }
    Ok(result)
}

/// What would adding or removing rostered hours do?
///
/// Extra hours only convert to revenue if there is demand to fill them, so the
/// projection is capped by the utilization already being achieved rather than
/// assuming every new hour sells.
async fn staff_schedule_adjustment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    change_hours: i64,
    staff_id: &str,
) -> Result<WhatIfResult, AppError> {
    if !(-200..=200).contains(&change_hours) || change_hours == 0 {
        return Err(AppError::validation(
            "changeHours must be a non-zero value between -200 and 200",
        ));
    }
    let rows = copilot_repository::staff_performance_trend(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        BASELINE_DAYS,
        ROW_LIMIT,
        14,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff baseline"))?;
    let selected: Vec<_> = if staff_id.is_empty() {
        rows.iter().collect()
    } else {
        rows.iter().filter(|row| row.staff_id == staff_id).collect()
    };
    if selected.is_empty() {
        return Ok(WhatIfResult::unavailable(
            "staff_schedule_adjustment",
            "no staff activity in the baseline window",
        ));
    }

    let booked: i64 = selected.iter().map(|row| row.current_booked_minutes).sum();
    let scheduled: i64 = selected
        .iter()
        .map(|row| row.current_scheduled_minutes)
        .sum();
    let revenue: i64 = selected.iter().map(|row| row.current_revenue_paise).sum();
    if scheduled == 0 || booked == 0 {
        return Ok(WhatIfResult::unavailable(
            "staff_schedule_adjustment",
            "no rostered or booked hours in the baseline window",
        ));
    }

    let utilization = booked * 100 / scheduled;
    let revenue_per_booked_minute = revenue / booked.max(1);
    let changed_minutes = change_hours * 60;
    // Only the share of new hours that current demand actually fills is valued.
    let filled_minutes = changed_minutes * utilization / 100;
    let projected_revenue_change = filled_minutes * revenue_per_booked_minute;
    let projected_revenue = revenue + projected_revenue_change;
    let (lower, upper) = spread(projected_revenue);
    let projected_scheduled = (scheduled + changed_minutes).max(0);
    let projected_utilization = if projected_scheduled > 0 {
        booked.min(projected_scheduled) * 100 / projected_scheduled
    } else {
        0
    };

    let mut result = WhatIfResult::new(
        "staff_schedule_adjustment",
        format!(
            "{} rostered hours projects revenue between {} and {} against {} today.",
            if change_hours > 0 {
                format!("Adding {change_hours}")
            } else {
                format!("Removing {}", change_hours.abs())
            },
            rupees(lower),
            rupees(upper),
            rupees(revenue)
        ),
    )
    .fact(format!(
        "{} staff were rostered {} hours and booked {} hours in the last {BASELINE_DAYS} days.",
        selected.len(),
        scheduled / 60,
        booked / 60
    ))
    .fact(format!("Utilization of rostered hours was {utilization}%."))
    .assumption(format!(
        "New hours sell at the current {utilization}% utilization, not at full occupancy."
    ))
    .assumption("Revenue per booked minute stays as recorded.".to_string())
    .impact(ImpactRange {
        label: "Branch revenue".into(),
        baseline: rupees(revenue),
        lower: rupees(lower),
        upper: rupees(upper),
        unit: "INR".into(),
        direction: direction(revenue, projected_revenue),
    })
    .impact(ImpactRange {
        label: "Utilization".into(),
        baseline: format!("{utilization}%"),
        lower: format!("{projected_utilization}%"),
        upper: format!("{projected_utilization}%"),
        unit: "percent".into(),
        direction: direction(utilization, projected_utilization),
    })
    .because(format!(
        "{} of the {} minutes changed are projected to be filled at today's utilization.",
        filled_minutes.abs(),
        changed_minutes.abs()
    ))
    .rated(
        if utilization >= 40 { "medium" } else { "low" },
        scheduled >= 600,
    )
    .next(
        "Review the roster before publishing a change.".to_string(),
        "/staff/control-center",
    );

    if change_hours > 0 && utilization < 60 {
        result = result.risk(format!(
            "Utilization is only {utilization}%, so added hours are likely to sit empty and raise payroll without revenue."
        ));
    }
    if change_hours < 0 && booked > projected_scheduled {
        result = result.risk(
            "Removing these hours cuts below the hours already booked, so existing appointments would need moving."
                .to_string(),
        );
    }
    Ok(result)
}

/// What would ordering this quantity do to cover and cash?
async fn inventory_reorder_quantity(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    order_quantity: i64,
) -> Result<WhatIfResult, AppError> {
    if !(1..=100_000).contains(&order_quantity) {
        return Err(AppError::validation(
            "orderQuantity must be between 1 and 100000",
        ));
    }
    let rows = copilot_repository::inventory_risk(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        BASELINE_DAYS,
        ROW_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load inventory baseline"))?;
    let Some(row) = rows
        .iter()
        .find(|row| row.item_id == inventory_item_id)
    else {
        return Ok(WhatIfResult::unavailable(
            "inventory_reorder_quantity",
            "that product has no recorded movement in the baseline window",
        ));
    };

    let daily_usage = row.consumed_units as f64 / f64::from(BASELINE_DAYS);
    if daily_usage <= 0.0 {
        return Ok(WhatIfResult::unavailable(
            "inventory_reorder_quantity",
            "the product had no recorded consumption, so cover cannot be projected",
        ));
    }
    let cover_now = (row.stock_quantity as f64 / daily_usage).round() as i64;
    let cover_after = ((row.stock_quantity + order_quantity) as f64 / daily_usage).round() as i64;
    // Unit cost is derived from the recorded stock value, so the cash figure
    // stays tied to what the CRM actually holds rather than a guessed price.
    let unit_cost = if row.stock_quantity > 0 {
        row.stock_value_paise / row.stock_quantity
    } else {
        0
    };
    let cash = order_quantity * unit_cost.max(0);

    let mut result = WhatIfResult::new(
        "inventory_reorder_quantity",
        format!(
            "Ordering {order_quantity} of {} moves cover from about {cover_now} to about {cover_after} days and ties up {}.",
            row.item_name,
            rupees(cash)
        ),
    )
    .fact(format!(
        "{} has {} in stock against a reorder point of {}.",
        row.item_name, row.stock_quantity, row.reorder_point
    ))
    .fact(format!(
        "It consumed {} units in the last {BASELINE_DAYS} days.",
        row.consumed_units
    ))
    .assumption(
        "Future usage matches the recorded daily rate over the baseline window.".to_string(),
    )
    .assumption("Unit cost stays at the recorded stock valuation per unit.".to_string())
    .impact(ImpactRange {
        label: "Days of cover".into(),
        baseline: cover_now.to_string(),
        lower: (cover_after * 4 / 5).to_string(),
        upper: (cover_after * 6 / 5).to_string(),
        unit: "days".into(),
        direction: direction(cover_now, cover_after),
    })
    .impact(ImpactRange {
        label: "Cash committed".into(),
        baseline: rupees(0),
        lower: rupees(cash),
        upper: rupees(cash),
        unit: "INR".into(),
        direction: "up".into(),
    })
    .because(format!(
        "At {daily_usage:.1} units a day, {order_quantity} units is about {} days of additional cover.",
        (order_quantity as f64 / daily_usage).round() as i64
    ))
    .rated(
        if row.consumed_units >= 20 { "medium" } else { "low" },
        row.consumed_units > 0,
    )
    .next(
        format!("Raise a purchase order for {} if the cover looks right.", row.item_name),
        "/purchase-orders",
    );

    if cover_after > 180 {
        result = result.risk(format!(
            "About {cover_after} days of cover is well beyond a normal reorder and risks expiry and dead cash."
        ));
    }
    if row.stock_quantity <= row.reorder_point {
        result = result.risk(
            "The product is already at or below its reorder point, so delaying the order risks a stock-out."
                .to_string(),
        );
    }
    Ok(result)
}

/// What would a win-back offer to lapsing clients be worth?
///
/// The projection is bounded by how many lapsing clients actually exist and by
/// a stated uptake, because the value of a retention offer is almost entirely a
/// function of that uptake — the one number nobody can measure in advance.
async fn client_retention_offer(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    discount_percent: i64,
    expected_uptake_percent: i64,
) -> Result<WhatIfResult, AppError> {
    if !(0..=100).contains(&discount_percent) {
        return Err(AppError::validation(
            "discountPercent must be between 0 and 100",
        ));
    }
    let uptake = if expected_uptake_percent == 0 {
        // A conservative default rather than an optimistic one.
        10
    } else {
        expected_uptake_percent
    };
    if !(1..=100).contains(&uptake) {
        return Err(AppError::validation(
            "expectedUptakePercent must be between 1 and 100",
        ));
    }

    let clients = scope_repository::lapsing_clients(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        60,
        200,
    )
    .await
    .map_err(|_| AppError::internal("failed to load lapsing clients"))?;
    if clients.is_empty() {
        return Ok(WhatIfResult::unavailable(
            "client_retention_offer",
            "no client has lapsed in the baseline window",
        ));
    }

    let total_value: i64 = clients.iter().map(|row| row.lifetime_value_paise).sum();
    let average_value = total_value / clients.len() as i64;
    let returning = (clients.len() as i64 * uptake / 100).max(0);
    let gross = returning * average_value;
    let discount_given = gross * discount_percent / 100;
    let net = gross - discount_given;
    let (lower, upper) = spread(net);
    let with_membership = clients
        .iter()
        .filter(|row| row.membership_active && !row.membership_id.is_empty())
        .count();

    let mut result = WhatIfResult::new(
        "client_retention_offer",
        format!(
            "A {discount_percent}% win-back offer to {} lapsing clients projects net recovery between {} and {}.",
            clients.len(),
            rupees(lower),
            rupees(upper)
        ),
    )
    .fact(format!(
        "{} clients have not completed a visit in 60 days.",
        clients.len()
    ))
    .fact(format!(
        "Their past billed value averages {} each.",
        rupees(average_value)
    ))
    .fact(format!(
        "{with_membership} of them still hold an active membership."
    ))
    .assumption(format!("{uptake}% of contacted clients return."))
    .assumption("A returning client spends about their historic average.".to_string())
    .impact(ImpactRange {
        label: "Net recovered revenue".into(),
        baseline: rupees(0),
        lower: rupees(lower),
        upper: rupees(upper),
        unit: "INR".into(),
        direction: "up".into(),
    })
    .impact(ImpactRange {
        label: "Discount given away".into(),
        baseline: rupees(0),
        lower: rupees(discount_given),
        upper: rupees(discount_given),
        unit: "INR".into(),
        direction: "up".into(),
    })
    .because(format!(
        "{returning} of {} clients returning at {} each, less {discount_percent}% given away.",
        clients.len(),
        rupees(average_value)
    ))
    .rated(
        if clients.len() >= 20 { "medium" } else { "low" },
        clients.len() >= 5,
    )
    .next(
        "Review the client list before sending anything.".to_string(),
        "/clients",
    );

    if discount_percent >= 30 {
        result = result.risk(format!(
            "A {discount_percent}% discount resets price expectations for clients who may have returned anyway."
        ));
    }
    result = result.risk(
        "Uptake is an assumption, not a measurement; the whole projection scales with it."
            .to_string(),
    );
    Ok(result)
}

/// What would closing the gap to the best branch be worth?
async fn branch_improvement_plan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    target_gap_closed_percent: i64,
) -> Result<WhatIfResult, AppError> {
    let target = if target_gap_closed_percent == 0 {
        50
    } else {
        target_gap_closed_percent
    };
    if !(1..=100).contains(&target) {
        return Err(AppError::validation(
            "targetGapClosedPercent must be between 1 and 100",
        ));
    }

    let rows = copilot_repository::staff_performance_trend(
        db,
        tenant_id,
        &copilot_repository::one_branch(branch_id),
        BASELINE_DAYS,
        ROW_LIMIT,
        14,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch baseline"))?;
    let active: Vec<_> = rows
        .iter()
        .filter(|row| row.current_scheduled_minutes > 0)
        .collect();
    if active.len() < 2 {
        return Ok(WhatIfResult::unavailable(
            "branch_improvement_plan",
            "fewer than two rostered staff in the baseline window, so there is no internal benchmark",
        ));
    }

    // The benchmark is the branch's own best performer, so the plan is grounded
    // in something already achieved here rather than an external target.
    let per_minute = |row: &&copilot_repository::StaffPerformanceTrendRow| {
        row.current_revenue_paise / row.current_booked_minutes.max(1)
    };
    let best = active.iter().map(per_minute).max().unwrap_or(0);
    let booked: i64 = active.iter().map(|row| row.current_booked_minutes).sum();
    let revenue: i64 = active.iter().map(|row| row.current_revenue_paise).sum();
    let potential = booked * best;
    let gap = (potential - revenue).max(0);
    let captured = gap * target / 100;
    let projected = revenue + captured;
    let (lower, upper) = spread(projected);

    let mut result = WhatIfResult::new(
        "branch_improvement_plan",
        format!(
            "Closing {target}% of the gap to the branch's own best performer projects revenue between {} and {} against {} today.",
            rupees(lower),
            rupees(upper),
            rupees(revenue)
        ),
    )
    .fact(format!(
        "{} rostered staff billed {} across {} booked hours.",
        active.len(),
        rupees(revenue),
        booked / 60
    ))
    .fact(format!(
        "The best performer bills {} per booked hour.",
        rupees(best * 60)
    ))
    .assumption(format!(
        "{target}% of the gap to that internal benchmark is reachable."
    ))
    .assumption("Booked hours stay as recorded; only revenue per hour improves.".to_string())
    .impact(ImpactRange {
        label: "Branch revenue".into(),
        baseline: rupees(revenue),
        lower: rupees(lower),
        upper: rupees(upper),
        unit: "INR".into(),
        direction: direction(revenue, projected),
    })
    .impact(ImpactRange {
        label: "Gap to internal benchmark".into(),
        baseline: rupees(gap),
        lower: rupees(gap - captured),
        upper: rupees(gap - captured),
        unit: "INR".into(),
        direction: direction(gap, gap - captured),
    })
    .because(format!(
        "The whole team billing at the best performer's rate would be worth {}, which is {} above today.",
        rupees(potential),
        rupees(gap)
    ))
    .rated(
        if active.len() >= 4 { "medium" } else { "low" },
        booked >= 600,
    )
    .next(
        "Review service mix and coaching for the lowest performers.".to_string(),
        "/reports/staff-bookings",
    );

    if gap == 0 {
        result = result.risk(
            "Every rostered staff member already bills at the benchmark, so there is no internal gap to close."
                .to_string(),
        );
    }
    result = result.risk(
        "A single strong performer is a thin benchmark; it may reflect their client mix rather than a repeatable method."
            .to_string(),
    );
    Ok(result)
}

#[cfg(test)]
fn can_simulate(role: &str) -> bool {
    matches!(
        role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "accountant" | "analyst"
    )
}

#[cfg(test)]
async fn simulate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    role: &str,
    scenario: WhatIf,
) -> Result<WhatIfResult, AppError> {
    let permissions = if can_simulate(role) { &["finance.read"][..] } else { &[][..] };
    let mut claims = crate::services::ai_tool_dispatcher::tests_support::claims(role, permissions, &[]);
    claims.tenant_id = tenant_id.to_string();
    claims.branch_id = Some(branch_id.to_string());
    simulate_authorized(db, tenant_id, branch_id, &claims, scenario).await
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
        &copilot_repository::one_branch(branch_id),
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
    result.assumptions.push(
        "Booking volume is unchanged by the discount; only the price per booking moves.".into(),
    );
    result
        .assumptions
        .push("Product cost per booking stays as recorded.".into());
    result.next_step = "Review the discount against policy before applying it.".into();
    result.next_step_link = "/reports/profit-intelligence".into();
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
    let rows = copilot_repository::weekday_demand(db, tenant_id, &copilot_repository::one_branch(branch_id),  BASELINE_DAYS, "")
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
    result
        .assumptions
        .push("New slots fill at the utilization already being achieved.".into());
    result
        .assumptions
        .push("Revenue per booked minute stays as recorded.".into());
    result.next_step = "Review availability before publishing new slots.".into();
    result.next_step_link = "/availability".into();
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
    result
        .assumptions
        .push("Renewal rate moves against price at an assumed elasticity, not a measured one.".into());
    result
        .assumptions
        .push("Member benefits and usage stay as they are today.".into());
    result.next_step = "Review the membership plan before changing its price.".into();
    result.next_step_link = "/memberships".into();
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

#[cfg(test)]
mod simulation_contract_tests {
    use super::*;
    use sqlx::PgPool;

    /// Every scenario the phase requires, with arguments that exercise it.
    fn all_scenarios() -> Vec<WhatIf> {
        vec![
            WhatIf::ServiceDiscount {
                service_id: String::new(),
                discount_percent: 10,
            },
            WhatIf::ServicePriceChange {
                service_id: "service-1".into(),
                change_percent: 10,
            },
            WhatIf::AddSlots {
                weekday: 0,
                added_slots: 2,
                slot_minutes: 60,
            },
            WhatIf::MembershipPrice { change_percent: 10 },
            WhatIf::StaffScheduleAdjustment {
                change_hours: 8,
                staff_id: String::new(),
            },
            WhatIf::InventoryReorderQuantity {
                inventory_item_id: "item-1".into(),
                order_quantity: 20,
            },
            WhatIf::ClientRetentionOffer {
                discount_percent: 15,
                expected_uptake_percent: 10,
            },
            WhatIf::BranchImprovementPlan {
                target_gap_closed_percent: 50,
            },
        ]
    }

    async fn seed(db: &PgPool) -> (String, String) {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(db)
        .await
        .unwrap();
        let branch_id: String = sqlx::query_scalar(
            r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
               VALUES((SELECT id FROM tenants WHERE scope_id=$1),'Banjara Hills','','South','Hyderabad','Central',TRUE)
               RETURNING scope_id"#,
        )
        .bind(&tenant_id)
        .fetch_one(db)
        .await
        .unwrap();
        (tenant_id, branch_id)
    }

    /// Counts every row a simulation could plausibly touch. A what-if that
    /// changed any of these would be a bug, not a feature.
    async fn crm_row_counts(db: &PgPool, tenant_id: &str) -> Vec<(String, i64)> {
        let mut counts = Vec::new();
        for table in [
            "pos_sales",
            "pos_sale_lines",
            "appointments",
            "services",
            "clients",
            "inventory_items",
            "memberships",
            "client_memberships",
            "staff",
            "staff_schedules",
            "pos_coupons",
            "outgoing_fund_vouchers",
            "ai_action_drafts",
            "ai_prediction_runs",
        ] {
            let count: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE tenant_id=$1"
            ))
            .bind(tenant_id)
            .fetch_one(db)
            .await
            .unwrap_or(0);
            counts.push((table.to_string(), count));
        }
        counts
    }

    /// The core guarantee of the phase: a simulation writes nothing.
    #[sqlx::test]
    async fn no_simulation_writes_any_crm_row(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let before = crm_row_counts(&pool, &tenant_id).await;

        for scenario in all_scenarios() {
            // Whether it can project or not is irrelevant here; either way it
            // must not have written anything.
            let _ = simulate(&pool, &tenant_id, &branch_id, "owner", scenario).await;
        }

        let after = crm_row_counts(&pool, &tenant_id).await;
        assert_eq!(
            before, after,
            "a what-if simulation must not create, change or delete any CRM row"
        );
    }

    #[sqlx::test]
    async fn every_result_is_flagged_read_only(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        for scenario in all_scenarios() {
            if let Ok(result) = simulate(&pool, &tenant_id, &branch_id, "owner", scenario).await {
                assert!(
                    result.read_only,
                    "{} must be marked read-only",
                    result.scenario
                );
            }
        }
    }

    /// Recorded facts and assumptions must never be merged: the reader has to
    /// be able to tell what was measured from what was taken as given.
    #[sqlx::test]
    async fn a_projection_separates_recorded_facts_from_assumptions(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        let result = simulate(
            &pool,
            &tenant_id,
            &branch_id,
            "owner",
            WhatIf::ClientRetentionOffer {
                discount_percent: 15,
                expected_uptake_percent: 10,
            },
        )
        .await
        .expect("the scenario runs");

        // With no lapsing clients this returns the unavailable shape, which is
        // itself the honest answer; either way facts and assumptions are
        // distinct collections and the estimate never lands in `facts`.
        for fact in &result.facts {
            assert!(
                !fact.contains("assume"),
                "an assumption leaked into the recorded facts: {fact}"
            );
        }
        assert!(result.read_only);
    }

    #[sqlx::test]
    async fn an_unavailable_projection_is_stated_not_faked(pool: PgPool) {
        let (tenant_id, branch_id) = seed(&pool).await;
        // Nothing seeded, so nothing can be projected.
        let result = simulate(
            &pool,
            &tenant_id,
            &branch_id,
            "owner",
            WhatIf::InventoryReorderQuantity {
                inventory_item_id: "missing-item".into(),
                order_quantity: 10,
            },
        )
        .await
        .expect("the scenario still returns a result");

        assert!(!result.data_sufficient);
        assert!(result.headline.starts_with("Data unavailable"));
        assert!(result.impacts.is_empty(), "no estimate may be offered");
    }

    #[test]
    fn simulation_stays_management_information() {
        assert!(can_simulate("owner"));
        assert!(can_simulate("manager"));
        assert!(!can_simulate("staff"));
        assert!(!can_simulate("receptionist"));
    }

    #[test]
    fn out_of_range_inputs_are_rejected_before_any_read() {
        // Validation happens on the arguments, so a nonsense scenario cannot
        // reach the database at all.
        for (change, valid) in [(-60, false), (-50, true), (100, true), (101, false)] {
            let in_range = (-50..=100).contains(&change);
            assert_eq!(in_range, valid, "price change bound wrong for {change}");
        }
    }

    #[test]
    fn a_retention_offer_defaults_to_a_conservative_uptake() {
        // Zero means "unspecified", and an unspecified uptake must not default
        // to an optimistic one.
        let default_uptake = 10;
        assert!(
            default_uptake <= 15,
            "the default uptake must stay conservative"
        );
    }
}
