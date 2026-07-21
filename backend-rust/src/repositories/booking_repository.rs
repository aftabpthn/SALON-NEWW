use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
pub struct BookingClientContact {
    pub name: String,
    pub phone: String,
    pub email: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct AppointmentReportRecord {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub contact: String,
    pub notes: String,
    pub service_names: String,
    pub staff_id: String,
    pub staff_name: String,
    pub staff_type: String,
    pub status: String,
    pub source: String,
    pub source_channel: String,
    pub start_at: DateTime<Utc>,
    pub price_paise: i64,
    pub invoice_number: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffReportRecord {
    pub id: String,
    pub name: String,
    pub staff_type: String,
}

pub struct DepositFollowupInput<'a> {
    pub payment_link_id: &'a str,
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub invoice_id: &'a str,
    pub status: &'a str,
    pub reminder_channel: &'a str,
    pub reminder_sent_at: Option<chrono::DateTime<chrono::Utc>>,
    pub done_at: Option<chrono::DateTime<chrono::Utc>>,
    pub note: &'a str,
    pub actor_user_id: &'a str,
}

pub async fn branch_deposit_percent(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<i32>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT b.booking_deposit_percent
         FROM branches b
         JOIN tenants t ON t.id=b.tenant_id
         WHERE COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1
           AND COALESCE(NULLIF(b.scope_id,''),b.id::text)=$2
           AND b.active=TRUE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn booking_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT settings_json->'bookingSettings'
         FROM appointment_branch_settings
         WHERE tenant_id=$1 AND branch_id=$2
           AND jsonb_typeof(settings_json->'bookingSettings')='object'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn save_booking_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settings: &Value,
    legacy_deposit_percent: i32,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let branch_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM branches b
            JOIN tenants t ON t.id=b.tenant_id
            WHERE COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1
              AND COALESCE(NULLIF(b.scope_id,''),b.id::text)=$2
              AND b.active=TRUE
         )",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(&mut *tx)
    .await?;
    if !branch_exists {
        return Err(sqlx::Error::RowNotFound);
    }

    let allow_overlap = settings
        .pointer("/slotRules/allowOverlapBooking")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    sqlx::query(
        "INSERT INTO appointment_branch_settings (tenant_id,branch_id,allow_overlap,settings_json)
         VALUES ($1,$2,$3,jsonb_build_object('bookingSettings',$4::jsonb))
         ON CONFLICT (tenant_id,branch_id) DO UPDATE SET
           allow_overlap=EXCLUDED.allow_overlap,
           settings_json=COALESCE(appointment_branch_settings.settings_json,'{}'::jsonb)
             || jsonb_build_object('bookingSettings',$4::jsonb),
           updated_at=NOW()",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(allow_overlap)
    .bind(settings)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE branches b SET booking_deposit_percent=$3
         FROM tenants t
         WHERE b.tenant_id=t.id
           AND COALESCE(NULLIF(t.scope_id,''),t.id::text)=$1
           AND COALESCE(NULLIF(b.scope_id,''),b.id::text)=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(legacy_deposit_percent)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub async fn booking_client_contact(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<BookingClientContact>, sqlx::Error> {
    sqlx::query_as::<_, BookingClientContact>(
        "SELECT BTRIM(CONCAT_WS(' ',first_name,last_name)) AS name,phone,email
         FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_optional(db)
    .await
}

pub async fn appointment_report_records(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: Option<NaiveDate>,
    to: Option<NaiveDate>,
) -> Result<Vec<AppointmentReportRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT a.id,a.client_id,
           COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),'Walk-In') client_name,
           COALESCE(c.phone,'') contact,COALESCE(a.notes,'') notes,
           COALESCE(service_rollup.names,'-') service_names,
           COALESCE(a.staff_id,'') staff_id,
           COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name)),''),'Unassigned') staff_name,
           COALESCE(NULLIF(s.job_title,''),'Employee') staff_type,
           COALESCE(a.status,'') status,COALESCE(a.source,'') source,
           COALESCE(a.source_channel,'') source_channel,a.start_at,
           COALESCE(sale.total_paise,NULLIF(a.booked_total_paise,0),service_rollup.total_paise,0)::BIGINT price_paise,
           COALESCE(sale.invoice_number,'') invoice_number
         FROM appointments a
         LEFT JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id AND c.branch_id=a.branch_id
         LEFT JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id
         LEFT JOIN LATERAL (
           SELECT STRING_AGG(service.name,', ' ORDER BY service.name) names,
                  COALESCE(SUM(service.price_paise),0)::BIGINT total_paise
           FROM services service
           WHERE service.tenant_id=a.tenant_id AND service.branch_id=a.branch_id
             AND service.id IN (
               SELECT jsonb_array_elements_text(COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb)
             )
         ) service_rollup ON TRUE
         LEFT JOIN LATERAL (
           SELECT ps.total_paise,ps.invoice_number
           FROM pos_sales ps
           WHERE ps.tenant_id=a.tenant_id AND ps.branch_id=a.branch_id
             AND ps.reference_id IN (a.id,COALESCE(NULLIF(a.booking_group_id,''),a.id))
           ORDER BY ps.created_at DESC LIMIT 1
         ) sale ON TRUE
         WHERE a.tenant_id=$1 AND a.branch_id=$2
           AND ($3::DATE IS NULL OR (a.start_at AT TIME ZONE 'Asia/Kolkata')::DATE >= $3)
           AND ($4::DATE IS NULL OR (a.start_at AT TIME ZONE 'Asia/Kolkata')::DATE <= $4)
         ORDER BY a.start_at DESC LIMIT 10000",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}

pub async fn appointment_report_staff(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<StaffReportRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,
           COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',first_name,middle_name,last_name)),''),'Unassigned') name,
           COALESCE(NULLIF(job_title,''),'Employee') staff_type
         FROM staff WHERE tenant_id=$1 AND branch_id=$2
         ORDER BY first_name,last_name LIMIT 5000",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn appointment_jobs(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    status: &str,
    job_type: &str,
    limit: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
           'id',id,'tenantId',tenant_id,'branchId',branch_id,
           'jobType',CASE WHEN channel='' THEN source_type ELSE channel||'_send' END,
           'sourceType',source_type,'sourceId',source_id,'payload',payload_json,
           'status',CASE status WHEN 'queued' THEN 'pending' WHEN 'processing' THEN 'running'
             WHEN 'sent' THEN 'completed' WHEN 'blocked' THEN 'dead_letter' ELSE status END,
           'attempts',attempts,'maxAttempts',max_attempts,'priority',5,
           'scheduledAt',next_attempt_at,'lastError',last_error,
           'createdAt',created_at,'updatedAt',updated_at
         )
         FROM benefit_notification_outbox
         WHERE tenant_id=$1 AND branch_id=$2
           AND ($3='' OR status=CASE $3 WHEN 'pending' THEN 'queued' WHEN 'running' THEN 'processing'
             WHEN 'completed' THEN 'sent' WHEN 'dead_letter' THEN 'blocked' ELSE $3 END)
           AND ($4='' OR source_type=$4 OR channel||'_send'=$4)
         ORDER BY next_attempt_at DESC LIMIT $5",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(status)
    .bind(job_type)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn retry_appointment_job(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "UPDATE benefit_notification_outbox
         SET status='queued',attempts=0,last_error='',next_attempt_at=NOW(),updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status<>'processing'
         RETURNING jsonb_build_object('retried',TRUE,'id',id,'status','pending','scheduledAt',next_attempt_at)",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn appointment_job_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT status FROM benefit_notification_outbox
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn delete_appointment_job(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "DELETE FROM benefit_notification_outbox
         WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND status<>'processing'",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(branch_id)
    .execute(db)
    .await?
    .rows_affected()
        > 0)
}

pub async fn appointment_deposit_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    from: Option<chrono::NaiveDate>,
    to: Option<chrono::NaiveDate>,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
           'paymentLinkId',l.id,
           'appointmentId',l.appointment_id,
           'tenantId',l.tenant_id,
           'branchId',l.branch_id,
           'clientId',COALESCE(a.client_id,''),
           'clientName',COALESCE(BTRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),
           'clientPhone',COALESCE(c.phone,''),
           'staffId',COALESCE(a.staff_id,''),
           'serviceIds',COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb,
           'serviceNames',COALESCE((
             SELECT STRING_AGG(s.name,', ' ORDER BY s.name)
             FROM services s
             WHERE s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id
               AND s.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb))
           ),''),
           'appointmentStatus',COALESCE(a.status,''),
           'depositStatus',l.status,
           'amountPaise',l.amount_paise,
           'amount',ROUND(l.amount_paise::numeric/100,2),
           'advanceAdjustedPaise',CASE WHEN l.status IN ('paid','refunded') THEN l.amount_paise ELSE 0 END,
           'advanceAdjusted',ROUND((CASE WHEN l.status IN ('paid','refunded') THEN l.amount_paise ELSE 0 END)::numeric/100,2),
           'counterPaidPaise',GREATEST(COALESCE(sale.paid_paise,0)-CASE WHEN l.status IN ('paid','refunded') THEN l.amount_paise ELSE 0 END,0),
           'counterPaid',ROUND(GREATEST(COALESCE(sale.paid_paise,0)-CASE WHEN l.status IN ('paid','refunded') THEN l.amount_paise ELSE 0 END,0)::numeric/100,2),
           'counterDuePaise',GREATEST(COALESCE(sale.total_paise,0)-COALESCE(sale.paid_paise,0),0),
           'counterDue',ROUND(GREATEST(COALESCE(sale.total_paise,0)-COALESCE(sale.paid_paise,0),0)::numeric/100,2),
           'currency','INR',
           'paymentLink',l.link_url,
           'provider',l.provider,
           'providerPaymentId',l.provider_payment_id,
           'invoiceId',COALESCE(sale.id,''),
           'followUpStatus',COALESCE(f.status,''),
           'followUpReminderChannel',COALESCE(f.reminder_channel,''),
           'followUpReminderSentAt',f.reminder_sent_at,
           'followUpDoneAt',f.done_at,
           'followUpNote',COALESCE(f.note,''),
           'followUpUpdatedAt',f.updated_at,
           'createdAt',l.created_at,
           'paidAt',l.paid_at,
           'appointmentStartAt',a.start_at,
           'expiresAt',l.expires_at
         )
         FROM appointment_payment_links l
         LEFT JOIN appointments a ON a.id=l.appointment_id AND a.tenant_id=l.tenant_id AND a.branch_id=l.branch_id
         LEFT JOIN clients c ON c.id=a.client_id AND c.tenant_id=a.tenant_id AND c.branch_id=a.branch_id
         LEFT JOIN LATERAL (
           SELECT ps.id,ps.total_paise,ps.paid_paise
           FROM pos_sales ps
           WHERE ps.tenant_id=l.tenant_id AND ps.branch_id=l.branch_id
             AND ps.reference_id IN (l.appointment_id,COALESCE(NULLIF(a.booking_group_id,''),l.appointment_id))
           ORDER BY ps.created_at DESC LIMIT 1
         ) sale ON TRUE
         LEFT JOIN appointment_deposit_followups f ON f.payment_link_id=l.id
         WHERE l.tenant_id=$1 AND l.branch_id=$2
           AND ($3::date IS NULL OR COALESCE(a.start_at,l.created_at)::date >= $3)
           AND ($4::date IS NULL OR COALESCE(a.start_at,l.created_at)::date <= $4)
         ORDER BY l.created_at DESC LIMIT 500",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(from)
    .bind(to)
    .fetch_all(db)
    .await
}

pub async fn save_deposit_followup(
    db: &PgPool,
    input: DepositFollowupInput<'_>,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO appointment_deposit_followups (
           payment_link_id,tenant_id,branch_id,appointment_id,invoice_id,status,
           reminder_channel,reminder_sent_at,done_at,note,actor_user_id
         )
         SELECT l.id,l.tenant_id,l.branch_id,l.appointment_id,$4,$5,$6,$7,$8,$9,$10
         FROM appointment_payment_links l
         WHERE l.id=$1 AND l.tenant_id=$2 AND l.branch_id=$3
         ON CONFLICT (payment_link_id) DO UPDATE SET
           invoice_id=EXCLUDED.invoice_id,
           status=EXCLUDED.status,
           reminder_channel=EXCLUDED.reminder_channel,
           reminder_sent_at=COALESCE(EXCLUDED.reminder_sent_at,appointment_deposit_followups.reminder_sent_at),
           done_at=EXCLUDED.done_at,
           note=EXCLUDED.note,
           actor_user_id=EXCLUDED.actor_user_id,
           updated_at=NOW()
         RETURNING jsonb_build_object(
           'paymentLinkId',payment_link_id,'tenantId',tenant_id,'branchId',branch_id,
           'appointmentId',appointment_id,'invoiceId',invoice_id,'status',status,
           'reminderChannel',reminder_channel,'reminderSentAt',reminder_sent_at,
           'doneAt',done_at,'note',note,'actorUserId',actor_user_id,
           'createdAt',created_at,'updatedAt',updated_at
         )",
    )
    .bind(input.payment_link_id)
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.invoice_id)
    .bind(input.status)
    .bind(input.reminder_channel)
    .bind(input.reminder_sent_at)
    .bind(input.done_at)
    .bind(input.note)
    .bind(input.actor_user_id)
    .fetch_optional(db)
    .await
}
