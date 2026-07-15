use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(Debug, FromRow)]
pub struct MarketingCampaignRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub title: String,
    pub body: String,
    pub channel: String,
    pub audience: String,
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
        "SELECT id,tenant_id,branch_id,title,body,metadata_json->>'channel' AS channel,metadata_json->>'audience' AS audience FROM notifications WHERE notification_type='marketing_campaign' AND metadata_json->>'status'='scheduled' AND metadata_json->>'scheduledAt'<>'' AND (metadata_json->>'scheduledAt')::TIMESTAMPTZ<=NOW() ORDER BY (metadata_json->>'scheduledAt')::TIMESTAMPTZ,id LIMIT $1",
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn marketing_recipients(
    db: &PgPool,
    campaign: &MarketingCampaignRecord,
) -> Result<Vec<MarketingRecipientRecord>, sqlx::Error> {
    let channel = campaign.channel.as_str();
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
              AND CASE $3 WHEN 'whatsapp' THEN c.whatsapp_opt_in IS TRUE
                          WHEN 'sms' THEN c.sms_opt_in IS TRUE
                          WHEN 'email' THEN c.email_opt_in IS TRUE ELSE FALSE END
              AND CASE $4 WHEN 'at-risk' THEN COALESCE(latest.churn_risk_score,0)>=70 ELSE TRUE END
              AND CASE $4 WHEN 'active' THEN EXISTS (
                    SELECT 1 FROM appointments appointment
                     WHERE appointment.tenant_id=c.tenant_id
                       AND appointment.branch_id=c.branch_id
                       AND appointment.client_id=c.id
                       AND appointment.start_at>=NOW()-INTERVAL '180 days'
                       AND appointment.status NOT IN ('cancelled','no_show')
                  ) ELSE TRUE END
              AND CASE $3 WHEN 'email' THEN COALESCE(c.email,'')<>'' ELSE COALESCE(c.phone,'')<>'' END
            ORDER BY c.id"#,
    )
    .bind(&campaign.tenant_id)
    .bind(&campaign.branch_id)
    .bind(channel)
    .bind(&campaign.audience)
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
        "WITH due AS (SELECT id FROM benefit_notification_outbox WHERE status IN ('queued','failed') AND next_attempt_at<=NOW() AND attempts<max_attempts ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE benefit_notification_outbox o SET status='processing',attempts=o.attempts+1,updated_at=NOW() FROM due WHERE o.id=due.id RETURNING o.id,o.tenant_id,o.branch_id,o.source_type,o.source_id,o.client_id,o.channel,o.payload_json,o.attempts,o.max_attempts",
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
