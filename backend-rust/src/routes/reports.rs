use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Extension, Json, Router,
};
use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    models::common::{ApiResponse, ApiResult, AppError},
    routes::context::tenant_branch,
    services::auth_service::AuthClaims,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports", axum::routing::get(report_catalog))
        .route("/reports/dashboard", axum::routing::get(report_dashboard))
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
pub struct ReportSalesQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceReportQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpWriteRequest {
    pub action: Option<String>,
    pub note: Option<String>,
    pub status: Option<String>,
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
    pub client_id: String,
    pub client_name: String,
    pub total_paise: i64,
    pub paid_paise: i64,
    pub balance_paise: i64,
    pub ageing_days: i32,
    pub follow_up_count: i64,
    pub last_follow_up_at: Option<chrono::DateTime<Utc>>,
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
    pub expected_cash_paise: i64,
    pub counted_cash_paise: Option<i64>,
    pub variance_paise: Option<i64>,
    pub status: String,
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
    let today = Utc::now().date_naive();
    let today_start = today
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| AppError::internal("invalid current time"))?;
    let today_end = today
        .and_hms_opt(23, 59, 59)
        .ok_or_else(|| AppError::internal("invalid current time"))?;
    let today_start = today_start.and_utc();
    let today_end = today_end.and_utc();

    let total_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let today_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND start_at BETWEEN $3 AND $4",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(today_start)
    .bind(today_end)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let open_appointments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('booked','confirmed','arrived','waiting','in-service')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_clients = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM clients WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let total_services = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM services WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let today_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(total_paise),0) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND created_at BETWEEN $3 AND $4",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(today_start)
    .bind(today_end)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let open_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('open','partial')",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let completed_recent = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND status='completed' AND updated_at >= NOW() - interval '7 days'",
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(ApiResponse::ok(ReportDashboard {
        total_appointments,
        today_appointments,
        open_appointments,
        total_clients,
        total_services,
        today_sales_paise: today_sales,
        open_sales,
        recent_completed_appointments: completed_recent,
    })))
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
        SELECT to_char(date_trunc('day', start_at), 'YYYY-MM-DD') AS report_date,
               status,
               COUNT(*)::bigint,
               COALESCE(SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 60.0)::bigint, 0)
        FROM appointments
        WHERE tenant_id=$1
          AND branch_id=$2
          AND start_at >= $3
          AND start_at < $4
          AND ($5 = '' OR status = $5)
        GROUP BY report_date, status
        ORDER BY report_date DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(&tenant_id)
    .bind(&branch_id)
    .bind(start_at)
    .bind(end_at)
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

    let rows = sqlx::query_as::<_, SaleRow>(
        r#"
        SELECT id, invoice_number, tenant_id, branch_id, total_paise, paid_paise, status, created_at
        FROM pos_sales
        WHERE tenant_id=$1 AND branch_id=$2
          AND created_at BETWEEN $3 AND $4
          AND ($5 = '' OR status = $5)
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

    let total_sales_paise = rows.iter().map(|row| row.total_paise).sum::<i64>();
    let paid_sales_paise = rows.iter().map(|row| row.paid_paise).sum::<i64>();

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
        .transpose()?
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let end_at = query
        .end_date
        .as_deref()
        .map(|raw| parse_day(raw, true))
        .transpose()?
        .unwrap_or_else(|| Utc::now() + chrono::Duration::days(1));
    let rows = sqlx::query_as::<_, DueRecoveryRow>(
        r#"
        SELECT ps.id AS invoice_id, ps.invoice_number, ps.client_id, TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS client_name,
               ps.total_paise, ps.paid_paise, GREATEST(ps.total_paise - ps.paid_paise, 0) AS balance_paise,
               GREATEST(CURRENT_DATE - COALESCE(ps.finalized_at, ps.created_at)::DATE, 0)::INT AS ageing_days,
               COUNT(drf.id)::BIGINT AS follow_up_count, MAX(drf.created_at) AS last_follow_up_at
          FROM pos_sales ps
          LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id
          LEFT JOIN due_recovery_followups drf ON drf.sale_id=ps.id AND drf.tenant_id=ps.tenant_id AND drf.branch_id=ps.branch_id
         WHERE ps.tenant_id=$1 AND ps.branch_id=$2
           AND COALESCE(ps.finalized_at, ps.created_at) >= $3 AND COALESCE(ps.finalized_at, ps.created_at) < $4
           AND ps.status NOT IN ('draft','voided','cancelled')
           AND ps.paid_paise < ps.total_paise
         GROUP BY ps.id, ps.invoice_number, ps.client_id, client_name, ps.total_paise, ps.paid_paise, ps.finalized_at, ps.created_at
         ORDER BY ageing_days DESC, balance_paise DESC
         LIMIT 500
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(start_at).bind(end_at)
    .fetch_all(&state.db)
    .await
    .map_err(|_| AppError::internal("failed to load due recovery report"))?;
    Ok(Json(ApiResponse::ok(rows)))
}

async fn list_invoice_followups(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Vec<FollowUpRow>> {
    let (tenant_id, branch_id) = tenant_branch(&headers)?;
    let rows = sqlx::query_as::<_, FollowUpRow>(
        "SELECT id, sale_id, actor_user_id, action, note, status, created_at FROM due_recovery_followups WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 ORDER BY created_at DESC",
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
    let note = payload.note.unwrap_or_default();
    let status = payload.status.unwrap_or_else(|| "open".to_string());
    let row = sqlx::query_as::<_, FollowUpRow>(
        r#"
        INSERT INTO due_recovery_followups (tenant_id, branch_id, sale_id, actor_user_id, action, note, status)
        SELECT $1,$2,id,$4,$5,$6,$7 FROM pos_sales
         WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND paid_paise < total_paise AND status NOT IN ('draft','voided','cancelled')
        RETURNING id, sale_id, actor_user_id, action, note, status, created_at
        "#,
    )
    .bind(&tenant_id).bind(&branch_id).bind(&id).bind(actor).bind(action.trim()).bind(note.trim()).bind(status.trim())
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
         WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.created_at >= $3 AND pp.created_at < $4
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
        .unwrap_or_else(|| Utc::now().date_naive());
    let session = sqlx::query_as::<_, (i64, Option<i64>, Option<i64>, String)>(
        "SELECT opening_cash_paise, counted_cash_paise, variance_paise, status FROM cash_drawer_sessions WHERE tenant_id=$1 AND branch_id=$2 AND business_date=$3 ORDER BY opened_at DESC LIMIT 1",
    )
    .bind(&tenant_id).bind(&branch_id).bind(business_date)
    .fetch_optional(&state.db).await
    .map_err(|_| AppError::internal("failed to load cash drawer session"))?;
    let cash_sales = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(pp.amount_paise),0)::BIGINT FROM pos_payments pp JOIN pos_sales ps ON ps.id=pp.sale_id AND ps.tenant_id=pp.tenant_id AND ps.branch_id=pp.branch_id WHERE pp.tenant_id=$1 AND pp.branch_id=$2 AND pp.method='cash' AND COALESCE(ps.finalized_at, ps.created_at)::DATE=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or(0);
    let movement = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT COALESCE(SUM(CASE WHEN movement_type='cash_in' THEN amount_paise ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN movement_type='cash_out' THEN ABS(amount_paise) ELSE 0 END),0)::BIGINT, COALESCE(SUM(CASE WHEN movement_type='refund_cash' THEN ABS(amount_paise) ELSE 0 END),0)::BIGINT FROM cash_drawer_movements WHERE tenant_id=$1 AND branch_id=$2 AND created_at::DATE=$3",
    ).bind(&tenant_id).bind(&branch_id).bind(business_date).fetch_one(&state.db).await.unwrap_or((0, 0, 0));
    let (opening, counted, variance, status) =
        session.unwrap_or((0, None, None, "not_opened".to_string()));
    let expected = opening + cash_sales + movement.0 - movement.1 - movement.2;
    Ok(Json(ApiResponse::ok(CashDrawerEodReport {
        business_date,
        opening_cash_paise: opening,
        cash_sales_paise: cash_sales,
        cash_refunds_paise: movement.2,
        cash_in_paise: movement.0,
        cash_out_paise: movement.1,
        expected_cash_paise: expected,
        counted_cash_paise: counted,
        variance_paise: variance.or_else(|| counted.map(|value| value - expected)),
        status,
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
