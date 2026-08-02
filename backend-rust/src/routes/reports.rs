use std::collections::BTreeSet;

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
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
            ProfitAction, ProfitActionCreateRequest, ProfitActionRollbackRequest,
            ProfitActionTransitionRequest,
        },
    },
    repositories::{auth_repository, cash_drawer_repository},
    routes::context::{current_business_date, tenant_branch},
    services::{
        analytics_service, auth_service::AuthClaims, branch_service, profit_governance_service,
        report_export_service, security_service, staff_app_service,
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
        .route(
            "/reports/custom/:id/lifecycle",
            axum::routing::post(update_custom_report_lifecycle),
        )
        .route("/reports/exports", axum::routing::post(queue_report_export))
        .route(
            "/reports/exports/:id",
            axum::routing::get(get_report_export),
        )
        .route(
            "/reports/exports/:id/download",
            axum::routing::get(download_report_export),
        )
        .route("/reports/dashboard", axum::routing::get(report_dashboard))
        .route(
            "/reports/growth-intelligence",
            axum::routing::get(report_growth_intelligence),
        )
        .route(
            "/reports/growth-intelligence/campaign-plans/:key/draft",
            axum::routing::post(draft_growth_campaign_plan),
        )
        .route(
            "/reports/growth-intelligence/staff/:staff_id/coaching-goal",
            axum::routing::post(draft_growth_staff_goal),
        )
        .route(
            "/reports/advanced-summary",
            axum::routing::get(report_advanced_summary),
        )
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
            "/profit-intelligence/copilot/recommendations/:id/feedback",
            axum::routing::post(record_profit_copilot_feedback),
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
            "/profit-intelligence/reconciliation/invoice-repair-queue",
            axum::routing::get(invoice_journal_repair_queue).post(repair_missing_invoice_journals),
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
            "/profit-intelligence/pos-margin-check",
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
            "/profit-intelligence/actions/:id/rollback",
            axum::routing::post(rollback_profit_action),
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
            "/reports/invoices/detailed",
            axum::routing::get(report_detailed_invoices),
        )
        .route(
            "/reports/wallet-ledger",
            axum::routing::get(report_wallet_ledger),
        )
        .route(
            "/reports/payment-collection",
            axum::routing::get(report_payment_collection),
        )
        .route(
            "/reports/invoices/staff-service-discount",
            axum::routing::get(report_staff_service_discount),
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
            "/reports/products/sales",
            axum::routing::get(report_product_sales),
        )
        .route(
            "/reports/products/movements",
            axum::routing::get(report_product_movements),
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
        .route(
            "/reports/staff-service-history",
            axum::routing::get(report_staff_service_history),
        )
}

async fn list_custom_reports(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reports = analytics_service::list_custom_reports(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "reports": reports,
        "options": analytics_service::custom_report_options(can_run_organization_report(&claims))
    }))))
}

async fn preview_custom_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(definition): Json<analytics_service::CustomReportDefinition>,
) -> ApiResult<analytics_service::PivotReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = analytics_service::preview_custom_report(
        &state.db,
        &tenant_id,
        &branch_id,
        &definition,
        can_run_organization_report(&claims),
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn queue_report_export(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(request): Json<report_export_service::ExportRequest>,
) -> Result<
    (
        StatusCode,
        Json<ApiResponse<report_export_service::ExportJobView>>,
    ),
    AppError,
> {
    if !can_run_organization_report(&claims) {
        return Err(AppError::forbidden(
            "report export requires an owner or admin role",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let job = report_export_service::create(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        idempotency_key,
        request,
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(ApiResponse::ok(job.view()))))
}

async fn get_report_export(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<report_export_service::ExportJobView> {
    if !can_run_organization_report(&claims) {
        return Err(AppError::forbidden(
            "report export requires an owner or admin role",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let job = report_export_service::get(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(job.view())))
}

async fn download_report_export(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    if !can_run_organization_report(&claims) {
        return Err(AppError::forbidden(
            "report export requires an owner or admin role",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let job = report_export_service::get(&state.db, &tenant_id, &branch_id, &id).await?;
    if job.status != "completed" {
        return Err(AppError::conflict("report export is not completed"));
    }
    let bytes = job
        .output_bytes
        .ok_or_else(|| AppError::not_found("report export output has expired"))?;
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&job.content_type)
            .map_err(|_| AppError::internal("invalid report export content type"))?,
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", job.file_name))
            .map_err(|_| AppError::internal("invalid report export filename"))?,
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok(response)
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
        can_run_organization_report(&claims),
        request,
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn run_custom_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<analytics_service::PivotReport> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = analytics_service::run_saved_custom_report(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        can_run_organization_report(&claims),
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn update_custom_report_lifecycle(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<analytics_service::CustomReportLifecycleRequest>,
) -> ApiResult<analytics_service::CustomReportView> {
    require_custom_report_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = analytics_service::update_custom_report_lifecycle(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &id,
        request,
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

fn require_custom_report_manage(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "super-admin" | "superadmin"
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "custom report management permission is required",
        ))
    }
}

fn can_run_organization_report(claims: &AuthClaims) -> bool {
    matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "super-admin" | "superadmin"
    )
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
struct StaffServiceHistoryQuery {
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    staff_id: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    q: Option<String>,
    status: Option<String>,
    service: Option<String>,
    department: Option<String>,
    sort: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSalesQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedReportSummary {
    pub invoice_count: i64,
    pub revenue_paise: i64,
    pub paid_paise: i64,
    pub due_paise: i64,
    pub discount_paise: i64,
    pub gst_paise: i64,
    pub product_revenue_paise: i64,
    pub service_revenue_paise: i64,
    pub membership_revenue_paise: i64,
    pub product_quantity: i64,
    pub stock_value_paise: i64,
    pub wallet_credit_paise: i64,
    pub wallet_debit_paise: i64,
    pub staff_count: i64,
    pub active_days: i64,
    pub average_daily_revenue_paise: i64,
    pub deleted_invoice_count: i64,
    pub staff_sales_paise: i64,
    pub package_revenue_paise: i64,
    pub appointment_count: i64,
    pub reward_points: i64,
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
    pub dimension: Option<String>,
    pub entity_id: Option<String>,
    pub view: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReportQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub payment_method: Option<String>,
    pub recovery: Option<String>,
    pub client_id: Option<String>,
    pub staff_id: Option<String>,
    pub q: Option<String>,
    pub ageing_bucket: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletLedgerQuery {
    #[serde(alias = "startDate")]
    pub date_from: Option<String>,
    #[serde(alias = "endDate")]
    pub date_to: Option<String>,
    pub client_id: Option<String>,
    pub transaction_type: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCollectionQuery {
    #[serde(alias = "startDate")]
    pub date_from: Option<String>,
    #[serde(alias = "endDate")]
    pub date_to: Option<String>,
    pub client_id: Option<String>,
    pub payment_method: Option<String>,
    pub collection_timing: Option<String>,
    pub q: Option<String>,
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
pub struct ProductReportQuery {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub product_id: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailedInvoiceQuery {
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub client_id: Option<String>,
    pub staff_id: Option<String>,
    pub service_id: Option<String>,
    pub product_id: Option<String>,
    pub payment_method: Option<String>,
    pub status: Option<String>,
    pub q: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpWriteRequest {
    pub action: Option<String>,
    pub note: Option<String>,
    pub status: Option<String>,
    pub assigned_manager_id: Option<String>,
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
    pub business_date: NaiveDate,
    pub unpaid_at: chrono::DateTime<Utc>,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub service_names: String,
    pub staff_names: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub original_due_paise: i64,
    pub received_due_paise: i64,
    pub balance_paise: i64,
    pub ageing_days: i32,
    pub ageing_bucket: String,
    pub recovery_days: Option<i32>,
    pub recovered: bool,
    pub full_paid_at: Option<chrono::DateTime<Utc>>,
    pub payment_modes: String,
    pub payment_references: String,
    pub received_by: String,
    pub recovery_payment_history: Value,
    pub fifo_allocations: Value,
    pub follow_up_count: i64,
    pub last_follow_up_at: Option<chrono::DateTime<Utc>>,
    pub last_payment_at: Option<chrono::DateTime<Utc>>,
    pub recovery_manager_id: String,
    pub recovery_manager_name: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WalletLedgerRow {
    pub transaction_id: String,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub created_at: chrono::DateTime<Utc>,
    pub transaction_type: String,
    pub direction: String,
    pub credit_paise: i64,
    pub debit_paise: i64,
    pub delta_paise: i64,
    pub opening_balance_paise: i64,
    pub closing_balance_paise: i64,
    pub reference_type: String,
    pub reference_id: String,
    pub invoice_number: String,
    pub notes: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WalletLedgerSummary {
    pub transaction_count: i64,
    pub client_count: i64,
    pub credit_paise: i64,
    pub debit_paise: i64,
    pub net_movement_paise: i64,
    pub opening_balance_paise: i64,
    pub closing_balance_paise: i64,
    pub current_liability_paise: i64,
    pub clients_with_balance: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletLedgerResponse {
    pub summary: WalletLedgerSummary,
    pub rows: Vec<WalletLedgerRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCollectionRow {
    pub payment_id: String,
    pub invoice_id: String,
    pub invoice_number: String,
    pub business_date: NaiveDate,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub payment_method: String,
    pub method_group: String,
    pub amount_paise: i64,
    pub method_reference: String,
    pub label: String,
    pub notes: String,
    pub paid_at: chrono::DateTime<Utc>,
    pub collection_timing: String,
    pub received_by: String,
    pub split_payment_count: i64,
    pub split_methods: String,
    pub invoice_total_paise: i64,
    pub invoice_paid_paise: i64,
    pub invoice_due_paise: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCollectionSummary {
    pub payment_count: i64,
    pub invoice_count: i64,
    pub total_paise: i64,
    pub invoice_time_paise: i64,
    pub due_receipt_paise: i64,
    pub cash_paise: i64,
    pub upi_paise: i64,
    pub card_paise: i64,
    pub wallet_paise: i64,
    pub gift_card_paise: i64,
    pub online_paise: i64,
    pub other_paise: i64,
    pub split_invoice_count: i64,
    pub reference_missing_count: i64,
    pub received_by_missing_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCollectionResponse {
    pub summary: PaymentCollectionSummary,
    pub rows: Vec<PaymentCollectionRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffServiceDiscountRow {
    pub invoice_id: String,
    pub invoice_number: String,
    pub business_date: NaiveDate,
    pub client_id: String,
    pub client_name: String,
    pub service_id: String,
    pub service_name: String,
    pub staff_id: String,
    pub staff_name: String,
    pub split_percent: i32,
    pub quantity: i64,
    pub gross_paise: i64,
    pub final_sale_paise: i64,
    pub manual_discount_paise: i64,
    pub coupon_discount_paise: i64,
    pub membership_discount_paise: i64,
    pub total_discount_paise: i64,
    pub discount_bps: i64,
    pub approval_status: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffServiceDiscountSummary {
    pub row_count: i64,
    pub staff_count: i64,
    pub service_count: i64,
    pub quantity: i64,
    pub gross_paise: i64,
    pub final_sale_paise: i64,
    pub manual_discount_paise: i64,
    pub coupon_discount_paise: i64,
    pub membership_discount_paise: i64,
    pub total_discount_paise: i64,
    pub average_discount_bps: i64,
    pub pending_approval_count: i64,
    pub approved_count: i64,
    pub rejected_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffServiceDiscountReport {
    pub summary: StaffServiceDiscountSummary,
    pub rows: Vec<StaffServiceDiscountRow>,
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
pub struct DetailedInvoiceRow {
    pub invoice_id: String,
    pub invoice_number: String,
    pub business_date: NaiveDate,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub line_id: String,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub staff_name: String,
    pub quantity: i64,
    pub unit_price_paise: i64,
    pub gross_paise: i64,
    pub discount_paise: i64,
    pub discount_type: String,
    pub taxable_paise: i64,
    pub gst_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub line_total_paise: i64,
    pub invoice_subtotal_paise: i64,
    pub bill_discount_paise: i64,
    pub coupon_code: String,
    pub coupon_discount_paise: i64,
    pub invoice_discount_paise: i64,
    pub invoice_tax_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
    pub invoice_total_paise: i64,
    pub paid_paise: i64,
    pub due_paise: i64,
    pub payment_modes: String,
    pub payment_status: String,
    pub invoice_status: String,
    pub source: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DetailedInvoiceSummary {
    pub invoice_count: i64,
    pub line_count: i64,
    pub gross_paise: i64,
    pub discount_paise: i64,
    pub gst_paise: i64,
    pub paid_paise: i64,
    pub due_paise: i64,
    pub wallet_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailedInvoiceReport {
    pub summary: DetailedInvoiceSummary,
    pub rows: Vec<DetailedInvoiceRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProductSalesRow {
    pub product_id: String,
    pub product_name: String,
    pub category: String,
    pub sku: String,
    pub quantity_sold: i64,
    pub gross_sale_paise: i64,
    pub discount_paise: i64,
    pub net_sale_paise: i64,
    pub gst_paise: i64,
    pub product_cost_paise: i64,
    pub gross_margin_paise: i64,
    pub margin_bps: i64,
    pub client_count: i64,
    pub invoice_count: i64,
    pub last_sold_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSalesSummary {
    pub total_products_sold: i64,
    pub total_product_revenue_paise: i64,
    pub average_product_price_paise: i64,
    pub top_product: String,
    pub discount_paise: i64,
    pub gst_collected_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSalesReport {
    pub summary: ProductSalesSummary,
    pub rows: Vec<ProductSalesRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProductMovementRow {
    pub product_id: String,
    pub product_name: String,
    pub category: String,
    pub sku: String,
    pub current_stock: i64,
    pub sold_quantity: i64,
    pub returned_quantity: i64,
    pub purchased_quantity: i64,
    pub transfer_out_quantity: i64,
    pub transfer_in_quantity: i64,
    pub adjustment_quantity: i64,
    pub consumed_quantity: i64,
    pub current_stock_value_paise: i64,
    pub last_movement_at: Option<chrono::DateTime<Utc>>,
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
    pub assigned_manager_id: String,
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
    pub expected_cash_paise: Option<i64>,
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
            id: "advanced-business",
            title: "Advanced Business Report",
            category: "Sales & Finance",
            description: "Financial, product, stock, GST, discount, wallet and membership summary.",
            icon: "dashboard",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "financial-summary",
            title: "Financial Summary",
            category: "Sales & Finance",
            description: "Revenue, collection, due, GST and discount summary.",
            icon: "balance",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "daily-revenue",
            title: "Daily Revenue",
            category: "Sales & Finance",
            description: "Daily revenue and active business-day performance.",
            icon: "sales",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "daily-sheet",
            title: "Daily Sheet",
            category: "Sales & Finance",
            description: "Daily financial control values for the selected period.",
            icon: "cash",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "deleted-invoices",
            title: "Deleted Invoices",
            category: "Sales & Finance",
            description: "Cancelled and voided invoice count for the selected period.",
            icon: "invoice",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "gst-summary",
            title: "GST Summary",
            category: "Sales & Finance",
            description: "GST collected from completed sales.",
            icon: "payment",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "discount-summary",
            title: "Sales Discount",
            category: "Sales & Finance",
            description: "Discount total across completed sales.",
            icon: "recovery",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "staff-sales",
            title: "Staff Sales",
            category: "Staff",
            description: "Sales attributed to staff during the selected period.",
            icon: "staff",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "wallet-ledger",
            title: "Wallet Ledger",
            category: "Customer",
            description: "Wallet credit and redemption totals.",
            icon: "payment",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "rewards-loyalty",
            title: "Rewards & Loyalty",
            category: "Customer",
            description: "Reward points movement for the selected period.",
            icon: "clients",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "membership-sales",
            title: "Membership Sales",
            category: "Customer",
            description: "Membership sales revenue in the selected period.",
            icon: "balance",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "package-sales",
            title: "Package Sales",
            category: "Packages",
            description: "Package sales revenue in the selected period.",
            icon: "balance",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "tips-payout",
            title: "Tips & Payout",
            category: "Staff",
            description: "Staff payout reporting surface.",
            icon: "staff",
            path: "/reports/advanced-summary",
        },
        ReportCatalogItem {
            id: "message-history",
            title: "Message History",
            category: "Customer",
            description: "Message reporting surface.",
            icon: "invoice",
            path: "/reports/advanced-summary",
        },
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
            id: "wallet-ledger",
            title: "Wallet Ledger",
            category: "Sales & Finance",
            description: "Client wallet credits, redemptions, references and liability.",
            icon: "wallet",
            path: "/reports/wallet-ledger",
        },
        ReportCatalogItem {
            id: "payment-collection",
            title: "Payment Collection",
            category: "Sales & Finance",
            description: "Cash, UPI, card, wallet, gift card and online collection reconciliation.",
            icon: "payment",
            path: "/reports/payment-collection",
        },
        ReportCatalogItem {
            id: "staff-service-discount",
            title: "Staff Service Discount",
            category: "Staff",
            description: "Staff-service sales, split attribution, discounts and approval status.",
            icon: "staff",
            path: "/reports/invoices/staff-service-discount",
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
            id: "product-sales",
            title: "Product Sales",
            category: "Sales & Finance",
            description: "Product revenue, quantity, discount, GST, cost and margin.",
            icon: "product",
            path: "/reports/products/sales",
        },
        ReportCatalogItem {
            id: "product-movements",
            title: "Product Stock Movement",
            category: "Inventory",
            description: "Product sales, returns, purchases, transfers and current stock.",
            icon: "inventory",
            path: "/reports/products/movements",
        },
        ReportCatalogItem {
            id: "inventory-current-stock",
            title: "Current Inventory",
            category: "Inventory",
            description: "Current on-hand stock, cost, status and reorder levels.",
            icon: "inventory",
            path: "/inventory?tab=products",
        },
        ReportCatalogItem {
            id: "inventory-ledger",
            title: "Inventory Stock Ledger",
            category: "Inventory",
            description: "Immutable product movements with source, cost and batch evidence.",
            icon: "inventory",
            path: "/inventory?tab=ledger",
        },
        ReportCatalogItem {
            id: "inventory-consumption",
            title: "Inventory Consumption",
            category: "Inventory",
            description: "Projected and actual usage by product, service, staff and client.",
            icon: "inventory",
            path: "/inventory/backbar-consumption",
        },
        ReportCatalogItem {
            id: "inventory-valuation",
            title: "Inventory Valuation",
            category: "Inventory",
            description: "Weighted-average or FIFO on-hand valuation and cost exceptions.",
            icon: "inventory",
            path: "/inventory?tab=valuation",
        },
        ReportCatalogItem {
            id: "inventory-ageing",
            title: "Inventory Ageing",
            category: "Inventory",
            description: "Active batch age, quantity, value and ageing bucket.",
            icon: "inventory",
            path: "/inventory?tab=reports&report=ageing",
        },
        ReportCatalogItem {
            id: "inventory-near-expiry",
            title: "Near-expiry Inventory",
            category: "Inventory",
            description: "Expired and near-expiry batches with quantity and risk value.",
            icon: "inventory",
            path: "/inventory?tab=reports&report=expiry",
        },
        ReportCatalogItem {
            id: "inventory-batch-traceability",
            title: "Batch Traceability",
            category: "Inventory",
            description: "Batch-linked receipts, consumption, transfers, returns and adjustments.",
            icon: "inventory",
            path: "/inventory?tab=reports&report=traceability",
        },
        ReportCatalogItem {
            id: "inventory-audit-deviation",
            title: "Inventory Audit Deviation",
            category: "Inventory",
            description: "Expected, counted and approved stock variances with reasons.",
            icon: "inventory",
            path: "/inventory?tab=reports&report=variance",
        },
        ReportCatalogItem {
            id: "inventory-supplier-performance",
            title: "Inventory Supplier Performance",
            category: "Inventory",
            description: "Purchase, delivery, fill-rate, return and expiry-risk evidence.",
            icon: "inventory",
            path: "/inventory?tab=reports&report=suppliers",
        },
        ReportCatalogItem {
            id: "inventory-purchases",
            title: "Inventory Purchase History",
            category: "Inventory",
            description: "Purchase orders, receiving history, landed cost and supplier bills.",
            icon: "inventory",
            path: "/inventory?tab=orders",
        },
        ReportCatalogItem {
            id: "inventory-transfers",
            title: "Inventory Transfer History",
            category: "Inventory",
            description: "Branch transfers, shipments, receipts, returns and mismatches.",
            icon: "inventory",
            path: "/inventory?tab=transfers",
        },
        ReportCatalogItem {
            id: "inventory-returns",
            title: "Inventory Returns and Discards",
            category: "Inventory",
            description: "Purchase returns, quarantine release, restock and discard evidence.",
            icon: "inventory",
            path: "/inventory?tab=returns",
        },
        ReportCatalogItem {
            id: "inventory-low-stock",
            title: "Low-stock Inventory",
            category: "Inventory",
            description: "Low-stock alerts, suggested quantity, priority and forecast value.",
            icon: "inventory",
            path: "/inventory?tab=reorder",
        },
        ReportCatalogItem {
            id: "inventory-controls",
            title: "Inventory Exceptions",
            category: "Inventory",
            description: "Negative stock, dead stock, expiry, adjustments and control exceptions.",
            icon: "inventory",
            path: "/inventory/advanced-controls",
        },
        ReportCatalogItem {
            id: "inventory-product-360",
            title: "Inventory Product 360",
            category: "Inventory",
            description: "Product stock buckets, branches, batches, clients, kits and full ledger.",
            icon: "inventory",
            path: "/inventory?tab=products",
        },
        ReportCatalogItem {
            id: "inventory-gl-reconciliation",
            title: "Inventory versus GL",
            category: "Inventory",
            description: "Inventory valuation matched to the Inventory Asset general ledger.",
            icon: "balance",
            path: "/inventory/gl-reconciliation",
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
    let today = current_business_date();

    let total_appointments = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load total appointments"))
    };

    let today_appointments = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(today)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load today appointments"))
    };

    let open_appointments = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('booked','confirmed','arrived','waiting','in-service')",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load open appointments"))
    };

    let total_clients = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load total clients"))
    };

    let total_services = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load total services"))
    };

    let today_sales = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(total_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND COALESCE(business_date,(created_at AT TIME ZONE 'Asia/Kolkata')::DATE)=$3 AND status NOT IN ('draft','voided','cancelled','refunded')",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(today)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load today sales"))
    };

    let open_sales = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('open','partial')",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load open sales"))
    };

    let completed_recent = async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status='completed' AND updated_at >= NOW() - interval '7 days'",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load recent completed appointments"))
    };

    let (
        total_appointments,
        today_appointments,
        open_appointments,
        total_clients,
        total_services,
        today_sales,
        open_sales,
        completed_recent,
    ) = tokio::join!(
        total_appointments,
        today_appointments,
        open_appointments,
        total_clients,
        total_services,
        today_sales,
        open_sales,
        completed_recent
    );

    Ok(Json(ApiResponse::ok(ReportDashboard {
        total_appointments: total_appointments?,
        today_appointments: today_appointments?,
        open_appointments: open_appointments?,
        total_clients: total_clients?,
        total_services: total_services?,
        today_sales_paise: today_sales?,
        open_sales: open_sales?,
        recent_completed_appointments: completed_recent?,
    })))
}

async fn report_growth_intelligence(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> ApiResult<crate::services::growth_intelligence_service::GrowthIntelligence> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let report = crate::services::growth_intelligence_service::command_center(
        &state.db, &tenant_id, &branch_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(report)))
}

async fn draft_growth_campaign_plan(
    headers: HeaderMap,
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<crate::repositories::whatsapp_repository::WhatsAppCampaignPlan> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let actor = headers
        .get("x-user-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .unwrap_or("system");
    let row = crate::services::growth_intelligence_service::draft_campaign_plan(
        &state.db, &tenant_id, &branch_id, actor, &key,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn draft_growth_staff_goal(
    headers: HeaderMap,
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    Path(staff_id): Path<String>,
    Json(request): Json<GrowthStaffGoalRequest>,
) -> ApiResult<crate::repositories::staff_enterprise_repository::CoachingGoalRecord> {
    require_growth_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = crate::services::growth_intelligence_service::draft_staff_goal(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &staff_id,
        request.opportunity_key.as_deref().unwrap_or(""),
    )
    .await?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "staff.revenue_opportunity.activated",
        serde_json::json!({"staffId":staff_id,"goalId":row.id,"opportunityKey":row.goal_type}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrowthStaffGoalRequest {
    opportunity_key: Option<String>,
}

fn require_growth_manage(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "super-admin" | "superadmin"
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "revenue opportunity management permission is required",
        ))
    }
}
async fn report_advanced_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ReportSalesQuery>,
) -> ApiResult<AdvancedReportSummary> {
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
    let row = sqlx::query_as::<_, AdvancedReportSummary>(
        r#"
        SELECT
          (SELECT COUNT(*)::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) invoice_count,
          (SELECT COALESCE(SUM(total_paise),0)::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) revenue_paise,
          (SELECT COALESCE(SUM(paid_paise),0)::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) paid_paise,
          (SELECT COALESCE(SUM(GREATEST(total_paise-paid_paise,0)),0)::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) due_paise,
          (SELECT COALESCE(SUM(l.discount_paise),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) discount_paise,
          (SELECT COALESCE(SUM(l.gst_paise),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) gst_paise,
          (SELECT COALESCE(SUM(l.taxable_paise) FILTER (WHERE l.line_type='product'),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) product_revenue_paise,
          (SELECT COALESCE(SUM(l.taxable_paise) FILTER (WHERE l.line_type='service'),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) service_revenue_paise,
          (SELECT COALESCE(SUM(l.taxable_paise) FILTER (WHERE l.line_type='membership'),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) membership_revenue_paise,
          (SELECT COALESCE(SUM(l.quantity) FILTER (WHERE l.line_type='product'),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) product_quantity,
          (SELECT COALESCE(SUM(stock_quantity::BIGINT*unit_cost_paise),0)::BIGINT FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2) stock_value_paise,
          (SELECT COALESCE(SUM(GREATEST(delta_paise,0)),0)::BIGINT FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=$3 AND created_at<$4) wallet_credit_paise,
          (SELECT COALESCE(SUM(ABS(LEAST(delta_paise,0))),0)::BIGINT FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=$3 AND created_at<$4) wallet_debit_paise,
          (SELECT COUNT(*)::BIGINT FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=true) staff_count,
          (SELECT COUNT(DISTINCT COALESCE(finalized_at,created_at)::DATE)::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) active_days,
          (SELECT CASE WHEN COUNT(DISTINCT COALESCE(finalized_at,created_at)::DATE)>0 THEN SUM(total_paise)/COUNT(DISTINCT COALESCE(finalized_at,created_at)::DATE) ELSE 0 END::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) average_daily_revenue_paise,
          (SELECT COUNT(*)::BIGINT FROM pos_sales s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.status IN ('voided','cancelled') AND s.created_at>=$3 AND s.created_at<$4) deleted_invoice_count,
          (SELECT COALESCE(SUM(l.taxable_paise),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND l.staff_id<>'' AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) staff_sales_paise,
          (SELECT COALESCE(SUM(l.taxable_paise) FILTER (WHERE l.line_type='package'),0)::BIGINT FROM pos_sale_lines l JOIN pos_sales s ON s.id=l.sale_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND s.status NOT IN ('draft','voided','cancelled') AND COALESCE(s.finalized_at,s.created_at)>=$3 AND COALESCE(s.finalized_at,s.created_at)<$4) package_revenue_paise,
          (SELECT COUNT(*)::BIGINT FROM appointments a WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.start_at>=$3 AND a.start_at<$4) appointment_count,
          (SELECT COALESCE(SUM(points),0)::BIGINT FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=$3 AND created_at<$4) reward_points
        "#,
    ).bind(&tenant_id).bind(&branch_id).bind(start_at).bind(end_at).fetch_one(&state.db).await
    .map_err(|_| AppError::internal("failed to load advanced report"))?;
    Ok(Json(ApiResponse::ok(row)))
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
    let view = query.view.as_deref().unwrap_or("overview");
    let report = analytics_service::advanced_profit_intelligence_for_view(
        &state.db,
        &tenant_id,
        &branch_ids,
        branch_scope,
        from_date,
        to_date,
        view,
    )
    .await?;
    let report = if view == "copilot" {
        analytics_service::enhance_profit_copilot(
            &state.db,
            &state.settings,
            &tenant_id,
            &branch_ids,
            report,
        )
        .await
    } else {
        report
    };
    Ok(Json(ApiResponse::ok(report)))
}

async fn record_profit_copilot_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<analytics_service::ProfitCopilotFeedbackRequest>,
) -> ApiResult<analytics_service::ProfitCopilotFeedback> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let feedback = analytics_service::record_profit_copilot_feedback(
        &state.db,
        &tenant_id,
        &id,
        &claims.sub,
        payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(feedback)))
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
        query.dimension.as_deref().unwrap_or(""),
        query.entity_id.as_deref().unwrap_or(""),
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

async fn invoice_journal_repair_queue(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<Vec<analytics_service::InvoiceJournalRepairItem>> {
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
    let rows = analytics_service::invoice_journal_repair_queue(
        &state.db,
        &tenant_id,
        &branch_ids,
        from_date,
        to_date,
        query.page_size.unwrap_or(100),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn repair_missing_invoice_journals(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ProfitIntelligenceQuery>,
) -> ApiResult<analytics_service::InvoiceJournalRepairRun> {
    ensure_profit_governance_approver(&claims)?;
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
    let result = analytics_service::repair_missing_invoice_journals(
        &state.db,
        &tenant_id,
        &branch_ids,
        &claims.sub,
        from_date,
        to_date,
        query.page_size.unwrap_or(100),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
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
    ensure_profit_governance_approver(&claims)?;
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

async fn rollback_profit_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ProfitActionRollbackRequest>,
) -> ApiResult<ProfitAction> {
    ensure_profit_governance_approver(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        profit_governance_service::rollback_action(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            &claims.sub,
            payload.note,
        )
        .await?,
    )))
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
        payload.realized_impact_paise,
        payload.evidence,
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
        SELECT (start_at AT TIME ZONE 'Asia/Kolkata')::DATE::TEXT AS report_date,
               status,
               COUNT(*)::bigint,
               COALESCE(SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 60.0)::bigint, 0)
        FROM appointments
        WHERE tenant_id=$1
          AND branch_id=$2
          AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE >= $3::DATE
          AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE < $4::DATE
          AND ($5 = '' OR status = $5)
        GROUP BY report_date, status
        ORDER BY report_date DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at.clone())
    .bind(end_at.clone())
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

    let totals = sqlx::query_as::<_, (i64, i64)>(
        r#"
        SELECT COALESCE(SUM(total_paise),0)::BIGINT, COALESCE(SUM(paid_paise),0)::BIGINT
        FROM pos_sales
        WHERE tenant_id=$1 AND branch_id=$2
          AND COALESCE(business_date,(created_at AT TIME ZONE 'Asia/Kolkata')::DATE) >= $3::DATE
          AND COALESCE(business_date,(created_at AT TIME ZONE 'Asia/Kolkata')::DATE) < $4::DATE
          AND (($5 = '' AND status NOT IN ('draft','voided','cancelled','refunded')) OR ($5 <> '' AND status = $5))
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at.clone())
    .bind(end_at.clone())
    .bind(&status)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sales report totals"))?;

    let rows = sqlx::query_as::<_, SaleRow>(
        r#"
        SELECT id, invoice_number, tenant_id, branch_id, total_paise, paid_paise, status, created_at
        FROM pos_sales
        WHERE tenant_id=$1 AND branch_id=$2
          AND COALESCE(business_date,(created_at AT TIME ZONE 'Asia/Kolkata')::DATE) >= $3::DATE
          AND COALESCE(business_date,(created_at AT TIME ZONE 'Asia/Kolkata')::DATE) < $4::DATE
          AND (($5 = '' AND status NOT IN ('draft','voided','cancelled','refunded')) OR ($5 <> '' AND status = $5))
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

    let (total_sales_paise, paid_sales_paise) = totals;

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
        .transpose()?;
    let end_at = query
        .end_date
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?;
    let recovery = query
        .recovery
        .unwrap_or_else(|| "due".to_string())
        .trim()
        .to_ascii_lowercase();
    let recovery = if recovery == "paid" {
        "recovered".to_string()
    } else {
        recovery
    };
    if !matches!(recovery.as_str(), "due" | "recovered" | "all") {
        return Err(AppError::validation(
            "recovery must be due, recovered, or all",
        ));
    }
    let client_id = query.client_id.unwrap_or_default().trim().to_string();
    let staff_id = query.staff_id.unwrap_or_default().trim().to_string();
    let q = query.q.unwrap_or_default().trim().to_string();
    let ageing_bucket = query.ageing_bucket.unwrap_or_default().trim().to_string();
    let payment_method = query
        .payment_method
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !ageing_bucket.is_empty()
        && !matches!(
            ageing_bucket.as_str(),
            "0-7" | "8-15" | "16-30" | "31-60" | "61+"
        )
    {
        return Err(AppError::validation("invalid ageingBucket"));
    }
    let rows = sqlx::query_as::<_, DueRecoveryRow>(
        r#"
        WITH latest_assignment AS (
          SELECT DISTINCT ON (sale_id) sale_id, assigned_manager_id
            FROM due_recovery_followups
           WHERE tenant_id=$1 AND branch_id=$2 AND assigned_manager_id<>''
           ORDER BY sale_id, created_at DESC
        ), payment_summary AS (
          SELECT payment.tenant_id, payment.branch_id, payment.sale_id,
                 MAX(payment.paid_at) AS last_payment_at,
                 COALESCE(SUM(CASE WHEN sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at THEN payment.amount_paise ELSE 0 END),0)::BIGINT AS received_due_paise,
                 COALESCE(STRING_AGG(DISTINCT payment.method, ', ') FILTER (WHERE sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at), '') AS payment_modes,
                 COALESCE(STRING_AGG(DISTINCT NULLIF(payment.method_reference,''), ', ') FILTER (WHERE sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at), '') AS payment_references,
                 COALESCE(STRING_AGG(DISTINCT NULLIF(receipt.received_by_user_id,''), ', ') FILTER (WHERE sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at), '') AS received_by,
                 COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                   'paymentId', payment.id,
                   'paidAt', payment.paid_at,
                   'amountPaise', payment.amount_paise,
                   'paymentMode', payment.method,
                   'reference', payment.method_reference,
                   'receivedBy', COALESCE(receipt.received_by_user_id,'')
                 ) ORDER BY payment.paid_at, payment.id) FILTER (WHERE sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at), '[]'::JSONB) AS recovery_payment_history
            FROM pos_payments payment
            JOIN pos_sales sale ON sale.id=payment.sale_id AND sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id
            LEFT JOIN LATERAL (
              SELECT due_receipt.received_by_user_id
                FROM pos_client_due_receipts due_receipt
                CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(due_receipt.allocations_json) due_allocation(value)
               WHERE due_receipt.tenant_id=payment.tenant_id AND due_receipt.branch_id=payment.branch_id
                 AND due_allocation.value->>'paymentId'=payment.id
               ORDER BY COALESCE(due_receipt.paid_at,due_receipt.created_at), due_receipt.id
               LIMIT 1
            ) receipt ON TRUE
           WHERE payment.tenant_id=$1 AND payment.branch_id=$2
           GROUP BY payment.tenant_id, payment.branch_id, payment.sale_id
        ), line_summary AS (
          SELECT line.tenant_id, line.branch_id, line.sale_id,
                 COALESCE(STRING_AGG(DISTINCT line.item_name, ', ') FILTER (WHERE line.line_type='service'), 'No service') AS service_names,
                 COALESCE(STRING_AGG(DISTINCT COALESCE(NULLIF((
                   SELECT STRING_AGG(DISTINCT COALESCE(NULLIF(split.value->>'staffName',''), NULLIF(split_staff.appointment_display_name,''), NULLIF(BTRIM(CONCAT_WS(' ',split_staff.first_name,split_staff.last_name)),''), split.value->>'staffId'), ', ')
                     FROM JSONB_ARRAY_ELEMENTS(COALESCE(line.staff_splits,'[]'::JSONB)) split(value)
                     LEFT JOIN staff split_staff ON split_staff.tenant_id=line.tenant_id AND split_staff.branch_id=line.branch_id AND split_staff.id=split.value->>'staffId'
                 ),''), NULLIF(primary_staff.appointment_display_name,''), NULLIF(BTRIM(CONCAT_WS(' ',primary_staff.first_name,primary_staff.last_name)),''), 'Unassigned'), ', ') FILTER (WHERE line.line_type='service'), 'Unassigned') AS staff_names
            FROM pos_sale_lines line
            LEFT JOIN staff primary_staff ON primary_staff.id=line.staff_id AND primary_staff.tenant_id=line.tenant_id AND primary_staff.branch_id=line.branch_id
           WHERE line.tenant_id=$1 AND line.branch_id=$2
           GROUP BY line.tenant_id, line.branch_id, line.sale_id
        ), fifo_allocation_summary AS (
          SELECT receipt.tenant_id, receipt.branch_id, due_allocation.value->>'invoiceId' AS sale_id,
                 JSONB_AGG(JSONB_BUILD_OBJECT(
                   'receiptId', receipt.id,
                   'paidAt', COALESCE(receipt.paid_at,receipt.created_at),
                   'paymentMode', receipt.method,
                   'reference', receipt.method_reference,
                   'receivedBy', receipt.received_by_user_id,
                   'balanceBeforePaise', COALESCE((due_allocation.value->>'balanceBeforePaise')::BIGINT,0),
                   'receivedPaise', COALESCE((due_allocation.value->>'receivedPaise')::BIGINT,0),
                   'balanceAfterPaise', COALESCE((due_allocation.value->>'balanceAfterPaise')::BIGINT,0)
                 ) ORDER BY COALESCE(receipt.paid_at,receipt.created_at), receipt.id) AS fifo_allocations
            FROM pos_client_due_receipts receipt
            CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(receipt.allocations_json) due_allocation(value)
           WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2
           GROUP BY receipt.tenant_id, receipt.branch_id, due_allocation.value->>'invoiceId'
        ), due_base AS (
        SELECT ps.id AS invoice_id, ps.invoice_number,
               COALESCE(ps.business_date, COALESCE(ps.finalized_at, ps.created_at)::DATE) AS business_date,
               COALESCE(ps.finalized_at, ps.created_at) AS unpaid_at,
               ps.client_id,
               COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)),''), 'Walk-in client') AS client_name,
               COALESCE(c.phone,'') AS client_phone,
               COALESCE(lines.service_names,'No service') AS service_names,
               COALESCE(lines.staff_names,'Unassigned') AS staff_names,
               ps.total_paise, ps.paid_paise,
               GREATEST(ps.total_paise - ps.paid_paise, 0) + COALESCE(payment.received_due_paise,0) AS original_due_paise,
               COALESCE(payment.received_due_paise,0) AS received_due_paise,
               GREATEST(ps.total_paise - ps.paid_paise, 0) AS balance_paise,
               GREATEST((CASE WHEN ps.paid_paise >= ps.total_paise THEN COALESCE(payment.last_payment_at::DATE, CURRENT_DATE) ELSE CURRENT_DATE END) - COALESCE(ps.finalized_at, ps.created_at)::DATE, 0)::INT AS ageing_days,
               CASE WHEN ps.paid_paise >= ps.total_paise AND payment.last_payment_at IS NOT NULL
                    THEN GREATEST(payment.last_payment_at::DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE, 0)::INT
                    ELSE NULL END AS recovery_days,
               (ps.paid_paise >= ps.total_paise) AS recovered,
               CASE WHEN ps.paid_paise >= ps.total_paise THEN payment.last_payment_at ELSE NULL END AS full_paid_at,
               COALESCE(payment.payment_modes,'') AS payment_modes,
               COALESCE(payment.payment_references,'') AS payment_references,
               COALESCE(payment.received_by,'') AS received_by,
               COALESCE(payment.recovery_payment_history,'[]'::JSONB) AS recovery_payment_history,
               COALESCE(fifo.fifo_allocations,'[]'::JSONB) AS fifo_allocations,
               COUNT(drf.id)::BIGINT AS follow_up_count, MAX(drf.created_at) AS last_follow_up_at,
               payment.last_payment_at,
               COALESCE(assignment.assigned_manager_id,'') AS recovery_manager_id,
               COALESCE(NULLIF(manager.appointment_display_name,''), NULLIF(BTRIM(CONCAT_WS(' ',manager.first_name,manager.last_name)),''), '') AS recovery_manager_name
          FROM pos_sales ps
          LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id
          LEFT JOIN due_recovery_followups drf ON drf.sale_id=ps.id AND drf.tenant_id=ps.tenant_id AND drf.branch_id=ps.branch_id
          LEFT JOIN latest_assignment assignment ON assignment.sale_id=ps.id
          LEFT JOIN payment_summary payment ON payment.sale_id=ps.id AND payment.tenant_id=ps.tenant_id AND payment.branch_id=ps.branch_id
          LEFT JOIN line_summary lines ON lines.sale_id=ps.id AND lines.tenant_id=ps.tenant_id AND lines.branch_id=ps.branch_id
          LEFT JOIN fifo_allocation_summary fifo ON fifo.sale_id=ps.id AND fifo.tenant_id=ps.tenant_id AND fifo.branch_id=ps.branch_id
          LEFT JOIN staff manager ON manager.id=assignment.assigned_manager_id AND manager.tenant_id=ps.tenant_id AND manager.branch_id=ps.branch_id
         WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ps.is_deleted=FALSE
           AND ($3::TIMESTAMPTZ IS NULL OR COALESCE(ps.finalized_at, ps.created_at) >= $3)
           AND ($4::TIMESTAMPTZ IS NULL OR COALESCE(ps.finalized_at, ps.created_at) < $4)
           AND LOWER(ps.status) NOT IN ('draft','voided','cancelled')
           AND ($5='all' OR ($5='due' AND ps.paid_paise < ps.total_paise) OR ($5='recovered' AND ps.paid_paise >= ps.total_paise AND COALESCE(payment.received_due_paise,0)>0))
           AND ($6='' OR ps.client_id=$6)
           AND ($7='' OR EXISTS (
             SELECT 1 FROM pos_sale_lines staff_line
              WHERE staff_line.tenant_id=ps.tenant_id AND staff_line.branch_id=ps.branch_id AND staff_line.sale_id=ps.id
                AND (staff_line.staff_id=$7 OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(COALESCE(staff_line.staff_splits,'[]'::JSONB)) split(value) WHERE split.value->>'staffId'=$7))
           ))
           AND ($8='' OR ps.invoice_number ILIKE '%'||$8||'%' OR COALESCE(c.phone,'') ILIKE '%'||$8||'%' OR BTRIM(CONCAT_WS(' ',c.first_name,c.last_name)) ILIKE '%'||$8||'%' OR COALESCE(lines.service_names,'') ILIKE '%'||$8||'%' OR COALESCE(lines.staff_names,'') ILIKE '%'||$8||'%')
           AND ($10='' OR EXISTS (
             SELECT 1 FROM pos_payments method_payment
              WHERE method_payment.tenant_id=ps.tenant_id AND method_payment.branch_id=ps.branch_id AND method_payment.sale_id=ps.id
                AND ps.finalized_at IS NOT NULL AND method_payment.paid_at > ps.finalized_at AND LOWER(method_payment.method)=$10
           ))
         GROUP BY ps.id, ps.invoice_number, ps.business_date, ps.client_id, client_name, client_phone, lines.service_names, lines.staff_names,
                  ps.total_paise, ps.paid_paise, ps.finalized_at, ps.created_at, payment.received_due_paise, payment.last_payment_at,
                  payment.payment_modes, payment.payment_references, payment.received_by, payment.recovery_payment_history, fifo.fifo_allocations,
                  assignment.assigned_manager_id, manager.appointment_display_name, manager.first_name, manager.last_name
        )
        SELECT invoice_id, invoice_number, business_date, unpaid_at, client_id, client_name, client_phone, service_names, staff_names,
               total_paise, paid_paise, original_due_paise, received_due_paise, balance_paise, ageing_days,
               CASE WHEN ageing_days<=7 THEN '0-7' WHEN ageing_days<=15 THEN '8-15' WHEN ageing_days<=30 THEN '16-30' WHEN ageing_days<=60 THEN '31-60' ELSE '61+' END AS ageing_bucket,
               recovery_days, recovered, full_paid_at, payment_modes, payment_references, received_by, recovery_payment_history, fifo_allocations,
               follow_up_count, last_follow_up_at, last_payment_at, recovery_manager_id, recovery_manager_name
          FROM due_base
         WHERE ($9='' OR CASE WHEN ageing_days<=7 THEN '0-7' WHEN ageing_days<=15 THEN '8-15' WHEN ageing_days<=30 THEN '16-30' WHEN ageing_days<=60 THEN '31-60' ELSE '61+' END=$9)
         ORDER BY recovered, ageing_days DESC, balance_paise DESC
         LIMIT 500
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(start_at).bind(end_at).bind(recovery)
    .bind(client_id).bind(staff_id).bind(q).bind(ageing_bucket).bind(payment_method)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load due recovery report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn report_wallet_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<WalletLedgerQuery>,
) -> ApiResult<WalletLedgerResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let start_at = query
        .date_from
        .as_deref()
        .map(|raw| parse_day(raw, false))
        .transpose()?;
    let end_at = query
        .date_to
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?;
    let client_id = query.client_id.unwrap_or_default().trim().to_string();
    let transaction_type = query
        .transaction_type
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !transaction_type.is_empty()
        && !matches!(
            transaction_type.as_str(),
            "recharge" | "use" | "refund" | "adjustment_credit" | "adjustment_debit"
        )
    {
        return Err(AppError::validation("invalid transactionType"));
    }
    let q = query.q.unwrap_or_default().trim().to_string();

    let rows = sqlx::query_as::<_, WalletLedgerRow>(
        r#"
        SELECT wt.id AS transaction_id, wt.client_id,
               COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Walk-in client') AS client_name,
               COALESCE(client.phone,'') AS client_phone,
               wt.created_at, wt.transaction_type,
               CASE WHEN wt.delta_paise>0 THEN 'credit' ELSE 'debit' END AS direction,
               GREATEST(wt.delta_paise,0)::BIGINT AS credit_paise,
               GREATEST(-wt.delta_paise,0)::BIGINT AS debit_paise,
               wt.delta_paise,
               (wt.balance_after_paise-wt.delta_paise)::BIGINT AS opening_balance_paise,
               wt.balance_after_paise AS closing_balance_paise,
               wt.reference_type, wt.reference_id,
               COALESCE(invoice.invoice_number,'') AS invoice_number,
               wt.notes
          FROM wallet_transactions wt
          LEFT JOIN clients client ON client.id=wt.client_id AND client.tenant_id=wt.tenant_id AND client.branch_id=wt.branch_id
          LEFT JOIN pos_sales invoice ON invoice.id=wt.reference_id AND invoice.tenant_id=wt.tenant_id AND invoice.branch_id=wt.branch_id
         WHERE wt.tenant_id=$1 AND wt.branch_id=$2
           AND ($3::TIMESTAMPTZ IS NULL OR wt.created_at >= $3)
           AND ($4::TIMESTAMPTZ IS NULL OR wt.created_at < $4)
           AND ($5='' OR wt.client_id=$5)
           AND ($6='' OR LOWER(wt.transaction_type)=$6)
           AND ($7='' OR COALESCE(invoice.invoice_number,'') ILIKE '%'||$7||'%' OR wt.reference_id ILIKE '%'||$7||'%' OR wt.reference_type ILIKE '%'||$7||'%' OR wt.notes ILIKE '%'||$7||'%' OR BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$7||'%' OR COALESCE(client.phone,'') ILIKE '%'||$7||'%')
         ORDER BY wt.created_at DESC, wt.id DESC
         LIMIT 1000
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at)
    .bind(end_at)
    .bind(&client_id)
    .bind(&transaction_type)
    .bind(&q)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load wallet ledger"))?;

    let summary = sqlx::query_as::<_, WalletLedgerSummary>(
        r#"
        WITH filtered AS (
          SELECT wt.client_id, wt.delta_paise
            FROM wallet_transactions wt
            LEFT JOIN clients client ON client.id=wt.client_id AND client.tenant_id=wt.tenant_id AND client.branch_id=wt.branch_id
            LEFT JOIN pos_sales invoice ON invoice.id=wt.reference_id AND invoice.tenant_id=wt.tenant_id AND invoice.branch_id=wt.branch_id
           WHERE wt.tenant_id=$1 AND wt.branch_id=$2
             AND ($3::TIMESTAMPTZ IS NULL OR wt.created_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR wt.created_at < $4)
             AND ($5='' OR wt.client_id=$5)
             AND ($6='' OR LOWER(wt.transaction_type)=$6)
             AND ($7='' OR COALESCE(invoice.invoice_number,'') ILIKE '%'||$7||'%' OR wt.reference_id ILIKE '%'||$7||'%' OR wt.reference_type ILIKE '%'||$7||'%' OR wt.notes ILIKE '%'||$7||'%' OR BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$7||'%' OR COALESCE(client.phone,'') ILIKE '%'||$7||'%')
        ), opening AS (
          SELECT COALESCE(SUM(CASE WHEN $3::TIMESTAMPTZ IS NULL THEN 0 ELSE COALESCE((
                   SELECT SUM(prior.delta_paise)::BIGINT
                     FROM wallet_transactions prior
                    WHERE prior.tenant_id=$1 AND prior.branch_id=$2 AND prior.client_id=scope.client_id AND prior.created_at < $3
                 ),0) END),0)::BIGINT AS opening_balance_paise
            FROM (SELECT DISTINCT client_id FROM filtered) scope
        ), liability AS (
          SELECT COALESCE(SUM(client.wallet_balance_paise),0)::BIGINT AS current_liability_paise,
                 COUNT(*) FILTER (WHERE client.wallet_balance_paise>0)::BIGINT AS clients_with_balance
            FROM clients client
           WHERE client.tenant_id=$1 AND client.branch_id=$2
             AND ($5='' OR client.id=$5)
        )
        SELECT COUNT(filtered.client_id)::BIGINT AS transaction_count,
               COUNT(DISTINCT filtered.client_id)::BIGINT AS client_count,
               COALESCE(SUM(GREATEST(filtered.delta_paise,0)),0)::BIGINT AS credit_paise,
               COALESCE(SUM(GREATEST(-filtered.delta_paise,0)),0)::BIGINT AS debit_paise,
               COALESCE(SUM(filtered.delta_paise),0)::BIGINT AS net_movement_paise,
               opening.opening_balance_paise,
               (opening.opening_balance_paise+COALESCE(SUM(filtered.delta_paise),0))::BIGINT AS closing_balance_paise,
               liability.current_liability_paise,
               liability.clients_with_balance
          FROM opening
          CROSS JOIN liability
          LEFT JOIN filtered ON TRUE
         GROUP BY opening.opening_balance_paise, liability.current_liability_paise, liability.clients_with_balance
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at.clone())
    .bind(end_at.clone())
    .bind(&client_id)
    .bind(&transaction_type)
    .bind(&q)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to summarize wallet ledger"))?;

    Ok(Json(ApiResponse::ok(WalletLedgerResponse {
        summary,
        rows,
    })))
}

async fn report_payment_collection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PaymentCollectionQuery>,
) -> ApiResult<PaymentCollectionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let start_at = query
        .date_from
        .as_deref()
        .map(|raw| parse_day(raw, false))
        .transpose()?;
    let end_at = query
        .date_to
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?;
    let client_id = query.client_id.unwrap_or_default().trim().to_string();
    let payment_method = query
        .payment_method
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let collection_timing = query
        .collection_timing
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !collection_timing.is_empty()
        && !matches!(collection_timing.as_str(), "invoice_time" | "due_receipt")
    {
        return Err(AppError::validation("invalid collectionTiming"));
    }
    let q = query.q.unwrap_or_default().trim().to_string();

    let rows = sqlx::query_as::<_, PaymentCollectionRow>(
        r#"
        WITH due_receipt_map AS (
          SELECT receipt.tenant_id, receipt.branch_id, due_allocation.value->>'paymentId' AS payment_id,
                 COALESCE(STRING_AGG(DISTINCT NULLIF(receipt.received_by_user_id,''), ', '), '') AS received_by
            FROM pos_client_due_receipts receipt
            CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(receipt.allocations_json) due_allocation(value)
           WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2
           GROUP BY receipt.tenant_id, receipt.branch_id, due_allocation.value->>'paymentId'
        ), sale_splits AS (
          SELECT tenant_id, branch_id, sale_id,
                 COUNT(*)::BIGINT AS split_payment_count,
                 STRING_AGG(DISTINCT method, ', ' ORDER BY method) AS split_methods
            FROM pos_payments
           WHERE tenant_id=$1 AND branch_id=$2
           GROUP BY tenant_id, branch_id, sale_id
        ), payment_base AS (
          SELECT payment.id AS payment_id,
                 sale.id AS invoice_id,
                 sale.invoice_number,
                 COALESCE(sale.business_date, COALESCE(sale.finalized_at, sale.created_at)::DATE) AS business_date,
                 sale.client_id,
                 COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''), 'Walk-in client') AS client_name,
                 COALESCE(client.phone,'') AS client_phone,
                 payment.method AS payment_method,
                 CASE
                   WHEN LOWER(payment.method)='cash' THEN 'cash'
                   WHEN LOWER(payment.method)='upi' THEN 'upi'
                   WHEN LOWER(payment.method) IN ('card','credit_card','debit_card') THEN 'card'
                   WHEN LOWER(payment.method) IN ('wallet','store_credit') THEN 'wallet'
                   WHEN LOWER(payment.method)='gift_card' THEN 'gift_card'
                   WHEN LOWER(payment.method) IN ('online','bank_transfer','razorpay','payment_link','qr') THEN 'online'
                   ELSE 'other'
                 END AS method_group,
                 payment.amount_paise,
                 payment.method_reference,
                 payment.label,
                 payment.notes,
                 payment.paid_at,
                 CASE
                   WHEN due_map.payment_id IS NOT NULL OR (sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at)
                   THEN 'due_receipt'
                   ELSE 'invoice_time'
                 END AS collection_timing,
                 COALESCE(due_map.received_by,'') AS received_by,
                 COALESCE(splits.split_payment_count,1)::BIGINT AS split_payment_count,
                 COALESCE(splits.split_methods,payment.method) AS split_methods,
                 sale.total_paise AS invoice_total_paise,
                 sale.paid_paise AS invoice_paid_paise,
                 GREATEST(sale.total_paise-sale.paid_paise,0)::BIGINT AS invoice_due_paise
            FROM pos_payments payment
            JOIN pos_sales sale ON sale.id=payment.sale_id AND sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id
            LEFT JOIN clients client ON client.id=sale.client_id AND client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id
            LEFT JOIN due_receipt_map due_map ON due_map.payment_id=payment.id AND due_map.tenant_id=payment.tenant_id AND due_map.branch_id=payment.branch_id
            LEFT JOIN sale_splits splits ON splits.sale_id=payment.sale_id AND splits.tenant_id=payment.tenant_id AND splits.branch_id=payment.branch_id
           WHERE payment.tenant_id=$1 AND payment.branch_id=$2
             AND sale.is_deleted=FALSE
             AND LOWER(sale.status) NOT IN ('draft','voided','cancelled')
             AND ($3::TIMESTAMPTZ IS NULL OR payment.paid_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR payment.paid_at < $4)
             AND ($5='' OR sale.client_id=$5)
             AND ($8='' OR sale.invoice_number ILIKE '%'||$8||'%' OR payment.method_reference ILIKE '%'||$8||'%' OR payment.notes ILIKE '%'||$8||'%' OR payment.label ILIKE '%'||$8||'%' OR BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$8||'%' OR COALESCE(client.phone,'') ILIKE '%'||$8||'%')
        )
        SELECT payment_id, invoice_id, invoice_number, business_date, client_id, client_name, client_phone,
               payment_method, method_group, amount_paise, method_reference, label, notes, paid_at,
               collection_timing, received_by, split_payment_count, split_methods,
               invoice_total_paise, invoice_paid_paise, invoice_due_paise
          FROM payment_base
         WHERE ($6='' OR LOWER(payment_method)=$6 OR method_group=$6)
           AND ($7='' OR collection_timing=$7)
         ORDER BY paid_at DESC, payment_id DESC
         LIMIT 1000
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at.clone())
    .bind(end_at.clone())
    .bind(&client_id)
    .bind(&payment_method)
    .bind(&collection_timing)
    .bind(&q)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment collection report"))?;

    let summary = sqlx::query_as::<_, PaymentCollectionSummary>(
        r#"
        WITH due_receipt_map AS (
          SELECT DISTINCT receipt.tenant_id, receipt.branch_id, due_allocation.value->>'paymentId' AS payment_id,
                 COALESCE(NULLIF(receipt.received_by_user_id,''), '') AS received_by
            FROM pos_client_due_receipts receipt
            CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(receipt.allocations_json) due_allocation(value)
           WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2
        ), sale_splits AS (
          SELECT tenant_id, branch_id, sale_id,
                 COUNT(*)::BIGINT AS split_payment_count
            FROM pos_payments
           WHERE tenant_id=$1 AND branch_id=$2
           GROUP BY tenant_id, branch_id, sale_id
        ), payment_base AS (
          SELECT payment.id AS payment_id,
                 sale.id AS invoice_id,
                 CASE
                   WHEN LOWER(payment.method)='cash' THEN 'cash'
                   WHEN LOWER(payment.method)='upi' THEN 'upi'
                   WHEN LOWER(payment.method) IN ('card','credit_card','debit_card') THEN 'card'
                   WHEN LOWER(payment.method) IN ('wallet','store_credit') THEN 'wallet'
                   WHEN LOWER(payment.method)='gift_card' THEN 'gift_card'
                   WHEN LOWER(payment.method) IN ('online','bank_transfer','razorpay','payment_link','qr') THEN 'online'
                   ELSE 'other'
                 END AS method_group,
                 payment.method AS payment_method,
                 payment.amount_paise,
                 payment.method_reference,
                 CASE
                   WHEN due_map.payment_id IS NOT NULL OR (sale.finalized_at IS NOT NULL AND payment.paid_at > sale.finalized_at)
                   THEN 'due_receipt'
                   ELSE 'invoice_time'
                 END AS collection_timing,
                 COALESCE(due_map.received_by,'') AS received_by,
                 COALESCE(splits.split_payment_count,1)::BIGINT AS split_payment_count
            FROM pos_payments payment
            JOIN pos_sales sale ON sale.id=payment.sale_id AND sale.tenant_id=payment.tenant_id AND sale.branch_id=payment.branch_id
            LEFT JOIN clients client ON client.id=sale.client_id AND client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id
            LEFT JOIN due_receipt_map due_map ON due_map.payment_id=payment.id AND due_map.tenant_id=payment.tenant_id AND due_map.branch_id=payment.branch_id
            LEFT JOIN sale_splits splits ON splits.sale_id=payment.sale_id AND splits.tenant_id=payment.tenant_id AND splits.branch_id=payment.branch_id
           WHERE payment.tenant_id=$1 AND payment.branch_id=$2
             AND sale.is_deleted=FALSE
             AND LOWER(sale.status) NOT IN ('draft','voided','cancelled')
             AND ($3::TIMESTAMPTZ IS NULL OR payment.paid_at >= $3)
             AND ($4::TIMESTAMPTZ IS NULL OR payment.paid_at < $4)
             AND ($5='' OR sale.client_id=$5)
             AND ($8='' OR sale.invoice_number ILIKE '%'||$8||'%' OR payment.method_reference ILIKE '%'||$8||'%' OR payment.notes ILIKE '%'||$8||'%' OR payment.label ILIKE '%'||$8||'%' OR BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$8||'%' OR COALESCE(client.phone,'') ILIKE '%'||$8||'%')
        ), filtered AS (
          SELECT *
            FROM payment_base
           WHERE ($6='' OR LOWER(payment_method)=$6 OR method_group=$6)
             AND ($7='' OR collection_timing=$7)
        )
        SELECT COUNT(*)::BIGINT AS payment_count,
               COUNT(DISTINCT invoice_id)::BIGINT AS invoice_count,
               COALESCE(SUM(amount_paise),0)::BIGINT AS total_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE collection_timing='invoice_time'),0)::BIGINT AS invoice_time_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE collection_timing='due_receipt'),0)::BIGINT AS due_receipt_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='cash'),0)::BIGINT AS cash_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='upi'),0)::BIGINT AS upi_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='card'),0)::BIGINT AS card_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='wallet'),0)::BIGINT AS wallet_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='gift_card'),0)::BIGINT AS gift_card_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='online'),0)::BIGINT AS online_paise,
               COALESCE(SUM(amount_paise) FILTER (WHERE method_group='other'),0)::BIGINT AS other_paise,
               COUNT(DISTINCT invoice_id) FILTER (WHERE split_payment_count>1)::BIGINT AS split_invoice_count,
               COUNT(*) FILTER (WHERE method_group IN ('upi','card','gift_card','online') AND method_reference='')::BIGINT AS reference_missing_count,
               COUNT(*) FILTER (WHERE collection_timing='due_receipt' AND received_by='')::BIGINT AS received_by_missing_count
          FROM filtered
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at)
    .bind(end_at)
    .bind(&client_id)
    .bind(&payment_method)
    .bind(&collection_timing)
    .bind(&q)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to summarize payment collection report"))?;

    Ok(Json(ApiResponse::ok(PaymentCollectionResponse {
        summary,
        rows,
    })))
}

const STAFF_SERVICE_DISCOUNT_BASE_SQL: &str = r#"
    WITH latest_approval AS (
      SELECT DISTINCT ON (sale_id) sale_id, status AS approval_status
        FROM pos_discount_approval_requests
       WHERE tenant_id=$1 AND branch_id=$2
       ORDER BY sale_id, created_at DESC
    ), service_base AS (
      SELECT sale.id AS invoice_id, sale.invoice_number,
             COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE) AS business_date,
             sale.client_id,
             COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Walk-in client') AS client_name,
             line.id AS line_id, line.item_id AS service_id, line.item_name AS service_name,
             line.staff_id AS primary_staff_id,
             COALESCE(NULLIF(primary_staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',primary_staff.first_name,primary_staff.last_name)),''),'Unassigned') AS primary_staff_name,
             line.staff_splits, line.quantity, line.gross_paise, line.line_total_paise,
             CASE WHEN line.discount_type IN ('membership','membership_stacked') THEN 0 ELSE line.discount_paise END
               + CASE WHEN sale.subtotal_paise>0 THEN ((sale.bill_discount_paise*line.gross_paise + sale.subtotal_paise/2)/sale.subtotal_paise)::BIGINT ELSE 0 END AS manual_discount_paise,
             CASE WHEN sale.subtotal_paise>0 THEN ((sale.coupon_discount_paise*line.gross_paise + sale.subtotal_paise/2)/sale.subtotal_paise)::BIGINT ELSE 0 END AS coupon_discount_paise,
             CASE WHEN line.discount_type IN ('membership','membership_stacked') THEN line.discount_paise ELSE 0 END AS membership_discount_paise,
             CASE WHEN sale.discount_paise>0 THEN COALESCE(approval.approval_status,'not_requested') ELSE 'not_required' END AS approval_status
        FROM pos_sale_lines line
        JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
        LEFT JOIN clients client ON client.id=sale.client_id AND client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id
        LEFT JOIN staff primary_staff ON primary_staff.id=line.staff_id AND primary_staff.tenant_id=line.tenant_id AND primary_staff.branch_id=line.branch_id
        LEFT JOIN latest_approval approval ON approval.sale_id=sale.id
       WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='service' AND sale.is_deleted=FALSE
         AND LOWER(sale.status) NOT IN ('draft','voided','cancelled')
         AND ($3::DATE IS NULL OR COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE)>=$3)
         AND ($4::DATE IS NULL OR COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE)<=$4)
         AND ($5='' OR sale.client_id=$5)
         AND ($7='' OR line.item_id=$7)
         AND ($8='' OR sale.invoice_number ILIKE '%'||$8||'%' OR line.item_name ILIKE '%'||$8||'%' OR COALESCE(client.phone,'') ILIKE '%'||$8||'%' OR BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$8||'%' OR COALESCE(primary_staff.appointment_display_name,'') ILIKE '%'||$8||'%')
    ), attributed AS (
      SELECT base.*,
             COALESCE(NULLIF(split.value->>'staffId',''),base.primary_staff_id,'') AS staff_id,
             COALESCE(NULLIF(split.value->>'staffName',''),NULLIF(split_staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',split_staff.first_name,split_staff.last_name)),''),base.primary_staff_name,'Unassigned') AS staff_name,
             COALESCE(ROUND((NULLIF(split.value->>'percent',''))::NUMERIC)::INT,100) AS split_percent
        FROM service_base base
        CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
          CASE WHEN JSONB_ARRAY_LENGTH(COALESCE(base.staff_splits,'[]'::JSONB))>0
               THEN base.staff_splits
               ELSE JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('staffId',base.primary_staff_id,'staffName',base.primary_staff_name,'percent',100))
          END
        ) split(value)
        LEFT JOIN staff split_staff ON split_staff.id=split.value->>'staffId' AND split_staff.tenant_id=$1 AND split_staff.branch_id=$2
       WHERE ($6='' OR COALESCE(NULLIF(split.value->>'staffId',''),base.primary_staff_id,'')=$6)
    ), report_rows AS (
      SELECT invoice_id, invoice_number, business_date, client_id, client_name, service_id, service_name,
             staff_id, staff_name, split_percent, quantity,
             ((gross_paise*split_percent + 50)/100)::BIGINT AS gross_paise,
             ((line_total_paise*split_percent + 50)/100)::BIGINT AS final_sale_paise,
             ((manual_discount_paise*split_percent + 50)/100)::BIGINT AS manual_discount_paise,
             ((coupon_discount_paise*split_percent + 50)/100)::BIGINT AS coupon_discount_paise,
             ((membership_discount_paise*split_percent + 50)/100)::BIGINT AS membership_discount_paise,
             (((manual_discount_paise+coupon_discount_paise+membership_discount_paise)*split_percent + 50)/100)::BIGINT AS total_discount_paise,
             CASE WHEN gross_paise>0 THEN ((((manual_discount_paise+coupon_discount_paise+membership_discount_paise)*10000)/gross_paise))::BIGINT ELSE 0 END AS discount_bps,
             approval_status
        FROM attributed
    )
"#;

async fn report_staff_service_discount(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DetailedInvoiceQuery>,
) -> ApiResult<StaffServiceDiscountReport> {
    if query
        .date_from
        .zip(query.date_to)
        .is_some_and(|(from, to)| from > to)
    {
        return Err(AppError::validation("dateFrom cannot be after dateTo"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let client_id = query.client_id.unwrap_or_default().trim().to_string();
    let staff_id = query.staff_id.unwrap_or_default().trim().to_string();
    let service_id = query.service_id.unwrap_or_default().trim().to_string();
    let q = query.q.unwrap_or_default().trim().to_string();

    let rows_sql = format!(
        "{STAFF_SERVICE_DISCOUNT_BASE_SQL} SELECT invoice_id, invoice_number, business_date, client_id, client_name, service_id, service_name, staff_id, staff_name, split_percent, quantity, gross_paise, final_sale_paise, manual_discount_paise, coupon_discount_paise, membership_discount_paise, total_discount_paise, discount_bps, approval_status FROM report_rows ORDER BY business_date DESC, invoice_number DESC, service_name, staff_name LIMIT $9"
    );
    let rows = sqlx::query_as::<_, StaffServiceDiscountRow>(&rows_sql)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(query.date_from)
        .bind(query.date_to)
        .bind(&client_id)
        .bind(&staff_id)
        .bind(&service_id)
        .bind(&q)
        .bind(query.limit.unwrap_or(1000).clamp(1, 5000))
        .fetch_all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load staff service discount report"))?;

    let summary_sql = format!(
        "{STAFF_SERVICE_DISCOUNT_BASE_SQL} SELECT COUNT(*)::BIGINT AS row_count, COUNT(DISTINCT staff_id)::BIGINT AS staff_count, COUNT(DISTINCT service_id)::BIGINT AS service_count, COALESCE(SUM(quantity),0)::BIGINT AS quantity, COALESCE(SUM(gross_paise),0)::BIGINT AS gross_paise, COALESCE(SUM(final_sale_paise),0)::BIGINT AS final_sale_paise, COALESCE(SUM(manual_discount_paise),0)::BIGINT AS manual_discount_paise, COALESCE(SUM(coupon_discount_paise),0)::BIGINT AS coupon_discount_paise, COALESCE(SUM(membership_discount_paise),0)::BIGINT AS membership_discount_paise, COALESCE(SUM(total_discount_paise),0)::BIGINT AS total_discount_paise, COALESCE(AVG(discount_bps),0)::BIGINT AS average_discount_bps, COUNT(*) FILTER (WHERE approval_status='pending')::BIGINT AS pending_approval_count, COUNT(*) FILTER (WHERE approval_status='approved')::BIGINT AS approved_count, COUNT(*) FILTER (WHERE approval_status='rejected')::BIGINT AS rejected_count FROM report_rows"
    );
    let summary = sqlx::query_as::<_, StaffServiceDiscountSummary>(&summary_sql)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(query.date_from)
        .bind(query.date_to)
        .bind(&client_id)
        .bind(&staff_id)
        .bind(&service_id)
        .bind(&q)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to summarize staff service discount report"))?;

    Ok(Json(ApiResponse::ok(StaffServiceDiscountReport {
        summary,
        rows,
    })))
}

const DETAILED_INVOICE_BASE_SQL: &str = r#"
    WITH payment_summary AS (
      SELECT sale_id,
             STRING_AGG(DISTINCT method, ', ' ORDER BY method) AS payment_modes,
             COALESCE(SUM(CASE WHEN method='wallet' THEN amount_paise ELSE 0 END),0)::BIGINT AS wallet_paise
        FROM pos_payments
       WHERE tenant_id=$1 AND branch_id=$2
       GROUP BY sale_id
    ), filtered_lines AS (
      SELECT sale.id AS invoice_id, sale.invoice_number,
             COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE) AS business_date,
             sale.client_id,
             COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Walk-in client') AS client_name,
             COALESCE(client.phone,'') AS client_phone,
             line.id AS line_id, line.line_type, line.item_id, line.item_name,
             COALESCE(NULLIF((
               SELECT STRING_AGG(
                 COALESCE(NULLIF(split.value->>'staffName',''),NULLIF(split_staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',split_staff.first_name,split_staff.last_name)),''),split.value->>'staffId')
                 || CASE WHEN COALESCE(split.value->>'percent','')<>'' THEN ' ('||(split.value->>'percent')||'%)' ELSE '' END,
                 ', '
               )
                 FROM JSONB_ARRAY_ELEMENTS(COALESCE(line.staff_splits,'[]'::JSONB)) split(value)
                 LEFT JOIN staff split_staff ON split_staff.tenant_id=line.tenant_id AND split_staff.branch_id=line.branch_id AND split_staff.id=split.value->>'staffId'
             ),''),NULLIF(primary_staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',primary_staff.first_name,primary_staff.last_name)),''),'Unassigned') AS staff_name,
             line.quantity, line.unit_price_paise, line.gross_paise, line.discount_paise,
             COALESCE(line.discount_type,'') AS discount_type, line.taxable_paise, line.gst_paise,
             line.cgst_paise, line.sgst_paise, line.igst_paise, line.line_total_paise,
             sale.subtotal_paise AS invoice_subtotal_paise, sale.bill_discount_paise,
             COALESCE(sale.coupon_code,'') AS coupon_code, sale.coupon_discount_paise,
             sale.discount_paise AS invoice_discount_paise, sale.tax_paise AS invoice_tax_paise,
             sale.tip_paise, sale.round_off_paise, sale.total_paise AS invoice_total_paise,
             sale.paid_paise, GREATEST(sale.total_paise-sale.paid_paise,0)::BIGINT AS due_paise,
             COALESCE(payment.payment_modes,'Unpaid') AS payment_modes,
             CASE WHEN LOWER(sale.status) IN ('voided','cancelled') THEN LOWER(sale.status)
                  WHEN sale.paid_paise>=sale.total_paise THEN 'paid'
                  WHEN sale.paid_paise>0 THEN 'partial' ELSE 'unpaid' END AS payment_status,
             sale.status AS invoice_status, sale.source, COALESCE(payment.wallet_paise,0)::BIGINT AS wallet_paise
        FROM pos_sale_lines line
        JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
        LEFT JOIN clients client ON client.id=sale.client_id AND client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id
        LEFT JOIN staff primary_staff ON primary_staff.id=line.staff_id AND primary_staff.tenant_id=line.tenant_id AND primary_staff.branch_id=line.branch_id
        LEFT JOIN payment_summary payment ON payment.sale_id=sale.id
       WHERE line.tenant_id=$1 AND line.branch_id=$2 AND sale.is_deleted=FALSE
         AND ($3::DATE IS NULL OR COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE)>=$3)
         AND ($4::DATE IS NULL OR COALESCE(sale.business_date,COALESCE(sale.finalized_at,sale.created_at)::DATE)<=$4)
         AND ($5='' OR sale.client_id=$5)
         AND ($6='' OR line.staff_id=$6 OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(COALESCE(line.staff_splits,'[]'::JSONB)) split(value) WHERE split.value->>'staffId'=$6))
         AND (($7='' AND $8='') OR (line.line_type='service' AND line.item_id=$7) OR (line.line_type='product' AND line.item_id=$8))
         AND ($9='' OR EXISTS (SELECT 1 FROM pos_payments method_payment WHERE method_payment.tenant_id=sale.tenant_id AND method_payment.branch_id=sale.branch_id AND method_payment.sale_id=sale.id AND LOWER(method_payment.method)=$9))
         AND (
           ($10='' AND LOWER(sale.status) NOT IN ('draft','voided','cancelled'))
           OR ($10='paid' AND LOWER(sale.status) NOT IN ('draft','voided','cancelled') AND sale.paid_paise>=sale.total_paise)
           OR ($10='partial' AND LOWER(sale.status) NOT IN ('draft','voided','cancelled') AND sale.paid_paise>0 AND sale.paid_paise<sale.total_paise)
           OR ($10='unpaid' AND LOWER(sale.status) NOT IN ('draft','voided','cancelled') AND sale.paid_paise=0 AND sale.total_paise>0)
           OR ($10='due' AND LOWER(sale.status) NOT IN ('draft','voided','cancelled') AND sale.paid_paise<sale.total_paise)
           OR ($10 NOT IN ('','paid','partial','unpaid','due') AND LOWER(sale.status)=$10)
         )
         AND ($11='' OR sale.invoice_number ILIKE '%'||$11||'%' OR line.item_name ILIKE '%'||$11||'%' OR COALESCE(client.phone,'') ILIKE '%'||$11||'%' OR COALESCE(client.first_name||' '||client.last_name,'') ILIKE '%'||$11||'%' OR COALESCE(primary_staff.appointment_display_name,'') ILIKE '%'||$11||'%')
    )
"#;

async fn report_detailed_invoices(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DetailedInvoiceQuery>,
) -> ApiResult<DetailedInvoiceReport> {
    if query
        .date_from
        .zip(query.date_to)
        .is_some_and(|(from, to)| from > to)
    {
        return Err(AppError::validation("dateFrom cannot be after dateTo"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let client_id = query.client_id.unwrap_or_default().trim().to_string();
    let staff_id = query.staff_id.unwrap_or_default().trim().to_string();
    let service_id = query.service_id.unwrap_or_default().trim().to_string();
    let product_id = query.product_id.unwrap_or_default().trim().to_string();
    let payment_method = query
        .payment_method
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    let q = query.q.unwrap_or_default().trim().to_string();

    let rows_sql = format!(
        "{DETAILED_INVOICE_BASE_SQL} SELECT invoice_id,invoice_number,business_date,client_id,client_name,client_phone,line_id,line_type,item_id,item_name,staff_name,quantity,unit_price_paise,gross_paise,discount_paise,discount_type,taxable_paise,gst_paise,cgst_paise,sgst_paise,igst_paise,line_total_paise,invoice_subtotal_paise,bill_discount_paise,coupon_code,coupon_discount_paise,invoice_discount_paise,invoice_tax_paise,tip_paise,round_off_paise,invoice_total_paise,paid_paise,due_paise,payment_modes,payment_status,invoice_status,source FROM filtered_lines ORDER BY business_date DESC,invoice_number DESC,line_id LIMIT $12"
    );
    let rows = sqlx::query_as::<_, DetailedInvoiceRow>(&rows_sql)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(query.date_from)
        .bind(query.date_to)
        .bind(&client_id)
        .bind(&staff_id)
        .bind(&service_id)
        .bind(&product_id)
        .bind(&payment_method)
        .bind(&status)
        .bind(&q)
        .bind(query.limit.unwrap_or(1000).clamp(1, 5000))
        .fetch_all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load detailed invoice report"))?;

    let summary_sql = format!(
        "{DETAILED_INVOICE_BASE_SQL}, matching_invoices AS (SELECT DISTINCT invoice_id,paid_paise,due_paise,wallet_paise FROM filtered_lines) SELECT COUNT(DISTINCT invoice_id)::BIGINT AS invoice_count,COUNT(*)::BIGINT AS line_count,COALESCE(SUM(gross_paise),0)::BIGINT AS gross_paise,COALESCE(SUM(discount_paise),0)::BIGINT AS discount_paise,COALESCE(SUM(gst_paise),0)::BIGINT AS gst_paise,COALESCE((SELECT SUM(paid_paise) FROM matching_invoices),0)::BIGINT AS paid_paise,COALESCE((SELECT SUM(due_paise) FROM matching_invoices),0)::BIGINT AS due_paise,COALESCE((SELECT SUM(wallet_paise) FROM matching_invoices),0)::BIGINT AS wallet_paise FROM filtered_lines"
    );
    let summary = sqlx::query_as::<_, DetailedInvoiceSummary>(&summary_sql)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(query.date_from)
        .bind(query.date_to)
        .bind(&client_id)
        .bind(&staff_id)
        .bind(&service_id)
        .bind(&product_id)
        .bind(&payment_method)
        .bind(&status)
        .bind(&q)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load detailed invoice totals"))?;

    Ok(Json(ApiResponse::ok(DetailedInvoiceReport {
        summary,
        rows,
    })))
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

async fn report_product_sales(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ProductReportQuery>,
) -> ApiResult<ProductSalesReport> {
    validate_product_report_range(&query)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, ProductSalesRow>(
        r#"
        WITH line_cost AS (
          SELECT sale_line_id, COALESCE(SUM(ABS(quantity_delta)::BIGINT * unit_cost_paise),0)::BIGINT AS cost_paise
            FROM inventory_stock_ledger
           WHERE tenant_id=$1 AND branch_id=$2 AND movement_type='sale' AND sale_line_id IS NOT NULL
           GROUP BY sale_line_id
        )
        SELECT line.item_id AS product_id, line.item_name AS product_name,
               COALESCE(item.category,'') AS category, COALESCE(item.sku,'') AS sku,
               SUM(line.quantity)::BIGINT AS quantity_sold, SUM(line.gross_paise)::BIGINT AS gross_sale_paise,
               SUM(line.discount_paise)::BIGINT AS discount_paise, SUM(line.taxable_paise)::BIGINT AS net_sale_paise,
               SUM(line.gst_paise)::BIGINT AS gst_paise, COALESCE(SUM(cost.cost_paise),0)::BIGINT AS product_cost_paise,
               (SUM(line.taxable_paise)-COALESCE(SUM(cost.cost_paise),0))::BIGINT AS gross_margin_paise,
               CASE WHEN SUM(line.taxable_paise)>0 THEN ((SUM(line.taxable_paise)-COALESCE(SUM(cost.cost_paise),0))*10000/SUM(line.taxable_paise))::BIGINT ELSE 0 END AS margin_bps,
               COUNT(DISTINCT NULLIF(sale.client_id,''))::BIGINT AS client_count,
               COUNT(DISTINCT sale.id)::BIGINT AS invoice_count, MAX(COALESCE(sale.finalized_at,sale.created_at)) AS last_sold_at
          FROM pos_sale_lines line
          JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
          LEFT JOIN inventory_items item ON item.id=line.item_id AND item.tenant_id=line.tenant_id AND item.branch_id=line.branch_id
          LEFT JOIN line_cost cost ON cost.sale_line_id=line.id
         WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='product'
           AND sale.status NOT IN ('draft','voided','cancelled')
           AND ($3::DATE IS NULL OR COALESCE(sale.finalized_at,sale.created_at)::DATE >= $3)
           AND ($4::DATE IS NULL OR COALESCE(sale.finalized_at,sale.created_at)::DATE <= $4)
           AND ($5='' OR line.item_id=$5)
           AND ($6='' OR line.item_name ILIKE '%'||$6||'%' OR COALESCE(item.category,'') ILIKE '%'||$6||'%' OR COALESCE(item.sku,'') ILIKE '%'||$6||'%')
         GROUP BY line.item_id,line.item_name,item.category,item.sku
         ORDER BY net_sale_paise DESC, product_name
         LIMIT $7
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(query.date_from)
    .bind(query.date_to)
    .bind(query.product_id.unwrap_or_default())
    .bind(query.q.unwrap_or_default().trim().to_string())
    .bind(query.limit.unwrap_or(500).clamp(1, 1000))
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load product sales report"))?;
    let quantity = rows.iter().map(|row| row.quantity_sold).sum::<i64>();
    let revenue = rows.iter().map(|row| row.net_sale_paise).sum::<i64>();
    let summary = ProductSalesSummary {
        total_products_sold: quantity,
        total_product_revenue_paise: revenue,
        average_product_price_paise: if quantity > 0 { revenue / quantity } else { 0 },
        top_product: rows
            .first()
            .map(|row| row.product_name.clone())
            .unwrap_or_default(),
        discount_paise: rows.iter().map(|row| row.discount_paise).sum(),
        gst_collected_paise: rows.iter().map(|row| row.gst_paise).sum(),
    };
    Ok(Json(ApiResponse::ok(ProductSalesReport { summary, rows })))
}

async fn report_product_movements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ProductReportQuery>,
) -> ApiResult<Vec<ProductMovementRow>> {
    validate_product_report_range(&query)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, ProductMovementRow>(
        r#"
        SELECT item.id AS product_id, item.name AS product_name, item.category, item.sku,
               item.stock_quantity::BIGINT AS current_stock,
               COALESCE(SUM(CASE WHEN ledger.movement_type='sale' THEN ABS(ledger.quantity_delta) ELSE 0 END),0)::BIGINT AS sold_quantity,
               COALESCE(SUM(CASE WHEN ledger.movement_type='return' THEN ABS(ledger.quantity_delta) ELSE 0 END),0)::BIGINT AS returned_quantity,
               COALESCE(SUM(CASE WHEN ledger.movement_type='purchase' THEN ABS(ledger.quantity_delta) ELSE 0 END),0)::BIGINT AS purchased_quantity,
               COALESCE(SUM(CASE WHEN ledger.movement_type='transfer_out' THEN ABS(ledger.quantity_delta) ELSE 0 END),0)::BIGINT AS transfer_out_quantity,
               COALESCE(SUM(CASE WHEN ledger.movement_type IN ('transfer_in','transfer_reversal') THEN ABS(ledger.quantity_delta) ELSE 0 END),0)::BIGINT AS transfer_in_quantity,
               COALESCE(SUM(CASE WHEN ledger.movement_type='adjustment' THEN ledger.quantity_delta ELSE 0 END),0)::BIGINT AS adjustment_quantity,
               COALESCE(SUM(CASE WHEN ledger.movement_type='consumption' THEN ABS(ledger.quantity_delta) ELSE 0 END),0)::BIGINT AS consumed_quantity,
               (item.stock_quantity::BIGINT * item.unit_cost_paise)::BIGINT AS current_stock_value_paise,
               MAX(ledger.created_at) AS last_movement_at
          FROM inventory_items item
          LEFT JOIN inventory_stock_ledger ledger ON ledger.inventory_item_id=item.id AND ledger.tenant_id=item.tenant_id AND ledger.branch_id=item.branch_id
            AND ($3::DATE IS NULL OR ledger.created_at::DATE >= $3) AND ($4::DATE IS NULL OR ledger.created_at::DATE <= $4)
         WHERE item.tenant_id=$1 AND item.branch_id=$2
           AND ($5='' OR item.id=$5)
           AND ($6='' OR item.name ILIKE '%'||$6||'%' OR item.category ILIKE '%'||$6||'%' OR item.sku ILIKE '%'||$6||'%')
         GROUP BY item.id,item.name,item.category,item.sku,item.stock_quantity,item.unit_cost_paise
         ORDER BY product_name
         LIMIT $7
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(query.date_from)
    .bind(query.date_to)
    .bind(query.product_id.unwrap_or_default())
    .bind(query.q.unwrap_or_default().trim().to_string())
    .bind(query.limit.unwrap_or(500).clamp(1, 1000))
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load product movement report"))?;
    Ok(Json(ApiResponse::ok(rows)))
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

fn validate_product_report_range(query: &ProductReportQuery) -> Result<(), AppError> {
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
        "SELECT id, sale_id, actor_user_id, action, note, status, assigned_manager_id, created_at FROM due_recovery_followups WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at DESC",
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
    let action = action.trim();
    if !matches!(action, "follow_up" | "call_done" | "assign_manager") {
        return Err(AppError::validation("unsupported follow-up action"));
    }
    let note = payload.note.unwrap_or_default();
    if note.chars().count() > 1000 {
        return Err(AppError::validation(
            "follow-up note cannot exceed 1000 characters",
        ));
    }
    let assigned_manager_id = payload.assigned_manager_id.unwrap_or_default();
    let assigned_manager_id = assigned_manager_id.trim();
    if action == "assign_manager" && assigned_manager_id.is_empty() {
        return Err(AppError::validation("assignedManagerId is required"));
    }
    if !assigned_manager_id.is_empty() {
        let manager_exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active IS TRUE)",
        )
        .bind(&tenant_id).bind(&branch_id).bind(assigned_manager_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to validate recovery manager"))?;
        if !manager_exists {
            return Err(AppError::validation(
                "recovery manager is not active in this branch",
            ));
        }
    }
    let status = match action {
        "assign_manager" => "call_pending",
        "call_done" => "completed",
        _ => payload
            .status
            .as_deref()
            .map(str::trim)
            .filter(|value| matches!(*value, "open" | "pending" | "completed"))
            .unwrap_or("open"),
    };
    let row = sqlx::query_as::<_, FollowUpRow>(
        r#"
        INSERT INTO due_recovery_followups (tenant_id, branch_id, sale_id, actor_user_id, action, note, status, assigned_manager_id)
        SELECT $1,$2,id,$4,$5,$6,$7,$8 FROM pos_sales
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND paid_paise < total_paise AND status NOT IN ('draft','voided','cancelled')
        RETURNING id, sale_id, actor_user_id, action, note, status, assigned_manager_id, created_at
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).bind(actor).bind(action).bind(note.trim()).bind(status).bind(assigned_manager_id)
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
         WHERE pp.tenant_id=$1 AND pp.branch_id=$2
           AND (pp.created_at AT TIME ZONE 'Asia/Kolkata')::DATE >= $3::DATE
           AND (pp.created_at AT TIME ZONE 'Asia/Kolkata')::DATE < $4::DATE
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
    Extension(claims): Extension<AuthClaims>,
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
        .unwrap_or_else(current_business_date);
    let session = sqlx::query_as::<_, (i64, Option<i64>, Option<i64>, String)>(
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM cash_drawer_tills t WHERE t.drawer_session_id=s.id AND t.tenant_id=s.tenant_id AND t.branch_id=s.branch_id) THEN (SELECT COALESCE(SUM(t.opening_cash_paise),0)::BIGINT FROM cash_drawer_tills t WHERE t.drawer_session_id=s.id AND t.tenant_id=s.tenant_id AND t.branch_id=s.branch_id) ELSE s.opening_cash_paise END, s.counted_cash_paise, s.variance_paise, s.status FROM cash_drawer_sessions s WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.business_date=$3 ORDER BY s.opened_at DESC LIMIT 1",
    )
    .bind(&tenant_id).bind(&branch_id).bind(business_date)
    .fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load cash drawer session"))?;
    let approver = ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role));
    if session
        .as_ref()
        .is_some_and(|row| row.3 == "open" || (row.3 == "pending_approval" && !approver))
    {
        return Err(AppError::forbidden(
            "cash drawer reconciliation is restricted until blind close is submitted",
        ));
    }
    let cash_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(pp.amount_paise),0)::BIGINT FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.method='cash' AND ps.business_date=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or(0);
    let movement = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT COALESCE(SUM(CASE WHEN movement.movement_type='cash_in' THEN movement.amount_paise ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN movement.movement_type='cash_out' THEN ABS(movement.amount_paise) ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN movement.movement_type='refund_cash' THEN ABS(movement.amount_paise) ELSE 0 END),0)::BIGINT FROM cash_drawer_movements movement JOIN cash_drawer_sessions session ON session.id=movement.drawer_session_id AND session.tenant_id=movement.tenant_id AND session.branch_id=movement.branch_id WHERE movement.tenant_id=$1 AND movement.branch_id=$2 AND session.business_date=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or((0, 0, 0));
    let movement_delta = cash_drawer_repository::movement_delta_for_date(
        &state.db,
        &tenant_id,
        &branch_id,
        business_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to calculate cash drawer movements"))?;
    let approved_outgoing = cash_drawer_repository::approved_outgoing_cash_for_date(
        &state.db,
        &tenant_id,
        &branch_id,
        business_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to calculate approved cash outgoing"))?;
    let payment_modes = sqlx::query_as::<_, PaymentModeReportRow>(
        "SELECT pp.method, COUNT(*)::BIGINT AS payment_count, COALESCE(SUM(pp.amount_paise),0)::BIGINT AS amount_paise, COUNT(DISTINCT pp.sale_id)::BIGINT AS invoice_count FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND ps.business_date=$3 GROUP BY pp.method ORDER BY amount_paise DESC",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_all(&state.db).await.unwrap_or_default();
    let deposits = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COALESCE(SUM(d.amount_paise) FILTER (WHERE d.status='confirmed'),0)::BIGINT, COALESCE(SUM(d.amount_paise) FILTER (WHERE d.status='pending'),0)::BIGINT FROM cash_drawer_bank_deposits d JOIN cash_drawer_sessions s ON s.id=d.drawer_session_id AND s.tenant_id=d.tenant_id AND s.branch_id=d.branch_id WHERE d.tenant_id=$1 AND d.branch_id=$2 AND s.business_date=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or((0, 0));
    let reconciliation_exceptions = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM pos_provider_reconciliation_runs WHERE tenant_id=$1 AND branch_id=$2 AND settlement_date=$3 AND status='review_required'",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or(0);
    let (opening, counted, variance, status) =
        session.unwrap_or((0, None, None, "not_opened".to_string()));
    let cash_out = movement.1.saturating_add(approved_outgoing);
    let expected = opening + cash_sales + movement_delta - approved_outgoing;
    let reveal_expected = status == "closed" || (status == "pending_approval" && approver);
    Ok(Json(ApiResponse::ok(CashDrawerEodReport {
        business_date,
        opening_cash_paise: opening,
        cash_sales_paise: cash_sales,
        cash_refunds_paise: movement.2,
        cash_in_paise: movement.0,
        cash_out_paise: cash_out,
        expected_cash_paise: reveal_expected.then_some(expected),
        counted_cash_paise: counted,
        variance_paise: reveal_expected
            .then_some(variance.or_else(|| counted.map(|value| value - expected)))
            .flatten(),
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

async fn report_staff_service_history(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffServiceHistoryQuery>,
) -> ApiResult<Value> {
    if !matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager" | "super-admin" | "superadmin"
    ) {
        return Err(AppError::forbidden(
            "staff service history requires a manager role",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let history = staff_app_service::appointment_history(
        &state.db,
        &tenant_id,
        &branch_id,
        staff_app_service::AppointmentHistoryQuery {
            staff_id: query.staff_id.as_deref().unwrap_or(""),
            from: query.start_date,
            to: query.end_date,
            page: query.page.unwrap_or(1),
            page_size: query.page_size.unwrap_or(50),
            query: query.q.as_deref().unwrap_or(""),
            status: query.status.as_deref().unwrap_or(""),
            service_id: "",
            service: query.service.as_deref().unwrap_or(""),
            department: query.department.as_deref().unwrap_or(""),
            sort: query.sort.as_deref().unwrap_or("desc"),
            include_client_names: true,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(history)))
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
