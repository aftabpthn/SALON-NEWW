"""Deterministic staff risk signals. Python advises; Rust remains authoritative."""

import base64
import binascii
import os
import re
from collections import defaultdict
from datetime import UTC, date, datetime
from statistics import median
from uuid import uuid4

import httpx
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

router = APIRouter(prefix="/api/v1/staff-ai", tags=["staff-ai"])


class Scope(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=120)
    branch_id: str = Field(min_length=1, max_length=120)
    period_start: date
    period_end: date

    @model_validator(mode="after")
    def validate_period(self):
        days = (self.period_end - self.period_start).days
        if not 0 <= days <= 31:
            raise ValueError("staff AI period must contain 1 to 32 days")
        return self


class AttendanceFact(BaseModel):
    staff_id: str
    staff_name: str = ""
    business_date: date
    raw_status: str = ""
    manual_status: str = ""
    source: str = ""
    clock_in_at: datetime | None = None
    clock_out_at: datetime | None = None
    worked_minutes: int = 0
    late_minutes: int = 0
    overtime_minutes: int = 0
    correction_reason: str = ""


class AttendanceRequest(Scope):
    records: list[AttendanceFact] = Field(default_factory=list, max_length=5000)


class BiometricFact(BaseModel):
    staff_id: str = ""
    staff_name: str = ""
    external_user_id: str = ""
    device_id: str = ""
    punch_type: str = ""
    punch_at: datetime
    status: str = ""
    rejection_reason: str = ""


class BuddyPunchingRequest(Scope):
    events: list[BiometricFact] = Field(default_factory=list, max_length=5000)


class PerformanceFact(BaseModel):
    staff_id: str
    staff_name: str = ""
    appointments_count: int = 0
    completed_appointments: int = 0
    present_days: int = 0
    absent_days: int = 0
    overtime_minutes: int = 0
    late_minutes: int = 0
    operation_task_completed: int = 0
    operation_task_missed: int = 0


class AttritionRequest(Scope):
    staff: list[PerformanceFact] = Field(default_factory=list, max_length=1000)


class CommissionFact(BaseModel):
    staff_id: str
    staff_name: str = ""
    sale_count: int = 0
    line_count: int = 0
    base_paise: int = 0
    commission_paise: int = 0


class CommissionRequest(Scope):
    staff: list[CommissionFact] = Field(default_factory=list, max_length=1000)


class RosterFact(BaseModel):
    staff_id: str
    staff_name: str = ""
    schedule_date: date
    existing_status: str = ""
    approved_leave: bool = False
    appointments_count: int = 0
    appointment_minutes: int = 0


class RosterCoverage(BaseModel):
    active_staff: int = 0
    scheduled_staff_days: int = 0
    scheduled_minutes: int = 0
    appointment_minutes: int = 0
    uncovered_appointments: int = 0


class RosterRequest(Scope):
    rows: list[RosterFact] = Field(default_factory=list, max_length=5000)
    coverage: RosterCoverage


def _error_envelope(message: str):
    """Local copy of main's error shape; importing it would be circular because
    main imports this router."""
    return {
        "success": False,
        "error": {"message": message},
        "meta": {
            "requestId": str(uuid4()),
            "version": "v1",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }


def _envelope(data):
    return {
        "success": True,
        "data": data,
        "meta": {
            "requestId": str(uuid4()),
            "version": "v1",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }


def _result(payload: Scope, kind: str, signals: list[dict]):
    return {
        "kind": kind,
        "source": "python_deterministic",
        "modelVersion": "staff-signals-v1",
        "periodStart": payload.period_start.isoformat(),
        "periodEnd": payload.period_end.isoformat(),
        "humanReviewOnly": True,
        "signalCount": len(signals),
        "signals": signals,
    }


def _severity(score: int):
    return "high" if score >= 75 else "medium" if score >= 45 else "low"


@router.post("/attendance-anomalies")
def attendance_anomalies(payload: AttendanceRequest):
    signals = []
    for row in payload.records:
        score = 0
        evidence = []
        if bool(row.clock_in_at) != bool(row.clock_out_at):
            score += 45
            evidence.append("Clock-in and clock-out are incomplete")
        if row.worked_minutes > 16 * 60:
            score += 50
            evidence.append("Worked duration exceeds 16 hours")
        if row.late_minutes >= 120:
            score += 25
            evidence.append("Late duration is at least 120 minutes")
        if row.overtime_minutes >= 240:
            score += 25
            evidence.append("Overtime duration is at least 240 minutes")
        if row.manual_status and row.manual_status != row.raw_status:
            score += 20
            evidence.append("Manual status differs from captured status")
        if row.correction_reason:
            score += 10
            evidence.append("Attendance record was corrected")
        if score:
            signals.append({
                "staffId": row.staff_id,
                "staffName": row.staff_name,
                "businessDate": row.business_date.isoformat(),
                "score": min(score, 100),
                "severity": _severity(score),
                "evidence": evidence,
            })
    signals.sort(key=lambda item: (-item["score"], item["businessDate"], item["staffId"]))
    return _envelope(_result(payload, "attendance_anomaly", signals[:200]))


@router.post("/buddy-punching-signals")
def buddy_punching_signals(payload: BuddyPunchingRequest):
    external_staff: dict[str, set[str]] = defaultdict(set)
    staff_external: dict[str, set[str]] = defaultdict(set)
    staff_events: dict[str, list[BiometricFact]] = defaultdict(list)
    names = {}
    signals = []
    for event in payload.events:
        if event.staff_id:
            external_staff[event.external_user_id].add(event.staff_id)
            staff_external[event.staff_id].add(event.external_user_id)
            staff_events[event.staff_id].append(event)
            names[event.staff_id] = event.staff_name
        elif event.status in {"ignored", "rejected"}:
            signals.append({
                "staffId": "",
                "staffName": "Unmapped biometric identity",
                "score": 55,
                "severity": "medium",
                "evidence": [event.rejection_reason or "Biometric punch could not be mapped"],
            })
    for staff_ids in external_staff.values():
        if len(staff_ids) > 1:
            for staff_id in sorted(staff_ids):
                signals.append({
                    "staffId": staff_id,
                    "staffName": names.get(staff_id, ""),
                    "score": 80,
                    "severity": "high",
                    "evidence": ["One biometric identity resolved to multiple staff records"],
                })
    for staff_id, identities in staff_external.items():
        if len(identities) > 1:
            signals.append({
                "staffId": staff_id,
                "staffName": names.get(staff_id, ""),
                "score": 45,
                "severity": "medium",
                "evidence": ["Staff punches used multiple biometric identities; verify enrollment"],
            })
    for staff_id, events in staff_events.items():
        ordered = sorted(events, key=lambda item: item.punch_at)
        if any(
            current.device_id != previous.device_id
            and abs((current.punch_at - previous.punch_at).total_seconds()) <= 120
            for previous, current in zip(ordered, ordered[1:])
        ):
            signals.append({
                "staffId": staff_id,
                "staffName": names.get(staff_id, ""),
                "score": 65,
                "severity": "medium",
                "evidence": ["Punches appeared on different devices within two minutes"],
            })
    unique = {(item["staffId"], tuple(item["evidence"])): item for item in signals}
    ranked = sorted(unique.values(), key=lambda item: (-item["score"], item["staffId"]))
    result = _result(payload, "buddy_punching_review_signal", ranked[:200])
    result["disclaimer"] = "Signals require manager review and are not proof of buddy punching."
    return _envelope(result)


@router.post("/attrition-risk")
def attrition_risk(payload: AttritionRequest):
    signals = []
    for row in payload.staff:
        score = 0
        evidence = []
        attendance_days = row.present_days + row.absent_days
        if attendance_days and row.absent_days * 100 // attendance_days >= 20:
            score += 35
            evidence.append("Absence ratio is at least 20 percent")
        if row.late_minutes >= 180:
            score += 20
            evidence.append("Late minutes are elevated for the period")
        if row.overtime_minutes >= 600:
            score += 20
            evidence.append("Sustained overtime may need a workload review")
        if row.operation_task_missed > row.operation_task_completed and row.operation_task_missed:
            score += 15
            evidence.append("Missed operational tasks exceed completed tasks")
        if row.appointments_count >= 3 and row.completed_appointments * 100 // row.appointments_count < 70:
            score += 20
            evidence.append("Appointment completion is below 70 percent")
        if score >= 25:
            signals.append({
                "staffId": row.staff_id,
                "staffName": row.staff_name,
                "score": min(score, 100),
                "severity": _severity(score),
                "evidence": evidence,
                "recommendedAction": "Manager check-in and workload review",
            })
    signals.sort(key=lambda item: (-item["score"], item["staffId"]))
    result = _result(payload, "retention_review", signals[:200])
    result["decisionPolicy"] = "Do not use this signal for termination, pay, or disciplinary decisions."
    return _envelope(result)


@router.post("/commission-anomalies")
def commission_anomalies(payload: CommissionRequest):
    rates = [row.commission_paise * 10_000 // row.base_paise for row in payload.staff if row.base_paise > 0]
    peer_rate = int(median(rates)) if rates else 0
    threshold = peer_rate + max(1000, peer_rate // 2)
    signals = []
    for row in payload.staff:
        rate = row.commission_paise * 10_000 // row.base_paise if row.base_paise > 0 else 0
        evidence = []
        score = 0
        if row.commission_paise > 0 and row.base_paise == 0:
            score = 90
            evidence.append("Commission exists without an eligible base amount")
        elif row.line_count >= 3 and rate > threshold:
            score = min(85, 45 + max(0, rate - threshold) // 100)
            evidence.append("Commission rate is materially above the peer median")
        if rate > 10_000:
            score = max(score, 95)
            evidence.append("Commission exceeds the eligible base amount")
        if score:
            signals.append({
                "staffId": row.staff_id,
                "staffName": row.staff_name,
                "score": score,
                "severity": _severity(score),
                "commissionRateBps": rate,
                "peerMedianRateBps": peer_rate,
                "evidence": evidence,
            })
    signals.sort(key=lambda item: (-item["score"], item["staffId"]))
    return _envelope(_result(payload, "commission_anomaly", signals[:200]))


@router.post("/roster-recommendations")
def roster_recommendations(payload: RosterRequest):
    signals = []
    if payload.coverage.uncovered_appointments:
        signals.append({
            "staffId": "",
            "staffName": "Branch coverage",
            "score": 80,
            "severity": "high",
            "evidence": [f"{payload.coverage.uncovered_appointments} appointments are not covered by a working schedule"],
            "recommendedAction": "Review uncovered appointments before publishing the roster",
        })
    for row in payload.rows:
        evidence = []
        score = 0
        if row.approved_leave and row.appointments_count:
            score = 90
            evidence.append("Appointments overlap approved leave")
        elif row.appointments_count and row.existing_status != "working":
            score = 65
            evidence.append("Booked appointments do not have a working roster status")
        if score:
            signals.append({
                "staffId": row.staff_id,
                "staffName": row.staff_name,
                "scheduleDate": row.schedule_date.isoformat(),
                "score": score,
                "severity": _severity(score),
                "evidence": evidence,
                "recommendedAction": "Use the Rust roster optimizer, then manager-review the draft",
            })
    signals.sort(key=lambda item: (-item["score"], item.get("scheduleDate", ""), item["staffId"]))
    result = _result(payload, "roster_recommendation", signals[:200])
    result["writeAuthority"] = "rust_roster_optimizer_and_manager_approval"
    return _envelope(result)


# --- AI Scribe transcription -------------------------------------------------
#
# The Rust backend owns consent, retention and the form submission; this
# endpoint only turns audio into text and proposes field values. It holds the
# audio for the duration of the call and returns nothing that identifies the
# guest beyond what they said.
#
# When no transcription provider is configured this returns 503 rather than a
# plausible-looking transcript. A fabricated clinical note is worse than no
# note, and the repository rule against invented data is at its most important
# here.


class ScribeFormField(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    label: str = ""
    type: str = "text"


class ScribeTranscribeRequest(BaseModel):
    audio_base64: str = Field(alias="audioBase64", min_length=1)
    language_code: str = Field(alias="languageCode", default="en-IN", max_length=16)
    content_type: str = Field(alias="contentType", default="application/octet-stream", max_length=120)
    duration_seconds: int = Field(alias="durationSeconds", default=0, ge=0, le=5700)
    form_fields: list[ScribeFormField] = Field(alias="formFields", default_factory=list)

    model_config = {"populate_by_name": True}


def _scribe_suggestions(transcript: str, fields: list[ScribeFormField]) -> list[dict]:
    """Maps transcript sentences onto form fields by label mention.

    Deliberately conservative: a field is only proposed when its own label or
    key is spoken, and the sentence that triggered it travels with the
    suggestion as evidence. A staff member reviews every value before it is
    submitted, so a missed field costs a moment of typing while an invented one
    would land in a clinical record.
    """
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", transcript) if part.strip()]
    suggestions = []
    for field in fields:
        needles = {word for word in re.split(r"[^a-z0-9]+", f"{field.label} {field.key}".lower()) if len(word) > 3}
        if not needles:
            continue
        for sentence in sentences:
            lowered = sentence.lower()
            if any(needle in lowered for needle in needles):
                suggestions.append({
                    "fieldKey": field.key,
                    "label": field.label or field.key,
                    "value": sentence,
                    "evidence": sentence,
                    "confidence": "mentioned",
                })
                break
    return suggestions


@router.post("/scribe/transcribe")
async def scribe_transcribe(payload: ScribeTranscribeRequest):
    provider = os.getenv("SCRIBE_PROVIDER", "").strip().lower()
    if provider not in {"openai"}:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_error_envelope(
                "SCRIBE_PROVIDER_NOT_CONFIGURED: set SCRIBE_PROVIDER and its credentials"
            ),
        )
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_error_envelope("SCRIBE_PROVIDER_NOT_CONFIGURED: OPENAI_API_KEY is missing"),
        )

    try:
        audio = base64.b64decode(payload.audio_base64, validate=True)
    except (ValueError, binascii.Error):
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=_error_envelope("audio payload is not valid base64"),
        )

    model = os.getenv("SCRIBE_MODEL", "whisper-1")
    try:
        async with httpx.AsyncClient(timeout=110.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": ("recording", audio, payload.content_type)},
                data={"model": model, "language": payload.language_code.split("-")[0]},
            )
    except httpx.HTTPError:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_error_envelope("transcription provider could not be reached"),
        )
    if response.status_code >= 400:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_error_envelope(f"transcription provider returned HTTP {response.status_code}"),
        )

    transcript = str(response.json().get("text", "")).strip()
    suggestions = _scribe_suggestions(transcript, payload.form_fields)
    return _envelope({
        "transcript": transcript,
        "provider": provider,
        "model": model,
        "summary": {
            "wordCount": len(transcript.split()),
            "durationSeconds": payload.duration_seconds,
            "suggestedFieldCount": len(suggestions),
        },
        "suggestions": suggestions,
    })
