use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingFundLineRequest {
    pub category_key: String,
    pub amount_paise: i64,
    pub gst_treatment: Option<String>,
    pub gst_paise: Option<i64>,
    pub remarks: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingFundCreateRequest {
    pub business_date: String,
    pub payment_account_code: String,
    pub payment_mode: String,
    pub reference_number: Option<String>,
    pub cheque_number: Option<String>,
    pub cheque_date: Option<String>,
    pub linked_party_type: Option<String>,
    pub linked_party_id: Option<String>,
    pub linked_party_name: Option<String>,
    pub bill_reference: Option<String>,
    pub attachment_url: Option<String>,
    pub remarks: Option<String>,
    pub idempotency_key: String,
    pub submit: Option<bool>,
    pub lines: Vec<OutgoingFundLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingFundUpdateRequest {
    pub business_date: String,
    pub payment_account_code: String,
    pub payment_mode: String,
    pub reference_number: Option<String>,
    pub cheque_number: Option<String>,
    pub cheque_date: Option<String>,
    pub linked_party_type: Option<String>,
    pub linked_party_id: Option<String>,
    pub linked_party_name: Option<String>,
    pub bill_reference: Option<String>,
    pub attachment_url: Option<String>,
    pub remarks: Option<String>,
    pub version: i64,
    pub lines: Vec<OutgoingFundLineRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingFundDecisionRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundListQuery {
    pub q: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub status: Option<String>,
    pub category: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundCategory {
    pub key: String,
    pub label: String,
    pub account_code: Option<String>,
    pub manual_entry: bool,
    pub workflow_path: Option<String>,
    pub workflow_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundLineResponse {
    pub id: String,
    pub line_number: i32,
    pub category_key: String,
    pub category_label: String,
    pub account_code: String,
    pub amount_paise: i64,
    pub gst_treatment: String,
    pub gst_paise: i64,
    pub net_paise: i64,
    pub remarks: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundResponse {
    pub id: String,
    pub voucher_number: String,
    pub business_date: NaiveDate,
    pub payment_account_code: String,
    pub payment_account_name: String,
    pub payment_mode: String,
    pub reference_number: Option<String>,
    pub cheque_number: Option<String>,
    pub cheque_date: Option<NaiveDate>,
    pub linked_party_type: String,
    pub linked_party_id: Option<String>,
    pub linked_party_name: Option<String>,
    pub bill_reference: Option<String>,
    pub attachment_url: Option<String>,
    pub remarks: Option<String>,
    pub status: String,
    pub total_paise: i64,
    pub gst_paise: i64,
    pub journal_entry_id: Option<String>,
    pub reversal_journal_entry_id: Option<String>,
    pub version: i64,
    pub created_by_user_id: String,
    pub submitted_by_user_id: Option<String>,
    pub approved_by_user_id: Option<String>,
    pub rejected_by_user_id: Option<String>,
    pub reversed_by_user_id: Option<String>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub approved_at: Option<DateTime<Utc>>,
    pub rejected_at: Option<DateTime<Utc>>,
    pub reversed_at: Option<DateTime<Utc>>,
    pub rejection_reason: Option<String>,
    pub reversal_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub lines: Vec<OutgoingFundLineResponse>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundSummary {
    pub voucher_count: i64,
    pub total_paise: i64,
    pub pending_count: i64,
    pub input_gst_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundPageMeta {
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingFundPage {
    pub rows: Vec<OutgoingFundResponse>,
    pub summary: OutgoingFundSummary,
    pub meta: OutgoingFundPageMeta,
}
