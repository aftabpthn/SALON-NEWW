use std::time::Duration;

use chrono::{NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    models::common::AppError,
    repositories::{staff_ai_repository, staff_enterprise_repository},
    services::staff_advanced_service,
    state::AppState,
};

#[derive(Deserialize)]
struct AiEnvelope {
    data: Value,
}

pub async fn analyze(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Value, AppError> {
    let days = period_end.signed_duration_since(period_start).num_days();
    if !(0..=31).contains(&days) {
        return Err(AppError::validation(
            "staff AI period must contain 1 to 32 days",
        ));
    }
    let url = state.settings.ai_service_url.as_deref().ok_or_else(|| {
        AppError::service_unavailable("AI_SERVICE_NOT_CONFIGURED", "AI service is not configured")
    })?;
    let token = state.settings.ai_service_token.as_deref().ok_or_else(|| {
        AppError::service_unavailable(
            "AI_SERVICE_TOKEN_NOT_CONFIGURED",
            "AI service token is not configured",
        )
    })?;

    let (attendance, biometrics, commissions, roster, coverage, performance) = tokio::join!(
        staff_ai_repository::attendance_facts(
            &state.db,
            tenant_id,
            branch_id,
            period_start,
            period_end
        ),
        staff_ai_repository::biometric_facts(
            &state.db,
            tenant_id,
            branch_id,
            period_start,
            period_end
        ),
        staff_ai_repository::commission_facts(
            &state.db,
            tenant_id,
            branch_id,
            period_start,
            period_end
        ),
        staff_enterprise_repository::roster_sources(
            &state.db,
            tenant_id,
            branch_id,
            period_start,
            period_end
        ),
        staff_enterprise_repository::roster_coverage(
            &state.db,
            tenant_id,
            branch_id,
            period_start,
            period_end
        ),
        staff_advanced_service::performance(
            &state.db,
            tenant_id,
            branch_id,
            period_start,
            period_end,
            ""
        )
    );
    let attendance =
        attendance.map_err(|_| AppError::internal("failed to load attendance AI facts"))?;
    let biometrics =
        biometrics.map_err(|_| AppError::internal("failed to load biometric AI facts"))?;
    let commissions =
        commissions.map_err(|_| AppError::internal("failed to load commission AI facts"))?;
    let roster = roster.map_err(|_| AppError::internal("failed to load roster AI facts"))?;
    let coverage = coverage.map_err(|_| AppError::internal("failed to load roster coverage"))?;
    let performance = performance?;

    let scope = json!({
        "tenant_id":tenant_id,
        "branch_id":branch_id,
        "period_start":period_start,
        "period_end":period_end,
    });
    let with_scope = |field: &str, value: Value| {
        let mut payload = scope.clone();
        payload[field] = value;
        payload
    };
    let attendance_payload = with_scope("records", Value::Array(attendance));
    let biometric_payload = with_scope("events", Value::Array(biometrics));
    let commission_payload = with_scope("staff", Value::Array(commissions));
    let attrition_payload = with_scope(
        "staff",
        Value::Array(
            performance
                .rows
                .iter()
                .map(|row| {
                    json!({
                        "staff_id":row.staff_id,
                        "staff_name":row.staff_name,
                        "appointments_count":row.appointments_count,
                        "completed_appointments":row.completed_appointments,
                        "present_days":row.present_days,
                        "absent_days":row.absent_days,
                        "overtime_minutes":row.overtime_minutes,
                        "late_minutes":row.late_minutes,
                        "operation_task_completed":row.operation_task_completed,
                        "operation_task_missed":row.operation_task_missed,
                    })
                })
                .collect(),
        ),
    );
    let mut roster_payload = with_scope(
        "rows",
        Value::Array(
            roster
                .iter()
                .map(|row| {
                    json!({
                        "staff_id":row.staff_id,
                        "staff_name":row.staff_name,
                        "schedule_date":row.schedule_date,
                        "existing_status":row.existing_status.as_deref().unwrap_or(""),
                        "approved_leave":row.approved_leave,
                        "appointments_count":row.appointments_count,
                        "appointment_minutes":row.appointment_minutes,
                    })
                })
                .collect(),
        ),
    );
    roster_payload["coverage"] = json!({
        "active_staff":coverage.active_staff,
        "scheduled_staff_days":coverage.scheduled_staff_days,
        "scheduled_minutes":coverage.scheduled_minutes,
        "appointment_minutes":coverage.appointment_minutes,
        "uncovered_appointments":coverage.uncovered_appointments,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| {
            AppError::service_unavailable(
                "STAFF_AI_CLIENT_INIT_FAILED",
                "Staff AI client could not be initialized",
            )
        })?;
    let (attendance, buddy, attrition, commission, roster) = tokio::try_join!(
        call(
            &client,
            url,
            token,
            "attendance-anomalies",
            "attendance_anomaly",
            &attendance_payload
        ),
        call(
            &client,
            url,
            token,
            "buddy-punching-signals",
            "buddy_punching_review_signal",
            &biometric_payload
        ),
        call(
            &client,
            url,
            token,
            "attrition-risk",
            "retention_review",
            &attrition_payload
        ),
        call(
            &client,
            url,
            token,
            "commission-anomalies",
            "commission_anomaly",
            &commission_payload
        ),
        call(
            &client,
            url,
            token,
            "roster-recommendations",
            "roster_recommendation",
            &roster_payload
        ),
    )?;

    Ok(json!({
        "source":"python_staff_ai",
        "modelVersion":"staff-signals-v1",
        "generatedAt":Utc::now(),
        "periodStart":period_start,
        "periodEnd":period_end,
        "humanReviewOnly":true,
        "attendanceAnomalies":attendance,
        "buddyPunchingSignals":buddy,
        "attritionRisk":attrition,
        "commissionAnomalies":commission,
        "rosterRecommendations":roster,
    }))
}

async fn call(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    endpoint: &str,
    expected_kind: &str,
    payload: &Value,
) -> Result<Value, AppError> {
    let response = client
        .post(format!("{url}/api/v1/staff-ai/{endpoint}"))
        .bearer_auth(token)
        .json(payload)
        .send()
        .await
        .map_err(|_| {
            AppError::service_unavailable("STAFF_AI_UNAVAILABLE", "Staff AI service is unavailable")
        })?;
    if !response.status().is_success() {
        return Err(AppError::service_unavailable(
            "STAFF_AI_REJECTED",
            "Staff AI service rejected the evidence",
        ));
    }
    let data = response
        .json::<AiEnvelope>()
        .await
        .map_err(|_| AppError::internal("Staff AI returned an invalid response"))?
        .data;
    if data.get("kind").and_then(Value::as_str) != Some(expected_kind)
        || data.get("humanReviewOnly").and_then(Value::as_bool) != Some(true)
    {
        return Err(AppError::internal("Staff AI response contract is invalid"));
    }
    Ok(data)
}
