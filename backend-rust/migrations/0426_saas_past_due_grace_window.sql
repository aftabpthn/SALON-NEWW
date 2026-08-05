-- A grace window between falling behind on payment and losing the ability to work.
--
-- `past_due` made the salon read-only the moment an invoice went overdue. A
-- card that expires on a Friday stopped the salon billing walk-in customers on
-- a Saturday morning — over an invoice nobody had failed to pay, only failed to
-- pay yet. The lockout arrived before the reminder did.
--
-- The window keeps the salon working while the payment is chased. Read-only is
-- still where it ends up, just not on the first day.
--
-- Length lives on the plan rather than in code so it can differ per tier
-- without a deploy.

ALTER TABLE saas_plans
  ADD COLUMN IF NOT EXISTS grace_period_days INTEGER NOT NULL DEFAULT 7
    CHECK (grace_period_days >= 0 AND grace_period_days <= 90);

-- When the subscription entered `past_due`. NULL whenever it is not past due.
--
-- Maintained by trigger, not by the five statements that currently write
-- `status`. A column that has to be remembered at every write site is a column
-- that eventually is not, and the failure mode here is silent: a missing stamp
-- reads as "grace has not started" and would keep a delinquent salon writing
-- forever.
ALTER TABLE saas_subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION saas_subscription_track_past_due()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'past_due' THEN
    -- Re-entering past_due after recovering starts a fresh window; staying in
    -- it does not, so a repeated UPDATE cannot extend the grace indefinitely.
    IF OLD.status IS DISTINCT FROM 'past_due' OR OLD.past_due_since IS NULL THEN
      NEW.past_due_since := COALESCE(OLD.past_due_since, NOW());
    ELSE
      NEW.past_due_since := OLD.past_due_since;
    END IF;
  ELSE
    NEW.past_due_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saas_subscription_track_past_due ON saas_subscriptions;
CREATE TRIGGER trg_saas_subscription_track_past_due
  BEFORE INSERT OR UPDATE OF status ON saas_subscriptions
  FOR EACH ROW EXECUTE FUNCTION saas_subscription_track_past_due();

-- Existing past-due subscriptions have no stamp, and back-dating one to an
-- unknown date would either hand out grace nobody earned or expire it
-- retroactively. They start their window now: the change takes effect from
-- when it shipped, which is the only date this migration can honestly claim.
UPDATE saas_subscriptions
  SET past_due_since = NOW()
  WHERE status = 'past_due' AND past_due_since IS NULL;

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_past_due_since
  ON saas_subscriptions (past_due_since)
  WHERE past_due_since IS NOT NULL;
