WITH tenant_code_max AS (
  SELECT
    tenant_id,
    COALESCE(MAX(employee_code::BIGINT) FILTER (
      WHERE employee_code ~ '^[0-9]{1,18}$'
    ), 0) AS max_code
  FROM staff
  GROUP BY tenant_id
), missing_codes AS (
  SELECT
    staff.id,
    tenant_code_max.max_code
      + ROW_NUMBER() OVER (
          PARTITION BY staff.tenant_id
          ORDER BY staff.created_at, staff.id
        ) AS generated_code
  FROM staff
  JOIN tenant_code_max ON tenant_code_max.tenant_id = staff.tenant_id
  WHERE NULLIF(BTRIM(staff.employee_code), '') IS NULL
)
UPDATE staff
SET
  employee_code = CASE
    WHEN missing_codes.generated_code < 10000
      THEN LPAD(missing_codes.generated_code::TEXT, 4, '0')
    ELSE missing_codes.generated_code::TEXT
  END,
  updated_at = NOW()
FROM missing_codes
WHERE staff.id = missing_codes.id;
