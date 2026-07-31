"""Human-reviewed supplier bill OCR/extraction; this module never writes CRM state."""

import base64
import binascii
import hashlib
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
    "supplier_name", "supplier_gstin", "supplier_phone", "supplier_email", "supplier_address",
    "bill_number", "bill_date", "subtotal_paise",
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
        "supplier_phone": "",
        "supplier_email": "",
        "supplier_address": "",
        "bill_contract": {
            "buyerName": "", "buyerGstin": "", "buyerAddress": "", "consigneeName": "",
            "consigneeGstin": "", "consigneeAddress": "", "poNumber": "", "challanNumber": "",
            "paymentTerms": "", "dueDate": "", "freightPaise": 0, "handlingPaise": 0,
            "otherChargesPaise": 0, "roundOffPaise": 0, "receivedDate": "",
            "currency": "INR", "documentType": "", "sourcePaymentStatus": "",
            "sourceStatus": "", "supplierCode": "", "pageCount": 1,
            "pageNumber": 0, "carryForwardPaise": 0, "layoutFingerprint": "",
            "imageQualityScoreBps": 0, "qualityWarnings": [],
        },
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
            name: {
                "confidence_bps": 0, "warnings": ["Human review required"],
                "original_value": "", "transformed_value": "",
            }
            for name in HEADER_FIELDS
        },
        "lines": [],
    }


def normalize_extraction(value: dict, model: str, provider: str = "openai_responses"):
    value["provider"] = provider
    value["model_version"] = model
    for key in ("supplier_name", "supplier_gstin", "supplier_phone", "supplier_email", "supplier_address", "bill_number", "bill_date"):
        value[key] = str(value.get(key, "") or "")
    for key in ("subtotal_paise", "discount_paise", "cgst_paise", "sgst_paise", "igst_paise", "total_paise"):
        value[key] = max(0, int(value.get(key, 0)))
    value["confidence_bps"] = max(0, min(10000, int(value.get("confidence_bps", 0))))
    value["bill_contract"] = value.get("bill_contract") if isinstance(value.get("bill_contract"), dict) else {}
    value["bill_contract"]["pageNumber"] = max(0, int(value["bill_contract"].get("pageNumber", 0)))
    value["bill_contract"]["carryForwardPaise"] = max(0, int(value["bill_contract"].get("carryForwardPaise", 0)))
    value["bill_contract"]["layoutFingerprint"] = re.sub(r"[^A-Za-z0-9_-]", "", str(value["bill_contract"].get("layoutFingerprint", "") or ""))[:64]
    for line in value.get("lines", []):
        line["product_contract"] = line.get("product_contract") if isinstance(line.get("product_contract"), dict) else {}
        for key in ("raw_name", "supplier_sku", "category", "brand", "barcode", "unit", "package_unit", "hsn_sac", "batch_number", "expiry_date"):
            line[key] = str(line.get(key, "") or "")
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
            "original_value": {"type": "string"},
            "transformed_value": {"type": "string"},
        },
        "required": ["confidence_bps", "warnings", "original_value", "transformed_value"],
        "additionalProperties": False,
    }
    bill_contract_properties = {
        **{key: {"type": "string"} for key in (
            "buyerName", "buyerGstin", "buyerAddress", "consigneeName", "consigneeGstin",
            "consigneeAddress", "poNumber", "challanNumber", "paymentTerms", "dueDate",
            "receivedDate", "currency", "documentType", "sourcePaymentStatus", "sourceStatus",
            "supplierCode", "layoutFingerprint",
        )},
        **{key: {"type": "integer"} for key in (
            "freightPaise", "handlingPaise", "otherChargesPaise", "roundOffPaise",
            "pageCount", "pageNumber", "carryForwardPaise", "imageQualityScoreBps",
        )},
        "qualityWarnings": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
    }
    product_contract_properties = {
        **{key: {"type": "string"} for key in (
            "barcode", "brand", "category", "purchaseUnit", "stockUnit", "manufactureDate",
            "vendorCatalogCode", "size", "shade", "color", "mappingDecision",
        )},
        **{key: {"type": "integer"} for key in (
            "mrpPaise", "freeQuantity", "acceptedQuantity", "damagedQuantity", "rejectedQuantity",
        )},
    }
    line_properties = {
        "raw_name": {"type": "string"}, "supplier_sku": {"type": "string"},
        "category": {"type": "string"}, "brand": {"type": "string"},
        "barcode": {"type": "string"}, "unit": {"type": "string"},
        "package_unit": {"type": "string"},
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
        "product_contract": {"type": "object", "properties": product_contract_properties, "required": list(product_contract_properties), "additionalProperties": False},
    }
    properties = {
        "provider": {"type": "string"}, "model_version": {"type": "string"},
        "supplier_name": {"type": "string"}, "supplier_gstin": {"type": "string"},
        "supplier_phone": {"type": "string"}, "supplier_email": {"type": "string"},
        "supplier_address": {"type": "string"},
        "bill_contract": {"type": "object", "properties": bill_contract_properties, "required": list(bill_contract_properties), "additionalProperties": False},
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
    "Keep purchase quantity, pack size, conversion factor and resulting stock quantity separate. Extract supplier phone, "
    "email and address plus GSTIN, bill number/date, product category, brand, barcode, unit, package unit, HSN/SAC, "
    "discounts, GST breakup, batch, manufacture and expiry; separately classify vendor/supplier, buyer and consignee. "
    "Extract PO/challan, payment terms/due date, freight, handling, other charges and signed round-off. Give confidence basis points and validation "
    "warnings for every field, preserving the visible original value and normalized transformed value. Classify purchase bill, credit note, "
    "purchase return, cancelled bill, or revised invoice; capture received date, currency, source paid/unpaid status, page count, visible page number, visible carry-forward total and a short structural layout fingerprint. "
    "Use empty strings or zero when unreadable; never infer missing tax, quantity, dates, product attributes, or payment facts."
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


def _signed_money_to_paise(value: str) -> int:
    cleaned = re.sub(r"[^0-9.\-]", "", value.replace(",", ""))
    return round(float(cleaned) * 100) if cleaned not in ("", "-") else 0


def _visible_date(value: str) -> str:
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            continue
    return value


def _apply_grouping_signals(result: dict, text: str):
    contract = result["bill_contract"]
    page = re.search(r"\b(?:page|pg)\s*(\d+)\s*(?:of|/)\s*(\d+)\b", text, re.IGNORECASE)
    contract["pageNumber"] = int(page.group(1)) if page else 0
    if page:
        contract["pageCount"] = max(1, int(page.group(2)))
    carry = re.search(r"\b(?:brought|carried)\s+forward(?:\s+total)?\s*[:₹Rs.\-]*\s*([0-9,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    contract["carryForwardPaise"] = _money_to_paise(carry.group(1)) if carry else 0
    shapes = []
    for line in text.splitlines():
        line = " ".join(line.split())
        if line:
            shapes.append(re.sub(r"\d+", "#", re.sub(r"[A-Za-z]+", "A", line))[:160])
    contract["layoutFingerprint"] = hashlib.sha256("\n".join(shapes[:80]).encode()).hexdigest()[:16] if shapes else ""
    return result


def parse_local_ocr(text: str):
    result = manual_review_result("Local OCR requires human verification")
    result["provider"] = "local_ocr"
    result["model_version"] = "local-ocr-v1"
    nonempty = [line.strip() for line in text.splitlines() if line.strip()]
    result["supplier_name"] = nonempty[0][:200] if nonempty else ""
    patterns = {
        "supplier_gstin": r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b",
        "supplier_phone": r"(?:phone|mobile|tel(?:ephone)?)\s*[:\-]?\s*(\+?[0-9][0-9 ()\-]{7,18})",
        "supplier_email": r"\b([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})\b",
        "supplier_address": r"(?:address|registered\s+office)\s*[:\-]\s*([^\r\n]{5,300})",
        "bill_number": r"\b(?:invoice|bill)\b\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\-/]+)",
        "bill_date": r"(?:\b(?:invoice|bill)\b\s*)?date\s*[:\-]?\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}|\d{4}-\d{2}-\d{2})",
    }
    for field, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            extracted = match.group(1)
            result[field] = extracted.upper() if field == "supplier_gstin" else _visible_date(extracted) if field == "bill_date" else extracted.strip()
            result["field_evidence"][field] = {"confidence_bps": 6500, "warnings": []}
    total_matches = re.findall(r"(?:grand\s+total|invoice\s+total|amount\s+payable|net\s+amount)\s*[:₹Rs.\-]*\s*([0-9,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if total_matches:
        result["total_paise"] = _money_to_paise(total_matches[-1])
        result["field_evidence"]["total_paise"] = {"confidence_bps": 6000, "warnings": []}
    turquoise = _parse_turquoise(text)
    if turquoise:
        return _apply_grouping_signals(turquoise, text)
    result["confidence_bps"] = 4500 if any(result[field] for field in ("supplier_gstin", "bill_number", "bill_date")) else 2000
    return _apply_grouping_signals(result, text)


def _parse_turquoise(text: str):
    """Parse the known text-layer layout without guessing unreadable fields."""
    if not re.search(r"TURQUOISE\s+WELLNESS", text, re.IGNORECASE):
        return None
    result = manual_review_result("Local text extraction requires human verification")
    result.update({"provider": "local_text", "model_version": "turquoise-v1", "supplier_name": "TURQUOISE WELLNESS"})
    result["field_evidence"]["supplier_name"] = {"confidence_bps": 10000, "warnings": []}
    for field, pattern in {
        "supplier_gstin": r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b",
        "supplier_phone": r"(?:Mob\.?|Mobile|Phone|Tel(?:e)?)\s*\.?\s*:\s*([+0-9 /-]{8,})",
        "supplier_email": r"\bEmail\s*:\s*([^\s,;]+)",
        "bill_number": r"\binvoice\s*no\.?\s*[:\-]\s*([A-Z0-9\-/]+)",
        "bill_date": r"\bdate\.?\s*[:\-]\s*(\d{1,2}[\-/]\d{1,2}[\-/]\d{2,4}|\d{4}-\d{2}-\d{2})",
    }.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            result[field] = value.upper() if field == "supplier_gstin" else _visible_date(value) if field == "bill_date" else value
            result["field_evidence"][field] = {"confidence_bps": 9000, "warnings": []}
    address = re.search(r"TURQUOISE\s+WELLNESS\s*\n([^\n]+(?:\n(?!.*(?:invoice|GSTIN|phone|mobile|email))[^\n]+)?)", text, re.IGNORECASE)
    if address:
        result["supplier_address"] = " ".join(address.group(1).split())[:1000]
        result["field_evidence"]["supplier_address"] = {"confidence_bps": 8000, "warnings": []}
    lines = text.splitlines()
    party_start = next((index for index, line in enumerate(lines) if re.match(r"\s*M/s\.", line, re.IGNORECASE)), -1)
    party_end = next((index for index, line in enumerate(lines) if index > party_start and re.match(r"\s*State\s+Code", line, re.IGNORECASE)), -1)
    if party_start >= 0 and party_end > party_start + 1:
        columns = [[part.strip() for part in re.split(r"\s{2,}", line.strip()) if part.strip()] for line in lines[party_start + 1:party_end]]
        columns = [parts for parts in columns if parts]
        if columns:
            result["bill_contract"]["buyerName"] = columns[0][0][:200]
            result["bill_contract"]["consigneeName"] = columns[0][-1][:200] if len(columns[0]) > 1 else ""
            result["bill_contract"]["buyerAddress"] = " ".join(parts[0] for parts in columns[1:])[:1000]
            result["bill_contract"]["consigneeAddress"] = " ".join(parts[-1] for parts in columns[1:] if len(parts) > 1)[:1000]
    gstins = re.findall(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b", text, re.IGNORECASE)
    if len(gstins) > 1:
        result["bill_contract"]["buyerGstin"] = gstins[1].upper()
        result["bill_contract"]["consigneeGstin"] = (gstins[2] if len(gstins) > 2 else gstins[1]).upper()
    terms = re.search(r"Payment\s+Terms\s*:\s*([^\n]+?)(?:\s{2,}|$)", text, re.IGNORECASE | re.MULTILINE)
    if terms:
        result["bill_contract"]["paymentTerms"] = " ".join(terms.group(1).split())[:240]
    if result["bill_contract"].get("buyerName", "").casefold() == result["supplier_name"].casefold():
        result["warnings"].append("Vendor and buyer appear identical; verify party roles")
    row_pattern = re.compile(
        r"^\s*\d+\s+(.+?)\s+(\d{6,8})\s+(\w+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$",
        re.IGNORECASE,
    )
    rows = []
    product_lines = lines[next((index for index, line in enumerate(lines) if "Product Description" in line), 0):]
    for index, source_line in enumerate(product_lines):
        match = row_pattern.match(source_line)
        if not match:
            continue
        values = list(match.groups())
        next_line = product_lines[index + 1] if index + 1 < len(product_lines) else ""
        continuation = next_line.strip()
        if continuation and re.match(r"^\s{4,}\S", next_line) and not row_pattern.match(next_line):
            values[0] = f"{values[0]} {continuation}"
        rows.append(values)
    for raw_name, hsn, unit, quantity_text, mrp_text, discount_text, rate_text, taxable_text in rows:
        name = " ".join(raw_name.upper().split())
        quantity = max(0, round(float(quantity_text)))
        mrp_paise = _money_to_paise(mrp_text)
        discount_bps = max(0, min(10000, round(float(discount_text) * 100)))
        taxable_paise = _money_to_paise(taxable_text)
        unit_cost_paise = round(taxable_paise * 10000 / max(1, quantity) / max(1, 10000 - discount_bps))
        discount_paise = max(0, quantity * unit_cost_paise - taxable_paise)
        result["lines"].append({
            "raw_name": name, "supplier_sku": "", "category": "", "brand": "",
            "barcode": "", "unit": unit.lower(), "package_unit": unit.lower(), "hsn_sac": hsn,
            "purchase_quantity": quantity, "pack_size": 1, "conversion_factor": 1, "quantity": quantity,
            "unit_cost_paise": unit_cost_paise, "discount_bps": discount_bps, "discount_paise": discount_paise, "gst_percent": 0,
            "taxable_paise": taxable_paise, "cgst_paise": 0, "sgst_paise": 0, "igst_paise": 0,
            "total_paise": taxable_paise, "batch_number": "", "expiry_date": "", "confidence_bps": 7500,
            "warnings": ["Tax rate was not visible on this line and was not inferred"], "field_evidence": {},
            "product_contract": {
                "barcode": "", "brand": "", "category": "", "purchaseUnit": unit.lower(),
                "stockUnit": unit.lower(), "manufactureDate": "", "mrpPaise": mrp_paise,
                "freeQuantity": 0, "acceptedQuantity": quantity, "damagedQuantity": 0,
                "rejectedQuantity": 0, "vendorCatalogCode": "", "size": "", "shade": "",
                "color": "", "mappingDecision": "",
            },
        })
    total_matches = re.findall(r"(?:grand\s+total|invoice\s+total|amount\s+payable|net\s+amount)\s*[:₹Rs.\-]*\s*([0-9,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if total_matches:
        result["total_paise"] = _money_to_paise(total_matches[-1])
        result["field_evidence"]["total_paise"] = {"confidence_bps": 9000, "warnings": []}
    if result["lines"]:
        result["subtotal_paise"] = sum(line["taxable_paise"] for line in result["lines"])
        result["cgst_paise"] = sum(line["cgst_paise"] for line in result["lines"])
        result["sgst_paise"] = sum(line["sgst_paise"] for line in result["lines"])
        for field in ("subtotal_paise", "cgst_paise", "sgst_paise", "igst_paise"):
            result["field_evidence"][field] = {"confidence_bps": 9000, "warnings": []}
        result["field_evidence"]["discount_paise"] = {
            "confidence_bps": 8000,
            "warnings": ["Header discount is zero; line discounts are retained per item"],
        }
    tax_row = re.search(
        r"^\s*18\s*%\s+([0-9,]+(?:\.\d{1,2})?)\s+([0-9,]+(?:\.\d{1,2})?)\s+([0-9,]+(?:\.\d{1,2})?).*$",
        text, re.IGNORECASE | re.MULTILINE,
    )
    if tax_row:
        result["subtotal_paise"], result["cgst_paise"], result["sgst_paise"] = (
            _money_to_paise(value) for value in tax_row.groups()
        )
        for field in ("subtotal_paise", "cgst_paise", "sgst_paise"):
            result["field_evidence"][field] = {"confidence_bps": 9000, "warnings": []}
    round_off = re.search(r"ROUND\s*OFF\s+(-?[0-9,]+(?:\.\d{1,2})?)", text, re.IGNORECASE)
    if round_off:
        result["bill_contract"]["roundOffPaise"] = _signed_money_to_paise(round_off.group(1))
    result["confidence_bps"] = 7000 if result["lines"] and result["total_paise"] else 4500
    return result


def _local_ocr(document: bytes, payload: PurchaseBillExtractRequest):
    suffix = Path(payload.file_name).suffix or (".pdf" if payload.content_type == "application/pdf" else ".img")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(document)
        source_path = handle.name
    try:
        if payload.content_type != "application/pdf":
            executable = os.getenv("TESSERACT_COMMAND", "").strip() or shutil.which("tesseract")
            if not executable:
                return manual_review_result("Tesseract is not installed; manual entry required")
            completed = subprocess.run([executable, source_path, "stdout"], capture_output=True, text=True, timeout=40, check=True)
            return parse_local_ocr(completed.stdout)
        pdftotext = os.getenv("PDFTOTEXT_COMMAND", "").strip() or shutil.which("pdftotext")
        if pdftotext:
            completed = subprocess.run([pdftotext, "-layout", source_path, "-"], capture_output=True, text=True, timeout=40, check=True)
            if completed.stdout.strip():
                return parse_local_ocr(completed.stdout)
        pdftoppm, tesseract = shutil.which("pdftoppm"), shutil.which("tesseract")
        if not pdftoppm or not tesseract:
            return manual_review_result("PDF has no readable text and scanned-page OCR is unavailable; manual entry required")
        with tempfile.TemporaryDirectory() as page_dir:
            prefix = str(Path(page_dir) / "page")
            subprocess.run([pdftoppm, "-f", "1", "-l", "10", "-r", "200", "-png", source_path, prefix], capture_output=True, timeout=40, check=True)
            text = "\n".join(subprocess.run([tesseract, str(page), "stdout"], capture_output=True, text=True, timeout=30, check=True).stdout for page in sorted(Path(page_dir).glob("page-*.png")))
            return parse_local_ocr(text) if text.strip() else manual_review_result("No readable invoice text was found; manual entry required")
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
