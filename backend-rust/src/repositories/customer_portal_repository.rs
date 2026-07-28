use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, FromRow)]
pub struct ChallengeRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub target_type: String,
    pub target: String,
    pub purpose: String,
    pub code_hash: String,
    pub metadata_json: Value,
    pub attempt_count: i16,
    pub max_attempts: i16,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub normalized_phone: String,
    pub email: String,
    pub phone_verified_at: Option<DateTime<Utc>>,
    pub email_verified_at: Option<DateTime<Utc>>,
    pub communication_preferences: Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct OwnedBooking {
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
}

#[derive(Debug, FromRow)]
pub struct MembershipCheckoutPlan {
    pub tenant_id: String,
    pub branch_id: String,
    pub id: String,
    pub name: String,
    pub price_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct PackageCheckoutPlan {
    pub tenant_id: String,
    pub branch_id: String,
    pub id: String,
    pub name: String,
    pub price_paise: i64,
}

#[derive(Debug, FromRow)]
pub struct CustomerBranchContext {
    pub tenant_id: String,
    pub branch_id: String,
    pub client_id: String,
}

#[derive(Debug, FromRow)]
pub struct OwnedMembership {
    pub tenant_id: String,
    pub branch_id: String,
}

#[derive(Debug, FromRow)]
pub struct OwnedInvoice {
    pub tenant_id: String,
    pub branch_id: String,
    pub balance_paise: i64,
    pub status: String,
}

#[derive(Debug, FromRow)]
pub struct OwnedBookingInvoice {
    pub tenant_id: String,
    pub branch_id: String,
    pub invoice_id: String,
    pub balance_paise: i64,
    pub status: String,
}

#[derive(Debug, FromRow)]
pub struct OwnedGiftCard {
    pub id: String,
    pub balance_paise: i64,
    pub status: String,
}

const ACCOUNT_COLUMNS: &str = "id,first_name,last_name,phone,normalized_phone,email,phone_verified_at,email_verified_at,communication_preferences,status,created_at,updated_at";

#[allow(clippy::too_many_arguments)]
pub async fn create_challenge(
    db: &PgPool,
    account_id: Option<&str>,
    tenant_id: &str,
    branch_id: &str,
    target_type: &str,
    target: &str,
    purpose: &str,
    code_hash: &str,
    metadata: &Value,
    expires_at: DateTime<Utc>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO customer_verification_challenges (account_id,tenant_id,branch_id,target_type,target,purpose,code_hash,metadata_json,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id")
        .bind(account_id).bind(tenant_id).bind(branch_id).bind(target_type).bind(target)
        .bind(purpose).bind(code_hash).bind(metadata).bind(expires_at).fetch_one(db).await
}

pub async fn delete_challenge(db: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM customer_verification_challenges WHERE id=$1 AND consumed_at IS NULL")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn latest_challenge(
    db: &PgPool,
    target_type: &str,
    target: &str,
    purpose: &str,
    account_id: Option<&str>,
) -> Result<Option<ChallengeRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,target_type,target,purpose,code_hash,metadata_json,attempt_count,max_attempts,expires_at FROM customer_verification_challenges WHERE target_type=$1 AND target=$2 AND purpose=$3 AND consumed_at IS NULL AND ($4::TEXT IS NULL OR account_id=$4) ORDER BY created_at DESC LIMIT 1")
        .bind(target_type).bind(target).bind(purpose).bind(account_id).fetch_optional(db).await
}

pub async fn fail_challenge(db: &PgPool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE customer_verification_challenges SET attempt_count=attempt_count+1 WHERE id=$1",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn consume_challenge(db: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE customer_verification_challenges SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL")
        .bind(id).execute(db).await?.rows_affected() == 1)
}

pub async fn recent_challenge_count(
    db: &PgPool,
    target_type: &str,
    target: &str,
    purpose: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM customer_verification_challenges WHERE target_type=$1 AND target=$2 AND purpose=$3 AND created_at>=NOW()-INTERVAL '15 minutes'")
        .bind(target_type).bind(target).bind(purpose).fetch_one(db).await
}

pub async fn account(db: &PgPool, id: &str) -> Result<Option<AccountRecord>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM customer_accounts WHERE id=$1 AND status='active'"
    ))
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn upsert_verified_account(
    db: &PgPool,
    target_type: &str,
    target: &str,
    first_name: &str,
    last_name: &str,
) -> Result<AccountRecord, sqlx::Error> {
    let sql = if target_type == "phone" {
        format!("INSERT INTO customer_accounts (first_name,last_name,phone,normalized_phone,phone_verified_at) VALUES ($1,$2,$3,$3,NOW()) ON CONFLICT (normalized_phone) WHERE normalized_phone<>'' AND status<>'deleted' DO UPDATE SET first_name=CASE WHEN customer_accounts.first_name='' THEN EXCLUDED.first_name ELSE customer_accounts.first_name END,last_name=CASE WHEN customer_accounts.last_name='' THEN EXCLUDED.last_name ELSE customer_accounts.last_name END,phone_verified_at=COALESCE(customer_accounts.phone_verified_at,NOW()),updated_at=NOW() WHERE customer_accounts.status='active' RETURNING {ACCOUNT_COLUMNS}")
    } else {
        format!("INSERT INTO customer_accounts (first_name,last_name,email,email_verified_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (LOWER(email)) WHERE email<>'' AND status<>'deleted' DO UPDATE SET first_name=CASE WHEN customer_accounts.first_name='' THEN EXCLUDED.first_name ELSE customer_accounts.first_name END,last_name=CASE WHEN customer_accounts.last_name='' THEN EXCLUDED.last_name ELSE customer_accounts.last_name END,email_verified_at=COALESCE(customer_accounts.email_verified_at,NOW()),updated_at=NOW() WHERE customer_accounts.status='active' RETURNING {ACCOUNT_COLUMNS}")
    };
    sqlx::query_as(&sql)
        .bind(first_name)
        .bind(last_name)
        .bind(target)
        .fetch_one(db)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert_federated_account(
    db: &PgPool,
    provider: &str,
    provider_subject: &str,
    first_name: &str,
    last_name: &str,
    email: &str,
    email_verified: bool,
    phone: &str,
) -> Result<AccountRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(account_id) = sqlx::query_scalar::<_, String>(
        "SELECT account_id FROM customer_federated_identities
         WHERE provider=$1 AND provider_subject=$2",
    )
    .bind(provider)
    .bind(provider_subject)
    .fetch_optional(&mut *tx)
    .await?
    {
        let account = sqlx::query_as::<_, AccountRecord>(&format!(
            "UPDATE customer_accounts SET
               first_name=CASE WHEN first_name='' THEN $2 ELSE first_name END,
               last_name=CASE WHEN last_name='' THEN $3 ELSE last_name END,
               email=CASE WHEN email='' THEN $4 ELSE email END,
               email_verified_at=CASE WHEN $5 AND email_verified_at IS NULL THEN NOW() ELSE email_verified_at END,
               phone=CASE WHEN phone='' THEN $6 ELSE phone END,
               normalized_phone=CASE WHEN normalized_phone='' THEN $6 ELSE normalized_phone END,
               phone_verified_at=CASE WHEN $6<>'' AND phone_verified_at IS NULL THEN NOW() ELSE phone_verified_at END,
               updated_at=NOW()
             WHERE id=$1 AND status='active' RETURNING {ACCOUNT_COLUMNS}"
        ))
        .bind(account_id)
        .bind(first_name)
        .bind(last_name)
        .bind(email)
        .bind(email_verified)
        .bind(phone)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(account);
    }

    let existing_account_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM customer_accounts
         WHERE status='active' AND (
           ($1<>'' AND normalized_phone=$1) OR ($2<>'' AND LOWER(email)=LOWER($2))
         )
         ORDER BY CASE WHEN $1<>'' AND normalized_phone=$1 THEN 0 ELSE 1 END,created_at
         LIMIT 1 FOR UPDATE",
    )
    .bind(phone)
    .bind(email)
    .fetch_optional(&mut *tx)
    .await?;
    let candidate: AccountRecord = if let Some(account_id) = existing_account_id {
        sqlx::query_as::<_, AccountRecord>(&format!(
            "UPDATE customer_accounts SET
               first_name=CASE WHEN first_name='' THEN $2 ELSE first_name END,
               last_name=CASE WHEN last_name='' THEN $3 ELSE last_name END,
               email=CASE WHEN email='' THEN $4 ELSE email END,
               email_verified_at=CASE WHEN $5 AND email_verified_at IS NULL THEN NOW() ELSE email_verified_at END,
               phone=CASE WHEN phone='' THEN $6 ELSE phone END,
               normalized_phone=CASE WHEN normalized_phone='' THEN $6 ELSE normalized_phone END,
               phone_verified_at=CASE WHEN $6<>'' AND phone_verified_at IS NULL THEN NOW() ELSE phone_verified_at END,
               updated_at=NOW()
             WHERE id=$1 AND status='active' RETURNING {ACCOUNT_COLUMNS}"
        ))
        .bind(account_id)
        .bind(first_name)
        .bind(last_name)
        .bind(email)
        .bind(email_verified)
        .bind(phone)
        .fetch_one(&mut *tx)
        .await?
    } else {
        sqlx::query_as::<_, AccountRecord>(&format!(
            "INSERT INTO customer_accounts (
               first_name,last_name,email,email_verified_at,phone,normalized_phone,phone_verified_at
             ) VALUES ($1,$2,$3,CASE WHEN $4 THEN NOW() ELSE NULL END,$5,$5,CASE WHEN $5<>'' THEN NOW() ELSE NULL END)
             RETURNING {ACCOUNT_COLUMNS}"
        ))
        .bind(first_name)
        .bind(last_name)
        .bind(email)
        .bind(email_verified)
        .bind(phone)
        .fetch_one(&mut *tx)
        .await?
    };
    sqlx::query(
        "INSERT INTO customer_federated_identities (
           provider,provider_subject,account_id,email,phone
         ) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider,provider_subject) DO NOTHING",
    )
    .bind(provider)
    .bind(provider_subject)
    .bind(&candidate.id)
    .bind(email)
    .bind(phone)
    .execute(&mut *tx)
    .await?;
    let linked_account_id: String = sqlx::query_scalar(
        "SELECT account_id FROM customer_federated_identities
         WHERE provider=$1 AND provider_subject=$2",
    )
    .bind(provider)
    .bind(provider_subject)
    .fetch_one(&mut *tx)
    .await?;
    let account = if linked_account_id == candidate.id {
        candidate
    } else {
        sqlx::query_as::<_, AccountRecord>(&format!(
            "SELECT {ACCOUNT_COLUMNS} FROM customer_accounts WHERE id=$1 AND status='active'"
        ))
        .bind(linked_account_id)
        .fetch_one(&mut *tx)
        .await?
    };
    tx.commit().await?;
    Ok(account)
}

pub async fn branch_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE b.active=TRUE AND $1 IN (t.id::TEXT,COALESCE(t.slug,''),t.name) AND $2 IN (b.id::TEXT,COALESCE(b.code,''),b.name))")
        .bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn ensure_client_link(
    db: &PgPool,
    account: &AccountRecord,
    tenant_id: &str,
    branch_id: &str,
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(id) = sqlx::query_scalar::<_, String>("SELECT client_id FROM customer_account_clients WHERE account_id=$1 AND tenant_id=$2 AND branch_id=$3")
        .bind(&account.id).bind(tenant_id).bind(branch_id).fetch_optional(&mut *tx).await? { tx.commit().await?; return Ok(id); }
    let existing = sqlx::query_scalar::<_, String>("SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND merged_into_client_id IS NULL AND (($3<>'' AND normalized_phone=$3) OR ($4<>'' AND LOWER(email)=LOWER($4))) ORDER BY created_at LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(&account.normalized_phone).bind(&account.email).fetch_optional(&mut *tx).await?;
    let client_id = match existing {
        Some(id) => id,
        None => sqlx::query_scalar("INSERT INTO clients (tenant_id,branch_id,first_name,last_name,phone,normalized_phone,email,phone_verified_at,email_verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id")
            .bind(tenant_id).bind(branch_id).bind(&account.first_name).bind(&account.last_name)
            .bind(&account.phone).bind(&account.normalized_phone).bind(&account.email)
            .bind(account.phone_verified_at).bind(account.email_verified_at).fetch_one(&mut *tx).await?,
    };
    sqlx::query("INSERT INTO customer_account_clients (account_id,tenant_id,branch_id,client_id) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id,tenant_id,branch_id) DO NOTHING")
        .bind(&account.id).bind(tenant_id).bind(branch_id).bind(&client_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(client_id)
}

#[allow(clippy::too_many_arguments)]
pub async fn create_session(
    db: &PgPool,
    id: &str,
    account_id: &str,
    refresh_hash: &str,
    device_name: &str,
    device_type: &str,
    user_agent: &str,
    ip_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO customer_sessions (id,account_id,refresh_token_hash,device_name,device_type,user_agent,ip_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(id).bind(account_id).bind(refresh_hash).bind(device_name).bind(device_type)
        .bind(user_agent).bind(ip_hash).bind(expires_at).execute(db).await?;
    Ok(())
}

pub async fn rotate_session(
    db: &PgPool,
    id: &str,
    account_id: &str,
    old_hash: &str,
    new_hash: &str,
    expires_at: DateTime<Utc>,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE customer_sessions SET refresh_token_hash=$4,last_used_at=NOW(),expires_at=$5 WHERE id=$1 AND account_id=$2 AND refresh_token_hash=$3 AND revoked_at IS NULL AND expires_at>NOW()")
        .bind(id).bind(account_id).bind(old_hash).bind(new_hash).bind(expires_at).execute(db).await?.rows_affected()==1)
}

pub async fn revoke_session(
    db: &PgPool,
    account_id: &str,
    session_id: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE customer_sessions SET revoked_at=NOW(),revoke_reason=$3 WHERE account_id=$1 AND id=$2 AND revoked_at IS NULL")
        .bind(account_id).bind(session_id).bind(reason).execute(db).await?.rows_affected()==1)
}

pub async fn revoke_all_sessions(db: &PgPool, account_id: &str) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("UPDATE customer_sessions SET revoked_at=NOW(),revoke_reason='customer_revoked_all' WHERE account_id=$1 AND revoked_at IS NULL")
        .bind(account_id).execute(db).await?.rows_affected())
}

pub async fn soft_delete_account(db: &PgPool, account_id: &str) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let deleted = sqlx::query("UPDATE customer_accounts SET status='deleted',first_name='',last_name='',phone='',normalized_phone='',email='',communication_preferences='{}'::jsonb,updated_at=NOW() WHERE id=$1 AND status='active'")
        .bind(account_id).execute(&mut *tx).await?.rows_affected() == 1;
    if deleted {
        sqlx::query("UPDATE customer_sessions SET revoked_at=NOW(),revoke_reason='account_deleted' WHERE account_id=$1 AND revoked_at IS NULL")
            .bind(account_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(deleted)
}

pub async fn revoke_refresh(db: &PgPool, refresh_hash: &str) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE customer_sessions SET revoked_at=NOW(),revoke_reason='logout' WHERE refresh_token_hash=$1 AND revoked_at IS NULL")
        .bind(refresh_hash).execute(db).await?.rows_affected()==1)
}

pub async fn sessions(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'deviceName',device_name,'deviceType',device_type,'userAgent',user_agent,'lastUsedAt',last_used_at,'expiresAt',expires_at,'revokedAt',revoked_at,'createdAt',created_at) FROM customer_sessions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100")
        .bind(account_id).fetch_all(db).await
}

pub async fn session_is_active(
    db: &PgPool,
    account_id: &str,
    session_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.account_id=$1 AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>NOW() AND a.status='active')")
        .bind(account_id).bind(session_id).fetch_one(db).await
}

pub async fn update_profile(
    db: &PgPool,
    account_id: &str,
    first_name: Option<&str>,
    last_name: Option<&str>,
    preferences: Option<&Value>,
) -> Result<Option<AccountRecord>, sqlx::Error> {
    sqlx::query_as(&format!("UPDATE customer_accounts SET first_name=COALESCE($2,first_name),last_name=COALESCE($3,last_name),communication_preferences=COALESCE($4,communication_preferences),updated_at=NOW() WHERE id=$1 AND status='active' RETURNING {ACCOUNT_COLUMNS}"))
        .bind(account_id).bind(first_name).bind(last_name).bind(preferences).fetch_optional(db).await
}

pub async fn update_verified_target(
    db: &PgPool,
    account_id: &str,
    target_type: &str,
    target: &str,
) -> Result<Option<AccountRecord>, sqlx::Error> {
    let sql = if target_type == "phone" {
        format!("UPDATE customer_accounts SET phone=$2,normalized_phone=$2,phone_verified_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='active' RETURNING {ACCOUNT_COLUMNS}")
    } else {
        format!("UPDATE customer_accounts SET email=$2,email_verified_at=NOW(),updated_at=NOW() WHERE id=$1 AND status='active' RETURNING {ACCOUNT_COLUMNS}")
    };
    let mut tx: Transaction<'_, Postgres> = db.begin().await?;
    let account: Option<AccountRecord> = sqlx::query_as(&sql)
        .bind(account_id)
        .bind(target)
        .fetch_optional(&mut *tx)
        .await?;
    if account.is_some() {
        if target_type == "phone" {
            sqlx::query("UPDATE clients c SET phone=$2,normalized_phone=$2,phone_verified_at=NOW(),updated_at=NOW() FROM customer_account_clients l WHERE l.account_id=$1 AND c.id=l.client_id AND c.tenant_id=l.tenant_id AND c.branch_id=l.branch_id")
                .bind(account_id).bind(target).execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE clients c SET email=$2,email_verified_at=NOW(),updated_at=NOW() FROM customer_account_clients l WHERE l.account_id=$1 AND c.id=l.client_id AND c.tenant_id=l.tenant_id AND c.branch_id=l.branch_id")
                .bind(account_id).bind(target).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(account)
}

pub async fn sync_preferences(
    db: &PgPool,
    account_id: &str,
    preferred: &str,
    whatsapp: bool,
    sms: bool,
    email: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE clients c SET preferred_communication_channel=$2,whatsapp_opt_in=$3,sms_opt_in=$4,email_opt_in=$5,updated_at=NOW() FROM customer_account_clients l WHERE l.account_id=$1 AND c.id=l.client_id AND c.tenant_id=l.tenant_id AND c.branch_id=l.branch_id")
        .bind(account_id).bind(preferred).bind(whatsapp).bind(sms).bind(email).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO client_consent_events (tenant_id,branch_id,client_id,channel,opted_in,source,reason,recorded_by) SELECT l.tenant_id,l.branch_id,l.client_id,v.channel,v.opted_in,'customer_portal','customer preference update',$1 FROM customer_account_clients l CROSS JOIN (VALUES ('whatsapp',$2),('sms',$3),('email',$4)) v(channel,opted_in) WHERE l.account_id=$1")
        .bind(account_id).bind(whatsapp).bind(sms).bind(email).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn businesses(
    db: &PgPool,
    query: &str,
    category: &str,
    limit: i64,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',b.id::TEXT,'branchId',b.id::TEXT,'slug',b.id::TEXT,'tenantId',t.id::TEXT,'tenantSlug',COALESCE(t.slug,t.id::TEXT),'businessName',t.name,'branchName',b.name,'branchCode',COALESCE(b.code,''),'address',COALESCE(b.address,''),'latitude',b.latitude,'longitude',b.longitude,'bookingDepositPercent',b.booking_deposit_percent,'categories',COALESCE(x.categories,'[]'::JSONB),'startingPricePaise',COALESCE(x.starting_price,0),'ratingAverage',0,'ratingCount',0,'isOpen',TRUE,'hasOffer',FALSE) FROM branches b JOIN tenants t ON t.id=b.tenant_id LEFT JOIN LATERAL (SELECT jsonb_agg(DISTINCT s.category) FILTER (WHERE s.category<>'') categories,MIN(s.price_paise) starting_price FROM services s WHERE s.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) AND s.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND s.active=TRUE) x ON TRUE WHERE b.active=TRUE AND t.status='active' AND ($1='' OR LOWER(t.name||' '||b.name||' '||COALESCE(b.code,'')) LIKE '%'||LOWER($1)||'%') AND ($2='' OR EXISTS(SELECT 1 FROM services s WHERE s.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) AND s.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND s.active=TRUE AND LOWER(s.category)=LOWER($2))) ORDER BY t.name,b.name LIMIT $3")
        .bind(query).bind(category).bind(limit).fetch_all(db).await
}

pub async fn categories(db: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',LOWER(REGEXP_REPLACE(category,'[^a-zA-Z0-9]+','-','g')),'label',category) FROM (SELECT DISTINCT category FROM services WHERE active=TRUE AND BTRIM(category)<>'') x ORDER BY category")
        .fetch_all(db).await
}

pub async fn business(db: &PgPool, branch_id: &str) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',b.id::TEXT,'branchId',b.id::TEXT,'slug',b.id::TEXT,'tenantId',t.id::TEXT,'tenantSlug',COALESCE(t.slug,t.id::TEXT),'businessName',t.name,'branchName',b.name,'branchCode',COALESCE(b.code,''),'address',COALESCE(b.address,''),'latitude',b.latitude,'longitude',b.longitude,'bookingDepositPercent',b.booking_deposit_percent,'active',b.active,'ratingAverage',0,'ratingCount',0,'isOpen',TRUE,'hasOffer',FALSE,'startingPricePaise',COALESCE((SELECT MIN(s.price_paise) FROM services s WHERE s.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) AND s.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND s.active=TRUE),0),'categories',COALESCE((SELECT jsonb_agg(DISTINCT s.category) FILTER (WHERE s.category<>'') FROM services s WHERE s.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) AND s.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND s.active=TRUE),'[]'::JSONB)) FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND b.active=TRUE AND t.status='active'")
        .bind(branch_id).fetch_optional(db).await
}

pub async fn business_services(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'businessId',b.id::TEXT,'name',s.name,'description','','category',s.category,'durationMinutes',s.duration_minutes,'pricePaise',s.price_paise,'active',s.active,'addons',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'durationMinutes',a.duration_minutes,'pricePaise',a.price_paise,'active',a.active) ORDER BY a.created_at,a.id) FROM service_addons a WHERE a.tenant_id=s.tenant_id AND a.branch_id=s.branch_id AND a.service_id=s.id AND a.active=TRUE),'[]'::jsonb)) FROM services s JOIN branches b ON s.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) JOIN tenants t ON t.id=b.tenant_id AND s.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND b.active=TRUE AND s.active=TRUE ORDER BY s.category,s.name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn marketplace_offers(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT JSONB_BUILD_OBJECT(
          'id',offer.id,'branchId',branch.id::TEXT,'businessSlug',branch.id::TEXT,
          'businessName',tenant.name,'branchName',branch.name,'code',offer.code,
          'title',COALESCE(NULLIF(offer.title,''),offer.code),
          'customerDescription',offer.customer_description,
          'benefitType',offer.marketing_benefit_type,'benefitValue',offer.benefit_value,
          'targetServiceIds',offer.target_service_ids,
          'applicableServices',COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',service.id,'name',service.name) ORDER BY service.name)
            FROM services service WHERE service.tenant_id=offer.tenant_id AND service.branch_id=offer.branch_id
              AND service.active=TRUE AND service.id=ANY(offer.target_service_ids)),'[]'::JSONB),
          'startsAt',offer.starts_at,'endsAt',offer.ends_at,
          'minimumBillPaise',offer.min_subtotal_paise,'perClientLimit',offer.per_client_limit,
          'hasCreative',EXISTS(SELECT 1 FROM marketing_offer_creatives creative
            WHERE creative.tenant_id=offer.tenant_id AND creative.branch_id=offer.branch_id AND creative.offer_id=offer.id)
        )
        FROM pos_coupons offer
        JOIN branches branch ON offer.branch_id IN (branch.id::TEXT,COALESCE(branch.code,''),branch.name)
        JOIN tenants tenant ON tenant.id=branch.tenant_id AND offer.tenant_id IN (tenant.id::TEXT,COALESCE(tenant.slug,''),tenant.name)
        WHERE branch.active=TRUE AND tenant.status='active'
          AND ($1='' OR $1 IN (branch.id::TEXT,COALESCE(branch.code,''),branch.name))
          AND offer.active=TRUE AND offer.approval_status='approved' AND offer.show_in_customer_app=TRUE
          AND (offer.starts_at IS NULL OR offer.starts_at<=NOW())
          AND (offer.ends_at IS NULL OR offer.ends_at>=NOW())
        ORDER BY COALESCE(offer.ends_at,offer.starts_at,offer.created_at),offer.title,offer.code"#,
    )
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn marketplace_offer_creative(
    db: &PgPool,
    offer_id: &str,
) -> Result<Option<(String, Vec<u8>)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT creative.content_type,creative.content_bytes
        FROM marketing_offer_creatives creative
        JOIN pos_coupons offer ON offer.id=creative.offer_id AND offer.tenant_id=creative.tenant_id AND offer.branch_id=creative.branch_id
        JOIN branches branch ON offer.branch_id IN (branch.id::TEXT,COALESCE(branch.code,''),branch.name)
        JOIN tenants tenant ON tenant.id=branch.tenant_id AND offer.tenant_id IN (tenant.id::TEXT,COALESCE(tenant.slug,''),tenant.name)
        WHERE creative.offer_id=$1 AND branch.active=TRUE AND tenant.status='active'
          AND offer.active=TRUE AND offer.approval_status='approved' AND offer.show_in_customer_app=TRUE
          AND (offer.starts_at IS NULL OR offer.starts_at<=NOW())
          AND (offer.ends_at IS NULL OR offer.ends_at>=NOW())"#,
    )
    .bind(offer_id)
    .fetch_optional(db)
    .await
}

pub async fn business_staff(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'businessId',b.id::TEXT,'name',COALESCE(NULLIF(s.appointment_display_name,''),BTRIM(CONCAT_WS(' ',s.first_name,s.last_name))),'title',s.job_title) FROM staff s JOIN branches b ON s.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) JOIN tenants t ON t.id=b.tenant_id AND s.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND b.active=TRUE AND s.active=TRUE ORDER BY s.appointment_display_name,s.first_name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn business_reviews(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT row_data FROM (SELECT jsonb_build_object('id',r.id,'businessId',r.branch_id,'author',r.platform,'rating',r.rating,'text',r.review_text,'createdAt',COALESCE(r.reviewed_at,r.created_at)) row_data,COALESCE(r.reviewed_at,r.created_at) sort_at FROM client_review_links r JOIN branches b ON b.id::TEXT=r.branch_id AND b.tenant_id::TEXT=r.tenant_id WHERE b.id::TEXT=$1 AND r.rating IS NOT NULL AND r.platform IN ('google','facebook','instagram') AND r.external_review_id<>'' UNION ALL SELECT jsonb_build_object('id',r.id,'businessId',r.branch_id,'author',COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',a.first_name,a.last_name)),''),'Customer'),'rating',r.rating,'text',r.review_text,'createdAt',r.created_at),r.created_at FROM customer_booking_reviews r JOIN customer_accounts a ON a.id=r.account_id WHERE r.branch_id=$1) reviews ORDER BY sort_at DESC LIMIT 100")
        .bind(branch_id).fetch_all(db).await
}

pub async fn account_favorites(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('businessId',f.branch_id,'createdAt',f.created_at,'business',jsonb_build_object('id',b.id::TEXT,'branchId',b.id::TEXT,'slug',b.id::TEXT,'tenantId',t.id::TEXT,'businessName',t.name,'branchName',b.name,'address',COALESCE(b.address,''),'latitude',b.latitude,'longitude',b.longitude,'bookingDepositPercent',b.booking_deposit_percent,'galleryImages','[]'::jsonb,'categories','[]'::jsonb,'services','[]'::jsonb,'staff','[]'::jsonb,'reviews','[]'::jsonb,'ratingAverage',0,'ratingCount',0,'isOpen',TRUE,'hasOffer',FALSE,'startingPricePaise',0)) FROM customer_favorites f JOIN branches b ON b.id::TEXT=f.branch_id AND b.active=TRUE JOIN tenants t ON t.id=b.tenant_id AND t.status='active' WHERE f.account_id=$1 ORDER BY f.created_at DESC")
        .bind(account_id).fetch_all(db).await
}

pub async fn add_account_favorite(
    db: &PgPool,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO customer_favorites (account_id,tenant_id,branch_id) VALUES ($1,$2,$3) ON CONFLICT (account_id,tenant_id,branch_id) DO UPDATE SET created_at=customer_favorites.created_at RETURNING jsonb_build_object('businessId',branch_id,'createdAt',created_at)")
        .bind(account_id).bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn remove_account_favorite(
    db: &PgPool,
    account_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM customer_favorites WHERE account_id=$1 AND branch_id=$2")
            .bind(account_id)
            .bind(branch_id)
            .execute(db)
            .await?
            .rows_affected()
            > 0,
    )
}

pub async fn add_booking_review(
    db: &PgPool,
    account_id: &str,
    appointment_id: &str,
    rating: i32,
    review_text: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO customer_booking_reviews (account_id,tenant_id,branch_id,appointment_id,client_id,rating,review_text) SELECT $1,a.tenant_id,a.branch_id,a.id,a.client_id,$3,$4 FROM appointments a JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id WHERE a.id=$2 AND a.status IN ('completed','billed','paid') ON CONFLICT (account_id,appointment_id) DO UPDATE SET rating=EXCLUDED.rating,review_text=EXCLUDED.review_text,updated_at=NOW() RETURNING jsonb_build_object('id',id,'businessId',branch_id,'author','Customer','rating',rating,'text',review_text,'createdAt',created_at)")
        .bind(account_id).bind(appointment_id).bind(rating).bind(review_text).fetch_one(db).await
}

pub async fn add_booking_waitlist(
    db: &PgPool,
    account_id: &str,
    appointment_id: &str,
    preferred_at: Option<&str>,
    reason: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO appointment_waitlist (id,tenant_id,branch_id,customer_id,service_ids_json,preferred_staff_id,preferred_slot_at,status,notes,customer_account_id,source_appointment_id) SELECT gen_random_uuid()::TEXT,a.tenant_id,a.branch_id,a.client_id,a.service_ids_json,NULLIF(a.staff_id,''),COALESCE(NULLIF($3,'')::TIMESTAMPTZ,a.start_at),'pending',$4,$1,a.id FROM appointments a JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id WHERE a.id=$2 ON CONFLICT (customer_account_id,source_appointment_id) WHERE customer_account_id IS NOT NULL AND source_appointment_id IS NOT NULL AND status IN ('pending','offered') DO UPDATE SET preferred_slot_at=EXCLUDED.preferred_slot_at,preferred_staff_id=EXCLUDED.preferred_staff_id,notes=EXCLUDED.notes,updated_at=NOW() RETURNING jsonb_build_object('id',id,'bookingId',source_appointment_id,'businessId',branch_id,'serviceId',COALESCE((COALESCE(NULLIF(service_ids_json,''),'[]')::jsonb)->>0,''),'preferredDate',preferred_slot_at,'status',status,'recommendations','[]'::jsonb)")
        .bind(account_id).bind(appointment_id).bind(preferred_at.unwrap_or("")).bind(reason).fetch_one(db).await
}

pub async fn business_memberships(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',m.id,'branchId',m.branch_id,'code',m.code,'name',m.name,'description',m.notes,'planType',m.plan_type,'pricePaise',m.price_paise,'discountPercent',m.discount_percent,'productDiscountPercent',COALESCE((m.benefit_rules->>'productDiscountPercent')::INTEGER,0),'validityDays',m.validity_days,'includedServices',m.service_ids_json,'benefitRules',m.benefit_rules) FROM memberships m JOIN branches b ON m.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) JOIN tenants t ON t.id=b.tenant_id AND m.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND b.active=TRUE AND m.active=TRUE ORDER BY m.name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn business_packages(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'branchId',p.branch_id,'name',p.name,'description',p.description,'pricePaise',p.price_paise,'validityDays',p.validity_days,'paidSessions',p.paid_sessions,'freeSessions',p.free_sessions,'serviceRows',p.service_rows_json,'serviceIds',p.service_ids_json) FROM packages p JOIN branches b ON p.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) JOIN tenants t ON t.id=b.tenant_id AND p.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name) AND b.active=TRUE AND p.active=TRUE AND (p.show_mobile_app=TRUE OR p.show_online_booking=TRUE) ORDER BY p.name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn account_bookings(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    account_booking_query(db, account_id, None).await
}

pub async fn account_booking(
    db: &PgPool,
    account_id: &str,
    appointment_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    Ok(account_booking_query(db, account_id, Some(appointment_id))
        .await?
        .into_iter()
        .next())
}

pub async fn account_rewards(db: &PgPool, account_id: &str) -> Result<Value, sqlx::Error> {
    let history: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'points',r.points,'type',r.transaction_type,'description',r.note,'createdAt',r.created_at) FROM membership_reward_ledger r JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=r.tenant_id AND l.branch_id=r.branch_id AND l.client_id=r.client_id ORDER BY r.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await?;
    let loyalty_points: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(x.balance_after),0)::BIGINT FROM (SELECT DISTINCT ON (r.tenant_id,r.branch_id,r.client_id) r.tenant_id,r.branch_id,r.client_id,r.balance_after FROM membership_reward_ledger r JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=r.tenant_id AND l.branch_id=r.branch_id AND l.client_id=r.client_id ORDER BY r.tenant_id,r.branch_id,r.client_id,r.created_at DESC) x")
        .bind(account_id).fetch_one(db).await?;
    let tier = if loyalty_points >= 5000 {
        "Platinum"
    } else if loyalty_points >= 2000 {
        "Gold"
    } else if loyalty_points >= 500 {
        "Silver"
    } else {
        "Bronze"
    };
    Ok(json!({"loyaltyPoints":loyalty_points,"tier":tier,"history":history}))
}

pub async fn account_wallet(db: &PgPool, account_id: &str) -> Result<Value, sqlx::Error> {
    let balance_paise: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(c.wallet_balance_paise),0)::BIGINT FROM clients c JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=c.tenant_id AND l.branch_id=c.branch_id AND l.client_id=c.id")
        .bind(account_id).fetch_one(db).await?;
    let transactions: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',w.id,'type',w.transaction_type,'amountPaise',w.delta_paise,'balanceAfterPaise',w.balance_after_paise,'referenceType',w.reference_type,'referenceId',w.reference_id,'notes',w.notes,'createdAt',w.created_at) FROM wallet_transactions w JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=w.tenant_id AND l.branch_id=w.branch_id AND l.client_id=w.client_id ORDER BY w.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await?;
    Ok(json!({"balancePaise":balance_paise,"transactions":transactions}))
}

pub async fn account_memberships(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',cm.id,'planName',m.name,'pricePaise',m.price_paise,'planCredits',COALESCE(x.total_qty,0),'creditsRemaining',COALESCE(x.remaining_qty,0),'serviceCredits',COALESCE(x.rows,'[]'::jsonb),'validityDate',cm.expires_at,'autoRenew',cm.auto_renew_enabled,'autoRenewStatus',cm.auto_renew_status,'frozenAt',cm.frozen_at,'frozenUntil',cm.frozen_until,'freezeReason',cm.freeze_reason,'loyaltyMultiplier',1,'status',CASE WHEN cm.active=FALSE THEN 'cancelled' WHEN cm.frozen_at IS NOT NULL THEN 'frozen' WHEN cm.expires_at IS NOT NULL AND cm.expires_at<NOW() THEN 'expired' ELSE 'active' END,'redeemHistory','[]'::jsonb,'branchId',cm.branch_id,'createdAt',cm.created_at,'updatedAt',cm.updated_at) FROM client_memberships cm JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=cm.tenant_id AND l.branch_id=cm.branch_id AND l.client_id=cm.client_id JOIN memberships m ON m.id=cm.membership_id LEFT JOIN LATERAL (SELECT SUM(c.total_qty)::BIGINT total_qty,SUM(c.remaining_qty)::BIGINT remaining_qty,jsonb_agg(jsonb_build_object('id',c.id,'serviceId',c.service_id,'serviceName',c.service_name,'totalQty',c.total_qty,'remainingQty',c.remaining_qty,'expiresAt',c.expires_at)) rows FROM client_membership_credits c WHERE c.tenant_id=cm.tenant_id AND c.branch_id=cm.branch_id AND c.client_id=cm.client_id AND c.membership_id=cm.membership_id AND c.active=TRUE) x ON TRUE ORDER BY cm.created_at DESC")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_packages(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',MIN(c.id),'packageId',c.package_id,'name',c.package_name,'pricePaise',0,'creditsRemaining',SUM(c.remaining_qty),'status',CASE WHEN BOOL_OR(c.active) AND SUM(c.remaining_qty)>0 THEN 'active' ELSE 'used' END,'branchId',c.branch_id,'serviceCredits',jsonb_agg(jsonb_build_object('id',c.id,'serviceId',c.service_id,'serviceName',c.service_name,'remainingQty',c.remaining_qty,'totalQty',c.total_qty,'expiresAt',c.expires_at) ORDER BY c.service_name),'createdAt',MIN(c.created_at),'updatedAt',MAX(c.updated_at)) FROM client_package_credits c JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=c.tenant_id AND l.branch_id=c.branch_id AND l.client_id=c.client_id GROUP BY c.tenant_id,c.branch_id,c.client_id,c.package_id,c.package_name ORDER BY MAX(c.created_at) DESC")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_gift_cards(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',g.id,'code',g.code,'initialValuePaise',g.initial_amount_paise,'balancePaise',g.balance_paise,'expiryDate',g.expires_at,'status',g.status,'redeemHistory',COALESCE(x.rows,'[]'::jsonb),'createdAt',g.created_at,'updatedAt',g.updated_at) FROM gift_cards g JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=g.tenant_id AND l.branch_id=g.branch_id AND l.client_id=g.client_id LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',t.id,'type',t.transaction_type,'amountPaise',t.delta_paise,'balanceAfterPaise',t.balance_after_paise,'createdAt',t.created_at) ORDER BY t.created_at DESC) rows FROM gift_card_transactions t WHERE t.gift_card_id=g.id AND t.tenant_id=g.tenant_id AND t.branch_id=g.branch_id) x ON TRUE ORDER BY g.created_at DESC")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_invoices(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'invoiceNumber',s.invoice_number,'saleId',s.id,'branchId',s.branch_id,'status',s.status,'subtotalPaise',s.subtotal_paise,'discountPaise',s.discount_paise,'taxPaise',s.tax_paise,'totalPaise',s.total_paise,'paidPaise',s.paid_paise,'balancePaise',GREATEST(s.total_paise-s.paid_paise,0),'dueDate',s.created_at,'lineItems',COALESCE(x.rows,'[]'::jsonb),'createdAt',s.created_at,'updatedAt',s.updated_at) FROM pos_sales s JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=s.tenant_id AND l.branch_id=s.branch_id AND l.client_id=s.client_id LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',sl.id,'type',sl.line_type,'name',sl.item_name,'quantity',sl.quantity,'unitPricePaise',sl.unit_price_paise,'totalPaise',sl.line_total_paise) ORDER BY sl.created_at) rows FROM pos_sale_lines sl WHERE sl.tenant_id=s.tenant_id AND sl.branch_id=s.branch_id AND sl.sale_id=s.id) x ON TRUE ORDER BY s.created_at DESC LIMIT 500")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_payments(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'invoiceId',s.id,'invoiceNumber',s.invoice_number,'mode',p.method,'amountPaise',p.amount_paise,'reference',p.method_reference,'paidAt',p.paid_at,'createdAt',p.created_at) FROM pos_payments p JOIN pos_sales s ON s.id=p.sale_id AND s.tenant_id=p.tenant_id AND s.branch_id=p.branch_id JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=s.tenant_id AND l.branch_id=s.branch_id AND l.client_id=s.client_id ORDER BY p.paid_at DESC LIMIT 500")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_payment_methods(
    db: &PgPool,
    account_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',i.id,'recordType','paymentMethod','title',TRIM(CONCAT_WS(' ',NULLIF(i.brand,''),CASE WHEN i.last4<>'' THEN '•••• '||i.last4 ELSE i.method_type END)),'branchId',i.branch_id,'clientId',i.client_id,'provider',i.provider,'methodType',i.method_type,'brand',i.brand,'last4',i.last4,'expiryMonth',i.expiry_month,'expiryYear',i.expiry_year,'recurringEnabled',i.recurring_enabled,'status',i.status,'cardGuaranteeEligible',i.status IN ('saved','active') AND i.method_type='card' AND i.last4<>'','consentedAt',i.consented_at,'lastUsedAt',i.last_used_at,'createdAt',i.created_at,'updatedAt',i.updated_at) FROM client_payment_instruments i JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=i.tenant_id AND l.branch_id=i.branch_id AND l.client_id=i.client_id WHERE i.status <> 'revoked' ORDER BY i.last_used_at DESC NULLS LAST,i.created_at DESC LIMIT 100")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_refunds(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'recordType','refund','title','Refund for '||s.invoice_number,'invoiceId',s.id,'invoiceNumber',s.invoice_number,'branchId',r.branch_id,'amountPaise',r.amount_paise,'reason',r.reason,'notes',r.notes,'status',COALESCE(g.status,'recorded'),'provider',COALESCE(g.provider,''),'providerRefundId',CASE WHEN COALESCE(g.provider_refund_id,'')='' THEN '' ELSE 'available' END,'createdAt',r.created_at) FROM pos_invoice_refunds r JOIN pos_sales s ON s.id=r.sale_id AND s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=s.tenant_id AND l.branch_id=s.branch_id AND l.client_id=s.client_id LEFT JOIN LATERAL (SELECT provider,status,provider_refund_id FROM pos_gateway_refunds gr WHERE gr.tenant_id=r.tenant_id AND gr.branch_id=r.branch_id AND gr.refund_id=r.id ORDER BY gr.created_at DESC LIMIT 1) g ON TRUE ORDER BY r.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_notifications(
    db: &PgPool,
    account_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("WITH scoped AS (SELECT DISTINCT n.id,n.notification_type,n.metadata_json,n.body,n.title,n.is_read,n.created_at,COALESCE(NULLIF(n.resource_id,''),n.metadata_json->>'bookingId',n.metadata_json->>'appointmentId','') resource_id FROM notifications n JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=n.tenant_id AND l.branch_id=n.branch_id AND (n.user_id=l.client_id OR n.resource_id=l.client_id OR n.resource_id IN (SELECT a.id FROM appointments a WHERE a.tenant_id=l.tenant_id AND a.branch_id=l.branch_id AND a.client_id=l.client_id))) SELECT jsonb_build_object('id',id,'type',notification_type,'channel',COALESCE(metadata_json->>'channel',''),'message',CASE WHEN body='' THEN title ELSE body END,'status',CASE WHEN is_read THEN 'read' ELSE 'unread' END,'createdAt',created_at,'resourceId',resource_id,'bookingId',CASE WHEN notification_type ILIKE '%booking%' OR notification_type ILIKE '%appointment%' OR COALESCE(metadata_json->>'bookingId',metadata_json->>'appointmentId','')<>'' THEN resource_id ELSE '' END,'deepLink',COALESCE(NULLIF(metadata_json->>'deepLink',''),CASE WHEN notification_type ILIKE '%booking%' OR notification_type ILIKE '%appointment%' OR COALESCE(metadata_json->>'bookingId',metadata_json->>'appointmentId','')<>'' THEN '/bookings/'||resource_id ELSE '' END),'metadata',COALESCE(metadata_json,'{}'::jsonb)) FROM scoped ORDER BY created_at DESC LIMIT 500")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_support_tickets(
    db: &PgPool,
    account_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',t.id,'recordType','supportTicket','branchId',t.branch_id,'bookingId',COALESCE(t.booking_id,''),'subject',t.subject,'category',t.category,'priority',t.priority,'status',t.status,'latestMessage',COALESCE(m.body,''),'createdAt',t.created_at,'updatedAt',t.updated_at) FROM customer_support_tickets t LEFT JOIN LATERAL (SELECT body FROM customer_support_messages WHERE ticket_id=t.id ORDER BY created_at DESC LIMIT 1) m ON TRUE WHERE t.account_id=$1 ORDER BY t.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_support_ticket(
    db: &PgPool,
    account_id: &str,
    context: &CustomerBranchContext,
    subject: &str,
    category: &str,
    priority: &str,
    booking_id: &str,
    body: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let ticket: Value = sqlx::query_scalar("INSERT INTO customer_support_tickets(account_id,tenant_id,branch_id,client_id,booking_id,subject,category,priority) VALUES($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8) RETURNING jsonb_build_object('id',id,'recordType','supportTicket','branchId',branch_id,'bookingId',COALESCE(booking_id,''),'subject',subject,'category',category,'priority',priority,'status',status,'latestMessage',$9,'createdAt',created_at,'updatedAt',updated_at)")
        .bind(account_id).bind(&context.tenant_id).bind(&context.branch_id).bind(&context.client_id)
        .bind(booking_id).bind(subject).bind(category).bind(priority).bind(body)
        .fetch_one(&mut *tx).await?;
    if !body.is_empty() {
        sqlx::query("INSERT INTO customer_support_messages(ticket_id,account_id,tenant_id,branch_id,author_type,body) VALUES($1,$2,$3,$4,'customer',$5)")
            .bind(ticket.get("id").and_then(Value::as_str).unwrap_or(""))
            .bind(account_id).bind(&context.tenant_id).bind(&context.branch_id).bind(body)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(ticket)
}

pub async fn add_support_message(
    db: &PgPool,
    account_id: &str,
    ticket_id: &str,
    body: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let message: Option<Value> = sqlx::query_scalar("WITH scoped AS (SELECT tenant_id,branch_id FROM customer_support_tickets WHERE id=$2 AND account_id=$1 AND status NOT IN ('resolved','closed') FOR UPDATE), inserted AS (INSERT INTO customer_support_messages(ticket_id,account_id,tenant_id,branch_id,author_type,body) SELECT $2,$1,tenant_id,branch_id,'customer',$3 FROM scoped RETURNING id,ticket_id,body,created_at) SELECT jsonb_build_object('id',id,'ticketId',ticket_id,'authorType','customer','body',body,'createdAt',created_at) FROM inserted")
        .bind(account_id).bind(ticket_id).bind(body).fetch_optional(&mut *tx).await?;
    if message.is_some() {
        sqlx::query("UPDATE customer_support_tickets SET status=CASE WHEN status='waiting_customer' THEN 'in_progress' ELSE status END,updated_at=NOW() WHERE id=$1 AND account_id=$2")
            .bind(ticket_id).bind(account_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(message)
}

pub async fn support_messages(
    db: &PgPool,
    account_id: &str,
    ticket_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',m.id,'ticketId',m.ticket_id,'authorType',m.author_type,'body',m.body,'createdAt',m.created_at) FROM customer_support_messages m JOIN customer_support_tickets t ON t.id=m.ticket_id AND t.account_id=$1 WHERE m.ticket_id=$2 ORDER BY m.created_at ASC LIMIT 500")
        .bind(account_id).bind(ticket_id).fetch_all(db).await
}

pub async fn account_referrals(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT row_data FROM (SELECT jsonb_build_object('id','code:'||l.tenant_id||':'||l.branch_id,'recordType','referralCode','branchId',l.branch_id,'clientId',l.client_id,'code',COALESCE(c.code,''),'status',CASE WHEN c.id IS NULL THEN 'not_created' WHEN c.active THEN 'active' ELSE 'inactive' END,'title',COALESCE(c.code,'Referral code not created'),'createdAt',c.created_at) row_data,COALESCE(c.created_at,l.linked_at) sort_at FROM customer_account_clients l LEFT JOIN client_referral_codes c ON c.tenant_id=l.tenant_id AND c.branch_id=l.branch_id AND c.client_id=l.client_id WHERE l.account_id=$1 UNION ALL SELECT jsonb_build_object('id',r.id,'recordType','referral','branchId',r.branch_id,'clientId',r.referrer_client_id,'title',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',b.first_name,b.last_name)),''),r.referred_client_id),'code',c.code,'status',r.status,'createdAt',r.created_at,'completedAt',r.completed_at),r.created_at FROM client_referrals r JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=r.tenant_id AND l.branch_id=r.branch_id AND l.client_id=r.referrer_client_id JOIN clients b ON b.id=r.referred_client_id AND b.tenant_id=r.tenant_id AND b.branch_id=r.branch_id JOIN client_referral_codes c ON c.id=r.referral_code_id) rows ORDER BY sort_at DESC LIMIT 500")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_family(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',link.id,'recordType','family','branchId',link.branch_id,'clientId',link.client_id,'relatedClientId',link.related_client_id,'bookingClientId',related.id,'relationshipType',link.relationship_type,'title',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',related.first_name,related.last_name)),''),related.id),'status','linked','benefitLabel',CASE WHEN shared.active_memberships>0 THEN shared.active_memberships||' shared membership(s)' ELSE 'Family booking enabled' END,'activeMemberships',shared.active_memberships,'openBookings',open_bookings.count,'canBook',TRUE,'createdAt',link.created_at) FROM client_family_links link JOIN customer_account_clients owner ON owner.account_id=$1 AND owner.tenant_id=link.tenant_id AND owner.branch_id=link.branch_id AND owner.client_id IN (link.client_id,link.related_client_id) JOIN clients related ON related.tenant_id=link.tenant_id AND related.branch_id=link.branch_id AND related.id=CASE WHEN owner.client_id=link.client_id THEN link.related_client_id ELSE link.client_id END LEFT JOIN LATERAL (SELECT COUNT(*)::BIGINT active_memberships FROM client_memberships cm WHERE cm.tenant_id=link.tenant_id AND cm.branch_id=link.branch_id AND cm.client_id IN (link.client_id,link.related_client_id) AND cm.active=TRUE AND (cm.expires_at IS NULL OR cm.expires_at>=CURRENT_DATE)) shared ON TRUE LEFT JOIN LATERAL (SELECT COUNT(*)::BIGINT count FROM appointments a WHERE a.tenant_id=link.tenant_id AND a.branch_id=link.branch_id AND a.client_id=related.id AND a.start_at>=NOW() AND a.status NOT IN ('cancelled','completed')) open_bookings ON TRUE ORDER BY link.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await
}

pub async fn create_family_member(
    db: &PgPool,
    account_id: &str,
    context: &CustomerBranchContext,
    first_name: &str,
    last_name: &str,
    phone: &str,
    relationship_type: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let existing = if phone.trim().is_empty() {
        None
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND normalized_phone=$3 AND id<>$4 AND active=TRUE AND merged_into_client_id IS NULL ORDER BY created_at LIMIT 1",
        )
        .bind(&context.tenant_id)
        .bind(&context.branch_id)
        .bind(phone)
        .bind(&context.client_id)
        .fetch_optional(&mut *tx)
        .await?
    };
    let related_client_id = match existing {
        Some(id) => id,
        None => {
            sqlx::query_scalar(
                "INSERT INTO clients (tenant_id,branch_id,first_name,last_name,phone,normalized_phone,email) VALUES ($1,$2,$3,$4,$5,$5,'') RETURNING id",
            )
            .bind(&context.tenant_id)
            .bind(&context.branch_id)
            .bind(first_name)
            .bind(last_name)
            .bind(phone)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    let member: Value = sqlx::query_scalar(
        "WITH linked AS (INSERT INTO client_family_links(tenant_id,branch_id,client_id,related_client_id,relationship_type,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id,tenant_id,branch_id,client_id,related_client_id,relationship_type,created_at), existing AS (SELECT id,tenant_id,branch_id,client_id,related_client_id,relationship_type,created_at FROM linked UNION ALL SELECT id,tenant_id,branch_id,client_id,related_client_id,relationship_type,created_at FROM client_family_links WHERE tenant_id=$1 AND branch_id=$2 AND LEAST(client_id,related_client_id)=LEAST($3,$4) AND GREATEST(client_id,related_client_id)=GREATEST($3,$4) LIMIT 1) SELECT jsonb_build_object('id',existing.id,'recordType','family','branchId',existing.branch_id,'clientId',existing.client_id,'relatedClientId',existing.related_client_id,'bookingClientId',$4,'relationshipType',existing.relationship_type,'title',COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,client.last_name)),''),client.id),'status','linked','benefitLabel','Family booking enabled','activeMemberships',0,'openBookings',0,'canBook',TRUE,'createdAt',existing.created_at) FROM existing JOIN clients client ON client.tenant_id=existing.tenant_id AND client.branch_id=existing.branch_id AND client.id=$4",
    )
    .bind(&context.tenant_id)
    .bind(&context.branch_id)
    .bind(&context.client_id)
    .bind(&related_client_id)
    .bind(relationship_type)
    .bind(account_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(member)
}

pub async fn package_checkout_plan(
    db: &PgPool,
    package_id: &str,
    branch_id: &str,
) -> Result<Option<PackageCheckoutPlan>, sqlx::Error> {
    sqlx::query_as(
        "SELECT p.tenant_id,p.branch_id,p.id,p.name,p.price_paise FROM packages p JOIN branches b ON p.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) JOIN tenants t ON t.id=b.tenant_id AND p.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) WHERE p.id=$1 AND p.active=TRUE AND b.active=TRUE AND (p.show_mobile_app=TRUE OR p.show_online_booking=TRUE) AND ($2='' OR $2 IN (b.id::TEXT,COALESCE(b.code,''),b.name))",
    )
    .bind(package_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn claim_gift_card(
    db: &PgPool,
    context: &CustomerBranchContext,
    code: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("UPDATE gift_cards SET client_id=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND UPPER(code)=UPPER($3) AND status='active' AND client_id IN ('',$4) RETURNING jsonb_build_object('id',id,'code',code,'initialValuePaise',initial_amount_paise,'balancePaise',balance_paise,'expiryDate',expires_at,'status',status,'redeemHistory','[]'::jsonb,'createdAt',created_at,'updatedAt',updated_at)")
        .bind(&context.tenant_id)
        .bind(&context.branch_id)
        .bind(code.trim())
        .bind(&context.client_id)
        .fetch_optional(db)
        .await
}

pub async fn account_corporate(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',member.id,'recordType','corporate','branchId',member.branch_id,'clientId',member.client_id,'title',account.account_name,'accountCode',account.account_code,'employeeCode',member.employee_code,'department',member.department,'spendingLimitPaise',member.spending_limit_paise,'outstandingPaise',COALESCE(credit.outstanding_paise,0),'remainingLimitPaise',GREATEST(member.spending_limit_paise-COALESCE(credit.outstanding_paise,0),0),'benefitLabel',CASE WHEN member.spending_limit_paise>0 THEN 'Limit '||member.spending_limit_paise/100||' INR' ELSE 'Corporate billing enabled' END,'status',member.status,'canBook',member.status='active','createdAt',member.created_at) FROM corporate_account_members member JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=member.tenant_id AND l.branch_id=member.branch_id AND l.client_id=member.client_id JOIN corporate_billing_accounts account ON account.id=member.corporate_account_id AND account.tenant_id=member.tenant_id AND account.branch_id=member.branch_id LEFT JOIN LATERAL (SELECT SUM(outstanding_paise)::BIGINT outstanding_paise FROM corporate_credit_invoices WHERE tenant_id=member.tenant_id AND branch_id=member.branch_id AND corporate_account_id=member.corporate_account_id AND status IN ('open','partially_paid')) credit ON TRUE ORDER BY member.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await
}

pub async fn active_recovery_offers(
    db: &PgPool,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',voucher.id,'code',coupon.code,'status',voucher.status,'expiresAt',voucher.expires_at,'discountType',coupon.discount_type,'discountValuePaise',coupon.discount_value_paise,'discountBps',coupon.discount_bps,'reason','Existing unredeemed customer voucher') FROM birthday_anniversary_vouchers voucher JOIN customer_account_clients link ON link.account_id=$1 AND link.tenant_id=voucher.tenant_id AND link.branch_id=voucher.branch_id AND link.client_id=voucher.client_id JOIN pos_coupons coupon ON coupon.id=voucher.coupon_id AND coupon.tenant_id=voucher.tenant_id AND coupon.branch_id=voucher.branch_id WHERE voucher.tenant_id=$2 AND voucher.branch_id=$3 AND voucher.status IN ('created','sent') AND (voucher.expires_at IS NULL OR voucher.expires_at>NOW()) AND coupon.active=TRUE AND (coupon.starts_at IS NULL OR coupon.starts_at<=NOW()) AND (coupon.ends_at IS NULL OR coupon.ends_at>=NOW()) ORDER BY voucher.issued_at DESC LIMIT 20")
        .bind(account_id).bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn account_recovery_offers(
    db: &PgPool,
    account_id: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',voucher.id,'recordType','recoveryOffer','branchId',voucher.branch_id,'clientId',voucher.client_id,'code',coupon.code,'title','Recovery offer','status',voucher.status,'amountPaise',CASE WHEN coupon.discount_type='amount' THEN coupon.discount_value_paise ELSE coupon.max_discount_paise END,'benefitLabel',CASE WHEN coupon.discount_type='percent' THEN coupon.discount_bps/100||'% off' ELSE 'Discount '||coupon.discount_value_paise/100||' INR' END,'expiresAt',voucher.expires_at,'createdAt',voucher.issued_at) FROM birthday_anniversary_vouchers voucher JOIN customer_account_clients link ON link.account_id=$1 AND link.tenant_id=voucher.tenant_id AND link.branch_id=voucher.branch_id AND link.client_id=voucher.client_id JOIN pos_coupons coupon ON coupon.id=voucher.coupon_id AND coupon.tenant_id=voucher.tenant_id AND coupon.branch_id=voucher.branch_id WHERE voucher.status IN ('created','sent') AND (voucher.expires_at IS NULL OR voucher.expires_at>NOW()) AND coupon.active=TRUE AND (coupon.starts_at IS NULL OR coupon.starts_at<=NOW()) AND (coupon.ends_at IS NULL OR coupon.ends_at>=NOW()) ORDER BY voucher.issued_at DESC LIMIT 50")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_gallery(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',photo.id,'recordType','gallery','branchId',photo.branch_id,'clientId',photo.client_id,'bookingId',COALESCE(photo.appointment_id,''),'title',COALESCE(NULLIF(photo.caption,''),photo.file_name),'photoType',photo.photo_type,'contentType',photo.content_type,'byteSize',photo.byte_size,'status','private','createdAt',photo.created_at) FROM client_treatment_photos photo JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=photo.tenant_id AND l.branch_id=photo.branch_id AND l.client_id=photo.client_id ORDER BY photo.created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await
}

pub async fn account_goals(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'recordType','beautyGoal','branchId',branch_id,'clientId',client_id,'title',title,'goalType',goal_type,'targetDate',target_date,'status',status,'notes',notes,'createdAt',created_at,'updatedAt',updated_at) FROM customer_beauty_goals WHERE account_id=$1 ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,created_at DESC LIMIT 200")
        .bind(account_id).fetch_all(db).await
}

pub async fn create_goal(
    db: &PgPool,
    account_id: &str,
    context: &CustomerBranchContext,
    title: &str,
    goal_type: &str,
    target_date: Option<NaiveDate>,
    notes: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO customer_beauty_goals(account_id,tenant_id,branch_id,client_id,title,goal_type,target_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING jsonb_build_object('id',id,'recordType','beautyGoal','branchId',branch_id,'clientId',client_id,'title',title,'goalType',goal_type,'targetDate',target_date,'status',status,'notes',notes,'createdAt',created_at,'updatedAt',updated_at)")
        .bind(account_id).bind(&context.tenant_id).bind(&context.branch_id).bind(&context.client_id)
        .bind(title).bind(goal_type).bind(target_date).bind(notes).fetch_one(db).await
}

async fn account_booking_query(
    db: &PgPool,
    account_id: &str,
    appointment_id: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
            'id',a.id,'reference',a.id,'tenantId',a.tenant_id,'branchId',a.branch_id,
            'businessId',a.branch_id,'businessName',COALESCE(t.name,b.name,''),'branchName',COALESCE(b.name,''),
            'clientId',a.client_id,'staffId',a.staff_id,
            'staffName',COALESCE(NULLIF(st.appointment_display_name,''),BTRIM(CONCAT_WS(' ',st.first_name,st.last_name)),'Any available professional'),
            'serviceIds',COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb,
            'serviceId',COALESCE((COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb)->>0,''),
            'serviceName',COALESCE((SELECT STRING_AGG(s.name, ', ' ORDER BY s.name) FROM services s WHERE s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id AND s.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb))),'Service'),
            'startAt',a.start_at,'endAt',a.end_at,'startsAt',a.start_at,'endsAt',a.end_at,
            'durationMinutes',GREATEST(1,EXTRACT(EPOCH FROM (a.end_at-a.start_at))::BIGINT/60),
            'address',COALESCE(b.address,''),'latitude',b.latitude,'longitude',b.longitude,
            'status',CASE WHEN a.status='booked' THEN 'confirmed' ELSE a.status END,
            'notes',a.notes,'version',a.version,
            'paymentStatus',CASE WHEN invoice.status='paid' THEN 'paid' WHEN p.status='paid' THEN 'paid' WHEN p.status='refunded' THEN 'refunded' WHEN invoice.id IS NOT NULL AND GREATEST(invoice.total_paise-invoice.paid_paise,0)>0 THEN 'pending' WHEN p.id IS NOT NULL THEN 'pending' WHEN COALESCE(b.booking_deposit_percent,0)>0 THEN 'pending' ELSE 'not_required' END,
            'paymentUrl',COALESCE(p.link_url,''),'depositAmountPaise',COALESCE(p.amount_paise,0),
            'invoiceId',COALESCE(invoice.id,''),'invoiceNumber',COALESCE(invoice.invoice_number,''),
            'invoiceStatus',COALESCE(invoice.status,''),'invoiceTotalPaise',COALESCE(invoice.total_paise,0),
            'invoicePaidPaise',COALESCE(invoice.paid_paise,0),
            'invoiceBalancePaise',COALESCE(GREATEST(invoice.total_paise-invoice.paid_paise,0),0),
            'tipPaise',COALESCE(invoice.tip_paise,0),'receiptAvailable',invoice.id IS NOT NULL,
            'queueStatus',COALESCE(arrival.status,''),'queueEtaMinutes',COALESCE(arrival.eta_minutes,0),
            'queueUpdatedAt',arrival.updated_at,'chatTicketId',COALESCE(chat.id,''),
            'safetyFormSubmittedAt',form.submitted_at,'allergies',COALESCE(clinical.allergies,''),
            'preferences',COALESCE(clinical.preferences,''),
            'rebookFromBookingId',CASE WHEN a.source LIKE 'public-booking:rebook:%' THEN SUBSTRING(a.source FROM 23) ELSE '' END,
            'smartRebookAfter',a.start_at + INTERVAL '42 days',
            'smartRebookReason','Based on this service history; final booking still requires a real available slot and explicit confirmation'
        )
        FROM appointments a
        JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id
        LEFT JOIN tenants t ON t.id::TEXT=a.tenant_id OR t.scope_id=a.tenant_id
        LEFT JOIN branches b ON b.tenant_id=t.id AND (b.id::TEXT=a.branch_id OR b.scope_id=a.branch_id)
        LEFT JOIN staff st ON st.id=a.staff_id AND st.tenant_id=a.tenant_id AND st.branch_id=a.branch_id
        LEFT JOIN LATERAL (SELECT id,status,link_url,amount_paise FROM appointment_payment_links WHERE tenant_id=a.tenant_id AND branch_id=a.branch_id AND appointment_id=a.id ORDER BY created_at DESC LIMIT 1) p ON TRUE
        LEFT JOIN LATERAL (SELECT id,invoice_number,status,total_paise,paid_paise,tip_paise FROM pos_sales WHERE tenant_id=a.tenant_id AND branch_id=a.branch_id AND reference_id=a.id ORDER BY created_at DESC LIMIT 1) invoice ON TRUE
        LEFT JOIN LATERAL (SELECT eta_minutes,status,updated_at FROM appointment_arrival_updates WHERE tenant_id=a.tenant_id AND branch_id=a.branch_id AND appointment_id=a.id ORDER BY updated_at DESC LIMIT 1) arrival ON TRUE
        LEFT JOIN LATERAL (SELECT id FROM customer_support_tickets WHERE account_id=$1 AND tenant_id=a.tenant_id AND branch_id=a.branch_id AND booking_id=a.id AND status NOT IN ('resolved','closed') ORDER BY updated_at DESC LIMIT 1) chat ON TRUE
        LEFT JOIN LATERAL (SELECT submitted_at FROM client_form_submissions WHERE tenant_id=a.tenant_id AND branch_id=a.branch_id AND client_id=a.client_id AND form_key='customer-contactless-consent' ORDER BY submitted_at DESC LIMIT 1) form ON TRUE
        LEFT JOIN client_clinical_profiles clinical ON clinical.tenant_id=a.tenant_id AND clinical.branch_id=a.branch_id AND clinical.client_id=a.client_id
        WHERE ($2::TEXT IS NULL OR a.id=$2)
        ORDER BY a.start_at DESC LIMIT 500",
    )
    .bind(account_id)
    .bind(appointment_id)
    .fetch_all(db)
    .await
}

pub async fn linked_client(
    db: &PgPool,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT link.client_id FROM customer_account_clients link JOIN clients client ON client.id=link.client_id AND client.tenant_id=link.tenant_id AND client.branch_id=link.branch_id WHERE link.account_id=$1 AND link.tenant_id=$2 AND link.branch_id=$3 AND client.merged_into_client_id IS NULL",
    )
    .bind(account_id)
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn owned_booking(
    db: &PgPool,
    account_id: &str,
    appointment_id: &str,
) -> Result<Option<OwnedBooking>, sqlx::Error> {
    sqlx::query_as("SELECT a.tenant_id,a.branch_id,a.client_id FROM appointments a JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id WHERE a.id=$2")
        .bind(account_id).bind(appointment_id).fetch_optional(db).await
}

pub async fn customer_booking_client_id(
    db: &PgPool,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
    requested_client_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    if requested_client_id.trim().is_empty() {
        return linked_client(db, account_id, tenant_id, branch_id).await;
    }
    sqlx::query_scalar("SELECT c.id FROM clients c WHERE c.tenant_id=$2 AND c.branch_id=$3 AND c.id=$4 AND c.merged_into_client_id IS NULL AND (EXISTS (SELECT 1 FROM customer_account_clients l WHERE l.account_id=$1 AND l.tenant_id=c.tenant_id AND l.branch_id=c.branch_id AND l.client_id=c.id) OR EXISTS (SELECT 1 FROM customer_account_clients owner JOIN client_family_links f ON f.tenant_id=owner.tenant_id AND f.branch_id=owner.branch_id AND owner.client_id IN (f.client_id,f.related_client_id) AND c.id IN (f.client_id,f.related_client_id) WHERE owner.account_id=$1 AND owner.tenant_id=c.tenant_id AND owner.branch_id=c.branch_id))")
        .bind(account_id)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(requested_client_id.trim())
        .fetch_optional(db)
        .await
}

pub async fn membership_checkout_plan(
    db: &PgPool,
    plan_id: &str,
    branch_id: &str,
) -> Result<Option<MembershipCheckoutPlan>, sqlx::Error> {
    sqlx::query_as(
        "SELECT m.tenant_id,m.branch_id,m.id,m.name,m.price_paise FROM memberships m JOIN branches b ON m.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name) JOIN tenants t ON t.id=b.tenant_id AND m.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name) WHERE m.id=$1 AND m.active=TRUE AND b.active=TRUE AND ($2='' OR $2 IN (b.id::TEXT,COALESCE(b.code,''),b.name))",
    )
    .bind(plan_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn linked_branch_contexts(
    db: &PgPool,
    account_id: &str,
    branch_id: &str,
) -> Result<Vec<CustomerBranchContext>, sqlx::Error> {
    sqlx::query_as(
        "SELECT l.tenant_id,l.branch_id,l.client_id
           FROM customer_account_clients l
           JOIN branches b
             ON l.branch_id IN (b.id::TEXT, COALESCE(b.code,''), b.name)
            AND b.active=TRUE
           JOIN tenants t
             ON t.id=b.tenant_id
            AND l.tenant_id IN (t.id::TEXT, COALESCE(t.slug,''), t.name)
            AND t.status='active'
           JOIN clients c
             ON c.id=l.client_id
            AND c.tenant_id=l.tenant_id
            AND c.branch_id=l.branch_id
            AND c.merged_into_client_id IS NULL
          WHERE l.account_id=$1
            AND ($2='' OR $2 IN (l.branch_id,b.id::TEXT,COALESCE(b.code,''),b.name))
          ORDER BY
            CASE
              WHEN l.tenant_id=COALESCE(t.slug,'') AND l.branch_id=COALESCE(b.code,'') THEN 0
              WHEN l.branch_id<>b.id::TEXT THEN 1
              ELSE 2
            END,
            l.linked_at
          LIMIT 2",
    )
    .bind(account_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn branch_tenant(db: &PgPool, branch_id: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(t.slug,''),t.id::TEXT)
           FROM branches b
           JOIN tenants t ON t.id=b.tenant_id
          WHERE $1 IN (b.id::TEXT,COALESCE(b.code,''),b.name)
            AND b.active=TRUE
            AND t.status='active'",
    )
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn owned_invoice(
    db: &PgPool,
    account_id: &str,
    invoice_id: &str,
) -> Result<Option<OwnedInvoice>, sqlx::Error> {
    sqlx::query_as(
        "SELECT s.tenant_id,s.branch_id,GREATEST(s.total_paise-s.paid_paise,0)::BIGINT AS balance_paise,s.status FROM pos_sales s JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=s.tenant_id AND l.branch_id=s.branch_id AND l.client_id=s.client_id WHERE s.id=$2",
    )
    .bind(account_id)
    .bind(invoice_id)
    .fetch_optional(db)
    .await
}

pub async fn owned_booking_invoice(
    db: &PgPool,
    account_id: &str,
    appointment_id: &str,
) -> Result<Option<OwnedBookingInvoice>, sqlx::Error> {
    sqlx::query_as(
        "SELECT s.tenant_id,s.branch_id,s.id AS invoice_id,GREATEST(s.total_paise-s.paid_paise,0)::BIGINT AS balance_paise,s.status FROM appointments a JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id JOIN pos_sales s ON s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id AND s.reference_id=a.id WHERE a.id=$2 ORDER BY s.created_at DESC LIMIT 1",
    )
    .bind(account_id)
    .bind(appointment_id)
    .fetch_optional(db)
    .await
}

pub async fn booking_receipt(
    db: &PgPool,
    account_id: &str,
    appointment_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
           'bookingId',a.id,
           'businessName',COALESCE(t.name,b.name,''),
           'serviceName',COALESCE((SELECT STRING_AGG(sv.name, ', ' ORDER BY sv.name) FROM services sv WHERE sv.tenant_id=a.tenant_id AND sv.branch_id=a.branch_id AND sv.id IN (SELECT jsonb_array_elements_text(COALESCE(NULLIF(a.service_ids_json,''),'[]')::jsonb))),'Service'),
           'startAt',a.start_at,
           'invoiceId',s.id,
           'invoiceNumber',s.invoice_number,
           'status',s.status,
           'subtotalPaise',s.subtotal_paise,
           'discountPaise',s.discount_paise,
           'taxPaise',s.tax_paise,
           'tipPaise',s.tip_paise,
           'totalPaise',s.total_paise,
           'paidPaise',s.paid_paise,
           'balancePaise',GREATEST(s.total_paise-s.paid_paise,0),
           'lines',COALESCE(lines.rows,'[]'::jsonb),
           'payments',COALESCE(payments.rows,'[]'::jsonb)
         )
         FROM appointments a
         JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id
         JOIN pos_sales s ON s.tenant_id=a.tenant_id AND s.branch_id=a.branch_id AND s.reference_id=a.id
         LEFT JOIN tenants t ON a.tenant_id IN (t.id::TEXT,COALESCE(t.slug,''),t.name)
         LEFT JOIN branches b ON b.tenant_id=t.id AND a.branch_id IN (b.id::TEXT,COALESCE(b.code,''),b.name)
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('itemName',line.item_name,'quantity',line.quantity,'totalPaise',line.line_total_paise) ORDER BY line.created_at,line.id) rows
           FROM pos_sale_lines line
           WHERE line.tenant_id=s.tenant_id AND line.branch_id=s.branch_id AND line.sale_id=s.id
         ) lines ON TRUE
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('method',COALESCE(NULLIF(payment.label,''),payment.method),'reference',COALESCE(payment.method_reference,''),'amountPaise',payment.amount_paise) ORDER BY payment.created_at,payment.id) rows
           FROM pos_payments payment
           WHERE payment.tenant_id=s.tenant_id AND payment.branch_id=s.branch_id AND payment.sale_id=s.id
         ) payments ON TRUE
         WHERE a.id=$2
         ORDER BY s.created_at DESC
         LIMIT 1",
    )
    .bind(account_id)
    .bind(appointment_id)
    .fetch_optional(db)
    .await
}

pub async fn owned_gift_card(
    db: &PgPool,
    account_id: &str,
    tenant_id: &str,
    branch_id: &str,
    code: &str,
) -> Result<Option<OwnedGiftCard>, sqlx::Error> {
    sqlx::query_as(
        "SELECT g.id,g.balance_paise,g.status FROM gift_cards g JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=g.tenant_id AND l.branch_id=g.branch_id AND l.client_id=g.client_id WHERE g.tenant_id=$2 AND g.branch_id=$3 AND UPPER(g.code)=UPPER($4)",
    )
    .bind(account_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(code.trim())
    .fetch_optional(db)
    .await
}

pub async fn owned_membership(
    db: &PgPool,
    account_id: &str,
    membership_id: &str,
) -> Result<Option<OwnedMembership>, sqlx::Error> {
    sqlx::query_as("SELECT cm.tenant_id,cm.branch_id FROM client_memberships cm JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=cm.tenant_id AND l.branch_id=cm.branch_id AND l.client_id=cm.client_id WHERE cm.id=$2")
        .bind(account_id)
        .bind(membership_id)
        .fetch_optional(db)
        .await
}
