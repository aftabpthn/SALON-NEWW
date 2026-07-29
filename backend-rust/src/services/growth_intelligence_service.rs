use chrono::{DateTime, Duration, Utc};
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
    pub priority: &'static str,
    pub coaching_focus: &'static str,
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
    let staff_coach = repository::staff_coach(db, tenant_id, branch_id)
        .await
        .map_err(internal("load staff coach"))?;

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
    let staff_coach = staff_coach
        .into_iter()
        .map(|row| StaffCoachSignal {
            priority: if row.no_show_count > 0 || row.active_goal_count > 0 {
                "high"
            } else if row.service_count == 0 {
                "medium"
            } else {
                "normal"
            },
            coaching_focus: if row.no_show_count > 0 {
                "No-show recovery"
            } else if row.active_goal_count > 0 {
                "Goal follow-up"
            } else if row.service_count == 0 {
                "Utilization"
            } else {
                "Performance sustain"
            },
            staff_id: row.staff_id,
            staff_name: row.staff_name,
            revenue_paise: row.revenue_paise,
            service_count: row.service_count,
            active_goal_count: row.active_goal_count,
            no_show_count: row.no_show_count,
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
) -> Result<crate::repositories::staff_enterprise_repository::CoachingGoalRecord, AppError> {
    let report = command_center(db, tenant_id, branch_id).await?;
    let staff = report
        .staff_coach
        .iter()
        .find(|row| row.staff_id == staff_id)
        .ok_or_else(|| AppError::not_found("staff signal was not found"))?;
    let (goal_type, target_value, current_value, action_title, action_description, priority) =
        coaching_defaults(staff);
    let request = staff_enterprise_service::CoachingGoalRequest {
        staff_id: staff.staff_id.clone(),
        goal_type,
        metric_unit: "count".to_string(),
        target_value,
        current_value,
        due_date: (Utc::now() + Duration::days(14)).date_naive(),
        action_title,
        action_description: Some(action_description),
        priority: Some(priority.to_string()),
    };
    staff_enterprise_service::create_coaching_goal(db, tenant_id, branch_id, actor, request).await
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

fn coaching_defaults(
    staff: &StaffCoachSignal,
) -> (String, i64, Option<i64>, String, String, &'static str) {
    if staff.no_show_count > 0 {
        (
            "reduce_no_shows".to_string(),
            staff.no_show_count.max(1),
            Some(staff.no_show_count),
            "Reduce no-shows".to_string(),
            "Review missed appointments and create callback follow-up".to_string(),
            "high",
        )
    } else if staff.active_goal_count > 0 {
        (
            "complete_active_goals".to_string(),
            staff.active_goal_count.max(1),
            Some(0),
            "Close coaching actions".to_string(),
            "Review open coaching actions and close the loop".to_string(),
            "high",
        )
    } else if staff.service_count == 0 {
        (
            "increase_utilization".to_string(),
            5,
            Some(0),
            "Build utilization".to_string(),
            "Create a simple utilization target and review weekly coverage".to_string(),
            "medium",
        )
    } else {
        (
            "maintain_performance".to_string(),
            staff.service_count.saturating_add(5),
            Some(staff.service_count),
            "Sustain performance".to_string(),
            "Track current performance and keep the output trend steady".to_string(),
            "normal",
        )
    }
}

fn internal(action: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |error| AppError::internal(format!("{action}: {error}"))
}
