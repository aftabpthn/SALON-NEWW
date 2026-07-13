# Billing/POS Production Readiness

This checklist is the deployment gate for AuraShine Salon OS billing, POS, GST, payments, refunds, offline sync, terminals, print jobs, and day close.

## Purpose

Set the required controls, checks and run-time gates for a safe billing/POS production launch and operation.

## Action Status

- **done**: Readiness gate command, health endpoint expectations, payment and GST caveats, and standard operating procedures for day-close/refund/backup are defined.
- **in-progress**: Evidence mapping between this readiness checklist and actual implementation checks needs final validation for every live tenant/branch flow (especially cross-tenant audit and rollback traceability).
- **blocker**: Tenant isolation in the doc references `tenant_id`/mixed naming, and needs final audit/standardization with repo convention (`tenantId`/`branchId`) for production confidence.

## Required Environment

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` when Razorpay is enabled.
- WhatsApp provider variables, or keep WhatsApp invoice sending disabled safely.
- Database backup location and restore SOP.
- Printer terminal configuration per branch.

## Deployment Gate

Run:

```bash
node scripts/validate-billing-production.mjs
```

The command must exit `0` before production deployment. Critical missing files or tenant isolation issues fail the gate. Missing live tables are warnings until migrations are applied.

## API Health

`GET /api/billing-health` returns module readiness:

```json
{
  "ok": true,
  "modules": {
    "invoice": "ready",
    "gst": "ready",
    "payments": "ready",
    "refunds": "ready",
    "cashDrawer": "ready",
    "dayClose": "ready",
    "offlineSync": "ready"
  },
  "warnings": []
}
```

## Razorpay SOP

1. Configure payment link credentials.
2. Register webhook URL `/api/payments/razorpay/webhook`.
3. Verify signature checking is active.
4. Confirm duplicate webhook events are ignored.
5. Reconcile settlements daily at 3 AM.

## GST Caveats

- Reports are export-ready only.
- Direct GST portal filing is not implemented.
- E-invoice fields include IRN and QR placeholders for future integration.

## Printer Notes

- Configure one or more `print_devices` per terminal.
- Print failures queue retry jobs and must not block billing.
- Reprints append an `invoice.printed` ledger event.

## Offline POS Limitations

- Offline mode supports invoice drafts and cash payments.
- Razorpay and online payment links are disabled offline.
- Paid invoice conflicts are resolved with server-wins.
- Duplicate offline operation IDs prevent double invoices.

## Day Close SOP

1. Close all cash drawers.
2. Confirm no draft invoice has payments.
3. Generate Z report.
4. Lock business date.
5. Reopen only by admin/owner with a reason.

## Refund SOP

1. Paid invoices are immutable.
2. Use refund, void, or credit note workflows.
3. Store reason, approval, tax reversal, inventory rollback, wallet/loyalty reversal.
4. High-risk refunds require manager approval and audit review.

## Security Checklist

- Every billing table includes `tenant_id`.
- Every query filters by `tenant_id`.
- No invoice deletion after creation.
- Paid invoices are immutable.
- Every financial mutation writes audit and invoice event ledger rows.
- Razorpay webhook is signature verified and idempotent.
- Cross-tenant invoice/payment/refund access returns 403 or 404.
