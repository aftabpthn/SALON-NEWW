# SaaS Subscription and Support

## Scope

AuraShine has two intentionally separate SaaS boundaries:

- `/platform/saas/*` is available only to a platform-tenant super admin. It owns plans, subscriptions, billing runs, usage ingestion, invoice payments and the global support queue.
- `/saas/*` is tenant-scoped. Owners, admins and managers can read their subscription, usage, invoices and tickets, create tickets and add customer-visible replies.

The Angular component under `pages/platform/saas-admin` renders the appropriate controls for the authenticated boundary. Platform data is never selected through tenant-provided headers.

## Data truth

- `saas_plans` and `saas_sla_policies`: pricing, allowances, overage rates and four-severity response/resolution policy.
- `saas_subscriptions`: one current subscription per tenant plus period, trial, cancellation and provider references.
- `saas_usage_events`: append-only idempotent API/message/storage usage. Branch, active-user and appointment usage is calculated from existing source tables.
- `saas_invoices` and `saas_invoice_payments`: idempotent cycle invoices and append-only payments in paise.
- `saas_support_tickets`, `saas_support_messages` and `saas_support_events`: tenant conversation, internal notes, assignment, status and immutable history.
- `saas_support_attachments`, `saas_support_csat` and `saas_support_email_events`: authenticated attachments, post-resolution feedback and idempotent SES ingress.

## Billing and SLA

`POST /platform/saas/invoices/run` is replay-safe per subscription and billing-period start. It applies period-end cancellation, marks overdue invoices and subscriptions, calculates source-backed usage overages, issues the due cycle, then advances the period atomically. Schedule this endpoint from the production job runner with an authenticated platform service identity.

SLA deadlines support elapsed 24×7 time or IST business hours (09:00–18:00, Monday–Saturday). Tenant responses never include internal support notes.

## Advanced support

Support tickets are routed by category into persisted queues. A 60-second worker escalates overdue first-response and resolution SLAs once per level and creates platform notifications. Platform support can assign, reopen, merge or mark duplicates; merged conversations keep their message and attachment history. Resolving a ticket opens tenant-scoped CSAT collection.

Inbound email uses `POST /api/v1/webhooks/support/email`. Configure an SES receipt rule to save raw MIME email to private S3, then invoke a Lambda bridge that parses text and attachments, supplies the trusted tenant/branch mapping, includes SES spam and virus `PASS` verdicts, and signs the exact JSON body with `SUPPORT_EMAIL_WEBHOOK_SECRET` in `x-aurashine-signature`. `Message-ID`, `In-Reply-To`, `References`, SES message ID and event ID provide threading and replay protection. Attachments are allow-listed, capped at 5 MB each and downloaded only through authenticated tenant/platform routes.

## Platform reporting

`GET /platform/saas/reports?days=30` accepts 7–365 days and is platform-only. MRR normalizes annual plan prices to one month and includes active and past-due subscriptions; ARR is MRR × 12. Trial conversion uses trials ending inside the selected period and persisted provider/audit activation evidence. Rolling churn compares cancellations in the period with current contracted subscriptions plus those cancellations. Renewal risk includes past-due, paused, scheduled-cancellation subscriptions and subscriptions near renewal with overdue invoices.

Outstanding invoices use unpaid non-void balances. Usage-overage revenue uses non-void invoice overage amounts issued in the selected period. First-response time, resolution time, SLA breach percentage and assigned-agent performance use the non-merged ticket cohort created in the selected period; CSAT comes from persisted post-resolution ratings.

## Production activation

Manual billing and payment recording require no third-party provider. Razorpay or Stripe auto-charge requires approved credentials, webhook verification and one live settlement/refund UAT before production activation.
