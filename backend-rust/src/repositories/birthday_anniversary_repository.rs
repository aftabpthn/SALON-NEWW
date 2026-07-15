use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BirthdayAnniversarySettingsRecord {
    pub tenant_id: String,
    pub branch_id: String,
    pub workflow_mode: String,
    pub popup_enabled: bool,
    pub approval_required: bool,
    pub auto_send_enabled: bool,
    pub default_send_time: NaiveTime,
    pub timezone: String,
    pub days_ahead: i16,
    pub channels: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: String,
}

pub struct BirthdayAnniversarySettingsWrite<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub workflow_mode: &'a str,
    pub popup_enabled: bool,
    pub approval_required: bool,
    pub auto_send_enabled: bool,
    pub default_send_time: NaiveTime,
    pub timezone: &'a str,
    pub days_ahead: i16,
    pub channels: Vec<String>,
    pub actor_user_id: &'a str,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OccasionRecord {
    pub client_id: String,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub categories_json: Value,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub whatsapp_opt_in: Option<bool>,
    pub sms_opt_in: Option<bool>,
    pub email_opt_in: Option<bool>,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub completed_visits: i64,
    pub lifetime_value_paise: i64,
    pub most_used_service_id: Option<String>,
    pub most_used_service_name: String,
    pub most_used_service_visits: i64,
    pub event_type: String,
    pub event_date: NaiveDate,
    pub days_until: i32,
    pub reminder_id: Option<String>,
    pub reminder_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
    pub client_name: String,
    pub client_phone: String,
    pub client_email: String,
    pub event_type: String,
    pub event_date: NaiveDate,
    pub status: String,
    pub channels: Vec<String>,
    pub message_options_json: Value,
    pub selected_message: String,
    pub coupon_id: Option<String>,
    pub coupon_code: Option<String>,
    pub scheduled_send_at: Option<DateTime<Utc>>,
    pub approved_by: String,
    pub approved_at: Option<DateTime<Utc>>,
    pub queued_at: Option<DateTime<Utc>>,
    pub sent_at: Option<DateTime<Utc>>,
    pub failure_reason: String,
    pub version: i32,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct ReminderFilter<'a> {
    pub client_id: Option<&'a str>,
    pub status: Option<&'a str>,
    pub event_type: Option<&'a str>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
    pub limit: i64,
    pub offset: i64,
}

pub struct DraftWrite<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub client_id: &'a str,
    pub event_type: &'a str,
    pub event_date: NaiveDate,
    pub channels: Vec<String>,
    pub message_options_json: &'a Value,
    pub selected_message: &'a str,
    pub coupon_id: Option<&'a str>,
    pub scheduled_send_at: Option<DateTime<Utc>>,
    pub actor_user_id: &'a str,
}

pub struct ApproveReminder<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub reminder_id: &'a str,
    pub selected_message: &'a str,
    pub coupon_id: Option<&'a str>,
    pub scheduled_send_at: Option<DateTime<Utc>>,
    pub actor_user_id: &'a str,
    pub expected_version: i32,
}

pub struct ReminderDeliveryWrite {
    pub channel: String,
    pub recipient: String,
    pub payload_json: Value,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VoucherRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub reminder_id: String,
    pub client_id: String,
    pub client_name: String,
    pub coupon_id: String,
    pub coupon_code: String,
    pub discount_type: String,
    pub discount_value_paise: i64,
    pub discount_bps: i64,
    pub status: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub issued_by: String,
    pub issued_at: DateTime<Utc>,
    pub sent_at: Option<DateTime<Utc>>,
    pub redeemed_at: Option<DateTime<Utc>>,
    pub redeemed_sale_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct VoucherFilter<'a> {
    pub client_id: Option<&'a str>,
    pub status: Option<&'a str>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BirthdayAnniversaryAuditRecord {
    pub id: String,
    pub client_id: Option<String>,
    pub client_name: String,
    pub reminder_id: Option<String>,
    pub voucher_id: Option<String>,
    pub action: String,
    pub details_json: Value,
    pub actor_user_id: String,
    pub created_at: DateTime<Utc>,
}

pub struct AuditFilter<'a> {
    pub client_id: Option<&'a str>,
    pub reminder_id: Option<&'a str>,
    pub action: Option<&'a str>,
    pub limit: i64,
    pub offset: i64,
}

pub async fn get_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<BirthdayAnniversarySettingsRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT tenant_id,branch_id,workflow_mode,popup_enabled,approval_required,
                  auto_send_enabled,default_send_time,timezone,days_ahead,channels,
                  created_at,updated_at,updated_by
             FROM birthday_anniversary_settings
            WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_settings(
    db: &PgPool,
    input: BirthdayAnniversarySettingsWrite<'_>,
) -> Result<BirthdayAnniversarySettingsRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as(
        r#"INSERT INTO birthday_anniversary_settings(
              tenant_id,branch_id,workflow_mode,popup_enabled,approval_required,
              auto_send_enabled,default_send_time,timezone,days_ahead,channels,updated_by
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT(tenant_id,branch_id) DO UPDATE SET
              workflow_mode=EXCLUDED.workflow_mode,popup_enabled=EXCLUDED.popup_enabled,
              approval_required=EXCLUDED.approval_required,
              auto_send_enabled=EXCLUDED.auto_send_enabled,
              default_send_time=EXCLUDED.default_send_time,timezone=EXCLUDED.timezone,
              days_ahead=EXCLUDED.days_ahead,channels=EXCLUDED.channels,
              updated_by=EXCLUDED.updated_by,updated_at=NOW()
            RETURNING tenant_id,branch_id,workflow_mode,popup_enabled,approval_required,
              auto_send_enabled,default_send_time,timezone,days_ahead,channels,
              created_at,updated_at,updated_by"#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.workflow_mode)
    .bind(input.popup_enabled)
    .bind(input.approval_required)
    .bind(input.auto_send_enabled)
    .bind(input.default_send_time)
    .bind(input.timezone)
    .bind(input.days_ahead)
    .bind(&input.channels)
    .bind(input.actor_user_id)
    .fetch_one(&mut *tx)
    .await?;
    record_audit_tx(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        None,
        None,
        None,
        "settings.updated",
        input.actor_user_id,
        json!({
            "workflowMode": input.workflow_mode,
            "autoSendEnabled": input.auto_send_enabled,
            "daysAhead": input.days_ahead,
            "channels": input.channels,
        }),
    )
    .await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn list_occasions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    event_type: &str,
    limit: i64,
) -> Result<Vec<OccasionRecord>, sqlx::Error> {
    list_occasions_filtered(
        db, tenant_id, branch_id, from_date, to_date, event_type, None, limit,
    )
    .await
}

pub async fn list_client_occasions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    event_type: &str,
    limit: i64,
) -> Result<Vec<OccasionRecord>, sqlx::Error> {
    list_occasions_filtered(
        db,
        tenant_id,
        branch_id,
        from_date,
        to_date,
        event_type,
        Some(client_id),
        limit,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn list_occasions_filtered(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    event_type: &str,
    client_id: Option<&str>,
    limit: i64,
) -> Result<Vec<OccasionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH scoped_clients AS (
             SELECT id,first_name,last_name,phone,email,categories_json,birthday,anniversary,
                    whatsapp_opt_in,sms_opt_in,email_opt_in,last_visit_at
               FROM clients
              WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
                AND merged_into_client_id IS NULL
           ), event_years AS (
             SELECT GENERATE_SERIES(
               EXTRACT(YEAR FROM $3::DATE)::INT,
               EXTRACT(YEAR FROM $4::DATE)::INT
             ) AS event_year
           ), occasions AS (
             SELECT client.*,event.kind AS event_type,occurrence.event_date
               FROM scoped_clients client
               CROSS JOIN LATERAL (VALUES
                 ('birthday'::TEXT,client.birthday),
                 ('anniversary'::TEXT,client.anniversary)
               ) event(kind,source_date)
               CROSS JOIN event_years cycle
               CROSS JOIN LATERAL (
                 SELECT EXTRACT(MONTH FROM event.source_date)::INT AS month_number,
                        EXTRACT(DAY FROM event.source_date)::INT AS day_number
               ) date_part
               CROSS JOIN LATERAL (
                 SELECT MAKE_DATE(
                   cycle.event_year,
                   date_part.month_number,
                   LEAST(
                     date_part.day_number,
                     EXTRACT(DAY FROM (
                       MAKE_DATE(cycle.event_year,date_part.month_number,1)
                       + INTERVAL '1 month - 1 day'
                     ))::INT
                   )
                 ) AS event_date
               ) occurrence
              WHERE event.source_date IS NOT NULL
           ), visit_stats AS (
             SELECT appointment.client_id,
                    COUNT(*) FILTER (WHERE appointment.status IN ('completed','billed','paid','closed'))::BIGINT AS completed_visits
               FROM appointments appointment
              WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
              GROUP BY appointment.client_id
           ), sale_stats AS (
             SELECT sale.client_id,COALESCE(SUM(sale.total_paise),0)::BIGINT AS lifetime_value_paise
               FROM pos_sales sale
              WHERE sale.tenant_id=$1 AND sale.branch_id=$2
                AND sale.status NOT IN ('draft','cancelled','voided','refunded')
              GROUP BY sale.client_id
           ), service_usage AS (
             SELECT ranked.client_id,ranked.service_id,ranked.service_name,ranked.service_visits
               FROM (
                 SELECT appointment.client_id,requested.service_id,
                        COALESCE(service.name,requested.service_id) AS service_name,
                        COUNT(*)::BIGINT AS service_visits,
                        ROW_NUMBER() OVER (
                          PARTITION BY appointment.client_id
                          ORDER BY COUNT(*) DESC,MAX(appointment.start_at) DESC,COALESCE(service.name,requested.service_id)
                        ) AS service_rank
                   FROM appointments appointment
                   CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB) requested(service_id)
                   LEFT JOIN services service ON service.tenant_id=appointment.tenant_id
                    AND service.branch_id=appointment.branch_id AND service.id=requested.service_id
                  WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
                    AND LOWER(appointment.status) IN ('completed','billed','paid','closed')
                  GROUP BY appointment.client_id,requested.service_id,service.name
               ) ranked
              WHERE ranked.service_rank=1
           )
           SELECT occasion.id AS client_id,occasion.first_name,occasion.last_name,
                  occasion.phone,occasion.email,occasion.categories_json,
                  occasion.birthday,occasion.anniversary,occasion.whatsapp_opt_in,
                  occasion.sms_opt_in,occasion.email_opt_in,occasion.last_visit_at,
                  COALESCE(visit_stats.completed_visits,0)::BIGINT AS completed_visits,
                  COALESCE(sale_stats.lifetime_value_paise,0)::BIGINT AS lifetime_value_paise,
                  service_usage.service_id AS most_used_service_id,
                  COALESCE(service_usage.service_name,'') AS most_used_service_name,
                  COALESCE(service_usage.service_visits,0)::BIGINT AS most_used_service_visits,
                  occasion.event_type,occasion.event_date,
                  (occasion.event_date-$3::DATE)::INT AS days_until,
                  reminder.id AS reminder_id,reminder.status AS reminder_status
             FROM occasions occasion
             LEFT JOIN visit_stats ON visit_stats.client_id=occasion.id
             LEFT JOIN sale_stats ON sale_stats.client_id=occasion.id
             LEFT JOIN service_usage ON service_usage.client_id=occasion.id
             LEFT JOIN birthday_anniversary_reminders reminder
               ON reminder.tenant_id=$1 AND reminder.branch_id=$2
              AND reminder.client_id=occasion.id AND reminder.event_type=occasion.event_type
              AND EXTRACT(YEAR FROM reminder.event_date)=EXTRACT(YEAR FROM occasion.event_date)
            WHERE occasion.event_date BETWEEN $3 AND $4
              AND ($5='' OR occasion.event_type=$5)
              AND ($6::TEXT IS NULL OR occasion.id=$6)
            ORDER BY occasion.event_date,occasion.first_name,occasion.last_name,occasion.id
            LIMIT $7"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from_date)
    .bind(to_date)
    .bind(event_type)
    .bind(client_id)
    .bind(limit.clamp(1, 1000))
    .fetch_all(db)
    .await
}

pub async fn timezone_exists(db: &PgPool, timezone: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)")
        .bind(timezone)
        .fetch_one(db)
        .await
}

pub async fn today_in_timezone(db: &PgPool, timezone: &str) -> Result<NaiveDate, sqlx::Error> {
    sqlx::query_scalar("SELECT (NOW() AT TIME ZONE $1)::DATE")
        .bind(timezone)
        .fetch_one(db)
        .await
}

pub async fn list_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    filter: ReminderFilter<'_>,
) -> Result<Vec<ReminderRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT reminder.id,reminder.tenant_id,reminder.branch_id,reminder.client_id,
                  CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,
                  client.phone AS client_phone,client.email AS client_email,
                  reminder.event_type,reminder.event_date,reminder.status,reminder.channels,
                  reminder.message_options_json,reminder.selected_message,reminder.coupon_id,
                  coupon.code AS coupon_code,reminder.scheduled_send_at,reminder.approved_by,
                  reminder.approved_at,reminder.queued_at,reminder.sent_at,reminder.failure_reason,
                  reminder.version,reminder.created_by,reminder.updated_by,
                  reminder.created_at,reminder.updated_at
             FROM birthday_anniversary_reminders reminder
             JOIN clients client ON client.id=reminder.client_id
               AND client.tenant_id=reminder.tenant_id AND client.branch_id=reminder.branch_id
             LEFT JOIN pos_coupons coupon ON coupon.id=reminder.coupon_id
               AND coupon.tenant_id=reminder.tenant_id AND coupon.branch_id=reminder.branch_id
            WHERE reminder.tenant_id=$1 AND reminder.branch_id=$2
              AND ($3::TEXT IS NULL OR reminder.client_id=$3)
              AND ($4::TEXT IS NULL OR reminder.status=$4)
              AND ($5::TEXT IS NULL OR reminder.event_type=$5)
              AND ($6::DATE IS NULL OR reminder.event_date>=$6)
              AND ($7::DATE IS NULL OR reminder.event_date<=$7)
            ORDER BY reminder.event_date,reminder.created_at,reminder.id
            LIMIT $8 OFFSET $9"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(filter.client_id)
    .bind(filter.status)
    .bind(filter.event_type)
    .bind(filter.from_date)
    .bind(filter.to_date)
    .bind(filter.limit.clamp(1, 1000))
    .bind(filter.offset.max(0))
    .fetch_all(db)
    .await
}

pub async fn get_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT reminder.id,reminder.tenant_id,reminder.branch_id,reminder.client_id,
                  CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,
                  client.phone AS client_phone,client.email AS client_email,
                  reminder.event_type,reminder.event_date,reminder.status,reminder.channels,
                  reminder.message_options_json,reminder.selected_message,reminder.coupon_id,
                  coupon.code AS coupon_code,reminder.scheduled_send_at,reminder.approved_by,
                  reminder.approved_at,reminder.queued_at,reminder.sent_at,reminder.failure_reason,
                  reminder.version,reminder.created_by,reminder.updated_by,
                  reminder.created_at,reminder.updated_at
             FROM birthday_anniversary_reminders reminder
             JOIN clients client ON client.id=reminder.client_id
               AND client.tenant_id=reminder.tenant_id AND client.branch_id=reminder.branch_id
             LEFT JOIN pos_coupons coupon ON coupon.id=reminder.coupon_id
               AND coupon.tenant_id=reminder.tenant_id AND coupon.branch_id=reminder.branch_id
            WHERE reminder.tenant_id=$1 AND reminder.branch_id=$2 AND reminder.id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_draft(
    db: &PgPool,
    input: DraftWrite<'_>,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO birthday_anniversary_reminders(
              tenant_id,branch_id,client_id,event_type,event_date,status,channels,
              message_options_json,selected_message,coupon_id,scheduled_send_at,
              created_by,updated_by
            )
            SELECT $1,$2,client.id,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$11
             FROM clients client
             WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.id=$3
               AND client.active=TRUE AND client.merged_into_client_id IS NULL
               AND ($9::TEXT IS NULL OR EXISTS(
                 SELECT 1 FROM pos_coupons coupon
                  WHERE coupon.tenant_id=$1 AND coupon.branch_id=$2 AND coupon.id=$9
                    AND coupon.active=TRUE
                    AND (coupon.starts_at IS NULL OR coupon.starts_at<=NOW())
                    AND (coupon.ends_at IS NULL OR coupon.ends_at>=NOW())
               ))
            ON CONFLICT(tenant_id,branch_id,client_id,event_type,(EXTRACT(YEAR FROM event_date)))
            DO UPDATE SET event_date=EXCLUDED.event_date,channels=EXCLUDED.channels,
              message_options_json=EXCLUDED.message_options_json,
              selected_message=EXCLUDED.selected_message,coupon_id=EXCLUDED.coupon_id,
              scheduled_send_at=EXCLUDED.scheduled_send_at,failure_reason='',
              updated_by=EXCLUDED.updated_by,updated_at=NOW(),
              version=birthday_anniversary_reminders.version+1
            WHERE birthday_anniversary_reminders.status='draft'
            RETURNING id"#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.client_id)
    .bind(input.event_type)
    .bind(input.event_date)
    .bind(&input.channels)
    .bind(input.message_options_json)
    .bind(input.selected_message)
    .bind(input.coupon_id)
    .bind(input.scheduled_send_at)
    .bind(input.actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(reminder_id) = changed_id.as_deref() {
        record_audit_tx(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            Some(input.client_id),
            Some(reminder_id),
            None,
            "reminder.draft_upserted",
            input.actor_user_id,
            json!({"eventType":input.event_type,"eventDate":input.event_date}),
        )
        .await?;
    }
    tx.commit().await?;

    if let Some(reminder_id) = changed_id {
        return get_reminder(db, input.tenant_id, input.branch_id, &reminder_id).await;
    }
    get_reminder_for_event(
        db,
        input.tenant_id,
        input.branch_id,
        input.client_id,
        input.event_type,
        input.event_date,
    )
    .await
}

pub async fn get_reminder_for_event(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    event_type: &str,
    event_date: NaiveDate,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    let reminder_id = sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM birthday_anniversary_reminders
            WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND event_type=$4
              AND EXTRACT(YEAR FROM event_date)=EXTRACT(YEAR FROM $5::DATE)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(event_type)
    .bind(event_date)
    .fetch_optional(db)
    .await?;
    match reminder_id {
        Some(id) => get_reminder(db, tenant_id, branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn approve_reminder(
    db: &PgPool,
    input: ApproveReminder<'_>,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let reminder_id = sqlx::query_scalar::<_, String>(
        r#"UPDATE birthday_anniversary_reminders reminder
               SET status='approved',selected_message=$4,coupon_id=$5,
                   scheduled_send_at=$6,approved_by=$7,approved_at=NOW(),
                   failure_reason='',updated_by=$7,updated_at=NOW(),version=version+1
             WHERE reminder.tenant_id=$1 AND reminder.branch_id=$2 AND reminder.id=$3
               AND reminder.status='draft' AND reminder.version=$8
               AND ($5::TEXT IS NULL OR EXISTS(
                 SELECT 1 FROM pos_coupons coupon
                  WHERE coupon.tenant_id=$1 AND coupon.branch_id=$2 AND coupon.id=$5
                    AND coupon.active=TRUE
                    AND (coupon.starts_at IS NULL OR coupon.starts_at<=NOW())
                    AND (coupon.ends_at IS NULL OR coupon.ends_at>=NOW())
               ))
            RETURNING reminder.id"#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.reminder_id)
    .bind(input.selected_message)
    .bind(input.coupon_id)
    .bind(input.scheduled_send_at)
    .bind(input.actor_user_id)
    .bind(input.expected_version)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = reminder_id.as_deref() {
        let client_id =
            reminder_client_id_tx(&mut tx, input.tenant_id, input.branch_id, id).await?;
        record_audit_tx(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            client_id.as_deref(),
            Some(id),
            None,
            "reminder.approved",
            input.actor_user_id,
            json!({"couponId":input.coupon_id,"scheduledSendAt":input.scheduled_send_at}),
        )
        .await?;
    }
    tx.commit().await?;
    match reminder_id {
        Some(id) => get_reminder(db, input.tenant_id, input.branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn queue_reminder_deliveries(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    actor_user_id: &str,
    expected_version: i32,
    deliveries: &[ReminderDeliveryWrite],
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    if deliveries.is_empty() {
        return Ok(None);
    }

    let mut tx = db.begin().await?;
    let transitioned = sqlx::query_scalar::<_, String>(
        r#"UPDATE birthday_anniversary_reminders
               SET status='queued',queued_at=NOW(),failure_reason='',updated_by=$4,
                   updated_at=NOW(),version=version+1
             WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
               AND status='approved' AND version=$5
            RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .bind(actor_user_id)
    .bind(expected_version)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(transitioned_id) = transitioned else {
        tx.rollback().await?;
        return Ok(None);
    };

    let client_id = reminder_client_id_tx(&mut tx, tenant_id, branch_id, reminder_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    let mut queued_channels = Vec::with_capacity(deliveries.len());
    for delivery in deliveries {
        sqlx::query(
            r#"INSERT INTO benefit_notification_outbox(
                 tenant_id,branch_id,source_type,source_id,client_id,channel,recipient,payload_json
               ) VALUES($1,$2,'occasion_campaign',$3,$4,$5,$6,$7)
               ON CONFLICT(tenant_id,branch_id,source_type,source_id,channel) DO UPDATE SET
                 recipient=EXCLUDED.recipient,payload_json=EXCLUDED.payload_json,
                 status='queued',attempts=0,last_error='',next_attempt_at=NOW(),updated_at=NOW()
               WHERE benefit_notification_outbox.status NOT IN ('processing','sent')"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(reminder_id)
        .bind(&client_id)
        .bind(&delivery.channel)
        .bind(&delivery.recipient)
        .bind(&delivery.payload_json)
        .execute(&mut *tx)
        .await?;
        queued_channels.push(delivery.channel.clone());
    }

    record_audit_tx(
        &mut tx,
        tenant_id,
        branch_id,
        Some(&client_id),
        Some(&transitioned_id),
        None,
        "reminder.queued",
        actor_user_id,
        json!({"channels":queued_channels}),
    )
    .await?;
    tx.commit().await?;
    get_reminder(db, tenant_id, branch_id, &transitioned_id).await
}

pub async fn cancel_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    reason: &str,
    actor_user_id: &str,
    expected_version: i32,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    transition_reminder(
        db,
        tenant_id,
        branch_id,
        reminder_id,
        "cancelled",
        reason,
        actor_user_id,
        Some(expected_version),
    )
    .await
}

async fn transition_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    target_status: &str,
    reason: &str,
    actor_user_id: &str,
    expected_version: Option<i32>,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, String>(
        r#"UPDATE birthday_anniversary_reminders
               SET status=$4,
                   queued_at=CASE WHEN $4='queued' THEN NOW() ELSE queued_at END,
                   sent_at=CASE WHEN $4='sent' THEN NOW() ELSE sent_at END,
                   failure_reason=CASE WHEN $4 IN ('failed','blocked','cancelled') THEN $5 ELSE '' END,
                   updated_by=$6,updated_at=NOW(),version=version+1
             WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
               AND ($7::INT IS NULL OR version=$7)
               AND CASE $4
                 WHEN 'queued' THEN status='approved'
                 WHEN 'sent' THEN status IN ('approved','queued')
                 WHEN 'failed' THEN status IN ('approved','queued')
                 WHEN 'blocked' THEN status IN ('approved','queued')
                 WHEN 'cancelled' THEN status IN ('draft','approved','failed','blocked')
                 ELSE FALSE
               END
            RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .bind(target_status)
    .bind(reason)
    .bind(actor_user_id)
    .bind(expected_version)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = id.as_deref() {
        let client_id = reminder_client_id_tx(&mut tx, tenant_id, branch_id, id).await?;
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            client_id.as_deref(),
            Some(id),
            None,
            &format!("reminder.{target_status}"),
            actor_user_id,
            json!({"reason":reason}),
        )
        .await?;
    }
    tx.commit().await?;
    match id {
        Some(id) => get_reminder(db, tenant_id, branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn refresh_delivery_state(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    actor_user_id: &str,
) -> Result<Option<ReminderRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let aggregate = sqlx::query_as::<_, (i64, i64, i64, i64, String)>(
        r#"SELECT
             COUNT(*) FILTER (
               WHERE status IN ('queued','processing')
                  OR (status='failed' AND attempts<max_attempts)
             )::BIGINT AS pending,
             COUNT(*) FILTER (WHERE status='sent')::BIGINT AS sent,
             COUNT(*) FILTER (WHERE status='failed' AND attempts>=max_attempts)::BIGINT AS failed,
             COUNT(*) FILTER (WHERE status='blocked')::BIGINT AS blocked,
             COALESCE(MAX(NULLIF(last_error,'')),'') AS failure_reason
           FROM benefit_notification_outbox
          WHERE tenant_id=$1 AND branch_id=$2
            AND source_type='occasion_campaign' AND source_id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .fetch_one(&mut *tx)
    .await?;

    let (pending, sent, failed, blocked, failure_reason) = aggregate;
    if pending > 0 || sent + failed + blocked == 0 {
        tx.rollback().await?;
        return get_reminder(db, tenant_id, branch_id, reminder_id).await;
    }

    let target_status = if sent > 0 {
        "sent"
    } else if failed > 0 {
        "failed"
    } else {
        "blocked"
    };
    let transitioned = sqlx::query_as::<_, (String, String)>(
        r#"UPDATE birthday_anniversary_reminders
               SET status=$4,
                   sent_at=CASE WHEN $4='sent' THEN NOW() ELSE sent_at END,
                   failure_reason=CASE WHEN $4 IN ('failed','blocked') THEN $5 ELSE '' END,
                   updated_by=$6,updated_at=NOW(),version=version+1
             WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='queued'
            RETURNING id,client_id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .bind(target_status)
    .bind(&failure_reason)
    .bind(actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((id, client_id)) = transitioned.as_ref() {
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            Some(client_id),
            Some(id),
            None,
            &format!("reminder.{target_status}"),
            actor_user_id,
            json!({"sentChannels":sent,"failedChannels":failed,"blockedChannels":blocked}),
        )
        .await?;

        if target_status == "sent" {
            let sent_voucher = sqlx::query_as::<_, (String, String)>(
                r#"UPDATE birthday_anniversary_vouchers
                       SET status='sent',sent_at=NOW(),updated_at=NOW()
                     WHERE tenant_id=$1 AND branch_id=$2 AND reminder_id=$3 AND status='created'
                    RETURNING id,client_id"#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(reminder_id)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some((voucher_id, voucher_client_id)) = sent_voucher {
                record_audit_tx(
                    &mut tx,
                    tenant_id,
                    branch_id,
                    Some(&voucher_client_id),
                    Some(reminder_id),
                    Some(&voucher_id),
                    "voucher.sent",
                    actor_user_id,
                    json!({}),
                )
                .await?;
            }
        }
    }

    tx.commit().await?;
    get_reminder(db, tenant_id, branch_id, reminder_id).await
}

pub async fn list_due_approved_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<ReminderRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT reminder.id,reminder.tenant_id,reminder.branch_id,reminder.client_id,
                  CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,
                  client.phone AS client_phone,client.email AS client_email,
                  reminder.event_type,reminder.event_date,reminder.status,reminder.channels,
                  reminder.message_options_json,reminder.selected_message,reminder.coupon_id,
                  coupon.code AS coupon_code,reminder.scheduled_send_at,reminder.approved_by,
                  reminder.approved_at,reminder.queued_at,reminder.sent_at,reminder.failure_reason,
                  reminder.version,reminder.created_by,reminder.updated_by,
                  reminder.created_at,reminder.updated_at
             FROM birthday_anniversary_reminders reminder
             JOIN clients client ON client.id=reminder.client_id
               AND client.tenant_id=reminder.tenant_id AND client.branch_id=reminder.branch_id
             LEFT JOIN pos_coupons coupon ON coupon.id=reminder.coupon_id
               AND coupon.tenant_id=reminder.tenant_id AND coupon.branch_id=reminder.branch_id
             LEFT JOIN birthday_anniversary_settings settings
               ON settings.tenant_id=reminder.tenant_id AND settings.branch_id=reminder.branch_id
            WHERE reminder.tenant_id=$1 AND reminder.branch_id=$2
              AND reminder.status='approved'
              AND COALESCE(
                reminder.scheduled_send_at,
                TIMEZONE(
                  COALESCE(settings.timezone,'Asia/Kolkata'),
                  reminder.event_date+COALESCE(settings.default_send_time,'09:00'::TIME)
                )
              )<=NOW()
            ORDER BY COALESCE(
              reminder.scheduled_send_at,
              TIMEZONE(
                COALESCE(settings.timezone,'Asia/Kolkata'),
                reminder.event_date+COALESCE(settings.default_send_time,'09:00'::TIME)
              )
            ),reminder.id
            LIMIT $3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(limit.clamp(1, 500))
    .fetch_all(db)
    .await
}

pub async fn get_voucher(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    voucher_id: &str,
) -> Result<Option<VoucherRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT voucher.id,voucher.tenant_id,voucher.branch_id,voucher.reminder_id,
                  voucher.client_id,CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,
                  voucher.coupon_id,coupon.code AS coupon_code,coupon.discount_type,
                  coupon.discount_value_paise,coupon.discount_bps,voucher.status,voucher.expires_at,
                  voucher.issued_by,voucher.issued_at,voucher.sent_at,voucher.redeemed_at,
                  voucher.redeemed_sale_id,voucher.created_at,voucher.updated_at
             FROM birthday_anniversary_vouchers voucher
             JOIN clients client ON client.id=voucher.client_id
               AND client.tenant_id=voucher.tenant_id AND client.branch_id=voucher.branch_id
             JOIN pos_coupons coupon ON coupon.id=voucher.coupon_id
               AND coupon.tenant_id=voucher.tenant_id AND coupon.branch_id=voucher.branch_id
            WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2 AND voucher.id=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(voucher_id)
    .fetch_optional(db)
    .await
}

pub async fn list_vouchers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    filter: VoucherFilter<'_>,
) -> Result<Vec<VoucherRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT voucher.id,voucher.tenant_id,voucher.branch_id,voucher.reminder_id,
                  voucher.client_id,CONCAT_WS(' ',client.first_name,client.last_name) AS client_name,
                  voucher.coupon_id,coupon.code AS coupon_code,coupon.discount_type,
                  coupon.discount_value_paise,coupon.discount_bps,voucher.status,voucher.expires_at,
                  voucher.issued_by,voucher.issued_at,voucher.sent_at,voucher.redeemed_at,
                  voucher.redeemed_sale_id,voucher.created_at,voucher.updated_at
             FROM birthday_anniversary_vouchers voucher
             JOIN clients client ON client.id=voucher.client_id
               AND client.tenant_id=voucher.tenant_id AND client.branch_id=voucher.branch_id
             JOIN pos_coupons coupon ON coupon.id=voucher.coupon_id
               AND coupon.tenant_id=voucher.tenant_id AND coupon.branch_id=voucher.branch_id
            WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2
              AND ($3::TEXT IS NULL OR voucher.client_id=$3)
              AND ($4::TEXT IS NULL OR voucher.status=$4)
            ORDER BY voucher.issued_at DESC,voucher.id
            LIMIT $5 OFFSET $6"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(filter.client_id)
    .bind(filter.status)
    .bind(filter.limit.clamp(1, 1000))
    .bind(filter.offset.max(0))
    .fetch_all(db)
    .await
}

pub async fn create_voucher_for_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
    actor_user_id: &str,
) -> Result<Option<VoucherRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let voucher_id = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO birthday_anniversary_vouchers(
              tenant_id,branch_id,reminder_id,client_id,coupon_id,status,
              expires_at,issued_by
            )
            SELECT reminder.tenant_id,reminder.branch_id,reminder.id,reminder.client_id,
                   coupon.id,'created',coupon.ends_at,$4
              FROM birthday_anniversary_reminders reminder
              JOIN pos_coupons coupon ON coupon.id=reminder.coupon_id
               AND coupon.tenant_id=reminder.tenant_id AND coupon.branch_id=reminder.branch_id
             WHERE reminder.tenant_id=$1 AND reminder.branch_id=$2 AND reminder.id=$3
               AND reminder.status IN ('approved','queued','sent')
               AND coupon.active=TRUE
               AND (coupon.starts_at IS NULL OR coupon.starts_at<=NOW())
               AND (coupon.ends_at IS NULL OR coupon.ends_at>=NOW())
            ON CONFLICT(tenant_id,branch_id,reminder_id) DO UPDATE SET
              coupon_id=EXCLUDED.coupon_id,expires_at=EXCLUDED.expires_at,
              updated_at=NOW()
            WHERE birthday_anniversary_vouchers.status='created'
            RETURNING id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .bind(actor_user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = voucher_id.as_deref() {
        let client_id = reminder_client_id_tx(&mut tx, tenant_id, branch_id, reminder_id).await?;
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            client_id.as_deref(),
            Some(reminder_id),
            Some(id),
            "voucher.created",
            actor_user_id,
            json!({}),
        )
        .await?;
    }
    tx.commit().await?;
    if let Some(id) = voucher_id {
        return get_voucher(db, tenant_id, branch_id, &id).await;
    }
    get_voucher_for_reminder(db, tenant_id, branch_id, reminder_id).await
}

pub async fn get_voucher_for_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
) -> Result<Option<VoucherRecord>, sqlx::Error> {
    let id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM birthday_anniversary_vouchers WHERE tenant_id=$1 AND branch_id=$2 AND reminder_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .fetch_optional(db)
    .await?;
    match id {
        Some(id) => get_voucher(db, tenant_id, branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn redeem_voucher(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    voucher_id: &str,
    sale_id: &str,
    actor_user_id: &str,
) -> Result<Option<VoucherRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, (String, String, String)>(
        r#"UPDATE birthday_anniversary_vouchers voucher
               SET status='redeemed',redeemed_at=NOW(),redeemed_sale_id=$4,updated_at=NOW()
             WHERE voucher.tenant_id=$1 AND voucher.branch_id=$2 AND voucher.id=$3
               AND voucher.status IN ('created','sent')
               AND (voucher.expires_at IS NULL OR voucher.expires_at>=NOW())
               AND EXISTS(
                 SELECT 1 FROM pos_sales sale
                  WHERE sale.tenant_id=$1 AND sale.branch_id=$2 AND sale.id=$4
                    AND sale.client_id=voucher.client_id
                    AND sale.status NOT IN ('draft','cancelled','voided','refunded')
               )
            RETURNING voucher.id,voucher.client_id,voucher.reminder_id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(voucher_id)
    .bind(sale_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((id, client_id, reminder_id)) = row.as_ref() {
        record_audit_tx(
            &mut tx,
            tenant_id,
            branch_id,
            Some(client_id),
            Some(reminder_id),
            Some(id),
            "voucher.redeemed",
            actor_user_id,
            json!({"saleId":sale_id}),
        )
        .await?;
    }
    tx.commit().await?;
    match row {
        Some((id, _, _)) => get_voucher(db, tenant_id, branch_id, &id).await,
        None => Ok(None),
    }
}

pub async fn expire_vouchers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
) -> Result<u64, sqlx::Error> {
    let count = sqlx::query_scalar::<_, i64>(
        r#"WITH expired AS (
             UPDATE birthday_anniversary_vouchers
                SET status='expired',updated_at=NOW()
              WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('created','sent')
                AND expires_at IS NOT NULL AND expires_at<NOW()
              RETURNING id,client_id,reminder_id
           ), audited AS (
             INSERT INTO birthday_anniversary_audit_events(
               tenant_id,branch_id,client_id,reminder_id,voucher_id,action,details_json,actor_user_id
             )
             SELECT $1,$2,client_id,reminder_id,id,'voucher.expired',
                    JSONB_BUILD_OBJECT('reason','coupon_expired'),$3
               FROM expired
             RETURNING id
           )
           SELECT COUNT(*)::BIGINT FROM audited"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_user_id)
    .fetch_one(db)
    .await?;
    Ok(count.max(0) as u64)
}

pub async fn list_audit_events(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    filter: AuditFilter<'_>,
) -> Result<Vec<BirthdayAnniversaryAuditRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT audit.id,audit.client_id,
                  COALESCE(CONCAT_WS(' ',client.first_name,client.last_name),'') AS client_name,
                  audit.reminder_id,audit.voucher_id,audit.action,audit.details_json,
                  audit.actor_user_id,audit.created_at
             FROM birthday_anniversary_audit_events audit
             LEFT JOIN clients client ON client.id=audit.client_id
               AND client.tenant_id=audit.tenant_id AND client.branch_id=audit.branch_id
            WHERE audit.tenant_id=$1 AND audit.branch_id=$2
              AND ($3::TEXT IS NULL OR audit.client_id=$3)
              AND ($4::TEXT IS NULL OR audit.reminder_id=$4)
              AND ($5::TEXT IS NULL OR audit.action=$5)
            ORDER BY audit.created_at DESC,audit.id
            LIMIT $6 OFFSET $7"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(filter.client_id)
    .bind(filter.reminder_id)
    .bind(filter.action)
    .bind(filter.limit.clamp(1, 1000))
    .bind(filter.offset.max(0))
    .fetch_all(db)
    .await
}

async fn reminder_client_id_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    reminder_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT client_id FROM birthday_anniversary_reminders WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(reminder_id)
    .fetch_optional(&mut **tx)
    .await
}

#[allow(clippy::too_many_arguments)]
async fn record_audit_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    reminder_id: Option<&str>,
    voucher_id: Option<&str>,
    action: &str,
    actor_user_id: &str,
    details_json: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO birthday_anniversary_audit_events(
             tenant_id,branch_id,client_id,reminder_id,voucher_id,action,details_json,actor_user_id
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(reminder_id)
    .bind(voucher_id)
    .bind(action)
    .bind(details_json)
    .bind(actor_user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        approve_reminder, create_voucher_for_reminder, get_settings, list_audit_events,
        list_occasions, list_reminders, queue_reminder_deliveries, redeem_voucher,
        refresh_delivery_state, upsert_draft, upsert_settings, ApproveReminder, AuditFilter,
        BirthdayAnniversarySettingsWrite, DraftWrite, ReminderDeliveryWrite, ReminderFilter,
    };
    use chrono::{NaiveDate, NaiveTime};
    use serde_json::json;
    use sqlx::PgPool;

    async fn prepare_schema(pool: &PgPool) {
        for statement in [
            "CREATE EXTENSION IF NOT EXISTS pgcrypto",
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',categories_json JSONB NOT NULL DEFAULT '[]',birthday DATE,anniversary DATE,whatsapp_opt_in BOOLEAN,sms_opt_in BOOLEAN,email_opt_in BOOLEAN,last_visit_at TIMESTAMPTZ,active BOOLEAN NOT NULL DEFAULT TRUE,merged_into_client_id TEXT)",
            "CREATE TABLE appointments(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,status TEXT NOT NULL,start_at TIMESTAMPTZ,service_ids_json TEXT NOT NULL DEFAULT '[]')",
            "CREATE TABLE services(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE)",
            "CREATE TABLE pos_sales(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,client_id TEXT NOT NULL,total_paise BIGINT NOT NULL DEFAULT 0,status TEXT NOT NULL)",
            "CREATE TABLE pos_coupons(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,code TEXT NOT NULL,discount_type TEXT NOT NULL,discount_value_paise BIGINT NOT NULL DEFAULT 0,discount_bps BIGINT NOT NULL DEFAULT 0,active BOOLEAN NOT NULL DEFAULT TRUE,starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ)",
            "CREATE TABLE benefit_notification_outbox(id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,client_id TEXT,channel TEXT NOT NULL,recipient TEXT NOT NULL,payload_json JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,last_error TEXT NOT NULL DEFAULT '',next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(tenant_id,branch_id,source_type,source_id,channel))",
        ] {
            sqlx::query(statement).execute(pool).await.unwrap();
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0166_birthday_anniversary_workflow.sql"
        ))
        .execute(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = false)]
    async fn workflow_repository_is_scoped_idempotent_and_real_data_backed(pool: PgPool) {
        prepare_schema(&pool).await;
        sqlx::query("INSERT INTO clients(id,tenant_id,branch_id,first_name,last_name,phone,categories_json,birthday,whatsapp_opt_in) VALUES('client-1','tenant-1','branch-1','Leap','Client','+919999999999','[]','2020-02-29',TRUE),('client-2','tenant-1','branch-2','Other','Branch','+918888888888','[]','2020-02-29',TRUE)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO pos_coupons(id,tenant_id,branch_id,code,discount_type,discount_bps,active,ends_at) VALUES('coupon-1','tenant-1','branch-1','BDAY20','percent',2000,TRUE,NOW()+INTERVAL '30 days')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO pos_sales(id,tenant_id,branch_id,client_id,total_paise,status) VALUES('sale-1','tenant-1','branch-1','client-1',5000,'paid')")
            .execute(&pool).await.unwrap();

        let settings = upsert_settings(
            &pool,
            BirthdayAnniversarySettingsWrite {
                tenant_id: "tenant-1",
                branch_id: "branch-1",
                workflow_mode: "managed",
                popup_enabled: true,
                approval_required: true,
                auto_send_enabled: false,
                default_send_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                timezone: "Asia/Kolkata",
                days_ahead: 30,
                channels: vec!["whatsapp".to_string()],
                actor_user_id: "owner-1",
            },
        )
        .await
        .unwrap();
        assert_eq!(settings.workflow_mode, "managed");
        assert!(get_settings(&pool, "tenant-1", "branch-2")
            .await
            .unwrap()
            .is_none());

        let event_date = NaiveDate::from_ymd_opt(2027, 2, 28).unwrap();
        let occasions = list_occasions(
            &pool, "tenant-1", "branch-1", event_date, event_date, "birthday", 100,
        )
        .await
        .unwrap();
        assert_eq!(occasions.len(), 1);
        assert_eq!(occasions[0].client_id, "client-1");

        let options = json!([{"language":"English","text":"Happy birthday"}]);
        let first_reminder = upsert_draft(
            &pool,
            DraftWrite {
                tenant_id: "tenant-1",
                branch_id: "branch-1",
                client_id: "client-1",
                event_type: "birthday",
                event_date,
                channels: vec!["whatsapp".to_string()],
                message_options_json: &options,
                selected_message: "Happy birthday",
                coupon_id: Some("coupon-1"),
                scheduled_send_at: None,
                actor_user_id: "owner-1",
            },
        )
        .await
        .unwrap()
        .unwrap();
        let reminder = upsert_draft(
            &pool,
            DraftWrite {
                tenant_id: "tenant-1",
                branch_id: "branch-1",
                client_id: "client-1",
                event_type: "birthday",
                event_date,
                channels: vec!["whatsapp".to_string()],
                message_options_json: &options,
                selected_message: "Happy birthday",
                coupon_id: Some("coupon-1"),
                scheduled_send_at: None,
                actor_user_id: "owner-1",
            },
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(reminder.id, first_reminder.id);
        assert_eq!(reminder.version, 2);
        assert_eq!(
            list_reminders(
                &pool,
                "tenant-1",
                "branch-1",
                ReminderFilter {
                    client_id: None,
                    status: None,
                    event_type: None,
                    from_date: None,
                    to_date: None,
                    limit: 100,
                    offset: 0,
                },
            )
            .await
            .unwrap()
            .len(),
            1
        );

        let approved = approve_reminder(
            &pool,
            ApproveReminder {
                tenant_id: "tenant-1",
                branch_id: "branch-1",
                reminder_id: &reminder.id,
                selected_message: "Happy birthday",
                coupon_id: Some("coupon-1"),
                scheduled_send_at: None,
                actor_user_id: "owner-1",
                expected_version: reminder.version,
            },
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(approved.status, "approved");

        let voucher =
            create_voucher_for_reminder(&pool, "tenant-1", "branch-1", &approved.id, "owner-1")
                .await
                .unwrap()
                .unwrap();
        assert_eq!(voucher.coupon_code, "BDAY20");
        let queued = queue_reminder_deliveries(
            &pool,
            "tenant-1",
            "branch-1",
            &approved.id,
            "owner-1",
            approved.version,
            &[ReminderDeliveryWrite {
                channel: "whatsapp".into(),
                recipient: "+919999999999".into(),
                payload_json: json!({"channel":"whatsapp","message":"Happy birthday"}),
            }],
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(queued.status, "queued");
        sqlx::query("UPDATE benefit_notification_outbox SET status='sent' WHERE source_id=$1")
            .bind(&approved.id)
            .execute(&pool)
            .await
            .unwrap();
        let delivered = refresh_delivery_state(
            &pool,
            "tenant-1",
            "branch-1",
            &approved.id,
            "delivery-worker",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(delivered.status, "sent");
        assert!(redeem_voucher(
            &pool,
            "tenant-1",
            "branch-2",
            &voucher.id,
            "sale-1",
            "owner-1",
        )
        .await
        .unwrap()
        .is_none());
        assert_eq!(
            redeem_voucher(
                &pool,
                "tenant-1",
                "branch-1",
                &voucher.id,
                "sale-1",
                "owner-1",
            )
            .await
            .unwrap()
            .unwrap()
            .status,
            "redeemed"
        );

        let audit = list_audit_events(
            &pool,
            "tenant-1",
            "branch-1",
            AuditFilter {
                client_id: Some("client-1"),
                reminder_id: None,
                action: None,
                limit: 100,
                offset: 0,
            },
        )
        .await
        .unwrap();
        assert!(audit.iter().any(|row| row.action == "reminder.approved"));
        assert!(audit.iter().any(|row| row.action == "voucher.redeemed"));
    }
}
