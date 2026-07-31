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
        result = parse_local_ocr("Aura Supplies\nGSTIN: 36ABCDE1234F1Z5\nPhone: +91 98765 43210\nEmail: billing@example.com\nAddress: 12 Market Road, Hyderabad\nInvoice No: INV-42\nInvoice Date: 22/07/2026\nPage 2 of 3\nCarried Forward ₹500.00\nGrand Total ₹1,234.50")
        self.assertEqual(result["provider"], "local_ocr")
        self.assertEqual(result["supplier_gstin"], "36ABCDE1234F1Z5")
        self.assertEqual(result["bill_number"], "INV-42")
        self.assertEqual(result["bill_date"], "2026-07-22")
        self.assertEqual(result["total_paise"], 123450)
        self.assertEqual(result["supplier_phone"], "+91 98765 43210")
        self.assertEqual(result["supplier_email"], "billing@example.com")
        self.assertEqual(result["supplier_address"], "12 Market Road, Hyderabad")
        self.assertEqual(result["bill_contract"]["pageNumber"], 2)
        self.assertEqual(result["bill_contract"]["pageCount"], 3)
        self.assertEqual(result["bill_contract"]["carryForwardPaise"], 50000)
        self.assertEqual(len(result["bill_contract"]["layoutFingerprint"]), 16)

    def test_turquoise_invoice_regression_keeps_vendor_lines_and_total(self):
        result = parse_local_ocr("""TURQUOISE WELLNESS
12 Market Road, Hyderabad
GSTIN: 36ABCDE1234F1Z5
Invoice No: TW/1833
Invoice Date: 29/07/2026
M/s.                         Details Of Consignee Shipped to :
S SENSE STUDIO               S SENSE STUDIO
SHOP 17, MUMBAI              SHOP 17, MUMBAI
State Code : 27
GSTIN Number : 27AENFS0007A1ZI GSTIN Number : 27AENFS0007A1ZI
1 CALYX SILK TOUCH SHAMPOO 1000 ML 33051090 Nos 2.000 2600.00 50.00 1101.69 2203.39
2 CALYX SILK TOUCH CONDITIONER 1000 ML 33051090 Nos 2.000 2600.00 50.00 1101.69 2203.39
Grand Total: 5,200.00""")
        self.assertEqual(result["supplier_name"], "TURQUOISE WELLNESS")
        self.assertEqual([line["raw_name"] for line in result["lines"]], [
            "CALYX SILK TOUCH SHAMPOO 1000 ML", "CALYX SILK TOUCH CONDITIONER 1000 ML",
        ])
        self.assertEqual(result["total_paise"], 520000)
        self.assertEqual(result["subtotal_paise"], 440678)
        self.assertEqual((result["cgst_paise"], result["sgst_paise"]), (39661, 39661))
        self.assertEqual(result["field_evidence"]["subtotal_paise"]["confidence_bps"], 9000)
        self.assertEqual(result["field_evidence"]["cgst_paise"]["confidence_bps"], 9000)
        self.assertEqual(result["bill_contract"]["buyerName"], "S SENSE STUDIO")
        self.assertEqual(result["bill_contract"]["consigneeName"], "S SENSE STUDIO")
        self.assertTrue(all(line["quantity"] == 2 and line["gst_percent"] == 0 for line in result["lines"]))
        self.assertTrue(all("not inferred" in line["warnings"][0] for line in result["lines"]))

    def test_turquoise_invoice_extracts_generic_wrapped_product_rows(self):
        result = parse_local_ocr("""TURQUOISE WELLNESS
Invoice No.: TW0517/25-26          Date. : 08/07/2025
Sr. Product Description HSN/SAC Unit Quantity M.R.P Disc. Rate (Rs.) Amount
  1 MORFOSE NICHE PRO BOND REPAIR SHAMPOO 1000 33051090 Nos 1.000 3490.00 30.00 2070.34 2070.34
    ML MRP 3490
  2 MORFOSE NICHE PRO BOND REPAIR HAIR MASK 500 33059090 Nos 1.000 3490.00 30.00 2070.34 2070.34
    ML MRP 3490
Payment Terms : 0 Days
18 % 4140.68 372.66 372.66 4886.00
ROUND OFF -0.02
GRAND TOTAL 4885.98""")
        self.assertEqual(len(result["lines"]), 2)
        self.assertEqual(result["lines"][0]["raw_name"], "MORFOSE NICHE PRO BOND REPAIR SHAMPOO 1000 ML MRP 3490")
        self.assertEqual(result["lines"][1]["hsn_sac"], "33059090")
        self.assertEqual(result["lines"][0]["taxable_paise"], 207034)
        self.assertEqual(result["total_paise"], 488598)
        self.assertEqual((result["cgst_paise"], result["sgst_paise"]), (37266, 37266))
        self.assertEqual(result["bill_contract"]["roundOffPaise"], -2)


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
