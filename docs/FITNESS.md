# Fitness & Studio

The gym and studio vertical: walk-in queue, class scheduling and registration, amenities and lockers, member challenges, kiosk check-in, and utilization reporting.

## Status

Backend shipped in `queue_waitlist_classes_fitness` (migration 0396) — `fitness_service.rs` (1,001 lines) and `routes/fitness.rs` (315 lines), with lifecycle guards and tests. It had **no user interface at all** until `/fitness` was added; every endpoint was reachable only by hand-written HTTP.

## Reading the workspace

`GET /fitness/summary` returns the entire workspace in one read — queue, class templates, upcoming sessions, amenities and challenges. The page loads once and refreshes the whole summary after each change, rather than issuing a request per panel.

Sessions are returned from one day in the past onward, so a class that has just finished is still visible to mark attendance against.

## Lifecycle rules

Two transition tables in `fitness_service.rs` decide what may happen next, and the UI offers only the moves they accept. Presenting a button that the server will refuse teaches people to distrust every button.

**Walk-in queue** (`queue_transition_allowed`)

| From | May become |
|---|---|
| `waiting` | `called`, `cancelled` |
| `called` | `in_service`, `no_show`, `cancelled` |
| `in_service` | `completed` |

**Class registration** (`registration_transition_allowed`)

| From | May become |
|---|---|
| `waitlisted` | `booked`, `cancelled` |
| `booked` | `checked_in`, `late_cancel`, `no_show`, `cancelled` |
| `checked_in` | `attended`, `late_cancel`, `no_show`, `cancelled` |

Every state-changing call carries `expectedVersion`, so two people acting on the same entry cannot both win.

Registering for a full class produces a waitlist entry rather than a refusal; the drawer says so before the user commits.

## Fees

Late cancellation and no-show fees are configured per class template (`lateCancelFeePaise`, `noShowFeePaise`) and charged when a registration reaches `late_cancel` or `no_show`. `POST /fitness/class-registrations/:id/fee-waive` and `/fee-reverse` are the two ways a charge is undone — neither is on the page yet.

## Utilization

`GET /fitness/reports/utilization?from=&to=` returns walk-in totals with average wait, and per-session capacity against booked and attended counts. The range is capped at 366 days by the service.

## Not yet on the page

- Per-registration status changes. `PATCH /fitness/class-registrations/:id` exists, but `/fitness/summary` returns registration *counts* rather than the registrations themselves, so there is nothing to act on until a listing endpoint exists.
- Fee waive and reverse, for the same reason.
- Kiosk device management and `POST /fitness/kiosk/check-in`, which is a public endpoint intended for a device rather than the CRM.
- Locker release (`POST /fitness/locker-assignments/:id/release`); assignment is on the page, release needs the assignment list that the summary does not return.

## Future roadmap

- A registrations listing on `/fitness/summary` or its own endpoint, which unlocks attendance marking, fee waivers and locker release in one step.
- Client and staff pickers. The drawers currently take ids by hand, which is workable for setup and wrong for daily use.
