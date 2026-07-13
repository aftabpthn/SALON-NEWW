use std::collections::HashSet;

use chrono::{NaiveDate, Utc};

use crate::{
    models::common::AppError,
    repositories::purchase_repository::{self, PurchaseReceipt, PurchaseReceiptLine},
    services::accounting_service,
    state::AppState,
};

pub struct ReceiptInput {
    pub supplier_name: String,
    pub supplier_gstin: String,
    pub supplier_invoice_number: String,
    pub received_date: Option<String>,
    pub idempotency_key: String,
    pub lines: Vec<ReceiptLineInput>,
}

pub struct ReceiptLineInput {
    pub inventory_item_id: String,
    pub quantity: i32,
    pub unit_cost_paise: i64,
    pub gst_percent: Option<i32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptDetails {
    pub receipt: PurchaseReceipt,
    pub lines: Vec<PurchaseReceiptLine>,
}

struct CalculatedLine {
    item_id: String,
    quantity: i32,
    unit_cost_paise: i64,
    gst_percent: i32,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    next_stock: i32,
    next_cost: i64,
}

pub async fn receive(
    state: &AppState,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    input: ReceiptInput,
) -> Result<ReceiptDetails, AppError> {
    let supplier_name = required(input.supplier_name, "supplierName is required")?;
    let invoice_number = required(
        input.supplier_invoice_number,
        "supplierInvoiceNumber is required",
    )?;
    let key = required(input.idempotency_key, "idempotencyKey is required")?;
    if input.lines.is_empty() {
        return Err(AppError::validation("at least one GRN line is required"));
    }
    let supplier_gstin = gstin(&input.supplier_gstin, "supplierGstin")?;
    let received_date = parse_date(input.received_date.as_deref())?;
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
        return Ok(ReceiptDetails { receipt, lines });
    }
    let buyer_gstin = purchase_repository::buyer_gstin(&mut tx, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to load business GST profile"))?;
    let buyer_state = gst_state(&buyer_gstin);
    let supplier_state = gst_state(&supplier_gstin);
    let mut calculated = Vec::with_capacity(input.lines.len());
    let mut item_ids = HashSet::new();
    for line in input.lines {
        if line.quantity <= 0
            || line.unit_cost_paise < 0
            || line.inventory_item_id.trim().is_empty()
        {
            return Err(AppError::validation(
                "GRN line requires item, positive quantity, and non-negative unitCostPaise",
            ));
        }
        if !item_ids.insert(line.inventory_item_id.trim().to_string()) {
            return Err(AppError::validation(
                "each inventory item can appear only once in a GRN",
            ));
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
        if gst_percent > 0 && (buyer_state.is_empty() || supplier_state.is_empty()) {
            return Err(AppError::validation(
                "registered business and supplier GSTIN are required for input GST",
            ));
        }
        let taxable = i64::from(line.quantity).saturating_mul(line.unit_cost_paise);
        let tax = taxable.saturating_mul(i64::from(gst_percent)) / 100;
        let (cgst, sgst, igst) = if gst_percent == 0 {
            (0, 0, 0)
        } else if buyer_state == supplier_state {
            (tax / 2, tax - (tax / 2), 0)
        } else {
            (0, 0, tax)
        };
        let next_stock_i64 =
            i64::from(item.stock_quantity).saturating_add(i64::from(line.quantity));
        if next_stock_i64 > i64::from(i32::MAX) {
            return Err(AppError::validation(
                "GRN stock quantity exceeds supported range",
            ));
        }
        let next_cost = weighted_cost(
            item.stock_quantity,
            item.unit_cost_paise,
            line.quantity,
            line.unit_cost_paise,
        );
        calculated.push(CalculatedLine {
            item_id: line.inventory_item_id.trim().to_string(),
            quantity: line.quantity,
            unit_cost_paise: line.unit_cost_paise,
            gst_percent,
            taxable_paise: taxable,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            next_stock: next_stock_i64 as i32,
            next_cost,
        });
    }
    let taxable = calculated.iter().map(|line| line.taxable_paise).sum();
    let cgst = calculated.iter().map(|line| line.cgst_paise).sum();
    let sgst = calculated.iter().map(|line| line.sgst_paise).sum();
    let igst = calculated.iter().map(|line| line.igst_paise).sum();
    let receipt = purchase_repository::create_receipt(
        &mut tx,
        tenant_id,
        branch_id,
        &supplier_name,
        &supplier_gstin,
        &supplier_state,
        &invoice_number,
        received_date,
        taxable,
        cgst,
        sgst,
        igst,
        actor_user_id,
        &key,
    )
    .await
    .map_err(|_| AppError::conflict("supplier invoice or idempotency key already exists"))?;
    let mut saved_lines = Vec::with_capacity(calculated.len());
    for line in calculated {
        let saved = purchase_repository::create_line(
            &mut tx,
            tenant_id,
            branch_id,
            &receipt.id,
            &line.item_id,
            line.quantity,
            line.unit_cost_paise,
            line.gst_percent,
            line.taxable_paise,
            line.cgst_paise,
            line.sgst_paise,
            line.igst_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to save GRN line"))?;
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
        purchase_repository::add_stock_ledger(
            &mut tx,
            tenant_id,
            branch_id,
            &line.item_id,
            &receipt.id,
            &saved.id,
            line.quantity,
            line.unit_cost_paise,
        )
        .await
        .map_err(|_| AppError::internal("failed to write GRN stock ledger"))?;
        saved_lines.push(saved);
    }
    accounting_service::post_purchase_grn(
        &mut tx,
        tenant_id,
        branch_id,
        &receipt.id,
        receipt.taxable_paise,
        receipt.cgst_paise,
        receipt.sgst_paise,
        receipt.igst_paise,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit GRN"))?;
    Ok(ReceiptDetails {
        receipt,
        lines: saved_lines,
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
    Ok(ReceiptDetails { receipt, lines })
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

#[cfg(test)]
mod tests {
    use super::weighted_cost;
    #[test]
    fn weighted_cost_uses_received_quantity() {
        assert_eq!(weighted_cost(10, 100, 10, 200), 150);
    }
}
