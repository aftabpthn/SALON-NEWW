ALTER TABLE inventory_api_idempotency
  DROP CONSTRAINT inventory_api_idempotency_tenant_id_branch_id_actor_user_id_key;

ALTER TABLE inventory_api_idempotency
  ADD CONSTRAINT inventory_api_idempotency_tenant_branch_key
  UNIQUE (tenant_id, branch_id, idempotency_key);
