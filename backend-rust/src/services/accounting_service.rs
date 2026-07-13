use sqlx::{Postgres, Transaction};

use crate::models::common::AppError;

struct JournalLine {
    account_code: &'static str,
    debit_paise: i64,
    credit_paise: i64,
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
    let revenue_paise = total_paise
        .saturating_sub(tax_paise)
        .saturating_sub(tip_paise)
        .saturating_sub(round_off_paise);
    if total_paise == 0 {
        return Ok(());
    }
    if total_paise < 0 || revenue_paise < 0 {
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
    let mut lines = vec![
        JournalLine {
            account_code: "ACCOUNTS_RECEIVABLE",
            debit_paise: total_paise,
            credit_paise: 0,
        },
        JournalLine {
            account_code: "SALES_REVENUE",
            debit_paise: 0,
            credit_paise: revenue_paise,
        },
    ];
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
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "invoice",
        sale_id,
        "POS invoice",
        lines,
    )
    .await
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

pub async fn post_refund(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    refund_id: &str,
    amount_paise: i64,
) -> Result<(), AppError> {
    post_entry(
        tx,
        tenant_id,
        branch_id,
        "refund",
        refund_id,
        "POS refund",
        vec![
            JournalLine {
                account_code: "SALES_RETURNS",
                debit_paise: amount_paise,
                credit_paise: 0,
            },
            JournalLine {
                account_code: "REFUND_CLEARING",
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
) -> Result<(), AppError> {
    let total_paise = taxable_paise
        .saturating_add(cgst_paise)
        .saturating_add(sgst_paise)
        .saturating_add(igst_paise);
    if taxable_paise < 0 || cgst_paise < 0 || sgst_paise < 0 || igst_paise < 0 || total_paise == 0 {
        return Err(AppError::validation("GRN accounting totals are invalid"));
    }
    let mut lines = vec![
        JournalLine {
            account_code: "INVENTORY_ASSET",
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

pub async fn post_cogs(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    sale_id: &str,
) -> Result<(), AppError> {
    let cost_paise = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(ABS(quantity_delta)::BIGINT * unit_cost_paise),0)::BIGINT FROM inventory_stock_ledger WHERE tenant_id=$1 AND branch_id=$2 AND sale_id=$3 AND movement_type='sale'")
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
                account_code: "INVENTORY_ASSET",
                debit_paise: 0,
                credit_paise: cost_paise,
            },
        ],
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
    lines: Vec<JournalLine>,
) -> Result<(), AppError> {
    if !is_balanced(&lines) {
        return Err(AppError::internal(
            "accounting journal entry is not balanced",
        ));
    }
    let entry_id = sqlx::query_scalar::<_, String>(
        "INSERT INTO accounting_journal_entries (tenant_id, branch_id, source_type, source_id, memo) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(tenant_id).bind(branch_id).bind(source_type).bind(source_id).bind(memo)
    .fetch_optional(&mut **tx).await
    .map_err(|_| AppError::internal("failed to write accounting journal entry"))?;
    let Some(entry_id) = entry_id else {
        return Ok(());
    };
    for line in lines
        .into_iter()
        .filter(|line| line.debit_paise > 0 || line.credit_paise > 0)
    {
        sqlx::query("INSERT INTO accounting_journal_lines (journal_entry_id, account_code, debit_paise, credit_paise) VALUES ($1,$2,$3,$4)")
            .bind(&entry_id).bind(line.account_code).bind(line.debit_paise).bind(line.credit_paise).execute(&mut **tx).await
            .map_err(|_| AppError::internal("failed to write accounting journal line"))?;
    }
    Ok(())
}

fn is_balanced(lines: &[JournalLine]) -> bool {
    let debit = lines.iter().map(|line| line.debit_paise).sum::<i64>();
    let credit = lines.iter().map(|line| line.credit_paise).sum::<i64>();
    debit > 0 && debit == credit
}

fn payment_account(method: &str) -> &'static str {
    match method {
        "cash" => "CASH_ON_HAND",
        "wallet" | "store_credit" | "gift_card" => "CUSTOMER_CREDIT_LIABILITY",
        _ => "BANK_CLEARING",
    }
}

#[cfg(test)]
mod tests {
    use super::{is_balanced, JournalLine};

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
    }
}
