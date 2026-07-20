# Inventory API contracts

All endpoints are served below both `/api/v1` and `/api`. Protected requests require the normal bearer token plus `X-Tenant-Id` and `X-Branch-Id`. Durable records are always tenant and branch scoped. Money uses integer paise; dates use ISO `YYYY-MM-DD`; timestamps use ISO-8601 UTC.

## Inventory policy

- `GET /inventory/policy` returns the effective branch policy. A branch without a persisted row receives safe defaults.
- `PUT /inventory/policy` is owner/admin only. Body: `negativeStockRule`, `valuationMethod`, `expiryWindowDays`, `countVarianceThresholdBps`, and object `approvalMatrix`.
- Negative stock remains blocked at direct transactional endpoints. With `approval_required`, `POST /inventory/negative-stock-requests` creates a reasoned request and `POST /inventory/negative-stock-requests/{id}/review` performs owner/admin maker-checker review. Approval updates stock and the immutable adjustment ledger in one transaction.
- `weighted_average` values from immutable ledger movement costs. `fifo` values remaining batch layers and their immutable batch movements.

## Supplier governance

- `GET /inventory/supplier-governance?supplierId=` returns effective price lists, reorder terms, computed scorecards, and communication queue entries.
- `POST /inventory/supplier-governance/prices` stores an effective-dated product price. Body: `supplierId`, `inventoryItemId`, `unitCostPaise`, `effectiveFrom`, optional `effectiveTo`.
- Lead time, MOQ, pack size, and safety stock use `POST /inventory/reorder-supplier-terms`.
- Scorecards are computed from real purchase orders and linked GRNs. No score is invented when history is absent.
- `POST /inventory/supplier-governance/communications` queues email or WhatsApp work with an idempotency key. Queue insertion does not claim delivery; a provider worker must move the row to `sent` or `failed`.

## Backbar containers

- `GET /inventory/backbar-containers` returns containers and immutable lifecycle events.
- `POST /inventory/backbar-containers` registers a sealed bottle/package. Body: product, barcode, optional batch, capacity, unit, and idempotency key.
- `POST /inventory/backbar-containers/{id}/open` opens a sealed container. It decrements package stock and writes exactly one immutable stock-ledger consumption movement in the same transaction.
- `POST /inventory/backbar-containers/{id}/consume` decrements remaining container quantity only; package inventory was already posted when opened.
- `POST /inventory/backbar-containers/{id}/overrides` creates a pending correction with a reason.
- `POST /inventory/backbar-overrides/{id}/review` approves or rejects it. Owner/admin review is required and the requester cannot approve their own request.
- Every lifecycle command requires a unique idempotency key. Replays return the previously persisted event where supported and never double-post stock.

## Stock audit and scanner

- `/inventory/stock-audits` owns blind/multi-counter counts, recount, review, approval, immutable adjustment and evidence workflows.
- `/inventory/scanner/events` persists scanner results and idempotency. `/inventory/scanner/replay` replays offline events with replay protection.
- `/inventory/barcode-aliases` owns product, batch, package and location aliases.

## Laundry reporting

- `/inventory/laundry/summary`, `/orders`, order detail, transitions, issues, resolution and barcode scan are live APIs.
- The Laundry page exports the current API-backed register as CSV and provides a print stylesheet. Order detail events are the audit trail; no separate synthetic audit dataset is maintained.

## Reorder forecasts

- `/inventory/reorder-forecasts` persists the model/run version, evidence snapshot, confidence and explainable recommendations.
- `/inventory/reorder-recommendations/{id}/approve` is approval gated and creates a PO draft; it does not send or approve the PO.
- Rust remains owner of authentication, tenant scope and final writes. Forecast/extraction services may assist, but cannot post stock, PO approval or GL entries directly.
## Production operations and verification

- `GET /inventory/operations-health` returns branch-scoped supplier outbox depth, active workers, scheduled retries, terminal failures, latest delivery timestamps, failed-job details, ledger/stock mismatches, and negative-stock count.
- `POST /inventory/supplier-governance/communications/{id}/retry` is inventory-manager gated and resets only a failed job in the same tenant and branch. It does not create a second message.
- Supplier delivery claims use `FOR UPDATE SKIP LOCKED`, bounded attempts, backoff, stale-processing recovery, correlation IDs, and structured success/failure traces. Provider writes never mutate stock or GL.
- `backend-rust/tests/inventory_phase5_postgres.rs` is the executable PostgreSQL integration contract for isolation, idempotency, concurrent claims/stock updates, and money/GST/stock constraints. It requires `DATABASE_URL` and cleans its unique test scope.
- The Inventory Advanced Controls `Operations` tab is API-backed and exposes failed jobs with an explicit retry action. Every retry reloads current server state.