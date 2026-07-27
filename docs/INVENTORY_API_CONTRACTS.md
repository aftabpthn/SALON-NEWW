# Inventory API contracts

All endpoints are served below both `/api/v1` and `/api`. Protected requests require the normal bearer token plus `X-Tenant-Id` and `X-Branch-Id`. Durable records are always tenant and branch scoped. Money uses integer paise; dates use ISO `YYYY-MM-DD`; timestamps use ISO-8601 UTC.

## Inventory policy

- `GET /inventory/policy` returns the effective branch policy. A branch without a persisted row receives safe defaults and null transfer-cost inputs.
- `PUT /inventory/policy` is owner/admin only. Body: `negativeStockRule`, `valuationMethod`, `expiryWindowDays`, `countVarianceThresholdBps`, optional backward-compatible `reorderHistoryDays` (default 60), `reorderCoverageDays` (default 30), and object `approvalMatrix`. Transfer landed-cost configuration is all-or-none: base transport paise, per-km paise, handling per unit paise, delay per unit/day paise, and expected transfer days.
- Negative stock remains blocked at direct transactional endpoints. With `approval_required`, `POST /inventory/negative-stock-requests` creates a reasoned request and `POST /inventory/negative-stock-requests/{id}/review` performs owner/admin maker-checker review. Approval updates stock and the immutable adjustment ledger in one transaction.
- `weighted_average` values from immutable ledger movement costs. `fifo` values remaining batch layers and their immutable batch movements.

## Supplier governance

- `GET /inventory/supplier-governance?supplierId=` returns effective price lists, reorder terms, computed scorecards, communication queue entries, real purchase-return quality evidence, receipt/batch expiry risk, and replacement-supplier comparisons.
- `POST /inventory/supplier-governance/prices` stores an effective-dated product price. Body: `supplierId`, `inventoryItemId`, `unitCostPaise`, `effectiveFrom`, optional `effectiveTo`.
- Lead time, MOQ, pack size, and safety stock use `POST /inventory/reorder-supplier-terms`.
- Scorecards are computed from real purchase orders and linked GRNs. No score is invented when history is absent.
- `POST /inventory/supplier-governance/communications` queues email or WhatsApp work with an idempotency key. Queue insertion does not claim delivery; a provider worker must move the row to `sent` or `failed`.

## Backbar containers

- `GET /inventory/backbar-containers` returns containers and immutable lifecycle events.
- `POST /inventory/backbar-containers` registers a sealed bottle/package. Body: product, barcode, optional batch, capacity, unit, and idempotency key.
- `dualUseStock=true` is enabled only when the same SKU is both sold at retail and used in backbar. Its buckets are retail shelf (unopened stock minus sealed containers), sealed backbar (sealed container count), and open balance (remaining quantity in the active container). Products without this flag keep the existing unified stock behavior.
- For dual-use SKUs, sealed containers reserve unopened units. A database guard rejects registration or any sale, transfer, adjustment, or other deduction that would consume reserved sealed stock.
- `POST /inventory/backbar-containers/{id}/open` opens a sealed container. It decrements package stock and writes exactly one immutable stock-ledger consumption movement in the same transaction.
- A product can have only one `open` container in a branch. Opening another sealed container is rejected until the active container is empty; an approved correction may close or restore the current lifecycle state before a different container is opened.
- `POST /inventory/backbar-containers/{id}/consume` decrements remaining container quantity only; package inventory was already posted when opened.
- `POST /inventory/backbar-containers/{id}/overrides` creates a pending correction with a reason.
- `POST /inventory/backbar-overrides/{id}/review` approves or rejects it. Owner/admin review is required and the requester cannot approve their own request.
- Every lifecycle command requires a unique idempotency key. Replays return the previously persisted event where supported and never double-post stock.
- `GET /inventory/backbar-containers/{id}/label` returns a server-generated SVG QR label for the persisted container barcode. The UI prints it locally; no third-party QR service receives inventory data.

## Purchase bill intelligence

- `/purchase-bill-drafts` keeps the uploaded PDF/image bytes, SHA-256 duplicate guard, extraction evidence, human-reviewed lines, matches, events and final GRN link in PostgreSQL.
- The AI service supports configured local OCR, OpenAI Responses, Anthropic Messages, and optional OpenAI-to-Anthropic fallback. Provider output never posts stock directly.
- Confirmed human item mappings update tenant/branch/supplier-scoped aliases. Later bills consult learned supplier aliases before exact SKU/barcode/name matching; the mapped inventory item remains the source of category truth.

## PO and GRN commercial fields

- Purchase order lines accept `discountBps`; headers accept non-negative `shippingPaise` and `handlingPaise`. Product tax and inventory value use the discounted unit cost, while order totals include both charges.
- GRNs accept `supplierInvoiceDate`, `challanNumber`, `deliveryReference`, the same commercial charges, line discount, `damagedQuantity`, `rejectedQuantity`, and `varianceReason`. The server generates the branch-unique `grrNumber`.
- GRN `quantity` is delivered quantity. Accepted stock is delivered minus damaged and rejected; only accepted quantity updates available stock and PO progress. Damaged units create a durable quarantine row, while rejected units remain outside inventory. Ordered, delivered, accepted, short, excess, damaged, and rejected quantities remain on the immutable receipt line.
- Shipping and handling are allocated across accepted lines in proportion to discounted taxable value using integer-paise largest-remainder allocation. The exact line allocation and landed unit cost are persisted; stock ledger, batches, weighted-average value, and later return valuation use the landed unit cost.

## Product and service 360

- `GET /inventory/{id}/360` returns the current product plus same-SKU all-branch stock/value, active expiry timeline, client retail usage, margin evidence and the latest 200 immutable entity-ledger rows.
- `GET /inventory/service-recipes/{serviceId}/versions` returns persisted recipe versions captured whenever `services.product_consumption_json` changes.
- Manual backbar usage accepts optional `clientId` and `appointmentId`; appointment formula attribution requires its client, booked service and stylist, and is rejected unless the appointment belongs to that client and service in the same tenant/branch.
- `GET /inventory/backbar-usage` accepts optional `clientId` and `appointmentId` filters for formula history. The saved recipe expectation is compared with the stylist's actual mixed quantity; positive variance above the saved `ownerApprovalPercent` remains pending until a different owner or `inventory.approve` user reviews it.
- POS product and service consumption plus product-return restocking use the shared inventory adjustment service. When Service Settings enables `recipeInventory.requireRecipeForService`, checkout/finalization is blocked before stock or accounting writes if a service recipe is missing. Sale deductions and returns remain idempotent and preserve FEFO batch evidence.

## Stock audit and scanner

- `/inventory/stock-audits` owns blind/multi-counter counts, recount, review, approval, immutable adjustment and evidence workflows.
- `/inventory/scanner-events` persists scanner results and idempotency. The GRN drawer reuses its `receive` workflow to resolve product, alias, SKU, and batch barcodes into received quantities.
- `/inventory/barcode-aliases` owns product, batch, package and location aliases.

## Laundry reporting

- `/inventory/laundry/summary`, `/orders`, order detail, transitions, issues, resolution and barcode scan are live APIs.
- The Laundry page exports the current API-backed register as CSV and provides a print stylesheet. Order detail events are the audit trail; no separate synthetic audit dataset is maintained.

## Reorder forecasts

- `/inventory/reorder-forecasts` persists the model/run version, evidence snapshot, confidence and explainable recommendations.
- Forecasts read the persisted branch policy. The default model uses 60 history days and 30 coverage days; both are configurable within validated limits and are recorded in each evidence snapshot and recommendation explanation.
- `/inventory/reorder-recommendations/{id}/approve` is approval gated and creates a PO draft; it does not send or approve the PO.
- Rust remains owner of authentication, tenant scope and final writes. Forecast/extraction services may assist, but cannot post stock, PO approval or GL entries directly.

## Cross-branch controls and GL

- `GET /inventory/command-center` returns the branch-scoped Digital Twin management signals for valuation, stock risk, expiry/dead stock, PO/in-transit flow, 30-day consumption variance, audit/GL mismatches, approvals, supplier risk and real same-SKU cross-branch transfer opportunities. Every signal includes its direct action route.
- Command Center transfer opportunities use real ledger demand, the branch reorder history/coverage policy, approved open-PO quantities, source safety stock, earliest live FEFO batch and effective supplier/recent purchase cost. Transfer landed cost combines source stock value with configured base/distance transport, per-unit handling and expected-delay cost; distance uses persisted branch coordinates. Missing policy or required coordinates returns `cost_review` and requires owner review instead of inventing a zero charge. Each row exposes the component costs, coverage, savings and approval evidence.
- `POST /inventory/transfer-optimizer` accepts the proposed purchase lines (`inventoryItemId`, `quantity`, `unitCostPaise`) and returns only matching safe cross-branch options using the quoted purchase cost. The existing Purchase Order drawer runs this precheck before creation and requires explicit continuation when an option exists; it does not auto-transfer or auto-purchase.
- The same Command Center response includes `recommendations` from the deterministic AI Exception Engine. Active real-data exceptions cover consumption variance, unusual staff/product usage, duplicate or irregular purchase bills, near-expiry batches, supplier delay, negative stock, missing recipes, suspicious adjustments and container lifecycle violations. Every row carries evidence, an explainable reason, confidence basis points, severity, an evidence hash, a direct action route and manual maker-checker status; the engine never mutates inventory by itself.
- `POST /inventory/exception-recommendations/{key}/review` accepts `evidenceHash`, `decision` (`approve` or `reject`) and optional `reviewNote` (required for rejection). Owner/admin or `inventory.approve` permission is required. The active recommendation and evidence hash are revalidated before an immutable decision is stored, so stale evidence cannot be approved.
- `GET /inventory/advanced-controls?allBranches=true` aggregates real cost, reorder, transfer, expiry, dead-stock, approval and audit-lock evidence across accessible branches for authorized roles.
- `GET /inventory/gl-reconciliation?asOf=YYYY-MM-DD&allBranches=true` returns per-branch inventory/GL rows, consolidated totals, branch-tagged exceptions and a merged read-only audit trail.
## Autonomous inventory operations

- `GET/PUT /inventory/autonomous-operations` reads or saves the opt-in branch policy: transfer drafts, PO drafts, monthly budget, optional product-category budgets, expiry rescue window, run interval, escalation interval and minimum confidence. Omitted category budgets preserve the saved policy for older clients. Automation is disabled until an owner/admin saves it as enabled.
- `POST /inventory/autonomous-operations/run` runs the same controlled cycle used by the five-minute scheduler. It generates only API/database-backed actions and reloads the current queue.
- Supplier selection ranks suppliers with real receipt history by delivery timeliness, fill rate, purchase-return rate and supplier-linked expiry risk, then effective item price and lead time. Suppliers without receipt evidence keep a null score instead of a fabricated rating. Reorder quantities continue to use persisted demand, MOQ, pack size, safety stock, open PO and confidence evidence.
- Safe cross-branch stock becomes a transfer draft in the approval queue before any FEFO dispatch. When no safe transfer exists, an eligible reorder can create a PO draft only within the monthly budget, its configured category cap, and spendable cash/bank balance after pending expenses and current PO commitments. Approval submits it into the existing purchase-order maker-checker flow and never sends it to the supplier automatically.
- Near-expiry batches create rescue actions only when the live optimizer finds a safe demand branch. The action shows its destination and quantity; approval revalidates the same batch, expiry, demand, safety and cost before a real FEFO transfer dispatch. Expired or stale batches are rejected instead of moved.
- Scheduled Digital Twin/GL reconciliation records a completed check when matched or a review action when evidence differs. Approval reruns the live reconciliation and completes only after the source exception is resolved; it never auto-posts a balancing adjustment.
- `POST /inventory/autonomous-operations/actions/{id}/review` is owner/admin or `inventory.approve` gated and enforces maker-checker. Rejected actions require a note. Transfer approval reruns the live optimizer and rejects stale drafts when current demand, safety stock, quantity, or cost no longer supports dispatch. Failed transfer/PO executions remain retryable with the same persisted idempotency evidence.
- New actions and overdue approvals create deduplicated in-app notifications. Escalations are checked every five minutes independently of the branch run interval.

## Production operations and verification

- `GET /inventory/operations-health` returns branch-scoped supplier outbox depth, active workers, scheduled retries, terminal failures, latest delivery timestamps, failed-job details, ledger/stock mismatches, and negative-stock count.
- `POST /inventory/supplier-governance/communications/{id}/retry` is inventory-manager gated and resets only a failed job in the same tenant and branch. It does not create a second message.
- Supplier delivery claims use `FOR UPDATE SKIP LOCKED`, bounded attempts, backoff, stale-processing recovery, correlation IDs, and structured success/failure traces. Provider writes never mutate stock or GL.
- `backend-rust/tests/inventory_phase5_postgres.rs` is the executable PostgreSQL integration contract for isolation, idempotency, concurrent claims/stock updates, and money/GST/stock constraints. It requires `DATABASE_URL` and cleans its unique test scope.
- The Inventory Advanced Controls `Operations` tab is API-backed and exposes failed jobs with an explicit retry action. Every retry reloads current server state.
