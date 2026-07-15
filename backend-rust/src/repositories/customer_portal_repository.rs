use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
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

pub async fn branch_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM branches WHERE tenant_id::TEXT=$1 AND id::TEXT=$2 AND active=TRUE)")
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
    sqlx::query_scalar("SELECT jsonb_build_object('id',b.id::TEXT,'tenantId',t.id::TEXT,'tenantSlug',COALESCE(t.slug,t.id::TEXT),'businessName',t.name,'branchName',b.name,'branchCode',COALESCE(b.code,''),'categories',COALESCE(x.categories,'[]'::JSONB),'startingPricePaise',COALESCE(x.starting_price,0)) FROM branches b JOIN tenants t ON t.id=b.tenant_id LEFT JOIN LATERAL (SELECT jsonb_agg(DISTINCT s.category) FILTER (WHERE s.category<>'') categories,MIN(s.price_paise) starting_price FROM services s WHERE s.tenant_id=t.id::TEXT AND s.branch_id=b.id::TEXT AND s.active=TRUE) x ON TRUE WHERE b.active=TRUE AND t.status='active' AND ($1='' OR LOWER(t.name||' '||b.name||' '||COALESCE(b.code,'')) LIKE '%'||LOWER($1)||'%') AND ($2='' OR EXISTS(SELECT 1 FROM services s WHERE s.tenant_id=t.id::TEXT AND s.branch_id=b.id::TEXT AND s.active=TRUE AND LOWER(s.category)=LOWER($2))) ORDER BY t.name,b.name LIMIT $3")
        .bind(query).bind(category).bind(limit).fetch_all(db).await
}

pub async fn categories(db: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',LOWER(REGEXP_REPLACE(category,'[^a-zA-Z0-9]+','-','g')),'label',category) FROM (SELECT DISTINCT category FROM services WHERE active=TRUE AND BTRIM(category)<>'') x ORDER BY category")
        .fetch_all(db).await
}

pub async fn business(db: &PgPool, branch_id: &str) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',b.id::TEXT,'tenantId',t.id::TEXT,'tenantSlug',COALESCE(t.slug,t.id::TEXT),'businessName',t.name,'branchName',b.name,'branchCode',COALESCE(b.code,''),'active',b.active) FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE b.id::TEXT=$1 AND b.active=TRUE AND t.status='active'")
        .bind(branch_id).fetch_optional(db).await
}

pub async fn business_services(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'durationMinutes',s.duration_minutes,'pricePaise',s.price_paise) FROM services s JOIN branches b ON b.id::TEXT=s.branch_id AND b.tenant_id::TEXT=s.tenant_id WHERE b.id::TEXT=$1 AND b.active=TRUE AND s.active=TRUE ORDER BY s.category,s.name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn business_staff(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'name',COALESCE(NULLIF(s.appointment_display_name,''),BTRIM(CONCAT_WS(' ',s.first_name,s.last_name))),'jobTitle',s.job_title) FROM staff s JOIN branches b ON b.id::TEXT=s.branch_id AND b.tenant_id::TEXT=s.tenant_id WHERE b.id::TEXT=$1 AND b.active=TRUE AND s.active=TRUE ORDER BY s.appointment_display_name,s.first_name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn business_reviews(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'platform',r.platform,'rating',r.rating,'text',r.review_text,'reviewedAt',r.reviewed_at) FROM client_review_links r JOIN branches b ON b.id::TEXT=r.branch_id AND b.tenant_id::TEXT=r.tenant_id WHERE b.id::TEXT=$1 AND r.rating IS NOT NULL AND r.platform IN ('google','facebook','instagram') AND r.external_review_id<>'' ORDER BY COALESCE(r.reviewed_at,r.created_at) DESC LIMIT 100")
        .bind(branch_id).fetch_all(db).await
}

pub async fn business_memberships(db: &PgPool, branch_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',m.id,'code',m.code,'name',m.name,'planType',m.plan_type,'pricePaise',m.price_paise,'discountPercent',m.discount_percent,'validityDays',m.validity_days,'benefitRules',m.benefit_rules) FROM memberships m JOIN branches b ON b.id::TEXT=m.branch_id AND b.tenant_id::TEXT=m.tenant_id WHERE b.id::TEXT=$1 AND b.active=TRUE AND m.active=TRUE ORDER BY m.name")
        .bind(branch_id).fetch_all(db).await
}

pub async fn account_bookings(db: &PgPool, account_id: &str) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'tenantId',a.tenant_id,'branchId',a.branch_id,'branchName',b.name,'clientId',a.client_id,'staffId',a.staff_id,'serviceIds',a.service_ids_json,'startAt',a.start_at,'endAt',a.end_at,'status',a.status,'notes',a.notes,'version',a.version) FROM appointments a JOIN customer_account_clients l ON l.account_id=$1 AND l.tenant_id=a.tenant_id AND l.branch_id=a.branch_id AND l.client_id=a.client_id LEFT JOIN branches b ON b.id::TEXT=a.branch_id ORDER BY a.start_at DESC LIMIT 500")
        .bind(account_id).fetch_all(db).await
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
