use chrono::{NaiveDate, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::{models::common::AppError, services::staff_enterprise_service};

pub async fn workspace_preferences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, AppError> {
    let workspace_name = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(NULLIF(name,''),'Staff workspace') FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2 AND active=TRUE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff workspace preferences"))?
    .ok_or_else(|| AppError::not_found("active staff branch was not found"))?;
    Ok(json!({
        "workspace":{"workspaceName":workspace_name},
        "localization":{"timezone":"Asia/Kolkata","locale":"en-IN"},
        "dateTime":{"dateFormat":"DD/MM/YYYY","timeFormat":"HH:mm","businessDayStartHour":0,"weekStartsOn":"monday"},
        "interface":{"compactMode":false},
        "defaults":{"staffHints":false}
    }))
}

pub async fn enterprise_os(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<Value, AppError> {
    if to < from || (to - from).num_days() > 62 {
        return Err(AppError::validation(
            "staff date range must be 63 days or less",
        ));
    }
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let staff = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',staff.id,'fullName',COALESCE(NULLIF(staff.appointment_display_name,''),TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name))),
              'firstName',staff.first_name,'lastName',staff.last_name,'mobile',staff.mobile_phone,'email',staff.email,
              'roleId','','department',staff.department,'designation',staff.job_title,
              'status',CASE WHEN staff.active THEN 'active' ELSE 'inactive' END)
            FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff profile"))?;
    let appointments = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',appointment.id,'staffId',appointment.staff_id,'branchId',appointment.branch_id,
              'serviceIds',COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb,
              'serviceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name)
                FROM services service WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'durationMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
              'value',COALESCE((SELECT SUM(service.price_paise) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),0),
              'startAt',appointment.start_at,'endAt',appointment.end_at,'status',appointment.status,
              'chair','','source',appointment.source)
            FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
            ORDER BY appointment.start_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff enterprise appointments"))?;
    let calendar = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',id,'date',schedule_date,'startTime',shift1_start,'endTime',shift1_end,
              'type','shift','status',status,'version',version)
            FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND schedule_date BETWEEN $4 AND $5 ORDER BY schedule_date"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff calendar"))?;
    let tasks = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('id',id,'title',title,'priority',priority,'status',status,
              'dueAt',due_at,'assignedBy',created_by,'checklist','[]'::jsonb)
            FROM staff_tasks WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND status IN ('open','in_progress','blocked') ORDER BY due_at NULLS LAST,created_at LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff tasks"))?;
    let notifications = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('id',id,'title',title,'body',body,
              'status',CASE WHEN is_read THEN 'read' ELSE 'unread' END,'createdAt',created_at)
            FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND (user_id='' OR user_id=$3)
            ORDER BY created_at DESC LIMIT 50"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff notifications"))?;
    let (revenue, completed_services, worked_minutes) = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"SELECT
              COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot
                WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3
                  AND snapshot.business_date BETWEEN $4 AND $5),0)::BIGINT,
              COUNT(*) FILTER(WHERE LOWER(appointment.status) IN ('completed','billed','paid'))::BIGINT,
              COALESCE(SUM(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60)
                FILTER(WHERE LOWER(appointment.status) IN ('completed','billed','paid')),0)::BIGINT
            FROM appointments appointment WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              AND appointment.staff_id=$3 AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(from)
    .bind(to)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load staff enterprise performance"))?;
    let expected_revenue = appointments
        .iter()
        .filter(|row| {
            !matches!(
                row.get("status").and_then(Value::as_str),
                Some("cancelled" | "canceled" | "void")
            )
        })
        .filter_map(|row| row.get("value").and_then(Value::as_i64))
        .sum::<i64>();
    let now = Utc::now();
    let timeline = appointments
        .iter()
        .map(|appointment| {
            let start = appointment.get("startAt").cloned().unwrap_or(Value::Null);
            let end = appointment.get("endAt").cloned().unwrap_or(Value::Null);
            json!({
                "id":appointment["id"],"serviceNames":appointment["serviceNames"],
                "startAt":start,"endAt":end,"status":appointment["status"],"state":appointment["status"],
                "minutesToStart":0,"durationMinutes":appointment["durationMinutes"]
            })
        })
        .collect::<Vec<_>>();
    let days = (to - from).num_days() + 1;
    Ok(json!({
        "staff":staff,
        "home":{
            "greeting":"","todayAppointments":appointments.len(),"expectedRevenue":expected_revenue,
            "tasks":tasks.len(),"pendingPayments":0,"recentNotifications":notifications.iter().filter(|row|row["status"]=="unread").count(),
            "targetProgress":{"label":"","targetValue":0,"achievedValue":0,"percentage":0,"remaining":0}
        },
        "timeline":timeline,"serviceTimers":[],
        "performance":{"revenue":revenue,"completedServices":completed_services,"avgUtilization":0,"avgRating":0,"productivityScore":0,"strengths":[],"opportunities":[]},
        "leaderboard":[],
        "gamification":{"points":0,"level":0,"stars":0,"dailyStreak":0,"monthlyStreak":0,"badges":[]},
        "notifications":notifications,"tasks":tasks,"calendar":calendar,
        "reports":{"selected":{"days":days,"revenue":revenue,"services":completed_services,"productivityScore":0,"rating":0}},
        "generatedAt":now,"workedMinutes":worked_minutes
    }))
}

#[allow(clippy::too_many_arguments)]
pub async fn business(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    from: NaiveDate,
    to: NaiveDate,
    page: i64,
    page_size: i64,
    query: &str,
    status: &str,
    sort: &str,
    billing_visible: bool,
    earnings_visible: bool,
) -> Result<Value, AppError> {
    if to < from || (to - from).num_days() > 92 {
        return Err(AppError::validation(
            "staff business range must be 93 days or less",
        ));
    }
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    let status = status.trim().to_ascii_lowercase();
    let query = query.trim().to_ascii_lowercase();
    let descending = sort != "asc";
    let total_items = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
              AND ($6='' OR LOWER(appointment.status)=$6)
              AND ($7='' OR LOWER(appointment.id||' '||appointment.notes) LIKE '%'||$7||'%'
                OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id
                  AND service.branch_id=appointment.branch_id AND LOWER(service.name) LIKE '%'||$7||'%'
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to).bind(&status).bind(&query)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to count staff business appointments"))?;
    let appointments = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',appointment.id,'staffId',appointment.staff_id,'branchId',appointment.branch_id,
              'serviceIds',COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb,
              'serviceNames',COALESCE((SELECT jsonb_agg(service.name ORDER BY service.name) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),'[]'::jsonb),
              'durationMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
              'value',COALESCE((SELECT SUM(service.price_paise) FROM services service
                WHERE service.tenant_id=appointment.tenant_id AND service.branch_id=appointment.branch_id
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))),0),
              'startAt',appointment.start_at,'endAt',appointment.end_at,'status',appointment.status,'chair','',
              'source',appointment.source,'businessDate',(appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE,
              'state',appointment.status,
              'workedMinutes',CASE WHEN LOWER(appointment.status) IN ('completed','billed','paid')
                THEN GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60) ELSE 0 END,
              'timer',jsonb_build_object('appointmentId',appointment.id,'status',appointment.status,'live',FALSE,
                'startedAt',NULL,'completedAt',NULL,'timeSource','estimated','elapsedMinutes',0,
                'totalMinutes',GREATEST(0,EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60),
                'remainingMinutes',0,'overrunMinutes',0,'progress',0),
              'billing',CASE WHEN $11 THEN (SELECT jsonb_build_object(
                'saleId',sale.id,'invoiceId',sale.id,'invoiceNumber',sale.invoice_number,'invoiceStatus',sale.status,
                'subtotalPaise',sale.subtotal_paise,'discountPaise',sale.discount_paise,'couponDiscountPaise',0,
                'afterDiscountPaise',GREATEST(sale.subtotal_paise-sale.discount_paise,0),'gstPaise',sale.tax_paise,
                'totalPaise',sale.total_paise,'paidPaise',sale.paid_paise,'duePaise',GREATEST(sale.total_paise-sale.paid_paise,0))
                FROM pos_sales sale WHERE sale.tenant_id=appointment.tenant_id AND sale.branch_id=appointment.branch_id
                  AND sale.reference_id=appointment.id AND sale.status NOT IN ('draft','cancelled','voided')
                ORDER BY sale.created_at DESC LIMIT 1) ELSE NULL END,
              'attribution',NULL)
            FROM appointments appointment
            WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
              AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
              AND ($6='' OR LOWER(appointment.status)=$6)
              AND ($7='' OR LOWER(appointment.id||' '||appointment.notes) LIKE '%'||$7||'%'
                OR EXISTS(SELECT 1 FROM services service WHERE service.tenant_id=appointment.tenant_id
                  AND service.branch_id=appointment.branch_id AND LOWER(service.name) LIKE '%'||$7||'%'
                  AND service.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb))))
            ORDER BY CASE WHEN $8 THEN appointment.start_at END DESC,CASE WHEN NOT $8 THEN appointment.start_at END ASC
            OFFSET $9 LIMIT $10"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to).bind(&status).bind(&query)
    .bind(descending).bind((page - 1) * page_size).bind(page_size).bind(billing_visible)
    .fetch_all(db).await.map_err(|_| AppError::internal("failed to load staff business appointments"))?;
    let staff = enterprise_os(db, tenant_id, branch_id, user_id, from, to).await?["staff"].clone();
    let summary = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'appointments',COUNT(*),'completedServices',COUNT(*) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),
              'scheduledMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60),0),
              'completedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
              'workedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
              'bills',COALESCE((SELECT COUNT(DISTINCT sale.id) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2
                AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'subtotalPaise',COALESCE((SELECT SUM(sale.subtotal_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'discountPaise',COALESCE((SELECT SUM(sale.discount_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'couponDiscountPaise',0,'afterDiscountPaise',0,
              'gstPaise',COALESCE((SELECT SUM(sale.tax_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'totalPaise',COALESCE((SELECT SUM(sale.total_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'paidPaise',COALESCE((SELECT SUM(sale.paid_paise) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0),
              'duePaise',COALESCE((SELECT SUM(GREATEST(sale.total_paise-sale.paid_paise,0)) FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.staff_id=$3 AND COALESCE(sale.business_date,sale.created_at::DATE) BETWEEN $4 AND $5 AND sale.status NOT IN ('draft','cancelled','voided')),0))
            FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
              AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business summary"))?;
    let services = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name) FROM services WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY name,id",
    )
    .bind(tenant_id).bind(branch_id).fetch_all(db).await
    .map_err(|_| AppError::internal("failed to load staff business services"))?;
    let performance = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'statusCounts',(SELECT jsonb_build_object(
            'booked',COUNT(*) FILTER(WHERE LOWER(status) IN ('booked','scheduled','pending','queued')),
            'confirmed',COUNT(*) FILTER(WHERE LOWER(status)='confirmed'),
            'arrived',COUNT(*) FILTER(WHERE LOWER(status) IN ('arrived','checked-in','checked_in')),
            'inService',COUNT(*) FILTER(WHERE LOWER(status) IN ('in-service','in service','inprogress','in progress','started','active','running')),
            'completed',COUNT(*) FILTER(WHERE LOWER(status) IN ('completed','billed','paid','checked-out','checked_out','checkout','done')),
            'cancelled',COUNT(*) FILTER(WHERE LOWER(status) IN ('cancelled','canceled','voided')),
            'noShow',COUNT(*) FILTER(WHERE LOWER(status) IN ('no-show','no show','noshow')),
            'other',COUNT(*) FILTER(WHERE LOWER(status) NOT IN ('booked','scheduled','pending','queued','confirmed','arrived','checked-in','checked_in','in-service','in service','inprogress','in progress','started','active','running','completed','billed','paid','checked-out','checked_out','checkout','done','cancelled','canceled','voided','no-show','no show','noshow')))
            FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5),
          'invoiceCount',COALESCE((SELECT COUNT(*) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,created_at::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','cancelled','voided')),0),
          'actualWorkedMinutes',COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'estimatedWorkedMinutes',$6::BIGINT,
          'attendanceMinutes',COALESCE((SELECT SUM(worked_minutes+break_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'breakMinutes',COALESCE((SELECT SUM(break_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
          'dutyMinutes',$7::BIGINT,
          'utilizationPercent',CASE WHEN $7::BIGINT>0 THEN ROUND(COALESCE((SELECT SUM(worked_minutes) FROM staff_attendance_records WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0)::NUMERIC*100/$7::BIGINT,1) ELSE NULL END,
          'attributedGrossPaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(base_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0) ELSE NULL END,
          'attributedDiscountPaise',CASE WHEN $8 THEN 0 ELSE NULL END,'attributedCouponDiscountPaise',CASE WHEN $8 THEN 0 ELSE NULL END,
          'attributedAfterDiscountPaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(base_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0) ELSE NULL END,
          'attributedGstPaise',CASE WHEN $8 THEN 0 ELSE NULL END,'attributedPaidPaise',CASE WHEN $8 THEN $9::BIGINT ELSE NULL END,
          'attributedDuePaise',CASE WHEN $8 THEN $10::BIGINT ELSE NULL END,
          'averageBillPaise',CASE WHEN $8 AND $11::BIGINT>0 THEN $12::BIGINT/$11::BIGINT ELSE NULL END,
          'revenuePerWorkedHourPaise',CASE WHEN $8 AND $6::BIGINT>0 THEN $12::BIGINT*60/$6::BIGINT ELSE NULL END,
          'serviceRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='service'),0) ELSE NULL END,
          'productRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='product'),0) ELSE NULL END,
          'membershipRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='membership'),0) ELSE NULL END,
          'packageRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='package'),0) ELSE NULL END,
          'giftCardRevenuePaise',CASE WHEN $8 THEN COALESCE((SELECT SUM(snapshot.base_paise) FROM pos_staff_commission_snapshots snapshot JOIN pos_sale_lines line ON line.id=snapshot.sale_line_id WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date BETWEEN $4 AND $5 AND line.line_type='gift_card'),0) ELSE NULL END)"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .bind(summary["workedMinutes"].as_i64().unwrap_or_default())
    .bind(summary["scheduledMinutes"].as_i64().unwrap_or_default()).bind(billing_visible)
    .bind(summary["paidPaise"].as_i64().unwrap_or_default()).bind(summary["duePaise"].as_i64().unwrap_or_default())
    .bind(summary["bills"].as_i64().unwrap_or_default()).bind(summary["totalPaise"].as_i64().unwrap_or_default())
    .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business performance"))?;
    let daily_breakdown = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object('date',(start_at AT TIME ZONE 'Asia/Kolkata')::DATE,
          'appointments',COUNT(*),'completedServices',COUNT(*) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),
          'scheduledMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60),0),
          'completedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
          'workedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
          'bills',0,'subtotalPaise',0,'discountPaise',0,'couponDiscountPaise',0,'afterDiscountPaise',0,'gstPaise',0,'totalPaise',0,'paidPaise',0,'duePaise',0,
          'performance',jsonb_build_object('statusCounts',jsonb_build_object(),'invoiceCount',0,'actualWorkedMinutes',0,
            'estimatedWorkedMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60) FILTER(WHERE LOWER(status) IN ('completed','billed','paid')),0),
            'attendanceMinutes',0,'breakMinutes',0,'dutyMinutes',COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))::BIGINT/60),0),'utilizationPercent',NULL))
          FROM appointments WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND (start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $4 AND $5
          GROUP BY (start_at AT TIME ZONE 'Asia/Kolkata')::DATE ORDER BY (start_at AT TIME ZONE 'Asia/Kolkata')::DATE DESC"#,
    )
    .bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
    .fetch_all(db).await.map_err(|_| AppError::internal("failed to load staff daily business breakdown"))?;
    let earnings = if earnings_visible {
        Some(sqlx::query_scalar::<_, Value>(
            r#"SELECT jsonb_build_object(
              'calculatedCommissionPaise',COALESCE((SELECT SUM(commission_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
              'approvedCommissionPaise',COALESCE((SELECT SUM(commission_paise) FROM pos_staff_commission_snapshots WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND business_date BETWEEN $4 AND $5),0),
              'tipsCollectedPaise',COALESCE((SELECT SUM(tip_paise) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,created_at::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','voided','cancelled','refunded')),0),
              'tipsPaidPaise',COALESCE((SELECT SUM(amount_paise) FROM staff_tip_payouts WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND period_start<=$5 AND period_end>=$4),0),
              'tipsPendingPaise',GREATEST(COALESCE((SELECT SUM(tip_paise) FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND COALESCE(business_date,created_at::DATE) BETWEEN $4 AND $5 AND status NOT IN ('draft','voided','cancelled','refunded')),0)-COALESCE((SELECT SUM(amount_paise) FROM staff_tip_payouts WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND period_start<=$5 AND period_end>=$4),0),0),
              'payrollGrossPaise',COALESCE((SELECT SUM(item.gross_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4),0),
              'payrollNetPaise',COALESCE((SELECT SUM(item.net_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4),0),
              'payrollPaidPaise',COALESCE((SELECT SUM(item.net_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4 AND run.status='paid'),0),
              'payrollPendingPaise',COALESCE((SELECT SUM(item.net_paise) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4 AND run.status<>'paid'),0),
              'periods',COALESCE((SELECT jsonb_agg(jsonb_build_object('payrollRunId',run.id,'periodStart',run.period_start,'periodEnd',run.period_end,'status',run.status,'grossPaise',item.gross_paise,'netPaise',item.net_paise) ORDER BY run.period_end DESC) FROM staff_payroll_items item JOIN staff_payroll_runs run ON run.id=item.payroll_run_id WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.staff_id=$3 AND run.period_start<=$5 AND run.period_end>=$4),'[]'::jsonb))"#,
        ).bind(tenant_id).bind(branch_id).bind(&staff_id).bind(from).bind(to)
        .fetch_one(db).await.map_err(|_| AppError::internal("failed to load staff business earnings"))?)
    } else {
        None
    };
    let total_pages = (total_items + page_size - 1) / page_size;
    Ok(json!({
        "date":to,"range":{"from":from,"to":to,"timeZone":"Asia/Kolkata"},"staff":staff,
        "billingVisible":billing_visible,"permissions":{"billing":billing_visible,"earnings":earnings_visible,"targets":true,"invoiceDetail":billing_visible},
        "summary":summary,
        "performance":performance,
        "earnings":earnings,"targets":[],"services":services,"dailyBreakdown":daily_breakdown,
        "pagination":{"page":page,"pageSize":page_size,"totalItems":total_items,"totalPages":total_pages,"hasMore":page<total_pages},
        "appointments":appointments
    }))
}

pub async fn business_invoice(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    invoice_id: &str,
) -> Result<Value, AppError> {
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
              'id',sale.id,'invoiceNumber',sale.invoice_number,
              'clientName',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Customer'),
              'status',sale.status,'appointmentId',sale.reference_id,'createdAt',sale.created_at,
              'totals',jsonb_build_object('saleId',sale.id,'invoiceId',sale.id,'invoiceNumber',sale.invoice_number,
                'invoiceStatus',sale.status,'subtotalPaise',sale.subtotal_paise,'discountPaise',sale.discount_paise,
                'couponDiscountPaise',0,'afterDiscountPaise',GREATEST(sale.subtotal_paise-sale.discount_paise,0),
                'gstPaise',sale.tax_paise,'totalPaise',sale.total_paise,'paidPaise',sale.paid_paise,
                'duePaise',GREATEST(sale.total_paise-sale.paid_paise,0)),
              'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',line.id,'name',line.item_name,'type',line.line_type,
                'quantity',line.quantity,'amountPaise',line.line_total_paise) ORDER BY line.created_at) FROM pos_sale_lines line WHERE line.sale_id=sale.id),'[]'::jsonb),
              'payments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',payment.id,'mode',payment.method,
                'amount',payment.amount_paise,'amountPaise',payment.amount_paise,'createdAt',payment.created_at) ORDER BY payment.created_at)
                FROM pos_payments payment WHERE payment.sale_id=sale.id),'[]'::jsonb))
            FROM pos_sales sale LEFT JOIN clients client ON client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id AND client.id=sale.client_id
            WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$3
              AND (sale.staff_id=$4 OR EXISTS(SELECT 1 FROM pos_sale_lines line WHERE line.sale_id=sale.id AND line.staff_id=$4)
                OR EXISTS(SELECT 1 FROM pos_staff_commission_snapshots snapshot WHERE snapshot.sale_id=sale.id AND snapshot.staff_id=$4))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(invoice_id.trim()).bind(&staff_id)
    .fetch_optional(db).await.map_err(|_| AppError::internal("failed to load staff invoice"))?
    .ok_or_else(|| AppError::not_found("staff invoice was not found"))
}
