use crate::{
    models::common::AppError,
    services::analytics_service::{self, CustomReportDefinition},
    state::AppState,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub report_type: String,
    #[serde(default = "default_format")]
    pub format: String,
    pub definition: Option<CustomReportDefinition>,
}
fn default_format() -> String {
    "json".into()
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub created_by: String,
    pub idempotency_key: String,
    pub payload_hash: String,
    pub request_json: Value,
    pub report_type: String,
    pub format: String,
    pub status: String,
    #[serde(skip)]
    pub output_bytes: Option<Vec<u8>>,
    pub content_type: String,
    pub file_name: String,
    pub last_error: String,
    pub attempts: i32,
    pub available_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJobView {
    pub id: String,
    pub report_type: String,
    pub format: String,
    pub status: String,
    pub last_error: String,
    pub attempts: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub download_url: Option<String>,
}
impl ExportJob {
    pub fn view(&self) -> ExportJobView {
        ExportJobView {
            id: self.id.clone(),
            report_type: self.report_type.clone(),
            format: self.format.clone(),
            status: self.status.clone(),
            last_error: self.last_error.clone(),
            attempts: self.attempts,
            created_at: self.created_at,
            updated_at: self.updated_at,
            expires_at: self.expires_at,
            download_url: (self.status == "completed")
                .then(|| format!("/api/reports/exports/{}/download", self.id)),
        }
    }
}
const SELECT: &str = "id,tenant_id,branch_id,created_by,idempotency_key,payload_hash,request_json,report_type,format,status,output_bytes,content_type,file_name,last_error,attempts,available_at,expires_at,created_at,updated_at";

pub async fn create(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    actor: &str,
    key: &str,
    req: ExportRequest,
) -> Result<ExportJob, AppError> {
    if key.trim().is_empty() || key.len() > 200 {
        return Err(AppError::validation(
            "Idempotency-Key is required and must be <= 200 characters",
        ));
    }
    if req.report_type != "custom" {
        return Err(AppError::validation("reportType must be custom"));
    }
    if !matches!(req.format.as_str(), "json" | "csv") {
        return Err(AppError::validation("format must be json or csv"));
    }
    if req.definition.is_none() {
        return Err(AppError::validation(
            "definition is required for custom exports",
        ));
    }
    let json =
        serde_json::to_value(&req).map_err(|_| AppError::validation("invalid export request"))?;
    let hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json).unwrap_or_default())
    );
    let id = uuid::Uuid::new_v4().to_string();
    let content_type = if req.format == "csv" {
        "text/csv; charset=utf-8"
    } else {
        "application/json"
    };
    let file_name = if req.format == "csv" {
        "report.csv"
    } else {
        "report.json"
    };
    let sql=format!("INSERT INTO report_export_jobs(id,tenant_id,branch_id,created_by,idempotency_key,payload_hash,request_json,report_type,format,content_type,file_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id,branch_id,created_by,idempotency_key) DO NOTHING RETURNING {}",SELECT);
    if let Some(row) = sqlx::query_as::<_, ExportJob>(&sql)
        .bind(&id)
        .bind(tenant)
        .bind(branch)
        .bind(actor)
        .bind(key)
        .bind(&hash)
        .bind(&json)
        .bind(&req.report_type)
        .bind(&req.format)
        .bind(content_type)
        .bind(file_name)
        .fetch_optional(db)
        .await
        .map_err(|_| AppError::internal("failed to queue report export"))?
    {
        return Ok(row);
    }
    let sql=format!("SELECT {} FROM report_export_jobs WHERE tenant_id=$1 AND branch_id=$2 AND created_by=$3 AND idempotency_key=$4",SELECT);
    let row = sqlx::query_as::<_, ExportJob>(&sql)
        .bind(tenant)
        .bind(branch)
        .bind(actor)
        .bind(key)
        .fetch_optional(db)
        .await
        .map_err(|_| AppError::internal("failed to load export job"))?
        .ok_or_else(|| AppError::internal("export idempotency record disappeared"))?;
    if row.payload_hash != hash {
        return Err(AppError::conflict(
            "Idempotency-Key was already used for a different export",
        ));
    }
    Ok(row)
}
pub async fn get(db: &PgPool, tenant: &str, branch: &str, id: &str) -> Result<ExportJob, AppError> {
    let sql = format!(
        "SELECT {} FROM report_export_jobs WHERE tenant_id=$1 AND branch_id=$2 AND id=$3",
        SELECT
    );
    sqlx::query_as::<_, ExportJob>(&sql)
        .bind(tenant)
        .bind(branch)
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(|_| AppError::internal("failed to load export job"))?
        .ok_or_else(|| AppError::not_found("export job was not found"))
}
pub async fn process_due(state: &AppState) -> Result<usize, AppError> {
    let sql=format!("WITH due AS (SELECT id FROM report_export_jobs WHERE status='queued' AND available_at<=NOW() AND expires_at>NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 4) UPDATE report_export_jobs j SET status='processing',attempts=j.attempts+1,updated_at=NOW() FROM due WHERE j.id=due.id RETURNING {}",SELECT);
    let jobs = sqlx::query_as::<_, ExportJob>(&sql)
        .fetch_all(&state.db)
        .await
        .map_err(|_| AppError::internal("failed to claim export jobs"))?;
    for job in &jobs {
        match execute(state, job).await {
            Ok(bytes) => {
                sqlx::query("UPDATE report_export_jobs SET status='completed',output_bytes=$2,last_error='',updated_at=NOW() WHERE id=$1").bind(&job.id).bind(bytes).execute(&state.db).await.map_err(|_|AppError::internal("failed to complete export job"))?;
            }
            Err(err) => {
                sqlx::query("UPDATE report_export_jobs SET status='failed',last_error=$2,updated_at=NOW() WHERE id=$1").bind(&job.id).bind(format!("{err:?}")).execute(&state.db).await.map_err(|_|AppError::internal("failed to fail export job"))?;
            }
        }
    }
    Ok(jobs.len())
}
async fn execute(state: &AppState, job: &ExportJob) -> Result<Vec<u8>, AppError> {
    let req: ExportRequest = serde_json::from_value(job.request_json.clone())
        .map_err(|_| AppError::validation("stored export request is invalid"))?;
    let def = req
        .definition
        .ok_or_else(|| AppError::validation("stored export definition is missing"))?;
    let report = analytics_service::preview_custom_report(
        &state.db,
        &job.tenant_id,
        &job.branch_id,
        &def,
        true,
    )
    .await?;
    if job.format == "csv" {
        let mut out = String::from("row,column,value\n");
        for c in report.cells {
            out.push_str(&format!(
                "\"{}\",\"{}\",{}\n",
                c.row_key.replace('"', "\"\""),
                c.column_key.replace('"', "\"\""),
                c.value
            ));
        }
        Ok(out.into_bytes())
    } else {
        serde_json::to_vec(&report)
            .map_err(|_| AppError::internal("failed to serialize report export"))
    }
}
