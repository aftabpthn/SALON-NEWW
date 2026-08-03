# AuraShine Payments Live Activation

The payment platform supports Stripe Connect and Adyen through provider-hosted onboarding. AuraShine never accepts raw card numbers or CVC values.

## Configuration

Set these values outside source control:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
ADYEN_API_KEY
ADYEN_HMAC_KEY
ADYEN_MERCHANT_ACCOUNT
ADYEN_LIVE_PREFIX
PAYMENT_RETURN_URL
```

Register these public webhook endpoints with the providers:

```text
POST /webhooks/stripe
POST /webhooks/adyen
```

## Supported Backend Flows

- Stripe Connect Express account onboarding and account refresh
- Adyen legal-entity onboarding and hosted onboarding links
- Stripe PaymentIntent and SetupIntent creation
- Adyen Checkout payment and session creation
- Automatic or manual authorization, followed by MFA-gated capture or void
- Stripe Terminal connection tokens for certified native readers and Tap to Pay clients
- Stripe connected-account payouts with step-up MFA
- Signed webhook ingestion with idempotency, retry visibility, and audit records
- Successful-payment settlement into the existing POS and accounting flow
- Saved payment-instrument references without storing PAN or CVC
- Settlement and dispute records, including 3DS, AVS, CVC, and fraud metadata
- Provider-operation recovery: transport failures remain `unknown` until signed-webhook or provider reconciliation evidence resolves them
- Partial refunds across Razorpay, Stripe, and Adyen, with automatic allocation back to every original tender

## Money lifecycle and recovery

The canonical financial routes are:

```text
POST /api/v1/pos/payment-platform/payments
POST /api/v1/pos/payment-platform/payments/:id/capture
POST /api/v1/pos/payment-platform/payments/:id/void
POST /api/v1/pos/payment-platform/payments/:id/reconcile
POST /api/v1/pos/invoices/:id/refund
```

Every provider request uses a durable idempotency key. A provider timeout is never treated as a decline and never permits a new payment key: the operation remains `unknown`, fulfillment stays blocked, and reconciliation must use the same provider reference or a signed webhook. Refunds remain invoice-owned so provider money movement, credit note, original-tender allocation, inventory reversal, accounting journal, and audit history cannot drift into parallel workflows.

## PCI scope boundary

- AuraShine stores provider customer, payment-method, mandate, terminal, payment, and refund identifiers only; PAN and CVC are forbidden at the API boundary.
- Browser card entry must use Stripe Elements, Adyen Web Components, Razorpay-hosted checkout, or another provider-certified component. Native contactless entry must use the certified provider SDK and platform entitlement.
- Saved-card rows contain masked brand/last-four metadata and provider tokens only. Tokens and provider secrets are never returned to ordinary staff UI.
- Provider secrets live in the deployment secret store. Webhooks require signature verification and event deduplication before financial writes.
- PCI SAQ selection, ASV scans where applicable, terminal estate attestation, and annual provider evidence are deployment/compliance evidence; source code alone cannot certify PCI compliance.

## Branch Provider Controls

Owners, admins, and users with `pos.manage` can disable or re-enable a configured provider for the current branch. Disabling blocks new payment requests but preserves credentials, merchant accounts, settlements, disputes, and audit history; no provider record is deleted.

## Production Gates

Production activation requires provider contracts and approved merchant accounts. Before enabling a provider:

1. Complete provider KYC/KYB and request required countries, currencies, payment methods, and payout capabilities.
2. Configure live secrets in the deployment secret store and register live webhook URLs.
3. Run provider test-mode payment, refund, dispute, recurring-payment, terminal, and payout scenarios.
4. Verify webhook signatures, duplicate delivery handling, settlement totals, accounting entries, and failed-event retries.
5. Complete native SDK certification and Apple/Google entitlements before releasing Tap to Pay.
6. Complete PCI scope review. Keep card entry inside provider-hosted or provider-certified components.

Adyen balance-platform payouts are intentionally not exposed until the live account supplies the required balance-account and transfer-instrument model. Do not replace those identifiers with placeholder data.
