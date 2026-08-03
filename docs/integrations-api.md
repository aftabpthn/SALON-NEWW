# Integrations API v1

## Public API

Base path: `/api/v1/integrations/v1`.

Create a branch-scoped service credential in **Integrations & Data → API Keys**.
The secret is returned once, stored only as a password hash, and supports expiry,
rotation, IP allowlisting, per-minute rate limits and these scopes:

- `clients.read`
- `appointments.read`
- `sales.read`
- `staff.read`

Send the credential as `x-api-key`. Tenant and branch come from the credential;
request headers cannot widen its scope. A missing/invalid key returns `401`, a
missing scope returns `403`, and an exceeded budget returns `429`.

List endpoints accept `page` (default `1`) and `pageSize` (default `100`, maximum
`500`). Responses include `meta.page`, `meta.pageSize` and `meta.total`. The old
`limit` query remains a compatibility alias for `pageSize`.

OpenAPI: `GET /api/v1/openapi.json`.

## Webhooks

Subscriptions require a public HTTPS endpoint. Secrets are encrypted and shown
only at creation/rotation. Each delivery includes:

```text
x-aurashine-event: appointment.status_changed
x-aurashine-delivery: <stable event id>
x-aurashine-timestamp: <unix seconds>
x-aurashine-signature-v2: sha256=<HMAC-SHA256>
```

Verify HMAC-SHA256 over:

```text
<timestamp>.<delivery id>.<raw request body>
```

Reject timestamps outside the consumer's replay window and deduplicate by the
stable delivery id. The legacy `x-aurashine-signature` remains during migration.

Failed deliveries retry with bounded backoff. Exhausted deliveries enter
`dead_letter`; every attempt is append-only with response status and duration.
Authorized administrators can replay only `failed` or `dead_letter` deliveries
from the Webhooks health panel or:

```text
POST /api/v1/settings/integrations/webhook-deliveries/:id/replay
```

## Connectors and migration

OAuth 2.0/PKCE is used for supported accounting/calendar connectors. Zenoti and
DINGG use encrypted migration credentials; Salonist, Fresha, Tally, BUSY, CSV,
XLSX and ZIP use the same immutable upload, mapping, dry-run, approval,
reconciliation, rollback and proof-pack engine.

`history_only` never posts current stock, GST, payable or GL effects.
`opening_snapshot`, `opening_payable` and `live_receipt` are separately approved
posting modes. See `DATA_MIGRATION_RUNBOOK.md` and
`DATA_MIGRATION_PHASE_14_CERTIFICATION.md`.

Local checks and adapter availability are not provider certification. A real
sanitized/provider export, source checksum, counts/totals reconciliation and
signed proof pack are mandatory certification evidence.
