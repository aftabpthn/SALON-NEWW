# Zenoti Inventory Parity Register

Baseline date: **01/08/2026**
Official source root: [Zenoti Inventory](https://help.zenoti.com/en/inventory.html)
AuraShine source of truth: Rust/Axum + PostgreSQL contracts in [INVENTORY_API_CONTRACTS.md](./INVENTORY_API_CONTRACTS.md)

## Phase 0 boundary

This is the permanent evidence register for Zenoti inventory parity. Phase 0 records the observable Zenoti workflow and maps it to the current AuraShine API/page. It does not implement missing behavior. A row may be functionally `Complete`, but overall parity must not be declared complete until every in-scope row is `VERIFIED` in its Verification column.

### Status and verification rules

| Field | Rule |
|---|---|
| `Complete` | The observable workflow has an AuraShine equivalent in current source. This is not a verification claim. |
| `Partial` | Some behavior exists, but at least one workflow, report, reversal, permission or evidence layer is incomplete. |
| `Missing` | No current equivalent was found. |
| `VERIFIED` | Official source reviewed; authenticated API and browser workflow passed; PostgreSQL quantity/value effect and tenant/branch isolation checked; permission, report and reversal evidence checked where applicable. |
| `CODE-MAPPED` | Current source/API/page was traced, but the complete verification gate has not run. |
| `PENDING` | Required evidence or implementation is absent. |

`N/A` is not a silent escape hatch. A provider-specific row remains `Missing` until the owner explicitly excludes it from the parity target. AI may suggest; Rust owns stock, PO, approval and accounting writes.

## Evidence legend

- `API`: authenticated endpoint behavior.
- `DB-QTY`: PostgreSQL stock bucket and immutable movement.
- `DB-VAL`: cost, valuation and accounting effect.
- `RBAC`: role, permission and maker-checker behavior.
- `UI`: authenticated browser workflow and automatic reload.
- `RPT`: ledger/report visibility.
- `REV`: cancellation, return, rejection, correction or compensating movement.

## Phase 1 implementation register — master data and configuration

| Capability | AuraShine implementation | Status | Evidence |
|---|---|---|---|
| Retail, consumable, dual-use | `inventory_items.product_usage`; product drawer | Complete | Migration 0357 applied; Rust and TypeScript compile passed. |
| Category, subcategory, brand | `/inventory/master-data`; product drawer master lists | Complete | Branch-scoped master table and upsert rollback test passed. |
| Base UoM | `inventory_uom_master`: g, ml, oz, pcs, bottle, kit | Complete | 11 active base/package UoMs verified in PostgreSQL. |
| Purchase pack and conversion | Product package fields plus supplier `purchaseUnit`/`conversionQuantity` | Complete | Positive conversion and purchase-UoM constraints verified. |
| Multiple barcodes | `inventory_item_barcodes`, Product 360 and central publish | Complete | Two-barcode create/update rollback test passed; branch uniqueness enforced. |
| Product-center availability | `inventory_items.center_available` | Complete | PO/GRN/product selectors enforce active center availability. |
| Vendor-product-center association | `supplier_inventory_terms` active/center flags | Complete | PO, GRN and supplier-price writes require the association. |
| Center price, discount and tax | `supplier_price_lists` cost/discount/GST/effective dates | Complete | Transactional price write returned `250:18`; rolled back cleanly. |
| Alert, desired, order, safety levels | Product master fields and drawer controls | Complete | Non-negative DB constraint and Product 360 display verified. |
| Batch and expiry | Existing batch-tracked GRN/FEFO flow, product toggle | Complete | Batch mode remains GRN-only and expiry is batch persisted. |
| Active/inactive | Product and master-value status controls | Complete | Open PO/audit blocks product deactivation; reactivation is editable. |
| Action labels and adjustment reasons | Master values; ledger label mapping; stocktake reason list | Complete | Defaults seeded; ad-hoc adjustment reason auto-registers transactionally. |
| Negative stock | Existing `negativeStockRule` approval workflow | Complete | Policy remains owner-controlled; stock adjustment uses shared service. |
| Partial delivery | `partialDeliveryPolicy` applied before GRN writes | Complete | `block` rejects any PO receipt with short quantity. |
| Audit thresholds | Quantity BPS and absolute value-paise thresholds | Complete | Existing stock-audit maker-checker policy retained. |
| Financial/edit locks | Financial lock date, rolling edit days, master-edit lock | Complete | Policy constraints and rollback write test passed; GRN/master writes enforce locks. |

Phase 1 has no implementation item pending. Full-register `VERIFIED` still uses the stricter Phase 0 definition: an authenticated browser session must be available for the final UI/RBAC evidence capture.

## Phase 2 implementation register — purchase and receiving lifecycle

| Capability | AuraShine implementation | Status | Evidence |
|---|---|---|---|
| Draft to raised to partial/full delivery | Existing PO maker-checker states plus shared GRN receipt progress | Complete | Rust route/service/repository mapped; migration 0358 adds split progress constraints. |
| One supplier and retail/consumable quantities | PO supplier header; line retail/consumable sum constraints | Complete | API, CSV importer and PostgreSQL use the same split contract. |
| Discounts, taxes and charges | Existing line discount/GST and header shipping/handling | Complete | Landed allocation, payable and GL remain in the transactional GRN path. |
| Partial, multiple, short, excess, damaged and rejected | Existing multiple GRNs/quarantine plus policy and excess acceptance gate | Complete | Short/excess/damage/reject evidence persists on immutable receipt lines. |
| Price warning and master update approval | Threshold warning plus maker-checker price update request | Complete | Requester cannot self-approve; approval effective-dates supplier price history. |
| Invoice, GRR, barcode, batch and expiry | Existing supplier invoice/GRR/batch plus GRN label API and print action | Complete | Paid and free accepted quantities print; FEFO batch layer remains shared. |
| Landed cost and valuation | Existing largest-remainder allocation and weighted-average/FIFO policy | Complete | Stock, batch and return values use persisted landed unit cost. |
| CSV PO import | `POST /purchases/orders/import` | Complete | One-vendor CSV validation creates a normal draft through shared PO logic. |
| Immutability and return correction | No delivered-order edit path; existing purchase-return flow | Complete | Returns post compensating inventory, payable and accounting evidence. |
| Payable, tax and inventory posting | Existing atomic GRN posting | Complete | Stock changes only when the accepted GRN transaction commits. |

Phase 2 has no implementation item pending. Final `VERIFIED` status still requires authenticated API/browser and PostgreSQL mutation evidence in a test tenant; code/compile/schema evidence is recorded separately and must not be presented as live UAT.

## A. Onboard and setup

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-SET-001 | [Set up essential inventory details](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-essential-inventory-details.html) | Configure inventory prerequisites, product use and center-level operating details. | `/inventory`, `/inventory/master-data`, `/inventory/policy`; Inventory and Advanced Controls pages | Complete | Setup only; future transactions use branch stock. | Cost/valuation policy affects later postings. | Owner/admin for policy; inventory manager for operations. | Policy, stock, valuation, ledger. | Edit/reactivate master/policy; never rewrite posted ledger. | CODE+DB VERIFIED; authenticated UI/RBAC evidence unavailable in current signed-out browser. |
| ZI-SET-002 | [Set up MRP label](https://help.zenoti.com/en/inventory.html) | Configure the product price label shown as MRP. | Product sale price and barcode exist; no verified MRP-label setting. | Missing | None. | Future retail display only. | Product manager. | Product master. | Restore previous setting. | PENDING implementation and all evidence. |
| ZI-SET-003 | [Set up stock actions](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-stock-actions.html) | Enable/control actions such as receipt, issue, transfer, adjustment and audit. | Inventory policy, route RBAC, approval matrix. | Partial | Controls which bucket-changing actions are allowed. | Controls valuation/GL-bearing actions. | Owner/admin policy; scoped operators execute. | Operations health, ledger, audit. | Policy edit; posted action needs compensating transaction. | CODE-MAPPED; exact Zenoti action matrix parity pending. |
| ZI-SET-004 | [Set up purchase order](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-purchase-order.html) | Configure PO numbering, approval and ordering behavior. | `/purchases/orders`, approval lifecycle; PO drawer/register. | Partial | No stock until GRN. | Commitment/payable rules; no stock value until receipt. | Purchaser creates; manager/owner approves. | PO register, events, payables. | Reject/cancel/reopen under state rules. | CODE-MAPPED; settings/API/DB/UI evidence pending. |
| ZI-SET-005 | [Set up transfer order](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-transfer-order.html) | Configure inter-center transfer and receipt rules. | `/inventory/transfers`; transfer policy/optimizer. | Partial | Dispatch source out/in-transit; receipt destination in. | Preserves stock value plus configured landed transfer cost. | Inventory manager; approvals per policy. | Transfer register, ledger, command center. | Cancel before receipt; later correction by governed transfer/adjustment. | CODE-MAPPED; full settings and browser evidence pending. |
| ZI-SET-006 | [Set up audits](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-audits.html) | Configure audit/count rules and variance approval. | `/inventory/policy`, `/inventory/stock-audits`; Stock Audit page. | Complete | Approved variance posts an adjustment. | Quantity variance valued at frozen item cost. | Counter; `inventory.approve`; owner above thresholds. | Audit detail, ledger, value variance. | Recount/reject before post; posted error uses compensating adjustment. | CODE-MAPPED; existing focused tests found; authenticated API/DB/UI pending. |
| ZI-SET-007 | [Create stock adjustment reasons](https://help.zenoti.com/en/inventory/onboard-and-set-up/create-stock-adjustment-reasons.html) | Maintain reasons required for manual stock correction. | `/inventory/master-data`; stocktake reason master and automatic registration | Complete | Adjustment changes on-hand. | Valuation/GL variance follows signed movement. | Inventory manager; approval by threshold. | Ledger and audit history. | Opposite signed adjustment with a new reason. | CODE+DB VERIFIED; authenticated browser evidence unavailable. |
| ZI-SET-008 | [Print barcodes](https://help.zenoti.com/en/inventory/onboard-and-set-up/print-barcodes.html) | Generate and print product barcode labels. | `/inventory/barcode-aliases`, Scanner page; container SVG QR label. | Partial | None. | None. | Inventory write/manage. | Scanner event/alias history. | Disable/replace alias or reprint persisted label. | CODE-MAPPED; generic bulk product-label UI pending. |
| ZI-SET-009 | [Set up inventory](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-inventory.html) | Organization/center inventory configuration and operational defaults. | `/inventory/master-data`, `/inventory/policy`, supplier terms, branch-scoped inventory | Complete | Defines future stock behavior. | Defines valuation, price, tax and approval thresholds. | Owner/admin policy; inventory manager master/terms. | Policy, operations health, stock and valuation. | Settings change; no retroactive ledger rewrite. | Phase 1 CODE+DB VERIFIED; authenticated browser evidence unavailable. |
| ZI-SET-010 | [Product kits setup](https://help.zenoti.com/en/inventory/onboard-and-set-up/set-up-inventory/product-kits.html) | Enable/configure products assembled from component products. | `/inventory/:id/kit`, `/inventory/:id/assemble`. | Partial | Assembly deducts components and adds kit. | Component cost rolls into kit movement. | Inventory manager. | Stock ledger and Product 360. | No verified unbundle/reversal workflow. | CODE-MAPPED; unbundle, DB and UI evidence pending. |

## B. Purchase orders and receiving

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-PO-001 | [Purchase orders](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders.html) | End-to-end supplier order lifecycle from draft through receipt. | `/purchases/orders`, `/purchases/grn`; PO/GRN Inventory tabs. | Complete | PO none; accepted GRN increases stock. | GRN posts landed cost, payable and valuation. | Purchaser + maker-checker approver. | PO register/events, GRN, payables, ledger. | Reject/cancel/reopen PO; purchase return after receipt. | CODE-MAPPED; integration test exists; authenticated end-to-end evidence pending. |
| ZI-PO-002 | [Create and raise a purchase order](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/create-and-raise-a-purchase-order.html) | Create lines, raise/submit the PO and send it for approval/order. | `POST /purchases/orders`, `/:id/submit`, `/:id/approve`. | Complete | None until receipt. | Creates commercial commitment; no stock valuation yet. | Purchase write; different authorized approver. | PO register and immutable events. | Reject/cancel or edit while allowed. | CODE-MAPPED; API/DB/RBAC/UI/REV pending. |
| ZI-PO-003 | [Manage purchase orders](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/manage-purchase-orders.html) | View and manage PO statuses and actions. | GET order/detail/events; submit/approve/reject/send/close/cancel/reopen. | Complete | Only GRN affects stock. | Status and received/payable evidence. | Role/state gated. | PO register, events, payables. | State-specific cancel/reopen/reject. | CODE-MAPPED; authenticated browser matrix pending. |
| ZI-PO-004 | [Email raised orders to vendors](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/email-raised-orders-to-vendors.html) | Send an approved/raised PO to the supplier. | `POST /purchases/orders/:id/send`; supplier communication outbox/retry. | Complete | None. | None; delivery evidence only. | Purchase/inventory manager. | PO events, communication queue, operations health. | Failed outbox job retry; no duplicate send row. | CODE-MAPPED; real provider delivery is pending. |
| ZI-PO-005 | [Send purchase orders to Aveda](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/send-raised-purchase-orders-to-aveda.html) | Provider-specific electronic ordering to Aveda. | No Aveda adapter found. | Missing | None until external receipt. | External order commitment. | Authorized purchaser. | Provider/outbox status. | Cancel/retry per provider contract. | PENDING product-scope decision and implementation. |
| ZI-PO-006 | [Restrict partial deliveries](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/restrict-partial-deliveries-of-orders.html) | Organization policy can disallow receiving less than the ordered shipment. | `partialDeliveryPolicy` in `/inventory/policy`; GRN pre-write enforcement | Complete | Blocked short delivery has no stock effect; allowed accepted units increase stock only. | Blocked receipt has no value/GL effect. | Owner configures; receiver follows policy. | GRN and PO receipt progress. | Correct quantities before post; purchase return after post. | CODE+DB VERIFIED; authenticated GRN browser evidence unavailable. |
| ZI-PO-007 | [Receive partial shipments](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/receive-partial-shipments.html) | Receive part of a PO and keep remaining quantity open. | `POST /purchases/grn`; PO received/open quantities. | Complete | Accepted partial quantity increases stock; damaged quarantined; rejected excluded. | Weighted landed cost and payable for accepted receipt. | Purchase receiver; excess also needs explicit permission and acceptance. | GRN, PO progress, batches, ledger, payable. | Purchase return; quarantine disposition workflow remains separately tracked. | CODE+DB VERIFIED; migration checksum, split constraints and compile passed; authenticated API/UI evidence unavailable. |
| ZI-PO-008 | [Receive full delivery](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/receive-full-delivery-from-vendor.html) | Receive all outstanding PO quantities and complete the delivery. | Same GRN path with full quantities; close PO. | Complete | All accepted outstanding stock increases. | Full landed value/payable posts. | Purchase receiver. | GRN, PO, stock ledger, valuation, payables. | Purchase return and governed correction. | CODE-MAPPED; authenticated end-to-end evidence pending. |
| ZI-PO-009 | [Print PO barcode labels](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/print-barcode-labels.html) | Print labels for products received against a PO. | `GET /purchases/grn/:id/barcode-labels`; GRN register Print labels action. | Complete | None. | None. | Purchase read/receiver. | Immutable GRN and batch evidence. | Reprint from the same accepted GRN; return does not rewrite receipt. | CODE-MAPPED; authenticated print/browser evidence pending. |
| ZI-PO-010 | [Raise purchase orders in bulk](https://help.zenoti.com/en/inventory/operational-tasks/purchase-orders/raise-purchase-orders-in-bulk.html) | Create/raise multiple supplier POs in one controlled operation. | No operational bulk-raise endpoint found. | Missing | None until GRN. | Multiple commitments. | Authorized purchaser/approver. | PO batch result and individual events. | Per-PO reject/cancel. | PENDING implementation and all evidence. |

## C. Stock operations

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-OPS-001 | [Transfer orders](https://help.zenoti.com/en/inventory/operational-tasks/transfer-orders.html) | Push, pull/request, warehouse/franchise supply, partial/multiple dispatch and destination receipt. | `/inventory/transfers`; settings, raise/approve, shipment dispatch/ship/receive, returns, mismatches; existing Transfers tab. | Complete | Raise reserves only; dispatch deducts source by FEFO; accepted receipt adds destination; damage/expiry/short stays variance. | Transfer price/discount/GST and allocated shipment landed cost post destination valuation plus interbranch GL. | Inventory manager executes; different `inventory.approve` actor approves; source dispatches and destination receives. | Transfer/shipment/event register, immutable stock ledger and mismatch report. | Unshipped cancel restores stock/batches; in-transit/received correction is a parent-linked return transfer. | CODE+UI MAPPED; focused compile, DB migration and authenticated browser evidence tracked separately. |
| ZI-OPS-002 | [Automatic purchase and transfer orders](https://help.zenoti.com/en/inventory/operational-tasks/automatic-purchase-orders-and-transfer-orders.html) | Reorder rules recommend or generate POs/transfers from stock thresholds. | Reorder forecasts, transfer optimizer, autonomous draft actions with approval. | Complete | Recommendation/draft none; approved execution follows transfer/PO rules. | Budget, supplier price and transfer landed cost checked. | Owner enables; maker-checker approves; AI cannot mutate stock. | Reorder, command center, automation queue/events. | Reject; stale approval fails; failed execution is retryable. | CODE-MAPPED; scheduler, DB and browser evidence pending. |
| ZI-OPS-003 | [Import purchase orders](https://help.zenoti.com/en/inventory/operational-tasks/import-purchase-orders.html) | Import operational PO data in bulk with validation. | `POST /purchases/orders/import`; Orders-tab CSV action; normal draft PO result. | Complete | None until a later accepted GRN. | Draft commitment only. | Purchase write; normal submit/approve maker-checker follows. | Validation result, PO register and events. | Correct/delete source and re-import; draft follows normal reject/cancel lifecycle. | CODE-MAPPED; focused parser/contract checks added; authenticated import evidence pending. |
| ZI-OPS-004 | [Current stock](https://help.zenoti.com/en/inventory/operational-tasks/current-stock.html) | Show current quantities by product and center. | `GET /inventory`, Floor Control, Inventory page. | Complete | Read-only view of unopened, open-floor, retail and physical buckets. | Current unit cost and stock value. | Inventory read; branch/tenant scoped. | Current stock, valuation, Product 360. | Not applicable; corrections use audit/adjustment. | CODE-MAPPED; authenticated API/DB/UI evidence pending. |
| ZI-OPS-005 | [Inventory adjustments](https://help.zenoti.com/en/inventory/operational-tasks/adjust-stocks-using-inventory-adjustments.html) | Post reasoned positive/negative corrections. | `PATCH /inventory/:id`/shared adjustment service; negative-stock approval. | Complete | Signed on-hand change with immutable ledger row. | Signed valuation/GL effect at governed unit cost. | Inventory write; owner/approver above rule. | Ledger, GL reconciliation, audit trail. | Equal opposite adjustment; never edit/delete ledger. | CODE-MAPPED; exact API/DB/RBAC/UI/REV evidence pending. |
| ZI-OPS-006 | [Audit and reconciliation](https://help.zenoti.com/en/inventory/operational-tasks/audit-and-reconciliation.html) | Blind/physical count, deviation review and reconciliation. | `/inventory/stock-audits`; Stock Audit page. | Complete | Approved count variance adjusts stock. | Absolute exposure and signed value variance are retained. | Counter; approver; owner above thresholds; maker-checker. | Audit register/detail, ledger, valuation. | Recount/reject before posting; compensating adjustment after posting. | CODE-MAPPED; focused UI tests found; API/DB/browser evidence pending. |
| ZI-OPS-007 | [Product kits](https://help.zenoti.com/en/inventory/operational-tasks/product-kits.html) | Define kit components, assemble and manage kit stock. | Kit definition and assemble endpoints. | Partial | Components decrease; assembled kit increases. | Component costs roll into kit. | Inventory manager. | Ledger/Product 360. | Unbundle/assembly reversal not found. | CODE-MAPPED; unbundle and complete UI evidence pending. |

### Phase 3 transfer closure matrix

| Requirement | AuraShine implementation | Quantity/value control | Reversal/report evidence | Status |
|---|---|---|---|---|
| Push transfer | `mode=push`; current center is source. | Raise reserves; shipment dispatch deducts. | Events, shipment and ledger. | Complete |
| Pull/request transfer | `mode=pull`; current center requests from explicit/default warehouse. | Same reservation and dispatch engine. | Transfer register and event history. | Complete |
| Default warehouse | Center settings hold separate retail/consumable defaults and validate warehouse role. | Configuration only. | Settings API and Transfers tab. | Complete |
| Franchise purchase | `mode=franchise_purchase`; central branch policy supplies default source. | Transfer price, discount and GST apply. | Parent transaction, journals and register. | Complete |
| Retail/consumable quantities | Ordered, reserved, dispatched and received splits persist per line. | DB sums/limits prevent bucket drift. | Detail API and shipment receipt. | Complete |
| Full lifecycle | Draft, raised, approved, dispatched, in-transit, partial, received, rejected and cancelled. | State-gated writes. | Immutable event rows. | Complete |
| Multiple shipments | Separate shipment/header and shipment-line tables. | Each shipment uses only remaining reservation. | Shipment list/status. | Complete |
| Source reservation | Raise locks item and considers other live reservations. | No on-hand/value change until dispatch. | Reserved columns and lifecycle event. | Complete |
| Destination receipt | Exact received/damaged/expired/short accounting is mandatory. | Accepted units only enter stock/value. | Receipt line and mismatch register. | Complete |
| FEFO selection | Shared `allocate_fefo_quantity` at shipment dispatch. | Exact source batch layers leave stock. | Batch movements linked to shipment ledger. | Complete |
| Landed cost/tax | Line transfer price/discount/GST plus allocated shipment charges. | Destination weighted cost and interbranch GL. | Shipment financial fields and journals. | Complete |
| Damaged/expired return | Parent-linked `mode=return` with governed new lifecycle. | No historical rewrite; normal reverse-direction posting. | Parent ID, reason and events. | Complete |
| Cancellation/reversal | Draft/raised/approved release reservation; unshipped dispatch restores stock/batches. | Compensating ledger, no silent edit. | Cancelled shipment/transfer events. | Complete |
| Auto checkout | Destination setting creates sealed Backbar containers for received consumables. | Container opening later consumes unopened stock once. | Container QR/event links shipment line. | Complete |
| Maker-checker | Creator/raiser cannot approve; route and middleware require `inventory.approve`. | No stock write before approval. | Actor IDs and timestamps. | Complete |
| Inter-branch mismatch | `/inventory/transfers/mismatches` plus Transfers-tab register. | Read-only variance; no balancing write. | Shipment/product dispatched vs received evidence. | Complete |

## D. Product master lifecycle

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-PROD-001 | [Manage products](https://help.zenoti.com/en/inventory.html) | Central list and lifecycle actions for products. | `/inventory`; Inventory page CRUD and Product 360. | Partial | Create none; updates affect future transactions; delete is expected to deactivate. | Cost edits affect future valuation only. | Inventory manage. | Stock, valuation, ledger, Product 360. | Edit/reactivate; posted movements remain immutable. | CODE-MAPPED; lifecycle and browser evidence pending. |
| ZI-PROD-002 | [Create a product](https://help.zenoti.com/en/inventory/operational-tasks/manage-products/create-a-product.html) | Create product identifiers, classification, UOM, price, stock and tracking settings. | `POST /inventory`; Inventory create drawer. | Complete | Opening quantity establishes current stock/baseline. | Unit cost establishes opening value. | Inventory write/manage. | Inventory, valuation, Product 360. | Correct by edit/adjustment; deactivate if unused. | CODE-MAPPED; API/DB/UI validation pending. |
| ZI-PROD-003 | [Add a barcode to a product](https://help.zenoti.com/en/inventory.html) | Assign scannable product barcode(s). | Product `barcode`; `/inventory/barcode-aliases`; Scanner page. | Complete | None. | None. | Inventory write. | Alias/scanner events and Product 360. | Disable/replace alias with history preserved. | CODE-MAPPED; scanner-focused test exists; device/browser evidence pending. |
| ZI-PROD-004 | [Update products in bulk](https://help.zenoti.com/en/inventory.html) | Validate and update multiple product masters in one operation. | No product bulk-update endpoint/UI found. | Missing | Depends on fields; direct stock overwrite must be prohibited. | Future costs/prices only unless explicit governed adjustment. | Inventory manager. | Batch result/error report. | Batch rollback or per-row correction. | PENDING implementation and all evidence. |
| ZI-PROD-005 | [Edit a product](https://help.zenoti.com/en/inventory/operational-tasks/manage-products/edit-a-product.html) | Edit allowed product master fields. | `PATCH /inventory/:id`; edit drawer. | Complete | Master edits must not silently rewrite posted stock. | Future cost/price behavior; historical ledger unchanged. | Inventory write/manage. | Product 360 and audit trail. | Edit back; stock uses adjustment. | CODE-MAPPED; field/API/DB/UI matrix pending. |
| ZI-PROD-006 | [Search for a product](https://help.zenoti.com/en/inventory.html) | Find products using identifying fields. | Inventory list/search; scanner product/SKU/barcode resolution. | Complete | None. | None. | Inventory read. | Not a movement. | Clear filters. | CODE-MAPPED; browser search evidence pending. |
| ZI-PROD-007 | [Clone a product](https://help.zenoti.com/en/inventory.html) | Copy a product as a new master and edit its identifiers. | No clone endpoint/UI found. | Missing | New clone should start without copied live stock. | New cost/price only; no copied ledger. | Inventory manage. | Product audit. | Deactivate clone. | PENDING implementation and all evidence. |
| ZI-PROD-008 | [Delete a product](https://help.zenoti.com/en/inventory/operational-tasks/manage-products/delete-a-product.html) | Delete/deactivate an eligible product under usage constraints. | `DELETE /inventory/:id`. | Partial | Must not erase stock/ledger; exact active-use guards need verification. | Historical valuation/COGS must remain. | Inventory manage. | Product 360/ledger history. | Reactivation/restore behavior not verified. | CODE-MAPPED; hard-delete safety and reversal evidence pending. |

## E. Floor, returns, batches and automation

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-FLOW-001 | [Check out products](https://help.zenoti.com/en/inventory/operational-tasks/check-out-products.html) | Issue consumables from store to floor/employee and record the issue. | Floor locations, container open/custody, backbar consumption. | Partial | Sealed open posts package consumption; open balance is then consumed separately. | Package cost posts once at open; usage cost remains attributable. | Inventory manager issues; staff consumes; overrides approved. | Floor Control, backbar events, staff usage, ledger. | Custody transfer; manager-approved correction. | CODE-MAPPED; generic non-container checkout parity pending. |
| ZI-FLOW-002 | [Convert products](https://help.zenoti.com/en/inventory/operational-tasks/convert-products.html) | Convert retail inventory to consumable or consumable to retail without losing value. | `dual_use_stock` exists, but no governed conversion transaction found. | Missing | Would move between retail/consumable buckets, net physical unchanged. | Total value unchanged. | Inventory manager. | Conversion register and ledger. | Reverse conversion subject to available stock. | PENDING implementation and all evidence. |
| ZI-FLOW-003 | [Product returns from guests](https://help.zenoti.com/en/inventory/operational-tasks/product-returns-from-guests.html) | Refund/return sold products and decide stock effect. | POS refund/credit-note with shared return restocking and FEFO provenance. | Complete | Eligible returned quantity restores the sold batch/stock. | Reverses COGS and sale/accounting as applicable. | POS refund permission; manager rules. | Invoice, credit note, stock ledger, batch trace. | Original return can only be corrected through a new governed transaction. | CODE-MAPPED; authenticated POS/DB/RBAC evidence pending. |
| ZI-FLOW-004 | [Track damaged and expired products](https://help.zenoti.com/en/inventory/operational-tasks/track-damaged-and-expired-products.html) | Record damaged/expired inventory and remove or quarantine it with reason. | GRN quarantine, batch expiry, near-expiry signals; disposition API not fully verified. | Partial | Damaged accepted units quarantine; rejected excluded; write-off path incomplete. | Quarantine retains evidence; disposal loss/GL needs verified posting. | Receiver; manager approves disposition. | GRN, batches, command center, ledger. | Release/return/discard with audit; complete workflow pending. | CODE-MAPPED; disposition and GL/browser evidence pending. |
| ZI-FLOW-005 | [Customize inventory labels](https://help.zenoti.com/en/inventory/operational-tasks/customize-inventory-labels-across-zenoti.html) | Configure inventory terminology/labels across the application. | No inventory-specific label customization found. | Missing | None. | None. | Owner/admin settings. | None. | Restore previous labels. | PENDING implementation and all evidence. |
| ZI-FLOW-006 | [On-hand quantity model](https://help.zenoti.com/en/inventory/operational-tasks/on-hand-quantity-model.html) | Use a consolidated on-hand quantity across store/floor behavior. | AuraShine deliberately exposes unopened, sealed reserve, open-floor, retail-available and physical total. | Partial | Physical total reconciles buckets; usage affects the correct bucket once. | Value follows immutable movement, not UI bucket duplication. | Inventory read/manage. | Floor Control, stock, ledger, valuation. | Count correction/adjustment. | CODE-MAPPED; exact cross-report reconciliation evidence pending. |
| ZI-FLOW-007 | [Product and order returns](https://help.zenoti.com/en/inventory/operational-tasks/product-returns-and-order-returns.html) | Handle product sale returns and supplier purchase returns. | POS refund/return; `GET/POST /purchases/returns`. | Complete | Guest return restores eligible stock; supplier return decreases stock. | Reverses COGS or purchase value/payable as applicable. | POS/purchase permissions; approval rules. | Credit note, purchase return, ledger, payable. | Correct through new return/cancel transaction under state rules. | CODE-MAPPED; end-to-end API/DB/UI/GL evidence pending. |
| ZI-FLOW-008 | [Batch and expiry management](https://help.zenoti.com/en/inventory/operational-tasks/batch-and-expiry-management-in-inventory.html) | Capture batch/expiry on receipt and trace issue/return by batch. | `/inventory/batches`, GRN batch fields, FEFO movements, barcode aliases, Product 360. | Complete | Receipt adds batch; FEFO use deducts; eligible return restores provenance batch. | Batch landed unit cost drives valuation/COGS. | Inventory/purchase roles. | Batch list, ledger, Product 360, expiry signals. | Purchase return, sale return, governed adjustment. | CODE-MAPPED; PostgreSQL integration and browser evidence pending. |
| ZI-FLOW-009 | [AI Inventory reorder planning](https://help.zenoti.com/en/inventory/operational-tasks/use-ai-inventory-to-plan-reorders.html) | Forecast demand and recommend reorder quantities for review. | `/inventory/reorder-forecasts`, recommendation approval, command center. | Complete | Suggestion none; approval creates PO draft only. | Uses cost, supplier terms and budget; no direct GL write. | Inventory read; authorized maker-checker approval. | Forecast evidence, recommendation explanation, PO draft. | Reject recommendation; stale/failed approvals do not mutate stock. | CODE-MAPPED; model/run API/DB/UI evidence pending. |

## F. Inventory reports

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-RPT-001 | [Current Stock report v2](https://help.zenoti.com/en/inventory/reports/current-stock-report--v2-.html) | Report current stock by product/center with filters and exportable values. | Inventory page/report model; `/inventory`, Floor Control, valuation. | Partial | Read-only. | Current stock value. | Inventory/report read; branch scope. | Current stock surface. | Rerun after governed correction. | CODE-MAPPED; exact columns/filter/export parity pending. |
| ZI-RPT-002 | [Inventory Aging report](https://help.zenoti.com/en/inventory/reports/inventory-aging-report.html) | Age stock to identify slow/dead inventory. | Command Center dead-stock/expiry risks and Advanced Controls. | Partial | Read-only. | Capital tied up by age/risk. | Inventory/report read. | Command Center/Advanced Controls. | Rerun after movement. | CODE-MAPPED; dedicated aging buckets/export pending. |
| ZI-RPT-003 | [Stock Ledger report v2](https://help.zenoti.com/en/inventory/reports/stock-ledger-report--v2-.html) | Transaction ledger with opening, movement and closing evidence. | `GET /inventory/ledger`; Inventory ledger/Product 360. | Complete | Read-only representation of immutable signed movements. | Unit cost and movement value retained. | Inventory/report read. | Ledger and entity ledger. | No row edit; correction is a new movement. | CODE-MAPPED; API/DB/UI/export evidence pending. |
| ZI-RPT-004 | [Cost of Goods report v2](https://help.zenoti.com/en/inventory/reports/cost-of-goods-report--v2-.html) | Report consumption/sale COGS for the period. | Valuation, POS margin/COGS evidence, reports and GL reconciliation. | Partial | Read-only. | COGS from immutable sale/consumption movements. | Finance/report read. | Reports, valuation, GL reconciliation. | Rerun after credit note/return/correction. | CODE-MAPPED; dedicated report/filter/export parity pending. |
| ZI-RPT-005 | [Batch traceability report](https://help.zenoti.com/en/inventory/reports/inventory-traceability-report-for-batch-tracked-products.html) | Trace a batch from receipt through movements and returns. | Batch list, stock ledger batch allocations, Product 360 entity ledger. | Partial | Read-only. | Batch landed cost lineage. | Inventory/report read. | Product 360/ledger. | Corrections stay as new traceable movements. | CODE-MAPPED; dedicated trace report/export pending. |
| ZI-RPT-006 | [Near Expiry report](https://help.zenoti.com/en/inventory/reports/near-expiry-report-for-batch-tracked-inventory.html) | List batch stock nearing expiry using configured window. | Inventory policy expiry window, Command Center/Advanced Controls expiry signals. | Partial | Read-only; disposal/transfer is separate action. | At-risk stock value. | Inventory/report read. | Command Center/Advanced Controls. | Rerun after transfer/return/disposition. | CODE-MAPPED; dedicated report/filter/export pending. |
| ZI-RPT-007 | [Inventory reports catalog](https://help.zenoti.com/en/inventory/reports/inventory-reports.html) | Central catalog of operational, valuation, consumption, audit and expiry reports. | Inventory/report pages, command center, valuation, GL, audits, backbar dashboards. | Partial | Read-only. | Mixed valuation/COGS/variance outputs. | Report roles and branch scope. | Multiple existing surfaces; no verified single parity catalog. | Source transactions are reversed, reports are regenerated. | CODE-MAPPED; page-by-page report catalog parity pending. |
| ZI-RPT-008 | [Inventory FAQ and troubleshooting](https://help.zenoti.com/en/inventory/reports/faq-and-troubleshooting.html) | Explain report behavior, common deviations and troubleshooting. | API contracts and operations-health diagnostics; no operator-facing equivalent guide found. | Partial | None. | None. | Documentation/operations access. | Operations health. | Follow governed corrective workflow. | PENDING operator guide and browser-linked diagnostics evidence. |

## G. Duplicate official master-data navigation pages

Zenoti publishes the following product pages again under Inventory > Master data. They remain separate source rows so the official inventory index has no unmapped page. Their AuraShine workflow and evidence requirement are inherited from the canonical product row shown.

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-MD-001 | [Manage products](https://help.zenoti.com/en/inventory.html) | Duplicate navigation entry for product lifecycle. | ZI-PROD-001. | Partial | See ZI-PROD-001. | See ZI-PROD-001. | Inventory manage. | See ZI-PROD-001. | See ZI-PROD-001. | Inherits ZI-PROD-001; PENDING. |
| ZI-MD-002 | [Create a product](https://help.zenoti.com/en/inventory/operational-tasks/manage-products/create-a-product.html) | Duplicate navigation entry for product creation. | ZI-PROD-002. | Complete | See ZI-PROD-002. | See ZI-PROD-002. | Inventory write. | See ZI-PROD-002. | See ZI-PROD-002. | Inherits ZI-PROD-002; PENDING. |
| ZI-MD-003 | [Add a barcode](https://help.zenoti.com/en/inventory.html) | Duplicate navigation entry for product barcode. | ZI-PROD-003. | Complete | None. | None. | Inventory write. | See ZI-PROD-003. | See ZI-PROD-003. | Inherits ZI-PROD-003; PENDING. |
| ZI-MD-004 | [Update products in bulk](https://help.zenoti.com/en/inventory.html) | Duplicate navigation entry for bulk product updates. | ZI-PROD-004. | Missing | See ZI-PROD-004. | See ZI-PROD-004. | Inventory manager. | See ZI-PROD-004. | See ZI-PROD-004. | Inherits ZI-PROD-004; PENDING. |
| ZI-MD-005 | [Edit a product](https://help.zenoti.com/en/inventory/operational-tasks/manage-products/edit-a-product.html) | Duplicate navigation entry for product edits. | ZI-PROD-005. | Complete | See ZI-PROD-005. | See ZI-PROD-005. | Inventory write. | See ZI-PROD-005. | See ZI-PROD-005. | Inherits ZI-PROD-005; PENDING. |
| ZI-MD-006 | [Search for a product](https://help.zenoti.com/en/inventory.html) | Duplicate navigation entry for product search. | ZI-PROD-006. | Complete | None. | None. | Inventory read. | None. | Clear filters. | Inherits ZI-PROD-006; PENDING. |
| ZI-MD-007 | [Clone a product](https://help.zenoti.com/en/inventory.html) | Duplicate navigation entry for product cloning. | ZI-PROD-007. | Missing | See ZI-PROD-007. | See ZI-PROD-007. | Inventory manage. | See ZI-PROD-007. | See ZI-PROD-007. | Inherits ZI-PROD-007; PENDING. |
| ZI-MD-008 | [Delete a product](https://help.zenoti.com/en/inventory/operational-tasks/manage-products/delete-a-product.html) | Duplicate navigation entry for deletion/deactivation. | ZI-PROD-008. | Partial | See ZI-PROD-008. | See ZI-PROD-008. | Inventory manage. | See ZI-PROD-008. | See ZI-PROD-008. | Inherits ZI-PROD-008; PENDING. |

## H. Connected Zenoti workflows that post or control inventory

These official pages are outside the Inventory navigation tree but are required because they change or govern inventory.

| ID | Zenoti workflow | Official observable behaviour | AuraShine equivalent | Status | Quantity effect | Value effect | Permission | Reports | Reversal | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| ZI-X-001 | [Service product consumption setup](https://help.zenoti.com/en/master-data/services/edit-services.html) | Associate standard consumable quantities with a service; consume automatically or enter actual usage. | Service recipe versions; Bowl Slip/backbar usage; POS finalization fallback. | Complete | Actual usage consumes container once; recipe fallback consumes unopened stock once. | Snapshot unit cost posts consumption/COGS evidence. | Service manager configures; staff records; approver reviews excess. | Usage, variance, staff shift, ledger, margins. | Manager-approved override/compensating usage adjustment. | CODE-MAPPED; formula wiring test exists; authenticated API/DB/UI pending. |
| ZI-X-002 | [Appointment consumption checks](https://help.zenoti.com/en/appointments/daily-tasks/faq-and-troubleshooting.html) | Flag missing mandatory consumption and allow authorized actual-quantity entry/override. | Pending Bowl Slip/usage blocks POS checkout; usage review workflow. | Partial | No stock posting until usage is valid; finalized usage posts once. | Actual or recipe cost posts once. | Staff records; manager approves override. | Appointment/POS consumption, variance, ledger. | Correct pending usage before finalize; governed override later. | CODE-MAPPED; exact Appointment Book indicator parity pending. |
| ZI-X-003 | [Inventory security permissions](https://help.zenoti.com/en/configuration/security-configurations/understand-security-permissions.html) | Role permissions control view, manage, approve and sensitive stock actions. | Central claims plus `inventory.read/write/manage/approve`; tenant/branch scope. | Complete | Permission itself has no quantity effect. | Prevents unauthorized value/GL actions. | Owner/admin assigns; maker cannot self-approve governed requests. | Security/audit and domain events. | Permission change; posted transactions remain immutable. | CODE-MAPPED; complete role/API/browser denial matrix pending. |

## AuraShine salon-control superset (not Zenoti parity debt)

These controls are retained even when the Zenoti row is satisfied:

| AuraShine control | Current contract |
|---|---|
| Individual tube/jar QR lifecycle | Sealed container registration, server SVG label, open/consume/custody events. |
| Sealed/open/floor balances | Unopened, sealed reserve, retail available, open-floor and physical total are explicit. |
| One-time stock deduction | Package stock posts when opened; open-container usage does not deduct package inventory again. |
| Appointment-linked colour use | Multi-line Bowl Slip with base, fashion shade, developer, client/service/stylist and cost snapshots. |
| Leakage control | Recipe variance, excess approval, container violation signals, physical closing and immutable corrections. |
| AI boundary | Forecast/anomaly output is suggestion-only; Rust approval executes any real PO/transfer/stock action. |

## Phase 0 exit record

- Official Inventory navigation pages registered: **60**.
- Connected inventory-posting/security pages registered: **3**.
- `VERIFIED` rows at Phase 0 creation: **0 of 63**.
- Parity declaration: **NOT COMPLETE**.
- Next allowed phase: verify/fix the register group selected by the owner; update evidence in this file row by row. Do not skip directly to a global completion claim.

## Evidence update protocol

For each row promoted to `VERIFIED`, append the dated evidence directly in its Verification cell or a linked evidence note containing:

1. Official Zenoti page and observation date.
2. AuraShine route, frontend route/page, handler/service/repository and PostgreSQL tables.
3. Authenticated API request/response and tenant/branch isolation result.
4. Exact before/after quantity and value/GL query.
5. Allowed and denied role checks, including maker-checker where applicable.
6. Browser workflow, reload result, report visibility and reversal result.

Do not silently replace the baseline when Zenoti documentation changes. Add a dated change note, reassess the affected rows, and demote `VERIFIED` until the new behavior is checked.

## Change log

| Date | Change | Result |
|---|---|---|
| 01/08/2026 | Phase 0 register created from the official Zenoti Inventory navigation and connected consumption/security pages. | 63 rows registered; 0 VERIFIED; parity not complete. |
| 01/08/2026 | Phase 1 master data/configuration implemented in existing product, supplier, PO/GRN and Advanced Controls flows. | 16/16 Phase 1 capabilities complete; migration 0357, DB rollback contracts, Rust compile, TypeScript compile and focused test passed. Authenticated browser evidence remains outside `VERIFIED` because the available browser was signed out. |
