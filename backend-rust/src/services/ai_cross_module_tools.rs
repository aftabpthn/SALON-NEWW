//! Cross-module copilot tools.
//!
//! These answer questions that no single CRM module can settle on its own — a
//! declining service measured against revenue, a lapse list read together with
//! the memberships those clients hold, a staff dip attributed to demand rather
//! than to the person, a branch that bills well but keeps little of it.
//!
//! Each tool runs fixed statements against the repositories the CRM already
//! uses. The model chooses a tool name and nothing else; it never composes a
//! query, and it never sees a row the caller's scope did not authorize.

use serde_json::json;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{
        ai_copilot_repository as copilot_repository, ai_scope_repository as scope_repository,
    },
    services::{
        ai_copilot_tools::{CopilotAnswer, CopilotMetric, CopilotTool, ToolScope},
        ai_scope_service::{format_money_paise, safe_percent},
    },
};

/// Comparison window, matching the single-module trend tools so a cross-module
/// answer and a single-module answer about the same week cannot disagree.
const TREND_DAYS: i32 = 30;
const ROW_LIMIT: i64 = 8;
/// Days without a completed visit before a client counts as lapsing.
const LAPSE_AFTER_DAYS: i32 = 60;
/// Below this many completed visits in either period, a staff comparison is not
/// evidence about a person, so the cause is reported as unknown.
const MIN_VISITS_FOR_CAUSE: i64 = 5;

fn window() -> (chrono::NaiveDate, chrono::NaiveDate) {
    let today = chrono::Utc::now().date_naive();
    (today - chrono::Duration::days(i64::from(TREND_DAYS)), today)
}

fn previous_window() -> (chrono::NaiveDate, chrono::NaiveDate) {
    let today = chrono::Utc::now().date_naive();
    (
        today - chrono::Duration::days(i64::from(TREND_DAYS) * 2),
        today - chrono::Duration::days(i64::from(TREND_DAYS) + 1),
    )
}

/// Which service is declining, and is it actually moving branch revenue?
///
/// The service trend alone says a service fell; it cannot say whether that
/// matters. Reading it beside branch revenue turns "bookings are down" into a
/// share of the revenue change, which is the part a manager can act on.
pub async fn service_revenue_impact(
    db: &PgPool,
    tenant_id: &str,
    scope: &ToolScope,
) -> Result<CopilotAnswer, AppError> {
    let services = copilot_repository::service_performance_trend(
        db,
        tenant_id,
        &scope.branch_ids,
        TREND_DAYS,
        ROW_LIMIT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service performance trend"))?;

    let (start, end) = window();
    let (previous_start, previous_end) = previous_window();
    let current_finance =
        scope_repository::finance_summary(db, tenant_id, &scope.branch_ids, start, end)
            .await
            .map_err(|_| AppError::internal("failed to load branch revenue"))?;
    let previous_finance = scope_repository::finance_summary(
        db,
        tenant_id,
        &scope.branch_ids,
        previous_start,
        previous_end,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison branch revenue"))?;

    let revenue: i64 = current_finance.iter().map(|row| row.revenue_paise).sum();
    let previous_revenue: i64 = previous_finance.iter().map(|row| row.revenue_paise).sum();
    let revenue_change = revenue - previous_revenue;

    let declining: Vec<_> = services
        .iter()
        .filter(|row| row.current_revenue_paise < row.previous_revenue_paise)
        .collect();
    let Some(worst) = declining
        .iter()
        .min_by_key(|row| row.current_revenue_paise - row.previous_revenue_paise)
    else {
        return Ok(CopilotAnswer::for_tool(
            CopilotTool::ServiceRevenueImpact,
            format!(
                "No service declined in {} over the last {TREND_DAYS} days; branch revenue moved {}.",
                scope.label,
                signed_money(revenue_change)
            ),
        )
        .source_module("finance.revenue")
        .trend_window()
        .action("No service-level action is needed.", "/reports/service-trends")
        .confidence_level("medium")
        .with_data(json!({ "decliningServices": [], "revenueChangePaise": revenue_change })));
    };

    let service_drop = worst.current_revenue_paise - worst.previous_revenue_paise;
    let declining_total: i64 = declining
        .iter()
        .map(|row| row.current_revenue_paise - row.previous_revenue_paise)
        .sum();
    // Share is only meaningful when branch revenue actually fell. When revenue
    // held up, the honest reading is that other services absorbed the drop.
    let share_of_drop = if revenue_change < 0 {
        safe_percent(service_drop.abs(), revenue_change.abs())
    } else {
        0.0
    };

    let headline = if revenue_change < 0 {
        format!(
            "{} is the biggest decline in {} at {}, which is {:.0}% of the branch revenue fall of {}.",
            worst.service_name,
            scope.label,
            signed_money(service_drop),
            share_of_drop,
            signed_money(revenue_change)
        )
    } else {
        format!(
            "{} declined by {} in {}, but branch revenue still rose {} — other services absorbed it.",
            worst.service_name,
            signed_money(service_drop),
            scope.label,
            signed_money(revenue_change)
        )
    };

    let mut answer = CopilotAnswer::for_tool(CopilotTool::ServiceRevenueImpact, headline)
        .source_module("finance.revenue")
        .trend_window()
        .add_metric(CopilotMetric::money(
            "Branch revenue",
            previous_revenue,
            revenue,
        ))
        .add_metric(CopilotMetric::money(
            format!("{} revenue", worst.service_name),
            worst.previous_revenue_paise,
            worst.current_revenue_paise,
        ))
        .add_metric(CopilotMetric::count(
            format!("{} bookings", worst.service_name),
            worst.previous_bookings,
            worst.current_bookings,
        ))
        .why(if worst.current_bookings < worst.previous_bookings {
            format!(
                "Bookings fell from {} to {}, so the revenue drop is demand, not price.",
                worst.previous_bookings, worst.current_bookings
            )
        } else {
            "Bookings held, so the revenue drop comes from price or discount rather than demand."
                .to_string()
        })
        .link_entity(
            "service",
            &worst.service_id,
            &worst.service_name,
            format!("/services?serviceId={}", worst.service_id),
        )
        .action(
            format!("Review pricing and staffing for {}.", worst.service_name),
            "/reports/service-trends",
        )
        .with_data(json!({
            "revenuePaise": revenue,
            "previousRevenuePaise": previous_revenue,
            "revenueChangePaise": revenue_change,
            "decliningServiceCount": declining.len(),
            "decliningRevenuePaise": declining_total,
            "shareOfBranchDropPercent": share_of_drop,
            "services": declining.iter().map(|row| json!({
                "serviceId": row.service_id,
                "serviceName": row.service_name,
                "previousBookings": row.previous_bookings,
                "currentBookings": row.current_bookings,
                "previousRevenuePaise": row.previous_revenue_paise,
                "currentRevenuePaise": row.current_revenue_paise,
            })).collect::<Vec<_>>(),
        }));

    if previous_revenue == 0 {
        answer = answer
            .gap("No billed revenue in the previous period, so the share of the change is not measurable.")
            .confidence_level("low");
    } else {
        answer = answer.confidence_level(if declining.len() >= 3 { "high" } else { "medium" });
    }
    Ok(answer)
}

/// Which clients are likely to lapse, and what memberships do they hold?
///
/// The membership matters because a lapsing member is a renewal about to be
/// lost, not just a quiet client — so the two are read together rather than in
/// two separate answers the user has to join by hand.
pub async fn client_lapse_risk(
    db: &PgPool,
    tenant_id: &str,
    scope: &ToolScope,
) -> Result<CopilotAnswer, AppError> {
    let rows = scope_repository::lapsing_clients(
        db,
        tenant_id,
        &scope.branch_ids,
        LAPSE_AFTER_DAYS,
        ROW_LIMIT * 3,
    )
    .await
    .map_err(|_| AppError::internal("failed to load lapsing clients"))?;

    if rows.is_empty() {
        return Ok(CopilotAnswer::for_tool(
            CopilotTool::ClientLapseRisk,
            format!(
                "No client in {} has gone more than {LAPSE_AFTER_DAYS} days without a completed visit.",
                scope.label
            ),
        )
        .source_module("membership.lifecycle")
        .action("No win-back action is needed.", "/clients")
        .confidence_level("medium")
        .with_data(json!({ "clients": [] })));
    }

    let with_membership: Vec<_> = rows
        .iter()
        .filter(|row| !row.membership_id.is_empty() && row.membership_active)
        .collect();
    let value_at_risk: i64 = rows.iter().map(|row| row.lifetime_value_paise).sum();

    let mut answer = CopilotAnswer::for_tool(
        CopilotTool::ClientLapseRisk,
        format!(
            "{} clients in {} are lapsing, {} of them holding an active membership. Past billed value at risk is {}.",
            rows.len(),
            scope.label,
            with_membership.len(),
            format_money_paise(value_at_risk)
        ),
    )
    .source_module("membership.lifecycle")
    .source_module("pos.client_value")
    .trend_window()
    .add_metric(CopilotMetric::count(
        "Lapsing clients",
        0,
        rows.len() as i64,
    ))
    .add_metric(CopilotMetric::count(
        "Holding an active membership",
        0,
        with_membership.len() as i64,
    ))
    .why(if with_membership.is_empty() {
        "None of the lapsing clients hold a membership, so there is no renewal to save.".to_string()
    } else {
        format!(
            "{} lapsing clients still hold an active membership, so each is a renewal at risk as well as a visit.",
            with_membership.len()
        )
    })
    .action(
        "Review the highest-value lapsing clients before their memberships expire.",
        "/clients",
    )
    .with_data(json!({
        "lapseAfterDays": LAPSE_AFTER_DAYS,
        "valueAtRiskPaise": value_at_risk,
        "clients": rows.iter().map(|row| json!({
            "clientId": row.client_id,
            "clientName": row.client_name,
            "branchId": row.branch_id,
            "branchName": row.branch_name,
            "daysSinceVisit": row.days_since_visit,
            "completedVisits": row.completed_visits,
            "lifetimeValuePaise": row.lifetime_value_paise,
            "membershipId": row.membership_id,
            "membershipName": row.membership_name,
            "membershipActive": row.membership_active,
            "membershipExpiresAt": row.membership_expires_at,
        })).collect::<Vec<_>>(),
    }));

    // Deep links for the few the user is most likely to act on first.
    for row in rows.iter().take(5) {
        answer = answer.link_entity(
            "client",
            &row.client_id,
            &row.client_name,
            format!("/clients?clientId={}", row.client_id),
        );
    }
    Ok(answer.confidence_level(if rows.len() >= 5 { "high" } else { "medium" }))
}

/// Is a staff member's decline caused by fewer bookings, or by their own work?
///
/// The distinction decides the response: a demand-led dip is a rota or
/// marketing problem, a performance-led dip is a coaching conversation. Calling
/// one the other wastes the manager's time and is unfair to the person.
pub async fn staff_decline_cause(
    db: &PgPool,
    tenant_id: &str,
    scope: &ToolScope,
) -> Result<CopilotAnswer, AppError> {
    let rows = copilot_repository::staff_performance_trend(
        db,
        tenant_id,
        &scope.branch_ids,
        TREND_DAYS,
        ROW_LIMIT,
        14,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff performance trend"))?;

    let mut assessed = Vec::new();
    for row in &rows {
        if row.current_revenue_paise >= row.previous_revenue_paise {
            continue;
        }
        // Too little activity either side is a scheduling fact, not evidence
        // about the person, so no cause is asserted.
        if row.previous_completed < MIN_VISITS_FOR_CAUSE {
            assessed.push((row, "insufficient_history"));
            continue;
        }
        let previous_average = average_bill(row.previous_revenue_paise, row.previous_completed);
        let current_average = average_bill(row.current_revenue_paise, row.current_completed);
        let bookings_fell = row.current_completed < row.previous_completed;
        let average_held = current_average >= (previous_average * 9) / 10;
        let cause = if bookings_fell && average_held {
            "low_bookings"
        } else if !bookings_fell && !average_held {
            "performance"
        } else if bookings_fell {
            "both"
        } else {
            "performance"
        };
        assessed.push((row, cause));
    }

    let Some((worst, cause)) = assessed
        .iter()
        .min_by_key(|(row, _)| row.current_revenue_paise - row.previous_revenue_paise)
        .copied()
    else {
        return Ok(CopilotAnswer::for_tool(
            CopilotTool::StaffDeclineCause,
            format!("No staff member in {} billed less than the previous period.", scope.label),
        )
        .source_module("appointments.completed")
        .trend_window()
        .action("No coaching action is needed.", "/reports/staff-bookings")
        .confidence_level("medium")
        .with_data(json!({ "staff": [] })));
    };

    let utilization_now = safe_percent(worst.current_booked_minutes, worst.current_scheduled_minutes.max(1));
    let utilization_before =
        safe_percent(worst.previous_booked_minutes, worst.previous_scheduled_minutes.max(1));

    let headline = match cause {
        "low_bookings" => format!(
            "{}'s decline in {} is demand, not performance: bookings fell from {} to {} while the average bill held.",
            worst.staff_name, scope.label, worst.previous_completed, worst.current_completed
        ),
        "performance" => format!(
            "{}'s decline in {} is not booking volume: visits held near {} while the average bill fell from {} to {}.",
            worst.staff_name,
            scope.label,
            worst.current_completed,
            format_money_paise(average_bill(worst.previous_revenue_paise, worst.previous_completed)),
            format_money_paise(average_bill(worst.current_revenue_paise, worst.current_completed))
        ),
        "both" => format!(
            "{}'s decline in {} has two causes: bookings fell from {} to {} and the average bill fell as well.",
            worst.staff_name, scope.label, worst.previous_completed, worst.current_completed
        ),
        _ => format!(
            "{} billed less in {}, but with only {} completed visits in the previous period there is not enough history to name a cause.",
            worst.staff_name, scope.label, worst.previous_completed
        ),
    };

    let mut answer = CopilotAnswer::for_tool(CopilotTool::StaffDeclineCause, headline)
        .source_module("appointments.completed")
        .source_module("staff.schedule")
        .trend_window()
        .add_metric(CopilotMetric::count(
            "Completed visits",
            worst.previous_completed,
            worst.current_completed,
        ))
        .add_metric(CopilotMetric::money(
            "Average bill",
            average_bill(worst.previous_revenue_paise, worst.previous_completed),
            average_bill(worst.current_revenue_paise, worst.current_completed),
        ))
        .add_metric(CopilotMetric::money(
            "Billed value",
            worst.previous_revenue_paise,
            worst.current_revenue_paise,
        ))
        .why(format!(
            "Utilization moved from {utilization_before:.0}% to {utilization_now:.0}% of rostered hours."
        ))
        .link_entity(
            "staff",
            &worst.staff_id,
            &worst.staff_name,
            format!("/staff?staffId={}", worst.staff_id),
        )
        .action(
            match cause {
                "low_bookings" => "Review the rota and demand before raising this with the individual.",
                "performance" => "Review service mix and add-on selling with this staff member.",
                "both" => "Review both the rota and the service mix for this staff member.",
                _ => "Collect more completed visits before drawing a conclusion.",
            },
            "/reports/staff-bookings",
        )
        .with_data(json!({
            "cause": cause,
            "minimumVisitsForCause": MIN_VISITS_FOR_CAUSE,
            "staff": assessed.iter().map(|(row, cause)| json!({
                "staffId": row.staff_id,
                "staffName": row.staff_name,
                "cause": cause,
                "previousCompleted": row.previous_completed,
                "currentCompleted": row.current_completed,
                "previousRevenuePaise": row.previous_revenue_paise,
                "currentRevenuePaise": row.current_revenue_paise,
                "previousScheduledMinutes": row.previous_scheduled_minutes,
                "currentScheduledMinutes": row.current_scheduled_minutes,
            })).collect::<Vec<_>>(),
        }));

    if cause == "insufficient_history" {
        answer = answer
            .gap(format!(
                "Fewer than {MIN_VISITS_FOR_CAUSE} completed visits in the previous period, so no cause is asserted."
            ))
            .confidence_level("low");
    } else if worst.current_scheduled_minutes == 0 {
        answer = answer
            .gap("No published roster for this period, so utilization is indicative only.")
            .confidence_level("medium");
    } else {
        answer = answer.confidence_level("high");
    }
    Ok(answer)
}

/// Which branch bills well but keeps little of it?
///
/// Revenue on its own rewards the busiest branch. Contribution after refunds,
/// product cost and expenses is what shows a branch working hard for very
/// little, which is the branch worth looking at first.
pub async fn branch_margin_outlier(
    db: &PgPool,
    tenant_id: &str,
    scope: &ToolScope,
) -> Result<CopilotAnswer, AppError> {
    let (start, end) = window();
    let rows = scope_repository::finance_summary(db, tenant_id, &scope.branch_ids, start, end)
        .await
        .map_err(|_| AppError::internal("failed to load branch contribution"))?;

    let contribution = |row: &scope_repository::FinanceSummaryRow| {
        row.revenue_paise - row.refund_paise - row.product_cost_paise - row.expense_paise
    };
    let billing: Vec<_> = rows.iter().filter(|row| row.revenue_paise > 0).collect();
    if billing.is_empty() {
        return Ok(CopilotAnswer::for_tool(
            CopilotTool::BranchMarginOutlier,
            format!("No branch in {} billed anything in the last {TREND_DAYS} days.", scope.label),
        )
        .source_module("pos.sales")
        .trend_window()
        .action("Record sales to build a contribution picture.", "/finance")
        .confidence_level("low")
        .with_data(json!({ "branches": [] })));
    }

    let total_revenue: i64 = billing.iter().map(|row| row.revenue_paise).sum();
    let average_revenue = total_revenue / billing.len() as i64;
    // The outlier is the branch with the weakest margin among those billing at
    // or above the scope average, so a quiet branch is not mistaken for a
    // struggling one.
    let busy: Vec<_> = billing
        .iter()
        .filter(|row| row.revenue_paise >= average_revenue)
        .collect();
    let ranked = busy.iter().min_by(|left, right| {
        margin_percent(contribution(left), left.revenue_paise)
            .partial_cmp(&margin_percent(contribution(right), right.revenue_paise))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let Some(worst) = ranked else {
        return Ok(CopilotAnswer::for_tool(
            CopilotTool::BranchMarginOutlier,
            format!("Only one branch in {} has billing activity, so there is nothing to compare.", scope.label),
        )
        .source_module("pos.sales")
        .trend_window()
        .confidence_level("low")
        .with_data(json!({ "branches": [] })));
    };

    let worst_contribution = contribution(worst);
    let worst_margin = margin_percent(worst_contribution, worst.revenue_paise);

    let mut answer = CopilotAnswer::for_tool(
        CopilotTool::BranchMarginOutlier,
        format!(
            "{} bills {} — at or above the {} scope average — but keeps only {:.1}% of it as contribution ({}).",
            worst.branch_name,
            format_money_paise(worst.revenue_paise),
            format_money_paise(average_revenue),
            worst_margin,
            format_money_paise(worst_contribution)
        ),
    )
    .source_module("pos.sales")
    .source_module("inventory.product_cost")
    .source_module("finance.expenses")
    .trend_window()
    .add_metric(CopilotMetric::money("Revenue", 0, worst.revenue_paise))
    .add_metric(CopilotMetric::money(
        "Contribution after direct cost",
        0,
        worst_contribution,
    ))
    .add_metric(CopilotMetric::money("Product cost", 0, worst.product_cost_paise))
    .add_metric(CopilotMetric::money("Recorded expenses", 0, worst.expense_paise))
    .add_metric(CopilotMetric::money("Refunds", 0, worst.refund_paise))
    .why(format!(
        "Product cost {}, expenses {} and refunds {} together absorb {:.0}% of what this branch bills.",
        format_money_paise(worst.product_cost_paise),
        format_money_paise(worst.expense_paise),
        format_money_paise(worst.refund_paise),
        safe_percent(
            worst.product_cost_paise + worst.expense_paise + worst.refund_paise,
            worst.revenue_paise.max(1)
        )
    ))
    .link_entity(
        "branch",
        &worst.branch_id,
        &worst.branch_name,
        "/reports/advanced",
    )
    .action(
        format!("Review product cost and expenses at {}.", worst.branch_name),
        "/finance",
    )
    .with_data(json!({
        "averageRevenuePaise": average_revenue,
        "branches": rows.iter().map(|row| json!({
            "branchId": row.branch_id,
            "branchName": row.branch_name,
            "revenuePaise": row.revenue_paise,
            "refundPaise": row.refund_paise,
            "productCostPaise": row.product_cost_paise,
            "expensePaise": row.expense_paise,
            "contributionPaise": contribution(row),
            "contributionMarginPercent": margin_percent(contribution(row), row.revenue_paise),
        })).collect::<Vec<_>>(),
    }));

    if rows.iter().all(|row| row.expense_paise == 0) {
        answer = answer
            .gap("No expense vouchers recorded in this period, so contribution counts product cost and refunds only.")
            .confidence_level("medium");
    } else {
        answer = answer.confidence_level(if billing.len() >= 3 { "high" } else { "medium" });
    }
    Ok(answer)
}

fn average_bill(revenue_paise: i64, visits: i64) -> i64 {
    if visits <= 0 {
        0
    } else {
        revenue_paise / visits
    }
}

fn margin_percent(contribution_paise: i64, revenue_paise: i64) -> f64 {
    if revenue_paise <= 0 {
        0.0
    } else {
        (contribution_paise as f64 / revenue_paise as f64) * 100.0
    }
}

/// Renders a change with an explicit sign, so a fall reads as a fall.
fn signed_money(paise: i64) -> String {
    if paise > 0 {
        format!("+{}", format_money_paise(paise))
    } else {
        format_money_paise(paise)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn average_bill_treats_no_visits_as_zero_not_a_division() {
        assert_eq!(average_bill(500_000, 0), 0);
        assert_eq!(average_bill(500_000, 5), 100_000);
    }

    #[test]
    fn margin_percent_handles_a_branch_with_no_revenue() {
        assert_eq!(margin_percent(-5_000, 0), 0.0);
        assert_eq!(margin_percent(25_000, 100_000), 25.0);
    }

    #[test]
    fn a_fall_reads_as_a_fall() {
        assert!(signed_money(-150_000).starts_with('-'));
        assert!(signed_money(150_000).starts_with('+'));
    }
}

#[cfg(test)]
mod routing_tests {
    use crate::services::ai_copilot_tools::{detect, CopilotTool};
    use crate::services::ai_tool_dispatcher::tool_domain;
    use crate::services::ai_scope_service::AiDomain;

    /// The four cross-module questions must reach the cross-module tool, not the
    /// single-module tool whose wording they contain.
    #[test]
    fn cross_module_questions_route_past_the_single_module_tools() {
        for (question, expected) in [
            (
                "which service is declining and is it affecting revenue?",
                CopilotTool::ServiceRevenueImpact,
            ),
            (
                "which clients are likely to lapse and what memberships do they hold?",
                CopilotTool::ClientLapseRisk,
            ),
            (
                "which staff decline is caused by low bookings rather than performance?",
                CopilotTool::StaffDeclineCause,
            ),
            (
                "which branch has high sales but poor contribution margin?",
                CopilotTool::BranchMarginOutlier,
            ),
        ] {
            let matched = detect(question)
                .unwrap_or_else(|| panic!("no tool matched {question:?}"));
            assert_eq!(matched.tool, expected, "wrong tool for {question:?}");
        }
    }

    #[test]
    fn a_plain_service_question_still_reaches_the_single_module_tool() {
        // Without the revenue half, this is the ordinary service trend question.
        let matched = detect("which service is declining").expect("a tool matches");
        assert_eq!(matched.tool, CopilotTool::ServiceDecline);
    }

    #[test]
    fn money_bearing_cross_module_tools_are_gated_on_finance() {
        assert_eq!(
            tool_domain(CopilotTool::ServiceRevenueImpact),
            AiDomain::Finance
        );
        assert_eq!(
            tool_domain(CopilotTool::BranchMarginOutlier),
            AiDomain::Finance
        );
        assert_eq!(tool_domain(CopilotTool::ClientLapseRisk), AiDomain::Clients);
        assert_eq!(tool_domain(CopilotTool::StaffDeclineCause), AiDomain::Staff);
    }
}

#[cfg(test)]
mod answer_tests {
    use super::*;
    use crate::services::ai_copilot_tools::ToolScope;
    use sqlx::PgPool;

    struct Fixture {
        tenant_id: String,
        branch_ids: Vec<String>,
    }

    /// A tenant with a service that halved, a lapsed member, a staff member
    /// whose bookings fell, and a branch that bills well but spends heavily.
    async fn seed(db: &PgPool) -> Fixture {
        let tenant_id: String = sqlx::query_scalar(
            "INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id",
        )
        .fetch_one(db)
        .await
        .unwrap();

        let mut branch_ids = Vec::new();
        for name in ["Banjara Hills", "Andheri West"] {
            let id: String = sqlx::query_scalar(
                r#"INSERT INTO branches(tenant_id,name,scope_id,region_name,zone_name,cluster_name,active)
                   VALUES((SELECT id FROM tenants WHERE scope_id=$1),$2,'','South','Hyderabad','Central',TRUE)
                   RETURNING scope_id"#,
            )
            .bind(&tenant_id)
            .bind(name)
            .fetch_one(db)
            .await
            .unwrap();
            branch_ids.push(id);
        }

        for (index, branch_id) in branch_ids.iter().enumerate() {
            let staff_id: String = sqlx::query_scalar(
                r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,job_title,active)
                   VALUES($1,$2,'Asha','Rao',$3,'Stylist',TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(format!("asha{index}@aurasalon.in"))
            .fetch_one(db)
            .await
            .unwrap();
            let client_id: String = sqlx::query_scalar(
                r#"INSERT INTO clients(tenant_id,branch_id,first_name,last_name,active)
                   VALUES($1,$2,'Priya','Menon',TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            let service_id: String = sqlx::query_scalar(
                r#"INSERT INTO services(tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
                   VALUES($1,$2,'Hair Colour','Hair',60,250000,TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();

            // Five completed visits last period — enough to clear the minimum
            // history guard — against one this period: a clear fall in demand.
            for age_days in [50, 45, 40, 38, 35, 5] {
                let appointment_id = format!("appt-{index}-{age_days}");
                sqlx::query(
                    r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,
                         service_ids_json,start_at,end_at,status)
                       VALUES($1,$2,$3,$4,$5,$6,NOW()-MAKE_INTERVAL(days => $7::INT),
                         NOW()-MAKE_INTERVAL(days => $7::INT)+INTERVAL '60 minutes','completed')"#,
                )
                .bind(&appointment_id)
                .bind(&tenant_id)
                .bind(branch_id)
                .bind(&client_id)
                .bind(&staff_id)
                .bind(serde_json::json!([service_id]).to_string())
                .bind(age_days)
                .execute(db)
                .await
                .unwrap();

                let sale_id: String = sqlx::query_scalar(
                    r#"INSERT INTO pos_sales(tenant_id,branch_id,client_id,staff_id,invoice_number,
                         subtotal_paise,total_paise,paid_paise,status,finalized_at)
                       VALUES($1,$2,$3,$4,$5,250000,250000,250000,'paid',
                         NOW()-MAKE_INTERVAL(days => $6::INT)) RETURNING id"#,
                )
                .bind(&tenant_id)
                .bind(branch_id)
                .bind(&client_id)
                .bind(&staff_id)
                .bind(format!("INV-{index}-{age_days}"))
                .bind(age_days)
                .fetch_one(db)
                .await
                .unwrap();
                sqlx::query(
                    r#"INSERT INTO pos_sale_lines(tenant_id,branch_id,sale_id,line_type,item_id,
                         item_name,quantity,unit_price_paise,line_total_paise,staff_id)
                       VALUES($1,$2,$3,'service',$4,'Hair Colour',1,250000,250000,$5)"#,
                )
                .bind(&tenant_id)
                .bind(branch_id)
                .bind(&sale_id)
                .bind(&service_id)
                .bind(&staff_id)
                .execute(db)
                .await
                .unwrap();
            }

            // A member who stopped coming, so the lapse tool has a real subject.
            let lapsed_client: String = sqlx::query_scalar(
                r#"INSERT INTO clients(tenant_id,branch_id,first_name,last_name,active)
                   VALUES($1,$2,'Kavya','Iyer',TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,
                     service_ids_json,start_at,end_at,status)
                   VALUES($1,$2,$3,$4,$5,'[]',NOW()-INTERVAL '200 days',
                     NOW()-INTERVAL '200 days'+INTERVAL '60 minutes','completed')"#,
            )
            .bind(format!("appt-lapsed-{index}"))
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&lapsed_client)
            .bind(&staff_id)
            .execute(db)
            .await
            .unwrap();
            let membership_id: String = sqlx::query_scalar(
                r#"INSERT INTO memberships(tenant_id,branch_id,name,validity_days,active)
                   VALUES($1,$2,'Gold Care',365,TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO client_memberships(tenant_id,branch_id,client_id,membership_id,
                     expires_at,active)
                   VALUES($1,$2,$3,$4,NOW()+INTERVAL '20 days',TRUE)"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&lapsed_client)
            .bind(&membership_id)
            .execute(db)
            .await
            .unwrap();
        }

        // Heavy expenses at the first branch only, so it is the margin outlier.
        let voucher_id: String = sqlx::query_scalar(
            r#"INSERT INTO outgoing_fund_vouchers(tenant_id,branch_id,voucher_number,business_date,
                 payment_account_code,payment_mode,status,idempotency_key,created_by_user_id)
               VALUES($1,$2,'V-1',CURRENT_DATE-3,'CASH_ON_HAND','cash','approved','idem-1','user1')
               RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&branch_ids[0])
        .fetch_one(db)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO outgoing_fund_lines(tenant_id,branch_id,voucher_id,line_number,
                 category_key,account_code,amount_paise)
               VALUES($1,$2,$3,1,'rent','RENT',900000)"#,
        )
        .bind(&tenant_id)
        .bind(&branch_ids[0])
        .bind(&voucher_id)
        .execute(db)
        .await
        .unwrap();

        Fixture {
            tenant_id,
            branch_ids,
        }
    }

    fn scope_of(fixture: &Fixture) -> ToolScope {
        ToolScope {
            branch_ids: fixture.branch_ids.clone(),
            primary_branch_id: fixture.branch_ids[0].clone(),
            label: "2 authorized branches".into(),
            financials_visible: true,
            allowed_domains: crate::services::ai_scope_service::AiDomain::ALL.to_vec(),
            disclosure: crate::services::ai_scope_service::ScopeDisclosure {
                label: "2 authorized branches".into(),
                branch_count: 2,
                branches_read: vec!["Banjara Hills".into(), "Andheri West".into()],
                ..Default::default()
            },
        }
    }

    /// Every cross-module answer must be traceable: sources, period, timestamp,
    /// entity ids with links, and a stated sufficiency.
    fn assert_answer_contract(answer: &CopilotAnswer) {
        assert!(!answer.headline.is_empty(), "an answer needs a conclusion");
        assert!(
            answer.sources.len() >= 2,
            "a cross-module answer must name every module it read: {:?}",
            answer.sources
        );
        assert!(!answer.period.label.is_empty(), "an answer needs a period");
        assert!(
            !answer.confidence.is_empty(),
            "an answer must state its confidence"
        );
        for entity in &answer.entities {
            assert!(!entity.id.is_empty(), "an entity needs an id");
            assert!(!entity.link.is_empty(), "an entity needs a deep link");
        }
    }

    #[sqlx::test]
    async fn a_declining_service_is_measured_against_branch_revenue(pool: PgPool) {
        let fixture = seed(&pool).await;
        let answer = service_revenue_impact(&pool, &fixture.tenant_id, &scope_of(&fixture))
            .await
            .expect("the tool answers");
        assert_answer_contract(&answer);
        assert!(
            answer.sources.iter().any(|source| source == "finance.revenue"),
            "the revenue half must be named as a source: {:?}",
            answer.sources
        );
        assert!(answer.data.get("revenueChangePaise").is_some());
    }

    #[sqlx::test]
    async fn lapsing_clients_are_returned_with_the_membership_they_hold(pool: PgPool) {
        let fixture = seed(&pool).await;
        let answer = client_lapse_risk(&pool, &fixture.tenant_id, &scope_of(&fixture))
            .await
            .expect("the tool answers");
        assert_answer_contract(&answer);

        let clients = answer.data["clients"].as_array().expect("a client list");
        assert!(!clients.is_empty(), "the seeded lapsed member must appear");
        assert!(
            clients
                .iter()
                .any(|client| client["membershipName"] == "Gold Care"),
            "the membership each lapsing client holds must be joined in: {clients:?}"
        );
        assert!(
            answer.entities.iter().any(|entity| entity.kind == "client"),
            "lapsing clients must be linkable"
        );
    }

    #[sqlx::test]
    async fn a_staff_decline_is_attributed_to_bookings_or_to_performance(pool: PgPool) {
        let fixture = seed(&pool).await;
        let answer = staff_decline_cause(&pool, &fixture.tenant_id, &scope_of(&fixture))
            .await
            .expect("the tool answers");
        assert_answer_contract(&answer);

        let cause = answer.data["cause"].as_str().expect("a stated cause");
        assert!(
            ["low_bookings", "performance", "both", "insufficient_history"].contains(&cause),
            "unexpected cause {cause:?}"
        );
        // Bookings fell 4 -> 1 with the same bill each time, so this is demand.
        assert_eq!(
            cause, "low_bookings",
            "a fall in visits at a steady bill is demand, not performance"
        );
    }

    #[sqlx::test]
    async fn the_margin_outlier_is_a_busy_branch_not_a_quiet_one(pool: PgPool) {
        let fixture = seed(&pool).await;
        let answer = branch_margin_outlier(&pool, &fixture.tenant_id, &scope_of(&fixture))
            .await
            .expect("the tool answers");
        assert_answer_contract(&answer);

        let branches = answer.data["branches"].as_array().expect("a branch list");
        assert_eq!(branches.len(), 2);
        // Both branches bill the same; only the first carries the expense.
        assert!(
            answer.headline.contains("Banjara Hills"),
            "the branch carrying the expense must be the outlier: {}",
            answer.headline
        );
    }

    #[sqlx::test]
    async fn an_empty_scope_is_disclosed_rather_than_answered_as_zero(pool: PgPool) {
        let fixture = seed(&pool).await;
        let mut scope = scope_of(&fixture);
        // A branch id that exists nowhere: the tools must say so, not invent.
        scope.branch_ids = vec!["no-such-branch".into()];
        scope.primary_branch_id = "no-such-branch".into();

        let answer = branch_margin_outlier(&pool, &fixture.tenant_id, &scope)
            .await
            .expect("the tool still answers");
        assert!(
            answer.headline.contains("No branch"),
            "an empty scope must be stated: {}",
            answer.headline
        );
        assert_eq!(answer.confidence, "low");
    }
}
