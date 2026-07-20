"""Human-reviewed supplier bill OCR/extraction; this module never writes CRM state."""

import base64
import binascii
import json
import os
from datetime import UTC, datetime
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


def normalize_extraction(value: dict, model: str):
    value["provider"] = "openai_responses"
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


@router.post("/extract")
async def extract_purchase_bill(payload: PurchaseBillExtractRequest):
    try:
        document = base64.b64decode(payload.content_base64, validate=True)
    except (binascii.Error, ValueError):
        return JSONResponse(status_code=422, content=_error("invalid base64 document"))
    if not document or len(document) > 10 * 1024 * 1024:
        return JSONResponse(status_code=413, content=_error("document must be between 1 byte and 10 MB"))

    if os.getenv("AI_PROVIDER", "local").strip().lower() != "openai":
        return _envelope(manual_review_result("OCR provider is not configured; human review required"))
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return _envelope(manual_review_result("OPENAI_API_KEY is not configured; human review required"))

    model = os.getenv("OPENAI_DOCUMENT_MODEL", os.getenv("OPENAI_MODEL", "gpt-5.4-mini")).strip() or "gpt-5.4-mini"
    data_url = f"data:{payload.content_type};base64,{payload.content_base64}"
    document_part = (
        {"type": "input_file", "filename": payload.file_name, "file_data": data_url}
        if payload.content_type == "application/pdf"
        else {"type": "input_image", "image_url": data_url, "detail": "high"}
    )
    request_body = {
        "model": model,
        "instructions": (
            "Extract only visible supplier-invoice facts. Return monetary values as integer paise and dates as YYYY-MM-DD. "
            "Keep purchase quantity, pack size, conversion factor and resulting stock quantity separate. Extract GSTIN, bill "
            "number/date, HSN/SAC, discounts, GST breakup, batch and expiry. Give confidence basis points and validation "
            "warnings for every field. Use empty strings or zero when unreadable; never infer missing facts."
        ),
        "input": [{"role": "user", "content": [document_part, {
            "type": "input_text", "text": "Extract this purchase bill for mandatory human review."
        }]}],
        "max_output_tokens": 12000,
        "text": {"format": purchase_bill_json_schema()},
    }
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}"},
                json=request_body,
            )
            response.raise_for_status()
        parsed = json.loads(_response_text(response.json()))
        return _envelope(normalize_extraction(parsed, model))
    except (httpx.HTTPError, ValueError, KeyError, json.JSONDecodeError):
        return _envelope(manual_review_result("OCR extraction failed; human review required"))
