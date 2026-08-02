use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

async fn cleanup(db: &PgPool, tenant: &str) {
    let _ = sqlx::query("DELETE FROM inventory_api_idempotency WHERE tenant_id=$1")
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
    let api_key = format!("api-{suffix}");
    let api_hash = "a".repeat(64);
    let reserve = "INSERT INTO inventory_api_idempotency(tenant_id,branch_id,actor_user_id,idempotency_key,method,request_path,request_hash) VALUES($1,$2,'phase13',$3,'POST','/inventory/adjustments',$4) ON CONFLICT(tenant_id,branch_id,idempotency_key) DO NOTHING";
    let (reserve_a, reserve_b) = tokio::join!(
        sqlx::query(reserve)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&api_key)
            .bind(&api_hash)
            .execute(&db),
        sqlx::query(reserve)
            .bind(&tenant)
            .bind(&branch_a)
            .bind(&api_key)
            .bind(&api_hash)
            .execute(&db),
    );
    let reservations = reserve_a.unwrap().rows_affected() + reserve_b.unwrap().rows_affected();
    sqlx::query("UPDATE inventory_api_idempotency SET status='completed',response_status=201,response_body=$5,completed_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND actor_user_id='phase13' AND idempotency_key=$3 AND request_hash=$4")
        .bind(&tenant).bind(&branch_a).bind(&api_key).bind(&api_hash).bind(br#"{"ok":true}"#.as_slice())
        .execute(&db).await.expect("complete API idempotency record");
    let replay: (i32, Vec<u8>) = sqlx::query_as("SELECT response_status,response_body FROM inventory_api_idempotency WHERE tenant_id=$1 AND branch_id=$2 AND actor_user_id='phase13' AND idempotency_key=$3")
        .bind(&tenant).bind(&branch_a).bind(&api_key).fetch_one(&db).await.expect("replay API result");
    let other_branch = sqlx::query(reserve)
        .bind(&tenant)
        .bind(&branch_b)
        .bind(&api_key)
        .bind(&api_hash)
        .execute(&db)
        .await
        .expect("branch-scoped API reservation")
        .rows_affected();
    let conflicting_actor = sqlx::query("INSERT INTO inventory_api_idempotency(tenant_id,branch_id,actor_user_id,idempotency_key,method,request_path,request_hash) VALUES($1,$2,'another-actor',$3,'POST','/inventory/adjustments',$4) ON CONFLICT(tenant_id,branch_id,idempotency_key) DO NOTHING")
        .bind(&tenant).bind(&branch_a).bind(&api_key).bind(&api_hash)
        .execute(&db).await.expect("cross-actor reservation conflict").rows_affected();

    let rollback_key = format!("rollback-{suffix}");
    let mut rollback = db.begin().await.expect("rollback transaction");
    sqlx::query("INSERT INTO inventory_api_idempotency(tenant_id,branch_id,actor_user_id,idempotency_key,method,request_path,request_hash) VALUES($1,$2,'phase13',$3,'POST','/inventory/adjustments',$4)")
        .bind(&tenant).bind(&branch_a).bind(&rollback_key).bind(&api_hash)
        .execute(&mut *rollback).await.expect("rollback idempotency mutation");
    rollback.rollback().await.expect("rollback mutation");
    let rollback_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inventory_api_idempotency WHERE tenant_id=$1 AND branch_id=$2 AND idempotency_key=$3")
        .bind(&tenant).bind(&branch_a).bind(&rollback_key)
        .fetch_one(&db).await.expect("state after rollback");

    let money_constraint: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='purchase_orders'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%total_paise%' AND pg_get_constraintdef(oid) ILIKE '%taxable_paise%' AND pg_get_constraintdef(oid) ILIKE '%tax_paise%')")
        .fetch_one(&db).await.expect("purchase amount constraint");
    let container_constraint: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='inventory_backbar_containers'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%remaining_quantity%capacity_quantity%')")
        .fetch_one(&db).await.expect("container balance constraint");

    cleanup(&db, &tenant).await;
    assert_eq!(
        reservations, 1,
        "concurrent API key reservation must win once"
    );
    assert_eq!(
        replay,
        (201, br#"{"ok":true}"#.to_vec()),
        "completed response must replay exactly"
    );
    assert_eq!(
        other_branch, 1,
        "the same API key must remain branch scoped"
    );
    assert_eq!(
        conflicting_actor, 0,
        "a second actor must not reuse the branch key"
    );
    assert_eq!(
        rollback_count, 0,
        "failed transactions must not persist state"
    );
    assert_eq!(
        2_i64 * 1_250,
        2_500,
        "quantity times unit cost must equal COGS"
    );
    assert!(
        money_constraint,
        "money/GST total invariant must be enforced by PostgreSQL"
    );
    assert!(
        container_constraint,
        "container stock bounds must be enforced by PostgreSQL"
    );
}
