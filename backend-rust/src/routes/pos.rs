use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderName, HeaderValue},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::cash_drawer_repository,
    repositories::happy_hours_repository,
    repositories::invoice_settings_repository,
    repositories::payment_methods_repository::{
        self, CreatePaymentMethod, PaymentMethodRecord, UpdatePaymentMethod,
    },
    repositories::pos_enterprise_repository,
    repositories::wallet_repository::{self, StoreCreditIssue, StoreCreditWriteResult},
    routes::context::{current_business_date, tenant_branch},
    services::accounting_service,
    services::auth_service::AuthClaims,
    services::cash_drawer_service,
    services::client_service,
    services::happy_hours_service,
    services::inventory_adjustment_service,
    services::invoice_delivery,
    services::invoice_numbering_service,
    services::invoice_pdf::{self, InvoicePdfLayout},
    services::membership_service,
    services::payment_gateway_service,
    services::payment_link_access_service,
    services::payment_platform_service,
    services::razorpay_payment_service,
    services::security_service,
    services::wallet_service,
    state::{AppState, AppointmentEvent},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos", get(pos_dashboard))
        .route("/pos/payment-methods", get(pos_payment_methods))
        .route(
            "/pos/coupons",
            get(list_pos_coupons).post(create_pos_coupon),
        )
        .route("/pos/coupons/preview", post(preview_pos_coupon))
        .route("/pos/coupons/analytics", get(get_coupon_analytics))
        .route(
            "/pos/discount-rules",
            get(list_pos_discount_rules).post(create_pos_discount_rule),
        )
        .route(
            "/settings/payment-methods",
            get(pos_payment_method_settings).post(create_pos_payment_method),
        )
        .route(
            "/settings/payment-methods/initialize",
            post(initialize_pos_payment_methods),
        )
        .route(
            "/settings/payment-methods/:id",
            axum::routing::patch(update_pos_payment_method),
        )
        .route(
            "/settings/invoice-business-profile",
            get(get_invoice_business_profile).put(update_invoice_business_profile),
        )
        .route(
            "/settings/invoice-appearance",
            get(get_invoice_appearance_settings).put(update_invoice_appearance_settings),
        )
        .route(
            "/settings/invoice-compliance",
            get(get_invoice_compliance_settings).put(update_invoice_compliance_settings),
        )
        .route("/pos/sales", get(list_pos_sales).post(create_pos_sale))
        .route("/pos/offline-checkout", post(sync_offline_checkout))
        .route(
            "/pos/offline-checkout/:operation_id",
            get(get_offline_checkout),
        )
        .route(
            "/pos/invoices",
            get(list_pos_sales).post(create_pos_invoice),
        )
        .route("/pos/invoices/draft", post(create_pos_invoice_draft))
        .route(
            "/pos/invoices/:id",
            get(get_pos_sale).put(replace_pos_invoice_draft),
        )
        .route("/pos/invoices/:id/print", get(get_pos_invoice_print))
        .route("/pos/invoices/:id/pdf", get(get_pos_invoice_pdf))
        .route("/pos/compliance/queue", get(get_compliance_queue))
        .route("/pos/invoices/:id/compliance", get(get_invoice_compliance))
        .route(
            "/pos/invoices/:id/compliance/queue",
            post(queue_invoice_compliance),
        )
        .route("/pos/invoices/:id/basic", get(get_pos_invoice_print))
        .route(
            "/pos/invoices/:id/payment-links",
            get(list_pos_payment_links).post(create_pos_payment_link),
        )
        .route(
            "/pos/invoices/:id/payment-instruments",
            get(list_invoice_payment_instruments),
        )
        .route(
            "/pos/invoices/:id/disputes",
            get(list_invoice_payment_disputes),
        )
        .route(
            "/pos/payment-instruments/:id/revoke",
            post(revoke_payment_instrument),
        )
        .route(
            "/pos/invoices/:id/payment-links/:link_id/reconcile",
            post(reconcile_pos_payment_link),
        )
        .route(
            "/pos/invoices/:id/history",
            get(list_pos_invoice_action_history),
        )
        .route(
            "/pos/invoices/:id/consumption",
            get(list_pos_invoice_consumption),
        )
        .route(
            "/pos/invoices/:id/deliveries",
            get(list_pos_invoice_deliveries),
        )
        .route(
            "/pos/invoices/:id/ledger/verify",
            get(verify_pos_invoice_ledger),
        )
        .route("/pos/invoices/:id/actions", post(record_pos_invoice_action))
        .route("/pos/invoices/:id/send", post(record_pos_invoice_action))
        .route("/pos/invoices/:id/resume", post(resume_pos_invoice))
        .route(
            "/pos/invoices/:id/delete-request",
            post(request_pos_invoice_delete),
        )
        .route(
            "/pos/invoice-delete-requests",
            get(list_pos_invoice_delete_requests),
        )
        .route(
            "/pos/invoice-delete-requests/:request_id/decision",
            post(decide_pos_invoice_delete),
        )
        .route(
            "/pos/invoices/:id/correction-requests",
            get(list_pos_invoice_correction_requests).post(request_pos_invoice_correction),
        )
        .route(
            "/pos/invoice-correction-requests/:request_id/decision",
            post(decide_pos_invoice_correction),
        )
        .route("/pos/invoices/:id/items", post(add_pos_invoice_line))
        .route(
            "/pos/invoices/:id/items/:line_id",
            axum::routing::patch(update_pos_invoice_line).delete(delete_pos_invoice_line),
        )
        .route("/pos/invoices/:id/finalize", post(finalize_pos_invoice))
        .route("/pos/invoices/:id/void", post(void_pos_invoice))
        .route("/pos/invoices/:id/refund", post(refund_pos_invoice))
        .route(
            "/pos/invoices/:id/credit-note",
            post(credit_note_pos_invoice),
        )
        .route(
            "/billing/invoices",
            get(list_pos_sales).post(create_pos_invoice),
        )
        .route("/billing/invoices/draft", post(create_pos_invoice_draft))
        .route("/billing/invoices/:id", get(get_pos_sale))
        .route("/billing/invoices/:id/print", get(get_pos_invoice_print))
        .route("/billing/invoices/:id/pdf", get(get_pos_invoice_pdf))
        .route("/billing/invoices/:id/basic", get(get_pos_invoice_print))
        .route(
            "/billing/invoices/:id/payment-links",
            get(list_pos_payment_links).post(create_pos_payment_link),
        )
        .route(
            "/billing/invoices/:id/payment-links/:link_id/reconcile",
            post(reconcile_pos_payment_link),
        )
        .route(
            "/billing/invoices/:id/history",
            get(list_pos_invoice_action_history),
        )
        .route(
            "/billing/invoices/:id/actions",
            post(record_pos_invoice_action),
        )
        .route(
            "/billing/invoices/:id/send",
            post(record_pos_invoice_action),
        )
        .route("/billing/invoices/:id/add-item", post(add_pos_invoice_line))
        .route(
            "/billing/invoices/:id/items/:line_id",
            axum::routing::patch(update_pos_invoice_line).delete(delete_pos_invoice_line),
        )
        .route("/billing/invoices/:id/payment", post(add_pos_payment))
        .route("/billing/invoices/:id/finalize", post(finalize_pos_invoice))
        .route("/billing/invoices/:id/void", post(void_pos_invoice))
        .route("/billing/invoices/:id/refund", post(refund_pos_invoice))
        .route(
            "/billing/invoices/:id/credit-note",
            post(credit_note_pos_invoice),
        )
        .route("/sales/checkout", post(create_pos_checkout))
        .route(
            "/pos/sales/:id",
            get(get_pos_sale)
                .patch(update_pos_sale)
                .delete(delete_pos_sale),
        )
        .route("/pos/sales/:id/void", post(void_pos_invoice))
        .route("/pos/sales/:id/refund", post(refund_pos_invoice))
        .route("/pos/sales/:id/credit-note", post(credit_note_pos_invoice))
        .route("/pos/sales/:id/print", get(get_pos_invoice_print))
        .route("/pos/sales/:id/pdf", get(get_pos_invoice_pdf))
        .route("/pos/sales/:id/basic", get(get_pos_invoice_print))
        .route(
            "/pos/sales/:id/history",
            get(list_pos_invoice_action_history),
        )
        .route("/pos/sales/:id/actions", post(record_pos_invoice_action))
        .route("/pos/sales/:id/send", post(record_pos_invoice_action))
        .route("/pos/sales-register", get(get_pos_sales_register))
        .route("/pos/sales/register", get(get_pos_sales_register))
        .route("/billing/sales-register", get(get_pos_sales_register))
        .route("/billing/sales/register", get(get_pos_sales_register))
        .route("/pos/clients/:id/kpi", get(get_pos_client_kpi))
        .route(
            "/pos/clients/:id/unpaid-payments",
            post(receive_pos_client_unpaid),
        )
        .route(
            "/pos/appointments/:id/deposit",
            get(get_pos_appointment_deposit),
        )
        .route("/billing/clients/:id/kpi", get(get_pos_client_kpi))
        .route("/pos/gift-cards", post(create_pos_gift_card))
        .route("/pos/sales/:id/payments", post(add_pos_payment))
        .route("/pos/invoices/:id/payments", post(add_pos_payment))
        .route("/invoices/:id/payments", post(add_pos_payment))
        .route("/pos/payments", get(list_pos_payments))
        .route(
            "/pos/happy-hours/rules",
            get(list_happy_hour_rules).post(create_happy_hour_rule),
        )
        .route(
            "/pos/happy-hours/rules/:id",
            axum::routing::patch(update_happy_hour_rule),
        )
        .route(
            "/pos/happy-hours/control-tower",
            get(get_happy_hours_control_tower),
        )
        .route(
            "/pos/happy-hours/branch-leaderboard",
            get(get_happy_hour_branch_leaderboard),
        )
        .route(
            "/pos/happy-hours/client-returns",
            get(get_happy_hour_client_returns),
        )
        .route(
            "/pos/happy-hours/elasticity-pricing",
            get(get_happy_hour_elasticity_pricing),
        )
        .route(
            "/pos/happy-hours/rule-conflicts",
            get(get_happy_hour_rule_conflicts),
        )
        .route("/pos/happy-hours/simulate", post(simulate_happy_hour_rule))
        .route(
            "/pos/happy-hours/approvals",
            get(list_happy_hour_approvals).post(request_happy_hour_approval),
        )
        .route(
            "/pos/happy-hours/approvals/:id",
            axum::routing::patch(decide_happy_hour_approval),
        )
        .route(
            "/pos/happy-hours/discount-approvals",
            get(list_discount_approvals).post(request_discount_approval),
        )
        .route(
            "/pos/happy-hours/discount-approvals/:id",
            axum::routing::patch(decide_discount_approval),
        )
        .route(
            "/pos/happy-hours/coupon-abuse/alerts",
            get(list_coupon_abuse_alerts),
        )
        .route(
            "/pos/happy-hours/coupon-abuse/scan",
            post(scan_coupon_abuse),
        )
        .route(
            "/pos/happy-hours/coupon-abuse/alerts/:id",
            axum::routing::patch(resolve_coupon_abuse_alert),
        )
        .route("/pos/happy-hours/anomalies", get(list_happy_hour_anomalies))
        .route(
            "/pos/happy-hours/anomalies/scan",
            post(scan_happy_hour_anomalies),
        )
        .route(
            "/pos/happy-hours/anomalies/:id",
            axum::routing::patch(review_happy_hour_anomaly),
        )
        .route(
            "/pos/happy-hours/fraud-guard/cases",
            get(list_happy_hour_fraud_cases),
        )
        .route(
            "/pos/happy-hours/fraud-guard/scan",
            post(scan_happy_hour_fraud_cases),
        )
        .route(
            "/pos/happy-hours/fraud-guard/cases/:id",
            axum::routing::patch(review_happy_hour_fraud_case),
        )
        .route(
            "/pos/happy-hours/budget",
            get(get_happy_hour_budget).post(save_happy_hour_budget),
        )
        .route("/pos/happy-hours/audit", get(get_happy_hour_audit))
        .route(
            "/pos/happy-hours/intelligence",
            get(get_happy_hours_intelligence),
        )
        .route(
            "/pos/happy-hours/audiences",
            get(list_happy_hour_audiences).post(save_happy_hour_audience),
        )
        .route(
            "/pos/happy-hours/audiences/preview",
            post(preview_happy_hour_audience),
        )
        .route(
            "/pos/happy-hours/audiences/:id/status",
            axum::routing::patch(update_happy_hour_audience_status),
        )
        .route(
            "/pos/happy-hours/campaign-links",
            get(list_happy_hour_campaign_links).post(save_happy_hour_campaign_link),
        )
        .route(
            "/pos/happy-hours/campaign-links/:id/status",
            axum::routing::patch(update_happy_hour_campaign_link_status),
        )
        .route(
            "/pos/happy-hours/market-aware/observations",
            get(list_happy_hour_market_observations).post(save_happy_hour_market_observation),
        )
        .route(
            "/pos/happy-hours/market-aware/evaluate",
            post(evaluate_happy_hour_market_offer),
        )
        .route(
            "/pos/happy-hours/market-aware/suggestions",
            get(list_happy_hour_market_suggestions).post(save_happy_hour_market_suggestion),
        )
        .route(
            "/pos/happy-hours/market-aware/suggestions/:id/status",
            axum::routing::patch(update_happy_hour_market_suggestion_status),
        )
        .route(
            "/pos/happy-hours/context-aware/evaluate",
            post(evaluate_happy_hour_context_offer),
        )
        .route(
            "/pos/happy-hours/context-aware/suggestions",
            get(list_happy_hour_context_suggestions).post(save_happy_hour_context_suggestion),
        )
        .route(
            "/pos/happy-hours/context-aware/suggestions/:id/status",
            axum::routing::patch(update_happy_hour_context_suggestion_status),
        )
        .route(
            "/pos/happy-hours/auto-sunset/policy",
            get(get_happy_hour_auto_sunset_policy).post(save_happy_hour_auto_sunset_policy),
        )
        .route(
            "/pos/happy-hours/auto-sunset/decisions",
            get(list_happy_hour_auto_sunset_decisions),
        )
        .route(
            "/pos/happy-hours/auto-sunset/scan",
            post(scan_happy_hour_auto_sunset),
        )
        .route(
            "/pos/happy-hours/auto-sunset/decisions/:id/apply",
            post(apply_happy_hour_auto_sunset_decision),
        )
        .route(
            "/pos/invoice-outbox/process-due",
            post(process_due_invoice_outbox),
        )
        .route(
            "/pos/invoice-outbox/schedule-due-reminders",
            post(schedule_due_invoice_reminders),
        )
        .route(
            "/pos/invoice-outbox/:id/delivery-status",
            post(record_invoice_delivery_status),
        )
        .route("/reports/invoices", get(get_invoice_report))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosListQuery {
    pub q: Option<String>,
    pub status: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSalePayload {
    pub client_id: Option<String>,
    pub customer_id: Option<String>,
    pub staff_id: Option<String>,
    pub source: Option<String>,
    pub reference_id: Option<String>,
    pub lines: Option<Vec<PosSaleLineInput>>,
    pub items: Option<Vec<PosSaleLineInput>>,
    pub payments: Option<Vec<PosPaymentInput>>,
    #[serde(alias = "package_redemptions")]
    pub package_redemptions: Option<Value>,
    pub discount_paise: Option<i64>,
    pub bill_discount_paise: Option<i64>,
    pub discount: Option<f64>,
    pub discount_mode: Option<String>,
    pub coupon_code: Option<String>,
    pub coupon_discount_paise: Option<i64>,
    pub coupon_discount: Option<f64>,
    pub reward_discount_paise: Option<i64>,
    pub discount_reason: Option<String>,
    pub tip_paise: Option<i64>,
    pub tip_total: Option<f64>,
    pub tip_splits: Option<Value>,
    #[serde(alias = "roundTotal", alias = "round_total")]
    pub round_to_nearest_rupee: Option<bool>,
    pub status: Option<String>,
    #[serde(alias = "force_unpaid")]
    pub force_unpaid: Option<bool>,
    pub invoice_type: Option<String>,
    pub buyer_gstin: Option<String>,
    pub place_of_supply_state_code: Option<String>,
    pub reverse_charge: Option<bool>,
    pub cash_drawer_till_id: Option<String>,
    pub terminal_id: Option<String>,
    pub cart_version: Option<i64>,
    pub separate_group_invoice: Option<bool>,
    #[serde(alias = "wallet_credit_paise")]
    pub wallet_credit_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineCheckoutRequest {
    operation_id: String,
    checkout: PosSalePayload,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinalizeRequest {
    pub cash_drawer_till_id: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct OfflineCheckoutOperation {
    operation_id: String,
    sale_id: String,
    status: String,
    last_error: String,
    created_at: DateTime<Utc>,
    updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSaleLineInput {
    pub line_type: Option<String>,
    pub item_type: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub item_id: Option<String>,
    pub id: Option<String>,
    pub item_name: Option<String>,
    pub name: Option<String>,
    pub staff_id: Option<String>,
    pub assigned_staff_id: Option<String>,
    #[serde(alias = "staff_splits")]
    pub staff_splits: Option<Value>,
    pub quantity: Option<i64>,
    pub unit_price_paise: Option<i64>,
    pub price_paise: Option<i64>,
    pub unit_price: Option<f64>,
    pub price: Option<f64>,
    pub other_fee_paise: Option<i64>,
    pub discount_paise: Option<i64>,
    pub discount_amount_paise: Option<i64>,
    pub discount_value: Option<f64>,
    pub discount_type: Option<String>,
    pub tax_percent: Option<i32>,
    pub gst_percent: Option<i32>,
    pub tax_rate: Option<f64>,
    pub gst_rate: Option<f64>,
    pub hsn_sac_code: Option<String>,
    pub hsn_code: Option<String>,
    pub sac_code: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentInput {
    pub method: Option<String>,
    pub mode: Option<String>,
    pub amount_paise: Option<i64>,
    pub amount: Option<f64>,
    pub method_reference: Option<String>,
    pub reference: Option<String>,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub idempotency_key: Option<String>,
    pub cash_drawer_till_id: Option<String>,
    pub paid_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PosClientDueAllocation {
    invoice_id: String,
    invoice_number: String,
    payment_id: String,
    balance_before_paise: i64,
    received_paise: i64,
    balance_after_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PosClientDueReceiptResponse {
    receipt_id: String,
    client_id: String,
    method: String,
    requested_paise: i64,
    received_paise: i64,
    unpaid_before_paise: i64,
    unpaid_after_paise: i64,
    allocations: Vec<PosClientDueAllocation>,
    paid_at: Option<DateTime<Utc>>,
    received_by_user_id: String,
}

#[derive(Debug, FromRow)]
struct PosClientDueReceiptRow {
    id: String,
    client_id: String,
    method: String,
    requested_paise: i64,
    received_paise: i64,
    unpaid_before_paise: i64,
    unpaid_after_paise: i64,
    allocations_json: Value,
    paid_at: Option<DateTime<Utc>>,
    received_by_user_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AppointmentPosDraft {
    pub sale_id: String,
    pub total_paise: i64,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoShowChargeResult {
    pub sale_id: String,
    pub amount_paise: i64,
    pub payment_link: Option<PosPaymentLinkResponse>,
    pub activation_required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomerCommerceCheckout {
    pub sale_id: String,
    pub invoice_id: String,
    pub amount_paise: i64,
    pub status: String,
    pub payment_required: bool,
    pub activation_required: bool,
    pub payment_link: Option<PosPaymentLinkResponse>,
}

pub(crate) fn appointment_service_line(
    service_id: String,
    service_name: String,
    staff_id: String,
    price_paise: i64,
    gst_percent: i32,
    sac_code: String,
) -> PosSaleLineInput {
    PosSaleLineInput {
        line_type: Some("service".to_string()),
        item_id: Some(service_id),
        item_name: Some(service_name),
        staff_id: Some(staff_id),
        quantity: Some(1),
        unit_price_paise: Some(price_paise),
        tax_percent: Some(gst_percent),
        hsn_sac_code: Some(sac_code),
        ..PosSaleLineInput::default()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentLinkRequest {
    pub provider: Option<String>,
    pub amount_paise: Option<i64>,
    pub expires_at: Option<DateTime<Utc>>,
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvoiceComplianceSettingsRequest {
    annual_turnover_paise: i64,
    e_invoice_enabled: bool,
    e_invoice_threshold_paise: Option<i64>,
    e_way_bill_enabled: bool,
    e_way_bill_threshold_paise: Option<i64>,
    auto_queue_e_invoice: bool,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceComplianceSettings {
    annual_turnover_paise: i64,
    e_invoice_enabled: bool,
    e_invoice_threshold_paise: i64,
    e_way_bill_enabled: bool,
    e_way_bill_threshold_paise: i64,
    auto_queue_e_invoice: bool,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceComplianceRecord {
    e_invoice_status: String,
    e_way_bill_status: String,
    eligibility: Value,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InvoiceComplianceDetails {
    #[serde(flatten)]
    record: InvoiceComplianceRecord,
    jobs: Vec<ComplianceJobStatus>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ComplianceJobStatus {
    document_type: String,
    status: String,
    attempt_count: i32,
    provider_reference: String,
    last_error: String,
    next_attempt_at: DateTime<Utc>,
    submitted_at: Option<DateTime<Utc>>,
    result: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceQueueRequest {
    e_invoice: Option<bool>,
    e_way_bill: Option<bool>,
    movement_required: Option<bool>,
}

#[derive(Debug, Clone)]
struct BookingAdvanceAllocation {
    payment_link_id: String,
    provider: String,
    reference: String,
    amount_paise: i64,
    paid_at: Option<DateTime<Utc>>,
    accounted_at_collection: bool,
}

#[derive(Debug, FromRow)]
struct AvailableBookingAdvanceRow {
    payment_link_id: String,
    provider: String,
    reference: String,
    available_paise: i64,
    paid_at: Option<DateTime<Utc>>,
    accounted_at_collection: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppointmentDepositResponse {
    appointment_reference: String,
    available_paise: i64,
}

struct PreparedPayment {
    method: String,
    reference: String,
    label: String,
    amount_paise: i64,
    notes: String,
    idempotency_key: String,
    paid_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentQuery {
    pub sale_id: Option<String>,
    pub method: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodWriteRequest {
    pub name: Option<String>,
    pub settlement_type: Option<String>,
    pub shortcut: Option<String>,
    pub active: Option<bool>,
    pub show_on_invoice: Option<bool>,
    pub reference_required: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodResponse {
    pub id: String,
    pub code: String,
    pub name: String,
    pub settlement_type: String,
    pub shortcut: String,
    pub active: bool,
    pub show_on_invoice: bool,
    pub reference_required: bool,
    pub sort_order: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CouponWriteRequest {
    pub code: String,
    pub discount_type: Option<String>,
    pub discount_value_paise: Option<i64>,
    pub discount_bps: Option<i64>,
    pub min_subtotal_paise: Option<i64>,
    pub max_discount_paise: Option<i64>,
    pub active: Option<bool>,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub usage_limit: Option<i64>,
    pub per_client_limit: Option<i64>,
    pub offer_type: Option<String>,
    pub target_service_ids: Option<Vec<String>>,
    pub target_service_categories: Option<Vec<String>>,
    pub target_client_segments: Option<Vec<String>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CouponResponse {
    pub id: String,
    pub code: String,
    pub discount_type: String,
    pub discount_value_paise: i64,
    pub discount_bps: i64,
    pub min_subtotal_paise: i64,
    pub max_discount_paise: i64,
    pub active: bool,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub usage_limit: Option<i64>,
    pub used_count: i64,
    pub per_client_limit: i64,
    pub offer_type: String,
    pub target_service_ids: Vec<String>,
    pub target_service_categories: Vec<String>,
    pub target_client_segments: Vec<String>,
    pub first_visit_only: bool,
    pub referral_required: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscountRuleWriteRequest {
    pub rule_type: String,
    pub name: Option<String>,
    pub active: Option<bool>,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub max_discount_bps: Option<i64>,
    pub max_discount_paise: Option<i64>,
    pub min_payable_paise: Option<i64>,
    pub priority: Option<i32>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiscountRuleResponse {
    pub id: String,
    pub rule_type: String,
    pub name: String,
    pub active: bool,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub max_discount_bps: i64,
    pub max_discount_paise: i64,
    pub min_payable_paise: i64,
    pub priority: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSalesRegisterQuery {
    pub q: Option<String>,
    pub status: Option<String>,
    pub client_id: Option<String>,
    pub payment_method: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReportQuery {
    pub client_id: Option<String>,
    pub staff_id: Option<String>,
    pub payment_method: Option<String>,
    pub status: Option<String>,
    pub recovery: Option<String>,
    pub ageing_days: Option<i32>,
    pub follow_up: Option<bool>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReportRow {
    pub id: String,
    pub invoice_number: String,
    pub branch_id: String,
    pub client_id: String,
    pub client_name: String,
    pub staff_id: String,
    pub staff_name: String,
    pub business_date: NaiveDate,
    pub status: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub balance_paise: i64,
    pub ageing_days: i32,
    pub follow_up_required: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceActionRequest {
    pub action: Option<String>,
    pub channel: Option<String>,
    pub recipient: Option<String>,
    pub idempotency_key: Option<String>,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub template_version: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceLifecycleRequest {
    pub amount_paise: Option<i64>,
    pub amount: Option<f64>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub idempotency_key: Option<String>,
    pub lines: Option<Vec<InvoiceRefundLineInput>>,
    pub restock: Option<bool>,
    pub evidence_reference: Option<String>,
    pub mfa_code: Option<String>,
    pub refund_method: Option<String>,
    pub cash_drawer_till_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvoiceDeleteRequestPayload {
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvoiceDeleteDecisionPayload {
    status: String,
    decision_note: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvoiceDeleteRequestQuery {
    status: Option<String>,
    sale_id: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceDeleteRequestRow {
    id: String,
    sale_id: String,
    invoice_number: String,
    reason: String,
    status: String,
    requested_by_user_id: String,
    decided_by_user_id: String,
    decision_note: String,
    requested_at: DateTime<Utc>,
    decided_at: Option<DateTime<Utc>>,
    applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvoiceCorrectionLinePayload {
    id: String,
    unit_price_paise: i64,
    discount_type: String,
    discount_value_paise: i64,
    discount_bps: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvoiceCorrectionRequestPayload {
    reason: String,
    lines: Vec<InvoiceCorrectionLinePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvoiceCorrectionDecisionPayload {
    status: String,
    decision_note: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceCorrectionRequestRow {
    id: String,
    sale_id: String,
    invoice_number: String,
    reason: String,
    status: String,
    original_snapshot: Value,
    proposed_lines: Value,
    requested_by_user_id: String,
    decided_by_user_id: String,
    decision_note: String,
    requested_at: DateTime<Utc>,
    decided_at: Option<DateTime<Utc>>,
    applied_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRefundLineInput {
    pub sale_line_id: String,
    pub quantity: i64,
    pub restock_quantity: Option<i64>,
    pub discard_quantity: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceActionResponse {
    pub id: String,
    pub action: String,
    pub channel: String,
    pub recipient: String,
    pub status: String,
    pub idempotency_key: String,
    pub metadata_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HappyHourRuleRequest {
    name: String,
    start_time: NaiveTime,
    end_time: NaiveTime,
    weekdays: Vec<i16>,
    discount_bps: i32,
    eligible_line_types: Option<Vec<String>>,
    eligible_item_ids: Option<Vec<String>>,
    eligible_client_categories: Option<Vec<String>>,
    min_margin_bps: Option<i32>,
    block_on_unknown_cost: Option<bool>,
    active: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AutoSunsetScanRequest {
    apply: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AutoSunsetListQuery {
    status: Option<String>,
    severity: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BranchLeaderboardQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    sort: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientReturnQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    return_window_days: Option<i32>,
    status: Option<String>,
    offer_type: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ElasticityPricingQuery {
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
    day_of_week: Option<i32>,
    hour_slot: Option<i32>,
    service_id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuleConflictQuery {
    active_only: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GovernanceListQuery {
    status: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct HappyHourRuleRow {
    id: String,
    name: String,
    start_time: NaiveTime,
    end_time: NaiveTime,
    weekdays: Vec<i16>,
    discount_bps: i32,
    eligible_line_types: Vec<String>,
    eligible_item_ids: Vec<String>,
    eligible_client_categories: Vec<String>,
    min_margin_bps: i32,
    block_on_unknown_cost: bool,
    active: bool,
}

struct HappyHourDecision {
    rule: HappyHourRuleRow,
    eligible_paise: i64,
    line_discounts: Vec<(usize, i64)>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceDeliveryRow {
    id: String,
    channel: String,
    recipient: String,
    template_version: String,
    status: String,
    attempts: i32,
    scheduled_for: DateTime<Utc>,
    next_attempt_at: DateTime<Utc>,
    external_message_id: String,
    last_error: String,
    delivered_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryStatusRequest {
    status: String,
    provider_message_id: Option<String>,
    error: Option<String>,
}

#[derive(Debug, FromRow)]
struct OutboxDispatchRow {
    id: String,
    tenant_id: String,
    branch_id: String,
    client_id: String,
    channel: String,
    payload_json: String,
}

#[derive(Debug, FromRow)]
struct LedgerChainRow {
    event_type: String,
    actor_user_id: String,
    payload_text: String,
    previous_hash: String,
    event_hash: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSaleUpdate {
    pub status: Option<String>,
    pub staff_id: Option<String>,
    pub source: Option<String>,
    pub reference_id: Option<String>,
    /// Required to re-attribute a finalized invoice to a different staff member.
    ///
    /// Optional on a draft, where nothing has been reported or paid yet.
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSaleResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
    pub staff_id: String,
    pub invoice_number: String,
    pub subtotal_paise: i64,
    pub bill_discount_paise: i64,
    pub coupon_code: String,
    pub coupon_discount_paise: i64,
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub balance_due_paise: i64,
    pub status: String,
    pub source: String,
    pub reference_id: String,
    pub package_redemptions: Value,
    pub line_count: i64,
    pub invoice_type: String,
    pub finalized_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PosSaleDetailsResponse {
    pub sale: PosSaleResponse,
    pub invoice: PosSaleResponse,
    pub lines: Vec<PosSaleLineResponse>,
    pub payments: Vec<PosPaymentResponse>,
    pub payment_split: PosPaymentSplitResponse,
    pub client_kpi: Option<PosClientKpiResponse>,
    pub transaction_context: PosTransactionContext,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PosTransactionContext {
    pub discount_reason: String,
    pub cart_version: i64,
    pub cart_owner_terminal_id: String,
    pub buyer_gstin: String,
    pub place_of_supply_state_code: String,
    pub reverse_charge: bool,
    pub tax_mode: String,
    pub separate_group_invoice: bool,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceInventoryConsumptionRow {
    pub id: String,
    pub inventory_item_id: String,
    pub item_name: String,
    pub quantity: i64,
    pub unit_cost_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSaleLineResponse {
    pub id: String,
    pub sale_id: String,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub staff_id: String,
    pub staff_splits: Value,
    pub quantity: i64,
    pub unit_price_paise: i64,
    pub other_fee_paise: i64,
    pub gross_paise: i64,
    pub taxable_paise: i64,
    pub discount_paise: i64,
    pub discount_type: String,
    pub discount_value_paise: i64,
    pub discount_bps: i64,
    pub tax_percent: i32,
    pub gst_percent: i32,
    pub gst_paise: i64,
    pub hsn_sac_code: String,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub reverse_charge: bool,
    pub line_total_paise: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub sale_id: String,
    pub method: String,
    pub amount_paise: i64,
    pub method_reference: String,
    pub label: String,
    pub notes: String,
    pub paid_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentSplitResponse {
    pub cash_paise: i64,
    pub upi_paise: i64,
    pub card_paise: i64,
    pub bank_transfer_paise: i64,
    pub wallet_paise: i64,
    pub gift_card_paise: i64,
    pub store_credit_paise: i64,
    pub other_paise: i64,
    pub total_paid_paise: i64,
    pub balance_due_paise: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PosSalesRegisterRow {
    pub id: String,
    pub invoice_number: String,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub staff_id: String,
    pub staff_name: String,
    pub status: String,
    pub invoice_type: String,
    pub business_date: String,
    pub line_count: i64,
    pub item_names: String,
    pub subtotal_paise: i64,
    pub bill_discount_paise: i64,
    pub coupon_code: String,
    pub coupon_discount_paise: i64,
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub balance_due_paise: i64,
    pub received_due_paise: i64,
    pub cash_paise: i64,
    pub upi_paise: i64,
    pub card_paise: i64,
    pub wallet_paise: i64,
    pub gift_card_paise: i64,
    pub store_credit_paise: i64,
    pub other_paise: i64,
    pub last_payment_at: Option<DateTime<Utc>>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PosSalesRegisterTotals {
    pub total_rows: i64,
    pub subtotal_paise: i64,
    pub bill_discount_paise: i64,
    pub coupon_discount_paise: i64,
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub balance_due_paise: i64,
    pub received_due_paise: i64,
    pub cash_paise: i64,
    pub upi_paise: i64,
    pub card_paise: i64,
    pub wallet_paise: i64,
    pub gift_card_paise: i64,
    pub store_credit_paise: i64,
    pub other_paise: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosSalesRegisterResponse {
    pub rows: Vec<PosSalesRegisterRow>,
    pub totals: PosSalesRegisterTotals,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosClientKpiResponse {
    pub client_id: String,
    pub client_name: String,
    pub phone: String,
    pub wallet_paise: i64,
    pub unpaid_paise: i64,
    pub membership_name: String,
    pub membership_assigned_at: Option<DateTime<Utc>>,
    pub membership_expires_at: Option<DateTime<Utc>>,
    pub has_active_membership: bool,
    pub membership_discount_percent: i32,
    pub membership_service_ids: Value,
    pub reward_points_balance: i32,
    pub membership_credits: Value,
    pub package_credits: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PosDashboard {
    pub total_sales: i64,
    pub paid_sales: i64,
    pub outstanding_sales: i64,
    pub today_sales: i64,
    pub open_sales: i64,
    pub recent_sales: Vec<PosSaleResponse>,
}

#[derive(Debug, FromRow)]
struct PosSaleRow {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
    pub staff_id: String,
    pub invoice_number: String,
    pub subtotal_paise: i64,
    pub bill_discount_paise: i64,
    pub coupon_code: String,
    pub coupon_discount_paise: i64,
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub status: String,
    pub source: String,
    pub reference_id: String,
    pub package_redemptions: Value,
    pub invoice_type: String,
    pub finalized_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct PosLineRow {
    pub id: String,
    pub sale_id: String,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub staff_id: String,
    pub staff_splits: Value,
    pub quantity: i64,
    pub unit_price_paise: i64,
    pub other_fee_paise: i64,
    pub gross_paise: i64,
    pub taxable_paise: i64,
    pub discount_paise: i64,
    pub discount_type: String,
    pub discount_value_paise: i64,
    pub discount_bps: i64,
    pub tax_percent: i32,
    pub gst_paise: i64,
    pub hsn_sac_code: String,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub reverse_charge: bool,
    pub line_total_paise: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct PosPaymentRow {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub sale_id: String,
    pub method: String,
    pub amount_paise: i64,
    pub method_reference: String,
    pub label: String,
    pub notes: String,
    pub paid_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct PosPaymentLinkRow {
    pub id: String,
    pub sale_id: String,
    pub provider: String,
    pub provider_link_id: String,
    pub provider_reference: String,
    pub amount_paise: i64,
    pub status: String,
    pub link_url: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentLinkResponse {
    pub id: String,
    pub sale_id: String,
    pub provider: String,
    pub provider_link_id: String,
    pub provider_reference: String,
    pub amount_paise: i64,
    pub status: String,
    pub url: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    /// Sent to the guest instead of `url`. Returned once, on creation: after
    /// this it exists only in the message the guest received.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub guest_link_token: String,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ClientPaymentInstrumentResponse {
    id: String,
    provider: String,
    method_type: String,
    brand: String,
    last4: String,
    expiry_month: Option<i16>,
    expiry_year: Option<i16>,
    recurring_enabled: bool,
    status: String,
    last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct PaymentDisputeResponse {
    id: String,
    provider: String,
    provider_dispute_id: String,
    amount_paise: i64,
    currency: String,
    reason: String,
    status: String,
    evidence_due_at: Option<DateTime<Utc>>,
    opened_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct PosCouponRow {
    pub code: String,
    pub discount_type: String,
    pub discount_value_paise: i64,
    pub discount_bps: i64,
    pub min_subtotal_paise: i64,
    pub max_discount_paise: i64,
    pub active: bool,
    pub starts_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub usage_limit: Option<i64>,
    pub used_count: i64,
    pub per_client_limit: i64,
    pub target_service_ids: Vec<String>,
    pub target_service_categories: Vec<String>,
    pub target_package_ids: Vec<String>,
    pub target_client_segments: Vec<String>,
    pub first_visit_only: bool,
    pub referral_required: bool,
    pub target_client_id: Option<String>,
    pub approval_status: String,
    pub allow_membership_stacking: bool,
    pub allow_package_stacking: bool,
}

#[derive(Debug, FromRow)]
struct PosClientKpiRow {
    pub client_id: String,
    pub client_name: String,
    pub phone: String,
    pub wallet_paise: i64,
    pub unpaid_paise: i64,
    pub membership_name: String,
    pub membership_assigned_at: Option<DateTime<Utc>>,
    pub membership_expires_at: Option<DateTime<Utc>>,
    pub membership_discount_percent: i32,
    pub membership_service_ids: Value,
    pub reward_points_balance: i32,
    pub package_credits: Value,
    pub membership_credits: Value,
}

#[derive(Debug, FromRow)]
struct ClientPackageCreditRow {
    pub source_branch_id: String,
    pub credit_owner_id: String,
    pub remaining_qty: i32,
    pub unit_value_paise: i64,
    pub issued_value_paise: i64,
    pub package_id: String,
    pub package_name: String,
    pub service_id: String,
    pub service_name: String,
    pub expires_at: Option<NaiveDate>,
}

#[derive(Debug, FromRow)]
struct ClientMembershipCreditRow {
    pub source_branch_id: String,
    pub credit_owner_id: String,
    pub remaining_qty: i32,
    pub unit_value_paise: i64,
    pub issued_value_paise: i64,
    pub membership_id: String,
    pub membership_name: String,
    pub service_id: String,
    pub service_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GiftCardCreateRequest {
    code: Option<String>,
    client_id: Option<String>,
    amount_paise: i64,
    expires_at: Option<NaiveDate>,
    idempotency_key: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PosCheckoutResponse {
    pub sale: PosSaleResponse,
    pub invoice: PosSaleResponse,
    pub lines: Vec<PosSaleLineResponse>,
    pub payments: Vec<PosPaymentResponse>,
    pub payment_split: PosPaymentSplitResponse,
    pub client_kpi: Option<PosClientKpiResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PosInvoicePrintResponse {
    pub invoice: PosSaleResponse,
    pub lines: Vec<PosSaleLineResponse>,
    pub payments: Vec<PosPaymentResponse>,
    pub payment_split: PosPaymentSplitResponse,
    pub client_kpi: Option<PosClientKpiResponse>,
    pub print_html: String,
    pub pdf_file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvoicePdfQuery {
    layout: Option<String>,
}

#[derive(FromRow)]
struct InvoicePdfSnapshotRow {
    pdf_bytes: Vec<u8>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvoiceBusinessProfileRequest {
    legal_name: String,
    trade_name: Option<String>,
    is_gst_registered: bool,
    gstin: Option<String>,
    address_line1: String,
    address_line2: Option<String>,
    city: String,
    state: String,
    pincode: String,
    phone: Option<String>,
    email: Option<String>,
    upi_id: Option<String>,
    upi_payee_name: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InvoiceBusinessProfile {
    legal_name: String,
    trade_name: String,
    is_gst_registered: bool,
    gstin: String,
    address_line1: String,
    address_line2: String,
    city: String,
    state: String,
    pincode: String,
    phone: String,
    email: String,
    upi_id: String,
    upi_payee_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct InvoiceAppearanceSettings {
    layout: String,
    heading: String,
    invoice_number_prefix: String,
    thanks_message: String,
    powered_by: String,
    room_heading: String,
    terms_and_conditions: String,
    dual_language_enabled: bool,
    secondary_language_name: String,
    english_labels: InvoiceLanguageLabels,
    secondary_labels: InvoiceLanguageLabels,
    show_bill: bool,
    show_feedback_link: bool,
    show_invoice_link: bool,
    header_including_logo: bool,
    show_business_name: bool,
    show_invoice_id: bool,
    show_date_time: bool,
    show_payment_method: bool,
    show_staff: bool,
    show_time: bool,
    show_appointment_time: bool,
    show_wallet_balance: bool,
    show_pending_services: bool,
    show_client_name: bool,
    show_client_contact: bool,
    show_discount: bool,
    show_bill_notes: bool,
    show_download_button: bool,
    show_signature: bool,
    show_package_offer_price: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct InvoiceLanguageLabels {
    salon_name: String,
    email: String,
    contact: String,
    address: String,
    thanks_message: String,
    powered_by: String,
    extra_text1: String,
    extra_text2: String,
    tax_invoice_text: String,
    gstin: String,
    date: String,
    invoice_id: String,
    customer_name: String,
    customer_contact: String,
    actual_price: String,
    discount_percentage: String,
    taxable_amount: String,
    gst: String,
    total: String,
    paid: String,
    due: String,
    services: String,
    quantity: String,
    price: String,
    discount: String,
    product: String,
    package: String,
    membership: String,
    valid: String,
    staff: String,
    payment_method: String,
    appointment_time: String,
    wallet_balance: String,
    terms: String,
    signature: String,
    items: String,
    hsn_sac: String,
    subtotal: String,
    time: String,
    pending_services: String,
    bill_notes: String,
    download_invoice: String,
    feedback_link: String,
    invoice_link: String,
    status: String,
    place_of_supply: String,
    buyer_gstin: String,
    cgst: String,
    sgst: String,
    igst: String,
    reverse_charge: String,
    upi_payment: String,
}

impl InvoiceLanguageLabels {
    fn english_defaults() -> Self {
        Self {
            salon_name: "Business name".into(),
            email: "Email".into(),
            contact: "Contact".into(),
            address: "Address".into(),
            thanks_message: "Thank you".into(),
            powered_by: "Powered by".into(),
            extra_text1: "Extra text 1".into(),
            extra_text2: "Extra text 2".into(),
            tax_invoice_text: "Tax invoice".into(),
            gstin: "GSTIN".into(),
            date: "Date".into(),
            invoice_id: "Invoice ID".into(),
            customer_name: "Customer".into(),
            customer_contact: "Contact number".into(),
            actual_price: "Actual price".into(),
            discount_percentage: "Discount %".into(),
            taxable_amount: "Taxable amount".into(),
            gst: "GST".into(),
            total: "Total".into(),
            paid: "Paid".into(),
            due: "Due".into(),
            services: "Services".into(),
            quantity: "Qty".into(),
            price: "Price".into(),
            discount: "Discount".into(),
            product: "Product".into(),
            package: "Package".into(),
            membership: "Membership".into(),
            valid: "Valid".into(),
            staff: "Staff".into(),
            payment_method: "Payment method".into(),
            appointment_time: "Appointment time".into(),
            wallet_balance: "E-wallet balance".into(),
            terms: "Terms".into(),
            signature: "Signature".into(),
            items: "Item".into(),
            hsn_sac: "HSN/SAC".into(),
            subtotal: "Subtotal".into(),
            time: "Time".into(),
            pending_services: "Pending services".into(),
            bill_notes: "Bill notes".into(),
            download_invoice: "Download invoice".into(),
            feedback_link: "Feedback link".into(),
            invoice_link: "Invoice link".into(),
            status: "Status".into(),
            place_of_supply: "Place of supply".into(),
            buyer_gstin: "Buyer GSTIN".into(),
            cgst: "CGST".into(),
            sgst: "SGST".into(),
            igst: "IGST".into(),
            reverse_charge: "Reverse charge".into(),
            upi_payment: "UPI payment".into(),
        }
    }
}

impl Default for InvoiceAppearanceSettings {
    fn default() -> Self {
        Self {
            layout: "a4".to_string(),
            heading: "INVOICE".to_string(),
            invoice_number_prefix: String::new(),
            thanks_message: String::new(),
            powered_by: String::new(),
            room_heading: String::new(),
            terms_and_conditions: String::new(),
            dual_language_enabled: false,
            secondary_language_name: String::new(),
            english_labels: InvoiceLanguageLabels::english_defaults(),
            secondary_labels: InvoiceLanguageLabels::default(),
            show_bill: true,
            show_feedback_link: true,
            show_invoice_link: true,
            header_including_logo: true,
            show_business_name: true,
            show_invoice_id: true,
            show_date_time: true,
            show_payment_method: true,
            show_staff: true,
            show_time: true,
            show_appointment_time: true,
            show_wallet_balance: true,
            show_pending_services: true,
            show_client_name: true,
            show_client_contact: true,
            show_discount: true,
            show_bill_notes: true,
            show_download_button: true,
            show_signature: true,
            show_package_offer_price: true,
        }
    }
}

struct NormalizedLine {
    line_type: String,
    item_id: String,
    item_name: String,
    staff_id: String,
    staff_splits: Value,
    quantity: i64,
    unit_price_paise: i64,
    other_fee_paise: i64,
    item_discount_paise: i64,
    discount_type: String,
    discount_value_paise: i64,
    discount_bps: i64,
    tax_percent: i32,
    hsn_sac_code: String,
}

#[derive(Clone)]
struct CalculatedLine {
    line_type: String,
    item_id: String,
    item_name: String,
    staff_id: String,
    staff_splits: Value,
    quantity: i64,
    unit_price_paise: i64,
    other_fee_paise: i64,
    gross_paise: i64,
    taxable_paise: i64,
    discount_paise: i64,
    discount_type: String,
    discount_value_paise: i64,
    discount_bps: i64,
    tax_percent: i32,
    gst_paise: i64,
    hsn_sac_code: String,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    reverse_charge: bool,
    line_total_paise: i64,
}

struct PosCalculation {
    lines: Vec<CalculatedLine>,
    subtotal_paise: i64,
    bill_discount_paise: i64,
    coupon_code: String,
    coupon_discount_paise: i64,
    discount_paise: i64,
    tax_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    tip_paise: i64,
    round_off_paise: i64,
    total_paise: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PosCouponPreview {
    code: String,
    discount_paise: i64,
    tax_paise: i64,
    total_paise: i64,
}

#[derive(Clone)]
struct GstContext {
    seller_gstin: String,
    seller_state_code: String,
    buyer_gstin: String,
    place_of_supply_state_code: String,
    reverse_charge: bool,
    tax_mode: String,
}

struct LineDraft {
    id: Option<String>,
    input: PosSaleLineInput,
}

fn sale_response(sale: PosSaleRow, line_count: i64) -> PosSaleResponse {
    PosSaleResponse {
        id: sale.id,
        tenant_id: sale.tenant_id,
        branch_id: sale.branch_id,
        client_id: sale.client_id,
        staff_id: sale.staff_id,
        invoice_number: sale.invoice_number,
        subtotal_paise: sale.subtotal_paise,
        bill_discount_paise: sale.bill_discount_paise,
        coupon_code: sale.coupon_code,
        coupon_discount_paise: sale.coupon_discount_paise,
        discount_paise: sale.discount_paise,
        tax_paise: sale.tax_paise,
        tip_paise: sale.tip_paise,
        round_off_paise: sale.round_off_paise,
        total_paise: sale.total_paise,
        paid_paise: sale.paid_paise,
        balance_due_paise: sale.total_paise.saturating_sub(sale.paid_paise),
        status: sale.status,
        source: sale.source,
        reference_id: sale.reference_id,
        package_redemptions: sale.package_redemptions,
        line_count,
        invoice_type: sale.invoice_type,
        finalized_at: sale.finalized_at,
        created_at: sale.created_at,
        updated_at: sale.updated_at,
    }
}

fn sale_select_sql() -> &'static str {
    r#"
    SELECT id, tenant_id, branch_id, client_id, staff_id, invoice_number,
           subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
           tip_paise, round_off_paise, total_paise, paid_paise,
           status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at
    FROM pos_sales
    "#
}

fn sale_is_line_editable(status: &str) -> bool {
    status == "draft"
}

fn line_input_from_row(row: &PosLineRow) -> PosSaleLineInput {
    let amount_discount = if row.discount_type == "amount" {
        Some(if row.discount_value_paise > 0 {
            row.discount_value_paise
        } else {
            row.discount_paise
        })
    } else {
        None
    };
    let percent_discount = if row.discount_type == "percent" && row.discount_bps > 0 {
        Some(row.discount_bps as f64 / 100.0)
    } else {
        None
    };

    PosSaleLineInput {
        line_type: Some(row.line_type.clone()),
        item_type: None,
        kind: None,
        item_id: Some(row.item_id.clone()),
        id: None,
        item_name: Some(row.item_name.clone()),
        name: None,
        staff_id: Some(row.staff_id.clone()),
        assigned_staff_id: None,
        staff_splits: Some(row.staff_splits.clone()),
        quantity: Some(row.quantity),
        unit_price_paise: Some(row.unit_price_paise),
        price_paise: None,
        unit_price: None,
        price: None,
        other_fee_paise: Some(row.other_fee_paise),
        discount_paise: None,
        discount_amount_paise: amount_discount,
        discount_value: percent_discount,
        discount_type: Some(row.discount_type.clone()),
        tax_percent: Some(row.tax_percent),
        gst_percent: Some(row.tax_percent),
        tax_rate: None,
        gst_rate: None,
        hsn_sac_code: Some(row.hsn_sac_code.clone()),
        hsn_code: None,
        sac_code: None,
    }
}

fn merge_line_input(mut current: PosSaleLineInput, patch: PosSaleLineInput) -> PosSaleLineInput {
    if patch.line_type.is_some() {
        current.line_type = patch.line_type;
    }
    if patch.item_type.is_some() {
        current.item_type = patch.item_type;
    }
    if patch.kind.is_some() {
        current.kind = patch.kind;
    }
    if patch.item_id.is_some() {
        current.item_id = patch.item_id;
    }
    if patch.id.is_some() {
        current.id = patch.id;
    }
    if patch.item_name.is_some() {
        current.item_name = patch.item_name;
    }
    if patch.name.is_some() {
        current.name = patch.name;
    }
    if patch.staff_id.is_some() {
        current.staff_id = patch.staff_id;
    }
    if patch.assigned_staff_id.is_some() {
        current.assigned_staff_id = patch.assigned_staff_id;
    }
    if patch.staff_splits.is_some() {
        current.staff_splits = patch.staff_splits;
    }
    if patch.quantity.is_some() {
        current.quantity = patch.quantity;
    }
    if patch.unit_price_paise.is_some() {
        current.unit_price_paise = patch.unit_price_paise;
    }
    if patch.price_paise.is_some() {
        current.price_paise = patch.price_paise;
    }
    if patch.unit_price.is_some() {
        current.unit_price = patch.unit_price;
    }
    if patch.price.is_some() {
        current.price = patch.price;
    }
    if patch.other_fee_paise.is_some() {
        current.other_fee_paise = patch.other_fee_paise;
    }
    if patch.discount_paise.is_some() {
        current.discount_paise = patch.discount_paise;
    }
    if patch.discount_amount_paise.is_some() {
        current.discount_amount_paise = patch.discount_amount_paise;
    }
    if patch.discount_value.is_some() {
        current.discount_value = patch.discount_value;
    }
    if patch.discount_type.is_some() {
        current.discount_type = patch.discount_type;
    }
    if patch.tax_percent.is_some() {
        current.tax_percent = patch.tax_percent;
    }
    if patch.gst_percent.is_some() {
        current.gst_percent = patch.gst_percent;
    }
    if patch.tax_rate.is_some() {
        current.tax_rate = patch.tax_rate;
    }
    if patch.gst_rate.is_some() {
        current.gst_rate = patch.gst_rate;
    }
    if patch.hsn_sac_code.is_some() {
        current.hsn_sac_code = patch.hsn_sac_code;
    }
    if patch.hsn_code.is_some() {
        current.hsn_code = patch.hsn_code;
    }
    if patch.sac_code.is_some() {
        current.sac_code = patch.sac_code;
    }
    current
}

fn line_payload_for_recalc(sale: &PosSaleRow, drafts: &[LineDraft]) -> PosSalePayload {
    PosSalePayload {
        client_id: Some(sale.client_id.clone()),
        customer_id: None,
        staff_id: Some(sale.staff_id.clone()),
        source: Some(sale.source.clone()),
        reference_id: Some(sale.reference_id.clone()),
        lines: Some(drafts.iter().map(|line| line.input.clone()).collect()),
        items: None,
        payments: None,
        package_redemptions: Some(sale.package_redemptions.clone()),
        discount_paise: None,
        bill_discount_paise: Some(sale.bill_discount_paise),
        discount: None,
        discount_mode: None,
        coupon_code: Some(sale.coupon_code.clone()),
        coupon_discount_paise: Some(sale.coupon_discount_paise),
        coupon_discount: None,
        reward_discount_paise: None,
        discount_reason: None,
        tip_paise: Some(sale.tip_paise),
        tip_total: None,
        tip_splits: None,
        round_to_nearest_rupee: Some(sale.round_off_paise != 0),
        status: Some(sale.status.clone()),
        force_unpaid: None,
        invoice_type: Some(sale.invoice_type.clone()),
        buyer_gstin: None,
        place_of_supply_state_code: None,
        reverse_charge: None,
        cash_drawer_till_id: None,
        terminal_id: None,
        cart_version: None,
        separate_group_invoice: None,
        wallet_credit_paise: None,
    }
}

fn payment_response(row: PosPaymentRow) -> PosPaymentResponse {
    PosPaymentResponse {
        id: row.id,
        tenant_id: row.tenant_id,
        branch_id: row.branch_id,
        sale_id: row.sale_id,
        method: row.method,
        amount_paise: row.amount_paise,
        method_reference: row.method_reference,
        label: row.label,
        notes: row.notes,
        paid_at: row.paid_at,
        created_at: row.created_at,
    }
}

fn validate_paid_at(paid_at: Option<DateTime<Utc>>) -> Result<Option<DateTime<Utc>>, AppError> {
    if paid_at
        .as_ref()
        .is_some_and(|value| *value > Utc::now() + chrono::Duration::minutes(5))
    {
        return Err(AppError::validation(
            "paidAt cannot be more than five minutes in the future",
        ));
    }
    Ok(paid_at)
}

fn normalize_payment_method(raw: Option<String>) -> Result<String, AppError> {
    let token = raw.unwrap_or_else(|| "cash".to_string());
    let token = token
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .replace(' ', "_");

    let method = match token.as_str() {
        "" | "cash" => "cash",
        "upi" | "upi_qr" | "qr" => "upi",
        "card" | "credit_card" | "debit_card" => "card",
        "wallet" | "e_wallet" | "ewallet" => "wallet",
        "gift_card" | "giftcard" | "gift" => "gift_card",
        "store_credit" | "storecredit" | "credit" => "store_credit",
        "bank_transfer" | "banktransfer" | "bank" | "online" | "online_payment" | "netbanking"
        | "neft" | "imps" | "rtgs" => "bank_transfer",
        "other" => "other",
        _ => {
            return Err(AppError::validation(
                "payment method must be cash, upi, card, wallet, gift_card, store_credit, or bank_transfer",
            ));
        }
    };

    Ok(method.to_string())
}

fn normalize_register_date(raw: Option<String>, field: &str) -> Result<String, AppError> {
    let value = raw.unwrap_or_default().trim().to_string();
    if value.is_empty() {
        return Ok(String::new());
    }

    if NaiveDate::parse_from_str(&value, "%Y-%m-%d").is_err() {
        let message = if field == "dateFrom" {
            "dateFrom must be YYYY-MM-DD"
        } else {
            "dateTo must be YYYY-MM-DD"
        };
        return Err(AppError::validation(message));
    }

    Ok(value)
}

fn default_payment_label(method: &str) -> String {
    match method {
        "cash" => "Cash",
        "upi" => "UPI",
        "card" => "Card",
        "wallet" => "Wallet",
        "gift_card" => "Gift Card",
        "store_credit" => "Store Credit",
        "bank_transfer" => "Bank Transfer",
        "other" => "Other",
        _ => "Payment",
    }
    .to_string()
}

fn payment_split_response(
    payments: &[PosPaymentResponse],
    total_paise: i64,
) -> PosPaymentSplitResponse {
    let mut split = PosPaymentSplitResponse {
        cash_paise: 0,
        upi_paise: 0,
        card_paise: 0,
        bank_transfer_paise: 0,
        wallet_paise: 0,
        gift_card_paise: 0,
        store_credit_paise: 0,
        other_paise: 0,
        total_paid_paise: 0,
        balance_due_paise: 0,
    };

    for payment in payments {
        let amount = payment.amount_paise.max(0);
        split.total_paid_paise = split.total_paid_paise.saturating_add(amount);
        match payment.method.as_str() {
            "cash" => split.cash_paise = split.cash_paise.saturating_add(amount),
            "upi" => split.upi_paise = split.upi_paise.saturating_add(amount),
            "card" => split.card_paise = split.card_paise.saturating_add(amount),
            "bank_transfer" => {
                split.bank_transfer_paise = split.bank_transfer_paise.saturating_add(amount)
            }
            "wallet" => split.wallet_paise = split.wallet_paise.saturating_add(amount),
            "gift_card" | "giftCard" => {
                split.gift_card_paise = split.gift_card_paise.saturating_add(amount)
            }
            "store_credit" | "storeCredit" => {
                split.store_credit_paise = split.store_credit_paise.saturating_add(amount)
            }
            _ => split.other_paise = split.other_paise.saturating_add(amount),
        }
    }

    split.balance_due_paise = total_paise.saturating_sub(split.total_paid_paise);
    split
}

fn escape_invoice_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn format_invoice_money_html(paise: i64) -> String {
    let sign = if paise < 0 { "-" } else { "" };
    let amount = paise.saturating_abs();
    format!("{}&#8377;{}.{:02}", sign, amount / 100, amount % 100)
}

fn format_invoice_date(date: &DateTime<Utc>) -> String {
    date.format("%d/%m/%Y").to_string()
}

fn format_invoice_date_text(value: &str) -> String {
    let date_text = value.get(0..10).unwrap_or(value);
    NaiveDate::parse_from_str(date_text, "%Y-%m-%d")
        .map(|date| date.format("%d/%m/%Y").to_string())
        .unwrap_or_else(|_| value.to_string())
}

fn invoice_print_file_name(invoice_number: &str, extension: &str) -> String {
    let mut safe = invoice_number
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if safe.trim().is_empty() {
        safe = "invoice".to_string();
    }
    format!("{}.{}", safe, extension)
}

fn invoice_json_string(row: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| row.get(*key))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn invoice_json_i64(row: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| row.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
        })
        .unwrap_or(0)
}

fn invoice_package_redemption_rows(raw: &Value) -> String {
    raw.as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let quantity = invoice_json_i64(row, &["quantity", "qty"]);
            if quantity <= 0 {
                return None;
            }
            let package = invoice_json_string(row, &["packageName", "package_name"]);
            let service = invoice_json_string(row, &["serviceName", "service_name"]);
            Some(format!(
                "<tr><td>{}</td><td>{}</td><td class=\"num strong\">{} used</td></tr>",
                escape_invoice_html(&package),
                escape_invoice_html(&service),
                quantity
            ))
        })
        .collect::<Vec<_>>()
        .join("")
}

fn invoice_package_balance_rows(raw: &Value) -> String {
    raw.as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let pending = invoice_json_i64(row, &["pendingQty", "pending_qty", "remainingQty", "remaining_qty"]);
            if pending <= 0 {
                return None;
            }
            let package = invoice_json_string(row, &["packageName", "package_name"]);
            let service = invoice_json_string(row, &["serviceName", "service_name"]);
            let expiry = row
                .get("expiresAt")
                .or_else(|| row.get("expires_at"))
                .and_then(Value::as_str)
                .map(format_invoice_date_text)
                .unwrap_or_else(|| "-".to_string());
            Some(format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td class=\"num strong\">{} pending</td></tr>",
                escape_invoice_html(&package),
                escape_invoice_html(&service),
                escape_invoice_html(&expiry),
                pending
            ))
        })
        .collect::<Vec<_>>()
        .join("")
}

fn invoice_package_section(details: &PosSaleDetailsResponse) -> String {
    let redeemed_rows = invoice_package_redemption_rows(&details.sale.package_redemptions);
    let balance_rows = details
        .client_kpi
        .as_ref()
        .map(|kpi| invoice_package_balance_rows(&kpi.package_credits))
        .unwrap_or_default();
    if redeemed_rows.is_empty() && balance_rows.is_empty() {
        return String::new();
    }
    let redeemed_table = if redeemed_rows.is_empty() {
        String::new()
    } else {
        format!(
            "<div class=\"benefit-block\"><div class=\"label\">Package used in this invoice</div><table><thead><tr><th>Package</th><th>Service</th><th class=\"num\">Qty</th></tr></thead><tbody>{}</tbody></table></div>",
            redeemed_rows
        )
    };
    let balance_table = if balance_rows.is_empty() {
        String::new()
    } else {
        format!(
            "<div class=\"benefit-block\"><div class=\"label\">Package balance remaining</div><table><thead><tr><th>Package</th><th>Service</th><th>Expiry</th><th class=\"num\">Pending</th></tr></thead><tbody>{}</tbody></table></div>",
            balance_rows
        )
    };
    format!(
        "<section class=\"benefits\">{}{}</section>",
        redeemed_table, balance_table
    )
}

fn render_invoice_print_html(details: &PosSaleDetailsResponse) -> String {
    let invoice = &details.sale;
    let client_name = details
        .client_kpi
        .as_ref()
        .map(|kpi| kpi.client_name.as_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(invoice.client_id.as_str());
    let client_phone = details
        .client_kpi
        .as_ref()
        .map(|kpi| kpi.phone.as_str())
        .unwrap_or("");
    let membership_name = details
        .client_kpi
        .as_ref()
        .map(|kpi| kpi.membership_name.as_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("-");
    let membership_expiry = details
        .client_kpi
        .as_ref()
        .and_then(|kpi| kpi.membership_expires_at.as_ref())
        .map(format_invoice_date)
        .unwrap_or_else(|| "-".to_string());

    let line_rows = if details.lines.is_empty() {
        "<tr><td colspan=\"8\" class=\"empty\">No items</td></tr>".to_string()
    } else {
        details
            .lines
            .iter()
            .map(|line| {
                format!(
                    "<tr><td>{}</td><td>{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num strong\">{}</td></tr>",
                    escape_invoice_html(&line.item_name),
                    escape_invoice_html(&line.staff_id),
                    line.quantity,
                    format_invoice_money_html(line.unit_price_paise),
                    format_invoice_money_html(line.other_fee_paise),
                    format_invoice_money_html(line.discount_paise),
                    format_invoice_money_html(line.gst_paise),
                    format_invoice_money_html(line.line_total_paise)
                )
            })
            .collect::<Vec<_>>()
            .join("")
    };

    let payment_rows = if details.payments.is_empty() {
        "<tr><td colspan=\"3\" class=\"empty\">No payments</td></tr>".to_string()
    } else {
        details
            .payments
            .iter()
            .map(|payment| {
                format!(
                    "<tr><td>{}</td><td>{}</td><td class=\"num strong\">{}</td></tr>",
                    escape_invoice_html(&payment.label),
                    escape_invoice_html(&payment.method_reference),
                    format_invoice_money_html(payment.amount_paise)
                )
            })
            .collect::<Vec<_>>()
            .join("")
    };

    let package_section = invoice_package_section(details);

    let finalized_date = invoice
        .finalized_at
        .as_ref()
        .map(format_invoice_date)
        .unwrap_or_else(|| "-".to_string());

    format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice {invoice_number}</title>
  <style>
    body {{ margin: 0; padding: 24px; color: #0f172a; font-family: Arial, sans-serif; background: #f8fafc; }}
    .invoice {{ max-width: 860px; margin: 0 auto; background: #fff; border: 1px solid #dbe3ef; border-radius: 18px; overflow: hidden; }}
    .head {{ display: flex; justify-content: space-between; gap: 24px; padding: 28px; border-bottom: 1px solid #e5edf6; }}
    .brand {{ font-size: 24px; font-weight: 700; }}
    .muted {{ color: #64748b; font-size: 13px; }}
    .status {{ display: inline-block; padding: 6px 10px; border-radius: 999px; background: #eef6ff; color: #164e83; font-weight: 700; text-transform: uppercase; font-size: 12px; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 18px 28px; border-bottom: 1px solid #e5edf6; }}
    .box {{ border: 1px solid #e5edf6; border-radius: 14px; padding: 12px; }}
    .label {{ color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }}
    .value {{ margin-top: 6px; font-weight: 700; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ padding: 12px 14px; border-bottom: 1px solid #e5edf6; text-align: left; vertical-align: top; }}
    th {{ color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; background: #f8fafc; }}
    .num {{ text-align: right; white-space: nowrap; }}
    .strong {{ font-weight: 700; }}
    .empty {{ text-align: center; color: #64748b; }}
    .summary {{ display: grid; grid-template-columns: 1fr 320px; gap: 18px; padding: 22px 28px 28px; }}
    .totals .row {{ display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5edf6; }}
    .totals .total {{ font-size: 18px; font-weight: 700; border-top: 2px solid #0f172a; margin-top: 8px; padding-top: 12px; }}
    .benefits {{ display: grid; gap: 14px; margin-top: 18px; }}
    .benefit-block {{ border: 1px solid #e5edf6; border-radius: 14px; overflow: hidden; }}
    .benefit-block .label {{ padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e5edf6; }}
    @media print {{ body {{ background: #fff; padding: 0; }} .invoice {{ border: 0; border-radius: 0; max-width: none; }} }}
  </style>
</head>
<body>
  <main class="invoice">
    <section class="head">
      <div>
        <div class="brand">AuraShine</div>
        <div class="muted">Invoice {invoice_number}</div>
      </div>
      <div class="num">
        <div class="status">{status}</div>
        <div class="muted" style="margin-top: 10px;">Created {created_date}</div>
        <div class="muted">Finalized {finalized_date}</div>
      </div>
    </section>
    <section class="grid">
      <div class="box"><div class="label">Client</div><div class="value">{client_name}</div><div class="muted">{client_phone}</div></div>
      <div class="box"><div class="label">Membership</div><div class="value">{membership_name}</div><div class="muted">Expires {membership_expiry}</div></div>
      <div class="box"><div class="label">Wallet</div><div class="value">{wallet}</div></div>
      <div class="box"><div class="label">Unpaid</div><div class="value">{unpaid}</div></div>
    </section>
    <table>
      <thead><tr><th>Item</th><th>Staff</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Other fee</th><th class="num">Discount</th><th class="num">GST</th><th class="num">Total</th></tr></thead>
      <tbody>{line_rows}</tbody>
    </table>
    <section class="summary">
      <div>
        <div class="label">Payments</div>
        <table style="margin-top: 10px;">
          <thead><tr><th>Mode</th><th>Reference</th><th class="num">Amount</th></tr></thead>
          <tbody>{payment_rows}</tbody>
        </table>
        {package_section}
      </div>
      <div class="totals">
        <div class="row"><span>Subtotal</span><strong>{subtotal}</strong></div>
        <div class="row"><span>Bill discount</span><strong>{bill_discount}</strong></div>
        <div class="row"><span>Coupon {coupon_code}</span><strong>{coupon_discount}</strong></div>
        <div class="row"><span>GST</span><strong>{gst}</strong></div>
        <div class="row"><span>Tip</span><strong>{tip}</strong></div>
        <div class="row"><span>Round off</span><strong>{round_off}</strong></div>
        <div class="row total"><span>Total</span><strong>{total}</strong></div>
        <div class="row"><span>Paid</span><strong>{paid}</strong></div>
        <div class="row total"><span>Balance due</span><strong>{balance_due}</strong></div>
      </div>
    </section>
  </main>
</body>
</html>"#,
        invoice_number = escape_invoice_html(&invoice.invoice_number),
        status = escape_invoice_html(&invoice.status),
        created_date = format_invoice_date(&invoice.created_at),
        finalized_date = finalized_date,
        client_name = escape_invoice_html(client_name),
        client_phone = escape_invoice_html(client_phone),
        membership_name = escape_invoice_html(membership_name),
        membership_expiry = membership_expiry,
        wallet = format_invoice_money_html(
            details
                .client_kpi
                .as_ref()
                .map(|kpi| kpi.wallet_paise)
                .unwrap_or(0)
        ),
        unpaid = format_invoice_money_html(
            details
                .client_kpi
                .as_ref()
                .map(|kpi| kpi.unpaid_paise)
                .unwrap_or(0)
        ),
        line_rows = line_rows,
        payment_rows = payment_rows,
        package_section = package_section,
        subtotal = format_invoice_money_html(invoice.subtotal_paise),
        bill_discount = format_invoice_money_html(invoice.bill_discount_paise),
        coupon_code = escape_invoice_html(&invoice.coupon_code),
        coupon_discount = format_invoice_money_html(invoice.coupon_discount_paise),
        gst = format_invoice_money_html(invoice.tax_paise),
        tip = format_invoice_money_html(invoice.tip_paise),
        round_off = format_invoice_money_html(invoice.round_off_paise),
        total = format_invoice_money_html(invoice.total_paise),
        paid = format_invoice_money_html(invoice.paid_paise),
        balance_due = format_invoice_money_html(invoice.balance_due_paise)
    )
}

fn client_kpi_response(row: PosClientKpiRow) -> PosClientKpiResponse {
    PosClientKpiResponse {
        client_id: row.client_id,
        client_name: row.client_name,
        phone: row.phone,
        wallet_paise: row.wallet_paise,
        unpaid_paise: row.unpaid_paise,
        membership_name: row.membership_name,
        membership_assigned_at: row.membership_assigned_at,
        membership_expires_at: row.membership_expires_at,
        has_active_membership: row.membership_assigned_at.is_some(),
        membership_discount_percent: row.membership_discount_percent,
        membership_service_ids: row.membership_service_ids,
        reward_points_balance: row.reward_points_balance,
        membership_credits: row.membership_credits,
        package_credits: row.package_credits,
    }
}

pub(crate) async fn read_client_kpi(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<PosClientKpiResponse>, AppError> {
    if client_id.trim().is_empty() {
        return Ok(None);
    }

    let membership_settings = sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM membership_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load membership settings"))?
    .unwrap_or_else(|| serde_json::json!({}));
    let membership_policy = membership_pos_policy(&membership_settings);

    let row = sqlx::query_as::<_, PosClientKpiRow>(
        r#"
        SELECT
          c.id AS client_id,
          TRIM(c.first_name || ' ' || c.last_name) AS client_name,
          c.phone,
          COALESCE((
            SELECT SUM(wt.delta_paise)
              FROM wallet_transactions wt
             WHERE wt.tenant_id = $1
               AND wt.branch_id = $2
               AND wt.client_id = c.id
          ), 0)::BIGINT AS wallet_paise,
          COALESCE((
            SELECT SUM(GREATEST(ps.total_paise - ps.paid_paise, 0))
              FROM pos_sales ps
             WHERE ps.tenant_id = $1
               AND ps.branch_id = $2
               AND ps.client_id = c.id
               AND ps.status NOT IN ('draft', 'cancelled', 'voided')
               AND ps.total_paise > ps.paid_paise
          ), 0)::BIGINT AS unpaid_paise,
          COALESCE(m.name, '') AS membership_name,
          cm.assigned_at AS membership_assigned_at,
          cm.expires_at AS membership_expires_at,
          COALESCE(m.discount_percent, 0)::INTEGER AS membership_discount_percent,
          COALESCE(m.service_ids_json, '[]'::jsonb) AS membership_service_ids,
          COALESCE((
            SELECT mrl.balance_after
              FROM membership_reward_ledger mrl
             WHERE mrl.tenant_id = $1
               AND mrl.branch_id = $2
               AND mrl.client_id = c.id
             ORDER BY mrl.created_at DESC, mrl.id DESC
             LIMIT 1
          ), 0)::INTEGER AS reward_points_balance,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', cmc.id,
              'clientMembershipCreditId', cmc.id,
              'membershipId', cmc.membership_id,
              'membershipName', cmc.membership_name,
              'serviceId', cmc.service_id,
              'serviceName', cmc.service_name,
              'pendingQty', cmc.remaining_qty,
              'totalQty', cmc.total_qty,
              'expiresAt', cmc.expires_at,
              'sourceBranchId', cmc.branch_id,
              'crossLocation', cmc.branch_id <> $2,
              'staffId', ''
            ) ORDER BY cmc.expires_at NULLS LAST, cmc.membership_name, cmc.service_name)
              FROM client_membership_credits cmc
             WHERE cmc.tenant_id = $1
               AND ((cmc.branch_id = $2 AND (cmc.client_id = c.id OR ($4 AND EXISTS (SELECT 1 FROM membership_family_members fm JOIN client_memberships fcm ON fcm.id=fm.client_membership_id AND fcm.active=TRUE AND fcm.frozen_at IS NULL WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.member_client_id=c.id AND fm.owner_client_id=cmc.client_id AND fm.active=TRUE)))) OR membership_cross_location_allowed($1,cmc.branch_id,$2,cmc.client_id,c.id,'service_credit'))
               AND cmc.active = TRUE
               AND cmc.remaining_qty > 0
               AND NOT EXISTS (SELECT 1 FROM client_memberships frozen_cm WHERE frozen_cm.tenant_id=cmc.tenant_id AND frozen_cm.branch_id=cmc.branch_id AND frozen_cm.client_id=cmc.client_id AND frozen_cm.membership_id=cmc.membership_id AND frozen_cm.source_sale_id=cmc.source_sale_id AND frozen_cm.active=TRUE AND frozen_cm.frozen_at IS NOT NULL)
               AND (NOT $5 OR cmc.expires_at IS NULL OR cmc.expires_at >= CURRENT_DATE)
          ), '[]'::jsonb) AS membership_credits,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', cpc.id,
              'clientPackageCreditId', cpc.id,
              'packageId', cpc.package_id,
              'packageName', cpc.package_name,
              'serviceId', cpc.service_id,
              'serviceName', cpc.service_name,
              'pendingQty', cpc.remaining_qty,
              'totalQty', cpc.total_qty,
              'unitValuePaise', cpc.unit_value_paise,
              'issuedValuePaise', cpc.issued_value_paise,
              'expiresAt', cpc.expires_at,
              'staffId', ''
            ) ORDER BY cpc.expires_at NULLS LAST, cpc.package_name, cpc.service_name)
              FROM client_package_credits cpc
             WHERE cpc.tenant_id = $1
               AND cpc.branch_id = $2
               AND cpc.client_id = c.id
               AND cpc.active = TRUE
               AND cpc.remaining_qty > 0
               AND (cpc.expires_at IS NULL OR cpc.expires_at >= CURRENT_DATE OR COALESCE((SELECT ps.settings_json#>>'{expiryRenewal,expiredPendingAction}' FROM package_settings ps WHERE ps.tenant_id=$1 AND ps.branch_id=$2),'block') IN ('allow','approval'))
          ), '[]'::jsonb) AS package_credits
        FROM clients c
        LEFT JOIN LATERAL (
          SELECT branch_id, membership_id, assigned_at, expires_at
            FROM client_memberships
           WHERE tenant_id = $1
             AND ((branch_id = $2 AND (client_id = c.id OR ($4 AND EXISTS (SELECT 1 FROM membership_family_members fm WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.member_client_id=c.id AND fm.client_membership_id=client_memberships.id AND fm.active=TRUE)))) OR membership_cross_location_allowed($1,branch_id,$2,client_id,c.id,'discount'))
             AND active = TRUE
             AND frozen_at IS NULL
             AND assigned_at <= NOW()
             AND (expires_at IS NULL OR expires_at >= NOW())
           ORDER BY (branch_id = $2) DESC, assigned_at DESC
           LIMIT 1
        ) cm ON TRUE
        LEFT JOIN memberships m
         ON m.tenant_id = $1
         AND m.branch_id = cm.branch_id
         AND m.id = cm.membership_id
         AND m.active = TRUE
        WHERE c.tenant_id = $1
          AND c.branch_id = $2
          AND c.id = $3
          AND c.active = TRUE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id.trim())
    .bind(membership_policy.allow_family)
    .bind(membership_policy.block_expired)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load client KPI"))?;

    Ok(row.map(client_kpi_response))
}

fn status_for(total_paise: i64, paid_paise: i64) -> String {
    if paid_paise >= total_paise {
        "paid".to_string()
    } else if paid_paise > 0 {
        "partial".to_string()
    } else {
        "open".to_string()
    }
}

fn status_for_invoice_create(
    requested_status: Option<&str>,
    total_paise: i64,
    paid_paise: i64,
) -> String {
    let requested = requested_status.unwrap_or_default().trim().to_lowercase();
    match requested.as_str() {
        "draft" => "draft".to_string(),
        "void" | "voided" => "voided".to_string(),
        "cancelled" | "canceled" => "cancelled".to_string(),
        _ => status_for(total_paise, paid_paise),
    }
}

fn status_for_finalize(total_paise: i64, paid_paise: i64) -> String {
    status_for(total_paise, paid_paise)
}

fn rupees_to_paise(value: f64) -> i64 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    (value * 100.0).round() as i64
}

fn percent_of_paise(value_paise: i64, percent: i32) -> i64 {
    if value_paise <= 0 || percent <= 0 {
        return 0;
    }
    value_paise
        .saturating_mul(i64::from(percent))
        .saturating_add(50)
        / 100
}

#[cfg(test)]
mod pos_money_tests {
    use super::percent_of_paise;

    #[test]
    fn gst_rounds_to_nearest_paise() {
        assert_eq!(percent_of_paise(9_999, 5), 500);
        assert_eq!(percent_of_paise(40_000, 5), 2_000);
        assert_eq!(percent_of_paise(50_000, 18), 9_000);
    }
}

fn round_to_rupee(value: i64) -> i64 {
    ((value + 50) / 100) * 100
}

fn normalize_line_type(value: String) -> Result<String, AppError> {
    let normalized = value.trim().to_lowercase();
    let line_type = match normalized.as_str() {
        "" => "service",
        "service" | "services" | "svc" => "service",
        "product" | "products" | "retail" | "retail_product" => "product",
        "custom" | "manual" | "misc" | "other" => "custom",
        "membership" => "membership",
        "package" => "package",
        "gift_card" | "giftcard" | "gift-card" => "gift_card",
        "package_redeem" | "package-redeem" => "package_redeem",
        "membership_redeem" | "membership-redeem" => "membership_redeem",
        "redemption" => "redemption",
        _ => {
            return Err(AppError::validation(
                "line type must be service, product, custom, membership, package, gift_card, or redemption",
            ));
        }
    };
    Ok(line_type.to_string())
}

fn normalize_discount_type(value: String) -> String {
    match value.trim().to_lowercase().as_str() {
        "percent" | "percentage" => "percent".to_string(),
        "membership" => "membership".to_string(),
        "membership_stacked" => "membership_stacked".to_string(),
        _ => "amount".to_string(),
    }
}

fn validated_discount_reason(payload: &PosSalePayload) -> Result<String, AppError> {
    let reward = payload.reward_discount_paise.unwrap_or(0).max(0);
    let invoice_discount = payload
        .bill_discount_paise
        .or(payload.discount_paise)
        .unwrap_or_else(|| rupees_to_paise(payload.discount.unwrap_or(0.0)))
        .saturating_sub(reward)
        .max(0);
    let line_discount = payload
        .lines
        .as_ref()
        .or(payload.items.as_ref())
        .is_some_and(|lines| {
            lines.iter().any(|line| {
                let kind = line
                    .discount_type
                    .as_deref()
                    .unwrap_or("amount")
                    .trim()
                    .to_ascii_lowercase();
                kind != "membership"
                    && (line
                        .discount_paise
                        .or(line.discount_amount_paise)
                        .unwrap_or(0)
                        > 0
                        || line.discount_value.unwrap_or(0.0) > 0.0)
            })
        });
    let reason = payload
        .discount_reason
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    if invoice_discount > 0 || line_discount {
        if !(3..=500).contains(&reason.len()) {
            return Err(AppError::validation(
                "discountReason must contain 3 to 500 characters for manual discounts",
            ));
        }
    } else if reason.len() > 500 {
        return Err(AppError::validation(
            "discountReason cannot exceed 500 characters",
        ));
    }
    Ok(reason)
}

fn normalize_line(
    line: PosSaleLineInput,
    fallback_staff_id: &str,
) -> Result<NormalizedLine, AppError> {
    let line_type = normalize_line_type(
        line.line_type
            .or(line.item_type)
            .or(line.kind)
            .unwrap_or_else(|| "service".to_string()),
    )?;
    let item_id = line
        .item_id
        .or(line.id)
        .unwrap_or_default()
        .trim()
        .to_string();
    let item_name = line
        .item_name
        .or(line.name)
        .unwrap_or_default()
        .trim()
        .to_string();
    if item_name.is_empty() {
        return Err(AppError::validation(
            "itemName is required for every POS line",
        ));
    }
    let staff_id = line
        .staff_id
        .or(line.assigned_staff_id)
        .unwrap_or_else(|| fallback_staff_id.to_string())
        .trim()
        .to_string();
    let staff_splits = normalize_staff_splits(
        line.staff_splits.unwrap_or_else(|| Value::Array(vec![])),
        &staff_id,
    )?;

    let quantity = line.quantity.unwrap_or(1).max(0);
    if quantity == 0 {
        return Err(AppError::validation("quantity must be greater than zero"));
    }

    let unit_price_paise = line
        .unit_price_paise
        .or(line.price_paise)
        .unwrap_or_else(|| rupees_to_paise(line.unit_price.or(line.price).unwrap_or(0.0)))
        .max(0);

    let other_fee_paise = line.other_fee_paise.unwrap_or(0);
    if !(0..=100_000_000).contains(&other_fee_paise) {
        return Err(AppError::validation(
            "otherFeePaise must be between 0 and 100000000",
        ));
    }

    let gross_paise = quantity.saturating_mul(unit_price_paise.saturating_add(other_fee_paise));
    let discount_type =
        normalize_discount_type(line.discount_type.unwrap_or_else(|| "amount".to_string()));
    let mut discount_value_paise = 0i64;
    let mut discount_bps = 0i64;
    let item_discount_paise =
        if let Some(value) = line.discount_paise.or(line.discount_amount_paise) {
            discount_value_paise = value.max(0);
            value.max(0).min(gross_paise)
        } else if let Some(value) = line.discount_value {
            if discount_type == "percent" {
                discount_bps = (value.max(0.0).min(100.0) * 100.0).round() as i64;
                ((gross_paise as f64) * value.max(0.0).min(100.0) / 100.0).round() as i64
            } else {
                discount_value_paise = rupees_to_paise(value);
                discount_value_paise.min(gross_paise)
            }
        } else {
            0
        };

    let tax_percent = line
        .tax_percent
        .or(line.gst_percent)
        .unwrap_or_else(|| line.tax_rate.or(line.gst_rate).unwrap_or(0.0).round() as i32)
        .clamp(0, 100);
    let hsn_sac_code = normalize_hsn_sac_code(line.hsn_sac_code.or_else(|| {
        if line_type == "product" {
            line.hsn_code
        } else {
            line.sac_code
        }
    }))?;

    Ok(NormalizedLine {
        line_type,
        item_id,
        item_name,
        staff_id,
        staff_splits,
        quantity,
        unit_price_paise,
        other_fee_paise,
        item_discount_paise,
        discount_type,
        discount_value_paise,
        discount_bps,
        tax_percent,
        hsn_sac_code,
    })
}

fn normalize_hsn_sac_code(raw: Option<String>) -> Result<String, AppError> {
    let code = raw.unwrap_or_default().trim().to_string();
    if !code.is_empty()
        && (!code.chars().all(|ch| ch.is_ascii_digit()) || !(4..=8).contains(&code.len()))
    {
        return Err(AppError::validation(
            "hsnSacCode must contain 4 to 8 digits",
        ));
    }
    Ok(code)
}

fn normalize_staff_splits(raw: Value, fallback_staff_id: &str) -> Result<Value, AppError> {
    let Some(items) = raw.as_array() else {
        return Err(AppError::validation("staffSplits must be an array"));
    };
    if items.is_empty() {
        if !fallback_staff_id.trim().is_empty() {
            return Ok(Value::Array(vec![serde_json::json!({
                "staffId": fallback_staff_id.trim(),
                "staffName": "",
                "percent": 100
            })]));
        }
        return Ok(Value::Array(vec![]));
    }
    if items.len() > 8 {
        return Err(AppError::validation("staffSplits supports up to 8 staff"));
    }

    let mut total = 0i64;
    let mut staff_ids = HashSet::new();
    let mut rows = Vec::with_capacity(items.len());
    for item in items {
        let staff_id = item
            .get("staffId")
            .or_else(|| item.get("staff_id"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let percent = item
            .get("percent")
            .or_else(|| item.get("percentage"))
            .or_else(|| item.get("splitPercent"))
            .or_else(|| item.get("share"))
            .and_then(Value::as_i64)
            .unwrap_or_else(|| {
                item.get("percent")
                    .or_else(|| item.get("percentage"))
                    .or_else(|| item.get("splitPercent"))
                    .or_else(|| item.get("share"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .round() as i64
            });
        if staff_id.is_empty() || percent <= 0 || percent > 100 {
            return Err(AppError::validation(
                "each staff split needs staffId and 1-100 percent",
            ));
        }
        if !staff_ids.insert(staff_id) {
            return Err(AppError::validation(
                "staffSplits cannot contain duplicate staff",
            ));
        }
        total += percent;
        rows.push(serde_json::json!({
            "staffId": staff_id,
            "staffName": item.get("staffName").or_else(|| item.get("staff_name")).and_then(Value::as_str).unwrap_or(""),
            "percent": percent
        }));
    }
    if total != 100 {
        return Err(AppError::validation("staff split total must be 100"));
    }
    Ok(Value::Array(rows))
}

fn normalize_tip_splits(raw: Value, expected_tip_paise: i64) -> Result<Value, AppError> {
    let Some(items) = raw.as_array() else {
        return Err(AppError::validation("tipSplits must be an array"));
    };
    if items.len() > 25 {
        return Err(AppError::validation("tipSplits supports up to 25 staff"));
    }

    let mut total = 0i64;
    let mut staff_ids = HashSet::new();
    let mut rows = Vec::with_capacity(items.len());
    for item in items {
        let staff_id = item
            .get("staffId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let amount_paise = item
            .get("amountPaise")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        if staff_id.is_empty() || amount_paise <= 0 {
            return Err(AppError::validation(
                "each tip split needs staffId and positive amountPaise",
            ));
        }
        if !staff_ids.insert(staff_id) {
            return Err(AppError::validation(
                "tipSplits cannot contain duplicate staff",
            ));
        }
        total = total
            .checked_add(amount_paise)
            .ok_or_else(|| AppError::validation("tip split total is too large"))?;
        rows.push(serde_json::json!({
            "staffId": staff_id,
            "amountPaise": amount_paise
        }));
    }
    if !rows.is_empty() && total != expected_tip_paise {
        return Err(AppError::validation("tip split total must equal tipPaise"));
    }
    Ok(Value::Array(rows))
}

#[cfg(test)]
mod staff_split_tests {
    use super::{normalize_staff_splits, normalize_tip_splits};

    #[test]
    fn staff_splits_reject_duplicate_staff() {
        assert!(normalize_staff_splits(
            serde_json::json!([
                {"staffId": "staff-1", "percent": 50},
                {"staffId": "staff-1", "percent": 50}
            ]),
            "",
        )
        .is_err());
    }

    #[test]
    fn tip_splits_require_unique_staff_and_exact_total() {
        assert!(normalize_tip_splits(
            serde_json::json!([
                {"staffId": "staff-1", "amountPaise": 400},
                {"staffId": "staff-2", "amountPaise": 600}
            ]),
            1000,
        )
        .is_ok());
        assert!(normalize_tip_splits(
            serde_json::json!([
                {"staffId": "staff-1", "amountPaise": 500},
                {"staffId": "staff-1", "amountPaise": 500}
            ]),
            1000,
        )
        .is_err());
        assert!(normalize_tip_splits(
            serde_json::json!([{"staffId": "staff-1", "amountPaise": 999}]),
            1000,
        )
        .is_err());
    }
}

fn requested_bill_discount_paise(
    payload: &PosSalePayload,
    net_before_bill_discount: i64,
) -> Result<i64, AppError> {
    if let Some(raw) = payload.bill_discount_paise.or(payload.discount_paise) {
        if raw < 0 {
            return Err(AppError::validation("bill discount cannot be negative"));
        }
        if raw > net_before_bill_discount {
            return Err(AppError::validation(
                "bill discount cannot exceed invoice taxable value",
            ));
        }
        return Ok(raw);
    }

    let value = payload.discount.unwrap_or(0.0);
    if value < 0.0 {
        return Err(AppError::validation("bill discount cannot be negative"));
    }

    let mode = payload
        .discount_mode
        .as_deref()
        .unwrap_or("amount")
        .trim()
        .to_ascii_lowercase();
    let amount = if matches!(mode.as_str(), "percent" | "percentage" | "%") {
        if value > 100.0 {
            return Err(AppError::validation(
                "bill discount percent cannot exceed 100",
            ));
        }
        ((net_before_bill_discount as f64) * value / 100.0).round() as i64
    } else {
        rupees_to_paise(value)
    };

    if amount > net_before_bill_discount {
        return Err(AppError::validation(
            "bill discount cannot exceed invoice taxable value",
        ));
    }

    Ok(amount)
}

fn normalize_coupon_code(raw: Option<String>) -> Result<String, AppError> {
    let code = raw.unwrap_or_default().trim().to_ascii_uppercase();
    if code.is_empty() {
        return Ok(String::new());
    }

    let valid_len = (3..=40).contains(&code.len());
    let valid_chars = code
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if !valid_len || !valid_chars {
        return Err(AppError::validation(
            "coupon code must be 3-40 characters using letters, numbers, hyphen, or underscore",
        ));
    }

    Ok(code)
}

fn requested_coupon_discount_paise(
    payload: &PosSalePayload,
    net_before_coupon_discount: i64,
) -> Result<(String, i64), AppError> {
    let coupon_code = normalize_coupon_code(payload.coupon_code.clone())?;
    let amount = payload
        .coupon_discount_paise
        .unwrap_or_else(|| rupees_to_paise(payload.coupon_discount.unwrap_or(0.0)));

    if amount < 0 {
        return Err(AppError::validation("coupon discount cannot be negative"));
    }
    if amount > 0 && coupon_code.is_empty() {
        return Err(AppError::validation(
            "couponCode is required when coupon discount is applied",
        ));
    }
    if amount > net_before_coupon_discount {
        return Err(AppError::validation(
            "coupon discount cannot exceed remaining invoice taxable value",
        ));
    }

    Ok((coupon_code, amount))
}

async fn resolve_coupon_discount(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payload: &mut PosSalePayload,
) -> Result<(), AppError> {
    let coupon_code = normalize_coupon_code(payload.coupon_code.clone())?;
    let requested_amount = payload
        .coupon_discount_paise
        .unwrap_or_else(|| rupees_to_paise(payload.coupon_discount.unwrap_or(0.0)));

    if requested_amount < 0 {
        return Err(AppError::validation("coupon discount cannot be negative"));
    }

    if coupon_code.is_empty() {
        if requested_amount > 0 {
            return Err(AppError::validation(
                "couponCode is required when coupon discount is applied",
            ));
        }
        payload.coupon_code = None;
        payload.coupon_discount_paise = Some(0);
        payload.coupon_discount = None;
        return Ok(());
    }

    payload.coupon_code = Some(coupon_code.clone());
    payload.coupon_discount_paise = Some(0);
    payload.coupon_discount = None;

    let preview = calculate_pos(payload)?;
    let coupon_base_paise = preview
        .subtotal_paise
        .saturating_sub(preview.discount_paise);
    let row = sqlx::query_as::<_, PosCouponRow>(
        r#"
        SELECT code, discount_type, discount_value_paise, discount_bps,
               min_subtotal_paise, max_discount_paise, active,
               starts_at, ends_at, usage_limit, used_count, per_client_limit,
               target_service_ids, target_service_categories, target_package_ids,
               target_client_segments,
               first_visit_only, referral_required, target_client_id, approval_status,
               allow_membership_stacking, allow_package_stacking
        FROM pos_coupons
        WHERE tenant_id=$1 AND branch_id=$2 AND code=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&coupon_code)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate coupon"))?
    .ok_or_else(|| AppError::validation("coupon code is not valid for this branch"))?;

    if !row.active {
        return Err(AppError::validation("coupon is inactive"));
    }
    if row.approval_status != "approved" {
        return Err(AppError::validation("coupon is not approved"));
    }
    let now = Utc::now();
    if let Some(starts_at) = &row.starts_at {
        if *starts_at > now {
            return Err(AppError::validation("coupon is not active yet"));
        }
    }
    if let Some(ends_at) = &row.ends_at {
        if *ends_at < now {
            return Err(AppError::validation("coupon has expired"));
        }
    }
    if let Some(usage_limit) = row.usage_limit {
        if usage_limit > 0 && row.used_count >= usage_limit {
            return Err(AppError::validation("coupon usage limit is reached"));
        }
    }
    if coupon_base_paise < row.min_subtotal_paise {
        return Err(AppError::validation(
            "coupon minimum bill amount is not met",
        ));
    }

    let client_id = payload
        .client_id
        .as_deref()
        .or(payload.customer_id.as_deref())
        .unwrap_or("")
        .trim();
    let client_targeted = row.per_client_limit > 0
        || row.target_client_id.is_some()
        || row.first_visit_only
        || row.referral_required
        || !row.target_client_segments.is_empty();
    if client_targeted && client_id.is_empty() {
        return Err(AppError::validation("client is required for this coupon"));
    }
    if !client_id.is_empty() {
        if row
            .target_client_id
            .as_deref()
            .is_some_and(|target| target != client_id)
        {
            return Err(AppError::validation("coupon belongs to another client"));
        }
        let subject_id = format!("{client_id}:{}", row.code);
        if happy_hours_repository::has_blocking_fraud_case(
            &state.db,
            tenant_id,
            branch_id,
            &subject_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to check coupon fraud guard"))?
        {
            return Err(AppError::conflict(
                "coupon is blocked until fraud review is completed",
            ));
        }
        let eligibility = happy_hours_repository::coupon_eligibility(
            &state.db, tenant_id, branch_id, client_id, &row.code,
        )
        .await
        .map_err(|_| AppError::internal("failed to evaluate coupon eligibility"))?;
        if row.per_client_limit > 0 && eligibility.coupon_use_count >= row.per_client_limit {
            return Err(AppError::validation(
                "coupon per-client usage limit is reached",
            ));
        }
        if row.first_visit_only && eligibility.prior_sale_count > 0 {
            return Err(AppError::validation(
                "coupon is limited to first-visit clients",
            ));
        }
        if row.referral_required && !eligibility.referral_exists {
            return Err(AppError::validation(
                "coupon requires a registered client referral",
            ));
        }
        if !row.target_client_segments.is_empty()
            && !eligibility
                .client_segment
                .as_deref()
                .is_some_and(|segment| {
                    row.target_client_segments
                        .iter()
                        .any(|target| target.eq_ignore_ascii_case(segment))
                })
        {
            return Err(AppError::validation(
                "coupon is not available for this client segment",
            ));
        }
    }
    let has_membership = payload
        .lines
        .as_ref()
        .or(payload.items.as_ref())
        .into_iter()
        .flatten()
        .any(|line| {
            matches!(
                line.discount_type.as_deref(),
                Some("membership" | "membership_stacked")
            )
        });
    if has_membership && !row.allow_membership_stacking {
        return Err(AppError::validation(
            "coupon cannot be stacked with membership benefits",
        ));
    }
    let has_package = payload.package_redemptions.as_ref().is_some_and(|value| {
        value.as_array().is_some_and(|items| !items.is_empty())
            || value.as_object().is_some_and(|items| !items.is_empty())
    });
    if has_package && !row.allow_package_stacking {
        return Err(AppError::validation(
            "coupon cannot be stacked with package benefits",
        ));
    }
    if !row.target_service_ids.is_empty()
        || !row.target_service_categories.is_empty()
        || !row.target_package_ids.is_empty()
    {
        let service_ids = payload
            .lines
            .as_ref()
            .or(payload.items.as_ref())
            .into_iter()
            .flatten()
            .filter(|line| {
                line.line_type
                    .as_deref()
                    .or(line.item_type.as_deref())
                    .or(line.kind.as_deref())
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("service"))
            })
            .filter_map(|line| {
                line.item_id
                    .as_ref()
                    .or(line.id.as_ref())
                    .map(|id| id.trim().to_string())
            })
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        let id_match = service_ids.iter().any(|id| {
            row.target_service_ids
                .iter()
                .any(|target| target.eq_ignore_ascii_case(id))
        });
        let categories = happy_hours_repository::service_categories(
            &state.db,
            tenant_id,
            branch_id,
            &service_ids,
        )
        .await
        .map_err(|_| AppError::internal("failed to evaluate coupon service targeting"))?;
        let category_match = categories.iter().any(|category| {
            row.target_service_categories
                .iter()
                .any(|target| target.eq_ignore_ascii_case(category))
        });
        let mut package_ids = payload
            .lines
            .as_ref()
            .or(payload.items.as_ref())
            .into_iter()
            .flatten()
            .filter(|line| {
                line.line_type
                    .as_deref()
                    .or(line.item_type.as_deref())
                    .or(line.kind.as_deref())
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("package"))
            })
            .filter_map(|line| {
                line.item_id
                    .as_ref()
                    .or(line.id.as_ref())
                    .map(|id| id.trim().to_string())
            })
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        let credit_ids = payload
            .package_redemptions
            .as_ref()
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|item| {
                package_redemption_string(
                    item,
                    &[
                        "clientPackageCreditId",
                        "client_package_credit_id",
                        "creditId",
                        "credit_id",
                        "id",
                    ],
                )
            })
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        if !credit_ids.is_empty() {
            let redeemed_package_ids = sqlx::query_scalar::<_, String>(
                "SELECT DISTINCT package_id FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=ANY($4) AND active=TRUE AND remaining_qty>0",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .bind(&credit_ids)
            .fetch_all(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to evaluate coupon package targeting"))?;
            package_ids.extend(redeemed_package_ids);
        }
        let package_match = package_ids.iter().any(|id| {
            row.target_package_ids
                .iter()
                .any(|target| target.eq_ignore_ascii_case(id))
        });
        if !id_match && !category_match && !package_match {
            return Err(AppError::validation(
                "coupon is not valid for the selected services or packages",
            ));
        }
    }

    let mut allowed_discount = if row.discount_type == "percent" {
        coupon_base_paise.saturating_mul(row.discount_bps) / 10_000
    } else {
        row.discount_value_paise
    };
    if row.max_discount_paise > 0 {
        allowed_discount = allowed_discount.min(row.max_discount_paise);
    }
    allowed_discount = allowed_discount.min(coupon_base_paise).max(0);

    if allowed_discount == 0 {
        return Err(AppError::validation("coupon has no discount for this bill"));
    }
    if requested_amount > 0 && requested_amount != allowed_discount {
        return Err(AppError::validation(
            "coupon discount does not match coupon rules",
        ));
    }

    payload.coupon_code = Some(row.code);
    payload.coupon_discount_paise = Some(allowed_discount);
    payload.coupon_discount = None;
    Ok(())
}

fn calculate_pos(payload: &PosSalePayload) -> Result<PosCalculation, AppError> {
    let raw_lines = payload
        .lines
        .clone()
        .or_else(|| payload.items.clone())
        .unwrap_or_default();
    if raw_lines.is_empty() {
        return Err(AppError::validation("At least one sale line is required"));
    }

    let fallback_staff_id = payload.staff_id.as_deref().unwrap_or("").trim().to_string();
    let normalized = raw_lines
        .into_iter()
        .map(|line| normalize_line(line, &fallback_staff_id))
        .collect::<Result<Vec<_>, _>>()?;

    let subtotal_paise = normalized.iter().fold(0i64, |sum, line| {
        sum.saturating_add(
            line.quantity
                .saturating_mul(line.unit_price_paise.saturating_add(line.other_fee_paise)),
        )
    });
    let item_discount_paise = normalized.iter().fold(0i64, |sum, line| {
        sum.saturating_add(line.item_discount_paise)
    });
    let net_before_bill_discount = subtotal_paise.saturating_sub(item_discount_paise);
    let bill_discount_paise = requested_bill_discount_paise(payload, net_before_bill_discount)?;
    let net_before_coupon_discount = net_before_bill_discount.saturating_sub(bill_discount_paise);
    let (coupon_code, coupon_discount_paise) =
        requested_coupon_discount_paise(payload, net_before_coupon_discount)?;
    let invoice_level_discount_paise = bill_discount_paise.saturating_add(coupon_discount_paise);

    let mut allocated_bill_discount = 0i64;
    let last_index = normalized.len().saturating_sub(1);
    let mut tax_paise = 0i64;
    let mut calculated = Vec::with_capacity(normalized.len());

    for (index, line) in normalized.into_iter().enumerate() {
        let gross_paise = line
            .quantity
            .saturating_mul(line.unit_price_paise.saturating_add(line.other_fee_paise));
        let taxable_before_bill = gross_paise.saturating_sub(line.item_discount_paise);
        let bill_share = if index == last_index {
            invoice_level_discount_paise
                .saturating_sub(allocated_bill_discount)
                .min(taxable_before_bill)
        } else if net_before_bill_discount > 0 {
            invoice_level_discount_paise.saturating_mul(taxable_before_bill)
                / net_before_bill_discount
        } else {
            0
        };
        allocated_bill_discount = allocated_bill_discount.saturating_add(bill_share);

        let discount_paise = line
            .item_discount_paise
            .saturating_add(bill_share)
            .min(gross_paise);
        let taxable_paise = gross_paise.saturating_sub(discount_paise);
        let line_tax_paise = percent_of_paise(taxable_paise, line.tax_percent);
        let line_total_paise = taxable_paise.saturating_add(line_tax_paise);
        tax_paise = tax_paise.saturating_add(line_tax_paise);

        calculated.push(CalculatedLine {
            line_type: line.line_type,
            item_id: line.item_id,
            item_name: line.item_name,
            staff_id: line.staff_id,
            staff_splits: line.staff_splits,
            quantity: line.quantity,
            unit_price_paise: line.unit_price_paise,
            other_fee_paise: line.other_fee_paise,
            gross_paise,
            taxable_paise,
            discount_paise,
            discount_type: line.discount_type,
            discount_value_paise: line.discount_value_paise,
            discount_bps: line.discount_bps,
            tax_percent: line.tax_percent,
            gst_paise: line_tax_paise,
            hsn_sac_code: line.hsn_sac_code,
            cgst_paise: 0,
            sgst_paise: 0,
            igst_paise: line_tax_paise,
            reverse_charge: false,
            line_total_paise,
        });
    }

    let discount_paise = item_discount_paise
        .saturating_add(bill_discount_paise)
        .saturating_add(coupon_discount_paise);
    let tip_paise = payload
        .tip_paise
        .unwrap_or_else(|| rupees_to_paise(payload.tip_total.unwrap_or(0.0)))
        .max(0);
    let before_round = subtotal_paise
        .saturating_sub(discount_paise)
        .saturating_add(tax_paise)
        .saturating_add(tip_paise);
    let rounded_total = if payload.round_to_nearest_rupee.unwrap_or(false) {
        round_to_rupee(before_round)
    } else {
        before_round
    };

    Ok(PosCalculation {
        lines: calculated,
        subtotal_paise,
        bill_discount_paise,
        coupon_code,
        coupon_discount_paise,
        discount_paise,
        tax_paise,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: tax_paise,
        tip_paise,
        round_off_paise: rounded_total.saturating_sub(before_round),
        total_paise: rounded_total.max(0),
    })
}

fn booked_service_price(snapshot: &Value, service_id: &str) -> Option<i64> {
    snapshot
        .get(service_id)
        .and_then(Value::as_i64)
        .filter(|price| *price >= 0)
}

fn apply_appointment_booked_prices(
    payload: &mut PosSalePayload,
    booked_prices: Vec<(String, String, i64)>,
) -> Result<(), AppError> {
    let fallback_staff_id = payload.staff_id.clone().unwrap_or_default();
    let Some(lines) = payload.lines.as_mut().or(payload.items.as_mut()) else {
        return Ok(());
    };
    let mut prices_by_service_staff: HashMap<(String, String), VecDeque<i64>> = HashMap::new();
    for (service_id, staff_id, price_paise) in booked_prices {
        prices_by_service_staff
            .entry((service_id, staff_id))
            .or_default()
            .push_back(price_paise);
    }

    for line in lines {
        let line_type = line
            .line_type
            .as_deref()
            .or(line.item_type.as_deref())
            .or(line.kind.as_deref())
            .unwrap_or("service")
            .trim()
            .to_ascii_lowercase();
        if !matches!(line_type.as_str(), "" | "service" | "services" | "svc") {
            continue;
        }
        let service_id = line
            .item_id
            .as_deref()
            .or(line.id.as_deref())
            .unwrap_or_default()
            .trim()
            .to_string();
        let staff_id = line
            .staff_id
            .as_deref()
            .or(line.assigned_staff_id.as_deref())
            .unwrap_or(&fallback_staff_id)
            .trim()
            .to_string();
        let Some(prices) = prices_by_service_staff.get_mut(&(service_id, staff_id)) else {
            continue;
        };
        let quantity = line.quantity.unwrap_or(1).max(0) as usize;
        let matched_quantity = quantity.min(prices.len());
        if matched_quantity == 0 {
            continue;
        }
        if matched_quantity != quantity {
            return Err(AppError::validation(
                "booked and additional appointment services must remain separate lines",
            ));
        }
        let Some(price_paise) = prices.pop_front() else {
            continue;
        };
        for _ in 1..matched_quantity {
            if prices.pop_front() != Some(price_paise) {
                return Err(AppError::validation(
                    "appointment services booked at different prices must remain separate lines",
                ));
            }
        }
        line.unit_price_paise = Some(price_paise);
        line.price_paise = None;
        line.unit_price = None;
        line.price = None;
    }
    Ok(())
}

async fn hydrate_appointment_booked_prices(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payload: &mut PosSalePayload,
) -> Result<(), AppError> {
    if normalize_pos_source(payload.source.clone()) != "appointment" {
        return Ok(());
    }
    let reference_id = appointment_invoice_reference(
        state,
        tenant_id,
        branch_id,
        payload.reference_id.as_deref().unwrap_or_default(),
        payload.separate_group_invoice.unwrap_or(false),
    )
    .await?;
    payload.source = Some("appointment".to_string());
    payload.reference_id = Some(reference_id.clone());

    let rows = sqlx::query_as::<_, (String, String, Value, i64)>(
        r#"
        SELECT booked.service_id,
               appointment.staff_id,
               appointment.booked_service_prices_json,
               catalogue.price_paise::BIGINT
          FROM appointments appointment
          CROSS JOIN LATERAL jsonb_array_elements_text(
            COALESCE(NULLIF(appointment.service_ids_json, ''), '[]')::jsonb
          ) WITH ORDINALITY AS booked(service_id, ordinal)
          JOIN services catalogue
            ON catalogue.id = booked.service_id
           AND catalogue.tenant_id = appointment.tenant_id
           AND catalogue.branch_id = appointment.branch_id
         WHERE appointment.tenant_id=$1
           AND appointment.branch_id=$2
           AND (appointment.id=$3 OR appointment.booking_group_id=$3)
           AND appointment.status NOT IN ('cancelled', 'no-show')
         ORDER BY appointment.start_at, appointment.created_at, booked.ordinal
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&reference_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment booked prices"))?;
    let booked_prices = rows
        .into_iter()
        .map(|(service_id, staff_id, snapshot, current_price)| {
            let price = booked_service_price(&snapshot, &service_id).unwrap_or(current_price);
            (service_id, staff_id, price)
        })
        .collect();
    apply_appointment_booked_prices(payload, booked_prices)
}

async fn hydrate_pos_tax_metadata(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payload: &mut PosSalePayload,
) -> Result<(), AppError> {
    let Some(lines) = payload.lines.as_mut().or(payload.items.as_mut()) else {
        return Ok(());
    };
    for line in lines {
        let line_type = line
            .line_type
            .as_deref()
            .or(line.item_type.as_deref())
            .or(line.kind.as_deref())
            .unwrap_or("service");
        let item_id = line
            .item_id
            .as_deref()
            .or(line.id.as_deref())
            .unwrap_or("")
            .trim();
        if item_id.is_empty() || !(line_type == "service" || line_type == "product") {
            continue;
        }
        let tax_missing = line.tax_percent.is_none()
            && line.gst_percent.is_none()
            && line.tax_rate.is_none()
            && line.gst_rate.is_none();
        let code_missing =
            line.hsn_sac_code.is_none() && line.hsn_code.is_none() && line.sac_code.is_none();
        let defaults = if line_type == "service" {
            sqlx::query_as::<_, (i32, String, i64)>(
                "SELECT gst_percent, sac_code, other_fee_paise FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
            )
            .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&state.db).await
        } else {
            sqlx::query_as::<_, (i32, String, i64)>(
                "SELECT gst_percent, hsn_code, 0::BIGINT FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
            )
            .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&state.db).await
        }
        .map_err(|_| AppError::internal("failed to load GST item defaults"))?;
        if let Some((gst_percent, code, other_fee_paise)) = defaults {
            if tax_missing {
                line.gst_percent = Some(gst_percent.clamp(0, 100));
            }
            if code_missing && !code.is_empty() {
                line.hsn_sac_code = Some(code);
            }
            line.other_fee_paise = Some(other_fee_paise);
        }
    }
    Ok(())
}

async fn gst_context_from_payload(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payload: &PosSalePayload,
) -> Result<GstContext, AppError> {
    let profile = read_invoice_business_profile(state, tenant_id, branch_id).await?;
    let seller_gstin = profile
        .filter(|profile| profile.is_gst_registered)
        .map(|profile| profile.gstin)
        .unwrap_or_default();
    let seller_state_code = gst_state_code(&seller_gstin).unwrap_or_default();
    let buyer_gstin = normalize_gstin(payload.buyer_gstin.as_deref(), "buyerGstin")?;
    let place_of_supply_state_code =
        normalize_state_code(payload.place_of_supply_state_code.as_deref())
            .or_else(|| gst_state_code(&buyer_gstin))
            .unwrap_or_else(|| seller_state_code.clone());
    let reverse_charge = payload.reverse_charge.unwrap_or(false);
    if reverse_charge && buyer_gstin.is_empty() {
        return Err(AppError::validation(
            "buyerGstin is required for reverse-charge invoices",
        ));
    }
    let tax_mode = if reverse_charge {
        "reverse_charge"
    } else if !seller_state_code.is_empty()
        && !place_of_supply_state_code.is_empty()
        && seller_state_code != place_of_supply_state_code
    {
        "inter_state"
    } else {
        "intra_state"
    };
    Ok(GstContext {
        seller_gstin,
        seller_state_code,
        buyer_gstin,
        place_of_supply_state_code,
        reverse_charge,
        tax_mode: tax_mode.to_string(),
    })
}

async fn gst_context_from_sale(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<GstContext, AppError> {
    let row = sqlx::query_as::<_, (String, String, String, String, bool, String)>(
        "SELECT seller_gstin, seller_state_code, buyer_gstin, place_of_supply_state_code, reverse_charge, tax_mode FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load invoice GST context"))?
    .ok_or_else(|| AppError::not_found("pos invoice was not found"))?;
    Ok(GstContext {
        seller_gstin: row.0,
        seller_state_code: row.1,
        buyer_gstin: row.2,
        place_of_supply_state_code: row.3,
        reverse_charge: row.4,
        tax_mode: row.5,
    })
}

fn normalize_gstin(raw: Option<&str>, field: &str) -> Result<String, AppError> {
    let value = raw.unwrap_or_default().trim().to_ascii_uppercase();
    if !value.is_empty()
        && (value.len() != 15
            || !value
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit()))
    {
        return Err(AppError::validation(format!(
            "{field} must be a valid 15-character GSTIN"
        )));
    }
    Ok(value)
}

fn normalize_state_code(raw: Option<&str>) -> Option<String> {
    let value = raw.unwrap_or_default().trim();
    (value.len() == 2 && value.chars().all(|ch| ch.is_ascii_digit())).then(|| value.to_string())
}

fn gst_state_code(gstin: &str) -> Option<String> {
    normalize_state_code(gstin.get(..2))
}

fn apply_gst_context(
    calculation: &mut PosCalculation,
    context: &GstContext,
    round_to_nearest_rupee: bool,
) {
    let mut tax_paise = 0i64;
    let mut cgst_paise = 0i64;
    let mut sgst_paise = 0i64;
    let mut igst_paise = 0i64;
    for line in &mut calculation.lines {
        let gst_paise = if context.reverse_charge {
            0
        } else {
            percent_of_paise(line.taxable_paise, line.tax_percent)
        };
        let (cgst, sgst, igst) = split_gst(gst_paise, &context.tax_mode);
        line.gst_paise = gst_paise;
        line.cgst_paise = cgst;
        line.sgst_paise = sgst;
        line.igst_paise = igst;
        line.reverse_charge = context.reverse_charge;
        line.line_total_paise = line.taxable_paise.saturating_add(gst_paise);
        tax_paise = tax_paise.saturating_add(gst_paise);
        cgst_paise = cgst_paise.saturating_add(cgst);
        sgst_paise = sgst_paise.saturating_add(sgst);
        igst_paise = igst_paise.saturating_add(igst);
    }
    calculation.tax_paise = tax_paise;
    calculation.cgst_paise = cgst_paise;
    calculation.sgst_paise = sgst_paise;
    calculation.igst_paise = igst_paise;
    let before_round = calculation
        .subtotal_paise
        .saturating_sub(calculation.discount_paise)
        .saturating_add(tax_paise)
        .saturating_add(calculation.tip_paise);
    calculation.total_paise = if round_to_nearest_rupee {
        round_to_rupee(before_round)
    } else {
        before_round
    };
    calculation.round_off_paise = calculation.total_paise.saturating_sub(before_round);
}

fn split_gst(tax_paise: i64, tax_mode: &str) -> (i64, i64, i64) {
    match tax_mode {
        "inter_state" => (0, 0, tax_paise),
        "reverse_charge" => (0, 0, 0),
        _ => {
            let cgst = tax_paise / 2;
            (cgst, tax_paise.saturating_sub(cgst), 0)
        }
    }
}

#[cfg(test)]
mod gst_tests {
    use super::split_gst;

    #[test]
    fn gst_split_preserves_paise_for_intra_and_inter_state_sales() {
        assert_eq!(split_gst(101, "intra_state"), (50, 51, 0));
        assert_eq!(split_gst(101, "inter_state"), (0, 0, 101));
        assert_eq!(split_gst(101, "reverse_charge"), (0, 0, 0));
    }
}

#[cfg(test)]
mod billing_completion_tests {
    use super::{calculate_pos, validated_discount_reason, PosSaleLineInput, PosSalePayload};

    #[test]
    fn other_fee_is_taxed_and_manual_discount_requires_reason() {
        let mut payload = PosSalePayload {
            lines: Some(vec![PosSaleLineInput {
                line_type: Some("service".to_string()),
                item_id: Some("service-1".to_string()),
                item_name: Some("Service".to_string()),
                quantity: Some(2),
                unit_price_paise: Some(10_000),
                other_fee_paise: Some(500),
                gst_percent: Some(18),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let calculation = calculate_pos(&payload).expect("valid POS calculation");
        assert_eq!(calculation.subtotal_paise, 21_000);
        assert_eq!(calculation.tax_paise, 3_780);
        assert_eq!(calculation.total_paise, 24_780);

        payload.bill_discount_paise = Some(100);
        assert!(validated_discount_reason(&payload).is_err());
        payload.discount_reason = Some("Service recovery".to_string());
        assert!(validated_discount_reason(&payload).is_ok());
    }
}

#[cfg(test)]
mod finalized_invoice_patch_tests {
    use super::{refuse_frozen_finalized_fields, require_lifecycle_reason, PosSaleUpdate};

    fn patch() -> PosSaleUpdate {
        PosSaleUpdate {
            status: None,
            staff_id: None,
            source: None,
            reference_id: None,
            reason: None,
        }
    }

    #[test]
    fn a_finalized_invoice_status_goes_through_the_reversal_paths() {
        // Payroll excludes void/refunded/cancelled sales, so patching status
        // moved a sale in or out of someone's payout without touching the
        // ledger the reversal paths maintain.
        let mut change = patch();
        change.status = Some("voided".into());
        let error = refuse_frozen_finalized_fields(&change).expect_err("status must be refused");
        assert!(
            format!("{error:?}").contains("void, refund or credit note"),
            "the refusal has to name the path that does work: {error:?}"
        );
    }

    #[test]
    fn reconciliation_references_are_frozen_after_finalize() {
        // These change no number, which is exactly why a mismatch found weeks
        // later is so hard to trace back to anything.
        for mutate in [
            (|p: &mut PosSaleUpdate| p.source = Some("manual".into())) as fn(&mut PosSaleUpdate),
            |p: &mut PosSaleUpdate| p.reference_id = Some("ref-9".into()),
        ] {
            let mut change = patch();
            mutate(&mut change);
            assert!(refuse_frozen_finalized_fields(&change).is_err());
        }
    }

    #[test]
    fn re_attribution_is_not_blanket_refused() {
        // Tagging the wrong therapist is a real mistake and has to stay
        // correctable, or the correction happens directly in the database.
        let mut change = patch();
        change.staff_id = Some("staff-2".into());
        change.reason = Some("Wrong therapist tagged at the counter".into());
        assert!(refuse_frozen_finalized_fields(&change).is_ok());
    }

    #[test]
    fn re_attribution_still_costs_a_reason() {
        assert!(require_lifecycle_reason("", "staff re-attribution").is_err());
        assert!(require_lifecycle_reason("  ", "staff re-attribution").is_err());
        assert!(require_lifecycle_reason("Wrong therapist tagged", "staff re-attribution").is_ok());
    }

    #[test]
    fn an_untouched_patch_is_allowed_through() {
        // Nothing here refuses a request on its own; only the named fields do.
        // That a draft never reaches this function at all is a property of the
        // handler, asserted in the wiring test rather than pretended at here.
        assert!(refuse_frozen_finalized_fields(&patch()).is_ok());
    }
}

#[cfg(test)]
mod compliance_tests {
    use super::{
        e_invoice_required, e_way_bill_required, ComplianceSaleRow, InvoiceComplianceSettings,
    };
    use chrono::Utc;

    #[test]
    fn compliance_requires_configured_threshold_and_real_goods_movement() {
        let settings = InvoiceComplianceSettings {
            annual_turnover_paise: 5_000_000_000,
            e_invoice_enabled: true,
            e_invoice_threshold_paise: 5_000_000_000,
            e_way_bill_enabled: true,
            e_way_bill_threshold_paise: 5_000_000,
            auto_queue_e_invoice: false,
            updated_at: Utc::now(),
        };
        let sale = ComplianceSaleRow {
            invoice_type: "tax_invoice".to_string(),
            total_paise: 5_000_001,
            seller_gstin: "27ABCDE1234F1Z5".to_string(),
            buyer_gstin: "29ABCDE1234F1Z5".to_string(),
            reverse_charge: false,
        };
        assert!(e_invoice_required(&settings, &sale));
        assert!(!e_way_bill_required(
            &settings,
            sale.total_paise,
            true,
            false
        ));
        assert!(e_way_bill_required(&settings, sale.total_paise, true, true));
    }
}

async fn list_pos_sales(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PosListQuery>,
) -> ApiResult<Vec<PosSaleResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let q = query.q.unwrap_or_default().to_lowercase();

    let rows = sqlx::query_as::<_, PosSaleRow>(
        r#"
        SELECT id, tenant_id, branch_id, client_id, staff_id, invoice_number,
               subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
               tip_paise, round_off_paise, total_paise, paid_paise,
               status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at
        FROM pos_sales
        WHERE tenant_id=$1
          AND branch_id=$2
          AND is_deleted=FALSE
          AND ($3 = '' OR status=$3)
          AND ($4 = '' OR LOWER(invoice_number) LIKE '%' || $4 || '%' OR LOWER(client_id) LIKE '%' || $4 || '%')
        ORDER BY created_at DESC
        LIMIT $5 OFFSET $6
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(query.status.unwrap_or_default())
    .bind(q)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list pos sales"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let line_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&row.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        out.push(sale_response(row, line_count));
    }

    Ok(Json(ApiResponse::ok(out)))
}

async fn get_pos_sales_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PosSalesRegisterQuery>,
) -> ApiResult<PosSalesRegisterResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let offset = (page - 1) * page_size;
    let date_from = normalize_register_date(query.date_from, "dateFrom")?;
    let date_to = normalize_register_date(query.date_to, "dateTo")?;
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    let status = if status == "all" {
        String::new()
    } else {
        status
    };
    let client_id = query.client_id.unwrap_or_default().trim().to_string();
    let q = query.q.unwrap_or_default().trim().to_ascii_lowercase();
    let payment_method = match query.payment_method {
        Some(value) if !value.trim().is_empty() && value.trim().to_ascii_lowercase() != "all" => {
            normalize_payment_method(Some(value))?
        }
        _ => String::new(),
    };

    let rows = sqlx::query_as::<_, PosSalesRegisterRow>(
        r#"
        WITH payment_split AS (
          SELECT pp.sale_id,
                 COALESCE(SUM(CASE WHEN pp.method = 'cash' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS cash_paise,
                 COALESCE(SUM(CASE WHEN pp.method = 'upi' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS upi_paise,
                 COALESCE(SUM(CASE WHEN pp.method = 'card' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS card_paise,
                 COALESCE(SUM(CASE WHEN pp.method = 'wallet' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS wallet_paise,
                 COALESCE(SUM(CASE WHEN sale.finalized_at IS NOT NULL AND pp.paid_at > sale.finalized_at THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS received_due_paise,
                 COALESCE(SUM(CASE WHEN pp.method IN ('gift_card', 'giftCard') THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS gift_card_paise,
                 COALESCE(SUM(CASE WHEN pp.method IN ('store_credit', 'storeCredit') THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS store_credit_paise,
                 COALESCE(SUM(CASE WHEN pp.method NOT IN ('cash', 'upi', 'card', 'wallet', 'gift_card', 'giftCard', 'store_credit', 'storeCredit') THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS other_paise,
                 MAX(pp.paid_at) AS last_payment_at
            FROM pos_payments pp
            INNER JOIN pos_sales sale
              ON sale.tenant_id = pp.tenant_id
             AND sale.branch_id = pp.branch_id
             AND sale.id = pp.sale_id
           WHERE pp.tenant_id = $1
             AND pp.branch_id = $2
           GROUP BY pp.sale_id
        )
        SELECT ps.id,
               ps.invoice_number,
               ps.client_id,
               COALESCE(NULLIF(TRIM(c.first_name || ' ' || c.last_name), ''), ps.client_id) AS client_name,
               COALESCE(c.phone, '') AS client_phone,
               ps.staff_id,
               COALESCE(
                 NULLIF(s.appointment_display_name, ''),
                 NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''),
                 (
                   SELECT string_agg(DISTINCT COALESCE(NULLIF(ls.appointment_display_name, ''), NULLIF(TRIM(CONCAT_WS(' ', ls.first_name, ls.last_name)), '')), ', ')
                     FROM pos_sale_lines pl
                     JOIN staff ls
                       ON ls.tenant_id = pl.tenant_id
                      AND ls.branch_id = pl.branch_id
                      AND ls.id = pl.staff_id
                    WHERE pl.tenant_id = ps.tenant_id
                      AND pl.branch_id = ps.branch_id
                      AND pl.sale_id = ps.id
                 ),
                 ''
               ) AS staff_name,
               ps.status,
               ps.invoice_type,
               COALESCE(ps.business_date::TEXT, ps.created_at::DATE::TEXT) AS business_date,
               COALESCE((
                 SELECT COUNT(*)
                   FROM pos_sale_lines pl
                  WHERE pl.tenant_id = ps.tenant_id
                    AND pl.branch_id = ps.branch_id
                    AND pl.sale_id = ps.id
               ), 0)::BIGINT AS line_count,
               COALESCE((
                 SELECT string_agg(pl.item_name, ', ')
                   FROM pos_sale_lines pl
                  WHERE pl.tenant_id = ps.tenant_id
                    AND pl.branch_id = ps.branch_id
                    AND pl.sale_id = ps.id
               ), '') AS item_names,
               ps.subtotal_paise,
               ps.bill_discount_paise,
               ps.coupon_code,
               ps.coupon_discount_paise,
               ps.discount_paise,
               ps.tax_paise,
               ps.tip_paise,
               ps.round_off_paise,
               ps.total_paise,
               ps.paid_paise,
               GREATEST(ps.total_paise - ps.paid_paise, 0)::BIGINT AS balance_due_paise,
               COALESCE(sp.received_due_paise, 0)::BIGINT AS received_due_paise,
               COALESCE(sp.cash_paise, 0)::BIGINT AS cash_paise,
               COALESCE(sp.upi_paise, 0)::BIGINT AS upi_paise,
               COALESCE(sp.card_paise, 0)::BIGINT AS card_paise,
               COALESCE(sp.wallet_paise, 0)::BIGINT AS wallet_paise,
               COALESCE(sp.gift_card_paise, 0)::BIGINT AS gift_card_paise,
               COALESCE(sp.store_credit_paise, 0)::BIGINT AS store_credit_paise,
               COALESCE(sp.other_paise, 0)::BIGINT AS other_paise,
               sp.last_payment_at,
               ps.finalized_at,
               ps.created_at,
               ps.updated_at
          FROM pos_sales ps
          LEFT JOIN clients c
            ON c.tenant_id = ps.tenant_id
           AND c.branch_id = ps.branch_id
           AND c.id = ps.client_id
          LEFT JOIN staff s
            ON s.tenant_id = ps.tenant_id
           AND s.branch_id = ps.branch_id
           AND s.id = ps.staff_id
          LEFT JOIN payment_split sp ON sp.sale_id = ps.id
         WHERE ps.tenant_id = $1
           AND ps.branch_id = $2
           AND ps.is_deleted = FALSE
           AND ($3 = '' OR COALESCE(ps.business_date, ps.created_at::DATE) >= $3::DATE)
           AND ($4 = '' OR COALESCE(ps.business_date, ps.created_at::DATE) <= $4::DATE)
           AND (($5 = '' AND ps.status <> 'draft') OR ($5 <> '' AND ps.status = $5))
           AND ($6 = '' OR ps.client_id = $6)
           AND (
             $7 = ''
             OR LOWER(ps.invoice_number) LIKE '%' || $7 || '%'
             OR LOWER(ps.client_id) LIKE '%' || $7 || '%'
             OR LOWER(COALESCE(c.phone, '')) LIKE '%' || $7 || '%'
             OR LOWER(COALESCE(TRIM(c.first_name || ' ' || c.last_name), '')) LIKE '%' || $7 || '%'
           )
           AND (
             $8 = ''
             OR EXISTS (
               SELECT 1
                 FROM pos_payments pp
                WHERE pp.tenant_id = ps.tenant_id
                  AND pp.branch_id = ps.branch_id
                  AND pp.sale_id = ps.id
                  AND pp.method = $8
             )
           )
         ORDER BY COALESCE(ps.business_date, ps.created_at::DATE) DESC, ps.created_at DESC
         LIMIT $9 OFFSET $10
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&date_from)
    .bind(&date_to)
    .bind(&status)
    .bind(&client_id)
    .bind(&q)
    .bind(&payment_method)
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sales register"))?;

    let totals = sqlx::query_as::<_, PosSalesRegisterTotals>(
        r#"
        WITH filtered_sales AS (
          SELECT ps.*
            FROM pos_sales ps
            LEFT JOIN clients c
              ON c.tenant_id = ps.tenant_id
             AND c.branch_id = ps.branch_id
             AND c.id = ps.client_id
           WHERE ps.tenant_id = $1
             AND ps.branch_id = $2
             AND ps.is_deleted = FALSE
             AND ($3 = '' OR COALESCE(ps.business_date, ps.created_at::DATE) >= $3::DATE)
             AND ($4 = '' OR COALESCE(ps.business_date, ps.created_at::DATE) <= $4::DATE)
             AND (($5 = '' AND ps.status <> 'draft') OR ($5 <> '' AND ps.status = $5))
             AND ($6 = '' OR ps.client_id = $6)
             AND (
               $7 = ''
               OR LOWER(ps.invoice_number) LIKE '%' || $7 || '%'
               OR LOWER(ps.client_id) LIKE '%' || $7 || '%'
               OR LOWER(COALESCE(c.phone, '')) LIKE '%' || $7 || '%'
               OR LOWER(COALESCE(TRIM(c.first_name || ' ' || c.last_name), '')) LIKE '%' || $7 || '%'
             )
             AND (
               $8 = ''
               OR EXISTS (
                 SELECT 1
                   FROM pos_payments pp
                  WHERE pp.tenant_id = ps.tenant_id
                    AND pp.branch_id = ps.branch_id
                    AND pp.sale_id = ps.id
                    AND pp.method = $8
               )
             )
        ),
        payment_split AS (
          SELECT pp.sale_id,
                 COALESCE(SUM(CASE WHEN pp.method = 'cash' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS cash_paise,
                 COALESCE(SUM(CASE WHEN pp.method = 'upi' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS upi_paise,
                 COALESCE(SUM(CASE WHEN pp.method = 'card' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS card_paise,
                 COALESCE(SUM(CASE WHEN pp.method = 'wallet' THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS wallet_paise,
                 COALESCE(SUM(CASE WHEN fs.finalized_at IS NOT NULL AND pp.paid_at > fs.finalized_at THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS received_due_paise,
                 COALESCE(SUM(CASE WHEN pp.method IN ('gift_card', 'giftCard') THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS gift_card_paise,
                 COALESCE(SUM(CASE WHEN pp.method IN ('store_credit', 'storeCredit') THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS store_credit_paise,
                 COALESCE(SUM(CASE WHEN pp.method NOT IN ('cash', 'upi', 'card', 'wallet', 'gift_card', 'giftCard', 'store_credit', 'storeCredit') THEN pp.amount_paise ELSE 0 END), 0)::BIGINT AS other_paise
            FROM pos_payments pp
            INNER JOIN filtered_sales fs ON fs.id = pp.sale_id
           WHERE pp.tenant_id = $1
             AND pp.branch_id = $2
           GROUP BY pp.sale_id
        )
        SELECT COUNT(fs.id)::BIGINT AS total_rows,
               COALESCE(SUM(fs.subtotal_paise), 0)::BIGINT AS subtotal_paise,
               COALESCE(SUM(fs.bill_discount_paise), 0)::BIGINT AS bill_discount_paise,
               COALESCE(SUM(fs.coupon_discount_paise), 0)::BIGINT AS coupon_discount_paise,
               COALESCE(SUM(fs.discount_paise), 0)::BIGINT AS discount_paise,
               COALESCE(SUM(fs.tax_paise), 0)::BIGINT AS tax_paise,
               COALESCE(SUM(fs.tip_paise), 0)::BIGINT AS tip_paise,
               COALESCE(SUM(fs.round_off_paise), 0)::BIGINT AS round_off_paise,
               COALESCE(SUM(fs.total_paise), 0)::BIGINT AS total_paise,
               COALESCE(SUM(fs.paid_paise), 0)::BIGINT AS paid_paise,
               COALESCE(SUM(GREATEST(fs.total_paise - fs.paid_paise, 0)), 0)::BIGINT AS balance_due_paise,
               COALESCE(SUM(sp.received_due_paise), 0)::BIGINT AS received_due_paise,
               COALESCE(SUM(sp.cash_paise), 0)::BIGINT AS cash_paise,
               COALESCE(SUM(sp.upi_paise), 0)::BIGINT AS upi_paise,
               COALESCE(SUM(sp.card_paise), 0)::BIGINT AS card_paise,
               COALESCE(SUM(sp.wallet_paise), 0)::BIGINT AS wallet_paise,
               COALESCE(SUM(sp.gift_card_paise), 0)::BIGINT AS gift_card_paise,
               COALESCE(SUM(sp.store_credit_paise), 0)::BIGINT AS store_credit_paise,
               COALESCE(SUM(sp.other_paise), 0)::BIGINT AS other_paise
          FROM filtered_sales fs
          LEFT JOIN payment_split sp ON sp.sale_id = fs.id
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&date_from)
    .bind(&date_to)
    .bind(&status)
    .bind(&client_id)
    .bind(&q)
    .bind(&payment_method)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sales register totals"))?;

    Ok(Json(ApiResponse::ok(PosSalesRegisterResponse {
        rows,
        totals,
        page,
        page_size,
    })))
}

async fn get_invoice_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<InvoiceReportQuery>,
) -> ApiResult<Vec<InvoiceReportRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let recovery = query.recovery.unwrap_or_default().to_lowercase();
    if !matches!(recovery.as_str(), "" | "paid" | "due") {
        return Err(AppError::validation("recovery must be paid or due"));
    }
    let rows = sqlx::query_as::<_, InvoiceReportRow>(
        "SELECT ps.id, ps.invoice_number, ps.branch_id, ps.client_id, TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS client_name, ps.staff_id, COALESCE(NULLIF(s.appointment_display_name, ''), TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), '') AS staff_name, COALESCE(ps.finalized_at, ps.created_at)::DATE AS business_date, ps.status, ps.total_paise, ps.paid_paise, GREATEST(ps.total_paise - ps.paid_paise, 0) AS balance_paise, GREATEST(CURRENT_DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE, 0) AS ageing_days, (ps.paid_paise < ps.total_paise AND CURRENT_DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE >= 7) AS follow_up_required FROM pos_sales ps LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id LEFT JOIN staff s ON s.id=ps.staff_id AND s.tenant_id=ps.tenant_id AND s.branch_id=ps.branch_id WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ($3='' OR ps.client_id=$3) AND ($4='' OR ps.staff_id=$4) AND ($5='' OR EXISTS (SELECT 1 FROM pos_payments pp WHERE pp.sale_id=ps.id AND pp.tenant_id=ps.tenant_id AND pp.branch_id=ps.branch_id AND LOWER(pp.method)=LOWER($5))) AND ($6='' OR ps.status=$6) AND ($7::DATE IS NULL OR COALESCE(ps.finalized_at, ps.created_at)::DATE >= $7) AND ($8::DATE IS NULL OR COALESCE(ps.finalized_at, ps.created_at)::DATE <= $8) AND ($9='' OR ($9='paid' AND ps.paid_paise >= ps.total_paise) OR ($9='due' AND ps.paid_paise < ps.total_paise)) AND ($10::INT IS NULL OR CURRENT_DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE >= $10) AND ($11=FALSE OR (ps.paid_paise < ps.total_paise AND CURRENT_DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE >= 7)) ORDER BY COALESCE(ps.finalized_at, ps.created_at) DESC LIMIT 500",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(query.client_id.unwrap_or_default())
    .bind(query.staff_id.unwrap_or_default())
    .bind(query.payment_method.unwrap_or_default())
    .bind(query.status.unwrap_or_default())
    .bind(query.date_from)
    .bind(query.date_to)
    .bind(recovery)
    .bind(query.ageing_days.filter(|days| *days >= 0))
    .bind(query.follow_up.unwrap_or(false))
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_pos_sale(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale_query = format!(
        "{} WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        sale_select_sql()
    );
    let sale = sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load pos sale"))?
        .ok_or_else(|| AppError::not_found("pos sale was not found"))?;

    let lines = read_lines(&state, &tenant_id, &branch_id, &id).await?;
    let payments = read_payments(&state, &tenant_id, &branch_id, &id).await?;

    let client_kpi = read_client_kpi(&state, &tenant_id, &branch_id, &sale.client_id).await?;
    let line_count = lines.len() as i64;
    let response = sale_response(sale, line_count);
    let payment_split = payment_split_response(&payments, response.total_paise);
    let transaction_context =
        read_pos_transaction_context(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments,
        payment_split,
        client_kpi,
        transaction_context,
    })))
}

async fn get_pos_client_kpi(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<PosClientKpiResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let kpi = read_client_kpi(&state, &tenant_id, &branch_id, &id)
        .await?
        .ok_or_else(|| AppError::not_found("client was not found"))?;

    Ok(Json(ApiResponse::ok(kpi)))
}

fn client_due_receipt_response(
    row: PosClientDueReceiptRow,
) -> Result<PosClientDueReceiptResponse, AppError> {
    let allocations = serde_json::from_value(row.allocations_json)
        .map_err(|_| AppError::internal("failed to read due receipt allocations"))?;
    Ok(PosClientDueReceiptResponse {
        receipt_id: row.id,
        client_id: row.client_id,
        method: row.method,
        requested_paise: row.requested_paise,
        received_paise: row.received_paise,
        unpaid_before_paise: row.unpaid_before_paise,
        unpaid_after_paise: row.unpaid_after_paise,
        allocations,
        paid_at: row.paid_at,
        received_by_user_id: row.received_by_user_id,
    })
}

fn allocate_client_due_fifo(balances: &[i64], requested_paise: i64) -> Vec<i64> {
    let mut remaining = requested_paise.max(0);
    balances
        .iter()
        .map(|balance| {
            let allocation = remaining.min((*balance).max(0));
            remaining = remaining.saturating_sub(allocation);
            allocation
        })
        .collect()
}

async fn read_client_due_receipt(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    idempotency_key: &str,
) -> Result<PosClientDueReceiptResponse, AppError> {
    let row = sqlx::query_as::<_, PosClientDueReceiptRow>(
        "SELECT id, client_id, method, requested_paise, received_paise, unpaid_before_paise, unpaid_after_paise, allocations_json, paid_at, received_by_user_id FROM pos_client_due_receipts WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND idempotency_key=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(idempotency_key)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to read due receipt idempotency key"))?
    .ok_or_else(|| AppError::conflict("duplicate due receipt is still being processed"))?;
    client_due_receipt_response(row)
}

async fn receive_pos_client_unpaid(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Path(client_id): Path<String>,
    Json(payload): Json<PosPaymentInput>,
) -> ApiResult<PosClientDueReceiptResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let requested_till_id = payload.cash_drawer_till_id.clone().unwrap_or_default();
    let paid_at = validate_paid_at(payload.paid_at)?;
    let requested_paise = payload
        .amount_paise
        .unwrap_or_else(|| rupees_to_paise(payload.amount.unwrap_or(0.0)))
        .max(0);
    if requested_paise == 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    let idempotency_key = payload.idempotency_key.unwrap_or_default();
    if idempotency_key.trim().is_empty() {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    let method = normalize_payment_method(payload.method.or(payload.mode))?;
    let reference = payload
        .method_reference
        .or(payload.reference)
        .unwrap_or_default();
    let label = payload
        .label
        .unwrap_or_else(|| default_payment_label(&method));
    let notes = payload.notes.unwrap_or_default();
    let validation_payment = PreparedPayment {
        method: method.clone(),
        reference: reference.clone(),
        label: label.clone(),
        amount_paise: requested_paise,
        notes: notes.clone(),
        idempotency_key: idempotency_key.clone(),
        paid_at: paid_at.clone(),
    };
    validate_active_payment_modes(
        &state,
        &tenant_id,
        &branch_id,
        std::slice::from_ref(&validation_payment),
    )
    .await?;

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start client due receipt"))?;
    let client_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&client_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to validate client"))?;
    if !client_exists {
        return Err(AppError::not_found("client was not found"));
    }

    let receipt_id = uuid::Uuid::new_v4().to_string();
    let inserted_receipt_id = sqlx::query_scalar::<_, String>(
        r#"
        INSERT INTO pos_client_due_receipts (
            id, tenant_id, branch_id, client_id, method, method_reference,
            requested_paise, notes, idempotency_key, paid_at, received_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),$11)
        ON CONFLICT (tenant_id, branch_id, client_id, idempotency_key) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(&receipt_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&client_id)
    .bind(&method)
    .bind(&reference)
    .bind(requested_paise)
    .bind(&notes)
    .bind(idempotency_key.trim())
    .bind(paid_at.clone())
    .bind(&claims.sub)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to reserve due receipt"))?;
    if inserted_receipt_id.is_none() {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate due receipt"))?;
        return Ok(Json(ApiResponse::ok(
            read_client_due_receipt(
                &state,
                &tenant_id,
                &branch_id,
                &client_id,
                idempotency_key.trim(),
            )
            .await?,
        )));
    }

    let sales_query = format!(
        "{} WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND status NOT IN ('draft','paid','cancelled','voided','refunded') AND total_paise > paid_paise ORDER BY COALESCE(finalized_at, created_at), created_at, id FOR UPDATE",
        sale_select_sql()
    );
    let sales = sqlx::query_as::<_, PosSaleRow>(&sales_query)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&client_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to load client unpaid invoices"))?;
    let unpaid_before_paise = sales.iter().fold(0_i64, |total, sale| {
        total.saturating_add(sale.total_paise.saturating_sub(sale.paid_paise).max(0))
    });
    if unpaid_before_paise == 0 {
        return Err(AppError::validation("client has no unpaid invoice balance"));
    }

    let received_paise = requested_paise.min(unpaid_before_paise);
    let allocation_amounts = allocate_client_due_fifo(
        &sales
            .iter()
            .map(|sale| sale.total_paise.saturating_sub(sale.paid_paise).max(0))
            .collect::<Vec<_>>(),
        received_paise,
    );
    let mut allocations = Vec::new();
    let mut published_sales = Vec::new();
    let mut appointment_events = Vec::new();
    for (sale, allocation_paise) in sales.into_iter().zip(allocation_amounts) {
        if allocation_paise == 0 {
            break;
        }
        let balance_before_paise = sale.total_paise.saturating_sub(sale.paid_paise).max(0);
        let payment_key = format!("{}:invoice:{}", idempotency_key.trim(), sale.id);
        let mut payment_rows = insert_pos_payments(
            &mut tx,
            &tenant_id,
            &branch_id,
            &client_id,
            &sale.id,
            true,
            &requested_till_id,
            vec![PreparedPayment {
                method: method.clone(),
                reference: reference.clone(),
                label: label.clone(),
                amount_paise: allocation_paise,
                notes: notes.clone(),
                idempotency_key: payment_key,
                paid_at: paid_at.clone(),
            }],
        )
        .await?;
        let payment = payment_rows
            .pop()
            .ok_or_else(|| AppError::internal("failed to create due payment"))?;
        let payment_row = PosPaymentRow {
            id: payment.id.clone(),
            tenant_id: tenant_id.clone(),
            branch_id: branch_id.clone(),
            sale_id: sale.id.clone(),
            method: payment.method.clone(),
            amount_paise: payment.amount_paise,
            method_reference: payment.method_reference.clone(),
            label: payment.label.clone(),
            notes: payment.notes.clone(),
            paid_at: payment.paid_at,
            created_at: payment.created_at,
        };
        let (_, _, sale_appointment_events) =
            apply_pos_payment_effects(&mut tx, &tenant_id, &branch_id, &sale, &payment_row).await?;
        allocations.push(PosClientDueAllocation {
            invoice_id: sale.id.clone(),
            invoice_number: sale.invoice_number.clone(),
            payment_id: payment.id,
            balance_before_paise,
            received_paise: allocation_paise,
            balance_after_paise: balance_before_paise.saturating_sub(allocation_paise),
        });
        published_sales.push(sale.id);
        appointment_events.extend(sale_appointment_events);
    }
    let unpaid_after_paise = unpaid_before_paise.saturating_sub(received_paise);
    let allocations_json = serde_json::to_value(&allocations)
        .map_err(|_| AppError::internal("failed to serialize due receipt allocations"))?;
    let receipt = sqlx::query_as::<_, PosClientDueReceiptRow>(
        "UPDATE pos_client_due_receipts SET received_paise=$5, unpaid_before_paise=$6, unpaid_after_paise=$7, allocations_json=$8 WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4 RETURNING id, client_id, method, requested_paise, received_paise, unpaid_before_paise, unpaid_after_paise, allocations_json, paid_at, received_by_user_id",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&client_id)
    .bind(&receipt_id)
    .bind(received_paise)
    .bind(unpaid_before_paise)
    .bind(unpaid_after_paise)
    .bind(allocations_json)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to save due receipt"))?;

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit client due receipt"))?;
    for sale_id in &published_sales {
        state.publish_pos_event(
            &tenant_id,
            &branch_id,
            "invoice",
            sale_id,
            "payment.recorded",
        );
    }
    for event in appointment_events {
        let _ = state.appointment_events.send(event);
    }
    Ok(Json(ApiResponse::ok(client_due_receipt_response(receipt)?)))
}

pub(crate) async fn get_pos_invoice_print(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<PosInvoicePrintResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    let print_html = render_invoice_print_html(&details);
    let pdf_file_name = invoice_print_file_name(&details.sale.invoice_number, "pdf");

    Ok(Json(ApiResponse::ok(PosInvoicePrintResponse {
        invoice: details.sale,
        lines: details.lines,
        payments: details.payments,
        payment_split: details.payment_split,
        client_kpi: details.client_kpi,
        print_html,
        pdf_file_name,
    })))
}

async fn get_invoice_business_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Option<InvoiceBusinessProfile>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        read_invoice_business_profile(&state, &tenant_id, &branch_id).await?,
    )))
}

async fn get_invoice_appearance_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<InvoiceAppearanceSettings> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        read_invoice_appearance_settings(&state, &tenant_id, &branch_id).await?,
    )))
}

async fn update_invoice_appearance_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<InvoiceAppearanceSettings>,
) -> ApiResult<InvoiceAppearanceSettings> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let settings = validate_invoice_appearance_settings(payload)?;
    let value = serde_json::to_value(&settings)
        .map_err(|_| AppError::internal("failed to serialize invoice settings"))?;
    let saved = invoice_settings_repository::upsert(&state.db, &tenant_id, &branch_id, &value)
        .await
        .map_err(|_| AppError::internal("failed to save invoice settings"))?;
    let settings = serde_json::from_value(saved)
        .map_err(|_| AppError::internal("failed to read saved invoice settings"))?;
    Ok(Json(ApiResponse::ok(settings)))
}

async fn get_invoice_compliance_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<InvoiceComplianceSettings> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        read_invoice_compliance_settings(&state, &tenant_id, &branch_id).await?,
    )))
}

async fn update_invoice_compliance_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<InvoiceComplianceSettingsRequest>,
) -> ApiResult<InvoiceComplianceSettings> {
    if payload.annual_turnover_paise < 0 {
        return Err(AppError::validation(
            "annualTurnoverPaise must be zero or greater",
        ));
    }
    let e_invoice_threshold_paise = payload.e_invoice_threshold_paise.unwrap_or(5_000_000_000);
    let e_way_bill_threshold_paise = payload.e_way_bill_threshold_paise.unwrap_or(5_000_000);
    if e_invoice_threshold_paise <= 0 || e_way_bill_threshold_paise <= 0 {
        return Err(AppError::validation(
            "compliance thresholds must be greater than zero",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let settings = sqlx::query_as::<_, InvoiceComplianceSettings>(
        "INSERT INTO invoice_compliance_settings (tenant_id, branch_id, annual_turnover_paise, e_invoice_enabled, e_invoice_threshold_paise, e_way_bill_enabled, e_way_bill_threshold_paise, auto_queue_e_invoice) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, branch_id) DO UPDATE SET annual_turnover_paise=EXCLUDED.annual_turnover_paise, e_invoice_enabled=EXCLUDED.e_invoice_enabled, e_invoice_threshold_paise=EXCLUDED.e_invoice_threshold_paise, e_way_bill_enabled=EXCLUDED.e_way_bill_enabled, e_way_bill_threshold_paise=EXCLUDED.e_way_bill_threshold_paise, auto_queue_e_invoice=EXCLUDED.auto_queue_e_invoice, updated_at=NOW() RETURNING annual_turnover_paise, e_invoice_enabled, e_invoice_threshold_paise, e_way_bill_enabled, e_way_bill_threshold_paise, auto_queue_e_invoice, updated_at",
    )
    .bind(&tenant_id).bind(&branch_id).bind(payload.annual_turnover_paise)
    .bind(payload.e_invoice_enabled).bind(e_invoice_threshold_paise)
    .bind(payload.e_way_bill_enabled).bind(e_way_bill_threshold_paise)
    .bind(payload.auto_queue_e_invoice).fetch_one(&state.db).await
    .map_err(|_| AppError::internal("failed to save invoice compliance settings"))?;
    Ok(Json(ApiResponse::ok(settings)))
}

async fn get_invoice_compliance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<InvoiceComplianceDetails> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let record = sqlx::query_as::<_, InvoiceComplianceRecord>(
        "SELECT e_invoice_status, e_way_bill_status, eligibility_json AS eligibility, updated_at FROM pos_invoice_compliance WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load invoice compliance"))?
    .ok_or_else(|| AppError::not_found("invoice compliance was not evaluated"))?;
    let jobs = sqlx::query_as::<_, ComplianceJobStatus>(
        "SELECT document_type, status, attempt_count, provider_reference, last_error, next_attempt_at, submitted_at, result_json AS result FROM pos_compliance_jobs WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at, id",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load compliance jobs"))?;
    Ok(Json(ApiResponse::ok(InvoiceComplianceDetails {
        record,
        jobs,
    })))
}

/// The branch's whole e-invoice and e-way bill queue in one place.
///
/// Per-invoice status already existed, and that is the wrong altitude for this:
/// a failure only surfaced if somebody happened to open the one invoice it
/// happened to. Forty invoices can fail their IRN in an afternoon — an expired
/// provider token does exactly that — and under the old view nobody finds out
/// until a customer asks for a document that was never generated.
///
/// It also reports whether a provider is configured at all, because the most
/// likely reason a queue is not moving is that nothing is connected to it, and
/// an empty "queued" count looks identical either way.
async fn get_compliance_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let counts: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT document_type,status,COUNT(*)::BIGINT \
           FROM pos_compliance_jobs \
          WHERE tenant_id=$1 AND branch_id=$2 \
          GROUP BY document_type,status ORDER BY document_type,status",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to summarise the compliance queue"))?;

    // Exhausted jobs first: those have stopped retrying and will not move again
    // without someone looking at them.
    let attention: Vec<(String, String, String, String, i32, String)> = sqlx::query_as(
        "SELECT job.id,COALESCE(sale.invoice_number,''),job.document_type,job.status,\
                job.attempt_count,job.last_error \
           FROM pos_compliance_jobs job \
           LEFT JOIN pos_sales sale ON sale.id=job.sale_id AND sale.tenant_id=job.tenant_id \
          WHERE job.tenant_id=$1 AND job.branch_id=$2 \
            AND (job.status='failed' OR job.attempt_count >= 5) \
          ORDER BY job.updated_at DESC LIMIT 100",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load compliance jobs needing attention"))?;

    let stuck = attention.len() as i64;
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "providerConfigured": state.settings.compliance_provider_enabled(),
        "counts": counts
            .into_iter()
            .map(|(document_type, status, count)| serde_json::json!({
                "documentType": document_type, "status": status, "count": count
            }))
            .collect::<Vec<Value>>(),
        "needsAttentionCount": stuck,
        "needsAttention": attention
            .into_iter()
            .map(|(id, invoice_number, document_type, status, attempts, last_error)| {
                serde_json::json!({
                    "jobId": id,
                    "invoiceNumber": invoice_number,
                    "documentType": document_type,
                    "status": status,
                    "attemptCount": attempts,
                    "lastError": last_error,
                })
            })
            .collect::<Vec<Value>>(),
    }))))
}

#[derive(FromRow)]
struct ComplianceSaleRow {
    invoice_type: String,
    total_paise: i64,
    seller_gstin: String,
    buyer_gstin: String,
    reverse_charge: bool,
}

async fn queue_invoice_compliance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<ComplianceQueueRequest>,
) -> ApiResult<InvoiceComplianceRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start compliance transaction"))?;
    let sale = sqlx::query_as::<_, ComplianceSaleRow>(
        "SELECT invoice_type, total_paise, seller_gstin, buyer_gstin, reverse_charge FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND finalized_at IS NOT NULL FOR UPDATE",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_optional(&mut *tx).await
    .map_err(|_| AppError::internal("failed to load invoice for compliance"))?
    .ok_or_else(|| AppError::not_found("finalized invoice was not found"))?;
    let settings = read_invoice_compliance_settings_tx(&mut tx, &tenant_id, &branch_id).await?;
    let has_products = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='product')",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_one(&mut *tx).await
    .map_err(|_| AppError::internal("failed to evaluate invoice goods movement"))?;
    let e_invoice_required = e_invoice_required(&settings, &sale);
    let e_way_bill_required = e_way_bill_required(
        &settings,
        sale.total_paise,
        has_products,
        request.movement_required.unwrap_or(false),
    );
    let request_e_invoice = request.e_invoice.unwrap_or(true);
    let request_e_way_bill = request.e_way_bill.unwrap_or(false);
    if request_e_invoice && !e_invoice_required {
        return Err(AppError::validation(
            "e-invoice is not required for this invoice under current compliance settings",
        ));
    }
    if request_e_way_bill && !e_way_bill_required {
        return Err(AppError::validation(
            "e-way bill requires enabled settings, eligible goods value, and movementRequired=true",
        ));
    }
    if !request_e_invoice && !request_e_way_bill {
        return Err(AppError::validation(
            "select eInvoice or eWayBill to queue compliance work",
        ));
    }
    if request_e_invoice {
        enqueue_compliance_job(&mut tx, &tenant_id, &branch_id, &id, "e_invoice").await?;
    }
    if request_e_way_bill {
        enqueue_compliance_job(&mut tx, &tenant_id, &branch_id, &id, "e_way_bill").await?;
    }
    let eligibility = compliance_eligibility_json(
        &settings,
        &sale,
        has_products,
        request.movement_required.unwrap_or(false),
    );
    let record = upsert_invoice_compliance(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        if request_e_invoice {
            "queued"
        } else {
            "not_required"
        },
        if request_e_way_bill {
            "queued"
        } else {
            "review_required"
        },
        eligibility,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit compliance queue"))?;
    Ok(Json(ApiResponse::ok(record)))
}

fn default_invoice_compliance_settings() -> InvoiceComplianceSettings {
    InvoiceComplianceSettings {
        annual_turnover_paise: 0,
        e_invoice_enabled: false,
        e_invoice_threshold_paise: 5_000_000_000,
        e_way_bill_enabled: false,
        e_way_bill_threshold_paise: 5_000_000,
        auto_queue_e_invoice: false,
        updated_at: Utc::now(),
    }
}

async fn read_invoice_compliance_settings(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InvoiceComplianceSettings, AppError> {
    sqlx::query_as::<_, InvoiceComplianceSettings>(
        "SELECT annual_turnover_paise, e_invoice_enabled, e_invoice_threshold_paise, e_way_bill_enabled, e_way_bill_threshold_paise, auto_queue_e_invoice, updated_at FROM invoice_compliance_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id).bind(branch_id).fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load invoice compliance settings"))?
    .map(Ok)
    .unwrap_or_else(|| Ok(default_invoice_compliance_settings()))
}

async fn read_invoice_compliance_settings_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InvoiceComplianceSettings, AppError> {
    sqlx::query_as::<_, InvoiceComplianceSettings>(
        "SELECT annual_turnover_paise, e_invoice_enabled, e_invoice_threshold_paise, e_way_bill_enabled, e_way_bill_threshold_paise, auto_queue_e_invoice, updated_at FROM invoice_compliance_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id).bind(branch_id).fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to load invoice compliance settings"))?
    .map(Ok)
    .unwrap_or_else(|| Ok(default_invoice_compliance_settings()))
}

fn e_invoice_required(settings: &InvoiceComplianceSettings, sale: &ComplianceSaleRow) -> bool {
    settings.e_invoice_enabled
        && settings.annual_turnover_paise >= settings.e_invoice_threshold_paise
        && sale.invoice_type == "tax_invoice"
        && !sale.seller_gstin.is_empty()
        && !sale.buyer_gstin.is_empty()
        && !sale.reverse_charge
}

fn e_way_bill_required(
    settings: &InvoiceComplianceSettings,
    total_paise: i64,
    has_products: bool,
    movement_required: bool,
) -> bool {
    settings.e_way_bill_enabled
        && movement_required
        && has_products
        && total_paise > settings.e_way_bill_threshold_paise
}

fn compliance_eligibility_json(
    settings: &InvoiceComplianceSettings,
    sale: &ComplianceSaleRow,
    has_products: bool,
    movement_required: bool,
) -> Value {
    serde_json::json!({
        "eInvoiceRequired": e_invoice_required(settings, sale),
        "eWayBillRequired": e_way_bill_required(settings, sale.total_paise, has_products, movement_required),
        "annualTurnoverPaise": settings.annual_turnover_paise,
        "eInvoiceThresholdPaise": settings.e_invoice_threshold_paise,
        "eWayBillThresholdPaise": settings.e_way_bill_threshold_paise,
        "invoiceType": sale.invoice_type,
        "hasProducts": has_products,
        "movementRequired": movement_required,
        "reverseCharge": sale.reverse_charge,
    })
}

async fn enqueue_compliance_job(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    document_type: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO pos_compliance_jobs (tenant_id, branch_id, sale_id, document_type, payload_json) VALUES ($1,$2,$3,$4,'{}'::jsonb) ON CONFLICT (tenant_id, branch_id, sale_id, document_type) DO NOTHING",
    )
    .bind(tenant_id).bind(branch_id).bind(sale_id).bind(document_type)
    .execute(&mut **tx).await
    .map_err(|_| AppError::internal("failed to queue compliance job"))?;
    Ok(())
}

async fn upsert_invoice_compliance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    e_invoice_status: &str,
    e_way_bill_status: &str,
    eligibility: Value,
) -> Result<InvoiceComplianceRecord, AppError> {
    sqlx::query_as::<_, InvoiceComplianceRecord>(
        "INSERT INTO pos_invoice_compliance (tenant_id, branch_id, sale_id, e_invoice_status, e_way_bill_status, eligibility_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (tenant_id, branch_id, sale_id) DO UPDATE SET e_invoice_status=EXCLUDED.e_invoice_status, e_way_bill_status=EXCLUDED.e_way_bill_status, eligibility_json=EXCLUDED.eligibility_json, updated_at=NOW() RETURNING e_invoice_status, e_way_bill_status, eligibility_json AS eligibility, updated_at",
    )
    .bind(tenant_id).bind(branch_id).bind(sale_id).bind(e_invoice_status).bind(e_way_bill_status).bind(eligibility.to_string())
    .fetch_one(&mut **tx).await
    .map_err(|_| AppError::internal("failed to record invoice compliance"))
}

async fn record_invoice_compliance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    invoice_type: &str,
    total_paise: i64,
    seller_gstin: &str,
    buyer_gstin: &str,
    reverse_charge: bool,
    has_products: bool,
) -> Result<(), AppError> {
    let settings = read_invoice_compliance_settings_tx(tx, tenant_id, branch_id).await?;
    let sale = ComplianceSaleRow {
        invoice_type: invoice_type.to_string(),
        total_paise,
        seller_gstin: seller_gstin.to_string(),
        buyer_gstin: buyer_gstin.to_string(),
        reverse_charge,
    };
    let e_invoice_required = e_invoice_required(&settings, &sale);
    if e_invoice_required && settings.auto_queue_e_invoice {
        enqueue_compliance_job(tx, tenant_id, branch_id, sale_id, "e_invoice").await?;
    }
    let e_way_review = settings.e_way_bill_enabled
        && has_products
        && total_paise > settings.e_way_bill_threshold_paise;
    upsert_invoice_compliance(
        tx,
        tenant_id,
        branch_id,
        sale_id,
        if e_invoice_required && settings.auto_queue_e_invoice {
            "queued"
        } else if e_invoice_required {
            "review_required"
        } else {
            "not_required"
        },
        if e_way_review {
            "review_required"
        } else {
            "not_required"
        },
        compliance_eligibility_json(&settings, &sale, has_products, false),
    )
    .await?;
    Ok(())
}

async fn update_invoice_business_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<InvoiceBusinessProfileRequest>,
) -> ApiResult<InvoiceBusinessProfile> {
    let profile = validate_invoice_business_profile(payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let saved = sqlx::query_as::<_, InvoiceBusinessProfile>(
        "INSERT INTO invoice_business_profiles (tenant_id, branch_id, legal_name, trade_name, is_gst_registered, gstin, address_line1, address_line2, city, state, pincode, phone, email, upi_id, upi_payee_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (tenant_id, branch_id) DO UPDATE SET legal_name=EXCLUDED.legal_name, trade_name=EXCLUDED.trade_name, is_gst_registered=EXCLUDED.is_gst_registered, gstin=EXCLUDED.gstin, address_line1=EXCLUDED.address_line1, address_line2=EXCLUDED.address_line2, city=EXCLUDED.city, state=EXCLUDED.state, pincode=EXCLUDED.pincode, phone=EXCLUDED.phone, email=EXCLUDED.email, upi_id=EXCLUDED.upi_id, upi_payee_name=EXCLUDED.upi_payee_name, updated_at=NOW() RETURNING legal_name, trade_name, is_gst_registered, gstin, address_line1, address_line2, city, state, pincode, phone, email, upi_id, upi_payee_name",
    )
    .bind(&tenant_id).bind(&branch_id)
    .bind(&profile.legal_name).bind(&profile.trade_name).bind(profile.is_gst_registered).bind(&profile.gstin)
    .bind(&profile.address_line1).bind(&profile.address_line2).bind(&profile.city).bind(&profile.state).bind(&profile.pincode)
    .bind(&profile.phone).bind(&profile.email).bind(&profile.upi_id).bind(&profile.upi_payee_name)
    .fetch_one(&state.db).await
    .map_err(|_| AppError::internal("failed to save invoice business profile"))?;
    Ok(Json(ApiResponse::ok(saved)))
}

/// Everything the PDF renderer needs about one sale, plus the UPI URI it also
/// takes separately.
///
/// Shared by the download route and by the seal at finalize so that both write
/// the same bytes; building the document twice, slightly differently, is how a
/// sealed record stops matching what the guest was handed.
async fn build_invoice_pdf_document(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(Value, String), AppError> {
    let details = load_pos_sale_details(state, tenant_id, branch_id, sale_id).await?;
    let gst_context = gst_context_from_sale(state, tenant_id, branch_id, sale_id).await?;
    let profile = read_invoice_business_profile(state, tenant_id, branch_id).await?;
    let upi_uri = profile
        .as_ref()
        .and_then(invoice_profile_upi_uri)
        .unwrap_or_default();
    let mut document = serde_json::to_value(&details)
        .map_err(|_| AppError::internal("failed to serialize invoice document"))?;
    document["upiUri"] = Value::String(upi_uri.clone());
    document["gst"] = serde_json::json!({
        "sellerGstin": gst_context.seller_gstin,
        "sellerStateCode": gst_context.seller_state_code,
        "buyerGstin": gst_context.buyer_gstin,
        "placeOfSupplyStateCode": gst_context.place_of_supply_state_code,
        "taxMode": gst_context.tax_mode,
        "reverseCharge": gst_context.reverse_charge,
    });
    document["seller"] = serde_json::to_value(profile)
        .map_err(|_| AppError::internal("failed to serialize invoice business profile"))?;
    document["appearance"] =
        serde_json::to_value(read_invoice_appearance_settings(state, tenant_id, branch_id).await?)
            .map_err(|_| AppError::internal("failed to serialize invoice settings"))?;
    Ok((document, upi_uri))
}

/// Renders one layout and writes it as the permanent record for the invoice.
///
/// `ON CONFLICT DO NOTHING` is what makes it permanent: the first seal wins and
/// every later call reads it back instead of overwriting. Callers must only
/// reach this for a finalized invoice — see [`seal_finalized_invoice_pdfs`].
async fn store_invoice_pdf_snapshot(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    layout: InvoicePdfLayout,
) -> Result<InvoicePdfSnapshotRow, AppError> {
    let (document, upi_uri) =
        build_invoice_pdf_document(state, tenant_id, branch_id, sale_id).await?;
    let pdf = invoice_pdf::render(&document, layout, &upi_uri)?;
    let sha256 = invoice_pdf::sha256_hex(&pdf);
    let inserted = sqlx::query_as::<_, InvoicePdfSnapshotRow>(
        "INSERT INTO pos_invoice_documents (tenant_id, branch_id, sale_id, layout, sha256, source_json, pdf_bytes) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (tenant_id, branch_id, sale_id, layout) DO NOTHING RETURNING pdf_bytes, sha256",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(layout.as_str())
    .bind(&sha256)
    .bind(document.to_string())
    .bind(&pdf)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to snapshot invoice PDF"))?;
    match inserted {
        Some(snapshot) => Ok(snapshot),
        // Another request sealed it first. Theirs is the record.
        None => read_invoice_pdf_snapshot(state, tenant_id, branch_id, sale_id, layout.as_str())
            .await?
            .ok_or_else(|| AppError::internal("invoice PDF snapshot was not found")),
    }
}

/// Seals both layouts at the moment the invoice becomes one.
///
/// The snapshot used to be written lazily, by whoever first downloaded a PDF.
/// That made the "permanent record" a record of whenever somebody happened to
/// click, not of what was issued — and because nothing checked `finalized_at`,
/// downloading a draft sealed the draft, so the finalized invoice would hand
/// back a PDF of a bill that was still being edited.
///
/// Failures here are logged rather than returned. The finalize transaction has
/// already committed by the time this runs, so there is nothing left to roll
/// back, and refusing the response would tell the counter the sale failed when
/// it did not. The download path still seals on first read, which now covers
/// this case correctly because the invoice is finalized by then.
async fn seal_finalized_invoice_pdfs(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) {
    for layout in [InvoicePdfLayout::A4, InvoicePdfLayout::Thermal] {
        if let Err(error) =
            store_invoice_pdf_snapshot(state, tenant_id, branch_id, sale_id, layout).await
        {
            tracing::warn!(
                sale_id = %sale_id,
                layout = layout.as_str(),
                error = ?error,
                "invoice PDF snapshot deferred to first download"
            );
        }
    }
}

async fn get_pos_invoice_pdf(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<InvoicePdfQuery>,
) -> Result<Response, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let layout = InvoicePdfLayout::parse(query.layout.as_deref())?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    let file_name = invoice_print_file_name(&sale.invoice_number, "pdf");
    if let Some(snapshot) =
        read_invoice_pdf_snapshot(&state, &tenant_id, &branch_id, &id, layout.as_str()).await?
    {
        return invoice_pdf_response(snapshot.pdf_bytes, &snapshot.sha256, &file_name);
    }

    // A draft is still being edited, so there is nothing to preserve yet.
    // Sealing one would freeze a half-finished bill as the invoice's permanent
    // record, and every later download — including after finalize — would hand
    // back that draft.
    if sale.finalized_at.is_none() {
        let (document, upi_uri) =
            build_invoice_pdf_document(&state, &tenant_id, &branch_id, &id).await?;
        let pdf = invoice_pdf::render(&document, layout, &upi_uri)?;
        let sha256 = invoice_pdf::sha256_hex(&pdf);
        return invoice_pdf_response(pdf, &sha256, &file_name);
    }

    let snapshot = store_invoice_pdf_snapshot(&state, &tenant_id, &branch_id, &id, layout).await?;
    invoice_pdf_response(snapshot.pdf_bytes, &snapshot.sha256, &file_name)
}

async fn read_invoice_business_profile(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<InvoiceBusinessProfile>, AppError> {
    sqlx::query_as::<_, InvoiceBusinessProfile>(
        "SELECT legal_name, trade_name, is_gst_registered, gstin, address_line1, address_line2, city, state, pincode, phone, email, upi_id, upi_payee_name FROM invoice_business_profiles WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice business profile"))
}

async fn read_invoice_appearance_settings(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<InvoiceAppearanceSettings, AppError> {
    let saved = invoice_settings_repository::get(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load invoice settings"))?;
    saved
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| AppError::internal("stored invoice settings are invalid"))
        .map(|settings| settings.unwrap_or_default())
}

fn validate_invoice_appearance_settings(
    mut settings: InvoiceAppearanceSettings,
) -> Result<InvoiceAppearanceSettings, AppError> {
    settings.layout = settings.layout.trim().to_ascii_lowercase();
    if !matches!(settings.layout.as_str(), "a4" | "thermal") {
        return Err(AppError::validation("layout must be a4 or thermal"));
    }
    settings.heading = clean_invoice_setting(settings.heading, "heading", 80)?;
    settings.invoice_number_prefix =
        clean_invoice_setting(settings.invoice_number_prefix, "invoiceNumberPrefix", 24)?;
    settings.thanks_message = clean_invoice_setting(settings.thanks_message, "thanksMessage", 240)?;
    settings.powered_by = clean_invoice_setting(settings.powered_by, "poweredBy", 80)?;
    settings.room_heading = clean_invoice_setting(settings.room_heading, "roomHeading", 80)?;
    settings.terms_and_conditions =
        clean_invoice_setting(settings.terms_and_conditions, "termsAndConditions", 4000)?;
    settings.secondary_language_name = clean_invoice_setting(
        settings.secondary_language_name,
        "secondaryLanguageName",
        40,
    )?;
    clean_invoice_language_labels(&mut settings.english_labels, "englishLabels")?;
    clean_invoice_language_labels(&mut settings.secondary_labels, "secondaryLabels")?;
    Ok(settings)
}

fn clean_invoice_language_labels(
    labels: &mut InvoiceLanguageLabels,
    prefix: &str,
) -> Result<(), AppError> {
    macro_rules! clean_fields {
        ($($field:ident),+ $(,)?) => {
            $(labels.$field = clean_invoice_setting(
                std::mem::take(&mut labels.$field),
                &format!("{prefix}.{}", stringify!($field)),
                80,
            )?;)+
        };
    }
    clean_fields!(
        salon_name,
        email,
        contact,
        address,
        thanks_message,
        powered_by,
        extra_text1,
        extra_text2,
        tax_invoice_text,
        gstin,
        date,
        invoice_id,
        customer_name,
        customer_contact,
        actual_price,
        discount_percentage,
        taxable_amount,
        gst,
        total,
        paid,
        due,
        services,
        quantity,
        price,
        discount,
        product,
        package,
        membership,
        valid,
        staff,
        payment_method,
        appointment_time,
        wallet_balance,
        terms,
        signature,
        items,
        hsn_sac,
        subtotal,
        time,
        pending_services,
        bill_notes,
        download_invoice,
        feedback_link,
        invoice_link,
        status,
        place_of_supply,
        buyer_gstin,
        cgst,
        sgst,
        igst,
        reverse_charge,
        upi_payment,
    );
    Ok(())
}

fn clean_invoice_setting(value: String, field: &str, max_len: usize) -> Result<String, AppError> {
    let value = value.trim().to_string();
    if value.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{field} must be {max_len} characters or fewer"
        )));
    }
    Ok(value)
}

fn validate_invoice_business_profile(
    payload: InvoiceBusinessProfileRequest,
) -> Result<InvoiceBusinessProfile, AppError> {
    let required = |value: String, field: &str| {
        let value = value.trim().to_string();
        if value.is_empty() {
            Err(AppError::validation(format!("{field} is required")))
        } else {
            Ok(value)
        }
    };
    let legal_name = required(payload.legal_name, "legalName")?;
    let address_line1 = required(payload.address_line1, "addressLine1")?;
    let city = required(payload.city, "city")?;
    let state = required(payload.state, "state")?;
    let pincode = required(payload.pincode, "pincode")?;
    if !pincode.chars().all(|ch| ch.is_ascii_digit()) || !(5..=10).contains(&pincode.len()) {
        return Err(AppError::validation("pincode must contain 5 to 10 digits"));
    }
    let gstin = payload
        .gstin
        .unwrap_or_default()
        .trim()
        .to_ascii_uppercase();
    if payload.is_gst_registered
        && (gstin.len() != 15
            || !gstin
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit()))
    {
        return Err(AppError::validation(
            "a valid 15-character GSTIN is required",
        ));
    }
    let upi_id = payload.upi_id.unwrap_or_default().trim().to_string();
    if !upi_id.is_empty() && (!upi_id.contains('@') || upi_id.chars().any(|ch| ch.is_whitespace()))
    {
        return Err(AppError::validation(
            "upiId must be a valid UPI virtual payment address",
        ));
    }
    Ok(InvoiceBusinessProfile {
        legal_name,
        trade_name: payload.trade_name.unwrap_or_default().trim().to_string(),
        is_gst_registered: payload.is_gst_registered,
        gstin,
        address_line1,
        address_line2: payload.address_line2.unwrap_or_default().trim().to_string(),
        city,
        state,
        pincode,
        phone: payload.phone.unwrap_or_default().trim().to_string(),
        email: payload.email.unwrap_or_default().trim().to_string(),
        upi_id,
        upi_payee_name: payload
            .upi_payee_name
            .unwrap_or_default()
            .trim()
            .to_string(),
    })
}

fn invoice_profile_upi_uri(profile: &InvoiceBusinessProfile) -> Option<String> {
    if profile.upi_id.is_empty() {
        return None;
    }
    let payee = if profile.upi_payee_name.is_empty() {
        &profile.legal_name
    } else {
        &profile.upi_payee_name
    };
    Some(format!(
        "upi://pay?pa={}&pn={}",
        percent_encode(&profile.upi_id),
        percent_encode(payee)
    ))
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

async fn read_invoice_pdf_snapshot(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    layout: &str,
) -> Result<Option<InvoicePdfSnapshotRow>, AppError> {
    sqlx::query_as::<_, InvoicePdfSnapshotRow>(
        "SELECT pdf_bytes, sha256 FROM pos_invoice_documents WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND layout=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(layout)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice PDF snapshot"))
}

fn invoice_pdf_response(pdf: Vec<u8>, sha256: &str, file_name: &str) -> Result<Response, AppError> {
    let mut response = pdf.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/pdf"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{}\"", file_name))
            .map_err(|_| AppError::internal("failed to set PDF filename"))?,
    );
    response.headers_mut().insert(
        HeaderName::from_static("x-invoice-document-sha256"),
        HeaderValue::from_str(&sha256)
            .map_err(|_| AppError::internal("failed to set PDF checksum"))?,
    );
    Ok(response)
}

async fn list_pos_invoice_consumption(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<InvoiceInventoryConsumptionRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate invoice consumption"))?;
    if !exists {
        return Err(AppError::not_found("pos invoice was not found"));
    }
    let rows = sqlx::query_as::<_, InvoiceInventoryConsumptionRow>(
        r#"
        SELECT consumption.id,consumption.inventory_item_id,consumption.item_name,
               consumption.quantity,consumption.unit_cost_paise,consumption.created_at
        FROM (
          SELECT ledger.id,ledger.inventory_item_id,item.name AS item_name,
                 ABS(ledger.quantity_delta)::BIGINT AS quantity,ledger.unit_cost_paise,ledger.created_at
          FROM inventory_stock_ledger ledger
          JOIN inventory_items item ON item.tenant_id=ledger.tenant_id
            AND item.branch_id=ledger.branch_id AND item.id=ledger.inventory_item_id
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2 AND ledger.sale_id=$3
            AND ledger.movement_type='sale'
          UNION ALL
          SELECT usage.id,usage.inventory_item_id,item.name,usage.actual_quantity::BIGINT,
                 usage.unit_cost_paise,usage.created_at
          FROM inventory_backbar_usage usage
          JOIN inventory_items item ON item.tenant_id=usage.tenant_id
            AND item.branch_id=usage.branch_id AND item.id=usage.inventory_item_id
          WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.sale_id=$3
            AND usage.status='recorded'
          UNION ALL
          SELECT event.id,container.inventory_item_id,item.name,ABS(event.quantity_delta)::BIGINT,
                 COALESCE((event.metadata->>'unitCostPaise')::BIGINT,item.unit_cost_paise),event.created_at
          FROM inventory_backbar_container_events event
          JOIN inventory_backbar_containers container ON container.id=event.container_id
            AND container.tenant_id=event.tenant_id AND container.branch_id=event.branch_id
          JOIN inventory_items item ON item.id=container.inventory_item_id
            AND item.tenant_id=container.tenant_id AND item.branch_id=container.branch_id
          WHERE event.tenant_id=$1 AND event.branch_id=$2 AND event.event_type='consumed'
            AND event.metadata->>'saleId'=$3
        ) consumption
        ORDER BY consumption.created_at,consumption.id
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice inventory consumption"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_pos_invoice_action_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<InvoiceActionResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, InvoiceActionResponse>(
        "SELECT history.id, history.action, history.channel, history.recipient, history.status, history.idempotency_key, history.metadata_json, history.created_at FROM pos_invoice_action_history history INNER JOIN pos_sales sale ON sale.id=history.sale_id AND sale.tenant_id=history.tenant_id AND sale.branch_id=history.branch_id WHERE history.tenant_id=$1 AND history.branch_id=$2 AND history.sale_id=$3 ORDER BY history.created_at DESC",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice action history"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

pub(crate) async fn record_pos_invoice_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceActionRequest>,
) -> ApiResult<InvoiceActionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let action = payload
        .action
        .unwrap_or_else(|| "send".to_string())
        .trim()
        .to_lowercase();
    if !matches!(
        action.as_str(),
        "print" | "download" | "pdf" | "basic" | "send" | "resend" | "whatsapp" | "sms" | "email"
    ) {
        return Err(AppError::validation("invalid invoice action"));
    }
    let channel = normalize_invoice_action_channel(&action, payload.channel.as_deref());
    let recipient = payload.recipient.unwrap_or_default().trim().to_string();
    if matches!(
        action.as_str(),
        "send" | "resend" | "whatsapp" | "sms" | "email"
    ) && recipient.is_empty()
    {
        return Err(AppError::validation(
            "recipient is required for invoice send",
        ));
    }
    if matches!(
        action.as_str(),
        "send" | "resend" | "whatsapp" | "sms" | "email"
    ) && !matches!(channel.as_str(), "whatsapp" | "sms" | "email")
    {
        return Err(AppError::validation(
            "invoice delivery channel must be WhatsApp, SMS, or email",
        ));
    }
    if matches!(
        action.as_str(),
        "send" | "resend" | "whatsapp" | "sms" | "email"
    ) {
        let client_id = sqlx::query_scalar::<_, String>(
            "SELECT client_id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to verify invoice client consent"))?
        .ok_or_else(|| AppError::not_found("invoice was not found"))?;
        if !client_service::communication_allowed(
            &state.db, &tenant_id, &branch_id, &client_id, &channel,
        )
        .await
        .map_err(|_| AppError::internal("failed to verify client consent"))?
        {
            return Err(AppError::conflict(
                "client consent is required before outbound communication",
            ));
        }
    }
    let status = if matches!(
        action.as_str(),
        "send" | "resend" | "whatsapp" | "sms" | "email"
    ) {
        "queued"
    } else {
        "recorded"
    };
    let idempotency_key = payload
        .idempotency_key
        .unwrap_or_default()
        .trim()
        .to_string();
    if !idempotency_key.is_empty() {
        if let Some(row) = sqlx::query_as::<_, InvoiceActionResponse>(
            "SELECT id, action, channel, recipient, status, idempotency_key, metadata_json, created_at FROM pos_invoice_action_history WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .bind(&idempotency_key)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load invoice action"))? {
            return Ok(Json(ApiResponse::ok(row)));
        }
    }
    let metadata = payload.metadata.unwrap_or_else(|| serde_json::json!({}));
    let scheduled_for = payload.scheduled_for.unwrap_or_else(Utc::now);
    let template_version = payload
        .template_version
        .unwrap_or_else(|| "invoice-v1".to_string());
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start invoice action transaction"))?;
    let row = sqlx::query_as::<_, InvoiceActionResponse>(
        "INSERT INTO pos_invoice_action_history (tenant_id, branch_id, sale_id, action, channel, recipient, status, idempotency_key, metadata_json, updated_at) SELECT $1, $2, id, $4, $5, $6, $7, $8, $9::jsonb, NOW() FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id, action, channel, recipient, status, idempotency_key, metadata_json, created_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(&action)
    .bind(&channel)
    .bind(&recipient)
    .bind(status)
    .bind(&idempotency_key)
    .bind(metadata.to_string())
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to record invoice action"))?
    .ok_or_else(|| AppError::not_found("invoice was not found"))?;
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        "invoice.action_recorded",
        serde_json::json!({
            "action": action,
            "channel": channel,
            "recipient": recipient,
            "status": row.status,
            "actionId": row.id
        }),
    )
    .await?;
    if matches!(
        row.action.as_str(),
        "send" | "resend" | "whatsapp" | "sms" | "email"
    ) {
        sqlx::query(
            "INSERT INTO pos_invoice_outbox (tenant_id, branch_id, sale_id, action_history_id, channel, recipient, template_version, payload_json, idempotency_key, scheduled_for, next_attempt_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$10)",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .bind(&row.id)
        .bind(&row.channel)
        .bind(&row.recipient)
        .bind(&template_version)
        .bind(serde_json::json!({
            "invoiceId": id,
            "actionId": row.id,
            "channel": row.channel,
            "recipient": row.recipient,
            "templateVersion": template_version,
            "metadata": metadata
        }).to_string())
        .bind(&idempotency_key)
        .bind(scheduled_for)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::conflict("invoice delivery was already queued"))?;
        sqlx::query(
            "INSERT INTO notifications (id, tenant_id, branch_id, notification_type, title, body, resource_type, resource_id, metadata_json, is_read, created_at, updated_at) VALUES ($1,$2,$3,'invoice_send','Invoice send queued',$4,'pos_invoice',$5,$6::jsonb,false,NOW(),NOW())",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(format!("{} invoice send queued to {}", row.channel, row.recipient))
        .bind(&id)
        .bind(serde_json::json!({
            "invoiceId": id,
            "actionId": row.id,
            "action": row.action,
            "channel": row.channel,
            "recipient": row.recipient,
            "status": row.status
        }).to_string())
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to record invoice notification"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice action"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn queue_automatic_invoice_delivery(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    client_id: &str,
) -> Result<i64, AppError> {
    if client_id.trim().is_empty() {
        return Ok(0);
    }

    let destinations = sqlx::query_as::<_, (String, String)>(
        r#"
        SELECT destination.channel, destination.recipient
          FROM invoice_notification_profiles profile
          JOIN clients client
            ON client.tenant_id=profile.tenant_id
           AND client.branch_id=profile.branch_id
           AND client.id=$3
          CROSS JOIN LATERAL (
            VALUES
              ('email'::TEXT, LOWER(TRIM(COALESCE(client.email,''))),
               profile.client_email_enabled AND profile.email_verified AND client.email_opt_in IS TRUE),
              ('whatsapp'::TEXT, TRIM(COALESCE(client.phone,'')),
               profile.client_whatsapp_enabled AND profile.phone_verified AND client.whatsapp_opt_in IS TRUE)
          ) AS destination(channel, recipient, enabled)
         WHERE profile.tenant_id=$1
           AND profile.branch_id=$2
           AND client.active=TRUE
           AND client.merged_into_client_id IS NULL
           AND destination.enabled
           AND CASE
                 WHEN destination.channel='email' THEN POSITION('@' IN destination.recipient)>1
                 ELSE LENGTH(REGEXP_REPLACE(destination.recipient,'[^0-9]','','g')) BETWEEN 8 AND 15
               END
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to resolve automatic invoice delivery"))?;

    let mut queued = 0i64;
    for (channel, recipient) in destinations {
        let idempotency_key = format!("auto:{sale_id}:{channel}");
        let action_id = sqlx::query_scalar::<_, String>(
            r#"
            INSERT INTO pos_invoice_action_history (
                tenant_id, branch_id, sale_id, action, channel, recipient,
                status, idempotency_key, metadata_json, updated_at
            ) VALUES ($1,$2,$3,$4,$4,$5,'queued',$6,'{"automatic":true}'::jsonb,NOW())
            ON CONFLICT DO NOTHING
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .bind(&channel)
        .bind(&recipient)
        .bind(&idempotency_key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to record automatic invoice delivery"))?;

        let Some(action_id) = action_id else {
            continue;
        };
        sqlx::query(
            r#"
            INSERT INTO pos_invoice_outbox (
                tenant_id, branch_id, sale_id, action_history_id, channel, recipient,
                template_version, payload_json, idempotency_key, scheduled_for, next_attempt_at
            ) VALUES ($1,$2,$3,$4,$5,$6,'invoice-v1',$7::jsonb,$8,NOW(),NOW())
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .bind(&action_id)
        .bind(&channel)
        .bind(&recipient)
        .bind(
            serde_json::json!({
                "invoiceId": sale_id,
                "actionId": action_id,
                "channel": channel,
                "recipient": recipient,
                "templateVersion": "invoice-v1",
                "automatic": true
            })
            .to_string(),
        )
        .bind(&idempotency_key)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to queue automatic invoice delivery"))?;
        queued += 1;
    }
    Ok(queued)
}
async fn list_pos_invoice_deliveries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<InvoiceDeliveryRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, InvoiceDeliveryRow>(
        "SELECT id, channel, recipient, template_version, status, attempts, scheduled_for, next_attempt_at, external_message_id, last_error, delivered_at, created_at FROM pos_invoice_outbox WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at DESC",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice deliveries"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn process_due_invoice_outbox(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    if !state.settings.invoice_delivery_configured() {
        return Err(AppError::service_unavailable(
            "DELIVERY_NOT_CONFIGURED",
            "INVOICE_DELIVERY_WEBHOOK_URL must be configured before dispatch",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (sent, failed) = dispatch_invoice_outbox(&state, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "sent": sent, "failed": failed }),
    )))
}

pub async fn run_invoice_outbox_worker(state: &AppState) -> Result<(), AppError> {
    if !state.settings.invoice_delivery_configured() {
        return Ok(());
    }
    dispatch_invoice_outbox(state, "", "").await?;
    Ok(())
}

pub async fn schedule_due_invoice_reminders_worker(state: &AppState) -> Result<u64, AppError> {
    schedule_due_invoice_reminders_for_scope(state, "", "").await
}

async fn dispatch_invoice_outbox(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(u64, u64), AppError> {
    let rows = sqlx::query_as::<_, OutboxDispatchRow>(
        "WITH due AS (SELECT id FROM pos_invoice_outbox WHERE ($1='' OR tenant_id=$1) AND ($2='' OR branch_id=$2) AND status='queued' AND attempts<5 AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) UPDATE pos_invoice_outbox outbox SET status='processing', attempts=outbox.attempts+1, updated_at=NOW() FROM due WHERE outbox.id=due.id RETURNING outbox.id,outbox.tenant_id,outbox.branch_id,(SELECT sale.client_id FROM pos_sales sale WHERE sale.id=outbox.sale_id AND sale.tenant_id=outbox.tenant_id AND sale.branch_id=outbox.branch_id) AS client_id,outbox.channel,outbox.payload_json::text AS payload_json",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to claim invoice deliveries"))?;

    let mut sent = 0;
    let mut failed = 0;
    for row in rows {
        if !client_service::communication_allowed(
            &state.db,
            &row.tenant_id,
            &row.branch_id,
            &row.client_id,
            &row.channel,
        )
        .await
        .map_err(|_| AppError::internal("failed to recheck client consent"))?
        {
            sqlx::query("UPDATE pos_invoice_outbox SET status='blocked',last_error='client consent missing or withdrawn',updated_at=NOW() WHERE id=$1")
                .bind(&row.id).execute(&state.db).await
                .map_err(|_| AppError::internal("failed to block invoice delivery"))?;
            failed += 1;
            continue;
        }
        let payload = serde_json::from_str::<Value>(&row.payload_json)
            .map_err(|_| AppError::internal("invalid invoice delivery payload"))?;
        match invoice_delivery::deliver(&state.settings, &payload).await {
            Ok(message_id) => {
                sqlx::query("UPDATE pos_invoice_outbox SET status='sent', external_message_id=$2, delivered_at=NOW(), last_error='', updated_at=NOW() WHERE id=$1")
                    .bind(&row.id).bind(message_id).execute(&state.db).await
                    .map_err(|_| AppError::internal("failed to complete invoice delivery"))?;
                sent += 1;
            }
            Err(_) => {
                sqlx::query("UPDATE pos_invoice_outbox SET status=CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END, last_error='delivery provider failed', next_attempt_at=NOW() + (attempts * INTERVAL '5 minutes'), updated_at=NOW() WHERE id=$1")
                    .bind(&row.id).execute(&state.db).await
                    .map_err(|_| AppError::internal("failed to reschedule invoice delivery"))?;
                failed += 1;
            }
        }
    }
    Ok((sent, failed))
}

async fn record_invoice_delivery_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<DeliveryStatusRequest>,
) -> ApiResult<InvoiceDeliveryRow> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !matches!(payload.status.as_str(), "queued" | "sent" | "failed") {
        return Err(AppError::validation(
            "delivery status must be queued, sent, or failed",
        ));
    }
    let row = sqlx::query_as::<_, InvoiceDeliveryRow>(
        "UPDATE pos_invoice_outbox SET status=$4, external_message_id=COALESCE(NULLIF($5,''), external_message_id), last_error=$6, delivered_at=CASE WHEN $4='sent' THEN NOW() ELSE delivered_at END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id, channel, recipient, template_version, status, attempts, scheduled_for, next_attempt_at, external_message_id, last_error, delivered_at, created_at",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).bind(payload.status)
    .bind(payload.provider_message_id.unwrap_or_default())
    .bind(payload.error.unwrap_or_default())
    .fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to update delivery status"))?
    .ok_or_else(|| AppError::not_found("invoice delivery was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn schedule_due_invoice_reminders(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let queued = schedule_due_invoice_reminders_for_scope(&state, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "queued": queued }),
    )))
}

async fn schedule_due_invoice_reminders_for_scope(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<u64, AppError> {
    let inserted = sqlx::query(
        "INSERT INTO pos_invoice_outbox (tenant_id, branch_id, sale_id, channel, recipient, template_version, payload_json, idempotency_key, scheduled_for, next_attempt_at) SELECT ps.tenant_id, ps.branch_id, ps.id, destination.channel, destination.recipient, 'due-reminder-v1', jsonb_build_object('invoiceId', ps.id, 'invoiceNumber', ps.invoice_number, 'duePaise', ps.total_paise-ps.paid_paise, 'channel', destination.channel, 'recipient', destination.recipient, 'templateVersion', 'due-reminder-v1'), 'due:' || ps.id || ':' || destination.channel || ':' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD'), NOW(), NOW() FROM pos_sales ps JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id CROSS JOIN LATERAL (VALUES ('whatsapp'::TEXT, c.phone, c.whatsapp_opt_in IS TRUE), ('sms'::TEXT, REGEXP_REPLACE(COALESCE(c.phone,''),'[^0-9]','','g'), c.sms_opt_in IS TRUE), ('email'::TEXT, LOWER(TRIM(COALESCE(c.email,''))), c.email_opt_in IS TRUE)) AS destination(channel,recipient,allowed) WHERE ($1='' OR ps.tenant_id=$1) AND ($2='' OR ps.branch_id=$2) AND ps.paid_paise < ps.total_paise AND ps.status NOT IN ('draft','voided','cancelled','refunded') AND COALESCE(ps.finalized_at, ps.created_at)::DATE <= CURRENT_DATE - 7 AND c.merged_into_client_id IS NULL AND destination.allowed AND CASE WHEN destination.channel IN ('whatsapp','sms') THEN LENGTH(REGEXP_REPLACE(destination.recipient,'[^0-9]','','g')) BETWEEN 8 AND 15 ELSE POSITION('@' IN destination.recipient)>1 END ON CONFLICT DO NOTHING",
    )
    .bind(tenant_id).bind(branch_id).execute(&state.db).await
    .map_err(|_| AppError::internal("failed to schedule due reminders"))?;
    Ok(inserted.rows_affected())
}

async fn verify_pos_invoice_ledger(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, LedgerChainRow>(
        "SELECT event_type, actor_user_id, payload_text, previous_hash, event_hash, created_at FROM pos_invoice_event_chain WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY sequence",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_all(&state.db).await
    .map_err(|_| AppError::internal("failed to load invoice ledger"))?;
    let mut previous = String::new();
    for (index, row) in rows.iter().enumerate() {
        let hash = invoice_event_hash(
            &tenant_id,
            &branch_id,
            &id,
            &row.event_type,
            &row.actor_user_id,
            &row.created_at.to_rfc3339(),
            &row.payload_text,
            &previous,
        );
        if row.previous_hash != previous || row.event_hash != hash {
            return Ok(Json(ApiResponse::ok(
                serde_json::json!({ "valid": false, "failedAt": index }),
            )));
        }
        previous = row.event_hash.clone();
    }
    Ok(Json(ApiResponse::ok(
        serde_json::json!({ "valid": true, "events": rows.len(), "headHash": previous }),
    )))
}

async fn list_happy_hour_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<HappyHourRuleRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, HappyHourRuleRow>("SELECT id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active FROM pos_happy_hour_rules WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC, start_time")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| AppError::internal("failed to load happy hour rules"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_happy_hours_control_tower(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<happy_hours_service::HappyHourControlTowerResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = happy_hours_service::control_tower(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn get_happy_hour_branch_leaderboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<BranchLeaderboardQuery>,
) -> ApiResult<Vec<happy_hours_service::BranchLeaderboardRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = happy_hours_service::branch_leaderboard(
        &state.db,
        &tenant_id,
        &branch_id,
        query.from,
        query.to,
        query.sort.as_deref().unwrap_or("score"),
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_happy_hour_client_returns(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ClientReturnQuery>,
) -> ApiResult<happy_hours_service::ClientReturnTrackerResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default().trim().to_lowercase();
    let offer_type = query.offer_type.unwrap_or_default().trim().to_lowercase();
    let result = happy_hours_service::client_return_tracker(
        &state.db,
        &tenant_id,
        &branch_id,
        query.from,
        query.to,
        query.return_window_days.unwrap_or(30),
        &status,
        &offer_type,
        query.limit.unwrap_or(200),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn get_happy_hour_elasticity_pricing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ElasticityPricingQuery>,
) -> ApiResult<happy_hours_service::ElasticityPricingResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let service_id = query.service_id.unwrap_or_default().trim().to_string();
    let result = happy_hours_service::elasticity_pricing(
        &state.db,
        &tenant_id,
        &branch_id,
        query.from,
        query.to,
        query.day_of_week,
        query.hour_slot,
        Some(&service_id),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn get_happy_hour_rule_conflicts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RuleConflictQuery>,
) -> ApiResult<happy_hours_service::RuleConflictResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = happy_hours_service::rule_conflicts(
        &state.db,
        &tenant_id,
        &branch_id,
        query.active_only.unwrap_or(true),
    )
    .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn simulate_happy_hour_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::HappyHourSimulationRequest>,
) -> ApiResult<happy_hours_service::HappyHourSimulationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result =
        happy_hours_service::simulate_rule(&state.db, &tenant_id, &branch_id, payload).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_happy_hour_approvals(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<happy_hours_repository::HappyHourApprovalRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    Ok(Json(ApiResponse::ok(
        happy_hours_service::list_approvals(&state.db, &tenant_id, &branch_id, &status).await?,
    )))
}

async fn request_happy_hour_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::ApprovalRequest>,
) -> ApiResult<happy_hours_repository::HappyHourApprovalRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::request_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            payload,
        )
        .await?,
    )))
}

async fn decide_happy_hour_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::ApprovalDecisionRequest>,
) -> ApiResult<happy_hours_repository::HappyHourApprovalRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::decide_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn list_discount_approvals(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<happy_hours_repository::DiscountApprovalRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    Ok(Json(ApiResponse::ok(
        happy_hours_service::list_discount_approvals(&state.db, &tenant_id, &branch_id, &status)
            .await?,
    )))
}

async fn request_discount_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::DiscountApprovalRequest>,
) -> ApiResult<happy_hours_repository::DiscountApprovalRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::request_discount_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            payload,
        )
        .await?,
    )))
}

async fn decide_discount_approval(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::ApprovalDecisionRequest>,
) -> ApiResult<happy_hours_repository::DiscountApprovalRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::decide_discount_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn list_coupon_abuse_alerts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<happy_hours_repository::CouponAbuseAlertRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    Ok(Json(ApiResponse::ok(
        happy_hours_service::list_coupon_abuse_alerts(&state.db, &tenant_id, &branch_id, &status)
            .await?,
    )))
}

async fn scan_coupon_abuse(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<happy_hours_service::CouponAbuseScanResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::scan_coupon_abuse(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?,
    )))
}

async fn resolve_coupon_abuse_alert(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::CouponAbuseResolutionRequest>,
) -> ApiResult<happy_hours_repository::CouponAbuseAlertRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::resolve_coupon_abuse_alert(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn list_happy_hour_anomalies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<happy_hours_repository::HappyHourAnomalyRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    Ok(Json(ApiResponse::ok(
        happy_hours_service::list_anomalies(&state.db, &tenant_id, &branch_id, &status).await?,
    )))
}

async fn scan_happy_hour_anomalies(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<happy_hours_service::AnomalyScanResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::scan_anomalies(&state.db, &tenant_id, &branch_id, &claims.sub).await?,
    )))
}

async fn review_happy_hour_anomaly(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::AnomalyReviewRequest>,
) -> ApiResult<happy_hours_repository::HappyHourAnomalyRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::review_anomaly(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn list_happy_hour_fraud_cases(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GovernanceListQuery>,
) -> ApiResult<Vec<happy_hours_repository::FraudCaseRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query.status.unwrap_or_default().trim().to_ascii_lowercase();
    Ok(Json(ApiResponse::ok(
        happy_hours_service::list_fraud_cases(&state.db, &tenant_id, &branch_id, &status).await?,
    )))
}

async fn scan_happy_hour_fraud_cases(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<happy_hours_service::FraudScanResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::scan_fraud_cases(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?,
    )))
}

async fn review_happy_hour_fraud_case(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::FraudCaseReviewRequest>,
) -> ApiResult<happy_hours_repository::FraudCaseRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::review_fraud_case(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &id,
            payload,
        )
        .await?,
    )))
}

async fn get_happy_hour_budget(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Option<happy_hours_service::BudgetResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::current_budget(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn save_happy_hour_budget(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::BudgetWriteRequest>,
) -> ApiResult<happy_hours_service::BudgetResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::save_budget(&state.db, &tenant_id, &branch_id, &claims.sub, payload)
            .await?,
    )))
}

async fn get_happy_hour_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::security_repository::SecurityAuditRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        happy_hours_service::audit_log(&state.db, &tenant_id, &branch_id).await?,
    )))
}

async fn get_happy_hours_intelligence(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<happy_hours_service::HappyHourIntelligenceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = happy_hours_service::intelligence(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_happy_hour_audiences(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<happy_hours_service::AudienceResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = happy_hours_service::list_audiences(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn preview_happy_hour_audience(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::AudienceWriteRequest>,
) -> ApiResult<happy_hours_service::AudiencePreviewResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result =
        happy_hours_service::preview_audience(&state.db, &tenant_id, &branch_id, &payload).await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn save_happy_hour_audience(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::AudienceWriteRequest>,
) -> ApiResult<happy_hours_service::AudienceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::save_audience(&state.db, &tenant_id, &branch_id, payload).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_happy_hour_audience_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::StatusRequest>,
) -> ApiResult<happy_hours_service::AudienceResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = happy_hours_service::set_audience_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.status,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_happy_hour_campaign_links(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<happy_hours_service::CampaignLinkResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = happy_hours_service::list_campaign_links(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_happy_hour_campaign_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::CampaignLinkWriteRequest>,
) -> ApiResult<happy_hours_service::CampaignLinkResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::save_campaign_link(&state.db, &tenant_id, &branch_id, payload).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_happy_hour_campaign_link_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::StatusRequest>,
) -> ApiResult<happy_hours_service::CampaignLinkResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = happy_hours_service::set_campaign_link_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.status,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_happy_hour_market_observations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<happy_hours_service::MarketObservationResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        happy_hours_service::list_market_observations(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_happy_hour_market_observation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::MarketObservationWriteRequest>,
) -> ApiResult<happy_hours_service::MarketObservationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::save_market_observation(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn evaluate_happy_hour_market_offer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::MarketEvaluationRequest>,
) -> ApiResult<happy_hours_service::MarketEvaluationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result =
        happy_hours_service::evaluate_market_offer(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_happy_hour_market_suggestions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<happy_hours_service::MarketSuggestionResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        happy_hours_service::list_market_suggestions(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_happy_hour_market_suggestion(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::MarketEvaluationRequest>,
) -> ApiResult<happy_hours_service::MarketSuggestionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::save_market_suggestion(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_happy_hour_market_suggestion_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::StatusRequest>,
) -> ApiResult<happy_hours_service::MarketSuggestionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = happy_hours_service::set_market_suggestion_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.status,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn evaluate_happy_hour_context_offer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::ContextOfferEvaluationRequest>,
) -> ApiResult<happy_hours_service::ContextOfferEvaluationResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result =
        happy_hours_service::evaluate_context_offer(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_happy_hour_context_suggestions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<happy_hours_service::ContextOfferSuggestionResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        happy_hours_service::list_context_offer_suggestions(&state.db, &tenant_id, &branch_id)
            .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn save_happy_hour_context_suggestion(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::ContextOfferEvaluationRequest>,
) -> ApiResult<happy_hours_service::ContextOfferSuggestionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = happy_hours_service::save_context_offer_suggestion(
        &state.db, &tenant_id, &branch_id, payload,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_happy_hour_context_suggestion_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<happy_hours_service::StatusRequest>,
) -> ApiResult<happy_hours_service::ContextOfferSuggestionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = happy_hours_service::set_context_offer_suggestion_status(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &payload.status,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_happy_hour_auto_sunset_policy(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<happy_hours_service::AutoSunsetPolicyResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::get_auto_sunset_policy(&state.db, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn save_happy_hour_auto_sunset_policy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<happy_hours_service::AutoSunsetPolicyRequest>,
) -> ApiResult<happy_hours_service::AutoSunsetPolicyResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::save_auto_sunset_policy(&state.db, &tenant_id, &branch_id, payload)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_happy_hour_auto_sunset_decisions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AutoSunsetListQuery>,
) -> ApiResult<Vec<happy_hours_service::AutoSunsetDecisionResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = happy_hours_service::list_auto_sunset_decisions(
        &state.db,
        &tenant_id,
        &branch_id,
        query.status.as_deref().unwrap_or(""),
        query.severity.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn scan_happy_hour_auto_sunset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AutoSunsetScanRequest>,
) -> ApiResult<happy_hours_service::AutoSunsetScanResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = happy_hours_service::scan_auto_sunset(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.apply.unwrap_or(false),
        "manual",
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn apply_happy_hour_auto_sunset_decision(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<happy_hours_service::AutoSunsetDecisionResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        happy_hours_service::apply_auto_sunset_decision(&state.db, &tenant_id, &branch_id, &id)
            .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_happy_hour_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<HappyHourRuleRequest>,
) -> ApiResult<HappyHourRuleRow> {
    let min_margin_bps = validate_happy_hour_rule(&payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let assessment = happy_hours_service::rule_approval_assessment(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.role,
        payload.discount_bps,
    )
    .await?;
    let approval_required = payload.active.unwrap_or(true) && assessment.required;
    let row = sqlx::query_as::<_, HappyHourRuleRow>("INSERT INTO pos_happy_hour_rules (tenant_id, branch_id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active, last_changed_by, last_changed_by_role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active")
        .bind(&tenant_id).bind(&branch_id).bind(payload.name.trim()).bind(payload.start_time).bind(payload.end_time).bind(payload.weekdays).bind(payload.discount_bps)
        .bind(normalize_happy_hour_filter(payload.eligible_line_types)).bind(normalize_happy_hour_filter(payload.eligible_item_ids)).bind(normalize_happy_hour_filter(payload.eligible_client_categories))
        .bind(min_margin_bps).bind(payload.block_on_unknown_cost.unwrap_or(true)).bind(payload.active.unwrap_or(true) && !approval_required).bind(&claims.sub).bind(&claims.role)
        .fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to save happy hour rule"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "happy_hours.rule.created",
        serde_json::json!({"ruleId":row.id,"discountBps":row.discount_bps,"active":row.active,"roleLimitBps":assessment.role_limit_bps,"policyLimitBps":assessment.policy_limit_bps,"approvalRequired":approval_required}),
    )
    .await?;
    if approval_required {
        happy_hours_service::request_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            happy_hours_service::ApprovalRequest {
                rule_id: row.id.clone(),
                note: Some(format!(
                    "Discount exceeds role/policy approval limit (role {}%, policy {}%)",
                    assessment.role_limit_bps / 100,
                    assessment.policy_limit_bps.unwrap_or(10_000) / 100
                )),
            },
        )
        .await?;
    }
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_happy_hour_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<HappyHourRuleRequest>,
) -> ApiResult<HappyHourRuleRow> {
    let min_margin_bps = validate_happy_hour_rule(&payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let assessment = happy_hours_service::rule_approval_assessment(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.role,
        payload.discount_bps,
    )
    .await?;
    let approval_required = payload.active.unwrap_or(true) && assessment.required;
    let row = sqlx::query_as::<_, HappyHourRuleRow>("UPDATE pos_happy_hour_rules SET name=$4, start_time=$5, end_time=$6, weekdays=$7, discount_bps=$8, eligible_line_types=$9, eligible_item_ids=$10, eligible_client_categories=$11, min_margin_bps=$12, block_on_unknown_cost=$13, active=$14, last_changed_by=$15, last_changed_by_role=$16, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(payload.name.trim()).bind(payload.start_time).bind(payload.end_time).bind(payload.weekdays).bind(payload.discount_bps)
        .bind(normalize_happy_hour_filter(payload.eligible_line_types)).bind(normalize_happy_hour_filter(payload.eligible_item_ids)).bind(normalize_happy_hour_filter(payload.eligible_client_categories))
        .bind(min_margin_bps).bind(payload.block_on_unknown_cost.unwrap_or(true)).bind(payload.active.unwrap_or(true) && !approval_required).bind(&claims.sub).bind(&claims.role)
        .fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to update happy hour rule"))?
        .ok_or_else(|| AppError::not_found("happy hour rule was not found"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "happy_hours.rule.updated",
        serde_json::json!({"ruleId":row.id,"discountBps":row.discount_bps,"active":row.active,"roleLimitBps":assessment.role_limit_bps,"policyLimitBps":assessment.policy_limit_bps,"approvalRequired":approval_required}),
    )
    .await?;
    if approval_required {
        happy_hours_service::request_approval(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            &claims.role,
            happy_hours_service::ApprovalRequest {
                rule_id: row.id.clone(),
                note: Some(format!(
                    "Discount exceeds role/policy approval limit (role {}%, policy {}%)",
                    assessment.role_limit_bps / 100,
                    assessment.policy_limit_bps.unwrap_or(10_000) / 100
                )),
            },
        )
        .await?;
    }
    Ok(Json(ApiResponse::ok(row)))
}

fn validate_happy_hour_rule(payload: &HappyHourRuleRequest) -> Result<i32, AppError> {
    let min_margin_bps = payload.min_margin_bps.unwrap_or(0);
    if payload.name.trim().is_empty()
        || payload.weekdays.is_empty()
        || payload.weekdays.iter().any(|day| !(0..=6).contains(day))
        || !(1..=10000).contains(&payload.discount_bps)
        || !(0..=10000).contains(&min_margin_bps)
    {
        return Err(AppError::validation("happy hour rule values are invalid"));
    }
    Ok(min_margin_bps)
}

#[cfg(test)]
mod happy_hour_rule_tests {
    use super::{validate_happy_hour_rule, HappyHourRuleRequest};
    use chrono::NaiveTime;

    fn request() -> HappyHourRuleRequest {
        HappyHourRuleRequest {
            name: "Afternoon Offer".to_string(),
            start_time: NaiveTime::from_hms_opt(14, 0, 0).unwrap(),
            end_time: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            weekdays: vec![1, 2, 3, 4, 5],
            discount_bps: 1_000,
            eligible_line_types: Some(vec!["service".to_string()]),
            eligible_item_ids: None,
            eligible_client_categories: None,
            min_margin_bps: Some(2_500),
            block_on_unknown_cost: Some(true),
            active: Some(true),
        }
    }

    #[test]
    fn happy_hour_rule_validation_guards_api_bounds() {
        assert_eq!(validate_happy_hour_rule(&request()).unwrap(), 2_500);
        let mut invalid = request();
        invalid.weekdays = vec![7];
        assert!(validate_happy_hour_rule(&invalid).is_err());
        invalid = request();
        invalid.discount_bps = 0;
        assert!(validate_happy_hour_rule(&invalid).is_err());
    }
}

fn normalize_invoice_action_channel(action: &str, raw_channel: Option<&str>) -> String {
    let channel = raw_channel.unwrap_or("").trim().to_lowercase();
    if !channel.is_empty() {
        return match channel.as_str() {
            "wa" | "whats_app" | "whatsapp" => "whatsapp".to_string(),
            "mail" | "email" => "email".to_string(),
            "sms" => "sms".to_string(),
            "pdf" | "print" | "download" | "basic" => channel,
            _ => "other".to_string(),
        };
    }
    match action {
        "whatsapp" => "whatsapp",
        "sms" => "sms",
        "email" => "email",
        "pdf" => "pdf",
        "basic" => "basic",
        "download" => "download",
        "print" => "print",
        _ => "manual",
    }
    .to_string()
}

async fn resume_pos_invoice(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if sale.status != "draft" {
        return Err(AppError::validation("only held invoices can be resumed"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start resume transaction"))?;
    insert_pos_event(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        "invoice.resumed",
        serde_json::json!({ "invoiceNumber": sale.invoice_number }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice resume"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &id, "invoice.resumed");
    Ok(Json(ApiResponse::ok(
        load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn preview_pos_coupon(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(mut payload): Json<PosSalePayload>,
) -> ApiResult<PosCouponPreview> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    hydrate_appointment_booked_prices(&state, &tenant_id, &branch_id, &mut payload).await?;
    hydrate_pos_tax_metadata(&state, &tenant_id, &branch_id, &mut payload).await?;
    resolve_coupon_discount(&state, &tenant_id, &branch_id, &mut payload).await?;
    let gst_context = gst_context_from_payload(&state, &tenant_id, &branch_id, &payload).await?;
    let mut calculation = calculate_pos(&payload)?;
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(
        &state,
        &tenant_id,
        &branch_id,
        &calculation,
        claims.max_discount_paise,
    )
    .await?;
    Ok(Json(ApiResponse::ok(PosCouponPreview {
        code: calculation.coupon_code,
        discount_paise: calculation.coupon_discount_paise,
        tax_paise: calculation.tax_paise,
        total_paise: calculation.total_paise,
    })))
}

async fn create_pos_sale(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    let details = persist_pos_sale(&state, headers, payload, claims.max_discount_paise).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn sync_offline_checkout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(mut request): Json<OfflineCheckoutRequest>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let operation_id = request.operation_id.trim().to_string();
    if !valid_offline_operation_id(&operation_id) {
        return Err(AppError::validation(
            "operationId must be at least 10 characters",
        ));
    }
    validate_offline_checkout_payload(&request.checkout)?;
    let (sale_source, sale_reference) =
        offline_checkout_sale_reference(&request.checkout, &operation_id)?;
    let sale_reference = if sale_source == "appointment" {
        appointment_invoice_reference(
            &state,
            &tenant_id,
            &branch_id,
            &sale_reference,
            request.checkout.separate_group_invoice.unwrap_or(false),
        )
        .await?
    } else {
        sale_reference
    };
    let existing = sqlx::query_as::<_, OfflineCheckoutOperation>("SELECT operation_id, sale_id, status, last_error, created_at, updated_at FROM offline_checkout_operations WHERE tenant_id=$1 AND branch_id=$2 AND operation_id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&operation_id).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to read offline checkout operation"))?;
    if let Some(operation) = existing {
        if !operation.sale_id.is_empty() {
            return Ok(Json(ApiResponse::ok(
                load_pos_sale_details(&state, &tenant_id, &branch_id, &operation.sale_id).await?,
            )));
        }
        if operation.status == "conflict" {
            return Err(AppError::conflict(operation.last_error));
        }
    } else {
        sqlx::query("INSERT INTO offline_checkout_operations (tenant_id, branch_id, operation_id) VALUES ($1,$2,$3)")
            .bind(&tenant_id).bind(&branch_id).bind(&operation_id).execute(&state.db).await
            .map_err(|_| AppError::internal("failed to reserve offline checkout operation"))?;
    }
    request.checkout.source = Some(sale_source.clone());
    request.checkout.reference_id = Some(sale_reference.clone());
    match persist_pos_sale(&state, headers, request.checkout, claims.max_discount_paise).await {
        Ok(details) => {
            sqlx::query("UPDATE offline_checkout_operations SET sale_id=$4, status='completed', last_error='', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND operation_id=$3")
                .bind(&tenant_id).bind(&branch_id).bind(&operation_id).bind(&details.sale.id).execute(&state.db).await
                .map_err(|_| AppError::internal("failed to complete offline checkout operation"))?;
            Ok(Json(ApiResponse::ok(details)))
        }
        Err(error) => {
            if let Some(sale_id) = sqlx::query_scalar::<_, String>("SELECT id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND source=$3 AND reference_id=$4")
                .bind(&tenant_id).bind(&branch_id).bind(&sale_source).bind(&sale_reference).fetch_optional(&state.db).await
                .map_err(|_| AppError::internal("failed to recover offline checkout replay"))? {
                sqlx::query("UPDATE offline_checkout_operations SET sale_id=$4, status='completed', last_error='', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND operation_id=$3")
                    .bind(&tenant_id).bind(&branch_id).bind(&operation_id).bind(&sale_id).execute(&state.db).await
                    .map_err(|_| AppError::internal("failed to recover offline checkout operation"))?;
                return Ok(Json(ApiResponse::ok(load_pos_sale_details(&state, &tenant_id, &branch_id, &sale_id).await?)));
            }
            sqlx::query("UPDATE offline_checkout_operations SET status='conflict', last_error=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND operation_id=$3")
                .bind(&tenant_id).bind(&branch_id).bind(&operation_id).bind("server checkout validation rejected this offline operation").execute(&state.db).await
                .map_err(|_| AppError::internal("failed to record offline checkout conflict"))?;
            Err(error)
        }
    }
}

fn valid_offline_operation_id(value: &str) -> bool {
    value.len() >= 10
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn validate_offline_checkout_payload(checkout: &PosSalePayload) -> Result<(), AppError> {
    let has_payments = checkout
        .payments
        .as_ref()
        .is_some_and(|payments| !payments.is_empty());
    let has_liability_mutation = checkout
        .lines
        .as_ref()
        .into_iter()
        .flatten()
        .chain(checkout.items.as_ref().into_iter().flatten())
        .any(|line| {
            let kind = line
                .line_type
                .as_deref()
                .or(line.item_type.as_deref())
                .or(line.kind.as_deref())
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            matches!(
                kind.as_str(),
                "membership"
                    | "package"
                    | "gift_card"
                    | "redemption"
                    | "membership_redeem"
                    | "package_redeem"
            )
        });
    let has_package_redemptions = checkout.package_redemptions.as_ref().is_some_and(|value| {
        !value.is_null() && value.as_array().is_none_or(|rows| !rows.is_empty())
    });
    if checkout.force_unpaid != Some(true)
        || has_payments
        || checkout.wallet_credit_paise.unwrap_or_default() != 0
        || checkout.reward_discount_paise.unwrap_or_default() != 0
        || has_liability_mutation
        || has_package_redemptions
    {
        return Err(AppError::validation(
            "offline checkout can only queue an unpaid service or product invoice",
        ));
    }
    Ok(())
}

fn offline_checkout_sale_reference(
    checkout: &PosSalePayload,
    operation_id: &str,
) -> Result<(String, String), AppError> {
    let source = normalize_pos_source(checkout.source.clone());
    if source == "appointment" {
        let appointment_id = checkout.reference_id.as_deref().unwrap_or("").trim();
        if appointment_id.is_empty() {
            return Err(AppError::validation(
                "offline appointment checkout requires referenceId",
            ));
        }
        return Ok((source, appointment_id.to_string()));
    }
    Ok(("offline_sync".to_string(), operation_id.to_string()))
}

#[cfg(test)]
mod offline_checkout_tests {
    use super::{
        offline_checkout_sale_reference, valid_offline_operation_id,
        validate_offline_checkout_payload, PosPaymentInput, PosSalePayload,
    };

    #[test]
    fn offline_operation_id_is_replay_safe() {
        assert!(valid_offline_operation_id("device-abc-123"));
        assert!(!valid_offline_operation_id("short"));
        assert!(!valid_offline_operation_id("contains space"));
    }

    #[test]
    fn offline_appointment_reference_is_preserved() {
        let appointment = PosSalePayload {
            source: Some("Appointment".to_string()),
            reference_id: Some("appointment-123".to_string()),
            ..PosSalePayload::default()
        };
        assert_eq!(
            offline_checkout_sale_reference(&appointment, "device-operation-123").unwrap(),
            ("appointment".to_string(), "appointment-123".to_string())
        );
        assert_eq!(
            offline_checkout_sale_reference(&PosSalePayload::default(), "device-operation-123")
                .unwrap(),
            (
                "offline_sync".to_string(),
                "device-operation-123".to_string()
            )
        );
        assert!(offline_checkout_sale_reference(
            &PosSalePayload {
                source: Some("appointment".to_string()),
                ..PosSalePayload::default()
            },
            "device-operation-123"
        )
        .is_err());
    }

    #[test]
    fn offline_checkout_never_records_a_payment() {
        assert!(validate_offline_checkout_payload(&PosSalePayload {
            force_unpaid: Some(true),
            payments: Some(Vec::new()),
            wallet_credit_paise: Some(0),
            ..PosSalePayload::default()
        })
        .is_ok());
        assert!(validate_offline_checkout_payload(&PosSalePayload {
            force_unpaid: Some(false),
            payments: Some(vec![PosPaymentInput {
                method: Some("card".into()),
                amount_paise: Some(100),
                ..PosPaymentInput::default()
            }]),
            ..PosSalePayload::default()
        })
        .is_err());
    }
}

async fn get_offline_checkout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(operation_id): Path<String>,
) -> ApiResult<OfflineCheckoutOperation> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let operation = sqlx::query_as("SELECT operation_id, sale_id, status, last_error, created_at, updated_at FROM offline_checkout_operations WHERE tenant_id=$1 AND branch_id=$2 AND operation_id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&operation_id).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load offline checkout operation"))?
        .ok_or_else(|| AppError::not_found("offline checkout operation was not found"))?;
    Ok(Json(ApiResponse::ok(operation)))
}

async fn create_pos_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    let details = persist_pos_sale(&state, headers, payload, claims.max_discount_paise).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn create_pos_invoice_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(mut payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    payload.status = Some("draft".to_string());
    let details = persist_pos_sale(&state, headers, payload, claims.max_discount_paise).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn create_pos_checkout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<PosSalePayload>,
) -> ApiResult<PosCheckoutResponse> {
    let details = persist_pos_sale(&state, headers, payload, claims.max_discount_paise).await?;
    Ok(Json(ApiResponse::ok(PosCheckoutResponse {
        invoice: details.sale.clone(),
        sale: details.sale,
        lines: details.lines,
        payments: details.payments,
        payment_split: details.payment_split,
        client_kpi: details.client_kpi,
    })))
}

async fn add_pos_invoice_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosSaleLineInput>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "saved invoice lines require correction approval; only drafts can be edited directly",
        ));
    }

    let mut drafts = read_line_drafts(&state, &tenant_id, &branch_id, &id).await?;
    drafts.push(LineDraft {
        id: None,
        input: payload,
    });
    replace_invoice_lines(
        &state,
        &tenant_id,
        &branch_id,
        &sale,
        drafts,
        "invoice.line_added",
        claims.max_discount_paise,
    )
    .await?;
    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn update_pos_invoice_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, line_id)): Path<(String, String)>,
    Json(payload): Json<PosSaleLineInput>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "saved invoice lines require correction approval; only drafts can be edited directly",
        ));
    }

    let mut found = false;
    let drafts = read_line_drafts(&state, &tenant_id, &branch_id, &id)
        .await?
        .into_iter()
        .map(|line| {
            if line.id.as_deref() == Some(line_id.as_str()) {
                found = true;
                LineDraft {
                    id: line.id,
                    input: merge_line_input(line.input, payload.clone()),
                }
            } else {
                line
            }
        })
        .collect::<Vec<_>>();
    if !found {
        return Err(AppError::not_found("invoice line was not found"));
    }

    replace_invoice_lines(
        &state,
        &tenant_id,
        &branch_id,
        &sale,
        drafts,
        "invoice.line_updated",
        claims.max_discount_paise,
    )
    .await?;
    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn delete_pos_invoice_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, line_id)): Path<(String, String)>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "saved invoice lines require correction approval; only drafts can be edited directly",
        ));
    }

    let mut found = false;
    let drafts = read_line_drafts(&state, &tenant_id, &branch_id, &id)
        .await?
        .into_iter()
        .filter(|line| {
            let keep = line.id.as_deref() != Some(line_id.as_str());
            if !keep {
                found = true;
            }
            keep
        })
        .collect::<Vec<_>>();
    if !found {
        return Err(AppError::not_found("invoice line was not found"));
    }
    if drafts.is_empty() {
        return Err(AppError::validation("invoice must keep at least one line"));
    }

    replace_invoice_lines(
        &state,
        &tenant_id,
        &branch_id,
        &sale,
        drafts,
        "invoice.line_deleted",
        claims.max_discount_paise,
    )
    .await?;
    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn active_happy_hour_rule(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<HappyHourRuleRow>, AppError> {
    sqlx::query_as::<_, HappyHourRuleRow>(
        "SELECT id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active FROM pos_happy_hour_rules WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND EXTRACT(DOW FROM NOW() AT TIME ZONE 'Asia/Kolkata')::SMALLINT = ANY(weekdays) AND ((start_time <= end_time AND (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME BETWEEN start_time AND end_time) OR (start_time > end_time AND ((NOW() AT TIME ZONE 'Asia/Kolkata')::TIME >= start_time OR (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME <= end_time))) ORDER BY discount_bps DESC, created_at ASC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to evaluate happy hour rule"))
}

async fn evaluate_happy_hour_rule(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    calculation: &PosCalculation,
    rule: HappyHourRuleRow,
) -> Result<Option<HappyHourDecision>, AppError> {
    if !rule.eligible_client_categories.is_empty()
        && !client_matches_happy_hour_categories(
            state,
            tenant_id,
            branch_id,
            client_id,
            &rule.eligible_client_categories,
        )
        .await?
    {
        return Ok(None);
    }
    let eligible = calculation
        .lines
        .iter()
        .enumerate()
        .filter(|(_, line)| happy_hour_line_matches(line, &rule))
        .map(|(index, line)| (index, line.gross_paise.saturating_sub(line.discount_paise)))
        .filter(|(_, amount)| *amount > 0)
        .collect::<Vec<_>>();
    let eligible_paise = eligible
        .iter()
        .fold(0i64, |sum, (_, amount)| sum.saturating_add(*amount));
    if eligible_paise == 0 {
        return Ok(None);
    }
    let discount_paise = eligible_paise.saturating_mul(i64::from(rule.discount_bps)) / 10_000;
    let mut allocated = 0i64;
    let last_index = eligible.len().saturating_sub(1);
    let line_discounts = eligible
        .iter()
        .enumerate()
        .map(|(position, (index, amount))| {
            let discount = if position == last_index {
                discount_paise.saturating_sub(allocated)
            } else {
                discount_paise.saturating_mul(*amount) / eligible_paise
            };
            allocated = allocated.saturating_add(discount);
            (*index, discount)
        })
        .collect::<Vec<_>>();
    if rule.min_margin_bps > 0 {
        for (index, discount) in &line_discounts {
            let line = &calculation.lines[*index];
            match happy_hour_line_cost(state, tenant_id, branch_id, line).await? {
                Some(cost_paise) => {
                    let revenue = line
                        .gross_paise
                        .saturating_sub(line.discount_paise)
                        .saturating_sub(*discount);
                    if revenue <= 0
                        || revenue.saturating_sub(cost_paise).saturating_mul(10_000)
                            < revenue.saturating_mul(i64::from(rule.min_margin_bps))
                    {
                        return Err(AppError::validation(
                            "happy-hours would breach the minimum margin",
                        ));
                    }
                }
                None if rule.block_on_unknown_cost => {
                    return Err(AppError::validation(
                        "happy-hours requires real cost data for every eligible line",
                    ));
                }
                None => {}
            }
        }
    }
    Ok(Some(HappyHourDecision {
        rule,
        eligible_paise,
        line_discounts,
    }))
}

fn happy_hour_line_matches(line: &CalculatedLine, rule: &HappyHourRuleRow) -> bool {
    (rule.eligible_line_types.is_empty()
        || rule
            .eligible_line_types
            .iter()
            .any(|value| value.eq_ignore_ascii_case(&line.line_type)))
        && (rule.eligible_item_ids.is_empty()
            || rule
                .eligible_item_ids
                .iter()
                .any(|value| value.eq_ignore_ascii_case(&line.item_id)))
}

async fn client_matches_happy_hour_categories(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    required: &[String],
) -> Result<bool, AppError> {
    if client_id.trim().is_empty() {
        return Ok(false);
    }
    let categories = sqlx::query_scalar::<_, String>(
        "SELECT categories_json::text FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load client categories"))?
    .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
    .unwrap_or_default();
    let categories = categories
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    Ok(required
        .iter()
        .any(|value| categories.contains(&value.to_ascii_lowercase())))
}

async fn happy_hour_line_cost(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    line: &CalculatedLine,
) -> Result<Option<i64>, AppError> {
    if line.line_type == "product" {
        return sqlx::query_scalar::<_, i64>(
            "SELECT unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
        )
        .bind(tenant_id).bind(branch_id).bind(&line.item_id).fetch_optional(&state.db).await
        .map_err(|_| AppError::internal("failed to load product cost"))
        .map(|cost| cost.filter(|cost| *cost > 0).map(|cost| cost.saturating_mul(line.quantity)));
    }
    if line.line_type != "service" {
        return Ok(None);
    }
    let (known_products, service_cost) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(i.id)::BIGINT, COALESCE(SUM(i.unit_cost_paise * COALESCE(NULLIF(entry->>'quantity','')::BIGINT, NULLIF(entry->>'qty','')::BIGINT, 0)),0)::BIGINT FROM services s LEFT JOIN LATERAL jsonb_array_elements(s.product_consumption_json) entry ON TRUE LEFT JOIN inventory_items i ON i.tenant_id=$1 AND i.branch_id=$2 AND i.id=COALESCE(entry->>'itemId', entry->>'productId', entry->>'inventoryItemId') AND i.active=TRUE WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(&line.item_id).fetch_one(&state.db).await
    .map_err(|_| AppError::internal("failed to load service consumption cost"))?;
    Ok((known_products > 0 && service_cost > 0)
        .then_some(service_cost.saturating_mul(line.quantity)))
}

fn apply_happy_hour_line_discounts(
    payload: &mut PosSalePayload,
    calculation: &PosCalculation,
    decision: &HappyHourDecision,
) -> Result<(), AppError> {
    let lines = payload
        .lines
        .as_mut()
        .or(payload.items.as_mut())
        .ok_or_else(|| AppError::validation("happy-hours requires POS line items"))?;
    if lines.len() != calculation.lines.len() {
        return Err(AppError::internal("happy-hours line calculation mismatch"));
    }
    for (index, discount) in &decision.line_discounts {
        let line = &mut lines[*index];
        line.discount_paise = Some(
            calculation.lines[*index]
                .discount_paise
                .saturating_add(*discount),
        );
        line.discount_amount_paise = None;
        line.discount_value = None;
        line.discount_type = Some("amount".to_string());
    }
    Ok(())
}

fn normalize_happy_hour_filter(values: Option<Vec<String>>) -> Vec<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

fn normalize_pos_source(source: Option<String>) -> String {
    let source = source.unwrap_or_else(|| "manual".to_string());
    match source.trim().to_ascii_lowercase().as_str() {
        "appointment" => "appointment".to_string(),
        "appointment_no_show" | "appointment-no-show" => "appointment_no_show".to_string(),
        "membership_auto_renew" | "membership-auto-renew" => "membership_auto_renew".to_string(),
        "membership_plan_change" | "membership-plan-change" => "membership_plan_change".to_string(),
        "membership_renewal" | "membership-renewal" => "membership_renewal".to_string(),
        "customer_membership_purchase" | "customer-membership-purchase" => {
            "customer_membership_purchase".to_string()
        }
        "customer_gift_card_purchase" | "customer-gift-card-purchase" => {
            "customer_gift_card_purchase".to_string()
        }
        "customer_package_purchase" | "customer-package-purchase" => {
            "customer_package_purchase".to_string()
        }
        "customer_product_purchase" | "customer-product-purchase" => {
            "customer_product_purchase".to_string()
        }
        "offline_sync" | "offline-sync" => "offline_sync".to_string(),
        _ => source.trim().to_string(),
    }
}

fn replayable_pos_reference(source: &str, reference_id: &str) -> bool {
    !reference_id.trim().is_empty()
        && matches!(
            source,
            "appointment"
                | "appointment_no_show"
                | "offline_sync"
                | "membership_auto_renew"
                | "membership_plan_change"
                | "membership_renewal"
                | "customer_membership_purchase"
                | "customer_gift_card_purchase"
                | "customer_package_purchase"
                | "customer_product_purchase"
        )
}

fn customer_commerce_source(source: &str) -> bool {
    matches!(
        source,
        "customer_membership_purchase"
            | "customer_gift_card_purchase"
            | "customer_package_purchase"
            | "customer_product_purchase"
    )
}

fn should_defer_customer_commerce_benefits(source: &str, status: &str) -> bool {
    customer_commerce_source(source) && status != "paid"
}

pub(crate) async fn configured_customer_payment_provider(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<&'static str>, AppError> {
    for provider in crate::config::PAYMENT_PROVIDERS {
        if state.settings.payment_provider_webhook_configured(provider)
            && payment_gateway_service::provider_enabled_for_branch(
                &state.db,
                &state.settings,
                tenant_id,
                branch_id,
                provider,
            )
            .await?
        {
            return Ok(Some(provider));
        }
    }
    Ok(None)
}

pub(crate) async fn customer_membership_checkout_line(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    plan_id: String,
    plan_name: String,
    display_price_paise: i64,
) -> Result<PosSaleLineInput, AppError> {
    if display_price_paise < 0 {
        return Err(AppError::validation("membership price cannot be negative"));
    }
    let settings = sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM membership_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load membership pricing settings"))?
    .unwrap_or_else(|| serde_json::json!({}));
    let policy = membership_pos_policy(&settings);
    if !policy.sales_enabled {
        return Err(AppError::validation("membership sales are disabled"));
    }
    if display_price_paise == 0 && !policy.free_enabled {
        return Err(AppError::validation("free membership sales are disabled"));
    }
    if display_price_paise > 0 && !policy.paid_enabled {
        return Err(AppError::validation("paid membership sales are disabled"));
    }
    let tax_percent = if policy.tax_applicable { 18 } else { 0 };
    let unit_price_paise = if policy.tax_inclusive && tax_percent > 0 {
        display_price_paise
            .saturating_mul(100)
            .saturating_add(i64::from((100 + tax_percent) / 2))
            / i64::from(100 + tax_percent)
    } else {
        display_price_paise
    };
    Ok(PosSaleLineInput {
        line_type: Some("membership".to_string()),
        item_id: Some(plan_id),
        item_name: Some(plan_name),
        quantity: Some(1),
        unit_price_paise: Some(unit_price_paise),
        tax_percent: Some(tax_percent),
        ..PosSaleLineInput::default()
    })
}

pub(crate) fn customer_gift_card_checkout_line(amount_paise: i64) -> PosSaleLineInput {
    PosSaleLineInput {
        line_type: Some("gift_card".to_string()),
        item_name: Some("Gift Card".to_string()),
        quantity: Some(1),
        unit_price_paise: Some(amount_paise),
        tax_percent: Some(0),
        ..PosSaleLineInput::default()
    }
}

pub(crate) fn customer_package_checkout_line(
    package_id: String,
    package_name: String,
    price_paise: i64,
) -> PosSaleLineInput {
    PosSaleLineInput {
        line_type: Some("package".to_string()),
        item_id: Some(package_id),
        item_name: Some(package_name),
        quantity: Some(1),
        unit_price_paise: Some(price_paise.max(0)),
        tax_percent: Some(0),
        ..PosSaleLineInput::default()
    }
}

pub(crate) fn customer_product_checkout_line(
    product_id: String,
    product_name: String,
    quantity: i64,
    price_paise: i64,
    gst_percent: i32,
    hsn_code: String,
) -> PosSaleLineInput {
    PosSaleLineInput {
        line_type: Some("product".to_string()),
        item_id: Some(product_id),
        item_name: Some(product_name),
        quantity: Some(quantity),
        unit_price_paise: Some(price_paise),
        gst_percent: Some(gst_percent),
        hsn_code: Some(hsn_code),
        ..PosSaleLineInput::default()
    }
}

#[cfg(test)]
mod customer_commerce_policy_tests {
    use super::{
        customer_gift_card_checkout_line, customer_product_checkout_line, normalize_pos_source,
        should_defer_customer_commerce_benefits,
    };

    #[test]
    fn defers_customer_commerce_benefits_until_fully_paid() {
        let source = normalize_pos_source(Some("customer-membership-purchase".to_string()));
        assert_eq!(source, "customer_membership_purchase");
        assert!(should_defer_customer_commerce_benefits(&source, "open"));
        assert!(should_defer_customer_commerce_benefits(&source, "partial"));
        assert!(!should_defer_customer_commerce_benefits(&source, "paid"));
        assert!(!should_defer_customer_commerce_benefits("manual", "open"));
    }

    #[test]
    fn gift_card_checkout_line_preserves_the_requested_ledger_value() {
        let line = customer_gift_card_checkout_line(25_050);
        assert_eq!(line.line_type.as_deref(), Some("gift_card"));
        assert_eq!(line.unit_price_paise, Some(25_050));
        assert_eq!(line.tax_percent, Some(0));
    }

    #[test]
    fn product_checkout_line_uses_server_price_tax_and_quantity() {
        let line = customer_product_checkout_line(
            "product-1".into(),
            "Shampoo".into(),
            2,
            12_500,
            18,
            "3305".into(),
        );
        assert_eq!(line.line_type.as_deref(), Some("product"));
        assert_eq!(line.quantity, Some(2));
        assert_eq!(line.unit_price_paise, Some(12_500));
        assert_eq!(line.gst_percent, Some(18));
    }
}

pub(crate) async fn create_customer_commerce_checkout(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    source: &str,
    idempotency_key: &str,
    line: PosSaleLineInput,
    coupon_code: Option<&str>,
) -> Result<CustomerCommerceCheckout, AppError> {
    if !customer_commerce_source(source) {
        return Err(AppError::validation("unsupported customer commerce source"));
    }
    if idempotency_key.trim().is_empty() {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-tenant-id",
        HeaderValue::from_str(tenant_id)
            .map_err(|_| AppError::validation("tenantId is invalid"))?,
    );
    headers.insert(
        "x-branch-id",
        HeaderValue::from_str(branch_id)
            .map_err(|_| AppError::validation("branchId is invalid"))?,
    );
    let details = persist_pos_sale(
        state,
        headers,
        PosSalePayload {
            client_id: Some(client_id.to_string()),
            source: Some(source.to_string()),
            reference_id: Some(idempotency_key.trim().to_string()),
            lines: Some(vec![line]),
            coupon_code: coupon_code
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            payments: Some(Vec::new()),
            status: Some("open".to_string()),
            ..PosSalePayload::default()
        },
        None,
    )
    .await?;
    let payment_required = details.sale.paid_paise < details.sale.total_paise;
    let provider = configured_customer_payment_provider(state, tenant_id, branch_id).await?;
    let payment_link = if payment_required {
        if let Some(provider) = provider {
            Some(
                create_payment_link_for_invoice(
                    state,
                    tenant_id,
                    branch_id,
                    &details.sale.id,
                    PosPaymentLinkRequest {
                        provider: Some(provider.to_string()),
                        amount_paise: Some(details.sale.balance_due_paise),
                        expires_at: None,
                        idempotency_key: Some(format!("{}:payment-link", idempotency_key.trim())),
                    },
                )
                .await?,
            )
        } else {
            None
        }
    } else {
        None
    };
    Ok(CustomerCommerceCheckout {
        sale_id: details.sale.id.clone(),
        invoice_id: details.sale.id,
        amount_paise: details.sale.total_paise,
        status: details.sale.status,
        payment_required,
        activation_required: payment_required && provider.is_none(),
        payment_link,
    })
}

async fn available_booking_advances(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    appointment_reference: &str,
) -> Result<Vec<AvailableBookingAdvanceRow>, AppError> {
    sqlx::query_as::<_, AvailableBookingAdvanceRow>(
        r#"
        SELECT link.id AS payment_link_id,
               link.provider,
               COALESCE(NULLIF(link.provider_payment_id, ''), link.id) AS reference,
               GREATEST(link.amount_paise - COALESCE(SUM(allocation.amount_paise), 0), 0)::BIGINT AS available_paise,
               link.paid_at,
               COALESCE((link.payload_json->>'accountedAtCollection')::BOOLEAN, FALSE) AS accounted_at_collection
          FROM appointment_payment_links link
          JOIN appointments appointment
            ON appointment.tenant_id=link.tenant_id
           AND appointment.branch_id=link.branch_id
           AND appointment.id=link.appointment_id
          LEFT JOIN appointment_payment_allocations allocation
            ON allocation.tenant_id=link.tenant_id
           AND allocation.branch_id=link.branch_id
           AND allocation.payment_link_id=link.id
         WHERE link.tenant_id=$1
           AND link.branch_id=$2
           AND link.status='paid'
           AND (appointment.id=$3 OR appointment.booking_group_id=$3)
         GROUP BY link.id, link.provider, link.provider_payment_id, link.amount_paise, link.paid_at, link.payload_json
        HAVING link.amount_paise > COALESCE(SUM(allocation.amount_paise), 0)
         ORDER BY link.paid_at, link.id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(appointment_reference)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load booking advance"))
}

fn allocate_booking_advance(
    rows: Vec<AvailableBookingAdvanceRow>,
    invoice_total_paise: i64,
) -> Vec<BookingAdvanceAllocation> {
    let mut remaining = invoice_total_paise.max(0);
    let mut allocations = Vec::new();
    for row in rows {
        if remaining == 0 {
            break;
        }
        let amount_paise = row.available_paise.min(remaining).max(0);
        if amount_paise == 0 {
            continue;
        }
        allocations.push(BookingAdvanceAllocation {
            payment_link_id: row.payment_link_id,
            provider: row.provider,
            reference: row.reference,
            amount_paise,
            paid_at: row.paid_at,
            accounted_at_collection: row.accounted_at_collection,
        });
        remaining -= amount_paise;
    }
    allocations
}

async fn get_pos_appointment_deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<AppointmentDepositResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let appointment_reference =
        canonical_appointment_reference(&state, &tenant_id, &branch_id, &id).await?;
    let available_paise =
        available_booking_advances(&state.db, &tenant_id, &branch_id, &appointment_reference)
            .await?
            .into_iter()
            .fold(0i64, |sum, row| sum.saturating_add(row.available_paise));
    Ok(Json(ApiResponse::ok(AppointmentDepositResponse {
        appointment_reference,
        available_paise,
    })))
}

async fn save_booking_advance_allocations(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    allocations: &[BookingAdvanceAllocation],
) -> Result<(), AppError> {
    for allocation in allocations {
        let amount_paise = sqlx::query_scalar::<_, i64>(
            "SELECT amount_paise FROM appointment_payment_links WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='paid' FOR UPDATE",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&allocation.payment_link_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock booking advance"))?
        .ok_or_else(|| AppError::conflict("booking advance is no longer available"))?;
        let already_allocated = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(amount_paise),0)::BIGINT FROM appointment_payment_allocations WHERE tenant_id=$1 AND branch_id=$2 AND payment_link_id=$3",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&allocation.payment_link_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to validate booking advance"))?;
        if amount_paise.saturating_sub(already_allocated) < allocation.amount_paise {
            return Err(AppError::conflict("booking advance was already applied"));
        }
        sqlx::query(
            "INSERT INTO appointment_payment_allocations (tenant_id,branch_id,payment_link_id,sale_id,amount_paise) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&allocation.payment_link_id)
        .bind(sale_id)
        .bind(allocation.amount_paise)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::conflict("booking advance was already applied"))?;
    }
    Ok(())
}
pub(crate) async fn canonical_appointment_reference(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
) -> Result<String, AppError> {
    let appointment_id = appointment_id.trim();
    if appointment_id.is_empty() {
        return Err(AppError::validation(
            "appointment source requires referenceId",
        ));
    }

    sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(NULLIF(a.booking_group_id, ''), a.id)
           FROM appointments a
          WHERE (a.id=$1 OR a.booking_group_id=$1) AND a.tenant_id=$2 AND a.branch_id=$3
          ORDER BY CASE WHEN a.id=$1 THEN 0 ELSE 1 END
          LIMIT 1",
    )
    .bind(appointment_id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to resolve appointment invoice reference"))
    .map(|reference| reference.unwrap_or_else(|| appointment_id.to_string()))
}

async fn appointment_invoice_reference(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    separate_group_invoice: bool,
) -> Result<String, AppError> {
    if !separate_group_invoice {
        return canonical_appointment_reference(state, tenant_id, branch_id, appointment_id).await;
    }
    let appointment_id = appointment_id.trim();
    if appointment_id.is_empty() {
        return Err(AppError::validation(
            "appointment source requires referenceId",
        ));
    }
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM appointments WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(appointment_id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to resolve separate appointment invoice"))?
    .ok_or_else(|| AppError::not_found("appointment was not found"))
}

pub(crate) async fn find_appointment_pos_sale(
    state: &AppState,
    headers: &HeaderMap,
    reference_id: &str,
) -> Result<Option<AppointmentPosDraft>, AppError> {
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    sqlx::query_as::<_, (String, i64, String)>(
        "SELECT id, total_paise, status
           FROM pos_sales
          WHERE tenant_id=$1 AND branch_id=$2 AND source='appointment' AND reference_id=$3
          LIMIT 1",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(reference_id)
    .fetch_optional(&state.db)
    .await
    .map(|row| {
        row.map(|(sale_id, total_paise, status)| AppointmentPosDraft {
            sale_id,
            total_paise,
            status,
        })
    })
    .map_err(|_| AppError::internal("failed to load appointment invoice"))
}

pub(crate) async fn create_or_resume_appointment_draft(
    state: &AppState,
    headers: HeaderMap,
    reference_id: &str,
    client_id: &str,
    staff_id: &str,
    lines: Vec<PosSaleLineInput>,
) -> Result<AppointmentPosDraft, AppError> {
    if let Some(existing) = find_appointment_pos_sale(state, &headers, reference_id).await? {
        return Ok(existing);
    }

    let details = persist_pos_sale(
        state,
        headers,
        PosSalePayload {
            client_id: Some(client_id.to_string()),
            staff_id: Some(staff_id.to_string()),
            source: Some("appointment".to_string()),
            reference_id: Some(reference_id.to_string()),
            lines: Some(lines),
            payments: Some(Vec::new()),
            status: Some("draft".to_string()),
            ..PosSalePayload::default()
        },
        None,
    )
    .await?;

    Ok(AppointmentPosDraft {
        sale_id: details.sale.id,
        total_paise: details.sale.total_paise,
        status: details.sale.status,
    })
}

pub(crate) async fn append_appointment_draft_line(
    state: &AppState,
    headers: &HeaderMap,
    sale_id: &str,
    reference_id: &str,
    line: PosSaleLineInput,
    max_discount_paise: Option<i64>,
) -> Result<AppointmentPosDraft, AppError> {
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    let sale = load_pos_sale(state, &tenant_id, &branch_id, sale_id).await?;
    if sale.source != "appointment" || sale.reference_id != reference_id {
        return Err(AppError::forbidden(
            "invoice does not belong to this appointment",
        ));
    }
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "only an appointment draft can receive recommendations",
        ));
    }
    let mut drafts = read_line_drafts(state, &tenant_id, &branch_id, sale_id).await?;
    drafts.push(LineDraft {
        id: None,
        input: line,
    });
    replace_invoice_lines(
        state,
        &tenant_id,
        &branch_id,
        &sale,
        drafts,
        "appointment.recommendation_added",
        max_discount_paise,
    )
    .await?;
    let saved = load_pos_sale(state, &tenant_id, &branch_id, sale_id).await?;
    Ok(AppointmentPosDraft {
        sale_id: saved.id,
        total_paise: saved.total_paise,
        status: saved.status,
    })
}

pub(crate) async fn create_auto_renew_sale(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    membership_id: &str,
    membership_name: &str,
    amount_paise: i64,
    attempt_id: &str,
    provider_reference: &str,
) -> Result<String, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-tenant-id",
        tenant_id
            .parse()
            .map_err(|_| AppError::validation("invalid tenant id"))?,
    );
    headers.insert(
        "x-branch-id",
        branch_id
            .parse()
            .map_err(|_| AppError::validation("invalid branch id"))?,
    );
    let details = persist_pos_sale(
        state,
        headers,
        PosSalePayload {
            client_id: Some(client_id.to_string()),
            source: Some("membership_auto_renew".to_string()),
            reference_id: Some(attempt_id.to_string()),
            lines: Some(vec![PosSaleLineInput {
                line_type: Some("membership".to_string()),
                item_id: Some(membership_id.to_string()),
                item_name: Some(membership_name.to_string()),
                quantity: Some(1),
                unit_price_paise: Some(amount_paise),
                ..PosSaleLineInput::default()
            }]),
            payments: Some(vec![PosPaymentInput {
                method: Some("bank_transfer".to_string()),
                amount_paise: Some(amount_paise),
                method_reference: Some(provider_reference.to_string()),
                label: Some("Razorpay Auto-renew".to_string()),
                notes: Some("Verified Razorpay subscription cycle".to_string()),
                idempotency_key: Some(format!("membership-auto-renew-{attempt_id}")),
                ..PosPaymentInput::default()
            }]),
            status: Some("finalized".to_string()),
            ..PosSalePayload::default()
        },
        None,
    )
    .await?;
    Ok(details.sale.id)
}

pub(crate) async fn create_no_show_charge(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    client_id: &str,
    staff_id: &str,
    amount_paise: i64,
    provider: &str,
    idempotency_key: &str,
) -> Result<NoShowChargeResult, AppError> {
    create_appointment_fee_charge(
        state,
        tenant_id,
        branch_id,
        appointment_id,
        client_id,
        staff_id,
        amount_paise,
        provider,
        idempotency_key,
        "no_show",
    )
    .await
}

pub(crate) async fn create_appointment_fee_charge(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    client_id: &str,
    staff_id: &str,
    amount_paise: i64,
    provider: &str,
    idempotency_key: &str,
    fee_type: &str,
) -> Result<NoShowChargeResult, AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-tenant-id",
        tenant_id
            .parse()
            .map_err(|_| AppError::validation("invalid tenant id"))?,
    );
    headers.insert(
        "x-branch-id",
        branch_id
            .parse()
            .map_err(|_| AppError::validation("invalid branch id"))?,
    );
    let details = persist_pos_sale(
        state,
        headers,
        PosSalePayload {
            client_id: Some(client_id.to_string()),
            staff_id: Some(staff_id.to_string()),
            source: Some(format!("appointment_{fee_type}")),
            reference_id: Some(appointment_id.to_string()),
            lines: Some(vec![PosSaleLineInput {
                line_type: Some("custom".to_string()),
                item_name: Some(
                    if fee_type == "cancellation" {
                        "Cancellation fee"
                    } else {
                        "No-show fee"
                    }
                    .to_string(),
                ),
                quantity: Some(1),
                unit_price_paise: Some(amount_paise),
                ..PosSaleLineInput::default()
            }]),
            payments: Some(Vec::new()),
            status: Some("open".to_string()),
            ..PosSalePayload::default()
        },
        None,
    )
    .await?;
    if details.sale.total_paise != amount_paise {
        return Err(AppError::conflict(
            "an existing no-show invoice has a different amount",
        ));
    }
    let provider = provider.trim().to_ascii_lowercase();
    if !matches!(provider.as_str(), "razorpay" | "cashfree" | "phonepe") {
        return Err(AppError::validation(
            "provider must be razorpay, cashfree, or phonepe",
        ));
    }
    if idempotency_key.trim().is_empty() {
        return Err(AppError::validation(
            "idempotencyKey is required when creating a no-show charge",
        ));
    }
    let configured = state.settings.payment_provider_enabled(&provider)
        && state
            .settings
            .payment_provider_webhook_configured(&provider);
    let payment_link = if configured {
        Some(
            create_payment_link_for_invoice(
                state,
                tenant_id,
                branch_id,
                &details.sale.id,
                PosPaymentLinkRequest {
                    provider: Some(provider),
                    amount_paise: Some(amount_paise),
                    expires_at: None,
                    idempotency_key: Some(idempotency_key.to_string()),
                },
            )
            .await?,
        )
    } else {
        None
    };
    Ok(NoShowChargeResult {
        sale_id: details.sale.id,
        amount_paise,
        payment_link,
        activation_required: !configured,
    })
}

async fn persist_pos_sale(
    state: &AppState,
    headers: HeaderMap,
    mut payload: PosSalePayload,
    max_discount_paise: Option<i64>,
) -> Result<PosSaleDetailsResponse, AppError> {
    let checkout_started = std::time::Instant::now();
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let discount_reason = validated_discount_reason(&payload)?;
    let cash_drawer_till_id = payload.cash_drawer_till_id.clone().unwrap_or_default();
    hydrate_appointment_booked_prices(state, &tenant_id, &branch_id, &mut payload).await?;
    hydrate_pos_tax_metadata(state, &tenant_id, &branch_id, &mut payload).await?;
    resolve_coupon_discount(state, &tenant_id, &branch_id, &mut payload).await?;
    let gst_context = gst_context_from_payload(state, &tenant_id, &branch_id, &payload).await?;
    let package_redemptions = normalize_package_redemptions(
        payload
            .package_redemptions
            .take()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )?;
    let mut base_calculation = calculate_pos(&payload)?;
    apply_gst_context(
        &mut base_calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    let client_id_for_rule = payload
        .client_id
        .as_deref()
        .or(payload.customer_id.as_deref())
        .unwrap_or("");
    let happy_hour = match active_happy_hour_rule(state, &tenant_id, &branch_id).await? {
        Some(rule) => {
            evaluate_happy_hour_rule(
                state,
                &tenant_id,
                &branch_id,
                client_id_for_rule,
                &base_calculation,
                rule,
            )
            .await?
        }
        None => None,
    };
    if happy_hour.is_some()
        && (base_calculation.bill_discount_paise > 0 || base_calculation.coupon_discount_paise > 0)
    {
        return Err(AppError::validation(
            "happy-hours cannot be combined with invoice-level discounts",
        ));
    }
    if let Some(decision) = happy_hour.as_ref() {
        apply_happy_hour_line_discounts(&mut payload, &base_calculation, decision)?;
    }
    let mut calculation = if happy_hour.is_some() {
        calculate_pos(&payload)?
    } else {
        base_calculation
    };
    if apply_membership_benefits(state, &tenant_id, &branch_id, &mut payload, &calculation).await? {
        calculation = calculate_pos(&payload)?;
    }
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(
        state,
        &tenant_id,
        &branch_id,
        &calculation,
        max_discount_paise,
    )
    .await?;

    let source = normalize_pos_source(payload.source.take());
    let reference_id = payload.reference_id.take().unwrap_or_default();
    if source == "appointment" && reference_id.trim().is_empty() {
        return Err(AppError::validation(
            "appointment source requires referenceId",
        ));
    }
    let reference_id = if source == "appointment" {
        appointment_invoice_reference(
            state,
            &tenant_id,
            &branch_id,
            &reference_id,
            payload.separate_group_invoice.unwrap_or(false),
        )
        .await?
    } else {
        reference_id
    };
    let reference_lock_id = if source == "appointment" {
        canonical_appointment_reference(state, &tenant_id, &branch_id, &reference_id).await?
    } else {
        reference_id.clone()
    };
    let booking_advance_allocations = if source == "appointment"
        && !payload
            .status
            .as_deref()
            .is_some_and(|status| status.eq_ignore_ascii_case("draft"))
    {
        allocate_booking_advance(
            available_booking_advances(&state.db, &tenant_id, &branch_id, &reference_id).await?,
            calculation.total_paise,
        )
    } else {
        Vec::new()
    };
    let booking_advance_paise = booking_advance_allocations
        .iter()
        .fold(0i64, |sum, allocation| {
            sum.saturating_add(allocation.amount_paise)
        });
    let force_unpaid = payload.force_unpaid.unwrap_or(false);
    let wallet_credit_paise = if force_unpaid {
        0
    } else {
        payload.wallet_credit_paise.unwrap_or(0)
    };
    let adjusted_total_paise = calculation
        .total_paise
        .saturating_sub(booking_advance_paise);
    let (collected_now_paise, collected_now_payments) = prepare_checkout_payments(
        payload.payments.take(),
        adjusted_total_paise,
        wallet_credit_paise,
        force_unpaid,
    )?;
    validate_active_payment_modes(state, &tenant_id, &branch_id, &collected_now_payments).await?;
    let mut prepared_payments = booking_advance_allocations
        .iter()
        .map(|allocation| PreparedPayment {
            method: if allocation.accounted_at_collection {
                "booking_advance".to_string()
            } else {
                "other".to_string()
            },
            reference: allocation.reference.clone(),
            label: "Booking advance".to_string(),
            amount_paise: allocation.amount_paise,
            notes: format!("{} appointment deposit", allocation.provider),
            idempotency_key: format!("booking-advance:{}", allocation.payment_link_id),
            paid_at: allocation.paid_at,
        })
        .collect::<Vec<_>>();
    prepared_payments.extend(collected_now_payments);
    let paid = booking_advance_paise
        .saturating_add(collected_now_paise)
        .min(calculation.total_paise);

    let sale_id = uuid::Uuid::new_v4().to_string();
    let client_id = payload
        .client_id
        .or(payload.customer_id)
        .unwrap_or_default();
    if wallet_credit_paise > 0 && client_id.trim().is_empty() {
        return Err(AppError::validation(
            "client is required when collecting an advance",
        ));
    }
    let staff_id = payload.staff_id.unwrap_or_default();
    let invoice_type = payload
        .invoice_type
        .unwrap_or_else(|| "tax_invoice".to_string());
    let invoice_type = invoice_type.trim().to_ascii_lowercase();
    let status =
        status_for_invoice_create(payload.status.as_deref(), calculation.total_paise, paid);
    if status == "draft" && wallet_credit_paise > 0 {
        return Err(AppError::validation(
            "client advance can only be applied when finalizing an invoice",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start pos invoice transaction"))?;
    if replayable_pos_reference(&source, &reference_id) {
        let lock_key = format!("{tenant_id}|{branch_id}|{reference_lock_id}");
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(lock_key)
            .execute(&mut *tx)
            .await
            .map_err(|_| AppError::internal("failed to lock pos reference"))?;
        if let Some(existing_id) = sqlx::query_scalar::<_, String>(
            "SELECT id FROM pos_sales
              WHERE tenant_id=$1 AND branch_id=$2 AND source=$3 AND reference_id=$4
              LIMIT 1",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&source)
        .bind(&reference_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to check pos reference"))?
        {
            tx.rollback()
                .await
                .map_err(|_| AppError::internal("failed to finish pos reference retry"))?;
            return load_pos_sale_details(state, &tenant_id, &branch_id, &existing_id).await;
        }
        if source == "appointment" {
            let overlaps: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND source='appointment' AND (reference_id=$3 OR reference_id IN (SELECT id FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND (id=$3 OR booking_group_id=$3))))",
            )
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(&reference_lock_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| AppError::internal("failed to check booking group invoice"))?;
            if overlaps {
                return Err(AppError::conflict(
                    "appointment or booking group already has an invoice",
                ));
            }
        }
    }
    let business_date = sqlx::query_scalar::<_, NaiveDate>("SELECT CURRENT_DATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to resolve invoice business date"))?;
    let day_locked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_day_locks WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 AND status='locked')")
        .bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&mut *tx).await
        .map_err(|_| AppError::internal("failed to validate POS business day"))?;
    if day_locked {
        return Err(AppError::conflict("POS business day is locked"));
    }
    let invoice_sequence = invoice_numbering_service::allocate(
        &mut tx,
        &tenant_id,
        &branch_id,
        &invoice_type,
        business_date,
    )
    .await?;
    let invoice_number = invoice_sequence.invoice_number.clone();
    let terminal_id = payload.terminal_id.as_deref().unwrap_or_default().trim();
    if !terminal_id.is_empty() {
        let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_terminals WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active')")
            .bind(&tenant_id).bind(&branch_id).bind(terminal_id).fetch_one(&mut *tx).await
            .map_err(|_| AppError::internal("failed to validate POS terminal"))?;
        if !valid {
            return Err(AppError::validation("active POS terminal was not found"));
        }
    }

    let sale = sqlx::query_as::<_, PosSaleRow>(
        r#"
        INSERT INTO pos_sales (
            id, tenant_id, branch_id, client_id, staff_id, invoice_number,
            subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
            tip_paise, round_off_paise, total_paise, paid_paise,
            status, source, reference_id, package_redemptions, invoice_type, business_date,
            seller_gstin, seller_state_code, buyer_gstin, place_of_supply_state_code, tax_mode, reverse_charge,
            cgst_paise, sgst_paise, igst_paise, fiscal_year, invoice_number_sequence_id, terminal_id,
            discount_reason, cart_owner_terminal_id, separate_group_invoice, finalized_at, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,NULLIF($34,''),$35,$34,$36,CASE WHEN $17 = 'draft' THEN NULL ELSE NOW() END,NOW(),NOW())
        RETURNING id, tenant_id, branch_id, client_id, staff_id, invoice_number,
                  subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
                  tip_paise, round_off_paise, total_paise, paid_paise,
                  status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at
        "#,
    )
    .bind(&sale_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(client_id.trim())
    .bind(staff_id.trim())
    .bind(&invoice_number)
    .bind(calculation.subtotal_paise)
    .bind(calculation.bill_discount_paise)
    .bind(&calculation.coupon_code)
    .bind(calculation.coupon_discount_paise)
    .bind(calculation.discount_paise)
    .bind(calculation.tax_paise)
    .bind(calculation.tip_paise)
    .bind(calculation.round_off_paise)
    .bind(calculation.total_paise)
    .bind(paid)
    .bind(&status)
    .bind(&source)
    .bind(&reference_id)
    .bind(&package_redemptions)
    .bind(&invoice_type)
    .bind(business_date)
    .bind(&gst_context.seller_gstin)
    .bind(&gst_context.seller_state_code)
    .bind(&gst_context.buyer_gstin)
    .bind(&gst_context.place_of_supply_state_code)
    .bind(&gst_context.tax_mode)
    .bind(gst_context.reverse_charge)
    .bind(calculation.cgst_paise)
    .bind(calculation.sgst_paise)
    .bind(calculation.igst_paise)
    .bind(&invoice_sequence.fiscal_year)
    .bind(&invoice_sequence.sequence_id)
    .bind(terminal_id)
    .bind(&discount_reason)
    .bind(payload.separate_group_invoice.unwrap_or(false))
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to create pos sale"))?;

    if let Some(decision) = happy_hour.as_ref() {
        let rule = &decision.rule;
        let discount_paise = decision
            .line_discounts
            .iter()
            .fold(0i64, |sum, (_, value)| sum.saturating_add(*value));
        sqlx::query(
            "INSERT INTO pos_happy_hour_locks (tenant_id, branch_id, sale_id, rule_id, rule_snapshot, eligible_paise, discount_paise) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&sale_id)
        .bind(&rule.id)
        .bind(serde_json::json!({
            "name": rule.name,
            "startTime": rule.start_time,
            "endTime": rule.end_time,
            "weekdays": rule.weekdays,
            "discountBps": rule.discount_bps,
            "eligibleLineTypes": rule.eligible_line_types,
            "eligibleItemIds": rule.eligible_item_ids,
            "eligibleClientCategories": rule.eligible_client_categories,
            "minMarginBps": rule.min_margin_bps,
            "eligibleLineIndexes": decision.line_discounts.iter().map(|(index, _)| *index).collect::<Vec<_>>()
        }).to_string())
        .bind(decision.eligible_paise)
        .bind(discount_paise)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to lock happy hour discount"))?;
    }

    if status != "draft" {
        consume_coupon_usage(
            &mut tx,
            &tenant_id,
            &branch_id,
            &client_id,
            &calculation.coupon_code,
        )
        .await?;
    }

    let event_type = if status == "draft" {
        "invoice.draft_created"
    } else {
        "invoice.created"
    };
    insert_pos_event(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale_id,
        event_type,
        serde_json::json!({
            "invoiceNumber": invoice_number,
            "totalPaise": calculation.total_paise,
            "paidPaise": paid,
            "couponCode": calculation.coupon_code.clone(),
            "couponDiscountPaise": calculation.coupon_discount_paise,
            "source": sale.source.clone()
        }),
    )
    .await?;

    for line in &calculation.lines {
        let line_id = uuid::Uuid::new_v4().to_string();
        insert_calculated_line(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale_id,
            &line_id,
            line.clone(),
        )
        .await?;
    }
    if status != "draft" {
        pos_enterprise_repository::snapshot_staff_commissions(
            &mut tx, &tenant_id, &branch_id, &sale_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to snapshot staff commission"))?;
        let movements = inventory_adjustment_service::consume_pos_sale(
            &mut tx, &tenant_id, &branch_id, &sale_id,
        )
        .await?;
        if movements > 0 {
            insert_pos_event(
                &mut tx,
                &tenant_id,
                &branch_id,
                &sale_id,
                "inventory.consumed",
                serde_json::json!({ "movements": movements }),
            )
            .await?;
        }
        accounting_service::post_cogs(&mut tx, &tenant_id, &branch_id, &sale_id).await?;
    }

    if status != "draft" {
        save_booking_advance_allocations(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale_id,
            &booking_advance_allocations,
        )
        .await?;
    }

    let payment_rows = insert_pos_payments(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale.client_id,
        &sale_id,
        status != "draft",
        &cash_drawer_till_id,
        prepared_payments,
    )
    .await?;
    if status != "draft" {
        wallet_service::credit_pos_advance(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale_id,
            wallet_credit_paise,
        )
        .await?;
        accounting_service::post_invoice(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale_id,
            sale.total_paise,
            sale.tax_paise,
            calculation.cgst_paise,
            calculation.sgst_paise,
            calculation.igst_paise,
            sale.tip_paise,
            sale.round_off_paise,
        )
        .await?;
        let mut invoice_balance_paise = sale.total_paise;
        for payment in &payment_rows {
            let invoice_payment_paise = payment.amount_paise.min(invoice_balance_paise);
            let advance_paise = payment.amount_paise - invoice_payment_paise;
            if invoice_payment_paise > 0 {
                accounting_service::post_payment(
                    &mut tx,
                    &tenant_id,
                    &branch_id,
                    &payment.id,
                    &payment.method,
                    invoice_payment_paise,
                )
                .await?;
                invoice_balance_paise -= invoice_payment_paise;
            }
            if advance_paise > 0 {
                accounting_service::post_pos_advance(
                    &mut tx,
                    &tenant_id,
                    &branch_id,
                    &payment.id,
                    &payment.method,
                    advance_paise,
                )
                .await?;
            }
        }
    }
    if status != "draft"
        && !sale.client_id.trim().is_empty()
        && !should_defer_customer_commerce_benefits(&source, &status)
    {
        grant_package_credits_for_sale_lines(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale_id,
            &calculation.lines,
        )
        .await?;
        grant_membership_credits_for_sale_lines(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale_id,
            &calculation.lines,
        )
        .await?;
        issue_gift_cards_for_sale_lines(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale_id,
            &calculation.lines,
        )
        .await?;
        consume_membership_redemption_lines(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale_id,
            &calculation.lines,
        )
        .await?;
        consume_package_redemptions(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale_id,
            &package_redemptions,
        )
        .await?;
        accounting_service::post_benefit_redemption(&mut tx, &tenant_id, &branch_id, &sale_id)
            .await?;
        post_membership_rewards(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale.client_id,
            &sale.staff_id,
            &sale_id,
            sale.total_paise,
        )
        .await?;
    }

    if status != "draft" {
        record_invoice_compliance(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale_id,
            &invoice_type,
            calculation.total_paise,
            &gst_context.seller_gstin,
            &gst_context.buyer_gstin,
            gst_context.reverse_charge,
            calculation
                .lines
                .iter()
                .any(|line| line.line_type == "product"),
        )
        .await?;
    }

    if status != "draft" {
        let queued_deliveries = queue_automatic_invoice_delivery(
            &mut tx,
            &tenant_id,
            &branch_id,
            &sale_id,
            &sale.client_id,
        )
        .await?;
        if queued_deliveries > 0 {
            insert_pos_event(
                &mut tx,
                &tenant_id,
                &branch_id,
                &sale_id,
                "invoice.delivery_auto_queued",
                serde_json::json!({ "queued": queued_deliveries }),
            )
            .await?;
        }
    }
    let appointment_events = if status == "draft" {
        Vec::new()
    } else {
        sync_appointment_billing_tx(&mut tx, &sale, &sale.status).await?
    };

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit pos invoice"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &sale_id, event_type);
    if status != "draft" {
        if let Err(error) = happy_hours_service::scan_coupon_abuse_for_sale(
            &state.db, &tenant_id, &branch_id, &sale_id,
        )
        .await
        {
            tracing::warn!(sale_id = %sale_id, error = ?error, "coupon abuse scan deferred");
        }
    }
    for event in appointment_events {
        let _ = state.appointment_events.send(event);
    }

    let lines = read_lines(state, &tenant_id, &branch_id, &sale_id).await?;
    let client_kpi = read_client_kpi(state, &tenant_id, &branch_id, &sale.client_id).await?;
    let response = sale_response(sale, lines.len() as i64);
    let payment_split = payment_split_response(&payment_rows, response.total_paise);
    let transaction_context =
        read_pos_transaction_context(state, &tenant_id, &branch_id, &sale_id).await?;
    tracing::info!(
        target: "pos.checkout",
        tenant_id = %tenant_id,
        branch_id = %branch_id,
        sale_id = %sale_id,
        status = %response.status,
        checkout_duration_ms = checkout_started.elapsed().as_millis() as u64,
        "POS checkout completed"
    );
    Ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments: payment_rows,
        payment_split,
        client_kpi,
        transaction_context,
    })
}

pub(crate) async fn replace_pos_invoice_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let existing = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if existing.status != "draft" {
        return Err(AppError::validation("only held invoices can be updated"));
    }
    let existing_context =
        read_pos_transaction_context(&state, &tenant_id, &branch_id, &id).await?;
    let expected_cart_version = payload
        .cart_version
        .unwrap_or(existing_context.cart_version);
    if payload.discount_reason.is_none() {
        payload.discount_reason = Some(existing_context.discount_reason.clone());
    }
    if payload.buyer_gstin.is_none() {
        payload.buyer_gstin = Some(existing_context.buyer_gstin.clone());
    }
    if payload.place_of_supply_state_code.is_none() {
        payload.place_of_supply_state_code =
            Some(existing_context.place_of_supply_state_code.clone());
    }
    if payload.reverse_charge.is_none() {
        payload.reverse_charge = Some(existing_context.reverse_charge);
    }
    if payload.separate_group_invoice.is_none() {
        payload.separate_group_invoice = Some(existing_context.separate_group_invoice);
    }
    let discount_reason = validated_discount_reason(&payload)?;
    let cart_owner_terminal_id = payload
        .terminal_id
        .as_deref()
        .filter(|terminal_id| !terminal_id.trim().is_empty())
        .unwrap_or(&existing_context.cart_owner_terminal_id)
        .trim()
        .to_string();
    if existing.source == "appointment" {
        payload.source = Some(existing.source.clone());
        payload.reference_id = Some(existing.reference_id.clone());
    }
    hydrate_appointment_booked_prices(&state, &tenant_id, &branch_id, &mut payload).await?;
    hydrate_pos_tax_metadata(&state, &tenant_id, &branch_id, &mut payload).await?;
    resolve_coupon_discount(&state, &tenant_id, &branch_id, &mut payload).await?;
    let gst_context = gst_context_from_payload(&state, &tenant_id, &branch_id, &payload).await?;
    let package_redemptions = normalize_package_redemptions(
        payload
            .package_redemptions
            .take()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )?;
    let mut calculation = calculate_pos(&payload)?;
    if apply_membership_benefits(&state, &tenant_id, &branch_id, &mut payload, &calculation).await?
    {
        calculation = calculate_pos(&payload)?;
    }
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    let existing_tip_splits = sqlx::query_scalar::<_, Value>(
        "SELECT tip_splits FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice tip splits"))?;
    let tip_splits = normalize_tip_splits(
        payload.tip_splits.take().unwrap_or(existing_tip_splits),
        calculation.tip_paise,
    )?;
    enforce_discount_rules(
        &state,
        &tenant_id,
        &branch_id,
        &calculation,
        claims.max_discount_paise,
    )
    .await?;
    let force_unpaid = payload.force_unpaid.unwrap_or(false);
    let wallet_credit_paise = if force_unpaid {
        0
    } else {
        payload.wallet_credit_paise.unwrap_or(0)
    };
    let (paid, prepared_payments) = prepare_checkout_payments(
        payload.payments.take(),
        calculation.total_paise,
        wallet_credit_paise,
        force_unpaid,
    )?;
    if wallet_credit_paise > 0 {
        return Err(AppError::validation(
            "client advance can only be applied when finalizing an invoice",
        ));
    }
    validate_active_payment_modes(&state, &tenant_id, &branch_id, &prepared_payments).await?;

    let client_id = payload
        .client_id
        .or(payload.customer_id)
        .unwrap_or_default();
    let staff_id = payload.staff_id.unwrap_or_default();
    let source = if existing.source == "appointment" {
        existing.source.clone()
    } else {
        normalize_pos_source(payload.source)
    };
    let reference_id = if existing.source == "appointment" {
        existing.reference_id.clone()
    } else {
        payload.reference_id.unwrap_or_default()
    };
    if source == "appointment" && reference_id.trim().is_empty() {
        return Err(AppError::validation(
            "appointment source requires referenceId",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start draft update transaction"))?;
    if !cart_owner_terminal_id.is_empty() {
        let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_terminals WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='active')")
            .bind(&tenant_id).bind(&branch_id).bind(&cart_owner_terminal_id).fetch_one(&mut *tx).await
            .map_err(|_| AppError::internal("failed to validate POS terminal"))?;
        if !valid {
            return Err(AppError::validation("active POS terminal was not found"));
        }
    }
    let next_cart_version = sqlx::query_scalar::<_, i64>(
        "UPDATE pos_sales SET cart_version=cart_version+1,cart_owner_terminal_id=$5,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='draft' AND cart_version=$4 RETURNING cart_version",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(expected_cart_version)
    .bind(&cart_owner_terminal_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to lock held invoice"))?
    .ok_or_else(|| {
        AppError::conflict("held invoice changed on another device; reload before saving")
    })?;
    let sale = sqlx::query_as::<_, PosSaleRow>(
        "UPDATE pos_sales SET client_id=$4, staff_id=$5, subtotal_paise=$6, bill_discount_paise=$7, coupon_code=$8, coupon_discount_paise=$9, discount_paise=$10, tax_paise=$11, tip_paise=$12, round_off_paise=$13, total_paise=$14, paid_paise=$15, source=$16, reference_id=$17, package_redemptions=$18::jsonb, seller_gstin=$19, seller_state_code=$20, buyer_gstin=$21, place_of_supply_state_code=$22, tax_mode=$23, reverse_charge=$24, cgst_paise=$25, sgst_paise=$26, igst_paise=$27, tip_splits=$28::jsonb, discount_reason=$29, separate_group_invoice=$30, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='draft' RETURNING id, tenant_id, branch_id, client_id, staff_id, invoice_number, subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise, tip_paise, round_off_paise, total_paise, paid_paise, status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at",
    )
    .bind(&id).bind(&tenant_id).bind(&branch_id).bind(client_id.trim()).bind(staff_id.trim())
    .bind(calculation.subtotal_paise).bind(calculation.bill_discount_paise).bind(&calculation.coupon_code).bind(calculation.coupon_discount_paise)
    .bind(calculation.discount_paise).bind(calculation.tax_paise).bind(calculation.tip_paise).bind(calculation.round_off_paise).bind(calculation.total_paise).bind(paid)
    .bind(source).bind(reference_id).bind(&package_redemptions)
    .bind(&gst_context.seller_gstin).bind(&gst_context.seller_state_code).bind(&gst_context.buyer_gstin)
    .bind(&gst_context.place_of_supply_state_code).bind(&gst_context.tax_mode).bind(gst_context.reverse_charge)
    .bind(calculation.cgst_paise).bind(calculation.sgst_paise).bind(calculation.igst_paise)
    .bind(&tip_splits)
    .bind(&discount_reason)
    .bind(payload.separate_group_invoice.unwrap_or(false))
    .fetch_optional(&mut *tx).await.map_err(|_| AppError::internal("failed to update held invoice"))?
    .ok_or_else(|| AppError::not_found("held invoice was not found"))?;

    sqlx::query("DELETE FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to replace held invoice lines"))?;
    for line in calculation.lines {
        insert_calculated_line(
            &mut tx,
            &tenant_id,
            &branch_id,
            &id,
            &uuid::Uuid::new_v4().to_string(),
            line,
        )
        .await?;
    }
    sqlx::query("DELETE FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to replace held invoice payments"))?;
    let payment_rows = insert_pos_payments(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale.client_id,
        &id,
        false,
        "",
        prepared_payments,
    )
    .await?;
    insert_pos_event(&mut tx, &tenant_id, &branch_id, &id, "invoice.draft_updated", serde_json::json!({ "invoiceNumber": sale.invoice_number, "totalPaise": sale.total_paise, "paidPaise": sale.paid_paise, "cartVersion": next_cart_version, "cartOwnerTerminalId": cart_owner_terminal_id, "discountReason": discount_reason })).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit held invoice"))?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "invoice",
        &id,
        "invoice.draft_updated",
    );

    let lines = read_lines(&state, &tenant_id, &branch_id, &id).await?;
    let client_kpi = read_client_kpi(&state, &tenant_id, &branch_id, &sale.client_id).await?;
    let response = sale_response(sale, lines.len() as i64);
    let payment_split = payment_split_response(&payment_rows, response.total_paise);
    let transaction_context =
        read_pos_transaction_context(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments: payment_rows,
        payment_split,
        client_kpi,
        transaction_context,
    })))
}

fn prepare_pos_payments(
    payments: Option<Vec<PosPaymentInput>>,
    total_paise: i64,
    wallet_credit_paise: i64,
) -> Result<(i64, Vec<PreparedPayment>), AppError> {
    if wallet_credit_paise < 0 {
        return Err(AppError::validation("walletCreditPaise cannot be negative"));
    }
    let mut paid = 0i64;
    let mut prepared = Vec::new();
    for payment in payments.unwrap_or_default() {
        let paid_at = validate_paid_at(payment.paid_at)?;
        let method = normalize_payment_method(payment.method.or(payment.mode))?;
        let amount = payment
            .amount_paise
            .unwrap_or_else(|| rupees_to_paise(payment.amount.unwrap_or(0.0)))
            .max(0);
        if amount == 0 {
            continue;
        }
        paid = paid.saturating_add(amount);
        prepared.push(PreparedPayment {
            method: method.clone(),
            reference: payment
                .method_reference
                .or(payment.reference)
                .unwrap_or_default(),
            label: payment
                .label
                .unwrap_or_else(|| default_payment_label(&method)),
            amount_paise: amount,
            notes: payment.notes.unwrap_or_default(),
            idempotency_key: payment.idempotency_key.unwrap_or_default(),
            paid_at,
        });
    }
    let expected_advance_paise = paid.saturating_sub(total_paise).max(0);
    if wallet_credit_paise != expected_advance_paise {
        return Err(AppError::validation(
            "walletCreditPaise must equal the collected amount above the invoice total",
        ));
    }
    if wallet_credit_paise > 0 {
        let mut invoice_balance_paise = total_paise;
        for payment in &prepared {
            let invoice_payment_paise = payment.amount_paise.min(invoice_balance_paise);
            let advance_paise = payment.amount_paise - invoice_payment_paise;
            if advance_paise > 0
                && !matches!(
                    payment.method.as_str(),
                    "cash" | "upi" | "card" | "bank_transfer"
                )
            {
                return Err(AppError::validation(
                    "client advance requires cash, UPI, card, or bank transfer",
                ));
            }
            invoice_balance_paise -= invoice_payment_paise;
        }
    }
    Ok((paid.min(total_paise), prepared))
}

fn prepare_checkout_payments(
    payments: Option<Vec<PosPaymentInput>>,
    total_paise: i64,
    wallet_credit_paise: i64,
    force_unpaid: bool,
) -> Result<(i64, Vec<PreparedPayment>), AppError> {
    if force_unpaid {
        return prepare_pos_payments(None, total_paise, 0);
    }
    prepare_pos_payments(payments, total_paise, wallet_credit_paise)
}

#[cfg(test)]
mod pos_advance_payment_tests {
    use super::{
        allocate_booking_advance, allocate_client_due_fifo, prepare_checkout_payments,
        prepare_pos_payments, validate_paid_at, AvailableBookingAdvanceRow, PosPaymentInput,
        PosSalePayload,
    };
    use chrono::{Duration, Utc};

    fn payment(method: &str, amount_paise: i64) -> PosPaymentInput {
        PosPaymentInput {
            method: Some(method.to_string()),
            amount_paise: Some(amount_paise),
            ..PosPaymentInput::default()
        }
    }

    #[test]
    fn external_overpayment_is_split_into_invoice_and_wallet_advance() {
        let (invoice_paid, payments) =
            prepare_pos_payments(Some(vec![payment("cash", 1_500)]), 1_000, 500)
                .expect("allocated advance should be accepted");
        assert_eq!(invoice_paid, 1_000);
        assert_eq!(payments[0].amount_paise, 1_500);
    }

    #[test]
    fn client_due_receipt_allocates_oldest_invoice_first() {
        assert_eq!(
            allocate_client_due_fifo(&[50_000, 20_000], 40_000),
            vec![40_000, 0]
        );
        assert_eq!(
            allocate_client_due_fifo(&[50_000, 20_000], 60_000),
            vec![50_000, 10_000]
        );
    }

    #[test]
    fn unallocated_or_internal_overpayment_is_rejected() {
        assert!(prepare_pos_payments(Some(vec![payment("cash", 1_500)]), 1_000, 0).is_err());
        assert!(prepare_pos_payments(Some(vec![payment("gift_card", 1_500)]), 1_000, 500).is_err());
    }

    #[test]
    fn unpaid_and_partial_payments_do_not_require_wallet_credit() {
        let (unpaid, unpaid_payments) =
            prepare_pos_payments(None, 1_000, 0).expect("unpaid invoice should be accepted");
        assert_eq!(unpaid, 0);
        assert!(unpaid_payments.is_empty());

        let (partial, partial_payments) =
            prepare_pos_payments(Some(vec![payment("cash", 400)]), 1_000, 0)
                .expect("partial payment should be accepted");
        assert_eq!(partial, 400);
        assert_eq!(partial_payments.len(), 1);
    }

    #[test]
    fn force_unpaid_discards_stale_payment_and_wallet_credit_values() {
        let (paid, payments) =
            prepare_checkout_payments(Some(vec![payment("cash", 1_500)]), 1_000, 500, true)
                .expect("force-unpaid checkout should canonicalize payment state");
        assert_eq!(paid, 0);
        assert!(payments.is_empty());
    }

    #[test]
    fn booking_advance_is_capped_without_overallocating_deposits() {
        let advances = vec![
            AvailableBookingAdvanceRow {
                payment_link_id: "deposit-1".to_string(),
                provider: "razorpay".to_string(),
                reference: "pay-1".to_string(),
                available_paise: 700,
                paid_at: None,
                accounted_at_collection: false,
            },
            AvailableBookingAdvanceRow {
                payment_link_id: "deposit-2".to_string(),
                provider: "cashfree".to_string(),
                reference: "pay-2".to_string(),
                available_paise: 800,
                paid_at: None,
                accounted_at_collection: false,
            },
        ];

        let allocations = allocate_booking_advance(advances, 1_000);
        assert_eq!(allocations.len(), 2);
        assert_eq!(allocations[0].amount_paise, 700);
        assert_eq!(allocations[1].amount_paise, 300);
        assert_eq!(
            allocations.iter().map(|row| row.amount_paise).sum::<i64>(),
            1_000
        );
    }
    #[test]
    fn legacy_round_total_names_remain_compatible() {
        for field in ["roundToNearestRupee", "roundTotal", "round_total"] {
            let payload: PosSalePayload =
                serde_json::from_value(serde_json::json!({ (field): true }))
                    .expect("rounding field should deserialize");
            assert_eq!(payload.round_to_nearest_rupee, Some(true));
        }
    }

    #[test]
    fn paid_at_accepts_backdated_values_and_rejects_future_values() {
        assert!(validate_paid_at(Some(Utc::now() - Duration::days(30))).is_ok());
        assert!(validate_paid_at(Some(Utc::now() + Duration::minutes(10))).is_err());
    }
}

async fn validate_active_payment_modes(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payments: &[PreparedPayment],
) -> Result<(), AppError> {
    if payments.is_empty() {
        return Ok(());
    }
    payment_methods_repository::ensure_defaults(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to initialize payment methods"))?;
    let configured = payment_methods_repository::list(&state.db, tenant_id, branch_id, true)
        .await
        .map_err(|_| AppError::internal("failed to validate payment methods"))?;
    for payment in payments {
        let mode = configured
            .iter()
            .find(|mode| mode.code == payment.method)
            .ok_or_else(|| {
                AppError::validation("one or more payment modes are inactive or unavailable")
            })?;
        if mode.reference_required && payment.reference.trim().is_empty() {
            return Err(AppError::validation(
                "payment reference is required for this mode",
            ));
        }
    }
    Ok(())
}

async fn enforce_discount_rules(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    calculation: &PosCalculation,
    max_role_discount_paise: Option<i64>,
) -> Result<(), AppError> {
    if calculation.discount_paise <= 0 {
        return Ok(());
    }
    security_service::enforce_role_limit(
        max_role_discount_paise,
        calculation.discount_paise,
        "discount",
    )?;
    let rules = sqlx::query_as::<_, (String, i64, i64, i64)>(
        r#"
        SELECT rule_type, max_discount_bps, max_discount_paise, min_payable_paise
          FROM pos_discount_rules
         WHERE tenant_id=$1
           AND branch_id=$2
           AND active=TRUE
           AND (starts_at IS NULL OR starts_at <= NOW())
           AND (ends_at IS NULL OR ends_at >= NOW())
         ORDER BY priority ASC, created_at ASC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate discount rules"))?;

    for (rule_type, max_bps, max_paise, min_payable) in rules {
        let label = if rule_type == "happy_hours" {
            "happy-hours"
        } else {
            "profit guard"
        };
        if max_bps > 0 {
            let cap = calculation.subtotal_paise.saturating_mul(max_bps) / 10_000;
            if calculation.discount_paise > cap {
                return Err(AppError::validation(format!(
                    "{label} discount limit exceeded"
                )));
            }
        }
        if max_paise > 0 && calculation.discount_paise > max_paise {
            return Err(AppError::validation(format!(
                "{label} discount amount limit exceeded"
            )));
        }
        if min_payable > 0 && calculation.total_paise < min_payable {
            return Err(AppError::validation(format!(
                "{label} minimum payable amount is not met"
            )));
        }
    }
    Ok(())
}

async fn insert_pos_payments(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    settle_internal: bool,
    requested_till_id: &str,
    payments: Vec<PreparedPayment>,
) -> Result<Vec<PosPaymentResponse>, AppError> {
    if settle_internal && payments.iter().any(|payment| payment.method == "cash") {
        if let Some(till_id) =
            ensure_cash_drawer_open(tx, tenant_id, branch_id, requested_till_id).await?
        {
            sqlx::query("UPDATE pos_sales SET cash_drawer_till_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(tenant_id).bind(branch_id).bind(sale_id).bind(till_id).execute(&mut **tx).await
                .map_err(|_| AppError::internal("failed to assign cash till"))?;
        }
    }
    let mut rows = Vec::with_capacity(payments.len());
    for payment in payments {
        let payment_id = uuid::Uuid::new_v4().to_string();
        let row = sqlx::query_as::<_, PosPaymentRow>("INSERT INTO pos_payments (id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, idempotency_key, paid_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,NOW()),NOW()) RETURNING id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, paid_at, created_at")
            .bind(&payment_id).bind(tenant_id).bind(branch_id).bind(sale_id).bind(&payment.method).bind(payment.amount_paise).bind(&payment.reference).bind(&payment.label).bind(&payment.notes).bind(&payment.idempotency_key)
            .bind(payment.paid_at)
            .fetch_one(&mut **tx).await.map_err(|_| AppError::internal("failed to save invoice payment"))?;
        if settle_internal {
            wallet_service::settle_pos_internal_payment(
                tx,
                tenant_id,
                branch_id,
                client_id,
                sale_id,
                &payment_id,
                &payment.method,
                &payment.reference,
                payment.amount_paise,
            )
            .await?;
        }
        rows.push(payment_response(row));
    }
    Ok(rows)
}

async fn ensure_cash_drawer_open(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    requested_till_id: &str,
) -> Result<Option<String>, AppError> {
    let open = cash_drawer_repository::is_open_for_update(
        tx,
        tenant_id,
        branch_id,
        current_business_date(),
    )
    .await
    .map_err(|_| AppError::internal("failed to validate cash drawer"))?;
    if !open {
        return Err(AppError::validation(
            "an open cash drawer is required before accepting cash payment",
        ));
    }
    let tills = cash_drawer_repository::open_till_ids_for_cash(
        tx,
        tenant_id,
        branch_id,
        current_business_date(),
        requested_till_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to validate cash till"))?;
    if !requested_till_id.trim().is_empty() && tills.is_empty() {
        return Err(AppError::validation("selected cash till is not open"));
    }
    if requested_till_id.trim().is_empty() && tills.len() > 1 {
        return Err(AppError::validation(
            "cashDrawerTillId is required when multiple tills are open",
        ));
    }
    Ok(tills.into_iter().next())
}

/// Patches the mutable fields of a sale.
///
/// Before finalize this is ordinary editing. After it, the same three fields
/// move money: `staff_id` is what tip payout attributes against, and `status`
/// is what decides whether payroll counts the sale at all — so a silent PATCH
/// here paid the wrong person, with nothing in the audit trail to show it
/// happened. Every other post-finalize change to an invoice already demands a
/// reason and leaves a record; this path did not, and no screen calls it, which
/// is what let it stay that way.
///
/// So after finalize: status changes belong to void, refund or credit note,
/// where the approval and reversal logic lives, and the reconciliation
/// references are frozen. Re-attribution stays possible, because tagging the
/// wrong therapist is a real mistake that has to be correctable — but it costs
/// a permission, a reason and an audit row, and it stops once the tip has
/// actually been paid, since money that has left cannot be moved by an UPDATE.
async fn update_pos_sale(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosSaleUpdate>,
) -> ApiResult<PosSaleResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let existing = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;

    let requested_staff_id = payload
        .staff_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let reattributing = !requested_staff_id.is_empty() && requested_staff_id != existing.staff_id;
    let reason = payload.reason.as_deref().unwrap_or("").trim().to_string();

    if existing.finalized_at.is_some() {
        refuse_frozen_finalized_fields(&payload)?;
        if reattributing {
            require_pos_permission(&claims, "pos.manage")?;
            require_lifecycle_reason(&reason, "staff re-attribution")?;
            let tip_paid = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM staff_tip_payout_items WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
            )
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(&id)
            .fetch_one(&state.db)
            .await
            .map_err(|_| AppError::internal("failed to check tip payouts for this invoice"))?;
            if tip_paid > 0 {
                return Err(AppError::conflict(
                    "the tip on this invoice has already been paid out; correct it through payroll rather than re-attributing the sale",
                ));
            }
        }
    }

    let sale = sqlx::query_as::<_, PosSaleRow>(
        r#"
        UPDATE pos_sales
           SET status = COALESCE($4, status),
               staff_id = COALESCE(NULLIF($5, ''), staff_id),
               source = COALESCE(NULLIF($6, ''), source),
               reference_id = COALESCE(NULLIF($7, ''), reference_id),
               updated_at = NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        RETURNING id, tenant_id, branch_id, client_id, staff_id, invoice_number,
                   subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
                   tip_paise, round_off_paise, total_paise, paid_paise,
                   status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(payload.status)
    .bind(payload.staff_id.unwrap_or_default())
    .bind(payload.source.unwrap_or_default())
    .bind(payload.reference_id.unwrap_or_default())
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to update pos sale"))?
    .ok_or_else(|| AppError::not_found("pos sale was not found"))?;

    // Recorded on drafts too. Attribution is the thing people dispute months
    // later, and "who changed it and when" is worth more then than the small
    // cost of a row now.
    if reattributing {
        security_service::record_audit(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
            "pos.sale.staff_reattributed",
            serde_json::json!({
                "saleId": sale.id,
                "invoiceNumber": sale.invoice_number,
                "fromStaffId": existing.staff_id,
                "toStaffId": sale.staff_id,
                "finalized": existing.finalized_at.is_some(),
                "reason": reason,
            }),
        )
        .await?;
    }

    let line_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(ApiResponse::ok(sale_response(sale, line_count))))
}

fn has_pos_permission(claims: &AuthClaims, permission: &str) -> bool {
    if claims
        .denied_permissions
        .iter()
        .any(|denied| denied == permission)
    {
        return false;
    }
    matches!(
        claims.role.to_ascii_lowercase().as_str(),
        "owner" | "admin" | "super_admin" | "platform_admin"
    ) || claims
        .permissions
        .iter()
        .any(|granted| granted == permission)
}

fn require_pos_permission(claims: &AuthClaims, permission: &str) -> Result<(), AppError> {
    if has_pos_permission(claims, permission) {
        Ok(())
    } else {
        Err(AppError::forbidden(format!(
            "{} permission is required",
            permission
        )))
    }
}

async fn request_pos_invoice_delete(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceDeleteRequestPayload>,
) -> ApiResult<InvoiceDeleteRequestRow> {
    require_pos_permission(&claims, "pos.manage")?;
    let reason = payload.reason.trim().to_string();
    require_lifecycle_reason(&reason, "delete request")?;
    if reason.chars().count() > 500 {
        return Err(AppError::validation(
            "delete reason cannot exceed 500 characters",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start invoice delete request"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    let is_deleted: bool = sqlx::query_scalar(
        "SELECT is_deleted FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to inspect invoice delete state"))?;
    if is_deleted {
        return Err(AppError::conflict("invoice is already soft-deleted"));
    }
    if !matches!(sale.status.as_str(), "draft" | "open") || sale.paid_paise > 0 {
        return Err(AppError::validation(
            "paid or finalized invoice deletion is blocked; use refund, credit note, or void",
        ));
    }

    if let Some(existing) = sqlx::query_as::<_, InvoiceDeleteRequestRow>(
        "SELECT id,sale_id,invoice_number,reason,status,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at FROM pos_invoice_delete_requests WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND status='pending'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to inspect invoice delete requests"))?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish invoice delete request"))?;
        return Ok(Json(ApiResponse::ok(existing)));
    }

    let snapshot = serde_json::json!({
        "invoiceNumber": sale.invoice_number,
        "status": sale.status,
        "totalPaise": sale.total_paise,
        "paidPaise": sale.paid_paise,
        "clientId": sale.client_id,
        "staffId": sale.staff_id,
        "finalizedAt": sale.finalized_at,
    });
    let request = sqlx::query_as::<_, InvoiceDeleteRequestRow>(
        "INSERT INTO pos_invoice_delete_requests (tenant_id,branch_id,sale_id,invoice_number,reason,invoice_snapshot,requested_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,sale_id,invoice_number,reason,status,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(&sale.invoice_number)
    .bind(&reason)
    .bind(snapshot)
    .bind(&claims.sub)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::conflict("an invoice delete request is already pending"))?;
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        "invoice.delete_requested",
        serde_json::json!({
            "requestId": request.id,
            "invoiceNumber": request.invoice_number,
            "reason": request.reason,
        }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice delete request"))?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "invoice",
        &id,
        "invoice.delete_requested",
    );
    Ok(Json(ApiResponse::ok(request)))
}

async fn list_pos_invoice_delete_requests(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<InvoiceDeleteRequestQuery>,
) -> ApiResult<Vec<InvoiceDeleteRequestRow>> {
    require_pos_permission(&claims, "pos.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let status = query
        .status
        .unwrap_or_else(|| "pending".to_string())
        .trim()
        .to_ascii_lowercase();
    if !matches!(status.as_str(), "pending" | "approved" | "rejected" | "all") {
        return Err(AppError::validation(
            "status must be pending, approved, rejected, or all",
        ));
    }
    let sale_id = query.sale_id.unwrap_or_default().trim().to_string();
    let rows = sqlx::query_as::<_, InvoiceDeleteRequestRow>(
        "SELECT id,sale_id,invoice_number,reason,status,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at FROM pos_invoice_delete_requests WHERE tenant_id=$1 AND branch_id=$2 AND ($3='all' OR status=$3) AND ($4='' OR sale_id=$4) ORDER BY requested_at DESC LIMIT 200",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&status)
    .bind(&sale_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice delete requests"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn decide_pos_invoice_delete(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<InvoiceDeleteDecisionPayload>,
) -> ApiResult<InvoiceDeleteRequestRow> {
    require_pos_permission(&claims, "pos.void")?;
    let decision = payload.status.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision status must be approved or rejected",
        ));
    }
    let decision_note = payload.decision_note.unwrap_or_default().trim().to_string();
    if decision_note.chars().count() > 500 {
        return Err(AppError::validation(
            "decision note cannot exceed 500 characters",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start invoice delete decision"))?;
    let request = sqlx::query_as::<_, InvoiceDeleteRequestRow>(
        "SELECT id,sale_id,invoice_number,reason,status,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at FROM pos_invoice_delete_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to load invoice delete request"))?
    .ok_or_else(|| AppError::not_found("invoice delete request was not found"))?;
    if request.status != "pending" {
        return Err(AppError::conflict(
            "invoice delete request was already decided",
        ));
    }
    if request.requested_by_user_id == claims.sub {
        return Err(AppError::forbidden(
            "requester cannot approve or reject their own invoice delete request",
        ));
    }

    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &request.sale_id).await?;
    if decision == "approved" {
        let is_deleted: bool = sqlx::query_scalar(
            "SELECT is_deleted FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&request.sale_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to inspect invoice delete state"))?;
        if is_deleted {
            return Err(AppError::conflict("invoice is already soft-deleted"));
        }
        if !matches!(sale.status.as_str(), "draft" | "open") || sale.paid_paise > 0 {
            return Err(AppError::validation(
                "invoice changed after the request; paid or finalized invoices cannot be deleted",
            ));
        }
        sqlx::query(
            "UPDATE pos_sales SET status='cancelled',is_deleted=TRUE,deleted_at=NOW(),deleted_by_user_id=$4,delete_reason=$5,locked_at=COALESCE(locked_at,NOW()),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&request.sale_id)
        .bind(&claims.sub)
        .bind(&request.reason)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to soft-delete invoice"))?;
        reverse_happy_hour_lock(&mut tx, &tenant_id, &branch_id, &request.sale_id, i64::MAX)
            .await?;
    }

    let decided = sqlx::query_as::<_, InvoiceDeleteRequestRow>(
        "UPDATE pos_invoice_delete_requests SET status=$4,decided_by_user_id=$5,decision_note=$6,decided_at=NOW(),applied_at=CASE WHEN $4='approved' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' RETURNING id,sale_id,invoice_number,reason,status,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&request_id)
    .bind(&decision)
    .bind(&claims.sub)
    .bind(&decision_note)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to save invoice delete decision"))?
    .ok_or_else(|| AppError::conflict("invoice delete request was already decided"))?;
    let event_type = if decision == "approved" {
        "invoice.soft_deleted"
    } else {
        "invoice.delete_rejected"
    };
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &request.sale_id,
        &claims.sub,
        event_type,
        serde_json::json!({
            "requestId": request.id,
            "invoiceNumber": request.invoice_number,
            "requestReason": request.reason,
            "decisionNote": decision_note,
        }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice delete decision"))?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "invoice",
        &request.sale_id,
        event_type,
    );
    Ok(Json(ApiResponse::ok(decided)))
}

async fn list_pos_invoice_correction_requests(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<InvoiceCorrectionRequestRow>> {
    require_pos_permission(&claims, "pos.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, InvoiceCorrectionRequestRow>(
        "SELECT id,sale_id,invoice_number,reason,status,original_snapshot,proposed_lines,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at FROM pos_invoice_correction_requests WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY requested_at DESC LIMIT 20",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load invoice correction requests"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn request_pos_invoice_correction(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceCorrectionRequestPayload>,
) -> ApiResult<InvoiceCorrectionRequestRow> {
    require_pos_permission(&claims, "pos.manage")?;
    let reason = payload.reason.trim().to_string();
    require_lifecycle_reason(&reason, "invoice correction")?;
    if reason.chars().count() > 500 {
        return Err(AppError::validation(
            "invoice correction reason cannot exceed 500 characters",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start invoice correction request"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    validate_invoice_correction_window(&mut tx, &tenant_id, &branch_id, &sale).await?;
    let (lines, _) = calculate_invoice_correction(
        &state,
        &tenant_id,
        &branch_id,
        &sale,
        &payload.lines,
        claims.max_discount_paise,
    )
    .await?;
    let snapshot = invoice_correction_snapshot(&sale, &lines);
    let proposed_lines = serde_json::to_value(&payload.lines)
        .map_err(|_| AppError::validation("invoice correction lines are invalid"))?;
    let request = sqlx::query_as::<_, InvoiceCorrectionRequestRow>(
        "INSERT INTO pos_invoice_correction_requests (tenant_id,branch_id,sale_id,invoice_number,reason,original_snapshot,proposed_lines,requested_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,sale_id,invoice_number,reason,status,original_snapshot,proposed_lines,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(&sale.invoice_number)
    .bind(&reason)
    .bind(&snapshot)
    .bind(&proposed_lines)
    .bind(&claims.sub)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::conflict("an invoice correction request is already pending"))?;
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        "invoice.correction_requested",
        serde_json::json!({ "requestId": request.id, "reason": reason }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice correction request"))?;
    state.publish_pos_event(
        &tenant_id,
        &branch_id,
        "invoice",
        &id,
        "invoice.correction_requested",
    );
    Ok(Json(ApiResponse::ok(request)))
}

async fn decide_pos_invoice_correction(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<InvoiceCorrectionDecisionPayload>,
) -> ApiResult<InvoiceCorrectionRequestRow> {
    require_pos_permission(&claims, "pos.void")?;
    let decision = payload.status.trim().to_ascii_lowercase();
    if !matches!(decision.as_str(), "approved" | "rejected") {
        return Err(AppError::validation(
            "decision status must be approved or rejected",
        ));
    }
    let decision_note = payload.decision_note.unwrap_or_default().trim().to_string();
    if decision == "rejected" && decision_note.chars().count() < 3 {
        return Err(AppError::validation(
            "rejection reason must contain at least 3 characters",
        ));
    }
    if decision_note.chars().count() > 500 {
        return Err(AppError::validation(
            "decision note cannot exceed 500 characters",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start invoice correction decision"))?;
    let request = sqlx::query_as::<_, InvoiceCorrectionRequestRow>(
        "SELECT id,sale_id,invoice_number,reason,status,original_snapshot,proposed_lines,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at FROM pos_invoice_correction_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&request_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to load invoice correction request"))?
    .ok_or_else(|| AppError::not_found("invoice correction request was not found"))?;
    if request.status != "pending" {
        return Err(AppError::conflict(
            "invoice correction request was already decided",
        ));
    }
    if request.requested_by_user_id == claims.sub {
        return Err(AppError::forbidden(
            "requester cannot approve or reject their own invoice correction",
        ));
    }
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &request.sale_id).await?;
    if decision == "approved" {
        let business_date =
            validate_invoice_correction_window(&mut tx, &tenant_id, &branch_id, &sale).await?;
        let proposed: Vec<InvoiceCorrectionLinePayload> =
            serde_json::from_value(request.proposed_lines.clone())
                .map_err(|_| AppError::internal("stored invoice correction is invalid"))?;
        let (lines, calculation) = calculate_invoice_correction(
            &state,
            &tenant_id,
            &branch_id,
            &sale,
            &proposed,
            claims.max_discount_paise,
        )
        .await?;
        if invoice_correction_snapshot(&sale, &lines) != request.original_snapshot {
            return Err(AppError::conflict(
                "invoice changed after this correction was requested",
            ));
        }
        let old_gst =
            read_gst_totals_for_sale_tx(&mut tx, &tenant_id, &branch_id, &sale.id).await?;
        apply_invoice_correction_lines(&mut tx, &tenant_id, &branch_id, &lines, &calculation.lines)
            .await?;
        accounting_service::post_invoice_correction(
            &mut tx,
            &tenant_id,
            &branch_id,
            &request.id,
            business_date,
            &claims.sub,
            invoice_accounting_totals_from_sale(&sale, old_gst),
            invoice_accounting_totals_from_calculation(&calculation),
        )
        .await?;
        sqlx::query(
            "UPDATE pos_sales SET subtotal_paise=$4,bill_discount_paise=$5,coupon_code=$6,coupon_discount_paise=$7,discount_paise=$8,tax_paise=$9,cgst_paise=$10,sgst_paise=$11,igst_paise=$12,tip_paise=$13,round_off_paise=$14,total_paise=$15,status='open',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&sale.id)
        .bind(calculation.subtotal_paise)
        .bind(calculation.bill_discount_paise)
        .bind(&calculation.coupon_code)
        .bind(calculation.coupon_discount_paise)
        .bind(calculation.discount_paise)
        .bind(calculation.tax_paise)
        .bind(calculation.cgst_paise)
        .bind(calculation.sgst_paise)
        .bind(calculation.igst_paise)
        .bind(calculation.tip_paise)
        .bind(calculation.round_off_paise)
        .bind(calculation.total_paise)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to apply invoice correction totals"))?;
        sqlx::query("DELETE FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3")
            .bind(&tenant_id).bind(&branch_id).bind(&sale.id).execute(&mut *tx).await
            .map_err(|_| AppError::internal("failed to refresh invoice commissions"))?;
        pos_enterprise_repository::snapshot_staff_commissions(
            &mut tx, &tenant_id, &branch_id, &sale.id,
        )
        .await
        .map_err(|_| AppError::internal("failed to refresh invoice commissions"))?;
    }
    let decided = sqlx::query_as::<_, InvoiceCorrectionRequestRow>(
        "UPDATE pos_invoice_correction_requests SET status=$4,decided_by_user_id=$5,decision_note=$6,decided_at=NOW(),applied_at=CASE WHEN $4='approved' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' RETURNING id,sale_id,invoice_number,reason,status,original_snapshot,proposed_lines,requested_by_user_id,decided_by_user_id,decision_note,requested_at,decided_at,applied_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&request.id)
    .bind(&decision)
    .bind(&claims.sub)
    .bind(&decision_note)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to save invoice correction decision"))?
    .ok_or_else(|| AppError::conflict("invoice correction request was already decided"))?;
    let event_type = if decision == "approved" {
        "invoice.correction_applied"
    } else {
        "invoice.correction_rejected"
    };
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale.id,
        &claims.sub,
        event_type,
        serde_json::json!({
            "requestId": request.id,
            "reason": request.reason,
            "decisionNote": decision_note,
        }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice correction decision"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &sale.id, event_type);
    Ok(Json(ApiResponse::ok(decided)))
}

async fn validate_invoice_correction_window(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale: &PosSaleRow,
) -> Result<NaiveDate, AppError> {
    if sale.status != "open" || sale.paid_paise != 0 || sale.finalized_at.is_none() {
        return Err(AppError::validation(
            "only an unpaid saved invoice can be corrected; use return or credit note after payment",
        ));
    }
    let (business_date, today, locked) = sqlx::query_as::<_, (NaiveDate, NaiveDate, bool)>(
        "SELECT ps.business_date,CURRENT_DATE,EXISTS(SELECT 1 FROM pos_day_locks lock WHERE lock.tenant_id=ps.tenant_id AND lock.branch_id=ps.branch_id AND lock.business_date=ps.business_date AND lock.status='locked') FROM pos_sales ps WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ps.id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&sale.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to validate invoice correction period"))?
    .ok_or_else(|| AppError::not_found("pos invoice was not found"))?;
    if locked || business_date != today {
        return Err(AppError::validation(
            "closed-day invoices are immutable; use a credit note and corrected invoice",
        ));
    }
    Ok(business_date)
}

async fn calculate_invoice_correction(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale: &PosSaleRow,
    proposed: &[InvoiceCorrectionLinePayload],
    max_discount_paise: Option<i64>,
) -> Result<(Vec<PosLineRow>, PosCalculation), AppError> {
    let lines = read_line_rows(state, tenant_id, branch_id, &sale.id).await?;
    if lines.is_empty() || lines.len() != proposed.len() || lines.len() > 100 {
        return Err(AppError::validation(
            "invoice correction must contain every existing invoice line",
        ));
    }
    if lines
        .iter()
        .any(|line| !matches!(line.line_type.as_str(), "service" | "product"))
    {
        return Err(AppError::validation(
            "membership, package, gift-card, and redemption invoices require a credit note",
        ));
    }
    let proposed = proposed
        .iter()
        .map(|line| (line.id.trim().to_string(), line))
        .collect::<HashMap<_, _>>();
    if proposed.len() != lines.len() {
        return Err(AppError::validation(
            "invoice correction line ids must be unique",
        ));
    }
    let mut drafts = Vec::with_capacity(lines.len());
    for line in &lines {
        let correction = proposed
            .get(&line.id)
            .ok_or_else(|| AppError::validation("invoice correction line was not found"))?;
        if correction.unit_price_paise < 0 || correction.discount_value_paise < 0 {
            return Err(AppError::validation(
                "invoice correction amounts cannot be negative",
            ));
        }
        let discount_type = correction.discount_type.trim().to_ascii_lowercase();
        if !matches!(discount_type.as_str(), "none" | "amount" | "percent")
            || !(0..=10_000).contains(&correction.discount_bps)
        {
            return Err(AppError::validation(
                "invoice correction discount is invalid",
            ));
        }
        let mut input = line_input_from_row(line);
        input.unit_price_paise = Some(correction.unit_price_paise);
        input.discount_type = Some(discount_type.clone());
        input.discount_amount_paise =
            (discount_type == "amount").then_some(correction.discount_value_paise);
        input.discount_value =
            (discount_type == "percent").then_some(correction.discount_bps as f64 / 100.0);
        input.discount_paise = None;
        drafts.push(LineDraft {
            id: Some(line.id.clone()),
            input,
        });
    }
    let mut payload = line_payload_for_recalc(sale, &drafts);
    resolve_coupon_discount(state, tenant_id, branch_id, &mut payload).await?;
    let gst_context = gst_context_from_sale(state, tenant_id, branch_id, &sale.id).await?;
    let mut calculation = calculate_pos(&payload)?;
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(
        state,
        tenant_id,
        branch_id,
        &calculation,
        max_discount_paise,
    )
    .await?;
    Ok((lines, calculation))
}

fn invoice_correction_snapshot(sale: &PosSaleRow, lines: &[PosLineRow]) -> Value {
    serde_json::json!({
        "saleUpdatedAt": sale.updated_at,
        "totalPaise": sale.total_paise,
        "lines": lines.iter().map(|line| serde_json::json!({
            "id": line.id,
            "quantity": line.quantity,
            "unitPricePaise": line.unit_price_paise,
            "discountType": line.discount_type,
            "discountValuePaise": line.discount_value_paise,
            "discountBps": line.discount_bps,
            "taxPercent": line.tax_percent,
        })).collect::<Vec<_>>()
    })
}

async fn apply_invoice_correction_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    old_lines: &[PosLineRow],
    new_lines: &[CalculatedLine],
) -> Result<(), AppError> {
    for (old, new) in old_lines.iter().zip(new_lines) {
        sqlx::query("UPDATE pos_sale_lines SET unit_price_paise=$5,gross_paise=$6,taxable_paise=$7,discount_paise=$8,discount_type=$9,discount_value_paise=$10,discount_bps=$11,gst_paise=$12,cgst_paise=$13,sgst_paise=$14,igst_paise=$15,reverse_charge=$16,line_total_paise=$17,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND id=$4")
            .bind(tenant_id).bind(branch_id).bind(&old.sale_id).bind(&old.id)
            .bind(new.unit_price_paise).bind(new.gross_paise).bind(new.taxable_paise)
            .bind(new.discount_paise).bind(&new.discount_type).bind(new.discount_value_paise)
            .bind(new.discount_bps).bind(new.gst_paise).bind(new.cgst_paise).bind(new.sgst_paise)
            .bind(new.igst_paise).bind(new.reverse_charge).bind(new.line_total_paise)
            .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to apply invoice line correction"))?;
    }
    Ok(())
}

fn invoice_accounting_totals_from_sale(
    sale: &PosSaleRow,
    gst: (i64, i64, i64),
) -> accounting_service::InvoiceAccountingTotals {
    accounting_service::InvoiceAccountingTotals {
        total_paise: sale.total_paise,
        tax_paise: sale.tax_paise,
        cgst_paise: gst.0,
        sgst_paise: gst.1,
        igst_paise: gst.2,
        tip_paise: sale.tip_paise,
        round_off_paise: sale.round_off_paise,
    }
}

fn invoice_accounting_totals_from_calculation(
    calculation: &PosCalculation,
) -> accounting_service::InvoiceAccountingTotals {
    accounting_service::InvoiceAccountingTotals {
        total_paise: calculation.total_paise,
        tax_paise: calculation.tax_paise,
        cgst_paise: calculation.cgst_paise,
        sgst_paise: calculation.sgst_paise,
        igst_paise: calculation.igst_paise,
        tip_paise: calculation.tip_paise,
        round_off_paise: calculation.round_off_paise,
    }
}

async fn delete_pos_sale(Path(_id): Path<String>) -> ApiResult<Value> {
    Err(AppError::validation(
        "direct invoice deletion is blocked; create an invoice delete request",
    ))
}
async fn create_pos_payment_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosPaymentLinkRequest>,
) -> ApiResult<PosPaymentLinkResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let payment_link =
        create_payment_link_for_invoice(&state, &tenant_id, &branch_id, &id, payload).await?;
    Ok(Json(ApiResponse::ok(payment_link)))
}

pub(crate) async fn create_payment_link_for_invoice(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    payload: PosPaymentLinkRequest,
) -> Result<PosPaymentLinkResponse, AppError> {
    let provider = payload
        .provider
        .as_deref()
        .unwrap_or("razorpay")
        .trim()
        .to_ascii_lowercase();
    if !matches!(provider.as_str(), "razorpay" | "cashfree" | "phonepe") {
        return Err(AppError::validation(
            "provider must be razorpay, cashfree, or phonepe",
        ));
    }
    if !payment_gateway_service::provider_enabled_for_branch(
        &state.db,
        &state.settings,
        tenant_id,
        branch_id,
        &provider,
    )
    .await?
        || !state
            .settings
            .payment_provider_webhook_configured(&provider)
    {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            format!("{provider} credentials and signed webhook must be configured"),
        ));
    }
    let idempotency_key = payload
        .idempotency_key
        .unwrap_or_default()
        .trim()
        .to_string();
    if idempotency_key.is_empty() {
        return Err(AppError::validation(
            "idempotencyKey is required when creating an online payment link",
        ));
    }
    if let Some(expires_at) = payload.expires_at.as_ref() {
        if *expires_at <= Utc::now() {
            return Err(AppError::validation("expiresAt must be in the future"));
        }
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payment link transaction"))?;
    if let Some(existing) =
        read_payment_link_by_idempotency(&mut tx, tenant_id, branch_id, &idempotency_key).await?
    {
        if existing.sale_id != id {
            return Err(AppError::conflict(
                "idempotencyKey is already used by a different invoice",
            ));
        }
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate payment link request"))?;
        return Ok(payment_link_response(existing));
    }

    let sale_query = format!(
        "{} WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 FOR UPDATE",
        sale_select_sql()
    );
    let sale = sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(&id)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to validate pos invoice"))?
        .ok_or_else(|| AppError::not_found("pos invoice was not found"))?;
    if sale.finalized_at.is_none() || sale.status == "draft" {
        return Err(AppError::validation(
            "online payment links require a finalized invoice",
        ));
    }
    if matches!(sale.status.as_str(), "paid" | "voided" | "cancelled") {
        return Err(AppError::validation(
            "online payment links cannot be created for this invoice status",
        ));
    }
    let balance_paise = sale.total_paise.saturating_sub(sale.paid_paise);
    let amount_paise = payload.amount_paise.unwrap_or(balance_paise);
    if amount_paise <= 0 || amount_paise > balance_paise {
        return Err(AppError::validation(
            "amountPaise must be greater than zero and no more than the invoice balance",
        ));
    }

    let link_id = uuid::Uuid::new_v4().to_string();
    let provider_reference = format!("pl_{}", uuid::Uuid::new_v4().simple());
    let inserted = sqlx::query_as::<_, PosPaymentLinkRow>(
        r#"
        INSERT INTO pos_payment_links (
            id, tenant_id, branch_id, sale_id, provider, provider_reference,
            amount_paise, status, expires_at, idempotency_key, payload_json, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,'{}'::jsonb,NOW())
        ON CONFLICT DO NOTHING
        RETURNING id, sale_id, provider, provider_link_id,
                  provider_reference, amount_paise, status, link_url, expires_at, created_at, updated_at
        "#,
    )
    .bind(&link_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(&provider)
    .bind(&provider_reference)
    .bind(amount_paise)
    .bind(payload.expires_at.clone())
    .bind(&idempotency_key)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to reserve payment link"))?;
    let inserted = match inserted {
        Some(link) => link,
        None => {
            let existing =
                read_payment_link_by_idempotency(&mut tx, tenant_id, branch_id, &idempotency_key)
                    .await?;
            tx.rollback().await.map_err(|_| {
                AppError::internal("failed to finish duplicate payment link request")
            })?;
            return existing
                .map(payment_link_response)
                .ok_or_else(|| AppError::conflict("payment link reservation already exists"));
        }
    };
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to reserve payment link"))?;

    let customer = sqlx::query_as::<_, (String, String, String)>(
        "SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ',first_name,NULLIF(middle_name,''),NULLIF(last_name,''))),''),'Customer'),phone,email FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&sale.client_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment-link client"))?
    .unwrap_or_else(|| ("Customer".to_string(), String::new(), String::new()));

    let provider_link = payment_gateway_service::create_payment_link(
        &state.settings,
        &provider,
        payment_gateway_service::CreatePaymentLink {
            reference_id: provider_reference,
            amount_paise,
            description: format!("Invoice {}", sale.invoice_number),
            expires_at: payload.expires_at,
            notes: serde_json::json!({
                "localPaymentLinkId": link_id,
                "saleId": id,
                "tenantId": tenant_id,
                "branchId": branch_id,
            }),
            customer_name: customer.0,
            customer_phone: customer.1,
            customer_email: customer.2,
        },
    )
    .await;

    let provider_link = match provider_link {
        Ok(link) => link,
        Err(error) => {
            let _ = sqlx::query(
                "UPDATE pos_payment_links SET status='failed', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&inserted.id)
            .execute(&state.db)
            .await;
            return Err(error);
        }
    };
    let provider_payload = provider_link.payload.to_string();
    let updated = sqlx::query_as::<_, PosPaymentLinkRow>(
        r#"
        UPDATE pos_payment_links
           SET provider_link_id=$4, link_url=$5, payload_json=$6::jsonb, updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        RETURNING id, sale_id, provider, provider_link_id,
                  provider_reference, amount_paise, status, link_url, expires_at, created_at, updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&inserted.id)
    .bind(&provider_link.provider_link_id)
    .bind(&provider_link.short_url)
    .bind(provider_payload)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to save provider payment link"))?;

    // One invoice, one working link. An older URL sitting in a chat thread must
    // not keep taking payments after the amount has been revised.
    payment_link_access_service::supersede_other_links(
        &state.db,
        tenant_id,
        branch_id,
        id,
        &updated.id,
    )
    .await?;

    // The guest is sent our token rather than the provider URL, so a forwarded
    // link is useless to whoever it reaches and every open is recorded.
    let require_verification = security_service::get_policy(&state.db, tenant_id, branch_id)
        .await?
        .settings
        .payment_link_phone_verification;
    let access_token = payment_link_access_service::issue_access_token(
        &state.db,
        tenant_id,
        branch_id,
        &updated.id,
        require_verification,
    )
    .await?;

    let mut response = payment_link_response(updated);
    response.guest_link_token = access_token;
    Ok(response)
}

async fn list_pos_payment_links(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<PosPaymentLinkResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, PosPaymentLinkRow>(
        "SELECT link.id, link.sale_id, link.provider, link.provider_link_id, link.provider_reference, link.amount_paise, link.status, link.link_url, link.expires_at, link.created_at, link.updated_at FROM pos_payment_links link INNER JOIN pos_sales sale ON sale.id=link.sale_id AND sale.tenant_id=link.tenant_id AND sale.branch_id=link.branch_id WHERE link.tenant_id=$1 AND link.branch_id=$2 AND link.sale_id=$3 ORDER BY link.created_at DESC LIMIT 50",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list invoice payment links"))?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(payment_link_response).collect(),
    )))
}

async fn list_invoice_payment_instruments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<ClientPaymentInstrumentResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, ClientPaymentInstrumentResponse>(
        r#"
        SELECT instrument.id, instrument.provider, instrument.method_type, instrument.brand,
               instrument.last4, instrument.expiry_month, instrument.expiry_year,
               instrument.recurring_enabled, instrument.status, instrument.last_used_at
          FROM client_payment_instruments instrument
          JOIN pos_sales sale
            ON sale.tenant_id=instrument.tenant_id
           AND sale.branch_id=instrument.branch_id
           AND sale.client_id=instrument.client_id
         WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$3
         ORDER BY instrument.status='active' DESC, instrument.last_used_at DESC NULLS LAST,
                  instrument.created_at DESC
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list saved payment instruments"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_invoice_payment_disputes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<PaymentDisputeResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, PaymentDisputeResponse>(
        r#"
        SELECT id, provider, provider_dispute_id, amount_paise, currency, reason,
               status, evidence_due_at, opened_at, resolved_at
          FROM payment_disputes
         WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3
         ORDER BY opened_at DESC
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list payment disputes"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn revoke_payment_instrument(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payment instrument transaction"))?;
    let instrument = sqlx::query_as::<_, (String, String)>(
        r#"
        UPDATE client_payment_instruments
           SET status='revoked', recurring_enabled=FALSE, revoked_at=NOW(), updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status<>'revoked'
         RETURNING client_id, provider_instrument_id
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to revoke payment instrument"))?
    .ok_or_else(|| AppError::not_found("active payment instrument was not found"))?;
    sqlx::query(
        r#"
        UPDATE client_memberships
           SET auto_renew_enabled=FALSE, auto_renew_status='paused', updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3
           AND auto_renew_payment_reference=$4 AND active=TRUE
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&instrument.0)
    .bind(&instrument.1)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to pause linked auto-renewal"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payment instrument revocation"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "payments.instrument.revoked",
        serde_json::json!({"instrumentId":id,"clientId":instrument.0}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"id":id,"status":"revoked"}),
    )))
}

async fn reconcile_pos_payment_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((sale_id, link_id)): Path<(String, String)>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let link = read_payment_link(&state, &tenant_id, &branch_id, &sale_id, &link_id).await?;
    if !state.settings.payment_provider_enabled(&link.provider) {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            format!("{} payment provider is not configured", link.provider),
        ));
    }
    if link.provider_link_id.is_empty() {
        return Err(AppError::validation(
            "payment link is not ready for provider reconciliation",
        ));
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO pos_payment_reconciliation_runs (id, tenant_id, branch_id, provider, status, result_json) VALUES ($1,$2,$3,$4,'pending','{}'::jsonb)",
    )
    .bind(&run_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&link.provider)
    .execute(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to start payment reconciliation"))?;

    let remote = payment_gateway_service::fetch_payment_link(
        &state.settings,
        &link.provider,
        &link.provider_link_id,
    )
    .await;
    let remote = match remote {
        Ok(value) => value,
        Err(error) => {
            let _ = sqlx::query(
                "UPDATE pos_payment_reconciliation_runs SET status='failed', completed_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
            )
            .bind(&run_id)
            .bind(&tenant_id)
            .bind(&branch_id)
            .execute(&state.db)
            .await;
            return Err(error);
        }
    };
    let provider_status = remote.status.trim().to_ascii_lowercase();
    let requires_signed_webhook = provider_status == "paid" && link.status != "paid";
    let local_status = match provider_status.as_str() {
        "expired" => Some("expired"),
        "cancelled" => Some("cancelled"),
        "failed" => Some("failed"),
        _ => None,
    };
    if let Some(status) = local_status {
        sqlx::query(
            "UPDATE pos_payment_links SET status=$4, payload_json=$5::jsonb, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&link.id)
        .bind(status)
        .bind(remote.payload.to_string())
        .execute(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to update reconciled payment link"))?;
    }
    let result = serde_json::json!({
        "paymentLinkId": link.id,
        "providerLinkId": link.provider_link_id,
        "providerStatus": provider_status,
        "providerAmountPaidPaise": remote.amount_paid,
        "requiresSignedWebhook": requires_signed_webhook,
    });
    sqlx::query(
        "UPDATE pos_payment_reconciliation_runs SET status='completed', result_json=$4::jsonb, completed_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(&run_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(result.to_string())
    .execute(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to finish payment reconciliation"))?;

    Ok(Json(ApiResponse::ok(serde_json::json!({
        "reconciliationRunId": run_id,
        "result": result,
    }))))
}

fn payment_link_response(row: PosPaymentLinkRow) -> PosPaymentLinkResponse {
    PosPaymentLinkResponse {
        id: row.id,
        sale_id: row.sale_id,
        provider: row.provider,
        provider_link_id: row.provider_link_id,
        provider_reference: row.provider_reference,
        amount_paise: row.amount_paise,
        status: row.status,
        url: row.link_url,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        guest_link_token: String::new(),
    }
}

async fn read_payment_link_by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<PosPaymentLinkRow>, AppError> {
    sqlx::query_as::<_, PosPaymentLinkRow>(
        "SELECT id, sale_id, provider, provider_link_id, provider_reference, amount_paise, status, link_url, expires_at, created_at, updated_at FROM pos_payment_links WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to read payment link idempotency key"))
}

async fn read_payment_link(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    link_id: &str,
) -> Result<PosPaymentLinkRow, AppError> {
    sqlx::query_as::<_, PosPaymentLinkRow>(
        "SELECT id, sale_id, provider, provider_link_id, provider_reference, amount_paise, status, link_url, expires_at, created_at, updated_at FROM pos_payment_links WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND id=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(link_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load payment link"))?
    .ok_or_else(|| AppError::not_found("payment link was not found"))
}

fn appointment_billing_transition(
    current_status: &str,
    sale_status: &str,
) -> Result<Option<(&'static str, &'static str, &'static str)>, AppError> {
    let (target_status, action, reason) = if sale_status.eq_ignore_ascii_case("paid") {
        ("paid", "PAID", "POS invoice paid")
    } else {
        ("billed", "BILLED", "POS invoice linked")
    };

    match current_status {
        "completed" => Ok(Some((target_status, action, reason))),
        "billed" if target_status == "paid" => Ok(Some((target_status, action, reason))),
        "billed" if target_status == "billed" => Ok(None),
        "paid" if target_status == "paid" => Ok(None),
        "paid" => Err(AppError::conflict(
            "paid appointment cannot be linked to an unpaid invoice",
        )),
        _ => Err(AppError::conflict(
            "appointment must be completed before invoice finalize",
        )),
    }
}

fn appointment_invoice_covers_services(
    required: &HashMap<(String, String), i64>,
    invoiced: &HashMap<(String, String), i64>,
) -> bool {
    required
        .iter()
        .all(|(service, quantity)| invoiced.get(service).copied().unwrap_or_default() >= *quantity)
}

fn appointment_invoice_covers_booked_prices(
    required: &HashMap<(String, String, i64), i64>,
    invoiced: &HashMap<(String, String, i64), i64>,
) -> bool {
    required
        .iter()
        .all(|(service, quantity)| invoiced.get(service).copied().unwrap_or_default() >= *quantity)
}

async fn sync_appointment_billing_tx(
    tx: &mut Transaction<'_, Postgres>,
    sale: &PosSaleRow,
    sale_status: &str,
) -> Result<Vec<AppointmentEvent>, AppError> {
    if sale.source != "appointment" {
        return Ok(Vec::new());
    }
    let reference_id = sale.reference_id.trim();
    if reference_id.is_empty() {
        return Err(AppError::validation(
            "appointment invoice reference is missing",
        ));
    }

    let appointments = sqlx::query_as::<_, (String, String, String, String, String, Value)>(
        "SELECT a.id, a.status, a.client_id, a.staff_id, a.service_ids_json,
                a.booked_service_prices_json
           FROM appointments a
          WHERE a.tenant_id=$2 AND a.branch_id=$3
            AND a.status NOT IN ('cancelled', 'no-show')
            AND (a.id=$1 OR a.booking_group_id=$1)
          ORDER BY a.start_at, a.id
          FOR UPDATE",
    )
    .bind(reference_id)
    .bind(&sale.tenant_id)
    .bind(&sale.branch_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to lock linked appointments"))?;
    if appointments.is_empty() {
        return Err(AppError::not_found("linked appointment was not found"));
    }
    if appointments
        .iter()
        .any(|(_, _, client_id, _, _, _)| client_id != &sale.client_id)
    {
        return Err(AppError::conflict(
            "booking group appointments must match the invoice client",
        ));
    }

    let mut required_services: HashMap<(String, String), i64> = HashMap::new();
    let mut required_booked_prices: HashMap<(String, String, i64), i64> = HashMap::new();
    for (_, _, _, staff_id, service_ids_json, price_snapshot) in &appointments {
        let service_ids: Vec<String> = serde_json::from_str(service_ids_json)
            .map_err(|_| AppError::internal("linked appointment services are invalid"))?;
        for service_id in service_ids {
            if !service_id.trim().is_empty() {
                *required_services
                    .entry((service_id.clone(), staff_id.clone()))
                    .or_default() += 1;
                if let Some(price_paise) = booked_service_price(price_snapshot, &service_id) {
                    *required_booked_prices
                        .entry((service_id, staff_id.clone(), price_paise))
                        .or_default() += 1;
                }
            }
        }
    }
    if required_services.is_empty() {
        return Err(AppError::conflict(
            "linked appointment has no service to invoice",
        ));
    }
    let invoiced_rows = sqlx::query_as::<_, (String, String, i64, i64)>(
        "SELECT item_id, staff_id, unit_price_paise, SUM(quantity)::BIGINT
           FROM pos_sale_lines
          WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='service'
          GROUP BY item_id, staff_id, unit_price_paise",
    )
    .bind(&sale.tenant_id)
    .bind(&sale.branch_id)
    .bind(&sale.id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to validate appointment invoice services"))?;
    let mut invoiced_services = HashMap::new();
    let mut invoiced_booked_prices = HashMap::new();
    for (service_id, staff_id, price_paise, quantity) in invoiced_rows {
        *invoiced_services
            .entry((service_id.clone(), staff_id.clone()))
            .or_default() += quantity;
        *invoiced_booked_prices
            .entry((service_id, staff_id, price_paise))
            .or_default() += quantity;
    }
    if !appointment_invoice_covers_services(&required_services, &invoiced_services) {
        return Err(AppError::conflict(
            "invoice must retain every appointment service and staff assignment",
        ));
    }
    if !appointment_invoice_covers_booked_prices(&required_booked_prices, &invoiced_booked_prices) {
        return Err(AppError::conflict(
            "invoice must retain every appointment booked base price",
        ));
    }

    let transitions = appointments
        .iter()
        .map(|(_, status, _, _, _, _)| appointment_billing_transition(status, sale_status))
        .collect::<Result<Vec<_>, _>>()?;
    let mut events = Vec::new();
    for ((appointment_id, current_status, client_id, staff_id, _, _), transition) in
        appointments.into_iter().zip(transitions)
    {
        let Some((target_status, action, reason)) = transition else {
            continue;
        };
        sqlx::query(
            "UPDATE appointments
                SET status=$4, version=version+1, updated_at=NOW()
              WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
        )
        .bind(&appointment_id)
        .bind(&sale.tenant_id)
        .bind(&sale.branch_id)
        .bind(target_status)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to update linked appointment"))?;

        let old_data = serde_json::json!({ "status": current_status.clone() });
        let new_data = serde_json::json!({
            "status": target_status,
            "saleId": sale.id.clone(),
            "invoiceNumber": sale.invoice_number.clone(),
        });
        let changes = serde_json::json!([{
            "field": "status",
            "oldValue": current_status.clone(),
            "newValue": target_status,
        }]);
        sqlx::query(
            "INSERT INTO appointment_activity (
                id, tenant_id, branch_id, appointment_id, client_id, staff_id, action, action_group,
                old_status, new_status, changed_by, changed_by_role, source, reason,
                old_data, new_data, changes, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,'billing',$8,$9,'system','system','pos',$10,$11::jsonb,$12::jsonb,$13::jsonb,NOW())",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&sale.tenant_id)
        .bind(&sale.branch_id)
        .bind(&appointment_id)
        .bind(&client_id)
        .bind(staff_id)
        .bind(action)
        .bind(&current_status)
        .bind(target_status)
        .bind(reason)
        .bind(old_data.to_string())
        .bind(new_data.to_string())
        .bind(changes.to_string())
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to record appointment invoice activity"))?;

        events.push(AppointmentEvent {
            tenant_id: sale.tenant_id.clone(),
            branch_id: sale.branch_id.clone(),
            client_id: client_id.to_string(),
            entity_type: "appointment".to_string(),
            entity_id: appointment_id,
            action: action.to_string(),
        });
    }

    Ok(events)
}

#[cfg(test)]
mod appointment_pos_handoff_tests {
    use super::{
        apply_appointment_booked_prices, appointment_invoice_covers_booked_prices,
        appointment_invoice_covers_services, sync_appointment_billing_tx, PosSaleLineInput,
        PosSalePayload, PosSaleRow,
    };
    use chrono::Utc;
    use serde_json::Value;
    use sqlx::PgPool;
    use std::collections::HashMap;

    #[test]
    fn appointment_invoice_requires_every_service_and_staff_pair() {
        let required = HashMap::from([
            (("service-1".to_string(), "staff-1".to_string()), 1),
            (("service-2".to_string(), "staff-2".to_string()), 2),
        ]);
        let complete = HashMap::from([
            (("service-1".to_string(), "staff-1".to_string()), 1),
            (("service-2".to_string(), "staff-2".to_string()), 2),
        ]);
        let wrong_staff = HashMap::from([
            (("service-1".to_string(), "staff-1".to_string()), 1),
            (("service-2".to_string(), "staff-1".to_string()), 2),
        ]);
        let missing_quantity = HashMap::from([
            (("service-1".to_string(), "staff-1".to_string()), 1),
            (("service-2".to_string(), "staff-2".to_string()), 1),
        ]);

        assert!(appointment_invoice_covers_services(&required, &complete));
        assert!(!appointment_invoice_covers_services(
            &required,
            &wrong_staff
        ));
        assert!(!appointment_invoice_covers_services(
            &required,
            &missing_quantity
        ));
    }

    #[test]
    fn appointment_price_hydration_preserves_discount_and_rejects_wrong_base_price() {
        let required_prices =
            HashMap::from([(("service-1".to_string(), "staff-1".to_string(), 1_000), 1)]);
        let wrong_prices =
            HashMap::from([(("service-1".to_string(), "staff-1".to_string(), 1_500), 1)]);
        assert!(!appointment_invoice_covers_booked_prices(
            &required_prices,
            &wrong_prices
        ));

        let mut payload = PosSalePayload {
            staff_id: Some("staff-1".to_string()),
            lines: Some(vec![PosSaleLineInput {
                line_type: Some("service".to_string()),
                item_id: Some("service-1".to_string()),
                staff_id: Some("staff-1".to_string()),
                quantity: Some(1),
                unit_price_paise: Some(1_500),
                discount_paise: Some(100),
                ..PosSaleLineInput::default()
            }]),
            ..PosSalePayload::default()
        };
        apply_appointment_booked_prices(
            &mut payload,
            vec![("service-1".to_string(), "staff-1".to_string(), 1_000)],
        )
        .expect("booked price should hydrate");
        let line = &payload.lines.as_ref().expect("lines should remain")[0];
        assert_eq!(line.unit_price_paise, Some(1_000));
        assert_eq!(line.discount_paise, Some(100));
    }

    async fn create_handoff_schema(pool: &PgPool) {
        for statement in [
            "CREATE TABLE services (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
                price_paise INTEGER NOT NULL DEFAULT 0
            )",
            "CREATE TABLE appointments (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
                client_id TEXT NOT NULL, staff_id TEXT NOT NULL DEFAULT '',
                booking_group_id TEXT NOT NULL DEFAULT '', service_ids_json TEXT NOT NULL DEFAULT '[]',
                start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
                status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )",
            "CREATE TABLE pos_sales (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
                client_id TEXT NOT NULL DEFAULT '', staff_id TEXT NOT NULL DEFAULT '',
                invoice_number TEXT NOT NULL DEFAULT '', total_paise BIGINT NOT NULL DEFAULT 0,
                paid_paise BIGINT NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'open', source TEXT NOT NULL DEFAULT 'manual',
                reference_id TEXT NOT NULL DEFAULT ''
            )",
            "CREATE UNIQUE INDEX uq_pos_sales_appointment_reference
                ON pos_sales (tenant_id, branch_id, source, reference_id)
                WHERE source='appointment' AND reference_id<>''",
            "CREATE TABLE pos_sale_lines (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
                sale_id TEXT NOT NULL, line_type TEXT NOT NULL, item_id TEXT NOT NULL,
                item_name TEXT NOT NULL, staff_id TEXT NOT NULL DEFAULT '',
                quantity BIGINT NOT NULL DEFAULT 0, unit_price_paise BIGINT NOT NULL DEFAULT 0
            )",
            "CREATE TABLE appointment_activity (
                id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
                appointment_id TEXT NOT NULL, client_id TEXT NOT NULL, staff_id TEXT NOT NULL,
                action TEXT NOT NULL, action_group TEXT NOT NULL, old_status TEXT NOT NULL,
                new_status TEXT NOT NULL, changed_by TEXT NOT NULL, changed_by_role TEXT NOT NULL,
                source TEXT NOT NULL, reason TEXT NOT NULL, old_data JSONB NOT NULL,
                new_data JSONB NOT NULL, changes JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )",
        ] {
            sqlx::query(statement)
                .execute(pool)
                .await
                .expect("handoff test schema should be created");
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0074_appointment_booked_price_snapshot.sql"
        ))
        .execute(pool)
        .await
        .expect("booked-price migration should apply");
    }

    fn sale_fixture(
        id: &str,
        tenant_id: &str,
        branch_id: &str,
        client_id: &str,
        reference_id: &str,
    ) -> PosSaleRow {
        PosSaleRow {
            id: id.to_string(),
            tenant_id: tenant_id.to_string(),
            branch_id: branch_id.to_string(),
            client_id: client_id.to_string(),
            staff_id: String::new(),
            invoice_number: format!("INV-{id}"),
            subtotal_paise: 0,
            bill_discount_paise: 0,
            coupon_code: String::new(),
            coupon_discount_paise: 0,
            discount_paise: 0,
            tax_paise: 0,
            tip_paise: 0,
            round_off_paise: 0,
            total_paise: 0,
            paid_paise: 0,
            status: "open".to_string(),
            source: "appointment".to_string(),
            reference_id: reference_id.to_string(),
            package_redemptions: Value::Array(Vec::new()),
            invoice_type: "tax_invoice".to_string(),
            finalized_at: None,
            created_at: Utc::now(),
            updated_at: None,
        }
    }

    #[sqlx::test(migrations = false)]
    async fn appointment_pos_handoff_is_atomic_and_idempotent(pool: PgPool) {
        create_handoff_schema(&pool).await;
        let tenant_id = "handoff-tenant";
        let branch_id = "handoff-branch";
        let group_id = "handoff-group";
        let first_appointment_id = "handoff-appointment-1";
        let second_appointment_id = "handoff-appointment-2";
        let cancelled_appointment_id = "handoff-appointment-cancelled";
        let sale_id = "handoff-sale";

        sqlx::query(
            "INSERT INTO services (id, tenant_id, branch_id, price_paise) VALUES
                ('service-1',$1,$2,1000), ('service-2',$1,$2,2000),
                ('service-3',$1,$2,3000), ('rollback-service-1',$1,$2,1100),
                ('rollback-service-2',$1,$2,2200)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&pool)
        .await
        .expect("service price fixtures should be created");

        sqlx::query(
             r#"INSERT INTO appointments (
                id, tenant_id, branch_id, client_id, staff_id, booking_group_id,
                service_ids_json, start_at, end_at, status
             ) VALUES
                ($1,$4,$5,'client-1','staff-1',$6,'["service-1"]',NOW(),NOW() + INTERVAL '1 hour','completed'),
                ($2,$4,$5,'client-1','staff-2',$6,'["service-2"]',NOW(),NOW() + INTERVAL '2 hours','completed'),
                ($3,$4,$5,'client-1','staff-3',$6,'["service-3"]',NOW(),NOW() + INTERVAL '3 hours','cancelled')"#,
        )
        .bind(first_appointment_id)
        .bind(second_appointment_id)
        .bind(cancelled_appointment_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(group_id)
        .execute(&pool)
        .await
        .expect("booking group fixtures should be created");
        sqlx::query("UPDATE services SET price_paise=price_paise+5000 WHERE tenant_id=$1 AND branch_id=$2 AND id IN ('service-1','service-2','service-3')")
            .bind(tenant_id)
            .bind(branch_id)
            .execute(&pool)
            .await
            .expect("catalogue prices should change after booking");
        sqlx::query("UPDATE appointments SET service_ids_json=service_ids_json WHERE id=$1")
            .bind(first_appointment_id)
            .execute(&pool)
            .await
            .expect("ordinary appointment edit should preserve the snapshot");
        let captured_price = sqlx::query_scalar::<_, i64>(
            "SELECT (booked_service_prices_json ->> 'service-1')::BIGINT FROM appointments WHERE id=$1",
        )
        .bind(first_appointment_id)
        .fetch_one(&pool)
        .await
        .expect("booked price should load");
        assert_eq!(
            captured_price, 1000,
            "catalogue edits must not reprice a booking"
        );
        sqlx::query(
            "INSERT INTO pos_sales (
                id, tenant_id, branch_id, client_id, staff_id, invoice_number,
                total_paise, status, source, reference_id
             ) VALUES ($1,$2,$3,'client-1','staff-1','INV-HANDOFF-1',10000,'open','appointment',$4)",
        )
        .bind(sale_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(group_id)
        .execute(&pool)
        .await
        .expect("sale fixture should be created");
        sqlx::query(
            "INSERT INTO pos_sale_lines (
                id, tenant_id, branch_id, sale_id, line_type, item_id, item_name, staff_id, quantity, unit_price_paise
             ) VALUES
                ('handoff-line-1',$1,$2,$3,'service','service-1','Service 1','staff-1',1,1000),
                ('handoff-line-2',$1,$2,$3,'service','service-2','Service 2','staff-2',1,2000)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .execute(&pool)
        .await
        .expect("sale line fixtures should be created");

        let duplicate = sqlx::query(
            "INSERT INTO pos_sales (
                id, tenant_id, branch_id, client_id, invoice_number, source, reference_id
             ) VALUES ('handoff-sale-duplicate',$1,$2,'client-1','INV-HANDOFF-2','appointment',$3)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(group_id)
        .execute(&pool)
        .await;
        assert!(duplicate.is_err(), "booking group reference must be unique");

        let sale = sale_fixture(sale_id, tenant_id, branch_id, "client-1", group_id);
        let mut success_tx = pool
            .begin()
            .await
            .expect("success transaction should start");
        let events = sync_appointment_billing_tx(&mut success_tx, &sale, "open")
            .await
            .expect("first handoff should succeed");
        assert_eq!(events.len(), 2);
        success_tx
            .commit()
            .await
            .expect("success transaction should commit");

        let statuses = sqlx::query_as::<_, (String, String)>(
            "SELECT id, status FROM appointments WHERE booking_group_id=$1 ORDER BY id",
        )
        .bind(group_id)
        .fetch_all(&pool)
        .await
        .expect("booking group statuses should load");
        assert_eq!(
            statuses,
            vec![
                (first_appointment_id.to_string(), "billed".to_string()),
                (second_appointment_id.to_string(), "billed".to_string()),
                (
                    cancelled_appointment_id.to_string(),
                    "cancelled".to_string()
                ),
            ]
        );

        let mut retry_tx = pool.begin().await.expect("retry transaction should start");
        let retry_events = sync_appointment_billing_tx(&mut retry_tx, &sale, "open")
            .await
            .expect("retry should succeed");
        assert!(retry_events.is_empty());
        retry_tx
            .commit()
            .await
            .expect("retry transaction should commit");
        let billed_events = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM appointment_activity WHERE appointment_id IN ($1,$2)",
        )
        .bind(first_appointment_id)
        .bind(second_appointment_id)
        .fetch_one(&pool)
        .await
        .expect("activity count should load");
        assert_eq!(billed_events, 2);

        let mut paid_tx = pool
            .begin()
            .await
            .expect("payment transaction should start");
        let paid_events = sync_appointment_billing_tx(&mut paid_tx, &sale, "paid")
            .await
            .expect("paid handoff should succeed");
        assert_eq!(paid_events.len(), 2);
        paid_tx
            .commit()
            .await
            .expect("payment transaction should commit");
        let paid_statuses = sqlx::query_scalar::<_, String>(
            "SELECT status FROM appointments WHERE id IN ($1,$2) ORDER BY id",
        )
        .bind(first_appointment_id)
        .bind(second_appointment_id)
        .fetch_all(&pool)
        .await
        .expect("paid appointment statuses should load");
        assert_eq!(paid_statuses, vec!["paid".to_string(), "paid".to_string()]);

        let rollback_group_id = "handoff-rollback-group";
        let rollback_first_id = "handoff-rollback-appointment-1";
        let rollback_second_id = "handoff-rollback-appointment-2";
        sqlx::query(
            r#"INSERT INTO appointments (
                id, tenant_id, branch_id, client_id, staff_id, booking_group_id,
                service_ids_json, start_at, end_at, status
             ) VALUES
                ($1,$3,$4,'client-2','staff-1',$5,'["rollback-service-1"]',NOW(),NOW() + INTERVAL '1 hour','completed'),
                ($2,$3,$4,'client-2','staff-2',$5,'["rollback-service-2"]',NOW(),NOW() + INTERVAL '2 hours','completed')"#,
        )
        .bind(rollback_first_id)
        .bind(rollback_second_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(rollback_group_id)
        .execute(&pool)
        .await
        .expect("rollback booking group fixtures should be created");
        sqlx::query(
            "INSERT INTO pos_sales (
                id, tenant_id, branch_id, client_id, staff_id, invoice_number,
                total_paise, status, source, reference_id
             ) VALUES ('handoff-rollback-sale',$1,$2,'client-2','staff-2','INV-HANDOFF-3',20000,'open','appointment',$3)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(rollback_group_id)
        .execute(&pool)
        .await
        .expect("rollback sale fixture should be created");
        sqlx::query(
            "INSERT INTO pos_sale_lines (
                id, tenant_id, branch_id, sale_id, line_type, item_id, item_name, staff_id, quantity, unit_price_paise
             ) VALUES
                ('handoff-rollback-line-1',$1,$2,'handoff-rollback-sale','service','rollback-service-1','Rollback Service 1','staff-1',1,1100),
                ('handoff-rollback-line-2',$1,$2,'handoff-rollback-sale','service','rollback-service-2','Rollback Service 2','staff-2',1,9999)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&pool)
        .await
        .expect("incomplete rollback sale line fixture should be created");
        let rollback_sale = sale_fixture(
            "handoff-rollback-sale",
            tenant_id,
            branch_id,
            "client-2",
            rollback_group_id,
        );
        let mut rollback_tx = pool
            .begin()
            .await
            .expect("rollback transaction should start");
        let rollback_result =
            sync_appointment_billing_tx(&mut rollback_tx, &rollback_sale, "open").await;
        assert!(
            rollback_result.is_err(),
            "wrong booked base price must reject the handoff"
        );
        rollback_tx
            .rollback()
            .await
            .expect("handoff transaction should roll back");

        let rollback_statuses = sqlx::query_scalar::<_, String>(
            "SELECT status FROM appointments WHERE id IN ($1,$2) ORDER BY id",
        )
        .bind(rollback_first_id)
        .bind(rollback_second_id)
        .fetch_all(&pool)
        .await
        .expect("rollback appointment statuses should load");
        let rollback_events = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM appointment_activity WHERE appointment_id IN ($1,$2)",
        )
        .bind(rollback_first_id)
        .bind(rollback_second_id)
        .fetch_one(&pool)
        .await
        .expect("rollback activity count should load");
        assert_eq!(
            rollback_statuses,
            vec!["completed".to_string(), "completed".to_string()]
        );
        assert_eq!(rollback_events, 0);
    }

    #[sqlx::test(migrations = false)]
    async fn concurrent_checkout_writers_are_serialized(pool: PgPool) {
        create_handoff_schema(&pool).await;
        sqlx::query("INSERT INTO pos_sales (id,tenant_id,branch_id,invoice_number,total_paise,paid_paise,status) VALUES ('concurrent-sale','tenant-1','branch-1','INV-CONCURRENT',1000,0,'open')")
            .execute(&pool).await.expect("sale fixture should be created");

        let mut first = pool.begin().await.expect("first transaction should start");
        sqlx::query_scalar::<_, i64>(
            "SELECT paid_paise FROM pos_sales WHERE id='concurrent-sale' FOR UPDATE",
        )
        .fetch_one(&mut *first)
        .await
        .expect("first writer should lock sale");

        let second_pool = pool.clone();
        let (attempted_tx, attempted_rx) = tokio::sync::oneshot::channel();
        let second = tokio::spawn(async move {
            let mut tx = second_pool
                .begin()
                .await
                .expect("second transaction should start");
            attempted_tx.send(()).expect("attempt signal should send");
            let observed = sqlx::query_scalar::<_, i64>(
                "SELECT paid_paise FROM pos_sales WHERE id='concurrent-sale' FOR UPDATE",
            )
            .fetch_one(&mut *tx)
            .await
            .expect("second writer should lock after first commit");
            sqlx::query("UPDATE pos_sales SET paid_paise=1000 WHERE id='concurrent-sale'")
                .execute(&mut *tx)
                .await
                .expect("second writer should update");
            tx.commit().await.expect("second transaction should commit");
            observed
        });

        attempted_rx.await.expect("second writer should start");
        tokio::task::yield_now().await;
        sqlx::query("UPDATE pos_sales SET paid_paise=500 WHERE id='concurrent-sale'")
            .execute(&mut *first)
            .await
            .expect("first writer should update");
        first
            .commit()
            .await
            .expect("first transaction should commit");

        assert_eq!(second.await.expect("second writer should finish"), 500);
        let final_paid = sqlx::query_scalar::<_, i64>(
            "SELECT paid_paise FROM pos_sales WHERE id='concurrent-sale'",
        )
        .fetch_one(&pool)
        .await
        .expect("final payment should load");
        assert_eq!(final_paid, 1000);
    }
}

pub(crate) async fn add_pos_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosPaymentInput>,
) -> ApiResult<PosPaymentResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let requested_till_id = payload.cash_drawer_till_id.clone().unwrap_or_default();
    let paid_at = validate_paid_at(payload.paid_at)?;
    let amount = payload
        .amount_paise
        .unwrap_or_else(|| rupees_to_paise(payload.amount.unwrap_or(0.0)))
        .max(0);
    if amount == 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }

    let method = normalize_payment_method(payload.method.or(payload.mode))?;
    let reference = payload
        .method_reference
        .or(payload.reference)
        .unwrap_or_default();
    let label = payload
        .label
        .unwrap_or_else(|| default_payment_label(&method));
    let notes = payload.notes.unwrap_or_default();
    let idempotency_key = payload.idempotency_key.unwrap_or_default();
    let requested_payment = PreparedPayment {
        method: method.clone(),
        reference: reference.clone(),
        label: label.clone(),
        amount_paise: amount,
        notes: notes.clone(),
        idempotency_key: idempotency_key.clone(),
        paid_at: paid_at.clone(),
    };
    validate_active_payment_modes(
        &state,
        &tenant_id,
        &branch_id,
        std::slice::from_ref(&requested_payment),
    )
    .await?;

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start payment transaction"))?;

    let sale_query = format!(
        "{} WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 FOR UPDATE",
        sale_select_sql()
    );
    let sale = sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(&id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to validate pos sale"))?
        .ok_or_else(|| AppError::not_found("pos sale was not found"))?;

    if matches!(sale.status.as_str(), "paid" | "voided" | "cancelled") {
        return Err(AppError::validation(
            "payments cannot be added to paid, cancelled, or voided sales",
        ));
    }
    if sale.status == "draft" {
        happy_hours_service::ensure_discount_approval_for_finalize(
            &state.db, &tenant_id, &branch_id, &id,
        )
        .await?;
    }

    if !idempotency_key.is_empty() {
        if let Some(existing) = sqlx::query_as::<_, PosPaymentRow>("SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, paid_at, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4")
            .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&idempotency_key).fetch_optional(&mut *tx).await.map_err(|_| AppError::internal("failed to read payment idempotency key"))? {
            tx.rollback().await.map_err(|_| AppError::internal("failed to finish duplicate payment request"))?;
            return Ok(Json(ApiResponse::ok(payment_response(existing))));
        }
    }

    if sale.paid_paise.saturating_add(amount) > sale.total_paise {
        return Err(AppError::validation("Payment amount exceeds sale balance"));
    }
    if method == "cash" {
        if let Some(till_id) =
            ensure_cash_drawer_open(&mut tx, &tenant_id, &branch_id, &requested_till_id).await?
        {
            sqlx::query("UPDATE pos_sales SET cash_drawer_till_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&tenant_id).bind(&branch_id).bind(&id).bind(till_id).execute(&mut *tx).await
                .map_err(|_| AppError::internal("failed to assign cash till"))?;
        }
    }

    let payment_id = uuid::Uuid::new_v4().to_string();
    let inserted = sqlx::query_as::<_, PosPaymentRow>(
        r#"
        INSERT INTO pos_payments (
            id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, idempotency_key, paid_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,NOW()),NOW())
        RETURNING id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, paid_at, created_at
        "#,
    )
    .bind(&payment_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(&method)
    .bind(amount)
    .bind(&reference)
    .bind(&label)
    .bind(&notes)
    .bind(&idempotency_key)
    .bind(paid_at)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to create pos payment"))?;

    wallet_service::settle_pos_internal_payment(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale.client_id,
        &id,
        &payment_id,
        &method,
        &reference,
        amount,
    )
    .await?;

    let (_new_paid, _new_status, appointment_events) =
        apply_pos_payment_effects(&mut tx, &tenant_id, &branch_id, &sale, &inserted).await?;

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payment"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &id, "payment.recorded");
    if let Err(error) =
        happy_hours_service::scan_coupon_abuse_for_sale(&state.db, &tenant_id, &branch_id, &id)
            .await
    {
        tracing::warn!(sale_id = %id, error = ?error, "coupon abuse scan deferred");
    }
    for event in appointment_events {
        let _ = state.appointment_events.send(event);
    }

    Ok(Json(ApiResponse::ok(payment_response(inserted))))
}

async fn apply_pos_payment_effects(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale: &PosSaleRow,
    payment: &PosPaymentRow,
) -> Result<(i64, String, Vec<AppointmentEvent>), AppError> {
    let sale_id = &sale.id;
    let new_paid = sale.paid_paise.saturating_add(payment.amount_paise);
    let new_status = status_for(sale.total_paise, new_paid);

    sqlx::query(
        r#"
        UPDATE pos_sales
           SET paid_paise=$4,
               status=$5,
               finalized_at=CASE WHEN status = 'draft' THEN COALESCE(finalized_at, NOW()) ELSE finalized_at END,
               locked_at=CASE WHEN $5 = 'paid' THEN COALESCE(locked_at, NOW()) ELSE locked_at END,
               updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(new_paid)
    .bind(&new_status)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to update sale payment status"))?;

    if new_status == "paid" {
        settle_deferred_customer_commerce_benefits(tx, tenant_id, branch_id, sale_id).await?;
    }

    if sale.status == "draft" {
        let inventory_movements =
            inventory_adjustment_service::consume_pos_sale(tx, tenant_id, branch_id, sale_id)
                .await?;
        if inventory_movements > 0 {
            insert_pos_event(
                tx,
                tenant_id,
                branch_id,
                sale_id,
                "inventory.consumed",
                serde_json::json!({ "movements": inventory_movements }),
            )
            .await?;
        }
        accounting_service::post_cogs(tx, tenant_id, branch_id, sale_id).await?;
        let (cgst_paise, sgst_paise, igst_paise) =
            read_gst_totals_for_sale_tx(tx, tenant_id, branch_id, sale_id).await?;
        accounting_service::post_invoice(
            tx,
            tenant_id,
            branch_id,
            sale_id,
            sale.total_paise,
            sale.tax_paise,
            cgst_paise,
            sgst_paise,
            igst_paise,
            sale.tip_paise,
            sale.round_off_paise,
        )
        .await?;
        if !sale.client_id.trim().is_empty() {
            grant_package_credits_for_existing_sale(
                tx,
                tenant_id,
                branch_id,
                &sale.client_id,
                sale_id,
            )
            .await?;
            grant_membership_credits_for_existing_sale(
                tx,
                tenant_id,
                branch_id,
                &sale.client_id,
                sale_id,
            )
            .await?;
            issue_gift_cards_for_existing_sale(tx, tenant_id, branch_id, &sale.client_id, sale_id)
                .await?;
            consume_membership_redemption_lines_for_existing_sale(
                tx,
                tenant_id,
                branch_id,
                &sale.client_id,
                sale_id,
            )
            .await?;
            consume_package_redemptions(
                tx,
                tenant_id,
                branch_id,
                &sale.client_id,
                sale_id,
                &sale.package_redemptions,
            )
            .await?;
            accounting_service::post_benefit_redemption(tx, tenant_id, branch_id, sale_id).await?;
            post_membership_rewards(
                tx,
                tenant_id,
                branch_id,
                &sale.client_id,
                &sale.staff_id,
                sale_id,
                sale.total_paise,
            )
            .await?;
        }
    }
    accounting_service::post_payment(
        tx,
        tenant_id,
        branch_id,
        &payment.id,
        &payment.method,
        payment.amount_paise,
    )
    .await?;

    insert_pos_event(
        tx,
        tenant_id,
        branch_id,
        sale_id,
        "payment.recorded",
        serde_json::json!({
            "method": payment.method,
            "amountPaise": payment.amount_paise,
            "paidAt": payment.paid_at,
            "paidPaise": new_paid,
            "status": new_status
        }),
    )
    .await?;

    if sale.status == "draft" {
        consume_coupon_usage(tx, tenant_id, branch_id, &sale.client_id, &sale.coupon_code).await?;
    }

    let appointment_events = sync_appointment_billing_tx(tx, sale, &new_status).await?;
    Ok((new_paid, new_status, appointment_events))
}

pub(crate) async fn finalize_pos_invoice(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    payload: Option<Json<FinalizeRequest>>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start finalize transaction"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;

    if matches!(sale.status.as_str(), "voided" | "cancelled") {
        return Err(AppError::validation(
            "cancelled or voided invoices cannot be finalized",
        ));
    }
    if sale.finalized_at.is_some() {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish invoice retry"))?;
        let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
        return Ok(Json(ApiResponse::ok(details)));
    }

    happy_hours_service::ensure_discount_approval_for_finalize(
        &state.db, &tenant_id, &branch_id, &id,
    )
    .await?;

    let line_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to validate invoice lines"))?;

    if line_count == 0 {
        return Err(AppError::validation(
            "invoice must have at least one line before finalize",
        ));
    }

    let apply_package_effects = sale.finalized_at.is_none();
    let finalized_status = status_for_finalize(sale.total_paise, sale.paid_paise);

    let draft_payments = sqlx::query_as::<_, PosPaymentRow>("SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, paid_at, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY paid_at, id")
        .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_all(&mut *tx).await.map_err(|_| AppError::internal("failed to load draft payments"))?;
    let held_payment_inputs = draft_payments
        .iter()
        .map(|payment| PreparedPayment {
            method: payment.method.clone(),
            reference: payment.method_reference.clone(),
            label: payment.label.clone(),
            amount_paise: payment.amount_paise,
            notes: payment.notes.clone(),
            idempotency_key: String::new(),
            paid_at: Some(payment.paid_at),
        })
        .collect::<Vec<_>>();
    validate_active_payment_modes(&state, &tenant_id, &branch_id, &held_payment_inputs).await?;
    if held_payment_inputs
        .iter()
        .any(|payment| payment.method == "cash")
    {
        let requested_till_id = payload
            .as_ref()
            .and_then(|value| value.cash_drawer_till_id.as_deref())
            .unwrap_or("");
        if let Some(till_id) =
            ensure_cash_drawer_open(&mut tx, &tenant_id, &branch_id, requested_till_id).await?
        {
            sqlx::query("UPDATE pos_sales SET cash_drawer_till_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(&tenant_id).bind(&branch_id).bind(&id).bind(till_id).execute(&mut *tx).await
                .map_err(|_| AppError::internal("failed to assign cash till"))?;
        }
    }

    let finalized = sqlx::query_as::<_, PosSaleRow>(
        r#"
        UPDATE pos_sales
           SET status=$4,
               finalized_at=COALESCE(finalized_at, NOW()),
               locked_at=CASE WHEN $4 = 'paid' THEN COALESCE(locked_at, NOW()) ELSE locked_at END,
               updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3
         RETURNING id, tenant_id, branch_id, client_id, staff_id, invoice_number,
                   subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
                   tip_paise, round_off_paise, total_paise, paid_paise,
                   status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at
        "#,
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&finalized_status)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to finalize invoice"))?;

    insert_pos_event(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        "invoice.finalized",
        serde_json::json!({
            "invoiceNumber": finalized.invoice_number.clone(),
            "totalPaise": finalized.total_paise,
            "paidPaise": finalized.paid_paise,
            "status": finalized.status.clone()
        }),
    )
    .await?;

    let inventory_movements =
        inventory_adjustment_service::consume_pos_sale(&mut tx, &tenant_id, &branch_id, &id)
            .await?;
    if inventory_movements > 0 {
        insert_pos_event(
            &mut tx,
            &tenant_id,
            &branch_id,
            &id,
            "inventory.consumed",
            serde_json::json!({ "movements": inventory_movements }),
        )
        .await?;
    }
    accounting_service::post_cogs(&mut tx, &tenant_id, &branch_id, &id).await?;

    let (cgst_paise, sgst_paise, igst_paise) =
        read_gst_totals_for_sale_tx(&mut tx, &tenant_id, &branch_id, &id).await?;
    accounting_service::post_invoice(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        finalized.total_paise,
        finalized.tax_paise,
        cgst_paise,
        sgst_paise,
        igst_paise,
        finalized.tip_paise,
        finalized.round_off_paise,
    )
    .await?;
    for payment in &draft_payments {
        accounting_service::post_payment(
            &mut tx,
            &tenant_id,
            &branch_id,
            &payment.id,
            &payment.method,
            payment.amount_paise,
        )
        .await?;
    }

    for payment in &draft_payments {
        wallet_service::settle_pos_internal_payment(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &id,
            &payment.id,
            &payment.method,
            &payment.method_reference,
            payment.amount_paise,
        )
        .await?;
    }
    pos_enterprise_repository::snapshot_staff_commissions(&mut tx, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to snapshot staff commission"))?;
    if apply_package_effects && !finalized.client_id.trim().is_empty() {
        grant_package_credits_for_existing_sale(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &id,
        )
        .await?;
        grant_membership_credits_for_existing_sale(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &id,
        )
        .await?;
        issue_gift_cards_for_existing_sale(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &id,
        )
        .await?;
        consume_membership_redemption_lines_for_existing_sale(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &id,
        )
        .await?;
        consume_package_redemptions(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &id,
            &finalized.package_redemptions,
        )
        .await?;
        accounting_service::post_benefit_redemption(&mut tx, &tenant_id, &branch_id, &id).await?;
        post_membership_rewards(
            &mut tx,
            &tenant_id,
            &branch_id,
            &finalized.client_id,
            &finalized.staff_id,
            &id,
            finalized.total_paise,
        )
        .await?;
    }

    let compliance_sale = sqlx::query_as::<_, ComplianceSaleRow>(
        "SELECT invoice_type, total_paise, seller_gstin, buyer_gstin, reverse_charge FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_one(&mut *tx).await
    .map_err(|_| AppError::internal("failed to prepare finalized invoice compliance"))?;
    let has_products = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='product')",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_one(&mut *tx).await
    .map_err(|_| AppError::internal("failed to evaluate finalized invoice goods"))?;
    record_invoice_compliance(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &compliance_sale.invoice_type,
        compliance_sale.total_paise,
        &compliance_sale.seller_gstin,
        &compliance_sale.buyer_gstin,
        compliance_sale.reverse_charge,
        has_products,
    )
    .await?;

    let appointment_events =
        sync_appointment_billing_tx(&mut tx, &finalized, &finalized.status).await?;
    consume_coupon_usage(
        &mut tx,
        &tenant_id,
        &branch_id,
        &finalized.client_id,
        &finalized.coupon_code,
    )
    .await?;

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice finalize"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &id, "invoice.finalized");
    // The invoice exists as a document from this moment, so this is when its
    // permanent copy is taken — not whenever somebody first clicks download.
    seal_finalized_invoice_pdfs(&state, &tenant_id, &branch_id, &id).await;
    if let Err(error) =
        happy_hours_service::scan_coupon_abuse_for_sale(&state.db, &tenant_id, &branch_id, &id)
            .await
    {
        tracing::warn!(sale_id = %id, error = ?error, "coupon abuse scan deferred");
    }
    for event in appointment_events {
        let _ = state.appointment_events.send(event);
    }

    let lines = read_lines(&state, &tenant_id, &branch_id, &id).await?;
    let payments = read_payments(&state, &tenant_id, &branch_id, &id).await?;
    let client_kpi = read_client_kpi(&state, &tenant_id, &branch_id, &finalized.client_id).await?;
    let response = sale_response(finalized, line_count);
    let payment_split = payment_split_response(&payments, response.total_paise);
    let transaction_context =
        read_pos_transaction_context(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments,
        payment_split,
        client_kpi,
        transaction_context,
    })))
}

pub(crate) async fn void_pos_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceLifecycleRequest>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reason = payload.reason.unwrap_or_default();
    require_lifecycle_reason(&reason, "void")?;
    let notes = payload.notes.unwrap_or_default();
    let key = payload.idempotency_key.unwrap_or_default();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start void transaction"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    if sale.status == "voided" {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish void request"))?;
        return Ok(Json(ApiResponse::ok(
            load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
        )));
    }
    if !matches!(sale.status.as_str(), "draft" | "open") || sale.paid_paise > 0 {
        return Err(AppError::validation(
            "only unpaid draft or open invoices can be voided",
        ));
    }
    if !key.is_empty()
        && lifecycle_key_exists(
            &mut tx,
            "pos_invoice_voids",
            &tenant_id,
            &branch_id,
            &id,
            &key,
        )
        .await?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate void request"))?;
        return Ok(Json(ApiResponse::ok(
            load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
        )));
    }
    sqlx::query("INSERT INTO pos_invoice_voids (tenant_id, branch_id, sale_id, actor_user_id, reason, notes, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7)")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&claims.sub).bind(&reason).bind(&notes).bind(&key)
        .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save invoice void"))?;
    sqlx::query("UPDATE pos_sales SET status='voided', locked_at=COALESCE(locked_at, NOW()), updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&id).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to void invoice"))?;
    reverse_happy_hour_lock(&mut tx, &tenant_id, &branch_id, &id, i64::MAX).await?;
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        "invoice.voided",
        serde_json::json!({ "invoiceNumber": sale.invoice_number, "reason": reason }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice void"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &id, "invoice.voided");
    Ok(Json(ApiResponse::ok(
        load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

struct ResolvedRefundLine {
    sale_line_id: String,
    line_type: String,
    item_id: String,
    quantity: i64,
    sold_quantity: i64,
    unit_price_paise: i64,
    taxable_paise: i64,
    amount_paise: i64,
    restock_quantity: i64,
    discard_quantity: i64,
}

#[derive(Debug, FromRow)]
struct GatewayRefundPayment {
    id: String,
    provider: String,
    provider_account_id: String,
    provider_payment_id: String,
    currency: String,
    available_paise: i64,
}

struct GatewayRefundResult {
    pos_payment_id: String,
    provider: String,
    provider_payment_id: String,
    provider_refund_id: String,
    amount_paise: i64,
    status: String,
    payload: Value,
}

#[derive(Debug, FromRow)]
struct RefundPaymentAvailability {
    pos_payment_id: String,
    method: String,
    available_paise: i64,
    is_gateway: bool,
}

struct RefundPaymentAllocation {
    pos_payment_id: String,
    method: String,
    amount_paise: i64,
}

async fn refundable_payments(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<RefundPaymentAvailability>, AppError> {
    sqlx::query_as("SELECT payment.id AS pos_payment_id,payment.method,payment.amount_paise-COALESCE(SUM(allocation.amount_paise),0)::BIGINT AS available_paise,((payment.idempotency_key LIKE 'razorpay:%' AND payment.method_reference<>'') OR EXISTS(SELECT 1 FROM payment_provider_operations operation WHERE operation.tenant_id=payment.tenant_id AND operation.branch_id=payment.branch_id AND operation.sale_id=payment.sale_id AND operation.provider_object_id=payment.method_reference AND operation.operation_type='payment')) AS is_gateway FROM pos_payments payment LEFT JOIN pos_refund_payment_allocations allocation ON allocation.tenant_id=payment.tenant_id AND allocation.branch_id=payment.branch_id AND allocation.pos_payment_id=payment.id WHERE payment.tenant_id=$1 AND payment.branch_id=$2 AND payment.sale_id=$3 GROUP BY payment.id,payment.method,payment.amount_paise,payment.idempotency_key,payment.method_reference,payment.created_at HAVING payment.amount_paise>COALESCE(SUM(allocation.amount_paise),0) ORDER BY payment.created_at,payment.id")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_all(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load refundable invoice payments"))
}

fn plan_manual_refund_allocations(
    payments: &[RefundPaymentAvailability],
    requested_method: &str,
    amount_paise: i64,
) -> Result<Vec<RefundPaymentAllocation>, AppError> {
    if amount_paise == 0 {
        return Ok(Vec::new());
    }
    let methods = payments
        .iter()
        .filter(|payment| !payment.is_gateway && payment.available_paise > 0)
        .map(|payment| payment.method.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let automatic_split = requested_method.eq_ignore_ascii_case("original_tender");
    let method = if automatic_split {
        String::new()
    } else if requested_method.is_empty() {
        if methods.len() != 1 {
            return Err(AppError::validation(
                "refundMethod is required when multiple payment methods are refundable",
            ));
        }
        methods.into_iter().next().unwrap_or_default()
    } else {
        requested_method.to_ascii_lowercase()
    };
    let mut remaining = amount_paise;
    let mut allocations = Vec::new();
    for payment in payments.iter().filter(|payment| {
        !payment.is_gateway
            && payment.available_paise > 0
            && (automatic_split || payment.method.eq_ignore_ascii_case(&method))
    }) {
        let amount = remaining.min(payment.available_paise);
        if amount > 0 {
            allocations.push(RefundPaymentAllocation {
                pos_payment_id: payment.pos_payment_id.clone(),
                method: payment.method.clone(),
                amount_paise: amount,
            });
            remaining = remaining.saturating_sub(amount);
        }
        if remaining == 0 {
            break;
        }
    }
    if remaining > 0 {
        return Err(AppError::validation(
            "selected refundMethod does not have enough refundable balance",
        ));
    }
    Ok(allocations)
}

fn plan_exchange_credit_allocations(
    payments: &[RefundPaymentAvailability],
    amount_paise: i64,
) -> Result<Vec<RefundPaymentAllocation>, AppError> {
    let mut remaining = amount_paise;
    let mut allocations = Vec::new();
    for payment in payments
        .iter()
        .filter(|payment| payment.available_paise > 0)
    {
        let amount = remaining.min(payment.available_paise);
        if amount > 0 {
            allocations.push(RefundPaymentAllocation {
                pos_payment_id: payment.pos_payment_id.clone(),
                method: payment.method.clone(),
                amount_paise: amount,
            });
            remaining = remaining.saturating_sub(amount);
        }
        if remaining == 0 {
            break;
        }
    }
    if remaining > 0 {
        return Err(AppError::validation(
            "invoice does not have enough refundable payment balance",
        ));
    }
    Ok(allocations)
}

async fn reverse_unused_refunded_liabilities(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    refund_id: &str,
    client_id: &str,
    actor_user_id: &str,
    reason: &str,
    lines: &[ResolvedRefundLine],
) -> Result<(i64, i64), AppError> {
    let mut deferred_revenue_paise = 0i64;
    let mut customer_credit_paise = 0i64;
    for line in lines {
        if !matches!(
            line.line_type.as_str(),
            "membership" | "package" | "gift_card"
        ) {
            continue;
        }
        if line.quantity != line.sold_quantity {
            return Err(AppError::validation(
                "membership, package, and gift card refunds require the full unused invoice line",
            ));
        }
        match line.line_type.as_str() {
            "membership" => {
                let memberships = sqlx::query_scalar::<_, String>(
                    "SELECT id FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4 AND membership_id=$5 FOR UPDATE",
                )
                .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id)
                .fetch_all(&mut **tx).await
                .map_err(|_| AppError::internal("failed to lock refunded membership"))?;
                if memberships.is_empty() {
                    return Err(AppError::conflict(
                        "membership entitlement was not found for this invoice",
                    ));
                }
                let used = sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(SELECT 1 FROM client_membership_credits credit WHERE credit.tenant_id=$1 AND credit.branch_id=$2 AND credit.client_id=$3 AND credit.source_sale_id=$4 AND credit.membership_id=$5 AND (credit.remaining_qty<>credit.total_qty OR EXISTS(SELECT 1 FROM pos_membership_redemptions redemption WHERE redemption.tenant_id=credit.tenant_id AND redemption.client_membership_credit_id=credit.id)))",
                )
                .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id)
                .fetch_one(&mut **tx).await
                .map_err(|_| AppError::internal("failed to validate refunded membership usage"))?;
                if used {
                    return Err(AppError::conflict(
                        "used membership benefits cannot be refunded",
                    ));
                }
                sqlx::query("UPDATE client_membership_credits SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4 AND membership_id=$5")
                    .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id)
                    .execute(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to deactivate refunded membership benefits"))?;
                sqlx::query("UPDATE client_memberships SET active=FALSE,cancelled_at=NOW(),cancel_reason=$6,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4 AND membership_id=$5")
                    .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id).bind(reason)
                    .execute(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to cancel refunded membership"))?;
                sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,source_sale_id,reason) VALUES ($1,$2,$3,'cancelled',$4,$5) ON CONFLICT DO NOTHING")
                    .bind(tenant_id).bind(branch_id).bind(&memberships[0]).bind(sale_id).bind(reason)
                    .execute(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to audit refunded membership"))?;
                deferred_revenue_paise = deferred_revenue_paise.saturating_add(line.taxable_paise);
            }
            "package" => {
                let credits = sqlx::query_as::<_, (String, String, i64)>(
                    "SELECT id,client_id,remaining_qty::BIGINT FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4 AND package_id=$5 FOR UPDATE",
                )
                .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id)
                .fetch_all(&mut **tx).await
                .map_err(|_| AppError::internal("failed to lock refunded package"))?;
                if credits.is_empty() {
                    return Err(AppError::conflict(
                        "package entitlement was not found for this invoice",
                    ));
                }
                let used = sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(SELECT 1 FROM client_package_credits credit WHERE credit.tenant_id=$1 AND credit.branch_id=$2 AND credit.client_id=$3 AND credit.source_sale_id=$4 AND credit.package_id=$5 AND (credit.remaining_qty<>credit.total_qty OR EXISTS(SELECT 1 FROM pos_package_redemptions redemption WHERE redemption.tenant_id=credit.tenant_id AND redemption.client_package_credit_id=credit.id)))",
                )
                .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id)
                .fetch_one(&mut **tx).await
                .map_err(|_| AppError::internal("failed to validate refunded package usage"))?;
                if used {
                    return Err(AppError::conflict(
                        "used package benefits cannot be refunded",
                    ));
                }
                sqlx::query("UPDATE client_package_credits SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND source_sale_id=$4 AND package_id=$5")
                    .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(&line.item_id)
                    .execute(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to deactivate refunded package"))?;
                for (credit_id, credit_client_id, quantity_before) in credits {
                    sqlx::query("INSERT INTO customer_liability_lifecycle_events (tenant_id,branch_id,liability_type,liability_id,action,source_branch_id,target_branch_id,source_client_id,target_client_id,quantity_before,quantity_after,reason,actor_user_id,idempotency_key) VALUES ($1,$2,'package',$3,'refund',$2,$2,$4,$4,$5,0,$6,$7,$8)")
                        .bind(tenant_id).bind(branch_id).bind(&credit_id).bind(&credit_client_id).bind(quantity_before as i32).bind(reason).bind(actor_user_id).bind(format!("refund:{refund_id}:{credit_id}"))
                        .execute(&mut **tx).await
                        .map_err(|_| AppError::internal("failed to audit refunded package"))?;
                }
                deferred_revenue_paise = deferred_revenue_paise.saturating_add(line.taxable_paise);
            }
            "gift_card" => {
                let code = line.item_id.trim().to_ascii_uppercase();
                if let Some(reload_code) = code.strip_prefix("RELOAD:") {
                    let reloads = sqlx::query_as::<_, (String, i64, i64)>(
                        "SELECT transaction.gift_card_id,transaction.delta_paise,transaction.balance_after_paise FROM gift_card_transactions transaction JOIN gift_cards card ON card.id=transaction.gift_card_id AND card.tenant_id=transaction.tenant_id AND card.branch_id=transaction.branch_id WHERE transaction.tenant_id=$1 AND transaction.branch_id=$2 AND transaction.sale_id=$3 AND transaction.transaction_type='reload' AND card.code=$4",
                    )
                    .bind(tenant_id).bind(branch_id).bind(sale_id).bind(reload_code)
                    .fetch_all(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to load refunded gift card reload"))?;
                    if reloads.len() != 1 {
                        return Err(AppError::conflict(
                            "gift card reload entitlement could not be reconciled",
                        ));
                    }
                    let (card_id, reload_paise, reload_balance) = &reloads[0];
                    let card = sqlx::query_as::<_, (String, i64, i64, String)>("SELECT client_id,balance_paise,initial_amount_paise,status FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
                        .bind(tenant_id).bind(branch_id).bind(card_id).fetch_one(&mut **tx).await
                        .map_err(|_| AppError::internal("failed to lock refunded gift card reload"))?;
                    if card.3 != "active" || card.1 != *reload_balance || card.2 <= *reload_paise {
                        return Err(AppError::conflict(
                            "used or changed gift card reload cannot be refunded",
                        ));
                    }
                    let balance_after = card.1 - reload_paise;
                    sqlx::query("UPDATE gift_cards SET initial_amount_paise=initial_amount_paise-$4,balance_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                        .bind(tenant_id).bind(branch_id).bind(card_id).bind(reload_paise).bind(balance_after)
                        .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to reverse gift card reload"))?;
                    sqlx::query("INSERT INTO gift_card_transactions (tenant_id,branch_id,gift_card_id,sale_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes) VALUES ($1,$2,$3,$4,'adjustment_debit',$5,$6,$7,$8)")
                        .bind(tenant_id).bind(branch_id).bind(card_id).bind(sale_id).bind(-reload_paise).bind(balance_after).bind(format!("refund:{refund_id}:{card_id}")).bind(reason)
                        .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to record gift card reload refund"))?;
                    sqlx::query("INSERT INTO customer_liability_lifecycle_events (tenant_id,branch_id,liability_type,liability_id,action,source_branch_id,target_branch_id,source_client_id,target_client_id,balance_before_paise,balance_after_paise,reason,actor_user_id,idempotency_key) VALUES ($1,$2,'gift_card',$3,'refund',$2,$2,$4,$4,$5,$6,$7,$8,$9)")
                        .bind(tenant_id).bind(branch_id).bind(card_id).bind(&card.0).bind(card.1).bind(balance_after).bind(reason).bind(actor_user_id).bind(format!("refund:{refund_id}:{card_id}"))
                        .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to audit gift card reload refund"))?;
                } else {
                    let cards = sqlx::query_as::<_, (String, String, i64)>(
                        "SELECT card.id,card.client_id,card.balance_paise FROM gift_cards card WHERE card.tenant_id=$1 AND card.branch_id=$2 AND card.source_sale_id=$3 AND card.initial_amount_paise=$4 AND card.status='active' AND card.balance_paise=card.initial_amount_paise AND ($5='' OR card.code=$5 OR card.code LIKE $5||'-%') AND NOT EXISTS(SELECT 1 FROM gift_card_transactions transaction WHERE transaction.tenant_id=card.tenant_id AND transaction.branch_id=card.branch_id AND transaction.gift_card_id=card.id AND transaction.transaction_type<>'issue') FOR UPDATE",
                    )
                    .bind(tenant_id).bind(branch_id).bind(sale_id).bind(line.unit_price_paise).bind(&code)
                    .fetch_all(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to lock refunded gift cards"))?;
                    if cards.len() != line.quantity as usize {
                        return Err(AppError::conflict(
                            "used or changed gift cards cannot be refunded",
                        ));
                    }
                    for (card_id, card_client_id, balance_before) in cards {
                        sqlx::query("UPDATE gift_cards SET balance_paise=0,status='voided',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                            .bind(tenant_id).bind(branch_id).bind(&card_id).execute(&mut **tx).await
                            .map_err(|_| AppError::internal("failed to void refunded gift card"))?;
                        sqlx::query("INSERT INTO gift_card_transactions (tenant_id,branch_id,gift_card_id,sale_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes) VALUES ($1,$2,$3,$4,'adjustment_debit',$5,0,$6,$7)")
                            .bind(tenant_id).bind(branch_id).bind(&card_id).bind(sale_id).bind(-balance_before).bind(format!("refund:{refund_id}:{card_id}")).bind(reason)
                            .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to record gift card refund"))?;
                        sqlx::query("INSERT INTO customer_liability_lifecycle_events (tenant_id,branch_id,liability_type,liability_id,action,source_branch_id,target_branch_id,source_client_id,target_client_id,balance_before_paise,balance_after_paise,reason,actor_user_id,idempotency_key) VALUES ($1,$2,'gift_card',$3,'refund',$2,$2,$4,$4,$5,0,$6,$7,$8)")
                            .bind(tenant_id).bind(branch_id).bind(&card_id).bind(&card_client_id).bind(balance_before).bind(reason).bind(actor_user_id).bind(format!("refund:{refund_id}:{card_id}"))
                            .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to audit gift card refund"))?;
                    }
                }
                customer_credit_paise = customer_credit_paise.saturating_add(line.taxable_paise);
            }
            _ => unreachable!(),
        }
    }
    Ok((deferred_revenue_paise, customer_credit_paise))
}

async fn resolve_refund_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    requested_lines: Vec<InvoiceRefundLineInput>,
    restock_requested: bool,
) -> Result<Vec<ResolvedRefundLine>, AppError> {
    let mut seen = HashSet::new();
    let mut resolved = Vec::with_capacity(requested_lines.len());
    for requested in requested_lines {
        let sale_line_id = requested.sale_line_id.trim().to_string();
        if sale_line_id.is_empty() || requested.quantity <= 0 || !seen.insert(sale_line_id.clone())
        {
            return Err(AppError::validation(
                "return lines must have unique saleLineId values and positive quantities",
            ));
        }
        let line = sqlx::query_as::<_, (String, String, i64, i64, i64, i64)>(
            "SELECT line_type, item_id, quantity, unit_price_paise, taxable_paise, line_total_paise FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND id=$4 FOR UPDATE",
        )
        .bind(tenant_id).bind(branch_id).bind(sale_id).bind(&sale_line_id)
        .fetch_optional(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load invoice line for return"))?
        .ok_or_else(|| AppError::validation("return line does not belong to this invoice"))?;
        let (line_type, item_id, sold_quantity, unit_price_paise, taxable_paise, line_total_paise) =
            line;
        let (returned_quantity, returned_amount) = sqlx::query_as::<_, (i64, i64)>(
            "SELECT COALESCE(SUM(quantity),0)::BIGINT, COALESCE(SUM(amount_paise),0)::BIGINT FROM pos_invoice_refund_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND sale_line_id=$4",
        )
        .bind(tenant_id).bind(branch_id).bind(sale_id).bind(&sale_line_id)
        .fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate prior line returns"))?;
        let remaining_quantity = sold_quantity.saturating_sub(returned_quantity);
        if requested.quantity > remaining_quantity {
            return Err(AppError::validation(
                "return quantity exceeds available line quantity",
            ));
        }
        let amount_paise = proportional_refund_amount(
            line_total_paise,
            sold_quantity,
            requested.quantity,
            remaining_quantity,
            returned_amount,
        );
        let (restock_quantity, discard_quantity) = refund_disposition(
            &line_type,
            requested.quantity,
            requested.restock_quantity,
            requested.discard_quantity,
            restock_requested,
        )?;
        resolved.push(ResolvedRefundLine {
            sale_line_id,
            line_type: line_type.clone(),
            item_id,
            quantity: requested.quantity,
            sold_quantity,
            unit_price_paise,
            taxable_paise,
            amount_paise,
            restock_quantity,
            discard_quantity,
        });
    }
    Ok(resolved)
}

fn proportional_refund_amount(
    line_total_paise: i64,
    sold_quantity: i64,
    refund_quantity: i64,
    remaining_quantity: i64,
    previously_refunded_paise: i64,
) -> i64 {
    if refund_quantity == remaining_quantity {
        line_total_paise.saturating_sub(previously_refunded_paise)
    } else {
        line_total_paise.saturating_mul(refund_quantity) / sold_quantity
    }
}

fn refund_disposition(
    line_type: &str,
    quantity: i64,
    restock_quantity: Option<i64>,
    discard_quantity: Option<i64>,
    legacy_restock: bool,
) -> Result<(i64, i64), AppError> {
    let split = match (restock_quantity, discard_quantity) {
        (None, None) if legacy_restock && line_type == "product" => (quantity, 0),
        (None, None) => (0, quantity),
        (restock, discard) => (restock.unwrap_or(0), discard.unwrap_or(0)),
    };
    if split.0 < 0
        || split.1 < 0
        || split.0.saturating_add(split.1) != quantity
        || (line_type != "product" && split.0 != 0)
    {
        return Err(AppError::validation(
            "each return line must split its full quantity into valid restock and discard quantities",
        ));
    }
    Ok(split)
}

async fn gateway_refund_candidates(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<GatewayRefundPayment>, AppError> {
    sqlx::query_as(
        r#"SELECT * FROM (
      SELECT p.id,'razorpay'::TEXT AS provider,''::TEXT AS provider_account_id,
        p.method_reference AS provider_payment_id,'INR'::TEXT AS currency,
        p.amount_paise-COALESCE(SUM(gr.amount_paise),0)::BIGINT AS available_paise,p.created_at
      FROM pos_payments p
      LEFT JOIN pos_gateway_refunds gr ON gr.tenant_id=p.tenant_id AND gr.branch_id=p.branch_id
        AND gr.pos_payment_id=p.id AND gr.status IN ('pending','processed')
      WHERE p.tenant_id=$1 AND p.branch_id=$2 AND p.sale_id=$3
        AND p.idempotency_key LIKE 'razorpay:%' AND p.method_reference<>''
      GROUP BY p.id,p.method_reference,p.amount_paise,p.created_at
      HAVING p.amount_paise>COALESCE(SUM(gr.amount_paise),0)
      UNION ALL
      SELECT p.id,operation.provider,account.provider_account_id,p.method_reference,
        operation.currency,p.amount_paise-COALESCE(SUM(gr.amount_paise),0)::BIGINT,p.created_at
      FROM pos_payments p
      JOIN payment_provider_operations operation ON operation.tenant_id=p.tenant_id
        AND operation.branch_id=p.branch_id AND operation.sale_id=p.sale_id
        AND operation.provider_object_id=p.method_reference AND operation.operation_type='payment'
      JOIN payment_merchant_accounts account ON account.id=operation.merchant_account_id
      LEFT JOIN pos_gateway_refunds gr ON gr.tenant_id=p.tenant_id AND gr.branch_id=p.branch_id
        AND gr.pos_payment_id=p.id AND gr.status IN ('pending','processed')
      WHERE p.tenant_id=$1 AND p.branch_id=$2 AND p.sale_id=$3 AND p.method_reference<>''
        AND operation.provider IN ('stripe','adyen')
      GROUP BY p.id,operation.provider,account.provider_account_id,p.method_reference,
        operation.currency,p.amount_paise,p.created_at
      HAVING p.amount_paise>COALESCE(SUM(gr.amount_paise),0)
    ) candidates ORDER BY created_at,id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load provider refund candidates"))
}

async fn create_refund_credit_note(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    refund_id: &str,
    actor_user_id: &str,
    amount_paise: i64,
    reason: &str,
    notes: &str,
) -> Result<String, AppError> {
    let business_date = sqlx::query_scalar::<_, NaiveDate>("SELECT CURRENT_DATE")
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to resolve refund credit-note date"))?;
    let sequence =
        invoice_numbering_service::allocate(tx, tenant_id, branch_id, "credit_note", business_date)
            .await?;
    let credit_note_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO pos_credit_notes (id, tenant_id, branch_id, sale_id, refund_id, actor_user_id, credit_note_number, amount_paise, reason, notes, idempotency_key, fiscal_year, invoice_number_sequence_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)")
        .bind(&credit_note_id).bind(tenant_id).bind(branch_id).bind(sale_id).bind(refund_id).bind(actor_user_id).bind(&sequence.invoice_number).bind(amount_paise).bind(reason).bind(notes).bind(format!("refund-{refund_id}")).bind(&sequence.fiscal_year).bind(&sequence.sequence_id)
        .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to create refund credit note"))?;
    sqlx::query("UPDATE pos_invoice_refunds SET credit_note_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(refund_id).bind(&credit_note_id).execute(&mut **tx).await
        .map_err(|_| AppError::internal("failed to link refund credit note"))?;
    Ok(sequence.invoice_number)
}

#[cfg(test)]
mod item_return_tests {
    use super::{
        plan_exchange_credit_allocations, plan_manual_refund_allocations,
        proportional_refund_amount, refund_disposition, RefundPaymentAvailability,
    };

    #[test]
    fn final_partial_return_receives_all_rounding_remainder() {
        assert_eq!(proportional_refund_amount(100, 3, 1, 3, 0), 33);
        assert_eq!(proportional_refund_amount(100, 3, 2, 2, 33), 67);
    }

    #[test]
    fn mixed_manual_refund_requires_and_respects_payment_method() {
        let payments = vec![
            RefundPaymentAvailability {
                pos_payment_id: "cash-payment".into(),
                method: "cash".into(),
                available_paise: 5_000,
                is_gateway: false,
            },
            RefundPaymentAvailability {
                pos_payment_id: "card-payment".into(),
                method: "card".into(),
                available_paise: 5_000,
                is_gateway: false,
            },
        ];
        assert!(plan_manual_refund_allocations(&payments, "", 2_000).is_err());
        let allocations = plan_manual_refund_allocations(&payments, "cash", 2_000).unwrap();
        assert_eq!(allocations.len(), 1);
        assert_eq!(allocations[0].pos_payment_id, "cash-payment");
        assert_eq!(allocations[0].amount_paise, 2_000);
        let split = plan_manual_refund_allocations(&payments, "original_tender", 7_000).unwrap();
        assert_eq!(split.len(), 2);
        assert_eq!(split[0].amount_paise, 5_000);
        assert_eq!(split[1].amount_paise, 2_000);
        let exchange = plan_exchange_credit_allocations(&payments, 7_000).unwrap();
        assert_eq!(exchange.len(), 2);
        assert_eq!(
            exchange.iter().map(|row| row.amount_paise).sum::<i64>(),
            7_000
        );
    }

    #[test]
    fn return_disposition_requires_a_complete_product_split() {
        assert_eq!(
            refund_disposition("product", 4, Some(3), Some(1), false).unwrap(),
            (3, 1)
        );
        assert!(refund_disposition("product", 4, Some(2), Some(1), false).is_err());
        assert!(refund_disposition("service", 1, Some(1), Some(0), false).is_err());
        assert_eq!(
            refund_disposition("product", 2, None, None, true).unwrap(),
            (2, 0)
        );
    }
}

pub(crate) async fn refund_pos_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceLifecycleRequest>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    security_service::require_action_mfa(
        &state.db,
        state.settings.security_encryption_key.as_deref(),
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.session_id,
        payload.mfa_code.as_deref(),
        "pos.refund",
    )
    .await?;
    let reason = payload.reason.unwrap_or_default();
    require_lifecycle_reason(&reason, "refund")?;
    let notes = payload.notes.unwrap_or_default();
    let key = payload
        .idempotency_key
        .unwrap_or_default()
        .trim()
        .to_string();
    if key.is_empty() {
        return Err(AppError::validation(
            "idempotencyKey is required for refunds",
        ));
    }
    let refund_method = payload
        .refund_method
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let exchange_credit = refund_method == "exchange_credit";
    let requested_till_id = payload
        .cash_drawer_till_id
        .unwrap_or_default()
        .trim()
        .to_string();
    let requested_lines = payload.lines.unwrap_or_default();
    let restock_requested = payload.restock.unwrap_or(false);
    let evidence_reference = payload
        .evidence_reference
        .unwrap_or_default()
        .trim()
        .to_string();
    if !requested_lines.is_empty() && evidence_reference.is_empty() {
        return Err(AppError::validation(
            "evidenceReference is required for item returns",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start refund transaction"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    let inventory_policy = crate::repositories::purchase_repository::inventory_receipt_policy(
        &mut tx, &tenant_id, &branch_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load inventory lock policy"))?;
    let inventory_date = current_business_date();
    if inventory_policy
        .financial_lock_date
        .is_some_and(|lock| inventory_date <= lock)
    {
        return Err(AppError::conflict(
            "return date is inside the inventory financial lock period",
        ));
    }
    let sale_business_date = sqlx::query_scalar::<_, NaiveDate>(
        "SELECT COALESCE(business_date,created_at::DATE) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_one(&mut *tx).await
    .map_err(|_| AppError::internal("failed to load invoice business date"))?;
    if inventory_policy.edit_lock_days > 0
        && inventory_date
            .signed_duration_since(sale_business_date)
            .num_days()
            > i64::from(inventory_policy.edit_lock_days)
    {
        return Err(AppError::conflict(
            "invoice is outside the inventory edit window; post an approved correction entry",
        ));
    }
    if matches!(sale.status.as_str(), "draft" | "voided" | "cancelled") || sale.paid_paise <= 0 {
        return Err(AppError::validation(
            "only paid or partially paid invoices can be refunded",
        ));
    }
    if exchange_credit && sale.client_id.trim().is_empty() {
        return Err(AppError::validation(
            "client is required for exchange credit",
        ));
    }
    if !key.is_empty()
        && lifecycle_key_exists(
            &mut tx,
            "pos_invoice_refunds",
            &tenant_id,
            &branch_id,
            &id,
            &key,
        )
        .await?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate refund request"))?;
        return Ok(Json(ApiResponse::ok(
            load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
        )));
    }
    let refunded =
        sum_lifecycle_amount(&mut tx, "pos_invoice_refunds", &tenant_id, &branch_id, &id).await?;
    let remaining = sale.paid_paise.saturating_sub(refunded);
    if requested_lines.is_empty()
        && sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type IN ('membership','package','gift_card'))")
            .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_one(&mut *tx).await
            .map_err(|_| AppError::internal("failed to validate refundable liabilities"))?
    {
        return Err(AppError::validation(
            "membership, package, and gift card refunds require selected invoice lines",
        ));
    }
    let refund_lines = if requested_lines.is_empty() {
        Vec::new()
    } else {
        resolve_refund_lines(
            &mut tx,
            &tenant_id,
            &branch_id,
            &id,
            requested_lines,
            restock_requested,
        )
        .await?
    };
    let line_amount = refund_lines
        .iter()
        .fold(0i64, |sum, line| sum.saturating_add(line.amount_paise));
    let amount = if refund_lines.is_empty() {
        lifecycle_amount(payload.amount_paise, payload.amount, remaining)?
    } else {
        if let Some(requested_amount) = payload.amount_paise {
            if requested_amount != line_amount {
                return Err(AppError::validation(
                    "amountPaise must equal the selected return lines",
                ));
            }
        }
        if payload.amount.is_some() {
            return Err(AppError::validation(
                "amount cannot be used with selected return lines",
            ));
        }
        line_amount
    };
    if amount > remaining {
        return Err(AppError::validation("refund amount exceeds paid balance"));
    }
    security_service::enforce_role_limit(claims.max_refund_paise, amount, "refund")?;
    let next_refunded = refunded.saturating_add(amount);
    let next_status = if next_refunded >= sale.paid_paise {
        "refunded"
    } else {
        "partial_refund"
    };
    let refund_id = uuid::Uuid::new_v4().to_string();
    let (deferred_revenue_paise, customer_credit_paise) = reverse_unused_refunded_liabilities(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &refund_id,
        &sale.client_id,
        &claims.sub,
        &reason,
        &refund_lines,
    )
    .await?;
    let payments = refundable_payments(&mut tx, &tenant_id, &branch_id, &id).await?;
    let candidates = if exchange_credit {
        Vec::new()
    } else {
        gateway_refund_candidates(&mut tx, &tenant_id, &branch_id, &id).await?
    };
    let mut manual_refund_paise = amount;
    for payment in &candidates {
        let provider_amount = manual_refund_paise.min(payment.available_paise);
        manual_refund_paise = manual_refund_paise.saturating_sub(provider_amount);
        if manual_refund_paise == 0 {
            break;
        }
    }
    let manual_allocations = if exchange_credit {
        plan_exchange_credit_allocations(&payments, amount)?
    } else {
        plan_manual_refund_allocations(&payments, &refund_method, manual_refund_paise)?
    };
    let mut provider_results = Vec::new();
    let mut gateway_remaining = amount;
    if !candidates.is_empty() && gateway_remaining > 0 {
        if key.len() < 10
            || !key.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return Err(AppError::validation(
                "idempotencyKey must be at least 10 characters and contain only letters, numbers, hyphens, or underscores for gateway refunds",
            ));
        }
        for (index, payment) in candidates.into_iter().enumerate() {
            if gateway_remaining == 0 {
                break;
            }
            let provider_amount = gateway_remaining.min(payment.available_paise);
            let provider_key = format!("{key}-{index}");
            // ponytail: provider call holds the invoice lock; move to a durable refund worker if provider latency becomes a throughput concern.
            let (provider_refund_id, provider_status, provider_payload) =
                if payment.provider == "razorpay" {
                    if !state.settings.razorpay_payment_links_enabled() {
                        return Err(AppError::service_unavailable(
                            "PAYMENT_PROVIDER_NOT_CONFIGURED",
                            "Razorpay refund credentials are not configured",
                        ));
                    }
                    let result = razorpay_payment_service::create_payment_refund(
                        &state.settings,
                        &payment.provider_payment_id,
                        provider_amount,
                        &provider_key,
                        &refund_id,
                    )
                    .await?;
                    (result.provider_refund_id, result.status, result.payload)
                } else {
                    let result = payment_platform_service::refund_payment(
                        &state.settings,
                        &payment.provider,
                        &payment.provider_account_id,
                        &payment.provider_payment_id,
                        provider_amount,
                        &payment.currency,
                        &refund_id,
                        &provider_key,
                    )
                    .await?;
                    (result.provider_action_id, result.status, result.payload)
                };
            provider_results.push(GatewayRefundResult {
                pos_payment_id: payment.id,
                provider: payment.provider,
                provider_payment_id: payment.provider_payment_id,
                provider_refund_id,
                amount_paise: provider_amount,
                status: if matches!(
                    provider_status.to_ascii_lowercase().as_str(),
                    "processed" | "succeeded"
                ) {
                    "processed".to_string()
                } else {
                    "pending".to_string()
                },
                payload: provider_payload,
            });
            gateway_remaining = gateway_remaining.saturating_sub(provider_amount);
        }
    }
    let settlement_method = if exchange_credit {
        "exchange_credit"
    } else {
        "original_tender"
    };
    sqlx::query("INSERT INTO pos_invoice_refunds (id, tenant_id, branch_id, sale_id, actor_user_id, amount_paise, reason, notes, idempotency_key, settlement_method) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(&refund_id).bind(&tenant_id).bind(&branch_id).bind(&id).bind(&claims.sub).bind(amount).bind(&reason).bind(&notes).bind(&key).bind(settlement_method)
        .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save invoice refund"))?;
    let credit_note_number = create_refund_credit_note(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &refund_id,
        &claims.sub,
        amount,
        &reason,
        &notes,
    )
    .await?;
    let exchange_store_credit_id = if exchange_credit {
        let exchange_key = format!("exchange-{refund_id}");
        let result = wallet_repository::issue_store_credit_in_tx(
            &mut tx,
            StoreCreditIssue {
                tenant_id: &tenant_id,
                branch_id: &branch_id,
                client_id: &sale.client_id,
                amount_paise: amount,
                source_type: "exchange",
                source_id: &refund_id,
                expires_at: None,
                reason: &reason,
                idempotency_key: &exchange_key,
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to issue exchange credit"))?;
        match result {
            StoreCreditWriteResult::Saved(credit) => Some(credit.id),
            StoreCreditWriteResult::MissingClient => {
                return Err(AppError::not_found("client was not found"));
            }
            _ => return Err(AppError::conflict("exchange credit could not be issued")),
        }
    } else {
        None
    };
    if let Some(credit_id) = exchange_store_credit_id.as_ref() {
        sqlx::query("UPDATE pos_invoice_refunds SET exchange_store_credit_id=$4 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(&tenant_id).bind(&branch_id).bind(&refund_id).bind(credit_id)
            .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to link exchange credit"))?;
    }
    for provider_result in &provider_results {
        sqlx::query("INSERT INTO pos_gateway_refunds (tenant_id, branch_id, sale_id, refund_id, pos_payment_id, provider, provider_payment_id, provider_refund_id, amount_paise, status, idempotency_key, payload_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)")
            .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&refund_id).bind(&provider_result.pos_payment_id).bind(&provider_result.provider).bind(&provider_result.provider_payment_id).bind(&provider_result.provider_refund_id).bind(provider_result.amount_paise).bind(&provider_result.status).bind(format!("{key}-{}", provider_result.pos_payment_id)).bind(provider_result.payload.to_string())
            .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to record gateway refund"))?;
    }
    let mut payment_allocations = manual_allocations;
    for provider_result in &provider_results {
        let method = payments
            .iter()
            .find(|payment| payment.pos_payment_id == provider_result.pos_payment_id)
            .map(|payment| payment.method.clone())
            .ok_or_else(|| AppError::internal("gateway refund payment allocation was not found"))?;
        payment_allocations.push(RefundPaymentAllocation {
            pos_payment_id: provider_result.pos_payment_id.clone(),
            method,
            amount_paise: provider_result.amount_paise,
        });
    }
    let allocated_total = payment_allocations.iter().fold(0i64, |total, allocation| {
        total.saturating_add(allocation.amount_paise)
    });
    if allocated_total != amount {
        return Err(AppError::internal(
            "refund payment allocation is incomplete",
        ));
    }
    for allocation in &payment_allocations {
        sqlx::query("INSERT INTO pos_refund_payment_allocations (tenant_id,branch_id,refund_id,pos_payment_id,method,amount_paise) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(&tenant_id).bind(&branch_id).bind(&refund_id).bind(&allocation.pos_payment_id).bind(&allocation.method).bind(allocation.amount_paise)
            .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save refund payment allocation"))?;
    }
    for line in &refund_lines {
        sqlx::query("INSERT INTO pos_invoice_refund_lines (tenant_id, branch_id, refund_id, sale_id, sale_line_id, quantity, amount_paise, restock_requested, restock_quantity, discard_quantity, evidence_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(&tenant_id).bind(&branch_id).bind(&refund_id).bind(&id).bind(&line.sale_line_id).bind(line.quantity).bind(line.amount_paise).bind(line.restock_quantity>0).bind(line.restock_quantity).bind(line.discard_quantity).bind(&evidence_reference)
            .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save returned invoice line"))?;
        if line.restock_quantity > 0 {
            inventory_adjustment_service::restock_pos_product_return(
                &mut tx,
                &tenant_id,
                &branch_id,
                &id,
                &refund_id,
                &line.sale_line_id,
                &line.line_type,
                &line.item_id,
                line.restock_quantity,
                &claims.sub,
            )
            .await?;
        }
    }
    sqlx::query("UPDATE pos_sales SET status=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(next_status).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to update refund status"))?;
    membership_service::reverse_rewards_for_refund(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale.client_id,
        &sale.staff_id,
        &id,
        &refund_id,
        next_refunded,
        sale.total_paise,
    )
    .await?;
    let settlements = if exchange_credit {
        vec![accounting_service::RefundSettlement {
            method: "store_credit".to_string(),
            amount_paise: amount,
        }]
    } else {
        payment_allocations
            .iter()
            .map(|allocation| accounting_service::RefundSettlement {
                method: allocation.method.clone(),
                amount_paise: allocation.amount_paise,
            })
            .collect::<Vec<_>>()
    };
    let cash_refund_paise = settlements
        .iter()
        .filter(|settlement| settlement.method.eq_ignore_ascii_case("cash"))
        .fold(0i64, |total, settlement| {
            total.saturating_add(settlement.amount_paise)
        });
    if cash_refund_paise > 0 {
        cash_drawer_service::record_invoice_cash_refund(
            &mut tx,
            &tenant_id,
            &branch_id,
            &claims.sub,
            current_business_date(),
            &refund_id,
            cash_refund_paise,
            &requested_till_id,
        )
        .await?;
    }
    accounting_service::post_refund_with_liabilities(
        &mut tx,
        &tenant_id,
        &branch_id,
        &refund_id,
        &settlements,
        deferred_revenue_paise,
        customer_credit_paise,
    )
    .await?;
    reverse_happy_hour_lock(&mut tx, &tenant_id, &branch_id, &id, amount).await?;
    insert_pos_event_with_actor(&mut tx, &tenant_id, &branch_id, &id, &claims.sub, "invoice.refunded", serde_json::json!({ "invoiceNumber": sale.invoice_number, "amountPaise": amount, "creditNoteNumber": credit_note_number, "gatewayRefundPaise": if exchange_credit { 0 } else { amount.saturating_sub(gateway_remaining) }, "manualSettlementPaise": if exchange_credit { 0 } else { gateway_remaining }, "settlementMethod": settlement_method, "exchangeStoreCreditId": exchange_store_credit_id, "returnedLineCount": refund_lines.len(), "restockedQuantity": refund_lines.iter().map(|line|line.restock_quantity).sum::<i64>(), "discardedQuantity": refund_lines.iter().map(|line|line.discard_quantity).sum::<i64>(), "evidenceReference": evidence_reference, "status": next_status, "reason": reason })).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice refund"))?;
    state.publish_pos_event(&tenant_id, &branch_id, "invoice", &id, "invoice.refunded");
    Ok(Json(ApiResponse::ok(
        load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn credit_note_pos_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceLifecycleRequest>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reason = payload.reason.unwrap_or_default();
    require_lifecycle_reason(&reason, "credit note")?;
    let notes = payload.notes.unwrap_or_default();
    let key = payload.idempotency_key.unwrap_or_default();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start credit note transaction"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    if matches!(sale.status.as_str(), "draft" | "voided" | "cancelled") {
        return Err(AppError::validation(
            "draft, cancelled, or voided invoices cannot receive credit notes",
        ));
    }
    if !key.is_empty()
        && lifecycle_key_exists(
            &mut tx,
            "pos_credit_notes",
            &tenant_id,
            &branch_id,
            &id,
            &key,
        )
        .await?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate credit note request"))?;
        return Ok(Json(ApiResponse::ok(
            load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
        )));
    }
    let credited =
        sum_lifecycle_amount(&mut tx, "pos_credit_notes", &tenant_id, &branch_id, &id).await?;
    let remaining = sale.total_paise.saturating_sub(credited);
    let amount = lifecycle_amount(payload.amount_paise, payload.amount, remaining)?;
    if amount > remaining {
        return Err(AppError::validation(
            "credit note amount exceeds invoice total",
        ));
    }
    let credit_note_business_date = sqlx::query_scalar::<_, NaiveDate>("SELECT CURRENT_DATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to resolve credit note business date"))?;
    let credit_note_sequence = invoice_numbering_service::allocate(
        &mut tx,
        &tenant_id,
        &branch_id,
        "credit_note",
        credit_note_business_date,
    )
    .await?;
    let credit_note_number = credit_note_sequence.invoice_number.clone();
    let next_credited = credited.saturating_add(amount);
    let next_status = if next_credited >= sale.total_paise {
        "credit_note"
    } else {
        "credit_partial"
    };
    let credit_note_id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO pos_credit_notes (id, tenant_id, branch_id, sale_id, actor_user_id, credit_note_number, amount_paise, reason, notes, idempotency_key, fiscal_year, invoice_number_sequence_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(&credit_note_id).bind(&tenant_id).bind(&branch_id).bind(&id).bind(&claims.sub).bind(&credit_note_number).bind(amount).bind(&reason).bind(&notes).bind(&key).bind(&credit_note_sequence.fiscal_year).bind(&credit_note_sequence.sequence_id)
        .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save credit note"))?;
    sqlx::query("UPDATE pos_sales SET status=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(next_status).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to update credit note status"))?;
    accounting_service::post_credit_note(&mut tx, &tenant_id, &branch_id, &credit_note_id, amount)
        .await?;
    reverse_happy_hour_lock(&mut tx, &tenant_id, &branch_id, &id, amount).await?;
    insert_pos_event_with_actor(&mut tx, &tenant_id, &branch_id, &id, &claims.sub, "invoice.credit_note_created", serde_json::json!({ "invoiceNumber": sale.invoice_number, "creditNoteNumber": credit_note_number, "amountPaise": amount, "status": next_status, "reason": reason })).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit credit note"))?;
    Ok(Json(ApiResponse::ok(
        load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn list_pos_payments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PosPaymentQuery>,
) -> ApiResult<Vec<PosPaymentResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);

    let sale_id = query.sale_id.unwrap_or_default();
    let method = match query.method {
        Some(value) if !value.trim().is_empty() => normalize_payment_method(Some(value))?,
        _ => String::new(),
    };

    let rows = sqlx::query_as::<_, PosPaymentRow>(
        "SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, paid_at, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR sale_id=$3) AND ($4='' OR LOWER(method)=$4) ORDER BY paid_at DESC LIMIT $5 OFFSET $6",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(sale_id)
    .bind(method)
    .bind(page_size)
    .bind((page - 1) * page_size)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list pos payments"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(payment_response).collect(),
    )))
}

async fn list_pos_coupons(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<CouponResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, CouponResponse>(
        r#"
        SELECT id, code, discount_type, discount_value_paise, discount_bps,
               min_subtotal_paise, max_discount_paise, active, starts_at, ends_at,
               usage_limit, used_count, per_client_limit, offer_type, target_service_ids,
               target_service_categories, target_client_segments, first_visit_only, referral_required
          FROM pos_coupons
         WHERE tenant_id=$1 AND branch_id=$2
         ORDER BY created_at DESC
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list coupons"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_coupon_analytics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<happy_hours_repository::CouponAnalyticsRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = happy_hours_repository::coupon_analytics(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load coupon analytics"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_pos_coupon(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CouponWriteRequest>,
) -> ApiResult<CouponResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let code = normalize_coupon_code(Some(payload.code))?;
    if code.is_empty() {
        return Err(AppError::validation("coupon code is required"));
    }
    let discount_type = normalize_discount_type(
        payload
            .discount_type
            .unwrap_or_else(|| "amount".to_string()),
    );
    let value_paise = payload.discount_value_paise.unwrap_or(0).max(0);
    let bps = payload.discount_bps.unwrap_or(0).clamp(0, 10_000);
    if (discount_type == "amount" && value_paise <= 0) || (discount_type == "percent" && bps <= 0) {
        return Err(AppError::validation("coupon discount value is required"));
    }
    if payload
        .starts_at
        .zip(payload.ends_at)
        .is_some_and(|(start, end)| end < start)
    {
        return Err(AppError::validation(
            "coupon end date must be after start date",
        ));
    }
    let offer_type = payload
        .offer_type
        .unwrap_or_else(|| "generic".into())
        .trim()
        .to_ascii_lowercase();
    if !matches!(
        offer_type.as_str(),
        "generic" | "first_visit" | "referral" | "branch_specific" | "service_specific" | "segment"
    ) {
        return Err(AppError::validation("coupon offer type is invalid"));
    }
    let target_service_ids = normalize_happy_hour_filter(payload.target_service_ids);
    let target_service_categories = normalize_happy_hour_filter(payload.target_service_categories);
    let target_client_segments = normalize_happy_hour_filter(payload.target_client_segments);
    if offer_type == "service_specific"
        && target_service_ids.is_empty()
        && target_service_categories.is_empty()
    {
        return Err(AppError::validation(
            "service-specific coupon requires a service or category",
        ));
    }
    if offer_type == "segment" && target_client_segments.is_empty() {
        return Err(AppError::validation(
            "segment coupon requires at least one client segment",
        ));
    }
    let per_client_limit = payload.per_client_limit.unwrap_or(0);
    if per_client_limit < 0 || payload.usage_limit.is_some_and(|limit| limit <= 0) {
        return Err(AppError::validation("coupon usage limits are invalid"));
    }
    let row = sqlx::query_as::<_, CouponResponse>(
        r#"
        INSERT INTO pos_coupons (
          id, tenant_id, branch_id, code, discount_type, discount_value_paise, discount_bps,
          min_subtotal_paise, max_discount_paise, active, starts_at, ends_at, usage_limit,
          per_client_limit, offer_type, target_service_ids, target_service_categories,
          target_client_segments, first_visit_only, referral_required
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING id, code, discount_type, discount_value_paise, discount_bps,
                  min_subtotal_paise, max_discount_paise, active, starts_at, ends_at,
                  usage_limit, used_count, per_client_limit, offer_type, target_service_ids,
                  target_service_categories, target_client_segments, first_visit_only, referral_required
        "#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(code)
    .bind(discount_type)
    .bind(value_paise)
    .bind(bps)
    .bind(payload.min_subtotal_paise.unwrap_or(0).max(0))
    .bind(payload.max_discount_paise.unwrap_or(0).max(0))
    .bind(payload.active.unwrap_or(true))
    .bind(payload.starts_at)
    .bind(payload.ends_at)
    .bind(payload.usage_limit)
    .bind(per_client_limit)
    .bind(&offer_type)
    .bind(target_service_ids)
    .bind(target_service_categories)
    .bind(target_client_segments)
    .bind(offer_type == "first_visit")
    .bind(offer_type == "referral")
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::validation("coupon code already exists"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_pos_discount_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<DiscountRuleResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, DiscountRuleResponse>(
        r#"
        SELECT id, rule_type, name, active, starts_at, ends_at,
               max_discount_bps, max_discount_paise, min_payable_paise, priority
          FROM pos_discount_rules
         WHERE tenant_id=$1 AND branch_id=$2
         ORDER BY priority ASC, created_at DESC
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to list discount rules"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_pos_discount_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<DiscountRuleWriteRequest>,
) -> ApiResult<DiscountRuleResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rule_type = match payload.rule_type.trim().to_lowercase().as_str() {
        "profit_guard" | "profit-guard" => "profit_guard".to_string(),
        "happy_hours" | "happy-hours" => "happy_hours".to_string(),
        _ => {
            return Err(AppError::validation(
                "ruleType must be profit_guard or happy_hours",
            ));
        }
    };
    let max_bps = payload.max_discount_bps.unwrap_or(0).clamp(0, 10_000);
    let max_paise = payload.max_discount_paise.unwrap_or(0).max(0);
    let min_payable = payload.min_payable_paise.unwrap_or(0).max(0);
    if max_bps == 0 && max_paise == 0 && min_payable == 0 {
        return Err(AppError::validation(
            "discount rule needs at least one guard",
        ));
    }
    let row = sqlx::query_as::<_, DiscountRuleResponse>(
        r#"
        INSERT INTO pos_discount_rules (
          id, tenant_id, branch_id, rule_type, name, active, starts_at, ends_at,
          max_discount_bps, max_discount_paise, min_payable_paise, priority
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id, rule_type, name, active, starts_at, ends_at,
                  max_discount_bps, max_discount_paise, min_payable_paise, priority
        "#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(rule_type)
    .bind(payload.name.unwrap_or_default())
    .bind(payload.active.unwrap_or(true))
    .bind(payload.starts_at)
    .bind(payload.ends_at)
    .bind(max_bps)
    .bind(max_paise)
    .bind(min_payable)
    .bind(payload.priority.unwrap_or(100))
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to create discount rule"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_pos_gift_card(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<GiftCardCreateRequest>,
) -> ApiResult<Value> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if payload.amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    let idempotency_key = payload.idempotency_key.as_deref().unwrap_or("").trim();
    if idempotency_key.is_empty() {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    let reason = payload.notes.as_deref().unwrap_or("").trim();
    if reason.is_empty() {
        return Err(AppError::validation(
            "notes are required for manual gift card issue",
        ));
    }
    if let Some(card) = sqlx::query_as::<_, (String, String, i64, i64, String, Option<NaiveDate>)>(
        "SELECT id, code, initial_amount_paise, balance_paise, status, expires_at FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(idempotency_key)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load gift card"))? {
        return Ok(Json(ApiResponse::ok(serde_json::json!({
            "id": card.0, "code": card.1, "initialAmountPaise": card.2, "balancePaise": card.3, "status": card.4, "expiresAt": card.5
        }))));
    }
    let code = payload
        .code
        .unwrap_or_else(|| format!("GC-{}", &uuid::Uuid::new_v4().to_string()[..8]))
        .trim()
        .to_ascii_uppercase();
    if code.is_empty() {
        return Err(AppError::validation("code is required"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start gift card transaction"))?;
    let card = sqlx::query_as::<_, (String, String, i64, i64, String, Option<NaiveDate>)>(
        "INSERT INTO gift_cards (tenant_id, branch_id, code, client_id, initial_amount_paise, balance_paise, expires_at, idempotency_key) VALUES ($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id, code, initial_amount_paise, balance_paise, status, expires_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&code)
    .bind(payload.client_id.unwrap_or_default())
    .bind(payload.amount_paise)
    .bind(payload.expires_at)
    .bind(idempotency_key)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| AppError::validation("gift card code or idempotency key already exists"))?;
    sqlx::query("INSERT INTO gift_card_transactions (tenant_id, branch_id, gift_card_id, transaction_type, delta_paise, balance_after_paise, idempotency_key, notes) VALUES ($1,$2,$3,'issue',$4,$4,$5,$6)")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&card.0)
        .bind(payload.amount_paise)
        .bind(idempotency_key)
        .bind(payload.notes.as_deref().unwrap_or(""))
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to save gift card issue"))?;
    accounting_service::post_customer_credit_change(
        &mut tx,
        &tenant_id,
        &branch_id,
        "gift_card_manual_issue",
        &card.0,
        "Manual gift card issue",
        payload.amount_paise,
        "GIFT_CARD_PROMOTION_EXPENSE",
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit gift card"))?;
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "gift_card.manual_issue",
        serde_json::json!({"giftCardId":&card.0,"amountPaise":payload.amount_paise,"reason":reason}),
    )
    .await?;
    Ok(Json(ApiResponse::ok(serde_json::json!({
        "id": card.0, "code": card.1, "initialAmountPaise": card.2, "balancePaise": card.3, "status": card.4, "expiresAt": card.5, "notes": payload.notes.unwrap_or_default()
    }))))
}

async fn pos_payment_methods(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<PaymentMethodResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = payment_methods_repository::list(&state.db, &tenant_id, &branch_id, true)
        .await
        .map_err(|_| AppError::internal("failed to list payment methods"))?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(payment_method_response).collect(),
    )))
}

async fn pos_payment_method_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<PaymentMethodResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = payment_methods_repository::list(&state.db, &tenant_id, &branch_id, false)
        .await
        .map_err(|_| AppError::internal("failed to list payment method settings"))?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(payment_method_response).collect(),
    )))
}

async fn initialize_pos_payment_methods(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<PaymentMethodResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    payment_methods_repository::ensure_defaults(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to initialize payment methods"))?;
    pos_payment_method_settings(State(state), headers).await
}

async fn create_pos_payment_method(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PaymentMethodWriteRequest>,
) -> ApiResult<PaymentMethodResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let name = payload
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("name is required"))?;
    let settlement_type =
        normalize_payment_settlement_type(payload.settlement_type.as_deref().unwrap_or("custom"))?;
    let code = payment_method_code(name);
    let row = payment_methods_repository::create(
        &state.db,
        CreatePaymentMethod {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            code: &code,
            name,
            settlement_type: &settlement_type,
            shortcut: payload.shortcut.as_deref().unwrap_or("").trim(),
            active: payload.active.unwrap_or(true),
            show_on_invoice: payload.show_on_invoice.unwrap_or(true),
            reference_required: payload.reference_required.unwrap_or(false),
            sort_order: payload.sort_order.unwrap_or(100),
        },
    )
    .await
    .map_err(|_| AppError::validation("payment mode name already exists"))?;
    Ok(Json(ApiResponse::ok(payment_method_response(row))))
}

async fn update_pos_payment_method(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PaymentMethodWriteRequest>,
) -> ApiResult<PaymentMethodResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let settlement_type = payload
        .settlement_type
        .as_deref()
        .map(normalize_payment_settlement_type)
        .transpose()?;
    let row = payment_methods_repository::update(
        &state.db,
        UpdatePaymentMethod {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            name: payload
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
            settlement_type: settlement_type.as_deref(),
            shortcut: payload.shortcut.as_deref().map(str::trim),
            active: payload.active,
            show_on_invoice: payload.show_on_invoice,
            reference_required: payload.reference_required,
            sort_order: payload.sort_order,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to update payment method"))?
    .ok_or_else(|| AppError::not_found("payment mode was not found"))?;
    Ok(Json(ApiResponse::ok(payment_method_response(row))))
}

fn payment_method_response(row: PaymentMethodRecord) -> PaymentMethodResponse {
    PaymentMethodResponse {
        id: row.id,
        code: row.code,
        name: row.name,
        settlement_type: row.settlement_type,
        shortcut: row.shortcut,
        active: row.active,
        show_on_invoice: row.show_on_invoice,
        reference_required: row.reference_required,
        sort_order: row.sort_order,
    }
}

fn payment_method_code(name: &str) -> String {
    let code = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let code = code.trim_matches('_').to_string();
    if code.is_empty() {
        "custom".to_string()
    } else {
        code
    }
}

fn normalize_payment_settlement_type(value: &str) -> Result<String, AppError> {
    let normalized = value.trim().to_lowercase().replace([' ', '-'], "_");
    match normalized.as_str() {
        "cash" | "upi" | "card" | "wallet" | "bank_transfer" | "gift_card" | "store_credit"
        | "custom" => Ok(normalized),
        _ => Err(AppError::validation("invalid settlement type")),
    }
}

async fn pos_dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<PosDashboard> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;

    let total_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(total_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','voided','cancelled')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to fetch total sales"))?
    .max(0);

    let paid_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(paid_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','voided','cancelled')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to fetch paid sales"))?
    .max(0);

    let start_today = Utc::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc();
    let end_today = Utc::now()
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .unwrap()
        .and_utc();
    let today_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(total_paise),0)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','voided','cancelled') AND created_at BETWEEN $3 AND $4",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_today)
    .bind(end_today)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to fetch today's sales"))?
    .max(0);

    let open_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('draft','open','partial')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to fetch open sales"))?
    .max(0);

    let raw_sales = sqlx::query_as::<_, PosSaleRow>(
        r#"
        SELECT id, tenant_id, branch_id, client_id, staff_id, invoice_number,
               subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
               tip_paise, round_off_paise, total_paise, paid_paise,
               status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at
        FROM pos_sales
        WHERE tenant_id=$1
          AND branch_id=$2
        ORDER BY created_at DESC
        LIMIT 5
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load recent pos sales"))?;

    let mut recent_sales: Vec<PosSaleResponse> = Vec::with_capacity(raw_sales.len());
    for sale in raw_sales {
        let line_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&sale.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        recent_sales.push(sale_response(sale, line_count));
    }

    Ok(Json(ApiResponse::ok(PosDashboard {
        total_sales,
        paid_sales,
        outstanding_sales: total_sales.saturating_sub(paid_sales),
        today_sales,
        open_sales,
        recent_sales: recent_sales,
    })))
}

async fn read_gst_totals_for_sale_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(i64, i64, i64), AppError> {
    sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT cgst_paise, sgst_paise, igst_paise FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load invoice GST totals"))?
    .ok_or_else(|| AppError::not_found("pos invoice was not found"))
}

async fn insert_pos_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<(), AppError> {
    insert_pos_event_with_actor(tx, tenant_id, branch_id, sale_id, "", event_type, payload).await
}

pub(crate) async fn append_pos_invoice_event_from_gateway(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    gateway: &str,
    event_type: &str,
    payload: Value,
) -> Result<(), AppError> {
    insert_pos_event_with_actor(
        tx, tenant_id, branch_id, sale_id, gateway, event_type, payload,
    )
    .await
}

async fn insert_pos_event_with_actor(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    actor_user_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<(), AppError> {
    let event_id = uuid::Uuid::new_v4().to_string();
    let payload_text = payload.to_string();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("{}:{}:{}", tenant_id, branch_id, sale_id))
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock invoice ledger"))?;
    let created_at = sqlx::query_scalar::<_, DateTime<Utc>>("SELECT NOW()")
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to timestamp invoice ledger"))?;
    let previous_hash = sqlx::query_scalar::<_, String>(
        "SELECT event_hash FROM pos_invoice_event_chain WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY sequence DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to read invoice ledger"))?
    .unwrap_or_default();
    sqlx::query(
        r#"
        INSERT INTO pos_invoice_events (
            id, tenant_id, branch_id, sale_id, event_type, actor_user_id, payload_json, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
        "#,
    )
    .bind(&event_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(event_type)
    .bind(actor_user_id)
    .bind(&payload_text)
    .bind(created_at)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to write invoice event"))?;

    let event_hash = invoice_event_hash(
        tenant_id,
        branch_id,
        sale_id,
        event_type,
        actor_user_id,
        &created_at.to_rfc3339(),
        &payload_text,
        &previous_hash,
    );
    sqlx::query(
        "INSERT INTO pos_invoice_event_chain (tenant_id, branch_id, sale_id, event_id, event_type, actor_user_id, payload_text, previous_hash, event_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(&event_id)
    .bind(event_type)
    .bind(actor_user_id)
    .bind(&payload_text)
    .bind(&previous_hash)
    .bind(&event_hash)
    .bind(created_at)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to write invoice ledger"))?;

    Ok(())
}

fn invoice_event_hash(
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    event_type: &str,
    actor_user_id: &str,
    created_at: &str,
    payload_text: &str,
    previous_hash: &str,
) -> String {
    let input = [
        tenant_id,
        branch_id,
        sale_id,
        event_type,
        actor_user_id,
        created_at,
        payload_text,
        previous_hash,
    ]
    .join("|");
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

async fn reverse_happy_hour_lock(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    reversal_paise: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE pos_happy_hour_locks SET reversed_paise=CASE WHEN $4 >= discount_paise THEN discount_paise ELSE LEAST(discount_paise, reversed_paise + $4) END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(reversal_paise.max(0))
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to reverse happy hour discount"))?;
    Ok(())
}

/// The fields a PATCH may no longer touch once the invoice is finalized.
///
/// `status` decides whether payroll counts the sale at all, so flipping it here
/// would move money while bypassing void, refund and credit note — the paths
/// that actually reverse the ledger and ask for approval. `source` and
/// `reference_id` are what a settlement is reconciled against; rewriting them
/// breaks the match without changing a single number, which is the hardest kind
/// of discrepancy to chase down later.
fn refuse_frozen_finalized_fields(payload: &PosSaleUpdate) -> Result<(), AppError> {
    if payload.status.is_some() {
        return Err(AppError::validation(
            "a finalized invoice's status cannot be patched; use void, refund or credit note",
        ));
    }
    if payload.source.is_some() || payload.reference_id.is_some() {
        return Err(AppError::validation(
            "a finalized invoice's source and reference cannot be changed",
        ));
    }
    Ok(())
}

fn require_lifecycle_reason(reason: &str, action: &str) -> Result<(), AppError> {
    if reason.trim().len() < 3 {
        return Err(AppError::validation(format!(
            "reason is required for invoice {}",
            action
        )));
    }
    Ok(())
}

async fn load_pos_sale(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<PosSaleRow, AppError> {
    let sale_query = format!(
        "{} WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
        sale_select_sql()
    );

    sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(sale_id)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load pos invoice"))?
        .ok_or_else(|| AppError::not_found("pos invoice was not found"))
}

async fn load_sale_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<PosSaleRow, AppError> {
    let sale_query = format!(
        "{} WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 FOR UPDATE",
        sale_select_sql()
    );
    let sale = sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(sale_id)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock pos invoice"))?
        .ok_or_else(|| AppError::not_found("pos invoice was not found"))?;
    let day_locked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pos_day_locks l JOIN pos_sales s ON s.tenant_id=l.tenant_id AND s.branch_id=l.branch_id AND s.business_date=l.business_date WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND l.status='locked')")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate POS business day"))?;
    if day_locked {
        return Err(AppError::conflict("POS business day is locked"));
    }
    Ok(sale)
}

fn lifecycle_table(table: &str) -> Result<&'static str, AppError> {
    match table {
        "pos_invoice_voids" => Ok("pos_invoice_voids"),
        "pos_invoice_refunds" => Ok("pos_invoice_refunds"),
        "pos_credit_notes" => Ok("pos_credit_notes"),
        _ => Err(AppError::internal("invalid invoice lifecycle table")),
    }
}

async fn lifecycle_key_exists(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    key: &str,
) -> Result<bool, AppError> {
    let table = lifecycle_table(table)?;
    let query = format!(
        "SELECT id FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4"
    );
    let found = sqlx::query_scalar::<_, String>(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .bind(key)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to read invoice lifecycle idempotency key"))?;
    Ok(found.is_some())
}

async fn sum_lifecycle_amount(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<i64, AppError> {
    let table = lifecycle_table(table)?;
    let query = format!(
        "SELECT COALESCE(SUM(amount_paise), 0)::BIGINT FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3"
    );
    sqlx::query_scalar::<_, i64>(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to total invoice lifecycle amount"))
}

fn lifecycle_amount(
    amount_paise: Option<i64>,
    amount: Option<f64>,
    default_paise: i64,
) -> Result<i64, AppError> {
    let amount =
        amount_paise.unwrap_or_else(|| amount.map(rupees_to_paise).unwrap_or(default_paise));
    if amount <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    Ok(amount)
}

pub(crate) async fn load_pos_sale_details(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<PosSaleDetailsResponse, AppError> {
    let sale = load_pos_sale(state, tenant_id, branch_id, sale_id).await?;
    let lines = read_lines(state, tenant_id, branch_id, sale_id).await?;
    let payments = read_payments(state, tenant_id, branch_id, sale_id).await?;
    let client_kpi = read_client_kpi(state, tenant_id, branch_id, &sale.client_id).await?;
    let response = sale_response(sale, lines.len() as i64);
    let payment_split = payment_split_response(&payments, response.total_paise);
    let transaction_context =
        read_pos_transaction_context(state, tenant_id, branch_id, sale_id).await?;

    Ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments,
        payment_split,
        client_kpi,
        transaction_context,
    })
}

async fn read_pos_transaction_context(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<PosTransactionContext, AppError> {
    sqlx::query_as::<_, (String, i64, String, String, String, bool, String, bool)>(
        "SELECT discount_reason,cart_version,cart_owner_terminal_id,buyer_gstin,place_of_supply_state_code,reverse_charge,tax_mode,separate_group_invoice FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load POS transaction context"))?
    .map(|row| PosTransactionContext {
        discount_reason: row.0,
        cart_version: row.1,
        cart_owner_terminal_id: row.2,
        buyer_gstin: row.3,
        place_of_supply_state_code: row.4,
        reverse_charge: row.5,
        tax_mode: row.6,
        separate_group_invoice: row.7,
    })
    .ok_or_else(|| AppError::not_found("pos invoice was not found"))
}

async fn read_line_drafts(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<LineDraft>, AppError> {
    let rows = read_line_rows(state, tenant_id, branch_id, sale_id).await?;

    Ok(rows
        .iter()
        .map(|row| LineDraft {
            id: Some(row.id.clone()),
            input: line_input_from_row(row),
        })
        .collect())
}

async fn replace_invoice_lines(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale: &PosSaleRow,
    drafts: Vec<LineDraft>,
    event_type: &str,
    max_discount_paise: Option<i64>,
) -> Result<(), AppError> {
    let line_count = drafts.len();
    let mut payload = line_payload_for_recalc(sale, &drafts);
    hydrate_appointment_booked_prices(state, tenant_id, branch_id, &mut payload).await?;
    resolve_coupon_discount(state, tenant_id, branch_id, &mut payload).await?;
    let gst_context = gst_context_from_sale(state, tenant_id, branch_id, &sale.id).await?;
    let mut calculation = calculate_pos(&payload)?;
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(
        state,
        tenant_id,
        branch_id,
        &calculation,
        max_discount_paise,
    )
    .await?;

    if sale.paid_paise > calculation.total_paise {
        return Err(AppError::validation(
            "invoice total cannot be lower than already collected payments",
        ));
    }

    let new_status = if sale.status == "draft" {
        "draft".to_string()
    } else {
        status_for(calculation.total_paise, sale.paid_paise)
    };

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start line item transaction"))?;

    sqlx::query(
        r#"
        DELETE FROM pos_sale_lines
        WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&sale.id)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to replace invoice lines"))?;

    for (draft, line) in drafts.into_iter().zip(calculation.lines.into_iter()) {
        let line_id = draft.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        insert_calculated_line(&mut tx, tenant_id, branch_id, &sale.id, &line_id, line).await?;
    }

    sqlx::query(
        r#"
        UPDATE pos_sales
           SET subtotal_paise=$4,
               bill_discount_paise=$5,
               coupon_code=$6,
               coupon_discount_paise=$7,
               discount_paise=$8,
               tax_paise=$9,
               cgst_paise=$10,
               sgst_paise=$11,
               igst_paise=$12,
               tip_paise=$13,
               round_off_paise=$14,
               total_paise=$15,
               status=$16,
               updated_at=NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&sale.id)
    .bind(calculation.subtotal_paise)
    .bind(calculation.bill_discount_paise)
    .bind(&calculation.coupon_code)
    .bind(calculation.coupon_discount_paise)
    .bind(calculation.discount_paise)
    .bind(calculation.tax_paise)
    .bind(calculation.cgst_paise)
    .bind(calculation.sgst_paise)
    .bind(calculation.igst_paise)
    .bind(calculation.tip_paise)
    .bind(calculation.round_off_paise)
    .bind(calculation.total_paise)
    .bind(&new_status)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to recalculate invoice totals"))?;

    insert_pos_event(
        &mut tx,
        tenant_id,
        branch_id,
        &sale.id,
        event_type,
        serde_json::json!({
            "lineCount": line_count,
            "totalPaise": calculation.total_paise,
            "discountPaise": calculation.discount_paise,
            "couponCode": calculation.coupon_code,
            "couponDiscountPaise": calculation.coupon_discount_paise,
            "gstPaise": calculation.tax_paise,
            "status": new_status
        }),
    )
    .await?;

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit line item changes"))?;

    Ok(())
}

async fn insert_calculated_line(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    line_id: &str,
    line: CalculatedLine,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO pos_sale_lines (
          id, tenant_id, branch_id, sale_id, line_type, item_id, item_name,
          staff_id, staff_splits, quantity, unit_price_paise, other_fee_paise, gross_paise, taxable_paise,
          discount_paise, discount_type, discount_value_paise, discount_bps,
          tax_percent, gst_paise, hsn_sac_code, cgst_paise, sgst_paise, igst_paise, reverse_charge,
          line_total_paise, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW(),NOW())
        "#,
    )
    .bind(line_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(&line.line_type)
    .bind(&line.item_id)
    .bind(&line.item_name)
    .bind(&line.staff_id)
    .bind(&line.staff_splits)
    .bind(line.quantity)
    .bind(line.unit_price_paise)
    .bind(line.other_fee_paise)
    .bind(line.gross_paise)
    .bind(line.taxable_paise)
    .bind(line.discount_paise)
    .bind(&line.discount_type)
    .bind(line.discount_value_paise)
    .bind(line.discount_bps)
    .bind(line.tax_percent)
    .bind(line.gst_paise)
    .bind(&line.hsn_sac_code)
    .bind(line.cgst_paise)
    .bind(line.sgst_paise)
    .bind(line.igst_paise)
    .bind(line.reverse_charge)
    .bind(line.line_total_paise)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to save invoice line"))?;

    Ok(())
}

fn package_redemption_string(row: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| row.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn package_redemption_i32(row: &Value, keys: &[&str]) -> i32 {
    keys.iter()
        .find_map(|key| row.get(*key))
        .and_then(|value| {
            value.as_i64().or_else(|| {
                value
                    .as_str()
                    .and_then(|raw| raw.trim().parse::<i64>().ok())
            })
        })
        .unwrap_or(0)
        .clamp(0, i32::MAX as i64) as i32
}

fn package_redemption_i64(row: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| row.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_str().and_then(|raw| raw.trim().parse().ok()))
        })
        .unwrap_or(0)
}

fn normalize_package_redemptions(raw: Value) -> Result<Value, AppError> {
    let rows = match raw {
        Value::Array(rows) => rows,
        _ => return Err(AppError::validation("package redemptions must be a list")),
    };
    if rows.len() > 25 {
        return Err(AppError::validation("too many package redemption rows"));
    }

    let mut normalized = Vec::new();
    for row in rows {
        if !row.is_object() {
            return Err(AppError::validation("package redemption row is invalid"));
        }
        let quantity =
            package_redemption_i32(&row, &["quantity", "qty", "redeemQty", "redeem_qty"]);
        if quantity <= 0 {
            continue;
        }
        let credit_id = package_redemption_string(
            &row,
            &[
                "clientPackageCreditId",
                "client_package_credit_id",
                "creditId",
                "credit_id",
                "id",
            ],
        );
        let package_id = package_redemption_string(&row, &["packageId", "package_id"]);
        let service_id = package_redemption_string(&row, &["serviceId", "service_id"]);
        if credit_id.is_empty() || package_id.is_empty() || service_id.is_empty() {
            return Err(AppError::validation(
                "package redemption requires package and service credit",
            ));
        }
        normalized.push(serde_json::json!({
            "clientPackageCreditId": credit_id,
            "packageId": package_id,
            "packageName": package_redemption_string(&row, &["packageName", "package_name"]),
            "serviceId": service_id,
            "serviceName": package_redemption_string(&row, &["serviceName", "service_name"]),
            "staffId": package_redemption_string(&row, &["staffId", "staff_id"]),
            "quantity": quantity
        }));
    }

    Ok(Value::Array(normalized))
}

fn package_service_rows(raw: &Value) -> Vec<(String, String, i32)> {
    let rows = if let Some(rows) = raw.as_array() {
        rows.clone()
    } else if let Some(rows) = raw.get("services").and_then(Value::as_array) {
        rows.clone()
    } else {
        Vec::new()
    };

    rows.into_iter()
        .filter_map(|row| {
            if let Some(id) = row.as_str() {
                let service_id = id.trim().to_string();
                return (!service_id.is_empty()).then_some((service_id.clone(), service_id, 1));
            }
            let service_id = package_redemption_string(&row, &["serviceId", "service_id", "id"]);
            if service_id.is_empty() {
                return None;
            }
            let service_name =
                package_redemption_string(&row, &["serviceName", "service_name", "name"]);
            let qty = package_redemption_i32(
                &row,
                &["quantity", "qty", "credits", "totalQty", "total_qty"],
            )
            .max(1);
            Some((
                service_id.clone(),
                if service_name.is_empty() {
                    service_id
                } else {
                    service_name
                },
                qty,
            ))
        })
        .collect()
}

fn allocate_package_credit_values(
    sale_value_paise: i64,
    line_quantity: i64,
    raw: &Value,
) -> Vec<(String, String, i32, i64, i64)> {
    let multiplier = line_quantity.clamp(1, i32::MAX as i64) as i32;
    let rows = package_service_rows(raw)
        .into_iter()
        .map(|(service_id, service_name, quantity)| {
            let unit_price = raw
                .as_array()
                .and_then(|items| {
                    items.iter().find(|item| {
                        package_redemption_string(item, &["serviceId", "service_id", "id"])
                            == service_id
                    })
                })
                .map(|item| {
                    package_redemption_i64(
                        item,
                        &[
                            "unitPricePaise",
                            "unit_price_paise",
                            "unitPrice",
                            "pricePaise",
                        ],
                    )
                    .max(0)
                })
                .unwrap_or(0);
            (
                service_id,
                service_name,
                quantity.saturating_mul(multiplier),
                unit_price,
            )
        })
        .collect::<Vec<_>>();
    let total_value = sale_value_paise.max(0);
    let catalog_weight = rows
        .iter()
        .map(|row| i64::from(row.2).saturating_mul(row.3))
        .sum::<i64>();
    let quantity_weight = rows.iter().map(|row| i64::from(row.2)).sum::<i64>();
    let total_weight = if catalog_weight > 0 {
        catalog_weight
    } else {
        quantity_weight
    };
    let mut allocated = 0_i64;
    let last = rows.len().saturating_sub(1);
    rows.into_iter()
        .enumerate()
        .map(
            |(index, (service_id, service_name, total_qty, unit_price))| {
                let weight = if catalog_weight > 0 {
                    i64::from(total_qty).saturating_mul(unit_price)
                } else {
                    i64::from(total_qty)
                };
                let issued = if index == last {
                    total_value.saturating_sub(allocated)
                } else if total_weight > 0 {
                    total_value.saturating_mul(weight) / total_weight
                } else {
                    0
                };
                allocated = allocated.saturating_add(issued);
                let unit_value = if total_qty > 0 {
                    issued / i64::from(total_qty)
                } else {
                    0
                };
                (service_id, service_name, total_qty, issued, unit_value)
            },
        )
        .collect()
}

async fn load_pos_package_settings(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    Ok(sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM package_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load package settings"))?
    .unwrap_or_else(|| serde_json::json!({})))
}

async fn load_pos_membership_settings(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    Ok(sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM membership_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load membership settings"))?
    .unwrap_or_else(|| serde_json::json!({})))
}

fn reward_points_in_payload(payload: &PosSalePayload) -> i64 {
    payload
        .lines
        .as_ref()
        .or(payload.items.as_ref())
        .into_iter()
        .flatten()
        .filter(|line| {
            line.line_type
                .as_deref()
                .or(line.item_type.as_deref())
                .or(line.kind.as_deref())
                .is_some_and(|value| value.eq_ignore_ascii_case("redemption"))
                && line
                    .item_id
                    .as_deref()
                    .or(line.id.as_deref())
                    .is_some_and(|value| value.eq_ignore_ascii_case("reward_points"))
        })
        .fold(0i64, |sum, line| {
            sum.saturating_add(line.quantity.unwrap_or(0).max(0))
        })
}

fn reward_discount_for_points(points: i64, point_value_paise: i64) -> Option<i64> {
    (points > 0 && point_value_paise > 0)
        .then(|| points.checked_mul(point_value_paise))
        .flatten()
}

fn membership_discount_paise(gross_paise: i64, discount_percent: i32) -> i64 {
    gross_paise
        .max(0)
        .saturating_mul(i64::from(discount_percent.clamp(0, 100)))
        .saturating_add(50)
        / 100
}

async fn apply_membership_benefits(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payload: &mut PosSalePayload,
    current: &PosCalculation,
) -> Result<bool, AppError> {
    let points = reward_points_in_payload(payload);
    let has_marked_discount = payload
        .lines
        .as_ref()
        .or(payload.items.as_ref())
        .into_iter()
        .flatten()
        .any(|line| {
            matches!(
                line.discount_type.as_deref(),
                Some("membership" | "membership_stacked")
            )
        });
    let client_id = payload
        .client_id
        .as_deref()
        .or(payload.customer_id.as_deref())
        .unwrap_or("")
        .trim();
    if client_id.is_empty() {
        if points > 0 || has_marked_discount {
            return Err(AppError::validation(
                "active membership is required for benefits",
            ));
        }
        return Ok(false);
    }

    let settings = membership_service::membership_settings(&state.db, tenant_id, branch_id).await?;
    let eligibility =
        membership_service::client_eligibility(&state.db, tenant_id, branch_id, client_id).await?;
    let reward_membership_eligible = if points > 0 {
        sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(
          SELECT 1 FROM client_memberships cm
          JOIN memberships membership ON membership.id=cm.membership_id
            AND membership.tenant_id=cm.tenant_id AND membership.branch_id=cm.branch_id AND membership.active=TRUE
          WHERE cm.tenant_id=$1 AND cm.active=TRUE AND cm.frozen_at IS NULL
            AND cm.assigned_at<=NOW() AND (cm.expires_at IS NULL OR cm.expires_at>=NOW())
            AND ((cm.branch_id=$2 AND cm.client_id=$3)
              OR membership_cross_location_allowed($1,cm.branch_id,$2,cm.client_id,$3,'loyalty')))"#)
            .bind(tenant_id).bind(branch_id).bind(client_id).fetch_one(&state.db).await
            .map_err(|_| AppError::internal("failed to validate loyalty sharing"))?
    } else {
        false
    };
    if has_marked_discount && eligibility.is_none() {
        return Err(AppError::validation(
            "active membership is required for benefits",
        ));
    }
    if points > 0 && !reward_membership_eligible {
        return Err(AppError::validation(
            "active membership with shared loyalty is required for reward redemption",
        ));
    }
    if eligibility.is_none() && points == 0 {
        if has_marked_discount {
            return Err(AppError::validation(
                "active membership is required for benefits",
            ));
        }
        return Ok(false);
    }
    let rewards_enabled =
        package_setting_bool(&settings, &["creditsBenefits", "rewardPointsEnabled"], true);
    let discounts_enabled = package_setting_bool(
        &settings,
        &["creditsBenefits", "discountBenefitsEnabled"],
        true,
    );
    let allow_stacking = package_setting_bool(
        &settings,
        &["creditsBenefits", "allowBenefitStacking"],
        false,
    );
    if points > 0 && !rewards_enabled {
        return Err(AppError::validation("reward redemption is disabled"));
    }
    let other_discount_paise = current
        .discount_paise
        .saturating_sub(payload.reward_discount_paise.unwrap_or(0).max(0));
    if points > 0 && !allow_stacking && other_discount_paise > 0 {
        return Err(AppError::validation(
            "reward points cannot be combined with other discounts",
        ));
    }

    let service_ids = eligibility
        .as_ref()
        .and_then(|value| value.service_ids.as_array())
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let fallback_staff_id = payload.staff_id.clone().unwrap_or_default();
    let apply_discount = discounts_enabled
        && eligibility
            .as_ref()
            .is_some_and(|value| value.discount_percent > 0)
        && (allow_stacking || (points == 0 && current.discount_paise == 0));
    let mut changed = false;
    if let Some(lines) = payload.lines.as_mut().or(payload.items.as_mut()) {
        for line in lines {
            let source = line.discount_type.as_deref().unwrap_or("");
            let marked = matches!(source, "membership" | "membership_stacked");
            let normalized = normalize_line(line.clone(), &fallback_staff_id)?;
            let eligible_service = normalized.line_type == "service"
                && (service_ids.is_empty() || service_ids.contains(&normalized.item_id));
            if marked {
                if !discounts_enabled || !eligible_service {
                    return Err(AppError::validation("membership discount is not eligible"));
                }
                if source == "membership_stacked" && !allow_stacking {
                    return Err(AppError::validation(
                        "membership benefit stacking is disabled",
                    ));
                }
                let expected = membership_discount_paise(
                    normalized
                        .quantity
                        .saturating_mul(normalized.unit_price_paise),
                    eligibility
                        .as_ref()
                        .map(|value| value.discount_percent)
                        .unwrap_or(0),
                );
                if (source == "membership" && normalized.item_discount_paise != expected)
                    || (source == "membership_stacked" && normalized.item_discount_paise < expected)
                {
                    return Err(AppError::validation(
                        "membership discount amount is invalid",
                    ));
                }
                continue;
            }
            if !apply_discount || !eligible_service {
                continue;
            }
            let gross = normalized
                .quantity
                .saturating_mul(normalized.unit_price_paise);
            let benefit = membership_discount_paise(
                gross,
                eligibility
                    .as_ref()
                    .map(|value| value.discount_percent)
                    .unwrap_or(0),
            );
            let combined = if allow_stacking {
                normalized.item_discount_paise.saturating_add(benefit)
            } else {
                benefit
            }
            .min(gross);
            line.discount_paise = Some(combined);
            line.discount_amount_paise = None;
            line.discount_value = None;
            line.discount_type = Some(if allow_stacking && normalized.item_discount_paise > 0 {
                "membership_stacked".to_string()
            } else {
                "membership".to_string()
            });
            changed = true;
        }
    }

    if points > 0 {
        let point_value = package_setting(&settings, &["creditsBenefits", "rewardPointValuePaise"])
            .and_then(Value::as_i64)
            .unwrap_or(100);
        let reward_discount = reward_discount_for_points(points, point_value)
            .ok_or_else(|| AppError::validation("reward point value must be greater than zero"))?;
        let reward_already_applied = payload.reward_discount_paise.is_some();
        if payload
            .reward_discount_paise
            .is_some_and(|value| value != reward_discount)
        {
            return Err(AppError::validation("reward discount amount is invalid"));
        }
        let after_service = calculate_pos(payload)?;
        if reward_already_applied && after_service.bill_discount_paise < reward_discount {
            return Err(AppError::validation("reward discount amount is invalid"));
        }
        let available = after_service
            .subtotal_paise
            .saturating_sub(after_service.discount_paise)
            .saturating_add(if reward_already_applied {
                reward_discount
            } else {
                0
            });
        if reward_discount > available {
            return Err(AppError::validation("reward points exceed bill amount"));
        }
        if !reward_already_applied {
            payload.bill_discount_paise = Some(
                after_service
                    .bill_discount_paise
                    .saturating_add(reward_discount),
            );
            payload.discount_paise = None;
            payload.discount = None;
            payload.discount_mode = None;
        }
        payload.reward_discount_paise = Some(reward_discount);
        changed = true;
    }
    Ok(changed)
}

async fn has_active_membership_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    allow_family: bool,
) -> Result<bool, AppError> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id AND m.active=TRUE WHERE cm.tenant_id=$1 AND ((cm.branch_id=$2 AND (cm.client_id=$3 OR ($4 AND EXISTS(SELECT 1 FROM membership_family_members fm WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.client_membership_id=cm.id AND fm.member_client_id=$3 AND fm.active=TRUE)))) OR membership_cross_location_allowed($1,cm.branch_id,$2,cm.client_id,$3,'discount')) AND cm.active=TRUE AND cm.frozen_at IS NULL AND cm.assigned_at<=NOW() AND (cm.expires_at IS NULL OR cm.expires_at>=NOW()))")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(allow_family).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate membership eligibility"))
}

async fn post_membership_rewards(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    staff_id: &str,
    sale_id: &str,
    total_paise: i64,
) -> Result<(), AppError> {
    let settings = sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM membership_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load membership reward settings"))?
    .unwrap_or_else(|| serde_json::json!({}));
    let enabled = settings
        .pointer("/creditsBenefits/rewardPointsEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let rate = settings
        .pointer("/creditsBenefits/rewardPointsPer100Rupees")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .clamp(0, i64::from(i32::MAX));
    let expiry_days = settings
        .pointer("/loyaltyTiers/expiryDays")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .clamp(0, 36_500);
    let point_value_paise = settings
        .pointer("/creditsBenefits/rewardPointValuePaise")
        .and_then(Value::as_i64)
        .unwrap_or(100)
        .max(0);
    let redeemed = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(quantity),0)::BIGINT FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='redemption' AND item_id='reward_points'")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load reward redemption"))?;
    let has_membership_discount = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND discount_type IN ('membership','membership_stacked'))")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate membership discount"))?;
    let eligible = has_active_membership_tx(
        tx,
        tenant_id,
        branch_id,
        client_id,
        package_setting_bool(&settings, &["redemptionRules", "allowFamilySharing"], true),
    )
    .await?;
    let loyalty_eligible = eligible || sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(
      SELECT 1 FROM client_memberships cm
      JOIN memberships membership ON membership.id=cm.membership_id
        AND membership.tenant_id=cm.tenant_id AND membership.branch_id=cm.branch_id AND membership.active=TRUE
      WHERE cm.tenant_id=$1 AND cm.active=TRUE AND cm.frozen_at IS NULL
        AND cm.assigned_at<=NOW() AND (cm.expires_at IS NULL OR cm.expires_at>=NOW())
        AND membership_cross_location_allowed($1,cm.branch_id,$2,cm.client_id,$3,'loyalty'))"#)
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate loyalty sharing"))?;
    if has_membership_discount && !eligible {
        return Err(AppError::validation(
            "active membership is required for benefits",
        ));
    }
    if redeemed > 0 && !loyalty_eligible {
        return Err(AppError::validation(
            "active membership with shared loyalty is required for reward redemption",
        ));
    }
    if !eligible && !loyalty_eligible {
        return Ok(());
    }
    if !enabled && redeemed > 0 {
        return Err(AppError::validation("reward redemption is disabled"));
    }
    if redeemed > i64::from(i32::MAX) {
        return Err(AppError::validation(
            "reward redemption exceeds supported range",
        ));
    }
    expire_reward_points(
        tx,
        tenant_id,
        branch_id,
        client_id,
        staff_id,
        point_value_paise,
    )
    .await?;
    let mut reward_source = (branch_id.to_string(), client_id.to_string(), 0_i32);
    if redeemed > 0 {
        reward_source = sqlx::query_as::<_, (String, String, i32)>(
            r#"WITH latest AS (
                 SELECT DISTINCT ON (ledger.branch_id,ledger.client_id)
                        ledger.branch_id,ledger.client_id,ledger.balance_after
                   FROM membership_reward_ledger ledger
                  WHERE ledger.tenant_id=$1
                  ORDER BY ledger.branch_id,ledger.client_id,ledger.created_at DESC,ledger.id DESC
               )
               SELECT latest.branch_id,latest.client_id,latest.balance_after
                 FROM latest
                WHERE latest.balance_after >= $4
                  AND ((latest.branch_id=$2 AND latest.client_id=$3)
                    OR membership_cross_location_allowed($1,latest.branch_id,$2,latest.client_id,$3,'loyalty'))
                ORDER BY (latest.branch_id=$2 AND latest.client_id=$3) DESC,latest.balance_after DESC
                LIMIT 1"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(redeemed as i32)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load shared reward balance"))?
        .ok_or_else(|| AppError::validation("reward points balance is insufficient or not shared with this branch"))?;
    }
    sqlx::query("SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id)
        .bind(&reward_source.0)
        .bind(&reward_source.1)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock reward balance"))?;
    let mut source_balance = reward_source.2;
    if redeemed > 0 {
        source_balance -= redeemed as i32;
        sqlx::query("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,source_sale_id,transaction_type,points,balance_after,staff_id,note) VALUES ($1,$2,$3,$4,'redeemed',$5,$6,$7,'POS reward redemption') ON CONFLICT DO NOTHING")
            .bind(tenant_id).bind(&reward_source.0).bind(&reward_source.1).bind(sale_id).bind(redeemed as i32).bind(source_balance).bind(staff_id).execute(&mut **tx).await
            .map_err(|_| AppError::internal("failed to post reward redemption"))?;
        accounting_service::post_loyalty_redeemed(
            tx,
            tenant_id,
            &reward_source.0,
            sale_id,
            redeemed.saturating_mul(point_value_paise),
        )
        .await?;
    }
    let earned = reward_points_for_sale(total_paise, rate);
    if enabled && earned > 0 {
        let earned_points = earned.min(i64::from(i32::MAX)) as i32;
        let mut target_balance = if reward_source.0 == branch_id && reward_source.1 == client_id {
            source_balance
        } else {
            sqlx::query_scalar::<_, i32>("SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1")
                .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(&mut **tx).await
                .map_err(|_| AppError::internal("failed to load reward balance"))?.unwrap_or(0)
        };
        target_balance = target_balance.saturating_add(earned_points);
        sqlx::query("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,source_sale_id,transaction_type,points,balance_after,expires_at,staff_id,note) VALUES ($1,$2,$3,$4,'earned',$5,$6,CASE WHEN $7>0 THEN CURRENT_DATE+$7::INT ELSE NULL END,$8,'POS sale reward') ON CONFLICT DO NOTHING")
            .bind(tenant_id).bind(branch_id).bind(client_id).bind(sale_id).bind(earned_points).bind(target_balance).bind(expiry_days).bind(staff_id).execute(&mut **tx).await
            .map_err(|_| AppError::internal("failed to post earned rewards"))?;
        accounting_service::post_loyalty_earned(
            tx,
            tenant_id,
            branch_id,
            sale_id,
            i64::from(earned_points).saturating_mul(point_value_paise),
        )
        .await?;
    }
    Ok(())
}

async fn expire_reward_points(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    target_branch_id: &str,
    target_client_id: &str,
    actor: &str,
    point_value_paise: i64,
) -> Result<(), AppError> {
    let owners = sqlx::query_as::<_, (String, String)>(
        "SELECT DISTINCT branch_id,client_id FROM membership_reward_ledger WHERE tenant_id=$1 AND ((branch_id=$2 AND client_id=$3) OR membership_cross_location_allowed($1,branch_id,$2,client_id,$3,'loyalty'))",
    )
    .bind(tenant_id).bind(target_branch_id).bind(target_client_id).fetch_all(&mut **tx).await
    .map_err(|_| AppError::internal("failed to load reward expiry candidates"))?;
    for (branch_id, client_id) in owners {
        sqlx::query(
            "SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
        )
        .bind(tenant_id)
        .bind(&branch_id)
        .bind(&client_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock reward expiry balance"))?;
        let (balance, expired_earned, redeemed, already_expired) = sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT COALESCE((SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1),0)::BIGINT,COALESCE(SUM(points) FILTER (WHERE transaction_type='earned' AND expires_at<CURRENT_DATE),0)::BIGINT,COALESCE(SUM(points) FILTER (WHERE transaction_type='redeemed'),0)::BIGINT,COALESCE(-SUM(points) FILTER (WHERE transaction_type='expired'),0)::BIGINT FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3",
        )
        .bind(tenant_id).bind(&branch_id).bind(&client_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to calculate reward expiry"))?;
        let expiring = expired_earned
            .saturating_sub(redeemed)
            .saturating_sub(already_expired)
            .clamp(0, balance);
        if expiring == 0 {
            continue;
        }
        let key = format!("loyalty-expiry:{client_id}:{}", Utc::now().date_naive());
        let posted = sqlx::query("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,transaction_type,points,balance_after,staff_id,note,idempotency_key) VALUES ($1,$2,$3,'expired',$4,$5,$6,'Reward points expired',$7) ON CONFLICT DO NOTHING")
            .bind(tenant_id).bind(&branch_id).bind(&client_id).bind(-(expiring as i32)).bind((balance-expiring) as i32).bind(actor).bind(key).execute(&mut **tx).await
            .map_err(|_| AppError::internal("failed to expire reward points"))?;
        if posted.rows_affected() > 0 {
            accounting_service::post_loyalty_expired(
                tx,
                tenant_id,
                &branch_id,
                &format!("{client_id}:{}", Utc::now().date_naive()),
                expiring.saturating_mul(point_value_paise),
            )
            .await?;
        }
    }
    Ok(())
}

fn reward_points_for_sale(total_paise: i64, points_per_100_rupees: i64) -> i64 {
    total_paise
        .max(0)
        .saturating_mul(points_per_100_rupees.max(0))
        / 10_000
}

fn package_setting<'a>(settings: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(settings, |value, key| value.get(*key))
}

fn package_setting_bool(settings: &Value, path: &[&str], fallback: bool) -> bool {
    package_setting(settings, path)
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn package_setting_i32(settings: &Value, path: &[&str], fallback: i32) -> i32 {
    package_setting(settings, path)
        .and_then(Value::as_i64)
        .unwrap_or(i64::from(fallback))
        .clamp(0, i32::MAX as i64) as i32
}

#[derive(Clone, Copy)]
struct MembershipPosPolicy {
    sales_enabled: bool,
    visible_in_pos: bool,
    free_enabled: bool,
    paid_enabled: bool,
    allow_due: bool,
    tax_applicable: bool,
    tax_inclusive: bool,
    expiry_enabled: bool,
    default_validity_days: i32,
    block_expired: bool,
    allow_partial: bool,
    allow_family: bool,
    require_staff: bool,
}

fn membership_pos_policy(settings: &Value) -> MembershipPosPolicy {
    let expired_action = package_setting(settings, &["renewalExpiry", "expiredBenefitAction"])
        .and_then(Value::as_str)
        .unwrap_or("block");
    MembershipPosPolicy {
        sales_enabled: package_setting_bool(
            settings,
            &["membershipCatalog", "membershipSalesEnabled"],
            true,
        ),
        visible_in_pos: package_setting_bool(
            settings,
            &["membershipCatalog", "visibleInPos"],
            true,
        ),
        free_enabled: package_setting_bool(
            settings,
            &["membershipCatalog", "freeMembershipEnabled"],
            true,
        ),
        paid_enabled: package_setting_bool(
            settings,
            &["membershipCatalog", "paidMembershipEnabled"],
            true,
        ),
        allow_due: package_setting_bool(
            settings,
            &["paymentBilling", "allowDueOnMembershipSale"],
            true,
        ),
        tax_applicable: package_setting_bool(
            settings,
            &["paymentBilling", "membershipTaxApplicable"],
            true,
        ),
        tax_inclusive: package_setting_bool(
            settings,
            &["paymentBilling", "taxInclusiveMembershipPrice"],
            false,
        ),
        expiry_enabled: package_setting_bool(
            settings,
            &["renewalExpiry", "expiryDaysEnabled"],
            true,
        ),
        default_validity_days: package_setting_i32(
            settings,
            &["renewalExpiry", "defaultValidityDays"],
            365,
        ),
        block_expired: package_setting_bool(
            settings,
            &["redemptionRules", "blockRedemptionWhenExpired"],
            true,
        ) || expired_action == "block",
        allow_partial: package_setting_bool(
            settings,
            &["redemptionRules", "allowPartialCredits"],
            true,
        ),
        allow_family: package_setting_bool(
            settings,
            &["redemptionRules", "allowFamilySharing"],
            true,
        ),
        require_staff: package_setting_bool(
            settings,
            &["redemptionRules", "requireStaffConfirmation"],
            true,
        ),
    }
}

#[cfg(test)]
mod package_credit_value_tests {
    use super::{
        allocate_package_credit_values, membership_discount_paise, membership_pos_policy,
        reward_discount_for_points, reward_points_for_sale,
    };
    use serde_json::json;
    use sqlx::PgPool;

    #[test]
    fn allocates_the_exact_sold_value_across_immutable_credits() {
        let credits = allocate_package_credit_values(
            10_001,
            1,
            &json!([
                { "serviceId": "hair", "quantity": 2, "unitPricePaise": 3_000 },
                { "serviceId": "spa", "quantity": 1, "unitPricePaise": 4_000 }
            ]),
        );
        assert_eq!(credits.iter().map(|row| row.3).sum::<i64>(), 10_001);
        assert_eq!(credits[0].2, 2);
        assert_eq!(credits[1].2, 1);
    }

    #[test]
    fn calculates_reward_points_from_paise_without_float_rounding() {
        assert_eq!(reward_points_for_sale(25_000, 4), 10);
        assert_eq!(reward_points_for_sale(-100, 4), 0);
        assert_eq!(reward_discount_for_points(25, 100), Some(2_500));
        assert_eq!(reward_discount_for_points(25, 0), None);
        assert_eq!(membership_discount_paise(10_005, 20), 2_001);
    }

    #[test]
    fn membership_pos_policy_preserves_saved_redemption_rules() {
        let policy = membership_pos_policy(&json!({
            "membershipCatalog": { "membershipSalesEnabled": false, "visibleInPos": false },
            "renewalExpiry": { "expiredBenefitAction": "allow" },
            "redemptionRules": {
                "blockRedemptionWhenExpired": false,
                "allowPartialCredits": false,
                "allowFamilySharing": false,
                "requireStaffConfirmation": true
            }
        }));
        assert!(!policy.sales_enabled);
        assert!(!policy.visible_in_pos);
        assert!(!policy.block_expired);
        assert!(!policy.allow_partial);
        assert!(!policy.allow_family);
        assert!(policy.require_staff);
    }

    #[sqlx::test(migrations = false)]
    async fn pos_cross_location_policy_enforces_saved_tenant_branch_settings(pool: PgPool) {
        sqlx::raw_sql(
            r#"
            CREATE TABLE tenants(id TEXT PRIMARY KEY,scope_id TEXT NOT NULL DEFAULT '');
            CREATE TABLE branches(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,scope_id TEXT NOT NULL DEFAULT '',region_name TEXT NOT NULL DEFAULT '',zone_name TEXT NOT NULL DEFAULT '',cluster_name TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE);
            CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,normalized_phone TEXT NOT NULL DEFAULT '',phone_verified_at TIMESTAMPTZ,active BOOLEAN NOT NULL DEFAULT TRUE,merged_into_client_id TEXT);
            CREATE TABLE membership_settings(tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,settings_json JSONB NOT NULL DEFAULT '{}',PRIMARY KEY(tenant_id,branch_id));
            CREATE TABLE customer_account_clients(account_id TEXT NOT NULL,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL);
            CREATE TABLE inventory_items(id TEXT PRIMARY KEY,franchise_override_fields TEXT[] NOT NULL DEFAULT '{}');
            INSERT INTO tenants VALUES('tenant-1',''),('tenant-2','');
            INSERT INTO branches VALUES('source','tenant-1','','West','Mumbai','Central',TRUE),('target','tenant-1','','West','Mumbai','Central',TRUE),('other','tenant-2','','West','Mumbai','Central',TRUE);
            INSERT INTO clients VALUES('source-client','tenant-1','source','919999999999',NOW(),TRUE,NULL),('target-client','tenant-1','target','919999999999',NOW(),TRUE,NULL),('other-client','tenant-2','other','919999999999',NOW(),TRUE,NULL);
            INSERT INTO membership_settings VALUES
              ('tenant-1','source','{"crossLocation":{"enabled":true,"scope":"tenant","allowDiscounts":true,"allowServiceCredits":true,"allowGiftCards":true,"allowLoyaltyPoints":true}}'),
              ('tenant-1','target','{"crossLocation":{"acceptInbound":true}}'),
              ('tenant-2','other','{"crossLocation":{"acceptInbound":true}}');
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!(
            "../../migrations/0216_multi_branch_enterprise_completion.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        let allowed: bool = sqlx::query_scalar(
            "SELECT membership_cross_location_allowed('tenant-1','source','target','source-client','target-client','discount')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let cross_tenant: bool = sqlx::query_scalar(
            "SELECT membership_cross_location_allowed('tenant-1','source','other','source-client','other-client','discount')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(allowed);
        assert!(!cross_tenant);
        sqlx::query("UPDATE clients SET normalized_phone=id,phone_verified_at=NULL WHERE tenant_id='tenant-1'")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO customer_account_clients VALUES('account-1','tenant-1','source','source-client'),('account-1','tenant-1','target','target-client')")
            .execute(&pool).await.unwrap();
        assert!(sqlx::query_scalar::<_, bool>(
            "SELECT membership_cross_location_allowed('tenant-1','source','target','source-client','target-client','gift_card')",
        )
        .fetch_one(&pool).await.unwrap());
        sqlx::query(r#"UPDATE membership_settings SET settings_json='{"crossLocation":{"acceptInbound":false}}' WHERE tenant_id='tenant-1' AND branch_id='target'"#)
            .execute(&pool).await.unwrap();
        assert!(!sqlx::query_scalar::<_, bool>(
            "SELECT membership_cross_location_allowed('tenant-1','source','target','source-client','target-client','discount')",
        )
        .fetch_one(&pool).await.unwrap());
    }
}

async fn grant_package_credits_for_sale_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    lines: &[CalculatedLine],
) -> Result<(), AppError> {
    let package_lines = lines
        .iter()
        .filter(|line| {
            line.line_type == "package" && !line.item_id.trim().is_empty() && line.quantity > 0
        })
        .map(|line| (line.item_id.clone(), line.quantity, line.taxable_paise))
        .collect::<Vec<_>>();
    grant_package_credits(tx, tenant_id, branch_id, client_id, sale_id, &package_lines).await
}

async fn grant_package_credits_for_existing_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let package_lines = sqlx::query_as::<_, (String, i64, i64)>(
        r#"
        SELECT item_id, quantity, taxable_paise
          FROM pos_sale_lines
         WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='package' AND item_id <> ''
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load package sale lines"))?;

    grant_package_credits(tx, tenant_id, branch_id, client_id, sale_id, &package_lines).await
}

async fn grant_package_credits(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    package_lines: &[(String, i64, i64)],
) -> Result<(), AppError> {
    let settings = load_pos_package_settings(tx, tenant_id, branch_id).await?;
    if !package_setting_bool(&settings, &["packageCatalog", "salesEnabled"], true)
        && !package_lines.is_empty()
    {
        return Err(AppError::validation("package sales are disabled"));
    }
    let default_validity_days =
        package_setting_i32(&settings, &["expiryRenewal", "defaultExpiryDays"], 0);
    if !package_lines.is_empty() {
        let (total_paise, paid_paise, discounted) = sqlx::query_as::<_, (i64, i64, bool)>("SELECT ps.total_paise,ps.paid_paise,EXISTS(SELECT 1 FROM pos_sale_lines psl WHERE psl.tenant_id=ps.tenant_id AND psl.branch_id=ps.branch_id AND psl.sale_id=ps.id AND psl.line_type='package' AND psl.discount_paise>0) FROM pos_sales ps WHERE ps.tenant_id=$1 AND ps.branch_id=$2 AND ps.id=$3")
            .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_one(&mut **tx).await
            .map_err(|_| AppError::internal("failed to validate package payment settings"))?;
        if !package_setting_bool(&settings, &["pricingPayment", "allowDue"], true)
            && paid_paise < total_paise
        {
            return Err(AppError::validation(
                "due payment is disabled for package sales",
            ));
        }
        if !package_setting_bool(&settings, &["pricingPayment", "allowDiscount"], true)
            && discounted
        {
            return Err(AppError::validation(
                "discount is disabled for package sales",
            ));
        }
        let tax_applicable =
            package_setting_bool(&settings, &["pricingPayment", "taxApplicable"], true);
        let tax_inclusive =
            package_setting_bool(&settings, &["pricingPayment", "taxInclusive"], false);
        let (taxed_when_disabled, invalid_inclusive_total) = sqlx::query_as::<_, (i64, i64)>(
            r#"SELECT
                 COUNT(*) FILTER (WHERE psl.gst_paise<>0)::BIGINT,
                 COUNT(*) FILTER (
                   WHERE ABS((psl.line_total_paise + ((psl.discount_paise*(100+psl.tax_percent))/100)) - (p.price_paise*psl.quantity)) > GREATEST(2,psl.quantity)
                 )::BIGINT
               FROM pos_sale_lines psl
               JOIN packages p ON p.id=psl.item_id AND p.tenant_id=psl.tenant_id AND p.branch_id=psl.branch_id
              WHERE psl.tenant_id=$1 AND psl.branch_id=$2 AND psl.sale_id=$3 AND psl.line_type='package'"#,
        )
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_one(&mut **tx).await
        .map_err(|_| AppError::internal("failed to validate package tax settings"))?;
        if !tax_applicable && taxed_when_disabled > 0 {
            return Err(AppError::validation("tax is disabled for package sales"));
        }
        if tax_applicable && tax_inclusive && invalid_inclusive_total > 0 {
            return Err(AppError::validation("package price must include tax"));
        }
    }
    sqlx::query("DELETE FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND source_sale_id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to refresh package credits"))?;

    for (package_id, line_qty, line_value_paise) in package_lines {
        let package = sqlx::query_as::<_, (String, i32, Value)>(
            r#"
            SELECT name, COALESCE(validity_days, 0) AS validity_days,
                   CASE WHEN jsonb_array_length(COALESCE(service_rows_json,'[]'::jsonb)) > 0
                        THEN service_rows_json ELSE COALESCE(service_ids_json, '[]'::jsonb) END AS services_json
              FROM packages
             WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(package_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load package"))?;
        let Some((package_name, validity_days, services_json)) = package else {
            continue;
        };
        let validity_days = if validity_days > 0 {
            validity_days
        } else {
            default_validity_days
        };

        let credits = allocate_package_credit_values(*line_value_paise, *line_qty, &services_json);
        for (service_id, service_name, total_qty, issued_value_paise, unit_value_paise) in credits {
            sqlx::query(
                r#"
                INSERT INTO client_package_credits (
                  tenant_id, branch_id, client_id, package_id, package_name, service_id, service_name,
                  total_qty, remaining_qty, unit_value_paise, issued_value_paise,
                  expires_at, source_sale_id, active, created_at, updated_at
                ) VALUES (
                  $1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,
                  CASE WHEN $11 > 0 THEN (CURRENT_DATE + ($11::INT * INTERVAL '1 day'))::DATE ELSE NULL END,
                  $12, TRUE, NOW(), NOW()
                )
                "#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .bind(package_id)
            .bind(&package_name)
            .bind(&service_id)
            .bind(&service_name)
            .bind(total_qty)
            .bind(unit_value_paise)
            .bind(issued_value_paise)
            .bind(validity_days)
            .bind(sale_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to grant package credits"))?;
        }
    }

    Ok(())
}

async fn grant_membership_credits_for_sale_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    lines: &[CalculatedLine],
) -> Result<(), AppError> {
    let membership_lines = lines
        .iter()
        .filter(|line| {
            line.line_type == "membership" && !line.item_id.trim().is_empty() && line.quantity > 0
        })
        .map(|line| (line.item_id.clone(), line.quantity, line.taxable_paise))
        .collect::<Vec<_>>();
    grant_membership_credits(
        tx,
        tenant_id,
        branch_id,
        client_id,
        sale_id,
        &membership_lines,
    )
    .await
}

async fn grant_membership_credits_for_existing_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let membership_lines = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT item_id, quantity, taxable_paise FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='membership' AND item_id <> ''",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load membership sale lines"))?;
    grant_membership_credits(
        tx,
        tenant_id,
        branch_id,
        client_id,
        sale_id,
        &membership_lines,
    )
    .await
}

async fn grant_membership_credits(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    membership_lines: &[(String, i64, i64)],
) -> Result<(), AppError> {
    let settings = load_pos_membership_settings(tx, tenant_id, branch_id).await?;
    let policy = membership_pos_policy(&settings);
    if !membership_lines.is_empty() {
        let (total_paise, paid_paise, source, reference_id) =
            sqlx::query_as::<_, (i64, i64, String, String)>(
                "SELECT total_paise,paid_paise,source,reference_id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(sale_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to validate membership sale settings"))?;
        if !policy.sales_enabled {
            return Err(AppError::validation("membership sales are disabled"));
        }
        if !policy.visible_in_pos && !membership_internal_checkout_source(&source) {
            return Err(AppError::validation("membership sales are hidden in POS"));
        }
        if !policy.allow_due && paid_paise < total_paise {
            return Err(AppError::validation(
                "due payment is disabled for membership sales",
            ));
        }
        let (free_lines, paid_lines, taxed_when_disabled, invalid_inclusive_total) =
            sqlx::query_as::<_, (i64, i64, i64, i64)>(
                r#"SELECT
                     COUNT(*) FILTER (WHERE m.price_paise=0)::BIGINT,
                     COUNT(*) FILTER (WHERE m.price_paise>0)::BIGINT,
                     COUNT(*) FILTER (WHERE psl.gst_paise<>0)::BIGINT,
                     COUNT(*) FILTER (
                       WHERE ABS((psl.line_total_paise + ((psl.discount_paise*(100+psl.tax_percent))/100)) - (m.price_paise*psl.quantity)) > GREATEST(2,psl.quantity)
                     )::BIGINT
                   FROM pos_sale_lines psl
                   JOIN memberships m ON m.id=psl.item_id AND m.tenant_id=psl.tenant_id AND m.branch_id=psl.branch_id
                  WHERE psl.tenant_id=$1 AND psl.branch_id=$2 AND psl.sale_id=$3 AND psl.line_type='membership'"#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(sale_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to validate membership pricing settings"))?;
        if !policy.free_enabled && free_lines > 0 {
            return Err(AppError::validation("free membership sales are disabled"));
        }
        if !policy.paid_enabled && paid_lines > 0 {
            return Err(AppError::validation("paid membership sales are disabled"));
        }
        if !policy.tax_applicable && taxed_when_disabled > 0 {
            return Err(AppError::validation("tax is disabled for membership sales"));
        }
        if policy.tax_applicable
            && policy.tax_inclusive
            && reference_id.is_empty()
            && invalid_inclusive_total > 0
        {
            return Err(AppError::validation("membership price must include tax"));
        }
    }
    sqlx::query("DELETE FROM client_membership_credits WHERE tenant_id=$1 AND branch_id=$2 AND source_sale_id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to refresh membership credits"))?;

    for (membership_id, line_qty, line_value_paise) in membership_lines {
        let membership = sqlx::query_as::<_, (String, i32, Value, i64)>(
            "SELECT name, COALESCE(validity_days, 0) AS validity_days, COALESCE(service_ids_json, '[]'::jsonb) AS service_ids_json, price_paise FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(membership_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load membership"))?;
        let Some((membership_name, validity_days, services_json, membership_price_paise)) =
            membership
        else {
            continue;
        };
        let validity_days = if !policy.expiry_enabled {
            0
        } else if validity_days > 0 {
            validity_days
        } else {
            policy.default_validity_days
        };

        let previous = sqlx::query_as::<_, (String,String,i64,bool,String,String,i64)>("SELECT cm.id,cm.membership_id,m.price_paise,cm.auto_renew_enabled,cm.auto_renew_status,cm.auto_renew_payment_reference,cm.auto_renew_provider_cycle_end FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.client_id=$3 AND cm.active=TRUE ORDER BY cm.assigned_at DESC LIMIT 1 FOR UPDATE")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to inspect current membership"))?;
        sqlx::query("UPDATE client_memberships SET active=FALSE, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND active=TRUE")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to update client memberships"))?;
        let client_membership_id = sqlx::query_scalar::<_, String>(
            "INSERT INTO client_memberships (tenant_id, branch_id, client_id, membership_id, assigned_at, expires_at, active, source_sale_id, auto_renew_enabled, auto_renew_status, auto_renew_payment_reference, auto_renew_provider_cycle_end, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),CASE WHEN $5 > 0 THEN NOW() + ($5::INT * INTERVAL '1 day') ELSE NULL END,TRUE,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(membership_id)
        .bind(validity_days)
        .bind(sale_id)
        .bind(previous.as_ref().is_some_and(|row| row.3))
        .bind(previous.as_ref().map(|row| row.4.as_str()).unwrap_or("disabled"))
        .bind(previous.as_ref().map(|row| row.5.as_str()).unwrap_or(""))
        .bind(previous.as_ref().map(|row| row.6).unwrap_or(0))
        .fetch_one(&mut **tx)
        .await
            .map_err(|_| AppError::internal("failed to assign client membership"))?;
        sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id, branch_id, client_membership_id, event_type, source_sale_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&client_membership_id)
            .bind(membership_lifecycle_event(previous.as_ref().map(|row| (row.1.as_str(),row.2)), membership_id, membership_price_paise))
            .bind(sale_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to record membership lifecycle event"))?;

        complete_membership_operation(
            tx,
            tenant_id,
            branch_id,
            sale_id,
            previous.as_ref().map(|row| row.0.as_str()),
            &client_membership_id,
        )
        .await?;

        let credits = allocate_package_credit_values(*line_value_paise, *line_qty, &services_json);
        for (service_id, service_name, total_qty, issued_value_paise, unit_value_paise) in credits {
            sqlx::query(
                "INSERT INTO client_membership_credits (tenant_id, branch_id, client_id, membership_id, membership_name, service_id, service_name, total_qty, remaining_qty, unit_value_paise, issued_value_paise, expires_at, source_sale_id, active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,CASE WHEN $11 > 0 THEN (CURRENT_DATE + ($11::INT * INTERVAL '1 day'))::DATE ELSE NULL END,$12,TRUE,NOW(),NOW())",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .bind(membership_id)
            .bind(&membership_name)
            .bind(&service_id)
            .bind(&service_name)
            .bind(total_qty)
            .bind(unit_value_paise)
            .bind(issued_value_paise)
            .bind(validity_days)
            .bind(sale_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to grant membership credits"))?;
        }
    }
    Ok(())
}

fn membership_internal_checkout_source(source: &str) -> bool {
    matches!(
        source,
        "membership_auto_renew"
            | "membership_plan_change"
            | "membership_renewal"
            | "customer_membership_purchase"
    )
}

pub(crate) async fn settle_deferred_customer_commerce_benefits(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let sale = sqlx::query_as::<_, (String, String, String, String, i64)>(
        "SELECT source,status,client_id,staff_id,total_paise FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load customer commerce invoice"))?
    .ok_or_else(|| AppError::not_found("customer commerce invoice was not found"))?;
    if !customer_commerce_source(&sale.0) || sale.1 != "paid" || sale.2.trim().is_empty() {
        return Ok(());
    }
    grant_membership_credits_for_existing_sale(tx, tenant_id, branch_id, &sale.2, sale_id).await?;
    issue_gift_cards_for_existing_sale(tx, tenant_id, branch_id, &sale.2, sale_id).await?;
    post_membership_rewards(tx, tenant_id, branch_id, &sale.2, &sale.3, sale_id, sale.4).await?;
    Ok(())
}

async fn complete_membership_operation(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    previous_membership_id: Option<&str>,
    new_client_membership_id: &str,
) -> Result<(), AppError> {
    let reference = sqlx::query_scalar::<_, String>(
        "SELECT reference_id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load membership operation reference"))?
    .unwrap_or_default();
    if reference.is_empty() {
        return Ok(());
    }
    if let Some(previous_id) = previous_membership_id {
        if let Some((change_id,client_id,credit_paise))=sqlx::query_as::<_,(String,String,i64)>("UPDATE membership_plan_changes SET status='completed',source_sale_id=$4,completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND client_membership_id=$5 AND status IN ('pending_checkout','scheduled') RETURNING id,client_id,credit_paise")
            .bind(tenant_id).bind(branch_id).bind(&reference).bind(sale_id).bind(previous_id).fetch_optional(&mut **tx).await.map_err(|_|AppError::internal("failed to complete membership plan change"))? {
            if credit_paise>0 {
                let key=format!("membership-change-{change_id}");
                let credit_id=sqlx::query_scalar::<_,String>("INSERT INTO store_credits (tenant_id,branch_id,client_id,source_type,source_id,initial_amount_paise,balance_paise,reason,status,idempotency_key) VALUES ($1,$2,$3,'membership_plan_change',$4,$5,$5,'Membership downgrade proration','active',$6) ON CONFLICT (tenant_id,branch_id,client_id,idempotency_key) WHERE idempotency_key<>'' DO NOTHING RETURNING id")
                    .bind(tenant_id).bind(branch_id).bind(&client_id).bind(&change_id).bind(credit_paise).bind(&key).fetch_optional(&mut **tx).await.map_err(|_|AppError::internal("failed to issue membership downgrade credit"))?;
                if let Some(credit_id)=credit_id {
                    sqlx::query("INSERT INTO store_credit_transactions (tenant_id,branch_id,store_credit_id,client_id,transaction_type,delta_paise,balance_after_paise,reference_type,reference_id,idempotency_key,notes) VALUES ($1,$2,$3,$4,'issue',$5,$5,'membership_plan_change',$6,$7,'Membership downgrade proration')")
                        .bind(tenant_id).bind(branch_id).bind(credit_id).bind(client_id).bind(credit_paise).bind(change_id).bind(key).execute(&mut **tx).await.map_err(|_|AppError::internal("failed to record membership downgrade credit"))?;
                }
            }
        }
    }
    sqlx::query("UPDATE membership_auto_renew_attempts SET status='completed',source_sale_id=$4,error_message='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('queued','payment_required','checkout_ready','failed')")
        .bind(tenant_id).bind(branch_id).bind(&reference).bind(sale_id).execute(&mut **tx).await.map_err(|_|AppError::internal("failed to complete auto-renew attempt"))?;
    sqlx::query("UPDATE client_memberships SET auto_renew_status=CASE WHEN auto_renew_enabled THEN 'active' ELSE 'disabled' END,auto_renew_failure_count=0,next_renewal_at=expires_at,pending_membership_id=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(new_client_membership_id).execute(&mut **tx).await.map_err(|_|AppError::internal("failed to finish membership renewal state"))?;
    Ok(())
}

fn membership_lifecycle_event(
    previous: Option<(&str, i64)>,
    membership_id: &str,
    new_price: i64,
) -> &'static str {
    match previous {
        None => "assigned",
        Some((old_id, _)) if old_id == membership_id => "renewed",
        Some((_, old_price)) if new_price >= old_price => "upgraded",
        Some(_) => "downgraded",
    }
}

#[cfg(test)]
mod membership_lifecycle_tests {
    use super::{membership_lifecycle_event, normalize_pos_source, replayable_pos_reference};

    #[test]
    fn records_assignment_or_renewal_once_per_pos_sale() {
        assert_eq!(membership_lifecycle_event(None, "plan", 100), "assigned");
        assert_eq!(
            membership_lifecycle_event(Some(("plan", 100)), "plan", 100),
            "renewed"
        );
        assert_eq!(
            membership_lifecycle_event(Some(("old", 100)), "new", 200),
            "upgraded"
        );
        assert_eq!(
            membership_lifecycle_event(Some(("old", 200)), "new", 100),
            "downgraded"
        );
    }

    #[test]
    fn membership_checkout_references_are_replay_safe() {
        let source = normalize_pos_source(Some("membership-renewal".to_string()));
        assert_eq!(source, "membership_renewal");
        assert!(replayable_pos_reference(&source, "client-membership-1"));
        assert!(replayable_pos_reference(
            "membership_plan_change",
            "change-1"
        ));
        assert!(replayable_pos_reference(
            "membership_auto_renew",
            "attempt-1"
        ));
        assert!(!replayable_pos_reference("membership", ""));
    }
}

async fn consume_membership_redemption_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    lines: &[CalculatedLine],
) -> Result<(), AppError> {
    let rows = lines
        .iter()
        .filter(|line| {
            line.line_type == "membership_redeem"
                && !line.item_id.trim().is_empty()
                && line.quantity > 0
        })
        .map(|line| {
            (
                line.item_id.clone(),
                line.quantity as i32,
                line.staff_id.clone(),
            )
        })
        .collect::<Vec<_>>();
    consume_membership_redemptions(tx, tenant_id, branch_id, client_id, sale_id, &rows).await
}

async fn consume_membership_redemption_lines_for_existing_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let rows = sqlx::query_as::<_, (String, i32, String)>(
        "SELECT item_id, quantity::INT, staff_id FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='membership_redeem' AND item_id <> ''",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load membership redemption lines"))?;
    consume_membership_redemptions(tx, tenant_id, branch_id, client_id, sale_id, &rows).await
}

async fn consume_membership_redemptions(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    rows: &[(String, i32, String)],
) -> Result<(), AppError> {
    let settings = load_pos_membership_settings(tx, tenant_id, branch_id).await?;
    let policy = membership_pos_policy(&settings);
    if policy.require_staff && rows.iter().any(|row| row.2.trim().is_empty()) {
        return Err(AppError::validation(
            "staff confirmation is required for membership redemption",
        ));
    }
    sqlx::query(
        "DELETE FROM pos_membership_redemptions WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to refresh membership redemptions"))?;

    for (credit_id, quantity, staff_id) in rows {
        let credit = sqlx::query_as::<_, ClientMembershipCreditRow>(
            "SELECT branch_id AS source_branch_id,client_id AS credit_owner_id,remaining_qty,unit_value_paise,issued_value_paise,membership_id,membership_name,service_id,service_name FROM client_membership_credits WHERE id=$1 AND tenant_id=$2 AND ((branch_id=$3 AND (client_id=$4 OR ($5 AND EXISTS (SELECT 1 FROM membership_family_members fm JOIN client_memberships cm ON cm.id=fm.client_membership_id AND cm.active=TRUE AND cm.frozen_at IS NULL WHERE fm.tenant_id=$2 AND fm.branch_id=$3 AND fm.member_client_id=$4 AND fm.owner_client_id=client_membership_credits.client_id AND fm.active=TRUE)))) OR membership_cross_location_allowed($2,branch_id,$3,client_id,$4,'service_credit')) AND active=TRUE AND remaining_qty > 0 AND (NOT $6 OR expires_at IS NULL OR expires_at >= CURRENT_DATE) AND NOT EXISTS (SELECT 1 FROM client_memberships cm WHERE cm.tenant_id=$2 AND cm.branch_id=client_membership_credits.branch_id AND cm.client_id=client_membership_credits.client_id AND cm.membership_id=client_membership_credits.membership_id AND cm.source_sale_id=client_membership_credits.source_sale_id AND cm.active=TRUE AND cm.frozen_at IS NOT NULL) FOR UPDATE",
        )
        .bind(credit_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(policy.allow_family)
        .bind(policy.block_expired)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load membership credit"))?
        .ok_or_else(|| AppError::validation("membership credit is not available"))?;
        if *quantity <= 0 || *quantity > credit.remaining_qty {
            return Err(AppError::validation(
                "membership redeem quantity is not available",
            ));
        }
        if !policy.allow_partial && *quantity != credit.remaining_qty {
            return Err(AppError::validation(
                "partial membership redemption is disabled",
            ));
        }
        let remaining = credit.remaining_qty - *quantity;
        let redeemed_before = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(redeemed_value_paise),0)::BIGINT FROM pos_membership_redemptions WHERE tenant_id=$1 AND client_membership_credit_id=$2")
            .bind(tenant_id).bind(credit_id).fetch_one(&mut **tx).await
            .map_err(|_| AppError::internal("failed to total membership redemption value"))?;
        let remaining_value = credit
            .issued_value_paise
            .saturating_sub(redeemed_before)
            .max(0);
        let redeemed_value = if *quantity == credit.remaining_qty {
            remaining_value
        } else {
            credit
                .unit_value_paise
                .saturating_mul(i64::from(*quantity))
                .min(remaining_value)
        };
        sqlx::query("UPDATE client_membership_credits SET remaining_qty=$5, active=$6, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND client_id=$4")
            .bind(credit_id)
            .bind(tenant_id)
            .bind(&credit.source_branch_id)
            .bind(&credit.credit_owner_id)
            .bind(remaining)
            .bind(remaining > 0)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to consume membership credit"))?;
        sqlx::query("INSERT INTO pos_membership_redemptions (tenant_id, branch_id, source_branch_id, sale_id, client_id, client_membership_credit_id, membership_id, membership_name, service_id, service_name, staff_id, quantity, unit_value_paise, redeemed_value_paise, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&credit.source_branch_id)
            .bind(sale_id)
            .bind(client_id)
            .bind(credit_id)
            .bind(&credit.membership_id)
            .bind(&credit.membership_name)
            .bind(&credit.service_id)
            .bind(&credit.service_name)
            .bind(staff_id)
            .bind(quantity)
            .bind(credit.unit_value_paise)
            .bind(redeemed_value)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to save membership redemption"))?;
    }
    Ok(())
}

async fn issue_gift_cards_for_sale_lines(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    lines: &[CalculatedLine],
) -> Result<(), AppError> {
    let rows = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            line.line_type == "gift_card" && line.unit_price_paise > 0 && line.quantity > 0
        })
        .map(|(index, line)| {
            (
                line.item_id.clone(),
                line.quantity,
                line.unit_price_paise,
                index as i64,
            )
        })
        .collect::<Vec<_>>();
    issue_gift_cards(tx, tenant_id, branch_id, client_id, sale_id, &rows).await
}

async fn issue_gift_cards_for_existing_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let rows = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT item_id, quantity, unit_price_paise, ROW_NUMBER() OVER (ORDER BY created_at, id)::BIGINT FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='gift_card' AND unit_price_paise > 0",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load gift card sale lines"))?;
    issue_gift_cards(tx, tenant_id, branch_id, client_id, sale_id, &rows).await
}

async fn issue_gift_cards(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    rows: &[(String, i64, i64, i64)],
) -> Result<(), AppError> {
    for (line_code, quantity, amount_paise, line_index) in rows {
        if let Some(reload_code) = line_code.trim().strip_prefix("RELOAD:") {
            if *quantity != 1 || reload_code.trim().is_empty() {
                return Err(AppError::validation(
                    "gift card reload requires one active card",
                ));
            }
            let idempotency_key = format!("gift-card-reload:{sale_id}:{line_index}");
            let card = sqlx::query_as::<_, (String, i64)>("SELECT id,balance_paise FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND code=$3 AND client_id=$4 AND status='active' AND (expires_at IS NULL OR expires_at>=CURRENT_DATE) FOR UPDATE")
                .bind(tenant_id).bind(branch_id).bind(reload_code.trim().to_ascii_uppercase()).bind(client_id)
                .fetch_optional(&mut **tx).await.map_err(|_| AppError::internal("failed to load gift card for reload"))?
                .ok_or_else(|| AppError::validation("active gift card was not found for this client"))?;
            let balance_after = card.1.saturating_add(*amount_paise);
            let inserted = sqlx::query("INSERT INTO gift_card_transactions (tenant_id,branch_id,gift_card_id,sale_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes) VALUES ($1,$2,$3,$4,'reload',$5,$6,$7,'Paid POS gift card reload') ON CONFLICT (tenant_id,branch_id,gift_card_id,idempotency_key) WHERE idempotency_key<>'' DO NOTHING")
                .bind(tenant_id).bind(branch_id).bind(&card.0).bind(sale_id).bind(amount_paise).bind(balance_after).bind(&idempotency_key)
                .execute(&mut **tx).await.map_err(|_| AppError::internal("failed to record gift card reload"))?;
            if inserted.rows_affected() > 0 {
                sqlx::query("UPDATE gift_cards SET initial_amount_paise=initial_amount_paise+$4,balance_paise=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                    .bind(tenant_id).bind(branch_id).bind(&card.0).bind(amount_paise).bind(balance_after).execute(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to reload gift card"))?;
                sqlx::query("INSERT INTO customer_liability_lifecycle_events (tenant_id,branch_id,liability_type,liability_id,action,source_branch_id,target_branch_id,source_client_id,target_client_id,balance_before_paise,balance_after_paise,reason,actor_user_id,idempotency_key) VALUES ($1,$2,'gift_card',$3,'reload',$2,$2,$4,$4,$5,$6,'Paid POS gift card reload','pos',$7)")
                    .bind(tenant_id).bind(branch_id).bind(&card.0).bind(client_id).bind(card.1).bind(balance_after).bind(&idempotency_key).execute(&mut **tx).await
                    .map_err(|_| AppError::internal("failed to audit gift card reload"))?;
            }
            continue;
        }
        for item_index in 0..*quantity {
            let idempotency_key = format!("gift-card-sale:{sale_id}:{line_index}:{item_index}");
            let existing = sqlx::query_scalar::<_, String>("SELECT id FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
                .bind(tenant_id)
                .bind(branch_id)
                .bind(&idempotency_key)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|_| AppError::internal("failed to load gift card idempotency"))?;
            if existing.is_some() {
                continue;
            }
            let code = if line_code.trim().is_empty() {
                format!("GC-{}-{}-{}", &sale_id[..8], line_index, item_index).to_ascii_uppercase()
            } else if *quantity == 1 {
                line_code.trim().to_ascii_uppercase()
            } else {
                format!("{}-{}", line_code.trim(), item_index + 1).to_ascii_uppercase()
            };
            let card_id = sqlx::query_scalar::<_, String>(
                "INSERT INTO gift_cards (tenant_id, branch_id, code, client_id, initial_amount_paise, balance_paise, source_sale_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&code)
            .bind(client_id)
            .bind(amount_paise)
            .bind(sale_id)
            .bind(&idempotency_key)
            .fetch_one(&mut **tx)
            .await
            .map_err(|_| AppError::validation("gift card code already exists"))?;
            sqlx::query("INSERT INTO gift_card_transactions (tenant_id, branch_id, gift_card_id, sale_id, transaction_type, delta_paise, balance_after_paise, idempotency_key, notes) VALUES ($1,$2,$3,$4,'issue',$5,$5,$6,'POS gift card sale')")
                .bind(tenant_id)
                .bind(branch_id)
                .bind(&card_id)
                .bind(sale_id)
                .bind(amount_paise)
                .bind(&idempotency_key)
                .execute(&mut **tx)
                .await
                .map_err(|_| AppError::internal("failed to save gift card issue"))?;
        }
    }
    Ok(())
}

async fn consume_package_redemptions(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    package_redemptions: &Value,
) -> Result<(), AppError> {
    let rows = package_redemptions
        .as_array()
        .ok_or_else(|| AppError::validation("package redemptions must be a list"))?;
    if rows.is_empty() {
        return Ok(());
    }
    let settings = load_pos_package_settings(tx, tenant_id, branch_id).await?;
    let allow_partial =
        package_setting_bool(&settings, &["creditsRedemption", "allowPartial"], true);
    let block_expired =
        package_setting_bool(&settings, &["creditsRedemption", "blockWhenExpired"], true);
    let expired_action = settings
        .pointer("/expiryRenewal/expiredPendingAction")
        .and_then(Value::as_str)
        .unwrap_or(if block_expired { "block" } else { "allow" });
    let allow_cross_service = package_setting_bool(
        &settings,
        &["creditsRedemption", "allowCrossService"],
        false,
    );
    let require_staff = package_setting_bool(
        &settings,
        &["creditsRedemption", "requireStaffConfirmation"],
        true,
    );

    sqlx::query(
        "DELETE FROM pos_package_redemptions WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to refresh package redemptions"))?;

    for row in rows {
        let credit_id = package_redemption_string(row, &["clientPackageCreditId"]);
        let quantity = package_redemption_i32(row, &["quantity"]);
        let credit = sqlx::query_as::<_, ClientPackageCreditRow>(
            r#"
            SELECT branch_id AS source_branch_id, client_id AS credit_owner_id,
                   remaining_qty, unit_value_paise, issued_value_paise, package_id,
                   package_name, service_id, service_name, expires_at
              FROM client_package_credits
             WHERE id=$1 AND tenant_id=$2
               AND ((branch_id=$3 AND client_id=$4)
                 OR membership_cross_location_allowed($2,branch_id,$3,client_id,$4,'service_credit'))
               AND active=TRUE
               AND frozen_at IS NULL
               AND remaining_qty > 0
             FOR UPDATE
            "#,
        )
        .bind(&credit_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load package credit"))?
        .ok_or_else(|| AppError::validation("package credit is not available"))?;

        if quantity <= 0 || quantity > credit.remaining_qty {
            return Err(AppError::validation(
                "package redeem quantity is not available",
            ));
        }
        if !allow_partial && quantity != credit.remaining_qty {
            return Err(AppError::validation(
                "partial package redemption is disabled",
            ));
        }
        let requested_service_id = package_redemption_string(row, &["serviceId"]);
        if !allow_cross_service
            && !requested_service_id.is_empty()
            && requested_service_id != credit.service_id
        {
            return Err(AppError::validation(
                "cross-service package redemption is disabled",
            ));
        }
        let staff_id = package_redemption_string(row, &["staffId"]);
        if credit
            .expires_at
            .is_some_and(|date| date < chrono::Utc::now().date_naive())
        {
            match expired_action {
                "allow" => {}
                "approval" if !staff_id.is_empty() => {}
                "approval" => {
                    return Err(AppError::validation(
                        "staff approval is required for expired package redemption",
                    ));
                }
                _ => {
                    return Err(AppError::validation(
                        "expired package redemption is blocked",
                    ));
                }
            }
        }
        if require_staff && staff_id.is_empty() {
            return Err(AppError::validation(
                "staff confirmation is required for package redemption",
            ));
        }

        let remaining = credit.remaining_qty - quantity;
        let redeemed_before = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(redeemed_value_paise),0)::BIGINT FROM pos_package_redemptions WHERE tenant_id=$1 AND client_package_credit_id=$2")
            .bind(tenant_id).bind(&credit_id).fetch_one(&mut **tx).await
            .map_err(|_| AppError::internal("failed to total package redemption value"))?;
        let remaining_value = credit
            .issued_value_paise
            .saturating_sub(redeemed_before)
            .max(0);
        let redeemed_value = if quantity == credit.remaining_qty {
            remaining_value
        } else {
            credit
                .unit_value_paise
                .saturating_mul(i64::from(quantity))
                .min(remaining_value)
        };
        sqlx::query(
            "UPDATE client_package_credits SET remaining_qty=$5, active=$6, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND client_id=$4",
        )
        .bind(&credit_id)
        .bind(tenant_id)
            .bind(&credit.source_branch_id)
            .bind(&credit.credit_owner_id)
        .bind(remaining)
        .bind(remaining > 0)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to consume package credit"))?;

        sqlx::query(
            r#"
            INSERT INTO pos_package_redemptions (
              tenant_id, branch_id, source_branch_id, sale_id, client_id, client_package_credit_id, package_id,
              package_name, service_id, service_name, staff_id, quantity,
              unit_value_paise, redeemed_value_paise, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&credit.source_branch_id)
        .bind(sale_id)
        .bind(client_id)
        .bind(&credit_id)
        .bind(&credit.package_id)
        .bind(&credit.package_name)
        .bind(&credit.service_id)
        .bind(&credit.service_name)
        .bind(staff_id)
        .bind(quantity)
        .bind(credit.unit_value_paise)
        .bind(redeemed_value)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to save package redemption"))?;
        sqlx::query(
            r#"WITH selected AS (
                 SELECT id FROM appointment_package_reservations
                  WHERE tenant_id=$1 AND branch_id=$2 AND client_package_credit_id=$3 AND status='reserved'
                  ORDER BY created_at FOR UPDATE LIMIT $4
               )
               UPDATE appointment_package_reservations SET status='redeemed',updated_at=NOW()
                WHERE id IN (SELECT id FROM selected)"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&credit_id)
        .bind(i64::from(quantity))
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to reconcile package booking reservation"))?;
    }

    Ok(())
}

async fn consume_coupon_usage(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    coupon_code: &str,
) -> Result<(), AppError> {
    if coupon_code.trim().is_empty() {
        return Ok(());
    }

    let coupon = sqlx::query_as::<_, (Option<i64>, i64, i64)>(
        "SELECT usage_limit,used_count,per_client_limit FROM pos_coupons WHERE tenant_id=$1 AND branch_id=$2 AND code=$3 FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(coupon_code)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to lock coupon usage"))?
    .ok_or_else(|| AppError::validation("coupon code is not valid for this branch"))?;
    if coupon.0.is_some_and(|limit| limit > 0 && coupon.1 >= limit) {
        return Err(AppError::validation("coupon usage limit is reached"));
    }
    if coupon.2 > 0 {
        if client_id.trim().is_empty() {
            return Err(AppError::validation("client is required for this coupon"));
        }
        let client_uses = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::BIGINT FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND coupon_code=$4 AND finalized_at IS NOT NULL",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(coupon_code)
        .fetch_one(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to verify coupon client usage"))?;
        if client_uses >= coupon.2 {
            return Err(AppError::validation(
                "coupon per-client usage limit is reached",
            ));
        }
    }

    sqlx::query(
        r#"
        UPDATE pos_coupons
           SET used_count = used_count + 1,
               updated_at = NOW()
         WHERE tenant_id=$1 AND branch_id=$2 AND code=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(coupon_code)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to update coupon usage"))?;

    Ok(())
}

async fn read_lines(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<PosSaleLineResponse>, AppError> {
    let rows = read_line_rows(state, tenant_id, branch_id, sale_id).await?;

    Ok(rows.into_iter().map(line_response).collect())
}

async fn read_line_rows(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<PosLineRow>, AppError> {
    sqlx::query_as::<_, PosLineRow>(
        r#"
        SELECT id, sale_id, line_type, item_id, item_name, quantity,
               staff_id, staff_splits, unit_price_paise, other_fee_paise, gross_paise, taxable_paise,
               discount_paise, discount_type, discount_value_paise, discount_bps,
               tax_percent, gst_paise, hsn_sac_code, cgst_paise, sgst_paise, igst_paise, reverse_charge,
               line_total_paise, created_at, updated_at
        FROM pos_sale_lines
        WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3
        ORDER BY created_at ASC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sale lines"))
}

fn line_response(row: PosLineRow) -> PosSaleLineResponse {
    PosSaleLineResponse {
        id: row.id,
        sale_id: row.sale_id,
        line_type: row.line_type,
        item_id: row.item_id,
        item_name: row.item_name,
        staff_id: row.staff_id,
        staff_splits: row.staff_splits,
        quantity: row.quantity,
        unit_price_paise: row.unit_price_paise,
        other_fee_paise: row.other_fee_paise,
        gross_paise: row.gross_paise,
        taxable_paise: row.taxable_paise,
        discount_paise: row.discount_paise,
        discount_type: row.discount_type,
        discount_value_paise: row.discount_value_paise,
        discount_bps: row.discount_bps,
        tax_percent: row.tax_percent,
        gst_percent: row.tax_percent,
        gst_paise: row.gst_paise,
        hsn_sac_code: row.hsn_sac_code,
        cgst_paise: row.cgst_paise,
        sgst_paise: row.sgst_paise,
        igst_paise: row.igst_paise,
        reverse_charge: row.reverse_charge,
        line_total_paise: row.line_total_paise,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

async fn read_payments(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<PosPaymentResponse>, AppError> {
    let rows = sqlx::query_as::<_, PosPaymentRow>(
        "SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, paid_at, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY paid_at ASC",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sale payments"))?;

    Ok(rows.into_iter().map(payment_response).collect())
}
