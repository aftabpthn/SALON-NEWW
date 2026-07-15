use std::collections::BTreeSet;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    config::is_local_env,
    models::{
        common::{ApiResponse, ApiResult, AppError},
        profit_governance::{
            ActionEvaluationRequest, ApprovalReviewRequest, DiscountEvaluationRequest,
            GovernanceApproval, GovernanceAuditEvent, GovernanceEvaluationResponse,
            GovernanceListQuery, GovernanceRule, GovernanceRuleSaveRequest, GovernanceSummary,
            ProfitAction, ProfitActionCreateRequest, ProfitActionTransitionRequest,
        },
    },
    repositories::auth_repository,
    routes::context::tenant_branch,
    services::{
        analytics_service, auth_service::AuthClaims, branch_service, profit_governance_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports", axum::routing::get(report_catalog))
        .route(
            "/reports/custom",
            axum::routing::get(list_custom_reports).post(save_custom_report),
        )
        .route(
            "/reports/custom/preview",
            axum::routing::post(preview_custom_report),
        )
        .route(
            "/reports/custom/:id/run",
            axum::routing::post(run_custom_report),
        )
        .route("/reports/dashboard", axum::routing::get(report_dashboard))
        .route(
            "/reports/revenue-forecast",
            axum::routing::get(report_revenue_forecast),
        )
        .route(
            "/profit-intelligence/summary",
            axum::routing::get(report_profit_intelligence),
        )
        .route(
            "/profit-intelligence/breakdown",
            axum::routing::get(report_profit_intelligence),
        )
        .route(
            "/profit-intelligence/advanced",
            axum::routing::get(report_advanced_profit_intelligence),
        )
        .route(
            "/profit-intelligence/micro-lines",
            axum::routing::get(report_micro_profit_lines),
        )
        .route(
            "/profit-intelligence/reconciliation",
            axum::routing::get(report_micro_profit_reconciliation),
        )
        .route(
            "/profit-intelligence/allocation-rules",
            axum::routing::get(list_micro_profit_allocation_rules)
                .post(create_micro_profit_allocation_rule),
        )
        .route(
            "/profit-intelligence/governance/rules",
            axum::routing::get(list_profit_governance_rules).post(save_profit_governance_rule),
        )
        .route(
            "/profit-intelligence/governance/evaluate-discount",
            axum::routing::post(evaluate_profit_discount),
        )
        .route(
            "/profit-intelligence/governance/evaluate-action",
            axum::routing::post(evaluate_profit_action),
        )
        .route(
            "/profit-intelligence/governance/approvals",
            axum::routing::get(list_profit_governance_approvals),
        )
        .route(
            "/profit-intelligence/governance/approvals/:id/approve",
            axum::routing::post(approve_profit_governance_decision),
        )
        .route(
            "/profit-intelligence/governance/approvals/:id/reject",
            axum::routing::post(reject_profit_governance_decision),
        )
        .route(
            "/profit-intelligence/governance/audit",
            axum::routing::get(list_profit_governance_audit),
        )
        .route(
            "/profit-intelligence/governance/summary",
            axum::routing::get(profit_governance_summary),
        )
        .route(
            "/profit-intelligence/actions",
            axum::routing::get(list_profit_actions).post(create_profit_action),
        )
        .route(
            "/profit-intelligence/actions/:id/approve",
            axum::routing::post(approve_profit_action),
        )
        .route(
            "/profit-intelligence/actions/:id/complete",
            axum::routing::post(complete_profit_action),
        )
        .route(
            "/profit-intelligence/actions/:id/dismiss",
            axum::routing::post(dismiss_profit_action),
        )
        .route(
            "/balance-sheet/dimensional-pnl",
            axum::routing::get(report_dimensional_profit_loss),
        )
        .route(
            "/reports/appointments",
            axum::routing::get(report_appointments),
        )
        .route("/reports/sales", axum::routing::get(report_sales))
        .route(
            "/reports/invoice-activity",
            axum::routing::get(report_invoice_activity),
        )
        .route(
            "/reports/due-recovery",
            axum::routing::get(report_due_recovery),
        )
        .route(
            "/reports/invoices/service-trends",
            axum::routing::get(report_service_trends),
        )
        .route(
            "/reports/invoices/service-clients",
            axum::routing::get(report_service_clients),
        )
        .route(
            "/reports/invoices/:id/follow-ups",
            axum::routing::get(list_invoice_followups).post(create_invoice_followup),
        )
        .route(
            "/reports/payment-modes",
            axum::routing::get(report_payment_modes),
        )
        .route(
            "/reports/cash-drawer-eod",
            axum::routing::get(report_cash_drawer_eod),
        )
        .route(
            "/reports/pos-parity",
            axum::routing::get(list_pos_parity_runs).post(create_pos_parity_run),
        )
        .route(
            "/reports/staff-performance/:staff_id",
            axum::routing::get(report_staff_performance),
        )
        .route(
            "/reports/staff-bookings",
            axum::routing::get(report_staff_bookings),
        )
}

async fn list_custom_reports(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reports = analytics_service::list_custom_reports(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "reports": reports,
        "options": analytics_service::custom_report_options()
    }))))
}

async fn preview_custom_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(definition): Json<analytics_service::CustomReportDefinition>,
) -> ApiResult<analytics_service::PivotReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report =
        analytics_service::preview_custom_report(&state.db, &tenant_id, &branch_id, &definition)
            .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn save_custom_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<analytics_service::CustomReportSaveRequest>,
) -> ApiResult<analytics_service::CustomReportView> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = analytics_service::save_custom_report(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        request,
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn run_custom_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<analytics_service::PivotReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report =
        analytics_service::run_saved_custom_report(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(report)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRangeQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSalesQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueForecastQuery {
    pub history_days: Option<i32>,
    pub forecast_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitIntelligenceQuery {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub group_by: Option<String>,
    pub scope: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReportQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceReportQuery {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub service_id: Option<String>,
    pub staff_id: Option<String>,
    pub client_id: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpWriteRequest {
    pub action: Option<String>,
    pub note: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParityRunWriteRequest {
    pub test_case: String,
    pub legacy_payload: Option<Value>,
    pub rust_payload: Option<Value>,
    pub legacy_result: Option<Value>,
    pub rust_result: Option<Value>,
    pub matched: Option<bool>,
    pub diff: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportStaffPath {
    pub staff_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportCatalogItem {
    pub id: &'static str,
    pub title: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    pub path: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDashboard {
    pub total_appointments: i64,
    pub today_appointments: i64,
    pub open_appointments: i64,
    pub total_clients: i64,
    pub total_services: i64,
    pub today_sales_paise: i64,
    pub open_sales: i64,
    pub recent_completed_appointments: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentGroupRecord {
    pub report_date: String,
    pub status: String,
    pub count: i64,
    pub total_minutes: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSalesSummary {
    pub total_sales_paise: i64,
    pub paid_sales_paise: i64,
    pub outstanding_sales_paise: i64,
    pub top_invoices: Vec<ReportSalesItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSalesItem {
    pub id: String,
    pub invoice_number: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPerformanceSummary {
    pub staff_id: String,
    pub total_appointments: i64,
    pub completed_appointments: i64,
    pub cancelled_appointments: i64,
    pub in_service_minutes: i64,
    pub most_recent_appointment: String,
    pub top_services: Vec<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffBookingReportRow {
    pub staff_id: String,
    pub staff_name: String,
    pub staff_type: String,
    pub appointment_count: i64,
    pub appointment_value_paise: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceActivityRow {
    pub invoice_id: String,
    pub invoice_number: String,
    pub activity_type: String,
    pub channel: String,
    pub recipient: String,
    pub status: String,
    pub payload: Value,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DueRecoveryRow {
    pub invoice_id: String,
    pub invoice_number: String,
    pub client_id: String,
    pub client_name: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub balance_paise: i64,
    pub ageing_days: i32,
    pub follow_up_count: i64,
    pub last_follow_up_at: Option<chrono::DateTime<Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTrendRow {
    pub service_id: String,
    pub service_name: String,
    pub service_group: String,
    pub staff_id: String,
    pub staff_name: String,
    pub quantity_sold: i64,
    pub gross_sale_paise: i64,
    pub discount_paise: i64,
    pub net_sale_paise: i64,
    pub gst_paise: i64,
    pub product_cost_paise: i64,
    pub gross_margin_paise: i64,
    pub margin_bps: i64,
    pub client_count: i64,
    pub repeat_client_count: i64,
    pub invoice_count: i64,
    pub peak_selling_hour: String,
    pub last_sold_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTrendSummary {
    pub total_services_sold: i64,
    pub total_service_revenue_paise: i64,
    pub average_service_price_paise: i64,
    pub top_service: String,
    pub highest_margin_service: String,
    pub lowest_margin_service: String,
    pub discount_leakage_paise: i64,
    pub service_gst_collected_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceTrendReport {
    pub summary: ServiceTrendSummary,
    pub rows: Vec<ServiceTrendRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServiceClientRow {
    pub sold_at: chrono::DateTime<Utc>,
    pub business_date: NaiveDate,
    pub service_group: String,
    pub service_id: String,
    pub service_name: String,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub service_price_paise: i64,
    pub sale_type: String,
    pub staff_id: String,
    pub staff_name: String,
    pub invoice_id: String,
    pub invoice_number: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceClientSummary {
    pub total_clients: i64,
    pub total_service_revenue_paise: i64,
    pub total_service_rows: i64,
    pub appointment_rows: i64,
    pub quick_sale_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceClientReport {
    pub summary: ServiceClientSummary,
    pub rows: Vec<ServiceClientRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpRow {
    pub id: String,
    pub sale_id: String,
    pub actor_user_id: String,
    pub action: String,
    pub note: String,
    pub status: String,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PaymentModeReportRow {
    pub method: String,
    pub payment_count: i64,
    pub amount_paise: i64,
    pub invoice_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashDrawerEodReport {
    pub business_date: NaiveDate,
    pub opening_cash_paise: i64,
    pub cash_sales_paise: i64,
    pub cash_refunds_paise: i64,
    pub cash_in_paise: i64,
    pub cash_out_paise: i64,
    pub expected_cash_paise: i64,
    pub counted_cash_paise: Option<i64>,
    pub variance_paise: Option<i64>,
    pub status: String,
    pub payment_modes: Vec<PaymentModeReportRow>,
    pub bank_deposit_paise: i64,
    pub pending_deposit_paise: i64,
    pub reconciliation_exceptions: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ParityRunRow {
    pub id: String,
    pub test_case: String,
    pub legacy_payload_json: Value,
    pub rust_payload_json: Value,
    pub legacy_result_json: Value,
    pub rust_result_json: Value,
    pub matched: bool,
    pub diff_json: Value,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct SaleRow {
    pub id: String,
    pub invoice_number: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub status: String,
    pub created_at: chrono::DateTime<Utc>,
}

async fn report_catalog(State(_state): State<AppState>) -> ApiResult<Vec<ReportCatalogItem>> {
    let catalog = vec![
        ReportCatalogItem {
            id: "dashboard",
            title: "Dashboard snapshot",
            category: "Overview",
            description: "Appointments, clients, services and today's sales at a glance.",
            icon: "dashboard",
            path: "/reports/dashboard",
        },
        ReportCatalogItem {
            id: "appointments",
            title: "Detail Appointment List",
            category: "Appointments",
            description:
                "Detailed appointment register with status, client, staff and service filters.",
            icon: "calendar",
            path: "/reports/appointments",
        },
        ReportCatalogItem {
            id: "sales",
            title: "Sales summary",
            category: "Sales & Finance",
            description: "Total, paid and outstanding sales for the selected period.",
            icon: "sales",
            path: "/reports/sales",
        },
        ReportCatalogItem {
            id: "profit-intelligence",
            title: "Profit Intelligence",
            category: "Sales & Finance",
            description: "Ledger-backed revenue, costs, expenses and profit margins.",
            icon: "balance",
            path: "/profit-intelligence/summary",
        },
        ReportCatalogItem {
            id: "outgoing-funds",
            title: "Outgoing Funds",
            category: "Sales & Finance",
            description: "Outgoing vouchers, approvals, GST and payment details.",
            icon: "payment",
            path: "/finance/outgoing-funds",
        },
        ReportCatalogItem {
            id: "invoice-activity",
            title: "Invoice activity",
            category: "Sales & Finance",
            description: "Invoice notifications and delivery activity.",
            icon: "invoice",
            path: "/reports/invoice-activity",
        },
        ReportCatalogItem {
            id: "due-recovery",
            title: "Due recovery",
            category: "Sales & Finance",
            description: "Outstanding invoice balances and follow-up status.",
            icon: "recovery",
            path: "/reports/due-recovery",
        },
        ReportCatalogItem {
            id: "service-trends",
            title: "Service Trends",
            category: "Sales & Finance",
            description: "Service revenue, quantity, discount, GST, cost and margin trends.",
            icon: "sales",
            path: "/reports/invoices/service-trends",
        },
        ReportCatalogItem {
            id: "service-clients",
            title: "Service Clients",
            category: "Customer",
            description: "Clients, staff and invoices linked to each sold service.",
            icon: "clients",
            path: "/reports/invoices/service-clients",
        },
        ReportCatalogItem {
            id: "payment-modes",
            title: "Payment mode report",
            category: "Sales & Finance",
            description: "Payment totals grouped by payment method.",
            icon: "payment",
            path: "/reports/payment-modes",
        },
        ReportCatalogItem {
            id: "cash-drawer-eod",
            title: "Cash drawer EOD",
            category: "Sales & Finance",
            description: "Expected cash, counted cash and variance for day close.",
            icon: "cash",
            path: "/reports/cash-drawer-eod",
        },
        ReportCatalogItem {
            id: "pos-parity",
            title: "POS parity evidence",
            category: "Sales & Finance",
            description: "Recorded parity checks between POS calculation paths.",
            icon: "balance",
            path: "/reports/pos-parity",
        },
        ReportCatalogItem {
            id: "staff-performance",
            title: "Appointments booked by staff",
            category: "Staff",
            description: "Staff-wise appointment count and billed value for the selected period.",
            icon: "staff",
            path: "/reports/staff-bookings",
        },
    ];

    Ok(Json(ApiResponse::ok(catalog)))
}

async fn report_dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<ReportDashboard> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let today = Utc::now().date_naive();
    let today_start = today
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::internal("invalid current time"))?;
    let today_end = today
        .and_hms_opt(23, 59, 59)
        .ok_or_else(|| AppError::internal("invalid current time"))?;
    let today_start = today_start.and_utc();
    let today_end = today_end.and_utc();

    let total_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let today_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND start_at BETWEEN $3 AND $4",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(today_start)
    .bind(today_end)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let open_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('booked','confirmed','arrived','waiting','in-service')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_clients = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM clients WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_services = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM services WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let today_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(total_paise),0) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND created_at BETWEEN $3 AND $4",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(today_start)
    .bind(today_end)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let open_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('open','partial')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let completed_recent = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status='completed' AND updated_at >= NOW() - interval '7 days'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(ApiResponse::ok(ReportDashboard {
        total_appointments,
        today_appointments,
        open_appointments,
        total_clients,
        total_services,
        today_sales_paise: today_sales,
        open_sales,
        recent_completed_appointments: completed_recent,
    })))
}

async fn report_revenue_forecast(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RevenueForecastQuery>,
) -> ApiResult<analytics_service::RevenueForecast> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = analytics_service::revenue_forecast(
        &state.db,
        &tenant_id,
        &branch_id,
        query.history_days.unwrap_or(30),
        query.forecast_days.unwrap_or(7),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn report_profit_intelligence(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<analytics_service::ProfitIntelligence> {
    profit_intelligence_response(state, claims, headers, query, "sourceType").await
}

async fn report_dimensional_profit_loss(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<analytics_service::ProfitIntelligence> {
    profit_intelligence_response(state, claims, headers, query, "costCenter").await
}

async fn report_advanced_profit_intelligence(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<analytics_service::AdvancedProfitIntelligence> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_scope = query.scope.as_deref().unwrap_or("branch");
    let branch_ids =
        profit_scope_branch_ids(&state, &claims, &tenant_id, &branch_id, branch_scope).await?;
    let today = Utc::now().date_naive();
    let from_date = query
        .from_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today - chrono::Duration::days(29));
    let to_date = query
        .to_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today);
    let report = analytics_service::advanced_profit_intelligence(
        &state.db,
        &tenant_id,
        &branch_ids,
        branch_scope,
        from_date,
        to_date,
    )
    .await?;
    let report =
        analytics_service::enhance_profit_copilot(&state.settings, &tenant_id, &branch_ids, report)
            .await;
    Ok(Json(ApiResponse::ok(report)))
}

async fn report_micro_profit_lines(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<analytics_service::MicroProfitPage> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_scope = query.scope.as_deref().unwrap_or("branch");
    let branch_ids =
        profit_scope_branch_ids(&state, &claims, &tenant_id, &branch_id, branch_scope).await?;
    let today = Utc::now().date_naive();
    let from_date = query
        .from_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today - chrono::Duration::days(29));
    let to_date = query
        .to_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today);
    let report = analytics_service::micro_profit_lines(
        &state.db,
        &tenant_id,
        &branch_ids,
        branch_scope,
        from_date,
        to_date,
        query.page.unwrap_or(1),
        query.page_size.unwrap_or(50),
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn report_micro_profit_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<analytics_service::MicroProfitReconciliation> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_scope = query.scope.as_deref().unwrap_or("branch");
    let branch_ids =
        profit_scope_branch_ids(&state, &claims, &tenant_id, &branch_id, branch_scope).await?;
    let today = Utc::now().date_naive();
    let from_date = query
        .from_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today - chrono::Duration::days(29));
    let to_date = query
        .to_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today);
    let report = analytics_service::micro_profit_reconciliation(
        &state.db,
        &tenant_id,
        &branch_ids,
        branch_scope,
        from_date,
        to_date,
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn list_micro_profit_allocation_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<Vec<analytics_service::MicroProfitAllocationRule>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_scope = query.scope.as_deref().unwrap_or("branch");
    let branch_ids =
        profit_scope_branch_ids(&state, &claims, &tenant_id, &branch_id, branch_scope).await?;
    let rules =
        analytics_service::list_micro_profit_allocation_rules(&state.db, &tenant_id, &branch_ids)
            .await?;
    Ok(Json(ApiResponse::ok(rules)))
}

async fn create_micro_profit_allocation_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<analytics_service::MicroProfitAllocationRuleCreateRequest>,
) -> ApiResult<analytics_service::MicroProfitAllocationRule> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rule = analytics_service::create_micro_profit_allocation_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rule)))
}

async fn profit_intelligence_response(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    query: ProfitIntelligenceQuery,
    default_group_by: &str,
) -> ApiResult<analytics_service::ProfitIntelligence> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let branch_scope = query.scope.as_deref().unwrap_or("branch");
    let branch_ids =
        profit_scope_branch_ids(&state, &claims, &tenant_id, &branch_id, branch_scope).await?;
    let today = Utc::now().date_naive();
    let from_date = query
        .from_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today - chrono::Duration::days(29));
    let to_date = query
        .to_date
        .as_deref()
        .map(parse_profit_date)
        .transpose()?
        .unwrap_or(today);
    let result = analytics_service::profit_intelligence(
        &state.db,
        &tenant_id,
        &branch_ids,
        branch_scope,
        from_date,
        to_date,
        query.group_by.as_deref().unwrap_or(default_group_by),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn profit_scope_branch_ids(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    selected_branch_id: &str,
    scope: &str,
) -> Result<Vec<String>, AppError> {
    if scope == "branch" {
        return Ok(vec![selected_branch_id.to_string()]);
    }
    if scope != "tenant" {
        return Err(AppError::validation("scope must be branch or tenant"));
    }
    if !["owner", "admin", "manager", "analyst"]
        .iter()
        .any(|role| claims.role.eq_ignore_ascii_case(role))
    {
        return Err(AppError::forbidden(
            "multi-branch profit access requires owner, admin, manager, or analyst role",
        ));
    }
    let branch_ids = if is_local_env(&state.settings.app_env)
        && state.settings.enable_dev_session
        && claims.sub == "dev-admin"
    {
        branch_service::list(&state.db, tenant_id, None)
            .await?
            .into_iter()
            .filter(|branch| branch.active)
            .map(|branch| branch.id)
            .collect::<Vec<_>>()
    } else {
        let user = auth_repository::find_user_by_id(&state.db, tenant_id, &claims.sub)
            .await
            .map_err(|_| AppError::internal("failed to load profit branch access"))?
            .ok_or_else(|| AppError::unauthenticated("user is not active"))?;
        auth_repository::list_branch_access(&state.db, &user)
            .await
            .map_err(|_| AppError::internal("failed to load profit branch access"))?
            .into_iter()
            .map(|access| access.branch_id)
            .collect::<Vec<_>>()
    };
    let branch_ids = branch_ids
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    Ok(branch_ids)
}

async fn list_profit_governance_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<GovernanceRule>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rules = profit_governance_service::list_rules(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rules)))
}

async fn save_profit_governance_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<GovernanceRuleSaveRequest>,
) -> ApiResult<GovernanceRule> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rule = profit_governance_service::save_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rule)))
}

async fn evaluate_profit_discount(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<DiscountEvaluationRequest>,
) -> ApiResult<GovernanceEvaluationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let decision = profit_governance_service::evaluate_discount(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(decision)))
}

async fn evaluate_profit_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ActionEvaluationRequest>,
) -> ApiResult<GovernanceEvaluationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let decision = profit_governance_service::evaluate_action(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(decision)))
}

async fn list_profit_governance_approvals(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<GovernanceApproval>> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let approvals =
        profit_governance_service::list_approvals(&state.db, &tenant_id, &branch_id, query).await?;
    Ok(Json(ApiResponse::ok(approvals)))
}

async fn approve_profit_governance_decision(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ApprovalReviewRequest>,
) -> ApiResult<GovernanceApproval> {
    review_profit_governance_decision(state, claims, headers, id, payload, "approved").await
}

async fn reject_profit_governance_decision(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ApprovalReviewRequest>,
) -> ApiResult<GovernanceApproval> {
    review_profit_governance_decision(state, claims, headers, id, payload, "rejected").await
}

async fn review_profit_governance_decision(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    approval_id: String,
    payload: ApprovalReviewRequest,
    outcome: &str,
) -> ApiResult<GovernanceApproval> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let approval = profit_governance_service::review_approval(
        &state.db,
        &tenant_id,
        &branch_id,
        &approval_id,
        &claims.sub,
        outcome,
        payload.note,
    )
    .await?;
    Ok(Json(ApiResponse::ok(approval)))
}

async fn list_profit_governance_audit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<GovernanceAuditEvent>> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let events =
        profit_governance_service::list_audit(&state.db, &tenant_id, &branch_id, query).await?;
    Ok(Json(ApiResponse::ok(events)))
}

async fn profit_governance_summary(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<GovernanceSummary> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let summary = profit_governance_service::summary(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(summary)))
}

async fn list_profit_actions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<ProfitAction>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let actions =
        profit_governance_service::list_actions(&state.db, &tenant_id, &branch_id, query).await?;
    Ok(Json(ApiResponse::ok(actions)))
}

async fn create_profit_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ProfitActionCreateRequest>,
) -> ApiResult<ProfitAction> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let action = profit_governance_service::create_action(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(action)))
}

async fn approve_profit_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProfitActionTransitionRequest>,
) -> ApiResult<ProfitAction> {
    transition_profit_action(state, claims, headers, id, payload, "approved").await
}

async fn complete_profit_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProfitActionTransitionRequest>,
) -> ApiResult<ProfitAction> {
    transition_profit_action(state, claims, headers, id, payload, "completed").await
}

async fn dismiss_profit_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProfitActionTransitionRequest>,
) -> ApiResult<ProfitAction> {
    transition_profit_action(state, claims, headers, id, payload, "dismissed").await
}

async fn transition_profit_action(
    state: AppState,
    claims: AuthClaims,
    headers: HeaderMap,
    action_id: String,
    payload: ProfitActionTransitionRequest,
    next_status: &str,
) -> ApiResult<ProfitAction> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let action = profit_governance_service::transition_action(
        &state.db,
        &tenant_id,
        &branch_id,
        &action_id,
        &claims.sub,
        next_status,
        payload.note,
    )
    .await?;
    Ok(Json(ApiResponse::ok(action)))
}

fn ensure_profit_governance_approver(claims: &AuthClaims) -> Result<(), AppError> {
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "only owner, admin, or manager can manage profit governance",
        ))
    }
}

async fn report_appointments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReportRangeQuery>,
) -> ApiResult<Vec<AppointmentGroupRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(200).clamp(1, 500);

    let status = query.status.unwrap_or_default();
    let start_at = match query.start_date {
        Some(raw) => parse_day(&raw, false)?,
        None => Utc::now() - chrono::Duration::days(365),
    };
    let end_at = match query.end_date {
        Some(raw) => parse_day(&raw, true)?,
        None => Utc::now() + chrono::Duration::days(1),
    };

    let rows = sqlx::query_as::<_, (String, String, i64, i64)>(
        r#"
        SELECT to_char(date_trunc('day', start_at), 'YYYY-MM-DD') AS report_date,
               status,
               COUNT(*)::bigint,
               COALESCE(SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 60.0)::bigint, 0)
        FROM appointments
        WHERE tenant_id=$1
          AND branch_id=$2
          AND start_at >= $3
          AND start_at < $4
          AND ($5 = '' OR status = $5)
        GROUP BY report_date, status
        ORDER BY report_date DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at)
    .bind(end_at)
    .bind(status)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment report"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter()
            .map(
                |(report_date, status, count, total_minutes)| AppointmentGroupRecord {
                    report_date,
                    status,
                    count,
                    total_minutes: total_minutes.max(0),
                },
            )
            .collect(),
    )))
}

async fn report_sales(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReportSalesQuery>,
) -> ApiResult<ReportSalesSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default();
    let start_at = match query.start_date {
        Some(raw) => parse_day(&raw, false)?,
        None => Utc::now() - chrono::Duration::days(30),
    };
    let end_at = match query.end_date {
        Some(raw) => parse_day(&raw, true)?,
        None => Utc::now() + chrono::Duration::days(1),
    };

    let rows = sqlx::query_as::<_, SaleRow>(
        r#"
        SELECT id, invoice_number, tenant_id, branch_id, total_paise, paid_paise, status, created_at
        FROM pos_sales
        WHERE tenant_id=$1 AND branch_id=$2
          AND created_at BETWEEN $3 AND $4
          AND ($5 = '' OR status = $5)
        ORDER BY created_at DESC
        LIMIT 200
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at)
    .bind(end_at)
    .bind(status)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sales report"))?;

    let top_invoices = rows
        .iter()
        .map(|row| ReportSalesItem {
            id: row.id.clone(),
            invoice_number: row.invoice_number.clone(),
            tenant_id: row.tenant_id.clone(),
            branch_id: row.branch_id.clone(),
            total_paise: row.total_paise,
            paid_paise: row.paid_paise,
            status: row.status.clone(),
            created_at: row.created_at.to_rfc3339(),
        })
        .collect();

    let total_sales_paise = rows.iter().map(|row| row.total_paise).sum::<i64>();
    let paid_sales_paise = rows.iter().map(|row| row.paid_paise).sum::<i64>();

    Ok(Json(ApiResponse::ok(ReportSalesSummary {
        total_sales_paise,
        paid_sales_paise,
        outstanding_sales_paise: total_sales_paise.saturating_sub(paid_sales_paise),
        top_invoices,
    })))
}

async fn report_invoice_activity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InvoiceReportQuery>,
) -> ApiResult<Vec<InvoiceActivityRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let start_at = query
        .start_date
        .as_deref()
        .map(|raw| parse_day(raw, false))
        .transpose()?
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let end_at = query
        .end_date
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?
        .unwrap_or_else(|| Utc::now() + chrono::Duration::days(1));
    let status = query.status.unwrap_or_default();
    let rows = sqlx::query_as::<_, InvoiceActivityRow>(
        r#"
        SELECT * FROM (
          SELECT ps.id AS invoice_id, ps.invoice_number, pie.event_type AS activity_type, '' AS channel, '' AS recipient, 'recorded' AS status, pie.payload_json AS payload, pie.created_at
            FROM pos_invoice_events pie
            JOIN pos_sales ps ON ps.id=pie.sale_id AND ps.tenant_id=pie.tenant_id AND ps.branch_id=pie.branch_id
           WHERE pie.tenant_id=$1 AND pie.branch_id=$2 AND pie.created_at >= $3 AND pie.created_at < $4 AND ($5='' OR ps.status=$5)
          UNION ALL
          SELECT ps.id AS invoice_id, ps.invoice_number, piah.action AS activity_type, piah.channel, piah.recipient, piah.status, piah.metadata_json AS payload, piah.created_at
            FROM pos_invoice_action_history piah
            JOIN pos_sales ps ON ps.id=piah.sale_id AND ps.tenant_id=piah.tenant_id AND ps.branch_id=piah.branch_id
           WHERE piah.tenant_id=$1 AND piah.branch_id=$2 AND piah.created_at >= $3 AND piah.created_at < $4 AND ($5='' OR ps.status=$5)
        ) activity
        ORDER BY created_at DESC
        LIMIT 500
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(start_at).bind(end_at).bind(status)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice activity"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn report_due_recovery(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InvoiceReportQuery>,
) -> ApiResult<Vec<DueRecoveryRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let start_at = query
        .start_date
        .as_deref()
        .map(|raw| parse_day(raw, false))
        .transpose()?
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let end_at = query
        .end_date
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?
        .unwrap_or_else(|| Utc::now() + chrono::Duration::days(1));
    let rows = sqlx::query_as::<_, DueRecoveryRow>(
        r#"
        SELECT ps.id AS invoice_id, ps.invoice_number, ps.client_id, TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS client_name,
               ps.total_paise, ps.paid_paise, GREATEST(ps.total_paise - ps.paid_paise, 0) AS balance_paise,
               GREATEST(CURRENT_DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE, 0)::INT AS ageing_days,
               COUNT(drf.id)::BIGINT AS follow_up_count, MAX(drf.created_at) AS last_follow_up_at
          FROM pos_sales ps
          LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id
          LEFT JOIN due_recovery_followups drf ON drf.sale_id=ps.id AND drf.tenant_id=ps.tenant_id AND drf.branch_id=ps.branch_id
         WHERE ps.tenant_id=$1 AND ps.branch_id=$2
           AND COALESCE(ps.finalized_at, ps.created_at) >= $3 AND COALESCE(ps.finalized_at, ps.created_at) < $4
           AND ps.status NOT IN ('draft','voided','cancelled')
           AND ps.paid_paise < ps.total_paise
         GROUP BY ps.id, ps.invoice_number, ps.client_id, client_name, ps.total_paise, ps.paid_paise, ps.finalized_at, ps.created_at
         ORDER BY ageing_days DESC, balance_paise DESC
         LIMIT 500
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(start_at).bind(end_at)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load due recovery report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn report_service_trends(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ServiceReportQuery>,
) -> ApiResult<ServiceTrendReport> {
    validate_service_report_range(&query)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, ServiceTrendRow>(
        r#"
        WITH line_cost AS (
          SELECT sale_line_id, COALESCE(SUM(ABS(quantity_delta)::BIGINT * unit_cost_paise),0)::BIGINT AS cost_paise
          FROM inventory_stock_ledger
          WHERE tenant_id=$1 AND branch_id=$2 AND movement_type='sale' AND sale_line_id IS NOT NULL
          GROUP BY sale_line_id
        ), service_lines AS (
          SELECT line.id AS sale_line_id, line.item_id AS service_id, line.item_name AS service_name,
                 COALESCE(service.category,'') AS service_group, line.staff_id,
                 COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'') AS staff_name,
                 sale.id AS sale_id, sale.client_id, COALESCE(sale.finalized_at,sale.created_at) AS sold_at,
                 line.quantity, line.gross_paise, line.discount_paise, line.taxable_paise,
                 line.gst_paise, COALESCE(cost.cost_paise,0)::BIGINT AS product_cost_paise
          FROM pos_sale_lines line
          JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
          LEFT JOIN services service ON service.id=line.item_id AND service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
          LEFT JOIN staff ON staff.id=line.staff_id AND staff.tenant_id=line.tenant_id AND staff.branch_id=line.branch_id
          LEFT JOIN line_cost cost ON cost.sale_line_id=line.id
          WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service'
            AND sale.status NOT IN ('draft','voided','cancelled')
            AND ($3::DATE IS NULL OR COALESCE(sale.finalized_at,sale.created_at)::DATE >= $3)
            AND ($4::DATE IS NULL OR COALESCE(sale.finalized_at,sale.created_at)::DATE <= $4)
            AND ($5='' OR line.item_id=$5) AND ($6='' OR line.staff_id=$6)
            AND ($7='' OR sale.client_id=$7)
            AND ($8='' OR line.item_name ILIKE '%'||$8||'%' OR COALESCE(service.category,'') ILIKE '%'||$8||'%' OR COALESCE(staff.appointment_display_name,'') ILIKE '%'||$8||'%')
        )
        SELECT service_id, service_name, service_group, staff_id, staff_name,
               SUM(quantity)::BIGINT AS quantity_sold, SUM(gross_paise)::BIGINT AS gross_sale_paise,
               SUM(discount_paise)::BIGINT AS discount_paise, SUM(taxable_paise)::BIGINT AS net_sale_paise,
               SUM(gst_paise)::BIGINT AS gst_paise, SUM(product_cost_paise)::BIGINT AS product_cost_paise,
               (SUM(taxable_paise)-SUM(product_cost_paise))::BIGINT AS gross_margin_paise,
               CASE WHEN SUM(taxable_paise)>0 THEN ((SUM(taxable_paise)-SUM(product_cost_paise))*10000/SUM(taxable_paise))::BIGINT ELSE 0 END AS margin_bps,
               COUNT(DISTINCT NULLIF(client_id,''))::BIGINT AS client_count,
               (SELECT COUNT(*)::BIGINT FROM (SELECT repeated.client_id FROM service_lines repeated WHERE repeated.service_id=lines.service_id AND repeated.staff_id=lines.staff_id AND repeated.client_id<>'' GROUP BY repeated.client_id HAVING COUNT(DISTINCT repeated.sale_id)>1) repeat_clients) AS repeat_client_count,
               COUNT(DISTINCT sale_id)::BIGINT AS invoice_count,
               COALESCE((SELECT TO_CHAR(date_trunc('hour',peak.sold_at) AT TIME ZONE 'Asia/Kolkata','HH12:MI AM') FROM service_lines peak WHERE peak.service_id=lines.service_id AND peak.staff_id=lines.staff_id GROUP BY date_trunc('hour',peak.sold_at) ORDER BY COUNT(*) DESC LIMIT 1),'') AS peak_selling_hour,
               MAX(sold_at) AS last_sold_at
        FROM service_lines lines
        GROUP BY service_id,service_name,service_group,staff_id,staff_name
        ORDER BY net_sale_paise DESC, service_name
        LIMIT $9
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(query.date_from)
    .bind(query.date_to)
    .bind(query.service_id.unwrap_or_default())
    .bind(query.staff_id.unwrap_or_default())
    .bind(query.client_id.unwrap_or_default())
    .bind(query.q.unwrap_or_default().trim().to_string())
    .bind(query.limit.unwrap_or(500).clamp(1, 1000))
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load service trends report"))?;
    let summary = service_trend_summary(&rows);
    Ok(Json(ApiResponse::ok(ServiceTrendReport { summary, rows })))
}

async fn report_service_clients(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ServiceReportQuery>,
) -> ApiResult<ServiceClientReport> {
    validate_service_report_range(&query)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, ServiceClientRow>(
        r#"
        SELECT COALESCE(sale.finalized_at,sale.created_at) AS sold_at,
               COALESCE(sale.finalized_at,sale.created_at)::DATE AS business_date,
               COALESCE(service.category,'') AS service_group, line.item_id AS service_id,
               line.item_name AS service_name, sale.client_id,
               COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Walk-in') AS client_name,
               COALESCE(client.phone,'') AS client_phone, line.taxable_paise AS service_price_paise,
               CASE WHEN LOWER(sale.source)='appointment' THEN 'Appointment' ELSE 'Quick Sale' END AS sale_type,
               line.staff_id, COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'') AS staff_name,
               sale.id AS invoice_id, sale.invoice_number
        FROM pos_sale_lines line
        JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
        LEFT JOIN services service ON service.id=line.item_id AND service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
        LEFT JOIN clients client ON client.id=sale.client_id AND client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id
        LEFT JOIN staff ON staff.id=line.staff_id AND staff.tenant_id=line.tenant_id AND staff.branch_id=line.branch_id
        WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service'
          AND sale.status NOT IN ('draft','voided','cancelled')
          AND ($3::DATE IS NULL OR COALESCE(sale.finalized_at,sale.created_at)::DATE >= $3)
          AND ($4::DATE IS NULL OR COALESCE(sale.finalized_at,sale.created_at)::DATE <= $4)
          AND ($5='' OR line.item_id=$5) AND ($6='' OR line.staff_id=$6)
          AND ($7='' OR sale.client_id=$7)
          AND ($8='' OR line.item_name ILIKE '%'||$8||'%' OR COALESCE(service.category,'') ILIKE '%'||$8||'%' OR COALESCE(client.first_name||' '||client.last_name,'') ILIKE '%'||$8||'%' OR COALESCE(client.phone,'') ILIKE '%'||$8||'%' OR sale.invoice_number ILIKE '%'||$8||'%')
        ORDER BY sold_at DESC
        LIMIT $9
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(query.date_from)
    .bind(query.date_to)
    .bind(query.service_id.unwrap_or_default())
    .bind(query.staff_id.unwrap_or_default())
    .bind(query.client_id.unwrap_or_default())
    .bind(query.q.unwrap_or_default().trim().to_string())
    .bind(query.limit.unwrap_or(1000).clamp(1, 1000))
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load service clients report"))?;
    let client_ids = rows
        .iter()
        .filter_map(|row| (!row.client_id.is_empty()).then_some(row.client_id.as_str()))
        .collect::<BTreeSet<_>>();
    let summary = ServiceClientSummary {
        total_clients: client_ids.len() as i64,
        total_service_revenue_paise: rows.iter().map(|row| row.service_price_paise).sum(),
        total_service_rows: rows.len() as i64,
        appointment_rows: rows
            .iter()
            .filter(|row| row.sale_type == "Appointment")
            .count() as i64,
        quick_sale_rows: rows
            .iter()
            .filter(|row| row.sale_type == "Quick Sale")
            .count() as i64,
    };
    Ok(Json(ApiResponse::ok(ServiceClientReport { summary, rows })))
}

fn validate_service_report_range(query: &ServiceReportQuery) -> Result<(), AppError> {
    if query
        .date_from
        .zip(query.date_to)
        .is_some_and(|(from, to)| from > to)
    {
        return Err(AppError::validation("dateFrom cannot be after dateTo"));
    }
    Ok(())
}

fn service_trend_summary(rows: &[ServiceTrendRow]) -> ServiceTrendSummary {
    let quantity: i64 = rows.iter().map(|row| row.quantity_sold).sum();
    let revenue: i64 = rows.iter().map(|row| row.net_sale_paise).sum();
    let margin_ready = rows.iter().filter(|row| row.product_cost_paise > 0);
    ServiceTrendSummary {
        total_services_sold: quantity,
        total_service_revenue_paise: revenue,
        average_service_price_paise: if quantity > 0 { revenue / quantity } else { 0 },
        top_service: rows
            .first()
            .map(|row| row.service_name.clone())
            .unwrap_or_default(),
        highest_margin_service: margin_ready
            .clone()
            .max_by_key(|row| row.margin_bps)
            .map(|row| row.service_name.clone())
            .unwrap_or_default(),
        lowest_margin_service: margin_ready
            .min_by_key(|row| row.margin_bps)
            .map(|row| row.service_name.clone())
            .unwrap_or_default(),
        discount_leakage_paise: rows.iter().map(|row| row.discount_paise).sum(),
        service_gst_collected_paise: rows.iter().map(|row| row.gst_paise).sum(),
    }
}

async fn list_invoice_followups(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<FollowUpRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, FollowUpRow>(
        "SELECT id, sale_id, actor_user_id, action, note, status, created_at FROM due_recovery_followups WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at DESC",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice follow-ups"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_invoice_followup(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<FollowUpWriteRequest>,
) -> ApiResult<FollowUpRow> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let actor = claims.sub;
    let action = payload.action.unwrap_or_else(|| "follow_up".to_string());
    let note = payload.note.unwrap_or_default();
    let status = payload.status.unwrap_or_else(|| "open".to_string());
    let row = sqlx::query_as::<_, FollowUpRow>(
        r#"
        INSERT INTO due_recovery_followups (tenant_id, branch_id, sale_id, actor_user_id, action, note, status)
        SELECT $1,$2,id,$4,$5,$6,$7 FROM pos_sales
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND paid_paise < total_paise AND status NOT IN ('draft','voided','cancelled')
        RETURNING id, sale_id, actor_user_id, action, note, status, created_at
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).bind(actor).bind(action.trim()).bind(note.trim()).bind(status.trim())
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to create invoice follow-up"))?
    .ok_or_else(|| AppError::validation("follow-up requires an outstanding invoice"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn report_payment_modes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InvoiceReportQuery>,
) -> ApiResult<Vec<PaymentModeReportRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let start_at = query
        .start_date
        .as_deref()
        .map(|raw| parse_day(raw, false))
        .transpose()?
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let end_at = query
        .end_date
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?
        .unwrap_or_else(|| Utc::now() + chrono::Duration::days(1));
    let method = query.payment_method.unwrap_or_default();
    let rows = sqlx::query_as::<_, PaymentModeReportRow>(
        r#"
        SELECT pp.method, COUNT(pp.id)::BIGINT AS payment_count, COALESCE(SUM(pp.amount_paise),0)::BIGINT AS amount_paise, COUNT(DISTINCT pp.sale_id)::BIGINT AS invoice_count
          FROM pos_payments pp
          JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id
         WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.created_at >= $3 AND pp.created_at < $4
           AND ($5='' OR pp.method=$5)
         GROUP BY pp.method
         ORDER BY amount_paise DESC
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(start_at).bind(end_at).bind(method)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment mode report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn report_cash_drawer_eod(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReportRangeQuery>,
) -> ApiResult<CashDrawerEodReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let business_date = query
        .start_date
        .as_deref()
        .map(|raw| {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map_err(|_| AppError::validation("date must be in YYYY-MM-DD"))
        })
        .transpose()?
        .unwrap_or_else(|| Utc::now().date_naive());
    let session = sqlx::query_as::<_, (i64, Option<i64>, Option<i64>, String)>(
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM cash_drawer_tills t WHERE t.drawer_session_id=s.id AND t.tenant_id=s.tenant_id AND t.branch_id=s.branch_id) THEN (SELECT COALESCE(SUM(t.opening_cash_paise),0)::BIGINT FROM cash_drawer_tills t WHERE t.drawer_session_id=s.id AND t.tenant_id=s.tenant_id AND t.branch_id=s.branch_id) ELSE s.opening_cash_paise END, s.counted_cash_paise, s.variance_paise, s.status FROM cash_drawer_sessions s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.business_date=$3 ORDER BY s.opened_at DESC LIMIT 1",
    )
    .bind(&tenant_id).bind(&branch_id).bind(business_date)
    .fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load cash drawer session"))?;
    let cash_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(pp.amount_paise),0)::BIGINT FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.method='cash' AND COALESCE(ps.finalized_at, ps.created_at)::DATE=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or(0);
    let movement = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT COALESCE(SUM(CASE WHEN movement_type='cash_in' THEN amount_paise ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN movement_type='cash_out' THEN ABS(amount_paise) ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN movement_type='refund_cash' THEN ABS(amount_paise) ELSE 0 END),0)::BIGINT FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND created_at::DATE=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or((0, 0, 0));
    let payment_modes = sqlx::query_as::<_, PaymentModeReportRow>(
        "SELECT pp.method, COUNT(*)::BIGINT AS payment_count, COALESCE(SUM(pp.amount_paise),0)::BIGINT AS amount_paise, COUNT(DISTINCT pp.sale_id)::BIGINT AS invoice_count FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND COALESCE(ps.finalized_at,ps.created_at)::DATE=$3 GROUP BY pp.method ORDER BY amount_paise DESC",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_all(&state.db).await.unwrap_or_default();
    let deposits = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COALESCE(SUM(d.amount_paise) FILTER (WHERE d.status='confirmed'),0)::BIGINT, COALESCE(SUM(d.amount_paise) FILTER (WHERE d.status='pending'),0)::BIGINT FROM cash_drawer_bank_deposits d JOIN cash_drawer_sessions s ON s.id=d.drawer_session_id AND s.tenant_id=d.tenant_id AND s.branch_id=d.branch_id WHERE d.tenant_id=$1 AND d.branch_id=$2 AND s.business_date=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or((0, 0));
    let reconciliation_exceptions = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM pos_provider_reconciliation_runs WHERE tenant_id=$1 AND branch_id=$2 AND settlement_date=$3 AND status='review_required'",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or(0);
    let (opening, counted, variance, status) =
        session.unwrap_or((0, None, None, "not_opened".to_string()));
    let expected = opening + cash_sales + movement.0 - movement.1 - movement.2;
    Ok(Json(ApiResponse::ok(CashDrawerEodReport {
        business_date,
        opening_cash_paise: opening,
        cash_sales_paise: cash_sales,
        cash_refunds_paise: movement.2,
        cash_in_paise: movement.0,
        cash_out_paise: movement.1,
        expected_cash_paise: expected,
        counted_cash_paise: counted,
        variance_paise: variance.or_else(|| counted.map(|value| value - expected)),
        status,
        payment_modes,
        bank_deposit_paise: deposits.0,
        pending_deposit_paise: deposits.1,
        reconciliation_exceptions,
    })))
}

async fn list_pos_parity_runs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<ParityRunRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, ParityRunRow>(
        "SELECT id, test_case, legacy_payload_json, rust_payload_json, legacy_result_json, rust_result_json, matched, diff_json, created_at FROM pos_parity_runs WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&tenant_id).bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load POS parity runs"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_pos_parity_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ParityRunWriteRequest>,
) -> ApiResult<ParityRunRow> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if payload.test_case.trim().is_empty() {
        return Err(AppError::validation("testCase is required"));
    }
    let row = sqlx::query_as::<_, ParityRunRow>(
        "INSERT INTO pos_parity_runs (tenant_id, branch_id, test_case, legacy_payload_json, rust_payload_json, legacy_result_json, rust_result_json, matched, diff_json) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9::jsonb) RETURNING id, test_case, legacy_payload_json, rust_payload_json, legacy_result_json, rust_result_json, matched, diff_json, created_at",
    )
    .bind(&tenant_id).bind(&branch_id).bind(payload.test_case.trim())
    .bind(payload.legacy_payload.unwrap_or_else(|| serde_json::json!({})).to_string())
    .bind(payload.rust_payload.unwrap_or_else(|| serde_json::json!({})).to_string())
    .bind(payload.legacy_result.unwrap_or_else(|| serde_json::json!({})).to_string())
    .bind(payload.rust_result.unwrap_or_else(|| serde_json::json!({})).to_string())
    .bind(payload.matched.unwrap_or(false))
    .bind(payload.diff.unwrap_or_else(|| serde_json::json!({})).to_string())
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to save POS parity run"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn report_staff_bookings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReportRangeQuery>,
) -> ApiResult<Vec<StaffBookingReportRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, StaffBookingReportRow>(
        "SELECT s.id AS staff_id, COALESCE(NULLIF(s.appointment_display_name, ''), NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), s.employee_code, s.id) AS staff_name, COALESCE(NULLIF(s.job_title, ''), 'Staff') AS staff_type, COUNT(DISTINCT a.id)::BIGINT AS appointment_count, COALESCE(SUM(ps.total_paise), 0)::BIGINT AS appointment_value_paise FROM staff s LEFT JOIN appointments a ON a.tenant_id=s.tenant_id AND a.branch_id=s.branch_id AND a.staff_id=s.id AND ($3::timestamptz IS NULL OR a.start_at >= $3::timestamptz) AND ($4::timestamptz IS NULL OR a.start_at < ($4::date + INTERVAL '1 day')) LEFT JOIN pos_sales ps ON ps.tenant_id=a.tenant_id AND ps.branch_id=a.branch_id AND ps.reference_id=a.id WHERE s.tenant_id=$1 AND s.branch_id=$2 GROUP BY s.id, s.appointment_display_name, s.first_name, s.last_name, s.employee_code, s.job_title ORDER BY appointment_count DESC, staff_name ASC",
    ).bind(&tenant_id).bind(&branch_id).bind(&query.start_date).bind(&query.end_date).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load staff booking report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn report_staff_performance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<ReportStaffPath>,
) -> ApiResult<StaffPerformanceSummary> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = path.staff_id.trim().to_string();
    if staff_id.is_empty() {
        return Err(AppError::validation("staffId is required"));
    }

    let total_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let completed = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status='completed'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let cancelled = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status='cancelled'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let in_service_minutes = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COALESCE(SUM(
          EXTRACT(EPOCH FROM (COALESCE(end_at, NOW()) - start_at)) / 60.0
        )::bigint, 0)
        FROM appointments
        WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status='completed'
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let top_services_row = sqlx::query_scalar::<_, String>(
        r#"
        SELECT service_ids_json
        FROM appointments
        WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
        ORDER BY created_at DESC
        LIMIT 5
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_all(&state.db)
    .await;

    let service_ids = top_services_row
        .unwrap_or_default()
        .into_iter()
        .filter_map(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .flatten()
        .take(5)
        .collect::<Vec<_>>();

    let most_recent_appointment = sqlx::query_scalar::<_, Option<chrono::DateTime<Utc>>>(
        "SELECT MAX(start_at) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .and_then(|value| value)
    .and_then(|value| value.map(|value| value.to_rfc3339()))
    .unwrap_or_else(String::new);

    Ok(Json(ApiResponse::ok(StaffPerformanceSummary {
        staff_id,
        total_appointments,
        completed_appointments: completed,
        cancelled_appointments: cancelled,
        in_service_minutes: in_service_minutes.max(0),
        most_recent_appointment,
        top_services: service_ids,
    })))
}

fn parse_day(raw: &str, inclusive_end: bool) -> Result<chrono::DateTime<Utc>, AppError> {
    let parsed = if raw.is_empty() {
        return Ok(if inclusive_end {
            Utc::now() + chrono::Duration::days(1)
        } else {
            Utc::now() - chrono::Duration::days(365)
        });
    } else {
        NaiveDate::parse_from_str(raw, "%Y-%m-%d")
            .map_err(|_| AppError::validation("date must be in YYYY-MM-DD"))?
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| AppError::validation("invalid date"))?
            .and_utc()
    };
    if inclusive_end {
        Ok(parsed + chrono::Duration::days(1))
    } else {
        Ok(parsed)
    }
}

fn parse_profit_date(raw: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| AppError::validation("date must be in YYYY-MM-DD"))
}

#[cfg(test)]
mod service_report_tests {
    use super::{service_trend_summary, ServiceTrendRow};
    use chrono::Utc;

    fn row(name: &str, quantity: i64, revenue: i64, cost: i64, margin_bps: i64) -> ServiceTrendRow {
        ServiceTrendRow {
            service_id: name.into(),
            service_name: name.into(),
            service_group: "Hair".into(),
            staff_id: "staff".into(),
            staff_name: "Staff".into(),
            quantity_sold: quantity,
            gross_sale_paise: revenue + 100,
            discount_paise: 100,
            net_sale_paise: revenue,
            gst_paise: 180,
            product_cost_paise: cost,
            gross_margin_paise: revenue - cost,
            margin_bps,
            client_count: 1,
            repeat_client_count: 0,
            invoice_count: 1,
            peak_selling_hour: "10:00 AM".into(),
            last_sold_at: Utc::now(),
        }
    }

    #[test]
    fn summarizes_service_revenue_and_margin_rows() {
        let rows = vec![
            row("Hair Cut", 2, 20_000, 5_000, 7_500),
            row("Hair Spa", 1, 15_000, 6_000, 6_000),
        ];
        let summary = service_trend_summary(&rows);
        assert_eq!(summary.total_services_sold, 3);
        assert_eq!(summary.total_service_revenue_paise, 35_000);
        assert_eq!(summary.average_service_price_paise, 11_666);
        assert_eq!(summary.top_service, "Hair Cut");
        assert_eq!(summary.highest_margin_service, "Hair Cut");
        assert_eq!(summary.lowest_margin_service, "Hair Spa");
    }
}
