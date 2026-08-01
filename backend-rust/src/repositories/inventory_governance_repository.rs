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
    sqlx::query_scalar("SELECT jsonb_build_object('negativeStockRule',negative_stock_rule,'autoCheckoutRetailSales',auto_checkout_retail_sales,'autoCheckoutServiceConsumption',auto_checkout_service_consumption,'valuationMethod',valuation_method,'expiryWindowDays',expiry_window_days,'countVarianceThresholdBps',count_variance_threshold_bps,'countValueVarianceThresholdPaise',count_value_variance_threshold_paise,'reorderHistoryDays',reorder_history_days,'reorderCoverageDays',reorder_coverage_days,'partialDeliveryPolicy',partial_delivery_policy,'financialLockDate',financial_lock_date,'editLockDays',edit_lock_days,'masterEditLock',master_edit_lock,'excessReceivingPolicy',excess_receiving_policy,'priceDifferencePrompt',price_difference_prompt,'priceDifferenceThresholdBps',price_difference_threshold_bps,'transferBaseTransportCostPaise',transfer_base_transport_cost_paise,'transferCostPerKmPaise',transfer_cost_per_km_paise,'transferHandlingCostPerUnitPaise',transfer_handling_cost_per_unit_paise,'transferDelayCostPerUnitDayPaise',transfer_delay_cost_per_unit_day_paise,'transferExpectedDays',transfer_expected_days,'approvalMatrix',approval_matrix,'updatedBy',updated_by,'updatedAt',updated_at) FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2")
        .bind(tenant).bind(branch).fetch_optional(db).await
}

pub async fn save_policy(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    negative: &str,
    auto_retail: bool,
    auto_service: bool,
    valuation: &str,
    expiry: i32,
    threshold: i32,
    value_threshold_paise: i64,
    reorder_history_days: i32,
    reorder_coverage_days: i32,
    partial_delivery_policy: &str,
    financial_lock_date: Option<&str>,
    edit_lock_days: i32,
    master_edit_lock: bool,
    excess_receiving_policy: &str,
    price_difference_prompt: bool,
    price_difference_threshold_bps: i32,
    transfer_base_transport_cost_paise: Option<i64>,
    transfer_cost_per_km_paise: Option<i64>,
    transfer_handling_cost_per_unit_paise: Option<i64>,
    transfer_delay_cost_per_unit_day_paise: Option<i64>,
    transfer_expected_days: Option<i32>,
    matrix: &Value,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_policies(tenant_id,branch_id,negative_stock_rule,auto_checkout_retail_sales,auto_checkout_service_consumption,valuation_method,expiry_window_days,count_variance_threshold_bps,count_value_variance_threshold_paise,reorder_history_days,reorder_coverage_days,partial_delivery_policy,financial_lock_date,edit_lock_days,master_edit_lock,excess_receiving_policy,price_difference_prompt,price_difference_threshold_bps,transfer_base_transport_cost_paise,transfer_cost_per_km_paise,transfer_handling_cost_per_unit_paise,transfer_delay_cost_per_unit_day_paise,transfer_expected_days,approval_matrix,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::DATE,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) ON CONFLICT(tenant_id,branch_id) DO UPDATE SET negative_stock_rule=EXCLUDED.negative_stock_rule,auto_checkout_retail_sales=EXCLUDED.auto_checkout_retail_sales,auto_checkout_service_consumption=EXCLUDED.auto_checkout_service_consumption,valuation_method=EXCLUDED.valuation_method,expiry_window_days=EXCLUDED.expiry_window_days,count_variance_threshold_bps=EXCLUDED.count_variance_threshold_bps,count_value_variance_threshold_paise=EXCLUDED.count_value_variance_threshold_paise,reorder_history_days=EXCLUDED.reorder_history_days,reorder_coverage_days=EXCLUDED.reorder_coverage_days,partial_delivery_policy=EXCLUDED.partial_delivery_policy,financial_lock_date=EXCLUDED.financial_lock_date,edit_lock_days=EXCLUDED.edit_lock_days,master_edit_lock=EXCLUDED.master_edit_lock,excess_receiving_policy=EXCLUDED.excess_receiving_policy,price_difference_prompt=EXCLUDED.price_difference_prompt,price_difference_threshold_bps=EXCLUDED.price_difference_threshold_bps,transfer_base_transport_cost_paise=COALESCE(EXCLUDED.transfer_base_transport_cost_paise,inventory_policies.transfer_base_transport_cost_paise),transfer_cost_per_km_paise=COALESCE(EXCLUDED.transfer_cost_per_km_paise,inventory_policies.transfer_cost_per_km_paise),transfer_handling_cost_per_unit_paise=COALESCE(EXCLUDED.transfer_handling_cost_per_unit_paise,inventory_policies.transfer_handling_cost_per_unit_paise),transfer_delay_cost_per_unit_day_paise=COALESCE(EXCLUDED.transfer_delay_cost_per_unit_day_paise,inventory_policies.transfer_delay_cost_per_unit_day_paise),transfer_expected_days=COALESCE(EXCLUDED.transfer_expected_days,inventory_policies.transfer_expected_days),approval_matrix=EXCLUDED.approval_matrix,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING jsonb_build_object('negativeStockRule',negative_stock_rule,'autoCheckoutRetailSales',auto_checkout_retail_sales,'autoCheckoutServiceConsumption',auto_checkout_service_consumption,'valuationMethod',valuation_method,'expiryWindowDays',expiry_window_days,'countVarianceThresholdBps',count_variance_threshold_bps,'countValueVarianceThresholdPaise',count_value_variance_threshold_paise,'reorderHistoryDays',reorder_history_days,'reorderCoverageDays',reorder_coverage_days,'partialDeliveryPolicy',partial_delivery_policy,'financialLockDate',financial_lock_date,'editLockDays',edit_lock_days,'masterEditLock',master_edit_lock,'excessReceivingPolicy',excess_receiving_policy,'priceDifferencePrompt',price_difference_prompt,'priceDifferenceThresholdBps',price_difference_threshold_bps,'transferBaseTransportCostPaise',transfer_base_transport_cost_paise,'transferCostPerKmPaise',transfer_cost_per_km_paise,'transferHandlingCostPerUnitPaise',transfer_handling_cost_per_unit_paise,'transferDelayCostPerUnitDayPaise',transfer_delay_cost_per_unit_day_paise,'transferExpectedDays',transfer_expected_days,'approvalMatrix',approval_matrix,'updatedBy',updated_by,'updatedAt',updated_at)")
        .bind(tenant).bind(branch).bind(negative).bind(auto_retail).bind(auto_service).bind(valuation).bind(expiry).bind(threshold).bind(value_threshold_paise).bind(reorder_history_days).bind(reorder_coverage_days).bind(partial_delivery_policy).bind(financial_lock_date).bind(edit_lock_days).bind(master_edit_lock).bind(excess_receiving_policy).bind(price_difference_prompt).bind(price_difference_threshold_bps).bind(transfer_base_transport_cost_paise).bind(transfer_cost_per_km_paise).bind(transfer_handling_cost_per_unit_paise).bind(transfer_delay_cost_per_unit_day_paise).bind(transfer_expected_days).bind(matrix).bind(actor).fetch_one(db).await
}

pub async fn supplier_governance(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    supplier: Option<&str>,
) -> Result<Value, sqlx::Error> {
    let price_lists=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',p.id,'supplierId',p.supplier_id,'supplierName',s.name,'inventoryItemId',p.inventory_item_id,'productName',i.name,'unitCostPaise',p.unit_cost_paise,'discountBps',p.discount_bps,'gstPercent',p.gst_percent,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to) FROM supplier_price_lists p JOIN suppliers s ON s.id=p.supplier_id JOIN inventory_items i ON i.id=p.inventory_item_id WHERE p.tenant_id=$1 AND p.branch_id=$2 AND ($3::TEXT IS NULL OR p.supplier_id=$3) ORDER BY p.effective_from DESC,p.created_at DESC LIMIT 500")
        .bind(tenant).bind(branch).bind(supplier).fetch_all(db).await?;
    let terms=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',t.id,'supplierId',t.supplier_id,'supplierName',s.name,'inventoryItemId',t.inventory_item_id,'productName',i.name,'vendorPartNumber',t.vendor_part_number,'purchaseUnit',t.purchase_unit,'conversionQuantity',t.conversion_quantity,'centerAvailable',t.center_available,'leadTimeDays',t.lead_time_days,'minimumOrderQuantity',t.minimum_order_quantity,'packSize',t.pack_size,'safetyStockDays',t.safety_stock_days,'active',t.active) FROM supplier_inventory_terms t JOIN suppliers s ON s.id=t.supplier_id JOIN inventory_items i ON i.id=t.inventory_item_id WHERE t.tenant_id=$1 AND t.branch_id=$2 AND ($3::TEXT IS NULL OR t.supplier_id=$3) ORDER BY s.name,i.name")
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
    discount_bps: i32,
    gst_percent: i32,
    from: &str,
    to: Option<&str>,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO supplier_price_lists(tenant_id,branch_id,supplier_id,inventory_item_id,unit_cost_paise,discount_bps,gst_percent,effective_from,effective_to,created_by) SELECT $1,$2,s.id,i.id,$5,$6,$7,$8::DATE,$9::DATE,$10 FROM suppliers s JOIN inventory_items i ON i.tenant_id=s.tenant_id AND i.branch_id=s.branch_id JOIN supplier_inventory_terms terms ON terms.tenant_id=s.tenant_id AND terms.branch_id=s.branch_id AND terms.supplier_id=s.id AND terms.inventory_item_id=i.id AND terms.active=TRUE AND terms.center_available=TRUE WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND s.active=TRUE AND i.id=$4 AND i.active=TRUE AND i.center_available=TRUE RETURNING jsonb_build_object('id',id,'supplierId',supplier_id,'inventoryItemId',inventory_item_id,'unitCostPaise',unit_cost_paise,'discountBps',discount_bps,'gstPercent',gst_percent,'effectiveFrom',effective_from,'effectiveTo',effective_to)")
        .bind(tenant).bind(branch).bind(supplier).bind(item).bind(cost).bind(discount_bps).bind(gst_percent).bind(from).bind(to).bind(actor).fetch_one(db).await
}

pub async fn master_data(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, sqlx::Error> {
    let values=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('id',id,'kind',kind,'code',code,'label',label,'parentCode',parent_code,'active',active) FROM inventory_master_values WHERE tenant_id=$1 AND branch_id=$2 ORDER BY kind,active DESC,label")
        .bind(tenant).bind(branch).fetch_all(db).await?;
    let units=sqlx::query_scalar::<_,Value>("SELECT jsonb_build_object('code',code,'label',label,'dimension',dimension,'active',active) FROM inventory_uom_master ORDER BY sort_order,code")
        .fetch_all(db).await?;
    Ok(serde_json::json!({"values":values,"units":units}))
}

pub async fn save_master_value(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    kind: &str,
    code: &str,
    label: &str,
    parent_code: &str,
    active: bool,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_master_values(tenant_id,branch_id,kind,code,label,parent_code,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,branch_id,kind,(LOWER(code))) DO UPDATE SET label=EXCLUDED.label,parent_code=EXCLUDED.parent_code,active=EXCLUDED.active,updated_at=NOW() RETURNING jsonb_build_object('id',id,'kind',kind,'code',code,'label',label,'parentCode',parent_code,'active',active)")
        .bind(tenant).bind(branch).bind(kind).bind(code).bind(label).bind(parent_code).bind(active).bind(actor).fetch_one(db).await
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
    sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'inventoryItemId',c.inventory_item_id,'productName',i.name,'barcode',c.barcode,'batchId',c.batch_id,'capacityQuantity',c.capacity_quantity,'remainingQuantity',c.remaining_quantity,'unit',c.unit,'status',c.status,'locationCode',c.location_code,'custodianStaffId',c.custodian_staff_id,'custodianStaffName',COALESCE(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'dualUseStock',i.dual_use_stock,'retailShelfQuantity',CASE WHEN i.dual_use_stock THEN GREATEST(i.stock_quantity-COALESCE((SELECT SUM(s.capacity_quantity)::INTEGER FROM inventory_backbar_containers s WHERE s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id AND s.inventory_item_id=c.inventory_item_id AND s.status='sealed'),0),0) ELSE i.stock_quantity END,'sealedBackbarQuantity',(SELECT COUNT(*)::INTEGER FROM inventory_backbar_containers s WHERE s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id AND s.inventory_item_id=c.inventory_item_id AND s.status='sealed'),'sealedBackbarBalance',COALESCE((SELECT SUM(s.capacity_quantity)::INTEGER FROM inventory_backbar_containers s WHERE s.tenant_id=c.tenant_id AND s.branch_id=c.branch_id AND s.inventory_item_id=c.inventory_item_id AND s.status='sealed'),0),'openContainerBalance',COALESCE((SELECT SUM(o.remaining_quantity)::INTEGER FROM inventory_backbar_containers o WHERE o.tenant_id=c.tenant_id AND o.branch_id=c.branch_id AND o.inventory_item_id=c.inventory_item_id AND o.status='open'),0),'openedBy',c.opened_by,'openedAt',c.opened_at,'closedAt',c.closed_at,'pendingOverrideId',(SELECT o.id FROM inventory_backbar_overrides o WHERE o.container_id=c.id AND o.status='pending' LIMIT 1),'events',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'quantityDelta',e.quantity_delta,'remainingAfter',e.remaining_after,'actorUserId',e.actor_user_id,'metadata',e.metadata,'createdAt',e.created_at) ORDER BY e.created_at DESC),'[]'::JSONB) FROM inventory_backbar_container_events e WHERE e.container_id=c.id)) FROM inventory_backbar_containers c JOIN inventory_items i ON i.id=c.inventory_item_id LEFT JOIN staff ON staff.id=c.custodian_staff_id AND staff.tenant_id=c.tenant_id AND staff.branch_id=c.branch_id WHERE c.tenant_id=$1 AND c.branch_id=$2 ORDER BY c.updated_at DESC")
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
    let master=sqlx::query_as::<_,(String,i32,i64)>("SELECT product_usage,stock_quantity,unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
        .bind(tenant).bind(branch).bind(item).fetch_one(&mut *tx).await?;
    if master.0=="retail" { return Err(sqlx::Error::Protocol("retail-only product cannot be registered as a backbar container".into())); }
    let consumable=operational_bucket_balance(&mut tx,tenant,branch,item,"consumable_available").await?;
    let source=if consumable>=i64::from(capacity) { "consumable_available" } else { "store_unopened" };
    let available=available_source_quantity(&mut tx,tenant,branch,item,source,master.1).await?;
    let rule=sqlx::query_scalar::<_,String>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
        .bind(tenant).bind(branch).fetch_one(&mut *tx).await?;
    let warning=available<i64::from(capacity);
    if warning && rule!="allow_with_warning" { return Err(sqlx::Error::Protocol("insufficient available stock for sealed backbar reserve".into())); }
    sqlx::query("INSERT INTO inventory_floor_locations(tenant_id,branch_id,code,name,location_type,created_by) VALUES($1,$2,'BACKBAR','Backbar','backbar',$3) ON CONFLICT(tenant_id,branch_id,code) DO NOTHING")
        .bind(tenant).bind(branch).bind(actor).execute(&mut *tx).await?;
    let row=sqlx::query_as::<_,(String,i32)>("INSERT INTO inventory_backbar_containers(tenant_id,branch_id,inventory_item_id,barcode,batch_id,capacity_quantity,remaining_quantity,unit,created_by) SELECT $1,$2,i.id,$4,b.id,$6,$6,$7,$8 FROM inventory_items i LEFT JOIN inventory_batches b ON b.tenant_id=i.tenant_id AND b.branch_id=i.branch_id AND b.inventory_item_id=i.id AND b.id=$5 WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.id=$3 AND ($5::TEXT IS NULL OR b.id IS NOT NULL) RETURNING id,remaining_quantity")
      .bind(tenant).bind(branch).bind(item).bind(barcode).bind(batch).bind(capacity).bind(unit).bind(actor).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key) VALUES($1,$2,$3,'created',$4,$5,$6)").bind(tenant).bind(branch).bind(&row.0).bind(row.1).bind(actor).bind(key).execute(&mut *tx).await?;
    record_operational_movement(&mut tx,tenant,branch,item,"container_registered",source,"sealed_backbar_reserve",capacity,master.2,None,actor,"Container registered","backbar_container",&row.0,&format!("container-register:{key}"),warning,&serde_json::json!({"barcode":barcode,"negativeStockRule":rule})).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":row.0,"status":"sealed","remainingQuantity":row.1}))
}

#[allow(clippy::too_many_arguments)]
pub async fn auto_checkout_transfer_containers(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    actor: &str,
    inventory_item_id: &str,
    unit: &str,
    units_per_package: i32,
    shipment_line_id: &str,
    quantity: i32,
    batch_allocations: &[(Option<String>, i32)],
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO inventory_floor_locations(tenant_id,branch_id,code,name,location_type,created_by) VALUES($1,$2,'BACKBAR','Backbar','backbar',$3) ON CONFLICT(tenant_id,branch_id,code) DO NOTHING")
        .bind(tenant).bind(branch).bind(actor).execute(&mut **tx).await?;
    let mut remaining = quantity;
    let mut index = 0_i32;
    let allocations = if batch_allocations.is_empty() {
        vec![(None, quantity)]
    } else {
        batch_allocations.to_vec()
    };
    for (batch_id, allocated) in allocations {
        let mut in_batch = allocated.min(remaining);
        while in_batch > 0 {
            index += 1;
            let capacity = in_batch.min(units_per_package.max(1));
            let row = sqlx::query_as::<_, (String, String)>("INSERT INTO inventory_backbar_containers(tenant_id,branch_id,inventory_item_id,barcode,batch_id,capacity_quantity,remaining_quantity,unit,status,location_code,created_by) VALUES($1,$2,$3,'TR-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT,'-','') FROM 1 FOR 16)),$4,$5,$5,$6,'sealed','BACKBAR',$7) RETURNING id,barcode")
                .bind(tenant).bind(branch).bind(inventory_item_id).bind(batch_id.as_deref()).bind(capacity).bind(unit).bind(actor).fetch_one(&mut **tx).await?;
            sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'created',$4,$5,$6,jsonb_build_object('source','transfer_auto_checkout','shipmentLineId',$7,'barcode',$8))")
                .bind(tenant).bind(branch).bind(&row.0).bind(capacity).bind(actor).bind(format!("transfer-auto:{shipment_line_id}:{index}")).bind(shipment_line_id).bind(&row.1).execute(&mut **tx).await?;
            let unit_cost=sqlx::query_scalar::<_,i64>("SELECT unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
                .bind(tenant).bind(branch).bind(inventory_item_id).fetch_one(&mut **tx).await?;
            record_operational_movement(tx,tenant,branch,inventory_item_id,"auto_transfer_checkout","store_unopened","sealed_backbar_reserve",capacity,unit_cost,None,actor,"Automatic transfer checkout","transfer_shipment_line",shipment_line_id,&format!("transfer-op:{shipment_line_id}:{index}"),false,&serde_json::json!({"containerId":row.0,"barcode":row.1})).await?;
            in_batch -= capacity;
            remaining -= capacity;
        }
        if remaining == 0 {
            break;
        }
    }
    if remaining != 0 {
        return Err(sqlx::Error::Protocol(
            "transfer auto-checkout batch quantity mismatch".into(),
        ));
    }
    Ok(())
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
        r#"SELECT c.inventory_item_id,c.capacity_quantity,i.unit_cost_paise,i.stock_quantity
      FROM inventory_backbar_containers c
      JOIN inventory_items i ON i.id=c.inventory_item_id
      WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.id=$3 AND c.status='sealed'
      FOR UPDATE OF c,i"#,
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(active) = sqlx::query_as::<_, (String, i32)>("SELECT id,remaining_quantity FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND status='open' FOR UPDATE")
        .bind(tenant).bind(branch).bind(&row.0).fetch_optional(&mut *tx).await?
    {
        sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'premature_open_blocked',$4,$5,$6,jsonb_build_object('activeContainerId',$7,'activeRemainingQuantity',$8,'managerOverrideRequired',TRUE))")
            .bind(tenant).bind(branch).bind(id).bind(row.1).bind(actor).bind(key).bind(&active.0).bind(active.1).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(serde_json::json!({"id":id,"status":"blocked","alertType":"premature_tube_opening","activeContainerId":active.0,"activeRemainingQuantity":active.1,"managerOverrideRequired":true}));
    }
    let rule=sqlx::query_scalar::<_,String>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
        .bind(tenant).bind(branch).fetch_one(&mut *tx).await?;
    let warning=row.3<row.1;
    if warning && rule!="allow_with_warning" {
        return Err(sqlx::Error::RowNotFound);
    }
    let stock_after = row.3 - row.1;
    sqlx::query("UPDATE inventory_backbar_containers SET status='open',opened_by=$4,opened_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(id).bind(actor).execute(&mut *tx).await?;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3").bind(tenant).bind(branch).bind(&row.0).bind(stock_after).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,backbar_container_id) VALUES($1,$2,$3,'consumption',$4,$5,$6,$7)").bind(tenant).bind(branch).bind(&row.0).bind(-row.1).bind(row.2).bind(stock_after).bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key) VALUES($1,$2,$3,'opened',$4,$5,$6)").bind(tenant).bind(branch).bind(id).bind(row.1).bind(actor).bind(key).execute(&mut *tx).await?;
    record_operational_movement(&mut tx,tenant,branch,&row.0,"container_opened","sealed_backbar_reserve","open_floor_balance",row.1,row.2,None,actor,"Container opened","backbar_container",id,&format!("container-open:{key}"),warning,&serde_json::json!({"negativeStockRule":rule})).await?;
    tx.commit().await?;
    Ok(serde_json::json!({"id":id,"status":"open","remainingQuantity":row.1}))
}

async fn event_by_key(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    key: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',container_id,'eventType',event_type,'status',CASE WHEN event_type='premature_open_blocked' THEN 'blocked' WHEN event_type='opened' THEN 'open' ELSE event_type END,'remainingQuantity',remaining_after,'alertType',CASE WHEN event_type='premature_open_blocked' THEN 'premature_tube_opening' ELSE NULL END,'activeContainerId',metadata->>'activeContainerId','activeRemainingQuantity',metadata->'activeRemainingQuantity','managerOverrideRequired',COALESCE((metadata->>'managerOverrideRequired')::BOOLEAN,FALSE)) FROM inventory_backbar_container_events WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3").bind(tenant).bind(branch).bind(key).fetch_optional(&mut **tx).await
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
    let container=sqlx::query_as::<_,(String,i64)>("SELECT c.inventory_item_id,i.unit_cost_paise FROM inventory_backbar_containers c JOIN inventory_items i ON i.id=c.inventory_item_id WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.id=$3 AND c.status='open' FOR UPDATE OF c,i")
        .bind(tenant).bind(branch).bind(id).fetch_one(&mut *tx).await?;
    let remaining=sqlx::query_scalar::<_,i32>("UPDATE inventory_backbar_containers SET remaining_quantity=remaining_quantity-$4,status=CASE WHEN remaining_quantity-$4=0 THEN 'empty' ELSE status END,closed_by=CASE WHEN remaining_quantity-$4=0 THEN $5 ELSE closed_by END,closed_at=CASE WHEN remaining_quantity-$4=0 THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' AND remaining_quantity >= $4 RETURNING remaining_quantity").bind(tenant).bind(branch).bind(id).bind(quantity).bind(actor).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,quantity_delta,remaining_after,actor_user_id,idempotency_key) VALUES($1,$2,$3,'consumed',$4,$5,$6,$7)").bind(tenant).bind(branch).bind(id).bind(-quantity).bind(remaining).bind(actor).bind(key).execute(&mut *tx).await?;
    record_operational_movement(&mut tx,tenant,branch,&container.0,"manual_consumption","open_floor_balance","consumed",quantity,container.1,None,actor,"Manual floor consumption","backbar_container",id,&format!("container-consume:{key}"),false,&serde_json::json!({"remainingAfter":remaining})).await?;
    tx.commit().await?;
    Ok(
        serde_json::json!({"id":id,"status":if remaining==0{"empty"}else{"open"},"remainingQuantity":remaining}),
    )
}

pub async fn operational_bucket_balance(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    bucket: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COALESCE(SUM(CASE WHEN destination_bucket=$4 THEN quantity WHEN source_bucket=$4 THEN -quantity ELSE 0 END),0)::BIGINT FROM inventory_operational_movements WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3",
    )
    .bind(tenant).bind(branch).bind(item).bind(bucket)
    .fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn record_operational_movement(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    action: &str,
    source: &str,
    destination: &str,
    quantity: i32,
    unit_cost_paise: i64,
    employee: Option<&str>,
    actor: &str,
    comment: &str,
    reference_type: &str,
    reference_id: &str,
    key: &str,
    warning: bool,
    metadata: &Value,
) -> Result<Value, sqlx::Error> {
    let inserted = sqlx::query_scalar::<_, Value>(r#"INSERT INTO inventory_operational_movements(
        tenant_id,branch_id,inventory_item_id,action,source_bucket,destination_bucket,quantity,
        unit_cost_paise,stock_value_paise,employee_id,actor_user_id,comment,reference_type,reference_id,
        idempotency_key,warning,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7::BIGINT*$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(tenant_id,branch_id,idempotency_key) DO NOTHING
      RETURNING jsonb_build_object('id',id,'inventoryItemId',inventory_item_id,'action',action,
        'sourceBucket',source_bucket,'destinationBucket',destination_bucket,'quantity',quantity,
        'unitCostPaise',unit_cost_paise,'stockValuePaise',stock_value_paise,'employeeId',employee_id,
        'actorUserId',actor_user_id,'comment',comment,'referenceType',reference_type,'referenceId',reference_id,
        'warning',warning,'metadata',metadata,'createdAt',created_at)"#)
        .bind(tenant).bind(branch).bind(item).bind(action).bind(source).bind(destination).bind(quantity)
        .bind(unit_cost_paise).bind(employee).bind(actor).bind(comment).bind(reference_type).bind(reference_id)
        .bind(key).bind(warning).bind(metadata).fetch_optional(&mut **tx).await?;
    if let Some(row) = inserted { return Ok(row); }
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'inventoryItemId',inventory_item_id,'action',action,'sourceBucket',source_bucket,'destinationBucket',destination_bucket,'quantity',quantity,'unitCostPaise',unit_cost_paise,'stockValuePaise',stock_value_paise,'employeeId',employee_id,'actorUserId',actor_user_id,'comment',comment,'referenceType',reference_type,'referenceId',reference_id,'warning',warning,'metadata',metadata,'createdAt',created_at) FROM inventory_operational_movements WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant).bind(branch).bind(key).fetch_one(&mut **tx).await
}

#[allow(clippy::too_many_arguments)]
pub async fn record_automatic_stock_out(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    action: &str,
    preferred_bucket: &str,
    quantity: i32,
    unit_cost_paise: i64,
    employee: Option<&str>,
    actor: &str,
    reference_type: &str,
    reference_id: &str,
    key: &str,
    warning: bool,
) -> Result<(), sqlx::Error> {
    let preferred=operational_bucket_balance(tx,tenant,branch,item,preferred_bucket).await?.max(0).min(i64::from(quantity)) as i32;
    if preferred>0 {
        record_operational_movement(tx,tenant,branch,item,action,preferred_bucket,if action=="auto_retail_sale"{"sold"}else{"consumed"},preferred,unit_cost_paise,employee,actor,"",reference_type,reference_id,&format!("{key}:floor"),warning,&serde_json::json!({"automatic":true})).await?;
    }
    let from_store=quantity-preferred;
    if from_store>0 {
        record_operational_movement(tx,tenant,branch,item,action,"store_unopened",if action=="auto_retail_sale"{"sold"}else{"consumed"},from_store,unit_cost_paise,employee,actor,"",reference_type,reference_id,&format!("{key}:store"),warning,&serde_json::json!({"automatic":true})).await?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn record_automatic_transfer_out(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    preferred_bucket: &str,
    quantity: i32,
    unit_cost_paise: i64,
    actor: &str,
    shipment_line_id: &str,
    key: &str,
    warning: bool,
) -> Result<(), sqlx::Error> {
    let preferred=operational_bucket_balance(tx,tenant,branch,item,preferred_bucket).await?.max(0).min(i64::from(quantity)) as i32;
    if preferred>0 {
        record_operational_movement(tx,tenant,branch,item,"auto_transfer_checkout",preferred_bucket,"in_transit",preferred,unit_cost_paise,None,actor,"Automatic transfer checkout","transfer_shipment_line",shipment_line_id,&format!("{key}:floor"),warning,&serde_json::json!({"automatic":true})).await?;
    }
    if quantity>preferred {
        record_operational_movement(tx,tenant,branch,item,"auto_transfer_checkout","store_unopened","in_transit",quantity-preferred,unit_cost_paise,None,actor,"Automatic transfer checkout","transfer_shipment_line",shipment_line_id,&format!("{key}:store"),warning,&serde_json::json!({"automatic":true})).await?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn auto_open_service_container(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    stock_quantity: i32,
    unit_cost_paise: i64,
    actor: &str,
    key: &str,
) -> Result<Option<(String,i32)>, sqlx::Error> {
    let policy=sqlx::query_as::<_,(bool,String)>("SELECT COALESCE((SELECT auto_checkout_service_consumption FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),TRUE),COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
        .bind(tenant).bind(branch).fetch_one(&mut **tx).await?;
    if !policy.0 { return Ok(None); }
    let sealed=sqlx::query_as::<_,(String,i32)>(r#"SELECT container.id,container.capacity_quantity
        FROM inventory_backbar_containers container
        LEFT JOIN inventory_batches batch ON batch.id=container.batch_id
        WHERE container.tenant_id=$1 AND container.branch_id=$2 AND container.inventory_item_id=$3 AND container.status='sealed'
        ORDER BY batch.expiry_date NULLS LAST,batch.received_date NULLS LAST,container.created_at,container.id
        LIMIT 1 FOR UPDATE OF container"#)
        .bind(tenant).bind(branch).bind(item).fetch_optional(&mut **tx).await?;
    let Some((container_id,capacity))=sealed else { return Ok(None); };
    let warning=stock_quantity<capacity;
    if warning && policy.1!="allow_with_warning" { return Err(sqlx::Error::Protocol("insufficient stock to open the next service container".into())); }
    let stock_after=stock_quantity-capacity;
    sqlx::query("UPDATE inventory_backbar_containers SET status='open',opened_by=$4,opened_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='sealed'")
        .bind(tenant).bind(branch).bind(&container_id).bind(actor).execute(&mut **tx).await?;
    sqlx::query("UPDATE inventory_items SET stock_quantity=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(item).bind(stock_after).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO inventory_stock_ledger(tenant_id,branch_id,inventory_item_id,movement_type,quantity_delta,unit_cost_paise,stock_after_quantity,backbar_container_id) VALUES($1,$2,$3,'consumption',$4,$5,$6,$7)")
        .bind(tenant).bind(branch).bind(item).bind(-capacity).bind(unit_cost_paise).bind(stock_after).bind(&container_id).execute(&mut **tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'opened',$4,$5,$6,jsonb_build_object('automatic',TRUE,'source','service_consumption'))")
        .bind(tenant).bind(branch).bind(&container_id).bind(capacity).bind(actor).bind(key).execute(&mut **tx).await?;
    record_operational_movement(tx,tenant,branch,item,"auto_service_checkout","sealed_backbar_reserve","open_floor_balance",capacity,unit_cost_paise,None,actor,"Automatic service container opening","backbar_container",&container_id,&format!("{key}:movement"),warning,&serde_json::json!({"automatic":true,"negativeStockRule":policy.1})).await?;
    Ok(Some((container_id,capacity)))
}

async fn available_source_quantity(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    item: &str,
    source: &str,
    stock_quantity: i32,
) -> Result<i64, sqlx::Error> {
    if source != "store_unopened" {
        return operational_bucket_balance(tx, tenant, branch, item, source).await;
    }
    let sealed = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(capacity_quantity),0)::BIGINT FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND inventory_item_id=$3 AND status='sealed'")
        .bind(tenant).bind(branch).bind(item).fetch_one(&mut **tx).await?;
    let retail = operational_bucket_balance(tx,tenant,branch,item,"retail_available").await?;
    let consumable = operational_bucket_balance(tx,tenant,branch,item,"consumable_available").await?;
    Ok(i64::from(stock_quantity)-sealed-retail-consumable)
}

#[allow(clippy::too_many_arguments)]
pub async fn move_stock_bucket(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    item: &str,
    action: &str,
    source: &str,
    destination: &str,
    quantity: i32,
    employee: Option<&str>,
    comment: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx=db.begin().await?;
    let master=sqlx::query_as::<_,(String,i32,i64)>("SELECT product_usage,stock_quantity,unit_cost_paise FROM inventory_items WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
        .bind(tenant).bind(branch).bind(item).fetch_one(&mut *tx).await?;
    if let Some(staff_id)=employee {
        let exists=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)")
            .bind(tenant).bind(branch).bind(staff_id).fetch_one(&mut *tx).await?;
        if !exists { return Err(sqlx::Error::Protocol("employee is not available".into())); }
    }
    let valid=match action {
        "manual_checkout" => source=="store_unopened" && match destination {
            "retail_available" => master.0!="consumable",
            "consumable_available" => master.0!="retail",
            _ => false,
        },
        "conversion" => master.0=="dual_use" && matches!((source,destination),("retail_available","consumable_available")|("consumable_available","retail_available")),
        _ => false,
    };
    if !valid { return Err(sqlx::Error::Protocol("product usage and stock bucket action do not match".into())); }
    let available=available_source_quantity(&mut tx,tenant,branch,item,source,master.1).await?;
    let rule=sqlx::query_scalar::<_,String>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
        .bind(tenant).bind(branch).fetch_one(&mut *tx).await?;
    let warning=available<i64::from(quantity);
    if warning && rule!="allow_with_warning" {
        return Err(sqlx::Error::Protocol(if rule=="approval_required" { "insufficient source bucket; owner approval is required" } else { "insufficient source bucket" }.into()));
    }
    let row=record_operational_movement(&mut tx,tenant,branch,item,action,source,destination,quantity,master.2,employee,actor,comment,"manual",key,key,warning,&serde_json::json!({"availableBefore":available,"negativeStockRule":rule})).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn reverse_operational_movement(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    comment: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx=db.begin().await?;
    let row=sqlx::query_as::<_,(String,String,String,i32,i64,Option<String>,String)>("SELECT inventory_item_id,source_bucket,destination_bucket,quantity,unit_cost_paise,employee_id,action FROM inventory_operational_movements WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant).bind(branch).bind(id).fetch_one(&mut *tx).await?;
    if !matches!(row.6.as_str(),"manual_checkout"|"conversion") {
        return Err(sqlx::Error::Protocol("physical movements must be corrected through their source return or override workflow".into()));
    }
    let available=operational_bucket_balance(&mut tx,tenant,branch,&row.0,&row.2).await?;
    let rule=sqlx::query_scalar::<_,String>("SELECT COALESCE((SELECT negative_stock_rule FROM inventory_policies WHERE tenant_id=$1 AND branch_id=$2),'block')")
        .bind(tenant).bind(branch).fetch_one(&mut *tx).await?;
    let warning=available<i64::from(row.3);
    if warning && rule!="allow_with_warning" { return Err(sqlx::Error::Protocol("insufficient source bucket to reverse movement".into())); }
    let inserted=sqlx::query_scalar::<_,Value>(r#"INSERT INTO inventory_operational_movements(
        tenant_id,branch_id,inventory_item_id,action,source_bucket,destination_bucket,quantity,
        unit_cost_paise,stock_value_paise,employee_id,actor_user_id,comment,reference_type,reference_id,
        idempotency_key,reversal_of_id,warning,metadata
      ) VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,$6::BIGINT*$7,$8,$9,$10,'operational_movement',$11,$12,$11,$13,jsonb_build_object('originalAction',$14,'availableBefore',$15,'negativeStockRule',$16))
      RETURNING jsonb_build_object('id',id,'inventoryItemId',inventory_item_id,'action',action,'sourceBucket',source_bucket,
        'destinationBucket',destination_bucket,'quantity',quantity,'unitCostPaise',unit_cost_paise,'stockValuePaise',stock_value_paise,
        'employeeId',employee_id,'actorUserId',actor_user_id,'comment',comment,'referenceType',reference_type,'referenceId',reference_id,
        'warning',warning,'metadata',metadata,'createdAt',created_at)"#)
        .bind(tenant).bind(branch).bind(&row.0).bind(&row.2).bind(&row.1).bind(row.3).bind(row.4)
        .bind(row.5.as_deref()).bind(actor).bind(comment).bind(id).bind(key).bind(warning).bind(&row.6).bind(available).bind(&rule)
        .fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(inserted)
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

pub async fn floor_control(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
          'locations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'code',location.code,'name',location.name,'locationType',location.location_type,
            'active',location.active,'updatedAt',location.updated_at
          ) ORDER BY location.name) FROM inventory_floor_locations location
          WHERE location.tenant_id=$1 AND location.branch_id=$2),'[]'::JSONB),
          'balances',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'inventoryItemId',balance.id,'productName',balance.name,'productUsage',balance.product_usage,'unit',balance.unit,
            'unopenedQuantity',balance.stock_quantity-balance.sealed_balance-balance.retail_available-balance.consumable_available,
            'storeUnopened',balance.stock_quantity-balance.sealed_balance-balance.retail_available-balance.consumable_available,
            'sealedCount',balance.sealed_count,'sealedBalance',balance.sealed_balance,
            'sealedBackbarReserve',balance.sealed_balance,'retailAvailable',balance.retail_available,
            'consumableAvailable',balance.consumable_available,'openBalance',balance.open_balance,
            'openFloorBalance',balance.open_balance,'damagedQuarantine',balance.damaged_quarantine,
            'inTransit',balance.in_transit,'unifiedOnHand',balance.stock_quantity+balance.open_balance,
            'physicalTotal',balance.stock_quantity+balance.open_balance+balance.damaged_quarantine,
            'actualConsumed',balance.actual_consumed
          ) ORDER BY balance.name) FROM (
            SELECT item.id,item.name,item.product_usage,item.unit,item.stock_quantity,
              COUNT(container.id) FILTER(WHERE container.status='sealed')::BIGINT sealed_count,
              COALESCE(SUM(container.capacity_quantity) FILTER(WHERE container.status='sealed'),0)::BIGINT sealed_balance,
              COALESCE(SUM(container.remaining_quantity) FILTER(WHERE container.status='open'),0)::BIGINT open_balance,
              COALESCE((SELECT SUM(CASE WHEN movement.destination_bucket='retail_available' THEN movement.quantity WHEN movement.source_bucket='retail_available' THEN -movement.quantity ELSE 0 END)
                FROM inventory_operational_movements movement WHERE movement.tenant_id=item.tenant_id AND movement.branch_id=item.branch_id AND movement.inventory_item_id=item.id),0)::BIGINT retail_available,
              COALESCE((SELECT SUM(CASE WHEN movement.destination_bucket='consumable_available' THEN movement.quantity WHEN movement.source_bucket='consumable_available' THEN -movement.quantity ELSE 0 END)
                FROM inventory_operational_movements movement WHERE movement.tenant_id=item.tenant_id AND movement.branch_id=item.branch_id AND movement.inventory_item_id=item.id),0)::BIGINT consumable_available,
              COALESCE((SELECT SUM(quarantine.quantity) FROM inventory_receiving_quarantine quarantine
                WHERE quarantine.tenant_id=item.tenant_id AND quarantine.branch_id=item.branch_id AND quarantine.inventory_item_id=item.id AND quarantine.status='quarantined'),0)::BIGINT damaged_quarantine,
              COALESCE((SELECT SUM(GREATEST(0,shipment_line.dispatched_retail_quantity+shipment_line.dispatched_consumable_quantity
                -shipment_line.received_retail_quantity-shipment_line.received_consumable_quantity-shipment_line.damaged_quantity-shipment_line.expired_quantity-shipment_line.short_quantity))
                FROM inventory_transfer_shipment_lines shipment_line
                JOIN inventory_transfer_shipments shipment ON shipment.id=shipment_line.shipment_id AND shipment.tenant_id=shipment_line.tenant_id
                JOIN inventory_transfer_lines transfer_line ON transfer_line.id=shipment_line.transfer_line_id AND transfer_line.tenant_id=shipment_line.tenant_id
                JOIN inventory_transfers transfer ON transfer.id=transfer_line.transfer_id AND transfer.tenant_id=transfer_line.tenant_id
                WHERE transfer.tenant_id=item.tenant_id AND transfer.destination_branch_id=item.branch_id
                  AND transfer_line.destination_inventory_item_id=item.id AND shipment.status IN ('dispatched','in_transit')),0)::BIGINT in_transit,
              COALESCE((SELECT SUM(ABS(event.quantity_delta)) FROM inventory_backbar_container_events event
                JOIN inventory_backbar_containers used ON used.id=event.container_id
                WHERE event.tenant_id=item.tenant_id AND event.branch_id=item.branch_id
                  AND used.inventory_item_id=item.id AND event.event_type='consumed'),0)::BIGINT
              +COALESCE((SELECT SUM(ABS(ledger.quantity_delta)) FROM inventory_stock_ledger ledger
                WHERE ledger.tenant_id=item.tenant_id AND ledger.branch_id=item.branch_id
                  AND ledger.inventory_item_id=item.id AND ledger.movement_type='consumption'
                  AND ledger.backbar_container_id IS NULL),0)::BIGINT actual_consumed
            FROM inventory_items item
            LEFT JOIN inventory_backbar_containers container ON container.tenant_id=item.tenant_id
              AND container.branch_id=item.branch_id AND container.inventory_item_id=item.id
            WHERE item.tenant_id=$1 AND item.branch_id=$2 AND item.active=TRUE
            GROUP BY item.id,item.name,item.product_usage,item.unit,item.stock_quantity,item.tenant_id,item.branch_id
          ) balance),'[]'::JSONB),
          'custodyEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',event.id,'containerId',event.container_id,'barcode',container.barcode,
            'productName',item.name,'fromLocationCode',event.from_location_code,
            'toLocationCode',event.to_location_code,'fromStaffId',event.from_staff_id,
            'toStaffId',event.to_staff_id,'reason',event.reason,'actorUserId',event.actor_user_id,
            'createdAt',event.created_at
          ) ORDER BY event.created_at DESC) FROM (
            SELECT * FROM inventory_floor_custody_events
            WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 200
          ) event JOIN inventory_backbar_containers container ON container.id=event.container_id
            JOIN inventory_items item ON item.id=container.inventory_item_id),'[]'::JSONB),
          'closings',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',closing.id,'businessDate',closing.business_date,'shiftLabel',closing.shift_label,
            'status',closing.status,'requestedBy',closing.requested_by,'reviewedBy',closing.reviewed_by,
            'reviewedAt',closing.reviewed_at,'reviewNote',closing.review_note,'createdAt',closing.created_at,
            'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'containerId',line.container_id,'barcode',container.barcode,'productName',item.name,
              'expectedRemaining',line.expected_remaining,'countedRemaining',line.counted_remaining,
              'varianceQuantity',line.variance_quantity,'reason',line.reason,'unit',line.unit
            ) ORDER BY item.name) FROM inventory_floor_closing_lines line
              JOIN inventory_backbar_containers container ON container.id=line.container_id
              JOIN inventory_items item ON item.id=line.inventory_item_id
              WHERE line.closing_id=closing.id),'[]'::JSONB)
          ) ORDER BY closing.created_at DESC) FROM (
            SELECT * FROM inventory_floor_closings
            WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 50
          ) closing),'[]'::JSONB),
          'operationalMovements',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id',movement.id,'inventoryItemId',movement.inventory_item_id,'productName',item.name,
            'action',movement.action,'sourceBucket',movement.source_bucket,'destinationBucket',movement.destination_bucket,
            'quantity',movement.quantity,'unit',item.unit,'unitCostPaise',movement.unit_cost_paise,
            'stockValuePaise',movement.stock_value_paise,'employeeId',movement.employee_id,
            'employeeName',COALESCE(NULLIF(BTRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),''),
            'actorUserId',movement.actor_user_id,'comment',movement.comment,'referenceType',movement.reference_type,
            'referenceId',movement.reference_id,'warning',movement.warning,'reversalOfId',movement.reversal_of_id,
            'reversed',EXISTS(SELECT 1 FROM inventory_operational_movements reversal WHERE reversal.reversal_of_id=movement.id),
            'metadata',movement.metadata,'createdAt',movement.created_at
          ) ORDER BY movement.created_at DESC,movement.id DESC) FROM (
            SELECT * FROM inventory_operational_movements WHERE tenant_id=$1 AND branch_id=$2
            ORDER BY created_at DESC,id DESC LIMIT 500
          ) movement JOIN inventory_items item ON item.id=movement.inventory_item_id
            LEFT JOIN staff ON staff.id=movement.employee_id),'[]'::JSONB)
        )"#,
    )
    .bind(tenant)
    .bind(branch)
    .fetch_one(db)
    .await
}

pub async fn save_floor_location(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    code: &str,
    name: &str,
    location_type: &str,
    active: bool,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO inventory_floor_locations(tenant_id,branch_id,code,name,location_type,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,branch_id,code) DO UPDATE SET name=EXCLUDED.name,location_type=EXCLUDED.location_type,active=EXCLUDED.active,updated_at=NOW() RETURNING jsonb_build_object('code',code,'name',name,'locationType',location_type,'active',active,'updatedAt',updated_at)")
        .bind(tenant).bind(branch).bind(code).bind(name).bind(location_type).bind(active).bind(actor)
        .fetch_one(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn transfer_container_custody(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    container_id: &str,
    to_location: &str,
    to_staff_id: Option<&str>,
    reason: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(existing)=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'containerId',container_id,'fromLocationCode',from_location_code,'toLocationCode',to_location_code,'toStaffId',to_staff_id,'createdAt',created_at) FROM inventory_floor_custody_events WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant).bind(branch).bind(key).fetch_optional(&mut *tx).await? {
        tx.commit().await?;
        return Ok(existing);
    }
    let location_exists=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM inventory_floor_locations WHERE tenant_id=$1 AND branch_id=$2 AND code=$3 AND active=TRUE)")
        .bind(tenant).bind(branch).bind(to_location).fetch_one(&mut *tx).await?;
    if !location_exists {
        return Err(sqlx::Error::RowNotFound);
    }
    if let Some(staff_id) = to_staff_id {
        let staff_exists=sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)")
            .bind(tenant).bind(branch).bind(staff_id).fetch_one(&mut *tx).await?;
        if !staff_exists {
            return Err(sqlx::Error::RowNotFound);
        }
    }
    let current=sqlx::query_as::<_,(String,Option<String>,i32)>("SELECT location_code,custodian_staff_id,remaining_quantity FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status IN ('sealed','open') FOR UPDATE")
        .bind(tenant).bind(branch).bind(container_id).fetch_one(&mut *tx).await?;
    let event_id=sqlx::query_scalar::<_,String>("INSERT INTO inventory_floor_custody_events(tenant_id,branch_id,container_id,from_location_code,to_location_code,from_staff_id,to_staff_id,reason,actor_user_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id")
        .bind(tenant).bind(branch).bind(container_id).bind(&current.0).bind(to_location).bind(current.1.as_deref()).bind(to_staff_id).bind(reason).bind(actor).bind(key)
        .fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE inventory_backbar_containers SET location_code=$4,custodian_staff_id=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(container_id).bind(to_location).bind(to_staff_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'custody_transferred',$4,$5,$6,jsonb_build_object('fromLocationCode',$7,'toLocationCode',$8,'fromStaffId',$9,'toStaffId',$10,'reason',$11))")
        .bind(tenant).bind(branch).bind(container_id).bind(current.2).bind(actor).bind(format!("custody:{key}")).bind(&current.0).bind(to_location).bind(current.1.as_deref()).bind(to_staff_id).bind(reason)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(
        serde_json::json!({"id":event_id,"containerId":container_id,"fromLocationCode":current.0,"toLocationCode":to_location,"toStaffId":to_staff_id}),
    )
}

pub async fn create_floor_closing(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    business_date: chrono::NaiveDate,
    shift_label: &str,
    lines: &[(String, i32, String)],
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    if let Some(id)=sqlx::query_scalar::<_,String>("SELECT id FROM inventory_floor_closings WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(tenant).bind(branch).bind(key).fetch_optional(&mut *tx).await? {
        tx.rollback().await.ok();
        return floor_closing(db,tenant,branch,&id).await;
    }
    let open=sqlx::query_as::<_,(String,String,i32,i32,String)>("SELECT id,inventory_item_id,remaining_quantity,capacity_quantity,unit FROM inventory_backbar_containers WHERE tenant_id=$1 AND branch_id=$2 AND status='open' ORDER BY id FOR UPDATE")
        .bind(tenant).bind(branch).fetch_all(&mut *tx).await?;
    if open.len() != lines.len()
        || open
            .iter()
            .any(|row| !lines.iter().any(|line| line.0 == row.0))
    {
        return Err(sqlx::Error::Protocol(
            "floor closing must count every open container exactly once".into(),
        ));
    }
    let pending = open.iter().any(|row| {
        lines
            .iter()
            .find(|line| line.0 == row.0)
            .is_some_and(|line| line.1 != row.2)
    });
    let status = if pending {
        "pending_approval"
    } else {
        "recorded"
    };
    let id=sqlx::query_scalar::<_,String>("INSERT INTO inventory_floor_closings(tenant_id,branch_id,business_date,shift_label,status,requested_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id")
        .bind(tenant).bind(branch).bind(business_date).bind(shift_label).bind(status).bind(actor).bind(key).fetch_one(&mut *tx).await?;
    for row in open {
        let line = lines
            .iter()
            .find(|line| line.0 == row.0)
            .expect("validated closing line");
        if line.1 < 0 || line.1 > row.3 {
            return Err(sqlx::Error::Protocol(
                "counted remaining exceeds container capacity".into(),
            ));
        }
        if line.1 != row.2 && line.2.trim().is_empty() {
            return Err(sqlx::Error::Protocol("variance reason is required".into()));
        }
        sqlx::query("INSERT INTO inventory_floor_closing_lines(closing_id,tenant_id,branch_id,container_id,inventory_item_id,expected_remaining,counted_remaining,variance_quantity,reason,unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&id).bind(tenant).bind(branch).bind(&row.0).bind(&row.1).bind(row.2).bind(line.1).bind(line.1-row.2).bind(line.2.trim()).bind(row.4)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    floor_closing(db, tenant, branch, &id).await
}

async fn floor_closing(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',closing.id,'businessDate',closing.business_date,'shiftLabel',closing.shift_label,'status',closing.status,'requestedBy',closing.requested_by,'reviewedBy',closing.reviewed_by,'reviewedAt',closing.reviewed_at,'reviewNote',closing.review_note,'createdAt',closing.created_at,'lines',COALESCE((SELECT jsonb_agg(jsonb_build_object('containerId',line.container_id,'barcode',container.barcode,'productName',item.name,'expectedRemaining',line.expected_remaining,'countedRemaining',line.counted_remaining,'varianceQuantity',line.variance_quantity,'reason',line.reason,'unit',line.unit) ORDER BY item.name) FROM inventory_floor_closing_lines line JOIN inventory_backbar_containers container ON container.id=line.container_id JOIN inventory_items item ON item.id=line.inventory_item_id WHERE line.closing_id=closing.id),'[]'::JSONB)) FROM inventory_floor_closings closing WHERE closing.tenant_id=$1 AND closing.branch_id=$2 AND closing.id=$3")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await
}

pub async fn review_floor_closing(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    id: &str,
    approve: bool,
    note: &str,
    key: &str,
) -> Result<Value, sqlx::Error> {
    let mut tx = db.begin().await?;
    let closing=sqlx::query_as::<_,(String,String,String)>("SELECT status,requested_by,review_idempotency_key FROM inventory_floor_closings WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE")
        .bind(tenant).bind(branch).bind(id).fetch_one(&mut *tx).await?;
    if !closing.2.is_empty() && closing.2 == key {
        tx.rollback().await.ok();
        return floor_closing(db, tenant, branch, id).await;
    }
    if closing.0 != "pending_approval" {
        return Err(sqlx::Error::Protocol(
            "floor closing is not pending approval".into(),
        ));
    }
    if closing.1 == actor {
        return Err(sqlx::Error::Protocol(
            "maker cannot approve own floor closing".into(),
        ));
    }
    let status = if approve { "approved" } else { "rejected" };
    if approve {
        let lines=sqlx::query_as::<_,(String,i32,i32)>("SELECT container_id,expected_remaining,counted_remaining FROM inventory_floor_closing_lines WHERE tenant_id=$1 AND branch_id=$2 AND closing_id=$3 ORDER BY container_id FOR UPDATE")
            .bind(tenant).bind(branch).bind(id).fetch_all(&mut *tx).await?;
        for line in lines {
            let remaining=sqlx::query_scalar::<_,i32>("UPDATE inventory_backbar_containers SET remaining_quantity=$4,status=CASE WHEN $4=0 THEN 'empty' ELSE 'open' END,closed_by=CASE WHEN $4=0 THEN $5 ELSE closed_by END,closed_at=CASE WHEN $4=0 THEN NOW() ELSE closed_at END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' AND remaining_quantity=$6 RETURNING remaining_quantity")
                .bind(tenant).bind(branch).bind(&line.0).bind(line.2).bind(actor).bind(line.1).fetch_one(&mut *tx).await?;
            sqlx::query("INSERT INTO inventory_backbar_container_events(tenant_id,branch_id,container_id,event_type,quantity_delta,remaining_after,actor_user_id,idempotency_key,metadata) VALUES($1,$2,$3,'floor_count_adjusted',$4,$5,$6,$7,jsonb_build_object('closingId',$8,'expectedRemaining',$9,'countedRemaining',$10,'reviewNote',$11))")
                .bind(tenant).bind(branch).bind(&line.0).bind(line.2-line.1).bind(remaining).bind(actor).bind(format!("floor-closing:{id}:{}",line.0)).bind(id).bind(line.1).bind(line.2).bind(note)
                .execute(&mut *tx).await?;
        }
    }
    sqlx::query("UPDATE inventory_floor_closings SET status=$4,reviewed_by=$5,reviewed_at=NOW(),review_note=$6,review_idempotency_key=$7 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant).bind(branch).bind(id).bind(status).bind(actor).bind(note).bind(key).execute(&mut *tx).await?;
    tx.commit().await?;
    floor_closing(db, tenant, branch, id).await
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
