use crate::{
    models::common::ApiResponse,
    repositories::{inventory_repository, payment_methods_repository, services_repository},
    routes::{cash_drawer, context::current_business_date, payment_platform, pos},
    services::{
        accounting_service,
        auth_service::{self, AuthClaims},
        benefit_notification_service, booking_intelligence_service, booking_service,
        cash_drawer_service, payment_platform_service as platform, security_service,
        service_pricing_service, staff_app_service, staff_enterprise_service, wallet_service,
    },
    state::{AppState, AppointmentEvent},
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgRow, Row};

const DEFAULT_TENANT: &str = "default-tenant";
const DEFAULT_BRANCH: &str = "default-branch";
const PUBLIC_BOOKING_TOKEN_TYPE: &str = "public-booking";

#[derive(Serialize)]
pub(crate) struct ApiError {
    status: u16,
    error: String,
}

impl ApiError {
    pub(crate) fn with_status(status: StatusCode, error: impl Into<String>) -> Self {
        Self {
            status: status.as_u16(),
            error: error.into(),
        }
    }

    pub(crate) fn bad_request(message: impl Into<String>) -> Self {
        Self::with_status(StatusCode::BAD_REQUEST, message)
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::with_status(StatusCode::NOT_FOUND, message)
    }

    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::with_status(StatusCode::CONFLICT, message)
    }

    pub(crate) fn unauthorized(message: impl Into<String>) -> Self {
        Self::with_status(StatusCode::UNAUTHORIZED, message)
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::with_status(StatusCode::INTERNAL_SERVER_ERROR, message)
    }

    pub(crate) fn status_code(&self) -> StatusCode {
        StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            Json(self),
        )
            .into_response()
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        // Smart booking surface
        .route(
            "/smart-booking/summary",
            axum::routing::get(smart_booking_summary),
        )
        .route(
            "/smart-booking/recommend-slots",
            axum::routing::post(recommend_slots),
        )
        .route(
            "/smart-booking/bookings",
            axum::routing::post(create_booking_from_smart_booking),
        )
        .route(
            "/smart-booking/waitlist",
            axum::routing::get(list_waitlist).post(add_waitlist),
        )
        .route(
            "/smart-booking/waitlist/:id",
            axum::routing::delete(delete_waitlist),
        )
        .route(
            "/smart-booking/waitlist/:id/promote",
            axum::routing::post(promote_waitlist),
        )
        .route(
            "/smart-booking/online-request",
            axum::routing::post(online_request),
        )
        .route(
            "/smart-booking/qr-check-in",
            axum::routing::post(qr_check_in),
        )
        .route(
            "/smart-booking/queue-prediction",
            axum::routing::get(queue_prediction),
        )
        // Core appointment CRUD + lifecycle
        .route("/appointments", axum::routing::get(list_appointments))
        .route("/appointments", axum::routing::post(create_appointment))
        .route(
            "/appointments/batch",
            axum::routing::post(save_appointment_batch_authenticated),
        )
        .route(
            "/appointment-resources",
            axum::routing::get(list_appointment_resources),
        )
        .route(
            "/appointment-resources",
            axum::routing::post(create_appointment_resource),
        )
        .route(
            "/appointment-settings",
            axum::routing::get(get_appointment_settings),
        )
        .route(
            "/appointment-settings",
            axum::routing::patch(save_appointment_settings),
        )
        .route(
            "/appointment-reschedule-requests",
            axum::routing::get(list_reschedule_requests),
        )
        .route(
            "/appointment-reschedule-requests/:id/approve",
            axum::routing::post(approve_reschedule_request),
        )
        .route(
            "/appointment-reschedule-requests/:id/reject",
            axum::routing::post(reject_reschedule_request),
        )
        .route("/appointments/:id", axum::routing::get(get_appointment))
        .route(
            "/appointments/:id/notes",
            axum::routing::patch(update_appointment_notes),
        )
        .route("/appointments/:id/status", axum::routing::post(set_status))
        .route(
            "/appointment-lifecycle/appointments/:id/status",
            axum::routing::post(set_status),
        )
        .route(
            "/appointments/:id/cancel",
            axum::routing::post(cancel_appointment),
        )
        .route(
            "/appointments/:id/restore",
            axum::routing::post(restore_appointment),
        )
        .route(
            "/appointments/:id/fee-policy",
            axum::routing::get(appointment_fee_policy),
        )
        .route(
            "/appointments/:id/fee-waive",
            axum::routing::post(waive_appointment_fee),
        )
        .route(
            "/appointments/:id/fee-charge",
            axum::routing::post(charge_appointment_fee),
        )
        .route(
            "/appointments/:id/remove-service",
            axum::routing::post(remove_appointment_service),
        )
        .route(
            "/appointments/:id/reschedule",
            axum::routing::post(reschedule_appointment),
        )
        .route(
            "/staff-self/appointments/:id/cancel",
            axum::routing::post(cancel_self_appointment),
        )
        .route(
            "/staff-self/appointments/:id/reschedule",
            axum::routing::post(reschedule_self_appointment),
        )
        .route(
            "/staff-self/appointment-book",
            axum::routing::get(staff_appointment_book),
        )
        .route(
            "/staff-self/appointment-book/clients/:id/eligibility",
            axum::routing::get(staff_appointment_eligibility),
        )
        .route(
            "/staff-self/appointment-book/quote",
            axum::routing::post(quote_self_appointment),
        )
        .route(
            "/staff-self/appointments/batch",
            axum::routing::post(save_self_appointment_batch),
        )
        .route(
            "/staff-self/appointments/:id/status",
            axum::routing::post(set_self_appointment_status),
        )
        .route(
            "/staff-self/appointments/:id/operations",
            axum::routing::get(staff_self_appointment_operations)
                .post(run_self_appointment_operation),
        )
        .route(
            "/staff-self/appointments/:id/service-workspace",
            axum::routing::get(staff_self_service_workspace),
        )
        .route(
            "/staff-self/appointments/:id/invoice-lines",
            axum::routing::post(add_staff_self_invoice_line),
        )
        .route(
            "/staff-self/appointments/:id/checkout",
            axum::routing::get(staff_self_checkout).put(update_staff_self_checkout),
        )
        .route(
            "/staff-self/appointments/:id/checkout/payments",
            axum::routing::post(add_staff_self_checkout_payment),
        )
        .route(
            "/staff-self/appointments/:id/checkout/provider-payment",
            axum::routing::post(start_staff_self_provider_payment),
        )
        .route(
            "/staff-self/appointments/:id/checkout/upi-link",
            axum::routing::post(create_staff_self_upi_link),
        )
        .route(
            "/staff-self/appointments/:id/checkout/finalize",
            axum::routing::post(finalize_staff_self_checkout),
        )
        .route(
            "/staff-self/appointments/:id/checkout/receipt",
            axum::routing::get(staff_self_checkout_receipt).post(record_staff_self_receipt_action),
        )
        .route(
            "/staff-self/appointments/:id/checkout/lifecycle",
            axum::routing::post(staff_self_checkout_lifecycle),
        )
        .route(
            "/staff-self/appointments/:id/no-show-charge",
            axum::routing::post(staff_self_no_show_charge),
        )
        .route(
            "/staff-self/register/current",
            axum::routing::get(staff_self_register_current),
        )
        .route(
            "/staff-self/register/open",
            axum::routing::post(staff_self_register_open),
        )
        .route(
            "/staff-self/register/movements",
            axum::routing::get(staff_self_register_movements).post(staff_self_register_movement),
        )
        .route(
            "/staff-self/register/close",
            axum::routing::post(staff_self_register_close),
        )
        .route(
            "/staff-self/register/:id/approve",
            axum::routing::post(staff_self_register_approve),
        )
        .route(
            "/staff-self/register/provider-reconciliations",
            axum::routing::get(staff_self_provider_reconciliations)
                .post(create_staff_self_provider_reconciliation),
        )
        .route(
            "/staff-self/register/provider-reconciliations/:id/review",
            axum::routing::post(review_staff_self_provider_reconciliation),
        )
        .route(
            "/staff-self/online-booking-requests/:id/decision",
            axum::routing::post(decide_self_online_booking_request),
        )
        .route(
            "/staff-self/waitlist/:id/convert",
            axum::routing::post(convert_self_waitlist),
        )
        .route(
            "/appointments/:id/check-in",
            axum::routing::post(check_in_appointment),
        )
        .route(
            "/appointments/:id/start-service",
            axum::routing::post(start_service),
        )
        .route(
            "/appointments/:id/complete",
            axum::routing::post(complete_appointment),
        )
        .route(
            "/appointments/:id/no-show",
            axum::routing::post(mark_no_show),
        )
        .route(
            "/appointments/:id/no-show-charge",
            axum::routing::post(mark_no_show_with_charge),
        )
        .route(
            "/appointments/:id/duplicate",
            axum::routing::post(duplicate_appointment),
        )
        .route(
            "/appointments/:id/convert-to-sale",
            axum::routing::post(convert_to_sale),
        )
        // Admin helpers + operational rails
        .route("/blackouts", axum::routing::get(list_blackouts))
        .route("/blackouts", axum::routing::post(create_blackout))
        .route("/blackouts/:id", axum::routing::delete(delete_blackout))
        .route(
            "/booking-wizard/state",
            axum::routing::post(save_wizard_state),
        )
        .route(
            "/booking-wizard/state/:session_id",
            axum::routing::get(get_wizard_state),
        )
        .route(
            "/booking-wizard/state/:session_id",
            axum::routing::delete(clear_wizard_state),
        )
        .route("/booking-groups", axum::routing::post(create_booking_group))
        .route("/booking-groups/:id", axum::routing::get(get_booking_group))
        .route(
            "/booking-groups/:id",
            axum::routing::patch(update_booking_group),
        )
        .route(
            "/booking-groups/:id/confirm",
            axum::routing::post(confirm_booking_group),
        )
        .route(
            "/booking-groups/:id/consolidate-billing",
            axum::routing::post(consolidate_group_billing),
        )
        .route(
            "/booking-groups/:id/calendar",
            axum::routing::get(group_calendar_view),
        )
        .route(
            "/services/resolve-chain",
            axum::routing::post(resolve_service_chain),
        )
        .route(
            "/services/validate-combo",
            axum::routing::post(validate_service_combo),
        )
        .route(
            "/audit/appointments/:id",
            axum::routing::get(appointment_audit),
        )
        .route(
            "/calendar/ical/staff/:staff_id",
            axum::routing::get(staff_ical_feed),
        )
        .route(
            "/calendar/ical/branch/:branch_id",
            axum::routing::get(branch_ical_feed),
        )
        .route(
            "/reports/booking-attribution",
            axum::routing::get(booking_attribution),
        )
        .route(
            "/reports/warranty-cost-impact",
            axum::routing::get(warranty_cost_impact),
        )
}

#[derive(Deserialize)]
pub(crate) struct ScopeQuery {
    pub(crate) tenant_id: Option<String>,
    pub(crate) branch_id: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ListAppointmentQuery {
    pub(crate) tenant_id: Option<String>,
    pub(crate) branch_id: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) client_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffAppointmentBookQuery {
    from: String,
    to: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    staff_id: String,
    #[serde(default)]
    q: String,
    #[serde(default)]
    view: String,
}

#[derive(Deserialize)]
pub(crate) struct AppointmentCreatePayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    pub(crate) branch_id: Option<String>,
    #[serde(default)]
    pub(crate) staff_id: String,
    #[serde(default)]
    pub(crate) requested_staff_id: String,
    #[serde(default)]
    pub(crate) staff_preference: String,
    #[serde(default)]
    pub(crate) client_id: String,
    #[serde(default)]
    pub(crate) service_ids: Vec<String>,
    pub(crate) start_at: String,
    pub(crate) end_at: String,
    #[serde(default)]
    pub(crate) notes: String,
    #[serde(default)]
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) booking_group_id: String,
    #[serde(default)]
    pub(crate) source_channel: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
    #[serde(default)]
    pub(crate) chair_room_id: String,
    #[serde(default, alias = "serviceSelections")]
    pub(crate) service_selections: Vec<AppointmentServiceSelection>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppointmentServiceSelection {
    #[serde(default)]
    pub(crate) service_id: String,
    #[serde(default)]
    pub(crate) variant_id: String,
    #[serde(default)]
    pub(crate) addon_ids: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct RecommendSlotsPayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    date: Option<String>,
    #[serde(default)]
    duration_minutes: Option<i64>,
}

#[derive(Deserialize)]
pub(crate) struct SmartWaitlistPayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    customer_id: String,
    #[serde(default)]
    service_ids: Vec<String>,
    #[serde(default)]
    preferred_staff_id: Option<String>,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    preferred_slot_at: Option<String>,
    #[serde(default)]
    constraint_type: String,
    #[serde(default)]
    constraint_resource_kind: String,
}

#[derive(Deserialize)]
pub(crate) struct OnlineRequestPayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    event_type: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
pub(crate) struct QrCheckInPayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    appointment_id: Option<String>,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct StatusPayload {
    #[serde(default)]
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) reason: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) apply_group: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoShowChargePayload {
    pub(crate) amount_paise: i64,
    #[serde(default = "default_payment_provider")]
    pub(crate) provider: String,
    #[serde(default)]
    pub(crate) idempotency_key: String,
    #[serde(default)]
    pub(crate) reason: String,
}

fn default_payment_provider() -> String {
    "razorpay".to_string()
}

#[derive(Deserialize)]
pub(crate) struct AppointmentNotesPayload {
    #[serde(default)]
    pub(crate) notes: String,
}

#[derive(Deserialize)]
pub(crate) struct AppointmentBatchLinePayload {
    #[serde(default)]
    pub(crate) appointment_id: String,
    #[serde(default)]
    pub(crate) expected_version: Option<i32>,
    #[serde(default)]
    pub(crate) client_id: String,
    #[serde(default)]
    pub(crate) staff_id: String,
    #[serde(default)]
    pub(crate) requested_staff_id: String,
    #[serde(default)]
    pub(crate) staff_preference: String,
    #[serde(default)]
    pub(crate) staff_change_approval: String,
    #[serde(default)]
    pub(crate) staff_change_reason: String,
    #[serde(default)]
    pub(crate) recommended_staff_id: String,
    #[serde(default)]
    pub(crate) recommendation_override_reason: String,
    #[serde(default)]
    pub(crate) service_id: String,
    #[serde(default)]
    pub(crate) start_at: String,
    #[serde(default)]
    pub(crate) end_at: String,
    #[serde(default)]
    pub(crate) chair_room_id: String,
    #[serde(default)]
    pub(crate) notes: String,
    #[serde(default)]
    pub(crate) variant_id: String,
    #[serde(default)]
    pub(crate) addon_ids: Vec<String>,
    #[serde(default)]
    pub(crate) price_override_paise: Option<i64>,
    #[serde(default)]
    pub(crate) price_override_reason: String,
    #[serde(default)]
    pub(crate) service_mode: String,
    #[serde(default)]
    pub(crate) segment_label: String,
    #[serde(default)]
    pub(crate) sequence_no: Option<i32>,
}

#[derive(Deserialize)]
pub(crate) struct AppointmentBatchPayload {
    #[serde(default)]
    pub(crate) client_id: String,
    #[serde(default)]
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) booking_group_id: String,
    #[serde(default)]
    pub(crate) removed_appointment_ids: Vec<String>,
    #[serde(default)]
    pub(crate) recurrence_count: Option<i32>,
    #[serde(default)]
    pub(crate) recurrence_interval_days: Option<i64>,
    #[serde(default)]
    pub(crate) lines: Vec<AppointmentBatchLinePayload>,
    #[serde(default)]
    pub(crate) advance_payment: Option<AppointmentAdvancePaymentPayload>,
    #[serde(default)]
    pub(crate) idempotency_key: String,
    #[serde(default)]
    pub(crate) booking_type: String,
    #[serde(default)]
    pub(crate) day_package_id: String,
    #[serde(default)]
    pub(crate) host_client_id: String,
    #[serde(default)]
    pub(crate) group_name: String,
    #[serde(default)]
    pub(crate) group_notes: String,
    #[serde(default)]
    pub(crate) is_surprise: bool,
    #[serde(default)]
    pub(crate) virtual_meeting_url: String,
    #[serde(default)]
    pub(crate) outside_hours_override_reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreAppointmentPayload {
    expected_version: Option<i32>,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    outside_hours_override_reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppointmentFeeWaiverPayload {
    #[serde(default)]
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffAppointmentOperationPayload {
    #[serde(default)]
    action: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    handoff_staff_id: String,
    #[serde(default)]
    apply_group: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaffServiceWorkspaceQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    barcode: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffInvoiceLinePayload {
    item_type: String,
    item_id: String,
    quantity: i64,
    unit_price_paise: Option<i64>,
    #[serde(default)]
    price_reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffCheckoutUpdatePayload {
    #[serde(default)]
    bill_discount_paise: i64,
    #[serde(default)]
    discount_reason: String,
    #[serde(default)]
    coupon_code: String,
    #[serde(default)]
    tip_paise: i64,
    #[serde(default)]
    tip_splits: Vec<Value>,
    #[serde(default)]
    round_to_nearest_rupee: bool,
    #[serde(default)]
    package_redemptions: Vec<Value>,
    #[serde(default)]
    membership_redemptions: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffCheckoutPaymentPayload {
    method: String,
    amount_paise: i64,
    #[serde(default)]
    reference: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    cash_drawer_till_id: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffProviderPaymentPayload {
    #[serde(default)]
    provider: String,
    amount_paise: i64,
    #[serde(default)]
    provider_payment_method_id: String,
    #[serde(default)]
    provider_customer_id: String,
    #[serde(default)]
    store_payment_method: bool,
    #[serde(default)]
    saved_instrument_id: String,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffUpiLinkPayload {
    #[serde(default = "default_payment_provider")]
    provider: String,
    amount_paise: Option<i64>,
    idempotency_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffCheckoutFinalizePayload {
    #[serde(default)]
    cash_drawer_till_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffCheckoutLifecyclePayload {
    action: String,
    #[serde(flatten)]
    request: pos::InvoiceLifecycleRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnlineBookingDecisionPayload {
    #[serde(default)]
    decision: String,
    #[serde(default)]
    reason: String,
}

#[derive(Deserialize)]
pub(crate) struct AppointmentAdvancePaymentPayload {
    pub(crate) amount_paise: i64,
    #[serde(default)]
    pub(crate) method: String,
    #[serde(default)]
    pub(crate) reference: String,
    #[serde(default)]
    pub(crate) cash_drawer_till_id: String,
}

struct ValidatedAdvancePayment {
    amount_paise: i64,
    method: String,
    settlement_type: String,
    reference: String,
    cash_drawer_till_id: String,
}

#[derive(Deserialize)]
pub(crate) struct ReschedulePayload {
    #[serde(default)]
    pub(crate) expected_version: Option<i32>,
    #[serde(default)]
    pub(crate) start_at: String,
    #[serde(default)]
    pub(crate) end_at: Option<String>,
    #[serde(default)]
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) staff_id: String,
    #[serde(default)]
    pub(crate) staff_change_approval: String,
    #[serde(default)]
    pub(crate) staff_change_reason: String,
    #[serde(default)]
    pub(crate) service_ids: Vec<String>,
    #[serde(default)]
    pub(crate) branch_id: String,
    #[serde(default)]
    pub(crate) chair_room_id: String,
    #[serde(default)]
    pub(crate) booking_group_id: String,
    #[serde(default)]
    pub(crate) change_mode: String,
    #[serde(default)]
    pub(crate) actor_source: String,
    #[serde(default)]
    pub(crate) outside_hours_override_reason: String,
}

#[derive(Deserialize)]
struct RescheduleDecisionPayload {
    #[serde(default)]
    reason: String,
}

#[derive(Clone, Copy)]
pub(crate) struct RescheduleRules {
    pub client_self_reschedule: bool,
    pub approval_required: bool,
    pub cutoff_hours: i64,
    pub max_reschedule_count: i64,
    pub sms_app_notification: bool,
    pub per_service_sms: bool,
}

#[derive(Deserialize)]
pub(crate) struct AppointmentResourcePayload {
    #[serde(default)]
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) department: String,
    #[serde(default = "default_resource_capacity")]
    pub(crate) capacity: i32,
}

fn default_resource_capacity() -> i32 {
    1
}

#[derive(Serialize)]
pub(crate) struct AppointmentResourceResponse {
    id: String,
    name: String,
    kind: String,
    department: String,
    capacity: i32,
    active: bool,
}

#[derive(Deserialize)]
pub(crate) struct AppointmentSettingsPayload {
    pub(crate) allow_overlap: bool,
    #[serde(default)]
    pub(crate) settings: Value,
}

#[derive(Deserialize)]
pub(crate) struct BlackoutPayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    pub(crate) branch_id: Option<String>,
    #[serde(default)]
    pub(crate) staff_id: String,
    #[serde(default)]
    pub(crate) staff_ids: Vec<String>,
    #[serde(default)]
    pub(crate) blackout_date: String,
    #[serde(default)]
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) blocked_until: Option<String>,
    #[serde(default)]
    pub(crate) blocked_from: Option<String>,
}

fn blackout_staff_ids(payload: &BlackoutPayload) -> Vec<String> {
    let mut staff_ids = Vec::new();
    for staff_id in &payload.staff_ids {
        let staff_id = staff_id.trim();
        if !staff_id.is_empty() && !staff_ids.iter().any(|item| item == staff_id) {
            staff_ids.push(staff_id.to_string());
        }
    }
    if staff_ids.is_empty() {
        staff_ids.push(payload.staff_id.trim().to_string());
    }
    staff_ids
}

fn blackout_group_id(staff_ids: &[String]) -> String {
    if staff_ids.len() > 1 {
        uuid::Uuid::new_v4().to_string()
    } else {
        String::new()
    }
}

fn appointment_settings_json(value: Value) -> Value {
    value
        .is_object()
        .then_some(value)
        .unwrap_or_else(|| json!({}))
}

fn waitlist_constraint(payload: &SmartWaitlistPayload) -> Result<(&str, &str), ApiError> {
    let constraint_type = payload.constraint_type.trim();
    let constraint_type = if constraint_type.is_empty() {
        "none"
    } else {
        constraint_type
    };
    let resource_kind = payload.constraint_resource_kind.trim();
    if !matches!(
        constraint_type,
        "none" | "resource_unavailable" | "capacity_full" | "equipment_maintenance"
    ) {
        return Err(ApiError::bad_request("invalid waitlist constraint_type"));
    }
    if !matches!(resource_kind, "" | "chair" | "room" | "workstation") {
        return Err(ApiError::bad_request(
            "invalid waitlist constraint_resource_kind",
        ));
    }
    if constraint_type != "none" && payload.service_ids.is_empty() {
        return Err(ApiError::bad_request(
            "service required for a capacity constraint",
        ));
    }
    if constraint_type == "none" && !resource_kind.is_empty() {
        return Err(ApiError::bad_request(
            "resource kind requires a capacity constraint",
        ));
    }
    Ok((constraint_type, resource_kind))
}

#[cfg(test)]
mod blackout_tests {
    use super::*;

    #[test]
    fn keeps_each_selected_staff_once() {
        let payload = BlackoutPayload {
            tenant_id: None,
            branch_id: None,
            staff_id: String::new(),
            staff_ids: vec!["staff-a".into(), "staff-a".into(), "staff-b".into()],
            blackout_date: String::new(),
            reason: String::new(),
            blocked_until: None,
            blocked_from: None,
        };
        assert_eq!(blackout_staff_ids(&payload), vec!["staff-a", "staff-b"]);
    }

    #[test]
    fn rejects_non_object_appointment_settings() {
        assert_eq!(appointment_settings_json(json!([])), json!({}));
    }

    #[test]
    fn creates_a_group_only_for_multi_staff_blackouts() {
        assert!(blackout_group_id(&["staff-a".into()]).is_empty());
        assert!(!blackout_group_id(&["staff-a".into(), "staff-b".into()]).is_empty());
    }

    #[test]
    fn uses_requested_service_ids_when_replacing_a_booking_service() {
        assert_eq!(
            requested_service_ids(&["service-old".into()], vec!["service-new".into()]),
            vec!["service-new"]
        );
    }

    #[test]
    fn booking_line_client_prefers_the_line_client() {
        assert_eq!(booking_line_client_id("primary", "partner"), "partner");
        assert_eq!(booking_line_client_id("primary", ""), "primary");
    }

    #[test]
    fn accepts_only_bounded_safe_booking_keys() {
        assert!(valid_booking_key("staff-app:12345678"));
        assert!(!valid_booking_key("short"));
        assert!(!valid_booking_key("staff app:12345678"));
    }

    #[test]
    fn validates_advanced_booking_shapes_and_meeting_links() {
        assert_eq!(advanced_booking_kind("couple", 2).ok(), Some("couple"));
        assert!(advanced_booking_kind("group", 7).is_err());
        assert_eq!(advanced_service_mode("parallel").ok(), Some("parallel"));
        assert!(valid_optional_http_url("https://meet.example.com/visit"));
        assert!(!valid_optional_http_url("javascript:alert(1)"));
    }

    #[test]
    fn maps_staff_booking_rule_codes_to_user_errors() {
        assert_eq!(
            staff_booking_rule_message("STAFF_SERVICE"),
            "selected staff is not assigned to this service"
        );
        assert_eq!(
            staff_booking_rule_message("OTHER_CENTER_WORKING"),
            "staff is working at another center for this time"
        );
    }

    #[test]
    fn serializes_variant_and_addons_for_booked_price_snapshot() {
        let result = service_selections_json(
            &["service-1".into()],
            &[AppointmentServiceSelection {
                service_id: "service-1".into(),
                variant_id: "variant-1".into(),
                addon_ids: vec!["addon-1".into()],
            }],
        );
        assert!(result.is_ok());
        let json = result.ok().unwrap();
        assert!(json.contains("variant-1"));
        assert!(json.contains("addon-1"));
    }

    #[test]
    fn validates_structured_waitlist_constraints() {
        let mut payload = SmartWaitlistPayload {
            tenant_id: None,
            branch_id: None,
            customer_id: "client".into(),
            service_ids: vec!["service".into()],
            preferred_staff_id: None,
            notes: String::new(),
            preferred_slot_at: None,
            constraint_type: "capacity_full".into(),
            constraint_resource_kind: "chair".into(),
        };
        assert_eq!(
            waitlist_constraint(&payload).ok(),
            Some(("capacity_full", "chair"))
        );
        payload.constraint_resource_kind = "machine".into();
        assert!(waitlist_constraint(&payload).is_err());
    }

    #[sqlx::test(migrations = false)]
    async fn serializes_simultaneous_staff_bookings(pool: sqlx::PgPool) {
        sqlx::raw_sql(
            "CREATE TABLE appointments(
                id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
                staff_id TEXT NOT NULL,status TEXT NOT NULL,service_ids_json TEXT NOT NULL DEFAULT '[]',
                start_at TIMESTAMPTZ NOT NULL,end_at TIMESTAMPTZ NOT NULL,
                staff_preference TEXT NOT NULL DEFAULT 'any'
             );
             CREATE TABLE services(
                id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 60,processing_time_minutes INTEGER NOT NULL DEFAULT 0,
                wait_time_minutes INTEGER NOT NULL DEFAULT 0,cleanup_time_minutes INTEGER NOT NULL DEFAULT 0,
                buffer_time_minutes INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE appointment_branch_settings(
                tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,allow_overlap BOOLEAN NOT NULL DEFAULT FALSE
             );",
        )
        .execute(&pool)
        .await
        .expect("appointment collision test schema");
        sqlx::raw_sql(include_str!(
            "../../migrations/0395_appointment_book_scheduling_engine.sql"
        ))
        .execute(&pool)
        .await
        .expect("phase 6 migration");

        let mut first = pool.begin().await.expect("first booking transaction");
        sqlx::query("INSERT INTO appointments(id,tenant_id,branch_id,staff_id,status,start_at,end_at) VALUES('booking-a','tenant-a','branch-a','staff-a','booked','2035-01-01T10:00:00Z','2035-01-01T11:00:00Z')")
            .execute(&mut *first).await.expect("first booking");
        let second_pool = pool.clone();
        let second = tokio::spawn(async move {
            sqlx::query("INSERT INTO appointments(id,tenant_id,branch_id,staff_id,status,start_at,end_at) VALUES('booking-b','tenant-a','branch-a','staff-a','booked','2035-01-01T10:30:00Z','2035-01-01T11:30:00Z')")
                .execute(&second_pool).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(75)).await;
        assert!(
            !second.is_finished(),
            "second booking must wait for the staff lock"
        );
        first.commit().await.expect("commit first booking");

        let error = second
            .await
            .expect("second booking task")
            .expect_err("overlapping booking must fail");
        assert_eq!(
            error
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref(),
            Some("23P01")
        );
    }
}

#[derive(Deserialize)]
pub(crate) struct BookingGroupPayload {
    #[serde(default)]
    pub(crate) tenant_id: Option<String>,
    #[serde(default)]
    branch_id: Option<String>,
    #[serde(default)]
    group_name: String,
    #[serde(default)]
    member_appointment_ids: Vec<String>,
}

#[derive(Deserialize)]
pub(crate) struct BookingGroupUpdatePayload {
    #[serde(default)]
    status: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ResolveServicesPayload {
    #[serde(default)]
    service_ids: Vec<String>,
}

#[derive(Serialize)]
pub(crate) struct AppointmentResponse {
    pub(crate) appointment: AppointmentPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    waitlist_offer: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sales_order: Option<SalePayload>,
}

#[derive(Serialize, Clone)]
pub(crate) struct AppointmentPayload {
    pub(crate) id: String,
    pub(crate) tenant_id: String,
    pub(crate) branch_id: String,
    pub(crate) client_id: String,
    pub(crate) staff_id: String,
    pub(crate) requested_staff_id: String,
    pub(crate) staff_preference: String,
    pub(crate) service_ids: Vec<String>,
    pub(crate) start_at: String,
    pub(crate) end_at: String,
    pub(crate) status: String,
    pub(crate) notes: String,
    pub(crate) source_channel: String,
    pub(crate) source: String,
    pub(crate) chair_room_id: String,
    pub(crate) booking_group_id: Option<String>,
    pub(crate) version: i32,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) booking_type: String,
    pub(crate) day_package_id: String,
    pub(crate) host_client_id: String,
    pub(crate) group_name: String,
    pub(crate) group_notes: String,
    pub(crate) is_surprise: bool,
    pub(crate) virtual_meeting_url: String,
    pub(crate) service_mode: String,
    pub(crate) segment_label: String,
    pub(crate) sequence_no: i32,
    pub(crate) execution_status: String,
    pub(crate) service_started_at: Option<String>,
    pub(crate) service_paused_at: Option<String>,
    pub(crate) paused_seconds: i64,
    pub(crate) service_completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) inventory_consumption_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) inventory_recipe_snapshots: Option<Value>,
}

#[derive(Serialize)]
pub(crate) struct BookingSummary {
    tenant_id: String,
    branch_id: String,
    total_appointments: i64,
    today_booked: i64,
    queue_depth: i64,
    waitlist_total: i64,
}

#[derive(Serialize)]
pub(crate) struct SalePayload {
    sale_id: String,
    appointment_id: String,
    total: i64,
    total_paise: i64,
    status: String,
}

#[derive(Serialize)]
pub(crate) struct BookingGroupPayloadOut {
    id: String,
    tenant_id: String,
    branch_id: String,
    group_name: String,
    members: Vec<String>,
    status: String,
    consolidated_billing: bool,
}

#[derive(Serialize)]
pub(crate) struct WaitlistPayloadOut {
    id: String,
    tenant_id: String,
    branch_id: String,
    customer_id: String,
    service_ids: Vec<String>,
    preferred_slot_at: String,
    status: String,
    created_at: String,
    constraint_type: String,
    constraint_resource_kind: String,
}

pub(crate) fn scope_from_headers(
    headers: &HeaderMap,
    tenant: Option<&str>,
    branch: Option<&str>,
) -> (String, String) {
    let tenant_id = tenant
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let header_tenant = headers
        .get("x-tenant-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let tenant_id = header_tenant
        .or(tenant_id)
        .unwrap_or_else(|| DEFAULT_TENANT.to_string());

    let branch_id = branch
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let header_branch = headers
        .get("x-branch-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let branch_id = header_branch
        .or(branch_id)
        .unwrap_or_else(|| DEFAULT_BRANCH.to_string());

    (tenant_id, branch_id)
}

fn parse_datetime(value: &str, field: &str) -> Result<DateTime<Utc>, ApiError> {
    DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc))
        .map_err(|_| ApiError::bad_request(format!("{} must be RFC3339 date-time", field)))
}

fn service_ids_to_json(service_ids: &[String]) -> String {
    serde_json::to_string(service_ids).unwrap_or_else(|_| "[]".to_string())
}

fn service_selections_json(
    service_ids: &[String],
    selections: &[AppointmentServiceSelection],
) -> Result<String, ApiError> {
    let allowed = service_ids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut values = serde_json::Map::new();
    for selection in selections {
        let service_id = selection.service_id.trim();
        if service_id.is_empty() || !allowed.contains(service_id) || values.contains_key(service_id)
        {
            return Err(ApiError::bad_request(
                "service selections must be unique and belong to the booking",
            ));
        }
        values.insert(
            service_id.to_string(),
            json!({
                "variantId": selection.variant_id.trim(),
                "addonIds": selection.addon_ids,
            }),
        );
    }
    Ok(Value::Object(values).to_string())
}

pub(crate) async fn validate_service_pricing(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    service_ids: &[String],
    selections: &[AppointmentServiceSelection],
    starts_at: DateTime<Utc>,
    client_id: &str,
    channel: &str,
) -> Result<i64, ApiError> {
    let selections = selections
        .iter()
        .map(|selection| (selection.service_id.trim(), selection))
        .collect::<std::collections::HashMap<_, _>>();
    let mut total = 0i64;
    for service_id in service_ids {
        let selection = selections.get(service_id.trim()).copied();
        let quote = service_pricing_service::quote_with_context(
            &state.db,
            tenant_id,
            branch_id,
            service_id,
            staff_id,
            selection
                .map(|value| value.variant_id.trim())
                .unwrap_or_default(),
            selection
                .map(|value| value.addon_ids.as_slice())
                .unwrap_or_default(),
            starts_at,
            client_id,
            channel,
        )
        .await
        .map_err(|_| ApiError::bad_request("service pricing selection is invalid"))?;
        total = total.saturating_add(quote.final_price_paise);
    }
    Ok(total)
}

fn requested_service_ids(current: &[String], requested: Vec<String>) -> Vec<String> {
    let service_ids = requested
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if service_ids.is_empty() {
        current.to_vec()
    } else {
        service_ids
    }
}

fn parse_service_ids(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn build_appointment(row: &PgRow) -> Result<AppointmentPayload, ApiError> {
    let service_ids_raw: String = row
        .try_get("service_ids_json")
        .map_err(|_| ApiError::internal("invalid appointment row"))?;

    let start_at: DateTime<Utc> = row
        .try_get("start_at")
        .map_err(|_| ApiError::internal("invalid appointment row"))?;
    let end_at: DateTime<Utc> = row
        .try_get("end_at")
        .map_err(|_| ApiError::internal("invalid appointment row"))?;
    let created_at: DateTime<Utc> = row
        .try_get("created_at")
        .map_err(|_| ApiError::internal("invalid appointment row"))?;
    let updated_at: DateTime<Utc> = row
        .try_get("updated_at")
        .map_err(|_| ApiError::internal("invalid appointment row"))?;
    let booking_group_id: Option<String> = row.try_get("booking_group_id").unwrap_or_default();

    Ok(AppointmentPayload {
        id: row
            .try_get("id")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        tenant_id: row
            .try_get("tenant_id")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        branch_id: row
            .try_get("branch_id")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        client_id: row
            .try_get("client_id")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        staff_id: row
            .try_get("staff_id")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        requested_staff_id: row.try_get("requested_staff_id").unwrap_or_default(),
        staff_preference: row
            .try_get::<String, _>("staff_preference")
            .unwrap_or_else(|_| "any".to_string()),
        service_ids: parse_service_ids(&service_ids_raw),
        start_at: start_at.to_rfc3339(),
        end_at: end_at.to_rfc3339(),
        status: row
            .try_get("status")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        notes: row
            .try_get("notes")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        source_channel: row
            .try_get("source_channel")
            .unwrap_or_else(|_| "manual".to_string()),
        source: row
            .try_get("source")
            .unwrap_or_else(|_| "manual".to_string()),
        chair_room_id: row.try_get("chair_room_id").unwrap_or_default(),
        booking_group_id,
        version: row
            .try_get("version")
            .map_err(|_| ApiError::internal("invalid appointment row"))?,
        created_at: created_at.to_rfc3339(),
        updated_at: updated_at.to_rfc3339(),
        booking_type: row
            .try_get("booking_type")
            .unwrap_or_else(|_| "standard".to_string()),
        day_package_id: row.try_get("day_package_id").unwrap_or_default(),
        host_client_id: row.try_get("host_client_id").unwrap_or_default(),
        group_name: row.try_get("group_name").unwrap_or_default(),
        group_notes: row.try_get("group_notes").unwrap_or_default(),
        is_surprise: row.try_get("is_surprise").unwrap_or(false),
        virtual_meeting_url: row.try_get("virtual_meeting_url").unwrap_or_default(),
        service_mode: row
            .try_get("service_mode")
            .unwrap_or_else(|_| "sequential".to_string()),
        segment_label: row.try_get("segment_label").unwrap_or_default(),
        sequence_no: row.try_get("sequence_no").unwrap_or(1),
        execution_status: row
            .try_get("execution_status")
            .unwrap_or_else(|_| "not_started".to_string()),
        service_started_at: row
            .try_get::<Option<DateTime<Utc>>, _>("service_started_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
        service_paused_at: row
            .try_get::<Option<DateTime<Utc>>, _>("service_paused_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
        paused_seconds: row.try_get("paused_seconds").unwrap_or_default(),
        service_completed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("service_completed_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339()),
        inventory_consumption_status: None,
        inventory_recipe_snapshots: None,
    })
}

fn now_text() -> String {
    Utc::now().to_rfc3339()
}

fn allowed_status() -> Vec<&'static str> {
    vec![
        "draft",
        "booked",
        "confirmed",
        "arrived",
        "waiting",
        "in-service",
        "paused",
        "completed",
        "billed",
        "paid",
        "cancelled",
        "no-show",
        "rescheduled",
    ]
}

fn status_is_closed(status: &str) -> bool {
    matches!(status, "completed" | "billed" | "paid" | "cancelled")
}

fn advanced_booking_kind(value: &str, client_count: usize) -> Result<&str, ApiError> {
    let kind = match value.trim() {
        "" | "standard" => "standard",
        "couple" => "couple",
        "group" => "group",
        "large_group" => "large_group",
        "day_package" => "day_package",
        _ => return Err(ApiError::bad_request("unsupported booking_type")),
    };
    let valid = match kind {
        "couple" => client_count == 2,
        "group" => (2..=6).contains(&client_count),
        "large_group" => (7..=30).contains(&client_count),
        _ => client_count == 1,
    };
    if !valid {
        return Err(ApiError::bad_request(match kind {
            "couple" => "couple booking requires exactly two guests",
            "group" => "group booking requires two to six guests",
            "large_group" => "large group booking requires seven to thirty guests",
            _ => "standard and day-package bookings require one guest",
        }));
    }
    Ok(kind)
}

fn advanced_service_mode(value: &str) -> Result<&str, ApiError> {
    match value.trim() {
        "" | "sequential" => Ok("sequential"),
        "gap" => Ok("gap"),
        "parallel" => Ok("parallel"),
        "segmented" => Ok("segmented"),
        _ => Err(ApiError::bad_request("unsupported service_mode")),
    }
}

fn valid_optional_http_url(value: &str) -> bool {
    value.trim().is_empty()
        || value.parse::<axum::http::Uri>().ok().is_some_and(|url| {
            matches!(url.scheme_str(), Some("http" | "https")) && url.host().is_some()
        })
}

fn normalize_staff_preference(value: &str) -> Result<&str, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "any" => Ok("any"),
        "preferred" => Ok("preferred"),
        "required" => Ok("required"),
        "first_available" => Ok("first_available"),
        "gender_female" => Ok("gender_female"),
        "gender_male" => Ok("gender_male"),
        _ => Err(ApiError::bad_request("staff_preference is invalid")),
    }
}

fn privileged_appointment_permission(claims: Option<&AuthClaims>, permission: &str) -> bool {
    claims.is_some_and(|claims| {
        auth_service::staff_app_permission_allowed(
            claims,
            permission,
            &["owner", "admin", "manager"],
            &[],
        )
    })
}

fn booking_write_error(error: sqlx::Error, fallback: &'static str) -> ApiError {
    if error
        .as_database_error()
        .and_then(|error| error.code())
        .is_some_and(|code| code == "23P01")
    {
        ApiError::conflict(
            error
                .as_database_error()
                .map(|value| value.message())
                .unwrap_or("booking time is no longer available"),
        )
    } else {
        ApiError::internal(fallback)
    }
}

pub(crate) async fn validate_branch_operating_hours(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    override_reason: &str,
    claims: Option<&AuthClaims>,
) -> Result<(), ApiError> {
    let inside = sqlx::query_scalar::<_, bool>(
        r#"SELECT CASE
          WHEN NOT EXISTS(SELECT 1 FROM branch_operating_hours h WHERE h.tenant_id::TEXT=$1 AND h.branch_id::TEXT=$2) THEN TRUE
          ELSE EXISTS(
            SELECT 1 FROM branches branch
            CROSS JOIN LATERAL (SELECT $3 AT TIME ZONE branch.time_zone AS local_start,$4 AT TIME ZONE branch.time_zone AS local_end) local
            JOIN branch_operating_hours hours ON hours.tenant_id=branch.tenant_id AND hours.branch_id=branch.id
              AND hours.weekday=EXTRACT(DOW FROM local.local_start)::SMALLINT
            LEFT JOIN branch_holidays holiday ON holiday.tenant_id=branch.tenant_id AND holiday.branch_id=branch.id
              AND holiday.holiday_date=local.local_start::DATE
            WHERE branch.tenant_id::TEXT=$1 AND branch.id::TEXT=$2
              AND local.local_start::DATE=local.local_end::DATE
              AND CASE WHEN holiday.id IS NOT NULL
                THEN NOT holiday.closed AND local.local_start::TIME>=holiday.opens_at AND local.local_end::TIME<=holiday.closes_at
                ELSE NOT hours.closed AND local.local_start::TIME>=hours.opens_at AND local.local_end::TIME<=hours.closes_at END
          ) END"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(start_at)
    .bind(end_at)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate location operating hours"))?;
    if inside {
        return Ok(());
    }
    if !(3..=500).contains(&override_reason.trim().chars().count()) {
        return Err(ApiError::conflict(
            "booking is outside location operating hours; an override reason is required",
        ));
    }
    if !privileged_appointment_permission(claims, "appointments.outside_hours.override") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "outside-hours booking override permission is required",
        ));
    }
    Ok(())
}

async fn resolve_provider_preference(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    line: &mut AppointmentBatchLinePayload,
) -> Result<(), ApiError> {
    let preference = normalize_staff_preference(&line.staff_preference)?;
    if !matches!(
        preference,
        "first_available" | "gender_female" | "gender_male"
    ) {
        return Ok(());
    }
    let start_at = parse_datetime(&line.start_at, "start_at")?;
    let end_at = parse_datetime(&line.end_at, "end_at")?;
    let local = sqlx::query(
        "SELECT ($3 AT TIME ZONE branch.time_zone)::DATE local_date,($3 AT TIME ZONE branch.time_zone)::TIME local_start,($4 AT TIME ZONE branch.time_zone)::TIME local_end FROM branches branch WHERE branch.tenant_id::TEXT=$1 AND branch.id::TEXT=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(start_at)
    .bind(end_at)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to resolve location time zone"))?
    .ok_or_else(|| ApiError::not_found("location was not found"))?;
    let ranked = staff_enterprise_service::best_staff(
        &state.db,
        tenant_id,
        branch_id,
        staff_enterprise_service::BestStaffRequest {
            date: local
                .try_get("local_date")
                .map_err(|_| ApiError::internal("invalid location date"))?,
            start_time: local
                .try_get("local_start")
                .map_err(|_| ApiError::internal("invalid location time"))?,
            end_time: local
                .try_get("local_end")
                .map_err(|_| ApiError::internal("invalid location time"))?,
            service_ids: Some(vec![line.service_id.trim().to_string()]),
            client_id: client_id.to_string(),
            appointment_id: line.appointment_id.trim().to_string(),
        },
    )
    .await
    .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let candidate_ids = ranked
        .into_iter()
        .map(|candidate| candidate.staff_id)
        .collect::<Vec<_>>();
    let selected = if preference == "first_available" {
        candidate_ids.first().cloned()
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT staff.id::TEXT FROM UNNEST($3::TEXT[]) WITH ORDINALITY candidate(id,rank) JOIN staff ON staff.id::TEXT=candidate.id AND staff.tenant_id::TEXT=$1 AND staff.branch_id::TEXT=$2 WHERE staff.gender=$4 AND staff.active=TRUE ORDER BY candidate.rank LIMIT 1",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&candidate_ids)
        .bind(if preference == "gender_female" { "female" } else { "male" })
        .fetch_optional(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to resolve gender-preferred staff"))?
    };
    line.staff_id = selected
        .ok_or_else(|| ApiError::conflict("no matching provider is available for this time"))?;
    line.requested_staff_id.clear();
    Ok(())
}

fn booking_activity_reason(appointment: &AppointmentPayload) -> String {
    match appointment.staff_preference.as_str() {
        "preferred" => "booking saved · preferred staff requested".to_string(),
        "required" => "booking saved · required staff requested".to_string(),
        "first_available" => "booking saved · first available staff assigned".to_string(),
        "gender_female" => "booking saved · female provider preference applied".to_string(),
        "gender_male" => "booking saved · male provider preference applied".to_string(),
        _ => "booking saved".to_string(),
    }
}

fn validate_staff_reassignment(
    current: &AppointmentPayload,
    next_staff_id: &str,
    approval: &str,
    reason: &str,
) -> Result<(), ApiError> {
    if current.staff_id == next_staff_id
        || current.requested_staff_id.is_empty()
        || current.requested_staff_id == next_staff_id
        || current.staff_preference == "any"
    {
        return Ok(());
    }
    match (current.staff_preference.as_str(), approval.trim()) {
        ("required", "client-approved") => Ok(()),
        ("required", _) => Err(ApiError::conflict(
            "Client approval is required before changing required staff",
        )),
        ("preferred", "client-approved") => Ok(()),
        ("preferred", "manager-override") if !reason.trim().is_empty() => Ok(()),
        ("preferred", "manager-override") => Err(ApiError::bad_request(
            "A manager override reason is required for preferred staff",
        )),
        ("preferred", _) => Err(ApiError::conflict(
            "Choose client approval or manager override before changing preferred staff",
        )),
        _ => Ok(()),
    }
}

fn recommendation_override_allowed(claims: Option<&AuthClaims>) -> bool {
    claims.is_some_and(|claims| {
        auth_service::staff_app_permission_allowed(
            claims,
            "appointments.manage",
            &["owner", "admin", "manager"],
            &["write:appointments"],
        )
    })
}

fn recommendation_audit_reason(
    selected_staff_id: &str,
    recommended_staff_id: &str,
    override_reason: &str,
) -> Option<String> {
    if recommended_staff_id.is_empty() {
        None
    } else if selected_staff_id == recommended_staff_id {
        Some(format!(
            "Recommended staff selected: {recommended_staff_id}"
        ))
    } else {
        Some(format!(
            "Manager override from recommended staff {recommended_staff_id}: {}",
            override_reason.trim()
        ))
    }
}

fn booking_line_client_id<'a>(default_client_id: &'a str, line_client_id: &'a str) -> &'a str {
    if line_client_id.is_empty() {
        default_client_id
    } else {
        line_client_id
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PublicBookingClaims {
    pub(crate) tenant_id: String,
    pub(crate) branch_id: String,
    pub(crate) appointment_id: Option<String>,
    pub(crate) client_id: Option<String>,
    scope: String,
    token_type: String,
    iat: usize,
    exp: usize,
}

fn is_public_booking_source(value: &str) -> bool {
    matches!(
        value,
        "public-booking" | "booking-portal" | "booking-portal-v2"
    )
}

fn public_source_from(payload: &AppointmentCreatePayload) -> bool {
    payload
        .source_channel
        .as_deref()
        .is_some_and(is_public_booking_source)
        || payload
            .source
            .as_deref()
            .is_some_and(is_public_booking_source)
}

pub(crate) fn issue_public_booking_token(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: Option<&str>,
    client_id: Option<&str>,
    scope: &str,
    ttl_minutes: i64,
) -> Result<String, ApiError> {
    let now = Utc::now();
    let claims = PublicBookingClaims {
        tenant_id: tenant_id.to_string(),
        branch_id: branch_id.to_string(),
        appointment_id: appointment_id.map(ToString::to_string),
        client_id: client_id.map(ToString::to_string),
        scope: scope.to_string(),
        token_type: PUBLIC_BOOKING_TOKEN_TYPE.to_string(),
        iat: now.timestamp() as usize,
        exp: (now + Duration::minutes(ttl_minutes)).timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.settings.jwt_access_secret.as_bytes()),
    )
    .map_err(|_| ApiError::internal("failed to issue public booking token"))
}

pub(crate) fn require_public_booking_claims(
    state: &AppState,
    headers: &HeaderMap,
    required_scope: &str,
) -> Result<PublicBookingClaims, ApiError> {
    let token = headers
        .get("x-public-booking-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("public booking token is required"))?;

    let claims = decode::<PublicBookingClaims>(
        token,
        &DecodingKey::from_secret(state.settings.jwt_access_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::unauthorized("invalid or expired public booking token"))?
    .claims;

    if claims.token_type != PUBLIC_BOOKING_TOKEN_TYPE || claims.scope != required_scope {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "public booking token scope is not allowed",
        ));
    }
    if claims.tenant_id.trim().is_empty() || claims.branch_id.trim().is_empty() {
        return Err(ApiError::unauthorized("invalid public booking token scope"));
    }

    Ok(claims)
}

async fn validate_public_booking_ownership(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    payload: &AppointmentCreatePayload,
) -> Result<(), ApiError> {
    if !public_source_from(payload) {
        return Ok(());
    }

    if branch_id.trim().is_empty() {
        return Err(ApiError::bad_request("branch_id is required"));
    }
    if payload.service_ids.is_empty() {
        return Err(ApiError::bad_request("serviceId or serviceIds required"));
    }

    for service_id in payload
        .service_ids
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active = true)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(service_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to validate service ownership"))?;
        if !exists {
            return Err(ApiError::not_found(
                "Service not found for this tenant and branch",
            ));
        }
    }

    if !payload.staff_id.trim().is_empty() {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active = true)",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(payload.staff_id.trim())
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to validate staff ownership"))?;
        if !exists {
            return Err(ApiError::not_found(
                "Staff member not found for this tenant and branch",
            ));
        }
    }

    Ok(())
}

pub(crate) async fn require_public_booking_mutation_owner(
    state: &AppState,
    headers: &HeaderMap,
    appointment_id: &str,
    requested_branch_id: Option<&str>,
) -> Result<(), ApiError> {
    let claims = require_public_booking_claims(state, headers, "action")?;
    if claims.appointment_id.as_deref() != Some(appointment_id) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "public booking token does not own this appointment",
        ));
    }
    let tenant_id = claims.tenant_id;
    let branch_id = claims.branch_id;
    let appointment = find_appointment(state, &tenant_id, &branch_id, appointment_id).await?;
    if let Some(branch_id) = requested_branch_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if appointment.branch_id != branch_id {
            return Err(ApiError::not_found("Appointment not found"));
        }
    }
    if !is_public_booking_source(&appointment.source_channel)
        && !is_public_booking_source(&appointment.source)
    {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "appointment is not owned by public booking",
        ));
    }
    Ok(())
}

pub(crate) async fn find_appointment(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<AppointmentPayload, ApiError> {
    let row = sqlx::query(
        "SELECT id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at,
                booking_type,day_package_id,host_client_id,group_name,group_notes,is_surprise,virtual_meeting_url,service_mode,segment_label,sequence_no,
                execution_status,service_started_at,service_paused_at,paused_seconds,service_completed_at
         FROM appointments
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3
         LIMIT 1",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("database query failed"))?
    .ok_or_else(|| ApiError::not_found("Appointment not found"))?;
    build_appointment(&row)
}

fn activity_action_group(action: &str) -> &'static str {
    let action = action.to_ascii_uppercase();
    if action.contains("BILL") {
        "billing"
    } else if action.contains("CANCEL") || action.contains("NO_SHOW") {
        "cancellation"
    } else if action.contains("ARRIVED") || action.contains("START") || action.contains("COMPLETE")
    {
        "service"
    } else if action.contains("BOOK") || action.contains("PROMOT") {
        "booking"
    } else {
        "change"
    }
}

fn activity_action_for_status(status: &str) -> &'static str {
    match status {
        "confirmed" => "CONFIRMED",
        "arrived" => "ARRIVED",
        "in-service" => "STARTED",
        "completed" => "COMPLETED",
        "cancelled" => "CANCELLED",
        "no-show" => "NO_SHOW",
        "billed" | "paid" => "BILLED",
        _ => "STATUS_CHANGED",
    }
}

fn activity_snapshot(appointment: &AppointmentPayload) -> serde_json::Value {
    serde_json::json!({
        "id": appointment.id.clone(),
        "clientId": appointment.client_id.clone(),
        "staffId": appointment.staff_id.clone(),
        "requestedStaffId": appointment.requested_staff_id.clone(),
        "staffPreference": appointment.staff_preference.clone(),
        "branchId": appointment.branch_id.clone(),
        "serviceIds": appointment.service_ids.clone(),
        "startAt": appointment.start_at.clone(),
        "endAt": appointment.end_at.clone(),
        "status": appointment.status.clone(),
        "notes": appointment.notes.clone(),
        "sourceChannel": appointment.source_channel.clone(),
        "source": appointment.source.clone(),
        "chairRoomId": appointment.chair_room_id.clone(),
    })
}

fn activity_changes(
    old: Option<&AppointmentPayload>,
    new: &AppointmentPayload,
) -> serde_json::Value {
    let Some(old) = old else {
        return serde_json::json!([]);
    };
    let pairs = [
        ("Status", old.status.clone(), new.status.clone()),
        ("Start time", old.start_at.clone(), new.start_at.clone()),
        ("End time", old.end_at.clone(), new.end_at.clone()),
        ("Staff", old.staff_id.clone(), new.staff_id.clone()),
        (
            "Requested staff",
            old.requested_staff_id.clone(),
            new.requested_staff_id.clone(),
        ),
        (
            "Staff preference",
            old.staff_preference.clone(),
            new.staff_preference.clone(),
        ),
        ("Branch", old.branch_id.clone(), new.branch_id.clone()),
        ("Client", old.client_id.clone(), new.client_id.clone()),
        (
            "Services",
            old.service_ids.join(", "),
            new.service_ids.join(", "),
        ),
        ("Notes", old.notes.clone(), new.notes.clone()),
        (
            "Chair / room",
            old.chair_room_id.clone(),
            new.chair_room_id.clone(),
        ),
    ];
    serde_json::Value::Array(
        pairs
            .into_iter()
            .filter_map(|(field, old_value, new_value)| {
                (old_value != new_value).then(|| {
                    serde_json::json!({
                        "field": field,
                        "oldValue": old_value,
                        "newValue": new_value,
                    })
                })
            })
            .collect(),
    )
}

pub(crate) async fn insert_activity(
    state: &AppState,
    tenant_id: &str,
    old: Option<&AppointmentPayload>,
    new: &AppointmentPayload,
    action: &str,
    reason: &str,
) -> Result<(), ApiError> {
    let id = uuid::Uuid::new_v4().to_string();
    let action_group = activity_action_group(action);
    let (risk_level, risk_score, suggested_action) = match action_group {
        "cancellation" => (
            "high",
            70,
            "Review client follow-up before the next booking",
        ),
        "change" if action.to_ascii_uppercase().contains("RESCHEDULE") => {
            ("medium", 35, "Confirm the revised appointment details")
        }
        _ => ("low", 0, ""),
    };
    let risk_reasons = if risk_score == 0 {
        serde_json::json!(["Routine appointment activity."])
    } else {
        serde_json::json!([format!("{} activity requires review.", action_group)])
    };
    sqlx::query(
        "INSERT INTO appointment_activity (
            id, tenant_id, branch_id, appointment_id, client_id, staff_id, action, action_group,
            old_status, new_status, changed_by, changed_by_role, source, reason,
            old_data, new_data, changes, risk_level, risk_score, risk_reasons, suggested_action, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'system','system',$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb,$19,$20)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(&new.branch_id)
    .bind(&new.id)
    .bind(&new.client_id)
    .bind(&new.staff_id)
    .bind(action)
    .bind(action_group)
    .bind(old.map(|item| item.status.as_str()).unwrap_or_default())
    .bind(&new.status)
    .bind(if new.source_channel.is_empty() { &new.source } else { &new.source_channel })
    .bind(reason)
    .bind(activity_snapshot(old.unwrap_or(new)).to_string())
    .bind(activity_snapshot(new).to_string())
    .bind(activity_changes(old, new).to_string())
    .bind(risk_level)
    .bind(risk_score)
    .bind(risk_reasons.to_string())
    .bind(suggested_action)
    .bind(Utc::now())
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to record appointment activity"))?;
    let _ = state.appointment_events.send(AppointmentEvent {
        tenant_id: tenant_id.to_string(),
        branch_id: new.branch_id.clone(),
        client_id: new.client_id.clone(),
        entity_type: "appointment".to_string(),
        entity_id: new.id.clone(),
        action: action.to_string(),
    });
    if let Err(error) = benefit_notification_service::queue_appointment_event(
        state,
        tenant_id,
        &new.branch_id,
        &new.id,
        &new.client_id,
        new.version,
        action,
    )
    .await
    {
        tracing::warn!(appointment_id=%new.id, action, error=?error, "appointment notification queue failed");
    }
    Ok(())
}

async fn list_appointment_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AppointmentResourceResponse>>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let rows = sqlx::query("SELECT id, name, kind, department, capacity, active FROM appointment_resources WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY department, kind, name")
        .bind(&tenant_id)
        .bind(&branch_id)
        .fetch_all(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to list chair and room resources"))?;
    Ok(Json(
        rows.into_iter()
            .map(|row| AppointmentResourceResponse {
                id: row.try_get("id").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
                kind: row.try_get("kind").unwrap_or_else(|_| "chair".to_string()),
                department: row.try_get("department").unwrap_or_default(),
                capacity: row.try_get("capacity").unwrap_or(1),
                active: row.try_get("active").unwrap_or(true),
            })
            .collect(),
    ))
}

async fn create_appointment_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AppointmentResourcePayload>,
) -> Result<Json<AppointmentResourceResponse>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("chair or room name is required"));
    }
    let kind = payload.kind.trim().to_ascii_lowercase();
    if !matches!(
        kind.as_str(),
        "chair" | "workstation" | "room" | "bed" | "machine" | "equipment"
    ) {
        return Err(ApiError::bad_request("resource kind is invalid"));
    }
    if !(1..=100).contains(&payload.capacity) {
        return Err(ApiError::bad_request("resource capacity must be 1-100"));
    }
    let department = payload.department.trim();
    if department.len() > 80 {
        return Err(ApiError::bad_request("resource department is too long"));
    }
    let department = if department.is_empty() {
        "Unassigned"
    } else {
        department
    };
    let row = sqlx::query("INSERT INTO appointment_resources (id, tenant_id, branch_id, name, kind, department, capacity) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, kind, department, capacity, active")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(name)
        .bind(&kind)
        .bind(department)
        .bind(payload.capacity)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::conflict("chair or room already exists"))?;
    Ok(Json(AppointmentResourceResponse {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        kind: row.try_get("kind").unwrap_or_default(),
        department: row.try_get("department").unwrap_or_default(),
        capacity: row.try_get("capacity").unwrap_or(1),
        active: row.try_get("active").unwrap_or(true),
    }))
}

async fn get_appointment_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query(
        "SELECT allow_overlap, settings_json FROM appointment_branch_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment settings"))?;
    let (allow_overlap, settings) = row
        .map(|row| {
            (
                row.try_get::<bool, _>("allow_overlap").unwrap_or(false),
                row.try_get::<Value, _>("settings_json")
                    .unwrap_or_else(|_| json!({})),
            )
        })
        .unwrap_or((false, json!({})));
    Ok(Json(
        json!({"allowOverlap": allow_overlap, "settings": settings}),
    ))
}

async fn save_appointment_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AppointmentSettingsPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let settings = appointment_settings_json(payload.settings);
    sqlx::query(
        "INSERT INTO appointment_branch_settings (tenant_id, branch_id, allow_overlap, settings_json) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, branch_id) DO UPDATE SET
           allow_overlap=EXCLUDED.allow_overlap,
           settings_json=EXCLUDED.settings_json || CASE
             WHEN appointment_branch_settings.settings_json ? 'bookingSettings'
             THEN jsonb_build_object('bookingSettings',appointment_branch_settings.settings_json->'bookingSettings')
             ELSE '{}'::jsonb
           END,
           updated_at=NOW()",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(payload.allow_overlap)
    .bind(&settings)
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to save appointment settings"))?;
    Ok(Json(
        json!({"allowOverlap": payload.allow_overlap, "settings": settings}),
    ))
}

pub(crate) async fn reschedule_rules(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<RescheduleRules, ApiError> {
    let settings = sqlx::query_scalar::<_, Value>(
        "SELECT settings_json FROM appointment_branch_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment settings"))?
    .unwrap_or_else(|| json!({}));
    let bool_value = |key: &str, default: bool| {
        settings
            .get(key)
            .and_then(Value::as_bool)
            .unwrap_or(default)
    };
    let number_value = |key: &str, default: i64, min: i64, max: i64| {
        settings
            .get(key)
            .and_then(Value::as_i64)
            .unwrap_or(default)
            .clamp(min, max)
    };
    Ok(RescheduleRules {
        client_self_reschedule: bool_value("clientSelfReschedule", true),
        approval_required: bool_value("rescheduleApprovalRequired", false),
        cutoff_hours: number_value("rescheduleCutoffHours", 2, 0, 168),
        max_reschedule_count: number_value("maxRescheduleCount", 2, 1, 20),
        sms_app_notification: bool_value("rescheduleSmsAppNotification", true),
        per_service_sms: bool_value("perServiceRescheduleSms", true),
    })
}

pub(crate) async fn create_client_reschedule_request(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    appointment_id: &str,
    client_id: &str,
    start_at: &str,
    end_at: Option<&str>,
    staff_id: &str,
    reason: &str,
) -> Result<bool, ApiError> {
    let rules = reschedule_rules(state, tenant_id, branch_id).await?;
    if !rules.client_self_reschedule {
        return Err(ApiError::conflict("Client self-rescheduling is disabled"));
    }
    let current = find_appointment(state, tenant_id, branch_id, appointment_id).await?;
    let requested_start = parse_datetime(start_at, "start_at")?;
    if current.client_id != client_id {
        return Err(ApiError::not_found("customer booking was not found"));
    }
    let current_start = parse_datetime(&current.start_at, "current.start_at")?;
    if current_start <= Utc::now() + Duration::hours(rules.cutoff_hours) {
        return Err(ApiError::conflict(
            "This appointment is past the reschedule cutoff",
        ));
    }
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointment_activity WHERE tenant_id=$1 AND appointment_id=$2 AND action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED')")
        .bind(tenant_id).bind(appointment_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::internal("failed to validate reschedule count"))?;
    if count >= rules.max_reschedule_count {
        return Err(ApiError::conflict("Maximum reschedule count reached"));
    }
    if !rules.approval_required {
        return Ok(false);
    }
    let request_id = uuid::Uuid::new_v4().to_string();
    let requested_end = end_at
        .filter(|value| !value.trim().is_empty())
        .map(|value| parse_datetime(value, "end_at"))
        .transpose()?;
    sqlx::query("INSERT INTO appointment_reschedule_requests (id,tenant_id,branch_id,appointment_id,client_id,requested_start_at,requested_end_at,requested_staff_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(&request_id).bind(tenant_id).bind(branch_id).bind(appointment_id).bind(client_id).bind(requested_start).bind(requested_end).bind(staff_id).bind(reason)
        .execute(&state.db).await.map_err(|_| ApiError::internal("failed to create reschedule request"))?;
    sqlx::query("INSERT INTO notifications (id,tenant_id,branch_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json) VALUES ($1,$2,$3,'customer-app','appointment_reschedule_request','Reschedule approval needed',$4,'appointment_reschedule_request',$1,$5::jsonb)")
        .bind(&request_id).bind(tenant_id).bind(branch_id)
        .bind("Client requested a new appointment time")
        .bind(json!({"appointmentId":appointment_id,"clientId":client_id}).to_string())
        .execute(&state.db).await.map_err(|_| ApiError::internal("failed to notify CRM about reschedule request"))?;
    insert_activity(
        state,
        tenant_id,
        Some(&current),
        &current,
        "CLIENT_RESCHEDULE_REQUESTED",
        reason,
    )
    .await?;
    Ok(true)
}

async fn list_reschedule_requests(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let rows = sqlx::query("SELECT id,appointment_id,client_id,requested_start_at,requested_end_at,requested_staff_id,reason,status,created_at FROM appointment_reschedule_requests WHERE tenant_id=$1 AND branch_id=$2 AND status='pending' ORDER BY created_at DESC")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_| ApiError::internal("failed to load reschedule requests"))?;
    let data = rows.into_iter().map(|row| json!({
        "id":row.try_get::<String,_>("id").unwrap_or_default(), "appointmentId":row.try_get::<String,_>("appointment_id").unwrap_or_default(),
        "clientId":row.try_get::<String,_>("client_id").unwrap_or_default(), "requestedStartAt":row.try_get::<DateTime<Utc>,_>("requested_start_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "requestedEndAt":row.try_get::<Option<DateTime<Utc>>,_>("requested_end_at").ok().flatten().map(|value| value.to_rfc3339()), "requestedStaffId":row.try_get::<String,_>("requested_staff_id").unwrap_or_default(),
        "reason":row.try_get::<String,_>("reason").unwrap_or_default(), "status":row.try_get::<String,_>("status").unwrap_or_default()
    })).collect::<Vec<_>>();
    Ok(Json(json!({"data":data})))
}

async fn approve_reschedule_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<RescheduleDecisionPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query("SELECT appointment_id,requested_start_at,requested_end_at,requested_staff_id,reason FROM appointment_reschedule_requests WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'")
        .bind(&request_id).bind(&tenant_id).bind(&branch_id).fetch_optional(&state.db).await
        .map_err(|_| ApiError::internal("failed to load reschedule request"))?.ok_or_else(|| ApiError::not_found("pending reschedule request not found"))?;
    let appointment_id: String = row.try_get("appointment_id").unwrap_or_default();
    let start_at: DateTime<Utc> = row
        .try_get("requested_start_at")
        .map_err(|_| ApiError::internal("invalid reschedule request"))?;
    let end_at: Option<DateTime<Utc>> = row.try_get("requested_end_at").unwrap_or(None);
    let staff_id: String = row.try_get("requested_staff_id").unwrap_or_default();
    let reason: String = row.try_get("reason").unwrap_or_default();
    let appointment = reschedule_appointment(
        State(state.clone()),
        None,
        headers,
        Path(appointment_id),
        Json(ReschedulePayload {
            expected_version: None,
            start_at: start_at.to_rfc3339(),
            end_at: end_at.map(|value| value.to_rfc3339()),
            reason,
            staff_id,
            staff_change_approval: "client-approved".to_string(),
            staff_change_reason: payload.reason,
            service_ids: Vec::new(),
            branch_id: String::new(),
            chair_room_id: String::new(),
            booking_group_id: String::new(),
            change_mode: "official".to_string(),
            actor_source: "approval".to_string(),
            outside_hours_override_reason: String::new(),
        }),
    )
    .await?;
    sqlx::query("UPDATE appointment_reschedule_requests SET status='approved',decided_by='crm',decided_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&request_id).bind(&tenant_id).bind(&branch_id).execute(&state.db).await.map_err(|_| ApiError::internal("failed to approve reschedule request"))?;
    Ok(Json(json!({"data":appointment.0})))
}

async fn reject_reschedule_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(payload): Json<RescheduleDecisionPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query("SELECT appointment_id FROM appointment_reschedule_requests WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'")
        .bind(&request_id).bind(&tenant_id).bind(&branch_id).fetch_optional(&state.db).await
        .map_err(|_| ApiError::internal("failed to load reschedule request"))?.ok_or_else(|| ApiError::not_found("pending reschedule request not found"))?;
    let appointment_id: String = row.try_get("appointment_id").unwrap_or_default();
    let current = find_appointment(&state, &tenant_id, &branch_id, &appointment_id).await?;
    sqlx::query("UPDATE appointment_reschedule_requests SET status='rejected',decided_by='crm',decision_reason=$4,decided_at=NOW(),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&request_id).bind(&tenant_id).bind(&branch_id).bind(&payload.reason).execute(&state.db).await.map_err(|_| ApiError::internal("failed to reject reschedule request"))?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &current,
        "RESCHEDULE_REJECTED",
        &payload.reason,
    )
    .await?;
    Ok(Json(json!({"success":true})))
}

async fn validate_chair_room_availability(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    chair_room_id: &str,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    exclude_appointment_id: Option<&str>,
) -> Result<(), ApiError> {
    if chair_room_id.trim().is_empty() {
        return Ok(());
    }
    let capacity = sqlx::query_scalar::<_, i32>("SELECT capacity FROM appointment_resources WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND active=TRUE")
        .bind(chair_room_id).bind(tenant_id).bind(branch_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::bad_request("selected appointment resource is unavailable"))?;
    let allow_overlap = sqlx::query_scalar::<_, bool>(
        "SELECT allow_overlap FROM appointment_branch_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment overlap setting"))?
    .unwrap_or(false);
    if allow_overlap {
        return Ok(());
    }
    let overlaps = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND chair_room_id=$3 AND status NOT IN ('cancelled','no-show') AND start_at < $5 AND end_at > $4 AND ($6='' OR id<>$6)")
        .bind(tenant_id).bind(branch_id).bind(chair_room_id).bind(start_at).bind(end_at).bind(exclude_appointment_id.unwrap_or_default())
        .fetch_one(&state.db).await.map_err(|_| ApiError::internal("failed to check chair or room availability"))?;
    if overlaps >= i64::from(capacity) {
        return Err(ApiError::conflict(
            "appointment resource capacity is full for this time",
        ));
    }
    Ok(())
}

async fn validate_service_resource_requirement(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
    resource_id: &str,
) -> Result<(), ApiError> {
    let valid=sqlx::query_scalar::<_,bool>(
        "SELECT NOT EXISTS(
           SELECT 1 FROM UNNEST($3::TEXT[]) selected(service_id)
           WHERE EXISTS(SELECT 1 FROM service_resource_requirements requirement WHERE requirement.tenant_id=$1 AND requirement.branch_id=$2 AND requirement.service_id=selected.service_id AND requirement.required=TRUE)
             AND NOT EXISTS(SELECT 1 FROM service_resource_requirements requirement WHERE requirement.tenant_id=$1 AND requirement.branch_id=$2 AND requirement.service_id=selected.service_id AND requirement.required=TRUE AND requirement.resource_id=NULLIF($4,''))
         )"
    ).bind(tenant_id).bind(branch_id).bind(service_ids).bind(resource_id).fetch_one(&state.db).await
      .map_err(|_|ApiError::internal("failed to validate service resource requirement"))?;
    if !valid {
        return Err(ApiError::bad_request(
            "selected resource is not eligible for this service",
        ));
    }
    Ok(())
}

pub(crate) async fn validate_staff_blackout(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> Result<(), ApiError> {
    if staff_id.trim().is_empty() {
        return Ok(());
    }
    let blocked = sqlx::query_scalar::<_, bool>(
        "WITH slot AS (
            SELECT ($4 AT TIME ZONE 'Asia/Kolkata')::date AS business_date
         )
         SELECT EXISTS(SELECT 1 FROM appointment_blackouts b, slot
         WHERE b.tenant_id=$1 AND b.branch_id=$2 AND (b.staff_id='' OR b.staff_id=$3)
           AND (
             (b.blocked_from IS NOT NULL AND b.blocked_until IS NOT NULL
              AND b.blocked_from < $5 AND b.blocked_until > $4)
             OR (b.blocked_from IS NULL AND b.blocked_until IS NULL
                 AND b.blackout_date = slot.business_date::text)
           ))",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(start_at)
    .bind(end_at)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate blocked time"))?;
    if blocked {
        return Err(ApiError::conflict(
            "staff is unavailable for this blocked time",
        ));
    }
    Ok(())
}

fn staff_booking_rule_message(code: &str) -> &'static str {
    match code {
        "STAFF_UNAVAILABLE" => "selected staff is not active in this branch",
        "SERVICE_UNAVAILABLE" => "selected service is unavailable in this branch",
        "STAFF_SERVICE" => "selected staff is not assigned to this service",
        "WEEKLY_OFF" | "SCHEDULE_WEEKLY_OFF" => "staff is on weekly off for this date",
        "APPROVED_LEAVE" | "SCHEDULE_LEAVE" => "staff is on approved leave for this date",
        "BOOKING_INTERVAL" => "appointment start time does not match staff booking interval",
        "SCHEDULE_OTHER_CENTER" | "OTHER_CENTER_WORKING" => {
            "staff is working at another center for this time"
        }
        "OUTSIDE_SHIFT" => "appointment time is outside the saved staff shift",
        _ => "staff is unavailable for this appointment",
    }
}

async fn validate_staff_booking_rules(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    service_ids: &[String],
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> Result<(), ApiError> {
    let service_ids = service_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    let rule_code = sqlx::query_scalar::<_, Option<String>>(
        "WITH requested AS (
            SELECT UNNEST($6::TEXT[]) AS service_id
         ),
         slot AS (
            SELECT
              ($4::timestamptz AT TIME ZONE 'Asia/Kolkata')::date AS business_date,
              ($4::timestamptz AT TIME ZONE 'Asia/Kolkata')::time AS start_time,
              ($5::timestamptz AT TIME ZONE 'Asia/Kolkata')::time AS end_time,
              EXTRACT(DOW FROM ($4::timestamptz AT TIME ZONE 'Asia/Kolkata'))::smallint AS dow,
              (EXTRACT(HOUR FROM ($4::timestamptz AT TIME ZONE 'Asia/Kolkata'))::int * 60
                + EXTRACT(MINUTE FROM ($4::timestamptz AT TIME ZONE 'Asia/Kolkata'))::int) AS start_minute
         ),
         target AS (
            SELECT s.id, s.user_id, p.booking_interval_minutes, p.shift_template_id
            FROM staff s
            LEFT JOIN staff_profiles p
              ON p.staff_id=s.id AND p.tenant_id=s.tenant_id AND p.branch_id=s.branch_id
            WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.active=TRUE
         )
         SELECT CASE
           WHEN NOT EXISTS(SELECT 1 FROM target)
             THEN 'STAFF_UNAVAILABLE'
           WHEN EXISTS(
             SELECT 1 FROM requested r
             WHERE NOT EXISTS(
               SELECT 1 FROM services svc
               WHERE svc.tenant_id=$1 AND svc.branch_id=$2 AND svc.id=r.service_id AND svc.active=TRUE
             )
           )
             THEN 'SERVICE_UNAVAILABLE'
           WHEN EXISTS(
             SELECT 1 FROM requested r
             WHERE NOT EXISTS(
               SELECT 1 FROM staff_service_assignments ssa
               WHERE ssa.tenant_id=$1 AND ssa.branch_id=$2 AND ssa.staff_id=$3 AND ssa.service_id=r.service_id
             )
             AND NOT EXISTS(
               SELECT 1 FROM staff_catalog_assignments sca
               WHERE sca.tenant_id=$1 AND sca.branch_id=$2 AND sca.staff_id=$3
                 AND sca.item_type='service' AND sca.item_id=r.service_id
             )
           )
             THEN 'STAFF_SERVICE'
           WHEN EXISTS(
             SELECT 1 FROM target t
             JOIN staff_shift_templates st
               ON st.id=t.shift_template_id AND st.tenant_id=$1 AND st.branch_id=$2 AND st.active=TRUE
             CROSS JOIN slot
             WHERE slot.dow = ANY(st.weekly_off_days)
           )
             THEN 'WEEKLY_OFF'
           WHEN EXISTS(
             SELECT 1 FROM staff_leave_requests lr
             JOIN staff_leave_request_days leave_day ON leave_day.request_id=lr.id
             CROSS JOIN slot
             WHERE lr.tenant_id=$1 AND lr.branch_id=$2 AND lr.staff_id=$3
               AND lr.status='approved'
               AND leave_day.leave_date=slot.business_date
               AND (leave_day.start_time IS NULL OR (leave_day.start_time<slot.end_time AND leave_day.end_time>slot.start_time))
           )
             THEN 'APPROVED_LEAVE'
           WHEN EXISTS(
             SELECT 1 FROM target t, slot
             WHERE COALESCE(t.booking_interval_minutes, 0) > 0
               AND MOD(slot.start_minute, t.booking_interval_minutes) <> 0
           )
             THEN 'BOOKING_INTERVAL'
           WHEN EXISTS(
             SELECT 1 FROM staff_schedules ss, slot
             WHERE ss.tenant_id=$1 AND ss.branch_id=$2 AND ss.staff_id=$3
               AND ss.schedule_date=slot.business_date AND ss.status='working_other_center'
           )
             THEN 'SCHEDULE_OTHER_CENTER'
           WHEN EXISTS(
             SELECT 1 FROM staff_schedules ss, slot
             WHERE ss.tenant_id=$1 AND ss.branch_id=$2 AND ss.staff_id=$3
               AND ss.schedule_date=slot.business_date AND ss.status='weekly_off'
           )
             THEN 'SCHEDULE_WEEKLY_OFF'
           WHEN EXISTS(
             SELECT 1 FROM staff_schedules ss, slot
             WHERE ss.tenant_id=$1 AND ss.branch_id=$2 AND ss.staff_id=$3
               AND ss.schedule_date=slot.business_date
               AND ss.status IN ('annual_leave','jury_duty','leave','sick_leave','special_leave')
           )
             THEN 'SCHEDULE_LEAVE'
           WHEN EXISTS(
             SELECT 1 FROM staff_schedules ss, slot
             WHERE ss.tenant_id=$1 AND ss.branch_id=$2 AND ss.staff_id=$3
               AND ss.schedule_date=slot.business_date
           )
           AND NOT EXISTS(
             SELECT 1 FROM staff_schedules ss, slot
             WHERE ss.tenant_id=$1 AND ss.branch_id=$2 AND ss.staff_id=$3
               AND ss.schedule_date=slot.business_date AND ss.status='working'
               AND (
                 (ss.shift1_start IS NOT NULL AND ss.shift1_end IS NOT NULL
                   AND ss.shift1_start <= slot.start_time AND ss.shift1_end >= slot.end_time)
                 OR
                 (ss.shift2_start IS NOT NULL AND ss.shift2_end IS NOT NULL
                   AND ss.shift2_start <= slot.start_time AND ss.shift2_end >= slot.end_time)
               )
           )
             THEN 'OUTSIDE_SHIFT'
           WHEN EXISTS(
             SELECT 1
             FROM target t
             JOIN staff other_staff
               ON other_staff.tenant_id=$1
              AND other_staff.user_id IS NOT NULL
              AND other_staff.user_id=t.user_id
              AND other_staff.branch_id<>$2
             JOIN staff_schedules other_schedule
               ON other_schedule.tenant_id=$1
              AND other_schedule.branch_id=other_staff.branch_id
              AND other_schedule.staff_id=other_staff.id
             CROSS JOIN slot
             WHERE t.user_id IS NOT NULL
               AND other_schedule.schedule_date=slot.business_date
               AND other_schedule.status='working'
               AND (
                 (other_schedule.shift1_start IS NOT NULL AND other_schedule.shift1_end IS NOT NULL
                   AND other_schedule.shift1_start < slot.end_time AND other_schedule.shift1_end > slot.start_time)
                 OR
                 (other_schedule.shift2_start IS NOT NULL AND other_schedule.shift2_end IS NOT NULL
                   AND other_schedule.shift2_start < slot.end_time AND other_schedule.shift2_end > slot.start_time)
               )
           )
             THEN 'OTHER_CENTER_WORKING'
           ELSE NULL
         END",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(start_at)
    .bind(end_at)
    .bind(&service_ids)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate staff booking rules"))?;
    if let Some(code) = rule_code {
        return Err(ApiError::conflict(staff_booking_rule_message(&code)));
    }
    Ok(())
}

async fn booking_staff_busy_windows(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    service_ids: &[String],
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
) -> Result<Vec<(DateTime<Utc>, DateTime<Utc>)>, ApiError> {
    if service_ids.len() != 1 {
        return Ok(vec![(start_at, end_at)]);
    }

    let timing = sqlx::query(
        "SELECT duration_minutes, processing_time_minutes, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes
         FROM services WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(&service_ids[0])
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load service timing"))?;

    let Some(timing) = timing else {
        return Ok(vec![(start_at, end_at)]);
    };
    let duration = i64::from(timing.try_get::<i32, _>("duration_minutes").unwrap_or(0));
    let processing = i64::from(
        timing
            .try_get::<i32, _>("processing_time_minutes")
            .unwrap_or(0)
            .max(timing.try_get::<i32, _>("wait_time_minutes").unwrap_or(0)),
    );
    let cleanup = i64::from(
        timing
            .try_get::<i32, _>("cleanup_time_minutes")
            .unwrap_or(0),
    ) + i64::from(timing.try_get::<i32, _>("buffer_time_minutes").unwrap_or(0));

    if duration <= 0 || processing <= 0 {
        return Ok(vec![(start_at, end_at)]);
    }

    let active_end = (start_at + Duration::minutes(duration)).min(end_at);
    let cleanup_start = (end_at - Duration::minutes(cleanup.max(0))).max(start_at);
    if active_end >= cleanup_start {
        return Ok(vec![(start_at, end_at)]);
    }

    let mut windows = vec![(start_at, active_end)];
    if cleanup_start < end_at {
        windows.push((cleanup_start, end_at));
    }
    Ok(windows)
}

pub(crate) async fn validate_staff_booking_availability(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    service_ids: &[String],
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    exclude_appointment_id: Option<&str>,
) -> Result<(), ApiError> {
    if staff_id.trim().is_empty() {
        return Ok(());
    }

    validate_staff_booking_rules(
        state,
        tenant_id,
        branch_id,
        staff_id,
        service_ids,
        start_at,
        end_at,
    )
    .await?;

    let allow_overlap = sqlx::query_scalar::<_, bool>(
        "SELECT allow_overlap FROM appointment_branch_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment overlap setting"))?
    .unwrap_or(false);
    if allow_overlap {
        return Ok(());
    }

    let requested_windows =
        booking_staff_busy_windows(state, tenant_id, branch_id, service_ids, start_at, end_at)
            .await?;
    let rows = sqlx::query(
        "SELECT service_ids_json, start_at, end_at
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
           AND status NOT IN ('cancelled','no-show')
           AND start_at < $5 AND end_at > $4
           AND ($6='' OR id<>$6)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(start_at)
    .bind(end_at)
    .bind(exclude_appointment_id.unwrap_or_default())
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to check staff availability"))?;

    for row in rows {
        let service_ids_raw: String = row.try_get("service_ids_json").unwrap_or_default();
        let existing_start: DateTime<Utc> = row
            .try_get("start_at")
            .map_err(|_| ApiError::internal("invalid appointment time"))?;
        let existing_end: DateTime<Utc> = row
            .try_get("end_at")
            .map_err(|_| ApiError::internal("invalid appointment time"))?;
        let existing_windows = booking_staff_busy_windows(
            state,
            tenant_id,
            branch_id,
            &parse_service_ids(&service_ids_raw),
            existing_start,
            existing_end,
        )
        .await?;

        if requested_windows
            .iter()
            .any(|(requested_start, requested_end)| {
                existing_windows
                    .iter()
                    .any(|(existing_start, existing_end)| {
                        requested_start < existing_end && requested_end > existing_start
                    })
            })
        {
            return Err(ApiError::conflict(
                "staff is already booked for the active service time",
            ));
        }
    }
    Ok(())
}

fn normalize_status(raw: &str) -> Result<String, ApiError> {
    let normalized = raw.trim().to_lowercase();
    if allowed_status().contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(ApiError::bad_request("Unsupported appointment status"))
    }
}

fn build_ics_feed(
    scope_id: &str,
    scope_type: &str,
    appointments: Vec<AppointmentPayload>,
) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        format!(
            "PRODID:-//AuraShine//{}/{}//EN",
            scope_type.to_uppercase(),
            scope_id
        ),
        "CALSCALE:GREGORIAN".to_string(),
    ];

    for a in appointments {
        let dt_stamp = now_text().replace('-', "").replace(':', "");
        let dt_start = a.start_at.replace('-', "").replace(':', "");
        let dt_end = a.end_at.replace('-', "").replace(':', "");
        lines.push("BEGIN:VEVENT".to_string());
        lines.push(format!("UID:{}@aura-shine.app", a.id));
        lines.push(format!("DTSTAMP:{}", dt_stamp));
        lines.push(format!("DTSTART:{}", dt_start));
        lines.push(format!("DTEND:{}", dt_end));
        lines.push(format!(
            "SUMMARY:Appointment {} - {}",
            a.status.to_uppercase(),
            a.client_id
        ));
        lines.push(format!(
            "DESCRIPTION:tenant={}, branch={}",
            a.tenant_id, a.branch_id
        ));
        lines.push("END:VEVENT".to_string());
    }

    lines.push("END:VCALENDAR".to_string());
    lines.join("\r\n")
}

async fn smart_booking_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(scope_query): Query<ScopeQuery>,
) -> Result<Json<BookingSummary>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        scope_query.tenant_id.as_deref(),
        scope_query.branch_id.as_deref(),
    );

    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let today = Utc::now().date_naive();
    let today_utc_start = today.and_hms_opt(0, 0, 0).unwrap().and_utc();
    let today_utc_end = today.and_hms_opt(23, 59, 59).unwrap().and_utc();
    let today_booked = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status = 'booked' AND start_at BETWEEN $3 AND $4",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(today_utc_start)
    .bind(today_utc_end)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let queue_depth = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointment_waitlist WHERE tenant_id=$1 AND branch_id=$2 AND status='pending'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(BookingSummary {
        tenant_id,
        branch_id,
        total_appointments: total,
        today_booked,
        queue_depth,
        waitlist_total: queue_depth,
    }))
}

async fn recommend_slots(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RecommendSlotsPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        payload.tenant_id.as_deref(),
        payload.branch_id.as_deref(),
    );

    if branch_id.is_empty() {
        return Err(ApiError::bad_request("branch_id is required"));
    }

    let target_date = payload
        .date
        .unwrap_or_else(|| Utc::now().to_rfc3339())
        .chars()
        .take(10)
        .collect::<String>();

    let duration = payload.duration_minutes.unwrap_or(45).max(10);
    let busy_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND start_at::date = $3::date",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&target_date)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let response = json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "date": target_date,
        "durationMinutes": duration,
        "busyCount": busy_count,
        "recommendations": [],
    });

    Ok(Json(response))
}

pub async fn create_booking_from_smart_booking(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AppointmentCreatePayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = if public_source_from(&payload) {
        let claims = require_public_booking_claims(&state, &headers, "confirm")?;
        (claims.tenant_id, claims.branch_id)
    } else {
        scope_from_headers(
            &headers,
            payload.tenant_id.as_deref(),
            payload.branch_id.as_deref(),
        )
    };

    let status = normalize_status(&payload.status).unwrap_or_else(|_| "booked".to_string());
    let start_at = parse_datetime(&payload.start_at, "start_at")?;
    let end_at = parse_datetime(&payload.end_at, "end_at")?;
    if end_at <= start_at {
        return Err(ApiError::bad_request("end_at must be after start_at"));
    }
    validate_branch_operating_hours(&state, &tenant_id, &branch_id, start_at, end_at, "", None)
        .await?;

    validate_public_booking_ownership(&state, &tenant_id, &branch_id, &payload).await?;

    let source_channel = payload
        .source_channel
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("smart-booking");
    let source = payload
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(source_channel);
    let client_id = payload.client_id.trim();
    if client_id.is_empty() {
        return Err(ApiError::bad_request("client_id is required"));
    }
    let unmet_guards = booking_intelligence_service::unmet_consultation_guards(
        &state.db,
        &tenant_id,
        &branch_id,
        client_id,
        &payload.service_ids,
    )
    .await
    .map_err(|_| ApiError::internal("failed to validate consultation requirement"))?;
    if !unmet_guards.is_empty() {
        return Err(ApiError::conflict(
            "A required consultation or patch test must be completed before booking this service",
        ));
    }
    let staff_preference = normalize_staff_preference(&payload.staff_preference)?;
    let requested_staff_id = if !matches!(staff_preference, "preferred" | "required") {
        String::new()
    } else if payload.requested_staff_id.trim().is_empty() {
        payload.staff_id.trim().to_string()
    } else {
        payload.requested_staff_id.trim().to_string()
    };
    let service_selections_json =
        service_selections_json(&payload.service_ids, &payload.service_selections)?;
    let booked_total_paise = validate_service_pricing(
        &state,
        &tenant_id,
        &branch_id,
        &payload.staff_id,
        &payload.service_ids,
        &payload.service_selections,
        start_at,
        &payload.client_id,
        payload
            .source_channel
            .as_deref()
            .map(|value| {
                if value == "booking-portal-v2" {
                    "webstore"
                } else {
                    "crm"
                }
            })
            .unwrap_or("crm"),
    )
    .await?;
    validate_staff_blackout(
        &state,
        &tenant_id,
        &branch_id,
        &payload.staff_id,
        start_at,
        end_at,
    )
    .await?;
    validate_staff_booking_availability(
        &state,
        &tenant_id,
        &branch_id,
        &payload.staff_id,
        &payload.service_ids,
        start_at,
        end_at,
        None,
    )
    .await?;
    validate_chair_room_availability(
        &state,
        &tenant_id,
        &branch_id,
        &payload.chair_room_id,
        start_at,
        end_at,
        None,
    )
    .await?;
    validate_service_resource_requirement(
        &state,
        &tenant_id,
        &branch_id,
        &payload.service_ids,
        &payload.chair_room_id,
    )
    .await?;

    let id = uuid::Uuid::new_v4().to_string();
    let row = sqlx::query(
        "INSERT INTO appointments (
            id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json,
            service_selections_json, start_at, end_at, status, notes, source_channel, source,
            booking_group_id, booked_total_paise, requested_staff_id, staff_preference, version, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,$19,$20)
         RETURNING id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(client_id)
    .bind(&payload.staff_id)
    .bind(&payload.chair_room_id)
    .bind(service_ids_to_json(&payload.service_ids))
    .bind(service_selections_json)
    .bind(start_at)
    .bind(end_at)
    .bind(status)
    .bind(&payload.notes)
    .bind(source_channel)
    .bind(source)
    .bind(&payload.booking_group_id)
    .bind(booked_total_paise)
    .bind(&requested_staff_id)
    .bind(staff_preference)
    .bind(Utc::now())
    .bind(Utc::now())
    .fetch_one(&state.db)
    .await
    .map_err(|error| booking_write_error(error, "failed to create appointment"))?;
    let appointment = build_appointment(&row)?;

    insert_activity(
        &state,
        &tenant_id,
        None,
        &appointment,
        "BOOKED",
        "smart-booking recommendation booking",
    )
    .await?;

    Ok(Json(appointment))
}

async fn add_waitlist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SmartWaitlistPayload>,
) -> Result<Json<WaitlistPayloadOut>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        payload.tenant_id.as_deref(),
        payload.branch_id.as_deref(),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now();
    let preferred_slot_at = payload
        .preferred_slot_at
        .clone()
        .unwrap_or_else(|| now.to_rfc3339());
    let preferred_slot_at = parse_datetime(&preferred_slot_at, "preferred_slot_at")?;
    let (constraint_type, constraint_resource_kind) = waitlist_constraint(&payload)?;

    let row = sqlx::query(
        "INSERT INTO appointment_waitlist (
            id, tenant_id, branch_id, customer_id, service_ids_json, preferred_staff_id, preferred_slot_at, status, notes, constraint_type, constraint_resource_kind, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id, tenant_id, branch_id, customer_id, service_ids_json, preferred_slot_at, status, notes, constraint_type, constraint_resource_kind, created_at
        ",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&payload.customer_id)
    .bind(service_ids_to_json(&payload.service_ids))
    .bind(payload.preferred_staff_id.as_deref().filter(|value| !value.trim().is_empty()))
    .bind(preferred_slot_at)
    .bind("pending")
    .bind(&payload.notes)
    .bind(constraint_type)
    .bind(constraint_resource_kind)
    .bind(now)
    .bind(now)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to add waitlist"))?;

    let service_ids_raw: String = row
        .try_get("service_ids_json")
        .map_err(|_| ApiError::internal("invalid waitlist row"))?;
    let created_at: DateTime<Utc> = row
        .try_get("created_at")
        .map_err(|_| ApiError::internal("invalid waitlist row"))?;
    let preferred_slot_at: DateTime<Utc> = row
        .try_get("preferred_slot_at")
        .map_err(|_| ApiError::internal("invalid waitlist row"))?;

    Ok(Json(WaitlistPayloadOut {
        id: row.try_get("id").unwrap_or_default(),
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        branch_id: row.try_get("branch_id").unwrap_or_default(),
        customer_id: row.try_get("customer_id").unwrap_or_default(),
        service_ids: parse_service_ids(&service_ids_raw),
        preferred_slot_at: preferred_slot_at.to_rfc3339(),
        status: row
            .try_get("status")
            .unwrap_or_else(|_| "pending".to_string()),
        created_at: created_at.to_rfc3339(),
        constraint_type: row.try_get("constraint_type").unwrap_or_default(),
        constraint_resource_kind: row.try_get("constraint_resource_kind").unwrap_or_default(),
    }))
}

async fn list_waitlist(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let rows = sqlx::query(
        "SELECT id, customer_id, service_ids_json, preferred_slot_at, status, notes, constraint_type, constraint_resource_kind, notification_attempts, last_notified_at, cooldown_until, created_at
         FROM appointment_waitlist
         WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('pending','offered')
         ORDER BY CASE WHEN status='offered' THEN 0 ELSE 1 END, preferred_slot_at, created_at, id",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load waitlist"))?;

    Ok(Json(rows.into_iter().map(|row| json!({
        "id": row.try_get::<String, _>("id").unwrap_or_default(),
        "customerId": row.try_get::<String, _>("customer_id").unwrap_or_default(),
        "serviceIds": parse_service_ids(&row.try_get::<String, _>("service_ids_json").unwrap_or_default()),
        "preferredSlotAt": row.try_get::<DateTime<Utc>, _>("preferred_slot_at").map(|value| value.to_rfc3339()).unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "notes": row.try_get::<String, _>("notes").unwrap_or_default(),
        "constraintType": row.try_get::<String, _>("constraint_type").unwrap_or_default(),
        "constraintResourceKind": row.try_get::<String, _>("constraint_resource_kind").unwrap_or_default(),
        "notificationAttempts": row.try_get::<i32, _>("notification_attempts").unwrap_or_default(),
        "lastNotifiedAt": row.try_get::<Option<DateTime<Utc>>, _>("last_notified_at").ok().flatten().map(|value| value.to_rfc3339()),
        "cooldownUntil": row.try_get::<Option<DateTime<Utc>>, _>("cooldown_until").ok().flatten().map(|value| value.to_rfc3339()),
    })).collect()))
}

async fn delete_waitlist(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let affected = sqlx::query(
        "UPDATE appointment_waitlist SET status='cancelled',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to remove waitlist entry"))?
    .rows_affected();
    if affected == 0 {
        return Err(ApiError::not_found("Waitlist entry not found"));
    }
    security_service::record_audit(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        "appointment.waitlist.cancelled",
        json!({"waitlistId":id}),
    )
    .await
    .map_err(|_| ApiError::internal("failed to audit waitlist cancellation"))?;
    Ok(Json(json!({ "id": id, "status": "cancelled" })))
}

async fn promote_waitlist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(waitlist_id): Path<String>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to start waitlist promotion"))?;

    let row = sqlx::query(
        "SELECT id, tenant_id, branch_id, customer_id, service_ids_json, preferred_slot_at, notes
         FROM appointment_waitlist
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending' LIMIT 1
         FOR UPDATE",
    )
    .bind(&waitlist_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to load waitlist"))?
    .ok_or_else(|| ApiError::not_found("Waitlist entry not found"))?;

    let customer_id: String = row
        .try_get("customer_id")
        .map_err(|_| ApiError::internal("invalid waitlist row"))?;
    let preferred_slot_at: String = row
        .try_get("preferred_slot_at")
        .map_err(|_| ApiError::internal("invalid waitlist row"))?;
    let service_ids_raw: String = row
        .try_get("service_ids_json")
        .map_err(|_| ApiError::internal("invalid waitlist row"))?;
    let notes: String = row.try_get("notes").unwrap_or_default();

    let start = parse_datetime(&preferred_slot_at, "preferred_slot_at")?;
    let end = start + Duration::minutes(45);
    let service_ids = parse_service_ids(&service_ids_raw);
    let id = uuid::Uuid::new_v4().to_string();
    let inserted = sqlx::query(
        "INSERT INTO appointments (
            id, tenant_id, branch_id, client_id, staff_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, tenant_id, branch_id, client_id, staff_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&customer_id)
    .bind("")
    .bind(service_ids_to_json(&service_ids))
    .bind(start)
    .bind(end)
    .bind("booked")
    .bind(format!("promoted from waitlist {}", waitlist_id))
    .bind("smart-booking")
    .bind("smart-booking")
    .bind("")
    .bind(1i32)
    .bind(Utc::now())
    .bind(Utc::now())
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to promote waitlist"))?;

    let updated = sqlx::query(
        "UPDATE appointment_waitlist SET status='promoted', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'",
    )
    .bind(&waitlist_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .execute(&mut *tx)
    .await;
    let updated = updated.map_err(|_| ApiError::internal("failed to update waitlist status"))?;
    if updated.rows_affected() != 1 {
        return Err(ApiError::conflict("Waitlist entry is no longer pending"));
    }

    let appointment = build_appointment(&inserted)?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to commit waitlist promotion"))?;
    insert_activity(
        &state,
        &tenant_id,
        None,
        &appointment,
        "WAITLIST_PROMOTED",
        &notes,
    )
    .await?;
    Ok(Json(appointment))
}

pub(crate) async fn offer_waitlist_for_cancelled_appointment(
    state: &AppState,
    appointment: &AppointmentPayload,
) -> Result<Option<Value>, ApiError> {
    if appointment.status != "cancelled" || appointment.staff_id.trim().is_empty() {
        return Ok(None);
    }
    let start_at = parse_datetime(&appointment.start_at, "appointment.start_at")?;
    let end_at = parse_datetime(&appointment.end_at, "appointment.end_at")?;
    let services = service_ids_to_json(&appointment.service_ids);
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to start waitlist offer"))?;
    let candidate = sqlx::query(
        "SELECT id,customer_id,notes,notification_attempts FROM appointment_waitlist
         WHERE tenant_id=$1 AND branch_id=$2 AND status='pending'
           AND service_ids_json=$3
           AND (preferred_staff_id IS NULL OR preferred_staff_id=$4)
           AND preferred_slot_at::date=$5::date
           AND notification_attempts<3
           AND (cooldown_until IS NULL OR cooldown_until<=NOW())
           AND (SELECT COUNT(*) FROM appointment_waitlist_offers offer
                  JOIN appointment_waitlist queued ON queued.id=offer.waitlist_id
                 WHERE offer.tenant_id=$1 AND queued.customer_id=appointment_waitlist.customer_id
                   AND offer.created_at>=CURRENT_DATE)<20
         ORDER BY CASE WHEN preferred_staff_id=$4 THEN 0 ELSE 1 END,preferred_slot_at,created_at,id
         LIMIT 1 FOR UPDATE SKIP LOCKED",
    )
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&services)
    .bind(&appointment.staff_id)
    .bind(start_at.date_naive())
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to select waitlist candidate"))?;
    let Some(candidate) = candidate else {
        return Ok(None);
    };
    let waitlist_id = candidate.try_get::<String, _>("id").unwrap_or_default();
    let customer_id = candidate
        .try_get::<String, _>("customer_id")
        .unwrap_or_default();
    let notes = candidate.try_get::<String, _>("notes").unwrap_or_default();
    let attempt_no = candidate
        .try_get::<i32, _>("notification_attempts")
        .unwrap_or_default()
        + 1;
    let conflict = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND status NOT IN ('cancelled','no-show') AND start_at<$5 AND end_at>$4)",
    )
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&appointment.staff_id)
    .bind(start_at)
    .bind(end_at)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to revalidate waitlist slot"))?;
    if conflict {
        return Ok(None);
    }
    let offered_appointment_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO appointments (id,tenant_id,branch_id,client_id,staff_id,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id,version,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'waitlist_offer',$9,'waitlist','waitlist','',1,NOW(),NOW())",
    )
    .bind(&offered_appointment_id)
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&customer_id)
    .bind(&appointment.staff_id)
    .bind(&services)
    .bind(start_at)
    .bind(end_at)
    .bind(format!("Waitlist offer for {} | {}", appointment.id, notes))
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to reserve waitlist slot"))?;
    let offer_id = uuid::Uuid::new_v4().to_string();
    let expiry_minutes = sqlx::query_scalar::<_, i64>(
        "SELECT LEAST(1440,GREATEST(1,COALESCE((settings_json->>'waitlistOfferExpiryMinutes')::BIGINT,10)))
           FROM appointment_branch_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to load waitlist expiry policy"))?
    .unwrap_or(10);
    let expires_at = Utc::now() + Duration::minutes(expiry_minutes);
    let inserted = sqlx::query(
        "INSERT INTO appointment_waitlist_offers (id,tenant_id,branch_id,waitlist_id,source_appointment_id,offered_appointment_id,expires_at,attempt_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
    )
    .bind(&offer_id)
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&waitlist_id)
    .bind(&appointment.id)
    .bind(&offered_appointment_id)
    .bind(expires_at)
    .bind(attempt_no)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to create waitlist offer"))?;
    if inserted.rows_affected() != 1 {
        return Ok(None);
    }
    sqlx::query("UPDATE appointment_waitlist SET status='offered',notification_attempts=$2,last_notified_at=NOW(),cooldown_until=NULL,updated_at=NOW() WHERE id=$1 AND status='pending'")
        .bind(&waitlist_id)
        .bind(attempt_no)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("failed to reserve waitlist entry"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to commit waitlist offer"))?;
    let _ = benefit_notification_service::queue_appointment_event(
        state,
        &appointment.tenant_id,
        &appointment.branch_id,
        &offered_appointment_id,
        &customer_id,
        1,
        "WAITLIST_OFFER",
    )
    .await;
    Ok(Some(json!({
        "id": offer_id,
        "waitlistId": waitlist_id,
        "appointmentId": offered_appointment_id,
        "expiresAt": expires_at,
        "status": "offered"
    })))
}

pub(crate) async fn expire_waitlist_offers(state: &AppState) -> Result<usize, ApiError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to start waitlist expiry"))?;
    let due = sqlx::query(
        "SELECT id,waitlist_id,source_appointment_id,offered_appointment_id,tenant_id,branch_id
         FROM appointment_waitlist_offers WHERE status='offered' AND expires_at<=NOW()
         ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 100",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to load expired waitlist offers"))?;
    let mut sources = Vec::new();
    for row in &due {
        let offer_id: String = row.try_get("id").unwrap_or_default();
        let waitlist_id: String = row.try_get("waitlist_id").unwrap_or_default();
        let offered_appointment_id: String =
            row.try_get("offered_appointment_id").unwrap_or_default();
        let source_id: String = row.try_get("source_appointment_id").unwrap_or_default();
        let tenant_id: String = row.try_get("tenant_id").unwrap_or_default();
        let branch_id: String = row.try_get("branch_id").unwrap_or_default();
        sqlx::query("UPDATE appointment_waitlist_offers SET status='expired',updated_at=NOW() WHERE id=$1 AND status='offered'")
            .bind(&offer_id).execute(&mut *tx).await
            .map_err(|_| ApiError::internal("failed to expire waitlist offer"))?;
        sqlx::query("UPDATE appointments SET status='cancelled',version=version+1,updated_at=NOW() WHERE id=$1 AND status='waitlist_offer'")
            .bind(&offered_appointment_id).execute(&mut *tx).await
            .map_err(|_| ApiError::internal("failed to release expired waitlist slot"))?;
        sqlx::query("UPDATE appointment_waitlist SET status=CASE WHEN notification_attempts<3 THEN 'pending' ELSE 'expired' END,cooldown_until=CASE WHEN notification_attempts<3 THEN NOW()+INTERVAL '10 minutes' ELSE NULL END,updated_at=NOW() WHERE id=$1 AND status='offered'")
            .bind(&waitlist_id).execute(&mut *tx).await
            .map_err(|_| ApiError::internal("failed to expire waitlist entry"))?;
        sources.push((tenant_id, branch_id, source_id));
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to commit waitlist expiry"))?;
    for (tenant_id, branch_id, source_id) in sources.iter() {
        if let Ok(source) = find_appointment(state, tenant_id, branch_id, source_id).await {
            let _ = offer_waitlist_for_cancelled_appointment(state, &source).await;
        }
    }
    Ok(sources.len())
}

async fn online_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<OnlineRequestPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        payload.tenant_id.as_deref(),
        payload.branch_id.as_deref(),
    );
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO smart_booking_requests (id, tenant_id, branch_id, request_type, payload, created_at)
         VALUES ($1,$2,$3,$4,$5,NOW())",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(if payload.event_type.is_empty() {
        "general"
    } else {
        &payload.event_type
    })
    .bind(payload.payload.to_string())
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to save online request"))?;

    Ok(Json(json!({
        "requestId": id,
        "tenantId": tenant_id,
        "branchId": branch_id,
        "status": "accepted"
    })))
}

async fn qr_check_in(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<QrCheckInPayload>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    if payload.appointment_id.as_ref().is_none() && payload.token.as_ref().is_none() {
        return Err(ApiError::bad_request("appointment_id or token required"));
    }

    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        payload.tenant_id.as_deref(),
        payload.branch_id.as_deref(),
    );
    let appointment_id = payload
        .appointment_id
        .unwrap_or_else(|| payload.token.unwrap_or_default());
    let current = find_appointment(&state, &tenant_id, &branch_id, &appointment_id).await?;
    let reason = payload.reason.unwrap_or_else(|| "qr".to_string());

    let row = sqlx::query(
        "UPDATE appointments SET status='arrived', notes=COALESCE(notes,'') || $1, version = version + 1, updated_at=NOW()
         WHERE id=$2 AND tenant_id=$3 AND branch_id=$4
         RETURNING id, tenant_id, branch_id, client_id, staff_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(format!(" | checked-in: {reason}"))
    .bind(&appointment_id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to check-in"))?;

    let appointment = build_appointment(&row)?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &appointment,
        "ARRIVED",
        &format!("checked-in: {reason}"),
    )
    .await?;
    Ok(Json(AppointmentResponse {
        appointment,
        waitlist_offer: None,
        sales_order: None,
    }))
}

async fn queue_prediction(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(scope_query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        scope_query.tenant_id.as_deref(),
        scope_query.branch_id.as_deref(),
    );
    let waiting = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('booked','confirmed','arrived','waiting')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "expectedWaitingCount": waiting,
        "estimatedDelayMinutes": (waiting * 12).max(0),
        "status": "ok"
    })))
}

pub async fn create_appointment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AppointmentCreatePayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    create_booking_from_smart_booking(
        State(state),
        headers,
        Json(AppointmentCreatePayload {
            tenant_id: payload.tenant_id,
            branch_id: payload.branch_id,
            staff_id: payload.staff_id,
            requested_staff_id: payload.requested_staff_id,
            staff_preference: payload.staff_preference,
            client_id: payload.client_id,
            service_ids: payload.service_ids,
            start_at: payload.start_at,
            end_at: payload.end_at,
            notes: payload.notes,
            status: if payload.status.is_empty() {
                "booked".to_string()
            } else {
                payload.status
            },
            booking_group_id: payload.booking_group_id,
            source_channel: payload.source_channel,
            source: payload.source,
            chair_room_id: payload.chair_room_id,
            service_selections: payload.service_selections,
        }),
    )
    .await
}

async fn save_appointment_batch_authenticated(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<AuthClaims>,
    Json(payload): Json<AppointmentBatchPayload>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    save_appointment_batch_inner(state, headers, payload, Some(claims)).await
}

pub(crate) async fn save_appointment_batch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AppointmentBatchPayload>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    save_appointment_batch_inner(state, headers, payload, None).await
}

async fn validate_advance_payment(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    input: Option<&AppointmentAdvancePaymentPayload>,
    actor_user_id: Option<&str>,
    recurrence_count: i32,
    booking: &AppointmentBatchPayload,
) -> Result<Option<ValidatedAdvancePayment>, ApiError> {
    let Some(input) = input else { return Ok(None) };
    if actor_user_id.is_none() {
        return Err(ApiError::unauthorized(
            "authenticated staff is required to collect an advance",
        ));
    }
    if input.amount_paise <= 0 {
        return Err(ApiError::bad_request(
            "advance payment amount must be positive",
        ));
    }
    if recurrence_count != 1
        || !booking.removed_appointment_ids.is_empty()
        || booking
            .lines
            .iter()
            .any(|line| !line.appointment_id.trim().is_empty())
    {
        return Err(ApiError::conflict(
            "advance payment is available only while creating a one-time booking",
        ));
    }
    payment_methods_repository::ensure_defaults(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| ApiError::internal("failed to initialize payment methods"))?;
    let modes = payment_methods_repository::list(&state.db, tenant_id, branch_id, true)
        .await
        .map_err(|_| ApiError::internal("failed to validate payment method"))?;
    let mode = modes
        .into_iter()
        .find(|mode| mode.code == input.method.trim())
        .ok_or_else(|| ApiError::bad_request("payment method is inactive or unavailable"))?;
    if (mode.reference_required
        || matches!(mode.settlement_type.as_str(), "store_credit" | "gift_card"))
        && input.reference.trim().is_empty()
    {
        return Err(ApiError::bad_request(
            "payment reference is required for this method",
        ));
    }
    Ok(Some(ValidatedAdvancePayment {
        amount_paise: input.amount_paise,
        method: mode.code,
        settlement_type: mode.settlement_type,
        reference: input.reference.trim().to_string(),
        cash_drawer_till_id: input.cash_drawer_till_id.trim().to_string(),
    }))
}

async fn save_appointment_batch_inner(
    state: AppState,
    headers: HeaderMap,
    mut payload: AppointmentBatchPayload,
    actor_claims: Option<AuthClaims>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    let actor_user_id = actor_claims.as_ref().map(|claims| claims.sub.as_str());
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    if !payload.idempotency_key.trim().is_empty()
        && !valid_booking_key(payload.idempotency_key.trim())
    {
        return Err(ApiError::bad_request("invalid booking idempotency key"));
    }
    let default_client_id = payload.client_id.trim().to_string();
    let client_id = default_client_id.as_str();
    if payload.lines.is_empty()
        || (client_id.is_empty()
            && payload
                .lines
                .iter()
                .any(|line| line.client_id.trim().is_empty()))
    {
        return Err(ApiError::bad_request(
            "every booking service needs a client and at least one service is required",
        ));
    }
    let booking_client_ids = payload
        .lines
        .iter()
        .map(|line| booking_line_client_id(client_id, line.client_id.trim()).to_string())
        .collect::<std::collections::HashSet<_>>();
    let booking_type = advanced_booking_kind(&payload.booking_type, booking_client_ids.len())?;
    if payload.group_name.trim().chars().count() > 120
        || payload.group_notes.trim().chars().count() > 2_000
        || !valid_optional_http_url(&payload.virtual_meeting_url)
    {
        return Err(ApiError::bad_request(
            "group name, notes, or virtual meeting URL is invalid",
        ));
    }
    if !payload.host_client_id.trim().is_empty()
        && !booking_client_ids.contains(payload.host_client_id.trim())
    {
        return Err(ApiError::bad_request(
            "host_client_id must belong to the booking",
        ));
    }
    let known_client_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(booking_client_ids.iter().cloned().collect::<Vec<_>>())
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to validate booking clients"))?;
    if known_client_count != booking_client_ids.len() as i64 {
        return Err(ApiError::not_found(
            "one or more booking clients were not found",
        ));
    }
    for line in &mut payload.lines {
        let line_client_id = booking_line_client_id(client_id, line.client_id.trim()).to_string();
        resolve_provider_preference(&state, &tenant_id, &branch_id, &line_client_id, line).await?;
    }
    if booking_type == "day_package" {
        let service_ids = payload
            .lines
            .iter()
            .map(|line| line.service_id.trim().to_string())
            .collect::<Vec<_>>();
        let package_valid = !payload.day_package_id.trim().is_empty()
            && sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM packages package WHERE package.tenant_id=$1 AND package.branch_id=$2 AND package.id=$3 AND package.active=TRUE AND NOT EXISTS(SELECT 1 FROM unnest($4::TEXT[]) selected(service_id) WHERE NOT package.service_ids_json ? selected.service_id))",
            )
            .bind(&tenant_id).bind(&branch_id).bind(payload.day_package_id.trim()).bind(&service_ids)
            .fetch_one(&state.db).await.map_err(|_| ApiError::internal("failed to validate day package"))?;
        if !package_valid {
            return Err(ApiError::bad_request(
                "active day package and its configured services are required",
            ));
        }
    } else if !payload.day_package_id.trim().is_empty() {
        return Err(ApiError::bad_request(
            "day_package_id requires a day_package booking",
        ));
    }
    let status = normalize_status(&payload.status).unwrap_or_else(|_| "booked".to_string());
    let recurrence_count = payload.recurrence_count.unwrap_or(1);
    let recurrence_interval_days = payload.recurrence_interval_days.unwrap_or(7);
    if !(1..=52).contains(&recurrence_count) || !(1..=365).contains(&recurrence_interval_days) {
        return Err(ApiError::bad_request(
            "recurrence_count must be 1-52 and recurrence_interval_days must be 1-365",
        ));
    }
    if recurrence_count > 1
        && (!payload.removed_appointment_ids.is_empty()
            || payload
                .lines
                .iter()
                .any(|line| !line.appointment_id.trim().is_empty()))
    {
        return Err(ApiError::bad_request(
            "recurrence can only be used for a new booking",
        ));
    }
    let advance_payment = validate_advance_payment(
        &state,
        &tenant_id,
        &branch_id,
        payload.advance_payment.as_ref(),
        actor_user_id,
        recurrence_count,
        &payload,
    )
    .await?;
    let mut current_by_id = std::collections::HashMap::new();
    for appointment_id in payload
        .removed_appointment_ids
        .iter()
        .chain(payload.lines.iter().map(|line| &line.appointment_id))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if !current_by_id.contains_key(appointment_id) {
            current_by_id.insert(
                appointment_id.to_string(),
                find_appointment(&state, &tenant_id, &branch_id, appointment_id).await?,
            );
        }
    }
    for appointment_id in &payload.removed_appointment_ids {
        let current = current_by_id
            .get(appointment_id.trim())
            .ok_or_else(|| ApiError::not_found("Appointment service was not found"))?;
        if status_is_closed(&current.status) {
            return Err(ApiError::conflict(
                "Completed, billed, paid, or cancelled services cannot be removed",
            ));
        }
    }
    let mut planned_slots: Vec<(String, String, DateTime<Utc>, DateTime<Utc>)> = Vec::new();
    let mut planned_prices = Vec::with_capacity(payload.lines.len() * recurrence_count as usize);
    let mut authoritative_recommendations = Vec::with_capacity(payload.lines.len());
    let price_manage = actor_claims.as_ref().is_some_and(|claims| {
        staff_appointment_permission(claims, "staff.app.appointments.price.manage")
    });
    for line in &payload.lines {
        let line_client_id = booking_line_client_id(client_id, line.client_id.trim());
        let service_mode = advanced_service_mode(&line.service_mode)?;
        let sequence_no = line.sequence_no.unwrap_or(1);
        if !(1..=100).contains(&sequence_no)
            || line.segment_label.trim().chars().count() > 120
            || (service_mode == "segmented" && line.segment_label.trim().is_empty())
        {
            return Err(ApiError::bad_request(
                "service sequence or segmented-service label is invalid",
            ));
        }
        if line.staff_id.trim().is_empty()
            || line.service_id.trim().is_empty()
            || line.start_at.trim().is_empty()
            || line.end_at.trim().is_empty()
        {
            return Err(ApiError::bad_request(
                "Every service needs staff, service, start, and end time",
            ));
        }
        let current = current_by_id.get(line.appointment_id.trim());
        if let Some(current) = current {
            if line
                .expected_version
                .is_some_and(|version| version != current.version)
            {
                return Err(ApiError::conflict(
                    "Appointment changed after it was opened. Reload before saving.",
                ));
            }
            if status_is_closed(&current.status) {
                return Err(ApiError::conflict(
                    "Completed, billed, paid, or cancelled services cannot be updated",
                ));
            }
            if current.client_id != line_client_id {
                return Err(ApiError::conflict(
                    "an existing booking service cannot be moved to another client",
                ));
            }
            validate_staff_reassignment(
                current,
                line.staff_id.trim(),
                &line.staff_change_approval,
                &line.staff_change_reason,
            )?;
        }
        normalize_staff_preference(&line.staff_preference)?;
        let base_start = parse_datetime(&line.start_at, "start_at")?;
        let base_end = parse_datetime(&line.end_at, "end_at")?;
        if base_end <= base_start {
            return Err(ApiError::bad_request("end_at must be after start_at"));
        }
        let recommendation = if line.recommended_staff_id.trim().is_empty() {
            None
        } else {
            let india = FixedOffset::east_opt(19_800).expect("India offset is valid");
            let local_start = base_start.with_timezone(&india);
            let local_end = base_end.with_timezone(&india);
            let ranked = staff_enterprise_service::best_staff(
                &state.db,
                &tenant_id,
                &branch_id,
                staff_enterprise_service::BestStaffRequest {
                    date: local_start.date_naive(),
                    start_time: local_start.time(),
                    end_time: local_end.time(),
                    service_ids: Some(vec![line.service_id.trim().to_string()]),
                    client_id: line_client_id.to_string(),
                    appointment_id: line.appointment_id.trim().to_string(),
                },
            )
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
            let recommended = ranked
                .first()
                .map(|candidate| candidate.staff_id.as_str())
                .ok_or_else(|| {
                    ApiError::conflict("staff recommendation is no longer available; refresh")
                })?;
            if recommended != line.recommended_staff_id.trim() {
                return Err(ApiError::conflict(
                    "staff recommendation changed; refresh and choose again",
                ));
            }
            if recommended != line.staff_id.trim() {
                if !recommendation_override_allowed(actor_claims.as_ref()) {
                    return Err(ApiError::with_status(
                        StatusCode::FORBIDDEN,
                        "manager permission is required to override recommended staff",
                    ));
                }
                if !(3..=500).contains(&line.recommendation_override_reason.trim().chars().count())
                {
                    return Err(ApiError::bad_request(
                        "manager override reason must be between 3 and 500 characters",
                    ));
                }
            }
            Some(recommended.to_string())
        };
        authoritative_recommendations.push(recommendation);
        let selection = AppointmentServiceSelection {
            service_id: line.service_id.trim().to_string(),
            variant_id: line.variant_id.trim().to_string(),
            addon_ids: line.addon_ids.clone(),
        };
        service_selections_json(
            &[selection.service_id.clone()],
            std::slice::from_ref(&selection),
        )?;
        let unmet_guards = booking_intelligence_service::unmet_consultation_guards(
            &state.db,
            &tenant_id,
            &branch_id,
            line_client_id,
            std::slice::from_ref(&selection.service_id),
        )
        .await
        .map_err(|_| ApiError::internal("failed to validate consultation requirement"))?;
        if !unmet_guards.is_empty() {
            return Err(ApiError::conflict("A required consultation or patch test must be completed before booking this service"));
        }
        for occurrence in 0..recurrence_count {
            let offset = Duration::days(recurrence_interval_days * i64::from(occurrence));
            let start_at = base_start + offset;
            let end_at = base_end + offset;
            validate_branch_operating_hours(
                &state,
                &tenant_id,
                &branch_id,
                start_at,
                end_at,
                &payload.outside_hours_override_reason,
                actor_claims.as_ref(),
            )
            .await?;
            if planned_slots
                .iter()
                .any(|(staff_id, chair_room_id, start, end)| {
                    (staff_id == line.staff_id.trim()
                        || (!line.chair_room_id.trim().is_empty()
                            && chair_room_id == line.chair_room_id.trim()))
                        && start_at < *end
                        && end_at > *start
                })
            {
                return Err(ApiError::conflict(
                    "booking services overlap for the same staff or chair / room",
                ));
            }
            planned_slots.push((
                line.staff_id.trim().to_string(),
                line.chair_room_id.trim().to_string(),
                start_at,
                end_at,
            ));
            validate_staff_blackout(
                &state,
                &tenant_id,
                &branch_id,
                line.staff_id.trim(),
                start_at,
                end_at,
            )
            .await?;
            validate_staff_booking_availability(
                &state,
                &tenant_id,
                &branch_id,
                line.staff_id.trim(),
                &[line.service_id.trim().to_string()],
                start_at,
                end_at,
                current.map(|appointment| appointment.id.as_str()),
            )
            .await?;
            validate_chair_room_availability(
                &state,
                &tenant_id,
                &branch_id,
                line.chair_room_id.trim(),
                start_at,
                end_at,
                current.map(|appointment| appointment.id.as_str()),
            )
            .await?;
            validate_service_resource_requirement(
                &state,
                &tenant_id,
                &branch_id,
                &[line.service_id.trim().to_string()],
                line.chair_room_id.trim(),
            )
            .await?;
            let booked_total_paise = validate_service_pricing(
                &state,
                &tenant_id,
                &branch_id,
                line.staff_id.trim(),
                &[line.service_id.trim().to_string()],
                std::slice::from_ref(&selection),
                start_at,
                &line_client_id,
                "crm",
            )
            .await?;
            let booked_total_paise = if let Some(price) = line.price_override_paise {
                if !price_manage {
                    return Err(ApiError::with_status(
                        StatusCode::FORBIDDEN,
                        "Appointment price override permission is required",
                    ));
                }
                if !(0..=100_000_000).contains(&price)
                    || !(3..=500).contains(&line.price_override_reason.trim().chars().count())
                {
                    return Err(ApiError::bad_request(
                        "price override and a 3-500 character reason are required",
                    ));
                }
                price
            } else {
                booked_total_paise
            };
            planned_prices.push(booked_total_paise);
        }
    }
    if advance_payment
        .as_ref()
        .is_some_and(|payment| payment.amount_paise > planned_prices.iter().sum())
    {
        return Err(ApiError::bad_request(
            "advance payment cannot exceed the booking total",
        ));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to start booking save"))?;
    let now = Utc::now();
    let mut changes: Vec<(
        Option<AppointmentPayload>,
        AppointmentPayload,
        &'static str,
        String,
    )> = Vec::new();
    for appointment_id in &payload.removed_appointment_ids {
        let appointment_id = appointment_id.trim();
        if appointment_id.is_empty() {
            continue;
        }
        let current = current_by_id
            .get(appointment_id)
            .expect("validated appointment must exist");
        let row = sqlx::query(
            "UPDATE appointments
             SET status='cancelled', notes=COALESCE(notes,'') || ' | Service removed from booking', version=version+1, updated_at=$1, last_mutation_key=$5
             WHERE id=$2 AND tenant_id=$3 AND branch_id=$4
             RETURNING id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
        )
        .bind(now)
        .bind(appointment_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(payload.idempotency_key.trim())
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("failed to remove appointment service"))?;
        changes.push((
            Some(current.clone()),
            build_appointment(&row)?,
            "CANCELLED",
            "Service removed from booking".to_string(),
        ));
    }
    let recurrence_series_id = (recurrence_count > 1)
        .then(|| uuid::Uuid::new_v4().to_string())
        .unwrap_or_default();
    let group_ids = (0..recurrence_count)
        .map(|occurrence| {
            if occurrence == 0 && !payload.booking_group_id.trim().is_empty() {
                payload.booking_group_id.trim().to_string()
            } else if payload.lines.len() < 2 {
                String::new()
            } else {
                uuid::Uuid::new_v4().to_string()
            }
        })
        .collect::<Vec<_>>();
    for occurrence in 0..recurrence_count {
        let offset = Duration::days(recurrence_interval_days * i64::from(occurrence));
        for (line_index, line) in payload.lines.iter().enumerate() {
            let line_client_id = booking_line_client_id(client_id, line.client_id.trim());
            let start_at = parse_datetime(&line.start_at, "start_at")? + offset;
            let end_at = parse_datetime(&line.end_at, "end_at")? + offset;
            let booked_total_paise =
                planned_prices[occurrence as usize * payload.lines.len() + line_index];
            let current = current_by_id.get(line.appointment_id.trim());
            let staff_preference = normalize_staff_preference(&line.staff_preference)?;
            let requested_staff_id = if !matches!(staff_preference, "preferred" | "required") {
                String::new()
            } else if line.requested_staff_id.trim().is_empty() {
                line.staff_id.trim().to_string()
            } else {
                line.requested_staff_id.trim().to_string()
            };
            let selection = AppointmentServiceSelection {
                service_id: line.service_id.trim().to_string(),
                variant_id: line.variant_id.trim().to_string(),
                addon_ids: line.addon_ids.clone(),
            };
            let selections_json =
                if selection.variant_id.is_empty() && selection.addon_ids.is_empty() {
                    "{}".to_string()
                } else {
                    service_selections_json(
                        &[selection.service_id.clone()],
                        std::slice::from_ref(&selection),
                    )?
                };
            let row = if let Some(current) = current {
                let current_start = parse_datetime(&current.start_at, "current.start_at")?;
                let current_end = parse_datetime(&current.end_at, "current.end_at")?;
                let next_status = if current_start != start_at
                    || current_end != end_at
                    || current.staff_id != line.staff_id.trim()
                {
                    "rescheduled"
                } else {
                    current.status.as_str()
                };
                sqlx::query(
                "UPDATE appointments
                 SET staff_id=$1, chair_room_id=NULLIF($2,''), service_ids_json=$3,
                     service_selections_json=CASE WHEN $4::jsonb='{}'::jsonb THEN service_selections_json ELSE $4::jsonb END,
                     start_at=$5, end_at=$6,
                     status=$7, notes=CASE WHEN COALESCE($8,'')='' THEN notes ELSE $8 END,
                     booking_group_id=NULLIF($9,''), booked_total_paise=$10,
                     version=version+1, updated_at=$11, requested_staff_id=$15, staff_preference=$16, last_mutation_key=$17,
                     booking_type=$18,host_client_id=$19,group_name=$20,group_notes=$21,is_surprise=$22,
                     virtual_meeting_url=$23,service_mode=$24,segment_label=$25,sequence_no=$26,day_package_id=$27
                 WHERE id=$12 AND tenant_id=$13 AND branch_id=$14
                 RETURNING id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
            )
            .bind(line.staff_id.trim())
            .bind(line.chair_room_id.trim())
            .bind(service_ids_to_json(&[line.service_id.trim().to_string()]))
            .bind(&selections_json)
            .bind(start_at)
            .bind(end_at)
            .bind(next_status)
            .bind(line.notes.trim())
            .bind(&group_ids[occurrence as usize])
            .bind(booked_total_paise)
            .bind(now)
            .bind(&current.id)
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(&requested_staff_id)
            .bind(staff_preference)
            .bind(payload.idempotency_key.trim())
            .bind(booking_type)
            .bind(payload.host_client_id.trim())
            .bind(payload.group_name.trim())
            .bind(payload.group_notes.trim())
            .bind(payload.is_surprise)
            .bind(payload.virtual_meeting_url.trim())
            .bind(advanced_service_mode(&line.service_mode)?)
            .bind(line.segment_label.trim())
            .bind(line.sequence_no.unwrap_or(line_index as i32 + 1))
            .bind(payload.day_package_id.trim())
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| booking_write_error(error, "failed to update appointment service"))?
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                sqlx::query(
                "INSERT INTO appointments (
                    id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json,
                    service_selections_json, start_at, end_at, status, notes, source_channel, source,
                    booking_group_id, recurrence_series_id, booked_total_paise, requested_staff_id, staff_preference, last_mutation_key, version, created_at, updated_at
                    ,booking_type,host_client_id,group_name,group_notes,is_surprise,virtual_meeting_url,service_mode,segment_label,sequence_no,day_package_id
                ) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8::jsonb,$9,$10,$11,$12,'manual','manual',NULLIF($13,''),$14,$15,$16,$17,$18,1,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
                 RETURNING id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
            )
            .bind(id)
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(line_client_id)
            .bind(line.staff_id.trim())
            .bind(line.chair_room_id.trim())
            .bind(service_ids_to_json(&[line.service_id.trim().to_string()]))
            .bind(&selections_json)
            .bind(start_at)
            .bind(end_at)
            .bind(&status)
            .bind(line.notes.trim())
            .bind(&group_ids[occurrence as usize])
            .bind(&recurrence_series_id)
            .bind(booked_total_paise)
            .bind(&requested_staff_id)
            .bind(staff_preference)
            .bind(payload.idempotency_key.trim())
            .bind(now)
            .bind(now)
            .bind(booking_type)
            .bind(payload.host_client_id.trim())
            .bind(payload.group_name.trim())
            .bind(payload.group_notes.trim())
            .bind(payload.is_surprise)
            .bind(payload.virtual_meeting_url.trim())
            .bind(advanced_service_mode(&line.service_mode)?)
            .bind(line.segment_label.trim())
            .bind(line.sequence_no.unwrap_or(line_index as i32 + 1))
            .bind(payload.day_package_id.trim())
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| booking_write_error(error, "failed to create appointment service"))?
            };
            let updated = build_appointment(&row)?;
            let mut activity_reason = if line.price_override_paise.is_some() {
                format!("Price override: {}", line.price_override_reason.trim())
            } else {
                recommendation_audit_reason(
                    line.staff_id.trim(),
                    authoritative_recommendations[line_index]
                        .as_deref()
                        .unwrap_or_default(),
                    &line.recommendation_override_reason,
                )
                .unwrap_or_else(|| {
                    if current
                        .map(|item| {
                            item.staff_id != line.staff_id.trim()
                                && item.requested_staff_id != line.staff_id.trim()
                        })
                        .unwrap_or(false)
                    {
                        if line.staff_change_reason.trim().is_empty() {
                            line.staff_change_approval.trim().to_string()
                        } else {
                            line.staff_change_reason.trim().to_string()
                        }
                    } else {
                        booking_activity_reason(&updated)
                    }
                })
            };
            if !payload.outside_hours_override_reason.trim().is_empty() {
                activity_reason.push_str(" · Outside-hours override: ");
                activity_reason.push_str(payload.outside_hours_override_reason.trim());
            }
            changes.push((
                current.cloned(),
                updated,
                if current.is_some() {
                    "BOOKING_UPDATED"
                } else {
                    "BOOKED"
                },
                activity_reason,
            ));
        }
    }
    for group_id in group_ids.iter().filter(|value| !value.is_empty()) {
        let members = changes
            .iter()
            .filter(|(_, appointment, _, _)| {
                appointment.booking_group_id.as_deref() == Some(group_id.as_str())
                    && appointment.status != "cancelled"
            })
            .map(|(_, appointment, _, _)| appointment.id.clone())
            .collect::<Vec<_>>();
        sqlx::query(
            "INSERT INTO booking_groups(id,tenant_id,branch_id,group_name,members_json,status,consolidated_billing,booking_type,host_client_id,group_notes,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,'confirmed',FALSE,$6,$7,$8,NOW(),NOW())
             ON CONFLICT(id) DO UPDATE SET group_name=EXCLUDED.group_name,members_json=EXCLUDED.members_json,
               booking_type=EXCLUDED.booking_type,host_client_id=EXCLUDED.host_client_id,group_notes=EXCLUDED.group_notes,updated_at=NOW()",
        )
        .bind(group_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(if payload.group_name.trim().is_empty() { "booking-group" } else { payload.group_name.trim() })
        .bind(service_ids_to_json(&members))
        .bind(booking_type)
        .bind(payload.host_client_id.trim())
        .bind(payload.group_notes.trim())
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("failed to save booking group"))?;
    }
    if let Some(payment) = advance_payment {
        let appointment_id = changes
            .first()
            .map(|(_, appointment, _, _)| appointment.id.as_str())
            .ok_or_else(|| ApiError::internal("booking advance has no appointment"))?;
        let payment_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO appointment_payment_links (
                id, tenant_id, branch_id, appointment_id, provider, provider_payment_id,
                amount_paise, status, idempotency_key, payload_json, paid_at, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,'paid',$8,$9,NOW(),NOW(),NOW())",
        )
        .bind(&payment_id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(appointment_id)
        .bind(&payment.method)
        .bind(&payment.reference)
        .bind(payment.amount_paise)
        .bind(format!("crm-booking-advance:{appointment_id}"))
        .bind(json!({
            "source": "crm_appointment_booking",
            "collectedByUserId": actor_user_id.unwrap_or_default(),
            "settlementType": payment.settlement_type,
            "accountedAtCollection": true,
        }))
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal("failed to save booking advance"))?;
        if payment.settlement_type == "cash" {
            cash_drawer_service::record_booking_cash_advance(
                &mut tx,
                &tenant_id,
                &branch_id,
                actor_user_id.unwrap_or_default(),
                current_business_date(),
                &payment_id,
                payment.amount_paise,
                &payment.cash_drawer_till_id,
            )
            .await
            .map_err(|_| {
                ApiError::conflict("cash advance requires an open cash drawer and till")
            })?;
        }
        if matches!(
            payment.settlement_type.as_str(),
            "wallet" | "store_credit" | "gift_card"
        ) {
            wallet_service::settle_booking_advance(
                &mut tx,
                &tenant_id,
                &branch_id,
                client_id,
                appointment_id,
                &payment_id,
                &payment.settlement_type,
                &payment.reference,
                payment.amount_paise,
            )
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
        } else {
            accounting_service::post_pos_advance(
                &mut tx,
                &tenant_id,
                &branch_id,
                &payment_id,
                &payment.settlement_type,
                payment.amount_paise,
            )
            .await
            .map_err(|_| ApiError::internal("failed to account for booking advance"))?;
        }
    }
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to save booking"))?;

    for (previous, updated, action, reason) in &changes {
        let _ = insert_activity(
            &state,
            &tenant_id,
            previous.as_ref(),
            updated,
            action,
            reason,
        )
        .await;
    }
    Ok(Json(
        changes
            .into_iter()
            .map(|(_, updated, _, _)| updated)
            .collect(),
    ))
}

pub async fn list_appointments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListAppointmentQuery>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );

    let status_filter = query
        .status
        .unwrap_or_else(|| "all".to_string())
        .to_lowercase();
    let rows = sqlx::query(
        "SELECT id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2
         ORDER BY start_at DESC LIMIT 200",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to query appointments"))?;

    let mut appointments = rows
        .into_iter()
        .map(|row| build_appointment(&row))
        .collect::<Result<Vec<_>, _>>()?;
    let consumption_statuses = sqlx::query_as::<_, (String, String)>(r#"
        SELECT appointment.id,
          CASE
            WHEN EXISTS(
              SELECT 1 FROM inventory_backbar_usage usage
              WHERE usage.tenant_id=appointment.tenant_id AND usage.branch_id=appointment.branch_id
                AND usage.appointment_id=appointment.id AND usage.status='pending_approval'
            ) THEN 'pending_approval'
            WHEN COALESCE((SELECT settings_json #> '{recipeInventory,requireRecipeForService}'='true'::JSONB
                           FROM service_settings WHERE tenant_id=appointment.tenant_id AND branch_id=appointment.branch_id),FALSE)
              AND EXISTS(
                SELECT 1 FROM appointment_service_recipe_snapshots snapshot
                WHERE snapshot.tenant_id=appointment.tenant_id AND snapshot.branch_id=appointment.branch_id
                  AND snapshot.appointment_id=appointment.id AND jsonb_array_length(snapshot.recipe_json)=0
              ) THEN 'missing_recipe'
            WHEN EXISTS(
              SELECT 1
              FROM appointment_service_recipe_snapshots snapshot
              CROSS JOIN LATERAL jsonb_array_elements(snapshot.recipe_json) recipe
              WHERE snapshot.tenant_id=appointment.tenant_id AND snapshot.branch_id=appointment.branch_id
                AND snapshot.appointment_id=appointment.id
                AND COALESCE((recipe->>'trackAutomatically')::BOOLEAN,TRUE)=FALSE
                AND NOT EXISTS(
                  SELECT 1 FROM inventory_backbar_usage usage
                  WHERE usage.tenant_id=snapshot.tenant_id AND usage.branch_id=snapshot.branch_id
                    AND usage.appointment_id=snapshot.appointment_id AND usage.service_id=snapshot.service_id
                    AND usage.inventory_item_id=COALESCE(recipe->>'productId',recipe->>'itemId',recipe->>'inventoryItemId')
                    AND usage.status='recorded'
                )
            ) THEN 'pending_usage'
            WHEN EXISTS(
              SELECT 1 FROM inventory_backbar_usage usage
              WHERE usage.tenant_id=appointment.tenant_id AND usage.branch_id=appointment.branch_id
                AND usage.appointment_id=appointment.id AND usage.sale_id IS NOT NULL AND usage.status='recorded'
            ) THEN 'posted'
            WHEN EXISTS(
              SELECT 1 FROM appointment_service_recipe_snapshots snapshot
              WHERE snapshot.tenant_id=appointment.tenant_id AND snapshot.branch_id=appointment.branch_id
                AND snapshot.appointment_id=appointment.id AND jsonb_array_length(snapshot.recipe_json)>0
            ) THEN 'ready'
            ELSE 'not_required'
          END
        FROM appointments appointment
        WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
        ORDER BY appointment.start_at DESC LIMIT 200
    "#)
    .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
    .map_err(|_|ApiError::internal("failed to load appointment consumption status"))?
    .into_iter().collect::<std::collections::HashMap<_,_>>();
    for appointment in &mut appointments {
        appointment.inventory_consumption_status =
            consumption_statuses.get(&appointment.id).cloned();
    }
    let recipe_snapshots=sqlx::query_as::<_,(String,Value)>("SELECT appointment_id,jsonb_agg(jsonb_build_object('serviceId',service_id,'versionNumber',recipe_version_number,'recipe',recipe_json) ORDER BY service_id) FROM appointment_service_recipe_snapshots WHERE tenant_id=$1 AND branch_id=$2 GROUP BY appointment_id")
        .bind(&tenant_id).bind(&branch_id).fetch_all(&state.db).await
        .map_err(|_|ApiError::internal("failed to load appointment recipe snapshots"))?
        .into_iter().collect::<std::collections::HashMap<_,_>>();
    for appointment in &mut appointments {
        appointment.inventory_recipe_snapshots = recipe_snapshots.get(&appointment.id).cloned();
    }

    if status_filter != "all" {
        appointments.retain(|appointment| appointment.status == status_filter);
    }
    if let Some(client_id) = query.client_id.as_ref() {
        appointments.retain(|appointment| appointment.client_id == *client_id);
    }

    Ok(Json(appointments))
}

async fn get_appointment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(appointment))
}

async fn update_appointment_notes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AppointmentNotesPayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let row = sqlx::query(
        "UPDATE appointments
         SET notes=$1, version=version+1, updated_at=$2
         WHERE id=$3 AND tenant_id=$4 AND branch_id=$5
         RETURNING id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(payload.notes.trim())
    .bind(Utc::now())
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to update appointment notes"))?;
    let updated = build_appointment(&row)?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &updated,
        "BOOKING_UPDATED",
        "notes updated",
    )
    .await?;
    Ok(Json(updated))
}

pub async fn set_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StatusPayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    match normalize_status(&payload.status).ok().as_deref() {
        Some("cancelled") => {
            let response =
                cancel_appointment(State(state), headers, Path(id), Json(payload)).await?;
            return Ok(Json(response.0.appointment));
        }
        Some("completed") => {
            let response =
                complete_appointment(State(state), headers, Path(id), Json(payload)).await?;
            return Ok(Json(response.0.appointment));
        }
        _ => {}
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let status = normalize_status(&payload.status).unwrap_or_else(|_| current.status.clone());
    if current.status == status {
        return Ok(Json(current));
    }
    let booking_group_id = current.booking_group_id.clone().unwrap_or_default();
    let apply_group = payload.apply_group && !booking_group_id.trim().is_empty();
    let result = sqlx::query(
        "UPDATE appointments
         SET status=$1, notes = CASE WHEN COALESCE($2,'') = '' THEN notes ELSE COALESCE(notes,'') || ' | ' || $2 END, version = version + 1, updated_at=$3
         WHERE tenant_id=$5 AND branch_id=$6
           AND (id=$4 OR ($7 AND booking_group_id=$8)) AND status<>$1",
    )
    .bind(&status)
    .bind(if payload.reason.is_empty() { None::<String> } else { Some(payload.reason.clone()) })
    .bind(Utc::now())
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(apply_group)
    .bind(&booking_group_id)
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to update appointment status"))?;

    let updated = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    if result.rows_affected() == 0 {
        return Ok(Json(updated));
    }
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &updated,
        activity_action_for_status(&updated.status),
        "",
    )
    .await?;
    if updated.status == "no-show" {
        record_configured_appointment_fee(
            &state,
            &updated,
            "no_show",
            "pending",
            &payload.reason,
            "",
        )
        .await?;
    }
    Ok(Json(updated))
}

pub async fn cancel_appointment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StatusPayload>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    cancel_appointment_inner(&state, &headers, &id, &payload, true).await
}

async fn cancel_appointment_inner(
    state: &AppState,
    headers: &HeaderMap,
    id: &str,
    payload: &StatusPayload,
    include_booking_group: bool,
) -> Result<Json<AppointmentResponse>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    if status_is_closed(&current.status) {
        return Err(ApiError::conflict(
            "Completed/billed/paid/cancelled appointments cannot be cancelled",
        ));
    }
    let booking_group_id = current
        .booking_group_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .to_string();
    let apply_group = include_booking_group && !booking_group_id.is_empty();
    let before_rows = sqlx::query(
        "SELECT id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2
           AND (id=$3 OR ($4::boolean AND booking_group_id=$5))
           AND status NOT IN ('cancelled','no-show')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(apply_group)
    .bind(&booking_group_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking group for cancellation"))?;
    let before = before_rows
        .iter()
        .map(build_appointment)
        .collect::<Result<Vec<_>, _>>()?;
    if before
        .iter()
        .any(|appointment| matches!(appointment.status.as_str(), "completed" | "paid"))
    {
        return Err(ApiError::conflict(
            "Completed or paid appointments cannot be cancelled",
        ));
    }
    let appointment_ids = before
        .iter()
        .map(|appointment| appointment.id.clone())
        .collect::<Vec<_>>();
    let has_usage = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM inventory_backbar_usage WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=ANY($3) AND status IN ('recorded','pending_approval'))")
        .bind(&tenant_id).bind(&branch_id).bind(&appointment_ids)
        .fetch_one(&state.db).await
        .map_err(|_|ApiError::internal("failed to validate appointment consumption"))?;
    if has_usage {
        return Err(ApiError::conflict(
            "Reject pending usage or post a manager-approved usage reversal before cancelling the appointment",
        ));
    }
    let notes = if payload.reason.is_empty() {
        "cancelled".to_string()
    } else {
        format!("cancellation reason: {}", payload.reason)
    };
    let updated_rows = sqlx::query(
        "UPDATE appointments
         SET status='cancelled', notes=COALESCE(notes,'') || $1, version=version+1, updated_at=$2
         WHERE tenant_id=$3 AND branch_id=$4
           AND (id=$5 OR ($6::boolean AND booking_group_id=$7))
           AND status NOT IN ('cancelled','no-show')
         RETURNING id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(format!(" | {}", notes))
    .bind(Utc::now())
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(apply_group)
    .bind(&booking_group_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to cancel appointment"))?;
    let updated_rows = updated_rows
        .iter()
        .map(build_appointment)
        .collect::<Result<Vec<_>, _>>()?;
    let updated = updated_rows
        .iter()
        .find(|appointment| appointment.id == id)
        .ok_or_else(|| ApiError::not_found("Appointment not found"))?;
    for appointment in &updated_rows {
        let old = before.iter().find(|previous| previous.id == appointment.id);
        insert_activity(
            &state,
            &tenant_id,
            old,
            appointment,
            "CANCELLED",
            &payload.reason,
        )
        .await?;
        record_configured_appointment_fee(
            state,
            appointment,
            "cancellation",
            "pending",
            &payload.reason,
            "",
        )
        .await?;
    }
    let mut waitlist_offers = Vec::new();
    for appointment in &updated_rows {
        if let Some(offer) = offer_waitlist_for_cancelled_appointment(&state, appointment).await? {
            waitlist_offers.push(offer);
        }
    }
    Ok(Json(AppointmentResponse {
        appointment: updated.clone(),
        waitlist_offer: waitlist_offers.into_iter().next(),
        sales_order: None,
    }))
}

async fn configured_appointment_fee(
    state: &AppState,
    appointment: &AppointmentPayload,
    fee_type: &str,
) -> Result<(i64, i32, bool), ApiError> {
    let row = sqlx::query(
        "SELECT COALESCE(SUM(cancellation_fee_paise),0)::BIGINT amount_paise,COALESCE(MAX(cancellation_cutoff_hours),0)::INTEGER cutoff_hours FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=ANY($3)",
    )
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&appointment.service_ids)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment fee policy"))?;
    let amount = row.try_get::<i64, _>("amount_paise").unwrap_or(0);
    let cutoff = row.try_get::<i32, _>("cutoff_hours").unwrap_or(0);
    let start_at = parse_datetime(&appointment.start_at, "appointment.start_at")?;
    let due = amount > 0
        && (fee_type == "no_show"
            || cutoff == 0
            || start_at <= Utc::now() + Duration::hours(i64::from(cutoff)));
    Ok((amount, cutoff, due))
}

async fn record_configured_appointment_fee(
    state: &AppState,
    appointment: &AppointmentPayload,
    fee_type: &str,
    status: &str,
    reason: &str,
    actor_user_id: &str,
) -> Result<Option<Value>, ApiError> {
    let (amount, _, due) = configured_appointment_fee(state, appointment, fee_type).await?;
    if !due {
        return Ok(None);
    }
    let row = sqlx::query_scalar::<_, Value>(
        "INSERT INTO appointment_fee_events(tenant_id,branch_id,appointment_id,fee_type,configured_paise,status,reason,actor_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,branch_id,appointment_id,fee_type) DO UPDATE SET configured_paise=EXCLUDED.configured_paise,reason=CASE WHEN EXCLUDED.reason='' THEN appointment_fee_events.reason ELSE EXCLUDED.reason END,actor_user_id=CASE WHEN EXCLUDED.actor_user_id='' THEN appointment_fee_events.actor_user_id ELSE EXCLUDED.actor_user_id END,updated_at=NOW() WHERE appointment_fee_events.status='pending' RETURNING jsonb_build_object('id',id,'feeType',fee_type,'configuredPaise',configured_paise,'status',status,'reason',reason,'updatedAt',updated_at)",
    )
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&appointment.id)
    .bind(fee_type)
    .bind(amount)
    .bind(status)
    .bind(reason.trim())
    .bind(actor_user_id)
    .bind(format!("appointment-fee:{}:{fee_type}", appointment.id))
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to record appointment fee"))?;
    Ok(row)
}

async fn appointment_fee_policy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let fee_type = if appointment.status == "no-show" {
        "no_show"
    } else {
        "cancellation"
    };
    let (amount, cutoff, due) = configured_appointment_fee(&state, &appointment, fee_type).await?;
    let event = sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('id',id,'feeType',fee_type,'configuredPaise',configured_paise,'status',status,'reason',reason,'updatedAt',updated_at) FROM appointment_fee_events WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND fee_type=$4")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(fee_type).fetch_optional(&state.db).await
        .map_err(|_|ApiError::internal("failed to load appointment fee event"))?;
    Ok(Json(
        json!({"feeType":fee_type,"amountPaise":amount,"cutoffHours":cutoff,"due":due,"event":event}),
    ))
}

async fn waive_appointment_fee(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<AppointmentFeeWaiverPayload>,
) -> Result<Json<Value>, ApiError> {
    if !privileged_appointment_permission(Some(&claims), "appointments.fees.waive") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "appointment fee waiver permission is required",
        ));
    }
    if !(3..=500).contains(&payload.reason.trim().chars().count()) {
        return Err(ApiError::bad_request(
            "waiver reason must be between 3 and 500 characters",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let fee_type = match appointment.status.as_str() {
        "cancelled" => "cancellation",
        "no-show" => "no_show",
        _ => {
            return Err(ApiError::conflict(
                "only cancelled or no-show appointment fees can be waived",
            ))
        }
    };
    let (amount, _, due) = configured_appointment_fee(&state, &appointment, fee_type).await?;
    if !due {
        return Err(ApiError::conflict(
            "this appointment has no configured fee to waive",
        ));
    }
    let event = sqlx::query_scalar::<_,Value>("INSERT INTO appointment_fee_events(tenant_id,branch_id,appointment_id,fee_type,configured_paise,status,reason,actor_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'waived',$6,$7,$8) ON CONFLICT(tenant_id,branch_id,appointment_id,fee_type) DO UPDATE SET status='waived',reason=EXCLUDED.reason,actor_user_id=EXCLUDED.actor_user_id,updated_at=NOW() WHERE appointment_fee_events.status IN ('pending','waived') RETURNING jsonb_build_object('id',id,'feeType',fee_type,'configuredPaise',configured_paise,'status',status,'reason',reason,'updatedAt',updated_at)")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(fee_type).bind(amount).bind(payload.reason.trim()).bind(&claims.sub).bind(format!("appointment-fee:{id}:{fee_type}"))
        .fetch_optional(&state.db).await.map_err(|_|ApiError::internal("failed to waive appointment fee"))?
        .ok_or_else(||ApiError::conflict("a charged fee must be refunded or voided before waiver"))?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&appointment),
        &appointment,
        "FEE_WAIVED",
        payload.reason.trim(),
    )
    .await?;
    Ok(Json(event))
}

async fn charge_appointment_fee(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<NoShowChargePayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let fee_type = match appointment.status.as_str() {
        "cancelled" => "cancellation",
        "no-show" => "no_show",
        _ => {
            return Err(ApiError::conflict(
                "mark the appointment cancelled or no-show before charging a fee",
            ))
        }
    };
    let (amount, _, due) = configured_appointment_fee(&state, &appointment, fee_type).await?;
    if !due || payload.amount_paise != amount {
        return Err(ApiError::bad_request(
            "fee amount must match the configured appointment policy",
        ));
    }
    let fee_status = sqlx::query_scalar::<_, String>("SELECT status FROM appointment_fee_events WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND fee_type=$4")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(fee_type).fetch_optional(&state.db).await
        .map_err(|_|ApiError::internal("failed to validate appointment fee state"))?;
    if fee_status
        .as_deref()
        .is_some_and(|status| matches!(status, "waived" | "reversed"))
    {
        return Err(ApiError::conflict(
            "a waived or reversed fee cannot be charged",
        ));
    }
    let charge = pos::create_appointment_fee_charge(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        &appointment.client_id,
        &appointment.staff_id,
        amount,
        &payload.provider,
        &payload.idempotency_key,
        fee_type,
    )
    .await
    .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let event=sqlx::query_scalar::<_,Value>("INSERT INTO appointment_fee_events(tenant_id,branch_id,appointment_id,fee_type,configured_paise,status,reason,actor_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'charged',$6,$7,$8) ON CONFLICT(tenant_id,branch_id,appointment_id,fee_type) DO UPDATE SET status='charged',reason=EXCLUDED.reason,actor_user_id=EXCLUDED.actor_user_id,updated_at=NOW() WHERE appointment_fee_events.status IN ('pending','charged') RETURNING jsonb_build_object('id',id,'feeType',fee_type,'configuredPaise',configured_paise,'status',status,'reason',reason,'updatedAt',updated_at)")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(fee_type).bind(amount).bind(payload.reason.trim()).bind(&claims.sub).bind(format!("appointment-fee:{id}:{fee_type}"))
        .fetch_optional(&state.db).await.map_err(|_|ApiError::internal("failed to record charged appointment fee"))?
        .ok_or_else(||ApiError::conflict("a waived fee cannot be charged"))?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&appointment),
        &appointment,
        "FEE_CHARGED",
        payload.reason.trim(),
    )
    .await?;
    Ok(Json(json!({"charge":charge,"fee":event})))
}

async fn restore_appointment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<RestoreAppointmentPayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    if !(3..=500).contains(&payload.reason.trim().chars().count()) {
        return Err(ApiError::bad_request(
            "restore reason must be between 3 and 500 characters",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    if !matches!(current.status.as_str(), "cancelled" | "no-show") {
        return Err(ApiError::conflict(
            "only cancelled or no-show appointments can be restored",
        ));
    }
    if payload
        .expected_version
        .is_some_and(|version| version != current.version)
    {
        return Err(ApiError::conflict(
            "appointment changed after it was opened; reload before restoring",
        ));
    }
    let start_at = parse_datetime(&current.start_at, "appointment.start_at")?;
    let end_at = parse_datetime(&current.end_at, "appointment.end_at")?;
    if end_at <= Utc::now() {
        return Err(ApiError::conflict("past appointments cannot be restored"));
    }
    let charged=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM appointment_fee_events WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND status='charged')")
        .bind(&tenant_id).bind(&branch_id).bind(&id).fetch_one(&state.db).await.map_err(|_|ApiError::internal("failed to validate appointment fee"))?;
    if charged {
        return Err(ApiError::conflict(
            "refund or void the charged fee before restoring this appointment",
        ));
    }
    validate_branch_operating_hours(
        &state,
        &tenant_id,
        &branch_id,
        start_at,
        end_at,
        &payload.outside_hours_override_reason,
        Some(&claims),
    )
    .await?;
    validate_staff_blackout(
        &state,
        &tenant_id,
        &branch_id,
        &current.staff_id,
        start_at,
        end_at,
    )
    .await?;
    validate_staff_booking_availability(
        &state,
        &tenant_id,
        &branch_id,
        &current.staff_id,
        &current.service_ids,
        start_at,
        end_at,
        Some(&id),
    )
    .await?;
    validate_chair_room_availability(
        &state,
        &tenant_id,
        &branch_id,
        &current.chair_room_id,
        start_at,
        end_at,
        Some(&id),
    )
    .await?;
    let previous_status=sqlx::query_scalar::<_,String>("SELECT old_status FROM appointment_activity WHERE tenant_id=$1 AND appointment_id=$2 AND action IN ('CANCELLED','NO_SHOW') ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(&tenant_id).bind(&id).fetch_optional(&state.db).await.map_err(|_|ApiError::internal("failed to load appointment restore history"))?
        .filter(|status|matches!(status.as_str(),"draft"|"booked"|"confirmed"|"rescheduled"))
        .unwrap_or_else(||"booked".to_string());
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to start appointment restore"))?;
    let row=sqlx::query("UPDATE appointments SET status=$1,notes=COALESCE(notes,'')||$2,version=version+1,updated_at=NOW() WHERE tenant_id=$3 AND branch_id=$4 AND id=$5 AND status IN ('cancelled','no-show') AND ($6::INTEGER IS NULL OR version=$6) RETURNING id,tenant_id,branch_id,client_id,staff_id,requested_staff_id,staff_preference,chair_room_id,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id,version,created_at,updated_at")
        .bind(&previous_status).bind(format!(" | restored: {}",payload.reason.trim())).bind(&tenant_id).bind(&branch_id).bind(&id).bind(payload.expected_version)
        .fetch_optional(&mut *tx).await.map_err(|error|booking_write_error(error,"failed to restore appointment"))?
        .ok_or_else(||ApiError::conflict("appointment changed after it was opened; reload before restoring"))?;
    let restored = build_appointment(&row)?;
    sqlx::query("UPDATE appointment_fee_events SET status='reversed',reason=CONCAT(reason,CASE WHEN reason='' THEN '' ELSE ' | ' END,$4),actor_user_id=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND appointment_id=$3 AND status IN ('pending','waived')")
        .bind(&tenant_id).bind(&branch_id).bind(&id).bind(format!("restored: {}",payload.reason.trim())).bind(&claims.sub).execute(&mut *tx).await
        .map_err(|_|ApiError::internal("failed to reverse appointment fee decision"))?;
    tx.commit()
        .await
        .map_err(|_| ApiError::internal("failed to commit appointment restore"))?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &restored,
        "RESTORED",
        payload.reason.trim(),
    )
    .await?;
    Ok(Json(restored))
}

fn staff_appointment_permission(claims: &AuthClaims, permission: &str) -> bool {
    auth_service::staff_app_permission_allowed(
        claims,
        permission,
        &["owner", "admin", "manager"],
        &[],
    )
}

fn staff_service_permission(claims: &AuthClaims, permission: &str) -> bool {
    auth_service::staff_app_permission_allowed(claims, permission, &["owner", "admin"], &[])
}

fn valid_booking_key(value: &str) -> bool {
    (8..=160).contains(&value.len())
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || b"._:-".contains(&value))
}

async fn staff_appointment_book(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<StaffAppointmentBookQuery>,
) -> Result<Json<Value>, ApiError> {
    if !auth_service::staff_app_permission_allowed(
        &claims,
        "staff.app.appointments.read",
        &["owner", "admin", "manager", "staff"],
        &["appointments.read", "read:appointments"],
    ) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App appointment read permission is required",
        ));
    }
    let from = NaiveDate::parse_from_str(query.from.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::bad_request("from must be YYYY-MM-DD"))?;
    let to = NaiveDate::parse_from_str(query.to.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::bad_request("to must be YYYY-MM-DD"))?;
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let self_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let team_view = matches!(query.view.trim(), "staff" | "resource")
        || (!query.staff_id.trim().is_empty() && query.staff_id.trim() != self_staff_id);
    let team_read = staff_appointment_permission(&claims, "staff.app.appointments.team.read");
    let team_manage = staff_appointment_permission(&claims, "staff.app.appointments.team.manage");
    if team_view && !team_read {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff calendar permission is required",
        ));
    }
    if to < from || (to - from).num_days() > if team_view { 0 } else { 6 } {
        return Err(ApiError::bad_request(if team_view {
            "staff and resource calendars support one day at a time"
        } else {
            "own calendar range must be one to seven days"
        }));
    }
    let mut response = staff_app_service::appointment_book(
        &state.db,
        &tenant_id,
        &branch_id,
        &self_staff_id,
        query.staff_id.trim(),
        from,
        to,
        query.status.trim(),
        query.q.trim(),
        team_view,
        team_manage,
    )
    .await
    .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    response["permissions"] = json!({
        "manage": auth_service::staff_app_permission_allowed(
            &claims,
            "staff.app.appointments.manage",
            &["owner", "admin", "manager", "staff"],
            &["appointments.manage", "write:appointments"],
        ),
        "teamRead": team_read,
        "teamManage": team_manage,
        "priceManage": staff_appointment_permission(&claims, "staff.app.appointments.price.manage"),
        "clientCreate": auth_service::staff_app_permission_allowed(
            &claims,
            "clients.manage",
            &["owner", "admin", "manager"],
            &["write:clients"],
        )
    });
    Ok(Json(response))
}

async fn staff_appointment_eligibility(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !auth_service::staff_app_permission_allowed(
        &claims,
        "staff.app.appointments.read",
        &["owner", "admin", "manager", "staff"],
        &["appointments.read", "read:appointments"],
    ) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App appointment read permission is required",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let eligibility = pos::read_client_kpi(&state, &tenant_id, &branch_id, client_id.trim())
        .await
        .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?
        .ok_or_else(|| ApiError::not_found("Guest not found"))?;
    Ok(Json(json!(eligibility)))
}

async fn quote_self_appointment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(mut payload): Json<AppointmentBatchPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let self_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let team_manage = staff_appointment_permission(&claims, "staff.app.appointments.team.manage");
    let price_manage = staff_appointment_permission(&claims, "staff.app.appointments.price.manage");
    if payload.lines.is_empty() {
        return Err(ApiError::bad_request("at least one service is required"));
    }
    let mut quotes = Vec::with_capacity(payload.lines.len());
    for line in &mut payload.lines {
        if line.staff_id.trim().is_empty() {
            line.staff_id = self_staff_id.clone();
        }
        if line.staff_id != self_staff_id && !team_manage {
            return Err(ApiError::with_status(
                StatusCode::FORBIDDEN,
                "Team appointment manage permission is required",
            ));
        }
        let start_at = parse_datetime(&line.start_at, "start_at")?;
        let end_at = parse_datetime(&line.end_at, "end_at")?;
        if end_at <= start_at {
            return Err(ApiError::bad_request("end_at must be after start_at"));
        }
        let selection = AppointmentServiceSelection {
            service_id: line.service_id.trim().to_string(),
            variant_id: line.variant_id.trim().to_string(),
            addon_ids: line.addon_ids.clone(),
        };
        validate_staff_blackout(
            &state,
            &tenant_id,
            &branch_id,
            &line.staff_id,
            start_at,
            end_at,
        )
        .await?;
        validate_staff_booking_availability(
            &state,
            &tenant_id,
            &branch_id,
            &line.staff_id,
            &[selection.service_id.clone()],
            start_at,
            end_at,
            (!line.appointment_id.trim().is_empty()).then_some(line.appointment_id.as_str()),
        )
        .await?;
        validate_chair_room_availability(
            &state,
            &tenant_id,
            &branch_id,
            &line.chair_room_id,
            start_at,
            end_at,
            (!line.appointment_id.trim().is_empty()).then_some(line.appointment_id.as_str()),
        )
        .await?;
        validate_service_resource_requirement(
            &state,
            &tenant_id,
            &branch_id,
            &[selection.service_id.clone()],
            &line.chair_room_id,
        )
        .await?;
        let calculated = validate_service_pricing(
            &state,
            &tenant_id,
            &branch_id,
            &line.staff_id,
            &[selection.service_id.clone()],
            std::slice::from_ref(&selection),
            start_at,
            &payload.client_id,
            "staffApp",
        )
        .await?;
        let price = if let Some(price) = line.price_override_paise {
            if !price_manage {
                return Err(ApiError::with_status(
                    StatusCode::FORBIDDEN,
                    "Appointment price override permission is required",
                ));
            }
            if !(0..=100_000_000).contains(&price)
                || !(3..=500).contains(&line.price_override_reason.trim().chars().count())
            {
                return Err(ApiError::bad_request(
                    "price override and a 3-500 character reason are required",
                ));
            }
            price
        } else {
            calculated
        };
        quotes.push(json!({"appointmentId":line.appointment_id,"serviceId":line.service_id,"pricePaise":price,"calculatedPricePaise":calculated}));
    }
    let eligibility =
        pos::read_client_kpi(&state, &tenant_id, &branch_id, payload.client_id.trim())
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let total_paise = quotes
        .iter()
        .filter_map(|row| row["pricePaise"].as_i64())
        .sum::<i64>();
    let deposit = booking_service::deposit_quote(&state.db, &tenant_id, &branch_id, total_paise)
        .await
        .map_err(|_| ApiError::internal("failed to load booking deposit policy"))?
        .as_json();
    Ok(Json(json!({
        "lines":quotes,
        "totalPaise":total_paise,
        "eligibility":eligibility,
        "deposit":deposit
    })))
}

async fn save_self_appointment_batch(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(mut payload): Json<AppointmentBatchPayload>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    if !auth_service::staff_app_permission_allowed(
        &claims,
        "staff.app.appointments.manage",
        &["owner", "admin", "manager", "staff"],
        &["appointments.manage", "write:appointments"],
    ) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App appointment manage permission is required",
        ));
    }
    let key = payload.idempotency_key.trim().to_string();
    if !valid_booking_key(&key) {
        return Err(ApiError::bad_request(
            "idempotencyKey must be 8-160 letters, numbers, '.', '_', ':', or '-'",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let self_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let team_manage = staff_appointment_permission(&claims, "staff.app.appointments.team.manage");
    for line in &mut payload.lines {
        if line.staff_id.trim().is_empty() {
            line.staff_id = self_staff_id.clone();
        }
        if line.staff_id != self_staff_id && !team_manage {
            return Err(ApiError::with_status(
                StatusCode::FORBIDDEN,
                "Team appointment manage permission is required",
            ));
        }
    }
    if !team_manage {
        for appointment_id in payload
            .removed_appointment_ids
            .iter()
            .chain(payload.lines.iter().map(|line| &line.appointment_id))
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            let current = find_appointment(&state, &tenant_id, &branch_id, appointment_id).await?;
            if current.staff_id != self_staff_id {
                return Err(ApiError::not_found("Appointment not found"));
            }
        }
    }
    let lock_scope = format!("{tenant_id}:{branch_id}:{key}");
    let mut lock = state
        .db
        .acquire()
        .await
        .map_err(|_| ApiError::internal("failed to acquire booking save lock"))?;
    sqlx::query("SELECT pg_advisory_lock(hashtextextended($1,0))")
        .bind(&lock_scope)
        .execute(&mut *lock)
        .await
        .map_err(|_| ApiError::internal("failed to lock booking save"))?;
    let replay = sqlx::query(
        "SELECT id,tenant_id,branch_id,client_id,staff_id,requested_staff_id,staff_preference,chair_room_id,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id,version,created_at,updated_at FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND last_mutation_key=$3 ORDER BY created_at,id",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&key)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to replay booking save"))?;
    let result = if replay.is_empty() {
        save_appointment_batch_inner(state.clone(), headers, payload, Some(claims)).await
    } else {
        replay
            .iter()
            .map(build_appointment)
            .collect::<Result<Vec<_>, _>>()
            .map(Json)
    };
    let _ = sqlx::query("SELECT pg_advisory_unlock(hashtextextended($1,0))")
        .bind(&lock_scope)
        .execute(&mut *lock)
        .await;
    result
}

async fn set_self_appointment_status(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut payload): Json<StatusPayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    self_appointment(&state, &claims, &headers, &id).await?;
    payload.status = match payload.status.trim() {
        "confirmed" => "confirmed",
        "arrived" | "check-in" => "arrived",
        "no-show" => "no-show",
        _ => {
            return Err(ApiError::bad_request(
                "status must be confirmed, arrived, or no-show",
            ))
        }
    }
    .to_string();
    if payload.status == "no-show" && !(3..=500).contains(&payload.reason.trim().chars().count()) {
        return Err(ApiError::bad_request(
            "no-show reason must be between 3 and 500 characters",
        ));
    }
    if payload.reason.trim().is_empty() {
        payload.reason = if payload.status == "arrived" {
            "check-in"
        } else {
            "provider confirmed"
        }
        .to_string();
    }
    set_status(State(state), headers, Path(id), Json(payload)).await
}

async fn staff_self_appointment_operations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !auth_service::staff_app_permission_allowed(
        &claims,
        "staff.app.appointments.read",
        &["owner", "admin", "manager", "staff"],
        &["appointments.read", "read:appointments"],
    ) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App appointment read permission is required",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let self_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    if appointment.staff_id != self_staff_id
        && !staff_appointment_permission(&claims, "staff.app.appointments.team.read")
    {
        return Err(ApiError::not_found("Appointment not found"));
    }
    let activity = read_audit(&state, &tenant_id, &id).await?;
    let visits = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'id',visit.id,'startAt',visit.start_at,'status',visit.status,
          'staffId',visit.staff_id,
          'serviceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name) FROM services service
            WHERE service.tenant_id=visit.tenant_id AND service.branch_id=visit.branch_id
              AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(visit.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb))
        FROM appointments visit WHERE visit.tenant_id=$1 AND visit.branch_id=$2 AND visit.client_id=$3 AND visit.id<>$4
        ORDER BY ABS(EXTRACT(EPOCH FROM (visit.start_at-$5))) LIMIT 6"#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(&appointment.client_id).bind(&id)
    .bind(parse_datetime(&appointment.start_at, "appointment.start_at")?)
    .fetch_all(&state.db).await.map_err(|_| ApiError::internal("failed to load adjacent visits"))?;
    let forms = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'required',COUNT(*)>0,
          'complete',COUNT(*)=COUNT(*) FILTER(WHERE EXISTS(
            SELECT 1 FROM client_form_submissions submission
            WHERE submission.tenant_id=guard.tenant_id AND submission.branch_id=guard.branch_id
              AND submission.client_id=$4 AND submission.definition_id=guard.consultation_form_definition_id)),
          'requiredCount',COUNT(*),
          'completedCount',COUNT(*) FILTER(WHERE EXISTS(
            SELECT 1 FROM client_form_submissions submission
            WHERE submission.tenant_id=guard.tenant_id AND submission.branch_id=guard.branch_id
              AND submission.client_id=$4 AND submission.definition_id=guard.consultation_form_definition_id)))
        FROM service_booking_guards guard WHERE guard.tenant_id=$1 AND guard.branch_id=$2
          AND (guard.requires_consultation OR guard.requires_patch_test)
          AND guard.service_id IN (SELECT jsonb_array_elements_text($3::jsonb))"#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(service_ids_to_json(&appointment.service_ids)).bind(&appointment.client_id)
    .fetch_one(&state.db).await.map_err(|_| ApiError::internal("failed to load appointment forms status"))?;
    let consumables = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'required',EXISTS(SELECT 1 FROM appointment_service_recipe_snapshots snapshot WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.appointment_id=$3 AND jsonb_array_length(snapshot.recipe_json)>0),
          'pendingApproval',EXISTS(SELECT 1 FROM inventory_backbar_usage usage WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.appointment_id=$3 AND usage.status='pending_approval'),
          'recorded',EXISTS(SELECT 1 FROM inventory_backbar_usage usage WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.appointment_id=$3 AND usage.status='recorded'))"#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id)
    .fetch_one(&state.db).await.map_err(|_| ApiError::internal("failed to load appointment consumables status"))?;
    let checkout_reference =
        pos::canonical_appointment_reference(&state, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| ApiError::internal("failed to resolve checkout state"))?;
    let sale = pos::find_appointment_pos_sale(&state, &headers, &checkout_reference).await
        .map_err(|_| ApiError::internal("failed to load checkout state"))?
        .map(|sale| json!({"saleId":sale.sale_id,"status":sale.status,"totalPaise":sale.total_paise}));
    Ok(Json(json!({
        "appointment":appointment,"activity":activity,"adjacentVisits":visits,
        "forms":forms,"consumables":consumables,"checkout":sale,
        "permissions":{"teamManage":staff_appointment_permission(&claims,"staff.app.appointments.team.manage")}
    })))
}

async fn staff_self_service_workspace(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<StaffServiceWorkspaceQuery>,
) -> Result<Json<Value>, ApiError> {
    if !staff_service_permission(&claims, "staff.app.service.read") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App service workspace permission is required",
        ));
    }
    if query.q.trim().chars().count() > 100 || query.barcode.trim().chars().count() > 120 {
        return Err(ApiError::bad_request(
            "product search must be at most 100 characters and barcode at most 120 characters",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let self_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    if appointment.staff_id != self_staff_id
        && !staff_appointment_permission(&claims, "staff.app.appointments.team.read")
    {
        return Err(ApiError::not_found("Appointment not found"));
    }

    let visit = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'providerInstructions',COALESCE(appointment.notes,''),
          'serviceSelections',COALESCE(appointment.service_selections_json,'{}'::jsonb),
          'resource',COALESCE((SELECT jsonb_build_object('id',resource.id,'name',resource.name,'kind',resource.kind,'department',resource.department)
            FROM appointment_resources resource WHERE resource.tenant_id=appointment.tenant_id AND resource.branch_id=appointment.branch_id AND resource.id=appointment.chair_room_id),'{}'::jsonb),
          'services',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',service.id,'name',service.name,'category',service.category,'durationMinutes',service.duration_minutes,
            'bookedPricePaise',COALESCE((appointment.booked_service_prices_json->>selected.service_id)::bigint,service.price_paise::bigint),
            'variant',COALESCE((SELECT jsonb_build_object('id',variant.id,'name',variant.name,'durationDeltaMinutes',variant.duration_delta_minutes)
              FROM service_variants variant WHERE variant.tenant_id=appointment.tenant_id AND variant.branch_id=appointment.branch_id
                AND variant.service_id=service.id AND variant.id=NULLIF(appointment.service_selections_json->selected.service_id->>'variantId','')),'{}'::jsonb),
            'addons',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',addon.id,'name',addon.name,'durationMinutes',addon.duration_minutes,'pricePaise',addon.price_paise) ORDER BY addon.name,addon.id)
              FROM service_addons addon WHERE addon.tenant_id=appointment.tenant_id AND addon.branch_id=appointment.branch_id
                AND addon.service_id=service.id AND addon.active=TRUE AND addon.id IN (SELECT jsonb_array_elements_text(COALESCE(appointment.service_selections_json->selected.service_id->'addonIds','[]'::jsonb)))),'[]'::jsonb)
          ) ORDER BY selected.ordinality)
          FROM jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb) WITH ORDINALITY selected(service_id,ordinality)
          JOIN services service ON service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id=selected.service_id),'[]'::jsonb)
        ) FROM appointments appointment WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.id=$3"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load service workspace"))?;

    let recipes = sqlx::query_scalar::<_, Value>(
        r#"WITH selected AS (
          SELECT service.id AS service_id,service.name AS service_name,
                 COALESCE(snapshot.recipe_json,service.product_consumption_json,'[]'::jsonb) AS recipe
          FROM appointments appointment
          JOIN LATERAL jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb) requested(service_id) ON TRUE
          JOIN services service ON service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id=requested.service_id
          LEFT JOIN appointment_service_recipe_snapshots snapshot ON snapshot.tenant_id=appointment.tenant_id AND snapshot.branch_id=appointment.branch_id AND snapshot.appointment_id=appointment.id AND snapshot.service_id=service.id
          WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.id=$3
        ), lines AS (
          SELECT selected.service_id,selected.service_name,entry,
                 COALESCE(NULLIF(entry->>'itemId',''),NULLIF(entry->>'productId',''),NULLIF(entry->>'inventoryItemId','')) AS inventory_item_id
          FROM selected CROSS JOIN LATERAL jsonb_array_elements(selected.recipe) entry
        )
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'serviceId',line.service_id,'serviceName',line.service_name,
          'inventoryItemId',item.id,'itemName',item.name,'unit',item.unit,
          'expectedQuantity',CASE WHEN COALESCE(line.entry->>'standardQty',line.entry->>'quantity',line.entry->>'qty','') ~ '^[0-9]+$' THEN COALESCE(line.entry->>'standardQty',line.entry->>'quantity',line.entry->>'qty')::bigint ELSE 0 END,
          'minQuantity',CASE WHEN COALESCE(line.entry->>'minQty','') ~ '^[0-9]+$' THEN (line.entry->>'minQty')::bigint ELSE 0 END,
          'maxQuantity',CASE WHEN COALESCE(line.entry->>'maxQty','') ~ '^[0-9]+$' THEN (line.entry->>'maxQty')::bigint ELSE 0 END,
          'wastePercent',CASE WHEN COALESCE(line.entry->>'wastePercent','') ~ '^[0-9]+([.][0-9]+)?$' THEN (line.entry->>'wastePercent')::double precision ELSE 0 END,
          'trackAutomatically',COALESCE((line.entry->>'trackAutomatically')::boolean,TRUE),
          'allowManualOverride',COALESCE((line.entry->>'allowManualOverride')::boolean,TRUE),
          'stockQuantity',item.stock_quantity,'reorderPoint',item.reorder_point,
          'lowStock',item.stock_quantity<=item.reorder_point,'batchTracked',item.batch_tracked,
          'batches',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',batch.id,'batchNumber',batch.batch_number,'barcode',batch.barcode,'expiryDate',batch.expiry_date,'quantity',batch.quantity) ORDER BY batch.expiry_date NULLS LAST,batch.received_date,batch.id)
            FROM inventory_batches batch WHERE batch.tenant_id=$1 AND batch.branch_id=$2 AND batch.inventory_item_id=item.id AND batch.quantity>0 AND (batch.expiry_date IS NULL OR batch.expiry_date>=CURRENT_DATE)),'[]'::jsonb)
        ) ORDER BY line.service_name,item.name,item.id),'[]'::jsonb)
        FROM lines line JOIN inventory_items item ON item.tenant_id=$1 AND item.branch_id=$2 AND item.id=line.inventory_item_id AND item.active=TRUE"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load service recipe workspace"))?;

    let products = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id',product.id,'name',product.name,'brand',product.brand,'sku',product.sku,
          'barcode',product.barcode,'barcodes',product.barcodes,'unit',product.unit,
          'availableStock',product.available_stock,'reorderPoint',product.reorder_point,
          'retailPricePaise',product.retail_price_paise,'gstPercent',product.gst_percent,'hsnCode',product.hsn_code,
          'previouslyPurchased',product.previously_purchased
        ) ORDER BY product.previously_purchased DESC,product.name,product.id),'[]'::jsonb)
        FROM (
          SELECT item.id,item.name,item.brand,item.sku,item.barcode,item.unit,item.reorder_point,
                 item.retail_price_paise,item.gst_percent,item.hsn_code,
                 COALESCE((SELECT array_agg(code.barcode ORDER BY code.is_primary DESC,code.created_at,code.id) FROM inventory_item_barcodes code
                   WHERE code.tenant_id=item.tenant_id AND code.branch_id=item.branch_id AND code.inventory_item_id=item.id AND code.active),ARRAY[]::text[]) AS barcodes,
                 CASE WHEN item.dual_use_stock THEN GREATEST(item.stock_quantity-COALESCE((SELECT SUM(container.capacity_quantity)::integer FROM inventory_backbar_containers container
                   WHERE container.tenant_id=item.tenant_id AND container.branch_id=item.branch_id AND container.inventory_item_id=item.id AND container.status='sealed'),0),0) ELSE item.stock_quantity END AS available_stock,
                 EXISTS(SELECT 1 FROM pos_sales sale JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
                   WHERE sale.tenant_id=item.tenant_id AND sale.branch_id=item.branch_id AND sale.client_id=$3 AND sale.status NOT IN ('draft','cancelled','voided','refunded') AND line.line_type='product' AND line.item_id=item.id) AS previously_purchased
          FROM inventory_items item
          WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.active=TRUE AND item.product_usage IN ('retail','dual_use')
            AND ($4='' OR LOWER(item.name) LIKE '%'||LOWER($4)||'%' OR LOWER(item.sku) LIKE '%'||LOWER($4)||'%' OR EXISTS(SELECT 1 FROM inventory_item_barcodes code WHERE code.tenant_id=item.tenant_id AND code.branch_id=item.branch_id AND code.inventory_item_id=item.id AND code.active AND LOWER(code.barcode) LIKE '%'||LOWER($4)||'%'))
            AND ($5='' OR UPPER(item.barcode)=UPPER($5) OR EXISTS(SELECT 1 FROM inventory_item_barcodes code WHERE code.tenant_id=item.tenant_id AND code.branch_id=item.branch_id AND code.inventory_item_id=item.id AND code.active AND UPPER(code.barcode)=UPPER($5)))
          ORDER BY previously_purchased DESC,item.name,item.id LIMIT 50
        ) product"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&appointment.client_id)
    .bind(query.q.trim())
    .bind(query.barcode.trim())
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load retail products"))?;

    let offers = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',membership.id,'name',membership.name,'pricePaise',membership.price_paise,'alreadyOwned',EXISTS(
            SELECT 1 FROM client_memberships owned WHERE owned.tenant_id=membership.tenant_id AND owned.branch_id=membership.branch_id AND owned.client_id=$3 AND owned.membership_id=membership.id AND owned.active=TRUE AND (owned.expires_at IS NULL OR owned.expires_at>NOW()))) ORDER BY membership.name,membership.id)
            FROM memberships membership WHERE membership.tenant_id=$1 AND membership.branch_id=$2 AND membership.active=TRUE),'[]'::jsonb),
          'packages',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',package.id,'name',package.name,'pricePaise',package.price_paise,'availableCredits',COALESCE((
            SELECT SUM(credit.remaining_qty)::bigint FROM client_package_credits credit WHERE credit.tenant_id=package.tenant_id AND credit.branch_id=package.branch_id AND credit.client_id=$3 AND credit.package_id=package.id AND credit.remaining_qty>0 AND (credit.expires_at IS NULL OR credit.expires_at>NOW())),0)) ORDER BY package.name,package.id)
            FROM packages package WHERE package.tenant_id=$1 AND package.branch_id=$2 AND package.active=TRUE),'[]'::jsonb)
        )"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&appointment.client_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load membership and package recommendations"))?;

    let usage = inventory_repository::list_backbar_usage(
        &state.db, &tenant_id, &branch_id, None, "", "", &id, 250,
    )
    .await
    .map_err(|_| ApiError::internal("failed to load appointment consumable usage"))?;
    let reference_id = pos::canonical_appointment_reference(&state, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| ApiError::internal("failed to resolve appointment invoice"))?;
    let invoice = if let Some(sale) =
        pos::find_appointment_pos_sale(&state, &headers, &reference_id)
            .await
            .map_err(|_| ApiError::internal("failed to load appointment invoice"))?
    {
        sqlx::query_scalar::<_, Value>(
            r#"SELECT jsonb_build_object('saleId',sale.id,'status',sale.status,'totalPaise',sale.total_paise,
              'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',line.id,'lineType',line.line_type,'itemId',line.item_id,'itemName',line.item_name,'staffId',line.staff_id,'quantity',line.quantity,'unitPricePaise',line.unit_price_paise,'lineTotalPaise',line.line_total_paise) ORDER BY line.created_at,line.id)
                FROM pos_sale_lines line WHERE line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id),'[]'::jsonb))
              FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$3"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&sale.sale_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to load appointment invoice lines"))?
    } else {
        Value::Null
    };

    Ok(Json(json!({
        "appointmentId":id,"visit":visit,"recipes":recipes,"usage":usage,"products":products,
        "offers":offers,"invoice":invoice,
        "permissions":{
            "consumablesManage":staff_service_permission(&claims,"staff.app.service.consumables.manage"),
            "consumablesReview":claims.role.eq_ignore_ascii_case("owner") || claims.permissions.iter().any(|permission| permission=="inventory.approve"),
            "upsellManage":staff_service_permission(&claims,"staff.app.service.upsell.manage"),
            "priceManage":staff_appointment_permission(&claims,"staff.app.appointments.price.manage")
        }
    })))
}

async fn add_staff_self_invoice_line(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffInvoiceLinePayload>,
) -> Result<Json<Value>, ApiError> {
    if !staff_service_permission(&claims, "staff.app.service.upsell.manage") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App upsell permission is required",
        ));
    }
    let (tenant_id, branch_id, _, current) =
        self_appointment(&state, &claims, &headers, &id).await?;
    let item_type = payload.item_type.trim().to_ascii_lowercase();
    let item_id = payload.item_id.trim();
    if item_id.is_empty()
        || !matches!(
            item_type.as_str(),
            "product" | "service" | "membership" | "package" | "gift_card"
        )
        || !(1..=100).contains(&payload.quantity)
        || (matches!(item_type.as_str(), "membership" | "package" | "gift_card")
            && payload.quantity != 1)
        || (item_type == "gift_card"
            && (payload.unit_price_paise.is_none_or(|value| value <= 0)
                || !(4..=64).contains(&item_id.len())
                || !item_id
                    .chars()
                    .all(|value| value.is_ascii_alphanumeric() || value == '-')))
    {
        return Err(ApiError::bad_request(
            "valid sale item and quantity are required; gift cards need a 4-64 character code and positive value",
        ));
    }
    let (item_name, configured_price, tax_percent, tax_code, available_stock) =
        match item_type.as_str() {
            "product" => sqlx::query_as::<_, (String, i64, i32, String, i64)>(
                r#"SELECT item.name,item.retail_price_paise,item.gst_percent,item.hsn_code,
                  (CASE WHEN item.dual_use_stock THEN GREATEST(item.stock_quantity-COALESCE((SELECT SUM(container.capacity_quantity)::integer FROM inventory_backbar_containers container
                    WHERE container.tenant_id=item.tenant_id AND container.branch_id=item.branch_id AND container.inventory_item_id=item.id AND container.status='sealed'),0),0) ELSE item.stock_quantity END)::bigint
                  FROM inventory_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.id=$3 AND item.active=TRUE AND item.product_usage IN ('retail','dual_use')"#,
            )
            .bind(&tenant_id)
            .bind(&branch_id)
            .bind(item_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::internal("failed to load retail product"))?
            .ok_or_else(|| ApiError::not_found("Retail product not found"))?,
            "service" => {
                let row = sqlx::query_as::<_, (String, i64, i32, String)>(
                    "SELECT name,price_paise::bigint,gst_percent,sac_code FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
                )
                .bind(&tenant_id)
                .bind(&branch_id)
                .bind(item_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|_| ApiError::internal("failed to load service"))?
                .ok_or_else(|| ApiError::not_found("Service not found"))?;
                (row.0, row.1, row.2, row.3, i64::MAX)
            }
            "membership" => {
                let row = sqlx::query_as::<_, (String, i64)>(
                    "SELECT name,price_paise FROM memberships WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
                )
                .bind(&tenant_id)
                .bind(&branch_id)
                .bind(item_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|_| ApiError::internal("failed to load membership"))?
                .ok_or_else(|| ApiError::not_found("Membership not found"))?;
                (row.0, row.1, 0, String::new(), i64::MAX)
            }
            "package" => {
                let row = sqlx::query_as::<_, (String, i64)>(
                    "SELECT name,price_paise FROM packages WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE",
                )
                .bind(&tenant_id)
                .bind(&branch_id)
                .bind(item_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|_| ApiError::internal("failed to load package"))?
                .ok_or_else(|| ApiError::not_found("Package not found"))?;
                (row.0, row.1, 0, String::new(), i64::MAX)
            }
            "gift_card" => (
                "Gift / prepaid card".to_string(),
                payload.unit_price_paise.unwrap_or_default(),
                0,
                String::new(),
                i64::MAX,
            ),
            _ => unreachable!(),
        };
    if item_type == "product" && configured_price <= 0 {
        return Err(ApiError::conflict(
            "retail selling price must be configured before adding this product",
        ));
    }
    if available_stock < payload.quantity {
        return Err(ApiError::conflict("available retail stock is insufficient"));
    }
    let unit_price_paise = payload.unit_price_paise.unwrap_or(configured_price);
    if unit_price_paise < 0 {
        return Err(ApiError::bad_request("unitPricePaise cannot be negative"));
    }
    let price_changed = unit_price_paise != configured_price;
    if price_changed
        && (!staff_appointment_permission(&claims, "staff.app.appointments.price.manage")
            || !(3..=500).contains(&payload.price_reason.trim().chars().count()))
    {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "price override permission and a 3-500 character reason are required",
        ));
    }
    let context = ensure_appointment_pos_draft(&state, &headers, &id).await?;
    let draft = pos::append_appointment_draft_line(
        &state,
        &headers,
        &context.draft.sale_id,
        &context.reference_id,
        pos::PosSaleLineInput {
            line_type: Some(item_type.clone()),
            item_id: Some(item_id.to_string()),
            item_name: Some(item_name.clone()),
            staff_id: Some(current.staff_id.clone()),
            quantity: Some(payload.quantity),
            unit_price_paise: Some(unit_price_paise),
            tax_percent: Some(tax_percent),
            hsn_sac_code: Some(tax_code),
            ..pos::PosSaleLineInput::default()
        },
        claims.max_discount_paise,
    )
    .await
    .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let reason = if price_changed {
        format!(
            "{} x{} added to invoice; price override: {}",
            item_name,
            payload.quantity,
            payload.price_reason.trim()
        )
    } else {
        format!("{} x{} added to invoice", item_name, payload.quantity)
    };
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &current,
        "INVOICE_RECOMMENDATION_ADDED",
        &reason,
    )
    .await?;
    Ok(Json(json!({
        "saleId":draft.sale_id,"status":draft.status,"totalPaise":draft.total_paise
    })))
}

fn staff_pos_permission(claims: &AuthClaims, permission: &str) -> bool {
    auth_service::staff_app_permission_allowed(claims, permission, &["owner", "admin"], &[])
}

fn map_pos_error(error: crate::models::common::AppError) -> ApiError {
    ApiError::with_status(error.status_code(), error.message())
}

async fn staff_checkout_context(
    state: &AppState,
    claims: &AuthClaims,
    headers: &HeaderMap,
    appointment_id: &str,
    permission: &str,
) -> Result<AppointmentDraftContext, ApiError> {
    if !staff_pos_permission(claims, permission) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            format!("{permission} permission is required"),
        ));
    }
    self_appointment(state, claims, headers, appointment_id).await?;
    ensure_appointment_pos_draft(state, headers, appointment_id).await
}

async fn staff_self_checkout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.read").await?;
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let details =
        pos::load_pos_sale_details(&state, &tenant_id, &branch_id, &context.draft.sale_id)
            .await
            .map_err(map_pos_error)?;
    let package_credits = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'packageId',package_id,'packageName',package_name,'serviceId',service_id,'serviceName',service_name,'remainingQuantity',remaining_qty,'expiresAt',expires_at) ORDER BY expires_at NULLS LAST,created_at,id),'[]'::jsonb)
           FROM client_package_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND active=TRUE AND remaining_qty>0 AND (expires_at IS NULL OR expires_at>=CURRENT_DATE)"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&context.current.client_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load package credits"))?;
    let membership_credits = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'membershipId',membership_id,'membershipName',membership_name,'serviceId',service_id,'serviceName',service_name,'remainingQuantity',remaining_qty,'expiresAt',expires_at) ORDER BY expires_at NULLS LAST,created_at,id),'[]'::jsonb)
           FROM client_membership_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND active=TRUE AND remaining_qty>0 AND (expires_at IS NULL OR expires_at>=CURRENT_DATE)"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&context.current.client_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load membership credits"))?;
    let payment_methods = payment_methods_repository::list(&state.db, &tenant_id, &branch_id, true)
    .await
    .map_err(|_| ApiError::internal("failed to load payment methods"))?
    .into_iter()
    .map(|method| json!({"id":method.id,"code":method.code,"name":method.name,"settlementType":method.settlement_type,"referenceRequired":method.reference_required}))
    .collect::<Vec<_>>();
    let providers = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(jsonb_agg(provider ORDER BY provider),'[]'::jsonb) FROM payment_provider_branch_controls WHERE tenant_id=$1 AND branch_id=$2 AND enabled=TRUE"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load payment providers"))?;
    let payment_instruments = sqlx::query_scalar::<_, Value>(
        r#"SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'methodType',method_type,'brand',brand,'last4',last4,'expiryMonth',expiry_month,'expiryYear',expiry_year,'recurringEnabled',recurring_enabled,'status',status) ORDER BY last_used_at DESC NULLS LAST,created_at DESC),'[]'::jsonb)
           FROM client_payment_instruments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND status IN ('saved','active')"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&context.current.client_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load saved payment instruments"))?;
    let tip_splits = sqlx::query_scalar::<_, Value>(
        "SELECT tip_splits FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&context.draft.sale_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load invoice tip splits"))?;
    Ok(Json(ApiResponse::ok(json!({
        "checkout":details,"packageCredits":package_credits,"membershipCredits":membership_credits,
        "paymentMethods":payment_methods,"providers":providers,"paymentInstruments":payment_instruments,"groupInvoice":context.reference_id!=id,
        "tipSplits":tip_splits,
        "offlinePaymentsAllowed":false,
        "permissions":{"manage":staff_pos_permission(&claims,"staff.app.pos.manage"),"lifecycle":staff_pos_permission(&claims,"staff.app.pos.lifecycle.manage")}
    }))))
}

async fn redemption_lines(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    staff_id: &str,
    rows: &[Value],
    package: bool,
) -> Result<(Vec<pos::PosSaleLineInput>, Vec<Value>), ApiError> {
    if rows.len() > 25 {
        return Err(ApiError::bad_request("too many benefit rows"));
    }
    let mut lines = Vec::new();
    let mut normalized = Vec::new();
    for row in rows {
        let credit_id = row
            .get("creditId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let quantity = row.get("quantity").and_then(Value::as_i64).unwrap_or(0);
        if credit_id.is_empty() || quantity <= 0 {
            return Err(ApiError::bad_request(
                "creditId and positive quantity are required",
            ));
        }
        let table = if package {
            "client_package_credits"
        } else {
            "client_membership_credits"
        };
        let catalog = if package { "package" } else { "membership" };
        let query = format!("SELECT {catalog}_id,{catalog}_name,service_id,service_name,remaining_qty::bigint FROM {table} WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4 AND active=TRUE AND remaining_qty>0 AND (expires_at IS NULL OR expires_at>=CURRENT_DATE)");
        let credit = sqlx::query_as::<_, (String, String, String, String, i64)>(&query)
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .bind(credit_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| ApiError::internal("failed to validate benefit credit"))?
            .ok_or_else(|| ApiError::conflict("benefit credit is not available"))?;
        if quantity > credit.4 {
            return Err(ApiError::conflict(
                "benefit quantity exceeds available credits",
            ));
        }
        let line_type = if package {
            "package_redeem"
        } else {
            "membership_redeem"
        };
        lines.push(pos::PosSaleLineInput {
            line_type: Some(line_type.into()),
            item_id: Some(credit_id.into()),
            item_name: Some(format!("{} · {}", credit.1, credit.3)),
            staff_id: Some(staff_id.into()),
            quantity: Some(quantity),
            unit_price_paise: Some(0),
            tax_percent: Some(0),
            ..Default::default()
        });
        normalized.push(json!({"clientPackageCreditId":credit_id,"packageId":credit.0,"packageName":credit.1,"serviceId":credit.2,"serviceName":credit.3,"staffId":staff_id,"quantity":quantity}));
    }
    Ok((lines, normalized))
}

async fn update_staff_self_checkout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffCheckoutUpdatePayload>,
) -> Result<Json<ApiResponse<pos::PosSaleDetailsResponse>>, ApiError> {
    if payload.bill_discount_paise < 0 || payload.tip_paise < 0 {
        return Err(ApiError::bad_request("discount and tip cannot be negative"));
    }
    if payload.bill_discount_paise > 0
        && !(3..=500).contains(&payload.discount_reason.trim().chars().count())
    {
        return Err(ApiError::bad_request(
            "discount reason must contain 3 to 500 characters",
        ));
    }
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.manage").await?;
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    if payload.tip_splits.len() > 25 {
        return Err(ApiError::bad_request("tipSplits supports up to 25 staff"));
    }
    let mut tip_staff_ids = Vec::with_capacity(payload.tip_splits.len());
    for split in &payload.tip_splits {
        let staff_id = split
            .get("staffId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if staff_id.is_empty()
            || split
                .get("amountPaise")
                .and_then(Value::as_i64)
                .unwrap_or_default()
                <= 0
        {
            return Err(ApiError::bad_request(
                "each tip split needs staffId and positive amountPaise",
            ));
        }
        tip_staff_ids.push(staff_id.to_string());
    }
    tip_staff_ids.sort();
    tip_staff_ids.dedup();
    if !tip_staff_ids.is_empty() {
        let active_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*)::bigint FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND id=ANY($3::TEXT[])",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&tip_staff_ids)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to validate tip split staff"))?;
        if active_count != tip_staff_ids.len() as i64 {
            return Err(ApiError::bad_request(
                "tipSplits contains unavailable staff",
            ));
        }
    }
    let details =
        pos::load_pos_sale_details(&state, &tenant_id, &branch_id, &context.draft.sale_id)
            .await
            .map_err(map_pos_error)?;
    if details.sale.paid_paise > 0 {
        return Err(ApiError::conflict(
            "invoice pricing and benefits cannot change after payment",
        ));
    }
    let mut lines = details
        .lines
        .into_iter()
        .filter(|line| {
            !matches!(
                line.line_type.as_str(),
                "package_redeem" | "membership_redeem" | "redemption"
            )
        })
        .map(|line| pos::PosSaleLineInput {
            line_type: Some(line.line_type),
            item_id: Some(line.item_id),
            item_name: Some(line.item_name),
            staff_id: Some(line.staff_id),
            staff_splits: Some(line.staff_splits),
            quantity: Some(line.quantity),
            unit_price_paise: Some(line.unit_price_paise),
            discount_paise: Some(line.discount_paise),
            tax_percent: Some(line.tax_percent),
            hsn_sac_code: Some(line.hsn_sac_code),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    let (package_lines, package_redemptions) = redemption_lines(
        &state,
        &tenant_id,
        &branch_id,
        &context.current.client_id,
        &context.current.staff_id,
        &payload.package_redemptions,
        true,
    )
    .await?;
    let (membership_lines, _) = redemption_lines(
        &state,
        &tenant_id,
        &branch_id,
        &context.current.client_id,
        &context.current.staff_id,
        &payload.membership_redemptions,
        false,
    )
    .await?;
    lines.extend(package_lines);
    lines.extend(membership_lines);
    let result = pos::replace_pos_invoice_draft(
        State(state.clone()),
        Extension(claims.clone()),
        headers.clone(),
        Path(context.draft.sale_id.clone()),
        Json(pos::PosSalePayload {
            client_id: Some(context.current.client_id.clone()),
            staff_id: Some(context.current.staff_id.clone()),
            lines: Some(lines),
            package_redemptions: Some(Value::Array(package_redemptions)),
            bill_discount_paise: Some(payload.bill_discount_paise),
            coupon_code: Some(payload.coupon_code.trim().into()),
            tip_paise: Some(payload.tip_paise),
            tip_splits: Some(Value::Array(payload.tip_splits)),
            round_to_nearest_rupee: Some(payload.round_to_nearest_rupee),
            payments: Some(Vec::new()),
            ..Default::default()
        }),
    )
    .await
    .map_err(map_pos_error)?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&context.current),
        &context.current,
        "CHECKOUT_UPDATED",
        payload.discount_reason.trim(),
    )
    .await?;
    Ok(result)
}

async fn add_staff_self_checkout_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffCheckoutPaymentPayload>,
) -> Result<Json<ApiResponse<pos::PosPaymentResponse>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.manage").await?;
    let method = payload.method.trim().to_ascii_lowercase();
    if matches!(method.as_str(), "card" | "upi") {
        return Err(ApiError::bad_request(
            "card and UPI require the secure provider flow",
        ));
    }
    pos::add_pos_payment(
        State(state),
        headers,
        Path(context.draft.sale_id),
        Json(pos::PosPaymentInput {
            method: Some(method),
            amount_paise: Some(payload.amount_paise),
            reference: Some(payload.reference),
            notes: Some(payload.notes),
            cash_drawer_till_id: Some(payload.cash_drawer_till_id),
            idempotency_key: Some(payload.idempotency_key),
            ..Default::default()
        }),
    )
    .await
    .map_err(map_pos_error)
}

async fn start_staff_self_provider_payment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffProviderPaymentPayload>,
) -> Result<Json<ApiResponse<Value>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.manage").await?;
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let mut provider = payload.provider.trim().to_ascii_lowercase();
    let mut provider_payment_method_id = payload.provider_payment_method_id.trim().to_string();
    let mut provider_customer_id = payload.provider_customer_id.trim().to_string();
    if !payload.saved_instrument_id.trim().is_empty() {
        let saved = sqlx::query_as::<_, (String, String, String)>(
            "SELECT provider,provider_instrument_id,provider_customer_id FROM client_payment_instruments WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4 AND status IN ('saved','active')",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&context.current.client_id)
        .bind(payload.saved_instrument_id.trim())
        .fetch_optional(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to resolve saved payment instrument"))?
        .ok_or_else(|| ApiError::not_found("Saved payment instrument not found"))?;
        provider = saved.0;
        provider_payment_method_id = saved.1;
        provider_customer_id = saved.2;
    }
    if provider_payment_method_id.is_empty() {
        return Err(ApiError::bad_request(
            "secure provider payment method token is required",
        ));
    }
    payment_platform::create_payment(
        State(state),
        Extension(claims),
        headers,
        Json(payment_platform::OperationPayload {
            provider,
            idempotency_key: payload.idempotency_key,
            sale_id: Some(context.draft.sale_id),
            client_id: Some(context.current.client_id),
            mfa_code: None,
            request: platform::PaymentRequest {
                amount_paise: payload.amount_paise,
                currency: "INR".into(),
                reference: format!("appointment:{id}"),
                return_url: None,
                provider_payment_method_id: Some(provider_payment_method_id),
                provider_customer_id: (!provider_customer_id.is_empty())
                    .then_some(provider_customer_id),
                payment_method: None,
                store_payment_method: payload.store_payment_method,
                recurring: false,
                application_fee_paise: None,
                capture_method: None,
            },
        }),
    )
    .await
    .map_err(map_pos_error)
}

async fn create_staff_self_upi_link(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffUpiLinkPayload>,
) -> Result<Json<ApiResponse<pos::PosPaymentLinkResponse>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.manage").await?;
    let (tenant, branch) = scope_from_headers(&headers, None, None);
    let value = pos::create_payment_link_for_invoice(
        &state,
        &tenant,
        &branch,
        &context.draft.sale_id,
        pos::PosPaymentLinkRequest {
            provider: Some(payload.provider),
            amount_paise: payload.amount_paise,
            expires_at: None,
            idempotency_key: Some(payload.idempotency_key),
        },
    )
    .await
    .map_err(map_pos_error)?;
    Ok(Json(ApiResponse::ok(value)))
}

async fn finalize_staff_self_checkout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffCheckoutFinalizePayload>,
) -> Result<Json<ApiResponse<pos::PosSaleDetailsResponse>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.manage").await?;
    pos::finalize_pos_invoice(
        State(state),
        headers,
        Path(context.draft.sale_id),
        Some(Json(pos::FinalizeRequest {
            cash_drawer_till_id: (!payload.cash_drawer_till_id.trim().is_empty())
                .then_some(payload.cash_drawer_till_id),
        })),
    )
    .await
    .map_err(map_pos_error)
}

async fn staff_self_checkout_receipt(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<pos::PosInvoicePrintResponse>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.read").await?;
    pos::get_pos_invoice_print(State(state), headers, Path(context.draft.sale_id))
        .await
        .map_err(map_pos_error)
}

async fn record_staff_self_receipt_action(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<pos::InvoiceActionRequest>,
) -> Result<Json<ApiResponse<pos::InvoiceActionResponse>>, ApiError> {
    let context =
        staff_checkout_context(&state, &claims, &headers, &id, "staff.app.pos.manage").await?;
    pos::record_pos_invoice_action(
        State(state),
        Extension(claims),
        headers,
        Path(context.draft.sale_id),
        Json(payload),
    )
    .await
    .map_err(map_pos_error)
}

async fn staff_self_checkout_lifecycle(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffCheckoutLifecyclePayload>,
) -> Result<Json<ApiResponse<pos::PosSaleDetailsResponse>>, ApiError> {
    let context = staff_checkout_context(
        &state,
        &claims,
        &headers,
        &id,
        "staff.app.pos.lifecycle.manage",
    )
    .await?;
    match payload.action.trim().to_ascii_lowercase().as_str() {
        "void" => pos::void_pos_invoice(
            State(state),
            Extension(claims),
            headers,
            Path(context.draft.sale_id),
            Json(payload.request),
        )
        .await
        .map_err(map_pos_error),
        "refund" => pos::refund_pos_invoice(
            State(state),
            Extension(claims),
            headers,
            Path(context.draft.sale_id),
            Json(payload.request),
        )
        .await
        .map_err(map_pos_error),
        _ => Err(ApiError::bad_request("action must be void or refund")),
    }
}

async fn staff_self_no_show_charge(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<NoShowChargePayload>,
) -> Result<Json<Value>, ApiError> {
    if !staff_pos_permission(&claims, "staff.app.pos.lifecycle.manage") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "staff.app.pos.lifecycle.manage permission is required",
        ));
    }
    self_appointment(&state, &claims, &headers, &id).await?;
    mark_no_show_with_charge(State(state), headers, Path(id), Json(payload)).await
}

fn require_staff_register(claims: &AuthClaims, permission: &str) -> Result<(), ApiError> {
    if auth_service::staff_app_permission_allowed(
        claims,
        permission,
        if permission == "staff.app.register.approve" {
            &["owner", "admin", "manager"]
        } else {
            &["owner", "admin"]
        },
        &["cash-drawer.manage", "write:pos", "read:pos"],
    ) {
        Ok(())
    } else {
        Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            format!("{permission} permission is required"),
        ))
    }
}

async fn staff_self_register_current(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<cash_drawer::BusinessDateQuery>,
) -> Result<Json<ApiResponse<Option<cash_drawer::DrawerResponse>>>, ApiError> {
    require_staff_register(&claims, "staff.app.register.read")?;
    cash_drawer::current(State(state), Extension(claims), headers, Query(query))
        .await
        .map_err(map_pos_error)
}

async fn staff_self_register_open(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<cash_drawer::OpenRequest>,
) -> Result<Json<ApiResponse<cash_drawer::DrawerResponse>>, ApiError> {
    require_staff_register(&claims, "staff.app.register.manage")?;
    cash_drawer::open(State(state), Extension(claims), headers, Json(payload))
        .await
        .map_err(map_pos_error)
}

async fn staff_self_register_movements(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<cash_drawer::BusinessDateQuery>,
) -> Result<
    Json<ApiResponse<Vec<crate::repositories::cash_drawer_repository::CashDrawerMovement>>>,
    ApiError,
> {
    require_staff_register(&claims, "staff.app.register.read")?;
    cash_drawer::list_movements(State(state), headers, Query(query))
        .await
        .map_err(map_pos_error)
}

async fn staff_self_register_movement(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<cash_drawer::MovementRequest>,
) -> Result<Json<ApiResponse<cash_drawer::DrawerResponse>>, ApiError> {
    require_staff_register(&claims, "staff.app.register.manage")?;
    cash_drawer::record_movement(State(state), Extension(claims), headers, Json(payload))
        .await
        .map_err(map_pos_error)
}

async fn staff_self_register_close(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<cash_drawer::CloseRequest>,
) -> Result<Json<ApiResponse<cash_drawer::DrawerResponse>>, ApiError> {
    require_staff_register(&claims, "staff.app.register.manage")?;
    cash_drawer::close(State(state), Extension(claims), headers, Json(payload))
        .await
        .map_err(map_pos_error)
}

async fn staff_self_register_approve(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<cash_drawer::ApprovalRequest>,
) -> Result<Json<ApiResponse<cash_drawer::DrawerResponse>>, ApiError> {
    require_staff_register(&claims, "staff.app.register.approve")?;
    cash_drawer::approve(
        State(state),
        Extension(claims),
        headers,
        Path(id),
        Json(payload),
    )
    .await
    .map_err(map_pos_error)
}

async fn staff_self_provider_reconciliations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<cash_drawer::BusinessDateQuery>,
) -> Result<
    Json<ApiResponse<Vec<crate::repositories::cash_drawer_repository::ProviderReconciliationRun>>>,
    ApiError,
> {
    require_staff_register(&claims, "staff.app.register.approve")?;
    cash_drawer::list_provider_reconciliations(State(state), headers, Query(query))
        .await
        .map_err(map_pos_error)
}

async fn create_staff_self_provider_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<cash_drawer::ProviderReconciliationRequest>,
) -> Result<
    Json<ApiResponse<crate::repositories::cash_drawer_repository::ProviderReconciliationRun>>,
    ApiError,
> {
    require_staff_register(&claims, "staff.app.register.approve")?;
    cash_drawer::create_provider_reconciliation(
        State(state),
        Extension(claims),
        headers,
        Json(payload),
    )
    .await
    .map_err(map_pos_error)
}

async fn review_staff_self_provider_reconciliation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<cash_drawer::ReviewRequest>,
) -> Result<
    Json<ApiResponse<crate::repositories::cash_drawer_repository::ProviderReconciliationRun>>,
    ApiError,
> {
    require_staff_register(&claims, "staff.app.register.approve")?;
    cash_drawer::review_provider_reconciliation(
        State(state),
        Extension(claims),
        headers,
        Path(id),
        Json(payload),
    )
    .await
    .map_err(map_pos_error)
}

async fn run_self_appointment_operation(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StaffAppointmentOperationPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id, _self_staff_id, current) =
        self_appointment(&state, &claims, &headers, &id).await?;
    let action = payload.action.trim();
    if action == "note" {
        let note = payload.reason.trim();
        if !(1..=2000).contains(&note.chars().count()) {
            return Err(ApiError::bad_request(
                "handoff note must contain 1 to 2000 characters",
            ));
        }
        insert_activity(
            &state,
            &tenant_id,
            Some(&current),
            &current,
            "SERVICE_HANDOFF_NOTE",
            note,
        )
        .await?;
        return Ok(Json(json!({"appointment":current})));
    }
    if matches!(
        action,
        "complete-service" | "complete-appointment" | "checkout"
    ) {
        let (pending, missing_manual) = sqlx::query_as::<_, (bool, bool)>(
            r#"SELECT
              EXISTS(SELECT 1 FROM inventory_backbar_usage usage WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.appointment_id=$3 AND usage.status='pending_approval'),
              EXISTS(
                SELECT 1 FROM appointments appointment
                JOIN LATERAL jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb) selected(service_id) ON TRUE
                JOIN services service ON service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id AND service.id=selected.service_id
                LEFT JOIN appointment_service_recipe_snapshots snapshot ON snapshot.tenant_id=appointment.tenant_id AND snapshot.branch_id=appointment.branch_id AND snapshot.appointment_id=appointment.id AND snapshot.service_id=service.id
                JOIN LATERAL jsonb_array_elements(COALESCE(snapshot.recipe_json,service.product_consumption_json,'[]'::jsonb)) entry ON TRUE
                WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.id=$3
                  AND COALESCE((entry->>'trackAutomatically')::boolean,TRUE)=FALSE
                  AND NOT EXISTS(SELECT 1 FROM inventory_backbar_usage usage WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.appointment_id=$3 AND usage.service_id=service.id
                    AND usage.inventory_item_id=COALESCE(NULLIF(entry->>'itemId',''),NULLIF(entry->>'productId',''),NULLIF(entry->>'inventoryItemId','')) AND usage.status='recorded')
              )"#,
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(&id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to validate service consumables"))?;
        if pending {
            return Err(ApiError::conflict(
                "approve or reject pending consumable variance before completion",
            ));
        }
        if missing_manual {
            return Err(ApiError::conflict(
                "record all manually tracked service consumables before completion",
            ));
        }
    }
    if action == "checkout" {
        let result = convert_to_sale(State(state), headers, Path(id)).await?;
        return Ok(Json(
            json!({"appointment":result.0.appointment,"checkout":result.0.sales_order}),
        ));
    }
    if action == "handoff" {
        if !staff_appointment_permission(&claims, "staff.app.appointments.team.manage") {
            return Err(ApiError::with_status(
                StatusCode::FORBIDDEN,
                "Team appointment manage permission is required",
            ));
        }
        if payload.handoff_staff_id.trim().is_empty()
            || payload.handoff_staff_id.trim() == current.staff_id
            || !(3..=500).contains(&payload.reason.trim().chars().count())
        {
            return Err(ApiError::bad_request(
                "a different active provider and a 3-500 character handoff reason are required",
            ));
        }
        let start_at = parse_datetime(&current.start_at, "appointment.start_at")?;
        let end_at = parse_datetime(&current.end_at, "appointment.end_at")?;
        validate_staff_booking_availability(
            &state,
            &tenant_id,
            &branch_id,
            payload.handoff_staff_id.trim(),
            &current.service_ids,
            start_at,
            end_at,
            Some(&id),
        )
        .await?;
        let row = sqlx::query(
            "UPDATE appointments SET staff_id=$1,handoff_from_staff_id=$2,handoff_reason=$3,version=version+1,updated_at=NOW() WHERE id=$4 AND tenant_id=$5 AND branch_id=$6 RETURNING id,tenant_id,branch_id,client_id,staff_id,requested_staff_id,staff_preference,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id,version,created_at,updated_at,booking_type,day_package_id,host_client_id,group_name,group_notes,is_surprise,virtual_meeting_url,service_mode,segment_label,sequence_no,execution_status,service_started_at,service_paused_at,paused_seconds,service_completed_at",
        ).bind(payload.handoff_staff_id.trim()).bind(&current.staff_id).bind(payload.reason.trim()).bind(&id).bind(&tenant_id).bind(&branch_id)
        .fetch_one(&state.db).await.map_err(|_| ApiError::internal("failed to hand off appointment"))?;
        let updated = build_appointment(&row)?;
        insert_activity(
            &state,
            &tenant_id,
            Some(&current),
            &updated,
            "PROVIDER_HANDOFF",
            payload.reason.trim(),
        )
        .await?;
        return Ok(Json(json!({"appointment":updated})));
    }
    let (expected, next_status, execution_status, activity_action) = match action {
        "start"
            if matches!(
                current.status.as_str(),
                "booked" | "confirmed" | "arrived" | "waiting"
            ) =>
        {
            ("not_started", "in-service", "in_service", "SERVICE_STARTED")
        }
        "pause" if current.execution_status == "in_service" => {
            ("in_service", "paused", "paused", "SERVICE_PAUSED")
        }
        "resume" if current.execution_status == "paused" => {
            ("paused", "in-service", "in_service", "SERVICE_RESUMED")
        }
        "complete-service"
            if matches!(current.execution_status.as_str(), "in_service" | "paused") =>
        {
            (
                current.execution_status.as_str(),
                "completed",
                "completed",
                "SERVICE_COMPLETED",
            )
        }
        "complete-appointment" => (
            current.execution_status.as_str(),
            "completed",
            "completed",
            "APPOINTMENT_COMPLETED",
        ),
        _ => {
            return Err(ApiError::conflict(
                "appointment operation is not allowed from the current state",
            ))
        }
    };
    let apply_group = action == "complete-appointment"
        && payload.apply_group
        && current
            .booking_group_id
            .as_deref()
            .is_some_and(|value| !value.is_empty());
    if apply_group && !staff_appointment_permission(&claims, "staff.app.appointments.team.manage") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Team appointment manage permission is required",
        ));
    }
    let before = if apply_group {
        sqlx::query("SELECT id,tenant_id,branch_id,client_id,staff_id,requested_staff_id,staff_preference,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id,version,created_at,updated_at,booking_type,day_package_id,host_client_id,group_name,group_notes,is_surprise,virtual_meeting_url,service_mode,segment_label,sequence_no,execution_status,service_started_at,service_paused_at,paused_seconds,service_completed_at FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND booking_group_id=$3 AND status NOT IN ('cancelled','no-show','billed','paid')")
            .bind(&tenant_id).bind(&branch_id).bind(current.booking_group_id.as_deref().unwrap_or_default()).fetch_all(&state.db).await
            .map_err(|_| ApiError::internal("failed to load appointment group"))?.iter().map(build_appointment).collect::<Result<Vec<_>,_>>()?
    } else {
        vec![current.clone()]
    };
    let ids = before
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let updated_rows = sqlx::query(
        "UPDATE appointments SET status=$1,execution_status=$2,
          service_started_at=CASE WHEN $2='in_service' THEN COALESCE(service_started_at,NOW()) ELSE service_started_at END,
          paused_seconds=paused_seconds+CASE WHEN service_paused_at IS NOT NULL AND $2 IN ('in_service','completed') THEN GREATEST(EXTRACT(EPOCH FROM (NOW()-service_paused_at))::BIGINT,0) ELSE 0 END,
          service_paused_at=CASE WHEN $2='paused' THEN NOW() WHEN $2 IN ('in_service','completed') THEN NULL ELSE service_paused_at END,
          service_completed_at=CASE WHEN $2='completed' THEN NOW() ELSE service_completed_at END,
          version=version+1,updated_at=NOW()
        WHERE tenant_id=$3 AND branch_id=$4 AND id=ANY($5) AND ($6='' OR execution_status=$6)
        RETURNING id,tenant_id,branch_id,client_id,staff_id,requested_staff_id,staff_preference,service_ids_json,start_at,end_at,status,notes,source_channel,source,booking_group_id,version,created_at,updated_at,booking_type,day_package_id,host_client_id,group_name,group_notes,is_surprise,virtual_meeting_url,service_mode,segment_label,sequence_no,execution_status,service_started_at,service_paused_at,paused_seconds,service_completed_at",
    ).bind(next_status).bind(execution_status).bind(&tenant_id).bind(&branch_id).bind(&ids)
    .bind(if action == "complete-appointment" { "" } else { expected }).fetch_all(&state.db).await
    .map_err(|_| ApiError::internal("failed to update appointment operation"))?;
    if updated_rows.len() != ids.len() {
        return Err(ApiError::conflict(
            "appointment operation changed; reload and try again",
        ));
    }
    let updated = updated_rows
        .iter()
        .map(build_appointment)
        .collect::<Result<Vec<_>, _>>()?;
    for item in &updated {
        let previous = before.iter().find(|value| value.id == item.id);
        insert_activity(
            &state,
            &tenant_id,
            previous,
            item,
            activity_action,
            payload.reason.trim(),
        )
        .await?;
    }
    Ok(Json(json!({"appointments":updated})))
}

async fn decide_self_online_booking_request(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<OnlineBookingDecisionPayload>,
) -> Result<Json<Value>, ApiError> {
    if !staff_appointment_permission(&claims, "staff.app.appointments.team.manage") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Team appointment manage permission is required",
        ));
    }
    if !matches!(payload.decision.trim(), "approved" | "rejected")
        || !(3..=500).contains(&payload.reason.trim().chars().count())
    {
        return Err(ApiError::bad_request(
            "approved or rejected decision and a 3-500 character reason are required",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row=sqlx::query("SELECT request_type,payload,appointment_id,status FROM smart_booking_requests WHERE id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&id).bind(&tenant_id).bind(&branch_id).fetch_optional(&state.db).await
        .map_err(|_|ApiError::internal("failed to load online booking request"))?.ok_or_else(||ApiError::not_found("Online booking request not found"))?;
    if row.try_get::<String, _>("status").unwrap_or_default() != "pending" {
        return Err(ApiError::conflict(
            "online booking request is no longer pending",
        ));
    }
    let request_type = row.try_get::<String, _>("request_type").unwrap_or_default();
    let body = serde_json::from_str::<Value>(
        &row.try_get::<String, _>("payload")
            .unwrap_or_else(|_| "{}".into()),
    )
    .unwrap_or_else(|_| json!({}));
    let appointment_id = row
        .try_get::<String, _>("appointment_id")
        .unwrap_or_default();
    let appointment_id = if appointment_id.is_empty() {
        body.get("appointmentId")
            .and_then(Value::as_str)
            .unwrap_or_default()
    } else {
        appointment_id.as_str()
    };
    if payload.decision == "approved" {
        self_appointment(&state, &claims, &headers, appointment_id).await?;
        if request_type.contains("cancel") {
            let _ = cancel_appointment_inner(
                &state,
                &headers,
                appointment_id,
                &StatusPayload {
                    status: "cancelled".into(),
                    reason: payload.reason.clone(),
                    apply_group: false,
                },
                false,
            )
            .await?;
        } else if request_type.contains("resched") {
            let start_at = body
                .get("startAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let end_at = body
                .get("endAt")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let _ = reschedule_appointment(
                State(state.clone()),
                None,
                headers.clone(),
                Path(appointment_id.to_string()),
                Json(ReschedulePayload {
                    expected_version: None,
                    start_at,
                    end_at,
                    reason: payload.reason.clone(),
                    staff_id: String::new(),
                    staff_change_approval: String::new(),
                    staff_change_reason: String::new(),
                    service_ids: Vec::new(),
                    branch_id: String::new(),
                    chair_room_id: String::new(),
                    booking_group_id: String::new(),
                    change_mode: String::new(),
                    actor_source: "online-request".into(),
                    outside_hours_override_reason: String::new(),
                }),
            )
            .await?;
        } else {
            return Err(ApiError::bad_request(
                "unsupported online booking request type",
            ));
        }
    }
    let affected=sqlx::query("UPDATE smart_booking_requests SET status=$1,decided_by=$2,decision_reason=$3,decided_at=NOW() WHERE id=$4 AND tenant_id=$5 AND branch_id=$6 AND status='pending'")
        .bind(payload.decision.trim()).bind(&claims.sub).bind(payload.reason.trim()).bind(&id).bind(&tenant_id).bind(&branch_id).execute(&state.db).await
        .map_err(|_|ApiError::internal("failed to save online booking decision"))?.rows_affected();
    if affected != 1 {
        return Err(ApiError::conflict(
            "online booking request changed; reload and try again",
        ));
    }
    Ok(Json(json!({"id":id,"status":payload.decision.trim()})))
}

async fn convert_self_waitlist(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut payload): Json<AppointmentBatchPayload>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    if !staff_appointment_permission(&claims, "staff.app.appointments.team.manage") {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Team appointment manage permission is required",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let client_id=sqlx::query_scalar::<_,String>("SELECT customer_id FROM appointment_waitlist WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'")
        .bind(&id).bind(&tenant_id).bind(&branch_id).fetch_optional(&state.db).await
        .map_err(|_|ApiError::internal("failed to load waitlist entry"))?.ok_or_else(||ApiError::not_found("Waitlist entry not found"))?;
    if payload.lines.iter().any(|line| {
        booking_line_client_id(payload.client_id.trim(), line.client_id.trim()) != client_id
    }) {
        return Err(ApiError::bad_request(
            "waitlist conversion must keep the waitlisted guest",
        ));
    }
    payload.client_id = client_id;
    let saved = save_self_appointment_batch(
        State(state.clone()),
        Extension(claims),
        headers,
        Json(payload),
    )
    .await?;
    let affected=sqlx::query("UPDATE appointment_waitlist SET status='promoted',updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'")
        .bind(&id).bind(&tenant_id).bind(&branch_id).execute(&state.db).await
        .map_err(|_|ApiError::internal("failed to close waitlist entry"))?.rows_affected();
    if affected != 1 {
        return Err(ApiError::conflict(
            "waitlist entry changed; reload and try again",
        ));
    }
    Ok(saved)
}

async fn self_appointment(
    state: &AppState,
    claims: &AuthClaims,
    headers: &HeaderMap,
    appointment_id: &str,
) -> Result<(String, String, String, AppointmentPayload), ApiError> {
    if !crate::services::auth_service::staff_app_permission_allowed(
        claims,
        "staff.app.appointments.manage",
        &["owner", "admin", "manager", "staff"],
        &["appointments.manage", "write:appointments"],
    ) {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "Staff App appointment permission is required",
        ));
    }
    let (tenant_id, branch_id) = scope_from_headers(headers, None, None);
    let linked_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let appointment = find_appointment(state, &tenant_id, &branch_id, appointment_id).await?;
    if appointment.staff_id != linked_staff_id
        && !staff_appointment_permission(claims, "staff.app.appointments.team.manage")
    {
        return Err(ApiError::not_found("Appointment not found"));
    }
    let target_staff_id = appointment.staff_id.clone();
    Ok((tenant_id, branch_id, target_staff_id, appointment))
}

async fn cancel_self_appointment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StatusPayload>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    self_appointment(&state, &claims, &headers, &id).await?;
    let reason = payload.reason.trim();
    if !(3..=500).contains(&reason.chars().count()) {
        return Err(ApiError::bad_request(
            "cancellation reason must be between 3 and 500 characters",
        ));
    }
    cancel_appointment_inner(&state, &headers, &id, &payload, false).await
}

async fn remove_appointment_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<StatusPayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    if status_is_closed(&current.status) {
        return Err(ApiError::conflict(
            "Completed/billed/paid/cancelled services cannot be removed",
        ));
    }

    let reason = if payload.reason.trim().is_empty() {
        "Service removed from booking"
    } else {
        payload.reason.trim()
    };
    let row = sqlx::query(
        "UPDATE appointments
         SET status='cancelled', notes=COALESCE(notes,'') || $1, version=version+1, updated_at=$2
         WHERE id=$3 AND tenant_id=$4 AND branch_id=$5
         RETURNING id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(format!(" | {}", reason))
    .bind(Utc::now())
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to remove appointment service"))?;
    let updated = build_appointment(&row)?;
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &updated,
        "CANCELLED",
        reason,
    )
    .await?;
    Ok(Json(updated))
}

pub async fn reschedule_appointment(
    State(state): State<AppState>,
    claims: Option<Extension<AuthClaims>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReschedulePayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    if payload
        .expected_version
        .is_some_and(|version| version != current.version)
    {
        return Err(ApiError::conflict(
            "appointment changed after it was opened; reload before moving it",
        ));
    }
    let calendar_move = payload
        .change_mode
        .trim()
        .eq_ignore_ascii_case("calendar-move");
    let approval_reschedule = payload.actor_source.trim().eq_ignore_ascii_case("client")
        || payload.actor_source.trim().eq_ignore_ascii_case("approval");
    if status_is_closed(&current.status) {
        return Err(ApiError::conflict("This appointment cannot be rescheduled"));
    }
    let next_start = parse_datetime(&payload.start_at, "start_at")?;
    let next_end = payload
        .end_at
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| parse_datetime(value, "end_at"))
        .unwrap_or_else(|| Ok(next_start + Duration::minutes(45)))?;
    if next_end <= next_start {
        return Err(ApiError::bad_request("end_at must be after start_at"));
    }
    validate_branch_operating_hours(
        &state,
        &tenant_id,
        &branch_id,
        next_start,
        next_end,
        &payload.outside_hours_override_reason,
        claims.as_ref().map(|claims| &claims.0),
    )
    .await?;

    let next_staff = if payload.staff_id.is_empty() {
        current.staff_id.clone()
    } else {
        payload.staff_id.clone()
    };
    validate_staff_reassignment(
        &current,
        &next_staff,
        &payload.staff_change_approval,
        &payload.staff_change_reason,
    )?;
    let next_service_ids = requested_service_ids(&current.service_ids, payload.service_ids);
    let next_branch = if payload.branch_id.is_empty() {
        current.branch_id.clone()
    } else {
        payload.branch_id
    };
    if next_branch != current.branch_id {
        return Err(ApiError::with_status(
            StatusCode::FORBIDDEN,
            "appointment branch cannot be changed through reschedule",
        ));
    }
    validate_staff_blackout(
        &state,
        &tenant_id,
        &branch_id,
        &next_staff,
        next_start,
        next_end,
    )
    .await?;
    let next_chair_room = if payload.chair_room_id.is_empty() {
        current.chair_room_id.clone()
    } else {
        payload.chair_room_id.clone()
    };
    let current_start = parse_datetime(&current.start_at, "current.start_at")?;
    let current_end = parse_datetime(&current.end_at, "current.end_at")?;
    let is_rescheduled =
        current_start != next_start || current_end != next_end || current.staff_id != next_staff;
    let next_status = if is_rescheduled && !calendar_move {
        "rescheduled".to_string()
    } else {
        current.status.clone()
    };
    let staff_change_note =
        if current.staff_id != next_staff && current.requested_staff_id != next_staff {
            format!(
                " Staff reassigned: {}",
                if payload.staff_change_reason.trim().is_empty() {
                    payload.staff_change_approval.trim()
                } else {
                    payload.staff_change_reason.trim()
                }
            )
        } else {
            String::new()
        };
    let update_note = if is_rescheduled {
        format!(" Rescheduled: {}{}", payload.reason, staff_change_note)
    } else if payload.reason.is_empty() {
        String::new()
    } else {
        format!(" Updated: {}", payload.reason)
    };
    validate_chair_room_availability(
        &state,
        &tenant_id,
        &branch_id,
        &next_chair_room,
        next_start,
        next_end,
        Some(&id),
    )
    .await?;
    validate_service_resource_requirement(
        &state,
        &tenant_id,
        &branch_id,
        &current.service_ids,
        &next_chair_room,
    )
    .await?;
    validate_staff_booking_availability(
        &state,
        &tenant_id,
        &branch_id,
        &next_staff,
        &next_service_ids,
        next_start,
        next_end,
        Some(&id),
    )
    .await?;

    let row = sqlx::query(
        "UPDATE appointments
         SET branch_id=$1, staff_id=$2, chair_room_id=NULLIF($3,''), service_ids_json=$4, start_at=$5, end_at=$6, status=$13, notes=COALESCE(notes,'') || $7, version=version+1, updated_at=$8, booking_group_id=COALESCE(NULLIF($12,''), booking_group_id)
         WHERE id=$9 AND tenant_id=$10 AND branch_id=$11
         RETURNING id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(&next_branch)
    .bind(&next_staff)
    .bind(&next_chair_room)
    .bind(service_ids_to_json(&next_service_ids))
    .bind(next_start)
    .bind(next_end)
    .bind(update_note)
    .bind(Utc::now())
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&payload.booking_group_id)
    .bind(&next_status)
    .fetch_one(&state.db)
    .await
    .map_err(|error| booking_write_error(error, "failed to reschedule"))?;

    let updated = build_appointment(&row)?;
    let mut activity_reason =
        if current.staff_id != next_staff && current.requested_staff_id != next_staff {
            if payload.staff_change_reason.trim().is_empty() {
                payload.staff_change_approval.trim().to_string()
            } else {
                payload.staff_change_reason.trim().to_string()
            }
        } else if calendar_move {
            "Moved on calendar".to_string()
        } else {
            payload.reason.trim().to_string()
        };
    if !payload.outside_hours_override_reason.trim().is_empty() {
        activity_reason.push_str(" · Outside-hours override: ");
        activity_reason.push_str(payload.outside_hours_override_reason.trim());
    }
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &updated,
        if calendar_move {
            "CALENDAR_MOVED"
        } else if approval_reschedule {
            "RESCHEDULE_APPROVED"
        } else if is_rescheduled {
            "BOOKING_RESCHEDULED"
        } else {
            "BOOKING_UPDATED"
        },
        &activity_reason,
    )
    .await?;
    Ok(Json(updated))
}

async fn reschedule_self_appointment(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut payload): Json<ReschedulePayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (_, branch_id, staff_id, current) =
        self_appointment(&state, &claims, &headers, &id).await?;
    let reason = payload.reason.trim();
    if !(3..=500).contains(&reason.chars().count()) {
        return Err(ApiError::bad_request(
            "reschedule reason must be between 3 and 500 characters",
        ));
    }
    let start_at = parse_datetime(&payload.start_at, "start_at")?;
    if start_at <= Utc::now() {
        return Err(ApiError::bad_request(
            "appointment must be rescheduled to a future time",
        ));
    }
    let current_start = parse_datetime(&current.start_at, "current.start_at")?;
    let current_end = parse_datetime(&current.end_at, "current.end_at")?;
    payload.staff_id = staff_id;
    payload.branch_id = branch_id;
    payload.end_at = Some((start_at + (current_end - current_start)).to_rfc3339());
    payload.service_ids.clear();
    payload.chair_room_id.clear();
    payload.booking_group_id.clear();
    payload.change_mode.clear();
    payload.staff_change_approval.clear();
    payload.staff_change_reason.clear();
    payload.actor_source = "staff-app".to_string();
    reschedule_appointment(State(state), None, headers, Path(id), Json(payload)).await
}

pub(crate) async fn check_in_appointment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    set_status(
        State(state),
        headers,
        Path(id),
        Json(StatusPayload {
            status: "arrived".to_string(),
            reason: "check-in".to_string(),
            apply_group: false,
        }),
    )
    .await
}

pub(crate) async fn start_service(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    set_status(
        State(state),
        headers,
        Path(id),
        Json(StatusPayload {
            status: "in-service".to_string(),
            reason: "service-start".to_string(),
            apply_group: false,
        }),
    )
    .await
}

pub(crate) async fn complete_appointment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(_payload): Json<StatusPayload>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    convert_to_sale(State(state), headers, Path(id)).await
}

pub(crate) async fn mark_no_show(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    set_status(
        State(state),
        headers,
        Path(id),
        Json(StatusPayload {
            status: "no-show".to_string(),
            reason: "no show".to_string(),
            apply_group: false,
        }),
    )
    .await
}

pub(crate) async fn mark_no_show_with_charge(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<NoShowChargePayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    if matches!(current.status.as_str(), "cancelled" | "billed" | "paid") {
        return Err(ApiError::conflict(
            "cancelled or billed appointments cannot receive a no-show charge",
        ));
    }
    let appointment = if current.status == "no-show" {
        current.clone()
    } else {
        set_status(
            State(state.clone()),
            headers,
            Path(id.clone()),
            Json(StatusPayload {
                status: "no-show".to_string(),
                reason: if payload.reason.trim().is_empty() {
                    "no show charge".to_string()
                } else {
                    payload.reason.trim().to_string()
                },
                apply_group: false,
            }),
        )
        .await?
        .0
    };
    let (configured_amount, _, configured_due) =
        configured_appointment_fee(&state, &appointment, "no_show").await?;
    if configured_due && payload.amount_paise != configured_amount {
        return Err(ApiError::bad_request(
            "fee amount must match the configured appointment policy",
        ));
    }
    let charge = pos::create_no_show_charge(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        &appointment.client_id,
        &appointment.staff_id,
        payload.amount_paise,
        &payload.provider,
        &payload.idempotency_key,
    )
    .await
    .map_err(|_| ApiError::internal("failed to create no-show payment collection"))?;
    if configured_due {
        sqlx::query("INSERT INTO appointment_fee_events(tenant_id,branch_id,appointment_id,fee_type,configured_paise,status,reason,actor_user_id,idempotency_key) VALUES($1,$2,$3,'no_show',$4,'charged',$5,'',$6) ON CONFLICT(tenant_id,branch_id,appointment_id,fee_type) DO UPDATE SET status='charged',reason=EXCLUDED.reason,updated_at=NOW() WHERE appointment_fee_events.status IN ('pending','charged')")
            .bind(&tenant_id).bind(&branch_id).bind(&id).bind(configured_amount).bind(payload.reason.trim()).bind(format!("appointment-fee:{id}:no_show"))
            .execute(&state.db).await.map_err(|_|ApiError::internal("failed to record no-show fee"))?;
    }
    Ok(Json(json!({"appointment": appointment, "charge": charge})))
}

pub(crate) async fn duplicate_appointment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let start = parse_datetime(&current.start_at, "start_at")? + Duration::days(7);
    let end = parse_datetime(&current.end_at, "end_at")? + Duration::days(7);
    let duplicate_payload = AppointmentCreatePayload {
        tenant_id: Some(current.tenant_id.clone()),
        branch_id: Some(current.branch_id.clone()),
        staff_id: current.staff_id.clone(),
        requested_staff_id: current.requested_staff_id.clone(),
        staff_preference: current.staff_preference.clone(),
        client_id: current.client_id.clone(),
        service_ids: current.service_ids.clone(),
        start_at: start.to_rfc3339(),
        end_at: end.to_rfc3339(),
        notes: format!("Duplicated from {}", current.id),
        status: "booked".to_string(),
        booking_group_id: current.booking_group_id.unwrap_or_default(),
        source_channel: Some(current.source_channel.clone()),
        source: Some(current.source.clone()),
        chair_room_id: current.chair_room_id.clone(),
        service_selections: Vec::new(),
    };

    let duplicate =
        create_booking_from_smart_booking(State(state), headers, Json(duplicate_payload)).await?;

    Ok(Json(AppointmentResponse {
        appointment: duplicate.0,
        waitlist_offer: None,
        sales_order: None,
    }))
}

struct AppointmentDraftContext {
    current: AppointmentPayload,
    reference_id: String,
    booking_group_id: String,
    appointments: Vec<AppointmentPayload>,
    draft: pos::AppointmentPosDraft,
}

async fn ensure_appointment_pos_draft(
    state: &AppState,
    headers: &HeaderMap,
    appointment_id: &str,
) -> Result<AppointmentDraftContext, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(headers, None, None);
    let current = find_appointment(state, &tenant_id, &branch_id, appointment_id).await?;
    if matches!(current.status.as_str(), "cancelled" | "no-show") {
        return Err(ApiError::conflict(
            "Cancelled or no-show appointments cannot be billed",
        ));
    }
    let booking_group_id = current
        .booking_group_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .to_string();
    let reference_id =
        pos::canonical_appointment_reference(state, &tenant_id, &branch_id, appointment_id)
            .await
            .map_err(|_| ApiError::internal("failed to resolve appointment invoice reference"))?;
    let apply_group = reference_id != appointment_id;
    let group_rows = sqlx::query(
        "SELECT id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2
           AND (id=$3 OR ($4::boolean AND booking_group_id=$5))
           AND status NOT IN ('cancelled', 'no-show')
         ORDER BY start_at, created_at",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(appointment_id)
    .bind(apply_group)
    .bind(&booking_group_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking group for billing"))?;
    let appointments = group_rows
        .iter()
        .map(build_appointment)
        .collect::<Result<Vec<_>, _>>()?;
    if appointments.is_empty() {
        return Err(ApiError::conflict(
            "No active appointment services are available to bill",
        ));
    }
    if appointments
        .iter()
        .any(|appointment| appointment.client_id != current.client_id)
    {
        return Err(ApiError::conflict(
            "Booking group services must belong to the same client before billing",
        ));
    }
    let existing = pos::find_appointment_pos_sale(state, headers, &reference_id)
        .await
        .map_err(|_| ApiError::internal("failed to load appointment invoice"))?;
    if existing.is_none()
        && appointments
            .iter()
            .any(|appointment| matches!(appointment.status.as_str(), "billed" | "paid"))
    {
        return Err(ApiError::conflict(
            "A booking group member is already linked to another invoice",
        ));
    }
    let draft = match existing {
        Some(existing) => existing,
        None => {
            let mut lines = Vec::new();
            for appointment in &appointments {
                for service_id in &appointment.service_ids {
                    let service =
                        services_repository::get(&state.db, &tenant_id, &branch_id, service_id)
                            .await
                            .map_err(|_| ApiError::internal("failed to load appointment service"))?
                            .ok_or_else(|| {
                                ApiError::conflict("Appointment service was not found")
                            })?;
                    lines.push(pos::appointment_service_line(
                        service.id,
                        service.name,
                        appointment.staff_id.clone(),
                        service.price_paise,
                        service.gst_percent,
                        service.sac_code,
                    ));
                }
            }
            if lines.is_empty() {
                return Err(ApiError::conflict(
                    "Appointment must have at least one service before billing",
                ));
            }
            pos::create_or_resume_appointment_draft(
                state,
                headers.clone(),
                &reference_id,
                &current.client_id,
                &current.staff_id,
                lines,
            )
            .await
            .map_err(map_pos_error)?
        }
    };
    Ok(AppointmentDraftContext {
        current,
        reference_id,
        booking_group_id,
        appointments,
        draft,
    })
}

pub(crate) async fn convert_to_sale(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let context = ensure_appointment_pos_draft(&state, &headers, &id).await?;
    let current = context.current;
    let reference_id = context.reference_id;
    let booking_group_id = context.booking_group_id;
    let appointments = context.appointments;
    let draft = context.draft;
    let apply_group = reference_id != id;
    let updated_rows = sqlx::query(
        "UPDATE appointments
         SET status='completed', version=version+1, updated_at=$1
         WHERE tenant_id=$2 AND branch_id=$3
           AND (id=$4 OR ($5::boolean AND booking_group_id=$6))
           AND status NOT IN ('cancelled', 'no-show', 'completed', 'billed', 'paid')
         RETURNING id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
    )
    .bind(Utc::now())
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&id)
    .bind(apply_group)
    .bind(&booking_group_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to complete appointment after invoice creation"))?;
    let updated_rows = updated_rows
        .iter()
        .map(build_appointment)
        .collect::<Result<Vec<_>, _>>()?;
    for updated in &updated_rows {
        if let Some(previous) = appointments
            .iter()
            .find(|appointment| appointment.id == updated.id)
        {
            if previous.status != updated.status {
                insert_activity(
                    &state,
                    &tenant_id,
                    Some(previous),
                    updated,
                    "COMPLETED",
                    "POS draft created",
                )
                .await?;
            }
        }
    }
    let appointment = updated_rows
        .iter()
        .find(|appointment| appointment.id == id)
        .cloned()
        .unwrap_or(current);
    let sale = SalePayload {
        sale_id: draft.sale_id,
        appointment_id: appointment.id.clone(),
        total: draft.total_paise / 100,
        total_paise: draft.total_paise,
        status: draft.status,
    };
    Ok(Json(AppointmentResponse {
        appointment,
        waitlist_offer: None,
        sales_order: Some(sale),
    }))
}

pub(crate) async fn list_blackouts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(scope_query): Query<ScopeQuery>,
) -> Result<Json<Vec<Value>>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        scope_query.tenant_id.as_deref(),
        scope_query.branch_id.as_deref(),
    );
    let rows = sqlx::query(
        "SELECT id, tenant_id, branch_id, staff_id, blackout_group_id, blackout_date, blocked_from, reason, blocked_until, created_at
         FROM appointment_blackouts
         WHERE tenant_id=$1 AND branch_id=$2 ORDER BY blackout_date DESC",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load blackouts"))?;

    let response: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let date: String = row.try_get("blackout_date").unwrap_or_default();
            let reason: String = row.try_get("reason").unwrap_or_default();
            let until: Option<DateTime<Utc>> = row.try_get("blocked_until").ok();
            let created_at: DateTime<Utc> =
                row.try_get("created_at").unwrap_or_else(|_| Utc::now());
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "tenantId": row.try_get::<String,_>("tenant_id").unwrap_or_default(),
                "branchId": row.try_get::<String,_>("branch_id").unwrap_or_default(),
                "staffId": row.try_get::<String,_>("staff_id").unwrap_or_default(),
                "blackoutGroupId": row.try_get::<String,_>("blackout_group_id").unwrap_or_default(),
                "blackoutDate": date,
                "blockedFrom": row.try_get::<Option<DateTime<Utc>>,_>("blocked_from").ok().flatten().map(|value| value.to_rfc3339()).unwrap_or_default(),
                "reason": reason,
                "blockedUntil": until.map(|value| value.to_rfc3339()).unwrap_or_default(),
                "createdAt": created_at.to_rfc3339(),
            })
        })
        .collect();
    Ok(Json(response))
}

pub(crate) async fn create_blackout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BlackoutPayload>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        payload.tenant_id.as_deref(),
        payload.branch_id.as_deref(),
    );
    let staff_ids = blackout_staff_ids(&payload);
    if payload.blackout_date.is_empty() {
        return Err(ApiError::bad_request("blackout_date required"));
    }
    let until = payload
        .blocked_until
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let until = parse_datetime(&until, "blocked_until")?;
    let from = payload
        .blocked_from
        .as_deref()
        .map(|value| parse_datetime(value, "blocked_from"))
        .transpose()?
        .ok_or_else(|| ApiError::bad_request("blocked_from required"))?;
    if until <= from {
        return Err(ApiError::bad_request(
            "blocked_until must be after blocked_from",
        ));
    }
    for staff_id in &staff_ids {
        let overlaps = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2
             AND ($3='' OR staff_id=$3) AND status NOT IN ('cancelled','no-show')
             AND start_at < $5 AND end_at > $4)",
        )
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(staff_id)
        .bind(from)
        .bind(until)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::internal("failed to validate blackout"))?;
        if overlaps {
            return Err(ApiError::conflict(
                "cannot block a time that already has appointments",
            ));
        }
    }
    let until_response = until.to_rfc3339();
    let from_response = from.to_rfc3339();
    let group_id = blackout_group_id(&staff_ids);
    let mut transaction = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::internal("failed to start blackout save"))?;
    let mut ids = Vec::with_capacity(staff_ids.len());
    for staff_id in &staff_ids {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO appointment_blackouts (
                id, tenant_id, branch_id, staff_id, blackout_group_id, blackout_date, blocked_from, reason, blocked_until, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())",
        )
        .bind(&id)
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(staff_id)
        .bind(&group_id)
        .bind(&payload.blackout_date)
        .bind(from)
        .bind(if payload.reason.is_empty() { "maintenance" } else { &payload.reason })
        .bind(until)
        .execute(&mut *transaction)
        .await
        .map_err(|_| ApiError::internal("failed to create blackout"))?;
        ids.push(id);
    }
    transaction
        .commit()
        .await
        .map_err(|_| ApiError::internal("failed to save blackouts"))?;

    Ok(Json(json!({
        "id": ids.first().cloned().unwrap_or_default(),
        "ids": ids,
        "tenantId": tenant_id,
        "branchId": branch_id,
        "staffId": staff_ids.first().cloned().unwrap_or_default(),
        "staffIds": staff_ids,
        "blackoutGroupId": group_id,
        "blackoutDate": payload.blackout_date,
        "blockedFrom": from_response,
        "blockedUntil": until_response,
        "reason": payload.reason,
        "status": "created"
    })))
}

async fn delete_blackout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let group_id = sqlx::query_scalar::<_, String>(
        "SELECT blackout_group_id FROM appointment_blackouts WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to find blackout"))?
    .ok_or_else(|| ApiError::not_found("blackout not found"))?;
    let affected = sqlx::query(
        "DELETE FROM appointment_blackouts
         WHERE tenant_id=$2 AND branch_id=$3
           AND (id=$1 OR ($4<>'' AND blackout_group_id=$4))",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&group_id)
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to delete blackout"))?
    .rows_affected();
    if affected == 0 {
        return Err(ApiError::not_found("blackout not found"));
    }
    Ok(Json(json!({ "id": id, "status": "deleted" })))
}

pub(crate) async fn save_wizard_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, _branch_id) = scope_from_headers(&headers, None, None);
    let session_id = payload
        .get("sessionId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let step = payload.get("step").and_then(Value::as_i64).unwrap_or(0);
    let customer_id = payload
        .get("customerId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let state_json = payload.to_string();

    let _ = sqlx::query(
        "INSERT INTO booking_wizard_state (session_id, tenant_id, customer_id, step, state_json, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         ON CONFLICT(session_id) DO UPDATE SET
            customer_id=EXCLUDED.customer_id,
            step=EXCLUDED.step,
            state_json=EXCLUDED.state_json,
            updated_at=NOW(),
            expires_at=EXCLUDED.expires_at",
    )
    .bind(&session_id)
    .bind(&tenant_id)
    .bind(&customer_id)
    .bind(step)
    .bind(state_json)
    .bind(Utc::now() + Duration::hours(12))
    .execute(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to save wizard state"))?;

    Ok(Json(json!({
        "sessionId": session_id,
        "tenantId": tenant_id,
        "step": step,
        "status": "saved"
    })))
}

pub(crate) async fn get_wizard_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, _branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query(
        "SELECT session_id, tenant_id, customer_id, step, state_json
         FROM booking_wizard_state WHERE session_id=$1 AND tenant_id=$2 AND expires_at > NOW()",
    )
    .bind(&session_id)
    .bind(&tenant_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load wizard state"))?
    .ok_or_else(|| ApiError::not_found("wizard state not found or expired"))?;

    let state_json: String = row
        .try_get("state_json")
        .map_err(|_| ApiError::internal("invalid wizard state"))?;
    let step: i64 = row
        .try_get("step")
        .map_err(|_| ApiError::internal("invalid wizard state"))?;
    let customer_id: String = row
        .try_get("customer_id")
        .map_err(|_| ApiError::internal("invalid wizard state"))?;

    let parsed_state: Value = serde_json::from_str(&state_json)
        .map_err(|_| ApiError::internal("wizard state JSON decode failed"))?;
    Ok(Json(json!({
        "sessionId": session_id,
        "tenantId": tenant_id,
        "customerId": customer_id,
        "step": step,
        "state": parsed_state
    })))
}

pub(crate) async fn clear_wizard_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, _branch_id) = scope_from_headers(&headers, None, None);
    let affected =
        sqlx::query("DELETE FROM booking_wizard_state WHERE session_id=$1 AND tenant_id=$2")
            .bind(&session_id)
            .bind(&tenant_id)
            .execute(&state.db)
            .await
            .map_err(|_| ApiError::internal("failed to clear wizard state"))?
            .rows_affected();
    if affected == 0 {
        return Err(ApiError::not_found("wizard state not found"));
    }
    Ok(Json(
        json!({ "sessionId": session_id, "status": "deleted" }),
    ))
}

pub(crate) async fn create_booking_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BookingGroupPayload>,
) -> Result<Json<BookingGroupPayloadOut>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        payload.tenant_id.as_deref(),
        payload.branch_id.as_deref(),
    );
    let id = uuid::Uuid::new_v4().to_string();
    let members_json = service_ids_to_json(&payload.member_appointment_ids);
    let row = sqlx::query(
        "INSERT INTO booking_groups (
            id, tenant_id, branch_id, group_name, members_json, status, consolidated_billing, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,'planning',false,NOW(),NOW())
         RETURNING id, tenant_id, branch_id, group_name, members_json, status, consolidated_billing",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(if payload.group_name.is_empty() {
        "booking-group"
    } else {
        &payload.group_name
    })
    .bind(&members_json)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to create booking group"))?;

    let members = parse_service_ids(&row.try_get::<String, _>("members_json").unwrap_or_default());
    Ok(Json(BookingGroupPayloadOut {
        id: row.try_get("id").unwrap_or_default(),
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        branch_id: row.try_get("branch_id").unwrap_or_default(),
        group_name: row.try_get("group_name").unwrap_or_default(),
        members,
        status: row
            .try_get("status")
            .unwrap_or_else(|_| "planning".to_string()),
        consolidated_billing: row.try_get("consolidated_billing").unwrap_or(false),
    }))
}

pub(crate) async fn get_booking_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<BookingGroupPayloadOut>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query(
        "SELECT id, tenant_id, branch_id, group_name, members_json, status, consolidated_billing
         FROM booking_groups WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking group"))?
    .ok_or_else(|| ApiError::not_found("booking group not found"))?;

    let members = parse_service_ids(&row.try_get::<String, _>("members_json").unwrap_or_default());
    Ok(Json(BookingGroupPayloadOut {
        id: row.try_get("id").unwrap_or_default(),
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        branch_id: row.try_get("branch_id").unwrap_or_default(),
        group_name: row.try_get("group_name").unwrap_or_default(),
        members,
        status: row
            .try_get("status")
            .unwrap_or_else(|_| "planning".to_string()),
        consolidated_billing: row.try_get("consolidated_billing").unwrap_or(false),
    }))
}

pub(crate) async fn update_booking_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<BookingGroupUpdatePayload>,
) -> Result<Json<BookingGroupPayloadOut>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let status = payload
        .status
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "planning".to_string());
    let row = sqlx::query(
        "UPDATE booking_groups SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND branch_id=$4
         RETURNING id, tenant_id, branch_id, group_name, members_json, status, consolidated_billing",
    )
    .bind(&status)
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to update booking group"))?;

    let members = parse_service_ids(&row.try_get::<String, _>("members_json").unwrap_or_default());
    Ok(Json(BookingGroupPayloadOut {
        id: row.try_get("id").unwrap_or_default(),
        tenant_id: row.try_get("tenant_id").unwrap_or_default(),
        branch_id: row.try_get("branch_id").unwrap_or_default(),
        group_name: row.try_get("group_name").unwrap_or_default(),
        members,
        status: row
            .try_get("status")
            .unwrap_or_else(|_| "planning".to_string()),
        consolidated_billing: row.try_get("consolidated_billing").unwrap_or(false),
    }))
}

pub(crate) async fn confirm_booking_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query(
        "UPDATE booking_groups SET status='confirmed', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3
         RETURNING id, status",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to confirm booking group"))?;
    Ok(Json(json!({
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "status": row.try_get::<String,_>("status").unwrap_or_else(|_| "confirmed".to_string()),
        "consolidation": false
    })))
}

pub(crate) async fn consolidate_group_billing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let row = sqlx::query(
        "UPDATE booking_groups
         SET consolidated_billing=true, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3
         RETURNING id, group_name, status, consolidated_billing",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to consolidate booking billing"))?;
    Ok(Json(json!({
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "groupName": row.try_get::<String,_>("group_name").unwrap_or_default(),
        "status": row.try_get::<String,_>("status").unwrap_or_default(),
        "consolidatedBilling": row.try_get::<bool,_>("consolidated_billing").unwrap_or(false)
    })))
}

pub(crate) async fn group_calendar_view(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let group = sqlx::query(
        "SELECT members_json FROM booking_groups WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(&id)
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load booking group"))?
    .ok_or_else(|| ApiError::not_found("booking group not found"))?;
    let members = parse_service_ids(
        &group
            .try_get::<String, _>("members_json")
            .unwrap_or_default(),
    );
    let mut calendar = Vec::new();
    for member in members {
        if let Ok(appointment) = find_appointment(&state, &tenant_id, &branch_id, &member).await {
            calendar.push(appointment);
        }
    }
    Ok(Json(json!({
        "groupId": id,
        "tenantId": tenant_id,
        "calendar": calendar
    })))
}

async fn resolve_service_chain(
    State(_state): State<AppState>,
    Json(payload): Json<ResolveServicesPayload>,
) -> Result<Json<Value>, ApiError> {
    let services = if payload.service_ids.is_empty() {
        Vec::<String>::new()
    } else {
        payload.service_ids.clone()
    };
    Ok(Json(json!({
        "services": services.iter().cloned().collect::<Vec<_>>(),
        "resolved": services
    })))
}

async fn validate_service_combo(
    State(_state): State<AppState>,
    Json(payload): Json<ResolveServicesPayload>,
) -> Result<Json<Value>, ApiError> {
    let has_combo = payload.service_ids.len() > 2;
    Ok(Json(json!({
        "valid": true,
        "warnings": if has_combo { vec!["Large combo selected".to_string()] } else { vec![] },
        "serviceCount": payload.service_ids.len()
    })))
}

pub(crate) async fn read_audit(
    state: &AppState,
    tenant_id: &str,
    appointment_id: &str,
) -> Result<Vec<Value>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, tenant_id, appointment_id, action, old_status, new_status, reason, created_at
         FROM appointment_activity
         WHERE tenant_id=$1 AND appointment_id=$2 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(tenant_id)
    .bind(appointment_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment audit"))?;

    let logs: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let created_at: DateTime<Utc> =
                row.try_get("created_at").unwrap_or_else(|_| Utc::now());
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "appointmentId": row.try_get::<String,_>("appointment_id").unwrap_or_default(),
                "action": row.try_get::<String,_>("action").unwrap_or_default(),
                "oldStatus": row.try_get::<String,_>("old_status").unwrap_or_default(),
                "newStatus": row.try_get::<String,_>("new_status").unwrap_or_default(),
                "reason": row.try_get::<String,_>("reason").unwrap_or_default(),
                "createdAt": created_at.to_rfc3339(),
            })
        })
        .collect();

    Ok(logs)
}

async fn appointment_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let _appointment = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
    let logs = read_audit(&state, &tenant_id, &id).await?;
    Ok(Json(json!({
        "appointmentId": id,
        "tenantId": tenant_id,
        "auditLogs": logs
    })))
}

pub(crate) async fn staff_ical_feed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
) -> impl IntoResponse {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let rows = sqlx::query(
        "SELECT id, tenant_id, branch_id, client_id, staff_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
         ORDER BY start_at DESC LIMIT 100",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(&staff_id)
    .fetch_all(&state.db)
    .await;

    let (appointments, error): (Vec<AppointmentPayload>, Option<String>) = match rows {
        Ok(data) => {
            let items: Result<Vec<_>, ApiError> = data
                .into_iter()
                .map(|row| build_appointment(&row))
                .collect();
            match items {
                Ok(values) => (values, None),
                Err(err) => (Vec::new(), Some(err.error)),
            }
        }
        Err(_) => (Vec::new(), Some("database query failed".to_string())),
    };

    if let Some(message) = error {
        let body = message;
        return (StatusCode::INTERNAL_SERVER_ERROR, body).into_response();
    }

    let body = build_ics_feed(&staff_id, "staff", appointments);
    let header = HeaderValue::from_static("text/calendar; charset=utf-8");
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, header)],
        body,
    )
        .into_response()
}

pub(crate) async fn branch_ical_feed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(branch_id): Path<String>,
) -> impl IntoResponse {
    let (tenant_id, branch_scope) = scope_from_headers(&headers, None, None);
    if branch_scope != branch_id {
        return (StatusCode::NOT_FOUND, "calendar not found".to_string()).into_response();
    }
    let rows = sqlx::query(
        "SELECT id, tenant_id, branch_id, client_id, staff_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2
         ORDER BY start_at DESC LIMIT 100",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await;

    let (appointments, error): (Vec<AppointmentPayload>, Option<String>) = match rows {
        Ok(data) => {
            let items: Result<Vec<_>, ApiError> = data
                .into_iter()
                .map(|row| build_appointment(&row))
                .collect();
            match items {
                Ok(values) => (values, None),
                Err(err) => (Vec::new(), Some(err.error)),
            }
        }
        Err(_) => (Vec::new(), Some("database query failed".to_string())),
    };

    if let Some(message) = error {
        return (StatusCode::INTERNAL_SERVER_ERROR, message).into_response();
    }

    let body = build_ics_feed(&branch_id, "branch", appointments);
    let header = HeaderValue::from_static("text/calendar; charset=utf-8");
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, header)],
        body,
    )
        .into_response()
}

async fn booking_attribution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(scope_query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        scope_query.tenant_id.as_deref(),
        scope_query.branch_id.as_deref(),
    );
    let rows = sqlx::query(
        "SELECT COALESCE(source_channel, 'manual') as channel, COUNT(*) as count
         FROM appointments
         WHERE tenant_id=$1 AND branch_id=$2
         GROUP BY COALESCE(source_channel, 'manual')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to build attribution report"))?;

    let mut channels: Vec<Value> = Vec::new();
    for row in rows {
        channels.push(json!({
            "source": row.try_get::<String,_>("channel").unwrap_or_default(),
            "count": row.try_get::<i64,_>("count").unwrap_or(0)
        }));
    }
    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "channels": channels
    })))
}

async fn warranty_cost_impact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(scope_query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(
        &headers,
        scope_query.tenant_id.as_deref(),
        scope_query.branch_id.as_deref(),
    );
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND COALESCE(notes,'') ILIKE '%warranty%'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);
    Ok(Json(json!({
        "tenantId": tenant_id,
        "branchId": branch_id,
        "warrantyAppointments": count,
        "estimatedImpact": count * 0
    })))
}
