import hmac
import json
import os
from datetime import UTC, datetime
from statistics import mean
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from purchase_bill_extraction import router as purchase_bill_router
from staff_ai import router as staff_ai_router

app = FastAPI(title="AuraShine AI Service", version="0.2.0")
app.include_router(purchase_bill_router)
app.include_router(staff_ai_router)


@app.middleware("http")
async def require_bearer_auth(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)

    expected = os.getenv("AI_SERVICE_TOKEN", "")
    if not expected:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=error_envelope("AI_SERVICE_TOKEN is not configured"),
        )

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, expected):
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content=error_envelope("missing or invalid bearer token"),
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await call_next(request)


class MetricSnapshot(BaseModel):
    name: str
    value: float
    unit: str = ""


class TimePoint(BaseModel):
    period: str
    value: float


class ReportRequest(BaseModel):
    tenant_id: str
    report_type: str = "business"
    period: str = ""
    metrics: list[MetricSnapshot] = Field(default_factory=list)


class AnalyticsRequest(BaseModel):
    tenant_id: str
    scope: str = "dashboard"
    metrics: list[MetricSnapshot] = Field(default_factory=list)


class ForecastRequest(BaseModel):
    tenant_id: str
    metric: str
    series: list[TimePoint] = Field(default_factory=list)
    periods: int = Field(default=3, ge=1, le=12)


class CandidateService(BaseModel):
    id: str
    name: str
    tags: list[str] = Field(default_factory=list)


class RecommendationRequest(BaseModel):
    tenant_id: str
    client_preferences: list[str] = Field(default_factory=list)
    candidate_services: list[CandidateService] = Field(default_factory=list)


class WhatsAppTextRequest(BaseModel):
    tenant_id: str
    message_type: str
    guest_name: str = ""
    salon_name: str = ""
    service_name: str = ""
    appointment_time: str = ""
    payment_amount: str = ""


class CustomerMetrics(BaseModel):
    total_visits: int = Field(default=0, ge=0)
    open_appointments: int = Field(default=0, ge=0)
    amount_due_paise: int = Field(default=0, ge=0)
    lifetime_value_paise: int = Field(default=0, ge=0)
    inactive_days: int = Field(default=0, ge=0)
    no_show_rate_bps: int = Field(default=0, ge=0, le=10_000)
    cancellation_rate_bps: int = Field(default=0, ge=0, le=10_000)
    churn_risk_score: int = Field(default=0, ge=0, le=100)
    review_sentiment: str = "unknown"
    rfm_segment: str = "Not calculated"
    favourite_services: str = ""
    visit_frequency_days: float | None = Field(default=None, ge=0)
    primary_action: str = "Maintain relationship"
    primary_reason: str = "No stronger signal is available"


class CustomerServiceHistory(BaseModel):
    service_id: str
    service_name: str
    created_at: str = ""


class CustomerCandidateService(BaseModel):
    id: str
    name: str
    category: str = ""
    price_paise: int = Field(default=0, ge=0)


class CustomerRecommendationFeedback(BaseModel):
    recommendation: str
    reason: str = ""
    decision: Literal["accepted", "rejected"]
    comment: str = ""


class CustomerAiRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    customer_id: str = Field(min_length=1, max_length=120)
    metrics: CustomerMetrics
    recent_services: list[CustomerServiceHistory] = Field(default_factory=list, max_length=50)
    candidate_services: list[CustomerCandidateService] = Field(default_factory=list, max_length=200)
    feedback: list[CustomerRecommendationFeedback] = Field(default_factory=list, max_length=100)


class MarketingAdvisorClient(BaseModel):
    client_id: str
    client_name: str
    inactive_days: int = Field(ge=0)
    visit_frequency_days: float | None = None
    last_service: str = ""
    favourite_services: str = ""
    average_spend_paise: int = Field(default=0, ge=0)
    lifetime_value_paise: int = Field(default=0, ge=0)
    no_show_rate_bps: int = Field(default=0, ge=0, le=10_000)
    cancellation_rate_bps: int = Field(default=0, ge=0, le=10_000)
    preferred_channel: str = ""
    consent_status: str = ""
    membership_status: str = ""
    loyalty_points: int = Field(default=0, ge=0)
    churn_risk_score: int = Field(default=0, ge=0, le=100)
    next_best_action: str = ""
    next_best_action_reason: str = ""
    segment_keys: list[str] = Field(default_factory=list, max_length=50)


class MarketingAdvisorRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    scope: Literal["client", "segment"]
    scope_id: str = Field(min_length=1, max_length=120)
    clients: list[MarketingAdvisorClient] = Field(min_length=1, max_length=500)


class ProfitCopilotCandidate(BaseModel):
    kind: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=500)
    impact_paise: int = Field(ge=0)
    source_type: str = Field(min_length=1, max_length=80)
    source_id: str = Field(min_length=1, max_length=180)


class ProfitCopilotFacts(BaseModel):
    fact_schema_version: Literal["micro-pnl-reconciled-v1"]
    period_start: str = Field(min_length=10, max_length=10)
    period_end: str = Field(min_length=10, max_length=10)
    branch_count: int = Field(ge=1)
    ledger_revenue_paise: int
    micro_revenue_paise: int
    revenue_variance_paise: int
    ledger_cogs_paise: int
    micro_product_cost_paise: int
    cogs_variance_paise: int
    ledger_payroll_paise: int
    payroll_source_paise: int
    payroll_variance_paise: int
    cost_completeness_bps: int = Field(ge=0, le=10_000)
    reportable_line_count: int = Field(ge=0)
    reconciled: Literal[True]
    branch_period_close_ready: Literal[True]


class ProfitCopilotRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_ids: list[str] = Field(min_length=1, max_length=500)
    from_date: str = Field(min_length=10, max_length=10)
    to_date: str = Field(min_length=10, max_length=10)
    facts: ProfitCopilotFacts
    candidates: list[ProfitCopilotCandidate] = Field(default_factory=list, max_length=20)


class ProfitCopilotModelRecommendation(BaseModel):
    kind: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=500)
    source_type: str = Field(min_length=1, max_length=80)
    source_id: str = Field(min_length=1, max_length=180)


class ProfitCopilotModelOutput(BaseModel):
    recommendations: list[ProfitCopilotModelRecommendation] = Field(default_factory=list, max_length=10)


class ConciergeServiceCandidate(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=160)
    duration_minutes: int = Field(default=0, ge=0, le=1440)
    price_paise: int = Field(default=0, ge=0)


class ConciergeTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class ConciergeGovernance(BaseModel):
    prompt_version: str = Field(default="receptionist-v1", max_length=80)
    allowed_intents: list[str] = Field(default_factory=lambda: ["general", "booking", "handoff"], max_length=20)
    require_booking_confirmation: bool = True
    redact_sensitive_data: bool = True


class ConciergeOperationalContext(BaseModel):
    business_date: str = Field(min_length=10, max_length=10)
    today_appointments: int = Field(default=0, ge=0)
    open_appointments: int = Field(default=0, ge=0)
    active_clients: int = Field(default=0, ge=0)
    active_services: int = Field(default=0, ge=0)
    today_sales_paise: int | None = Field(default=None, ge=0)
    open_sales: int | None = Field(default=None, ge=0)
    recent_completed_appointments: int = Field(default=0, ge=0)
    low_stock_items: int = Field(default=0, ge=0)
    financials_visible: bool = False


class ConciergeRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    channel: Literal["web", "whatsapp", "voice"]
    locale: str = Field(default="en-IN", max_length=20)
    message: str = Field(min_length=1, max_length=4000)
    recent_messages: list[ConciergeTurn] = Field(default_factory=list, max_length=20)
    candidate_services: list[ConciergeServiceCandidate] = Field(default_factory=list, max_length=100)
    operational_context: ConciergeOperationalContext | None = None
    governance: ConciergeGovernance = Field(default_factory=ConciergeGovernance)


class ConciergeModelOutput(BaseModel):
    reply_text: str = Field(min_length=1, max_length=3000)
    intent: Literal["general", "booking", "handoff"]
    service_id: str = Field(default="", max_length=120)
    handoff_required: bool = False
    safety_flags: list[str] = Field(default_factory=list, max_length=10)


class MigrationMappingTarget(BaseModel):
    field: str = Field(min_length=1, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=50)


class MigrationMappingRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    entity: str = Field(min_length=1, max_length=80)
    source_columns: list[str] = Field(min_length=1, max_length=500)
    targets: list[MigrationMappingTarget] = Field(min_length=1, max_length=500)


class MigrationMappingChoice(BaseModel):
    source: str = Field(min_length=1, max_length=200)
    target: str = Field(min_length=1, max_length=120)


class MigrationMappingModelOutput(BaseModel):
    suggestions: list[MigrationMappingChoice] = Field(default_factory=list, max_length=500)


class MigrationFailureRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    job_id: str = Field(min_length=1, max_length=120)
    entity: str = Field(min_length=1, max_length=80)
    status: str = Field(min_length=1, max_length=40)
    last_error: str = Field(default="", max_length=500)
    error_rows: int = Field(default=0, ge=0)
    failed_chunks: int = Field(default=0, ge=0)
    approval_status: str = Field(default="not_required", max_length=40)
    recovery_recommendations: list[str] = Field(default_factory=list, max_length=20)


class MigrationFailureModelOutput(BaseModel):
    recommendations: list[str] = Field(default_factory=list, max_length=8)


@app.get("/health")
def health():
    return envelope({"status": "ok", "service": "aura-shine-ai"})


@app.post("/api/v1/ai/reports")
def create_ai_report(payload: ReportRequest):
    metric_lines = [
        f"{metric.name}: {metric.value:g}{(' ' + metric.unit) if metric.unit else ''}"
        for metric in payload.metrics
    ]
    return envelope(
        {
            "tenantId": payload.tenant_id,
            "reportType": payload.report_type,
            "period": payload.period,
            "summary": "No source metrics provided." if not metric_lines else " | ".join(metric_lines),
            "metricCount": len(payload.metrics),
        }
    )


@app.post("/api/v1/analytics/summary")
def analytics_summary(payload: AnalyticsRequest):
    values = [metric.value for metric in payload.metrics]
    highest = max(payload.metrics, key=lambda metric: metric.value, default=None)
    return envelope(
        {
            "tenantId": payload.tenant_id,
            "scope": payload.scope,
            "metricCount": len(payload.metrics),
            "averageValue": mean(values) if values else None,
            "highestMetric": highest.model_dump() if highest else None,
        }
    )


@app.post("/api/v1/forecasting")
def forecast(payload: ForecastRequest):
    values = [point.value for point in payload.series]
    baseline = mean(values[-3:]) if values else None
    forecast_points = [
        {"periodOffset": index + 1, "metric": payload.metric, "value": baseline}
        for index in range(payload.periods)
    ] if baseline is not None else []

    return envelope(
        {
            "tenantId": payload.tenant_id,
            "metric": payload.metric,
            "method": "three_point_moving_average",
            "forecast": forecast_points,
        }
    )


@app.post("/api/v1/recommendations/services")
def recommend_services(payload: RecommendationRequest):
    preferences = {item.lower() for item in payload.client_preferences}
    ranked = sorted(
        (
            {
                "id": service.id,
                "name": service.name,
                "score": len(preferences.intersection({tag.lower() for tag in service.tags})),
            }
            for service in payload.candidate_services
        ),
        key=lambda item: item["score"],
        reverse=True,
    )
    return envelope({"tenantId": payload.tenant_id, "recommendations": ranked})


@app.post("/api/v1/customer-ai/recommendations")
def customer_ai_recommendations(payload: CustomerAiRequest):
    context = build_customer_context(payload)
    metrics = payload.metrics
    health_score = max(
        0,
        min(
            100,
            100
            - metrics.churn_risk_score
            - (5 if metrics.amount_due_paise > 0 else 0)
            - (10 if metrics.review_sentiment.lower() == "negative" else 0)
            + (5 if metrics.open_appointments > 0 else 0),
        ),
    )


@app.post("/api/v1/marketing-advisor/recommendation")
def marketing_advisor_recommendation(payload: MarketingAdvisorRequest):
    clients = payload.clients
    inactive = round(mean(client.inactive_days for client in clients))
    churn = round(mean(client.churn_risk_score for client in clients))
    service_counts: dict[str, int] = {}
    channel_counts: dict[str, int] = {}
    for client in clients:
        if client.last_service:
            service_counts[client.last_service] = service_counts.get(client.last_service, 0) + 1
        if client.preferred_channel and client.consent_status != "No marketing consent":
            channel_counts[client.preferred_channel] = channel_counts.get(client.preferred_channel, 0) + 1
    due_service = max(service_counts, key=service_counts.get) if service_counts else "Next suitable service"
    best_channel = max(channel_counts, key=channel_counts.get) if channel_counts else "No consented channel"
    negative_recovery = any("negative_review_recovery" in client.segment_keys for client in clients)
    new_clients = any("new_without_second_visit" in client.segment_keys for client in clients)
    vip_clients = any("high_value_vip" in client.segment_keys for client in clients)
    safe_discount_bps = 0 if negative_recovery else 500 if new_clients or vip_clients else 1000 if inactive >= 90 else 500
    benefit_type = "complimentary_benefit" if negative_recovery or vip_clients else "discount"
    probable_reason = (
        "A recent negative review requires service recovery before promotion"
        if negative_recovery
        else f"The client audience is overdue by about {inactive} days based on saved visit history"
    )
    offer = (
        f"Complimentary consultation or add-on with {due_service}"
        if benefit_type == "complimentary_benefit"
        else f"Up to {safe_discount_bps / 100:g}% off {due_service}, subject to manager approval"
    )
    avoid = "Avoid promotional discount until the service concern is reviewed" if negative_recovery else "Avoid unrelated services and discounts above the safe ceiling"
    audience_name = clients[0].client_name if payload.scope == "client" else "selected clients"
    message = f"Hi {audience_name}, it may be time for your {due_service}. {offer}. Contact us to choose a suitable appointment time."
    evidence = [
        f"{len(clients)} real CRM client record(s) evaluated",
        f"Average inactivity: {inactive} days",
        f"Average churn risk: {churn}/100",
        f"Most relevant saved service: {due_service}",
        f"Consented preferred channel: {best_channel}",
    ]
    return envelope({
        "source": "crm_marketing_policy_v1",
        "scope": payload.scope,
        "scopeId": payload.scope_id,
        "probableReason": probable_reason,
        "dueService": due_service,
        "recommendedOffer": offer,
        "avoidOffer": avoid,
        "safeDiscountBps": safe_discount_bps,
        "benefitType": benefit_type,
        "bestChannel": best_channel,
        "bestSendingTime": "11:00 local branch time; adjust after response-time history is available",
        "suggestedMessage": message,
        "expectedOutcome": "Measure rebooking and completed-sale conversion within 30 days; no outcome is guaranteed",
        "evidence": evidence,
        "requiresApproval": True,
    })
    churn_reasons = []
    if metrics.inactive_days >= 90:
        churn_reasons.append(f"No completed visit for {metrics.inactive_days} days")
    if metrics.no_show_rate_bps >= 2_000:
        churn_reasons.append("No-show rate is elevated")
    if metrics.cancellation_rate_bps >= 2_000:
        churn_reasons.append("Cancellation rate is elevated")
    if metrics.review_sentiment.lower() == "negative":
        churn_reasons.append("Recent review sentiment is negative")
    if not churn_reasons:
        churn_reasons.append("No major churn driver is currently detected")

    return envelope(
        {
            "tenantId": payload.tenant_id,
            "branchId": payload.branch_id,
            "customerId": payload.customer_id,
            "source": "python_deterministic",
            "model": "local-customer-policy-v1",
            "healthScore": health_score,
            "healthExplanation": health_explanation(health_score, metrics),
            "churnRisk": {
                "score": metrics.churn_risk_score,
                "explanation": churn_reasons,
            },
            "nextBestActions": next_best_actions(payload, context),
            "rebookingRecommendations": rebooking_recommendations(payload),
            "upsellRecommendations": upsell_recommendations(payload, context),
            "learningContext": {
                "acceptedCount": len(context["accepted"]),
                "rejectedCount": len(context["rejected"]),
                "feedbackApplied": bool(payload.feedback),
            },
            "context": context["public"],
        }
    )


@app.post("/api/v1/profit-copilot/recommendations")
async def profit_copilot_recommendations(payload: ProfitCopilotRequest):
    fallback = profit_copilot_fallback(payload)
    if not payload.candidates or os.getenv("AI_PROVIDER", "local").strip().lower() != "openai":
        return envelope(fallback)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return envelope(fallback)

    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini"
    request_body = {
        "model": model,
        "instructions": (
            "You are a salon profitability copilot. Use only the supplied reconciled Micro P&L "
            "fact set and allow-listed candidates. Rank and rewrite candidates into concise actions. Never invent money, "
            "entities, causes, or source identifiers. Return source fields and kind exactly "
            "as supplied. Prefer the highest recorded impact and avoid duplicates."
        ),
        "input": json.dumps(
            {
                "reconciledMicroPnlFacts": payload.facts.model_dump(),
                "candidates": [candidate.model_dump() for candidate in payload.candidates],
            },
            separators=(",", ":"),
        ),
        "max_output_tokens": 1800,
        "text": {"format": profit_copilot_json_schema()},
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_body,
            )
            response.raise_for_status()
        parsed = ProfitCopilotModelOutput.model_validate_json(extract_response_text(response.json()))
    except (httpx.HTTPError, ValueError, KeyError):
        return envelope(fallback)

    candidates = {
        (candidate.kind, candidate.source_type, candidate.source_id): candidate
        for candidate in payload.candidates
    }
    recommendations = []
    seen = set()
    for item in parsed.recommendations:
        key = (item.kind, item.source_type, item.source_id)
        candidate = candidates.get(key)
        if not candidate or key in seen:
            continue
        seen.add(key)
        recommendations.append(
            {
                "kind": item.kind,
                "title": item.title.strip(),
                "message": item.message.strip(),
                "impactPaise": candidate.impact_paise,
                "sourceType": item.source_type,
                "sourceId": item.source_id,
            }
        )
    if not recommendations:
        return envelope(fallback)
    return envelope(
        {
            "tenantId": payload.tenant_id,
            "source": "openai_responses",
            "model": model,
            "recommendations": recommendations,
        }
    )


@app.post("/api/v1/concierge/respond")
async def concierge_respond(payload: ConciergeRequest):
    fallback = concierge_fallback(payload)
    provider = os.getenv("AI_PROVIDER", "local").strip().lower()
    if provider == "anthropic":
        return envelope(await anthropic_concierge_response(payload, fallback))
    if provider == "ollama":
        return envelope(await ollama_concierge_response(payload, fallback))
    if provider != "openai":
        return envelope(fallback)
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return envelope(fallback)
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini"
    request_body = {
        "model": model,
        "instructions": concierge_instructions(payload),
        "input": json.dumps(concierge_context(payload), separators=(",", ":")),
        "max_output_tokens": 1800,
        "text": {"format": concierge_json_schema()},
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_body,
            )
            response.raise_for_status()
        parsed = ConciergeModelOutput.model_validate_json(extract_response_text(response.json()))
    except (httpx.HTTPError, ValueError, KeyError):
        return envelope(fallback)
    allowed_service_ids = {item.id for item in payload.candidate_services}
    if parsed.service_id and parsed.service_id not in allowed_service_ids:
        return envelope(fallback)
    return envelope({
        "source": "openai_responses",
        "model": model,
        "promptVersion": payload.governance.prompt_version,
        "replyText": parsed.reply_text.strip(),
        "intent": parsed.intent,
        "serviceId": parsed.service_id,
        "handoffRequired": parsed.handoff_required,
        "safetyFlags": parsed.safety_flags,
    })


@app.post("/api/v1/migrations/mapping-suggestions")
async def migration_mapping_suggestions(payload: MigrationMappingRequest):
    fallback = migration_mapping_fallback(payload)
    if os.getenv("AI_PROVIDER", "local").strip().lower() != "openai":
        return envelope(fallback)
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return envelope(fallback)
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini"
    request_body = {
        "model": model,
        "instructions": (
            "Map source columns to the allow-listed migration targets using names and aliases only. "
            "Never invent, duplicate, or rename source or target fields. Omit uncertain mappings."
        ),
        "input": json.dumps({
            "entity": payload.entity,
            "sourceColumns": payload.source_columns,
            "targets": [target.model_dump() for target in payload.targets],
        }, separators=(",", ":")),
        "max_output_tokens": 1800,
        "text": {"format": migration_mapping_json_schema()},
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_body,
            )
            response.raise_for_status()
        parsed = MigrationMappingModelOutput.model_validate_json(extract_response_text(response.json()))
    except (httpx.HTTPError, ValueError, KeyError):
        return envelope(fallback)

    suggestions = dict(fallback["suggestions"])
    valid_sources = set(payload.source_columns)
    valid_targets = {target.field for target in payload.targets}
    used_targets = set(suggestions.values())
    ai_added = False
    for item in parsed.suggestions:
        if item.source not in valid_sources or item.target not in valid_targets:
            continue
        if item.source in suggestions or item.target in used_targets:
            continue
        suggestions[item.source] = item.target
        used_targets.add(item.target)
        ai_added = True
    if not ai_added:
        return envelope(fallback)
    return envelope({
        "entity": payload.entity,
        "source": "openai_responses",
        "model": model,
        "suggestions": suggestions,
        "unmatchedColumns": [column for column in payload.source_columns if column not in suggestions],
    })


@app.post("/api/v1/migrations/failure-assistant")
async def migration_failure_assistant(payload: MigrationFailureRequest):
    fallback = migration_failure_fallback(payload)
    if os.getenv("AI_PROVIDER", "local").strip().lower() != "openai":
        return envelope(fallback)
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return envelope(fallback)
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini"
    request_body = {
        "model": model,
        "instructions": (
            "Give concise, dependency-safe recovery steps for this migration failure. Use only supplied facts. "
            "Never recommend bypassing validation, tenant isolation, approval, evidence, reconciliation, or rollback preflight."
        ),
        "input": json.dumps(payload.model_dump(), separators=(",", ":")),
        "max_output_tokens": 1200,
        "text": {"format": migration_failure_json_schema()},
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_body,
            )
            response.raise_for_status()
        parsed = MigrationFailureModelOutput.model_validate_json(extract_response_text(response.json()))
    except (httpx.HTTPError, ValueError, KeyError):
        return envelope(fallback)
    recommendations = [item.strip() for item in parsed.recommendations if item.strip()]
    if not recommendations:
        return envelope(fallback)
    return envelope({
        "jobId": payload.job_id,
        "source": "openai_responses",
        "model": model,
        "summary": migration_failure_summary(payload),
        "recommendations": recommendations,
    })


@app.post("/api/v1/whatsapp/text")
def whatsapp_text(payload: WhatsAppTextRequest):
    guest = payload.guest_name or "Guest"
    salon = payload.salon_name or "our salon"
    templates = {
        "appointment_confirmation": f"Hi {guest}, your {payload.service_name} appointment at {salon} is confirmed for {payload.appointment_time}.",
        "appointment_reminder": f"Hi {guest}, reminder for your {payload.service_name} appointment at {salon}: {payload.appointment_time}.",
        "payment_reminder": f"Hi {guest}, your pending amount is {payload.payment_amount}. Please contact {salon} for payment support.",
        "follow_up": f"Hi {guest}, thank you for visiting {salon}. We hope you enjoyed your {payload.service_name}.",
    }
    text = templates.get(payload.message_type, f"Hi {guest}, {salon} will contact you shortly.")
    return envelope({"tenantId": payload.tenant_id, "messageType": payload.message_type, "text": text})


@app.post("/api/v1/analytics/report")
def legacy_report(payload: AnalyticsRequest):
    return analytics_summary(payload)


def build_customer_context(payload: CustomerAiRequest):
    accepted = {
        item.recommendation.strip().casefold()
        for item in payload.feedback
        if item.decision == "accepted"
    }
    rejected = {
        item.recommendation.strip().casefold()
        for item in payload.feedback
        if item.decision == "rejected"
    }
    recent_service_ids = list(dict.fromkeys(item.service_id for item in payload.recent_services))
    return {
        "accepted": accepted,
        "rejected": rejected,
        "public": {
            "segment": payload.metrics.rfm_segment,
            "totalVisits": payload.metrics.total_visits,
            "inactiveDays": payload.metrics.inactive_days,
            "recentServiceIds": recent_service_ids[:20],
        },
    }


def health_explanation(score: int, metrics: CustomerMetrics):
    if score >= 75:
        return "Customer engagement is healthy based on current CRM signals."
    if metrics.inactive_days >= 90:
        return "Health is reduced mainly by prolonged inactivity."
    if metrics.review_sentiment.lower() == "negative":
        return "Health is reduced by negative review sentiment."
    return "Health needs attention based on current retention signals."


def next_best_actions(payload: CustomerAiRequest, context: dict):
    metrics = payload.metrics
    candidates = [
        (100, metrics.primary_action, metrics.primary_reason),
        (90, "Start win-back outreach", f"{metrics.inactive_days} inactive days"),
        (85, "Start retention outreach", f"Churn risk score {metrics.churn_risk_score}"),
        (80, "Recover outstanding balance", "Outstanding balance is pending"),
        (70, "Book next appointment", "No upcoming appointment"),
    ]
    enabled = {
        "Start win-back outreach": metrics.inactive_days >= 90,
        "Start retention outreach": metrics.churn_risk_score >= 70,
        "Recover outstanding balance": metrics.amount_due_paise > 0,
        "Book next appointment": metrics.open_appointments == 0,
    }
    result = []
    seen = set()
    for priority, action, reason in candidates:
        key = action.strip().casefold()
        if not action or key in seen or key in context["rejected"]:
            continue
        if priority < 100 and not enabled.get(action, False):
            continue
        seen.add(key)
        result.append(
            {
                "action": action,
                "reason": reason,
                "priority": priority + (5 if key in context["accepted"] else 0),
            }
        )
    return sorted(result, key=lambda item: item["priority"], reverse=True)[:5]


def rebooking_recommendations(payload: CustomerAiRequest):
    if payload.metrics.open_appointments > 0 or not payload.recent_services:
        return []
    last_service = payload.recent_services[0]
    interval = round(payload.metrics.visit_frequency_days or 42)
    return [
        {
            "serviceId": last_service.service_id,
            "serviceName": last_service.service_name,
            "recommendedInDays": max(14, min(120, interval)),
            "reason": "No upcoming appointment and this service appears in recent history",
        }
    ]


def upsell_recommendations(payload: CustomerAiRequest, context: dict):
    signals = set(payload.metrics.favourite_services.casefold().split())
    signals.update(" ".join(context["accepted"]).split())
    recent_ids = {item.service_id for item in payload.recent_services}
    ranked = []
    for service in payload.candidate_services:
        if service.id in recent_ids:
            continue
        words = set(f"{service.name} {service.category}".casefold().split())
        score = len(words.intersection(signals))
        if score:
            ranked.append(
                {
                    "serviceId": service.id,
                    "serviceName": service.name,
                    "category": service.category,
                    "pricePaise": service.price_paise,
                    "score": score,
                    "reason": "Matches saved service or accepted recommendation signals",
                }
            )
    return sorted(ranked, key=lambda item: (-item["score"], item["serviceName"]))[:3]


def profit_copilot_fallback(payload: ProfitCopilotRequest):
    return {
        "tenantId": payload.tenant_id,
        "source": "python_deterministic",
        "model": "local-profit-policy-v1",
        "factSchemaVersion": payload.facts.fact_schema_version,
        "evaluationStatus": "passed",
        "recommendations": [
            {
                "kind": candidate.kind,
                "title": candidate.title,
                "message": candidate.message,
                "impactPaise": candidate.impact_paise,
                "sourceType": candidate.source_type,
                "sourceId": candidate.source_id,
            }
            for candidate in sorted(
                payload.candidates,
                key=lambda item: item.impact_paise,
                reverse=True,
            )[:10]
        ],
    }


def profit_copilot_json_schema():
    return {
        "type": "json_schema",
        "name": "profit_copilot_recommendations",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "recommendations": {
                    "type": "array",
                    "maxItems": 10,
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string"},
                            "title": {"type": "string"},
                            "message": {"type": "string"},
                            "source_type": {"type": "string"},
                            "source_id": {"type": "string"},
                        },
                        "required": ["kind", "title", "message", "source_type", "source_id"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["recommendations"],
            "additionalProperties": False,
        },
    }


def concierge_fallback(payload: ConciergeRequest):
    normalized = payload.message.casefold()
    handoff = any(word in normalized for word in ("complaint", "refund", "cancel", "allergy", "medical", "doctor"))
    handoff = handoff or (payload.operational_context is None and "payment" in normalized)
    booking = normalized == "book" or any(
        phrase in normalized
        for phrase in ("book ", "want to book", "schedule ", "available slot", "new appointment")
    )
    matched = next((item for item in payload.candidate_services if item.name.casefold() in normalized), None)
    if handoff:
        reply = "I will hand this request to the salon team for a safe follow-up."
        intent = "handoff"
    elif booking and matched:
        reply = (
            f"{matched.name} is available in the current catalog: {matched.duration_minutes} minutes "
            f"at {format_rupees(matched.price_paise)}. Continue to the secure booking flow to choose "
            "an available time; the booking remains a draft and requires CRM confirmation."
        )
        intent = "booking"
    elif booking:
        names = ", ".join(item.name for item in payload.candidate_services[:8])
        reply = f"Which service would you like to book? Current options include: {names}." if names else "No active services are available in this branch yet."
        intent = "booking"
    elif payload.operational_context:
        reply = operational_reply(payload, normalized, matched)
        intent = "general"
    elif matched:
        reply = f"{matched.name} takes {matched.duration_minutes} minutes and currently costs {format_rupees(matched.price_paise)}. Availability must be checked in the secure booking flow."
        intent = "general"
    elif any(word in normalized for word in ("service", "menu", "price", "cost")):
        reply = service_catalog_reply(payload.candidate_services)
        intent = "general"
    else:
        reply = "I can answer from the current service catalog, explain prices and duration, prepare a booking draft, or hand sensitive requests to the salon team. Ask a specific question for a detailed answer."
        intent = "general"
    return {
        "source": "python_deterministic",
        "model": "local-operations-policy-v2" if payload.operational_context else "local-reception-policy-v2",
        "promptVersion": payload.governance.prompt_version,
        "replyText": reply,
        "intent": intent,
        "serviceId": matched.id if matched else "",
        "handoffRequired": handoff,
        "safetyFlags": ["human_handoff"] if handoff else [],
    }


def concierge_instructions(payload: ConciergeRequest):
    if payload.operational_context:
        return (
            "You are AuraShine's advanced operations copilot for an authenticated salon user. "
            "Answer the exact question completely using only the supplied real branch metrics, service "
            "catalog and conversation. Explain relevant figures and give a practical next step when useful. "
            "Never infer unavailable data; say what is unavailable. Financial fields are present only when "
            "the role is authorized. Never expose sensitive data, invent records, or claim a booking is "
            "confirmed. Do not present booking confirmation as one of your capabilities. Prepare only a "
            "booking draft and escalate complaints, refunds, cancellations, or "
            "medical questions. Match the user's language and requested level of detail."
        )
    return (
        "You are an enterprise salon receptionist. Use only the supplied service catalog and conversation. "
        "Never invent availability, price, policy, staff, client, or booking IDs. Never provide medical "
        "advice or expose sensitive data. Do not present booking confirmation as one of your capabilities. "
        "A booking is only a draft until the CRM confirms it. Escalate "
        "complaints, payments, medical questions, cancellations, or unsupported requests to a human."
    )


def concierge_context(payload: ConciergeRequest):
    return {
        "channel": payload.channel,
        "locale": payload.locale,
        "message": payload.message,
        "recentMessages": [item.model_dump() for item in payload.recent_messages],
        "candidateServices": [item.model_dump() for item in payload.candidate_services],
        "operationalContext": payload.operational_context.model_dump() if payload.operational_context else None,
        "governance": payload.governance.model_dump(),
    }


async def ollama_concierge_response(payload: ConciergeRequest, fallback: dict):
    # Transactional intent and action fields stay deterministic; the model supplies safe conversational text only.
    if fallback["intent"] != "general":
        return fallback
    model = os.getenv("OLLAMA_MODEL", "llama3.2:1b").strip() or "llama3.2:1b"
    base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{base_url}/api/chat",
                json={
                    "model": model,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": concierge_instructions(payload)},
                        {
                            "role": "user",
                            "content": json.dumps(concierge_context(payload), separators=(",", ":")),
                        },
                    ],
                    "format": concierge_json_schema()["schema"],
                    "options": {"temperature": 0.1, "num_predict": 700},
                    "keep_alive": "30m",
                },
            )
            response.raise_for_status()
        parsed = ConciergeModelOutput.model_validate_json(response.json()["message"]["content"])
    except (httpx.HTTPError, ValueError, KeyError):
        return fallback

    return merge_concierge_model_reply(fallback, parsed, "ollama_chat", model)


async def anthropic_concierge_response(payload: ConciergeRequest, fallback: dict):
    if fallback["intent"] != "general":
        return fallback
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return fallback
    model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001").strip() or "claude-haiku-4-5-20251001"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": model,
                    "max_tokens": 1800,
                    "temperature": 0.1,
                    "system": concierge_instructions(payload),
                    "messages": [
                        {
                            "role": "user",
                            "content": json.dumps(concierge_context(payload), separators=(",", ":")),
                        }
                    ],
                    "output_config": {
                        "format": {
                            "type": "json_schema",
                            "schema": concierge_json_schema()["schema"],
                        }
                    },
                },
            )
            response.raise_for_status()
        parsed = ConciergeModelOutput.model_validate_json(extract_anthropic_text(response.json()))
    except (httpx.HTTPError, ValueError, KeyError):
        return fallback
    return merge_concierge_model_reply(fallback, parsed, "anthropic_messages", model)


def merge_concierge_model_reply(fallback: dict, parsed: ConciergeModelOutput, source: str, model: str):
    reply = parsed.reply_text.strip()
    normalized_reply = reply.casefold()
    mentions_booking_confirmation = (
        any(word in normalized_reply for word in ("booking", "appointment"))
        and "confirm" in normalized_reply
    )
    if any(
        phrase in normalized_reply
        for phrase in (
            "booking is confirmed",
            "appointment is confirmed",
            "booking confirmed",
            "appointment confirmed",
        )
    ) or mentions_booking_confirmation:
        return fallback
    return {
        **fallback,
        "source": source,
        "model": model,
        "replyText": reply,
    }


def operational_reply(payload: ConciergeRequest, message: str, matched: ConciergeServiceCandidate | None):
    context = payload.operational_context
    if any(word in message for word in ("overview", "summary", "dashboard", "how are we", "business status")):
        sales = ""
        if context.financials_visible:
            sales = f"\nToday sales: {format_rupees(context.today_sales_paise or 0)} | Open sales: {context.open_sales or 0}"
        return (
            f"Branch overview for {context.business_date}:\n"
            f"Appointments today: {context.today_appointments} | Open: {context.open_appointments}\n"
            f"Active clients: {context.active_clients} | Active services: {context.active_services}\n"
            f"Completed in last 7 days: {context.recent_completed_appointments} | "
            f"Low-stock items: {context.low_stock_items}{sales}"
        )
    if any(word in message for word in ("appointment", "booking today", "bookings today")):
        return (
            f"For {context.business_date} there are {context.today_appointments} appointments, with "
            f"{context.open_appointments} currently open. {context.recent_completed_appointments} "
            "appointments were completed in the last 7 days."
        )
    if any(word in message for word in ("sale", "revenue", "payment", "collection")):
        if not context.financials_visible:
            return "Financial figures are not available for your current role."
        return f"Today's recorded sales are {format_rupees(context.today_sales_paise or 0)}, with {context.open_sales or 0} open or partially paid sales."
    if any(word in message for word in ("client", "customer")):
        return f"This branch currently has {context.active_clients} active clients."
    if any(word in message for word in ("inventory", "stock", "reorder")):
        return f"{context.low_stock_items} active inventory items are at or below their reorder point."
    if matched:
        return f"{matched.name} takes {matched.duration_minutes} minutes and currently costs {format_rupees(matched.price_paise)}. I can prepare a booking draft if you want."
    if any(word in message for word in ("service", "menu", "price", "cost")):
        return service_catalog_reply(payload.candidate_services)
    return "I can use live branch data for appointments, sales, clients, services and low-stock counts. I can also explain service price/duration and prepare a booking draft. Ask for an overview or name the metric you need."


def service_catalog_reply(services: list[ConciergeServiceCandidate]):
    if not services:
        return "No active services are available in this branch yet."
    rows = [f"• {item.name} — {item.duration_minutes} min — {format_rupees(item.price_paise)}" for item in services[:8]]
    return "Current services:\n" + "\n".join(rows)


def format_rupees(paise: int):
    return f"₹{paise // 100}.{abs(paise % 100):02d}"


def migration_key(value: str):
    return "".join(character.casefold() for character in value if character.isalnum())


def migration_mapping_fallback(payload: MigrationMappingRequest):
    target_by_key = {}
    for target in payload.targets:
        for name in [target.field, *target.aliases]:
            target_by_key.setdefault(migration_key(name), target.field)
    suggestions = {}
    used_targets = set()
    for source in payload.source_columns:
        target = target_by_key.get(migration_key(source))
        if target and target not in used_targets:
            suggestions[source] = target
            used_targets.add(target)
    return {
        "entity": payload.entity,
        "source": "python_deterministic",
        "model": "local-mapping-policy-v1",
        "suggestions": suggestions,
        "unmatchedColumns": [column for column in payload.source_columns if column not in suggestions],
    }


def migration_failure_summary(payload: MigrationFailureRequest):
    if payload.failed_chunks:
        return f"{payload.failed_chunks} migration chunks failed"
    if payload.error_rows:
        return f"{payload.error_rows} source rows need correction"
    if payload.last_error:
        return payload.last_error
    return f"Migration job is {payload.status}"


def migration_failure_fallback(payload: MigrationFailureRequest):
    recommendations = []
    error = payload.last_error.casefold()
    if payload.approval_status == "pending":
        recommendations.append("Complete the assigned owner approval before commit")
    if "checksum" in error or "integrity" in error:
        recommendations.append("Stop retrying, verify the source SHA-256 evidence, then restage the affected chunk")
    if "zip" in error or "xlsx" in error or "csv" in error or "source" in error:
        recommendations.append("Correct or re-export the original source file, then upload it as new read-only evidence")
    if payload.error_rows:
        recommendations.append("Export failed rows, correct only those source records, then run a new dry-run")
    if payload.failed_chunks:
        recommendations.append("After the cause is fixed, use retry-failed so completed chunks remain untouched")
    for recommendation in payload.recovery_recommendations:
        if recommendation and recommendation not in recommendations:
            recommendations.append(recommendation)
    if not recommendations:
        recommendations.append("Review the governance proof pack and rollback impact before changing the job")
    return {
        "jobId": payload.job_id,
        "source": "python_deterministic",
        "model": "local-migration-recovery-v1",
        "summary": migration_failure_summary(payload),
        "recommendations": recommendations[:8],
    }


def migration_mapping_json_schema():
    return {
        "type": "json_schema",
        "name": "migration_mapping_suggestions",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "suggestions": {
                    "type": "array",
                    "maxItems": 500,
                    "items": {
                        "type": "object",
                        "properties": {"source": {"type": "string"}, "target": {"type": "string"}},
                        "required": ["source", "target"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["suggestions"],
            "additionalProperties": False,
        },
    }


def migration_failure_json_schema():
    return {
        "type": "json_schema",
        "name": "migration_failure_recommendations",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "recommendations": {"type": "array", "items": {"type": "string"}, "maxItems": 8}
            },
            "required": ["recommendations"],
            "additionalProperties": False,
        },
    }


def concierge_json_schema():
    return {
        "type": "json_schema",
        "name": "salon_concierge_response",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "reply_text": {"type": "string"},
                "intent": {"type": "string", "enum": ["general", "booking", "handoff"]},
                "service_id": {"type": "string"},
                "handoff_required": {"type": "boolean"},
                "safety_flags": {"type": "array", "items": {"type": "string"}, "maxItems": 10},
            },
            "required": ["reply_text", "intent", "service_id", "handoff_required", "safety_flags"],
            "additionalProperties": False,
        },
    }


def extract_response_text(response: dict):
    for output in response.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    raise ValueError("OpenAI response did not contain output text")


def extract_anthropic_text(response: dict):
    for content in response.get("content", []):
        if content.get("type") == "text" and content.get("text"):
            return content["text"]
    raise ValueError("Anthropic response did not contain output text")


def envelope(data):
    return {
        "success": True,
        "data": data,
        "meta": {
            "requestId": str(uuid4()),
            "version": "v1",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }


def error_envelope(message: str):
    return {
        "success": False,
        "error": {"code": "UNAUTHENTICATED", "message": message},
        "meta": {
            "requestId": str(uuid4()),
            "version": "v1",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }
