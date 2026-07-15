use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};

pub struct LaundryItemInput {
    pub item_code: String,
    pub item_name: String,
    pub category: String,
    pub quantity: i32,
    pub barcode: String,
    pub color: String,
    pub material: String,
    pub condition_in: String,
}

pub async fn client_exists(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM clients WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND merged_into_client_id IS NULL)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await
}

pub async fn supplier_exists(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM suppliers WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE)")
        .bind(tenant).bind(branch).bind(id).fetch_one(db).await
}

pub async fn summary(db: &PgPool, tenant: &str, branch: &str) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar(r#"SELECT jsonb_build_object(
      'activeOrders',COUNT(*) FILTER (WHERE status NOT IN ('returned','cancelled')),
      'dueToday',COUNT(*) FILTER (WHERE status NOT IN ('returned','cancelled') AND due_at::DATE=CURRENT_DATE),
      'overdue',COUNT(*) FILTER (WHERE status NOT IN ('returned','cancelled') AND due_at<NOW()),
      'ready',COUNT(*) FILTER (WHERE status='ready'),
      'openIssues',(SELECT COUNT(*) FROM laundry_issues i WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.status='open')
    ) FROM laundry_orders WHERE tenant_id=$1 AND branch_id=$2"#)
        .bind(tenant).bind(branch).fetch_one(db).await
}

pub async fn list_orders(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    status: Option<&str>,
    query: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    let query = query.unwrap_or("").trim();
    sqlx::query_scalar(r#"SELECT jsonb_build_object(
      'id',o.id,'orderNumber',o.order_number,'ownerType',o.owner_type,'clientId',o.client_id,
      'clientName',COALESCE(NULLIF(TRIM(CONCAT(c.first_name,' ',c.last_name)),''),''),
      'supplierId',o.supplier_id,'supplierName',COALESCE(s.name,''),'status',o.status,'priority',o.priority,
      'intakeAt',o.intake_at,'dueAt',o.due_at,'totalItems',o.total_items,'totalWeightGrams',o.total_weight_grams,
      'estimatedCostPaise',o.estimated_cost_paise,'actualCostPaise',o.actual_cost_paise,'notes',o.notes,
      'openIssues',(SELECT COUNT(*) FROM laundry_issues i WHERE i.order_id=o.id AND i.status='open'),
      'createdAt',o.created_at,'updatedAt',o.updated_at
    ) FROM laundry_orders o
    LEFT JOIN clients c ON c.id=o.client_id AND c.tenant_id=o.tenant_id AND c.branch_id=o.branch_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id AND s.tenant_id=o.tenant_id AND s.branch_id=o.branch_id
    WHERE o.tenant_id=$1 AND o.branch_id=$2 AND ($3::TEXT IS NULL OR o.status=$3)
      AND ($4='' OR o.order_number ILIKE '%'||$4||'%' OR COALESCE(c.first_name,'') ILIKE '%'||$4||'%' OR COALESCE(c.last_name,'') ILIKE '%'||$4||'%' OR EXISTS(SELECT 1 FROM laundry_items li WHERE li.order_id=o.id AND li.barcode ILIKE '%'||$4||'%'))
    ORDER BY CASE WHEN o.status='ready' THEN 0 ELSE 1 END,COALESCE(o.due_at,'infinity'::TIMESTAMPTZ),o.created_at DESC LIMIT 500"#)
        .bind(tenant).bind(branch).bind(status).bind(query).fetch_all(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_order(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    order_number: &str,
    owner_type: &str,
    client_id: Option<&str>,
    supplier_id: Option<&str>,
    priority: &str,
    due_at: Option<DateTime<Utc>>,
    total_weight_grams: Option<i32>,
    estimated_cost_paise: i64,
    notes: &str,
    items: &[LaundryItemInput],
) -> Result<String, sqlx::Error> {
    let mut tx = db.begin().await?;
    let total_items: i32 = items.iter().map(|item| item.quantity).sum();
    let order_id=sqlx::query_scalar::<_, String>("INSERT INTO laundry_orders(tenant_id,branch_id,order_number,owner_type,client_id,supplier_id,priority,due_at,total_items,total_weight_grams,estimated_cost_paise,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id")
        .bind(tenant).bind(branch).bind(order_number).bind(owner_type).bind(client_id).bind(supplier_id).bind(priority).bind(due_at).bind(total_items).bind(total_weight_grams).bind(estimated_cost_paise).bind(notes).bind(actor).fetch_one(&mut *tx).await?;
    for item in items {
        sqlx::query("INSERT INTO laundry_items(tenant_id,branch_id,order_id,item_code,item_name,category,quantity,barcode,color,material,condition_in) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
            .bind(tenant).bind(branch).bind(&order_id).bind(&item.item_code).bind(&item.item_name).bind(&item.category).bind(item.quantity).bind(&item.barcode).bind(&item.color).bind(&item.material).bind(&item.condition_in).execute(&mut *tx).await?;
    }
    insert_event(
        &mut tx,
        tenant,
        branch,
        &order_id,
        None,
        "order.created",
        "",
        "received",
        actor,
        "",
        json!({"totalItems":total_items}),
    )
    .await?;
    tx.commit().await?;
    Ok(order_id)
}

pub async fn detail(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    let Some(order)=sqlx::query_scalar::<_, Value>(r#"SELECT jsonb_build_object(
      'id',o.id,'orderNumber',o.order_number,'ownerType',o.owner_type,'clientId',o.client_id,
      'clientName',COALESCE(NULLIF(TRIM(CONCAT(c.first_name,' ',c.last_name)),''),''),
      'supplierId',o.supplier_id,'supplierName',COALESCE(s.name,''),'status',o.status,'priority',o.priority,
      'intakeAt',o.intake_at,'dueAt',o.due_at,'totalItems',o.total_items,'totalWeightGrams',o.total_weight_grams,
      'estimatedCostPaise',o.estimated_cost_paise,'actualCostPaise',o.actual_cost_paise,'notes',o.notes,
      'openIssues',(SELECT COUNT(*) FROM laundry_issues i WHERE i.order_id=o.id AND i.status='open'),
      'createdAt',o.created_at,'updatedAt',o.updated_at
    ) FROM laundry_orders o
    LEFT JOIN clients c ON c.id=o.client_id AND c.tenant_id=o.tenant_id AND c.branch_id=o.branch_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id AND s.tenant_id=o.tenant_id AND s.branch_id=o.branch_id
    WHERE o.tenant_id=$1 AND o.branch_id=$2 AND o.id=$3"#)
        .bind(tenant).bind(branch).bind(id).fetch_optional(db).await? else { return Ok(None); };
    let items=sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('id',id,'itemCode',item_code,'itemName',item_name,'category',category,'quantity',quantity,'barcode',barcode,'color',color,'material',material,'conditionIn',condition_in,'conditionOut',condition_out,'status',status) FROM laundry_items WHERE tenant_id=$1 AND branch_id=$2 AND order_id=$3 ORDER BY created_at,id")
        .bind(tenant).bind(branch).bind(id).fetch_all(db).await?;
    let events=sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('id',id,'itemId',item_id,'eventType',event_type,'fromStatus',from_status,'toStatus',to_status,'actorId',actor_id,'note',note,'metadata',metadata_json,'createdAt',created_at) FROM laundry_events WHERE tenant_id=$1 AND branch_id=$2 AND order_id=$3 ORDER BY created_at DESC LIMIT 200")
        .bind(tenant).bind(branch).bind(id).fetch_all(db).await?;
    let issues=sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('id',id,'itemId',item_id,'issueType',issue_type,'severity',severity,'status',status,'description',description,'chargePaise',charge_paise,'resolution',resolution,'createdAt',created_at,'resolvedAt',resolved_at) FROM laundry_issues WHERE tenant_id=$1 AND branch_id=$2 AND order_id=$3 ORDER BY created_at DESC")
        .bind(tenant).bind(branch).bind(id).fetch_all(db).await?;
    Ok(Some(
        json!({"order":order,"items":items,"events":events,"issues":issues}),
    ))
}

pub async fn current_status(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT status FROM laundry_orders WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant)
    .bind(branch)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn transition(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    id: &str,
    actor: &str,
    expected_status: &str,
    next_status: &str,
    note: &str,
    actual_cost_paise: Option<i64>,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed=sqlx::query("UPDATE laundry_orders SET status=$5,actual_cost_paise=COALESCE($7,actual_cost_paise),ready_at=CASE WHEN $5='ready' THEN NOW() ELSE ready_at END,returned_at=CASE WHEN $5='returned' THEN NOW() ELSE returned_at END,updated_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status=$6")
        .bind(tenant).bind(branch).bind(id).bind(actor).bind(next_status).bind(expected_status).bind(actual_cost_paise).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("UPDATE laundry_items SET status=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND order_id=$3")
        .bind(tenant).bind(branch).bind(id).bind(next_status).execute(&mut *tx).await?;
    insert_event(
        &mut tx,
        tenant,
        branch,
        id,
        None,
        "status.changed",
        expected_status,
        next_status,
        actor,
        note,
        json!({}),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
pub async fn create_issue(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    order_id: &str,
    item_id: Option<&str>,
    actor: &str,
    issue_type: &str,
    severity: &str,
    description: &str,
    charge_paise: i64,
) -> Result<Option<String>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let issue_id=sqlx::query_scalar("INSERT INTO laundry_issues(tenant_id,branch_id,order_id,item_id,issue_type,severity,description,charge_paise,reported_by) SELECT $1,$2,o.id,$4,$5,$6,$7,$8,$9 FROM laundry_orders o WHERE o.tenant_id=$1 AND o.branch_id=$2 AND o.id=$3 AND ($4::TEXT IS NULL OR EXISTS(SELECT 1 FROM laundry_items i WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.order_id=$3 AND i.id=$4)) RETURNING id")
        .bind(tenant).bind(branch).bind(order_id).bind(item_id).bind(issue_type).bind(severity).bind(description).bind(charge_paise).bind(actor).fetch_optional(&mut *tx).await?;
    if let Some(ref id) = issue_id {
        insert_event(
            &mut tx,
            tenant,
            branch,
            order_id,
            item_id,
            "issue.reported",
            "",
            "",
            actor,
            description,
            json!({"issueId":id,"type":issue_type,"severity":severity}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(issue_id)
}

pub async fn resolve_issue(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    issue_id: &str,
    actor: &str,
    status: &str,
    resolution: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row=sqlx::query_as::<_,(String,Option<String>)>("UPDATE laundry_issues SET status=$5,resolution=$6,resolved_by=$4,resolved_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='open' RETURNING order_id,item_id")
        .bind(tenant).bind(branch).bind(issue_id).bind(actor).bind(status).bind(resolution).fetch_optional(&mut *tx).await?;
    if let Some((order_id, item_id)) = row {
        insert_event(
            &mut tx,
            tenant,
            branch,
            &order_id,
            item_id.as_deref(),
            "issue.resolved",
            "open",
            status,
            actor,
            resolution,
            json!({"issueId":issue_id}),
        )
        .await?;
        tx.commit().await?;
        Ok(true)
    } else {
        tx.rollback().await?;
        Ok(false)
    }
}

pub async fn scan_barcode(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    barcode: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('itemId',i.id,'itemCode',i.item_code,'itemName',i.item_name,'quantity',i.quantity,'barcode',i.barcode,'status',i.status,'orderId',o.id,'orderNumber',o.order_number,'orderStatus',o.status,'dueAt',o.due_at) FROM laundry_items i JOIN laundry_orders o ON o.id=i.order_id AND o.tenant_id=i.tenant_id AND o.branch_id=i.branch_id WHERE i.tenant_id=$1 AND i.branch_id=$2 AND i.barcode=$3")
        .bind(tenant).bind(branch).bind(barcode).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
async fn insert_event(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &str,
    branch: &str,
    order_id: &str,
    item_id: Option<&str>,
    event_type: &str,
    from_status: &str,
    to_status: &str,
    actor: &str,
    note: &str,
    metadata: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO laundry_events(tenant_id,branch_id,order_id,item_id,event_type,from_status,to_status,actor_id,note,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(tenant).bind(branch).bind(order_id).bind(item_id).bind(event_type).bind(from_status).bind(to_status).bind(actor).bind(note).bind(metadata).execute(&mut **tx).await?;
    Ok(())
}
