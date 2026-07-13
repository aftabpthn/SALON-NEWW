-- Provider-side payment identifiers must be immutable and unique inside a tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_links_provider_reference
  ON pos_payment_links (tenant_id, branch_id, provider, provider_reference)
  WHERE provider_reference <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payment_links_provider_link
  ON pos_payment_links (tenant_id, branch_id, provider, provider_link_id)
  WHERE provider_link_id <> '';
