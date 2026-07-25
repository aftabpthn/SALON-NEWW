use axum::{
    extract::{Path, Query, State},
    http::{header::CONTENT_TYPE, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{HashMap, HashSet};

use super::appointments::{self, ApiError, AppointmentPayload, ListAppointmentQuery};
use crate::state::AppState;

const DEFAULT_ACTIVITY_LIMIT: i64 = 1000;

#[derive(Deserialize)]
pub(crate) struct ActivityQuery {
    pub tenant_id: Option<String>,
    pub branch_id: Option<String>,
    pub client_id: Option<String>,
    #[serde(rename = "appointmentId")]
    pub _appointment_id: Option<String>,
    pub action: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub format: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Serialize, Clone)]
struct ActivityRow {
    id: String,
    tenant_id: String,
    appointment_id: String,
    action: String,
    old_status: String,
    new_status: String,
    reason: String,
    created_at: String,
}

fn scope_for_query(
    headers: &HeaderMap,
    tenant_id: Option<&str>,
    branch_id: Option<&str>,
) -> (String, String) {
    appointments::scope_from_headers(headers, tenant_id, branch_id)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/appointment-activity/register",
            axum::routing::get(appointment_activity_register),
        )
        .route(
            "/appointment-reports",
            axum::routing::get(appointment_reports),
        )
        .route(
            "/appointment-activity/reports",
            axum::routing::get(activity_reports),
        )
        .route(
            "/appointment-activity/clients/:client_id",
            axum::routing::get(appointment_activity_client_history),
        )
        .route(
            "/appointment-activity/appointments/:id/timeline",
            axum::routing::get(appointment_activity_timeline),
        )
        .route(
            "/appointment-activity/:id",
            axum::routing::get(appointment_activity_by_id),
        )
        .route(
            "/appointment-activity",
            axum::routing::get(appointment_activity_list),
        )
        .route(
            "/appointment-history/client/:client_id",
            axum::routing::get(appointment_history_client),
        )
        .route(
            "/appointment-history/appointment/:appointment_id/timeline",
            axum::routing::get(appointment_history_appointment_timeline),
        )
}

pub(crate) async fn appointment_activity_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ActivityQuery>,
) -> Result<Response, ApiError> {
    let payload = query_to_list_query(&query);
    let (tenant_id, _) = scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let appointments = appointments::list_appointments(
        State(state.clone()),
        headers.clone(),
        axum::extract::Query(payload),
    )
    .await?
    .0;
    let appointment_ids: Vec<String> = appointments.iter().map(|item| item.id.clone()).collect();
    let mut appointment_map: HashMap<String, AppointmentPayload> = appointments
        .into_iter()
        .map(|appointment| (appointment.id.clone(), appointment))
        .collect();
    let client_ids: Vec<String> = appointment_map
        .values()
        .filter_map(|appointment| {
            (!appointment.client_id.trim().is_empty()).then(|| appointment.client_id.clone())
        })
        .collect();
    let staff_ids: Vec<String> = appointment_map
        .values()
        .filter_map(|appointment| {
            (!appointment.staff_id.trim().is_empty()).then(|| appointment.staff_id.clone())
        })
        .collect();
    let service_ids: Vec<String> = appointment_map
        .values()
        .flat_map(|appointment| appointment.service_ids.clone())
        .collect();
    let clients_by_id: HashMap<String, (String, String)> = sqlx::query_as(
        "SELECT id, TRIM(CONCAT_WS(' ', first_name, last_name)), phone
         FROM clients WHERE tenant_id=$1 AND id = ANY($2)",
    )
    .bind(&tenant_id)
    .bind(&client_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment clients"))?
    .into_iter()
    .map(|(id, name, phone)| (id, (name, phone)))
    .collect();
    let staff_by_id: HashMap<String, String> = sqlx::query_as(
        "SELECT id, COALESCE(NULLIF(appointment_display_name, ''), NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), employee_code, id)
         FROM staff WHERE tenant_id=$1 AND id = ANY($2)",
    )
    .bind(&tenant_id)
    .bind(&staff_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment staff"))?
    .into_iter()
    .collect();
    let services_by_id: HashMap<String, String> =
        sqlx::query_as("SELECT id, name FROM services WHERE tenant_id=$1 AND id = ANY($2)")
            .bind(&tenant_id)
            .bind(&service_ids)
            .fetch_all(&state.db)
            .await
            .map_err(|_| ApiError::internal("failed to load appointment services"))?
            .into_iter()
            .collect();
    let actions = fetch_activity_rows(&state, &headers, &query).await?;
    let mut actions_by_appointment: HashMap<String, Vec<ActivityRow>> = HashMap::new();
    for row in &actions {
        if let Some(_appointment) = appointment_map.get_mut(&row.appointment_id) {
            let list = actions_by_appointment
                .entry(row.appointment_id.clone())
                .or_default();
            list.push(row.clone());
        }
    }
    for (_id, timeline) in &mut actions_by_appointment {
        timeline.sort_by_key(|row| row.created_at.clone());
    }

    let mut invoice_reference_ids = appointment_ids.clone();
    invoice_reference_ids.extend(appointment_map.values().filter_map(|appointment| {
        appointment
            .booking_group_id
            .as_ref()
            .filter(|group_id| !group_id.trim().is_empty())
            .cloned()
    }));
    invoice_reference_ids.sort();
    invoice_reference_ids.dedup();
    let sales_by_reference: HashMap<String, (String, String, i64, i64, String)> = sqlx::query(
        "SELECT DISTINCT ON (reference_id) reference_id, id, invoice_number, total_paise, paid_paise, status
         FROM pos_sales
         WHERE tenant_id=$1 AND branch_id=$2 AND source='appointment' AND reference_id = ANY($3)
         ORDER BY reference_id, created_at DESC",
    )
    .bind(&tenant_id)
    .bind(scope_for_query(&headers, query.tenant_id.as_deref(), query.branch_id.as_deref()).1)
    .bind(&invoice_reference_ids)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to load appointment invoices"))?
    .into_iter()
    .map(|row| {
        (
            row.try_get("reference_id").unwrap_or_default(),
            (
                row.try_get("id").unwrap_or_default(),
                row.try_get("invoice_number").unwrap_or_default(),
                row.try_get("total_paise").unwrap_or(0),
                row.try_get("paid_paise").unwrap_or(0),
                row.try_get("status").unwrap_or_default(),
            ),
        )
    })
    .collect();
    let mut rows = Vec::new();
    for appointment in appointment_map.values() {
        let timeline = actions_by_appointment
            .get(&appointment.id)
            .cloned()
            .unwrap_or_default();
        let cancel = timeline
            .iter()
            .find(|item| matches!(item.action.as_str(), "CANCELLED" | "NO_SHOW"))
            .map(|item| item.reason.clone())
            .unwrap_or_default();
        let risk = risk_grade(&appointment.status, timeline.len());
        let latest = timeline.last();
        let (client_name, client_phone) = clients_by_id
            .get(&appointment.client_id)
            .cloned()
            .unwrap_or_default();
        let staff_name = staff_by_id
            .get(&appointment.staff_id)
            .cloned()
            .unwrap_or_default();
        let service_names = appointment
            .service_ids
            .iter()
            .filter_map(|service_id| services_by_id.get(service_id))
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        let invoice = sales_by_reference.get(&appointment.id).or_else(|| {
            appointment
                .booking_group_id
                .as_ref()
                .and_then(|group_id| sales_by_reference.get(group_id))
        });
        let (invoice_id, invoice_number, total, paid, invoice_status) = invoice
            .cloned()
            .unwrap_or_else(|| (String::new(), String::new(), 0, 0, String::new()));
        let payment_status = if invoice_number.is_empty() {
            "not_billed"
        } else if total > 0 && paid >= total {
            "paid"
        } else if paid > 0 {
            "partial"
        } else {
            "unpaid"
        };
        let mut problem_flags = Vec::new();
        let normalized_status = appointment.status.to_ascii_lowercase();
        if matches!(
            normalized_status.as_str(),
            "cancelled" | "canceled" | "no-show"
        ) && cancel.trim().is_empty()
        {
            problem_flags.push("Cancelled without reason".to_string());
        }
        if matches!(normalized_status.as_str(), "completed" | "billed" | "paid")
            && invoice_number.is_empty()
        {
            problem_flags.push("Completed without invoice".to_string());
        }
        if !invoice_number.is_empty() && total > paid {
            problem_flags.push("Payment pending".to_string());
        }
        let row = json!({
            "appointmentId": appointment.id.clone(),
            "bookingGroupId": appointment.booking_group_id.clone().unwrap_or_default(),
            "clientId": appointment.client_id.clone(),
            "staffId": appointment.staff_id.clone(),
            "branchId": appointment.branch_id.clone(),
            "bookedAt": appointment.created_at.clone(),
            "appointmentStartAt": appointment.start_at.clone(),
            "appointmentEndAt": appointment.end_at.clone(),
            "clientName": client_name,
            "clientPhone": client_phone,
            "staffName": staff_name,
            "branchName": appointment.branch_id.clone(),
            "serviceNames": service_names,
            "status": appointment.status.clone(),
            "cancelReason": cancel,
            "notes": appointment.notes.clone(),
            "paymentStatus": payment_status,
            "invoiceNumber": invoice_number,
            "total": total,
            "paid": paid,
            "balance": (total - paid).max(0),
            "bookingMode": appointment.source_channel.clone(),
            "createdBy": latest.and_then(|item| Some(item.action.clone())).unwrap_or_else(|| "system".to_string()),
            "lastUpdatedBy": latest.and_then(|item| Some(item.action.clone())).unwrap_or_else(|| "system".to_string()),
            "lastUpdatedAt": appointment.updated_at.clone(),
            "invoiceId": invoice_id,
            "invoiceStatus": invoice_status,
            "messageStatus": {"status":"not_sent","count":0,"latestAt":""},
            "timeline": timeline,
            "timelineCount": timeline.len(),
            "problemFlags": problem_flags,
            "riskScore": risk.0,
            "riskLevel": risk.1
        });
        rows.push(row);
    }
    rows.sort_by_key(|row| {
        row["appointmentStartAt"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    });

    let register = json!({
        "generatedAt": Utc::now().to_rfc3339(),
        "summary": {
            "totalAppointments": rows.len(),
            "completed": rows.iter().filter(|row| {
                let status = row["status"].as_str().unwrap_or_default().to_lowercase();
                matches!(status.as_str(), "completed" | "billed" | "paid")
            }).count(),
            "cancelled": rows.iter().filter(|row| {
                let status = row["status"].as_str().unwrap_or_default().to_lowercase();
                matches!(status.as_str(), "cancelled" | "canceled" | "no-show")
            }).count(),
            "pending": rows.iter().filter(|row| {
                let status = row["status"].as_str().unwrap_or_default().to_lowercase();
                !matches!(status.as_str(), "completed" | "billed" | "paid" | "cancelled" | "canceled" | "no-show")
            }).count(),
            "billedAmount": 0,
            "unpaidAmount": 0,
            "problemCount": rows.iter().filter(|row| row["problemFlags"].as_array().is_some_and(|v| !v.is_empty())).count()
        },
        "rows": rows
    });

    if query.format.as_deref() == Some("csv") {
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "text/csv; charset=utf-8")
            .body(to_register_csv(&register["rows"]).into())
            .map_err(|_| ApiError::internal("failed to build csv body"))?);
    }
    if query.format.as_deref() == Some("pdf") {
        let pdf = to_simple_pdf(register.clone(), "Appointment Register");
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "application/pdf")
            .body(pdf.into())
            .map_err(|_| ApiError::internal("failed to build pdf body"))?);
    }

    Ok((StatusCode::OK, Json(register)).into_response())
}

pub(crate) async fn appointment_reports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    appointment_reports_internal(State(state), headers, Query(query)).await
}

pub(crate) async fn activity_reports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ActivityQuery>,
) -> Result<Response, ApiError> {
    let report = activity_report_data(&state, &headers, &query).await?;
    if query.format.as_deref() == Some("csv") {
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "text/csv; charset=utf-8")
            .body(to_report_csv(&report["exportRows"]).into())
            .map_err(|_| ApiError::internal("failed to build csv body"))?);
    }
    if query.format.as_deref() == Some("pdf") {
        let pdf = to_simple_pdf(report.clone(), "Appointment Activity Report");
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "application/pdf")
            .body(pdf.into())
            .map_err(|_| ApiError::internal("failed to build pdf body"))?);
    }
    Ok((StatusCode::OK, Json(report)).into_response())
}

pub(crate) async fn appointment_activity_client_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let query_ap = ListAppointmentQuery {
        tenant_id: Some(tenant_id),
        branch_id: Some(branch_id),
        status: None,
        client_id: Some(client_id),
    };
    let appointments = appointments::list_appointments(
        State(state.clone()),
        headers.clone(),
        axum::extract::Query(query_ap),
    )
    .await?
    .0;
    let timeline = fetch_activity_rows(&state, &headers, &query).await?;
    let mut rows = Vec::new();
    let appointment_ids: HashSet<String> =
        appointments.iter().map(|item| item.id.clone()).collect();
    for item in timeline {
        if appointment_ids.contains(&item.appointment_id) {
            rows.push(item);
        }
    }
    let client = appointments
        .first()
        .map(|appt| json!({"clientId":appt.client_id,"timelineCount":rows.len()}))
        .unwrap_or(json!({"clientId":"", "timelineCount":0}));
    let stats = history_stats(&rows);
    Ok(Json(json!({
        "client": client,
        "stats": stats,
        "timeline": rows,
        "reliability": reliability_for(&stats),
        "suggestions": suggestions_for(&stats)
    })))
}

pub(crate) async fn appointment_activity_timeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, _branch_id) = scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let mut scoped_query = query;
    scoped_query.tenant_id = Some(tenant_id);
    let timeline = fetch_appointment_timeline(&state, &headers, &scoped_query, &id).await?;
    Ok(Json(json!({"timeline": timeline})))
}

async fn appointment_activity_by_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(
        &headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let row = fetch_activity_by_id(&state, &tenant_id, &branch_id, &id).await?;
    Ok(Json(row))
}

pub(crate) async fn appointment_activity_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let report = activity_report_data(&state, &headers, &query).await?;
    Ok(Json(json!({
        "generatedAt": Utc::now().to_rfc3339(),
        "rows": report["exportRows"]
    })))
}

pub(crate) async fn appointment_history_client(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(client_id): Path<String>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let data =
        appointment_activity_client_history(State(state), headers, Path(client_id), Query(query))
            .await?
            .0;
    Ok(Json(json!({ "success": true, "data": data })))
}

pub(crate) async fn appointment_history_appointment_timeline(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let data = appointment_activity_timeline(State(state), headers, Path(id), Query(query))
        .await?
        .0;
    Ok(Json(json!({ "success": true, "data": data })))
}

async fn appointment_reports_internal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<Value>, ApiError> {
    let timeline = fetch_activity_rows(&state, &headers, &query).await?;
    let report = activity_report_data(&state, &headers, &query).await?;
    Ok(Json(json!({
        "generatedAt": report["generatedAt"].as_str().unwrap_or(&Utc::now().to_rfc3339()),
        "summary": report["summary"].clone(),
        "rows": timeline
    })))
}

fn query_to_list_query(query: &ActivityQuery) -> ListAppointmentQuery {
    ListAppointmentQuery {
        tenant_id: query.tenant_id.clone(),
        branch_id: query.branch_id.clone(),
        status: query.status.clone(),
        client_id: query.client_id.clone(),
    }
}

async fn fetch_activity_rows(
    state: &AppState,
    headers: &HeaderMap,
    query: &ActivityQuery,
) -> Result<Vec<ActivityRow>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(
        headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let from = query
        .from
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));
    let to = query
        .to
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));
    let action = query.action.clone().unwrap_or_default();
    let limit = query
        .limit
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_ACTIVITY_LIMIT)
        .min(DEFAULT_ACTIVITY_LIMIT);
    let mut rows = sqlx::query(
        "SELECT aa.id, aa.tenant_id, aa.appointment_id, aa.action, aa.old_status, aa.new_status, aa.reason, aa.created_at
         FROM appointment_activity aa
          INNER JOIN appointments a ON a.id = aa.appointment_id AND a.tenant_id = aa.tenant_id
          WHERE aa.tenant_id=$1 AND a.branch_id=$2
            AND ($3::timestamptz IS NULL OR aa.created_at >= $3)
            AND ($4::timestamptz IS NULL OR aa.created_at <= $4)
            AND ($5 = '' OR aa.action = $5)
          ORDER BY created_at DESC LIMIT $6",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(from)
    .bind(to)
    .bind(&action)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to read appointment activity"))?;

    let mut out = Vec::new();
    for row in rows.drain(..) {
        let created: DateTime<Utc> = row.try_get("created_at").unwrap_or_else(|_| Utc::now());
        let appointment_id = row
            .try_get::<String, _>("appointment_id")
            .unwrap_or_default();
        out.push(ActivityRow {
            id: row.try_get("id").unwrap_or_default(),
            tenant_id: row.try_get("tenant_id").unwrap_or_default(),
            appointment_id,
            action: row.try_get("action").unwrap_or_default(),
            old_status: row.try_get("old_status").unwrap_or_default(),
            new_status: row.try_get("new_status").unwrap_or_default(),
            reason: row.try_get("reason").unwrap_or_default(),
            created_at: created.to_rfc3339(),
        });
    }
    Ok(out)
}

async fn fetch_activity_by_id(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    activity_id: &str,
) -> Result<Value, ApiError> {
    let row_opt = sqlx::query(
        "SELECT aa.id, aa.tenant_id, aa.appointment_id, aa.action, aa.old_status, aa.new_status, aa.reason, aa.created_at
         FROM appointment_activity aa
         INNER JOIN appointments a ON a.id = aa.appointment_id AND a.tenant_id = aa.tenant_id
         WHERE aa.tenant_id=$1 AND a.branch_id=$2 AND aa.id=$3 LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(activity_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| ApiError::internal("failed to read activity"))?;

    let row = row_opt.ok_or_else(|| ApiError::not_found("appointment activity not found"))?;
    let created: DateTime<Utc> = row.try_get("created_at").unwrap_or_else(|_| Utc::now());
    Ok(json!({
        "id": row.try_get::<String,_>("id").unwrap_or_default(),
        "tenantId": row.try_get::<String,_>("tenant_id").unwrap_or_default(),
        "appointmentId": row.try_get::<String,_>("appointment_id").unwrap_or_default(),
        "action": row.try_get::<String,_>("action").unwrap_or_default(),
        "statusBefore": row.try_get::<String,_>("old_status").unwrap_or_default(),
        "statusAfter": row.try_get::<String,_>("new_status").unwrap_or_default(),
        "reason": row.try_get::<String,_>("reason").unwrap_or_default(),
        "createdAt": created.to_rfc3339()
    }))
}

async fn fetch_appointment_timeline(
    state: &AppState,
    headers: &HeaderMap,
    query: &ActivityQuery,
    appointment_id: &str,
) -> Result<Vec<ActivityRow>, ApiError> {
    let (tenant_id, branch_id) = scope_for_query(
        headers,
        query.tenant_id.as_deref(),
        query.branch_id.as_deref(),
    );
    let rows = fetch_activity_rows(state, headers, query).await?;
    let mut out: Vec<ActivityRow> = rows
        .into_iter()
        .filter(|item| item.appointment_id == appointment_id)
        .collect();
    out.sort_by_key(|item| item.created_at.clone());
    if out.is_empty() {
        let appointment =
            appointments::find_appointment(state, &tenant_id, &branch_id, appointment_id).await?;
        return Ok(vec![ActivityRow {
            id: format!("{}:created", appointment.id),
            tenant_id: appointment.tenant_id,
            appointment_id: appointment.id,
            action: "booking.created".to_string(),
            old_status: "".to_string(),
            new_status: appointment.status,
            reason: "booking created".to_string(),
            created_at: appointment.created_at,
        }]);
    }
    Ok(out)
}

async fn activity_report_data(
    state: &AppState,
    headers: &HeaderMap,
    query: &ActivityQuery,
) -> Result<Value, ApiError> {
    let rows = fetch_activity_rows(state, headers, query).await?;
    let mut daily: HashMap<String, HashMap<&str, i64>> = HashMap::new();
    let mut reasons: HashMap<String, i64> = HashMap::new();
    for row in &rows {
        let day = row.created_at.chars().take(10).collect::<String>();
        let day_bucket = daily.entry(day).or_insert_with(|| {
            let mut map = HashMap::new();
            map.insert("total", 0);
            map.insert("cancellations", 0);
            map.insert("reschedules", 0);
            map.insert("noShows", 0);
            map.insert("highRisk", 0);
            map
        });
        if let Some(total) = day_bucket.get_mut("total") {
            *total += 1;
        }
        if row.action == "CANCELLED" {
            *day_bucket.entry("cancellations").or_default() += 1;
        }
        if row.action == "RESCHEDULED" {
            *day_bucket.entry("reschedules").or_default() += 1;
        }
        if row.action == "NO_SHOW" {
            *day_bucket.entry("noShows").or_default() += 1;
        }
        if row.reason.trim().is_empty() {
            continue;
        }
        *reasons.entry(row.reason.clone()).or_default() += 1;
    }
    let summary = json!({
        "totalActivities": rows.len(),
        "cancellations": rows.iter().filter(|row| row.action == "CANCELLED").count(),
        "reschedules": rows.iter().filter(|row| row.action == "RESCHEDULED").count(),
        "noShows": rows.iter().filter(|row| row.action == "NO_SHOW").count(),
        "completed": rows.iter().filter(|row| row.new_status == "COMPLETED" || row.new_status == "COMPLETED").count(),
        "highRiskActivities": 0,
        "criticalActivities": 0
    });
    let mut daily_summary = Vec::new();
    for (date, metrics) in daily {
        daily_summary.push(json!({
            "date": date,
            "total": metrics.get("total").copied().unwrap_or(0),
            "cancellations": metrics.get("cancellations").copied().unwrap_or(0),
            "reschedules": metrics.get("reschedules").copied().unwrap_or(0),
            "noShows": metrics.get("noShows").copied().unwrap_or(0),
        }));
    }
    let mut cancellation_reasons = Vec::new();
    for (reason, count) in reasons {
        cancellation_reasons.push(json!({ "reason": reason, "count": count }));
    }
    let export_rows = rows
        .iter()
        .map(|row| {
            let risk = risk_grade(row.new_status.as_str(), 1);
            json!({
                "createdAt": row.created_at,
                "appointmentId": row.appointment_id,
                "clientName": "unknown",
                "clientPhone": "",
                "staffName": "",
                "branchName": "",
                "action": row.action,
                "reason": row.reason,
                "statusBefore": row.old_status,
                "statusAfter": row.new_status,
                "riskLevel": risk.1,
                "riskScore": risk.0,
                "riskReason": risk.2,
                "suggestedAction": risk.3,
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "generatedAt": Utc::now().to_rfc3339(),
        "summary": summary,
        "dailySummary": daily_summary,
        "cancellationReasons": cancellation_reasons,
        "exportRows": export_rows
    }))
}

fn risk_grade(status: &str, actions_len: usize) -> (i64, &'static str, String, String) {
    let lower = status.to_lowercase();
    let is_bad = matches!(
        lower.as_str(),
        "cancelled" | "canceled" | "no-show" | "no_show"
    );
    if is_bad || actions_len > 3 {
        (
            75,
            "high",
            "Repeated or disruptive booking activity".to_string(),
            "Follow up with client on reliability before high-value bookings.".to_string(),
        )
    } else {
        (
            10,
            "low",
            "Routine booking flow".to_string(),
            "No special action required.".to_string(),
        )
    }
}

fn history_stats(rows: &[ActivityRow]) -> Value {
    let total = rows.len() as i64;
    let cancelled = rows
        .iter()
        .filter(|item| item.action == "CANCELLED")
        .count() as i64;
    let reschedules = rows
        .iter()
        .filter(|item| item.action == "RESCHEDULED")
        .count() as i64;
    let no_show = rows.iter().filter(|item| item.action == "NO_SHOW").count() as i64;
    let high_risk = rows
        .iter()
        .filter(|item| item.action == "NO_SHOW" || item.action == "CANCELLED")
        .count() as i64;
    json!({
        "totalActivities": total,
        "totalAppointments": total,
        "booked": total,
        "completed": 0,
        "cancellations": cancelled,
        "reschedules": reschedules,
        "noShows": no_show,
        "highRiskActivities": high_risk,
    })
}

fn reliability_for(stats: &Value) -> Value {
    let total = stats
        .get("totalAppointments")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cancellations = stats
        .get("cancellations")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let score = (100 - cancellations * 15 - total).max(0);
    let risk_level = if score < 40 {
        "critical"
    } else if score < 70 {
        "high"
    } else {
        "low"
    };
    json!({
        "score": score,
        "riskLevel": risk_level,
        "label": if score > 80 { "Reliable" } else if score > 60 { "Watch" } else { "Risky" }
    })
}

fn suggestions_for(stats: &Value) -> Vec<String> {
    let cancellations = stats
        .get("cancellations")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let no_shows = stats.get("noShows").and_then(Value::as_i64).unwrap_or(0);
    let mut suggestions = Vec::new();
    if no_shows > 0 {
        suggestions.push("Require confirmation before peak-hour slots.".to_string());
    }
    if cancellations >= 2 {
        suggestions
            .push("Request alternate deposit policy for repeated cancellations.".to_string());
    }
    if suggestions.is_empty() {
        suggestions.push("Maintain regular follow-up reminders.".to_string());
    }
    suggestions
}

fn to_csv_rows(rows: &[Value], headers: &[&str]) -> String {
    let header_line = headers.join(",");
    let body = rows
        .iter()
        .map(|row| {
            headers
                .iter()
                .map(|field| {
                    let value = row.get(field).and_then(Value::as_str).unwrap_or("");
                    let escaped = value.replace('"', "\"\"");
                    format!("\"{}\"", escaped)
                })
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("{}\n{}", header_line, body)
}

fn to_register_csv(rows: &Value) -> String {
    let rows = rows.as_array().cloned().unwrap_or_default();
    let header = [
        "bookedAt",
        "appointmentStartAt",
        "clientName",
        "clientPhone",
        "staffName",
        "serviceNames",
        "status",
        "cancelReason",
        "paymentStatus",
        "invoiceNumber",
        "total",
        "paid",
        "balance",
        "bookingMode",
        "createdBy",
        "lastUpdatedBy",
        "problemFlags",
    ];
    to_csv_rows(&rows, &header)
}

fn to_report_csv(rows: &Value) -> String {
    let rows = rows.as_array().cloned().unwrap_or_default();
    let header = [
        "createdAt",
        "appointmentId",
        "clientName",
        "clientPhone",
        "staffName",
        "branchName",
        "action",
        "reason",
        "statusBefore",
        "statusAfter",
        "riskLevel",
        "riskScore",
        "riskReason",
        "suggestedAction",
    ];
    to_csv_rows(&rows, &header)
}

fn to_simple_pdf(report: Value, title: &str) -> String {
    let body = format!(
        "{}\nGenerated: {}\n{}",
        title,
        report["generatedAt"]
            .as_str()
            .unwrap_or(&Utc::now().to_rfc3339()),
        report
            .get("summary")
            .and_then(Value::as_object)
            .map(|summary| summary
                .iter()
                .map(|(key, value)| format!("{}: {}", key, value))
                .collect::<Vec<_>>()
                .join("\n"))
            .unwrap_or_default()
    );
    body
}
