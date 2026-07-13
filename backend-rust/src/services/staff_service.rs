use std::collections::HashSet;

use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::{
    models::common::AppError,
    repositories::{
        staff_configuration_repository::{
            self, CatalogOptionRecord, CommissionRuleRecord, LeavePolicyRecord, PayRateRecord,
            ReplaceConfigurationInput, RoleOptionRecord,
        },
        staff_repository::{self, StaffRecord},
    },
    services::auth_service,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffConfigurationData {
    pub roles: Vec<RoleOptionRecord>,
    pub catalog: Vec<CatalogOptionRecord>,
    pub commission_rules: Vec<CommissionRuleRecord>,
    pub pay_rates: Vec<PayRateRecord>,
    pub leave_policies: Vec<LeavePolicyRecord>,
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

fn all_unique<T: Eq + std::hash::Hash>(values: impl Iterator<Item = T>) -> bool {
    let mut seen = HashSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

pub async fn has_linked_login(db: &PgPool, tenant_id: &str, email: &str) -> Result<bool, AppError> {
    if email.trim().is_empty() {
        return Ok(false);
    }

    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND LOWER(email)=LOWER($2) AND active=true)",
    )
    .bind(tenant_id)
    .bind(email)
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
) -> Result<(), AppError> {
    if new_password.len() < 12 {
        return Err(AppError::validation(
            "newPassword must be at least 12 characters",
        ));
    }

    let password_hash = auth_service::hash_password(new_password)
        .map_err(|_| AppError::internal("failed to secure password"))?;
    let mut tx = db
        .begin()
        .await
        .map_err(|_| AppError::internal("failed to start password update"))?;
    let email = scoped_staff_email(&mut tx, tenant_id, branch_id, staff_id).await?;
    let user_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM users WHERE tenant_id=$1 AND LOWER(email)=LOWER($2) AND active=true LIMIT 1",
    )
    .bind(tenant_id)
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| AppError::internal("failed to load employee login"))?
    .ok_or_else(|| AppError::not_found("employee has no active linked login"))?;

    sqlx::query(
        "UPDATE users SET password_hash=$1, failed_login_count=0, locked_until=NULL, updated_at=NOW() WHERE id=$2",
    )
    .bind(password_hash)
    .bind(&user_id)
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
        SELECT id, tenant_id, branch_id, employee_code, first_name, middle_name, last_name,
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

    sqlx::query("UPDATE staff SET active=false, updated_at=NOW() WHERE id=$1")
        .bind(staff_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to terminate staff"))?;
    if !staff.email.trim().is_empty() {
        let user_id = sqlx::query_scalar::<_, String>(
            "UPDATE users SET active=false, updated_at=NOW() WHERE tenant_id=$1 AND LOWER(email)=LOWER($2) RETURNING id",
        )
        .bind(tenant_id)
        .bind(&staff.email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::internal("failed to deactivate employee login"))?;
        if let Some(user_id) = user_id {
            revoke_user_sessions(&mut tx, tenant_id, &user_id).await?;
        }
    }
    tx.commit()
        .await
        .map_err(|_| AppError::internal("failed to commit staff termination"))?;
    staff.active = false;
    Ok(staff)
}

async fn scoped_staff_email(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: &str,
    branch_id: &str,
    staff_id: &str,
) -> Result<String, AppError> {
    let email =
        sqlx::query("SELECT email FROM staff WHERE tenant_id=$1 AND branch_id=$2 AND id=$3")
            .bind(tenant_id)
            .bind(branch_id)
            .bind(staff_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|_| AppError::internal("failed to load staff"))?
            .map(|row| row.get::<String, _>("email"))
            .ok_or_else(|| AppError::not_found("staff was not found"))?;
    if email.trim().is_empty() {
        return Err(AppError::validation(
            "employee email is required for a login action",
        ));
    }
    Ok(email)
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
    use super::validate_configuration;
    use crate::repositories::staff_configuration_repository::{
        PayRateInput, ReplaceConfigurationInput,
    };

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
}
