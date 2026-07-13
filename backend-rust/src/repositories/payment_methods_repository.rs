use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct PaymentMethodRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub code: String,
    pub name: String,
    pub settlement_type: String,
    pub shortcut: String,
    pub active: bool,
    pub show_on_invoice: bool,
    pub reference_required: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreatePaymentMethod<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub code: &'a str,
    pub name: &'a str,
    pub settlement_type: &'a str,
    pub shortcut: &'a str,
    pub active: bool,
    pub show_on_invoice: bool,
    pub reference_required: bool,
    pub sort_order: i32,
}

pub struct UpdatePaymentMethod<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub name: Option<&'a str>,
    pub settlement_type: Option<&'a str>,
    pub shortcut: Option<&'a str>,
    pub active: Option<bool>,
    pub show_on_invoice: Option<bool>,
    pub reference_required: Option<bool>,
    pub sort_order: Option<i32>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    active_only: bool,
) -> Result<Vec<PaymentMethodRecord>, sqlx::Error> {
    sqlx::query_as::<_, PaymentMethodRecord>(
        "SELECT id, tenant_id, branch_id, code, name, settlement_type, shortcut, active, show_on_invoice, reference_required, sort_order, created_at, updated_at FROM pos_payment_method_settings WHERE tenant_id=$1 AND branch_id=$2 AND ($3=FALSE OR active=TRUE) ORDER BY sort_order, name",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(active_only)
    .fetch_all(db)
    .await
}

pub async fn ensure_defaults(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO pos_payment_method_settings (tenant_id, branch_id, code, name, settlement_type, shortcut, sort_order) VALUES ($1,$2,'cash','Cash','cash','C',10),($1,$2,'upi','UPI','upi','U',20),($1,$2,'card','Card','card','D',30),($1,$2,'wallet','Wallet','wallet','W',40),($1,$2,'bank_transfer','Online / Bank Transfer','bank_transfer','B',50),($1,$2,'gift_card','Gift Card','gift_card','G',60),($1,$2,'store_credit','Store Credit','store_credit','S',70) ON CONFLICT DO NOTHING",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn create(
    db: &PgPool,
    input: CreatePaymentMethod<'_>,
) -> Result<PaymentMethodRecord, sqlx::Error> {
    sqlx::query_as::<_, PaymentMethodRecord>(
        "INSERT INTO pos_payment_method_settings (tenant_id, branch_id, code, name, settlement_type, shortcut, active, show_on_invoice, reference_required, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, tenant_id, branch_id, code, name, settlement_type, shortcut, active, show_on_invoice, reference_required, sort_order, created_at, updated_at",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.code)
    .bind(input.name)
    .bind(input.settlement_type)
    .bind(input.shortcut)
    .bind(input.active)
    .bind(input.show_on_invoice)
    .bind(input.reference_required)
    .bind(input.sort_order)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdatePaymentMethod<'_>,
) -> Result<Option<PaymentMethodRecord>, sqlx::Error> {
    sqlx::query_as::<_, PaymentMethodRecord>(
        "UPDATE pos_payment_method_settings SET name=COALESCE($4,name), settlement_type=COALESCE($5,settlement_type), shortcut=COALESCE($6,shortcut), active=COALESCE($7,active), show_on_invoice=COALESCE($8,show_on_invoice), reference_required=COALESCE($9,reference_required), sort_order=COALESCE($10,sort_order), updated_at=NOW() WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 RETURNING id, tenant_id, branch_id, code, name, settlement_type, shortcut, active, show_on_invoice, reference_required, sort_order, created_at, updated_at",
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.name)
    .bind(input.settlement_type)
    .bind(input.shortcut)
    .bind(input.active)
    .bind(input.show_on_invoice)
    .bind(input.reference_required)
    .bind(input.sort_order)
    .fetch_optional(db)
    .await
}
