# AI Prediction Outcomes

> **Status:** Active. Covers the outcome loop that measures whether stored
> predictions turned out to be correct.
> **Owner modules:** `backend-rust/src/services/ai_prediction_outcome_service.rs`,
> `backend-rust/src/repositories/ai_prediction_outcome_repository.rs`,
> migration `0420_ai_prediction_outcomes.sql`.

## 1. Why this exists

`ai_prediction_runs` and `ai_predictions` recorded *what was predicted*, by which
model, from which history window. They never recorded *what actually happened*.

Two consequences followed from that gap:

- A confidence label (`high` / `medium` / `low`) was an assertion by the code
  that produced it, never a measurement. Nothing in the system could contradict
  it.
- The Python prediction service and the Rust deterministic fallback could not be
  compared. A tenant running entirely on the fallback looked identical, in the
  data, to one running on a trained model.

The outcome loop closes both. Every prediction now carries a horizon, gets
checked against operational data once that horizon passes, and contributes to a
hit rate that is shown next to the forecast it belongs to.

## 2. Data model

Migration `0420` adds outcome columns to `ai_predictions` rather than creating a
side table. A verdict belongs to exactly one prediction, is written once, and is
meaningless apart from the range it judges — a second table would only add a
join and a way for the two to disagree.

| Column | Meaning |
| --- | --- |
| `horizon_end` | Date the truth becomes knowable. `NULL` only when it never will. |
| `outcome_status` | `pending`, `resolved`, or `unresolvable`. |
| `outcome_rule` | `range_contains` or `direction_matches` — how the verdict was reached. |
| `actual_value` | The observed value, in the prediction's own unit. |
| `outcome_hit` | Whether the prediction was correct under its rule. |
| `outcome_error` | Distance from the range; zero when the observation landed inside it. |
| `outcome_note` | The caveat on a resolved row, or the reason an unresolvable one cannot be checked. |
| `resolved_at` | When the verdict was written. |

### The three states

`pending` and `unresolvable` are not the same thing, and the difference is what
keeps a hit rate honest:

- **`pending`** — the horizon has not passed. Nothing to check yet.
- **`resolved`** — the horizon passed and the truth was observable.
- **`unresolvable`** — the horizon passed and the truth was *not* observable. A
  no-show risk for a client who never booked again was never put to the test.
  Recording it as a miss would understate the model; dropping it would overstate
  the sample. It is counted separately and excluded from the rate.

### Constraints

Four `CHECK` constraints make an inconsistent verdict impossible to write:

- `ck_ai_predictions_outcome_status` — only the three states above.
- `ck_ai_predictions_resolved_complete` — a resolved row must carry its actual
  value, hit flag, error and rule. A claim of knowledge with nothing behind it
  is refused by the database, not merely discouraged in code.
- `ck_ai_predictions_pending_unjudged` — a pending row must carry no verdict, so
  one cannot be written before the horizon it was supposed to wait for.
- `ck_ai_predictions_unresolvable_explained` — an unresolvable row must say why,
  otherwise it is indistinguishable from a row the resolver failed to process.

Predictions written before this migration are closed out as `unresolvable`. They
have no recorded horizon and their subjects' state at the time is not
recoverable, so judging them now would mean inventing the window they were meant
to cover. The first honest accuracy figure comes from predictions made after the
migration.

## 3. Horizons

The horizon is fixed **when the prediction is written**, in
`ai_prediction_service::predict`, not when it is judged. Choosing the window
afterwards would let a miss be re-framed as a hit by widening it.

Two families:

- **Duration predictions** (`client_return_window`, `inventory_reorder_risk`)
  derive the horizon from the predicted upper bound plus a 14-day grace period.
  This guarantees that a prediction which has not come true by the horizon has
  *definitively* missed high, rather than merely being unfinished.
- **Level predictions** use a fixed window matching the period the range
  describes.

| Kind | Horizon | Rule |
| --- | --- | --- |
| `client_return_window` | upper bound + 14d | `range_contains` |
| `inventory_reorder_risk` | upper bound + 14d | `range_contains` |
| `client_churn_risk` | 90d | `direction_matches` |
| `service_demand` | 90d | `range_contains` |
| `staff_utilization` | 90d | `range_contains` |
| `membership_renewal_risk` | 60d | `direction_matches` |
| `no_show_risk` | 45d | `direction_matches` |
| `appointment_load` | 30d | `range_contains` |
| `revenue_forecast` | 30d | `range_contains` |

A subject that failed the sufficiency gate is written straight to
`unresolvable`: it was never scored, so it made no claim to check.

## 4. Judging rules

A prediction is judged by the rule its unit deserves.

**`range_contains`** — the observed value fell inside the predicted range.
Bounds are inclusive. Error is the distance to the nearer bound, so a near miss
and a wild miss are distinguishable.

**`direction_matches`** — used for the 0-100 risk scores, which stand in for an
event that either happened or did not. The observation is expressed on the same
scale (0 or 100) and the verdict is whether the predicted midpoint fell on the
same side of 50. Asking whether a binary outcome landed inside a score range
would be measuring nothing: a correct high-risk warning of 70-90 followed by the
event at 100 would be scored a miss.

### Censored observations

Two kinds can reach their horizon with the event still not having happened — a
client who has not returned, stock not yet exhausted. The true value is unknown,
but it is already beyond the range's upper bound, so the elapsed time is
recorded as a **floor** and the prediction is a definitive miss. `outcome_note`
says so on the row.

## 5. The resolver

`run_outcome_resolution_worker` runs on the `ai_prediction_outcomes` worker,
six-hourly, under the standard lease-plus-advisory-lock election in
`infrastructure::worker`. It:

1. Reads up to 500 predictions whose horizon has passed, oldest horizon first,
   so a backlog drains in the order it accumulated.
2. Observes the outcome for each, reading the same operational tables the
   feature builders read but forward from the prediction date instead of
   backward from now.
3. Writes the verdict, or closes the row as unresolvable.

Failure handling distinguishes two cases that matter. `Ok(None)` from an
observation means the truth never became observable — recorded as unresolvable.
An `Err` means the read itself failed, and the row stays `pending` for the next
cycle. One failing subject never stops the batch.

`record_outcome` only ever moves a row out of `pending`, so a restarted worker
cannot rewrite a verdict against a longer window.

## 6. Observations per kind

Each observation counts the same way the corresponding feature builder counts,
so a prediction is never judged against a different definition than the one it
was built from.

| Kind | Observed as |
| --- | --- |
| `client_churn_risk` | Any completed appointment or non-void sale in the window → 0, otherwise 100. |
| `client_return_window` | Days from prediction to first such visit. |
| `no_show_risk` | The client's first attended-or-no-show appointment in the window. Cancelled bookings test neither. |
| `service_demand` | `SUM(quantity)` of that service's POS lines in the window. |
| `staff_utilization` | Booked minutes over rostered minutes. Unresolvable when never rostered — dividing by an empty roster would report 0% for someone not expected to work. |
| `appointment_load` | Completed appointments divided by window days, since the prediction is a daily rate. |
| `revenue_forecast` | Mean revenue across trading days, excluding zero days exactly as the forecast does. |
| `inventory_reorder_risk` | Days until cumulative consumption exhausted the stock the item held at prediction time, read back from the run's stored feature set. |
| `membership_renewal_risk` | Membership still active after the decision passed → 0, lapsed → 100. A deleted row is unresolvable, not a lapse. |

## 7. Reading accuracy

`PredictionAccuracy` is attached to every `PredictionRun` returned by
`POST /api/v1/ai/predictions/:kind` and
`GET /api/v1/ai/predictions/:kind/latest`, and is also available on its own at
`GET /api/v1/ai/predictions/:kind/accuracy`.

- Lookback is 180 days — long enough to gather a sample, short enough that a
  model replaced last month stops dominating.
- `hitRatePercent` is `null` below 20 resolved predictions. Under that, the
  percentage would move by double digits on a single outcome, which reads as
  precision the sample cannot support. The response says how many are still
  pending instead.
- `byModel` breaks the figure down by `modelVersion` and `computedBy`, because a
  rate pooled across the Python model and the deterministic fallback would
  describe neither. The overall `meanError` is weighted by resolved count.
- `statement` carries the whole thing in one sentence, including what counted as
  a hit, so a client cannot render the number without its definition.

Accuracy runs through the same scope chain as the prediction itself: a login
sees the track record for exactly the branches whose predictions it could have
read, so it cannot become a side channel onto another branch's performance.

The Command Center forecast cards render `forecastAccuracy()` beneath the model
line, with the full statement as the tooltip.

## 8. Confidence is now a measurement

`confidence` used to be an assertion by whichever engine produced the range,
with nothing in the system able to contradict it. Every returned prediction now
has its claim narrowed to what the kind's own checked record supports:

| Measured hit rate | Effect on the claim |
| --- | --- |
| Not measured yet | `high` is capped to `medium` |
| Below 50% | everything floors at `low` |
| 50–80% | `high` is capped to `medium` |
| 80% or above | the claim stands as made |

It never *raises* a claim. A model that called its own answer `low` knows
something about that particular subject the aggregate does not. The stored run
keeps the claim exactly as it was made — the run is an audit record of what was
asserted — while the caller is shown the supported one.

## 9. Future roadmap

- Use per-kind accuracy to decide which kinds are worth surfacing proactively in
  the briefing, rather than surfacing all of them at a fixed confidence floor.
- Extend the same outcome discipline to `ai_action_service` drafts: record
  whether an approved offer or follow-up produced the effect it predicted. That
  data is the precondition for any earned-autonomy work.
