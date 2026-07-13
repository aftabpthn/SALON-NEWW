use chrono::NaiveDate;
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    models::common::AppError,
    repositories::wallet_repository::{
        self, StoreCreditIssue, StoreCreditRedemption, StoreCreditWriteResult, WalletWrite,
        WalletWriteResult,
    },
};

pub async fn wallet_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<(i64, Vec<wallet_repository::WalletTransactionRecord>), AppError> {
    let balance = wallet_repository::wallet_balance(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load wallet balance"))?;
    let transactions =
        wallet_repository::list_wallet_transactions(db, tenant_id, branch_id, client_id, 100)
            .await
            .map_err(|_| AppError::internal("failed to load wallet transactions"))?;
    Ok((balance, transactions))
}

pub async fn post_wallet_transaction(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    transaction_type: &str,
    amount_paise: i64,
    reference_type: &str,
    reference_id: &str,
    idempotency_key: &str,
    notes: &str,
) -> Result<wallet_repository::WalletTransactionRecord, AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    let transaction_type = transaction_type.trim().to_ascii_lowercase();
    if idempotency_key.trim().is_empty() {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    let delta_paise = match transaction_type.as_str() {
        "recharge" | "refund" | "adjustment_credit" => amount_paise,
        "use" | "adjustment_debit" => -amount_paise,
        _ => return Err(AppError::validation("invalid wallet transactionType")),
    };
    if matches!(transaction_type.as_str(), "use" | "refund")
        && (reference_type.trim().is_empty() || reference_id.trim().is_empty())
    {
        return Err(AppError::validation(
            "referenceType and referenceId are required",
        ));
    }
    match wallet_repository::write_wallet_transaction(
        db,
        WalletWrite {
            tenant_id,
            branch_id,
            client_id,
            transaction_type: &transaction_type,
            delta_paise,
            reference_type: reference_type.trim(),
            reference_id: reference_id.trim(),
            idempotency_key: idempotency_key.trim(),
            notes: notes.trim(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to post wallet transaction"))?
    {
        WalletWriteResult::Saved(record) => Ok(record),
        WalletWriteResult::MissingClient => Err(AppError::not_found("client was not found")),
        WalletWriteResult::InsufficientBalance => {
            Err(AppError::conflict("wallet balance cannot go negative"))
        }
    }
}

pub async fn list_store_credits(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<wallet_repository::StoreCreditRecord>, AppError> {
    wallet_repository::list_store_credits(db, tenant_id, branch_id, client_id)
        .await
        .map_err(|_| AppError::internal("failed to load store credits"))
}

pub async fn issue_store_credit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    amount_paise: i64,
    source_type: &str,
    source_id: &str,
    expires_at: Option<NaiveDate>,
    reason: &str,
    idempotency_key: &str,
) -> Result<wallet_repository::StoreCreditRecord, AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    if source_type.trim().is_empty() || source_id.trim().is_empty() {
        return Err(AppError::validation("sourceType and sourceId are required"));
    }
    if idempotency_key.trim().is_empty() {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    map_credit_result(
        wallet_repository::issue_store_credit(
            db,
            StoreCreditIssue {
                tenant_id,
                branch_id,
                client_id,
                amount_paise,
                source_type: source_type.trim(),
                source_id: source_id.trim(),
                expires_at,
                reason: reason.trim(),
                idempotency_key: idempotency_key.trim(),
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to issue store credit"))?,
    )
}

pub async fn redeem_store_credit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    credit_id: &str,
    amount_paise: i64,
    reference_type: &str,
    reference_id: &str,
    idempotency_key: &str,
    notes: &str,
) -> Result<wallet_repository::StoreCreditRecord, AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation(
            "amountPaise must be greater than zero",
        ));
    }
    if reference_type.trim().is_empty() || reference_id.trim().is_empty() {
        return Err(AppError::validation(
            "referenceType and referenceId are required",
        ));
    }
    if idempotency_key.trim().is_empty() {
        return Err(AppError::validation("idempotencyKey is required"));
    }
    map_credit_result(
        wallet_repository::redeem_store_credit(
            db,
            StoreCreditRedemption {
                tenant_id,
                branch_id,
                client_id,
                credit_id: credit_id.trim(),
                amount_paise,
                reference_type: reference_type.trim(),
                reference_id: reference_id.trim(),
                idempotency_key: idempotency_key.trim(),
                notes: notes.trim(),
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to redeem store credit"))?,
    )
}

pub async fn settle_pos_internal_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    payment_id: &str,
    method: &str,
    method_reference: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    let idempotency_key = format!("pos-payment:{payment_id}");
    match method {
        "wallet" => match wallet_repository::write_wallet_transaction_in_tx(
            tx,
            WalletWrite {
                tenant_id,
                branch_id,
                client_id,
                transaction_type: "use",
                delta_paise: -amount_paise,
                reference_type: "pos_sale",
                reference_id: sale_id,
                idempotency_key: &idempotency_key,
                notes: "POS wallet payment",
            },
        )
        .await
        .map_err(|_| AppError::internal("failed to settle wallet payment"))?
        {
            WalletWriteResult::Saved(_) => Ok(()),
            WalletWriteResult::MissingClient => Err(AppError::not_found("client was not found")),
            WalletWriteResult::InsufficientBalance => Err(AppError::conflict(
                "wallet balance cannot cover this payment",
            )),
        },
        "store_credit" => {
            if method_reference.trim().is_empty() {
                return Err(AppError::validation(
                    "store credit payment requires a credit reference",
                ));
            }
            map_credit_result(
                wallet_repository::redeem_store_credit_in_tx(
                    tx,
                    StoreCreditRedemption {
                        tenant_id,
                        branch_id,
                        client_id,
                        credit_id: method_reference,
                        amount_paise,
                        reference_type: "pos_sale",
                        reference_id: sale_id,
                        idempotency_key: &idempotency_key,
                        notes: "POS store credit payment",
                    },
                )
                .await
                .map_err(|_| AppError::internal("failed to settle store credit payment"))?,
            )
            .map(|_| ())
        }
        "gift_card" => {
            if method_reference.trim().is_empty() {
                return Err(AppError::validation(
                    "gift card payment requires a card code/reference",
                ));
            }
            settle_gift_card_payment(
                tx,
                tenant_id,
                branch_id,
                sale_id,
                method_reference,
                amount_paise,
                &idempotency_key,
            )
            .await
        }
        _ => Ok(()),
    }
}

async fn settle_gift_card_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    code: &str,
    amount_paise: i64,
    idempotency_key: &str,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation(
            "gift card amount must be greater than zero",
        ));
    }
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM gift_card_transactions WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3",
    )
    .bind(tenant_id).bind(branch_id).bind(idempotency_key)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to read gift card idempotency key"))?;
    if existing.is_some() {
        return Ok(());
    }

    let card = sqlx::query_as::<_, (String, i64, String, Option<NaiveDate>)>(
        "SELECT id, balance_paise, status, expires_at FROM gift_cards WHERE tenant_id=$1 AND branch_id=$2 AND code=$3 FOR UPDATE",
    )
    .bind(tenant_id).bind(branch_id).bind(code.trim())
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to load gift card"))?
    .ok_or_else(|| AppError::not_found("gift card was not found"))?;
    if card.2 != "active" {
        return Err(AppError::conflict("gift card is not active"));
    }
    if card
        .3
        .is_some_and(|date| date < chrono::Utc::now().date_naive())
    {
        return Err(AppError::conflict("gift card is expired"));
    }
    if card.1 < amount_paise {
        return Err(AppError::conflict(
            "gift card balance cannot cover this payment",
        ));
    }

    let balance = card.1 - amount_paise;
    let status = if balance == 0 { "redeemed" } else { "active" };
    sqlx::query("UPDATE gift_cards SET balance_paise=$4, status=$5, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(&card.0).bind(balance).bind(status)
        .execute(&mut **tx).await
        .map_err(|_| AppError::internal("failed to update gift card balance"))?;
    sqlx::query("INSERT INTO gift_card_transactions (tenant_id, branch_id, gift_card_id, sale_id, transaction_type, delta_paise, balance_after_paise, idempotency_key, notes) VALUES ($1,$2,$3,$4,'redeem',$5,$6,$7,'POS gift card payment')")
        .bind(tenant_id).bind(branch_id).bind(&card.0).bind(sale_id).bind(-amount_paise).bind(balance).bind(idempotency_key)
        .execute(&mut **tx).await
        .map_err(|_| AppError::internal("failed to save gift card redemption"))?;
    Ok(())
}

fn map_credit_result(
    result: StoreCreditWriteResult,
) -> Result<wallet_repository::StoreCreditRecord, AppError> {
    match result {
        StoreCreditWriteResult::Saved(record) => Ok(record),
        StoreCreditWriteResult::MissingClient | StoreCreditWriteResult::MissingCredit => {
            Err(AppError::not_found("store credit was not found"))
        }
        StoreCreditWriteResult::InactiveCredit => {
            Err(AppError::conflict("store credit is not active"))
        }
        StoreCreditWriteResult::ExpiredCredit => Err(AppError::conflict("store credit is expired")),
        StoreCreditWriteResult::InsufficientBalance => Err(AppError::conflict(
            "store credit balance cannot go negative",
        )),
    }
}
