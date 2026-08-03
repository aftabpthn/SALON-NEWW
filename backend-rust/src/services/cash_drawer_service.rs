use std::collections::HashSet;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};

use crate::{
    models::common::AppError,
    repositories::cash_drawer_repository::{self, CashDrawerSession},
    services::{accounting_service, security_service},
    state::AppState,
};

#[derive(Debug, Clone)]
pub struct ProviderStatementInput {
    pub provider: String,
    pub settlement_date: NaiveDate,
    pub statement_reference: String,
    pub statement_gross_paise: i64,
    pub fee_paise: i64,
    pub bank_net_paise: i64,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DenominationCount {
    pub denomination_paise: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashCountBreakdown {
    pub denominations: Vec<DenominationCount>,
    #[serde(default)]
    pub loose_cash_paise: i64,
}

pub fn expected_cash(
    opening_cash_paise: i64,
    cash_sales_paise: i64,
    movement_delta_paise: i64,
) -> i64 {
    opening_cash_paise
        .saturating_add(cash_sales_paise)
        .saturating_add(movement_delta_paise)
}

fn close_status(variance_paise: i64) -> &'static str {
    if variance_paise == 0 {
        "closed"
    } else {
        "pending_approval"
    }
}

fn reconciliation_status(gross_difference_paise: i64, net_difference_paise: i64) -> &'static str {
    if gross_difference_paise == 0 && net_difference_paise == 0 {
        "matched"
    } else {
        "review_required"
    }
}

fn validate_cash_count(
    manual_counted_cash_paise: Option<i64>,
    breakdown: Option<&CashCountBreakdown>,
) -> Result<(i64, Value), AppError> {
    let Some(breakdown) = breakdown else {
        let counted = manual_counted_cash_paise
            .ok_or_else(|| AppError::validation("countedCashPaise is required"))?;
        if counted < 0 {
            return Err(AppError::validation("countedCashPaise cannot be negative"));
        }
        return Ok((
            counted,
            json!({ "denominations": [], "looseCashPaise": counted }),
        ));
    };
    if breakdown.denominations.len() > 20 || breakdown.loose_cash_paise < 0 {
        return Err(AppError::validation("invalid cash denomination breakdown"));
    }
    let mut seen = HashSet::new();
    let mut total = breakdown.loose_cash_paise;
    for item in &breakdown.denominations {
        if item.denomination_paise <= 0 || item.count < 0 || !seen.insert(item.denomination_paise) {
            return Err(AppError::validation("invalid cash denomination breakdown"));
        }
        total = total
            .checked_add(
                item.denomination_paise
                    .checked_mul(item.count)
                    .ok_or_else(|| AppError::validation("cash count is too large"))?,
            )
            .ok_or_else(|| AppError::validation("cash count is too large"))?;
    }
    if manual_counted_cash_paise.is_some_and(|value| value != total) {
        return Err(AppError::validation(
            "countedCashPaise must match the denomination total",
        ));
    }
    Ok((total, json!(breakdown)))
}

pub async fn open(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    opening_cash_paise: i64,
    notes: &str,
    holiday_override: bool,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash drawer opening"))?;
    cash_drawer_repository::lock_business_date(&mut tx, tenant_id, branch_id, business_date)
        .await
        .map_err(|_| AppError::internal("failed to lock business date"))?;
    ensure_business_day_unlocked(&mut tx, tenant_id, branch_id, business_date).await?;
    if let Some((_, previous_date, status)) =
        cash_drawer_repository::previous_unclosed(&mut tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to validate previous cash drawer"))?
    {
        return Err(AppError::conflict(format!(
            "cash drawer for {previous_date} is still {status}; close and approve it before opening a later day"
        )));
    }
    let holiday_name =
        cash_drawer_repository::closed_holiday_name(&mut tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to validate branch holiday"))?;
    if holiday_name.is_some() && !holiday_override {
        return Err(AppError::conflict(
            "this branch is closed for a holiday; manager holiday exception and notes are required",
        ));
    }
    let controls = cash_drawer_repository::control_settings(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load cash control settings"))?;
    if controls.max_cash_paise > 0 && opening_cash_paise > controls.max_cash_paise {
        return Err(AppError::conflict(
            "opening cash exceeds the configured branch cash limit",
        ));
    }
    let session = cash_drawer_repository::open(
        &mut tx,
        tenant_id,
        branch_id,
        actor_user_id,
        business_date,
        opening_cash_paise,
        notes,
    )
    .await
    .map_err(|_| AppError::internal("failed to open cash drawer"))?
    .ok_or_else(|| {
        AppError::conflict(
            "a cash drawer already exists for this business date and cannot be reopened",
        )
    })?;
    if opening_cash_paise > 0 {
        cash_drawer_repository::insert_movement(
            &mut tx,
            tenant_id,
            branch_id,
            &session.id,
            None,
            "opening",
            opening_cash_paise,
            "cash_drawer_session",
            &session.id,
            actor_user_id,
            notes,
            None,
        )
        .await
        .map_err(|_| AppError::internal("failed to record opening cash"))?;
    }
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        "drawer.opened",
        json!({ "openingCashPaise": opening_cash_paise, "holidayException": holiday_override, "holidayName": holiday_name }),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit cash drawer opening"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash drawer opening"))?;
    Ok(session)
}

pub async fn add_movement(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    movement_type: &str,
    amount_paise: i64,
    reference_type: &str,
    reference_id: &str,
    notes: &str,
    requested_till_id: &str,
    idempotency_key: &str,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash movement"))?;
    if let Some(session_id) = cash_drawer_repository::movement_session_by_idempotency(
        &mut tx,
        tenant_id,
        branch_id,
        idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to verify cash movement retry"))?
    {
        let session =
            cash_drawer_repository::by_id_for_update(&mut tx, tenant_id, branch_id, &session_id)
                .await
                .map_err(|_| AppError::internal("failed to load retried cash movement"))?
                .ok_or_else(|| AppError::internal("cash movement drawer was not found"))?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to complete cash movement retry"))?;
        return Ok(session);
    }
    ensure_business_day_unlocked(&mut tx, tenant_id, branch_id, business_date).await?;
    let session =
        cash_drawer_repository::active_for_update(&mut tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| {
                AppError::not_found("no open cash drawer exists for this business date")
            })?;
    if session.status != "open" {
        return Err(AppError::validation(
            "cash movements are blocked while drawer close is pending approval",
        ));
    }
    if movement_type == "cash_in" {
        let controls = cash_drawer_repository::control_settings(&state.db, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load cash control settings"))?;
        if controls.max_cash_paise > 0 {
            let (cash_sales, movement_delta) = cash_drawer_repository::totals(
                &mut tx,
                tenant_id,
                branch_id,
                business_date,
                &session.id,
            )
            .await
            .map_err(|_| AppError::internal("failed to calculate current cash"))?;
            let till_summary = cash_drawer_repository::till_close_summary(
                &mut tx,
                tenant_id,
                branch_id,
                &session.id,
            )
            .await
            .map_err(|_| AppError::internal("failed to calculate current tills"))?;
            let opening = if till_summary.0 > 0 {
                till_summary.2
            } else {
                session.opening_cash_paise
            };
            if expected_cash(opening, cash_sales, movement_delta).saturating_add(amount_paise)
                > controls.max_cash_paise
            {
                return Err(AppError::conflict(
                    "cash movement would exceed the configured branch cash limit",
                ));
            }
        }
    }
    let cash_drawer_till_id = resolve_open_movement_till_id(
        &mut tx,
        tenant_id,
        branch_id,
        business_date,
        &session.id,
        requested_till_id,
    )
    .await?;
    let inserted = cash_drawer_repository::insert_movement(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        cash_drawer_till_id.as_deref(),
        movement_type,
        amount_paise,
        reference_type,
        reference_id,
        actor_user_id,
        notes,
        Some(idempotency_key),
    )
    .await
    .map_err(|_| AppError::internal("failed to record cash movement"))?;
    if inserted {
        cash_drawer_repository::audit(&mut tx, tenant_id, branch_id, &session.id, actor_user_id, "drawer.movement_recorded", json!({ "movementType": movement_type, "amountPaise": amount_paise, "referenceType": reference_type, "referenceId": reference_id, "cashDrawerTillId": cash_drawer_till_id, "idempotencyKey": idempotency_key }))
            .await.map_err(|_| AppError::internal("failed to audit cash movement"))?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash movement"))?;
    Ok(session)
}

async fn resolve_open_movement_till_id(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
    drawer_session_id: &str,
    requested_till_id: &str,
) -> Result<Option<String>, AppError> {
    let till_ids = cash_drawer_repository::open_till_ids_for_cash(
        tx,
        tenant_id,
        branch_id,
        business_date,
        requested_till_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate cash drawer till"))?;
    if !requested_till_id.is_empty() && till_ids.is_empty() {
        return Err(AppError::conflict("selected cash drawer till is not open"));
    }
    if requested_till_id.is_empty() && till_ids.len() > 1 {
        return Err(AppError::validation(
            "cashDrawerTillId is required when multiple tills are open",
        ));
    }
    if requested_till_id.is_empty() && till_ids.is_empty() {
        let till_summary =
            cash_drawer_repository::till_close_summary(tx, tenant_id, branch_id, drawer_session_id)
                .await
                .map_err(|_| AppError::internal("failed to validate cash drawer tills"))?;
        if till_summary.0 > 0 {
            return Err(AppError::conflict(
                "an open cash drawer till is required for cash movement",
            ));
        }
    }
    Ok(till_ids.into_iter().next())
}

pub async fn record_invoice_cash_refund(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    refund_id: &str,
    amount_paise: i64,
    requested_till_id: &str,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("cash refund amount is invalid"));
    }
    ensure_business_day_unlocked(tx, tenant_id, branch_id, business_date).await?;
    let session =
        cash_drawer_repository::active_for_update(tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer for refund"))?
            .ok_or_else(|| AppError::conflict("an open cash drawer is required for cash refund"))?;
    if session.status != "open" {
        return Err(AppError::conflict(
            "cash drawer is not open for cash refund",
        ));
    }
    let till_id = resolve_open_movement_till_id(
        tx,
        tenant_id,
        branch_id,
        business_date,
        &session.id,
        requested_till_id,
    )
    .await?;
    cash_drawer_repository::insert_movement(
        tx,
        tenant_id,
        branch_id,
        &session.id,
        till_id.as_deref(),
        "refund_cash",
        -amount_paise,
        "invoice_refund",
        refund_id,
        actor_user_id,
        "Automatic cash invoice refund",
        None,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .and_then(|value| value.constraint())
            == Some("uq_cash_drawer_invoice_refund_movement")
        {
            AppError::conflict("cash refund movement already exists")
        } else {
            AppError::internal("failed to record cash refund movement")
        }
    })?;
    cash_drawer_repository::audit(
        tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        "drawer.invoice_refund_recorded",
        json!({"refundId":refund_id,"amountPaise":amount_paise,"cashDrawerTillId":till_id}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit cash refund movement"))?;
    Ok(())
}

pub async fn record_booking_cash_advance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    payment_id: &str,
    amount_paise: i64,
    requested_till_id: &str,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("cash advance amount is invalid"));
    }
    ensure_business_day_unlocked(tx, tenant_id, branch_id, business_date).await?;
    let session =
        cash_drawer_repository::active_for_update(tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer for booking advance"))?
            .ok_or_else(|| {
                AppError::conflict("an open cash drawer is required for cash advance")
            })?;
    if session.status != "open" {
        return Err(AppError::conflict(
            "cash drawer is not open for cash advance",
        ));
    }
    let till_id = resolve_open_movement_till_id(
        tx,
        tenant_id,
        branch_id,
        business_date,
        &session.id,
        requested_till_id,
    )
    .await?;
    cash_drawer_repository::insert_movement(
        tx,
        tenant_id,
        branch_id,
        &session.id,
        till_id.as_deref(),
        "cash_in",
        amount_paise,
        "booking_advance",
        payment_id,
        actor_user_id,
        "Appointment booking advance",
        Some(payment_id),
    )
    .await
    .map_err(|_| AppError::internal("failed to record cash booking advance"))?;
    cash_drawer_repository::audit(
        tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        "drawer.booking_advance_recorded",
        json!({"paymentId":payment_id,"amountPaise":amount_paise,"cashDrawerTillId":till_id}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit cash booking advance"))?;
    Ok(())
}

pub async fn close(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    counted_cash_paise: Option<i64>,
    denomination_breakdown: Option<CashCountBreakdown>,
    notes: &str,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash drawer close"))?;
    ensure_business_day_unlocked(&mut tx, tenant_id, branch_id, business_date).await?;
    let session =
        cash_drawer_repository::active_for_update(&mut tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| {
                AppError::not_found("no open cash drawer exists for this business date")
            })?;
    if session.status != "open" {
        return Err(AppError::conflict(
            "cash drawer close is already pending approval",
        ));
    }
    let till_summary =
        cash_drawer_repository::till_close_summary(&mut tx, tenant_id, branch_id, &session.id)
            .await
            .map_err(|_| AppError::internal("failed to validate cash tills"))?;
    if till_summary.1 > 0 {
        return Err(AppError::conflict(
            "all tills must be closed before day close",
        ));
    }
    let (cash_sales, movement_delta) =
        cash_drawer_repository::totals(&mut tx, tenant_id, branch_id, business_date, &session.id)
            .await
            .map_err(|_| AppError::internal("failed to reconcile cash drawer"))?;
    let refund_accounting_variance = cash_drawer_repository::invoice_refund_accounting_variance(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
    )
    .await
    .map_err(|_| AppError::internal("failed to reconcile cash refund accounting"))?;
    if refund_accounting_variance != 0 {
        return Err(AppError::conflict(
            "cash refund movements do not reconcile with accounting entries",
        ));
    }
    let (counted_cash_paise, denomination_breakdown, opening_cash_paise) = if till_summary.0 > 0 {
        (
            till_summary.4,
            json!({ "source": "closed_tills" }),
            till_summary.2,
        )
    } else {
        let (counted, breakdown) =
            validate_cash_count(counted_cash_paise, denomination_breakdown.as_ref())?;
        (counted, breakdown, session.opening_cash_paise)
    };
    let expected = expected_cash(opening_cash_paise, cash_sales, movement_delta);
    if till_summary.0 > 0 && till_summary.3 != expected {
        return Err(AppError::conflict(
            "closed till totals do not reconcile with the cash drawer; assign every cash payment and movement to a till",
        ));
    }
    let variance = counted_cash_paise.saturating_sub(expected);
    let status = close_status(variance);
    let updated = cash_drawer_repository::request_close(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        expected,
        counted_cash_paise,
        variance,
        status,
        notes,
        denomination_breakdown,
    )
    .await
    .map_err(|_| AppError::internal("failed to save cash drawer close"))?;
    if updated.status == "closed" {
        persist_close_snapshot(&mut tx, tenant_id, branch_id, actor_user_id, &updated).await?;
    }
    cash_drawer_repository::audit(&mut tx, tenant_id, branch_id, &session.id, actor_user_id, "drawer.close_requested", json!({ "countedCashPaise": counted_cash_paise, "requiresApproval": status == "pending_approval" }))
        .await.map_err(|_| AppError::internal("failed to audit cash drawer close"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash drawer close"))?;
    Ok(updated)
}

pub async fn handover(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    to_staff_id: &str,
    notes: &str,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash drawer handover"))?;
    ensure_business_day_unlocked(&mut tx, tenant_id, branch_id, business_date).await?;
    let session =
        cash_drawer_repository::active_for_update(&mut tx, tenant_id, branch_id, business_date)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| AppError::not_found("no open cash drawer exists for this date"))?;
    if session.status != "open" {
        return Err(AppError::conflict(
            "cash drawer handover is blocked while close is pending approval",
        ));
    }
    let staff_name =
        cash_drawer_repository::active_staff_name(&mut tx, tenant_id, branch_id, to_staff_id)
            .await
            .map_err(|_| AppError::internal("failed to validate handover staff"))?
            .ok_or_else(|| AppError::not_found("active handover staff was not found"))?;
    let updated = cash_drawer_repository::record_handover(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        to_staff_id,
        notes,
    )
    .await
    .map_err(|_| AppError::internal("failed to record cash drawer handover"))?;
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        "drawer.handed_over",
        json!({ "toStaffId": to_staff_id, "toStaffName": staff_name, "notes": notes }),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit cash drawer handover"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash drawer handover"))?;
    Ok(updated)
}

async fn ensure_business_day_unlocked(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
) -> Result<(), AppError> {
    if cash_drawer_repository::is_day_locked(tx, tenant_id, branch_id, business_date)
        .await
        .map_err(|_| AppError::internal("failed to validate business day"))?
    {
        return Err(AppError::conflict(
            "cash drawer changes are blocked because this business day is locked",
        ));
    }
    Ok(())
}

pub async fn create_deposit(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    drawer_session_id: &str,
    amount_paise: i64,
    bank_name: &str,
    reference: &str,
    notes: &str,
) -> Result<cash_drawer_repository::CashDrawerBankDeposit, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start bank deposit"))?;
    let session =
        cash_drawer_repository::by_id_for_update(&mut tx, tenant_id, branch_id, drawer_session_id)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| AppError::not_found("cash drawer was not found"))?;
    if session.status != "closed" {
        return Err(AppError::conflict(
            "cash drawer must be approved and closed before deposit",
        ));
    }
    let deposited = cash_drawer_repository::active_deposit_total(
        &mut tx,
        tenant_id,
        branch_id,
        drawer_session_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to calculate deposited cash"))?;
    let counted = session.counted_cash_paise.unwrap_or_default();
    if amount_paise > counted.saturating_sub(deposited) {
        return Err(AppError::validation(
            "deposit exceeds remaining counted cash",
        ));
    }
    let deposit = cash_drawer_repository::insert_deposit(
        &mut tx,
        tenant_id,
        branch_id,
        drawer_session_id,
        actor_user_id,
        amount_paise,
        bank_name,
        reference,
        notes,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .and_then(|value| value.constraint())
            == Some("uq_cash_drawer_bank_deposit_reference")
        {
            AppError::conflict("bank deposit reference already exists")
        } else {
            AppError::internal("failed to save bank deposit")
        }
    })?;
    cash_drawer_repository::audit(
        &mut tx, tenant_id, branch_id, drawer_session_id, actor_user_id,
        "drawer.bank_deposit_created",
        json!({ "depositId": deposit.id, "amountPaise": amount_paise, "bankName": bank_name, "reference": reference }),
    ).await.map_err(|_| AppError::internal("failed to audit bank deposit"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit bank deposit"))?;
    Ok(deposit)
}

pub async fn reverse_movement(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    movement_id: &str,
    reason: &str,
) -> Result<cash_drawer_repository::CashDrawerMovement, AppError> {
    if reason.trim().len() < 3 {
        return Err(AppError::validation("correction reason is required"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash correction"))?;
    let reversal = cash_drawer_repository::reverse_movement(
        &mut tx,
        tenant_id,
        branch_id,
        movement_id,
        actor_user_id,
        reason.trim(),
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .and_then(|value| value.constraint())
            == Some("uq_cash_drawer_movement_reversal")
        {
            AppError::conflict("cash movement was already reversed")
        } else {
            AppError::internal("failed to reverse cash movement")
        }
    })?
    .ok_or_else(|| {
        AppError::conflict("only an unreversed manual movement in an open drawer can be corrected")
    })?;
    cash_drawer_repository::audit(
        &mut tx, tenant_id, branch_id, &reversal.drawer_session_id, actor_user_id,
        "drawer.movement_reversed", json!({"movementId":movement_id,"reversalId":reversal.id,"amountPaise":reversal.amount_paise,"reason":reason.trim()}),
    ).await.map_err(|_| AppError::internal("failed to audit cash correction"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash correction"))?;
    Ok(reversal)
}

pub async fn amend_deposit(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    deposit_id: &str,
    amount_paise: i64,
    bank_name: &str,
    reference: &str,
    notes: &str,
    amendment_note: &str,
) -> Result<cash_drawer_repository::CashDrawerBankDeposit, AppError> {
    if amount_paise <= 0
        || bank_name.is_empty()
        || reference.is_empty()
        || amendment_note.trim().len() < 3
    {
        return Err(AppError::validation(
            "amount, bank, reference and amendmentNote are required",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start deposit amendment"))?;
    let current: Option<(String, i64)> = sqlx::query_as("SELECT drawer_session_id,amount_paise FROM cash_drawer_bank_deposits WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(deposit_id).fetch_optional(&mut *tx).await
        .map_err(|_| AppError::internal("failed to lock bank deposit"))?;
    let (session_id, old_amount) =
        current.ok_or_else(|| AppError::conflict("only a pending bank deposit can be amended"))?;
    let session =
        cash_drawer_repository::by_id_for_update(&mut tx, tenant_id, branch_id, &session_id)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| AppError::not_found("cash drawer was not found"))?;
    let active_total =
        cash_drawer_repository::active_deposit_total(&mut tx, tenant_id, branch_id, &session_id)
            .await
            .map_err(|_| AppError::internal("failed to calculate deposited cash"))?;
    let available = session
        .counted_cash_paise
        .unwrap_or_default()
        .saturating_sub(active_total.saturating_sub(old_amount));
    if amount_paise > available {
        return Err(AppError::validation(
            "amended deposit exceeds remaining counted cash",
        ));
    }
    let deposit = cash_drawer_repository::amend_pending_deposit(
        &mut tx,
        tenant_id,
        branch_id,
        deposit_id,
        actor_user_id,
        amount_paise,
        bank_name,
        reference,
        notes,
        amendment_note.trim(),
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .and_then(|value| value.constraint())
            == Some("uq_cash_drawer_bank_deposit_reference")
        {
            AppError::conflict("bank deposit reference already exists")
        } else {
            AppError::internal("failed to amend bank deposit")
        }
    })?
    .ok_or_else(|| AppError::conflict("bank deposit is no longer pending"))?;
    cash_drawer_repository::audit(
        &mut tx, tenant_id, branch_id, &session_id, actor_user_id, "drawer.bank_deposit_amended",
        json!({"depositId":deposit_id,"oldAmountPaise":old_amount,"amountPaise":amount_paise,"bankName":bank_name,"reference":reference,"amendmentNote":amendment_note.trim()}),
    ).await.map_err(|_| AppError::internal("failed to audit bank deposit amendment"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit deposit amendment"))?;
    Ok(deposit)
}

pub async fn update_deposit_status(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    deposit_id: &str,
    status: &str,
) -> Result<cash_drawer_repository::CashDrawerBankDeposit, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start bank deposit update"))?;
    let deposit = cash_drawer_repository::update_deposit_status(
        &mut tx,
        tenant_id,
        branch_id,
        deposit_id,
        actor_user_id,
        status,
    )
    .await
    .map_err(|_| AppError::internal("failed to update bank deposit"))?
    .ok_or_else(|| AppError::conflict("bank deposit is not pending"))?;
    if status == "confirmed" {
        let session = cash_drawer_repository::by_id_for_update(
            &mut tx,
            tenant_id,
            branch_id,
            &deposit.drawer_session_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load bank deposit business date"))?
        .ok_or_else(|| AppError::not_found("cash drawer was not found"))?;
        accounting_service::post_cash_bank_deposit(
            &mut tx,
            tenant_id,
            branch_id,
            &deposit.id,
            session.business_date,
            actor_user_id,
            deposit.amount_paise,
        )
        .await?;
    }
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        &deposit.drawer_session_id,
        actor_user_id,
        if status == "confirmed" {
            "drawer.bank_deposit_confirmed"
        } else {
            "drawer.bank_deposit_cancelled"
        },
        json!({ "depositId": deposit.id, "amountPaise": deposit.amount_paise }),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit bank deposit update"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit bank deposit update"))?;
    Ok(deposit)
}

pub async fn create_provider_reconciliation(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    provider: &str,
    settlement_date: NaiveDate,
    statement_reference: &str,
    statement_gross_paise: i64,
    fee_paise: i64,
    bank_net_paise: i64,
    notes: &str,
) -> Result<cash_drawer_repository::ProviderReconciliationRun, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start provider reconciliation"))?;
    let run = insert_provider_reconciliation(
        &mut tx,
        tenant_id,
        branch_id,
        actor_user_id,
        &ProviderStatementInput {
            provider: provider.to_string(),
            settlement_date,
            statement_reference: statement_reference.to_string(),
            statement_gross_paise,
            fee_paise,
            bank_net_paise,
            notes: notes.to_string(),
        },
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit provider reconciliation"))?;
    Ok(run)
}

pub async fn import_provider_reconciliations(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    rows: Vec<ProviderStatementInput>,
) -> Result<Vec<cash_drawer_repository::ProviderReconciliationRun>, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start provider statement import"))?;
    let mut imported = Vec::with_capacity(rows.len());
    for row in &rows {
        imported.push(
            insert_provider_reconciliation(&mut tx, tenant_id, branch_id, actor_user_id, row)
                .await?,
        );
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit provider statement import"))?;
    Ok(imported)
}

pub async fn review_provider_reconciliation(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    id: &str,
    review_note: &str,
) -> Result<cash_drawer_repository::ProviderReconciliationRun, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start reconciliation review"))?;
    let run = cash_drawer_repository::review_provider_reconciliation(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        actor_user_id,
        review_note,
    )
    .await
    .map_err(|_| AppError::internal("failed to review provider reconciliation"))?
    .ok_or_else(|| {
        AppError::conflict(
            "reconciliation is not awaiting review or must be reviewed by another manager",
        )
    })?;
    security_service::record_audit_tx(
        &mut tx,
        tenant_id,
        branch_id,
        actor_user_id,
        "cash.reconciliation.reviewed",
        json!({"reconciliationId":run.id,"provider":run.provider,"settlementDate":run.settlement_date,"reviewNote":review_note}),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit reconciliation review"))?;
    Ok(run)
}

async fn insert_provider_reconciliation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    row: &ProviderStatementInput,
) -> Result<cash_drawer_repository::ProviderReconciliationRun, AppError> {
    let system_gross = cash_drawer_repository::system_provider_gross(
        tx,
        tenant_id,
        branch_id,
        &row.provider,
        row.settlement_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to calculate provider payments"))?;
    let gross_difference = row.statement_gross_paise.saturating_sub(system_gross);
    let net_difference = row
        .bank_net_paise
        .saturating_sub(row.statement_gross_paise.saturating_sub(row.fee_paise));
    cash_drawer_repository::insert_provider_reconciliation(
        tx,
        tenant_id,
        branch_id,
        &row.provider,
        row.settlement_date,
        &row.statement_reference,
        system_gross,
        row.statement_gross_paise,
        row.fee_paise,
        row.bank_net_paise,
        reconciliation_status(gross_difference, net_difference),
        actor_user_id,
        &row.notes,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .and_then(|value| value.constraint())
            == Some("uq_pos_provider_reconciliation_reference")
        {
            AppError::conflict("provider statement reference already exists")
        } else {
            AppError::internal("failed to save provider reconciliation")
        }
    })
}

pub async fn create_till(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    drawer_session_id: &str,
    till_code: &str,
    till_name: &str,
    terminal_id: Option<&str>,
    opening_cash_paise: i64,
    notes: &str,
) -> Result<cash_drawer_repository::CashDrawerTill, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start till opening"))?;
    let session =
        cash_drawer_repository::by_id_for_update(&mut tx, tenant_id, branch_id, drawer_session_id)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| AppError::not_found("cash drawer was not found"))?;
    if session.status != "open" {
        return Err(AppError::conflict("cash drawer is not open"));
    }
    let terminal_name = if let Some(terminal_id) = terminal_id {
        Some(
            cash_drawer_repository::active_terminal_name(
                &mut tx,
                tenant_id,
                branch_id,
                terminal_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to validate till terminal"))?
            .ok_or_else(|| AppError::not_found("active POS terminal was not found"))?,
        )
    } else {
        None
    };
    let till = cash_drawer_repository::insert_till(
        &mut tx,
        tenant_id,
        branch_id,
        drawer_session_id,
        till_code,
        till_name,
        terminal_id,
        opening_cash_paise,
        actor_user_id,
        notes,
    )
    .await
    .map_err(|_| AppError::conflict("till code already exists for this drawer"))?;
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        drawer_session_id,
        actor_user_id,
        "drawer.till_opened",
        json!({"tillId":till.id,"tillCode":till_code,"terminalId":terminal_id,"terminalName":terminal_name,"openingCashPaise":opening_cash_paise}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit till opening"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit till opening"))?;
    Ok(till)
}

pub async fn close_till(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    till_id: &str,
    counted_cash_paise: i64,
) -> Result<cash_drawer_repository::CashDrawerTill, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start till close"))?;
    let till = cash_drawer_repository::till_for_update(&mut tx, tenant_id, branch_id, till_id)
        .await
        .map_err(|_| AppError::internal("failed to lock till"))?
        .ok_or_else(|| AppError::not_found("cash till was not found"))?;
    if till.status != "open" {
        return Err(AppError::conflict("cash till is not open"));
    }
    let cash_sales =
        cash_drawer_repository::till_cash_sales(&mut tx, tenant_id, branch_id, till_id)
            .await
            .map_err(|_| AppError::internal("failed to calculate till cash"))?;
    let movement_delta =
        cash_drawer_repository::till_movement_delta(&mut tx, tenant_id, branch_id, till_id)
            .await
            .map_err(|_| AppError::internal("failed to calculate till movements"))?;
    let outgoing_cash =
        cash_drawer_repository::till_outgoing_cash(&mut tx, tenant_id, branch_id, till_id)
            .await
            .map_err(|_| AppError::internal("failed to calculate till outgoing cash"))?;
    let expected = expected_cash(
        till.opening_cash_paise,
        cash_sales,
        movement_delta.saturating_sub(outgoing_cash),
    );
    let variance = counted_cash_paise.saturating_sub(expected);
    let status = close_status(variance);
    let updated = cash_drawer_repository::close_till(
        &mut tx,
        tenant_id,
        branch_id,
        till_id,
        actor_user_id,
        expected,
        counted_cash_paise,
        variance,
        status,
    )
    .await
    .map_err(|_| AppError::internal("failed to close cash till"))?;
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        &till.drawer_session_id,
        actor_user_id,
        "drawer.till_close_requested",
        json!({"tillId":till_id,"countedCashPaise":counted_cash_paise,"variancePaise":variance}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit till close"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit till close"))?;
    Ok(updated)
}

pub async fn approve_till(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    till_id: &str,
) -> Result<cash_drawer_repository::CashDrawerTill, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start till approval"))?;
    let till =
        cash_drawer_repository::approve_till(&mut tx, tenant_id, branch_id, till_id, actor_user_id)
            .await
            .map_err(|_| AppError::internal("failed to approve till variance"))?
            .ok_or_else(|| AppError::conflict("till is not awaiting independent approval"))?;
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        &till.drawer_session_id,
        actor_user_id,
        "drawer.till_variance_approved",
        json!({"tillId":till_id}),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit till approval"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit till approval"))?;
    Ok(till)
}

pub async fn approve(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    drawer_session_id: &str,
    approval_note: &str,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash drawer approval"))?;
    let session = cash_drawer_repository::approve_close(
        &mut tx,
        tenant_id,
        branch_id,
        drawer_session_id,
        actor_user_id,
        approval_note,
    )
    .await
    .map_err(|_| AppError::conflict("cash drawer is not awaiting approval"))?;
    persist_close_snapshot(&mut tx, tenant_id, branch_id, actor_user_id, &session).await?;
    cash_drawer_repository::audit(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        actor_user_id,
        "drawer.variance_approved",
        json!({ "approvalNote": approval_note }),
    )
    .await
    .map_err(|_| AppError::internal("failed to audit cash drawer approval"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash drawer approval"))?;
    Ok(session)
}

async fn persist_close_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    session: &CashDrawerSession,
) -> Result<(), AppError> {
    let snapshot = json!({
        "drawerSessionId": session.id,
        "businessDate": session.business_date,
        "openingCashPaise": session.opening_cash_paise,
        "expectedCashPaise": session.expected_cash_paise,
        "countedCashPaise": session.counted_cash_paise,
        "variancePaise": session.variance_paise,
        "denominationBreakdown": session.denomination_breakdown_json,
        "closeRequestedAt": session.close_requested_at,
        "approvedAt": session.approved_at,
        "closedAt": session.closed_at,
    });
    let checksum = format!("{:x}", Sha256::digest(snapshot.to_string().as_bytes()));
    cash_drawer_repository::insert_close_snapshot(
        tx,
        tenant_id,
        branch_id,
        &session.id,
        session.business_date,
        snapshot,
        &checksum,
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to store immutable cash close snapshot"))
}

#[cfg(test)]
mod tests {
    use super::{
        close_status, expected_cash, reconciliation_status, validate_cash_count,
        CashCountBreakdown, DenominationCount,
    };

    #[test]
    fn cash_reconciliation_requires_approval_only_for_variance() {
        assert_eq!(expected_cash(10_000, 5_000, -1_500), 13_500);
        assert_eq!(expected_cash(10_000, 5_000, 2_000 - 1_500), 15_500);
        assert_eq!(close_status(0), "closed");
        assert_eq!(close_status(-1), "pending_approval");
    }

    #[test]
    fn denomination_total_is_server_calculated() {
        let breakdown = CashCountBreakdown {
            denominations: vec![
                DenominationCount {
                    denomination_paise: 50_000,
                    count: 2,
                },
                DenominationCount {
                    denomination_paise: 10_000,
                    count: 3,
                },
            ],
            loose_cash_paise: 25,
        };
        let (total, _) = validate_cash_count(Some(130_025), Some(&breakdown)).unwrap();
        assert_eq!(total, 130_025);
        assert!(validate_cash_count(Some(130_000), Some(&breakdown)).is_err());
    }

    #[test]
    fn three_way_reconciliation_flags_any_difference() {
        assert_eq!(reconciliation_status(0, 0), "matched");
        assert_eq!(reconciliation_status(1, 0), "review_required");
        assert_eq!(reconciliation_status(0, -1), "review_required");
    }
}

#[cfg(test)]
#[path = "cash_drawer_phase6_tests.rs"]
mod phase6_tests;
