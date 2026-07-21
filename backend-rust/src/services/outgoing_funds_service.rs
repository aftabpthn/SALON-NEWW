use std::collections::BTreeMap;

use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    models::{
        common::AppError,
        outgoing_funds::{
            OutgoingFundAttachmentRequest, OutgoingFundAttachmentResponse,
            OutgoingFundAuditEventResponse, OutgoingFundCategory, OutgoingFundCreateRequest,
            OutgoingFundDecisionRequest, OutgoingFundLineRequest, OutgoingFundLineResponse,
            OutgoingFundListQuery, OutgoingFundPage, OutgoingFundPageMeta, OutgoingFundResponse,
            OutgoingFundSummary, OutgoingFundUpdateRequest,
        },
    },
    repositories::{
        cash_drawer_repository, clients_repository,
        outgoing_funds_repository::{self, NewOutgoingFundAttachment, NewOutgoingFundLine},
        purchase_repository, staff_repository,
    },
    services::accounting_service::{self, ManualJournalLine},
};

#[derive(Clone, Copy)]
struct CategoryMeta {
    key: &'static str,
    label: &'static str,
    account_code: Option<&'static str>,
    workflow_path: Option<&'static str>,
    workflow_label: Option<&'static str>,
}

const CATEGORY_META: &[CategoryMeta] = &[
    CategoryMeta {
        key: "rent",
        label: "Rent / Lease",
        account_code: Some("RENT_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "utilities",
        label: "Electricity / Water / Internet",
        account_code: Some("UTILITIES_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "marketing",
        label: "Marketing / Ads / Referral",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "software_subscription",
        label: "Software / SMS / WhatsApp",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "repair_maintenance",
        label: "Repair / Maintenance",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "cleaning_housekeeping",
        label: "Cleaning / Laundry / Housekeeping",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "client_refreshment",
        label: "Client Refreshment",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "uniform",
        label: "Uniform / Grooming",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "stationery",
        label: "Stationery / Printing",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "bank_charges",
        label: "Bank / Payment Gateway Charges",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "professional_legal",
        label: "CA / Legal / License",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "gst_payment",
        label: "GST / Tax Payment",
        account_code: Some("GST_PAYABLE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "statutory_payment",
        label: "PF / ESI / PT / TDS Payment",
        account_code: Some("PAYROLL_STATUTORY_PAYABLE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "security_deposit",
        label: "Security Deposit",
        account_code: Some("PREPAID_EXPENSES"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "prepaid_expense",
        label: "Prepaid Expense",
        account_code: Some("PREPAID_EXPENSES"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "loan",
        label: "Loan / EMI Principal",
        account_code: Some("LOANS_PAYABLE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "interest",
        label: "Interest / Finance Cost",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "owner_drawing",
        label: "Owner Drawing",
        account_code: Some("OWNER_EQUITY"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "travel",
        label: "Travel / Conveyance",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "training",
        label: "Training / Education",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "other",
        label: "Other Salon Outgoing",
        account_code: Some("OPERATING_EXPENSE"),
        workflow_path: None,
        workflow_label: None,
    },
    CategoryMeta {
        key: "salary",
        label: "Staff Salary",
        account_code: None,
        workflow_path: Some("/staff/payroll"),
        workflow_label: Some("Open payroll"),
    },
    CategoryMeta {
        key: "staff_commission",
        label: "Staff Commission / Incentive",
        account_code: None,
        workflow_path: Some("/staff/payroll"),
        workflow_label: Some("Open payroll"),
    },
    CategoryMeta {
        key: "advance",
        label: "Staff Advance",
        account_code: None,
        workflow_path: Some("/staff"),
        workflow_label: Some("Open staff"),
    },
    CategoryMeta {
        key: "inventory_purchase",
        label: "Product Purchase / Supplier Payment",
        account_code: None,
        workflow_path: Some("/purchase-payables"),
        workflow_label: Some("Open supplier payables"),
    },
    CategoryMeta {
        key: "product_consumable",
        label: "Product Consumable / COGS",
        account_code: None,
        workflow_path: Some("/inventory/backbar"),
        workflow_label: Some("Open backbar"),
    },
    CategoryMeta {
        key: "wastage_damage",
        label: "Wastage / Expiry / Damage",
        account_code: None,
        workflow_path: Some("/inventory/advanced-controls"),
        workflow_label: Some("Open inventory controls"),
    },
    CategoryMeta {
        key: "fixed_asset_purchase",
        label: "Fixed Asset Purchase",
        account_code: None,
        workflow_path: Some("/finance/fixed-assets"),
        workflow_label: Some("Open fixed assets"),
    },
    CategoryMeta {
        key: "bank_deposit",
        label: "Bank Deposit / Cash Transfer",
        account_code: None,
        workflow_path: Some("/pos/cash-drawer"),
        workflow_label: Some("Open cash drawer"),
    },
];

#[derive(Debug)]
struct ValidatedVoucher {
    business_date: NaiveDate,
    payment_account_code: String,
    payment_mode: String,
    fund_source: String,
    cash_drawer_till_id: Option<String>,
    reference_number: Option<String>,
    cheque_number: Option<String>,
    cheque_date: Option<NaiveDate>,
    linked_party_type: String,
    linked_party_id: Option<String>,
    linked_party_name: Option<String>,
    bill_reference: Option<String>,
    attachment_url: Option<String>,
    remarks: Option<String>,
    lines: Vec<NewOutgoingFundLine>,
    attachments: Vec<NewOutgoingFundAttachment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLine {
    id: String,
    line_number: i32,
    category_key: String,
    account_code: String,
    amount_paise: i64,
    gst_treatment: String,
    gst_paise: i64,
    subcategory: Option<String>,
    cost_center_id: Option<String>,
    department: Option<String>,
    linked_party_type: Option<String>,
    linked_party_id: Option<String>,
    linked_party_name: Option<String>,
    source_reference_type: Option<String>,
    source_reference_id: Option<String>,
    receipt_number: Option<String>,
    tax_invoice: Option<bool>,
    reimbursement: Option<bool>,
    remarks: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAttachment {
    id: String,
    line_number: Option<i32>,
    file_url: String,
    file_type: Option<String>,
    uploaded_by_user_id: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAuditEvent {
    id: String,
    event_type: String,
    actor_user_id: String,
    details: serde_json::Value,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Default)]
struct CashApprovalSnapshot {
    session_id: Option<String>,
    till_id: Option<String>,
    opening_balance_paise: Option<i64>,
    closing_balance_paise: Option<i64>,
}

pub(crate) fn static_categories() -> Vec<OutgoingFundCategory> {
    CATEGORY_META
        .iter()
        .map(|category| OutgoingFundCategory {
            key: category.key.into(),
            label: category.label.into(),
            category_bucket: category_bucket(category.key).into(),
            balance_sheet_impact: balance_sheet_impact(category.key).into(),
            operating: category_operating(category.key),
            account_code: category.account_code.map(str::to_string),
            manual_entry: category.account_code.is_some(),
            workflow_path: category.workflow_path.map(str::to_string),
            workflow_label: category.workflow_label.map(str::to_string),
            requires_party: false,
            requires_bill_reference: false,
            requires_attachment: false,
            approval_threshold_paise: None,
        })
        .collect()
}

pub async fn categories(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Vec<OutgoingFundCategory>, AppError> {
    let mut categories = static_categories()
        .into_iter()
        .map(|category| (category.key.clone(), category))
        .collect::<BTreeMap<_, _>>();
    for category in outgoing_funds_repository::list_categories(db, tenant_id, branch_id)
        .await
        .map_err(|_| AppError::internal("failed to list outgoing fund categories"))?
    {
        categories.insert(
            category.category_key.clone(),
            OutgoingFundCategory {
                key: category.category_key,
                label: category.label,
                category_bucket: custom_category_bucket(category.account_code.as_deref()).into(),
                balance_sheet_impact: custom_balance_sheet_impact(
                    category.account_code.as_deref(),
                    category.manual_entry,
                )
                .into(),
                operating: custom_category_operating(
                    category.account_code.as_deref(),
                    category.manual_entry,
                ),
                account_code: category.account_code,
                manual_entry: category.manual_entry,
                workflow_path: category.workflow_path,
                workflow_label: category.workflow_label,
                requires_party: category.requires_party,
                requires_bill_reference: category.requires_bill_reference,
                requires_attachment: category.requires_attachment,
                approval_threshold_paise: category.approval_threshold_paise,
            },
        );
    }
    Ok(categories.into_values().collect())
}

async fn category_lookup(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<BTreeMap<String, OutgoingFundCategory>, AppError> {
    Ok(categories(db, tenant_id, branch_id)
        .await?
        .into_iter()
        .map(|category| (category.key.clone(), category))
        .collect())
}

pub async fn list(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    query: OutgoingFundListQuery,
) -> Result<OutgoingFundPage, AppError> {
    let from_date = parse_optional_date(query.from_date.as_deref(), "fromDate")?;
    let to_date = parse_optional_date(query.to_date.as_deref(), "toDate")?;
    if from_date.zip(to_date).is_some_and(|(from, to)| from > to) {
        return Err(AppError::validation("fromDate cannot be after toDate"));
    }
    let status = clean_filter(query.status.as_deref(), 20, "status")?;
    if !status.is_empty() && !valid_status(&status) {
        return Err(AppError::validation("invalid outgoing fund status"));
    }
    let search = clean_filter(query.q.as_deref(), 100, "q")?;
    let category = clean_filter(query.category.as_deref(), 64, "category")?;
    let categories = category_lookup(db, tenant_id, branch_id).await?;
    if !category.is_empty() && !categories.contains_key(&category) {
        return Err(AppError::validation("invalid outgoing fund category"));
    }
    let page = query.page.unwrap_or(1).clamp(1, 100_000);
    let page_size = query.page_size.unwrap_or(100).clamp(1, 500);
    let offset = (page - 1).saturating_mul(page_size);
    let rows = outgoing_funds_repository::list(
        db, tenant_id, branch_id, from_date, to_date, &status, &search, &category, page_size,
        offset,
    )
    .await
    .map_err(|_| AppError::internal("failed to list outgoing funds"))?;
    let total = outgoing_funds_repository::count(
        db, tenant_id, branch_id, from_date, to_date, &status, &search, &category,
    )
    .await
    .map_err(|_| AppError::internal("failed to count outgoing funds"))?;
    let summary = outgoing_funds_repository::summary(
        db, tenant_id, branch_id, from_date, to_date, &status, &search, &category,
    )
    .await
    .map_err(|_| AppError::internal("failed to summarize outgoing funds"))?;
    Ok(OutgoingFundPage {
        rows: rows.into_iter().map(map_record).collect::<Result<_, _>>()?,
        summary: OutgoingFundSummary {
            voucher_count: summary.0,
            total_paise: summary.1,
            pending_count: summary.2,
            input_gst_paise: summary.3,
        },
        meta: OutgoingFundPageMeta {
            page,
            page_size,
            total,
        },
    })
}

pub async fn export_rows(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    mut query: OutgoingFundListQuery,
) -> Result<Vec<OutgoingFundResponse>, AppError> {
    query.page_size = Some(500);
    let mut rows = Vec::new();
    for page_number in 1..=100_000 {
        query.page = Some(page_number);
        let page = list(db, tenant_id, branch_id, query.clone()).await?;
        let empty = page.rows.is_empty();
        rows.extend(page.rows);
        if empty || rows.len() >= page.meta.total as usize {
            break;
        }
    }
    Ok(rows)
}

pub async fn get(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<OutgoingFundResponse, AppError> {
    let record = outgoing_funds_repository::find(db, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to load outgoing fund"))?
        .ok_or_else(|| AppError::not_found("outgoing fund voucher was not found"))?;
    map_record(record)
}

pub async fn create(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    actor: &str,
    payload: OutgoingFundCreateRequest,
) -> Result<OutgoingFundResponse, AppError> {
    let key = validate_idempotency_key(&payload.idempotency_key)?;
    if let Some(record) =
        outgoing_funds_repository::find_by_idempotency(db, tenant_id, branch_id, &key)
            .await
            .map_err(|_| AppError::internal("failed to check outgoing fund retry"))?
    {
        return map_record(record);
    }
    let categories = category_lookup(db, tenant_id, branch_id).await?;
    let mut validated = validate_voucher(
        &payload.business_date,
        &payload.payment_account_code,
        &payload.payment_mode,
        payload.fund_source.as_deref(),
        payload.cash_drawer_till_id.as_deref(),
        payload.reference_number.as_deref(),
        payload.cheque_number.as_deref(),
        payload.cheque_date.as_deref(),
        payload.linked_party_type.as_deref(),
        payload.linked_party_id.as_deref(),
        payload.linked_party_name.as_deref(),
        payload.bill_reference.as_deref(),
        payload.attachment_url.as_deref(),
        payload.remarks.as_deref(),
        &payload.lines,
        &payload.attachments,
        &categories,
    )?;
    validated.linked_party_name = resolve_linked_party_name(
        db,
        tenant_id,
        branch_id,
        &validated.linked_party_type,
        validated.linked_party_id.as_deref(),
        validated.linked_party_name.as_deref(),
    )
    .await?;
    let status = if payload.submit.unwrap_or(false) {
        "pending"
    } else {
        "draft"
    };
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund save"))?;
    let id = outgoing_funds_repository::create(
        &mut tx,
        tenant_id,
        branch_id,
        actor,
        outgoing_funds_repository::NewOutgoingFundVoucher {
            business_date: validated.business_date,
            payment_account_code: &validated.payment_account_code,
            payment_mode: &validated.payment_mode,
            fund_source: &validated.fund_source,
            cash_drawer_till_id: validated.cash_drawer_till_id.as_deref(),
            reference_number: validated.reference_number.as_deref(),
            cheque_number: validated.cheque_number.as_deref(),
            cheque_date: validated.cheque_date,
            linked_party_type: &validated.linked_party_type,
            linked_party_id: validated.linked_party_id.as_deref(),
            linked_party_name: validated.linked_party_name.as_deref(),
            bill_reference: validated.bill_reference.as_deref(),
            attachment_url: validated.attachment_url.as_deref(),
            remarks: validated.remarks.as_deref(),
            status,
            idempotency_key: &key,
        },
        &validated.lines,
        &validated.attachments,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database_error| database_error.code().as_deref() == Some("23505"))
        {
            AppError::conflict("outgoing fund retry conflicts with an existing voucher")
        } else {
            AppError::internal("failed to save outgoing fund")
        }
    })?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund"))?;
    get(db, tenant_id, branch_id, &id).await
}

pub async fn update(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    payload: OutgoingFundUpdateRequest,
) -> Result<OutgoingFundResponse, AppError> {
    if payload.version <= 0 {
        return Err(AppError::validation("version is required"));
    }
    let categories = category_lookup(db, tenant_id, branch_id).await?;
    let mut validated = validate_voucher(
        &payload.business_date,
        &payload.payment_account_code,
        &payload.payment_mode,
        payload.fund_source.as_deref(),
        payload.cash_drawer_till_id.as_deref(),
        payload.reference_number.as_deref(),
        payload.cheque_number.as_deref(),
        payload.cheque_date.as_deref(),
        payload.linked_party_type.as_deref(),
        payload.linked_party_id.as_deref(),
        payload.linked_party_name.as_deref(),
        payload.bill_reference.as_deref(),
        payload.attachment_url.as_deref(),
        payload.remarks.as_deref(),
        &payload.lines,
        &payload.attachments,
        &categories,
    )?;
    validated.linked_party_name = resolve_linked_party_name(
        db,
        tenant_id,
        branch_id,
        &validated.linked_party_type,
        validated.linked_party_id.as_deref(),
        validated.linked_party_name.as_deref(),
    )
    .await?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund update"))?;
    let updated = outgoing_funds_repository::update_draft(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        actor,
        outgoing_funds_repository::UpdateOutgoingFundVoucher {
            business_date: validated.business_date,
            payment_account_code: &validated.payment_account_code,
            payment_mode: &validated.payment_mode,
            fund_source: &validated.fund_source,
            cash_drawer_till_id: validated.cash_drawer_till_id.as_deref(),
            reference_number: validated.reference_number.as_deref(),
            cheque_number: validated.cheque_number.as_deref(),
            cheque_date: validated.cheque_date,
            linked_party_type: &validated.linked_party_type,
            linked_party_id: validated.linked_party_id.as_deref(),
            linked_party_name: validated.linked_party_name.as_deref(),
            bill_reference: validated.bill_reference.as_deref(),
            attachment_url: validated.attachment_url.as_deref(),
            remarks: validated.remarks.as_deref(),
            expected_version: payload.version,
        },
        &validated.lines,
        &validated.attachments,
    )
    .await
    .map_err(|_| AppError::internal("failed to update outgoing fund"))?;
    if !updated {
        return Err(AppError::conflict(
            "outgoing fund changed or is no longer editable",
        ));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund update"))?;
    get(db, tenant_id, branch_id, id).await
}

pub async fn submit(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<OutgoingFundResponse, AppError> {
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund submission"))?;
    let record = lock_required(&mut tx, tenant_id, branch_id, id).await?;
    if !matches!(record.status.as_str(), "draft" | "rejected") {
        return Err(AppError::conflict(
            "only draft or rejected vouchers can be submitted",
        ));
    }
    outgoing_funds_repository::mark_submitted(&mut tx, tenant_id, branch_id, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to submit outgoing fund"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund submission"))?;
    get(db, tenant_id, branch_id, id).await
}

pub async fn approve(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    role: &str,
) -> Result<OutgoingFundResponse, AppError> {
    require_approver(role)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund approval"))?;
    let record = lock_required(&mut tx, tenant_id, branch_id, id).await?;
    if record.status != "pending" {
        return Err(AppError::conflict("only pending vouchers can be approved"));
    }
    let response = map_record(record.clone())?;
    let categories = category_lookup(db, tenant_id, branch_id).await?;
    let approval_policy_reason = approval_policy_reason(&response, &categories, actor, role)?;
    let cash_snapshot = cash_approval_snapshot(&mut tx, tenant_id, branch_id, &response).await?;
    let journal_lines = journal_lines(&response.lines, &response.payment_account_code, false)?;
    let journal_id = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        branch_id,
        "outgoing_fund",
        id,
        response.business_date,
        &format!("Outgoing fund {}", response.voucher_number),
        actor,
        &journal_lines,
    )
    .await?
    .or(outgoing_funds_repository::accounting_journal_id(
        &mut tx,
        tenant_id,
        branch_id,
        "outgoing_fund",
        id,
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve outgoing fund journal"))?)
    .ok_or_else(|| AppError::internal("outgoing fund journal was not created"))?;
    if !outgoing_funds_repository::mark_approved(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        actor,
        &journal_id,
        cash_snapshot.session_id.as_deref(),
        cash_snapshot.till_id.as_deref(),
        cash_snapshot.opening_balance_paise,
        cash_snapshot.closing_balance_paise,
        Some(&approval_policy_reason),
    )
    .await
    .map_err(|_| AppError::internal("failed to approve outgoing fund"))?
    {
        return Err(AppError::conflict("outgoing fund approval state changed"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund approval"))?;
    get(db, tenant_id, branch_id, id).await
}

pub async fn reject(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    role: &str,
    payload: OutgoingFundDecisionRequest,
) -> Result<OutgoingFundResponse, AppError> {
    require_approver(role)?;
    let reason = required_note(payload.reason.as_deref(), "rejection reason")?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund rejection"))?;
    let record = lock_required(&mut tx, tenant_id, branch_id, id).await?;
    if record.status != "pending" {
        return Err(AppError::conflict("only pending vouchers can be rejected"));
    }
    outgoing_funds_repository::mark_rejected(&mut tx, tenant_id, branch_id, id, actor, &reason)
        .await
        .map_err(|_| AppError::internal("failed to reject outgoing fund"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund rejection"))?;
    get(db, tenant_id, branch_id, id).await
}

pub async fn reverse(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
    role: &str,
    payload: OutgoingFundDecisionRequest,
) -> Result<OutgoingFundResponse, AppError> {
    require_approver(role)?;
    let reason = required_note(payload.reason.as_deref(), "reversal reason")?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund reversal"))?;
    let record = lock_required(&mut tx, tenant_id, branch_id, id).await?;
    if record.status != "approved" {
        return Err(AppError::conflict("only approved vouchers can be reversed"));
    }
    let response = map_record(record.clone())?;
    ensure_cash_drawer_open(&mut tx, tenant_id, branch_id, &response).await?;
    let journal_lines = journal_lines(&response.lines, &response.payment_account_code, true)?;
    let journal_id = accounting_service::post_control_journal(
        &mut tx,
        tenant_id,
        branch_id,
        "outgoing_fund_reversal",
        id,
        response.business_date,
        &format!(
            "Outgoing fund reversal {}: {reason}",
            response.voucher_number
        ),
        actor,
        &journal_lines,
    )
    .await?
    .or(outgoing_funds_repository::accounting_journal_id(
        &mut tx,
        tenant_id,
        branch_id,
        "outgoing_fund_reversal",
        id,
    )
    .await
    .map_err(|_| AppError::internal("failed to resolve outgoing fund reversal journal"))?)
    .ok_or_else(|| AppError::internal("outgoing fund reversal journal was not created"))?;
    if !outgoing_funds_repository::mark_reversed(
        &mut tx,
        tenant_id,
        branch_id,
        id,
        actor,
        &reason,
        &journal_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to reverse outgoing fund"))?
    {
        return Err(AppError::conflict("outgoing fund reversal state changed"));
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund reversal"))?;
    get(db, tenant_id, branch_id, id).await
}

pub async fn cancel(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
    actor: &str,
) -> Result<OutgoingFundResponse, AppError> {
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start outgoing fund cancellation"))?;
    let record = lock_required(&mut tx, tenant_id, branch_id, id).await?;
    if !matches!(record.status.as_str(), "draft" | "rejected") {
        return Err(AppError::conflict(
            "only draft or rejected vouchers can be cancelled",
        ));
    }
    outgoing_funds_repository::mark_cancelled(&mut tx, tenant_id, branch_id, id, actor)
        .await
        .map_err(|_| AppError::internal("failed to cancel outgoing fund"))?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit outgoing fund cancellation"))?;
    get(db, tenant_id, branch_id, id).await
}

async fn lock_required(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    id: &str,
) -> Result<outgoing_funds_repository::OutgoingFundRecord, AppError> {
    outgoing_funds_repository::lock(tx, tenant_id, branch_id, id)
        .await
        .map_err(|_| AppError::internal("failed to lock outgoing fund"))?
        .ok_or_else(|| AppError::not_found("outgoing fund voucher was not found"))
}

async fn ensure_cash_drawer_open(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    voucher: &OutgoingFundResponse,
) -> Result<(), AppError> {
    if voucher.payment_account_code != "CASH_ON_HAND" {
        return Ok(());
    }
    let open =
        cash_drawer_repository::is_open_for_update(tx, tenant_id, branch_id, voucher.business_date)
            .await
            .map_err(|_| AppError::internal("failed to validate cash drawer"))?;
    if open {
        Ok(())
    } else {
        Err(AppError::conflict(
            "an open cash drawer is required for this voucher date",
        ))
    }
}

async fn cash_approval_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    voucher: &OutgoingFundResponse,
) -> Result<CashApprovalSnapshot, AppError> {
    if voucher.payment_account_code != "CASH_ON_HAND" {
        return Ok(CashApprovalSnapshot::default());
    }
    let session =
        cash_drawer_repository::active_for_update(tx, tenant_id, branch_id, voucher.business_date)
            .await
            .map_err(|_| AppError::internal("failed to lock cash drawer"))?
            .ok_or_else(|| {
                AppError::conflict("an open cash drawer is required for this voucher date")
            })?;
    if session.status != "open" {
        return Err(AppError::conflict(
            "cash drawer must be open before outgoing approval",
        ));
    }
    let requested_till_id = voucher.cash_drawer_till_id.as_deref().unwrap_or("");
    let till_ids = cash_drawer_repository::open_till_ids_for_cash(
        tx,
        tenant_id,
        branch_id,
        voucher.business_date,
        requested_till_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate cash drawer till"))?;
    if !requested_till_id.is_empty() && till_ids.is_empty() {
        return Err(AppError::conflict("selected cash drawer till is not open"));
    }
    let (cash_sales, movement_delta) = cash_drawer_repository::totals(
        tx,
        tenant_id,
        branch_id,
        voucher.business_date,
        &session.id,
    )
    .await
    .map_err(|_| AppError::internal("failed to calculate cash drawer balance"))?;
    let opening_balance = session
        .opening_cash_paise
        .saturating_add(cash_sales)
        .saturating_add(movement_delta);
    let closing_balance = opening_balance.saturating_sub(voucher.total_paise);
    if closing_balance < 0 {
        return Err(AppError::conflict(
            "cash drawer balance is not enough for this outgoing",
        ));
    }
    Ok(CashApprovalSnapshot {
        session_id: Some(session.id),
        till_id: if requested_till_id.is_empty() {
            till_ids.into_iter().next()
        } else {
            Some(requested_till_id.to_string())
        },
        opening_balance_paise: Some(opening_balance),
        closing_balance_paise: Some(closing_balance),
    })
}

#[allow(clippy::too_many_arguments)]
fn validate_voucher(
    business_date: &str,
    payment_account_code: &str,
    payment_mode: &str,
    fund_source: Option<&str>,
    cash_drawer_till_id: Option<&str>,
    reference_number: Option<&str>,
    cheque_number: Option<&str>,
    cheque_date: Option<&str>,
    linked_party_type: Option<&str>,
    linked_party_id: Option<&str>,
    linked_party_name: Option<&str>,
    bill_reference: Option<&str>,
    attachment_url: Option<&str>,
    remarks: Option<&str>,
    lines: &[OutgoingFundLineRequest],
    attachments: &[OutgoingFundAttachmentRequest],
    categories: &BTreeMap<String, OutgoingFundCategory>,
) -> Result<ValidatedVoucher, AppError> {
    let business_date = parse_date(business_date, "businessDate")?;
    let payment_account_code = payment_account_code.trim().to_ascii_uppercase();
    if !matches!(
        payment_account_code.as_str(),
        "CASH_ON_HAND" | "BANK_CLEARING"
    ) {
        return Err(AppError::validation(
            "paymentAccountCode must be CASH_ON_HAND or BANK_CLEARING",
        ));
    }
    let payment_mode = normalize_payment_mode(payment_mode)?;
    if (payment_mode == "Cash" && payment_account_code != "CASH_ON_HAND")
        || (payment_mode != "Cash"
            && payment_mode != "Other"
            && payment_account_code != "BANK_CLEARING")
    {
        return Err(AppError::validation(
            "payment account does not match paymentMode",
        ));
    }
    let fund_source = fund_source
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(if payment_account_code == "CASH_ON_HAND" {
            "business_cash"
        } else {
            "bank"
        })
        .to_ascii_lowercase();
    if !matches!(
        fund_source.as_str(),
        "business_cash" | "petty_cash_balance" | "bank" | "other"
    ) {
        return Err(AppError::validation("invalid fundSource"));
    }
    if matches!(fund_source.as_str(), "business_cash" | "petty_cash_balance")
        && payment_account_code != "CASH_ON_HAND"
    {
        return Err(AppError::validation(
            "cash fund sources require Cash on Hand",
        ));
    }
    if fund_source == "bank" && payment_account_code != "BANK_CLEARING" {
        return Err(AppError::validation(
            "bank fund source requires Bank Clearing",
        ));
    }
    let cash_drawer_till_id = optional_text(cash_drawer_till_id, 100, "cashDrawerTillId")?;
    let reference_number = optional_text(reference_number, 100, "referenceNumber")?;
    let cheque_number = optional_text(cheque_number, 60, "chequeNumber")?;
    let cheque_date = parse_optional_date(cheque_date, "chequeDate")?;
    if payment_mode.eq_ignore_ascii_case("cheque")
        && (cheque_number.is_none() || cheque_date.is_none())
    {
        return Err(AppError::validation(
            "chequeNumber and chequeDate are required for cheque payments",
        ));
    }
    let linked_party_type = normalize_party_type(linked_party_type.unwrap_or("none"), false)?;
    if !matches!(
        linked_party_type.as_str(),
        "none" | "vendor" | "staff" | "client" | "owner" | "other"
    ) {
        return Err(AppError::validation("invalid linkedPartyType"));
    }
    let linked_party_id = optional_text(linked_party_id, 100, "linkedPartyId")?;
    let linked_party_name = optional_text(linked_party_name, 160, "linkedPartyName")?;
    if linked_party_type != "none" && linked_party_id.is_none() && linked_party_name.is_none() {
        return Err(AppError::validation(
            "linked party is required for the selected type",
        ));
    }
    let bill_reference = optional_text(bill_reference, 120, "billReference")?;
    let attachment_url = optional_text(attachment_url, 500, "attachmentUrl")?;
    if attachment_url
        .as_deref()
        .is_some_and(|value| !value.starts_with("https://") && !value.starts_with("http://"))
    {
        return Err(AppError::validation(
            "attachmentUrl must be an HTTP or HTTPS URL",
        ));
    }
    let remarks = optional_text(remarks, 500, "remarks")?;
    if lines.is_empty() || lines.len() > 50 {
        return Err(AppError::validation(
            "outgoing fund requires between 1 and 50 lines",
        ));
    }
    let mut validated_lines = Vec::with_capacity(lines.len());
    let mut total = 0_i64;
    for line in lines {
        validated_lines.push(validate_line(line, categories)?);
        total = total
            .checked_add(line.amount_paise)
            .ok_or_else(|| AppError::validation("outgoing fund total exceeds supported range"))?;
    }
    if total <= 0 || total > 1_000_000_000_000_000 {
        return Err(AppError::validation("outgoing fund total is invalid"));
    }
    let validated_attachments = validate_attachments(attachments, lines.len())?;
    if categories
        .values()
        .filter(|category| category.requires_party)
        .any(|category| {
            lines
                .iter()
                .any(|line| line.category_key.trim().eq_ignore_ascii_case(&category.key))
        })
        && linked_party_type == "none"
        && !validated_lines
            .iter()
            .any(|line| !matches!(line.linked_party_type.as_str(), "voucher" | "none"))
    {
        return Err(AppError::validation(
            "linked party is required for this category",
        ));
    }
    if categories
        .values()
        .filter(|category| category.requires_attachment)
        .any(|category| {
            lines
                .iter()
                .any(|line| line.category_key.trim().eq_ignore_ascii_case(&category.key))
        })
        && validated_attachments.is_empty()
        && attachment_url.is_none()
    {
        return Err(AppError::validation(
            "attachment is required for this category",
        ));
    }
    if categories
        .values()
        .filter(|category| category.requires_bill_reference)
        .any(|category| {
            lines
                .iter()
                .any(|line| line.category_key.trim().eq_ignore_ascii_case(&category.key))
        })
        && bill_reference.is_none()
    {
        return Err(AppError::validation(
            "billReference is required for this category",
        ));
    }
    Ok(ValidatedVoucher {
        business_date,
        payment_account_code,
        payment_mode,
        fund_source,
        cash_drawer_till_id,
        reference_number,
        cheque_number,
        cheque_date,
        linked_party_type,
        linked_party_id,
        linked_party_name,
        bill_reference,
        attachment_url,
        remarks,
        lines: validated_lines,
        attachments: validated_attachments,
    })
}

async fn resolve_linked_party_name(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    party_type: &str,
    party_id: Option<&str>,
    entered_name: Option<&str>,
) -> Result<Option<String>, AppError> {
    let record_id = party_id.filter(|value| !value.trim().is_empty());
    match party_type {
        "none" => Ok(None),
        "vendor" => {
            let id = record_id.ok_or_else(|| AppError::validation("vendor record is required"))?;
            purchase_repository::get_supplier(db, tenant_id, branch_id, id)
                .await
                .map_err(|_| AppError::internal("failed to validate vendor"))?
                .map(|record| record.name)
                .ok_or_else(|| AppError::validation("selected vendor was not found"))
                .map(Some)
        }
        "staff" => {
            let id = record_id.ok_or_else(|| AppError::validation("staff record is required"))?;
            staff_repository::get(db, tenant_id, branch_id, id)
                .await
                .map_err(|_| AppError::internal("failed to validate staff"))?
                .map(|record| {
                    [record.first_name, record.middle_name, record.last_name]
                        .into_iter()
                        .filter(|part| !part.trim().is_empty())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .ok_or_else(|| AppError::validation("selected staff was not found"))
                .map(Some)
        }
        "client" => {
            let id = record_id.ok_or_else(|| AppError::validation("client record is required"))?;
            clients_repository::get(db, tenant_id, branch_id, id)
                .await
                .map_err(|_| AppError::internal("failed to validate client"))?
                .map(|record| {
                    format!("{} {}", record.first_name, record.last_name)
                        .trim()
                        .to_string()
                })
                .ok_or_else(|| AppError::validation("selected client was not found"))
                .map(Some)
        }
        _ => entered_name
            .map(str::to_string)
            .ok_or_else(|| AppError::validation("linked party name is required"))
            .map(Some),
    }
}

fn validate_line(
    line: &OutgoingFundLineRequest,
    categories: &BTreeMap<String, OutgoingFundCategory>,
) -> Result<NewOutgoingFundLine, AppError> {
    let key = line.category_key.trim().to_ascii_lowercase();
    let category = categories
        .get(&key)
        .ok_or_else(|| AppError::validation("invalid outgoing fund category"))?;
    let account_code = category.account_code.as_deref().ok_or_else(|| {
        AppError::validation(format!(
            "{} must use {}",
            category.label,
            category
                .workflow_label
                .as_deref()
                .unwrap_or("its existing workflow")
        ))
    })?;
    if line.amount_paise <= 0 || line.amount_paise > 1_000_000_000_000_000 {
        return Err(AppError::validation("line amountPaise is invalid"));
    }
    let gst_treatment = line
        .gst_treatment
        .as_deref()
        .unwrap_or("none")
        .trim()
        .to_ascii_lowercase();
    if !matches!(gst_treatment.as_str(), "none" | "cgst_sgst" | "igst") {
        return Err(AppError::validation("invalid GST treatment"));
    }
    let gst_paise = line.gst_paise.unwrap_or(0);
    if gst_paise < 0
        || gst_paise > line.amount_paise
        || (gst_treatment == "none" && gst_paise != 0)
        || (gst_treatment != "none" && gst_paise == 0)
    {
        return Err(AppError::validation(
            "line GST amount does not match GST treatment",
        ));
    }
    Ok(NewOutgoingFundLine {
        category_key: key,
        account_code: account_code.into(),
        amount_paise: line.amount_paise,
        gst_treatment,
        gst_paise,
        subcategory: optional_text(line.subcategory.as_deref(), 100, "subcategory")?,
        cost_center_id: optional_text(line.cost_center_id.as_deref(), 100, "costCenterId")?,
        department: optional_text(line.department.as_deref(), 100, "department")?,
        linked_party_type: validate_line_party_type(line.linked_party_type.as_deref())?,
        linked_party_id: optional_text(line.linked_party_id.as_deref(), 100, "line linkedPartyId")?,
        linked_party_name: optional_text(
            line.linked_party_name.as_deref(),
            160,
            "line linkedPartyName",
        )?,
        source_reference_type: optional_text(
            line.source_reference_type.as_deref(),
            80,
            "sourceReferenceType",
        )?,
        source_reference_id: optional_text(
            line.source_reference_id.as_deref(),
            120,
            "sourceReferenceId",
        )?,
        receipt_number: optional_text(line.receipt_number.as_deref(), 80, "receiptNumber")?,
        tax_invoice: line.tax_invoice.unwrap_or(false),
        reimbursement: line.reimbursement.unwrap_or(false),
        remarks: optional_text(line.remarks.as_deref(), 300, "line remarks")?,
    })
}

fn validate_line_party_type(value: Option<&str>) -> Result<String, AppError> {
    normalize_party_type(value.unwrap_or("voucher"), true)
}

fn validate_attachments(
    attachments: &[OutgoingFundAttachmentRequest],
    line_count: usize,
) -> Result<Vec<NewOutgoingFundAttachment>, AppError> {
    if attachments.len() > 20 {
        return Err(AppError::validation(
            "outgoing fund supports up to 20 attachments",
        ));
    }
    attachments
        .iter()
        .map(|attachment| {
            if let Some(line_number) = attachment.line_number {
                if line_number <= 0 || line_number as usize > line_count {
                    return Err(AppError::validation("attachment lineNumber is invalid"));
                }
            }
            let file_url = optional_text(
                Some(attachment.file_url.as_str()),
                500,
                "attachment fileUrl",
            )?
            .ok_or_else(|| AppError::validation("attachment fileUrl is required"))?;
            if !file_url.starts_with("https://") && !file_url.starts_with("http://") {
                return Err(AppError::validation(
                    "attachment fileUrl must be HTTP or HTTPS",
                ));
            }
            Ok(NewOutgoingFundAttachment {
                line_number: attachment.line_number,
                file_url,
                file_type: optional_text(
                    attachment.file_type.as_deref(),
                    80,
                    "attachment fileType",
                )?,
            })
        })
        .collect()
}

fn journal_lines(
    lines: &[OutgoingFundLineResponse],
    payment_account_code: &str,
    reverse: bool,
) -> Result<Vec<ManualJournalLine>, AppError> {
    let mut totals: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    let mut total = 0_i64;
    for line in lines {
        let net = line
            .amount_paise
            .checked_sub(line.gst_paise)
            .ok_or_else(|| AppError::validation("outgoing fund GST exceeds amount"))?;
        add_journal_amount(
            &mut totals,
            &line.account_code,
            if reverse { 0 } else { net },
            if reverse { net } else { 0 },
        )?;
        match line.gst_treatment.as_str() {
            "cgst_sgst" => {
                let cgst = line.gst_paise / 2;
                let sgst = line.gst_paise - cgst;
                add_journal_amount(
                    &mut totals,
                    "INPUT_CGST",
                    if reverse { 0 } else { cgst },
                    if reverse { cgst } else { 0 },
                )?;
                add_journal_amount(
                    &mut totals,
                    "INPUT_SGST",
                    if reverse { 0 } else { sgst },
                    if reverse { sgst } else { 0 },
                )?;
            }
            "igst" => add_journal_amount(
                &mut totals,
                "INPUT_IGST",
                if reverse { 0 } else { line.gst_paise },
                if reverse { line.gst_paise } else { 0 },
            )?,
            _ => {}
        }
        total = total
            .checked_add(line.amount_paise)
            .ok_or_else(|| AppError::validation("outgoing fund total exceeds supported range"))?;
    }
    add_journal_amount(
        &mut totals,
        payment_account_code,
        if reverse { total } else { 0 },
        if reverse { 0 } else { total },
    )?;
    Ok(totals
        .into_iter()
        .filter(|(_, (debit, credit))| *debit > 0 || *credit > 0)
        .map(
            |(account_code, (debit_paise, credit_paise))| ManualJournalLine {
                account_code,
                debit_paise,
                credit_paise,
            },
        )
        .collect())
}

fn add_journal_amount(
    totals: &mut BTreeMap<String, (i64, i64)>,
    account: &str,
    debit: i64,
    credit: i64,
) -> Result<(), AppError> {
    if debit == 0 && credit == 0 {
        return Ok(());
    }
    let entry = totals.entry(account.into()).or_default();
    entry.0 = entry
        .0
        .checked_add(debit)
        .ok_or_else(|| AppError::validation("journal debit exceeds supported range"))?;
    entry.1 = entry
        .1
        .checked_add(credit)
        .ok_or_else(|| AppError::validation("journal credit exceeds supported range"))?;
    Ok(())
}

fn map_record(
    record: outgoing_funds_repository::OutgoingFundRecord,
) -> Result<OutgoingFundResponse, AppError> {
    let stored = serde_json::from_value::<Vec<StoredLine>>(record.lines_json)
        .map_err(|_| AppError::internal("failed to decode outgoing fund lines"))?;
    let attachments = serde_json::from_value::<Vec<StoredAttachment>>(record.attachments_json)
        .map_err(|_| AppError::internal("failed to decode outgoing fund attachments"))?
        .into_iter()
        .map(|attachment| OutgoingFundAttachmentResponse {
            id: attachment.id,
            line_number: attachment.line_number,
            file_url: attachment.file_url,
            file_type: attachment.file_type,
            uploaded_by_user_id: attachment.uploaded_by_user_id,
            created_at: attachment.created_at,
        })
        .collect::<Vec<_>>();
    let audit_events = serde_json::from_value::<Vec<StoredAuditEvent>>(record.audit_json)
        .map_err(|_| AppError::internal("failed to decode outgoing fund audit"))?
        .into_iter()
        .map(|event| OutgoingFundAuditEventResponse {
            id: event.id,
            event_type: event.event_type,
            actor_user_id: event.actor_user_id,
            details: event.details,
            created_at: event.created_at,
        })
        .collect::<Vec<_>>();
    let lines = stored
        .into_iter()
        .map(|line| {
            let meta = category_meta(&line.category_key);
            let label = meta
                .map(|category| category.label)
                .unwrap_or("Other Salon Outgoing");
            OutgoingFundLineResponse {
                id: line.id,
                line_number: line.line_number,
                category_bucket: meta
                    .map(|category| category_bucket(category.key))
                    .unwrap_or_else(|| custom_category_bucket(Some(line.account_code.as_str())))
                    .into(),
                balance_sheet_impact: meta
                    .map(|category| balance_sheet_impact(category.key))
                    .unwrap_or_else(|| {
                        custom_balance_sheet_impact(Some(line.account_code.as_str()), true)
                    })
                    .into(),
                operating: meta
                    .map(|category| category_operating(category.key))
                    .unwrap_or_else(|| {
                        custom_category_operating(Some(line.account_code.as_str()), true)
                    }),
                category_key: line.category_key,
                category_label: label.into(),
                account_code: line.account_code,
                amount_paise: line.amount_paise,
                gst_treatment: line.gst_treatment,
                gst_paise: line.gst_paise,
                net_paise: line.amount_paise.saturating_sub(line.gst_paise),
                subcategory: line.subcategory,
                cost_center_id: line.cost_center_id,
                department: line.department,
                linked_party_type: line.linked_party_type.unwrap_or_else(|| "voucher".into()),
                linked_party_id: line.linked_party_id,
                linked_party_name: line.linked_party_name,
                source_reference_type: line.source_reference_type,
                source_reference_id: line.source_reference_id,
                receipt_number: line.receipt_number,
                tax_invoice: line.tax_invoice.unwrap_or(false),
                reimbursement: line.reimbursement.unwrap_or(false),
                remarks: line.remarks,
            }
        })
        .collect::<Vec<_>>();
    let total_paise = lines
        .iter()
        .try_fold(0_i64, |total, line| total.checked_add(line.amount_paise))
        .ok_or_else(|| AppError::internal("outgoing fund total exceeds supported range"))?;
    let gst_paise = lines
        .iter()
        .try_fold(0_i64, |total, line| total.checked_add(line.gst_paise))
        .ok_or_else(|| AppError::internal("outgoing fund GST exceeds supported range"))?;
    Ok(OutgoingFundResponse {
        id: record.id,
        voucher_number: record.voucher_number,
        business_date: record.business_date,
        payment_account_name: payment_account_name(&record.payment_account_code).into(),
        payment_account_code: record.payment_account_code,
        payment_mode: record.payment_mode,
        fund_source: record.fund_source,
        cash_drawer_session_id: record.cash_drawer_session_id,
        cash_drawer_till_id: record.cash_drawer_till_id,
        opening_balance_paise: record.opening_balance_paise,
        closing_balance_paise: record.closing_balance_paise,
        reference_number: record.reference_number,
        cheque_number: record.cheque_number,
        cheque_date: record.cheque_date,
        linked_party_type: record.linked_party_type,
        linked_party_id: record.linked_party_id,
        linked_party_name: record.linked_party_name,
        bill_reference: record.bill_reference,
        attachment_url: record.attachment_url,
        remarks: record.remarks,
        status: record.status,
        total_paise,
        gst_paise,
        journal_entry_id: record.journal_entry_id,
        reversal_journal_entry_id: record.reversal_journal_entry_id,
        approval_policy_reason: record.approval_policy_reason,
        version: record.version,
        created_by_user_id: record.created_by_user_id,
        submitted_by_user_id: record.submitted_by_user_id,
        approved_by_user_id: record.approved_by_user_id,
        rejected_by_user_id: record.rejected_by_user_id,
        reversed_by_user_id: record.reversed_by_user_id,
        submitted_at: record.submitted_at,
        approved_at: record.approved_at,
        rejected_at: record.rejected_at,
        reversed_at: record.reversed_at,
        rejection_reason: record.rejection_reason,
        reversal_reason: record.reversal_reason,
        created_at: record.created_at,
        updated_at: record.updated_at,
        lines,
        attachments,
        audit_events,
    })
}

fn category_meta(key: &str) -> Option<CategoryMeta> {
    CATEGORY_META
        .iter()
        .copied()
        .find(|category| category.key == key)
}

fn category_bucket(key: &str) -> &'static str {
    match key {
        "salary" | "staff_commission" | "training" => "staff",
        "advance" => "advance_asset",
        "inventory_purchase" | "product_consumable" | "wastage_damage" => "inventory",
        "fixed_asset_purchase" => "fixed_asset",
        "stationery" | "software_subscription" | "professional_legal" => "admin",
        "marketing" => "sales_marketing",
        "bank_charges" | "interest" => "finance_cost",
        "gst_payment" | "statutory_payment" => "tax",
        "security_deposit" => "deposit_asset",
        "prepaid_expense" => "prepaid_asset",
        "loan" => "loan",
        "owner_drawing" => "owner",
        "bank_deposit" => "cash_transfer",
        "other" => "review",
        _ => "operations",
    }
}

fn balance_sheet_impact(key: &str) -> &'static str {
    match key {
        "advance" => "Staff advance asset",
        "inventory_purchase" => "Inventory or supplier payable workflow",
        "fixed_asset_purchase" => "Fixed asset capitalisation",
        "gst_payment" => "Reduces tax payable",
        "statutory_payment" => "Reduces statutory payable",
        "security_deposit" => "Security deposit asset",
        "prepaid_expense" => "Prepaid asset",
        "loan" => "Reduces loan payable",
        "owner_drawing" => "Reduces owner equity",
        "bank_deposit" => "Cash or bank transfer",
        _ => "Expense reduces profit/equity",
    }
}

fn category_operating(key: &str) -> bool {
    !matches!(
        key,
        "advance"
            | "inventory_purchase"
            | "fixed_asset_purchase"
            | "gst_payment"
            | "statutory_payment"
            | "security_deposit"
            | "prepaid_expense"
            | "loan"
            | "owner_drawing"
            | "bank_deposit"
    )
}

fn custom_category_bucket(account_code: Option<&str>) -> &'static str {
    match account_code {
        Some("GST_PAYABLE") | Some("PAYROLL_STATUTORY_PAYABLE") => "tax",
        Some("PREPAID_EXPENSES") => "prepaid_asset",
        Some("LOANS_PAYABLE") => "loan",
        Some("OWNER_EQUITY") => "owner",
        _ => "custom",
    }
}

fn custom_balance_sheet_impact(account_code: Option<&str>, manual_entry: bool) -> &'static str {
    match account_code {
        Some("GST_PAYABLE") => "Reduces tax payable",
        Some("PAYROLL_STATUTORY_PAYABLE") => "Reduces statutory payable",
        Some("PREPAID_EXPENSES") => "Prepaid or deposit asset",
        Some("LOANS_PAYABLE") => "Reduces loan payable",
        Some("OWNER_EQUITY") => "Reduces owner equity",
        _ if manual_entry => "Expense reduces profit/equity",
        _ => "Existing workflow controls accounting",
    }
}

fn custom_category_operating(account_code: Option<&str>, manual_entry: bool) -> bool {
    manual_entry
        && !matches!(
            account_code,
            Some("GST_PAYABLE")
                | Some("PAYROLL_STATUTORY_PAYABLE")
                | Some("PREPAID_EXPENSES")
                | Some("LOANS_PAYABLE")
                | Some("OWNER_EQUITY")
        )
}

fn normalize_party_type(value: &str, allow_voucher: bool) -> Result<String, AppError> {
    let normalized_value = value.trim().to_ascii_lowercase();
    let normalized = match normalized_value.as_str() {
        "customer" => "client",
        "asset" | "loan" => "other",
        value => value,
    };
    if (allow_voucher && normalized == "voucher")
        || matches!(
            normalized,
            "none" | "vendor" | "staff" | "client" | "owner" | "other"
        )
    {
        Ok(normalized.into())
    } else if allow_voucher {
        Err(AppError::validation("invalid line linkedPartyType"))
    } else {
        Err(AppError::validation("invalid linkedPartyType"))
    }
}

fn payment_account_name(code: &str) -> &'static str {
    if code == "CASH_ON_HAND" {
        "Cash on Hand"
    } else {
        "Bank Clearing"
    }
}

fn normalize_payment_mode(value: &str) -> Result<String, AppError> {
    let canonical = match value.trim().to_ascii_lowercase().as_str() {
        "cash" => "Cash",
        "bank transfer" => "Bank Transfer",
        "upi" => "UPI",
        "card" => "Card",
        "cheque" => "Cheque",
        "neft" => "NEFT",
        "rtgs" => "RTGS",
        "imps" => "IMPS",
        "wallet" => "Wallet",
        "other" => "Other",
        _ => return Err(AppError::validation("invalid paymentMode")),
    };
    Ok(canonical.into())
}

fn valid_status(value: &str) -> bool {
    matches!(
        value,
        "draft" | "pending" | "approved" | "rejected" | "reversed" | "cancelled"
    )
}

fn require_approver(role: &str) -> Result<(), AppError> {
    if matches!(
        role.trim().to_ascii_lowercase().as_str(),
        "owner" | "admin" | "manager"
    ) {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "outgoing fund approval requires owner, admin, or manager role",
        ))
    }
}

fn approval_policy_reason(
    voucher: &OutgoingFundResponse,
    categories: &BTreeMap<String, OutgoingFundCategory>,
    actor: &str,
    role: &str,
) -> Result<String, AppError> {
    if voucher.created_by_user_id == actor
        || voucher
            .submitted_by_user_id
            .as_deref()
            .is_some_and(|id| id == actor)
    {
        return Err(AppError::conflict(
            "creator or submitter cannot approve the same outgoing voucher",
        ));
    }
    let role = role.trim().to_ascii_lowercase();
    if !matches!(role.as_str(), "owner" | "admin") && voucher.total_paise > 5_000_000 {
        return Err(AppError::forbidden(
            "manager approval limit is 50000 for outgoing vouchers",
        ));
    }
    for line in &voucher.lines {
        if let Some(threshold) = categories
            .get(&line.category_key)
            .and_then(|category| category.approval_threshold_paise)
        {
            if !matches!(role.as_str(), "owner" | "admin") && line.amount_paise > threshold {
                return Err(AppError::forbidden(
                    "this outgoing category requires owner or admin approval",
                ));
            }
        }
    }
    Ok(if matches!(role.as_str(), "owner" | "admin") {
        "owner_admin_policy"
    } else {
        "manager_limit_policy"
    }
    .into())
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AppError::validation(format!("{field} must use YYYY-MM-DD")))
}

fn parse_optional_date(value: Option<&str>, field: &str) -> Result<Option<NaiveDate>, AppError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    parse_date(value, field).map(Some)
}

fn optional_text(value: Option<&str>, max: usize, field: &str) -> Result<Option<String>, AppError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > max {
        return Err(AppError::validation(format!(
            "{field} must be at most {max} characters"
        )));
    }
    Ok(Some(value.into()))
}

fn clean_filter(value: Option<&str>, max: usize, field: &str) -> Result<String, AppError> {
    Ok(optional_text(value, max, field)?.unwrap_or_default())
}

fn validate_idempotency_key(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if !(8..=128).contains(&value.len())
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':')
        })
    {
        return Err(AppError::validation("idempotencyKey is invalid"));
    }
    Ok(value.into())
}

fn required_note(value: Option<&str>, field: &str) -> Result<String, AppError> {
    let note = optional_text(value, 500, field)?
        .ok_or_else(|| AppError::validation(format!("{field} is required")))?;
    if note.chars().count() < 3 {
        return Err(AppError::validation(format!(
            "{field} must be at least 3 characters"
        )));
    }
    Ok(note)
}

#[cfg(test)]
mod tests {
    use crate::models::outgoing_funds::OutgoingFundLineResponse;

    use super::{journal_lines, static_categories, validate_idempotency_key};

    #[test]
    fn categories_have_unique_keys_and_manual_accounts() {
        let categories = static_categories();
        let mut keys = categories
            .iter()
            .map(|category| category.key.as_str())
            .collect::<Vec<_>>();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), categories.len());
        assert!(categories
            .iter()
            .filter(|category| category.manual_entry)
            .all(|category| category.account_code.is_some()));
        assert!(categories
            .iter()
            .any(|category| category.key == "inventory_purchase" && !category.manual_entry));
    }

    #[test]
    fn idempotency_keys_are_provider_safe() {
        assert!(validate_idempotency_key("outgoing-12345678").is_ok());
        assert!(validate_idempotency_key("short").is_err());
        assert!(validate_idempotency_key("bad key!").is_err());
    }

    #[test]
    fn journal_posts_gross_cash_and_reverses_exactly() {
        let lines = vec![OutgoingFundLineResponse {
            id: "line-1".into(),
            line_number: 1,
            category_key: "rent".into(),
            category_label: "Rent / Lease".into(),
            category_bucket: "operations".into(),
            balance_sheet_impact: "Expense reduces profit/equity".into(),
            operating: true,
            account_code: "RENT_EXPENSE".into(),
            amount_paise: 11_800,
            gst_treatment: "cgst_sgst".into(),
            gst_paise: 1_800,
            net_paise: 10_000,
            subcategory: None,
            cost_center_id: None,
            department: None,
            linked_party_type: "voucher".into(),
            linked_party_id: None,
            linked_party_name: None,
            source_reference_type: None,
            source_reference_id: None,
            receipt_number: None,
            tax_invoice: true,
            reimbursement: false,
            remarks: None,
        }];
        let posted = journal_lines(&lines, "CASH_ON_HAND", false).unwrap();
        let reversed = journal_lines(&lines, "CASH_ON_HAND", true).unwrap();
        assert_eq!(
            posted.iter().map(|line| line.debit_paise).sum::<i64>(),
            11_800
        );
        assert_eq!(
            posted.iter().map(|line| line.credit_paise).sum::<i64>(),
            11_800
        );
        assert!(posted
            .iter()
            .zip(reversed.iter())
            .all(|(left, right)| left.account_code == right.account_code
                && left.debit_paise == right.credit_paise
                && left.credit_paise == right.debit_paise));
    }
}
