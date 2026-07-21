ALTER TABLE multi_branch_approvals
  DROP CONSTRAINT IF EXISTS multi_branch_approvals_separate_approver;

ALTER TABLE multi_branch_approvals
  ADD CONSTRAINT multi_branch_approvals_separate_approver
  CHECK (decided_by IS NULL OR decided_by <> requested_by) NOT VALID;
