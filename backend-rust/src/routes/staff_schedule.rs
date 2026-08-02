use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, Utc};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    repositories::{
        auth_repository::{self, AuthAuditInput},
        staff_schedule_repository::{self, ScheduleBlockoutRecord, ScheduleEntryInput},
    },
    routes::context::tenant_branch,
    services::{auth_service::AuthClaims, staff_enterprise_service, staff_schedule_service},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/staff-schedule", get(get_schedule).put(save_schedule))
        .route("/staff-schedule/copy", post(copy_schedule))
        .route(
            "/staff-schedule/blockouts",
            get(list_blockouts).post(create_blockout),
        )
        .route(
            "/staff-schedule/blockouts/:id",
            axum::routing::patch(update_blockout).delete(delete_blockout),
        )
        .route(
            "/staff-schedule/calendar-feed",
            post(create_calendar_feed).delete(revoke_calendar_feed),
        )
}

pub fn public_router() -> Router<AppState> {
    Router::new().route("/staff-calendar-feed/:token", get(calendar_feed))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleQuery {
    date_from: NaiveDate,
    date_to: NaiveDate,
    role_id: Option<String>,
    job: Option<String>,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveScheduleRequest {
    date_from: NaiveDate,
    date_to: NaiveDate,
    staff_ids: Vec<String>,
    entries: Vec<ScheduleEntryRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleEntryRequest {
    version: Option<i32>,
    staff_id: String,
    schedule_date: NaiveDate,
    shift1_start: Option<String>,
    shift1_end: Option<String>,
    shift2_start: Option<String>,
    shift2_end: Option<String>,
    status: String,
    notes: Option<String>,
    room_id: Option<String>,
    role_id: Option<String>,
    job_title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyScheduleRequest {
    source_start: NaiveDate,
    target_start: NaiveDate,
    staff_ids: Vec<String>,
}

async fn get_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<ScheduleQuery>,
) -> ApiResult<staff_schedule_service::ScheduleData> {
    ensure_schedule_access(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let data = staff_schedule_service::load(
        &state.db,
        &tenant_id,
        &branch_id,
        query.date_from,
        query.date_to,
        query.role_id.as_deref().unwrap_or("").trim(),
        query.job.as_deref().unwrap_or("").trim(),
        query.staff_id.as_deref().unwrap_or("").trim(),
    )
    .await?;
    Ok(Json(ApiResponse::ok(data)))
}

async fn save_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<SaveScheduleRequest>,
) -> ApiResult<serde_json::Value> {
    ensure_schedule_access(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let entries = payload
        .entries
        .into_iter()
        .map(|entry| {
            Ok(ScheduleEntryInput {
                staff_id: entry.staff_id.trim().to_string(),
                schedule_date: entry.schedule_date,
                shift1_start: parse_optional_time(entry.shift1_start.as_deref(), "shift1Start")?,
                shift1_end: parse_optional_time(entry.shift1_end.as_deref(), "shift1End")?,
                shift2_start: parse_optional_time(entry.shift2_start.as_deref(), "shift2Start")?,
                shift2_end: parse_optional_time(entry.shift2_end.as_deref(), "shift2End")?,
                status: entry.status.trim().to_lowercase(),
                notes: entry.notes.unwrap_or_default().trim().to_string(),
                room_id: clean_optional(entry.room_id),
                role_id: clean_optional(entry.role_id),
                job_title: entry.job_title.unwrap_or_default().trim().to_string(),
                version: entry.version,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    staff_schedule_service::save(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.date_from,
        payload.date_to,
        payload
            .staff_ids
            .iter()
            .map(|id| id.trim().to_string())
            .collect(),
        entries,
    )
    .await?;
    notify_schedule_changes(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        &payload.staff_ids,
        payload.date_from,
        payload.date_to,
    )
    .await;
    Ok(Json(ApiResponse::ok(serde_json::json!({"saved": true}))))
}

async fn copy_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<CopyScheduleRequest>,
) -> ApiResult<serde_json::Value> {
    ensure_schedule_access(&claims, true)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    staff_schedule_service::copy_week(
        &state.db,
        &tenant_id,
        &branch_id,
        payload.source_start,
        payload.target_start,
        payload
            .staff_ids
            .iter()
            .map(|id| id.trim().to_string())
            .collect(),
    )
    .await?;
    notify_schedule_changes(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        &payload.staff_ids,
        payload.target_start,
        payload.target_start + chrono::Duration::days(6),
    )
    .await;
    Ok(Json(ApiResponse::ok(serde_json::json!({"copied": true}))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockoutQuery {
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    staff_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockoutRequest {
    staff_id: Option<String>,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    reason: Option<String>,
    version: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockoutDeleteQuery {
    version: i32,
    staff_id: Option<String>,
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn ensure_schedule_access(claims: &AuthClaims, write: bool) -> Result<(), AppError> {
    let permissions = if write {
        &["staff.schedule.manage", "staff.app.roster.manage"][..]
    } else {
        &[
            "staff.schedule.read",
            "staff.schedule.manage",
            "staff.app.roster.read",
        ][..]
    };
    let denied = claims
        .denied_permissions
        .iter()
        .any(|denied| permissions.iter().any(|permission| denied == permission));
    let role_allowed = ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role));
    let permission_allowed = claims
        .permissions
        .iter()
        .any(|allowed| permissions.iter().any(|permission| allowed == permission));
    if !denied && (role_allowed || permission_allowed) {
        Ok(())
    } else {
        Err(AppError::forbidden("schedule access is restricted"))
    }
}

async fn notify_schedule_changes(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    staff_ids: &[String],
    date_from: NaiveDate,
    date_to: NaiveDate,
) {
    let _ = sqlx::query(r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json)
      SELECT $1,$2,staff.user_id,$3,'staff_schedule_changed','Schedule changed',$4,'staff_schedule',staff.id,$5
      FROM staff WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=ANY($6) AND staff.user_id IS NOT NULL"#)
        .bind(tenant_id).bind(branch_id).bind(&claims.sub)
        .bind(format!("Your schedule from {} to {} was updated.", date_from.format("%d/%m/%Y"), date_to.format("%d/%m/%Y")))
        .bind(json!({"deepLink":"/staff/roster","dateFrom":date_from,"dateTo":date_to}))
        .bind(staff_ids).execute(&state.db).await;
    let _ = auth_repository::audit(
        &state.db,
        AuthAuditInput {
            tenant_id,
            user_id: Some(&claims.sub),
            session_id: (!claims.session_id.is_empty()).then_some(claims.session_id.as_str()),
            branch_id: Some(branch_id),
            identity: None,
            event_type: "staff.schedule.changed",
            outcome: "success",
            ip_address: None,
            user_agent: None,
            details: json!({"staffIds":staff_ids,"dateFrom":date_from,"dateTo":date_to}),
        },
    )
    .await;
}

async fn list_blockouts(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Query(query): Query<BlockoutQuery>,
) -> ApiResult<Vec<ScheduleBlockoutRecord>> {
    ensure_schedule_access(&claims, false)?;
    if query.to <= query.from || query.to - query.from > Duration::days(93) {
        return Err(AppError::validation("block-out range is invalid"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = scoped_schedule_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    let rows = staff_schedule_repository::list_blockouts(
        &state.db, &tenant_id, &branch_id, &staff_id, query.from, query.to,
    )
    .await
    .map_err(|_| AppError::internal("failed to load schedule block-outs"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn create_blockout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Json(payload): Json<BlockoutRequest>,
) -> ApiResult<ScheduleBlockoutRecord> {
    ensure_schedule_access(&claims, true)?;
    let reason = payload.reason.unwrap_or_default().trim().to_string();
    if payload.ends_at <= payload.starts_at || reason.chars().count() > 500 {
        return Err(AppError::validation("schedule block-out is invalid"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = scoped_schedule_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    let row = staff_schedule_repository::create_blockout(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        payload.starts_at,
        payload.ends_at,
        &reason,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to create schedule block-out"))?
    .ok_or_else(|| AppError::validation("employee is invalid"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn update_blockout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<BlockoutRequest>,
) -> ApiResult<ScheduleBlockoutRecord> {
    ensure_schedule_access(&claims, true)?;
    let reason = payload.reason.unwrap_or_default().trim().to_string();
    let version = payload.version.unwrap_or(0);
    if version < 1 || payload.ends_at <= payload.starts_at || reason.chars().count() > 500 {
        return Err(AppError::validation("schedule block-out is invalid"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = scoped_schedule_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        payload.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    let row = staff_schedule_repository::update_blockout(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        id.trim(),
        version,
        payload.starts_at,
        payload.ends_at,
        &reason,
    )
    .await
    .map_err(|_| AppError::internal("failed to update schedule block-out"))?
    .ok_or_else(|| AppError::conflict("block-out changed; reload and try again"))?;
    Ok(Json(ApiResponse::ok(row)))
}

async fn delete_blockout(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<BlockoutDeleteQuery>,
) -> ApiResult<serde_json::Value> {
    ensure_schedule_access(&claims, true)?;
    if query.version < 1 {
        return Err(AppError::validation("block-out version is invalid"));
    }
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id = scoped_schedule_staff_id(
        &state,
        &claims,
        &tenant_id,
        &branch_id,
        query.staff_id.as_deref().unwrap_or(""),
    )
    .await?;
    if !staff_schedule_repository::delete_blockout(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        id.trim(),
        query.version,
    )
    .await
    .map_err(|_| AppError::internal("failed to delete schedule block-out"))?
    {
        return Err(AppError::conflict(
            "block-out changed; reload and try again",
        ));
    }
    Ok(Json(ApiResponse::ok(json!({"deleted":true}))))
}

async fn create_calendar_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    ensure_schedule_access(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let hash = sha256_hex(&token);
    staff_schedule_repository::replace_calendar_feed_token(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        &hash,
        &claims.sub,
    )
    .await
    .map_err(|_| AppError::internal("failed to create calendar feed"))?;
    Ok(Json(ApiResponse::ok(
        json!({"path":format!("/api/v1/staff-calendar-feed/{token}"),"providers":["iCal","Google Calendar","Outlook"]}),
    )))
}

async fn revoke_calendar_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<AuthClaims>,
    headers: HeaderMap,
) -> ApiResult<serde_json::Value> {
    ensure_schedule_access(&claims, false)?;
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let staff_id =
        staff_enterprise_service::self_staff_id(&state.db, &tenant_id, &branch_id, &claims.sub)
            .await?;
    staff_schedule_repository::revoke_calendar_feed_token(&state.db, &tenant_id, &staff_id)
        .await
        .map_err(|_| AppError::internal("failed to revoke calendar feed"))?;
    Ok(Json(ApiResponse::ok(json!({"revoked":true}))))
}

async fn calendar_feed(State(state): State<AppState>, Path(token): Path<String>) -> Response {
    if token.len() != 64 || !token.chars().all(|value| value.is_ascii_hexdigit()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let hash = sha256_hex(&token);
    let Ok(Some((tenant_id, branch_id, staff_id))) =
        staff_schedule_repository::calendar_feed_scope(&state.db, &hash).await
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let today = Utc::now().date_naive();
    let Ok(events) = staff_schedule_repository::calendar_feed_events(
        &state.db,
        &tenant_id,
        &branch_id,
        &staff_id,
        today - Duration::days(31),
        today + Duration::days(366),
    )
    .await
    else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let mut body=String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AuraShine//Staff Schedule//EN\r\nCALSCALE:GREGORIAN\r\n");
    for event in events {
        body.push_str(&format!("BEGIN:VEVENT\r\nUID:{}@aurashine\r\nDTSTAMP:{}\r\nDTSTART:{}\r\nDTEND:{}\r\nSUMMARY:{}\r\nEND:VEVENT\r\n",ics_escape(&event.id),Utc::now().format("%Y%m%dT%H%M%SZ"),event.starts_at.format("%Y%m%dT%H%M%SZ"),event.ends_at.format("%Y%m%dT%H%M%SZ"),ics_escape(&event.summary)));
    }
    body.push_str("END:VCALENDAR\r\n");
    (
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

fn ics_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace(['\r', '\n'], "\\n")
}
fn sha256_hex(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn scoped_schedule_staff_id(
    state: &AppState,
    claims: &AuthClaims,
    tenant_id: &str,
    branch_id: &str,
    requested: &str,
) -> Result<String, AppError> {
    if ["owner", "admin", "manager"]
        .iter()
        .any(|role| role.eq_ignore_ascii_case(&claims.role))
        && !requested.trim().is_empty()
    {
        Ok(requested.trim().to_string())
    } else {
        staff_enterprise_service::self_staff_id(&state.db, tenant_id, branch_id, &claims.sub).await
    }
}

fn parse_optional_time(
    raw: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveTime>, AppError> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    NaiveTime::parse_from_str(raw, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(raw, "%H:%M:%S"))
        .map(Some)
        .map_err(|_| AppError::validation(format!("{field} must be HH:mm")))
}

#[cfg(test)]
mod tests {
    use super::parse_optional_time;

    #[test]
    fn optional_time_accepts_empty_and_hh_mm() {
        assert!(parse_optional_time(Some(""), "shift").unwrap().is_none());
        assert!(parse_optional_time(Some("09:30"), "shift")
            .unwrap()
            .is_some());
        assert!(parse_optional_time(Some("25:00"), "shift").is_err());
    }
}
