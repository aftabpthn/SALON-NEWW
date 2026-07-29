ALTER TABLE cash_drawer_movements
  ADD COLUMN IF NOT EXISTS cash_drawer_till_id TEXT REFERENCES cash_drawer_tills(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_cash_drawer_movements_till
  ON cash_drawer_movements (tenant_id, branch_id, cash_drawer_till_id, created_at DESC)
  WHERE cash_drawer_till_id IS NOT NULL;

UPDATE cash_drawer_movements movement
   SET cash_drawer_till_id = single_till.till_id
  FROM (
    SELECT tenant_id, branch_id, drawer_session_id, MIN(id) AS till_id
      FROM cash_drawer_tills
     GROUP BY tenant_id, branch_id, drawer_session_id
    HAVING COUNT(*) = 1
  ) single_till
 WHERE movement.tenant_id = single_till.tenant_id
   AND movement.branch_id = single_till.branch_id
   AND movement.drawer_session_id = single_till.drawer_session_id
   AND movement.movement_type IN ('cash_in','cash_out','refund_cash','closing_adjustment')
   AND movement.cash_drawer_till_id IS NULL;
