use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};

#[derive(Debug, sqlx::FromRow)]
pub struct SupplierCommunicationDelivery {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub channel: String,
    pub destination: String,
    pub subject: String,
    pub message: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub correlation_id: String,
}
pub async fn policy(db: &PgPool, tenant: &str, branch: &str) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('negativeStockRule',negative_stock_rule,'valuationMethod',valuation_method,'expiryWindowDays',expiry_window_days,'countVarianceThresholdBps',count_variance_threshold_bps,'reorderHistoryDays',reorder_history_days,'reorderCoverageDays',reorder_coverage_days,'transferBaseTransportCostPaise',transfer_base_transport_cost_paise,'transferCostPerKmPaise',transfer_cost_per_km_paise,'transferHandlingCostPerUnitPaise',transfer_handling_cost_per_unit_paise,'transferDelayCostPerUnitDayPaise',transfer_delay_cost_per_unit_day_paise,'transferExpectedDays',transfer_expected_days,'approvalMatrix',approval_matrix,'updatedBy',updated_by,'updatedAt',updated_at) FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant).bind(branch).fetch_optional(db).await
}

pub async fn save_policy(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    negative: &str,
    valuation: &str,
    expiry: i32,
    threshold: i32,
    reorder_history_days: i32,
    reorder_coverage_days: i32,
    transfer_base_transport_cost_paise: Option<i64>,
    transfer_cost_per_km_paise: Option<i64>,
    transfer_handling_cost_per_unit_paise: Option<i64>,
    transfer_delay_cost_per_unit_day_paise: Option<i64>,
    transfer_expected_days: Option<i32>,
    matrix: &Value,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_policies(tenant_id,branch_id,negative_stock_rule,valuation_method,expiry_window_days,count_variance_threshold_bps,reorder_history_days,reorder_coverage_days,transfer_base_transport_cost_paise,transfer_cost_per_km_paise,transfer_handling_cost_per_unit_paise,transfer_delay_cost_per_unit_day_paise,transfer_expected_days,approval_matrix,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET negative_stock_rule=EXCLUDED.negative_stock_rule,valuation_method=EXCLUDED.valuation_method,expiry_window_days=EXCLUDED.expiry_window_days,count_variance_threshold_bps=EXCLUDED.count_variance_threshold_bps,reorder_history_days=EXCLUDED.reorder_history_days,reorder_coverage_days=EXCLUDED.reorder_coverage_days,transfer_base_transport_cost_paise=COALESCE(EXCLUDED.transfer_base_transport_cost_paise,inventory_policies.transfer_base_transport_cost_paise),transfer_cost_per_km_paise=COALESCE(EXCLUDED.transfer_cost_per_km_paise,inventory_policies.transfer_cost_per_km_paise),transfer_handling_cost_per_unit_paise=COALESCE(EXCLUDED.transfer_handling_cost_per_unit_paise,inventory_policies.transfer_handling_cost_per_unit_paise),transfer_delay_cost_per_unit_day_paise=COALESCE(EXCLUDED.transfer_delay_cost_per_unit_day_paise,inventory_policies.transfer_delay_cost_per_unit_day_paise),transfer_expected_days=COALESCE(EXCLUDED.transfer_expected_days,inventory_policies.transfer_expected_days),approval_matrix=EXCLUDED.approval_matrix,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING jsonb_build_object('negativeStockRule',negative_stock_rule,'valuationMethod',valuation_method,'expiryWindowDays',expiry_window_days,'countVarianceThresholdBps',count_variance_threshold_bps,'reorderHistoryDays',reorder_history_days,'reorderCoverageDays',reorder_coverage_days,'transferBaseTransportCostPaise',transfer_base_transport_cost_paise,'transferCostPerKmPaise',transfer_cost_per_km_paise,'transferHandlingCostPerUnitPaise',transfer_handling_cost_per_unit_paise,'transferDelayCostPerUnitDayPaise',transfer_delay_cost_per_unit_day_paise,'transferExpectedDays',transfer_expected_days,'approvalMatrix',approval_matrix,'updatedBy',updated_by,'updatedAt',updated_at)")
        .bind(tenant).bind(branch).bind(negative).bind(valuation).bind(expiry).bind(threshold).bind(reorder_history_days).bind(reorder_coverage_days).bind(transfer_base_transport_cost_paise).bind(transfer_cost_per_km_paise).bind(transfer_handling_cost_per_unit_paise).bind(transfer_delay_cost_per_unit_day_paise).bind(transfer_expected_days).bind(matrix).bind(actor).fetch_one(db).await
}

pub async fn supplier_governance(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier: Option<&str>,
) -> Result<Value, sqlx::Error> {
    let price_lists=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',p.id,'supplierId',p.supplier_id,'supplierName',s.name,'inventoryItemId',p.inventory_item_id,'productName',i.name,'unitCostPaise',p.unit_cost_paise,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to) FROM supplier_price_lists p JOIN suppliers s ON s.id=p.supplier_id JOIN inventory_items i ON i.id=p.inventory_item_id WHERE p.tenant_id=$1 AND p.branch_id=$2 AND ($3::TEXT IS NULL OR p.supplier_id=$3) ORDER BY p.effective_from DESC,p.created_at DESC LIMIT 500")
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let terms=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',t.id,'supplierId',t.supplier_id,'supplierName',s.name,'inventoryItemId',t.inventory_item_id,'productName',i.name,'leadTimeDays',t.lead_time_days,'minimumOrderQuantity',t.minimum_order_quantity,'packSize',t.pack_size,'safetyStockDays',t.safety_stock_days,'active',t.active) FROM supplier_inventory_terms t JOIN suppliers s ON s.id=t.supplier_id JOIN inventory_items i ON i.id=t.inventory_item_id WHERE t.tenant_id=$1 AND t.branch_id=$2 AND ($3::TEXT IS NULL OR t.supplier_id=$3) ORDER BY s.name,i.name")
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let scorecards=sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object(
        'supplierId',s.id,'supplierName',s.name,'purchaseOrders',COUNT(DISTINCT po.id),
        'receivedOrders',COUNT(DISTINCT pr.purchase_order_id),
        'onTimeOrders',COUNT(DISTINCT pr.purchase_order_id) FILTER (WHERE po.expected_date IS NULL OR pr.received_date<=po.expected_date),
        'orderedQuantity',COALESCE(SUM(pol.quantity),0),'receivedQuantity',COALESCE(SUM(pol.received_quantity),0),
        'onTimeRateBps',CASE WHEN COUNT(DISTINCT pr.purchase_order_id)=0 THEN NULL ELSE (10000*COUNT(DISTINCT pr.purchase_order_id) FILTER (WHERE po.expected_date IS NULL OR pr.received_date<=po.expected_date)/COUNT(DISTINCT pr.purchase_order_id))::INT END,
        'fillRateBps',CASE WHEN COALESCE(SUM(pol.quantity),0)=0 THEN NULL ELSE LEAST(10000,(10000*SUM(pol.received_quantity)/SUM(pol.quantity))::INT) END,
        'lastReceiptDate',MAX(pr.received_date))
      FROM suppliers s LEFT JOIN purchase_orders po ON po.tenant_id=s.tenant_id AND po.branch_id=s.branch_id AND po.supplier_id=s.id
      LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id=po.id
      LEFT JOIN purchase_receipts pr ON pr.purchase_order_id=po.id AND pr.tenant_id=po.tenant_id AND pr.branch_id=po.branch_id AND pr.rolled_back_at IS NULL
      WHERE s.tenant_id=$1 AND s.branch_id=$2 AND ($3::TEXT IS NULL OR s.id=$3)
      GROUP BY s.id,s.name ORDER BY s.name"#).bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let communications=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',q.id,'supplierId',q.supplier_id,'supplierName',s.name,'purchaseOrderId',q.purchase_order_id,'channel',q.channel,'destination',q.destination,'subject',q.subject,'message',q.message,'status',q.status,'attempts',q.attempts,'lastError',q.last_error,'createdAt',q.created_at,'sentAt',q.sent_at) FROM supplier_communication_queue q JOIN suppliers s ON s.id=q.supplier_id WHERE q.tenant_id=$1 AND q.branch_id=$2 AND ($3::TEXT IS NULL OR q.supplier_id=$3) ORDER BY q.created_at DESC LIMIT 200")
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let quality_events=sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object(
        'supplierId',s.id,'supplierName',s.name,'returnCount',COUNT(DISTINCT ret.id),
        'returnedQuantity',COALESCE(SUM(line.quantity),0),'returnedValuePaise',COALESCE(SUM(line.total_paise),0),
        'lastReturnAt',MAX(ret.created_at),
        'reasons',COALESCE(jsonb_agg(DISTINCT ret.reason) FILTER (WHERE ret.reason IS NOT NULL),'[]'::JSONB))
      FROM suppliers s
      JOIN purchase_returns ret ON ret.tenant_id=s.tenant_id AND ret.branch_id=s.branch_id AND ret.supplier_id=s.id
      LEFT JOIN purchase_return_lines line ON line.purchase_return_id=ret.id AND line.tenant_id=ret.tenant_id AND line.branch_id=ret.branch_id
      WHERE s.tenant_id=$1 AND s.branch_id=$2 AND ($3::TEXT IS NULL OR s.id=$3)
      GROUP BY s.id,s.name ORDER BY MAX(ret.created_at) DESC"#)
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let expiry_risk=sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object(
        'supplierId',receipt.supplier_id,'supplierName',receipt.supplier_name,
        'expiredQuantity',COALESCE(SUM(batch.quantity) FILTER (WHERE batch.expiry_date<CURRENT_DATE),0),
        'expiring30Quantity',COALESCE(SUM(batch.quantity) FILTER (WHERE batch.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0),
        'riskValuePaise',COALESCE(SUM(batch.quantity::BIGINT*batch.unit_cost_paise)
          FILTER (WHERE batch.expiry_date<=CURRENT_DATE+30),0),
        'nextExpiryDate',MIN(batch.expiry_date) FILTER (WHERE batch.quantity>0))
      FROM purchase_receipts receipt
      JOIN purchase_receipt_lines line ON line.purchase_receipt_id=receipt.id
        AND line.tenant_id=receipt.tenant_id AND line.branch_id=receipt.branch_id
      JOIN inventory_batches batch ON batch.tenant_id=line.tenant_id AND batch.branch_id=line.branch_id
        AND batch.inventory_item_id=line.inventory_item_id AND batch.batch_number=line.batch_number
      WHERE receipt.tenant_id=$1 AND receipt.branch_id=$2 AND receipt.rolled_back_at IS NULL AND batch.quantity>0
        AND ($3::TEXT IS NULL OR receipt.supplier_id=$3)
      GROUP BY receipt.supplier_id,receipt.supplier_name ORDER BY receipt.supplier_name"#)
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let replacement_options=sqlx::query_scalar::<_,Value>(r#"SELECT jsonb_build_object(
        'supplierId',base.supplier_id,'inventoryItemId',base.inventory_item_id,'productName',item.name,
        'replacementSupplierId',alternative.supplier_id,'replacementSupplierName',replacement.name,
        'leadTimeDays',alternative.lead_time_days,'minimumOrderQuantity',alternative.minimum_order_quantity,
        'packSize',alternative.pack_size,'unitCostPaise',alternative_price.unit_cost_paise,
        'currentUnitCostPaise',base_price.unit_cost_paise,
        'priceDifferencePaise',CASE WHEN alternative_price.unit_cost_paise IS NULL OR base_price.unit_cost_paise IS NULL
          THEN NULL ELSE alternative_price.unit_cost_paise-base_price.unit_cost_paise END)
      FROM supplier_inventory_terms base
      JOIN inventory_items item ON item.id=base.inventory_item_id AND item.tenant_id=base.tenant_id AND item.branch_id=base.branch_id
      JOIN supplier_inventory_terms alternative ON alternative.tenant_id=base.tenant_id AND alternative.branch_id=base.branch_id
        AND alternative.inventory_item_id=base.inventory_item_id AND alternative.supplier_id<>base.supplier_id AND alternative.active=TRUE
      JOIN suppliers replacement ON replacement.id=alternative.supplier_id AND replacement.tenant_id=alternative.tenant_id
        AND replacement.branch_id=alternative.branch_id AND replacement.active=TRUE
      LEFT JOIN LATERAL (SELECT unit_cost_paise FROM supplier_price_lists price WHERE price.tenant_id=base.tenant_id
        AND price.branch_id=base.branch_id AND price.supplier_id=base.supplier_id AND price.inventory_item_id=base.inventory_item_id
        AND price.effective_from<=CURRENT_DATE AND (price.effective_to IS NULL OR price.effective_to>=CURRENT_DATE)
        ORDER BY price.effective_from DESC LIMIT 1) base_price ON TRUE
      LEFT JOIN LATERAL (SELECT unit_cost_paise FROM supplier_price_lists price WHERE price.tenant_id=alternative.tenant_id
        AND price.branch_id=alternative.branch_id AND price.supplier_id=alternative.supplier_id AND price.inventory_item_id=alternative.inventory_item_id
        AND price.effective_from<=CURRENT_DATE AND (price.effective_to IS NULL OR price.effective_to>=CURRENT_DATE)
        ORDER BY price.effective_from DESC LIMIT 1) alternative_price ON TRUE
      WHERE base.tenant_id=$1 AND base.branch_id=$2 AND base.active=TRUE
        AND ($3::TEXT IS NULL OR base.supplier_id=$3)
      ORDER BY item.name,alternative_price.unit_cost_paise NULLS LAST,alternative.lead_time_days LIMIT 500"#)
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    Ok(
        serde_json::json!({"priceLists":price_lists,"terms":terms,"scorecards":scorecards,"communications":communications,"qualityEvents":quality_events,"expiryRisk":expiry_risk,"replacementOptions":replacement_options}),
    )
}

pub async fn save_price(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    supplier: &str,
    item: &str,
    cost: i64,
    from: &str,
    to: Option<&str>,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO supplier_price_lists(tenant_id,branch_id,supplier_id,inventory_item_id,unit_cost_paise,effective_from,effective_to,created_by) SELECT $1,$2,s.id,i.id,$5,$6::DATE,$7::DATE,$8 FROM suppliers s JOIN inventory_items i ON i.tenant_id=s.tenant_id AND i.branch_id=s.branch_id WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND i.id=$4 RETURNING jsonb_build_object('id',id,'supplierId',supplier_id,'inventoryItemId',inventory_item_id,'unitCostPaise',unit_cost_paise,'effectiveFrom',effective_from,'effectiveTo',effective_to)")
        .bind(tenant).bind(branch).bind(supplier).bind(item).bind(cost).bind(from).bind(to).bind(actor).fetch_one(db).await
}

pub async fn queue_communication(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    supplier: &str,
    po: Option<&str>,
    channel: &str,
    destination: &str,
    subject: &str,
    message: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO supplier_communication_queue(tenant_id,branch_id,supplier_id,purchase_order_id,channel,destination,subject,message,idempotency_key,created_by) SELECT $1,$2,s.id,po.id,$5,$6,$7,$8,$9,$10 FROM suppliers s LEFT JOIN purchase_orders po ON po.tenant_id=s.tenant_id AND po.branch_id=s.branch_id AND po.id=$4 WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND ($4::TEXT IS NULL OR po.id IS NOT NULL) ON CONFLICT(tenant_id,branch_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING jsonb_build_object('id',id,'status',status,'createdAt',created_at)")
        .bind(tenant).bind(branch).bind(supplier).bind(po).bind(channel).bind(destination).bind(subject).bind(message).bind(key).bind(actor).fetch_one(db).await
}

pub async fn claim_due_communications(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<SupplierCommunicationDelivery>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let rows = sqlx::query_as::<_, SupplierCommunicationDelivery>(
        r#"
        WITH due AS (
          SELECT id FROM supplier_communication_queue
          WHERE attempts < max_attempts AND (
            (status IN ('queued','failed') AND next_attempt_at <= NOW()) OR
            (status='processing' AND (processing_started_at IS NULL OR processing_started_at < NOW()-INTERVAL '15 minutes'))
          )
          ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1
        )
        UPDATE supplier_communication_queue q
        SET status='processing', attempts=q.attempts+1,
            processing_started_at=NOW(), updated_at=NOW()
        FROM due WHERE q.id=due.id
        RETURNING q.id,q.tenant_id,q.branch_id,q.channel,q.destination,q.subject,
                  q.message,q.attempts,q.max_attempts,q.correlation_id
    "#,
    )
    .bind(limit.clamp(1, 100))
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows)
}

pub async fn mark_communication_sent(
    db: &PgPool,
    id: &str,
    provider_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE supplier_communication_queue SET status='sent',provider_message_id=$2,last_error='',sent_at=NOW(),processing_started_at=NULL,updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(id).bind(provider_id).execute(db).await?;
    Ok(())
}

pub async fn mark_communication_failed(
    db: &PgPool,
    row: &SupplierCommunicationDelivery,
    error: &str,
) -> Result<(), sqlx::Error> {
    let retry_minutes = i64::from(row.attempts.max(1)).saturating_mul(5).min(360);
    sqlx::query("UPDATE supplier_communication_queue SET status='failed',last_error=$2,next_attempt_at=NOW()+($3::BIGINT*INTERVAL '1 minute'),processing_started_at=NULL,updated_at=NOW() WHERE id=$1 AND status='processing'")
        .bind(&row.id).bind(error.chars().take(1000).collect::<String>()).bind(retry_minutes).execute(db).await?;
    Ok(())
}

pub async fn retry_communication(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("UPDATE supplier_communication_queue SET status='queued',attempts=0,last_error='',next_attempt_at=NOW(),processing_started_at=NULL,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='failed' RETURNING jsonb_build_object('id',id,'status',status,'nextAttemptAt',next_attempt_at)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await
}

pub async fn operations_health(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT jsonb_build_object(
      'queue',jsonb_build_object(
        'queued',COUNT(*) FILTER(WHERE status='queued'),
        'processing',COUNT(*) FILTER(WHERE status='processing'),
        'retryScheduled',COUNT(*) FILTER(WHERE status='failed' AND attempts<max_attempts),
        'terminalFailed',COUNT(*) FILTER(WHERE status='failed' AND attempts>=max_attempts),
        'oldestPendingAt',MIN(created_at) FILTER(WHERE status IN ('queued','processing','failed')),
        'lastSentAt',MAX(sent_at),
        'lastFailure',(SELECT NULLIF(f.last_error,'') FROM supplier_communication_queue f WHERE f.tenant_id=$1 AND f.branch_id=$2 AND f.status='failed' ORDER BY f.updated_at DESC LIMIT 1)
      ),
      'invariants',jsonb_build_object(
        'ledgerStockMismatch',(
          SELECT COUNT(*) FROM inventory_items i
          WHERE i.tenant_id=$1 AND i.branch_id=$2 AND EXISTS(
            SELECT 1 FROM LATERAL (
              SELECT l.stock_after_quantity FROM inventory_stock_ledger l
              WHERE l.tenant_id=i.tenant_id AND l.branch_id=i.branch_id
                AND l.inventory_item_id=i.id AND l.stock_after_quantity IS NOT NULL
              ORDER BY l.created_at DESC,l.id DESC LIMIT 1
            ) latest WHERE latest.stock_after_quantity<>i.stock_quantity
          )
        ),
        'negativeStock',(
          SELECT COUNT(*) FROM inventory_items i WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.stock_quantity<0
        ),
        'ledgerSnapshotMissing',(
          SELECT COUNT(*) FROM inventory_stock_ledger ledger
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
            AND ledger.stock_after_quantity IS NULL
        ),
        'ledgerSnapshotMismatch',(
          SELECT COUNT(*) FROM inventory_digital_twin_ledger ledger
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
            AND ledger.snapshot_status='mismatch'
        ),
        'provenanceIncomplete',(
          SELECT COUNT(*) FROM inventory_digital_twin_ledger ledger
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
            AND ledger.provenance_complete=FALSE
        ),
        'batchEvidenceMissing',(
          SELECT COUNT(*)
          FROM inventory_digital_twin_ledger ledger
          JOIN inventory_items item
            ON item.id=ledger.inventory_item_id
           AND item.tenant_id=ledger.tenant_id
           AND item.branch_id=ledger.branch_id
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
            AND item.batch_tracked=TRUE
            AND ledger.backbar_container_id IS NULL
            AND jsonb_array_length(ledger.batch_allocations)=0
            AND ledger.movement_type IN (
              'sale','return','purchase','purchase_return',
              'transfer_out','transfer_in','transfer_reversal',
              'consumption','kit_component_out','kit_assembly_in'
            )
        ),
        'trustedLedgerRows',(
          SELECT COUNT(*) FROM inventory_digital_twin_ledger ledger
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
            AND ledger.snapshot_status='verified' AND ledger.provenance_complete=TRUE
        ),
        'reconstructedLedgerRows',(
          SELECT COUNT(*) FROM inventory_digital_twin_ledger ledger
          WHERE ledger.tenant_id=$1 AND ledger.branch_id=$2
            AND ledger.snapshot_status='reconstructed' AND ledger.provenance_complete=TRUE
        )
      ),
      'failedJobs',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id',failed.id,'channel',failed.channel,'destination',failed.destination,
          'attempts',failed.attempts,'maxAttempts',failed.max_attempts,
          'lastError',failed.last_error,'updatedAt',failed.updated_at
        ) ORDER BY failed.updated_at DESC),'[]'::JSONB)
        FROM (SELECT id,channel,destination,attempts,max_attempts,last_error,updated_at
              FROM supplier_communication_queue
              WHERE tenant_id=$1 AND branch_id=$2 AND status='failed'
              ORDER BY updated_at DESC LIMIT 50) failed
      ),
      'generatedAt',NOW()
    ) FROM supplier_communication_queue q WHERE q.tenant_id=$1 AND q.branch_id=$2"#)
        .bind(tenant).bind(branch).fetch_one(db).await
}
pub async fn containers(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'inventoryItemId',c.inventory_item_id,'productName',i.name,'barcode',c.barcode,'batchId',c.batch_id,'capacityQuantity',c.capacity_quantity,'remainingQuantity',c.remaining_quantity,'unit',c.unit,'status',c.status,'openedBy',c.opened_by,'openedAt',c.opened_at,'closedAt',c.closed_at,'pendingOverrideId',(SELECT o.id FROM inventory_backbar_overrides o WHERE o.container_id=c.id AND o.status='pending' LIMIT 1),'events',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'quantityDelta',e.quantity_delta,'remainingAfter',e.remaining_after,'actorUserId',e.actor_user_id,'metadata',e.metadata,'createdAt',e.created_at) ORDER BY e.created_at DESC),'[]'::JSONB) FROM inventory_backbar_container_events e WHERE e.container_id=c.id)) FROM inventory_backbar_containers c JOIN inventory_items i ON i.id=c.inventory_item_id WHERE c.tenant_id=$1 AND c.branch_id=$2 ORDER BY c.updated_at DESC")
        .bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn container_label_data(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'productName',i.name,'barcode',c.barcode,'capacityQuantity',c.capacity_quantity,'unit',c.unit,'status',c.status,'batchNumber',COALESCE(batch.batch_number,'')) FROM inventory_backbar_containers c JOIN inventory_items i ON i.id=c.inventory_item_id AND i.tenant_id=c.tenant_id AND i.branch_id=c.branch_id LEFT JOIN inventory_batches batch ON batch.id=c.batch_id AND batch.tenant_id=c.tenant_id AND batch.branch_id=c.branch_id WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.id=$3")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await
}

pub async fn create_container(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    item: &str,
    barcode: &str,
    batch: Option<&str>,
    capacity: i32,
    unit: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row=sqlx::query_as::<_,(String,i32)>("INSERT INTO inventory_backbar_containers(tenant_id,branch_id,inventory_item_id,barcode,batch_id,capacity_quantity,remaining_quantity,unit,created_by) SELECT $1,$2,i.id,$4,b.id,$6,$6,$7,$8 FROM inventory_items i LEFT JOIN inventory_batches b ON b.tenant_id=i.tenant_id AND b.branch_id=i.branch_id AND b.inventory_item_id=i.id AND b.id=$5 WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.id=$3 AND ($5::TEXT IS NULL OR b.id IS NOT NULL) RETURNING id,remaining_quantity")
      .bind(tenant).bind(branch).bind(item).bind(barcode).bind(batch).bind(capacity).bind(unit).bind(actor).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key) VALUES($1,$2,$3,'created',$4,$5,$6)").bind(tenant).bind(branch).bind(&row.0).bind(row.1).bind(actor).bind(key).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":row.0,"status":"sealed","remainingQuantity":row.1}))
}

pub async fn open_container(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(existing) = event_by_key(&mut tx, tenant, branch, key).await? {
        tx.commit().await?;
        return Ok(existing);
    }
    let row = sqlx::query_as::<_, (String, i32, i64, i32)>(
        r#"SELECT c.inventory_item_id,c.remaining_quantity,i.unit_cost_paise,i.stock_quantity
      FROM inventory_backbar_containers c
      JOIN inventory_items i ON i.id=c.inventory_item_id
      WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.id=$3 AND c.status='sealed'
        AND NOT EXISTS (
          SELECT 1 FROM inventory_backbar_containers active
          WHERE active.tenant_id=c.tenant_id AND active.branch_id=c.branch_id
            AND active.inventory_item_id=c.inventory_item_id AND active.status='open'
        )
      FOR UPDATE OF c,i"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if row.3 <= 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    let stock_after = row.3 - 1;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(&row.0).bind(stock_after).execute(&mut *tx).await?;
    sqlx::query("UPDATE inventory_backbar_containers SET status='open',opened_by=$4,opened_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(id).bind(actor).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,backbar_container_id) VALUES($1,$2,$3,'consumption',-1,$4,$5,$6)").bind(tenant).bind(branch).bind(&row.0).bind(row.2).bind(stock_after).bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key) VALUES($1,$2,$3,'opened',$4,$5,$6)").bind(tenant).bind(branch).bind(id).bind(row.1).bind(actor).bind(key).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":id,"status":"open","remainingQuantity":row.1}))
}

async fn event_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    key: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',container_id,'eventType',event_type,'remainingQuantity',remaining_after) FROM inventory_backbar_container_events WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3").bind(tenant).bind(branch).bind(key).fetch_optional(&mut **tx).await
}

pub async fn consume_container(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    quantity: i32,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(existing) = event_by_key(&mut tx, tenant, branch, key).await? {
        tx.commit().await?;
        return Ok(existing);
    }
    let remaining=sqlx::query_scalar::<_,i32>("UPDATE inventory_backbar_containers SET remaining_quantity=remaining_quantity-$4,status=CASE WHEN remaining_quantity-$4=0 THEN 'empty' ELSE status END,closed_by=CASE WHEN remaining_quantity-$4=0 THEN $5 ELSE closed_by END,closed_at=CASE WHEN remaining_quantity-$4=0 THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' AND remaining_quantity >= $4 RETURNING remaining_quantity").bind(tenant).bind(branch).bind(id).bind(quantity).bind(actor).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,quantity_delta,remaining_after,actor_user_id,idempotency_key) VALUES($1,$2,$3,'consumed',$4,$5,$6,$7)").bind(tenant).bind(branch).bind(id).bind(-quantity).bind(remaining).bind(actor).bind(key).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        serde_json::json!({"id":id,"status":if remaining==0{"empty"}else{"open"},"remainingQuantity":remaining}),
    )
}

pub async fn request_override(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    remaining: i32,
    reason: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let override_id=sqlx::query_scalar::<_,String>("INSERT INTO inventory_backbar_overrides(tenant_id,branch_id,container_id,requested_remaining,reason,requested_by) SELECT $1,$2,id,$4,$5,$6 FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND $4<=capacity_quantity RETURNING id").bind(tenant).bind(branch).bind(id).bind(remaining).bind(reason).bind(actor).fetch_one(&mut *tx).await?;
    let current = sqlx::query_scalar::<_, i32>(
        "SELECT remaining_quantity FROM inventory_backbar_containers WHERE id=$1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'override_requested',$4,$5,$6,jsonb_build_object('overrideId',$7,'requestedRemaining',$8,'reason',$9))").bind(tenant).bind(branch).bind(id).bind(current).bind(actor).bind(key).bind(&override_id).bind(remaining).bind(reason).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":override_id,"status":"pending"}))
}

pub async fn review_override(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    override_id: &str,
    approve: bool,
    note: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row=sqlx::query_as::<_,(String,i32,String)>("SELECT container_id,requested_remaining,requested_by FROM inventory_backbar_overrides WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' FOR UPDATE").bind(tenant).bind(branch).bind(override_id).fetch_one(&mut *tx).await?;
    if row.2 == actor {
        return Err(sqlx::Error::Protocol(
            "maker cannot approve own override".into(),
        ));
    }
    let remaining = if approve {
        sqlx::query_scalar::<_,i32>("UPDATE inventory_backbar_containers SET remaining_quantity=$4,status=CASE WHEN $4=0 THEN 'empty' WHEN status IN ('empty','discarded') THEN 'open' ELSE status END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND $4<=capacity_quantity RETURNING remaining_quantity").bind(tenant).bind(branch).bind(&row.0).bind(row.1).fetch_one(&mut *tx).await?
    } else {
        sqlx::query_scalar::<_,i32>("SELECT remaining_quantity FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(&row.0).fetch_one(&mut *tx).await?
    };
    let status = if approve { "approved" } else { "rejected" };
    sqlx::query("UPDATE inventory_backbar_overrides SET status=$4,reviewed_by=$5,reviewed_at=NOW(),review_note=$6 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(override_id).bind(status).bind(actor).bind(note).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,jsonb_build_object('overrideId',$8,'reviewNote',$9))").bind(tenant).bind(branch).bind(&row.0).bind(if approve{"override_approved"}else{"override_rejected"}).bind(remaining).bind(actor).bind(key).bind(override_id).bind(note).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":override_id,"status":status,"remainingQuantity":remaining}))
}

pub async fn fifo_valuation(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    as_of: chrono::NaiveDate,
) -> Result<Vec<crate::repositories::inventory_repository::InventoryValuationRecord>, sqlx::Error> {
    sqlx::query_as(r#"WITH layers AS (
      SELECT b.inventory_item_id,
        SUM(b.quantity::BIGINT-COALESCE((SELECT SUM(m.quantity_delta::BIGINT) FROM inventory_batch_movements m WHERE m.batch_id=b.id AND m.created_at>=($3::DATE+INTERVAL '1 day')),0))::BIGINT AS quantity_as_of,
        SUM((b.quantity::BIGINT-COALESCE((SELECT SUM(m.quantity_delta::BIGINT) FROM inventory_batch_movements m WHERE m.batch_id=b.id AND m.created_at>=($3::DATE+INTERVAL '1 day')),0))*b.unit_cost_paise)::BIGINT AS value_as_of
      FROM inventory_batches b WHERE b.tenant_id=$1 AND b.branch_id=$2 AND b.created_at<($3::DATE+INTERVAL '1 day') GROUP BY b.inventory_item_id
    ), ledger_qty AS (
      SELECT i.id,(i.stock_quantity::BIGINT-COALESCE(SUM(l.quantity_delta::BIGINT) FILTER(WHERE l.created_at>=($3::DATE+INTERVAL '1 day')),0))::BIGINT AS quantity_as_of
      FROM inventory_items i LEFT JOIN inventory_stock_ledger l ON l.tenant_id=i.tenant_id AND l.branch_id=i.branch_id AND l.inventory_item_id=i.id
      WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.created_at<($3::DATE+INTERVAL '1 day') GROUP BY i.id
    ) SELECT i.id inventory_item_id,i.name product_name,i.category,q.quantity_as_of stock_quantity,
      CASE WHEN i.batch_tracked AND q.quantity_as_of<>0 THEN COALESCE(l.value_as_of,0)/q.quantity_as_of ELSE i.unit_cost_paise END unit_cost_paise,
      CASE WHEN i.batch_tracked THEN COALESCE(l.value_as_of,0) ELSE q.quantity_as_of*i.unit_cost_paise END stock_value_paise,i.reorder_point
      FROM inventory_items i JOIN ledger_qty q ON q.id=i.id LEFT JOIN layers l ON l.inventory_item_id=i.id
      WHERE i.tenant_id=$1 AND i.branch_id=$2 ORDER BY i.name"#).bind(tenant).bind(branch).bind(as_of).fetch_all(db).await
}

pub async fn negative_stock_requests(
    db: &PgPool,
    tenant: &str,
    branch: &str,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'inventoryItemId',r.inventory_item_id,'productName',i.name,'requestedStockQuantity',r.requested_stock_quantity,'reason',r.reason,'status',r.status,'requestedBy',r.requested_by,'requestedAt',r.requested_at,'reviewedBy',r.reviewed_by,'reviewedAt',r.reviewed_at,'reviewNote',r.review_note) FROM inventory_negative_stock_requests r JOIN inventory_items i ON i.id=r.inventory_item_id WHERE r.tenant_id=$1 AND r.branch_id=$2 ORDER BY r.requested_at DESC LIMIT 200").bind(tenant).bind(branch).fetch_all(db).await
}

pub async fn request_negative_stock(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    item: &str,
    target: i32,
    reason: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_negative_stock_requests(tenant_id,branch_id,inventory_item_id,requested_stock_quantity,reason,requested_by) SELECT $1,$2,i.id,$4,$5,$6 FROM inventory_items i JOIN inventory_policies p ON p.tenant_id=i.tenant_id AND p.branch_id=i.branch_id AND p.negative_stock_rule='approval_required' WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.id=$3 RETURNING jsonb_build_object('id',id,'status',status,'requestedStockQuantity',requested_stock_quantity)").bind(tenant).bind(branch).bind(item).bind(target).bind(reason).bind(actor).fetch_one(db).await
}

pub async fn review_negative_stock(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    approve: bool,
    note: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row=sqlx::query_as::<_,(String,i32,String)>("SELECT inventory_item_id,requested_stock_quantity,requested_by FROM inventory_negative_stock_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' FOR UPDATE").bind(tenant).bind(branch).bind(id).fetch_one(&mut *tx).await?;
    if row.2 == actor {
        return Err(sqlx::Error::Protocol(
            "maker cannot approve own negative stock request".into(),
        ));
    }
    if approve {
        let item=sqlx::query_as::<_,(i32,i64)>("SELECT stock_quantity,unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE").bind(tenant).bind(branch).bind(&row.0).fetch_one(&mut *tx).await?;
        let delta = row.1 - item.0;
        sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(&row.0).bind(row.1).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,adjustment_reason,negative_stock_request_id) VALUES($1,$2,$3,'adjustment',$4,$5,$6,'Approved negative stock exception',$7)").bind(tenant).bind(branch).bind(&row.0).bind(delta).bind(item.1).bind(row.1).bind(id).execute(&mut *tx).await?;
    }
    let status = if approve { "approved" } else { "rejected" };
    sqlx::query("UPDATE inventory_negative_stock_requests SET status=$4,reviewed_by=$5,reviewed_at=NOW(),review_note=$6 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(id).bind(status).bind(actor).bind(note).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":id,"status":status,"requestedStockQuantity":row.1}))
}
