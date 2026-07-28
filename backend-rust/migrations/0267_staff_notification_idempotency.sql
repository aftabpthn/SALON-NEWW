WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, branch_id, staff_id, notification_type,
                        metadata_json->>'idempotencyKey'
           ORDER BY created_at, id
         ) AS duplicate_number
  FROM staff_notification_queue
  WHERE NULLIF(metadata_json->>'idempotencyKey', '') IS NOT NULL
)
UPDATE staff_notification_queue queue
SET metadata_json = queue.metadata_json - 'idempotencyKey'
FROM duplicates
WHERE queue.id = duplicates.id
  AND duplicates.duplicate_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_notification_queue_idempotency
  ON staff_notification_queue(
    tenant_id,
    branch_id,
    staff_id,
    notification_type,
    (metadata_json->>'idempotencyKey')
  )
  WHERE NULLIF(metadata_json->>'idempotencyKey', '') IS NOT NULL;
