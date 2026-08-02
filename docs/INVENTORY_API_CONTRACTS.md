# Inventory API contracts

All endpoints are served below both `/api/v1` and `/api`. Protected requests require the normal bearer token plus `X-Tenant-Id` and `X-Branch-Id`. Durable records are always tenant and branch scoped. Money uses integer paise; dates use ISO `YYYY-MM-DD`; timestamps use ISO-8601 UTC.

## Enterprise migration cutover

- `GET /settings/integrations/migration-cutovers/active` returns the current branch cutover and immutable transition audit.
- `POST /settings/integrations/migration-cutovers` creates or reconfigures a draft cutover; manager-level migration permission is required.
- `POST /settings/integrations/migration-cutovers/{id}/transition` advances exactly one lifecycle state. Inventory freeze and go-live require Owner approval.
- While status is `inventory_frozen`, `snapshot_approved`, `snapshot_applied`, or `reconciled`, database guards reject stock quantity and stock-ledger writes for that tenant/branch. The exact snapshot transaction is the only scoped bypass while `snapshot_approved`.
- One non-live cutover is allowed per tenant/branch. Snapshot apply/reconciliation cannot advance without a completed, error-free `opening_snapshot` import for the same cutover.
- Phase 1 historical evidence uses `GET /settings/integrations/historical-purchase-evidence?cutoverId=...`, `POST /historical-purchase-evidence/group-decisions` and `POST /historical-purchase-evidence/cutover-approval`. Uploads reuse the encrypted import-upload API with `evidenceKind`, `supplierBatch` and `cutoverId`. Cutover approval is Owner-only; grouping mutations require migration-manage permission; reads remain tenant/branch scoped.
- Phase 1 evidence writes only immutable source, evidence-index, grouping-decision, cutover-approval and audit rows. Historical stock, accounting, GST and supplier payable effects are always zero. Physical inventory and supplier outstanding evidence are collected separately for later phases.
- Phase 2 uses `POST /settings/integrations/historical-purchase-pilot` for an Owner-approved 20–50 document sample and `GET /settings/integrations/historical-purchase-pilot?cutoverId=...` for extraction, mapping, reconciliation, correction and accuracy results. Reviews reuse `/purchases/bill-drafts/{id}` plus `/pilot-review`; historical drafts reference encrypted Phase 1 evidence, require correction reasons, and are blocked in both service and database layers from GRN, stock, accounting, GST or payable posting.

## Inventory policy

- `GET /inventory/policy` returns the effective branch policy. A branch without a persisted row receives safe defaults and null transfer-cost inputs.
- `PUT /inventory/policy` is owner/admin only. Body: `negativeStockRule`, `valuationMethod`, `expiryWindowDays`, `countVarianceThresholdBps`, `countValueVarianceThresholdPaise` (default ₹100), optional backward-compatible `reorderHistoryDays` (default 60), `reorderCoverageDays` (default 30), and object `approvalMatrix`. Stock-audit sessions snapshot both quantity and monetary approval thresholds plus item unit cost at cut-off, so later policy/cost changes cannot rewrite approval evidence. Transfer landed-cost configuration is all-or-none: base transport paise, per-km paise, handling per unit paise, delay per unit/day paise, and expected transfer days.
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
- A product can have only one `open` container in a branch. Opening another sealed container records an immutable `premature_open_blocked` alert and is rejected until the active container is empty; an approved maker-checker correction may close or restore the current lifecycle state before a different container is opened.
- `POST /inventory/backbar-containers/{id}/consume` decrements remaining container quantity only; package inventory was already posted when opened.
- `POST /inventory/backbar-containers/{id}/overrides` creates a pending correction with a reason.
- `POST /inventory/backbar-overrides/{id}/review` approves or rejects it. An inventory management role is required and the requester cannot approve their own request.
- Every lifecycle command requires a unique idempotency key. Replays return the previously persisted event where supported and never double-post stock.
- `GET /inventory/backbar-containers/{id}/label` returns a server-generated SVG QR label for the persisted container barcode. The UI prints it locally; no third-party QR service receives inventory data.
- Container registration must match the inventory product's saved stock unit and `unitsPerPackage`; a manually altered capacity or unit is rejected before any reservation is created.

## Salon floor stock and physical closing

- `GET /inventory/floor-control` returns store/unopened, retail-available, consumable-available, sealed-backbar reserve, open-floor, damaged/quarantine, in-transit, unified On-Hand and physical-total balances plus custody, closings and append-only operational movement history. Unified On-Hand is durable stock plus open-container remainder; physical total also includes on-site quarantine while incoming in-transit remains separate.
- `POST /inventory/checkouts` moves stock from store to the compatible retail or consumable floor bucket with active employee, actor, comment and idempotency attribution. `POST /inventory/conversions` is restricted to dual-use products and moves retail to consumable or consumable to retail without changing unified quantity, unit cost or stock value.
- `POST /inventory/operational-movements/{id}/reverse` posts a value-neutral compensating movement for manual checkout/conversion mistakes. Automatic sale, service, transfer and container movements must use their existing return, override or source correction workflow so physical stock is never changed by a bucket-only reversal.
- Negative-stock policy supports `block`, `approval_required` and `allow_with_warning`; warning-mode movements remain visible in history. Retail sale, service consumption and transfer dispatch automatically use compatible checked-out floor stock first and store stock second. Service consumption can FEFO-open the next sealed container when automatic service checkout is enabled.
- `POST /inventory/floor-locations` creates or updates real store, backbar, station or trolley locations. `POST /inventory/backbar-containers/{id}/custody` moves a sealed/open container to an active location and optional active staff custodian with an immutable reasoned event and idempotency key.
- `POST /inventory/floor-closings` records every currently open container exactly once for a business date and shift. Matching counts close immediately as `recorded`; any variance requires a reason and remains `pending_approval` without changing physical balance.
- `POST /inventory/floor-closings/{id}/review` is manager/`inventory.approve` maker-checker. Approval revalidates the expected balance, applies every counted balance atomically and writes immutable `floor_count_adjusted` events; stale counts fail instead of overwriting newer usage. Rejection requires a note and never changes stock.
- Unopened/package physical counts continue through `/inventory/stock-audits`; floor closing owns opened-container weight/count. Together they cover store stock plus live floor stock without counting a jar twice.

## Purchase bill intelligence

- `/purchase-bill-drafts` keeps the uploaded PDF/image bytes, SHA-256 duplicate guard, extraction evidence, human-reviewed lines, matches, events and final GRN link in PostgreSQL.
- `GET /purchases/bill-drafts/{id}/source` streams the tenant/branch-scoped stored PDF or image to authenticated purchase readers with private, no-store caching.
- The AI service supports configured local OCR, OpenAI Responses, Anthropic Messages, and optional OpenAI-to-Anthropic fallback. Provider output never posts stock directly.
- Confirmed human item mappings update tenant/branch/supplier-scoped aliases. Later bills consult learned supplier aliases before exact SKU/barcode/name matching; the mapped inventory item remains the source of category truth.

## PO and GRN commercial fields

- Purchase order lines accept `discountBps`; headers accept non-negative `shippingPaise` and `handlingPaise`. Product tax and inventory value use the discounted unit cost, while order totals include both charges.
- Purchase orders have one supplier and separate `retailQuantity`/`consumableQuantity` on every line. `quantity` is their server-validated sum. CSV import uses `VendorCode,ProductCode,RetailQty,ConsumableQty`, requires one vendor, active product-center/vendor association and effective supplier price, then creates a normal draft PO through the shared service.
- GRNs accept `supplierInvoiceDate`, `challanNumber`, `deliveryReference`, non-negative commercial charges, signed `roundOffPaise`, line discount, `damagedQuantity`, `rejectedQuantity`, and `varianceReason`. The server generates the branch-unique `grrNumber`.
- After a migration cutover is live, an invoice dated on or before the cutover date defaults to the historical archive. Posting it through `POST /purchases/grn` requires `backdatedOperationalApproval=true`, an Owner/superadmin actor, and matched cutover reconciliation; the approval user/time are persisted. A matching historical invoice is returned as a cross-register warning, while the existing unique invoice/idempotency constraints block duplicate live posting. Historical archive rows expose no stock-posting action.
- GRN `quantity` is delivered quantity. Accepted stock is delivered minus damaged and rejected; only accepted quantity updates available stock and PO progress. Damaged units create a durable quarantine row, while rejected units remain outside inventory. Ordered, delivered, accepted, short, excess, damaged, and rejected quantities remain on the immutable receipt line.
- Shipping and handling are allocated across accepted lines in proportion to discounted taxable value using integer-paise largest-remainder allocation. The exact line allocation and landed unit cost are persisted; stock ledger, batches, weighted-average value, and later return valuation use the landed unit cost.
- `partialDeliveryPolicy=block` rejects short delivery before any write. Excess receipt requires `excessReceivingPolicy=permission_required`, explicit `acceptExcess`, and an authorized receiver; the approver is persisted. Multiple accepted GRNs move a PO through raised, partial delivery and fully delivered states.
- When an effective supplier master price differs beyond `priceDifferenceThresholdBps`, the GRN returns a warning. A selected update creates `purchase_price_update_requests`; a different authorized approver accepts or rejects it, and approval effective-dates the old supplier price instead of rewriting receipt history.
- `GET /purchases/grn/{id}/barcode-labels` returns paid and free accepted quantities with product/batch barcodes for receipt label printing. Batch-tracked receipts create expiry layers used by the existing FEFO and FIFO paths.
- Accepted GRN posting is one PostgreSQL transaction for stock, batches, immutable ledger, landed valuation, supplier payable, tax and inventory GL. Posted receipts are immutable; corrections use the purchase-return workflow and compensating ledger/accounting entries.

## Product and service 360

- `GET /inventory/{id}/360` returns the current product plus same-SKU all-branch stock/value, active expiry timeline, client retail usage, margin evidence and the latest 200 immutable entity-ledger rows.
- `GET /inventory/service-recipes/{serviceId}/versions` returns persisted recipe versions captured whenever `services.product_consumption_json` changes.
- Service recipe lines persist `usageProfile` (`root_touch_up`, `full_colour`, or `custom`) with minimum, standard and maximum quantities. Bowl usage snapshots these controls so later recipe edits do not rewrite historical evidence.
- Colour/shade masters reuse inventory packaging: `unit=g`, `packageUnit=tube`, `unitsPerPackage` is tube capacity, and package cost is stored as the derived per-gram `unitCostPaise`.
- `GET/POST /inventory/color-bowls` lists or atomically records an appointment-linked multi-line bowl. Every base, fashion shade, developer or other line validates the appointment client/service/stylist, snapshots cost, applies recipe variance rules and consumes the active open container when one exists.
- `GET /inventory/color-bowls/daily-variance?date=YYYY-MM-DD` returns real expected/actual grams, bowl count and expected/actual/variance cost by product for the IST business date.
- Excess bowl lines require a structured `wasteReason`; `other` also requires written details. Supported reasons are long/thick hair, colour correction, spillage, overmix, client change, tube residue and other.
- `GET /inventory/color-bowls/staff-shift-dashboard?date=YYYY-MM-DD` joins real bowl usage with the saved staff schedule and attendance for the branch, returning staff/shift bowl, client, root/full-colour, variance, waste and pending-approval totals.
- `GET /inventory/color-bowls/formula-recommendation?clientId=...&serviceId=...` returns the latest fully recorded formula for that client and service. It is suggestion-only; applying it in the bowl drawer remains an explicit user action.
- New bowls snapshot the current service price. `GET /inventory/color-bowls/service-margins?date=YYYY-MM-DD` compares that price with expected and actual colour cost; historical rows without a price snapshot return an incomplete margin instead of inventing revenue.
- The existing `GET/POST /inventory/reorder-forecasts` model supplies low-stock forecasting for colour products. Forecast rows remain recommendations and still require the existing approval route before any purchase-order draft is created.
- Colour anomaly suggestions reuse `GET /inventory/command-center` categories for consumption variance, unusual staff/product usage, container violations and missing recipes. The Backbar surface exposes these as read-only suggestions and never executes their recommended action.
- The bowl drawer supports browser-native Bluetooth Weight Scale Service notifications, live target-line grams, tare and a bounded calibration factor. Manual scale entry remains available when the browser or scale does not implement the standard BLE service.
- Colour bowl reads accept `clientId` and `appointmentId` so the saved bowl lines are the client formula history; no separate copied formula table is maintained.
- Manual backbar usage accepts optional `clientId` and `appointmentId`; appointment formula attribution requires its client, booked service and stylist, and is rejected unless the appointment belongs to that client, service, and stylist in the same tenant/branch.
- `GET /inventory/backbar-usage` accepts optional `clientId` and `appointmentId` filters for formula history. The saved recipe expectation is compared with the stylist's actual mixed quantity; positive variance above the saved `ownerApprovalPercent` remains pending until a different owner or `inventory.approve` user reviews it.
- `POST /staff-self/business/product-usage` forces the JWT-linked staff identity and reuses the same backbar transaction, recipe variance, idempotency, approval, FEFO, and immutable stock-ledger rules. Staff Business returns active recipe products with real inventory brand/stock and the latest 50 self-scoped usage records.
- Staff Control Center recommendations combine low-stock evidence, real product/brand sales, configured service-recipe demand, and attributed staff retail conversion. Reorder approval continues through `POST /inventory/reorder-recommendations/{id}/approve`, which creates only a PO draft.
- POS product and service consumption plus product-return restocking use the shared inventory adjustment service. When Service Settings enables `recipeInventory.requireRecipeForService`, checkout/finalization is blocked before stock or accounting writes if a service recipe is missing. Sale deductions and returns remain idempotent and preserve FEFO batch evidence.
- Appointment POS finalization reconciles each recipe product against recorded appointment/Bowl Slip usage. Pending usage blocks checkout; recorded actual usage is linked to the invoice and recipe stock is not deducted again. When no physical usage exists, a container-tracked recipe consumes the active floor container; only non-container recipes fall back to unopened inventory. Invoice consumption therefore reports the actual Bowl Slip/container quantity or the recipe fallback exactly once.
- Appointment creation snapshots every booked service recipe and its version. POS and Bowl Slip validation use that immutable snapshot, so later Service Master edits do not alter an already-booked formula. Each recipe line persists `trackAutomatically` and `allowManualOverride`: manual lines block checkout until actual usage exists; protected automatic lines require owner or `inventory.approve` authorization before actual quantity can replace the fallback.
- Appointment list rows expose `inventoryConsumptionStatus` (`missing_recipe`, `pending_usage`, `pending_approval`, `ready`, `posted`, or `not_required`) and the saved `inventoryRecipeSnapshots`; Appointment Book and the Bowl Slip drawer use those API-backed values.
- `POST /inventory/backbar-usage/:id/reverse` is the manager-only, idempotent pre-invoice correction path. It restores the exact container or stock/batch provenance and posts compensating append-only operational/stock evidence. Appointment cancellation is blocked while recorded or pending usage exists. Financial refunds retain already-consumed service product; invoiced usage is never silently restocked.

## Product kits

- `GET/PUT /inventory/{id}/kit` reads or saves the component BOM. The kit product must be retail or consumable; dual-use kit products, mixed component types, self references, duplicates and nested kits are blocked. A dual-use product may be a component of either compatible kit type.
- A BOM cannot change while finished kit stock exists. `autoUnbundleOnReceive` is saved with the same kit definition and can be enabled only for a valid BOM.
- `POST /inventory/{id}/assemble` atomically deducts every component, adds the finished kit and rolls component cost into the kit weighted-average unit cost. `POST /inventory/{id}/unbundle` atomically performs the reverse and allocates finished-kit value into component weighted-average costs.
- Bundle and unbundle requests require a positive whole quantity and unique idempotency key. Replays return the original persisted result; reuse for a different operation is rejected. Availability is checked under row locks before commit.
- Every operation saves the authenticated actor, optional comments, source receipt where applicable, operation cost and resulting kit stock. Product 360 exposes the latest 100 operations; the stock ledger exposes component-out, kit-in, kit-out and component-in movements.
- Scanner workflow `kit` reuses the existing barcode resolver so the kit drawer can identify a kit or add a compatible component by saved product, batch, package or alias barcode.
- A GRN line for an auto-unbundle kit receives and unbundles inside the same PostgreSQL transaction. Invalid BOM, stock or value rolls back receipt stock, batches, payable, tax and accounting together. The receipt-line operation is idempotent and visible in kit history.
- Batch-tracked components restored by unbundle receive an operation-derived batch layer so FEFO, traceability and valuation remain connected. The finished kit itself cannot be batch tracked.
- POS sale or service consumption deducts the finished kit item exactly once through the existing item-level POS path. Components were already consumed during assembly and are never deducted again when the kit is sold or used.
- Supplier return requires finished kit stock. For an auto-unbundled receipt, the operator must bundle the required components before returning the vendor kit; return never silently consumes unrelated components.

## Stock audit and scanner

- `/inventory/stock-audits` owns blind/multi-counter counts, recount, quantity/value variance review, threshold-based owner approval, immutable adjustment and evidence workflows. Monetary exposure sums absolute line variances so gains cannot hide losses.
- Audit creation locks the active branch inventory snapshot and rejects a ledger/current-stock mismatch before counting starts. Each item freezes its latest source-ledger ID, movement count, opening/carry-forward quantity and signed purchase, return, transfer, sale, consumption, kit and adjustment totals at cut-off. Items without ledger movements remain backward-compatible as an explicit `opening_baseline`; existing unverifiable snapshots are labelled `legacy_snapshot` rather than presented as verified.
- Audit detail responses expose the expected-stock equation only after blind counting is closed. Non-zero variances receive neutral, evidence-aware suggestions such as possible missing inbound, unrecorded consumption, missing sale/checkout, or unaccounted; a human variance reason remains mandatory before submission. Approve and reject actions require `inventory.approve`, while owner/admin approval remains mandatory above the saved quantity or value threshold.
- Phase 9 keeps Auditor, Reconciler and Approver as different authenticated actors. `inventory.manage` can create/count and reconcile but cannot perform both stages on the same session; `inventory.approve` or owner/admin can approve/reject, use an allowed backdate, or select the separately enabled unsafe zero policy.
- Audit creation accepts full/cycle scope, retail/consumable/all scope, business date and one unaudited-product policy: require count, counted only, projected with negative floored to zero, projected preserving negative, or explicit zero. Cycle audits require selected active center products and overlapping open snapshots are rejected.
- `POST /inventory/stock-audits/:id/counts/import` validates the complete CSV count set before an atomic idempotent write. Manual/mobile/barcode counts share the same round register; closing starts a recount when counters differ beyond the configured threshold. Rejected sessions can be resubmitted into a new immutable round by the original auditor.
- `PATCH /inventory/stock-audits/:id/items/:itemId/reconciliation` stores the reconciler's quantity, mandatory variance reason and notes. Submit freezes the current ledger ID and stock quantity for each included item; approval rejects stale snapshots before it calls the same governed adjustment, FEFO, business-date-lock and GL engine as manual adjustments.
- Consumable/all audits with open containers require an approved open-container closing for the audit business date before submission. Unopened snapshot quantities and open-floor closing remain linked through `floorClosingId`; they are not maintained as disconnected colour stock.
- Session events, expected snapshot fields and approved adjustments are append-only. Approved audit sessions cannot be deleted or edited; a later correction is a new governed compensating adjustment.
- `/inventory/scanner-events` persists scanner results and idempotency. The GRN drawer reuses its `receive` workflow to resolve product, alias, SKU, and batch barcodes into received quantities.
- `/inventory/barcode-aliases` owns product, batch, package and location aliases.

## Phase 8 returns, quarantine and adjustments

- POS item refunds require MFA, reason, evidence reference and a complete per-line `restockQuantity + discardQuantity = quantity` split. Only restocked product quantity restores the original FEFO batch, current stock and `retail_available`; its cost reverses COGS into inventory asset. Discard never creates stock.
- Purchase returns require `returnDate`, supplier credit-note number/date, evidence and reason. Inventory financial/edit locks are checked before stock, batches, payable, GST or GL changes; the posted return and lines are append-only.
- Damaged GRN quantity is held in receiving quarantine, outside available stock. `GET /purchases/quarantine` returns its remaining balance; `POST /purchases/quarantine/{id}/dispositions` supports partial `release`, `return` and `discard`. Release alone enters available stock/batches and posts inventory asset/AP. Vendor return requires a credit note. Every disposition is idempotent and immutable.
- `GET/POST /inventory/adjustments` is the governed manual correction register. Reason, evidence, business date and idempotency are mandatory. Value above `countValueVarianceThresholdPaise` remains `pending_approval`; a different owner/admin or `inventory.approve` user must review it through `/inventory/adjustments/{id}/review` before stock, FEFO and variance GL post atomically.
- Stock-audit reconciliation writes the same adjustment register with source `audit_reconciliation`; direct low-value stock updates retain date-lock/evidence/GL enforcement and material changes cannot bypass the approval endpoint.
- Transfer settings include `defaultReturnsWarehouseBranchId`. A normal governed push transfer to that warehouse preserves reservation, approval, FEFO, shipment, receipt, landed cost and mismatch behavior; notes/evidence are mandatory for this destination.
- Damage, expiry, spill, shrinkage, theft, free-sample and customer-return-discard are seeded adjustment reasons. Convert-and-consume uses the existing value-neutral retail-to-consumable conversion, so returned stock is never double-deducted.

## Laundry reporting

- `/inventory/laundry/summary`, `/orders`, order detail, transitions, issues, resolution and barcode scan are live APIs.
- The Laundry page exports the current API-backed register as CSV and provides a print stylesheet. Order detail events are the audit trail; no separate synthetic audit dataset is maintained.

## Reorder forecasts

- `/inventory/reorder-forecasts` persists the model/run version, evidence snapshot, confidence and explainable recommendations.
- Forecasts read the persisted branch policy. The default model uses 60 history days and 30 coverage days; both are configurable within validated limits and are recorded in each evidence snapshot and recommendation explanation.
- `/inventory/reorder-recommendations/{id}/approve` is approval gated and creates a PO draft; it does not send or approve the PO.
- Rust remains owner of authentication, tenant scope and final writes. Forecast/extraction services may assist, but cannot post stock, PO approval or GL entries directly.

### Zenoti parity Phase 12 reorder automation

- `GET /inventory/reorder-suggestions` exposes the saved alert, desired, order and safety-stock levels plus current inventory, undelivered open-PO quantity and undelivered incoming-transfer quantity. Its baseline is exactly `max(desired level - (current inventory + undelivered PO/transfer quantity), 0)`; Order Level is the minimum draft lot when a supplier has not yet been selected.
- Forecast model `seasonal-demand-v4` preserves that baseline in every recommendation explanation, then uses the higher of the saved desired level and the real ledger/service demand target. The enhanced target records consumption velocity, recent-demand seasonality, lead time, configured coverage, fixed/day safety stock, supplier MOQ, pack rounding, supplier price/performance and confidence.
- Open quantities include only raised/current PO or transfer lifecycle states and exclude drafts, cancelled/rejected rows, quantities already received, and terminal damage/expiry/short quantities. This prevents duplicate replenishment while retaining the exact PO/TO evidence split.
- The existing transfer optimizer checks safe cross-branch surplus before purchase. Autonomous purchasing remains bounded by monthly/category budgets and spendable cash/bank balance after pending expenses and current PO commitments.
- Automation creates only persisted review actions and PO/transfer drafts. Human review revalidates live stock, demand, safety and cost; PO supplier submission/final approval and transfer approval remain in the existing maker-checker workflows. Reorder automation never posts stock, COGS, payable, tax or GL entries.

## Zenoti parity Phase 1 master data

- `GET /inventory/master-data` returns branch-scoped category, subcategory, brand, adjustment-reason and stock-action labels plus the active UoM register. `POST /inventory/master-data/values` is inventory-manager gated and creates, edits, activates or deactivates one value; posted ledger text is never rewritten.
- Inventory products persist `productUsage` (`retail`, `consumable`, `dual_use`), category/subcategory/brand, base UoM, purchase pack, base-unit conversion, up to ten branch-unique barcodes, center availability, alert/desired/order/safety levels, batch tracking and active state. Central-product publish carries these fields and non-overridden barcode sets to linked branches.
- Product deactivation or center withdrawal is rejected while the product has an open PO or stock-count session. `masterEditLock` blocks master edits/creation but still permits governed stock counts and adjustments.
- `/inventory/reorder-supplier-terms` owns the active vendor-product-center association, vendor part number, purchase UoM, base-unit conversion, lead time, MOQ, pack multiple and safety days. PO lines, direct supplier GRNs and supplier prices require that active association and an active center-available product.
- Supplier price lists persist center-specific base cost, discount basis points, GST percent and effective dates. PO/GRN quantities continue to convert purchase packs to the product base unit before stock or valuation is posted.
- Inventory policy owns `negativeStockRule`, partial delivery (`allow` or `block`), quantity/value audit thresholds, optional financial lock date, rolling edit-lock days and product-master edit lock. A blocked partial GRN and a locked-date GRN fail before receipt, stock, batch, payable, ledger or GL writes.

## Cross-branch controls and GL

### Zenoti parity Phase 3 transfers

- `GET/PUT /inventory/transfer-settings` owns each center's branch/warehouse/franchise role, default retail and consumable warehouses, auto-checkout flag and transfer-raising restriction.
- `POST /inventory/transfers` creates a `push`, `pull`, `franchise_purchase` or compensating `return` draft. Pull requests use the configured warehouse when none is supplied; franchise purchases use the tenant's central branch policy.
- Transfer lifecycle is `draft -> raised -> approved -> dispatched -> in_transit -> partially_received/received`. Raise reserves source quantity without changing on-hand; a different `inventory.approve` maker-checker is mandatory before dispatch.
- `POST /inventory/transfers/{id}/dispatch` creates one immutable shipment and deducts only that shipment from source on-hand. Any number of shipments can be dispatched against remaining reservations. Batch-tracked stock is allocated by the shared FEFO service.
- `POST /inventory/transfers/{id}/shipments/{shipmentId}/receive` requires exact accounting of dispatched quantity as received retail/consumable, damaged, expired or short. Only accepted quantity enters destination on-hand/batches; mismatches require a reason and appear in `GET /inventory/transfers/mismatches`.
- Transfer price, discount, GST and shipment charges are persisted per shipment line. Receipt posts source/destination interbranch journals and folds allocated landed cost into destination weighted-average inventory value.
- A transfer can be cancelled while unshipped; dispatched stock and FEFO batches are restored with compensating ledger entries. In-transit/received errors use `POST /inventory/transfers/{id}/returns`, preserving the original transaction and parent link.
- The existing Inventory Transfers tab owns settings, lifecycle actions, multi-shipment dispatch/receipt, return quantities and the inter-branch mismatch register. No parallel transfer screen or mock stock state is used.

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

## Phase 10 costing, accounting and locks

- `inventory_policies.valuation_method` selects `weighted_average` or `fifo`. Weighted average remains the perpetual item-master cost; FIFO calculates outbound cost from the locked FEFO batch layers before the immutable movement is inserted.
- GRN shipping and handling are allocated into received stock cost and debit `INVENTORY_ASSET`; recoverable CGST/SGST/IGST remain input-tax debits and the supplier total credits `ACCOUNTS_PAYABLE`.
- Retail sale, recipe fallback, Bowl Slip actual usage, kit assembly, transfer dispatch, governed adjustment and stock-audit posting use the same saved movement cost. POS COGS posts once from the reconciled sale/usage evidence.
- A tube or jar freezes `unit_cost_paise` and `opening_stock_ledger_id` when opened. Batch-tracked containers require a received batch, reduce that exact layer and retain the frozen cost for every later gram/ml usage.
- Valuation and `GET /inventory/gl-reconciliation` include unopened stock plus historical open-container remaining balance. Branch results report `weighted_average`, `fifo` or `mixed` instead of a generic label.
- Customer restock restores original sale cost and batch provenance. Purchase return removes original landed stock value; any non-refundable landed-cost difference posts to stock variance while payable and input tax reverse the supplier credit note.
- Financial lock date, accounting period guard and rolling `editLockDays` are enforced before inventory corrections. POS refunds outside the configured window are blocked and require a new approved correction entry; posted ledger and journal rows are never silently edited.
- Migration `0371_inventory_costing_controls.sql` adds immutable container cost lineage. Focused landed-cost/FIFO tests and `cargo check --bin aura-shine-backend` passed on 01/08/2026; authenticated browser mutation evidence remains a separate UAT gate.

## Phase 11 reports and traceability

- Current stock and on-hand use `GET /inventory`; operational store, retail, sealed backbar and open-floor balances remain in Product 360 and the container-control page. No report maintains a second stock balance.
- `GET /inventory/ledger` is the immutable transaction history for sales, refunds, purchases, purchase returns, transfers/reversals, consumption, adjustments and kit bundle/unbundle movements. Every row carries saved movement cost, source identity, actor/appointment/service/staff/client/container attribution where applicable, batch allocations and snapshot trust status.
- Projected-versus-actual, staff/service/client consumption, Bowl Slip cost, colour variance and service margin use the existing backbar usage, bowl, daily-variance, staff-shift and service-margin APIs.
- COGS is reported from posted stock-ledger cost through Product Sales, Service Trends and Profit Intelligence; inventory valuation remains `GET /inventory/valuation` using the configured weighted-average or FIFO policy.
- The existing Inventory Reports tab derives ageing, near-expiry, batch traceability, latest audit deviation and supplier performance only from API-backed batches, ledger, audit and supplier-governance evidence.
- Purchase orders/GRNs, transfers/mismatches, purchase returns/quarantine dispositions, kit history and governed adjustments remain visible in their existing operational registers and Product 360 rather than a disconnected reporting store.
- Advanced Controls owns negative-stock and dead-stock exceptions; reorder suggestions/forecasts own low-stock alerts; Product 360 owns cross-branch stock/value, batch timeline, client usage, kits and the complete product entity ledger; `/inventory/gl-reconciliation` owns Inventory Asset reconciliation.
- The Reports catalog deep-links every inventory report family into these existing surfaces. Inventory page deep links accept validated `tab` and `report` values and ignore unsupported values.
- CSV and print actions on inventory reports require `reports.export` or the backward-compatible owner/admin role. Viewing remains independently tenant/branch scoped by the existing inventory/report route policy.
- Empty results stay empty, exports are disabled without rows or permission, and report refreshes reload the same real APIs without fabricated records.

## Phase 13 permissions and operational controls

- Authenticated inventory and purchase routes resolve tenant and branch from the signed session, then apply route permissions before the handler. Frontend tenant/branch headers cannot widen the signed scope.
- Read access uses `inventory.read`; stock/master mutations require `inventory.write` or `inventory.manage`; governed reviews require `inventory.approve` or the owner role. Audit submit, reconcile and approve remain separate workflow states, and every review service rejects the requester, counter, submitter or creator as applicable.
- Roles carrying the `inventory.cost` field mask receive cost/purchase-price fields as `null`, cannot export masked inventory data, and cannot set product/supplier/PO/GRN or explicit transfer-cost inputs. The Inventory page hides those actions and inputs instead of rendering masked values as zero.
- Every non-read `/inventory` and `/purchases` request requires an `Idempotency-Key` header (legacy JSON `idempotencyKey` remains accepted). PostgreSQL scopes the reservation by tenant, branch and key, rejects reuse by another actor or for different request bytes, blocks concurrent processing, and replays the persisted status, content type and body after completion.
- The Angular API interceptor supplies a stable device ID, a request ID and one mutation idempotency key. A token-refresh retry reuses the same request context, so an HTTP retry cannot silently create a second stock action.
- Successful inventory/purchase mutations and permission denials append `auth_audit_logs` events with tenant, branch, actor, session, resolved source IP, user agent, device ID, request ID, idempotency key, method, path, status and server timestamp. Existing hash-chain and append-only database triggers prevent update/delete rewriting.
- Financial/edit locks remain inside the transactional inventory services. Stock rows, FEFO layers, movement ledger, COGS and GL either commit together or roll back; correction uses the existing reversal/return/approval commands.
- Angular pages call authenticated APIs only and reload affected API-backed state after successful actions. AI anomaly and autonomous-operation code may persist suggestions or approval drafts only; Rust services remain the sole stock mutation boundary.
- Migrations `0374_inventory_phase13_operational_controls.sql` and `0375_inventory_idempotency_branch_scope.sql` own the cross-route idempotency response register and its branch-wide key uniqueness. `backend-rust/tests/inventory_phase5_postgres.rs` verifies branch isolation, concurrent mutation admission, cross-actor exclusion, exact replay bytes, quantity-to-COGS arithmetic, transaction rollback and the production money/container constraints without inserting fake business records.

The global completion gate is evidence based: source or compile success alone is not `VERIFIED`. The parity register may be promoted only after authenticated allowed/denied role checks, browser reload/persistence, exact before/after stock and value/GL evidence, report/reversal reconciliation and colour/tube regression evidence all pass without a partial or disconnected path.
