CREATE OR REPLACE FUNCTION reject_non_real_business_record()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  record_json JSONB := TO_JSONB(NEW);
  identity_text TEXT := LOWER(CONCAT_WS(
    ' ',
    record_json->>'first_name',
    record_json->>'middle_name',
    record_json->>'last_name',
    record_json->>'name',
    record_json->>'title',
    record_json->>'item_name'
  ));
BEGIN
  IF CURRENT_DATABASE() ~* '(^|[_-])(test|ci)([_-]|$)' THEN
    RETURN NEW;
  END IF;

  IF identity_text ~ '(^|[^a-z0-9])(dummy|demo|sample|placeholder|fake|e2e|test|phase[0-9]*|runtime)([^a-z0-9]|$)' THEN
    RAISE EXCEPTION 'dummy or test business data is not allowed in the shared CRM database'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_real_data_only ON clients;
CREATE TRIGGER trg_clients_real_data_only
BEFORE INSERT OR UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_staff_real_data_only ON staff;
CREATE TRIGGER trg_staff_real_data_only
BEFORE INSERT OR UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_services_real_data_only ON services;
CREATE TRIGGER trg_services_real_data_only
BEFORE INSERT OR UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_memberships_real_data_only ON memberships;
CREATE TRIGGER trg_memberships_real_data_only
BEFORE INSERT OR UPDATE ON memberships
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_packages_real_data_only ON packages;
CREATE TRIGGER trg_packages_real_data_only
BEFORE INSERT OR UPDATE ON packages
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_inventory_items_real_data_only ON inventory_items;
CREATE TRIGGER trg_inventory_items_real_data_only
BEFORE INSERT OR UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_branches_real_data_only ON branches;
CREATE TRIGGER trg_branches_real_data_only
BEFORE INSERT OR UPDATE ON branches
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();

DROP TRIGGER IF EXISTS trg_tenants_real_data_only ON tenants;
CREATE TRIGGER trg_tenants_real_data_only
BEFORE INSERT OR UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION reject_non_real_business_record();
