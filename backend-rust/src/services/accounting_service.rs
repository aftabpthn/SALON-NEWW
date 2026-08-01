use chrono::{NaiveDate, Utc};
use sqlx::{Postgres, Transaction};
use std::collections::BTreeMap;

use crate::models::common::AppError;

pub const INVENTORY_ASSET_ACCOUNT: &str = "INVENTORY_ASSET";

struct JournalLine<'a> {
    account_code: &'a str,
    debit_paise: i64,
    credit_paise: i64,
}

pub struct ManualJournalLine {
    pub account_code: String,
    pub debit_paise: i64,
    pub credit_paise: i64,
}

pub struct RefundSettlement {
    pub method: String,
    pub amount_paise: i64,
}

#[derive(Clone, Copy)]
pub struct InvoiceAccountingTotals {
    pub total_paise: i64,
    pub tax_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
}

pub async fn post_invoice_correction(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    correction_request_id: &str,
    business_date: NaiveDate,
    actor_user_id: &str,
    old: InvoiceAccountingTotals,
    new: InvoiceAccountingTotals,
) -> Result<(), AppError> {
    let lines = invoice_correction_lines(old, new)?;
    if lines.is_empty() {
        return Ok(());
    }
    post_control_journal(
        tx,
        tenant_id,
        branch_id,
        "invoice_correction",
        correction_request_id,
        business_date,
        "Approved POS invoice correction",
        actor_user_id,
        &lines,
    )
    .await
    .map(|_| ())
}

fn invoice_correction_lines(
    old: InvoiceAccountingTotals,
    new: InvoiceAccountingTotals,
) -> Result<Vec<ManualJournalLine>, AppError> {
    let old = invoice_account_balances(old)?;
    let new = invoice_account_balances(new)?;
    let mut accounts = old.keys().chain(new.keys()).collect::<Vec<_>>();
    accounts.sort_unstable();
    accounts.dedup();
    Ok(accounts
        .into_iter()
        .filter_map(|account| {
            let delta =
                new.get(account).copied().unwrap_or(0) - old.get(account).copied().unwrap_or(0);
            (delta != 0).then(|| ManualJournalLine {
                account_code: account.clone(),
                debit_paise: delta.max(0),
                credit_paise: (-delta).max(0),
            })
        })
        .collect())
}

fn invoice_account_balances(
    totals: InvoiceAccountingTotals,
) -> Result<BTreeMap<String, i64>, AppError> {
    let revenue = totals
        .total_paise
        .saturating_sub(totals.tax_paise)
        .saturating_sub(totals.tip_paise)
        .saturating_sub(totals.round_off_paise);
    if totals.total_paise < 0 || revenue < 0 {
        return Err(AppError::validation(
            "invoice correction totals are invalid",
        ));
    }
    let mut balances = BTreeMap::from([
        ("ACCOUNTS_RECEIVABLE".to_string(), totals.total_paise),
        ("SALES_REVENUE".to_string(), -revenue),
    ]);
    let split_tax = totals.cgst_paise + totals.sgst_paise + totals.igst_paise;
    if split_tax != 0 && split_tax != totals.tax_paise {
        return Err(AppError::validation(
            "invoice correction GST split is invalid",
        ));
    }
    if split_tax == 0 {
        balances.insert("GST_PAYABLE".to_string(), -totals.tax_paise);
    } else {
        balances.insert("CGST_PAYABLE".to_string(), -totals.cgst_paise);
        balances.insert("SGST_PAYABLE".to_string(), -totals.sgst_paise);
        balances.insert("IGST_PAYABLE".to_string(), -totals.igst_paise);
    }
    balances.insert("TIPS_PAYABLE".to_string(), -totals.tip_paise);
    balances.insert(
        "ROUNDING_INCOME".to_string(),
        -totals.round_off_paise.max(0),
    );
    balances.insert(
        "ROUNDING_EXPENSE".to_string(),
        (-totals.round_off_paise).max(0),
    );
    Ok(balances)
}

pub async fn post_invoice(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    total_paise: i64,
    tax_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    tip_paise: i64,
    round_off_paise: i64,
) -> Result<(), AppError> {
    post_invoice_entry(
        tx,
        tenant_id,
        branch_id,
        sale_id,
        total_paise,
        tax_paise,
        cgst_paise,
        sgst_paise,
        igst_paise,
        tip_paise,
        round_off_paise,
        None,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn post_invoice_backfill(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    total_paise: i64,
    tax_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    tip_paise: i64,
    round_off_paise: i64,
    business_date: NaiveDate,
    actor_user_id: &str,
) -> Result<(), AppError> {
    post_invoice_entry(
        tx,
        tenant_id,
        branch_id,
        sale_id,
        total_paise,
        tax_paise,
        cgst_paise,
        sgst_paise,
        igst_paise,
        tip_paise,
        round_off_paise,
        Some(business_date),
        Some(actor_user_id),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn post_invoice_entry(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
    total_paise: i64,
    tax_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    tip_paise: i64,
    round_off_paise: i64,
    business_date: Option<NaiveDate>,
    actor_user_id: Option<&str>,
) -> Result<(), AppError> {
    let invoice_revenue_paise = total_paise
        .saturating_sub(tax_paise)
        .saturating_sub(tip_paise)
        .saturating_sub(round_off_paise);
    if total_paise == 0 {
        return Ok(());
    }
    if total_paise < 0 || invoice_revenue_paise < 0 {
        return Err(AppError::validation(
            "invoice totals cannot be posted to accounting",
        ));
    }
    if cgst_paise < 0
        || sgst_paise < 0
        || igst_paise < 0
        || (cgst_paise + sgst_paise + igst_paise != 0
            && cgst_paise + sgst_paise + igst_paise != tax_paise)
    {
        return Err(AppError::validation("invoice GST split is invalid"));
    }
    let deferred_revenue_paise = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(taxable_paise),0)::BIGINT FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND line_type IN ('membership','package')",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to calculate deferred revenue"))?;
    if deferred_revenue_paise < 0 || deferred_revenue_paise > invoice_revenue_paise {
        return Err(AppError::validation("invoice deferred revenue is invalid"));
    }
    let immediate_revenue_paise = invoice_revenue_paise - deferred_revenue_paise;
    let mut lines = vec![JournalLine {
        account_code: "ACCOUNTS_RECEIVABLE",
        debit_paise: total_paise,
        credit_paise: 0,
    }];
    if immediate_revenue_paise > 0 {
        lines.push(JournalLine {
            account_code: "SALES_REVENUE",
            debit_paise: 0,
            credit_paise: immediate_revenue_paise,
        });
    }
    if deferred_revenue_paise > 0 {
        lines.push(JournalLine {
            account_code: "DEFERRED_REVENUE",
            debit_paise: 0,
            credit_paise: deferred_revenue_paise,
        });
    }
    if cgst_paise > 0 {
        lines.push(JournalLine {
            account_code: "CGST_PAYABLE",
            debit_paise: 0,
            credit_paise: cgst_paise,
        });
    }
    if sgst_paise > 0 {
        lines.push(JournalLine {
            account_code: "SGST_PAYABLE",
            debit_paise: 0,
            credit_paise: sgst_paise,
        });
    }
    if igst_paise > 0 {
        lines.push(JournalLine {
            account_code: "IGST_PAYABLE",
            debit_paise: 0,
            credit_paise: igst_paise,
        });
    }
    if tax_paise > 0 && cgst_paise + sgst_paise + igst_paise == 0 {
        lines.push(JournalLine {
            account_code: "GST_PAYABLE",
            debit_paise: 0,
            credit_paise: tax_paise,
        });
    }
    if tip_paise > 0 {
        lines.push(JournalLine {
            account_code: "TIPS_PAYABLE",
            debit_paise: 0,
            credit_paise: tip_paise,
        });
    }
    if round_off_paise > 0 {
        lines.push(JournalLine {
            account_code: "ROUNDING_INCOME",
            debit_paise: 0,
            credit_paise: round_off_paise,
        });
    } else if round_off_paise < 0 {
        lines.push(JournalLine {
            account_code: "ROUNDING_EXPENSE",
            debit_paise: -round_off_paise,
            credit_paise: 0,
        });
    }
    write_entry(
        tx,
        tenant_id,
        branch_id,
        "invoice",
        sale_id,
        "POS invoice",
        business_date,
        actor_user_id,
        lines,
    )
    .await?;
    ensure_deferred_revenue_schedules(tx, tenant_id, branch_id, sale_id).await
}

pub async fn post_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    payment_id: &str,
    method: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "payment",
        payment_id,
        "POS payment",
        vec![
            JournalLine {
                account_code: payment_account(method),
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "ACCOUNTS_RECEIVABLE",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

pub async fn post_payment_backfill(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    payment_id: &str,
    method: &str,
    amount_paise: i64,
    business_date: NaiveDate,
    actor_user_id: &str,
) -> Result<Option<String>, AppError> {
    write_entry(
        tx,
        tenant_id,
        branch_id,
        "payment",
        payment_id,
        "Migrated POS payment",
        Some(business_date),
        Some(actor_user_id),
        vec![
            JournalLine {
                account_code: payment_account(method),
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "ACCOUNTS_RECEIVABLE",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

pub async fn post_pos_advance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    payment_id: &str,
    method: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    post_customer_credit_change(
        tx,
        tenant_id,
        branch_id,
        "pos_advance_payment",
        payment_id,
        "POS client advance",
        amount_paise,
        payment_account(method),
    )
    .await
}

pub async fn post_refund(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    refund_id: &str,
    settlements: &[RefundSettlement],
) -> Result<(), AppError> {
    let lines = refund_journal_lines(settlements)?;
    let lines = lines
        .iter()
        .map(|line| JournalLine {
            account_code: &line.account_code,
            debit_paise: line.debit_paise,
            credit_paise: line.credit_paise,
        })
        .collect();
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "refund",
        refund_id,
        "POS refund",
        lines,
    )
    .await
}

fn refund_journal_lines(
    settlements: &[RefundSettlement],
) -> Result<Vec<ManualJournalLine>, AppError> {
    let mut credits = BTreeMap::<String, i64>::new();
    let total = settlements.iter().try_fold(0i64, |total, settlement| {
        if settlement.amount_paise <= 0 {
            return Err(AppError::validation("refund settlement amount is invalid"));
        }
        credits
            .entry(payment_account(&settlement.method).to_string())
            .and_modify(|amount| *amount = amount.saturating_add(settlement.amount_paise))
            .or_insert(settlement.amount_paise);
        Ok(total.saturating_add(settlement.amount_paise))
    })?;
    if total <= 0 {
        return Err(AppError::validation("refund settlement is required"));
    }
    let mut lines = vec![ManualJournalLine {
        account_code: "SALES_RETURNS".to_string(),
        debit_paise: total,
        credit_paise: 0,
    }];
    lines.extend(
        credits
            .into_iter()
            .map(|(account_code, amount_paise)| ManualJournalLine {
                account_code,
                debit_paise: 0,
                credit_paise: amount_paise,
            }),
    );
    Ok(lines)
}

pub async fn post_cash_bank_deposit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    deposit_id: &str,
    business_date: NaiveDate,
    actor_user_id: &str,
    amount_paise: i64,
) -> Result<Option<String>, AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("bank deposit amount is invalid"));
    }
    write_entry(
        tx,
        tenant_id,
        branch_id,
        "cash_drawer_bank_deposit",
        deposit_id,
        "Cash drawer bank deposit",
        Some(business_date),
        Some(actor_user_id),
        vec![
            JournalLine {
                account_code: "BANK_CLEARING",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "CASH_ON_HAND",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

pub async fn post_credit_note(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    credit_note_id: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "credit_note",
        credit_note_id,
        "POS credit note",
        vec![
            JournalLine {
                account_code: "SALES_RETURNS",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "ACCOUNTS_RECEIVABLE",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

pub async fn post_purchase_grn(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    shipping_paise: i64,
    handling_paise: i64,
    round_off_paise: i64,
) -> Result<(), AppError> {
    let lines = purchase_grn_lines(
        taxable_paise,
        cgst_paise,
        sgst_paise,
        igst_paise,
        shipping_paise,
        handling_paise,
        round_off_paise,
    )?;
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "purchase_grn",
        receipt_id,
        "Purchase goods receipt",
        lines,
    )
    .await
}

fn purchase_grn_lines(
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    shipping_paise: i64,
    handling_paise: i64,
    round_off_paise: i64,
) -> Result<Vec<JournalLine<'static>>, AppError> {
    let total_paise = taxable_paise
        .saturating_add(cgst_paise)
        .saturating_add(sgst_paise)
        .saturating_add(igst_paise)
        .saturating_add(shipping_paise)
        .saturating_add(handling_paise)
        .saturating_add(round_off_paise);
    if taxable_paise < 0
        || cgst_paise < 0
        || sgst_paise < 0
        || igst_paise < 0
        || shipping_paise < 0
        || handling_paise < 0
        || total_paise <= 0
    {
        return Err(AppError::validation("GRN accounting totals are invalid"));
    }
    let mut lines = vec![
        JournalLine {
            account_code: INVENTORY_ASSET_ACCOUNT,
            debit_paise: taxable_paise,
            credit_paise: 0,
        },
        JournalLine {
            account_code: "ACCOUNTS_PAYABLE",
            debit_paise: 0,
            credit_paise: total_paise,
        },
    ];
    if cgst_paise > 0 {
        lines.push(JournalLine {
            account_code: "INPUT_CGST",
            debit_paise: cgst_paise,
            credit_paise: 0,
        });
    }
    if sgst_paise > 0 {
        lines.push(JournalLine {
            account_code: "INPUT_SGST",
            debit_paise: sgst_paise,
            credit_paise: 0,
        });
    }
    if igst_paise > 0 {
        lines.push(JournalLine {
            account_code: "INPUT_IGST",
            debit_paise: igst_paise,
            credit_paise: 0,
        });
    }
    let commercial_charges = shipping_paise.saturating_add(handling_paise);
    if commercial_charges > 0 {
        lines.push(JournalLine {
            account_code: "OPERATING_EXPENSE",
            debit_paise: commercial_charges,
            credit_paise: 0,
        });
    }
    if round_off_paise > 0 {
        lines.push(JournalLine {
            account_code: "ROUNDING_EXPENSE",
            debit_paise: round_off_paise,
            credit_paise: 0,
        });
    } else if round_off_paise < 0 {
        lines.push(JournalLine {
            account_code: "ROUNDING_INCOME",
            debit_paise: 0,
            credit_paise: -round_off_paise,
        });
    }
    Ok(lines)
}

#[allow(clippy::too_many_arguments)]
pub async fn post_purchase_grn_backfill(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    receipt_id: &str,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
    business_date: NaiveDate,
    actor_user_id: &str,
) -> Result<Option<String>, AppError> {
    let total = taxable_paise
        .saturating_add(cgst_paise)
        .saturating_add(sgst_paise)
        .saturating_add(igst_paise);
    if taxable_paise < 0 || cgst_paise < 0 || sgst_paise < 0 || igst_paise < 0 || total == 0 {
        return Err(AppError::validation("GRN accounting totals are invalid"));
    }
    let mut lines = vec![
        ManualJournalLine {
            account_code: INVENTORY_ASSET_ACCOUNT.into(),
            debit_paise: taxable_paise,
            credit_paise: 0,
        },
        ManualJournalLine {
            account_code: "ACCOUNTS_PAYABLE".into(),
            debit_paise: 0,
            credit_paise: total,
        },
    ];
    for (account, amount) in [
        ("INPUT_CGST", cgst_paise),
        ("INPUT_SGST", sgst_paise),
        ("INPUT_IGST", igst_paise),
    ] {
        if amount > 0 {
            lines.push(ManualJournalLine {
                account_code: account.into(),
                debit_paise: amount,
                credit_paise: 0,
            });
        }
    }
    post_control_journal(
        tx,
        tenant_id,
        branch_id,
        "purchase_grn",
        receipt_id,
        business_date,
        "Migrated historical purchase bill",
        actor_user_id,
        &lines,
    )
    .await
}

pub async fn post_purchase_return(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    return_id: &str,
    taxable_paise: i64,
    cgst_paise: i64,
    sgst_paise: i64,
    igst_paise: i64,
) -> Result<(), AppError> {
    let tax_paise = cgst_paise
        .saturating_add(sgst_paise)
        .saturating_add(igst_paise);
    let total_paise = taxable_paise.saturating_add(tax_paise);
    if taxable_paise <= 0 || tax_paise < 0 {
        return Err(AppError::validation("purchase return totals are invalid"));
    }
    let mut lines = vec![
        JournalLine {
            account_code: "ACCOUNTS_PAYABLE",
            debit_paise: total_paise,
            credit_paise: 0,
        },
        JournalLine {
            account_code: INVENTORY_ASSET_ACCOUNT,
            debit_paise: 0,
            credit_paise: taxable_paise,
        },
    ];
    if cgst_paise > 0 {
        lines.push(JournalLine {
            account_code: "INPUT_CGST",
            debit_paise: 0,
            credit_paise: cgst_paise,
        });
    }
    if sgst_paise > 0 {
        lines.push(JournalLine {
            account_code: "INPUT_SGST",
            debit_paise: 0,
            credit_paise: sgst_paise,
        });
    }
    if igst_paise > 0 {
        lines.push(JournalLine {
            account_code: "INPUT_IGST",
            debit_paise: 0,
            credit_paise: igst_paise,
        });
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "purchase_return",
        return_id,
        "Purchase return",
        lines,
    )
    .await
}

pub async fn post_supplier_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    payment_id: &str,
    method: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("supplier payment amount is invalid"));
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "supplier_payment",
        payment_id,
        "Supplier payment",
        vec![
            JournalLine {
                account_code: "ACCOUNTS_PAYABLE",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: payment_account(method),
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

pub async fn post_supplier_advance(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    advance_id: &str,
    method: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("supplier advance amount is invalid"));
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "supplier_advance",
        advance_id,
        "Supplier advance",
        vec![
            JournalLine {
                account_code: "PREPAID_EXPENSES",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: payment_account(method),
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn post_staff_payroll_payout(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    run_id: &str,
    payout_id: &str,
    staff_id: &str,
    method: &str,
    gross_paise: i64,
    net_paise: i64,
) -> Result<(), AppError> {
    if gross_paise == 0 {
        return Ok(());
    }
    if gross_paise < 0 || net_paise < 0 || net_paise > gross_paise {
        return Err(AppError::validation("payroll payout amount is invalid"));
    }
    let withheld_paise = gross_paise - net_paise;
    let (employee_statutory_paise, employer_statutory_paise) = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COALESCE(SUM(employee_deduction_paise),0)::BIGINT,COALESCE(SUM(employer_contribution_paise + accrual_paise),0)::BIGINT FROM staff_payroll_statutory_calculations WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$4",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .bind(staff_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to calculate payroll statutory liability"))?;
    if employee_statutory_paise < 0 || employer_statutory_paise < 0 {
        return Err(AppError::validation(
            "payroll statutory liability is invalid",
        ));
    }
    // Advance recovery is a repayment of an existing asset (money already disbursed to the
    // staff member), not a new liability — it must reduce STAFF_ADVANCE_ASSET directly rather
    // than fold into PAYROLL_DEDUCTIONS_PAYABLE like statutory/manual withholding does.
    let advance_recovery_paise = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(recovered_paise),0)::BIGINT FROM staff_advance_recoveries WHERE tenant_id=$1 AND branch_id=$2 AND payroll_run_id=$3 AND staff_id=$4 AND applied=TRUE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(run_id)
    .bind(staff_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to calculate payroll advance recovery"))?;
    if advance_recovery_paise < 0 || advance_recovery_paise > withheld_paise {
        return Err(AppError::validation(
            "payroll advance recovery amount is invalid",
        ));
    }
    let payable_withheld_paise = payroll_deductions_payable(
        withheld_paise,
        employee_statutory_paise,
        advance_recovery_paise,
    )?;
    let mut lines = vec![
        JournalLine {
            account_code: "PAYROLL_EXPENSE",
            debit_paise: gross_paise,
            credit_paise: 0,
        },
        JournalLine {
            account_code: payment_account(method),
            debit_paise: 0,
            credit_paise: net_paise,
        },
    ];
    if payable_withheld_paise > 0 {
        lines.push(JournalLine {
            account_code: "PAYROLL_DEDUCTIONS_PAYABLE",
            debit_paise: 0,
            credit_paise: payable_withheld_paise,
        });
    }
    if advance_recovery_paise > 0 {
        lines.push(JournalLine {
            account_code: "STAFF_ADVANCE_ASSET",
            debit_paise: 0,
            credit_paise: advance_recovery_paise,
        });
    }
    if employer_statutory_paise > 0 {
        lines.push(JournalLine {
            account_code: "PAYROLL_STATUTORY_EXPENSE",
            debit_paise: employer_statutory_paise,
            credit_paise: 0,
        });
    }
    let statutory_payable_paise = employee_statutory_paise + employer_statutory_paise;
    if statutory_payable_paise > 0 {
        lines.push(JournalLine {
            account_code: "PAYROLL_STATUTORY_PAYABLE",
            debit_paise: 0,
            credit_paise: statutory_payable_paise,
        });
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "payroll_payout",
        payout_id,
        "Staff payroll payout",
        lines,
    )
    .await
}

fn payroll_deductions_payable(
    withheld_paise: i64,
    employee_statutory_paise: i64,
    advance_recovery_paise: i64,
) -> Result<i64, AppError> {
    withheld_paise
        .checked_sub(employee_statutory_paise)
        .and_then(|value| value.checked_sub(advance_recovery_paise))
        .filter(|value| *value >= 0)
        .ok_or_else(|| AppError::validation("payroll withholding breakdown is invalid"))
}

/// Disbursing a salary advance is never a salary expense — it moves cash into a receivable
/// (`STAFF_ADVANCE_ASSET`) that payroll recovery later credits back down.
pub async fn post_staff_advance_disbursement(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    advance_id: &str,
    method: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation(
            "advance disbursement amount is invalid",
        ));
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "staff_advance_disbursement",
        advance_id,
        "Staff salary advance disbursement",
        vec![
            JournalLine {
                account_code: "STAFF_ADVANCE_ASSET",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: payment_account(method),
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

/// Waiving/writing off the remaining outstanding balance of an advance removes it from the
/// books as a loss rather than salary expense.
pub async fn post_staff_advance_waiver(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    advance_id: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("advance waiver amount is invalid"));
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "staff_advance_waiver",
        advance_id,
        "Staff salary advance waiver/write-off",
        vec![
            JournalLine {
                account_code: "STAFF_ADVANCE_WRITEOFF_EXPENSE",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "STAFF_ADVANCE_ASSET",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

/// Posts a payroll correction against an already-paid run. The original payroll entries are
/// never edited — a correction is always a fresh, separate journal entry (a genuine reversal for
/// recoveries, an incremental expense for arrears), never a mutation of what was already posted.
///
/// - `arrear` (money owed to staff beyond what was already paid): debit `PAYROLL_EXPENSE`,
///   credit the payment account actually used to pay it out.
/// - `recovery` (money that should not have been paid): debit `ACCOUNTS_RECEIVABLE` (what the
///   staff member now owes back) and credit `PAYROLL_EXPENSE` (reversing the over-stated
///   expense) — a real reversal entry, not a cash movement, since recovery of the receivable is
///   a separate future event.
pub async fn post_payroll_correction(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    correction_id: &str,
    correction_type: &str,
    payment_method: Option<&str>,
    amount_paise: i64,
) -> Result<(), AppError> {
    if amount_paise <= 0 {
        return Err(AppError::validation("correction amount is invalid"));
    }
    let lines = match correction_type {
        "arrear" => {
            let method = payment_method
                .ok_or_else(|| AppError::validation("payment method is required for an arrear"))?;
            vec![
                JournalLine {
                    account_code: "PAYROLL_EXPENSE",
                    debit_paise: amount_paise,
                    credit_paise: 0,
                },
                JournalLine {
                    account_code: payment_account(method),
                    debit_paise: 0,
                    credit_paise: amount_paise,
                },
            ]
        }
        "recovery" => vec![
            JournalLine {
                account_code: "ACCOUNTS_RECEIVABLE",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "PAYROLL_EXPENSE",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
        _ => return Err(AppError::validation("correction type is invalid")),
    };
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "payroll_correction",
        correction_id,
        "Staff payroll correction",
        lines,
    )
    .await
}

pub async fn post_cogs(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let cost_paise = sqlx::query_scalar::<_, i64>(r#"SELECT (
        COALESCE((SELECT SUM(ABS(quantity_delta)::BIGINT*unit_cost_paise) FROM inventory_stock_ledger
          WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND movement_type='sale'),0)
        +COALESCE((SELECT SUM(actual_quantity::BIGINT*unit_cost_paise) FROM inventory_backbar_usage
          WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND status='recorded'),0)
        +COALESCE((SELECT SUM(ABS(event.quantity_delta)::BIGINT*COALESCE((event.metadata->>'unitCostPaise')::BIGINT,item.unit_cost_paise))
          FROM inventory_backbar_container_events event
          JOIN inventory_backbar_containers container ON container.id=event.container_id
            AND container.tenant_id=event.tenant_id AND container.branch_id=event.branch_id
          JOIN inventory_items item ON item.id=container.inventory_item_id
            AND item.tenant_id=container.tenant_id AND item.branch_id=container.branch_id
          WHERE event.tenant_id=$1 AND event.branch_id=$2 AND event.event_type='consumed'
            AND event.metadata->>'saleId'=$3),0)
      )::BIGINT"#)
        .bind(tenant_id).bind(branch_id).bind(sale_id).fetch_one(&mut **tx).await.map_err(|_| AppError::internal("failed to calculate COGS"))?;
    if cost_paise == 0 {
        return Ok(());
    }
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "cogs",
        sale_id,
        "POS inventory cost",
        vec![
            JournalLine {
                account_code: "COST_OF_GOODS_SOLD",
                debit_paise: cost_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: INVENTORY_ASSET_ACCOUNT,
                debit_paise: 0,
                credit_paise: cost_paise,
            },
        ],
    )
    .await
}

pub async fn post_customer_credit_change(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
    memo: &str,
    delta_paise: i64,
    offset_account: &str,
) -> Result<(), AppError> {
    let lines = customer_credit_lines(delta_paise, offset_account)?;
    post_entry(
        tx,
        tenant_id,
        branch_id,
        source_type,
        source_id,
        memo,
        lines,
    )
    .await
}

async fn post_entry(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
    memo: &str,
    lines: Vec<JournalLine<'_>>,
) -> Result<(), AppError> {
    write_entry(
        tx,
        tenant_id,
        branch_id,
        source_type,
        source_id,
        memo,
        None,
        None,
        lines,
    )
    .await
    .map(|_| ())
}

pub async fn post_manual_journal(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    business_date: NaiveDate,
    idempotency_key: &str,
    memo: &str,
    created_by_user_id: &str,
    lines: &[ManualJournalLine],
) -> Result<Option<String>, AppError> {
    let lines = lines
        .iter()
        .map(|line| JournalLine {
            account_code: &line.account_code,
            debit_paise: line.debit_paise,
            credit_paise: line.credit_paise,
        })
        .collect();
    write_entry(
        tx,
        tenant_id,
        branch_id,
        "manual_journal",
        idempotency_key,
        memo,
        Some(business_date),
        Some(created_by_user_id),
        lines,
    )
    .await
}

pub async fn post_control_journal(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
    business_date: NaiveDate,
    memo: &str,
    created_by_user_id: &str,
    lines: &[ManualJournalLine],
) -> Result<Option<String>, AppError> {
    let lines = lines
        .iter()
        .map(|line| JournalLine {
            account_code: &line.account_code,
            debit_paise: line.debit_paise,
            credit_paise: line.credit_paise,
        })
        .collect();
    write_entry(
        tx,
        tenant_id,
        branch_id,
        source_type,
        source_id,
        memo,
        Some(business_date),
        Some(created_by_user_id),
        lines,
    )
    .await
}

pub async fn reverse_journal(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    journal_entry_id: &str,
    reversal_source_id: &str,
    created_by_user_id: &str,
) -> Result<Option<String>, AppError> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM accounting_journal_entries WHERE tenant_id=$1 AND branch_id=$2 AND id=$3)",
    ).bind(tenant_id).bind(branch_id).bind(journal_entry_id).fetch_one(&mut **tx).await
     .map_err(|_| AppError::internal("failed to find journal for reversal"))?;
    if !exists {
        return Err(AppError::not_found("journal entry not found"));
    }
    let lines: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT account_code,debit_paise,credit_paise FROM accounting_journal_lines WHERE journal_entry_id=$1 ORDER BY id",
    ).bind(journal_entry_id).fetch_all(&mut **tx).await
     .map_err(|_| AppError::internal("failed to read journal lines for reversal"))?;
    let reversal = reverse_lines(lines);
    post_control_journal(
        tx,
        tenant_id,
        branch_id,
        "migration_rollback",
        reversal_source_id,
        Utc::now().date_naive(),
        "Migration rollback journal reversal",
        created_by_user_id,
        &reversal,
    )
    .await
}

fn reverse_lines(lines: Vec<(String, i64, i64)>) -> Vec<ManualJournalLine> {
    lines
        .into_iter()
        .map(
            |(account_code, debit_paise, credit_paise)| ManualJournalLine {
                account_code,
                debit_paise: credit_paise,
                credit_paise: debit_paise,
            },
        )
        .collect()
}

pub async fn post_royalty_accrual(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    statement_id: &str,
    business_date: NaiveDate,
    amount_paise: i64,
    created_by_user_id: &str,
) -> Result<Option<String>, AppError> {
    write_entry(
        tx,
        tenant_id,
        branch_id,
        "franchise_royalty_accrual",
        statement_id,
        "Franchise royalty accrual",
        Some(business_date),
        Some(created_by_user_id),
        vec![
            JournalLine {
                account_code: "OPERATING_EXPENSE",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "ACCRUED_EXPENSES",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

pub async fn post_royalty_payment(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    statement_id: &str,
    business_date: NaiveDate,
    amount_paise: i64,
    payment_method: &str,
    created_by_user_id: &str,
) -> Result<Option<String>, AppError> {
    write_entry(
        tx,
        tenant_id,
        branch_id,
        "franchise_royalty_payment",
        statement_id,
        "Franchise royalty payment",
        Some(business_date),
        Some(created_by_user_id),
        vec![
            JournalLine {
                account_code: "ACCRUED_EXPENSES",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: payment_account(payment_method),
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ],
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn write_entry(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    source_type: &str,
    source_id: &str,
    memo: &str,
    entry_date: Option<NaiveDate>,
    created_by_user_id: Option<&str>,
    lines: Vec<JournalLine<'_>>,
) -> Result<Option<String>, AppError> {
    if tenant_id.trim().is_empty() || branch_id.trim().is_empty() {
        return Err(AppError::validation(
            "tenant and branch are required for accounting journal entry",
        ));
    }
    if !is_balanced(&lines) {
        return Err(AppError::internal(
            "accounting journal entry is not balanced",
        ));
    }
    let entry_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO accounting_journal_entries (tenant_id,branch_id,source_type,source_id,memo,entry_date,created_by_user_id) VALUES ($1,$2,$3,$4,$5,COALESCE($6,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE),$7) ON CONFLICT (tenant_id,branch_id,source_type,source_id) DO NOTHING RETURNING id",
    )
    .bind(tenant_id).bind(branch_id).bind(source_type).bind(source_id).bind(memo).bind(entry_date).bind(created_by_user_id)
    .fetch_optional(&mut **tx).await
    .map_err(|error| {
        if error.as_database_error().is_some_and(|database_error| {
            database_error.code().as_deref() == Some("23514")
                && database_error.message().contains("accounting period is closed")
        }) {
            AppError::conflict("accounting period is closed")
        } else {
            AppError::internal("failed to write accounting journal entry")
        }
    })?;
    let Some(entry_id) = entry_id else {
        return Ok(None);
    };
    for line in lines
        .into_iter()
        .filter(|line| line.debit_paise > 0 || line.credit_paise > 0)
    {
        sqlx::query("INSERT INTO accounting_journal_lines (journal_entry_id, account_code, debit_paise, credit_paise) VALUES ($1,$2,$3,$4)")
            .bind(&entry_id).bind(line.account_code).bind(line.debit_paise).bind(line.credit_paise).execute(&mut **tx).await
            .map_err(|_| AppError::internal("failed to write accounting journal line"))?;
    }
    Ok(Some(entry_id))
}

async fn ensure_deferred_revenue_schedules(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO accounting_deferred_revenue_schedules (
          tenant_id,branch_id,sale_id,sale_line_id,source_type,source_item_id,
          total_paise,start_date,end_date
        )
        SELECT line.tenant_id,line.branch_id,line.sale_id,line.id,line.line_type,line.item_id,
               line.taxable_paise,sale.business_date,
               sale.business_date + (
                 GREATEST(CASE WHEN line.line_type='membership'
                   THEN COALESCE(membership.validity_days,1)
                   ELSE COALESCE(package.validity_days,1) END,1) - 1
               )
        FROM pos_sale_lines line
        JOIN pos_sales sale
          ON sale.id=line.sale_id AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
        LEFT JOIN memberships membership
          ON membership.id=line.item_id AND membership.tenant_id=line.tenant_id
         AND membership.branch_id=line.branch_id AND line.line_type='membership'
        LEFT JOIN packages package
          ON package.id=line.item_id AND package.tenant_id=line.tenant_id
         AND package.branch_id=line.branch_id AND line.line_type='package'
        WHERE line.tenant_id=$1 AND line.branch_id=$2 AND line.sale_id=$3
          AND line.line_type IN ('membership','package') AND line.taxable_paise>0
        ON CONFLICT (tenant_id,branch_id,sale_line_id) DO NOTHING
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(sale_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to create deferred revenue schedule"))?;
    Ok(())
}

fn is_balanced(lines: &[JournalLine<'_>]) -> bool {
    let totals = lines.iter().try_fold((0_i64, 0_i64), |totals, line| {
        if line.account_code.trim().is_empty()
            || line.debit_paise < 0
            || line.credit_paise < 0
            || (line.debit_paise > 0) == (line.credit_paise > 0)
        {
            return None;
        }
        Some((
            totals.0.checked_add(line.debit_paise)?,
            totals.1.checked_add(line.credit_paise)?,
        ))
    });
    matches!(totals, Some((debit, credit)) if debit > 0 && debit == credit)
}

fn customer_credit_lines<'a>(
    delta_paise: i64,
    offset_account: &'a str,
) -> Result<Vec<JournalLine<'a>>, AppError> {
    if delta_paise == 0 || offset_account.trim().is_empty() {
        return Err(AppError::validation(
            "customer credit accounting change is invalid",
        ));
    }
    let amount_paise = delta_paise
        .checked_abs()
        .ok_or_else(|| AppError::validation("customer credit amount exceeds supported range"))?;
    Ok(if delta_paise > 0 {
        vec![
            JournalLine {
                account_code: offset_account,
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "CUSTOMER_CREDIT_LIABILITY",
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ]
    } else {
        vec![
            JournalLine {
                account_code: "CUSTOMER_CREDIT_LIABILITY",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: offset_account,
                debit_paise: 0,
                credit_paise: amount_paise,
            },
        ]
    })
}

fn payment_account(method: &str) -> &'static str {
    match method.trim().to_ascii_lowercase().as_str() {
        "cash" => "CASH_ON_HAND",
        "wallet" | "store_credit" | "gift_card" | "booking_advance" => "CUSTOMER_CREDIT_LIABILITY",
        _ => "BANK_CLEARING",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        customer_credit_lines, invoice_correction_lines, is_balanced, payroll_deductions_payable,
        purchase_grn_lines, refund_journal_lines, reverse_lines, InvoiceAccountingTotals,
        JournalLine, RefundSettlement,
    };

    #[test]
    fn journal_requires_equal_debits_and_credits() {
        assert!(is_balanced(&[
            JournalLine {
                account_code: "AR",
                debit_paise: 11800,
                credit_paise: 0
            },
            JournalLine {
                account_code: "REVENUE",
                debit_paise: 0,
                credit_paise: 10000
            },
            JournalLine {
                account_code: "GST",
                debit_paise: 0,
                credit_paise: 1800
            },
        ]));
        assert!(!is_balanced(&[JournalLine {
            account_code: "AR",
            debit_paise: 100,
            credit_paise: 0
        }]));
        assert!(!is_balanced(&[JournalLine {
            account_code: "INVALID",
            debit_paise: 100,
            credit_paise: 100
        }]));
        assert!(!is_balanced(&[JournalLine {
            account_code: "INVALID",
            debit_paise: -100,
            credit_paise: 0
        }]));
    }

    #[test]
    fn purchase_grn_allows_signed_round_off_and_stays_balanced() {
        let lines = purchase_grn_lines(1_388_730, 124_986, 124_986, 0, 0, 0, -2)
            .expect("signed purchase round-off");
        assert!(is_balanced(&lines));
        assert!(lines.iter().any(|line| {
            line.account_code == "ACCOUNTS_PAYABLE" && line.credit_paise == 1_638_700
        }));
        assert!(lines
            .iter()
            .any(|line| { line.account_code == "ROUNDING_INCOME" && line.credit_paise == 2 }));
    }

    #[test]
    fn customer_credit_changes_keep_the_liability_balanced() {
        assert!(is_balanced(
            &customer_credit_lines(500, "BANK_CLEARING").unwrap()
        ));
        assert!(is_balanced(
            &customer_credit_lines(-500, "ACCOUNTS_RECEIVABLE").unwrap()
        ));
        assert!(customer_credit_lines(0, "BANK_CLEARING").is_err());
    }

    #[test]
    fn payroll_withholding_separates_statutory_and_advance_amounts() {
        assert_eq!(
            payroll_deductions_payable(50_000, 20_000, 10_000).unwrap(),
            20_000
        );
        assert!(payroll_deductions_payable(10_000, 8_000, 3_000).is_err());
    }

    #[test]
    fn refund_journal_credits_the_actual_settlement_accounts() {
        let lines = refund_journal_lines(&[
            RefundSettlement {
                method: "cash".into(),
                amount_paise: 1_000,
            },
            RefundSettlement {
                method: "card".into(),
                amount_paise: 500,
            },
        ])
        .unwrap();
        assert!(lines
            .iter()
            .any(|line| { line.account_code == "SALES_RETURNS" && line.debit_paise == 1_500 }));
        assert!(lines
            .iter()
            .any(|line| { line.account_code == "CASH_ON_HAND" && line.credit_paise == 1_000 }));
        assert!(lines
            .iter()
            .any(|line| { line.account_code == "BANK_CLEARING" && line.credit_paise == 500 }));
    }

    #[test]
    fn rollback_reversal_swaps_balanced_journal_sides() {
        let reversed = reverse_lines(vec![("AR".into(), 11800, 0), ("REVENUE".into(), 0, 11800)]);
        assert_eq!(
            (reversed[0].debit_paise, reversed[0].credit_paise),
            (0, 11800)
        );
        assert_eq!(
            (reversed[1].debit_paise, reversed[1].credit_paise),
            (11800, 0)
        );
    }

    #[test]
    fn invoice_correction_posts_only_a_balanced_delta() {
        let totals = |total_paise, tax_paise| InvoiceAccountingTotals {
            total_paise,
            tax_paise,
            cgst_paise: tax_paise / 2,
            sgst_paise: tax_paise / 2,
            igst_paise: 0,
            tip_paise: 0,
            round_off_paise: 0,
        };
        let lines = invoice_correction_lines(totals(11_800, 1_800), totals(9_440, 1_440))
            .expect("correction delta");
        assert_eq!(
            lines.iter().map(|line| line.debit_paise).sum::<i64>(),
            lines.iter().map(|line| line.credit_paise).sum::<i64>()
        );
        assert!(lines.iter().any(|line| {
            line.account_code == "ACCOUNTS_RECEIVABLE" && line.credit_paise == 2_360
        }));
    }
}
