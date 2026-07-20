import unittest

from purchase_bill_extraction import HEADER_FIELDS, manual_review_result, normalize_extraction


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


if __name__ == "__main__":
    unittest.main()
