ALTER TABLE saas_usage_events DROP CONSTRAINT IF EXISTS saas_usage_events_metric_check;
ALTER TABLE saas_usage_events ADD CONSTRAINT saas_usage_events_metric_check
  CHECK (metric IN ('api_calls','messages','storage_mb','provider_units','sms','whatsapp','email','ai_tokens','custom'));

ALTER TABLE organization_brands
  ADD CONSTRAINT uq_organization_brands_tenant_id_id UNIQUE (tenant_id,id);
ALTER TABLE branches
  ADD CONSTRAINT fk_branches_tenant_brand
  FOREIGN KEY (tenant_id,brand_id) REFERENCES organization_brands(tenant_id,id);
ALTER TABLE organization_departments
  ADD CONSTRAINT fk_organization_departments_tenant_branch
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_organization_departments_tenant_brand
  FOREIGN KEY (tenant_id,brand_id) REFERENCES organization_brands(tenant_id,id);
ALTER TABLE organization_units
  ADD CONSTRAINT fk_organization_units_tenant_branch
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE;
ALTER TABLE branch_operating_hours
  ADD CONSTRAINT fk_branch_operating_hours_tenant_branch
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE;
ALTER TABLE branch_holidays
  ADD CONSTRAINT fk_branch_holidays_tenant_branch
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE;
ALTER TABLE organization_config_versions
  ADD CONSTRAINT fk_organization_config_tenant_branch
  FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id) ON DELETE CASCADE;

CREATE UNIQUE INDEX uq_organization_config_scope_version
  ON organization_config_versions (
    tenant_id,
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::UUID),
    config_key,
    version
  );

CREATE UNIQUE INDEX uq_saas_subscriptions_tenant_id_id
  ON saas_subscriptions (tenant_id,id);
ALTER TABLE saas_usage_quotas
  ADD CONSTRAINT fk_saas_usage_quotas_tenant_subscription
  FOREIGN KEY (tenant_id,subscription_id) REFERENCES saas_subscriptions(tenant_id,id) ON DELETE CASCADE;
