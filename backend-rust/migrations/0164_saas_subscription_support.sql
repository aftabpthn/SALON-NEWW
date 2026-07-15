CREATE TABLE IF NOT EXISTS saas_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  branch_id TEXT NOT NULL DEFAULT 'global',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('monthly','yearly')),
  base_price_paise BIGINT NOT NULL CHECK (base_price_paise >= 0),
  included_branches INTEGER NOT NULL DEFAULT 1 CHECK (included_branches >= 0),
  included_users INTEGER NOT NULL DEFAULT 1 CHECK (included_users >= 0),
  included_appointments INTEGER NOT NULL DEFAULT 0 CHECK (included_appointments >= 0),
  overage_branch_paise BIGINT NOT NULL DEFAULT 0 CHECK (overage_branch_paise >= 0),
  overage_user_paise BIGINT NOT NULL DEFAULT 0 CHECK (overage_user_paise >= 0),
  overage_appointment_paise BIGINT NOT NULL DEFAULT 0 CHECK (overage_appointment_paise >= 0),
  features_json JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(features_json)='array'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,code)
);
CREATE INDEX IF NOT EXISTS idx_saas_plans_scope ON saas_plans(tenant_id,branch_id,active,name);

CREATE TABLE IF NOT EXISTS saas_sla_policies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'platform',
  branch_id TEXT NOT NULL DEFAULT 'global',
  plan_id TEXT NOT NULL REFERENCES saas_plans(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes >= first_response_minutes),
  business_hours_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,branch_id,plan_id,severity)
);
CREATE INDEX IF NOT EXISTS idx_saas_sla_plan ON saas_sla_policies(tenant_id,branch_id,plan_id,severity);

CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  plan_id TEXT NOT NULL REFERENCES saas_plans(id),
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','paused','cancelled')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_customer_ref TEXT NOT NULL DEFAULT '',
  provider_subscription_ref TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (current_period_end > current_period_start)
);
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_scope ON saas_subscriptions(tenant_id,branch_id,status,current_period_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_subscription_one_current
  ON saas_subscriptions(tenant_id,branch_id)
  WHERE status IN ('trialing','active','past_due','paused');

CREATE TABLE IF NOT EXISTS saas_usage_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
  metric TEXT NOT NULL CHECK (metric IN ('api_calls','messages','storage_mb','custom')),
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  idempotency_key TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata_json)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_saas_usage_period ON saas_usage_events(tenant_id,subscription_id,metric,occurred_at);

CREATE TABLE IF NOT EXISTS saas_invoices (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  subscription_id TEXT NOT NULL REFERENCES saas_subscriptions(id),
  invoice_number TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  base_amount_paise BIGINT NOT NULL CHECK (base_amount_paise >= 0),
  usage_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (usage_amount_paise >= 0),
  tax_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise >= 0),
  paid_paise BIGINT NOT NULL DEFAULT 0 CHECK (paid_paise >= 0 AND paid_paise <= total_paise),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','partially_paid','paid','void','overdue')),
  due_at TIMESTAMPTZ NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,invoice_number),
  UNIQUE (tenant_id,idempotency_key),
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS idx_saas_invoices_scope ON saas_invoices(tenant_id,branch_id,status,due_at,issued_at DESC);

CREATE TABLE IF NOT EXISTS saas_invoice_payments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'global',
  invoice_id TEXT NOT NULL REFERENCES saas_invoices(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  received_by TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_saas_invoice_payments_invoice ON saas_invoice_payments(tenant_id,invoice_id,received_at);

CREATE TABLE IF NOT EXISTS saas_support_tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  subscription_id TEXT REFERENCES saas_subscriptions(id),
  plan_id TEXT REFERENCES saas_plans(id),
  ticket_number TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('billing','technical','account','data','security','other')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  priority TEXT NOT NULL CHECK (priority IN ('normal','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  assigned_to TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,ticket_number)
);
CREATE INDEX IF NOT EXISTS idx_saas_support_scope ON saas_support_tickets(tenant_id,branch_id,status,severity,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saas_support_platform ON saas_support_tickets(status,severity,resolution_due_at,created_at DESC);

CREATE TABLE IF NOT EXISTS saas_support_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES saas_support_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('customer','support')),
  visibility TEXT NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer','internal')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saas_support_messages_ticket ON saas_support_messages(tenant_id,ticket_id,created_at);

CREATE TABLE IF NOT EXISTS saas_support_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES saas_support_tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(details_json)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saas_support_events_ticket ON saas_support_events(tenant_id,ticket_id,created_at DESC);
