use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use passkey_auth::AuthenticationResponse;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_attendance_repository::{
            AttendanceAdjustmentInput, AttendanceBreakInput, AttendanceCorrectionInput,
        },
    },
    routes::context::tenant_branch,
    services::{
        auth_service::{self, AuthClaims},
        staff_attendance_service, staff_enterprise_service, webauthn_service,
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/staff-attendance/summary",
            get(get_summary).put(save_summary),
        )
        .route(
            "/staff-attendance/summary/recalculate",
            post(recalculate_summary),
        )
        .route("/staff-attendance/:staff_id/details", get(get_details))
        .route("/staff-attendance/clock-in", post(clock_in))
        .route(
            "/staff-attendance/biometric/begin",
            post(begin_biometric_clock_in),
        )
        .route(
            "/staff-attendance/early-departure-requests",
            get(list_early_departure_requests).post(create_early_departure_request),
        )
        .route(
            "/staff-attendance/face-policy",
            get(get_face_policy).put(save_face_policy),
        )
        .route(
            "/staff-attendance/face-exceptions",
            get(list_face_exceptions),
        )
        .route(
            "/staff-attendance/face-exceptions/:id/approve",
            post(approve_face_exception),
        )
        .route(
            "/staff-attendance/face-devices/:device_uid/approve",
            post(approve_face_device),
        )
        .route("/staff-attendance/clock-out", post(clock_out))
        .route("/staff-attendance/break-start", post(start_break))
        .route("/staff-attendance/break-end", post(end_break))
        .route(
            "/staff-attendance/:staff_id/:business_date/correction",
            axum::routing::patch(correct_attendance),
        )
        .route("/staff-attendance/overtime", get(list_overtime))
        .route(
            "/staff-attendance/overtime/:attendance_id/decision",
            post(decide_overtime),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryQuery {
    cycle: Option<String>,
    year: i32,
    month: u32,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSummaryRequest {
    year: i32,
    month: u32,
    entries: Vec<SaveSummaryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSummaryEntry {
    staff_id: String,
    weekly_off_adjustment: f64,
    special_leave_adjustment: f64,
    comments: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClockInRequest {
    staff_id: String,
    business_date: NaiveDate,
    clock_in_at: Option<DateTime<Utc>>,
    source: Option<String>,
    comments: Option<String>,
    face_scan: Option<FaceScanEvidence>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaceScanEvidence {
    device_uid: String,
    latitude: f64,
    longitude: f64,
    accuracy_meters: Option<f64>,
    challenge_id: Option<String>,
    credential: Option<AuthenticationResponse>,
}

const ATTENDANCE_WEBAUTHN_PURPOSE: &str = "staff-attendance";

#[derive(Debug, FromRow)]
struct FaceAttendancePolicy {
    enabled: bool,
    allowed_radius_meters: i32,
    device_mode: String,
    network_mode: String,
    ip_allowlist_json: Value,
    liveness_mode: String,
    branch_latitude: Option<f64>,
    branch_longitude: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FacePolicyRequest {
    enabled: bool,
    allowed_radius_meters: i32,
    device_mode: String,
    network_mode: String,
    ip_allowlist: Vec<String>,
    liveness_mode: String,
}

#[derive(Debug, FromRow)]
struct FaceExceptionApprovalRow {
    staff_id: String,
    created_at: DateTime<Utc>,
}

async fn list_early_departure_requests(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<crate::repositories::staff_enterprise_repository::ApprovalRequestRecord>> {
    ensure_attendance_read(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    Ok(Json(ApiResponse::ok(
        staff_enterprise_service::list_self_early_departures(
            &state.db,
            &tenant_id,
            &branch_id,
            &claims.sub,
        )
        .await?,
    )))
}

async fn create_early_departure_request(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<staff_enterprise_service::EarlyDepartureRequest>,
) -> ApiResult<crate::repositories::staff_enterprise_repository::ApprovalRequestRecord> {
    ensure_attendance_manage(&claims)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_enterprise_service::request_early_departure(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &claims.role,
        payload,
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.early_departure.requested",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({"requestId":row.id,"staffId":row.entity_id}),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClockOutRequest {
    staff_id: String,
    business_date: NaiveDate,
    clock_out_at: Option<DateTime<Utc>>,
    penalty_paise: Option<i64>,
    comments: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BreakRequest {
    staff_id: String,
    business_date: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttendanceCorrectionRequest {
    clock_in_at: Option<DateTime<Utc>>,
    clock_out_at: Option<DateTime<Utc>>,
    manual_status: Option<String>,
    penalty_paise: Option<i64>,
    comments: Option<String>,
    correction_reason: String,
    #[serde(default)]
    breaks: Vec<AttendanceBreakRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttendanceBreakRequest {
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    comments: Option<String>,
}

async fn get_summary(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<SummaryQuery>,
) -> ApiResult<Vec<staff_attendance_service::AttendanceSummaryRow>> {
    ensure_attendance_read(&claims)?;
    validate_cycle(query.cycle.as_deref())?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or("").trim(),
    )
    .await?;
    let rows = staff_attendance_service::summary(
        &state.db,
        &tenant_id,
        &branch_id,
        query.year,
        query.month,
        &staff_id,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn recalculate_summary(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<SummaryQuery>,
) -> ApiResult<Vec<staff_attendance_service::AttendanceSummaryRow>> {
    get_summary(State(state), Extension(claims), headers, Query(query)).await
}

async fn save_summary(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SaveSummaryRequest>,
) -> ApiResult<Vec<staff_attendance_service::AttendanceSummaryRow>> {
    ensure_attendance_manage(&claims)?;
    if !is_attendance_manager(&claims) {
        return Err(AppError::forbidden("Attendance manager access is required"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_attendance_service::save_adjustments(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.year,
        payload.month,
        payload
            .entries
            .into_iter()
            .map(|entry| AttendanceAdjustmentInput {
                staff_id: entry.staff_id.trim().to_string(),
                weekly_off_adjustment: entry.weekly_off_adjustment,
                special_leave_adjustment: entry.special_leave_adjustment,
                comments: entry.comments.trim().to_string(),
            })
            .collect(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn get_details(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(staff_id): Path<String>,
    Query(query): Query<SummaryQuery>,
) -> ApiResult<Vec<crate::repositories::staff_attendance_repository::AttendanceDetailRecord>> {
    ensure_attendance_read(&claims)?;
    validate_cycle(query.cycle.as_deref())?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        self_scoped_staff_id(&state, &claims, &tenant_id, &branch_id, staff_id.trim()).await?;
    let rows = staff_attendance_service::details(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        query.year,
        query.month,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn enforce_face_attendance_policy(
    state: &AppState,
    headers: &HeaderMap,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    user_id: &str,
    evidence: Option<&FaceScanEvidence>,
) -> Result<(), AppError> {
    let Some(evidence) = evidence else {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            "",
            "",
            "missing_face_evidence",
            None,
            None,
            None,
            None,
            json!({}),
        )
        .await;
        return Err(AppError::validation("face attendance evidence is required"));
    };
    let source_ip = headers
        .get("x-aurashine-source-ip")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim();
    if evidence.device_uid.trim().is_empty()
        || evidence.device_uid.chars().count() > 200
        || !valid_geo(evidence.latitude, evidence.longitude)
    {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
            source_ip,
            "invalid_face_evidence",
            Some(evidence.latitude),
            Some(evidence.longitude),
            evidence.accuracy_meters,
            None,
            face_evidence_json(evidence),
        )
        .await;
        return Err(AppError::validation("face attendance evidence is invalid"));
    }
    let policy = load_face_policy(state, tenant_id, branch_id).await?;
    if !policy.enabled {
        return Err(AppError::forbidden(
            "face attendance is disabled for this branch",
        ));
    }
    let (Some(branch_lat), Some(branch_lng)) = (policy.branch_latitude, policy.branch_longitude)
    else {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
            source_ip,
            "branch_location_not_configured",
            Some(evidence.latitude),
            Some(evidence.longitude),
            evidence.accuracy_meters,
            None,
            face_evidence_json(evidence),
        )
        .await;
        return Err(AppError::validation("branch location is not configured"));
    };
    let distance = distance_meters(
        branch_lat,
        branch_lng,
        evidence.latitude,
        evidence.longitude,
    );
    let accuracy = evidence.accuracy_meters.unwrap_or(9999.0);
    if !accuracy.is_finite()
        || accuracy > 100.0
        || distance > f64::from(policy.allowed_radius_meters)
    {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
            source_ip,
            "outside_branch_radius",
            Some(evidence.latitude),
            Some(evidence.longitude),
            evidence.accuracy_meters,
            Some(distance),
            face_evidence_json(evidence),
        )
        .await;
        return Err(AppError::validation(
            "face attendance is allowed only inside the branch radius",
        ));
    }
    if policy.device_mode != "off" {
        let trust_status = ensure_face_device(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
        )
        .await?;
        if policy.device_mode == "approved" && trust_status != "approved" {
            record_face_exception(
                state,
                tenant_id,
                branch_id,
                staff_id,
                evidence.device_uid.trim(),
                source_ip,
                "device_not_approved",
                Some(evidence.latitude),
                Some(evidence.longitude),
                evidence.accuracy_meters,
                Some(distance),
                face_evidence_json(evidence),
            )
            .await;
            return Err(AppError::forbidden(
                "this device is not approved for face attendance",
            ));
        }
    }
    if policy.network_mode != "off" && !ip_allowed(&policy.ip_allowlist_json, source_ip) {
        if policy.network_mode == "required" || !ip_allowlist_empty(&policy.ip_allowlist_json) {
            record_face_exception(
                state,
                tenant_id,
                branch_id,
                staff_id,
                evidence.device_uid.trim(),
                source_ip,
                "network_not_allowed",
                Some(evidence.latitude),
                Some(evidence.longitude),
                evidence.accuracy_meters,
                Some(distance),
                face_evidence_json(evidence),
            )
            .await;
            return Err(AppError::forbidden(
                "face attendance is allowed only from the branch network",
            ));
        }
    }
    if policy.liveness_mode == "provider" {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
            source_ip,
            "trusted_provider_required",
            Some(evidence.latitude),
            Some(evidence.longitude),
            evidence.accuracy_meters,
            Some(distance),
            face_evidence_json(evidence),
        )
        .await;
        return Err(AppError::forbidden(
            "provider face attendance must come from an approved biometric gateway",
        ));
    }
    let challenge_id = evidence.challenge_id.as_deref().unwrap_or("").trim();
    let Some(credential) = evidence.credential.as_ref() else {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
            source_ip,
            "biometric_verification_failed",
            Some(evidence.latitude),
            Some(evidence.longitude),
            evidence.accuracy_meters,
            Some(distance),
            face_evidence_json(evidence),
        )
        .await;
        return Err(AppError::unauthenticated(
            "biometric verification is required",
        ));
    };
    if challenge_id.is_empty()
        || webauthn_service::finish_authentication_for_purpose(
            &state.db,
            &state.settings,
            tenant_id,
            Some(user_id),
            ATTENDANCE_WEBAUTHN_PURPOSE,
            challenge_id,
            credential,
        )
        .await
        .is_err()
    {
        record_face_exception(
            state,
            tenant_id,
            branch_id,
            staff_id,
            evidence.device_uid.trim(),
            source_ip,
            "biometric_verification_failed",
            Some(evidence.latitude),
            Some(evidence.longitude),
            evidence.accuracy_meters,
            Some(distance),
            face_evidence_json(evidence),
        )
        .await;
        return Err(AppError::unauthenticated(
            "biometric verification could not be verified",
        ));
    }
    Ok(())
}

async fn load_face_policy(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<FaceAttendancePolicy, AppError> {
    sqlx::query_as::<_, FaceAttendancePolicy>(r#"SELECT COALESCE(policy.enabled, TRUE) AS enabled, COALESCE(policy.allowed_radius_meters, 200) AS allowed_radius_meters, COALESCE(policy.device_mode, 'approved') AS device_mode, COALESCE(policy.network_mode, 'optional') AS network_mode, COALESCE(policy.ip_allowlist_json, '[]'::jsonb) AS ip_allowlist_json, COALESCE(policy.liveness_mode, 'basic') AS liveness_mode, branch.latitude AS branch_latitude, branch.longitude AS branch_longitude FROM branches branch LEFT JOIN staff_face_attendance_policies policy ON policy.tenant_id=branch.tenant_id AND policy.branch_id=COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) WHERE branch.tenant_id=$1 AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=$2 LIMIT 1"#)
        .bind(tenant_id).bind(branch_id).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to load face attendance policy"))?.ok_or_else(|| AppError::validation("branch is invalid"))
}

async fn ensure_face_device(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    device_uid: &str,
) -> Result<String, AppError> {
    let row = sqlx::query_as::<_, (String, String)>("SELECT staff_id, trust_status FROM staff_mobile_devices WHERE tenant_id=$1 AND device_uid=$2 AND active=TRUE")
        .bind(tenant_id).bind(device_uid).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to verify face attendance device"))?;
    if let Some((owner_staff_id, trust_status)) = row {
        if owner_staff_id != staff_id {
            return Err(AppError::forbidden(
                "this device belongs to another staff profile",
            ));
        }
        return Ok(trust_status);
    }
    sqlx::query_scalar::<_, String>("INSERT INTO staff_mobile_devices(tenant_id,branch_id,staff_id,device_uid,platform,sync_token_hash,trust_status) VALUES($1,$2,$3,$4,'web','', 'pending') RETURNING trust_status")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(device_uid).fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to register face attendance device"))
}

async fn record_face_exception(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    device_uid: &str,
    source_ip: &str,
    reason_code: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
    accuracy: Option<f64>,
    distance: Option<f64>,
    evidence: Value,
) {
    let _ = sqlx::query("INSERT INTO staff_face_attendance_exceptions(tenant_id,branch_id,staff_id,device_uid,source_ip,latitude,longitude,accuracy_meters,distance_meters,reason_code,evidence_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(tenant_id).bind(branch_id).bind(staff_id).bind(device_uid).bind(source_ip).bind(latitude).bind(longitude).bind(accuracy).bind(distance).bind(reason_code).bind(evidence).execute(&state.db).await;
}

fn face_evidence_json(evidence: &FaceScanEvidence) -> Value {
    json!({"accuracyMeters": evidence.accuracy_meters, "verification": if evidence.challenge_id.as_deref().unwrap_or("").trim().is_empty() { "missing" } else { "webauthn" }})
}
fn valid_geo(latitude: f64, longitude: f64) -> bool {
    latitude.is_finite()
        && longitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && (-180.0..=180.0).contains(&longitude)
}
fn distance_meters(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6_371_000.0_f64;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * r * a.sqrt().asin()
}
fn ip_allowlist_empty(value: &Value) -> bool {
    value
        .as_array()
        .map(|items| items.is_empty())
        .unwrap_or(true)
}
fn ip_allowed(value: &Value, source_ip: &str) -> bool {
    !source_ip.is_empty()
        && value
            .as_array()
            .map(|items| {
                items.iter().any(|item| {
                    item.as_str()
                        .map(|ip| ip.trim() == source_ip)
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
}
async fn get_face_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Value> {
    ensure_overtime_access(
        &claims,
        &["staff.attendance.manage", "staff.app.attendance.manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let policy = load_face_policy(&state, &tenant_id, &branch_id).await?;
    Ok(Json(ApiResponse::ok(json!({
        "enabled": policy.enabled,
        "allowedRadiusMeters": policy.allowed_radius_meters,
        "deviceMode": policy.device_mode,
        "networkMode": policy.network_mode,
        "ipAllowlist": policy.ip_allowlist_json,
        "livenessMode": policy.liveness_mode
    }))))
}

async fn save_face_policy(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<FacePolicyRequest>,
) -> ApiResult<Value> {
    ensure_overtime_access(
        &claims,
        &["staff.attendance.manage", "staff.app.attendance.manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    if !(25..=5000).contains(&payload.allowed_radius_meters) {
        return Err(AppError::validation(
            "allowed radius must be 25-5000 meters",
        ));
    }
    if !["off", "pending", "approved"].contains(&payload.device_mode.as_str())
        || !["off", "optional", "required"].contains(&payload.network_mode.as_str())
        || !["none", "basic", "provider"].contains(&payload.liveness_mode.as_str())
        || payload
            .ip_allowlist
            .iter()
            .any(|ip| ip.trim().is_empty() || ip.chars().count() > 64)
    {
        return Err(AppError::validation("face attendance policy is invalid"));
    }
    let ips: Vec<String> = payload
        .ip_allowlist
        .into_iter()
        .map(|ip| ip.trim().to_string())
        .filter(|ip| !ip.is_empty())
        .collect();
    let row = sqlx::query_scalar::<_, Value>(
        r#"INSERT INTO staff_face_attendance_policies(tenant_id,branch_id,enabled,allowed_radius_meters,device_mode,network_mode,ip_allowlist_json,liveness_mode,updated_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(tenant_id,branch_id) DO UPDATE SET enabled=EXCLUDED.enabled,allowed_radius_meters=EXCLUDED.allowed_radius_meters,device_mode=EXCLUDED.device_mode,network_mode=EXCLUDED.network_mode,ip_allowlist_json=EXCLUDED.ip_allowlist_json,liveness_mode=EXCLUDED.liveness_mode,updated_by=EXCLUDED.updated_by,updated_at=NOW()
           RETURNING jsonb_build_object('enabled',enabled,'allowedRadiusMeters',allowed_radius_meters,'deviceMode',device_mode,'networkMode',network_mode,'ipAllowlist',ip_allowlist_json,'livenessMode',liveness_mode)"#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(payload.enabled).bind(payload.allowed_radius_meters).bind(&payload.device_mode).bind(&payload.network_mode).bind(json!(ips)).bind(&payload.liveness_mode).bind(&claims.sub)
    .fetch_one(&state.db).await.map_err(|_| AppError::internal("failed to save face attendance policy"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn approve_face_exception(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Value> {
    ensure_overtime_access(
        &claims,
        &["staff.attendance.manage", "staff.app.attendance.manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = sqlx::query_as::<_, FaceExceptionApprovalRow>("SELECT staff_id,created_at FROM staff_face_attendance_exceptions WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending'")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).fetch_optional(&state.db).await.map_err(|_| AppError::internal("failed to load face attendance exception"))?.ok_or_else(|| AppError::not_found("face attendance exception was not found"))?;
    let ist = FixedOffset::east_opt(19_800).expect("valid IST offset");
    let business_date = row.created_at.with_timezone(&ist).date_naive();
    let attendance = staff_attendance_service::clock_in(
        &state.db,
        &tenant_id,
        &branch_id,
        &row.staff_id,
        business_date,
        Some(row.created_at),
        "staff-app-face-approved",
        "approved from face attendance exception",
    )
    .await?;
    sqlx::query("UPDATE staff_face_attendance_exceptions SET status='approved',reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(&tenant_id).bind(&branch_id).bind(id.trim()).bind(&claims.sub).execute(&state.db).await.map_err(|_| AppError::internal("failed to approve face attendance exception"))?;
    Ok(Json(ApiResponse::ok(
        json!({"attendanceId": attendance.id, "status": "approved"}),
    )))
}
async fn approve_face_device(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(device_uid): Path<String>,
) -> ApiResult<Value> {
    ensure_overtime_access(
        &claims,
        &["staff.attendance.manage", "staff.app.attendance.manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let device_uid = device_uid.trim();
    if device_uid.is_empty() || device_uid.chars().count() > 200 {
        return Err(AppError::validation("face device is invalid"));
    }
    let row = sqlx::query_scalar::<_, Value>(
        "UPDATE staff_mobile_devices SET trust_status='approved',trusted_by=$4,trusted_at=NOW(),updated_at=NOW(),version=version+1 WHERE tenant_id=$1 AND branch_id=$2 AND device_uid=$3 AND active=TRUE RETURNING jsonb_build_object('deviceUid',device_uid,'trustStatus',trust_status,'trustedAt',trusted_at)",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(device_uid)
    .bind(&claims.sub)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to approve face attendance device"))?
    .ok_or_else(|| AppError::not_found("face attendance device was not found"))?;
    Ok(Json(ApiResponse::ok(row)))
}
async fn list_face_exceptions(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<Vec<Value>> {
    ensure_overtime_access(
        &claims,
        &["staff.attendance.manage", "staff.app.attendance.manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'id', exception.id,
          'staffId', exception.staff_id,
          'staffName', COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),exception.staff_id),
          'deviceUid', exception.device_uid,
          'sourceIp', exception.source_ip,
          'reasonCode', exception.reason_code,
          'status', exception.status,
          'distanceMeters', exception.distance_meters,
          'accuracyMeters', exception.accuracy_meters,
          'createdAt', exception.created_at
        )
        FROM staff_face_attendance_exceptions exception
        LEFT JOIN staff ON staff.tenant_id=exception.tenant_id AND staff.branch_id=exception.branch_id AND staff.id=exception.staff_id
        WHERE exception.tenant_id=$1 AND exception.branch_id=$2
        ORDER BY exception.created_at DESC LIMIT 100"#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load face attendance exceptions"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn begin_biometric_clock_in(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<webauthn_service::AuthenticationStart> {
    ensure_attendance_manage(&claims)?;
    let (tenant_id, _) = tenant_branch(&headers)?;
    let challenge = webauthn_service::begin_authentication_for_purpose(
        &state.db,
        &state.settings,
        &tenant_id,
        &claims.sub,
        ATTENDANCE_WEBAUTHN_PURPOSE,
    )
    .await?;
    Ok(Json(ApiResponse::ok(challenge)))
}

async fn clock_in(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClockInRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    ensure_attendance_manage(&claims)?;
    ensure_self_business_date(&claims, payload.business_date)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let source = payload.source.as_deref().unwrap_or("manual").trim();
    if matches!(source, "staff-app-face" | "staff-app-biometric") {
        enforce_face_attendance_policy(
            &state,
            &headers,
            &tenant_id,
            &branch_id,
            &staff_id,
            &claims.sub,
            payload.face_scan.as_ref(),
        )
        .await?;
    }
    let row = staff_attendance_service::clock_in(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
        if is_attendance_manager(&claims) {
            payload.clock_in_at
        } else {
            None
        },
        source,
        payload.comments.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn clock_out(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<ClockOutRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    ensure_attendance_manage(&claims)?;
    ensure_self_business_date(&claims, payload.business_date)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let self_service = !is_attendance_manager(&claims);
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::clock_out(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
        if is_attendance_manager(&claims) {
            payload.clock_out_at
        } else {
            None
        },
        if self_service {
            0
        } else {
            payload.penalty_paise.unwrap_or(0)
        },
        payload.comments.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn start_break(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BreakRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceBreakRecord> {
    ensure_attendance_manage(&claims)?;
    ensure_self_business_date(&claims, payload.business_date)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::start_break(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
        &claims.sub,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn end_break(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BreakRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    ensure_attendance_manage(&claims)?;
    ensure_self_business_date(&claims, payload.business_date)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = self_scoped_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.trim(),
    )
    .await?;
    let row = staff_attendance_service::end_break(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.business_date,
    )
    .await?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn self_scoped_staff_id(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    requested_staff_id: &str,
) -> Result<String, AppError> {
    if !is_attendance_manager(claims) {
        staff_enterprise_service::self_staff_id(&state.db, tenant_id, branch_id, &claims.sub).await
    } else {
        Ok(requested_staff_id.to_string())
    }
}

fn is_attendance_manager(claims: &AuthClaims) -> bool {
    ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
}

const STAFF_APP_ROLES: &[&str] = &["owner", "admin", "manager", "staff"];
const ATTENDANCE_READ_LEGACY: &[&str] = &[
    "staff.app.attendance.manage",
    "staff.attendance.read",
    "staff.self_manage",
    "allow:staff-checkin-checkout",
    "read:staff",
];
const ATTENDANCE_MANAGE_LEGACY: &[&str] = &[
    "staff.self_manage",
    "staff_self.write",
    "allow:staff-checkin-checkout",
    "write:staff",
];

fn ensure_attendance_read(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_staff_app_permission(claims, "staff.app.attendance.read", ATTENDANCE_READ_LEGACY)
}

fn ensure_attendance_manage(claims: &AuthClaims) -> Result<(), AppError> {
    ensure_staff_app_permission(
        claims,
        "staff.app.attendance.manage",
        ATTENDANCE_MANAGE_LEGACY,
    )
}

fn ensure_staff_app_permission(
    claims: &AuthClaims,
    permission: &str,
    legacy: &[&str],
) -> Result<(), AppError> {
    if auth_service::staff_app_permission_allowed(claims, permission, STAFF_APP_ROLES, legacy) {
        Ok(())
    } else {
        Err(AppError::forbidden("Staff App permission is required"))
    }
}

fn ensure_self_business_date(claims: &AuthClaims, requested: NaiveDate) -> Result<(), AppError> {
    let today = Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("valid IST offset"))
        .date_naive();
    if is_attendance_manager(claims) || requested == today {
        Ok(())
    } else {
        Err(AppError::validation(
            "self-service attendance must use the current business date",
        ))
    }
}

async fn correct_attendance(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path((staff_id, business_date)): Path<(String, NaiveDate)>,
    Json(payload): Json<AttendanceCorrectionRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::AttendanceRecord> {
    ensure_attendance_manage(&claims)?;
    if !is_attendance_manager(&claims) {
        return Err(AppError::forbidden("Attendance manager access is required"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_attendance_service::correct_attendance(
        &state.db,
        &tenant_id,
        &branch_id,
        staff_id.trim(),
        business_date,
        AttendanceCorrectionInput {
            clock_in_at: payload.clock_in_at,
            clock_out_at: payload.clock_out_at,
            manual_status: payload
                .manual_status
                .map(|value| value.trim().to_lowercase())
                .filter(|value| !value.is_empty()),
            penalty_paise: payload.penalty_paise.unwrap_or(0),
            comments: payload.comments.unwrap_or_default().trim().to_string(),
            correction_reason: payload.correction_reason.trim().to_string(),
            corrected_by: claims.sub.clone(),
            breaks: payload
                .breaks
                .into_iter()
                .map(|item| AttendanceBreakInput {
                    started_at: item.started_at,
                    ended_at: item.ended_at,
                    comments: item.comments.unwrap_or_default().trim().to_string(),
                })
                .collect(),
        },
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.attendance.corrected",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: serde_json::json!({ "staffId": staff_id, "businessDate": business_date }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OvertimeQuery {
    staff_id: Option<String>,
    status: Option<String>,
    from: NaiveDate,
    to: NaiveDate,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct OvertimeDecisionRequest {
    decision: String,
    approved_overtime_minutes: Option<i32>,
}

fn ensure_overtime_access(claims: &AuthClaims, permissions: &[&str]) -> Result<(), AppError> {
    const ALLOWED_ROLES: &[&str] = &["owner", "admin", "accountant", "manager"];
    let denied = claims
        .denied_permissions
        .iter()
        .any(|denied| permissions.iter().any(|required| denied == required));
    let role_allowed = ALLOWED_ROLES
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role));
    let permission_allowed = claims
        .permissions
        .iter()
        .any(|allowed| permissions.iter().any(|required| allowed == required));
    if !denied && (role_allowed || permission_allowed) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "overtime approval access is restricted",
        ))
    }
}

async fn list_overtime(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<OvertimeQuery>,
) -> ApiResult<Vec<crate::repositories::staff_attendance_repository::OvertimeApprovalRecord>> {
    ensure_overtime_access(
        &claims,
        &[
            "staff.attendance.read",
            "staff.attendance.manage",
            "staff.payroll.read",
            "staff.payroll.manage",
        ],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = staff_attendance_service::list_overtime(
        &state.db,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or("").trim(),
        query.status.as_deref().unwrap_or("").trim(),
        query.from,
        query.to,
    )
    .await?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn decide_overtime(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(attendance_id): Path<String>,
    Json(payload): Json<OvertimeDecisionRequest>,
) -> ApiResult<crate::repositories::staff_attendance_repository::OvertimeApprovalRecord> {
    ensure_overtime_access(
        &claims,
        &["staff.attendance.manage", "staff.payroll.manage"],
    )?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let row = staff_attendance_service::decide_overtime(
        &state.db,
        &tenant_id,
        &branch_id,
        &claims.sub,
        &attendance_id,
        &payload.decision,
        payload.approved_overtime_minutes,
    )
    .await?;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id: &tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(&branch_id),
            identity: None,
            event_type: "staff.attendance.overtime_decided",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: serde_json::json!({ "attendanceId": attendance_id, "decision": row.ot_approval_status }),
        },
    )
    .await;
    Ok(Json(ApiResponse::ok(row)))
}

fn validate_cycle(cycle: Option<&str>) -> Result<(), AppError> {
    if cycle.is_some_and(|value| !value.eq_ignore_ascii_case("monthly")) {
        return Err(AppError::validation(
            "only monthly attendance cycle is supported",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ensure_overtime_access, validate_cycle};
    use crate::services::auth_service::AuthClaims;

    #[test]
    fn attendance_cycle_is_monthly() {
        assert!(validate_cycle(None).is_ok());
        assert!(validate_cycle(Some("Monthly")).is_ok());
        assert!(validate_cycle(Some("weekly")).is_err());
    }

    #[test]
    fn overtime_guard_honours_custom_permissions_and_denies() {
        let mut claims = claims("staff");
        assert!(ensure_overtime_access(&claims, &["staff.payroll.manage"]).is_err());
        claims.permissions.push("staff.payroll.manage".into());
        assert!(ensure_overtime_access(&claims, &["staff.payroll.manage"]).is_ok());
        claims
            .denied_permissions
            .push("staff.payroll.manage".into());
        assert!(ensure_overtime_access(&claims, &["staff.payroll.manage"]).is_err());
    }

    fn claims(role: &str) -> AuthClaims {
        AuthClaims {
            sub: "user-1".into(),
            tenant_id: "tenant-1".into(),
            branch_id: Some("branch-1".into()),
            role: role.into(),
            role_id: None,
            permissions: Vec::new(),
            denied_permissions: Vec::new(),
            masked_fields: Vec::new(),
            max_discount_paise: None,
            max_refund_paise: None,
            max_cash_movement_paise: None,
            permission_version: 1,
            session_id: "session-1".into(),
            mfa_enrollment_required: false,
            token_type: "access".into(),
            jti: "token-1".into(),
            iat: 1,
            exp: usize::MAX,
        }
    }
}
