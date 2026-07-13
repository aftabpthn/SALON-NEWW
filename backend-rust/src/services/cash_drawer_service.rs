use chrono::NaiveDate;
use serde_json::json;

use crate::{
    models::common::AppError,
    repositories::cash_drawer_repository::{self, CashDrawerSession},
    state::AppState,
};

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

pub async fn open(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    opening_cash_paise: i64,
    notes: &str,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash drawer opening"))?;
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
        AppError::conflict("an active cash drawer already exists for this business date")
    })?;
    if opening_cash_paise > 0 {
        cash_drawer_repository::insert_movement(
            &mut tx,
            tenant_id,
            branch_id,
            &session.id,
            "opening",
            opening_cash_paise,
            "cash_drawer_session",
            &session.id,
            actor_user_id,
            notes,
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
        json!({ "openingCashPaise": opening_cash_paise }),
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
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash movement"))?;
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
    cash_drawer_repository::insert_movement(
        &mut tx,
        tenant_id,
        branch_id,
        &session.id,
        movement_type,
        amount_paise,
        reference_type,
        reference_id,
        actor_user_id,
        notes,
    )
    .await
    .map_err(|_| AppError::internal("failed to record cash movement"))?;
    cash_drawer_repository::audit(&mut tx, tenant_id, branch_id, &session.id, actor_user_id, "drawer.movement_recorded", json!({ "movementType": movement_type, "amountPaise": amount_paise, "referenceType": reference_type, "referenceId": reference_id }))
        .await.map_err(|_| AppError::internal("failed to audit cash movement"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash movement"))?;
    Ok(session)
}

pub async fn close(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    business_date: NaiveDate,
    counted_cash_paise: i64,
    notes: &str,
) -> Result<CashDrawerSession, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start cash drawer close"))?;
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
    let (cash_sales, movement_delta) =
        cash_drawer_repository::totals(&mut tx, tenant_id, branch_id, business_date, &session.id)
            .await
            .map_err(|_| AppError::internal("failed to reconcile cash drawer"))?;
    let expected = expected_cash(session.opening_cash_paise, cash_sales, movement_delta);
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
    )
    .await
    .map_err(|_| AppError::internal("failed to save cash drawer close"))?;
    cash_drawer_repository::audit(&mut tx, tenant_id, branch_id, &session.id, actor_user_id, "drawer.close_requested", json!({ "countedCashPaise": counted_cash_paise, "requiresApproval": status == "pending_approval" }))
        .await.map_err(|_| AppError::internal("failed to audit cash drawer close"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit cash drawer close"))?;
    Ok(updated)
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

#[cfg(test)]
mod tests {
    use super::{close_status, expected_cash};

    #[test]
    fn cash_reconciliation_requires_approval_only_for_variance() {
        assert_eq!(expected_cash(10_000, 5_000, -1_500), 13_500);
        assert_eq!(close_status(0), "closed");
        assert_eq!(close_status(-1), "pending_approval");
    }
}
