use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};

#[derive(Debug, Clone)]
pub struct OperatingHourWrite {
    pub weekday: i16,
    pub opens_at: Option<NaiveTime>,
    pub closes_at: Option<NaiveTime>,
    pub closed: bool,
}

#[derive(Debug, Clone)]
pub struct HolidayWrite {
    pub holiday_date: NaiveDate,
    pub name: String,
    pub closed: bool,
    pub opens_at: Option<NaiveTime>,
    pub closes_at: Option<NaiveTime>,
}

pub async fn snapshot(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
) -> Result<Option<Value>, sqlx::Error> {
    sqlx::query_scalar(
        r#"WITH tenant_scope AS (
          SELECT id,name,slug,status,business_type,grace_period_ends_at,lifecycle_reason,lifecycle_version
            FROM tenants WHERE id::TEXT=$1 OR scope_id=$1 LIMIT 1
        ), central AS (
          SELECT COALESCE(jsonb_object_agg(config_key,value_json),'{}'::JSONB) value
            FROM organization_config_versions c JOIN tenant_scope t ON t.id=c.tenant_id
           WHERE c.branch_id IS NULL AND c.active=TRUE
        ), local AS (
          SELECT COALESCE(jsonb_object_agg(config_key,value_json),'{}'::JSONB) value
            FROM organization_config_versions c JOIN tenant_scope t ON t.id=c.tenant_id
           WHERE c.branch_id=$2::UUID AND c.active=TRUE
        )
        SELECT jsonb_build_object(
          'configBranchId',$2::UUID,
          'tenant',jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'status',t.status,
            'businessType',t.business_type,'gracePeriodEndsAt',t.grace_period_ends_at,
            'lifecycleReason',t.lifecycle_reason,'lifecycleVersion',t.lifecycle_version),
          'brands',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'code',b.code,'name',b.name,
            'active',b.active,'version',b.version,'updatedAt',b.updated_at) ORDER BY b.name)
            FROM organization_brands b WHERE b.tenant_id=t.id),'[]'::JSONB),
          'locations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code,
            'brandId',b.brand_id,'regionName',b.region_name,'zoneName',b.zone_name,'clusterName',b.cluster_name,
            'address',b.address,'timeZone',b.time_zone,'currencyCode',b.currency_code,'active',b.active,
            'operatingHours',COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday',h.weekday,'opensAt',h.opens_at,
              'closesAt',h.closes_at,'closed',h.closed,'version',h.version) ORDER BY h.weekday)
              FROM branch_operating_hours h WHERE h.tenant_id=t.id AND h.branch_id=b.id),'[]'::JSONB),
            'holidays',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'holidayDate',h.holiday_date,
              'name',h.name,'closed',h.closed,'opensAt',h.opens_at,'closesAt',h.closes_at,'version',h.version)
              ORDER BY h.holiday_date) FROM branch_holidays h WHERE h.tenant_id=t.id AND h.branch_id=b.id
              AND h.holiday_date>=CURRENT_DATE-INTERVAL '1 year'),'[]'::JSONB),
            'departments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'brandId',d.brand_id,
              'code',d.code,'name',d.name,'active',d.active,'version',d.version) ORDER BY d.name)
              FROM organization_departments d WHERE d.tenant_id=t.id AND d.branch_id=b.id),'[]'::JSONB)) ORDER BY b.name)
            FROM branches b WHERE b.tenant_id=t.id),'[]'::JSONB),
          'units',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'branchId',u.branch_id,'kind',u.kind,
            'code',u.code,'name',u.name,'active',u.active,'version',u.version) ORDER BY u.kind,u.name)
            FROM organization_units u WHERE u.tenant_id=t.id),'[]'::JSONB),
          'costCenters',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'branchId',c.branch_id,'code',c.code,
            'name',c.name,'kind',c.kind,'active',c.active) ORDER BY c.name)
            FROM accounting_cost_centers c WHERE c.tenant_id=$1),'[]'::JSONB),
          'centralConfig',central.value,'locationConfig',local.value,'effectiveConfig',central.value||local.value,
          'configHistory',COALESCE((SELECT jsonb_agg(row_to_json(history)::JSONB ORDER BY history."createdAt" DESC)
            FROM (SELECT c.id,c.branch_id AS "branchId",c.config_key AS "configKey",c.value_json AS value,
              c.version,c.allow_location_override AS "allowLocationOverride",c.active,c.reason,
              c.source_version AS "sourceVersion",c.created_by AS "createdBy",c.created_at AS "createdAt"
              FROM organization_config_versions c WHERE c.tenant_id=t.id ORDER BY c.created_at DESC LIMIT 200) history),'[]'::JSONB),
          'featureOverrides',COALESCE((SELECT jsonb_agg(jsonb_build_object('featureKey',f.feature_key,'enabled',f.enabled,
            'expiresAt',f.expires_at,'reason',f.reason,'version',f.version,'updatedAt',f.updated_at) ORDER BY f.feature_key)
            FROM tenant_feature_overrides f WHERE f.tenant_id=t.id),'[]'::JSONB),
          'usageQuotas',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',q.id,'subscriptionId',q.subscription_id,
            'metric',q.metric,'includedQuantity',q.included_quantity,'hardLimitQuantity',q.hard_limit_quantity,
            'overageUnitPaise',q.overage_unit_paise,'version',q.version,'updatedAt',q.updated_at) ORDER BY q.metric)
            FROM saas_usage_quotas q WHERE q.tenant_id=t.id::TEXT),'[]'::JSONB)
        ) FROM tenant_scope t CROSS JOIN central CROSS JOIN local"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .fetch_optional(db)
    .await
}

pub async fn first_branch_id(db: &PgPool, tenant_id: &str) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT b.id::TEXT FROM branches b JOIN tenants t ON t.id=b.tenant_id WHERE t.id::TEXT=$1 OR t.scope_id=$1 ORDER BY b.active DESC,b.created_at LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
}

pub async fn timezone_exists(db: &PgPool, timezone: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)")
        .bind(timezone)
        .fetch_one(db)
        .await
}

pub async fn update_profile(
    db: &PgPool,
    tenant_id: &str,
    business_type: &str,
    expected_version: i32,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = sqlx::query(
        "UPDATE tenants SET business_type=$2,lifecycle_version=lifecycle_version+1,updated_at=NOW() WHERE (id::TEXT=$1 OR scope_id=$1) AND lifecycle_version=$3",
    )
    .bind(tenant_id)
    .bind(business_type)
    .bind(expected_version)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if changed {
        audit(
            &mut tx,
            tenant_id,
            None,
            actor,
            "organization.profile.updated",
            json!({"businessType":business_type,"expectedVersion":expected_version}),
        )
        .await?;
        tx.commit().await?;
    }
    Ok(changed)
}

#[allow(clippy::too_many_arguments)]
pub async fn save_brand(
    db: &PgPool,
    tenant_id: &str,
    id: Option<&str>,
    code: &str,
    name: &str,
    active: bool,
    expected_version: Option<i32>,
    actor: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let Some(tenant_uuid) = tenant_uuid(&mut tx, tenant_id).await? else {
        return Ok(None);
    };
    let saved = if let Some(id) = id {
        sqlx::query_scalar::<_, String>(
            "UPDATE organization_brands SET code=$3,name=$4,active=$5,version=version+1,updated_by=$6,updated_at=NOW() WHERE id=$2::UUID AND tenant_id=$1::UUID AND version=$7 RETURNING id::TEXT",
        )
        .bind(&tenant_uuid).bind(id).bind(code).bind(name).bind(active).bind(actor).bind(expected_version.unwrap_or(0))
        .fetch_optional(&mut *tx).await?
    } else {
        sqlx::query_scalar::<_, String>(
            "INSERT INTO organization_brands(tenant_id,code,name,active,created_by,updated_by) SELECT id,$2,$3,$4,$5,$5 FROM tenants WHERE id=$1::UUID RETURNING id::TEXT",
        )
        .bind(&tenant_uuid).bind(code).bind(name).bind(active).bind(actor)
        .fetch_optional(&mut *tx).await?
    };
    if let Some(saved_id) = saved.as_deref() {
        audit(
            &mut tx,
            tenant_id,
            None,
            actor,
            "organization.brand.saved",
            json!({"brandId":saved_id,"code":code,"active":active}),
        )
        .await?;
        tx.commit().await?;
    }
    Ok(saved)
}

#[allow(clippy::too_many_arguments)]
pub async fn save_department(
    db: &PgPool,
    tenant_id: &str,
    id: Option<&str>,
    branch_id: &str,
    brand_id: Option<&str>,
    code: &str,
    name: &str,
    active: bool,
    expected_version: Option<i32>,
    actor: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let Some(tenant_uuid) = tenant_uuid(&mut tx, tenant_id).await? else {
        return Ok(None);
    };
    let saved = if let Some(id) = id {
        sqlx::query_scalar::<_, String>(r#"UPDATE organization_departments d SET branch_id=$3::UUID,brand_id=$4::UUID,
            code=$5,name=$6,active=$7,version=version+1,updated_by=$8,updated_at=NOW()
          WHERE d.id=$2::UUID AND d.tenant_id=$1::UUID AND d.version=$9
            AND EXISTS(SELECT 1 FROM branches b WHERE b.id=$3::UUID AND b.tenant_id=d.tenant_id)
            AND ($4::TEXT IS NULL OR EXISTS(SELECT 1 FROM organization_brands brand WHERE brand.id=$4::UUID AND brand.tenant_id=d.tenant_id))
          RETURNING d.id::TEXT"#)
        .bind(&tenant_uuid).bind(id).bind(branch_id).bind(brand_id).bind(code).bind(name).bind(active).bind(actor).bind(expected_version.unwrap_or(0))
        .fetch_optional(&mut *tx).await?
    } else {
        sqlx::query_scalar::<_, String>(r#"INSERT INTO organization_departments(tenant_id,branch_id,brand_id,code,name,active,created_by,updated_by)
          SELECT tenant.id,$2::UUID,$3::UUID,$4,$5,$6,$7,$7 FROM tenants tenant
          WHERE tenant.id=$1::UUID
            AND EXISTS(SELECT 1 FROM branches b WHERE b.id=$2::UUID AND b.tenant_id=tenant.id)
            AND ($3::TEXT IS NULL OR EXISTS(SELECT 1 FROM organization_brands brand WHERE brand.id=$3::UUID AND brand.tenant_id=tenant.id))
          RETURNING id::TEXT"#)
        .bind(&tenant_uuid).bind(branch_id).bind(brand_id).bind(code).bind(name).bind(active).bind(actor)
        .fetch_optional(&mut *tx).await?
    };
    if let Some(saved_id) = saved.as_deref() {
        audit(
            &mut tx,
            tenant_id,
            Some(branch_id),
            actor,
            "organization.department.saved",
            json!({"departmentId":saved_id,"code":code,"active":active}),
        )
        .await?;
        tx.commit().await?;
    }
    Ok(saved)
}

#[allow(clippy::too_many_arguments)]
pub async fn save_unit(
    db: &PgPool,
    tenant_id: &str,
    id: Option<&str>,
    branch_id: Option<&str>,
    kind: &str,
    code: &str,
    name: &str,
    active: bool,
    expected_version: Option<i32>,
    actor: &str,
) -> Result<Option<String>, sqlx::Error> {
    let mut tx = db.begin().await?;
    let Some(tenant_uuid) = tenant_uuid(&mut tx, tenant_id).await? else {
        return Ok(None);
    };
    let saved = if let Some(id) = id {
        sqlx::query_scalar::<_, String>(r#"UPDATE organization_units u SET branch_id=$3::UUID,kind=$4,code=$5,name=$6,
          active=$7,version=version+1,updated_by=$8,updated_at=NOW()
          WHERE u.id=$2::UUID AND u.tenant_id=$1::UUID AND u.version=$9
            AND ($3::TEXT IS NULL OR EXISTS(SELECT 1 FROM branches b WHERE b.id=$3::UUID AND b.tenant_id=u.tenant_id))
          RETURNING u.id::TEXT"#)
        .bind(&tenant_uuid).bind(id).bind(branch_id).bind(kind).bind(code).bind(name).bind(active).bind(actor).bind(expected_version.unwrap_or(0))
        .fetch_optional(&mut *tx).await?
    } else {
        sqlx::query_scalar::<_, String>(r#"INSERT INTO organization_units(tenant_id,branch_id,kind,code,name,active,created_by,updated_by)
          SELECT tenant.id,$2::UUID,$3,$4,$5,$6,$7,$7 FROM tenants tenant
          WHERE tenant.id=$1::UUID
            AND ($2::TEXT IS NULL OR EXISTS(SELECT 1 FROM branches b WHERE b.id=$2::UUID AND b.tenant_id=tenant.id))
          RETURNING id::TEXT"#)
        .bind(&tenant_uuid).bind(branch_id).bind(kind).bind(code).bind(name).bind(active).bind(actor)
        .fetch_optional(&mut *tx).await?
    };
    if let Some(saved_id) = saved.as_deref() {
        audit(
            &mut tx,
            tenant_id,
            branch_id,
            actor,
            "organization.unit.saved",
            json!({"unitId":saved_id,"kind":kind,"code":code,"active":active}),
        )
        .await?;
        tx.commit().await?;
    }
    Ok(saved)
}

pub async fn save_location_operations(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    brand_id: Option<&str>,
    time_zone: &str,
    currency: &str,
    hours: &[OperatingHourWrite],
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let Some(tenant_uuid) = tenant_uuid(&mut tx, tenant_id).await? else {
        return Ok(false);
    };
    let changed = sqlx::query(r#"UPDATE branches b SET brand_id=$3::UUID,time_zone=$4,currency_code=$5,updated_at=NOW()
      WHERE b.id=$2::UUID AND b.tenant_id=$1::UUID
        AND ($3::TEXT IS NULL OR EXISTS(SELECT 1 FROM organization_brands brand WHERE brand.id=$3::UUID AND brand.tenant_id=b.tenant_id))"#)
        .bind(&tenant_uuid).bind(branch_id).bind(brand_id).bind(time_zone).bind(currency)
        .execute(&mut *tx).await?.rows_affected()==1;
    if !changed {
        return Ok(false);
    }
    for hour in hours {
        sqlx::query(r#"INSERT INTO branch_operating_hours(tenant_id,branch_id,weekday,opens_at,closes_at,closed,updated_by)
          SELECT b.tenant_id,b.id,$3,$4,$5,$6,$7 FROM branches b WHERE b.id=$2::UUID AND b.tenant_id=$1::UUID
          ON CONFLICT(tenant_id,branch_id,weekday) DO UPDATE SET opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,
          closed=EXCLUDED.closed,version=branch_operating_hours.version+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()"#)
          .bind(&tenant_uuid).bind(branch_id).bind(hour.weekday).bind(hour.opens_at).bind(hour.closes_at).bind(hour.closed).bind(actor)
          .execute(&mut *tx).await?;
    }
    audit(&mut tx, tenant_id, Some(branch_id), actor, "organization.location.operations.saved", json!({"brandId":brand_id,"timeZone":time_zone,"currencyCode":currency,"operatingDays":hours.len()})).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn save_holiday(
    db: &PgPool,
    tenant_id: &str,
    branch_id: &str,
    holiday: &HolidayWrite,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let Some(tenant_uuid) = tenant_uuid(&mut tx, tenant_id).await? else {
        return Ok(false);
    };
    let saved = sqlx::query(r#"INSERT INTO branch_holidays(tenant_id,branch_id,holiday_date,name,closed,opens_at,closes_at,updated_by)
      SELECT b.tenant_id,b.id,$3,$4,$5,$6,$7,$8 FROM branches b WHERE b.id=$2::UUID AND b.tenant_id=$1::UUID
      ON CONFLICT(tenant_id,branch_id,holiday_date) DO UPDATE SET name=EXCLUDED.name,closed=EXCLUDED.closed,
      opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,version=branch_holidays.version+1,
      updated_by=EXCLUDED.updated_by,updated_at=NOW()"#)
      .bind(&tenant_uuid).bind(branch_id).bind(holiday.holiday_date).bind(&holiday.name).bind(holiday.closed)
      .bind(holiday.opens_at).bind(holiday.closes_at).bind(actor).execute(&mut *tx).await?.rows_affected()==1;
    if saved {
        audit(
            &mut tx,
            tenant_id,
            Some(branch_id),
            actor,
            "organization.location.holiday.saved",
            json!({"holidayDate":holiday.holiday_date,"name":holiday.name}),
        )
        .await?;
        tx.commit().await?;
    }
    Ok(saved)
}

#[allow(clippy::too_many_arguments)]
pub async fn save_config(
    db: &PgPool,
    tenant_id: &str,
    branch_id: Option<&str>,
    key: &str,
    value: &Value,
    expected_version: i32,
    allow_location_override: bool,
    reason: &str,
    actor: &str,
    source_version: Option<i32>,
) -> Result<Option<i32>, sqlx::Error> {
    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || COALESCE($2,'*') || ':' || $3,0))")
        .bind(tenant_id).bind(branch_id).bind(key).execute(&mut *tx).await?;
    let tenant_uuid = sqlx::query_scalar::<_, String>(
        "SELECT id::TEXT FROM tenants WHERE id::TEXT=$1 OR scope_id=$1",
    )
    .bind(tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(tenant_uuid) = tenant_uuid else {
        return Ok(None);
    };
    if let Some(branch) = branch_id {
        let allowed = sqlx::query_scalar::<_, bool>(r#"SELECT EXISTS(SELECT 1 FROM branches b
          JOIN organization_config_versions c ON c.tenant_id=b.tenant_id AND c.branch_id IS NULL AND c.config_key=$3
            AND c.active=TRUE AND c.allow_location_override=TRUE
          WHERE b.id=$2::UUID AND b.tenant_id=$1::UUID)"#)
          .bind(&tenant_uuid).bind(branch).bind(key).fetch_one(&mut *tx).await?;
        if !allowed {
            return Ok(None);
        }
    }
    let current = sqlx::query_scalar::<_, i32>(r#"SELECT version FROM organization_config_versions
      WHERE tenant_id=$1::UUID AND branch_id IS NOT DISTINCT FROM $2::UUID AND config_key=$3 AND active=TRUE FOR UPDATE"#)
      .bind(&tenant_uuid).bind(branch_id).bind(key).fetch_optional(&mut *tx).await?;
    if current.unwrap_or(0) != expected_version {
        return Ok(None);
    }
    sqlx::query("UPDATE organization_config_versions SET active=FALSE WHERE tenant_id=$1::UUID AND branch_id IS NOT DISTINCT FROM $2::UUID AND config_key=$3 AND active=TRUE")
      .bind(&tenant_uuid).bind(branch_id).bind(key).execute(&mut *tx).await?;
    let version = current.unwrap_or(0) + 1;
    sqlx::query(r#"INSERT INTO organization_config_versions(tenant_id,branch_id,config_key,value_json,version,
      allow_location_override,reason,source_version,created_by) VALUES($1::UUID,$2::UUID,$3,$4,$5,$6,$7,$8,$9)"#)
      .bind(&tenant_uuid).bind(branch_id).bind(key).bind(value).bind(version).bind(allow_location_override)
      .bind(reason).bind(source_version).bind(actor).execute(&mut *tx).await?;
    audit(&mut tx, tenant_id, branch_id, actor, if source_version.is_some() {"organization.config.rolled_back"} else {"organization.config.saved"},
      json!({"configKey":key,"version":version,"sourceVersion":source_version,"allowLocationOverride":allow_location_override,"reason":reason})).await?;
    tx.commit().await?;
    Ok(Some(version))
}

pub async fn config_version(
    db: &PgPool,
    tenant_id: &str,
    branch_id: Option<&str>,
    key: &str,
    version: i32,
) -> Result<Option<(Value, bool)>, sqlx::Error> {
    sqlx::query_as(
        r#"SELECT c.value_json,c.allow_location_override FROM organization_config_versions c
      JOIN tenants t ON t.id=c.tenant_id WHERE (t.id::TEXT=$1 OR t.scope_id=$1)
      AND c.branch_id IS NOT DISTINCT FROM $2::UUID AND c.config_key=$3 AND c.version=$4"#,
    )
    .bind(tenant_id)
    .bind(branch_id)
    .bind(key)
    .bind(version)
    .fetch_optional(db)
    .await
}

pub async fn update_lifecycle(
    db: &PgPool,
    tenant_id: &str,
    status: &str,
    grace_ends_at: Option<DateTime<Utc>>,
    reason: &str,
    expected_version: i32,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let tenant_scope=sqlx::query_scalar::<_, String>("UPDATE tenants SET status=$2,grace_period_ends_at=$3,lifecycle_reason=$4,lifecycle_version=lifecycle_version+1,updated_at=NOW() WHERE (id::TEXT=$1 OR scope_id=$1) AND lifecycle_version=$5 RETURNING COALESCE(NULLIF(scope_id,''),id::TEXT)")
      .bind(tenant_id).bind(status).bind(grace_ends_at).bind(reason).bind(expected_version).fetch_optional(&mut *tx).await?;
    if let Some(tenant_scope) = tenant_scope {
        if status == "suspended" {
            sqlx::query("UPDATE auth_refresh_tokens SET revoked_at=NOW(),revoke_reason='tenant_suspended' WHERE tenant_id=$1 AND revoked_at IS NULL")
                .bind(&tenant_scope).execute(&mut *tx).await?;
        }
        audit(&mut tx, tenant_id, None, actor, "saas.tenant.lifecycle.updated", json!({"status":status,"gracePeriodEndsAt":grace_ends_at,"reason":reason,"expectedVersion":expected_version})).await?;
        tx.commit().await?;
        return Ok(true);
    }
    Ok(false)
}

pub async fn save_feature_override(
    db: &PgPool,
    tenant_id: &str,
    feature_key: &str,
    enabled: bool,
    expires_at: Option<DateTime<Utc>>,
    reason: &str,
    expected_version: i32,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = if expected_version == 0 {
        sqlx::query(r#"INSERT INTO tenant_feature_overrides(tenant_id,feature_key,enabled,expires_at,reason,updated_by)
        SELECT id,$2,$3,$4,$5,$6 FROM tenants WHERE id::TEXT=$1 OR scope_id=$1
        ON CONFLICT(tenant_id,feature_key) DO NOTHING"#).bind(tenant_id).bind(feature_key).bind(enabled).bind(expires_at).bind(reason).bind(actor)
        .execute(&mut *tx).await?.rows_affected()==1
    } else {
        sqlx::query(r#"UPDATE tenant_feature_overrides f SET enabled=$3,expires_at=$4,reason=$5,version=version+1,
        updated_by=$6,updated_at=NOW() FROM tenants t WHERE f.tenant_id=t.id AND (t.id::TEXT=$1 OR t.scope_id=$1)
        AND f.feature_key=$2 AND f.version=$7"#).bind(tenant_id).bind(feature_key).bind(enabled).bind(expires_at).bind(reason).bind(actor).bind(expected_version)
        .execute(&mut *tx).await?.rows_affected()==1
    };
    if changed {
        audit(&mut tx, tenant_id, None, actor, "saas.tenant.feature_override.saved", json!({"featureKey":feature_key,"enabled":enabled,"expiresAt":expires_at,"reason":reason})).await?;
        tx.commit().await?;
    }
    Ok(changed)
}

#[allow(clippy::too_many_arguments)]
pub async fn save_usage_quota(
    db: &PgPool,
    tenant_id: &str,
    subscription_id: &str,
    metric: &str,
    included_quantity: i64,
    hard_limit_quantity: Option<i64>,
    overage_unit_paise: i64,
    expected_version: i32,
    actor: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = db.begin().await?;
    let changed = if expected_version == 0 {
        sqlx::query(r#"INSERT INTO saas_usage_quotas(tenant_id,subscription_id,metric,included_quantity,hard_limit_quantity,overage_unit_paise,updated_by)
        SELECT $1,s.id,$3,$4,$5,$6,$7 FROM saas_subscriptions s WHERE s.id=$2 AND s.tenant_id=$1
        ON CONFLICT(tenant_id,subscription_id,metric) DO NOTHING"#)
        .bind(tenant_id).bind(subscription_id).bind(metric).bind(included_quantity).bind(hard_limit_quantity).bind(overage_unit_paise).bind(actor)
        .execute(&mut *tx).await?.rows_affected()==1
    } else {
        sqlx::query(r#"UPDATE saas_usage_quotas SET included_quantity=$4,hard_limit_quantity=$5,overage_unit_paise=$6,
        version=version+1,updated_by=$7,updated_at=NOW() WHERE tenant_id=$1 AND subscription_id=$2 AND metric=$3 AND version=$8"#)
        .bind(tenant_id).bind(subscription_id).bind(metric).bind(included_quantity).bind(hard_limit_quantity).bind(overage_unit_paise).bind(actor).bind(expected_version)
        .execute(&mut *tx).await?.rows_affected()==1
    };
    if changed {
        audit(&mut tx, tenant_id, None, actor, "saas.tenant.usage_quota.saved", json!({"subscriptionId":subscription_id,"metric":metric,"includedQuantity":included_quantity,"hardLimitQuantity":hard_limit_quantity,"overageUnitPaise":overage_unit_paise})).await?;
        tx.commit().await?;
    }
    Ok(changed)
}

async fn tenant_uuid(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT id::TEXT FROM tenants WHERE id::TEXT=$1 OR scope_id=$1")
        .bind(tenant_id)
        .fetch_optional(&mut **tx)
        .await
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: &str,
    branch_id: Option<&str>,
    actor: &str,
    event_type: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO auth_audit_logs(tenant_id,user_id,branch_id,event_type,outcome,details_json) VALUES($1,$2,$3,$4,'success',$5)")
        .bind(tenant_id).bind(actor).bind(branch_id).bind(event_type).bind(details).execute(&mut **tx).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::saas_repository::{self, BillingContext, UsageRecordOutcome};
    use chrono::Duration;
    use serde_json::json;
    use uuid::Uuid;

    #[sqlx::test]
    async fn two_tenants_three_locations_keep_overrides_and_audit_isolated(db: PgPool) {
        let tenant_a = Uuid::new_v4();
        let tenant_b = Uuid::new_v4();
        let tenant_a_scope = format!("tenant-a-{}", &tenant_a.to_string()[..8]);
        let tenant_b_scope = format!("tenant-b-{}", &tenant_b.to_string()[..8]);
        let location_a1 = Uuid::new_v4();
        let location_a2 = Uuid::new_v4();
        let location_b1 = Uuid::new_v4();
        for (id, scope, name) in [
            (tenant_a, &tenant_a_scope, "Aurora North"),
            (tenant_b, &tenant_b_scope, "Aurora South"),
        ] {
            sqlx::query("INSERT INTO tenants(id,name,slug,scope_id) VALUES($1::UUID,$2,$3,$4)")
                .bind(id.to_string())
                .bind(name)
                .bind(format!("aurora-{}", &id.to_string()[..8]))
                .bind(scope)
                .execute(&db)
                .await
                .unwrap();
        }
        for (id, tenant, name, code) in [
            (location_a1, tenant_a, "North One", "N1"),
            (location_a2, tenant_a, "North Two", "N2"),
            (location_b1, tenant_b, "South One", "S1"),
        ] {
            sqlx::query("INSERT INTO branches(id,tenant_id,name,code,scope_id) VALUES($1::UUID,$2::UUID,$3,$4,$1)")
                .bind(id.to_string())
                .bind(tenant.to_string())
                .bind(name)
                .bind(code)
                .execute(&db)
                .await
                .unwrap();
        }

        let brand_id = save_brand(
            &db,
            &tenant_a_scope,
            None,
            "NORTH",
            "North Brand",
            true,
            None,
            "operator",
        )
        .await
        .unwrap()
        .unwrap();
        assert!(save_department(
            &db,
            &tenant_a_scope,
            None,
            &location_a1.to_string(),
            Some(&brand_id),
            "HAIR",
            "Hair",
            true,
            None,
            "operator",
        )
        .await
        .unwrap()
        .is_some());
        assert!(save_unit(
            &db,
            &tenant_a_scope,
            None,
            Some(&location_a1.to_string()),
            "business_unit",
            "SALON",
            "Salon",
            true,
            None,
            "operator",
        )
        .await
        .unwrap()
        .is_some());
        let hours = (0..7)
            .map(|weekday| OperatingHourWrite {
                weekday,
                opens_at: NaiveTime::from_hms_opt(9, 0, 0),
                closes_at: NaiveTime::from_hms_opt(18, 0, 0),
                closed: false,
            })
            .collect::<Vec<_>>();
        assert!(save_location_operations(
            &db,
            &tenant_a_scope,
            &location_a1.to_string(),
            Some(&brand_id),
            "Asia/Kolkata",
            "INR",
            &hours,
            "operator",
        )
        .await
        .unwrap());
        assert!(save_holiday(
            &db,
            &tenant_a_scope,
            &location_a1.to_string(),
            &HolidayWrite {
                holiday_date: NaiveDate::from_ymd_opt(2026, 8, 15).unwrap(),
                name: "Independence Day".into(),
                closed: true,
                opens_at: None,
                closes_at: None,
            },
            "operator",
        )
        .await
        .unwrap());
        let saved_hours: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM branch_operating_hours WHERE tenant_id=$1::UUID AND branch_id=$2::UUID",
        )
        .bind(tenant_a.to_string())
        .bind(location_a1.to_string())
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(saved_hours, 7);

        assert_eq!(
            save_config(
                &db,
                &tenant_a_scope,
                None,
                "branding",
                &json!({"brandName":"Central One"}),
                0,
                true,
                "Initial central brand",
                "operator",
                None
            )
            .await
            .unwrap(),
            Some(1)
        );
        assert_eq!(
            save_config(
                &db,
                &tenant_a_scope,
                Some(&location_a1.to_string()),
                "branding",
                &json!({"brandName":"Location One"}),
                0,
                false,
                "Approved local brand",
                "operator",
                None
            )
            .await
            .unwrap(),
            Some(1)
        );
        assert_eq!(
            save_config(
                &db,
                &tenant_a_scope,
                None,
                "branding",
                &json!({"brandName":"Central Two"}),
                1,
                true,
                "Central brand update",
                "operator",
                None
            )
            .await
            .unwrap(),
            Some(2)
        );

        let local = snapshot(&db, &tenant_a_scope, &location_a1.to_string())
            .await
            .unwrap()
            .unwrap();
        let central = snapshot(&db, &tenant_a_scope, &location_a2.to_string())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            local["effectiveConfig"]["branding"]["brandName"],
            "Location One"
        );
        assert_eq!(
            central["effectiveConfig"]["branding"]["brandName"],
            "Central Two"
        );

        let (version_one, allowed) = config_version(&db, &tenant_a_scope, None, "branding", 1)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            save_config(
                &db,
                &tenant_a_scope,
                None,
                "branding",
                &version_one,
                2,
                allowed,
                "Rollback central brand",
                "operator",
                Some(1)
            )
            .await
            .unwrap(),
            Some(3)
        );
        let rolled_back = snapshot(&db, &tenant_a_scope, &location_a2.to_string())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            rolled_back["effectiveConfig"]["branding"]["brandName"],
            "Central One"
        );

        assert!(!save_location_operations(
            &db,
            &tenant_a_scope,
            &location_b1.to_string(),
            None,
            "UTC",
            "USD",
            &[],
            "operator"
        )
        .await
        .unwrap());
        assert!(save_config(
            &db,
            &tenant_a_scope,
            Some(&location_b1.to_string()),
            "branding",
            &json!({"brandName":"Leak"}),
            0,
            false,
            "Cross tenant attempt",
            "operator",
            None
        )
        .await
        .unwrap()
        .is_none());

        assert!(save_feature_override(
            &db,
            &tenant_a_scope,
            "appointments.advanced",
            true,
            None,
            "Approved entitlement",
            0,
            "operator"
        )
        .await
        .unwrap());
        let tenant_b_view = snapshot(&db, &tenant_b_scope, &location_b1.to_string())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(tenant_b_view["featureOverrides"], json!([]));

        let plan_id = Uuid::new_v4().to_string();
        let subscription_id = Uuid::new_v4().to_string();
        let period_start = Utc::now() - Duration::days(1);
        let period_end = Utc::now() + Duration::days(30);
        sqlx::query("INSERT INTO saas_plans(id,code,name,billing_interval,base_price_paise,created_by,updated_by) VALUES($1,$2,$3,'monthly',0,'operator','operator')")
            .bind(&plan_id).bind(format!("PLAN-{}", &plan_id[..8])).bind("Aurora Plan").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO saas_subscriptions(id,tenant_id,branch_id,plan_id,status,current_period_start,current_period_end,created_by,updated_by) VALUES($1,$2,$3,$4,'active',$5,$6,'operator','operator')")
            .bind(&subscription_id).bind(&tenant_a_scope).bind(location_a1.to_string()).bind(&plan_id)
            .bind(period_start).bind(period_end).execute(&db).await.unwrap();
        assert!(save_usage_quota(
            &db,
            &tenant_a_scope,
            &subscription_id,
            "sms",
            3,
            Some(5),
            2,
            0,
            "operator"
        )
        .await
        .unwrap());
        assert_eq!(
            saas_repository::record_usage(
                &db,
                &tenant_a_scope,
                &location_a1.to_string(),
                &subscription_id,
                "sms",
                4,
                "usage-one",
                Utc::now(),
                &json!({}),
                "twilio",
                "sms",
                10,
                "INR"
            )
            .await
            .unwrap(),
            UsageRecordOutcome::Recorded
        );
        assert_eq!(
            saas_repository::record_usage(
                &db,
                &tenant_a_scope,
                &location_a1.to_string(),
                &subscription_id,
                "sms",
                4,
                "usage-one",
                Utc::now(),
                &json!({}),
                "twilio",
                "sms",
                10,
                "INR"
            )
            .await
            .unwrap(),
            UsageRecordOutcome::Replayed
        );
        assert_eq!(
            saas_repository::record_usage(
                &db,
                &tenant_a_scope,
                &location_a1.to_string(),
                &subscription_id,
                "sms",
                2,
                "usage-two",
                Utc::now(),
                &json!({}),
                "twilio",
                "sms",
                10,
                "INR"
            )
            .await
            .unwrap(),
            UsageRecordOutcome::QuotaExceeded
        );
        let usage = saas_repository::usage_snapshot(
            &db,
            &BillingContext {
                subscription_id: subscription_id.clone(),
                tenant_id: tenant_a_scope.clone(),
                branch_id: location_a1.to_string(),
                status: "active".into(),
                trial_ends_at: None,
                billing_interval: "monthly".into(),
                base_price_paise: 0,
                included_branches: 0,
                included_users: 0,
                included_appointments: 0,
                overage_branch_paise: 0,
                overage_user_paise: 0,
                overage_appointment_paise: 0,
                current_period_start: period_start,
                current_period_end: period_end,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            (
                usage.provider_cost_paise,
                usage.communication_cost_paise,
                usage.quota_overage_paise
            ),
            (40, 40, 2)
        );
        assert!(update_lifecycle(
            &db,
            &tenant_b_scope,
            "suspended",
            None,
            "Controlled suspension",
            1,
            "operator"
        )
        .await
        .unwrap());

        let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_audit_logs WHERE tenant_id=$1 AND event_type IN ('organization.config.saved','organization.config.rolled_back','saas.tenant.feature_override.saved')")
            .bind(&tenant_a_scope)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(audit_count, 5);
    }
}
