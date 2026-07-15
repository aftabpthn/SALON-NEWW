import os
import unittest

from fastapi.testclient import TestClient

os.environ["AI_SERVICE_TOKEN"] = "customer-ai-test-token"

from main import app  # noqa: E402


class CustomerAiApiTests(unittest.TestCase):
    def setUp(self):
        os.environ["AI_PROVIDER"] = "local"
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer customer-ai-test-token"}

    def test_customer_ai_uses_feedback_and_returns_full_contract(self):
        response = self.client.post(
            "/api/v1/customer-ai/recommendations",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_id": "branch-1",
                "customer_id": "customer-1",
                "metrics": {
                    "total_visits": 4,
                    "open_appointments": 0,
                    "inactive_days": 120,
                    "churn_risk_score": 82,
                    "primary_action": "Start win-back outreach",
                    "primary_reason": "120 inactive days",
                    "favourite_services": "Hair Spa",
                },
                "recent_services": [
                    {"service_id": "service-1", "service_name": "Hair Cut"}
                ],
                "candidate_services": [
                    {"id": "service-2", "name": "Hair Spa", "category": "Hair"}
                ],
                "feedback": [
                    {
                        "recommendation": "Start win-back outreach",
                        "decision": "rejected",
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["source"], "python_deterministic")
        self.assertNotIn(
            "Start win-back outreach",
            [item["action"] for item in data["nextBestActions"]],
        )
        self.assertTrue(data["rebookingRecommendations"])
        self.assertTrue(data["upsellRecommendations"])
        self.assertTrue(data["learningContext"]["feedbackApplied"])

    def test_customer_ai_requires_service_auth(self):
        response = self.client.post(
            "/api/v1/customer-ai/recommendations",
            json={"tenant_id": "t", "branch_id": "b", "customer_id": "c", "metrics": {}},
        )
        self.assertEqual(response.status_code, 401)

    def test_profit_copilot_fallback_preserves_recorded_impact_and_source(self):
        response = self.client.post(
            "/api/v1/profit-copilot/recommendations",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_ids": ["branch-1", "branch-2"],
                "from_date": "2026-07-01",
                "to_date": "2026-07-31",
                "candidates": [
                    {
                        "kind": "negative_margin",
                        "title": "Review Hair Cut Margin",
                        "message": "Recorded service costs exceed net revenue",
                        "impact_paise": 125000,
                        "source_type": "service",
                        "source_id": "service-1",
                    }
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["source"], "python_deterministic")
        self.assertEqual(data["recommendations"][0]["impactPaise"], 125000)
        self.assertEqual(data["recommendations"][0]["sourceId"], "service-1")

    def test_concierge_fallback_never_claims_booking_confirmation(self):
        response = self.client.post(
            "/api/v1/concierge/respond",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_id": "branch-1",
                "channel": "whatsapp",
                "message": "Book Hair Spa tomorrow",
                "candidate_services": [
                    {"id": "service-1", "name": "Hair Spa", "duration_minutes": 60, "price_paise": 150000}
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["intent"], "booking")
        self.assertEqual(data["serviceId"], "service-1")
        self.assertNotIn("confirmed", data["replyText"].lower())


if __name__ == "__main__":
    unittest.main()
