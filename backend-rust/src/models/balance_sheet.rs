use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountGroup {
    Asset,
    Liability,
    Equity,
    Revenue,
    Expense,
    Unclassified,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NormalBalance {
    Debit,
    Credit,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDefinition {
    pub code: String,
    pub name: String,
    pub group: AccountGroup,
    pub normal_balance: NormalBalance,
    pub current: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountBalance {
    pub code: String,
    pub name: String,
    pub group: AccountGroup,
    pub balance_paise: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSheetSections {
    pub assets: Vec<AccountBalance>,
    pub liabilities: Vec<AccountBalance>,
    pub equity: Vec<AccountBalance>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSheetTotals {
    pub assets_paise: i64,
    pub liabilities_paise: i64,
    pub equity_paise: i64,
    pub accounting_equation_difference_paise: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceSheetReport {
    pub as_of_date: NaiveDate,
    pub branch_id: String,
    pub balanced: bool,
    pub totals: BalanceSheetTotals,
    pub sections: BalanceSheetSections,
    pub unclassified_accounts: Vec<AccountBalance>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingCapitalReport {
    pub as_of_date: NaiveDate,
    pub branch_id: String,
    pub current_assets_paise: i64,
    pub current_liabilities_paise: i64,
    pub working_capital_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub journal_entry_id: String,
    pub journal_line_id: String,
    pub business_date: NaiveDate,
    pub source_type: String,
    pub source_id: String,
    pub memo: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
    pub running_balance_paise: i64,
    pub created_by_user_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub cost_center_id: Option<String>,
    pub cost_center_code: Option<String>,
    pub cost_center_name: Option<String>,
    pub cost_center_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerPage {
    pub account: AccountDefinition,
    pub from_date: Option<NaiveDate>,
    pub to_date: NaiveDate,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
    pub rows: Vec<LedgerEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsOfQuery {
    pub as_of_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerQuery {
    pub account_code: String,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub as_of_date: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualJournalLineRequest {
    pub account_code: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualJournalRequest {
    pub business_date: Option<String>,
    pub entry_date: Option<String>,
    pub idempotency_key: String,
    pub memo: Option<String>,
    pub lines: Vec<ManualJournalLineRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualJournalResponse {
    pub id: String,
    pub business_date: NaiveDate,
    pub created: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CostCenterCreateRequest {
    pub code: String,
    pub name: String,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostCenterResponse {
    pub id: String,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalLineCostCenterRequest {
    pub cost_center_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalLineCostCenterResponse {
    pub journal_entry_id: String,
    pub journal_line_id: String,
    pub cost_center_id: String,
    pub cost_center_code: String,
    pub cost_center_name: String,
    pub cost_center_kind: String,
    pub tagged_by_user_id: String,
    pub tagged_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotRequest {
    pub as_of_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResponse {
    pub id: String,
    pub as_of_date: NaiveDate,
    pub created_at: DateTime<Utc>,
    pub report: BalanceSheetReport,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixedAssetCreateRequest {
    pub asset_code: String,
    pub name: String,
    pub acquisition_date: String,
    pub depreciation_start_date: Option<String>,
    pub cost_paise: i64,
    pub salvage_paise: Option<i64>,
    pub useful_life_months: i32,
    pub purchase_offset_account: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedAssetResponse {
    pub id: String,
    pub asset_code: String,
    pub name: String,
    pub acquisition_date: NaiveDate,
    pub depreciation_start_date: NaiveDate,
    pub cost_paise: i64,
    pub salvage_paise: i64,
    pub useful_life_months: i32,
    pub accumulated_depreciation_paise: i64,
    pub net_book_value_paise: i64,
    pub last_depreciation_date: Option<NaiveDate>,
    pub purchase_offset_account: String,
    pub purchase_journal_entry_id: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DepreciationRequest {
    pub period_month: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountingActionResponse {
    pub journal_entry_id: String,
    pub business_date: NaiveDate,
    pub amount_paise: i64,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeferredRevenueScheduleResponse {
    pub id: String,
    pub sale_id: String,
    pub sale_line_id: String,
    pub source_type: String,
    pub source_item_id: String,
    pub total_paise: i64,
    pub recognized_paise: i64,
    pub remaining_paise: i64,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub last_recognition_date: Option<NaiveDate>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeferredRecognitionRequest {
    pub recognition_date: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeriodCloseRequest {
    pub period_month: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeriodReopenRequest {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountingPeriodResponse {
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationCheck {
    pub key: String,
    pub status: String,
    pub source_balance_paise: i64,
    pub ledger_balance_paise: i64,
    pub variance_paise: i64,
    pub detail_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceHardeningStatus {
    pub as_of_date: NaiveDate,
    pub branch_id: String,
    pub status: String,
    pub accounting_period_status: String,
    pub balance_sheet_balanced: bool,
    pub critical_count: i64,
    pub warning_count: i64,
    pub checks: Vec<ReconciliationCheck>,
}
