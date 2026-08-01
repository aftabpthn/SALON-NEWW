use std::collections::{BTreeMap, HashSet};

use chrono::{Duration, NaiveDate, Utc};

use crate::{
    models::common::AppError,
    repositories::{
        migration_repository, purchase_order_event_repository,
        purchase_repository::{
            self, PurchaseOrderLineRecord, PurchaseOrderRecord, PurchaseReceipt,
            PurchaseReceiptLine, SupplierAdvanceRecord, SupplierPaymentRecord,
        },
    },
    services::{accounting_service, inventory_adjustment_service},
    state::AppState,
};

pub struct ReceiptInput {
    pub supplier_id: Option<String>,
    pub purchase_order_id: Option<String>,
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub supplier_invoice_number: String,
    pub supplier_invoice_date: Option<String>,
    pub received_date: Option<String>,
    pub due_date: Option<String>,
    pub challan_number: String,
    pub delivery_reference: String,
    pub shipping_paise: i64,
    pub handling_paise: i64,
    pub round_off_paise: i64,
    pub tax_totals: Option<ReceiptTaxTotals>,
    pub idempotency_key: String,
    pub backdated_operational_approval: bool,
    pub accept_excess: bool,
    pub request_master_price_updates: HashSet<String>,
    pub lines: Vec<ReceiptLineInput>,
}

#[derive(Clone, Copy)]
pub struct ReceiptTaxTotals {
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
}

pub struct ReceiptLineInput {
    pub inventory_item_id: String,
    pub quantity: i32,
    pub retail_quantity: Option<i32>,
    pub consumable_quantity: Option<i32>,
    pub free_quantity: i32,
    pub unit_cost_paise: i64,
    pub discount_bps: i32,
    pub gst_percent: Option<i32>,
    pub damaged_quantity: i32,
    pub rejected_quantity: i32,
    pub variance_reason: String,
    pub batch_number: Option<String>,
    pub batch_barcode: Option<String>,
    pub expiry_date: Option<String>,
}

pub struct OrderInput {
    pub supplier_id: String,
    pub expected_date: Option<String>,
    pub notes: String,
    pub shipping_paise: i64,
    pub handling_paise: i64,
    pub lines: Vec<OrderLineInput>,
}

pub struct OrderLineInput {
    pub inventory_item_id: String,
    pub quantity: i32,
    pub retail_quantity: i32,
    pub consumable_quantity: i32,
    pub unit_cost_paise: i64,
    pub discount_bps: i32,
    pub gst_percent: i32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDetails {
    pub order: PurchaseOrderRecord,
    pub lines: Vec<PurchaseOrderLineRecord>,
}

pub struct ReturnInput {
    pub purchase_receipt_id: String,
    pub reason: String,
    pub idempotency_key: String,
    pub lines: Vec<ReturnLineInput>,
}

pub struct ReturnLineInput {
    pub purchase_receipt_line_id: String,
    pub quantity: i32,
}

pub struct SupplierPaymentInput {
    pub purchase_receipt_id: String,
    pub amount_paise: i64,
    pub payment_method: String,
    pub reference: String,
    pub idempotency_key: String,
}

pub struct SupplierAdvanceInput {
    pub supplier_id: String,
    pub amount_paise: i64,
    pub payment_method: String,
    pub reference: String,
    pub idempotency_key: String,
}

#[derive(serde::Serialize)]
pub struct CreatedId {
    pub id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptDetails {
    pub receipt: PurchaseReceipt,
    pub lines: Vec<PurchaseReceiptLine>,
    pub warnings: Vec<String>,
    pub price_warnings: Vec<PriceDifferenceWarning>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceDifferenceWarning {
    pub inventory_item_id: String,
    pub current_unit_cost_paise: Option<i64>,
    pub received_unit_cost_paise: i64,
    pub difference_bps: Option<i32>,
    pub update_requested: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderImportResult {
    pub file_name: String,
    pub rows_imported: usize,
    pub order: OrderDetails,
}

struct CalculatedLine {
    item_id: String,
    package_unit: String,
    stock_unit: String,
    units_per_package: i32,
    stock_quantity: i32,
    quantity: i32,
    retail_quantity: i32,
    consumable_quantity: i32,
    free_quantity: i32,
    delivered_quantity: i32,
    ordered_quantity: Option<i32>,
    short_quantity: i32,
    excess_quantity: i32,
    damaged_quantity: i32,
    rejected_quantity: i32,
    applied_retail_quantity: i32,
    applied_consumable_quantity: i32,
    variance_reason: String,
    gross_unit_cost_paise: i64,
    unit_cost_paise: i64,
    landed_cost_paise: i64,
    landed_unit_cost_paise: i64,
    stock_unit_cost_paise: i64,
    discount_bps: i32,
    discount_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    next_stock: i32,
    next_cost: i64,
    current_stock: i32,
    current_cost: i64,
    master_cost: Option<i64>,
    request_master_price_update: bool,
    batch_tracked: bool,
    batch_number: String,
    batch_barcode: String,
    expiry_date: Option<NaiveDate>,
}

pub async fn receive(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    actor_role: &str,
    can_receive_excess: bool,
    input: ReceiptInput,
) -> Result<ReceiptDetails, AppError> {
    let supplier = if let Some(id) = input
        .supplier_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(
            purchase_repository::get_supplier(&state.db, tenant_id, branch_id, id.trim())
                .await
                .map_err(|_| AppError::internal("failed to load GRN supplier"))?
                .filter(|row| row.active)
                .ok_or_else(|| AppError::not_found("GRN supplier was not found"))?,
        )
    } else {
        None
    };
    let supplier_id = supplier.as_ref().map(|row| row.id.as_str());
    let supplier_name = supplier
        .as_ref()
        .map(|row| row.name.clone())
        .unwrap_or(input.supplier_name);
    let supplier_gstin_input = supplier
        .as_ref()
        .map(|row| row.gstin.as_str())
        .unwrap_or(input.supplier_gstin.as_str());
    let supplier_name = required(supplier_name, "supplierName is required")?;
    let invoice_number = required(
        input.supplier_invoice_number,
        "supplierInvoiceNumber is required",
    )?;
    let key = required(input.idempotency_key, "idempotencyKey is required")?;
    if input.shipping_paise < 0 || input.handling_paise < 0 {
        return Err(AppError::validation(
            "shippingPaise and handlingPaise must be non-negative",
        ));
    }
    let landed_cost_paise = input
        .shipping_paise
        .checked_add(input.handling_paise)
        .ok_or_else(|| AppError::validation("shipping and handling total is too large"))?;
    let challan_number = input.challan_number.trim().to_string();
    let delivery_reference = input.delivery_reference.trim().to_string();
    if challan_number.chars().count() > 120 || delivery_reference.chars().count() > 120 {
        return Err(AppError::validation(
            "challanNumber and deliveryReference must be 120 characters or fewer",
        ));
    }
    if input.lines.is_empty() {
        return Err(AppError::validation("at least one GRN line is required"));
    }
    let supplier_gstin = gstin(supplier_gstin_input, "supplierGstin")?;
    let received_date = parse_date(input.received_date.as_deref())?;
    let supplier_invoice_date = parse_optional_date(
        input.supplier_invoice_date.as_deref(),
        "supplierInvoiceDate",
    )?
    .unwrap_or(received_date);
    let cutover = migration_repository::get_cutover(&state.db, tenant_id, branch_id, None)
        .await
        .map_err(|_| AppError::internal("failed to validate the migration cutover boundary"))?;
    let backdated = cutover.as_ref().is_some_and(|cutover| {
        is_backdated_live_grn(
            cutover.status.as_str(),
            supplier_invoice_date,
            cutover.cutover_date,
        )
    });
    if backdated {
        if !input.backdated_operational_approval {
            return Err(AppError::validation_code(
                "BACKDATED_GRN_HISTORY_ONLY_REQUIRED",
                "This invoice belongs in Historical Purchase Bills; Owner approval is required to post it as an operational GRN",
            ));
        }
        if !matches!(
            actor_role.trim().to_ascii_lowercase().as_str(),
            "owner" | "superadmin" | "super-admin"
        ) {
            return Err(AppError::forbidden(
                "Owner approval is required for a backdated operational GRN",
            ));
        }
        if cutover
            .as_ref()
            .and_then(|cutover| cutover.reconciliation.get("status"))
            .and_then(serde_json::Value::as_str)
            != Some("matched")
        {
            return Err(AppError::validation_code(
                "BACKDATED_GRN_RECONCILIATION_REQUIRED",
                "Migration reconciliation must be matched before a backdated operational GRN can be posted",
            ));
        }
    }
    let historical_collision = purchase_repository::historical_invoice_collision(
        &state.db,
        tenant_id,
        branch_id,
        &supplier_name,
        &supplier_gstin,
        &invoice_number,
    )
    .await
    .map_err(|_| AppError::internal("failed to check the historical purchase register"))?;
    let due_date = input
        .due_date
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .map_err(|_| AppError::validation("dueDate must be YYYY-MM-DD"))
        })
        .transpose()?
        .or_else(|| {
            supplier
                .as_ref()
                .map(|row| received_date + Duration::days(i64::from(row.payment_terms_days)))
        });
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start GRN transaction"))?;
    if let Some(receipt) = purchase_repository::by_idempotency(&mut tx, tenant_id, branch_id, &key)
        .await
        .map_err(|_| AppError::internal("failed to read GRN idempotency key"))?
    {
        let lines = purchase_repository::lines(&state.db, tenant_id, branch_id, &receipt.id)
            .await
            .map_err(|_| AppError::internal("failed to load existing GRN"))?;
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish duplicate GRN"))?;
        return Ok(ReceiptDetails {
            receipt,
            lines,
            warnings: historical_collision
                .then(|| {
                    "Invoice also exists in Historical Purchase Bills; verify the cross-register reconciliation"
                        .to_string()
                })
                .into_iter()
                .collect(),
            price_warnings: Vec::new(),
        });
    }
    let receipt_policy =
        purchase_repository::inventory_receipt_policy(&mut tx, tenant_id, branch_id)
            .await
            .map_err(|_| AppError::internal("failed to load inventory receipt policy"))?;
    if receipt_policy
        .financial_lock_date
        .is_some_and(|lock| supplier_invoice_date <= lock || received_date <= lock)
    {
        return Err(AppError::conflict(
            "GRN date is inside the inventory financial lock period",
        ));
    }
    if receipt_policy.edit_lock_days > 0 {
        let cutoff = chrono::Utc::now().date_naive()
            - Duration::days(i64::from(receipt_policy.edit_lock_days));
        if supplier_invoice_date < cutoff || received_date < cutoff {
            return Err(AppError::conflict(
                "GRN date is older than the inventory edit-lock window",
            ));
        }
    }
    let purchase_order_id = input
        .purchase_order_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::trim);
    if let Some(order_id) = purchase_order_id {
        let (order_supplier_id, status) = purchase_repository::lock_order_for_receipt(
            &mut tx,
            tenant_id,
            branch_id,
            order_id.trim(),
        )
        .await
        .map_err(|_| AppError::internal("failed to lock purchase order"))?
        .ok_or_else(|| AppError::not_found("purchase order was not found"))?;
        if !matches!(status.as_str(), "approved" | "partially_received")
            || supplier_id != Some(order_supplier_id.as_str())
        {
            return Err(AppError::conflict(
                "purchase order is not approved for this supplier",
            ));
        }
    }
    let buyer_gstin = purchase_repository::buyer_gstin(&mut tx, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load business GST profile"))?;
    let buyer_state = gst_state(&buyer_gstin);
    let supplier_state = gst_state(&supplier_gstin);
    let mut calculated = Vec::with_capacity(input.lines.len());
    let mut item_ids = HashSet::new();
    let accept_excess = input.accept_excess;
    let requested_price_updates = input.request_master_price_updates;
    for line in input.lines {
        if line.quantity <= 0
            || line.free_quantity < 0
            || line.unit_cost_paise < 0
            || !(0..=10_000).contains(&line.discount_bps)
            || line.damaged_quantity < 0
            || line.rejected_quantity < 0
            || line.damaged_quantity.saturating_add(line.rejected_quantity) > line.quantity
            || line.inventory_item_id.trim().is_empty()
        {
            return Err(AppError::validation(
                "GRN line quantity, damage, rejection, discount, or unit cost is invalid",
            ));
        }
        if !item_ids.insert(line.inventory_item_id.trim().to_string()) {
            return Err(AppError::validation(
                "each inventory item can appear only once in a GRN",
            ));
        }
        if let Some(supplier_id) = supplier_id {
            if !purchase_repository::supplier_item_available(
                &mut tx,
                tenant_id,
                branch_id,
                supplier_id,
                line.inventory_item_id.trim(),
            )
            .await
            .map_err(|_| {
                AppError::internal("failed to validate vendor-product-center association")
            })? {
                return Err(AppError::conflict(
                    "vendor-product-center association is inactive or unavailable",
                ));
            }
        }
        let item = purchase_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            branch_id,
            line.inventory_item_id.trim(),
        )
        .await
        .map_err(|_| AppError::internal("failed to lock GRN inventory item"))?
        .ok_or_else(|| AppError::not_found("GRN inventory item was not found"))?;
        let gst_percent = line.gst_percent.unwrap_or(item.gst_percent).clamp(0, 100);
        let expiry_date = parse_optional_date(line.expiry_date.as_deref(), "expiryDate")?;
        let (
            ordered_quantity,
            ordered_retail,
            ordered_consumable,
            order_price,
            package_unit,
            stock_unit,
            units_per_package,
        ) = if let Some(order_id) = purchase_order_id {
            let order_line = purchase_repository::lock_order_line_for_receipt(
                &mut tx,
                tenant_id,
                branch_id,
                order_id,
                line.inventory_item_id.trim(),
            )
            .await
            .map_err(|_| AppError::internal("failed to lock purchase order line"))?
            .ok_or_else(|| AppError::conflict("GRN item is not on the purchase order"))?;
            if order_line.stock_unit != item.stock_unit {
                return Err(AppError::conflict(
                    "product stock unit changed after the purchase order was created",
                ));
            }
            (
                Some(
                    order_line
                        .quantity
                        .saturating_sub(order_line.received_quantity),
                ),
                Some(
                    order_line
                        .retail_quantity
                        .saturating_sub(order_line.retail_received_quantity),
                ),
                Some(
                    order_line
                        .consumable_quantity
                        .saturating_sub(order_line.consumable_received_quantity),
                ),
                Some(order_line.unit_cost_paise),
                order_line.package_unit,
                order_line.stock_unit,
                order_line.units_per_package,
            )
        } else {
            (
                None,
                None,
                None,
                None,
                item.package_unit.clone(),
                item.stock_unit.clone(),
                item.units_per_package,
            )
        };
        let (accepted, short, excess, applied) = receiving_variance(
            ordered_quantity,
            line.quantity,
            line.damaged_quantity,
            line.rejected_quantity,
        );
        let (retail_quantity, consumable_quantity) = receiving_split(
            accepted,
            line.retail_quantity,
            line.consumable_quantity,
            &item.product_usage,
            ordered_retail,
            ordered_consumable,
        )?;
        let applied_retail = ordered_retail.map_or(0, |ordered| retail_quantity.min(ordered));
        let applied_consumable =
            ordered_consumable.map_or(0, |ordered| consumable_quantity.min(ordered));
        let applied = if ordered_quantity.is_some() {
            applied_retail.saturating_add(applied_consumable)
        } else {
            applied
        };
        let short = ordered_quantity.map_or(short, |ordered| ordered.saturating_sub(applied));
        let excess = ordered_quantity.map_or(excess, |_| accepted.saturating_sub(applied));
        if short > 0 && receipt_policy.partial_delivery_policy == "block" {
            return Err(AppError::conflict(
                "partial delivery is blocked by inventory policy",
            ));
        }
        if excess > 0 {
            if receipt_policy.excess_receiving_policy == "block" {
                return Err(AppError::conflict(
                    "excess receiving is blocked by inventory policy",
                ));
            }
            if !accept_excess || !can_receive_excess {
                return Err(AppError::forbidden(
                    "excess receiving permission and explicit acceptance are required",
                ));
            }
        }
        let stock_quantity = base_quantity(
            accepted
                .checked_add(line.free_quantity)
                .ok_or_else(|| AppError::validation("GRN free quantity is too large"))?,
            units_per_package,
        )?;
        let variance_reason = line.variance_reason.trim().to_string();
        if (excess > 0 || line.damaged_quantity > 0 || line.rejected_quantity > 0)
            && variance_reason.is_empty()
        {
            return Err(AppError::validation(
                "varianceReason is required for excess, damaged, or rejected receiving",
            ));
        }
        if variance_reason.chars().count() > 500 {
            return Err(AppError::validation(
                "varianceReason must be 500 characters or fewer",
            ));
        }
        if gst_percent > 0 && (buyer_state.is_empty() || supplier_state.is_empty()) {
            return Err(AppError::validation(
                "registered business and supplier GSTIN are required for input GST",
            ));
        }
        let (net_unit_cost, discount_paise, taxable) =
            discounted_cost(line.unit_cost_paise, line.discount_bps, accepted);
        let master_cost = if let Some(supplier_id) = supplier_id {
            purchase_repository::active_supplier_price(
                &mut tx,
                tenant_id,
                branch_id,
                supplier_id,
                line.inventory_item_id.trim(),
                received_date,
            )
            .await
            .map_err(|_| AppError::internal("failed to load supplier master price"))?
            .or(order_price)
        } else {
            order_price
        };
        let tax = div_round(taxable.saturating_mul(i64::from(gst_percent)), 100);
        let (cgst, sgst, igst) = if gst_percent == 0 {
            (0, 0, 0)
        } else if buyer_state == supplier_state {
            (tax / 2, tax - (tax / 2), 0)
        } else {
            (0, 0, tax)
        };
        let next_stock_i64 =
            i64::from(item.stock_quantity).saturating_add(i64::from(stock_quantity));
        if next_stock_i64 > i64::from(i32::MAX) {
            return Err(AppError::validation(
                "GRN stock quantity exceeds supported range",
            ));
        }
        calculated.push(CalculatedLine {
            item_id: line.inventory_item_id.trim().to_string(),
            package_unit,
            stock_unit,
            units_per_package,
            stock_quantity,
            quantity: accepted,
            retail_quantity,
            consumable_quantity,
            free_quantity: line.free_quantity,
            delivered_quantity: line.quantity.saturating_add(line.free_quantity),
            ordered_quantity,
            short_quantity: short,
            excess_quantity: excess,
            damaged_quantity: line.damaged_quantity,
            rejected_quantity: line.rejected_quantity,
            applied_retail_quantity: applied_retail,
            applied_consumable_quantity: applied_consumable,
            variance_reason,
            gross_unit_cost_paise: line.unit_cost_paise,
            unit_cost_paise: net_unit_cost,
            landed_cost_paise: 0,
            landed_unit_cost_paise: net_unit_cost,
            stock_unit_cost_paise: 0,
            discount_bps: line.discount_bps,
            discount_paise,
            gst_percent,
            taxable_paise: taxable,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            next_stock: next_stock_i64 as i32,
            next_cost: 0,
            current_stock: item.stock_quantity,
            current_cost: item.unit_cost_paise,
            master_cost,
            request_master_price_update: requested_price_updates
                .contains(line.inventory_item_id.trim()),
            batch_tracked: item.batch_tracked,
            batch_number: line.batch_number.unwrap_or_default().trim().to_string(),
            batch_barcode: line.batch_barcode.unwrap_or_default().trim().to_string(),
            expiry_date,
        });
    }
    if !requested_price_updates.is_subset(&item_ids) {
        return Err(AppError::validation(
            "master price update items must belong to this GRN",
        ));
    }
    if !requested_price_updates.is_empty() && supplier_id.is_none() {
        return Err(AppError::validation(
            "a saved supplier is required for master price updates",
        ));
    }
    if let Some(targets) = input.tax_totals {
        reconcile_tax_totals(&mut calculated, targets)?;
    }
    let taxable = calculated.iter().map(|line| line.taxable_paise).sum();
    let cgst = calculated.iter().map(|line| line.cgst_paise).sum();
    let sgst = calculated.iter().map(|line| line.sgst_paise).sum();
    let igst = calculated.iter().map(|line| line.igst_paise).sum();
    if landed_cost_paise > 0 && taxable == 0 {
        return Err(AppError::validation(
            "shipping and handling cannot be allocated without accepted stock",
        ));
    }
    let landed_allocations = proportional_allocations(
        landed_cost_paise,
        &calculated
            .iter()
            .map(|line| line.taxable_paise)
            .collect::<Vec<_>>(),
    );
    for (line, allocation) in calculated.iter_mut().zip(landed_allocations) {
        line.landed_cost_paise = allocation;
        line.landed_unit_cost_paise = line
            .unit_cost_paise
            .checked_add(div_round(allocation, i64::from(line.quantity)))
            .ok_or_else(|| AppError::validation("landed unit cost is too large"))?;
        line.stock_unit_cost_paise = div_round(
            line.taxable_paise.saturating_add(allocation),
            i64::from(line.stock_quantity),
        );
        line.next_cost = weighted_cost(
            line.current_stock,
            line.current_cost,
            line.stock_quantity,
            line.stock_unit_cost_paise,
        );
    }
    let price_warnings = calculated
        .iter()
        .filter_map(|line| {
            let difference_bps = line
                .master_cost
                .map(|current| price_difference_bps(current, line.gross_unit_cost_paise));
            let differs = line.master_cost != Some(line.gross_unit_cost_paise);
            (receipt_policy.price_difference_prompt
                && differs
                && difference_bps.map_or(true, |value| {
                    value >= receipt_policy.price_difference_threshold_bps
                }))
            .then(|| PriceDifferenceWarning {
                inventory_item_id: line.item_id.clone(),
                current_unit_cost_paise: line.master_cost,
                received_unit_cost_paise: line.gross_unit_cost_paise,
                difference_bps,
                update_requested: line.request_master_price_update,
            })
        })
        .collect::<Vec<_>>();
    let receipt = purchase_repository::create_receipt(
        &mut tx,
        tenant_id,
        branch_id,
        &supplier_name,
        &supplier_gstin,
        &supplier_state,
        &invoice_number,
        supplier_invoice_date,
        received_date,
        &challan_number,
        &delivery_reference,
        supplier_id,
        purchase_order_id,
        due_date,
        taxable,
        cgst,
        sgst,
        igst,
        input.shipping_paise,
        input.handling_paise,
        input.round_off_paise,
        actor_user_id,
        &key,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .and_then(|database_error| database_error.code())
            .as_deref()
            == Some("23505")
        {
            AppError::conflict("supplier invoice or idempotency key already exists")
        } else {
            AppError::internal("failed to create purchase receipt")
        }
    })?;
    if backdated {
        purchase_repository::record_backdated_operational_approval(
            &mut tx,
            tenant_id,
            branch_id,
            &receipt.id,
            actor_user_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to record backdated GRN approval"))?;
    }
    if calculated.iter().any(|line| line.excess_quantity > 0) {
        purchase_repository::mark_excess_approved(
            &mut tx,
            tenant_id,
            branch_id,
            &receipt.id,
            actor_user_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to record excess receiving approval"))?;
    }
    let mut saved_lines = Vec::with_capacity(calculated.len());
    for line in calculated {
        if let Some(order_id) = purchase_order_id {
            let applied = purchase_repository::apply_order_receipt(
                &mut tx,
                tenant_id,
                branch_id,
                order_id,
                &line.item_id,
                line.applied_retail_quantity,
                line.applied_consumable_quantity,
            )
            .await
            .map_err(|_| AppError::internal("failed to update purchase order receipt"))?;
            if !applied {
                return Err(AppError::conflict(
                    "GRN item is not pending on the purchase order",
                ));
            }
        }
        let mut saved = purchase_repository::create_line(
            &mut tx,
            tenant_id,
            branch_id,
            &receipt.id,
            &line.item_id,
            &line.package_unit,
            &line.stock_unit,
            line.units_per_package,
            line.stock_quantity,
            line.stock_unit_cost_paise,
            line.quantity,
            line.retail_quantity,
            line.consumable_quantity,
            line.delivered_quantity,
            line.ordered_quantity,
            line.short_quantity,
            line.excess_quantity,
            line.damaged_quantity,
            line.rejected_quantity,
            &line.variance_reason,
            line.gross_unit_cost_paise,
            line.unit_cost_paise,
            line.landed_cost_paise,
            line.landed_unit_cost_paise,
            line.discount_bps,
            line.discount_paise,
            line.gst_percent,
            line.taxable_paise,
            line.cgst_paise,
            line.sgst_paise,
            line.igst_paise,
            &line.batch_number,
            &line.batch_barcode,
            line.expiry_date,
            line.free_quantity,
        )
        .await
        .map_err(|_| AppError::internal("failed to save GRN line"))?;
        if line.request_master_price_update && line.master_cost != Some(line.gross_unit_cost_paise)
        {
            let price_supplier_id = supplier_id.ok_or_else(|| {
                AppError::validation("a saved supplier is required for master price updates")
            })?;
            purchase_repository::create_price_update_request(
                &mut tx,
                tenant_id,
                branch_id,
                &receipt.id,
                &saved.id,
                price_supplier_id,
                &line.item_id,
                line.master_cost,
                line.gross_unit_cost_paise,
                line.discount_bps,
                line.gst_percent,
                actor_user_id,
            )
            .await
            .map_err(|_| AppError::conflict("master price update request already exists"))?;
        }
        if line.damaged_quantity > 0 {
            purchase_repository::create_receiving_quarantine(
                &mut tx,
                tenant_id,
                branch_id,
                &receipt.id,
                &saved.id,
                &line.item_id,
                line.damaged_quantity,
                &line.variance_reason,
                &line.batch_number,
                &line.batch_barcode,
                line.expiry_date,
                actor_user_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to quarantine damaged GRN stock"))?;
            saved.quarantine_status = "quarantined".to_string();
        }
        if line.stock_quantity > 0 {
            purchase_repository::apply_stock(
                &mut tx,
                tenant_id,
                branch_id,
                &line.item_id,
                line.next_stock,
                line.next_cost,
            )
            .await
            .map_err(|_| AppError::internal("failed to update GRN inventory"))?;
            let ledger_id = purchase_repository::add_stock_ledger(
                &mut tx,
                tenant_id,
                branch_id,
                &line.item_id,
                &receipt.id,
                &saved.id,
                line.stock_quantity,
                line.stock_unit_cost_paise,
                line.next_stock,
            )
            .await
            .map_err(|_| AppError::internal("failed to write GRN stock ledger"))?;
            inventory_adjustment_service::record_batch_receipt(
                &mut tx,
                tenant_id,
                branch_id,
                &line.item_id,
                line.batch_tracked,
                &line.batch_number,
                &line.batch_barcode,
                line.expiry_date,
                received_date,
                line.stock_quantity,
                line.stock_unit_cost_paise,
                &ledger_id,
            )
            .await?;
        }
        saved_lines.push(saved);
    }
    if let Some(order_id) = purchase_order_id {
        purchase_repository::refresh_order_status(&mut tx, tenant_id, branch_id, order_id)
            .await
            .map_err(|_| AppError::internal("failed to refresh purchase order status"))?;
        purchase_order_event_repository::add(
            &mut tx,
            tenant_id,
            branch_id,
            order_id,
            "received",
            "",
            "",
            "GRN received",
            actor_user_id,
            &serde_json::json!({"purchaseReceiptId":receipt.id,"grrNumber":receipt.grr_number}),
        )
        .await
        .map_err(|_| AppError::internal("failed to write purchase order receipt event"))?;
    }
    if receipt.total_paise > 0 {
        accounting_service::post_purchase_grn(
            &mut tx,
            tenant_id,
            branch_id,
            &receipt.id,
            receipt.taxable_paise,
            receipt.cgst_paise,
            receipt.sgst_paise,
            receipt.igst_paise,
            receipt.shipping_paise,
            receipt.handling_paise,
            receipt.round_off_paise,
        )
        .await?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit GRN"))?;
    Ok(ReceiptDetails {
        receipt,
        lines: saved_lines,
        warnings: historical_collision
            .then(|| {
                "Invoice also exists in Historical Purchase Bills; verify the cross-register reconciliation"
                    .to_string()
            })
            .into_iter()
            .collect(),
        price_warnings,
    })
}

pub async fn details(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<ReceiptDetails, AppError> {
    let receipt = purchase_repository::get(&state.db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load GRN"))?
        .ok_or_else(|| AppError::not_found("GRN was not found"))?;
    let lines = purchase_repository::lines(&state.db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load GRN lines"))?;
    let historical_collision = purchase_repository::historical_invoice_collision(
        &state.db,
        tenant_id,
        branch_id,
        &receipt.supplier_name,
        &receipt.supplier_gstin,
        &receipt.supplier_invoice_number,
    )
    .await
    .map_err(|_| AppError::internal("failed to check the historical purchase register"))?;
    Ok(ReceiptDetails {
        receipt,
        lines,
        warnings: historical_collision
            .then(|| {
                "Invoice also exists in Historical Purchase Bills; verify the cross-register reconciliation"
                    .to_string()
            })
            .into_iter()
            .collect(),
        price_warnings: Vec::new(),
    })
}

pub async fn create_order(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: OrderInput,
) -> Result<OrderDetails, AppError> {
    let supplier_id = required(input.supplier_id, "supplierId is required")?;
    if input.lines.is_empty() {
        return Err(AppError::validation(
            "at least one purchase order line is required",
        ));
    }
    if input.notes.chars().count() > 500 {
        return Err(AppError::validation(
            "notes must be 500 characters or fewer",
        ));
    }
    if input.shipping_paise < 0 || input.handling_paise < 0 {
        return Err(AppError::validation(
            "shippingPaise and handlingPaise must be non-negative",
        ));
    }
    let expected_date = parse_optional_date(input.expected_date.as_deref(), "expectedDate")?;
    let mut item_ids = HashSet::new();
    let mut calculated = Vec::with_capacity(input.lines.len());
    for line in input.lines {
        let item_id = line.inventory_item_id.trim().to_string();
        if item_id.is_empty()
            || line.quantity <= 0
            || line.retail_quantity < 0
            || line.consumable_quantity < 0
            || (line
                .retail_quantity
                .saturating_add(line.consumable_quantity)
                > 0
                && line
                    .retail_quantity
                    .saturating_add(line.consumable_quantity)
                    != line.quantity)
            || line.unit_cost_paise < 0
            || !(0..=10_000).contains(&line.discount_bps)
            || !(0..=100).contains(&line.gst_percent)
        {
            return Err(AppError::validation(
                "purchase order line values are invalid",
            ));
        }
        if !item_ids.insert(item_id.clone()) {
            return Err(AppError::validation(
                "each inventory item can appear only once in a purchase order",
            ));
        }
        let (_, discount_paise, taxable) =
            discounted_cost(line.unit_cost_paise, line.discount_bps, line.quantity);
        let tax = div_round(taxable.saturating_mul(i64::from(line.gst_percent)), 100);
        calculated.push((
            item_id,
            line.quantity,
            line.retail_quantity,
            line.consumable_quantity,
            line.unit_cost_paise,
            line.discount_bps,
            discount_paise,
            line.gst_percent,
            taxable,
            tax,
        ));
    }
    let taxable = calculated.iter().map(|line| line.8).sum();
    let tax = calculated.iter().map(|line| line.9).sum();
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase order transaction"))?;
    let order_id = purchase_repository::create_order(
        &mut tx,
        tenant_id,
        branch_id,
        &supplier_id,
        expected_date,
        input.notes.trim(),
        taxable,
        tax,
        input.shipping_paise,
        input.handling_paise,
        actor,
    )
    .await
    .map_err(|_| AppError::not_found("active supplier was not found"))?;
    for line in calculated {
        if !purchase_repository::create_order_line(
            &mut tx,
            tenant_id,
            branch_id,
            &order_id,
            &supplier_id,
            &line.0,
            line.1,
            line.2,
            line.3,
            line.4,
            line.5,
            line.6,
            line.7,
            line.8,
            line.9,
        )
        .await
        .map_err(|_| AppError::internal("failed to save purchase order line"))?
        {
            return Err(AppError::not_found(
                "active vendor-product-center association was not found",
            ));
        }
    }
    purchase_order_event_repository::add(
        &mut tx,
        tenant_id,
        branch_id,
        &order_id,
        "created",
        "",
        "draft",
        "",
        actor,
        &serde_json::json!({}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write purchase order event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase order"))?;
    order_details(state, tenant_id, branch_id, &order_id).await
}

pub async fn order_details(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<OrderDetails, AppError> {
    let order = purchase_repository::get_order(&state.db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase order"))?
        .ok_or_else(|| AppError::not_found("purchase order was not found"))?;
    let lines = purchase_repository::order_lines(&state.db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase order lines"))?;
    Ok(OrderDetails { order, lines })
}

pub async fn transition_order(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    action: &str,
    note: &str,
) -> Result<OrderDetails, AppError> {
    let current = purchase_repository::get_order(&state.db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load purchase order"))?
        .ok_or_else(|| AppError::not_found("purchase order was not found"))?;
    if action == "send" {
        let mut tx = state
            .db
            .begin()
            .await
            .map_err(|_| AppError::internal("failed to start purchase order send"))?;
        if !purchase_order_event_repository::mark_sent(&mut tx, tenant_id, branch_id, id)
            .await
            .map_err(|_| AppError::internal("failed to mark purchase order sent"))?
        {
            return Err(AppError::conflict(
                "only approved purchase orders can be sent",
            ));
        }
        purchase_order_event_repository::add(
            &mut tx,
            tenant_id,
            branch_id,
            id,
            "sent",
            &current.status,
            &current.status,
            note,
            actor,
            &serde_json::json!({}),
        )
        .await
        .map_err(|_| AppError::internal("failed to write purchase order send event"))?;
        tx.commit()
            .await
            .map_err(|_| AppError::internal("failed to commit purchase order send"))?;
        return order_details(state, tenant_id, branch_id, id).await;
    }
    let has_receipts =
        purchase_order_event_repository::has_receipts(&state.db, tenant_id, branch_id, id)
            .await
            .map_err(|_| AppError::internal("failed to inspect purchase order receipts"))?;
    let to = transition_target(&current.status, action, has_receipts).ok_or_else(|| {
        AppError::conflict("purchase order action is not allowed in its current state")
    })?;
    if matches!(action, "approve" | "reject") && current.created_by == actor {
        return Err(AppError::conflict(
            "purchase order creator cannot approve or reject the same order",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase order action"))?;
    let updated = purchase_repository::transition_order(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        &current.status,
        to,
        actor,
        note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to update purchase order"))?;
    if !updated {
        return Err(AppError::conflict(
            "purchase order status changed; reload and try again",
        ));
    }
    purchase_order_event_repository::set_timestamp(&mut tx, tenant_id, branch_id, id, to)
        .await
        .map_err(|_| AppError::internal("failed to timestamp purchase order action"))?;
    purchase_order_event_repository::add(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        action,
        &current.status,
        to,
        note.trim(),
        actor,
        &serde_json::json!({}),
    )
    .await
    .map_err(|_| AppError::internal("failed to write purchase order event"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase order action"))?;
    order_details(state, tenant_id, branch_id, id).await
}

fn transition_target(current: &str, action: &str, has_receipts: bool) -> Option<&'static str> {
    match (current, action) {
        ("draft", "submit") => Some("pending_approval"),
        ("pending_approval", "approve") => Some("approved"),
        ("pending_approval", "reject") => Some("rejected"),
        ("approved" | "partially_received", "close") => Some("closed"),
        ("draft" | "pending_approval" | "approved", "cancel") => Some("cancelled"),
        ("rejected" | "cancelled", "reopen") => Some("draft"),
        ("closed", "reopen") if has_receipts => Some("partially_received"),
        ("closed", "reopen") => Some("approved"),
        _ => None,
    }
}

#[derive(serde::Serialize)]
pub struct PriceUpdateReviewResult {
    pub id: String,
    pub status: String,
}

pub async fn review_price_update(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    approve: bool,
    note: &str,
) -> Result<PriceUpdateReviewResult, AppError> {
    if !approve && note.trim().is_empty() {
        return Err(AppError::validation(
            "review note is required when rejecting a price update",
        ));
    }
    if note.chars().count() > 500 {
        return Err(AppError::validation(
            "review note must be 500 characters or fewer",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start master price review"))?;
    let request = purchase_repository::lock_price_update_request(&mut tx, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to lock master price request"))?
        .ok_or_else(|| AppError::not_found("pending master price request was not found"))?;
    if request.requested_by == actor {
        return Err(AppError::conflict(
            "price update requester cannot approve their own request",
        ));
    }
    let status = if approve { "approved" } else { "rejected" };
    if approve {
        purchase_repository::apply_approved_supplier_price(
            &mut tx,
            tenant_id,
            branch_id,
            &request.supplier_id,
            &request.inventory_item_id,
            request.requested_unit_cost_paise,
            request.requested_discount_bps,
            request.requested_gst_percent,
            actor,
        )
        .await
        .map_err(|_| AppError::internal("failed to update supplier master price"))?;
    }
    if !purchase_repository::finish_price_update_request(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        status,
        actor,
        note.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to finish master price review"))?
    {
        return Err(AppError::conflict(
            "master price request changed; reload and try again",
        ));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit master price review"))?;
    Ok(PriceUpdateReviewResult {
        id: id.to_owned(),
        status: status.to_owned(),
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PurchaseOrderCsvRow {
    vendor_code: String,
    product_code: String,
    #[serde(default)]
    retail_qty: String,
    #[serde(default)]
    consumable_qty: String,
}

pub async fn import_order_csv(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    file_name: &str,
    csv_text: &str,
) -> Result<PurchaseOrderImportResult, AppError> {
    let file_name = file_name.trim();
    if file_name.is_empty()
        || file_name.chars().count() > 255
        || !file_name.to_ascii_lowercase().ends_with(".csv")
    {
        return Err(AppError::validation("fileName must be a CSV file name"));
    }
    if csv_text.is_empty() || csv_text.len() > 3 * 1024 * 1024 {
        return Err(AppError::validation("CSV must be between 1 byte and 3 MB"));
    }
    let mut reader = csv::ReaderBuilder::new()
        .trim(csv::Trim::All)
        .from_reader(csv_text.as_bytes());
    let mut supplier_code = String::new();
    let mut supplier_id = String::new();
    let mut rows = 0_usize;
    let mut lines = BTreeMap::<String, OrderLineInput>::new();
    for (index, result) in reader.deserialize::<PurchaseOrderCsvRow>().enumerate() {
        if index >= 1_000 {
            return Err(AppError::validation(
                "CSV cannot contain more than 1000 product rows",
            ));
        }
        let row = result.map_err(|error| {
            AppError::validation(format!("CSV row {} is invalid: {error}", index + 2))
        })?;
        let vendor_code = row.vendor_code.trim();
        let product_code = row.product_code.trim();
        if vendor_code.is_empty() || product_code.is_empty() {
            return Err(AppError::validation(format!(
                "CSV row {} requires VendorCode and ProductCode",
                index + 2
            )));
        }
        if supplier_code.is_empty() {
            supplier_code = vendor_code.to_owned();
        }
        if !supplier_code.eq_ignore_ascii_case(vendor_code) {
            return Err(AppError::validation(
                "one CSV import can contain only one VendorCode",
            ));
        }
        let retail = csv_quantity(&row.retail_qty, index + 2, "RetailQty")?;
        let consumable = csv_quantity(&row.consumable_qty, index + 2, "ConsumableQty")?;
        if retail + consumable <= 0 {
            return Err(AppError::validation(format!(
                "CSV row {} requires a positive retail or consumable quantity",
                index + 2
            )));
        }
        let product = purchase_repository::import_product(
            &state.db,
            tenant_id,
            branch_id,
            vendor_code,
            product_code,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate purchase import product"))?
        .ok_or_else(|| {
            AppError::validation(format!(
                "CSV row {} vendor/product association is unavailable",
                index + 2
            ))
        })?;
        if (retail > 0 && !matches!(product.product_usage.as_str(), "retail" | "dual_use"))
            || (consumable > 0
                && !matches!(product.product_usage.as_str(), "consumable" | "dual_use"))
        {
            return Err(AppError::validation(format!(
                "CSV row {} quantity does not match the product usage type",
                index + 2
            )));
        }
        let cost = product.unit_cost_paise.ok_or_else(|| {
            AppError::validation(format!(
                "CSV row {} has no active supplier price",
                index + 2
            ))
        })?;
        if supplier_id.is_empty() {
            supplier_id = product.supplier_id.clone();
        }
        if supplier_id != product.supplier_id {
            return Err(AppError::validation(
                "one CSV import can resolve to only one supplier",
            ));
        }
        let entry = lines
            .entry(product.inventory_item_id.clone())
            .or_insert(OrderLineInput {
                inventory_item_id: product.inventory_item_id,
                quantity: 0,
                retail_quantity: 0,
                consumable_quantity: 0,
                unit_cost_paise: cost,
                discount_bps: product.discount_bps.unwrap_or(0),
                gst_percent: product.gst_percent,
            });
        if entry.unit_cost_paise != cost {
            return Err(AppError::conflict(
                "supplier price changed while validating the CSV; reload and retry",
            ));
        }
        entry.retail_quantity = entry
            .retail_quantity
            .checked_add(retail)
            .ok_or_else(|| AppError::validation("CSV retail quantity is too large"))?;
        entry.consumable_quantity = entry
            .consumable_quantity
            .checked_add(consumable)
            .ok_or_else(|| AppError::validation("CSV consumable quantity is too large"))?;
        entry.quantity = entry
            .retail_quantity
            .checked_add(entry.consumable_quantity)
            .ok_or_else(|| AppError::validation("CSV total quantity is too large"))?;
        rows += 1;
    }
    if rows == 0 {
        return Err(AppError::validation(
            "CSV must contain at least one product row",
        ));
    }
    let order = create_order(
        state,
        tenant_id,
        branch_id,
        actor,
        OrderInput {
            supplier_id,
            expected_date: None,
            notes: format!("Imported from CSV: {file_name}"),
            shipping_paise: 0,
            handling_paise: 0,
            lines: lines.into_values().collect(),
        },
    )
    .await?;
    Ok(PurchaseOrderImportResult {
        file_name: file_name.to_owned(),
        rows_imported: rows,
        order,
    })
}
pub async fn create_return(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: ReturnInput,
) -> Result<CreatedId, AppError> {
    let receipt_id = required(input.purchase_receipt_id, "purchaseReceiptId is required")?;
    let reason = required(input.reason, "reason is required")?;
    let key = required(input.idempotency_key, "idempotencyKey is required")?;
    if input.lines.is_empty() {
        return Err(AppError::validation(
            "at least one purchase return line is required",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start purchase return transaction"))?;
    if let Some(id) = purchase_repository::return_replay(&mut tx, tenant_id, branch_id, &key)
        .await
        .map_err(|_| AppError::internal("failed to check purchase return retry"))?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish purchase return retry"))?;
        return Ok(CreatedId { id });
    }
    let mut seen = HashSet::new();
    let mut rows = Vec::with_capacity(input.lines.len());
    let mut total_taxable = 0_i64;
    let mut total_cgst = 0_i64;
    let mut total_sgst = 0_i64;
    let mut total_igst = 0_i64;
    for input_line in input.lines {
        let line_id = input_line.purchase_receipt_line_id.trim();
        if line_id.is_empty() || input_line.quantity <= 0 || !seen.insert(line_id.to_string()) {
            return Err(AppError::validation(
                "purchase return lines must be unique with positive quantity",
            ));
        }
        let line = purchase_repository::lock_receipt_line_for_return(
            &mut tx,
            tenant_id,
            branch_id,
            &receipt_id,
            line_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock purchase receipt line"))?
        .ok_or_else(|| AppError::not_found("purchase receipt line was not found"))?;
        let requested = i64::from(input_line.quantity);
        if line.returned_quantity.saturating_add(requested) > i64::from(line.quantity) {
            return Err(AppError::conflict(
                "purchase return quantity exceeds received quantity",
            ));
        }
        let item = purchase_repository::lock_inventory_item(
            &mut tx,
            tenant_id,
            branch_id,
            &line.inventory_item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to lock purchase return inventory"))?
        .ok_or_else(|| AppError::not_found("purchase return inventory item was not found"))?;
        let stock_quantity = base_quantity(input_line.quantity, line.units_per_package)?;
        if item.stock_quantity < stock_quantity {
            return Err(AppError::conflict(
                "purchase return would make stock negative",
            ));
        }
        let taxable = requested.saturating_mul(line.unit_cost_paise);
        let cumulative_quantity = line.returned_quantity.saturating_add(requested);
        let prior_tax = line.returned_tax_paise;
        let (cgst, sgst, igst) = return_tax_breakdown(
            line.cgst_paise,
            line.sgst_paise,
            line.igst_paise,
            cumulative_quantity,
            i64::from(line.quantity),
            prior_tax,
        );
        let tax = cgst.saturating_add(sgst).saturating_add(igst);
        total_taxable = total_taxable.saturating_add(taxable);
        total_cgst = total_cgst.saturating_add(cgst);
        total_sgst = total_sgst.saturating_add(sgst);
        total_igst = total_igst.saturating_add(igst);
        let next_stock = item.stock_quantity - stock_quantity;
        let next_cost = remaining_weighted_cost(
            item.stock_quantity,
            item.unit_cost_paise,
            stock_quantity,
            line.stock_unit_cost_paise,
        );
        rows.push((
            line,
            input_line.quantity,
            stock_quantity,
            next_stock,
            next_cost,
            taxable,
            tax,
        ));
    }
    let total_tax = total_cgst
        .saturating_add(total_sgst)
        .saturating_add(total_igst);
    let return_id = purchase_repository::create_return(
        &mut tx,
        tenant_id,
        branch_id,
        &receipt_id,
        &reason,
        total_taxable,
        total_tax,
        &key,
        actor,
    )
    .await
    .map_err(|_| AppError::conflict("purchase return retry conflicts with an existing request"))?;
    for (line, quantity, stock_quantity, next_stock, next_cost, taxable, tax) in rows {
        let return_line_id = purchase_repository::create_return_line(
            &mut tx,
            tenant_id,
            branch_id,
            &return_id,
            &line.id,
            &line.inventory_item_id,
            quantity,
            taxable,
            tax,
        )
        .await
        .map_err(|_| AppError::internal("failed to save purchase return line"))?;
        purchase_repository::apply_stock(
            &mut tx,
            tenant_id,
            branch_id,
            &line.inventory_item_id,
            next_stock,
            next_cost,
        )
        .await
        .map_err(|_| AppError::internal("failed to update purchase return stock"))?;
        let ledger_id = purchase_repository::add_return_ledger(
            &mut tx,
            tenant_id,
            branch_id,
            &line.inventory_item_id,
            &return_id,
            &return_line_id,
            stock_quantity,
            line.stock_unit_cost_paise,
            next_stock,
        )
        .await
        .map_err(|_| AppError::internal("failed to write purchase return stock ledger"))?;
        if line.batch_tracked {
            inventory_adjustment_service::allocate_named_batch(
                &mut tx,
                tenant_id,
                branch_id,
                &line.inventory_item_id,
                &line.batch_number,
                &ledger_id,
                stock_quantity,
            )
            .await?;
        }
    }
    accounting_service::post_purchase_return(
        &mut tx,
        tenant_id,
        branch_id,
        &return_id,
        total_taxable,
        total_cgst,
        total_sgst,
        total_igst,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit purchase return"))?;
    Ok(CreatedId { id: return_id })
}

fn split_supplier_payment(amount_paise: i64, balance_paise: i64) -> (i64, i64) {
    let applied_paise = amount_paise.min(balance_paise.max(0));
    (applied_paise, amount_paise - applied_paise)
}

pub async fn pay_supplier(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: SupplierPaymentInput,
) -> Result<SupplierPaymentRecord, AppError> {
    let receipt_id = required(input.purchase_receipt_id, "purchaseReceiptId is required")?;
    let key = required(input.idempotency_key, "idempotencyKey is required")?;
    let method = input.payment_method.trim().to_ascii_lowercase();
    if input.amount_paise <= 0
        || !matches!(method.as_str(), "cash" | "bank" | "upi" | "card" | "other")
    {
        return Err(AppError::validation(
            "supplier payment amount or method is invalid",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start supplier payment transaction"))?;
    if let Some(payment) =
        purchase_repository::supplier_payment_replay(&mut tx, tenant_id, branch_id, &key)
            .await
            .map_err(|_| AppError::internal("failed to check supplier payment retry"))?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish supplier payment retry"))?;
        return Ok(payment);
    }
    let balance =
        purchase_repository::payable_balance_for_update(&mut tx, tenant_id, branch_id, &receipt_id)
            .await
            .map_err(|_| AppError::internal("failed to lock supplier payable"))?
            .ok_or_else(|| AppError::not_found("supplier payable was not found"))?;
    let (applied_paise, advance_paise) = split_supplier_payment(input.amount_paise, balance);
    if applied_paise <= 0 {
        return Err(AppError::conflict("supplier payable is already settled"));
    }
    let payment = purchase_repository::create_supplier_payment(
        &mut tx,
        tenant_id,
        branch_id,
        &receipt_id,
        applied_paise,
        &method,
        input.reference.trim(),
        &key,
        actor,
    )
    .await
    .map_err(|_| AppError::conflict("supplier payment retry conflicts with an existing request"))?
    .ok_or_else(|| AppError::not_found("supplier payable was not found"))?;
    accounting_service::post_supplier_payment(
        &mut tx,
        tenant_id,
        branch_id,
        &payment.id,
        &method,
        applied_paise,
    )
    .await?;
    if advance_paise > 0 {
        let advance_key = format!("{key}:advance");
        let advance = purchase_repository::create_supplier_advance(
            &mut tx,
            tenant_id,
            branch_id,
            &payment.supplier_id,
            advance_paise,
            &method,
            input.reference.trim(),
            &advance_key,
            actor,
        )
        .await
        .map_err(|_| AppError::conflict("supplier payment advance could not be recorded"))?
        .ok_or_else(|| AppError::not_found("supplier was not found"))?;
        accounting_service::post_supplier_advance(
            &mut tx,
            tenant_id,
            branch_id,
            &advance.id,
            &method,
            advance_paise,
        )
        .await?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit supplier payment"))?;
    Ok(payment)
}

pub async fn record_supplier_advance(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    input: SupplierAdvanceInput,
) -> Result<SupplierAdvanceRecord, AppError> {
    let supplier_id = required(input.supplier_id, "supplierId is required")?;
    let key = required(input.idempotency_key, "idempotencyKey is required")?;
    let method = input.payment_method.trim().to_ascii_lowercase();
    if input.amount_paise <= 0
        || !matches!(method.as_str(), "cash" | "bank" | "upi" | "card" | "other")
    {
        return Err(AppError::validation(
            "supplier advance amount or method is invalid",
        ));
    }
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start supplier advance transaction"))?;
    if let Some(advance) =
        purchase_repository::supplier_advance_replay(&mut tx, tenant_id, branch_id, &key)
            .await
            .map_err(|_| AppError::internal("failed to check supplier advance retry"))?
    {
        tx.rollback()
            .await
            .map_err(|_| AppError::internal("failed to finish supplier advance retry"))?;
        return Ok(advance);
    }
    let advance = purchase_repository::create_supplier_advance(
        &mut tx,
        tenant_id,
        branch_id,
        &supplier_id,
        input.amount_paise,
        &method,
        input.reference.trim(),
        &key,
        actor,
    )
    .await
    .map_err(|_| AppError::conflict("supplier advance retry conflicts with an existing request"))?
    .ok_or_else(|| AppError::not_found("supplier was not found"))?;
    accounting_service::post_supplier_advance(
        &mut tx,
        tenant_id,
        branch_id,
        &advance.id,
        &method,
        input.amount_paise,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit supplier advance"))?;
    Ok(advance)
}

fn weighted_cost(
    old_quantity: i32,
    old_cost: i64,
    received_quantity: i32,
    received_cost: i64,
) -> i64 {
    let total_quantity = i64::from(old_quantity).saturating_add(i64::from(received_quantity));
    if total_quantity <= 0 {
        0
    } else {
        (i64::from(old_quantity)
            .saturating_mul(old_cost)
            .saturating_add(i64::from(received_quantity).saturating_mul(received_cost)))
            / total_quantity
    }
}

fn discounted_cost(
    gross_unit_cost_paise: i64,
    discount_bps: i32,
    quantity: i32,
) -> (i64, i64, i64) {
    let gross_paise = gross_unit_cost_paise.saturating_mul(i64::from(quantity));
    let discount_paise = div_round(gross_paise.saturating_mul(i64::from(discount_bps)), 10_000);
    let taxable_paise = gross_paise.saturating_sub(discount_paise);
    (
        div_round(taxable_paise, i64::from(quantity)),
        discount_paise,
        taxable_paise,
    )
}

fn receiving_variance(
    ordered_quantity: Option<i32>,
    delivered_quantity: i32,
    damaged_quantity: i32,
    rejected_quantity: i32,
) -> (i32, i32, i32, i32) {
    let accepted = delivered_quantity
        .saturating_sub(damaged_quantity)
        .saturating_sub(rejected_quantity);
    match ordered_quantity {
        Some(ordered) => (
            accepted,
            ordered.saturating_sub(accepted).max(0),
            accepted.saturating_sub(ordered).max(0),
            accepted.min(ordered),
        ),
        None => (accepted, 0, 0, 0),
    }
}

fn receiving_split(
    accepted: i32,
    retail: Option<i32>,
    consumable: Option<i32>,
    product_usage: &str,
    ordered_retail: Option<i32>,
    _ordered_consumable: Option<i32>,
) -> Result<(i32, i32), AppError> {
    if retail.is_some() || consumable.is_some() {
        let retail = retail.unwrap_or(0);
        let consumable = consumable.unwrap_or(0);
        if retail < 0
            || consumable < 0
            || retail.saturating_add(consumable) != accepted
            || (retail > 0 && !matches!(product_usage, "retail" | "dual_use"))
            || (consumable > 0 && !matches!(product_usage, "consumable" | "dual_use"))
        {
            return Err(AppError::validation("retailQuantity and consumableQuantity must equal accepted quantity and match product usage"));
        }
        return Ok((retail, consumable));
    }
    Ok(match product_usage {
        "consumable" => (0, accepted),
        "dual_use" if ordered_retail.is_some() => {
            let retail = accepted.min(ordered_retail.unwrap_or(0));
            (retail, accepted.saturating_sub(retail))
        }
        _ => (accepted, 0),
    })
}

fn price_difference_bps(current: i64, received: i64) -> i32 {
    if current <= 0 {
        return if received == current { 0 } else { 10_000 };
    }
    (i128::from(received.abs_diff(current)) * 10_000 / i128::from(current)).min(10_000) as i32
}

fn csv_quantity(value: &str, row: usize, field: &str) -> Result<i32, AppError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(0);
    }
    value
        .parse::<i32>()
        .ok()
        .filter(|quantity| *quantity >= 0)
        .ok_or_else(|| {
            AppError::validation(format!(
                "CSV row {row} {field} must be a non-negative whole number"
            ))
        })
}

fn proportional_allocations(total: i64, bases: &[i64]) -> Vec<i64> {
    let denominator: i128 = bases.iter().map(|value| i128::from(*value)).sum();
    if total <= 0 || denominator <= 0 {
        return vec![0; bases.len()];
    }
    let mut allocations = vec![0; bases.len()];
    let mut remainders = Vec::with_capacity(bases.len());
    for (index, base) in bases.iter().enumerate() {
        let numerator = i128::from(total) * i128::from(*base);
        allocations[index] = (numerator / denominator) as i64;
        remainders.push((index, numerator % denominator));
    }
    remainders.sort_by(|left, right| right.1.cmp(&left.1).then(left.0.cmp(&right.0)));
    let remainder = total.saturating_sub(allocations.iter().sum::<i64>());
    for (index, _) in remainders.into_iter().take(remainder as usize) {
        allocations[index] += 1;
    }
    allocations
}

fn reconcile_tax_totals(
    lines: &mut [CalculatedLine],
    targets: ReceiptTaxTotals,
) -> Result<(), AppError> {
    let cgst = reconcile_tax_component(
        targets.cgst_paise,
        &lines.iter().map(|line| line.cgst_paise).collect::<Vec<_>>(),
    )?;
    let sgst = reconcile_tax_component(
        targets.sgst_paise,
        &lines.iter().map(|line| line.sgst_paise).collect::<Vec<_>>(),
    )?;
    let igst = reconcile_tax_component(
        targets.igst_paise,
        &lines.iter().map(|line| line.igst_paise).collect::<Vec<_>>(),
    )?;
    for (index, line) in lines.iter_mut().enumerate() {
        line.cgst_paise = cgst[index];
        line.sgst_paise = sgst[index];
        line.igst_paise = igst[index];
    }
    Ok(())
}

fn reconcile_tax_component(target: i64, calculated: &[i64]) -> Result<Vec<i64>, AppError> {
    let calculated_total = calculated.iter().sum::<i64>();
    if target < 0
        || target.abs_diff(calculated_total) > calculated.len() as u64
        || (target > 0 && calculated_total == 0)
    {
        return Err(AppError::validation(
            "purchase bill header tax exceeds line rounding tolerance",
        ));
    }
    Ok(proportional_allocations(target, calculated))
}

fn div_round(value: i64, divisor: i64) -> i64 {
    if divisor <= 0 {
        0
    } else {
        ((i128::from(value) + i128::from(divisor / 2)) / i128::from(divisor)) as i64
    }
}

fn remaining_weighted_cost(
    stock_quantity: i32,
    average_cost: i64,
    removed_quantity: i32,
    removed_cost: i64,
) -> i64 {
    let remaining = i64::from(stock_quantity).saturating_sub(i64::from(removed_quantity));
    if remaining <= 0 {
        return 0;
    }
    let value = i64::from(stock_quantity)
        .saturating_mul(average_cost)
        .saturating_sub(i64::from(removed_quantity).saturating_mul(removed_cost));
    value.max(0) / remaining
}

fn return_tax_breakdown(
    original_cgst: i64,
    original_sgst: i64,
    original_igst: i64,
    cumulative_quantity: i64,
    received_quantity: i64,
    previously_returned_tax: i64,
) -> (i64, i64, i64) {
    let original_tax = original_cgst + original_sgst + original_igst;
    if original_tax <= 0 || received_quantity <= 0 {
        return (0, 0, 0);
    }
    let cumulative_tax = original_tax.saturating_mul(cumulative_quantity) / received_quantity;
    let tax = cumulative_tax.saturating_sub(previously_returned_tax);
    let cgst = tax.saturating_mul(original_cgst) / original_tax;
    let sgst = tax.saturating_mul(original_sgst) / original_tax;
    (cgst, sgst, tax.saturating_sub(cgst).saturating_sub(sgst))
}

fn base_quantity(packages: i32, units_per_package: i32) -> Result<i32, AppError> {
    packages
        .checked_mul(units_per_package)
        .filter(|quantity| *quantity >= 0)
        .ok_or_else(|| AppError::validation("package stock quantity exceeds supported range"))
}

fn required(value: String, message: &'static str) -> Result<String, AppError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(AppError::validation(message))
    } else {
        Ok(value)
    }
}
fn gstin(value: &str, field: &'static str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_uppercase();
    if value.is_empty() {
        return Ok(value);
    }
    if value.len() == 15 && value.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        Ok(value)
    } else {
        Err(AppError::validation(format!(
            "{field} must be a valid GSTIN"
        )))
    }
}
fn gst_state(gstin: &str) -> String {
    gstin
        .get(..2)
        .filter(|value| value.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or_default()
        .to_string()
}
fn parse_date(value: Option<&str>) -> Result<NaiveDate, AppError> {
    value
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map_err(|_| AppError::validation("receivedDate must be YYYY-MM-DD"))
        })
        .transpose()
        .map(|date| date.unwrap_or_else(|| Utc::now().date_naive()))
}

fn parse_optional_date(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveDate>, AppError> {
    value
        .filter(|raw| !raw.trim().is_empty())
        .map(|raw| {
            NaiveDate::parse_from_str(raw, "%Y-%m-%d")
                .map_err(|_| AppError::validation(format!("{field} must be YYYY-MM-DD")))
        })
        .transpose()
}

fn is_backdated_live_grn(status: &str, invoice_date: NaiveDate, cutover_date: NaiveDate) -> bool {
    status == "live" && invoice_date <= cutover_date
}

#[cfg(test)]
mod tests {
    use super::{
        base_quantity, csv_quantity, discounted_cost, div_round, is_backdated_live_grn,
        price_difference_bps, proportional_allocations, receiving_split, receiving_variance,
        reconcile_tax_component, remaining_weighted_cost, return_tax_breakdown,
        split_supplier_payment, transition_target, weighted_cost,
    };
    use chrono::NaiveDate;
    #[test]
    fn weighted_cost_uses_received_quantity() {
        assert_eq!(weighted_cost(10, 100, 10, 200), 150);
    }

    #[test]
    fn one_box_of_ten_kits_adds_ten_stock_units() {
        assert_eq!(base_quantity(1, 10).unwrap(), 10);
        assert_eq!(base_quantity(2 + 1, 10).unwrap(), 30); // two paid plus one free
        assert!(base_quantity(i32::MAX, 10).is_err());
    }

    #[test]
    fn purchase_order_completion_transitions_are_explicit() {
        assert_eq!(
            transition_target("approved", "close", false),
            Some("closed")
        );
        assert_eq!(
            transition_target("cancelled", "reopen", false),
            Some("draft")
        );
        assert_eq!(
            transition_target("closed", "reopen", true),
            Some("partially_received")
        );
        assert_eq!(transition_target("received", "cancel", true), None);
    }

    #[test]
    fn purchase_return_preserves_value_and_cumulative_tax() {
        assert_eq!(remaining_weighted_cost(20, 150, 5, 200), 133);
        assert_eq!(return_tax_breakdown(90, 90, 0, 5, 10, 0), (45, 45, 0));
        assert_eq!(return_tax_breakdown(90, 90, 0, 10, 10, 90), (45, 45, 0));
    }

    #[test]
    fn commercial_receiving_calculates_discount_and_variance() {
        assert_eq!(discounted_cost(10_000, 500, 12), (9_500, 6_000, 114_000));
        assert_eq!(
            discounted_cost(295_763, 3_000, 1),
            (207_034, 88_729, 207_034)
        );
        assert_eq!(div_round(207_034 * 18, 100), 37_266);
        assert_eq!(
            reconcile_tax_component(12, &[1, 1, 1, 1, 1, 1, 1, 1, 1])
                .unwrap()
                .iter()
                .sum::<i64>(),
            12
        );
        assert_eq!(receiving_variance(Some(10), 12, 1, 1), (10, 0, 0, 10));
        assert_eq!(receiving_variance(Some(10), 8, 1, 1), (6, 4, 0, 6));
        assert_eq!(receiving_variance(Some(10), 12, 0, 0), (12, 0, 2, 10));
        assert_eq!(
            receiving_split(7, Some(3), Some(4), "dual_use", Some(5), Some(5)).unwrap(),
            (3, 4)
        );
        assert!(receiving_split(7, Some(7), None, "consumable", None, None).is_err());
        assert_eq!(price_difference_bps(10_000, 11_000), 1_000);
        assert_eq!(csv_quantity("12", 2, "RetailQty").unwrap(), 12);
        assert!(csv_quantity("1.5", 2, "RetailQty").is_err());
        assert_eq!(
            proportional_allocations(101, &[300, 200, 100]),
            vec![50, 34, 17]
        );
        assert_eq!(div_round(5, 2), 3);
    }

    #[test]
    fn only_live_pre_cutover_invoices_need_backdated_approval() {
        let cutover = NaiveDate::from_ymd_opt(2026, 7, 29).unwrap();
        assert!(is_backdated_live_grn("live", cutover, cutover));
        assert!(!is_backdated_live_grn(
            "live",
            NaiveDate::from_ymd_opt(2026, 7, 30).unwrap(),
            cutover
        ));
        assert!(!is_backdated_live_grn("reconciled", cutover, cutover));
    }

    #[test]
    fn supplier_overpayment_is_split_into_settlement_and_advance() {
        assert_eq!(split_supplier_payment(10_000, 10_000), (10_000, 0));
        assert_eq!(split_supplier_payment(12_500, 10_000), (10_000, 2_500));
    }
}
