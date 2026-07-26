use sqlx::{Postgres, Transaction};

#[derive(Clone, Copy)]
pub enum BusinessCodeKind {
    Client,
    CorporateAccount,
    CostCenter,
    FixedAsset,
    Membership,
    PosTerminal,
    Supplier,
}

impl BusinessCodeKind {
    fn config(self) -> (&'static str, &'static str, &'static str, usize) {
        match self {
            Self::Client => ("clients", "code", "CLI-", 6),
            Self::CorporateAccount => ("corporate_billing_accounts", "account_code", "CORP-", 4),
            Self::CostCenter => ("accounting_cost_centers", "code", "CC_", 4),
            Self::FixedAsset => ("accounting_fixed_assets", "asset_code", "AST_", 4),
            Self::Membership => ("memberships", "code", "MEM-", 4),
            Self::PosTerminal => ("pos_terminals", "terminal_code", "POS-", 3),
            Self::Supplier => ("suppliers", "code", "SUP-", 4),
        }
    }
}

pub async fn next_branch_code(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    kind: BusinessCodeKind,
) -> Result<String, sqlx::Error> {
    let (table, column, prefix, width) = kind.config();
    let lock_key = format!("business-code:{tenant_id}:{branch_id}:{table}:{column}");
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(lock_key)
        .execute(&mut **tx)
        .await?;

    // Table and column names come only from BusinessCodeKind above.
    let query = format!(
        "SELECT COALESCE(MAX(substring({column} FROM $3)::BIGINT), 0) + 1 \
         FROM {table} WHERE tenant_id=$1 AND branch_id=$2"
    );
    let pattern = format!(r"^{}([0-9]{{1,18}})$", regex_escape(prefix));
    let next = sqlx::query_scalar::<_, i64>(&query)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(pattern)
        .fetch_one(&mut **tx)
        .await?;

    Ok(format!("{prefix}{next:0width$}"))
}

fn regex_escape(value: &str) -> String {
    value
        .chars()
        .flat_map(|ch| match ch {
            '.' | '+' | '*' | '?' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\' => {
                vec!['\\', ch]
            }
            _ => vec![ch],
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn business_code_formats_are_stable() {
        assert_eq!(BusinessCodeKind::Client.config().2, "CLI-");
        assert_eq!(
            format!("{}{:04}", BusinessCodeKind::Supplier.config().2, 12),
            "SUP-0012"
        );
        assert_eq!(regex_escape("CC_"), "CC_");
    }
}
