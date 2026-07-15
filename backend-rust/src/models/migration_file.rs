use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMigrationUploadRequest {
    pub file_name: String,
    pub content_type: Option<String>,
    pub size_bytes: i64,
    pub total_parts: i32,
    pub expected_sha256: Option<String>,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSourceFile {
    pub id: String,
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
    pub manifest: Value,
    pub artifacts: Vec<MigrationSourceArtifact>,
    pub created_at: DateTime<Utc>,
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
