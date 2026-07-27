ALTER TABLE inventory_backbar_usage
  DROP CONSTRAINT IF EXISTS inventory_backbar_usage_maker_checker;

ALTER TABLE inventory_backbar_usage
  ADD CONSTRAINT inventory_backbar_usage_maker_checker
  CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id <> actor_user_id) NOT VALID;
