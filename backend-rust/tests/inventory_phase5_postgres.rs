use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

async fn cleanup(db: &PgPool, tenant: &str) {
    let _ = sqlx::query("DELETE FROM supplier_communication_queue WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
    let _ = sqlx::query("DELETE FROM inventory_backbar_container_events WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
    let _ = sqlx::query("DELETE FROM inventory_backbar_containers WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
    let _ = sqlx::query("DELETE FROM purchase_orders WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
    let _ = sqlx::query("DELETE FROM inventory_policies WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
    let _ = sqlx::query("DELETE FROM suppliers WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
    let _ = sqlx::query("DELETE FROM inventory_items WHERE tenant_id=$1")
        .bind(tenant)
        .execute(db)
        .await;
}

#[tokio::test]
async fn inventory_repository_isolation_idempotency_concurrency_and_invariants() {
    dotenvy::dotenv().ok();
    let url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL is required for PostgreSQL integration tests");
    let db = PgPoolOptions::new()
        .max_connections(8)
        .connect(&url)
        .await
        .expect("PostgreSQL must be available");
    let suffix = Uuid::new_v4().simple().to_string();
    let tenant = format!("phase5-{suffix}");
    let branch_a = format!("branch-a-{suffix}");
    let branch_b = format!("branch-b-{suffix}");
    let supplier_a = format!("supplier-a-{suffix}");
    let supplier_b = format!("supplier-b-{suffix}");
    let item_a = format!("item-a-{suffix}");
    let item_b = format!("item-b-{suffix}");

    sqlx::query("INSERT INTO suppliers(id,tenant_id,branch_id,code,name) VALUES($1,$2,$3,$4,'Phase 5 Supplier A'),($5,$2,$6,$7,'Phase 5 Supplier B')")
        .bind(&supplier_a).bind(&tenant).bind(&branch_a).bind(format!("A-{suffix}"))
        .bind(&supplier_b).bind(&branch_b).bind(format!("B-{suffix}"))
        .execute(&db).await.expect("supplier fixtures");
    sqlx::query("INSERT INTO inventory_items(id,tenant_id,branch_id,sku,name,stock_quantity,unit_cost_paise) VALUES($1,$2,$3,$4,'Phase 5 Item A',1,1250),($5,$2,$6,$7,'Phase 5 Item B',3,2500)")
        .bind(&item_a).bind(&tenant).bind(&branch_a).bind(format!("A-{suffix}"))
        .bind(&item_b).bind(&branch_b).bind(format!("B-{suffix}"))
        .execute(&db).await.expect("inventory fixtures");

    let insert = "INSERT INTO supplier_communication_queue(tenant_id,branch_id,supplier_id,channel,destination,message,idempotency_key,created_by) VALUES($1,$2,$3,'email','supplier@example.invalid','verify',$4,'phase5') ON CONFLICT(tenant_id,branch_id,idempotency_key) DO NOTHING";
    let key = format!("key-{suffix}");
    let (first, second) = tokio::join!(
        sqlx::query(insert)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&supplier_a)
            .bind(&key)
            .execute(&db),
        sqlx::query(insert)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&supplier_a)
            .bind(&key)
            .execute(&db),
    );
    first.expect("first idempotent write");
    second.expect("second idempotent write");
    let branch_a_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM supplier_communication_queue WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant)
    .bind(&branch_a)
    .fetch_one(&db)
    .await
    .unwrap();
    let branch_b_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM supplier_communication_queue WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(&tenant)
    .bind(&branch_b)
    .fetch_one(&db)
    .await
    .unwrap();

    let claim = "WITH due AS (SELECT id FROM supplier_communication_queue WHERE tenant_id=$1 AND status='queued' FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE supplier_communication_queue q SET status='processing',attempts=q.attempts+1,processing_started_at=NOW(),updated_at=NOW() FROM due WHERE q.id=due.id RETURNING q.id";
    let (claim_a, claim_b) = tokio::join!(
        sqlx::query_scalar::<_, String>(claim)
            .bind(&tenant)
            .fetch_optional(&db),
        sqlx::query_scalar::<_, String>(claim)
            .bind(&tenant)
            .fetch_optional(&db),
    );
    let claims = [claim_a.unwrap(), claim_b.unwrap()]
        .into_iter()
        .flatten()
        .count();

    let decrement = "UPDATE inventory_items SET stock_quantity=stock_quantity-1 WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND stock_quantity>0";
    let (dec_a, dec_b) = tokio::join!(
        sqlx::query(decrement)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&item_a)
            .execute(&db),
        sqlx::query(decrement)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&item_a)
            .execute(&db),
    );
    let decrements = dec_a.unwrap().rows_affected() + dec_b.unwrap().rows_affected();
    let final_stock: i32 =
        sqlx::query_scalar("SELECT stock_quantity FROM inventory_items WHERE id=$1")
            .bind(&item_a)
            .fetch_one(&db)
            .await
            .unwrap();

    let invalid_money = sqlx::query("INSERT INTO purchase_orders(tenant_id,branch_id,order_number,supplier_id,taxable_paise,tax_paise,total_paise,created_by) VALUES($1,$2,$3,$4,10000,1800,10000,'phase5')")
        .bind(&tenant).bind(&branch_a).bind(format!("PO-{suffix}")).bind(&supplier_a).execute(&db).await;
    let invalid_stock = sqlx::query("INSERT INTO inventory_backbar_containers(tenant_id,branch_id,inventory_item_id,barcode,capacity_quantity,remaining_quantity,unit,created_by) VALUES($1,$2,$3,$4,10,11,'ml','phase5')")
        .bind(&tenant).bind(&branch_a).bind(&item_a).bind(format!("BAR-{suffix}")).execute(&db).await;

    cleanup(&db, &tenant).await;
    assert_eq!(branch_a_count, 1, "idempotency key must create one row");
    assert_eq!(branch_b_count, 0, "branch-scoped reads must not leak data");
    assert_eq!(
        claims, 1,
        "concurrent workers must claim a job exactly once"
    );
    assert_eq!(decrements, 1, "concurrent stock decrement must post once");
    assert_eq!(final_stock, 0, "stock must never cross below zero");
    assert!(
        invalid_money.is_err(),
        "money/GST total invariant must be enforced by PostgreSQL"
    );
    assert!(
        invalid_stock.is_err(),
        "container stock bounds must be enforced by PostgreSQL"
    );
}
