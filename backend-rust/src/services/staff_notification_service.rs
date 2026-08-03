use chrono::{NaiveDate, NaiveTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

use crate::{models::common::AppError, services::staff_enterprise_service};

const CATEGORIES: &[&str] = &[
    "appointments",
    "service",
    "checkout",
    "tips",
    "attendance",
    "leave_schedule",
    "payroll",
    "daily_summary",
    "tasks",
    "stock",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfNotificationPreferenceRequest {
    pub working_day_only: bool,
    pub in_app_enabled: bool,
    pub web_push_enabled: bool,
    pub fcm_enabled: bool,
    pub apns_enabled: bool,
    pub muted_categories: Vec<String>,
    pub quiet_hours_start: Option<NaiveTime>,
    pub quiet_hours_end: Option<NaiveTime>,
    pub daily_start_enabled: bool,
    pub daily_end_enabled: bool,
    pub daily_start_time: NaiveTime,
    pub daily_end_time: NaiveTime,
    pub version: i32,
}

#[derive(Debug, FromRow)]
struct DailyCandidate {
    tenant_id: String,
    branch_id: String,
    staff_id: String,
    user_id: String,
    business_date: NaiveDate,
    start_due: bool,
    end_due: bool,
}

pub async fn center(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    provider_configured: bool,
) -> Result<Value, AppError> {
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    let preferences = preference_value(db, tenant_id, branch_id, &staff_id).await?;
    let notifications = sqlx::query_scalar::<_, Value>(
        r#"WITH preference AS (
              SELECT COALESCE(in_app_enabled,TRUE) in_app_enabled,COALESCE(muted_categories,'{}') muted_categories
                FROM staff_notification_preferences WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$4
            )
            SELECT jsonb_build_object(
              'id',notification.id,'title',notification.title,'body',notification.body,
              'status',CASE WHEN notification.is_read THEN 'read' ELSE 'unread' END,
              'type',notification.notification_type,
              'category',COALESCE(NULLIF(notification.metadata_json->>'category',''),'appointments'),
              'resourceType',notification.resource_type,'resourceId',notification.resource_id,
              'metadata',notification.metadata_json,'createdAt',notification.created_at)
            FROM notifications notification
            WHERE notification.tenant_id=$1 AND notification.branch_id=$2
              AND (notification.user_id='' OR notification.user_id=$3) AND notification.archived_at IS NULL
              AND COALESCE((SELECT in_app_enabled FROM preference),TRUE)
              AND NOT (COALESCE(NULLIF(notification.metadata_json->>'category',''),'appointments') = ANY(
                COALESCE((SELECT muted_categories FROM preference),'{}'::TEXT[])))
            ORDER BY notification.created_at DESC LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(user_id)
    .bind(&staff_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load notification center inbox"))?;
    let channel_state = sqlx::query_scalar::<_, Value>(
        r#"SELECT jsonb_build_object(
          'inApp',jsonb_build_object('enabled',COALESCE(preference.in_app_enabled,TRUE),'configured',TRUE,'devices',0),
          'webPush',jsonb_build_object('enabled',COALESCE(preference.web_push_enabled,TRUE),'configured',$4,
            'devices',COUNT(device.id) FILTER(WHERE LOWER(device.platform)='web' AND device.push_enabled)),
          'fcm',jsonb_build_object('enabled',COALESCE(preference.fcm_enabled,TRUE),'configured',$4,
            'devices',COUNT(device.id) FILTER(WHERE LOWER(device.platform) IN ('android','fcm') AND device.push_enabled)),
          'apns',jsonb_build_object('enabled',COALESCE(preference.apns_enabled,TRUE),'configured',$4,
            'devices',COUNT(device.id) FILTER(WHERE LOWER(device.platform) IN ('ios','apns') AND device.push_enabled)))
        FROM staff employee
        LEFT JOIN staff_notification_preferences preference ON preference.tenant_id=employee.tenant_id AND preference.branch_id=employee.branch_id AND preference.staff_id=employee.id
        LEFT JOIN staff_mobile_devices device ON device.tenant_id=employee.tenant_id AND device.branch_id=employee.branch_id AND device.staff_id=employee.id AND device.active=TRUE
        WHERE employee.tenant_id=$1 AND employee.branch_id=$2 AND employee.id=$3
        GROUP BY preference.in_app_enabled,preference.web_push_enabled,preference.fcm_enabled,preference.apns_enabled"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(provider_configured)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load notification channel state"))?;
    let delivery_logs = sqlx::query_scalar::<_, Value>(
        r#"SELECT row FROM (
          SELECT jsonb_build_object('id',log.id,'channel',CASE WHEN LOWER(device.platform)='web' THEN 'web_push' WHEN LOWER(device.platform) IN ('ios','apns') THEN 'apns' ELSE 'fcm' END,
            'provider',log.provider,'status',log.status,'attempt',log.attempt_no,'providerMessageId',log.provider_message_id,
            'error',log.error_message,'createdAt',log.created_at) row,log.created_at
          FROM mobile_push_delivery_attempt_logs log JOIN staff_mobile_devices device ON device.id=log.device_id
          WHERE log.tenant_id=$1 AND log.branch_id=$2 AND device.staff_id=$3
          UNION ALL
          SELECT jsonb_build_object('id',log.id,'channel',queue.channel,'provider',log.provider,'status',log.delivery_status,
            'attempt',queue.delivery_attempts,'providerMessageId',log.provider_message_id,'error',log.error_message,'createdAt',log.created_at),log.created_at
          FROM staff_notification_delivery_logs log JOIN staff_notification_queue queue ON queue.id=log.queue_id
          WHERE log.tenant_id=$1 AND log.branch_id=$2 AND queue.staff_id=$3
        ) delivery ORDER BY created_at DESC LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load notification delivery logs"))?;
    let business_date = Utc::now()
        .with_timezone(&chrono::FixedOffset::east_opt(19_800).expect("India offset is valid"))
        .date_naive();
    let workflow = daily_workflow(db, tenant_id, branch_id, &staff_id, business_date).await?;
    Ok(json!({
        "preferences":preferences,"channels":channel_state,"notifications":notifications,
        "deliveryLogs":delivery_logs,"dailyWorkflow":workflow,"generatedAt":Utc::now()
    }))
}

pub async fn save_preferences(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    request: SelfNotificationPreferenceRequest,
) -> Result<Value, AppError> {
    if request.quiet_hours_start.is_some() != request.quiet_hours_end.is_some() {
        return Err(AppError::validation(
            "quiet hours start and end must be provided together",
        ));
    }
    let mut categories = request
        .muted_categories
        .into_iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    categories.sort();
    categories.dedup();
    if categories
        .iter()
        .any(|value| !CATEGORIES.contains(&value.as_str()))
    {
        return Err(AppError::validation("notification category is invalid"));
    }
    let staff_id =
        staff_enterprise_service::self_staff_id(db, tenant_id, branch_id, user_id).await?;
    sqlx::query_scalar::<_, Value>(
        r#"INSERT INTO staff_notification_preferences(
          tenant_id,branch_id,staff_id,whatsapp_opt_in,allow_payroll_amounts,language_code,
          quiet_hours_start,quiet_hours_end,working_day_only,in_app_enabled,web_push_enabled,fcm_enabled,apns_enabled,
          muted_categories,daily_start_enabled,daily_end_enabled,daily_start_time,daily_end_time)
        VALUES($1,$2,$3,FALSE,FALSE,'en-IN',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT(tenant_id,branch_id,staff_id) DO UPDATE SET
          quiet_hours_start=EXCLUDED.quiet_hours_start,quiet_hours_end=EXCLUDED.quiet_hours_end,
          working_day_only=EXCLUDED.working_day_only,in_app_enabled=EXCLUDED.in_app_enabled,
          web_push_enabled=EXCLUDED.web_push_enabled,fcm_enabled=EXCLUDED.fcm_enabled,apns_enabled=EXCLUDED.apns_enabled,
          muted_categories=EXCLUDED.muted_categories,daily_start_enabled=EXCLUDED.daily_start_enabled,
          daily_end_enabled=EXCLUDED.daily_end_enabled,daily_start_time=EXCLUDED.daily_start_time,
          daily_end_time=EXCLUDED.daily_end_time,version=staff_notification_preferences.version+1,updated_at=NOW()
        WHERE staff_notification_preferences.version=$16
        RETURNING jsonb_build_object(
          'staffId',staff_id,'workingDayOnly',working_day_only,'inAppEnabled',in_app_enabled,
          'webPushEnabled',web_push_enabled,'fcmEnabled',fcm_enabled,'apnsEnabled',apns_enabled,
          'mutedCategories',muted_categories,'quietHoursStart',quiet_hours_start,'quietHoursEnd',quiet_hours_end,
          'dailyStartEnabled',daily_start_enabled,'dailyEndEnabled',daily_end_enabled,
          'dailyStartTime',daily_start_time,'dailyEndTime',daily_end_time,'version',version)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&staff_id)
    .bind(request.quiet_hours_start)
    .bind(request.quiet_hours_end)
    .bind(request.working_day_only)
    .bind(request.in_app_enabled)
    .bind(request.web_push_enabled)
    .bind(request.fcm_enabled)
    .bind(request.apns_enabled)
    .bind(categories)
    .bind(request.daily_start_enabled)
    .bind(request.daily_end_enabled)
    .bind(request.daily_start_time)
    .bind(request.daily_end_time)
    .bind(request.version)
    .fetch_optional(db)
    .await
    .map_err(|_| AppError::internal("failed to save notification preferences"))?
    .ok_or_else(|| AppError::conflict("notification preferences changed; reload and retry"))
}

async fn preference_value(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Value, AppError> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'staffId',employee.id,'workingDayOnly',COALESCE(preference.working_day_only,TRUE),
          'inAppEnabled',COALESCE(preference.in_app_enabled,TRUE),'webPushEnabled',COALESCE(preference.web_push_enabled,TRUE),
          'fcmEnabled',COALESCE(preference.fcm_enabled,TRUE),'apnsEnabled',COALESCE(preference.apns_enabled,TRUE),
          'mutedCategories',COALESCE(preference.muted_categories,'{}'::TEXT[]),
          'quietHoursStart',preference.quiet_hours_start,'quietHoursEnd',preference.quiet_hours_end,
          'dailyStartEnabled',COALESCE(preference.daily_start_enabled,TRUE),'dailyEndEnabled',COALESCE(preference.daily_end_enabled,TRUE),
          'dailyStartTime',COALESCE(preference.daily_start_time,'08:00'::TIME),
          'dailyEndTime',COALESCE(preference.daily_end_time,'20:00'::TIME),'version',COALESCE(preference.version,0))
        FROM staff employee LEFT JOIN staff_notification_preferences preference
          ON preference.tenant_id=employee.tenant_id AND preference.branch_id=employee.branch_id AND preference.staff_id=employee.id
        WHERE employee.tenant_id=$1 AND employee.branch_id=$2 AND employee.id=$3 AND employee.active=TRUE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load notification preferences"))
}

pub async fn daily_workflow(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    business_date: NaiveDate,
) -> Result<Value, AppError> {
    sqlx::query_scalar(
        r#"WITH own_appointments AS (
          SELECT appointment.* FROM appointments appointment
          WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2 AND appointment.staff_id=$3
            AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=$4
        ), appointment_facts AS (
          SELECT COUNT(*) FILTER(WHERE status NOT IN ('cancelled','canceled','void'))::BIGINT today_guests,
            COUNT(*) FILTER(WHERE requested_staff_id=$3 OR staff_preference IN ('specific','specific_provider'))::BIGINT specific_requests,
            COUNT(*) FILTER(WHERE status NOT IN ('cancelled','canceled','void') AND NOT EXISTS(
              SELECT 1 FROM appointments previous WHERE previous.tenant_id=$1 AND previous.branch_id=$2
                AND previous.client_id=own_appointments.client_id AND previous.start_at<own_appointments.start_at
                AND previous.status IN ('completed','billed','paid')))::BIGINT new_guests,
            COUNT(*) FILTER(WHERE status IN ('completed','billed','paid'))::BIGINT completed_services,
            COUNT(*) FILTER(WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM pos_sales sale
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.reference_id=own_appointments.id
                AND sale.status NOT IN ('draft','cancelled','voided')))::BIGINT missing_checkout,
            COUNT(*) FILTER(WHERE status IN ('completed','billed','paid') AND NOT EXISTS(SELECT 1 FROM inventory_backbar_usage usage
              WHERE usage.tenant_id=$1 AND usage.branch_id=$2 AND usage.appointment_id=own_appointments.id
                AND usage.staff_id=$3 AND usage.reversed_at IS NULL))::BIGINT missing_consumables,
            COALESCE(SUM(EXTRACT(EPOCH FROM (end_at-start_at))/60) FILTER(WHERE status NOT IN ('cancelled','canceled','void')),0)::BIGINT booked_minutes
          FROM own_appointments
        ), schedule AS (
          SELECT COALESCE(SUM(
            CASE WHEN shift1_start IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM ((schedule_date+shift1_end)+CASE WHEN shift1_end<=shift1_start THEN INTERVAL '1 day' ELSE INTERVAL '0' END-(schedule_date+shift1_start)))/60 END +
            CASE WHEN shift2_start IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM ((schedule_date+shift2_end)+CASE WHEN shift2_end<=shift2_start THEN INTERVAL '1 day' ELSE INTERVAL '0' END-(schedule_date+shift2_start)))/60 END),0)::BIGINT scheduled_minutes
          FROM staff_schedules WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND schedule_date=$4 AND status='working'
        ), form_facts AS (
          SELECT COUNT(*)::BIGINT pending_forms FROM own_appointments appointment
          JOIN client_form_definitions definition ON definition.tenant_id=$1 AND definition.branch_id=$2 AND definition.active=TRUE AND definition.required=TRUE
            AND (definition.scope_type='guest' OR (definition.scope_type='service' AND EXISTS(
              SELECT 1 FROM jsonb_array_elements_text(definition.scope_ids_json) AS scoped(value)
              WHERE scoped.value IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::jsonb)))))
          WHERE appointment.status NOT IN ('cancelled','canceled','void') AND NOT EXISTS(
            SELECT 1 FROM client_form_submissions submission WHERE submission.tenant_id=$1 AND submission.branch_id=$2
              AND submission.appointment_id=appointment.id AND submission.definition_id=definition.id AND submission.status='submitted'
              AND (submission.expires_at IS NULL OR submission.expires_at>NOW()))
        ), sale_facts AS (
          SELECT COALESCE(SUM(sale.total_paise) FILTER(WHERE sale.staff_id=$3 OR EXISTS(SELECT 1 FROM pos_sale_lines line WHERE line.sale_id=sale.id AND line.staff_id=$3)),0)::BIGINT sales_paise,
            COALESCE(SUM(CASE WHEN sale.staff_id=$3 THEN sale.tip_paise ELSE 0 END),0)::BIGINT tips_paise
          FROM pos_sales sale WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND COALESCE(sale.business_date,(sale.created_at AT TIME ZONE 'Asia/Kolkata')::DATE)=$4
            AND sale.status NOT IN ('draft','cancelled','voided','refunded')
        )
        SELECT jsonb_build_object('businessDate',$4,
          'start',jsonb_build_object(
            'todayGuests',appointment_facts.today_guests,'specificRequests',appointment_facts.specific_requests,
            'newGuests',appointment_facts.new_guests,'scheduledMinutes',schedule.scheduled_minutes,
            'gapMinutes',GREATEST(schedule.scheduled_minutes-appointment_facts.booked_minutes,0),
            'requiredForms',form_facts.pending_forms,
            'stockAlerts',(SELECT COUNT(*) FROM inventory_items item WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.active=TRUE AND item.stock_quantity<=GREATEST(item.reorder_point,item.alert_level)),
            'serviceAlerts',(SELECT COUNT(*) FROM own_appointments WHERE status NOT IN ('cancelled','canceled','void') AND COALESCE(chair_room_id,'')=''),
            'pendingTasks',(SELECT COUNT(*) FROM staff_tasks task WHERE task.tenant_id=$1 AND task.branch_id=$2 AND task.staff_id=$3 AND task.status IN ('open','in_progress','blocked'))),
          'end',jsonb_build_object(
            'completedServices',appointment_facts.completed_services,'salesPaise',sale_facts.sales_paise,
            'commissionPaise',(SELECT COALESCE(SUM(snapshot.commission_paise),0) FROM pos_staff_commission_snapshots snapshot WHERE snapshot.tenant_id=$1 AND snapshot.branch_id=$2 AND snapshot.staff_id=$3 AND snapshot.business_date=$4),
            'tipsPaise',sale_facts.tips_paise,'missingCheckout',appointment_facts.missing_checkout,
            'missingForms',form_facts.pending_forms,'missingConsumables',appointment_facts.missing_consumables))
        FROM appointment_facts CROSS JOIN schedule CROSS JOIN form_facts CROSS JOIN sale_facts"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(business_date)
    .fetch_one(db)
    .await
    .map_err(|error| {
        #[cfg(test)]
        eprintln!("daily workflow query error: {error:?}");
        tracing::error!(%error, "failed to calculate daily staff workflow");
        AppError::internal("failed to calculate daily staff workflow")
    })
}

pub async fn process_automation(db: &PgPool) -> Result<u64, AppError> {
    let mut affected = schedule_clock_in_reminders(db).await?;
    affected += project_appointment_events(db).await?;
    affected += project_tip_events(db).await?;
    affected += deliver_in_app_queue(db).await?;
    affected += create_daily_summaries(db).await?;
    Ok(affected)
}

async fn schedule_clock_in_reminders(db: &PgPool) -> Result<u64, AppError> {
    sqlx::query(
        r#"WITH shifts AS (
          SELECT schedule.tenant_id,schedule.branch_id,schedule.staff_id,schedule.schedule_date,shift.no,shift.starts_at
          FROM staff_schedules schedule CROSS JOIN LATERAL (VALUES(1,schedule.shift1_start),(2,schedule.shift2_start)) shift(no,starts_at)
          WHERE schedule.status='working' AND schedule.schedule_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AND shift.starts_at IS NOT NULL
        )
        INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json,idempotency_key)
        SELECT shift.tenant_id,shift.branch_id,employee.user_id,'system','staff_clock_in_reminder','Clock-in reminder',
          'Your scheduled shift starts soon.','staff_schedule',shift.staff_id,
          jsonb_build_object('category','attendance','deepLink','/staff/attendance','businessDate',shift.schedule_date,'shift',shift.no),
          'clock-in:'||shift.staff_id||':'||shift.schedule_date||':'||shift.no
        FROM shifts shift JOIN staff employee ON employee.tenant_id=shift.tenant_id AND employee.branch_id=shift.branch_id AND employee.id=shift.staff_id AND employee.active=TRUE
        WHERE employee.user_id IS NOT NULL
          AND (shift.schedule_date+shift.starts_at AT TIME ZONE 'Asia/Kolkata') BETWEEN NOW()-INTERVAL '10 minutes' AND NOW()+INTERVAL '15 minutes'
          AND NOT EXISTS(SELECT 1 FROM staff_attendance_sessions session WHERE session.tenant_id=shift.tenant_id AND session.branch_id=shift.branch_id
            AND session.staff_id=shift.staff_id AND session.business_date=shift.schedule_date AND session.superseded_at IS NULL)
        ON CONFLICT(tenant_id,branch_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
    .map_err(|_| AppError::internal("failed to schedule clock-in reminders"))
}

async fn project_appointment_events(db: &PgPool) -> Result<u64, AppError> {
    sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json,idempotency_key)
        SELECT activity.tenant_id,activity.branch_id,employee.user_id,'appointment-automation',
          CASE
            WHEN activity.action IN ('CONFIRMED','BOOKING_CREATED') THEN 'appointment_confirmation'
            WHEN activity.action='ARRIVED' THEN 'guest_check_in'
            WHEN activity.action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED','CALENDAR_MOVED') THEN 'appointment_rescheduled'
            WHEN activity.action IN ('CANCELLED','NO_SHOW') THEN 'appointment_cancelled'
            WHEN activity.action='SERVICE_STARTED' THEN 'service_started'
            WHEN activity.action IN ('SERVICE_COMPLETED','APPOINTMENT_COMPLETED') THEN 'service_completed'
            WHEN activity.action='PROVIDER_HANDOFF' THEN 'next_provider'
            ELSE 'guest_checkout' END,
          CASE
            WHEN activity.action IN ('CONFIRMED','BOOKING_CREATED') THEN 'Appointment confirmed'
            WHEN activity.action='ARRIVED' THEN 'Guest checked in'
            WHEN activity.action IN ('BOOKING_RESCHEDULED','RESCHEDULE_APPROVED','CALENDAR_MOVED') THEN 'Appointment rescheduled'
            WHEN activity.action IN ('CANCELLED','NO_SHOW') THEN 'Appointment cancelled'
            WHEN activity.action='SERVICE_STARTED' THEN 'Service started'
            WHEN activity.action IN ('SERVICE_COMPLETED','APPOINTMENT_COMPLETED') THEN 'Service completed'
            WHEN activity.action='PROVIDER_HANDOFF' THEN 'Provider handoff'
            ELSE 'Guest checkout completed' END,
          CASE WHEN activity.action='PROVIDER_HANDOFF' THEN 'This appointment is now assigned to you.' ELSE 'Open the appointment for current details.' END,
          'appointment',activity.appointment_id,
          jsonb_build_object('category',CASE WHEN activity.action IN ('SERVICE_STARTED','SERVICE_COMPLETED','APPOINTMENT_COMPLETED','PROVIDER_HANDOFF') THEN 'service' WHEN activity.action='BILLED' THEN 'checkout' ELSE 'appointments' END,
            'deepLink','/staff/appointments','action',activity.action),
          'appointment-activity:'||activity.id
        FROM appointment_activity activity
        JOIN appointments appointment ON appointment.tenant_id=activity.tenant_id AND appointment.branch_id=activity.branch_id AND appointment.id=activity.appointment_id
        JOIN staff employee ON employee.tenant_id=activity.tenant_id AND employee.branch_id=activity.branch_id AND employee.id=COALESCE(NULLIF(activity.staff_id,''),appointment.staff_id) AND employee.active=TRUE
        WHERE activity.created_at>=NOW()-INTERVAL '15 minutes' AND employee.user_id IS NOT NULL
          AND activity.action IN ('CONFIRMED','BOOKING_CREATED','ARRIVED','BOOKING_RESCHEDULED','RESCHEDULE_APPROVED','CALENDAR_MOVED','CANCELLED','NO_SHOW','SERVICE_STARTED','SERVICE_COMPLETED','APPOINTMENT_COMPLETED','PROVIDER_HANDOFF','BILLED')
        ON CONFLICT(tenant_id,branch_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
    .map_err(|_| AppError::internal("failed to project appointment notifications"))
}

async fn project_tip_events(db: &PgPool) -> Result<u64, AppError> {
    sqlx::query(
        r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json,idempotency_key)
        SELECT sale.tenant_id,sale.branch_id,employee.user_id,'pos-automation','tips_received','Tip received','A tip was recorded for your completed sale.',
          'pos_sale',sale.id,jsonb_build_object('category','tips','deepLink','/staff/payroll','tipPaise',sale.tip_paise),
          'tip:'||sale.id||':'||employee.id
        FROM pos_sales sale JOIN staff employee ON employee.tenant_id=sale.tenant_id AND employee.branch_id=sale.branch_id
          AND employee.id=COALESCE(NULLIF(sale.staff_id,''),(SELECT line.staff_id FROM pos_sale_lines line WHERE line.sale_id=sale.id AND line.staff_id<>'' LIMIT 1))
        WHERE sale.tip_paise>0 AND sale.finalized_at>=NOW()-INTERVAL '15 minutes' AND employee.user_id IS NOT NULL AND employee.active=TRUE
        ON CONFLICT(tenant_id,branch_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
    .map_err(|_| AppError::internal("failed to project tip notifications"))
}

async fn deliver_in_app_queue(db: &PgPool) -> Result<u64, AppError> {
    sqlx::query(
        r#"WITH due AS (
          SELECT queue.id,queue.tenant_id,queue.branch_id,queue.staff_id,queue.notification_type,queue.title,queue.message_body,queue.metadata_json
          FROM staff_notification_queue queue
          WHERE queue.channel='in_app' AND queue.status IN ('queued','approved') AND queue.scheduled_at<=NOW() AND queue.next_attempt_at<=NOW()
          ORDER BY queue.created_at LIMIT 100 FOR UPDATE SKIP LOCKED
        ), inserted AS (
          INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json,idempotency_key)
          SELECT due.tenant_id,due.branch_id,employee.user_id,'staff-notification-queue',due.notification_type,due.title,due.message_body,
            'staff_notification_queue',due.id,due.metadata_json||jsonb_build_object('category',CASE
              WHEN LOWER(due.notification_type) LIKE 'payroll%' THEN 'payroll'
              WHEN LOWER(due.notification_type) LIKE '%attendance%' OR LOWER(due.notification_type) LIKE '%clock%' THEN 'attendance'
              WHEN LOWER(due.notification_type) LIKE '%leave%' OR LOWER(due.notification_type) LIKE '%schedule%' THEN 'leave_schedule'
              WHEN LOWER(due.notification_type) LIKE '%tip%' THEN 'tips'
              WHEN LOWER(due.notification_type) LIKE '%task%' THEN 'tasks'
              WHEN LOWER(due.notification_type) LIKE '%stock%' OR LOWER(due.notification_type) LIKE '%inventory%' THEN 'stock'
              ELSE 'appointments' END),
            'staff-queue:'||due.id
          FROM due JOIN staff employee ON employee.tenant_id=due.tenant_id AND employee.branch_id=due.branch_id AND employee.id=due.staff_id
          WHERE employee.user_id IS NOT NULL
          ON CONFLICT(tenant_id,branch_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        ), completed AS (
          UPDATE staff_notification_queue queue SET status='sent',provider='in_app',provider_message_id=queue.id,last_error='',version=version+1,updated_at=NOW()
          FROM due WHERE queue.id=due.id RETURNING queue.id,queue.tenant_id,queue.branch_id
        )
        INSERT INTO staff_notification_delivery_logs(tenant_id,branch_id,queue_id,provider,provider_message_id,delivery_status,payload_json)
        SELECT tenant_id,branch_id,id,'in_app',id,'sent',jsonb_build_object('persisted',TRUE) FROM completed"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
    .map_err(|_| AppError::internal("failed to deliver queued in-app notifications"))
}

async fn create_daily_summaries(db: &PgPool) -> Result<u64, AppError> {
    let candidates = sqlx::query_as::<_, DailyCandidate>(
        r#"SELECT employee.tenant_id,employee.branch_id,employee.id staff_id,employee.user_id,
          (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE business_date,
          COALESCE(preference.daily_start_enabled,TRUE) AND (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME>=COALESCE(preference.daily_start_time,'08:00')
            AND NOT EXISTS(SELECT 1 FROM notifications notification WHERE notification.tenant_id=employee.tenant_id AND notification.branch_id=employee.branch_id AND notification.user_id=employee.user_id AND notification.idempotency_key='daily-start:'||(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE) start_due,
          COALESCE(preference.daily_end_enabled,TRUE) AND (NOW() AT TIME ZONE 'Asia/Kolkata')::TIME>=COALESCE(preference.daily_end_time,'20:00')
            AND NOT EXISTS(SELECT 1 FROM notifications notification WHERE notification.tenant_id=employee.tenant_id AND notification.branch_id=employee.branch_id AND notification.user_id=employee.user_id AND notification.idempotency_key='daily-end:'||(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE) end_due
        FROM staff employee LEFT JOIN staff_notification_preferences preference ON preference.tenant_id=employee.tenant_id AND preference.branch_id=employee.branch_id AND preference.staff_id=employee.id
        WHERE employee.active=TRUE AND employee.user_id IS NOT NULL AND NOT ('daily_summary'=ANY(COALESCE(preference.muted_categories,'{}'::TEXT[])))
          AND (NOT COALESCE(preference.working_day_only,TRUE) OR EXISTS(SELECT 1 FROM staff_schedules schedule WHERE schedule.tenant_id=employee.tenant_id AND schedule.branch_id=employee.branch_id AND schedule.staff_id=employee.id AND schedule.schedule_date=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AND schedule.status='working') OR EXISTS(SELECT 1 FROM appointments appointment WHERE appointment.tenant_id=employee.tenant_id AND appointment.branch_id=employee.branch_id AND appointment.staff_id=employee.id AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE))"#,
    )
    .fetch_all(db)
    .await
    .map_err(|_| AppError::internal("failed to load daily summary candidates"))?;
    let mut created = 0;
    for candidate in candidates {
        if !candidate.start_due && !candidate.end_due {
            continue;
        }
        let workflow = daily_workflow(
            db,
            &candidate.tenant_id,
            &candidate.branch_id,
            &candidate.staff_id,
            candidate.business_date,
        )
        .await?;
        for (due, kind, title, section) in [
            (candidate.start_due, "start", "Start-day summary", "start"),
            (candidate.end_due, "end", "End-day summary", "end"),
        ] {
            if !due {
                continue;
            }
            let facts = workflow.get(section).cloned().unwrap_or_else(|| json!({}));
            let body = if kind == "start" {
                format!(
                    "{} guests, {} pending tasks, {} required forms.",
                    facts["todayGuests"].as_i64().unwrap_or_default(),
                    facts["pendingTasks"].as_i64().unwrap_or_default(),
                    facts["requiredForms"].as_i64().unwrap_or_default()
                )
            } else {
                format!(
                    "{} services completed; {} checkout, form or consumable alerts.",
                    facts["completedServices"].as_i64().unwrap_or_default(),
                    facts["missingCheckout"].as_i64().unwrap_or_default()
                        + facts["missingForms"].as_i64().unwrap_or_default()
                        + facts["missingConsumables"].as_i64().unwrap_or_default()
                )
            };
            let result = sqlx::query(
                r#"INSERT INTO notifications(tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json,idempotency_key)
                VALUES($1,$2,$3,'daily-automation',$4,$5,$6,'staff_daily_workflow',$7,$8,$9)
                ON CONFLICT(tenant_id,branch_id,user_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING"#,
            )
            .bind(&candidate.tenant_id)
            .bind(&candidate.branch_id)
            .bind(&candidate.user_id)
            .bind(format!("daily_{kind}_summary"))
            .bind(title)
            .bind(body)
            .bind(candidate.business_date.to_string())
            .bind(json!({"category":"daily_summary","deepLink":"/staff/notifications","workflow":workflow}))
            .bind(format!("daily-{kind}:{}", candidate.business_date))
            .execute(db)
            .await
            .map_err(|_| AppError::internal("failed to persist daily summary"))?;
            created += result.rows_affected();
        }
    }
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::{daily_workflow, CATEGORIES};

    #[test]
    fn notification_categories_are_unique_and_stable() {
        let mut categories = CATEGORIES.to_vec();
        categories.sort_unstable();
        categories.dedup();
        assert_eq!(categories.len(), CATEGORIES.len());
        assert!(CATEGORIES.contains(&"daily_summary"));
    }

    #[tokio::test]
    async fn daily_workflow_reads_real_sources_when_database_is_available() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let db = sqlx::PgPool::connect(&url)
            .await
            .expect("database connects");
        let staff = sqlx::query_as::<_, (String, String, String)>(
            "SELECT tenant_id,branch_id,id FROM staff WHERE active=TRUE AND user_id IS NOT NULL ORDER BY created_at LIMIT 1",
        )
        .fetch_optional(&db)
        .await
        .expect("staff lookup succeeds");
        let Some((tenant, branch, staff_id)) = staff else {
            return;
        };
        let date = chrono::Utc::now()
            .with_timezone(&chrono::FixedOffset::east_opt(19_800).unwrap())
            .date_naive();
        let value = daily_workflow(&db, &tenant, &branch, &staff_id, date)
            .await
            .expect("daily workflow query succeeds");
        assert_eq!(value["businessDate"], serde_json::json!(date));
        assert!(value["start"].is_object() && value["end"].is_object());
    }
}
