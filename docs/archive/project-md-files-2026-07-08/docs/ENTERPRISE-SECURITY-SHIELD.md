# Enterprise Security Shield

Aura CRM/POS includes Enterprise Security Shield: secure headers, admin 2FA, failed-login lockout, tenant isolation, real-time threat detection, security alerts, active IP blocking, honeypot detection, and audit trail. The goal is not to claim 100% unhackable security, but to detect, alert, block, audit, and recover from suspicious activity.

## What Is Active

- Secure Foundation: CSP, HSTS for HTTPS/production, COOP/CORP, X-XSS-Protection disabled correctly, X-Powered-By removal, existing rate limiting, nosniff, frame protection and referrer policy.
- Strong Login Protection: admin/owner 2FA with TOTP, authenticator setup URI, recovery codes, failed-login lockout and login 2FA challenge support.
- Threat Detection: repeated failed login detection, multiple-account attack detection, admin new-IP login alerts, off-hours admin login alerts, tenant/branch isolation violation hooks, bulk action hooks, sensitive access hooks and request spike hooks.
- Real-Time Alerts: critical and warning alerts are stored in `security_alerts` and queued for owner/admin users through `push_notifications`.
- Active Defense: critical brute-force indicators can create temporary IP blocks in `security_blocklist`; repeated critical alerts extend block duration.
- Honeypot Detection: fake scanner/probing endpoints record critical alerts without revealing the honeypot.
- Audit Trail: login success/failure, 2FA changes, security alerts, blocklist changes and honeypot alerts are recorded through the existing security audit architecture.

## Dashboard Visible

- `/enterprise-security-shield`: overview of the seven security layers.
- `/two-factor`: 2FA status, setup, enable, recovery codes and disable controls.
- `/security-alerts`: open, critical, warning and resolved alert summary with alert queue and resolve action.
- `/security-blocklist`: active, expired and unblocked IP/user block records with unblock action.
- `/security`: existing security summary, audit logs, sessions, permissions, encryption and backup controls.

## WhatsApp And Email Ready

Critical and warning alerts are already normalized into the notification queue with:

- title
- summary
- severity
- IP address
- user ID when available
- alert ID
- timestamp

This keeps the alert pipeline ready for WhatsApp, MSG91, email or mobile push delivery without tightly coupling the security service to a single provider.

## Security Model

Enterprise Security Shield is built around five operational outcomes:

- Detect suspicious behavior.
- Alert owner/admin users.
- Block high-risk activity when appropriate.
- Audit sensitive activity for investigation.
- Recover through existing backup and security controls.

## Limitations

- In-memory counters for failed-login/request-spike detection reset on server restart unless later moved to a DB-backed/shared counter.
- Multi-server deployment needs shared state for counters and block decisions.
- Production security still requires HTTPS, strong `JWT_SECRET`, strong `ENCRYPTION_SECRET`, secure backups and restricted server access.
- No software should be represented as impossible to hack; the correct claim is layered detection, alerting, blocking, auditing and recovery.

## Client-Facing Summary

Aura CRM/POS includes Enterprise Security Shield, a layered security model for secure login, real-time threat detection, active defense and audit readiness. It helps make unauthorized access difficult, detects suspicious behavior early, alerts the right users, blocks risky IPs when needed and keeps investigation history available for review.
