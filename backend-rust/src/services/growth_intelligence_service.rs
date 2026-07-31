use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::{growth_intelligence_repository as repository, whatsapp_repository},
    services::{analytics_service, staff_enterprise_service},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthIntelligence {
    pub owner: OwnerCommandCenter,
    pub revenue_leaks: Vec<RevenueLeakSignal>,
    pub client_memory: Vec<ClientMemoryNode>,
    pub campaign_planner: Vec<CampaignPlannerCard>,
    pub staff_coach: Vec<StaffCoachSignal>,
    pub digital_twin: Vec<DigitalTwinScenario>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerCommandCenter {
    pub revenue_30d_paise: i64,
    pub today_appointments: i64,
    pub open_appointments: i64,
    pub open_due_count: i64,
    pub outstanding_paise: i64,
    pub low_stock_count: i64,
    pub active_staff_count: i64,
    pub active_client_count: i64,
    pub attention_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueLeakSignal {
    pub kind: String,
    pub title: String,
    pub message: String,
    pub impact_paise: i64,
    pub severity: String,
    pub next_action: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMemoryNode {
    pub client_id: String,
    pub client_name: String,
    pub visit_count: i64,
    pub revenue_paise: i64,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub no_show_count: i64,
    pub cancellation_count: i64,
    pub risk_score: i64,
    pub next_action: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignPlannerCard {
    pub key: String,
    pub title: String,
    pub segment_key: String,
    pub audience_count: i64,
    pub draft_count: i64,
    pub approved_count: i64,
    pub action_label: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffCoachSignal {
    pub staff_id: String,
    pub staff_name: String,
    pub revenue_paise: i64,
    pub service_count: i64,
    pub active_goal_count: i64,
    pub no_show_count: i64,
    pub priority: String,
    pub coaching_focus: String,
    pub opportunities: Vec<RevenueOpportunity>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueOpportunity {
    pub key: String,
    pub title: String,
    pub reason: String,
    pub suggested_action: String,
    pub owner_staff_id: String,
    pub owner_staff_name: String,
    pub metric_unit: String,
    pub current_value: i64,
    pub target_value: i64,
    pub projected_impact_paise: i64,
    pub deadline: NaiveDate,
    pub priority: String,
    pub status: String,
    pub goal_id: Option<String>,
    pub action_id: Option<String>,
    pub action_status: Option<String>,
    pub action_version: Option<i32>,
    pub baseline_value: Option<i64>,
    pub actual_value: i64,
    pub actual_impact_paise: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DigitalTwinScenario {
    pub key: &'static str,
    pub title: &'static str,
    pub metric_label: &'static str,
    pub metric_value: i64,
    pub impact_paise: i64,
    pub recommendation: &'static str,
}

pub async fn command_center(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<GrowthIntelligence, AppError> {
    let to_date = Utc::now().date_naive();
    let from_date = to_date - Duration::days(30);
    let leak_report = analytics_service::advanced_profit_intelligence(
        db,
        tenant_id,
        &[branch_id.to_string()],
        "branch",
        from_date,
        to_date,
    )
    .await?;
    let owner = repository::owner_command(db, tenant_id, branch_id)
        .await
        .map_err(internal("load owner command center"))?;
    let client_memory = repository::client_memory(db, tenant_id, branch_id)
        .await
        .map_err(internal("load client memory graph"))?;
    let campaign_planner = repository::campaign_plans(db, tenant_id, branch_id)
        .await
        .map_err(internal("load campaign planner"))?;
    let staff_coach = staff_revenue_signals(db, tenant_id, branch_id, "").await?;

    let owner = OwnerCommandCenter {
        attention_count: owner.open_due_count + owner.low_stock_count + owner.open_appointments,
        revenue_30d_paise: owner.revenue_30d_paise,
        today_appointments: owner.today_appointments,
        open_appointments: owner.open_appointments,
        open_due_count: owner.open_due_count,
        outstanding_paise: owner.outstanding_paise,
        low_stock_count: owner.low_stock_count,
        active_staff_count: owner.active_staff_count,
        active_client_count: owner.active_client_count,
    };
    let revenue_leaks = leak_report
        .leaks
        .into_iter()
        .take(8)
        .map(|row| RevenueLeakSignal {
            next_action: if row.impact_paise > 100_000 {
                "Approve fix"
            } else if row.severity == "high" {
                "Review now"
            } else {
                "Track"
            },
            kind: row.kind,
            title: row.title,
            message: row.message,
            impact_paise: row.impact_paise,
            severity: row.severity,
        })
        .collect::<Vec<_>>();
    let client_memory = client_memory
        .into_iter()
        .map(|row| {
            let stale_visit_score = row
                .last_visit_at
                .map(|value| (Utc::now() - value).num_days())
                .filter(|days| *days > 90)
                .map(|days| (days / 30).min(20))
                .unwrap_or(0);
            let risk_score =
                (row.no_show_count * 18 + row.cancellation_count * 10 + stale_visit_score).min(100);
            ClientMemoryNode {
                client_id: row.client_id,
                client_name: row.client_name,
                visit_count: row.visit_count,
                revenue_paise: row.revenue_paise,
                last_visit_at: row.last_visit_at,
                no_show_count: row.no_show_count,
                cancellation_count: row.cancellation_count,
                risk_score,
                next_action: if risk_score >= 35 {
                    "Review retention"
                } else {
                    "Maintain relationship"
                },
            }
        })
        .collect::<Vec<_>>();
    let campaign_planner = campaign_planner
        .into_iter()
        .map(|row| CampaignPlannerCard {
            action_label: if row.audience_count <= 0 {
                "No audience"
            } else if row.approved_count > 0 {
                "Ready"
            } else if row.draft_count > 0 {
                "Review draft"
            } else {
                "Create draft"
            },
            key: row.key,
            title: row.title,
            segment_key: row.segment_key,
            audience_count: row.audience_count,
            draft_count: row.draft_count,
            approved_count: row.approved_count,
        })
        .collect::<Vec<_>>();
    let digital_twin = digital_twin(&owner, &campaign_planner);

    Ok(GrowthIntelligence {
        owner,
        revenue_leaks,
        client_memory,
        campaign_planner,
        staff_coach,
        digital_twin,
        generated_at: Utc::now(),
    })
}

pub async fn draft_campaign_plan(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    key: &str,
) -> Result<whatsapp_repository::WhatsAppCampaignPlan, AppError> {
    let report = command_center(db, tenant_id, branch_id).await?;
    let card = report
        .campaign_planner
        .iter()
        .find(|row| row.key == key)
        .ok_or_else(|| AppError::not_found("campaign segment was not found"))?;
    if card.audience_count <= 0 {
        return Err(AppError::validation("campaign segment has no audience"));
    }
    let (title, objective, message_text, segment_key) = campaign_defaults(card.key.as_str());
    whatsapp_repository::create_campaign_plan(
        db,
        tenant_id,
        branch_id,
        "whatsapp",
        title,
        objective,
        message_text,
        &card.segment_key,
        &json!({
            "source": "growth-intelligence",
            "segmentKey": segment_key,
            "audienceCount": card.audience_count,
            "draftReason": card.action_label,
        }),
        actor,
    )
    .await
    .map_err(|error| AppError::internal(format!("failed to create campaign draft: {error}")))
}

pub async fn draft_staff_goal(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    staff_id: &str,
    opportunity_key: &str,
) -> Result<crate::repositories::staff_enterprise_repository::CoachingGoalRecord, AppError> {
    let staff = staff_revenue_signals(db, tenant_id, branch_id, staff_id)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found("staff signal was not found"))?;
    let opportunity = staff
        .opportunities
        .into_iter()
        .find(|row| opportunity_key.is_empty() || row.key == opportunity_key)
        .ok_or_else(|| AppError::not_found("revenue opportunity was not found"))?;
    if opportunity.status == "active" {
        return Err(AppError::validation(
            "revenue opportunity already has an active action",
        ));
    }
    let request = staff_enterprise_service::CoachingGoalRequest {
        staff_id: staff.staff_id,
        goal_type: opportunity.key,
        metric_unit: opportunity.metric_unit,
        target_value: opportunity.target_value,
        current_value: Some(opportunity.current_value),
        projected_impact_paise: Some(opportunity.projected_impact_paise),
        due_date: opportunity.deadline,
        action_title: opportunity.suggested_action,
        action_description: Some(opportunity.reason),
        priority: Some(opportunity.priority),
    };
    staff_enterprise_service::create_coaching_goal(db, tenant_id, branch_id, actor, request).await
}

pub async fn revenue_opportunities_for_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<RevenueOpportunity>, AppError> {
    Ok(staff_revenue_signals(db, tenant_id, branch_id, staff_id)
        .await?
        .into_iter()
        .next()
        .map(|row| row.opportunities)
        .unwrap_or_default())
}

async fn staff_revenue_signals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<StaffCoachSignal>, AppError> {
    let rows = repository::staff_coach(db, tenant_id, branch_id)
        .await
        .map_err(internal("load staff revenue intelligence"))?;
    let goals =
        staff_enterprise_service::list_coaching_goals(db, tenant_id, branch_id, staff_id, "")
            .await?;
    let mut goals_by_staff: HashMap<String, Vec<_>> = HashMap::new();
    for goal in goals {
        goals_by_staff
            .entry(goal.staff_id.clone())
            .or_default()
            .push(goal);
    }
    Ok(rows
        .into_iter()
        .filter(|row| staff_id.is_empty() || row.staff_id == staff_id)
        .map(|row| {
            let opportunities = build_revenue_opportunities(
                &row,
                goals_by_staff
                    .get(&row.staff_id)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            );
            let priority = opportunities
                .first()
                .map(|item| item.priority.clone())
                .unwrap_or_else(|| "normal".into());
            let coaching_focus = opportunities
                .first()
                .map(|item| item.title.clone())
                .unwrap_or_else(|| "Performance sustain".into());
            StaffCoachSignal {
                staff_id: row.staff_id,
                staff_name: row.staff_name,
                revenue_paise: row.revenue_paise,
                service_count: row.service_count,
                active_goal_count: row.active_goal_count,
                no_show_count: row.no_show_count,
                priority,
                coaching_focus,
                opportunities,
            }
        })
        .collect())
}

struct OpportunitySeed {
    key: &'static str,
    title: &'static str,
    reason: String,
    action: &'static str,
    unit: &'static str,
    current: i64,
    target: i64,
    impact: i64,
    qualifies: bool,
}

fn build_revenue_opportunities(
    row: &repository::StaffCoachRecord,
    goals: &[crate::repositories::staff_enterprise_repository::CoachingGoalRecord],
) -> Vec<RevenueOpportunity> {
    let avg_bill = row.average_bill_paise;
    let rebooking = row.metric_value("rebooking").unwrap_or(0);
    let upsell = row.metric_value("product_upsell").unwrap_or(0);
    let utilization = row.metric_value("utilization").unwrap_or(0);
    let retention = row.metric_value("client_retention").unwrap_or(0);
    let seeds = [
        OpportunitySeed { key:"rebooking", title:"Low rebooking", reason:format!("{} of {} recent clients rebooked after {} completed visits ({}%).",row.rebooked_clients,row.unique_clients,row.completed_visits,rebooking), action:"Contact eligible clients and secure their next appointment", unit:"percent", current:rebooking, target:60, impact:((60-rebooking).max(0)*row.unique_clients/100)*avg_bill, qualifies:row.unique_clients>=3 && rebooking<60 },
        OpportunitySeed { key:"product_upsell", title:"Product upsell", reason:format!("{} of {} attributed bills included a product ({}%).",row.product_invoice_count,row.invoice_count,upsell), action:"Recommend one inventory-backed aftercare product per eligible bill", unit:"percent", current:upsell, target:20, impact:((20-upsell).max(0)*row.invoice_count/100)*row.average_product_sale_paise, qualifies:row.invoice_count>=3 && upsell<20 && row.average_product_sale_paise>0 },
        OpportunitySeed { key:"package_membership", title:"Package or membership", reason:format!("{} package or membership sales were attributed across {} bills.",row.membership_package_count,row.invoice_count), action:"Identify repeat clients and present the suitable live package or membership", unit:"count", current:row.membership_package_count, target:(row.membership_package_count+1).max(1), impact:row.average_membership_package_sale_paise, qualifies:row.invoice_count>=3 && row.membership_package_count==0 && row.average_membership_package_sale_paise>0 },
        OpportunitySeed { key:"utilization", title:"Underutilized hours", reason:format!("{} of {} scheduled minutes were booked ({}%).",row.booked_minutes,row.scheduled_minutes,utilization), action:"Fill open roster hours with approved rebooking and waitlist follow-up", unit:"percent", current:utilization, target:70, impact:if row.booked_minutes>0 {(70-utilization).max(0)*row.scheduled_minutes/100*row.revenue_paise/row.booked_minutes} else {0}, qualifies:row.scheduled_minutes>=240 && utilization<70 },
        OpportunitySeed { key:"client_retention", title:"Client retention", reason:format!("{} of {} recent clients had a prior completed visit ({}%); {} older clients have not returned.",row.retained_clients,row.unique_clients,retention,row.inactive_clients), action:"Complete retention follow-up for clients without a return visit", unit:"percent", current:retention, target:40, impact:row.inactive_clients*avg_bill, qualifies:row.unique_clients>=3 && (retention<40 || row.inactive_clients>0) },
        OpportunitySeed { key:"service_mix", title:"Service mix", reason:format!("Revenue covered {} of {} active service departments.",row.service_category_count,row.branch_service_category_count), action:"Offer one relevant cross-department service after consultation", unit:"count", current:row.service_category_count, target:(row.service_category_count+1).min(row.branch_service_category_count).max(1), impact:avg_bill, qualifies:row.service_count>=3 && row.branch_service_category_count>1 && row.service_category_count<row.branch_service_category_count },
        OpportunitySeed { key:"average_bill", title:"Average bill improvement", reason:format!("Attributed average bill is {} paise versus branch average {} paise.",avg_bill,row.branch_average_bill_paise), action:"Review service mix and approved add-ons before checkout", unit:"paise", current:avg_bill, target:row.branch_average_bill_paise.max(1), impact:(row.branch_average_bill_paise-avg_bill).max(0)*row.invoice_count, qualifies:row.invoice_count>=3 && avg_bill>0 && row.branch_average_bill_paise>avg_bill },
    ];
    let deadline = (Utc::now() + Duration::days(14)).date_naive();
    let mut output = seeds
        .into_iter()
        .filter_map(|seed| {
            let goal = goals.iter().find(|goal| goal.goal_type == seed.key);
            if !seed.qualifies && goal.is_none() {
                return None;
            }
            let action = goal.and_then(|goal| goal.actions.as_array()?.first());
            let baseline = goal.and_then(|goal| goal.current_value);
            let projected = goal
                .and_then(|goal| goal.projected_impact_paise)
                .unwrap_or(seed.impact.max(0));
            let actual_impact = baseline.map(|baseline| {
                let expected = (seed.target - baseline).max(1);
                projected.saturating_mul((seed.current - baseline).max(0)) / expected
            });
            let priority = if projected >= 100_000 {
                "high"
            } else if projected > 0 {
                "medium"
            } else {
                "low"
            };
            Some(RevenueOpportunity {
                key: seed.key.into(),
                title: seed.title.into(),
                reason: seed.reason,
                suggested_action: seed.action.into(),
                owner_staff_id: row.staff_id.clone(),
                owner_staff_name: row.staff_name.clone(),
                metric_unit: seed.unit.into(),
                current_value: seed.current,
                target_value: goal.map(|goal| goal.target_value).unwrap_or(seed.target),
                projected_impact_paise: projected,
                deadline: goal.map(|goal| goal.due_date).unwrap_or(deadline),
                priority: priority.into(),
                status: goal
                    .map(|goal| goal.status.clone())
                    .unwrap_or_else(|| "recommended".into()),
                goal_id: goal.map(|goal| goal.id.clone()),
                action_id: action
                    .and_then(|value| value["id"].as_str())
                    .map(str::to_string),
                action_status: action
                    .and_then(|value| value["status"].as_str())
                    .map(str::to_string),
                action_version: action
                    .and_then(|value| value["version"].as_i64())
                    .map(|value| value as i32),
                baseline_value: baseline,
                actual_value: seed.current,
                actual_impact_paise: actual_impact,
            })
        })
        .collect::<Vec<_>>();
    output.sort_by_key(|item| {
        (
            match item.status.as_str() {
                "active" => 0,
                "recommended" => 1,
                _ => 2,
            },
            match item.priority.as_str() {
                "high" => 0,
                "medium" => 1,
                _ => 2,
            },
        )
    });
    output
}

fn digital_twin(
    owner: &OwnerCommandCenter,
    campaigns: &[CampaignPlannerCard],
) -> Vec<DigitalTwinScenario> {
    let avg_client_revenue = if owner.active_client_count > 0 {
        owner.revenue_30d_paise / owner.active_client_count
    } else {
        0
    };
    let inactive_audience = campaigns
        .iter()
        .find(|row| row.key == "inactive")
        .map(|row| row.audience_count)
        .unwrap_or(0);

    vec![
        DigitalTwinScenario {
            key: "discount-margin-guard",
            title: "Discount margin guard",
            metric_label: "30-day revenue",
            metric_value: owner.revenue_30d_paise,
            impact_paise: owner.revenue_30d_paise / 20,
            recommendation: "Run margin check before broad discount approval",
        },
        DigitalTwinScenario {
            key: "winback-capacity",
            title: "Win-back capacity",
            metric_label: "Inactive audience",
            metric_value: inactive_audience,
            impact_paise: inactive_audience * avg_client_revenue / 4,
            recommendation: "Draft owner-approved WhatsApp win-back plan",
        },
        DigitalTwinScenario {
            key: "staff-load",
            title: "Staff load",
            metric_label: "Appointments per active staff",
            metric_value: if owner.active_staff_count > 0 {
                owner.today_appointments / owner.active_staff_count
            } else {
                0
            },
            impact_paise: 0,
            recommendation: "Check staff coach before adding surge slots",
        },
        DigitalTwinScenario {
            key: "stock-rescue",
            title: "Stock rescue",
            metric_label: "Low-stock items",
            metric_value: owner.low_stock_count,
            impact_paise: 0,
            recommendation: "Use inventory autopilot before campaign launch",
        },
    ]
}

fn campaign_defaults(key: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    match key {
        "birthday" => (
            "Birthday Wishes",
            "Reactivate birthday clients",
            "Hi {{clientName}}, happy birthday. We would love to see you again. Reply to book your visit.",
            "birthday",
        ),
        "inactive" => (
            "Win-back Clients",
            "Recover inactive clients",
            "Hi {{clientName}}, we missed you. Reply to book your next visit and reconnect with the salon.",
            "inactive_90",
        ),
        "dues" => (
            "Due Recovery",
            "Collect outstanding dues",
            "Hi {{clientName}}, your account has an outstanding balance. Please review and settle at your convenience.",
            "open_dues",
        ),
        _ => (
            "Growth Campaign",
            "Launch targeted outreach",
            "Hi {{clientName}}, we have a salon update for you. Reply to book your next visit.",
            "growth_intelligence",
        ),
    }
}

fn internal(action: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |error| AppError::internal(format!("{action}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revenue_signal_carries_action_owner_deadline_and_measured_result() {
        let row = repository::StaffCoachRecord {
            staff_id: "s1".into(),
            staff_name: "Staff One".into(),
            revenue_paise: 300_000,
            service_count: 6,
            active_goal_count: 0,
            no_show_count: 0,
            completed_visits: 6,
            unique_clients: 5,
            rebooked_clients: 1,
            retained_clients: 1,
            invoice_count: 5,
            product_invoice_count: 0,
            membership_package_count: 0,
            booked_minutes: 600,
            scheduled_minutes: 1200,
            average_bill_paise: 60_000,
            branch_average_bill_paise: 80_000,
            service_category_count: 1,
            branch_service_category_count: 3,
            inactive_clients: 2,
            average_product_sale_paise: 20_000,
            average_membership_package_sale_paise: 100_000,
        };
        let rows = build_revenue_opportunities(&row, &[]);
        assert!(rows.iter().any(|item| item.key == "rebooking"
            && item.owner_staff_id == "s1"
            && item.deadline > Utc::now().date_naive()
            && item.projected_impact_paise > 0));
        assert!(rows.iter().any(|item| item.key == "product_upsell"));
        assert!(rows.iter().any(|item| item.key == "package_membership"));
        assert!(rows.iter().any(|item| item.key == "utilization"));
        assert!(rows.iter().any(|item| item.key == "client_retention"));
        assert!(rows.iter().any(|item| item.key == "service_mix"));
        assert!(rows.iter().any(|item| item.key == "average_bill"));
    }
}
