"""Human-reviewed supplier bill OCR/extraction; this module never writes CRM state."""

import base64
import binascii
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/purchase-bills", tags=["purchase-bills"])

HEADER_FIELDS = [
    "supplier_name", "supplier_gstin", "bill_number", "bill_date", "subtotal_paise",
    "discount_paise", "cgst_paise", "sgst_paise", "igst_paise", "total_paise",
]


class PurchaseBillExtractRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=80)
    branch_id: str = Field(min_length=1, max_length=80)
    file_name: str = Field(min_length=1, max_length=255)
    content_type: Literal["application/pdf", "image/jpeg", "image/png", "image/webp"]
    content_base64: str = Field(min_length=1)


def _envelope(data):
    return {
        "success": True,
        "data": data,
        "meta": {"requestId": str(uuid4()), "version": "v1", "timestamp": datetime.now(UTC).isoformat()},
    }


def _error(message: str):
    return {
        "success": False,
        "error": {"code": "INVALID_DOCUMENT", "message": message},
        "meta": {"requestId": str(uuid4()), "version": "v1", "timestamp": datetime.now(UTC).isoformat()},
    }


def manual_review_result(reason: str):
    return {
        "provider": "manual_review",
        "model_version": "manual-review-v1",
        "supplier_name": "",
        "supplier_gstin": "",
        "bill_number": "",
        "bill_date": "",
        "subtotal_paise": 0,
        "discount_paise": 0,
        "cgst_paise": 0,
        "sgst_paise": 0,
        "igst_paise": 0,
        "total_paise": 0,
        "confidence_bps": 0,
        "warnings": [reason],
        "field_evidence": {
            name: {"confidence_bps": 0, "warnings": ["Human review required"]}
            for name in HEADER_FIELDS
        },
        "lines": [],
    }


def normalize_extraction(value: dict, model: str, provider: str = "openai_responses"):
    value["provider"] = provider
    value["model_version"] = model
    for key in ("subtotal_paise", "discount_paise", "cgst_paise", "sgst_paise", "igst_paise", "total_paise"):
        value[key] = max(0, int(value.get(key, 0)))
    value["confidence_bps"] = max(0, min(10000, int(value.get("confidence_bps", 0))))
    for line in value.get("lines", []):
        for key in (
            "purchase_quantity", "pack_size", "conversion_factor", "quantity", "unit_cost_paise",
            "discount_bps", "discount_paise", "gst_percent", "taxable_paise", "cgst_paise",
            "sgst_paise", "igst_paise", "total_paise", "confidence_bps",
        ):
            line[key] = max(0, int(line.get(key, 0)))
        line["pack_size"] = max(1, line["pack_size"])
        line["conversion_factor"] = max(1, line["conversion_factor"])
        line["discount_bps"] = min(10000, line["discount_bps"])
        line["gst_percent"] = min(100, line["gst_percent"])
        line["confidence_bps"] = min(10000, line["confidence_bps"])
    return value


def purchase_bill_json_schema():
    evidence = {
        "type": "object",
        "properties": {
            "confidence_bps": {"type": "integer", "minimum": 0, "maximum": 10000},
            "warnings": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
        },
        "required": ["confidence_bps", "warnings"],
        "additionalProperties": False,
    }
    line_properties = {
        "raw_name": {"type": "string"}, "supplier_sku": {"type": "string"},
        "hsn_sac": {"type": "string"}, "purchase_quantity": {"type": "integer"},
        "pack_size": {"type": "integer"}, "conversion_factor": {"type": "integer"},
        "quantity": {"type": "integer"}, "unit_cost_paise": {"type": "integer"},
        "discount_bps": {"type": "integer"}, "discount_paise": {"type": "integer"},
        "gst_percent": {"type": "integer"}, "taxable_paise": {"type": "integer"},
        "cgst_paise": {"type": "integer"}, "sgst_paise": {"type": "integer"},
        "igst_paise": {"type": "integer"}, "total_paise": {"type": "integer"},
        "batch_number": {"type": "string"}, "expiry_date": {"type": "string"},
        "confidence_bps": {"type": "integer", "minimum": 0, "maximum": 10000},
        "warnings": {"type": "array", "items": {"type": "string"}, "maxItems": 30},
        "field_evidence": {"type": "object", "additionalProperties": evidence},
    }
    properties = {
        "provider": {"type": "string"}, "model_version": {"type": "string"},
        "supplier_name": {"type": "string"}, "supplier_gstin": {"type": "string"},
        "bill_number": {"type": "string"}, "bill_date": {"type": "string"},
        "subtotal_paise": {"type": "integer"}, "discount_paise": {"type": "integer"},
        "cgst_paise": {"type": "integer"}, "sgst_paise": {"type": "integer"},
        "igst_paise": {"type": "integer"}, "total_paise": {"type": "integer"},
        "confidence_bps": {"type": "integer", "minimum": 0, "maximum": 10000},
        "warnings": {"type": "array", "items": {"type": "string"}, "maxItems": 40},
        "field_evidence": {
            "type": "object", "properties": {name: evidence for name in HEADER_FIELDS},
            "required": HEADER_FIELDS, "additionalProperties": False,
        },
        "lines": {
            "type": "array", "maxItems": 500,
            "items": {"type": "object", "properties": line_properties,
                      "required": list(line_properties), "additionalProperties": False},
        },
    }
    return {
        "type": "json_schema", "name": "purchase_bill_extraction", "strict": True,
        "schema": {"type": "object", "properties": properties,
                   "required": list(properties), "additionalProperties": False},
    }


def _response_text(response: dict):
    for output in response.get("output", []):
        for content in output.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    raise ValueError("OCR response did not contain output text")


EXTRACTION_INSTRUCTIONS = (
    "Extract only visible supplier-invoice facts. Return monetary values as integer paise and dates as YYYY-MM-DD. "
    "Keep purchase quantity, pack size, conversion factor and resulting stock quantity separate. Extract GSTIN, bill "
    "number/date, HSN/SAC, discounts, GST breakup, batch and expiry. Give confidence basis points and validation "
    "warnings for every field. Use empty strings or zero when unreadable; never infer missing facts."
)


async def _extract_openai(payload: PurchaseBillExtractRequest, model: str, api_key: str):
    data_url = f"data:{payload.content_type};base64,{payload.content_base64}"
    document_part = (
        {"type": "input_file", "filename": payload.file_name, "file_data": data_url}
        if payload.content_type == "application/pdf"
        else {"type": "input_image", "image_url": data_url, "detail": "high"}
    )
    request_body = {
        "model": model,
        "instructions": EXTRACTION_INSTRUCTIONS,
        "input": [{"role": "user", "content": [document_part, {
            "type": "input_text", "text": "Extract this purchase bill for mandatory human review."
        }]}],
        "max_output_tokens": 12000,
        "text": {"format": purchase_bill_json_schema()},
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers={"Authorization": f"Bearer {api_key}"},
            json=request_body,
        )
        response.raise_for_status()
    return normalize_extraction(json.loads(_response_text(response.json())), model)


async def _extract_anthropic(payload: PurchaseBillExtractRequest, model: str, api_key: str):
    source = {
        "type": "base64",
        "media_type": payload.content_type,
        "data": payload.content_base64,
    }
    document_part = (
        {"type": "document", "source": source}
        if payload.content_type == "application/pdf"
        else {"type": "image", "source": source}
    )
    schema = purchase_bill_json_schema()["schema"]
    request_body = {
        "model": model,
        "max_tokens": 12000,
        "system": EXTRACTION_INSTRUCTIONS,
        "messages": [{"role": "user", "content": [document_part, {
            "type": "text", "text": "Extract this purchase bill for mandatory human review."
        }]}],
        "tools": [{
            "name": "return_purchase_bill",
            "description": "Return the structured visible purchase bill facts",
            "input_schema": schema,
        }],
        "tool_choice": {"type": "tool", "name": "return_purchase_bill"},
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=request_body,
        )
        response.raise_for_status()
    for block in response.json().get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "return_purchase_bill":
            return normalize_extraction(block["input"], model, "anthropic_messages")
    raise ValueError("Claude extraction did not return structured bill data")


def _money_to_paise(value: str) -> int:
    cleaned = re.sub(r"[^0-9.]", "", value.replace(",", ""))
    if not cleaned:
        return 0
    return max(0, round(float(cleaned) * 100))


def _visible_date(value: str) -> str:
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            continue
    return value


def parse_local_ocr(text: str):
    result = manual_review_result("Local OCR requires human verification")
    result["provider"] = "local_ocr"
    result["model_version"] = "local-ocr-v1"
    nonempty = [line.strip() for line in text.splitlines() if line.strip()]
    result["supplier_name"] = nonempty[0][:200] if nonempty else ""
    patterns = {
        "supplier_gstin": r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b",
        "bill_number": r"(?:invoice|bill)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)",
        "bill_date": r"(?:invoice|bill)?\s*date\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}|\d{4}-\d{2}-\d{2})",
    }
    for field, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            extracted = match.group(1)
            result[field] = extracted.upper() if field == "supplier_gstin" else _visible_date(extracted) if field == "bill_date" else extracted
            result["field_evidence"][field] = {"confidence_bps": 6500, "warnings": []}
    total_matches = re.findall(r"(?:grand\s+total|invoice\s+total|amount\s+payable|net\s+amount)\s*[:₹Rs.\-]*\s*([0-9,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if total_matches:
        result["total_paise"] = _money_to_paise(total_matches[-1])
        result["field_evidence"]["total_paise"] = {"confidence_bps": 6000, "warnings": []}
    result["confidence_bps"] = 4500 if any(result[field] for field in ("supplier_gstin", "bill_number", "bill_date")) else 2000
    return result


def _local_ocr(document: bytes, payload: PurchaseBillExtractRequest):
    suffix = Path(payload.file_name).suffix or (".pdf" if payload.content_type == "application/pdf" else ".img")
    configured = os.getenv("PDFTOTEXT_COMMAND" if payload.content_type == "application/pdf" else "TESSERACT_COMMAND", "").strip()
    executable = configured or shutil.which("pdftotext" if payload.content_type == "application/pdf" else "tesseract")
    if not executable:
        return manual_review_result("Local OCR binary is not installed; human review required")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(document)
        source_path = handle.name
    try:
        command = [executable, source_path, "-"] if payload.content_type == "application/pdf" else [executable, source_path, "stdout"]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=40, check=True)
        return parse_local_ocr(completed.stdout)
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return manual_review_result("Local OCR failed; human review required")
    finally:
        Path(source_path).unlink(missing_ok=True)


@router.post("/extract")
async def extract_purchase_bill(payload: PurchaseBillExtractRequest):
    try:
        document = base64.b64decode(payload.content_base64, validate=True)
    except (binascii.Error, ValueError):
        return JSONResponse(status_code=422, content=_error("invalid base64 document"))
    if not document or len(document) > 10 * 1024 * 1024:
        return JSONResponse(status_code=413, content=_error("document must be between 1 byte and 10 MB"))

    provider = os.getenv("AI_PROVIDER", "local").strip().lower()
    if provider == "local":
        return _envelope(_local_ocr(document, payload))
    try:
        if provider == "anthropic":
            api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
            if not api_key:
                return _envelope(manual_review_result("ANTHROPIC_API_KEY is not configured; human review required"))
            model = os.getenv("ANTHROPIC_DOCUMENT_MODEL", "claude-sonnet-4-5-20250929").strip()
            return _envelope(await _extract_anthropic(payload, model, api_key))
        if provider != "openai":
            return _envelope(manual_review_result("OCR provider is not configured; human review required"))
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            return _envelope(manual_review_result("OPENAI_API_KEY is not configured; human review required"))
        model = os.getenv("OPENAI_DOCUMENT_MODEL", os.getenv("OPENAI_MODEL", "gpt-5.4-mini")).strip() or "gpt-5.4-mini"
        try:
            return _envelope(await _extract_openai(payload, model, api_key))
        except (httpx.HTTPError, ValueError, KeyError, json.JSONDecodeError):
            fallback_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
            if os.getenv("AI_DOCUMENT_FALLBACK", "").strip().lower() != "anthropic" or not fallback_key:
                raise
            fallback_model = os.getenv("ANTHROPIC_DOCUMENT_MODEL", "claude-sonnet-4-5-20250929").strip()
            return _envelope(await _extract_anthropic(payload, fallback_model, fallback_key))
    except (httpx.HTTPError, ValueError, KeyError, json.JSONDecodeError):
        return _envelope(manual_review_result("OCR extraction failed; human review required"))
