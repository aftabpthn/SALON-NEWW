# Staff Live UAT

Use a dedicated staging tenant and real API/database records. Do not paste credentials, tokens, employee bank details, or push subscription payloads into screenshots or logs.

Record each run with date, tester, app commit, backend commit, device/browser, evidence link, and `PASS` or `FAIL`. An item remains pending until its evidence exists.

## Push Notifications

Prerequisites:

- HTTPS staging deployment.
- `MOBILE_PUSH_PROVIDER_URL`, `MOBILE_PUSH_PROVIDER_TOKEN`, `MOBILE_PUSH_PUBLIC_KEY`, and `SECURITY_ENCRYPTION_KEY` configured through the deployment secret store.
- A staff account with an active branch and notification permission.

Checks:

1. Sign in to the staff app and confirm `GET /api/v1/staff/self/mobile/push-config` returns `configured: true` without exposing provider secrets.
2. Allow browser/device notifications and confirm device plus subscription registration succeeds.
3. Trigger one real staff notification from the CRM workflow.
4. Verify foreground, background, and closed-app delivery on one Android device and one iOS device.
5. Revoke the subscription and confirm no later notification reaches that device.
6. Capture the notification delivery log and request id with all PII and tokens redacted.

Pass criteria: one delivery per event, correct tenant/branch recipient, no secret leakage, and revoked devices receive nothing.

## Native Android And iOS

Prerequisites:

- Angular staff app build completed by the release operator.
- Capacitor sync completed from the same commit.
- Android keystore and Apple signing profiles stored outside Git.

Checks:

1. Produce signed staging builds and record version, build number, commit, and signing identity.
2. Install on one supported Android device and one supported iOS device.
3. Verify login, logout, token refresh, branch context, dashboard, attendance, leave request, payroll, chat, and push notification flows.
4. Disable network, queue an allowed attendance action, reconnect, and verify exactly one server mutation.
5. Confirm screenshots, crash logs, recent-app preview, and device logs do not expose tokens or payroll PII.

Pass criteria: both signed builds install cleanly, critical workflows use real APIs, offline replay is idempotent, and no sensitive data leaks.

## Bank Payroll Payout

Prerequisites:

- Provider sandbox or approved staging account.
- `PAYROLL_PAYOUT_PROVIDER_URL` uses HTTPS and `PAYROLL_PAYOUT_PROVIDER_TOKEN` is stored in the deployment secret store.
- A finalized staging payroll run approved for payout UAT.
- MFA-enabled user with payroll payout permission.

Checks:

1. Call `POST /api/v1/staff-payroll/runs/:run_id/payout` with `paymentMethod: bank`, MFA proof, and a unique idempotency key.
2. Verify the provider receives tenant, branch, run, period, INR currency, and staff payout amounts in paise.
3. Confirm the provider returns a settled status and non-empty provider reference.
4. Retry with the same idempotency key and verify no duplicate transfer or accounting entry is created.
5. Verify payroll payout, accounting posting, audit event, and staff payslip/dashboard status agree.
6. Exercise rejected, timeout, invalid-response, and not-settled responses; each must remain unpaid and safe to retry.

Pass criteria: totals reconcile exactly, provider reference persists, duplicate payout is impossible, failures do not mark the run paid, and the audit trail identifies the actor and request.

## Release Evidence

The release owner signs off only when all three sections pass. Configure branch protection to require the GitHub check `Staff quality gate / staff-contracts` before merge.
