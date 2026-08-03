use crate::{
    models::{
        common::AppError,
        migration::{
            MigrationAlias, MigrationAnalysisReport, MigrationAnalysisRow,
            MigrationAnalysisSummary, MigrationDuplicateDecision, MigrationDuplicatePreview,
            MigrationDuplicateSignal, MigrationEntity, MigrationMappingDecision, MigrationProvider,
            MigrationRowIssue, MigrationRowStatus, MigrationTargetAlternative, MigrationTemplate,
            MigrationTemplateColumn, NewMigrationRowResult,
        },
        migration_file::MigrationSourceColumnProfile,
    },
    repositories::{migration_large_import_repository, migration_repository},
    services::{client_service, outgoing_funds_service},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
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

const MIGRATION_CONTRACT_VERSION: &str = "2026-07-phase2-v1";
pub(crate) const MIGRATION_TRANSFORMER_VERSION: &str = "2026-07-phase5-v1";
const MIGRATION_SAFETY_RULE_VERSION: &str = "2026-07-phase6-v1";
const MIGRATION_CROSS_FIELD_RULE_VERSION: &str = "2026-07-phase7-v1";
const MIGRATION_DEPENDENCY_RULE_VERSION: &str = "2026-07-phase8-v1";

fn is_dependency_issue(code: &str) -> bool {
    matches!(
        code,
        "DEPENDENCY_NOT_FOUND"
            | "APPOINTMENT_CLIENT_NOT_FOUND"
            | "APPOINTMENT_STAFF_NOT_FOUND"
            | "APPOINTMENT_SERVICE_NOT_FOUND"
            | "MEMBERSHIP_CLIENT_NOT_FOUND"
            | "MEMBERSHIP_PLAN_NOT_FOUND"
            | "PAYMENT_INVOICE_NOT_FOUND"
            | "REFUND_INVOICE_NOT_FOUND"
            | "REFUND_PAYMENT_NOT_FOUND"
            | "COMMISSION_INVOICE_NOT_FOUND"
            | "COMMISSION_SALE_LINE_NOT_FOUND"
            | "COMMISSION_STAFF_NOT_FOUND"
            | "STOCK_PRODUCT_NOT_FOUND"
            | "FILE_OWNER_NOT_FOUND"
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationValueTransformation {
    source_field: String,
    target_field: String,
    original_value: String,
    transformer: String,
    transformer_version: &'static str,
    transformed_value: Option<String>,
    phone_extension: Option<String>,
    source_timezone: Option<String>,
    warnings: Vec<MigrationRowIssue>,
    errors: Vec<MigrationRowIssue>,
}

struct TransformedMigrationRow {
    row: Vec<String>,
    fields: Vec<MigrationValueTransformation>,
    errors: Vec<MigrationRowIssue>,
    warnings: Vec<MigrationRowIssue>,
}

const GLOBAL_PHONE_ALIASES: &[&str] = &[
    "phone",
    "phone number",
    "telephone",
    "mobile",
    "mobile no",
    "mobile number",
    "contact number",
    "contact",
];
const GLOBAL_EMAIL_ALIASES: &[&str] = &["email", "email id", "e-mail", "mail", "contact"];

struct ProviderAliasRule {
    provider: MigrationProvider,
    entity: MigrationEntity,
    alias: &'static str,
    target: &'static str,
}

const PROVIDER_ALIAS_RULES: &[ProviderAliasRule] = &[
    ProviderAliasRule {
        provider: MigrationProvider::Zenoti,
        entity: MigrationEntity::Clients,
        alias: "guest mobile",
        target: "phone",
    },
    ProviderAliasRule {
        provider: MigrationProvider::Zenoti,
        entity: MigrationEntity::Clients,
        alias: "guest email",
        target: "email",
    },
    ProviderAliasRule {
        provider: MigrationProvider::Dingg,
        entity: MigrationEntity::Clients,
        alias: "customer contact",
        target: "phone",
    },
    ProviderAliasRule {
        provider: MigrationProvider::Dingg,
        entity: MigrationEntity::Staff,
        alias: "staff mobile",
        target: "mobilePhone",
    },
];

pub(crate) struct MappingResolution {
    pub mapping: BTreeMap<String, String>,
    pub field_indexes: HashMap<&'static str, usize>,
    pub unmatched: Vec<String>,
    pub decisions: Vec<MigrationMappingDecision>,
    pub blocking_reasons: Vec<String>,
    pub hard_blocking_reasons: Vec<String>,
    pub approval_required_reasons: BTreeMap<String, String>,
}

pub(crate) const MIGRATION_CONFIDENCE_RULE_VERSION: &str = "2026-07-phase4-v1";

#[derive(Clone)]
struct AliasCandidate {
    field: &'static str,
    level: &'static str,
    priority: u8,
}

struct TargetConfidence {
    field: &'static str,
    score: u8,
    alias_level: &'static str,
    reasons: Vec<String>,
    rejection_reasons: Vec<String>,
    transformation: String,
    hard_datatype_mismatch: bool,
}

struct FieldMetadata {
    data_type: &'static str,
    max_length: Option<usize>,
    allowed_values: &'static [&'static str],
    reference_entity: Option<MigrationEntity>,
    default_behavior: &'static str,
    transformation_rule: &'static str,
    validation_rules: &'static [&'static str],
}

fn field_metadata(entity: MigrationEntity, column: &ColumnContract) -> FieldMetadata {
    let field = column.field;
    let reference_entity = match (entity, field) {
        (MigrationEntity::Inventory, "product")
        | (MigrationEntity::PurchaseBills, "product")
        | (MigrationEntity::StockMovements, "product") => Some(MigrationEntity::Products),
        (MigrationEntity::OpeningPayables, "supplier") => Some(MigrationEntity::Suppliers),
        (MigrationEntity::ClientMemberships, "client")
        | (MigrationEntity::Appointments, "client")
        | (MigrationEntity::Sales, "client")
        | (MigrationEntity::Invoices, "client")
        | (MigrationEntity::GiftCards, "client")
        | (MigrationEntity::Loyalty, "client")
        | (MigrationEntity::ClientNotes, "client") => Some(MigrationEntity::Clients),
        (MigrationEntity::ClientMemberships, "membership") => Some(MigrationEntity::Memberships),
        (MigrationEntity::ClientMemberships, "staff")
        | (MigrationEntity::Appointments, "staff")
        | (MigrationEntity::Sales, "staff")
        | (MigrationEntity::Loyalty, "staff")
        | (MigrationEntity::Payroll, "staff")
        | (MigrationEntity::Commissions, "staff") => Some(MigrationEntity::Staff),
        (MigrationEntity::Memberships, "services")
        | (MigrationEntity::Packages, "services")
        | (MigrationEntity::Appointments, "services") => Some(MigrationEntity::Services),
        (MigrationEntity::Invoices, "sale") => Some(MigrationEntity::Sales),
        (MigrationEntity::Payments, "invoice")
        | (MigrationEntity::Refunds, "invoice")
        | (MigrationEntity::Loyalty, "invoice")
        | (MigrationEntity::Commissions, "invoice") => Some(MigrationEntity::Invoices),
        (MigrationEntity::Files, "appointment") => Some(MigrationEntity::Appointments),
        _ => None,
    };

    let (allowed_values, default_behavior) = match (entity, field) {
        (_, "active") => (
            &["true", "false", "yes", "no", "1", "0", "active", "inactive"][..],
            "true_when_blank",
        ),
        (_, "batchTracked" | "showMobileApp" | "showOnlineBooking") => (
            &["true", "false", "yes", "no", "1", "0", "active", "inactive"][..],
            "false_when_blank",
        ),
        (MigrationEntity::Appointments, "status") => (
            &[
                "draft",
                "booked",
                "confirmed",
                "arrived",
                "waiting",
                "in-service",
                "completed",
                "billed",
                "paid",
                "cancelled",
                "no-show",
                "rescheduled",
            ][..],
            "booked_when_blank",
        ),
        (MigrationEntity::Sales, "lineType") => {
            (&["service", "product", "custom"][..], "custom_when_blank")
        }
        (MigrationEntity::Invoices, "status") => (&[][..], "open_when_blank"),
        (MigrationEntity::Refunds, "paymentMethod") => (
            &[
                "cash",
                "upi",
                "card",
                "wallet",
                "bank_transfer",
                "gift_card",
                "store_credit",
            ][..],
            "row_rejected_when_blank",
        ),
        (MigrationEntity::GiftCards, "status") => (
            &["active", "redeemed", "expired", "voided", "blocked"][..],
            "active_when_balance_positive_otherwise_redeemed",
        ),
        (MigrationEntity::Loyalty, "transactionType") => (
            &["earned", "redeemed", "reversed", "adjusted"][..],
            "row_rejected_when_blank",
        ),
        (MigrationEntity::Payroll, "status") => (
            &[
                "calculated",
                "reviewed",
                "finalized",
                "partially_paid",
                "paid",
            ][..],
            "calculated_when_blank",
        ),
        (MigrationEntity::OpeningPayables, "balanceSide") => {
            (&["debit", "credit"][..], "row_rejected_when_blank")
        }
        (MigrationEntity::OpeningPayables, "openingBalanceAccount") => (
            &["owner_equity", "retained_earnings"][..],
            "row_rejected_when_blank",
        ),
        (MigrationEntity::Files, "ownerType") => {
            (&["client", "staff"][..], "row_rejected_when_blank")
        }
        (MigrationEntity::Files, "fileKind") => (&["photo", "document"][..], "document_when_blank"),
        (MigrationEntity::Files, "photoType") => (
            &["before", "after", "other"][..],
            "empty_when_not_a_client_photo",
        ),
        _ if column.required => (&[][..], "row_rejected_when_blank"),
        _ => (&[][..], "null_or_entity_default_when_blank"),
    };

    let data_type = if matches!(field, "services") {
        "reference_list"
    } else if reference_entity.is_some() || matches!(field, "item" | "owner" | "saleLine") {
        "reference"
    } else if matches!(field, "services" | "categories") {
        "string_list"
    } else if matches!(field, "phone" | "mobilePhone") {
        "phone"
    } else if field == "gender" {
        "gender"
    } else if field == "email" {
        "email"
    } else if field == "contentBase64" {
        "base64"
    } else if field == "sha256" {
        "sha256"
    } else if matches!(
        field,
        "active" | "batchTracked" | "showMobileApp" | "showOnlineBooking"
    ) {
        "boolean"
    } else if matches!(
        (entity, field),
        (
            MigrationEntity::GiftCards | MigrationEntity::Loyalty,
            "expiresAt"
        )
    ) {
        "date"
    } else if field.ends_with("At") || matches!(field, "startAt" | "endAt" | "paidAt") {
        "datetime"
    } else if field.ends_with("Date")
        || matches!(
            field,
            "birthday" | "anniversary" | "periodStart" | "periodEnd" | "receivedDate"
        )
    {
        "date"
    } else if field.ends_with("Paise") {
        "money"
    } else if matches!(
        field,
        "points" | "balanceAfter" | "pointsRequired" | "splitBps"
    ) {
        "integer"
    } else if field.ends_with("Percent")
        || matches!(
            field,
            "quantity" | "quantityDelta" | "openingStock" | "reorderPoint"
        )
    {
        "decimal"
    } else if field.ends_with("Minutes") || field.ends_with("Days") || field.ends_with("Sessions") {
        "integer"
    } else {
        "string"
    };

    let transformation_rule = match data_type {
        "reference" => "trim_then_resolve_existing_or_prior_imported_reference",
        "reference_list" => "split_provider_list_then_resolve_each_reference",
        "phone" => "phone_e164",
        "gender" => "gender_canonical",
        "money" => "money_integer_paise",
        "email" => "trim_then_lowercase",
        "boolean" => "normalize_true_false_yes_no_1_0_active_inactive",
        "date" => "parse_supported_date_then_store_iso_date",
        "datetime" => "parse_rfc3339_or_date_then_store_utc",
        "integer" => "trim_then_parse_base10_integer",
        "decimal" => "trim_then_parse_decimal",
        "string_list" => "split_provider_list_then_resolve_each_value",
        "base64" => "strict_base64_decode",
        "sha256" => "trim_then_lowercase_hex",
        _ if !allowed_values.is_empty() => "trim_then_lowercase",
        _ => "trim",
    };

    let validation_rules = match (entity, field) {
        (MigrationEntity::Files, "fileName") => &["safe_file_name", "length_1_to_255"][..],
        (MigrationEntity::Files, "contentBase64") => &["valid_base64", "decoded_size_1_to_5mb"][..],
        (MigrationEntity::Files, "sha256") => &["sha256_matches_decoded_content"][..],
        (MigrationEntity::Files, "owner") => {
            &["owner_type_client_or_staff", "dependency_must_exist"][..]
        }
        (MigrationEntity::Files, "contentType") => &["client_photo_must_be_jpeg_png_or_webp"][..],
        (_, _) if reference_entity.is_some() => &["dependency_must_exist"][..],
        (_, _) if !allowed_values.is_empty() => &["value_must_be_in_allowed_values"][..],
        (_, _) if column.required => &["required_non_blank"][..],
        _ => &["optional"][..],
    };

    FieldMetadata {
        data_type,
        max_length: match (entity, field) {
            (MigrationEntity::Files, "fileName") => Some(255),
            (MigrationEntity::Files, "sha256") => Some(64),
            (_, "email") => Some(320),
            (_, "phone" | "mobilePhone") => Some(32),
            (
                _,
                "sku" | "barcode" | "invoiceNumber" | "reference" | "employeeCode" | "code"
                | "oldExternalId",
            ) => Some(255),
            _ => None,
        },
        allowed_values,
        reference_entity,
        default_behavior,
        transformation_rule,
        validation_rules,
    }
}

fn global_aliases_for(data_type: &str) -> &'static [&'static str] {
    match data_type {
        "phone" => GLOBAL_PHONE_ALIASES,
        "email" => GLOBAL_EMAIL_ALIASES,
        _ => &[],
    }
}

fn provider_aliases_for_field(
    entity: MigrationEntity,
    field: &str,
) -> BTreeMap<String, Vec<String>> {
    let mut aliases = BTreeMap::<String, Vec<String>>::new();
    for rule in PROVIDER_ALIAS_RULES
        .iter()
        .filter(|rule| rule.entity == entity && rule.target == field)
    {
        aliases
            .entry(rule.provider.as_str().to_string())
            .or_default()
            .push(rule.alias.to_string());
    }
    aliases
}

fn push_candidate(candidates: &mut Vec<AliasCandidate>, candidate: AliasCandidate) {
    if let Some(existing) = candidates
        .iter_mut()
        .find(|existing| existing.field == candidate.field)
    {
        if candidate.priority > existing.priority {
            *existing = candidate;
        }
    } else {
        candidates.push(candidate);
    }
}

fn fixed_alias_candidates(
    entity: MigrationEntity,
    provider: MigrationProvider,
    key: &str,
) -> Vec<AliasCandidate> {
    let mut candidates = Vec::new();
    for column in contracts(entity) {
        if clean_key(column.field) == key {
            push_candidate(
                &mut candidates,
                AliasCandidate {
                    field: column.field,
                    level: "exact_crm_field",
                    priority: 40,
                },
            );
        }
    }
    for rule in PROVIDER_ALIAS_RULES.iter().filter(|rule| {
        rule.entity == entity && rule.provider == provider && clean_key(rule.alias) == key
    }) {
        if let Some(column) = contracts(entity)
            .iter()
            .find(|column| column.field == rule.target)
        {
            push_candidate(
                &mut candidates,
                AliasCandidate {
                    field: column.field,
                    level: "provider",
                    priority: 30,
                },
            );
        }
    }
    for column in contracts(entity) {
        if column.aliases.iter().any(|alias| clean_key(alias) == key) {
            push_candidate(
                &mut candidates,
                AliasCandidate {
                    field: column.field,
                    level: "entity",
                    priority: 20,
                },
            );
        }
        let metadata = field_metadata(entity, column);
        if global_aliases_for(metadata.data_type)
            .iter()
            .any(|alias| clean_key(alias) == key)
        {
            push_candidate(
                &mut candidates,
                AliasCandidate {
                    field: column.field,
                    level: "global",
                    priority: 10,
                },
            );
        }
    }
    candidates
}

pub(crate) fn validate_tenant_alias(
    entity: MigrationEntity,
    alias: &str,
    target_field: &str,
) -> Result<String, AppError> {
    let alias = alias.trim();
    if alias.is_empty() || alias.chars().count() > 200 {
        return Err(AppError::validation(
            "alias must contain 1 to 200 characters",
        ));
    }
    let target = contracts(entity)
        .iter()
        .find(|column| clean_key(column.field) == clean_key(target_field))
        .ok_or_else(|| AppError::validation("alias target is not in the CRM schema registry"))?;
    if let Some(exact) = contracts(entity)
        .iter()
        .find(|column| clean_key(column.field) == clean_key(alias))
    {
        if exact.field != target.field {
            return Err(AppError::validation(
                "an exact CRM field name cannot be approved for another target",
            ));
        }
    }
    Ok(target.field.to_string())
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
            "guest code",
            "guest id",
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
            "guest name",
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
        aliases: &[
            "phone",
            "mobile",
            "mobile no",
            "cust mob",
            "mobile number",
            "contact number",
            "customer contact",
            "guest mobile",
            "guest phone",
        ],
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
        aliases: &[
            "mobile phone",
            "mobile",
            "mobile no",
            "staff mobile",
            "phone",
            "contact number",
        ],
    },
    ColumnContract {
        field: "jobTitle",
        required: false,
        aliases: &["job title", "role", "designation", "title"],
    },
    ColumnContract {
        field: "gender",
        required: false,
        aliases: &["gender", "sex"],
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
        ["duration", "duration minutes", "service time", "timing"]
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
    column!("sku", true, ["sku", "sku no", "item code", "product code"]),
    column!("name", true, ["name", "product name", "item name"]),
    column!("category", false, ["category", "product category"]),
    column!(
        "unit",
        false,
        ["unit", "stock unit", "measurment", "measurement"]
    ),
    column!(
        "reorderPoint",
        false,
        ["reorder point", "low stock threshold"]
    ),
    column!(
        "unitCostPaise",
        false,
        ["unit cost paise", "cost paise", "unit cost", "cost price"]
    ),
    column!("hsnCode", false, ["hsn", "hsn code"]),
    column!("gstPercent", false, ["gst", "gst percent", "gst rate"]),
    column!("barcode", false, ["barcode", "qr code"]),
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
        "location",
        true,
        ["location", "store", "warehouse", "inventory location"]
    ),
    column!(
        "stockUnit",
        false,
        ["stock unit", "base unit", "inventory unit", "unit"]
    ),
    column!(
        "unitConversionApproved",
        false,
        ["unit conversion approved", "conversion approved"]
    ),
    column!(
        "openingStock",
        true,
        [
            "opening stock",
            "stock",
            "current stock",
            "quantity",
            "opening quantity"
        ]
    ),
    column!(
        "unitCostPaise",
        false,
        [
            "source unit cost paise",
            "source cost paise",
            "unit cost paise"
        ]
    ),
    column!(
        "approvedUnitCostPaise",
        true,
        ["approved unit cost paise", "approved stock unit cost paise"]
    ),
    column!("costMethod", true, ["cost method", "valuation cost method"]),
    column!(
        "valuationPaise",
        false,
        ["valuation paise", "stock value paise", "inventory value"]
    ),
    column!(
        "batchesJson",
        false,
        ["batches json", "batch breakdown", "batch details"]
    ),
    column!(
        "unbatchedQuantity",
        false,
        ["unbatched quantity", "without batch quantity"]
    ),
    column!(
        "approvedUnbatched",
        false,
        ["approved unbatched", "allow unbatched"]
    ),
    column!(
        "negativeStockApproved",
        false,
        ["negative stock approved", "allow negative stock"]
    ),
    column!(
        "locationApproved",
        false,
        ["location approved", "approve new location"]
    ),
    column!(
        "sellableQuantity",
        false,
        ["sellable quantity", "saleable quantity"]
    ),
    column!(
        "backbarQuantity",
        false,
        ["backbar quantity", "back bar quantity"]
    ),
    column!("damagedQuantity", false, ["damaged quantity"]),
    column!("expiredQuantity", false, ["expired quantity"]),
    column!("quarantinedQuantity", false, ["quarantined quantity"]),
    column!("inTransitQuantity", false, ["in transit quantity"]),
    column!(
        "countedBy",
        true,
        ["counted by", "counter user id", "counted by user id"]
    ),
    column!("notes", false, ["notes", "count notes", "remarks"]),
    column!(
        "snapshotAt",
        true,
        ["snapshot at", "snapshot date", "stock date", "as of"]
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
    column!("pricePaise", false, ["price paise", "price", "price paid"]),
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

const CLIENT_MEMBERSHIP_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "membership id"]
    ),
    column!(
        "client",
        true,
        ["client", "client mobile", "customer mobile", "mobile"]
    ),
    column!(
        "clientName",
        false,
        ["client name", "customer name", "name"]
    ),
    column!(
        "membership",
        true,
        ["membership", "membership name", "mship type", "plan name"]
    ),
    column!(
        "pricePaidPaise",
        false,
        ["price paid paise", "price paid", "amount paid"]
    ),
    column!(
        "startDate",
        true,
        ["start date", "sell date", "start date / sell date"]
    ),
    column!("endDate", false, ["end date", "expiry date", "expires at"]),
    column!(
        "balancePaise",
        false,
        ["balance paise", "balance", "balance if any"]
    ),
    column!("staff", false, ["staff", "staff name", "employee"]),
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

const APPOINTMENT_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "appointment id", "booking id"]
    ),
    column!(
        "client",
        true,
        [
            "client",
            "client id",
            "customer id",
            "guest code",
            "guest id",
            "guest mobile"
        ]
    ),
    column!(
        "staff",
        true,
        [
            "staff",
            "staff id",
            "employee id",
            "therapist code",
            "therapist name",
            "stylist"
        ]
    ),
    column!("services", true, ["services", "service ids", "service"]),
    column!(
        "startAt",
        true,
        [
            "start at",
            "start",
            "appointment date time",
            "appointment time",
            "booking time"
        ]
    ),
    column!("endAt", true, ["end at", "end", "end time"]),
    column!("status", false, ["status"]),
    column!("notes", false, ["notes", "remarks"]),
];

const SALE_COLUMNS: &[ColumnContract] = &[
    column!("oldExternalId", true, ["external id", "old id", "sale id"]),
    column!(
        "client",
        true,
        [
            "client",
            "client id",
            "customer id",
            "customer mobile",
            "mobile",
            "guest code",
            "guest mobile"
        ]
    ),
    column!(
        "staff",
        false,
        ["staff", "staff id", "employee id", "stylist name"]
    ),
    column!(
        "invoiceNumber",
        true,
        [
            "invoice number",
            "invoice no",
            "bill no",
            "receipt no",
            "receipt number"
        ]
    ),
    column!("lineType", false, ["line type", "type"]),
    column!("item", false, ["item", "item id", "product", "service"]),
    column!(
        "itemName",
        true,
        [
            "item name",
            "description",
            "service / product name",
            "service product name"
        ]
    ),
    column!("quantity", true, ["quantity", "qty"]),
    column!("unitPricePaise", true, ["unit price paise", "price paise"]),
    column!("subtotalPaise", true, ["subtotal paise"]),
    column!("discountPaise", false, ["discount paise"]),
    column!("taxPaise", false, ["tax paise", "gst paise"]),
    column!("cgstPaise", false, ["cgst paise"]),
    column!("sgstPaise", false, ["sgst paise"]),
    column!("igstPaise", false, ["igst paise"]),
    column!(
        "totalPaise",
        true,
        ["total paise", "amount paise", "amount"]
    ),
    column!("status", false, ["status"]),
    column!("businessDate", true, ["business date", "sale date", "date"]),
];

const INVOICE_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "invoice id"]
    ),
    column!("sale", false, ["sale", "sale id"]),
    column!(
        "client",
        true,
        [
            "client",
            "client id",
            "customer id",
            "customer mobile",
            "mobile",
            "guest code",
            "guest mobile"
        ]
    ),
    column!(
        "invoiceNumber",
        true,
        [
            "invoice number",
            "invoice no",
            "bill no",
            "receipt no",
            "receipt number"
        ]
    ),
    column!("itemName", false, ["item name", "description"]),
    column!(
        "subtotalPaise",
        true,
        ["subtotal paise", "subtotal", "net", "price"]
    ),
    column!("discountPaise", false, ["discount paise", "discount"]),
    column!("taxPaise", false, ["tax paise", "gst paise", "tax"]),
    column!("cgstPaise", false, ["cgst paise"]),
    column!("sgstPaise", false, ["sgst paise"]),
    column!("igstPaise", false, ["igst paise"]),
    column!(
        "totalPaise",
        true,
        [
            "total paise",
            "amount paise",
            "total sale",
            "invoice total",
            "total"
        ]
    ),
    column!("status", false, ["status"]),
    column!(
        "businessDate",
        true,
        ["business date", "invoice date", "date"]
    ),
];

const PAYMENT_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "payment id"]
    ),
    column!(
        "invoice",
        true,
        [
            "invoice",
            "invoice id",
            "invoice number",
            "sale id",
            "receipt no",
            "receipt number"
        ]
    ),
    column!("method", true, ["method", "payment method", "mode"]),
    column!(
        "amountPaise",
        true,
        ["amount paise", "payment paise", "amount"]
    ),
    column!("reference", false, ["reference", "transaction id"]),
    column!("paidAt", true, ["paid at", "payment date time"]),
];

const EXPENSE_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "expense id"]
    ),
    column!("category", true, ["category", "expense category"]),
    column!("amountPaise", true, ["amount paise", "expense paise"]),
    column!("gstPaise", false, ["gst paise", "tax paise"]),
    column!("paymentMethod", true, ["payment method", "mode"]),
    column!("businessDate", true, ["business date", "expense date"]),
    column!("vendor", false, ["vendor", "supplier"]),
    column!("reference", false, ["reference", "bill reference"]),
    column!("notes", false, ["notes", "remarks"]),
];

const PURCHASE_BILL_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "purchase bill id"]
    ),
    column!("supplierName", true, ["supplier name", "vendor name"]),
    column!("supplierGstin", false, ["supplier gstin", "gstin"]),
    column!(
        "supplierExternalId",
        false,
        ["supplier external id", "vendor id"]
    ),
    column!("supplierCode", false, ["supplier code", "vendor code"]),
    column!("supplierPhone", false, ["supplier phone", "vendor phone"]),
    column!("supplierEmail", false, ["supplier email", "vendor email"]),
    column!(
        "invoiceNumber",
        true,
        ["invoice number", "invoice no", "bill no"]
    ),
    column!("invoiceDate", true, ["invoice date", "bill date"]),
    column!("receivedDate", false, ["received date", "grn date"]),
    column!("currency", false, ["currency", "currency code"]),
    column!("documentType", false, ["document type", "bill type"]),
    column!(
        "sourceStatus",
        false,
        ["source status", "bill status", "status"]
    ),
    column!("paymentStatus", false, ["payment status", "paid status"]),
    column!("product", false, ["product", "product id"]),
    column!("productName", false, ["product name", "item name"]),
    column!("sku", false, ["sku", "product sku"]),
    column!("barcode", false, ["barcode", "ean", "upc"]),
    column!("sourceProductId", false, ["source product id", "item id"]),
    column!("brand", false, ["brand", "product brand"]),
    column!("size", false, ["size", "product size"]),
    column!("shade", false, ["shade", "shade number", "shade no"]),
    column!("color", false, ["color", "colour"]),
    column!(
        "vendorCatalogCode",
        false,
        ["vendor catalog code", "supplier item code", "vendor sku"]
    ),
    column!(
        "sourceLineId",
        false,
        ["source line id", "bill line id", "line id"]
    ),
    column!("packageUnit", false, ["package unit", "purchase unit"]),
    column!("stockUnit", false, ["stock unit", "base unit"]),
    column!("unitsPerPackage", false, ["units per package", "pack size"]),
    column!("quantity", true, ["quantity", "qty"]),
    column!(
        "acceptedQuantity",
        false,
        ["accepted quantity", "accepted qty"]
    ),
    column!(
        "damagedQuantity",
        false,
        ["damaged quantity", "damaged qty"]
    ),
    column!(
        "rejectedQuantity",
        false,
        ["rejected quantity", "rejected qty"]
    ),
    column!("unitCostPaise", true, ["unit cost paise", "cost paise"]),
    column!("taxablePaise", true, ["taxable paise"]),
    column!("cgstPaise", false, ["cgst paise"]),
    column!("sgstPaise", false, ["sgst paise"]),
    column!("igstPaise", false, ["igst paise"]),
    column!("totalPaise", true, ["total paise"]),
    column!(
        "billTotalPaise",
        false,
        ["bill total paise", "invoice total paise"]
    ),
    column!("gstPercent", false, ["gst percent", "gst rate"]),
    column!(
        "discountPaise",
        false,
        ["discount paise", "bill discount paise"]
    ),
    column!("shippingPaise", false, ["shipping paise", "freight paise"]),
    column!(
        "handlingPaise",
        false,
        ["handling paise", "handling charge paise"]
    ),
    column!(
        "batchNumber",
        false,
        ["batch number", "batch no", "lot number"]
    ),
    column!("expiryDate", false, ["expiry date", "expiration date"]),
    column!(
        "billFileName",
        false,
        ["bill file name", "bill image", "attachment"]
    ),
];

const REFUND_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "refund id"]
    ),
    column!("invoice", true, ["invoice", "invoice id", "invoice number"]),
    column!(
        "amount",
        true,
        ["amount paise", "refund amount paise", "amount"]
    ),
    column!(
        "paymentMethod",
        true,
        ["payment method", "refund method", "mode"]
    ),
    column!("reason", true, ["reason", "refund reason"]),
    column!("notes", false, ["notes", "remarks"]),
    column!(
        "occurredAt",
        false,
        ["occurred at", "refund date", "created at"]
    ),
];

const GIFT_CARD_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "gift card id"]
    ),
    column!("code", true, ["code", "gift card code", "voucher code"]),
    column!(
        "client",
        false,
        ["client", "client id", "customer", "guest id", "mobile"]
    ),
    column!(
        "initialAmountPaise",
        true,
        [
            "initial amount paise",
            "initial value paise",
            "actual amount",
            "sold price"
        ]
    ),
    column!(
        "balancePaise",
        true,
        ["balance paise", "current balance", "balance"]
    ),
    column!("status", false, ["status"]),
    column!(
        "expiresAt",
        false,
        ["expires at", "expiry date", "end date"]
    ),
    column!(
        "occurredAt",
        false,
        ["occurred at", "sale date", "created at"]
    ),
];

const LOYALTY_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "loyalty id", "transaction id"]
    ),
    column!(
        "client",
        true,
        ["client", "client id", "customer", "guest id", "mobile"]
    ),
    column!("transactionType", true, ["transaction type", "type"]),
    column!("points", true, ["points", "points delta"]),
    column!(
        "balanceAfter",
        true,
        ["balance after", "points balance", "balance"]
    ),
    column!(
        "invoice",
        false,
        ["invoice", "invoice id", "invoice number"]
    ),
    column!("staff", false, ["staff", "staff id", "employee"]),
    column!("expiresAt", false, ["expires at", "expiry date"]),
    column!("note", false, ["note", "notes", "description"]),
    column!(
        "occurredAt",
        false,
        ["occurred at", "transaction date", "created at"]
    ),
];

const PAYROLL_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "payroll id"]
    ),
    column!(
        "staff",
        true,
        ["staff", "staff id", "employee", "employee code"]
    ),
    column!("periodStart", true, ["period start", "start date"]),
    column!("periodEnd", true, ["period end", "end date"]),
    column!("status", false, ["status"]),
    column!(
        "earnedSalaryPaise",
        false,
        ["earned salary paise", "salary paise", "basic salary paise"]
    ),
    column!("overtimePaise", false, ["overtime paise"]),
    column!("commissionPaise", false, ["commission paise"]),
    column!("adjustmentPaise", false, ["adjustment paise"]),
    column!("penaltyPaise", false, ["penalty paise"]),
    column!("grossPaise", true, ["gross paise", "gross"]),
    column!("deductionsPaise", true, ["deductions paise", "deductions"]),
    column!("netPaise", true, ["net paise", "net"]),
    column!("notes", false, ["notes", "remarks"]),
];

const COMMISSION_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "commission id"]
    ),
    column!("invoice", true, ["invoice", "invoice id", "invoice number"]),
    column!(
        "saleLine",
        true,
        ["sale line", "sale line id", "line id", "item"]
    ),
    column!("staff", true, ["staff", "staff id", "employee"]),
    column!("splitBps", false, ["split bps", "split percent"]),
    column!("basePaise", true, ["base paise", "commission base paise"]),
    column!(
        "ratePercent",
        true,
        ["rate percent", "commission percent", "rate"]
    ),
    column!(
        "commissionPaise",
        true,
        ["commission paise", "commission amount paise"]
    ),
];

const CLIENT_NOTE_COLUMNS: &[ColumnContract] = &[
    column!("oldExternalId", true, ["external id", "old id", "note id"]),
    column!(
        "client",
        true,
        ["client", "client id", "customer", "guest id", "mobile"]
    ),
    column!("noteType", false, ["note type", "type"]),
    column!("note", true, ["note", "notes", "remarks", "comments"]),
    column!("occurredAt", false, ["occurred at", "created at", "date"]),
];

const FILE_COLUMNS: &[ColumnContract] = &[
    column!("oldExternalId", true, ["external id", "old id", "file id"]),
    column!("ownerType", true, ["owner type", "entity type"]),
    column!("owner", true, ["owner", "owner id", "client", "staff"]),
    column!("fileName", true, ["file name", "filename"]),
    column!("contentType", true, ["content type", "mime type"]),
    column!(
        "contentBase64",
        true,
        ["content base64", "base64", "file content"]
    ),
    column!("sha256", true, ["sha256", "sha 256", "checksum"]),
    column!("fileKind", false, ["file kind", "kind"]),
    column!("photoType", false, ["photo type"]),
    column!("appointment", false, ["appointment", "appointment id"]),
    column!("caption", false, ["caption", "description"]),
];

const STOCK_MOVEMENT_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "movement id"]
    ),
    column!("product", true, ["product", "product id", "sku", "item"]),
    column!(
        "quantityDelta",
        true,
        ["quantity delta", "stock delta", "quantity"]
    ),
    column!("unitCostPaise", false, ["unit cost paise", "cost paise"]),
    column!("reason", true, ["reason", "adjustment reason", "notes"]),
    column!(
        "occurredAt",
        false,
        ["occurred at", "movement date", "created at"]
    ),
];

const OPENING_PAYABLE_COLUMNS: &[ColumnContract] = &[
    column!(
        "oldExternalId",
        true,
        ["external id", "old id", "opening payable id"]
    ),
    column!(
        "supplier",
        true,
        ["supplier", "supplier id", "vendor", "vendor id"]
    ),
    column!(
        "outstandingAmountPaise",
        true,
        ["outstanding amount paise", "balance paise", "amount paise"]
    ),
    column!(
        "balanceSide",
        true,
        ["balance side", "debit credit", "dr cr"]
    ),
    column!("currency", true, ["currency", "currency code"]),
    column!("dueDate", false, ["due date"]),
    column!(
        "sourceOutstandingTotalPaise",
        true,
        [
            "source outstanding total paise",
            "opening payable total paise"
        ]
    ),
    column!(
        "openingBalanceAccount",
        true,
        ["opening balance account", "offset account"]
    ),
    column!(
        "historicalBillAllocationsJson",
        false,
        ["historical bill allocations", "bill allocations json"]
    ),
    column!(
        "unallocatedApproved",
        false,
        ["unallocated approved", "approve unallocated balance"]
    ),
    column!("gstPaise", false, ["gst paise", "tax paise"]),
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
        MigrationEntity::ClientMemberships,
        MigrationEntity::Packages,
        MigrationEntity::Appointments,
        MigrationEntity::Sales,
        MigrationEntity::Invoices,
        MigrationEntity::Payments,
        MigrationEntity::Expenses,
        MigrationEntity::PurchaseBills,
        MigrationEntity::OpeningPayables,
        MigrationEntity::Refunds,
        MigrationEntity::GiftCards,
        MigrationEntity::Loyalty,
        MigrationEntity::Payroll,
        MigrationEntity::Commissions,
        MigrationEntity::ClientNotes,
        MigrationEntity::Files,
        MigrationEntity::StockMovements,
    ]
    .into_iter()
    .map(|entity| {
        let columns = contracts(entity)
            .iter()
            .map(|column| {
                let metadata = field_metadata(entity, column);
                MigrationTemplateColumn {
                    field: column.field.to_string(),
                    required: column.required,
                    aliases: column
                        .aliases
                        .iter()
                        .map(|alias| (*alias).to_string())
                        .collect(),
                    global_aliases: global_aliases_for(metadata.data_type)
                        .iter()
                        .map(|alias| (*alias).to_string())
                        .collect(),
                    provider_aliases: provider_aliases_for_field(entity, column.field),
                    data_type: metadata.data_type.to_string(),
                    max_length: metadata.max_length,
                    allowed_values: metadata
                        .allowed_values
                        .iter()
                        .map(|value| (*value).to_string())
                        .collect(),
                    reference_entity: metadata.reference_entity,
                    default_behavior: metadata.default_behavior.to_string(),
                    transformation_rule: metadata.transformation_rule.to_string(),
                    validation_rules: metadata
                        .validation_rules
                        .iter()
                        .map(|rule| (*rule).to_string())
                        .collect(),
                    permission: "data_migration.manage".to_string(),
                }
            })
            .collect();
        MigrationTemplate {
            contract_version: MIGRATION_CONTRACT_VERSION.to_string(),
            entity,
            columns,
            duplicate_decisions: vec![
                MigrationDuplicateDecision::Merge,
                MigrationDuplicateDecision::Keep,
                MigrationDuplicateDecision::Link,
            ],
        }
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
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    if mapping.is_empty()
        || mapping.iter().any(|(source, target)| {
            let source_key = clean_key(source);
            source_key.is_empty()
                || !sources.insert(source_key)
                || (target != "__ignore"
                    && (!fields.contains(&clean_key(target)) || !targets.insert(clean_key(target))))
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
    source_provider: MigrationProvider,
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
        source_provider,
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
    source_provider: MigrationProvider,
    table: &[Vec<String>],
    source_row_offset: i32,
    provided_mapping: &BTreeMap<String, String>,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
) -> Result<PreparedMigration, AppError> {
    prepare_table_with_version(
        db,
        tenant,
        branch,
        entity,
        source_provider,
        table,
        source_row_offset,
        provided_mapping,
        duplicate_decisions,
        MIGRATION_TRANSFORMER_VERSION,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn prepare_table_with_version(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    table: &[Vec<String>],
    source_row_offset: i32,
    provided_mapping: &BTreeMap<String, String>,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
    transformation_version: &str,
) -> Result<PreparedMigration, AppError> {
    let mut financial_state = HashMap::new();
    prepare_table_with_version_and_state(
        db,
        tenant,
        branch,
        entity,
        source_provider,
        table,
        source_row_offset,
        provided_mapping,
        duplicate_decisions,
        transformation_version,
        None,
        &mut financial_state,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn prepare_table_with_version_and_state(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    table: &[Vec<String>],
    source_row_offset: i32,
    provided_mapping: &BTreeMap<String, String>,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
    transformation_version: &str,
    projection_job_id: Option<&str>,
    financial_state: &mut HashMap<String, i64>,
) -> Result<PreparedMigration, AppError> {
    if transformation_version != MIGRATION_TRANSFORMER_VERSION {
        return Err(AppError::validation(format!(
            "unsupported migration transformer version: {transformation_version}"
        )));
    }
    if table.len() < 2 || table.len() > 5001 || source_row_offset < 0 {
        return Err(AppError::validation(
            "source chunk must contain 1 to 5000 data rows",
        ));
    }
    let original_table = table;
    let normalized = normalize_provider_table(entity, source_provider, table, source_row_offset);
    let table = normalized.as_slice();
    let (mapping, field_indexes, unmatched_columns) =
        resolve_mapping(entity, source_provider, &table[0], provided_mapping)?;
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
    let mut seen_external_ids = HashSet::new();
    let mut summary = MigrationAnalysisSummary::default();

    for (index, engine_input_row) in table.iter().enumerate().skip(1) {
        if engine_input_row.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        summary.source_rows += 1;
        let line = header_index(&table[0], &["__sourceRowNumber"])
            .and_then(|column| engine_input_row.get(column))
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(source_row_offset + (index + 1) as i32);
        let original_row = (normalized.len() == original_table.len())
            .then(|| original_table.get(index))
            .flatten();
        let transformed = transform_mapped_row(
            entity,
            source_provider,
            &table[0],
            engine_input_row,
            &field_indexes,
            original_table.first().map(Vec::as_slice),
            original_row.map(Vec::as_slice),
        );
        let source_values = if let Some(original_row) = original_row {
            source_value_evidence(&original_table[0], original_row)
        } else {
            source_value_evidence(&table[0], engine_input_row)
        };
        let source_row = transformed.row;
        let source_row = source_row.as_slice();
        let external_id = mapped_cell(source_row, &field_indexes, "oldExternalId");
        let mut row_errors = transformed.errors;
        let mut row_warnings = transformed.warnings;
        if entity != MigrationEntity::PurchaseBills
            && !external_id.is_empty()
            && !seen_external_ids.insert(external_id.trim().to_ascii_lowercase())
        {
            push_issue(
                &mut row_errors,
                "DUPLICATE_SOURCE_EXTERNAL_ID",
                "oldExternalId appears more than once in the source",
            );
        }
        let transformation_fields = transformed.fields;
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
                        &email,
                        &external_id,
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
                if field_indexes.contains_key("gender") {
                    payload.insert(
                        "gender".into(),
                        json!(mapped_cell(source_row, &field_indexes, "gender")),
                    );
                }
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
                let barcode = mapped_cell(source_row, &field_indexes, "barcode");
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
                    if let Some((target_id, _)) = migration_repository::find_product_duplicate(
                        db, tenant, branch, &sku, &barcode,
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
                    ("barcode".into(), json!(barcode)),
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
                    ("code".into(), json!(code)),
                    ("name".into(), json!(name)),
                    (
                        "gstin".into(),
                        json!(
                            mapped_cell(source_row, &field_indexes, "gstin").to_ascii_uppercase()
                        ),
                    ),
                    (
                        "contact_name".into(),
                        json!(mapped_cell(source_row, &field_indexes, "contactName")),
                    ),
                    (
                        "phone".into(),
                        json!(mapped_cell(source_row, &field_indexes, "phone")),
                    ),
                    ("email".into(), json!(email)),
                    (
                        "address".into(),
                        json!(mapped_cell(source_row, &field_indexes, "address")),
                    ),
                    (
                        "payment_terms_days".into(),
                        json!(parse_i32_field_default(
                            &mapped_cell(source_row, &field_indexes, "paymentTermsDays"),
                            "paymentTermsDays",
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
            MigrationEntity::Inventory => {
                let product = mapped_cell(source_row, &field_indexes, "product");
                let location =
                    mapped_cell(source_row, &field_indexes, "location").to_ascii_uppercase();
                if product.is_empty() {
                    push_issue(&mut row_errors, "REQUIRED_FIELD", "product is required");
                }
                if location.is_empty() {
                    push_issue(&mut row_errors, "REQUIRED_FIELD", "location is required");
                }
                let location_approved = parse_boolean_default(
                    &mapped_cell(source_row, &field_indexes, "locationApproved"),
                    false,
                    "locationApproved",
                    &mut row_errors,
                );
                if !location.is_empty()
                    && !migration_repository::opening_stock_location_exists(
                        db, tenant, branch, &location,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to validate inventory location"))?
                {
                    if location_approved {
                        push_issue(
                            &mut row_warnings,
                            "NEW_LOCATION_APPROVAL_USED",
                            "new inventory location requires explicit governance approval",
                        );
                    } else {
                        push_issue(
                            &mut row_errors,
                            "UNKNOWN_INVENTORY_LOCATION",
                            "location must already exist or locationApproved must be true",
                        );
                    }
                }
                let resolved = if row_errors.is_empty() {
                    migration_repository::resolve_inventory_snapshot_product(
                        db, tenant, branch, &product,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to resolve inventory product"))?
                } else {
                    None
                };
                let (
                    item_id,
                    _current_cost,
                    base_unit,
                    package_unit,
                    units_per_package,
                    batch_tracked,
                ) = match resolved {
                    Some(value) => value,
                    None => {
                        if row_errors.is_empty() {
                            push_issue(
                                &mut row_errors,
                                "SNAPSHOT_PRODUCT_MAPPING_REQUIRED",
                                "snapshot product must map to an existing CRM product",
                            );
                        }
                        (String::new(), 0, String::new(), String::new(), 1, false)
                    }
                };
                let requested_unit = mapped_cell(source_row, &field_indexes, "stockUnit");
                let stock_unit = if requested_unit.is_empty() {
                    base_unit.clone()
                } else {
                    requested_unit
                };
                let multiplier = if stock_unit.eq_ignore_ascii_case(&base_unit) {
                    1
                } else if stock_unit.eq_ignore_ascii_case(&package_unit) {
                    units_per_package
                } else {
                    push_issue(
                        &mut row_errors,
                        "STOCK_UNIT_CONVERSION_REQUIRED",
                        "stock unit must match the product base unit or approved package unit",
                    );
                    1
                };
                let unit_conversion_approved = parse_boolean_default(
                    &mapped_cell(source_row, &field_indexes, "unitConversionApproved"),
                    false,
                    "unitConversionApproved",
                    &mut row_errors,
                );
                if multiplier != 1 && !unit_conversion_approved {
                    push_issue(
                        &mut row_errors,
                        "UNIT_CONVERSION_APPROVAL_REQUIRED",
                        "package-to-base conversion requires unitConversionApproved",
                    );
                }
                let source_quantity = mapped_cell(source_row, &field_indexes, "openingStock");
                let opening_stock = parse_fixed_stock_quantity(
                    &source_quantity,
                    multiplier,
                    "openingStock",
                    true,
                    &mut row_errors,
                );
                let classification_fields = [
                    ("sellableQuantity", "sellable"),
                    ("backbarQuantity", "backbar"),
                    ("damagedQuantity", "damaged"),
                    ("expiredQuantity", "expired"),
                    ("quarantinedQuantity", "quarantined"),
                    ("inTransitQuantity", "inTransit"),
                ];
                let classifications_supplied = classification_fields.iter().any(|(field, _)| {
                    !mapped_cell(source_row, &field_indexes, field)
                        .trim()
                        .is_empty()
                });
                let mut classifications = serde_json::Map::new();
                for (field, key) in classification_fields {
                    let quantity = parse_fixed_stock_quantity(
                        &mapped_cell(source_row, &field_indexes, field),
                        multiplier,
                        field,
                        false,
                        &mut row_errors,
                    );
                    if quantity < 0 {
                        push_issue(
                            &mut row_errors,
                            "NEGATIVE_CLASSIFICATION_QUANTITY",
                            "stock classification quantities cannot be negative",
                        );
                    }
                    classifications.insert(key.into(), json!(quantity));
                }
                if classifications_supplied {
                    let available = available_classification_total(&classifications);
                    if available != Some(i64::from(opening_stock)) {
                        push_issue(
                            &mut row_errors,
                            "STOCK_CLASSIFICATION_TOTAL_MISMATCH",
                            "openingStock must equal sellableQuantity plus backbarQuantity; damaged, expired, quarantined and in-transit quantities are excluded",
                        );
                    }
                } else {
                    classifications.insert("sellable".into(), json!(opening_stock));
                }
                let unbatched_quantity = parse_fixed_stock_quantity(
                    &mapped_cell(source_row, &field_indexes, "unbatchedQuantity"),
                    multiplier,
                    "unbatchedQuantity",
                    false,
                    &mut row_errors,
                );
                let approved_unbatched = parse_boolean_default(
                    &mapped_cell(source_row, &field_indexes, "approvedUnbatched"),
                    false,
                    "approvedUnbatched",
                    &mut row_errors,
                );
                let negative_stock_approved = parse_boolean_default(
                    &mapped_cell(source_row, &field_indexes, "negativeStockApproved"),
                    false,
                    "negativeStockApproved",
                    &mut row_errors,
                );
                let (batches_json, batch_quantity) = parse_snapshot_batches(
                    &mapped_cell(source_row, &field_indexes, "batchesJson"),
                    multiplier,
                    &mut row_errors,
                );
                if batch_tracked && batches_json.as_array().is_none_or(Vec::is_empty) {
                    push_issue(
                        &mut row_errors,
                        "BATCH_TOTALS_REQUIRED",
                        "batch-tracked product requires batchesJson",
                    );
                }
                if !batch_tracked && batches_json.as_array().is_some_and(|rows| !rows.is_empty()) {
                    push_issue(
                        &mut row_errors,
                        "BATCH_NOT_ALLOWED",
                        "non-batch product cannot contain batch quantities",
                    );
                }
                if batch_tracked && unbatched_quantity != 0 && !approved_unbatched {
                    push_issue(
                        &mut row_errors,
                        "UNBATCHED_STOCK_APPROVAL_REQUIRED",
                        "unbatched quantity requires explicit approval",
                    );
                }
                if batch_quantity.checked_add(unbatched_quantity) != Some(opening_stock)
                    && batch_tracked
                {
                    push_issue(
                        &mut row_errors,
                        "BATCH_TOTAL_MISMATCH",
                        "total stock must equal batch stock plus approved unbatched stock",
                    );
                }
                if opening_stock < 0 && !negative_stock_approved {
                    push_issue(
                        &mut row_errors,
                        "NEGATIVE_STOCK_APPROVAL_REQUIRED",
                        "negative stock requires the branch policy and explicit approval",
                    );
                }
                if !item_id.is_empty()
                    && !seen.insert(format!("{item_id}|{}", location.to_ascii_lowercase()))
                {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "opening stock for this product and location appears twice",
                    );
                }
                let (latest_cost, weighted_cost) = if item_id.is_empty() {
                    (None, None)
                } else {
                    migration_repository::historical_inventory_cost_suggestions(
                        db, tenant, branch, &item_id, &base_unit,
                    )
                    .await
                    .map_err(|_| {
                        AppError::internal("failed to calculate historical cost evidence")
                    })?
                };
                let source_cost_value = mapped_cell(source_row, &field_indexes, "unitCostPaise");
                let source_cost = (!source_cost_value.trim().is_empty()).then(|| {
                    parse_i64_field(&source_cost_value, "unitCostPaise", 0, &mut row_errors)
                });
                let source_valuation_value =
                    mapped_cell(source_row, &field_indexes, "valuationPaise");
                let source_valuation = (!source_valuation_value.trim().is_empty()).then(|| {
                    parse_i64_field(
                        &source_valuation_value,
                        "valuationPaise",
                        i64::MIN,
                        &mut row_errors,
                    )
                });
                let source_system_cost = source_cost.or_else(|| {
                    source_valuation
                        .and_then(|value| rounded_unit_cost_from_valuation(value, opening_stock))
                });
                let approved_cost_value =
                    mapped_cell(source_row, &field_indexes, "approvedUnitCostPaise");
                if approved_cost_value.trim().is_empty() {
                    push_issue(
                        &mut row_errors,
                        "APPROVED_STOCK_UNIT_COST_REQUIRED",
                        "approvedUnitCostPaise is required and must be per stock unit",
                    );
                }
                let approved_cost = parse_i64_field_default(
                    &approved_cost_value,
                    "approvedUnitCostPaise",
                    0,
                    0,
                    &mut row_errors,
                );
                let cost_method = mapped_cell(source_row, &field_indexes, "costMethod")
                    .trim()
                    .to_ascii_lowercase()
                    .replace(' ', "_")
                    .replace('-', "_");
                let expected_cost = match cost_method.as_str() {
                    "latest_historical_purchase_cost" => latest_cost,
                    "weighted_average_historical_cost" => weighted_cost,
                    "current_source_system_valuation" => source_system_cost,
                    "manual_approved_cost" => Some(approved_cost),
                    _ => {
                        push_issue(
                            &mut row_errors,
                            "INVALID_COST_METHOD",
                            "costMethod must select latest historical, weighted historical, source-system or manual approved cost",
                        );
                        None
                    }
                };
                if expected_cost.is_none() && cost_method != "manual_approved_cost" {
                    push_issue(
                        &mut row_errors,
                        "SELECTED_COST_EVIDENCE_MISSING",
                        "the selected cost method has no matching stock-unit evidence",
                    );
                } else if expected_cost.is_some_and(|value| value != approved_cost) {
                    push_issue(
                        &mut row_errors,
                        "APPROVED_COST_EVIDENCE_MISMATCH",
                        "approvedUnitCostPaise must match the selected evidence; use manual_approved_cost for a different value",
                    );
                }
                let valuation = opening_valuation_paise(opening_stock, approved_cost).unwrap_or_else(
                    || {
                        push_issue(
                            &mut row_errors,
                            "OPENING_VALUATION_OVERFLOW",
                            "opening quantity multiplied by approved unit cost exceeds integer paise range",
                        );
                        0
                    },
                );
                let snapshot_at = parse_required_datetime(
                    &mapped_cell(source_row, &field_indexes, "snapshotAt"),
                    "snapshotAt",
                    &mut row_errors,
                )
                .unwrap_or_default();
                if let Ok(snapshot_date) = DateTime::parse_from_rfc3339(&snapshot_at) {
                    for batch in batches_json.as_array().into_iter().flatten() {
                        if batch
                            .get("expiryDate")
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
                            .is_some_and(|expiry| expiry < snapshot_date.date_naive())
                            && batch.get("quantity").and_then(Value::as_i64).unwrap_or(0) > 0
                        {
                            push_issue(
                                &mut row_errors,
                                "EXPIRED_BATCH_SELLABLE_BLOCKED",
                                "expired batch quantity cannot be included in opening sellable stock; record it in expiredQuantity",
                            );
                        }
                    }
                }
                let counted_by = mapped_cell(source_row, &field_indexes, "countedBy");
                if counted_by.is_empty() {
                    push_issue(&mut row_errors, "REQUIRED_FIELD", "countedBy is required");
                } else if !migration_repository::opening_stock_counter_exists(
                    db,
                    tenant,
                    branch,
                    &counted_by,
                )
                .await
                .map_err(|_| AppError::internal("failed to validate counted-by user"))?
                {
                    push_issue(
                        &mut row_errors,
                        "COUNTED_BY_USER_INVALID",
                        "countedBy must be an active user with access to this branch",
                    );
                }
                let approved_unbatched_quantity = if batch_tracked {
                    unbatched_quantity
                } else {
                    opening_stock
                };
                payload.extend([
                    ("product_reference".into(), json!(product)),
                    ("inventory_item_id".into(), json!(item_id)),
                    ("location_code".into(), json!(location)),
                    ("stock_unit".into(), json!(base_unit)),
                    ("opening_stock".into(), json!(opening_stock)),
                    ("source_quantity".into(), json!(source_quantity)),
                    ("source_unit".into(), json!(stock_unit)),
                    ("unit_multiplier".into(), json!(multiplier)),
                    (
                        "unit_conversion_approved".into(),
                        json!(unit_conversion_approved),
                    ),
                    ("location_approved".into(), json!(location_approved)),
                    (
                        "classifications_json".into(),
                        Value::Object(classifications),
                    ),
                    ("counted_by".into(), json!(counted_by)),
                    (
                        "count_notes".into(),
                        json!(mapped_cell(source_row, &field_indexes, "notes")),
                    ),
                    ("source_unit_cost_paise".into(), json!(source_cost)),
                    ("source_valuation_paise".into(), json!(source_valuation)),
                    (
                        "suggested_source_system_cost_paise".into(),
                        json!(source_system_cost),
                    ),
                    ("suggested_latest_cost_paise".into(), json!(latest_cost)),
                    (
                        "suggested_weighted_average_cost_paise".into(),
                        json!(weighted_cost),
                    ),
                    ("cost_method".into(), json!(cost_method)),
                    ("unit_cost_paise".into(), json!(approved_cost)),
                    ("valuation_paise".into(), json!(valuation)),
                    ("batches_json".into(), batches_json),
                    (
                        "approved_unbatched_quantity".into(),
                        json!(approved_unbatched_quantity),
                    ),
                    (
                        "negative_stock_approved".into(),
                        json!(negative_stock_approved),
                    ),
                    ("snapshot_at".into(), json!(snapshot_at)),
                ]);
            }
            MigrationEntity::ClientMemberships => {
                let client_reference = mapped_cell(source_row, &field_indexes, "client");
                let normalized_client = client_service::normalize_phone(&client_reference)
                    .unwrap_or_else(|_| client_reference.trim().to_string());
                let client_id = if client_reference.trim().is_empty() {
                    None
                } else {
                    let direct = migration_repository::resolve_migration_reference(
                        db,
                        tenant,
                        branch,
                        MigrationEntity::Clients,
                        client_reference.trim(),
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to resolve membership client"))?;
                    if direct.is_some() || normalized_client == client_reference.trim() {
                        direct
                    } else {
                        migration_repository::resolve_migration_reference(
                            db,
                            tenant,
                            branch,
                            MigrationEntity::Clients,
                            &normalized_client,
                        )
                        .await
                        .map_err(|_| AppError::internal("failed to resolve membership client"))?
                    }
                };
                if client_id.is_none() {
                    push_issue(
                        &mut row_errors,
                        "MEMBERSHIP_CLIENT_NOT_FOUND",
                        "membership client must exist in this tenant and branch",
                    );
                }
                let membership_name = mapped_cell(source_row, &field_indexes, "membership");
                let membership_id =
                    migration_repository::resolve_membership(db, tenant, branch, &membership_name)
                        .await
                        .map_err(|_| AppError::internal("failed to resolve membership plan"))?;
                if membership_id.is_none() {
                    push_issue(
                        &mut row_errors,
                        "MEMBERSHIP_PLAN_NOT_FOUND",
                        "membership plan must exist in this tenant and branch",
                    );
                }
                let start_date = parse_required_date(
                    &mapped_cell(source_row, &field_indexes, "startDate"),
                    "startDate",
                    &mut row_errors,
                );
                let end_date = parse_optional_date(
                    &mapped_cell(source_row, &field_indexes, "endDate"),
                    &mut row_errors,
                    "endDate",
                );
                if let (Some(start), Some(end)) = (
                    start_date
                        .as_deref()
                        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()),
                    end_date,
                ) {
                    if end < start {
                        push_issue(
                            &mut row_errors,
                            "MEMBERSHIP_DATE_RANGE_INVALID",
                            "endDate must not precede startDate",
                        );
                    }
                }
                let staff_reference = mapped_cell(source_row, &field_indexes, "staff");
                let staff_id = if staff_reference.is_empty() {
                    None
                } else {
                    migration_repository::resolve_migration_reference(
                        db,
                        tenant,
                        branch,
                        MigrationEntity::Staff,
                        &staff_reference,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to resolve membership staff"))?
                };
                if !staff_reference.is_empty() && staff_id.is_none() {
                    push_issue(
                        &mut row_warnings,
                        "DEPENDENCY_NOT_FOUND",
                        "staff reference was preserved but not linked",
                    );
                }
                if !external_id.is_empty() && !seen.insert(external_id.to_ascii_lowercase()) {
                    push_issue(
                        &mut row_errors,
                        "DUPLICATE_SOURCE_KEY",
                        "duplicate client membership source ID",
                    );
                }
                if row_errors.is_empty() {
                    duplicate_target_id = migration_repository::find_client_membership_duplicate(
                        db,
                        tenant,
                        branch,
                        &external_id,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to analyze membership duplicates"))?;
                    if duplicate_target_id.is_some() {
                        duplicate_decision = decision_for(
                            duplicate_decisions,
                            entity,
                            line,
                            &external_id,
                            &external_id,
                        );
                        if duplicate_decision.is_none() {
                            push_issue(
                                &mut row_warnings,
                                "DUPLICATE_DECISION_REQUIRED",
                                "choose keep or link for the existing client membership",
                            );
                        }
                    }
                }
                let digest = format!(
                    "{:x}",
                    Sha256::digest(membership_name.to_ascii_lowercase().as_bytes())
                );
                let membership_code = format!("MIG-{}", &digest[..12]);
                let end_date_text = end_date.map(|value| value.to_string()).unwrap_or_default();
                let active = end_date.is_none_or(|value| value >= Utc::now().date_naive())
                    && parse_active(
                        &mapped_cell(source_row, &field_indexes, "active"),
                        &mut row_errors,
                    );
                payload.extend([
                    ("client_id".into(), json!(client_id.unwrap_or_default())),
                    ("client_reference".into(), json!(normalized_client)),
                    (
                        "client_name".into(),
                        json!(mapped_cell(source_row, &field_indexes, "clientName")),
                    ),
                    (
                        "membership_id".into(),
                        json!(membership_id.unwrap_or_default()),
                    ),
                    ("membership_name".into(), json!(membership_name)),
                    ("membership_code".into(), json!(membership_code)),
                    (
                        "price_paid_paise".into(),
                        json!(parse_i64_field_default(
                            &mapped_cell(source_row, &field_indexes, "pricePaidPaise"),
                            "pricePaidPaise",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    (
                        "balance_paise".into(),
                        json!(parse_i64_field_default(
                            &mapped_cell(source_row, &field_indexes, "balancePaise"),
                            "balancePaise",
                            0,
                            0,
                            &mut row_errors
                        )),
                    ),
                    ("assigned_at".into(), json!(start_date.unwrap_or_default())),
                    ("expires_at".into(), json!(end_date_text)),
                    ("staff_reference".into(), json!(staff_reference)),
                    ("staff_id".into(), json!(staff_id.unwrap_or_default())),
                    ("active".into(), json!(active)),
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
            MigrationEntity::Appointments
            | MigrationEntity::Sales
            | MigrationEntity::Invoices
            | MigrationEntity::Payments
            | MigrationEntity::Expenses
            | MigrationEntity::PurchaseBills => {
                let prepared = prepare_transaction_row(
                    db,
                    tenant,
                    branch,
                    entity,
                    source_provider,
                    source_row,
                    &field_indexes,
                    line,
                    &external_id,
                    duplicate_decisions,
                    &mut seen,
                    &mut row_errors,
                    &mut row_warnings,
                )
                .await?;
                payload = prepared.payload;
                duplicate_target_id = prepared.duplicate_target_id;
                duplicate_decision = prepared.duplicate_decision;
            }
            MigrationEntity::Refunds
            | MigrationEntity::GiftCards
            | MigrationEntity::Loyalty
            | MigrationEntity::Payroll
            | MigrationEntity::Commissions
            | MigrationEntity::ClientNotes
            | MigrationEntity::Files
            | MigrationEntity::StockMovements
            | MigrationEntity::OpeningPayables => {
                let prepared = prepare_extended_row(
                    db,
                    tenant,
                    branch,
                    entity,
                    source_row,
                    &field_indexes,
                    line,
                    &external_id,
                    duplicate_decisions,
                    &mut seen,
                    projection_job_id,
                    financial_state,
                    &mut row_errors,
                )
                .await?;
                payload = prepared.payload;
                duplicate_target_id = prepared.duplicate_target_id;
                duplicate_decision = prepared.duplicate_decision;
            }
        }

        if entity != MigrationEntity::PurchaseBills
            && duplicate_target_id.is_none()
            && row_errors.is_empty()
        {
            duplicate_target_id = migration_repository::find_imported_external_duplicate(
                db,
                tenant,
                branch,
                entity,
                &external_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to analyze provider ID duplicates"))?;
            if duplicate_target_id.is_some() {
                duplicate_decision = decision_for(
                    duplicate_decisions,
                    entity,
                    line,
                    &external_id,
                    &external_id,
                );
            }
        }
        let duplicate_signals = duplicate_signals(entity, &payload, &external_id);
        let allowed_duplicate_decisions = if duplicate_target_id.is_some() {
            allowed_duplicate_decisions(entity)
        } else {
            Vec::new()
        };
        if duplicate_target_id.is_some() && duplicate_decision.is_none() {
            push_issue(
                &mut row_warnings,
                "DUPLICATE_DECISION_REQUIRED",
                "choose an allowed duplicate action",
            );
        }
        if let Some(decision) = duplicate_decision {
            if decision == MigrationDuplicateDecision::Reject {
                push_issue(
                    &mut row_errors,
                    "DUPLICATE_REJECTED",
                    "duplicate row was rejected and will be quarantined",
                );
            } else if !allowed_duplicate_decisions.contains(&decision) {
                push_issue(
                    &mut row_errors,
                    "DUPLICATE_ACTION_NOT_ALLOWED",
                    "this duplicate action is unsafe for the selected CRM entity",
                );
            }
        }
        let duplicate_preview = if let Some(target_id) = duplicate_target_id.as_deref() {
            migration_repository::duplicate_resolution_context(
                db, tenant, branch, entity, target_id,
            )
            .await
            .map_err(|_| AppError::internal("failed to build duplicate merge preview"))?
            .map(|(existing, dependencies)| {
                build_duplicate_preview(
                    entity,
                    duplicate_decision,
                    existing,
                    &payload,
                    dependencies,
                )
            })
        } else {
            None
        };

        dedupe_issues(&mut row_errors);
        dedupe_issues(&mut row_warnings);
        for issue in row_errors.iter_mut().chain(row_warnings.iter_mut()) {
            issue.row_number = Some(line);
        }
        payload.insert(
            "__migration_evidence".into(),
            json!({
                "engineVersion": transformation_version,
                "safetyRuleVersion": MIGRATION_SAFETY_RULE_VERSION,
                "crossFieldRuleVersion": MIGRATION_CROSS_FIELD_RULE_VERSION,
                "dependencyRuleVersion": MIGRATION_DEPENDENCY_RULE_VERSION,
                "sourceValues": source_values,
                "fields": transformation_fields,
                "duplicateResolution": {
                    "signals": &duplicate_signals,
                    "allowedDecisions": &allowed_duplicate_decisions,
                    "preview": &duplicate_preview,
                },
            }),
        );
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
        let dependency_pending = !row_errors.is_empty()
            && row_errors
                .iter()
                .all(|issue| is_dependency_issue(&issue.code));
        let status = if dependency_pending {
            MigrationRowStatus::DependencyPending
        } else if !row_errors.is_empty() {
            MigrationRowStatus::Error
        } else if duplicate_target_id.is_some() {
            MigrationRowStatus::Duplicate
        } else if !row_warnings.is_empty() {
            MigrationRowStatus::Warning
        } else {
            MigrationRowStatus::Validated
        };
        if dependency_pending {
            summary.dependency_pending_rows += 1;
        } else if !row_errors.is_empty() {
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
        if (!row_errors.is_empty() || unresolved_duplicate) && !dependency_pending {
            let issue = row_errors
                .first()
                .or_else(|| row_warnings.first())
                .cloned()
                .unwrap_or(MigrationRowIssue {
                    code: "ROW_BLOCKED".into(),
                    message: "row is blocked".into(),
                    row_number: Some(line),
                    source_field: None,
                    value_pattern: None,
                    suggested_target: None,
                });
            errors_json.push(json!({
                "row": line,
                "code": issue.code,
                "message": issue.message,
                "sourceField": issue.source_field,
                "valuePattern": issue.value_pattern,
                "suggestedTarget": issue.suggested_target,
            }));
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
            duplicate_signals,
            allowed_duplicate_decisions,
            duplicate_preview,
        });
    }

    if summary.source_rows == 0 {
        return Err(AppError::validation("CSV has no non-empty data rows"));
    }
    let report = MigrationAnalysisReport {
        entity,
        transformation_version: transformation_version.to_string(),
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

struct PreparedTransactionRow {
    payload: Map<String, Value>,
    duplicate_target_id: Option<String>,
    duplicate_decision: Option<MigrationDuplicateDecision>,
}

#[allow(clippy::too_many_arguments)]
async fn prepare_extended_row(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_row: &[String],
    indexes: &HashMap<&'static str, usize>,
    line: i32,
    external_id: &str,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
    seen: &mut HashSet<String>,
    projection_job_id: Option<&str>,
    financial_state: &mut HashMap<String, i64>,
    errors: &mut Vec<MigrationRowIssue>,
) -> Result<PreparedTransactionRow, AppError> {
    let cell = |field| mapped_cell(source_row, indexes, field);
    if external_id.is_empty() {
        push_issue(errors, "REQUIRED_FIELD", "oldExternalId is required");
    } else if entity != MigrationEntity::PurchaseBills
        && !seen.insert(format!("external:{}", external_id.to_ascii_lowercase()))
    {
        push_issue(
            errors,
            "DUPLICATE_SOURCE_KEY",
            "oldExternalId appears twice in CSV",
        );
    }
    let resolve = |dependency: MigrationEntity, reference: String| async move {
        if reference.is_empty() {
            return Ok(None);
        }
        migration_repository::resolve_migration_reference(
            db, tenant, branch, dependency, &reference,
        )
        .await
        .map_err(|_| AppError::internal("failed to resolve migration dependency"))
    };
    let occurred_at = |field: &'static str, errors: &mut Vec<MigrationRowIssue>| {
        let value = cell(field);
        if value.is_empty() {
            None
        } else {
            parse_required_datetime(&value, field, errors)
        }
    };
    let mut payload = Map::new();
    let mut projection_applied = false;
    let business_key = match entity {
        MigrationEntity::Refunds => {
            let invoice = cell("invoice");
            let sale_id = resolve(MigrationEntity::Invoices, invoice.clone()).await?;
            if sale_id.is_none() {
                push_issue(
                    errors,
                    "REFUND_INVOICE_NOT_FOUND",
                    "invoice must exist before refunds",
                );
            }
            let amount = parse_i64_field(&cell("amountPaise"), "amountPaise", 1, errors);
            let method = cell("paymentMethod").trim().to_ascii_lowercase();
            let valid_method = matches!(
                method.as_str(),
                "cash" | "upi" | "card" | "wallet" | "bank_transfer" | "gift_card" | "store_credit"
            );
            if !valid_method {
                push_issue(errors, "INVALID_PAYMENT_METHOD", "paymentMethod is invalid");
            }
            if cell("reason").trim().is_empty() {
                push_issue(errors, "REQUIRED_FIELD", "reason is required");
            }
            let occurred_at = occurred_at("occurredAt", errors);
            if let Some(sale_id) = sale_id.as_deref().filter(|_| valid_method && amount > 0) {
                let key = format!("refund:{sale_id}:{}", method.to_ascii_lowercase());
                hydrate_projection_state(
                    db,
                    tenant,
                    branch,
                    projection_job_id,
                    &key,
                    financial_state,
                )
                .await?;
                let available = match financial_state.get(&key).copied() {
                    Some(value) => Some(value),
                    None => migration_repository::refundable_payment_balance(
                        db, tenant, branch, sale_id, &method,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to validate refundable balance"))?,
                };
                match available {
                    None => push_issue(
                        errors,
                        "REFUND_PAYMENT_NOT_FOUND",
                        "matching invoice payment was not found in this tenant and branch",
                    ),
                    Some(balance) if amount > balance => push_issue(
                        errors,
                        "REFUND_EXCEEDS_REFUNDABLE_BALANCE",
                        "refund amount exceeds the refundable paid balance",
                    ),
                    Some(balance) if errors.is_empty() => {
                        financial_state.insert(key, balance - amount);
                        projection_applied = true;
                    }
                    _ => {}
                }
            }
            payload.extend([
                ("sale_id".into(), json!(sale_id)),
                ("amount_paise".into(), json!(amount)),
                ("payment_method".into(), json!(method)),
                ("reason".into(), json!(cell("reason").trim())),
                ("notes".into(), json!(cell("notes").trim())),
                ("occurred_at".into(), json!(occurred_at)),
            ]);
            external_id.to_ascii_lowercase()
        }
        MigrationEntity::GiftCards => {
            let code = cell("code").trim().to_ascii_uppercase();
            if code.is_empty() || code.len() > 100 {
                push_issue(
                    errors,
                    "INVALID_GIFT_CARD_CODE",
                    "gift-card code is invalid",
                );
            }
            let client_ref = cell("client");
            let client_id = resolve(MigrationEntity::Clients, client_ref.clone()).await?;
            if !client_ref.is_empty() && client_id.is_none() {
                push_issue(
                    errors,
                    "DEPENDENCY_NOT_FOUND",
                    "gift-card client was not found",
                );
            }
            let initial =
                parse_i64_field(&cell("initialAmountPaise"), "initialAmountPaise", 1, errors);
            let balance = parse_i64_field(&cell("balancePaise"), "balancePaise", 0, errors);
            if balance > initial {
                push_issue(
                    errors,
                    "GIFT_CARD_BALANCE_EXCEEDS_INITIAL",
                    "balancePaise cannot exceed initialAmountPaise",
                );
            }
            let status = cell("status").trim().to_ascii_lowercase();
            let status = if status.is_empty() {
                if balance == 0 {
                    "redeemed"
                } else {
                    "active"
                }
            } else {
                status.as_str()
            };
            if !matches!(
                status,
                "active" | "redeemed" | "expired" | "voided" | "blocked"
            ) {
                push_issue(errors, "INVALID_STATUS", "gift-card status is invalid");
            }
            payload.extend([
                ("code".into(), json!(code)),
                ("client_id".into(), json!(client_id.unwrap_or_default())),
                ("initial_amount_paise".into(), json!(initial)),
                ("balance_paise".into(), json!(balance)),
                ("status".into(), json!(status)),
                (
                    "expires_at".into(),
                    json!(parse_optional_date(&cell("expiresAt"), errors, "expiresAt")
                        .map(|date| date.to_string())),
                ),
                (
                    "occurred_at".into(),
                    json!(occurred_at("occurredAt", errors)),
                ),
            ]);
            code.to_ascii_lowercase()
        }
        MigrationEntity::Loyalty => {
            let client_id = resolve(MigrationEntity::Clients, cell("client")).await?;
            if client_id.is_none() {
                push_issue(
                    errors,
                    "DEPENDENCY_NOT_FOUND",
                    "client must exist before loyalty history",
                );
            }
            let transaction_type = cell("transactionType").trim().to_ascii_lowercase();
            if !matches!(
                transaction_type.as_str(),
                "earned" | "redeemed" | "reversed" | "adjusted"
            ) {
                push_issue(
                    errors,
                    "INVALID_TRANSACTION_TYPE",
                    "loyalty transactionType is invalid",
                );
            }
            let points = cell("points").trim().parse::<i32>().unwrap_or_else(|_| {
                push_issue(errors, "INVALID_NUMBER", "points must be an integer");
                0
            });
            if points == 0 {
                push_issue(errors, "INVALID_NUMBER", "points cannot be zero");
            }
            let balance = parse_i32_field(&cell("balanceAfter"), "balanceAfter", 0, errors);
            let sale_id = resolve(MigrationEntity::Invoices, cell("invoice")).await?;
            let staff_id = resolve(MigrationEntity::Staff, cell("staff")).await?;
            payload.extend([
                ("client_id".into(), json!(client_id)),
                ("transaction_type".into(), json!(transaction_type)),
                ("points".into(), json!(points)),
                ("balance_after".into(), json!(balance)),
                ("sale_id".into(), json!(sale_id.unwrap_or_default())),
                ("staff_id".into(), json!(staff_id.unwrap_or_default())),
                (
                    "expires_at".into(),
                    json!(parse_optional_date(&cell("expiresAt"), errors, "expiresAt")
                        .map(|date| date.to_string())),
                ),
                ("note".into(), json!(cell("note").trim())),
                (
                    "occurred_at".into(),
                    json!(occurred_at("occurredAt", errors)),
                ),
            ]);
            external_id.to_ascii_lowercase()
        }
        MigrationEntity::Payroll => {
            let staff_id = resolve(MigrationEntity::Staff, cell("staff")).await?;
            if staff_id.is_none() {
                push_issue(
                    errors,
                    "DEPENDENCY_NOT_FOUND",
                    "staff must exist before payroll",
                );
            }
            let start = parse_optional_date(&cell("periodStart"), errors, "periodStart");
            let end = parse_optional_date(&cell("periodEnd"), errors, "periodEnd");
            if start.is_none() || end.is_none() {
                push_issue(
                    errors,
                    "REQUIRED_FIELD",
                    "periodStart and periodEnd are required",
                );
            } else if end < start {
                push_issue(
                    errors,
                    "PAYROLL_PERIOD_RANGE_INVALID",
                    "periodEnd must be on or after periodStart",
                );
            }
            let status_value = cell("status").trim().to_ascii_lowercase();
            let status = if status_value.is_empty() {
                "calculated"
            } else {
                status_value.as_str()
            };
            if !matches!(
                status,
                "calculated" | "reviewed" | "finalized" | "partially_paid" | "paid"
            ) {
                push_issue(errors, "INVALID_STATUS", "payroll status is invalid");
            }
            let adjustment = cell("adjustmentPaise")
                .trim()
                .parse::<i64>()
                .unwrap_or_else(|_| {
                    if !cell("adjustmentPaise").trim().is_empty() {
                        push_issue(
                            errors,
                            "INVALID_NUMBER",
                            "adjustmentPaise must be an integer",
                        );
                    }
                    0
                });
            let earned_salary = parse_i64_field_default(
                &cell("earnedSalaryPaise"),
                "earnedSalaryPaise",
                0,
                0,
                errors,
            );
            let overtime =
                parse_i64_field_default(&cell("overtimePaise"), "overtimePaise", 0, 0, errors);
            let commission =
                parse_i64_field_default(&cell("commissionPaise"), "commissionPaise", 0, 0, errors);
            let penalty =
                parse_i64_field_default(&cell("penaltyPaise"), "penaltyPaise", 0, 0, errors);
            let gross = parse_i64_field(&cell("grossPaise"), "grossPaise", 0, errors);
            let deductions =
                parse_i64_field(&cell("deductionsPaise"), "deductionsPaise", 0, errors);
            let net = parse_i64_field(&cell("netPaise"), "netPaise", 0, errors);
            if !payroll_total_matches(gross, deductions, net) {
                push_issue(
                    errors,
                    "PAYROLL_TOTAL_MISMATCH",
                    "netPaise must equal grossPaise minus deductionsPaise",
                );
            }
            let business_key = format!(
                "{}:{}",
                start.map(|date| date.to_string()).unwrap_or_default(),
                staff_id.as_deref().unwrap_or_default()
            );
            payload.extend([
                ("staff_id".into(), json!(staff_id)),
                (
                    "period_start".into(),
                    json!(start.map(|date| date.to_string())),
                ),
                ("period_end".into(), json!(end.map(|date| date.to_string()))),
                ("status".into(), json!(status)),
                ("earned_salary_paise".into(), json!(earned_salary)),
                ("overtime_paise".into(), json!(overtime)),
                ("commission_paise".into(), json!(commission)),
                ("adjustment_paise".into(), json!(adjustment)),
                ("penalty_paise".into(), json!(penalty)),
                ("gross_paise".into(), json!(gross)),
                ("deductions_paise".into(), json!(deductions)),
                ("net_paise".into(), json!(net)),
                ("notes".into(), json!(cell("notes").trim())),
            ]);
            business_key
        }
        MigrationEntity::Commissions => {
            let sale_id = resolve(MigrationEntity::Invoices, cell("invoice")).await?;
            let staff_id = resolve(MigrationEntity::Staff, cell("staff")).await?;
            if sale_id.is_none() {
                push_issue(
                    errors,
                    "COMMISSION_INVOICE_NOT_FOUND",
                    "commission invoice must exist in this tenant and branch",
                );
            }
            if staff_id.is_none() {
                push_issue(
                    errors,
                    "COMMISSION_STAFF_NOT_FOUND",
                    "commission staff must exist in this tenant and branch",
                );
            }
            let line_ref = cell("saleLine");
            let sale_line = if let Some(sale_id) = sale_id.as_deref() {
                migration_repository::resolve_sale_line(db, tenant, branch, sale_id, &line_ref)
                    .await
                    .map_err(|_| AppError::internal("failed to resolve sale line"))?
            } else {
                None
            };
            if sale_line.is_none() {
                push_issue(
                    errors,
                    "COMMISSION_SALE_LINE_NOT_FOUND",
                    "saleLine was not found on the invoice",
                );
            }
            let split_bps =
                parse_i32_field_default(&cell("splitBps"), "splitBps", 1, 10_000, errors);
            let rate_percent = parse_i32_field(&cell("ratePercent"), "ratePercent", 0, errors);
            let base_paise = parse_i64_field(&cell("basePaise"), "basePaise", 0, errors);
            let commission_paise =
                parse_i64_field(&cell("commissionPaise"), "commissionPaise", 0, errors);
            if split_bps > 10_000 {
                push_issue(
                    errors,
                    "COMMISSION_SPLIT_EXCEEDS_10000_BPS",
                    "splitBps cannot exceed 10000",
                );
            }
            if rate_percent > 100 {
                push_issue(
                    errors,
                    "COMMISSION_RATE_OUT_OF_RANGE",
                    "ratePercent must be between 0 and 100",
                );
            }
            if let Some((sale_line_id, _, _)) = sale_line.as_ref() {
                let key = format!("commission:{sale_line_id}");
                hydrate_projection_state(
                    db,
                    tenant,
                    branch,
                    projection_job_id,
                    &key,
                    financial_state,
                )
                .await?;
                let existing = match financial_state.get(&key).copied() {
                    Some(remaining) => 10_000 - remaining,
                    None => migration_repository::commission_split_total(
                        db,
                        tenant,
                        branch,
                        sale_line_id,
                    )
                    .await
                    .map_err(|_| AppError::internal("failed to validate commission split"))?,
                };
                let remaining = 10_000_i64.saturating_sub(existing);
                if i64::from(split_bps) > remaining {
                    push_issue(
                        errors,
                        "COMMISSION_SPLIT_EXCEEDS_10000_BPS",
                        "cumulative commission split cannot exceed 10000 bps",
                    );
                } else if errors.is_empty() {
                    financial_state.insert(key, remaining - i64::from(split_bps));
                    projection_applied = true;
                }
            }
            payload.extend([
                ("sale_id".into(), json!(sale_id)),
                (
                    "sale_line_id".into(),
                    json!(sale_line.as_ref().map(|row| row.0.clone())),
                ),
                (
                    "line_type".into(),
                    json!(sale_line
                        .as_ref()
                        .map(|row| row.1.clone())
                        .unwrap_or_default()),
                ),
                (
                    "item_id".into(),
                    json!(sale_line
                        .as_ref()
                        .map(|row| row.2.clone())
                        .unwrap_or_default()),
                ),
                ("staff_id".into(), json!(staff_id)),
                ("split_bps".into(), json!(split_bps)),
                ("base_paise".into(), json!(base_paise)),
                ("rate_percent".into(), json!(rate_percent)),
                ("commission_paise".into(), json!(commission_paise)),
            ]);
            external_id.to_ascii_lowercase()
        }
        MigrationEntity::ClientNotes => {
            let client_id = resolve(MigrationEntity::Clients, cell("client")).await?;
            if client_id.is_none() {
                push_issue(
                    errors,
                    "DEPENDENCY_NOT_FOUND",
                    "client must exist before notes",
                );
            }
            let note = cell("note");
            if note.trim().is_empty() || note.len() > 20_000 {
                push_issue(
                    errors,
                    "INVALID_NOTE",
                    "note must be between 1 and 20000 characters",
                );
            }
            payload.extend([
                ("client_id".into(), json!(client_id)),
                (
                    "note_type".into(),
                    json!(if cell("noteType").trim().is_empty() {
                        "general".into()
                    } else {
                        cell("noteType").trim().to_string()
                    }),
                ),
                ("note".into(), json!(note.trim())),
                (
                    "occurred_at".into(),
                    json!(occurred_at("occurredAt", errors)),
                ),
            ]);
            external_id.to_ascii_lowercase()
        }
        MigrationEntity::Files => {
            let owner_type = cell("ownerType").trim().to_ascii_lowercase();
            if !matches!(owner_type.as_str(), "client" | "staff") {
                push_issue(
                    errors,
                    "INVALID_OWNER_TYPE",
                    "ownerType must be client or staff",
                );
            }
            let dependency = if owner_type == "staff" {
                MigrationEntity::Staff
            } else {
                MigrationEntity::Clients
            };
            let owner_id = resolve(dependency, cell("owner")).await?;
            if owner_id.is_none() {
                push_issue(errors, "FILE_OWNER_NOT_FOUND", "file owner was not found");
            }
            let file_name = cell("fileName");
            if file_name.is_empty()
                || file_name.len() > 255
                || file_name.contains('/')
                || file_name.contains('\\')
            {
                push_issue(errors, "INVALID_FILE_NAME", "fileName is invalid");
            }
            let content_type = cell("contentType").trim().to_ascii_lowercase();
            let content = STANDARD
                .decode(cell("contentBase64").trim())
                .unwrap_or_else(|_| {
                    push_issue(errors, "INVALID_BASE64", "contentBase64 is invalid");
                    Vec::new()
                });
            if content.is_empty() || content.len() > 5 * 1024 * 1024 {
                push_issue(
                    errors,
                    "INVALID_FILE_SIZE",
                    "file must be between 1 byte and 5 MB",
                );
            }
            let digest = format!("{:x}", Sha256::digest(&content));
            if !digest.eq_ignore_ascii_case(cell("sha256").trim()) {
                push_issue(errors, "CHECKSUM_MISMATCH", "file SHA-256 does not match");
            }
            let photo_type = cell("photoType").trim().to_ascii_lowercase();
            let file_kind = if cell("fileKind").trim().is_empty() {
                "document".to_string()
            } else {
                cell("fileKind").trim().to_ascii_lowercase()
            };
            if owner_type == "staff" && !matches!(file_kind.as_str(), "photo" | "document") {
                push_issue(
                    errors,
                    "INVALID_FILE_KIND",
                    "staff fileKind must be photo or document",
                );
            }
            if owner_type == "client"
                && (!matches!(
                    content_type.as_str(),
                    "image/jpeg" | "image/png" | "image/webp"
                ) || !matches!(photo_type.as_str(), "" | "before" | "after" | "other"))
            {
                push_issue(
                    errors,
                    "INVALID_CLIENT_PHOTO",
                    "client files must be JPEG, PNG, or WebP treatment photos",
                );
            }
            let appointment_id = if owner_type == "client" {
                resolve(MigrationEntity::Appointments, cell("appointment")).await?
            } else {
                None
            };
            payload.extend([
                ("owner_type".into(), json!(owner_type)),
                ("owner_id".into(), json!(owner_id)),
                ("file_name".into(), json!(file_name)),
                ("content_type".into(), json!(content_type)),
                ("content_base64".into(), json!(cell("contentBase64").trim())),
                ("sha256".into(), json!(digest)),
                ("file_kind".into(), json!(file_kind)),
                (
                    "photo_type".into(),
                    json!(if photo_type.is_empty() {
                        "other".into()
                    } else {
                        photo_type
                    }),
                ),
                ("appointment_id".into(), json!(appointment_id)),
                ("caption".into(), json!(cell("caption").trim())),
            ]);
            external_id.to_ascii_lowercase()
        }
        MigrationEntity::OpeningPayables => {
            let supplier = resolve(MigrationEntity::Suppliers, cell("supplier")).await?;
            if supplier.is_none() {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_SUPPLIER_NOT_FOUND",
                    "supplier must exist in this tenant and branch",
                );
            }
            let amount = parse_i64_field(
                &cell("outstandingAmountPaise"),
                "outstandingAmountPaise",
                1,
                errors,
            );
            let source_total = parse_i64_field(
                &cell("sourceOutstandingTotalPaise"),
                "sourceOutstandingTotalPaise",
                i64::MIN,
                errors,
            );
            let gst = parse_i64_field_default(&cell("gstPaise"), "gstPaise", 0, 0, errors);
            if gst != 0 {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_GST_MUST_BE_ZERO",
                    "historical GST cannot be reclaimed through opening payables",
                );
            }
            let side = cell("balanceSide").trim().to_ascii_lowercase();
            if !matches!(side.as_str(), "debit" | "credit") {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_BALANCE_SIDE_INVALID",
                    "balanceSide must be debit or credit",
                );
            }
            let currency = cell("currency").trim().to_ascii_uppercase();
            if currency != "INR" {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_CURRENCY_UNSUPPORTED",
                    "currency is required and must be INR until foreign-currency journals are configured",
                );
            }
            let account = cell("openingBalanceAccount").trim().to_ascii_uppercase();
            if !matches!(account.as_str(), "OWNER_EQUITY" | "RETAINED_EARNINGS") {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_ACCOUNT_INVALID",
                    "openingBalanceAccount must be OWNER_EQUITY or RETAINED_EARNINGS",
                );
            }
            let allocations = if cell("historicalBillAllocationsJson").trim().is_empty() {
                Value::Array(Vec::new())
            } else {
                serde_json::from_str::<Value>(cell("historicalBillAllocationsJson").trim())
                    .unwrap_or_else(|_| {
                        push_issue(
                            errors,
                            "OPENING_PAYABLE_ALLOCATIONS_INVALID",
                            "historicalBillAllocationsJson must be a JSON array",
                        );
                        Value::Array(Vec::new())
                    })
            };
            let mut allocation_ids = HashSet::new();
            let allocation_total = allocations.as_array().map(|items| {
                items.iter().fold(0_i64, |total, item| {
                    let bill = item.get("historicalBillId").and_then(Value::as_str).unwrap_or("").trim();
                    let value = item.get("amountPaise").and_then(Value::as_i64).unwrap_or(0);
                    if bill.is_empty() || value <= 0 {
                        push_issue(errors, "OPENING_PAYABLE_ALLOCATION_INVALID", "each allocation requires historicalBillId and positive amountPaise");
                    }
                    if !bill.is_empty() && !allocation_ids.insert(bill.to_string()) {
                        push_issue(errors, "OPENING_PAYABLE_ALLOCATION_DUPLICATE", "a historical bill can appear only once in a supplier balance row");
                    }
                    total.checked_add(value).unwrap_or_else(|| {
                        push_issue(errors, "OPENING_PAYABLE_ALLOCATION_INVALID", "historical bill allocation total is too large");
                        i64::MAX
                    })
                })
            }).unwrap_or_else(|| {
                push_issue(errors, "OPENING_PAYABLE_ALLOCATIONS_INVALID", "historicalBillAllocationsJson must be a JSON array");
                0
            });
            if allocation_total > amount {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_ALLOCATION_EXCEEDS_BALANCE",
                    "historical bill allocations cannot exceed outstandingAmountPaise",
                );
            }
            let unallocated = amount.saturating_sub(allocation_total);
            let unallocated_approved = parse_boolean_default(
                &cell("unallocatedApproved"),
                false,
                "unallocatedApproved",
                errors,
            );
            if unallocated > 0 && !unallocated_approved {
                push_issue(
                    errors,
                    "OPENING_PAYABLE_UNALLOCATED_APPROVAL_REQUIRED",
                    "an unallocated supplier balance requires explicit approval",
                );
            }
            let source_row_checksum =
                format!("{:x}", Sha256::digest(source_row.join("\u{1f}").as_bytes()));
            payload.extend([
                ("supplier_id".into(), json!(supplier)),
                ("amount_paise".into(), json!(amount)),
                ("balance_side".into(), json!(side)),
                ("currency".into(), json!(currency)),
                (
                    "due_date".into(),
                    json!(parse_optional_date(&cell("dueDate"), errors, "dueDate")
                        .map(|date| date.to_string())),
                ),
                ("source_outstanding_total_paise".into(), json!(source_total)),
                ("opening_balance_account".into(), json!(account)),
                ("allocations".into(), allocations),
                ("unallocated_paise".into(), json!(unallocated)),
                ("unallocated_approved".into(), json!(unallocated_approved)),
                ("gst_paise".into(), json!(gst)),
                ("source_row_checksum".into(), json!(source_row_checksum)),
            ]);
            external_id.to_ascii_lowercase()
        }
        MigrationEntity::StockMovements => {
            let item = resolve(MigrationEntity::Products, cell("product")).await?;
            if item.is_none() {
                push_issue(
                    errors,
                    "STOCK_PRODUCT_NOT_FOUND",
                    "product must exist before stock movements",
                );
            }
            let delta = cell("quantityDelta")
                .trim()
                .parse::<i32>()
                .unwrap_or_else(|_| {
                    push_issue(errors, "INVALID_NUMBER", "quantityDelta must be an integer");
                    0
                });
            if delta == 0 {
                push_issue(errors, "INVALID_NUMBER", "quantityDelta cannot be zero");
            }
            if cell("reason").trim().is_empty() {
                push_issue(errors, "REQUIRED_FIELD", "reason is required");
            }
            let occurred_at = occurred_at("occurredAt", errors);
            let unit_cost_paise =
                parse_i64_field_default(&cell("unitCostPaise"), "unitCostPaise", 0, 0, errors);
            if let Some(item_id) = item.as_deref() {
                let key = format!("stock:{item_id}");
                hydrate_projection_state(
                    db,
                    tenant,
                    branch,
                    projection_job_id,
                    &key,
                    financial_state,
                )
                .await?;
                let current = match financial_state.get(&key).copied() {
                    Some(value) => Some(value),
                    None => {
                        migration_repository::inventory_stock_quantity(db, tenant, branch, item_id)
                            .await
                            .map_err(|_| AppError::internal("failed to validate stock balance"))?
                    }
                };
                match current {
                    None => push_issue(
                        errors,
                        "STOCK_PRODUCT_NOT_FOUND",
                        "inventory item no longer exists in this tenant and branch",
                    ),
                    Some(balance) if balance.checked_add(i64::from(delta)).is_none() => push_issue(
                        errors,
                        "STOCK_QUANTITY_OVERFLOW",
                        "stock movement exceeds the supported quantity range",
                    ),
                    Some(balance) if balance + i64::from(delta) < 0 => push_issue(
                        errors,
                        "NEGATIVE_STOCK_NOT_ALLOWED",
                        "stock movement would create negative stock",
                    ),
                    Some(balance) if errors.is_empty() => {
                        financial_state.insert(key, balance + i64::from(delta));
                        projection_applied = true;
                    }
                    _ => {}
                }
            }
            payload.extend([
                ("inventory_item_id".into(), json!(item)),
                ("quantity_delta".into(), json!(delta)),
                ("unit_cost_paise".into(), json!(unit_cost_paise)),
                ("reason".into(), json!(cell("reason").trim())),
                ("occurred_at".into(), json!(occurred_at)),
            ]);
            external_id.to_ascii_lowercase()
        }
        _ => {
            return Err(AppError::validation(
                "unsupported extended migration entity",
            ));
        }
    };
    payload.insert(
        "__financial_projection_applied".into(),
        json!(projection_applied),
    );
    let duplicate_target_id =
        migration_repository::find_extended_duplicate(db, tenant, branch, entity, &business_key)
            .await
            .map_err(|_| AppError::internal("failed to analyze migration duplicates"))?;
    if duplicate_target_id.is_some() {
        rollback_financial_projection(entity, &mut payload, financial_state);
    }
    let duplicate_decision = duplicate_target_id.as_ref().and_then(|_| {
        decision_for(
            duplicate_decisions,
            entity,
            line,
            external_id,
            &business_key,
        )
    });
    Ok(PreparedTransactionRow {
        payload,
        duplicate_target_id,
        duplicate_decision,
    })
}

pub(crate) fn rollback_financial_projection(
    entity: MigrationEntity,
    row: &mut Map<String, Value>,
    financial_state: &mut HashMap<String, i64>,
) {
    if !row
        .get("__financial_projection_applied")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return;
    }
    let adjustment = match entity {
        MigrationEntity::Refunds => Some((
            format!(
                "refund:{}:{}",
                row.get("sale_id").and_then(Value::as_str).unwrap_or(""),
                row.get("payment_method")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_ascii_lowercase()
            ),
            row.get("amount_paise").and_then(Value::as_i64).unwrap_or(0),
        )),
        MigrationEntity::Commissions => Some((
            format!(
                "commission:{}",
                row.get("sale_line_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            ),
            row.get("split_bps").and_then(Value::as_i64).unwrap_or(0),
        )),
        MigrationEntity::StockMovements => Some((
            format!(
                "stock:{}",
                row.get("inventory_item_id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            ),
            -row.get("quantity_delta")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        )),
        _ => None,
    };
    if let Some((key, amount)) = adjustment {
        if let Some(current) = financial_state.get_mut(&key) {
            if let Some(restored) = current.checked_add(amount) {
                *current = restored;
            }
        }
    }
    row.insert("__financial_projection_applied".into(), json!(false));
}

#[allow(clippy::too_many_arguments)]
async fn prepare_transaction_row(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    entity: MigrationEntity,
    source_provider: MigrationProvider,
    source_row: &[String],
    indexes: &HashMap<&'static str, usize>,
    line: i32,
    external_id: &str,
    duplicate_decisions: &BTreeMap<String, MigrationDuplicateDecision>,
    seen: &mut HashSet<String>,
    errors: &mut Vec<MigrationRowIssue>,
    warnings: &mut Vec<MigrationRowIssue>,
) -> Result<PreparedTransactionRow, AppError> {
    let cell = |field| mapped_cell(source_row, indexes, field);
    if external_id.is_empty() {
        push_issue(errors, "REQUIRED_FIELD", "oldExternalId is required");
    } else if entity != MigrationEntity::PurchaseBills
        && !seen.insert(format!("external:{}", external_id.to_ascii_lowercase()))
    {
        push_issue(
            errors,
            "DUPLICATE_SOURCE_KEY",
            "oldExternalId appears twice in CSV",
        );
    }
    let resolve = |dependency: MigrationEntity, reference: String| async move {
        if reference.is_empty() {
            return Ok(None);
        }
        migration_repository::resolve_migration_reference(
            db, tenant, branch, dependency, &reference,
        )
        .await
        .map_err(|_| AppError::internal("failed to resolve migration dependency"))
    };
    let mut payload = Map::new();
    let business_key = match entity {
        MigrationEntity::Appointments => {
            let client_ref = cell("client");
            let staff_ref = cell("staff");
            let client_id = resolve(MigrationEntity::Clients, client_ref.clone()).await?;
            let staff_id = resolve(MigrationEntity::Staff, staff_ref.clone()).await?;
            if client_id.is_none() || staff_id.is_none() {
                if client_id.is_none() {
                    push_issue(
                        errors,
                        "APPOINTMENT_CLIENT_NOT_FOUND",
                        "appointment client must exist in this tenant and branch",
                    );
                }
                if staff_id.is_none() {
                    push_issue(
                        errors,
                        "APPOINTMENT_STAFF_NOT_FOUND",
                        "appointment staff must exist in this tenant and branch",
                    );
                }
            }
            let mut service_ids = Vec::new();
            for reference in split_list(&cell("services")) {
                match resolve(MigrationEntity::Services, reference.clone()).await? {
                    Some(id) => service_ids.push(id),
                    None => push_issue(
                        errors,
                        "APPOINTMENT_SERVICE_NOT_FOUND",
                        &format!("service '{reference}' was not found"),
                    ),
                }
            }
            if service_ids.is_empty() {
                push_issue(errors, "REQUIRED_FIELD", "at least one service is required");
            }
            let start_at = parse_required_datetime(&cell("startAt"), "startAt", errors);
            let end_at = parse_required_datetime(&cell("endAt"), "endAt", errors);
            if start_at
                .as_deref()
                .zip(end_at.as_deref())
                .is_some_and(|(start, end)| start >= end)
            {
                push_issue(
                    errors,
                    "APPOINTMENT_TIME_RANGE_INVALID",
                    "endAt must be after startAt",
                );
            }
            let status = default_text(&cell("status"), "booked").to_ascii_lowercase();
            if !matches!(
                status.as_str(),
                "draft"
                    | "booked"
                    | "confirmed"
                    | "arrived"
                    | "waiting"
                    | "in-service"
                    | "completed"
                    | "billed"
                    | "paid"
                    | "cancelled"
                    | "no-show"
                    | "rescheduled"
            ) {
                push_issue(errors, "INVALID_VALUE", "appointment status is invalid");
            }
            payload.extend([
                ("client_id".into(), json!(client_id.unwrap_or_default())),
                ("staff_id".into(), json!(staff_id.unwrap_or_default())),
                ("service_ids_json".into(), json!(service_ids)),
                ("start_at".into(), json!(start_at)),
                ("end_at".into(), json!(end_at)),
                ("status".into(), json!(status)),
                ("notes".into(), json!(cell("notes"))),
            ]);
            format!("{}:{}:{}", client_ref, staff_ref, cell("startAt"))
        }
        MigrationEntity::Sales | MigrationEntity::Invoices => {
            let client_ref = cell("client");
            let client_id = resolve(MigrationEntity::Clients, client_ref).await?;
            if client_id.is_none() {
                push_issue(
                    errors,
                    "DEPENDENCY_NOT_FOUND",
                    "client must exist before sales or invoices",
                );
            }
            let sale_ref = cell("sale");
            let linked_sale_id = if entity == MigrationEntity::Invoices && !sale_ref.is_empty() {
                resolve(MigrationEntity::Sales, sale_ref).await?
            } else {
                None
            };
            if entity == MigrationEntity::Invoices
                && !cell("sale").is_empty()
                && linked_sale_id.is_none()
            {
                push_issue(
                    errors,
                    "DEPENDENCY_NOT_FOUND",
                    "referenced sale was not found",
                );
            }
            let line_type = default_text(&cell("lineType"), "custom").to_ascii_lowercase();
            if entity == MigrationEntity::Sales
                && !matches!(line_type.as_str(), "service" | "product" | "custom")
            {
                push_issue(
                    errors,
                    "INVALID_VALUE",
                    "lineType must be service, product or custom",
                );
            }
            let item_ref = cell("item");
            let item_id = if item_ref.is_empty() {
                None
            } else {
                let dependency = if line_type == "product" {
                    MigrationEntity::Products
                } else {
                    MigrationEntity::Services
                };
                resolve(dependency, item_ref).await?
            };
            if entity == MigrationEntity::Sales && line_type != "custom" && item_id.is_none() {
                push_issue(errors, "DEPENDENCY_NOT_FOUND", "sale item was not found");
            }
            let subtotal = parse_i64_field(&cell("subtotalPaise"), "subtotalPaise", 0, errors);
            let quantity = if entity == MigrationEntity::Sales {
                parse_i64_field(&cell("quantity"), "quantity", 1, errors)
            } else {
                1
            };
            let unit_price = if entity == MigrationEntity::Sales {
                parse_i64_field(&cell("unitPricePaise"), "unitPricePaise", 0, errors)
            } else {
                subtotal
            };
            let discount =
                parse_i64_field_default(&cell("discountPaise"), "discountPaise", 0, 0, errors);
            let tax = parse_i64_field_default(&cell("taxPaise"), "taxPaise", 0, 0, errors);
            let cgst = parse_i64_field_default(&cell("cgstPaise"), "cgstPaise", 0, 0, errors);
            let sgst = parse_i64_field_default(&cell("sgstPaise"), "sgstPaise", 0, 0, errors);
            let igst = parse_i64_field_default(&cell("igstPaise"), "igstPaise", 0, 0, errors);
            let total = parse_i64_field(&cell("totalPaise"), "totalPaise", 0, errors);
            if !invoice_total_matches(subtotal, discount, tax, total) {
                push_issue(
                    errors,
                    if entity == MigrationEntity::Invoices {
                        "INVOICE_TOTAL_MISMATCH"
                    } else {
                        "SALE_TOTAL_MISMATCH"
                    },
                    "subtotalPaise - discountPaise + taxPaise must equal totalPaise",
                );
            }
            let gst_split_supplied = [cell("cgstPaise"), cell("sgstPaise"), cell("igstPaise")]
                .iter()
                .any(|value| !value.is_empty());
            if gst_split_supplied && cgst + sgst + igst != tax {
                push_issue(errors, "UNBALANCED_GST", "GST split must equal taxPaise");
            } else if !gst_split_supplied && tax > 0 {
                push_issue(
                    warnings,
                    "GST_SPLIT_UNAVAILABLE",
                    "source tax was preserved without a CGST/SGST/IGST split",
                );
            }
            let business_date = parse_required_date(&cell("businessDate"), "businessDate", errors);
            let invoice_number = cell("invoiceNumber");
            let status = default_text(&cell("status"), "open").to_ascii_lowercase();
            payload.extend([
                ("client_id".into(), json!(client_id.unwrap_or_default())),
                (
                    "linked_sale_id".into(),
                    json!(linked_sale_id.unwrap_or_default()),
                ),
                ("invoice_number".into(), json!(invoice_number)),
                ("line_type".into(), json!(line_type)),
                ("item_id".into(), json!(item_id.unwrap_or_default())),
                ("item_name".into(), json!(cell("itemName"))),
                ("quantity".into(), json!(quantity)),
                ("unit_price_paise".into(), json!(unit_price)),
                ("subtotal_paise".into(), json!(subtotal)),
                ("discount_paise".into(), json!(discount)),
                ("tax_paise".into(), json!(tax)),
                ("cgst_paise".into(), json!(cgst)),
                ("sgst_paise".into(), json!(sgst)),
                ("igst_paise".into(), json!(igst)),
                ("total_paise".into(), json!(total)),
                ("status".into(), json!(status)),
                ("business_date".into(), json!(business_date)),
            ]);
            invoice_number
        }
        MigrationEntity::Payments => {
            let invoice_ref = cell("invoice");
            let sale_id = resolve(MigrationEntity::Invoices, invoice_ref.clone()).await?;
            if sale_id.is_none() {
                push_issue(
                    errors,
                    "PAYMENT_INVOICE_NOT_FOUND",
                    "invoice must exist before payment",
                );
            }
            let amount = parse_i64_field(&cell("amountPaise"), "amountPaise", 1, errors);
            let method = cell("method").to_ascii_lowercase();
            if method.is_empty() {
                push_issue(errors, "REQUIRED_FIELD", "method is required");
            }
            let paid_at = parse_required_datetime(&cell("paidAt"), "paidAt", errors);
            let migration_reference = format!("migration:{external_id}");
            payload.extend([
                ("sale_id".into(), json!(sale_id.unwrap_or_default())),
                ("method".into(), json!(method)),
                ("amount_paise".into(), json!(amount)),
                ("reference".into(), json!(migration_reference)),
                ("source_reference".into(), json!(cell("reference"))),
                ("paid_at".into(), json!(paid_at)),
            ]);
            format!("migration:{external_id}")
        }
        MigrationEntity::Expenses => {
            let category = cell("category").to_ascii_lowercase();
            let category_meta = outgoing_funds_service::static_categories()
                .into_iter()
                .find(|item| {
                    item.key.eq_ignore_ascii_case(&category) && item.account_code.is_some()
                });
            if category_meta.is_none() {
                push_issue(
                    errors,
                    "INVALID_VALUE",
                    "expense category is not a manual accounting category",
                );
            }
            let amount = parse_i64_field(&cell("amountPaise"), "amountPaise", 1, errors);
            let gst = parse_i64_field_default(&cell("gstPaise"), "gstPaise", 0, 0, errors);
            if gst > amount {
                push_issue(
                    errors,
                    "INVALID_NUMBER",
                    "gstPaise cannot exceed amountPaise",
                );
            }
            let method = cell("paymentMethod").to_ascii_lowercase();
            let business_date = parse_required_date(&cell("businessDate"), "businessDate", errors);
            payload.extend([
                ("category".into(), json!(category)),
                (
                    "account_code".into(),
                    json!(category_meta
                        .and_then(|item| item.account_code)
                        .unwrap_or_default()),
                ),
                ("amount_paise".into(), json!(amount)),
                ("gst_paise".into(), json!(gst)),
                ("payment_method".into(), json!(method)),
                ("business_date".into(), json!(business_date)),
                ("vendor".into(), json!(cell("vendor"))),
                ("reference".into(), json!(cell("reference"))),
                ("notes".into(), json!(cell("notes"))),
            ]);
            external_id.to_string()
        }
        MigrationEntity::PurchaseBills => {
            let product_refs = [
                cell("product"),
                cell("sourceProductId"),
                cell("sku"),
                cell("barcode"),
                cell("productName"),
            ];
            if product_refs.iter().all(|value| value.trim().is_empty()) {
                push_issue(
                    errors,
                    "REQUIRED_FIELD",
                    "product, productName, SKU, barcode or sourceProductId is required",
                );
            }
            let mut item_id = None;
            for reference in product_refs.iter().filter(|value| !value.trim().is_empty()) {
                item_id = resolve(MigrationEntity::Products, reference.clone()).await?;
                if item_id.is_some() {
                    break;
                }
            }
            if item_id.is_none() {
                push_issue(
                    warnings,
                    "UNMAPPED_ARCHIVE_PRODUCT",
                    "source product will remain in the historical archive without a CRM product mapping",
                );
            }
            let original_product_name = product_refs
                .iter()
                .find(|value| !value.trim().is_empty())
                .cloned()
                .unwrap_or_default();
            let document_type = default_text(&cell("documentType"), "invoice")
                .to_ascii_lowercase()
                .replace([' ', '-'], "_");
            if !matches!(
                document_type.as_str(),
                "invoice" | "canceled" | "cancelled" | "return" | "credit_note"
            ) {
                push_issue(
                    errors,
                    "INVALID_PURCHASE_DOCUMENT_TYPE",
                    "documentType must be invoice, canceled, return or credit_note",
                );
            }
            let signed_document = matches!(document_type.as_str(), "return" | "credit_note");
            let signed_min = if signed_document { i64::MIN } else { 0 };
            let quantity = parse_i64_field(&cell("quantity"), "quantity", signed_min, errors);
            if quantity == 0 {
                push_issue(errors, "INVALID_NUMBER", "quantity cannot be zero");
            }
            let accepted_quantity = parse_i64_field_default(
                &cell("acceptedQuantity"),
                "acceptedQuantity",
                0,
                if signed_document { 0 } else { quantity },
                errors,
            );
            let damaged_quantity =
                parse_i64_field_default(&cell("damagedQuantity"), "damagedQuantity", 0, 0, errors);
            let rejected_quantity = parse_i64_field_default(
                &cell("rejectedQuantity"),
                "rejectedQuantity",
                0,
                0,
                errors,
            );
            if !signed_document
                && accepted_quantity
                    .checked_add(damaged_quantity)
                    .and_then(|value| value.checked_add(rejected_quantity))
                    .is_none_or(|value| value > quantity)
            {
                push_issue(
                    errors,
                    "PURCHASE_QUANTITY_MISMATCH",
                    "accepted, damaged and rejected quantity cannot exceed purchased quantity",
                );
            }
            let unit_cost = parse_i64_field(&cell("unitCostPaise"), "unitCostPaise", 0, errors);
            let taxable =
                parse_i64_field(&cell("taxablePaise"), "taxablePaise", signed_min, errors);
            let cgst =
                parse_i64_field_default(&cell("cgstPaise"), "cgstPaise", signed_min, 0, errors);
            let sgst =
                parse_i64_field_default(&cell("sgstPaise"), "sgstPaise", signed_min, 0, errors);
            let igst =
                parse_i64_field_default(&cell("igstPaise"), "igstPaise", signed_min, 0, errors);
            let total = parse_i64_field(&cell("totalPaise"), "totalPaise", signed_min, errors);
            if taxable + cgst + sgst + igst != total {
                push_issue(
                    errors,
                    "UNBALANCED_TOTAL",
                    "purchase taxable and GST paise must equal totalPaise",
                );
            }
            if quantity.saturating_mul(unit_cost) != taxable {
                push_issue(
                    errors,
                    "UNBALANCED_TOTAL",
                    "quantity * unitCostPaise must equal taxablePaise",
                );
            }
            let invoice_number = cell("invoiceNumber");
            let gstin = cell("supplierGstin").to_ascii_uppercase();
            if invoice_number.trim().is_empty() {
                push_issue(errors, "REQUIRED_FIELD", "invoiceNumber is required");
            }
            if cell("supplierName").trim().is_empty()
                && gstin.is_empty()
                && cell("supplierExternalId").trim().is_empty()
            {
                push_issue(
                    errors,
                    "PURCHASE_SUPPLIER_IDENTITY_REQUIRED",
                    "supplier name, GSTIN or provider supplier ID is required",
                );
            }
            let line_identity = format!(
                "purchase-line:{}:{}:{}",
                external_id.to_ascii_lowercase(),
                if cell("sourceLineId").is_empty() {
                    line.to_string()
                } else {
                    cell("sourceLineId").to_ascii_lowercase()
                },
                cell("batchNumber").to_ascii_lowercase()
            );
            if !seen.insert(line_identity) {
                push_issue(
                    errors,
                    "DUPLICATE_PURCHASE_BILL_LINE",
                    "the same provider bill line and batch appears more than once",
                );
            }
            for (field, value) in [
                ("supplierName", cell("supplierName")),
                ("supplierCode", cell("supplierCode")),
                ("supplierPhone", cell("supplierPhone")),
                ("supplierEmail", cell("supplierEmail")),
                ("invoiceNumber", invoice_number.clone()),
                ("productName", original_product_name.clone()),
                ("sku", cell("sku")),
                ("barcode", cell("barcode")),
                ("brand", cell("brand")),
                ("size", cell("size")),
                ("shade", cell("shade")),
                ("color", cell("color")),
                ("vendorCatalogCode", cell("vendorCatalogCode")),
                ("batchNumber", cell("batchNumber")),
                ("billFileName", cell("billFileName")),
            ] {
                if is_spreadsheet_formula(&value) {
                    push_issue(
                        errors,
                        "CSV_FORMULA_INJECTION",
                        &format!("{field} contains an unsafe spreadsheet formula"),
                    );
                }
            }
            let invoice_date = parse_required_date(&cell("invoiceDate"), "invoiceDate", errors);
            let received_date = if cell("receivedDate").trim().is_empty() {
                invoice_date.clone()
            } else {
                parse_required_date(&cell("receivedDate"), "receivedDate", errors)
            };
            let expiry_date = parse_optional_date(&cell("expiryDate"), errors, "expiryDate")
                .map(|value| value.to_string());
            if invoice_date
                .as_deref()
                .zip(expiry_date.as_deref())
                .is_some_and(|(invoice, expiry)| expiry < invoice)
            {
                push_issue(
                    errors,
                    "INVALID_BATCH_EXPIRY",
                    "expiryDate cannot be before invoiceDate",
                );
            }
            let currency = default_text(&cell("currency"), "INR").to_ascii_uppercase();
            if currency != "INR" {
                push_issue(
                    errors,
                    "UNSUPPORTED_CURRENCY",
                    "historical purchase archive currently supports INR only",
                );
            }
            if cell("billTotalPaise").trim().is_empty() {
                push_issue(
                    warnings,
                    "BILL_TOTAL_UNAVAILABLE",
                    "bill total is missing; line-to-bill reconciliation requires approval",
                );
            }
            payload.extend([
                ("supplier_name".into(), json!(cell("supplierName"))),
                ("supplier_gstin".into(), json!(gstin)),
                (
                    "supplier_external_id".into(),
                    json!(cell("supplierExternalId")),
                ),
                ("supplier_code".into(), json!(cell("supplierCode"))),
                ("supplier_phone".into(), json!(cell("supplierPhone"))),
                ("supplier_email".into(), json!(cell("supplierEmail"))),
                ("invoice_number".into(), json!(invoice_number)),
                ("invoice_date".into(), json!(invoice_date)),
                ("received_date".into(), json!(received_date)),
                ("currency".into(), json!(currency)),
                ("document_type".into(), json!(document_type)),
                ("source_status".into(), json!(cell("sourceStatus"))),
                ("payment_status".into(), json!(cell("paymentStatus"))),
                ("original_product_name".into(), json!(original_product_name)),
                ("sku".into(), json!(cell("sku"))),
                ("barcode".into(), json!(cell("barcode"))),
                ("source_product_id".into(), json!(cell("sourceProductId"))),
                ("brand".into(), json!(cell("brand"))),
                ("size".into(), json!(cell("size"))),
                ("shade".into(), json!(cell("shade"))),
                ("color".into(), json!(cell("color"))),
                (
                    "vendor_catalog_code".into(),
                    json!(cell("vendorCatalogCode")),
                ),
                ("source_line_id".into(), json!(cell("sourceLineId"))),
                (
                    "inventory_item_id".into(),
                    json!(item_id.unwrap_or_default()),
                ),
                ("package_unit".into(), json!(cell("packageUnit"))),
                ("stock_unit".into(), json!(cell("stockUnit"))),
                (
                    "units_per_package".into(),
                    json!(parse_i64_field_default(
                        &cell("unitsPerPackage"),
                        "unitsPerPackage",
                        1,
                        1,
                        errors
                    )),
                ),
                ("quantity".into(), json!(quantity)),
                ("accepted_quantity".into(), json!(accepted_quantity)),
                ("damaged_quantity".into(), json!(damaged_quantity)),
                ("rejected_quantity".into(), json!(rejected_quantity)),
                ("unit_cost_paise".into(), json!(unit_cost)),
                ("taxable_paise".into(), json!(taxable)),
                ("cgst_paise".into(), json!(cgst)),
                ("sgst_paise".into(), json!(sgst)),
                ("igst_paise".into(), json!(igst)),
                ("total_paise".into(), json!(total)),
                (
                    "bill_total_paise".into(),
                    json!(parse_i64_field_default(
                        &cell("billTotalPaise"),
                        "billTotalPaise",
                        signed_min,
                        0,
                        errors
                    )),
                ),
                (
                    "gst_percent".into(),
                    json!(parse_i32_field_default(
                        &cell("gstPercent"),
                        "gstPercent",
                        0,
                        0,
                        errors
                    )),
                ),
                (
                    "discount_paise".into(),
                    json!(parse_i64_field_default(
                        &cell("discountPaise"),
                        "discountPaise",
                        0,
                        0,
                        errors
                    )),
                ),
                (
                    "shipping_paise".into(),
                    json!(parse_i64_field_default(
                        &cell("shippingPaise"),
                        "shippingPaise",
                        0,
                        0,
                        errors
                    )),
                ),
                (
                    "handling_paise".into(),
                    json!(parse_i64_field_default(
                        &cell("handlingPaise"),
                        "handlingPaise",
                        0,
                        0,
                        errors
                    )),
                ),
                ("batch_number".into(), json!(cell("batchNumber"))),
                ("expiry_date".into(), json!(expiry_date)),
                ("bill_file_name".into(), json!(cell("billFileName"))),
            ]);
            if errors.is_empty()
                && migration_repository::find_historical_purchase_bill_duplicate(
                    db,
                    tenant,
                    branch,
                    source_provider,
                    &payload,
                )
                .await
                .map_err(|_| AppError::internal("failed to check historical bill duplicates"))?
                .is_some()
            {
                push_issue(
                    errors,
                    "DUPLICATE_HISTORICAL_PURCHASE_BILL",
                    "historical bill already exists for this provider and supplier invoice identity",
                );
            }
            external_id.to_string()
        }
        _ => return Err(AppError::internal("unsupported transactional entity")),
    };
    let duplicate_target_id = if errors.is_empty() && entity != MigrationEntity::PurchaseBills {
        migration_repository::find_transaction_duplicate(
            db,
            tenant,
            branch,
            entity,
            external_id,
            &business_key,
        )
        .await
        .map_err(|_| AppError::internal("failed to analyze transaction duplicates"))?
    } else {
        None
    };
    let duplicate_decision = duplicate_target_id.as_ref().and_then(|_| {
        decision_for(
            duplicate_decisions,
            entity,
            line,
            external_id,
            &business_key,
        )
    });
    if duplicate_target_id.is_some() && duplicate_decision.is_none() {
        push_issue(
            warnings,
            "DUPLICATE_DECISION_REQUIRED",
            "choose keep or link",
        );
    }
    if duplicate_decision == Some(MigrationDuplicateDecision::Merge) {
        push_issue(
            errors,
            "IMMUTABLE_TRANSACTION",
            "transaction duplicates cannot be merged; choose keep or link",
        );
    }
    Ok(PreparedTransactionRow {
        payload,
        duplicate_target_id,
        duplicate_decision,
    })
}

fn parse_required_date(
    value: &str,
    field: &str,
    errors: &mut Vec<MigrationRowIssue>,
) -> Option<String> {
    match parse_optional_date(value, errors, field) {
        Some(date) => Some(date.to_string()),
        None => {
            if value.trim().is_empty() {
                push_issue(errors, "REQUIRED_FIELD", &format!("{field} is required"));
            }
            None
        }
    }
}

fn is_spreadsheet_formula(value: &str) -> bool {
    matches!(
        value.trim_start().as_bytes().first(),
        Some(b'=') | Some(b'+') | Some(b'@')
    ) || value
        .trim_start()
        .strip_prefix('-')
        .is_some_and(|rest| rest.parse::<f64>().is_err())
}

fn payroll_total_matches(gross: i64, deductions: i64, net: i64) -> bool {
    gross.checked_sub(deductions) == Some(net)
}

fn invoice_total_matches(subtotal: i64, discount: i64, tax: i64, total: i64) -> bool {
    subtotal
        .checked_sub(discount)
        .and_then(|net| net.checked_add(tax))
        == Some(total)
}

fn parse_required_datetime(
    value: &str,
    field: &str,
    errors: &mut Vec<MigrationRowIssue>,
) -> Option<String> {
    if value.trim().is_empty() {
        push_issue(errors, "REQUIRED_FIELD", &format!("{field} is required"));
        return None;
    }
    if let Ok(value) = DateTime::parse_from_rfc3339(value.trim()) {
        return Some(value.with_timezone(&Utc).to_rfc3339());
    }
    if let Some(date) = parse_optional_date(value.trim(), errors, field) {
        return Some(
            date.and_hms_opt(0, 0, 0)
                .expect("midnight is valid")
                .and_utc()
                .to_rfc3339(),
        );
    }
    None
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
        MigrationEntity::ClientMemberships => CLIENT_MEMBERSHIP_COLUMNS,
        MigrationEntity::Packages => PACKAGE_COLUMNS,
        MigrationEntity::Appointments => APPOINTMENT_COLUMNS,
        MigrationEntity::Sales => SALE_COLUMNS,
        MigrationEntity::Invoices => INVOICE_COLUMNS,
        MigrationEntity::Payments => PAYMENT_COLUMNS,
        MigrationEntity::Expenses => EXPENSE_COLUMNS,
        MigrationEntity::PurchaseBills => PURCHASE_BILL_COLUMNS,
        MigrationEntity::Refunds => REFUND_COLUMNS,
        MigrationEntity::GiftCards => GIFT_CARD_COLUMNS,
        MigrationEntity::Loyalty => LOYALTY_COLUMNS,
        MigrationEntity::Payroll => PAYROLL_COLUMNS,
        MigrationEntity::Commissions => COMMISSION_COLUMNS,
        MigrationEntity::ClientNotes => CLIENT_NOTE_COLUMNS,
        MigrationEntity::Files => FILE_COLUMNS,
        MigrationEntity::StockMovements => STOCK_MOVEMENT_COLUMNS,
        MigrationEntity::OpeningPayables => OPENING_PAYABLE_COLUMNS,
    }
}

pub(crate) fn resolve_mapping_detailed(
    entity: MigrationEntity,
    provider: MigrationProvider,
    headers: &[String],
    provided: &BTreeMap<String, String>,
    tenant_aliases: &[MigrationAlias],
) -> Result<MappingResolution, AppError> {
    let mut header_indexes = HashMap::new();
    for (index, header) in headers.iter().enumerate() {
        let key = clean_key(header);
        if key.is_empty() || header_indexes.insert(key, index).is_some() {
            return Err(AppError::validation(
                "source columns contain empty or duplicate normalized headers",
            ));
        }
    }
    let contract_by_key = contracts(entity)
        .iter()
        .map(|column| (clean_key(column.field), column))
        .collect::<HashMap<_, _>>();
    let mut result = BTreeMap::new();
    let mut explicit_indexes = HashSet::new();
    let mut ignored_indexes = HashSet::new();
    let mut decisions = vec![None; headers.len()];
    let mut matches = Vec::<(usize, AliasCandidate)>::new();

    for (source, target) in provided {
        let source_key = clean_key(source);
        let target_key = clean_key(target);
        if target == "__ignore" {
            let index = header_indexes.get(&source_key).copied().ok_or_else(|| {
                AppError::validation(format!("invalid mapping {source} -> {target}"))
            })?;
            ignored_indexes.insert(index);
            decisions[index] = Some(MigrationMappingDecision {
                source_column: headers[index].clone(),
                target_field: None,
                candidates: Vec::new(),
                alias_level: "exact_saved_mapping".to_string(),
                confidence: "green".to_string(),
                confidence_percentage: 100,
                collision: false,
                reason: "explicitly_ignored".to_string(),
                alternative_targets: Vec::new(),
                suggestion_reasons: vec!["Explicit saved mapping ignores this column".to_string()],
                rejection_reasons: Vec::new(),
                detected_data_type: "unknown".to_string(),
                sample_evidence: Vec::new(),
                required_transformation: None,
                approved: false,
                approval_id: None,
                approved_by: None,
                approved_at: None,
            });
            continue;
        }
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
        } else {
            return Err(AppError::validation(format!(
                "invalid mapping {source} -> {target}"
            )));
        };
        if let Some((index, column)) = resolved {
            if explicit_indexes.contains(&index) {
                return Err(AppError::validation(
                    "source column is mapped more than once",
                ));
            }
            explicit_indexes.insert(index);
            matches.push((
                index,
                AliasCandidate {
                    field: column.field,
                    level: "exact_saved_mapping",
                    priority: 60,
                },
            ));
        }
    }

    for (index, header) in headers.iter().enumerate() {
        if explicit_indexes.contains(&index) || ignored_indexes.contains(&index) {
            continue;
        }
        let key = clean_key(header);
        let provider_tenant_aliases = tenant_aliases
            .iter()
            .filter(|alias| {
                alias.entity == entity
                    && alias.source_provider == provider
                    && clean_key(&alias.alias) == key
            })
            .collect::<Vec<_>>();
        let tenant_matches = if provider_tenant_aliases.is_empty() {
            tenant_aliases
                .iter()
                .filter(|alias| {
                    alias.entity == entity
                        && alias.source_provider == MigrationProvider::Auto
                        && clean_key(&alias.alias) == key
                })
                .collect::<Vec<_>>()
        } else {
            provider_tenant_aliases
        };
        let mut candidates = if tenant_matches.is_empty() {
            fixed_alias_candidates(entity, provider, &key)
        } else {
            fixed_alias_candidates(entity, provider, &key)
                .into_iter()
                .filter(|candidate| candidate.level == "exact_crm_field")
                .collect::<Vec<_>>()
        };
        for alias in tenant_matches {
            let column = contracts(entity)
                .iter()
                .find(|column| clean_key(column.field) == clean_key(&alias.target_field))
                .ok_or_else(|| {
                    AppError::validation("tenant alias target is no longer supported")
                })?;
            push_candidate(
                &mut candidates,
                AliasCandidate {
                    field: column.field,
                    level: "tenant_approved",
                    priority: 50,
                },
            );
        }
        candidates.sort_by(|left, right| left.field.cmp(right.field));
        if candidates.is_empty() {
            decisions[index] = Some(MigrationMappingDecision {
                source_column: header.clone(),
                target_field: None,
                candidates: Vec::new(),
                alias_level: "none".to_string(),
                confidence: "yellow".to_string(),
                confidence_percentage: 0,
                collision: false,
                reason: "no_registry_match".to_string(),
                alternative_targets: Vec::new(),
                suggestion_reasons: Vec::new(),
                rejection_reasons: vec!["No schema-registry target matched".to_string()],
                detected_data_type: "unknown".to_string(),
                sample_evidence: Vec::new(),
                required_transformation: None,
                approved: false,
                approval_id: None,
                approved_by: None,
                approved_at: None,
            });
            continue;
        }
        if candidates.len() > 1 {
            decisions[index] = Some(MigrationMappingDecision {
                source_column: header.clone(),
                target_field: None,
                candidates: candidates
                    .iter()
                    .map(|candidate| candidate.field.to_string())
                    .collect(),
                alias_level: "ambiguous".to_string(),
                confidence: "yellow".to_string(),
                confidence_percentage: 50,
                collision: false,
                reason: "multiple_registry_targets".to_string(),
                alternative_targets: Vec::new(),
                suggestion_reasons: Vec::new(),
                rejection_reasons: vec!["Multiple schema-registry targets matched".to_string()],
                detected_data_type: "unknown".to_string(),
                sample_evidence: Vec::new(),
                required_transformation: None,
                approved: false,
                approval_id: None,
                approved_by: None,
                approved_at: None,
            });
            continue;
        }
        matches.push((index, candidates.remove(0)));
    }

    let mut target_sources = HashMap::<&'static str, Vec<usize>>::new();
    for (index, candidate) in &matches {
        target_sources
            .entry(candidate.field)
            .or_default()
            .push(*index);
    }
    let mut field_indexes = HashMap::new();
    let mut blocking_reasons = Vec::new();
    for decision in decisions.iter().flatten() {
        if decision.reason == "multiple_registry_targets" {
            blocking_reasons.push(format!(
                "{} has multiple possible CRM targets",
                decision.source_column
            ));
        }
    }
    for (index, candidate) in matches {
        let sources = &target_sources[candidate.field];
        if sources.len() > 1 {
            decisions[index] = Some(MigrationMappingDecision {
                source_column: headers[index].clone(),
                target_field: Some(candidate.field.to_string()),
                candidates: vec![candidate.field.to_string()],
                alias_level: candidate.level.to_string(),
                confidence: "red".to_string(),
                confidence_percentage: 0,
                collision: true,
                reason: "multiple_source_columns_target_same_field".to_string(),
                alternative_targets: Vec::new(),
                suggestion_reasons: Vec::new(),
                rejection_reasons: vec!["Multiple source columns target this CRM field".to_string()],
                detected_data_type: "unknown".to_string(),
                sample_evidence: Vec::new(),
                required_transformation: None,
                approved: false,
                approval_id: None,
                approved_by: None,
                approved_at: None,
            });
            blocking_reasons.push(format!(
                "multiple source columns target {}",
                candidate.field
            ));
        } else {
            result.insert(headers[index].clone(), candidate.field.to_string());
            field_indexes.insert(candidate.field, index);
            decisions[index] = Some(MigrationMappingDecision {
                source_column: headers[index].clone(),
                target_field: Some(candidate.field.to_string()),
                candidates: vec![candidate.field.to_string()],
                alias_level: candidate.level.to_string(),
                confidence: "green".to_string(),
                confidence_percentage: 100,
                collision: false,
                reason: "unique_registry_match".to_string(),
                alternative_targets: Vec::new(),
                suggestion_reasons: vec!["Unique schema-registry match".to_string()],
                rejection_reasons: Vec::new(),
                detected_data_type: "unknown".to_string(),
                sample_evidence: Vec::new(),
                required_transformation: Some(
                    field_metadata(
                        entity,
                        contracts(entity)
                            .iter()
                            .find(|column| column.field == candidate.field)
                            .expect("matched field exists"),
                    )
                    .transformation_rule
                    .to_string(),
                ),
                approved: false,
                approval_id: None,
                approved_by: None,
                approved_at: None,
            });
        }
    }
    blocking_reasons.sort();
    blocking_reasons.dedup();
    let decisions = decisions.into_iter().flatten().collect::<Vec<_>>();
    let unmatched = decisions
        .iter()
        .filter(|decision| {
            decision.reason != "explicitly_ignored"
                && (decision.target_field.is_none() || decision.collision)
        })
        .map(|decision| decision.source_column.clone())
        .collect();
    Ok(MappingResolution {
        mapping: result,
        field_indexes,
        unmatched,
        decisions,
        hard_blocking_reasons: blocking_reasons.clone(),
        approval_required_reasons: BTreeMap::new(),
        blocking_reasons,
    })
}

pub(crate) fn resolve_mapping_with_confidence(
    entity: MigrationEntity,
    provider: MigrationProvider,
    headers: &[String],
    provided: &BTreeMap<String, String>,
    tenant_aliases: &[MigrationAlias],
    profiles: &[MigrationSourceColumnProfile],
    row_count: i64,
) -> Result<MappingResolution, AppError> {
    let mut explicit_only = headers
        .iter()
        .map(|header| (header.clone(), "__ignore".to_string()))
        .collect::<BTreeMap<_, _>>();
    explicit_only.extend(provided.clone());
    let explicit =
        resolve_mapping_detailed(entity, provider, headers, &explicit_only, tenant_aliases)?;
    let explicit_targets = explicit.mapping;
    let explicitly_ignored = provided
        .iter()
        .filter(|(_, target)| target.as_str() == "__ignore")
        .map(|(source, _)| clean_key(source))
        .collect::<HashSet<_>>();
    let related_strength = related_column_strength(entity, provider, headers, tenant_aliases);
    let mut mapping = BTreeMap::new();
    let mut decisions = Vec::with_capacity(headers.len());
    let mut hard_blocking_reasons = explicit.blocking_reasons;
    let mut approval_required_reasons = BTreeMap::new();

    for header in headers {
        if explicitly_ignored.contains(&clean_key(header)) {
            decisions.push(MigrationMappingDecision {
                source_column: header.clone(),
                target_field: None,
                candidates: Vec::new(),
                alias_level: "exact_saved_mapping".to_string(),
                confidence: "green".to_string(),
                confidence_percentage: 100,
                collision: false,
                reason: "explicitly_ignored".to_string(),
                alternative_targets: Vec::new(),
                suggestion_reasons: vec!["User explicitly ignored this source column".to_string()],
                rejection_reasons: Vec::new(),
                detected_data_type: profile_for_header(profiles, header)
                    .map(|profile| profile.detected_data_type.clone())
                    .unwrap_or_else(|| "unknown".to_string()),
                sample_evidence: profile_for_header(profiles, header)
                    .map(|profile| profile.sample_values.clone())
                    .unwrap_or_default(),
                required_transformation: None,
                approved: false,
                approval_id: None,
                approved_by: None,
                approved_at: None,
            });
            continue;
        }

        let profile = profile_for_header(profiles, header);
        let mut scored = contracts(entity)
            .iter()
            .map(|column| {
                score_target(
                    entity,
                    provider,
                    header,
                    column,
                    tenant_aliases,
                    profile,
                    row_count,
                    related_strength,
                )
            })
            .collect::<Vec<_>>();
        scored.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.field.cmp(right.field))
        });
        let automatic_target = scored.first().map(|candidate| candidate.field);
        let explicit_target = explicit_targets.get(header).map(String::as_str);
        let selected_index = explicit_target
            .and_then(|target| scored.iter().position(|item| item.field == target))
            .unwrap_or(0);
        let selected = scored.remove(selected_index);
        let runner_up = scored.first().map_or(0, |candidate| candidate.score);
        let alternatives = scored
            .iter()
            .take(3)
            .map(|candidate| MigrationTargetAlternative {
                target_field: candidate.field.to_string(),
                confidence_percentage: candidate.score,
                reasons: candidate.reasons.clone(),
                rejection_reasons: candidate.rejection_reasons.clone(),
                required_transformation: candidate.transformation.clone(),
            })
            .collect::<Vec<_>>();
        let manual = explicit_target.is_some();
        let margin = selected.score.saturating_sub(runner_up);
        let mixed_values = profile.is_some_and(|profile| profile.invalid_value_count > 0);
        let ambiguous_date = profile.is_some_and(date_format_ambiguous);
        let saved_mapping_drift = manual && automatic_target != Some(selected.field);
        let green = selected.score >= 90
            && margin >= 10
            && !mixed_values
            && !ambiguous_date
            && !saved_mapping_drift;
        let mut rejection_reasons = selected.rejection_reasons.clone();
        let (confidence, reason) = if selected.hard_datatype_mismatch {
            rejection_reasons
                .push("Detected values are incompatible with this CRM datatype".to_string());
            ("red", "datatype_validation_failed")
        } else if green {
            ("green", "deterministic_confidence_match")
        } else if selected.score >= 65 {
            if mixed_values {
                rejection_reasons.push("Source column contains mixed value patterns".to_string());
            }
            if ambiguous_date {
                rejection_reasons
                    .push("Source dates are ambiguous between DD/MM and MM/DD".to_string());
            }
            if saved_mapping_drift {
                rejection_reasons.push(
                    "Saved mapping differs from the current deterministic target".to_string(),
                );
            }
            ("yellow", "approval_required")
        } else {
            ("red", "confidence_below_safe_threshold")
        };
        let confidence_percentage = match confidence {
            "green" => selected.score,
            "yellow" => selected.score.clamp(65, 89),
            _ => selected.score.min(64),
        };
        if selected.hard_datatype_mismatch {
            hard_blocking_reasons.push(format!(
                "{} cannot map to {} because the detected datatype is incompatible",
                header, selected.field
            ));
        } else if confidence == "yellow" {
            approval_required_reasons.insert(
                header.clone(),
                format!(
                    "{} requires authorized approval (score {}, margin {})",
                    header, confidence_percentage, margin
                ),
            );
        } else if confidence == "red" {
            hard_blocking_reasons.push(format!(
                "{} is blocked because confidence {} is below 65",
                header, selected.score
            ));
        } else if confidence == "green" {
            mapping.insert(header.clone(), selected.field.to_string());
        }
        decisions.push(MigrationMappingDecision {
            source_column: header.clone(),
            target_field: Some(selected.field.to_string()),
            candidates: std::iter::once(selected.field.to_string())
                .chain(scored.iter().take(3).map(|item| item.field.to_string()))
                .collect(),
            alias_level: if manual {
                "exact_saved_mapping".to_string()
            } else {
                selected.alias_level.to_string()
            },
            confidence: confidence.to_string(),
            confidence_percentage,
            collision: false,
            reason: reason.to_string(),
            alternative_targets: alternatives,
            suggestion_reasons: selected.reasons,
            rejection_reasons,
            detected_data_type: profile
                .map(|profile| profile.detected_data_type.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            sample_evidence: profile
                .map(|profile| profile.sample_values.clone())
                .unwrap_or_default(),
            required_transformation: Some(selected.transformation),
            approved: false,
            approval_id: None,
            approved_by: None,
            approved_at: None,
        });
    }

    let mut target_sources = BTreeMap::<String, Vec<String>>::new();
    for decision in decisions
        .iter()
        .filter(|decision| decision.confidence != "red" && decision.reason != "explicitly_ignored")
    {
        if let Some(target) = &decision.target_field {
            target_sources
                .entry(target.clone())
                .or_default()
                .push(decision.source_column.clone());
        }
    }
    for (target, sources) in target_sources
        .into_iter()
        .filter(|(_, sources)| sources.len() > 1)
    {
        for decision in decisions
            .iter_mut()
            .filter(|decision| decision.target_field.as_deref() == Some(target.as_str()))
        {
            decision.confidence = "red".to_string();
            decision.confidence_percentage = decision.confidence_percentage.min(64);
            decision.collision = true;
            decision.reason = "multiple_source_columns_target_same_field".to_string();
            decision
                .rejection_reasons
                .push("Multiple source columns target this CRM field".to_string());
        }
        for source in &sources {
            mapping.remove(source);
            approval_required_reasons.remove(source);
        }
        hard_blocking_reasons.push(format!(
            "multiple source columns target {}: {}",
            target,
            sources.join(", ")
        ));
    }
    let covered_targets = decisions
        .iter()
        .filter(|decision| {
            decision.confidence != "red"
                && decision.reason != "explicitly_ignored"
                && !decision.collision
        })
        .filter_map(|decision| decision.target_field.as_deref())
        .collect::<HashSet<_>>();
    for required in contracts(entity)
        .iter()
        .filter(|column| column.required && !covered_targets.contains(column.field))
    {
        hard_blocking_reasons.push(format!(
            "required CRM field {} has no safe source mapping",
            required.field
        ));
    }
    let mut blocking_reasons = hard_blocking_reasons.clone();
    blocking_reasons.extend(approval_required_reasons.values().cloned());
    blocking_reasons.sort();
    blocking_reasons.dedup();
    let matched = mapping
        .keys()
        .map(|source| clean_key(source))
        .collect::<HashSet<_>>();
    let unmatched = decisions
        .iter()
        .filter(|decision| {
            decision.reason != "explicitly_ignored"
                && !matched.contains(&clean_key(&decision.source_column))
        })
        .map(|decision| decision.source_column.clone())
        .collect::<Vec<_>>();
    let field_indexes = mapping
        .iter()
        .filter_map(|(source, target)| {
            let index = headers.iter().position(|header| header == source)?;
            let field = contracts(entity)
                .iter()
                .find(|column| column.field == target)?
                .field;
            Some((field, index))
        })
        .collect();
    Ok(MappingResolution {
        mapping,
        field_indexes,
        unmatched,
        decisions,
        blocking_reasons,
        hard_blocking_reasons,
        approval_required_reasons,
    })
}

fn date_format_ambiguous(profile: &MigrationSourceColumnProfile) -> bool {
    profile
        .patterns
        .iter()
        .any(|pattern| pattern == "date_format_ambiguous")
}

fn profile_for_header<'a>(
    profiles: &'a [MigrationSourceColumnProfile],
    header: &str,
) -> Option<&'a MigrationSourceColumnProfile> {
    profiles
        .iter()
        .find(|profile| clean_key(&profile.original_header) == clean_key(header))
}

fn related_column_strength(
    entity: MigrationEntity,
    provider: MigrationProvider,
    headers: &[String],
    tenant_aliases: &[MigrationAlias],
) -> f64 {
    let mut related_targets = HashSet::new();
    for header in headers {
        let key = clean_key(header);
        let mut candidates = fixed_alias_candidates(entity, provider, &key);
        for alias in tenant_aliases.iter().filter(|alias| {
            alias.entity == entity
                && (alias.source_provider == MigrationProvider::Auto
                    || alias.source_provider == provider)
                && clean_key(&alias.alias) == key
        }) {
            if let Some(column) = contracts(entity)
                .iter()
                .find(|column| column.field == alias.target_field)
            {
                push_candidate(
                    &mut candidates,
                    AliasCandidate {
                        field: column.field,
                        level: "tenant_approved",
                        priority: 50,
                    },
                );
            }
        }
        if candidates.len() == 1 {
            related_targets.insert(candidates[0].field);
        }
    }
    (related_targets.len().min(3) as f64) / 3.0
}

fn score_target(
    entity: MigrationEntity,
    provider: MigrationProvider,
    header: &str,
    column: &'static ColumnContract,
    tenant_aliases: &[MigrationAlias],
    profile: Option<&MigrationSourceColumnProfile>,
    row_count: i64,
    related_strength: f64,
) -> TargetConfidence {
    let metadata = field_metadata(entity, column);
    let mut aliases = vec![(column.field.to_string(), "exact_crm_field")];
    aliases.extend(
        column
            .aliases
            .iter()
            .map(|alias| ((*alias).to_string(), "entity")),
    );
    aliases.extend(
        global_aliases_for(metadata.data_type)
            .iter()
            .map(|alias| ((*alias).to_string(), "global")),
    );
    aliases.extend(
        PROVIDER_ALIAS_RULES
            .iter()
            .filter(|rule| {
                rule.entity == entity && rule.provider == provider && rule.target == column.field
            })
            .map(|rule| (rule.alias.to_string(), "provider")),
    );
    let has_provider_tenant_alias = tenant_aliases.iter().any(|alias| {
        alias.entity == entity
            && alias.source_provider == provider
            && clean_key(&alias.alias) == clean_key(header)
    });
    aliases.extend(
        tenant_aliases
            .iter()
            .filter(|alias| {
                alias.entity == entity
                    && alias.target_field == column.field
                    && if has_provider_tenant_alias {
                        alias.source_provider == provider
                    } else {
                        alias.source_provider == MigrationProvider::Auto
                    }
            })
            .map(|alias| (alias.alias.clone(), "tenant_approved")),
    );
    let (header_strength, best_alias, alias_level) = aliases
        .iter()
        .map(|(alias, level)| (header_alias_similarity(header, alias), alias, *level))
        .max_by(|left, right| left.0.total_cmp(&right.0).then_with(|| right.1.cmp(left.1)))
        .map(|(score, alias, level)| (score, alias.as_str(), level))
        .unwrap_or((0.0, column.field, "none"));
    let (datatype_strength, hard_datatype_mismatch, datatype_reason, datatype_rejection) =
        datatype_compatibility(profile, metadata.data_type, row_count);
    let mut reasons = vec![format!("{} entity/business context", entity.as_str())];
    if header_strength >= 0.999 {
        reasons.push(format!(
            "Header exactly matches {alias_level} alias {best_alias}"
        ));
    } else if header_strength >= 0.5 {
        reasons.push(format!("Header resembles {alias_level} alias {best_alias}"));
    }
    if let Some(reason) = datatype_reason {
        reasons.push(reason);
    }
    if related_strength > 0.0 {
        reasons.push(format!(
            "Related columns support {:.0}% of the business context signal",
            related_strength * 100.0
        ));
    }
    let mut rejection_reasons = Vec::new();
    if let Some(reason) = datatype_rejection {
        rejection_reasons.push(reason);
    }
    let mut score =
        (header_strength * 35.0 + datatype_strength * 30.0 + 20.0 + related_strength * 15.0)
            .round()
            .clamp(0.0, 100.0) as u8;
    if hard_datatype_mismatch {
        score = score.min(59);
    }
    TargetConfidence {
        field: column.field,
        score,
        alias_level,
        reasons,
        rejection_reasons,
        transformation: metadata.transformation_rule.to_string(),
        hard_datatype_mismatch,
    }
}

fn header_alias_similarity(header: &str, alias: &str) -> f64 {
    let header_key = clean_key(header);
    let alias_key = clean_key(alias);
    if header_key == alias_key {
        return 1.0;
    }
    if header_key.contains(&alias_key) || alias_key.contains(&header_key) {
        return 0.85;
    }
    let tokens = |value: &str| {
        value
            .to_ascii_lowercase()
            .split(|character: char| !character.is_ascii_alphanumeric())
            .filter(|token| !token.is_empty())
            .map(ToString::to_string)
            .collect::<HashSet<_>>()
    };
    let left = tokens(header);
    let right = tokens(alias);
    let union = left.union(&right).count();
    if union == 0 {
        0.0
    } else {
        left.intersection(&right).count() as f64 / union as f64
    }
}

fn datatype_compatibility(
    profile: Option<&MigrationSourceColumnProfile>,
    target_type: &str,
    row_count: i64,
) -> (f64, bool, Option<String>, Option<String>) {
    let Some(profile) = profile else {
        return (0.0, false, None, None);
    };
    let source_type = profile.detected_data_type.as_str();
    if matches!(source_type, "empty" | "unknown") {
        return (0.0, false, None, None);
    }
    let non_empty = ((row_count.max(0) as f64) * (1.0 - profile.empty_percentage / 100.0))
        .round()
        .max(1.0);
    let pattern_percentage = ((non_empty - profile.invalid_value_count.max(0) as f64) / non_empty
        * 100.0)
        .clamp(0.0, 100.0)
        .round();
    let exact = source_type == target_type
        || source_type == "currency" && matches!(target_type, "integer" | "decimal")
        || source_type == "integer" && target_type == "decimal"
        || source_type == "date" && target_type == "datetime"
        || source_type == "datetime" && target_type == "date"
        || source_type == "status" && target_type == "string";
    if exact {
        return (
            pattern_percentage / 100.0,
            false,
            Some(format!(
                "{pattern_percentage:.0}% sampled non-empty values match {source_type} pattern"
            )),
            None,
        );
    }
    let strong_source = matches!(source_type, "phone" | "email" | "date" | "datetime");
    let incompatible = strong_source
        && !matches!(
            (source_type, target_type),
            ("date", "string") | ("datetime", "string")
        );
    if incompatible {
        let code = match (source_type, target_type) {
            ("phone", "email") => "PHONE_VALUE_IN_EMAIL_FIELD",
            ("email", "phone") => "EMAIL_VALUE_IN_PHONE_FIELD",
            _ => "INCOMPATIBLE_DATATYPE",
        };
        return (
            0.0,
            true,
            None,
            Some(format!(
                "{code}: values match {source_type} pattern and do not match {target_type}"
            )),
        );
    }
    let compatible = match target_type {
        "string" => 0.55,
        "reference" | "reference_list" => {
            if matches!(source_type, "string" | "uuid" | "integer") {
                0.8
            } else {
                0.25
            }
        }
        "integer" | "decimal" if matches!(source_type, "integer" | "decimal" | "currency") => 0.85,
        _ => 0.0,
    };
    (
        compatible,
        false,
        (compatible > 0.0).then(|| format!("Detected {source_type} values are convertible")),
        (compatible == 0.0).then(|| {
            format!("Detected {source_type} values have no {target_type} compatibility signal")
        }),
    )
}

fn resolve_mapping(
    entity: MigrationEntity,
    provider: MigrationProvider,
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
    let resolution = resolve_mapping_detailed(entity, provider, headers, provided, &[])?;
    if !resolution.blocking_reasons.is_empty() {
        return Err(AppError::validation(resolution.blocking_reasons.join("; ")));
    }
    Ok((
        resolution.mapping,
        resolution.field_indexes,
        resolution.unmatched,
    ))
}

pub(crate) fn suggest_static_field(
    entity: MigrationEntity,
    provider: MigrationProvider,
    header: &str,
) -> Option<String> {
    let resolution = resolve_mapping_detailed(
        entity,
        provider,
        &[header.to_string()],
        &BTreeMap::new(),
        &[],
    )
    .ok()?;
    if resolution.blocking_reasons.is_empty() {
        resolution.mapping.get(header).cloned()
    } else {
        None
    }
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

fn normalize_provider_table(
    entity: MigrationEntity,
    provider: MigrationProvider,
    table: &[Vec<String>],
    source_row_offset: i32,
) -> Vec<Vec<String>> {
    if provider == MigrationProvider::Auto || table.is_empty() {
        return table.to_vec();
    }
    if provider == MigrationProvider::Dingg && entity == MigrationEntity::Payments {
        return normalize_dingg_payments(table, source_row_offset);
    }
    let mut normalized = table.to_vec();
    let headers = normalized[0].clone();
    let target_for = |header: &str| {
        let field = suggest_static_field(entity, provider, header)?;
        contracts(entity)
            .iter()
            .find(|column| column.field == field)
    };
    if matches!(
        provider,
        MigrationProvider::Dingg
            | MigrationProvider::Zenoti
            | MigrationProvider::Salonist
            | MigrationProvider::Fresha
            | MigrationProvider::Tally
            | MigrationProvider::Busy
            | MigrationProvider::Marg
    ) {
        for (column, header) in headers.iter().enumerate() {
            if target_for(header).is_some_and(|target| target.field.ends_with("Paise")) {
                for row in normalized.iter_mut().skip(1) {
                    if let Some(value) = row.get_mut(column) {
                        if let Some(paise) = major_currency_to_paise(value) {
                            *value = paise.to_string();
                        }
                    }
                }
            }
        }
    }
    if provider == MigrationProvider::Dingg {
        match entity {
            MigrationEntity::Staff => ensure_generated_column(
                &mut normalized,
                "employeeCode",
                &["mobile", "emailid", "email", "name"],
                provider,
                entity,
                source_row_offset,
            ),
            MigrationEntity::Products => ensure_generated_column(
                &mut normalized,
                "sku",
                &["sku no", "qr code", "product name"],
                provider,
                entity,
                source_row_offset,
            ),
            MigrationEntity::ClientMemberships => {
                ensure_generated_column(
                    &mut normalized,
                    "oldExternalId",
                    &["mobile", "mship type", "start date / sell date"],
                    provider,
                    entity,
                    source_row_offset,
                );
            }
            MigrationEntity::Sales => {
                ensure_generated_column(
                    &mut normalized,
                    "oldExternalId",
                    &["customer mobile", "service / product name", "date"],
                    provider,
                    entity,
                    source_row_offset,
                );
                ensure_copied_column(&mut normalized, "invoiceNumber", &["oldExternalId"]);
                ensure_copied_column(
                    &mut normalized,
                    "item",
                    &["service / product name", "service product name"],
                );
                ensure_copied_column(&mut normalized, "quantity", &["__one"]);
                ensure_copied_column(&mut normalized, "unitPricePaise", &["amount"]);
                ensure_copied_column(&mut normalized, "subtotalPaise", &["amount"]);
                ensure_copied_column(&mut normalized, "totalPaise", &["amount"]);
                if let Some(index) = header_index(&normalized[0], &["lineType", "type"]) {
                    for row in normalized.iter_mut().skip(1) {
                        if let Some(value) = row.get_mut(index) {
                            *value = match value.trim().to_ascii_lowercase().as_str() {
                                "s" | "service" => "service",
                                "p" | "product" | "retail" | "r" => "product",
                                _ => "custom",
                            }
                            .to_string();
                        }
                    }
                }
            }
            MigrationEntity::Invoices => {
                ensure_copied_column(&mut normalized, "oldExternalId", &["invoice number"]);
                ensure_copied_column(
                    &mut normalized,
                    "subtotalPaise",
                    &["net", "price", "invoice total"],
                );
                ensure_copied_column(
                    &mut normalized,
                    "totalPaise",
                    &["total sale", "invoice total", "net"],
                );
            }
            _ => {}
        }
        if entity == MigrationEntity::Services {
            if let Some(index) = header_index(&normalized[0], &["timing"]) {
                for row in normalized.iter_mut().skip(1) {
                    if let Some(value) = row.get_mut(index) {
                        if let Some(minutes) = duration_to_minutes(value) {
                            *value = minutes.to_string();
                        }
                    }
                }
            }
        }
    }
    normalized
}

fn ensure_copied_column(table: &mut [Vec<String>], target: &str, sources: &[&str]) {
    if table.is_empty() || header_index(&table[0], &[target]).is_some() {
        return;
    }
    let source = header_index(&table[0], sources);
    table[0].push(target.to_string());
    for row in table.iter_mut().skip(1) {
        let value = if sources.contains(&"__one") {
            "1".to_string()
        } else {
            source
                .and_then(|index| row.get(index))
                .cloned()
                .unwrap_or_default()
        };
        row.push(value);
    }
}

fn ensure_generated_column(
    table: &mut [Vec<String>],
    target: &str,
    sources: &[&str],
    provider: MigrationProvider,
    entity: MigrationEntity,
    source_row_offset: i32,
) {
    if table.is_empty() || header_index(&table[0], &[target]).is_some() {
        return;
    }
    let source_indexes = sources
        .iter()
        .filter_map(|source| header_index(&table[0], &[*source]))
        .collect::<Vec<_>>();
    table[0].push(target.to_string());
    for (offset, row) in table.iter_mut().skip(1).enumerate() {
        let identity = source_indexes
            .iter()
            .filter_map(|index| row.get(*index))
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("|");
        let digest = format!("{:x}", Sha256::digest(identity.as_bytes()));
        row.push(format!(
            "{}-{}-{}-{}",
            provider.as_str().to_ascii_uppercase(),
            entity.as_str().to_ascii_uppercase(),
            &digest[..12],
            source_row_offset + offset as i32 + 2
        ));
    }
}

fn header_index(headers: &[String], names: &[&str]) -> Option<usize> {
    headers.iter().position(|header| {
        names
            .iter()
            .any(|name| clean_key(header) == clean_key(name))
    })
}

fn major_currency_to_paise(value: &str) -> Option<i64> {
    let cleaned = value.trim().replace([',', '₹', '$'], "").trim().to_string();
    if cleaned.is_empty() {
        return Some(0);
    }
    let negative = cleaned.starts_with('-');
    let unsigned = cleaned.trim_start_matches(['-', '+']);
    let mut parts = unsigned.split('.');
    let whole = parts.next()?.parse::<i64>().ok()?;
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some() || fraction.len() > 2 || !fraction.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let fraction = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().ok()? * 10,
        _ => fraction.parse::<i64>().ok()?,
    };
    let paise = whole.checked_mul(100)?.checked_add(fraction)?;
    Some(if negative { -paise } else { paise })
}

fn duration_to_minutes(value: &str) -> Option<i32> {
    let value = value.trim();
    if let Ok(minutes) = value.parse::<i32>() {
        return Some(minutes);
    }
    if let Ok(fraction) = value.parse::<f64>() {
        return Some((fraction * 24.0 * 60.0).round() as i32);
    }
    let parts = value
        .split(':')
        .map(str::parse::<i32>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    match parts.as_slice() {
        [hours, minutes] => Some(hours * 60 + minutes),
        [hours, minutes, seconds] => Some(hours * 60 + minutes + i32::from(*seconds >= 30)),
        _ => None,
    }
}

fn normalize_dingg_payments(table: &[Vec<String>], source_row_offset: i32) -> Vec<Vec<String>> {
    let headers = [
        "__sourceRowNumber",
        "oldExternalId",
        "invoice",
        "method",
        "amountPaise",
        "reference",
        "paidAt",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    let invoice = header_index(&table[0], &["invoice number"]);
    let paid_at = header_index(&table[0], &["date"]);
    let mut result = vec![headers];
    for (offset, row) in table.iter().skip(1).enumerate() {
        let invoice = invoice
            .and_then(|index| row.get(index))
            .cloned()
            .unwrap_or_default();
        let paid_at = paid_at
            .and_then(|index| row.get(index))
            .cloned()
            .unwrap_or_default();
        for (method_index, (column, method)) in [
            ("cash", "cash"),
            ("card", "card"),
            ("online", "online"),
            ("custom", "other"),
        ]
        .into_iter()
        .enumerate()
        {
            let Some(index) = header_index(&table[0], &[column]) else {
                continue;
            };
            let Some(amount_value) = row.get(index) else {
                continue;
            };
            let Ok(amount) = major_money_to_paise(amount_value) else {
                continue;
            };
            if amount <= 0 {
                continue;
            }
            result.push(vec![
                ((source_row_offset + offset as i32) * 4 + method_index as i32 + 2).to_string(),
                format!(
                    "DINGG-PAYMENT-{}-{}",
                    source_row_offset + offset as i32 + 2,
                    method
                ),
                invoice.clone(),
                method.to_string(),
                amount_value.clone(),
                String::new(),
                paid_at.clone(),
            ]);
        }
    }
    result
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

async fn hydrate_projection_state(
    db: &PgPool,
    tenant: &str,
    branch: &str,
    job_id: Option<&str>,
    key: &str,
    state: &mut HashMap<String, i64>,
) -> Result<(), AppError> {
    let Some(job_id) = job_id.filter(|_| !state.contains_key(key)) else {
        return Ok(());
    };
    if let Some(balance) =
        migration_large_import_repository::projection_balance(db, tenant, branch, job_id, key)
            .await
            .map_err(|_| AppError::internal("failed to load migration financial projection"))?
    {
        state.insert(key.to_string(), balance);
    }
    Ok(())
}

fn allowed_duplicate_decisions(entity: MigrationEntity) -> Vec<MigrationDuplicateDecision> {
    if entity == MigrationEntity::OpeningPayables {
        return vec![MigrationDuplicateDecision::Reject];
    }
    let mut decisions = vec![
        MigrationDuplicateDecision::Link,
        MigrationDuplicateDecision::Reject,
    ];
    if matches!(
        entity,
        MigrationEntity::Clients
            | MigrationEntity::Staff
            | MigrationEntity::Services
            | MigrationEntity::Products
            | MigrationEntity::Suppliers
            | MigrationEntity::Memberships
            | MigrationEntity::Packages
    ) {
        decisions.insert(0, MigrationDuplicateDecision::Merge);
    }
    if entity == MigrationEntity::Clients {
        decisions.insert(1, MigrationDuplicateDecision::Keep);
    }
    decisions
}

fn duplicate_signals(
    entity: MigrationEntity,
    payload: &Map<String, Value>,
    external_id: &str,
) -> Vec<MigrationDuplicateSignal> {
    let fields: &[(&str, &str)] = match entity {
        MigrationEntity::Clients => &[("normalized_phone", "normalized_phone"), ("email", "email")],
        MigrationEntity::Staff => &[("employee_code", "employee_code"), ("email", "email")],
        MigrationEntity::Products => &[("sku", "sku"), ("barcode", "barcode")],
        MigrationEntity::Invoices | MigrationEntity::Sales => {
            &[("invoice_number", "invoice_number")]
        }
        MigrationEntity::GiftCards => &[("gift_card_code", "code"), ("code", "code")],
        MigrationEntity::ClientMemberships => &[],
        MigrationEntity::Payroll => &[("period_start", "payroll_period"), ("staff_id", "staff_id")],
        MigrationEntity::PurchaseBills => &[
            ("supplier_gstin", "supplier_gstin"),
            ("invoice_number", "invoice_number"),
        ],
        _ => &[],
    };
    let mut signals = fields
        .iter()
        .filter_map(|(field, kind)| {
            let value = payload.get(*field)?.as_str()?.trim();
            (!value.is_empty()).then(|| MigrationDuplicateSignal {
                kind: (*kind).to_string(),
                normalized_value: value.to_ascii_lowercase(),
            })
        })
        .collect::<Vec<_>>();
    let composite_fields: &[&str] = match entity {
        MigrationEntity::ClientMemberships => &["client_id", "membership_id", "assigned_at"],
        MigrationEntity::Appointments => &["client_id", "staff_id", "start_at"],
        MigrationEntity::Payments => &["sale_id", "payment_method", "method_reference"],
        MigrationEntity::Refunds => &["sale_id", "payment_method"],
        MigrationEntity::Loyalty => &["client_id", "source_sale_id", "transaction_type"],
        MigrationEntity::Payroll => &["period_start", "staff_id"],
        MigrationEntity::Commissions => &["sale_line_id", "staff_id"],
        MigrationEntity::PurchaseBills => &["supplier_gstin", "invoice_number"],
        MigrationEntity::StockMovements => &["inventory_item_id", "occurred_at"],
        MigrationEntity::OpeningPayables => &["supplier_id", "balance_side"],
        _ => &[],
    };
    let composite = composite_fields
        .iter()
        .filter_map(|field| {
            payload
                .get(*field)?
                .as_str()
                .filter(|value| !value.trim().is_empty())
        })
        .map(|value| value.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    if composite.len() >= 2 {
        signals.push(MigrationDuplicateSignal {
            kind: "composite_business_key".into(),
            normalized_value: composite.join(":"),
        });
    }
    if !external_id.trim().is_empty() {
        signals.push(MigrationDuplicateSignal {
            kind: if entity == MigrationEntity::ClientMemberships {
                "membership_number"
            } else {
                "external_provider_id"
            }
            .into(),
            normalized_value: external_id.trim().to_ascii_lowercase(),
        });
    }
    signals
}

fn build_duplicate_preview(
    entity: MigrationEntity,
    decision: Option<MigrationDuplicateDecision>,
    existing: Value,
    incoming: &Map<String, Value>,
    dependent_records: Value,
) -> MigrationDuplicatePreview {
    let incoming_value = Value::Object(
        incoming
            .iter()
            .filter(|(key, _)| {
                !key.starts_with("__")
                    && !matches!(
                        key.as_str(),
                        "source_row_number"
                            | "source_external_id"
                            | "duplicate_target_id"
                            | "duplicate_decision"
                    )
            })
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    );
    let mut final_value = existing.clone();
    let mut changed = Vec::new();
    if decision == Some(MigrationDuplicateDecision::Keep) {
        final_value = incoming_value.clone();
        changed = incoming_value
            .as_object()
            .into_iter()
            .flatten()
            .map(|(key, _)| key.clone())
            .collect();
    } else if decision == Some(MigrationDuplicateDecision::Merge) {
        let final_object = final_value.as_object_mut();
        if let Some(final_object) = final_object {
            for (key, value) in incoming_value.as_object().into_iter().flatten() {
                let client_fillable = matches!(
                    key.as_str(),
                    "code"
                        | "first_name"
                        | "last_name"
                        | "email"
                        | "membership_label"
                        | "categories_json"
                        | "birthday"
                        | "anniversary"
                        | "notes"
                );
                let should_change = entity != MigrationEntity::Clients
                    || (client_fillable
                        && final_object.get(key).is_none_or(|existing_value| {
                            existing_value.is_null()
                                || existing_value.as_str().is_some_and(str::is_empty)
                                || existing_value.as_array().is_some_and(Vec::is_empty)
                        }));
                if should_change && final_object.get(key) != Some(value) {
                    final_object.insert(key.clone(), value.clone());
                    changed.push(key.clone());
                }
            }
        }
    }
    MigrationDuplicatePreview {
        existing_value: existing,
        incoming_value,
        final_value,
        fields_that_will_change: changed,
        dependent_records,
    }
}

fn source_value_evidence(headers: &[String], row: &[String]) -> Value {
    Value::Object(
        headers
            .iter()
            .enumerate()
            .map(|(index, header)| {
                (
                    header.clone(),
                    Value::String(row.get(index).cloned().unwrap_or_default()),
                )
            })
            .collect(),
    )
}

fn wrong_column_issues(
    entity: MigrationEntity,
    provider: MigrationProvider,
    source_field: &str,
    target: &ColumnContract,
    value: &str,
) -> Vec<MigrationRowIssue> {
    if is_controlled_empty(value) {
        return Vec::new();
    }
    let target_metadata = field_metadata(entity, target);
    let suggested = {
        let candidates = fixed_alias_candidates(entity, provider, &clean_key(source_field));
        (candidates.len() == 1)
            .then(|| candidates[0].field)
            .filter(|field| *field != target.field)
    };
    let contextual_issue = |code: &str, pattern: &str, suggested_target: Option<&str>| {
        let mut result = issue(
            code,
            &format!(
                "{} value pattern is incompatible with CRM field {}",
                pattern, target.field
            ),
        );
        result.source_field = Some(source_field.to_string());
        result.value_pattern = Some(pattern.to_string());
        result.suggested_target = suggested_target.map(ToString::to_string);
        result
    };
    let mut issues = Vec::new();

    if target_metadata.data_type == "email" && transform_phone(value).is_ok() {
        issues.push(contextual_issue(
            "PHONE_VALUE_IN_EMAIL_FIELD",
            "phone",
            contracts(entity)
                .iter()
                .find(|column| field_metadata(entity, column).data_type == "phone")
                .map(|column| column.field),
        ));
    } else if target_metadata.data_type == "phone" && looks_like_email(value) {
        issues.push(contextual_issue(
            "EMAIL_VALUE_IN_PHONE_FIELD",
            "email",
            contracts(entity)
                .iter()
                .find(|column| field_metadata(entity, column).data_type == "email")
                .map(|column| column.field),
        ));
    }
    let source_key = clean_key(source_field);
    if target.field == "status"
        && matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "true" | "false" | "yes" | "no" | "1" | "0"
        )
        && matches!(
            source_key.as_str(),
            "active" | "isactive" | "enabled" | "isenabled"
        )
    {
        issues.push(contextual_issue(
            "BOOLEAN_VALUE_IN_STATUS_FIELD",
            "boolean",
            contracts(entity)
                .iter()
                .find(|column| field_metadata(entity, column).data_type == "boolean")
                .map(|column| column.field)
                .or(Some("__ignore")),
        ));
    }

    if let Some(suggested_field) = suggested {
        let suggested_column = contracts(entity)
            .iter()
            .find(|column| column.field == suggested_field)
            .expect("fixed alias target belongs to the entity contract");
        let suggested_metadata = field_metadata(entity, suggested_column);
        let semantic = match (suggested_field, target.field) {
            ("sku", "barcode") => Some(("PRODUCT_SKU_IN_BARCODE_FIELD", "sku")),
            ("barcode", "sku") => Some(("PRODUCT_BARCODE_IN_SKU_FIELD", "barcode")),
            ("invoice" | "invoiceNumber", "reference") => Some((
                "INVOICE_NUMBER_IN_PAYMENT_REFERENCE_FIELD",
                "invoice_reference",
            )),
            _ if suggested_metadata.reference_entity.is_some()
                && target_metadata.reference_entity.is_some()
                && suggested_metadata.reference_entity != target_metadata.reference_entity =>
            {
                Some(("REFERENCE_ENTITY_MISMATCH", "foreign_reference"))
            }
            _ if matches!(suggested_metadata.data_type, "date" | "datetime")
                && target_metadata.data_type == "string"
                && parse_migration_date(value).is_ok() =>
            {
                Some(("DATE_VALUE_IN_TEXT_FIELD", "date"))
            }
            _ if suggested_metadata.data_type == "money"
                && matches!(target.field, "quantity" | "quantityDelta" | "openingStock")
                && transform_money(value, false, true).is_ok() =>
            {
                Some(("MONEY_VALUE_IN_QUANTITY_FIELD", "money"))
            }
            _ if suggested_metadata.data_type == "boolean" && target.field == "status" => {
                Some(("BOOLEAN_VALUE_IN_STATUS_FIELD", "boolean"))
            }
            _ => None,
        };
        if let Some((code, pattern)) = semantic {
            issues.push(contextual_issue(code, pattern, Some(suggested_field)));
        }
    }

    if let Some(maximum) = target_metadata
        .max_length
        .filter(|maximum| value.chars().count() > *maximum)
    {
        let mut length_issue = contextual_issue(
            "MAX_LENGTH_EXCEEDED",
            "text_over_max_length",
            Some(target.field),
        );
        length_issue.message = format!("{} exceeds maximum length {}", target.field, maximum);
        issues.push(length_issue);
    }
    issues
}

fn looks_like_email(value: &str) -> bool {
    let Some((local, domain)) = value.trim().split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !value.chars().any(char::is_whitespace)
}

fn transform_mapped_row(
    entity: MigrationEntity,
    provider: MigrationProvider,
    headers: &[String],
    row: &[String],
    indexes: &HashMap<&'static str, usize>,
    original_headers: Option<&[String]>,
    original_row: Option<&[String]>,
) -> TransformedMigrationRow {
    let mut transformed_row = row.to_vec();
    let mut fields = Vec::new();
    let mut row_errors = Vec::new();
    let mut row_warnings = Vec::new();
    for column in contracts(entity) {
        let Some(index) = indexes.get(column.field).copied() else {
            continue;
        };
        let engine_input = row.get(index).cloned().unwrap_or_default();
        let original_value = original_row
            .and_then(|source| source.get(index))
            .cloned()
            .unwrap_or_else(|| engine_input.clone());
        let source_field = original_headers
            .and_then(|source| source.get(index))
            .or_else(|| headers.get(index))
            .cloned()
            .unwrap_or_default();
        let metadata = field_metadata(entity, column);
        let mut warnings = Vec::new();
        let mut errors =
            wrong_column_issues(entity, provider, &source_field, column, &engine_input);
        let mut phone_extension = None;
        let mut source_timezone = None;
        let transformed = if column.field == "gender" {
            transform_gender(&engine_input)
        } else if is_controlled_empty(&engine_input) {
            if column.required {
                errors.push(issue(
                    "REQUIRED_FIELD_EMPTY",
                    &format!(
                        "{} is required and cannot use an empty marker",
                        column.field
                    ),
                ));
            }
            Ok(String::new())
        } else {
            match metadata.data_type {
                "phone" => transform_phone(&engine_input).map(|(value, extension)| {
                    phone_extension = extension;
                    value
                }),
                "money" => transform_money(
                    &engine_input,
                    headers
                        .get(index)
                        .is_some_and(|header| clean_key(header).contains("paise"))
                        || (provider != MigrationProvider::Auto && engine_input != original_value),
                    entity == MigrationEntity::Payroll && column.field == "adjustmentPaise",
                ),
                "date" => transform_date(&engine_input).map(|(value, mut date_warnings)| {
                    warnings.append(&mut date_warnings);
                    value
                }),
                "datetime" => {
                    transform_datetime(&engine_input).map(|(value, timezone, mut date_warnings)| {
                        source_timezone = timezone;
                        warnings.append(&mut date_warnings);
                        value
                    })
                }
                "boolean" => transform_boolean(&engine_input),
                "email" => Ok(engine_input.trim().to_ascii_lowercase()),
                _ if column.field == "status" => {
                    transform_status(entity, &engine_input, metadata.allowed_values)
                }
                _ => Ok(engine_input.trim().to_string()),
            }
        };
        let transformed_value = match transformed {
            Ok(value) => {
                if let Some(target) = transformed_row.get_mut(index) {
                    *target = value.clone();
                }
                Some(value)
            }
            Err(error) => {
                errors.push(error);
                None
            }
        };
        row_errors.extend(errors.iter().cloned());
        row_warnings.extend(warnings.iter().cloned());
        fields.push(MigrationValueTransformation {
            source_field,
            target_field: column.field.to_string(),
            original_value,
            transformer: metadata.transformation_rule.to_string(),
            transformer_version: MIGRATION_TRANSFORMER_VERSION,
            transformed_value,
            phone_extension,
            source_timezone,
            warnings,
            errors,
        });
    }
    TransformedMigrationRow {
        row: transformed_row,
        fields,
        errors: row_errors,
        warnings: row_warnings,
    }
}

fn is_controlled_empty(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "" | "null" | "n/a" | "na" | "-" | "not available"
    )
}

fn transform_phone(value: &str) -> Result<(String, Option<String>), MigrationRowIssue> {
    if looks_like_scientific_notation(value) {
        return Err(issue(
            "PHONE_SCIENTIFIC_NOTATION",
            "phone in scientific notation is unsafe; export it as text",
        ));
    }
    let (phone, extension) = split_phone_extension(value)?;
    if phone.chars().any(char::is_alphabetic) {
        return Err(issue("INVALID_PHONE", "phone contains invalid letters"));
    }
    client_service::normalize_phone(phone)
        .map(|normalized| (normalized, extension))
        .map_err(|_| issue("INVALID_PHONE", "phone length or country code is invalid"))
}

fn split_phone_extension(value: &str) -> Result<(&str, Option<String>), MigrationRowIssue> {
    let lower = value.to_ascii_lowercase();
    for marker in [" extension ", " ext. ", " ext ", "x"] {
        let Some(position) = lower.rfind(marker) else {
            continue;
        };
        let suffix = value[position + marker.len()..].trim();
        if suffix.is_empty() || suffix.len() > 8 || !suffix.chars().all(|c| c.is_ascii_digit()) {
            return Err(issue(
                "INVALID_PHONE_EXTENSION",
                "phone extension must contain 1 to 8 digits",
            ));
        }
        return Ok((value[..position].trim(), Some(suffix.to_string())));
    }
    Ok((value.trim(), None))
}

fn transform_money(
    value: &str,
    value_is_paise: bool,
    allow_negative: bool,
) -> Result<String, MigrationRowIssue> {
    let value = value.trim();
    if looks_like_scientific_notation(value) {
        return Err(issue(
            "MONEY_SCIENTIFIC_NOTATION",
            "money in scientific notation is unsafe",
        ));
    }
    let plain_integer = value
        .trim_start_matches(['+', '-'])
        .chars()
        .all(|character| character.is_ascii_digit());
    let amount = if value_is_paise && plain_integer {
        value.parse::<i64>().map_err(|_| {
            issue(
                "MONEY_OVERFLOW",
                "money exceeds the supported integer range",
            )
        })?
    } else {
        major_money_to_paise(value)?
    };
    if amount < 0 && !allow_negative {
        return Err(issue(
            "NEGATIVE_MONEY_NOT_ALLOWED",
            "negative money is not allowed for this CRM field",
        ));
    }
    Ok(amount.to_string())
}

fn looks_like_scientific_notation(value: &str) -> bool {
    let Some(position) = value.rfind(['e', 'E']) else {
        return false;
    };
    let (left, right) = value.split_at(position);
    let exponent = right[1..].trim().trim_start_matches(['+', '-']);
    left.chars().any(|character| character.is_ascii_digit())
        && !exponent.is_empty()
        && exponent.chars().all(|character| character.is_ascii_digit())
}

fn major_money_to_paise(value: &str) -> Result<i64, MigrationRowIssue> {
    let mut value = value.trim();
    let mut negative = false;
    if let Some(rest) = value.strip_prefix('-') {
        negative = true;
        value = rest.trim();
    } else if let Some(rest) = value.strip_prefix('+') {
        value = rest.trim();
    }
    if let Some(rest) = value.strip_prefix('₹') {
        value = rest.trim();
    } else {
        let lower = value.to_ascii_lowercase();
        let currency_prefix = ["inr", "rs.", "rs"]
            .into_iter()
            .find(|prefix| lower.starts_with(prefix));
        if let Some(prefix) = currency_prefix {
            value = value[prefix.len()..].trim();
        }
    }
    if let Some(rest) = value.strip_prefix('-') {
        negative = true;
        value = rest.trim();
    }
    if value.chars().any(char::is_alphabetic)
        || value.chars().any(|c| matches!(c, '$' | '€' | '£' | '¥'))
    {
        return Err(issue(
            "UNSUPPORTED_CURRENCY",
            "only INR or currency-free values can be imported automatically",
        ));
    }
    let normalized = value.replace(',', "");
    let mut parts = normalized.split('.');
    let whole = parts
        .next()
        .filter(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        .ok_or_else(|| issue("INVALID_MONEY", "money value is invalid"))?;
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some() || fraction.len() > 2 || !fraction.chars().all(|c| c.is_ascii_digit())
    {
        return Err(issue(
            "MONEY_PRECISION_REQUIRES_APPROVAL",
            "money supports at most two decimals; implicit rounding is disabled",
        ));
    }
    let whole = whole.parse::<i64>().map_err(|_| {
        issue(
            "MONEY_OVERFLOW",
            "money exceeds the supported integer range",
        )
    })?;
    let fraction = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<i64>().unwrap_or(0) * 10,
        _ => fraction.parse::<i64>().unwrap_or(0),
    };
    let paise = whole
        .checked_mul(100)
        .and_then(|whole| whole.checked_add(fraction))
        .ok_or_else(|| {
            issue(
                "MONEY_OVERFLOW",
                "money exceeds the supported integer range",
            )
        })?;
    Ok(if negative { -paise } else { paise })
}

fn transform_date(value: &str) -> Result<(String, Vec<MigrationRowIssue>), MigrationRowIssue> {
    let (date, warnings) = parse_migration_date(value)?;
    Ok((date.to_string(), warnings))
}

fn parse_migration_date(
    value: &str,
) -> Result<(NaiveDate, Vec<MigrationRowIssue>), MigrationRowIssue> {
    let value = value.trim();
    for format in ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"] {
        if let Ok(date) = NaiveDate::parse_from_str(value, format) {
            let mut warnings = Vec::new();
            if !format.starts_with("%Y") && date.day() <= 12 && date.month() <= 12 {
                warnings.push(issue(
                    "AMBIGUOUS_DATE_INTERPRETED_DMY",
                    "ambiguous date was interpreted as DD/MM/YYYY",
                ));
            }
            return Ok((date, warnings));
        }
    }
    if let Some((date, _)) = parse_excel_serial(value) {
        return Ok((
            date,
            vec![issue(
                "EXCEL_SERIAL_DATE",
                "Excel serial date was converted",
            )],
        ));
    }
    Err(issue("INVALID_DATE", "date is impossible or unsupported"))
}

fn transform_datetime(
    value: &str,
) -> Result<(String, Option<String>, Vec<MigrationRowIssue>), MigrationRowIssue> {
    let value = value.trim();
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Ok((
            parsed.with_timezone(&Utc).to_rfc3339(),
            Some(parsed.offset().to_string()),
            Vec::new(),
        ));
    }
    let india = FixedOffset::east_opt(5 * 3600 + 30 * 60).expect("valid India offset");
    for format in [
        "%d/%m/%Y %H:%M:%S",
        "%d-%m-%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(datetime) = NaiveDateTime::parse_from_str(value, format) {
            let local = india
                .from_local_datetime(&datetime)
                .single()
                .ok_or_else(|| issue("INVALID_DATETIME", "datetime is invalid"))?;
            let mut warnings = Vec::new();
            if !format.starts_with("%Y") && datetime.day() <= 12 && datetime.month() <= 12 {
                warnings.push(issue(
                    "AMBIGUOUS_DATE_INTERPRETED_DMY",
                    "ambiguous date was interpreted as DD/MM/YYYY",
                ));
            }
            return Ok((
                local.with_timezone(&Utc).to_rfc3339(),
                Some("+05:30".to_string()),
                warnings,
            ));
        }
    }
    if let Some((date, seconds)) = parse_excel_serial(value) {
        let datetime = date
            .and_hms_opt(seconds / 3600, (seconds % 3600) / 60, seconds % 60)
            .ok_or_else(|| issue("INVALID_DATETIME", "Excel datetime is invalid"))?;
        let local = india
            .from_local_datetime(&datetime)
            .single()
            .ok_or_else(|| issue("INVALID_DATETIME", "datetime is invalid"))?;
        return Ok((
            local.with_timezone(&Utc).to_rfc3339(),
            Some("+05:30".to_string()),
            vec![issue(
                "EXCEL_SERIAL_DATE",
                "Excel serial datetime was converted",
            )],
        ));
    }
    let (date, warnings) = parse_migration_date(value)?;
    let local = india
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).expect("midnight is valid"))
        .single()
        .expect("fixed offset has one local datetime");
    Ok((
        local.with_timezone(&Utc).to_rfc3339(),
        Some("+05:30".to_string()),
        warnings,
    ))
}

fn parse_excel_serial(value: &str) -> Option<(NaiveDate, u32)> {
    let (days, fraction) = value.split_once('.').unwrap_or((value, ""));
    if days.is_empty()
        || !days.chars().all(|c| c.is_ascii_digit())
        || !fraction.chars().all(|c| c.is_ascii_digit())
        || fraction.len() > 9
    {
        return None;
    }
    let days = days.parse::<i64>().ok()?;
    if !(1..=200_000).contains(&days) {
        return None;
    }
    let seconds = if fraction.is_empty() {
        0
    } else {
        let denominator = 10_u64.checked_pow(fraction.len() as u32)?;
        ((fraction.parse::<u64>().ok()?.checked_mul(86_400)? / denominator).min(86_399)) as u32
    };
    let date =
        NaiveDate::from_ymd_opt(1899, 12, 30)?.checked_add_signed(chrono::Duration::days(days))?;
    Some((date, seconds))
}

fn transform_boolean(value: &str) -> Result<String, MigrationRowIssue> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "yes" | "1" | "active" | "a" => Ok("true".to_string()),
        "false" | "no" | "0" | "inactive" | "i" => Ok("false".to_string()),
        _ => Err(issue(
            "INVALID_BOOLEAN",
            "value must be Yes/No, Active/Inactive, 1/0",
        )),
    }
}

fn transform_status(
    entity: MigrationEntity,
    value: &str,
    allowed_values: &[&str],
) -> Result<String, MigrationRowIssue> {
    let source = value.trim().to_ascii_lowercase();
    let canonical = match source.as_str() {
        "active" | "a" | "yes" | "1" => "active",
        "inactive" | "i" | "no" | "0" => "inactive",
        "done" | "complete" | "closed" => "completed",
        "ns" | "no show" | "no_show" | "no-show" => "no_show",
        "canceled" | "cancelled" => "cancelled",
        _ => source.as_str(),
    };
    let crm_value = if entity == MigrationEntity::Appointments && canonical == "no_show" {
        "no-show"
    } else {
        canonical
    };
    let allowed = if allowed_values.is_empty() && entity == MigrationEntity::Invoices {
        matches!(
            crm_value,
            "open" | "partial" | "paid" | "void" | "cancelled" | "overdue"
        )
    } else {
        allowed_values.contains(&crm_value)
    };
    if allowed {
        Ok(crm_value.to_string())
    } else {
        Err(issue(
            "UNKNOWN_STATUS_APPROVAL_REQUIRED",
            "unknown status cannot be imported without an approved mapping",
        ))
    }
}

fn transform_gender(value: &str) -> Result<String, MigrationRowIssue> {
    if is_controlled_empty(value) {
        return Ok("unspecified".to_string());
    }
    match value.trim().to_lowercase().as_str() {
        "m" | "male" | "पुरुष" => Ok("male".to_string()),
        "f" | "female" | "महिला" => Ok("female".to_string()),
        "o" | "other" => Ok("other".to_string()),
        _ => Err(issue(
            "UNKNOWN_GENDER",
            "gender was not guessed; use male, female, other or blank",
        )),
    }
}

fn issue(code: &str, message: &str) -> MigrationRowIssue {
    MigrationRowIssue {
        code: code.to_string(),
        message: message.to_string(),
        row_number: None,
        source_field: None,
        value_pattern: None,
        suggested_target: None,
    }
}

fn dedupe_issues(issues: &mut Vec<MigrationRowIssue>) {
    let mut seen = HashSet::new();
    issues.retain(|issue| seen.insert((issue.code.clone(), issue.message.clone())));
}

fn parse_optional_date(
    value: &str,
    errors: &mut Vec<MigrationRowIssue>,
    field: &str,
) -> Option<NaiveDate> {
    if value.is_empty() {
        return None;
    }
    for format in [
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(date) = NaiveDate::parse_from_str(value, format) {
            return Some(date);
        }
    }
    if let Ok(serial) = value.parse::<i64>() {
        if (1..=200_000).contains(&serial) {
            return NaiveDate::from_ymd_opt(1899, 12, 30)
                .and_then(|origin| origin.checked_add_signed(chrono::Duration::days(serial)));
        }
    }
    push_issue(
        errors,
        "INVALID_DATE",
        &format!("{field} must be a supported date value"),
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

fn parse_fixed_stock_quantity(
    value: &str,
    multiplier: i32,
    field: &str,
    required: bool,
    errors: &mut Vec<MigrationRowIssue>,
) -> i32 {
    let value = value.trim();
    if value.is_empty() {
        if required {
            push_issue(errors, "REQUIRED_FIELD", &format!("{field} is required"));
        }
        return 0;
    }
    let (negative, unsigned) = value
        .strip_prefix('-')
        .map_or((false, value), |value| (true, value));
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.len() > 9
    {
        push_issue(
            errors,
            "INVALID_FIXED_QUANTITY",
            &format!("{field} must be a plain decimal quantity"),
        );
        return 0;
    }
    let scale = 10_i64.pow(fraction.len() as u32);
    let whole = whole.parse::<i64>().ok();
    let fraction = if fraction.is_empty() {
        Some(0)
    } else {
        fraction.parse::<i64>().ok()
    };
    let converted = whole
        .zip(fraction)
        .and_then(|(whole, fraction)| whole.checked_mul(scale)?.checked_add(fraction))
        .and_then(|quantity| quantity.checked_mul(i64::from(multiplier)));
    let Some(converted) = converted.filter(|quantity| quantity % scale == 0) else {
        push_issue(
            errors,
            "NON_CONVERTIBLE_FRACTIONAL_QUANTITY",
            &format!("{field} cannot be converted to an exact base-stock integer"),
        );
        return 0;
    };
    let signed = if negative {
        converted.checked_neg()
    } else {
        Some(converted)
    };
    match signed.and_then(|quantity| i32::try_from(quantity / scale).ok()) {
        Some(quantity) => quantity,
        None => {
            push_issue(
                errors,
                "STOCK_QUANTITY_OVERFLOW",
                &format!("{field} is outside the supported stock range"),
            );
            0
        }
    }
}

fn opening_valuation_paise(quantity: i32, approved_unit_cost_paise: i64) -> Option<i64> {
    i64::from(quantity).checked_mul(approved_unit_cost_paise)
}

fn available_classification_total(classifications: &serde_json::Map<String, Value>) -> Option<i64> {
    classifications
        .get("sellable")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .checked_add(
            classifications
                .get("backbar")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        )
}

fn rounded_unit_cost_from_valuation(valuation_paise: i64, quantity: i32) -> Option<i64> {
    let quantity = i64::from(quantity);
    if quantity == 0 {
        return None;
    }
    let quotient = valuation_paise.checked_div(quantity)?;
    let remainder = valuation_paise.checked_rem(quantity)?;
    let rounds_away = remainder.abs().checked_mul(2)? >= quantity.abs();
    if rounds_away {
        quotient.checked_add(if valuation_paise.signum() == quantity.signum() {
            1
        } else {
            -1
        })
    } else {
        Some(quotient)
    }
}

fn parse_snapshot_batches(
    value: &str,
    multiplier: i32,
    errors: &mut Vec<MigrationRowIssue>,
) -> (Value, i32) {
    if value.trim().is_empty() {
        return (json!([]), 0);
    }
    let Ok(rows) = serde_json::from_str::<Value>(value) else {
        push_issue(
            errors,
            "INVALID_BATCH_JSON",
            "batchesJson must be a JSON array",
        );
        return (json!([]), 0);
    };
    let Some(rows) = rows.as_array() else {
        push_issue(
            errors,
            "INVALID_BATCH_JSON",
            "batchesJson must be a JSON array",
        );
        return (json!([]), 0);
    };
    let mut seen = HashSet::new();
    let mut total = 0_i32;
    let mut normalized = Vec::with_capacity(rows.len());
    for row in rows {
        let batch_number = row
            .get("batchNumber")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if batch_number.is_empty() || !seen.insert(batch_number.to_ascii_lowercase()) {
            push_issue(
                errors,
                "INVALID_OR_DUPLICATE_BATCH",
                "each batch requires a unique batchNumber",
            );
            continue;
        }
        let quantity_value = row
            .get("quantity")
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string())
            })
            .unwrap_or_default();
        let quantity =
            parse_fixed_stock_quantity(&quantity_value, multiplier, "batch quantity", true, errors);
        if quantity < 0 {
            push_issue(
                errors,
                "NEGATIVE_BATCH_QUANTITY",
                "batch quantity cannot be negative",
            );
        }
        let expiry_date = row
            .get("expiryDate")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if !expiry_date.is_empty() && NaiveDate::parse_from_str(expiry_date, "%Y-%m-%d").is_err() {
            push_issue(
                errors,
                "INVALID_BATCH_EXPIRY",
                "batch expiryDate must use YYYY-MM-DD",
            );
        }
        total = total.checked_add(quantity).unwrap_or_else(|| {
            push_issue(
                errors,
                "STOCK_QUANTITY_OVERFLOW",
                "batch quantity total is outside the supported stock range",
            );
            0
        });
        normalized.push(json!({
            "batchNumber": batch_number,
            "quantity": quantity,
            "expiryDate": expiry_date
        }));
    }
    (Value::Array(normalized), total)
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
    issues.push(issue(code, message));
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

    #[test]
    fn opening_snapshot_quantity_conversion_is_exact() {
        let mut errors = Vec::new();
        assert_eq!(
            parse_fixed_stock_quantity("0.5", 10, "quantity", true, &mut errors),
            5
        );
        assert!(errors.is_empty());

        assert_eq!(
            parse_fixed_stock_quantity("0.5", 1, "quantity", true, &mut errors),
            0
        );
        assert_eq!(
            errors.last().map(|issue| issue.code.as_str()),
            Some("NON_CONVERTIBLE_FRACTIONAL_QUANTITY")
        );
        assert!(contracts(MigrationEntity::Inventory)
            .iter()
            .any(|column| column.field == "countedBy" && column.required));
        assert_eq!(
            available_classification_total(&serde_json::Map::from_iter([
                ("sellable".into(), json!(7)),
                ("backbar".into(), json!(3)),
                ("damaged".into(), json!(50)),
            ])),
            Some(10)
        );
    }

    #[test]
    fn historical_purchase_text_blocks_spreadsheet_formulas() {
        assert!(is_spreadsheet_formula("=HYPERLINK(\"bad\")"));
        assert!(is_spreadsheet_formula("@SUM(A1:A2)"));
        assert!(is_spreadsheet_formula("-cmd"));
        assert!(!is_spreadsheet_formula("-1250.50"));
        assert!(!is_spreadsheet_formula("BATCH-01"));
    }

    #[test]
    fn duplicate_actions_block_unsafe_financial_mutation() {
        assert_eq!(
            allowed_duplicate_decisions(MigrationEntity::Payments),
            vec![
                MigrationDuplicateDecision::Link,
                MigrationDuplicateDecision::Reject
            ]
        );
        assert_eq!(
            allowed_duplicate_decisions(MigrationEntity::Clients),
            vec![
                MigrationDuplicateDecision::Merge,
                MigrationDuplicateDecision::Keep,
                MigrationDuplicateDecision::Link,
                MigrationDuplicateDecision::Reject
            ]
        );
    }
    use sqlx::PgPool;

    #[test]
    fn client_template_auto_maps_legacy_aliases() {
        let headers = vec![
            "Customer Name".into(),
            "Mobile Number".into(),
            "Old ID".into(),
        ];
        let (mapping, indexes, unmatched) = resolve_mapping(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &headers,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(mapping["Customer Name"], "firstName");
        assert_eq!(indexes["phone"], 1);
        assert!(unmatched.is_empty());
    }

    #[test]
    fn phase_two_alias_layers_block_ambiguity_and_target_collisions() {
        let contact = vec!["Contact".to_string()];
        let ambiguous = resolve_mapping_detailed(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &contact,
            &BTreeMap::new(),
            &[],
        )
        .unwrap();
        assert!(ambiguous.mapping.is_empty());
        assert_eq!(ambiguous.decisions[0].confidence, "yellow");
        assert_eq!(ambiguous.decisions[0].candidates, vec!["email", "phone"]);
        assert!(!ambiguous.blocking_reasons.is_empty());

        let approved = MigrationAlias {
            id: "alias-1".into(),
            entity: MigrationEntity::Clients,
            source_provider: MigrationProvider::Auto,
            alias: "Contact".into(),
            target_field: "phone".into(),
            created_by: "owner-1".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let tenant = resolve_mapping_detailed(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &contact,
            &BTreeMap::new(),
            &[approved],
        )
        .unwrap();
        assert_eq!(tenant.mapping["Contact"], "phone");
        assert_eq!(tenant.decisions[0].alias_level, "tenant_approved");

        let duplicate_phone = vec!["Phone".into(), "Mobile".into()];
        let collision = resolve_mapping_detailed(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &duplicate_phone,
            &BTreeMap::new(),
            &[],
        )
        .unwrap();
        assert!(collision.mapping.is_empty());
        assert!(collision
            .decisions
            .iter()
            .all(|decision| decision.collision));
        assert!(!collision.blocking_reasons.is_empty());
    }

    #[test]
    fn phase_two_provider_aliases_never_hide_fixed_conflicts() {
        for rule in PROVIDER_ALIAS_RULES {
            let candidates =
                fixed_alias_candidates(rule.entity, rule.provider, &clean_key(rule.alias));
            assert!(
                candidates
                    .iter()
                    .all(|candidate| candidate.field == rule.target),
                "{} {} conflicts with the fixed registry",
                rule.provider,
                rule.alias
            );
        }
        assert!(validate_tenant_alias(MigrationEntity::Clients, "phone", "email").is_err());
    }

    #[test]
    fn phase_three_confidence_is_reproducible_explained_and_validates_manual_mapping() {
        let csv = "Customer Name,Customer Contact,Email\nAsha,9876543210,asha@example.test\nRavi,9123456789,ravi@example.test";
        let (headers, profiles, row_count) =
            crate::services::migration_file_service::profile_csv_mapping_evidence(
                csv,
                MigrationEntity::Clients,
            )
            .unwrap();
        let first = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Dingg,
            &headers,
            &BTreeMap::new(),
            &[],
            &profiles,
            row_count,
        )
        .unwrap();
        let second = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Dingg,
            &headers,
            &BTreeMap::new(),
            &[],
            &profiles,
            row_count,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&first.decisions).unwrap(),
            serde_json::to_value(&second.decisions).unwrap()
        );
        let contact = first
            .decisions
            .iter()
            .find(|decision| decision.source_column == "Customer Contact")
            .unwrap();
        assert_eq!(contact.target_field.as_deref(), Some("phone"));
        assert_eq!(contact.confidence, "green");
        assert!(contact.confidence_percentage >= 90);
        assert_eq!(contact.detected_data_type, "phone");
        assert_eq!(
            contact.required_transformation.as_deref(),
            Some("phone_e164")
        );
        assert!(contact
            .suggestion_reasons
            .iter()
            .any(|reason| reason.contains("phone pattern")));
        assert!(contact
            .sample_evidence
            .iter()
            .all(|value| value.contains('*')));
        assert!(contact
            .alternative_targets
            .iter()
            .any(|alternative| alternative.target_field == "email"
                && !alternative.rejection_reasons.is_empty()));

        let invalid_manual = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Dingg,
            &headers,
            &BTreeMap::from([("Customer Contact".into(), "email".into())]),
            &[],
            &profiles,
            row_count,
        )
        .unwrap();
        assert!(!invalid_manual.blocking_reasons.is_empty());
        assert!(!invalid_manual.mapping.contains_key("Customer Contact"));
    }

    #[test]
    fn phase_three_ambiguous_header_never_auto_maps_without_value_evidence() {
        let result = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &["Contact".into()],
            &BTreeMap::new(),
            &[],
            &[],
            0,
        )
        .unwrap();
        assert!(result.mapping.is_empty());
        assert!(!result.blocking_reasons.is_empty());
        assert_ne!(result.decisions[0].confidence, "green");
    }

    #[test]
    fn phase_four_governance_enforces_thresholds_and_non_bypassable_type_failures() {
        let csv =
            "Customer Name,Mobile No,DOB\nAsha,9876543210,01/02/2026\nRavi,9123456789,02/03/2026";
        let (headers, profiles, row_count) =
            crate::services::migration_file_service::profile_csv_mapping_evidence(
                csv,
                MigrationEntity::Clients,
            )
            .unwrap();
        let result = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &headers,
            &BTreeMap::new(),
            &[],
            &profiles,
            row_count,
        )
        .unwrap();
        let birthday = result
            .decisions
            .iter()
            .find(|decision| decision.source_column == "DOB")
            .unwrap();
        assert_eq!(birthday.confidence, "yellow");
        assert!((65..=89).contains(&birthday.confidence_percentage));
        assert!(!result.mapping.contains_key("DOB"));
        assert!(result.approval_required_reasons.contains_key("DOB"));

        let invalid = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &headers,
            &BTreeMap::from([("Mobile No".into(), "email".into())]),
            &[],
            &profiles,
            row_count,
        )
        .unwrap();
        let phone_as_email = invalid
            .decisions
            .iter()
            .find(|decision| decision.source_column == "Mobile No")
            .unwrap();
        assert_eq!(phone_as_email.confidence, "red");
        assert!(phone_as_email.confidence_percentage <= 64);
        assert!(!invalid.mapping.contains_key("Mobile No"));
        assert!(!invalid.hard_blocking_reasons.is_empty());

        let collision_csv = "Customer Name,Mobile,Phone\nAsha,9876543210,9876543210";
        let (headers, profiles, row_count) =
            crate::services::migration_file_service::profile_csv_mapping_evidence(
                collision_csv,
                MigrationEntity::Clients,
            )
            .unwrap();
        let collision = resolve_mapping_with_confidence(
            MigrationEntity::Clients,
            MigrationProvider::Auto,
            &headers,
            &BTreeMap::new(),
            &[],
            &profiles,
            row_count,
        )
        .unwrap();
        assert!(collision
            .decisions
            .iter()
            .filter(|decision| decision.collision)
            .all(|decision| decision.confidence == "red" && decision.confidence_percentage <= 64));
    }

    #[test]
    fn phase_five_transformers_are_versioned_locale_safe_and_preserve_evidence() {
        for source in ["9876543210", "09876543210", "+91 98765-43210"] {
            assert_eq!(transform_phone(source).unwrap().0, "+919876543210");
        }
        assert_eq!(
            transform_phone("9876543210 ext 123").unwrap(),
            ("+919876543210".to_string(), Some("123".to_string()))
        );
        assert!(transform_phone("9.876543210E9").is_err());

        assert_eq!(
            transform_money("₹1,250.50", false, false).unwrap(),
            "125050"
        );
        assert_eq!(transform_money("₹0.99", false, false).unwrap(), "99");
        assert_eq!(transform_money("-₹500", false, true).unwrap(), "-50000");
        assert!(transform_money("-₹500", false, false).is_err());
        assert!(transform_money("$500", false, false).is_err());
        assert!(transform_money("₹1.999", false, false).is_err());
        assert!(transform_money("999999999999999999", false, false).is_err());

        assert_eq!(transform_date("29/07/2026").unwrap().0, "2026-07-29");
        assert!(!transform_date("03/04/2026").unwrap().1.is_empty());
        assert!(transform_date("31/02/2026").is_err());
        assert!(transform_date("45872").unwrap().1[0]
            .code
            .contains("EXCEL_SERIAL"));
        let datetime = transform_datetime("29/07/2026 14:30").unwrap();
        assert_eq!(datetime.0, "2026-07-29T09:00:00+00:00");
        assert_eq!(datetime.1.as_deref(), Some("+05:30"));

        assert_eq!(
            transform_status(
                MigrationEntity::Appointments,
                "NS",
                field_metadata(
                    MigrationEntity::Appointments,
                    contracts(MigrationEntity::Appointments)
                        .iter()
                        .find(|column| column.field == "status")
                        .unwrap(),
                )
                .allowed_values,
            )
            .unwrap(),
            "no-show"
        );
        assert!(transform_status(MigrationEntity::Appointments, "unknown", &[]).is_err());
        assert_eq!(transform_gender("पुरुष").unwrap(), "male");
        assert_eq!(transform_gender("महिला").unwrap(), "female");
        assert_eq!(transform_gender("N/A").unwrap(), "unspecified");

        let headers = vec![
            "Employee Code".to_string(),
            "First Name".to_string(),
            "Mobile".to_string(),
            "Gender".to_string(),
        ];
        let row = vec![
            "NA".to_string(),
            "Aftab".to_string(),
            "+91 98765-43210".to_string(),
            "M".to_string(),
        ];
        let indexes = HashMap::from([
            ("employeeCode", 0),
            ("firstName", 1),
            ("mobilePhone", 2),
            ("gender", 3),
        ]);
        let transformed = transform_mapped_row(
            MigrationEntity::Staff,
            MigrationProvider::Auto,
            &headers,
            &row,
            &indexes,
            Some(&headers),
            Some(&row),
        );
        assert!(transformed
            .errors
            .iter()
            .any(|error| error.code == "REQUIRED_FIELD_EMPTY"));
        let phone = transformed
            .fields
            .iter()
            .find(|field| field.target_field == "mobilePhone")
            .unwrap();
        assert_eq!(phone.original_value, "+91 98765-43210");
        assert_eq!(phone.transformed_value.as_deref(), Some("+919876543210"));
        assert_eq!(phone.transformer_version, MIGRATION_TRANSFORMER_VERSION);
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
    fn dingg_normalization_converts_money_duration_and_generated_keys() {
        let services = vec![
            vec!["Service Name".into(), "Price".into(), "Timing".into()],
            vec!["Hair Cut".into(), "499.50".into(), "00:45:00".into()],
        ];
        let normalized = normalize_provider_table(
            MigrationEntity::Services,
            MigrationProvider::Dingg,
            &services,
            0,
        );
        assert_eq!(normalized[1][1], "49950");
        assert_eq!(normalized[1][2], "45");

        let staff = vec![
            vec!["Name".into(), "Mobile".into()],
            vec!["Aftab".into(), "9876543210".into()],
        ];
        let normalized =
            normalize_provider_table(MigrationEntity::Staff, MigrationProvider::Dingg, &staff, 0);
        assert!(normalized[1].last().unwrap().starts_with("DINGG-STAFF-"));

        let assignments = vec![
            vec![
                "Client Name".into(),
                "Mobile".into(),
                "MShip Type".into(),
                "PRICE PAID".into(),
                "Start Date / Sell Date".into(),
                "Balance ( if Any )".into(),
            ],
            vec![
                "Client".into(),
                "9876543210".into(),
                "Gold".into(),
                "1000".into(),
                "01/07/2026".into(),
                "250.50".into(),
            ],
        ];
        let normalized = normalize_provider_table(
            MigrationEntity::ClientMemberships,
            MigrationProvider::Dingg,
            &assignments,
            0,
        );
        assert_eq!(normalized[1][3], "100000");
        assert_eq!(normalized[1][5], "25050");
        assert!(normalized[1]
            .last()
            .unwrap()
            .starts_with("DINGG-CLIENT-MEMBERSHIPS-"));
    }

    // KNOWN FAILING — needs a product decision, not a test edit.
    //
    // `templates()` emits OpeningPayables immediately after PurchaseBills, which
    // reads naturally: opening payables are supplier balances carried in with
    // the bills. This test expects it last.
    //
    // The dependency contract in migration_repository's
    // phase_eight_dependency_rank_matches_execution_contract gives
    // OpeningPayables rank 6 — the final tier, alongside StockMovements and
    // Files — which matches this test, not `templates()`.
    //
    // One of the two is wrong, and the answer decides the order entities are
    // actually imported in. Whoever owns the migration contract should say
    // which; changing either side to force this green risks reordering a real
    // customer data import.
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
                MigrationEntity::ClientMemberships,
                MigrationEntity::Packages,
                MigrationEntity::Appointments,
                MigrationEntity::Sales,
                MigrationEntity::Invoices,
                MigrationEntity::Payments,
                MigrationEntity::Expenses,
                MigrationEntity::PurchaseBills,
                MigrationEntity::Refunds,
                MigrationEntity::GiftCards,
                MigrationEntity::Loyalty,
                MigrationEntity::Payroll,
                MigrationEntity::Commissions,
                MigrationEntity::ClientNotes,
                MigrationEntity::Files,
                MigrationEntity::StockMovements,
                MigrationEntity::OpeningPayables,
            ]
        );
        assert!(contracts(MigrationEntity::Inventory)
            .iter()
            .any(|column| column.field == "product" && column.required));
        assert!(contracts(MigrationEntity::Packages)
            .iter()
            .any(|column| column.field == "services" && column.required));
        assert!(contracts(MigrationEntity::Payments)
            .iter()
            .any(|column| column.field == "amountPaise" && column.required));
        assert!(contracts(MigrationEntity::PurchaseBills)
            .iter()
            .any(|column| column.field == "unitCostPaise" && column.required));
    }

    #[test]
    fn phase_zero_templates_publish_complete_fixed_contracts() {
        let templates = templates();
        // 24 since OpeningPayables joined the set. Where it belongs in the
        // ordering is a separate question (see
        // master_data_templates_follow_dependency_order); either answer leaves
        // the count at 24.
        assert_eq!(templates.len(), 24);
        for template in &templates {
            assert_eq!(template.contract_version, MIGRATION_CONTRACT_VERSION);
            assert!(!template.columns.is_empty());
            let mut fields = HashSet::new();
            for column in &template.columns {
                assert!(fields.insert(column.field.as_str()), "duplicate field");
                assert!(!column.data_type.is_empty());
                assert!(!column.default_behavior.is_empty());
                assert!(!column.transformation_rule.is_empty());
                assert!(!column.validation_rules.is_empty());
                assert_eq!(column.permission, "data_migration.manage");
            }
        }

        let clients = templates
            .iter()
            .find(|template| template.entity == MigrationEntity::Clients)
            .unwrap();
        let phone = clients
            .columns
            .iter()
            .find(|column| column.field == "phone")
            .unwrap();
        assert_eq!(phone.data_type, "phone");
        assert_eq!(phone.transformation_rule, "phone_e164");

        let inventory = templates
            .iter()
            .find(|template| template.entity == MigrationEntity::Inventory)
            .unwrap();
        let product = inventory
            .columns
            .iter()
            .find(|column| column.field == "product")
            .unwrap();
        assert_eq!(product.reference_entity, Some(MigrationEntity::Products));
    }

    #[sqlx::test]
    async fn analyze_reports_duplicates_without_writing_live_rows(pool: PgPool) {
        // Duplicate resolution reads across two dozen tables, far more than a
        // hand-written fixture can track; run the real schema instead.
        sqlx::query("INSERT INTO clients(id,tenant_id,branch_id,first_name,normalized_phone) VALUES('client-1','tenant-1','branch-1','Existing','+919876543210')")
            .execute(&pool).await.unwrap();
        let csv =
            "Old ID,Customer Name,Mobile,Email\nlegacy-1,Incoming,9876543210,incoming@example.test";

        let unresolved = prepare(
            &pool,
            "tenant-1",
            "branch-1",
            MigrationEntity::Clients,
            MigrationProvider::Auto,
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
            MigrationProvider::Auto,
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

    #[test]
    fn phase_six_manual_mapping_cannot_bypass_protected_field_validation() {
        let email = contracts(MigrationEntity::Clients)
            .iter()
            .find(|column| column.field == "email")
            .unwrap();
        let phone_in_email = wrong_column_issues(
            MigrationEntity::Clients,
            MigrationProvider::Dingg,
            "Customer Contact",
            email,
            "9876543210",
        );
        assert_eq!(phone_in_email[0].code, "PHONE_VALUE_IN_EMAIL_FIELD");
        assert_eq!(phone_in_email[0].value_pattern.as_deref(), Some("phone"));
        assert_eq!(phone_in_email[0].suggested_target.as_deref(), Some("phone"));

        let phone = contracts(MigrationEntity::Clients)
            .iter()
            .find(|column| column.field == "phone")
            .unwrap();
        assert_eq!(
            wrong_column_issues(
                MigrationEntity::Clients,
                MigrationProvider::Auto,
                "Customer Contact",
                phone,
                "aftab@example.com",
            )[0]
            .code,
            "EMAIL_VALUE_IN_PHONE_FIELD"
        );

        for (entity, source, target, value, code) in [
            (
                MigrationEntity::Appointments,
                "Staff ID",
                "client",
                "staff-42",
                "REFERENCE_ENTITY_MISMATCH",
            ),
            (
                MigrationEntity::Payments,
                "Invoice Number",
                "reference",
                "INV-42",
                "INVOICE_NUMBER_IN_PAYMENT_REFERENCE_FIELD",
            ),
            (
                MigrationEntity::Products,
                "SKU",
                "barcode",
                "SKU-42",
                "PRODUCT_SKU_IN_BARCODE_FIELD",
            ),
            (
                MigrationEntity::Sales,
                "Amount",
                "quantity",
                "₹1,250.50",
                "MONEY_VALUE_IN_QUANTITY_FIELD",
            ),
            (
                MigrationEntity::Appointments,
                "Appointment Date Time",
                "notes",
                "29/07/2026",
                "DATE_VALUE_IN_TEXT_FIELD",
            ),
            (
                MigrationEntity::Appointments,
                "Active",
                "status",
                "Yes",
                "BOOLEAN_VALUE_IN_STATUS_FIELD",
            ),
        ] {
            let target = contracts(entity)
                .iter()
                .find(|column| column.field == target)
                .unwrap();
            assert!(
                wrong_column_issues(entity, MigrationProvider::Auto, source, target, value,)
                    .iter()
                    .any(|issue| issue.code == code)
            );
        }

        let sku = contracts(MigrationEntity::Products)
            .iter()
            .find(|column| column.field == "sku")
            .unwrap();
        assert!(wrong_column_issues(
            MigrationEntity::Products,
            MigrationProvider::Auto,
            "SKU",
            sku,
            &"X".repeat(256),
        )
        .iter()
        .any(|issue| issue.code == "MAX_LENGTH_EXCEEDED"));
    }

    #[test]
    fn phase_seven_financial_math_and_projection_rollback_are_overflow_safe() {
        assert!(payroll_total_matches(100_000, 20_000, 80_000));
        assert!(!payroll_total_matches(10, 20, 0));
        assert!(invoice_total_matches(100_000, 10_000, 18_000, 108_000));
        assert!(!invoice_total_matches(i64::MAX, 0, 1, i64::MAX));

        let mut state = HashMap::from([
            ("refund:sale-1:card".to_string(), 60_i64),
            ("commission:line-1".to_string(), 7_500_i64),
            ("stock:item-1".to_string(), 8_i64),
        ]);
        for (entity, mut row) in [
            (
                MigrationEntity::Refunds,
                json!({"sale_id":"sale-1","payment_method":"card","amount_paise":40,"__financial_projection_applied":true}),
            ),
            (
                MigrationEntity::Commissions,
                json!({"sale_line_id":"line-1","split_bps":2500,"__financial_projection_applied":true}),
            ),
            (
                MigrationEntity::StockMovements,
                json!({"inventory_item_id":"item-1","quantity_delta":-2,"__financial_projection_applied":true}),
            ),
        ] {
            rollback_financial_projection(entity, row.as_object_mut().unwrap(), &mut state);
        }
        assert_eq!(state["refund:sale-1:card"], 100);
        assert_eq!(state["commission:line-1"], 10_000);
        assert_eq!(state["stock:item-1"], 10);
    }

    #[test]
    fn phase_eight_only_missing_references_are_dependency_pending() {
        for code in [
            "DEPENDENCY_NOT_FOUND",
            "APPOINTMENT_CLIENT_NOT_FOUND",
            "PAYMENT_INVOICE_NOT_FOUND",
            "REFUND_PAYMENT_NOT_FOUND",
            "COMMISSION_SALE_LINE_NOT_FOUND",
            "STOCK_PRODUCT_NOT_FOUND",
            "FILE_OWNER_NOT_FOUND",
        ] {
            assert!(is_dependency_issue(code), "{code}");
        }
        assert!(!is_dependency_issue("REQUIRED_FIELD"));
        assert!(!is_dependency_issue("INVOICE_TOTAL_MISMATCH"));
        assert!(!is_dependency_issue("NEGATIVE_STOCK_NOT_ALLOWED"));
    }

    #[test]
    fn phase_ten_opening_valuation_uses_exact_quantity_and_integer_paise() {
        assert_eq!(opening_valuation_paise(18, 12_550), Some(225_900));
        assert_eq!(opening_valuation_paise(-4, 12_550), Some(-50_200));
        assert_eq!(opening_valuation_paise(i32::MAX, i64::MAX), None);
        assert_eq!(rounded_unit_cost_from_valuation(100, 3), Some(33));
        assert_eq!(rounded_unit_cost_from_valuation(101, 3), Some(34));
        assert_eq!(rounded_unit_cost_from_valuation(-101, -3), Some(34));
        assert_eq!(rounded_unit_cost_from_valuation(100, 0), None);
    }
}
