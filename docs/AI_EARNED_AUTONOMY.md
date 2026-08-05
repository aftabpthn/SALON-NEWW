# AI Earned Autonomy

> **Status:** Active, off by default in every branch.
> **Owner modules:** `backend-rust/src/services/ai_action_autonomy_service.rs`,
> `backend-rust/src/repositories/ai_action_autonomy_repository.rs`,
> migration `0422_ai_action_autonomy.sql`.

## 1. Why this exists

Every copilot action has always stopped at a person, and for anything that moves
money or reaches a client it always will. But three of the fourteen action kinds
only write a to-do — a follow-up, a coaching task, a membership check-in.

Asking for a click on the four-hundredth identical follow-up proposal is not a
safety control. It is a habit that teaches people to click without reading,
which makes every *other* confirmation in the product weaker. Autonomy here is
about spending the confirmation budget where it buys something.

## 2. The four conditions

All four must hold, and each blocks on its own.

**Eligible.** Only kinds `ActionKind::executes_on_approval` already completes:
`create_follow_up_task`, `create_coaching_task`, `create_membership_follow_up`.
Everything else routes to a CRM screen, and a screen with nobody at it is not an
action. The list is derived from that function rather than restated, so a kind
that stops completing on approval also stops being eligible.

**Earned.** Measured from decisions the branch already made, in the last 90 days:

| Bar | Value |
| --- | --- |
| Minimum decisions | 20 |
| Approval rate | strictly above 95% |
| Undone runs in window | 0 |
| Task completion rate | at least 60%, once 10 runs have been judged |

Strictly above, not equal: at exactly 95%, one decision in twenty is still a
refusal, which is the confirmation step doing its job. Below 20 decisions the
approval rate is withheld entirely, the same discipline the prediction hit rate
uses on a thin sample.

The completion rate is the check an approval rate cannot make. Not being undone
is weak evidence — it is equally consistent with nobody having looked. A kind
can keep clearing the approval bar while every task it raises is quietly
ignored, which is the copilot generating work nobody wanted. So the tasks
created by autonomous runs are followed:

- **completed** — somebody finished it. Strong evidence the proposal was worth
  making.
- **abandoned** — cancelled outside the undo path, or still open 30 days later.
  Being ignored is a verdict too.
- **pending** — raised too recently to judge, and counted in neither half, so a
  busy week of fresh proposals cannot look like a failing one.

The floor is inclusive at 60% and applies only once 10 runs have been judged: a
kind that has just started running is observed, not assessed. It is lower than
the approval bar because it measures something different — a salon legitimately
drops some follow-ups, so this is a floor against generating noise, not a demand
for perfection.

**Granted.** An owner or admin switches it on per kind. A measured rate is
evidence, not consent — nothing becomes autonomous because a threshold happened
to be crossed. Granting is deliberately narrower than confirming: approving one
task is operational, deciding a whole class no longer needs approving is policy,
so a manager who may confirm these all day cannot grant.

**Not suspended.** An undo suspends the kind for 7 days *and* withdraws the
grant, so getting it back takes a person deciding again rather than time
passing.

## 3. What autonomy is not

**It is not a second execution path.** An autonomous run confirms its own draft
through the ordinary `confirm_draft` — same permission re-check at the moment of
approval, same claim, same idempotency key, same audit row. A separate execution
path would be a second place for the safety rules to be wrong.

**It is not a widening of the allow-list.** `ALWAYS_EXPLICIT_APPROVAL` is not
reachable from here, and a test asserts that no capable kind matches any entry
in it. An incapable kind cannot even be granted: the API refuses, and the
`ai_action_autonomy.action_type` CHECK refuses under it.

**It is not fail-open.** `may_run_without_confirmation` returns `false` on any
read failure, so a database hiccup produces a confirmation prompt rather than an
unreviewed write. If the autonomous confirmation itself fails, the draft is
returned unconfirmed for a person to approve by hand — an autonomous run that
cannot complete degrades into the ask-first flow, never into an error.

## 4. The undo

Every autonomous run carries a 24-hour undo deadline, and the branch is told the
moment it happens — an undo window nobody knows about is not a control. The
notice is per run rather than a daily digest, because a digest could arrive with
only hours of a twenty-four hour window left. It is filed in the ordinary
`notifications` table under `ai_autonomous_action`, carries the draft id, and
points at the undo route. A failed notice is logged loudly but never fails the
run, which is still reversible through the undoable list. Anyone who could have
refused the action may undo it: the point of the window is that the person who
would have been asked still gets the last word. An undo is not a correction of
someone's mistake — it is the review step, moved after the fact.

Undoing:

1. Cancels the CRM task through the same service that created it
   (`staff_advanced_service::cancel_task_for_action`). Idempotent, so two people
   undoing at once both reach a cancelled task.
2. Records the undo with an atomic conditional `UPDATE`, so exactly one of them
   is the recorded reverser and the other is told the run is no longer
   reversible.
3. Suspends the kind and withdraws the grant.

A human approval is not reversible through this path. It is that person's
decision, and the undo route refuses it.

## 5. Schema

`ai_action_autonomy` holds the grant, one row per (tenant, branch, action kind).
`ai_action_drafts` gains `decision_mode` (`human` / `autonomous`),
`undo_deadline`, `undone_at`, `undone_by`, `undo_reason`.

Constraints carry the rules the code relies on:

- An enabled grant must name who granted it and when — an anonymous grant leaves
  nobody accountable for an action nobody clicked.
- A suspension must state a reason.
- Only an autonomous run may have an undo window; a human approval is already a
  decision someone owns.
- An undone run must record who undid it.

The audit event list gains `autonomous` and `undone`. Both go in the same table
as every human decision — an autonomous system whose actions are filed
separately is one nobody reviews alongside the rest.

## 6. API surface

| Route | Purpose |
| --- | --- |
| `GET /api/v1/ai/actions/autonomy` | Every capable kind's standing, with the reason it is or is not running on its own |
| `PUT /api/v1/ai/actions/autonomy` | Grant or withdraw, owner/admin only |
| `GET /api/v1/ai/actions/autonomy/undoable` | Runs still inside their undo window |
| `POST /api/v1/ai/actions/drafts/:id/undo` | Reverse a run and withdraw the grant |

`AutonomyStatus` reports `capable`, `earned`, `enabled` and `autonomous`
separately, plus `blockedBy` and a `statement` that puts the whole position in
one sentence — a caller cannot render the state without the reason for it.
`earned` stays true for a kind nobody has switched on, so a settings screen can
show that the option is available rather than hiding it until someone guesses.

## 7. Rollout

Autonomy is off in every branch until someone turns it on, and cannot be turned
on usefully until 20 decisions exist. A new tenant will not see autonomous
behaviour for weeks, by construction.

Recommended order for a branch that wants it: watch `GET /ai/actions/autonomy`
until a kind reports `earned: true` and `blockedBy: "not_enabled"`, grant that
one kind, and check `GET /ai/actions/autonomy/undoable` daily for the first
week.

## 8. Related: are the proposals worth making?

The bar above asks whether acting without confirmation is safe. A separate
read, `GET /api/v1/ai/actions/proposals/outcomes`, asks whether the proposals
are worth raising at all — it follows the tasks from *every* approved draft,
human or autonomous, split by which. See
[AI_PREDICTION_OUTCOMES.md](./AI_PREDICTION_OUTCOMES.md) §10.

## 9. Future roadmap

- Extend the same earned/granted/reversible frame to proactive proposals raised
  by the briefing worker, which today always wait for a person.
