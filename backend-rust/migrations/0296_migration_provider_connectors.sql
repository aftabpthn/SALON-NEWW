ALTER TABLE integration_connector_connections
  DROP CONSTRAINT IF EXISTS integration_connector_connections_provider_check;
ALTER TABLE integration_connector_connections
  ADD CONSTRAINT integration_connector_connections_provider_check
  CHECK (provider IN ('quickbooks','xero','netsuite','google','zenoti','dingg'));
