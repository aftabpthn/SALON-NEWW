use std::collections::HashSet;

use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    config::Settings,
    models::common::AppError,
    repositories::{
        staff_configuration_repository::{
            self, AttendanceRuleRecord, CatalogOptionRecord, CommissionRuleRecord,
            LeavePolicyOverviewRecord, LeavePolicyRecord, PayRateRecord, ReplaceConfigurationInput,
            ReplaceStaffMastersInput, RoleOptionRecord, ShiftTemplateRecord, StaffCategoryRecord,
            StaffPricingLevelRecord,
        },
        staff_hr_repository::{self, BulkImportResult, BulkStaffInput},
        staff_repository::{
            self, AuthRoleOptionRecord, AuthRoleRecord, BranchRoleAssignmentInput,
            CreateStaffLoginInviteInput, ProvisionStaffLoginInput, StaffBranchAccessRecord,
            StaffLoginInviteRecord, StaffRecord,
        },
    },
    services::{
        auth_service::{self, TENANT_PERMISSION_CATALOG},
        invoice_delivery,
    },
};

pub(crate) fn is_supported_photo_url(url: &str) -> bool {
    if url.starts_with("/staff/files/") {
        return true;
    }
    if !(url.starts_with("https://") || url.starts_with('/')) {
        return false;
    }
    let path = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .to_ascii_lowercase();
    path.ends_with(".jpg") || path.ends_with(".jpeg") || path.ends_with(".png")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffConfigurationData {
    pub roles: Vec<RoleOptionRecord>,
    pub catalog: Vec<CatalogOptionRecord>,
    pub commission_rules: Vec<CommissionRuleRecord>,
    pub pay_rates: Vec<PayRateRecord>,
    pub leave_policies: Vec<LeavePolicyRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffMastersData {
    pub categories: Vec<StaffCategoryRecord>,
    pub pricing_levels: Vec<StaffPricingLevelRecord>,
    pub shift_templates: Vec<ShiftTemplateRecord>,
    pub attendance_rule: Option<AttendanceRuleRecord>,
    pub leave_policies: Vec<LeavePolicyOverviewRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffBranchAccessData {
    pub linked_login: bool,
    pub login_id: Option<String>,
    pub email: Option<String>,
    pub must_change_password: bool,
    pub branches: Vec<StaffBranchAccessRecord>,
    pub roles: Vec<AuthRoleOptionRecord>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPermissionOption {
    pub code: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub module: String,
    pub action: &'static str,
    pub scope: &'static str,
    pub sensitive: bool,
    pub feature_key: Option<&'static str>,
    pub route_mapping: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAuthRole {
    pub id: String,
    pub name: String,
    pub permissions: Vec<String>,
    pub denied_permissions: Vec<String>,
    pub masked_fields: Vec<String>,
    pub max_discount_paise: Option<i64>,
    pub max_refund_paise: Option<i64>,
    pub max_cash_movement_paise: Option<i64>,
    pub is_system: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMaskOption {
    pub code: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRoleManagementData {
    pub roles: Vec<ManagedAuthRole>,
    pub permission_options: Vec<AuthPermissionOption>,
    pub mask_options: Vec<AuthMaskOption>,
}

#[derive(Default)]
pub struct AuthRoleSecurityInput {
    pub denied_permissions: Vec<String>,
    pub masked_fields: Vec<String>,
    pub max_discount_paise: Option<i64>,
    pub max_refund_paise: Option<i64>,
    pub max_cash_movement_paise: Option<i64>,
}

const AUTH_MASK_OPTIONS: &[(&str, &str)] = &[
    ("client.contact", "Client phone and email"),
    ("staff.payroll", "Payroll amounts"),
    ("inventory.cost", "Inventory and purchase costs"),
    ("finance.amounts", "Finance and report amounts"),
];

pub struct BranchAccessAssignment {
    pub branch_id: String,
    pub role_id: Option<String>,
    pub access_type: String,
    pub valid_from: Option<NaiveDate>,
    pub valid_until: Option<NaiveDate>,
    pub is_default: bool,
    pub active: bool,
}

pub struct StaffLoginProvision {
    pub login_id: String,
    pub email: String,
    pub initial_password: String,
    pub role_id: String,
}

const STAFF_LOGIN_INVITE_TTL_HOURS: i64 = 72;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffLoginInvite {
    pub id: String,
    pub email: String,
    pub role_id: String,
    pub role_name: String,
    pub status: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub delivery_status: String,
    pub delivery_provider: String,
    pub provider_message_id: String,
    pub delivery_attempts: i32,
    pub last_delivery_error: String,
    pub last_sent_at: Option<DateTime<Utc>>,
    pub delivered_at: Option<DateTime<Utc>>,
    pub bounced_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accept_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffLoginInvitePreview {
    pub tenant_name: String,
    pub branch_name: String,
    pub staff_name: String,
    pub email: String,
    pub role_name: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug)]
pub struct StaffLoginInviteAcceptance {
    pub tenant_id: String,
    pub branch_id: String,
    pub staff_id: String,
    pub user_id: String,
    pub login_id: String,
}

pub async fn load_auth_roles(
    db: &PgPool,
    tenant_id: &str,
) -> Result<AuthRoleManagementData, AppError> {
    let roles = staff_repository::list_managed_auth_roles(db, tenant_id)
        .await
        .map_err(|_| AppError::internal("failed to load authentication roles"))?
        .into_iter()
        .map(managed_auth_role)
        .collect();
    Ok(AuthRoleManagementData {
        roles,
        permission_options: TENANT_PERMISSION_CATALOG
            .iter()
            .map(|permission| AuthPermissionOption {
                code: permission.code,
                label: permission.label,
                group: permission.group,
                module: permission.module().to_string(),
                action: permission.action(),
                scope: permission.scope(),
                sensitive: permission.sensitive(),
                feature_key: permission.feature_key(),
                route_mapping: permission.route_mapping(),
            })
            .collect(),
        mask_options: AUTH_MASK_OPTIONS
            .iter()
            .map(|(code, label)| AuthMaskOption { code, label })
            .collect(),
    })
}

pub async fn create_auth_role(
    db: &PgPool,
    tenant_id: &str,
    name: String,
    permissions: Vec<String>,
    security: AuthRoleSecurityInput,
) -> Result<AuthRoleManagementData, AppError> {
    let (name, permissions, security) = validate_auth_role(name, permissions, security)?;
    staff_repository::create_auth_role(
        db,
        tenant_id,
        &name,
        serde_json::json!(permissions),
        serde_json::json!(security.denied_permissions),
        serde_json::json!(security.masked_fields),
        security.max_discount_paise,
        security.max_refund_paise,
        security.max_cash_movement_paise,
    )
    .await
    .map_err(role_write_error)?;
    load_auth_roles(db, tenant_id).await
}

pub async fn update_auth_role(
    db: &PgPool,
    tenant_id: &str,
    role_id: &str,
    name: String,
    permissions: Vec<String>,
    security: AuthRoleSecurityInput,
) -> Result<AuthRoleManagementData, AppError> {
    let role = staff_repository::get_auth_role(db, tenant_id, role_id)
        .await
        .map_err(|_| AppError::internal("failed to load authentication role"))?
        .ok_or_else(|| AppError::not_found("authentication role was not found"))?;
    if role.is_system {
        return Err(AppError::forbidden("system roles cannot be edited"));
    }
    let (name, permissions, security) = validate_auth_role(name, permissions, security)?;
    staff_repository::update_auth_role(
        db,
        tenant_id,
        role_id,
        &name,
        serde_json::json!(permissions),
        serde_json::json!(security.denied_permissions),
        serde_json::json!(security.masked_fields),
        security.max_discount_paise,
        security.max_refund_paise,
        security.max_cash_movement_paise,
    )
    .await
    .map_err(role_write_error)?
    .ok_or_else(|| AppError::not_found("authentication role was not found"))?;
    load_auth_roles(db, tenant_id).await
}

fn validate_auth_role(
    name: String,
    permissions: Vec<String>,
    security: AuthRoleSecurityInput,
) -> Result<(String, Vec<String>, AuthRoleSecurityInput), AppError> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if !(2..=60).contains(&name.chars().count())
        || !name
            .chars()
            .all(|value| value.is_alphanumeric() || matches!(value, ' ' | '-' | '_' | '&'))
    {
        return Err(AppError::validation("role name is invalid"));
    }

    let requested = permissions
        .iter()
        .map(|permission| permission.trim())
        .filter(|permission| !permission.is_empty())
        .collect::<HashSet<_>>();
    if requested.is_empty() || requested.len() != permissions.len() {
        return Err(AppError::validation(
            "select one or more unique permissions",
        ));
    }
    if requested.iter().any(|permission| {
        !TENANT_PERMISSION_CATALOG
            .iter()
            .any(|allowed| allowed.code == *permission)
    }) {
        return Err(AppError::validation("one or more permissions are invalid"));
    }
    let permissions = TENANT_PERMISSION_CATALOG
        .iter()
        .filter(|permission| requested.contains(permission.code))
        .map(|permission| permission.code.to_string())
        .collect::<Vec<_>>();
    let denied = security
        .denied_permissions
        .iter()
        .map(|permission| permission.trim())
        .filter(|permission| !permission.is_empty())
        .collect::<HashSet<_>>();
    if denied.len() != security.denied_permissions.len()
        || denied.iter().any(|permission| {
            !TENANT_PERMISSION_CATALOG
                .iter()
                .any(|allowed| allowed.code == *permission)
        })
        || denied
            .iter()
            .any(|permission| permissions.iter().any(|allowed| allowed == permission))
    {
        return Err(AppError::validation(
            "denied permissions must be unique, valid, and not allowed",
        ));
    }
    let denied_permissions = TENANT_PERMISSION_CATALOG
        .iter()
        .filter(|permission| denied.contains(permission.code))
        .map(|permission| permission.code.to_string())
        .collect();
    let masked = security
        .masked_fields
        .iter()
        .map(|field| field.trim())
        .filter(|field| !field.is_empty())
        .collect::<HashSet<_>>();
    if masked.len() != security.masked_fields.len()
        || masked
            .iter()
            .any(|field| !AUTH_MASK_OPTIONS.iter().any(|(code, _)| code == field))
    {
        return Err(AppError::validation("one or more field masks are invalid"));
    }
    const MAX_ROLE_LIMIT_PAISE: i64 = 100_000_000_000;
    for value in [
        security.max_discount_paise,
        security.max_refund_paise,
        security.max_cash_movement_paise,
    ]
    .into_iter()
    .flatten()
    {
        if !(0..=MAX_ROLE_LIMIT_PAISE).contains(&value) {
            return Err(AppError::validation(
                "financial limits must be between zero and 100 crore rupees",
            ));
        }
    }
    Ok((
        name,
        permissions,
        AuthRoleSecurityInput {
            denied_permissions,
            masked_fields: AUTH_MASK_OPTIONS
                .iter()
                .filter(|(code, _)| masked.contains(code))
                .map(|(code, _)| (*code).to_string())
                .collect(),
            max_discount_paise: security.max_discount_paise,
            max_refund_paise: security.max_refund_paise,
            max_cash_movement_paise: security.max_cash_movement_paise,
        },
    ))
}

fn managed_auth_role(role: AuthRoleRecord) -> ManagedAuthRole {
    ManagedAuthRole {
        id: role.id,
        name: role.name,
        permissions: role
            .permissions_json
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|permission| permission.as_str().map(str::to_string))
            .collect(),
        denied_permissions: json_string_list(&role.denied_permissions_json),
        masked_fields: json_string_list(&role.masked_fields_json),
        max_discount_paise: role.max_discount_paise,
        max_refund_paise: role.max_refund_paise,
        max_cash_movement_paise: role.max_cash_movement_paise,
        is_system: role.is_system,
    }
}

fn json_string_list(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect()
}

fn role_write_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .is_some_and(|database_error| database_error.is_unique_violation())
    {
        AppError::conflict("a role with this name already exists")
    } else {
        AppError::internal("failed to save authentication role")
    }
}

pub async fn apply_bulk_import(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    batch_key: &str,
    requested_by: &str,
    rows: &[BulkStaffInput],
) -> Result<BulkImportResult, AppError> {
    if batch_key.trim().is_empty() || batch_key.len() > 120 {
        return Err(AppError::validation("invalid batchId"));
    }
    if rows.is_empty() || rows.len() > 500 {
        return Err(AppError::validation("bulk import supports 1 to 500 rows"));
    }
    if let Some(existing) =
        staff_hr_repository::find_bulk_import(db, tenant_id, branch_id, batch_key)
            .await
            .map_err(|_| AppError::internal("failed to load bulk import"))?
    {
        return Ok(existing);
    }
    let mut codes = HashSet::new();
    for row in rows {
        validate_bulk_row(row)?;
        if !codes.insert(row.employee_code.to_ascii_lowercase()) {
            return Err(AppError::validation("employeeCode values must be unique"));
        }
        if staff_hr_repository::employee_code_branch(db, tenant_id, &row.employee_code)
            .await
            .map_err(|_| AppError::internal("failed to validate employeeCode"))?
            .is_some_and(|existing_branch| existing_branch != branch_id)
        {
            return Err(AppError::conflict(format!(
                "employeeCode {} belongs to another branch",
                row.employee_code
            )));
        }
        validate_master_assignment(
            db,
            tenant_id,
            branch_id,
            "category",
            row.category_id.as_deref(),
        )
        .await?;
        validate_master_assignment(
            db,
            tenant_id,
            branch_id,
            "shift",
            row.shift_template_id.as_deref(),
        )
        .await?;
        if let Some(manager_id) = row.reporting_manager_id.as_deref() {
            staff_repository::get(db, tenant_id, branch_id, manager_id)
                .await
                .map_err(|_| AppError::internal("failed to validate reporting manager"))?
                .filter(|manager| manager.active)
                .ok_or_else(|| AppError::validation("invalid reportingManagerId"))?;
        }
    }
    staff_hr_repository::apply_bulk_import(db, tenant_id, branch_id, batch_key, requested_by, rows)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|db_error| db_error.is_unique_violation())
            {
                AppError::conflict("bulk import conflicts with existing staff data")
            } else {
                AppError::internal("failed to apply bulk import")
            }
        })
}

fn validate_bulk_row(row: &BulkStaffInput) -> Result<(), AppError> {
    let today = Utc::now().date_naive();
    if row.employee_code.is_empty()
        || row.employee_code.chars().count() > 80
        || row.first_name.is_empty()
        || row.first_name.chars().count() > 120
        || row
            .last_name
            .as_ref()
            .is_some_and(|value| value.chars().count() > 120)
        || row
            .department
            .as_ref()
            .is_some_and(|value| value.chars().count() > 120)
    {
        return Err(AppError::validation("invalid bulk staff identity fields"));
    }
    if row
        .email
        .as_ref()
        .is_some_and(|value| value.len() > 254 || !value.contains('@'))
    {
        return Err(AppError::validation("invalid email in bulk import"));
    }
    if row.date_of_birth.is_some_and(|date| date > today)
        || row.joining_date.is_some_and(|date| date > today)
    {
        return Err(AppError::validation(
            "bulk import dates cannot be in the future",
        ));
    }
    if row.gender.as_deref().is_some_and(|value| {
        !matches!(
            value,
            "female" | "male" | "non_binary" | "prefer_not_to_say"
        )
    }) || row
        .employment_type
        .as_deref()
        .is_some_and(|value| !matches!(value, "full_time" | "part_time" | "contract" | "intern"))
    {
        return Err(AppError::validation("invalid HR option in bulk import"));
    }
    if row
        .photo_url
        .as_deref()
        .is_some_and(|url| url.len() > 2048 || !is_supported_photo_url(url))
    {
        return Err(AppError::validation("invalid photoUrl in bulk import"));
    }
    Ok(())
}

pub async fn load_masters(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<StaffMastersData, AppError> {
    let (categories, pricing_levels, shift_templates, attendance_rule, leave_policies) =
        tokio::try_join!(
            staff_configuration_repository::list_staff_categories(db, tenant_id, branch_id),
            staff_configuration_repository::list_staff_pricing_levels(db, tenant_id, branch_id),
            staff_configuration_repository::list_shift_templates(db, tenant_id, branch_id),
            staff_configuration_repository::get_attendance_rule(db, tenant_id, branch_id),
            staff_configuration_repository::list_leave_policy_overview(db, tenant_id, branch_id),
        )
        .map_err(|_| AppError::internal("failed to load staff masters"))?;
    Ok(StaffMastersData {
        categories,
        pricing_levels,
        shift_templates,
        attendance_rule,
        leave_policies,
    })
}

pub async fn save_masters(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    input: ReplaceStaffMastersInput,
) -> Result<StaffMastersData, AppError> {
    validate_masters(&input)?;
    staff_configuration_repository::save_staff_masters(db, tenant_id, branch_id, input)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|db_error| db_error.is_unique_violation())
            {
                AppError::conflict("staff master code already exists")
            } else {
                AppError::internal("failed to save staff masters")
            }
        })?;
    load_masters(db, tenant_id, branch_id).await
}

pub async fn validate_master_assignment(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    kind: &str,
    id: Option<&str>,
) -> Result<(), AppError> {
    let Some(id) = id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(());
    };
    if staff_configuration_repository::master_id_belongs_to_scope(
        db, kind, tenant_id, branch_id, id,
    )
    .await
    .map_err(|_| AppError::internal("failed to validate staff master assignment"))?
    {
        Ok(())
    } else {
        Err(AppError::validation(format!("invalid {kind} assignment")))
    }
}

pub async fn load_configuration(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<StaffConfigurationData, AppError> {
    ensure_staff_exists(db, tenant_id, branch_id, staff_id).await?;
    let (roles, catalog, commission_rules, pay_rates, leave_policies) = tokio::try_join!(
        staff_configuration_repository::list_roles(db, tenant_id, staff_id),
        staff_configuration_repository::list_catalog(db, tenant_id, branch_id, staff_id),
        staff_configuration_repository::list_commission_rules(db, tenant_id, branch_id, staff_id),
        staff_configuration_repository::list_pay_rates(db, tenant_id, branch_id, staff_id),
        staff_configuration_repository::list_leave_policies(db, tenant_id, branch_id, staff_id),
    )
    .map_err(|_| AppError::internal("failed to load staff configuration"))?;
    Ok(StaffConfigurationData {
        roles,
        catalog,
        commission_rules,
        pay_rates,
        leave_policies,
    })
}

pub async fn load_branch_access(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<StaffBranchAccessData, AppError> {
    let staff = staff_repository::get(db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .ok_or_else(|| AppError::not_found("staff was not found"))?;
    let (login, branches, roles) = tokio::try_join!(
        staff_repository::find_staff_login(db, tenant_id, branch_id, staff_id),
        staff_repository::list_branch_access(db, tenant_id, staff.user_id.as_deref()),
        staff_repository::list_auth_roles(db, tenant_id),
    )
    .map_err(|_| AppError::internal("failed to load employee branch access"))?;
    Ok(StaffBranchAccessData {
        linked_login: login.is_some(),
        login_id: login.as_ref().and_then(|item| item.login_id.clone()),
        email: login.as_ref().map(|item| item.email.clone()),
        must_change_password: login.as_ref().is_some_and(|item| item.must_change_password),
        branches,
        roles,
    })
}

pub async fn provision_login(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    input: StaffLoginProvision,
) -> Result<StaffBranchAccessData, AppError> {
    let staff = staff_repository::get(db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .ok_or_else(|| AppError::not_found("staff was not found"))?;
    if !staff.active {
        return Err(AppError::conflict(
            "inactive employee cannot receive a login",
        ));
    }
    if staff
        .user_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(AppError::conflict("employee already has a linked login"));
    }

    let login_id = normalize_login_id(&input.login_id)?;
    let email = normalize_login_email(&input.email)?;
    let role_id = input.role_id.trim();
    if role_id.is_empty() {
        return Err(AppError::validation("roleId is required"));
    }
    if !auth_service::password_meets_policy(&input.initial_password) {
        return Err(AppError::validation(
            "initialPassword must contain 12 to 128 characters",
        ));
    }
    let password_hash = auth_service::hash_password(&input.initial_password)
        .map_err(|_| AppError::internal("failed to secure password"))?;
    let full_name = [
        staff.first_name.trim(),
        staff.middle_name.trim(),
        staff.last_name.trim(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ");

    staff_repository::provision_staff_login(
        db,
        &ProvisionStaffLoginInput {
            tenant_id,
            branch_id,
            staff_id,
            login_id: &login_id,
            email: &email,
            password_hash: &password_hash,
            full_name: &full_name,
            role_id,
        },
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database_error| database_error.is_unique_violation())
        {
            AppError::conflict("login ID or email is already in use")
        } else if matches!(error, sqlx::Error::RowNotFound) {
            AppError::conflict("employee branch or role is no longer available")
        } else {
            AppError::internal("failed to create employee login")
        }
    })?;
    load_branch_access(db, tenant_id, branch_id, staff_id).await
}

pub async fn issue_login_invite(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
    email: &str,
    role_id: &str,
) -> Result<StaffLoginInvite, AppError> {
    let email = normalize_login_email(email)?;
    let role_id = role_id.trim();
    if role_id.is_empty() {
        return Err(AppError::validation("roleId is required"));
    }
    let token = Uuid::new_v4().simple().to_string();
    let id = staff_repository::create_staff_login_invite(
        db,
        &CreateStaffLoginInviteInput {
            tenant_id,
            branch_id,
            staff_id,
            role_id,
            email: &email,
            token_hash: &auth_service::token_hash(&token),
            expires_at: Utc::now() + chrono::Duration::hours(STAFF_LOGIN_INVITE_TTL_HOURS),
            actor_user_id,
        },
    )
    .await
    .map_err(|error| {
        if matches!(error, sqlx::Error::RowNotFound) {
            AppError::conflict("employee branch or role is no longer available")
        } else {
            AppError::internal("failed to create employee invitation")
        }
    })?;
    deliver_login_invite(db, settings, tenant_id, &id, &token).await?;
    let invite = staff_repository::staff_login_invite_by_id(db, tenant_id, &id)
        .await
        .map_err(|_| AppError::internal("failed to load employee invitation"))?
        .ok_or_else(|| AppError::internal("created employee invitation was not found"))?;
    Ok(login_invite(invite, Some(format!("/staff-invite/{token}"))))
}

pub async fn resend_login_invite(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
) -> Result<StaffLoginInvite, AppError> {
    let previous = staff_repository::latest_staff_login_invite(db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to load employee invitation"))?
        .ok_or_else(|| AppError::not_found("employee invitation was not found"))?;
    issue_login_invite(
        db,
        settings,
        tenant_id,
        branch_id,
        staff_id,
        actor_user_id,
        &previous.email,
        &previous.role_id,
    )
    .await
}

pub async fn load_login_invite(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<Option<StaffLoginInvite>, AppError> {
    Ok(
        staff_repository::latest_staff_login_invite(db, tenant_id, branch_id, staff_id)
            .await
            .map_err(|_| AppError::internal("failed to load employee invitation"))?
            .map(|invite| login_invite(invite, None)),
    )
}

pub async fn revoke_login_invite(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    actor_user_id: &str,
) -> Result<StaffLoginInvite, AppError> {
    if !staff_repository::revoke_staff_login_invite(
        db,
        tenant_id,
        branch_id,
        staff_id,
        actor_user_id,
    )
    .await
    .map_err(|_| AppError::internal("failed to revoke employee invitation"))?
    {
        return Err(AppError::conflict(
            "no pending employee invitation was found",
        ));
    }
    load_login_invite(db, tenant_id, branch_id, staff_id)
        .await?
        .ok_or_else(|| AppError::internal("revoked employee invitation was not found"))
}

pub async fn preview_login_invite(
    db: &PgPool,
    token: &str,
) -> Result<StaffLoginInvitePreview, AppError> {
    let token = valid_invite_token(token)?;
    let preview =
        staff_repository::preview_staff_login_invite(db, &auth_service::token_hash(token))
            .await
            .map_err(|_| AppError::internal("failed to load employee invitation"))?
            .ok_or_else(|| AppError::not_found("invitation is invalid or expired"))?;
    Ok(StaffLoginInvitePreview {
        tenant_name: preview.tenant_name,
        branch_name: preview.branch_name,
        staff_name: preview.staff_name,
        email: preview.email,
        role_name: preview.role_name,
        expires_at: preview.expires_at,
    })
}

pub async fn accept_login_invite(
    db: &PgPool,
    token: &str,
    login_id: &str,
    password: &str,
) -> Result<StaffLoginInviteAcceptance, AppError> {
    let token = valid_invite_token(token)?;
    let login_id = normalize_login_id(login_id)?;
    if !auth_service::password_meets_policy(password) {
        return Err(AppError::validation(
            "password must contain 12 to 128 characters",
        ));
    }
    let password_hash = auth_service::hash_password(password)
        .map_err(|_| AppError::internal("failed to secure password"))?;
    let accepted = staff_repository::accept_staff_login_invite(
        db,
        &auth_service::token_hash(token),
        &login_id,
        &password_hash,
    )
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|database_error| database_error.is_unique_violation())
        {
            AppError::conflict("login ID or email is already in use")
        } else if matches!(error, sqlx::Error::RowNotFound) {
            AppError::not_found("invitation is invalid or expired")
        } else {
            AppError::internal("failed to accept employee invitation")
        }
    })?;
    Ok(StaffLoginInviteAcceptance {
        tenant_id: accepted.tenant_id,
        branch_id: accepted.branch_id,
        staff_id: accepted.staff_id,
        user_id: accepted.user_id,
        login_id,
    })
}

fn valid_invite_token(token: &str) -> Result<&str, AppError> {
    let token = token.trim();
    if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::not_found("invitation is invalid or expired"));
    }
    Ok(token)
}

fn login_invite(record: StaffLoginInviteRecord, accept_path: Option<String>) -> StaffLoginInvite {
    StaffLoginInvite {
        id: record.id,
        email: record.email,
        role_id: record.role_id,
        role_name: record.role_name,
        status: record.status,
        expires_at: record.expires_at,
        created_at: record.created_at,
        accepted_at: record.accepted_at,
        revoked_at: record.revoked_at,
        delivery_status: record.delivery_status,
        delivery_provider: record.delivery_provider,
        provider_message_id: record.provider_message_id,
        delivery_attempts: record.delivery_attempts,
        last_delivery_error: record.last_delivery_error,
        last_sent_at: record.last_sent_at,
        delivered_at: record.delivered_at,
        bounced_at: record.bounced_at,
        accept_path,
    }
}

async fn deliver_login_invite(
    db: &PgPool,
    settings: &Settings,
    tenant_id: &str,
    invitation_id: &str,
    token: &str,
) -> Result<(), AppError> {
    if !settings.smtp_email_enabled()
        && (settings.invoice_delivery_webhook_url.is_none()
            || settings.invoice_delivery_webhook_token.is_none())
    {
        return Ok(());
    }
    let preview = preview_login_invite(db, token).await?;
    let accept_url = format!("{}/staff-invite/{token}", settings.crm_app_base_url);
    let subject = format!("{} staff login invitation", preview.tenant_name);
    let message = format!(
        "Hello {},\n\n{} invited you to {} as {}. Create your login within 72 hours:\n{}\n",
        preview.staff_name, preview.tenant_name, preview.branch_name, preview.role_name, accept_url
    );
    let payload = json!({
        "channel": "email",
        "templateKind": "staff_login_invite",
        "recipient": preview.email,
        "subject": subject,
        "message": message,
        "html": staff_invite_email_html(&preview, &accept_url),
        "invitationId": invitation_id,
        "tenantId": tenant_id,
        "acceptUrl": accept_url
    });
    let delivery = invoice_delivery::deliver(settings, &payload).await;
    let (status, message_id, error) = match delivery {
        Ok(message_id) if !message_id.trim().is_empty() => ("sent", message_id, ""),
        Ok(_) => (
            "failed",
            String::new(),
            "email provider did not return a message id",
        ),
        Err(_) => (
            "failed",
            String::new(),
            "email provider did not accept the invitation",
        ),
    };
    staff_repository::record_staff_login_invite_delivery_attempt(
        db,
        tenant_id,
        invitation_id,
        status,
        &message_id,
        error,
    )
    .await
    .map_err(|_| AppError::internal("failed to record invitation delivery"))
}

fn staff_invite_email_html(preview: &StaffLoginInvitePreview, accept_url: &str) -> String {
    let tenant = html_escape(&preview.tenant_name);
    let branch = html_escape(&preview.branch_name);
    let staff = html_escape(&preview.staff_name);
    let role = html_escape(&preview.role_name);
    let url = html_escape(accept_url);
    format!(
        r#"<!doctype html><html><body style="margin:0;background:#f5f3ff;font-family:Arial,sans-serif;color:#201a36"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e5e1f4"><tr><td style="padding:32px"><div style="font-size:22px;font-weight:700;color:#6d28d9">AuraShine CRM</div><h1 style="font-size:24px;margin:24px 0 12px">Create your staff login</h1><p>Hello {staff},</p><p><strong>{tenant}</strong> invited you to <strong>{branch}</strong> as <strong>{role}</strong>.</p><p style="margin:28px 0"><a href="{url}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;padding:14px 22px;border-radius:9px;font-weight:700">Create secure login</a></p><p style="font-size:13px;color:#665f78">This single-use link expires in 72 hours. If you did not expect this invitation, ignore this email.</p></td></tr></table></td></tr></table></body></html>"#
    )
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod invite_email_tests {
    use super::html_escape;

    #[test]
    fn escapes_html_attributes_and_text() {
        assert_eq!(
            html_escape("<A & B> \"team\"'"),
            "&lt;A &amp; B&gt; &quot;team&quot;&#39;"
        );
    }
}

pub(crate) fn normalize_login_id(value: &str) -> Result<String, AppError> {
    let login_id = value.trim().to_ascii_lowercase();
    if !(3..=80).contains(&login_id.len())
        || !login_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(AppError::validation(
            "loginId must use 3 to 80 letters, numbers, dots, underscores or hyphens",
        ));
    }
    Ok(login_id)
}

pub(crate) fn normalize_login_email(value: &str) -> Result<String, AppError> {
    let email = value.trim().to_ascii_lowercase();
    let valid = email.len() <= 254
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && !domain.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
                && !email.chars().any(char::is_whitespace)
        });
    if !valid {
        return Err(AppError::validation("a valid real email is required"));
    }
    Ok(email)
}

pub async fn save_branch_access(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    assignments: Vec<BranchAccessAssignment>,
) -> Result<StaffBranchAccessData, AppError> {
    let staff = staff_repository::get(db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .ok_or_else(|| AppError::not_found("staff was not found"))?;
    let user_id = staff
        .user_id
        .as_deref()
        .filter(|_| staff.active)
        .ok_or_else(|| AppError::conflict("employee has no active linked login"))?;
    if !has_linked_login(db, tenant_id, Some(user_id)).await? {
        return Err(AppError::conflict("employee has no active linked login"));
    }

    let (branches, roles) = tokio::try_join!(
        staff_repository::list_branch_access(db, tenant_id, Some(user_id)),
        staff_repository::list_auth_roles(db, tenant_id),
    )
    .map_err(|_| AppError::internal("failed to validate employee branch access"))?;
    let branch_ids = branches
        .iter()
        .map(|branch| branch.branch_id.as_str())
        .collect::<HashSet<_>>();
    let role_ids = roles
        .iter()
        .map(|role| role.id.as_str())
        .collect::<HashSet<_>>();
    let assignments = validate_branch_access(assignments, &branch_ids, &role_ids)?;

    staff_repository::replace_branch_access(db, tenant_id, user_id, &assignments)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|db_error| db_error.is_unique_violation())
            {
                AppError::conflict("default branch access already exists")
            } else if matches!(error, sqlx::Error::RowNotFound) {
                AppError::validation("one or more roles are not assignable to employees")
            } else {
                AppError::internal("failed to save employee branch access")
            }
        })?;
    load_branch_access(db, tenant_id, branch_id, staff_id).await
}

fn validate_branch_access(
    assignments: Vec<BranchAccessAssignment>,
    branch_ids: &HashSet<&str>,
    role_ids: &HashSet<&str>,
) -> Result<Vec<BranchRoleAssignmentInput>, AppError> {
    if assignments.len() > 500 {
        return Err(AppError::validation(
            "branch access supports up to 500 assignments",
        ));
    }

    let mut seen = HashSet::new();
    let mut active_count = 0;
    let mut default_count = 0;
    let mut normalized = Vec::new();
    for assignment in assignments {
        let branch_id = assignment.branch_id.trim();
        let role_id = assignment
            .role_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if branch_id.is_empty()
            || !seen.insert(branch_id.to_string())
            || !branch_ids.contains(branch_id)
        {
            return Err(AppError::validation("one or more branches are invalid"));
        }
        if assignment.is_default && !assignment.active {
            return Err(AppError::validation("default branch must be active"));
        }
        if assignment.active {
            active_count += 1;
            default_count += usize::from(assignment.is_default);
        }
        let Some(role_id) = role_id else {
            if assignment.active {
                return Err(AppError::validation("active branch requires a role"));
            }
            continue;
        };
        if !role_ids.contains(role_id) {
            return Err(AppError::validation("one or more roles are invalid"));
        }
        let access_type = assignment.access_type.trim().to_ascii_lowercase();
        let (valid_from, valid_until) = match access_type.as_str() {
            "permanent" => {
                if assignment.valid_from.is_some() || assignment.valid_until.is_some() {
                    return Err(AppError::validation(
                        "permanent access cannot have deputation dates",
                    ));
                }
                (None, None)
            }
            "deputation" => {
                let (Some(valid_from), Some(valid_until)) =
                    (assignment.valid_from, assignment.valid_until)
                else {
                    return Err(AppError::validation(
                        "deputation requires validFrom and validUntil",
                    ));
                };
                if valid_until < valid_from {
                    return Err(AppError::validation(
                        "deputation validUntil must be on or after validFrom",
                    ));
                }
                if assignment.is_default {
                    return Err(AppError::validation(
                        "default branch access must be permanent",
                    ));
                }
                (Some(valid_from), Some(valid_until))
            }
            _ => {
                return Err(AppError::validation(
                    "accessType must be permanent or deputation",
                ));
            }
        };
        normalized.push(BranchRoleAssignmentInput {
            branch_id: branch_id.to_string(),
            role_id: role_id.to_string(),
            access_type,
            valid_from,
            valid_until,
            is_default: assignment.is_default,
            active: assignment.active,
        });
    }
    if active_count > 0 && default_count != 1 {
        return Err(AppError::validation(
            "exactly one active branch must be default",
        ));
    }
    Ok(normalized)
}

pub async fn save_configuration(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    input: ReplaceConfigurationInput,
) -> Result<StaffConfigurationData, AppError> {
    ensure_staff_exists(db, tenant_id, branch_id, staff_id).await?;
    validate_configuration(&input)?;
    if !staff_configuration_repository::role_ids_belong_to_tenant(db, tenant_id, &input.role_ids)
        .await
        .map_err(|_| AppError::internal("failed to validate employee roles"))?
    {
        return Err(AppError::validation("one or more roles are invalid"));
    }
    for item in &input.catalog_assignments {
        let valid = staff_configuration_repository::catalog_item_belongs_to_scope(
            db,
            tenant_id,
            branch_id,
            &item.item_type,
            &item.item_id,
        )
        .await
        .map_err(|_| AppError::internal("failed to validate catalog assignment"))?;
        if !valid {
            return Err(AppError::validation(
                "one or more catalog items are invalid",
            ));
        }
    }
    staff_configuration_repository::replace_configuration(
        db, tenant_id, branch_id, staff_id, input,
    )
    .await
    .map_err(|_| AppError::internal("failed to save staff configuration"))?;
    load_configuration(db, tenant_id, branch_id, staff_id).await
}

async fn ensure_staff_exists(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<(), AppError> {
    staff_repository::get(db, tenant_id, branch_id, staff_id)
        .await
        .map_err(|_| AppError::internal("failed to load staff"))?
        .map(|_| ())
        .ok_or_else(|| AppError::not_found("staff was not found"))
}

fn validate_configuration(input: &ReplaceConfigurationInput) -> Result<(), AppError> {
    if input.role_ids.len() > 50
        || input.catalog_assignments.len() > 500
        || input.commission_rules.len() > 100
        || input.pay_rates.len() > 100
        || input.leave_policies.len() > 100
    {
        return Err(AppError::validation("staff configuration is too large"));
    }
    if !all_unique(input.role_ids.iter().map(String::as_str))
        || !all_unique(
            input
                .catalog_assignments
                .iter()
                .map(|item| format!("{}:{}", item.item_type, item.item_id)),
        )
    {
        return Err(AppError::validation(
            "staff configuration contains duplicates",
        ));
    }
    for item in &input.catalog_assignments {
        if !matches!(
            item.item_type.as_str(),
            "service" | "product" | "membership" | "package"
        ) || item.item_id.trim().is_empty()
            || item
                .commission_percent
                .is_some_and(|rate| !(0..=100).contains(&rate))
            || item
                .pricing_level_price_paise
                .is_some_and(|price| price < 0)
        {
            return Err(AppError::validation("invalid catalog assignment"));
        }
    }
    for rule in &input.commission_rules {
        if rule.name.trim().is_empty()
            || !matches!(
                rule.applies_to.as_str(),
                "all" | "service" | "product" | "membership" | "package"
            )
            || !(0..=100).contains(&rule.rate_percent)
        {
            return Err(AppError::validation("invalid commission rule"));
        }
    }
    for rate in &input.pay_rates {
        if !matches!(rate.rate_type.as_str(), "hourly" | "daily" | "monthly")
            || rate.amount_paise < 0
        {
            return Err(AppError::validation("invalid pay rate"));
        }
    }
    for policy in &input.leave_policies {
        if policy.name.trim().is_empty()
            || !matches!(
                policy.leave_type.as_str(),
                "annual" | "sick" | "casual" | "special" | "unpaid"
            )
            || policy.annual_days < 0
        {
            return Err(AppError::validation("invalid leave policy"));
        }
    }
    Ok(())
}

fn validate_masters(input: &ReplaceStaffMastersInput) -> Result<(), AppError> {
    if input.categories.len() > 100
        || input.pricing_levels.len() > 50
        || input.shift_templates.len() > 100
    {
        return Err(AppError::validation("staff masters are too large"));
    }
    if !all_unique(input.categories.iter().map(|item| item.code.as_str()))
        || !all_unique(input.pricing_levels.iter().map(|item| item.code.as_str()))
        || !all_unique(input.shift_templates.iter().map(|item| item.code.as_str()))
    {
        return Err(AppError::validation("staff master codes must be unique"));
    }
    for category in &input.categories {
        if !valid_master_code(&category.code)
            || category.name.trim().is_empty()
            || category.name.chars().count() > 100
            || category.designation.chars().count() > 100
        {
            return Err(AppError::validation("invalid staff category"));
        }
    }
    for level in &input.pricing_levels {
        if !valid_master_code(&level.code)
            || level.name.trim().is_empty()
            || level.name.chars().count() > 100
            || !(0..=1000).contains(&level.rank)
        {
            return Err(AppError::validation("invalid staff pricing level"));
        }
    }
    for shift in &input.shift_templates {
        if !valid_master_code(&shift.code)
            || shift.name.trim().is_empty()
            || shift.name.chars().count() > 100
            || shift.shift1_start >= shift.shift1_end
            || shift.shift2_start.is_some() != shift.shift2_end.is_some()
            || shift
                .shift2_start
                .zip(shift.shift2_end)
                .is_some_and(|(start, end)| start >= end)
            || !(0..=480).contains(&shift.break_minutes)
            || shift
                .weekly_off_days
                .iter()
                .any(|day| !(0..=6).contains(day))
            || !all_unique(shift.weekly_off_days.iter())
        {
            return Err(AppError::validation("invalid shift template"));
        }
    }
    let rule = &input.attendance_rule;
    let minutes = [
        rule.grace_minutes,
        rule.half_day_after_minutes,
        rule.absent_after_minutes,
        rule.overtime_after_minutes,
        rule.early_leave_grace_minutes,
        rule.minimum_overtime_minutes,
        rule.maximum_overtime_minutes,
    ];
    if minutes.iter().any(|value| !(0..=1440).contains(value))
        || !matches!(rule.overtime_rounding_minutes, 0 | 5 | 10 | 15 | 30 | 60)
        || (rule.half_day_after_minutes > 0
            && rule.absent_after_minutes > 0
            && rule.absent_after_minutes < rule.half_day_after_minutes)
    {
        return Err(AppError::validation("invalid attendance rules"));
    }
    Ok(())
}

fn valid_master_code(value: &str) -> bool {
    (2..=30).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}

fn all_unique<T: Eq + std::hash::Hash>(values: impl Iterator<Item = T>) -> bool {
    let mut seen = HashSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

const LINKED_ACTIVE_USER_SQL: &str = r#"
    SELECT u.id
    FROM staff s
    JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id=$1 AND s.branch_id=$2 AND s.id=$3 AND u.active=TRUE
    FOR UPDATE OF s, u
"#;

pub async fn has_linked_login(
    db: &PgPool,
    tenant_id: &str,
    user_id: Option<&str>,
) -> Result<bool, AppError> {
    let Some(user_id) = user_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(false);
    };

    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND id=$2 AND active=TRUE)",
    )
    .bind(tenant_id)
    .bind(user_id)
    .fetch_one(db)
    .await
    .map_err(|_| AppError::internal("failed to load employee login"))
}

pub async fn set_password(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
    new_password: &str,
    must_change_password: bool,
) -> Result<(), AppError> {
    if !auth_service::password_meets_policy(new_password) {
        return Err(AppError::validation(
            "newPassword must contain 12 to 128 characters",
        ));
    }

    let password_hash = auth_service::hash_password(new_password)
        .map_err(|_| AppError::internal("failed to secure password"))?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start password update"))?;
    let user_id = linked_active_user_id(&mut tx, tenant_id, branch_id, staff_id).await?;

    sqlx::query(
        "UPDATE users SET password_hash=$1, must_change_password=$4, password_changed_at=CASE WHEN $4 THEN NULL ELSE NOW() END, failed_login_count=0, locked_until=NULL, updated_at=NOW() WHERE tenant_id=$2 AND id=$3",
    )
    .bind(password_hash)
    .bind(tenant_id)
    .bind(&user_id)
    .bind(must_change_password)
    .execute(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to update employee password"))?;
    revoke_user_sessions(&mut tx, tenant_id, &user_id).await?;
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit password update"))?;
    Ok(())
}

pub async fn terminate(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<StaffRecord, AppError> {
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start staff termination"))?;
    let mut staff = sqlx::query_as::<_, StaffRecord>(
        r#"
        SELECT id, tenant_id, branch_id, user_id, employee_code, first_name, middle_name, last_name,
               appointment_display_name, email, mobile_phone, home_phone, work_phone,
               job_title, active, created_at, updated_at
        FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3 FOR UPDATE
        "#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(staff_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to load staff"))?
    .ok_or_else(|| AppError::not_found("staff was not found"))?;
    sqlx::query(
        "UPDATE staff SET active=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND branch_id=$3",
    )
        .bind(staff_id)
        .bind(tenant_id)
        .bind(branch_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to terminate staff"))?;
    if let Some(user_id) = staff.user_id.as_deref() {
        sqlx::query(
            "UPDATE user_branch_roles SET active=FALSE, is_default=FALSE, updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND branch_id=$3 AND active=TRUE",
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(branch_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to remove employee branch access"))?;
        let has_other_branch_access = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM user_branch_roles WHERE tenant_id=$1 AND user_id=$2 AND active=TRUE)",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to validate remaining employee access"))?;
        if !has_other_branch_access {
            sqlx::query(
                "UPDATE users SET active=FALSE, updated_at=NOW() WHERE tenant_id=$1 AND id=$2",
            )
            .bind(tenant_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AppError::internal("failed to deactivate employee login"))?;
        }
        revoke_user_sessions(&mut tx, tenant_id, user_id).await?;
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit staff termination"))?;
    staff.active = false;
    Ok(staff)
}

async fn linked_active_user_id(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<String, AppError> {
    sqlx::query_scalar(LINKED_ACTIVE_USER_SQL)
        .bind(tenant_id)
        .bind(branch_id)
        .bind(staff_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to load employee login"))?
        .ok_or_else(|| AppError::not_found("employee has no active linked login"))
}

async fn revoke_user_sessions(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    user_id: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE auth_refresh_tokens SET revoked_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL")
        .bind(tenant_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| AppError::internal("failed to revoke employee sessions"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use chrono::{NaiveDate, NaiveTime};

    use super::{
        normalize_login_email, normalize_login_id, valid_invite_token, validate_auth_role,
        validate_branch_access, validate_bulk_row, validate_configuration, validate_masters,
        AuthRoleSecurityInput, BranchAccessAssignment, LINKED_ACTIVE_USER_SQL,
    };
    use crate::repositories::staff_configuration_repository::{
        AttendanceRuleInput, PayRateInput, ReplaceConfigurationInput, ReplaceStaffMastersInput,
        ShiftTemplateInput, StaffCategoryInput,
    };
    use crate::repositories::staff_hr_repository::BulkStaffInput;
    use crate::repositories::staff_repository::is_staff_assignable_role_name;

    #[test]
    fn configuration_rejects_negative_pay_rate() {
        let input = ReplaceConfigurationInput {
            role_ids: vec![],
            catalog_assignments: vec![],
            commission_rules: vec![],
            pay_rates: vec![PayRateInput {
                rate_type: "hourly".into(),
                amount_paise: -1,
                effective_from: None,
                active: true,
            }],
            leave_policies: vec![],
        };
        assert!(validate_configuration(&input).is_err());
    }

    #[test]
    fn linked_login_lookup_uses_permanent_user_id() {
        assert!(LINKED_ACTIVE_USER_SQL.contains("u.id = s.user_id"));
        assert!(LINKED_ACTIVE_USER_SQL.contains("u.tenant_id = s.tenant_id"));
        assert!(!LINKED_ACTIVE_USER_SQL
            .to_ascii_lowercase()
            .contains("email"));
    }

    #[test]
    fn staff_login_identity_requires_safe_real_values() {
        assert_eq!(
            normalize_login_id("  Aftab.Staff-1 ").unwrap(),
            "aftab.staff-1"
        );
        assert!(normalize_login_id("bad login").is_err());
        assert_eq!(
            normalize_login_email(" AFTAB@EXAMPLE.COM ").unwrap(),
            "aftab@example.com"
        );
        assert!(normalize_login_email("staff.local").is_err());
    }

    #[test]
    fn staff_security_employee_login_rejects_protected_management_roles() {
        for role in [
            "Owner",
            "admin",
            "Super Admin",
            "super-admin",
            "super_admin",
        ] {
            assert!(!is_staff_assignable_role_name(role));
        }
        for role in ["manager", "staff", "Senior Stylist", "staffappadmin"] {
            assert!(is_staff_assignable_role_name(role));
        }
    }

    #[test]
    fn branch_access_requires_one_active_default() {
        let branches = HashSet::from(["branch_hyd"]);
        let roles = HashSet::from(["manager"]);
        let assignment = || BranchAccessAssignment {
            branch_id: "branch_hyd".into(),
            role_id: Some("manager".into()),
            access_type: "permanent".into(),
            valid_from: None,
            valid_until: None,
            is_default: false,
            active: true,
        };

        assert!(validate_branch_access(vec![assignment()], &branches, &roles).is_err());
        let mut valid = assignment();
        valid.is_default = true;
        assert!(validate_branch_access(vec![valid], &branches, &roles).is_ok());
    }

    #[test]
    fn deputation_requires_a_bounded_non_default_window() {
        let branches = HashSet::from(["branch_hyd"]);
        let roles = HashSet::from(["manager"]);
        let valid_from = NaiveDate::from_ymd_opt(2026, 7, 14).unwrap();
        let valid_until = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        let assignment = BranchAccessAssignment {
            branch_id: "branch_hyd".into(),
            role_id: Some("manager".into()),
            access_type: "deputation".into(),
            valid_from: Some(valid_from),
            valid_until: Some(valid_until),
            is_default: false,
            active: true,
        };
        assert!(validate_branch_access(vec![assignment], &branches, &roles).is_err());

        let assignment = BranchAccessAssignment {
            branch_id: "branch_hyd".into(),
            role_id: Some("manager".into()),
            access_type: "deputation".into(),
            valid_from: Some(valid_from),
            valid_until: Some(valid_until),
            is_default: false,
            active: true,
        };
        let permanent = BranchAccessAssignment {
            branch_id: "branch_home".into(),
            role_id: Some("manager".into()),
            access_type: "permanent".into(),
            valid_from: None,
            valid_until: None,
            is_default: true,
            active: true,
        };
        let branches = HashSet::from(["branch_hyd", "branch_home"]);
        assert!(validate_branch_access(vec![assignment, permanent], &branches, &roles).is_ok());
    }

    #[test]
    fn custom_role_rejects_unknown_or_duplicate_permissions() {
        assert!(validate_auth_role(
            "Regional Lead".into(),
            vec!["unknown".into()],
            AuthRoleSecurityInput::default()
        )
        .is_err());
        assert!(validate_auth_role(
            "Regional Lead".into(),
            vec!["tenant.read".into(), "tenant.read".into()],
            AuthRoleSecurityInput::default()
        )
        .is_err());
        assert!(validate_auth_role(
            "Regional Lead".into(),
            vec!["appointments.read".into(), "clients.manage".into()],
            AuthRoleSecurityInput::default()
        )
        .is_ok());
        assert!(validate_auth_role(
            "Client Compliance".into(),
            vec![
                "clients.consent.manage".into(),
                "clients.forms.manage".into(),
                "clients.merge".into(),
                "clients.audit.read".into(),
                "clients.reviews.link".into(),
                "purchases.approve".into(),
            ],
            AuthRoleSecurityInput::default()
        )
        .is_ok());
    }

    #[test]
    fn masters_validate_codes_shifts_and_rule_order() {
        let mut input = ReplaceStaffMastersInput {
            categories: vec![StaffCategoryInput {
                id: String::new(),
                code: "stylist".into(),
                name: "Stylist".into(),
                designation: String::new(),
                active: true,
            }],
            pricing_levels: vec![],
            shift_templates: vec![ShiftTemplateInput {
                id: String::new(),
                code: "regular".into(),
                name: "Regular".into(),
                shift1_start: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                shift1_end: NaiveTime::from_hms_opt(18, 0, 0).unwrap(),
                shift2_start: None,
                shift2_end: None,
                break_minutes: 30,
                weekly_off_days: vec![0],
                active: true,
            }],
            attendance_rule: AttendanceRuleInput {
                grace_minutes: 10,
                half_day_after_minutes: 120,
                absent_after_minutes: 240,
                overtime_after_minutes: 30,
                early_leave_grace_minutes: 10,
                deduct_breaks: true,
                minimum_overtime_minutes: 15,
                overtime_rounding_minutes: 15,
                maximum_overtime_minutes: 240,
                active: true,
            },
        };
        assert!(validate_masters(&input).is_ok());
        input.attendance_rule.absent_after_minutes = 60;
        assert!(validate_masters(&input).is_err());
    }

    #[test]
    fn bulk_import_rejects_invalid_hr_options_before_writes() {
        let row = BulkStaffInput {
            employee_code: "EMP-1".into(),
            first_name: "Aftab".into(),
            last_name: None,
            email: None,
            mobile_phone: None,
            job_title: None,
            active: Some(true),
            photo_url: None,
            date_of_birth: None,
            joining_date: None,
            gender: Some("unknown".into()),
            employment_type: None,
            department: None,
            reporting_manager_id: None,
            category_id: None,
            shift_template_id: None,
        };
        assert!(validate_bulk_row(&row).is_err());
    }

    #[test]
    fn staff_login_invite_token_requires_full_uuid_entropy() {
        assert!(valid_invite_token("0123456789abcdef0123456789abcdef").is_ok());
        assert!(valid_invite_token("0123456789abcdef").is_err());
        assert!(valid_invite_token("0123456789abcdef0123456789abcdeg").is_err());
    }
}
