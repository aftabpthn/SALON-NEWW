ALTER TABLE staff_coaching_goals
  ADD COLUMN IF NOT EXISTS projected_impact_paise BIGINT
    CHECK (projected_impact_paise IS NULL OR projected_impact_paise >= 0);
