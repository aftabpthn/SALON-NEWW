-- Ties a CRM task to the AI action draft that produced it, uniquely.
--
-- The `executing` claim stops two concurrent confirmations from both writing,
-- but it is not crash-safe: a process that dies between `create_task` and the
-- approval leaves a real task behind with no approval recorded, and the retry
-- has no way to tell "already written" from "not written yet". It writes a
-- second task.
--
-- The fix is to give the task a durable identity that comes from the draft
-- rather than from the attempt. A retry looks the origin up, finds the task the
-- crashed run created, and finalises the approval against it. The unique index
-- is what makes that true even if two runs race: the second insert fails rather
-- than duplicating, and the loser reads the winner's row.
--
-- Only AI-originated tasks carry this. Tasks created from the staff screen have
-- no draft behind them, so the index is partial.

ALTER TABLE staff_tasks
  ADD COLUMN IF NOT EXISTS origin_action_draft_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_tasks_origin_action_draft
  ON staff_tasks (origin_action_draft_id)
  WHERE origin_action_draft_id IS NOT NULL;
