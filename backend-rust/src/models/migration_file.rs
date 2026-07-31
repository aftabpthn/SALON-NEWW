use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::migration::{MigrationEntity, MigrationProvider};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMigrationUploadRequest {
    pub file_name: String,
    #[serde(default)]
    pub provider: MigrationProvider,
    pub content_type: Option<String>,
    pub size_bytes: i64,
    pub total_parts: i32,
    pub expected_sha256: Option<String>,
    #[serde(default = "default_retention_days")]
    pub retention_days: i32,
    pub evidence_kind: Option<String>,
    pub supplier_batch: Option<String>,
    pub cutover_id: Option<String>,
}

fn default_retention_days() -> i32 {
    90
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompleteMigrationUploadRequest {
    pub expected_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationUploadSession {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub provider: MigrationProvider,
    pub uploaded_by: String,
    pub file_name: String,
    pub extension: String,
    pub declared_content_type: String,
    pub expected_size_bytes: i64,
    pub expected_sha256: String,
    pub total_parts: i32,
    pub received_parts: i32,
    pub received_bytes: i64,
    pub missing_parts: Vec<i32>,
    pub status: String,
    pub source_file_id: Option<String>,
    pub last_error: String,
    pub resume_available: bool,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub retention_days: i32,
    pub evidence_kind: String,
    pub supplier_batch: String,
    pub cutover_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSourceArtifact {
    pub id: String,
    pub entry_name: String,
    pub format: String,
    pub detected_content_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub page_count: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSourceFile {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub provider: MigrationProvider,
    pub uploaded_by: String,
    pub upload_session_id: String,
    pub original_file_name: String,
    pub extension: String,
    pub declared_content_type: String,
    pub detected_content_type: String,
    pub format: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub evidence_status: String,
    pub read_only: bool,
    pub encrypted: bool,
    pub encryption_scheme: String,
    pub retention_until: DateTime<Utc>,
    pub purged_at: Option<DateTime<Utc>>,
    pub manifest: Value,
    pub page_count: i32,
    pub artifacts: Vec<MigrationSourceArtifact>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSourceColumnProfile {
    pub original_header: String,
    pub normalized_header: String,
    pub sample_values: Vec<String>,
    pub detected_data_type: String,
    pub empty_percentage: f64,
    pub unique_percentage: f64,
    pub duplicate_count: i64,
    pub minimum: Option<String>,
    pub maximum: Option<String>,
    pub patterns: Vec<String>,
    pub possible_crm_entity: Option<MigrationEntity>,
    pub possible_crm_field: Option<String>,
    pub invalid_value_count: i64,
    pub statistics_exact: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSourceSheet {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub row_count: i64,
    pub column_count: i32,
    pub columns: Vec<String>,
    pub column_profiles: Vec<MigrationSourceColumnProfile>,
    pub targets: Vec<MigrationEntity>,
    pub importable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSourceProfile {
    pub provider: MigrationProvider,
    pub sheets: Vec<MigrationSourceSheet>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationUploadPartReceipt {
    pub session: MigrationUploadSession,
    pub part_number: i32,
    pub part_size_bytes: i64,
    pub part_sha256: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteMigrationUploadResponse {
    pub session: MigrationUploadSession,
    pub source_file: MigrationSourceFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalEvidenceGroupDecisionRequest {
    pub cutover_id: String,
    pub supplier_batch: String,
    pub group_key: String,
    pub decision: String,
    pub approved_page_count: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalEvidenceCutoverApprovalRequest {
    pub cutover_id: String,
}
