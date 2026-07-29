//! Read-only period-comparative queries for the AI copilot.
//!
//! Everything the copilot can already get from an existing repository is fetched
//! from that repository. This module only holds analytics the CRM did not have
//! before: current-vs-previous period comparisons for staff and services, plus
//! the client lookup the copilot needs to answer client-specific questions.

use serde::Serialize;
use sqlx::{FromRow, PgPool};

/// Wraps a single branch id as a one-branch authorized set.
///
/// Callers that legitimately read exactly one branch still go through the same
/// set-based query, so there is only one branch-filtering shape to audit.
pub fn one_branch(branch_id: &str) -> [String; 1] {
    [branch_id.to_string()]
}

/// A staff member's key metrics for the current period and the one before it.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StaffPerformanceTrendRow {
    pub staff_id: String,
    pub staff_name: String,
    pub job_title: String,
    pub current_completed: i64,
    pub previous_completed: i64,
    pub current_cancelled: i64,
    pub previous_cancelled: i64,
    pub current_no_show: i64,
    pub previous_no_show: i64,
    pub current_rebooked: i64,
    pub previous_rebooked: i64,
    /// Visits old enough to have had a full rebooking window; the rate's denominator.
    pub current_rebook_eligible: i64,
    pub previous_rebook_eligible: i64,
    pub current_booked_minutes: i64,
    pub previous_booked_minutes: i64,
    pub current_scheduled_minutes: i64,
    pub previous_scheduled_minutes: i64,
    pub current_revenue_paise: i64,
    pub previous_revenue_paise: i64,
}

/// A service's demand, revenue and margin inputs across both periods.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServicePerformanceTrendRow {
    pub service_id: String,
    pub service_name: String,
    pub service_group: String,
    pub list_price_paise: i64,
    pub service_active: bool,
    pub current_bookings: i64,
    pub previous_bookings: i64,
    pub current_revenue_paise: i64,
    pub previous_revenue_paise: i64,
    pub current_product_cost_paise: i64,
    pub previous_product_cost_paise: i64,
    pub current_clients: i64,
    pub previous_clients: i64,
    pub current_repeat_clients: i64,
}

/// Minimal client identity used to resolve "what about Priya?" to a client id.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CopilotClientMatch {
    pub client_id: String,
    pub client_name: String,
    pub phone: String,
}

/// Demand and capacity for one day of the week, used to explain *why* a number moved.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WeekdayDemandRow {
    /// ISO day of week: 1 = Monday through 7 = Sunday.
    pub weekday: i32,
    pub weekday_name: String,
    pub completed_appointments: i64,
    /// Cancellations and no-shows, which suppress demand without being idle time.
    pub lost_appointments: i64,
    pub booked_minutes: i64,
    pub scheduled_minutes: i64,
    pub service_bookings: i64,
    pub service_revenue_paise: i64,
}

impl WeekdayDemandRow {
    /// Booked share of rostered time, or `None` when nobody was rostered that day.
    pub fn utilization_percent(&self) -> Option<i64> {
        (self.scheduled_minutes > 0).then(|| self.booked_minutes * 100 / self.scheduled_minutes)
    }
}

const WEEKDAY_DEMAND_SQL: &str = r#"
WITH bounds AS (
  SELECT (CURRENT_DATE - MAKE_INTERVAL(days => $3))::DATE AS start_date,
         (CURRENT_DATE + 1)::DATE                          AS end_date
), weekdays AS (
  SELECT generate_series(1,7) AS weekday
), appointment_days AS (
  SELECT EXTRACT(ISODOW FROM appointment.start_at)::INT AS weekday,
         COUNT(*) FILTER (WHERE appointment.status IN ('completed','billed','paid'))::BIGINT AS completed_appointments,
         COUNT(*) FILTER (WHERE appointment.status IN ('cancelled','no-show'))::BIGINT AS lost_appointments,
         COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))/60)
           FILTER (WHERE appointment.status IN ('completed','billed','paid')),0)::BIGINT AS booked_minutes
    FROM appointments appointment CROSS JOIN bounds
   WHERE appointment.tenant_id=$1 AND appointment.branch_id=ANY($2::TEXT[])
     AND appointment.start_at >= bounds.start_date AND appointment.start_at < bounds.end_date
   GROUP BY 1
), schedule_days AS (
  SELECT EXTRACT(ISODOW FROM schedule.schedule_date)::INT AS weekday,
         COALESCE(SUM(
           COALESCE(EXTRACT(EPOCH FROM (schedule.shift1_end-schedule.shift1_start))/60,0)
         + COALESCE(EXTRACT(EPOCH FROM (schedule.shift2_end-schedule.shift2_start))/60,0)),0)::BIGINT AS scheduled_minutes
    FROM staff_schedules schedule CROSS JOIN bounds
   WHERE schedule.tenant_id=$1 AND schedule.branch_id=ANY($2::TEXT[]) AND schedule.status<>'off'
     AND schedule.schedule_date >= bounds.start_date AND schedule.schedule_date < bounds.end_date
   GROUP BY 1
), service_days AS (
  SELECT EXTRACT(ISODOW FROM COALESCE(sale.finalized_at,sale.created_at))::INT AS weekday,
         COALESCE(SUM(line.quantity),0)::BIGINT AS service_bookings,
         COALESCE(SUM(line.line_total_paise),0)::BIGINT AS service_revenue_paise
    FROM pos_sale_lines line
    JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
    CROSS JOIN bounds
   WHERE line.tenant_id=$1 AND line.branch_id=ANY($2::TEXT[]) AND line.line_type='service'
     AND sale.status NOT IN ('draft','cancelled','voided','refunded')
     AND COALESCE(sale.is_deleted,FALSE)=FALSE
     AND ($4='' OR line.item_id=$4)
     AND COALESCE(sale.finalized_at,sale.created_at)::DATE >= bounds.start_date
     AND COALESCE(sale.finalized_at,sale.created_at)::DATE <  bounds.end_date
   GROUP BY 1
)
SELECT weekdays.weekday::INT AS weekday,
       BTRIM(TO_CHAR(DATE '2024-01-01' + (weekdays.weekday - 1), 'Day')) AS weekday_name,
       COALESCE(appointment_days.completed_appointments,0)::BIGINT AS completed_appointments,
       COALESCE(appointment_days.lost_appointments,0)::BIGINT AS lost_appointments,
       COALESCE(appointment_days.booked_minutes,0)::BIGINT AS booked_minutes,
       COALESCE(schedule_days.scheduled_minutes,0)::BIGINT AS scheduled_minutes,
       COALESCE(service_days.service_bookings,0)::BIGINT AS service_bookings,
       COALESCE(service_days.service_revenue_paise,0)::BIGINT AS service_revenue_paise
  FROM weekdays
  LEFT JOIN appointment_days ON appointment_days.weekday=weekdays.weekday
  LEFT JOIN schedule_days ON schedule_days.weekday=weekdays.weekday
  LEFT JOIN service_days ON service_days.weekday=weekdays.weekday
 ORDER BY weekdays.weekday
"#;

/// Demand and capacity split by day of week, optionally narrowed to one service.
/// Pass an empty `service_id` for the whole branch.
pub async fn weekday_demand(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    days: i32,
    service_id: &str,
) -> Result<Vec<WeekdayDemandRow>, sqlx::Error> {
    sqlx::query_as(WEEKDAY_DEMAND_SQL)
        .bind(tenant_id)
        .bind(branch_ids)
        .bind(days)
        .bind(service_id)
        .fetch_all(db)
        .await
}

/// The staff record belonging to a signed-in user, so a floor staff member can
/// be shown their own performance and nobody else's.
pub async fn staff_id_for_user(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    user_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND user_id=$3 AND active=TRUE LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

/// The branch's display name, so an answer states which branch it describes.
///
/// `branches.id` and `branches.tenant_id` are UUID columns while the rest of the
/// schema carries them as text, and a branch may also be addressed by its
/// `scope_id`. Both are matched, the same way the concierge branch check does.
pub async fn branch_name(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT name FROM branches WHERE tenant_id::TEXT=$1 AND (id::TEXT=$2 OR scope_id=$2)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

const STAFF_PERFORMANCE_TREND_SQL: &str = r#"
WITH bounds AS (
  SELECT (CURRENT_DATE - MAKE_INTERVAL(days => $3))::DATE     AS current_start,
         (CURRENT_DATE + 1)::DATE                             AS current_end,
         (CURRENT_DATE - MAKE_INTERVAL(days => $3 * 2))::DATE AS previous_start,
         (CURRENT_DATE - MAKE_INTERVAL(days => $3))::DATE     AS previous_end
), appointment_metrics AS (
  SELECT appointment.staff_id,
    COUNT(*) FILTER (WHERE window_name='current' AND appointment.status IN ('completed','billed','paid'))::BIGINT AS current_completed,
    COUNT(*) FILTER (WHERE window_name='previous' AND appointment.status IN ('completed','billed','paid'))::BIGINT AS previous_completed,
    COUNT(*) FILTER (WHERE window_name='current' AND appointment.status='cancelled')::BIGINT AS current_cancelled,
    COUNT(*) FILTER (WHERE window_name='previous' AND appointment.status='cancelled')::BIGINT AS previous_cancelled,
    COUNT(*) FILTER (WHERE window_name='current' AND appointment.status='no-show')::BIGINT AS current_no_show,
    COUNT(*) FILTER (WHERE window_name='previous' AND appointment.status='no-show')::BIGINT AS previous_no_show,
    COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))/60)
      FILTER (WHERE window_name='current' AND appointment.status IN ('completed','billed','paid')),0)::BIGINT AS current_booked_minutes,
    COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))/60)
      FILTER (WHERE window_name='previous' AND appointment.status IN ('completed','billed','paid')),0)::BIGINT AS previous_booked_minutes,
    COUNT(*) FILTER (WHERE window_name='current' AND appointment.status IN ('completed','billed','paid') AND rebook_eligible AND rebooked)::BIGINT AS current_rebooked,
    COUNT(*) FILTER (WHERE window_name='previous' AND appointment.status IN ('completed','billed','paid') AND rebook_eligible AND rebooked)::BIGINT AS previous_rebooked,
    COUNT(*) FILTER (WHERE window_name='current' AND appointment.status IN ('completed','billed','paid') AND rebook_eligible)::BIGINT AS current_rebook_eligible,
    COUNT(*) FILTER (WHERE window_name='previous' AND appointment.status IN ('completed','billed','paid') AND rebook_eligible)::BIGINT AS previous_rebook_eligible
  FROM (
    SELECT appointment.*,
      CASE WHEN appointment.start_at >= bounds.current_start AND appointment.start_at < bounds.current_end THEN 'current' ELSE 'previous' END AS window_name,
      -- A visit counts as rebooked when the client booked their next visit within
      -- $5 days of it. Visits younger than that window have not had a full chance
      -- to rebook, so they are excluded from both sides via rebook_eligible rather
      -- than silently dragging the current period's rate down.
      EXISTS (
        SELECT 1 FROM appointments follow_up
         WHERE follow_up.tenant_id=appointment.tenant_id AND follow_up.branch_id=appointment.branch_id
           AND follow_up.client_id=appointment.client_id AND follow_up.start_at>appointment.start_at
           AND follow_up.created_at <= appointment.start_at + MAKE_INTERVAL(days => $5)
           AND follow_up.status NOT IN ('cancelled','no-show')
      ) AS rebooked,
      appointment.start_at <= NOW() - MAKE_INTERVAL(days => $5) AS rebook_eligible
    FROM appointments appointment CROSS JOIN bounds
    WHERE appointment.tenant_id=$1 AND appointment.branch_id=ANY($2::TEXT[])
      AND appointment.start_at >= bounds.previous_start AND appointment.start_at < bounds.current_end
  ) appointment
  GROUP BY appointment.staff_id
), revenue_metrics AS (
  SELECT line.staff_id,
    COALESCE(SUM(line.line_total_paise) FILTER (WHERE sold_at >= bounds.current_start AND sold_at < bounds.current_end),0)::BIGINT AS current_revenue_paise,
    COALESCE(SUM(line.line_total_paise) FILTER (WHERE sold_at >= bounds.previous_start AND sold_at < bounds.previous_end),0)::BIGINT AS previous_revenue_paise
  FROM (
    SELECT line.staff_id, line.line_total_paise, COALESCE(sale.finalized_at,sale.created_at)::DATE AS sold_at
      FROM pos_sale_lines line
      JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
     WHERE line.tenant_id=$1 AND line.branch_id=ANY($2::TEXT[]) AND line.line_type='service'
       AND sale.status NOT IN ('draft','cancelled','voided','refunded')
       AND COALESCE(sale.is_deleted,FALSE)=FALSE
  ) line CROSS JOIN bounds
  GROUP BY line.staff_id
), schedule_metrics AS (
  SELECT schedule.staff_id,
    COALESCE(SUM(scheduled_minutes) FILTER (WHERE schedule.schedule_date >= bounds.current_start AND schedule.schedule_date < bounds.current_end),0)::BIGINT AS current_scheduled_minutes,
    COALESCE(SUM(scheduled_minutes) FILTER (WHERE schedule.schedule_date >= bounds.previous_start AND schedule.schedule_date < bounds.previous_end),0)::BIGINT AS previous_scheduled_minutes
  FROM (
    SELECT staff_id, schedule_date,
      COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0)
      + COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0) AS scheduled_minutes
      FROM staff_schedules
     WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND status<>'off'
  ) schedule CROSS JOIN bounds
  GROUP BY schedule.staff_id
)
SELECT staff.id AS staff_id,
  COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),staff.employee_code,staff.id) AS staff_name,
  COALESCE(NULLIF(staff.job_title,''),'Staff') AS job_title,
  COALESCE(appointment_metrics.current_completed,0)::BIGINT AS current_completed,
  COALESCE(appointment_metrics.previous_completed,0)::BIGINT AS previous_completed,
  COALESCE(appointment_metrics.current_cancelled,0)::BIGINT AS current_cancelled,
  COALESCE(appointment_metrics.previous_cancelled,0)::BIGINT AS previous_cancelled,
  COALESCE(appointment_metrics.current_no_show,0)::BIGINT AS current_no_show,
  COALESCE(appointment_metrics.previous_no_show,0)::BIGINT AS previous_no_show,
  COALESCE(appointment_metrics.current_rebooked,0)::BIGINT AS current_rebooked,
  COALESCE(appointment_metrics.previous_rebooked,0)::BIGINT AS previous_rebooked,
  COALESCE(appointment_metrics.current_rebook_eligible,0)::BIGINT AS current_rebook_eligible,
  COALESCE(appointment_metrics.previous_rebook_eligible,0)::BIGINT AS previous_rebook_eligible,
  COALESCE(appointment_metrics.current_booked_minutes,0)::BIGINT AS current_booked_minutes,
  COALESCE(appointment_metrics.previous_booked_minutes,0)::BIGINT AS previous_booked_minutes,
  COALESCE(schedule_metrics.current_scheduled_minutes,0)::BIGINT AS current_scheduled_minutes,
  COALESCE(schedule_metrics.previous_scheduled_minutes,0)::BIGINT AS previous_scheduled_minutes,
  COALESCE(revenue_metrics.current_revenue_paise,0)::BIGINT AS current_revenue_paise,
  COALESCE(revenue_metrics.previous_revenue_paise,0)::BIGINT AS previous_revenue_paise
FROM staff
LEFT JOIN appointment_metrics ON appointment_metrics.staff_id=staff.id
LEFT JOIN revenue_metrics ON revenue_metrics.staff_id=staff.id
LEFT JOIN schedule_metrics ON schedule_metrics.staff_id=staff.id
WHERE staff.tenant_id=$1 AND staff.branch_id=ANY($2::TEXT[]) AND staff.active=TRUE
  AND (COALESCE(appointment_metrics.previous_completed,0) > 0 OR COALESCE(appointment_metrics.current_completed,0) > 0
       OR COALESCE(revenue_metrics.previous_revenue_paise,0) > 0 OR COALESCE(revenue_metrics.current_revenue_paise,0) > 0)
ORDER BY (COALESCE(revenue_metrics.previous_revenue_paise,0) - COALESCE(revenue_metrics.current_revenue_paise,0)) DESC, staff.id
LIMIT $4
"#;

const SERVICE_PERFORMANCE_TREND_SQL: &str = r#"
WITH bounds AS (
  SELECT (CURRENT_DATE - MAKE_INTERVAL(days => $3))::DATE     AS current_start,
         (CURRENT_DATE + 1)::DATE                             AS current_end,
         (CURRENT_DATE - MAKE_INTERVAL(days => $3 * 2))::DATE AS previous_start,
         (CURRENT_DATE - MAKE_INTERVAL(days => $3))::DATE     AS previous_end
), line_cost AS (
  SELECT sale_line_id, COALESCE(SUM(ABS(quantity_delta)::BIGINT * unit_cost_paise),0)::BIGINT AS cost_paise
    FROM inventory_stock_ledger
   WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND movement_type='sale' AND sale_line_id IS NOT NULL
   GROUP BY sale_line_id
), service_lines AS (
  SELECT line.item_id AS service_id, line.item_name AS service_name, sale.client_id,
         line.quantity, line.line_total_paise,
         COALESCE(line_cost.cost_paise,0)::BIGINT AS product_cost_paise,
         COALESCE(sale.finalized_at,sale.created_at)::DATE AS sold_at,
         CASE WHEN COALESCE(sale.finalized_at,sale.created_at)::DATE >= bounds.current_start THEN 'current' ELSE 'previous' END AS window_name
    FROM pos_sale_lines line
    JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
    LEFT JOIN line_cost ON line_cost.sale_line_id=line.id
    CROSS JOIN bounds
   WHERE line.tenant_id=$1 AND line.branch_id=ANY($2::TEXT[]) AND line.line_type='service'
     AND sale.status NOT IN ('draft','cancelled','voided','refunded')
     AND COALESCE(sale.is_deleted,FALSE)=FALSE
     AND COALESCE(sale.finalized_at,sale.created_at)::DATE >= bounds.previous_start
     AND COALESCE(sale.finalized_at,sale.created_at)::DATE <  bounds.current_end
), aggregated AS (
  SELECT service_id, service_name,
    COALESCE(SUM(quantity) FILTER (WHERE window_name='current'),0)::BIGINT  AS current_bookings,
    COALESCE(SUM(quantity) FILTER (WHERE window_name='previous'),0)::BIGINT AS previous_bookings,
    COALESCE(SUM(line_total_paise) FILTER (WHERE window_name='current'),0)::BIGINT  AS current_revenue_paise,
    COALESCE(SUM(line_total_paise) FILTER (WHERE window_name='previous'),0)::BIGINT AS previous_revenue_paise,
    COALESCE(SUM(product_cost_paise) FILTER (WHERE window_name='current'),0)::BIGINT  AS current_product_cost_paise,
    COALESCE(SUM(product_cost_paise) FILTER (WHERE window_name='previous'),0)::BIGINT AS previous_product_cost_paise,
    COUNT(DISTINCT client_id) FILTER (WHERE window_name='current' AND client_id<>'')::BIGINT  AS current_clients,
    COUNT(DISTINCT client_id) FILTER (WHERE window_name='previous' AND client_id<>'')::BIGINT AS previous_clients
  FROM service_lines
  GROUP BY service_id, service_name
), repeat_metrics AS (
  -- A client is "repeat" for a service when they bought it in the current window
  -- and had also bought the same service at some earlier point.
  SELECT current_window.service_id,
         COUNT(DISTINCT current_window.client_id)::BIGINT AS current_repeat_clients
    FROM service_lines current_window
   WHERE current_window.window_name='current' AND current_window.client_id<>''
     AND EXISTS (
       SELECT 1 FROM pos_sale_lines earlier_line
         JOIN pos_sales earlier_sale ON earlier_sale.tenant_id=earlier_line.tenant_id
          AND earlier_sale.branch_id=earlier_line.branch_id AND earlier_sale.id=earlier_line.sale_id
        WHERE earlier_line.tenant_id=$1 AND earlier_line.branch_id=ANY($2::TEXT[])
          AND earlier_line.line_type='service' AND earlier_line.item_id=current_window.service_id
          AND earlier_sale.client_id=current_window.client_id
          AND earlier_sale.status NOT IN ('draft','cancelled','voided','refunded')
          AND COALESCE(earlier_sale.finalized_at,earlier_sale.created_at)::DATE < current_window.sold_at
     )
   GROUP BY current_window.service_id
)
SELECT aggregated.service_id, aggregated.service_name,
       COALESCE(NULLIF(service.category,''),'') AS service_group,
       COALESCE(service.price_paise,0)::BIGINT AS list_price_paise,
       COALESCE(service.active,FALSE) AS service_active,
       aggregated.current_bookings, aggregated.previous_bookings,
       aggregated.current_revenue_paise, aggregated.previous_revenue_paise,
       aggregated.current_product_cost_paise, aggregated.previous_product_cost_paise,
       aggregated.current_clients, aggregated.previous_clients,
       COALESCE(repeat_metrics.current_repeat_clients,0)::BIGINT AS current_repeat_clients
  FROM aggregated
  LEFT JOIN services service ON service.tenant_id=$1 AND service.branch_id=ANY($2::TEXT[]) AND service.id=aggregated.service_id
  LEFT JOIN repeat_metrics ON repeat_metrics.service_id=aggregated.service_id
 ORDER BY (aggregated.previous_revenue_paise - aggregated.current_revenue_paise) DESC, aggregated.service_id
 LIMIT $4
"#;

/// Per-staff current vs previous period metrics, worst revenue drop first.
pub async fn staff_performance_trend(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    days: i32,
    limit: i64,
    rebook_window_days: i32,
) -> Result<Vec<StaffPerformanceTrendRow>, sqlx::Error> {
    sqlx::query_as(STAFF_PERFORMANCE_TREND_SQL)
        .bind(tenant_id)
        .bind(branch_ids)
        .bind(days)
        .bind(limit)
        .bind(rebook_window_days)
        .fetch_all(db)
        .await
}

/// Per-service current vs previous period metrics, worst revenue drop first.
pub async fn service_performance_trend(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    days: i32,
    limit: i64,
) -> Result<Vec<ServicePerformanceTrendRow>, sqlx::Error> {
    sqlx::query_as(SERVICE_PERFORMANCE_TREND_SQL)
        .bind(tenant_id)
        .bind(branch_ids)
        .bind(days)
        .bind(limit)
        .fetch_all(db)
        .await
}

/// Find clients whose name or phone matches the free-text fragment in a question.
pub async fn find_clients(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    query: &str,
    limit: i64,
) -> Result<Vec<CopilotClientMatch>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT client.id AS client_id,
                  BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) AS client_name,
                  COALESCE(client.phone,'') AS phone
             FROM clients client
            WHERE client.tenant_id=$1 AND client.branch_id=ANY($2::TEXT[])
              AND client.active=TRUE AND client.merged_into_client_id IS NULL
              AND (BTRIM(CONCAT_WS(' ',client.first_name,client.last_name)) ILIKE '%'||$3||'%'
                   OR client.phone LIKE '%'||$3||'%'
                   OR client.normalized_phone LIKE '%'||$3||'%')
            ORDER BY client.last_visit_at DESC NULLS LAST, client.id
            LIMIT $4"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(query)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// PostgreSQL-backed checks that the copilot reads the numbers the CRM holds.
///
/// These run only when DATABASE_URL points at a migrated database; without one
/// they skip, so a machine with no PostgreSQL still passes `cargo test`.
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;
    use uuid::Uuid;

    async fn connect() -> Option<PgPool> {
        dotenvy::dotenv().ok();
        let url = std::env::var("DATABASE_URL").ok()?;
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .ok()
    }

    async fn cleanup(db: &PgPool, tenant: &str) {
        for table in [
            "pos_sale_lines",
            "pos_sales",
            "appointments",
            "services",
            "staff",
            "clients",
        ] {
            let _ = sqlx::query(&format!("DELETE FROM {table} WHERE tenant_id=$1"))
                .bind(tenant)
                .execute(db)
                .await;
        }
    }

    /// Primary keys are globally unique, so every seeded id is tenant-scoped to
    /// keep concurrent tests from colliding.
    fn scoped(tenant: &str, id: &str) -> String {
        format!("{tenant}{id}")
    }

    /// One stylist collapses, one holds steady.
    async fn seed_staff_decline(db: &PgPool, tenant: &str, branch: &str) {
        sqlx::query(
            "INSERT INTO staff(id,tenant_id,branch_id,first_name,middle_name,last_name,appointment_display_name,email,mobile_phone,home_phone,work_phone,job_title,active)
             VALUES ($3||'declining',$1,$2,'Asha','','Rao','Asha','a@example.com','1','','','Stylist',TRUE),
                    ($3||'steady',$1,$2,'Bina','','Sen','Bina','b@example.com','2','','','Stylist',TRUE)",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("staff seeded");

        sqlx::query(
            "INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,start_at,end_at,status)
             SELECT $3||'prev_a'||g,$1,$2,$3||'client'||g,$3||'declining',(CURRENT_DATE-45+g)::timestamptz,(CURRENT_DATE-45+g)::timestamptz+INTERVAL '60 min','completed'
             FROM generate_series(1,10) g",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("previous visits seeded");
        sqlx::query(
            "INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,start_at,end_at,status)
             SELECT $3||'cur_a'||g,$1,$2,$3||'client'||g,$3||'declining',(CURRENT_DATE-15+g)::timestamptz,(CURRENT_DATE-15+g)::timestamptz+INTERVAL '60 min','completed'
             FROM generate_series(1,3) g",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("current visits seeded");
        sqlx::query(
            "INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,start_at,end_at,status)
             SELECT $3||'can_a'||g,$1,$2,$3||'client'||g,$3||'declining',(CURRENT_DATE-10+g)::timestamptz,(CURRENT_DATE-10+g)::timestamptz+INTERVAL '60 min','cancelled'
             FROM generate_series(1,4) g",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("cancellations seeded");
        sqlx::query(
            "INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,start_at,end_at,status)
             SELECT $3||'prev_b'||g,$1,$2,$3||'other'||g,$3||'steady',(CURRENT_DATE-45+g)::timestamptz,(CURRENT_DATE-45+g)::timestamptz+INTERVAL '30 min','completed'
             FROM generate_series(1,6) g",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("steady previous seeded");
        sqlx::query(
            "INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,start_at,end_at,status)
             SELECT $3||'cur_b'||g,$1,$2,$3||'other'||g,$3||'steady',(CURRENT_DATE-15+g)::timestamptz,(CURRENT_DATE-15+g)::timestamptz+INTERVAL '30 min','completed'
             FROM generate_series(1,7) g",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("steady current seeded");

        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             VALUES ($3||'sale_prev_a',$1,$2,$3||'client1','INV-PA',100000,100000,100000,'paid',(CURRENT_DATE-40)::timestamptz,(CURRENT_DATE-40)::timestamptz),
                    ($3||'sale_cur_a',$1,$2,$3||'client1','INV-CA',30000,30000,30000,'paid',(CURRENT_DATE-10)::timestamptz,(CURRENT_DATE-10)::timestamptz),
                    ($3||'sale_prev_b',$1,$2,$3||'other1','INV-PB',60000,60000,60000,'paid',(CURRENT_DATE-40)::timestamptz,(CURRENT_DATE-40)::timestamptz),
                    ($3||'sale_cur_b',$1,$2,$3||'other1','INV-CB',70000,70000,70000,'paid',(CURRENT_DATE-10)::timestamptz,(CURRENT_DATE-10)::timestamptz)",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("sales seeded");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise,staff_id)
             VALUES ($3||'line_pa',$1,$2,$3||'sale_prev_a','service','spa','Hair Spa',1,100000,100000,$3||'declining'),
                    ($3||'line_ca',$1,$2,$3||'sale_cur_a','service','spa','Hair Spa',1,30000,30000,$3||'declining'),
                    ($3||'line_pb',$1,$2,$3||'sale_prev_b','service','facial','Facial',1,60000,60000,$3||'steady'),
                    ($3||'line_cb',$1,$2,$3||'sale_cur_b','service','facial','Facial',1,70000,70000,$3||'steady')",
        ).bind(tenant).bind(branch).bind(tenant).execute(db).await.expect("sale lines seeded");
    }

    #[tokio::test]
    async fn staff_trend_reports_the_real_decline_and_leaves_steady_staff_flat() {
        let Some(db) = connect().await else { return };
        let tenant = format!("copilot_staff_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        cleanup(&db, &tenant).await;
        seed_staff_decline(&db, &tenant, branch).await;

        let rows = staff_performance_trend(&db, &tenant, &one_branch(branch), 30, 10, 14)
            .await
            .expect("staff trend loads");
        assert_eq!(
            rows.len(),
            2,
            "both active staff with activity are returned"
        );

        // The worst revenue drop sorts first, because it drives the recommendation.
        let worst = &rows[0];
        assert_eq!(worst.staff_id, scoped(&tenant, "declining"));
        assert_eq!(worst.previous_revenue_paise, 100_000);
        assert_eq!(worst.current_revenue_paise, 30_000);
        assert_eq!(worst.previous_completed, 10);
        assert_eq!(worst.current_completed, 3);
        assert_eq!(worst.previous_cancelled, 0);
        assert_eq!(worst.current_cancelled, 4);
        assert_eq!(worst.previous_booked_minutes, 600);
        assert_eq!(worst.current_booked_minutes, 180);

        let steady = &rows[1];
        assert_eq!(steady.staff_id, scoped(&tenant, "steady"));
        assert_eq!(steady.previous_completed, 6);
        assert_eq!(steady.current_completed, 7);
        assert!(steady.current_revenue_paise > steady.previous_revenue_paise);

        cleanup(&db, &tenant).await;
    }

    #[tokio::test]
    async fn rebooking_excludes_visits_too_recent_to_have_rebooked() {
        let Some(db) = connect().await else { return };
        let tenant = format!("copilot_rebook_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        cleanup(&db, &tenant).await;
        seed_staff_decline(&db, &tenant, branch).await;

        sqlx::query(
            "INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,start_at,end_at,status,created_at)
             SELECT $3||'follow'||g,$1,$2,$3||'client'||g,$3||'declining',(CURRENT_DATE-45+g+20)::timestamptz,(CURRENT_DATE-45+g+20)::timestamptz+INTERVAL '60 min','booked',(CURRENT_DATE-45+g+1)::timestamptz
             FROM generate_series(1,8) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("follow-ups seeded");

        let rows = staff_performance_trend(&db, &tenant, &one_branch(branch), 30, 10, 14)
            .await
            .expect("staff trend loads");
        let worst = rows
            .iter()
            .find(|row| row.staff_id == scoped(&tenant, "declining"))
            .expect("declining staff");

        assert_eq!(
            worst.previous_rebooked, 8,
            "prompt follow-ups count as rebooked"
        );
        assert_eq!(
            worst.previous_rebook_eligible, 10,
            "all previous visits are old enough to judge"
        );
        // Current-window visits sit inside the settling window, so they must not
        // be counted as failed rebookings and drag the rate down.
        assert!(
            worst.current_rebook_eligible < worst.current_completed,
            "recent visits are excluded from the rebooking denominator"
        );

        cleanup(&db, &tenant).await;
    }

    #[tokio::test]
    async fn service_trend_separates_a_declining_service_from_a_growing_one() {
        let Some(db) = connect().await else { return };
        let tenant = format!("copilot_service_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        cleanup(&db, &tenant).await;

        sqlx::query(
            "INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
             VALUES ('spa',$1,$2,'Hair Spa','Hair',60,100000,TRUE),('facial',$1,$2,'Facial','Skin',45,60000,TRUE)",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("services seeded");
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             SELECT 'spa_prev'||g,$1,$2,'client'||g,'INV-SP'||g,100000,100000,100000,'paid',(CURRENT_DATE-40)::timestamptz,(CURRENT_DATE-40)::timestamptz FROM generate_series(1,5) g",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("spa previous sales");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             SELECT 'spa_prev_l'||g,$1,$2,'spa_prev'||g,'service','spa','Hair Spa',1,100000,100000 FROM generate_series(1,5) g",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("spa previous lines");
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             VALUES ('spa_cur',$1,$2,'client1','INV-SC',100000,100000,100000,'paid',(CURRENT_DATE-5)::timestamptz,(CURRENT_DATE-5)::timestamptz)",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("spa current sale");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             VALUES ('spa_cur_l',$1,$2,'spa_cur','service','spa','Hair Spa',1,100000,100000)",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("spa current line");
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             SELECT 'fac_cur'||g,$1,$2,'client'||g,'INV-FC'||g,60000,60000,60000,'paid',(CURRENT_DATE-5)::timestamptz,(CURRENT_DATE-5)::timestamptz FROM generate_series(1,3) g",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("facial current sales");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             SELECT 'fac_cur_l'||g,$1,$2,'fac_cur'||g,'service','facial','Facial',1,60000,60000 FROM generate_series(1,3) g",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("facial current lines");

        let rows = service_performance_trend(&db, &tenant, &one_branch(branch), 30, 10)
            .await
            .expect("service trend loads");

        let spa = rows
            .iter()
            .find(|row| row.service_id == "spa")
            .expect("hair spa row");
        assert_eq!(spa.previous_bookings, 5);
        assert_eq!(spa.current_bookings, 1);
        assert_eq!(spa.previous_revenue_paise, 500_000);
        assert_eq!(spa.current_revenue_paise, 100_000);
        // client1 bought Hair Spa before, so the current buyer is a repeat client.
        assert_eq!(spa.current_repeat_clients, 1);

        let facial = rows
            .iter()
            .find(|row| row.service_id == "facial")
            .expect("facial row");
        assert_eq!(facial.previous_bookings, 0);
        assert_eq!(facial.current_bookings, 3);
        assert_eq!(
            facial.current_repeat_clients, 0,
            "first-time buyers are not repeat clients"
        );

        assert_eq!(
            rows[0].service_id, "spa",
            "the declining service sorts first"
        );

        cleanup(&db, &tenant).await;
    }

    #[tokio::test]
    async fn voided_deleted_and_draft_sales_never_reach_the_copilot() {
        let Some(db) = connect().await else { return };
        let tenant = format!("copilot_excl_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        cleanup(&db, &tenant).await;

        sqlx::query(
            "INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
             VALUES ('spa',$1,$2,'Hair Spa','Hair',60,100000,TRUE)",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("service seeded");
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at,is_deleted)
             VALUES ('voided',$1,$2,'client1','INV-V',100000,100000,0,'voided',(CURRENT_DATE-5)::timestamptz,(CURRENT_DATE-5)::timestamptz,FALSE),
                    ('deleted',$1,$2,'client1','INV-D',100000,100000,100000,'paid',(CURRENT_DATE-5)::timestamptz,(CURRENT_DATE-5)::timestamptz,TRUE),
                    ('draft',$1,$2,'client1','INV-DR',100000,100000,0,'draft',(CURRENT_DATE-5)::timestamptz,(CURRENT_DATE-5)::timestamptz,FALSE)",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("excluded sales seeded");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             VALUES ('lv',$1,$2,'voided','service','spa','Hair Spa',1,100000,100000),
                    ('ld',$1,$2,'deleted','service','spa','Hair Spa',1,100000,100000),
                    ('ldr',$1,$2,'draft','service','spa','Hair Spa',1,100000,100000)",
        ).bind(&tenant).bind(branch).execute(&db).await.expect("excluded lines seeded");

        let rows = service_performance_trend(&db, &tenant, &one_branch(branch), 30, 10)
            .await
            .expect("service trend loads");
        assert!(
            rows.is_empty(),
            "voided, soft-deleted and draft sales must not produce revenue, got {rows:?}"
        );

        cleanup(&db, &tenant).await;
    }

    #[tokio::test]
    async fn weekday_demand_splits_bookings_onto_the_right_days() {
        let Some(db) = connect().await else { return };
        let tenant = format!("copilot_weekday_{}", Uuid::new_v4().simple());
        let branch = "branch1";
        cleanup(&db, &tenant).await;

        sqlx::query(
            "INSERT INTO services(id,tenant_id,branch_id,name,category,duration_minutes,price_paise,active)
             VALUES ($3||'spa',$1,$2,'Hair Spa','Hair',60,100000,TRUE)",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("service seeded");

        // Four sales, all placed on the most recent Wednesday so the day is exact.
        sqlx::query(
            "INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,invoice_number,subtotal_paise,total_paise,paid_paise,status,finalized_at,created_at)
             SELECT $3||'wed'||g,$1,$2,$3||'client'||g,'INV-W'||g,100000,100000,100000,'paid',
                    (CURRENT_DATE - ((EXTRACT(ISODOW FROM CURRENT_DATE)::INT + 4) % 7) - 7)::timestamptz,
                    (CURRENT_DATE - ((EXTRACT(ISODOW FROM CURRENT_DATE)::INT + 4) % 7) - 7)::timestamptz
             FROM generate_series(1,4) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("wednesday sales seeded");
        sqlx::query(
            "INSERT INTO pos_sale_lines(id,tenant_id,branch_id,sale_id,line_type,item_id,item_name,quantity,unit_price_paise,line_total_paise)
             SELECT $3||'wedl'||g,$1,$2,$3||'wed'||g,'service',$3||'spa','Hair Spa',1,100000,100000 FROM generate_series(1,4) g",
        ).bind(&tenant).bind(branch).bind(&tenant).execute(&db).await.expect("wednesday lines seeded");

        let rows = weekday_demand(&db, &tenant, &one_branch(branch), 30, "")
            .await
            .expect("weekday demand loads");
        assert_eq!(
            rows.len(),
            7,
            "every weekday is present, including empty ones"
        );
        assert_eq!(rows[0].weekday, 1);
        assert_eq!(rows[0].weekday_name, "Monday", "names carry no padding");
        assert_eq!(rows[6].weekday_name, "Sunday");

        let wednesday = &rows[2];
        assert_eq!(wednesday.weekday_name, "Wednesday");
        assert_eq!(
            wednesday.service_bookings, 4,
            "all four sales land on Wednesday"
        );
        assert_eq!(wednesday.service_revenue_paise, 400_000);
        let other_days: i64 = rows
            .iter()
            .filter(|row| row.weekday != 3)
            .map(|row| row.service_bookings)
            .sum();
        assert_eq!(other_days, 0, "no bookings leak onto other days");

        // Filtering to a service the branch does not sell yields an empty week.
        let filtered = weekday_demand(&db, &tenant, &one_branch(branch), 30, "no-such-service")
            .await
            .expect("weekday demand loads");
        assert_eq!(filtered.len(), 7);
        assert_eq!(
            filtered.iter().map(|row| row.service_bookings).sum::<i64>(),
            0
        );

        // With no roster recorded, utilization must be absent rather than zero.
        assert!(
            rows.iter().all(|row| row.utilization_percent().is_none()),
            "utilization is unknown without a roster, not 0%"
        );

        cleanup(&db, &tenant).await;
    }

    #[tokio::test]
    async fn branch_name_resolves_by_uuid_or_scope_id() {
        let Some(db) = connect().await else { return };
        // branches.id and branches.tenant_id are UUIDs, unlike the rest of the schema.
        let tenant = Uuid::new_v4().to_string();
        let branch = Uuid::new_v4().to_string();
        // branches.tenant_id is a real foreign key, so the tenant must exist first.
        // The schema rejects obviously fake business names, so use a plausible one.
        sqlx::query(
            "INSERT INTO tenants(id,name,status) VALUES ($1::UUID,'Aura Salon Group','active')",
        )
        .bind(&tenant)
        .execute(&db)
        .await
        .expect("tenant seeded");
        sqlx::query(
            "INSERT INTO branches(id,tenant_id,name,scope_id,active) VALUES ($2::UUID,$1::UUID,'Andheri West','andheri-west',TRUE)",
        )
        .bind(&tenant)
        .bind(&branch)
        .execute(&db)
        .await
        .expect("branch seeded");

        let by_uuid = branch_name(&db, &tenant, &branch)
            .await
            .expect("lookup runs");
        assert_eq!(by_uuid.as_deref(), Some("Andheri West"));

        // Migration 0243 canonicalises the scope id: a BEFORE trigger rewrites
        // scope_id to id::TEXT, so the seeded slug never survives the insert.
        let stored_scope: String =
            sqlx::query_scalar("SELECT scope_id FROM branches WHERE id::TEXT=$1")
                .bind(&branch)
                .fetch_one(&db)
                .await
                .expect("scope id readable");
        assert_eq!(
            stored_scope, branch,
            "scope_id is canonicalised to the branch uuid"
        );

        // A branch addressed by its scope id must resolve to the same name.
        let by_scope = branch_name(&db, &tenant, &stored_scope)
            .await
            .expect("lookup runs");
        assert_eq!(by_scope.as_deref(), Some("Andheri West"));

        // A non-UUID branch id must return nothing, not raise a type error.
        let missing = branch_name(&db, &tenant, "no-such-branch")
            .await
            .expect("a non-uuid branch id is handled, not fatal");
        assert_eq!(missing, None);

        let _ = sqlx::query("DELETE FROM branches WHERE tenant_id::TEXT=$1")
            .bind(&tenant)
            .execute(&db)
            .await;
        let _ = sqlx::query("DELETE FROM tenants WHERE id::TEXT=$1")
            .bind(&tenant)
            .execute(&db)
            .await;
    }

    #[tokio::test]
    async fn client_lookup_matches_name_and_phone_within_the_branch_only() {
        let Some(db) = connect().await else { return };
        let tenant = format!("copilot_lookup_{}", Uuid::new_v4().simple());
        cleanup(&db, &tenant).await;

        sqlx::query(
            "INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,normalized_phone,active)
             VALUES ('c1',$1,'branch1','Anita','Sharma','9876543210','9876543210',TRUE),
                    ('c2',$1,'branch1','Anita','Verma','9811111111','9811111111',TRUE),
                    ('c3',$1,'branch2','Anita','Other','9822222222','9822222222',TRUE),
                    ('c4',$1,'branch1','Inactive','Person','9833333333','9833333333',FALSE)",
        ).bind(&tenant).execute(&db).await.expect("clients seeded");

        let by_full_name = find_clients(&db, &tenant, &one_branch("branch1"), "Anita Sharma", 5)
            .await
            .expect("lookup runs");
        assert_eq!(by_full_name.len(), 1, "a full name resolves to one client");
        assert_eq!(by_full_name[0].client_id, "c1");

        let by_given_name = find_clients(&db, &tenant, &one_branch("branch1"), "Anita", 5)
            .await
            .expect("lookup runs");
        assert_eq!(
            by_given_name.len(),
            2,
            "an ambiguous name returns both candidates instead of guessing"
        );

        let by_phone = find_clients(&db, &tenant, &one_branch("branch1"), "9811111111", 5)
            .await
            .expect("lookup runs");
        assert_eq!(by_phone.len(), 1);
        assert_eq!(by_phone[0].client_id, "c2");

        let inactive = find_clients(&db, &tenant, &one_branch("branch1"), "Inactive", 5)
            .await
            .expect("lookup runs");
        assert!(inactive.is_empty(), "inactive clients are not offered");

        cleanup(&db, &tenant).await;
    }
}

/// An active stock item at or approaching its reorder point, with the recent
/// consumption that says how urgent the gap is.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRiskRow {
    pub item_id: String,
    pub item_name: String,
    pub sku: String,
    pub category: String,
    pub unit: String,
    pub stock_quantity: i64,
    pub reorder_point: i64,
    /// Units consumed by sales in the window, used to estimate cover.
    pub consumed_units: i64,
    /// Value of the stock still on hand.
    pub stock_value_paise: i64,
}

/// Items at or below their reorder point, worst cover first.
///
/// Consumption comes from the same stock ledger the inventory reports use, so
/// the copilot and the inventory screens cannot disagree about usage.
pub async fn inventory_risk(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    window_days: i32,
    limit: i64,
) -> Result<Vec<InventoryRiskRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH consumption AS (
          SELECT inventory_item_id,
                 COALESCE(SUM(ABS(quantity_delta)),0)::BIGINT AS consumed_units
          FROM inventory_stock_ledger
          WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
            AND movement_type='sale'
            AND created_at >= NOW() - MAKE_INTERVAL(days => $3)
          GROUP BY inventory_item_id
        )
        SELECT item.id                                    AS item_id,
               item.name                                  AS item_name,
               item.sku,
               item.category,
               item.unit,
               item.stock_quantity::BIGINT                AS stock_quantity,
               item.reorder_point::BIGINT                 AS reorder_point,
               COALESCE(consumption.consumed_units,0)::BIGINT AS consumed_units,
               (item.stock_quantity::BIGINT * item.unit_cost_paise)::BIGINT AS stock_value_paise
        FROM inventory_items item
        LEFT JOIN consumption ON consumption.inventory_item_id=item.id
        WHERE item.tenant_id=$1 AND item.branch_id=ANY($2::TEXT[])
          AND item.active=TRUE
          AND item.stock_quantity <= item.reorder_point
        ORDER BY (item.reorder_point - item.stock_quantity) DESC,
                 COALESCE(consumption.consumed_units,0) DESC,
                 item.name
        LIMIT $4
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(window_days)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// How an offer performed: what it was shown to, what it cost, what it returned.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OfferPerformanceRow {
    pub offer_id: String,
    pub offer_code: String,
    pub discount_type: String,
    pub active: bool,
    pub views: i64,
    pub clicks: i64,
    /// Sales that actually carried this coupon in the window.
    pub redemptions: i64,
    /// Discount given away on those sales.
    pub discount_paise: i64,
    /// Revenue on the sales that used it, net of the discount.
    pub revenue_paise: i64,
}

/// Offer performance for the window, most redeemed first.
pub async fn offer_performance(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    window_days: i32,
    limit: i64,
) -> Result<Vec<OfferPerformanceRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH bounds AS (
          SELECT (NOW() - MAKE_INTERVAL(days => $3)) AS since
        ), events AS (
          SELECT offer_id,
                 COUNT(*) FILTER (WHERE event_type='view')::BIGINT  AS views,
                 COUNT(*) FILTER (WHERE event_type='click')::BIGINT AS clicks
          FROM marketing_offer_events, bounds
          WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND created_at >= bounds.since
          GROUP BY offer_id
        ), redemptions AS (
          -- Sales carry the coupon by code, not by id.
          SELECT UPPER(BTRIM(sale.coupon_code))                        AS coupon_code,
                 COUNT(*)::BIGINT                                      AS redemptions,
                 COALESCE(SUM(sale.coupon_discount_paise),0)::BIGINT   AS discount_paise,
                 COALESCE(SUM(sale.total_paise),0)::BIGINT             AS revenue_paise
          FROM pos_sales sale, bounds
          WHERE sale.tenant_id=$1 AND sale.branch_id=ANY($2::TEXT[])
            AND COALESCE(BTRIM(sale.coupon_code),'')<>''
            AND sale.status NOT IN ('draft','open','voided','cancelled')
            AND sale.created_at >= bounds.since
          GROUP BY 1
        )
        SELECT coupon.id                                   AS offer_id,
               coupon.code                                 AS offer_code,
               coupon.discount_type,
               coupon.active,
               COALESCE(events.views,0)::BIGINT            AS views,
               COALESCE(events.clicks,0)::BIGINT           AS clicks,
               COALESCE(redemptions.redemptions,0)::BIGINT AS redemptions,
               COALESCE(redemptions.discount_paise,0)::BIGINT AS discount_paise,
               COALESCE(redemptions.revenue_paise,0)::BIGINT  AS revenue_paise
        FROM pos_coupons coupon
        LEFT JOIN events ON events.offer_id=coupon.id
        LEFT JOIN redemptions ON redemptions.coupon_code=UPPER(BTRIM(coupon.code))
        WHERE coupon.tenant_id=$1 AND coupon.branch_id=ANY($2::TEXT[])
        ORDER BY COALESCE(redemptions.redemptions,0) DESC,
                 COALESCE(events.views,0) DESC,
                 coupon.code
        LIMIT $4
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(window_days)
    .bind(limit)
    .fetch_all(db)
    .await
}
