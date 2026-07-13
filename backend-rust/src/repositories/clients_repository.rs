use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct ClientRecord {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub code: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub phone: String,
    pub email: String,
    pub wallet_balance_paise: i64,
    pub duplicate_count: i64,
    pub last_visit_at: Option<DateTime<Utc>>,
    pub membership_label: String,
    pub categories_json: String,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct CreateClient<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub code: Option<&'a str>,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub phone: &'a str,
    pub email: &'a str,
    pub membership_label: &'a str,
    pub categories_json: &'a str,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: Option<&'a str>,
}

pub struct UpdateClient<'a> {
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub id: &'a str,
    pub code: Option<&'a str>,
    pub first_name: Option<&'a str>,
    pub last_name: Option<&'a str>,
    pub phone: Option<&'a str>,
    pub email: Option<&'a str>,
    pub membership_label: Option<&'a str>,
    pub categories_json: Option<&'a str>,
    pub birthday: Option<NaiveDate>,
    pub anniversary: Option<NaiveDate>,
    pub notes: Option<&'a str>,
    pub active: Option<bool>,
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    q: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ClientRecord>, sqlx::Error> {
    let sql = select_sql(
        r#"
        WHERE tenant_id = $1
          AND branch_id = $2
          AND (
            $3 = ''
            OR first_name ILIKE '%' || $3 || '%'
            OR last_name ILIKE '%' || $3 || '%'
            OR phone ILIKE '%' || $3 || '%'
            OR email ILIKE '%' || $3 || '%'
          )
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5
        "#,
    );

    sqlx::query_as::<_, ClientRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(q)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<Option<ClientRecord>, sqlx::Error> {
    let sql = select_sql(
        r#"
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        LIMIT 1
        "#,
    );

    sqlx::query_as::<_, ClientRecord>(&sql)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(id)
        .fetch_optional(db)
        .await
}

pub async fn create(db: &PgPool, input: CreateClient<'_>) -> Result<ClientRecord, sqlx::Error> {
    sqlx::query_as::<_, ClientRecord>(
        r#"
        INSERT INTO clients (
          tenant_id, branch_id, code, first_name, last_name, phone, email,
          membership_label, categories_json, birthday, anniversary, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, COALESCE($12, ''))
        RETURNING
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          email,
          wallet_balance_paise,
          0::BIGINT AS duplicate_count,
          last_visit_at,
          membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          created_at,
          updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.code)
    .bind(input.first_name)
    .bind(input.last_name)
    .bind(input.phone)
    .bind(input.email)
    .bind(input.membership_label)
    .bind(input.categories_json)
    .bind(input.birthday)
    .bind(input.anniversary)
    .bind(input.notes)
    .fetch_one(db)
    .await
}

pub async fn update(
    db: &PgPool,
    input: UpdateClient<'_>,
) -> Result<Option<ClientRecord>, sqlx::Error> {
    sqlx::query_as::<_, ClientRecord>(
        r#"
        UPDATE clients
        SET
          code = COALESCE($4, code),
          first_name = COALESCE($5, first_name),
          last_name = COALESCE($6, last_name),
          phone = COALESCE($7, phone),
          email = COALESCE($8, email),
          membership_label = COALESCE($9, membership_label),
          categories_json = COALESCE($10::jsonb, categories_json),
          active = COALESCE($11, active),
          birthday = COALESCE($12, birthday),
          anniversary = COALESCE($13, anniversary),
          notes = COALESCE($14, notes),
          updated_at = NOW()
        WHERE tenant_id = $1 AND branch_id = $2 AND id = $3
        RETURNING
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          email,
          wallet_balance_paise,
          0::BIGINT AS duplicate_count,
          last_visit_at,
          membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          created_at,
          updated_at
        "#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.id)
    .bind(input.code)
    .bind(input.first_name)
    .bind(input.last_name)
    .bind(input.phone)
    .bind(input.email)
    .bind(input.membership_label)
    .bind(input.categories_json)
    .bind(input.active)
    .bind(input.birthday)
    .bind(input.anniversary)
    .bind(input.notes)
    .fetch_optional(db)
    .await
}

fn select_sql(where_clause: &str) -> String {
    format!(
        r#"
        SELECT
          id,
          tenant_id,
          branch_id,
          code,
          first_name,
          last_name,
          phone,
          email,
          wallet_balance_paise,
          CASE WHEN phone = '' THEN 0 ELSE (
            SELECT COUNT(*) - 1
              FROM clients duplicate_client
             WHERE duplicate_client.tenant_id = clients.tenant_id
               AND duplicate_client.phone = clients.phone
          ) END::BIGINT AS duplicate_count,
          last_visit_at,
          COALESCE((
            SELECT membership.name
              FROM client_memberships client_membership
              JOIN memberships membership
                ON membership.id = client_membership.membership_id
               AND membership.tenant_id = client_membership.tenant_id
               AND membership.branch_id = client_membership.branch_id
             WHERE client_membership.tenant_id = clients.tenant_id
               AND client_membership.branch_id = clients.branch_id
               AND (
                 client_membership.client_id = clients.id
                 OR EXISTS (
                   SELECT 1 FROM membership_family_members family
                    WHERE family.tenant_id = clients.tenant_id
                      AND family.branch_id = clients.branch_id
                      AND family.client_membership_id = client_membership.id
                      AND family.member_client_id = clients.id
                      AND family.active = TRUE
                 )
               )
               AND client_membership.active = TRUE
               AND (client_membership.expires_at IS NULL OR client_membership.expires_at >= NOW())
             ORDER BY client_membership.assigned_at DESC
             LIMIT 1
          ), membership_label) AS membership_label,
          categories_json::TEXT AS categories_json,
          birthday,
          anniversary,
          notes,
          active,
          created_at,
          updated_at
        FROM clients
        {where_clause}
        "#
    )
}
