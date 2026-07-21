use std::{
    collections::{BTreeMap, BTreeSet},
    time::{Duration as StdDuration, Instant},
};

use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::{balance_sheet::AccountGroup, common::AppError},
    repositories::analytics_repository,
    services::{accounting_service, balance_sheet_service, invoice_delivery},
    state::AppState,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenuePoint {
    pub date: String,
    pub value_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueForecast {
    pub method: &'static str,
    pub source: &'static str,
    pub history_days: i32,
    pub forecast_days: i32,
    pub historical_total_paise: i64,
    pub forecast_total_paise: i64,
    pub daily_average_paise: i64,
    pub history: Vec<RevenuePoint>,
    pub forecast: Vec<RevenuePoint>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitMetrics {
    pub revenue_paise: i64,
    pub cost_of_goods_paise: i64,
    pub gross_profit_paise: i64,
    pub operating_expense_paise: i64,
    pub total_expense_paise: i64,
    pub net_profit_paise: i64,
    pub net_margin_bps: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitBreakdownRow {
    pub key: String,
    pub metrics: ProfitMetrics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitIntelligence {
    pub from_date: String,
    pub to_date: String,
    pub source: &'static str,
    pub branch_scope: String,
    pub branch_count: usize,
    pub group_by: String,
    pub metrics: ProfitMetrics,
    pub breakdown: Vec<ProfitBreakdownRow>,
    pub unclassified_accounts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitDimensionRow {
    pub dimension: String,
    pub entity_id: String,
    pub entity_name: String,
    pub unit_count: i64,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub staff_time_cost_paise: i64,
    pub gateway_fee_paise: i64,
    pub refund_fee_paise: i64,
    pub overhead_cost_paise: i64,
    pub total_cost_paise: i64,
    pub net_profit_paise: i64,
    pub margin_bps: i64,
    pub fully_loaded_cost_paise: i64,
    pub fully_loaded_profit_paise: i64,
    pub fully_loaded_margin_bps: i64,
    pub line_count: i64,
    pub incomplete_cost_line_count: i64,
    pub cost_completeness_bps: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeVarianceRow {
    pub service_id: String,
    pub service_name: String,
    pub sold_quantity: i64,
    pub recipe_item_count: i64,
    pub expected_cost_paise: i64,
    pub actual_cost_paise: i64,
    pub variance_paise: i64,
    pub variance_bps: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitLeak {
    pub kind: String,
    pub source_type: String,
    pub source_id: String,
    pub title: String,
    pub message: String,
    pub impact_paise: i64,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingRecommendation {
    pub service_id: String,
    pub service_name: String,
    pub current_average_price_paise: i64,
    pub suggested_price_paise: i64,
    pub current_margin_bps: i64,
    pub target_margin_bps: i64,
    pub expected_profit_lift_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotInsight {
    pub recommendation_version_id: String,
    pub recommendation_key: String,
    pub recommendation_version: String,
    pub evaluation_status: String,
    pub kind: String,
    pub title: String,
    pub message: String,
    pub impact_paise: i64,
    pub source_type: String,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitHighlight {
    pub entity_id: String,
    pub label: String,
    pub profit_paise: i64,
    pub revenue_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutiveProfitKpis {
    pub top_service: Option<ProfitHighlight>,
    pub top_staff: Option<ProfitHighlight>,
    pub top_customer: Option<ProfitHighlight>,
    pub top_branch: Option<ProfitHighlight>,
    pub revenue_per_staff_paise: i64,
    pub revenue_per_customer_paise: i64,
    pub revenue_per_branch_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerProfitScore {
    pub customer_id: String,
    pub customer_name: String,
    pub revenue_paise: i64,
    pub profit_paise: i64,
    pub discount_paise: i64,
    pub unit_count: i64,
    pub margin_bps: i64,
    pub profit_score: i64,
    pub tier: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingProfitRecommendation {
    pub service_id: String,
    pub service_name: String,
    pub recommended_hour: i32,
    pub appointment_count: i64,
    pub peak_score: i64,
    pub expected_revenue_paise: i64,
    pub expected_cost_paise: i64,
    pub expected_profit_paise: i64,
    pub margin_bps: i64,
    pub suggested_price_uplift_bps: i64,
    pub restriction_reason: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitLiabilityRisk {
    pub kind: String,
    pub plan_id: String,
    pub plan_name: String,
    pub sold_value_paise: i64,
    pub recognized_value_paise: i64,
    pub remaining_liability_paise: i64,
    pub projected_cost_paise: i64,
    pub expected_future_profit_paise: i64,
    pub severity: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitTrendPoint {
    pub date: NaiveDate,
    pub revenue_paise: i64,
    pub direct_cost_paise: i64,
    pub contribution_profit_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnterpriseProfitAnalytics {
    pub trend: Vec<ProfitTrendPoint>,
    pub next_month_forecast_profit_paise: i64,
    pub forecast_basis: &'static str,
    pub alerts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitScenario {
    pub name: &'static str,
    pub projected_revenue_paise: i64,
    pub projected_profit_paise: i64,
    pub profit_delta_paise: i64,
    pub projected_margin_bps: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitDigitalTwin {
    pub baseline_revenue_paise: i64,
    pub baseline_profit_paise: i64,
    pub scenarios: Vec<ProfitScenario>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitBoardReport {
    pub top_wins: Vec<String>,
    pub top_risks: Vec<String>,
    pub next_actions: Vec<String>,
    pub expected_recovery_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedProfitIntelligence {
    pub from_date: String,
    pub to_date: String,
    pub source: &'static str,
    pub branch_scope: String,
    pub branch_count: usize,
    pub copilot_source: String,
    pub copilot_model: String,
    pub copilot_fact_schema_version: String,
    pub copilot_fact_hash: String,
    pub copilot_evaluation_status: String,
    pub reconciliation_ready: bool,
    pub recommendations_blocked: bool,
    pub incomplete_cost_line_count: i64,
    pub executive_kpis: ExecutiveProfitKpis,
    pub customer_profit_scores: Vec<CustomerProfitScore>,
    pub service_profit: Vec<ProfitDimensionRow>,
    pub category_profit: Vec<ProfitDimensionRow>,
    pub staff_profit: Vec<ProfitDimensionRow>,
    pub customer_profit: Vec<ProfitDimensionRow>,
    pub product_profit: Vec<ProfitDimensionRow>,
    pub appointment_profit: Vec<ProfitDimensionRow>,
    pub branch_profit: Vec<ProfitDimensionRow>,
    pub channel_profit: Vec<ProfitDimensionRow>,
    pub leaks: Vec<ProfitLeak>,
    pub pricing: Vec<PricingRecommendation>,
    pub recipe_variance: Vec<RecipeVarianceRow>,
    pub booking_recommendations: Vec<BookingProfitRecommendation>,
    pub liability_risks: Vec<ProfitLiabilityRisk>,
    pub enterprise_analytics: EnterpriseProfitAnalytics,
    pub profit_digital_twin: ProfitDigitalTwin,
    pub board_report: ProfitBoardReport,
    pub copilot: Vec<CopilotInsight>,
    #[serde(skip)]
    copilot_facts: Option<CopilotFactSet>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitLine {
    pub branch_id: String,
    pub branch_name: String,
    pub first_event_date: NaiveDate,
    pub last_event_date: NaiveDate,
    pub sale_id: String,
    pub sale_line_id: String,
    pub invoice_number: String,
    pub reference_id: String,
    pub appointment_id: String,
    pub appointment_name: String,
    pub channel: String,
    pub journal_entry_id: String,
    pub inventory_movement_ids: Vec<String>,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub item_category: String,
    pub unit_count: i64,
    pub discount_paise: i64,
    pub staff_id: String,
    pub staff_name: String,
    pub client_id: String,
    pub client_name: String,
    pub recognized_revenue_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub staff_time_cost_paise: i64,
    pub gateway_fee_paise: i64,
    pub refund_fee_paise: i64,
    pub overhead_cost_paise: i64,
    pub total_direct_cost_paise: i64,
    pub contribution_profit_paise: i64,
    pub contribution_margin_bps: i64,
    pub controllable_cost_paise: i64,
    pub controllable_profit_paise: i64,
    pub controllable_margin_bps: i64,
    pub fully_loaded_cost_paise: i64,
    pub fully_loaded_profit_paise: i64,
    pub fully_loaded_margin_bps: i64,
    pub product_cost_status: String,
    pub staff_cost_status: String,
    pub staff_time_cost_status: String,
    pub gateway_fee_status: String,
    pub refund_fee_status: String,
    pub overhead_status: String,
    pub missing_invoice_journal: bool,
    pub cost_completeness_bps: i64,
    pub completeness_status: &'static str,
    pub event_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitPage {
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    pub branch_scope: String,
    pub branch_count: usize,
    pub source: &'static str,
    pub profit_levels: [&'static str; 3],
    pub commission_double_count_protected: bool,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
    pub rows: Vec<MicroProfitLine>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitAllocationRuleCreateRequest {
    pub name: String,
    pub driver: String,
    pub account_codes: Vec<String>,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitAllocationRule {
    pub id: String,
    pub name: String,
    pub version: i32,
    pub driver: String,
    pub account_codes: Vec<String>,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub created_by_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitReconciliation {
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    pub branch_scope: String,
    pub branch_count: usize,
    pub ledger_revenue_paise: i64,
    pub micro_revenue_paise: i64,
    pub revenue_variance_paise: i64,
    pub revenue_bridge: RevenueBridge,
    pub ledger_cogs_paise: i64,
    pub micro_product_cost_paise: i64,
    pub cogs_variance_paise: i64,
    pub ledger_payroll_paise: i64,
    pub payroll_source_paise: i64,
    pub payroll_variance_paise: i64,
    pub rounding_bridge_paise: i64,
    pub reportable_line_count: i64,
    pub complete_line_count: i64,
    pub completeness_bps: i64,
    pub cost_complete_line_count: i64,
    pub cost_completeness_bps: i64,
    pub missing_invoice_journal_count: i64,
    pub missing_product_cost_line_count: i64,
    pub missing_staff_cost_line_count: i64,
    pub missing_staff_time_cost_line_count: i64,
    pub missing_gateway_fee_line_count: i64,
    pub missing_refund_fee_line_count: i64,
    pub allocation_rule_count: i64,
    pub unallocated_overhead_paise: i64,
    pub reconciled: bool,
    pub branch_period_close_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueBridge {
    pub ledger_revenue_paise: i64,
    pub missing_invoice_journal_paise: i64,
    pub micro_revenue_paise: i64,
    pub unexplained_variance_paise: i64,
}

const COPILOT_FACT_SCHEMA_VERSION: &str = "micro-pnl-reconciled-v1";

#[derive(Debug, Clone, Serialize)]
struct CopilotFactSet {
    fact_schema_version: &'static str,
    period_start: NaiveDate,
    period_end: NaiveDate,
    branch_count: usize,
    ledger_revenue_paise: i64,
    micro_revenue_paise: i64,
    revenue_variance_paise: i64,
    ledger_cogs_paise: i64,
    micro_product_cost_paise: i64,
    cogs_variance_paise: i64,
    ledger_payroll_paise: i64,
    payroll_source_paise: i64,
    payroll_variance_paise: i64,
    cost_completeness_bps: i64,
    reportable_line_count: i64,
    reconciled: bool,
    branch_period_close_ready: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitCopilotFeedbackRequest {
    pub decision: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitCopilotFeedback {
    pub id: String,
    pub recommendation_version_id: String,
    pub decision: String,
    pub comment: String,
    pub actor_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceJournalRepairItem {
    pub branch_id: String,
    pub sale_id: String,
    pub invoice_number: String,
    pub business_date: NaiveDate,
    pub total_paise: i64,
    pub period_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceJournalRepairRun {
    pub attempted: i64,
    pub repaired: i64,
    pub blocked_closed_period: i64,
    pub failed: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomReportDefinition {
    pub dataset: String,
    pub row_dimension: String,
    pub column_dimension: String,
    pub metric: String,
    pub date_range: String,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomReportSaveRequest {
    pub id: Option<String>,
    pub version: Option<i32>,
    pub name: String,
    pub definition: CustomReportDefinition,
    pub schedule_frequency: String,
    pub schedule_day: Option<i16>,
    pub schedule_time: Option<String>,
    pub recipient_email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCell {
    pub row_key: String,
    pub column_key: String,
    pub value: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotReport {
    pub dataset: String,
    pub metric: String,
    pub from_date: String,
    pub to_date: String,
    pub rows: Vec<String>,
    pub columns: Vec<String>,
    pub cells: Vec<PivotCell>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomReportView {
    pub id: String,
    pub name: String,
    pub definition: CustomReportDefinition,
    pub schedule_frequency: String,
    pub schedule_day: i16,
    pub schedule_time: String,
    pub recipient_email: String,
    pub next_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_status: String,
    pub last_error: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub fn custom_report_options(include_organization: bool) -> Value {
    let mut datasets = vec![
        json!({"id":"sales","label":"Sales","dimensions":["date","service","staff","lineType","status"],"metrics":["revenuePaise","quantity","discountPaise","invoiceCount"]}),
        json!({"id":"appointments","label":"Appointments","dimensions":["date","status","staff","source"],"metrics":["appointmentCount","durationMinutes"]}),
        json!({"id":"outgoing","label":"Outgoing Funds","dimensions":["date","category","status","paymentMode","fundSource","partyType","department"],"metrics":["amountPaise","gstPaise","voucherCount","lineCount"]}),
    ];
    if include_organization {
        datasets.push(json!({"id":"multiBranch","label":"Multi-Branch","dimensions":["date","region","zone","cluster","branch","status"],"metrics":["revenuePaise","discountPaise","taxPaise","tipPaise","refundPaise","invoiceCount"]}));
    }
    json!({
        "datasets": datasets,
        "dateRanges": ["last7Days","last30Days","monthToDate","custom"],
        "schedules": ["none","daily","weekly","monthly"]
    })
}

pub async fn preview_custom_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    definition: &CustomReportDefinition,
    allow_organization: bool,
) -> Result<PivotReport, AppError> {
    validate_custom_definition(definition, allow_organization)?;
    let (from_date, to_date) = custom_report_dates(definition, Utc::now())?;
    let records = analytics_repository::custom_pivot(
        db,
        tenant_id,
        branch_id,
        &definition.dataset,
        &definition.row_dimension,
        &definition.column_dimension,
        &definition.metric,
        from_date,
        to_date,
        definition.status.as_deref().unwrap_or(""),
    )
    .await
    .map_err(|_| AppError::internal("failed to build custom report"))?;
    Ok(build_pivot(definition, from_date, to_date, records))
}

pub async fn list_custom_reports(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CustomReportView>, AppError> {
    analytics_repository::list_custom_reports(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load saved reports"))?
        .into_iter()
        .map(custom_report_view)
        .collect()
}

pub async fn save_custom_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    allow_organization: bool,
    request: CustomReportSaveRequest,
) -> Result<CustomReportView, AppError> {
    validate_custom_definition(&request.definition, allow_organization)?;
    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(AppError::validation("report name is invalid"));
    }
    let frequency = request.schedule_frequency.trim();
    if !matches!(frequency, "none" | "daily" | "weekly" | "monthly") {
        return Err(AppError::validation("report schedule is invalid"));
    }
    let requested_day = request.schedule_day.unwrap_or(1);
    let day = match frequency {
        "weekly" if (1..=7).contains(&requested_day) => requested_day,
        "monthly" if (1..=28).contains(&requested_day) => requested_day,
        "weekly" | "monthly" => {
            return Err(AppError::validation("report schedule day is invalid"));
        }
        _ => 1,
    };
    let time =
        NaiveTime::parse_from_str(request.schedule_time.as_deref().unwrap_or("09:00"), "%H:%M")
            .map_err(|_| AppError::validation("report schedule time is invalid"))?;
    let recipient = request.recipient_email.unwrap_or_default();
    if frequency != "none"
        && (recipient.len() > 254
            || !recipient.contains('@')
            || recipient.starts_with('@')
            || recipient.ends_with('@'))
    {
        return Err(AppError::validation(
            "scheduled report recipient email is invalid",
        ));
    }
    let next_run_at = next_custom_report_run(frequency, day, time, Utc::now());
    let definition = serde_json::to_value(&request.definition)
        .map_err(|_| AppError::internal("failed to save report definition"))?;
    analytics_repository::save_custom_report(
        db,
        tenant_id,
        branch_id,
        request.id.as_deref(),
        request.version,
        name,
        &definition,
        frequency,
        day,
        time,
        recipient.trim(),
        next_run_at,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save custom report"))?
    .ok_or_else(|| AppError::conflict("saved report changed; reload and retry"))
    .and_then(custom_report_view)
}

pub async fn run_saved_custom_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    allow_organization: bool,
) -> Result<PivotReport, AppError> {
    let row = analytics_repository::get_custom_report(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load saved report"))?
        .ok_or_else(|| AppError::not_found("saved report was not found"))?;
    let definition: CustomReportDefinition = serde_json::from_value(row.definition_json)
        .map_err(|_| AppError::internal("saved report definition is invalid"))?;
    let report =
        preview_custom_report(db, tenant_id, branch_id, &definition, allow_organization).await?;
    let result = serde_json::to_value(&report)
        .map_err(|_| AppError::internal("failed to record report result"))?;
    analytics_repository::record_custom_report_result(db, tenant_id, branch_id, id, &result)
        .await
        .map_err(|_| AppError::internal("failed to record report result"))?;
    Ok(report)
}

pub async fn process_due_custom_reports(state: &AppState) -> Result<usize, AppError> {
    let rows = analytics_repository::claim_due_custom_reports(&state.db, 10)
        .await
        .map_err(|_| AppError::internal("failed to claim scheduled reports"))?;
    let mut sent = 0usize;
    for row in rows {
        let definition =
            match serde_json::from_value::<CustomReportDefinition>(row.definition_json.clone()) {
                Ok(value) => value,
                Err(_) => {
                    let next = next_custom_report_run(
                        &row.schedule_frequency,
                        row.schedule_day,
                        row.schedule_time,
                        Utc::now(),
                    )
                    .unwrap_or_else(|| Utc::now() + Duration::days(1));
                    analytics_repository::finish_scheduled_custom_report(
                        &state.db,
                        &row.id,
                        None,
                        "saved report definition is invalid",
                        next,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to update scheduled report"))?;
                    continue;
                }
            };
        let result =
            preview_custom_report(&state.db, &row.tenant_id, &row.branch_id, &definition, true)
                .await;
        let outcome = match result {
            Ok(report) => {
                let value = serde_json::to_value(&report)
                    .map_err(|_| AppError::internal("failed to serialize scheduled report"))?;
                let payload = json!({
                    "channel":"email",
                    "recipient":row.recipient_email,
                    "purpose":"custom_bi_report",
                    "reportId":row.id,
                    "reportName":row.name,
                    "idempotencyKey":format!("custom-report:{}:{}",row.id,row.last_run_at.unwrap_or_else(Utc::now).timestamp()),
                    "report":value
                });
                match invoice_delivery::deliver(&state.settings, &payload).await {
                    Ok(_) => Ok(value),
                    Err(error) => Err(format!("{error:?}")),
                }
            }
            Err(error) => Err(format!("{error:?}")),
        };
        match outcome {
            Ok(value) => {
                let next = next_custom_report_run(
                    &row.schedule_frequency,
                    row.schedule_day,
                    row.schedule_time,
                    Utc::now() + Duration::seconds(1),
                )
                .unwrap_or_else(|| Utc::now() + Duration::days(1));
                analytics_repository::finish_scheduled_custom_report(
                    &state.db,
                    &row.id,
                    Some(&value),
                    "",
                    next,
                )
                .await
                .map_err(|_| AppError::internal("failed to complete scheduled report"))?;
                sent += 1;
            }
            Err(error) => {
                let backoff = 15_i64
                    .saturating_mul(1_i64 << row.consecutive_failures.clamp(0, 5))
                    .min(720);
                analytics_repository::finish_scheduled_custom_report(
                    &state.db,
                    &row.id,
                    None,
                    &error.chars().take(1_000).collect::<String>(),
                    Utc::now() + Duration::minutes(backoff),
                )
                .await
                .map_err(|_| AppError::internal("failed to retry scheduled report"))?;
            }
        }
    }
    Ok(sent)
}

fn validate_custom_definition(
    definition: &CustomReportDefinition,
    allow_organization: bool,
) -> Result<(), AppError> {
    let (dimensions, metrics): (&[&str], &[&str]) = match definition.dataset.as_str() {
        "sales" => (
            &["date", "service", "staff", "lineType", "status"],
            &["revenuePaise", "quantity", "discountPaise", "invoiceCount"],
        ),
        "appointments" => (
            &["date", "status", "staff", "source"],
            &["appointmentCount", "durationMinutes"],
        ),
        "multiBranch" if allow_organization => (
            &["date", "region", "zone", "cluster", "branch", "status"],
            &[
                "revenuePaise",
                "discountPaise",
                "taxPaise",
                "tipPaise",
                "refundPaise",
                "invoiceCount",
            ],
        ),
        "outgoing" => (
            &[
                "date",
                "category",
                "status",
                "paymentMode",
                "fundSource",
                "partyType",
                "department",
            ],
            &["amountPaise", "gstPaise", "voucherCount", "lineCount"],
        ),
        _ => return Err(AppError::validation("custom report dataset is invalid")),
    };
    if !dimensions.contains(&definition.row_dimension.as_str())
        || (definition.column_dimension != "none"
            && !dimensions.contains(&definition.column_dimension.as_str()))
        || definition.row_dimension == definition.column_dimension
        || !metrics.contains(&definition.metric.as_str())
    {
        return Err(AppError::validation(
            "custom report dimension or metric is invalid",
        ));
    }
    if !matches!(
        definition.date_range.as_str(),
        "last7Days" | "last30Days" | "monthToDate" | "custom"
    ) {
        return Err(AppError::validation("custom report date range is invalid"));
    }
    if definition.status.as_deref().is_some_and(|status| {
        status.len() > 40
            || !status
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "_-".contains(character))
    }) {
        return Err(AppError::validation("custom report status is invalid"));
    }
    Ok(())
}

fn custom_report_dates(
    definition: &CustomReportDefinition,
    now: DateTime<Utc>,
) -> Result<(NaiveDate, NaiveDate), AppError> {
    let india = FixedOffset::east_opt(19_800)
        .ok_or_else(|| AppError::internal("failed to calculate report timezone"))?;
    let today = now.with_timezone(&india).date_naive();
    let range = match definition.date_range.as_str() {
        "last7Days" => (today - Duration::days(6), today),
        "last30Days" => (today - Duration::days(29), today),
        "monthToDate" => (
            NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .ok_or_else(|| AppError::internal("failed to calculate month start"))?,
            today,
        ),
        "custom" => (
            NaiveDate::parse_from_str(definition.from_date.as_deref().unwrap_or(""), "%Y-%m-%d")
                .map_err(|_| AppError::validation("custom report fromDate is invalid"))?,
            NaiveDate::parse_from_str(definition.to_date.as_deref().unwrap_or(""), "%Y-%m-%d")
                .map_err(|_| AppError::validation("custom report toDate is invalid"))?,
        ),
        _ => return Err(AppError::validation("custom report date range is invalid")),
    };
    if range.0 > range.1 || (range.1 - range.0).num_days() > 366 {
        return Err(AppError::validation(
            "custom report date range must be 367 days or less",
        ));
    }
    Ok(range)
}

fn next_custom_report_run(
    frequency: &str,
    day: i16,
    time: NaiveTime,
    now: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    if frequency == "none" {
        return None;
    }
    let india = FixedOffset::east_opt(19_800)?;
    let local_now = now.with_timezone(&india);
    for offset in 0..=370 {
        let date = local_now.date_naive() + Duration::days(offset);
        let matches = frequency == "daily"
            || (frequency == "weekly"
                && date.weekday().number_from_monday() == u32::from(day as u16))
            || (frequency == "monthly" && date.day() == u32::from(day as u16));
        if !matches {
            continue;
        }
        let candidate = india.from_local_datetime(&date.and_time(time)).single()?;
        if candidate > local_now {
            return Some(candidate.with_timezone(&Utc));
        }
    }
    None
}

fn build_pivot(
    definition: &CustomReportDefinition,
    from_date: NaiveDate,
    to_date: NaiveDate,
    records: Vec<analytics_repository::PivotCellRecord>,
) -> PivotReport {
    let rows = records
        .iter()
        .map(|record| record.row_key.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let columns = records
        .iter()
        .map(|record| record.column_key.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let total = records.iter().map(|record| record.value).sum();
    PivotReport {
        dataset: definition.dataset.clone(),
        metric: definition.metric.clone(),
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        rows,
        columns,
        cells: records
            .into_iter()
            .map(|record| PivotCell {
                row_key: record.row_key,
                column_key: record.column_key,
                value: record.value,
            })
            .collect(),
        total,
    }
}

fn custom_report_view(
    record: analytics_repository::CustomReportRecord,
) -> Result<CustomReportView, AppError> {
    let definition = serde_json::from_value(record.definition_json)
        .map_err(|_| AppError::internal("saved report definition is invalid"))?;
    Ok(CustomReportView {
        id: record.id,
        name: record.name,
        definition,
        schedule_frequency: record.schedule_frequency,
        schedule_day: record.schedule_day,
        schedule_time: record.schedule_time.format("%H:%M").to_string(),
        recipient_email: record.recipient_email,
        next_run_at: record.next_run_at,
        last_run_at: record.last_run_at,
        last_status: record.last_status,
        last_error: record.last_error,
        version: record.version,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

pub async fn revenue_forecast(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    history_days: i32,
    forecast_days: i32,
) -> Result<RevenueForecast, AppError> {
    if !(7..=90).contains(&history_days) || !(1..=14).contains(&forecast_days) {
        return Err(AppError::validation(
            "historyDays must be 7 to 90 and forecastDays must be 1 to 14",
        ));
    }

    let rows = analytics_repository::daily_revenue(db, tenant_id, branch_id, history_days)
        .await
        .map_err(|_| AppError::internal("failed to load revenue history"))?;
    let values = rows.iter().map(|row| row.value_paise).collect::<Vec<_>>();
    let forecast_values = moving_average_forecast(&values, forecast_days as usize);
    let latest_business_date = rows
        .last()
        .map(|row| row.business_date)
        .ok_or_else(|| AppError::internal("revenue history returned no business dates"))?;

    Ok(RevenueForecast {
        method: "three_day_moving_average",
        source: "pos_sales",
        history_days,
        forecast_days,
        historical_total_paise: values.iter().sum(),
        forecast_total_paise: forecast_values.iter().sum(),
        daily_average_paise: if values.is_empty() {
            0
        } else {
            values.iter().sum::<i64>() / values.len() as i64
        },
        history: rows
            .into_iter()
            .map(|row| RevenuePoint {
                date: row.business_date.to_string(),
                value_paise: row.value_paise,
            })
            .collect(),
        forecast: forecast_values
            .into_iter()
            .enumerate()
            .map(|(index, value_paise)| RevenuePoint {
                date: (latest_business_date + Duration::days(index as i64 + 1)).to_string(),
                value_paise,
            })
            .collect(),
    })
}

pub async fn profit_intelligence(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    branch_scope: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    group_by: &str,
) -> Result<ProfitIntelligence, AppError> {
    if from_date > to_date || (to_date - from_date).num_days() > 366 {
        return Err(AppError::validation(
            "profit report date range must be 367 days or less",
        ));
    }
    if !matches!(group_by, "sourceType" | "account" | "costCenter") {
        return Err(AppError::validation(
            "groupBy must be sourceType, account, or costCenter",
        ));
    }

    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    let rows = analytics_repository::profit_ledger(db, tenant_id, branch_ids, from_date, to_date)
        .await
        .map_err(|_| AppError::internal("failed to load profit ledger"))?;
    let (metrics, breakdown, unclassified_accounts) = summarize_profit(&rows, group_by);

    Ok(ProfitIntelligence {
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        source: "accounting_journal_lines",
        branch_scope: branch_scope.to_string(),
        branch_count: branch_ids.len(),
        group_by: group_by.to_string(),
        metrics,
        breakdown,
        unclassified_accounts,
    })
}

pub async fn advanced_profit_intelligence(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    branch_scope: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<AdvancedProfitIntelligence, AppError> {
    if from_date > to_date || (to_date - from_date).num_days() > 366 {
        return Err(AppError::validation(
            "profit report date range must be 367 days or less",
        ));
    }
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    let (dimension_rows, recipe_records, quality, booking_demand, liability_records, daily_records) =
        tokio::try_join!(
            micro_profit_dimension_rows(db, tenant_id, branch_ids, from_date, to_date),
            async {
                analytics_repository::recipe_variance(db, tenant_id, branch_ids, from_date, to_date)
                    .await
                    .map_err(|_| AppError::internal("failed to load recipe variance"))
            },
            micro_profit_reconciliation(
                db,
                tenant_id,
                branch_ids,
                branch_scope,
                from_date,
                to_date,
            ),
            async {
                analytics_repository::profit_booking_demand(
                    db, tenant_id, branch_ids, from_date, to_date,
                )
                .await
                .map_err(|_| AppError::internal("failed to load profit booking demand"))
            },
            async {
                analytics_repository::profit_liability_exposure(db, tenant_id, branch_ids, to_date)
                    .await
                    .map_err(|_| AppError::internal("failed to load profit liability exposure"))
            },
            async {
                analytics_repository::daily_micro_profit(
                    db, tenant_id, branch_ids, from_date, to_date,
                )
                .await
                .map_err(|_| AppError::internal("failed to load daily Micro P&L"))
            },
        )?;
    let mut report = build_advanced_insights(
        dimension_rows,
        recipe_records,
        booking_demand,
        liability_records,
        daily_records,
        from_date,
        to_date,
        branch_scope,
        branch_ids.len(),
    );
    apply_recommendation_quality_gate(&mut report, &quality);
    Ok(report)
}

#[allow(clippy::too_many_arguments)]
pub async fn micro_profit_lines(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    branch_scope: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    page: i64,
    page_size: i64,
    dimension: &str,
    entity_id: &str,
) -> Result<MicroProfitPage, AppError> {
    validate_micro_profit_request(branch_ids, from_date, to_date)?;
    if !dimension.is_empty()
        && !matches!(
            dimension,
            "service"
                | "category"
                | "staff"
                | "customer"
                | "product"
                | "appointment"
                | "branch"
                | "channel"
        )
    {
        return Err(AppError::validation("Micro P&L dimension is invalid"));
    }
    if (!dimension.is_empty() && entity_id.trim().is_empty()) || entity_id.len() > 200 {
        return Err(AppError::validation("Micro P&L entity is invalid"));
    }
    let page = page.max(1);
    let page_size = page_size.clamp(1, 200);
    let records = analytics_repository::micro_profit_lines(
        db,
        tenant_id,
        branch_ids,
        from_date,
        to_date,
        page_size,
        (page - 1).saturating_mul(page_size),
        dimension,
        entity_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load Micro P&L lines"))?;
    let total = records.first().map(|row| row.total_count).unwrap_or(0);
    let rows = records
        .into_iter()
        .map(|row| {
            let total_direct_cost_paise =
                row.product_cost_paise.saturating_add(row.staff_cost_paise);
            let contribution_profit_paise = row
                .recognized_revenue_paise
                .saturating_sub(total_direct_cost_paise);
            let contribution_margin_bps = if row.recognized_revenue_paise > 0 {
                contribution_profit_paise.saturating_mul(10_000) / row.recognized_revenue_paise
            } else {
                0
            };
            let controllable_cost_paise = total_direct_cost_paise
                .saturating_add(row.staff_time_cost_paise)
                .saturating_add(row.gateway_fee_paise)
                .saturating_add(row.refund_fee_paise);
            let controllable_profit_paise = row
                .recognized_revenue_paise
                .saturating_sub(controllable_cost_paise);
            let controllable_margin_bps = if row.recognized_revenue_paise > 0 {
                controllable_profit_paise.saturating_mul(10_000) / row.recognized_revenue_paise
            } else {
                0
            };
            let fully_loaded_cost_paise =
                controllable_cost_paise.saturating_add(row.overhead_cost_paise);
            let fully_loaded_profit_paise = row
                .recognized_revenue_paise
                .saturating_sub(fully_loaded_cost_paise);
            let fully_loaded_margin_bps = if row.recognized_revenue_paise > 0 {
                fully_loaded_profit_paise.saturating_mul(10_000) / row.recognized_revenue_paise
            } else {
                0
            };
            let completeness_status = if row.missing_invoice_journal
                || row.product_cost_status == "missing"
                || row.staff_cost_status == "missing"
                || row.staff_time_cost_status == "missing"
                || row.gateway_fee_status == "missing"
                || row.refund_fee_status == "missing"
                || row.overhead_status != "recorded"
            {
                "incomplete"
            } else {
                "complete"
            };
            let cost_completeness_bps = cost_completeness_bps([
                &row.product_cost_status,
                &row.staff_cost_status,
                &row.staff_time_cost_status,
                &row.gateway_fee_status,
                &row.refund_fee_status,
                &row.overhead_status,
            ]);
            MicroProfitLine {
                branch_id: row.branch_id,
                branch_name: row.branch_name,
                first_event_date: row.first_event_date,
                last_event_date: row.last_event_date,
                sale_id: row.sale_id,
                sale_line_id: row.sale_line_id,
                invoice_number: row.invoice_number,
                reference_id: row.reference_id,
                appointment_id: row.appointment_id,
                appointment_name: row.appointment_name,
                channel: row.channel,
                journal_entry_id: row.journal_entry_id,
                inventory_movement_ids: row.inventory_movement_ids,
                line_type: row.line_type,
                item_id: row.item_id,
                item_name: row.item_name,
                item_category: row.item_category,
                unit_count: row.unit_count,
                discount_paise: row.discount_paise,
                staff_id: row.staff_id,
                staff_name: row.staff_name,
                client_id: row.client_id,
                client_name: row.client_name,
                recognized_revenue_paise: row.recognized_revenue_paise,
                product_cost_paise: row.product_cost_paise,
                staff_cost_paise: row.staff_cost_paise,
                staff_time_cost_paise: row.staff_time_cost_paise,
                gateway_fee_paise: row.gateway_fee_paise,
                refund_fee_paise: row.refund_fee_paise,
                overhead_cost_paise: row.overhead_cost_paise,
                total_direct_cost_paise,
                contribution_profit_paise,
                contribution_margin_bps,
                controllable_cost_paise,
                controllable_profit_paise,
                controllable_margin_bps,
                fully_loaded_cost_paise,
                fully_loaded_profit_paise,
                fully_loaded_margin_bps,
                product_cost_status: row.product_cost_status,
                staff_cost_status: row.staff_cost_status,
                staff_time_cost_status: row.staff_time_cost_status,
                gateway_fee_status: row.gateway_fee_status,
                refund_fee_status: row.refund_fee_status,
                overhead_status: row.overhead_status,
                missing_invoice_journal: row.missing_invoice_journal,
                cost_completeness_bps,
                completeness_status,
                event_count: row.event_count,
            }
        })
        .collect();
    Ok(MicroProfitPage {
        from_date,
        to_date,
        branch_scope: branch_scope.to_string(),
        branch_count: branch_ids.len(),
        source: "micro_profit_events+micro_profit_cost_events",
        profit_levels: ["contribution", "controllable", "fully_loaded"],
        commission_double_count_protected: true,
        page,
        page_size,
        total,
        rows,
    })
}

pub async fn list_micro_profit_allocation_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
) -> Result<Vec<MicroProfitAllocationRule>, AppError> {
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    analytics_repository::list_micro_profit_allocation_rules(db, tenant_id, branch_ids)
        .await
        .map(|rows| rows.into_iter().map(micro_profit_allocation_rule).collect())
        .map_err(|_| AppError::internal("failed to load Micro P&L allocation rules"))
}

pub async fn create_micro_profit_allocation_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: MicroProfitAllocationRuleCreateRequest,
) -> Result<MicroProfitAllocationRule, AppError> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err(AppError::validation("allocation rule name is invalid"));
    }
    if !matches!(
        input.driver.as_str(),
        "service_minutes"
            | "chair_resource_minutes"
            | "revenue_share"
            | "headcount"
            | "transaction_count"
    ) {
        return Err(AppError::validation("allocation rule driver is invalid"));
    }
    if input
        .effective_to
        .is_some_and(|date| date < input.effective_from)
    {
        return Err(AppError::validation(
            "allocation rule date range is invalid",
        ));
    }
    let account_codes = input
        .account_codes
        .into_iter()
        .map(|code| code.trim().to_ascii_uppercase())
        .filter(|code| !code.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if account_codes.is_empty()
        || account_codes.len() > 50
        || account_codes.iter().any(|code| {
            code.len() > 64
                || !code.chars().all(|character| {
                    character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
                })
        })
    {
        return Err(AppError::validation(
            "allocation rule account codes are invalid",
        ));
    }
    let allowed_accounts = balance_sheet_service::accounts()
        .into_iter()
        .filter(|account| {
            account.group == AccountGroup::Expense
                && !matches!(
                    account.code.as_str(),
                    "SALES_RETURNS" | "COST_OF_GOODS_SOLD" | "PAYROLL_EXPENSE" | "ROUNDING_EXPENSE"
                )
        })
        .map(|account| account.code)
        .collect::<BTreeSet<_>>();
    if account_codes
        .iter()
        .any(|code| !allowed_accounts.contains(code))
    {
        return Err(AppError::validation(
            "allocation rules accept overhead expense accounts only",
        ));
    }
    analytics_repository::create_micro_profit_allocation_rule(
        db,
        tenant_id,
        branch_id,
        actor_user_id,
        name,
        &input.driver,
        &account_codes,
        input.effective_from,
        input.effective_to,
    )
    .await
    .map_err(|_| AppError::internal("failed to create Micro P&L allocation rule"))?
    .map(micro_profit_allocation_rule)
    .ok_or_else(|| {
        AppError::conflict(
            "allocation rule overlaps another account pool or is not a later version",
        )
    })
}

fn micro_profit_allocation_rule(
    row: analytics_repository::MicroProfitAllocationRuleRecord,
) -> MicroProfitAllocationRule {
    MicroProfitAllocationRule {
        id: row.id,
        name: row.name,
        version: row.version,
        driver: row.driver,
        account_codes: row.account_codes,
        effective_from: row.effective_from,
        effective_to: row.effective_to,
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
    }
}

pub async fn micro_profit_reconciliation(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    branch_scope: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<MicroProfitReconciliation, AppError> {
    validate_micro_profit_request(branch_ids, from_date, to_date)?;
    let row = analytics_repository::micro_profit_reconciliation(
        db, tenant_id, branch_ids, from_date, to_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to reconcile Micro P&L"))?;
    let revenue_variance_paise = row
        .ledger_revenue_paise
        .saturating_sub(row.micro_revenue_paise);
    let cogs_variance_paise = row
        .ledger_cogs_paise
        .saturating_sub(row.micro_product_cost_paise);
    let payroll_variance_paise = row
        .ledger_payroll_paise
        .saturating_sub(row.payroll_source_paise);
    let allocation_ready = row.reportable_line_count == 0
        || (row.allocation_rule_count > 0 && row.unallocated_overhead_paise == 0);
    let complete_line_count = if allocation_ready {
        row.complete_line_count
    } else {
        0
    };
    let cost_complete_line_count = if allocation_ready {
        row.cost_complete_line_count
    } else {
        0
    };
    let completeness_bps = if row.reportable_line_count > 0 {
        complete_line_count.saturating_mul(10_000) / row.reportable_line_count
    } else {
        10_000
    };
    let cost_completeness_bps = if row.reportable_line_count > 0 {
        cost_complete_line_count.saturating_mul(10_000) / row.reportable_line_count
    } else {
        10_000
    };
    let unexplained_variance_paise = row
        .ledger_revenue_paise
        .saturating_add(row.missing_invoice_journal_paise)
        .saturating_sub(row.micro_revenue_paise);
    let reconciled = revenue_variance_paise == 0
        && cogs_variance_paise == 0
        && payroll_variance_paise == 0
        && row.missing_invoice_journal_count == 0
        && row.missing_product_cost_line_count == 0
        && row.missing_staff_cost_line_count == 0
        && row.missing_staff_time_cost_line_count == 0
        && row.missing_gateway_fee_line_count == 0
        && row.missing_refund_fee_line_count == 0
        && allocation_ready;
    Ok(MicroProfitReconciliation {
        from_date,
        to_date,
        branch_scope: branch_scope.to_string(),
        branch_count: branch_ids.len(),
        ledger_revenue_paise: row.ledger_revenue_paise,
        micro_revenue_paise: row.micro_revenue_paise,
        revenue_variance_paise,
        revenue_bridge: RevenueBridge {
            ledger_revenue_paise: row.ledger_revenue_paise,
            missing_invoice_journal_paise: row.missing_invoice_journal_paise,
            micro_revenue_paise: row.micro_revenue_paise,
            unexplained_variance_paise,
        },
        ledger_cogs_paise: row.ledger_cogs_paise,
        micro_product_cost_paise: row.micro_product_cost_paise,
        cogs_variance_paise,
        ledger_payroll_paise: row.ledger_payroll_paise,
        payroll_source_paise: row.payroll_source_paise,
        payroll_variance_paise,
        rounding_bridge_paise: row.rounding_bridge_paise,
        reportable_line_count: row.reportable_line_count,
        complete_line_count,
        completeness_bps,
        cost_complete_line_count,
        cost_completeness_bps,
        missing_invoice_journal_count: row.missing_invoice_journal_count,
        missing_product_cost_line_count: row.missing_product_cost_line_count,
        missing_staff_cost_line_count: row.missing_staff_cost_line_count,
        missing_staff_time_cost_line_count: row.missing_staff_time_cost_line_count,
        missing_gateway_fee_line_count: row.missing_gateway_fee_line_count,
        missing_refund_fee_line_count: row.missing_refund_fee_line_count,
        allocation_rule_count: row.allocation_rule_count,
        unallocated_overhead_paise: row.unallocated_overhead_paise,
        reconciled,
        branch_period_close_ready: reconciled,
    })
}

pub async fn invoice_journal_repair_queue(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
    limit: i64,
) -> Result<Vec<InvoiceJournalRepairItem>, AppError> {
    validate_micro_profit_request(branch_ids, from_date, to_date)?;
    analytics_repository::invoice_journal_repair_queue(
        db,
        tenant_id,
        branch_ids,
        from_date,
        to_date,
        limit.clamp(1, 200),
    )
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| InvoiceJournalRepairItem {
                branch_id: row.branch_id,
                sale_id: row.sale_id,
                invoice_number: row.invoice_number,
                business_date: row.business_date,
                total_paise: row.total_paise,
                period_status: row.period_status,
            })
            .collect()
    })
    .map_err(|_| AppError::internal("failed to load invoice journal repair queue"))
}

pub async fn repair_missing_invoice_journals(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    actor_user_id: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    limit: i64,
) -> Result<InvoiceJournalRepairRun, AppError> {
    validate_micro_profit_request(branch_ids, from_date, to_date)?;
    let rows = analytics_repository::invoice_journal_repair_queue(
        db,
        tenant_id,
        branch_ids,
        from_date,
        to_date,
        limit.clamp(1, 200),
    )
    .await
    .map_err(|_| AppError::internal("failed to load invoice journal repair queue"))?;
    let mut result = InvoiceJournalRepairRun {
        attempted: rows.len() as i64,
        repaired: 0,
        blocked_closed_period: 0,
        failed: 0,
    };
    for row in rows {
        if row.period_status == "closed" {
            result.blocked_closed_period += 1;
            continue;
        }
        let mut tx = db
            .begin()
            .await
            .map_err(|_| AppError::internal("failed to start invoice journal repair"))?;
        let posted = accounting_service::post_invoice_backfill(
            &mut tx,
            tenant_id,
            &row.branch_id,
            &row.sale_id,
            row.total_paise,
            row.tax_paise,
            row.cgst_paise,
            row.sgst_paise,
            row.igst_paise,
            row.tip_paise,
            row.round_off_paise,
            row.business_date,
            actor_user_id,
        )
        .await;
        if posted.is_ok() {
            let risk_closed = sqlx::query(
                "UPDATE pos_financial_risk_cases SET status='resolved',resolved_by_user_id=$4,resolution_note='Invoice journal backfilled',resolved_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND risk_code='MISSING_INVOICE_JOURNAL' AND entity_id=$3 AND status='open'",
            )
            .bind(tenant_id)
            .bind(&row.branch_id)
            .bind(&row.sale_id)
            .bind(actor_user_id)
            .execute(&mut *tx)
            .await;
            if risk_closed.is_ok() && tx.commit().await.is_ok() {
                result.repaired += 1;
                continue;
            }
        }
        result.failed += 1;
    }
    Ok(result)
}

fn validate_micro_profit_request(
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<(), AppError> {
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    if from_date > to_date || (to_date - from_date).num_days() > 366 {
        return Err(AppError::validation(
            "Micro P&L date range must be 367 days or less",
        ));
    }
    Ok(())
}

#[derive(Default)]
struct DimensionAccumulator {
    entity_name: String,
    unit_count: i64,
    revenue_paise: i64,
    discount_paise: i64,
    product_cost_paise: i64,
    staff_cost_paise: i64,
    staff_time_cost_paise: i64,
    gateway_fee_paise: i64,
    refund_fee_paise: i64,
    overhead_cost_paise: i64,
    line_count: i64,
    incomplete_cost_line_count: i64,
    completeness_bps_total: i64,
}

fn add_dimension(
    dimensions: &mut BTreeMap<(String, String), DimensionAccumulator>,
    dimension: &str,
    entity_id: &str,
    entity_name: &str,
    row: &analytics_repository::MicroProfitLineRecord,
) {
    let entry = dimensions
        .entry((dimension.to_string(), entity_id.to_string()))
        .or_default();
    entry.entity_name = entity_name.to_string();
    entry.unit_count = entry.unit_count.saturating_add(row.unit_count);
    entry.revenue_paise = entry
        .revenue_paise
        .saturating_add(row.recognized_revenue_paise);
    entry.discount_paise = entry.discount_paise.saturating_add(row.discount_paise);
    entry.product_cost_paise = entry
        .product_cost_paise
        .saturating_add(row.product_cost_paise);
    entry.staff_cost_paise = entry.staff_cost_paise.saturating_add(row.staff_cost_paise);
    entry.staff_time_cost_paise = entry
        .staff_time_cost_paise
        .saturating_add(row.staff_time_cost_paise);
    entry.gateway_fee_paise = entry
        .gateway_fee_paise
        .saturating_add(row.gateway_fee_paise);
    entry.refund_fee_paise = entry.refund_fee_paise.saturating_add(row.refund_fee_paise);
    entry.overhead_cost_paise = entry
        .overhead_cost_paise
        .saturating_add(row.overhead_cost_paise);
    entry.line_count += 1;
    let completeness = cost_completeness_bps([
        &row.product_cost_status,
        &row.staff_cost_status,
        &row.staff_time_cost_status,
        &row.gateway_fee_status,
        &row.refund_fee_status,
        &row.overhead_status,
    ]);
    entry.completeness_bps_total = entry.completeness_bps_total.saturating_add(completeness);
    if completeness < 10_000 || row.missing_invoice_journal {
        entry.incomplete_cost_line_count += 1;
    }
}

async fn micro_profit_dimension_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<ProfitDimensionRow>, AppError> {
    // ponytail: reuse the canonical line engine; add a DB rollup only if 367-day reports miss the latency SLO.
    let mut dimensions = BTreeMap::new();
    let mut offset = 0_i64;
    loop {
        let records = analytics_repository::micro_profit_lines(
            db, tenant_id, branch_ids, from_date, to_date, 2_000, offset, "", "",
        )
        .await
        .map_err(|_| AppError::internal("failed to load Micro P&L dimensions"))?;
        let loaded = records.len() as i64;
        for row in &records {
            if matches!(
                row.line_type.as_str(),
                "service" | "package_redeem" | "membership_redeem"
            ) {
                add_dimension(
                    &mut dimensions,
                    "service",
                    &row.item_id,
                    &row.item_name,
                    row,
                );
                add_dimension(
                    &mut dimensions,
                    "category",
                    &row.item_category,
                    &row.item_category,
                    row,
                );
            }
            if row.line_type == "product" {
                add_dimension(
                    &mut dimensions,
                    "product",
                    &row.item_id,
                    &row.item_name,
                    row,
                );
            }
            add_dimension(
                &mut dimensions,
                "staff",
                if row.staff_id.is_empty() {
                    "unassigned"
                } else {
                    &row.staff_id
                },
                &row.staff_name,
                row,
            );
            add_dimension(
                &mut dimensions,
                "customer",
                if row.client_id.is_empty() {
                    "walk_in"
                } else {
                    &row.client_id
                },
                &row.client_name,
                row,
            );
            add_dimension(
                &mut dimensions,
                "appointment",
                if row.appointment_id.is_empty() {
                    "direct"
                } else {
                    &row.appointment_id
                },
                &row.appointment_name,
                row,
            );
            add_dimension(
                &mut dimensions,
                "branch",
                &row.branch_id,
                &row.branch_name,
                row,
            );
            add_dimension(&mut dimensions, "channel", &row.channel, &row.channel, row);
        }
        if loaded < 2_000 {
            break;
        }
        offset = offset.saturating_add(loaded);
    }
    let mut rows = dimensions
        .into_iter()
        .map(|((dimension, entity_id), row)| {
            let total_cost_paise = row.product_cost_paise.saturating_add(row.staff_cost_paise);
            let net_profit_paise = row.revenue_paise.saturating_sub(total_cost_paise);
            let fully_loaded_cost_paise = total_cost_paise
                .saturating_add(row.staff_time_cost_paise)
                .saturating_add(row.gateway_fee_paise)
                .saturating_add(row.refund_fee_paise)
                .saturating_add(row.overhead_cost_paise);
            let fully_loaded_profit_paise =
                row.revenue_paise.saturating_sub(fully_loaded_cost_paise);
            ProfitDimensionRow {
                dimension,
                entity_id,
                entity_name: row.entity_name,
                unit_count: row.unit_count,
                revenue_paise: row.revenue_paise,
                discount_paise: row.discount_paise,
                product_cost_paise: row.product_cost_paise,
                staff_cost_paise: row.staff_cost_paise,
                staff_time_cost_paise: row.staff_time_cost_paise,
                gateway_fee_paise: row.gateway_fee_paise,
                refund_fee_paise: row.refund_fee_paise,
                overhead_cost_paise: row.overhead_cost_paise,
                total_cost_paise,
                net_profit_paise,
                margin_bps: margin_bps(net_profit_paise, row.revenue_paise),
                fully_loaded_cost_paise,
                fully_loaded_profit_paise,
                fully_loaded_margin_bps: margin_bps(fully_loaded_profit_paise, row.revenue_paise),
                line_count: row.line_count,
                incomplete_cost_line_count: row.incomplete_cost_line_count,
                cost_completeness_bps: if row.line_count > 0 {
                    row.completeness_bps_total / row.line_count
                } else {
                    10_000
                },
            }
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        left.dimension
            .cmp(&right.dimension)
            .then_with(|| right.net_profit_paise.cmp(&left.net_profit_paise))
            .then_with(|| left.entity_name.cmp(&right.entity_name))
    });
    Ok(rows)
}

fn margin_bps(profit_paise: i64, revenue_paise: i64) -> i64 {
    if revenue_paise > 0 {
        profit_paise.saturating_mul(10_000) / revenue_paise
    } else {
        0
    }
}

fn build_advanced_insights(
    rows: Vec<ProfitDimensionRow>,
    recipe_records: Vec<analytics_repository::RecipeVarianceRecord>,
    booking_demand: Vec<analytics_repository::ProfitBookingDemandRecord>,
    liability_records: Vec<analytics_repository::ProfitLiabilityRecord>,
    daily_records: Vec<analytics_repository::DailyProfitRecord>,
    from_date: NaiveDate,
    to_date: NaiveDate,
    branch_scope: &str,
    branch_count: usize,
) -> AdvancedProfitIntelligence {
    let service_profit = dimension(&rows, "service");
    let category_profit = dimension(&rows, "category");
    let staff_profit = dimension(&rows, "staff");
    let customer_profit = dimension(&rows, "customer");
    let product_profit = dimension(&rows, "product");
    let appointment_profit = dimension(&rows, "appointment");
    let branch_profit = dimension(&rows, "branch");
    let channel_profit = dimension(&rows, "channel");
    let recipe_variance = recipe_records
        .into_iter()
        .map(|row| {
            let variance_paise = row
                .actual_cost_paise
                .saturating_sub(row.expected_cost_paise);
            let variance_bps = if row.expected_cost_paise > 0 {
                variance_paise.saturating_mul(10_000) / row.expected_cost_paise
            } else {
                0
            };
            RecipeVarianceRow {
                service_id: row.service_id,
                service_name: row.service_name,
                sold_quantity: row.sold_quantity,
                recipe_item_count: row.recipe_item_count,
                expected_cost_paise: row.expected_cost_paise,
                actual_cost_paise: row.actual_cost_paise,
                variance_paise,
                variance_bps,
            }
        })
        .collect::<Vec<_>>();
    let mut leaks = profit_leaks(&service_profit, &recipe_variance);
    leaks.sort_by_key(|row| std::cmp::Reverse(row.impact_paise));
    leaks.truncate(50);
    let pricing = pricing_recommendations(&service_profit);
    let executive_kpis = executive_profit_kpis(
        &service_profit,
        &staff_profit,
        &customer_profit,
        &branch_profit,
    );
    let customer_profit_scores = customer_profit_scores(&customer_profit);
    let booking_recommendations = booking_profit_recommendations(&service_profit, booking_demand);
    let liability_risks = liability_risks(liability_records);
    let enterprise_analytics =
        enterprise_profit_analytics(daily_records, to_date, &leaks, &liability_risks);
    let profit_digital_twin = profit_digital_twin(&branch_profit);
    let board_report = profit_board_report(
        &executive_kpis,
        &leaks,
        &pricing,
        &liability_risks,
        &enterprise_analytics,
    );
    let copilot = copilot_insights(&leaks, &pricing);

    AdvancedProfitIntelligence {
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        source: "micro_profit_events+micro_profit_cost_events",
        branch_scope: branch_scope.to_string(),
        branch_count,
        copilot_source: "rust_deterministic".to_string(),
        copilot_model: "local-profit-policy-v1".to_string(),
        copilot_fact_schema_version: COPILOT_FACT_SCHEMA_VERSION.to_string(),
        copilot_fact_hash: String::new(),
        copilot_evaluation_status: "pending".to_string(),
        reconciliation_ready: false,
        recommendations_blocked: false,
        incomplete_cost_line_count: 0,
        executive_kpis,
        customer_profit_scores,
        service_profit,
        category_profit,
        staff_profit,
        customer_profit,
        product_profit,
        appointment_profit,
        branch_profit,
        channel_profit,
        leaks,
        pricing,
        recipe_variance,
        booking_recommendations,
        liability_risks,
        enterprise_analytics,
        profit_digital_twin,
        board_report,
        copilot,
        copilot_facts: None,
    }
}

fn profit_highlight(rows: &[ProfitDimensionRow]) -> Option<ProfitHighlight> {
    rows.iter()
        .max_by_key(|row| row.fully_loaded_profit_paise)
        .map(|row| ProfitHighlight {
            entity_id: row.entity_id.clone(),
            label: row.entity_name.clone(),
            profit_paise: row.fully_loaded_profit_paise,
            revenue_paise: row.revenue_paise,
        })
}

fn executive_profit_kpis(
    services: &[ProfitDimensionRow],
    staff: &[ProfitDimensionRow],
    customers: &[ProfitDimensionRow],
    branches: &[ProfitDimensionRow],
) -> ExecutiveProfitKpis {
    let revenue_paise = branches.iter().map(|row| row.revenue_paise).sum::<i64>();
    let staff_count = staff
        .iter()
        .filter(|row| row.entity_id != "unassigned")
        .count()
        .max(1) as i64;
    let customer_count = customers
        .iter()
        .filter(|row| row.entity_id != "walk_in")
        .count()
        .max(1) as i64;
    let branch_count = branches.len().max(1) as i64;
    ExecutiveProfitKpis {
        top_service: profit_highlight(services),
        top_staff: profit_highlight(staff),
        top_customer: profit_highlight(customers),
        top_branch: profit_highlight(branches),
        revenue_per_staff_paise: revenue_paise / staff_count,
        revenue_per_customer_paise: revenue_paise / customer_count,
        revenue_per_branch_paise: revenue_paise / branch_count,
    }
}

fn customer_profit_scores(rows: &[ProfitDimensionRow]) -> Vec<CustomerProfitScore> {
    let mut scores = rows
        .iter()
        .map(|row| {
            let gross_paise = row.revenue_paise.saturating_add(row.discount_paise);
            let discount_bps = margin_bps(row.discount_paise, gross_paise);
            let score =
                (50 + row.fully_loaded_margin_bps / 200 + row.unit_count.min(10).saturating_mul(2)
                    - discount_bps / 300)
                    .clamp(0, 100);
            let tier = if discount_bps >= 1_500 {
                "Discount Dependent"
            } else if row.revenue_paise >= 100_000 && row.fully_loaded_margin_bps < 2_500 {
                "High Revenue Low Margin"
            } else if row.fully_loaded_profit_paise > 0
                && (score >= 65 || row.fully_loaded_margin_bps >= 3_500)
            {
                "VIP Profitable"
            } else {
                "Low Value"
            };
            CustomerProfitScore {
                customer_id: row.entity_id.clone(),
                customer_name: row.entity_name.clone(),
                revenue_paise: row.revenue_paise,
                profit_paise: row.fully_loaded_profit_paise,
                discount_paise: row.discount_paise,
                unit_count: row.unit_count,
                margin_bps: row.fully_loaded_margin_bps,
                profit_score: score,
                tier: tier.to_string(),
            }
        })
        .collect::<Vec<_>>();
    scores.sort_by_key(|row| {
        (
            std::cmp::Reverse(row.profit_score),
            std::cmp::Reverse(row.profit_paise),
        )
    });
    scores.truncate(50);
    scores
}

fn booking_profit_recommendations(
    services: &[ProfitDimensionRow],
    demand: Vec<analytics_repository::ProfitBookingDemandRecord>,
) -> Vec<BookingProfitRecommendation> {
    let peak = demand
        .iter()
        .map(|row| row.appointment_count)
        .max()
        .unwrap_or(1)
        .max(1);
    let mut best = BTreeMap::<String, analytics_repository::ProfitBookingDemandRecord>::new();
    for row in demand {
        best.entry(row.service_id.clone())
            .and_modify(|current| {
                if row.appointment_count > current.appointment_count
                    || (row.appointment_count == current.appointment_count
                        && row.local_hour < current.local_hour)
                {
                    *current = row.clone();
                }
            })
            .or_insert(row);
    }
    let mut recommendations = services
        .iter()
        .filter_map(|service| {
            let demand = best.remove(&service.entity_id)?;
            let units = service.unit_count.max(1);
            let expected_revenue_paise = service.revenue_paise / units;
            let expected_cost_paise = service.fully_loaded_cost_paise / units;
            let expected_profit_paise = expected_revenue_paise.saturating_sub(expected_cost_paise);
            let peak_score = demand.appointment_count.saturating_mul(100) / peak;
            let suggested_price_uplift_bps =
                if peak_score >= 70 && service.fully_loaded_margin_bps >= 4_500 {
                    500
                } else if peak_score >= 70 {
                    250
                } else {
                    0
                };
            let restriction_reason = if service.incomplete_cost_line_count > 0 {
                "Cost data is incomplete"
            } else if service.fully_loaded_margin_bps < 2_000 {
                "Low-margin service should not consume peak capacity without approval"
            } else {
                ""
            };
            let recommendation = if !restriction_reason.is_empty() {
                restriction_reason
            } else if suggested_price_uplift_bps > 0 {
                "Prioritize this demand window with a governed peak-price review"
            } else {
                "Prioritize this service in its strongest recorded demand window"
            };
            Some(BookingProfitRecommendation {
                service_id: service.entity_id.clone(),
                service_name: demand.service_name,
                recommended_hour: demand.local_hour,
                appointment_count: demand.appointment_count,
                peak_score,
                expected_revenue_paise,
                expected_cost_paise,
                expected_profit_paise,
                margin_bps: service.fully_loaded_margin_bps,
                suggested_price_uplift_bps,
                restriction_reason: restriction_reason.to_string(),
                recommendation: recommendation.to_string(),
            })
        })
        .collect::<Vec<_>>();
    recommendations.sort_by_key(|row| {
        (
            std::cmp::Reverse(row.peak_score),
            std::cmp::Reverse(row.expected_profit_paise),
        )
    });
    recommendations.truncate(50);
    recommendations
}

fn liability_risks(
    rows: Vec<analytics_repository::ProfitLiabilityRecord>,
) -> Vec<ProfitLiabilityRisk> {
    rows.into_iter()
        .map(|row| {
            let projected_cost_paise = if row.redeemed_value_paise > 0 {
                row.remaining_liability_paise
                    .saturating_mul(row.redeemed_cost_paise)
                    / row.redeemed_value_paise
            } else {
                0
            };
            let expected_future_profit_paise = row
                .remaining_liability_paise
                .saturating_sub(projected_cost_paise);
            let liability_bps = margin_bps(row.remaining_liability_paise, row.sold_value_paise);
            let severity = if expected_future_profit_paise < 0 {
                "high"
            } else if liability_bps >= 3_500 {
                "medium"
            } else {
                "low"
            };
            let recommendation = match severity {
                "high" => {
                    "Review plan price, redemption controls and service cost before new sales"
                }
                "medium" => "Monitor redemption pacing and remaining liability",
                _ => "Liability is within the recorded cost profile",
            };
            ProfitLiabilityRisk {
                kind: row.source_type,
                plan_id: row.source_item_id,
                plan_name: row.plan_name,
                sold_value_paise: row.sold_value_paise,
                recognized_value_paise: row.recognized_value_paise,
                remaining_liability_paise: row.remaining_liability_paise,
                projected_cost_paise,
                expected_future_profit_paise,
                severity: severity.to_string(),
                recommendation: recommendation.to_string(),
            }
        })
        .collect()
}

fn enterprise_profit_analytics(
    daily: Vec<analytics_repository::DailyProfitRecord>,
    to_date: NaiveDate,
    leaks: &[ProfitLeak],
    liabilities: &[ProfitLiabilityRisk],
) -> EnterpriseProfitAnalytics {
    let trend = daily
        .into_iter()
        .map(|row| ProfitTrendPoint {
            date: row.business_date,
            revenue_paise: row.revenue_paise,
            direct_cost_paise: row.direct_cost_paise,
            contribution_profit_paise: row.revenue_paise.saturating_sub(row.direct_cost_paise),
        })
        .collect::<Vec<_>>();
    let daily_average = if trend.is_empty() {
        0
    } else {
        trend
            .iter()
            .map(|row| row.contribution_profit_paise)
            .sum::<i64>()
            / trend.len() as i64
    };
    let (next_year, next_month) = if to_date.month() == 12 {
        (to_date.year() + 1, 1)
    } else {
        (to_date.year(), to_date.month() + 1)
    };
    let after_month = if next_month == 12 {
        NaiveDate::from_ymd_opt(next_year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(next_year, next_month + 1, 1)
    };
    let first_month = NaiveDate::from_ymd_opt(next_year, next_month, 1);
    let forecast_days = first_month
        .zip(after_month)
        .map(|(from, to)| (to - from).num_days())
        .unwrap_or(30);
    let mut alerts = leaks
        .iter()
        .take(3)
        .map(|row| row.title.clone())
        .collect::<Vec<_>>();
    alerts.extend(
        liabilities
            .iter()
            .filter(|row| row.severity != "low")
            .take(2)
            .map(|row| format!("Review {} liability", row.plan_name)),
    );
    EnterpriseProfitAnalytics {
        trend,
        next_month_forecast_profit_paise: daily_average.saturating_mul(forecast_days),
        forecast_basis: "recorded daily Micro P&L contribution run-rate",
        alerts,
    }
}

fn profit_digital_twin(branches: &[ProfitDimensionRow]) -> ProfitDigitalTwin {
    let revenue = branches.iter().map(|row| row.revenue_paise).sum::<i64>();
    let profit = branches
        .iter()
        .map(|row| row.fully_loaded_profit_paise)
        .sum::<i64>();
    let product_cost = branches
        .iter()
        .map(|row| row.product_cost_paise)
        .sum::<i64>();
    let discount = branches.iter().map(|row| row.discount_paise).sum::<i64>();
    let scenarios = [
        ("Price +5%", revenue / 20),
        ("Wastage -10%", product_cost / 10),
        ("Discount leakage -10%", discount / 10),
    ]
    .into_iter()
    .map(|(name, delta)| {
        let projected_revenue_paise = if name == "Price +5%" {
            revenue.saturating_add(delta)
        } else {
            revenue
        };
        let projected_profit_paise = profit.saturating_add(delta);
        ProfitScenario {
            name,
            projected_revenue_paise,
            projected_profit_paise,
            profit_delta_paise: delta,
            projected_margin_bps: margin_bps(projected_profit_paise, projected_revenue_paise),
        }
    })
    .collect();
    ProfitDigitalTwin {
        baseline_revenue_paise: revenue,
        baseline_profit_paise: profit,
        scenarios,
    }
}

fn profit_board_report(
    executive: &ExecutiveProfitKpis,
    leaks: &[ProfitLeak],
    pricing: &[PricingRecommendation],
    liabilities: &[ProfitLiabilityRisk],
    analytics: &EnterpriseProfitAnalytics,
) -> ProfitBoardReport {
    let mut top_wins = Vec::new();
    if let Some(row) = &executive.top_service {
        top_wins.push(format!(
            "{} is the top fully-loaded service contributor",
            row.label
        ));
    }
    if let Some(row) = &executive.top_staff {
        top_wins.push(format!(
            "{} is the top fully-loaded staff contributor",
            row.label
        ));
    }
    if analytics.next_month_forecast_profit_paise > 0 {
        top_wins.push("Next-month contribution forecast is positive".to_string());
    }
    let mut top_risks = leaks
        .iter()
        .take(5)
        .map(|row| row.title.clone())
        .collect::<Vec<_>>();
    let remaining_risks = 5_usize.saturating_sub(top_risks.len());
    top_risks.extend(
        liabilities
            .iter()
            .filter(|row| row.severity != "low")
            .take(remaining_risks)
            .map(|row| format!("{} has {} liability risk", row.plan_name, row.severity)),
    );
    let mut next_actions = pricing
        .iter()
        .take(3)
        .map(|row| format!("Review {} price", row.service_name))
        .collect::<Vec<_>>();
    let remaining_actions = 5_usize.saturating_sub(next_actions.len());
    next_actions.extend(
        leaks
            .iter()
            .take(remaining_actions)
            .map(|row| row.title.clone()),
    );
    let expected_recovery_paise = pricing
        .iter()
        .map(|row| row.expected_profit_lift_paise.max(0))
        .chain(leaks.iter().map(|row| row.impact_paise.max(0)))
        .sum();
    ProfitBoardReport {
        top_wins,
        top_risks,
        next_actions,
        expected_recovery_paise,
    }
}

fn apply_recommendation_quality_gate(
    report: &mut AdvancedProfitIntelligence,
    quality: &MicroProfitReconciliation,
) {
    report.incomplete_cost_line_count = quality
        .reportable_line_count
        .saturating_sub(quality.cost_complete_line_count);
    report.reconciliation_ready = quality.branch_period_close_ready;
    let facts = CopilotFactSet {
        fact_schema_version: COPILOT_FACT_SCHEMA_VERSION,
        period_start: quality.from_date,
        period_end: quality.to_date,
        branch_count: quality.branch_count,
        ledger_revenue_paise: quality.ledger_revenue_paise,
        micro_revenue_paise: quality.micro_revenue_paise,
        revenue_variance_paise: quality.revenue_variance_paise,
        ledger_cogs_paise: quality.ledger_cogs_paise,
        micro_product_cost_paise: quality.micro_product_cost_paise,
        cogs_variance_paise: quality.cogs_variance_paise,
        ledger_payroll_paise: quality.ledger_payroll_paise,
        payroll_source_paise: quality.payroll_source_paise,
        payroll_variance_paise: quality.payroll_variance_paise,
        cost_completeness_bps: quality.cost_completeness_bps,
        reportable_line_count: quality.reportable_line_count,
        reconciled: quality.reconciled,
        branch_period_close_ready: quality.branch_period_close_ready,
    };
    report.copilot_fact_hash = fact_hash(&facts);
    report.copilot_facts = Some(facts);
    report.recommendations_blocked = !quality.branch_period_close_ready;
    if report.recommendations_blocked {
        block_unreconciled_recommendations(report);
    }
}

fn block_unreconciled_recommendations(report: &mut AdvancedProfitIntelligence) {
    report.recommendations_blocked = true;
    report.leaks.clear();
    report.pricing.clear();
    report.booking_recommendations.clear();
    report.profit_digital_twin.scenarios.clear();
    report.board_report.next_actions.clear();
    report.board_report.expected_recovery_paise = 0;
    report.copilot.clear();
    report.copilot_source = "blocked_unreconciled_micro_pnl".to_string();
    report.copilot_model = "none".to_string();
    report.copilot_evaluation_status = "blocked".to_string();
}

fn fact_hash(facts: &CopilotFactSet) -> String {
    let encoded = serde_json::to_vec(facts).unwrap_or_default();
    format!("{:x}", Sha256::digest(encoded))
}

fn cost_completeness_bps(statuses: [&str; 6]) -> i64 {
    statuses
        .into_iter()
        .filter(|status| matches!(*status, "recorded" | "not_required"))
        .count() as i64
        * 10_000
        / statuses.len() as i64
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiCopilotEnvelope {
    data: Option<AiCopilotData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiCopilotData {
    source: String,
    model: String,
    recommendations: Vec<AiCopilotRecommendation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiCopilotRecommendation {
    kind: String,
    title: String,
    message: String,
    source_type: String,
    source_id: String,
}

pub async fn enhance_profit_copilot(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    branch_ids: &[String],
    mut report: AdvancedProfitIntelligence,
) -> AdvancedProfitIntelligence {
    let started = Instant::now();
    if let (Some(url), Some(token)) = (
        settings.ai_service_url.as_deref(),
        settings.ai_service_token.as_deref(),
    ) {
        if let Some(data) = request_profit_copilot(url, token, tenant_id, branch_ids, &report).await
        {
            let valid = report
                .copilot
                .iter()
                .map(|row| {
                    (
                        (
                            row.kind.as_str(),
                            row.source_type.as_str(),
                            row.source_id.as_str(),
                        ),
                        row.impact_paise,
                    )
                })
                .collect::<BTreeMap<_, _>>();
            let recommendations = data
                .recommendations
                .into_iter()
                .filter_map(|row| {
                    let impact_paise = *valid.get(&(
                        row.kind.as_str(),
                        row.source_type.as_str(),
                        row.source_id.as_str(),
                    ))?;
                    let title = row.title.trim();
                    let message = row.message.trim();
                    if title.is_empty()
                        || title.chars().count() > 120
                        || message.is_empty()
                        || message.chars().count() > 500
                    {
                        return None;
                    }
                    Some(CopilotInsight {
                        recommendation_version_id: String::new(),
                        recommendation_key: String::new(),
                        recommendation_version: String::new(),
                        evaluation_status: "passed".to_string(),
                        kind: row.kind,
                        title: title.to_string(),
                        message: message.to_string(),
                        impact_paise,
                        source_type: row.source_type,
                        source_id: row.source_id,
                    })
                })
                .take(10)
                .collect::<Vec<_>>();
            if !recommendations.is_empty() {
                report.copilot = recommendations;
                report.copilot_source = data.source;
                report.copilot_model = data.model;
            }
        }
    }
    if !report.copilot.is_empty() {
        report.copilot_evaluation_status = "passed".to_string();
        if let Err(error) =
            persist_profit_copilot_versions(db, tenant_id, branch_ids, &mut report).await
        {
            report.copilot_evaluation_status = "persistence_failed".to_string();
            tracing::warn!(tenant_id, error = ?error, "profit copilot version persistence failed");
        }
    }
    tracing::info!(
        tenant_id,
        branch_count = branch_ids.len(),
        fact_schema_version = %report.copilot_fact_schema_version,
        fact_hash = %report.copilot_fact_hash,
        reconciliation_ready = report.reconciliation_ready,
        recommendation_count = report.copilot.len(),
        provider = %report.copilot_source,
        model = %report.copilot_model,
        duration_ms = started.elapsed().as_millis() as u64,
        "profit copilot completed"
    );
    report
}

async fn request_profit_copilot(
    url: &str,
    token: &str,
    tenant_id: &str,
    branch_ids: &[String],
    report: &AdvancedProfitIntelligence,
) -> Option<AiCopilotData> {
    let facts = report.copilot_facts.as_ref()?;
    if !facts.branch_period_close_ready || report.copilot.is_empty() {
        return None;
    }
    let payload = json!({
        "tenant_id": tenant_id,
        "branch_ids": branch_ids,
        "from_date": report.from_date,
        "to_date": report.to_date,
        "facts": facts,
        "candidates": report.copilot,
    });
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(8))
        .build()
        .ok()?;
    let response = client
        .post(format!("{url}/api/v1/profit-copilot/recommendations"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<AiCopilotEnvelope>().await.ok()?.data
}

async fn persist_profit_copilot_versions(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    report: &mut AdvancedProfitIntelligence,
) -> Result<(), sqlx::Error> {
    let period_start = NaiveDate::parse_from_str(&report.from_date, "%Y-%m-%d")
        .expect("advanced profit start date is ISO formatted");
    let period_end = NaiveDate::parse_from_str(&report.to_date, "%Y-%m-%d")
        .expect("advanced profit end date is ISO formatted");
    let fact_hash = report.copilot_fact_hash.clone();
    let version = format!(
        "{}:{}",
        report.copilot_fact_schema_version,
        fact_hash.get(..12).unwrap_or(&fact_hash)
    );
    let provider = report.copilot_source.clone();
    let model = report.copilot_model.clone();
    for row in &mut report.copilot {
        let raw_key = format!("{}:{}:{}", row.kind, row.source_type, row.source_id);
        row.recommendation_key = format!("{:x}", Sha256::digest(raw_key.as_bytes()));
        row.recommendation_version = version.clone();
        row.evaluation_status = "passed".to_string();
        let evaluation = json!({
            "factsOnly": true,
            "reconciliationReady": true,
            "sourceAllowListed": true,
            "impactPreserved": true,
            "factHash": fact_hash,
        });
        row.recommendation_version_id = analytics_repository::upsert_profit_copilot_version(
            db,
            analytics_repository::ProfitCopilotVersionInsert {
                tenant_id,
                branch_ids,
                period_start,
                period_end,
                recommendation_key: &row.recommendation_key,
                fact_schema_version: COPILOT_FACT_SCHEMA_VERSION,
                fact_hash: &fact_hash,
                provider: &provider,
                model: &model,
                kind: &row.kind,
                title: &row.title,
                message: &row.message,
                impact_paise: row.impact_paise,
                source_type: &row.source_type,
                source_id: &row.source_id,
                evaluation_status: &row.evaluation_status,
                evaluation_json: &evaluation,
            },
        )
        .await?;
    }
    Ok(())
}

pub async fn record_profit_copilot_feedback(
    db: &PgPool,
    tenant_id: &str,
    recommendation_version_id: &str,
    actor_user_id: &str,
    payload: ProfitCopilotFeedbackRequest,
) -> Result<ProfitCopilotFeedback, AppError> {
    let decision = payload.decision.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "accepted" | "rejected") {
        return Err(AppError::validation(
            "decision must be accepted or rejected",
        ));
    }
    let comment = payload.comment.unwrap_or_default().trim().to_string();
    if comment.chars().count() > 500 {
        return Err(AppError::validation(
            "feedback comment must be 500 characters or less",
        ));
    }
    let row = analytics_repository::create_profit_copilot_feedback(
        db,
        tenant_id,
        recommendation_version_id,
        &decision,
        &comment,
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to save profit copilot feedback"))?
    .ok_or_else(|| AppError::not_found("profit copilot recommendation version not found"))?;
    Ok(ProfitCopilotFeedback {
        id: row.id,
        recommendation_version_id: row.recommendation_version_id,
        decision: row.decision,
        comment: row.comment,
        actor_user_id: row.actor_user_id,
        created_at: row.created_at,
    })
}

fn dimension(rows: &[ProfitDimensionRow], name: &str) -> Vec<ProfitDimensionRow> {
    rows.iter()
        .filter(|row| row.dimension == name)
        .cloned()
        .collect()
}

fn profit_leaks(services: &[ProfitDimensionRow], recipes: &[RecipeVarianceRow]) -> Vec<ProfitLeak> {
    let mut leaks = Vec::new();
    for row in services {
        if row.net_profit_paise < 0 {
            leaks.push(ProfitLeak {
                kind: "negative_margin".to_string(),
                source_type: "service".to_string(),
                source_id: row.entity_id.clone(),
                title: format!("Review {} margin", row.entity_name),
                message: "Recorded service costs exceed net revenue".to_string(),
                impact_paise: row.net_profit_paise.saturating_abs(),
                severity: severity(row.net_profit_paise.saturating_abs()),
            });
        }
        let gross_before_discount = row.revenue_paise.saturating_add(row.discount_paise);
        if gross_before_discount > 0
            && row.discount_paise.saturating_mul(10_000)
                > gross_before_discount.saturating_mul(2_000)
        {
            leaks.push(ProfitLeak {
                kind: "discount_abuse".to_string(),
                source_type: "service".to_string(),
                source_id: row.entity_id.clone(),
                title: format!("Review {} discounts", row.entity_name),
                message: "Recorded discounts exceed 20% of pre-discount revenue".to_string(),
                impact_paise: row.discount_paise,
                severity: severity(row.discount_paise),
            });
        }
    }
    for row in recipes.iter().filter(|row| row.variance_paise > 0) {
        leaks.push(ProfitLeak {
            kind: "recipe_variance".to_string(),
            source_type: "service".to_string(),
            source_id: row.service_id.clone(),
            title: format!("Audit {} recipe usage", row.service_name),
            message: "Actual recorded product cost exceeds recipe cost".to_string(),
            impact_paise: row.variance_paise,
            severity: severity(row.variance_paise),
        });
    }
    leaks
}

fn pricing_recommendations(services: &[ProfitDimensionRow]) -> Vec<PricingRecommendation> {
    const TARGET_MARGIN_BPS: i64 = 2_500;
    let mut rows = services
        .iter()
        .filter(|row| {
            row.revenue_paise > 0 && row.unit_count > 0 && row.margin_bps < TARGET_MARGIN_BPS
        })
        .filter_map(|row| {
            let target_revenue = ceil_div(
                row.total_cost_paise.saturating_mul(10_000),
                10_000 - TARGET_MARGIN_BPS,
            );
            let expected_profit_lift_paise = target_revenue.saturating_sub(row.revenue_paise);
            (expected_profit_lift_paise > 0).then(|| PricingRecommendation {
                service_id: row.entity_id.clone(),
                service_name: row.entity_name.clone(),
                current_average_price_paise: row.revenue_paise / row.unit_count,
                suggested_price_paise: ceil_div(target_revenue, row.unit_count),
                current_margin_bps: row.margin_bps,
                target_margin_bps: TARGET_MARGIN_BPS,
                expected_profit_lift_paise,
            })
        })
        .collect::<Vec<_>>();
    rows.sort_by_key(|row| std::cmp::Reverse(row.expected_profit_lift_paise));
    rows
}

fn copilot_insights(
    leaks: &[ProfitLeak],
    pricing: &[PricingRecommendation],
) -> Vec<CopilotInsight> {
    let mut insights = leaks
        .iter()
        .take(5)
        .map(|leak| CopilotInsight {
            recommendation_version_id: String::new(),
            recommendation_key: String::new(),
            recommendation_version: String::new(),
            evaluation_status: "pending".to_string(),
            kind: leak.kind.clone(),
            title: leak.title.clone(),
            message: leak.message.clone(),
            impact_paise: leak.impact_paise,
            source_type: leak.source_type.clone(),
            source_id: leak.source_id.clone(),
        })
        .collect::<Vec<_>>();
    insights.extend(pricing.iter().take(3).map(|row| CopilotInsight {
        recommendation_version_id: String::new(),
        recommendation_key: String::new(),
        recommendation_version: String::new(),
        evaluation_status: "pending".to_string(),
        kind: "pricing_recommendation".to_string(),
        title: format!("Review {} price", row.service_name),
        message: format!(
            "Target margin is {}% based on recorded product and staff cost",
            row.target_margin_bps / 100
        ),
        impact_paise: row.expected_profit_lift_paise,
        source_type: "service".to_string(),
        source_id: row.service_id.clone(),
    }));
    insights
}

fn severity(impact_paise: i64) -> String {
    if impact_paise >= 500_000 {
        "high"
    } else if impact_paise >= 100_000 {
        "medium"
    } else {
        "low"
    }
    .to_string()
}

fn ceil_div(value: i64, divisor: i64) -> i64 {
    if value <= 0 {
        0
    } else {
        value.saturating_add(divisor - 1) / divisor
    }
}

fn summarize_profit(
    rows: &[analytics_repository::ProfitLedgerRecord],
    group_by: &str,
) -> (ProfitMetrics, Vec<ProfitBreakdownRow>, Vec<String>) {
    let mut total = ProfitMetrics::default();
    let mut groups = BTreeMap::<String, ProfitMetrics>::new();
    let mut unclassified = BTreeSet::new();

    for row in rows {
        let Some((revenue, cogs, operating_expense)) = account_impact(row) else {
            unclassified.insert(row.account_code.clone());
            continue;
        };
        add_impact(&mut total, revenue, cogs, operating_expense);
        let key = match group_by {
            "account" => row.account_code.clone(),
            "costCenter" => row
                .cost_center_code
                .clone()
                .unwrap_or_else(|| "Unassigned".to_string()),
            _ => row.source_type.clone(),
        };
        add_impact(
            groups.entry(key).or_default(),
            revenue,
            cogs,
            operating_expense,
        );
    }
    finalize_metrics(&mut total);
    let mut breakdown = groups
        .into_iter()
        .map(|(key, mut metrics)| {
            finalize_metrics(&mut metrics);
            ProfitBreakdownRow { key, metrics }
        })
        .collect::<Vec<_>>();
    breakdown.sort_by_key(|row| std::cmp::Reverse(row.metrics.net_profit_paise));
    (total, breakdown, unclassified.into_iter().collect())
}

fn account_impact(row: &analytics_repository::ProfitLedgerRecord) -> Option<(i64, i64, i64)> {
    let net_credit = row.credit_paise.saturating_sub(row.debit_paise);
    let net_debit = row.debit_paise.saturating_sub(row.credit_paise);
    match row.account_code.as_str() {
        "SALES_REVENUE" | "SALES_RETURNS" | "ROUNDING_INCOME" => Some((net_credit, 0, 0)),
        "COST_OF_GOODS_SOLD" => Some((0, net_debit, 0)),
        code if code.ends_with("_EXPENSE") => Some((0, 0, net_debit)),
        _ => None,
    }
}

fn add_impact(metrics: &mut ProfitMetrics, revenue: i64, cogs: i64, operating: i64) {
    metrics.revenue_paise = metrics.revenue_paise.saturating_add(revenue);
    metrics.cost_of_goods_paise = metrics.cost_of_goods_paise.saturating_add(cogs);
    metrics.operating_expense_paise = metrics.operating_expense_paise.saturating_add(operating);
}

fn finalize_metrics(metrics: &mut ProfitMetrics) {
    metrics.gross_profit_paise = metrics
        .revenue_paise
        .saturating_sub(metrics.cost_of_goods_paise);
    metrics.total_expense_paise = metrics
        .cost_of_goods_paise
        .saturating_add(metrics.operating_expense_paise);
    metrics.net_profit_paise = metrics
        .gross_profit_paise
        .saturating_sub(metrics.operating_expense_paise);
    metrics.net_margin_bps = if metrics.revenue_paise > 0 {
        metrics.net_profit_paise.saturating_mul(10_000) / metrics.revenue_paise
    } else {
        0
    };
}

fn moving_average_forecast(values: &[i64], periods: usize) -> Vec<i64> {
    let baseline = if values.is_empty() {
        0
    } else {
        let start = values.len().saturating_sub(3);
        values[start..].iter().sum::<i64>() / (values.len() - start) as i64
    };
    vec![baseline; periods]
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use crate::repositories::analytics_repository::{
        DailyProfitRecord, PivotCellRecord, ProfitBookingDemandRecord, ProfitLedgerRecord,
        ProfitLiabilityRecord, RecipeVarianceRecord,
    };

    use super::{
        build_advanced_insights, build_pivot, cost_completeness_bps, moving_average_forecast,
        summarize_profit, CustomReportDefinition, ProfitDimensionRow,
    };

    #[test]
    fn forecast_uses_last_three_source_days_without_fabricating_growth() {
        assert_eq!(
            moving_average_forecast(&[50, 100, 200, 300], 2),
            vec![200, 200]
        );
        assert_eq!(moving_average_forecast(&[], 2), vec![0, 0]);
    }

    #[test]
    fn profit_summary_uses_journal_income_cogs_and_expenses() {
        let rows = vec![
            ProfitLedgerRecord {
                source_type: "invoice".into(),
                account_code: "SALES_REVENUE".into(),
                cost_center_code: Some("STYLIST_01".into()),
                debit_paise: 0,
                credit_paise: 100_000,
            },
            ProfitLedgerRecord {
                source_type: "pos_cogs".into(),
                account_code: "COST_OF_GOODS_SOLD".into(),
                cost_center_code: Some("STYLIST_01".into()),
                debit_paise: 25_000,
                credit_paise: 0,
            },
            ProfitLedgerRecord {
                source_type: "payroll".into(),
                account_code: "PAYROLL_EXPENSE".into(),
                cost_center_code: None,
                debit_paise: 15_000,
                credit_paise: 0,
            },
        ];
        let (metrics, breakdown, _) = summarize_profit(&rows, "sourceType");
        assert_eq!(metrics.net_profit_paise, 60_000);
        assert_eq!(metrics.net_margin_bps, 6_000);
        assert_eq!(breakdown.len(), 3);
        let (_, cost_centers, _) = summarize_profit(&rows, "costCenter");
        assert_eq!(cost_centers[0].key, "STYLIST_01");
        assert_eq!(cost_centers[0].metrics.net_profit_paise, 75_000);
    }

    #[test]
    fn advanced_insights_use_recorded_costs_for_leaks_pricing_and_recipe_variance() {
        let service = ProfitDimensionRow {
            dimension: "service".into(),
            entity_id: "svc-1".into(),
            entity_name: "Hair Cut".into(),
            unit_count: 2,
            revenue_paise: 100_000,
            discount_paise: 30_000,
            product_cost_paise: 70_000,
            staff_cost_paise: 20_000,
            staff_time_cost_paise: 1_000,
            gateway_fee_paise: 1_000,
            refund_fee_paise: 0,
            overhead_cost_paise: 1_000,
            total_cost_paise: 90_000,
            net_profit_paise: 10_000,
            margin_bps: 1_000,
            fully_loaded_cost_paise: 93_000,
            fully_loaded_profit_paise: 7_000,
            fully_loaded_margin_bps: 700,
            line_count: 2,
            incomplete_cost_line_count: 0,
            cost_completeness_bps: 10_000,
        };
        let branch = ProfitDimensionRow {
            dimension: "branch".into(),
            entity_id: "branch-1".into(),
            entity_name: "Main Branch".into(),
            ..service.clone()
        };
        let category = ProfitDimensionRow {
            dimension: "category".into(),
            entity_id: "Hair".into(),
            entity_name: "Hair".into(),
            ..service.clone()
        };
        let customer = ProfitDimensionRow {
            dimension: "customer".into(),
            entity_id: "client-1".into(),
            entity_name: "Recorded Customer".into(),
            ..service.clone()
        };
        let mut report = build_advanced_insights(
            vec![service, branch, category, customer],
            vec![RecipeVarianceRecord {
                service_id: "svc-1".into(),
                service_name: "Hair Cut".into(),
                sold_quantity: 2,
                recipe_item_count: 1,
                expected_cost_paise: 50_000,
                actual_cost_paise: 70_000,
            }],
            vec![ProfitBookingDemandRecord {
                service_id: "svc-1".into(),
                service_name: "Hair Cut".into(),
                local_hour: 11,
                appointment_count: 4,
            }],
            vec![ProfitLiabilityRecord {
                source_type: "package".into(),
                source_item_id: "pkg-1".into(),
                plan_name: "Recorded Package".into(),
                sold_value_paise: 100_000,
                recognized_value_paise: 60_000,
                remaining_liability_paise: 40_000,
                redeemed_value_paise: 60_000,
                redeemed_cost_paise: 30_000,
            }],
            vec![DailyProfitRecord {
                business_date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
                revenue_paise: 100_000,
                direct_cost_paise: 90_000,
            }],
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 31).unwrap(),
            "branch",
            1,
        );
        assert_eq!(report.service_profit[0].net_profit_paise, 10_000);
        assert_eq!(report.service_profit[0].fully_loaded_profit_paise, 7_000);
        assert!(report.leaks.iter().any(|row| row.kind == "discount_abuse"));
        assert!(report.leaks.iter().any(|row| row.kind == "recipe_variance"));
        assert_eq!(report.pricing[0].suggested_price_paise, 60_000);
        assert!(!report.copilot.is_empty());
        assert_eq!(report.branch_scope, "branch");
        assert_eq!(report.branch_count, 1);
        assert_eq!(report.category_profit[0].entity_name, "Hair");
        assert_eq!(report.booking_recommendations[0].recommended_hour, 11);
        assert_eq!(report.liability_risks[0].projected_cost_paise, 20_000);
        assert_eq!(report.customer_profit_scores[0].customer_id, "client-1");
        assert_eq!(report.profit_digital_twin.baseline_revenue_paise, 100_000);
        assert!(report.enterprise_analytics.next_month_forecast_profit_paise > 0);
        assert_eq!(
            cost_completeness_bps([
                "recorded",
                "not_required",
                "missing",
                "recorded",
                "recorded",
                "not_configured",
            ]),
            6_666
        );
        report.incomplete_cost_line_count = 1;
        super::block_unreconciled_recommendations(&mut report);
        assert!(report.recommendations_blocked);
        assert!(report.leaks.is_empty() && report.pricing.is_empty() && report.copilot.is_empty());
    }

    #[test]
    fn custom_report_builds_pivot_from_grouped_source_rows() {
        let definition = CustomReportDefinition {
            dataset: "sales".into(),
            row_dimension: "service".into(),
            column_dimension: "staff".into(),
            metric: "revenuePaise".into(),
            date_range: "last7Days".into(),
            from_date: None,
            to_date: None,
            status: None,
        };
        let report = build_pivot(
            &definition,
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 7).unwrap(),
            vec![
                PivotCellRecord {
                    row_key: "Hair Cut".into(),
                    column_key: "Asha".into(),
                    value: 12_000,
                },
                PivotCellRecord {
                    row_key: "Hair Cut".into(),
                    column_key: "Riya".into(),
                    value: 8_000,
                },
            ],
        );
        assert_eq!(report.rows, vec!["Hair Cut"]);
        assert_eq!(report.columns, vec!["Asha", "Riya"]);
        assert_eq!(report.total, 20_000);
    }
}
