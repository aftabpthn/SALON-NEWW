use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Postgres, Transaction};

#[derive(Debug, Clone)]
pub struct InboundIdentity {
    pub client_id: Option<String>,
    pub lead_id: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedCommunication {
    pub id: String,
    pub thread_key: String,
    pub client_id: Option<String>,
    pub lead_id: Option<String>,
    pub contact_name: String,
    pub channel: String,
    pub direction: String,
    pub status: String,
    pub subject: String,
    pub body: String,
    pub occurred_at: DateTime<Utc>,
    pub assigned_to: String,
    pub priority: String,
    pub thread_status: String,
    pub sla_due_at: DateTime<Utc>,
    pub first_responded_at: Option<DateTime<Utc>>,
    pub response_overdue: bool,
    pub appointment_id: Option<String>,
    pub invoice_id: Option<String>,
    pub invoice_number: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ThreadState {
    pub id: String,
    pub thread_key: String,
    pub client_id: Option<String>,
    pub lead_id: Option<String>,
    pub status: String,
    pub priority: String,
    pub assigned_to: String,
    pub first_received_at: DateTime<Utc>,
    pub first_responded_at: Option<DateTime<Utc>>,
    pub sla_due_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub last_activity_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SlaSummary {
    pub open_threads: i64,
    pub assigned_threads: i64,
    pub unassigned_threads: i64,
    pub overdue_threads: i64,
    pub resolved_today: i64,
    pub avg_first_response_seconds: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct ReplyContext {
    pub client_id: Option<String>,
    pub lead_id: Option<String>,
    pub channel: String,
}

pub async fn list_timeline(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    thread_key: &str,
    channel: &str,
) -> Result<Vec<UnifiedCommunication>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT communication.id,
                  CASE WHEN communication.client_id IS NOT NULL THEN 'client:'||communication.client_id ELSE 'lead:'||communication.lead_id END AS thread_key,
                  communication.client_id,communication.lead_id,
                  COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),
                           NULLIF(TRIM(CONCAT_WS(' ',lead.first_name,lead.last_name)),''),'Inbound contact') AS contact_name,
                  communication.channel,communication.direction,communication.status,
                  communication.subject,communication.body,communication.occurred_at,
                  COALESCE(thread.assigned_to,'') AS assigned_to,
                  COALESCE(thread.priority,'normal') AS priority,
                  COALESCE(thread.status,'open') AS thread_status,
                  COALESCE(thread.sla_due_at,communication.occurred_at+INTERVAL '30 minutes') AS sla_due_at,
                  thread.first_responded_at,
                  COALESCE(thread.first_responded_at IS NULL AND thread.status<>'resolved' AND thread.sla_due_at<NOW(),FALSE) AS response_overdue,
                  COALESCE(lead.converted_appointment_id,voice.appointment_id) AS appointment_id,
                  invoice.id AS invoice_id,invoice.invoice_number
             FROM client_communications communication
             LEFT JOIN clients client ON client.tenant_id=communication.tenant_id
                                     AND client.branch_id=communication.branch_id
                                     AND client.id=communication.client_id
             LEFT JOIN marketing_leads lead ON lead.tenant_id=communication.tenant_id
                                           AND lead.branch_id=communication.branch_id
                                           AND lead.id=communication.lead_id
             LEFT JOIN ai_voice_call_records voice ON communication.source_type='voice'
                                                    AND voice.tenant_id=communication.tenant_id
                                                    AND voice.branch_id=communication.branch_id
                                                    AND voice.id=communication.source_id
             LEFT JOIN communication_thread_states thread ON thread.tenant_id=communication.tenant_id
                                                         AND thread.branch_id=communication.branch_id
                                                         AND thread.thread_key=CASE WHEN communication.client_id IS NOT NULL THEN 'client:'||communication.client_id ELSE 'lead:'||communication.lead_id END
             LEFT JOIN LATERAL (
               SELECT sale.id,sale.invoice_number FROM pos_sales sale
                WHERE sale.tenant_id=communication.tenant_id AND sale.branch_id=communication.branch_id
                  AND sale.source='appointment'
                  AND sale.reference_id=COALESCE(lead.converted_appointment_id,voice.appointment_id)
                ORDER BY sale.created_at DESC,sale.id DESC LIMIT 1
             ) invoice ON TRUE
            WHERE communication.tenant_id=$1 AND communication.branch_id=$2
              AND ($3='' OR CASE WHEN communication.client_id IS NOT NULL THEN 'client:'||communication.client_id ELSE 'lead:'||communication.lead_id END=$3)
              AND ($4='' OR communication.channel=$4)
            ORDER BY communication.occurred_at DESC,communication.id DESC LIMIT 500"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(thread_key)
    .bind(channel)
    .fetch_all(db)
    .await
}

pub async fn sla_summary(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<SlaSummary, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT COUNT(*) FILTER(WHERE status='open')::BIGINT AS open_threads,
                  COUNT(*) FILTER(WHERE status='assigned')::BIGINT AS assigned_threads,
                  COUNT(*) FILTER(WHERE status<>'resolved' AND assigned_to='')::BIGINT AS unassigned_threads,
                  COUNT(*) FILTER(WHERE status<>'resolved' AND first_responded_at IS NULL AND sla_due_at<NOW())::BIGINT AS overdue_threads,
                  COUNT(*) FILTER(WHERE status='resolved' AND resolved_at::DATE=(NOW() AT TIME ZONE 'Asia/Kolkata')::DATE)::BIGINT AS resolved_today,
                  AVG(EXTRACT(EPOCH FROM first_responded_at-first_received_at)) FILTER(WHERE first_responded_at IS NOT NULL)::FLOAT8 AS avg_first_response_seconds
             FROM communication_thread_states WHERE tenant_id=$1 AND branch_id=$2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn latest_reply_context(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    thread_key: &str,
) -> Result<Option<ReplyContext>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT client_id,lead_id,channel FROM client_communications
            WHERE tenant_id=$1 AND branch_id=$2 AND direction='inbound'
              AND CASE WHEN client_id IS NOT NULL THEN 'client:'||client_id ELSE 'lead:'||lead_id END=$3
            ORDER BY occurred_at DESC,id DESC LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(thread_key)
    .fetch_optional(db)
    .await
}

pub async fn assignee_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    if user_id.is_empty() {
        return Ok(true);
    }
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND id=$2 AND active=TRUE AND (branch_id IS NULL OR branch_id=$3))",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn update_thread(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    thread_key: &str,
    status: &str,
    priority: &str,
    assigned_to: &str,
    note: &str,
    actor_user_id: &str,
) -> Result<Option<ThreadState>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let before = thread_for_update(&mut tx, tenant_id, branch_id, thread_key).await?;
    let Some(before) = before else {
        return Ok(None);
    };
    let after = sqlx::query_as::<_, ThreadState>(
        r#"UPDATE communication_thread_states SET status=$4,priority=$5,assigned_to=$6,
                  resolved_at=CASE WHEN $4='resolved' THEN COALESCE(resolved_at,NOW()) ELSE NULL END,
                  updated_at=NOW()
            WHERE tenant_id=$1 AND branch_id=$2 AND thread_key=$3
        RETURNING id,thread_key,client_id,lead_id,status,priority,assigned_to,first_received_at,
                  first_responded_at,sla_due_at,resolved_at,last_activity_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(thread_key)
    .bind(status)
    .bind(priority)
    .bind(assigned_to)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO communication_thread_audit(
              tenant_id,branch_id,thread_id,action,actor_user_id,before_json,after_json
            ) VALUES($1,$2,$3,'thread.updated',$4,$5,$6)"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&after.id)
    .bind(actor_user_id)
    .bind(serde_json::json!({"status":before.status,"priority":before.priority,"assignedTo":before.assigned_to}))
    .bind(serde_json::json!({"status":after.status,"priority":after.priority,"assignedTo":after.assigned_to,"note":note}))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(after))
}

async fn thread_for_update(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    thread_key: &str,
) -> Result<Option<ThreadState>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,thread_key,client_id,lead_id,status,priority,assigned_to,first_received_at,
                  first_responded_at,sla_due_at,resolved_at,last_activity_at,updated_at
             FROM communication_thread_states
            WHERE tenant_id=$1 AND branch_id=$2 AND thread_key=$3 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(thread_key)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn resolve_or_create_inbound_identity(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    channel: &str,
    phone: &str,
) -> Result<InboundIdentity, sqlx::Error> {
    let digits = phone
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    if !(7..=15).contains(&digits.len()) {
        return Ok(InboundIdentity {
            client_id: None,
            lead_id: None,
        });
    }
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("communication:{tenant_id}:{branch_id}:{digits}"))
        .execute(&mut *tx)
        .await?;
    let clients: Vec<String> = sqlx::query_scalar(
        r#"SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE
              AND merged_into_client_id IS NULL
              AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g')=$3 ORDER BY id LIMIT 2"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&digits)
    .fetch_all(&mut *tx)
    .await?;
    if clients.len() == 1 {
        tx.commit().await?;
        return Ok(InboundIdentity {
            client_id: clients.into_iter().next(),
            lead_id: None,
        });
    }
    if clients.len() > 1 {
        tx.commit().await?;
        return Ok(InboundIdentity {
            client_id: None,
            lead_id: None,
        });
    }
    let existing: Option<String> = sqlx::query_scalar(
        r#"SELECT id FROM marketing_leads WHERE tenant_id=$1 AND branch_id=$2
              AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g')=$3
            ORDER BY CASE WHEN stage NOT IN ('converted','lost') THEN 0 ELSE 1 END,updated_at DESC,id LIMIT 1"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&digits)
    .fetch_optional(&mut *tx)
    .await?;
    let lead_id = match existing {
        Some(id) => id,
        None => {
            let capture_channel = if channel == "voice" { "phone" } else { channel };
            sqlx::query_scalar(
                r#"INSERT INTO marketing_leads(
                      tenant_id,branch_id,first_name,phone,source,stage,qualification_status,
                      created_by,capture_channel,external_source_id,sla_due_at
                    ) VALUES($1,$2,'Inbound contact',$3,$4,'new','unqualified','provider:webhook',$5,$6,NOW()+INTERVAL '30 minutes')
                 RETURNING id"#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&digits)
            .bind(format!("inbound_{channel}"))
            .bind(capture_channel)
            .bind(format!("contact:{digits}"))
            .fetch_one(&mut *tx)
            .await?
        }
    };
    tx.commit().await?;
    Ok(InboundIdentity {
        client_id: None,
        lead_id: Some(lead_id),
    })
}

pub async fn provider_failure_counts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(i64, i64), sqlx::Error> {
    sqlx::query_as(
        r#"SELECT
          (SELECT COUNT(*) FROM benefit_notification_outbox WHERE tenant_id=$1 AND branch_id=$2 AND status IN ('failed','dead_letter') AND updated_at>=NOW()-INTERVAL '1 hour')::BIGINT,
          (SELECT COUNT(*) FROM ai_voice_call_records WHERE tenant_id=$1 AND branch_id=$2 AND status='failed' AND created_at>=NOW()-INTERVAL '1 hour')::BIGINT"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_one(db)
    .await
}

pub async fn redact_expired_content(db: &PgPool) -> Result<u64, sqlx::Error> {
    sqlx::query(
        r#"UPDATE client_communications
              SET recipient='',subject='Communication content expired',body='',last_error='',
                  redacted_at=NOW(),updated_at=NOW()
            WHERE redacted_at IS NULL AND retained_until IS NOT NULL AND retained_until<NOW()
              AND source_type IN ('provider','voice','marketing')"#,
    )
    .execute(db)
    .await
    .map(|result| result.rows_affected())
}
