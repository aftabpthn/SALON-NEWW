use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration as StdDuration,
};

use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{
    config::Settings,
    models::{balance_sheet::AccountGroup, common::AppError},
    repositories::analytics_repository,
    services::{balance_sheet_service, invoice_delivery},
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
    pub total_cost_paise: i64,
    pub net_profit_paise: i64,
    pub margin_bps: i64,
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
    pub kind: String,
    pub title: String,
    pub message: String,
    pub impact_paise: i64,
    pub source_type: String,
    pub source_id: String,
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
    pub service_profit: Vec<ProfitDimensionRow>,
    pub staff_profit: Vec<ProfitDimensionRow>,
    pub customer_profit: Vec<ProfitDimensionRow>,
    pub branch_profit: Vec<ProfitDimensionRow>,
    pub leaks: Vec<ProfitLeak>,
    pub pricing: Vec<PricingRecommendation>,
    pub recipe_variance: Vec<RecipeVarianceRow>,
    pub copilot: Vec<CopilotInsight>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitLine {
    pub branch_id: String,
    pub first_event_date: NaiveDate,
    pub last_event_date: NaiveDate,
    pub sale_id: String,
    pub sale_line_id: String,
    pub reference_id: String,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub staff_id: String,
    pub client_id: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroProfitReconciliation {
    pub from_date: NaiveDate,
    pub to_date: NaiveDate,
    pub branch_scope: String,
    pub branch_count: usize,
    pub ledger_revenue_paise: i64,
    pub micro_revenue_paise: i64,
    pub revenue_variance_paise: i64,
    pub ledger_cogs_paise: i64,
    pub micro_product_cost_paise: i64,
    pub cogs_variance_paise: i64,
    pub rounding_bridge_paise: i64,
    pub reportable_line_count: i64,
    pub complete_line_count: i64,
    pub completeness_bps: i64,
    pub missing_invoice_journal_count: i64,
    pub missing_product_cost_line_count: i64,
    pub missing_staff_cost_line_count: i64,
    pub missing_staff_time_cost_line_count: i64,
    pub missing_gateway_fee_line_count: i64,
    pub missing_refund_fee_line_count: i64,
    pub allocation_rule_count: i64,
    pub reconciled: bool,
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
    let dimension_records =
        analytics_repository::profit_dimensions(db, tenant_id, branch_ids, from_date, to_date)
            .await
            .map_err(|_| AppError::internal("failed to load dimensional profit insights"))?;
    let recipe_records =
        analytics_repository::recipe_variance(db, tenant_id, branch_ids, from_date, to_date)
            .await
            .map_err(|_| AppError::internal("failed to load recipe variance"))?;
    Ok(build_advanced_insights(
        dimension_records,
        recipe_records,
        from_date,
        to_date,
        branch_scope,
        branch_ids.len(),
    ))
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
) -> Result<MicroProfitPage, AppError> {
    validate_micro_profit_request(branch_ids, from_date, to_date)?;
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
            MicroProfitLine {
                branch_id: row.branch_id,
                first_event_date: row.first_event_date,
                last_event_date: row.last_event_date,
                sale_id: row.sale_id,
                sale_line_id: row.sale_line_id,
                reference_id: row.reference_id,
                line_type: row.line_type,
                item_id: row.item_id,
                item_name: row.item_name,
                staff_id: row.staff_id,
                client_id: row.client_id,
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
    let complete_line_count = if row.allocation_rule_count > 0 {
        row.complete_line_count
    } else {
        0
    };
    let completeness_bps = if row.reportable_line_count > 0 {
        complete_line_count.saturating_mul(10_000) / row.reportable_line_count
    } else {
        10_000
    };
    let reconciled = revenue_variance_paise == 0
        && cogs_variance_paise == 0
        && row.missing_invoice_journal_count == 0
        && row.missing_product_cost_line_count == 0
        && row.missing_staff_cost_line_count == 0
        && row.missing_staff_time_cost_line_count == 0
        && row.missing_gateway_fee_line_count == 0
        && row.missing_refund_fee_line_count == 0
        && row.allocation_rule_count > 0;
    Ok(MicroProfitReconciliation {
        from_date,
        to_date,
        branch_scope: branch_scope.to_string(),
        branch_count: branch_ids.len(),
        ledger_revenue_paise: row.ledger_revenue_paise,
        micro_revenue_paise: row.micro_revenue_paise,
        revenue_variance_paise,
        ledger_cogs_paise: row.ledger_cogs_paise,
        micro_product_cost_paise: row.micro_product_cost_paise,
        cogs_variance_paise,
        rounding_bridge_paise: row.rounding_bridge_paise,
        reportable_line_count: row.reportable_line_count,
        complete_line_count,
        completeness_bps,
        missing_invoice_journal_count: row.missing_invoice_journal_count,
        missing_product_cost_line_count: row.missing_product_cost_line_count,
        missing_staff_cost_line_count: row.missing_staff_cost_line_count,
        missing_staff_time_cost_line_count: row.missing_staff_time_cost_line_count,
        missing_gateway_fee_line_count: row.missing_gateway_fee_line_count,
        missing_refund_fee_line_count: row.missing_refund_fee_line_count,
        allocation_rule_count: row.allocation_rule_count,
        reconciled,
    })
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

fn build_advanced_insights(
    dimension_records: Vec<analytics_repository::ProfitDimensionRecord>,
    recipe_records: Vec<analytics_repository::RecipeVarianceRecord>,
    from_date: NaiveDate,
    to_date: NaiveDate,
    branch_scope: &str,
    branch_count: usize,
) -> AdvancedProfitIntelligence {
    let rows = dimension_records
        .into_iter()
        .map(|row| {
            let total_cost_paise = row.product_cost_paise.saturating_add(row.staff_cost_paise);
            let net_profit_paise = row.revenue_paise.saturating_sub(total_cost_paise);
            let margin_bps = if row.revenue_paise > 0 {
                net_profit_paise.saturating_mul(10_000) / row.revenue_paise
            } else {
                0
            };
            ProfitDimensionRow {
                dimension: row.dimension,
                entity_id: row.entity_id,
                entity_name: row.entity_name,
                unit_count: row.unit_count,
                revenue_paise: row.revenue_paise,
                discount_paise: row.discount_paise,
                product_cost_paise: row.product_cost_paise,
                staff_cost_paise: row.staff_cost_paise,
                total_cost_paise,
                net_profit_paise,
                margin_bps,
            }
        })
        .collect::<Vec<_>>();
    let service_profit = dimension(&rows, "service");
    let staff_profit = dimension(&rows, "staff");
    let customer_profit = dimension(&rows, "customer");
    let branch_profit = dimension(&rows, "branch");
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
    let copilot = copilot_insights(&leaks, &pricing);

    AdvancedProfitIntelligence {
        from_date: from_date.to_string(),
        to_date: to_date.to_string(),
        source: "pos_sale_lines_inventory_ledger_commission_snapshots",
        branch_scope: branch_scope.to_string(),
        branch_count,
        copilot_source: "rust_deterministic".to_string(),
        copilot_model: "local-profit-policy-v1".to_string(),
        service_profit,
        staff_profit,
        customer_profit,
        branch_profit,
        leaks,
        pricing,
        recipe_variance,
        copilot,
    }
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
    settings: &Settings,
    tenant_id: &str,
    branch_ids: &[String],
    mut report: AdvancedProfitIntelligence,
) -> AdvancedProfitIntelligence {
    let (Some(url), Some(token)) = (
        settings.ai_service_url.as_deref(),
        settings.ai_service_token.as_deref(),
    ) else {
        return report;
    };
    if report.copilot.is_empty() {
        return report;
    }
    let payload = json!({
        "tenant_id": tenant_id,
        "branch_ids": branch_ids,
        "from_date": report.from_date,
        "to_date": report.to_date,
        "candidates": report.copilot,
    });
    let Ok(client) = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(8))
        .build()
    else {
        return report;
    };
    let Ok(response) = client
        .post(format!("{url}/api/v1/profit-copilot/recommendations"))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
    else {
        return report;
    };
    if !response.status().is_success() {
        return report;
    }
    let Ok(envelope) = response.json::<AiCopilotEnvelope>().await else {
        return report;
    };
    let Some(data) = envelope.data else {
        return report;
    };
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
    if recommendations.is_empty() {
        return report;
    }
    report.copilot = recommendations;
    report.copilot_source = data.source;
    report.copilot_model = data.model;
    report
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
            kind: leak.kind.clone(),
            title: leak.title.clone(),
            message: leak.message.clone(),
            impact_paise: leak.impact_paise,
            source_type: leak.source_type.clone(),
            source_id: leak.source_id.clone(),
        })
        .collect::<Vec<_>>();
    insights.extend(pricing.iter().take(3).map(|row| CopilotInsight {
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
        PivotCellRecord, ProfitDimensionRecord, ProfitLedgerRecord, RecipeVarianceRecord,
    };

    use super::{
        build_advanced_insights, build_pivot, moving_average_forecast, summarize_profit,
        CustomReportDefinition,
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
        let report = build_advanced_insights(
            vec![ProfitDimensionRecord {
                dimension: "service".into(),
                entity_id: "svc-1".into(),
                entity_name: "Hair Cut".into(),
                unit_count: 2,
                revenue_paise: 100_000,
                discount_paise: 30_000,
                product_cost_paise: 70_000,
                staff_cost_paise: 20_000,
            }],
            vec![RecipeVarianceRecord {
                service_id: "svc-1".into(),
                service_name: "Hair Cut".into(),
                sold_quantity: 2,
                recipe_item_count: 1,
                expected_cost_paise: 50_000,
                actual_cost_paise: 70_000,
            }],
            NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 7, 31).unwrap(),
            "branch",
            1,
        );
        assert_eq!(report.service_profit[0].net_profit_paise, 10_000);
        assert!(report.leaks.iter().any(|row| row.kind == "discount_abuse"));
        assert!(report.leaks.iter().any(|row| row.kind == "recipe_variance"));
        assert_eq!(report.pricing[0].suggested_price_paise, 60_000);
        assert!(!report.copilot.is_empty());
        assert_eq!(report.branch_scope, "branch");
        assert_eq!(report.branch_count, 1);
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
