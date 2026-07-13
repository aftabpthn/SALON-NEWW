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
use sqlx::{FromRow, Postgres, Transaction};
use std::collections::{HashMap, HashSet};

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::cash_drawer_repository,
    repositories::invoice_settings_repository,
    repositories::payment_methods_repository::{
        self, CreatePaymentMethod, PaymentMethodRecord, UpdatePaymentMethod,
    },
    routes::context::tenant_branch,
    services::accounting_service,
    services::auth_service::AuthClaims,
    services::invoice_delivery,
    services::invoice_numbering_service,
    services::invoice_pdf::{self, InvoicePdfLayout},
    services::razorpay_payment_service,
    services::wallet_service,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/pos", get(pos_dashboard))
        .route("/pos/payment-methods", get(pos_payment_methods))
        .route(
            "/pos/coupons",
            get(list_pos_coupons).post(create_pos_coupon),
        )
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
            "/pos/invoices/:id/payment-links/:link_id/reconcile",
            post(reconcile_pos_payment_link),
        )
        .route(
            "/pos/invoices/:id/history",
            get(list_pos_invoice_action_history),
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
        .route("/billing/clients/:id/kpi", get(get_pos_client_kpi))
        .route("/pos/gift-cards", post(create_pos_gift_card))
        .route("/pos/sales/:id/payments", post(add_pos_payment))
        .route("/pos/payments", get(list_pos_payments))
        .route(
            "/pos/happy-hours/rules",
            get(list_happy_hour_rules).post(create_happy_hour_rule),
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

#[derive(Debug, Deserialize)]
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
    pub tip_paise: Option<i64>,
    pub tip_total: Option<f64>,
    pub round_to_nearest_rupee: Option<bool>,
    pub status: Option<String>,
    pub invoice_type: Option<String>,
    pub buyer_gstin: Option<String>,
    pub place_of_supply_state_code: Option<String>,
    pub reverse_charge: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineCheckoutRequest {
    operation_id: String,
    checkout: PosSalePayload,
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

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Deserialize)]
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PosPaymentLinkRequest {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComplianceQueueRequest {
    e_invoice: Option<bool>,
    e_way_bill: Option<bool>,
    movement_required: Option<bool>,
}

#[derive(Debug, Clone)]
struct PreparedPayment {
    method: String,
    reference: String,
    label: String,
    amount_paise: i64,
    notes: String,
    idempotency_key: String,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRefundLineInput {
    pub sale_line_id: String,
    pub quantity: i64,
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
struct PosSaleDetailsResponse {
    pub sale: PosSaleResponse,
    pub invoice: PosSaleResponse,
    pub lines: Vec<PosSaleLineResponse>,
    pub payments: Vec<PosPaymentResponse>,
    pub payment_split: PosPaymentSplitResponse,
    pub client_kpi: Option<PosClientKpiResponse>,
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
    pub cash_paise: i64,
    pub upi_paise: i64,
    pub card_paise: i64,
    pub wallet_paise: i64,
    pub gift_card_paise: i64,
    pub store_credit_paise: i64,
    pub other_paise: i64,
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
    pub package_credits: Value,
    pub membership_credits: Value,
}

#[derive(Debug, FromRow)]
struct ClientPackageCreditRow {
    pub remaining_qty: i32,
    pub unit_value_paise: i64,
    pub issued_value_paise: i64,
    pub package_id: String,
    pub package_name: String,
    pub service_id: String,
    pub service_name: String,
}

#[derive(Debug, FromRow)]
struct ClientMembershipCreditRow {
    pub credit_owner_id: String,
    pub remaining_qty: i32,
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
struct PosInvoicePrintResponse {
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
    matches!(status, "draft" | "open" | "partial")
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
        tip_paise: Some(sale.tip_paise),
        tip_total: None,
        round_to_nearest_rupee: Some(sale.round_off_paise != 0),
        status: Some(sale.status.clone()),
        invoice_type: Some(sale.invoice_type.clone()),
        buyer_gstin: None,
        place_of_supply_state_code: None,
        reverse_charge: None,
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
        created_at: row.created_at,
    }
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
        "<tr><td colspan=\"7\" class=\"empty\">No items</td></tr>".to_string()
    } else {
        details
            .lines
            .iter()
            .map(|line| {
                format!(
                    "<tr><td>{}</td><td>{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num\">{}</td><td class=\"num strong\">{}</td></tr>",
                    escape_invoice_html(&line.item_name),
                    escape_invoice_html(&line.staff_id),
                    line.quantity,
                    format_invoice_money_html(line.unit_price_paise),
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
      <thead><tr><th>Item</th><th>Staff</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Discount</th><th class="num">GST</th><th class="num">Total</th></tr></thead>
      <tbody>{line_rows}</tbody>
    </table>
    <section class="summary">
      <div>
        <div class="label">Payments</div>
        <table style="margin-top: 10px;">
          <thead><tr><th>Mode</th><th>Reference</th><th class="num">Amount</th></tr></thead>
          <tbody>{payment_rows}</tbody>
        </table>
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
        membership_credits: row.membership_credits,
        package_credits: row.package_credits,
    }
}

async fn read_client_kpi(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<PosClientKpiResponse>, AppError> {
    if client_id.trim().is_empty() {
        return Ok(None);
    }

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
              'staffId', ''
            ) ORDER BY cmc.expires_at NULLS LAST, cmc.membership_name, cmc.service_name)
              FROM client_membership_credits cmc
             WHERE cmc.tenant_id = $1
               AND cmc.branch_id = $2
               AND (cmc.client_id = c.id OR EXISTS (SELECT 1 FROM membership_family_members fm JOIN client_memberships fcm ON fcm.id=fm.client_membership_id AND fcm.active=TRUE WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.member_client_id=c.id AND fm.owner_client_id=cmc.client_id AND fm.active=TRUE))
               AND cmc.active = TRUE
               AND cmc.remaining_qty > 0
               AND (cmc.expires_at IS NULL OR cmc.expires_at >= CURRENT_DATE)
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
               AND (cpc.expires_at IS NULL OR cpc.expires_at >= CURRENT_DATE)
          ), '[]'::jsonb) AS package_credits
        FROM clients c
        LEFT JOIN LATERAL (
          SELECT membership_id, assigned_at, expires_at
            FROM client_memberships
           WHERE tenant_id = $1
             AND branch_id = $2
             AND (client_id = c.id OR EXISTS (SELECT 1 FROM membership_family_members fm WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.member_client_id=c.id AND fm.client_membership_id=client_memberships.id AND fm.active=TRUE))
             AND active = TRUE
             AND assigned_at <= NOW()
             AND (expires_at IS NULL OR expires_at >= NOW())
           ORDER BY assigned_at DESC
           LIMIT 1
        ) cm ON TRUE
        LEFT JOIN memberships m
          ON m.tenant_id = $1
         AND m.branch_id = $2
         AND m.id = cm.membership_id
        WHERE c.tenant_id = $1
          AND c.branch_id = $2
          AND c.id = $3
          AND c.active = TRUE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id.trim())
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

fn round_to_rupee(value: i64) -> i64 {
    ((value + 50) / 100) * 100
}

fn normalize_line_type(value: String) -> Result<String, AppError> {
    let normalized = value.trim().to_lowercase();
    let line_type = match normalized.as_str() {
        "" => "service",
        "service" | "services" | "svc" => "service",
        "product" | "products" | "retail" | "retail_product" => "product",
        "manual" | "misc" | "other" => "custom",
        "membership" => "membership",
        "package" => "package",
        "gift_card" | "giftcard" | "gift-card" => "gift_card",
        "package_redeem" | "package-redeem" => "package_redeem",
        "membership_redeem" | "membership-redeem" => "membership_redeem",
        _ => return Err(AppError::validation("line type must be service, product, custom, membership, package, gift_card, or redemption")),
    };
    Ok(line_type.to_string())
}

fn normalize_discount_type(value: String) -> String {
    match value.trim().to_lowercase().as_str() {
        "percent" | "percentage" => "percent".to_string(),
        _ => "amount".to_string(),
    }
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

    let gross_paise = quantity.saturating_mul(unit_price_paise);
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
               starts_at, ends_at, usage_limit, used_count
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
        sum.saturating_add(line.quantity.saturating_mul(line.unit_price_paise))
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
        let gross_paise = line.quantity.saturating_mul(line.unit_price_paise);
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
        let line_tax_paise = taxable_paise.saturating_mul(i64::from(line.tax_percent)) / 100;
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
        if !tax_missing && !code_missing {
            continue;
        }
        let defaults = if line_type == "service" {
            sqlx::query_as::<_, (i32, String)>(
                "SELECT gst_percent, sac_code FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
            )
            .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&state.db).await
        } else {
            sqlx::query_as::<_, (i32, String)>(
                "SELECT gst_percent, hsn_code FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
            )
            .bind(tenant_id).bind(branch_id).bind(item_id).fetch_optional(&state.db).await
        }
        .map_err(|_| AppError::internal("failed to load GST item defaults"))?;
        if let Some((gst_percent, code)) = defaults {
            if tax_missing {
                line.gst_percent = Some(gst_percent.clamp(0, 100));
            }
            if code_missing && !code.is_empty() {
                line.hsn_sac_code = Some(code);
            }
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
            line.taxable_paise
                .saturating_mul(i64::from(line.tax_percent))
                / 100
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
          SELECT sale_id,
                 COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_paise ELSE 0 END), 0)::BIGINT AS cash_paise,
                 COALESCE(SUM(CASE WHEN method = 'upi' THEN amount_paise ELSE 0 END), 0)::BIGINT AS upi_paise,
                 COALESCE(SUM(CASE WHEN method = 'card' THEN amount_paise ELSE 0 END), 0)::BIGINT AS card_paise,
                 COALESCE(SUM(CASE WHEN method = 'wallet' THEN amount_paise ELSE 0 END), 0)::BIGINT AS wallet_paise,
                 COALESCE(SUM(CASE WHEN method IN ('gift_card', 'giftCard') THEN amount_paise ELSE 0 END), 0)::BIGINT AS gift_card_paise,
                 COALESCE(SUM(CASE WHEN method IN ('store_credit', 'storeCredit') THEN amount_paise ELSE 0 END), 0)::BIGINT AS store_credit_paise,
                 COALESCE(SUM(CASE WHEN method NOT IN ('cash', 'upi', 'card', 'wallet', 'gift_card', 'giftCard', 'store_credit', 'storeCredit') THEN amount_paise ELSE 0 END), 0)::BIGINT AS other_paise
            FROM pos_payments
           WHERE tenant_id = $1
             AND branch_id = $2
           GROUP BY sale_id
        )
        SELECT ps.id,
               ps.invoice_number,
               ps.client_id,
               COALESCE(NULLIF(TRIM(c.first_name || ' ' || c.last_name), ''), ps.client_id) AS client_name,
               COALESCE(c.phone, '') AS client_phone,
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
               COALESCE(sp.cash_paise, 0)::BIGINT AS cash_paise,
               COALESCE(sp.upi_paise, 0)::BIGINT AS upi_paise,
               COALESCE(sp.card_paise, 0)::BIGINT AS card_paise,
               COALESCE(sp.wallet_paise, 0)::BIGINT AS wallet_paise,
               COALESCE(sp.gift_card_paise, 0)::BIGINT AS gift_card_paise,
               COALESCE(sp.store_credit_paise, 0)::BIGINT AS store_credit_paise,
               COALESCE(sp.other_paise, 0)::BIGINT AS other_paise,
               ps.finalized_at,
               ps.created_at,
               ps.updated_at
          FROM pos_sales ps
          LEFT JOIN clients c
            ON c.tenant_id = ps.tenant_id
           AND c.branch_id = ps.branch_id
           AND c.id = ps.client_id
          LEFT JOIN payment_split sp ON sp.sale_id = ps.id
         WHERE ps.tenant_id = $1
           AND ps.branch_id = $2
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
    Ok(Json(ApiResponse::ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments,
        payment_split,
        client_kpi,
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

async fn get_pos_invoice_print(
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
) -> ApiResult<InvoiceComplianceRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let record = sqlx::query_as::<_, InvoiceComplianceRecord>(
        "SELECT e_invoice_status, e_way_bill_status, eligibility_json AS eligibility, updated_at FROM pos_invoice_compliance WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load invoice compliance"))?
    .ok_or_else(|| AppError::not_found("invoice compliance was not evaluated"))?;
    Ok(Json(ApiResponse::ok(record)))
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

    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    let gst_context = gst_context_from_sale(&state, &tenant_id, &branch_id, &id).await?;
    let profile = read_invoice_business_profile(&state, &tenant_id, &branch_id).await?;
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
    document["appearance"] = serde_json::to_value(
        read_invoice_appearance_settings(&state, &tenant_id, &branch_id).await?,
    )
    .map_err(|_| AppError::internal("failed to serialize invoice settings"))?;
    let pdf = invoice_pdf::render(&document, layout, &upi_uri)?;
    let sha256 = invoice_pdf::sha256_hex(&pdf);

    let inserted_snapshot = sqlx::query_as::<_, InvoicePdfSnapshotRow>(
        "INSERT INTO pos_invoice_documents (tenant_id, branch_id, sale_id, layout, sha256, source_json, pdf_bytes) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (tenant_id, branch_id, sale_id, layout) DO NOTHING RETURNING pdf_bytes, sha256",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(layout.as_str())
    .bind(&sha256)
    .bind(document.to_string())
    .bind(&pdf)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to snapshot invoice PDF"))?;
    let snapshot = match inserted_snapshot {
        Some(snapshot) => snapshot,
        None => read_invoice_pdf_snapshot(&state, &tenant_id, &branch_id, &id, layout.as_str())
            .await?
            .ok_or_else(|| AppError::internal("invoice PDF snapshot was not found"))?,
    };

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

async fn record_pos_invoice_action(
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
        "print" | "download" | "pdf" | "basic" | "send" | "resend" | "whatsapp" | "email"
    ) {
        return Err(AppError::validation("invalid invoice action"));
    }
    let channel = normalize_invoice_action_channel(&action, payload.channel.as_deref());
    let recipient = payload.recipient.unwrap_or_default().trim().to_string();
    if matches!(action.as_str(), "send" | "resend" | "whatsapp" | "email") && recipient.is_empty() {
        return Err(AppError::validation(
            "recipient is required for invoice send",
        ));
    }
    if matches!(action.as_str(), "send" | "resend" | "whatsapp" | "email")
        && !matches!(channel.as_str(), "whatsapp" | "email")
    {
        return Err(AppError::validation(
            "invoice delivery channel must be whatsapp or email",
        ));
    }
    let status = if matches!(action.as_str(), "send" | "resend" | "whatsapp" | "email") {
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
        "send" | "resend" | "whatsapp" | "email"
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
        "WITH due AS (SELECT id FROM pos_invoice_outbox WHERE ($1='' OR tenant_id=$1) AND ($2='' OR branch_id=$2) AND status IN ('queued','failed') AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) UPDATE pos_invoice_outbox outbox SET status='processing', attempts=outbox.attempts+1, updated_at=NOW() FROM due WHERE outbox.id=due.id RETURNING outbox.id, outbox.payload_json::text AS payload_json",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to claim invoice deliveries"))?;

    let mut sent = 0;
    let mut failed = 0;
    for row in rows {
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
        "INSERT INTO pos_invoice_outbox (tenant_id, branch_id, sale_id, channel, recipient, template_version, payload_json, idempotency_key, scheduled_for, next_attempt_at) SELECT ps.tenant_id, ps.branch_id, ps.id, 'whatsapp', c.phone, 'due-reminder-v1', jsonb_build_object('invoiceId', ps.id, 'invoiceNumber', ps.invoice_number, 'duePaise', ps.total_paise-ps.paid_paise, 'channel', 'whatsapp', 'recipient', c.phone, 'templateVersion', 'due-reminder-v1'), 'due:' || ps.id || ':' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD'), NOW(), NOW() FROM pos_sales ps JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id WHERE ($1='' OR ps.tenant_id=$1) AND ($2='' OR ps.branch_id=$2) AND ps.paid_paise < ps.total_paise AND ps.status NOT IN ('draft','voided','cancelled','refunded') AND COALESCE(ps.finalized_at, ps.created_at)::DATE <= CURRENT_DATE - 7 AND COALESCE(c.phone, '') <> '' ON CONFLICT DO NOTHING",
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

async fn create_happy_hour_rule(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<HappyHourRuleRequest>,
) -> ApiResult<HappyHourRuleRow> {
    let min_margin_bps = payload.min_margin_bps.unwrap_or(0);
    if payload.name.trim().is_empty()
        || payload.weekdays.is_empty()
        || payload.weekdays.iter().any(|day| !(0..=6).contains(day))
        || !(1..=10000).contains(&payload.discount_bps)
        || !(0..=10000).contains(&min_margin_bps)
    {
        return Err(AppError::validation("happy hour rule values are invalid"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query_as::<_, HappyHourRuleRow>("INSERT INTO pos_happy_hour_rules (tenant_id, branch_id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, name, start_time, end_time, weekdays, discount_bps, eligible_line_types, eligible_item_ids, eligible_client_categories, min_margin_bps, block_on_unknown_cost, active")
        .bind(&tenant_id).bind(&branch_id).bind(payload.name.trim()).bind(payload.start_time).bind(payload.end_time).bind(payload.weekdays).bind(payload.discount_bps)
        .bind(normalize_happy_hour_filter(payload.eligible_line_types)).bind(normalize_happy_hour_filter(payload.eligible_item_ids)).bind(normalize_happy_hour_filter(payload.eligible_client_categories))
        .bind(min_margin_bps).bind(payload.block_on_unknown_cost.unwrap_or(true)).bind(payload.active.unwrap_or(true))
        .fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to save happy hour rule"))?;
    Ok(Json(ApiResponse::ok(row)))
}

fn normalize_invoice_action_channel(action: &str, raw_channel: Option<&str>) -> String {
    let channel = raw_channel.unwrap_or("").trim().to_lowercase();
    if !channel.is_empty() {
        return match channel.as_str() {
            "wa" | "whats_app" | "whatsapp" => "whatsapp".to_string(),
            "mail" | "email" => "email".to_string(),
            "pdf" | "print" | "download" | "basic" => channel,
            _ => "other".to_string(),
        };
    }
    match action {
        "whatsapp" => "whatsapp",
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
    Ok(Json(ApiResponse::ok(
        load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn create_pos_sale(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    let details = persist_pos_sale(&state, headers, payload).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn sync_offline_checkout(
    State(state): State<AppState>,
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
    request.checkout.source = Some("offline_sync".to_string());
    request.checkout.reference_id = Some(operation_id.clone());
    match persist_pos_sale(&state, headers, request.checkout).await {
        Ok(details) => {
            sqlx::query("UPDATE offline_checkout_operations SET sale_id=$4, status='completed', last_error='', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND operation_id=$3")
                .bind(&tenant_id).bind(&branch_id).bind(&operation_id).bind(&details.sale.id).execute(&state.db).await
                .map_err(|_| AppError::internal("failed to complete offline checkout operation"))?;
            Ok(Json(ApiResponse::ok(details)))
        }
        Err(error) => {
            if let Some(sale_id) = sqlx::query_scalar::<_, String>("SELECT id FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND source='offline_sync' AND reference_id=$3")
                .bind(&tenant_id).bind(&branch_id).bind(&operation_id).fetch_optional(&state.db).await
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

#[cfg(test)]
mod offline_checkout_tests {
    use super::valid_offline_operation_id;

    #[test]
    fn offline_operation_id_is_replay_safe() {
        assert!(valid_offline_operation_id("device-abc-123"));
        assert!(!valid_offline_operation_id("short"));
        assert!(!valid_offline_operation_id("contains space"));
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
    headers: HeaderMap,
    Json(payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    let details = persist_pos_sale(&state, headers, payload).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn create_pos_invoice_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    payload.status = Some("draft".to_string());
    let details = persist_pos_sale(&state, headers, payload).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn create_pos_checkout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PosSalePayload>,
) -> ApiResult<PosCheckoutResponse> {
    let details = persist_pos_sale(&state, headers, payload).await?;
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
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosSaleLineInput>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "finalized, paid, cancelled, or voided invoice lines cannot be edited",
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
    )
    .await?;
    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn update_pos_invoice_line(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, line_id)): Path<(String, String)>,
    Json(payload): Json<PosSaleLineInput>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "finalized, paid, cancelled, or voided invoice lines cannot be edited",
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
    )
    .await?;
    let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(details)))
}

async fn delete_pos_invoice_line(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, line_id)): Path<(String, String)>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let sale = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if !sale_is_line_editable(&sale.status) {
        return Err(AppError::validation(
            "finalized, paid, cancelled, or voided invoice lines cannot be edited",
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

async fn persist_pos_sale(
    state: &AppState,
    headers: HeaderMap,
    mut payload: PosSalePayload,
) -> Result<PosSaleDetailsResponse, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
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
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(state, &tenant_id, &branch_id, &calculation).await?;

    let (paid, prepared_payments) =
        prepare_pos_payments(payload.payments.take(), calculation.total_paise)?;
    validate_active_payment_modes(state, &tenant_id, &branch_id, &prepared_payments).await?;

    let sale_id = uuid::Uuid::new_v4().to_string();
    let client_id = payload
        .client_id
        .or(payload.customer_id)
        .unwrap_or_default();
    let staff_id = payload.staff_id.unwrap_or_default();
    let source = payload.source.unwrap_or_else(|| "manual".to_string());
    let reference_id = payload.reference_id.unwrap_or_default();
    let invoice_type = payload
        .invoice_type
        .unwrap_or_else(|| "tax_invoice".to_string());
    let invoice_type = invoice_type.trim().to_ascii_lowercase();
    let status =
        status_for_invoice_create(payload.status.as_deref(), calculation.total_paise, paid);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start pos invoice transaction"))?;
    let business_date = sqlx::query_scalar::<_, NaiveDate>("SELECT CURRENT_DATE")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to resolve invoice business date"))?;
    let invoice_sequence = invoice_numbering_service::allocate(
        &mut tx,
        &tenant_id,
        &branch_id,
        &invoice_type,
        business_date,
    )
    .await?;
    let invoice_number = invoice_sequence.invoice_number.clone();

    let sale = sqlx::query_as::<_, PosSaleRow>(
        r#"
        INSERT INTO pos_sales (
            id, tenant_id, branch_id, client_id, staff_id, invoice_number,
            subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise,
            tip_paise, round_off_paise, total_paise, paid_paise,
            status, source, reference_id, package_redemptions, invoice_type, business_date,
            seller_gstin, seller_state_code, buyer_gstin, place_of_supply_state_code, tax_mode, reverse_charge,
            cgst_paise, sgst_paise, igst_paise, fiscal_year, invoice_number_sequence_id, finalized_at, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,CASE WHEN $17 = 'draft' THEN NULL ELSE NOW() END,NOW(),NOW())
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
    .bind(source)
    .bind(reference_id)
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
        consume_coupon_usage(&mut tx, &tenant_id, &branch_id, &calculation.coupon_code).await?;
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
        let movements =
            consume_inventory_for_sale(&mut tx, &tenant_id, &branch_id, &sale_id).await?;
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

    let payment_rows = insert_pos_payments(
        &mut tx,
        &tenant_id,
        &branch_id,
        &sale.client_id,
        &sale_id,
        status != "draft",
        prepared_payments,
    )
    .await?;
    if status != "draft" {
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
        for payment in &payment_rows {
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
    }
    if status != "draft" && !sale.client_id.trim().is_empty() {
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

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit pos invoice"))?;

    let lines = read_lines(state, &tenant_id, &branch_id, &sale_id).await?;
    let client_kpi = read_client_kpi(state, &tenant_id, &branch_id, &sale.client_id).await?;
    let response = sale_response(sale, lines.len() as i64);
    let payment_split = payment_split_response(&payment_rows, response.total_paise);
    Ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments: payment_rows,
        payment_split,
        client_kpi,
    })
}

async fn replace_pos_invoice_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut payload): Json<PosSalePayload>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let existing = load_pos_sale(&state, &tenant_id, &branch_id, &id).await?;
    if existing.status != "draft" {
        return Err(AppError::validation("only held invoices can be updated"));
    }
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
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(&state, &tenant_id, &branch_id, &calculation).await?;
    let (paid, prepared_payments) =
        prepare_pos_payments(payload.payments.take(), calculation.total_paise)?;
    validate_active_payment_modes(&state, &tenant_id, &branch_id, &prepared_payments).await?;

    let client_id = payload
        .client_id
        .or(payload.customer_id)
        .unwrap_or_default();
    let staff_id = payload.staff_id.unwrap_or_default();
    let source = payload.source.unwrap_or_else(|| "manual".to_string());
    let reference_id = payload.reference_id.unwrap_or_default();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start draft update transaction"))?;
    let sale = sqlx::query_as::<_, PosSaleRow>(
        "UPDATE pos_sales SET client_id=$4, staff_id=$5, subtotal_paise=$6, bill_discount_paise=$7, coupon_code=$8, coupon_discount_paise=$9, discount_paise=$10, tax_paise=$11, tip_paise=$12, round_off_paise=$13, total_paise=$14, paid_paise=$15, source=$16, reference_id=$17, package_redemptions=$18::jsonb, seller_gstin=$19, seller_state_code=$20, buyer_gstin=$21, place_of_supply_state_code=$22, tax_mode=$23, reverse_charge=$24, cgst_paise=$25, sgst_paise=$26, igst_paise=$27, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='draft' RETURNING id, tenant_id, branch_id, client_id, staff_id, invoice_number, subtotal_paise, bill_discount_paise, coupon_code, coupon_discount_paise, discount_paise, tax_paise, tip_paise, round_off_paise, total_paise, paid_paise, status, source, reference_id, package_redemptions, invoice_type, finalized_at, created_at, updated_at",
    )
    .bind(&id).bind(&tenant_id).bind(&branch_id).bind(client_id.trim()).bind(staff_id.trim())
    .bind(calculation.subtotal_paise).bind(calculation.bill_discount_paise).bind(&calculation.coupon_code).bind(calculation.coupon_discount_paise)
    .bind(calculation.discount_paise).bind(calculation.tax_paise).bind(calculation.tip_paise).bind(calculation.round_off_paise).bind(calculation.total_paise).bind(paid)
    .bind(source).bind(reference_id).bind(&package_redemptions)
    .bind(&gst_context.seller_gstin).bind(&gst_context.seller_state_code).bind(&gst_context.buyer_gstin)
    .bind(&gst_context.place_of_supply_state_code).bind(&gst_context.tax_mode).bind(gst_context.reverse_charge)
    .bind(calculation.cgst_paise).bind(calculation.sgst_paise).bind(calculation.igst_paise)
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
        prepared_payments,
    )
    .await?;
    insert_pos_event(&mut tx, &tenant_id, &branch_id, &id, "invoice.draft_updated", serde_json::json!({ "invoiceNumber": sale.invoice_number, "totalPaise": sale.total_paise, "paidPaise": sale.paid_paise })).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit held invoice"))?;

    let lines = read_lines(&state, &tenant_id, &branch_id, &id).await?;
    let client_kpi = read_client_kpi(&state, &tenant_id, &branch_id, &sale.client_id).await?;
    let response = sale_response(sale, lines.len() as i64);
    let payment_split = payment_split_response(&payment_rows, response.total_paise);
    Ok(Json(ApiResponse::ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments: payment_rows,
        payment_split,
        client_kpi,
    })))
}

fn prepare_pos_payments(
    payments: Option<Vec<PosPaymentInput>>,
    total_paise: i64,
) -> Result<(i64, Vec<PreparedPayment>), AppError> {
    let mut paid = 0i64;
    let mut prepared = Vec::new();
    for payment in payments.unwrap_or_default() {
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
        });
    }
    if paid > total_paise {
        return Err(AppError::validation(
            "payment total cannot exceed sale total",
        ));
    }
    Ok((paid, prepared))
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
) -> Result<(), AppError> {
    if calculation.discount_paise <= 0 {
        return Ok(());
    }
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
    payments: Vec<PreparedPayment>,
) -> Result<Vec<PosPaymentResponse>, AppError> {
    if settle_internal && payments.iter().any(|payment| payment.method == "cash") {
        ensure_cash_drawer_open(tx, tenant_id, branch_id).await?;
    }
    let mut rows = Vec::with_capacity(payments.len());
    for payment in payments {
        let payment_id = uuid::Uuid::new_v4().to_string();
        let row = sqlx::query_as::<_, PosPaymentRow>("INSERT INTO pos_payments (id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, created_at")
            .bind(&payment_id).bind(tenant_id).bind(branch_id).bind(sale_id).bind(&payment.method).bind(payment.amount_paise).bind(&payment.reference).bind(&payment.label).bind(&payment.notes).bind(&payment.idempotency_key)
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
) -> Result<(), AppError> {
    let open = cash_drawer_repository::is_open_for_update(
        tx,
        tenant_id,
        branch_id,
        Utc::now().date_naive(),
    )
    .await
    .map_err(|_| AppError::internal("failed to validate cash drawer"))?;
    if open {
        Ok(())
    } else {
        Err(AppError::validation(
            "an open cash drawer is required before accepting cash payment",
        ))
    }
}

async fn update_pos_sale(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosSaleUpdate>,
) -> ApiResult<PosSaleResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;

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

async fn delete_pos_sale(
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
        .map_err(|_| AppError::internal("failed to start invoice delete transaction"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    if !matches!(sale.status.as_str(), "draft" | "open") || sale.paid_paise > 0 {
        return Err(AppError::validation(
            "paid or finalized invoices cannot be deleted; use refund or credit note",
        ));
    }
    sqlx::query("UPDATE pos_sales SET status='cancelled', locked_at=COALESCE(locked_at, NOW()), updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to cancel pos sale"))?;
    insert_pos_event_with_actor(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        &claims.sub,
        "invoice.delete_requested",
        serde_json::json!({ "invoiceNumber": sale.invoice_number, "status": "cancelled" }),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice delete request"))?;

    Ok(Json(ApiResponse::ok(serde_json::json!({
        "success": true,
        "deleted": false,
        "cancelled": true,
        "id": id,
    }))))
}

async fn create_pos_payment_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosPaymentLinkRequest>,
) -> ApiResult<PosPaymentLinkResponse> {
    if !state.settings.razorpay_payment_links_enabled()
        || !state.settings.razorpay_webhook_configured()
    {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "Razorpay payment links and signed webhook must be configured",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
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
        read_payment_link_by_idempotency(&mut tx, &tenant_id, &branch_id, &idempotency_key).await?
    {
        if existing.sale_id != id {
            return Err(AppError::conflict(
                "idempotencyKey is already used by a different invoice",
            ));
        }
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate payment link request"))?;
        return Ok(Json(ApiResponse::ok(payment_link_response(existing))));
    }

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
        ) VALUES ($1,$2,$3,$4,'razorpay',$5,$6,'pending',$7,$8,'{}'::jsonb,NOW())
        ON CONFLICT DO NOTHING
        RETURNING id, sale_id, provider, provider_link_id,
                  provider_reference, amount_paise, status, link_url, expires_at, created_at, updated_at
        "#,
    )
    .bind(&link_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
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
                read_payment_link_by_idempotency(&mut tx, &tenant_id, &branch_id, &idempotency_key)
                    .await?;
            tx.rollback().await.map_err(|_| {
                AppError::internal("failed to finish duplicate payment link request")
            })?;
            return existing
                .map(|link| Json(ApiResponse::ok(payment_link_response(link))))
                .ok_or_else(|| AppError::conflict("payment link reservation already exists"));
        }
    };
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to reserve payment link"))?;

    let provider_link = razorpay_payment_service::create_payment_link(
        &state.settings,
        razorpay_payment_service::CreatePaymentLink {
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
        },
    )
    .await;

    let provider_link = match provider_link {
        Ok(link) => link,
        Err(error) => {
            let _ = sqlx::query(
                "UPDATE pos_payment_links SET status='failed', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'",
            )
            .bind(&tenant_id)
            .bind(&branch_id)
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
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&inserted.id)
    .bind(&provider_link.provider_link_id)
    .bind(&provider_link.short_url)
    .bind(provider_payload)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to save Razorpay payment link"))?;

    Ok(Json(ApiResponse::ok(payment_link_response(updated))))
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

async fn reconcile_pos_payment_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((sale_id, link_id)): Path<(String, String)>,
) -> ApiResult<Value> {
    if !state.settings.razorpay_payment_links_enabled() {
        return Err(AppError::service_unavailable(
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
            "Razorpay payment links are not configured",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let link = read_payment_link(&state, &tenant_id, &branch_id, &sale_id, &link_id).await?;
    if link.provider != "razorpay" || link.provider_link_id.is_empty() {
        return Err(AppError::validation(
            "payment link is not ready for Razorpay reconciliation",
        ));
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO pos_payment_reconciliation_runs (id, tenant_id, branch_id, provider, status, result_json) VALUES ($1,$2,$3,'razorpay','pending','{}'::jsonb)",
    )
    .bind(&run_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .execute(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to start payment reconciliation"))?;

    let remote =
        razorpay_payment_service::fetch_payment_link(&state.settings, &link.provider_link_id).await;
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

async fn add_pos_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PosPaymentInput>,
) -> ApiResult<PosPaymentResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
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

    if !idempotency_key.is_empty() {
        if let Some(existing) = sqlx::query_as::<_, PosPaymentRow>("SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4")
            .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&idempotency_key).fetch_optional(&mut *tx).await.map_err(|_| AppError::internal("failed to read payment idempotency key"))? {
            tx.rollback().await.map_err(|_| AppError::internal("failed to finish duplicate payment request"))?;
            return Ok(Json(ApiResponse::ok(payment_response(existing))));
        }
    }

    if sale.paid_paise.saturating_add(amount) > sale.total_paise {
        return Err(AppError::validation("Payment amount exceeds sale balance"));
    }
    if method == "cash" {
        ensure_cash_drawer_open(&mut tx, &tenant_id, &branch_id).await?;
    }

    let payment_id = uuid::Uuid::new_v4().to_string();
    let inserted = sqlx::query_as::<_, PosPaymentRow>(
        r#"
        INSERT INTO pos_payments (
            id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, idempotency_key, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        RETURNING id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, created_at
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

    let new_paid = sale.paid_paise.saturating_add(amount);
    let new_status = status_for(sale.total_paise, new_paid);

    let _ = sqlx::query(
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
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(new_paid)
    .bind(&new_status)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to update sale payment status"))?;

    if sale.status == "draft" {
        let inventory_movements =
            consume_inventory_for_sale(&mut tx, &tenant_id, &branch_id, &id).await?;
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
            sale.total_paise,
            sale.tax_paise,
            cgst_paise,
            sgst_paise,
            igst_paise,
            sale.tip_paise,
            sale.round_off_paise,
        )
        .await?;
    }
    accounting_service::post_payment(
        &mut tx,
        &tenant_id,
        &branch_id,
        &inserted.id,
        &inserted.method,
        inserted.amount_paise,
    )
    .await?;

    insert_pos_event(
        &mut tx,
        &tenant_id,
        &branch_id,
        &id,
        "payment.recorded",
        serde_json::json!({
            "method": method,
            "amountPaise": amount,
            "paidPaise": new_paid,
            "status": new_status
        }),
    )
    .await?;

    if sale.status == "draft" {
        consume_coupon_usage(&mut tx, &tenant_id, &branch_id, &sale.coupon_code).await?;
    }

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit payment"))?;

    Ok(Json(ApiResponse::ok(payment_response(inserted))))
}

async fn finalize_pos_invoice(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;

    let sale_query = format!(
        "{} WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
        sale_select_sql()
    );
    let sale = sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(&id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to load pos invoice"))?
        .ok_or_else(|| AppError::not_found("pos invoice was not found"))?;

    if matches!(sale.status.as_str(), "voided" | "cancelled") {
        return Err(AppError::validation(
            "cancelled or voided invoices cannot be finalized",
        ));
    }
    if sale.finalized_at.is_some() {
        let details = load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?;
        return Ok(Json(ApiResponse::ok(details)));
    }

    let line_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to validate invoice lines"))?;

    if line_count == 0 {
        return Err(AppError::validation(
            "invoice must have at least one line before finalize",
        ));
    }

    let apply_package_effects = sale.finalized_at.is_none();
    let finalized_status = status_for_finalize(sale.total_paise, sale.paid_paise);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start finalize transaction"))?;

    let draft_payments = sqlx::query_as::<_, PosPaymentRow>("SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at, id")
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
        })
        .collect::<Vec<_>>();
    validate_active_payment_modes(&state, &tenant_id, &branch_id, &held_payment_inputs).await?;
    if held_payment_inputs
        .iter()
        .any(|payment| payment.method == "cash")
    {
        ensure_cash_drawer_open(&mut tx, &tenant_id, &branch_id).await?;
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
        consume_inventory_for_sale(&mut tx, &tenant_id, &branch_id, &id).await?;
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

    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice finalize"))?;

    let lines = read_lines(&state, &tenant_id, &branch_id, &id).await?;
    let payments = read_payments(&state, &tenant_id, &branch_id, &id).await?;
    let client_kpi = read_client_kpi(&state, &tenant_id, &branch_id, &finalized.client_id).await?;
    let response = sale_response(finalized, line_count);
    let payment_split = payment_split_response(&payments, response.total_paise);
    Ok(Json(ApiResponse::ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments,
        payment_split,
        client_kpi,
    })))
}

async fn void_pos_invoice(
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
    Ok(Json(ApiResponse::ok(
        load_pos_sale_details(&state, &tenant_id, &branch_id, &id).await?,
    )))
}

struct ResolvedRefundLine {
    sale_line_id: String,
    line_type: String,
    item_id: String,
    quantity: i64,
    amount_paise: i64,
    restock: bool,
}

#[derive(Debug, FromRow)]
struct GatewayRefundPayment {
    id: String,
    provider_payment_id: String,
    available_paise: i64,
}

struct GatewayRefundResult {
    pos_payment_id: String,
    provider_payment_id: String,
    provider_refund_id: String,
    amount_paise: i64,
    status: String,
    payload: Value,
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
        let line = sqlx::query_as::<_, (String, String, i64, i64)>(
            "SELECT line_type, item_id, quantity, line_total_paise FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND id=$4 FOR UPDATE",
        )
        .bind(tenant_id).bind(branch_id).bind(sale_id).bind(&sale_line_id)
        .fetch_optional(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load invoice line for return"))?
        .ok_or_else(|| AppError::validation("return line does not belong to this invoice"))?;
        let (line_type, item_id, sold_quantity, line_total_paise) = line;
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
        resolved.push(ResolvedRefundLine {
            sale_line_id,
            line_type: line_type.clone(),
            item_id,
            quantity: requested.quantity,
            amount_paise,
            restock: restock_requested && line_type == "product",
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

async fn razorpay_refund_candidates(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<Vec<GatewayRefundPayment>, AppError> {
    sqlx::query_as("SELECT p.id, p.method_reference AS provider_payment_id, p.amount_paise - COALESCE(SUM(gr.amount_paise),0)::BIGINT AS available_paise FROM pos_payments p LEFT JOIN pos_gateway_refunds gr ON gr.tenant_id=p.tenant_id AND gr.branch_id=p.branch_id AND gr.pos_payment_id=p.id AND gr.status IN ('pending','processed') WHERE p.tenant_id=$1 AND p.branch_id=$2 AND p.sale_id=$3 AND p.idempotency_key LIKE 'razorpay:%' AND p.method_reference <> '' GROUP BY p.id, p.method_reference, p.amount_paise HAVING p.amount_paise > COALESCE(SUM(gr.amount_paise),0) ORDER BY p.created_at, p.id")
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_all(&mut **tx).await
        .map_err(|_| AppError::internal("failed to load Razorpay refund candidates"))
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
    use super::proportional_refund_amount;

    #[test]
    fn final_partial_return_receives_all_rounding_remainder() {
        assert_eq!(proportional_refund_amount(100, 3, 1, 3, 0), 33);
        assert_eq!(proportional_refund_amount(100, 3, 2, 2, 33), 67);
    }
}

async fn restock_returned_product(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    refund_id: &str,
    line: &ResolvedRefundLine,
) -> Result<(), AppError> {
    if line.line_type != "product" || line.item_id.is_empty() || line.quantity > i64::from(i32::MAX)
    {
        return Err(AppError::validation(
            "only valid product return lines can be restocked",
        ));
    }
    let sale_movement = sqlx::query_as::<_, (String, i64)>(
        "SELECT inventory_item_id, unit_cost_paise FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id).bind(branch_id).bind(sale_id).bind(&line.sale_line_id)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to validate product inventory movement"))?
    .ok_or_else(|| AppError::validation("product line was not deducted from inventory and cannot be restocked"))?;
    if sale_movement.0 != line.item_id {
        return Err(AppError::internal(
            "product return inventory reference mismatch",
        ));
    }
    let _ = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&line.item_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to lock returned inventory item"))?
    .ok_or_else(|| AppError::not_found("returned inventory item was not found"))?;
    let created = sqlx::query_scalar::<_, String>(
        "INSERT INTO inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_id, sale_line_id, refund_id, movement_type, quantity_delta, unit_cost_paise) VALUES ($1,$2,$3,$4,$5,$6,'return',$7,$8) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id).bind(branch_id).bind(&line.item_id).bind(sale_id).bind(&line.sale_line_id).bind(refund_id)
    .bind(line.quantity as i32).bind(sale_movement.1)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to write inventory return ledger"))?;
    if created.is_some() {
        sqlx::query("UPDATE inventory_items SET stock_quantity=stock_quantity+$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(&line.item_id).bind(line.quantity as i32)
            .execute(&mut **tx).await
            .map_err(|_| AppError::internal("failed to restock returned product"))?;
    }
    Ok(())
}

async fn refund_pos_invoice(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvoiceLifecycleRequest>,
) -> ApiResult<PosSaleDetailsResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let reason = payload.reason.unwrap_or_default();
    require_lifecycle_reason(&reason, "refund")?;
    let notes = payload.notes.unwrap_or_default();
    let key = payload.idempotency_key.unwrap_or_default();
    let requested_lines = payload.lines.unwrap_or_default();
    let restock_requested = payload.restock.unwrap_or(false);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start refund transaction"))?;
    let sale = load_sale_for_update(&mut tx, &tenant_id, &branch_id, &id).await?;
    if matches!(sale.status.as_str(), "draft" | "voided" | "cancelled") || sale.paid_paise <= 0 {
        return Err(AppError::validation(
            "only paid or partially paid invoices can be refunded",
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
    let next_refunded = refunded.saturating_add(amount);
    let next_status = if next_refunded >= sale.paid_paise {
        "refunded"
    } else {
        "partial_refund"
    };
    let refund_id = uuid::Uuid::new_v4().to_string();
    let candidates = razorpay_refund_candidates(&mut tx, &tenant_id, &branch_id, &id).await?;
    let mut provider_results = Vec::new();
    let mut gateway_remaining = amount;
    if !candidates.is_empty() && gateway_remaining > 0 {
        if key.len() < 10
            || !key.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return Err(AppError::validation("idempotencyKey must be at least 10 characters and contain only letters, numbers, hyphens, or underscores for gateway refunds"));
        }
        if !state.settings.razorpay_payment_links_enabled() {
            return Err(AppError::service_unavailable(
                "PAYMENT_PROVIDER_NOT_CONFIGURED",
                "Razorpay refund credentials are not configured",
            ));
        }
        for (index, payment) in candidates.into_iter().enumerate() {
            if gateway_remaining == 0 {
                break;
            }
            let provider_amount = gateway_remaining.min(payment.available_paise);
            let provider_key = format!("{key}-{index}");
            // ponytail: provider call holds the invoice lock; move to a durable refund worker if provider latency becomes a throughput concern.
            let provider_refund = razorpay_payment_service::create_payment_refund(
                &state.settings,
                &payment.provider_payment_id,
                provider_amount,
                &provider_key,
                &refund_id,
            )
            .await?;
            provider_results.push(GatewayRefundResult {
                pos_payment_id: payment.id,
                provider_payment_id: payment.provider_payment_id,
                provider_refund_id: provider_refund.provider_refund_id,
                amount_paise: provider_amount,
                status: if provider_refund.status.eq_ignore_ascii_case("processed") {
                    "processed".to_string()
                } else {
                    "pending".to_string()
                },
                payload: provider_refund.payload,
            });
            gateway_remaining = gateway_remaining.saturating_sub(provider_amount);
        }
    }
    sqlx::query("INSERT INTO pos_invoice_refunds (id, tenant_id, branch_id, sale_id, actor_user_id, amount_paise, reason, notes, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(&refund_id).bind(&tenant_id).bind(&branch_id).bind(&id).bind(&claims.sub).bind(amount).bind(&reason).bind(&notes).bind(&key)
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
    for provider_result in &provider_results {
        sqlx::query("INSERT INTO pos_gateway_refunds (tenant_id, branch_id, sale_id, refund_id, pos_payment_id, provider, provider_payment_id, provider_refund_id, amount_paise, status, idempotency_key, payload_json) VALUES ($1,$2,$3,$4,$5,'razorpay',$6,$7,$8,$9,$10,$11::jsonb)")
            .bind(&tenant_id).bind(&branch_id).bind(&id).bind(&refund_id).bind(&provider_result.pos_payment_id).bind(&provider_result.provider_payment_id).bind(&provider_result.provider_refund_id).bind(provider_result.amount_paise).bind(&provider_result.status).bind(format!("{key}-{}", provider_result.pos_payment_id)).bind(provider_result.payload.to_string())
            .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to record gateway refund"))?;
    }
    for line in &refund_lines {
        sqlx::query("INSERT INTO pos_invoice_refund_lines (tenant_id, branch_id, refund_id, sale_id, sale_line_id, quantity, amount_paise, restock_requested) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(&tenant_id).bind(&branch_id).bind(&refund_id).bind(&id).bind(&line.sale_line_id).bind(line.quantity).bind(line.amount_paise).bind(line.restock)
            .execute(&mut *tx).await.map_err(|_| AppError::internal("failed to save returned invoice line"))?;
        if line.restock {
            restock_returned_product(&mut tx, &tenant_id, &branch_id, &id, &refund_id, line)
                .await?;
        }
    }
    sqlx::query("UPDATE pos_sales SET status=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(next_status).execute(&mut *tx).await.map_err(|_| AppError::internal("failed to update refund status"))?;
    accounting_service::post_refund(&mut tx, &tenant_id, &branch_id, &refund_id, amount).await?;
    reverse_happy_hour_lock(&mut tx, &tenant_id, &branch_id, &id, amount).await?;
    insert_pos_event_with_actor(&mut tx, &tenant_id, &branch_id, &id, &claims.sub, "invoice.refunded", serde_json::json!({ "invoiceNumber": sale.invoice_number, "amountPaise": amount, "creditNoteNumber": credit_note_number, "gatewayRefundPaise": amount.saturating_sub(gateway_remaining), "manualSettlementPaise": gateway_remaining, "returnedLineCount": refund_lines.len(), "restockedLineCount": refund_lines.iter().filter(|line| line.restock).count(), "status": next_status, "reason": reason })).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit invoice refund"))?;
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
        "SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND ($3='' OR sale_id=$3) AND ($4='' OR LOWER(method)=$4) ORDER BY created_at DESC LIMIT $5 OFFSET $6",
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
               usage_limit, used_count
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
    let row = sqlx::query_as::<_, CouponResponse>(
        r#"
        INSERT INTO pos_coupons (
          id, tenant_id, branch_id, code, discount_type, discount_value_paise, discount_bps,
          min_subtotal_paise, max_discount_paise, active, starts_at, ends_at, usage_limit
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id, code, discount_type, discount_value_paise, discount_bps,
                  min_subtotal_paise, max_discount_paise, active, starts_at, ends_at,
                  usage_limit, used_count
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
            ))
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
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit gift card"))?;
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
        "SELECT COALESCE(SUM(total_paise),0) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','voided','cancelled')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to fetch total sales"))?
    .max(0);

    let paid_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(paid_paise),0) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','voided','cancelled')",
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
        "SELECT COALESCE(SUM(total_paise),0) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','voided','cancelled') AND created_at BETWEEN $3 AND $4",
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
               status, source, reference_id, invoice_type, finalized_at, created_at, updated_at
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

async fn consume_inventory_for_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<i64, AppError> {
    let lines = sqlx::query_as::<_, (String, String, String, i64)>(
        "SELECT id, line_type, item_id, quantity FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load sale lines for inventory"))?;
    let mut moved = 0i64;
    for (line_id, line_type, item_id, quantity) in lines {
        let quantities = if line_type == "product" {
            if item_id.trim().is_empty() {
                return Err(AppError::validation(
                    "product sale line requires an inventory item id",
                ));
            }
            HashMap::from([(item_id, quantity)])
        } else if line_type == "service" && !item_id.trim().is_empty() {
            service_inventory_consumption(tx, tenant_id, branch_id, &item_id, quantity).await?
        } else {
            HashMap::new()
        };
        for (inventory_item_id, quantity) in quantities {
            if quantity <= 0 || quantity > i64::from(i32::MAX) {
                return Err(AppError::validation(
                    "inventory consumption quantity is invalid",
                ));
            }
            if deduct_inventory_item(
                tx,
                tenant_id,
                branch_id,
                sale_id,
                &line_id,
                &inventory_item_id,
                quantity as i32,
            )
            .await?
            {
                moved += 1;
            }
        }
    }
    Ok(moved)
}

async fn service_inventory_consumption(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    service_quantity: i64,
) -> Result<HashMap<String, i64>, AppError> {
    let recipe = sqlx::query_scalar::<_, String>(
        "SELECT product_consumption_json::text FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load service inventory recipe"))?;
    let Some(recipe) = recipe else {
        return Ok(HashMap::new());
    };
    let entries = serde_json::from_str::<Value>(&recipe)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let mut quantities = HashMap::new();
    for entry in entries {
        let item_id = ["itemId", "productId", "inventoryItemId"]
            .iter()
            .find_map(|key| entry.get(*key).and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        let quantity = entry
            .get("quantity")
            .or_else(|| entry.get("qty"))
            .and_then(|value| {
                value
                    .as_i64()
                    .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
            })
            .unwrap_or(0);
        if item_id.is_empty() || quantity <= 0 {
            return Err(AppError::validation(
                "service inventory recipe contains an invalid item",
            ));
        }
        let total = service_quantity.saturating_mul(quantity);
        quantities
            .entry(item_id.to_string())
            .and_modify(|current: &mut i64| *current = current.saturating_add(total))
            .or_insert(total);
    }
    Ok(quantities)
}

async fn deduct_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    sale_line_id: &str,
    inventory_item_id: &str,
    quantity: i32,
) -> Result<bool, AppError> {
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(sale_line_id)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to read inventory ledger"))?;
    if existing.is_some() {
        return Ok(false);
    }
    let (stock_quantity, unit_cost_paise) = sqlx::query_as::<_, (i32, i64)>(
        "SELECT stock_quantity, unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE",
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to lock inventory item"))?
    .ok_or_else(|| AppError::validation("inventory item is not available for POS consumption"))?;
    let already_posted = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(sale_line_id)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to recheck inventory ledger"))?;
    if already_posted.is_some() {
        return Ok(false);
    }
    if stock_quantity < quantity {
        return Err(AppError::validation(
            "insufficient inventory for POS checkout",
        ));
    }
    let ledger_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO inventory_stock_ledger (tenant_id, branch_id, inventory_item_id, sale_id, sale_line_id, movement_type, quantity_delta, unit_cost_paise) VALUES ($1,$2,$3,$4,$5,'sale',$6,$7) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(sale_id).bind(sale_line_id)
    .bind(-quantity).bind(unit_cost_paise).fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to write inventory ledger"))?;
    if ledger_id.is_none() {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE inventory_items SET stock_quantity=stock_quantity-$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(inventory_item_id).bind(quantity)
    .execute(&mut **tx).await
    .map_err(|_| AppError::internal("failed to deduct inventory"))?;
    Ok(true)
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
    sqlx::query_as::<_, PosSaleRow>(&sale_query)
        .bind(sale_id)
        .bind(tenant_id)
        .bind(branch_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to lock pos invoice"))?
        .ok_or_else(|| AppError::not_found("pos invoice was not found"))
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
    let query = format!("SELECT id FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND idempotency_key=$4");
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
    let query = format!("SELECT COALESCE(SUM(amount_paise), 0)::BIGINT FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3");
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

async fn load_pos_sale_details(
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

    Ok(PosSaleDetailsResponse {
        sale: response.clone(),
        invoice: response,
        lines,
        payments,
        payment_split,
        client_kpi,
    })
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
) -> Result<(), AppError> {
    let line_count = drafts.len();
    let mut payload = line_payload_for_recalc(sale, &drafts);
    resolve_coupon_discount(state, tenant_id, branch_id, &mut payload).await?;
    let gst_context = gst_context_from_sale(state, tenant_id, branch_id, &sale.id).await?;
    let mut calculation = calculate_pos(&payload)?;
    apply_gst_context(
        &mut calculation,
        &gst_context,
        payload.round_to_nearest_rupee.unwrap_or(false),
    );
    enforce_discount_rules(state, tenant_id, branch_id, &calculation).await?;

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
          staff_id, staff_splits, quantity, unit_price_paise, gross_paise, taxable_paise,
          discount_paise, discount_type, discount_value_paise, discount_bps,
          tax_percent, gst_paise, hsn_sac_code, cgst_paise, sgst_paise, igst_paise, reverse_charge,
          line_total_paise, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW(),NOW())
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

#[cfg(test)]
mod package_credit_value_tests {
    use super::allocate_package_credit_values;
    use serde_json::json;

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
        .map(|line| (line.item_id.clone(), line.quantity))
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
    let membership_lines = sqlx::query_as::<_, (String, i64)>(
        "SELECT item_id, quantity FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type='membership' AND item_id <> ''",
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
    membership_lines: &[(String, i64)],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM client_membership_credits WHERE tenant_id=$1 AND branch_id=$2 AND source_sale_id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to refresh membership credits"))?;

    for (membership_id, line_qty) in membership_lines {
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

        let previous = sqlx::query_as::<_, (String,String,i64,bool,String)>("SELECT cm.id,cm.membership_id,m.price_paise,cm.auto_renew_enabled,cm.auto_renew_status FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.client_id=$3 AND cm.active=TRUE ORDER BY cm.assigned_at DESC LIMIT 1 FOR UPDATE")
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
            "INSERT INTO client_memberships (tenant_id, branch_id, client_id, membership_id, assigned_at, expires_at, active, source_sale_id, auto_renew_enabled, auto_renew_status, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),CASE WHEN $5 > 0 THEN NOW() + ($5::INT * INTERVAL '1 day') ELSE NULL END,TRUE,$6,$7,$8,NOW(),NOW()) RETURNING id",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(membership_id)
        .bind(validity_days)
        .bind(sale_id)
        .bind(previous.as_ref().is_some_and(|row| row.3))
        .bind(previous.as_ref().map(|row| row.4.as_str()).unwrap_or("disabled"))
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

        for (service_id, service_name, service_qty) in package_service_rows(&services_json) {
            let total_qty =
                service_qty.saturating_mul((*line_qty).clamp(1, i32::MAX as i64) as i32);
            sqlx::query(
                "INSERT INTO client_membership_credits (tenant_id, branch_id, client_id, membership_id, membership_name, service_id, service_name, total_qty, remaining_qty, expires_at, source_sale_id, active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,CASE WHEN $9 > 0 THEN (CURRENT_DATE + ($9::INT * INTERVAL '1 day'))::DATE ELSE NULL END,$10,TRUE,NOW(),NOW())",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .bind(membership_id)
            .bind(&membership_name)
            .bind(&service_id)
            .bind(&service_name)
            .bind(total_qty)
            .bind(validity_days)
            .bind(sale_id)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to grant membership credits"))?;
        }
    }
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
    sqlx::query("UPDATE membership_auto_renew_attempts SET status='completed',source_sale_id=$4,error_message='',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('payment_required','checkout_ready','failed')")
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
    use super::membership_lifecycle_event;

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
            "SELECT client_id AS credit_owner_id,remaining_qty, membership_id, membership_name, service_id, service_name FROM client_membership_credits WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND (client_id=$4 OR EXISTS (SELECT 1 FROM membership_family_members fm JOIN client_memberships cm ON cm.id=fm.client_membership_id AND cm.active=TRUE WHERE fm.tenant_id=$2 AND fm.branch_id=$3 AND fm.member_client_id=$4 AND fm.owner_client_id=client_membership_credits.client_id AND fm.active=TRUE)) AND active=TRUE AND remaining_qty > 0 AND (expires_at IS NULL OR expires_at >= CURRENT_DATE) FOR UPDATE",
        )
        .bind(credit_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load membership credit"))?
        .ok_or_else(|| AppError::validation("membership credit is not available"))?;
        if *quantity <= 0 || *quantity > credit.remaining_qty {
            return Err(AppError::validation(
                "membership redeem quantity is not available",
            ));
        }
        let remaining = credit.remaining_qty - *quantity;
        sqlx::query("UPDATE client_membership_credits SET remaining_qty=$5, active=$6, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND client_id=$4")
            .bind(credit_id)
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&credit.credit_owner_id)
            .bind(remaining)
            .bind(remaining > 0)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to consume membership credit"))?;
        sqlx::query("INSERT INTO pos_membership_redemptions (tenant_id, branch_id, sale_id, client_id, client_membership_credit_id, membership_id, membership_name, service_id, service_name, staff_id, quantity, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(sale_id)
            .bind(client_id)
            .bind(credit_id)
            .bind(&credit.membership_id)
            .bind(&credit.membership_name)
            .bind(&credit.service_id)
            .bind(&credit.service_name)
            .bind(staff_id)
            .bind(quantity)
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
            SELECT remaining_qty, unit_value_paise, issued_value_paise, package_id, package_name, service_id, service_name
              FROM client_package_credits
             WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND client_id=$4
               AND active=TRUE
               AND remaining_qty > 0
               AND ($5=FALSE OR expires_at IS NULL OR expires_at >= CURRENT_DATE)
             FOR UPDATE
            "#,
        )
        .bind(&credit_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .bind(block_expired)
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

        let remaining = credit.remaining_qty - quantity;
        let redeemed_before = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(redeemed_value_paise),0)::BIGINT FROM pos_package_redemptions WHERE tenant_id=$1 AND branch_id=$2 AND client_package_credit_id=$3")
            .bind(tenant_id).bind(branch_id).bind(&credit_id).fetch_one(&mut **tx).await
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
        .bind(branch_id)
        .bind(client_id)
        .bind(remaining)
        .bind(remaining > 0)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to consume package credit"))?;

        sqlx::query(
            r#"
            INSERT INTO pos_package_redemptions (
              tenant_id, branch_id, sale_id, client_id, client_package_credit_id, package_id,
              package_name, service_id, service_name, staff_id, quantity,
              unit_value_paise, redeemed_value_paise, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
            "#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(sale_id)
        .bind(client_id)
        .bind(&credit_id)
        .bind(&credit.package_id)
        .bind(&credit.package_name)
        .bind(&credit.service_id)
        .bind(&credit.service_name)
        .bind(package_redemption_string(row, &["staffId"]))
        .bind(quantity)
        .bind(credit.unit_value_paise)
        .bind(redeemed_value)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to save package redemption"))?;
    }

    Ok(())
}

async fn consume_coupon_usage(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    coupon_code: &str,
) -> Result<(), AppError> {
    if coupon_code.trim().is_empty() {
        return Ok(());
    }

    let result = sqlx::query(
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

    if result.rows_affected() == 0 {
        return Err(AppError::validation(
            "coupon code is not valid for this branch",
        ));
    }

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
               staff_id, staff_splits, unit_price_paise, gross_paise, taxable_paise,
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
        "SELECT id, tenant_id, branch_id, sale_id, method, amount_paise, method_reference, label, notes, created_at FROM pos_payments WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at ASC",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load sale payments"))?;

    Ok(rows.into_iter().map(payment_response).collect())
}
