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
- Stripe Terminal connection tokens for certified native readers and Tap to Pay clients
- Stripe connected-account payouts with step-up MFA
- Signed webhook ingestion with idempotency, retry visibility, and audit records
- Successful-payment settlement into the existing POS and accounting flow
- Saved payment-instrument references without storing PAN or CVC
- Settlement and dispute records, including 3DS, AVS, CVC, and fraud metadata

## Production Gates

Production activation requires provider contracts and approved merchant accounts. Before enabling a provider:

1. Complete provider KYC/KYB and request required countries, currencies, payment methods, and payout capabilities.
2. Configure live secrets in the deployment secret store and register live webhook URLs.
3. Run provider test-mode payment, refund, dispute, recurring-payment, terminal, and payout scenarios.
4. Verify webhook signatures, duplicate delivery handling, settlement totals, accounting entries, and failed-event retries.
5. Complete native SDK certification and Apple/Google entitlements before releasing Tap to Pay.
6. Complete PCI scope review. Keep card entry inside provider-hosted or provider-certified components.

Adyen balance-platform payouts are intentionally not exposed until the live account supplies the required balance-account and transfer-instrument model. Do not replace those identifiers with placeholder data.
