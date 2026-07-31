use chrono::{Datelike, Duration, FixedOffset, Months, NaiveDate, Utc};
use sqlx::PgPool;

use crate::{
    models::{
        balance_sheet::{
            AccountBalance, AccountDefinition, AccountGroup, AccountingActionResponse,
            AccountingPeriodResponse, BalanceSheetReport, BalanceSheetSections, BalanceSheetTotals,
            CostCenterCreateRequest, CostCenterResponse, DeferredRecognitionRequest,
            DeferredRevenueScheduleResponse, DepreciationRequest, FinanceHardeningStatus,
            FixedAssetCreateRequest, FixedAssetResponse, JournalLineCostCenterRequest,
            JournalLineCostCenterResponse, LedgerEntry, LedgerPage, LedgerQuery,
            ManualJournalLineRequest, ManualJournalRequest, ManualJournalResponse, NormalBalance,
            PeriodCloseRequest, PeriodReopenRequest, ReconciliationCheck, SnapshotResponse,
            WorkingCapitalReport,
        },
        common::AppError,
    },
    repositories::{
        analytics_repository,
        balance_sheet_repository::{self, AccountTotalRecord, ManualJournalLineRecord},
        inventory_repository,
    },
    services::accounting_service::{self, ManualJournalLine},
};

#[derive(Clone, Copy)]
struct AccountMeta {
    code: &'static str,
    name: &'static str,
    group: AccountGroup,
    current: bool,
}

const ACCOUNTS: &[AccountMeta] = &[
    AccountMeta {
        code: "CASH_ON_HAND",
        name: "Cash on Hand",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "BANK_CLEARING",
        name: "Bank Clearing",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "ACCOUNTS_RECEIVABLE",
        name: "Accounts Receivable",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "INVENTORY_ASSET",
        name: "Inventory",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "INPUT_CGST",
        name: "Input CGST",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "INPUT_SGST",
        name: "Input SGST",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "INPUT_IGST",
        name: "Input IGST",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "REFUND_CLEARING",
        name: "Refund Clearing",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "PREPAID_EXPENSES",
        name: "Prepaid Expenses",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "STAFF_ADVANCE_ASSET",
        name: "Staff Advance",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "SUPPLIER_ADVANCE_ASSET",
        name: "Supplier Advance",
        group: AccountGroup::Asset,
        current: true,
    },
    AccountMeta {
        code: "FIXED_ASSETS",
        name: "Fixed Assets",
        group: AccountGroup::Asset,
        current: false,
    },
    AccountMeta {
        code: "ACCUMULATED_DEPRECIATION",
        name: "Accumulated Depreciation",
        group: AccountGroup::Asset,
        current: false,
    },
    AccountMeta {
        code: "ACCOUNTS_PAYABLE",
        name: "Accounts Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "CGST_PAYABLE",
        name: "CGST Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "SGST_PAYABLE",
        name: "SGST Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "IGST_PAYABLE",
        name: "IGST Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "GST_PAYABLE",
        name: "GST Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "TIPS_PAYABLE",
        name: "Tips Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "CUSTOMER_CREDIT_LIABILITY",
        name: "Customer Credit Liability",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "DEFERRED_REVENUE",
        name: "Deferred Revenue",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "PAYROLL_DEDUCTIONS_PAYABLE",
        name: "Payroll Deductions Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "PAYROLL_STATUTORY_PAYABLE",
        name: "Payroll Statutory Payable",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "ACCRUED_EXPENSES",
        name: "Accrued Expenses",
        group: AccountGroup::Liability,
        current: true,
    },
    AccountMeta {
        code: "LOANS_PAYABLE",
        name: "Loans Payable",
        group: AccountGroup::Liability,
        current: false,
    },
    AccountMeta {
        code: "OWNER_EQUITY",
        name: "Owner's Equity",
        group: AccountGroup::Equity,
        current: false,
    },
    AccountMeta {
        code: "RETAINED_EARNINGS",
        name: "Retained Earnings",
        group: AccountGroup::Equity,
        current: false,
    },
    AccountMeta {
        code: "SALES_REVENUE",
        name: "Sales Revenue",
        group: AccountGroup::Revenue,
        current: false,
    },
    AccountMeta {
        code: "ROUNDING_INCOME",
        name: "Rounding Income",
        group: AccountGroup::Revenue,
        current: false,
    },
    AccountMeta {
        code: "OTHER_INCOME",
        name: "Other Income",
        group: AccountGroup::Revenue,
        current: false,
    },
    AccountMeta {
        code: "SALES_RETURNS",
        name: "Sales Returns",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "COST_OF_GOODS_SOLD",
        name: "Cost of Goods Sold",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "PAYROLL_EXPENSE",
        name: "Payroll Expense",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "PAYROLL_STATUTORY_EXPENSE",
        name: "Payroll Statutory Expense",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "STAFF_ADVANCE_WRITEOFF_EXPENSE",
        name: "Staff Advance Write-off",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "ROUNDING_EXPENSE",
        name: "Rounding Expense",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "OPERATING_EXPENSE",
        name: "Operating Expense",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "RENT_EXPENSE",
        name: "Rent Expense",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "UTILITIES_EXPENSE",
        name: "Utilities Expense",
        group: AccountGroup::Expense,
        current: false,
    },
    AccountMeta {
        code: "DEPRECIATION_EXPENSE",
        name: "Depreciation Expense",
        group: AccountGroup::Expense,
        current: false,
    },
];

pub fn accounts() -> Vec<AccountDefinition> {
    ACCOUNTS
        .iter()
        .map(|account| definition(*account))
        .collect()
}

pub async fn list_cost_centers(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CostCenterResponse>, AppError> {
    balance_sheet_repository::list_cost_centers(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(cost_center_response).collect())
        .map_err(|_| AppError::internal("failed to load cost centers"))
}

pub async fn create_cost_center(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    created_by_user_id: &str,
    payload: CostCenterCreateRequest,
) -> Result<CostCenterResponse, AppError> {
    let name = payload.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::validation(
            "cost center name must contain 1 to 100 characters",
        ));
    }
    let kind = normalize_cost_center_kind(payload.kind.as_deref())?;
    balance_sheet_repository::create_cost_center(
        db,
        tenant_id,
        branch_id,
        name,
        kind,
        created_by_user_id,
    )
    .await
    .map(cost_center_response)
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|value| value.is_unique_violation())
        {
            AppError::conflict("cost center code already exists")
        } else {
            AppError::internal("failed to create cost center")
        }
    })
}

pub async fn tag_journal_line(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    journal_line_id: &str,
    tagged_by_user_id: &str,
    payload: JournalLineCostCenterRequest,
) -> Result<JournalLineCostCenterResponse, AppError> {
    let journal_line_id = journal_line_id.trim();
    let cost_center_id = payload.cost_center_id.trim();
    if journal_line_id.is_empty()
        || journal_line_id.len() > 128
        || cost_center_id.is_empty()
        || cost_center_id.len() > 128
    {
        return Err(AppError::validation(
            "journalLineId and costCenterId are required",
        ));
    }
    let row = balance_sheet_repository::tag_journal_line(
        db,
        tenant_id,
        branch_id,
        journal_line_id,
        cost_center_id,
        tagged_by_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to tag journal line"))?
    .ok_or_else(|| AppError::not_found("journal line or active cost center not found"))?;
    Ok(JournalLineCostCenterResponse {
        journal_entry_id: row.journal_entry_id,
        journal_line_id: row.journal_line_id,
        cost_center_id: row.cost_center_id,
        cost_center_code: row.cost_center_code,
        cost_center_name: row.cost_center_name,
        cost_center_kind: row.cost_center_kind,
        tagged_by_user_id: row.tagged_by_user_id,
        tagged_at: row.tagged_at,
    })
}

pub async fn live(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of_date: Option<&str>,
) -> Result<BalanceSheetReport, AppError> {
    live_for_branches(db, tenant_id, &[branch_id.to_string()], as_of_date).await
}

pub async fn live_for_branches(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    as_of_date: Option<&str>,
) -> Result<BalanceSheetReport, AppError> {
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    let as_of_date = parse_date(as_of_date, "asOfDate")?.unwrap_or_else(today_ist);
    let rows = balance_sheet_repository::account_totals(db, tenant_id, branch_ids, as_of_date)
        .await
        .map_err(|_| AppError::internal("failed to load accounting balances"))?;
    let scope_id = if branch_ids.len() == 1 {
        &branch_ids[0]
    } else {
        "consolidated"
    };
    build_report(scope_id, branch_ids.len(), as_of_date, &rows)
}

pub async fn working_capital(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of_date: Option<&str>,
) -> Result<WorkingCapitalReport, AppError> {
    working_capital_for_branches(db, tenant_id, &[branch_id.to_string()], as_of_date).await
}

pub async fn working_capital_for_branches(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    as_of_date: Option<&str>,
) -> Result<WorkingCapitalReport, AppError> {
    if branch_ids.is_empty() {
        return Err(AppError::forbidden("no authorized branches are available"));
    }
    let as_of_date = parse_date(as_of_date, "asOfDate")?.unwrap_or_else(today_ist);
    let rows = balance_sheet_repository::account_totals(db, tenant_id, branch_ids, as_of_date)
        .await
        .map_err(|_| AppError::internal("failed to load working capital balances"))?;
    let mut current_assets = 0_i64;
    let mut current_liabilities = 0_i64;
    for row in rows {
        let Some(account) = account_meta(&row.account_code).filter(|account| account.current)
        else {
            continue;
        };
        let balance = account_balance(account.group, row.debit_paise, row.credit_paise)?;
        match account.group {
            AccountGroup::Asset => current_assets = add_money(current_assets, balance)?,
            AccountGroup::Liability => {
                current_liabilities = add_money(current_liabilities, balance)?
            }
            _ => {}
        }
    }
    Ok(WorkingCapitalReport {
        as_of_date,
        branch_id: if branch_ids.len() == 1 {
            branch_ids[0].clone()
        } else {
            "consolidated".into()
        },
        branch_count: branch_ids.len(),
        current_assets_paise: current_assets,
        current_liabilities_paise: current_liabilities,
        working_capital_paise: subtract_money(current_assets, current_liabilities)?,
    })
}

pub async fn ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: LedgerQuery,
) -> Result<LedgerPage, AppError> {
    let account_code = normalize_account_code(&query.account_code)?;
    let from_date = parse_date(query.from_date.as_deref(), "fromDate")?;
    let to_date = parse_date(
        query.to_date.as_deref().or(query.as_of_date.as_deref()),
        "toDate",
    )?
    .unwrap_or_else(today_ist);
    if from_date.is_some_and(|date| date > to_date) {
        return Err(AppError::validation("fromDate cannot be after toDate"));
    }
    let page = query.page.unwrap_or(1).max(1);
    let page_size = query.page_size.unwrap_or(50).clamp(1, 200);
    let rows = balance_sheet_repository::ledger(
        db,
        tenant_id,
        branch_id,
        &account_code,
        from_date,
        to_date,
        page_size,
        (page - 1) * page_size,
    )
    .await
    .map_err(|_| AppError::internal("failed to load account ledger"))?;
    let account = account_definition(&account_code);
    let total = rows.first().map_or(0, |row| row.total_count);
    let credit_normal = account.normal_balance == NormalBalance::Credit;
    let rows = rows
        .into_iter()
        .map(|row| {
            let running_balance_paise = if credit_normal {
                row.running_debit_paise
                    .checked_neg()
                    .ok_or_else(|| AppError::internal("ledger balance exceeds supported range"))?
            } else {
                row.running_debit_paise
            };
            Ok(LedgerEntry {
                journal_entry_id: row.journal_entry_id,
                journal_line_id: row.journal_line_id,
                business_date: row.business_date,
                source_type: row.source_type,
                source_id: row.source_id,
                memo: row.memo,
                debit_paise: row.debit_paise,
                credit_paise: row.credit_paise,
                running_balance_paise,
                created_by_user_id: row.created_by_user_id,
                created_at: row.created_at,
                cost_center_id: row.cost_center_id,
                cost_center_code: row.cost_center_code,
                cost_center_name: row.cost_center_name,
                cost_center_kind: row.cost_center_kind,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(LedgerPage {
        account,
        from_date,
        to_date,
        page,
        page_size,
        total,
        rows,
    })
}

pub async fn create_manual_journal(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    created_by_user_id: &str,
    payload: ManualJournalRequest,
) -> Result<ManualJournalResponse, AppError> {
    let business_date = parse_date(
        payload
            .business_date
            .as_deref()
            .or(payload.entry_date.as_deref()),
        "businessDate",
    )?
    .ok_or_else(|| AppError::validation("businessDate is required"))?;
    if business_date > today_ist() {
        return Err(AppError::validation("businessDate cannot be in the future"));
    }
    let idempotency_key = payload.idempotency_key.trim();
    if idempotency_key.is_empty() || idempotency_key.len() > 128 {
        return Err(AppError::validation(
            "idempotencyKey must contain 1 to 128 characters",
        ));
    }
    let memo = payload.memo.unwrap_or_default().trim().to_string();
    if memo.len() > 500 {
        return Err(AppError::validation("memo cannot exceed 500 characters"));
    }
    let lines = validate_manual_lines(&payload.lines)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start manual journal transaction"))?;
    let inserted_id = accounting_service::post_manual_journal(
        &mut tx,
        tenant_id,
        branch_id,
        business_date,
        idempotency_key,
        &memo,
        created_by_user_id,
        &lines,
    )
    .await?;
    let (id, created) = if let Some(id) = inserted_id {
        (id, true)
    } else {
        let (existing, mut existing_lines) = balance_sheet_repository::manual_journal(
            &mut tx,
            tenant_id,
            branch_id,
            idempotency_key,
        )
        .await
        .map_err(|_| AppError::internal("failed to verify manual journal idempotency"))?;
        let mut expected_lines = lines
            .iter()
            .map(|line| ManualJournalLineRecord {
                account_code: line.account_code.clone(),
                debit_paise: line.debit_paise,
                credit_paise: line.credit_paise,
            })
            .collect::<Vec<_>>();
        expected_lines.sort();
        existing_lines.sort();
        if existing.business_date != business_date
            || existing.memo != memo
            || existing_lines != expected_lines
        {
            return Err(AppError::conflict(
                "idempotencyKey already belongs to a different manual journal",
            ));
        }
        (existing.id, false)
    };
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit manual journal"))?;
    Ok(ManualJournalResponse {
        id,
        business_date,
        created,
    })
}

pub async fn create_snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    created_by_user_id: &str,
    as_of_date: Option<&str>,
) -> Result<SnapshotResponse, AppError> {
    let as_of_date = parse_date(as_of_date, "asOfDate")?.unwrap_or_else(today_ist);
    if as_of_date > today_ist() {
        return Err(AppError::validation("asOfDate cannot be in the future"));
    }
    let report = live(db, tenant_id, branch_id, Some(&as_of_date.to_string())).await?;
    let payload_json = serde_json::to_string(&report)
        .map_err(|_| AppError::internal("failed to serialize balance sheet snapshot"))?;
    let saved = balance_sheet_repository::create_snapshot(
        db,
        tenant_id,
        branch_id,
        &report,
        &payload_json,
        created_by_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to archive balance sheet snapshot"))?;
    let report = serde_json::from_str(&saved.payload_json)
        .map_err(|_| AppError::internal("stored balance sheet snapshot is invalid"))?;
    Ok(SnapshotResponse {
        id: saved.id,
        as_of_date: saved.as_of_date,
        created_at: saved.created_at,
        report,
    })
}

pub async fn list_fixed_assets(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<FixedAssetResponse>, AppError> {
    balance_sheet_repository::list_fixed_assets(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(fixed_asset_response).collect())
        .map_err(|_| AppError::internal("failed to load fixed assets"))
}

pub async fn create_fixed_asset(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    created_by_user_id: &str,
    payload: FixedAssetCreateRequest,
) -> Result<FixedAssetResponse, AppError> {
    let name = payload.name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err(AppError::validation(
            "asset name must contain 1 to 120 characters",
        ));
    }
    let acquisition_date = parse_date(Some(&payload.acquisition_date), "acquisitionDate")?
        .expect("required date was parsed");
    if acquisition_date > today_ist() {
        return Err(AppError::validation(
            "acquisitionDate cannot be in the future",
        ));
    }
    let depreciation_start_date = parse_date(
        payload.depreciation_start_date.as_deref(),
        "depreciationStartDate",
    )?
    .unwrap_or(acquisition_date);
    if depreciation_start_date < acquisition_date {
        return Err(AppError::validation(
            "depreciationStartDate cannot be before acquisitionDate",
        ));
    }
    let salvage_paise = payload.salvage_paise.unwrap_or(0);
    if payload.cost_paise <= 0
        || salvage_paise < 0
        || salvage_paise >= payload.cost_paise
        || !(1..=1200).contains(&payload.useful_life_months)
    {
        return Err(AppError::validation(
            "cost, salvage and useful life values are invalid",
        ));
    }
    let purchase_offset_account = normalize_account_code(&payload.purchase_offset_account)?;
    if !matches!(
        purchase_offset_account.as_str(),
        "ACCOUNTS_PAYABLE" | "CASH_ON_HAND" | "BANK_CLEARING"
    ) {
        return Err(AppError::validation(
            "purchaseOffsetAccount must be ACCOUNTS_PAYABLE, CASH_ON_HAND, or BANK_CLEARING",
        ));
    }
    let idempotency_key = payload.idempotency_key.trim();
    if idempotency_key.is_empty() || idempotency_key.len() > 128 {
        return Err(AppError::validation(
            "idempotencyKey must contain 1 to 128 characters",
        ));
    }

    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start fixed asset transaction"))?;
    if let Some(existing) = balance_sheet_repository::fixed_asset_by_idempotency(
        &mut tx,
        tenant_id,
        branch_id,
        idempotency_key,
    )
    .await
    .map_err(|_| AppError::internal("failed to verify fixed asset idempotency"))?
    {
        if existing.name != name
            || existing.acquisition_date != acquisition_date
            || existing.depreciation_start_date != depreciation_start_date
            || existing.cost_paise != payload.cost_paise
            || existing.salvage_paise != salvage_paise
            || existing.useful_life_months != payload.useful_life_months
            || existing.purchase_offset_account != purchase_offset_account
        {
            return Err(AppError::conflict(
                "idempotencyKey already belongs to a different fixed asset",
            ));
        }
        return Ok(fixed_asset_response(existing));
    }

    let asset = balance_sheet_repository::create_fixed_asset(
        &mut tx,
        tenant_id,
        branch_id,
        name,
        acquisition_date,
        depreciation_start_date,
        payload.cost_paise,
        salvage_paise,
        payload.useful_life_months,
        &purchase_offset_account,
        idempotency_key,
        created_by_user_id,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|value| value.is_unique_violation())
        {
            AppError::conflict("asset code or idempotency key already exists")
        } else {
            AppError::internal("failed to create fixed asset")
        }
    })?;
    let journal_entry_id = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        branch_id,
        "fixed_asset_purchase",
        &asset.id,
        acquisition_date,
        "Fixed asset purchase",
        created_by_user_id,
        &[
            ManualJournalLine {
                account_code: "FIXED_ASSETS".to_string(),
                debit_paise: payload.cost_paise,
                credit_paise: 0,
            },
            ManualJournalLine {
                account_code: purchase_offset_account,
                debit_paise: 0,
                credit_paise: payload.cost_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("fixed asset purchase journal already exists"))?;
    balance_sheet_repository::set_fixed_asset_purchase_journal(
        &mut tx,
        &asset.id,
        &journal_entry_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to link fixed asset journal"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit fixed asset"))?;
    let mut response = fixed_asset_response(asset);
    response.purchase_journal_entry_id = Some(journal_entry_id);
    Ok(response)
}

pub async fn depreciate_fixed_asset(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    asset_id: &str,
    created_by_user_id: &str,
    payload: DepreciationRequest,
) -> Result<AccountingActionResponse, AppError> {
    let period_month = parse_month(&payload.period_month)?;
    let business_date = month_end(period_month)?;
    if business_date > today_ist() {
        return Err(AppError::validation(
            "depreciation period cannot end in the future",
        ));
    }
    let source_id = format!("{}:{}", asset_id.trim(), period_month.format("%Y-%m"));
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start depreciation transaction"))?;
    if let Some((journal_entry_id, existing_date, amount_paise)) =
        balance_sheet_repository::journal_action(
            &mut tx,
            tenant_id,
            branch_id,
            "fixed_asset_depreciation",
            &source_id,
            "ACCUMULATED_DEPRECIATION",
        )
        .await
        .map_err(|_| AppError::internal("failed to verify depreciation idempotency"))?
    {
        return Ok(AccountingActionResponse {
            journal_entry_id,
            business_date: existing_date,
            amount_paise,
            created: false,
        });
    }
    let asset =
        balance_sheet_repository::lock_fixed_asset(&mut tx, tenant_id, branch_id, asset_id.trim())
            .await
            .map_err(|_| AppError::internal("failed to load fixed asset"))?
            .ok_or_else(|| AppError::not_found("fixed asset not found"))?;
    if asset.status != "active" {
        return Err(AppError::conflict("fixed asset is not active"));
    }
    let amount_paise = depreciation_due(&asset, period_month)?;
    if amount_paise <= 0 {
        return Err(AppError::conflict("no depreciation is due for this period"));
    }
    let journal_entry_id = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        branch_id,
        "fixed_asset_depreciation",
        &source_id,
        business_date,
        "Fixed asset depreciation",
        created_by_user_id,
        &[
            ManualJournalLine {
                account_code: "DEPRECIATION_EXPENSE".to_string(),
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            ManualJournalLine {
                account_code: "ACCUMULATED_DEPRECIATION".to_string(),
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("depreciation journal already exists"))?;
    balance_sheet_repository::apply_fixed_asset_depreciation(
        &mut tx,
        &asset.id,
        amount_paise,
        business_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to update fixed asset depreciation"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit depreciation"))?;
    Ok(AccountingActionResponse {
        journal_entry_id,
        business_date,
        amount_paise,
        created: true,
    })
}

pub async fn list_deferred_revenue_schedules(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<DeferredRevenueScheduleResponse>, AppError> {
    balance_sheet_repository::list_deferred_revenue_schedules(db, tenant_id, branch_id)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(deferred_revenue_schedule_response)
                .collect()
        })
        .map_err(|_| AppError::internal("failed to load deferred revenue schedules"))
}

pub async fn recognize_deferred_revenue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    schedule_id: &str,
    created_by_user_id: &str,
    payload: DeferredRecognitionRequest,
) -> Result<AccountingActionResponse, AppError> {
    let recognition_date = parse_date(Some(&payload.recognition_date), "recognitionDate")?
        .expect("required date was parsed");
    if recognition_date > today_ist() {
        return Err(AppError::validation(
            "recognitionDate cannot be in the future",
        ));
    }
    let source_id = format!("{}:{}", schedule_id.trim(), recognition_date);
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start revenue recognition transaction"))?;
    if let Some((journal_entry_id, existing_date, amount_paise)) =
        balance_sheet_repository::journal_action(
            &mut tx,
            tenant_id,
            branch_id,
            "deferred_revenue_recognition",
            &source_id,
            "DEFERRED_REVENUE",
        )
        .await
        .map_err(|_| AppError::internal("failed to verify recognition idempotency"))?
    {
        return Ok(AccountingActionResponse {
            journal_entry_id,
            business_date: existing_date,
            amount_paise,
            created: false,
        });
    }
    let schedule = balance_sheet_repository::lock_deferred_revenue_schedule(
        &mut tx,
        tenant_id,
        branch_id,
        schedule_id.trim(),
    )
    .await
    .map_err(|_| AppError::internal("failed to load deferred revenue schedule"))?
    .ok_or_else(|| AppError::not_found("deferred revenue schedule not found"))?;
    let amount_paise = recognition_due(&schedule, recognition_date)?;
    if amount_paise <= 0 {
        return Err(AppError::conflict(
            "no deferred revenue is due on this date",
        ));
    }
    let journal_entry_id = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        branch_id,
        "deferred_revenue_recognition",
        &source_id,
        recognition_date,
        "Deferred revenue recognition",
        created_by_user_id,
        &[
            ManualJournalLine {
                account_code: "DEFERRED_REVENUE".to_string(),
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            ManualJournalLine {
                account_code: "SALES_REVENUE".to_string(),
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await?
    .ok_or_else(|| AppError::conflict("recognition journal already exists"))?;
    balance_sheet_repository::apply_deferred_revenue_recognition(
        &mut tx,
        &schedule.id,
        amount_paise,
        recognition_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to update deferred revenue schedule"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit revenue recognition"))?;
    Ok(AccountingActionResponse {
        journal_entry_id,
        business_date: recognition_date,
        amount_paise,
        created: true,
    })
}

pub async fn list_accounting_periods(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AccountingPeriodResponse>, AppError> {
    balance_sheet_repository::list_accounting_periods(db, tenant_id, branch_id)
        .await
        .map(|rows| rows.into_iter().map(accounting_period_response).collect())
        .map_err(|_| AppError::internal("failed to load accounting periods"))
}

pub async fn close_accounting_period(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    payload: PeriodCloseRequest,
) -> Result<AccountingPeriodResponse, AppError> {
    let period_month = parse_month(&payload.period_month)?;
    let period_end = month_end(period_month)?;
    if period_end > today_ist() {
        return Err(AppError::validation(
            "accounting period cannot close before month end",
        ));
    }
    let reason = validate_reason(&payload.reason)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start period close transaction"))?;
    balance_sheet_repository::lock_accounting_period(&mut tx, tenant_id, branch_id, period_month)
        .await
        .map_err(|_| AppError::internal("failed to lock accounting period"))?;
    let hardening =
        finance_hardening_status(db, tenant_id, branch_id, Some(&period_end.to_string())).await?;
    if hardening.status != "healthy" {
        return Err(AppError::conflict(
            "accounting period has unresolved reconciliation variances",
        ));
    }
    let row = balance_sheet_repository::close_accounting_period(
        &mut tx,
        tenant_id,
        branch_id,
        period_month,
        reason,
        user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to close accounting period"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit period close"))?;
    Ok(accounting_period_response(row))
}

pub async fn reopen_accounting_period(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    user_id: &str,
    period: &str,
    payload: PeriodReopenRequest,
) -> Result<AccountingPeriodResponse, AppError> {
    let period_month = parse_month(period)?;
    let reason = validate_reason(&payload.reason)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start period reopen transaction"))?;
    balance_sheet_repository::lock_accounting_period(&mut tx, tenant_id, branch_id, period_month)
        .await
        .map_err(|_| AppError::internal("failed to lock accounting period"))?;
    let row = balance_sheet_repository::reopen_accounting_period(
        &mut tx,
        tenant_id,
        branch_id,
        period_month,
        reason,
        user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to reopen accounting period"))?
    .ok_or_else(|| AppError::conflict("accounting period is not closed"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit period reopen"))?;
    Ok(accounting_period_response(row))
}

pub async fn finance_hardening_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    as_of_date: Option<&str>,
) -> Result<FinanceHardeningStatus, AppError> {
    let as_of_date = parse_date(as_of_date, "asOfDate")?.unwrap_or_else(today_ist);
    if as_of_date > today_ist() {
        return Err(AppError::validation("asOfDate cannot be in the future"));
    }
    let reconciliation =
        balance_sheet_repository::finance_reconciliation(db, tenant_id, branch_id, as_of_date)
            .await
            .map_err(|_| AppError::internal("failed to load finance reconciliation"))?;
    let inventory = inventory_repository::gl_reconciliation_snapshot(
        db,
        tenant_id,
        branch_id,
        as_of_date,
        accounting_service::INVENTORY_ASSET_ACCOUNT,
    )
    .await
    .map_err(|_| AppError::internal("failed to load inventory reconciliation"))?;
    let period_month = NaiveDate::from_ymd_opt(as_of_date.year(), as_of_date.month(), 1)
        .expect("valid report date has a valid month");
    let micro_profit = analytics_repository::micro_profit_reconciliation(
        db,
        tenant_id,
        &[branch_id.to_string()],
        period_month,
        as_of_date,
    )
    .await
    .map_err(|_| AppError::internal("failed to load Micro P&L close readiness"))?;
    let report = live(db, tenant_id, branch_id, Some(&as_of_date.to_string())).await?;
    let accounting_period_status =
        balance_sheet_repository::accounting_period_status(db, tenant_id, branch_id, period_month)
            .await
            .map_err(|_| AppError::internal("failed to load accounting period status"))?;
    let micro_cost_complete_line_count = if micro_profit.reportable_line_count == 0
        || (micro_profit.allocation_rule_count > 0 && micro_profit.unallocated_overhead_paise == 0)
    {
        micro_profit.cost_complete_line_count
    } else {
        0
    };

    let mut checks = vec![
        reconciliation_check(
            "journal_balance",
            reconciliation.journal_debit_paise,
            reconciliation.journal_credit_paise,
            0,
            false,
        )?,
        reconciliation_check(
            "inventory",
            inventory.inventory_value_paise,
            inventory.gl_value_paise,
            inventory.product_count,
            false,
        )?,
        reconciliation_check(
            "customer_credit",
            reconciliation.customer_credit_source_paise,
            reconciliation.customer_credit_ledger_paise,
            0,
            false,
        )?,
        reconciliation_check(
            "deferred_revenue",
            reconciliation.deferred_source_paise,
            reconciliation.deferred_ledger_paise,
            0,
            false,
        )?,
        reconciliation_check(
            "fixed_assets",
            reconciliation.fixed_asset_source_paise,
            reconciliation.fixed_asset_ledger_paise,
            0,
            false,
        )?,
        reconciliation_check(
            "micro_profit_revenue",
            micro_profit.micro_revenue_paise,
            micro_profit.ledger_revenue_paise,
            micro_profit.missing_invoice_journal_count,
            false,
        )?,
        reconciliation_check(
            "micro_profit_cogs",
            micro_profit.micro_product_cost_paise,
            micro_profit.ledger_cogs_paise,
            micro_profit.missing_product_cost_line_count,
            false,
        )?,
        reconciliation_check(
            "micro_profit_payroll",
            micro_profit.payroll_source_paise,
            micro_profit.ledger_payroll_paise,
            micro_profit.missing_staff_time_cost_line_count,
            false,
        )?,
        reconciliation_check(
            "micro_profit_cost_completeness",
            micro_profit.reportable_line_count,
            micro_cost_complete_line_count,
            micro_profit
                .reportable_line_count
                .saturating_sub(micro_cost_complete_line_count),
            false,
        )?,
        reconciliation_check(
            "balance_sheet_equation",
            report.totals.assets_paise,
            add_money(report.totals.liabilities_paise, report.totals.equity_paise)?,
            report.unclassified_accounts.len() as i64,
            false,
        )?,
    ];
    checks.push(reconciliation_check(
        "inventory_missing_cost",
        inventory.missing_cost_products,
        0,
        inventory.missing_cost_products,
        true,
    )?);
    if !report.balanced {
        if let Some(check) = checks
            .iter_mut()
            .find(|check| check.key == "balance_sheet_equation")
        {
            check.status = "critical".to_string();
        }
    }
    let critical_count = checks
        .iter()
        .filter(|check| check.status == "critical")
        .count() as i64;
    let warning_count = checks
        .iter()
        .filter(|check| check.status == "warning")
        .count() as i64;
    Ok(FinanceHardeningStatus {
        as_of_date,
        branch_id: branch_id.to_string(),
        status: if critical_count == 0 && warning_count == 0 {
            "healthy"
        } else {
            "attention"
        }
        .to_string(),
        accounting_period_status,
        balance_sheet_balanced: report.balanced,
        critical_count,
        warning_count,
        checks,
    })
}

fn build_report(
    branch_id: &str,
    branch_count: usize,
    as_of_date: NaiveDate,
    rows: &[AccountTotalRecord],
) -> Result<BalanceSheetReport, AppError> {
    let mut assets = Vec::new();
    let mut liabilities = Vec::new();
    let mut equity = Vec::new();
    let mut unclassified = Vec::new();
    let mut revenue = 0_i64;
    let mut expenses = 0_i64;
    for row in rows {
        let account = account_definition(&row.account_code);
        let balance = account_balance(account.group, row.debit_paise, row.credit_paise)?;
        if balance == 0 {
            continue;
        }
        let output = AccountBalance {
            code: account.code,
            name: account.name,
            group: account.group,
            balance_paise: balance,
        };
        match account.group {
            AccountGroup::Asset => assets.push(output),
            AccountGroup::Liability => liabilities.push(output),
            AccountGroup::Equity => equity.push(output),
            AccountGroup::Revenue => revenue = add_money(revenue, balance)?,
            AccountGroup::Expense => expenses = add_money(expenses, balance)?,
            AccountGroup::Unclassified => unclassified.push(output),
        }
    }
    let current_earnings = subtract_money(revenue, expenses)?;
    if current_earnings != 0 {
        equity.push(AccountBalance {
            code: "CURRENT_EARNINGS".to_string(),
            name: "Current Profit / Loss".to_string(),
            group: AccountGroup::Equity,
            balance_paise: current_earnings,
        });
    }
    let total_assets = sum_balances(&assets)?;
    let total_liabilities = sum_balances(&liabilities)?;
    let total_equity = sum_balances(&equity)?;
    let difference = subtract_money(
        subtract_money(total_assets, total_liabilities)?,
        total_equity,
    )?;
    Ok(BalanceSheetReport {
        as_of_date,
        branch_id: branch_id.to_string(),
        branch_count,
        balanced: difference == 0 && unclassified.is_empty(),
        totals: BalanceSheetTotals {
            assets_paise: total_assets,
            liabilities_paise: total_liabilities,
            equity_paise: total_equity,
            accounting_equation_difference_paise: difference,
        },
        sections: BalanceSheetSections {
            assets,
            liabilities,
            equity,
        },
        unclassified_accounts: unclassified,
    })
}

fn validate_manual_lines(
    lines: &[ManualJournalLineRequest],
) -> Result<Vec<ManualJournalLine>, AppError> {
    if !(2..=100).contains(&lines.len()) {
        return Err(AppError::validation(
            "manual journal must contain 2 to 100 lines",
        ));
    }
    let mut debit_total = 0_i64;
    let mut credit_total = 0_i64;
    let mut normalized = Vec::with_capacity(lines.len());
    for line in lines {
        let account_code = normalize_account_code(&line.account_code)?;
        if account_meta(&account_code).is_none() {
            return Err(AppError::validation(format!(
                "unknown accountCode: {account_code}"
            )));
        }
        if line.debit_paise < 0
            || line.credit_paise < 0
            || (line.debit_paise > 0) == (line.credit_paise > 0)
        {
            return Err(AppError::validation(
                "each journal line must contain one positive debit or credit",
            ));
        }
        debit_total = add_money(debit_total, line.debit_paise)?;
        credit_total = add_money(credit_total, line.credit_paise)?;
        normalized.push(ManualJournalLine {
            account_code,
            debit_paise: line.debit_paise,
            credit_paise: line.credit_paise,
        });
    }
    if debit_total == 0 || debit_total != credit_total {
        return Err(AppError::validation(
            "manual journal debit and credit totals must balance",
        ));
    }
    Ok(normalized)
}

fn account_meta(code: &str) -> Option<AccountMeta> {
    ACCOUNTS
        .iter()
        .copied()
        .find(|account| account.code == code)
}

fn account_definition(code: &str) -> AccountDefinition {
    account_meta(code)
        .map(definition)
        .unwrap_or_else(|| AccountDefinition {
            code: code.to_string(),
            name: code.to_string(),
            group: AccountGroup::Unclassified,
            normal_balance: NormalBalance::Debit,
            current: false,
        })
}

fn definition(account: AccountMeta) -> AccountDefinition {
    AccountDefinition {
        code: account.code.to_string(),
        name: account.name.to_string(),
        group: account.group,
        normal_balance: match account.group {
            AccountGroup::Asset | AccountGroup::Expense | AccountGroup::Unclassified => {
                NormalBalance::Debit
            }
            _ => NormalBalance::Credit,
        },
        current: account.current,
    }
}

fn account_balance(group: AccountGroup, debit: i64, credit: i64) -> Result<i64, AppError> {
    match group {
        AccountGroup::Asset | AccountGroup::Expense | AccountGroup::Unclassified => {
            subtract_money(debit, credit)
        }
        _ => subtract_money(credit, debit),
    }
}

fn normalize_account_code(value: &str) -> Result<String, AppError> {
    let code = value.trim().to_ascii_uppercase();
    if code.is_empty()
        || code.len() > 64
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(AppError::validation("accountCode is invalid"));
    }
    Ok(code)
}

fn normalize_cost_center_kind(value: Option<&str>) -> Result<&str, AppError> {
    let kind = value.unwrap_or("custom").trim().to_ascii_lowercase();
    match kind.as_str() {
        "chair" => Ok("chair"),
        "stylist" => Ok("stylist"),
        "category" => Ok("category"),
        "department" => Ok("department"),
        "custom" | "" => Ok("custom"),
        _ => Err(AppError::validation(
            "cost center kind must be chair, stylist, category, department, or custom",
        )),
    }
}

fn cost_center_response(row: balance_sheet_repository::CostCenterRecord) -> CostCenterResponse {
    CostCenterResponse {
        id: row.id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        active: row.active,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn fixed_asset_response(row: balance_sheet_repository::FixedAssetRecord) -> FixedAssetResponse {
    FixedAssetResponse {
        id: row.id,
        asset_code: row.asset_code,
        name: row.name,
        acquisition_date: row.acquisition_date,
        depreciation_start_date: row.depreciation_start_date,
        cost_paise: row.cost_paise,
        salvage_paise: row.salvage_paise,
        useful_life_months: row.useful_life_months,
        accumulated_depreciation_paise: row.accumulated_depreciation_paise,
        net_book_value_paise: row.cost_paise - row.accumulated_depreciation_paise,
        last_depreciation_date: row.last_depreciation_date,
        purchase_offset_account: row.purchase_offset_account,
        purchase_journal_entry_id: row.purchase_journal_entry_id,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn deferred_revenue_schedule_response(
    row: balance_sheet_repository::DeferredRevenueScheduleRecord,
) -> DeferredRevenueScheduleResponse {
    DeferredRevenueScheduleResponse {
        id: row.id,
        sale_id: row.sale_id,
        sale_line_id: row.sale_line_id,
        source_type: row.source_type,
        source_item_id: row.source_item_id,
        total_paise: row.total_paise,
        recognized_paise: row.recognized_paise,
        remaining_paise: row.total_paise - row.recognized_paise,
        start_date: row.start_date,
        end_date: row.end_date,
        last_recognition_date: row.last_recognition_date,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn accounting_period_response(
    row: balance_sheet_repository::AccountingPeriodRecord,
) -> AccountingPeriodResponse {
    AccountingPeriodResponse {
        id: row.id,
        period_month: row.period_month,
        status: row.status,
        close_reason: row.close_reason,
        closed_by_user_id: row.closed_by_user_id,
        closed_at: row.closed_at,
        reopen_reason: row.reopen_reason,
        reopened_by_user_id: row.reopened_by_user_id,
        reopened_at: row.reopened_at,
        updated_at: row.updated_at,
    }
}

fn depreciation_due(
    asset: &balance_sheet_repository::FixedAssetRecord,
    period_month: NaiveDate,
) -> Result<i64, AppError> {
    let start_month = NaiveDate::from_ymd_opt(
        asset.depreciation_start_date.year(),
        asset.depreciation_start_date.month(),
        1,
    )
    .expect("valid depreciation date has a valid month");
    if period_month < start_month {
        return Err(AppError::validation(
            "periodMonth cannot be before depreciationStartDate",
        ));
    }
    let elapsed_months = (period_month.year() - start_month.year()) * 12
        + period_month.month() as i32
        - start_month.month() as i32
        + 1;
    let recognized_months = elapsed_months.min(asset.useful_life_months) as i128;
    let depreciable_paise = (asset.cost_paise - asset.salvage_paise) as i128;
    let target_paise = depreciable_paise * recognized_months / asset.useful_life_months as i128;
    let target_paise = i64::try_from(target_paise)
        .map_err(|_| AppError::internal("depreciation amount exceeds supported range"))?;
    subtract_money(target_paise, asset.accumulated_depreciation_paise)
}

fn recognition_due(
    schedule: &balance_sheet_repository::DeferredRevenueScheduleRecord,
    recognition_date: NaiveDate,
) -> Result<i64, AppError> {
    if recognition_date < schedule.start_date {
        return Err(AppError::validation(
            "recognitionDate cannot be before schedule startDate",
        ));
    }
    let effective_date = recognition_date.min(schedule.end_date);
    let total_days = (schedule.end_date - schedule.start_date).num_days() + 1;
    let elapsed_days = (effective_date - schedule.start_date).num_days() + 1;
    let target_paise = schedule.total_paise as i128 * elapsed_days as i128 / total_days as i128;
    let target_paise = i64::try_from(target_paise)
        .map_err(|_| AppError::internal("recognition amount exceeds supported range"))?;
    subtract_money(target_paise, schedule.recognized_paise)
}

fn reconciliation_check(
    key: &str,
    source_balance_paise: i64,
    ledger_balance_paise: i64,
    detail_count: i64,
    warning_only: bool,
) -> Result<ReconciliationCheck, AppError> {
    let variance_paise = subtract_money(source_balance_paise, ledger_balance_paise)?;
    Ok(ReconciliationCheck {
        key: key.to_string(),
        status: if variance_paise == 0 {
            "healthy"
        } else if warning_only {
            "warning"
        } else {
            "critical"
        }
        .to_string(),
        source_balance_paise,
        ledger_balance_paise,
        variance_paise,
        detail_count,
    })
}

fn parse_month(value: &str) -> Result<NaiveDate, AppError> {
    let value = value.trim();
    if value.len() != 7 {
        return Err(AppError::validation("periodMonth must use YYYY-MM"));
    }
    NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::validation("periodMonth must use YYYY-MM"))
}

fn month_end(period_month: NaiveDate) -> Result<NaiveDate, AppError> {
    period_month
        .checked_add_months(Months::new(1))
        .and_then(|date| date.checked_sub_signed(Duration::days(1)))
        .ok_or_else(|| AppError::validation("periodMonth is outside the supported range"))
}

fn validate_reason(value: &str) -> Result<&str, AppError> {
    let reason = value.trim();
    if reason.is_empty() || reason.len() > 500 {
        return Err(AppError::validation(
            "reason must contain 1 to 500 characters",
        ));
    }
    Ok(reason)
}

fn parse_date(value: Option<&str>, field: &str) -> Result<Option<NaiveDate>, AppError> {
    value
        .map(|date| {
            NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
                .map_err(|_| AppError::validation(format!("{field} must use YYYY-MM-DD")))
        })
        .transpose()
}

fn today_ist() -> NaiveDate {
    Utc::now()
        .with_timezone(&FixedOffset::east_opt(19_800).expect("IST offset is valid"))
        .date_naive()
}

fn sum_balances(rows: &[AccountBalance]) -> Result<i64, AppError> {
    rows.iter()
        .try_fold(0_i64, |total, row| add_money(total, row.balance_paise))
}

fn add_money(left: i64, right: i64) -> Result<i64, AppError> {
    left.checked_add(right)
        .ok_or_else(|| AppError::internal("accounting amount exceeds supported range"))
}

fn subtract_money(left: i64, right: i64) -> Result<i64, AppError> {
    left.checked_sub(right)
        .ok_or_else(|| AppError::internal("accounting amount exceeds supported range"))
}

#[cfg(test)]
mod tests {
    use super::{build_report, depreciation_due, recognition_due, validate_manual_lines};
    use crate::{
        models::balance_sheet::ManualJournalLineRequest,
        repositories::balance_sheet_repository::{
            AccountTotalRecord, DeferredRevenueScheduleRecord, FixedAssetRecord,
        },
    };
    use chrono::{NaiveDate, Utc};

    #[test]
    fn report_rolls_income_into_current_equity() {
        let report = build_report(
            "branch",
            1,
            NaiveDate::from_ymd_opt(2026, 7, 14).unwrap(),
            &[
                AccountTotalRecord {
                    account_code: "ACCOUNTS_RECEIVABLE".into(),
                    debit_paise: 11_800,
                    credit_paise: 0,
                },
                AccountTotalRecord {
                    account_code: "SALES_REVENUE".into(),
                    debit_paise: 0,
                    credit_paise: 10_000,
                },
                AccountTotalRecord {
                    account_code: "GST_PAYABLE".into(),
                    debit_paise: 0,
                    credit_paise: 1_800,
                },
            ],
        )
        .unwrap();
        assert!(report.balanced);
        assert_eq!(report.branch_count, 1);
        assert_eq!(report.totals.assets_paise, 11_800);
        assert_eq!(report.totals.liabilities_paise, 1_800);
        assert_eq!(report.totals.equity_paise, 10_000);
    }

    #[test]
    fn manual_journal_requires_known_balanced_accounts() {
        assert!(validate_manual_lines(&[
            ManualJournalLineRequest {
                account_code: "cash_on_hand".into(),
                debit_paise: 500,
                credit_paise: 0
            },
            ManualJournalLineRequest {
                account_code: "owner_equity".into(),
                debit_paise: 0,
                credit_paise: 500
            },
        ])
        .is_ok());
        assert!(validate_manual_lines(&[
            ManualJournalLineRequest {
                account_code: "cash_on_hand".into(),
                debit_paise: 500,
                credit_paise: 0
            },
            ManualJournalLineRequest {
                account_code: "owner_equity".into(),
                debit_paise: 0,
                credit_paise: 400
            },
        ])
        .is_err());
    }

    #[test]
    fn depreciation_uses_cumulative_straight_line_and_finishes_exactly() {
        let mut asset = FixedAssetRecord {
            id: "asset".into(),
            asset_code: "CHAIR_01".into(),
            name: "Chair".into(),
            acquisition_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            depreciation_start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            cost_paise: 10_001,
            salvage_paise: 1,
            useful_life_months: 3,
            accumulated_depreciation_paise: 3_333,
            last_depreciation_date: Some(NaiveDate::from_ymd_opt(2026, 1, 31).unwrap()),
            purchase_offset_account: "CASH_ON_HAND".into(),
            purchase_journal_entry_id: Some("journal".into()),
            status: "active".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert_eq!(
            depreciation_due(&asset, NaiveDate::from_ymd_opt(2026, 2, 1).unwrap()).unwrap(),
            3_333
        );
        asset.accumulated_depreciation_paise = 6_666;
        assert_eq!(
            depreciation_due(&asset, NaiveDate::from_ymd_opt(2026, 3, 1).unwrap()).unwrap(),
            3_334
        );
    }

    #[test]
    fn recognition_uses_inclusive_daily_schedule_and_finishes_exactly() {
        let mut schedule = DeferredRevenueScheduleRecord {
            id: "schedule".into(),
            sale_id: "sale".into(),
            sale_line_id: "line".into(),
            source_type: "membership".into(),
            source_item_id: "membership".into(),
            total_paise: 10_000,
            recognized_paise: 3_333,
            start_date: NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 1, 3).unwrap(),
            last_recognition_date: Some(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()),
            status: "open".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert_eq!(
            recognition_due(&schedule, NaiveDate::from_ymd_opt(2026, 1, 2).unwrap()).unwrap(),
            3_333
        );
        schedule.recognized_paise = 6_666;
        assert_eq!(
            recognition_due(&schedule, NaiveDate::from_ymd_opt(2026, 1, 3).unwrap()).unwrap(),
            3_334
        );
    }
}
