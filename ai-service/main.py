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

app = FastAPI(title="AuraShine AI Service", version="0.2.0")


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


class ProfitCopilotCandidate(BaseModel):
    kind: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=500)
    impact_paise: int = Field(ge=0)
    source_type: str = Field(min_length=1, max_length=80)
    source_id: str = Field(min_length=1, max_length=180)


class ProfitCopilotRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_ids: list[str] = Field(min_length=1, max_length=500)
    from_date: str = Field(min_length=10, max_length=10)
    to_date: str = Field(min_length=10, max_length=10)
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


class ConciergeRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    channel: Literal["web", "whatsapp", "voice"]
    locale: str = Field(default="en-IN", max_length=20)
    message: str = Field(min_length=1, max_length=4000)
    recent_messages: list[ConciergeTurn] = Field(default_factory=list, max_length=20)
    candidate_services: list[ConciergeServiceCandidate] = Field(default_factory=list, max_length=100)
    governance: ConciergeGovernance = Field(default_factory=ConciergeGovernance)


class ConciergeModelOutput(BaseModel):
    reply_text: str = Field(min_length=1, max_length=1200)
    intent: Literal["general", "booking", "handoff"]
    service_id: str = Field(default="", max_length=120)
    handoff_required: bool = False
    safety_flags: list[str] = Field(default_factory=list, max_length=10)


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
            "You are a salon profitability copilot. Rank and rewrite only the supplied "
            "real-data candidates into concise operational actions. Never invent money, "
            "entities, causes, or source identifiers. Return source fields and kind exactly "
            "as supplied. Prefer the highest recorded impact and avoid duplicates."
        ),
        "input": json.dumps(
            {
                "period": {"from": payload.from_date, "to": payload.to_date},
                "branchCount": len(payload.branch_ids),
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
    if os.getenv("AI_PROVIDER", "local").strip().lower() != "openai":
        return envelope(fallback)
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return envelope(fallback)
    model = os.getenv("OPENAI_MODEL", "gpt-5.4-mini").strip() or "gpt-5.4-mini"
    request_body = {
        "model": model,
        "instructions": (
            "You are an enterprise salon receptionist. Use only the supplied service catalog and "
            "conversation. Never invent availability, price, policy, staff, client, or booking IDs. "
            "Never provide medical advice or expose sensitive data. A booking is only a draft until "
            "the CRM confirms it; do not claim confirmation. Escalate ambiguity, complaints, payments, "
            "medical questions, cancellations, or unsupported requests to a human. Keep replies concise."
        ),
        "input": json.dumps(
            {
                "channel": payload.channel,
                "locale": payload.locale,
                "message": payload.message,
                "recentMessages": [item.model_dump() for item in payload.recent_messages],
                "candidateServices": [item.model_dump() for item in payload.candidate_services],
                "governance": payload.governance.model_dump(),
            },
            separators=(",", ":"),
        ),
        "max_output_tokens": 900,
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
    handoff = any(word in normalized for word in ("complaint", "refund", "cancel", "allergy", "medical", "doctor", "payment"))
    booking = any(word in normalized for word in ("book", "appointment", "slot", "schedule"))
    matched = next((item for item in payload.candidate_services if item.name.casefold() in normalized), None)
    if handoff:
        reply = "I will hand this request to the salon team for a safe follow-up."
        intent = "handoff"
    elif booking and matched:
        reply = f"I found {matched.name}. Please continue to the secure booking flow to choose and confirm an available time."
        intent = "booking"
    elif booking:
        reply = "Which service would you like to book? I will use the salon's current service list."
        intent = "booking"
    else:
        reply = "I can help with services and booking, or hand your request to the salon team."
        intent = "general"
    return {
        "source": "python_deterministic",
        "model": "local-reception-policy-v1",
        "promptVersion": payload.governance.prompt_version,
        "replyText": reply,
        "intent": intent,
        "serviceId": matched.id if matched else "",
        "handoffRequired": handoff,
        "safetyFlags": ["human_handoff"] if handoff else [],
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
