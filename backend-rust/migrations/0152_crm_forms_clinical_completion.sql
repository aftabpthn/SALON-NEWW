CREATE TABLE IF NOT EXISTS client_family_links (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  related_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('spouse','parent','child','sibling','guardian','dependent','partner','other')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (client_id <> related_client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_family_links_pair
  ON client_family_links (
    tenant_id,
    branch_id,
    LEAST(client_id, related_client_id),
    GREATEST(client_id, related_client_id)
  );

CREATE INDEX IF NOT EXISTS idx_client_family_links_client
  ON client_family_links (tenant_id, branch_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_family_links_related
  ON client_family_links (tenant_id, branch_id, related_client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_soap_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  subjective TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (subjective <> '' OR objective <> '' OR assessment <> '' OR plan <> '')
);

CREATE INDEX IF NOT EXISTS idx_client_soap_notes_client
  ON client_soap_notes (tenant_id, branch_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_soap_notes_appointment
  ON client_soap_notes (tenant_id, branch_id, appointment_id)
  WHERE appointment_id IS NOT NULL;
