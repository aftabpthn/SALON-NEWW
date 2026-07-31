use crate::{
    repositories::{payment_methods_repository, services_repository},
    routes::{context::current_business_date, pos},
    services::{
        accounting_service,
        auth_service::{self, AuthClaims},
        benefit_notification_service, booking_intelligence_service, cash_drawer_service,
        service_pricing_service, staff_enterprise_service, wallet_service,
    },
    state::{AppState, AppointmentEvent},
};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, FixedOffset, Utc};
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
}

#[derive(Serialize)]
pub(crate) struct AppointmentResourceResponse {
    id: String,
    name: String,
    kind: String,
    department: String,
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
) -> Result<i64, ApiError> {
    let selections = selections
        .iter()
        .map(|selection| (selection.service_id.trim(), selection))
        .collect::<std::collections::HashMap<_, _>>();
    let mut total = 0i64;
    for service_id in service_ids {
        let selection = selections.get(service_id.trim()).copied();
        let quote = service_pricing_service::quote(
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

fn normalize_staff_preference(value: &str) -> Result<&str, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "any" => Ok("any"),
        "preferred" => Ok("preferred"),
        "required" => Ok("required"),
        _ => Err(ApiError::bad_request(
            "staff_preference must be any, preferred, or required",
        )),
    }
}

fn booking_activity_reason(appointment: &AppointmentPayload) -> String {
    match appointment.staff_preference.as_str() {
        "preferred" => "booking saved · preferred staff requested".to_string(),
        "required" => "booking saved · required staff requested".to_string(),
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
        "SELECT id, tenant_id, branch_id, client_id, staff_id, requested_staff_id, staff_preference, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at
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
    let rows = sqlx::query("SELECT id, name, kind, department, active FROM appointment_resources WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY department, kind, name")
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
    let kind = match payload.kind.trim().to_ascii_lowercase().as_str() {
        "room" => "room",
        "workstation" => "workstation",
        _ => "chair",
    };
    let department = payload.department.trim();
    if department.len() > 80 {
        return Err(ApiError::bad_request("resource department is too long"));
    }
    let department = if department.is_empty() {
        "Unassigned"
    } else {
        department
    };
    let row = sqlx::query("INSERT INTO appointment_resources (id, tenant_id, branch_id, name, kind, department) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, kind, department, active")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&tenant_id)
        .bind(&branch_id)
        .bind(name)
        .bind(kind)
        .bind(department)
        .fetch_one(&state.db)
        .await
        .map_err(|_| ApiError::conflict("chair or room already exists"))?;
    Ok(Json(AppointmentResourceResponse {
        id: row.try_get("id").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        kind: row.try_get("kind").unwrap_or_default(),
        department: row.try_get("department").unwrap_or_default(),
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
        headers,
        Path(appointment_id),
        Json(ReschedulePayload {
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
    let exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM appointment_resources WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND active=TRUE)")
        .bind(chair_room_id).bind(tenant_id).bind(branch_id).fetch_one(&state.db).await
        .map_err(|_| ApiError::internal("failed to validate chair or room"))?;
    if !exists {
        return Err(ApiError::bad_request(
            "selected chair or room is unavailable",
        ));
    }
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
    let overlaps = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND chair_room_id=$3 AND status NOT IN ('cancelled','no-show') AND start_at < $5 AND end_at > $4 AND ($6='' OR id<>$6))")
        .bind(tenant_id).bind(branch_id).bind(chair_room_id).bind(start_at).bind(end_at).bind(exclude_appointment_id.unwrap_or_default())
        .fetch_one(&state.db).await.map_err(|_| ApiError::internal("failed to check chair or room availability"))?;
    if overlaps {
        return Err(ApiError::conflict(
            "chair or room is already booked for this time",
        ));
    }
    Ok(())
}

async fn validate_staff_blackout(
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
             SELECT 1 FROM staff_leave_requests lr, slot
             WHERE lr.tenant_id=$1 AND lr.branch_id=$2 AND lr.staff_id=$3
               AND lr.status='approved'
               AND slot.business_date BETWEEN lr.start_date AND lr.end_date
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
        "SELECT duration_minutes, wait_time_minutes, cleanup_time_minutes, buffer_time_minutes
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
    let processing = i64::from(timing.try_get::<i32, _>("wait_time_minutes").unwrap_or(0));
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

async fn validate_staff_booking_availability(
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
    let requested_staff_id = if staff_preference == "any" {
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
    .map_err(|_| ApiError::internal("failed to create appointment"))?;
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
        "SELECT id, customer_id, service_ids_json, preferred_slot_at, status, notes, constraint_type, constraint_resource_kind, created_at
         FROM appointment_waitlist
         WHERE tenant_id=$1 AND branch_id=$2 AND status='pending'
         ORDER BY preferred_slot_at, created_at",
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
    })).collect()))
}

async fn delete_waitlist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let affected = sqlx::query(
        "DELETE FROM appointment_waitlist WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status='pending'",
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
    Ok(Json(json!({ "id": id, "status": "deleted" })))
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
        "SELECT id,customer_id,notes FROM appointment_waitlist
         WHERE tenant_id=$1 AND branch_id=$2 AND status='pending'
           AND service_ids_json=$3
           AND (preferred_staff_id IS NULL OR preferred_staff_id=$4)
           AND preferred_slot_at::date=$5::date
         ORDER BY CASE WHEN preferred_staff_id=$4 THEN 0 ELSE 1 END,preferred_slot_at,created_at
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
    let expires_at = Utc::now() + Duration::minutes(10);
    let inserted = sqlx::query(
        "INSERT INTO appointment_waitlist_offers (id,tenant_id,branch_id,waitlist_id,source_appointment_id,offered_appointment_id,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (waitlist_id,source_appointment_id) DO NOTHING",
    )
    .bind(&offer_id)
    .bind(&appointment.tenant_id)
    .bind(&appointment.branch_id)
    .bind(&waitlist_id)
    .bind(&appointment.id)
    .bind(&offered_appointment_id)
    .bind(expires_at)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::internal("failed to create waitlist offer"))?;
    if inserted.rows_affected() != 1 {
        return Ok(None);
    }
    sqlx::query("UPDATE appointment_waitlist SET status='offered',updated_at=NOW() WHERE id=$1 AND status='pending'")
        .bind(&waitlist_id)
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
        sqlx::query("UPDATE appointment_waitlist SET status='expired',updated_at=NOW() WHERE id=$1 AND status='offered'")
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
    payload: AppointmentBatchPayload,
    actor_claims: Option<AuthClaims>,
) -> Result<Json<Vec<AppointmentPayload>>, ApiError> {
    let actor_user_id = actor_claims.as_ref().map(|claims| claims.sub.as_str());
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let client_id = payload.client_id.trim();
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
    for line in &payload.lines {
        let line_client_id = booking_line_client_id(client_id, line.client_id.trim());
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
            let booked_total_paise = validate_service_pricing(
                &state,
                &tenant_id,
                &branch_id,
                line.staff_id.trim(),
                &[line.service_id.trim().to_string()],
                std::slice::from_ref(&selection),
                start_at,
            )
            .await?;
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
             SET status='cancelled', notes=COALESCE(notes,'') || ' | Service removed from booking', version=version+1, updated_at=$1
             WHERE id=$2 AND tenant_id=$3 AND branch_id=$4
             RETURNING id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json, start_at, end_at, status, notes, source_channel, source, booking_group_id, version, created_at, updated_at",
        )
        .bind(now)
        .bind(appointment_id)
        .bind(&tenant_id)
        .bind(&branch_id)
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
            let requested_staff_id = if staff_preference == "any" {
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
                     version=version+1, updated_at=$11, requested_staff_id=$15, staff_preference=$16
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
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("failed to update appointment service"))?
            } else {
                let id = uuid::Uuid::new_v4().to_string();
                sqlx::query(
                "INSERT INTO appointments (
                    id, tenant_id, branch_id, client_id, staff_id, chair_room_id, service_ids_json,
                    service_selections_json, start_at, end_at, status, notes, source_channel, source,
                    booking_group_id, recurrence_series_id, booked_total_paise, requested_staff_id, staff_preference, version, created_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8::jsonb,$9,$10,$11,$12,'manual','manual',NULLIF($13,''),$14,$15,$16,$17,1,$18,$19)
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
            .bind(now)
            .bind(now)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ApiError::internal("failed to create appointment service"))?
            };
            let updated = build_appointment(&row)?;
            let activity_reason = recommendation_audit_reason(
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
            });
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
    let booking_group_id = current.booking_group_id.clone().unwrap_or_default();
    let apply_group = payload.apply_group && !booking_group_id.trim().is_empty();
    sqlx::query(
        "UPDATE appointments
         SET status=$1, notes = CASE WHEN COALESCE($2,'') = '' THEN notes ELSE COALESCE(notes,'') || ' | ' || $2 END, version = version + 1, updated_at=$3
         WHERE tenant_id=$5 AND branch_id=$6
           AND (id=$4 OR ($7 AND booking_group_id=$8))",
    )
    .bind(&status)
    .bind(if payload.reason.is_empty() { None::<String> } else { Some(payload.reason) })
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
    insert_activity(
        &state,
        &tenant_id,
        Some(&current),
        &updated,
        activity_action_for_status(&updated.status),
        "",
    )
    .await?;
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
           AND (id=$3 OR ($4::boolean AND booking_group_id=$5))",
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
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await
            .map_err(|error| ApiError::with_status(error.status_code(), error.message()))?;
    let appointment = find_appointment(state, &tenant_id, &branch_id, appointment_id).await?;
    if appointment.staff_id != staff_id {
        return Err(ApiError::not_found("Appointment not found"));
    }
    Ok((tenant_id, branch_id, staff_id, appointment))
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
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReschedulePayload>,
) -> Result<Json<AppointmentPayload>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
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
    .map_err(|_| ApiError::internal("failed to reschedule"))?;

    let updated = build_appointment(&row)?;
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
        if current.staff_id != next_staff && current.requested_staff_id != next_staff {
            if payload.staff_change_reason.trim().is_empty() {
                payload.staff_change_approval.trim()
            } else {
                payload.staff_change_reason.trim()
            }
        } else {
            if calendar_move {
                "Moved on calendar"
            } else {
                payload.reason.trim()
            }
        },
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
    reschedule_appointment(State(state), headers, Path(id), Json(payload)).await
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
                reason: "no show charge".to_string(),
                apply_group: false,
            }),
        )
        .await?
        .0
    };
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

pub(crate) async fn convert_to_sale(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<AppointmentResponse>, ApiError> {
    let (tenant_id, branch_id) = scope_from_headers(&headers, None, None);
    let current = find_appointment(&state, &tenant_id, &branch_id, &id).await?;
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
    let reference_id = pos::canonical_appointment_reference(&state, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| ApiError::internal("failed to resolve appointment invoice reference"))?;
    let apply_group = reference_id != id;
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
    .bind(&id)
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

    let existing = pos::find_appointment_pos_sale(&state, &headers, &reference_id)
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
                &state,
                headers,
                &reference_id,
                &current.client_id,
                &current.staff_id,
                lines,
            )
            .await
            .map_err(|_| ApiError::internal("failed to create appointment invoice"))?
        }
    };
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
