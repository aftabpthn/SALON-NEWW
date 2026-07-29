use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow)]
pub struct RevenuePointRecord {
    pub business_date: NaiveDate,
    pub value_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProfitLedgerRecord {
    pub source_type: String,
    pub account_code: String,
    pub cost_center_code: Option<String>,
    pub debit_paise: i64,
    pub credit_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProfitDimensionRecord {
    pub dimension: String,
    pub entity_id: String,
    pub entity_name: String,
    pub unit_count: i64,
    pub revenue_paise: i64,
    pub discount_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct MicroProfitLineRecord {
    pub branch_id: String,
    pub branch_name: String,
    pub first_event_date: NaiveDate,
    pub last_event_date: NaiveDate,
    pub sale_id: String,
    pub sale_line_id: String,
    pub invoice_number: String,
    pub reference_id: String,
    pub appointment_id: String,
    pub appointment_name: String,
    pub channel: String,
    pub journal_entry_id: String,
    pub inventory_movement_ids: Vec<String>,
    pub line_type: String,
    pub item_id: String,
    pub item_name: String,
    pub item_category: String,
    pub unit_count: i64,
    pub discount_paise: i64,
    pub staff_id: String,
    pub staff_name: String,
    pub client_id: String,
    pub client_name: String,
    pub recognized_revenue_paise: i64,
    pub product_cost_paise: i64,
    pub staff_cost_paise: i64,
    pub staff_time_cost_paise: i64,
    pub gateway_fee_paise: i64,
    pub refund_fee_paise: i64,
    pub overhead_cost_paise: i64,
    pub product_cost_status: String,
    pub staff_cost_status: String,
    pub staff_time_cost_status: String,
    pub gateway_fee_status: String,
    pub refund_fee_status: String,
    pub overhead_status: String,
    pub missing_invoice_journal: bool,
    pub event_count: i64,
    pub total_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct MicroProfitReconciliationRecord {
    pub ledger_revenue_paise: i64,
    pub micro_revenue_paise: i64,
    pub missing_invoice_journal_paise: i64,
    pub ledger_cogs_paise: i64,
    pub micro_product_cost_paise: i64,
    pub ledger_payroll_paise: i64,
    pub payroll_source_paise: i64,
    pub rounding_bridge_paise: i64,
    pub reportable_line_count: i64,
    pub complete_line_count: i64,
    pub cost_complete_line_count: i64,
    pub missing_invoice_journal_count: i64,
    pub missing_product_cost_line_count: i64,
    pub missing_staff_cost_line_count: i64,
    pub missing_staff_time_cost_line_count: i64,
    pub missing_gateway_fee_line_count: i64,
    pub missing_refund_fee_line_count: i64,
    pub allocation_rule_count: i64,
    pub unallocated_overhead_paise: i64,
}

#[derive(Debug, Clone)]
pub struct ProfitCopilotVersionInsert<'a> {
    pub tenant_id: &'a str,
    pub branch_ids: &'a [String],
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub recommendation_key: &'a str,
    pub fact_schema_version: &'a str,
    pub fact_hash: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub kind: &'a str,
    pub title: &'a str,
    pub message: &'a str,
    pub impact_paise: i64,
    pub source_type: &'a str,
    pub source_id: &'a str,
    pub evaluation_status: &'a str,
    pub evaluation_json: &'a Value,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProfitCopilotFeedbackRecord {
    pub id: String,
    pub recommendation_version_id: String,
    pub decision: String,
    pub comment: String,
    pub actor_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct InvoiceJournalRepairRecord {
    pub branch_id: String,
    pub sale_id: String,
    pub invoice_number: String,
    pub business_date: NaiveDate,
    pub total_paise: i64,
    pub tax_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub tip_paise: i64,
    pub round_off_paise: i64,
    pub period_status: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct MicroProfitAllocationRuleRecord {
    pub id: String,
    pub name: String,
    pub version: i32,
    pub driver: String,
    pub account_codes: Vec<String>,
    pub effective_from: NaiveDate,
    pub effective_to: Option<NaiveDate>,
    pub created_by_user_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct RecipeVarianceRecord {
    pub service_id: String,
    pub service_name: String,
    pub sold_quantity: i64,
    pub recipe_item_count: i64,
    pub expected_cost_paise: i64,
    pub actual_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProfitBookingDemandRecord {
    pub service_id: String,
    pub service_name: String,
    pub local_hour: i32,
    pub appointment_count: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProfitLiabilityRecord {
    pub source_type: String,
    pub source_item_id: String,
    pub plan_name: String,
    pub sold_value_paise: i64,
    pub recognized_value_paise: i64,
    pub remaining_liability_paise: i64,
    pub redeemed_value_paise: i64,
    pub redeemed_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct DailyProfitRecord {
    pub business_date: NaiveDate,
    pub revenue_paise: i64,
    pub direct_cost_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct PivotCellRecord {
    pub row_key: String,
    pub column_key: String,
    pub value: i64,
}

#[derive(Debug, Clone, FromRow)]
pub struct CustomReportRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub name: String,
    pub definition_json: Value,
    pub schedule_frequency: String,
    pub schedule_day: i16,
    pub schedule_time: NaiveTime,
    pub recipient_email: String,
    pub next_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_status: String,
    pub last_error: String,
    pub consecutive_failures: i32,
    pub active: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn daily_revenue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i32,
) -> Result<Vec<RevenuePointRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH bounds AS (
          SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE AS today
        ), days AS (
          SELECT generate_series(
            bounds.today - ($3::INT - 1),
            bounds.today,
            INTERVAL '1 day'
          )::DATE AS business_date
          FROM bounds
        )
        SELECT days.business_date,
               COALESCE(SUM(sale.total_paise), 0)::BIGINT AS value_paise
        FROM days
        LEFT JOIN pos_sales sale
          ON sale.tenant_id=$1
         AND sale.branch_id=$2
         AND (COALESCE(sale.finalized_at, sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE=days.business_date
         AND sale.status NOT IN ('draft','voided','cancelled','refunded')
        GROUP BY days.business_date
        ORDER BY days.business_date
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(days)
    .fetch_all(db)
    .await
}

pub async fn profit_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<ProfitLedgerRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT entry.source_type,
               line.account_code,
               center.code AS cost_center_code,
               COALESCE(SUM(line.debit_paise), 0)::BIGINT AS debit_paise,
               COALESCE(SUM(line.credit_paise), 0)::BIGINT AS credit_paise
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
          AND entry.branch_id=ANY($2::TEXT[])
          AND entry.entry_date BETWEEN $3 AND $4
        GROUP BY entry.source_type, line.account_code, center.code
        ORDER BY entry.source_type, line.account_code, center.code
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .fetch_all(db)
    .await
}

pub async fn profit_dimensions(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<ProfitDimensionRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH cogs AS (
          SELECT sale_line_id,
                 COALESCE(SUM(CASE
                   WHEN movement_type='sale' THEN ABS(quantity_delta)::BIGINT * unit_cost_paise
                   WHEN movement_type='return' THEN -ABS(quantity_delta)::BIGINT * unit_cost_paise
                   ELSE 0 END),0)::BIGINT AS product_cost_paise
          FROM inventory_stock_ledger
          WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
          GROUP BY sale_line_id
        ), commission AS (
          SELECT sale_line_id, COALESCE(SUM(commission_paise),0)::BIGINT AS staff_cost_paise
          FROM pos_staff_commission_snapshots
          WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
          GROUP BY sale_line_id
        ), base AS (
          SELECT line.id, line.line_type, line.item_id, line.item_name, line.quantity,
                 sale.branch_id, sale.client_id,
                 COALESCE(NULLIF(line.staff_id,''), NULLIF(sale.staff_id,''), '') AS staff_id,
                 CASE WHEN line.gross_paise > 0 OR line.taxable_paise > 0
                   THEN line.taxable_paise
                   ELSE GREATEST(line.line_total_paise-line.gst_paise,0) END::BIGINT AS revenue_paise,
                 line.discount_paise,
                 COALESCE(cogs.product_cost_paise,0)::BIGINT AS product_cost_paise,
                 COALESCE(commission.staff_cost_paise,0)::BIGINT AS staff_cost_paise
          FROM pos_sale_lines line
          JOIN pos_sales sale ON sale.id=line.sale_id
            AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
          LEFT JOIN cogs ON cogs.sale_line_id=line.id
          LEFT JOIN commission ON commission.sale_line_id=line.id
          WHERE line.tenant_id=$1 AND line.branch_id=ANY($2::TEXT[])
            AND sale.status NOT IN ('draft','open','voided','cancelled')
            AND sale.business_date BETWEEN $3 AND $4
        ), dimensions AS (
          SELECT 'service'::TEXT AS dimension, base.item_id AS entity_id,
                 COALESCE(service.name,base.item_name) AS entity_name,
                 SUM(base.quantity)::BIGINT AS unit_count,
                 SUM(base.revenue_paise)::BIGINT AS revenue_paise,
                 SUM(base.discount_paise)::BIGINT AS discount_paise,
                 SUM(base.product_cost_paise)::BIGINT AS product_cost_paise,
                 SUM(base.staff_cost_paise)::BIGINT AS staff_cost_paise
          FROM base
          LEFT JOIN services service ON service.id=base.item_id
            AND service.tenant_id=$1 AND service.branch_id=base.branch_id
          WHERE base.line_type='service'
          GROUP BY base.item_id, COALESCE(service.name,base.item_name)
          UNION ALL
          SELECT 'staff', COALESCE(NULLIF(base.staff_id,''),'unassigned'),
                 COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.middle_name,''),NULLIF(staff.last_name,''))),''),'Unassigned'),
                 SUM(base.quantity)::BIGINT, SUM(base.revenue_paise)::BIGINT,
                 SUM(base.discount_paise)::BIGINT, SUM(base.product_cost_paise)::BIGINT,
                 SUM(base.staff_cost_paise)::BIGINT
          FROM base
          LEFT JOIN staff ON staff.id=base.staff_id AND staff.tenant_id=$1 AND staff.branch_id=base.branch_id
          GROUP BY COALESCE(NULLIF(base.staff_id,''),'unassigned'),
                   COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.middle_name,''),NULLIF(staff.last_name,''))),''),'Unassigned')
          UNION ALL
          SELECT 'customer', COALESCE(NULLIF(base.client_id,''),'walk_in'),
                 COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,NULLIF(client.last_name,''))),''),'Walk-in'),
                 SUM(base.quantity)::BIGINT, SUM(base.revenue_paise)::BIGINT,
                 SUM(base.discount_paise)::BIGINT, SUM(base.product_cost_paise)::BIGINT,
                 SUM(base.staff_cost_paise)::BIGINT
          FROM base
          LEFT JOIN clients client ON client.id=base.client_id AND client.tenant_id=$1 AND client.branch_id=base.branch_id
          GROUP BY COALESCE(NULLIF(base.client_id,''),'walk_in'),
                   COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,NULLIF(client.last_name,''))),''),'Walk-in')
          UNION ALL
          SELECT 'branch', COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT), branch.name,
                 COALESCE(SUM(base.quantity),0)::BIGINT,
                 COALESCE(SUM(base.revenue_paise),0)::BIGINT,
                 COALESCE(SUM(base.discount_paise),0)::BIGINT,
                 COALESCE(SUM(base.product_cost_paise),0)::BIGINT,
                 COALESCE(SUM(base.staff_cost_paise),0)::BIGINT
          FROM branches branch
          JOIN tenants tenant ON tenant.id=branch.tenant_id
          LEFT JOIN base
            ON base.branch_id=COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)
          WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
            AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=ANY($2::TEXT[])
          GROUP BY COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT), branch.name
        )
        SELECT dimension, entity_id, entity_name, unit_count, revenue_paise,
               discount_paise, product_cost_paise, staff_cost_paise
        FROM dimensions
        ORDER BY dimension, (revenue_paise-product_cost_paise-staff_cost_paise) DESC, entity_name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .fetch_all(db)
    .await
}

pub async fn recipe_variance(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<RecipeVarianceRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH recipe_unit AS (
          SELECT service.id AS service_id,
                 COUNT(item.id)::BIGINT AS recipe_item_count,
                 COALESCE(ROUND(SUM(item.unit_cost_paise * CASE
                   WHEN COALESCE(recipe->>'standardQty',recipe->>'quantity',recipe->>'qty','') ~ '^[0-9]+(\.[0-9]+)?$'
                   THEN COALESCE(recipe->>'standardQty',recipe->>'quantity',recipe->>'qty')::NUMERIC
                   ELSE 0 END)),0)::BIGINT AS expected_unit_cost_paise
          FROM services service
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(service.product_consumption_json,'[]'::JSONB)) recipe ON TRUE
          LEFT JOIN inventory_items item ON item.tenant_id=service.tenant_id
            AND item.branch_id=service.branch_id
            AND item.id=COALESCE(recipe->>'itemId',recipe->>'productId',recipe->>'inventoryItemId')
          WHERE service.tenant_id=$1 AND service.branch_id=ANY($2::TEXT[])
          GROUP BY service.id
        ), actual_line AS (
          SELECT sale_line_id,
                 COALESCE(SUM(CASE
                   WHEN movement_type='sale' THEN ABS(quantity_delta)::BIGINT * unit_cost_paise
                   WHEN movement_type='return' THEN -ABS(quantity_delta)::BIGINT * unit_cost_paise
                   ELSE 0 END),0)::BIGINT AS actual_cost_paise
          FROM inventory_stock_ledger
          WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
          GROUP BY sale_line_id
        )
        SELECT line.item_id AS service_id,
               COALESCE(service.name,line.item_name) AS service_name,
               SUM(line.quantity)::BIGINT AS sold_quantity,
               MAX(COALESCE(recipe_unit.recipe_item_count,0))::BIGINT AS recipe_item_count,
               SUM(line.quantity * COALESCE(recipe_unit.expected_unit_cost_paise,0))::BIGINT AS expected_cost_paise,
               SUM(COALESCE(actual_line.actual_cost_paise,0))::BIGINT AS actual_cost_paise
        FROM pos_sale_lines line
        JOIN pos_sales sale ON sale.id=line.sale_id
          AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
        LEFT JOIN services service ON service.id=line.item_id
          AND service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
        LEFT JOIN recipe_unit ON recipe_unit.service_id=line.item_id
        LEFT JOIN actual_line ON actual_line.sale_line_id=line.id
        WHERE line.tenant_id=$1 AND line.branch_id=ANY($2::TEXT[]) AND line.line_type='service'
          AND sale.status NOT IN ('draft','open','voided','cancelled')
          AND sale.business_date BETWEEN $3 AND $4
        GROUP BY line.item_id, COALESCE(service.name,line.item_name)
        HAVING MAX(COALESCE(recipe_unit.recipe_item_count,0)) > 0
            OR SUM(COALESCE(actual_line.actual_cost_paise,0)) <> 0
        ORDER BY (SUM(COALESCE(actual_line.actual_cost_paise,0)) - SUM(line.quantity * COALESCE(recipe_unit.expected_unit_cost_paise,0))) DESC
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .fetch_all(db)
    .await
}

pub async fn profit_booking_demand(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<ProfitBookingDemandRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT selected.service_id,
               COALESCE(NULLIF(service.name,''),selected.service_id) AS service_name,
               EXTRACT(HOUR FROM appointment.start_at AT TIME ZONE 'Asia/Kolkata')::INT AS local_hour,
               COUNT(*)::BIGINT AS appointment_count
          FROM appointments appointment
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB)='array'
                 THEN COALESCE(NULLIF(appointment.service_ids_json,''),'[]')::JSONB ELSE '[]'::JSONB END
          ) selected(service_id)
          LEFT JOIN services service ON service.tenant_id=appointment.tenant_id
           AND service.branch_id=appointment.branch_id AND service.id=selected.service_id
         WHERE appointment.tenant_id=$1 AND appointment.branch_id=ANY($2::TEXT[])
           AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
           AND LOWER(appointment.status) NOT IN ('cancelled','canceled','no-show','voided')
         GROUP BY selected.service_id,COALESCE(NULLIF(service.name,''),selected.service_id),
                  EXTRACT(HOUR FROM appointment.start_at AT TIME ZONE 'Asia/Kolkata')
         ORDER BY selected.service_id,appointment_count DESC,local_hour
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .fetch_all(db)
    .await
}

pub async fn profit_liability_exposure(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    to_date: NaiveDate,
) -> Result<Vec<ProfitLiabilityRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH exposure AS (
          SELECT source_type,source_item_id,
                 SUM(total_paise)::BIGINT AS sold_value_paise,
                 SUM(recognized_paise)::BIGINT AS recognized_value_paise,
                 SUM(total_paise-recognized_paise)::BIGINT AS remaining_liability_paise
            FROM accounting_deferred_revenue_schedules
           WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND start_date<=$3
           GROUP BY source_type,source_item_id
        ), redemption_lines AS (
          SELECT 'package'::TEXT AS source_type,redemption.package_id AS source_item_id,
                 redemption.package_name AS plan_name,line.id AS sale_line_id
            FROM pos_package_redemptions redemption
            JOIN LATERAL (
              SELECT sale_line.id FROM pos_sale_lines sale_line
               WHERE sale_line.tenant_id=redemption.tenant_id
                 AND sale_line.branch_id=redemption.branch_id AND sale_line.sale_id=redemption.sale_id
                 AND sale_line.line_type='package_redeem'
                 AND sale_line.item_id=redemption.client_package_credit_id
               ORDER BY sale_line.created_at,sale_line.id LIMIT 1
            ) line ON TRUE
           WHERE redemption.tenant_id=$1 AND redemption.branch_id=ANY($2::TEXT[])
          UNION ALL
          SELECT 'membership',redemption.membership_id,redemption.membership_name,line.id
            FROM pos_membership_redemptions redemption
            JOIN LATERAL (
              SELECT sale_line.id FROM pos_sale_lines sale_line
               WHERE sale_line.tenant_id=redemption.tenant_id
                 AND sale_line.branch_id=redemption.branch_id AND sale_line.sale_id=redemption.sale_id
                 AND sale_line.line_type='membership_redeem'
                 AND sale_line.item_id=redemption.client_membership_credit_id
               ORDER BY sale_line.created_at,sale_line.id LIMIT 1
            ) line ON TRUE
           WHERE redemption.tenant_id=$1 AND redemption.branch_id=ANY($2::TEXT[])
        ), redemption AS (
          SELECT line.source_type,line.source_item_id,MAX(line.plan_name) AS plan_name,
                 COALESCE(SUM(event.recognized_revenue_paise),0)::BIGINT AS redeemed_value_paise,
                 COALESCE(SUM(event.product_cost_paise+event.staff_cost_paise),0)::BIGINT AS redeemed_cost_paise
            FROM redemption_lines line
            LEFT JOIN micro_profit_events event ON event.tenant_id=$1
             AND event.branch_id=ANY($2::TEXT[]) AND event.sale_line_id=line.sale_line_id
           GROUP BY line.source_type,line.source_item_id
        )
        SELECT exposure.source_type,exposure.source_item_id,
               COALESCE(NULLIF(redemption.plan_name,''),NULLIF(package.name,''),
                        NULLIF(membership.name,''),exposure.source_item_id) AS plan_name,
               exposure.sold_value_paise,exposure.recognized_value_paise,
               exposure.remaining_liability_paise,
               COALESCE(redemption.redeemed_value_paise,0)::BIGINT AS redeemed_value_paise,
               COALESCE(redemption.redeemed_cost_paise,0)::BIGINT AS redeemed_cost_paise
          FROM exposure
          LEFT JOIN redemption USING(source_type,source_item_id)
          LEFT JOIN packages package ON exposure.source_type='package'
           AND package.tenant_id=$1 AND package.id=exposure.source_item_id
          LEFT JOIN memberships membership ON exposure.source_type='membership'
           AND membership.tenant_id=$1 AND membership.id=exposure.source_item_id
         ORDER BY exposure.remaining_liability_paise DESC,plan_name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(to_date)
    .fetch_all(db)
    .await
}

pub async fn daily_micro_profit(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<DailyProfitRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT business_date,SUM(recognized_revenue_paise)::BIGINT AS revenue_paise,
               SUM(product_cost_paise+staff_cost_paise+staff_time_cost_paise
                   +gateway_fee_paise+refund_fee_paise)::BIGINT AS direct_cost_paise
          FROM micro_profit_daily_rollup
         WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[]) AND business_date BETWEEN $3 AND $4
         GROUP BY business_date
         ORDER BY business_date
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .fetch_all(db)
    .await
}

pub async fn ensure_micro_profit_daily_rollup(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT refresh_micro_profit_daily_rollup($1,$2::TEXT[],$3,$4)")
        .bind(tenant_id)
        .bind(branch_ids.to_vec())
        .bind(from_date)
        .bind(to_date)
        .fetch_one(db)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn micro_profit_lines(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
    limit: i64,
    offset: i64,
    dimension: &str,
    entity_id: &str,
) -> Result<Vec<MicroProfitLineRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH aggregated AS (
          SELECT tenant_id,branch_id,sale_id,sale_line_id,
                 MIN(business_date) AS first_event_date,MAX(business_date) AS last_event_date,
                 SUM(recognized_revenue_paise)::BIGINT AS recognized_revenue_paise,
                 SUM(product_cost_paise)::BIGINT AS product_cost_paise,
                 SUM(staff_cost_paise)::BIGINT AS staff_cost_paise,
                 SUM(staff_time_cost_paise)::BIGINT AS staff_time_cost_paise,
                 SUM(gateway_fee_paise)::BIGINT AS gateway_fee_paise,
                 SUM(refund_fee_paise)::BIGINT AS refund_fee_paise,
                 BOOL_OR(has_staff_time_cost) AS has_staff_time_cost,
                 BOOL_OR(has_gateway_fee) AS has_gateway_fee,
                 BOOL_OR(has_refund_fee) AS has_refund_fee,
                 SUM(event_count)::BIGINT AS event_count
            FROM micro_profit_daily_rollup
           WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
             AND business_date BETWEEN $3 AND $4
           GROUP BY tenant_id,branch_id,sale_id,sale_line_id
        ), facts AS (
          SELECT aggregated.*,
                 COALESCE(branch.name,sale.branch_id) AS branch_name,
                 sale.invoice_number,
                 COALESCE(sale.reference_id,'') AS reference_id,
                 COALESCE(appointment.id,'') AS appointment_id,
                 CASE WHEN appointment.id IS NULL THEN 'Direct sale'
                      ELSE CONCAT('Appointment ',appointment.id) END AS appointment_name,
                 COALESCE(NULLIF(appointment.source_channel,''),NULLIF(sale.source,''),'pos') AS channel,
                 COALESCE((SELECT entry.id FROM accounting_journal_entries entry
                            WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id
                              AND entry.source_type='invoice' AND entry.source_id=sale.id
                            ORDER BY entry.created_at,entry.id LIMIT 1),'') AS journal_entry_id,
                 COALESCE(ARRAY(SELECT stock.id FROM inventory_stock_ledger stock
                                 WHERE stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
                                   AND stock.sale_line_id=line.id
                                 ORDER BY stock.created_at,stock.id),ARRAY[]::TEXT[]) AS inventory_movement_ids,
                 line.line_type,COALESCE(service.id,line.item_id) AS item_id,
                 COALESCE(NULLIF(service.name,''),line.item_name) AS item_name,
                 COALESCE(NULLIF(service.category,''),'Uncategorized') AS item_category,
                 line.quantity::BIGINT AS unit_count,
                 line.discount_paise,
                 COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),'') AS staff_id,
                 COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,NULLIF(staff.middle_name,''),NULLIF(staff.last_name,''))),''),'Unassigned') AS staff_name,
                 COALESCE(sale.client_id,'') AS client_id,
                 COALESCE(NULLIF(TRIM(CONCAT_WS(' ',client.first_name,NULLIF(client.last_name,''))),''),'Walk-in') AS client_name,
                 COALESCE(service.duration_minutes,0)::BIGINT*GREATEST(line.quantity,1) AS service_minutes,
                  CASE WHEN appointment.chair_room_id IS NOT NULL THEN
                    COALESCE(service.duration_minutes,0)::BIGINT*GREATEST(line.quantity,1)
                    ELSE 0 END AS chair_resource_minutes,
                 (line.line_type='product' OR
                   (line.line_type='service' AND
                    jsonb_typeof(COALESCE(service.product_consumption_json,'[]'::JSONB))='array' AND
                    jsonb_array_length(COALESCE(service.product_consumption_json,'[]'::JSONB))>0)) AS requires_product_cost,
                 (COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),'')<>'' OR
                   (jsonb_typeof(COALESCE(line.staff_splits,'[]'::JSONB))='array' AND
                    jsonb_array_length(COALESCE(line.staff_splits,'[]'::JSONB))>0)) AS requires_staff_cost,
                 EXISTS (
                   SELECT 1 FROM inventory_stock_ledger stock
                    WHERE stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
                      AND stock.sale_line_id=line.id AND stock.movement_type='sale'
                 ) AS has_product_cost,
                 EXISTS (
                   SELECT 1 FROM pos_staff_commission_snapshots commission
                    WHERE commission.tenant_id=line.tenant_id AND commission.branch_id=line.branch_id
                      AND commission.sale_line_id=line.id
                 ) AS has_staff_cost,
                 EXISTS (
                   SELECT 1 FROM pos_payments payment
                    WHERE payment.tenant_id=sale.tenant_id AND payment.branch_id=sale.branch_id
                      AND payment.sale_id=sale.id
                      AND LOWER(payment.method) NOT IN ('cash','wallet','store_credit','gift_card')
                 ) AS requires_gateway_fee,
                 EXISTS (
                   SELECT 1 FROM pos_gateway_refunds gateway
                    WHERE gateway.tenant_id=sale.tenant_id AND gateway.branch_id=sale.branch_id
                      AND gateway.sale_id=sale.id AND gateway.status IN ('pending','processed')
                 ) AS requires_refund_fee,
                  sale.total_paise<>0 AND NOT EXISTS (
                    SELECT 1 FROM accounting_journal_entries entry
                    WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id
                      AND entry.source_type='invoice' AND entry.source_id=sale.id
                 ) AS missing_invoice_journal
            FROM aggregated
            JOIN pos_sale_lines line
              ON line.id=aggregated.sale_line_id
             AND line.tenant_id=aggregated.tenant_id
             AND line.branch_id=aggregated.branch_id
            JOIN pos_sales sale
              ON sale.id=aggregated.sale_id
             AND sale.tenant_id=aggregated.tenant_id
             AND sale.branch_id=aggregated.branch_id
            LEFT JOIN services service
              ON service.id=CASE
                WHEN line.line_type='package_redeem' THEN COALESCE((
                  SELECT redemption.service_id FROM pos_package_redemptions redemption
                   WHERE redemption.tenant_id=line.tenant_id AND redemption.branch_id=line.branch_id
                     AND redemption.sale_id=line.sale_id
                     AND redemption.client_package_credit_id=line.item_id
                   ORDER BY redemption.created_at,redemption.id LIMIT 1
                ),line.item_id)
                WHEN line.line_type='membership_redeem' THEN COALESCE((
                  SELECT redemption.service_id FROM pos_membership_redemptions redemption
                   WHERE redemption.tenant_id=line.tenant_id AND redemption.branch_id=line.branch_id
                     AND redemption.sale_id=line.sale_id
                     AND redemption.client_membership_credit_id=line.item_id
                   ORDER BY redemption.created_at,redemption.id LIMIT 1
                ),line.item_id)
                ELSE line.item_id END AND service.tenant_id=line.tenant_id
             AND service.branch_id=line.branch_id
            LEFT JOIN appointments appointment
              ON appointment.id=sale.reference_id AND appointment.tenant_id=sale.tenant_id
             AND appointment.branch_id=sale.branch_id
            LEFT JOIN staff ON staff.id=COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''))
             AND staff.tenant_id=line.tenant_id AND staff.branch_id=line.branch_id
            LEFT JOIN clients client ON client.id=sale.client_id
             AND client.tenant_id=sale.tenant_id AND client.branch_id=sale.branch_id
            LEFT JOIN tenants tenant
              ON COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=sale.tenant_id
            LEFT JOIN branches branch ON branch.tenant_id=tenant.id
             AND COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT)=sale.branch_id
        ), weighted_facts AS (
          SELECT facts.*,
                 COUNT(*) OVER (PARTITION BY tenant_id,branch_id,sale_id)::NUMERIC AS sale_line_count,
                 COUNT(*) OVER (PARTITION BY tenant_id,branch_id,NULLIF(staff_id,''))::NUMERIC AS staff_line_count
            FROM facts
        ), rule_expense_rows AS (
          SELECT rule.id,rule.name,rule.version,rule.driver,
                 line.id AS journal_line_id,
                 GREATEST(line.debit_paise-line.credit_paise,0)::BIGINT AS expense_paise,
                 ROW_NUMBER() OVER (
                   PARTITION BY entry.id,line.id,rule.name ORDER BY rule.version DESC,rule.created_at DESC
                 ) AS version_rank
            FROM micro_profit_allocation_rules rule
            JOIN accounting_journal_entries entry
              ON entry.tenant_id=rule.tenant_id AND entry.branch_id=rule.branch_id
             AND entry.entry_date BETWEEN GREATEST(rule.effective_from,$3)
                                      AND LEAST(COALESCE(rule.effective_to,$4),$4)
            JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
             AND line.account_code=ANY(rule.account_codes)
           WHERE rule.tenant_id=$1 AND rule.branch_id=ANY($2::TEXT[])
             AND rule.effective_from<=$4 AND COALESCE(rule.effective_to,$4)>=$3
        ), rule_pool AS (
          SELECT id,name,version,driver,SUM(expense_paise)::BIGINT AS pool_paise
            FROM rule_expense_rows WHERE version_rank=1
           GROUP BY id,name,version,driver
        ), driver_rows AS (
          SELECT pool.id,pool.pool_paise,fact.sale_line_id,
                 CASE pool.driver
                   WHEN 'service_minutes' THEN fact.service_minutes::NUMERIC
                   WHEN 'chair_resource_minutes' THEN fact.chair_resource_minutes::NUMERIC
                   WHEN 'revenue_share' THEN GREATEST(fact.recognized_revenue_paise,0)::NUMERIC
                   WHEN 'headcount' THEN CASE WHEN fact.staff_id<>'' THEN 1/fact.staff_line_count ELSE 0 END
                   WHEN 'transaction_count' THEN 1/fact.sale_line_count
                   ELSE 0 END AS driver_weight
            FROM rule_pool pool CROSS JOIN weighted_facts fact
        ), weighted_driver_rows AS (
          SELECT driver_rows.*,
                 SUM(driver_weight) OVER (PARTITION BY id) AS driver_total,
                 SUM(driver_weight) OVER (
                   PARTITION BY id ORDER BY sale_line_id ROWS UNBOUNDED PRECEDING
                 ) AS cumulative_weight
            FROM driver_rows
        ), overhead_by_line AS (
          SELECT sale_line_id,SUM(overhead_cost_paise)::BIGINT AS overhead_cost_paise
            FROM (
              SELECT sale_line_id,
                     (ROUND(pool_paise::NUMERIC*cumulative_weight/NULLIF(driver_total,0))
                      -ROUND(pool_paise::NUMERIC*(cumulative_weight-driver_weight)
                        /NULLIF(driver_total,0)))::BIGINT
                       AS overhead_cost_paise
                FROM weighted_driver_rows
            ) allocated
           GROUP BY sale_line_id
        ), configured_rule AS (
          SELECT COUNT(*)::BIGINT AS rule_count
            FROM micro_profit_allocation_rules
           WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
             AND effective_from<=$4 AND COALESCE(effective_to,$4)>=$3
        ), allocation_state AS (
          SELECT configured_rule.rule_count,
                 COALESCE(SUM(rule_pool.pool_paise),0)::BIGINT AS pool_paise,
                 COALESCE((SELECT SUM(overhead_cost_paise) FROM overhead_by_line),0)::BIGINT
                   AS allocated_paise
            FROM configured_rule LEFT JOIN rule_pool ON TRUE
           GROUP BY configured_rule.rule_count
        )
        SELECT branch_id,branch_name,first_event_date,last_event_date,sale_id,sale_line_id,
               invoice_number,reference_id,appointment_id,appointment_name,channel,
               journal_entry_id,inventory_movement_ids,line_type,item_id,item_name,item_category,unit_count,discount_paise,
               staff_id,staff_name,client_id,client_name,
               recognized_revenue_paise,product_cost_paise,staff_cost_paise,
               staff_time_cost_paise,gateway_fee_paise,refund_fee_paise,
               COALESCE(overhead_by_line.overhead_cost_paise,0)::BIGINT AS overhead_cost_paise,
               CASE WHEN NOT requires_product_cost THEN 'not_required'
                    WHEN has_product_cost THEN 'recorded' ELSE 'missing' END AS product_cost_status,
               CASE WHEN NOT requires_staff_cost THEN 'not_required'
                    WHEN has_staff_cost THEN 'recorded' ELSE 'missing' END AS staff_cost_status,
               CASE WHEN NOT requires_staff_cost OR line_type NOT IN ('service','package_redeem','membership_redeem')
                      THEN 'not_required' WHEN has_staff_time_cost THEN 'recorded' ELSE 'missing' END AS staff_time_cost_status,
               CASE WHEN NOT requires_gateway_fee THEN 'not_required'
                    WHEN has_gateway_fee THEN 'recorded' ELSE 'missing' END AS gateway_fee_status,
               CASE WHEN NOT requires_refund_fee THEN 'not_required'
                    WHEN has_refund_fee THEN 'recorded' ELSE 'missing' END AS refund_fee_status,
               CASE WHEN allocation_state.rule_count=0 THEN 'not_configured'
                    WHEN allocation_state.pool_paise<>allocation_state.allocated_paise
                      THEN 'unallocated' ELSE 'recorded' END AS overhead_status,
               missing_invoice_journal,event_count,COUNT(*) OVER()::BIGINT AS total_count
          FROM weighted_facts
          LEFT JOIN overhead_by_line USING(sale_line_id)
          CROSS JOIN allocation_state
         WHERE $7='' OR
               ($7='service' AND line_type IN ('service','package_redeem','membership_redeem') AND item_id=$8) OR
               ($7='category' AND line_type IN ('service','package_redeem','membership_redeem') AND item_category=$8) OR
               ($7='product' AND line_type='product' AND item_id=$8) OR
               ($7='staff' AND COALESCE(NULLIF(staff_id,''),'unassigned')=$8) OR
               ($7='customer' AND COALESCE(NULLIF(client_id,''),'walk_in')=$8) OR
               ($7='appointment' AND COALESCE(NULLIF(appointment_id,''),'direct')=$8) OR
               ($7='branch' AND branch_id=$8) OR
               ($7='channel' AND channel=$8)
         ORDER BY (recognized_revenue_paise-product_cost_paise-staff_cost_paise
                   -staff_time_cost_paise-gateway_fee_paise-refund_fee_paise
                   -COALESCE(overhead_by_line.overhead_cost_paise,0)) ASC,
                  last_event_date DESC,sale_line_id
         LIMIT $5 OFFSET $6
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .bind(limit)
    .bind(offset)
    .bind(dimension)
    .bind(entity_id)
    .fetch_all(db)
    .await
}

pub async fn micro_profit_reconciliation(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<MicroProfitReconciliationRecord, sqlx::Error> {
    sqlx::query_as(
        r#"
        WITH micro AS (
          SELECT COALESCE(SUM(recognized_revenue_paise),0)::BIGINT AS revenue_paise,
                 COALESCE(SUM(product_cost_paise),0)::BIGINT AS product_cost_paise
            FROM micro_profit_events
           WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
             AND business_date BETWEEN $3 AND $4
        ), ledger AS (
          SELECT COALESCE(SUM(CASE WHEN line.account_code IN ('SALES_REVENUE','SALES_RETURNS')
                              THEN line.credit_paise-line.debit_paise ELSE 0 END),0)::BIGINT AS revenue_paise,
                  COALESCE(SUM(CASE WHEN line.account_code='COST_OF_GOODS_SOLD'
                               THEN line.debit_paise-line.credit_paise ELSE 0 END),0)::BIGINT AS cogs_paise,
                  COALESCE(SUM(CASE WHEN line.account_code='PAYROLL_EXPENSE'
                               THEN line.debit_paise-line.credit_paise ELSE 0 END),0)::BIGINT AS payroll_paise,
                 COALESCE(SUM(CASE WHEN line.account_code='ROUNDING_INCOME'
                              THEN line.credit_paise-line.debit_paise
                              WHEN line.account_code='ROUNDING_EXPENSE'
                              THEN line.credit_paise-line.debit_paise ELSE 0 END),0)::BIGINT AS rounding_paise
            FROM accounting_journal_entries entry
            JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
           WHERE entry.tenant_id=$1 AND entry.branch_id=ANY($2::TEXT[])
             AND entry.entry_date BETWEEN $3 AND $4
        ), missing_invoice AS (
          SELECT COALESCE(SUM(event.recognized_revenue_paise),0)::BIGINT AS revenue_paise
            FROM micro_profit_events event
            JOIN pos_sales sale ON sale.id=event.sale_id
             AND sale.tenant_id=event.tenant_id AND sale.branch_id=event.branch_id
           WHERE event.tenant_id=$1 AND event.branch_id=ANY($2::TEXT[])
             AND event.business_date BETWEEN $3 AND $4 AND sale.total_paise<>0
             AND NOT EXISTS (
               SELECT 1 FROM accounting_journal_entries entry
                WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id
                  AND entry.source_type='invoice' AND entry.source_id=sale.id
             )
        ), payroll_source AS (
          SELECT COALESCE(SUM(gross_paise),0)::BIGINT AS gross_paise
            FROM staff_payroll_runs
           WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
             AND status IN ('finalized','paid') AND period_end BETWEEN $3 AND $4
        ), quality_rows AS (
          SELECT sale.id AS sale_id,line.id AS sale_line_id,
                  sale.total_paise<>0 AND NOT EXISTS (
                   SELECT 1 FROM accounting_journal_entries entry
                    WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id
                      AND entry.source_type='invoice' AND entry.source_id=sale.id
                 ) AS missing_invoice_journal,
                 (line.line_type='product' OR
                   (line.line_type='service' AND
                    jsonb_typeof(COALESCE(service.product_consumption_json,'[]'::JSONB))='array' AND
                    jsonb_array_length(COALESCE(service.product_consumption_json,'[]'::JSONB))>0))
                   AND NOT EXISTS (
                     SELECT 1 FROM inventory_stock_ledger stock
                      WHERE stock.tenant_id=line.tenant_id AND stock.branch_id=line.branch_id
                        AND stock.sale_line_id=line.id AND stock.movement_type='sale'
                   ) AS missing_product_cost,
                 (COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),'')<>'' OR
                   (jsonb_typeof(COALESCE(line.staff_splits,'[]'::JSONB))='array' AND
                    jsonb_array_length(COALESCE(line.staff_splits,'[]'::JSONB))>0))
                   AND NOT EXISTS (
                     SELECT 1 FROM pos_staff_commission_snapshots commission
                      WHERE commission.tenant_id=line.tenant_id AND commission.branch_id=line.branch_id
                        AND commission.sale_line_id=line.id
                    ) AS missing_staff_cost,
                   line.line_type IN ('service','package_redeem','membership_redeem')
                     AND (COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),'')<>'' OR
                       (jsonb_typeof(COALESCE(line.staff_splits,'[]'::JSONB))='array' AND
                        jsonb_array_length(COALESCE(line.staff_splits,'[]'::JSONB))>0))
                    AND NOT EXISTS (
                      SELECT 1 FROM micro_profit_cost_events cost
                       WHERE cost.tenant_id=line.tenant_id AND cost.branch_id=line.branch_id
                         AND cost.sale_line_id=line.id AND cost.cost_type='staff_time'
                    ) AS missing_staff_time_cost,
                  EXISTS (
                    SELECT 1 FROM pos_payments payment
                     WHERE payment.tenant_id=sale.tenant_id AND payment.branch_id=sale.branch_id
                       AND payment.sale_id=sale.id
                       AND LOWER(payment.method) NOT IN ('cash','wallet','store_credit','gift_card')
                  ) AND NOT EXISTS (
                    SELECT 1 FROM micro_profit_cost_events cost
                     WHERE cost.tenant_id=line.tenant_id AND cost.branch_id=line.branch_id
                       AND cost.sale_line_id=line.id AND cost.cost_type='gateway_fee'
                  ) AS missing_gateway_fee,
                  EXISTS (
                    SELECT 1 FROM pos_gateway_refunds gateway
                     WHERE gateway.tenant_id=sale.tenant_id AND gateway.branch_id=sale.branch_id
                       AND gateway.sale_id=sale.id AND gateway.status IN ('pending','processed')
                  ) AND NOT EXISTS (
                    SELECT 1 FROM micro_profit_cost_events cost
                     WHERE cost.tenant_id=line.tenant_id AND cost.branch_id=line.branch_id
                       AND cost.sale_line_id=line.id AND cost.cost_type='refund_gateway_fee'
                  ) AS missing_refund_fee
            FROM pos_sale_lines line
            JOIN pos_sales sale ON sale.id=line.sale_id
             AND sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id
            LEFT JOIN services service ON service.id=line.item_id
             AND service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
             AND line.line_type='service'
           WHERE sale.tenant_id=$1 AND sale.branch_id=ANY($2::TEXT[])
             AND sale.status NOT IN ('draft','open','voided','cancelled')
             AND sale.business_date BETWEEN $3 AND $4
        ), quality AS (
          SELECT COUNT(*)::BIGINT AS line_count,
                  COUNT(*) FILTER (WHERE NOT missing_invoice_journal
                                     AND NOT missing_product_cost
                                     AND NOT missing_staff_cost
                                     AND NOT missing_staff_time_cost
                                     AND NOT missing_gateway_fee
                                     AND NOT missing_refund_fee)::BIGINT AS complete_line_count,
                  COUNT(*) FILTER (WHERE NOT missing_product_cost
                                     AND NOT missing_staff_cost
                                     AND NOT missing_staff_time_cost
                                     AND NOT missing_gateway_fee
                                     AND NOT missing_refund_fee)::BIGINT AS cost_complete_line_count,
                 COUNT(DISTINCT sale_id) FILTER (WHERE missing_invoice_journal)::BIGINT AS missing_invoice_journal_count,
                 COUNT(*) FILTER (WHERE missing_product_cost)::BIGINT AS missing_product_cost_line_count,
                  COUNT(*) FILTER (WHERE missing_staff_cost)::BIGINT AS missing_staff_cost_line_count,
                  COUNT(*) FILTER (WHERE missing_staff_time_cost)::BIGINT AS missing_staff_time_cost_line_count,
                  COUNT(*) FILTER (WHERE missing_gateway_fee)::BIGINT AS missing_gateway_fee_line_count,
                  COUNT(*) FILTER (WHERE missing_refund_fee)::BIGINT AS missing_refund_fee_line_count
             FROM quality_rows
        ), allocation AS (
          SELECT COUNT(*)::BIGINT AS rule_count
            FROM micro_profit_allocation_rules
           WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
              AND effective_from<=$4 AND COALESCE(effective_to,$4)>=$3
        ), allocation_facts AS (
          SELECT line.id AS sale_line_id,sale.id AS sale_id,
                 COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''),'') AS staff_id,
                 COALESCE(service.duration_minutes,0)::BIGINT*GREATEST(line.quantity,1) AS service_minutes,
                 appointment.chair_room_id IS NOT NULL AS has_chair,
                 COALESCE(SUM(event.recognized_revenue_paise),0)::BIGINT AS revenue_paise,
                 COALESCE(line.staff_splits,'[]'::JSONB) AS staff_splits
            FROM micro_profit_events event
            JOIN pos_sale_lines line ON line.id=event.sale_line_id
             AND line.tenant_id=event.tenant_id AND line.branch_id=event.branch_id
            JOIN pos_sales sale ON sale.id=event.sale_id
             AND sale.tenant_id=event.tenant_id AND sale.branch_id=event.branch_id
            LEFT JOIN services service ON service.id=CASE
              WHEN line.line_type='package_redeem' THEN COALESCE((
                SELECT redemption.service_id FROM pos_package_redemptions redemption
                 WHERE redemption.tenant_id=line.tenant_id AND redemption.branch_id=line.branch_id
                   AND redemption.sale_id=line.sale_id
                   AND redemption.client_package_credit_id=line.item_id
                 ORDER BY redemption.created_at,redemption.id LIMIT 1
              ),line.item_id)
              WHEN line.line_type='membership_redeem' THEN COALESCE((
                SELECT redemption.service_id FROM pos_membership_redemptions redemption
                 WHERE redemption.tenant_id=line.tenant_id AND redemption.branch_id=line.branch_id
                   AND redemption.sale_id=line.sale_id
                   AND redemption.client_membership_credit_id=line.item_id
                 ORDER BY redemption.created_at,redemption.id LIMIT 1
              ),line.item_id)
              ELSE line.item_id END
             AND service.tenant_id=line.tenant_id AND service.branch_id=line.branch_id
            LEFT JOIN appointments appointment ON appointment.id=sale.reference_id
             AND appointment.tenant_id=sale.tenant_id AND appointment.branch_id=sale.branch_id
           WHERE event.tenant_id=$1 AND event.branch_id=ANY($2::TEXT[])
             AND event.business_date BETWEEN $3 AND $4
           GROUP BY line.id,sale.id,sale.staff_id,service.duration_minutes,appointment.chair_room_id
        ), allocation_expense_rows AS (
          SELECT rule.id,rule.driver,
                 GREATEST(line.debit_paise-line.credit_paise,0)::BIGINT AS expense_paise,
                 ROW_NUMBER() OVER (
                   PARTITION BY entry.id,line.id,rule.name ORDER BY rule.version DESC,rule.created_at DESC
                 ) AS version_rank
            FROM micro_profit_allocation_rules rule
            JOIN accounting_journal_entries entry
              ON entry.tenant_id=rule.tenant_id AND entry.branch_id=rule.branch_id
             AND entry.entry_date BETWEEN GREATEST(rule.effective_from,$3)
                                      AND LEAST(COALESCE(rule.effective_to,$4),$4)
            JOIN accounting_journal_lines line ON line.journal_entry_id=entry.id
             AND line.account_code=ANY(rule.account_codes)
           WHERE rule.tenant_id=$1 AND rule.branch_id=ANY($2::TEXT[])
             AND rule.effective_from<=$4 AND COALESCE(rule.effective_to,$4)>=$3
        ), allocation_pool AS (
          SELECT id,driver,SUM(expense_paise)::BIGINT AS pool_paise
            FROM allocation_expense_rows WHERE version_rank=1 GROUP BY id,driver
        ), allocation_health AS (
          SELECT COALESCE(SUM(pool.pool_paise) FILTER (WHERE NOT CASE pool.driver
                   WHEN 'service_minutes' THEN EXISTS (SELECT 1 FROM allocation_facts WHERE service_minutes>0)
                   WHEN 'chair_resource_minutes' THEN EXISTS (SELECT 1 FROM allocation_facts WHERE has_chair AND service_minutes>0)
                   WHEN 'revenue_share' THEN EXISTS (SELECT 1 FROM allocation_facts WHERE revenue_paise>0)
                   WHEN 'headcount' THEN EXISTS (SELECT 1 FROM allocation_facts WHERE staff_id<>'' OR
                     (JSONB_TYPEOF(staff_splits)='array' AND JSONB_ARRAY_LENGTH(staff_splits)>0))
                   WHEN 'transaction_count' THEN EXISTS (SELECT 1 FROM allocation_facts)
                   ELSE FALSE END),0)::BIGINT AS unallocated_paise
            FROM allocation_pool pool
         )
        SELECT ledger.revenue_paise AS ledger_revenue_paise,
               micro.revenue_paise AS micro_revenue_paise,
               missing_invoice.revenue_paise AS missing_invoice_journal_paise,
               ledger.cogs_paise AS ledger_cogs_paise,
               micro.product_cost_paise AS micro_product_cost_paise,
               ledger.payroll_paise AS ledger_payroll_paise,
               payroll_source.gross_paise AS payroll_source_paise,
               ledger.rounding_paise AS rounding_bridge_paise,
               quality.line_count AS reportable_line_count,
               quality.complete_line_count,
               quality.cost_complete_line_count,
               quality.missing_invoice_journal_count,
               quality.missing_product_cost_line_count,
               quality.missing_staff_cost_line_count,
               quality.missing_staff_time_cost_line_count,
               quality.missing_gateway_fee_line_count,
               quality.missing_refund_fee_line_count,
               allocation.rule_count AS allocation_rule_count,
               allocation_health.unallocated_paise AS unallocated_overhead_paise
          FROM micro,ledger,missing_invoice,payroll_source,quality,allocation,allocation_health
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .fetch_one(db)
    .await
}

pub async fn upsert_profit_copilot_version(
    db: &PgPool,
    input: ProfitCopilotVersionInsert<'_>,
) -> Result<String, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        INSERT INTO profit_copilot_recommendation_versions (
          tenant_id,branch_ids,period_start,period_end,recommendation_key,
          fact_schema_version,fact_hash,provider,model,kind,title,message,
          impact_paise,source_type,source_id,evaluation_status,evaluation_json
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        )
        ON CONFLICT (tenant_id,fact_hash,recommendation_key) DO UPDATE SET
          provider=EXCLUDED.provider,
          model=EXCLUDED.model,
          title=EXCLUDED.title,
          message=EXCLUDED.message,
          evaluation_status=EXCLUDED.evaluation_status,
          evaluation_json=EXCLUDED.evaluation_json
        RETURNING id
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_ids)
    .bind(input.period_start)
    .bind(input.period_end)
    .bind(input.recommendation_key)
    .bind(input.fact_schema_version)
    .bind(input.fact_hash)
    .bind(input.provider)
    .bind(input.model)
    .bind(input.kind)
    .bind(input.title)
    .bind(input.message)
    .bind(input.impact_paise)
    .bind(input.source_type)
    .bind(input.source_id)
    .bind(input.evaluation_status)
    .bind(input.evaluation_json)
    .fetch_one(db)
    .await
}

pub async fn create_profit_copilot_feedback(
    db: &PgPool,
    tenant_id: &str,
    recommendation_version_id: &str,
    decision: &str,
    comment: &str,
    actor_user_id: &str,
) -> Result<Option<ProfitCopilotFeedbackRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        INSERT INTO profit_copilot_feedback (
          tenant_id,recommendation_version_id,decision,comment,actor_user_id
        )
        SELECT $1,$2,$3,$4,$5
          FROM profit_copilot_recommendation_versions version
         WHERE version.id=$2 AND version.tenant_id=$1
        RETURNING id,recommendation_version_id,decision,comment,actor_user_id,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(recommendation_version_id)
    .bind(decision)
    .bind(comment)
    .bind(actor_user_id)
    .fetch_optional(db)
    .await
}

pub async fn invoice_journal_repair_queue(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
    from_date: NaiveDate,
    to_date: NaiveDate,
    limit: i64,
) -> Result<Vec<InvoiceJournalRepairRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sale.branch_id,sale.id AS sale_id,sale.invoice_number,sale.business_date,
               sale.total_paise,sale.tax_paise,sale.cgst_paise,sale.sgst_paise,
               sale.igst_paise,sale.tip_paise,sale.round_off_paise,
               COALESCE(period.status,'open') AS period_status
          FROM pos_sales sale
          LEFT JOIN accounting_periods period
            ON period.tenant_id=sale.tenant_id AND period.branch_id=sale.branch_id
           AND period.period_month=DATE_TRUNC('month',sale.business_date)::DATE
         WHERE sale.tenant_id=$1 AND sale.branch_id=ANY($2::TEXT[])
           AND sale.business_date BETWEEN $3 AND $4 AND sale.total_paise<>0
           AND sale.status NOT IN ('draft','open','voided','cancelled')
           AND NOT EXISTS (
             SELECT 1 FROM accounting_journal_entries entry
              WHERE entry.tenant_id=sale.tenant_id AND entry.branch_id=sale.branch_id
                AND entry.source_type='invoice' AND entry.source_id=sale.id
           )
         ORDER BY sale.business_date,sale.id
         LIMIT $5
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .bind(from_date)
    .bind(to_date)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn list_micro_profit_allocation_rules(
    db: &PgPool,
    tenant_id: &str,
    branch_ids: &[String],
) -> Result<Vec<MicroProfitAllocationRuleRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id,name,version,driver,account_codes,effective_from,effective_to,
               created_by_user_id,created_at
          FROM micro_profit_allocation_rules
         WHERE tenant_id=$1 AND branch_id=ANY($2::TEXT[])
         ORDER BY name,version DESC,branch_id
        "#,
    )
    .bind(tenant_id)
    .bind(branch_ids.to_vec())
    .fetch_all(db)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_micro_profit_allocation_rule(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor_user_id: &str,
    name: &str,
    driver: &str,
    account_codes: &[String],
    effective_from: NaiveDate,
    effective_to: Option<NaiveDate>,
) -> Result<Option<MicroProfitAllocationRuleRecord>, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))")
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&mut *tx)
        .await?;
    let conflict: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
          SELECT 1 FROM micro_profit_allocation_rules
           WHERE tenant_id=$1 AND branch_id=$2 AND name<>$3
             AND account_codes && $4::TEXT[]
             AND effective_from<=COALESCE($6::DATE,'infinity'::DATE)
             AND COALESCE(effective_to,'infinity'::DATE)>=$5
        )
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(account_codes.to_vec())
    .bind(effective_from)
    .bind(effective_to)
    .fetch_one(&mut *tx)
    .await?;
    if conflict {
        tx.rollback().await?;
        return Ok(None);
    }
    let valid_successor: bool = sqlx::query_scalar(
        "SELECT COALESCE(MAX(effective_from)<$4,TRUE) FROM micro_profit_allocation_rules WHERE tenant_id=$1 AND branch_id=$2 AND name=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(effective_from)
    .fetch_one(&mut *tx)
    .await?;
    if !valid_successor {
        tx.rollback().await?;
        return Ok(None);
    }
    sqlx::query(
        "UPDATE micro_profit_allocation_rules SET effective_to=$4::DATE-1 WHERE tenant_id=$1 AND branch_id=$2 AND name=$3 AND effective_from<$4 AND (effective_to IS NULL OR effective_to>=$4)",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(effective_from)
    .execute(&mut *tx)
    .await?;
    let record = sqlx::query_as(
        r#"
        INSERT INTO micro_profit_allocation_rules(
          tenant_id,branch_id,name,version,driver,account_codes,
          effective_from,effective_to,created_by_user_id
        )
        SELECT $1,$2,$3,COALESCE(MAX(version),0)+1,$4,$5,$6,$7,$8
          FROM micro_profit_allocation_rules
         WHERE tenant_id=$1 AND branch_id=$2 AND name=$3
        RETURNING id,name,version,driver,account_codes,effective_from,effective_to,
                  created_by_user_id,created_at
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(name)
    .bind(driver)
    .bind(account_codes.to_vec())
    .bind(effective_from)
    .bind(effective_to)
    .bind(actor_user_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(record))
}

#[allow(clippy::too_many_arguments)]
pub async fn custom_pivot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    dataset: &str,
    row_dimension: &str,
    column_dimension: &str,
    metric: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
    status: &str,
) -> Result<Vec<PivotCellRecord>, sqlx::Error> {
    // ponytail: grouped output is capped at 1,000 cells; use an async export job if larger pivots become necessary.
    let sql = if dataset == "sales" {
        r#"WITH base AS (
             SELECT CASE $5
                      WHEN 'date' THEN TO_CHAR((COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE,'YYYY-MM-DD')
                      WHEN 'service' THEN COALESCE(NULLIF(line.item_name,''),'Unknown')
                      WHEN 'staff' THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Unassigned')
                      WHEN 'lineType' THEN INITCAP(line.line_type)
                      WHEN 'status' THEN INITCAP(sale.status)
                    END AS row_key,
                    CASE $6
                      WHEN 'none' THEN 'Total'
                      WHEN 'date' THEN TO_CHAR((COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE,'YYYY-MM-DD')
                      WHEN 'service' THEN COALESCE(NULLIF(line.item_name,''),'Unknown')
                      WHEN 'staff' THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Unassigned')
                      WHEN 'lineType' THEN INITCAP(line.line_type)
                      WHEN 'status' THEN INITCAP(sale.status)
                    END AS column_key,
                    line.quantity,line.line_total_paise,line.discount_paise,sale.id AS sale_id
               FROM pos_sale_lines line
               JOIN pos_sales sale ON sale.tenant_id=line.tenant_id AND sale.branch_id=line.branch_id AND sale.id=line.sale_id
               LEFT JOIN staff ON staff.tenant_id=line.tenant_id AND staff.branch_id=line.branch_id
                              AND staff.id=COALESCE(NULLIF(line.staff_id,''),NULLIF(sale.staff_id,''))
              WHERE line.tenant_id=$1 AND line.branch_id=$2
                AND sale.status NOT IN ('draft','open','voided','cancelled')
                AND (COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
                AND ($8='' OR sale.status=$8)
           )
           SELECT row_key,column_key,
                  CASE $7 WHEN 'revenuePaise' THEN COALESCE(SUM(line_total_paise),0)::BIGINT
                          WHEN 'quantity' THEN COALESCE(SUM(quantity),0)::BIGINT
                          WHEN 'discountPaise' THEN COALESCE(SUM(discount_paise),0)::BIGINT
                          WHEN 'invoiceCount' THEN COUNT(DISTINCT sale_id)::BIGINT END AS value
             FROM base WHERE row_key IS NOT NULL AND column_key IS NOT NULL
            GROUP BY row_key,column_key ORDER BY row_key,column_key LIMIT 1000"#
    } else if dataset == "multiBranch" {
        r#"WITH scoped_branches AS (
             SELECT COALESCE(NULLIF(branch.scope_id,''),branch.id::TEXT) AS branch_id,
                    branch.name AS branch_name,branch.region_name,branch.zone_name,branch.cluster_name
               FROM branches branch JOIN tenants tenant ON tenant.id=branch.tenant_id
              WHERE COALESCE(NULLIF(tenant.scope_id,''),tenant.id::TEXT)=$1
           ), events AS (
             SELECT (COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE AS event_date,
                    branch.branch_name,branch.region_name,branch.zone_name,branch.cluster_name,sale.status,
                    sale.total_paise AS revenue_paise,sale.discount_paise,sale.tax_paise,sale.tip_paise,
                    0::BIGINT AS refund_paise,sale.id AS invoice_id
               FROM pos_sales sale JOIN scoped_branches branch ON branch.branch_id=sale.branch_id
              WHERE sale.tenant_id=$1 AND sale.status NOT IN ('draft','open','voided','cancelled')
                AND (COALESCE(sale.finalized_at,sale.created_at) AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
                AND ($8='' OR sale.status=$8)
             UNION ALL
             SELECT (refund.created_at AT TIME ZONE 'Asia/Kolkata')::DATE,
                    branch.branch_name,branch.region_name,branch.zone_name,branch.cluster_name,sale.status,
                    0,0,0,0,refund.amount_paise,NULL
               FROM pos_invoice_refunds refund
               JOIN pos_sales sale ON sale.tenant_id=refund.tenant_id AND sale.branch_id=refund.branch_id AND sale.id=refund.sale_id
               JOIN scoped_branches branch ON branch.branch_id=refund.branch_id
              WHERE refund.tenant_id=$1 AND (refund.created_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
                AND ($8='' OR sale.status=$8)
           ), base AS (
             SELECT CASE $5 WHEN 'date' THEN TO_CHAR(event_date,'YYYY-MM-DD')
                       WHEN 'region' THEN COALESCE(NULLIF(region_name,''),'Unassigned')
                       WHEN 'zone' THEN COALESCE(NULLIF(zone_name,''),'Unassigned')
                       WHEN 'cluster' THEN COALESCE(NULLIF(cluster_name,''),'Unassigned')
                       WHEN 'branch' THEN branch_name WHEN 'status' THEN INITCAP(status) END AS row_key,
                    CASE $6 WHEN 'none' THEN 'Total' WHEN 'date' THEN TO_CHAR(event_date,'YYYY-MM-DD')
                       WHEN 'region' THEN COALESCE(NULLIF(region_name,''),'Unassigned')
                       WHEN 'zone' THEN COALESCE(NULLIF(zone_name,''),'Unassigned')
                       WHEN 'cluster' THEN COALESCE(NULLIF(cluster_name,''),'Unassigned')
                       WHEN 'branch' THEN branch_name WHEN 'status' THEN INITCAP(status) END AS column_key,
                    revenue_paise,discount_paise,tax_paise,tip_paise,refund_paise,invoice_id
               FROM events
           )
           SELECT row_key,column_key,
                  CASE $7 WHEN 'revenuePaise' THEN COALESCE(SUM(revenue_paise),0)::BIGINT
                          WHEN 'discountPaise' THEN COALESCE(SUM(discount_paise),0)::BIGINT
                          WHEN 'taxPaise' THEN COALESCE(SUM(tax_paise),0)::BIGINT
                          WHEN 'tipPaise' THEN COALESCE(SUM(tip_paise),0)::BIGINT
                          WHEN 'refundPaise' THEN COALESCE(SUM(refund_paise),0)::BIGINT
                          WHEN 'invoiceCount' THEN COUNT(DISTINCT invoice_id)::BIGINT END AS value
             FROM base WHERE row_key IS NOT NULL AND column_key IS NOT NULL
            GROUP BY row_key,column_key ORDER BY row_key,column_key LIMIT 1000"#
    } else if dataset == "appointments" {
        r#"WITH base AS (
             SELECT CASE $5
                      WHEN 'date' THEN TO_CHAR((appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE,'YYYY-MM-DD')
                      WHEN 'status' THEN INITCAP(appointment.status)
                      WHEN 'staff' THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Unassigned')
                      WHEN 'source' THEN COALESCE(NULLIF(appointment.source_channel,''),'Manual')
                    END AS row_key,
                    CASE $6
                      WHEN 'none' THEN 'Total'
                      WHEN 'date' THEN TO_CHAR((appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE,'YYYY-MM-DD')
                      WHEN 'status' THEN INITCAP(appointment.status)
                      WHEN 'staff' THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ',staff.first_name,staff.last_name)),''),'Unassigned')
                      WHEN 'source' THEN COALESCE(NULLIF(appointment.source_channel,''),'Manual')
                    END AS column_key,
                    appointment.id,
                    GREATEST(EXTRACT(EPOCH FROM (appointment.end_at-appointment.start_at))::BIGINT/60,0) AS duration_minutes
               FROM appointments appointment
               LEFT JOIN staff ON staff.tenant_id=appointment.tenant_id AND staff.branch_id=appointment.branch_id AND staff.id=appointment.staff_id
              WHERE appointment.tenant_id=$1 AND appointment.branch_id=$2
                AND (appointment.start_at AT TIME ZONE 'Asia/Kolkata')::DATE BETWEEN $3 AND $4
                AND ($8='' OR appointment.status=$8)
           )
           SELECT row_key,column_key,
                  CASE $7 WHEN 'appointmentCount' THEN COUNT(DISTINCT id)::BIGINT
                          WHEN 'durationMinutes' THEN COALESCE(SUM(duration_minutes),0)::BIGINT END AS value
             FROM base WHERE row_key IS NOT NULL AND column_key IS NOT NULL
            GROUP BY row_key,column_key ORDER BY row_key,column_key LIMIT 1000"#
    } else {
        r#"WITH base AS (
             SELECT CASE $5
                      WHEN 'date' THEN TO_CHAR(voucher.business_date,'YYYY-MM-DD')
                      WHEN 'category' THEN COALESCE(NULLIF(line.category_key,''),'Other')
                      WHEN 'status' THEN INITCAP(voucher.status)
                      WHEN 'paymentMode' THEN COALESCE(NULLIF(voucher.payment_mode,''),'Other')
                      WHEN 'fundSource' THEN INITCAP(REPLACE(COALESCE(NULLIF(voucher.fund_source,''),'other'),'_',' '))
                      WHEN 'partyType' THEN INITCAP(COALESCE(NULLIF(voucher.linked_party_type,''),'none'))
                      WHEN 'department' THEN COALESCE(NULLIF(line.department,''),'Unassigned')
                    END AS row_key,
                    CASE $6
                      WHEN 'none' THEN 'Total'
                      WHEN 'date' THEN TO_CHAR(voucher.business_date,'YYYY-MM-DD')
                      WHEN 'category' THEN COALESCE(NULLIF(line.category_key,''),'Other')
                      WHEN 'status' THEN INITCAP(voucher.status)
                      WHEN 'paymentMode' THEN COALESCE(NULLIF(voucher.payment_mode,''),'Other')
                      WHEN 'fundSource' THEN INITCAP(REPLACE(COALESCE(NULLIF(voucher.fund_source,''),'other'),'_',' '))
                      WHEN 'partyType' THEN INITCAP(COALESCE(NULLIF(voucher.linked_party_type,''),'none'))
                      WHEN 'department' THEN COALESCE(NULLIF(line.department,''),'Unassigned')
                    END AS column_key,
                    voucher.id AS voucher_id,line.id AS line_id,line.amount_paise,line.gst_paise
               FROM outgoing_fund_lines line
               JOIN outgoing_fund_vouchers voucher ON voucher.tenant_id=line.tenant_id AND voucher.branch_id=line.branch_id AND voucher.id=line.voucher_id
              WHERE line.tenant_id=$1 AND line.branch_id=$2
                AND voucher.business_date BETWEEN $3 AND $4
                AND voucher.status NOT IN ('draft','cancelled')
                AND ($8='' OR voucher.status=$8)
           )
           SELECT row_key,column_key,
                  CASE $7 WHEN 'amountPaise' THEN COALESCE(SUM(amount_paise),0)::BIGINT
                          WHEN 'gstPaise' THEN COALESCE(SUM(gst_paise),0)::BIGINT
                          WHEN 'voucherCount' THEN COUNT(DISTINCT voucher_id)::BIGINT
                          WHEN 'lineCount' THEN COUNT(DISTINCT line_id)::BIGINT END AS value
             FROM base WHERE row_key IS NOT NULL AND column_key IS NOT NULL
            GROUP BY row_key,column_key ORDER BY row_key,column_key LIMIT 1000"#
    };
    sqlx::query_as(sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(from_date)
        .bind(to_date)
        .bind(row_dimension)
        .bind(column_dimension)
        .bind(metric)
        .bind(status)
        .fetch_all(db)
        .await
}

pub async fn list_custom_reports(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<CustomReportRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,schedule_time,recipient_email,next_run_at,last_run_at,last_status,last_error,last_result_json,consecutive_failures,active,version,created_at,updated_at FROM custom_reports WHERE tenant_id=$1 AND branch_id=$2 ORDER BY active DESC,updated_at DESC,id")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn get_custom_report_any(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<CustomReportRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,schedule_time,recipient_email,next_run_at,last_run_at,last_status,last_error,last_result_json,consecutive_failures,active,version,created_at,updated_at FROM custom_reports WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_custom_report_lifecycle(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    expected_version: i32,
    action: &str,
    next_run_at: Option<DateTime<Utc>>,
    actor: &str,
) -> Result<Option<CustomReportRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"UPDATE custom_reports SET
             schedule_frequency=CASE WHEN $5='stopSchedule' THEN 'none' ELSE schedule_frequency END,
             active=CASE WHEN $5='archive' THEN FALSE WHEN $5='restore' THEN TRUE ELSE active END,
             next_run_at=CASE WHEN $5 IN ('stopSchedule','archive') THEN NULL ELSE $6 END,
             updated_by=$7,version=version+1,updated_at=NOW()
           WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4
             AND (($5='stopSchedule' AND active=TRUE AND schedule_frequency<>'none')
               OR ($5='archive' AND active=TRUE) OR ($5='restore' AND active=FALSE))
           RETURNING id,tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,
             schedule_time,recipient_email,next_run_at,last_run_at,last_status,last_error,
             last_result_json,consecutive_failures,active,version,created_at,updated_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .bind(expected_version)
    .bind(action)
    .bind(next_run_at)
    .bind(actor)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn get_custom_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<CustomReportRecord>, sqlx::Error> {
    sqlx::query_as("SELECT id,tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,schedule_time,recipient_email,next_run_at,last_run_at,last_status,last_error,last_result_json,consecutive_failures,active,version,created_at,updated_at FROM custom_reports WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

#[allow(clippy::too_many_arguments)]
pub async fn save_custom_report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: Option<&str>,
    expected_version: Option<i32>,
    name: &str,
    definition: &Value,
    schedule_frequency: &str,
    schedule_day: i16,
    schedule_time: NaiveTime,
    recipient_email: &str,
    next_run_at: Option<DateTime<Utc>>,
    actor: &str,
) -> Result<Option<CustomReportRecord>, sqlx::Error> {
    if let Some(id) = id {
        return sqlx::query_as("UPDATE custom_reports SET name=$5,definition_json=$6,schedule_frequency=$7,schedule_day=$8,schedule_time=$9,recipient_email=$10,next_run_at=$11,last_status=CASE WHEN $7='none' THEN 'never' ELSE last_status END,last_error='',updated_by=$12,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND version=$4 AND active=TRUE RETURNING id,tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,schedule_time,recipient_email,next_run_at,last_run_at,last_status,last_error,last_result_json,consecutive_failures,active,version,created_at,updated_at")
            .bind(tenant_id).bind(branch_id).bind(id).bind(expected_version.unwrap_or(0)).bind(name)
            .bind(definition).bind(schedule_frequency).bind(schedule_day).bind(schedule_time)
            .bind(recipient_email).bind(next_run_at).bind(actor).fetch_optional(db).await;
    }
    sqlx::query_as("INSERT INTO custom_reports(tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,schedule_time,recipient_email,next_run_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id,tenant_id,branch_id,name,definition_json,schedule_frequency,schedule_day,schedule_time,recipient_email,next_run_at,last_run_at,last_status,last_error,last_result_json,consecutive_failures,active,version,created_at,updated_at")
        .bind(tenant_id).bind(branch_id).bind(name).bind(definition).bind(schedule_frequency)
        .bind(schedule_day).bind(schedule_time).bind(recipient_email).bind(next_run_at).bind(actor)
        .fetch_optional(db).await
}

pub async fn record_custom_report_result(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    result: &Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE custom_reports SET last_run_at=NOW(),last_status='completed',last_error='',last_result_json=$4,consecutive_failures=0,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(id).bind(result).execute(db).await?;
    Ok(())
}

pub async fn claim_due_custom_reports(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<CustomReportRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"WITH due AS (
             SELECT id FROM custom_reports
              WHERE active=TRUE AND schedule_frequency<>'none'
                AND (next_run_at<=NOW() OR (last_status='processing' AND last_run_at<NOW()-INTERVAL '15 minutes'))
              ORDER BY COALESCE(next_run_at,last_run_at),id FOR UPDATE SKIP LOCKED LIMIT $1
           )
           UPDATE custom_reports report SET last_status='processing',last_error='',
                  last_run_at=CASE WHEN report.last_status='processing' THEN report.last_run_at ELSE NOW() END,
                  next_run_at=NULL,updated_at=NOW()
             FROM due WHERE report.id=due.id
           RETURNING report.id,report.tenant_id,report.branch_id,report.name,report.definition_json,
                     report.schedule_frequency,report.schedule_day,report.schedule_time,report.recipient_email,
                     report.next_run_at,report.last_run_at,report.last_status,report.last_error,
                     report.last_result_json,report.consecutive_failures,report.active,report.version,
                     report.created_at,report.updated_at"#,
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn finish_scheduled_custom_report(
    db: &PgPool,
    id: &str,
    result: Option<&Value>,
    error: &str,
    next_run_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let completed = error.is_empty();
    sqlx::query("UPDATE custom_reports SET last_status=CASE WHEN $2 THEN 'completed' ELSE 'failed' END,last_error=$3,last_result_json=CASE WHEN $2 THEN $4 ELSE last_result_json END,consecutive_failures=CASE WHEN $2 THEN 0 ELSE consecutive_failures+1 END,next_run_at=CASE WHEN schedule_frequency='none' THEN NULL ELSE $5 END,updated_at=NOW() WHERE id=$1 AND active=TRUE")
        .bind(id).bind(completed).bind(error).bind(result).bind(next_run_at).execute(db).await?;
    Ok(())
}
