use chrono::{DateTime, NaiveDate, Utc};
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
    ClientMemberships => "client-memberships",
    Packages => "packages",
    Appointments => "appointments",
    Sales => "sales",
    Invoices => "invoices",
    Payments => "payments",
    Expenses => "expenses",
    PurchaseBills => "purchase-bills",
    OpeningPayables => "opening-payables",
    Refunds => "refunds",
    GiftCards => "gift-cards",
    Loyalty => "loyalty",
    Payroll => "payroll",
    Commissions => "commissions",
    ClientNotes => "client-notes",
    Files => "files",
    StockMovements => "stock-movements",
});

string_enum!(MigrationMode {
    DryRun => "dry-run",
    Commit => "commit",
});

string_enum!(HistoricalPurchaseMappingKind {
    Product => "product",
    Vendor => "vendor",
});

string_enum!(HistoricalPurchaseMappingDecision {
    Link => "link",
    Create => "create",
    KeepHistoricalOnly => "keep_historical_only",
    Reject => "reject",
});

string_enum!(PurchaseBillPostingMode {
    HistoryOnly => "history_only",
    OpeningSnapshot => "opening_snapshot",
    OpeningPayable => "opening_payable",
    LiveReceipt => "live_receipt",
});

string_enum!(MigrationCutoverStatus {
    Draft => "draft",
    HistoryImporting => "history_importing",
    InventoryFrozen => "inventory_frozen",
    SnapshotApproved => "snapshot_approved",
    SnapshotApplied => "snapshot_applied",
    Reconciled => "reconciled",
    Live => "live",
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMigrationCutoverRequest {
    pub id: String,
    pub business_timezone: String,
    pub cutover_date: NaiveDate,
    pub cutover_at: DateTime<Utc>,
    pub historical_period_end: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransitionMigrationCutoverRequest {
    pub target_status: MigrationCutoverStatus,
    pub snapshot_checksum: Option<String>,
    pub observation_period_hours: Option<u16>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationCutoverTransition {
    pub id: i64,
    pub from_status: Option<String>,
    pub to_status: String,
    pub actor_id: String,
    pub actor_role: String,
    pub note: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationCutover {
    pub id: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub business_timezone: String,
    pub cutover_date: NaiveDate,
    pub cutover_at: DateTime<Utc>,
    pub historical_period_end: DateTime<Utc>,
    pub inventory_freeze_start: Option<DateTime<Utc>>,
    pub inventory_freeze_end: Option<DateTime<Utc>>,
    pub snapshot_checksum: String,
    pub status: MigrationCutoverStatus,
    pub approved_users: Vec<String>,
    pub owner_approved_by: Option<String>,
    pub owner_approved_at: Option<DateTime<Utc>>,
    pub go_live_at: Option<DateTime<Utc>>,
    pub go_live_approved_role: String,
    pub go_live_approval_note: String,
    pub go_live_reconciliation_version: String,
    pub go_live_reconciliation_checksum: String,
    pub go_live_reconciliation: Value,
    pub rollback_policy: Value,
    pub rollback_state: String,
    pub configured_by: String,
    pub contract_version: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub transitions: Vec<MigrationCutoverTransition>,
    pub reconciliation: Value,
}

pub const THREE_LAYER_POSTING_CONTRACT_VERSION: &str = "2026-07-phase1-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreeLayerPostingContract {
    pub contract_version: String,
    pub tenant_id: String,
    pub branch_id: String,
    pub provider: MigrationProvider,
    pub source_file: String,
    pub source_file_id: Option<String>,
    pub source_checksum: String,
    pub entity: MigrationEntity,
    pub import_mode: MigrationMode,
    pub posting_mode: PurchaseBillPostingMode,
    pub cutover_id: String,
    pub cutover_date: NaiveDate,
    pub mapping_version: i32,
    pub transformer_version: String,
    pub imported_at: Option<DateTime<Utc>>,
    pub approved_by: Option<String>,
}

string_enum!(MigrationProvider {
    Auto => "auto",
    Zenoti => "zenoti",
    Dingg => "dingg",
    Salonist => "salonist",
    Fresha => "fresha",
    Tally => "tally",
    Busy => "busy",
    Marg => "marg",
    Excel => "excel",
    Csv => "csv",
    Manual => "manual",
});

impl Default for MigrationProvider {
    fn default() -> Self {
        Self::Auto
    }
}

string_enum!(MigrationJobStatus {
    Staging => "staging",
    DependencyPending => "dependency_pending",
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
    DependencyPending => "dependency_pending",
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
    Reject => "reject",
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateImportJobRequest {
    pub entity: MigrationEntity,
    pub file_name: String,
    pub mode: MigrationMode,
    pub posting_mode: Option<PurchaseBillPostingMode>,
    pub cutover_id: Option<String>,
    pub cutover_date: Option<NaiveDate>,
    pub csv: String,
    #[serde(default)]
    pub mapping: BTreeMap<String, String>,
    #[serde(default)]
    pub duplicate_decisions: BTreeMap<String, MigrationDuplicateDecision>,
    pub mapping_id: Option<String>,
    pub owner_user_id: Option<String>,
    #[serde(default)]
    pub source_provider: MigrationProvider,
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
    pub posting_mode: Option<PurchaseBillPostingMode>,
    pub cutover_id: Option<String>,
    pub cutover_date: Option<NaiveDate>,
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
    #[serde(default)]
    pub source_provider: MigrationProvider,
    #[serde(default)]
    pub source_sheet: String,
    #[serde(default)]
    pub header_source_sheet: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalPurchaseMappingCreateRequest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub sku: String,
    #[serde(default)]
    pub barcode: String,
    #[serde(default)]
    pub brand: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub package_unit: String,
    pub units_per_package: Option<i32>,
    #[serde(default)]
    pub gstin: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub address: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalPurchaseMappingDecisionRequest {
    pub decision: HistoricalPurchaseMappingDecision,
    #[serde(default)]
    pub target_id: String,
    pub expected_version: i32,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub approve_unit_conversion: bool,
    #[serde(default)]
    pub approve_variant_mismatch: bool,
    #[serde(default)]
    pub approve_source_drift: bool,
    #[serde(default)]
    pub bulk_approval: bool,
    pub create: Option<HistoricalPurchaseMappingCreateRequest>,
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
    pub mapping_id: Option<String>,
    pub mapping_version: Option<i32>,
    pub mapping_header_fingerprint: String,
    pub transformer_versions: Value,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpeningPayableControlsApprovalRequest {
    pub opening_balance_account: String,
    pub payable_account: String,
    pub supplier_advance_account: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationSelectiveRetryRequest {
    pub rows: Vec<MigrationRetryCorrection>,
    #[serde(default)]
    pub approve_partial: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationRetryCorrection {
    pub source_sheet: String,
    pub source_row_number: i32,
    #[serde(default)]
    pub corrections: BTreeMap<String, String>,
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
    pub global_aliases: Vec<String>,
    pub provider_aliases: BTreeMap<String, Vec<String>>,
    pub data_type: String,
    pub max_length: Option<usize>,
    pub allowed_values: Vec<String>,
    pub reference_entity: Option<MigrationEntity>,
    pub default_behavior: String,
    pub transformation_rule: String,
    pub validation_rules: Vec<String>,
    pub permission: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMappingDecision {
    pub source_column: String,
    pub target_field: Option<String>,
    pub candidates: Vec<String>,
    pub alias_level: String,
    pub confidence: String,
    pub confidence_percentage: u8,
    pub collision: bool,
    pub reason: String,
    pub alternative_targets: Vec<MigrationTargetAlternative>,
    pub suggestion_reasons: Vec<String>,
    pub rejection_reasons: Vec<String>,
    pub detected_data_type: String,
    pub sample_evidence: Vec<String>,
    pub required_transformation: Option<String>,
    pub approved: bool,
    pub approval_id: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationTargetAlternative {
    pub target_field: String,
    pub confidence_percentage: u8,
    pub reasons: Vec<String>,
    pub rejection_reasons: Vec<String>,
    pub required_transformation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMappingApproval {
    pub id: String,
    pub entity: MigrationEntity,
    pub source_provider: MigrationProvider,
    pub rule_version: String,
    pub fingerprint: String,
    pub source_file_id: Option<String>,
    pub source_sheet: String,
    pub source_column: String,
    pub target_field: String,
    pub confidence_percentage: u8,
    pub decision: Value,
    pub approved_by: String,
    pub approved_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAlias {
    pub id: String,
    pub entity: MigrationEntity,
    pub source_provider: MigrationProvider,
    pub alias: String,
    pub target_field: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveMigrationAliasRequest {
    pub entity: MigrationEntity,
    #[serde(default)]
    pub source_provider: MigrationProvider,
    pub alias: String,
    pub target_field: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationTemplate {
    pub contract_version: String,
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
    pub evaluation: MigrationMappingSuggestionRequest,
    pub fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMapping {
    pub id: String,
    pub name: String,
    pub entity: MigrationEntity,
    pub mapping: BTreeMap<String, String>,
    pub source_columns: Vec<String>,
    pub source_provider: MigrationProvider,
    pub source_sheet: String,
    pub normalized_headers: Vec<String>,
    pub header_fingerprint: String,
    pub column_count: i32,
    pub mapping_version: i32,
    pub transformer_versions: Value,
    pub approved_by: String,
    pub approved_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationMappingVersion {
    pub mapping_id: String,
    pub version: i32,
    pub entity: MigrationEntity,
    pub source_provider: MigrationProvider,
    pub source_sheet: String,
    pub source_columns: Vec<String>,
    pub normalized_headers: Vec<String>,
    pub header_fingerprint: String,
    pub column_count: i32,
    pub mapping: BTreeMap<String, String>,
    pub transformer_versions: Value,
    pub approved_by: String,
    pub approved_at: DateTime<Utc>,
    pub change_kind: String,
    pub rolled_back_from_version: Option<i32>,
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
    #[serde(default)]
    pub source_provider: MigrationProvider,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationMappingSuggestionRequest {
    pub entity: MigrationEntity,
    #[serde(default)]
    pub source_columns: Vec<String>,
    #[serde(default)]
    pub mapping: BTreeMap<String, String>,
    pub source_file_id: Option<String>,
    #[serde(default)]
    pub source_provider: MigrationProvider,
    #[serde(default)]
    pub source_sheet: String,
    #[serde(default)]
    pub header_source_sheet: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveMigrationMappingRequest {
    pub evaluation: MigrationMappingSuggestionRequest,
    pub source_column: String,
    pub target_field: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRowIssue {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_target: Option<String>,
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
    pub duplicate_signals: Vec<MigrationDuplicateSignal>,
    pub allowed_duplicate_decisions: Vec<MigrationDuplicateDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate_preview: Option<MigrationDuplicatePreview>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationDuplicateSignal {
    pub kind: String,
    pub normalized_value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationDuplicatePreview {
    pub existing_value: Value,
    pub incoming_value: Value,
    pub final_value: Value,
    pub fields_that_will_change: Vec<String>,
    pub dependent_records: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAnalysisSummary {
    pub source_rows: i32,
    pub valid_rows: i32,
    pub error_rows: i32,
    #[serde(default)]
    pub dependency_pending_rows: i32,
    pub warning_rows: i32,
    pub duplicate_rows: i32,
    pub ready_rows: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationAnalysisReport {
    pub entity: MigrationEntity,
    pub transformation_version: String,
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
    #[serde(default)]
    pub audit: Value,
    #[serde(default)]
    pub verification: Value,
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
