ALTER TABLE supplier_opening_payable_imports
  ADD COLUMN IF NOT EXISTS branch_confirmed_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS branch_confirmed_at TIMESTAMPTZ,
  ADD CONSTRAINT supplier_opening_payable_imports_branch_confirmation_pair
  CHECK((branch_confirmed_by IS NULL)=(branch_confirmed_at IS NULL));

CREATE OR REPLACE FUNCTION validate_opening_payable_branch_confirmation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.branch_confirmed_by IS NULL OR NEW.branch_confirmed_at IS NULL OR NOT EXISTS(
    SELECT 1
      FROM integration_import_jobs job
     WHERE job.id=NEW.import_job_id AND job.tenant_id=NEW.tenant_id
       AND job.branch_id=NEW.branch_id AND job.entity='opening-payables'
       AND job.analysis_json->'openingPayableBranchConfirmation'->>'confirmed'='true'
       AND job.analysis_json->'openingPayableBranchConfirmation'->>'approvedBy'=NEW.branch_confirmed_by
       AND (job.analysis_json->'openingPayableBranchConfirmation'->>'approvedAt')::TIMESTAMPTZ=NEW.branch_confirmed_at
       AND job.analysis_json->'openingPayableBranchConfirmation'->>'sourceHash'=NEW.source_checksum
       AND job.analysis_json->'openingPayableBranchConfirmation'->>'dataHash'=
         ENCODE(DIGEST(COALESCE((SELECT STRING_AGG(result.source_payload::TEXT,'|' ORDER BY result.source_sheet,result.source_row_number)
           FROM integration_import_row_results result
          WHERE result.tenant_id=job.tenant_id AND result.branch_id=job.branch_id AND result.job_id=job.id),''),'sha256'),'hex')
       AND job.analysis_json->'openingPayableBranchConfirmation'->>'financeApprovedAt'=
           job.analysis_json->'openingPayableControls'->>'approvedAt'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_BRANCH_CONFIRMATION_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opening_payable_branch_confirmation
  ON supplier_opening_payable_imports;
CREATE TRIGGER trg_opening_payable_branch_confirmation
BEFORE INSERT ON supplier_opening_payable_imports
FOR EACH ROW EXECUTE FUNCTION validate_opening_payable_branch_confirmation();

CREATE OR REPLACE FUNCTION protect_opening_payable_branch_confirmation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.branch_confirmed_by IS DISTINCT FROM OLD.branch_confirmed_by
     OR NEW.branch_confirmed_at IS DISTINCT FROM OLD.branch_confirmed_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='OPENING_PAYABLE_BRANCH_CONFIRMATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_opening_payable_branch_confirmation_immutable
  ON supplier_opening_payable_imports;
CREATE TRIGGER trg_opening_payable_branch_confirmation_immutable
BEFORE UPDATE ON supplier_opening_payable_imports
FOR EACH ROW EXECUTE FUNCTION protect_opening_payable_branch_confirmation();
