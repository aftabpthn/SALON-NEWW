ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS franchise_override_fields TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

CREATE OR REPLACE FUNCTION membership_cross_location_allowed(
  p_tenant_id TEXT,
  p_source_branch_id TEXT,
  p_target_branch_id TEXT,
  p_source_client_id TEXT,
  p_target_client_id TEXT,
  p_benefit_kind TEXT
) RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM branches source_branch
      JOIN branches target_branch
        ON target_branch.tenant_id = source_branch.tenant_id
       AND COALESCE(NULLIF(target_branch.scope_id, ''), target_branch.id::TEXT) = p_target_branch_id
       AND target_branch.active = TRUE
      JOIN clients source_client
        ON source_client.tenant_id = p_tenant_id
       AND source_client.branch_id = p_source_branch_id
       AND source_client.id = p_source_client_id
       AND source_client.active = TRUE
       AND source_client.merged_into_client_id IS NULL
      JOIN clients target_client
        ON target_client.tenant_id = p_tenant_id
       AND target_client.branch_id = p_target_branch_id
       AND target_client.id = p_target_client_id
       AND target_client.active = TRUE
       AND target_client.merged_into_client_id IS NULL
      JOIN membership_settings source_settings
        ON source_settings.tenant_id = p_tenant_id
       AND source_settings.branch_id = p_source_branch_id
      JOIN membership_settings target_settings
        ON target_settings.tenant_id = p_tenant_id
       AND target_settings.branch_id = p_target_branch_id
     WHERE COALESCE(NULLIF(source_branch.scope_id, ''), source_branch.id::TEXT) = p_source_branch_id
       AND EXISTS (
         SELECT 1 FROM tenants tenant
          WHERE tenant.id = source_branch.tenant_id
            AND COALESCE(NULLIF(tenant.scope_id, ''), tenant.id::TEXT) = p_tenant_id
       )
       AND source_branch.active = TRUE
       AND p_source_branch_id <> p_target_branch_id
       AND (
         (
           source_client.normalized_phone <> ''
           AND source_client.normalized_phone = target_client.normalized_phone
           AND source_client.phone_verified_at IS NOT NULL
           AND target_client.phone_verified_at IS NOT NULL
         )
         OR EXISTS (
           SELECT 1
             FROM customer_account_clients source_link
             JOIN customer_account_clients target_link
               ON target_link.account_id = source_link.account_id
              AND target_link.tenant_id = source_link.tenant_id
            WHERE source_link.tenant_id = p_tenant_id
              AND source_link.branch_id = p_source_branch_id
              AND source_link.client_id = p_source_client_id
              AND target_link.branch_id = p_target_branch_id
              AND target_link.client_id = p_target_client_id
         )
       )
       AND COALESCE(source_settings.settings_json #>> '{crossLocation,enabled}', 'false') = 'true'
       AND COALESCE(target_settings.settings_json #>> '{crossLocation,acceptInbound}', 'false') = 'true'
       AND CASE p_benefit_kind
         WHEN 'discount' THEN COALESCE(source_settings.settings_json #>> '{crossLocation,allowDiscounts}', 'false') = 'true'
         WHEN 'service_credit' THEN COALESCE(source_settings.settings_json #>> '{crossLocation,allowServiceCredits}', 'false') = 'true'
         WHEN 'gift_card' THEN COALESCE(source_settings.settings_json #>> '{crossLocation,allowGiftCards}', 'false') = 'true'
         WHEN 'loyalty' THEN COALESCE(source_settings.settings_json #>> '{crossLocation,allowLoyaltyPoints}', 'false') = 'true'
         ELSE FALSE
       END
       AND CASE COALESCE(NULLIF(source_settings.settings_json #>> '{crossLocation,scope}', ''), 'tenant')
         WHEN 'tenant' THEN TRUE
         WHEN 'region' THEN source_branch.region_name <> '' AND source_branch.region_name = target_branch.region_name
         WHEN 'zone' THEN source_branch.region_name <> '' AND source_branch.region_name = target_branch.region_name AND source_branch.zone_name <> '' AND source_branch.zone_name = target_branch.zone_name
         WHEN 'cluster' THEN source_branch.region_name <> '' AND source_branch.region_name = target_branch.region_name AND source_branch.zone_name <> '' AND source_branch.zone_name = target_branch.zone_name AND source_branch.cluster_name <> '' AND source_branch.cluster_name = target_branch.cluster_name
         ELSE FALSE
       END
  );
$$;
