use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct OwnerCommandRecord {
    pub revenue_30d_paise: i64,
    pub today_appointments: i64,
    pub open_appointments: i64,
    pub open_due_count: i64,
    pub outstanding_paise: i64,
    pub low_stock_count: i64,
    pub active_staff_count: i64,
    pub active_client_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ClientMemoryRecord {
    pub client_id: String,
    pub client_name: String,
    pub visit_count: i64,
    pub revenue_paise: i64,
    pub last_visit_at: Option<chrono::DateTime<chrono::Utc>>,
    pub no_show_count: i64,
    pub cancellation_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct CampaignPlanRecord {
    pub key: String,
    pub title: String,
    pub segment_key: String,
    pub audience_count: i64,
    pub draft_count: i64,
    pub approved_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffCoachRecord {
    pub staff_id: String,
    pub staff_name: String,
    pub revenue_paise: i64,
    pub service_count: i64,
    pub active_goal_count: i64,
    pub no_show_count: i64,
    pub completed_visits: i64,
    pub unique_clients: i64,
    pub rebooked_clients: i64,
    pub retained_clients: i64,
    pub invoice_count: i64,
    pub product_invoice_count: i64,
    pub membership_package_count: i64,
    pub booked_minutes: i64,
    pub scheduled_minutes: i64,
    pub average_bill_paise: i64,
    pub branch_average_bill_paise: i64,
    pub service_category_count: i64,
    pub branch_service_category_count: i64,
    pub inactive_clients: i64,
    pub average_product_sale_paise: i64,
    pub average_membership_package_sale_paise: i64,
}

impl StaffCoachRecord {
    pub fn metric_value(&self, key: &str) -> Option<i64> {
        match key {
            "rebooking" => ratio(self.rebooked_clients, self.unique_clients),
            "product_upsell" => ratio(self.product_invoice_count, self.invoice_count),
            "package_membership" => Some(self.membership_package_count),
            "utilization" => ratio(self.booked_minutes, self.scheduled_minutes),
            "client_retention" => ratio(self.retained_clients, self.unique_clients),
            "service_mix" => Some(self.service_category_count),
            "average_bill" => (self.invoice_count > 0).then_some(self.average_bill_paise),
            _ => None,
        }
    }
}

fn ratio(value: i64, total: i64) -> Option<i64> {
    (total > 0).then(|| (value.saturating_mul(100) / total).clamp(0, 100))
}

pub async fn owner_command(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<OwnerCommandRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
          COALESCE((SELECT SUM(total_paise)::BIGINT FROM pos_sales
            WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '30 days'
              AND LOWER(status) NOT IN ('void','cancelled','canceled')),0)::BIGINT AS revenue_30d_paise,
          (SELECT COUNT(*)::BIGINT FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2
              AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE) AS today_appointments,
          (SELECT COUNT(*)::BIGINT FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2
              AND LOWER(status) IN ('booked','confirmed','arrived','waiting','in-service','in_service')) AS open_appointments,
          (SELECT COUNT(*)::BIGINT FROM pos_sales
            WHERE tenant_id=$1 AND branch_id=$2 AND total_paise>paid_paise
              AND LOWER(status) NOT IN ('void','cancelled','canceled')) AS open_due_count,
          COALESCE((SELECT SUM(GREATEST(total_paise-paid_paise,0))::BIGINT FROM pos_sales
            WHERE tenant_id=$1 AND branch_id=$2
              AND LOWER(status) NOT IN ('void','cancelled','canceled')),0)::BIGINT AS outstanding_paise,
          (SELECT COUNT(*)::BIGINT FROM inventory_items
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND stock_quantity<=reorder_point) AS low_stock_count,
          (SELECT COUNT(*)::BIGINT FROM staff
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE) AS active_staff_count,
          (SELECT COUNT(*)::BIGINT FROM clients
            WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL) AS active_client_count
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn client_memory(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ClientMemoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH appointment_stats AS (
          SELECT client_id,
                 COUNT(*)::BIGINT AS visit_count,
                 MAX(start_at) AS last_visit_at,
                 COUNT(*) FILTER (WHERE LOWER(status) IN ('no-show','no_show'))::BIGINT AS no_show_count,
                 COUNT(*) FILTER (WHERE LOWER(status) IN ('cancelled','canceled'))::BIGINT AS cancellation_count
          FROM appointments
          WHERE tenant_id=$1 AND branch_id=$2
          GROUP BY client_id
        ),
        sale_stats AS (
          SELECT client_id,COALESCE(SUM(total_paise),0)::BIGINT AS revenue_paise
          FROM pos_sales
          WHERE tenant_id=$1 AND branch_id=$2 AND created_at>=NOW()-INTERVAL '365 days'
            AND LOWER(status) NOT IN ('void','cancelled','canceled')
          GROUP BY client_id
        )
        SELECT c.id AS client_id,
               TRIM(CONCAT_WS(' ', c.first_name, c.last_name)) AS client_name,
               COALESCE(a.visit_count,0)::BIGINT AS visit_count,
               COALESCE(s.revenue_paise,0)::BIGINT AS revenue_paise,
               a.last_visit_at,
               COALESCE(a.no_show_count,0)::BIGINT AS no_show_count,
               COALESCE(a.cancellation_count,0)::BIGINT AS cancellation_count
        FROM clients c
        LEFT JOIN appointment_stats a ON a.client_id=c.id
        LEFT JOIN sale_stats s ON s.client_id=c.id
        WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.active=TRUE AND c.merged_into_client_id IS NULL
          AND (COALESCE(a.visit_count,0)>0 OR COALESCE(s.revenue_paise,0)>0)
        ORDER BY COALESCE(s.revenue_paise,0) DESC, a.last_visit_at DESC NULLS LAST
        LIMIT 8
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn campaign_plans(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CampaignPlanRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH segments AS (
          SELECT 'birthday' AS key,'Birthday wishes' AS title,'birthday_month' AS segment_key,
                 COUNT(*) FILTER (WHERE birthday IS NOT NULL)::BIGINT AS audience_count
          FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND merged_into_client_id IS NULL
          UNION ALL
          SELECT 'inactive','Win-back clients','inactive_90',
                 COUNT(DISTINCT inactive.id)::BIGINT
          FROM (
            SELECT c.id,MAX(a.start_at) AS last_visit_at
            FROM clients c
            LEFT JOIN appointments a ON a.tenant_id=c.tenant_id AND a.branch_id=c.branch_id AND a.client_id=c.id
               AND LOWER(a.status) IN ('completed','billed','paid')
            WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.active=TRUE AND c.merged_into_client_id IS NULL
            GROUP BY c.id
          ) inactive
          WHERE inactive.last_visit_at IS NULL OR inactive.last_visit_at<NOW()-INTERVAL '90 days'
          UNION ALL
          SELECT 'dues','Payment recovery','open_dues',
                 COUNT(DISTINCT client_id)::BIGINT
          FROM pos_sales
          WHERE tenant_id=$1 AND branch_id=$2 AND total_paise>paid_paise
            AND LOWER(status) NOT IN ('void','cancelled','canceled')
        ),
        plans AS (
          SELECT segment_key,
                 COUNT(*) FILTER (WHERE status='draft')::BIGINT AS draft_count,
                 COUNT(*) FILTER (WHERE status IN ('approved','scheduled','sent'))::BIGINT AS approved_count
          FROM whatsapp_campaign_plans
          WHERE tenant_id=$1 AND branch_id=$2
          GROUP BY segment_key
        )
        SELECT segments.key,segments.title,segments.segment_key,segments.audience_count,
               COALESCE(plans.draft_count,0)::BIGINT AS draft_count,
               COALESCE(plans.approved_count,0)::BIGINT AS approved_count
        FROM segments
        LEFT JOIN plans ON plans.segment_key=segments.segment_key
        ORDER BY segments.audience_count DESC, segments.key
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn staff_coach(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<StaffCoachRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH completed AS (
          SELECT appointment.staff_id,appointment.client_id,appointment.start_at
          FROM appointments appointment
          WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
            AND appointment.staff_id<>'' AND appointment.client_id<>''
            AND appointment.start_at>=NOW()-INTERVAL '30 days'
            AND LOWER(appointment.status) IN ('completed','billed','paid','closed','checked-out','checked_out')
        ), appointment_metrics AS (
          SELECT completed.staff_id,
                 COUNT(*)::BIGINT AS completed_visits,
                 COUNT(DISTINCT completed.client_id)::BIGINT AS unique_clients,
                 COUNT(DISTINCT completed.client_id) FILTER (WHERE EXISTS(
                   SELECT 1 FROM appointments future
                   WHERE future.tenant_id=$1 AND future.branch_id=$2 AND future.client_id=completed.client_id
                     AND future.start_at>completed.start_at AND future.start_at<=completed.start_at+INTERVAL '90 days'
                     AND LOWER(future.status) NOT IN ('cancelled','canceled','void','voided','no-show','no_show')
                 ))::BIGINT AS rebooked_clients,
                 COUNT(DISTINCT completed.client_id) FILTER (WHERE EXISTS(
                   SELECT 1 FROM appointments prior
                   WHERE prior.tenant_id=$1 AND prior.branch_id=$2 AND prior.client_id=completed.client_id
                     AND prior.start_at<completed.start_at
                     AND LOWER(prior.status) IN ('completed','billed','paid','closed','checked-out','checked_out')
                 ))::BIGINT AS retained_clients
          FROM completed GROUP BY completed.staff_id
        ), booked AS (
          SELECT staff_id,COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60)),0)::BIGINT AS booked_minutes
          FROM appointments
          WHERE tenant_id=$1 AND branch_id=$2 AND staff_id<>'' AND start_at>=NOW()-INTERVAL '30 days'
            AND LOWER(status) NOT IN ('cancelled','canceled','void','voided','no-show','no_show')
          GROUP BY staff_id
        ), scheduled AS (
          SELECT staff_id,COALESCE(SUM(CASE WHEN status='working' THEN
            COALESCE(EXTRACT(EPOCH FROM (shift1_end-shift1_start))/60,0)+COALESCE(EXTRACT(EPOCH FROM (shift2_end-shift2_start))/60,0)
            ELSE 0 END),0)::BIGINT AS scheduled_minutes
          FROM staff_schedules
          WHERE tenant_id=$1 AND branch_id=$2 AND schedule_date BETWEEN CURRENT_DATE-29 AND CURRENT_DATE
          GROUP BY staff_id
        ), attributed_lines AS (
          SELECT COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,'')) AS staff_id,
                 sale.id AS sale_id,line.line_type,line.item_id,line.quantity,line.line_total_paise
          FROM pos_sales sale JOIN pos_sale_lines line
            ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id AND line.sale_id=sale.id
          WHERE sale.tenant_id=$1 AND sale.branch_id=$2
            AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN CURRENT_DATE-29 AND CURRENT_DATE
            AND LOWER(sale.status) NOT IN ('draft','void','voided','cancelled','canceled','refunded')
        ), sale_metrics AS (
          SELECT line.staff_id,
                 COALESCE(SUM(line.line_total_paise),0)::BIGINT AS revenue_paise,
                 COALESCE(SUM(line.quantity) FILTER (WHERE line.line_type IN ('service','package_redeem','membership_redeem')),0)::BIGINT AS service_count,
                 COUNT(DISTINCT line.sale_id)::BIGINT AS invoice_count,
                 COUNT(DISTINCT line.sale_id) FILTER (WHERE line.line_type='product')::BIGINT AS product_invoice_count,
                 COUNT(DISTINCT line.sale_id) FILTER (WHERE line.line_type IN ('membership','package'))::BIGINT AS membership_package_count,
                 COUNT(DISTINCT service.category) FILTER (WHERE service.category<>'')::BIGINT AS service_category_count
          FROM attributed_lines line
          LEFT JOIN services service ON service.tenant_id=$1 AND service.branch_id=$2 AND service.id=line.item_id
            AND line.line_type IN ('service','package_redeem','membership_redeem')
          WHERE line.staff_id IS NOT NULL
          GROUP BY line.staff_id
        ), branch_metrics AS (
          SELECT COALESCE(SUM(sale.total_paise)/NULLIF(COUNT(*),0),0)::BIGINT AS average_bill_paise,
                 (SELECT COUNT(DISTINCT category)::BIGINT FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND category<>'') AS service_category_count,
                 COALESCE((SELECT AVG(line_total_paise)::BIGINT FROM pos_sale_lines line JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type='product' AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN CURRENT_DATE-29 AND CURRENT_DATE AND LOWER(sale.status) NOT IN ('draft','void','voided','cancelled','canceled','refunded')),0)::BIGINT AS average_product_sale_paise,
                 COALESCE((SELECT AVG(line_total_paise)::BIGINT FROM pos_sale_lines line JOIN pos_sales sale ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.line_type IN ('membership','package') AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN CURRENT_DATE-29 AND CURRENT_DATE AND LOWER(sale.status) NOT IN ('draft','void','voided','cancelled','canceled','refunded')),0)::BIGINT AS average_membership_package_sale_paise
          FROM pos_sales sale
          WHERE sale.tenant_id=$1 AND sale.branch_id=$2
            AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN CURRENT_DATE-29 AND CURRENT_DATE
            AND LOWER(sale.status) NOT IN ('draft','void','voided','cancelled','canceled','refunded')
        ), inactive AS (
          SELECT recent.staff_id,COUNT(*)::BIGINT AS inactive_clients
          FROM (
            SELECT staff_id,client_id,MAX(start_at) AS last_visit_at
            FROM appointments
            WHERE tenant_id=$1 AND branch_id=$2 AND staff_id<>'' AND client_id<>''
              AND LOWER(status) IN ('completed','billed','paid','closed','checked-out','checked_out')
            GROUP BY staff_id,client_id
          ) recent
          WHERE recent.last_visit_at BETWEEN NOW()-INTERVAL '180 days' AND NOW()-INTERVAL '31 days'
            AND NOT EXISTS(SELECT 1 FROM appointments next WHERE next.tenant_id=$1 AND next.branch_id=$2 AND next.client_id=recent.client_id AND next.start_at>recent.last_visit_at AND LOWER(next.status) NOT IN ('cancelled','canceled','void','voided','no-show','no_show'))
          GROUP BY recent.staff_id
        )
        SELECT staff.id AS staff_id,
               COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name))) AS staff_name,
               COALESCE(sale.revenue_paise,0)::BIGINT AS revenue_paise,
               COALESCE(sale.service_count,0)::BIGINT AS service_count,
               (SELECT COUNT(*)::BIGINT FROM staff_coaching_goals goal
                 WHERE goal.tenant_id=$1 AND goal.branch_id=$2 AND goal.staff_id=staff.id AND goal.status='active') AS active_goal_count,
               (SELECT COUNT(*)::BIGINT FROM appointments appt
                 WHERE appt.tenant_id=$1 AND appt.branch_id=$2 AND appt.staff_id=staff.id
                   AND LOWER(appt.status) IN ('no-show','no_show') AND appt.start_at>=NOW()-INTERVAL '90 days') AS no_show_count,
               COALESCE(appointment.completed_visits,0)::BIGINT AS completed_visits,
               COALESCE(appointment.unique_clients,0)::BIGINT AS unique_clients,
               COALESCE(appointment.rebooked_clients,0)::BIGINT AS rebooked_clients,
               COALESCE(appointment.retained_clients,0)::BIGINT AS retained_clients,
               COALESCE(sale.invoice_count,0)::BIGINT AS invoice_count,
               COALESCE(sale.product_invoice_count,0)::BIGINT AS product_invoice_count,
               COALESCE(sale.membership_package_count,0)::BIGINT AS membership_package_count,
               COALESCE(booked.booked_minutes,0)::BIGINT AS booked_minutes,
               COALESCE(scheduled.scheduled_minutes,0)::BIGINT AS scheduled_minutes,
               CASE WHEN COALESCE(sale.invoice_count,0)>0 THEN sale.revenue_paise/sale.invoice_count ELSE 0 END::BIGINT AS average_bill_paise,
               branch.average_bill_paise AS branch_average_bill_paise,
               COALESCE(sale.service_category_count,0)::BIGINT AS service_category_count,
               branch.service_category_count AS branch_service_category_count,
               COALESCE(inactive.inactive_clients,0)::BIGINT AS inactive_clients,
               branch.average_product_sale_paise,
               branch.average_membership_package_sale_paise
        FROM staff
        CROSS JOIN branch_metrics branch
        LEFT JOIN appointment_metrics appointment ON appointment.staff_id=staff.id
        LEFT JOIN booked ON booked.staff_id=staff.id
        LEFT JOIN scheduled ON scheduled.staff_id=staff.id
        LEFT JOIN sale_metrics sale ON sale.staff_id=staff.id
        LEFT JOIN inactive ON inactive.staff_id=staff.id
        WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
        ORDER BY active_goal_count DESC,revenue_paise ASC,staff_name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}
