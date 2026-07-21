use chrono::NaiveDate;
use sqlx::{PgPool, Postgres, Transaction};

use crate::{
    models::common::AppError,
    repositories::wallet_repository::{
        self, StoreCreditIssue, StoreCreditRedemption, StoreCreditWriteResult, WalletWrite,
        WalletWriteResult,
    },
    services::accounting_service,
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
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start wallet transaction"))?;
    match wallet_repository::write_wallet_transaction_in_tx(
        &mut tx,
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
        WalletWriteResult::Saved(record) => {
            let offset_account = match transaction_type.as_str() {
                "recharge" => "BANK_CLEARING",
                "refund" => "REFUND_CLEARING",
                "use" => "ACCOUNTS_RECEIVABLE",
                _ => "OPERATING_EXPENSE",
            };
            accounting_service::post_customer_credit_change(
                &mut tx,
                tenant_id,
                branch_id,
                "wallet_transaction",
                &record.id,
                "Customer wallet change",
                record.delta_paise,
                offset_account,
            )
            .await?;
            tx.commit()
                .await
                .map_err(|_| AppError::internal("failed to commit wallet transaction"))?;
            Ok(record)
        }
        WalletWriteResult::MissingClient => {
            tx.rollback()
                .await
                .map_err(|_| AppError::internal("failed to finish wallet transaction"))?;
            Err(AppError::not_found("client was not found"))
        }
        WalletWriteResult::InsufficientBalance => {
            tx.rollback()
                .await
                .map_err(|_| AppError::internal("failed to finish wallet transaction"))?;
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
    let source_type = source_type.trim();
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start store credit issue"))?;
    let result = wallet_repository::issue_store_credit_in_tx(
        &mut tx,
        StoreCreditIssue {
            tenant_id,
            branch_id,
            client_id,
            amount_paise,
            source_type,
            source_id: source_id.trim(),
            expires_at,
            reason: reason.trim(),
            idempotency_key: idempotency_key.trim(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to issue store credit"))?;
    match result {
        StoreCreditWriteResult::Saved(credit) => {
            let offset_account = if source_type.eq_ignore_ascii_case("refund")
                || source_type.eq_ignore_ascii_case("credit_note")
            {
                "REFUND_CLEARING"
            } else {
                "OPERATING_EXPENSE"
            };
            accounting_service::post_customer_credit_change(
                &mut tx,
                tenant_id,
                branch_id,
                "store_credit_issue",
                &credit.id,
                "Store credit issued",
                credit.initial_amount_paise,
                offset_account,
            )
            .await?;
            tx.commit()
                .await
                .map_err(|_| AppError::internal("failed to commit store credit issue"))?;
            Ok(credit)
        }
        other => {
            tx.rollback()
                .await
                .map_err(|_| AppError::internal("failed to finish store credit issue"))?;
            map_credit_result(other)
        }
    }
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
    let idempotency_key = idempotency_key.trim();
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start store credit redemption"))?;
    let result = wallet_repository::redeem_store_credit_in_tx(
        &mut tx,
        StoreCreditRedemption {
            tenant_id,
            branch_id,
            client_id,
            credit_id: credit_id.trim(),
            amount_paise,
            reference_type: reference_type.trim(),
            reference_id: reference_id.trim(),
            idempotency_key,
            notes: notes.trim(),
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to redeem store credit"))?;
    match result {
        StoreCreditWriteResult::Saved(credit) => {
            accounting_service::post_customer_credit_change(
                &mut tx,
                tenant_id,
                branch_id,
                "store_credit_redemption",
                &format!("{credit_id}:{idempotency_key}"),
                "Store credit redeemed",
                -amount_paise,
                "ACCOUNTS_RECEIVABLE",
            )
            .await?;
            tx.commit()
                .await
                .map_err(|_| AppError::internal("failed to commit store credit redemption"))?;
            Ok(credit)
        }
        other => {
            tx.rollback()
                .await
                .map_err(|_| AppError::internal("failed to finish store credit redemption"))?;
            map_credit_result(other)
        }
    }
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
                client_id,
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

pub async fn credit_pos_advance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    sale_id: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Ok(());
    }
    let idempotency_key = format!("pos-advance:{sale_id}");
    match wallet_repository::write_wallet_transaction_in_tx(
        tx,
        WalletWrite {
            tenant_id,
            branch_id,
            client_id,
            transaction_type: "recharge",
            delta_paise: amount_paise,
            reference_type: "pos_sale",
            reference_id: sale_id,
            idempotency_key: &idempotency_key,
            notes: "POS client advance",
        },
    )
    .await
    .map_err(|_| AppError::internal("failed to credit POS client advance"))?
    {
        WalletWriteResult::Saved(_) => Ok(()),
        WalletWriteResult::MissingClient => Err(AppError::not_found("client was not found")),
        WalletWriteResult::InsufficientBalance => {
            Err(AppError::conflict("wallet balance cannot go negative"))
        }
    }
}

async fn settle_gift_card_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
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
    let cards = sqlx::query_as::<_, (String, String, i64, String, Option<NaiveDate>)>(
        r#"SELECT id,branch_id,balance_paise,status,expires_at
             FROM gift_cards
            WHERE tenant_id=$1 AND code=$3
              AND (branch_id=$2 OR membership_cross_location_allowed(
                    $1,branch_id,$2,client_id,$4,'gift_card'))
            ORDER BY (branch_id=$2) DESC,created_at,id
            LIMIT 2 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(code.trim())
    .bind(client_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load gift card"))?;
    if cards.is_empty() {
        return Err(AppError::not_found(
            "gift card was not found or is not shared with this branch",
        ));
    }
    if cards.len() > 1 && cards[0].1 != branch_id {
        return Err(AppError::conflict(
            "gift card code is ambiguous across shared branches",
        ));
    }
    let card = &cards[0];
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM gift_card_transactions WHERE tenant_id=$1 AND gift_card_id=$2 AND idempotency_key=$3",
    )
    .bind(tenant_id).bind(&card.0).bind(idempotency_key)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to read gift card idempotency key"))?;
    if existing.is_some() {
        return Ok(());
    }
    if card.3 != "active" {
        return Err(AppError::conflict("gift card is not active"));
    }
    if card
        .4
        .is_some_and(|date| date < chrono::Utc::now().date_naive())
    {
        return Err(AppError::conflict("gift card is expired"));
    }
    if card.2 < amount_paise {
        return Err(AppError::conflict(
            "gift card balance cannot cover this payment",
        ));
    }

    let balance = card.2 - amount_paise;
    let status = if balance == 0 { "redeemed" } else { "active" };
    sqlx::query("UPDATE gift_cards SET balance_paise=$4, status=$5, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(&card.1).bind(&card.0).bind(balance).bind(status)
        .execute(&mut **tx).await
        .map_err(|_| AppError::internal("failed to update gift card balance"))?;
    sqlx::query("INSERT INTO gift_card_transactions (tenant_id, branch_id, gift_card_id, sale_id, transaction_type, delta_paise, balance_after_paise, idempotency_key, notes) VALUES ($1,$2,$3,$4,'redeem',$5,$6,$7,'POS gift card payment')")
        .bind(tenant_id).bind(&card.1).bind(&card.0).bind(sale_id).bind(-amount_paise).bind(balance).bind(idempotency_key)
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
