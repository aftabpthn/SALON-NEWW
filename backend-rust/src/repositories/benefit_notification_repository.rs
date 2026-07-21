use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
pub struct MarketingCampaignRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub title: String,
    pub body: String,
    pub audience: String,
    pub metadata_json: Value,
    pub tenant_slug: String,
}

#[derive(Debug, FromRow)]
pub struct MarketingRecipientRecord {
    pub client_id: String,
    pub client_name: String,
    pub recipient: String,
}

#[derive(Debug, FromRow)]
pub struct BenefitDeliveryRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub source_type: String,
    pub source_id: String,
    pub client_id: Option<String>,
    pub channel: String,
    pub payload_json: Value,
    pub attempts: i32,
    pub max_attempts: i32,
}

pub struct NewBenefitDelivery<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub source_type: &'a str,
    pub source_id: &'a str,
    pub client_id: &'a str,
    pub channel: &'a str,
    pub recipient: &'a str,
    pub payload: &'a Value,
}

pub async fn scopes(db: &PgPool) -> Result<Vec<(String, String)>, sqlx::Error> {
    sqlx::query_as(
        "SELECT DISTINCT tenant_id,branch_id FROM (SELECT tenant_id,branch_id FROM membership_settings UNION ALL SELECT tenant_id,branch_id FROM package_settings UNION ALL SELECT tenant_id,branch_id FROM client_memberships UNION ALL SELECT tenant_id,branch_id FROM client_package_credits UNION ALL SELECT tenant_id,branch_id FROM clients WHERE active=TRUE AND merged_into_client_id IS NULL) scopes",
    )
    .fetch_all(db)
    .await
}

pub async fn ensure_marketing_governance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO marketing_governance_settings(tenant_id,branch_id) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(tenant_id).bind(branch_id).execute(db).await?;
    Ok(())
}

pub async fn enqueue(db: &PgPool, item: NewBenefitDelivery<'_>) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("INSERT INTO benefit_notification_outbox (tenant_id,branch_id,source_type,source_id,client_id,channel,recipient,payload_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,branch_id,source_type,source_id,channel) DO NOTHING")
        .bind(item.tenant_id).bind(item.branch_id).bind(item.source_type).bind(item.source_id)
        .bind(item.client_id).bind(item.channel).bind(item.recipient).bind(item.payload).execute(db).await?.rows_affected()>0)
}

pub async fn due_marketing_campaigns(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<MarketingCampaignRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT notification.id,notification.tenant_id,notification.branch_id,notification.title,notification.body,notification.metadata_json->>'audience' AS audience,notification.metadata_json,COALESCE(tenant.slug,tenant.id) AS tenant_slug FROM notifications notification JOIN tenants tenant ON tenant.id=notification.tenant_id WHERE notification.notification_type='marketing_campaign' AND notification.metadata_json->>'status'='scheduled' AND notification.metadata_json->>'approvalStatus'='approved' AND notification.metadata_json->>'scheduledAt'<>'' AND (notification.metadata_json->>'scheduledAt')::TIMESTAMPTZ<=NOW() ORDER BY (notification.metadata_json->>'scheduledAt')::TIMESTAMPTZ,notification.id LIMIT $1",
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn marketing_recipients(
    db: &PgPool,
    campaign: &MarketingCampaignRecord,
    channel: &str,
) -> Result<Vec<MarketingRecipientRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH latest AS (
             SELECT DISTINCT ON (client_id) client_id,churn_risk_score
               FROM client_intelligence_snapshots
              WHERE tenant_id=$1 AND branch_id=$2
              ORDER BY client_id,snapshot_date DESC,calculated_at DESC
           )
           SELECT c.id AS client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,
                  CASE $3 WHEN 'email' THEN COALESCE(c.email,'') ELSE COALESCE(c.phone,'') END AS recipient
             FROM clients c
             LEFT JOIN latest ON latest.client_id=c.id
            WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.active=TRUE
              AND c.merged_into_client_id IS NULL
              AND c.marketing_sensitive_excluded=FALSE
              AND CASE $3 WHEN 'whatsapp' THEN c.whatsapp_opt_in IS TRUE
                          WHEN 'sms' THEN c.sms_opt_in IS TRUE
                          WHEN 'email' THEN c.email_opt_in IS TRUE ELSE FALSE END
              AND CASE $4 WHEN 'at-risk' THEN COALESCE(latest.churn_risk_score,0)>=70 ELSE TRUE END
              AND CASE WHEN $4 LIKE 'win-back-%' THEN
                    GREATEST(CURRENT_DATE-COALESCE((SELECT MAX(a.start_at)::DATE FROM appointments a WHERE a.tenant_id=c.tenant_id AND a.branch_id=c.branch_id AND a.client_id=c.id AND a.status IN ('completed','billed','paid')),c.created_at::DATE),0) >= NULLIF(SPLIT_PART($4,'-',3),'')::INTEGER
                  ELSE TRUE END
              AND CASE $4 WHEN 'active' THEN EXISTS (
                    SELECT 1 FROM appointments appointment
                     WHERE appointment.tenant_id=c.tenant_id
                       AND appointment.branch_id=c.branch_id
                       AND appointment.client_id=c.id
                       AND appointment.start_at>=NOW()-INTERVAL '180 days'
                       AND appointment.status NOT IN ('cancelled','no_show')
                  ) ELSE TRUE END
              AND CASE $3 WHEN 'email' THEN COALESCE(c.email,'')<>'' ELSE COALESCE(c.phone,'')<>'' END
              AND NOT EXISTS (
                    SELECT 1 FROM benefit_notification_outbox prior
                     WHERE prior.tenant_id=c.tenant_id AND prior.branch_id=c.branch_id AND prior.client_id=c.id
                       AND prior.source_type='marketing_campaign' AND prior.payload_json->>'campaignId' IS DISTINCT FROM $5 AND prior.status IN ('queued','processing','sent')
                       AND prior.created_at>=NOW()-MAKE_INTERVAL(days=>COALESCE((SELECT frequency_cap_days FROM marketing_governance_settings settings WHERE settings.tenant_id=c.tenant_id AND settings.branch_id=c.branch_id),7))
                  )
            ORDER BY c.id"#,
    )
    .bind(&campaign.tenant_id)
    .bind(&campaign.branch_id)
    .bind(channel)
    .bind(&campaign.audience)
    .bind(&campaign.id)
    .fetch_all(db)
    .await
}

pub async fn mark_campaign_queued(
    db: &PgPool,
    campaign: &MarketingCampaignRecord,
    recipient_count: usize,
) -> Result<(), sqlx::Error> {
    let status = if recipient_count == 0 {
        "failed"
    } else {
        "queued"
    };
    let error = if recipient_count == 0 {
        "no consented recipients matched the audience"
    } else {
        ""
    };
    sqlx::query(
        "UPDATE notifications SET metadata_json=jsonb_set(jsonb_set(jsonb_set(metadata_json,'{status}',to_jsonb($4::TEXT),TRUE),'{recipientCount}',to_jsonb($5::BIGINT),TRUE),'{lastError}',to_jsonb($6::TEXT),TRUE),updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND notification_type='marketing_campaign' AND metadata_json->>'status'='scheduled'",
    )
    .bind(&campaign.id)
    .bind(&campaign.tenant_id)
    .bind(&campaign.branch_id)
    .bind(status)
    .bind(recipient_count as i64)
    .bind(error)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn schedule_campaign_recurrence(
    db: &PgPool,
    campaign: &MarketingCampaignRecord,
) -> Result<(), sqlx::Error> {
    let recurrence = campaign
        .metadata_json
        .get("recurrence")
        .and_then(Value::as_str)
        .unwrap_or("once");
    let interval = match recurrence {
        "daily" => "1 day",
        "weekly" => "1 week",
        "monthly" => "1 month",
        _ => return Ok(()),
    };
    sqlx::query(r#"INSERT INTO notifications(id,tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,metadata_json,is_read,created_at,updated_at)
      SELECT gen_random_uuid()::TEXT,tenant_id,branch_id,user_id,created_by,notification_type,title,body,resource_type,resource_id,
             jsonb_set(jsonb_set(metadata_json,'{status}','\"scheduled\"'::JSONB,TRUE),'{scheduledAt}',to_jsonb(((metadata_json->>'scheduledAt')::TIMESTAMPTZ+$4::INTERVAL)::TEXT),TRUE),FALSE,NOW(),NOW()
        FROM notifications WHERE id=$1 AND tenant_id=$2 AND branch_id=$3 AND notification_type='marketing_campaign'"#)
        .bind(&campaign.id).bind(&campaign.tenant_id).bind(&campaign.branch_id).bind(interval).execute(db).await?;
    Ok(())
}

pub async fn refresh_marketing_campaign_statuses(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"WITH counts AS (
             SELECT payload_json->>'campaignId' AS campaign_id,
                    COUNT(*)::BIGINT AS total,
                    COUNT(*) FILTER (WHERE status='sent')::BIGINT AS sent,
                    COUNT(*) FILTER (WHERE status='failed' AND attempts>=max_attempts)::BIGINT AS failed,
                    COUNT(*) FILTER (WHERE status='blocked')::BIGINT AS blocked,
                    COUNT(*) FILTER (WHERE status IN ('queued','processing') OR (status='failed' AND attempts<max_attempts))::BIGINT AS pending
               FROM benefit_notification_outbox
              WHERE source_type='marketing_campaign'
              GROUP BY payload_json->>'campaignId'
           )
           UPDATE notifications n SET metadata_json=
             jsonb_set(jsonb_set(jsonb_set(jsonb_set(n.metadata_json,'{status}',to_jsonb(CASE WHEN c.pending>0 THEN 'queued' WHEN c.failed>0 THEN 'failed' ELSE 'delivered' END::TEXT),TRUE),'{deliveredCount}',to_jsonb(c.sent),TRUE),'{failedCount}',to_jsonb(c.failed),TRUE),'{blockedCount}',to_jsonb(c.blocked),TRUE),updated_at=NOW()
             FROM counts c WHERE n.id=c.campaign_id AND n.notification_type='marketing_campaign'"#,
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn approved_membership_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<(String, String, String, String, String, String)>, sqlx::Error> {
    sqlx::query_as("SELECT r.id,r.client_id,COALESCE(c.phone,''),COALESCE(c.email,''),r.message,CONCAT_WS(' ',c.first_name,c.last_name) FROM membership_reminders r JOIN clients c ON c.id=r.client_id AND c.tenant_id=r.tenant_id AND c.branch_id=r.branch_id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.status='approved' AND c.merged_into_client_id IS NULL ORDER BY r.approved_at,r.id LIMIT 250")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn claim_due(db: &PgPool, limit: i64) -> Result<Vec<BenefitDeliveryRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows = sqlx::query_as::<_, BenefitDeliveryRecord>(
        r#"WITH due AS (SELECT outbox.id FROM benefit_notification_outbox outbox WHERE outbox.status IN ('queued','failed') AND outbox.next_attempt_at<=NOW() AND outbox.attempts<outbox.max_attempts
          AND (outbox.source_type<>'marketing_campaign' OR NOT EXISTS (
            SELECT 1 FROM marketing_governance_settings settings WHERE settings.tenant_id=outbox.tenant_id AND settings.branch_id=outbox.branch_id AND
            CASE WHEN settings.quiet_start<settings.quiet_end THEN (NOW() AT TIME ZONE settings.timezone)::TIME>=settings.quiet_start AND (NOW() AT TIME ZONE settings.timezone)::TIME<settings.quiet_end
                 ELSE (NOW() AT TIME ZONE settings.timezone)::TIME>=settings.quiet_start OR (NOW() AT TIME ZONE settings.timezone)::TIME<settings.quiet_end END))
          ORDER BY outbox.next_attempt_at,outbox.created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE benefit_notification_outbox o SET status='processing',attempts=o.attempts+1,updated_at=NOW() FROM due WHERE o.id=due.id RETURNING o.id,o.tenant_id,o.branch_id,o.source_type,o.source_id,o.client_id,o.channel,o.payload_json,o.attempts,o.max_attempts"#,
    )
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows)
}

pub async fn mark_blocked(db: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE benefit_notification_outbox SET status='blocked',last_error='client consent missing or withdrawn',updated_at=NOW() WHERE id=$1")
        .bind(id).execute(db).await?;
    Ok(())
}

pub async fn mark_sent(
    db: &PgPool,
    row: &BenefitDeliveryRecord,
    provider_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE benefit_notification_outbox SET status='sent',provider_message_id=$2,last_error='',sent_at=NOW(),updated_at=NOW() WHERE id=$1")
        .bind(&row.id).bind(provider_id).execute(&mut *tx).await?;
    if row.source_type == "membership_reminder" {
        sqlx::query("UPDATE membership_reminders SET status='sent',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='approved'")
            .bind(&row.tenant_id).bind(&row.branch_id).bind(&row.source_id).execute(&mut *tx).await?;
    }
    tx.commit().await
}

pub async fn mark_failed(
    db: &PgPool,
    row: &BenefitDeliveryRecord,
    error: &str,
) -> Result<(), sqlx::Error> {
    let retry_minutes = if row.attempts >= row.max_attempts {
        24 * 60
    } else {
        i64::from(row.attempts.max(1))
            .saturating_mul(15)
            .min(24 * 60)
    };
    sqlx::query("UPDATE benefit_notification_outbox SET status='failed',last_error=$2,next_attempt_at=NOW()+($3::BIGINT*INTERVAL '1 minute'),updated_at=NOW() WHERE id=$1")
        .bind(&row.id).bind(error).bind(retry_minutes).execute(db).await?;
    Ok(())
}
