use std::collections::HashSet;

use axum::{
    body::{Body, Bytes},
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue},
    response::Response,
    routing::get,
    Extension, Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    config::is_local_env,
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        ai_scope_repository,
        clients_repository::{
            self, ClientAppointmentHistoryRecord, ClientAuditRecord, ClientClinicalProfileRecord,
            ClientCommunicationRecord, ClientConsentEventRecord, ClientContactPreferencesRecord,
            ClientCrossLocationVisitRecord, ClientDiscountRuleWrite, ClientDuplicateRecord,
            ClientFamilyMemberRecord, ClientFormDefinitionRecord, ClientFormSubmissionRecord,
            ClientInvoiceHistoryRecord, ClientMasterWrite, ClientMergeHistoryRecord,
            ClientNoteRecord, ClientProfile360Record, ClientRecord, ClientReportFilters,
            ClientReviewRecord, ClientServiceHistoryRecord, ClientSoapNoteRecord,
            ClientSummaryRecord, ClientTimelineEventRecord, ClientTreatmentPhotoRecord,
            ClientWinBackOfferWrite, CreateClient, UpdateClient,
        },
    },
    routes::context::tenant_branch,
    services::{
        auth_service::{self, AuthClaims},
        client_service, migration_file_service, staff_enterprise_service,
    },
    state::{AppState, AppointmentEvent},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/clients", get(list_clients).post(create_client))
        .route(
            "/settings/clients/custom-form",
            get(get_client_custom_form_settings)
                .put(save_client_custom_form_settings)
                .patch(save_client_custom_form_settings),
        )
        .route("/clients/bulk/export", get(bulk_export_clients))
        .route(
            "/clients/bulk/import",
            axum::routing::post(bulk_import_clients),
        )
        .route(
            "/clients/reports/:report_type/export",
            get(export_client_branch_report),
        )
        .route("/clients/reports/:report_type", get(client_report))
        .route("/clients/masters/summary", get(client_masters_summary))
        .route("/client-masters/summary", get(client_masters_summary))
        .route(
            "/clients/return-tracker/:view",
            get(get_branch_return_tracker),
        )
        .route(
            "/clients/masters/:kind",
            get(list_client_masters).post(create_client_master),
        )
        .route(
            "/clients/masters/:kind/:master_id",
            axum::routing::patch(update_client_master),
        )
        .route("/client-masters/:kind", get(list_client_masters))
        .route("/clients/master-audit/:kind", get(list_client_master_audit))
        .route(
            "/clients/discount-rules",
            get(list_discount_rules).post(create_discount_rule),
        )
        .route(
            "/clients/discount-rules/:rule_id",
            axum::routing::patch(update_discount_rule),
        )
        .route(
            "/clients/discount-decisions/:decision_id/approve",
            axum::routing::post(approve_discount_decision),
        )
        .route("/clients/:id/timeline", get(get_client_timeline))
        .route("/clients/:id/block", axum::routing::post(block_client))
        .route("/clients/:id/unblock", axum::routing::post(unblock_client))
        .route(
            "/clients/:id",
            get(get_client).patch(update_client).delete(delete_client),
        )
        .route(
            "/clients/:id/memory-graph",
            get(get_client_memory_graph).post(rebuild_client_memory_graph),
        )
        .route(
            "/clients/:id/recommendation-feedback",
            get(list_recommendation_feedback).post(create_recommendation_feedback),
        )
        .route("/clients/:id/segment-history", get(list_segment_history))
        .route("/clients/:id/automations", get(list_client_automations))
        .route("/clients/:id/growth", get(get_client_growth))
        .route(
            "/clients/:id/discount-decisions",
            axum::routing::post(evaluate_client_discount),
        )
        .route(
            "/clients/:id/win-back-offers",
            axum::routing::post(create_win_back_offer),
        )
        .route(
            "/clients/:id/win-back-offers/:offer_id/redeem",
            axum::routing::post(redeem_win_back_offer),
        )
        .route("/clients/:id/report/export", get(export_client_report))
        .route(
            "/clients/:id/contact-preferences",
            axum::routing::patch(save_contact_preferences),
        )
        .route("/clients/:id/merge", axum::routing::post(merge_client))
        .route(
            "/clients/:id/merge/:source_id/reverse",
            axum::routing::post(reverse_client_merge),
        )
        .route(
            "/clients/:id/profile-360",
            axum::routing::put(save_client_profile_360),
        )
        .route("/clients/:id/audit", get(list_client_audit))
        .route(
            "/clients/:id/reviews",
            axum::routing::post(create_review_link),
        )
        .route(
            "/clients/:id/notes",
            get(list_client_notes).post(create_client_note),
        )
        .route(
            "/clients/forms/definitions",
            get(list_form_definitions).post(create_form_definition),
        )
        .route(
            "/clients/:id/form-submissions",
            axum::routing::post(create_form_submission),
        )
        .route(
            "/clients/:id/soap-notes",
            get(list_soap_notes).post(create_soap_note),
        )
        .route(
            "/clients/:id/soap-notes/:note_id",
            axum::routing::patch(update_soap_note),
        )
        .route(
            "/clients/:id/treatment-photos",
            axum::routing::post(upload_treatment_photo),
        )
        .route(
            "/clients/:id/treatment-photos/:photo_id",
            axum::routing::patch(update_treatment_photo).delete(delete_treatment_photo),
        )
        .route(
            "/clients/:id/treatment-photos/:photo_id/content",
            get(get_treatment_photo),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360",
            get(staff_guest_360),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/notes",
            axum::routing::post(staff_guest_note),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/clinical-profile",
            axum::routing::put(staff_guest_clinical_profile),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/forms",
            axum::routing::post(staff_guest_form),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/forms/:submission_id/reviews",
            axum::routing::post(staff_guest_form_review),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/photos",
            axum::routing::post(staff_guest_photo),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/photos/:photo_id/content",
            get(staff_guest_photo_content),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/photos/:photo_id",
            axum::routing::delete(staff_guest_photo_delete),
        )
        .route(
            "/staff-self/appointments/:appointment_id/guest-360/contact-preferences",
            axum::routing::patch(staff_guest_contact_preferences),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientListQuery {
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientReportQuery {
    days: Option<i32>,
    limit: Option<i64>,
    min_lifetime_value_paise: Option<i64>,
    min_visits: Option<i64>,
    segment: Option<String>,
    max_churn_risk_score: Option<i32>,
    include_unpaid: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientReturnTrackerQuery {
    days: Option<i32>,
    status: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientMasterWriteRequest {
    code: String,
    name: String,
    description: Option<String>,
    definition: Option<Value>,
    status: Option<String>,
    version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientCustomFormSettingsRequest {
    fields: Option<Value>,
    settings: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientDiscountRuleRequest {
    name: String,
    segments: Option<Vec<String>>,
    service_categories: Option<Vec<String>>,
    min_lifetime_value_paise: Option<i64>,
    max_discount_bps: i32,
    clv_budget_bps: Option<i32>,
    approval_above_bps: Option<i32>,
    membership_eligible: Option<bool>,
    wallet_eligible: Option<bool>,
    active: Option<bool>,
    priority: Option<i32>,
    version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientDiscountRequest {
    service_category: String,
    subtotal_paise: i64,
    requested_discount_bps: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientWinBackOfferRequest {
    decision_id: Option<String>,
    offer_code: Option<String>,
    title: String,
    offered_discount_bps: i32,
    discount_cost_paise: Option<i64>,
    return_window_days: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RedeemWinBackOfferRequest {
    sale_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecommendationFeedbackRequest {
    recommendation: String,
    decision: String,
    comment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BulkClientImportRequest {
    clients: Vec<ClientWriteRequest>,
}

struct ValidatedClientMaster {
    code: String,
    name: String,
    description: String,
    definition: Value,
    status: String,
}

struct ValidatedDiscountRule {
    name: String,
    segments: Vec<String>,
    service_categories: Vec<String>,
    min_lifetime_value_paise: i64,
    max_discount_bps: i32,
    clv_budget_bps: i32,
    approval_above_bps: i32,
    membership_eligible: bool,
    wallet_eligible: bool,
    active: bool,
    priority: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientWriteRequest {
    pub code: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub membership_label: Option<String>,
    pub categories: Option<Vec<String>>,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientResponse {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub code: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub normalized_phone: String,
    pub email: String,
    pub wallet_balance_paise: i64,
    pub duplicate_count: i64,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub membership_label: String,
    pub categories: Value,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: String,
    pub active: bool,
    pub preferred_staff_id: Option<String>,
    pub preferred_staff_name: String,
    pub preferred_communication_channel: String,
    pub whatsapp_opt_in: Option<bool>,
    pub sms_opt_in: Option<bool>,
    pub email_opt_in: Option<bool>,
    pub merged_into_client_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client360Response {
    #[serde(flatten)]
    pub client: ClientResponse,
    pub summary: ClientSummaryRecord,
    pub appointments: Vec<ClientAppointmentHistoryRecord>,
    pub invoices: Vec<ClientInvoiceHistoryRecord>,
    pub service_history: Vec<ClientServiceHistoryRecord>,
    pub client_notes: Vec<ClientNoteRecord>,
    pub family_members: Vec<ClientFamilyMemberRecord>,
    pub clinical_profile: Option<ClientClinicalProfileRecord>,
    pub soap_notes: Vec<ClientSoapNoteRecord>,
    pub form_definitions: Vec<ClientFormDefinitionRecord>,
    pub form_submissions: Vec<ClientFormSubmissionRecord>,
    pub treatment_photos: Vec<ClientTreatmentPhotoRecord>,
    pub duplicates: Vec<ClientDuplicateRecord>,
    pub consent_history: Vec<ClientConsentEventRecord>,
    pub communications: Vec<ClientCommunicationRecord>,
    pub reviews: Vec<ClientReviewRecord>,
    pub profile: Option<ClientProfile360Record>,
    pub merge_history: Vec<ClientMergeHistoryRecord>,
    pub cross_location_visits: Vec<ClientCrossLocationVisitRecord>,
    pub financial_exposure: Value,
    pub attribution: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientTimelineQuery {
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientTimelineResponse {
    items: Vec<ClientTimelineEventRecord>,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientNoteRequest {
    note_type: Option<String>,
    note: String,
    appointment_id: Option<String>,
    visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientFormDefinitionRequest {
    form_key: String,
    name: String,
    form_type: String,
    body: Option<String>,
    fields: Value,
    requires_signature: Option<bool>,
    scope_type: Option<String>,
    scope_ids: Option<Vec<String>>,
    required: Option<bool>,
    valid_for_days: Option<i32>,
    review_required: Option<bool>,
    staff_mode_allowed: Option<bool>,
    guest_mode_allowed: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientClinicalProfileRequest {
    allergies: Option<String>,
    preferences: Option<String>,
    expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientFormSubmissionRequest {
    definition_id: String,
    responses: Value,
    signature_name: Option<String>,
    consent_accepted: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientSoapNoteRequest {
    appointment_id: Option<String>,
    subjective: Option<String>,
    objective: Option<String>,
    assessment: Option<String>,
    plan: Option<String>,
    status: Option<String>,
    expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreatmentPhotoQuery {
    file_name: String,
    caption: Option<String>,
    appointment_id: Option<String>,
    photo_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TreatmentPhotoUpdateRequest {
    caption: Option<String>,
    photo_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffGuestNoteRequest {
    note_type: Option<String>,
    note: String,
    visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffGuestFormRequest {
    submission_id: Option<String>,
    definition_id: String,
    responses: Value,
    service_id: Option<String>,
    membership_id: Option<String>,
    package_id: Option<String>,
    mode: Option<String>,
    status: String,
    corrects_submission_id: Option<String>,
    correction_reason: Option<String>,
    signature_name: Option<String>,
    consent_accepted: Option<bool>,
    expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffGuestFormReviewRequest {
    decision: String,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StaffGuestPhotoQuery {
    file_name: String,
    caption: Option<String>,
    service_id: Option<String>,
    photo_type: Option<String>,
    consent_confirmed: Option<bool>,
    consent_reason: Option<String>,
}

struct StaffGuestScope {
    tenant_id: String,
    branch_id: String,
    client_id: String,
    service_ids: Vec<String>,
    own_appointment: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContactPreferencesRequest {
    preferred_staff_id: Option<String>,
    preferred_communication_channel: String,
    whatsapp_opt_in: Option<bool>,
    sms_opt_in: Option<bool>,
    email_opt_in: Option<bool>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeClientRequest {
    target_client_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReverseMergeRequest {
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientProfile360Request {
    #[serde(default)]
    gender: String,
    #[serde(default)]
    address: String,
    #[serde(default)]
    city: String,
    #[serde(default)]
    postal_code: String,
    #[serde(default)]
    preferred_language: String,
    #[serde(default)]
    occupation: String,
    #[serde(default)]
    marketing_source: String,
    #[serde(default)]
    source_detail: String,
    expected_version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewLinkRequest {
    platform: String,
    external_review_id: Option<String>,
    rating: Option<i16>,
    review_text: Option<String>,
    reviewed_at: Option<DateTime<Utc>>,
}

async fn list_clients(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ClientListQuery>,
) -> ApiResult<Vec<ClientResponse>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 100);
    let q = query.q.unwrap_or_default();

    let rows = clients_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        &q,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to list clients"))?;

    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(ClientResponse::from).collect(),
    )))
}

async fn client_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(report_type): Path<String>,
    Query(query): Query<ClientReportQuery>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.read")?;
    if !is_client_report_type(&report_type) {
        return Err(AppError::not_found("client report was not found"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let filters = client_report_filters(&report_type, &query)?;
    let rows =
        clients_repository::client_report(&state.db, &tenant_id, &branch_id, &report_type, filters)
            .await
            .map_err(|_| AppError::internal("failed to load client report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn export_client_branch_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(report_type): Path<String>,
    Query(query): Query<ClientReportQuery>,
) -> Result<Response<Body>, AppError> {
    require_client_permission(&claims, "clients.read")?;
    if report_type != "best-clients" {
        return Err(AppError::not_found("client report export was not found"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let filters = client_report_filters(&report_type, &query)?;
    let rows =
        clients_repository::client_report(&state.db, &tenant_id, &branch_id, &report_type, filters)
            .await
            .map_err(|_| AppError::internal("failed to export client report"))?;
    let csv = best_clients_csv(&rows);
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"best-clients-{}.csv\"", branch_id),
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(csv))
        .map_err(|_| AppError::internal("failed to export client report"))
}

async fn list_client_masters(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> ApiResult<Vec<clients_repository::ClientMasterRecord>> {
    let kind = client_master_kind(&kind)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = clients_repository::list_client_masters(&state.db, &tenant_id, &branch_id, kind)
        .await
        .map_err(|_| AppError::internal("failed to load client masters"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn client_masters_summary(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = clients_repository::client_master_summary(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load client master summary"))?;
    let kinds = client_master_kinds()
        .iter()
        .map(|(key, label)| {
            let total = rows
                .iter()
                .filter(|row| row.kind == *key)
                .map(|row| row.count)
                .sum::<i64>();
            let count_for = |status: &str| {
                rows.iter()
                    .find(|row| row.kind == *key && row.status == status)
                    .map(|row| row.count)
                    .unwrap_or(0)
            };
            json!({
                "key": key,
                "label": label,
                "total": total,
                "active": count_for("active"),
                "draft": count_for("draft"),
                "archived": count_for("archived"),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(ApiResponse::ok(json!({ "kinds": kinds }))))
}

async fn get_client_custom_form_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    require_client_permission(&claims, "settings.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let saved =
        clients_repository::get_client_custom_form_settings(&state.db, &tenant_id, &branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load client form settings"))?;
    Ok(Json(ApiResponse::ok(
        normalize_client_custom_form_settings(&branch_id, saved.as_ref()),
    )))
}

async fn save_client_custom_form_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClientCustomFormSettingsRequest>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "settings.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let settings = normalize_client_custom_form_settings(
        &branch_id,
        Some(&json!({ "fields": payload.fields, "settings": payload.settings })),
    );
    let saved = clients_repository::save_client_custom_form_settings(
        &state.db,
        &tenant_id,
        &branch_id,
        &settings,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save client form settings"))?;
    Ok(Json(ApiResponse::ok(
        normalize_client_custom_form_settings(&branch_id, Some(&saved)),
    )))
}

async fn create_client_master(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(kind): Path<String>,
    Json(payload): Json<ClientMasterWriteRequest>,
) -> ApiResult<clients_repository::ClientMasterRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let kind = client_master_kind(&kind)?;
    let value = validate_client_master(kind, &payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::create_client_master(
        &state.db,
        &tenant_id,
        &branch_id,
        ClientMasterWrite {
            kind,
            code: &value.code,
            name: &value.name,
            description: &value.description,
            definition: &value.definition,
            status: &value.status,
            actor: &claims.sub,
        },
    )
    .await
    .map_err(client_growth_write_error)?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_client_master(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((kind, master_id)): Path<(String, String)>,
    Json(payload): Json<ClientMasterWriteRequest>,
) -> ApiResult<clients_repository::ClientMasterRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let kind = client_master_kind(&kind)?;
    let version = payload
        .version
        .filter(|version| *version > 0)
        .ok_or_else(|| AppError::validation("version is required"))?;
    let value = validate_client_master(kind, &payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::update_client_master(
        &state.db,
        &tenant_id,
        &branch_id,
        &master_id,
        version,
        ClientMasterWrite {
            kind,
            code: &value.code,
            name: &value.name,
            description: &value.description,
            definition: &value.definition,
            status: &value.status,
            actor: &claims.sub,
        },
    )
    .await
    .map_err(client_growth_write_error)?
    .ok_or_else(|| AppError::conflict("client master changed; reload and try again"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_client_master_audit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(kind): Path<String>,
) -> ApiResult<Vec<clients_repository::ClientMasterAuditRecord>> {
    require_client_permission(&claims, "clients.audit.read")?;
    let kind = client_master_kind(&kind)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows =
        clients_repository::list_client_master_audit(&state.db, &tenant_id, &branch_id, kind)
            .await
            .map_err(|_| AppError::internal("failed to load client master audit"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_discount_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<clients_repository::ClientDiscountRuleRecord>> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = clients_repository::list_discount_rules(&state.db, &tenant_id, &branch_id, false)
        .await
        .map_err(|_| AppError::internal("failed to load client discount rules"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_discount_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClientDiscountRuleRequest>,
) -> ApiResult<clients_repository::ClientDiscountRuleRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let value = validate_discount_rule(&payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::create_discount_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        discount_rule_write(&value, &claims.sub),
    )
    .await
    .map_err(client_growth_write_error)?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_discount_rule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(rule_id): Path<String>,
    Json(payload): Json<ClientDiscountRuleRequest>,
) -> ApiResult<clients_repository::ClientDiscountRuleRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let version = payload
        .version
        .filter(|version| *version > 0)
        .ok_or_else(|| AppError::validation("version is required"))?;
    let value = validate_discount_rule(&payload)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::update_discount_rule(
        &state.db,
        &tenant_id,
        &branch_id,
        &rule_id,
        version,
        discount_rule_write(&value, &claims.sub),
    )
    .await
    .map_err(client_growth_write_error)?
    .ok_or_else(|| AppError::conflict("discount rule changed; reload and try again"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn get_client_growth(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let growth = client_service::client_growth(&state.db, &tenant_id, &branch_id, &id).await?;
    Ok(Json(ApiResponse::ok(growth)))
}

async fn get_client_memory_graph(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        client_service::memory_graph(&state.db, &tenant_id, &branch_id, &id).await?,
    )))
}

async fn rebuild_client_memory_graph(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let graph =
        client_service::rebuild_memory_graph(&state.db, &tenant_id, &branch_id, &id, &claims.sub)
            .await?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "intelligence",
        &id,
        "memory_graph.rebuilt",
    );
    Ok(Json(ApiResponse::ok(graph)))
}

async fn get_branch_return_tracker(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(view): Path<String>,
    Query(query): Query<ClientReturnTrackerQuery>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.read")?;
    if !matches!(view.as_str(), "summary" | "clients" | "offers" | "roi") {
        return Err(AppError::validation(
            "view must be summary, clients, offers, or roi",
        ));
    }
    let status = query.status.as_deref().unwrap_or("").trim().to_lowercase();
    if !matches!(
        status.as_str(),
        "" | "issued" | "redeemed" | "returned" | "expired"
    ) {
        return Err(AppError::validation("invalid return tracker status"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let result = clients_repository::branch_return_tracker(
        &state.db,
        &tenant_id,
        &branch_id,
        &view,
        query.days.unwrap_or(365).clamp(1, 3_650),
        &status,
        query.limit.unwrap_or(100).clamp(1, 500),
        query.offset.unwrap_or(0).max(0),
    )
    .await
    .map_err(|_| AppError::internal("failed to load branch return tracker"))?;
    Ok(Json(ApiResponse::ok(result)))
}

async fn list_recommendation_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<clients_repository::ClientRecommendationFeedbackRecord>> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        clients_repository::recommendation_feedback(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| AppError::internal("failed to load recommendation feedback"))?,
    )))
}

async fn create_recommendation_feedback(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<RecommendationFeedbackRequest>,
) -> ApiResult<clients_repository::ClientRecommendationFeedbackRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = client_service::record_recommendation_feedback(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload.recommendation.trim(),
        payload.decision.trim(),
        payload.comment.as_deref().unwrap_or(""),
        &claims.sub,
    )
    .await?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "recommendation",
        &row.id,
        "feedback.recorded",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_segment_history(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<clients_repository::ClientSegmentHistoryRecord>> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        clients_repository::segment_history(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| AppError::internal("failed to load client segment history"))?,
    )))
}

async fn list_client_automations(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<Value>> {
    require_client_permission(&claims, "clients.audit.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        clients_repository::automation_history(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| AppError::internal("failed to load client automation history"))?,
    )))
}

async fn bulk_export_clients(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ClientListQuery>,
) -> ApiResult<Vec<ClientResponse>> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(1_000).clamp(1, 5_000);
    let rows = clients_repository::list(
        &state.db,
        &tenant_id,
        &branch_id,
        query.q.as_deref().unwrap_or("").trim(),
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to export clients"))?;
    Ok(Json(ApiResponse::ok(
        rows.into_iter().map(ClientResponse::from).collect(),
    )))
}

async fn bulk_import_clients(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BulkClientImportRequest>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.manage")?;
    if payload.clients.is_empty() || payload.clients.len() > 500 {
        return Err(AppError::validation("clients must contain 1-500 records"));
    }
    let mut rows = Vec::with_capacity(payload.clients.len());
    for client in &payload.clients {
        validate_client_write(client, true)?;
        let phone = client.phone.as_deref().unwrap_or("").trim();
        rows.push(json!({
            "code":client.code.as_deref().map(str::trim),
            "first_name":client.first_name.as_deref().unwrap_or("").trim(),
            "last_name":client.last_name.as_deref().unwrap_or("").trim(),
            "phone":phone,
            "normalized_phone":client_service::normalize_phone(phone)?,
            "email":client.email.as_deref().unwrap_or("").trim(),
            "membership_label":client.membership_label.as_deref().unwrap_or("").trim(),
            "categories_json":serde_json::from_str::<Value>(&categories_json(client.categories.as_ref())?).unwrap_or_else(|_|json!([])),
            "birthday":client.birthday,
            "anniversary":client.anniversary,
            "notes":client.notes.as_deref().unwrap_or("").trim(),
            "active":client.active.unwrap_or(true)
        }));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let imported = clients_repository::bulk_import(
        &state.db,
        &tenant_id,
        &branch_id,
        &Value::Array(rows),
        &claims.sub,
    )
    .await
    .map_err(|error| client_write_error(error, "failed to import clients"))?;
    Ok(Json(ApiResponse::ok(json!({"imported":imported}))))
}

async fn evaluate_client_discount(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientDiscountRequest>,
) -> ApiResult<clients_repository::ClientDiscountDecisionRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let category = payload.service_category.trim().to_lowercase();
    if category.is_empty()
        || category.chars().count() > 80
        || payload.subtotal_paise <= 0
        || !(1..=10_000).contains(&payload.requested_discount_bps)
    {
        return Err(AppError::validation("invalid discount request"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = client_service::evaluate_discount(
        &state.db,
        &tenant_id,
        &branch_id,
        client_service::DiscountRequest {
            client_id: &id,
            service_category: &category,
            subtotal_paise: payload.subtotal_paise,
            requested_discount_bps: payload.requested_discount_bps,
            actor: &claims.sub,
        },
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve_discount_decision(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(decision_id): Path<String>,
) -> ApiResult<clients_repository::ClientDiscountDecisionRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::approve_discount_decision(
        &state.db,
        &tenant_id,
        &branch_id,
        &decision_id,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to approve discount decision"))?
    .ok_or_else(|| AppError::conflict("discount decision is not awaiting approval"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_win_back_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientWinBackOfferRequest>,
) -> ApiResult<clients_repository::ClientWinBackOfferRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let title = payload.title.trim();
    let return_window_days = payload.return_window_days.unwrap_or(30);
    let discount_cost_paise = payload.discount_cost_paise.unwrap_or(0);
    if title.is_empty()
        || title.chars().count() > 120
        || !(1..=10_000).contains(&payload.offered_discount_bps)
        || discount_cost_paise < 0
        || !(1..=180).contains(&return_window_days)
    {
        return Err(AppError::validation("invalid win-back offer"));
    }
    let offer_code = payload
        .offer_code
        .unwrap_or_else(|| format!("WB-{}", &uuid::Uuid::new_v4().simple().to_string()[..10]))
        .trim()
        .to_uppercase();
    if offer_code.is_empty()
        || offer_code.chars().count() > 40
        || !offer_code
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(AppError::validation("invalid offerCode"));
    }
    let decision_id = payload
        .decision_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::create_win_back_offer(
        &state.db,
        &tenant_id,
        &branch_id,
        ClientWinBackOfferWrite {
            client_id: &id,
            decision_id,
            offer_code: &offer_code,
            title,
            offered_discount_bps: payload.offered_discount_bps,
            discount_cost_paise,
            return_window_days,
            actor: &claims.sub,
        },
    )
    .await
    .map_err(client_growth_write_error)?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn redeem_win_back_offer(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, offer_id)): Path<(String, String)>,
    Json(payload): Json<RedeemWinBackOfferRequest>,
) -> ApiResult<clients_repository::ClientWinBackOfferRecord> {
    require_client_permission(&claims, "clients.manage")?;
    let sale_id = payload.sale_id.as_deref().unwrap_or("").trim();
    if sale_id.chars().count() > 120 {
        return Err(AppError::validation("invalid saleId"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::redeem_win_back_offer(
        &state.db, &tenant_id, &branch_id, &offer_id, &id, sale_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to redeem win-back offer"))?
    .ok_or_else(|| AppError::conflict("offer cannot be redeemed"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn export_client_report(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response<Body>, AppError> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let client = clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client report"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;
    let summary = clients_repository::summary(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to calculate client report"))?;
    let csv = format!(
        "field,value\nclient_id,{}\nclient_name,{}\nphone,{}\nemail,{}\nlifetime_value,{}\naverage_spend,{}\nhighest_bill,{}\nservice_spend,{}\nproduct_spend,{}\ntotal_visits,{}\ninactive_days,{}\nchurn_risk_score,{}\nrfm_segment,{}\nrfm_score,{}\nfavourite_services,{}\npreferred_staff,{}\nreview_sentiment,{}\nnext_best_action,{}\nnext_best_action_reason,{}\noccasion_opportunity,{}\n",
        csv_cell(&client.id),
        csv_cell(&format!("{} {}", client.first_name, client.last_name)),
        csv_cell(&client.phone),
        csv_cell(&client.email),
        summary.lifetime_value_paise,
        summary.average_spend_paise,
        summary.highest_bill_paise,
        summary.service_spend_paise,
        summary.product_spend_paise,
        summary.total_visits,
        summary.inactive_days,
        summary.churn_risk_score,
        csv_cell(&summary.rfm_segment),
        summary.rfm_score,
        csv_cell(&summary.favourite_services),
        csv_cell(&summary.preferred_staff_name),
        csv_cell(&summary.review_sentiment),
        csv_cell(&summary.next_best_action),
        csv_cell(&summary.next_best_action_reason),
        csv_cell(&summary.occasion_opportunity),
    );
    Response::builder()
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"client-{}-360.csv\"", client.id),
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .body(Body::from(csv))
        .map_err(|_| AppError::internal("failed to export client report"))
}

async fn get_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Client360Response> {
    require_client_permission(&claims, "clients.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let cross_location_allowed = matches!(claims.role.as_str(), "owner" | "admin" | "manager")
        || claims
            .permissions
            .iter()
            .any(|item| item == "clients.cross_location.read");
    let authorized_branch_ids = if cross_location_allowed {
        ai_scope_repository::authorized_branches(
            &state.db,
            &tenant_id,
            &claims.sub,
            matches!(claims.role.as_str(), "owner" | "admin"),
        )
        .await
        .map_err(|_| AppError::internal("failed to resolve authorized client branches"))?
        .into_iter()
        .filter(|branch| branch.active)
        .map(|branch| branch.branch_id)
        .collect()
    } else {
        Vec::new()
    };
    Ok(Json(ApiResponse::ok(
        load_client_360(&state, &tenant_id, &branch_id, &id, &authorized_branch_ids).await?,
    )))
}

async fn load_client_360(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    authorized_branch_ids: &[String],
) -> Result<Client360Response, AppError> {
    let row = clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .ok_or_else(|| AppError::not_found("client was not found"))?;

    let (
        summary,
        appointments,
        invoices,
        service_history,
        client_notes,
        family_members,
        clinical_profile,
        soap_notes,
        form_definitions,
        form_submissions,
        treatment_photos,
        duplicates,
        consent_history,
        communications,
        reviews,
        profile,
        merge_history,
        cross_location_visits,
        financial_exposure,
        attribution,
    ) = tokio::try_join!(
        clients_repository::summary(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::appointment_history(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::invoice_history(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::service_history(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_notes(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_family_members(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::get_clinical_profile(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_soap_notes(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_form_definitions(&state.db, &tenant_id, &branch_id),
        clients_repository::list_form_submissions(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_treatment_photos(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_duplicates(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_consent_events(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_communications(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_reviews(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::get_profile_360(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::list_merge_history(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::cross_location_visits(
            &state.db,
            &tenant_id,
            &branch_id,
            &id,
            authorized_branch_ids
        ),
        clients_repository::financial_exposure(&state.db, &tenant_id, &branch_id, &id),
        clients_repository::client_attribution(&state.db, &tenant_id, &branch_id, &id),
    )
    .map_err(|_| AppError::internal("failed to load client 360 history"))?;

    Ok(Client360Response {
        client: ClientResponse::from(row),
        summary,
        appointments,
        invoices,
        service_history,
        client_notes,
        family_members,
        clinical_profile,
        soap_notes,
        form_definitions,
        form_submissions,
        treatment_photos,
        duplicates,
        consent_history,
        communications,
        reviews,
        profile,
        merge_history,
        cross_location_visits,
        financial_exposure,
        attribution,
    })
}

async fn get_client_timeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<ClientTimelineQuery>,
) -> ApiResult<ClientTimelineResponse> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let exists = clients_repository::client_exists(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client timeline"))?;
    if !exists {
        return Err(AppError::not_found("client was not found"));
    }

    let limit = query.limit.unwrap_or(30).clamp(1, 100);
    let (cursor_at, cursor_id) = query
        .cursor
        .as_deref()
        .map(parse_timeline_cursor)
        .transpose()?
        .unwrap_or((None, String::new()));
    let mut items = clients_repository::timeline(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        cursor_at,
        &cursor_id,
        limit + 1,
    )
    .await
    .map_err(|_| AppError::internal("failed to load client timeline"))?;
    let has_more = items.len() > limit as usize;
    items.truncate(limit as usize);
    let next_cursor = has_more
        .then(|| items.last().map(timeline_cursor))
        .flatten();

    Ok(Json(ApiResponse::ok(ClientTimelineResponse {
        items,
        next_cursor,
    })))
}

async fn list_client_notes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<ClientNoteRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .is_none()
    {
        return Err(AppError::not_found("client was not found"));
    }
    Ok(Json(ApiResponse::ok(
        clients_repository::list_notes(&state.db, &tenant_id, &branch_id, &id)
            .await
            .map_err(|_| AppError::internal("failed to load client notes"))?,
    )))
}

async fn save_contact_preferences(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ContactPreferencesRequest>,
) -> ApiResult<ClientContactPreferencesRecord> {
    require_client_permission(&claims, "clients.consent.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let preferred_channel = payload
        .preferred_communication_channel
        .trim()
        .to_lowercase();
    let preferred_staff_id = payload
        .preferred_staff_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let reason = payload.reason.as_deref().unwrap_or("").trim();
    if !matches!(
        preferred_channel.as_str(),
        "none" | "whatsapp" | "sms" | "email" | "phone"
    ) || reason.chars().count() > 500
    {
        return Err(AppError::validation("invalid communication preferences"));
    }
    let row = clients_repository::save_contact_preferences(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        preferred_staff_id,
        &preferred_channel,
        payload.whatsapp_opt_in,
        payload.sms_opt_in,
        payload.email_opt_in,
        reason,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save communication preferences"))?
    .ok_or_else(|| AppError::not_found("client or preferred staff was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "preferences",
        &id,
        "preferences.updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn merge_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(source_id): Path<String>,
    Json(payload): Json<MergeClientRequest>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.merge")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let target_id = payload.target_client_id.trim();
    if target_id.is_empty() || target_id == source_id {
        return Err(AppError::validation(
            "targetClientId must identify another client",
        ));
    }
    let source = clients_repository::get(&state.db, &tenant_id, &branch_id, &source_id)
        .await
        .map_err(|_| AppError::internal("failed to load source client"))?
        .ok_or_else(|| AppError::not_found("source client was not found"))?;
    let target = clients_repository::get(&state.db, &tenant_id, &branch_id, target_id)
        .await
        .map_err(|_| AppError::internal("failed to load target client"))?
        .ok_or_else(|| AppError::not_found("target client was not found"))?;
    if source.normalized_phone.is_empty()
        || source.normalized_phone != target.normalized_phone
        || source.merged_into_client_id.is_some()
        || target.merged_into_client_id.is_some()
    {
        return Err(AppError::conflict(
            "only active clients with the same normalized phone can be merged",
        ));
    }
    if !clients_repository::merge_clients(
        &state.db,
        &tenant_id,
        &branch_id,
        &source_id,
        target_id,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to merge clients"))?
    {
        return Err(AppError::conflict("client merge could not be completed"));
    }
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        target_id,
        "client",
        &source_id,
        "client.merged",
    );
    Ok(Json(ApiResponse::ok(
        serde_json::json!({"sourceClientId":source_id,"targetClientId":target_id}),
    )))
}

async fn reverse_client_merge(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((target_id, source_id)): Path<(String, String)>,
    Json(payload): Json<ReverseMergeRequest>,
) -> ApiResult<Value> {
    require_client_permission(&claims, "clients.merge")?;
    let reason = payload.reason.trim();
    if reason.is_empty() || reason.chars().count() > 500 {
        return Err(AppError::validation(
            "reason is required and must be 500 characters or fewer",
        ));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !clients_repository::reverse_client_merge(
        &state.db,
        &tenant_id,
        &branch_id,
        &target_id,
        &source_id,
        reason,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to reverse client merge"))?
    {
        return Err(AppError::conflict(
            "active merge was not found or source client cannot be restored",
        ));
    }
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &target_id,
        "client",
        &source_id,
        "client.merge.reversed",
    );
    Ok(Json(ApiResponse::ok(json!({
        "sourceClientId":source_id,"targetClientId":target_id,"reversed":true
    }))))
}

async fn save_client_profile_360(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientProfile360Request>,
) -> ApiResult<ClientProfile360Record> {
    require_client_permission(&claims, "clients.manage")?;
    let values = [
        (payload.gender.trim(), 40, "gender"),
        (payload.address.trim(), 500, "address"),
        (payload.city.trim(), 120, "city"),
        (payload.postal_code.trim(), 24, "postalCode"),
        (payload.preferred_language.trim(), 40, "preferredLanguage"),
        (payload.occupation.trim(), 120, "occupation"),
        (payload.marketing_source.trim(), 120, "marketingSource"),
        (payload.source_detail.trim(), 500, "sourceDetail"),
    ];
    if let Some((_, _, field)) = values
        .iter()
        .find(|(value, limit, _)| value.chars().count() > *limit)
    {
        return Err(AppError::validation(format!("{field} is too long")));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::save_profile_360(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        values[0].0,
        values[1].0,
        values[2].0,
        values[3].0,
        values[4].0,
        values[5].0,
        values[6].0,
        values[7].0,
        payload.expected_version,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save client profile"))?
    .ok_or_else(|| AppError::conflict("client profile version changed or client was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "client",
        &id,
        "client.profile_360.updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_client_audit(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<ClientAuditRecord>> {
    require_client_permission(&claims, "clients.audit.read")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .is_none()
    {
        return Err(AppError::not_found("client was not found"));
    }
    let rows = clients_repository::list_audit(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client audit"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_review_link(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ReviewLinkRequest>,
) -> ApiResult<ClientReviewRecord> {
    require_client_permission(&claims, "clients.reviews.link")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let platform = payload.platform.trim().to_lowercase();
    let external_id = payload.external_review_id.as_deref().unwrap_or("").trim();
    let review_text = payload.review_text.as_deref().unwrap_or("").trim();
    if !matches!(
        platform.as_str(),
        "google" | "facebook" | "instagram" | "internal" | "other"
    ) || external_id.chars().count() > 240
        || review_text.chars().count() > 5_000
        || payload
            .rating
            .is_some_and(|rating| !(1..=5).contains(&rating))
        || (external_id.is_empty() && payload.rating.is_none() && review_text.is_empty())
    {
        return Err(AppError::validation("invalid client review"));
    }
    let row = clients_repository::create_review_link(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &platform,
        external_id,
        payload.rating,
        review_text,
        payload.reviewed_at,
        &claims.sub,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database_error| database_error.is_unique_violation())
        {
            AppError::conflict("this external review is already linked")
        } else {
            AppError::internal("failed to link client review")
        }
    })?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "review",
        &row.id,
        "review.linked",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_client_note(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientNoteRequest>,
) -> ApiResult<ClientNoteRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let note = payload.note.trim();
    if note.is_empty() || note.len() > 2_000 {
        return Err(AppError::validation(
            "note must be between 1 and 2000 characters",
        ));
    }
    let note_type = payload.note_type.as_deref().unwrap_or("general").trim();
    let visibility = payload
        .visibility
        .as_deref()
        .unwrap_or("branch_staff")
        .trim();
    if !matches!(
        note_type,
        "general"
            | "preference"
            | "allergy"
            | "service"
            | "follow_up"
            | "complaint"
            | "service-recovery"
    ) || !matches!(visibility, "assigned_staff" | "branch_staff" | "management")
    {
        return Err(AppError::validation("invalid noteType"));
    }
    let record = clients_repository::create_note(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        payload
            .appointment_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        note_type,
        note,
        visibility,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to create client note"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "note",
        &record.id,
        "note.created",
    );
    Ok(Json(ApiResponse::ok(record)))
}

async fn list_form_definitions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Vec<ClientFormDefinitionRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = clients_repository::list_form_definitions(&state.db, &tenant_id, &branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load client forms"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_form_definition(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClientFormDefinitionRequest>,
) -> ApiResult<ClientFormDefinitionRecord> {
    require_form_manager(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let form_key = payload.form_key.trim().to_lowercase();
    let name = payload.name.trim();
    let form_type = payload.form_type.trim().to_lowercase();
    let scope_type = payload.scope_type.as_deref().unwrap_or("guest").trim();
    let scope_ids = payload.scope_ids.unwrap_or_default();
    let scope_ids_valid = scope_ids.len() <= 100
        && scope_ids.iter().all(|value| {
            let value = value.trim();
            !value.is_empty() && value.chars().count() <= 120
        })
        && scope_ids.iter().collect::<HashSet<_>>().len() == scope_ids.len();
    let staff_mode_allowed = payload.staff_mode_allowed.unwrap_or(true);
    let guest_mode_allowed = payload.guest_mode_allowed.unwrap_or(true);
    let body = payload.body.as_deref().unwrap_or("").trim();
    if form_key.is_empty()
        || form_key.len() > 80
        || !form_key.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        })
        || name.is_empty()
        || name.chars().count() > 120
        || !matches!(form_type.as_str(), "consent" | "intake" | "treatment")
        || !matches!(
            scope_type,
            "guest" | "service" | "membership" | "package" | "tag"
        )
        || !scope_ids_valid
        || payload
            .valid_for_days
            .is_some_and(|days| !(1..=3650).contains(&days))
        || (!staff_mode_allowed && !guest_mode_allowed)
        || body.chars().count() > 10_000
    {
        return Err(AppError::validation("invalid client form definition"));
    }
    validate_form_fields(&payload.fields)?;
    let row = clients_repository::create_form_definition(
        &state.db,
        &tenant_id,
        &branch_id,
        &form_key,
        name,
        &form_type,
        body,
        &payload.fields,
        payload.requires_signature.unwrap_or(false),
        scope_type,
        &json!(scope_ids),
        payload.required.unwrap_or(false),
        payload.valid_for_days,
        payload.review_required.unwrap_or(false),
        staff_mode_allowed,
        guest_mode_allowed,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to create client form version"))?;
    Ok(Json(ApiResponse::ok(row)))
}

pub(crate) async fn get_client_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Option<ClientClinicalProfileRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .is_none()
    {
        return Err(AppError::not_found("client was not found"));
    }
    let row = clients_repository::get_clinical_profile(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client preferences"))?;
    Ok(Json(ApiResponse::ok(row)))
}

pub(crate) async fn save_client_preferences(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientClinicalProfileRequest>,
) -> ApiResult<ClientClinicalProfileRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let allergies = payload.allergies.as_deref().unwrap_or("").trim();
    let preferences = payload.preferences.as_deref().unwrap_or("").trim();
    if allergies.chars().count() > 5_000 || preferences.chars().count() > 5_000 {
        return Err(AppError::validation(
            "allergies and preferences must be at most 5000 characters",
        ));
    }
    let expected_version = payload.expected_version.unwrap_or(0);
    if expected_version < 0 {
        return Err(AppError::validation("expectedVersion cannot be negative"));
    }
    if let Some(row) = clients_repository::save_clinical_profile(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        allergies,
        preferences,
        expected_version,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save client clinical profile"))?
    {
        publish_client_timeline(
            &state,
            &tenant_id,
            &branch_id,
            &id,
            "clinical_profile",
            &id,
            "clinical_profile.updated",
        );
        return Ok(Json(ApiResponse::ok(row)));
    }
    if clients_repository::get(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
        .is_none()
    {
        return Err(AppError::not_found("client was not found"));
    }
    Err(AppError::conflict(
        "client clinical profile changed; reload and try again",
    ))
}

async fn create_form_submission(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientFormSubmissionRequest>,
) -> ApiResult<ClientFormSubmissionRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let definition = clients_repository::get_form_definition(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.definition_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load client form"))?
    .filter(|row| row.active)
    .ok_or_else(|| AppError::not_found("client form was not found"))?;
    validate_form_responses(&definition.fields_json, &payload.responses)?;

    let signature_name = payload.signature_name.as_deref().unwrap_or("").trim();
    let consent_accepted = payload.consent_accepted.unwrap_or(false);
    if definition.requires_signature && (!consent_accepted || signature_name.chars().count() < 2) {
        return Err(AppError::validation(
            "consent and signatureName are required",
        ));
    }
    if signature_name.chars().count() > 200 || (!signature_name.is_empty() && !consent_accepted) {
        return Err(AppError::validation("invalid signature evidence"));
    }
    let signature_sha256 = if signature_name.is_empty() {
        String::new()
    } else {
        format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}:{}:{}:{}",
                    id, definition.id, definition.version, signature_name
                )
                .as_bytes()
            )
        )
    };
    let row = clients_repository::create_form_submission(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &definition.id,
        &payload.responses,
        signature_name,
        &signature_sha256,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to submit client form"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "form",
        &row.id,
        "form.submitted",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn list_soap_notes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<ClientSoapNoteRecord>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !clients_repository::client_exists(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load client"))?
    {
        return Err(AppError::not_found("client was not found"));
    }
    let rows = clients_repository::list_soap_notes(&state.db, &tenant_id, &branch_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load SOAP notes"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_soap_note(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientSoapNoteRequest>,
) -> ApiResult<ClientSoapNoteRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let (subjective, objective, assessment, plan, status) = validate_soap_note(&payload)?;
    let appointment_id = payload
        .appointment_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let row = clients_repository::create_soap_note(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        appointment_id,
        &subjective,
        &objective,
        &assessment,
        &plan,
        &status,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to create SOAP note"))?
    .ok_or_else(|| AppError::not_found("client or appointment was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "soap_note",
        &row.id,
        "soap_note.created",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_soap_note(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, note_id)): Path<(String, String)>,
    Json(payload): Json<ClientSoapNoteRequest>,
) -> ApiResult<ClientSoapNoteRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let expected_version = payload
        .expected_version
        .filter(|version| *version > 0)
        .ok_or_else(|| AppError::validation("expectedVersion is required"))?;
    let (subjective, objective, assessment, plan, status) = validate_soap_note(&payload)?;
    let row = clients_repository::update_soap_note(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &note_id,
        &subjective,
        &objective,
        &assessment,
        &plan,
        &status,
        expected_version,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to update SOAP note"))?
    .ok_or_else(|| AppError::conflict("SOAP note changed or is already final"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "soap_note",
        &row.id,
        "soap_note.updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn upload_treatment_photo(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<TreatmentPhotoQuery>,
    bytes: Bytes,
) -> ApiResult<ClientTreatmentPhotoRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let file_name = query.file_name.trim();
    let caption = query.caption.as_deref().unwrap_or("").trim();
    let photo_type = query.photo_type.as_deref().unwrap_or("other").trim();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if file_name.is_empty()
        || file_name.chars().count() > 180
        || file_name.chars().any(char::is_control)
        || caption.chars().count() > 500
        || !matches!(photo_type, "profile" | "before" | "after" | "other")
        || bytes.is_empty()
        || bytes.len() > 5 * 1024 * 1024
        || !matches!(
            content_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        )
        || !photo_content_matches_type(&bytes, &content_type)
    {
        return Err(AppError::validation("invalid treatment photo"));
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let row = clients_repository::save_treatment_photo(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        query
            .appointment_id
            .as_deref()
            .filter(|value| !value.trim().is_empty()),
        "",
        caption,
        file_name,
        &content_type,
        &sha256,
        photo_type,
        None,
        bytes.to_vec(),
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to upload treatment photo"))?
    .ok_or_else(|| AppError::not_found("client or appointment was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "photo",
        &row.id,
        "photo.uploaded",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_treatment_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, photo_id)): Path<(String, String)>,
    Json(payload): Json<TreatmentPhotoUpdateRequest>,
) -> ApiResult<ClientTreatmentPhotoRecord> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let caption = payload.caption.as_deref().map(str::trim);
    let photo_type = payload.photo_type.as_deref().map(str::trim);
    if caption.is_some_and(|value| value.chars().count() > 500)
        || photo_type
            .is_some_and(|value| !matches!(value, "profile" | "before" | "after" | "other"))
    {
        return Err(AppError::validation("invalid treatment photo update"));
    }
    let row = clients_repository::update_treatment_photo(
        &state.db, &tenant_id, &branch_id, &id, &photo_id, caption, photo_type,
    )
    .await
    .map_err(|_| AppError::internal("failed to update treatment photo"))?
    .ok_or_else(|| AppError::not_found("treatment photo was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "photo",
        &row.id,
        "photo.updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn delete_treatment_photo(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((id, photo_id)): Path<(String, String)>,
) -> ApiResult<()> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let deleted = clients_repository::delete_treatment_photo(
        &state.db,
        &tenant_id,
        &branch_id,
        &id,
        &photo_id,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to delete treatment photo"))?;
    if !deleted {
        return Err(AppError::not_found("treatment photo was not found"));
    }
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "photo",
        &photo_id,
        "photo.deleted",
    );
    Ok(Json(ApiResponse::ok(())))
}

async fn get_treatment_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, photo_id)): Path<(String, String)>,
) -> Result<Response<Body>, AppError> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row =
        clients_repository::get_treatment_photo(&state.db, &tenant_id, &branch_id, &id, &photo_id)
            .await
            .map_err(|_| AppError::internal("failed to load treatment photo"))?
            .ok_or_else(|| AppError::not_found("treatment photo was not found"))?;
    let safe_name = row
        .file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&row.content_type)
                .map_err(|_| AppError::internal("invalid stored photo type"))?,
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{safe_name}\""),
        )
        .body(Body::from(row.content))
        .map_err(|_| AppError::internal("failed to stream treatment photo"))
}

fn staff_guest_permission(claims: &AuthClaims, permission: &str, legacy: &[&str]) -> bool {
    auth_service::staff_app_permission_allowed(
        claims,
        permission,
        &["owner", "admin", "manager"],
        legacy,
    )
}

async fn staff_guest_scope(
    state: &AppState,
    claims: &AuthClaims,
    headers: &HeaderMap,
    appointment_id: &str,
) -> Result<StaffGuestScope, AppError> {
    if !auth_service::staff_app_permission_allowed(
        claims,
        "staff.app.guest.read",
        &["owner", "admin", "manager", "staff"],
        &["clients.read"],
    ) {
        return Err(AppError::forbidden("Guest 360 permission is required"));
    }
    let (tenant_id, branch_id) = tenant_branch(headers)?;
    let self_staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let row: Option<(String, String, Value)> = sqlx::query_as(
        "SELECT client_id,staff_id,service_ids_json FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(appointment_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load appointment guest"))?;
    let (client_id, staff_id, service_ids_json) =
        row.ok_or_else(|| AppError::not_found("appointment was not found"))?;
    let own_appointment = staff_id == self_staff_id;
    if !own_appointment
        && !auth_service::staff_app_permission_allowed(
            claims,
            "staff.app.appointments.team.read",
            &["owner", "admin", "manager"],
            &[],
        )
    {
        return Err(AppError::not_found("appointment was not found"));
    }
    Ok(StaffGuestScope {
        tenant_id,
        branch_id,
        client_id,
        service_ids: service_ids_json
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        own_appointment,
    })
}

fn require_staff_guest_action(
    claims: &AuthClaims,
    scope: &StaffGuestScope,
    permission: &str,
    legacy: &[&str],
) -> Result<(), AppError> {
    if !staff_guest_permission(claims, permission, legacy) {
        return Err(AppError::forbidden(
            "Guest 360 action permission is required",
        ));
    }
    if !scope.own_appointment
        && !auth_service::staff_app_permission_allowed(
            claims,
            "staff.app.appointments.team.manage",
            &["owner", "admin", "manager"],
            &[],
        )
    {
        return Err(AppError::not_found("appointment was not found"));
    }
    Ok(())
}

fn masked_phone(value: &str) -> String {
    let suffix = value
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    if suffix.is_empty() {
        String::new()
    } else {
        format!("••••••{suffix}")
    }
}

fn masked_email(value: &str) -> String {
    let Some((name, domain)) = value.split_once('@') else {
        return if value.is_empty() {
            String::new()
        } else {
            "••••".to_owned()
        };
    };
    format!("{}•••@{domain}", name.chars().next().unwrap_or('•'))
}

fn string_set(value: &Value, pointer: &str, key: &str) -> HashSet<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|row| row.get(key).and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

fn form_scope_applies(
    definition: &ClientFormDefinitionRecord,
    service_ids: &[String],
    relationships: &Value,
) -> bool {
    let scoped = definition
        .scope_ids_json
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    let matches = |available: HashSet<String>| {
        !available.is_empty()
            && (scoped.is_empty()
                || available
                    .iter()
                    .any(|value| scoped.contains(value.as_str())))
    };
    match definition.scope_type.as_str() {
        "guest" => true,
        "service" => matches(service_ids.iter().cloned().collect()),
        "membership" => matches(string_set(relationships, "/memberships", "membershipId")),
        "package" => matches(string_set(relationships, "/packages", "packageId")),
        "tag" => relationships
            .pointer("/preferences/categories")
            .and_then(Value::as_array)
            .is_some_and(|values| {
                !values.is_empty()
                    && (scoped.is_empty()
                        || values
                            .iter()
                            .filter_map(Value::as_str)
                            .any(|value| scoped.contains(value)))
            }),
        _ => false,
    }
}

fn guest_form_statuses(
    definitions: &[ClientFormDefinitionRecord],
    submissions: &[ClientFormSubmissionRecord],
    appointment_id: &str,
) -> Value {
    Value::Array(
        definitions
            .iter()
            .map(|definition| {
                let latest = submissions.iter().find(|submission| {
                    submission.form_key == definition.form_key
                        && (submission.appointment_id.as_deref() == Some(appointment_id)
                            || submission.appointment_id.is_none())
                });
                let status = match latest {
                    None => "pending",
                    Some(row) if row.status == "draft" => "draft",
                    Some(row) if row.expires_at.is_some_and(|expires| expires < Utc::now()) => {
                        "expired"
                    }
                    Some(row) if row.form_version < definition.version => "outdated",
                    Some(row) if row.review_status == "correction_required" => {
                        "correction_required"
                    }
                    Some(row) if row.review_status == "pending" => "review_required",
                    Some(_) => "completed",
                };
                json!({
                    "definitionId":definition.id,"formKey":definition.form_key,"name":definition.name,
                    "required":definition.required,"status":status,"latestSubmissionId":latest.map(|row|row.id.as_str()).unwrap_or(""),
                    "latestVersion":latest.map(|row|row.version).unwrap_or(0)
                })
            })
            .collect(),
    )
}

async fn staff_guest_360(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
) -> ApiResult<Value> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    let (mut guest, relationships, timeline, photo_consent) = tokio::try_join!(
        load_client_360(
            &state,
            &scope.tenant_id,
            &scope.branch_id,
            &scope.client_id,
            &[]
        ),
        async {
            clients_repository::memory_relationships(
                &state.db,
                &scope.tenant_id,
                &scope.branch_id,
                &scope.client_id,
            )
            .await
            .map(|value| value.unwrap_or_else(|| json!({})))
            .map_err(|_| AppError::internal("failed to load guest benefits"))
        },
        async {
            clients_repository::timeline(
                &state.db,
                &scope.tenant_id,
                &scope.branch_id,
                &scope.client_id,
                None,
                "",
                200,
            )
            .await
            .map_err(|_| AppError::internal("failed to load guest history"))
        },
        async {
            clients_repository::latest_photo_consent(
                &state.db,
                &scope.tenant_id,
                &scope.branch_id,
                &scope.client_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to load photo consent"))
        }
    )?;
    let contact_read = staff_guest_permission(&claims, "staff.app.guest.contact.read", &[]);
    let clinical_read = staff_guest_permission(&claims, "staff.app.guest.clinical.read", &[]);
    let forms_read = staff_guest_permission(
        &claims,
        "staff.app.guest.forms.read",
        &["clients.forms.manage"],
    );
    let photos_read = staff_guest_permission(&claims, "staff.app.guest.photos.read", &[]);
    let management_notes = staff_guest_permission(&claims, "staff.app.guest.forms.review", &[])
        || staff_guest_permission(&claims, "staff.app.guest.contact.read", &[]);
    if !contact_read {
        guest.client.phone = masked_phone(&guest.client.phone);
        guest.client.normalized_phone = masked_phone(&guest.client.normalized_phone);
        guest.client.email = masked_email(&guest.client.email);
        guest.communications.clear();
        guest.duplicates.clear();
        if let Some(profile) = guest.profile.as_mut() {
            profile.address.clear();
            profile.city.clear();
            profile.postal_code.clear();
        }
    }
    guest.merge_history.clear();
    guest.cross_location_visits.clear();
    guest.financial_exposure = json!({});
    guest.attribution = json!({});
    guest
        .client_notes
        .retain(|note| note.visibility != "management" || management_notes);
    if !clinical_read {
        guest.clinical_profile = None;
        guest.soap_notes.clear();
    }
    if forms_read {
        guest.form_definitions.retain(|definition| {
            definition.active && form_scope_applies(definition, &scope.service_ids, &relationships)
        });
    } else {
        guest.form_definitions.clear();
        guest.form_submissions.clear();
    }
    if !photos_read {
        guest.treatment_photos.clear();
    }
    let form_statuses = guest_form_statuses(
        &guest.form_definitions,
        &guest.form_submissions,
        &appointment_id,
    );
    let profile_photo_id = guest
        .treatment_photos
        .iter()
        .find(|row| row.photo_type == "profile")
        .map(|row| row.id.as_str())
        .unwrap_or("");
    let permissions = json!({
        "contactRead":contact_read,"notesManage":staff_guest_permission(&claims,"staff.app.guest.notes.manage", &["clients.manage"]),
        "clinicalRead":clinical_read,"clinicalManage":staff_guest_permission(&claims,"staff.app.guest.clinical.manage", &["clients.manage"]),
        "formsRead":forms_read,"formsManage":staff_guest_permission(&claims,"staff.app.guest.forms.manage", &["clients.forms.manage"]),
        "formsReview":staff_guest_permission(&claims,"staff.app.guest.forms.review", &[]),
        "photosRead":photos_read,"photosManage":staff_guest_permission(&claims,"staff.app.guest.photos.manage", &["clients.manage"]),
        "consentManage":staff_guest_permission(&claims,"staff.app.guest.consent.manage", &["clients.consent.manage"])
    });
    Ok(Json(ApiResponse::ok(json!({
        "appointmentId":appointment_id,"guest":guest,"relationships":relationships,"timeline":timeline,
        "formStatuses":form_statuses,"photoConsent":photo_consent,"profilePhotoId":profile_photo_id,"permissions":permissions
    }))))
}

async fn staff_guest_note(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Json(payload): Json<StaffGuestNoteRequest>,
) -> ApiResult<ClientNoteRecord> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(
        &claims,
        &scope,
        "staff.app.guest.notes.manage",
        &["clients.manage"],
    )?;
    let note = payload.note.trim();
    let note_type = payload.note_type.as_deref().unwrap_or("general").trim();
    let visibility = payload
        .visibility
        .as_deref()
        .unwrap_or("assigned_staff")
        .trim();
    if note.is_empty()
        || note.chars().count() > 2000
        || !matches!(
            note_type,
            "general"
                | "preference"
                | "allergy"
                | "service"
                | "follow_up"
                | "complaint"
                | "service-recovery"
        )
        || !matches!(visibility, "assigned_staff" | "branch_staff" | "management")
    {
        return Err(AppError::validation("invalid guest note"));
    }
    if visibility == "management"
        && !staff_guest_permission(&claims, "staff.app.guest.forms.review", &[])
    {
        return Err(AppError::forbidden(
            "management note permission is required",
        ));
    }
    let row = clients_repository::create_note(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        Some(&appointment_id),
        note_type,
        note,
        visibility,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save guest note"))?
    .ok_or_else(|| AppError::not_found("guest was not found"))?;
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "note",
        &row.id,
        "note.created",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_guest_clinical_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Json(payload): Json<ClientClinicalProfileRequest>,
) -> ApiResult<ClientClinicalProfileRecord> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(
        &claims,
        &scope,
        "staff.app.guest.clinical.manage",
        &["clients.manage"],
    )?;
    let allergies = payload.allergies.as_deref().unwrap_or("").trim();
    let preferences = payload.preferences.as_deref().unwrap_or("").trim();
    let version = payload.expected_version.unwrap_or(0);
    if allergies.chars().count() > 5000 || preferences.chars().count() > 5000 || version < 0 {
        return Err(AppError::validation("invalid clinical profile"));
    }
    let row = clients_repository::save_clinical_profile(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        allergies,
        preferences,
        version,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save clinical profile"))?
    .ok_or_else(|| AppError::conflict("clinical profile changed; reload and try again"))?;
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "clinical_profile",
        &scope.client_id,
        "clinical_profile.updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_guest_form(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Json(payload): Json<StaffGuestFormRequest>,
) -> ApiResult<ClientFormSubmissionRecord> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(
        &claims,
        &scope,
        "staff.app.guest.forms.manage",
        &["clients.forms.manage"],
    )?;
    let definition = clients_repository::get_form_definition(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        payload.definition_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load guest form"))?
    .filter(|row| row.active)
    .ok_or_else(|| AppError::not_found("guest form was not found"))?;
    let relationships = clients_repository::memory_relationships(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate form scope"))?
    .unwrap_or_else(|| json!({}));
    if !form_scope_applies(&definition, &scope.service_ids, &relationships) {
        return Err(AppError::not_found("guest form was not found"));
    }
    let status = payload.status.trim();
    let mode = payload.mode.as_deref().unwrap_or("staff").trim();
    if !matches!(status, "draft" | "submitted")
        || !matches!(mode, "staff" | "guest")
        || (mode == "staff" && !definition.staff_mode_allowed)
        || (mode == "guest" && !definition.guest_mode_allowed)
    {
        return Err(AppError::validation("invalid form mode or status"));
    }
    if status == "draft" {
        validate_form_draft_responses(&definition.fields_json, &payload.responses)?;
    } else {
        validate_form_responses(&definition.fields_json, &payload.responses)?;
    }
    let service_id = payload.service_id.as_deref().unwrap_or("").trim();
    let membership_id = payload.membership_id.as_deref().unwrap_or("").trim();
    let package_id = payload.package_id.as_deref().unwrap_or("").trim();
    if (!service_id.is_empty() && !scope.service_ids.iter().any(|value| value == service_id))
        || (definition.scope_type == "service" && service_id.is_empty())
        || (definition.scope_type == "membership"
            && !string_set(&relationships, "/memberships", "membershipId").contains(membership_id))
        || (definition.scope_type == "package"
            && !string_set(&relationships, "/packages", "packageId").contains(package_id))
    {
        return Err(AppError::validation("form association is invalid"));
    }
    let signature_name = payload.signature_name.as_deref().unwrap_or("").trim();
    let consent_accepted = payload.consent_accepted.unwrap_or(false);
    if status == "submitted"
        && definition.requires_signature
        && (!consent_accepted || signature_name.chars().count() < 2)
    {
        return Err(AppError::validation("consent and signature are required"));
    }
    if signature_name.chars().count() > 500 || (!signature_name.is_empty() && !consent_accepted) {
        return Err(AppError::validation("invalid signature evidence"));
    }
    let corrects = payload
        .corrects_submission_id
        .as_deref()
        .unwrap_or("")
        .trim();
    let correction_reason = payload.correction_reason.as_deref().unwrap_or("").trim();
    if !corrects.is_empty() && !(3..=500).contains(&correction_reason.chars().count()) {
        return Err(AppError::validation(
            "correction reason must be 3 to 500 characters",
        ));
    }
    let signature_sha256 = if signature_name.is_empty() {
        String::new()
    } else {
        format!(
            "{:x}",
            Sha256::digest(
                format!(
                    "{}:{}:{}:{}",
                    scope.client_id, definition.id, definition.version, signature_name
                )
                .as_bytes()
            )
        )
    };
    let row = clients_repository::save_staff_form_submission(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        clients_repository::StaffFormSubmissionWrite {
            submission_id: payload.submission_id.as_deref().unwrap_or("").trim(),
            definition_id: &definition.id,
            responses_json: &payload.responses,
            appointment_id: &appointment_id,
            service_id,
            membership_id,
            package_id,
            mode,
            status,
            corrects_submission_id: corrects,
            correction_reason,
            signature_name,
            signature_sha256: &signature_sha256,
            expected_version: payload.expected_version.unwrap_or(0),
            actor: &claims.sub,
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to save guest form"))?
    .ok_or_else(|| AppError::conflict("form draft changed or submitted evidence is immutable"))?;
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "form",
        &row.id,
        if status == "draft" {
            "form.draft_saved"
        } else {
            "form.submitted"
        },
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_guest_form_review(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((appointment_id, submission_id)): Path<(String, String)>,
    Json(payload): Json<StaffGuestFormReviewRequest>,
) -> ApiResult<Value> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(&claims, &scope, "staff.app.guest.forms.review", &[])?;
    let decision = payload.decision.trim();
    let note = payload.note.as_deref().unwrap_or("").trim();
    if !matches!(decision, "approved" | "correction_required")
        || note.chars().count() > 1000
        || (decision == "correction_required" && note.chars().count() < 3)
    {
        return Err(AppError::validation("invalid form review"));
    }
    let row = clients_repository::create_form_review_event(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        &submission_id,
        decision,
        note,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to review guest form"))?
    .ok_or_else(|| AppError::not_found("submitted review-required form was not found"))?;
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "form_review",
        &submission_id,
        "form.reviewed",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_guest_photo(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Query(query): Query<StaffGuestPhotoQuery>,
    bytes: Bytes,
) -> ApiResult<ClientTreatmentPhotoRecord> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(
        &claims,
        &scope,
        "staff.app.guest.photos.manage",
        &["clients.manage"],
    )?;
    let file_name = query.file_name.trim();
    let caption = query.caption.as_deref().unwrap_or("").trim();
    let service_id = query.service_id.as_deref().unwrap_or("").trim();
    let photo_type = query.photo_type.as_deref().unwrap_or("other").trim();
    let reason = query.consent_reason.as_deref().unwrap_or("").trim();
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if file_name.is_empty()
        || file_name.chars().count() > 180
        || file_name.chars().any(char::is_control)
        || caption.chars().count() > 500
        || !matches!(photo_type, "profile" | "before" | "after" | "other")
        || (!service_id.is_empty() && !scope.service_ids.iter().any(|value| value == service_id))
        || bytes.is_empty()
        || bytes.len() > 5 * 1024 * 1024
        || !matches!(
            content_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        )
        || !photo_content_matches_type(&bytes, &content_type)
    {
        return Err(AppError::validation("invalid guest photo"));
    }
    migration_file_service::scan_upload_bytes(&bytes, !is_local_env(&state.settings.app_env))
        .await?;
    let consent = if query.consent_confirmed.unwrap_or(false) {
        if !(3..=500).contains(&reason.chars().count()) {
            return Err(AppError::validation(
                "photo consent reason must be 3 to 500 characters",
            ));
        }
        clients_repository::record_photo_consent(
            &state.db,
            &scope.tenant_id,
            &scope.branch_id,
            &scope.client_id,
            true,
            reason,
            &claims.sub,
        )
        .await
        .map_err(|_| AppError::internal("failed to record photo consent"))?
    } else {
        clients_repository::latest_photo_consent(
            &state.db,
            &scope.tenant_id,
            &scope.branch_id,
            &scope.client_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate photo consent"))?
    };
    let consent = consent
        .filter(|row| row.opted_in)
        .ok_or_else(|| AppError::validation("guest photo consent is required"))?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let row = clients_repository::save_treatment_photo(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        Some(&appointment_id),
        service_id,
        caption,
        file_name,
        &content_type,
        &sha256,
        photo_type,
        Some(&consent.id),
        bytes.to_vec(),
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to upload guest photo"))?
    .ok_or_else(|| AppError::not_found("guest or appointment was not found"))?;
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "photo",
        &row.id,
        "photo.uploaded",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn staff_guest_photo_content(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((appointment_id, photo_id)): Path<(String, String)>,
) -> Result<Response<Body>, AppError> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    if !staff_guest_permission(&claims, "staff.app.guest.photos.read", &[]) {
        return Err(AppError::forbidden(
            "guest photo read permission is required",
        ));
    }
    let row = clients_repository::get_treatment_photo(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        &photo_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load guest photo"))?
    .ok_or_else(|| AppError::not_found("guest photo was not found"))?;
    let safe_name = row
        .file_name
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-') {
                value
            } else {
                '_'
            }
        })
        .collect::<String>();
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&row.content_type)
                .map_err(|_| AppError::internal("invalid stored photo type"))?,
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{safe_name}\""),
        )
        .body(Body::from(row.content))
        .map_err(|_| AppError::internal("failed to stream guest photo"))
}

async fn staff_guest_photo_delete(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((appointment_id, photo_id)): Path<(String, String)>,
) -> ApiResult<()> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(
        &claims,
        &scope,
        "staff.app.guest.photos.manage",
        &["clients.manage"],
    )?;
    if !clients_repository::delete_treatment_photo(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        &photo_id,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to delete guest photo"))?
    {
        return Err(AppError::not_found("guest photo was not found"));
    }
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "photo",
        &photo_id,
        "photo.deleted",
    );
    Ok(Json(ApiResponse::ok(())))
}

async fn staff_guest_contact_preferences(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(appointment_id): Path<String>,
    Json(payload): Json<ContactPreferencesRequest>,
) -> ApiResult<ClientContactPreferencesRecord> {
    let scope = staff_guest_scope(&state, &claims, &headers, &appointment_id).await?;
    require_staff_guest_action(
        &claims,
        &scope,
        "staff.app.guest.consent.manage",
        &["clients.consent.manage"],
    )?;
    let channel = payload
        .preferred_communication_channel
        .trim()
        .to_lowercase();
    let reason = payload.reason.as_deref().unwrap_or("").trim();
    if !matches!(
        channel.as_str(),
        "none" | "whatsapp" | "sms" | "email" | "phone"
    ) || reason.chars().count() > 500
    {
        return Err(AppError::validation("invalid communication preferences"));
    }
    let preferred_staff_id = payload
        .preferred_staff_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let row = clients_repository::save_contact_preferences(
        &state.db,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        preferred_staff_id,
        &channel,
        payload.whatsapp_opt_in,
        payload.sms_opt_in,
        payload.email_opt_in,
        reason,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to save communication preferences"))?
    .ok_or_else(|| AppError::not_found("guest or preferred staff was not found"))?;
    publish_client_timeline(
        &state,
        &scope.tenant_id,
        &scope.branch_id,
        &scope.client_id,
        "preferences",
        &scope.client_id,
        "preferences.updated",
    );
    Ok(Json(ApiResponse::ok(row)))
}

async fn create_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClientWriteRequest>,
) -> ApiResult<ClientResponse> {
    require_client_permission(&claims, "clients.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    validate_client_write(&payload, true)?;
    let first_name = payload
        .first_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("firstName is required"))?;
    let categories_json = categories_json(payload.categories.as_ref())?;
    let last_name = payload.last_name.as_deref().unwrap_or("").trim();
    let phone = payload.phone.as_deref().unwrap_or("").trim();
    let normalized_phone = client_service::normalize_phone(phone)?;
    let email = payload.email.as_deref().unwrap_or("").trim();
    let membership_label = payload.membership_label.as_deref().unwrap_or("").trim();
    let notes = payload.notes.as_deref().map(str::trim);

    let row = clients_repository::create(
        &state.db,
        CreateClient {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            first_name,
            last_name,
            phone,
            normalized_phone: &normalized_phone,
            email,
            membership_label,
            categories_json: &categories_json,
            birthday: payload.birthday,
            anniversary: payload.anniversary,
            notes,
        },
    )
    .await
    .map_err(|error| client_write_error(error, "failed to create client"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &row.id,
        "client",
        &row.id,
        "client.created",
    );
    Ok(Json(ApiResponse::ok(ClientResponse::from(row))))
}

async fn update_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<ClientWriteRequest>,
) -> ApiResult<ClientResponse> {
    require_client_permission(&claims, "clients.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    validate_client_write(&payload, false)?;
    let categories_json = payload
        .categories
        .as_ref()
        .map(|categories| categories_json(Some(categories)))
        .transpose()?;
    let code = payload.code.as_deref().map(str::trim);
    let first_name = payload.first_name.as_deref().map(str::trim);
    let last_name = payload.last_name.as_deref().map(str::trim);
    let phone = payload.phone.as_deref().map(str::trim);
    let normalized_phone = phone.map(client_service::normalize_phone).transpose()?;
    let email = payload.email.as_deref().map(str::trim);
    let membership_label = payload.membership_label.as_deref().map(str::trim);
    let notes = payload.notes.as_deref().map(str::trim);

    let row = clients_repository::update(
        &state.db,
        UpdateClient {
            tenant_id: &tenant_id,
            branch_id: &branch_id,
            id: &id,
            code,
            first_name,
            last_name,
            phone,
            normalized_phone: normalized_phone.as_deref(),
            email,
            membership_label,
            categories_json: categories_json.as_deref(),
            birthday: payload.birthday,
            anniversary: payload.anniversary,
            notes,
            active: payload.active,
        },
    )
    .await
    .map_err(|error| client_write_error(error, "failed to update client"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    publish_client_timeline(
        &state,
        &tenant_id,
        &branch_id,
        &id,
        "client",
        &id,
        "client.updated",
    );
    Ok(Json(ApiResponse::ok(ClientResponse::from(row))))
}

async fn block_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ClientResponse> {
    set_client_active(&state, &claims, headers, &id, false, "client.blocked").await
}

async fn unblock_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ClientResponse> {
    set_client_active(&state, &claims, headers, &id, true, "client.unblocked").await
}

async fn delete_client(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<ClientResponse> {
    set_client_active(&state, &claims, headers, &id, false, "client.deleted").await
}

async fn set_client_active(
    state: &AppState,
    claims: &AuthClaims,
    headers: HeaderMap,
    id: &str,
    active: bool,
    event_type: &str,
) -> ApiResult<ClientResponse> {
    require_client_permission(claims, "clients.manage")?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = clients_repository::set_client_active(
        &state.db,
        &tenant_id,
        &branch_id,
        id,
        active,
        &claims.sub,
        event_type,
    )
    .await
    .map_err(|_| AppError::internal("failed to update client status"))?
    .ok_or_else(|| AppError::not_found("client was not found"))?;
    publish_client_timeline(state, &tenant_id, &branch_id, id, "client", id, event_type);
    Ok(Json(ApiResponse::ok(ClientResponse::from(row))))
}

fn publish_client_timeline(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    entity_type: &str,
    entity_id: &str,
    action: &str,
) {
    let _ = state.appointment_events.send(AppointmentEvent {
        tenant_id: tenant_id.to_string(),
        branch_id: branch_id.to_string(),
        client_id: client_id.to_string(),
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        action: action.to_string(),
    });
}

fn client_master_kind(value: &str) -> Result<&str, AppError> {
    match value {
        "categories"
        | "sources"
        | "preferences"
        | "consultation-templates"
        | "feedback-definitions"
        | "custom-segments" => Ok(value),
        _ => Err(AppError::not_found("client master type was not found")),
    }
}

fn client_master_kinds() -> [(&'static str, &'static str); 6] {
    [
        ("categories", "Categories"),
        ("sources", "Sources"),
        ("preferences", "Preferences"),
        ("consultation-templates", "Consultation templates"),
        ("feedback-definitions", "Feedback definitions"),
        ("custom-segments", "Custom segments"),
    ]
}

fn normalize_client_custom_form_settings(branch_id: &str, saved: Option<&Value>) -> Value {
    let saved_fields = saved
        .and_then(|value| value.get("fields"))
        .and_then(Value::as_array);
    let fields = default_client_form_fields()
        .into_iter()
        .map(|(key, label, default_enabled, mandatory, display, locked_default, locked_mandatory)| {
            let saved_field = saved_fields.and_then(|fields| {
                fields
                    .iter()
                    .find(|field| field.get("key").and_then(Value::as_str) == Some(key))
            });
            json!({
                "key": key,
                "label": label,
                "default": if locked_default { true } else { saved_bool(saved_field, "default", default_enabled) },
                "mandatory": if locked_mandatory { true } else { saved_bool(saved_field, "mandatory", mandatory) },
                "displayOnBookNow": saved_bool(saved_field, "displayOnBookNow", display),
                "lockedDefault": locked_default,
                "lockedMandatory": locked_mandatory,
            })
        })
        .collect::<Vec<_>>();
    let settings = default_client_form_setting_groups()
        .into_iter()
        .map(|(group_key, defaults)| {
            let saved_group = saved
                .and_then(|value| value.get("settings"))
                .and_then(|value| value.get(group_key));
            let group = defaults
                .into_iter()
                .map(|(key, fallback)| {
                    (
                        key.to_string(),
                        Value::Bool(saved_bool(saved_group, key, fallback)),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            (group_key.to_string(), Value::Object(group))
        })
        .collect::<serde_json::Map<_, _>>();
    json!({ "branchId": branch_id, "fields": fields, "settings": settings })
}

fn saved_bool(saved: Option<&Value>, key: &str, fallback: bool) -> bool {
    saved
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn default_client_form_fields() -> [(&'static str, &'static str, bool, bool, bool, bool, bool); 14]
{
    [
        ("name", "Name", true, true, true, true, true),
        ("contact", "Contact", true, true, true, true, true),
        ("email", "Email", false, false, false, false, false),
        (
            "dateOfBirth",
            "Date Of Birth",
            true,
            false,
            false,
            false,
            false,
        ),
        (
            "dateOfAnniversary",
            "Date Of Anniversary",
            true,
            false,
            false,
            false,
            false,
        ),
        ("gender", "Gender", true, false, false, false, false),
        ("address", "Address", false, false, false, false, false),
        ("gstNumber", "GST Number", false, false, false, false, false),
        (
            "parentName",
            "Parent Name",
            false,
            false,
            false,
            false,
            false,
        ),
        (
            "parentContact",
            "Parent Contact",
            false,
            false,
            false,
            false,
            false,
        ),
        ("childAge", "Child Age", false, false, false, false, false),
        (
            "cardNumber",
            "Card Number",
            false,
            false,
            false,
            false,
            false,
        ),
        (
            "clientDiscountPercentage",
            "Client Discount Percentage",
            false,
            false,
            false,
            false,
            false,
        ),
        (
            "clientPicture",
            "Client Picture",
            false,
            false,
            false,
            false,
            false,
        ),
    ]
}

fn default_client_form_setting_groups() -> [(&'static str, [(&'static str, bool); 4]); 6] {
    [
        (
            "clientFormMasterRules",
            [
                ("mobileNumberRequired", true),
                ("clientNameRequired", true),
                ("duplicateMobileBlock", true),
                ("clientSourceRequired", true),
            ],
        ),
        (
            "personalDetailRules",
            [
                ("birthdayFieldEnabled", true),
                ("anniversaryFieldEnabled", true),
                ("genderFieldEnabled", true),
                ("addressFieldEnabled", true),
            ],
        ),
        (
            "contactValidationRules",
            [
                ("mobileFormatValidation", true),
                ("emailFormatValidation", true),
                ("alternateMobileAllowed", true),
                ("whatsappOptInRequired", false),
            ],
        ),
        (
            "preferenceTagsRules",
            [
                ("clientTagsEnabled", true),
                ("servicePreferenceEnabled", true),
                ("staffPreferenceEnabled", true),
                ("allergyMedicalNoteRequired", true),
            ],
        ),
        (
            "privacyConsentRules",
            [
                ("marketingConsentRequired", true),
                ("dataPrivacyConsentRequired", true),
                ("maskPhoneForStaff", true),
                ("ownerOnlySensitiveFields", true),
            ],
        ),
        (
            "reportingLifecycleRules",
            [
                ("newClientSourceKpi", true),
                ("birthdayAnniversaryCampaignEnabled", true),
                ("inactiveClientAlert", true),
                ("vipClientSegmentFlag", true),
            ],
        ),
    ]
}

fn validate_client_master(
    kind: &str,
    payload: &ClientMasterWriteRequest,
) -> Result<ValidatedClientMaster, AppError> {
    let code = payload.code.trim().to_lowercase();
    let name = payload.name.trim().to_string();
    let description = payload
        .description
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let status = payload
        .status
        .as_deref()
        .unwrap_or("active")
        .trim()
        .to_lowercase();
    let definition = payload
        .definition
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));
    if code.is_empty()
        || code.len() > 80
        || !code.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '_')
        })
        || name.is_empty()
        || name.chars().count() > 120
        || description.chars().count() > 2_000
        || !matches!(status.as_str(), "draft" | "active" | "archived")
        || !definition.is_object()
        || serde_json::to_string(&definition)
            .map(|value| value.len() > 20_000)
            .unwrap_or(true)
    {
        return Err(AppError::validation("invalid client master definition"));
    }
    if kind == "custom-segments" {
        let allowed = [
            "minLifetimeValuePaise",
            "minRfmScore",
            "maxInactiveDays",
            "minChurnRiskScore",
        ];
        let object = definition.as_object().expect("definition was checked");
        if object.keys().any(|key| !allowed.contains(&key.as_str()))
            || object
                .values()
                .any(|value| value.as_i64().is_none_or(|number| number < 0))
            || object
                .get("minRfmScore")
                .and_then(Value::as_i64)
                .is_some_and(|value| value > 15)
            || object
                .get("minChurnRiskScore")
                .and_then(Value::as_i64)
                .is_some_and(|value| value > 100)
        {
            return Err(AppError::validation("invalid custom segment rules"));
        }
    }
    Ok(ValidatedClientMaster {
        code,
        name,
        description,
        definition,
        status,
    })
}

fn validate_discount_rule(
    payload: &ClientDiscountRuleRequest,
) -> Result<ValidatedDiscountRule, AppError> {
    let name = payload.name.trim().to_string();
    let segments = normalized_rule_values(payload.segments.as_deref(), "segments")?;
    let service_categories =
        normalized_rule_values(payload.service_categories.as_deref(), "serviceCategories")?;
    let min_lifetime_value_paise = payload.min_lifetime_value_paise.unwrap_or(0);
    let clv_budget_bps = payload.clv_budget_bps.unwrap_or(500);
    let approval_above_bps = payload.approval_above_bps.unwrap_or(0);
    let priority = payload.priority.unwrap_or(100);
    if name.is_empty()
        || name.chars().count() > 120
        || min_lifetime_value_paise < 0
        || !(1..=10_000).contains(&payload.max_discount_bps)
        || !(0..=10_000).contains(&clv_budget_bps)
        || !(0..=10_000).contains(&approval_above_bps)
        || !(-10_000..=10_000).contains(&priority)
    {
        return Err(AppError::validation("invalid client discount rule"));
    }
    Ok(ValidatedDiscountRule {
        name,
        segments,
        service_categories,
        min_lifetime_value_paise,
        max_discount_bps: payload.max_discount_bps,
        clv_budget_bps,
        approval_above_bps,
        membership_eligible: payload.membership_eligible.unwrap_or(true),
        wallet_eligible: payload.wallet_eligible.unwrap_or(true),
        active: payload.active.unwrap_or(true),
        priority,
    })
}

fn normalized_rule_values(values: Option<&[String]>, field: &str) -> Result<Vec<String>, AppError> {
    let mut values = values
        .unwrap_or_default()
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    if values.len() > 20 || values.iter().any(|value| value.chars().count() > 80) {
        return Err(AppError::validation(format!("invalid {field}")));
    }
    Ok(values)
}

fn discount_rule_write<'a>(
    value: &'a ValidatedDiscountRule,
    actor: &'a str,
) -> ClientDiscountRuleWrite<'a> {
    ClientDiscountRuleWrite {
        name: &value.name,
        segments: &value.segments,
        service_categories: &value.service_categories,
        min_lifetime_value_paise: value.min_lifetime_value_paise,
        max_discount_bps: value.max_discount_bps,
        clv_budget_bps: value.clv_budget_bps,
        approval_above_bps: value.approval_above_bps,
        membership_eligible: value.membership_eligible,
        wallet_eligible: value.wallet_eligible,
        active: value.active,
        priority: value.priority,
        actor,
    }
}

fn client_growth_write_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|database_error| database_error.is_unique_violation())
    {
        AppError::conflict("code already exists for this branch")
    } else {
        AppError::internal("failed to save client growth data")
    }
}

fn categories_json(categories: Option<&Vec<String>>) -> Result<String, AppError> {
    let categories = categories
        .into_iter()
        .flatten()
        .map(|category| category.trim())
        .filter(|category| !category.is_empty())
        .collect::<Vec<_>>();
    if categories.len() > 20
        || categories
            .iter()
            .any(|category| category.chars().count() > 80)
    {
        return Err(AppError::validation(
            "categories must contain at most 20 values of 80 characters",
        ));
    }
    serde_json::to_string(&categories)
        .map_err(|_| AppError::validation("categories must be valid strings"))
}

fn csv_cell(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn is_client_report_type(report_type: &str) -> bool {
    matches!(
        report_type,
        "best-clients"
            | "rfm"
            | "lapsed"
            | "new-returning"
            | "occasions"
            | "service-wise"
            | "revenue"
    )
}

fn client_report_filters<'a>(
    report_type: &str,
    query: &'a ClientReportQuery,
) -> Result<ClientReportFilters<'a>, AppError> {
    let segment = query.segment.as_deref().unwrap_or("").trim();
    let min_lifetime_value_paise = query.min_lifetime_value_paise.unwrap_or(0);
    let min_visits = query.min_visits.unwrap_or(0);
    let max_churn_risk_score = query.max_churn_risk_score.unwrap_or(100);
    if segment.chars().count() > 80
        || min_lifetime_value_paise < 0
        || min_visits < 0
        || !(0..=100).contains(&max_churn_risk_score)
    {
        return Err(AppError::validation("invalid client report filters"));
    }
    let days = if report_type == "best-clients" {
        query.days.unwrap_or(0).clamp(0, 3650)
    } else {
        query.days.unwrap_or(90).clamp(1, 3650)
    };
    Ok(ClientReportFilters {
        days,
        limit: query.limit.unwrap_or(100).clamp(1, 500),
        min_lifetime_value_paise,
        min_visits,
        segment,
        max_churn_risk_score,
        include_unpaid: query.include_unpaid.unwrap_or(true),
    })
}

fn best_clients_csv(rows: &Value) -> String {
    let mut csv = "client_id,client_name,phone,segment,rfm_score,lifetime_value_paise,average_spend_paise,highest_bill_paise,total_visits,last_visit_at,favourite_service,churn_risk_score,unpaid_paise,invoice_count,calculated_at\n".to_owned();
    for row in rows.as_array().into_iter().flatten() {
        let field = |key: &str| {
            row.get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        };
        let number = |key: &str| {
            row.get(key)
                .and_then(Value::as_i64)
                .map(|value| value.to_string())
                .unwrap_or_else(|| "0".to_owned())
        };
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            csv_cell(&field("clientId")),
            csv_cell(&field("clientName")),
            csv_cell(&field("phone")),
            csv_cell(&field("segment")),
            number("rfmScore"),
            number("lifetimeValuePaise"),
            number("averageSpendPaise"),
            number("highestBillPaise"),
            number("totalVisits"),
            csv_cell(&field("lastVisitAt")),
            csv_cell(&field("favouriteService")),
            number("churnRiskScore"),
            number("unpaidPaise"),
            number("invoiceCount"),
            csv_cell(&field("calculatedAt")),
        ));
    }
    csv
}

fn validate_client_write(
    payload: &ClientWriteRequest,
    require_first_name: bool,
) -> Result<(), AppError> {
    let first_name = payload.first_name.as_deref().map(str::trim);
    if require_first_name && first_name.is_none_or(str::is_empty) {
        return Err(AppError::validation("firstName is required"));
    }
    if first_name.is_some_and(|value| value.is_empty() || value.chars().count() > 120)
        || payload
            .last_name
            .as_deref()
            .is_some_and(|value| value.trim().chars().count() > 120)
        || payload
            .code
            .as_deref()
            .is_some_and(|value| value.trim().chars().count() > 80)
        || payload
            .phone
            .as_deref()
            .is_some_and(|value| value.trim().chars().count() > 32)
        || payload
            .membership_label
            .as_deref()
            .is_some_and(|value| value.trim().chars().count() > 120)
        || payload
            .notes
            .as_deref()
            .is_some_and(|value| value.trim().chars().count() > 5_000)
    {
        return Err(AppError::validation("invalid client details"));
    }
    if let Some(email) = payload
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let mut parts = email.split('@');
        if email.chars().count() > 254
            || email.chars().any(char::is_whitespace)
            || parts.next().is_none_or(str::is_empty)
            || parts.next().is_none_or(str::is_empty)
            || parts.next().is_some()
        {
            return Err(AppError::validation("invalid client email"));
        }
    }
    Ok(())
}

fn client_write_error(error: sqlx::Error, fallback: &'static str) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|database_error| database_error.is_unique_violation())
    {
        AppError::conflict("a client with this phone already exists")
    } else {
        AppError::internal(fallback)
    }
}

fn photo_content_matches_type(bytes: &[u8], content_type: &str) -> bool {
    match content_type {
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn require_form_manager(claims: &AuthClaims) -> Result<(), AppError> {
    if matches!(claims.role.as_str(), "owner" | "admin" | "manager")
        || claims
            .permissions
            .iter()
            .any(|permission| permission == "clients.forms.manage")
    {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "client form management permission is required",
        ))
    }
}

fn require_client_permission(claims: &AuthClaims, permission: &str) -> Result<(), AppError> {
    if matches!(claims.role.as_str(), "owner" | "admin" | "manager")
        || claims
            .permissions
            .iter()
            .any(|granted| granted == permission)
    {
        Ok(())
    } else {
        Err(AppError::forbidden("client permission is required"))
    }
}

fn parse_timeline_cursor(cursor: &str) -> Result<(Option<DateTime<Utc>>, String), AppError> {
    let (occurred_at, id) = cursor
        .rsplit_once('|')
        .filter(|(_, id)| !id.is_empty())
        .ok_or_else(|| AppError::validation("invalid timeline cursor"))?;
    let occurred_at = DateTime::parse_from_rfc3339(occurred_at)
        .map_err(|_| AppError::validation("invalid timeline cursor"))?
        .with_timezone(&Utc);
    Ok((Some(occurred_at), id.to_owned()))
}

fn timeline_cursor(event: &ClientTimelineEventRecord) -> String {
    format!("{}|{}", event.occurred_at.to_rfc3339(), event.id)
}

fn validate_soap_note(
    payload: &ClientSoapNoteRequest,
) -> Result<(String, String, String, String, String), AppError> {
    let subjective = payload
        .subjective
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_owned();
    let objective = payload.objective.as_deref().unwrap_or("").trim().to_owned();
    let assessment = payload
        .assessment
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_owned();
    let plan = payload.plan.as_deref().unwrap_or("").trim().to_owned();
    let status = payload
        .status
        .as_deref()
        .unwrap_or("draft")
        .trim()
        .to_lowercase();
    if [&subjective, &objective, &assessment, &plan]
        .iter()
        .all(|value| value.is_empty())
        || [&subjective, &objective, &assessment, &plan]
            .iter()
            .any(|value| value.chars().count() > 5_000)
        || !matches!(status.as_str(), "draft" | "final")
    {
        return Err(AppError::validation("invalid SOAP note"));
    }
    Ok((subjective, objective, assessment, plan, status))
}

fn validate_form_fields(fields: &Value) -> Result<(), AppError> {
    let fields = fields
        .as_array()
        .filter(|rows| rows.len() <= 50)
        .ok_or_else(|| AppError::validation("fields must be an array with at most 50 items"))?;
    let mut keys = HashSet::new();
    for field in fields {
        let object = field
            .as_object()
            .ok_or_else(|| AppError::validation("each form field must be an object"))?;
        let key = object.get("key").and_then(Value::as_str).unwrap_or("");
        let label = object.get("label").and_then(Value::as_str).unwrap_or("");
        let field_type = object.get("type").and_then(Value::as_str).unwrap_or("");
        if key.is_empty()
            || key.len() > 60
            || !key.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
            })
            || !keys.insert(key)
            || label.trim().is_empty()
            || label.chars().count() > 160
            || !matches!(
                field_type,
                "text"
                    | "textarea"
                    | "boolean"
                    | "date"
                    | "number"
                    | "select"
                    | "signature"
                    | "table"
                    | "clinical"
                    | "section"
            )
            || object
                .get("required")
                .is_some_and(|value| !value.is_boolean())
            || (field_type == "section"
                && object
                    .get("required")
                    .and_then(Value::as_bool)
                    .unwrap_or(false))
        {
            return Err(AppError::validation("invalid client form field"));
        }
        if field_type == "select" {
            let options = object
                .get("options")
                .and_then(Value::as_array)
                .filter(|options| !options.is_empty() && options.len() <= 30)
                .ok_or_else(|| AppError::validation("select fields require options"))?;
            if options.iter().any(|option| {
                option
                    .as_str()
                    .is_none_or(|value| value.trim().is_empty() || value.chars().count() > 120)
            }) {
                return Err(AppError::validation("invalid select field options"));
            }
        }
        if field_type == "number"
            && (object.get("min").is_some_and(|value| !value.is_number())
                || object.get("max").is_some_and(|value| !value.is_number())
                || object
                    .get("min")
                    .and_then(Value::as_f64)
                    .zip(object.get("max").and_then(Value::as_f64))
                    .is_some_and(|(min, max)| min > max))
        {
            return Err(AppError::validation("invalid number field range"));
        }
        if field_type == "table" {
            let columns = object
                .get("columns")
                .and_then(Value::as_array)
                .filter(|columns| !columns.is_empty() && columns.len() <= 20)
                .ok_or_else(|| AppError::validation("table fields require columns"))?;
            let mut column_keys = HashSet::new();
            if columns.iter().any(|column| {
                let Some(column) = column.as_object() else {
                    return true;
                };
                let key = column.get("key").and_then(Value::as_str).unwrap_or("");
                let label = column.get("label").and_then(Value::as_str).unwrap_or("");
                let kind = column.get("type").and_then(Value::as_str).unwrap_or("text");
                key.is_empty()
                    || !key.chars().all(|character| {
                        character.is_ascii_lowercase()
                            || character.is_ascii_digit()
                            || character == '_'
                    })
                    || !column_keys.insert(key)
                    || label.trim().is_empty()
                    || label.chars().count() > 120
                    || !matches!(kind, "text" | "number" | "date" | "boolean")
            }) {
                return Err(AppError::validation("invalid table field columns"));
            }
        }
    }
    for field in fields {
        let current_key = field.get("key").and_then(Value::as_str).unwrap_or("");
        if let Some(section_key) = field.get("sectionKey").and_then(Value::as_str) {
            if section_key == current_key
                || !fields.iter().any(|candidate| {
                    candidate.get("key").and_then(Value::as_str) == Some(section_key)
                        && candidate.get("type").and_then(Value::as_str) == Some("section")
                })
            {
                return Err(AppError::validation("invalid sectionKey"));
            }
        }
        let Some(condition) = field.get("visibleWhen") else {
            continue;
        };
        let condition = condition
            .as_object()
            .ok_or_else(|| AppError::validation("visibleWhen must be an object"))?;
        let field_key = condition
            .get("fieldKey")
            .and_then(Value::as_str)
            .unwrap_or("");
        let equals = condition.get("equals");
        if field_key.is_empty()
            || field_key == current_key
            || !keys.contains(field_key)
            || equals
                .is_none_or(|value| !(value.is_string() || value.is_boolean() || value.is_number()))
        {
            return Err(AppError::validation("invalid visibleWhen condition"));
        }
    }
    Ok(())
}

fn field_condition_is_visible(field: &Value, responses: &serde_json::Map<String, Value>) -> bool {
    let Some(condition) = field.get("visibleWhen").and_then(Value::as_object) else {
        return true;
    };
    let Some(field_key) = condition.get("fieldKey").and_then(Value::as_str) else {
        return false;
    };
    responses.get(field_key) == condition.get("equals")
}

fn form_field_is_visible(
    field: &Value,
    fields: &[Value],
    responses: &serde_json::Map<String, Value>,
) -> bool {
    if !field_condition_is_visible(field, responses) {
        return false;
    }
    let Some(section_key) = field.get("sectionKey").and_then(Value::as_str) else {
        return true;
    };
    fields
        .iter()
        .find(|candidate| candidate.get("key").and_then(Value::as_str) == Some(section_key))
        .is_some_and(|section| field_condition_is_visible(section, responses))
}

pub(crate) fn validate_form_responses(fields: &Value, responses: &Value) -> Result<(), AppError> {
    validate_form_responses_mode(fields, responses, true)
}

fn validate_form_draft_responses(fields: &Value, responses: &Value) -> Result<(), AppError> {
    validate_form_responses_mode(fields, responses, false)
}

fn validate_form_responses_mode(
    fields: &Value,
    responses: &Value,
    enforce_required: bool,
) -> Result<(), AppError> {
    let responses = responses
        .as_object()
        .ok_or_else(|| AppError::validation("responses must be an object"))?;
    if serde_json::to_string(responses)
        .map_err(|_| AppError::validation("invalid form responses"))?
        .len()
        > 50_000
    {
        return Err(AppError::validation("form responses are too large"));
    }
    let fields = fields
        .as_array()
        .ok_or_else(|| AppError::validation("stored form definition is invalid"))?;
    let allowed = fields
        .iter()
        .filter_map(|field| field.get("key").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    if responses.keys().any(|key| !allowed.contains(key.as_str())) {
        return Err(AppError::validation(
            "form response contains an unknown field",
        ));
    }
    for field in fields {
        if !form_field_is_visible(field, fields, responses) {
            continue;
        }
        let key = field.get("key").and_then(Value::as_str).unwrap_or("");
        let field_type = field.get("type").and_then(Value::as_str).unwrap_or("");
        let required = field
            .get("required")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let value = responses.get(key);
        if field_type == "section" {
            continue;
        }
        let missing = match value {
            None | Some(Value::Null) => true,
            Some(Value::String(value)) => value.trim().is_empty(),
            _ => false,
        };
        if enforce_required && required && missing {
            return Err(AppError::validation(format!("{key} is required")));
        }
        if missing {
            continue;
        }
        let valid = match (field_type, value) {
            ("text" | "textarea", Some(Value::String(value))) => value.chars().count() <= 5_000,
            ("boolean", Some(Value::Bool(_))) => true,
            ("date", Some(Value::String(value))) => {
                NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
            }
            ("number", Some(Value::Number(value))) => value.as_f64().is_some_and(|number| {
                field
                    .get("min")
                    .and_then(Value::as_f64)
                    .is_none_or(|min| number >= min)
                    && field
                        .get("max")
                        .and_then(Value::as_f64)
                        .is_none_or(|max| number <= max)
            }),
            ("select", Some(Value::String(value))) => field
                .get("options")
                .and_then(Value::as_array)
                .is_some_and(|options| options.iter().any(|option| option.as_str() == Some(value))),
            ("signature", Some(Value::String(value))) => {
                (2..=500).contains(&value.trim().chars().count())
            }
            ("clinical", Some(Value::String(value))) => value.chars().count() <= 10_000,
            ("table", Some(Value::Array(rows))) => {
                let columns = field.get("columns").and_then(Value::as_array);
                rows.len() <= 50
                    && columns.is_some_and(|columns| {
                        let allowed = columns
                            .iter()
                            .filter_map(|column| column.get("key").and_then(Value::as_str))
                            .collect::<HashSet<_>>();
                        rows.iter().all(|row| {
                            row.as_object().is_some_and(|row| {
                                row.len() <= allowed.len()
                                    && row.keys().all(|key| allowed.contains(key.as_str()))
                                    && columns.iter().all(|column| {
                                        let key =
                                            column.get("key").and_then(Value::as_str).unwrap_or("");
                                        let Some(value) = row.get(key) else {
                                            return true;
                                        };
                                        match column
                                            .get("type")
                                            .and_then(Value::as_str)
                                            .unwrap_or("text")
                                        {
                                            "text" => value
                                                .as_str()
                                                .is_some_and(|value| value.chars().count() <= 500),
                                            "number" => value.is_number(),
                                            "date" => value.as_str().is_some_and(|value| {
                                                NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
                                            }),
                                            "boolean" => value.is_boolean(),
                                            _ => false,
                                        }
                                    })
                            })
                        })
                    })
            }
            _ => false,
        };
        if !valid {
            return Err(AppError::validation(format!("invalid response for {key}")));
        }
    }
    Ok(())
}

impl From<ClientRecord> for ClientResponse {
    fn from(record: ClientRecord) -> Self {
        Self {
            id: record.id,
            tenant_id: record.tenant_id,
            branch_id: record.branch_id,
            code: record.code,
            first_name: record.first_name,
            last_name: record.last_name,
            phone: record.phone,
            normalized_phone: record.normalized_phone,
            email: record.email,
            wallet_balance_paise: record.wallet_balance_paise,
            duplicate_count: record.duplicate_count,
            last_visit_at: record.last_visit_at,
            membership_label: record.membership_label,
            categories: serde_json::from_str(&record.categories_json)
                .unwrap_or(Value::Array(vec![])),
            birthday: record.birthday,
            anniversary: record.anniversary,
            notes: record.notes,
            active: record.active,
            preferred_staff_id: record.preferred_staff_id,
            preferred_staff_name: record.preferred_staff_name,
            preferred_communication_channel: record.preferred_communication_channel,
            whatsapp_opt_in: record.whatsapp_opt_in,
            sms_opt_in: record.sms_opt_in,
            email_opt_in: record.email_opt_in,
            merged_into_client_id: record.merged_into_client_id,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_timeline_cursor, photo_content_matches_type, timeline_cursor, validate_form_responses,
    };
    use crate::repositories::clients_repository::ClientTimelineEventRecord;
    use chrono::{TimeZone, Utc};

    #[test]
    fn treatment_photo_content_must_match_declared_type() {
        assert!(photo_content_matches_type(
            b"\x89PNG\r\n\x1a\nrest",
            "image/png"
        ));
        assert!(!photo_content_matches_type(b"not-an-image", "image/png"));
        assert!(!photo_content_matches_type(
            b"\xff\xd8\xffrest",
            "image/webp"
        ));
    }

    #[test]
    fn timeline_cursor_round_trips_timestamp_and_id() {
        let occurred_at = Utc.with_ymd_and_hms(2026, 7, 14, 10, 30, 0).unwrap();
        let event = ClientTimelineEventRecord {
            id: "appointment:event-1".to_owned(),
            event_type: "Appointments".to_owned(),
            title: "Appointment Completed".to_owned(),
            detail: String::new(),
            occurred_at,
            amount_paise: None,
            status: None,
            group_id: None,
            tip_paise: None,
            balance_paise: None,
            line_items: serde_json::json!([]),
        };

        assert!(serde_json::to_value(&event).unwrap()["lineItems"].is_array());

        let (parsed_at, parsed_id) = parse_timeline_cursor(&timeline_cursor(&event)).unwrap();
        assert_eq!(parsed_at, Some(occurred_at));
        assert_eq!(parsed_id, event.id);
        assert!(parse_timeline_cursor("not-a-cursor").is_err());
    }

    #[test]
    fn conditional_required_field_is_only_required_when_visible() {
        let fields = serde_json::json!([
            {"key":"has_allergy","label":"Allergy","type":"boolean","required":true},
            {"key":"allergy_detail","label":"Details","type":"text","required":true,"visibleWhen":{"fieldKey":"has_allergy","equals":true}}
        ]);
        assert!(
            validate_form_responses(&fields, &serde_json::json!({"has_allergy":false})).is_ok()
        );
        assert!(
            validate_form_responses(&fields, &serde_json::json!({"has_allergy":true})).is_err()
        );
    }
}
