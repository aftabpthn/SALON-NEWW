import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from purchase_bill_extraction import (
    HEADER_FIELDS,
    PurchaseBillExtractRequest,
    extract_purchase_bill,
    manual_review_result,
    normalize_extraction,
    parse_local_ocr,
)


class PurchaseBillExtractionTests(unittest.TestCase):
    def test_manual_result_warns_on_every_header_field(self):
        result = manual_review_result("provider missing")
        self.assertEqual(result["lines"], [])
        self.assertEqual(set(result["field_evidence"]), set(HEADER_FIELDS))
        self.assertTrue(all(item["warnings"] for item in result["field_evidence"].values()))

    def test_normalization_clamps_untrusted_numbers(self):
        value = manual_review_result("review")
        value.update({"total_paise": -1, "confidence_bps": 20000})
        value["lines"] = [{
            "purchase_quantity": -2, "pack_size": 0, "conversion_factor": 0, "quantity": -1,
            "unit_cost_paise": -1, "discount_bps": 20000, "discount_paise": -1,
            "gst_percent": 150, "taxable_paise": -1, "cgst_paise": -1, "sgst_paise": -1,
            "igst_paise": -1, "total_paise": -1, "confidence_bps": 20000,
        }]
        result = normalize_extraction(value, "test-model")
        self.assertEqual(result["total_paise"], 0)
        self.assertEqual(result["confidence_bps"], 10000)
        self.assertEqual(result["lines"][0]["pack_size"], 1)
        self.assertEqual(result["lines"][0]["gst_percent"], 100)

    def test_local_ocr_extracts_visible_header_and_total(self):
        result = parse_local_ocr("Aura Supplies\nGSTIN: 36ABCDE1234F1Z5\nInvoice No: INV-42\nInvoice Date: 22/07/2026\nGrand Total ₹1,234.50")
        self.assertEqual(result["provider"], "local_ocr")
        self.assertEqual(result["supplier_gstin"], "36ABCDE1234F1Z5")
        self.assertEqual(result["bill_number"], "INV-42")
        self.assertEqual(result["bill_date"], "2026-07-22")
        self.assertEqual(result["total_paise"], 123450)


class PurchaseBillFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_openai_failure_uses_configured_anthropic_fallback(self):
        payload = PurchaseBillExtractRequest(
            tenant_id="tenant",
            branch_id="branch",
            file_name="bill.pdf",
            content_type="application/pdf",
            content_base64="cGRm",
        )
        fallback = manual_review_result("fallback check")
        fallback["provider"] = "anthropic_messages"
        with (
            patch.dict(os.environ, {
                "AI_PROVIDER": "openai",
                "OPENAI_API_KEY": "test-key",
                "AI_DOCUMENT_FALLBACK": "anthropic",
                "ANTHROPIC_API_KEY": "test-key",
            }),
            patch("purchase_bill_extraction._extract_openai", AsyncMock(side_effect=httpx.HTTPError("unavailable"))),
            patch("purchase_bill_extraction._extract_anthropic", AsyncMock(return_value=fallback)),
        ):
            response = await extract_purchase_bill(payload)
        self.assertEqual(response["data"]["provider"], "anthropic_messages")


if __name__ == "__main__":
    unittest.main()
