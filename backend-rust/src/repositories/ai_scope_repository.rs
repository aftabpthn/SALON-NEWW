//! Data access for the AI copilot's login-derived data scope.
//!
//! Every query here takes the already-authorized branch id list produced by
//! `ai_scope_service`. Nothing in this module widens a scope: callers pass the
//! branches the logged-in user may read, and each statement filters on that list
//! plus the tenant. The copilot never issues free-form SQL; it selects one of
//! these statements through the allow-listed tool registry.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool};

/// Statuses that mean an appointment actually happened.
const COMPLETED_APPOINTMENT_STATUSES: &str = "('completed','billed','paid')";
/// Statuses that mean the client did not turn up.
const NO_SHOW_APPOINTMENT_STATUSES: &str = "('no-show','no_show')";
const CANCELLED_APPOINTMENT_STATUSES: &str = "('cancelled','canceled','void')";
/// POS sale statuses excluded from revenue because they are not realised money.
const NON_REVENUE_SALE_STATUSES: &str = "('draft','open','voided','cancelled','refunded')";

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeBranchRow {
    pub branch_id: String,
    pub branch_name: String,
    pub branch_code: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub active: bool,
    pub access_type: String,
    pub role_name: String,
}

/// Branches the user may read, with their place in the geo hierarchy.
///
/// `unrestricted` is reserved for tenant-wide roles (owner, super admin, and
/// admins holding a tenant-wide grant); everyone else is filtered through
/// `user_branch_roles`, including the deputation validity window.
pub async fn authorized_branches(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
    unrestricted: bool,
) -> Result<Vec<ScopeBranchRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                  branch.name AS branch_name,
                  COALESCE(branch.code,'') AS branch_code,
                  branch.region_name,branch.zone_name,branch.cluster_name,branch.active,
                  COALESCE(access.access_type,'tenant_wide') AS access_type,
                  COALESCE(access.role_name,'') AS role_name
             FROM branches branch
             JOIN tenants tenant ON tenant.id=branch.tenant_id
             LEFT JOIN user_branch_roles access
               ON access.tenant_id=$1 AND access.user_id=$2 AND access.active=TRUE
              AND access.branch_id=COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)
              AND (access.access_type='permanent'
                OR (access.valid_from IS NOT NULL AND access.valid_until IS NOT NULL
                    AND CURRENT_DATE BETWEEN access.valid_from AND access.valid_until))
            WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
              AND ($3 OR access.id IS NOT NULL)
            ORDER BY branch.region_name,branch.zone_name,branch.cluster_name,branch.name"#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(unrestricted)
    .fetch_all(db)
    .await
}

/// Branches in the tenant regardless of the caller, used to report what a
/// narrowed scope excluded without leaking anything beyond names.
pub async fn tenant_branch_directory(
    db: &PgPool,
    tenant_id: &str,
) -> Result<Vec<ScopeBranchRow>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                  branch.name AS branch_name,
                  COALESCE(branch.code,'') AS branch_code,
                  branch.region_name,branch.zone_name,branch.cluster_name,branch.active,
                  'directory'::TEXT AS access_type,
                  ''::TEXT AS role_name
             FROM branches branch
             JOIN tenants tenant ON tenant.id=branch.tenant_id
            WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
            ORDER BY branch.region_name,branch.zone_name,branch.cluster_name,branch.name"#,
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
}

/// The staff row linked to a login, used to give `staff` role users their own
/// performance without exposing colleagues.
pub async fn staff_id_for_user(
    db: &PgPool,
    tenant_id: &str,
    user_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT member.id
             FROM staff member
             JOIN users account ON account.tenant_id=member.tenant_id AND account.id=$2
            WHERE member.tenant_id=$1 AND member.active=TRUE
              AND member.email<>'' AND LOWER(member.email)=LOWER(account.email)
            ORDER BY member.created_at
            LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchMetricsRow {
    pub branch_id: String,
    pub branch_name: String,
    pub region_name: String,
    pub zone_name: String,
    pub cluster_name: String,
    pub revenue_paise: i64,
    pub service_revenue_paise: i64,
    pub product_revenue_paise: i64,
    pub discount_paise: i64,
    pub invoice_count: i64,
    pub completed_appointments: i64,
    pub cancelled_appointments: i64,
    pub no_show_appointments: i64,
    pub booked_minutes: i64,
    pub scheduled_minutes: i64,
    pub unique_clients: i64,
    pub new_clients: i64,
}

/// Per-branch revenue and operations for one period. The caller runs this twice
/// (current period and previous equivalent period) to build the comparison every
/// copilot answer carries.
pub async fn branch_period_metrics(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<BranchMetricsRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name,branch.region_name,branch.zone_name,branch.cluster_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), sales AS (
             SELECT sale.branch_id,
                    COALESCE(SUM(sale.total_paise),0)::BIGINT AS revenue_paise,
                    COALESCE(SUM(sale.discount_paise),0)::BIGINT AS discount_paise,
                    COUNT(*)::BIGINT AS invoice_count
               FROM pos_sales sale
               JOIN scoped ON scoped.branch_id=sale.branch_id
              WHERE sale.tenant_id=$1
                AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
                AND COALESCE(sale.finalized_at,sale.created_at)>=$3
                AND COALESCE(sale.finalized_at,sale.created_at)<$4::DATE+INTERVAL '1 day'
              GROUP BY sale.branch_id
           ), mix AS (
             SELECT line.branch_id,
                    COALESCE(SUM(line.line_total_paise)
                      FILTER (WHERE line.line_type IN ('service','package_redeem','membership_redeem')),0)::BIGINT
                      AS service_revenue_paise,
                    COALESCE(SUM(line.line_total_paise)
                      FILTER (WHERE line.line_type='product'),0)::BIGINT AS product_revenue_paise
               FROM pos_sale_lines line
               JOIN pos_sales sale ON sale.id=line.sale_id
                AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
               JOIN scoped ON scoped.branch_id=line.branch_id
              WHERE line.tenant_id=$1
                AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
                AND COALESCE(sale.finalized_at,sale.created_at)>=$3
                AND COALESCE(sale.finalized_at,sale.created_at)<$4::DATE+INTERVAL '1 day'
              GROUP BY line.branch_id
           ), appointments_agg AS (
             SELECT appointment.branch_id,
                    COUNT(*) FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES})::BIGINT
                      AS completed_appointments,
                    COUNT(*) FILTER (WHERE appointment.status IN {CANCELLED_APPOINTMENT_STATUSES})::BIGINT
                      AS cancelled_appointments,
                    COUNT(*) FILTER (WHERE appointment.status IN {NO_SHOW_APPOINTMENT_STATUSES})::BIGINT
                      AS no_show_appointments,
                    COALESCE(SUM(GREATEST(
                      EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60,0))
                      FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES}),0)::BIGINT
                      AS booked_minutes,
                    COUNT(DISTINCT appointment.client_id)
                      FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES})::BIGINT
                      AS unique_clients
               FROM appointments appointment
               JOIN scoped ON scoped.branch_id=appointment.branch_id
              WHERE appointment.tenant_id=$1
                AND appointment.start_at>=$3
                AND appointment.start_at<$4::DATE+INTERVAL '1 day'
              GROUP BY appointment.branch_id
           ), schedules AS (
             SELECT schedule.branch_id,
                    COALESCE(SUM(
                      COALESCE(EXTRACT(EPOCH FROM (schedule.shift1_end-schedule.shift1_start))::BIGINT/60,0)
                      + COALESCE(EXTRACT(EPOCH FROM (schedule.shift2_end-schedule.shift2_start))::BIGINT/60,0)
                    ),0)::BIGINT AS scheduled_minutes
               FROM staff_schedules schedule
               JOIN scoped ON scoped.branch_id=schedule.branch_id
              WHERE schedule.tenant_id=$1 AND schedule.status='working'
                AND schedule.schedule_date BETWEEN $3 AND $4
              GROUP BY schedule.branch_id
           ), fresh_clients AS (
             SELECT client.branch_id,COUNT(*)::BIGINT AS new_clients
               FROM clients client
               JOIN scoped ON scoped.branch_id=client.branch_id
              WHERE client.tenant_id=$1 AND client.active=TRUE
                AND client.created_at>=$3
                AND client.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY client.branch_id
           )
           SELECT scoped.branch_id,scoped.branch_name,scoped.region_name,scoped.zone_name,
                  scoped.cluster_name,
                  COALESCE(sales.revenue_paise,0)::BIGINT AS revenue_paise,
                  COALESCE(mix.service_revenue_paise,0)::BIGINT AS service_revenue_paise,
                  COALESCE(mix.product_revenue_paise,0)::BIGINT AS product_revenue_paise,
                  COALESCE(sales.discount_paise,0)::BIGINT AS discount_paise,
                  COALESCE(sales.invoice_count,0)::BIGINT AS invoice_count,
                  COALESCE(appointments_agg.completed_appointments,0)::BIGINT AS completed_appointments,
                  COALESCE(appointments_agg.cancelled_appointments,0)::BIGINT AS cancelled_appointments,
                  COALESCE(appointments_agg.no_show_appointments,0)::BIGINT AS no_show_appointments,
                  COALESCE(appointments_agg.booked_minutes,0)::BIGINT AS booked_minutes,
                  COALESCE(schedules.scheduled_minutes,0)::BIGINT AS scheduled_minutes,
                  COALESCE(appointments_agg.unique_clients,0)::BIGINT AS unique_clients,
                  COALESCE(fresh_clients.new_clients,0)::BIGINT AS new_clients
             FROM scoped
             LEFT JOIN sales ON sales.branch_id=scoped.branch_id
             LEFT JOIN mix ON mix.branch_id=scoped.branch_id
             LEFT JOIN appointments_agg ON appointments_agg.branch_id=scoped.branch_id
             LEFT JOIN schedules ON schedules.branch_id=scoped.branch_id
             LEFT JOIN fresh_clients ON fresh_clients.branch_id=scoped.branch_id
            ORDER BY scoped.region_name,scoped.zone_name,scoped.cluster_name,scoped.branch_name"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPerformanceRow {
    pub staff_id: String,
    pub staff_name: String,
    pub branch_id: String,
    pub branch_name: String,
    pub job_title: String,
    pub completed_appointments: i64,
    pub cancelled_appointments: i64,
    pub no_show_appointments: i64,
    pub booked_minutes: i64,
    pub scheduled_minutes: i64,
    pub worked_minutes: i64,
    pub present_days: i64,
    pub late_days: i64,
    pub absent_days: i64,
    pub service_revenue_paise: i64,
    pub product_revenue_paise: i64,
    pub invoice_count: i64,
    pub unique_clients: i64,
    pub rebooked_clients: i64,
    pub returning_clients: i64,
    pub service_duration_variance_minutes: i64,
    pub feedback_count: i64,
    pub feedback_rating_sum: i64,
    pub target_count: i64,
    pub consumption_variance_quantity: i64,
    pub consumption_variance_cost_paise: i64,
}

/// Staff performance facts for a period.
///
/// Deliberately returns raw counters rather than a verdict: a staff member is
/// never called weak on revenue alone, so the service layer weighs these against
/// minimum appointments, worked hours and the assigned schedule before judging.
pub async fn staff_performance(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
    staff_id_filter: Option<&str>,
) -> Result<Vec<StaffPerformanceRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), roster AS (
             SELECT member.id AS staff_id,member.branch_id,scoped.branch_name,
                    BTRIM(CONCAT_WS(' ',member.first_name,NULLIF(member.last_name,''))) AS staff_name,
                    member.job_title
               FROM staff member
               JOIN scoped ON scoped.branch_id=member.branch_id
              WHERE member.tenant_id=$1 AND member.active=TRUE
                AND ($5='' OR member.id=$5)
           ), appointment_facts AS (
             SELECT appointment.staff_id,
                    COUNT(*) FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES})::BIGINT
                      AS completed_appointments,
                    COUNT(*) FILTER (WHERE appointment.status IN {CANCELLED_APPOINTMENT_STATUSES})::BIGINT
                      AS cancelled_appointments,
                    COUNT(*) FILTER (WHERE appointment.status IN {NO_SHOW_APPOINTMENT_STATUSES})::BIGINT
                      AS no_show_appointments,
                    COALESCE(SUM(GREATEST(
                      EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60,0))
                      FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES}),0)::BIGINT
                      AS booked_minutes,
                    COUNT(DISTINCT appointment.client_id)
                      FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES})::BIGINT
                      AS unique_clients
               FROM appointments appointment
               JOIN roster ON roster.staff_id=appointment.staff_id
                AND roster.branch_id=appointment.branch_id
              WHERE appointment.tenant_id=$1
                AND appointment.start_at>=$3
                AND appointment.start_at<$4::DATE+INTERVAL '1 day'
              GROUP BY appointment.staff_id
           ), duration_variance AS (
             SELECT appointment.staff_id,
                    COALESCE(SUM(
                      GREATEST(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60,0)
                      - COALESCE(service.duration_minutes,0)::BIGINT),0)::BIGINT
                      AS service_duration_variance_minutes
               FROM appointments appointment
               JOIN roster ON roster.staff_id=appointment.staff_id
                AND roster.branch_id=appointment.branch_id
               JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(
                      CASE WHEN JSONB_TYPEOF(
                             COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB)='array'
                           THEN COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB
                           ELSE '[]'::JSONB END
                    ) AS booked_service(service_id) ON TRUE
               JOIN services service ON service.id=booked_service.service_id
                AND service.tenant_id=appointment.tenant_id
                AND service.branch_id=appointment.branch_id
              WHERE appointment.tenant_id=$1
                AND appointment.status IN {COMPLETED_APPOINTMENT_STATUSES}
                AND appointment.start_at>=$3
                AND appointment.start_at<$4::DATE+INTERVAL '1 day'
              GROUP BY appointment.staff_id
           ), rebooking AS (
             SELECT completed.staff_id,
                    COUNT(DISTINCT completed.client_id)::BIGINT AS rebooked_clients
               FROM appointments completed
               JOIN roster ON roster.staff_id=completed.staff_id
                AND roster.branch_id=completed.branch_id
              WHERE completed.tenant_id=$1
                AND completed.status IN {COMPLETED_APPOINTMENT_STATUSES}
                AND completed.start_at>=$3
                AND completed.start_at<$4::DATE+INTERVAL '1 day'
                AND EXISTS (
                  SELECT 1 FROM appointments follow_up
                   WHERE follow_up.tenant_id=completed.tenant_id
                     AND follow_up.branch_id=completed.branch_id
                     AND follow_up.client_id=completed.client_id
                     AND follow_up.id<>completed.id
                     AND follow_up.start_at>completed.start_at
                     AND follow_up.status NOT IN {CANCELLED_APPOINTMENT_STATUSES})
              GROUP BY completed.staff_id
           ), returning_clients AS (
             SELECT visit.staff_id,COUNT(DISTINCT visit.client_id)::BIGINT AS returning_clients
               FROM appointments visit
               JOIN roster ON roster.staff_id=visit.staff_id AND roster.branch_id=visit.branch_id
              WHERE visit.tenant_id=$1
                AND visit.status IN {COMPLETED_APPOINTMENT_STATUSES}
                AND visit.start_at>=$3 AND visit.start_at<$4::DATE+INTERVAL '1 day'
                AND EXISTS (
                  SELECT 1 FROM appointments earlier
                   WHERE earlier.tenant_id=visit.tenant_id
                     AND earlier.branch_id=visit.branch_id
                     AND earlier.client_id=visit.client_id
                     AND earlier.start_at<$3
                     AND earlier.status IN {COMPLETED_APPOINTMENT_STATUSES})
              GROUP BY visit.staff_id
           ), sale_facts AS (
             SELECT attribution.staff_id,
                    COALESCE(SUM(attribution.line_share_paise)
                      FILTER (WHERE attribution.line_type IN ('service','package_redeem','membership_redeem')),0)::BIGINT
                      AS service_revenue_paise,
                    COALESCE(SUM(attribution.line_share_paise)
                      FILTER (WHERE attribution.line_type='product'),0)::BIGINT AS product_revenue_paise,
                    COUNT(DISTINCT attribution.sale_id)::BIGINT AS invoice_count
               FROM (
                 SELECT line.sale_id,line.line_type,
                        COALESCE(NULLIF(split.staff_id,''),NULLIF(line.staff_id,''),
                                 NULLIF(sale.staff_id,'')) AS staff_id,
                        (line.line_total_paise*COALESCE(split.percent,100))/100 AS line_share_paise
                   FROM pos_sale_lines line
                   JOIN pos_sales sale ON sale.id=line.sale_id
                    AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
                   JOIN scoped ON scoped.branch_id=line.branch_id
                   LEFT JOIN LATERAL (
                     SELECT entry->>'staffId' AS staff_id,
                            COALESCE((entry->>'percent')::NUMERIC,0)::BIGINT AS percent
                       FROM JSONB_ARRAY_ELEMENTS(
                              CASE WHEN JSONB_TYPEOF(COALESCE(line.staff_splits,'[]'::JSONB))='array'
                                   THEN COALESCE(line.staff_splits,'[]'::JSONB) ELSE '[]'::JSONB END
                            ) AS entry
                      WHERE COALESCE(entry->>'staffId','')<>''
                   ) split ON TRUE
                  WHERE line.tenant_id=$1
                    AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
                    AND COALESCE(sale.finalized_at,sale.created_at)>=$3
                    AND COALESCE(sale.finalized_at,sale.created_at)<$4::DATE+INTERVAL '1 day'
               ) attribution
              WHERE attribution.staff_id IS NOT NULL AND attribution.staff_id<>''
              GROUP BY attribution.staff_id
           ), attendance AS (
             SELECT record.staff_id,
                    COALESCE(SUM(record.worked_minutes),0)::BIGINT AS worked_minutes,
                    COUNT(*) FILTER (WHERE record.status IN ('present','clocked_out','clocked_in','half_day'))::BIGINT
                      AS present_days,
                    COUNT(*) FILTER (WHERE record.late_minutes>0)::BIGINT AS late_days,
                    COUNT(*) FILTER (WHERE record.status='absent')::BIGINT AS absent_days
               FROM staff_attendance_records record
               JOIN roster ON roster.staff_id=record.staff_id AND roster.branch_id=record.branch_id
              WHERE record.tenant_id=$1 AND record.business_date BETWEEN $3 AND $4
              GROUP BY record.staff_id
           ), scheduled AS (
             SELECT schedule.staff_id,
                    COALESCE(SUM(
                      COALESCE(EXTRACT(EPOCH FROM (schedule.shift1_end-schedule.shift1_start))::BIGINT/60,0)
                      + COALESCE(EXTRACT(EPOCH FROM (schedule.shift2_end-schedule.shift2_start))::BIGINT/60,0)
                    ),0)::BIGINT AS scheduled_minutes
               FROM staff_schedules schedule
               JOIN roster ON roster.staff_id=schedule.staff_id AND roster.branch_id=schedule.branch_id
              WHERE schedule.tenant_id=$1 AND schedule.status='working'
                AND schedule.schedule_date BETWEEN $3 AND $4
              GROUP BY schedule.staff_id
           ), feedback AS (
             SELECT appointment.staff_id,
                    COUNT(*)::BIGINT AS feedback_count,
                    COALESCE(SUM(review.rating),0)::BIGINT AS feedback_rating_sum
               FROM customer_booking_reviews review
               JOIN appointments appointment ON appointment.id=review.appointment_id
                AND appointment.tenant_id=review.tenant_id AND appointment.branch_id=review.branch_id
               JOIN roster ON roster.staff_id=appointment.staff_id
                AND roster.branch_id=appointment.branch_id
              WHERE review.tenant_id=$1 AND review.created_at>=$3
                AND review.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY appointment.staff_id
           ), targets AS (
             SELECT target.staff_id,COALESCE(SUM(target.target_count),0)::BIGINT AS target_count
               FROM staff_service_targets target
               JOIN roster ON roster.staff_id=target.staff_id AND roster.branch_id=target.branch_id
              WHERE target.tenant_id=$1 AND target.status='active'
                AND target.starts_on<=$4 AND target.ends_on>=$3
              GROUP BY target.staff_id
           ), consumption AS (
             SELECT usage.staff_id,
                    COALESCE(SUM(usage.actual_quantity-usage.expected_quantity),0)::BIGINT
                      AS consumption_variance_quantity,
                    COALESCE(SUM(GREATEST(usage.actual_quantity-usage.expected_quantity,0)::BIGINT
                      *GREATEST(item.unit_cost_paise,0)),0)::BIGINT AS consumption_variance_cost_paise
               FROM inventory_backbar_usage usage
               JOIN inventory_items item ON item.id=usage.inventory_item_id
                AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
               JOIN roster ON roster.staff_id=usage.staff_id AND roster.branch_id=usage.branch_id
              WHERE usage.tenant_id=$1 AND usage.status<>'rejected'
                AND usage.created_at>=$3 AND usage.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY usage.staff_id
           )
           SELECT roster.staff_id,roster.staff_name,roster.branch_id,roster.branch_name,
                  roster.job_title,
                  COALESCE(appointment_facts.completed_appointments,0)::BIGINT AS completed_appointments,
                  COALESCE(appointment_facts.cancelled_appointments,0)::BIGINT AS cancelled_appointments,
                  COALESCE(appointment_facts.no_show_appointments,0)::BIGINT AS no_show_appointments,
                  COALESCE(appointment_facts.booked_minutes,0)::BIGINT AS booked_minutes,
                  COALESCE(scheduled.scheduled_minutes,0)::BIGINT AS scheduled_minutes,
                  COALESCE(attendance.worked_minutes,0)::BIGINT AS worked_minutes,
                  COALESCE(attendance.present_days,0)::BIGINT AS present_days,
                  COALESCE(attendance.late_days,0)::BIGINT AS late_days,
                  COALESCE(attendance.absent_days,0)::BIGINT AS absent_days,
                  COALESCE(sale_facts.service_revenue_paise,0)::BIGINT AS service_revenue_paise,
                  COALESCE(sale_facts.product_revenue_paise,0)::BIGINT AS product_revenue_paise,
                  COALESCE(sale_facts.invoice_count,0)::BIGINT AS invoice_count,
                  COALESCE(appointment_facts.unique_clients,0)::BIGINT AS unique_clients,
                  COALESCE(rebooking.rebooked_clients,0)::BIGINT AS rebooked_clients,
                  COALESCE(returning_clients.returning_clients,0)::BIGINT AS returning_clients,
                  COALESCE(duration_variance.service_duration_variance_minutes,0)::BIGINT
                    AS service_duration_variance_minutes,
                  COALESCE(feedback.feedback_count,0)::BIGINT AS feedback_count,
                  COALESCE(feedback.feedback_rating_sum,0)::BIGINT AS feedback_rating_sum,
                  COALESCE(targets.target_count,0)::BIGINT AS target_count,
                  COALESCE(consumption.consumption_variance_quantity,0)::BIGINT
                    AS consumption_variance_quantity,
                  COALESCE(consumption.consumption_variance_cost_paise,0)::BIGINT
                    AS consumption_variance_cost_paise
             FROM roster
             LEFT JOIN appointment_facts ON appointment_facts.staff_id=roster.staff_id
             LEFT JOIN duration_variance ON duration_variance.staff_id=roster.staff_id
             LEFT JOIN rebooking ON rebooking.staff_id=roster.staff_id
             LEFT JOIN returning_clients ON returning_clients.staff_id=roster.staff_id
             LEFT JOIN sale_facts ON sale_facts.staff_id=roster.staff_id
             LEFT JOIN attendance ON attendance.staff_id=roster.staff_id
             LEFT JOIN scheduled ON scheduled.staff_id=roster.staff_id
             LEFT JOIN feedback ON feedback.staff_id=roster.staff_id
             LEFT JOIN targets ON targets.staff_id=roster.staff_id
             LEFT JOIN consumption ON consumption.staff_id=roster.staff_id
            ORDER BY roster.branch_name,roster.staff_name
            LIMIT 500"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .bind(staff_id_filter.unwrap_or_default())
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumptionVarianceRow {
    pub branch_id: String,
    pub branch_name: String,
    pub group_id: String,
    pub group_name: String,
    pub unit: String,
    pub usage_events: i64,
    pub linked_appointment_count: i64,
    pub expected_quantity: i64,
    pub actual_quantity: i64,
    pub variance_quantity: i64,
    pub variance_cost_paise: i64,
}

/// How the variance report groups recorded consumption.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsumptionGrouping {
    Service,
    Product,
    Staff,
}

/// Expected-versus-actual product consumption from the backbar usage ledger.
///
/// Expected quantity comes from the service recipe captured on each usage row;
/// actual quantity is what was recorded against the completed service. Variance
/// cost values only the extra quantity, at the product's unit cost.
pub async fn consumption_variance(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
    grouping: ConsumptionGrouping,
) -> Result<Vec<ConsumptionVarianceRow>, sqlx::Error> {
    let (group_id, group_name, group_join) = match grouping {
        ConsumptionGrouping::Service => (
            "COALESCE(usage.service_id,'')",
            "COALESCE(service.name,'Unlinked service')",
            r#"LEFT JOIN services service ON service.id=usage.service_id
                AND service.tenant_id=usage.tenant_id AND service.branch_id=usage.branch_id"#,
        ),
        ConsumptionGrouping::Product => (
            "usage.inventory_item_id",
            "item.name",
            "",
        ),
        ConsumptionGrouping::Staff => (
            "COALESCE(usage.staff_id,'')",
            "COALESCE(BTRIM(CONCAT_WS(' ',member.first_name,NULLIF(member.last_name,''))),'Unassigned')",
            r#"LEFT JOIN staff member ON member.id=usage.staff_id
                AND member.tenant_id=usage.tenant_id AND member.branch_id=usage.branch_id"#,
        ),
    };

    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           )
           SELECT usage.branch_id,scoped.branch_name,
                  {group_id} AS group_id,
                  {group_name} AS group_name,
                  MIN(usage.unit) AS unit,
                  COUNT(*)::BIGINT AS usage_events,
                  COUNT(*) FILTER (WHERE COALESCE(usage.appointment_id,'')<>'')::BIGINT
                    AS linked_appointment_count,
                  COALESCE(SUM(usage.expected_quantity),0)::BIGINT AS expected_quantity,
                  COALESCE(SUM(usage.actual_quantity),0)::BIGINT AS actual_quantity,
                  COALESCE(SUM(usage.actual_quantity-usage.expected_quantity),0)::BIGINT
                    AS variance_quantity,
                  COALESCE(SUM(GREATEST(usage.actual_quantity-usage.expected_quantity,0)::BIGINT
                    *GREATEST(item.unit_cost_paise,0)),0)::BIGINT AS variance_cost_paise
             FROM inventory_backbar_usage usage
             JOIN scoped ON scoped.branch_id=usage.branch_id
             JOIN inventory_items item ON item.id=usage.inventory_item_id
              AND item.tenant_id=usage.tenant_id AND item.branch_id=usage.branch_id
             {group_join}
            WHERE usage.tenant_id=$1 AND usage.status<>'rejected'
              AND usage.created_at>=$3 AND usage.created_at<$4::DATE+INTERVAL '1 day'
            GROUP BY usage.branch_id,scoped.branch_name,{group_id},{group_name}
            ORDER BY variance_cost_paise DESC,variance_quantity DESC
            LIMIT 200"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumptionCoverageRow {
    pub completed_services: i64,
    pub recipe_backed_services: i64,
    pub recorded_usage_events: i64,
    pub appointment_linked_usage_events: i64,
}

/// Data-sufficiency check for consumption answers.
///
/// If a branch only auto-deducts from recipes and never records actual usage,
/// expected consumption is knowable but real over-usage is not. The copilot uses
/// this to say so instead of implying a variance it cannot measure.
pub async fn consumption_coverage(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<ConsumptionCoverageRow, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH completed AS (
             SELECT appointment.id,appointment.branch_id,booked_service.service_id
               FROM appointments appointment
               JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(
                      CASE WHEN JSONB_TYPEOF(
                             COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB)='array'
                           THEN COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB
                           ELSE '[]'::JSONB END
                    ) AS booked_service(service_id) ON TRUE
              WHERE appointment.tenant_id=$1 AND appointment.branch_id=ANY($2::TEXT[])
                AND appointment.status IN {COMPLETED_APPOINTMENT_STATUSES}
                AND appointment.start_at>=$3
                AND appointment.start_at<$4::DATE+INTERVAL '1 day'
           )
           SELECT (SELECT COUNT(*) FROM completed)::BIGINT AS completed_services,
                  (SELECT COUNT(*) FROM completed
                     JOIN services service ON service.id=completed.service_id
                      AND service.tenant_id=$1 AND service.branch_id=completed.branch_id
                    WHERE JSONB_TYPEOF(COALESCE(service.product_consumption_json,'[]'::JSONB))='array'
                      AND JSONB_ARRAY_LENGTH(COALESCE(service.product_consumption_json,'[]'::JSONB))>0
                  )::BIGINT AS recipe_backed_services,
                  (SELECT COUNT(*) FROM inventory_backbar_usage usage
                    WHERE usage.tenant_id=$1 AND usage.branch_id=ANY($2::TEXT[])
                      AND usage.status<>'rejected'
                      AND usage.created_at>=$3
                      AND usage.created_at<$4::DATE+INTERVAL '1 day')::BIGINT
                    AS recorded_usage_events,
                  (SELECT COUNT(*) FROM inventory_backbar_usage usage
                    WHERE usage.tenant_id=$1 AND usage.branch_id=ANY($2::TEXT[])
                      AND usage.status<>'rejected'
                      AND COALESCE(usage.appointment_id,'')<>''
                      AND usage.created_at>=$3
                      AND usage.created_at<$4::DATE+INTERVAL '1 day')::BIGINT
                    AS appointment_linked_usage_events"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_one(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDemandRow {
    pub branch_id: String,
    pub branch_name: String,
    pub service_id: String,
    pub service_name: String,
    pub category: String,
    pub booked_count: i64,
    pub completed_count: i64,
    pub revenue_paise: i64,
}

/// Service demand and revenue by branch for one period.
pub async fn service_demand(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<ServiceDemandRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), booked AS (
             SELECT appointment.branch_id,booked_service.service_id,
                    COUNT(*)::BIGINT AS booked_count,
                    COUNT(*) FILTER (WHERE appointment.status IN {COMPLETED_APPOINTMENT_STATUSES})::BIGINT
                      AS completed_count
               FROM appointments appointment
               JOIN scoped ON scoped.branch_id=appointment.branch_id
               JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(
                      CASE WHEN JSONB_TYPEOF(
                             COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB)='array'
                           THEN COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB
                           ELSE '[]'::JSONB END
                    ) AS booked_service(service_id) ON TRUE
              WHERE appointment.tenant_id=$1
                AND appointment.start_at>=$3
                AND appointment.start_at<$4::DATE+INTERVAL '1 day'
              GROUP BY appointment.branch_id,booked_service.service_id
           ), billed AS (
             SELECT line.branch_id,line.item_id AS service_id,
                    COALESCE(SUM(line.line_total_paise),0)::BIGINT AS revenue_paise
               FROM pos_sale_lines line
               JOIN pos_sales sale ON sale.id=line.sale_id
                AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
               JOIN scoped ON scoped.branch_id=line.branch_id
              WHERE line.tenant_id=$1 AND line.line_type='service'
                AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
                AND COALESCE(sale.finalized_at,sale.created_at)>=$3
                AND COALESCE(sale.finalized_at,sale.created_at)<$4::DATE+INTERVAL '1 day'
              GROUP BY line.branch_id,line.item_id
           )
           SELECT service.branch_id,scoped.branch_name,service.id AS service_id,
                  service.name AS service_name,service.category,
                  COALESCE(booked.booked_count,0)::BIGINT AS booked_count,
                  COALESCE(booked.completed_count,0)::BIGINT AS completed_count,
                  COALESCE(billed.revenue_paise,0)::BIGINT AS revenue_paise
             FROM services service
             JOIN scoped ON scoped.branch_id=service.branch_id
             LEFT JOIN booked ON booked.branch_id=service.branch_id
              AND booked.service_id=service.id
             LEFT JOIN billed ON billed.branch_id=service.branch_id
              AND billed.service_id=service.id
            WHERE service.tenant_id=$1 AND service.active=TRUE
              AND (COALESCE(booked.booked_count,0)>0 OR COALESCE(billed.revenue_paise,0)>0)
            ORDER BY revenue_paise DESC,booked_count DESC
            LIMIT 300"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StockPositionRow {
    pub branch_id: String,
    pub branch_name: String,
    pub inventory_item_id: String,
    pub product_name: String,
    pub sku: String,
    pub unit: String,
    pub stock_quantity: i64,
    pub reorder_point: i64,
    pub unit_cost_paise: i64,
    pub consumed_quantity: i64,
    pub sold_quantity: i64,
}

/// Stock position with the period's real outflow, so reorder advice is based on
/// observed consumption rather than a static reorder point alone.
pub async fn stock_positions(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
    only_at_risk: bool,
) -> Result<Vec<StockPositionRow>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), consumed AS (
             SELECT usage.branch_id,usage.inventory_item_id,
                    COALESCE(SUM(usage.actual_quantity),0)::BIGINT AS consumed_quantity
               FROM inventory_backbar_usage usage
               JOIN scoped ON scoped.branch_id=usage.branch_id
              WHERE usage.tenant_id=$1 AND usage.status<>'rejected'
                AND usage.created_at>=$3 AND usage.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY usage.branch_id,usage.inventory_item_id
           ), sold AS (
             SELECT ledger.branch_id,ledger.inventory_item_id,
                    COALESCE(SUM(ABS(ledger.quantity_delta)),0)::BIGINT AS sold_quantity
               FROM inventory_stock_ledger ledger
               JOIN scoped ON scoped.branch_id=ledger.branch_id
              WHERE ledger.tenant_id=$1 AND ledger.movement_type='sale'
                AND ledger.created_at>=$3 AND ledger.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY ledger.branch_id,ledger.inventory_item_id
           )
           SELECT item.branch_id,scoped.branch_name,item.id AS inventory_item_id,
                  item.name AS product_name,item.sku,item.unit,
                  item.stock_quantity::BIGINT AS stock_quantity,
                  item.reorder_point::BIGINT AS reorder_point,
                  item.unit_cost_paise,
                  COALESCE(consumed.consumed_quantity,0)::BIGINT AS consumed_quantity,
                  COALESCE(sold.sold_quantity,0)::BIGINT AS sold_quantity
             FROM inventory_items item
             JOIN scoped ON scoped.branch_id=item.branch_id
             LEFT JOIN consumed ON consumed.branch_id=item.branch_id
              AND consumed.inventory_item_id=item.id
             LEFT JOIN sold ON sold.branch_id=item.branch_id
              AND sold.inventory_item_id=item.id
            WHERE item.tenant_id=$1 AND item.active=TRUE
              AND (NOT $5 OR item.stock_quantity<=item.reorder_point)
            ORDER BY (item.stock_quantity-item.reorder_point),item.name
            LIMIT 300"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .bind(only_at_risk)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientRetentionRow {
    pub branch_id: String,
    pub branch_name: String,
    pub visiting_clients: i64,
    pub new_clients: i64,
    pub returning_clients: i64,
    pub lapsed_clients: i64,
    pub churn_risk_clients: i64,
}

/// Retention and churn signals per branch.
///
/// `lapsed_clients` visited before the window but not inside it;
/// `churn_risk_clients` have had no completed visit for 90 days.
pub async fn client_retention(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<ClientRetentionRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), visits AS (
             SELECT appointment.branch_id,appointment.client_id,
                    MAX(appointment.start_at) AS last_visit_at,
                    BOOL_OR(appointment.start_at>=$3
                      AND appointment.start_at<$4::DATE+INTERVAL '1 day') AS visited_in_period,
                    BOOL_OR(appointment.start_at<$3) AS visited_before
               FROM appointments appointment
               JOIN scoped ON scoped.branch_id=appointment.branch_id
              WHERE appointment.tenant_id=$1
                AND appointment.status IN {COMPLETED_APPOINTMENT_STATUSES}
              GROUP BY appointment.branch_id,appointment.client_id
           )
           SELECT scoped.branch_id,scoped.branch_name,
                  COUNT(*) FILTER (WHERE visits.visited_in_period)::BIGINT AS visiting_clients,
                  COUNT(*) FILTER (WHERE visits.visited_in_period
                    AND NOT visits.visited_before)::BIGINT AS new_clients,
                  COUNT(*) FILTER (WHERE visits.visited_in_period
                    AND visits.visited_before)::BIGINT AS returning_clients,
                  COUNT(*) FILTER (WHERE NOT visits.visited_in_period
                    AND visits.visited_before)::BIGINT AS lapsed_clients,
                  COUNT(*) FILTER (WHERE visits.last_visit_at
                    < ($4::DATE+INTERVAL '1 day')-INTERVAL '90 days')::BIGINT AS churn_risk_clients
             FROM scoped
             LEFT JOIN visits ON visits.branch_id=scoped.branch_id
            GROUP BY scoped.branch_id,scoped.branch_name
            ORDER BY scoped.branch_name"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipExpiryRow {
    pub branch_id: String,
    pub branch_name: String,
    pub membership_id: String,
    pub membership_name: String,
    pub expiring_count: i64,
    pub expired_count: i64,
    pub active_count: i64,
}

/// Membership renewal exposure inside a look-ahead window.
pub async fn membership_expiry(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    look_ahead_days: i32,
) -> Result<Vec<MembershipExpiryRow>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           )
           SELECT assignment.branch_id,scoped.branch_name,
                  assignment.membership_id,plan.name AS membership_name,
                  COUNT(*) FILTER (WHERE assignment.active
                    AND assignment.expires_at IS NOT NULL
                    AND assignment.expires_at>=NOW()
                    AND assignment.expires_at<NOW()+MAKE_INTERVAL(days => $3::INT))::BIGINT AS expiring_count,
                  COUNT(*) FILTER (WHERE assignment.expires_at IS NOT NULL
                    AND assignment.expires_at<NOW())::BIGINT AS expired_count,
                  COUNT(*) FILTER (WHERE assignment.active)::BIGINT AS active_count
             FROM client_memberships assignment
             JOIN scoped ON scoped.branch_id=assignment.branch_id
             JOIN memberships plan ON plan.id=assignment.membership_id
              AND plan.tenant_id=assignment.tenant_id
            WHERE assignment.tenant_id=$1
            GROUP BY assignment.branch_id,scoped.branch_name,assignment.membership_id,plan.name
           HAVING COUNT(*) FILTER (WHERE assignment.active)>0
            ORDER BY expiring_count DESC,scoped.branch_name
            LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(look_ahead_days)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSummaryRow {
    pub branch_id: String,
    pub branch_name: String,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub tax_paise: i64,
    pub refund_paise: i64,
    pub collected_paise: i64,
    pub outstanding_paise: i64,
    pub product_cost_paise: i64,
    pub expense_paise: i64,
}

/// Finance rollup for the authorized branches. Gated behind `finance.read`.
pub async fn finance_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<FinanceSummaryRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), sales AS (
             SELECT sale.branch_id,
                    COALESCE(SUM(sale.total_paise),0)::BIGINT AS revenue_paise,
                    COALESCE(SUM(sale.discount_paise),0)::BIGINT AS discount_paise,
                    COALESCE(SUM(sale.tax_paise),0)::BIGINT AS tax_paise,
                    COALESCE(SUM(sale.paid_paise),0)::BIGINT AS collected_paise,
                    COALESCE(SUM(GREATEST(sale.total_paise-sale.paid_paise,0)),0)::BIGINT
                      AS outstanding_paise
               FROM pos_sales sale
               JOIN scoped ON scoped.branch_id=sale.branch_id
              WHERE sale.tenant_id=$1
                AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
                AND COALESCE(sale.finalized_at,sale.created_at)>=$3
                AND COALESCE(sale.finalized_at,sale.created_at)<$4::DATE+INTERVAL '1 day'
              GROUP BY sale.branch_id
           ), refunds AS (
             SELECT refund.branch_id,COALESCE(SUM(refund.amount_paise),0)::BIGINT AS refund_paise
               FROM pos_invoice_refunds refund
               JOIN scoped ON scoped.branch_id=refund.branch_id
              WHERE refund.tenant_id=$1 AND refund.created_at>=$3
                AND refund.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY refund.branch_id
           ), product_cost AS (
             SELECT ledger.branch_id,
                    COALESCE(SUM(ABS(ledger.quantity_delta)::BIGINT*GREATEST(ledger.unit_cost_paise,0)),0)::BIGINT
                      AS product_cost_paise
               FROM inventory_stock_ledger ledger
               JOIN scoped ON scoped.branch_id=ledger.branch_id
              WHERE ledger.tenant_id=$1 AND ledger.movement_type='sale'
                AND ledger.created_at>=$3 AND ledger.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY ledger.branch_id
           ), expenses AS (
             SELECT voucher.branch_id,
                    COALESCE(SUM(line.amount_paise),0)::BIGINT AS expense_paise
               FROM outgoing_fund_vouchers voucher
               JOIN outgoing_fund_lines line ON line.voucher_id=voucher.id
                AND line.tenant_id=voucher.tenant_id AND line.branch_id=voucher.branch_id
               JOIN scoped ON scoped.branch_id=voucher.branch_id
              WHERE voucher.tenant_id=$1
                AND voucher.status NOT IN ('draft','rejected','cancelled','reversed')
                AND voucher.business_date BETWEEN $3 AND $4
              GROUP BY voucher.branch_id
           )
           SELECT scoped.branch_id,scoped.branch_name,
                  COALESCE(sales.revenue_paise,0)::BIGINT AS revenue_paise,
                  COALESCE(sales.discount_paise,0)::BIGINT AS discount_paise,
                  COALESCE(sales.tax_paise,0)::BIGINT AS tax_paise,
                  COALESCE(refunds.refund_paise,0)::BIGINT AS refund_paise,
                  COALESCE(sales.collected_paise,0)::BIGINT AS collected_paise,
                  COALESCE(sales.outstanding_paise,0)::BIGINT AS outstanding_paise,
                  COALESCE(product_cost.product_cost_paise,0)::BIGINT AS product_cost_paise,
                  COALESCE(expenses.expense_paise,0)::BIGINT AS expense_paise
             FROM scoped
             LEFT JOIN sales ON sales.branch_id=scoped.branch_id
             LEFT JOIN refunds ON refunds.branch_id=scoped.branch_id
             LEFT JOIN product_cost ON product_cost.branch_id=scoped.branch_id
             LEFT JOIN expenses ON expenses.branch_id=scoped.branch_id
            ORDER BY scoped.branch_name"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LapsingClientRow {
    pub branch_id: String,
    pub branch_name: String,
    pub client_id: String,
    pub client_name: String,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub days_since_visit: i64,
    pub completed_visits: i64,
    pub lifetime_value_paise: i64,
    pub membership_id: String,
    pub membership_name: String,
    pub membership_expires_at: Option<DateTime<Utc>>,
    pub membership_active: bool,
}

/// Clients drifting away, with the membership each one holds.
///
/// One statement rather than a per-client lookup, so a lapse list of any size
/// costs a single round trip and the membership shown is always the client's
/// current one.
pub async fn lapsing_clients(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    lapse_after_days: i32,
    limit: i64,
) -> Result<Vec<LapsingClientRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), visits AS (
             SELECT appointment.branch_id,appointment.client_id,
                    MAX(appointment.start_at) AS last_visit_at,
                    COUNT(*)::BIGINT AS completed_visits
               FROM appointments appointment
               JOIN scoped ON scoped.branch_id=appointment.branch_id
              WHERE appointment.tenant_id=$1
                AND appointment.status IN {COMPLETED_APPOINTMENT_STATUSES}
              GROUP BY appointment.branch_id,appointment.client_id
           ), spend AS (
             SELECT sale.branch_id,sale.client_id,
                    COALESCE(SUM(sale.total_paise),0)::BIGINT AS lifetime_value_paise
               FROM pos_sales sale
               JOIN scoped ON scoped.branch_id=sale.branch_id
              WHERE sale.tenant_id=$1
                AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
              GROUP BY sale.branch_id,sale.client_id
           )
           SELECT visits.branch_id,scoped.branch_name,visits.client_id,
                  BTRIM(CONCAT_WS(' ',client.first_name,NULLIF(client.last_name,''))) AS client_name,
                  visits.last_visit_at,
                  GREATEST(EXTRACT(DAY FROM (NOW()-visits.last_visit_at))::BIGINT,0) AS days_since_visit,
                  visits.completed_visits,
                  COALESCE(spend.lifetime_value_paise,0)::BIGINT AS lifetime_value_paise,
                  COALESCE(membership.membership_id,'') AS membership_id,
                  COALESCE(plan.name,'') AS membership_name,
                  membership.expires_at AS membership_expires_at,
                  COALESCE(membership.active,FALSE) AS membership_active
             FROM visits
             JOIN scoped ON scoped.branch_id=visits.branch_id
             JOIN clients client ON client.id=visits.client_id
              AND client.tenant_id=$1 AND client.branch_id=visits.branch_id
              AND client.active=TRUE AND client.merged_into_client_id IS NULL
             LEFT JOIN spend ON spend.branch_id=visits.branch_id
              AND spend.client_id=visits.client_id
             LEFT JOIN LATERAL (
               SELECT assignment.membership_id,assignment.expires_at,assignment.active
                 FROM client_memberships assignment
                WHERE assignment.tenant_id=$1
                  AND assignment.branch_id=visits.branch_id
                  AND assignment.client_id=visits.client_id
                ORDER BY assignment.active DESC,assignment.assigned_at DESC
                LIMIT 1
             ) membership ON TRUE
             LEFT JOIN memberships plan ON plan.id=membership.membership_id
              AND plan.tenant_id=$1
            WHERE visits.last_visit_at < NOW()-MAKE_INTERVAL(days => $3::INT)
            ORDER BY COALESCE(spend.lifetime_value_paise,0) DESC,visits.last_visit_at
            LIMIT $4"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(lapse_after_days)
    .bind(limit)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageUtilizationRow {
    pub branch_id: String,
    pub branch_name: String,
    pub package_id: String,
    pub package_name: String,
    pub sold_credits: i64,
    pub remaining_credits: i64,
    pub redeemed_quantity: i64,
    pub expiring_credits: i64,
}

/// Package credit sales against redemption, so unused liability is visible.
pub async fn package_utilization(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<PackageUtilizationRow>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), credits AS (
             SELECT credit.branch_id,credit.package_id,
                    MIN(credit.package_name) AS package_name,
                    COALESCE(SUM(credit.total_qty),0)::BIGINT AS sold_credits,
                    COALESCE(SUM(credit.remaining_qty) FILTER (WHERE credit.active),0)::BIGINT
                      AS remaining_credits,
                    COALESCE(SUM(credit.remaining_qty) FILTER (
                      WHERE credit.active AND credit.expires_at IS NOT NULL
                        AND credit.expires_at<=$4),0)::BIGINT AS expiring_credits
               FROM client_package_credits credit
               JOIN scoped ON scoped.branch_id=credit.branch_id
              WHERE credit.tenant_id=$1
              GROUP BY credit.branch_id,credit.package_id
           ), redeemed AS (
             SELECT redemption.branch_id,redemption.package_id,
                    COALESCE(SUM(redemption.quantity),0)::BIGINT AS redeemed_quantity
               FROM pos_package_redemptions redemption
               JOIN scoped ON scoped.branch_id=redemption.branch_id
              WHERE redemption.tenant_id=$1 AND redemption.created_at>=$3
                AND redemption.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY redemption.branch_id,redemption.package_id
           )
           SELECT credits.branch_id,scoped.branch_name,credits.package_id,
                  COALESCE(NULLIF(credits.package_name,''),plan.name,'Package') AS package_name,
                  credits.sold_credits,credits.remaining_credits,
                  COALESCE(redeemed.redeemed_quantity,0)::BIGINT AS redeemed_quantity,
                  credits.expiring_credits
             FROM credits
             JOIN scoped ON scoped.branch_id=credits.branch_id
             LEFT JOIN packages plan ON plan.id=credits.package_id
              AND plan.tenant_id=$1 AND plan.branch_id=credits.branch_id
             LEFT JOIN redeemed ON redeemed.branch_id=credits.branch_id
              AND redeemed.package_id=credits.package_id
            ORDER BY credits.remaining_credits DESC
            LIMIT 200"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferPerformanceRow {
    pub branch_id: String,
    pub branch_name: String,
    pub offer_id: String,
    pub offer_code: String,
    pub active: bool,
    pub view_count: i64,
    pub click_count: i64,
    pub used_count: i64,
    pub discount_given_paise: i64,
}

/// Offer reach against realised discount, for campaign and margin questions.
pub async fn offer_performance(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    start_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<OfferPerformanceRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"WITH scoped AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name
               FROM branches branch
               JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
                AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
           ), reach AS (
             SELECT event.branch_id,event.offer_id,
                    COUNT(*) FILTER (WHERE event.event_type='view')::BIGINT AS view_count,
                    COUNT(*) FILTER (WHERE event.event_type='click')::BIGINT AS click_count
               FROM marketing_offer_events event
               JOIN scoped ON scoped.branch_id=event.branch_id
              WHERE event.tenant_id=$1 AND event.created_at>=$3
                AND event.created_at<$4::DATE+INTERVAL '1 day'
              GROUP BY event.branch_id,event.offer_id
           ), realised AS (
             SELECT sale.branch_id,LOWER(sale.coupon_code) AS offer_code,
                    COUNT(*)::BIGINT AS used_count,
                    COALESCE(SUM(sale.coupon_discount_paise),0)::BIGINT AS discount_given_paise
               FROM pos_sales sale
               JOIN scoped ON scoped.branch_id=sale.branch_id
              WHERE sale.tenant_id=$1 AND COALESCE(sale.coupon_code,'')<>''
                AND sale.status NOT IN {NON_REVENUE_SALE_STATUSES}
                AND COALESCE(sale.finalized_at,sale.created_at)>=$3
                AND COALESCE(sale.finalized_at,sale.created_at)<$4::DATE+INTERVAL '1 day'
              GROUP BY sale.branch_id,LOWER(sale.coupon_code)
           )
           SELECT coupon.branch_id,scoped.branch_name,coupon.id AS offer_id,
                  coupon.code AS offer_code,coupon.active,
                  COALESCE(reach.view_count,0)::BIGINT AS view_count,
                  COALESCE(reach.click_count,0)::BIGINT AS click_count,
                  COALESCE(realised.used_count,0)::BIGINT AS used_count,
                  COALESCE(realised.discount_given_paise,0)::BIGINT AS discount_given_paise
             FROM pos_coupons coupon
             JOIN scoped ON scoped.branch_id=coupon.branch_id
             LEFT JOIN reach ON reach.branch_id=coupon.branch_id AND reach.offer_id=coupon.id
             LEFT JOIN realised ON realised.branch_id=coupon.branch_id
              AND realised.offer_code=LOWER(coupon.code)
            WHERE coupon.tenant_id=$1
              AND (COALESCE(reach.view_count,0)>0 OR COALESCE(realised.used_count,0)>0
                   OR coupon.active)
            ORDER BY used_count DESC,view_count DESC
            LIMIT 200"#
    ))
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(start_date)
    .bind(end_date)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCopilotAlertRecord {
    pub id: String,
    pub branch_id: String,
    pub scope_level: String,
    pub scope_label: String,
    pub alert_type: String,
    pub severity: String,
    pub subject_type: String,
    pub subject_id: String,
    pub subject_name: String,
    pub title: String,
    pub detail: String,
    pub metrics_json: serde_json::Value,
    pub confidence: f64,
    pub required_permission: String,
    pub fingerprint: String,
    pub period_start: Option<NaiveDate>,
    pub period_end: Option<NaiveDate>,
    pub status: String,
    pub occurrence_count: i32,
    pub last_seen_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

/// One proactive alert detection, ready to persist.
pub struct AlertUpsert<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub scope_level: &'a str,
    pub scope_label: &'a str,
    pub alert_type: &'a str,
    pub severity: &'a str,
    pub subject_type: &'a str,
    pub subject_id: &'a str,
    pub subject_name: &'a str,
    pub title: &'a str,
    pub detail: &'a str,
    pub metrics_json: serde_json::Value,
    pub confidence: f64,
    pub required_permission: &'a str,
    pub fingerprint: &'a str,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
}

/// Insert an alert, or refresh the open one carrying the same fingerprint.
///
/// Re-detection bumps `occurrence_count` and `last_seen_at` instead of creating a
/// duplicate row, which is what keeps a recurring condition from spamming the feed.
pub async fn upsert_alert(
    db: &PgPool,
    alert: AlertUpsert<'_>,
) -> Result<AiCopilotAlertRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_copilot_alerts (
             tenant_id,branch_id,scope_level,scope_label,alert_type,severity,subject_type,
             subject_id,subject_name,title,detail,metrics_json,confidence,required_permission,
             fingerprint,period_start,period_end
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (tenant_id,branch_id,fingerprint) WHERE status IN ('open','acknowledged')
           DO UPDATE SET severity=EXCLUDED.severity,
                         title=EXCLUDED.title,
                         detail=EXCLUDED.detail,
                         metrics_json=EXCLUDED.metrics_json,
                         confidence=EXCLUDED.confidence,
                         period_start=EXCLUDED.period_start,
                         period_end=EXCLUDED.period_end,
                         occurrence_count=ai_copilot_alerts.occurrence_count+1,
                         last_seen_at=NOW(),
                         updated_at=NOW()
           RETURNING id,branch_id,scope_level,scope_label,alert_type,severity,subject_type,
                     subject_id,subject_name,title,detail,metrics_json,confidence::FLOAT8 AS confidence,
                     required_permission,fingerprint,period_start,period_end,status,
                     occurrence_count,last_seen_at,created_at"#,
    )
    .bind(alert.tenant_id)
    .bind(alert.branch_id)
    .bind(alert.scope_level)
    .bind(alert.scope_label)
    .bind(alert.alert_type)
    .bind(alert.severity)
    .bind(alert.subject_type)
    .bind(alert.subject_id)
    .bind(alert.subject_name)
    .bind(alert.title)
    .bind(alert.detail)
    .bind(alert.metrics_json)
    .bind(alert.confidence)
    .bind(alert.required_permission)
    .bind(alert.fingerprint)
    .bind(alert.period_start)
    .bind(alert.period_end)
    .fetch_one(db)
    .await
}

/// Alerts the caller may see: scoped to their authorized branches, and further
/// filtered to the alert kinds their permissions cover.
pub async fn list_alerts(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    allowed_permissions: &[String],
    status: &str,
    limit: i64,
) -> Result<Vec<AiCopilotAlertRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,scope_level,scope_label,alert_type,severity,subject_type,
                  subject_id,subject_name,title,detail,metrics_json,confidence::FLOAT8 AS confidence,
                  required_permission,fingerprint,period_start,period_end,status,
                  occurrence_count,last_seen_at,created_at
             FROM ai_copilot_alerts
            WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
              AND ($4='' OR status=$4)
              AND (required_permission='' OR required_permission=ANY($3::TEXT[]))
            ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                     last_seen_at DESC
            LIMIT $5"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(allowed_permissions)
    .bind(status)
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Acknowledge or resolve an alert inside the caller's scope.
pub async fn set_alert_status(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    alert_id: &str,
    status: &str,
    actor: &str,
) -> Result<Option<AiCopilotAlertRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE ai_copilot_alerts
              SET status=$4,
                  acknowledged_by=$5,
                  acknowledged_at=NOW(),
                  updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND id=$3
              AND status IN ('open','acknowledged')
           RETURNING id,branch_id,scope_level,scope_label,alert_type,severity,subject_type,
                     subject_id,subject_name,title,detail,metrics_json,confidence::FLOAT8 AS confidence,
                     required_permission,fingerprint,period_start,period_end,status,
                     occurrence_count,last_seen_at,created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(alert_id)
    .bind(status)
    .bind(actor)
    .fetch_optional(db)
    .await
}

#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCopilotApprovalRecord {
    pub id: String,
    pub branch_id: String,
    pub action_type: String,
    pub approval_mode: String,
    pub title: String,
    pub summary: String,
    pub payload_json: serde_json::Value,
    pub scope_level: String,
    pub scope_label: String,
    pub required_permission: String,
    pub status: String,
    pub requested_by: String,
    pub requested_role: String,
    pub decided_by: String,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_note: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// A copilot-proposed action awaiting its governance decision.
pub struct ApprovalInsert<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub action_type: &'a str,
    pub approval_mode: &'a str,
    pub title: &'a str,
    pub summary: &'a str,
    pub payload_json: serde_json::Value,
    pub scope_level: &'a str,
    pub scope_label: &'a str,
    pub required_permission: &'a str,
    pub status: &'a str,
    pub requested_by: &'a str,
    pub requested_role: &'a str,
    pub decided_by: &'a str,
    pub expires_in_hours: i32,
}

pub async fn insert_approval(
    db: &PgPool,
    approval: ApprovalInsert<'_>,
) -> Result<AiCopilotApprovalRecord, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO ai_copilot_approvals (
             tenant_id,branch_id,action_type,approval_mode,title,summary,payload_json,
             scope_level,scope_label,required_permission,status,requested_by,requested_role,
             decided_by,decided_at,expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             CASE WHEN $11='pending' THEN NULL ELSE NOW() END,
             CASE WHEN $15::INT>0 THEN NOW()+MAKE_INTERVAL(hours => $15::INT) ELSE NULL END)
           RETURNING id,branch_id,action_type,approval_mode,title,summary,payload_json,
                     scope_level,scope_label,required_permission,status,requested_by,
                     requested_role,decided_by,decided_at,decision_note,expires_at,created_at"#,
    )
    .bind(approval.tenant_id)
    .bind(approval.branch_id)
    .bind(approval.action_type)
    .bind(approval.approval_mode)
    .bind(approval.title)
    .bind(approval.summary)
    .bind(approval.payload_json)
    .bind(approval.scope_level)
    .bind(approval.scope_label)
    .bind(approval.required_permission)
    .bind(approval.status)
    .bind(approval.requested_by)
    .bind(approval.requested_role)
    .bind(approval.decided_by)
    .bind(approval.expires_in_hours)
    .fetch_one(db)
    .await
}

pub async fn list_approvals(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    status: &str,
    limit: i64,
) -> Result<Vec<AiCopilotApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,action_type,approval_mode,title,summary,payload_json,
                  scope_level,scope_label,required_permission,status,requested_by,
                  requested_role,decided_by,decided_at,decision_note,expires_at,created_at
             FROM ai_copilot_approvals
            WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
              AND ($3='' OR status=$3)
            ORDER BY created_at DESC
            LIMIT $4"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(status)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn approval_by_id(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    approval_id: &str,
) -> Result<Option<AiCopilotApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,branch_id,action_type,approval_mode,title,summary,payload_json,
                  scope_level,scope_label,required_permission,status,requested_by,
                  requested_role,decided_by,decided_at,decision_note,expires_at,created_at
             FROM ai_copilot_approvals
            WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(approval_id)
    .fetch_optional(db)
    .await
}

/// Record an approve/reject decision. Only pending, unexpired rows can move.
pub async fn decide_approval(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    approval_id: &str,
    status: &str,
    decided_by: &str,
    decision_note: &str,
) -> Result<Option<AiCopilotApprovalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE ai_copilot_approvals
              SET status=$4,decided_by=$5,decision_note=$6,decided_at=NOW(),updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND id=$3
              AND status='pending'
              AND (expires_at IS NULL OR expires_at>NOW())
           RETURNING id,branch_id,action_type,approval_mode,title,summary,payload_json,
                     scope_level,scope_label,required_permission,status,requested_by,
                     requested_role,decided_by,decided_at,decision_note,expires_at,created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_ids)
    .bind(approval_id)
    .bind(status)
    .bind(decided_by)
    .bind(decision_note)
    .fetch_optional(db)
    .await
}

/// Audit trail entry written for every copilot answer.
pub struct ScopeAuditInsert<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub user_id: &'a str,
    pub role_name: &'a str,
    pub scope_level: &'a str,
    pub scope_label: &'a str,
    pub requested_scope_level: &'a str,
    pub requested_scope_label: &'a str,
    pub narrowed: bool,
    pub authorized_branch_ids: &'a [String],
    pub denied_branch_ids: &'a [String],
    pub tool_name: &'a str,
    pub domain: &'a str,
    pub language_code: &'a str,
    pub question: &'a str,
    pub period_start: Option<NaiveDate>,
    pub period_end: Option<NaiveDate>,
    pub outcome: &'a str,
}

pub async fn record_scope_audit(
    db: &PgPool,
    entry: ScopeAuditInsert<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO ai_copilot_scope_audit (
             tenant_id,branch_id,user_id,role_name,scope_level,scope_label,
             requested_scope_level,requested_scope_label,narrowed,authorized_branch_ids,
             denied_branch_ids,tool_name,domain,language_code,question,period_start,
             period_end,outcome
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)"#,
    )
    .bind(entry.tenant_id)
    .bind(entry.branch_id)
    .bind(entry.user_id)
    .bind(entry.role_name)
    .bind(entry.scope_level)
    .bind(entry.scope_label)
    .bind(entry.requested_scope_level)
    .bind(entry.requested_scope_label)
    .bind(entry.narrowed)
    .bind(entry.authorized_branch_ids)
    .bind(entry.denied_branch_ids)
    .bind(entry.tool_name)
    .bind(entry.domain)
    .bind(entry.language_code)
    .bind(entry.question)
    .bind(entry.period_start)
    .bind(entry.period_end)
    .bind(entry.outcome)
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Two branches in different regions, one of which the user may not read.
    struct Fixture {
        tenant_id: String,
        authorized_branch_id: String,
        forbidden_branch_id: String,
        user_id: String,
        staff_id: String,
    }

    /// Seed a two-branch tenant with activity in both branches, granting the
    /// user access to only one. Every query is then checked against that grant.
    async fn seed(db: &PgPool) -> Fixture {
        let tenant_id: String =
            sqlx::query_scalar("INSERT INTO tenants(name,scope_id) VALUES('Aura Salon Group','') RETURNING scope_id")
                .fetch_one(db)
                .await
                .unwrap();

        let mut branch_ids = Vec::new();
        for (name, code, region, zone, cluster) in [
            ("Banjara Hills", "BJH", "South", "Hyderabad", "Central"),
            ("Andheri West", "ADW", "West", "Mumbai", "North"),
        ] {
            let branch_id: String = sqlx::query_scalar(
                r#"INSERT INTO branches(tenant_id,name,code,scope_id,region_name,zone_name,cluster_name,active)
                   VALUES((SELECT id FROM tenants WHERE scope_id=$1),$2,$3,'',$4,$5,$6,TRUE)
                   RETURNING scope_id"#,
            )
            .bind(&tenant_id)
            .bind(name)
            .bind(code)
            .bind(region)
            .bind(zone)
            .bind(cluster)
            .fetch_one(db)
            .await
            .unwrap();
            branch_ids.push(branch_id);
        }
        let authorized_branch_id = branch_ids[0].clone();
        let forbidden_branch_id = branch_ids[1].clone();

        let user_id: String = sqlx::query_scalar(
            r#"INSERT INTO users(tenant_id,branch_id,role_name,email,password_hash,full_name)
               VALUES($1,$2,'manager','asha.rao@aurasalon.in','x','Asha Rao') RETURNING id"#,
        )
        .bind(&tenant_id)
        .bind(&authorized_branch_id)
        .fetch_one(db)
        .await
        .unwrap();

        // The grant covers one branch only; the other must stay invisible.
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active)
               VALUES($1,$2,$3,'manager',TRUE)"#,
        )
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&authorized_branch_id)
        .execute(db)
        .await
        .unwrap();

        let mut staff_ids = Vec::new();
        for (index, branch_id) in branch_ids.iter().enumerate() {
            let staff_id: String = sqlx::query_scalar(
                r#"INSERT INTO staff(tenant_id,branch_id,first_name,last_name,email,job_title,active)
                   VALUES($1,$2,$3,'Rao',$4,'Stylist',TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(if index == 0 { "Asha" } else { "Nikita" })
            .bind(if index == 0 {
                "asha.rao@aurasalon.in"
            } else {
                "nikita.rao@aurasalon.in"
            })
            .fetch_one(db)
            .await
            .unwrap();

            let client_id: String = sqlx::query_scalar(
                r#"INSERT INTO clients(tenant_id,branch_id,first_name,last_name,active)
                   VALUES($1,$2,'Priya','Menon',TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();

            let service_id: String = sqlx::query_scalar(
                r#"INSERT INTO services(tenant_id,branch_id,name,category,duration_minutes,
                     price_paise,active,product_consumption_json)
                   VALUES($1,$2,'Hair Colour','Hair',60,250000,TRUE,
                     JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('itemId','x','standardQty',2)))
                   RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();

            let item_id: String = sqlx::query_scalar(
                r#"INSERT INTO inventory_items(tenant_id,branch_id,sku,name,category,unit,
                     stock_quantity,reorder_point,unit_cost_paise,active)
                   VALUES($1,$2,$3,'Colour Developer','Hair','ml',5,20,3000,TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(format!("SKU-{index}"))
            .fetch_one(db)
            .await
            .unwrap();

            let appointment_id = format!("appointment-{index}");
            sqlx::query(
                r#"INSERT INTO appointments(id,tenant_id,branch_id,client_id,staff_id,
                     service_ids_json,start_at,end_at,status)
                   VALUES($1,$2,$3,$4,$5,$6,NOW()-INTERVAL '2 days',
                     NOW()-INTERVAL '2 days'+INTERVAL '75 minutes','completed')"#,
            )
            .bind(&appointment_id)
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&client_id)
            .bind(&staff_id)
            .bind(json!([service_id]).to_string())
            .execute(db)
            .await
            .unwrap();

            let sale_id: String = sqlx::query_scalar(
                r#"INSERT INTO pos_sales(tenant_id,branch_id,client_id,staff_id,invoice_number,
                     subtotal_paise,discount_paise,tax_paise,total_paise,paid_paise,status,
                     coupon_code,coupon_discount_paise,finalized_at)
                   VALUES($1,$2,$3,$4,$5,250000,10000,0,240000,240000,'paid','WELCOME10',10000,
                     NOW()-INTERVAL '2 days')
                   RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&client_id)
            .bind(&staff_id)
            .bind(format!("INV-{index}"))
            .fetch_one(db)
            .await
            .unwrap();

            sqlx::query(
                r#"INSERT INTO pos_sale_lines(tenant_id,branch_id,sale_id,line_type,item_id,
                     item_name,quantity,unit_price_paise,line_total_paise,staff_splits)
                   VALUES($1,$2,$3,'service',$4,'Hair Colour',1,250000,240000,
                     JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('staffId',$5::TEXT,'percent',100)))"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&sale_id)
            .bind(&service_id)
            .bind(&staff_id)
            .execute(db)
            .await
            .unwrap();

            // Actual usage above the recipe allowance, linked to the appointment.
            sqlx::query(
                r#"INSERT INTO inventory_backbar_usage(id,tenant_id,branch_id,inventory_item_id,
                     service_id,staff_id,client_id,appointment_id,unit,expected_quantity,
                     actual_quantity,actor_user_id,idempotency_key,status)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ml',2,5,$9,$1,'recorded')"#,
            )
            .bind(format!("usage-{index}"))
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&item_id)
            .bind(&service_id)
            .bind(&staff_id)
            .bind(&client_id)
            .bind(&appointment_id)
            .bind(&user_id)
            .execute(db)
            .await
            .unwrap();

            sqlx::query(
                r#"INSERT INTO staff_attendance_records(tenant_id,branch_id,staff_id,business_date,
                     status,worked_minutes,late_minutes)
                   VALUES($1,$2,$3,CURRENT_DATE-2,'present',480,15)"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&staff_id)
            .execute(db)
            .await
            .unwrap();

            sqlx::query(
                r#"INSERT INTO staff_schedules(tenant_id,branch_id,staff_id,schedule_date,
                     shift1_start,shift1_end,status)
                   VALUES($1,$2,$3,CURRENT_DATE-2,'10:00','19:00','working')"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&staff_id)
            .execute(db)
            .await
            .unwrap();

            let membership_id: String = sqlx::query_scalar(
                r#"INSERT INTO memberships(tenant_id,branch_id,name,validity_days,active)
                   VALUES($1,$2,'Gold Care',365,TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO client_memberships(tenant_id,branch_id,client_id,membership_id,
                     expires_at,active)
                   VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 days',TRUE)"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&client_id)
            .bind(&membership_id)
            .execute(db)
            .await
            .unwrap();

            let package_id: String = sqlx::query_scalar(
                r#"INSERT INTO packages(tenant_id,branch_id,name,price_paise,validity_days,active)
                   VALUES($1,$2,'Colour Pack',500000,180,TRUE) RETURNING id"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .fetch_one(db)
            .await
            .unwrap();
            sqlx::query(
                r#"INSERT INTO client_package_credits(tenant_id,branch_id,client_id,package_id,
                     package_name,service_id,service_name,total_qty,remaining_qty,active)
                   VALUES($1,$2,$3,$4,'Colour Pack',$5,'Hair Colour',6,4,TRUE)"#,
            )
            .bind(&tenant_id)
            .bind(branch_id)
            .bind(&client_id)
            .bind(&package_id)
            .bind(&service_id)
            .execute(db)
            .await
            .unwrap();

            sqlx::query(
                r#"INSERT INTO pos_coupons(id,tenant_id,branch_id,code,discount_type,
                     discount_value_paise,active)
                   VALUES($1,$2,$3,'WELCOME10','amount',10000,TRUE)"#,
            )
            .bind(format!("coupon-{index}"))
            .bind(&tenant_id)
            .bind(branch_id)
            .execute(db)
            .await
            .unwrap();

            staff_ids.push(staff_id);
        }

        Fixture {
            tenant_id,
            authorized_branch_id,
            forbidden_branch_id,
            user_id,
            staff_id: staff_ids[0].clone(),
        }
    }

    fn window() -> (NaiveDate, NaiveDate) {
        let today = chrono::Utc::now().date_naive();
        (today - chrono::Duration::days(29), today)
    }

    #[sqlx::test]
    async fn granted_user_sees_only_the_authorized_branch(pool: PgPool) {
        let fixture = seed(&pool).await;

        let scoped = authorized_branches(&pool, &fixture.tenant_id, &fixture.user_id, false)
            .await
            .unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].branch_id, fixture.authorized_branch_id);
        assert_eq!(scoped[0].region_name, "South");
        assert_eq!(scoped[0].zone_name, "Hyderabad");

        // The tenant-wide path is what owners use, and it must see both.
        let unrestricted =
            authorized_branches(&pool, &fixture.tenant_id, &fixture.user_id, true)
                .await
                .unwrap();
        assert_eq!(unrestricted.len(), 2);

        let directory = tenant_branch_directory(&pool, &fixture.tenant_id)
            .await
            .unwrap();
        assert_eq!(directory.len(), 2);
    }

    #[sqlx::test]
    async fn expired_deputation_does_not_grant_access(pool: PgPool) {
        let fixture = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active,
                 access_type,valid_from,valid_until)
               VALUES($1,$2,$3,'manager',TRUE,'deputation',CURRENT_DATE-40,CURRENT_DATE-10)"#,
        )
        .bind(&fixture.tenant_id)
        .bind(&fixture.user_id)
        .bind(&fixture.forbidden_branch_id)
        .execute(&pool)
        .await
        .unwrap();

        let scoped = authorized_branches(&pool, &fixture.tenant_id, &fixture.user_id, false)
            .await
            .unwrap();
        assert_eq!(scoped.len(), 1, "a lapsed deputation must not widen the scope");
        assert_eq!(scoped[0].branch_id, fixture.authorized_branch_id);
    }

    #[sqlx::test]
    async fn active_deputation_grants_access_for_its_window(pool: PgPool) {
        let fixture = seed(&pool).await;
        sqlx::query(
            r#"INSERT INTO user_branch_roles(tenant_id,user_id,branch_id,role_name,active,
                 access_type,valid_from,valid_until)
               VALUES($1,$2,$3,'manager',TRUE,'deputation',CURRENT_DATE-5,CURRENT_DATE+5)"#,
        )
        .bind(&fixture.tenant_id)
        .bind(&fixture.user_id)
        .bind(&fixture.forbidden_branch_id)
        .execute(&pool)
        .await
        .unwrap();

        let scoped = authorized_branches(&pool, &fixture.tenant_id, &fixture.user_id, false)
            .await
            .unwrap();
        assert_eq!(scoped.len(), 2);
    }

    #[sqlx::test]
    async fn analytical_queries_never_read_outside_the_branch_list(pool: PgPool) {
        let fixture = seed(&pool).await;
        let (start, end) = window();
        let scoped = vec![fixture.authorized_branch_id.clone()];

        let metrics = branch_period_metrics(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].branch_id, fixture.authorized_branch_id);
        assert_eq!(metrics[0].revenue_paise, 240_000);
        assert_eq!(metrics[0].completed_appointments, 1);

        let staff = staff_performance(&pool, &fixture.tenant_id, &scoped, start, end, None)
            .await
            .unwrap();
        assert_eq!(staff.len(), 1);
        assert_eq!(staff[0].staff_id, fixture.staff_id);
        assert_eq!(staff[0].completed_appointments, 1);
        assert_eq!(staff[0].service_revenue_paise, 240_000);
        assert_eq!(staff[0].scheduled_minutes, 540);
        assert_eq!(staff[0].worked_minutes, 480);
        assert_eq!(staff[0].late_days, 1);
        // 75 booked minutes against a 60 minute service definition.
        assert_eq!(staff[0].service_duration_variance_minutes, 15);
        // 3 extra units of a product costing 30.00 each.
        assert_eq!(staff[0].consumption_variance_cost_paise, 9_000);

        let single_staff = staff_performance(
            &pool,
            &fixture.tenant_id,
            &scoped,
            start,
            end,
            Some(&fixture.staff_id),
        )
        .await
        .unwrap();
        assert_eq!(single_staff.len(), 1);

        for grouping in [
            ConsumptionGrouping::Service,
            ConsumptionGrouping::Product,
            ConsumptionGrouping::Staff,
        ] {
            let rows =
                consumption_variance(&pool, &fixture.tenant_id, &scoped, start, end, grouping)
                    .await
                    .unwrap();
            assert_eq!(rows.len(), 1, "grouping {grouping:?} leaked or dropped rows");
            assert_eq!(rows[0].branch_id, fixture.authorized_branch_id);
            assert_eq!(rows[0].expected_quantity, 2);
            assert_eq!(rows[0].actual_quantity, 5);
            assert_eq!(rows[0].variance_quantity, 3);
            assert_eq!(rows[0].variance_cost_paise, 9_000);
            assert_eq!(rows[0].linked_appointment_count, 1);
        }

        let coverage = consumption_coverage(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(coverage.completed_services, 1);
        assert_eq!(coverage.recipe_backed_services, 1);
        assert_eq!(coverage.recorded_usage_events, 1);
        assert_eq!(coverage.appointment_linked_usage_events, 1);

        let demand = service_demand(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(demand.len(), 1);
        assert_eq!(demand[0].completed_count, 1);
        assert_eq!(demand[0].revenue_paise, 240_000);

        let stock = stock_positions(&pool, &fixture.tenant_id, &scoped, start, end, true)
            .await
            .unwrap();
        assert_eq!(stock.len(), 1);
        assert_eq!(stock[0].consumed_quantity, 5);

        let retention = client_retention(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(retention.len(), 1);
        assert_eq!(retention[0].visiting_clients, 1);
        assert_eq!(retention[0].new_clients, 1);

        let memberships = membership_expiry(&pool, &fixture.tenant_id, &scoped, 30)
            .await
            .unwrap();
        assert_eq!(memberships.len(), 1);
        assert_eq!(memberships[0].expiring_count, 1);

        let packages = package_utilization(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].remaining_credits, 4);

        let offers = offer_performance(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(offers.len(), 1);
        assert_eq!(offers[0].used_count, 1);
        assert_eq!(offers[0].discount_given_paise, 10_000);

        let finance = finance_summary(&pool, &fixture.tenant_id, &scoped, start, end)
            .await
            .unwrap();
        assert_eq!(finance.len(), 1);
        assert_eq!(finance[0].revenue_paise, 240_000);
        assert_eq!(finance[0].collected_paise, 240_000);
        assert_eq!(finance[0].outstanding_paise, 0);
    }

    #[sqlx::test]
    async fn widening_the_branch_list_widens_the_result(pool: PgPool) {
        let fixture = seed(&pool).await;
        let (start, end) = window();
        let both = vec![
            fixture.authorized_branch_id.clone(),
            fixture.forbidden_branch_id.clone(),
        ];
        let metrics = branch_period_metrics(&pool, &fixture.tenant_id, &both, start, end)
            .await
            .unwrap();
        assert_eq!(metrics.len(), 2);
        assert_eq!(
            metrics.iter().map(|row| row.revenue_paise).sum::<i64>(),
            480_000
        );
    }

    #[sqlx::test]
    async fn repeat_detection_updates_one_alert_instead_of_stacking(pool: PgPool) {
        let fixture = seed(&pool).await;
        let (start, end) = window();
        let build = || AlertUpsert {
            tenant_id: &fixture.tenant_id,
            branch_id: &fixture.authorized_branch_id,
            scope_level: "branch",
            scope_label: "Banjara Hills",
            alert_type: "stock_shortage",
            severity: "high",
            subject_type: "product",
            subject_id: "item-1",
            subject_name: "Colour Developer",
            title: "Colour Developer is below reorder point",
            detail: "5 in stock against a reorder point of 20.",
            metrics_json: json!({"stockQuantity": 5}),
            confidence: 0.85,
            required_permission: "inventory.read",
            fingerprint: "stock_shortage:product:item-1",
            period_start: start,
            period_end: end,
        };

        let first = upsert_alert(&pool, build()).await.unwrap();
        assert_eq!(first.occurrence_count, 1);
        let second = upsert_alert(&pool, build()).await.unwrap();
        assert_eq!(second.id, first.id, "a repeat detection must not create a row");
        assert_eq!(second.occurrence_count, 2);

        let scoped = vec![fixture.authorized_branch_id.clone()];
        let permissions = vec!["inventory.read".to_string()];
        let open = list_alerts(&pool, &fixture.tenant_id, &scoped, &permissions, "open", 50)
            .await
            .unwrap();
        assert_eq!(open.len(), 1);

        // An alert the caller has no permission for stays out of their feed.
        let filtered = list_alerts(
            &pool,
            &fixture.tenant_id,
            &scoped,
            &["finance.read".to_string()],
            "open",
            50,
        )
        .await
        .unwrap();
        assert!(filtered.is_empty());

        // Nor is it visible from a branch the caller cannot read.
        let other_branch = list_alerts(
            &pool,
            &fixture.tenant_id,
            &vec![fixture.forbidden_branch_id.clone()],
            &permissions,
            "open",
            50,
        )
        .await
        .unwrap();
        assert!(other_branch.is_empty());

        let resolved = set_alert_status(
            &pool,
            &fixture.tenant_id,
            &scoped,
            &first.id,
            "resolved",
            &fixture.user_id,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(resolved.status, "resolved");

        // Once resolved, the same condition opens a fresh alert rather than
        // silently reviving the closed one.
        let reopened = upsert_alert(&pool, build()).await.unwrap();
        assert_ne!(reopened.id, first.id);
        assert_eq!(reopened.occurrence_count, 1);
    }

    #[sqlx::test]
    async fn pending_actions_only_move_through_a_decision(pool: PgPool) {
        let fixture = seed(&pool).await;
        let scoped = vec![fixture.authorized_branch_id.clone()];

        let pending = insert_approval(
            &pool,
            ApprovalInsert {
                tenant_id: &fixture.tenant_id,
                branch_id: &fixture.authorized_branch_id,
                action_type: "refund",
                approval_mode: "explicit_approval",
                title: "Refund invoice INV-0",
                summary: "Client requested a refund.",
                payload_json: json!({"invoiceNumber": "INV-0"}),
                scope_level: "branch",
                scope_label: "Banjara Hills",
                required_permission: "pos.refund",
                status: "pending",
                requested_by: &fixture.user_id,
                requested_role: "manager",
                decided_by: "",
                expires_in_hours: 72,
            },
        )
        .await
        .unwrap();
        assert_eq!(pending.status, "pending");
        assert!(pending.decided_at.is_none());
        assert!(pending.expires_at.is_some());

        let auto = insert_approval(
            &pool,
            ApprovalInsert {
                tenant_id: &fixture.tenant_id,
                branch_id: &fixture.authorized_branch_id,
                action_type: "report_draft",
                approval_mode: "auto",
                title: "Draft a branch review pack",
                summary: "",
                payload_json: json!({}),
                scope_level: "branch",
                scope_label: "Banjara Hills",
                required_permission: "reports.read",
                status: "approved",
                requested_by: &fixture.user_id,
                requested_role: "manager",
                decided_by: "ai-copilot-auto",
                expires_in_hours: 0,
            },
        )
        .await
        .unwrap();
        assert_eq!(auto.status, "approved");
        assert!(auto.decided_at.is_some());

        let queue = list_approvals(&pool, &fixture.tenant_id, &scoped, "pending", 50)
            .await
            .unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].id, pending.id);

        let decided = decide_approval(
            &pool,
            &fixture.tenant_id,
            &scoped,
            &pending.id,
            "approved",
            &fixture.user_id,
            "verified with the client",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(decided.status, "approved");
        assert_eq!(decided.decided_by, fixture.user_id);

        // A second decision on the same row must not take effect.
        let repeat = decide_approval(
            &pool,
            &fixture.tenant_id,
            &scoped,
            &pending.id,
            "rejected",
            &fixture.user_id,
            "",
        )
        .await
        .unwrap();
        assert!(repeat.is_none());

        // And nothing is decidable from outside the caller's branch scope.
        let out_of_scope = approval_by_id(
            &pool,
            &fixture.tenant_id,
            &vec![fixture.forbidden_branch_id.clone()],
            &pending.id,
        )
        .await
        .unwrap();
        assert!(out_of_scope.is_none());
    }

    #[sqlx::test]
    async fn every_answer_writes_a_scope_audit_row(pool: PgPool) {
        let fixture = seed(&pool).await;
        let authorized = vec![fixture.authorized_branch_id.clone()];
        let denied = vec![fixture.forbidden_branch_id.clone()];
        let (start, end) = window();

        record_scope_audit(
            &pool,
            ScopeAuditInsert {
                tenant_id: &fixture.tenant_id,
                branch_id: &fixture.authorized_branch_id,
                user_id: &fixture.user_id,
                role_name: "manager",
                scope_level: "branch",
                scope_label: "Banjara Hills",
                requested_scope_level: "tenant",
                requested_scope_label: "all",
                narrowed: true,
                authorized_branch_ids: &authorized,
                denied_branch_ids: &denied,
                tool_name: "branch_performance_comparison",
                domain: "geo_comparison",
                language_code: "hi-Latn",
                question: "sabhi branches ka revenue batao",
                period_start: Some(start),
                period_end: Some(end),
                outcome: "narrowed",
            },
        )
        .await
        .unwrap();

        let (narrowed, denied_count): (bool, i32) = sqlx::query_as(
            r#"SELECT narrowed, ARRAY_LENGTH(denied_branch_ids,1)
                 FROM ai_copilot_scope_audit
                WHERE tenant_id=$1 AND user_id=$2"#,
        )
        .bind(&fixture.tenant_id)
        .bind(&fixture.user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(narrowed);
        assert_eq!(denied_count, 1);
    }

    #[sqlx::test]
    async fn staff_login_resolves_to_its_own_staff_record(pool: PgPool) {
        let fixture = seed(&pool).await;
        let resolved = staff_id_for_user(&pool, &fixture.tenant_id, &fixture.user_id)
            .await
            .unwrap();
        assert_eq!(resolved.as_deref(), Some(fixture.staff_id.as_str()));
    }
}
