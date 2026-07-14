CREATE INDEX IF NOT EXISTS idx_clients_search_trigram
  ON clients USING GIN (
    LOWER(
      first_name || ' ' || last_name || ' ' || phone || ' ' ||
      normalized_phone || ' ' || email || ' ' || COALESCE(code, '')
    ) gin_trgm_ops
  );
