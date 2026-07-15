use crate::{
    models::{
        common::AppError,
        migration::{
            MigrationAnalysisReport, MigrationAnalysisRow, MigrationAnalysisSummary,
            MigrationDuplicateDecision, MigrationEntity, MigrationRowIssue, MigrationRowStatus,
            MigrationTemplate, MigrationTemplateColumn, NewMigrationRowResult,
        },
    },
    repositories::migration_repository,
    services::client_service,
};
use chrono::NaiveDate;
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap, HashSet};

pub struct PreparedMigration {
    pub report: MigrationAnalysisReport,
    pub rows: Value,
    pub errors: Value,
    pub row_results: Value,
}

struct ColumnContract {
    field: &'static str,
    required: bool,
    aliases: &'static [&'static str],
}

const CLIENT_COLUMNS: &[ColumnContract] = &[
    ColumnContract {
        field: "oldExternalId",
        required: false,
        aliases: &[
            "external id",
            "old id",
            "legacy id",
            "client id",
            "customer id",
        ],
    },
    ColumnContract {
        field: "code",
        required: false,
        aliases: &["code", "client code", "customer code"],
    },
    ColumnContract {
        field: "firstName",
        required: true,
        aliases: &[
            "first name",
            "firstname",
            "name",
            "client name",
            "customer name",
        ],
    },
    ColumnContract {
        field: "lastName",
        required: false,
        aliases: &["last name", "lastname", "surname"],
    },
    ColumnContract {
        field: "phone",
        required: true,
        aliases: &["phone", "mobile", "mobile number", "contact number"],
    },
    ColumnContract {
        field: "email",
        required: false,
        aliases: &["email", "email id", "e-mail"],
    },
    ColumnContract {
        field: "membershipLabel",
        required: false,
        aliases: &["membership", "membership label"],
    },
    ColumnContract {
        field: "categories",
        required: false,
        aliases: &["categories", "category", "tags"],
    },
    ColumnContract {
        field: "birthday",
        required: false,
        aliases: &["birthday", "birth date", "dob", "date of birth"],
    },
    ColumnContract {
        field: "anniversary",
        required: false,
        aliases: &["anniversary", "anniversary date"],
    },
    ColumnContract {
        field: "notes",
        required: false,
        aliases: &["notes", "remarks", "comments"],
    },
    ColumnContract {
        field: "active",
        required: false,
        aliases: &["active", "status"],
    },
];

const STAFF_COLUMNS: &[ColumnContract] = &[
    ColumnContract {
        field: "oldExternalId",
        required: false,
        aliases: &["external id", "old id", "legacy id", "staff id"],
    },
    ColumnContract {
        field: "employeeCode",
        required: true,
        aliases: &["employee code", "employeecode", "staff code", "code"],
    },
    ColumnContract {
        field: "firstName",
        required: true,
        aliases: &[
            "first name",
            "firstname",
            "name",
            "staff name",
            "employee name",
        ],
    },
    ColumnContract {
        field: "lastName",
        required: false,
        aliases: &["last name", "lastname", "surname"],
    },
    ColumnContract {
        field: "email",
        required: false,
        aliases: &["email", "email id", "e-mail"],
    },
    ColumnContract {
        field: "mobilePhone",
        required: false,
        aliases: &["mobile phone", "mobile", "phone", "contact number"],
    },
    ColumnContract {
        field: "jobTitle",
        required: false,
        aliases: &["job title", "role", "designation"],
    },
    ColumnContract {
        field: "active",
        required: false,
        aliases: &["active", "status"],
    },
];

macro_rules! column {
    ($field:literal, $required:literal, [$($alias:literal),* $(,)?]) => {
        ColumnContract { field: $field, required: $required, aliases: &[$($alias),*] }
    };
}

const SERVICE_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        false,
        ["external id", "old id", "legacy id", "service id"]
    ),
    column!("name", true, ["name", "service name"]),
    column!("category", false, ["category", "service category"]),
    column!(
        "durationMinutes",
        true,
        ["duration", "duration minutes", "service time"]
    ),
    column!(
        "pricePaise",
        true,
        ["price paise", "price", "selling price"]
    ),
    column!("gstPercent", false, ["gst", "gst percent", "gst rate"]),
    column!("sacCode", false, ["sac", "sac code"]),
    column!("waitTimeMinutes", false, ["wait time", "wait minutes"]),
    column!(
        "cleanupTimeMinutes",
        false,
        ["cleanup time", "cleanup minutes"]
    ),
    column!(
        "bufferTimeMinutes",
        false,
        ["buffer time", "buffer minutes"]
    ),
    column!("active", false, ["active", "status"]),
];

const PRODUCT_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        false,
        ["external id", "old id", "legacy id", "product id"]
    ),
    column!("sku", true, ["sku", "item code", "product code"]),
    column!("name", true, ["name", "product name", "item name"]),
    column!("category", false, ["category", "product category"]),
    column!("unit", false, ["unit", "stock unit"]),
    column!(
        "reorderPoint",
        false,
        ["reorder point", "low stock threshold"]
    ),
    column!(
        "unitCostPaise",
        false,
        ["unit cost paise", "cost paise", "unit cost"]
    ),
    column!("hsnCode", false, ["hsn", "hsn code"]),
    column!("gstPercent", false, ["gst", "gst percent", "gst rate"]),
    column!("barcode", false, ["barcode"]),
    column!("batchTracked", false, ["batch tracked", "track batch"]),
    column!("active", false, ["active", "status"]),
];

const SUPPLIER_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        false,
        ["external id", "old id", "legacy id", "supplier id"]
    ),
    column!("code", true, ["code", "supplier code", "vendor code"]),
    column!("name", true, ["name", "supplier name", "vendor name"]),
    column!("gstin", false, ["gstin", "gst no", "gst number"]),
    column!("contactName", false, ["contact", "contact name"]),
    column!("phone", false, ["phone", "mobile", "contact number"]),
    column!("email", false, ["email", "email id"]),
    column!(
        "address",
        false,
        ["address", "supplier address", "vendor address"]
    ),
    column!(
        "paymentTermsDays",
        false,
        ["payment terms", "payment terms days", "credit days"]
    ),
    column!("active", false, ["active", "status"]),
];

const INVENTORY_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        false,
        ["external id", "old id", "legacy id", "stock id"]
    ),
    column!(
        "product",
        true,
        ["product", "product id", "product name", "sku", "item code"]
    ),
    column!(
        "openingStock",
        true,
        ["opening stock", "stock", "quantity", "opening quantity"]
    ),
    column!(
        "unitCostPaise",
        false,
        ["unit cost paise", "cost paise", "unit cost"]
    ),
];

const MEMBERSHIP_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        false,
        ["external id", "old id", "legacy id", "membership id"]
    ),
    column!("code", true, ["code", "membership code", "plan code"]),
    column!("name", true, ["name", "membership name", "plan name"]),
    column!("planType", false, ["plan type", "type"]),
    column!("pricePaise", false, ["price paise", "price"]),
    column!("pointsRequired", false, ["points", "points required"]),
    column!("discountPercent", false, ["discount", "discount percent"]),
    column!("validityDays", false, ["validity", "validity days"]),
    column!("notes", false, ["notes", "remarks"]),
    column!(
        "services",
        false,
        ["services", "service ids", "service names"]
    ),
    column!("active", false, ["active", "status"]),
];

const PACKAGE_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        false,
        ["external id", "old id", "legacy id", "package id"]
    ),
    column!("name", true, ["name", "package name"]),
    column!("description", false, ["description", "notes"]),
    column!("pricePaise", false, ["price paise", "price"]),
    column!("discountPercent", false, ["discount", "discount percent"]),
    column!("validityDays", false, ["validity", "validity days"]),
    column!(
        "services",
        true,
        ["services", "service ids", "service names"]
    ),
    column!("paidSessions", false, ["paid sessions", "sessions"]),
    column!("freeSessions", false, ["free sessions", "bonus sessions"]),
    column!("costPricePaise", false, ["cost price paise", "cost price"]),
    column!("showMobileApp", false, ["show mobile app", "mobile app"]),
    column!(
        "showOnlineBooking",
        false,
        ["show online booking", "online booking"]
    ),
    column!("active", false, ["active", "status"]),
];

pub fn templates() -> Vec<MigrationTemplate> {
    [
        MigrationEntity::Clients,
        MigrationEntity::Staff,
        MigrationEntity::Services,
        MigrationEntity::Products,
        MigrationEntity::Suppliers,
        MigrationEntity::Inventory,
        MigrationEntity::Memberships,
        MigrationEntity::Packages,
    ]
    .into_iter()
    .map(|entity| MigrationTemplate {
        entity,
        columns: contracts(entity)
            .iter()
            .map(|column| MigrationTemplateColumn {
                field: column.field.to_string(),
                required: column.required,
                aliases: column
                    .aliases
                    .iter()
                    .map(|alias| (*alias).to_string())
                    .collect(),
            })
            .collect(),
        duplicate_decisions: vec![
            MigrationDuplicateDecision::Merge,
            MigrationDuplicateDecision::Keep,
            MigrationDuplicateDecision::Link,
        ],
    })
    .collect()
}

pub fn validate_mapping_contract(
    entity: MigrationEntity,
    mapping: &BTreeMap<String, String>,
) -> Result<(), AppError> {
    let fields = contracts(entity)
        .iter()
        .map(|column| clean_key(column.field))
        .collect::<HashSet<_>>();
    if mapping.is_empty()
        || mapping.iter().any(|(source, target)| {
            source.trim().is_empty()
                || (target != "__ignore" && !fields.contains(&clean_key(target)))
        })
    {
        return Err(AppError::validation("mapping contains unsupported columns"));
    }
    Ok(())
}

pub async fn prepare(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    csv: &str,
    provided_mapping: &BTreeMap<String, String>,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
) -> Result<PreparedMigration, AppError> {
    if csv.len() > 5_000_000 {
        return Err(AppError::validation("CSV file is larger than 5 MB"));
    }
    let table = parse_csv(csv)?;
    if table.len() < 2 || table.len() > 5001 {
        return Err(AppError::validation("CSV must contain 1 to 5000 data rows"));
    }
    prepare_table(
        db,
        tenant,
        branch,
        entity,
        &table,
        0,
        provided_mapping,
        duplicate_decisions,
    )
    .await
}

pub async fn prepare_table(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    table: &[Vec<String>],
    source_row_offset: i32,
    provided_mapping: &BTreeMap<String, String>,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
) -> Result<PreparedMigration, AppError> {
    if table.len() < 2 || table.len() > 5001 || source_row_offset < 0 {
        return Err(AppError::validation(
            "source chunk must contain 1 to 5000 data rows",
        ));
    }
    let (mapping, field_indexes, unmatched_columns) =
        resolve_mapping(entity, &table[0], provided_mapping)?;
    let missing_required = contracts(entity)
        .iter()
        .filter(|column| column.required && !field_indexes.contains_key(column.field))
        .map(|column| column.field)
        .collect::<Vec<_>>();
    if !missing_required.is_empty() {
        return Err(AppError::validation(format!(
            "required mappings are missing: {}",
            missing_required.join(", ")
        )));
    }

    let mut rows = Vec::new();
    let mut errors_json = Vec::new();
    let mut row_results = Vec::new();
    let mut analysis_rows = Vec::new();
    let mut seen = HashSet::new();
    let mut summary = MigrationAnalysisSummary::default();

    for (index, source_row) in table.iter().enumerate().skip(1) {
        if source_row.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        summary.source_rows += 1;
        let line = source_row_offset + (index + 1) as i32;
        let external_id = mapped_cell(source_row, &field_indexes, "oldExternalId");
        let mut row_errors = Vec::new();
        let mut row_warnings = Vec::new();
        let mut duplicate_target_id = None;
        let mut duplicate_decision = None;
        let mut payload = Map::new();

        match entity {
            MigrationEntity::Clients => {
                let first_name = mapped_cell(source_row, &field_indexes, "firstName");
                let phone = mapped_cell(source_row, &field_indexes, "phone");
                let normalized_phone = match client_service::normalize_phone(&phone) {
                    Ok(value) => value,
                    Err(_) => {
                        push_issue(&mut row_errors, "INVALID_PHONE", "phone is invalid");
                        String::new()
                    }
                };
                if first_name.is_empty() {
                    push_issue(&mut row_errors, "REQUIRED_FIELD", "firstName is required");
                }
                let email = mapped_cell(source_row, &field_indexes, "email").to_ascii_lowercase();
                if !email.is_empty() && !email.contains('@') {
                    push_issue(&mut row_errors, "INVALID_EMAIL", "email is invalid");
                } else if email.is_empty() {
                    push_issue(&mut row_warnings, "MISSING_EMAIL", "email is empty");
                }
                let birthday = parse_optional_date(
                    &mapped_cell(source_row, &field_indexes, "birthday"),
                    &mut row_errors,
                    "birthday",
                );
                let anniversary = parse_optional_date(
                    &mapped_cell(source_row, &field_indexes, "anniversary"),
                    &mut row_errors,
                    "anniversary",
                );
                let active = parse_active(
                    &mapped_cell(source_row, &field_indexes, "active"),
                    &mut row_errors,
                );
                if !normalized_phone.is_empty() && !seen.insert(normalized_phone.clone()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate phone in CSV",
                    );
                }
                if row_errors.is_empty() {
                    if let Some((target_id, _)) = migration_repository::find_client_duplicate(
                        db,
                        tenant,
                        branch,
                        &normalized_phone,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to analyze client duplicates"))?
                    {
                        duplicate_target_id = Some(target_id);
                        duplicate_decision = decision_for(
                            duplicate_decisions,
                            entity,
                            line,
                            &external_id,
                            &normalized_phone,
                        );
                        if duplicate_decision.is_none() {
                            push_issue(
                                &mut row_warnings,
                                "DUPLICATE_DECISION_REQUIRED",
                                "choose merge, keep or link",
                            );
                        }
                    }
                }
                payload.extend([
                    (
                        "code".into(),
                        json!(mapped_cell(source_row, &field_indexes, "code")),
                    ),
                    ("first_name".into(), json!(first_name)),
                    (
                        "last_name".into(),
                        json!(mapped_cell(source_row, &field_indexes, "lastName")),
                    ),
                    ("phone".into(), json!(phone)),
                    ("normalized_phone".into(), json!(normalized_phone)),
                    ("email".into(), json!(email)),
                    (
                        "membership_label".into(),
                        json!(mapped_cell(source_row, &field_indexes, "membershipLabel")),
                    ),
                    (
                        "categories_json".into(),
                        json!(split_list(&mapped_cell(
                            source_row,
                            &field_indexes,
                            "categories"
                        ))),
                    ),
                    ("birthday".into(), json!(birthday)),
                    ("anniversary".into(), json!(anniversary)),
                    (
                        "notes".into(),
                        json!(mapped_cell(source_row, &field_indexes, "notes")),
                    ),
                    ("active".into(), json!(active)),
                ]);
            }
            MigrationEntity::Staff => {
                let employee_code = mapped_cell(source_row, &field_indexes, "employeeCode");
                let first_name = mapped_cell(source_row, &field_indexes, "firstName");
                if employee_code.is_empty() || first_name.is_empty() {
                    push_issue(
                        &mut row_errors,
                        "REQUIRED_FIELD",
                        "employeeCode and firstName are required",
                    );
                }
                let email = mapped_cell(source_row, &field_indexes, "email").to_ascii_lowercase();
                if !email.is_empty() && !email.contains('@') {
                    push_issue(&mut row_errors, "INVALID_EMAIL", "email is invalid");
                } else if email.is_empty() {
                    push_issue(&mut row_warnings, "MISSING_EMAIL", "email is empty");
                }
                let active = parse_active(
                    &mapped_cell(source_row, &field_indexes, "active"),
                    &mut row_errors,
                );
                if !employee_code.is_empty() && !seen.insert(employee_code.to_ascii_lowercase()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate employeeCode in CSV",
                    );
                }
                if row_errors.is_empty() {
                    if let Some((target_id, target_branch, _)) =
                        migration_repository::find_staff_duplicate(db, tenant, &employee_code)
                            .await
                            .map_err(|_| AppError::internal("failed to analyze staff duplicates"))?
                    {
                        if target_branch != branch {
                            push_issue(
                                &mut row_errors,
                                "CROSS_BRANCH_DUPLICATE",
                                "employeeCode belongs to another branch",
                            );
                        } else {
                            duplicate_target_id = Some(target_id);
                            duplicate_decision = decision_for(
                                duplicate_decisions,
                                entity,
                                line,
                                &external_id,
                                &employee_code,
                            );
                            if duplicate_decision.is_none() {
                                push_issue(
                                    &mut row_warnings,
                                    "DUPLICATE_DECISION_REQUIRED",
                                    "choose merge, keep or link",
                                );
                            }
                        }
                    }
                }
                payload.extend([
                    ("employee_code".into(), json!(employee_code)),
                    ("first_name".into(), json!(first_name)),
                    (
                        "last_name".into(),
                        json!(mapped_cell(source_row, &field_indexes, "lastName")),
                    ),
                    ("email".into(), json!(email)),
                    (
                        "mobile_phone".into(),
                        json!(mapped_cell(source_row, &field_indexes, "mobilePhone")),
                    ),
                    (
                        "job_title".into(),
                        json!(mapped_cell(source_row, &field_indexes, "jobTitle")),
                    ),
                    ("active".into(), json!(active)),
                ]);
            }
            MigrationEntity::Services => {
                let name = mapped_cell(source_row, &field_indexes, "name");
                if name.is_empty() {
                    push_issue(&mut row_errors, "REQUIRED_FIELD", "name is required");
                }
                let duration = parse_i32_field(
                    &mapped_cell(source_row, &field_indexes, "durationMinutes"),
                    "durationMinutes",
                    1,
                    &mut row_errors,
                );
                let price = parse_i64_field(
                    &mapped_cell(source_row, &field_indexes, "pricePaise"),
                    "pricePaise",
                    0,
                    &mut row_errors,
                );
                let gst = parse_i32_field_default(
                    &mapped_cell(source_row, &field_indexes, "gstPercent"),
                    "gstPercent",
                    0,
                    0,
                    &mut row_errors,
                );
                if gst > 100 {
                    push_issue(
                        &mut row_errors,
                        "INVALID_NUMBER",
                        "gstPercent must be between 0 and 100",
                    );
                }
                if duration > 1_440 {
                    push_issue(
                        &mut row_errors,
                        "INVALID_NUMBER",
                        "durationMinutes must not exceed 1440",
                    );
                }
                if price > i64::from(i32::MAX) {
                    push_issue(&mut row_errors, "INVALID_NUMBER", "pricePaise is too large");
                }
                let duplicate_key = name.to_ascii_lowercase();
                if !duplicate_key.is_empty() && !seen.insert(duplicate_key) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate service name in CSV",
                    );
                }
                if row_errors.is_empty() {
                    if let Some((target_id, _)) = migration_repository::find_master_duplicate(
                        db, tenant, branch, entity, &name,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to analyze service duplicates"))?
                    {
                        duplicate_target_id = Some(target_id);
                        duplicate_decision =
                            decision_for(duplicate_decisions, entity, line, &external_id, &name);
                        if duplicate_decision.is_none() {
                            push_issue(
                                &mut row_warnings,
                                "DUPLICATE_DECISION_REQUIRED",
                                "choose merge, keep or link",
                            );
                        }
                    }
                }
                payload.extend([
                    ("name".into(), json!(name)),
                    (
                        "category".into(),
                        json!(mapped_cell(source_row, &field_indexes, "category")),
                    ),
                    ("duration_minutes".into(), json!(duration)),
                    ("price_paise".into(), json!(price)),
                    ("gst_percent".into(), json!(gst)),
                    (
                        "sac_code".into(),
                        json!(mapped_cell(source_row, &field_indexes, "sacCode")),
                    ),
                    (
                        "wait_time_minutes".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "waitTimeMinutes"),
                            "waitTimeMinutes",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "cleanup_time_minutes".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "cleanupTimeMinutes"),
                            "cleanupTimeMinutes",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "buffer_time_minutes".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "bufferTimeMinutes"),
                            "bufferTimeMinutes",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "active".into(),
                        json!(parse_active(
                            &mapped_cell(source_row, &field_indexes, "active"),
                            &mut row_errors
                        )),
                    ),
                ]);
            }
            MigrationEntity::Products => {
                let sku = mapped_cell(source_row, &field_indexes, "sku");
                let name = mapped_cell(source_row, &field_indexes, "name");
                let gst = parse_i32_field_default(
                    &mapped_cell(source_row, &field_indexes, "gstPercent"),
                    "gstPercent",
                    0,
                    0,
                    &mut row_errors,
                );
                if sku.is_empty() || name.is_empty() {
                    push_issue(
                        &mut row_errors,
                        "REQUIRED_FIELD",
                        "sku and name are required",
                    );
                }
                if gst > 100 {
                    push_issue(
                        &mut row_errors,
                        "INVALID_NUMBER",
                        "gstPercent must be between 0 and 100",
                    );
                }
                if !sku.is_empty() && !seen.insert(sku.to_ascii_lowercase()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate SKU in CSV",
                    );
                }
                if row_errors.is_empty() {
                    if let Some((target_id, _)) = migration_repository::find_master_duplicate(
                        db, tenant, branch, entity, &sku,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to analyze product duplicates"))?
                    {
                        duplicate_target_id = Some(target_id);
                        duplicate_decision =
                            decision_for(duplicate_decisions, entity, line, &external_id, &sku);
                        if duplicate_decision.is_none() {
                            push_issue(
                                &mut row_warnings,
                                "DUPLICATE_DECISION_REQUIRED",
                                "choose merge, keep or link",
                            );
                        }
                    }
                }
                payload.extend([
                    ("sku".into(), json!(sku)),
                    ("name".into(), json!(name)),
                    (
                        "category".into(),
                        json!(mapped_cell(source_row, &field_indexes, "category")),
                    ),
                    (
                        "unit".into(),
                        json!(default_text(
                            &mapped_cell(source_row, &field_indexes, "unit"),
                            "pcs"
                        )),
                    ),
                    (
                        "reorder_point".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "reorderPoint"),
                            "reorderPoint",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "unit_cost_paise".into(),
                        json!(parse_i64_field_default(
                            &mapped_cell(source_row, &field_indexes, "unitCostPaise"),
                            "unitCostPaise",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "hsn_code".into(),
                        json!(mapped_cell(source_row, &field_indexes, "hsnCode")),
                    ),
                    ("gst_percent".into(), json!(gst)),
                    (
                        "barcode".into(),
                        json!(mapped_cell(source_row, &field_indexes, "barcode")),
                    ),
                    (
                        "batch_tracked".into(),
                        json!(parse_boolean_default(
                            &mapped_cell(source_row, &field_indexes, "batchTracked"),
                            false,
                            "batchTracked",
                            &mut row_errors
                        )),
                    ),
                    (
                        "active".into(),
                        json!(parse_active(
                            &mapped_cell(source_row, &field_indexes, "active"),
                            &mut row_errors
                        )),
                    ),
                ]);
            }
            MigrationEntity::Suppliers => {
                let code = mapped_cell(source_row, &field_indexes, "code");
                let name = mapped_cell(source_row, &field_indexes, "name");
                if code.is_empty() || name.is_empty() {
                    push_issue(
                        &mut row_errors,
                        "REQUIRED_FIELD",
                        "code and name are required",
                    );
                }
                let email = mapped_cell(source_row, &field_indexes, "email").to_ascii_lowercase();
                if !email.is_empty() && !email.contains('@') {
                    push_issue(&mut row_errors, "INVALID_EMAIL", "email is invalid");
                }
                if !code.is_empty() && !seen.insert(code.to_ascii_lowercase()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate supplier code in CSV",
                    );
                }
                if row_errors.is_empty() {
                    if let Some((target_id, _)) = migration_repository::find_master_duplicate(
                        db, tenant, branch, entity, &code,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to analyze supplier duplicates"))?
                    {
                        duplicate_target_id = Some(target_id);
                        duplicate_decision =
                            decision_for(duplicate_decisions, entity, line, &external_id, &code);
                        if duplicate_decision.is_none() {
                            push_issue(
                                &mut row_warnings,
                                "DUPLICATE_DECISION_REQUIRED",
                                "choose merge, keep or link",
                            );
                        }
                    }
                }
                payload.extend([
                    ("code".into(), json!(code)), ("name".into(), json!(name)),
                    ("gstin".into(), json!(mapped_cell(source_row, &field_indexes, "gstin").to_ascii_uppercase())),
                    ("contact_name".into(), json!(mapped_cell(source_row, &field_indexes, "contactName"))),
                    ("phone".into(), json!(mapped_cell(source_row, &field_indexes, "phone"))),
                    ("email".into(), json!(email)),
                    ("address".into(), json!(mapped_cell(source_row, &field_indexes, "address"))),
                    ("payment_terms_days".into(), json!(parse_i32_field_default(&mapped_cell(source_row, &field_indexes, "paymentTermsDays"), "paymentTermsDays", 0, 0, &mut row_errors))),
                    ("active".into(), json!(parse_active(&mapped_cell(source_row, &field_indexes, "active"), &mut row_errors))),
                ]);
            }
            MigrationEntity::Inventory => {
                let product = mapped_cell(source_row, &field_indexes, "product");
                let opening_stock = parse_i32_field(
                    &mapped_cell(source_row, &field_indexes, "openingStock"),
                    "openingStock",
                    1,
                    &mut row_errors,
                );
                if product.is_empty() {
                    push_issue(&mut row_errors, "REQUIRED_FIELD", "product is required");
                }
                let resolved = if row_errors.is_empty() {
                    migration_repository::resolve_inventory_item(db, tenant, branch, &product)
                        .await
                        .map_err(|_| AppError::internal("failed to resolve inventory product"))?
                } else {
                    None
                };
                let (item_id, current_cost) = match resolved {
                    Some(value) => value,
                    None => {
                        if row_errors.is_empty() {
                            push_issue(
                                &mut row_errors,
                                "DEPENDENCY_NOT_FOUND",
                                "product must be imported before opening stock",
                            );
                        }
                        (String::new(), 0)
                    }
                };
                if !item_id.is_empty() && !seen.insert(item_id.clone()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "opening stock for this product appears twice in CSV",
                    );
                }
                let unit_cost = parse_i64_field_default(
                    &mapped_cell(source_row, &field_indexes, "unitCostPaise"),
                    "unitCostPaise",
                    0,
                    current_cost,
                    &mut row_errors,
                );
                payload.extend([
                    ("product_reference".into(), json!(product)),
                    ("inventory_item_id".into(), json!(item_id)),
                    ("opening_stock".into(), json!(opening_stock)),
                    ("unit_cost_paise".into(), json!(unit_cost)),
                ]);
            }
            MigrationEntity::Memberships | MigrationEntity::Packages => {
                let is_membership = entity == MigrationEntity::Memberships;
                let name = mapped_cell(source_row, &field_indexes, "name");
                let code = mapped_cell(source_row, &field_indexes, "code");
                let plan_type = default_text(
                    &mapped_cell(source_row, &field_indexes, "planType"),
                    "discount",
                );
                let discount_percent = parse_i32_field_default(
                    &mapped_cell(source_row, &field_indexes, "discountPercent"),
                    "discountPercent",
                    0,
                    0,
                    &mut row_errors,
                );
                let duplicate_key = if is_membership {
                    code.clone()
                } else {
                    name.clone()
                };
                if name.is_empty() || (is_membership && code.is_empty()) {
                    push_issue(
                        &mut row_errors,
                        "REQUIRED_FIELD",
                        if is_membership {
                            "code and name are required"
                        } else {
                            "name is required"
                        },
                    );
                }
                if discount_percent > 100 {
                    push_issue(
                        &mut row_errors,
                        "INVALID_NUMBER",
                        "discountPercent must be between 0 and 100",
                    );
                }
                if is_membership
                    && !matches!(
                        plan_type.as_str(),
                        "discount"
                            | "prepaid_credit"
                            | "visit_pack"
                            | "service_credit"
                            | "combo"
                            | "unlimited"
                            | "family"
                            | "corporate"
                            | "tiered"
                    )
                {
                    push_issue(&mut row_errors, "INVALID_VALUE", "planType is invalid");
                }
                if !duplicate_key.is_empty() && !seen.insert(duplicate_key.to_ascii_lowercase()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate plan key in CSV",
                    );
                }
                let mut service_ids = Vec::new();
                let mut service_rows = Vec::new();
                for reference in split_list(&mapped_cell(source_row, &field_indexes, "services")) {
                    match migration_repository::resolve_service(db, tenant, branch, &reference)
                        .await
                        .map_err(|_| AppError::internal("failed to resolve service dependency"))?
                    {
                        Some((service_id, price_paise)) if !service_ids.contains(&service_id) => {
                            service_rows.push(json!({"serviceId":service_id,"quantity":1,"unitPricePaise":price_paise,"addonPricePaise":0}));
                            service_ids.push(service_id);
                        }
                        Some(_) => {}
                        None => push_issue(
                            &mut row_errors,
                            "DEPENDENCY_NOT_FOUND",
                            &format!("service '{reference}' was not found in this branch"),
                        ),
                    }
                }
                if !is_membership && service_ids.is_empty() {
                    push_issue(
                        &mut row_errors,
                        "REQUIRED_FIELD",
                        "at least one service is required",
                    );
                }
                if row_errors.is_empty() {
                    if let Some((target_id, _)) = migration_repository::find_master_duplicate(
                        db,
                        tenant,
                        branch,
                        entity,
                        &duplicate_key,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to analyze plan duplicates"))?
                    {
                        duplicate_target_id = Some(target_id);
                        duplicate_decision = decision_for(
                            duplicate_decisions,
                            entity,
                            line,
                            &external_id,
                            &duplicate_key,
                        );
                        if duplicate_decision.is_none() {
                            push_issue(
                                &mut row_warnings,
                                "DUPLICATE_DECISION_REQUIRED",
                                "choose merge, keep or link",
                            );
                        }
                    }
                }
                payload.extend([
                    ("name".into(), json!(name)),
                    ("code".into(), json!(code)),
                    (
                        "description".into(),
                        json!(mapped_cell(source_row, &field_indexes, "description")),
                    ),
                    ("plan_type".into(), json!(plan_type)),
                    (
                        "price_paise".into(),
                        json!(parse_i64_field_default(
                            &mapped_cell(source_row, &field_indexes, "pricePaise"),
                            "pricePaise",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "points_required".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "pointsRequired"),
                            "pointsRequired",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    ("discount_percent".into(), json!(discount_percent)),
                    (
                        "validity_days".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "validityDays"),
                            "validityDays",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "notes".into(),
                        json!(mapped_cell(source_row, &field_indexes, "notes")),
                    ),
                    ("service_ids_json".into(), json!(service_ids)),
                    ("service_rows_json".into(), json!(service_rows)),
                    (
                        "paid_sessions".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "paidSessions"),
                            "paidSessions",
                            1,
                            1,
                            &mut row_errors
                        )),
                    ),
                    (
                        "free_sessions".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "freeSessions"),
                            "freeSessions",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "cost_price_paise".into(),
                        json!(parse_i64_field_default(
                            &mapped_cell(source_row, &field_indexes, "costPricePaise"),
                            "costPricePaise",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "show_mobile_app".into(),
                        json!(parse_boolean_default(
                            &mapped_cell(source_row, &field_indexes, "showMobileApp"),
                            false,
                            "showMobileApp",
                            &mut row_errors
                        )),
                    ),
                    (
                        "show_online_booking".into(),
                        json!(parse_boolean_default(
                            &mapped_cell(source_row, &field_indexes, "showOnlineBooking"),
                            true,
                            "showOnlineBooking",
                            &mut row_errors
                        )),
                    ),
                    (
                        "active".into(),
                        json!(parse_active(
                            &mapped_cell(source_row, &field_indexes, "active"),
                            &mut row_errors
                        )),
                    ),
                ]);
            }
        }

        payload.insert("source_row_number".into(), json!(line));
        payload.insert("source_external_id".into(), json!(external_id));
        payload.insert(
            "duplicate_target_id".into(),
            json!(duplicate_target_id.clone()),
        );
        payload.insert(
            "duplicate_decision".into(),
            json!(duplicate_decision.map(MigrationDuplicateDecision::as_str)),
        );

        let unresolved_duplicate = duplicate_target_id.is_some() && duplicate_decision.is_none();
        let status = if !row_errors.is_empty() {
            MigrationRowStatus::Error
        } else if duplicate_target_id.is_some() {
            MigrationRowStatus::Duplicate
        } else if !row_warnings.is_empty() {
            MigrationRowStatus::Warning
        } else {
            MigrationRowStatus::Validated
        };
        if !row_errors.is_empty() {
            summary.error_rows += 1;
        } else {
            summary.valid_rows += 1;
        }
        if !row_warnings.is_empty() {
            summary.warning_rows += 1;
        }
        if duplicate_target_id.is_some() {
            summary.duplicate_rows += 1;
        }
        if row_errors.is_empty() && !unresolved_duplicate {
            summary.ready_rows += 1;
            rows.push(Value::Object(payload.clone()));
        }
        if !row_errors.is_empty() || unresolved_duplicate {
            let issue = row_errors
                .first()
                .or_else(|| row_warnings.first())
                .cloned()
                .unwrap_or(MigrationRowIssue {
                    code: "ROW_BLOCKED".into(),
                    message: "row is blocked".into(),
                });
            errors_json.push(json!({"row":line,"code":issue.code,"message":issue.message}));
        }
        row_results.push(NewMigrationRowResult {
            source_row_number: line,
            source_external_id: external_id.clone(),
            status,
            error_code: row_errors
                .first()
                .map(|issue| issue.code.clone())
                .unwrap_or_default(),
            message: row_errors
                .first()
                .map(|issue| issue.message.clone())
                .unwrap_or_default(),
            warnings: json!(row_warnings),
            duplicate_target_id: duplicate_target_id.clone().unwrap_or_default(),
            duplicate_decision: duplicate_decision
                .map(|decision| decision.as_str().to_string())
                .unwrap_or_default(),
            source_payload: Value::Object(payload),
        });
        analysis_rows.push(MigrationAnalysisRow {
            source_row_number: line,
            source_external_id: external_id,
            status,
            errors: row_errors,
            warnings: row_warnings,
            duplicate_target_id,
            duplicate_decision,
        });
    }

    if summary.source_rows == 0 {
        return Err(AppError::validation("CSV has no non-empty data rows"));
    }
    let report = MigrationAnalysisReport {
        entity,
        mapping,
        unmatched_columns,
        rows: analysis_rows,
        summary,
    };
    Ok(PreparedMigration {
        report,
        rows: Value::Array(rows),
        errors: Value::Array(errors_json),
        row_results: serde_json::to_value(row_results)
            .map_err(|_| AppError::internal("failed to prepare import row results"))?,
    })
}

fn contracts(entity: MigrationEntity) -> &'static [ColumnContract] {
    match entity {
        MigrationEntity::Clients => CLIENT_COLUMNS,
        MigrationEntity::Staff => STAFF_COLUMNS,
        MigrationEntity::Services => SERVICE_COLUMNS,
        MigrationEntity::Products => PRODUCT_COLUMNS,
        MigrationEntity::Suppliers => SUPPLIER_COLUMNS,
        MigrationEntity::Inventory => INVENTORY_COLUMNS,
        MigrationEntity::Memberships => MEMBERSHIP_COLUMNS,
        MigrationEntity::Packages => PACKAGE_COLUMNS,
    }
}

fn resolve_mapping(
    entity: MigrationEntity,
    headers: &[String],
    provided: &BTreeMap<String, String>,
) -> Result<
    (
        BTreeMap<String, String>,
        HashMap<&'static str, usize>,
        Vec<String>,
    ),
    AppError,
> {
    let header_indexes = headers
        .iter()
        .enumerate()
        .map(|(index, header)| (clean_key(header), index))
        .collect::<HashMap<_, _>>();
    let contract_by_key = contracts(entity)
        .iter()
        .map(|column| (clean_key(column.field), column))
        .collect::<HashMap<_, _>>();
    let mut result = BTreeMap::new();
    let mut field_indexes = HashMap::new();

    for (source, target) in provided {
        let source_key = clean_key(source);
        let target_key = clean_key(target);
        let resolved = if let (Some(index), Some(column)) = (
            header_indexes.get(&source_key),
            contract_by_key.get(&target_key),
        ) {
            Some((*index, *column))
        } else if let (Some(column), Some(index)) = (
            contract_by_key.get(&source_key),
            header_indexes.get(&target_key),
        ) {
            Some((*index, *column))
        } else if target == "__ignore" {
            None
        } else {
            return Err(AppError::validation(format!(
                "invalid mapping {source} -> {target}"
            )));
        };
        if let Some((index, column)) = resolved {
            if field_indexes.insert(column.field, index).is_some() {
                return Err(AppError::validation("mapping assigns a target field twice"));
            }
            result.insert(headers[index].clone(), column.field.to_string());
        }
    }

    for (index, header) in headers.iter().enumerate() {
        if result.contains_key(header) {
            continue;
        }
        let key = clean_key(header);
        if let Some(column) = contracts(entity).iter().find(|column| {
            clean_key(column.field) == key
                || column.aliases.iter().any(|alias| clean_key(alias) == key)
        }) {
            if !field_indexes.contains_key(column.field) {
                field_indexes.insert(column.field, index);
                result.insert(header.clone(), column.field.to_string());
            }
        }
    }
    let matched = result
        .keys()
        .map(|value| clean_key(value))
        .collect::<HashSet<_>>();
    let unmatched = headers
        .iter()
        .filter(|header| !matched.contains(&clean_key(header)))
        .cloned()
        .collect();
    Ok((result, field_indexes, unmatched))
}

fn mapped_cell(
    row: &[String],
    field_indexes: &HashMap<&'static str, usize>,
    field: &'static str,
) -> String {
    field_indexes
        .get(field)
        .and_then(|index| row.get(*index))
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn decision_for(
    decisions: &BTreeMap<String, MigrationDuplicateDecision>,
    entity: MigrationEntity,
    line: i32,
    external_id: &str,
    duplicate_key: &str,
) -> Option<MigrationDuplicateDecision> {
    [
        line.to_string(),
        format!("csv:{line}"),
        external_id.to_string(),
        format!("{}:{}", entity.as_str(), duplicate_key.to_ascii_lowercase()),
    ]
    .iter()
    .find_map(|key| decisions.get(key).copied())
}

fn parse_optional_date(
    value: &str,
    errors: &mut Vec<MigrationRowIssue>,
    field: &str,
) -> Option<NaiveDate> {
    if value.is_empty() {
        return None;
    }
    for format in ["%Y-%m-%d", "%d/%m/%Y"] {
        if let Ok(date) = NaiveDate::parse_from_str(value, format) {
            return Some(date);
        }
    }
    push_issue(
        errors,
        "INVALID_DATE",
        &format!("{field} must be YYYY-MM-DD or DD/MM/YYYY"),
    );
    None
}

fn parse_active(value: &str, errors: &mut Vec<MigrationRowIssue>) -> bool {
    match value.to_ascii_lowercase().as_str() {
        "" | "true" | "yes" | "1" | "active" => true,
        "false" | "no" | "0" | "inactive" => false,
        _ => {
            push_issue(errors, "INVALID_BOOLEAN", "active must be Yes or No");
            true
        }
    }
}

fn parse_boolean_default(
    value: &str,
    default: bool,
    field: &str,
    errors: &mut Vec<MigrationRowIssue>,
) -> bool {
    match value.trim().to_ascii_lowercase().as_str() {
        "" => default,
        "true" | "yes" | "1" | "active" => true,
        "false" | "no" | "0" | "inactive" => false,
        _ => {
            push_issue(
                errors,
                "INVALID_BOOLEAN",
                &format!("{field} must be Yes or No"),
            );
            default
        }
    }
}

fn parse_i32_field(
    value: &str,
    field: &str,
    minimum: i32,
    errors: &mut Vec<MigrationRowIssue>,
) -> i32 {
    if value.trim().is_empty() {
        push_issue(errors, "REQUIRED_FIELD", &format!("{field} is required"));
        return minimum;
    }
    parse_i32_field_default(value, field, minimum, minimum, errors)
}

fn parse_i32_field_default(
    value: &str,
    field: &str,
    minimum: i32,
    default: i32,
    errors: &mut Vec<MigrationRowIssue>,
) -> i32 {
    if value.trim().is_empty() {
        return default;
    }
    match value.trim().parse::<i32>() {
        Ok(number) if number >= minimum => number,
        _ => {
            push_issue(
                errors,
                "INVALID_NUMBER",
                &format!("{field} must be at least {minimum}"),
            );
            default
        }
    }
}

fn parse_i64_field(
    value: &str,
    field: &str,
    minimum: i64,
    errors: &mut Vec<MigrationRowIssue>,
) -> i64 {
    if value.trim().is_empty() {
        push_issue(errors, "REQUIRED_FIELD", &format!("{field} is required"));
        return minimum;
    }
    parse_i64_field_default(value, field, minimum, minimum, errors)
}

fn parse_i64_field_default(
    value: &str,
    field: &str,
    minimum: i64,
    default: i64,
    errors: &mut Vec<MigrationRowIssue>,
) -> i64 {
    if value.trim().is_empty() {
        return default;
    }
    match value.trim().parse::<i64>() {
        Ok(number) if number >= minimum => number,
        _ => {
            push_issue(
                errors,
                "INVALID_NUMBER",
                &format!("{field} must be at least {minimum}"),
            );
            default
        }
    }
}

fn default_text(value: &str, default: &str) -> String {
    if value.trim().is_empty() {
        default.to_string()
    } else {
        value.trim().to_string()
    }
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split([',', ';'])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

fn push_issue(issues: &mut Vec<MigrationRowIssue>, code: &str, message: &str) {
    issues.push(MigrationRowIssue {
        code: code.to_string(),
        message: message.to_string(),
    });
}

fn clean_key(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect()
}

fn parse_csv(input: &str) -> Result<Vec<Vec<String>>, AppError> {
    let mut table = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut chars = input.chars().peekable();
    let mut quoted = false;
    while let Some(character) = chars.next() {
        if quoted {
            if character == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cell.push('"');
                } else {
                    quoted = false;
                }
            } else {
                cell.push(character);
            }
        } else {
            match character {
                '"' if cell.is_empty() => quoted = true,
                ',' => {
                    row.push(std::mem::take(&mut cell));
                }
                '\n' => {
                    row.push(std::mem::take(&mut cell));
                    table.push(std::mem::take(&mut row));
                }
                '\r' => {
                    if chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    row.push(std::mem::take(&mut cell));
                    table.push(std::mem::take(&mut row));
                }
                _ => cell.push(character),
            }
        }
    }
    if quoted {
        return Err(AppError::validation("CSV has an unclosed quote"));
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        table.push(row);
    }
    if table.first().is_some_and(|header| {
        header
            .first()
            .is_some_and(|cell| cell.starts_with('\u{feff}'))
    }) {
        if let Some(first) = table.first_mut().and_then(|header| header.first_mut()) {
            *first = first.trim_start_matches('\u{feff}').to_string();
        }
    }
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    #[test]
    fn client_template_auto_maps_legacy_aliases() {
        let headers = vec![
            "Customer Name".into(),
            "Mobile Number".into(),
            "Old ID".into(),
        ];
        let (mapping, indexes, unmatched) =
            resolve_mapping(MigrationEntity::Clients, &headers, &BTreeMap::new()).unwrap();
        assert_eq!(mapping["Customer Name"], "firstName");
        assert_eq!(indexes["phone"], 1);
        assert!(unmatched.is_empty());
    }

    #[test]
    fn duplicate_decision_accepts_row_external_and_identity_keys() {
        let decisions = BTreeMap::from([
            ("legacy-1".into(), MigrationDuplicateDecision::Link),
            ("staff:emp-2".into(), MigrationDuplicateDecision::Merge),
        ]);
        assert_eq!(
            decision_for(&decisions, MigrationEntity::Clients, 2, "legacy-1", "+91"),
            Some(MigrationDuplicateDecision::Link)
        );
        assert_eq!(
            decision_for(&decisions, MigrationEntity::Staff, 3, "", "EMP-2"),
            Some(MigrationDuplicateDecision::Merge)
        );
    }

    #[test]
    fn master_data_templates_follow_dependency_order() {
        let entities = templates()
            .into_iter()
            .map(|template| template.entity)
            .collect::<Vec<_>>();
        assert_eq!(
            entities,
            vec![
                MigrationEntity::Clients,
                MigrationEntity::Staff,
                MigrationEntity::Services,
                MigrationEntity::Products,
                MigrationEntity::Suppliers,
                MigrationEntity::Inventory,
                MigrationEntity::Memberships,
                MigrationEntity::Packages,
            ]
        );
        assert!(contracts(MigrationEntity::Inventory)
            .iter()
            .any(|column| column.field == "product" && column.required));
        assert!(contracts(MigrationEntity::Packages)
            .iter()
            .any(|column| column.field == "services" && column.required));
    }

    #[sqlx::test(migrations = false)]
    async fn analyze_reports_duplicates_without_writing_live_rows(pool: PgPool) {
        sqlx::query(
            "CREATE TABLE clients(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,first_name TEXT NOT NULL,normalized_phone TEXT NOT NULL,merged_into_client_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE staff(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,branch_id TEXT NOT NULL,employee_code TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO clients VALUES('client-1','tenant-1','branch-1','Existing','+919876543210',NULL,NOW())")
            .execute(&pool).await.unwrap();
        let csv =
            "Old ID,Customer Name,Mobile,Email\nlegacy-1,Incoming,9876543210,incoming@example.test";

        let unresolved = prepare(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            csv,
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(unresolved.report.summary.duplicate_rows, 1);
        assert_eq!(unresolved.report.summary.ready_rows, 0);
        assert_eq!(
            unresolved.report.rows[0].status,
            MigrationRowStatus::Duplicate
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM clients")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );

        let decisions = BTreeMap::from([("legacy-1".into(), MigrationDuplicateDecision::Merge)]);
        let resolved = prepare(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            csv,
            &BTreeMap::new(),
            &decisions,
        )
        .await
        .unwrap();
        assert_eq!(resolved.report.summary.ready_rows, 1);
        assert_eq!(
            resolved.rows[0]["duplicate_decision"],
            MigrationDuplicateDecision::Merge.as_str()
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM clients")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }
}
