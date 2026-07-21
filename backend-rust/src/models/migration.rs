use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, fmt};

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $value)] $variant),+
        }

        impl $name {
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $value),+
                }
            }
        }

        impl TryFrom<&str> for $name {
            type Error = String;

            fn try_from(value: &str) -> Result<Self, String> {
                match value {
                    $($value => Ok(Self::$variant),)+
                    _ => Err(format!("unsupported {} value: {value}", stringify!($name))),
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(self.as_str())
            }
        }
    };
}

string_enum!(MigrationEntity {
    Clients => "clients",
    Staff => "staff",
    Services => "services",
    Products => "products",
    Suppliers => "suppliers",
    Inventory => "inventory",
    Memberships => "memberships",
    Packages => "packages",
    Appointments => "appointments",
    Sales => "sales",
    Invoices => "invoices",
    Payments => "payments",
    Expenses => "expenses",
    PurchaseBills => "purchase-bills",
});

string_enum!(MigrationMode {
    DryRun => "dry-run",
    Commit => "commit",
});

string_enum!(MigrationJobStatus {
    Staging => "staging",
    Validated => "validated",
    Queued => "queued",
    Processing => "processing",
    Paused => "paused",
    Completed => "completed",
    Failed => "failed",
    Cancelled => "cancelled",
    RolledBack => "rolled_back",
});

string_enum!(MigrationRowStatus {
    Validated => "validated",
    Warning => "warning",
    Duplicate => "duplicate",
    Error => "error",
    Imported => "imported",
    Created => "created",
    Merged => "merged",
    Linked => "linked",
    Kept => "kept",
    RolledBack => "rolled_back",
});

string_enum!(MigrationDuplicateDecision {
    Merge => "merge",
    Keep => "keep",
    Link => "link",
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateImportJobRequest {
    pub entity: MigrationEntity,
    pub file_name: String,
    pub mode: MigrationMode,
    pub csv: String,
    #[serde(default)]
    pub mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub duplicate_decisions: BTreeMap<String, MigrationDuplicateDecision>,
    pub mapping_id: Option<String>,
    pub owner_user_id: Option<String>,
}

fn default_chunk_size() -> i32 {
    5_000
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateLargeImportJobRequest {
    pub source_file_id: String,
    pub entity: MigrationEntity,
    pub mode: MigrationMode,
    #[serde(default)]
    pub mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub duplicate_decisions: BTreeMap<String, MigrationDuplicateDecision>,
    pub mapping_id: Option<String>,
    pub owner_user_id: Option<String>,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: i32,
    #[serde(default)]
    pub allow_partial_import: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub entity: MigrationEntity,
    pub file_name: String,
    pub mode: MigrationMode,
    pub status: MigrationJobStatus,
    pub source_hash: Option<String>,
    pub source_row_count: i32,
    pub valid_row_count: i32,
    pub error_row_count: i32,
    pub warning_row_count: i32,
    pub duplicate_row_count: i32,
    pub errors_json: Value,
    pub mapping_json: Value,
    pub analysis_json: Value,
    pub recovery_json: Value,
    pub total_rows: i32,
    pub processed_rows: i32,
    pub next_row: i32,
    pub last_error: String,
    pub source_file_id: Option<String>,
    pub chunk_size: i32,
    pub allow_partial_import: bool,
    pub worker_phase: String,
    pub worker_id: String,
    pub heartbeat_at: Option<DateTime<Utc>>,
    pub total_chunks: i32,
    pub completed_chunks: i32,
    pub failed_chunks: i32,
    pub owner_user_id: String,
    pub approval_status: String,
    pub approval_requested_at: Option<DateTime<Utc>>,
    pub approval_decided_at: Option<DateTime<Utc>>,
    pub approval_decided_by: Option<String>,
    pub approval_note: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub rolled_back_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationApprovalRequest {
    pub approved: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationImportChunk {
    pub id: String,
    pub chunk_number: i32,
    pub source_sheet: String,
    pub source_row_start: i32,
    pub source_row_end: i32,
    pub total_rows: i32,
    pub ready_rows: i32,
    pub error_rows: i32,
    pub status: String,
    pub checksum: String,
    pub processed_rows: i32,
    pub attempts: i32,
    pub worker_id: String,
    pub heartbeat_at: Option<DateTime<Utc>>,
    pub last_error: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct NewMigrationRowResult {
    pub source_row_number: i32,
    pub source_external_id: String,
    pub status: MigrationRowStatus,
    pub error_code: String,
    pub message: String,
    pub warnings: Value,
    pub duplicate_target_id: String,
    pub duplicate_decision: String,
    pub source_payload: Value,
}

#[derive(Debug)]
pub struct ClaimedImportJob {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub entity: MigrationEntity,
    pub rows_json: Value,
    pub total_rows: i32,
    pub next_row: i32,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationTemplateColumn {
    pub field: String,
    pub required: bool,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationTemplate {
    pub entity: MigrationEntity,
    pub columns: Vec<MigrationTemplateColumn>,
    pub duplicate_decisions: Vec<MigrationDuplicateDecision>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveMigrationMappingRequest {
    pub name: String,
    pub entity: MigrationEntity,
    pub mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub source_columns: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMapping {
    pub id: String,
    pub name: String,
    pub entity: MigrationEntity,
    pub mapping: BTreeMap<String, String>,
    pub source_columns: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyzeMigrationRequest {
    pub entity: MigrationEntity,
    pub csv: String,
    #[serde(default)]
    pub mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub duplicate_decisions: BTreeMap<String, MigrationDuplicateDecision>,
    pub mapping_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationMappingSuggestionRequest {
    pub entity: MigrationEntity,
    #[serde(default)]
    pub source_columns: Vec<String>,
    pub source_file_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRowIssue {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAnalysisRow {
    pub source_row_number: i32,
    pub source_external_id: String,
    pub status: MigrationRowStatus,
    pub errors: Vec<MigrationRowIssue>,
    pub warnings: Vec<MigrationRowIssue>,
    pub duplicate_target_id: Option<String>,
    pub duplicate_decision: Option<MigrationDuplicateDecision>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAnalysisSummary {
    pub source_rows: i32,
    pub valid_rows: i32,
    pub error_rows: i32,
    pub warning_rows: i32,
    pub duplicate_rows: i32,
    pub ready_rows: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAnalysisReport {
    pub entity: MigrationEntity,
    pub mapping: BTreeMap<String, String>,
    pub unmatched_columns: Vec<String>,
    pub rows: Vec<MigrationAnalysisRow>,
    pub summary: MigrationAnalysisSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecoveryReport {
    pub job_id: String,
    pub deleted_rows: i64,
    pub restored_rows: i64,
    pub linked_rows: i64,
    pub kept_rows: i64,
    pub rolled_back_rows: i64,
    pub status: String,
}

#[cfg(test)]
mod tests {
    use super::{CreateImportJobRequest, MigrationEntity, MigrationMode};

    #[test]
    fn import_request_keeps_the_existing_camel_case_contract() {
        let request: CreateImportJobRequest = serde_json::from_str(
            r#"{"entity":"clients","fileName":"clients.csv","mode":"dry-run","csv":"firstName,phone","mapping":{},"duplicateDecisions":{}}"#,
        )
        .unwrap();

        assert_eq!(request.entity, MigrationEntity::Clients);
        assert_eq!(request.mode, MigrationMode::DryRun);
        assert_eq!(request.file_name, "clients.csv");
    }

    #[test]
    fn import_request_rejects_unknown_contract_fields() {
        assert!(serde_json::from_str::<CreateImportJobRequest>(
            r#"{"entity":"clients","fileName":"clients.csv","mode":"commit","csv":"x","unsafe":true}"#,
        )
        .is_err());
    }
}
