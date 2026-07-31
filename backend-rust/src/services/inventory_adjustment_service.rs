use serde_json::Value;
use sqlx::{Postgres, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::{
    models::common::AppError,
    repositories::inventory_repository::{self, InventoryRecord, UpdateInventory},
    state::AppState,
};

pub struct InventoryUpdateInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub sku: Option<&'a str>,
    pub name: Option<&'a str>,
    pub category: Option<&'a str>,
    pub brand: Option<&'a str>,
    pub unit: Option<&'a str>,
    pub package_unit: Option<&'a str>,
    pub units_per_package: Option<i32>,
    pub stock_quantity: Option<i32>,
    pub reorder_point: Option<i32>,
    pub unit_cost_paise: Option<i64>,
    pub hsn_code: Option<&'a str>,
    pub gst_percent: Option<i32>,
    pub barcode: Option<&'a str>,
    pub batch_tracked: Option<bool>,
    pub dual_use_stock: Option<bool>,
    pub active: Option<bool>,
    pub adjustment_reason: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
}

pub struct BackbarUsageInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub inventory_item_id: &'a str,
    pub service_id: Option<&'a str>,
    pub staff_id: Option<&'a str>,
    pub client_id: Option<&'a str>,
    pub appointment_id: Option<&'a str>,
    pub actual_quantity: i32,
    pub notes: &'a str,
    pub actor_user_id: &'a str,
    pub idempotency_key: &'a str,
}

pub struct BackbarReviewInput<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub usage_id: &'a str,
    pub decision: &'a str,
    pub review_note: &'a str,
    pub actor_user_id: &'a str,
}

pub struct KitComponentInput {
    pub inventory_item_id: String,
    pub quantity: i32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitAssemblyResult {
    pub id: String,
    pub kit_inventory_item_id: String,
    pub quantity: i32,
    pub stock_quantity: i32,
}

#[derive(Debug, PartialEq)]
struct RecipeUsagePolicy {
    expected_quantity: i32,
    max_quantity: i32,
    wastage_percent: f64,
    approval_threshold_percent: f64,
    approval_required: bool,
}

pub async fn record_backbar_usage(
    state: &AppState,
    input: BackbarUsageInput<'_>,
) -> Result<inventory_repository::BackbarUsageRecord, AppError> {
    validate_backbar(&input)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start backbar usage"))?;
    if let Some(existing) = inventory_repository::backbar_usage_by_key(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to read backbar usage replay"))?
    {
        if existing.inventory_item_id != input.inventory_item_id
            || existing.service_id.as_deref() != input.service_id
            || existing.staff_id.as_deref() != input.staff_id
            || existing.client_id.as_deref() != input.client_id
            || existing.appointment_id.as_deref() != input.appointment_id
            || existing.actual_quantity != i64::from(input.actual_quantity)
        {
            return Err(AppError::conflict(
                "idempotencyKey is already used by different backbar usage",
            ));
        }
        tx.rollback().await.ok();
        return Ok(existing);
    }
    let item = inventory_repository::lock_for_adjustment(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock inventory item"))?
    .filter(|item| item.active)
    .ok_or_else(|| AppError::validation("inventory item is not available"))?;
    if item.dual_use_stock {
        return Err(AppError::validation(
            "dual-use backbar consumption must be posted against the open container",
        ));
    }
    if item.stock_quantity < input.actual_quantity {
        return Err(AppError::validation(
            "insufficient inventory for backbar usage",
        ));
    }
    if let Some(staff_id) = input.staff_id {
        let exists = inventory_repository::active_staff_exists(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            staff_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate staff"))?;
        if !exists {
            return Err(AppError::validation("staff is not available"));
        }
    }
    if input.appointment_id.is_some() && input.client_id.is_none() {
        return Err(AppError::validation(
            "clientId is required with appointmentId",
        ));
    }
    if input.appointment_id.is_some() && (input.service_id.is_none() || input.staff_id.is_none()) {
        return Err(AppError::validation(
            "serviceId and staffId are required with appointmentId",
        ));
    }
    if let Some(client_id) = input.client_id {
        let exists = inventory_repository::client_attribution_exists(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            client_id,
            input.appointment_id,
            input.service_id,
            input.staff_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate client attribution"))?;
        if !exists {
            return Err(AppError::validation(
                "client or appointment is not available",
            ));
        }
    }
    let policy = if let Some(service_id) = input.service_id {
        let recipe = inventory_repository::service_recipe(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            service_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load service recipe"))?
        .ok_or_else(|| AppError::validation("service is not available"))?;
        recipe_usage_policy(&recipe, input.inventory_item_id, input.actual_quantity)?
    } else {
        RecipeUsagePolicy {
            expected_quantity: 0,
            max_quantity: 0,
            wastage_percent: 0.0,
            approval_threshold_percent: 0.0,
            approval_required: false,
        }
    };
    if policy.wastage_percent > 0.0 && input.notes.trim().is_empty() {
        return Err(AppError::validation(
            "wastage reason is required when actual quantity exceeds the recipe maximum",
        ));
    }
    let stock_after = item.stock_quantity - input.actual_quantity;
    let usage_id = Uuid::new_v4().to_string();
    let status = if policy.approval_required {
        "pending_approval"
    } else {
        "recorded"
    };
    inventory_repository::insert_backbar_usage(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        &usage_id,
        input.inventory_item_id,
        input.service_id,
        input.staff_id,
        input.client_id,
        input.appointment_id,
        &item.unit,
        policy.expected_quantity,
        input.actual_quantity,
        policy.max_quantity,
        policy.wastage_percent,
        policy.approval_threshold_percent,
        status,
        input.notes.trim(),
        input.actor_user_id,
        input.idempotency_key,
    )
    .await
    .map_err(map_backbar_error)?;
    if !policy.approval_required {
        inventory_repository::apply_adjusted_stock(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to update backbar stock"))?;
        let ledger_id = inventory_repository::add_backbar_ledger(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            input.inventory_item_id,
            &usage_id,
            input.actual_quantity,
            item.unit_cost_paise,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to write backbar ledger"))?;
        allocate_fefo_batches(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &item,
            &ledger_id,
            input.actual_quantity,
        )
        .await?;
    }
    let saved = inventory_repository::backbar_usage_by_key(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to load saved backbar usage"))?
    .ok_or_else(|| AppError::internal("saved backbar usage was not found"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit backbar usage"))?;
    Ok(saved)
}

pub async fn review_backbar_usage(
    state: &AppState,
    input: BackbarReviewInput<'_>,
) -> Result<inventory_repository::BackbarUsageRecord, AppError> {
    if !matches!(input.decision, "approve" | "reject") {
        return Err(AppError::validation("decision must be approve or reject"));
    }
    if input.review_note.trim().len() > 500
        || (input.decision == "reject" && input.review_note.trim().is_empty())
    {
        return Err(AppError::validation(
            "a rejection reason is required and reviewNote must be at most 500 characters",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start backbar review"))?;
    let usage = inventory_repository::lock_backbar_usage_for_review(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock backbar usage"))?
    .ok_or_else(|| AppError::not_found("backbar usage was not found"))?;
    if (usage.status == "recorded" && input.decision == "approve")
        || (usage.status == "rejected" && input.decision == "reject")
    {
        let saved = inventory_repository::backbar_usage_by_id(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            input.usage_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to load reviewed backbar usage"))?
        .ok_or_else(|| AppError::internal("reviewed backbar usage was not found"))?;
        tx.rollback().await.ok();
        return Ok(saved);
    }
    if usage.status != "pending_approval" {
        return Err(AppError::conflict("backbar usage is not pending approval"));
    }
    enforce_distinct_backbar_reviewer(&usage.actor_user_id, input.actor_user_id)?;
    let status = if input.decision == "approve" {
        let item = inventory_repository::lock_for_adjustment(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &usage.inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock inventory item"))?
        .filter(|item| item.active)
        .ok_or_else(|| AppError::validation("inventory item is not available"))?;
        if item.dual_use_stock {
            return Err(AppError::validation(
                "dual-use backbar consumption must be posted against the open container",
            ));
        }
        if item.stock_quantity < usage.actual_quantity {
            return Err(AppError::validation(
                "insufficient inventory for approved backbar usage",
            ));
        }
        let stock_after = item.stock_quantity - usage.actual_quantity;
        inventory_repository::apply_adjusted_stock(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &usage.inventory_item_id,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to update approved backbar stock"))?;
        let ledger_id = inventory_repository::add_backbar_ledger(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &usage.inventory_item_id,
            &usage.id,
            usage.actual_quantity,
            item.unit_cost_paise,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to write approved backbar ledger"))?;
        allocate_fefo_batches(
            &mut tx,
            input.tenant_id,
            input.branch_id,
            &item,
            &ledger_id,
            usage.actual_quantity,
        )
        .await?;
        "recorded"
    } else {
        "rejected"
    };
    if !inventory_repository::review_backbar_usage(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
        status,
        input.actor_user_id,
        input.review_note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to save backbar review"))?
    {
        return Err(AppError::conflict(
            "backbar usage is no longer pending approval",
        ));
    }
    let saved = inventory_repository::backbar_usage_by_id(
        &mut tx,
        input.tenant_id,
        input.branch_id,
        input.usage_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load reviewed backbar usage"))?
    .ok_or_else(|| AppError::internal("reviewed backbar usage was not found"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit backbar review"))?;
    Ok(saved)
}

fn recipe_usage_policy(
    recipe: &str,
    inventory_item_id: &str,
    actual_quantity: i32,
) -> Result<RecipeUsagePolicy, AppError> {
    let entries = serde_json::from_str::<Value>(recipe)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let entry = entries
        .iter()
        .find(|entry| {
            ["itemId", "productId", "inventoryItemId"]
                .iter()
                .find_map(|key| entry.get(*key).and_then(Value::as_str))
                .is_some_and(|id| id.trim() == inventory_item_id)
        })
        .ok_or_else(|| {
            AppError::validation("selected product is not part of the service recipe")
        })?;
    let expected: i32 = ["standardQty", "quantity", "qty"]
        .iter()
        .find_map(|key| entry.get(*key))
        .and_then(recipe_quantity)
        .ok_or_else(|| AppError::validation("service inventory recipe contains an invalid item"))?
        .try_into()
        .map_err(|_| AppError::validation("recipe quantity is too large"))?;
    let waste_allowance = recipe_number(entry.get("wastePercent"))
        .unwrap_or(0.0)
        .clamp(0.0, 100.0);
    let configured_max = entry
        .get("maxQty")
        .and_then(recipe_nonnegative_quantity)
        .unwrap_or(0);
    let max_quantity = if configured_max > 0 {
        configured_max
            .try_into()
            .map_err(|_| AppError::validation("recipe maximum is too large"))?
    } else {
        (f64::from(expected) * (1.0 + waste_allowance / 100.0)).ceil() as i32
    };
    let wastage_percent = if actual_quantity > max_quantity && max_quantity > 0 {
        (f64::from(actual_quantity - max_quantity) / f64::from(max_quantity)) * 100.0
    } else {
        0.0
    };
    let approval_threshold_percent = recipe_number(entry.get("ownerApprovalPercent"))
        .unwrap_or(25.0)
        .clamp(0.0, 100.0);
    let variance_percent = if actual_quantity > expected && expected > 0 {
        (f64::from(actual_quantity - expected) / f64::from(expected)) * 100.0
    } else {
        0.0
    };
    Ok(RecipeUsagePolicy {
        expected_quantity: expected,
        max_quantity,
        wastage_percent,
        approval_threshold_percent,
        approval_required: variance_percent > approval_threshold_percent,
    })
}

fn enforce_distinct_backbar_reviewer(
    requested_by: &str,
    reviewed_by: &str,
) -> Result<(), AppError> {
    if requested_by == reviewed_by {
        return Err(AppError::forbidden(
            "backbar usage requester cannot approve their own variance",
        ));
    }
    Ok(())
}

fn recipe_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
        .filter(|number| number.is_finite() && *number >= 0.0)
}

fn recipe_nonnegative_quantity(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|number| number.fract() == 0.0)
                .map(|number| number as i64)
        })
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .filter(|quantity| *quantity >= 0)
}

pub fn recipe_quantities(recipe: &str) -> Result<HashMap<String, i64>, AppError> {
    let entries = serde_json::from_str::<Value>(recipe)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let mut quantities = HashMap::new();
    for entry in entries {
        let item_id = ["itemId", "productId", "inventoryItemId"]
            .iter()
            .find_map(|key| entry.get(*key).and_then(Value::as_str))
            .unwrap_or("")
            .trim();
        let quantity = ["quantity", "qty", "standardQty"]
            .iter()
            .find_map(|key| entry.get(*key))
            .and_then(recipe_quantity)
            .unwrap_or(0);
        if item_id.is_empty() || quantity <= 0 {
            return Err(AppError::validation(
                "service inventory recipe contains an invalid item",
            ));
        }
        quantities
            .entry(item_id.to_string())
            .and_modify(|current: &mut i64| *current = current.saturating_add(quantity))
            .or_insert(quantity);
    }
    Ok(quantities)
}

pub async fn consume_pos_sale(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<i64, AppError> {
    let lines = sqlx::query_as::<_, (String, String, String, i64)>(
        "SELECT id,line_type,item_id,quantity FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load sale lines for inventory"))?;
    let recipe_required = sqlx::query_scalar::<_, bool>(
        "SELECT COALESCE(settings_json #> '{recipeInventory,requireRecipeForService}','false'::JSONB)='true'::JSONB FROM service_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load POS recipe policy"))?
    .unwrap_or(false);
    let mut moved = 0;
    for (line_id, line_type, item_id, line_quantity) in lines {
        let quantities = match line_type.as_str() {
            "product" => {
                if item_id.trim().is_empty() {
                    return Err(AppError::validation(
                        "product sale line requires an inventory item id",
                    ));
                }
                HashMap::from([(item_id, line_quantity)])
            }
            "service" if !item_id.trim().is_empty() => {
                pos_service_recipe(
                    tx,
                    tenant_id,
                    branch_id,
                    &item_id,
                    line_quantity,
                    recipe_required,
                )
                .await?
            }
            "service" if recipe_required => {
                return Err(AppError::validation(
                    "service sale line requires a service id when recipes are required",
                ));
            }
            _ => HashMap::new(),
        };
        for (inventory_item_id, quantity) in quantities {
            let quantity = i32::try_from(quantity)
                .ok()
                .filter(|quantity| *quantity > 0)
                .ok_or_else(|| AppError::validation("inventory consumption quantity is invalid"))?;
            if deduct_pos_inventory_item(
                tx,
                tenant_id,
                branch_id,
                sale_id,
                &line_id,
                &inventory_item_id,
                quantity,
            )
            .await?
            {
                moved += 1;
            }
        }
    }
    Ok(moved)
}

#[allow(clippy::too_many_arguments)]
pub async fn restock_pos_product_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    refund_id: &str,
    sale_line_id: &str,
    line_type: &str,
    inventory_item_id: &str,
    quantity: i64,
) -> Result<(), AppError> {
    let quantity = i32::try_from(quantity)
        .ok()
        .filter(|quantity| *quantity > 0)
        .filter(|_| line_type == "product" && !inventory_item_id.trim().is_empty())
        .ok_or_else(|| AppError::validation("only valid product return lines can be restocked"))?;
    let sale_movement = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT id,inventory_item_id,unit_cost_paise FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .bind(sale_line_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to validate product inventory movement"))?
    .ok_or_else(|| {
        AppError::validation("product line was not deducted from inventory and cannot be restocked")
    })?;
    if sale_movement.1 != inventory_item_id {
        return Err(AppError::internal(
            "product return inventory reference mismatch",
        ));
    }
    let item =
        inventory_repository::lock_for_adjustment(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock returned inventory item"))?
            .ok_or_else(|| AppError::not_found("returned inventory item was not found"))?;
    let stock_after = item
        .stock_quantity
        .checked_add(quantity)
        .ok_or_else(|| AppError::validation("returned inventory quantity is too large"))?;
    let created = sqlx::query_scalar::<_, String>(
        "INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,refund_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,$6,'return',$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_id)
    .bind(sale_line_id)
    .bind(refund_id)
    .bind(quantity)
    .bind(sale_movement.2)
    .bind(stock_after)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to write inventory return ledger"))?;
    if let Some(return_ledger_id) = created {
        sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(inventory_item_id)
            .bind(stock_after)
            .execute(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to restock returned product"))?;
        if item.batch_tracked {
            restore_sale_batches(
                tx,
                tenant_id,
                branch_id,
                &sale_movement.0,
                &return_ledger_id,
                quantity,
            )
            .await?;
        }
    }
    Ok(())
}

async fn pos_service_recipe(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    service_id: &str,
    service_quantity: i64,
    recipe_required: bool,
) -> Result<HashMap<String, i64>, AppError> {
    let recipe = sqlx::query_scalar::<_, String>(
        "SELECT product_consumption_json::TEXT FROM services WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(service_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to load service inventory recipe"))?;
    let quantities = recipe
        .as_deref()
        .map(recipe_quantities)
        .transpose()?
        .unwrap_or_default();
    enforce_pos_recipe(recipe_required, &quantities)?;
    Ok(quantities
        .into_iter()
        .map(|(item_id, quantity)| (item_id, service_quantity.saturating_mul(quantity)))
        .collect())
}

fn enforce_pos_recipe(
    recipe_required: bool,
    quantities: &HashMap<String, i64>,
) -> Result<(), AppError> {
    if recipe_required && quantities.is_empty() {
        return Err(AppError::validation(
            "service recipe is required by Service Settings before POS checkout",
        ));
    }
    Ok(())
}

async fn deduct_pos_inventory_item(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    sale_line_id: &str,
    inventory_item_id: &str,
    quantity: i32,
) -> Result<bool, AppError> {
    let existing = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_line_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to read inventory ledger"))?;
    if existing.is_some() {
        return Ok(false);
    }
    let item =
        inventory_repository::lock_for_adjustment(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory item"))?
            .filter(|item| item.active)
            .ok_or_else(|| {
                AppError::validation("inventory item is not available for POS consumption")
            })?;
    let already_posted = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND sale_line_id=$4 AND movement_type='sale'",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_line_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to recheck inventory ledger"))?;
    if already_posted.is_some() {
        return Ok(false);
    }
    if item.stock_quantity < quantity {
        return Err(AppError::validation(
            "insufficient inventory for POS checkout",
        ));
    }
    let stock_after = item.stock_quantity - quantity;
    let ledger_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,sale_id,sale_line_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity) VALUES($1,$2,$3,$4,$5,'sale',$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(inventory_item_id)
    .bind(sale_id)
    .bind(sale_line_id)
    .bind(-quantity)
    .bind(item.unit_cost_paise)
    .bind(stock_after)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to write inventory ledger"))?;
    let Some(ledger_id) = ledger_id else {
        return Ok(false);
    };
    allocate_fefo_batches(tx, tenant_id, branch_id, &item, &ledger_id, quantity).await?;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(inventory_item_id)
        .bind(stock_after)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to deduct inventory"))?;
    Ok(true)
}

fn recipe_quantity(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| {
            value.as_f64().and_then(|number| {
                (number.is_finite()
                    && number.fract() == 0.0
                    && number > 0.0
                    && number <= i64::MAX as f64)
                    .then_some(number as i64)
            })
        })
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .filter(|quantity| *quantity > 0)
}

fn validate_backbar(input: &BackbarUsageInput<'_>) -> Result<(), AppError> {
    if input.inventory_item_id.trim().is_empty() || input.actual_quantity <= 0 {
        return Err(AppError::validation(
            "inventoryItemId and positive actualQuantity are required",
        ));
    }
    if input
        .service_id
        .is_some_and(|value| value.trim().is_empty())
        || input.staff_id.is_some_and(|value| value.trim().is_empty())
    {
        return Err(AppError::validation(
            "serviceId and staffId cannot be blank",
        ));
    }
    if input.notes.trim().len() > 500 {
        return Err(AppError::validation("notes must be at most 500 characters"));
    }
    if input.idempotency_key.trim().is_empty() || input.idempotency_key.trim().len() > 120 {
        return Err(AppError::validation(
            "idempotencyKey must contain 1 to 120 characters",
        ));
    }
    Ok(())
}

fn map_backbar_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .is_some_and(|code| code == "23505")
    {
        AppError::conflict("idempotencyKey is already used by another backbar usage")
    } else {
        AppError::internal("failed to save backbar usage")
    }
}

#[cfg(test)]
mod recipe_tests {
    use super::{
        enforce_distinct_backbar_reviewer, enforce_pos_recipe, recipe_quantities,
        recipe_usage_policy,
    };
    use std::collections::HashMap;

    #[test]
    fn reads_saved_standard_quantity_and_legacy_aliases() {
        let rows =
            recipe_quantities(r#"[{"productId":"a","standardQty":2.0},{"itemId":"b","qty":"3"}]"#)
                .expect("recipe should parse");
        assert_eq!(rows.get("a"), Some(&2));
        assert_eq!(rows.get("b"), Some(&3));
        assert!(recipe_quantities(r#"[{"productId":"a","standardQty":1.5}]"#).is_err());
    }

    #[test]
    fn routes_excess_wastage_to_owner_approval() {
        let recipe = r#"[{"productId":"a","standardQty":10,"maxQty":12,"wastePercent":5,"ownerApprovalPercent":20}]"#;
        let within_limit = recipe_usage_policy(recipe, "a", 12).expect("policy should parse");
        assert!(!within_limit.approval_required);
        assert_eq!(within_limit.wastage_percent, 0.0);

        let excessive = recipe_usage_policy(recipe, "a", 15).expect("policy should parse");
        assert!(excessive.approval_required);
        assert_eq!(excessive.max_quantity, 12);
        assert_eq!(excessive.wastage_percent, 25.0);
    }

    #[test]
    fn approval_uses_expected_variance_and_enforces_maker_checker() {
        let recipe =
            r#"[{"productId":"a","standardQty":10,"maxQty":12,"ownerApprovalPercent":20}]"#;
        assert!(
            recipe_usage_policy(recipe, "a", 13)
                .expect("policy should parse")
                .approval_required
        );
        assert!(enforce_distinct_backbar_reviewer("stylist-1", "stylist-1").is_err());
        assert!(enforce_distinct_backbar_reviewer("stylist-1", "manager-1").is_ok());
    }

    #[test]
    fn pos_blocks_only_when_saved_settings_require_a_recipe() {
        let empty = HashMap::new();
        assert!(enforce_pos_recipe(false, &empty).is_ok());
        assert!(enforce_pos_recipe(true, &empty).is_err());
        assert!(enforce_pos_recipe(true, &HashMap::from([("item".into(), 1)])).is_ok());
    }
}

pub async fn update(
    state: &AppState,
    input: InventoryUpdateInput<'_>,
) -> Result<Option<InventoryRecord>, AppError> {
    validate(&input)?;
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start inventory adjustment"))?;
    let result = update_in_tx(&mut tx, &input).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit inventory adjustment"))?;
    Ok(result)
}

async fn update_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    input: &InventoryUpdateInput<'_>,
) -> Result<Option<InventoryRecord>, AppError> {
    let current =
        inventory_repository::lock_for_adjustment(tx, input.tenant_id, input.branch_id, input.id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory item"))?;
    let Some(current) = current else {
        return Ok(None);
    };

    let override_context = inventory_repository::franchise_override_context(
        tx,
        input.tenant_id,
        input.branch_id,
        input.id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load product override policy"))?;
    let mut changed_master_fields = Vec::new();
    if let Some((Some(_), _, allowed_fields)) = &override_context {
        let candidates = [
            (
                "sku",
                input.sku.is_some_and(|value| value != current.sku.as_str()),
            ),
            (
                "name",
                input
                    .name
                    .is_some_and(|value| value != current.name.as_str()),
            ),
            (
                "category",
                input
                    .category
                    .is_some_and(|value| value != current.category.as_str()),
            ),
            (
                "unit",
                input
                    .unit
                    .is_some_and(|value| value != current.unit.as_str()),
            ),
            (
                "packageUnit",
                input
                    .package_unit
                    .is_some_and(|value| value != current.package_unit.as_str()),
            ),
            (
                "unitsPerPackage",
                input
                    .units_per_package
                    .is_some_and(|value| value != current.units_per_package),
            ),
            (
                "hsnCode",
                input
                    .hsn_code
                    .is_some_and(|value| value != current.hsn_code.as_str()),
            ),
            (
                "gstPercent",
                input
                    .gst_percent
                    .is_some_and(|value| value != current.gst_percent),
            ),
            (
                "barcode",
                input
                    .barcode
                    .is_some_and(|value| value != current.barcode.as_str()),
            ),
            (
                "batchTracked",
                input
                    .batch_tracked
                    .is_some_and(|value| value != current.batch_tracked),
            ),
            (
                "active",
                input.active.is_some_and(|value| value != current.active),
            ),
        ];
        for (field, changed) in candidates {
            if !changed {
                continue;
            }
            if !allowed_fields.iter().any(|allowed| allowed == field) {
                return Err(AppError::forbidden(format!(
                    "{field} is controlled by the central product master"
                )));
            }
            changed_master_fields.push(field.to_string());
        }
    }

    if input.unit.is_some_and(|value| value != current.unit) && current.stock_quantity != 0 {
        return Err(AppError::conflict(
            "stock unit can change only when stock is zero",
        ));
    }

    if input.batch_tracked != Some(current.batch_tracked) {
        if current.stock_quantity != 0 {
            return Err(AppError::conflict(
                "batch tracking can change only when stock is zero",
            ));
        }
        if input.batch_tracked == Some(true)
            && inventory_repository::has_kit_components(
                tx,
                input.tenant_id,
                input.branch_id,
                input.id,
            )
            .await
            .map_err(|_| AppError::internal("failed to validate kit tracking"))?
        {
            return Err(AppError::conflict(
                "assembled kits cannot use batch tracking",
            ));
        }
    }

    let idempotency_key = input.idempotency_key.unwrap_or_default().trim();
    if let Some(target) = input.stock_quantity {
        if !idempotency_key.is_empty() {
            if let Some((item_id, stock_after)) = inventory_repository::adjustment_replay(
                tx,
                input.tenant_id,
                input.branch_id,
                idempotency_key,
            )
            .await
            .map_err(|_| AppError::internal("failed to read inventory adjustment replay"))?
            {
                if item_id != input.id || stock_after != target {
                    return Err(AppError::conflict(
                        "idempotencyKey is already used by a different inventory adjustment",
                    ));
                }
                return Ok(Some(current));
            }
        }

        if current.stock_quantity != target {
            let quantity_delta = target.checked_sub(current.stock_quantity).ok_or_else(|| {
                AppError::validation("inventory adjustment exceeds supported range")
            })?;
            if current.batch_tracked && quantity_delta > 0 {
                return Err(AppError::conflict(
                    "batch-tracked stock must be received through a GRN",
                ));
            }
            inventory_repository::apply_adjusted_stock(
                tx,
                input.tenant_id,
                input.branch_id,
                input.id,
                target,
            )
            .await
            .map_err(|_| AppError::internal("failed to apply inventory adjustment"))?;
            let ledger_id = inventory_repository::add_adjustment_ledger(
                tx,
                input.tenant_id,
                input.branch_id,
                input.id,
                quantity_delta,
                input.unit_cost_paise.unwrap_or(current.unit_cost_paise),
                target,
                input
                    .adjustment_reason
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("Manual stock adjustment"),
                idempotency_key,
            )
            .await
            .map_err(map_ledger_error)?;
            if quantity_delta < 0 {
                allocate_fefo_batches(
                    tx,
                    input.tenant_id,
                    input.branch_id,
                    &current,
                    &ledger_id,
                    quantity_delta.saturating_abs(),
                )
                .await?;
            }
        }
    }

    let updated = inventory_repository::update(
        tx,
        UpdateInventory {
            tenant_id: input.tenant_id,
            branch_id: input.branch_id,
            id: input.id,
            sku: input.sku,
            name: input.name,
            category: input.category,
            brand: input.brand,
            unit: input.unit,
            package_unit: input.package_unit,
            units_per_package: input.units_per_package,
            reorder_point: input.reorder_point,
            unit_cost_paise: input.unit_cost_paise,
            hsn_code: input.hsn_code,
            gst_percent: input.gst_percent,
            barcode: input.barcode,
            batch_tracked: input.batch_tracked,
            dual_use_stock: input.dual_use_stock,
            active: input.active,
        },
    )
    .await
    .map_err(|error| match error {
        sqlx::Error::Database(ref database) if database.code().as_deref() == Some("23514") => {
            AppError::validation("retail stock cannot be lower than sealed backbar stock")
        }
        _ => AppError::internal("failed to update inventory item"),
    })?;
    inventory_repository::record_franchise_overrides(
        tx,
        input.tenant_id,
        input.branch_id,
        input.id,
        &changed_master_fields,
    )
    .await
    .map_err(|_| AppError::internal("failed to record product override"))?;
    Ok(updated)
}

pub async fn record_batch_receipt(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_tracked: bool,
    batch_number: &str,
    barcode: &str,
    expiry_date: Option<chrono::NaiveDate>,
    received_date: chrono::NaiveDate,
    quantity: i32,
    unit_cost_paise: i64,
    stock_ledger_id: &str,
) -> Result<(), AppError> {
    if !batch_tracked {
        if !batch_number.trim().is_empty() || expiry_date.is_some() {
            return Err(AppError::validation(
                "enable batch tracking before adding batch details",
            ));
        }
        return Ok(());
    }
    let batch_number = batch_number.trim();
    if batch_number.is_empty() || batch_number.len() > 120 {
        return Err(AppError::validation(
            "batchNumber is required and must be at most 120 characters",
        ));
    }
    if expiry_date.is_some_and(|date| date < received_date) {
        return Err(AppError::validation(
            "expiryDate cannot be before receivedDate",
        ));
    }
    let batch_id = inventory_repository::upsert_batch(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        batch_number,
        barcode.trim(),
        expiry_date,
        received_date,
        quantity,
        unit_cost_paise,
    )
    .await
    .map_err(|_| AppError::conflict("batch number or barcode conflicts with existing stock"))?;
    inventory_repository::add_batch_movement(
        tx,
        tenant_id,
        branch_id,
        &batch_id,
        stock_ledger_id,
        quantity,
    )
    .await
    .map_err(|_| AppError::internal("failed to write batch movement"))
}

pub async fn allocate_fefo_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    item: &InventoryRecord,
    stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    allocate_fefo_quantity(
        tx,
        tenant_id,
        branch_id,
        &item.id,
        item.batch_tracked,
        stock_ledger_id,
        quantity,
    )
    .await
}

pub async fn allocate_fefo_quantity(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_tracked: bool,
    stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    if !batch_tracked {
        return Ok(());
    }
    let batches =
        inventory_repository::lock_fefo_batches(tx, tenant_id, branch_id, inventory_item_id)
            .await
            .map_err(|_| AppError::internal("failed to lock inventory batches"))?;
    let plan = fefo_plan(
        &batches
            .iter()
            .map(|batch| batch.quantity)
            .collect::<Vec<_>>(),
        quantity,
    )
    .ok_or_else(|| AppError::conflict("non-expired batch stock is insufficient"))?;
    for (batch, used) in batches.iter().zip(plan).filter(|(_, used)| *used > 0) {
        inventory_repository::set_batch_quantity(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            batch.quantity - used,
        )
        .await
        .map_err(|_| AppError::internal("failed to update inventory batch"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            stock_ledger_id,
            -used,
        )
        .await
        .map_err(|_| AppError::internal("failed to write FEFO batch allocation"))?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn receive_transfer_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    source_branch_id: &str,
    destination_branch_id: &str,
    source_item_id: &str,
    destination_item_id: &str,
    transfer_line_id: &str,
    destination_stock_ledger_id: &str,
) -> Result<(), AppError> {
    let source_ledger_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND inventory_transfer_line_id=$4 AND movement_type='transfer_out'",
    )
    .bind(tenant_id).bind(source_branch_id).bind(source_item_id).bind(transfer_line_id)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to load transfer batch allocation"))?;
    let Some(source_ledger_id) = source_ledger_id else {
        return Ok(());
    };
    let batches = inventory_repository::stock_ledger_batch_allocations(
        tx,
        tenant_id,
        source_branch_id,
        &source_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load transfer batches"))?;
    for batch in batches {
        let batch_id = inventory_repository::upsert_batch(
            tx,
            tenant_id,
            destination_branch_id,
            destination_item_id,
            &batch.batch_number,
            &batch.barcode,
            batch.expiry_date,
            batch.received_date,
            batch.quantity,
            batch.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::conflict("destination batch conflicts with transferred stock"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            destination_branch_id,
            &batch_id,
            destination_stock_ledger_id,
            batch.quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to write transferred batch movement"))?;
    }
    Ok(())
}

pub async fn restore_transfer_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_stock_ledger_id: &str,
    reversal_stock_ledger_id: &str,
) -> Result<(), AppError> {
    let batches = inventory_repository::stock_ledger_batch_allocations(
        tx,
        tenant_id,
        branch_id,
        source_stock_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load cancelled transfer batches"))?;
    for batch in batches {
        inventory_repository::add_to_batch_quantity(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            batch.quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to restore cancelled transfer batch"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            branch_id,
            &batch.batch_id,
            reversal_stock_ledger_id,
            batch.quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to write cancelled transfer batch movement"))?;
    }
    Ok(())
}

pub async fn allocate_named_batch(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    inventory_item_id: &str,
    batch_number: &str,
    stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    let batch = inventory_repository::lock_batch_by_number(
        tx,
        tenant_id,
        branch_id,
        inventory_item_id,
        batch_number,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock inventory batch"))?
    .ok_or_else(|| AppError::conflict("receipt batch is unavailable"))?;
    if batch.quantity < quantity {
        return Err(AppError::conflict(
            "receipt batch stock is insufficient for return",
        ));
    }
    inventory_repository::set_batch_quantity(
        tx,
        tenant_id,
        branch_id,
        &batch.batch_id,
        batch.quantity - quantity,
    )
    .await
    .map_err(|_| AppError::internal("failed to update inventory batch"))?;
    inventory_repository::add_batch_movement(
        tx,
        tenant_id,
        branch_id,
        &batch.batch_id,
        stock_ledger_id,
        -quantity,
    )
    .await
    .map_err(|_| AppError::internal("failed to write batch return movement"))
}

pub async fn restore_sale_batches(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_stock_ledger_id: &str,
    return_stock_ledger_id: &str,
    quantity: i32,
) -> Result<(), AppError> {
    let rows = inventory_repository::sale_batch_allocations_for_return(
        tx,
        tenant_id,
        branch_id,
        sale_stock_ledger_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load sale batch allocation"))?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut remaining = i64::from(quantity);
    for row in rows {
        let available = row.allocated_quantity.saturating_sub(row.restored_quantity);
        let restored = available.min(remaining).max(0);
        if restored == 0 {
            continue;
        }
        let restored = i32::try_from(restored)
            .map_err(|_| AppError::validation("batch return quantity exceeds supported range"))?;
        inventory_repository::add_to_batch_quantity(
            tx,
            tenant_id,
            branch_id,
            &row.batch_id,
            restored,
        )
        .await
        .map_err(|_| AppError::internal("failed to restore returned batch"))?;
        inventory_repository::add_batch_movement(
            tx,
            tenant_id,
            branch_id,
            &row.batch_id,
            return_stock_ledger_id,
            restored,
        )
        .await
        .map_err(|_| AppError::internal("failed to write returned batch movement"))?;
        remaining -= i64::from(restored);
        if remaining == 0 {
            break;
        }
    }
    if remaining == 0 {
        Ok(())
    } else {
        Err(AppError::conflict(
            "returned quantity exceeds the original batch allocation",
        ))
    }
}

fn fefo_plan(available: &[i32], requested: i32) -> Option<Vec<i32>> {
    let mut remaining = requested;
    let plan = available
        .iter()
        .map(|quantity| {
            let used = remaining.min(*quantity).max(0);
            remaining -= used;
            used
        })
        .collect::<Vec<_>>();
    (remaining == 0).then_some(plan)
}

pub async fn save_kit_components(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    components: Vec<KitComponentInput>,
) -> Result<Vec<inventory_repository::InventoryKitComponentRecord>, AppError> {
    if components.is_empty() || components.len() > 100 {
        return Err(AppError::validation("kit must contain 1 to 100 components"));
    }
    let mut normalized = Vec::with_capacity(components.len());
    let mut ids = HashSet::new();
    for component in components {
        let id = component.inventory_item_id.trim().to_string();
        if id.is_empty()
            || id == kit_inventory_item_id
            || component.quantity <= 0
            || !ids.insert(id.clone())
        {
            return Err(AppError::validation(
                "kit components must be unique active items with positive quantity",
            ));
        }
        normalized.push((id, component.quantity));
    }
    normalized.sort_by(|left, right| left.0.cmp(&right.0));
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start kit update"))?;
    let kit = inventory_repository::lock_for_adjustment(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock kit item"))?
    .filter(|item| item.active)
    .ok_or_else(|| AppError::not_found("kit item was not found"))?;
    if kit.batch_tracked {
        return Err(AppError::conflict(
            "batch-tracked products cannot be assembled kits",
        ));
    }
    for (component_id, _) in &normalized {
        let component =
            inventory_repository::lock_for_adjustment(&mut tx, tenant_id, branch_id, component_id)
                .await
                .map_err(|_| AppError::internal("failed to validate kit component"))?
                .filter(|item| item.active)
                .ok_or_else(|| AppError::validation("kit component is unavailable"))?;
        if inventory_repository::has_kit_components(&mut tx, tenant_id, branch_id, &component.id)
            .await
            .map_err(|_| AppError::internal("failed to validate nested kit"))?
        {
            return Err(AppError::validation("nested kits are not supported"));
        }
    }
    inventory_repository::replace_kit_components(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
        &normalized,
    )
    .await
    .map_err(|_| AppError::internal("failed to save kit components"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit kit components"))?;
    inventory_repository::kit_components(&state.db, tenant_id, branch_id, kit_inventory_item_id)
        .await
        .map_err(|_| AppError::internal("failed to load kit components"))
}

pub async fn assemble_kit(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    kit_inventory_item_id: &str,
    quantity: i32,
    idempotency_key: &str,
    actor_user_id: &str,
) -> Result<KitAssemblyResult, AppError> {
    if quantity <= 0 || idempotency_key.trim().is_empty() || idempotency_key.len() > 120 {
        return Err(AppError::validation(
            "positive quantity and idempotencyKey are required",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start kit assembly"))?;
    let kit = inventory_repository::lock_for_adjustment(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to lock kit inventory"))?
    .filter(|item| item.active)
    .ok_or_else(|| AppError::not_found("kit item was not found"))?;
    if let Some(id) = inventory_repository::kit_assembly_by_key(
        &mut tx,
        tenant_id,
        branch_id,
        idempotency_key.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to read kit assembly replay"))?
    {
        tx.rollback().await.ok();
        return Ok(KitAssemblyResult {
            id,
            kit_inventory_item_id: kit.id,
            quantity,
            stock_quantity: kit.stock_quantity,
        });
    }
    if kit.batch_tracked {
        return Err(AppError::conflict(
            "batch-tracked products cannot be assembled kits",
        ));
    }
    let components = inventory_repository::kit_components_for_update(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to load kit components"))?;
    if components.is_empty() {
        return Err(AppError::validation("kit has no components"));
    }
    let assembly_id = inventory_repository::create_kit_assembly(
        &mut tx,
        tenant_id,
        branch_id,
        kit_inventory_item_id,
        quantity,
        idempotency_key.trim(),
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::conflict("kit assembly idempotency key already exists"))?;
    let mut kit_cost = 0i64;
    for component in components {
        let item = inventory_repository::lock_for_adjustment(
            &mut tx,
            tenant_id,
            branch_id,
            &component.component_inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock kit component"))?
        .filter(|item| item.active)
        .ok_or_else(|| AppError::validation("kit component is unavailable"))?;
        let required = component
            .quantity
            .checked_mul(quantity)
            .ok_or_else(|| AppError::validation("kit quantity exceeds supported range"))?;
        if item.stock_quantity < required {
            return Err(AppError::conflict(format!(
                "insufficient stock for {}",
                component.component_name
            )));
        }
        let stock_after = item.stock_quantity - required;
        inventory_repository::apply_adjusted_stock(
            &mut tx,
            tenant_id,
            branch_id,
            &item.id,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to consume kit component"))?;
        let ledger_id = inventory_repository::add_kit_ledger(
            &mut tx,
            tenant_id,
            branch_id,
            &item.id,
            &assembly_id,
            "kit_component_out",
            -required,
            item.unit_cost_paise,
            stock_after,
        )
        .await
        .map_err(|_| AppError::internal("failed to write kit component ledger"))?;
        allocate_fefo_batches(&mut tx, tenant_id, branch_id, &item, &ledger_id, required).await?;
        kit_cost = kit_cost
            .saturating_add(i64::from(component.quantity).saturating_mul(item.unit_cost_paise));
    }
    let stock_after = kit
        .stock_quantity
        .checked_add(quantity)
        .ok_or_else(|| AppError::validation("kit stock exceeds supported range"))?;
    inventory_repository::apply_stock_and_cost(
        &mut tx,
        tenant_id,
        branch_id,
        &kit.id,
        stock_after,
        kit_cost,
    )
    .await
    .map_err(|_| AppError::internal("failed to receive assembled kit"))?;
    inventory_repository::add_kit_ledger(
        &mut tx,
        tenant_id,
        branch_id,
        &kit.id,
        &assembly_id,
        "kit_assembly_in",
        quantity,
        kit_cost,
        stock_after,
    )
    .await
    .map_err(|_| AppError::internal("failed to write kit assembly ledger"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit kit assembly"))?;
    Ok(KitAssemblyResult {
        id: assembly_id,
        kit_inventory_item_id: kit.id,
        quantity,
        stock_quantity: stock_after,
    })
}

fn validate(input: &InventoryUpdateInput<'_>) -> Result<(), AppError> {
    if input.stock_quantity.is_some_and(|value| value < 0) {
        return Err(AppError::validation("stockQuantity must be 0 or greater"));
    }
    if input.barcode.is_some_and(|value| value.trim().len() > 120) {
        return Err(AppError::validation(
            "barcode must be at most 120 characters",
        ));
    }
    if input
        .adjustment_reason
        .is_some_and(|value| value.trim().len() > 500)
    {
        return Err(AppError::validation(
            "adjustmentReason must be at most 500 characters",
        ));
    }
    if input
        .idempotency_key
        .is_some_and(|value| value.trim().len() > 120)
    {
        return Err(AppError::validation(
            "idempotencyKey must be at most 120 characters",
        ));
    }
    Ok(())
}

fn map_ledger_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|value| value.code())
        .is_some_and(|code| code == "23505")
    {
        AppError::conflict("idempotencyKey is already used by another inventory adjustment")
    } else {
        AppError::internal("failed to write inventory adjustment ledger")
    }
}

#[cfg(test)]
mod tests {
    use super::{fefo_plan, update_in_tx, validate, InventoryUpdateInput};
    use sqlx::PgPool;

    fn input<'a>(
        tenant_id: &'a str,
        branch_id: &'a str,
        target: i32,
        key: &'a str,
    ) -> InventoryUpdateInput<'a> {
        InventoryUpdateInput {
            tenant_id,
            branch_id,
            id: "item-1",
            sku: None,
            name: None,
            category: None,
            brand: None,
            unit: None,
            package_unit: None,
            units_per_package: None,
            stock_quantity: Some(target),
            reorder_point: None,
            unit_cost_paise: None,
            hsn_code: None,
            gst_percent: None,
            barcode: None,
            batch_tracked: None,
            dual_use_stock: None,
            active: None,
            adjustment_reason: Some("Cycle count correction"),
            idempotency_key: Some(key),
        }
    }

    #[sqlx::test(migrations = false)]
    async fn adjustment_is_scoped_idempotent_and_atomic(pool: PgPool) {
        for statement in [
            r#"
            CREATE TABLE inventory_items (
              id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
              sku TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
              unit TEXT NOT NULL DEFAULT 'pcs', package_unit TEXT NOT NULL DEFAULT 'pcs',
              units_per_package INTEGER NOT NULL DEFAULT 1, stock_quantity INTEGER NOT NULL DEFAULT 0,
              reorder_point INTEGER NOT NULL DEFAULT 0, unit_cost_paise BIGINT NOT NULL DEFAULT 0,
              hsn_code TEXT NOT NULL DEFAULT '', gst_percent INTEGER NOT NULL DEFAULT 0,
              barcode TEXT NOT NULL DEFAULT '', batch_tracked BOOLEAN NOT NULL DEFAULT FALSE,
              dual_use_stock BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, central_master_item_id TEXT,
              franchise_override_fields TEXT[] NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ
            )
            "#,
            r#"CREATE TABLE franchise_policies (
              tenant_id TEXT PRIMARY KEY, central_branch_id TEXT NOT NULL,
              allowed_override_fields TEXT[] NOT NULL DEFAULT '{}'
            )"#,
            r#"
            CREATE TABLE inventory_stock_ledger (
              id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT, tenant_id TEXT NOT NULL,
              branch_id TEXT NOT NULL, inventory_item_id TEXT NOT NULL, sale_id TEXT, sale_line_id TEXT,
              movement_type TEXT NOT NULL CONSTRAINT inventory_stock_ledger_movement_type_check
                CHECK (movement_type IN ('sale', 'return', 'purchase', 'transfer_out', 'transfer_in', 'transfer_reversal')),
              quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
              unit_cost_paise BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("inventory adjustment schema should be created");
        }
        sqlx::raw_sql(include_str!(
            "../../migrations/0081_inventory_adjustment_ledger.sql"
        ))
        .execute(&pool)
        .await
        .expect("inventory adjustment migration should apply");
        sqlx::query("INSERT INTO inventory_items (id,tenant_id,branch_id,name,stock_quantity,unit_cost_paise) VALUES ('item-1','tenant-1','branch-1','Shampoo',10,2500)")
            .execute(&pool).await.expect("inventory fixture should be created");

        let mut success = pool
            .begin()
            .await
            .expect("success transaction should start");
        let updated = update_in_tx(&mut success, &input("tenant-1", "branch-1", 7, "count-1"))
            .await
            .expect("adjustment should succeed")
            .expect("item should exist");
        success
            .commit()
            .await
            .expect("success transaction should commit");
        assert_eq!(updated.stock_quantity, 7);

        let mut retry = pool.begin().await.expect("retry transaction should start");
        update_in_tx(&mut retry, &input("tenant-1", "branch-1", 7, "count-1"))
            .await
            .expect("retry should return existing adjustment");
        retry
            .commit()
            .await
            .expect("retry transaction should commit");
        let ledger_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM inventory_stock_ledger")
                .fetch_one(&pool)
                .await
                .expect("ledger count should load");
        assert_eq!(ledger_count, 1);

        let mut wrong_branch = pool.begin().await.expect("scope transaction should start");
        let scoped = update_in_tx(
            &mut wrong_branch,
            &input("tenant-1", "branch-2", 5, "count-2"),
        )
        .await
        .expect("scope check should not fail");
        wrong_branch
            .rollback()
            .await
            .expect("scope transaction should roll back");
        assert!(scoped.is_none());

        let mut rollback = pool
            .begin()
            .await
            .expect("rollback transaction should start");
        update_in_tx(
            &mut rollback,
            &input("tenant-1", "branch-1", 3, "count-rollback"),
        )
        .await
        .expect("rollback adjustment should stage");
        rollback
            .rollback()
            .await
            .expect("rollback transaction should roll back");
        let persisted_stock = sqlx::query_scalar::<_, i32>(
            "SELECT stock_quantity FROM inventory_items WHERE id='item-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("stock should load");
        let persisted_ledger =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM inventory_stock_ledger")
                .fetch_one(&pool)
                .await
                .expect("ledger count should load");
        assert_eq!(persisted_stock, 7);
        assert_eq!(persisted_ledger, 1);

        sqlx::query(
            "UPDATE inventory_items SET central_master_item_id='central-item' WHERE id='item-1'",
        )
        .execute(&pool)
        .await
        .expect("linked product should be configured");
        sqlx::query("INSERT INTO franchise_policies(tenant_id,central_branch_id,allowed_override_fields) VALUES('tenant-1','central',ARRAY['active'])")
            .execute(&pool).await.expect("override policy should be configured");
        let mut blocked_input = input("tenant-1", "branch-1", 7, "");
        blocked_input.stock_quantity = None;
        blocked_input.name = Some("Local Shampoo");
        let mut blocked = pool
            .begin()
            .await
            .expect("blocked transaction should start");
        assert!(update_in_tx(&mut blocked, &blocked_input).await.is_err());
        blocked
            .rollback()
            .await
            .expect("blocked transaction should roll back");

        sqlx::query("UPDATE franchise_policies SET allowed_override_fields=ARRAY['name'] WHERE tenant_id='tenant-1'")
            .execute(&pool).await.expect("override policy should update");
        let mut allowed = pool
            .begin()
            .await
            .expect("allowed transaction should start");
        update_in_tx(&mut allowed, &blocked_input)
            .await
            .expect("allowed override should save");
        allowed
            .commit()
            .await
            .expect("allowed override should commit");
        let overrides: Vec<String> = sqlx::query_scalar(
            "SELECT franchise_override_fields FROM inventory_items WHERE id='item-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("override fields should load");
        assert_eq!(overrides, vec!["name"]);

        assert!(validate(&input("tenant-1", "branch-1", -1, "negative-1")).is_err());
    }

    #[test]
    fn fefo_uses_earliest_available_batches_and_rejects_shortage() {
        assert_eq!(fefo_plan(&[2, 5, 9], 6), Some(vec![2, 4, 0]));
        assert_eq!(fefo_plan(&[2, 1], 4), None);
    }
}
