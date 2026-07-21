use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
pub struct SmsCenterRecipient {
    pub recipient_id: String,
    pub recipient_kind: String,
    pub display_name: String,
    pub recipient: String,
    pub wallet_balance_paise: i64,
    pub outstanding_paise: i64,
    pub last_paid_paise: i64,
    pub salary_paise: i64,
    pub period_start: Option<NaiveDate>,
    pub period_end: Option<NaiveDate>,
}

#[derive(Debug, FromRow)]
pub struct SmsCenterCampaignRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub title: String,
    pub body: String,
    pub channel: String,
    pub audience: String,
    pub category: String,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsCenterHistoryRecord {
    pub id: String,
    pub title: String,
    pub body: String,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
}

pub async fn recipients(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    audience: &str,
    channel: &str,
) -> Result<Vec<SmsCenterRecipient>, sqlx::Error> {
    if audience.starts_with("clients_") {
        return sqlx::query_as(
            r#"SELECT client.id AS recipient_id,'client'::TEXT AS recipient_kind,
                      COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),'Client') AS display_name,
                      CASE $4 WHEN 'sms' THEN REGEXP_REPLACE(COALESCE(client.phone,''),'[^0-9]','','g')
                              ELSE LOWER(TRIM(COALESCE(client.email,''))) END AS recipient,
                      client.wallet_balance_paise,
                      COALESCE(sales.outstanding_paise,0)::BIGINT AS outstanding_paise,
                      COALESCE(sales.last_paid_paise,0)::BIGINT AS last_paid_paise,
                      0::BIGINT AS salary_paise,NULL::DATE AS period_start,NULL::DATE AS period_end
                 FROM clients client
                 LEFT JOIN LATERAL (
                   SELECT COALESCE(SUM(GREATEST(sale.total_paise-sale.paid_paise,0))
                            FILTER (WHERE sale.total_paise>sale.paid_paise),0)::BIGINT AS outstanding_paise,
                          COALESCE(MAX(sale.total_paise)
                            FILTER (WHERE sale.total_paise>0 AND sale.paid_paise>=sale.total_paise),0)::BIGINT AS last_paid_paise
                     FROM pos_sales sale
                    WHERE sale.tenant_id=client.tenant_id AND sale.branch_id=client.branch_id
                      AND sale.client_id=client.id
                      AND sale.status NOT IN ('draft','voided','cancelled','refunded')
                 ) sales ON TRUE
                WHERE client.tenant_id=$1 AND client.branch_id=$2 AND client.active=TRUE
                  AND client.merged_into_client_id IS NULL
                  AND CASE $4 WHEN 'sms' THEN client.sms_opt_in IS TRUE
                              ELSE client.email_opt_in IS TRUE END
                  AND CASE $4 WHEN 'sms' THEN LENGTH(REGEXP_REPLACE(COALESCE(client.phone,''),'[^0-9]','','g')) BETWEEN 8 AND 15
                              ELSE POSITION('@' IN COALESCE(client.email,''))>1 END
                  AND CASE $3 WHEN 'clients_all' THEN TRUE
                              WHEN 'clients_paid' THEN COALESCE(sales.last_paid_paise,0)>0
                              WHEN 'clients_unpaid' THEN COALESCE(sales.outstanding_paise,0)>0
                              WHEN 'clients_wallet' THEN client.wallet_balance_paise>0
                              ELSE FALSE END
                ORDER BY client.id"#,
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(audience)
        .bind(channel)
        .fetch_all(db)
        .await;
    }

    sqlx::query_as(
        r#"SELECT staff.id AS recipient_id,'staff'::TEXT AS recipient_kind,
                  COALESCE(NULLIF(staff.appointment_display_name,''),NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Staff') AS display_name,
                  CASE $4 WHEN 'sms' THEN REGEXP_REPLACE(COALESCE(staff.mobile_phone,''),'[^0-9]','','g')
                          ELSE LOWER(TRIM(COALESCE(staff.email,''))) END AS recipient,
                  0::BIGINT AS wallet_balance_paise,0::BIGINT AS outstanding_paise,
                  0::BIGINT AS last_paid_paise,COALESCE(payroll.net_paise,0)::BIGINT AS salary_paise,
                  payroll.period_start,payroll.period_end
             FROM staff
             LEFT JOIN staff_notification_preferences preference
               ON preference.tenant_id=staff.tenant_id AND preference.branch_id=staff.branch_id
              AND preference.staff_id=staff.id
             LEFT JOIN LATERAL (
               SELECT item.net_paise,run.period_start,run.period_end
                 FROM staff_payroll_items item
                 JOIN staff_payroll_runs run ON run.id=item.payroll_run_id
                  AND run.tenant_id=item.tenant_id AND run.branch_id=item.branch_id
                WHERE item.tenant_id=staff.tenant_id AND item.branch_id=staff.branch_id
                  AND item.staff_id=staff.id AND run.status IN ('finalized','paid')
                ORDER BY run.period_end DESC,run.created_at DESC LIMIT 1
             ) payroll ON TRUE
            WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.active=TRUE
              AND CASE $4 WHEN 'sms' THEN LENGTH(REGEXP_REPLACE(COALESCE(staff.mobile_phone,''),'[^0-9]','','g')) BETWEEN 8 AND 15
                          ELSE POSITION('@' IN COALESCE(staff.email,''))>1 END
              AND CASE $3 WHEN 'staff_all' THEN TRUE
                          WHEN 'staff_salary' THEN payroll.net_paise IS NOT NULL
                            AND preference.allow_payroll_amounts IS TRUE
                          ELSE FALSE END
            ORDER BY staff.id"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(audience)
    .bind(channel)
    .fetch_all(db)
    .await
}

pub async fn insert_campaign(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_id: &str,
    title: &str,
    body: &str,
    metadata: &Value,
) -> Result<Option<SmsCenterHistoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO notifications(
             tenant_id,branch_id,created_by,notification_type,title,body,resource_type,metadata_json
           ) VALUES($1,$2,$3,'sms_center_campaign',$4,$5,'sms_center',$6)
           ON CONFLICT DO NOTHING
           RETURNING id,title,body,metadata_json AS metadata,created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(actor_id)
    .bind(title)
    .bind(body)
    .bind(metadata)
    .fetch_optional(db)
    .await
}

pub async fn campaign_by_idempotency(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<SmsCenterHistoryRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,title,body,metadata_json AS metadata,created_at FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND notification_type='sms_center_campaign' AND metadata_json->>'idempotencyKey'=$3")
        .bind(tenant_id).bind(branch_id).bind(idempotency_key).fetch_optional(db).await
}

pub async fn recent_campaigns(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SmsCenterHistoryRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,title,body,metadata_json AS metadata,created_at FROM notifications WHERE tenant_id=$1 AND branch_id=$2 AND notification_type='sms_center_campaign' ORDER BY created_at DESC LIMIT 100")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn due_campaigns(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<SmsCenterCampaignRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,title,body,metadata_json->>'channel' channel,metadata_json->>'audience' audience,metadata_json->>'category' category FROM notifications WHERE notification_type='sms_center_campaign' AND metadata_json->>'status'='scheduled' ORDER BY created_at,id LIMIT $1")
        .bind(limit).fetch_all(db).await
}

pub async fn enqueue_recipient(
    db: &PgPool,
    campaign: &SmsCenterCampaignRecord,
    recipient: &SmsCenterRecipient,
    payload: &Value,
) -> Result<bool, sqlx::Error> {
    let source_type = if recipient.recipient_kind == "client" {
        "sms_center_client"
    } else {
        "sms_center_staff"
    };
    let client_id =
        (recipient.recipient_kind == "client").then_some(recipient.recipient_id.as_str());
    Ok(sqlx::query("INSERT INTO benefit_notification_outbox(tenant_id,branch_id,source_type,source_id,client_id,channel,recipient,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,branch_id,source_type,source_id,channel) DO NOTHING")
        .bind(&campaign.tenant_id).bind(&campaign.branch_id).bind(source_type)
        .bind(format!("{}:{}",campaign.id,recipient.recipient_id)).bind(client_id)
        .bind(&campaign.channel).bind(&recipient.recipient).bind(payload)
        .execute(db).await?.rows_affected()==1)
}

pub async fn mark_campaign_queued(
    db: &PgPool,
    campaign: &SmsCenterCampaignRecord,
    count: usize,
) -> Result<(), sqlx::Error> {
    let status = if count == 0 { "failed" } else { "queued" };
    let error = if count == 0 {
        "no eligible recipients"
    } else {
        ""
    };
    sqlx::query("UPDATE notifications SET metadata_json=jsonb_set(jsonb_set(jsonb_set(metadata_json,'{status}',to_jsonb($4::TEXT),TRUE),'{recipientCount}',to_jsonb($5::BIGINT),TRUE),'{lastError}',to_jsonb($6::TEXT),TRUE),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND notification_type='sms_center_campaign' AND metadata_json->>'status'='scheduled'")
        .bind(&campaign.id).bind(&campaign.tenant_id).bind(&campaign.branch_id)
        .bind(status).bind(count as i64).bind(error).execute(db).await?;
    Ok(())
}

pub async fn refresh_campaign_statuses(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"WITH counts AS (
             SELECT payload_json->>'campaignId' campaign_id,
                    COUNT(*) FILTER (WHERE status='sent')::BIGINT sent,
                    COUNT(*) FILTER (WHERE status='failed' AND attempts>=max_attempts)::BIGINT failed,
                    COUNT(*) FILTER (WHERE status='blocked')::BIGINT blocked,
                    COUNT(*) FILTER (WHERE status IN ('queued','processing') OR (status='failed' AND attempts<max_attempts))::BIGINT pending
               FROM benefit_notification_outbox
              WHERE source_type IN ('sms_center_client','sms_center_staff')
              GROUP BY payload_json->>'campaignId'
           ) UPDATE notifications notification SET metadata_json=
             jsonb_set(jsonb_set(jsonb_set(jsonb_set(notification.metadata_json,'{status}',to_jsonb(CASE WHEN counts.pending>0 THEN 'queued' WHEN counts.failed>0 THEN 'failed' WHEN counts.blocked>0 AND counts.sent=0 THEN 'blocked' ELSE 'delivered' END::TEXT),TRUE),'{deliveredCount}',to_jsonb(counts.sent),TRUE),'{failedCount}',to_jsonb(counts.failed),TRUE),'{blockedCount}',to_jsonb(counts.blocked),TRUE),updated_at=NOW()
             FROM counts WHERE notification.id=counts.campaign_id AND notification.notification_type='sms_center_campaign'"#,
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn staff_delivery_allowed(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    channel: &str,
    recipient: &str,
    salary: bool,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM staff
             LEFT JOIN staff_notification_preferences preference
               ON preference.tenant_id=staff.tenant_id AND preference.branch_id=staff.branch_id
              AND preference.staff_id=staff.id
            WHERE staff.tenant_id=$1 AND staff.branch_id=$2 AND staff.id=$3 AND staff.active=TRUE
              AND CASE $4 WHEN 'sms' THEN REGEXP_REPLACE(COALESCE(staff.mobile_phone,''),'[^0-9]','','g')=$5
                          ELSE LOWER(TRIM(COALESCE(staff.email,'')))=$5 END
              AND ($6=FALSE OR preference.allow_payroll_amounts IS TRUE))"#,
    )
    .bind(tenant_id).bind(branch_id).bind(staff_id).bind(channel).bind(recipient).bind(salary)
    .fetch_one(db).await
}
