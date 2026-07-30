CREATE OR REPLACE VIEW inventory_digital_twin_ledger AS
WITH sequenced AS (
  SELECT
    ledger.*,
    item.stock_quantity AS current_stock_quantity,
    (
      item.stock_quantity::BIGINT
      - COALESCE(
          SUM(ledger.quantity_delta::BIGINT) OVER (
            PARTITION BY ledger.tenant_id, ledger.branch_id, ledger.inventory_item_id
            ORDER BY ledger.created_at DESC, ledger.id DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        )
    )::INTEGER AS computed_stock_after_quantity
  FROM inventory_stock_ledger ledger
  JOIN inventory_items item
    ON item.id = ledger.inventory_item_id
   AND item.tenant_id = ledger.tenant_id
   AND item.branch_id = ledger.branch_id
)
SELECT
  ledger.id,
  ledger.tenant_id,
  ledger.branch_id,
  ledger.inventory_item_id,
  ledger.movement_type,
  ledger.quantity_delta,
  ledger.unit_cost_paise,
  ledger.quantity_delta::BIGINT * ledger.unit_cost_paise AS value_paise,
  ledger.computed_stock_after_quantity - ledger.quantity_delta AS stock_before_quantity,
  ledger.computed_stock_after_quantity AS stock_after_quantity,
  ledger.stock_after_quantity AS recorded_stock_after_quantity,
  CASE
    WHEN count_session.id IS NOT NULL THEN 'stock_count'
    WHEN negative_request.id IS NOT NULL THEN 'negative_stock_approval'
    WHEN container.id IS NOT NULL THEN 'backbar_container'
    WHEN usage.id IS NOT NULL THEN 'backbar_usage'
    WHEN kit.id IS NOT NULL THEN 'kit_assembly'
    WHEN ledger.refund_id IS NOT NULL THEN 'pos_refund'
    WHEN sale.id IS NOT NULL THEN 'pos_sale'
    WHEN receipt.id IS NOT NULL THEN 'purchase_receipt'
    WHEN transfer.id IS NOT NULL THEN 'inventory_transfer'
    WHEN purchase_return.id IS NOT NULL THEN 'purchase_return'
    WHEN ledger.movement_type = 'adjustment' THEN 'inventory_adjustment'
    ELSE 'unknown'
  END AS source_type,
  COALESCE(
    count_session.id,
    negative_request.id,
    container.id,
    usage.id,
    kit.id,
    ledger.refund_id,
    sale.id,
    receipt.id,
    transfer.id,
    purchase_return.id,
    CASE WHEN ledger.movement_type = 'adjustment' THEN ledger.id END,
    ''
  ) AS source_id,
  COALESCE(
    NULLIF(count_session.name, ''),
    NULLIF(negative_request.reason, ''),
    NULLIF(container.barcode, ''),
    NULLIF(service.name, ''),
    NULLIF(usage.notes, ''),
    NULLIF(kit.id, ''),
    NULLIF(refund.reason, ''),
    NULLIF(sale.invoice_number, ''),
    NULLIF(receipt.supplier_invoice_number, ''),
    NULLIF(transfer.id, ''),
    NULLIF(purchase_return.reason, ''),
    NULLIF(ledger.adjustment_reason, ''),
    ''
  ) AS source_label,
  COALESCE(
    NULLIF(receipt.actor_user_id, ''),
    NULLIF(purchase_return.created_by, ''),
    NULLIF(usage.actor_user_id, ''),
    NULLIF(kit.actor_user_id, ''),
    NULLIF(container.opened_by, ''),
    NULLIF(negative_request.reviewed_by, ''),
    NULLIF(negative_request.requested_by, ''),
    NULLIF(count_session.approved_by, ''),
    NULLIF(count_session.submitted_by, ''),
    NULLIF(count_session.created_by, ''),
    CASE ledger.movement_type
      WHEN 'transfer_in' THEN NULLIF(transfer.received_by_user_id, '')
      WHEN 'transfer_reversal' THEN NULLIF(transfer.cancelled_by_user_id, '')
      ELSE NULLIF(transfer.dispatched_by_user_id, '')
    END,
    pos_actor.actor_user_id
  ) AS actor_user_id,
  COALESCE(NULLIF(usage.client_id, ''), NULLIF(sale.client_id, '')) AS client_id,
  NULLIF(usage.appointment_id, '') AS appointment_id,
  NULLIF(usage.service_id, '') AS service_id,
  COALESCE(NULLIF(usage.staff_id, ''), NULLIF(sale.staff_id, '')) AS staff_id,
  ledger.backbar_container_id,
  batch_evidence.batch_allocations,
  (
    ledger.movement_type = 'adjustment'
    OR count_session.id IS NOT NULL
    OR negative_request.id IS NOT NULL
    OR container.id IS NOT NULL
    OR usage.id IS NOT NULL
    OR kit.id IS NOT NULL
    OR ledger.refund_id IS NOT NULL
    OR sale.id IS NOT NULL
    OR receipt.id IS NOT NULL
    OR transfer.id IS NOT NULL
    OR purchase_return.id IS NOT NULL
  ) AS provenance_complete,
  CASE
    WHEN ledger.stock_after_quantity IS NULL THEN 'reconstructed'
    WHEN ledger.stock_after_quantity = ledger.computed_stock_after_quantity THEN 'verified'
    ELSE 'mismatch'
  END AS snapshot_status,
  ledger.created_at
FROM sequenced ledger
LEFT JOIN pos_sales sale
  ON sale.id = ledger.sale_id
 AND sale.tenant_id = ledger.tenant_id
 AND sale.branch_id = ledger.branch_id
LEFT JOIN pos_invoice_refunds refund
  ON refund.id = ledger.refund_id
 AND refund.tenant_id = ledger.tenant_id
 AND refund.branch_id = ledger.branch_id
LEFT JOIN purchase_receipts receipt
  ON receipt.id = ledger.purchase_receipt_id
 AND receipt.tenant_id = ledger.tenant_id
 AND receipt.branch_id = ledger.branch_id
LEFT JOIN inventory_transfers transfer
  ON transfer.id = ledger.inventory_transfer_id
 AND transfer.tenant_id = ledger.tenant_id
LEFT JOIN purchase_returns purchase_return
  ON purchase_return.id = ledger.purchase_return_id
 AND purchase_return.tenant_id = ledger.tenant_id
 AND purchase_return.branch_id = ledger.branch_id
LEFT JOIN inventory_backbar_usage usage
  ON usage.id = ledger.backbar_usage_id
 AND usage.tenant_id = ledger.tenant_id
 AND usage.branch_id = ledger.branch_id
LEFT JOIN services service
  ON service.id = usage.service_id
 AND service.tenant_id = usage.tenant_id
 AND service.branch_id = usage.branch_id
LEFT JOIN inventory_kit_assemblies kit
  ON kit.id = ledger.kit_assembly_id
 AND kit.tenant_id = ledger.tenant_id
 AND kit.branch_id = ledger.branch_id
LEFT JOIN inventory_backbar_containers container
  ON container.id = ledger.backbar_container_id
 AND container.tenant_id = ledger.tenant_id
 AND container.branch_id = ledger.branch_id
LEFT JOIN inventory_negative_stock_requests negative_request
  ON negative_request.id = ledger.negative_stock_request_id
 AND negative_request.tenant_id = ledger.tenant_id
 AND negative_request.branch_id = ledger.branch_id
LEFT JOIN stock_count_session_items count_item
  ON count_item.adjustment_ledger_id = ledger.id
 AND count_item.tenant_id = ledger.tenant_id
 AND count_item.branch_id = ledger.branch_id
LEFT JOIN stock_count_sessions count_session
  ON count_session.id = count_item.session_id
 AND count_session.tenant_id = count_item.tenant_id
 AND count_session.branch_id = count_item.branch_id
LEFT JOIN LATERAL (
  SELECT NULLIF(event.actor_user_id, '') AS actor_user_id
  FROM pos_invoice_events event
  WHERE event.tenant_id = ledger.tenant_id
    AND event.branch_id = ledger.branch_id
    AND event.sale_id = ledger.sale_id
    AND BTRIM(event.actor_user_id) <> ''
  ORDER BY ABS(EXTRACT(EPOCH FROM (event.created_at - ledger.created_at))), event.created_at DESC
  LIMIT 1
) pos_actor ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batchId', batch.id,
        'batchNumber', batch.batch_number,
        'expiryDate', batch.expiry_date,
        'quantityDelta', movement.quantity_delta
      ) ORDER BY batch.expiry_date NULLS LAST, batch.received_date, batch.batch_number
    ),
    '[]'::JSONB
  ) AS batch_allocations
  FROM inventory_batch_movements movement
  JOIN inventory_batches batch
    ON batch.id = movement.batch_id
   AND batch.tenant_id = movement.tenant_id
   AND batch.branch_id = movement.branch_id
  WHERE movement.tenant_id = ledger.tenant_id
    AND movement.branch_id = ledger.branch_id
    AND movement.stock_ledger_id = ledger.id
) batch_evidence ON TRUE;

COMMENT ON VIEW inventory_digital_twin_ledger IS
  'Canonical read-only inventory movement projection with reconstructed snapshots, normalized provenance, attribution and batch evidence.';
