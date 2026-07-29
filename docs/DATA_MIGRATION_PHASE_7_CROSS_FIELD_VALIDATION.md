# Data Migration Phase 7: Cross-Field, Reference and Financial Validation

## Runtime contract

Phase 7 extends the existing deterministic preparation and commit pipeline; it does not create a second import path. Every database lookup includes `tenant_id` and `branch_id`, so a foreign-tenant or foreign-branch record cannot satisfy a reference. Financial failures are row errors and never enter the ready-row payload. Commit-time locks repeat race-sensitive refund, commission and stock checks.

Migration evidence records cross-field rule version `2026-07-phase7-v1`.

## Stable hard-stop codes

| Rule | Code |
| --- | --- |
| Appointment client, staff or service missing | `APPOINTMENT_CLIENT_NOT_FOUND`, `APPOINTMENT_STAFF_NOT_FOUND`, `APPOINTMENT_SERVICE_NOT_FOUND` |
| Appointment start is not before end | `APPOINTMENT_TIME_RANGE_INVALID` |
| Membership client or plan missing | `MEMBERSHIP_CLIENT_NOT_FOUND`, `MEMBERSHIP_PLAN_NOT_FOUND` |
| Membership end precedes start | `MEMBERSHIP_DATE_RANGE_INVALID` |
| Payroll period or net total invalid | `PAYROLL_PERIOD_RANGE_INVALID`, `PAYROLL_TOTAL_MISMATCH` |
| Invoice or sale total invalid | `INVOICE_TOTAL_MISMATCH`, `SALE_TOTAL_MISMATCH` |
| Gift-card balance exceeds initial amount | `GIFT_CARD_BALANCE_EXCEEDS_INITIAL` |
| Refund invoice/payment missing or amount exceeds balance | `REFUND_INVOICE_NOT_FOUND`, `REFUND_PAYMENT_NOT_FOUND`, `REFUND_EXCEEDS_REFUNDABLE_BALANCE` |
| Commission invoice, line or staff missing | `COMMISSION_INVOICE_NOT_FOUND`, `COMMISSION_SALE_LINE_NOT_FOUND`, `COMMISSION_STAFF_NOT_FOUND` |
| Commission rate or cumulative split invalid | `COMMISSION_RATE_OUT_OF_RANGE`, `COMMISSION_SPLIT_EXCEEDS_10000_BPS` |
| Stock product missing, overflow or negative projection | `STOCK_PRODUCT_NOT_FOUND`, `STOCK_QUANTITY_OVERFLOW`, `NEGATIVE_STOCK_NOT_ALLOWED` |
| File owner missing | `FILE_OWNER_NOT_FOUND` |
| Payment invoice missing | `PAYMENT_INVOICE_NOT_FOUND` |
| Source external ID repeated | `DUPLICATE_SOURCE_EXTERNAL_ID` |

## Large-file and concurrency behavior

- External IDs are tracked across all chunks, including rows already blocked for another reason.
- Refundable payment balance, commission split capacity and projected stock carry across chunks.
- Rows removed as duplicates roll back their in-memory projection.
- Refunds can allocate across multiple same-method payments when one payment alone is insufficient.
- Commit-time row locks prevent concurrent refunds, commission splits or stock movements from bypassing the analyzed limits.
