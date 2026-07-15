use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipReminderRecord {
    pub id: String,
    pub client_membership_id: Option<String>,
    pub client_id: String,
    pub client_name: String,
    pub membership_name: String,
    pub reminder_type: String,
    pub due_on: NaiveDate,
    pub days_before: i32,
    pub status: String,
    pub message: String,
    pub approved_by: String,
    pub approved_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipCommissionRecord {
    pub id: String,
    pub sale_id: String,
    pub invoice_number: String,
    pub staff_id: String,
    pub staff_name: String,
    pub client_id: String,
    pub client_name: String,
    pub membership_id: String,
    pub membership_name: String,
    pub revenue_paise: i64,
    pub rate_percent: i32,
    pub commission_paise: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipRiskReviewRecord {
    pub signal_id: String,
    pub membership_id: String,
    pub client_id: String,
    pub risk_level: String,
    pub review_status: String,
    pub note: String,
    pub reviewed_by: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipRewardRecord {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub source_sale_id: String,
    pub transaction_type: String,
    pub points: i32,
    pub balance_after: i32,
    pub expires_at: Option<NaiveDate>,
    pub staff_id: String,
    pub note: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardClientRevenueRecord {
    pub client_id: String,
    pub visits: i64,
    pub total_sale_paise: i64,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicMembershipStatusRecord {
    #[serde(skip_serializing)]
    pub tenant_id: String,
    #[serde(skip_serializing)]
    pub branch_id: String,
    pub token: String,
    pub client_id: String,
    pub client_name: String,
    pub client_membership_id: Option<String>,
    pub membership_name: String,
    pub status: String,
    pub expires_at: Option<DateTime<Utc>>,
    pub token_expires_at: DateTime<Utc>,
}

pub async fn get_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT settings_json FROM membership_settings WHERE tenant_id=$1 AND branch_id=$2",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn save_settings(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    settings: &Value,
) -> Result<Value, sqlx::Error> {
    sqlx::query_scalar("INSERT INTO membership_settings (tenant_id,branch_id,settings_json) VALUES ($1,$2,$3) ON CONFLICT (tenant_id,branch_id) DO UPDATE SET settings_json=EXCLUDED.settings_json,updated_at=NOW() RETURNING settings_json")
        .bind(tenant_id).bind(branch_id).bind(settings).fetch_one(db).await
}

pub async fn generate_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i32,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("INSERT INTO membership_reminders (tenant_id,branch_id,client_membership_id,client_id,due_on,days_before,message) SELECT cm.tenant_id,cm.branch_id,cm.id,cm.client_id,cm.expires_at::DATE,GREATEST(0,(cm.expires_at::DATE-CURRENT_DATE)),CONCAT('Membership ',m.name,' expires on ',TO_CHAR(cm.expires_at,'DD/MM/YYYY')) FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.active=TRUE AND cm.expires_at IS NOT NULL AND cm.expires_at::DATE BETWEEN CURRENT_DATE AND CURRENT_DATE+$3 ON CONFLICT (tenant_id,branch_id,client_membership_id,reminder_type,due_on) DO NOTHING")
        .bind(tenant_id).bind(branch_id).bind(days).execute(db).await?;
    Ok(result.rows_affected())
}

pub async fn list_reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MembershipReminderRecord>, sqlx::Error> {
    sqlx::query_as::<_,MembershipReminderRecord>("SELECT r.id,r.client_membership_id,r.client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,COALESCE(m.name,'Rewards') AS membership_name,r.reminder_type,r.due_on,r.days_before,r.status,r.message,r.approved_by,r.approved_at,r.created_at FROM membership_reminders r JOIN clients c ON c.id=r.client_id LEFT JOIN client_memberships cm ON cm.id=r.client_membership_id LEFT JOIN memberships m ON m.id=cm.membership_id WHERE r.tenant_id=$1 AND r.branch_id=$2 ORDER BY r.due_on,r.created_at DESC LIMIT 500")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn approve_reminder(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE membership_reminders SET status='approved',approved_by=$4,approved_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='queued'")
        .bind(tenant_id).bind(branch_id).bind(id).bind(actor).execute(db).await?.rows_affected()>0)
}

pub async fn commission_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MembershipCommissionRecord>, sqlx::Error> {
    sqlx::query_as::<_,MembershipCommissionRecord>(
        r#"
        WITH snapshot_rows AS (
          SELECT snap.id,ps.id AS sale_id,ps.invoice_number,snap.staff_id,
                 COALESCE(NULLIF(CONCAT_WS(' ',s.first_name,s.last_name),''),snap.staff_id,'Unassigned') AS staff_name,
                 ps.client_id,COALESCE(NULLIF(CONCAT_WS(' ',c.first_name,c.last_name),''),ps.client_id,'Walk-in client') AS client_name,
                 psl.item_id AS membership_id,psl.item_name AS membership_name,
                 snap.base_paise::BIGINT AS revenue_paise,snap.rate_percent::INTEGER,
                 snap.commission_paise::BIGINT,ps.created_at
            FROM pos_staff_commission_snapshots snap
            JOIN pos_sale_lines psl ON psl.id=snap.sale_line_id AND psl.tenant_id=snap.tenant_id AND psl.branch_id=snap.branch_id
            JOIN pos_sales ps ON ps.id=snap.sale_id AND ps.tenant_id=snap.tenant_id AND ps.branch_id=snap.branch_id
            LEFT JOIN staff s ON s.id=snap.staff_id AND s.tenant_id=snap.tenant_id AND s.branch_id=snap.branch_id
            LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id
           WHERE snap.tenant_id=$1 AND snap.branch_id=$2 AND snap.line_type='membership'
             AND ps.status NOT IN ('draft','cancelled','voided')
        ), fallback_rows AS (
          SELECT psl.id,ps.id AS sale_id,ps.invoice_number,psl.staff_id,
                 COALESCE(NULLIF(CONCAT_WS(' ',s.first_name,s.last_name),''),psl.staff_id,'Unassigned') AS staff_name,
                 ps.client_id,COALESCE(NULLIF(CONCAT_WS(' ',c.first_name,c.last_name),''),ps.client_id,'Walk-in client') AS client_name,
                 psl.item_id AS membership_id,psl.item_name AS membership_name,
                 psl.taxable_paise::BIGINT AS revenue_paise,
                 COALESCE(sca.commission_percent,scr.rate_percent,0)::INTEGER AS rate_percent,
                 ((psl.taxable_paise*COALESCE(sca.commission_percent,scr.rate_percent,0)+50)/100)::BIGINT AS commission_paise,
                 ps.created_at
            FROM pos_sale_lines psl
            JOIN pos_sales ps ON ps.id=psl.sale_id AND ps.tenant_id=psl.tenant_id AND ps.branch_id=psl.branch_id
            LEFT JOIN staff s ON s.id=psl.staff_id AND s.tenant_id=psl.tenant_id AND s.branch_id=psl.branch_id
            LEFT JOIN clients c ON c.id=ps.client_id AND c.tenant_id=ps.tenant_id AND c.branch_id=ps.branch_id
            LEFT JOIN staff_catalog_assignments sca ON sca.staff_id=psl.staff_id AND sca.item_type='membership' AND sca.item_id=psl.item_id AND sca.tenant_id=psl.tenant_id AND sca.branch_id=psl.branch_id
            LEFT JOIN LATERAL (
              SELECT rate_percent FROM staff_commission_rules
               WHERE tenant_id=psl.tenant_id AND branch_id=psl.branch_id AND staff_id=psl.staff_id
                 AND active=TRUE AND applies_to IN ('membership','all')
                 AND (effective_from IS NULL OR effective_from <= ps.business_date)
               ORDER BY CASE WHEN applies_to='membership' THEN 0 ELSE 1 END,effective_from DESC NULLS LAST,created_at DESC LIMIT 1
            ) scr ON TRUE
           WHERE psl.tenant_id=$1 AND psl.branch_id=$2 AND psl.line_type='membership'
             AND ps.status NOT IN ('draft','cancelled','voided')
             AND NOT EXISTS (SELECT 1 FROM pos_staff_commission_snapshots snap WHERE snap.tenant_id=psl.tenant_id AND snap.branch_id=psl.branch_id AND snap.sale_line_id=psl.id)
        )
        SELECT * FROM snapshot_rows
        UNION ALL
        SELECT * FROM fallback_rows
        ORDER BY created_at DESC LIMIT 1000
        "#,
    )
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn list_risk_reviews(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MembershipRiskReviewRecord>, sqlx::Error> {
    sqlx::query_as::<_,MembershipRiskReviewRecord>("SELECT signal_id,membership_id,client_id,risk_level,review_status,note,reviewed_by,created_at FROM membership_risk_reviews WHERE tenant_id=$1 AND branch_id=$2 ORDER BY created_at DESC")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn review_risk(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    signal_id: &str,
    membership_id: &str,
    client_id: &str,
    risk_level: &str,
    status: &str,
    note: &str,
    actor: &str,
) -> Result<MembershipRiskReviewRecord, sqlx::Error> {
    sqlx::query_as::<_,MembershipRiskReviewRecord>("INSERT INTO membership_risk_reviews (tenant_id,branch_id,signal_id,membership_id,client_id,risk_level,review_status,note,reviewed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,branch_id,signal_id) DO UPDATE SET membership_id=EXCLUDED.membership_id,client_id=EXCLUDED.client_id,risk_level=EXCLUDED.risk_level,review_status=EXCLUDED.review_status,note=EXCLUDED.note,reviewed_by=EXCLUDED.reviewed_by,updated_at=NOW() RETURNING signal_id,membership_id,client_id,risk_level,review_status,note,reviewed_by,created_at")
        .bind(tenant_id).bind(branch_id).bind(signal_id).bind(membership_id).bind(client_id).bind(risk_level).bind(status).bind(note).bind(actor).fetch_one(db).await
}

pub async fn reward_ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MembershipRewardRecord>, sqlx::Error> {
    sqlx::query_as::<_,MembershipRewardRecord>("SELECT l.id,l.client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,l.source_sale_id,l.transaction_type,l.points,l.balance_after,l.expires_at,l.staff_id,l.note,l.created_at FROM membership_reward_ledger l JOIN clients c ON c.id=l.client_id WHERE l.tenant_id=$1 AND l.branch_id=$2 ORDER BY l.created_at DESC LIMIT 2000")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn reward_revenue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<RewardClientRevenueRecord>, sqlx::Error> {
    sqlx::query_as::<_,RewardClientRevenueRecord>("SELECT client_id,COUNT(*)::BIGINT AS visits,COALESCE(SUM(total_paise),0)::BIGINT AS total_sale_paise FROM pos_sales WHERE tenant_id=$1 AND branch_id=$2 AND status NOT IN ('draft','cancelled','voided') GROUP BY client_id")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

#[derive(Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipProfitabilityRecord {
    pub membership_id: String,
    pub membership_name: String,
    pub sold_count: i64,
    pub revenue_paise: i64,
    pub commission_paise: i64,
    pub redeemed_credits: i64,
    pub redeemed_value_paise: i64,
    pub service_cost_paise: i64,
    pub net_profit_paise: i64,
}

pub async fn profitability_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<MembershipProfitabilityRecord>, sqlx::Error> {
    sqlx::query_as::<_, MembershipProfitabilityRecord>(
        r#"
        WITH sales AS (
          SELECT psl.item_id AS membership_id,
                 MAX(psl.item_name) AS membership_name,
                 COUNT(DISTINCT ps.id)::BIGINT AS sold_count,
                 COALESCE(SUM(psl.line_total_paise),0)::BIGINT AS revenue_paise,
                 COALESCE(SUM(COALESCE(snap.commission_paise,((psl.taxable_paise * COALESCE(sca.commission_percent,scr.rate_percent,0)+50) / 100))),0)::BIGINT AS commission_paise
            FROM pos_sale_lines psl
            JOIN pos_sales ps ON ps.id=psl.sale_id AND ps.tenant_id=psl.tenant_id AND ps.branch_id=psl.branch_id
            LEFT JOIN LATERAL (
              SELECT SUM(commission_paise)::BIGINT AS commission_paise
                FROM pos_staff_commission_snapshots snap
               WHERE snap.tenant_id=psl.tenant_id AND snap.branch_id=psl.branch_id AND snap.sale_line_id=psl.id
            ) snap ON TRUE
            LEFT JOIN staff_catalog_assignments sca ON sca.tenant_id=psl.tenant_id AND sca.branch_id=psl.branch_id AND sca.staff_id=psl.staff_id AND sca.item_type='membership' AND sca.item_id=psl.item_id
            LEFT JOIN LATERAL (
              SELECT rate_percent FROM staff_commission_rules
               WHERE tenant_id=psl.tenant_id AND branch_id=psl.branch_id AND staff_id=psl.staff_id
                 AND active=TRUE AND applies_to IN ('membership','all')
                 AND (effective_from IS NULL OR effective_from <= ps.business_date)
               ORDER BY CASE WHEN applies_to='membership' THEN 0 ELSE 1 END, effective_from DESC NULLS LAST
               LIMIT 1
            ) scr ON TRUE
           WHERE psl.tenant_id=$1 AND psl.branch_id=$2 AND psl.line_type='membership'
             AND ps.status NOT IN ('draft','cancelled','voided')
           GROUP BY psl.item_id
        ), credit_totals AS (
          SELECT tenant_id,branch_id,source_sale_id,membership_id,COALESCE(SUM(total_qty),0)::BIGINT AS total_qty
            FROM client_membership_credits
           WHERE tenant_id=$1 AND branch_id=$2
           GROUP BY tenant_id,branch_id,source_sale_id,membership_id
        ), redemption AS (
          SELECT pmr.membership_id,
                 MAX(pmr.membership_name) AS membership_name,
                 COALESCE(SUM(pmr.quantity),0)::BIGINT AS redeemed_credits,
                 COALESCE(SUM(CASE WHEN ct.total_qty>0 THEN (COALESCE(msl.line_total_paise,0) * pmr.quantity) / ct.total_qty ELSE 0 END),0)::BIGINT AS redeemed_value_paise,
                 COALESCE(SUM(COALESCE(sc.cost_paise,0) * pmr.quantity),0)::BIGINT AS service_cost_paise
            FROM pos_membership_redemptions pmr
            JOIN client_membership_credits cmc ON cmc.id=pmr.client_membership_credit_id
            LEFT JOIN credit_totals ct ON ct.tenant_id=pmr.tenant_id AND ct.branch_id=pmr.branch_id AND ct.source_sale_id=cmc.source_sale_id AND ct.membership_id=pmr.membership_id
            LEFT JOIN pos_sale_lines msl ON msl.tenant_id=pmr.tenant_id AND msl.branch_id=pmr.branch_id AND msl.sale_id=cmc.source_sale_id AND msl.line_type='membership' AND msl.item_id=pmr.membership_id
            LEFT JOIN services svc ON svc.tenant_id=pmr.tenant_id AND svc.branch_id=pmr.branch_id AND svc.id=pmr.service_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(ii.unit_cost_paise * COALESCE(NULLIF(entry->>'quantity','')::BIGINT,NULLIF(entry->>'qty','')::BIGINT,0)),0)::BIGINT AS cost_paise
                FROM jsonb_array_elements(COALESCE(svc.product_consumption_json,'[]'::jsonb)) entry
                JOIN inventory_items ii ON ii.tenant_id=pmr.tenant_id AND ii.branch_id=pmr.branch_id
                 AND ii.id=COALESCE(entry->>'itemId',entry->>'productId',entry->>'inventoryItemId')
            ) sc ON TRUE
           WHERE pmr.tenant_id=$1 AND pmr.branch_id=$2
           GROUP BY pmr.membership_id
        )
        SELECT COALESCE(s.membership_id,r.membership_id) AS membership_id,
               COALESCE(s.membership_name,r.membership_name,'') AS membership_name,
               COALESCE(s.sold_count,0)::BIGINT AS sold_count,
               COALESCE(s.revenue_paise,0)::BIGINT AS revenue_paise,
               COALESCE(s.commission_paise,0)::BIGINT AS commission_paise,
               COALESCE(r.redeemed_credits,0)::BIGINT AS redeemed_credits,
               COALESCE(r.redeemed_value_paise,0)::BIGINT AS redeemed_value_paise,
               COALESCE(r.service_cost_paise,0)::BIGINT AS service_cost_paise,
               (COALESCE(s.revenue_paise,0)-COALESCE(s.commission_paise,0)-COALESCE(r.service_cost_paise,0))::BIGINT AS net_profit_paise
          FROM sales s FULL OUTER JOIN redemption r ON r.membership_id=s.membership_id
         ORDER BY net_profit_paise DESC,membership_name
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_all(db)
    .await
}

pub async fn create_self_service_token(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
    client_membership_id: Option<&str>,
) -> Result<PublicMembershipStatusRecord, sqlx::Error> {
    let token=sqlx::query_scalar::<_,String>("INSERT INTO membership_self_service_tokens (tenant_id,branch_id,client_id,client_membership_id) SELECT $1,$2,c.id,cm.id FROM clients c LEFT JOIN client_memberships cm ON cm.id=$4 AND cm.client_id=c.id AND cm.tenant_id=c.tenant_id AND cm.branch_id=c.branch_id WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.id=$3 RETURNING token")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(client_membership_id).fetch_one(db).await?;
    public_status(db, &token)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn public_status(
    db: &PgPool,
    token: &str,
) -> Result<Option<PublicMembershipStatusRecord>, sqlx::Error> {
    sqlx::query_as::<_,PublicMembershipStatusRecord>("SELECT t.tenant_id,t.branch_id,t.token,t.client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,t.client_membership_id,COALESCE(m.name,'') AS membership_name,CASE WHEN cm.id IS NULL THEN 'none' WHEN cm.active=FALSE THEN 'cancelled' WHEN cm.expires_at<NOW() THEN 'expired' ELSE 'active' END AS status,cm.expires_at,t.expires_at AS token_expires_at FROM membership_self_service_tokens t JOIN clients c ON c.id=t.client_id LEFT JOIN client_memberships cm ON cm.id=t.client_membership_id LEFT JOIN memberships m ON m.id=cm.membership_id WHERE t.token=$1 AND t.revoked_at IS NULL AND t.expires_at>NOW()")
        .bind(token).fetch_optional(db).await
}
