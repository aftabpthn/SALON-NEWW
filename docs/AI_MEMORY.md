# AI Memory

> **Status:** Active. Written only by people, expires by default.
> **Owner modules:** `backend-rust/src/services/ai_memory_service.rs`,
> `backend-rust/src/repositories/ai_memory_repository.rs`,
> migration `0423_ai_memory_notes.sql`.

## 1. Why this exists

The semantic index (see [AI_SEMANTIC_RETRIEVAL.md](./AI_SEMANTIC_RETRIEVAL.md))
answers "what does the CRM say about this topic". It cannot answer "what did
Priya tell us she wants", because that is not a similarity question — it is an
exact fact somebody decided to keep, and it has to come back the same way every
time.

That is what memory is for, and the scope stops there. It is not a profile, not
an inference store, and not a place the assistant writes its own conclusions.

## 2. The four rules

**Memory is recorded, never inferred.** There is no code path by which a model
writes here. `source` has exactly two values — `stated_by_client` and
`recorded_by_staff` — and the API refuses `inferred`, `model` and `ai` with a
message explaining the rule rather than a generic validation error. A wrong
inference stored as durable memory would be recalled as fact indefinitely with
nobody able to say where it came from.

**Everything expires.** `expires_at` is `NOT NULL` and capped. A caller may ask
for less than the cap, never more. Crucially, expiry is enforced on **every
read**, not delegated to the sweep: the reads decide what is live, the sweep
only reclaims disk. A worker that is late, wedged or switched off cannot cause
an expired note to be recalled.

| | Default | Cap |
| --- | ---: | ---: |
| Ordinary note | 365 days | 730 days |
| Sensitive note | 180 days | 180 days |

**Sensitive notes are narrower.** A salon legitimately records an allergy.
Recording it is not the risk; keeping it for two years and repeating it back
over WhatsApp is. Sensitive notes are kept for a shorter period and are never
sent to an external channel — `for_channel` includes them for `web` only.
Being right about an allergy is no comfort if it was repeated to whoever
happened to be holding the client's phone.

**Memory follows its subject.** A client who is deleted, deactivated or merged
takes their notes with them. This is an anti-join in the retention sweep rather
than a hook on each delete path, because a client can leave three different ways
and a rule depending on all three remembering to call it would eventually miss
one.

## 3. Bounds

- **20 live notes per subject.** A cap, not a warning: unbounded memory about a
  person is a profile. Exceeding it is a refusal a person sees, not silent
  trimming of an older note.
- **500 characters per note**, enforced by a CHECK.
- **8 notes** are handed to the assistant for any one conversation.
- **The same fact twice is one fact.** Re-recording extends the expiry rather
  than stacking duplicates, which would all come back together on recall and
  read as separate pieces of evidence.
- A note cannot be born expired (`expires_at > created_at`), which would make it
  invisible and look undeletable at the same time.

## 4. Permission

Client memory is client data and is gated on the `clients` domain, exactly as a
client tool answer is. A login denied `clients.read` cannot read or write it.

A `user` note is an operator's own working preference. It is not client data, so
it is not gated on that domain — instead it is gated on ownership: you can only
read and write your own, even as an owner who may read every client in the
branch.

## 5. Recall

When a concierge session has a client, that client's live notes are loaded and
passed to the provider as `client_memory`, already filtered for what the channel
may repeat back. The instruction sent with them is narrow: use them to make the
reply fit the person, do not read them out as a list, do not treat them as
current bookings or purchases, and do not infer anything further from them.

Recall is not similarity-ranked and does not wait for the tools to fail — a
stated preference is as relevant to a booking question as to a small-talk one.
`last_recalled_at` moves whenever notes are used, so a note that never helps can
be told from one that does.

## 6. Retention sweep

`purge_expired` runs on the existing `ai_transcript_retention` worker, six
hourly. It is the same class of obligation as a transcript expiring and belongs
on the same clock rather than on a second one somebody has to remember exists.
Each pass does three things:

1. Deletes notes past `expires_at`.
2. Deletes notes about clients the CRM no longer holds, by anti-join.
3. **Prunes ordinary notes nobody has recalled in 180 days** — never recalled
   since it was written, or not recalled inside the window. A subject has twenty
   slots and a note nobody has needed in half a year is holding one something
   current could use. Keeping personal information for no reason is the thing
   retention exists to prevent, so this is part of retention rather than a
   separate feature.

Sensitive notes are exempt from step 3, and the exemption is the point rather
than an oversight: an allergy is not less true because no conversation happened
to surface it, and deleting one quietly because a chatbot never mentioned it
would be actively harmful. Those already expire on their own shorter clock.

## 7. API surface

| Route | Purpose |
| --- | --- |
| `POST /api/v1/ai/memory` | Record a fact, or extend the one that already says it |
| `GET /api/v1/ai/memory/:subjectKind/:subjectId` | One subject's live notes |
| `DELETE /api/v1/ai/memory/notes/:id` | Forget one note |
| `DELETE /api/v1/ai/memory/clients/:id` | Forget everything about a client |
| `GET /api/v1/ai/memory/disputes` | What clients have contested and nobody has reviewed |
| `POST /api/v1/ai/memory/notes/:id/dispute` | Close a dispute as `corrected` or `upheld` |
| `GET /api/v1/customer/me/memory` | What a signed-in customer sees is remembered about them |
| `DELETE /api/v1/customer/me/memory` | A customer erasing their own memory |
| `POST /api/v1/customer/me/memory/:id/dispute` | A customer saying a note is wrong |

The record response includes a `retentionStatement` saying how long the note
will actually last and when it will go, because the requested retention is
clamped and a caller that asked for five years should be told it got one.

## 8. What the client themselves can see

A signed-in customer reads and erases their own memory through the portal,
scoped through `customer_account_clients` so an account reaches only the client
records it is linked to.

They can **see**, **dispute** and **erase**, but not **edit**. A memory a client
could rewrite would stop being a record of what was said. Erasing is different:
removing information about yourself is never the dangerous direction, and it is
the reason this is a customer-facing capability at all.

### Disputes

Erasing stays the safe fallback, but a silent deletion teaches the salon
nothing — they lose the note and never learn it was wrong, so whoever wrote it
writes the same thing again next month. A dispute keeps the fact that something
was contested.

**A disputed note stops being recalled the instant the client says so**, before
anybody reviews it. Waiting for a person would mean the assistant kept acting on
something the client has just told us is wrong, for however long the queue
takes. Withholding first and reviewing after is the only defensible order, and
it is enforced in the recall query itself rather than by the review workflow.

Resolution is two-valued:

- **`corrected`** — the salon agreed, and the note is deleted. Agreeing it is
  wrong and keeping it anyway would be the worst of both.
- **`upheld`** — the salon is keeping it, and it returns to use. The dispute
  stays on the row, so a note that was contested and kept is visibly different
  from one nobody ever questioned.

Disputes are scoped through `customer_account_clients` in the `WHERE` clause, so
an account cannot contest a note about somebody else even by guessing its id.

Sensitive notes are excluded from the portal read. A client is entitled to know
what is held, but a self-service page is not where a health note a staff member
wrote — and may never have discussed with them — should first appear. An erase
still removes them, because that request covers everything.

## 9. Where it appears in the app

The client profile's clinical tab carries a **What the assistant remembers**
card, next to allergies and preferences because it is the same class of
information. It lists live notes with their expiry, marks sensitive ones as
never leaving the app, and offers a single text field to add one. The card says
in as many words that the assistant never writes here itself.

A contested note shows the client's own words in place of its expiry, along with
the fact that it is not being used, and offers **They are right** or **Keep it**
instead of the ordinary Forget button.

The customer app carries the mirror of this on the profile tab: what is
remembered, when each note goes, a **This is not right** action per note and a
single **Erase all of it**. A disputed note tells the customer it has already
stopped being used.

## 10. When a dispute is raised

The branch is notified at once, in the ordinary `notifications` table under
`ai_memory_dispute`, carrying the note id, the client's own words and the route
to resolve it. The note is already out of use by then, so the sooner somebody
looks the sooner it is either corrected or back in service — a queue nobody
opens is a queue that does not exist. A failed notice is logged loudly but never
fails the dispute, which has already landed.

`GET /api/v1/ai/memory/disputes/by-recorder` reports how often each person's
notes get contested. Only people with at least one dispute appear, so it is a
queue rather than a leaderboard everyone is on, and the total they recorded
travels with the count: three disputes out of four hundred notes is a different
story from three out of five, and a bare count reads the same either way.

## 11. Future roadmap

- Let a client correct a note by proposing replacement text for staff to accept,
  rather than only flagging it. That is a bigger change than it sounds: the
  proposal has to be stored apart from the note until accepted, or the record of
  what was originally said is lost the moment somebody disputes it.
