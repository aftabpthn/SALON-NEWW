\set ON_ERROR_STOP on
BEGIN;

INSERT INTO marketing_governance_settings(tenant_id,branch_id,frequency_cap_days,quiet_start,quiet_end,timezone)
VALUES('phase10-test-tenant','phase10-test-branch',7,'20:00','09:00','Asia/Kolkata');

DO $$
DECLARE quiet BOOLEAN;
BEGIN
  SELECT CASE WHEN quiet_start<quiet_end THEN TIME '21:00'>=quiet_start AND TIME '21:00'<quiet_end
              ELSE TIME '21:00'>=quiet_start OR TIME '21:00'<quiet_end END
    INTO quiet FROM marketing_governance_settings WHERE tenant_id='phase10-test-tenant' AND branch_id='phase10-test-branch';
  IF quiet IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'quiet-hours guard failed'; END IF;
END $$;

INSERT INTO clients(id,tenant_id,branch_id,first_name,phone,sms_opt_in)
VALUES('phase10-test-client','phase10-test-tenant','phase10-test-branch','Phase Test','+910000000000',TRUE);

INSERT INTO benefit_notification_outbox(tenant_id,branch_id,source_type,source_id,client_id,channel,recipient,payload_json)
VALUES('phase10-test-tenant','phase10-test-branch','marketing_campaign','campaign-1:phase10-test-client','phase10-test-client','sms','+910000000000','{"campaignId":"campaign-1"}');
INSERT INTO benefit_notification_outbox(tenant_id,branch_id,source_type,source_id,client_id,channel,recipient,payload_json)
VALUES('phase10-test-tenant','phase10-test-branch','marketing_campaign','campaign-1:phase10-test-client','phase10-test-client','sms','+910000000000','{"campaignId":"campaign-1"}') ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM benefit_notification_outbox WHERE tenant_id='phase10-test-tenant' AND branch_id='phase10-test-branch' AND source_id='campaign-1:phase10-test-client' AND channel='sms') <> 1 THEN
    RAISE EXCEPTION 'campaign recipient idempotency failed';
  END IF;
END $$;

ROLLBACK;
