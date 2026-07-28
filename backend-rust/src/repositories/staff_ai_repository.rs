use chrono::NaiveDate;
use serde_json::Value;
use sqlx::PgPool;

pub async fn attendance_facts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
          'staff_id',a.staff_id,
          'staff_name',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),a.staff_id),
          'business_date',a.business_date,
          'raw_status',a.status,
          'manual_status',COALESCE(a.manual_status,''),
          'source',a.source,
          'clock_in_at',a.clock_in_at,
          'clock_out_at',a.clock_out_at,
          'worked_minutes',a.worked_minutes,
          'late_minutes',a.late_minutes,
          'overtime_minutes',a.overtime_minutes,
          'correction_reason',a.correction_reason
        )
        FROM staff_attendance_records a
        JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id
        WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.business_date BETWEEN $3 AND $4
        ORDER BY a.business_date DESC,a.staff_id
        LIMIT 5000
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(db)
    .await
}

pub async fn biometric_facts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
          'staff_id',COALESCE(e.staff_id,''),
          'staff_name',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),''),
          'external_user_id',e.external_user_id,
          'device_id',e.device_id,
          'punch_type',e.punch_type,
          'punch_at',e.punch_at,
          'status',e.status,
          'rejection_reason',e.rejection_reason
        )
        FROM staff_biometric_events e
        LEFT JOIN staff s ON s.id=e.staff_id AND s.tenant_id=e.tenant_id AND s.branch_id=e.branch_id
        WHERE e.tenant_id=$1 AND e.branch_id=$2
          AND (e.punch_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
        ORDER BY e.punch_at DESC,e.id
        LIMIT 5000
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(db)
    .await
}

pub async fn commission_facts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT jsonb_build_object(
          'staff_id',c.staff_id,
          'staff_name',COALESCE(NULLIF(s.appointment_display_name,''),TRIM(CONCAT_WS(' ',s.first_name,s.last_name)),c.staff_id),
          'sale_count',COUNT(DISTINCT c.sale_id),
          'line_count',COUNT(*),
          'base_paise',COALESCE(SUM(c.base_paise),0),
          'commission_paise',COALESCE(SUM(c.commission_paise),0)
        )
        FROM pos_staff_commission_snapshots c
        LEFT JOIN staff s ON s.id=c.staff_id AND s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id
        WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.business_date BETWEEN $3 AND $4
        GROUP BY c.staff_id,s.appointment_display_name,s.first_name,s.last_name
        ORDER BY c.staff_id
        LIMIT 1000
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(db)
    .await
}
