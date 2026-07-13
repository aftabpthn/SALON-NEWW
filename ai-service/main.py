import hmac
import os
from datetime import UTC, datetime
from statistics import mean
from uuid import uuid4

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
