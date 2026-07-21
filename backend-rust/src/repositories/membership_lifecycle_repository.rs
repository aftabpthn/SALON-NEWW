use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, PgPool};

#[derive(FromRow)]
pub struct ActiveMembershipRecord {
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub membership_id: String,
    pub membership_name: String,
    pub price_paise: i64,
    pub discount_percent: i32,
    pub source_sale_id: String,
    pub assigned_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub active: bool,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub cancel_reason: String,
    pub remaining_credits: i64,
    pub auto_renew_enabled: bool,
    pub auto_renew_status: String,
    pub pending_membership_id: Option<String>,
    pub frozen_at: Option<DateTime<Utc>>,
    pub frozen_until: Option<chrono::NaiveDate>,
    pub freeze_reason: String,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleLedgerRecord {
    pub id: String,
    pub client_membership_id: String,
    pub client_name: String,
    pub membership_name: String,
    pub event_type: String,
    pub source_sale_id: String,
    pub reason: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenewalQueueRecord {
    pub id: String,
    pub client_name: String,
    pub membership_name: String,
    pub expires_at: DateTime<Utc>,
    pub days_until_expiry: i64,
    pub auto_renew_status: String,
    pub failure_count: i32,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipReportRecord {
    pub active_members: i64,
    pub expired_members: i64,
    pub cancelled_members: i64,
    pub credit_liability: i64,
    pub membership_sales_paise: i64,
    pub redeemed_credits: i64,
    pub at_risk_members: i64,
    pub auto_renew_failed: i64,
    pub commission_paise: i64,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChangeRecord {
    pub id: String,
    pub client_membership_id: String,
    pub client_name: String,
    pub from_membership_id: String,
    pub target_membership_id: String,
    pub target_membership_name: String,
    pub change_type: String,
    pub effective_at: String,
    pub remaining_days: i32,
    pub charge_paise: i64,
    pub credit_paise: i64,
    pub status: String,
    pub source_sale_id: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow)]
pub struct PlanChangeContext {
    pub client_id: String,
    pub from_membership_id: String,
    pub from_membership_name: String,
    pub from_price_paise: i64,
    pub from_validity_days: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub target_membership_id: String,
    pub target_membership_name: String,
    pub target_price_paise: i64,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyMemberRecord {
    pub id: String,
    pub client_membership_id: String,
    pub owner_client_id: String,
    pub owner_name: String,
    pub member_client_id: String,
    pub member_name: String,
    pub membership_name: String,
    pub relationship: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfServiceRequestRecord {
    pub id: String,
    pub client_membership_id: String,
    pub client_id: String,
    pub client_name: String,
    pub membership_name: String,
    pub request_type: String,
    pub target_membership_id: Option<String>,
    pub target_membership_name: String,
    pub reason: String,
    pub status: String,
    pub resolution_note: String,
    pub credit_delta: i32,
    pub service_id: String,
    pub payment_reference: String,
    pub created_at: DateTime<Utc>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRenewAttemptRecord {
    pub id: String,
    pub client_membership_id: String,
    pub client_name: String,
    pub membership_name: String,
    pub attempt_number: i32,
    pub status: String,
    pub source_sale_id: String,
    pub error_message: String,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug)]
pub struct AutoRenewProviderContext {
    pub attempt_id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub client_membership_id: String,
    pub client_id: String,
    pub membership_id: String,
    pub membership_name: String,
    pub price_paise: i64,
    pub payment_reference: String,
    pub provider_cycle_end: i64,
}

#[derive(FromRow)]
pub struct ClientMembershipEligibilityRecord {
    pub membership_id: String,
    pub membership_name: String,
    pub plan_type: String,
    pub discount_percent: i32,
    pub service_ids: Value,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipWalletCreditRecord {
    pub membership_id: String,
    pub membership_name: String,
    pub service_id: String,
    pub service_name: String,
    pub total_qty: i32,
    pub remaining_qty: i32,
    pub expires_at: Option<chrono::NaiveDate>,
}

const BASE_SQL: &str = r#"
 SELECT cm.id, cm.client_id, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name,
   cm.membership_id, m.name AS membership_name, m.price_paise, m.discount_percent,
   cm.source_sale_id, cm.assigned_at, cm.expires_at,
   cm.active, cm.cancelled_at, cm.cancel_reason,
   COALESCE(SUM(cmc.remaining_qty) FILTER (WHERE cmc.active AND (cmc.expires_at IS NULL OR cmc.expires_at >= CURRENT_DATE)), 0)::BIGINT AS remaining_credits
   , cm.auto_renew_enabled, cm.auto_renew_status, cm.pending_membership_id,
     cm.frozen_at, cm.frozen_until, cm.freeze_reason
 FROM client_memberships cm
 JOIN clients c ON c.id=cm.client_id AND c.tenant_id=cm.tenant_id AND c.branch_id=cm.branch_id
 JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id
 LEFT JOIN client_membership_credits cmc ON cmc.tenant_id=cm.tenant_id AND cmc.branch_id=cm.branch_id AND cmc.client_id=cm.client_id AND cmc.membership_id=cm.membership_id AND cmc.source_sale_id=cm.source_sale_id
"#;

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<ActiveMembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, ActiveMembershipRecord>(&format!("{BASE_SQL} WHERE cm.tenant_id=$1 AND cm.branch_id=$2 GROUP BY cm.id, c.first_name, c.last_name, m.name, m.price_paise, m.discount_percent, cm.frozen_at, cm.frozen_until, cm.freeze_reason ORDER BY cm.assigned_at DESC"))
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn by_source_sale(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_sale_id: &str,
) -> Result<Option<ActiveMembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, ActiveMembershipRecord>(&format!("{BASE_SQL} WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.source_sale_id=$3 GROUP BY cm.id, c.first_name, c.last_name, m.name, m.price_paise, m.discount_percent, cm.frozen_at, cm.frozen_until, cm.freeze_reason LIMIT 1"))
        .bind(tenant_id).bind(branch_id).bind(source_sale_id).fetch_optional(db).await
}

pub async fn by_id(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<ActiveMembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, ActiveMembershipRecord>(&format!("{BASE_SQL} WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.id=$3 GROUP BY cm.id, c.first_name, c.last_name, m.name, m.price_paise, m.discount_percent, cm.frozen_at, cm.frozen_until, cm.freeze_reason LIMIT 1"))
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn history_for_client(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<ActiveMembershipRecord>, sqlx::Error> {
    sqlx::query_as::<_, ActiveMembershipRecord>(&format!("{BASE_SQL} WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.client_id=$3 GROUP BY cm.id, c.first_name, c.last_name, m.name, m.price_paise, m.discount_percent, cm.frozen_at, cm.frozen_until, cm.freeze_reason ORDER BY cm.assigned_at DESC"))
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn cancel(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, (String, String, String)>("SELECT client_id, membership_id, source_sale_id FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut *tx).await?;
    let Some((client_id, membership_id, source_sale_id)) = row else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query("UPDATE client_memberships SET active=FALSE, cancelled_at=NOW(), cancel_reason=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(reason).execute(&mut *tx).await?;
    sqlx::query("UPDATE client_membership_credits SET active=FALSE, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND membership_id=$4 AND source_sale_id=$5")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(membership_id).bind(&source_sale_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id, branch_id, client_membership_id, event_type, source_sale_id, reason) VALUES ($1,$2,$3,'cancelled',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(source_sale_id).bind(reason).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn freeze(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    days: i32,
    reason: &str,
) -> Result<bool, sqlx::Error> {
    if !(1..=366).contains(&days) {
        return Ok(false);
    }
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, (String, String, String, Option<DateTime<Utc>>)>(
        "SELECT client_id, membership_id, source_sale_id, frozen_at FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((_client_id, _membership_id, source_sale_id, frozen_at)) = row else {
        tx.rollback().await?;
        return Ok(false);
    };
    if frozen_at.is_some() {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("UPDATE client_memberships SET frozen_at=NOW(), frozen_until=CURRENT_DATE + $4, freeze_reason=$5, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(days).bind(reason.trim())
        .execute(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,source_sale_id,reason) VALUES ($1,$2,$3,'frozen',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(source_sale_id).bind(reason.trim())
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn resume(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, (String, String, String, Option<DateTime<Utc>>)>(
        "SELECT client_id, membership_id, source_sale_id, frozen_at FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE FOR UPDATE",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((client_id, membership_id, source_sale_id, frozen_at)) = row else {
        tx.rollback().await?;
        return Ok(false);
    };
    let Some(frozen_at) = frozen_at else {
        tx.rollback().await?;
        return Ok(false);
    };
    let elapsed_days = (Utc::now().date_naive() - frozen_at.date_naive())
        .num_days()
        .max(0);
    sqlx::query("UPDATE client_memberships SET expires_at=CASE WHEN expires_at IS NULL THEN NULL ELSE expires_at + ($4::BIGINT * INTERVAL '1 day') END, frozen_at=NULL, frozen_until=NULL, freeze_reason='', updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(elapsed_days)
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE client_membership_credits SET expires_at=CASE WHEN expires_at IS NULL THEN NULL ELSE expires_at + ($6::BIGINT * INTERVAL '1 day') END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_id=$3 AND membership_id=$4 AND source_sale_id=$5 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(client_id).bind(membership_id).bind(&source_sale_id).bind(elapsed_days)
        .execute(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,source_sale_id,reason) VALUES ($1,$2,$3,'resumed',$4,$5)")
        .bind(tenant_id).bind(branch_id).bind(id).bind(source_sale_id)
        .bind(format!("resumed after {elapsed_days} day(s) frozen"))
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn ledger(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    limit: i64,
) -> Result<Vec<LifecycleLedgerRecord>, sqlx::Error> {
    sqlx::query_as::<_, LifecycleLedgerRecord>("SELECT l.id, l.client_membership_id, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name, m.name AS membership_name, l.event_type, l.source_sale_id, l.reason, l.created_at FROM membership_lifecycle_ledger l JOIN client_memberships cm ON cm.id=l.client_membership_id JOIN clients c ON c.id=cm.client_id JOIN memberships m ON m.id=cm.membership_id WHERE l.tenant_id=$1 AND l.branch_id=$2 ORDER BY l.created_at DESC LIMIT $3")
        .bind(tenant_id).bind(branch_id).bind(limit).fetch_all(db).await
}

pub async fn ledger_for_client(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<LifecycleLedgerRecord>, sqlx::Error> {
    sqlx::query_as::<_, LifecycleLedgerRecord>("SELECT l.id, l.client_membership_id, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name, m.name AS membership_name, l.event_type, l.source_sale_id, l.reason, l.created_at FROM membership_lifecycle_ledger l JOIN client_memberships cm ON cm.id=l.client_membership_id JOIN clients c ON c.id=cm.client_id JOIN memberships m ON m.id=cm.membership_id WHERE l.tenant_id=$1 AND l.branch_id=$2 AND cm.client_id=$3 ORDER BY l.created_at DESC")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn renewal_queue(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i64,
) -> Result<Vec<RenewalQueueRecord>, sqlx::Error> {
    sqlx::query_as::<_, RenewalQueueRecord>("SELECT cm.id, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name, m.name AS membership_name, cm.expires_at, EXTRACT(DAY FROM cm.expires_at - NOW())::BIGINT AS days_until_expiry, cm.auto_renew_status, cm.auto_renew_failure_count AS failure_count FROM client_memberships cm JOIN clients c ON c.id=cm.client_id JOIN memberships m ON m.id=cm.membership_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.active=TRUE AND cm.frozen_at IS NULL AND cm.auto_renew_enabled=TRUE AND cm.auto_renew_status <> 'paused' AND cm.expires_at IS NOT NULL AND cm.expires_at <= NOW() + ($3::INT * INTERVAL '1 day') AND (cm.next_renewal_at IS NULL OR cm.next_renewal_at<=NOW()+($3::INT*INTERVAL '1 day')) ORDER BY cm.expires_at ASC")
        .bind(tenant_id).bind(branch_id).bind(days).fetch_all(db).await
}

pub async fn reminders(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    days: i64,
) -> Result<Vec<RenewalQueueRecord>, sqlx::Error> {
    sqlx::query_as::<_, RenewalQueueRecord>("SELECT cm.id, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name, m.name AS membership_name, cm.expires_at, EXTRACT(DAY FROM cm.expires_at - NOW())::BIGINT AS days_until_expiry, cm.auto_renew_status, cm.auto_renew_failure_count AS failure_count FROM client_memberships cm JOIN clients c ON c.id=cm.client_id JOIN memberships m ON m.id=cm.membership_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.active=TRUE AND cm.frozen_at IS NULL AND cm.expires_at IS NOT NULL AND cm.expires_at >= NOW() AND cm.expires_at <= NOW() + ($3::INT * INTERVAL '1 day') ORDER BY cm.expires_at ASC")
        .bind(tenant_id).bind(branch_id).bind(days).fetch_all(db).await
}

pub async fn set_auto_renew(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    enabled: bool,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE client_memberships SET auto_renew_enabled=$4, auto_renew_status=CASE WHEN $4 THEN 'active' ELSE 'disabled' END, auto_renew_failure_count=CASE WHEN $4 THEN auto_renew_failure_count ELSE 0 END, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(id).bind(enabled).execute(db).await?.rows_affected() > 0)
}

pub async fn report(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<MembershipReportRecord, sqlx::Error> {
    sqlx::query_as::<_, MembershipReportRecord>(
        r#"
        SELECT
          (SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND (expires_at IS NULL OR expires_at >= NOW()))::BIGINT AS active_members,
          (SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND expires_at < NOW())::BIGINT AS expired_members,
          (SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=FALSE AND cancelled_at IS NOT NULL)::BIGINT AS cancelled_members,
          (SELECT COALESCE(SUM(remaining_qty),0) FROM client_membership_credits WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND (expires_at IS NULL OR expires_at >= CURRENT_DATE))::BIGINT AS credit_liability,
          (SELECT COALESCE(SUM(line_total_paise),0) FROM pos_sale_lines WHERE tenant_id=$1 AND branch_id=$2 AND line_type='membership')::BIGINT AS membership_sales_paise,
          (SELECT COALESCE(SUM(quantity),0) FROM pos_membership_redemptions WHERE tenant_id=$1 AND branch_id=$2)::BIGINT AS redeemed_credits,
          (SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND expires_at BETWEEN NOW() AND NOW()+INTERVAL '30 days' AND (auto_renew_enabled=FALSE OR auto_renew_status IN ('failed','payment_required')))::BIGINT AS at_risk_members,
          (SELECT COUNT(*) FROM client_memberships WHERE tenant_id=$1 AND branch_id=$2 AND active=TRUE AND auto_renew_status IN ('failed','payment_required'))::BIGINT AS auto_renew_failed,
          (
            SELECT COALESCE(SUM(COALESCE(
              snap.commission_paise,
              ((psl.taxable_paise*COALESCE(sca.commission_percent,scr.rate_percent,0)+50)/100)
            )),0)
            FROM pos_sale_lines psl
            JOIN pos_sales ps ON ps.id=psl.sale_id AND ps.tenant_id=psl.tenant_id AND ps.branch_id=psl.branch_id
            LEFT JOIN LATERAL (
              SELECT SUM(commission_paise)::BIGINT AS commission_paise
              FROM pos_staff_commission_snapshots snap
              WHERE snap.tenant_id=psl.tenant_id AND snap.branch_id=psl.branch_id AND snap.sale_line_id=psl.id
            ) snap ON TRUE
            LEFT JOIN staff_catalog_assignments sca ON sca.staff_id=psl.staff_id AND sca.item_type='membership' AND sca.item_id=psl.item_id AND sca.tenant_id=psl.tenant_id AND sca.branch_id=psl.branch_id
            LEFT JOIN LATERAL (
              SELECT rate_percent
              FROM staff_commission_rules
              WHERE tenant_id=psl.tenant_id AND branch_id=psl.branch_id AND staff_id=psl.staff_id
                AND active=TRUE AND applies_to IN ('membership','all')
                AND (effective_from IS NULL OR effective_from <= ps.business_date)
              ORDER BY CASE WHEN applies_to='membership' THEN 0 ELSE 1 END,effective_from DESC NULLS LAST,created_at DESC
              LIMIT 1
            ) scr ON TRUE
            WHERE psl.tenant_id=$1 AND psl.branch_id=$2 AND psl.line_type='membership'
              AND ps.status NOT IN ('draft','cancelled','voided')
          )::BIGINT AS commission_paise
        "#,
    )
        .bind(tenant_id).bind(branch_id).fetch_one(db).await
}

pub async fn client_eligibility(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Option<ClientMembershipEligibilityRecord>, sqlx::Error> {
    sqlx::query_as::<_, ClientMembershipEligibilityRecord>("SELECT cm.membership_id, m.name AS membership_name, m.plan_type, m.discount_percent, m.service_ids_json AS service_ids, cm.expires_at FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id AND m.active=TRUE WHERE cm.tenant_id=$1 AND ((cm.branch_id=$2 AND (cm.client_id=$3 OR (COALESCE((SELECT (settings_json#>>'{redemptionRules,allowFamilySharing}')::BOOLEAN FROM membership_settings WHERE tenant_id=$1 AND branch_id=$2),TRUE) AND EXISTS (SELECT 1 FROM membership_family_members fm WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.client_membership_id=cm.id AND fm.member_client_id=$3 AND fm.active=TRUE)))) OR membership_cross_location_allowed($1,cm.branch_id,$2,cm.client_id,$3,'discount')) AND cm.active=TRUE AND cm.frozen_at IS NULL AND cm.assigned_at<=NOW() AND (cm.expires_at IS NULL OR cm.expires_at>=NOW()) ORDER BY (cm.branch_id=$2) DESC,cm.assigned_at DESC LIMIT 1")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_optional(db).await
}

pub async fn client_wallet(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_id: &str,
) -> Result<Vec<MembershipWalletCreditRecord>, sqlx::Error> {
    sqlx::query_as::<_, MembershipWalletCreditRecord>("SELECT membership_id, membership_name, service_id, service_name, total_qty, remaining_qty, expires_at FROM client_membership_credits cmc WHERE tenant_id=$1 AND branch_id=$2 AND (client_id=$3 OR EXISTS (SELECT 1 FROM membership_family_members fm JOIN client_memberships cm ON cm.id=fm.client_membership_id AND cm.active=TRUE WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.member_client_id=$3 AND fm.owner_client_id=cmc.client_id AND fm.active=TRUE)) AND active=TRUE AND remaining_qty > 0 AND (expires_at IS NULL OR expires_at >= CURRENT_DATE) ORDER BY expires_at NULLS LAST, membership_name, service_name")
        .bind(tenant_id).bind(branch_id).bind(client_id).fetch_all(db).await
}

pub async fn plan_change_context(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    target_membership_id: &str,
) -> Result<Option<PlanChangeContext>, sqlx::Error> {
    sqlx::query_as::<_, PlanChangeContext>("SELECT cm.client_id, cm.membership_id AS from_membership_id, current_plan.name AS from_membership_name, current_plan.price_paise AS from_price_paise, current_plan.validity_days AS from_validity_days, cm.expires_at, target.id AS target_membership_id, target.name AS target_membership_name, target.price_paise AS target_price_paise FROM client_memberships cm JOIN memberships current_plan ON current_plan.id=cm.membership_id AND current_plan.tenant_id=cm.tenant_id AND current_plan.branch_id=cm.branch_id JOIN memberships target ON target.id=$4 AND target.tenant_id=cm.tenant_id AND target.branch_id=cm.branch_id AND target.active=TRUE WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.id=$3 AND cm.active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(target_membership_id).fetch_optional(db).await
}

pub struct NewPlanChange<'a> {
    pub client_membership_id: &'a str,
    pub client_id: &'a str,
    pub from_membership_id: &'a str,
    pub target_membership_id: &'a str,
    pub change_type: &'a str,
    pub effective_at: &'a str,
    pub remaining_days: i32,
    pub charge_paise: i64,
    pub credit_paise: i64,
}

pub async fn create_plan_change(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: NewPlanChange<'_>,
) -> Result<PlanChangeRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let status = if input.effective_at == "renewal" {
        "scheduled"
    } else {
        "pending_checkout"
    };
    sqlx::query("UPDATE membership_plan_changes SET status='cancelled',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND client_membership_id=$3 AND status IN ('pending_checkout','scheduled')")
        .bind(tenant_id).bind(branch_id).bind(input.client_membership_id).execute(&mut *tx).await?;
    let id = sqlx::query_scalar::<_, String>("INSERT INTO membership_plan_changes (tenant_id,branch_id,client_membership_id,client_id,from_membership_id,target_membership_id,change_type,effective_at,remaining_days,charge_paise,credit_paise,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(input.client_membership_id).bind(input.client_id).bind(input.from_membership_id).bind(input.target_membership_id).bind(input.change_type).bind(input.effective_at).bind(input.remaining_days).bind(input.charge_paise).bind(input.credit_paise).bind(status).fetch_one(&mut *tx).await?;
    if input.effective_at == "renewal" {
        sqlx::query("UPDATE client_memberships SET pending_membership_id=$4, updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(input.client_membership_id).bind(input.target_membership_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'plan_change_scheduled',$4)")
            .bind(tenant_id).bind(branch_id).bind(input.client_membership_id).bind(&id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    get_plan_change(db, tenant_id, branch_id, &id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn get_plan_change(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<PlanChangeRecord>, sqlx::Error> {
    sqlx::query_as::<_, PlanChangeRecord>("SELECT pc.id,pc.client_membership_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,pc.from_membership_id,f.name AS from_membership_name,pc.target_membership_id,t.name AS target_membership_name,pc.change_type,pc.effective_at,pc.remaining_days,pc.charge_paise,pc.credit_paise,pc.status,pc.source_sale_id,pc.created_at FROM membership_plan_changes pc JOIN clients c ON c.id=pc.client_id JOIN memberships f ON f.id=pc.from_membership_id JOIN memberships t ON t.id=pc.target_membership_id WHERE pc.tenant_id=$1 AND pc.branch_id=$2 AND pc.id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn list_plan_changes(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<PlanChangeRecord>, sqlx::Error> {
    sqlx::query_as::<_, PlanChangeRecord>("SELECT pc.id,pc.client_membership_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,pc.from_membership_id,f.name AS from_membership_name,pc.target_membership_id,t.name AS target_membership_name,pc.change_type,pc.effective_at,pc.remaining_days,pc.charge_paise,pc.credit_paise,pc.status,pc.source_sale_id,pc.created_at FROM membership_plan_changes pc JOIN clients c ON c.id=pc.client_id JOIN memberships f ON f.id=pc.from_membership_id JOIN memberships t ON t.id=pc.target_membership_id WHERE pc.tenant_id=$1 AND pc.branch_id=$2 ORDER BY pc.created_at DESC LIMIT 250")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn family_capacity(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
) -> Result<Option<(String, i64, i64)>, sqlx::Error> {
    sqlx::query_as::<_, (String, i64, i64)>("SELECT cm.client_id, CASE WHEN COALESCE(m.benefit_rules->>'familyLimit','') ~ '^[0-9]+$' THEN (m.benefit_rules->>'familyLimit')::BIGINT ELSE 5 END, (SELECT COUNT(*) FROM membership_family_members fm WHERE fm.tenant_id=cm.tenant_id AND fm.branch_id=cm.branch_id AND fm.client_membership_id=cm.id AND fm.active=TRUE)::BIGINT FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.id=$3 AND cm.active=TRUE AND m.plan_type='family'")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).fetch_optional(db).await
}

pub async fn add_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    owner_client_id: &str,
    member_client_id: &str,
    relationship: &str,
) -> Result<FamilyMemberRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, String>("INSERT INTO membership_family_members (tenant_id,branch_id,client_membership_id,owner_client_id,member_client_id,relationship) SELECT $1,$2,$3,$4,c.id,$6 FROM clients c WHERE c.tenant_id=$1 AND c.branch_id=$2 AND c.id=$5 AND c.active=TRUE RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(owner_client_id).bind(member_client_id).bind(relationship).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'family_member_added',$4)")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(member_client_id).execute(&mut *tx).await?;
    tx.commit().await?;
    get_family_member(db, tenant_id, branch_id, &id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

async fn get_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<FamilyMemberRecord>, sqlx::Error> {
    sqlx::query_as::<_, FamilyMemberRecord>("SELECT fm.id,fm.client_membership_id,fm.owner_client_id,CONCAT_WS(' ',o.first_name,o.last_name) AS owner_name,fm.member_client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS member_name,m.name AS membership_name,fm.relationship,fm.created_at FROM membership_family_members fm JOIN clients o ON o.id=fm.owner_client_id JOIN clients c ON c.id=fm.member_client_id JOIN client_memberships cm ON cm.id=fm.client_membership_id JOIN memberships m ON m.id=cm.membership_id WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.id=$3 AND fm.active=TRUE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn list_family_members(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<FamilyMemberRecord>, sqlx::Error> {
    sqlx::query_as::<_, FamilyMemberRecord>("SELECT fm.id,fm.client_membership_id,fm.owner_client_id,CONCAT_WS(' ',o.first_name,o.last_name) AS owner_name,fm.member_client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS member_name,m.name AS membership_name,fm.relationship,fm.created_at FROM membership_family_members fm JOIN clients o ON o.id=fm.owner_client_id JOIN clients c ON c.id=fm.member_client_id JOIN client_memberships cm ON cm.id=fm.client_membership_id JOIN memberships m ON m.id=cm.membership_id WHERE fm.tenant_id=$1 AND fm.branch_id=$2 AND fm.active=TRUE ORDER BY fm.created_at DESC")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn remove_family_member(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, (String,String)>("UPDATE membership_family_members SET active=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE RETURNING client_membership_id,member_client_id")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut *tx).await?;
    let Some((membership_id, member_id)) = row else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'family_member_removed',$4)")
        .bind(tenant_id).bind(branch_id).bind(membership_id).bind(member_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn list_self_service_requests(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<SelfServiceRequestRecord>, sqlx::Error> {
    sqlx::query_as::<_, SelfServiceRequestRecord>("SELECT r.id,r.client_membership_id,r.client_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,m.name AS membership_name,r.request_type,r.target_membership_id,COALESCE(t.name,'') AS target_membership_name,r.reason,r.status,r.resolution_note,r.credit_delta,r.service_id,r.payment_reference,r.created_at FROM membership_self_service_requests r JOIN clients c ON c.id=r.client_id JOIN client_memberships cm ON cm.id=r.client_membership_id JOIN memberships m ON m.id=cm.membership_id LEFT JOIN memberships t ON t.id=r.target_membership_id WHERE r.tenant_id=$1 AND r.branch_id=$2 ORDER BY r.created_at DESC LIMIT 250")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

pub async fn create_self_service_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
    request_type: &str,
    target_membership_id: Option<&str>,
    reason: &str,
    credit_delta: i32,
    service_id: &str,
    payment_reference: &str,
) -> Result<SelfServiceRequestRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let id=sqlx::query_scalar::<_,String>("INSERT INTO membership_self_service_requests (tenant_id,branch_id,client_membership_id,client_id,request_type,target_membership_id,reason,credit_delta,service_id,payment_reference) SELECT $1,$2,cm.id,cm.client_id,$4,$5,$6,$7,$8,$9 FROM client_memberships cm WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.id=$3 AND cm.active=TRUE RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(request_type).bind(target_membership_id).bind(reason).bind(credit_delta).bind(service_id).bind(payment_reference).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'self_service_requested',$4)")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    list_self_service_requests(db, tenant_id, branch_id)
        .await?
        .into_iter()
        .find(|row| row.id == id)
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn resolve_self_service_request(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
    note: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let request=sqlx::query_as::<_,(String,String,i32,String,String)>("SELECT client_membership_id,request_type,credit_delta,service_id,payment_reference FROM membership_self_service_requests WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND status='pending' FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(&mut *tx).await?;
    let Some((membership_id, request_type, delta, service_id, payment_reference)) = request else {
        tx.rollback().await?;
        return Ok(false);
    };
    if status == "approved" && request_type == "payment_method_update" {
        sqlx::query("UPDATE client_memberships SET auto_renew_payment_reference=$4,auto_renew_enabled=TRUE,auto_renew_status='active',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id).bind(branch_id).bind(&membership_id).bind(&payment_reference).execute(&mut *tx).await?;
        upsert_verified_payment_mandate(
            &mut tx,
            tenant_id,
            branch_id,
            &membership_id,
            &payment_reference,
        )
        .await?;
    }
    if status == "approved" && request_type == "credit_adjustment" {
        let credit=sqlx::query_as::<_,(String,i32,i32)>("SELECT cmc.id,cmc.total_qty,cmc.remaining_qty FROM client_membership_credits cmc JOIN client_memberships cm ON cm.client_id=cmc.client_id AND cm.membership_id=cmc.membership_id AND cm.source_sale_id=cmc.source_sale_id WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.id=$3 AND cmc.service_id=$4 AND cmc.active=TRUE FOR UPDATE")
            .bind(tenant_id).bind(branch_id).bind(&membership_id).bind(&service_id).fetch_one(&mut *tx).await?;
        let after_remaining = credit
            .2
            .checked_add(delta)
            .filter(|value| *value >= 0)
            .ok_or(sqlx::Error::Protocol(
                "credit adjustment exceeds available balance".into(),
            ))?;
        let after_total = if delta > 0 {
            credit.1.saturating_add(delta)
        } else {
            credit.1
        };
        sqlx::query("UPDATE client_membership_credits SET total_qty=$5,remaining_qty=$6,active=($6>0),updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND service_id=$4")
            .bind(tenant_id).bind(branch_id).bind(&credit.0).bind(&service_id).bind(after_total).bind(after_remaining).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO membership_credit_adjustments (tenant_id,branch_id,request_id,client_membership_id,client_membership_credit_id,service_id,delta,before_total,after_total,before_remaining,after_remaining,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
            .bind(tenant_id).bind(branch_id).bind(id).bind(&membership_id).bind(&credit.0).bind(&service_id).bind(delta).bind(credit.1).bind(after_total).bind(credit.2).bind(after_remaining).bind(note).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE membership_self_service_requests SET status=$4,resolution_note=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).bind(status).bind(note).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'self_service_resolved',$4)")
        .bind(tenant_id).bind(branch_id).bind(membership_id).bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

async fn upsert_verified_payment_mandate(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    membership_id: &str,
    payment_reference: &str,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        r#"
        INSERT INTO client_payment_instruments (
            tenant_id, branch_id, client_id, provider, provider_instrument_id,
            method_type, recurring_enabled, status, consent_source, consented_at,
            last_used_at, updated_at
        )
        SELECT $1,$2,cm.client_id,'razorpay',$4,'recurring_mandate',TRUE,'active',
               'verified_subscription',NOW(),NOW(),NOW()
          FROM client_memberships cm
         WHERE cm.tenant_id=$1 AND cm.branch_id=$2 AND cm.id=$3 AND cm.active=TRUE
        ON CONFLICT (tenant_id,provider,provider_instrument_id)
        DO UPDATE SET branch_id=EXCLUDED.branch_id, client_id=EXCLUDED.client_id,
                      recurring_enabled=TRUE, status='active', revoked_at=NULL,
                      consent_source='verified_subscription', consented_at=NOW(),
                      last_used_at=NOW(), updated_at=NOW()
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(membership_id)
    .bind(payment_reference)
    .execute(&mut **tx)
    .await?
    .rows_affected()
        > 0)
}

pub async fn register_verified_payment_mandate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    membership_id: &str,
    payment_reference: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = upsert_verified_payment_mandate(
        &mut tx,
        tenant_id,
        branch_id,
        membership_id,
        payment_reference,
    )
    .await?;
    tx.commit().await?;
    Ok(changed)
}

pub async fn set_auto_renew_status(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    status: &str,
) -> Result<bool, sqlx::Error> {
    let enabled = status != "disabled";
    let mut tx = db.begin().await?;
    let changed=sqlx::query("UPDATE client_memberships SET auto_renew_enabled=$4,auto_renew_status=$5,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND ($5<>'active' OR EXISTS (SELECT 1 FROM client_payment_instruments instrument WHERE instrument.tenant_id=client_memberships.tenant_id AND instrument.branch_id=client_memberships.branch_id AND instrument.client_id=client_memberships.client_id AND instrument.provider_instrument_id=client_memberships.auto_renew_payment_reference AND instrument.status='active' AND instrument.recurring_enabled=TRUE))")
        .bind(tenant_id).bind(branch_id).bind(id).bind(enabled).bind(status).execute(&mut *tx).await?.rows_affected()>0;
    if changed && matches!(status, "paused" | "active") {
        let event = if status == "paused" {
            "auto_renew_paused"
        } else {
            "auto_renew_resumed"
        };
        sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,$4,$5)")
            .bind(tenant_id).bind(branch_id).bind(id).bind(event).bind(status).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(changed)
}

pub async fn create_auto_renew_attempt(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    client_membership_id: &str,
) -> Result<AutoRenewAttemptRecord, sqlx::Error> {
    let mut tx = db.begin().await?;
    let attempt_number=sqlx::query_scalar::<_,i32>("SELECT COALESCE((SELECT MAX(a.attempt_number) FROM membership_auto_renew_attempts a WHERE a.tenant_id=cm.tenant_id AND a.branch_id=cm.branch_id AND a.client_membership_id=cm.id),0)+1 FROM client_memberships cm WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 AND active=TRUE AND auto_renew_enabled=TRUE AND auto_renew_status<>'paused' FOR UPDATE")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).fetch_one(&mut *tx).await?;
    let id=sqlx::query_scalar::<_,String>("INSERT INTO membership_auto_renew_attempts (tenant_id,branch_id,client_membership_id,attempt_number,status,error_message,next_retry_at) VALUES ($1,$2,$3,$4,'payment_required','Saved payment mandate required',NOW()+INTERVAL '1 day') RETURNING id")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(attempt_number).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE client_memberships SET auto_renew_status='payment_required',auto_renew_failure_count=auto_renew_failure_count+1,next_renewal_at=NOW()+INTERVAL '1 day',updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'auto_renew_failed',$4)")
        .bind(tenant_id).bind(branch_id).bind(client_membership_id).bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    get_auto_renew_attempt(db, tenant_id, branch_id, &id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn claim_due_auto_renewals(
    db: &PgPool,
    limit: i64,
) -> Result<Vec<AutoRenewProviderContext>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let due = sqlx::query_as::<_, (String,String,String,String,String,String,i64,String,i64)>(
        "SELECT cm.tenant_id,cm.branch_id,cm.id,cm.client_id,cm.membership_id,m.name,m.price_paise,cm.auto_renew_payment_reference,cm.auto_renew_provider_cycle_end FROM client_memberships cm JOIN memberships m ON m.id=cm.membership_id AND m.tenant_id=cm.tenant_id AND m.branch_id=cm.branch_id WHERE cm.active=TRUE AND cm.auto_renew_enabled=TRUE AND cm.auto_renew_status<>'paused' AND cm.expires_at IS NOT NULL AND cm.expires_at<=NOW() AND (cm.next_renewal_at IS NULL OR cm.next_renewal_at<=NOW()) AND cm.auto_renew_payment_reference<>'' ORDER BY cm.expires_at FOR UPDATE OF cm SKIP LOCKED LIMIT $1",
    )
    .bind(limit)
    .fetch_all(&mut *tx)
    .await?;
    let mut claimed = Vec::with_capacity(due.len());
    for (
        tenant_id,
        branch_id,
        client_membership_id,
        client_id,
        membership_id,
        membership_name,
        price_paise,
        payment_reference,
        provider_cycle_end,
    ) in due
    {
        let attempt_number=sqlx::query_scalar::<_,i32>("SELECT COALESCE(MAX(attempt_number),0)+1 FROM membership_auto_renew_attempts WHERE tenant_id=$1 AND branch_id=$2 AND client_membership_id=$3")
            .bind(&tenant_id).bind(&branch_id).bind(&client_membership_id).fetch_one(&mut *tx).await?;
        let attempt_id=sqlx::query_scalar::<_,String>("INSERT INTO membership_auto_renew_attempts (tenant_id,branch_id,client_membership_id,attempt_number,status,provider_reference,next_retry_at) VALUES ($1,$2,$3,$4,'queued',$5,NOW()+INTERVAL '1 hour') RETURNING id")
            .bind(&tenant_id).bind(&branch_id).bind(&client_membership_id).bind(attempt_number).bind(&payment_reference).fetch_one(&mut *tx).await?;
        sqlx::query("UPDATE client_memberships SET next_renewal_at=NOW()+INTERVAL '1 hour',updated_at=NOW() WHERE id=$1")
            .bind(&client_membership_id).execute(&mut *tx).await?;
        claimed.push(AutoRenewProviderContext {
            attempt_id,
            tenant_id,
            branch_id,
            client_membership_id,
            client_id,
            membership_id,
            membership_name,
            price_paise,
            payment_reference,
            provider_cycle_end,
        });
    }
    tx.commit().await?;
    Ok(claimed)
}

pub async fn record_auto_renew_failure(
    db: &PgPool,
    context: &AutoRenewProviderContext,
    error: &str,
    provider_payload: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    let failure_count=sqlx::query_scalar::<_,i32>("UPDATE client_memberships SET auto_renew_failure_count=auto_renew_failure_count+1,auto_renew_status=CASE WHEN auto_renew_failure_count+1>=4 THEN 'payment_required' ELSE 'failed' END,next_renewal_at=CASE WHEN auto_renew_failure_count+1>=4 THEN NULL ELSE NOW()+CASE WHEN auto_renew_failure_count+1=1 THEN INTERVAL '1 hour' WHEN auto_renew_failure_count+1=2 THEN INTERVAL '6 hours' ELSE INTERVAL '1 day' END END,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING auto_renew_failure_count")
        .bind(&context.tenant_id).bind(&context.branch_id).bind(&context.client_membership_id).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE membership_auto_renew_attempts SET status=CASE WHEN $4>=4 THEN 'payment_required' ELSE 'failed' END,error_message=$2,provider_payload=$3,next_retry_at=CASE WHEN $4>=4 THEN NULL ELSE (SELECT next_renewal_at FROM client_memberships WHERE id=$5) END,updated_at=NOW() WHERE id=$1")
        .bind(&context.attempt_id).bind(error).bind(provider_payload).bind(failure_count).bind(&context.client_membership_id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO membership_lifecycle_ledger (tenant_id,branch_id,client_membership_id,event_type,reason) VALUES ($1,$2,$3,'auto_renew_failed',$4)")
        .bind(&context.tenant_id).bind(&context.branch_id).bind(&context.client_membership_id).bind(&context.attempt_id).execute(&mut *tx).await?;
    tx.commit().await
}

pub async fn record_auto_renew_cycle(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    source_sale_id: &str,
    provider_cycle_end: i64,
    provider_payload: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("UPDATE client_memberships SET auto_renew_provider_cycle_end=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND source_sale_id=$3")
        .bind(tenant_id).bind(branch_id).bind(source_sale_id).bind(provider_cycle_end).execute(&mut *tx).await?;
    sqlx::query("UPDATE membership_auto_renew_attempts SET provider_payload=$4,updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND source_sale_id=$3")
        .bind(tenant_id).bind(branch_id).bind(source_sale_id).bind(provider_payload).execute(&mut *tx).await?;
    tx.commit().await
}

async fn get_auto_renew_attempt(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<AutoRenewAttemptRecord>, sqlx::Error> {
    sqlx::query_as::<_,AutoRenewAttemptRecord>("SELECT a.id,a.client_membership_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,m.name AS membership_name,a.attempt_number,a.status,a.source_sale_id,a.error_message,a.next_retry_at,a.created_at FROM membership_auto_renew_attempts a JOIN client_memberships cm ON cm.id=a.client_membership_id JOIN clients c ON c.id=cm.client_id JOIN memberships m ON m.id=cm.membership_id WHERE a.tenant_id=$1 AND a.branch_id=$2 AND a.id=$3")
        .bind(tenant_id).bind(branch_id).bind(id).fetch_optional(db).await
}

pub async fn list_auto_renew_attempts(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<AutoRenewAttemptRecord>, sqlx::Error> {
    sqlx::query_as::<_,AutoRenewAttemptRecord>("SELECT a.id,a.client_membership_id,CONCAT_WS(' ',c.first_name,c.last_name) AS client_name,m.name AS membership_name,a.attempt_number,a.status,a.source_sale_id,a.error_message,a.next_retry_at,a.created_at FROM membership_auto_renew_attempts a JOIN client_memberships cm ON cm.id=a.client_membership_id JOIN clients c ON c.id=cm.client_id JOIN memberships m ON m.id=cm.membership_id WHERE a.tenant_id=$1 AND a.branch_id=$2 ORDER BY a.created_at DESC LIMIT 250")
        .bind(tenant_id).bind(branch_id).fetch_all(db).await
}

#[cfg(test)]
mod tests {
    use super::MembershipWalletCreditRecord;

    #[test]
    fn membership_wallet_serializes_for_angular() {
        let value = serde_json::to_value(MembershipWalletCreditRecord {
            membership_id: "membership".into(),
            membership_name: "Membership".into(),
            service_id: "service".into(),
            service_name: "Service".into(),
            total_qty: 2,
            remaining_qty: 1,
            expires_at: None,
        })
        .expect("wallet record should serialize");

        assert_eq!(value["remainingQty"], 1);
        assert!(value.get("remaining_qty").is_none());
    }
}
