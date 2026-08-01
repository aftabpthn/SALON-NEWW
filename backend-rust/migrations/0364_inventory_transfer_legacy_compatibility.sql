UPDATE inventory_transfer_lines line
SET dispatched_retail_quantity=0,
    dispatched_consumable_quantity=0
FROM inventory_transfers transfer
WHERE transfer.tenant_id=line.tenant_id AND transfer.id=line.transfer_id
  AND transfer.status='cancelled';

INSERT INTO inventory_transfer_shipments(
  id,tenant_id,transfer_id,shipment_number,status,dispatched_by_user_id,dispatched_at,
  shipped_by_user_id,shipped_at,received_by_user_id,received_at,receipt_note,created_at
)
SELECT 'legacy-'||transfer.id,transfer.tenant_id,transfer.id,transfer.transfer_number||'-S1',
       CASE WHEN transfer.status='received' THEN 'received' ELSE 'in_transit' END,
       COALESCE(transfer.dispatched_by_user_id,transfer.created_by_user_id),
       COALESCE(transfer.dispatched_at,transfer.created_at),
       COALESCE(transfer.dispatched_by_user_id,transfer.created_by_user_id),
       COALESCE(transfer.dispatched_at,transfer.created_at),
       transfer.received_by_user_id,transfer.received_at,'Legacy transfer migrated to shipment lifecycle',
       COALESCE(transfer.dispatched_at,transfer.created_at)
FROM inventory_transfers transfer
WHERE transfer.status IN ('in_transit','received')
  AND NOT EXISTS (
    SELECT 1 FROM inventory_transfer_shipments shipment
    WHERE shipment.tenant_id=transfer.tenant_id AND shipment.transfer_id=transfer.id
  );

INSERT INTO inventory_transfer_shipment_lines(
  id,tenant_id,shipment_id,transfer_line_id,dispatched_retail_quantity,
  dispatched_consumable_quantity,received_retail_quantity,received_consumable_quantity,
  source_unit_cost_paise,transfer_unit_price_paise,discount_bps,gst_percent,
  taxable_paise,landed_cost_paise,landed_unit_cost_paise,source_stock_ledger_id,
  destination_stock_ledger_id,created_at
)
SELECT 'legacy-'||line.id,line.tenant_id,'legacy-'||transfer.id,line.id,
       line.dispatched_retail_quantity,line.dispatched_consumable_quantity,
       line.received_retail_quantity,line.received_consumable_quantity,
       line.unit_cost_paise,line.unit_cost_paise,0,0,
       (line.received_retail_quantity+line.received_consumable_quantity)::BIGINT*line.unit_cost_paise,
       (line.received_retail_quantity+line.received_consumable_quantity)::BIGINT*line.unit_cost_paise,
       line.unit_cost_paise,
       (SELECT ledger.id FROM inventory_stock_ledger ledger
        WHERE ledger.tenant_id=line.tenant_id AND ledger.inventory_transfer_line_id=line.id
          AND ledger.movement_type='transfer_out' ORDER BY ledger.created_at LIMIT 1),
       (SELECT ledger.id FROM inventory_stock_ledger ledger
        WHERE ledger.tenant_id=line.tenant_id AND ledger.inventory_transfer_line_id=line.id
          AND ledger.movement_type='transfer_in' ORDER BY ledger.created_at LIMIT 1),
       line.created_at
FROM inventory_transfer_lines line
JOIN inventory_transfers transfer ON transfer.tenant_id=line.tenant_id AND transfer.id=line.transfer_id
WHERE transfer.status IN ('in_transit','received')
ON CONFLICT(tenant_id,shipment_id,transfer_line_id) DO NOTHING;

UPDATE inventory_stock_ledger ledger
SET inventory_transfer_shipment_id='legacy-'||line.transfer_id,
    inventory_transfer_shipment_line_id='legacy-'||line.id
FROM inventory_transfer_lines line
JOIN inventory_transfers transfer ON transfer.tenant_id=line.tenant_id AND transfer.id=line.transfer_id
WHERE ledger.tenant_id=line.tenant_id AND ledger.inventory_transfer_line_id=line.id
  AND transfer.status IN ('in_transit','received')
  AND ledger.inventory_transfer_shipment_line_id IS NULL;
