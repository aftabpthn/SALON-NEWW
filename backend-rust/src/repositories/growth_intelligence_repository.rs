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
                 COUNT(DISTINCT c.id)::BIGINT
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
        SELECT staff.id AS staff_id,
               COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name))) AS staff_name,
               COALESCE(SUM(line.line_total_paise),0)::BIGINT AS revenue_paise,
               COALESCE(SUM(line.quantity),0)::BIGINT AS service_count,
               (SELECT COUNT(*)::BIGINT FROM staff_coaching_goals goal
                 WHERE goal.tenant_id=$1 AND goal.branch_id=$2 AND goal.staff_id=staff.id AND goal.status='active') AS active_goal_count,
               (SELECT COUNT(*)::BIGINT FROM appointments appt
                 WHERE appt.tenant_id=$1 AND appt.branch_id=$2 AND appt.staff_id=staff.id
                   AND LOWER(appt.status) IN ('no-show','no_show') AND appt.start_at>=NOW()-INTERVAL '90 days') AS no_show_count
        FROM staff
        LEFT JOIN pos_sales sale ON sale.tenant_id=staff.tenant_id AND sale.branch_id=staff.branch_id
          AND sale.staff_id=staff.id AND sale.created_at>=NOW()-INTERVAL '30 days'
          AND LOWER(sale.status) NOT IN ('void','cancelled','canceled')
        LEFT JOIN pos_sale_lines line ON line.tenant_id=sale.tenant_id AND line.branch_id=sale.branch_id
          AND line.sale_id=sale.id AND line.line_type='service'
        WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
        GROUP BY staff.id,staff.appointment_display_name,staff.first_name,staff.last_name
        ORDER BY active_goal_count DESC, no_show_count DESC, revenue_paise ASC
        LIMIT 8
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}
