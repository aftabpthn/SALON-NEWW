use chrono::{Datelike, NaiveDate};
use sqlx::{Postgres, Transaction};

use crate::models::common::AppError;

pub struct InvoiceNumberAllocation {
    pub sequence_id: String,
    pub fiscal_year: String,
    pub invoice_number: String,
}

pub async fn allocate(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    invoice_type: &str,
    business_date: NaiveDate,
) -> Result<InvoiceNumberAllocation, AppError> {
    let invoice_type = normalized_invoice_type(invoice_type)?;
    let fiscal_year = fiscal_year(business_date);
    let default_prefix = sqlx::query_scalar::<_, String>(
        "SELECT prefix FROM pos_invoice_number_sequences WHERE tenant_id=$1 AND branch_id=$2 AND invoice_type=$3 AND fiscal_year='legacy' AND prefix<>'' ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&invoice_type)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to read invoice number prefix"))?
    .map(|prefix| normalized_prefix(&prefix, default_prefix(&invoice_type)))
    .unwrap_or_else(|| default_prefix(&invoice_type).to_string());
    let (sequence_id, prefix, number) = sqlx::query_as::<_, (String, String, i64)>(
        r#"
        INSERT INTO pos_invoice_number_sequences (
          tenant_id, branch_id, invoice_type, fiscal_year, prefix, next_number, reset_period, last_reset_date
        ) VALUES ($1,$2,$3,$4,$5,2,'yearly',$6)
        ON CONFLICT (tenant_id, branch_id, invoice_type, fiscal_year)
        DO UPDATE SET next_number=pos_invoice_number_sequences.next_number + 1,
                      last_reset_date=EXCLUDED.last_reset_date,
                      updated_at=NOW()
        RETURNING id, prefix, next_number - 1
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(&invoice_type)
    .bind(&fiscal_year)
    .bind(&default_prefix)
    .bind(business_date)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::internal("failed to allocate fiscal invoice number"))?;
    let prefix = normalized_prefix(&prefix, &default_prefix);
    Ok(InvoiceNumberAllocation {
        sequence_id,
        fiscal_year: fiscal_year.clone(),
        invoice_number: format!("{prefix}/{fiscal_year}/{number:06}"),
    })
}

pub fn fiscal_year(date: NaiveDate) -> String {
    let start = if date.month() >= 4 {
        date.year()
    } else {
        date.year() - 1
    };
    format!("{start:04}-{:02}", (start + 1).rem_euclid(100))
}

fn normalized_invoice_type(raw: &str) -> Result<String, AppError> {
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 40
        || !value
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
    {
        return Err(AppError::validation(
            "invoiceType must contain lowercase letters, digits, or underscores",
        ));
    }
    Ok(value)
}

fn default_prefix(invoice_type: &str) -> &'static str {
    match invoice_type {
        "tax_invoice" => "TAX",
        "proforma" => "PRO",
        "retail_invoice" => "RET",
        "credit_note" => "CRN",
        _ => "INV",
    }
}

fn normalized_prefix(raw: &str, fallback: &str) -> String {
    let prefix = raw.trim().to_ascii_uppercase();
    if !prefix.is_empty()
        && prefix.len() <= 20
        && prefix
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == '-' || ch == '_')
    {
        prefix
    } else {
        fallback.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::fiscal_year;
    use chrono::NaiveDate;

    #[test]
    fn india_fiscal_year_changes_on_first_april() {
        assert_eq!(
            fiscal_year(NaiveDate::from_ymd_opt(2027, 3, 31).unwrap()),
            "2026-27"
        );
        assert_eq!(
            fiscal_year(NaiveDate::from_ymd_opt(2027, 4, 1).unwrap()),
            "2027-28"
        );
    }
}
