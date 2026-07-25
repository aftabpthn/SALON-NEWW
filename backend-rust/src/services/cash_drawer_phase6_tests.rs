use super::{
    ensure_business_day_unlocked, expected_cash, record_invoice_cash_refund,
    resolve_open_movement_till_id,
};
use crate::{repositories::cash_drawer_repository, services::accounting_service};
use chrono::NaiveDate;
use sqlx::PgPool;

async fn create_schema(pool: &PgPool) {
    sqlx::raw_sql(
        r#"
        CREATE TABLE pos_day_locks(
          tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, business_date DATE NOT NULL,
          status TEXT NOT NULL, PRIMARY KEY(tenant_id,branch_id,business_date)
        );
        CREATE TABLE cash_drawer_sessions(
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
          tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, opened_by_user_id TEXT NOT NULL DEFAULT '',
          closed_by_user_id TEXT NOT NULL DEFAULT '', business_date DATE NOT NULL,
          opening_cash_paise BIGINT NOT NULL DEFAULT 0, expected_cash_paise BIGINT NOT NULL DEFAULT 0,
          counted_cash_paise BIGINT, variance_paise BIGINT, status TEXT NOT NULL DEFAULT 'open',
          notes TEXT NOT NULL DEFAULT '', opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
          close_requested_by_user_id TEXT NOT NULL DEFAULT '', close_requested_at TIMESTAMPTZ,
          approved_by_user_id TEXT NOT NULL DEFAULT '', approved_at TIMESTAMPTZ,
          approval_note TEXT NOT NULL DEFAULT '', denomination_breakdown_json JSONB NOT NULL DEFAULT '{}',
          handover_to_staff_id TEXT NOT NULL DEFAULT '', handover_by_user_id TEXT NOT NULL DEFAULT '',
          handover_note TEXT NOT NULL DEFAULT '', handover_at TIMESTAMPTZ
        );
        CREATE UNIQUE INDEX uq_cash_drawer_active_session
          ON cash_drawer_sessions(tenant_id,branch_id,business_date)
          WHERE status IN ('open','pending_approval');
        CREATE TABLE cash_drawer_tills(
          id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
          drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id),
          till_code TEXT NOT NULL, till_name TEXT NOT NULL, opening_cash_paise BIGINT NOT NULL DEFAULT 0,
          expected_cash_paise BIGINT NOT NULL DEFAULT 0, counted_cash_paise BIGINT, variance_paise BIGINT,
          status TEXT NOT NULL DEFAULT 'open', opened_by_user_id TEXT NOT NULL DEFAULT '',
          close_requested_by_user_id TEXT NOT NULL DEFAULT '', approved_by_user_id TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '', opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          close_requested_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
        );
        CREATE TABLE cash_drawer_movements(
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
          tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
          drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id),
          cash_drawer_till_id TEXT REFERENCES cash_drawer_tills(id), movement_type TEXT NOT NULL,
          amount_paise BIGINT NOT NULL, reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '',
          actor_user_id TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
          reverses_movement_id TEXT REFERENCES cash_drawer_movements(id), correction_reason TEXT NOT NULL DEFAULT '',
          idempotency_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX uq_cash_drawer_movement_idempotency
          ON cash_drawer_movements(tenant_id,branch_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE UNIQUE INDEX uq_cash_drawer_invoice_refund_movement
          ON cash_drawer_movements(tenant_id,branch_id,reference_type,reference_id)
          WHERE movement_type='refund_cash' AND reference_type='invoice_refund';
        CREATE TABLE cash_drawer_audit_events(
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
          drawer_session_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, event_type TEXT NOT NULL,
          payload_json JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE accounting_journal_entries(
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
          source_type TEXT NOT NULL, source_id TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '',
          entry_date DATE NOT NULL, created_by_user_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(tenant_id,branch_id,source_type,source_id)
        );
        CREATE TABLE accounting_journal_lines(
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
          journal_entry_id TEXT NOT NULL REFERENCES accounting_journal_entries(id) ON DELETE CASCADE,
          account_code TEXT NOT NULL, debit_paise BIGINT NOT NULL DEFAULT 0, credit_paise BIGINT NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(pool)
    .await
    .expect("cash drawer test schema");
}

#[sqlx::test(migrations = false)]
async fn cash_drawer_financial_integrations_are_scoped_and_idempotent(pool: PgPool) {
    create_schema(&pool).await;
    let date = NaiveDate::from_ymd_opt(2026, 7, 22).unwrap();

    let mut first = pool.begin().await.unwrap();
    cash_drawer_repository::lock_business_date(&mut first, "tenant-a", "branch-a", date)
        .await
        .unwrap();
    let session = cash_drawer_repository::open(
        &mut first,
        "tenant-a",
        "branch-a",
        "cashier-a",
        date,
        1_000,
        "open",
    )
    .await
    .unwrap()
    .expect("first session");
    first.commit().await.unwrap();
    let mut duplicate = pool.begin().await.unwrap();
    cash_drawer_repository::lock_business_date(&mut duplicate, "tenant-a", "branch-a", date)
        .await
        .unwrap();
    assert!(cash_drawer_repository::open(
        &mut duplicate,
        "tenant-a",
        "branch-a",
        "cashier-a",
        date,
        1_000,
        "retry"
    )
    .await
    .unwrap()
    .is_none());
    duplicate.rollback().await.unwrap();

    sqlx::query("INSERT INTO pos_day_locks VALUES('tenant-a','locked-branch',$1,'locked')")
        .bind(date)
        .execute(&pool)
        .await
        .unwrap();
    let mut locked = pool.begin().await.unwrap();
    assert!(
        ensure_business_day_unlocked(&mut locked, "tenant-a", "locked-branch", date)
            .await
            .is_err()
    );
    locked.rollback().await.unwrap();

    sqlx::query("INSERT INTO cash_drawer_tills(id,tenant_id,branch_id,drawer_session_id,till_code,till_name,opening_cash_paise,expected_cash_paise) VALUES('till-a','tenant-a','branch-a',$1,'A','Till A',1000,1000),('till-b','tenant-a','branch-a',$1,'B','Till B',500,500)")
        .bind(&session.id).execute(&pool).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(
        resolve_open_movement_till_id(&mut tx, "tenant-a", "branch-a", date, &session.id, "")
            .await
            .is_err()
    );
    assert_eq!(
        resolve_open_movement_till_id(&mut tx, "tenant-a", "branch-a", date, &session.id, "till-a")
            .await
            .unwrap()
            .as_deref(),
        Some("till-a")
    );
    assert!(cash_drawer_repository::insert_movement(
        &mut tx,
        "tenant-a",
        "branch-a",
        &session.id,
        Some("till-a"),
        "cash_in",
        500,
        "manual",
        "in-1",
        "cashier-a",
        "float",
        Some("phase6-key-001")
    )
    .await
    .unwrap());
    assert!(!cash_drawer_repository::insert_movement(
        &mut tx,
        "tenant-a",
        "branch-a",
        &session.id,
        Some("till-a"),
        "cash_in",
        500,
        "manual",
        "in-1",
        "cashier-a",
        "float",
        Some("phase6-key-001")
    )
    .await
    .unwrap());
    assert!(cash_drawer_repository::insert_movement(
        &mut tx,
        "tenant-a",
        "branch-a",
        &session.id,
        Some("till-b"),
        "cash_out",
        -200,
        "manual",
        "out-1",
        "cashier-a",
        "petty cash",
        Some("phase6-key-002")
    )
    .await
    .unwrap());
    assert_eq!(
        cash_drawer_repository::till_movement_delta(&mut tx, "tenant-a", "branch-a", "till-a")
            .await
            .unwrap(),
        500
    );
    assert_eq!(
        cash_drawer_repository::till_movement_delta(&mut tx, "tenant-a", "branch-a", "till-b")
            .await
            .unwrap(),
        -200
    );
    assert_eq!(expected_cash(1_000, 0, 500), 1_500);
    tx.commit().await.unwrap();

    let mut other = pool.begin().await.unwrap();
    cash_drawer_repository::lock_business_date(&mut other, "tenant-a", "branch-b", date)
        .await
        .unwrap();
    let other_session = cash_drawer_repository::open(
        &mut other,
        "tenant-a",
        "branch-b",
        "cashier-b",
        date,
        0,
        "open",
    )
    .await
    .unwrap()
    .expect("other branch session");
    other.commit().await.unwrap();
    sqlx::query("INSERT INTO cash_drawer_tills(id,tenant_id,branch_id,drawer_session_id,till_code,till_name) VALUES('till-c','tenant-a','branch-b',$1,'C','Till C')")
        .bind(&other_session.id).execute(&pool).await.unwrap();
    let mut refund = pool.begin().await.unwrap();
    record_invoice_cash_refund(
        &mut refund,
        "tenant-a",
        "branch-b",
        "cashier-b",
        date,
        "refund-1",
        700,
        "till-c",
    )
    .await
    .unwrap();
    refund.commit().await.unwrap();
    let refund_row: (i64, String) = sqlx::query_as("SELECT amount_paise,cash_drawer_till_id FROM cash_drawer_movements WHERE tenant_id='tenant-a' AND branch_id='branch-b' AND reference_id='refund-1'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(refund_row, (-700, "till-c".into()));
    assert!(cash_drawer_repository::list_movements(
        &pool,
        "tenant-b",
        "branch-b",
        &other_session.id
    )
    .await
    .unwrap()
    .is_empty());

    let mut journal = pool.begin().await.unwrap();
    assert!(accounting_service::post_cash_bank_deposit(
        &mut journal,
        "tenant-a",
        "branch-b",
        "deposit-1",
        date,
        "manager-b",
        2_500
    )
    .await
    .unwrap()
    .is_some());
    assert!(accounting_service::post_cash_bank_deposit(
        &mut journal,
        "tenant-a",
        "branch-b",
        "deposit-1",
        date,
        "manager-b",
        2_500
    )
    .await
    .unwrap()
    .is_none());
    journal.commit().await.unwrap();
    let lines: Vec<(String, i64, i64)> = sqlx::query_as("SELECT line.account_code,line.debit_paise,line.credit_paise FROM accounting_journal_lines line JOIN accounting_journal_entries entry ON entry.id=line.journal_entry_id WHERE entry.source_type='cash_drawer_bank_deposit' AND entry.source_id='deposit-1' ORDER BY line.account_code")
        .fetch_all(&pool).await.unwrap();
    assert_eq!(
        lines,
        vec![
            ("BANK_CLEARING".into(), 2_500, 0),
            ("CASH_ON_HAND".into(), 0, 2_500)
        ]
    );
}
