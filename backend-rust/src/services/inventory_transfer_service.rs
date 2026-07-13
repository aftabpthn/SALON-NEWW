use std::collections::HashSet;

use crate::{
    models::common::AppError,
    repositories::inventory_transfer_repository::{self, InventoryTransfer, InventoryTransferLine},
    state::AppState,
};

#[derive(Debug, Clone)]
pub struct TransferLineInput {
    pub source_inventory_item_id: String,
    pub destination_inventory_item_id: String,
    pub quantity: i32,
}

#[derive(Debug, Clone)]
pub struct TransferInput {
    pub destination_branch_id: String,
    pub idempotency_key: String,
    pub notes: String,
    pub lines: Vec<TransferLineInput>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDetails {
    #[serde(flatten)]
    pub transfer: InventoryTransfer,
    pub lines: Vec<InventoryTransferLine>,
}

pub fn weighted_unit_cost(
    current_quantity: i32,
    current_unit_cost_paise: i64,
    received_quantity: i32,
    received_unit_cost_paise: i64,
) -> Result<i64, AppError> {
    let total_quantity = current_quantity
        .checked_add(received_quantity)
        .ok_or_else(|| AppError::validation("inventory quantity exceeds supported range"))?;
    let value = i128::from(current_quantity) * i128::from(current_unit_cost_paise)
        + i128::from(received_quantity) * i128::from(received_unit_cost_paise);
    i64::try_from(value / i128::from(total_quantity))
        .map_err(|_| AppError::validation("inventory cost exceeds supported range"))
}

pub async fn details(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    transfer_id: &str,
) -> Result<TransferDetails, AppError> {
    let transfer = inventory_transfer_repository::get(&state.db, tenant_id, branch_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to load inventory transfer"))?
        .ok_or_else(|| AppError::not_found("inventory transfer was not found"))?;
    let lines = inventory_transfer_repository::lines(&state.db, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to load inventory transfer lines"))?;
    Ok(TransferDetails { transfer, lines })
}

pub async fn dispatch(
    state: &AppState,
    tenant_id: &str,
    source_branch_id: &str,
    actor_user_id: &str,
    input: TransferInput,
) -> Result<TransferDetails, AppError> {
    validate_input(source_branch_id, &input)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inventory transfer"))?;

    if let Some(existing) = inventory_transfer_repository::by_idempotency(
        &mut tx,
        tenant_id,
        source_branch_id,
        &input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to check inventory transfer replay"))?
    {
        drop(tx);
        return details(state, tenant_id, source_branch_id, &existing.id).await;
    }

    for branch_id in [source_branch_id, input.destination_branch_id.as_str()] {
        let exists =
            inventory_transfer_repository::active_branch_exists(&mut tx, tenant_id, branch_id)
                .await
                .map_err(|_| AppError::internal("failed to validate transfer branch"))?;
        if !exists {
            return Err(AppError::validation(
                "transfer branch is inactive or unavailable",
            ));
        }
    }

    let mut lines = input.lines;
    lines.sort_by(|left, right| {
        left.source_inventory_item_id
            .cmp(&right.source_inventory_item_id)
    });
    let transfer = inventory_transfer_repository::create_transfer(
        &mut tx,
        tenant_id,
        source_branch_id,
        &input.destination_branch_id,
        &input.idempotency_key,
        input.notes.trim(),
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to create inventory transfer"))?;

    let mut created_lines = Vec::with_capacity(lines.len());
    for line in lines {
        let source = inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            source_branch_id,
            &line.source_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock source inventory"))?
        .ok_or_else(|| AppError::validation("source inventory item is inactive or unavailable"))?;
        if source.stock_quantity < line.quantity {
            return Err(AppError::conflict(
                "source inventory has insufficient stock for transfer",
            ));
        }
        let destination_exists = inventory_transfer_repository::active_inventory_item_exists(
            &mut tx,
            tenant_id,
            &input.destination_branch_id,
            &line.destination_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate destination inventory"))?;
        if !destination_exists {
            return Err(AppError::validation(
                "destination inventory item is inactive or unavailable",
            ));
        }
        let transfer_line = inventory_transfer_repository::create_line(
            &mut tx,
            tenant_id,
            &transfer.id,
            &line.source_inventory_item_id,
            &line.destination_inventory_item_id,
            line.quantity,
            source.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to create inventory transfer line"))?;
        inventory_transfer_repository::apply_stock(
            &mut tx,
            tenant_id,
            source_branch_id,
            &line.source_inventory_item_id,
            source.stock_quantity - line.quantity,
            source.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to reserve source inventory"))?;
        inventory_transfer_repository::add_stock_ledger(
            &mut tx,
            tenant_id,
            source_branch_id,
            &line.source_inventory_item_id,
            &transfer.id,
            &transfer_line.id,
            "transfer_out",
            -line.quantity,
            source.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to record inventory transfer dispatch"))?;
        created_lines.push(transfer_line);
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory transfer"))?;
    Ok(TransferDetails {
        transfer,
        lines: created_lines,
    })
}

pub async fn receive(
    state: &AppState,
    tenant_id: &str,
    destination_branch_id: &str,
    actor_user_id: &str,
    transfer_id: &str,
) -> Result<TransferDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start transfer receipt"))?;
    let transfer = inventory_transfer_repository::get_for_update(&mut tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to lock inventory transfer"))?
        .ok_or_else(|| AppError::not_found("inventory transfer was not found"))?;
    if transfer.destination_branch_id != destination_branch_id {
        return Err(AppError::forbidden(
            "only the destination branch can receive this transfer",
        ));
    }
    if transfer.status == "received" {
        drop(tx);
        return details(state, tenant_id, destination_branch_id, transfer_id).await;
    }
    if transfer.status != "in_transit" {
        return Err(AppError::conflict(
            "only an in-transit transfer can be received",
        ));
    }
    let mut lines =
        inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory transfer lines"))?;
    lines.sort_by(|left, right| {
        left.destination_inventory_item_id
            .cmp(&right.destination_inventory_item_id)
    });
    for line in &lines {
        let destination = inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            destination_branch_id,
            &line.destination_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock destination inventory"))?
        .ok_or_else(|| {
            AppError::validation("destination inventory item is inactive or unavailable")
        })?;
        let quantity = destination
            .stock_quantity
            .checked_add(line.quantity)
            .ok_or_else(|| AppError::validation("inventory quantity exceeds supported range"))?;
        let unit_cost = weighted_unit_cost(
            destination.stock_quantity,
            destination.unit_cost_paise,
            line.quantity,
            line.unit_cost_paise,
        )?;
        inventory_transfer_repository::apply_stock(
            &mut tx,
            tenant_id,
            destination_branch_id,
            &line.destination_inventory_item_id,
            quantity,
            unit_cost,
        )
        .await
        .map_err(|_| AppError::internal("failed to receive destination inventory"))?;
        inventory_transfer_repository::add_stock_ledger(
            &mut tx,
            tenant_id,
            destination_branch_id,
            &line.destination_inventory_item_id,
            transfer_id,
            &line.id,
            "transfer_in",
            line.quantity,
            line.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to record inventory transfer receipt"))?;
    }
    inventory_transfer_repository::mark_received(&mut tx, tenant_id, transfer_id, actor_user_id)
        .await
        .map_err(|_| AppError::internal("failed to complete inventory transfer receipt"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory transfer receipt"))?;
    details(state, tenant_id, destination_branch_id, transfer_id).await
}

pub async fn cancel(
    state: &AppState,
    tenant_id: &str,
    source_branch_id: &str,
    actor_user_id: &str,
    transfer_id: &str,
) -> Result<TransferDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start transfer cancellation"))?;
    let transfer = inventory_transfer_repository::get_for_update(&mut tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to lock inventory transfer"))?
        .ok_or_else(|| AppError::not_found("inventory transfer was not found"))?;
    if transfer.source_branch_id != source_branch_id {
        return Err(AppError::forbidden(
            "only the source branch can cancel this transfer",
        ));
    }
    if transfer.status == "cancelled" {
        drop(tx);
        return details(state, tenant_id, source_branch_id, transfer_id).await;
    }
    if transfer.status != "in_transit" {
        return Err(AppError::conflict("received transfers cannot be cancelled"));
    }
    let mut lines =
        inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory transfer lines"))?;
    lines.sort_by(|left, right| {
        left.source_inventory_item_id
            .cmp(&right.source_inventory_item_id)
    });
    for line in &lines {
        let source = inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            source_branch_id,
            &line.source_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock source inventory"))?
        .ok_or_else(|| AppError::validation("source inventory item is inactive or unavailable"))?;
        let quantity = source
            .stock_quantity
            .checked_add(line.quantity)
            .ok_or_else(|| AppError::validation("inventory quantity exceeds supported range"))?;
        inventory_transfer_repository::apply_stock(
            &mut tx,
            tenant_id,
            source_branch_id,
            &line.source_inventory_item_id,
            quantity,
            source.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to restore source inventory"))?;
        inventory_transfer_repository::add_stock_ledger(
            &mut tx,
            tenant_id,
            source_branch_id,
            &line.source_inventory_item_id,
            transfer_id,
            &line.id,
            "transfer_reversal",
            line.quantity,
            line.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to record inventory transfer cancellation"))?;
    }
    inventory_transfer_repository::mark_cancelled(&mut tx, tenant_id, transfer_id, actor_user_id)
        .await
        .map_err(|_| AppError::internal("failed to cancel inventory transfer"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer cancellation"))?;
    details(state, tenant_id, source_branch_id, transfer_id).await
}

fn validate_input(source_branch_id: &str, input: &TransferInput) -> Result<(), AppError> {
    if input.destination_branch_id.trim().is_empty()
        || input.destination_branch_id == source_branch_id
    {
        return Err(AppError::validation(
            "destinationBranchId must be a different branch",
        ));
    }
    if input.idempotency_key.trim().is_empty() || input.idempotency_key.len() > 120 {
        return Err(AppError::validation(
            "idempotencyKey is required and must be at most 120 characters",
        ));
    }
    if input.notes.len() > 1_000 {
        return Err(AppError::validation(
            "notes must be at most 1000 characters",
        ));
    }
    if input.lines.is_empty() || input.lines.len() > 100 {
        return Err(AppError::validation("transfer must include 1 to 100 lines"));
    }
    let mut sources = HashSet::new();
    let mut destinations = HashSet::new();
    for line in &input.lines {
        if line.source_inventory_item_id.trim().is_empty()
            || line.destination_inventory_item_id.trim().is_empty()
            || line.quantity <= 0
        {
            return Err(AppError::validation("each transfer line requires sourceInventoryItemId, destinationInventoryItemId, and positive quantity"));
        }
        if !sources.insert(line.source_inventory_item_id.as_str())
            || !destinations.insert(line.destination_inventory_item_id.as_str())
        {
            return Err(AppError::validation(
                "source and destination inventory items may appear only once per transfer",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::weighted_unit_cost;

    #[test]
    fn transferred_stock_preserves_weighted_cost_in_paise() {
        assert_eq!(weighted_unit_cost(4, 1_000, 6, 1_500).unwrap(), 1_300);
    }
}
