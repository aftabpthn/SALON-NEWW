# Aura Salon CRM/POS AI Audit

Date: 2026-06-22

## Executive Summary

Aura still has a broad AI-shaped product surface, but the shared LLM foundation is now implemented in the current workspace. The app keeps deterministic salon intelligence as the safe fallback, while AI Assistant workflows can now route through `server/services/ai/llmProvider.js` with prompt registry modules, local/OpenAI provider fallback, cache, cost ledger, governance controls, PII redaction, prompt length guard, and observability.

Runtime mode is still controlled by `AI_PROVIDER`. With `AI_PROVIDER=local`, outputs remain local business-rule fallbacks. With `AI_PROVIDER=openai` and `OPENAI_API_KEY`, the provider path can call OpenAI and records cache/cost metadata. Anthropic is present in AI Workforce provider catalog only; it is not a live provider in the shared `llmProvider` path.

Recommended next step: treat Phase 1 LLM Foundation as complete and move the next completion slice to Phase 2: knowledge/RAG certification, WhatsApp agent state + booking tools, and external provider live certification with a real production key.

## AI Code Path Map

| Area | Files | Current behavior | Provider usage | Persistence |
|---|---|---|---|---|
| AI Assistant | `server/routes/ai.routes.js`, `server/services/ai-assistant.service.js`, `server/services/ai-assistant-llm.service.js`, `server/services/ai/llmProvider.js` | 9 legacy workflow types behind `POST /api/ai/:type`, plus LLM-backed assistant workflows, history, observability, governance and cache controls | Shared provider path supports local fallback and OpenAI when configured | `ai_interactions`, `ai_response_cache`, `ai_cost_ledger`, AI governance tables |
| AI Marketing | `server/routes/ai-marketing.routes.js`, `server/services/ai-marketing.service.js` | Segmenting, campaign generation, captions, offers, sequences and email templates via rules/templates | None | `ai_marketing_generations`, campaigns, workflows, sequences, email templates |
| Future Features | `server/routes/future-features.routes.js`, `server/services/future-features.service.js` | 10 innovation workflows using formulas and templates | None | `innovation_runs`, `voice_booking_sessions`, `kiosk_sessions` |
| WhatsApp Automation | `server/routes/whatsapp.routes.js`, `server/services/whatsapp-automation.service.js` | Keyword intent detection, lead scoring, fixed auto replies, reminder/broadcast helpers | None | `whatsapp_threads`, `whatsapp_messages`, `whatsapp_handoffs`, notifications |
| Customer 360 | `server/routes/customer-360.routes.js`, `server/services/customer-360.service.js` | Rule-based LTV, risk score, favorite service/staff and next-best-action | None | `customer_intelligence_snapshots`, `customer_timeline_events` |
| Config | `server/config/env.js`, `server/services/ai/aiGovernance.service.js` | `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, governance settings and task overrides | Local default; OpenAI external provider path; other provider catalog entries are not shared-provider calls yet | AI governance tables |

## Provider And Dependency Findings

| Check | Finding |
|---|---|
| OpenAI | Supported through shared `server/services/ai/llmProvider.js` when `AI_PROVIDER=openai` and `OPENAI_API_KEY` are configured. No SDK dependency required. |
| Anthropic | Cataloged in AI Workforce provider setup, but not implemented as a live provider in shared `llmProvider`. |
| Local fallback | Default behavior. `AI_PROVIDER` defaults to `local`. |
| Provider abstraction | Implemented in `server/services/ai/llmProvider.js`. |
| Prompt registry | Implemented under `server/services/ai/prompts/` and surfaced through AI Assistant registry APIs. |
| Response cache | Implemented through `ai_response_cache`. |
| Cost ledger | Implemented through `ai_cost_ledger`. |
| Budget enforcement | Implemented through AI governance usage limits and provider safeguards. |
| Prompt versioning | Implemented in prompt modules and cache/ledger metadata. |
| Token usage | Recorded in `ai_cost_ledger` for provider/cache/fallback calls. |
| RAG/embeddings | Knowledge-base service exists, but embedding/RAG certification remains pending. |
| ML model registry | AI Workforce provider catalog exists; general ML model registry/prediction tables remain pending. |

## `/api/ai/*` Audit

Routes:
- `GET /api/ai/history`
- `POST /api/ai/:type`

Allowed workflow types:
- `appointment-booking`
- `upsell`
- `service-recommendation`
- `chatbot`
- `follow-up`
- `review-reply`
- `marketing-caption`
- `analytics-summary`
- `churn-prediction`

| Endpoint / type | LLM, template, or hybrid | Inputs used | Inputs ignored or weakly used | Output source | Persistence |
|---|---|---|---|---|---|
| `GET /api/ai/history` | Data read only | Query passed to repository list | N/A | Existing `ai_interactions` rows | Reads `ai_interactions` |
| `POST /api/ai/appointment-booking` | Hybrid when OpenAI enabled; otherwise rules | `clientId`, `serviceId`, `staffId`, `branchId`, `startAt`, `source`, `walkIn`, `chair`, `prompt`, `confirmBooking` | Natural-language prompt is only keyword matched; no full NLU slot extraction | Local matching creates draft/appointment; optional OpenAI adds `modelText` only | Creates `ai_interactions`; may create appointment and notification |
| `POST /api/ai/upsell` | Hybrid wrapper, rule-generated core | `clientId`, `serviceId`, `prompt`, `concern` | No co-purchase model; no client similarity model | Service add-ons, top in-stock retail products, membership rule | Creates `ai_interactions` |
| `POST /api/ai/service-recommendation` | Hybrid wrapper, rule-generated core | `clientId`, `serviceId`, `prompt`, `concern`, client notes | No semantic understanding beyond string/category matches | Local service filtering and fixed reasons | Creates `ai_interactions` |
| `POST /api/ai/chatbot` | Hybrid wrapper, rule-generated core | Current dashboard/report context | User question/prompt is not meaningfully parsed | Fixed answer from revenue/bookings/pending/low stock | Creates `ai_interactions` |
| `POST /api/ai/follow-up` | Hybrid wrapper, rule-generated core | `clientId`, `serviceId`, `channel`, `reason`, `prompt`, `saveNotification` | Tone/language not model-selected; no campaign optimization | Fixed thank-you / rebooking message | Creates `ai_interactions`; may create notification and update client WhatsApp history |
| `POST /api/ai/review-reply` | Hybrid wrapper, rule-generated core | `rating`, `reviewText`, `prompt` | Actual review text has minimal impact except being stored | Two fixed reply templates based on rating >= 4 | Creates `ai_interactions` |
| `POST /api/ai/marketing-caption` | Hybrid wrapper, rule-generated core | `offer`, `prompt`, `channel` | No audience/context adaptation beyond generic offer string | Three fixed caption templates | Creates `ai_interactions` |
| `POST /api/ai/analytics-summary` | Hybrid wrapper, rule-generated core | Live advanced report only | Payload ignored | Fixed summary lines and rule-selected actions | Creates `ai_interactions` |
| `POST /api/ai/churn-prediction` | Hybrid wrapper, rule-generated core | Client `lastVisitAt`, tags, visit count, total spend, membership | Payload ignored; no trained model | Formula: inactive days, tags, visit penalty, spend/membership protection | Creates `ai_interactions` |

### `ai_interactions` And AI Metadata

`ai_interactions` is populated for every successful `POST /api/ai/:type` call through `persistInteraction()`.

Fields saved:
- `tenantId`
- `branchId`
- `clientId`
- `appointmentId`
- `type`
- `prompt`
- `input`
- compact `context`
- `output`
- `actions`
- `model`
- `status`
- `confidence`

Enterprise metadata is now split across tables:
- `ai_interactions` keeps the workflow request/response history.
- `ai_response_cache` stores task/provider/model/prompt-version cache entries.
- `ai_cost_ledger` stores request id, provider, model, token/cost/latency, cache and fallback metadata.

Remaining cleanup: confirm whether all legacy `/api/ai/:type` rows need duplicated provider fields on `ai_interactions`, or whether the ledger remains the source of truth for provider metadata.

## `/api/ai-marketing/*` Audit

Routes:
- `GET /api/ai-marketing/summary`
- `POST /api/ai-marketing/segments`
- `POST /api/ai-marketing/campaigns/generate`
- `POST /api/ai-marketing/captions`
- `POST /api/ai-marketing/offers/recommend`
- `POST /api/ai-marketing/retargeting-workflows`
- `POST /api/ai-marketing/whatsapp-sequences`
- `POST /api/ai-marketing/email-templates`
- `POST /api/ai-marketing/festival-campaigns`

| Endpoint | LLM, template, or hybrid | Inputs used | Inputs ignored or weakly used | Output source | Persistence |
|---|---|---|---|---|---|
| `GET /ai-marketing/summary` | Rules/data aggregation | Query branch context | No model summary | Counts campaigns/workflows/sequences/templates/generations; computed segments | Reads marketing tables |
| `POST /ai-marketing/segments` | Rule-based segmentation | `tag`, `minSpend`, `minVisits`, `inactiveDays`, `membershipOnly`, `highValue`, `name` | No lookalike/RFM model | Filters clients from repository | None unless caller uses result |
| `POST /ai-marketing/campaigns/generate` | Template + rules | `segment`, `occasion`, `festival`, `channel`, `offerTitle`, `name`, `status`, `scheduledAt` | No LLM copywriting; no audience language/tone adaptation | Creates campaign from fixed template and best offer formula | `campaigns`, `ai_marketing_generations` |
| `POST /ai-marketing/captions` | Template | `occasion`, `offerTitle`, `channel` | No LLM, no brand voice, no A/B variants beyond fixed copy | Fixed caption sentence and hashtags | `ai_marketing_generations` |
| `POST /ai-marketing/offers/recommend` | Rules | `segment` fields | No ML propensity model | Top priced service, inactive comeback, low-stock retail bundles | `ai_marketing_generations` |
| `POST /ai-marketing/retargeting-workflows` | Template + rules | `inactiveDays`, `highValue`, `name`, `trigger`, `channel`, `status`, `steps`, `triggerRule` | No journey optimization | Fixed retargeting steps unless payload overrides | `marketing_workflows`, `ai_marketing_generations` |
| `POST /ai-marketing/whatsapp-sequences` | Template + rules | `audienceRule`, `name`, `campaignId`, `steps`, `status` | No conversational personalization | Fixed 3-step WhatsApp sequence unless payload overrides | `marketing_sequences`, `ai_marketing_generations` |
| `POST /ai-marketing/email-templates` | Template + rules | `name`, `occasion`, `offerTitle`, `subject`, `body`, `purpose`, `variables`, `status` | No LLM subject/body generation | Fixed body unless payload overrides | `email_templates`, `ai_marketing_generations` |
| `POST /ai-marketing/festival-campaigns` | Orchestration of templates | `festival`, `channel`, `segment`, `name` | No festival-specific model intelligence | Calls campaign + email + WhatsApp sequence builders | Campaign/email/sequence/generation rows |

## `/api/future-features/:type/run` Audit

Allowed types:
- `growth-advisor`
- `pricing-optimizer`
- `offer-engine`
- `emotion-analysis`
- `no-show-prediction`
- `demand-forecasting`
- `inventory-prediction`
- `voice-booking-assistant`
- `smart-kiosk-mode`
- `ai-receptionist`

| Type | Current output | Real or placeholder? | Gap |
|---|---|---|---|
| `growth-advisor` | Retention, premium mix, inventory priorities from live counts | Partial real | No LLM explanation, no causal analysis, no forecasting model |
| `pricing-optimizer` | Suggested service price uplift based on average ticket and price multiplier | Partial real | No demand elasticity, conversion tracking, or branch A/B test model |
| `offer-engine` | Fixed offers for first 3 services | Mostly placeholder | No segment-specific personalization or expected conversion model |
| `emotion-analysis` | Keyword sentiment for bad/late/wait/love/great | Mostly placeholder | No real emotion model, no Hindi/Hinglish support |
| `no-show-prediction` | Formula from inactivity and online source | Partial real | No trained model, no weather/time/history features |
| `demand-forecasting` | Counts appointments by day and applies weekend/campaign multiplier | Partial real | No seasonality, staff capacity, local festival/weather signals |
| `inventory-prediction` | Low-stock reorder suggestion | Partial real | No usage velocity, service-linked professional stock forecast |
| `voice-booking-assistant` | Parses a transcript using first matching service keyword and recommends slots | Partial real | No speech/NLU, no state machine, no confirmation flow |
| `smart-kiosk-mode` | Creates kiosk session and shows queue prediction | Partial real | No identity verification, consent flow, upsell model |
| `ai-receptionist` | Static routing script based on supplied `intent` | Mostly placeholder | No intent detection, no tool use, no dialog memory |

Persistence: every run creates an `innovation_runs` row. Voice/kiosk also create `voice_booking_sessions` or `kiosk_sessions`.

## WhatsApp AI Readiness

Current WhatsApp automation is useful but not an AI agent yet.

| Capability | Current state | Gap |
|---|---|---|
| Intent detection | Regex/keyword matching in `detectIntent()` | Needs LLM structured JSON intent detection with Hindi/Hinglish |
| Lead scoring | Rule formula in `scoreLead()` | Needs learned conversion propensity later |
| Auto reply | Fixed templates in `sendAutoReply()` | Needs dialog state and same-language response generation |
| Booking tools | None in WhatsApp service | Needs `search_available_slots`, `create_booking`, `reschedule`, `cancel` tool orchestration |
| Conversation state | Thread metadata only | Needs persistent `whatsapp_conversation_state` |
| Human handoff | Exists via `whatsapp_handoffs` | Good base; should be integrated as AI escape path |
| End-to-end booking | Not implemented | AI currently asks staff/customer for details but does not complete booking autonomously |

## Customer 360 AI Readiness

Current Customer 360 reads real client data and computes:
- lifetime value
- average spend
- inactive days
- favorite service
- preferred staff
- outstanding balance
- membership status
- rule-based risk score
- rule-based next-best-action
- timeline events

This is a strong data foundation, but not yet ML/LLM-powered. Churn risk is formula-based, next-best-action uses simple if/else rules, and explanations are fixed strings.

## Hardcoded / Template Outputs Flagged

| File | Examples |
|---|---|
| `server/services/ai-assistant.service.js` | Review replies, marketing captions, chatbot answer, follow-up copy, churn reasons |
| `server/services/ai-marketing.service.js` | Campaign templates, captions, WhatsApp sequence steps, email bodies, retargeting steps |
| `server/services/future-features.service.js` | AI receptionist script, offer engine messages, emotion-analysis replies, growth advisor actions |
| `server/services/whatsapp-automation.service.js` | Auto replies, reminders, payment reminders, birthday wishes, campaign broadcast fallback |
| `server/services/customer-360.service.js` | Risk insights and next-best-action reasons |

These are acceptable local fallbacks, but they should be moved behind prompt/provider infrastructure so the product can produce genuinely context-aware responses when an LLM is available.

## Test Coverage Findings

Existing tests now cover the Phase 1 AI foundation in addition to the broader app checks.

Covered areas include:
- provider fallback, cache hit, cost ledger and budget behavior in `tests/ai-llm-foundation.test.js`
- PII redaction before external provider calls
- prompt length guard local fallback
- AI observability and cache clearing
- AI governance settings, task overrides and denials
- production/final completion behavior in `tests/ai-production-completion.test.js` and `tests/ai-final-completion.test.js`

Remaining test areas:
- real external OpenAI live smoke with production key
- Anthropic or other provider adapter tests if those providers are added to shared `llmProvider`
- embedding/RAG retrieval tests
- WhatsApp Hindi/Hinglish stateful booking fixtures
- end-to-end autonomous booking tool orchestration
- ML model registry and prediction lifecycle tests

## Schema Gap List

Completed for Phase 1:
- `ai_response_cache`
- `ai_cost_ledger`
- AI governance settings/task overrides/denials
- prompt registry files under `server/services/ai/prompts/`
- provider/cache/cost/fallback metadata in cache and ledger tables

Needed for Phase 2:
- `embeddings`
- optional embedding job queue / refresh metadata

Needed for Phase 3:
- `whatsapp_conversation_state`
- optional AI tool-call log table or reuse `ai_interactions`

Needed for Phase 4:
- `ml_models`
- `ml_predictions`

Needed for governance hardening:
- decide whether provider metadata should also be duplicated on `ai_interactions`
- add explicit audit events for prompt changes, model-training actions and budget changes where not already covered by governance denials/settings
- certify cache invalidation operational flow for production support

## Tenant And Security Findings

Good foundations:
- Routes are mounted under both `/api` and `/api/v1`.
- `/api/v1` routes are JWT protected.
- Web `/api` routes use request context headers and RBAC.
- Services generally call `tenantService.accessScope()` and assert branch access where applicable.
- AI/marketing outputs persist with tenant scoping.

Current Phase 1 controls:
- provider path redacts PII before external OpenAI calls
- provider key stays environment-backed
- governance settings and task overrides enforce tenant/task controls
- `ai_cost_ledger` gives cost/usage chargeback data
- prompt modules carry version metadata

Remaining risks:
- all non-assistant AI-like surfaces still need a second pass before they are called fully LLM-backed
- provider outage handling should be live-tested against a real external provider
- production policy for retention, cache TTL and prompt-change audit should be documented

## Phase 1 Completion Status

Phase 1 LLM Foundation is complete in the current workspace:

1. Shared provider: `server/services/ai/llmProvider.js`.
2. Prompt registry: `server/services/ai/prompts/`.
3. Governance: `server/services/ai/aiGovernance.service.js` and AI route controls.
4. Persistence: `ai_response_cache`, `ai_cost_ledger`, governance tables.
5. UI/control surface: AI Assistant observability and governance controls.
6. Tests: foundation, production completion and final completion coverage.

Next completion slice should not rebuild Phase 1. It should certify or implement Phase 2 capabilities: knowledge/RAG, WhatsApp agent tool state, and production external-provider smoke tests.

## Decision

Phase 1 is complete in the current workspace. The deterministic system remains valuable as the fallback and should stay. Next pending AI work is Phase 2: knowledge/RAG certification, WhatsApp autonomous booking tools, and live external-provider production certification.
