# Best Clients

## Purpose

Best Clients screen/report should identify the most valuable and healthiest clients from real CRM data only. It must not use demo rows, hardcoded names, or local-only ranking.

## Source Of Truth

- PostgreSQL remains the source of truth.
- Client ranking should use existing client intelligence and transaction data from the Rust backend.
- Frontend should only render API-backed values and empty states.

## Current Data Signals

- Lifetime value from completed/non-void POS sales.
- Average spend and highest bill from saved invoices.
- Visit count and last visit from appointments.
- RFM score and segment from `client_intelligence_snapshots`.
- Churn risk from persisted intelligence snapshots.
- Favourite services from saved POS service lines.
- Unpaid amount from invoice balance.
- Membership, package, wallet and loyalty context from existing client 360 APIs.

## Ranking Rule

Default ranking:

1. RFM score descending.
2. Lifetime value descending.
3. Recent visit first.
4. Lower unpaid balance first.

This keeps loyal high-value clients at the top without hiding payment risk.

## Recommended Filters

- Branch
- Date range
- Segment
- Minimum lifetime value
- Visit frequency
- Membership status
- Churn risk
- Unpaid balance

## Columns

- Client name
- Phone
- Segment
- RFM score
- Lifetime value
- Average spend
- Total visits
- Last visit
- Favourite service
- Churn risk
- Unpaid amount
- Next best action

## Existing Backend Surface

- Client report types include `rfm`, `lapsed`, `new-returning`, `occasions`, `service-wise`, and `revenue`.
- Client summary already exposes lifetime value, average spend, highest bill, visit metrics, RFM segment, RFM score, churn risk, favourite services, review sentiment, and next best action.
- Best Clients can reuse the existing reports path first; add a dedicated endpoint only if the UI needs pagination, export, or branch-wide sorting beyond current report limits.

## UI Placement

Add it under the existing Clients workspace as a report view, not a new top-level module.

Suggested label: `Best clients`

## Done Condition

- Uses only real API data.
- Supports empty/loading/error states.
- Respects tenant and branch isolation.
- Sorts consistently by the ranking rule.
- Export uses the same backend calculation as the screen.
