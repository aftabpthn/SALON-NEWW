-- What actually happened, next to what was predicted.
--
-- `ai_prediction_runs` already records what was predicted, from which window,
-- by which model. It never recorded whether the prediction was right, so the
-- system could not answer the one question an owner actually asks — "should I
-- believe this number?" — and no model could ever be shown to be better or
-- worse than the fallback it replaced.
--
-- These columns close the loop on the prediction row itself rather than in a
-- side table. A verdict belongs to exactly one prediction, is written once, and
-- is meaningless apart from the range it judges, so a second table would only
-- add a join and a way for the two to disagree.
--
-- Three states, and the difference between the last two matters:
--
--   pending      the horizon has not passed yet, so there is nothing to check.
--   resolved     the horizon passed and the truth was observable.
--   unresolvable the horizon passed and the truth was *not* observable — no
--                appointment was ever booked, the membership row was deleted,
--                the subject was never scored at all. Recording this as a miss
--                would understate accuracy; dropping it would overstate the
--                sample. It is neither, and it is counted separately.

ALTER TABLE ai_predictions
  -- The date the truth becomes knowable. NULL means it never will be, which is
  -- why an unresolvable row is allowed to have no horizon.
  ADD COLUMN IF NOT EXISTS horizon_end DATE,
  ADD COLUMN IF NOT EXISTS outcome_status TEXT NOT NULL DEFAULT 'pending',
  -- How the verdict was reached. A range over bookings is judged by whether it
  -- contained the count; a 0-100 risk score is judged by whether it fell on the
  -- correct side of the decision threshold. Storing the rule means a hit rate
  -- can never be read without knowing what counted as a hit.
  ADD COLUMN IF NOT EXISTS outcome_rule TEXT NOT NULL DEFAULT '',
  -- The observed value, in the prediction's own unit.
  ADD COLUMN IF NOT EXISTS actual_value NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS outcome_hit BOOLEAN,
  -- Distance from the range: zero when the actual landed inside it. Kept so a
  -- near miss and a wild miss are not the same record.
  ADD COLUMN IF NOT EXISTS outcome_error NUMERIC(14,2),
  -- Why a row is unresolvable, or the caveat on a resolved one — for example
  -- that the observation is a floor because the event had still not happened
  -- when the horizon expired.
  ADD COLUMN IF NOT EXISTS outcome_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE ai_predictions
  DROP CONSTRAINT IF EXISTS ck_ai_predictions_outcome_status;
ALTER TABLE ai_predictions
  ADD CONSTRAINT ck_ai_predictions_outcome_status
  CHECK (outcome_status IN ('pending','resolved','unresolvable')) NOT VALID;

-- A resolved row without its verdict would be a claim of knowledge with nothing
-- behind it. The database refuses rather than trusting the writer.
ALTER TABLE ai_predictions
  DROP CONSTRAINT IF EXISTS ck_ai_predictions_resolved_complete;
ALTER TABLE ai_predictions
  ADD CONSTRAINT ck_ai_predictions_resolved_complete
  CHECK (
    outcome_status <> 'resolved'
    OR (actual_value IS NOT NULL AND outcome_hit IS NOT NULL
        AND outcome_error IS NOT NULL AND resolved_at IS NOT NULL
        AND outcome_rule <> '')
  ) NOT VALID;

-- And a pending row must not carry one, so a verdict can never be written
-- before the horizon it was supposed to wait for.
ALTER TABLE ai_predictions
  DROP CONSTRAINT IF EXISTS ck_ai_predictions_pending_unjudged;
ALTER TABLE ai_predictions
  ADD CONSTRAINT ck_ai_predictions_pending_unjudged
  CHECK (
    outcome_status <> 'pending'
    OR (actual_value IS NULL AND outcome_hit IS NULL
        AND outcome_error IS NULL AND resolved_at IS NULL)
  ) NOT VALID;

-- An unresolvable row has to say why. Without the reason it is indistinguishable
-- from a row the resolver simply failed to process.
ALTER TABLE ai_predictions
  DROP CONSTRAINT IF EXISTS ck_ai_predictions_unresolvable_explained;
ALTER TABLE ai_predictions
  ADD CONSTRAINT ck_ai_predictions_unresolvable_explained
  CHECK (outcome_status <> 'unresolvable' OR outcome_note <> '') NOT VALID;

-- The resolver's own query: due rows only. A partial index keeps it proportional
-- to the backlog rather than to every prediction ever made.
CREATE INDEX IF NOT EXISTS idx_ai_predictions_due
  ON ai_predictions (horizon_end, id)
  WHERE outcome_status = 'pending';

-- The accuracy read: resolved rows for a branch, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_predictions_resolved
  ON ai_predictions (tenant_id, branch_id, created_at DESC)
  WHERE outcome_status = 'resolved';

-- Predictions made before this migration have no horizon recorded and their
-- subjects' state at the time is not recoverable. Judging them now would mean
-- inventing the window they were meant to cover, so they are closed out as
-- unresolvable and excluded from every hit rate. The first honest accuracy
-- figure comes from predictions made after this point.
UPDATE ai_predictions
   SET outcome_status = 'unresolvable',
       outcome_note = 'Predicted before outcome tracking existed; no horizon was recorded.'
 WHERE outcome_status = 'pending'
   AND horizon_end IS NULL;
