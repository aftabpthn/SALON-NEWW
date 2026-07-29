ALTER TABLE saas_refunds
  DROP CONSTRAINT IF EXISTS saas_refunds_provider_provider_refund_ref_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_refund_provider_ref
  ON saas_refunds(provider,provider_refund_ref)
  WHERE provider_refund_ref<>'';
