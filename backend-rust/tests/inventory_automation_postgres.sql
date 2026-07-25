\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  tenant TEXT := '__inventory_automation_pg_check__' || gen_random_uuid()::TEXT;
  branch TEXT := 'branch-a';
  action_id TEXT;
  claimed_branch TEXT;
  duplicate_rows BIGINT;
BEGIN
  INSERT INTO inventory_automation_policies (
    tenant_id, branch_id, enabled, monthly_budget_paise, next_run_at, updated_by
  ) VALUES
    (tenant, branch, TRUE, 100000, NOW() - INTERVAL '1 minute', 'postgres-check'),
    (tenant, 'branch-b', FALSE, 50000, NOW() - INTERVAL '1 minute', 'postgres-check');

  INSERT INTO inventory_automation_actions (
    tenant_id, branch_id, action_type, dedupe_key, title, rationale,
    confidence_bps, estimated_cost_paise, requested_by
  ) VALUES (
    tenant, branch, 'po_draft', 'dedupe-1', 'PostgreSQL check', 'Rollback-only check',
    8000, 25000, 'maker'
  ) RETURNING id INTO action_id;

  INSERT INTO inventory_automation_actions (
    tenant_id, branch_id, action_type, dedupe_key, title, rationale,
    confidence_bps, estimated_cost_paise, requested_by
  ) VALUES (
    tenant, branch, 'po_draft', 'dedupe-1', 'Duplicate check', '',
    8000, 25000, 'maker'
  ) ON CONFLICT (tenant_id, branch_id, dedupe_key) DO NOTHING;
  GET DIAGNOSTICS duplicate_rows = ROW_COUNT;

  IF duplicate_rows <> 0 OR
     (SELECT COUNT(*) FROM inventory_automation_actions WHERE tenant_id=tenant AND branch_id=branch) <> 1 OR
     (SELECT COUNT(*) FROM inventory_automation_actions WHERE tenant_id=tenant AND branch_id='branch-b') <> 0 THEN
    RAISE EXCEPTION 'automation action dedupe or branch isolation failed';
  END IF;

  WITH due AS (
    SELECT tenant_id, branch_id
    FROM inventory_automation_policies
    WHERE enabled=TRUE AND next_run_at<=NOW() AND tenant_id=tenant
    ORDER BY next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE inventory_automation_policies policy
  SET next_run_at=NOW()+make_interval(mins=>policy.run_interval_minutes), updated_at=NOW()
  FROM due
  WHERE policy.tenant_id=due.tenant_id AND policy.branch_id=due.branch_id
  RETURNING policy.branch_id INTO claimed_branch;

  IF claimed_branch IS DISTINCT FROM branch THEN
    RAISE EXCEPTION 'due automation policy claim failed';
  END IF;

  UPDATE inventory_automation_actions
  SET status='approved', reviewed_by='checker', reviewed_at=NOW(), updated_at=NOW()
  WHERE id=action_id AND requested_by<>'checker' AND status='pending_approval';

  IF NOT EXISTS (
    SELECT 1 FROM inventory_automation_actions
    WHERE id=action_id AND status='approved' AND reviewed_by='checker'
  ) THEN
    RAISE EXCEPTION 'automation review persistence failed';
  END IF;

  BEGIN
    INSERT INTO inventory_automation_policies (
      tenant_id, branch_id, monthly_budget_paise, updated_by
    ) VALUES (tenant, 'invalid-budget', -1, 'postgres-check');
    RAISE EXCEPTION 'negative automation budget unexpectedly succeeded' USING ERRCODE='XX000';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO inventory_automation_actions (
      tenant_id, branch_id, action_type, dedupe_key, title, rationale, confidence_bps,
      estimated_cost_paise, requested_by
    ) VALUES (tenant, branch, 'po_draft', 'invalid-cost', 'Invalid cost', '', 8000, -1, 'maker');
    RAISE EXCEPTION 'negative action cost unexpectedly succeeded' USING ERRCODE='XX000';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory_automation_policies
    WHERE tenant_id LIKE '__inventory_automation_pg_check__%'
  ) OR EXISTS (
    SELECT 1 FROM inventory_automation_actions
    WHERE tenant_id LIKE '__inventory_automation_pg_check__%'
  ) THEN
    RAISE EXCEPTION 'rollback left automation test rows behind';
  END IF;
END;
$$;
