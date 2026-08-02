use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, PgPool, Postgres, Transaction};

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffDocumentRecord {
    pub id: String,
    pub staff_id: String,
    pub document_type: String,
    pub document_name: String,
    pub document_url: String,
    pub verification_status: String,
    pub expiry_date: Option<NaiveDate>,
    pub notes: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

pub struct SaveStaffDocument<'a> {
    pub id: Option<&'a str>,
    pub tenant_id: &'a str,
    pub branch_id: &'a str,
    pub staff_id: &'a str,
    pub document_type: &'a str,
    pub document_name: &'a str,
    pub document_url: &'a str,
    pub verification_status: &'a str,
    pub expiry_date: Option<NaiveDate>,
    pub notes: &'a str,
    pub created_by: &'a str,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffHistoryRecord {
    pub id: String,
    pub user_id: Option<String>,
    pub event_type: String,
    pub outcome: String,
    pub details_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct StaffFileRecord {
    pub id: String,
    pub staff_id: String,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i32,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffFileMetadata {
    pub id: String,
    pub staff_id: String,
    pub file_name: String,
    pub content_type: String,
    pub byte_size: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BulkStaffInput {
    pub employee_code: String,
    pub first_name: String,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub mobile_phone: Option<String>,
    pub job_title: Option<String>,
    pub active: Option<bool>,
    pub photo_url: Option<String>,
    pub date_of_birth: Option<NaiveDate>,
    pub joining_date: Option<NaiveDate>,
    pub gender: Option<String>,
    pub employment_type: Option<String>,
    pub department: Option<String>,
    pub reporting_manager_id: Option<String>,
    pub category_id: Option<String>,
    pub shift_template_id: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkImportResult {
    pub id: String,
    pub batch_key: String,
    pub total_rows: i32,
    pub created_rows: i32,
    pub updated_rows: i32,
    pub status: String,
    pub staff_ids: Value,
    pub created_at: DateTime<Utc>,
}

pub async fn list_documents(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<StaffDocumentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, staff_id, document_type, document_name, document_url,
                  verification_status, expiry_date, notes, created_by, created_at, updated_at
           FROM staff_documents
           WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3
           ORDER BY created_at DESC"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn get_document(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    document_id: &str,
) -> Result<Option<StaffDocumentRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id,staff_id,document_type,document_name,document_url,verification_status,
                  expiry_date,notes,created_by,created_at,updated_at
           FROM staff_documents
           WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(document_id)
    .fetch_optional(db)
    .await
}

pub async fn save_file(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    file_kind: &str,
    file_name: &str,
    content_type: &str,
    content: Vec<u8>,
    uploaded_by: &str,
) -> Result<StaffFileMetadata, sqlx::Error> {
    sqlx::query_as(
        r#"INSERT INTO staff_files(
              tenant_id,branch_id,staff_id,file_kind,file_name,content_type,byte_size,content,uploaded_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id,staff_id,file_name,content_type,byte_size"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .bind(file_kind)
    .bind(file_name)
    .bind(content_type)
    .bind(content.len() as i32)
    .bind(content)
    .bind(uploaded_by)
    .fetch_one(db)
    .await
}

pub async fn get_file(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    file_id: &str,
) -> Result<Option<StaffFileRecord>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id,staff_id,file_name,content_type,byte_size,content FROM staff_files WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(file_id)
    .fetch_optional(db)
    .await
}

pub async fn save_document(
    db: &PgPool,
    input: SaveStaffDocument<'_>,
) -> Result<Option<StaffDocumentRecord>, sqlx::Error> {
    if let Some(id) = input.id {
        return sqlx::query_as(
            r#"UPDATE staff_documents SET document_type=$5, document_name=$6, document_url=$7,
                      verification_status=$8, expiry_date=$9, notes=$10, updated_at=NOW()
               WHERE tenant_id=$1 AND branch_id=$2 AND staff_id=$3 AND id=$4
               RETURNING id, staff_id, document_type, document_name, document_url,
                         verification_status, expiry_date, notes, created_by, created_at, updated_at"#,
        )
        .bind(input.tenant_id)
        .bind(input.branch_id)
        .bind(input.staff_id)
        .bind(id)
        .bind(input.document_type)
        .bind(input.document_name)
        .bind(input.document_url)
        .bind(input.verification_status)
        .bind(input.expiry_date)
        .bind(input.notes)
        .fetch_optional(db)
        .await;
    }
    sqlx::query_as(
        r#"INSERT INTO staff_documents (
              tenant_id, branch_id, staff_id, document_type, document_name, document_url,
              verification_status, expiry_date, notes, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, staff_id, document_type, document_name, document_url,
                     verification_status, expiry_date, notes, created_by, created_at, updated_at"#,
    )
    .bind(input.tenant_id)
    .bind(input.branch_id)
    .bind(input.staff_id)
    .bind(input.document_type)
    .bind(input.document_name)
    .bind(input.document_url)
    .bind(input.verification_status)
    .bind(input.expiry_date)
    .bind(input.notes)
    .bind(input.created_by)
    .fetch_optional(db)
    .await
}

pub async fn list_history(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Vec<StaffHistoryRecord>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, user_id, event_type, outcome, details_json, created_at
           FROM auth_audit_logs
           WHERE tenant_id=$1 AND branch_id=$2 AND event_type LIKE 'staff.%'
             AND (
               details_json->>'staffId'=$3
               OR EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(details_json->'staffIds')='array'
                        THEN details_json->'staffIds' ELSE '[]'::jsonb END
                 ) AS item(value) WHERE item.value=$3
               )
             )
           ORDER BY created_at DESC LIMIT 100"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_all(db)
    .await
}

pub async fn employee_code_branch(
    db: &PgPool,
    tenant_id: &str,
    employee_code: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT branch_id FROM staff WHERE tenant_id=$1 AND LOWER(employee_code)=LOWER($2) LIMIT 1",
    )
    .bind(tenant_id)
    .bind(employee_code)
    .fetch_optional(db)
    .await
}

pub async fn find_bulk_import(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    batch_key: &str,
) -> Result<Option<BulkImportResult>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, batch_key, total_rows, created_rows, updated_rows, status, staff_ids, created_at
           FROM staff_bulk_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND batch_key=$3"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(batch_key)
    .fetch_optional(db)
    .await
}

pub async fn apply_bulk_import(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    batch_key: &str,
    requested_by: &str,
    rows: &[BulkStaffInput],
) -> Result<BulkImportResult, sqlx::Error> {
    let mut tx = db.begin().await?;
    let result = apply_bulk_import_tx(
        &mut tx,
        tenant_id,
        branch_id,
        batch_key,
        requested_by,
        rows,
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}

pub(crate) async fn apply_bulk_import_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    batch_key: &str,
    requested_by: &str,
    rows: &[BulkStaffInput],
    import_job_id: Option<&str>,
) -> Result<BulkImportResult, sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("staff-bulk:{tenant_id}:{branch_id}:{batch_key}"))
        .execute(&mut **tx)
        .await?;
    if let Some(existing) = find_bulk_import_tx(tx, tenant_id, branch_id, batch_key).await? {
        return Ok(existing);
    }
    let mut created_rows = 0_i32;
    let mut updated_rows = 0_i32;
    let mut staff_ids = Vec::with_capacity(rows.len());
    for row in rows {
        let existing_id = sqlx::query_scalar::<_, String>(
            "SELECT id FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND LOWER(employee_code)=LOWER($3) FOR UPDATE",
        )
        .bind(tenant_id)
        .bind(branch_id)
        .bind(&row.employee_code)
        .fetch_optional(&mut **tx)
        .await?;
        let staff_id = if let Some(id) = existing_id {
            sqlx::query(
                r#"UPDATE staff SET first_name=$4, last_name=COALESCE($5,last_name),
                          appointment_display_name=$4, email=COALESCE($6,email),
                          mobile_phone=COALESCE($7,mobile_phone), job_title=COALESCE($8,job_title),
                          active=COALESCE($9,active), updated_at=NOW()
                   WHERE tenant_id=$1 AND branch_id=$2 AND id=$3"#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&id)
            .bind(&row.first_name)
            .bind(row.last_name.as_deref())
            .bind(row.email.as_deref())
            .bind(row.mobile_phone.as_deref())
            .bind(row.job_title.as_deref())
            .bind(row.active)
            .execute(&mut **tx)
            .await?;
            updated_rows += 1;
            id
        } else {
            let id = sqlx::query_scalar::<_, String>(
                r#"INSERT INTO staff (
                      tenant_id, branch_id, employee_code, first_name, last_name,
                      appointment_display_name, email, mobile_phone, job_title, active,import_job_id
                   ) VALUES ($1,$2,$3,$4,COALESCE($5,''),$4,COALESCE($6,''),COALESCE($7,''),COALESCE($8,''),COALESCE($9,TRUE),$10)
                   RETURNING id"#,
            )
            .bind(tenant_id)
            .bind(branch_id)
            .bind(&row.employee_code)
            .bind(&row.first_name)
            .bind(row.last_name.as_deref())
            .bind(row.email.as_deref())
            .bind(row.mobile_phone.as_deref())
            .bind(row.job_title.as_deref())
            .bind(row.active)
            .bind(import_job_id)
            .fetch_one(&mut **tx)
            .await?;
            created_rows += 1;
            id
        };
        upsert_bulk_profile(tx, tenant_id, branch_id, &staff_id, row).await?;
        staff_ids.push(staff_id);
    }
    let result = sqlx::query_as(
        r#"INSERT INTO staff_bulk_import_jobs (
              tenant_id, branch_id, batch_key, total_rows, created_rows, updated_rows,
              status, staff_ids, requested_by
           ) VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8)
           RETURNING id, batch_key, total_rows, created_rows, updated_rows, status, staff_ids, created_at"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(batch_key)
    .bind(rows.len() as i32)
    .bind(created_rows)
    .bind(updated_rows)
    .bind(serde_json::json!(staff_ids))
    .bind(requested_by)
    .fetch_one(&mut **tx)
    .await?;
    Ok(result)
}

async fn find_bulk_import_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    batch_key: &str,
) -> Result<Option<BulkImportResult>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT id, batch_key, total_rows, created_rows, updated_rows, status, staff_ids, created_at
           FROM staff_bulk_import_jobs WHERE tenant_id=$1 AND branch_id=$2 AND batch_key=$3 FOR UPDATE"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(batch_key)
    .fetch_optional(&mut **tx)
    .await
}

async fn upsert_bulk_profile(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    row: &BulkStaffInput,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO staff_profiles (
              staff_id, tenant_id, branch_id, category_id, shift_template_id, photo_url,
              date_of_birth, joining_date, gender, employment_type, department, reporting_manager_id
           ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,''),$7,$8,COALESCE($9,''),COALESCE($10,''),COALESCE($11,''),$12)
           ON CONFLICT (staff_id) DO UPDATE SET
              category_id=COALESCE(EXCLUDED.category_id,staff_profiles.category_id),
              shift_template_id=COALESCE(EXCLUDED.shift_template_id,staff_profiles.shift_template_id),
              photo_url=CASE WHEN $6::text IS NULL THEN staff_profiles.photo_url ELSE EXCLUDED.photo_url END,
              date_of_birth=COALESCE(EXCLUDED.date_of_birth,staff_profiles.date_of_birth),
              joining_date=COALESCE(EXCLUDED.joining_date,staff_profiles.joining_date),
              gender=CASE WHEN $9::text IS NULL THEN staff_profiles.gender ELSE EXCLUDED.gender END,
              employment_type=CASE WHEN $10::text IS NULL THEN staff_profiles.employment_type ELSE EXCLUDED.employment_type END,
              department=CASE WHEN $11::text IS NULL THEN staff_profiles.department ELSE EXCLUDED.department END,
              reporting_manager_id=COALESCE(EXCLUDED.reporting_manager_id,staff_profiles.reporting_manager_id),
              updated_at=NOW()"#,
    )
    .bind(staff_id)
    .bind(tenant_id)
    .bind(branch_id)
    .bind(row.category_id.as_deref())
    .bind(row.shift_template_id.as_deref())
    .bind(row.photo_url.as_deref())
    .bind(row.date_of_birth)
    .bind(row.joining_date)
    .bind(row.gender.as_deref())
    .bind(row.employment_type.as_deref())
    .bind(row.department.as_deref())
    .bind(row.reporting_manager_id.as_deref())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
