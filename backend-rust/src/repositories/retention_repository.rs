use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardRecord {
    pub id: String,
    pub code: String,
    pub client_id: String,
    pub initial_amount_paise: i64,
    pub balance_paise: i64,
    pub status: String,
    pub expires_at: Option<NaiveDate>,
    pub source_sale_id: String,
    pub reissued_from_id: String,
    pub void_reason: String,
    pub voided_by: String,
    pub voided_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardListRecord {
    pub id: String,
    pub code: String,
    pub client_id: String,
    pub client_name: String,
    pub initial_amount_paise: i64,
    pub balance_paise: i64,
    pub status: String,
    pub expires_at: Option<NaiveDate>,
    pub source_sale_id: String,
    pub reissued_from_id: String,
    pub void_reason: String,
    pub voided_by: String,
    pub voided_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GiftCardTransactionRecord {
    pub id: String,
    pub gift_card_id: String,
    pub sale_id: String,
    pub transaction_type: String,
    pub delta_paise: i64,
    pub balance_after_paise: i64,
    pub notes: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralCodeRecord {
    pub id: String,
    pub client_id: String,
    pub code: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralRecord {
    pub id: String,
    pub referrer_client_id: String,
    pub referrer_name: String,
    pub referred_client_id: String,
    pub referred_name: String,
    pub code: String,
    pub status: String,
    pub created_by: String,
    pub completed_by: String,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

const GIFT_COLUMNS: &str = "id,code,client_id,initial_amount_paise,balance_paise,status,expires_at,source_sale_id,reissued_from_id,void_reason,voided_by,voided_at,created_at,updated_at";
const REFERRAL_COLUMNS: &str = "r.id,r.referrer_client_id,CONCAT_WS(' ',a.first_name,a.last_name) AS referrer_name,r.referred_client_id,CONCAT_WS(' ',b.first_name,b.last_name) AS referred_name,c.code,r.status,r.created_by,r.completed_by,r.completed_at,r.created_at";

pub async fn list_gift_cards(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: Option<&str>,
    status: Option<&str>,
    code: Option<&str>,
) -> Result<Vec<GiftCardListRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT g.id,g.code,g.client_id,
               COALESCE(NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),g.client_id) AS client_name,
               g.initial_amount_paise,g.balance_paise,g.status,g.expires_at,g.source_sale_id,
               g.reissued_from_id,g.void_reason,g.voided_by,g.voided_at,g.created_at,g.updated_at
        FROM gift_cards g
        LEFT JOIN clients c
          ON c.tenant_id=g.tenant_id AND c.branch_id=g.branch_id AND c.id=g.client_id
        WHERE g.tenant_id=$1 AND g.branch_id=$2
          AND ($3='' OR g.client_id=$3)
          AND ($4='' OR g.status=$4)
          AND ($5='' OR UPPER(g.code)=UPPER($5))
        ORDER BY g.created_at DESC
        LIMIT 500
        "#,
    )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id.unwrap_or(""))
        .bind(status.unwrap_or(""))
        .bind(code.unwrap_or(""))
        .fetch_all(db)
        .await
}

pub async fn gift_card(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<GiftCardRecord>, sqlx::Error> {
    let sql = format!(
        "SELECT {GIFT_COLUMNS} FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"
    );
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn gift_card_transactions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Vec<GiftCardTransactionRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,gift_card_id,sale_id,transaction_type,delta_paise,balance_after_paise,notes,created_at FROM gift_card_transactions WHERE tenant_id=$1 AND branch_id=$2 AND gift_card_id=$3 ORDER BY created_at DESC,id DESC")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_all(db).await
}

pub async fn void_gift_card(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    reason: &str,
    key: &str,
    actor: &str,
) -> Result<Option<GiftCardRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let replay: Option<String> = sqlx::query_scalar("SELECT id FROM gift_card_transactions WHERE tenant_id=$1 AND branch_id=$2 AND gift_card_id=$3 AND idempotency_key=$4")
        .bind(tenant_id).bind(branch_id).bind(id).bind(key).fetch_optional(&mut *tx).await?;
    if replay.is_some() {
        tx.commit().await?;
        return gift_card(db, tenant_id, branch_id, id).await;
    }
    let locked: Option<(i64, String)> = sqlx::query_as("SELECT balance_paise,status FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut *tx).await?;
    let Some((balance, status)) = locked else {
        return Ok(None);
    };
    if status != "active" || balance <= 0 {
        return Ok(None);
    }
    sqlx::query("UPDATE gift_cards SET balance_paise=0,status='voided',void_reason=$4,voided_by=$5,voided_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(reason).bind(actor).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO gift_card_transactions (tenant_id,branch_id,gift_card_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes) VALUES ($1,$2,$3,'adjustment_debit',$4,0,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(-balance).bind(key).bind(reason).execute(&mut *tx).await?;
    tx.commit().await?;
    gift_card(db, tenant_id, branch_id, id).await
}

#[allow(clippy::too_many_arguments)]
pub async fn reissue_gift_card(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    code: &str,
    expires_at: Option<NaiveDate>,
    reason: &str,
    key: &str,
    actor: &str,
) -> Result<Option<GiftCardRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let replay_sql = format!("SELECT {GIFT_COLUMNS} FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3");
    if let Some(existing) = sqlx::query_as(&replay_sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?
    {
        tx.commit().await?;
        return Ok(Some(existing));
    }
    let locked: Option<(String, i64, String)> = sqlx::query_as("SELECT client_id,balance_paise,status FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut *tx).await?;
    let Some((client_id, balance, status)) = locked else {
        return Ok(None);
    };
    if status != "active" || balance <= 0 {
        return Ok(None);
    }
    sqlx::query("UPDATE gift_cards SET balance_paise=0,status='voided',void_reason=$4,voided_by=$5,voided_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(reason).bind(actor).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO gift_card_transactions (tenant_id,branch_id,gift_card_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes) VALUES ($1,$2,$3,'adjustment_debit',$4,0,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(-balance).bind(format!("{key}:old")).bind(reason).execute(&mut *tx).await?;
    let insert_sql = format!("INSERT INTO gift_cards (tenant_id,branch_id,code,client_id,initial_amount_paise,balance_paise,expires_at,idempotency_key,reissued_from_id) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8) RETURNING {GIFT_COLUMNS}");
    let replacement: GiftCardRecord = sqlx::query_as(&insert_sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(code)
        .bind(client_id)
        .bind(balance)
        .bind(expires_at)
        .bind(key)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO gift_card_transactions (tenant_id,branch_id,gift_card_id,transaction_type,delta_paise,balance_after_paise,idempotency_key,notes) VALUES ($1,$2,$3,'issue',$4,$4,$5,$6)")
        .bind(tenant_id).bind(branch_id).bind(&replacement.id).bind(balance).bind(format!("{key}:new")).bind(reason).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(replacement))
}

pub async fn reward_balance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<i32, sqlx::Error> {
    sqlx::query_scalar("SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(db).await.map(|value| value.unwrap_or(0))
}

pub async fn reward_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'transactionType',transaction_type,'points',points,'balanceAfter',balance_after,'expiresAt',expires_at,'note',note,'createdAt',created_at) FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn referral_code(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<ReferralCodeRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,client_id,code,active,created_at FROM client_referral_codes WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(db).await
}

pub async fn ensure_referral_code(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    code: &str,
    actor: &str,
) -> Result<Option<ReferralCodeRecord>, sqlx::Error> {
    sqlx::query_as("INSERT INTO client_referral_codes (tenant_id,branch_id,client_id,code,created_by) SELECT $1,$2,id,$4,$5 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 ON CONFLICT (tenant_id,branch_id,client_id) DO UPDATE SET active=TRUE,updated_at=NOW() RETURNING id,client_id,code,active,created_at")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(code).bind(actor).fetch_optional(db).await
}

pub async fn list_referrals(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ReferralRecord>, sqlx::Error> {
    let sql = format!("SELECT {REFERRAL_COLUMNS} FROM client_referrals r JOIN clients a ON a.id=r.referrer_client_id JOIN clients b ON b.id=r.referred_client_id JOIN client_referral_codes c ON c.id=r.referral_code_id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.referrer_client_id=$3 ORDER BY r.created_at DESC");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .fetch_all(db)
        .await
}

pub async fn referred_by(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<ReferralRecord>, sqlx::Error> {
    let sql = format!("SELECT {REFERRAL_COLUMNS} FROM client_referrals r JOIN clients a ON a.id=r.referrer_client_id JOIN clients b ON b.id=r.referred_client_id JOIN client_referral_codes c ON c.id=r.referral_code_id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.referred_client_id=$3");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(client_id)
        .fetch_optional(db)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_referral(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    referrer_id: &str,
    referred_id: &str,
    code_id: &str,
    key: &str,
    actor: &str,
) -> Result<Option<ReferralRecord>, sqlx::Error> {
    let sql = format!("WITH inserted AS (INSERT INTO client_referrals (tenant_id,branch_id,referrer_client_id,referred_client_id,referral_code_id,idempotency_key,created_by) SELECT $1,$2,$3,b.id,$5,$6,$7 FROM clients b WHERE b.tenant_id=$1 AND b.branch_id=$2 AND b.id=$4 ON CONFLICT (tenant_id,branch_id,idempotency_key) DO UPDATE SET updated_at=client_referrals.updated_at RETURNING *) SELECT {REFERRAL_COLUMNS} FROM inserted r JOIN clients a ON a.id=r.referrer_client_id JOIN clients b ON b.id=r.referred_client_id JOIN client_referral_codes c ON c.id=r.referral_code_id");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(referrer_id)
        .bind(referred_id)
        .bind(code_id)
        .bind(key)
        .bind(actor)
        .fetch_optional(db)
        .await
}

pub async fn complete_referral(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    referrer_points: i32,
    referred_points: i32,
    actor: &str,
) -> Result<Option<ReferralRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let referral: Option<(String, String, String)> = sqlx::query_as("SELECT referrer_client_id,referred_client_id,status FROM client_referrals WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut *tx).await?;
    let Some((referrer_id, referred_id, status)) = referral else {
        return Ok(None);
    };
    if status == "pending" {
        let mut ids = [referrer_id.as_str(), referred_id.as_str()];
        ids.sort_unstable();
        for client_id in ids {
            sqlx::query(
                "SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(client_id)
            .execute(&mut *tx)
            .await?;
        }
        for (client_id, points, role) in [
            (&referrer_id, referrer_points, "referrer"),
            (&referred_id, referred_points, "referred"),
        ] {
            if points <= 0 {
                continue;
            }
            let balance: i32 = sqlx::query_scalar("SELECT balance_after FROM membership_reward_ledger WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1").bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(&mut *tx).await?.unwrap_or(0);
            sqlx::query("INSERT INTO membership_reward_ledger (tenant_id,branch_id,client_id,transaction_type,points,balance_after,staff_id,note,idempotency_key) VALUES ($1,$2,$3,'adjusted',$4,$5,$6,'Referral reward',$7) ON CONFLICT DO NOTHING")
                .bind(tenant_id).bind(branch_id).bind(client_id).bind(points).bind(balance.saturating_add(points)).bind(actor).bind(format!("referral:{id}:{role}")).execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE client_referrals SET status='completed',completed_by=$4,completed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(id).bind(actor).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    let sql = format!("SELECT {REFERRAL_COLUMNS} FROM client_referrals r JOIN clients a ON a.id=r.referrer_client_id JOIN clients b ON b.id=r.referred_client_id JOIN client_referral_codes c ON c.id=r.referral_code_id WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.id=$3");
    sqlx::query_as(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}
