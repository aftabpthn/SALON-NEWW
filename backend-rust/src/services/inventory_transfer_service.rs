use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde_json::json;

use crate::{
    models::common::AppError,
    repositories::{
        inventory_governance_repository,
        inventory_transfer_repository::{
            self, InventoryTransfer, InventoryTransferEvent, InventoryTransferLine,
            InventoryTransferShipment, InventoryTransferShipmentLine, TransferCenterSettings,
        },
        purchase_repository,
    },
    services::{
        accounting_service::{self, ManualJournalLine},
        inventory_adjustment_service,
    },
    state::AppState,
};

#[derive(Debug, Clone)]
pub struct TransferLineInput {
    pub source_inventory_item_id: String,
    pub destination_inventory_item_id: Option<String>,
    pub quantity: Option<i32>,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub transfer_unit_price_paise: Option<i64>,
    pub discount_bps: i32,
    pub gst_percent: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct TransferInput {
    pub mode: String,
    pub source_branch_id: Option<String>,
    pub destination_branch_id: Option<String>,
    pub parent_transfer_id: Option<String>,
    pub return_reason: String,
    pub idempotency_key: String,
    pub notes: String,
    pub lines: Vec<TransferLineInput>,
}

#[derive(Debug, Clone)]
pub struct ShipmentLineInput {
    pub transfer_line_id: String,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
}

#[derive(Debug, Clone)]
pub struct ShipmentInput {
    pub shipping_paise: i64,
    pub handling_paise: i64,
    pub other_charges_paise: i64,
    pub lines: Vec<ShipmentLineInput>,
}

#[derive(Debug, Clone)]
pub struct ShipmentReceiptLineInput {
    pub shipment_line_id: String,
    pub received_retail_quantity: i32,
    pub received_consumable_quantity: i32,
    pub damaged_quantity: i32,
    pub expired_quantity: i32,
    pub short_quantity: i32,
    pub variance_reason: String,
}

#[derive(Debug, Clone)]
pub struct ReceiptInput {
    pub note: String,
    pub lines: Vec<ShipmentReceiptLineInput>,
}

#[derive(Debug, Clone)]
pub struct ReturnLineInput {
    pub transfer_line_id: String,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
}

#[derive(Debug, Clone)]
pub struct ReturnInput {
    pub reason: String,
    pub notes: String,
    pub idempotency_key: String,
    pub lines: Vec<ReturnLineInput>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipmentDetails {
    #[serde(flatten)]
    pub shipment: InventoryTransferShipment,
    pub lines: Vec<InventoryTransferShipmentLine>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDetails {
    #[serde(flatten)]
    pub transfer: InventoryTransfer,
    pub lines: Vec<InventoryTransferLine>,
    pub shipments: Vec<ShipmentDetails>,
    pub events: Vec<InventoryTransferEvent>,
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
    if total_quantity <= 0 {
        return Err(AppError::validation(
            "received inventory quantity must be positive",
        ));
    }
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
    let mut shipment_details = Vec::new();
    for shipment in inventory_transfer_repository::shipments(&state.db, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to load transfer shipments"))?
    {
        let lines =
            inventory_transfer_repository::shipment_lines(&state.db, tenant_id, &shipment.id)
                .await
                .map_err(|_| AppError::internal("failed to load transfer shipment lines"))?;
        shipment_details.push(ShipmentDetails { shipment, lines });
    }
    let events = inventory_transfer_repository::events(&state.db, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to load transfer events"))?;
    Ok(TransferDetails {
        transfer,
        lines,
        shipments: shipment_details,
        events,
    })
}

pub async fn center_setting(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
) -> Result<TransferCenterSettings, AppError> {
    inventory_transfer_repository::setting(&state.db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load transfer settings"))
        .map(|row| {
            row.unwrap_or(TransferCenterSettings {
                branch_id: branch_id.to_owned(),
                center_role: "branch".to_owned(),
                default_retail_warehouse_branch_id: None,
                default_consumable_warehouse_branch_id: None,
                auto_checkout_transfers: false,
                cannot_raise_transfer: false,
            })
        })
}

#[allow(clippy::too_many_arguments)]
pub async fn save_center_setting(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    role: &str,
    retail_warehouse: Option<&str>,
    consumable_warehouse: Option<&str>,
    auto_checkout: bool,
    cannot_raise: bool,
) -> Result<TransferCenterSettings, AppError> {
    if !["branch", "warehouse", "franchise"].contains(&role) {
        return Err(AppError::validation("center role is invalid"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to save transfer settings"))?;
    for candidate in [retail_warehouse, consumable_warehouse]
        .into_iter()
        .flatten()
    {
        if candidate == branch_id
            || !inventory_transfer_repository::active_branch_exists(&mut tx, tenant_id, candidate)
                .await
                .map_err(|_| AppError::internal("failed to validate default warehouse"))?
        {
            return Err(AppError::validation(
                "default warehouse must be another active branch",
            ));
        }
        if inventory_transfer_repository::center_role(&mut tx, tenant_id, candidate)
            .await
            .map_err(|_| AppError::internal("failed to validate default warehouse role"))?
            .as_deref()
            != Some("warehouse")
        {
            return Err(AppError::validation(
                "default warehouse branch must be configured with warehouse role first",
            ));
        }
    }
    let result = inventory_transfer_repository::save_setting(
        &mut tx,
        tenant_id,
        branch_id,
        role,
        retail_warehouse,
        consumable_warehouse,
        auto_checkout,
        cannot_raise,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to save transfer settings"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer settings"))?;
    Ok(result)
}

pub async fn create(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    mut input: TransferInput,
) -> Result<TransferDetails, AppError> {
    validate_create_input(&input)?;
    let (source_branch_id, destination_branch_id) =
        resolve_branches(state, tenant_id, current_branch_id, &input).await?;
    if source_branch_id == destination_branch_id {
        return Err(AppError::validation(
            "source and destination branches must differ",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inventory transfer"))?;
    if let Some(existing) = inventory_transfer_repository::by_idempotency(
        &mut tx,
        tenant_id,
        &source_branch_id,
        &input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to check inventory transfer replay"))?
    {
        drop(tx);
        return details(state, tenant_id, current_branch_id, &existing.id).await;
    }
    for branch in [&source_branch_id, &destination_branch_id] {
        if !inventory_transfer_repository::active_branch_exists(&mut tx, tenant_id, branch)
            .await
            .map_err(|_| AppError::internal("failed to validate transfer branch"))?
        {
            return Err(AppError::validation(
                "transfer branch is inactive or unavailable",
            ));
        }
    }
    if input.mode == "return" {
        let parent_id = input
            .parent_transfer_id
            .as_deref()
            .ok_or_else(|| AppError::validation("parent transfer is required for a return"))?;
        let parent = inventory_transfer_repository::get_for_update(&mut tx, tenant_id, parent_id)
            .await
            .map_err(|_| AppError::internal("failed to lock parent transfer"))?
            .ok_or_else(|| AppError::not_found("parent transfer was not found"))?;
        if !matches!(parent.status.as_str(), "partially_received" | "received")
            || parent.destination_branch_id != source_branch_id
            || parent.source_branch_id != destination_branch_id
        {
            return Err(AppError::conflict(
                "return branches or parent transfer status are invalid",
            ));
        }
    }
    input
        .lines
        .sort_by(|a, b| a.source_inventory_item_id.cmp(&b.source_inventory_item_id));
    let transfer = inventory_transfer_repository::create_transfer(
        &mut tx,
        tenant_id,
        &source_branch_id,
        &destination_branch_id,
        &input.mode,
        input.parent_transfer_id.as_deref(),
        &input.return_reason,
        &input.idempotency_key,
        input.notes.trim(),
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to create inventory transfer"))?;
    for line in &input.lines {
        let mut supplied_destination_id = None;
        let source = match inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            &source_branch_id,
            &line.source_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate source inventory"))?
        {
            Some(source) => source,
            None if matches!(input.mode.as_str(), "pull" | "franchise_purchase") => {
                supplied_destination_id = Some(line.source_inventory_item_id.clone());
                let source_id = inventory_transfer_repository::resolve_counterpart_item(
                    &mut tx,
                    tenant_id,
                    &line.source_inventory_item_id,
                    &source_branch_id,
                )
                .await
                .map_err(|_| AppError::internal("failed to resolve source warehouse item"))?
                .ok_or_else(|| {
                    AppError::validation("matching source warehouse item was not found")
                })?;
                inventory_transfer_repository::lock_inventory_item(
                    &mut tx,
                    tenant_id,
                    &source_branch_id,
                    &source_id,
                )
                .await
                .map_err(|_| AppError::internal("failed to validate source warehouse item"))?
                .ok_or_else(|| AppError::validation("source warehouse item is unavailable"))?
            }
            None => {
                return Err(AppError::validation(
                    "source inventory item is inactive or unavailable",
                ));
            }
        };
        let (retail, consumable) = split_quantities(line, &source.product_usage)?;
        let destination_item_id = match line.destination_inventory_item_id.as_deref() {
            Some(id) if !id.trim().is_empty() => id.to_owned(),
            _ if supplied_destination_id.is_some() => supplied_destination_id.unwrap_or_default(),
            _ => inventory_transfer_repository::resolve_counterpart_item(
                &mut tx,
                tenant_id,
                &source.id,
                &destination_branch_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to resolve destination inventory item"))?
            .ok_or_else(|| {
                AppError::validation("matching destination inventory item was not found")
            })?,
        };
        let destination = inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            &destination_branch_id,
            &destination_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate destination inventory"))?
        .ok_or_else(|| {
            AppError::validation("destination inventory item is inactive or unavailable")
        })?;
        if source.sku != destination.sku
            || source.batch_tracked != destination.batch_tracked
            || source.product_usage != destination.product_usage
        {
            return Err(AppError::conflict(
                "source and destination product configuration must match",
            ));
        }
        if input.mode == "return" {
            let (received_retail, received_consumable, returned_retail, returned_consumable) =
                inventory_transfer_repository::return_allowance_for_update(
                    &mut tx,
                    tenant_id,
                    input.parent_transfer_id.as_deref().unwrap_or_default(),
                    &source.id,
                    &destination.id,
                )
                .await
                .map_err(|_| AppError::internal("failed to lock transfer return allowance"))?
                .ok_or_else(|| {
                    AppError::validation("return product was not received on the parent transfer")
                })?;
            if i64::from(retail) + returned_retail > i64::from(received_retail)
                || i64::from(consumable) + returned_consumable > i64::from(received_consumable)
            {
                return Err(AppError::conflict(
                    "return quantity exceeds parent received stock after prior returns",
                ));
            }
        }
        let price = line
            .transfer_unit_price_paise
            .unwrap_or(source.unit_cost_paise);
        let gst = line
            .gst_percent
            .unwrap_or(if input.mode == "franchise_purchase" {
                source.gst_percent
            } else {
                0
            });
        inventory_transfer_repository::create_line(
            &mut tx,
            tenant_id,
            &transfer.id,
            &source.id,
            &destination.id,
            retail,
            consumable,
            source.unit_cost_paise,
            price,
            line.discount_bps,
            gst,
        )
        .await
        .map_err(|_| AppError::internal("failed to create inventory transfer line"))?;
    }
    inventory_transfer_repository::add_event(
        &mut tx,
        tenant_id,
        &transfer.id,
        "created",
        "",
        "draft",
        actor,
        input.notes.trim(),
        &json!({"mode": input.mode}),
    )
    .await
    .map_err(|_| AppError::internal("failed to record transfer event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory transfer"))?;
    details(state, tenant_id, current_branch_id, &transfer.id).await
}

pub async fn raise(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
) -> Result<TransferDetails, AppError> {
    let setting = center_setting(state, tenant_id, current_branch_id).await?;
    if setting.cannot_raise_transfer {
        return Err(AppError::forbidden(
            "this center is not allowed to raise transfer orders",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to raise transfer"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    let allowed_branch = if matches!(transfer.mode.as_str(), "pull" | "franchise_purchase") {
        &transfer.destination_branch_id
    } else {
        &transfer.source_branch_id
    };
    if current_branch_id != allowed_branch {
        return Err(AppError::forbidden(
            "only the requesting center can raise this transfer",
        ));
    }
    require_status(&transfer, &["draft"])?;
    let lines = inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to lock transfer lines"))?;
    for line in &lines {
        let source = inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            &transfer.source_branch_id,
            &line.source_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock source inventory"))?
        .ok_or_else(|| AppError::validation("source inventory item is unavailable"))?;
        let reserved_elsewhere = inventory_transfer_repository::reserved_quantity(
            &mut tx,
            tenant_id,
            &transfer.source_branch_id,
            &source.id,
            transfer_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to calculate reserved inventory"))?;
        if i64::from(source.stock_quantity) < reserved_elsewhere + i64::from(line.quantity) {
            return Err(AppError::conflict(
                "source inventory is insufficient after reservations",
            ));
        }
        inventory_transfer_repository::reserve_line(
            &mut tx,
            tenant_id,
            &line.id,
            line.retail_quantity,
            line.consumable_quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to reserve transfer stock"))?;
    }
    transition(&mut tx, tenant_id, &transfer, "raised", actor, "").await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer raise"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

pub async fn approve(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
) -> Result<TransferDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to approve transfer"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    require_status(&transfer, &["raised"])?;
    if transfer.created_by_user_id == actor || transfer.raised_by_user_id.as_deref() == Some(actor)
    {
        return Err(AppError::forbidden(
            "maker-checker requires a different transfer approver",
        ));
    }
    transition(&mut tx, tenant_id, &transfer, "approved", actor, "").await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer approval"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

pub async fn reject(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
    note: &str,
) -> Result<TransferDetails, AppError> {
    if note.trim().is_empty() {
        return Err(AppError::validation("rejection note is required"));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to reject transfer"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    require_status(&transfer, &["raised"])?;
    if transfer.created_by_user_id == actor || transfer.raised_by_user_id.as_deref() == Some(actor)
    {
        return Err(AppError::forbidden(
            "maker-checker requires a different transfer reviewer",
        ));
    }
    inventory_transfer_repository::release_reservations(&mut tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to release transfer reservations"))?;
    transition(
        &mut tx,
        tenant_id,
        &transfer,
        "rejected",
        actor,
        note.trim(),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer rejection"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

pub async fn dispatch_shipment(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
    input: ShipmentInput,
) -> Result<TransferDetails, AppError> {
    validate_shipment(&input)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start transfer shipment"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    if transfer.source_branch_id != current_branch_id {
        return Err(AppError::forbidden(
            "only the source branch can dispatch this transfer",
        ));
    }
    enforce_inventory_open(&mut tx, tenant_id, &[current_branch_id]).await?;
    require_status(
        &transfer,
        &["approved", "dispatched", "in_transit", "partially_received"],
    )?;
    let lines = inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to lock transfer lines"))?;
    let by_id = lines
        .iter()
        .map(|line| (line.id.as_str(), line))
        .collect::<HashMap<_, _>>();
    let setting = inventory_transfer_repository::setting(
        &state.db,
        tenant_id,
        &transfer.destination_branch_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load source transfer settings"))?;
    let auto_checkout = setting.is_some_and(|row| row.auto_checkout_transfers)
        && input.lines.iter().any(|line| line.consumable_quantity > 0);
    let shipment = inventory_transfer_repository::create_shipment(
        &mut tx,
        tenant_id,
        transfer_id,
        input.shipping_paise,
        input.handling_paise,
        input.other_charges_paise,
        auto_checkout,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to create transfer shipment"))?;
    let mut seen = HashSet::new();
    let mut shipment_cost = 0_i64;
    for requested in &input.lines {
        if !seen.insert(requested.transfer_line_id.as_str()) {
            return Err(AppError::validation(
                "shipment contains a duplicate transfer line",
            ));
        }
        let line = by_id
            .get(requested.transfer_line_id.as_str())
            .copied()
            .ok_or_else(|| {
                AppError::validation("shipment line does not belong to this transfer")
            })?;
        if requested.retail_quantity > line.reserved_retail_quantity
            || requested.consumable_quantity > line.reserved_consumable_quantity
        {
            return Err(AppError::conflict(
                "shipment quantity exceeds reserved transfer stock",
            ));
        }
        let quantity = requested.retail_quantity + requested.consumable_quantity;
        let source = inventory_transfer_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            current_branch_id,
            &line.source_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock shipment stock"))?
        .ok_or_else(|| AppError::validation("source inventory item is unavailable"))?;
        let negative_rule=sqlx::query_scalar::<_,String>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
            .bind(tenant_id).bind(current_branch_id).fetch_one(&mut *tx).await
            .map_err(|_|AppError::internal("failed to load transfer stock policy"))?;
        let warning=source.stock_quantity<quantity;
        if warning && negative_rule!="allow_with_warning" {
            return Err(AppError::conflict(
                "source inventory is insufficient for shipment",
            ));
        }
        shipment_cost = checked_add_money(
            shipment_cost,
            i64::from(quantity)
                .checked_mul(source.unit_cost_paise)
                .ok_or_else(|| AppError::validation("shipment value exceeds supported range"))?,
        )?;
        let shipment_line = inventory_transfer_repository::create_shipment_line(
            &mut tx,
            tenant_id,
            &shipment.id,
            line,
            requested.retail_quantity,
            requested.consumable_quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to create transfer shipment line"))?;
        let stock_after = source.stock_quantity - quantity;
        inventory_transfer_repository::apply_stock(
            &mut tx,
            tenant_id,
            current_branch_id,
            &source.id,
            stock_after,
            source.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to deduct shipment stock"))?;
        let ledger_id = inventory_transfer_repository::add_stock_ledger(
            &mut tx,
            tenant_id,
            current_branch_id,
            &source.id,
            transfer_id,
            &line.id,
            &shipment.id,
            &shipment_line.id,
            "transfer_out",
            -quantity,
            source.unit_cost_paise,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to write shipment stock ledger"))?;
        if requested.retail_quantity>0 {
            inventory_governance_repository::record_automatic_transfer_out(
                &mut tx,tenant_id,current_branch_id,&source.id,"retail_available",requested.retail_quantity,
                source.unit_cost_paise,actor,&shipment_line.id,&format!("transfer-out-op:{}:retail",shipment_line.id),warning,
            ).await.map_err(|_|AppError::internal("failed to write retail transfer checkout history"))?;
        }
        if requested.consumable_quantity>0 {
            inventory_governance_repository::record_automatic_transfer_out(
                &mut tx,tenant_id,current_branch_id,&source.id,"consumable_available",requested.consumable_quantity,
                source.unit_cost_paise,actor,&shipment_line.id,&format!("transfer-out-op:{}:consumable",shipment_line.id),warning,
            ).await.map_err(|_|AppError::internal("failed to write consumable transfer checkout history"))?;
        }
        inventory_adjustment_service::allocate_fefo_quantity(
            &mut tx,
            tenant_id,
            current_branch_id,
            &source.id,
            source.batch_tracked,
            &ledger_id,
            quantity,
        )
        .await?;
        inventory_transfer_repository::set_source_ledger(
            &mut tx,
            tenant_id,
            &shipment_line.id,
            &ledger_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to link shipment stock ledger"))?;
        inventory_transfer_repository::apply_line_dispatch(
            &mut tx,
            tenant_id,
            &line.id,
            requested.retail_quantity,
            requested.consumable_quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to update dispatched transfer quantity"))?;
    }
    post_dispatch_journal(
        &mut tx,
        tenant_id,
        current_branch_id,
        &shipment.id,
        actor,
        shipment_cost,
        false,
    )
    .await?;
    inventory_transfer_repository::set_transfer_dispatch_status(
        &mut tx,
        tenant_id,
        transfer_id,
        "dispatched",
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to update transfer dispatch status"))?;
    inventory_transfer_repository::add_event(
        &mut tx,
        tenant_id,
        transfer_id,
        "shipment_dispatched",
        &transfer.status,
        "dispatched",
        actor,
        "",
        &json!({"shipmentId": shipment.id, "autoCheckout": auto_checkout}),
    )
    .await
    .map_err(|_| AppError::internal("failed to record shipment event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer shipment"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

pub async fn mark_in_transit(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
    shipment_id: &str,
) -> Result<TransferDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to ship transfer"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    if transfer.source_branch_id != current_branch_id {
        return Err(AppError::forbidden(
            "only the source branch can ship this transfer",
        ));
    }
    let shipment = inventory_transfer_repository::shipment_for_update(
        &mut tx,
        tenant_id,
        transfer_id,
        shipment_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock transfer shipment"))?
    .ok_or_else(|| AppError::not_found("transfer shipment was not found"))?;
    if shipment.status != "dispatched" {
        return Err(AppError::conflict(
            "only a dispatched shipment can move in transit",
        ));
    }
    inventory_transfer_repository::mark_shipment(
        &mut tx,
        tenant_id,
        shipment_id,
        "in_transit",
        actor,
        "",
    )
    .await
    .map_err(|_| AppError::internal("failed to ship transfer shipment"))?;
    inventory_transfer_repository::set_transfer_dispatch_status(
        &mut tx,
        tenant_id,
        transfer_id,
        "in_transit",
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to update transfer status"))?;
    inventory_transfer_repository::add_event(
        &mut tx,
        tenant_id,
        transfer_id,
        "shipment_in_transit",
        &transfer.status,
        "in_transit",
        actor,
        "",
        &json!({"shipmentId": shipment_id}),
    )
    .await
    .map_err(|_| AppError::internal("failed to record shipment event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer shipment"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

pub async fn receive_shipment(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
    shipment_id: &str,
    input: ReceiptInput,
) -> Result<TransferDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to receive transfer shipment"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    if transfer.destination_branch_id != current_branch_id {
        return Err(AppError::forbidden(
            "only the destination branch can receive this transfer",
        ));
    }
    enforce_inventory_open(
        &mut tx,
        tenant_id,
        &[&transfer.source_branch_id, &transfer.destination_branch_id],
    )
    .await?;
    let shipment = inventory_transfer_repository::shipment_for_update(
        &mut tx,
        tenant_id,
        transfer_id,
        shipment_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock transfer shipment"))?
    .ok_or_else(|| AppError::not_found("transfer shipment was not found"))?;
    if shipment.status == "received" {
        drop(tx);
        return details(state, tenant_id, current_branch_id, transfer_id).await;
    }
    if shipment.status != "in_transit" {
        return Err(AppError::conflict(
            "only an in-transit shipment can be received",
        ));
    }
    let shipment_lines =
        inventory_transfer_repository::shipment_lines_for_update(&mut tx, tenant_id, shipment_id)
            .await
            .map_err(|_| AppError::internal("failed to lock shipment lines"))?;
    let transfer_lines =
        inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
            .await
            .map_err(|_| AppError::internal("failed to lock transfer lines"))?;
    let transfer_by_id = transfer_lines
        .iter()
        .map(|line| (line.id.as_str(), line))
        .collect::<HashMap<_, _>>();
    let mut receipts = HashMap::new();
    for row in input.lines {
        if receipts.insert(row.shipment_line_id.clone(), row).is_some() {
            return Err(AppError::validation(
                "receipt contains a duplicate shipment line",
            ));
        }
    }
    if receipts.len() != shipment_lines.len() {
        return Err(AppError::validation(
            "receipt must account for every shipment line",
        ));
    }
    let accepted_total: i64 = receipts
        .values()
        .map(|row| i64::from(row.received_retail_quantity + row.received_consumable_quantity))
        .sum();
    let total_charges =
        shipment.shipping_paise + shipment.handling_paise + shipment.other_charges_paise;
    let source_gstin =
        inventory_transfer_repository::branch_gstin(&mut tx, tenant_id, &transfer.source_branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load source GST profile"))?;
    let destination_gstin = inventory_transfer_repository::branch_gstin(
        &mut tx,
        tenant_id,
        &transfer.destination_branch_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load destination GST profile"))?;
    let same_state = source_gstin.len() >= 2
        && destination_gstin.len() >= 2
        && source_gstin[..2] == destination_gstin[..2];
    let mut allocated_charges = 0_i64;
    let mut source_cost_total = 0_i64;
    let mut taxable_total = 0_i64;
    let mut cgst_total = 0_i64;
    let mut sgst_total = 0_i64;
    let mut igst_total = 0_i64;
    let mut processed_accepted = 0_i64;
    for shipment_line in &shipment_lines {
        let row = receipts
            .remove(&shipment_line.id)
            .ok_or_else(|| AppError::validation("shipment receipt line is missing"))?;
        validate_receipt_line(shipment_line, &row)?;
        let transfer_line = transfer_by_id
            .get(shipment_line.transfer_line_id.as_str())
            .copied()
            .ok_or_else(|| AppError::internal("shipment transfer line is missing"))?;
        let dispatched =
            shipment_line.dispatched_retail_quantity + shipment_line.dispatched_consumable_quantity;
        let accepted = row.received_retail_quantity + row.received_consumable_quantity;
        source_cost_total = checked_add_money(
            source_cost_total,
            i64::from(dispatched) * shipment_line.source_unit_cost_paise,
        )?;
        let gross = i64::from(accepted)
            .checked_mul(shipment_line.transfer_unit_price_paise)
            .ok_or_else(|| AppError::validation("transfer value exceeds supported range"))?;
        let taxable = i64::try_from(
            i128::from(gross) * i128::from(10_000 - shipment_line.discount_bps) / 10_000,
        )
        .map_err(|_| AppError::validation("transfer value exceeds supported range"))?;
        if shipment_line.gst_percent > 0
            && (source_gstin.is_empty() || destination_gstin.is_empty())
        {
            return Err(AppError::conflict(
                "both branches need GST profiles before receiving a taxed transfer",
            ));
        }
        let tax = taxable
            .checked_mul(i64::from(shipment_line.gst_percent))
            .ok_or_else(|| AppError::validation("transfer tax exceeds supported range"))?
            / 100;
        let (cgst, sgst, igst) = if same_state {
            (tax / 2, tax - tax / 2, 0)
        } else {
            (0, 0, tax)
        };
        let charge_share = if accepted == 0 || accepted_total == 0 {
            0
        } else {
            processed_accepted += i64::from(accepted);
            if processed_accepted == accepted_total {
                total_charges - allocated_charges
            } else {
                total_charges * i64::from(accepted) / accepted_total
            }
        };
        allocated_charges += charge_share;
        let landed = taxable + charge_share;
        let landed_unit = if accepted > 0 {
            landed / i64::from(accepted)
        } else {
            0
        };
        let destination_ledger_id = if accepted > 0 {
            let destination = inventory_transfer_repository::lock_inventory_item(
                &mut tx,
                tenant_id,
                current_branch_id,
                &transfer_line.destination_inventory_item_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to lock destination inventory"))?
            .ok_or_else(|| AppError::validation("destination inventory item is unavailable"))?;
            let stock_after = destination
                .stock_quantity
                .checked_add(accepted)
                .ok_or_else(|| {
                    AppError::validation("inventory quantity exceeds supported range")
                })?;
            let unit_cost = weighted_unit_cost(
                destination.stock_quantity,
                destination.unit_cost_paise,
                accepted,
                landed_unit,
            )?;
            inventory_transfer_repository::apply_stock(
                &mut tx,
                tenant_id,
                current_branch_id,
                &destination.id,
                stock_after,
                unit_cost,
            )
            .await
            .map_err(|_| AppError::internal("failed to receive destination stock"))?;
            let ledger_id = inventory_transfer_repository::add_stock_ledger(
                &mut tx,
                tenant_id,
                current_branch_id,
                &destination.id,
                transfer_id,
                &transfer_line.id,
                shipment_id,
                &shipment_line.id,
                "transfer_in",
                accepted,
                landed_unit,
                stock_after,
            )
            .await
            .map_err(|_| AppError::internal("failed to write receipt stock ledger"))?;
            let batch_allocations = if destination.batch_tracked {
                let source_ledger = shipment_line
                    .source_stock_ledger_id
                    .as_deref()
                    .ok_or_else(|| AppError::internal("shipment FEFO ledger is missing"))?;
                inventory_adjustment_service::receive_transfer_batches_from_ledger(
                    &mut tx,
                    tenant_id,
                    &transfer.source_branch_id,
                    current_branch_id,
                    &destination.id,
                    source_ledger,
                    &ledger_id,
                    accepted,
                )
                .await?
            } else {
                Vec::new()
            };
            if shipment.auto_checkout_applied && row.received_consumable_quantity > 0 {
                inventory_governance_repository::auto_checkout_transfer_containers(
                    &mut tx,
                    tenant_id,
                    current_branch_id,
                    actor,
                    &destination.id,
                    &destination.unit,
                    destination.units_per_package,
                    &shipment_line.id,
                    row.received_consumable_quantity,
                    &batch_allocations,
                )
                .await
                .map_err(|_| AppError::internal("failed to auto-checkout received consumables"))?;
            }
            Some(ledger_id)
        } else {
            None
        };
        inventory_transfer_repository::receive_shipment_line(
            &mut tx,
            tenant_id,
            &shipment_line.id,
            row.received_retail_quantity,
            row.received_consumable_quantity,
            row.damaged_quantity,
            row.expired_quantity,
            row.short_quantity,
            row.variance_reason.trim(),
            taxable,
            cgst,
            sgst,
            igst,
            landed,
            landed_unit,
            destination_ledger_id.as_deref(),
        )
        .await
        .map_err(|_| AppError::internal("failed to save shipment receipt line"))?;
        inventory_transfer_repository::apply_line_receipt(
            &mut tx,
            tenant_id,
            &transfer_line.id,
            row.received_retail_quantity,
            row.received_consumable_quantity,
            row.damaged_quantity,
            row.expired_quantity,
            row.short_quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to update transfer receipt progress"))?;
        taxable_total = checked_add_money(taxable_total, taxable)?;
        cgst_total = checked_add_money(cgst_total, cgst)?;
        sgst_total = checked_add_money(sgst_total, sgst)?;
        igst_total = checked_add_money(igst_total, igst)?;
    }
    post_transfer_journals(
        &mut tx,
        tenant_id,
        &transfer,
        &shipment,
        actor,
        source_cost_total,
        taxable_total,
        total_charges,
        allocated_charges,
        cgst_total,
        sgst_total,
        igst_total,
    )
    .await?;
    inventory_transfer_repository::mark_shipment(
        &mut tx,
        tenant_id,
        shipment_id,
        "received",
        actor,
        input.note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to complete shipment receipt"))?;
    let refreshed =
        inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
            .await
            .map_err(|_| AppError::internal("failed to calculate transfer progress"))?;
    let complete = refreshed.iter().all(|line| {
        line.received_retail_quantity
            + line.received_consumable_quantity
            + line.damaged_quantity
            + line.expired_quantity
            + line.short_quantity
            == line.quantity
    });
    let status = if complete {
        "received"
    } else {
        "partially_received"
    };
    inventory_transfer_repository::set_transfer_received_status(
        &mut tx,
        tenant_id,
        transfer_id,
        status,
        actor,
    )
    .await
    .map_err(|_| AppError::internal("failed to update transfer receipt status"))?;
    inventory_transfer_repository::add_event(
        &mut tx,
        tenant_id,
        transfer_id,
        "shipment_received",
        &transfer.status,
        status,
        actor,
        input.note.trim(),
        &json!({"shipmentId": shipment_id}),
    )
    .await
    .map_err(|_| AppError::internal("failed to record receipt event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit shipment receipt"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

pub async fn create_return(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
    input: ReturnInput,
) -> Result<TransferDetails, AppError> {
    if !["damaged", "expired", "mismatch", "other"].contains(&input.reason.as_str()) {
        return Err(AppError::validation("return reason is invalid"));
    }
    let original = details(state, tenant_id, current_branch_id, transfer_id).await?;
    if original.transfer.destination_branch_id != current_branch_id
        || !["partially_received", "received"].contains(&original.transfer.status.as_str())
    {
        return Err(AppError::conflict(
            "only received stock can be returned by the destination branch",
        ));
    }
    let by_id = original
        .lines
        .iter()
        .map(|line| (line.id.as_str(), line))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    let mut lines = Vec::new();
    for requested in input.lines {
        if requested.retail_quantity < 0
            || requested.consumable_quantity < 0
            || requested.retail_quantity + requested.consumable_quantity <= 0
            || !seen.insert(requested.transfer_line_id.clone())
        {
            return Err(AppError::validation("return quantities are invalid"));
        }
        let line = by_id
            .get(requested.transfer_line_id.as_str())
            .copied()
            .ok_or_else(|| AppError::validation("return line does not belong to the transfer"))?;
        if requested.retail_quantity > line.received_retail_quantity
            || requested.consumable_quantity > line.received_consumable_quantity
        {
            return Err(AppError::conflict("return quantity exceeds received stock"));
        }
        lines.push(TransferLineInput {
            source_inventory_item_id: line.destination_inventory_item_id.clone(),
            destination_inventory_item_id: Some(line.source_inventory_item_id.clone()),
            quantity: None,
            retail_quantity: requested.retail_quantity,
            consumable_quantity: requested.consumable_quantity,
            transfer_unit_price_paise: Some(line.transfer_unit_price_paise),
            discount_bps: line.discount_bps,
            gst_percent: Some(line.gst_percent),
        });
    }
    create(
        state,
        tenant_id,
        current_branch_id,
        actor,
        TransferInput {
            mode: "return".to_owned(),
            source_branch_id: Some(original.transfer.destination_branch_id),
            destination_branch_id: Some(original.transfer.source_branch_id),
            parent_transfer_id: Some(transfer_id.to_owned()),
            return_reason: input.reason,
            idempotency_key: input.idempotency_key,
            notes: input.notes,
            lines,
        },
    )
    .await
}

pub async fn cancel(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    actor: &str,
    transfer_id: &str,
    note: &str,
) -> Result<TransferDetails, AppError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to cancel transfer"))?;
    let transfer = lock_participant(&mut tx, tenant_id, current_branch_id, transfer_id).await?;
    if transfer.status == "cancelled" {
        drop(tx);
        return details(state, tenant_id, current_branch_id, transfer_id).await;
    }
    if matches!(
        transfer.status.as_str(),
        "in_transit" | "partially_received" | "received"
    ) {
        return Err(AppError::conflict(
            "in-transit or received stock must use a return transfer",
        ));
    }
    if !matches!(
        transfer.status.as_str(),
        "draft" | "raised" | "approved" | "dispatched"
    ) {
        return Err(AppError::conflict(
            "transfer cannot be cancelled in its current status",
        ));
    }
    if transfer.status == "dispatched" {
        if current_branch_id != transfer.source_branch_id {
            return Err(AppError::forbidden(
                "only the source branch can cancel dispatched stock",
            ));
        }
        for shipment in inventory_transfer_repository::shipments(&state.db, tenant_id, transfer_id)
            .await
            .map_err(|_| AppError::internal("failed to load transfer shipments"))?
        {
            if shipment.status != "dispatched" {
                return Err(AppError::conflict(
                    "only unshipped dispatched stock can be cancelled",
                ));
            }
            let shipment_lines = inventory_transfer_repository::shipment_lines_for_update(
                &mut tx,
                tenant_id,
                &shipment.id,
            )
            .await
            .map_err(|_| AppError::internal("failed to lock shipment lines"))?;
            let transfer_lines =
                inventory_transfer_repository::lines_for_update(&mut tx, tenant_id, transfer_id)
                    .await
                    .map_err(|_| AppError::internal("failed to lock transfer lines"))?;
            let by_id = transfer_lines
                .iter()
                .map(|line| (line.id.as_str(), line))
                .collect::<HashMap<_, _>>();
            let mut shipment_cost = 0_i64;
            for shipment_line in shipment_lines {
                let line = by_id
                    .get(shipment_line.transfer_line_id.as_str())
                    .copied()
                    .ok_or_else(|| AppError::internal("shipment transfer line is missing"))?;
                let quantity = shipment_line.dispatched_retail_quantity
                    + shipment_line.dispatched_consumable_quantity;
                shipment_cost = checked_add_money(
                    shipment_cost,
                    i64::from(quantity)
                        .checked_mul(shipment_line.source_unit_cost_paise)
                        .ok_or_else(|| {
                            AppError::validation("shipment value exceeds supported range")
                        })?,
                )?;
                let source = inventory_transfer_repository::lock_inventory_item(
                    &mut tx,
                    tenant_id,
                    current_branch_id,
                    &line.source_inventory_item_id,
                )
                .await
                .map_err(|_| AppError::internal("failed to lock cancelled shipment stock"))?
                .ok_or_else(|| AppError::validation("source inventory item is unavailable"))?;
                let stock_after = source.stock_quantity.checked_add(quantity).ok_or_else(|| {
                    AppError::validation("inventory quantity exceeds supported range")
                })?;
                inventory_transfer_repository::apply_stock(
                    &mut tx,
                    tenant_id,
                    current_branch_id,
                    &source.id,
                    stock_after,
                    source.unit_cost_paise,
                )
                .await
                .map_err(|_| AppError::internal("failed to restore cancelled shipment stock"))?;
                let reversal_ledger = inventory_transfer_repository::add_stock_ledger(
                    &mut tx,
                    tenant_id,
                    current_branch_id,
                    &source.id,
                    transfer_id,
                    &line.id,
                    &shipment.id,
                    &shipment_line.id,
                    "transfer_cancel",
                    quantity,
                    source.unit_cost_paise,
                    stock_after,
                )
                .await
                .map_err(|_| AppError::internal("failed to write transfer cancellation ledger"))?;
                if let Some(source_ledger) = shipment_line.source_stock_ledger_id.as_deref() {
                    inventory_adjustment_service::restore_transfer_batches(
                        &mut tx,
                        tenant_id,
                        current_branch_id,
                        source_ledger,
                        &reversal_ledger,
                    )
                    .await?;
                }
                inventory_transfer_repository::reverse_line_dispatch(
                    &mut tx,
                    tenant_id,
                    &line.id,
                    shipment_line.dispatched_retail_quantity,
                    shipment_line.dispatched_consumable_quantity,
                )
                .await
                .map_err(|_| AppError::internal("failed to reverse dispatched quantity"))?;
            }
            post_dispatch_journal(
                &mut tx,
                tenant_id,
                current_branch_id,
                &shipment.id,
                actor,
                shipment_cost,
                true,
            )
            .await?;
            inventory_transfer_repository::cancel_shipment(
                &mut tx,
                tenant_id,
                &shipment.id,
                actor,
                note.trim(),
            )
            .await
            .map_err(|_| AppError::internal("failed to cancel transfer shipment"))?;
        }
    }
    inventory_transfer_repository::release_reservations(&mut tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to release transfer reservations"))?;
    transition(
        &mut tx,
        tenant_id,
        &transfer,
        "cancelled",
        actor,
        note.trim(),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit transfer cancellation"))?;
    details(state, tenant_id, current_branch_id, transfer_id).await
}

fn validate_create_input(input: &TransferInput) -> Result<(), AppError> {
    if !["push", "pull", "franchise_purchase", "return"].contains(&input.mode.as_str()) {
        return Err(AppError::validation("transfer mode is invalid"));
    }
    if input.idempotency_key.trim().is_empty() || input.lines.is_empty() {
        return Err(AppError::validation(
            "idempotency key and transfer lines are required",
        ));
    }
    if input.mode == "return"
        && !["damaged", "expired", "mismatch", "other"].contains(&input.return_reason.as_str())
    {
        return Err(AppError::validation("return reason is required"));
    }
    let mut items = HashSet::new();
    for line in &input.lines {
        if line.source_inventory_item_id.trim().is_empty()
            || line.retail_quantity < 0
            || line.consumable_quantity < 0
            || line.quantity.is_some_and(|quantity| quantity <= 0)
            || line
                .transfer_unit_price_paise
                .is_some_and(|price| price < 0)
            || !(0..=10_000).contains(&line.discount_bps)
            || line
                .gst_percent
                .is_some_and(|gst| !(0..=100).contains(&gst))
            || !items.insert(line.source_inventory_item_id.as_str())
        {
            return Err(AppError::validation(
                "transfer line is invalid or duplicated",
            ));
        }
    }
    Ok(())
}

fn validate_shipment(input: &ShipmentInput) -> Result<(), AppError> {
    if input.shipping_paise < 0
        || input.handling_paise < 0
        || input.other_charges_paise < 0
        || input.lines.is_empty()
    {
        return Err(AppError::validation(
            "shipment charges and lines are invalid",
        ));
    }
    if input.lines.iter().any(|line| {
        line.retail_quantity < 0
            || line.consumable_quantity < 0
            || line.retail_quantity + line.consumable_quantity <= 0
    }) {
        return Err(AppError::validation("shipment quantity must be positive"));
    }
    Ok(())
}

fn validate_receipt_line(
    shipment: &InventoryTransferShipmentLine,
    row: &ShipmentReceiptLineInput,
) -> Result<(), AppError> {
    let values = [
        row.received_retail_quantity,
        row.received_consumable_quantity,
        row.damaged_quantity,
        row.expired_quantity,
        row.short_quantity,
    ];
    if values.iter().any(|value| *value < 0)
        || row.received_retail_quantity > shipment.dispatched_retail_quantity
        || row.received_consumable_quantity > shipment.dispatched_consumable_quantity
        || values.iter().sum::<i32>()
            != shipment.dispatched_retail_quantity + shipment.dispatched_consumable_quantity
    {
        return Err(AppError::validation(
            "receipt quantities must exactly account for dispatched stock",
        ));
    }
    if (row.damaged_quantity + row.expired_quantity + row.short_quantity > 0)
        && row.variance_reason.trim().is_empty()
    {
        return Err(AppError::validation(
            "variance reason is required for mismatched receipt",
        ));
    }
    Ok(())
}

fn split_quantities(line: &TransferLineInput, usage: &str) -> Result<(i32, i32), AppError> {
    let (retail, consumable) = if line.retail_quantity + line.consumable_quantity > 0 {
        (line.retail_quantity, line.consumable_quantity)
    } else if let Some(quantity) = line.quantity {
        if usage == "consumable" {
            (0, quantity)
        } else {
            (quantity, 0)
        }
    } else {
        (0, 0)
    };
    if retail + consumable <= 0
        || (usage == "retail" && consumable > 0)
        || (usage == "consumable" && retail > 0)
    {
        return Err(AppError::validation(
            "retail and consumable quantities do not match product usage",
        ));
    }
    Ok((retail, consumable))
}

async fn resolve_branches(
    state: &AppState,
    tenant_id: &str,
    current_branch_id: &str,
    input: &TransferInput,
) -> Result<(String, String), AppError> {
    match input.mode.as_str() {
        "push" | "return" => Ok((
            input
                .source_branch_id
                .clone()
                .unwrap_or_else(|| current_branch_id.to_owned()),
            input
                .destination_branch_id
                .clone()
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| AppError::validation("destination branch is required"))?,
        )),
        "pull" => {
            let setting = center_setting(state, tenant_id, current_branch_id).await?;
            let mut needs_retail = false;
            let mut needs_consumable = false;
            for line in &input.lines {
                let usage = inventory_transfer_repository::item_usage(
                    &state.db,
                    tenant_id,
                    &line.source_inventory_item_id,
                )
                .await
                .map_err(|_| AppError::internal("failed to resolve pull product usage"))?
                .ok_or_else(|| {
                    AppError::validation("pull product is unavailable at this center")
                })?;
                needs_retail |= usage != "consumable" && line.retail_quantity > 0;
                needs_consumable |= usage != "retail" && line.consumable_quantity > 0;
                if line.quantity.is_some() {
                    needs_retail |= usage != "consumable";
                    needs_consumable |= usage == "consumable";
                }
            }
            let retail = needs_retail
                .then(|| setting.default_retail_warehouse_branch_id.clone())
                .flatten();
            let consumable = needs_consumable
                .then(|| setting.default_consumable_warehouse_branch_id.clone())
                .flatten();
            let default_source = match (retail, consumable) {
                (Some(retail), Some(consumable)) if retail != consumable => None,
                (Some(retail), _) => Some(retail),
                (_, Some(consumable)) => Some(consumable),
                _ => None,
            };
            Ok((
                input
                    .source_branch_id
                    .clone()
                    .filter(|id| !id.trim().is_empty())
                    .or(default_source)
                    .ok_or_else(|| AppError::validation("source warehouse is required"))?,
                current_branch_id.to_owned(),
            ))
        }
        "franchise_purchase" => Ok((
            match input
                .source_branch_id
                .clone()
                .filter(|id| !id.trim().is_empty())
            {
                Some(id) => id,
                None => {
                    inventory_transfer_repository::franchise_central_branch(&state.db, tenant_id)
                        .await
                        .map_err(|_| AppError::internal("failed to load franchise warehouse"))?
                        .ok_or_else(|| {
                            AppError::validation("franchise central warehouse is not configured")
                        })?
                }
            },
            current_branch_id.to_owned(),
        )),
        _ => Err(AppError::validation("transfer mode is invalid")),
    }
}

async fn lock_participant(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    transfer_id: &str,
) -> Result<InventoryTransfer, AppError> {
    let transfer = inventory_transfer_repository::get_for_update(tx, tenant_id, transfer_id)
        .await
        .map_err(|_| AppError::internal("failed to lock inventory transfer"))?
        .ok_or_else(|| AppError::not_found("inventory transfer was not found"))?;
    if transfer.source_branch_id != branch_id && transfer.destination_branch_id != branch_id {
        return Err(AppError::forbidden(
            "transfer does not belong to this branch",
        ));
    }
    Ok(transfer)
}

fn require_status(transfer: &InventoryTransfer, allowed: &[&str]) -> Result<(), AppError> {
    if allowed.contains(&transfer.status.as_str()) {
        Ok(())
    } else {
        Err(AppError::conflict(
            "transfer is not in an allowed lifecycle status",
        ))
    }
}

async fn transition(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    transfer: &InventoryTransfer,
    to: &str,
    actor: &str,
    note: &str,
) -> Result<(), AppError> {
    if !inventory_transfer_repository::transition(
        tx,
        tenant_id,
        &transfer.id,
        &transfer.status,
        to,
        actor,
        note,
    )
    .await
    .map_err(|_| AppError::internal("failed to update transfer lifecycle"))?
    {
        return Err(AppError::conflict(
            "transfer status changed; reload and try again",
        ));
    }
    inventory_transfer_repository::add_event(
        tx,
        tenant_id,
        &transfer.id,
        to,
        &transfer.status,
        to,
        actor,
        note,
        &json!({}),
    )
    .await
    .map_err(|_| AppError::internal("failed to record transfer lifecycle event"))
}

fn checked_add_money(left: i64, right: i64) -> Result<i64, AppError> {
    left.checked_add(right)
        .ok_or_else(|| AppError::validation("transfer value exceeds supported range"))
}

async fn enforce_inventory_open(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_ids: &[&str],
) -> Result<(), AppError> {
    let today = Utc::now().date_naive();
    for branch_id in branch_ids {
        let policy = purchase_repository::inventory_receipt_policy(tx, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load inventory financial lock"))?;
        if policy.financial_lock_date.is_some_and(|date| today <= date) {
            return Err(AppError::conflict(
                "transfer date is inside the inventory financial lock period",
            ));
        }
    }
    Ok(())
}

async fn post_dispatch_journal(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    shipment_id: &str,
    actor: &str,
    cost_paise: i64,
    reverse: bool,
) -> Result<(), AppError> {
    if cost_paise == 0 {
        return Ok(());
    }
    let (debit, credit, source_type, memo) = if reverse {
        (
            "INVENTORY_ASSET",
            "INVENTORY_IN_TRANSIT",
            "inventory_transfer_dispatch_cancel",
            "Cancelled transfer shipment restored",
        )
    } else {
        (
            "INVENTORY_IN_TRANSIT",
            "INVENTORY_ASSET",
            "inventory_transfer_dispatch",
            "Inventory transfer shipment dispatched",
        )
    };
    accounting_service::post_control_journal(
        tx,
        tenant_id,
        branch_id,
        source_type,
        shipment_id,
        Utc::now().date_naive(),
        memo,
        actor,
        &[
            ManualJournalLine {
                account_code: debit.to_owned(),
                debit_paise: cost_paise,
                credit_paise: 0,
            },
            ManualJournalLine {
                account_code: credit.to_owned(),
                debit_paise: 0,
                credit_paise: cost_paise,
            },
        ],
    )
    .await
    .map(|_| ())
}

#[allow(clippy::too_many_arguments)]
async fn post_transfer_journals(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    transfer: &InventoryTransfer,
    shipment: &InventoryTransferShipment,
    actor: &str,
    source_cost: i64,
    taxable: i64,
    charges: i64,
    landed_charges: i64,
    cgst: i64,
    sgst: i64,
    igst: i64,
) -> Result<(), AppError> {
    let tax = checked_add_money(checked_add_money(cgst, sgst)?, igst)?;
    let consideration = checked_add_money(taxable, charges)?;
    let due = checked_add_money(consideration, tax)?;
    if source_cost == 0 && due == 0 {
        return Ok(());
    }
    let margin = consideration - source_cost;
    let mut source_lines = vec![
        ManualJournalLine {
            account_code: "INTERBRANCH_RECEIVABLE".to_owned(),
            debit_paise: due,
            credit_paise: 0,
        },
        ManualJournalLine {
            account_code: "INVENTORY_IN_TRANSIT".to_owned(),
            debit_paise: 0,
            credit_paise: source_cost,
        },
    ];
    if margin >= 0 {
        source_lines.push(ManualJournalLine {
            account_code: "INTERBRANCH_TRANSFER_MARGIN".to_owned(),
            debit_paise: 0,
            credit_paise: margin,
        });
    } else {
        source_lines.push(ManualJournalLine {
            account_code: "INVENTORY_TRANSFER_VARIANCE".to_owned(),
            debit_paise: -margin,
            credit_paise: 0,
        });
    }
    for (account, amount) in [
        ("OUTPUT_CGST", cgst),
        ("OUTPUT_SGST", sgst),
        ("OUTPUT_IGST", igst),
    ] {
        if amount > 0 {
            source_lines.push(ManualJournalLine {
                account_code: account.to_owned(),
                debit_paise: 0,
                credit_paise: amount,
            });
        }
    }
    accounting_service::post_control_journal(
        tx,
        tenant_id,
        &transfer.source_branch_id,
        "inventory_transfer_out",
        &shipment.id,
        Utc::now().date_naive(),
        "Inventory transfer shipment receipt",
        actor,
        &source_lines,
    )
    .await?;
    if due > 0 {
        let mut destination_lines = vec![
            ManualJournalLine {
                account_code: "INVENTORY_ASSET".to_owned(),
                debit_paise: checked_add_money(taxable, landed_charges)?,
                credit_paise: 0,
            },
            ManualJournalLine {
                account_code: "INTERBRANCH_PAYABLE".to_owned(),
                debit_paise: 0,
                credit_paise: due,
            },
        ];
        if charges > landed_charges {
            destination_lines.push(ManualJournalLine {
                account_code: "INVENTORY_TRANSFER_VARIANCE".to_owned(),
                debit_paise: charges - landed_charges,
                credit_paise: 0,
            });
        }
        for (account, amount) in [
            ("INPUT_CGST", cgst),
            ("INPUT_SGST", sgst),
            ("INPUT_IGST", igst),
        ] {
            if amount > 0 {
                destination_lines.push(ManualJournalLine {
                    account_code: account.to_owned(),
                    debit_paise: amount,
                    credit_paise: 0,
                });
            }
        }
        accounting_service::post_control_journal(
            tx,
            tenant_id,
            &transfer.destination_branch_id,
            "inventory_transfer_in",
            &shipment.id,
            Utc::now().date_naive(),
            "Inventory transfer shipment receipt",
            actor,
            &destination_lines,
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_must_account_for_dispatched_quantity() {
        let shipment = InventoryTransferShipmentLine {
            id: "s".into(),
            shipment_id: "h".into(),
            transfer_line_id: "t".into(),
            dispatched_retail_quantity: 5,
            dispatched_consumable_quantity: 0,
            received_retail_quantity: 0,
            received_consumable_quantity: 0,
            damaged_quantity: 0,
            expired_quantity: 0,
            short_quantity: 0,
            variance_reason: String::new(),
            source_unit_cost_paise: 100,
            transfer_unit_price_paise: 100,
            discount_bps: 0,
            gst_percent: 0,
            taxable_paise: 0,
            cgst_paise: 0,
            sgst_paise: 0,
            igst_paise: 0,
            landed_cost_paise: 0,
            landed_unit_cost_paise: 0,
            source_stock_ledger_id: None,
            destination_stock_ledger_id: None,
        };
        let bad = ShipmentReceiptLineInput {
            shipment_line_id: "s".into(),
            received_retail_quantity: 4,
            received_consumable_quantity: 0,
            damaged_quantity: 0,
            expired_quantity: 0,
            short_quantity: 0,
            variance_reason: String::new(),
        };
        assert!(validate_receipt_line(&shipment, &bad).is_err());
    }
}
