CREATE TABLE IF NOT EXISTS appointment_deposit_followups (
  payment_link_id TEXT PRIMARY KEY REFERENCES appointment_payment_links(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reminder_sent','done')),
  reminder_channel TEXT NOT NULL DEFAULT '',
  reminder_sent_at TIMESTAMPTZ,
  done_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_deposit_followups_scope
  ON appointment_deposit_followups (tenant_id,branch_id,status,updated_at DESC);
