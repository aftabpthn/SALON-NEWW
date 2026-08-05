-- Coupon codes for SaaS subscription checkout.
--
-- A salon signing up types a code and expects money off. The obvious way to
-- build that is to subtract a discount from the plan price and show the result.
-- That is also how a checkout ends up showing one number while the card is
-- charged another, because the price the customer is actually billed does not
-- live here — it lives in the Razorpay plan the subscription is created against.
--
-- So a coupon here is not a discount amount. It is a named pointer to a
-- Razorpay Offer, created once in the Razorpay dashboard, that Razorpay itself
-- applies when the subscription is created. We validate the code, decide
-- whether this tenant may use it, and hand Razorpay the offer id. Razorpay
-- computes the money. The two cannot disagree, because only one of them is
-- doing arithmetic.
--
-- `discount_hint_bps` and `discount_hint_paise` exist only so the checkout
-- screen can say "25% off" before the redirect. They are labels, never used to
-- compute a payable amount, which is why neither is required.

CREATE TABLE IF NOT EXISTS saas_subscription_coupons (
  id TEXT PRIMARY KEY,
  -- Typed by a human, matched case-insensitively. Stored uppercase.
  code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- The Razorpay Offer this code stands for. Razorpay offer ids start `offer_`;
  -- anything else is a configuration mistake and is rejected on write rather
  -- than discovered at checkout.
  provider_offer_ref TEXT NOT NULL CHECK (provider_offer_ref LIKE 'offer\_%'),
  -- Display only. Never used to compute what the customer pays.
  discount_hint_bps INTEGER CHECK (discount_hint_bps IS NULL OR (discount_hint_bps > 0 AND discount_hint_bps <= 10000)),
  discount_hint_paise BIGINT CHECK (discount_hint_paise IS NULL OR discount_hint_paise > 0),
  -- Empty means every active plan. Otherwise the code only applies to the
  -- plans named here, so an annual-only promotion cannot be spent on monthly.
  plan_ids TEXT[] NOT NULL DEFAULT '{}',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  -- NULL means unlimited. Enforced against redemptions, not against this row,
  -- so two concurrent checkouts cannot both pass the check.
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  -- A code meant for one salon only. Enforced the same way.
  max_redemptions_per_tenant INTEGER NOT NULL DEFAULT 1
    CHECK (max_redemptions_per_tenant > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Codes are matched case-insensitively, so uniqueness has to be too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_subscription_coupons_code
  ON saas_subscription_coupons (UPPER(code));

-- One row per accepted checkout. This is what the redemption limits are counted
-- from, and what says which coupon a live subscription was opened with.
CREATE TABLE IF NOT EXISTS saas_coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES saas_subscription_coupons(id),
  tenant_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  -- The checkout idempotency key the code was accepted under. Replaying that
  -- key returns the first checkout, so it must not count as a second redemption.
  checkout_key TEXT NOT NULL,
  provider_offer_ref TEXT NOT NULL,
  provider_subscription_ref TEXT NOT NULL DEFAULT '',
  redeemed_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A replayed checkout is the same redemption, not a new one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_coupon_redemptions_checkout
  ON saas_coupon_redemptions (tenant_id, checkout_key);

-- Both limit checks count rows through these.
CREATE INDEX IF NOT EXISTS idx_saas_coupon_redemptions_coupon
  ON saas_coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS idx_saas_coupon_redemptions_coupon_tenant
  ON saas_coupon_redemptions (coupon_id, tenant_id);
