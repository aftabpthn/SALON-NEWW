//! Allow-listed CRM tools the AI copilot may run.
//!
//! The language model never writes or executes SQL. It picks a tool name from
//! this registry; the Rust backend resolves the caller's scope, checks the
//! domain permission, runs the fixed query, and hands back structured facts.
//! A tool that is not listed here cannot be run at all.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;

use crate::{
    models::common::AppError,
    repositories::ai_scope_repository::{
        self as repository, BranchMetricsRow, ConsumptionGrouping, StaffPerformanceRow,
    },
    routes::context::current_business_date,
    services::{
        ai_scope_service::{
            self as scope_service, format_money_paise, safe_percent, AiDomain, AnalysisPeriod,
            AnswerEnvelope, ComparisonPoint, ConfidenceReport, LanguageDetection, MetricPoint,
            RecommendedAction, ResolvedScope, ScopeRequest,
        },
        auth_service::AuthClaims,
    },
};

/// A staff member is not ranked on revenue alone: below this many completed
/// appointments in the window there is nothing meaningful to compare.
const MIN_APPOINTMENTS_FOR_STAFF_VERDICT: i64 = 5;
/// Nor is anyone judged who was never rostered or never clocked in.
const MIN_WORKED_MINUTES_FOR_STAFF_VERDICT: i64 = 240;

/// One entry in the copilot's allow list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub name: &'static str,
    pub domain: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub required_permission: &'static str,
}

/// Every tool the copilot may call, covering the CRM knowledge areas end to end.
pub const TOOL_REGISTRY: &[ToolDescriptor] = &[
    ToolDescriptor {
        name: "branch_performance_comparison",
        domain: "geo_comparison",
        title: "Branch, cluster, zone and region comparison",
        description: "Ranks authorized branches on revenue, utilization and lost appointments.",
        required_permission: "reports.read",
    },
    ToolDescriptor {
        name: "appointment_operations",
        domain: "appointments",
        title: "Appointments and calendar health",
        description: "Completed, cancelled and no-show volumes with utilization.",
        required_permission: "appointments.read",
    },
    ToolDescriptor {
        name: "staff_performance",
        domain: "staff",
        title: "Staff performance intelligence",
        description: "Utilization, revenue, retention, attendance and consumption per staff.",
        required_permission: "staff.read",
    },
    ToolDescriptor {
        name: "service_consumption_variance",
        domain: "inventory",
        title: "Service-wise product consumption variance",
        description: "Expected recipe quantity against recorded actual usage, per service.",
        required_permission: "inventory.read",
    },
    ToolDescriptor {
        name: "product_consumption_variance",
        domain: "inventory",
        title: "Product-wise consumption variance",
        description: "Which products are over-consumed, and the estimated waste cost.",
        required_permission: "inventory.read",
    },
    ToolDescriptor {
        name: "staff_consumption_variance",
        domain: "inventory",
        title: "Staff-wise consumption variance",
        description: "Repeated over-consumption concentrated in specific staff appointments.",
        required_permission: "inventory.read",
    },
    ToolDescriptor {
        name: "stock_reorder_outlook",
        domain: "inventory",
        title: "Stock and reorder outlook",
        description: "Stock cover against observed consumption and sales outflow.",
        required_permission: "inventory.read",
    },
    ToolDescriptor {
        name: "service_demand_trend",
        domain: "services",
        title: "Service demand and revenue trend",
        description: "Which services are growing or declining across the scope.",
        required_permission: "services.read",
    },
    ToolDescriptor {
        name: "client_retention_overview",
        domain: "clients",
        title: "Clients, visits, retention and churn",
        description: "New, returning, lapsed and churn-risk clients per branch.",
        required_permission: "clients.read",
    },
    ToolDescriptor {
        name: "membership_renewal_outlook",
        domain: "memberships",
        title: "Membership benefits, usage and renewals",
        description: "Active, expiring and expired memberships by plan.",
        required_permission: "memberships.read",
    },
    ToolDescriptor {
        name: "package_utilization",
        domain: "packages",
        title: "Packages and loyalty utilization",
        description: "Sold package credits against redemption and unused liability.",
        required_permission: "packages.read",
    },
    ToolDescriptor {
        name: "offer_performance",
        domain: "marketing",
        title: "Offers, discounts and campaigns",
        description: "Offer reach, redemption count and discount given.",
        required_permission: "marketing.read",
    },
    ToolDescriptor {
        name: "finance_summary",
        domain: "finance",
        title: "Finance, expenses, revenue and profit",
        description: "Revenue, refunds, collection, product cost and expenses.",
        required_permission: "finance.read",
    },
    ToolDescriptor {
        name: "client_feedback_overview",
        domain: "reviews",
        title: "Reviews and client feedback",
        description: "Rating volume and average by staff inside the scope.",
        required_permission: "clients.read",
    },
];

pub fn tool_descriptor(name: &str) -> Option<&'static ToolDescriptor> {
    TOOL_REGISTRY.iter().find(|tool| tool.name == name)
}

fn domain_for(name: &str) -> Option<AiDomain> {
    Some(match name {
        "branch_performance_comparison" => AiDomain::GeoComparison,
        "appointment_operations" => AiDomain::Appointments,
        "staff_performance" => AiDomain::Staff,
        "service_consumption_variance"
        | "product_consumption_variance"
        | "staff_consumption_variance"
        | "stock_reorder_outlook" => AiDomain::Inventory,
        "service_demand_trend" => AiDomain::Services,
        "client_retention_overview" => AiDomain::Clients,
        "membership_renewal_outlook" => AiDomain::Memberships,
        "package_utilization" => AiDomain::Packages,
        "offer_performance" => AiDomain::Marketing,
        "finance_summary" => AiDomain::Finance,
        "client_feedback_overview" => AiDomain::Reviews,
        _ => return None,
    })
}

/// What the caller wants answered.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequest {
    pub tool: String,
    #[serde(default)]
    pub scope: ScopeRequest,
    #[serde(default)]
    pub start_date: Option<NaiveDate>,
    #[serde(default)]
    pub end_date: Option<NaiveDate>,
    /// The user's own words, used for language detection and the audit trail.
    #[serde(default)]
    pub question: String,
    /// Explicit reply-language preference; detection fills in when absent.
    #[serde(default)]
    pub language: Option<String>,
}

/// Resolve scope, enforce the domain, run the tool, and record what was read.
///
/// Every exit path writes a scope audit row, including the denied and
/// insufficient-data paths, so the record shows what the copilot was asked as
/// well as what it answered.
pub async fn execute(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    request: &ToolRequest,
) -> Result<AnswerEnvelope, AppError> {
    let descriptor = tool_descriptor(&request.tool)
        .ok_or_else(|| AppError::validation("requested AI tool is not allow-listed"))?;
    let domain = domain_for(&request.tool)
        .ok_or_else(|| AppError::validation("requested AI tool is not allow-listed"))?;

    let language = scope_service::detect_language(&request.question, request.language.as_deref());
    let period = AnalysisPeriod::from_optional(
        request.start_date,
        request.end_date,
        current_business_date(),
    )?;
    let scope =
        scope_service::resolve_scope(db, tenant_id, claims, &request.scope, language.language)
            .await?;

    if let Err(error) = scope_service::require_domain(claims, domain) {
        record_audit(
            db, tenant_id, branch_id, claims, &scope, request, domain, &language, &period, "denied",
        )
        .await;
        return Err(error);
    }

    let branch_ids = scope.branch_ids();
    if branch_ids.is_empty() {
        record_audit(
            db,
            tenant_id,
            branch_id,
            claims,
            &scope,
            request,
            domain,
            &language,
            &period,
            "insufficient_data",
        )
        .await;
        return Err(AppError::forbidden(
            "no branch is authorized for this login, so no CRM data can be read",
        ));
    }

    let answer = match request.tool.as_str() {
        "branch_performance_comparison" => {
            branch_performance(db, tenant_id, &scope, &period, &language).await
        }
        "appointment_operations" => {
            appointment_operations(db, tenant_id, &scope, &period, &language).await
        }
        "staff_performance" => staff_performance(db, tenant_id, &scope, &period, &language).await,
        "service_consumption_variance" => {
            consumption_variance(
                db,
                tenant_id,
                &scope,
                &period,
                &language,
                ConsumptionGrouping::Service,
                "service_consumption_variance",
                "service",
            )
            .await
        }
        "product_consumption_variance" => {
            consumption_variance(
                db,
                tenant_id,
                &scope,
                &period,
                &language,
                ConsumptionGrouping::Product,
                "product_consumption_variance",
                "product",
            )
            .await
        }
        "staff_consumption_variance" => {
            consumption_variance(
                db,
                tenant_id,
                &scope,
                &period,
                &language,
                ConsumptionGrouping::Staff,
                "staff_consumption_variance",
                "staff member",
            )
            .await
        }
        "stock_reorder_outlook" => {
            stock_reorder_outlook(db, tenant_id, &scope, &period, &language).await
        }
        "service_demand_trend" => {
            service_demand_trend(db, tenant_id, &scope, &period, &language).await
        }
        "client_retention_overview" => {
            client_retention_overview(db, tenant_id, &scope, &period, &language).await
        }
        "membership_renewal_outlook" => {
            membership_renewal_outlook(db, tenant_id, &scope, &period, &language).await
        }
        "package_utilization" => {
            package_utilization(db, tenant_id, &scope, &period, &language).await
        }
        "offer_performance" => offer_performance(db, tenant_id, &scope, &period, &language).await,
        "finance_summary" => finance_summary(db, tenant_id, &scope, &period, &language).await,
        "client_feedback_overview" => {
            client_feedback_overview(db, tenant_id, &scope, &period, &language).await
        }
        _ => Err(AppError::validation(
            "requested AI tool is not allow-listed",
        )),
    };

    let outcome = match &answer {
        Ok(envelope) if !envelope.confidence.data_sufficient => "insufficient_data",
        Ok(_) if scope.narrowed => "narrowed",
        Ok(_) => "answered",
        Err(_) => "error",
    };
    record_audit(
        db, tenant_id, branch_id, claims, &scope, request, domain, &language, &period, outcome,
    )
    .await;

    let _ = descriptor;
    answer
}

/// Audit writes must never mask the answer, so failures are logged and dropped.
#[allow(clippy::too_many_arguments)]
async fn record_audit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    claims: &AuthClaims,
    scope: &ResolvedScope,
    request: &ToolRequest,
    domain: AiDomain,
    language: &LanguageDetection,
    period: &AnalysisPeriod,
    outcome: &str,
) {
    let authorized = scope.branch_ids();
    let entry = repository::ScopeAuditInsert {
        tenant_id,
        branch_id,
        user_id: &claims.sub,
        role_name: &claims.role,
        scope_level: scope.level.as_str(),
        scope_label: &scope.label,
        requested_scope_level: scope
            .requested_level
            .map(|level| level.as_str())
            .unwrap_or_default(),
        requested_scope_label: &scope.requested_label,
        narrowed: scope.narrowed,
        authorized_branch_ids: &authorized,
        denied_branch_ids: &scope.excluded_branch_ids,
        tool_name: &request.tool,
        domain: domain.as_str(),
        language_code: &language.code,
        question: &request.question,
        period_start: Some(period.start_date),
        period_end: Some(period.end_date),
        outcome,
    };
    if let Err(error) = repository::record_scope_audit(db, entry).await {
        tracing::warn!(?error, "failed to record AI copilot scope audit");
    }
}

fn totals(rows: &[BranchMetricsRow]) -> (i64, i64, i64, i64, i64, i64) {
    rows.iter().fold((0, 0, 0, 0, 0, 0), |acc, row| {
        (
            acc.0 + row.revenue_paise,
            acc.1 + row.completed_appointments,
            acc.2 + row.cancelled_appointments,
            acc.3 + row.no_show_appointments,
            acc.4 + row.booked_minutes,
            acc.5 + row.scheduled_minutes,
        )
    })
}

async fn branch_period_pair(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
) -> Result<(Vec<BranchMetricsRow>, Vec<BranchMetricsRow>), AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::branch_period_metrics(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch metrics"))?;
    let previous = repository::branch_period_metrics(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison branch metrics"))?;
    Ok((current, previous))
}

async fn branch_performance(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let (current, previous) = branch_period_pair(db, tenant_id, scope, period).await?;
    let (revenue, completed, cancelled, no_shows, booked, scheduled) = totals(&current);
    let (previous_revenue, previous_completed, ..) = totals(&previous);

    let weakest = current
        .iter()
        .filter(|row| row.completed_appointments > 0 || row.revenue_paise > 0)
        .min_by_key(|row| row.revenue_paise);
    let strongest = current.iter().max_by_key(|row| row.revenue_paise);
    let branch_average = if current.is_empty() {
        0
    } else {
        revenue / current.len() as i64
    };

    let conclusion = match (weakest, strongest) {
        (Some(weak), Some(strong)) if current.len() > 1 => format!(
            "In {}, {} is the weakest branch at {} while {} leads at {}. Scope average is {}.",
            scope.label,
            weak.branch_name,
            format_money_paise(weak.revenue_paise),
            strong.branch_name,
            format_money_paise(strong.revenue_paise),
            format_money_paise(branch_average),
        ),
        (Some(weak), _) => format!(
            "{} recorded {} across {} completed appointments in {}.",
            weak.branch_name,
            format_money_paise(weak.revenue_paise),
            weak.completed_appointments,
            period.label(),
        ),
        _ => format!(
            "No billed activity was recorded in {} during {}.",
            scope.label,
            period.label()
        ),
    };

    let utilization = safe_percent(booked, scheduled);
    let metrics = vec![
        MetricPoint::money("revenue", "Scope revenue", revenue),
        MetricPoint::count(
            "completed_appointments",
            "Completed appointments",
            completed,
        ),
        MetricPoint::count("cancelled_appointments", "Cancellations", cancelled),
        MetricPoint::count("no_show_appointments", "No-shows", no_shows),
        MetricPoint::percent("utilization", "Utilization of rostered hours", utilization),
        MetricPoint::money(
            "branch_average_revenue",
            "Average revenue per branch",
            branch_average,
        ),
    ];
    let comparison = vec![
        ComparisonPoint::new(
            "revenue",
            "Revenue",
            revenue as f64 / 100.0,
            previous_revenue as f64 / 100.0,
            true,
        ),
        ComparisonPoint::new(
            "completed_appointments",
            "Completed appointments",
            completed as f64,
            previous_completed as f64,
            false,
        ),
    ];

    let mut reasons = Vec::new();
    if cancelled + no_shows > 0 {
        reasons.push(format!(
            "{} cancellations and {} no-shows removed billable capacity.",
            cancelled, no_shows
        ));
    }
    if scheduled > 0 && utilization < 60.0 {
        reasons.push(format!(
            "Rostered hours were only {utilization:.1}% utilized, so capacity outpaced demand."
        ));
    }
    if let (Some(weak), Some(strong)) = (weakest, strongest) {
        if weak.branch_id != strong.branch_id && weak.unique_clients > 0 {
            reasons.push(format!(
                "{} served {} unique clients against {} at {}.",
                weak.branch_name, weak.unique_clients, strong.unique_clients, strong.branch_name
            ));
        }
    }

    let confidence = confidence_from_volume(completed, current.len(), Vec::new());
    let actions = vec![RecommendedAction {
        action_type: "report_draft".into(),
        label: "Draft a branch review pack".into(),
        description: "Prepare a comparison pack for the weakest branch in this scope.".into(),
        requires_approval: false,
        crm_link: "/reports/advanced".into(),
    }];

    Ok(scope_service::build_answer(
        "branch_performance_comparison",
        AiDomain::GeoComparison,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        actions,
        "/reports/advanced".into(),
    ))
}

async fn appointment_operations(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let (current, previous) = branch_period_pair(db, tenant_id, scope, period).await?;
    let (_, completed, cancelled, no_shows, booked, scheduled) = totals(&current);
    let (_, previous_completed, previous_cancelled, previous_no_shows, ..) = totals(&previous);
    let booked_total = completed + cancelled + no_shows;
    let no_show_rate = safe_percent(no_shows, booked_total);
    let utilization = safe_percent(booked, scheduled);

    let conclusion = format!(
        "{} completed {} appointments in {} with a {:.1}% no-show rate and {:.1}% utilization.",
        scope.label,
        completed,
        period.label(),
        no_show_rate,
        utilization
    );

    let metrics = vec![
        MetricPoint::count("completed_appointments", "Completed", completed),
        MetricPoint::count("cancelled_appointments", "Cancelled", cancelled),
        MetricPoint::count("no_show_appointments", "No-shows", no_shows),
        MetricPoint::percent("no_show_rate", "No-show rate", no_show_rate),
        MetricPoint::percent("utilization", "Utilization of rostered hours", utilization),
    ];
    let comparison = vec![
        ComparisonPoint::new(
            "completed_appointments",
            "Completed",
            completed as f64,
            previous_completed as f64,
            false,
        ),
        ComparisonPoint::new(
            "cancelled_appointments",
            "Cancelled",
            cancelled as f64,
            previous_cancelled as f64,
            false,
        ),
        ComparisonPoint::new(
            "no_show_appointments",
            "No-shows",
            no_shows as f64,
            previous_no_shows as f64,
            false,
        ),
    ];

    let mut reasons = Vec::new();
    if no_show_rate > 10.0 {
        reasons.push(format!(
            "No-shows are above the 10% watch line at {no_show_rate:.1}%, which usually tracks with weak reminder coverage."
        ));
    }
    if scheduled == 0 {
        reasons.push(
            "No working roster was published for this window, so utilization cannot be judged."
                .into(),
        );
    }

    let confidence = confidence_from_volume(
        completed,
        current.len(),
        if scheduled == 0 {
            vec!["Roster data is missing for this period.".to_string()]
        } else {
            Vec::new()
        },
    );

    Ok(scope_service::build_answer(
        "appointment_operations",
        AiDomain::Appointments,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "report_draft".into(),
            label: "Draft a no-show reduction plan".into(),
            description: "Summarise no-show concentration by branch and slot.".into(),
            requires_approval: false,
            crm_link: "/appointment-reports".into(),
        }],
        "/appointment-reports".into(),
    ))
}

/// Whether a staff row carries enough activity to be ranked at all.
///
/// Revenue alone never decides this: someone who was barely rostered has no
/// comparable record, so they are reported separately instead of called weak.
pub fn staff_qualifies_for_verdict(row: &StaffPerformanceRow) -> bool {
    row.completed_appointments >= MIN_APPOINTMENTS_FOR_STAFF_VERDICT
        && (row.worked_minutes >= MIN_WORKED_MINUTES_FOR_STAFF_VERDICT || row.scheduled_minutes > 0)
}

/// Utilization of the hours a staff member was actually rostered for.
pub fn staff_utilization_percent(row: &StaffPerformanceRow) -> f64 {
    let denominator = if row.scheduled_minutes > 0 {
        row.scheduled_minutes
    } else {
        row.worked_minutes
    };
    safe_percent(row.booked_minutes, denominator)
}

async fn staff_performance(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    // A self-scoped login only ever reads its own staff row.
    let staff_filter = scope.self_staff_id.as_deref();
    let current = repository::staff_performance(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
        staff_filter,
    )
    .await
    .map_err(|_| AppError::internal("failed to load staff performance"))?;
    let previous = repository::staff_performance(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
        staff_filter,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison staff performance"))?;

    let (rankable, unrankable): (Vec<_>, Vec<_>) = current
        .iter()
        .partition(|row| staff_qualifies_for_verdict(row));

    let total_revenue: i64 = current
        .iter()
        .map(|row| row.service_revenue_paise + row.product_revenue_paise)
        .sum();
    let previous_revenue: i64 = previous
        .iter()
        .map(|row| row.service_revenue_paise + row.product_revenue_paise)
        .sum();
    let completed: i64 = current.iter().map(|row| row.completed_appointments).sum();
    let previous_completed: i64 = previous.iter().map(|row| row.completed_appointments).sum();

    let weakest = rankable
        .iter()
        .min_by(|left, right| {
            staff_utilization_percent(left)
                .partial_cmp(&staff_utilization_percent(right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .copied();
    let strongest = rankable
        .iter()
        .max_by_key(|row| row.service_revenue_paise + row.product_revenue_paise)
        .copied();

    let conclusion = match (scope.self_staff_id.as_deref(), weakest, strongest) {
        (Some(_), _, _) => match current.first() {
            Some(row) => format!(
                "You completed {} appointments in {} at {:.1}% utilization, billing {}.",
                row.completed_appointments,
                period.label(),
                staff_utilization_percent(row),
                format_money_paise(row.service_revenue_paise + row.product_revenue_paise),
            ),
            None => format!("No completed activity is recorded for you in {}.", period.label()),
        },
        (None, Some(weak), Some(strong)) => format!(
            "Across {}, {} has the lowest utilization at {:.1}% over {} completed appointments, while {} leads on billed value at {}.",
            scope.label,
            weak.staff_name,
            staff_utilization_percent(weak),
            weak.completed_appointments,
            strong.staff_name,
            format_money_paise(strong.service_revenue_paise + strong.product_revenue_paise),
        ),
        _ => format!(
            "No staff member in {} met the minimum activity needed for a performance verdict during {}.",
            scope.label,
            period.label()
        ),
    };

    let rebooked: i64 = current.iter().map(|row| row.rebooked_clients).sum();
    let unique: i64 = current.iter().map(|row| row.unique_clients).sum();
    let returning: i64 = current.iter().map(|row| row.returning_clients).sum();
    let no_shows: i64 = current.iter().map(|row| row.no_show_appointments).sum();
    let cancellations: i64 = current.iter().map(|row| row.cancelled_appointments).sum();
    let booked_minutes: i64 = current.iter().map(|row| row.booked_minutes).sum();
    let scheduled_minutes: i64 = current.iter().map(|row| row.scheduled_minutes).sum();
    let late_days: i64 = current.iter().map(|row| row.late_days).sum();
    let variance_cost: i64 = current
        .iter()
        .map(|row| row.consumption_variance_cost_paise)
        .sum();
    let feedback_count: i64 = current.iter().map(|row| row.feedback_count).sum();
    let feedback_sum: i64 = current.iter().map(|row| row.feedback_rating_sum).sum();
    let average_bill = if completed > 0 {
        total_revenue / completed
    } else {
        0
    };

    let metrics = vec![
        MetricPoint::count(
            "completed_appointments",
            "Completed appointments",
            completed,
        ),
        MetricPoint::percent(
            "utilization",
            "Utilization of rostered hours",
            safe_percent(booked_minutes, scheduled_minutes),
        ),
        MetricPoint::money("service_and_product_revenue", "Billed value", total_revenue),
        MetricPoint::money("average_bill_value", "Average bill value", average_bill),
        MetricPoint::percent(
            "rebooking_rate",
            "Rebooking rate",
            safe_percent(rebooked, unique),
        ),
        MetricPoint::percent(
            "client_retention",
            "Returning client share",
            safe_percent(returning, unique),
        ),
        MetricPoint::percent(
            "cancellation_no_show_rate",
            "Cancellation and no-show rate",
            safe_percent(
                cancellations + no_shows,
                completed + cancellations + no_shows,
            ),
        ),
        MetricPoint::count("late_days", "Late arrivals", late_days),
        MetricPoint::money(
            "consumption_variance_cost",
            "Extra product consumption cost",
            variance_cost,
        ),
        MetricPoint::percent(
            "feedback_average",
            "Average client rating (of 5)",
            if feedback_count > 0 {
                feedback_sum as f64 / feedback_count as f64
            } else {
                0.0
            },
        ),
    ];

    let comparison = vec![
        ComparisonPoint::new(
            "service_and_product_revenue",
            "Billed value",
            total_revenue as f64 / 100.0,
            previous_revenue as f64 / 100.0,
            true,
        ),
        ComparisonPoint::new(
            "completed_appointments",
            "Completed appointments",
            completed as f64,
            previous_completed as f64,
            false,
        ),
    ];

    let mut reasons = Vec::new();
    if !unrankable.is_empty() {
        reasons.push(format!(
            "{} staff had fewer than {} completed appointments or no rostered hours, so they are excluded from the ranking rather than marked weak.",
            unrankable.len(),
            MIN_APPOINTMENTS_FOR_STAFF_VERDICT
        ));
    }
    if late_days > 0 {
        reasons.push(format!(
            "{late_days} late arrivals were recorded, which shortens billable shift time."
        ));
    }
    if variance_cost > 0 {
        reasons.push(format!(
            "Extra product consumption of {} is attributed to these staff appointments.",
            format_money_paise(variance_cost)
        ));
    }
    if feedback_count == 0 {
        reasons.push("No client feedback was captured in this window.".into());
    }

    let mut notes = Vec::new();
    if scheduled_minutes == 0 {
        notes.push("No published roster, so utilization falls back to clocked hours.".to_string());
    }
    let confidence = confidence_from_volume(completed, current.len(), notes);

    let actions = vec![RecommendedAction {
        action_type: "coaching_task_draft".into(),
        label: "Draft a staff coaching task".into(),
        description: "Create a coaching task for the lowest-utilization staff in this scope."
            .into(),
        requires_approval: false,
        crm_link: "/staff/control-center".into(),
    }];

    Ok(scope_service::build_answer(
        "staff_performance",
        AiDomain::Staff,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        actions,
        "/reports/staff-bookings".into(),
    ))
}

#[allow(clippy::too_many_arguments)]
async fn consumption_variance(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
    grouping: ConsumptionGrouping,
    tool_name: &str,
    noun: &str,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::consumption_variance(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
        grouping,
    )
    .await
    .map_err(|_| AppError::internal("failed to load consumption variance"))?;
    let previous = repository::consumption_variance(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
        grouping,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison consumption variance"))?;
    let coverage = repository::consumption_coverage(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load consumption coverage"))?;

    let expected: i64 = current.iter().map(|row| row.expected_quantity).sum();
    let actual: i64 = current.iter().map(|row| row.actual_quantity).sum();
    let variance: i64 = current.iter().map(|row| row.variance_quantity).sum();
    let variance_cost: i64 = current.iter().map(|row| row.variance_cost_paise).sum();
    let previous_cost: i64 = previous.iter().map(|row| row.variance_cost_paise).sum();
    let worst = current.iter().max_by_key(|row| row.variance_cost_paise);

    // Recipe-only deduction gives expected consumption but never real over-usage.
    let actual_usage_recorded = coverage.recorded_usage_events > 0;

    let conclusion = if !actual_usage_recorded {
        format!(
            "Expected recipe consumption is known for {} in {}, but no actual usage was recorded against completed services, so real over-usage cannot be measured for this period.",
            scope.label,
            period.label()
        )
    } else {
        match worst {
            Some(row) if row.variance_quantity > 0 => format!(
                "In {}, {} shows the highest consumption variance: {} extra units above recipe, costing {}.",
                scope.label,
                row.group_name,
                row.variance_quantity,
                format_money_paise(row.variance_cost_paise),
            ),
            _ => format!(
                "No {noun} in {} consumed more than its recipe allowance during {}.",
                scope.label,
                period.label()
            ),
        }
    };

    let metrics = vec![
        MetricPoint::count("expected_quantity", "Expected quantity (recipe)", expected),
        MetricPoint::count("actual_quantity", "Actual recorded quantity", actual),
        MetricPoint::count("variance_quantity", "Variance quantity", variance),
        MetricPoint::money("variance_cost", "Estimated waste cost", variance_cost),
        MetricPoint::count(
            "recorded_usage_events",
            "Recorded usage entries",
            coverage.recorded_usage_events,
        ),
        MetricPoint::count(
            "appointment_linked_usage_events",
            "Usage entries linked to an appointment",
            coverage.appointment_linked_usage_events,
        ),
    ];

    let comparison = vec![ComparisonPoint::new(
        "variance_cost",
        "Estimated waste cost",
        variance_cost as f64 / 100.0,
        previous_cost as f64 / 100.0,
        true,
    )];

    let mut reasons = Vec::new();
    let mut notes = Vec::new();
    if !actual_usage_recorded {
        notes.push(
            "This branch set records no actual consumption ledger entries; only recipe-based expected consumption is available."
                .to_string(),
        );
        reasons.push(
            "Actual over-usage becomes measurable once consumption is recorded against completed appointments with service, staff and product ids."
                .into(),
        );
    } else if coverage.appointment_linked_usage_events < coverage.recorded_usage_events {
        let unlinked = coverage.recorded_usage_events - coverage.appointment_linked_usage_events;
        notes.push(format!(
            "{unlinked} usage entries are not linked to an appointment, so their attribution is partial."
        ));
    }
    if coverage.recipe_backed_services < coverage.completed_services {
        notes.push(format!(
            "{} of {} completed services have no product recipe configured.",
            coverage.completed_services - coverage.recipe_backed_services,
            coverage.completed_services
        ));
    }
    if variance_cost > previous_cost && previous_cost > 0 {
        reasons.push(format!(
            "Waste cost rose from {} to {} against the previous equivalent period.",
            format_money_paise(previous_cost),
            format_money_paise(variance_cost)
        ));
    }

    let confidence = ConfidenceReport::new(
        if !actual_usage_recorded {
            0.25
        } else {
            (0.4 + 0.1 * current.len() as f64).min(0.92)
        },
        actual_usage_recorded,
        notes,
    );

    let actions = vec![RecommendedAction {
        action_type: "stock_audit_draft".into(),
        label: "Draft a stock audit".into(),
        description: "Open a stock audit for the highest-variance products in this scope.".into(),
        requires_approval: false,
        crm_link: "/inventory/stock-audit".into(),
    }];

    Ok(scope_service::build_answer(
        tool_name,
        AiDomain::Inventory,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        actions,
        "/inventory/backbar".into(),
    ))
}

async fn stock_reorder_outlook(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let rows = repository::stock_positions(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
        false,
    )
    .await
    .map_err(|_| AppError::internal("failed to load stock positions"))?;

    let below_reorder: Vec<_> = rows
        .iter()
        .filter(|row| row.stock_quantity <= row.reorder_point)
        .collect();
    let stock_value: i64 = rows
        .iter()
        .map(|row| row.stock_quantity.max(0) * row.unit_cost_paise.max(0))
        .sum();

    // Days of cover from the period's observed outflow, not a static reorder point.
    let urgent = rows
        .iter()
        .filter_map(|row| {
            let outflow = row.consumed_quantity + row.sold_quantity;
            if outflow <= 0 {
                return None;
            }
            let daily = outflow as f64 / period.days as f64;
            let cover_days = row.stock_quantity as f64 / daily;
            Some((row, cover_days))
        })
        .min_by(|left, right| {
            left.1
                .partial_cmp(&right.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

    let conclusion = match urgent {
        Some((row, cover_days)) => format!(
            "{} at {} has the shortest cover in {}: {:.1} days left at the current consumption rate, against a reorder point of {}.",
            row.product_name, row.branch_name, scope.label, cover_days, row.reorder_point
        ),
        None if below_reorder.is_empty() => format!(
            "No product in {} is at or below its reorder point, and no outflow was recorded in {}.",
            scope.label,
            period.label()
        ),
        None => format!(
            "{} products in {} sit at or below their reorder point, though no consumption was recorded in {} to project cover.",
            below_reorder.len(),
            scope.label,
            period.label()
        ),
    };

    let metrics = vec![
        MetricPoint::count("tracked_products", "Tracked products", rows.len() as i64),
        MetricPoint::count(
            "below_reorder_point",
            "At or below reorder point",
            below_reorder.len() as i64,
        ),
        MetricPoint::money("stock_value", "Stock value on hand", stock_value),
    ];

    let mut reasons = Vec::new();
    if !below_reorder.is_empty() {
        reasons.push(format!(
            "{} products are already at or below reorder point and need a purchase decision.",
            below_reorder.len()
        ));
    }

    let confidence = confidence_from_volume(rows.len() as i64, branch_ids.len(), Vec::new());

    Ok(scope_service::build_answer(
        "stock_reorder_outlook",
        AiDomain::Inventory,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        Vec::new(),
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "purchase_draft".into(),
            label: "Draft a purchase order".into(),
            description: "Prepare a reorder draft for products below cover.".into(),
            requires_approval: false,
            crm_link: "/purchase-orders".into(),
        }],
        "/inventory/reorder".into(),
    ))
}

async fn service_demand_trend(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::service_demand(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load service demand"))?;
    let previous = repository::service_demand(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison service demand"))?;

    // Match on branch and service so a service present in several branches is
    // compared against itself, not against a sibling branch's numbers.
    let previous_lookup: std::collections::HashMap<(String, String), i64> = previous
        .iter()
        .map(|row| {
            (
                (row.branch_id.clone(), row.service_id.clone()),
                row.completed_count,
            )
        })
        .collect();

    let mut declining: Vec<(&str, i64, i64)> = current
        .iter()
        .filter_map(|row| {
            let before = *previous_lookup
                .get(&(row.branch_id.clone(), row.service_id.clone()))
                .unwrap_or(&0);
            (before > row.completed_count).then_some((
                row.service_name.as_str(),
                row.completed_count,
                before,
            ))
        })
        .collect();
    declining.sort_by_key(|(_, now, before)| now - before);

    let completed: i64 = current.iter().map(|row| row.completed_count).sum();
    let previous_completed: i64 = previous.iter().map(|row| row.completed_count).sum();
    let revenue: i64 = current.iter().map(|row| row.revenue_paise).sum();
    let previous_revenue: i64 = previous.iter().map(|row| row.revenue_paise).sum();

    let conclusion = match declining.first() {
        Some((name, now, before)) => format!(
            "In {}, {name} declined the most: {before} completed services in the previous period against {now} in {}.",
            scope.label,
            period.label()
        ),
        None if current.is_empty() => format!(
            "No service activity was recorded in {} during {}.",
            scope.label,
            period.label()
        ),
        None => format!(
            "No service in {} declined against the previous equivalent period; {} services were completed in total.",
            scope.label, completed
        ),
    };

    let metrics = vec![
        MetricPoint::count(
            "services_tracked",
            "Services with activity",
            current.len() as i64,
        ),
        MetricPoint::count("completed_services", "Completed services", completed),
        MetricPoint::money("service_revenue", "Service revenue", revenue),
        MetricPoint::count(
            "declining_services",
            "Declining services",
            declining.len() as i64,
        ),
    ];
    let comparison = vec![
        ComparisonPoint::new(
            "completed_services",
            "Completed services",
            completed as f64,
            previous_completed as f64,
            false,
        ),
        ComparisonPoint::new(
            "service_revenue",
            "Service revenue",
            revenue as f64 / 100.0,
            previous_revenue as f64 / 100.0,
            true,
        ),
    ];

    let reasons = declining
        .iter()
        .take(3)
        .map(|(name, now, before)| format!("{name}: {before} -> {now} completed services."))
        .collect();

    let confidence = confidence_from_volume(completed, current.len(), Vec::new());

    Ok(scope_service::build_answer(
        "service_demand_trend",
        AiDomain::Services,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "recommendation".into(),
            label: "Review pricing and promotion for declining services".into(),
            description: "Compare price, staff availability and demand for the declining services."
                .into(),
            requires_approval: false,
            crm_link: "/services".into(),
        }],
        "/reports/service-trends".into(),
    ))
}

async fn client_retention_overview(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::client_retention(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load client retention"))?;
    let previous = repository::client_retention(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison client retention"))?;

    let visiting: i64 = current.iter().map(|row| row.visiting_clients).sum();
    let new_clients: i64 = current.iter().map(|row| row.new_clients).sum();
    let returning: i64 = current.iter().map(|row| row.returning_clients).sum();
    let churn_risk: i64 = current.iter().map(|row| row.churn_risk_clients).sum();
    let previous_visiting: i64 = previous.iter().map(|row| row.visiting_clients).sum();
    let previous_returning: i64 = previous.iter().map(|row| row.returning_clients).sum();

    let weakest = current
        .iter()
        .filter(|row| row.visiting_clients > 0)
        .min_by(|left, right| {
            safe_percent(left.returning_clients, left.visiting_clients)
                .partial_cmp(&safe_percent(
                    right.returning_clients,
                    right.visiting_clients,
                ))
                .unwrap_or(std::cmp::Ordering::Equal)
        });

    let conclusion = match weakest {
        Some(row) if current.len() > 1 => format!(
            "{} has the weakest retention in {}: {:.1}% of its {} visiting clients were returning.",
            row.branch_name,
            scope.label,
            safe_percent(row.returning_clients, row.visiting_clients),
            row.visiting_clients
        ),
        _ => format!(
            "{} served {} clients in {}, of which {} were returning and {} are now churn risks.",
            scope.label,
            visiting,
            period.label(),
            returning,
            churn_risk
        ),
    };

    let metrics = vec![
        MetricPoint::count("visiting_clients", "Clients who visited", visiting),
        MetricPoint::count("new_clients", "New clients", new_clients),
        MetricPoint::count("returning_clients", "Returning clients", returning),
        MetricPoint::percent(
            "retention_rate",
            "Returning client share",
            safe_percent(returning, visiting),
        ),
        MetricPoint::count("churn_risk_clients", "No visit for 90 days", churn_risk),
    ];
    let comparison = vec![
        ComparisonPoint::new(
            "visiting_clients",
            "Clients who visited",
            visiting as f64,
            previous_visiting as f64,
            false,
        ),
        ComparisonPoint::new(
            "returning_clients",
            "Returning clients",
            returning as f64,
            previous_returning as f64,
            false,
        ),
    ];

    let mut reasons = Vec::new();
    if churn_risk > 0 {
        reasons.push(format!(
            "{churn_risk} clients have not completed a visit in 90 days and are win-back candidates."
        ));
    }
    if new_clients > returning {
        reasons.push(
            "Acquisition is outpacing repeat visits, which usually means follow-up booking is weak."
                .into(),
        );
    }

    let confidence = confidence_from_volume(visiting, current.len(), Vec::new());

    Ok(scope_service::build_answer(
        "client_retention_overview",
        AiDomain::Clients,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "marketing_send".into(),
            label: "Send a win-back campaign".into(),
            description: "Reach churn-risk clients in this scope with a win-back message.".into(),
            // Anything that leaves the building waits for a human decision.
            requires_approval: true,
            crm_link: "/marketing".into(),
        }],
        "/reports/service-clients".into(),
    ))
}

async fn membership_renewal_outlook(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let rows = repository::membership_expiry(db, tenant_id, &branch_ids, 30)
        .await
        .map_err(|_| AppError::internal("failed to load membership expiry"))?;

    let expiring: i64 = rows.iter().map(|row| row.expiring_count).sum();
    let expired: i64 = rows.iter().map(|row| row.expired_count).sum();
    let active: i64 = rows.iter().map(|row| row.active_count).sum();
    let top = rows.iter().max_by_key(|row| row.expiring_count);

    let conclusion = match top {
        Some(row) if row.expiring_count > 0 => format!(
            "{} memberships expire in the next 30 days across {}; {} at {} is the largest block.",
            expiring, scope.label, row.membership_name, row.branch_name
        ),
        _ => format!(
            "{active} memberships are active across {} with none expiring in the next 30 days.",
            scope.label
        ),
    };

    let metrics = vec![
        MetricPoint::count("active_memberships", "Active memberships", active),
        MetricPoint::count("expiring_memberships", "Expiring within 30 days", expiring),
        MetricPoint::count("expired_memberships", "Already expired", expired),
    ];

    let mut reasons = Vec::new();
    if expired > 0 {
        reasons.push(format!(
            "{expired} memberships have already lapsed and were not renewed."
        ));
    }

    let confidence = confidence_from_volume(active, rows.len(), Vec::new());

    Ok(scope_service::build_answer(
        "membership_renewal_outlook",
        AiDomain::Memberships,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        Vec::new(),
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "marketing_send".into(),
            label: "Send renewal reminders".into(),
            description: "Notify members whose plans expire inside 30 days.".into(),
            requires_approval: true,
            crm_link: "/memberships".into(),
        }],
        "/memberships".into(),
    ))
}

async fn package_utilization(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let rows = repository::package_utilization(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load package utilization"))?;

    let sold: i64 = rows.iter().map(|row| row.sold_credits).sum();
    let remaining: i64 = rows.iter().map(|row| row.remaining_credits).sum();
    let redeemed: i64 = rows.iter().map(|row| row.redeemed_quantity).sum();
    let expiring: i64 = rows.iter().map(|row| row.expiring_credits).sum();
    let worst = rows.iter().max_by_key(|row| row.remaining_credits);

    let conclusion = match worst {
        Some(row) if row.remaining_credits > 0 => format!(
            "{} credits remain unused across {}; {} at {} carries the largest unused balance of {}.",
            remaining, scope.label, row.package_name, row.branch_name, row.remaining_credits
        ),
        _ => format!(
            "No unused package credits remain across {} in {}.",
            scope.label,
            period.label()
        ),
    };

    let metrics = vec![
        MetricPoint::count("sold_credits", "Credits sold", sold),
        MetricPoint::count("redeemed_credits", "Credits redeemed in period", redeemed),
        MetricPoint::count("remaining_credits", "Credits still unused", remaining),
        MetricPoint::count(
            "expiring_credits",
            "Unused credits already past expiry",
            expiring,
        ),
        MetricPoint::percent(
            "utilization_rate",
            "Credit utilization",
            safe_percent(sold - remaining, sold),
        ),
    ];

    let mut reasons = Vec::new();
    if expiring > 0 {
        reasons.push(format!(
            "{expiring} credits sit against expiry dates already passed and represent lost value."
        ));
    }

    let confidence = confidence_from_volume(sold, rows.len(), Vec::new());

    Ok(scope_service::build_answer(
        "package_utilization",
        AiDomain::Packages,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        Vec::new(),
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "report_draft".into(),
            label: "Draft a package redemption push".into(),
            description: "List clients holding unused credits close to expiry.".into(),
            requires_approval: false,
            crm_link: "/reports/pending-packages".into(),
        }],
        "/packages".into(),
    ))
}

async fn offer_performance(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::offer_performance(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load offer performance"))?;
    let previous = repository::offer_performance(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison offer performance"))?;

    let views: i64 = current.iter().map(|row| row.view_count).sum();
    let clicks: i64 = current.iter().map(|row| row.click_count).sum();
    let used: i64 = current.iter().map(|row| row.used_count).sum();
    let discount: i64 = current.iter().map(|row| row.discount_given_paise).sum();
    let previous_used: i64 = previous.iter().map(|row| row.used_count).sum();
    let previous_discount: i64 = previous.iter().map(|row| row.discount_given_paise).sum();
    let best = current.iter().max_by_key(|row| row.used_count);

    let conclusion = match best {
        Some(row) if row.used_count > 0 => format!(
            "Offer {} led redemption in {} with {} uses and {} of discount given.",
            row.offer_code,
            scope.label,
            row.used_count,
            format_money_paise(row.discount_given_paise)
        ),
        _ => format!(
            "No offer was redeemed across {} during {}.",
            scope.label,
            period.label()
        ),
    };

    let metrics = vec![
        MetricPoint::count("offer_views", "Offer views", views),
        MetricPoint::count("offer_clicks", "Offer clicks", clicks),
        MetricPoint::count("offer_redemptions", "Redemptions", used),
        MetricPoint::money("discount_given", "Discount given", discount),
        MetricPoint::percent(
            "click_through",
            "Click-through rate",
            safe_percent(clicks, views),
        ),
    ];
    let comparison = vec![
        ComparisonPoint::new(
            "offer_redemptions",
            "Redemptions",
            used as f64,
            previous_used as f64,
            false,
        ),
        ComparisonPoint::new(
            "discount_given",
            "Discount given",
            discount as f64 / 100.0,
            previous_discount as f64 / 100.0,
            true,
        ),
    ];

    let mut reasons = Vec::new();
    if discount > previous_discount && used <= previous_used {
        reasons.push(
            "Discount spend rose without a matching lift in redemptions, which erodes margin."
                .into(),
        );
    }

    let confidence = confidence_from_volume(used, current.len(), Vec::new());

    Ok(scope_service::build_answer(
        "offer_performance",
        AiDomain::Marketing,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "offer_publish".into(),
            label: "Publish a revised offer".into(),
            description: "Adjust the discount and republish to the selected channels.".into(),
            requires_approval: true,
            crm_link: "/marketing".into(),
        }],
        "/marketing".into(),
    ))
}

async fn finance_summary(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::finance_summary(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load finance summary"))?;
    let previous = repository::finance_summary(
        db,
        tenant_id,
        &branch_ids,
        period.previous_start_date,
        period.previous_end_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load comparison finance summary"))?;

    let sum = |rows: &[repository::FinanceSummaryRow],
               extract: fn(&repository::FinanceSummaryRow) -> i64| {
        rows.iter().map(extract).sum::<i64>()
    };
    let revenue = sum(&current, |row| row.revenue_paise);
    let refunds = sum(&current, |row| row.refund_paise);
    let collected = sum(&current, |row| row.collected_paise);
    let outstanding = sum(&current, |row| row.outstanding_paise);
    let product_cost = sum(&current, |row| row.product_cost_paise);
    let expenses = sum(&current, |row| row.expense_paise);
    let discount = sum(&current, |row| row.discount_paise);
    let contribution = revenue - refunds - product_cost - expenses;
    let previous_revenue = sum(&previous, |row| row.revenue_paise);
    let previous_contribution = sum(&previous, |row| row.revenue_paise)
        - sum(&previous, |row| row.refund_paise)
        - sum(&previous, |row| row.product_cost_paise)
        - sum(&previous, |row| row.expense_paise);

    let conclusion = format!(
        "{} billed {} in {} with {} collected, leaving {} outstanding and {} contribution after refunds, product cost and expenses.",
        scope.label,
        format_money_paise(revenue),
        period.label(),
        format_money_paise(collected),
        format_money_paise(outstanding),
        format_money_paise(contribution),
    );

    let metrics = vec![
        MetricPoint::money("revenue", "Revenue", revenue),
        MetricPoint::money("collected", "Collected", collected),
        MetricPoint::money("outstanding", "Outstanding", outstanding),
        MetricPoint::money("refunds", "Refunds", refunds),
        MetricPoint::money("discount", "Discount given", discount),
        MetricPoint::money("product_cost", "Product cost of sales", product_cost),
        MetricPoint::money("expenses", "Recorded expenses", expenses),
        MetricPoint::money(
            "contribution",
            "Contribution after direct cost",
            contribution,
        ),
    ];
    let comparison = vec![
        ComparisonPoint::new(
            "revenue",
            "Revenue",
            revenue as f64 / 100.0,
            previous_revenue as f64 / 100.0,
            true,
        ),
        ComparisonPoint::new(
            "contribution",
            "Contribution",
            contribution as f64 / 100.0,
            previous_contribution as f64 / 100.0,
            true,
        ),
    ];

    let mut reasons = Vec::new();
    if outstanding > 0 {
        reasons.push(format!(
            "{} is billed but not yet collected.",
            format_money_paise(outstanding)
        ));
    }
    if discount > 0 && revenue > 0 {
        reasons.push(format!(
            "Discounts absorbed {:.1}% of billed value.",
            safe_percent(discount, revenue + discount)
        ));
    }

    let confidence = confidence_from_volume(revenue / 100, current.len(), Vec::new());

    Ok(scope_service::build_answer(
        "finance_summary",
        AiDomain::Finance,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        comparison,
        reasons,
        confidence,
        vec![RecommendedAction {
            action_type: "report_draft".into(),
            label: "Draft a collection follow-up list".into(),
            description: "List invoices with outstanding balances in this scope.".into(),
            requires_approval: false,
            crm_link: "/reports/due-recovery".into(),
        }],
        "/finance".into(),
    ))
}

async fn client_feedback_overview(
    db: &PgPool,
    tenant_id: &str,
    scope: &ResolvedScope,
    period: &AnalysisPeriod,
    language: &LanguageDetection,
) -> Result<AnswerEnvelope, AppError> {
    let branch_ids = scope.branch_ids();
    let current = repository::staff_performance(
        db,
        tenant_id,
        &branch_ids,
        period.start_date,
        period.end_date,
        scope.self_staff_id.as_deref(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load client feedback"))?;

    let count: i64 = current.iter().map(|row| row.feedback_count).sum();
    let rating_sum: i64 = current.iter().map(|row| row.feedback_rating_sum).sum();
    let average = if count > 0 {
        rating_sum as f64 / count as f64
    } else {
        0.0
    };
    let lowest = current
        .iter()
        .filter(|row| row.feedback_count > 0)
        .min_by(|left, right| {
            let left_average = left.feedback_rating_sum as f64 / left.feedback_count as f64;
            let right_average = right.feedback_rating_sum as f64 / right.feedback_count as f64;
            left_average
                .partial_cmp(&right_average)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

    let conclusion = if count == 0 {
        format!(
            "No client reviews were captured across {} during {}.",
            scope.label,
            period.label()
        )
    } else {
        match lowest {
            Some(row) => format!(
                "{} reviews across {} averaged {:.2} of 5; {} has the lowest average at {:.2}.",
                count,
                scope.label,
                average,
                row.staff_name,
                row.feedback_rating_sum as f64 / row.feedback_count as f64
            ),
            None => format!(
                "{count} reviews across {} averaged {average:.2} of 5.",
                scope.label
            ),
        }
    };

    let metrics = vec![
        MetricPoint::count("review_count", "Reviews received", count),
        MetricPoint::percent("average_rating", "Average rating (of 5)", average),
    ];

    let confidence = ConfidenceReport::new(
        if count >= 20 {
            0.85
        } else if count > 0 {
            0.5
        } else {
            0.2
        },
        count > 0,
        if count == 0 {
            vec!["No review data exists for this scope and period.".to_string()]
        } else {
            Vec::new()
        },
    );

    Ok(scope_service::build_answer(
        "client_feedback_overview",
        AiDomain::Reviews,
        scope,
        period,
        language.clone(),
        conclusion,
        metrics,
        Vec::new(),
        Vec::new(),
        confidence,
        vec![RecommendedAction {
            action_type: "coaching_task_draft".into(),
            label: "Draft a service quality review".into(),
            description: "Summarise low-rated appointments for a coaching conversation.".into(),
            requires_approval: false,
            crm_link: "/staff/control-center".into(),
        }],
        "/clients".into(),
    ))
}

/// Confidence from how much evidence the window actually held.
///
/// A tiny sample scores low even when the arithmetic is exact, so a thin answer
/// is never presented as a firm one.
fn confidence_from_volume(
    observations: i64,
    group_count: usize,
    mut notes: Vec<String>,
) -> ConfidenceReport {
    let sufficient = observations > 0;
    if !sufficient {
        notes.push("No matching records exist in this scope and period.".to_string());
    } else if observations < 20 {
        notes.push(format!(
            "Only {observations} records back this answer, so treat the trend as indicative."
        ));
    }
    let score = if !sufficient {
        0.15
    } else {
        let volume_score = (observations as f64 / 200.0).min(0.7);
        let breadth_score = (group_count as f64 / 20.0).min(0.2);
        0.25 + volume_score + breadth_score
    };
    ConfidenceReport::new(score, sufficient, notes)
}

/// The tools this login may run, so the client only offers what will succeed.
pub fn available_tools(claims: &AuthClaims) -> serde_json::Value {
    let tools: Vec<_> = TOOL_REGISTRY
        .iter()
        .filter(|tool| {
            domain_for(tool.name)
                .is_some_and(|domain| scope_service::domain_allowed(claims, domain))
        })
        .map(|tool| {
            json!({
                "name": tool.name,
                "domain": tool.domain,
                "title": tool.title,
                "description": tool.description,
                "requiredPermission": tool.required_permission,
            })
        })
        .collect();
    json!({ "tools": tools })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn staff_row(completed: i64, scheduled: i64, worked: i64, booked: i64) -> StaffPerformanceRow {
        StaffPerformanceRow {
            staff_id: "staff-1".into(),
            staff_name: "Test Staff".into(),
            branch_id: "branch-1".into(),
            branch_name: "Branch One".into(),
            job_title: "Stylist".into(),
            completed_appointments: completed,
            cancelled_appointments: 0,
            no_show_appointments: 0,
            booked_minutes: booked,
            scheduled_minutes: scheduled,
            worked_minutes: worked,
            present_days: 0,
            late_days: 0,
            absent_days: 0,
            service_revenue_paise: 0,
            product_revenue_paise: 0,
            invoice_count: 0,
            unique_clients: 0,
            rebooked_clients: 0,
            returning_clients: 0,
            service_duration_variance_minutes: 0,
            feedback_count: 0,
            feedback_rating_sum: 0,
            target_count: 0,
            consumption_variance_quantity: 0,
            consumption_variance_cost_paise: 0,
        }
    }

    #[test]
    fn low_revenue_staff_with_a_full_roster_is_still_rankable() {
        let row = staff_row(12, 2400, 2300, 1200);
        assert!(staff_qualifies_for_verdict(&row));
    }

    #[test]
    fn barely_booked_staff_is_excluded_from_the_ranking() {
        let row = staff_row(2, 0, 60, 60);
        assert!(!staff_qualifies_for_verdict(&row));
    }

    #[test]
    fn staff_with_no_roster_and_no_hours_is_excluded() {
        let row = staff_row(9, 0, 0, 300);
        assert!(!staff_qualifies_for_verdict(&row));
    }

    #[test]
    fn utilization_falls_back_to_worked_minutes_without_a_roster() {
        let row = staff_row(10, 0, 600, 300);
        assert_eq!(staff_utilization_percent(&row), 50.0);
    }

    #[test]
    fn utilization_prefers_the_published_roster() {
        let row = staff_row(10, 1200, 600, 300);
        assert_eq!(staff_utilization_percent(&row), 25.0);
    }

    #[test]
    fn every_registered_tool_maps_to_a_domain() {
        for tool in TOOL_REGISTRY {
            assert!(
                domain_for(tool.name).is_some(),
                "tool {} has no domain mapping",
                tool.name
            );
        }
    }

    #[test]
    fn registered_permissions_match_their_domain() {
        for tool in TOOL_REGISTRY {
            let domain = domain_for(tool.name).expect("domain mapping");
            assert_eq!(
                domain.required_permission(),
                tool.required_permission,
                "tool {} advertises the wrong permission",
                tool.name
            );
        }
    }

    #[test]
    fn unknown_tool_names_are_rejected() {
        assert!(tool_descriptor("drop_all_tables").is_none());
        assert!(domain_for("select_star").is_none());
    }

    #[test]
    fn empty_result_sets_are_reported_as_insufficient() {
        let report = confidence_from_volume(0, 0, Vec::new());
        assert!(!report.data_sufficient);
        assert_eq!(report.level, "low");
    }

    #[test]
    fn thin_samples_score_lower_than_rich_ones() {
        let thin = confidence_from_volume(5, 1, Vec::new());
        let rich = confidence_from_volume(400, 12, Vec::new());
        assert!(thin.score < rich.score);
        assert!(rich.data_sufficient);
    }
}
