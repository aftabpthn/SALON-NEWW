-- Canonical tenant/branch identity: master UUIDs are the only operational IDs.
-- Legacy scope/code values remain resolvable through explicit alias tables.

CREATE TABLE IF NOT EXISTS tenant_id_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'legacy_scope',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (BTRIM(alias) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_id_aliases_alias
  ON tenant_id_aliases(LOWER(alias));
CREATE INDEX IF NOT EXISTS idx_tenant_id_aliases_tenant
  ON tenant_id_aliases(tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_tenant_id_id
  ON branches(tenant_id, id);

CREATE TABLE IF NOT EXISTS branch_id_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL,
  alias TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'legacy_scope',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, branch_id)
    REFERENCES branches(tenant_id, id) ON DELETE CASCADE,
  CHECK (BTRIM(alias) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_id_aliases_tenant_alias
  ON branch_id_aliases(tenant_id, LOWER(alias));
CREATE INDEX IF NOT EXISTS idx_branch_id_aliases_branch
  ON branch_id_aliases(tenant_id, branch_id);

INSERT INTO tenant_id_aliases (tenant_id, alias, source)
SELECT id, BTRIM(scope_id), 'legacy_scope'
FROM tenants
WHERE scope_id IS NOT NULL
  AND BTRIM(scope_id) <> ''
  AND LOWER(BTRIM(scope_id)) <> LOWER(id::TEXT)
ON CONFLICT DO NOTHING;

INSERT INTO branch_id_aliases (tenant_id, branch_id, alias, source)
SELECT tenant_id, id, BTRIM(scope_id), 'legacy_scope'
FROM branches
WHERE scope_id IS NOT NULL
  AND BTRIM(scope_id) <> ''
  AND LOWER(BTRIM(scope_id)) <> LOWER(id::TEXT)
ON CONFLICT DO NOTHING;

INSERT INTO branch_id_aliases (tenant_id, branch_id, alias, source)
SELECT tenant_id, id, BTRIM(code), 'legacy_code'
FROM branches
WHERE code IS NOT NULL
  AND BTRIM(code) <> ''
  AND LOWER(BTRIM(code)) <> LOWER(id::TEXT)
ON CONFLICT DO NOTHING;

-- Composite operational foreign keys must be deferred while both sides move
-- from legacy text scope values to canonical UUID strings in one transaction.
CREATE TEMP TABLE canonical_scope_fk_state ON COMMIT DROP AS
SELECT namespace.nspname AS schema_name,
       relation.relname AS table_name,
       constraint_row.conname AS constraint_name,
       constraint_row.condeferrable AS was_deferrable
FROM pg_constraint constraint_row
JOIN pg_class relation ON relation.oid = constraint_row.conrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE constraint_row.contype = 'f'
  AND namespace.nspname = 'public'
  AND EXISTS (
    SELECT 1
    FROM UNNEST(constraint_row.conkey) AS key(attnum)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attnum = key.attnum
    WHERE attribute.attname = 'tenant_id'
       OR attribute.attname = 'branch_id'
       OR attribute.attname LIKE '%\_branch_id' ESCAPE '\'
  );

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN SELECT * FROM canonical_scope_fk_state WHERE NOT was_deferrable LOOP
    EXECUTE FORMAT(
      'ALTER TABLE %I.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',
      item.schema_name,
      item.table_name,
      item.constraint_name
    );
  END LOOP;
END;
$$;

SET CONSTRAINTS ALL DEFERRED;

-- Immutable ledger/audit triggers correctly reject normal business updates.
-- Preserve their exact state, disable them only for this transactional ID
-- rewrite, then restore them before the migration commits.
CREATE TEMP TABLE canonical_scope_trigger_state ON COMMIT DROP AS
SELECT namespace.nspname AS schema_name,
       relation.relname AS table_name,
       trigger_row.tgname AS trigger_name,
       trigger_row.tgenabled AS enabled_state
FROM pg_trigger trigger_row
JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE NOT trigger_row.tgisinternal
  AND namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p')
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns column_row
    WHERE column_row.table_schema = namespace.nspname
      AND column_row.table_name = relation.relname
      AND column_row.column_name = 'tenant_id'
      AND column_row.data_type IN ('text', 'character varying')
  );

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT DISTINCT schema_name, table_name FROM canonical_scope_trigger_state
  LOOP
    EXECUTE FORMAT('ALTER TABLE %I.%I DISABLE TRIGGER USER', item.schema_name, item.table_name);
  END LOOP;
END;
$$;

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT column_row.table_schema, column_row.table_name
    FROM information_schema.columns column_row
    JOIN information_schema.tables table_row
      ON table_row.table_schema = column_row.table_schema
     AND table_row.table_name = column_row.table_name
     AND table_row.table_type = 'BASE TABLE'
    WHERE column_row.table_schema = 'public'
      AND column_row.column_name = 'tenant_id'
      AND column_row.data_type IN ('text', 'character varying')
      AND column_row.table_name NOT IN ('tenant_id_aliases', 'branch_id_aliases')
  LOOP
    EXECUTE FORMAT(
      'UPDATE %I.%I AS target
          SET tenant_id = alias.tenant_id::TEXT
         FROM tenant_id_aliases alias
        WHERE LOWER(target.tenant_id) = LOWER(alias.alias)
          AND target.tenant_id IS DISTINCT FROM alias.tenant_id::TEXT',
      item.table_schema,
      item.table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT branch_column.table_schema,
           branch_column.table_name,
           branch_column.column_name
    FROM information_schema.columns branch_column
    JOIN information_schema.tables table_row
      ON table_row.table_schema = branch_column.table_schema
     AND table_row.table_name = branch_column.table_name
     AND table_row.table_type = 'BASE TABLE'
    JOIN information_schema.columns tenant_column
      ON tenant_column.table_schema = branch_column.table_schema
     AND tenant_column.table_name = branch_column.table_name
     AND tenant_column.column_name = 'tenant_id'
     AND tenant_column.data_type IN ('text', 'character varying')
    WHERE branch_column.table_schema = 'public'
      AND branch_column.data_type IN ('text', 'character varying')
      AND (
        branch_column.column_name = 'branch_id'
        OR branch_column.column_name LIKE '%\_branch_id' ESCAPE '\'
      )
      AND branch_column.table_name <> 'branch_id_aliases'
  LOOP
    EXECUTE FORMAT(
      'UPDATE %I.%I AS target
          SET %I = alias.branch_id::TEXT
         FROM branch_id_aliases alias
        WHERE target.tenant_id = alias.tenant_id::TEXT
          AND LOWER(target.%I) = LOWER(alias.alias)
          AND target.%I IS DISTINCT FROM alias.branch_id::TEXT',
      item.table_schema,
      item.table_name,
      item.column_name,
      item.column_name,
      item.column_name
    );
  END LOOP;
END;
$$;

UPDATE tenants SET scope_id = id::TEXT
WHERE scope_id IS DISTINCT FROM id::TEXT;
UPDATE branches SET scope_id = id::TEXT
WHERE scope_id IS DISTINCT FROM id::TEXT;

ALTER TABLE tenants ALTER COLUMN scope_id SET NOT NULL;
ALTER TABLE branches ALTER COLUMN scope_id SET NOT NULL;

CREATE OR REPLACE FUNCTION enforce_canonical_master_scope_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.scope_id := NEW.id::TEXT;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_canonical_scope_id ON tenants;
CREATE TRIGGER trg_tenants_canonical_scope_id
BEFORE INSERT OR UPDATE OF id, scope_id ON tenants
FOR EACH ROW EXECUTE FUNCTION enforce_canonical_master_scope_id();

DROP TRIGGER IF EXISTS trg_branches_canonical_scope_id ON branches;
CREATE TRIGGER trg_branches_canonical_scope_id
BEFORE INSERT OR UPDATE OF id, scope_id ON branches
FOR EACH ROW EXECUTE FUNCTION enforce_canonical_master_scope_id();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenants'::regclass
      AND conname = 'ck_tenants_scope_id_canonical'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT ck_tenants_scope_id_canonical
      CHECK (scope_id = id::TEXT);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'branches'::regclass
      AND conname = 'ck_branches_scope_id_canonical'
  ) THEN
    ALTER TABLE branches ADD CONSTRAINT ck_branches_scope_id_canonical
      CHECK (scope_id = id::TEXT);
  END IF;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE
  item RECORD;
  action TEXT;
BEGIN
  FOR item IN SELECT * FROM canonical_scope_trigger_state LOOP
    action := CASE item.enabled_state
      WHEN 'O' THEN 'ENABLE TRIGGER'
      WHEN 'A' THEN 'ENABLE ALWAYS TRIGGER'
      WHEN 'R' THEN 'ENABLE REPLICA TRIGGER'
      ELSE 'DISABLE TRIGGER'
    END;
    EXECUTE FORMAT(
      'ALTER TABLE %I.%I %s %I',
      item.schema_name,
      item.table_name,
      action,
      item.trigger_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN SELECT * FROM canonical_scope_fk_state WHERE NOT was_deferrable LOOP
    EXECUTE FORMAT(
      'ALTER TABLE %I.%I ALTER CONSTRAINT %I NOT DEFERRABLE',
      item.schema_name,
      item.table_name,
      item.constraint_name
    );
  END LOOP;
END;
$$;
