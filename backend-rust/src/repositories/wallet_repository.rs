use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WalletTransactionRecord {
    pub id: String,
    pub client_id: String,
    pub transaction_type: String,
    pub delta_paise: i64,
    pub balance_after_paise: i64,
    pub reference_type: String,
    pub reference_id: String,
    pub idempotency_key: String,
    pub notes: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StoreCreditRecord {
    pub id: String,
    pub client_id: String,
    pub source_type: String,
    pub source_id: String,
    pub initial_amount_paise: i64,
    pub balance_paise: i64,
    pub expires_at: Option<NaiveDate>,
    pub reason: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub enum WalletWriteResult {
    Saved(WalletTransactionRecord),
    MissingClient,
    InsufficientBalance,
}

pub enum StoreCreditWriteResult {
    Saved(StoreCreditRecord),
    MissingClient,
    MissingCredit,
    InactiveCredit,
    ExpiredCredit,
    InsufficientBalance,
}

pub struct WalletWrite<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub client_id: &'a str,
    pub transaction_type: &'a str,
    pub delta_paise: i64,
    pub reference_type: &'a str,
    pub reference_id: &'a str,
    pub idempotency_key: &'a str,
    pub notes: &'a str,
}

pub struct StoreCreditIssue<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub client_id: &'a str,
    pub amount_paise: i64,
    pub source_type: &'a str,
    pub source_id: &'a str,
    pub expires_at: Option<NaiveDate>,
    pub reason: &'a str,
    pub idempotency_key: &'a str,
}

pub struct StoreCreditRedemption<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub client_id: &'a str,
    pub credit_id: &'a str,
    pub amount_paise: i64,
    pub reference_type: &'a str,
    pub reference_id: &'a str,
    pub idempotency_key: &'a str,
    pub notes: &'a str,
}

pub async fn wallet_balance(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(delta_paise), 0)::BIGINT FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .fetch_one(db)
    .await
}

pub async fn list_wallet_transactions(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    limit: i64,
) -> Result<Vec<WalletTransactionRecord>, sqlx::Error> {
    sqlx::query_as::<_, WalletTransactionRecord>(
        "SELECT id, client_id, transaction_type, delta_paise, balance_after_paise, reference_type, reference_id, idempotency_key, notes, created_at FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC, id DESC LIMIT $4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(client_id)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn write_wallet_transaction(
    db: &PgPool,
    input: WalletWrite<'_>,
) -> Result<WalletWriteResult, sqlx::Error> {
    let mut tx = db.begin().await?;
    let result = write_wallet_transaction_in_tx(&mut tx, input).await?;
    match result {
        WalletWriteResult::Saved(_) => tx.commit().await?,
        _ => tx.rollback().await?,
    }
    Ok(result)
}

pub async fn write_wallet_transaction_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    input: WalletWrite<'_>,
) -> Result<WalletWriteResult, sqlx::Error> {
    let client = sqlx::query_scalar::<_, String>(
        "SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.client_id)
    .fetch_optional(&mut **tx)
    .await?;
    if client.is_none() {
        return Ok(WalletWriteResult::MissingClient);
    }

    if !input.idempotency_key.is_empty() {
        if let Some(existing) = sqlx::query_as::<_, WalletTransactionRecord>(
            "SELECT id, client_id, transaction_type, delta_paise, balance_after_paise, reference_type, reference_id, idempotency_key, notes, created_at FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND idempotency_key=$4",
        ).bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(input.idempotency_key).fetch_optional(&mut **tx).await? {
            return Ok(WalletWriteResult::Saved(existing));
        }
    }

    let balance: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(delta_paise), 0)::BIGINT FROM wallet_transactions WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3")
        .bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).fetch_one(&mut **tx).await?;
    let next = balance + input.delta_paise;
    if next < 0 {
        return Ok(WalletWriteResult::InsufficientBalance);
    }

    let record = sqlx::query_as::<_, WalletTransactionRecord>(
        "INSERT INTO wallet_transactions (tenant_id, branch_id, client_id, transaction_type, delta_paise, balance_after_paise, reference_type, reference_id, idempotency_key, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, client_id, transaction_type, delta_paise, balance_after_paise, reference_type, reference_id, idempotency_key, notes, created_at",
    ).bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(input.transaction_type).bind(input.delta_paise).bind(next).bind(input.reference_type).bind(input.reference_id).bind(input.idempotency_key).bind(input.notes).fetch_one(&mut **tx).await?;
    sqlx::query("UPDATE clients SET wallet_balance_paise=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(next).execute(&mut **tx).await?;
    Ok(WalletWriteResult::Saved(record))
}

pub async fn list_store_credits(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<StoreCreditRecord>, sqlx::Error> {
    sqlx::query_as::<_, StoreCreditRecord>(
        "SELECT id, client_id, source_type, source_id, initial_amount_paise, balance_paise, expires_at, reason, status, created_at, updated_at FROM store_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 ORDER BY created_at DESC",
    ).bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn issue_store_credit(
    db: &PgPool,
    input: StoreCreditIssue<'_>,
) -> Result<StoreCreditWriteResult, sqlx::Error> {
    let mut tx = db.begin().await?;
    let client = sqlx::query_scalar::<_, String>(
        "SELECT id FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.client_id)
    .fetch_optional(&mut *tx)
    .await?;
    if client.is_none() {
        tx.rollback().await?;
        return Ok(StoreCreditWriteResult::MissingClient);
    }
    if !input.idempotency_key.is_empty() {
        if let Some(existing) = find_credit_by_key(&mut tx, &input).await? {
            tx.rollback().await?;
            return Ok(StoreCreditWriteResult::Saved(existing));
        }
    }
    let credit = sqlx::query_as::<_, StoreCreditRecord>(
        "INSERT INTO store_credits (tenant_id, branch_id, client_id, source_type, source_id, initial_amount_paise, balance_paise, expires_at, reason, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) RETURNING id, client_id, source_type, source_id, initial_amount_paise, balance_paise, expires_at, reason, status, created_at, updated_at",
    ).bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(input.source_type).bind(input.source_id).bind(input.amount_paise).bind(input.expires_at).bind(input.reason).bind(input.idempotency_key).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO store_credit_transactions (tenant_id, branch_id, store_credit_id, client_id, transaction_type, delta_paise, balance_after_paise, reference_type, reference_id, idempotency_key, notes) VALUES ($1,$2,$3,$4,'issue',$5,$5,$6,$7,$8,$9)")
        .bind(input.tenant_id).bind(input.branch_id).bind(&credit.id).bind(input.client_id).bind(input.amount_paise).bind(input.source_type).bind(input.source_id).bind(input.idempotency_key).bind(input.reason).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(StoreCreditWriteResult::Saved(credit))
}

pub async fn redeem_store_credit(
    db: &PgPool,
    input: StoreCreditRedemption<'_>,
) -> Result<StoreCreditWriteResult, sqlx::Error> {
    let mut tx = db.begin().await?;
    let result = redeem_store_credit_in_tx(&mut tx, input).await?;
    match result {
        StoreCreditWriteResult::Saved(_) => tx.commit().await?,
        _ => tx.rollback().await?,
    }
    Ok(result)
}

pub async fn redeem_store_credit_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    input: StoreCreditRedemption<'_>,
) -> Result<StoreCreditWriteResult, sqlx::Error> {
    let credit = sqlx::query_as::<_, StoreCreditRecord>(
        "SELECT id, client_id, source_type, source_id, initial_amount_paise, balance_paise, expires_at, reason, status, created_at, updated_at FROM store_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4 FOR UPDATE",
    ).bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(input.credit_id).fetch_optional(&mut **tx).await?;
    let Some(credit) = credit else {
        return Ok(StoreCreditWriteResult::MissingCredit);
    };
    if credit.status != "active" {
        return Ok(StoreCreditWriteResult::InactiveCredit);
    }
    if credit
        .expires_at
        .is_some_and(|date| date < Utc::now().date_naive())
    {
        return Ok(StoreCreditWriteResult::ExpiredCredit);
    }
    if !input.idempotency_key.is_empty() {
        let exists = sqlx::query_scalar::<_, String>("SELECT id FROM store_credit_transactions WHERE tenant_id=$1 AND branch_id=$2 AND store_credit_id=$3 AND idempotency_key=$4")
            .bind(input.tenant_id).bind(input.branch_id).bind(input.credit_id).bind(input.idempotency_key).fetch_optional(&mut **tx).await?;
        if exists.is_some() {
            return Ok(StoreCreditWriteResult::Saved(credit));
        }
    }
    let balance: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(delta_paise), 0)::BIGINT FROM store_credit_transactions WHERE tenant_id=$1 AND branch_id=$2 AND store_credit_id=$3")
        .bind(input.tenant_id).bind(input.branch_id).bind(input.credit_id).fetch_one(&mut **tx).await?;
    if input.amount_paise > balance {
        return Ok(StoreCreditWriteResult::InsufficientBalance);
    }
    let next = balance - input.amount_paise;
    let status = if next == 0 { "redeemed" } else { "active" };
    let credit = sqlx::query_as::<_, StoreCreditRecord>(
        "UPDATE store_credits SET balance_paise=$5, status=$6, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND id=$4 RETURNING id, client_id, source_type, source_id, initial_amount_paise, balance_paise, expires_at, reason, status, created_at, updated_at",
    ).bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(input.credit_id).bind(next).bind(status).fetch_one(&mut **tx).await?;
    sqlx::query("INSERT INTO store_credit_transactions (tenant_id, branch_id, store_credit_id, client_id, transaction_type, delta_paise, balance_after_paise, reference_type, reference_id, idempotency_key, notes) VALUES ($1,$2,$3,$4,'redeem',$5,$6,$7,$8,$9,$10)")
        .bind(input.tenant_id).bind(input.branch_id).bind(input.credit_id).bind(input.client_id).bind(-input.amount_paise).bind(next).bind(input.reference_type).bind(input.reference_id).bind(input.idempotency_key).bind(input.notes).execute(&mut **tx).await?;
    Ok(StoreCreditWriteResult::Saved(credit))
}

async fn find_credit_by_key(
    tx: &mut Transaction<'_, Postgres>,
    input: &StoreCreditIssue<'_>,
) -> Result<Option<StoreCreditRecord>, sqlx::Error> {
    sqlx::query_as::<_, StoreCreditRecord>(
        "SELECT id, client_id, source_type, source_id, initial_amount_paise, balance_paise, expires_at, reason, status, created_at, updated_at FROM store_credits WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND idempotency_key=$4",
    ).bind(input.tenant_id).bind(input.branch_id).bind(input.client_id).bind(input.idempotency_key).fetch_optional(&mut **tx).await
}
