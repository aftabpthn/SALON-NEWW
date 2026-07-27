use chrono::{DateTime, Datelike, NaiveDate, Utc};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

use super::business_code_repository::{next_branch_code, BusinessCodeKind};
use crate::models::balance_sheet::BalanceSheetReport;

#[derive(Debug, Clone, FromRow)]
pub struct AccountTotalRecord {
    pub account_code: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct LedgerRecord {
    pub journal_entry_id: String,
    pub journal_line_id: String,
    pub business_date: NaiveDate,
    pub source_type: String,
    pub source_id: String,
    pub memo: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
    pub running_debit_paise: i64,
    pub created_by_user_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub cost_center_id: Option<String>,
    pub cost_center_code: Option<String>,
    pub cost_center_name: Option<String>,
    pub cost_center_kind: Option<String>,
    pub total_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ManualJournalRecord {
    pub id: String,
    pub business_date: NaiveDate,
    pub memo: String,
}

#[derive(Debug, Clone, FromRow, PartialEq, Eq, PartialOrd, Ord)]
pub struct ManualJournalLineRecord {
    pub account_code: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct SnapshotRecord {
    pub id: String,
    pub as_of_date: NaiveDate,
    pub payload_json: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct CostCenterRecord {
    pub id: String,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct JournalLineCostCenterRecord {
    pub journal_entry_id: String,
    pub journal_line_id: String,
    pub cost_center_id: String,
    pub cost_center_code: String,
    pub cost_center_name: String,
    pub cost_center_kind: String,
    pub tagged_by_user_id: String,
    pub tagged_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct FixedAssetRecord {
    pub id: String,
    pub asset_code: String,
    pub name: String,
    pub acquisition_date: NaiveDate,
    pub depreciation_start_date: NaiveDate,
    pub cost_paise: i64,
    pub salvage_paise: i64,
    pub useful_life_months: i32,
    pub accumulated_depreciation_paise: i64,
    pub last_depreciation_date: Option<NaiveDate>,
    pub purchase_offset_account: String,
    pub purchase_journal_entry_id: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct DeferredRevenueScheduleRecord {
    pub id: String,
    pub sale_id: String,
    pub sale_line_id: String,
    pub source_type: String,
    pub source_item_id: String,
    pub total_paise: i64,
    pub recognized_paise: i64,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub last_recognition_date: Option<NaiveDate>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct AccountingPeriodRecord {
    pub id: String,
    pub period_month: NaiveDate,
    pub status: String,
    pub close_reason: String,
    pub closed_by_user_id: Option<String>,
    pub closed_at: Option<DateTime<Utc>>,
    pub reopen_reason: String,
    pub reopened_by_user_id: Option<String>,
    pub reopened_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct FinanceReconciliationRecord {
    pub journal_debit_paise: i64,
    pub journal_credit_paise: i64,
    pub customer_credit_source_paise: i64,
    pub customer_credit_ledger_paise: i64,
    pub deferred_source_paise: i64,
    pub deferred_ledger_paise: i64,
    pub fixed_asset_source_paise: i64,
    pub fixed_asset_ledger_paise: i64,
}

pub async fn account_totals(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    as_of_date: NaiveDate,
) -> Result<Vec<AccountTotalRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT line.account_code,
               COALESCE(SUM(line.debit_paise), 0)::BIGINT AS debit_paise,
               COALESCE(SUM(line.credit_paise), 0)::BIGINT AS credit_paise
        FROM accounting_journal_entries entry
        JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
        WHERE entry.tenant_id=$1
          AND entry.branch_id=ANY($2)
          AND entry.entry_date<=$3
        GROUP BY line.account_code
        ORDER BY line.account_code
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(as_of_date)
    .fetch_all(db)
    .await
}

pub async fn ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    account_code: &str,
    from_date: Option<NaiveDate>,
    to_date: NaiveDate,
    limit: i64,
    offset: i64,
) -> Result<Vec<LedgerRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH all_rows AS (
          SELECT entry.id AS journal_entry_id,
                 line.id AS journal_line_id,
                 entry.entry_date AS business_date,
                 entry.source_type,
                 entry.source_id,
                 entry.memo,
                 line.debit_paise,
                 line.credit_paise,
                 entry.created_by_user_id,
                 entry.created_at,
                 tag.cost_center_id,
                 center.code AS cost_center_code,
                 center.name AS cost_center_name,
                 center.kind AS cost_center_kind
          FROM accounting_journal_entries entry
          JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
          LEFT JOIN accounting_journal_line_cost_centers tag
            ON tag.journal_line_id=line.id
           AND tag.tenant_id=entry.tenant_id
           AND tag.branch_id=entry.branch_id
          LEFT JOIN accounting_cost_centers center
            ON center.id=tag.cost_center_id
           AND center.tenant_id=entry.tenant_id
           AND center.branch_id=entry.branch_id
          WHERE entry.tenant_id=$1
            AND entry.branch_id=$2
            AND line.account_code=$3
            AND entry.entry_date<=$4
        ), running AS (
          SELECT all_rows.*,
                 (SUM(debit_paise-credit_paise) OVER (
                   ORDER BY business_date, created_at, journal_entry_id, journal_line_id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ))::BIGINT AS running_debit_paise
          FROM all_rows
        ), filtered AS (
          SELECT * FROM running WHERE $5::DATE IS NULL OR business_date>=$5
        )
        SELECT journal_entry_id, journal_line_id, business_date, source_type, source_id, memo,
               debit_paise, credit_paise, running_debit_paise,
               created_by_user_id, created_at, cost_center_id, cost_center_code,
               cost_center_name, cost_center_kind,
               COUNT(*) OVER()::BIGINT AS total_count
        FROM filtered
        ORDER BY business_date, created_at, journal_entry_id, journal_line_id
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(account_code)
    .bind(to_date)
    .bind(from_date)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
}

pub async fn list_cost_centers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CostCenterRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,code,name,kind,active,created_at,updated_at FROM accounting_cost_centers WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE ORDER BY kind,code",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_cost_center(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    kind: &str,
    created_by_user_id: &str,
) -> Result<CostCenterRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let code =
        next_branch_code(&mut tx, tenant_id, branch_id, BusinessCodeKind::CostCenter).await?;
    let row = sqlx::query_as(
        r#"
        INSERT INTO accounting_cost_centers (
          tenant_id,branch_id,code,name,kind,created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id,code,name,kind,active,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(code)
    .bind(name)
    .bind(kind)
    .bind(created_by_user_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn tag_journal_line(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    journal_line_id: &str,
    cost_center_id: &str,
    tagged_by_user_id: &str,
) -> Result<Option<JournalLineCostCenterRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH target AS (
          SELECT entry.id AS journal_entry_id,line.id AS journal_line_id,center.id AS cost_center_id
          FROM accounting_journal_lines line
          JOIN accounting_journal_entries entry ON entry.id=line.journal_entry_id
          JOIN accounting_cost_centers center
            ON center.id=$4 AND center.tenant_id=$1 AND center.branch_id=$2 AND center.active=TRUE
          WHERE line.id=$3 AND entry.tenant_id=$1 AND entry.branch_id=$2
        ), saved AS (
          INSERT INTO accounting_journal_line_cost_centers (
            tenant_id,branch_id,journal_entry_id,journal_line_id,cost_center_id,tagged_by_user_id
          )
          SELECT $1,$2,journal_entry_id,journal_line_id,cost_center_id,$5 FROM target
          ON CONFLICT (journal_line_id) DO UPDATE
          SET cost_center_id=EXCLUDED.cost_center_id,
              tagged_by_user_id=EXCLUDED.tagged_by_user_id,
              tagged_at=NOW()
          WHERE accounting_journal_line_cost_centers.tenant_id=EXCLUDED.tenant_id
            AND accounting_journal_line_cost_centers.branch_id=EXCLUDED.branch_id
          RETURNING journal_entry_id,journal_line_id,cost_center_id,tagged_by_user_id,tagged_at
        )
        SELECT saved.journal_entry_id,saved.journal_line_id,saved.cost_center_id,
               center.code AS cost_center_code,center.name AS cost_center_name,
               center.kind AS cost_center_kind,saved.tagged_by_user_id,saved.tagged_at
        FROM saved
        JOIN accounting_cost_centers center ON center.id=saved.cost_center_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(journal_line_id)
    .bind(cost_center_id)
    .bind(tagged_by_user_id)
    .fetch_optional(db)
    .await
}

pub async fn manual_journal(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<(ManualJournalRecord, Vec<ManualJournalLineRecord>), sqlx::Error> {
    let entry = sqlx::query_as::<_, ManualJournalRecord>(
        "SELECT id,entry_date AS business_date,memo FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND source_type='manual_journal' AND source_id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(idempotency_key)
    .fetch_one(&mut **tx)
    .await?;
    let lines = sqlx::query_as::<_, ManualJournalLineRecord>(
        "SELECT account_code,debit_paise,credit_paise FROM accounting_journal_lines WHERE journal_entry_id=$1 ORDER BY account_code,debit_paise,credit_paise",
    )
    .bind(&entry.id)
    .fetch_all(&mut **tx)
    .await?;
    Ok((entry, lines))
}

pub async fn create_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    report: &BalanceSheetReport,
    payload_json: &str,
    created_by_user_id: &str,
) -> Result<SnapshotRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO balance_sheet_snapshots (
          tenant_id,branch_id,as_of_date,total_assets_paise,total_liabilities_paise,
          total_equity_paise,accounting_equation_difference_paise,balanced,payload,created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::JSONB,$10)
        ON CONFLICT (tenant_id,branch_id,as_of_date)
        DO UPDATE SET as_of_date=balance_sheet_snapshots.as_of_date
        RETURNING id,as_of_date,payload::TEXT AS payload_json,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(report.as_of_date)
    .bind(report.totals.assets_paise)
    .bind(report.totals.liabilities_paise)
    .bind(report.totals.equity_paise)
    .bind(report.totals.accounting_equation_difference_paise)
    .bind(report.balanced)
    .bind(payload_json)
    .bind(created_by_user_id)
    .fetch_one(db)
    .await
}

pub async fn list_fixed_assets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<FixedAssetRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,asset_code,name,acquisition_date,depreciation_start_date,cost_paise,
               salvage_paise,useful_life_months,accumulated_depreciation_paise,
               last_depreciation_date,purchase_offset_account,purchase_journal_entry_id,
               status,created_at,updated_at
        FROM accounting_fixed_assets
        WHERE tenant_id=$1 AND branch_id=$2
        ORDER BY acquisition_date DESC,asset_code
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn fixed_asset_by_idempotency(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    idempotency_key: &str,
) -> Result<Option<FixedAssetRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,asset_code,name,acquisition_date,depreciation_start_date,cost_paise,
               salvage_paise,useful_life_months,accumulated_depreciation_paise,
               last_depreciation_date,purchase_offset_account,purchase_journal_entry_id,
               status,created_at,updated_at
        FROM accounting_fixed_assets
        WHERE tenant_id=$1 AND branch_id=$2 AND purchase_idempotency_key=$3
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(idempotency_key)
    .fetch_optional(&mut **tx)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_fixed_asset(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    name: &str,
    acquisition_date: NaiveDate,
    depreciation_start_date: NaiveDate,
    cost_paise: i64,
    salvage_paise: i64,
    useful_life_months: i32,
    purchase_offset_account: &str,
    idempotency_key: &str,
    created_by_user_id: &str,
) -> Result<FixedAssetRecord, sqlx::Error> {
    let asset_code =
        next_branch_code(tx, tenant_id, branch_id, BusinessCodeKind::FixedAsset).await?;
    sqlx::query_as(
        r#"
        INSERT INTO accounting_fixed_assets (
          tenant_id,branch_id,asset_code,name,acquisition_date,depreciation_start_date,
          cost_paise,salvage_paise,useful_life_months,purchase_offset_account,
          purchase_idempotency_key,created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id,asset_code,name,acquisition_date,depreciation_start_date,cost_paise,
                  salvage_paise,useful_life_months,accumulated_depreciation_paise,
                  last_depreciation_date,purchase_offset_account,purchase_journal_entry_id,
                  status,created_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(asset_code)
    .bind(name)
    .bind(acquisition_date)
    .bind(depreciation_start_date)
    .bind(cost_paise)
    .bind(salvage_paise)
    .bind(useful_life_months)
    .bind(purchase_offset_account)
    .bind(idempotency_key)
    .bind(created_by_user_id)
    .fetch_one(&mut **tx)
    .await
}

pub async fn set_fixed_asset_purchase_journal(
    tx: &mut Transaction<'_, Postgres>,
    asset_id: &str,
    journal_entry_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE accounting_fixed_assets SET purchase_journal_entry_id=$2,updated_at=NOW() WHERE id=$1",
    )
    .bind(asset_id)
    .bind(journal_entry_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn lock_fixed_asset(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    asset_id: &str,
) -> Result<Option<FixedAssetRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,asset_code,name,acquisition_date,depreciation_start_date,cost_paise,
               salvage_paise,useful_life_months,accumulated_depreciation_paise,
               last_depreciation_date,purchase_offset_account,purchase_journal_entry_id,
               status,created_at,updated_at
        FROM accounting_fixed_assets
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        FOR UPDATE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(asset_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn apply_fixed_asset_depreciation(
    tx: &mut Transaction<'_, Postgres>,
    asset_id: &str,
    amount_paise: i64,
    business_date: NaiveDate,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE accounting_fixed_assets
        SET accumulated_depreciation_paise=accumulated_depreciation_paise+$2,
            last_depreciation_date=$3,updated_at=NOW()
        WHERE id=$1
        "#,
    )
    .bind(asset_id)
    .bind(amount_paise)
    .bind(business_date)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn journal_action(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
    account_code: &str,
) -> Result<Option<(String, NaiveDate, i64)>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT entry.id,entry.entry_date,
               COALESCE(SUM(line.debit_paise+line.credit_paise),0)::BIGINT AS amount_paise
        FROM accounting_journal_entries entry
        JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
        WHERE entry.tenant_id=$1 AND entry.branch_id=$2
          AND entry.source_type=$3 AND entry.source_id=$4 AND line.account_code=$5
        GROUP BY entry.id,entry.entry_date
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(source_type)
    .bind(source_id)
    .bind(account_code)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn list_deferred_revenue_schedules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<DeferredRevenueScheduleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,sale_id,sale_line_id,source_type,source_item_id,total_paise,
               recognized_paise,start_date,end_date,last_recognition_date,status,
               created_at,updated_at
        FROM accounting_deferred_revenue_schedules
        WHERE tenant_id=$1 AND branch_id=$2
        ORDER BY status,start_date,id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn lock_deferred_revenue_schedule(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    schedule_id: &str,
) -> Result<Option<DeferredRevenueScheduleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,sale_id,sale_line_id,source_type,source_item_id,total_paise,
               recognized_paise,start_date,end_date,last_recognition_date,status,
               created_at,updated_at
        FROM accounting_deferred_revenue_schedules
        WHERE tenant_id=$1 AND branch_id=$2 AND id=$3
        FOR UPDATE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(schedule_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn apply_deferred_revenue_recognition(
    tx: &mut Transaction<'_, Postgres>,
    schedule_id: &str,
    amount_paise: i64,
    recognition_date: NaiveDate,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE accounting_deferred_revenue_schedules
        SET recognized_paise=recognized_paise+$2,
            last_recognition_date=$3,
            status=CASE WHEN recognized_paise+$2=total_paise THEN 'complete' ELSE 'open' END,
            updated_at=NOW()
        WHERE id=$1
        "#,
    )
    .bind(schedule_id)
    .bind(amount_paise)
    .bind(recognition_date)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn list_accounting_periods(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AccountingPeriodRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,period_month,status,close_reason,closed_by_user_id,closed_at,
               reopen_reason,reopened_by_user_id,reopened_at,updated_at
        FROM accounting_periods
        WHERE tenant_id=$1 AND branch_id=$2
        ORDER BY period_month DESC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn lock_accounting_period(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
) -> Result<(), sqlx::Error> {
    let period_key = period_month.year() * 100 + period_month.month() as i32;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2),$3)")
        .bind(tenant_id)
        .bind(branch_id)
        .bind(period_key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn close_accounting_period(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
    reason: &str,
    user_id: &str,
) -> Result<AccountingPeriodRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO accounting_periods (
          tenant_id,branch_id,period_month,status,close_reason,closed_by_user_id,closed_at
        ) VALUES ($1,$2,$3,'closed',$4,$5,NOW())
        ON CONFLICT (tenant_id,branch_id,period_month) DO UPDATE
        SET status='closed',close_reason=EXCLUDED.close_reason,
            closed_by_user_id=EXCLUDED.closed_by_user_id,closed_at=NOW(),updated_at=NOW()
        RETURNING id,period_month,status,close_reason,closed_by_user_id,closed_at,
                  reopen_reason,reopened_by_user_id,reopened_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .bind(reason)
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await
}

pub async fn reopen_accounting_period(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
    reason: &str,
    user_id: &str,
) -> Result<Option<AccountingPeriodRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE accounting_periods
        SET status='open',reopen_reason=$4,reopened_by_user_id=$5,
            reopened_at=NOW(),updated_at=NOW()
        WHERE tenant_id=$1 AND branch_id=$2 AND period_month=$3 AND status='closed'
        RETURNING id,period_month,status,close_reason,closed_by_user_id,closed_at,
                  reopen_reason,reopened_by_user_id,reopened_at,updated_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .bind(reason)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn accounting_period_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    period_month: NaiveDate,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT COALESCE((SELECT status FROM accounting_periods WHERE tenant_id=$1 AND branch_id=$2 AND period_month=$3),'open')",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(period_month)
    .fetch_one(db)
    .await
}

pub async fn finance_reconciliation(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of_date: NaiveDate,
) -> Result<FinanceReconciliationRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH journal AS (
          SELECT COALESCE(SUM(line.debit_paise),0)::BIGINT AS debit_paise,
                 COALESCE(SUM(line.credit_paise),0)::BIGINT AS credit_paise,
                 COALESCE(SUM(line.credit_paise-line.debit_paise)
                   FILTER (WHERE line.account_code='CUSTOMER_CREDIT_LIABILITY'),0)::BIGINT
                   AS customer_credit_paise,
                 COALESCE(SUM(line.credit_paise-line.debit_paise)
                   FILTER (WHERE line.account_code='DEFERRED_REVENUE'),0)::BIGINT
                   AS deferred_paise,
                 COALESCE(SUM(line.debit_paise-line.credit_paise)
                   FILTER (WHERE line.account_code IN ('FIXED_ASSETS','ACCUMULATED_DEPRECIATION')),0)::BIGINT
                   AS fixed_asset_paise
          FROM accounting_journal_entries entry
          JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
          WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.entry_date<=$3
        ), source AS (
          SELECT
            COALESCE((SELECT SUM(delta_paise)::BIGINT FROM wallet_transactions
              WHERE tenant_id=$1 AND branch_id=$2 AND created_at<(($3::DATE+1)::TIMESTAMP)),0)
            + COALESCE((SELECT SUM(delta_paise)::BIGINT FROM store_credit_transactions
              WHERE tenant_id=$1 AND branch_id=$2 AND created_at<(($3::DATE+1)::TIMESTAMP)),0)
              AS customer_credit_paise,
            COALESCE((SELECT SUM(total_paise)::BIGINT
              FROM accounting_deferred_revenue_schedules
              WHERE tenant_id=$1 AND branch_id=$2 AND start_date<=$3),0)
            - COALESCE((SELECT SUM(line.debit_paise)::BIGINT
              FROM accounting_journal_entries entry
              JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
              WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.entry_date<=$3
                AND entry.source_type='deferred_revenue_recognition'
                AND line.account_code='DEFERRED_REVENUE'),0) AS deferred_paise,
            COALESCE((SELECT SUM(cost_paise)::BIGINT
              FROM accounting_fixed_assets
              WHERE tenant_id=$1 AND branch_id=$2 AND acquisition_date<=$3),0)
            - COALESCE((SELECT SUM(line.credit_paise)::BIGINT
              FROM accounting_journal_entries entry
              JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
              WHERE entry.tenant_id=$1 AND entry.branch_id=$2 AND entry.entry_date<=$3
                AND entry.source_type='fixed_asset_depreciation'
                AND line.account_code='ACCUMULATED_DEPRECIATION'),0) AS fixed_asset_paise
        )
        SELECT journal.debit_paise AS journal_debit_paise,
               journal.credit_paise AS journal_credit_paise,
               source.customer_credit_paise AS customer_credit_source_paise,
               journal.customer_credit_paise AS customer_credit_ledger_paise,
               source.deferred_paise AS deferred_source_paise,
               journal.deferred_paise AS deferred_ledger_paise,
               source.fixed_asset_paise AS fixed_asset_source_paise,
               journal.fixed_asset_paise AS fixed_asset_ledger_paise
        FROM journal CROSS JOIN source
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(as_of_date)
    .fetch_one(db)
    .await
}
