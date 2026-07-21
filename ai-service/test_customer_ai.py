import json
import os
import unittest
from unittest.mock import AsyncMock, Mock, patch

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

    def test_marketing_advisor_returns_evidence_and_requires_approval(self):
        response = self.client.post(
            "/api/v1/marketing-advisor/recommendation",
            headers=self.headers,
            json={"tenant_id":"tenant-1","branch_id":"branch-1","scope":"client","scope_id":"client-1","clients":[{"client_id":"client-1","client_name":"A Client","inactive_days":120,"last_service":"Hair Cut","preferred_channel":"whatsapp","consent_status":"WhatsApp","churn_risk_score":80,"segment_keys":["inactive_90"]}]},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertTrue(data["requiresApproval"])
        self.assertEqual(data["dueService"], "Hair Cut")
        self.assertTrue(data["evidence"])
        self.assertLessEqual(data["safeDiscountBps"], 1000)

    def test_profit_copilot_fallback_preserves_recorded_impact_and_source(self):
        response = self.client.post(
            "/api/v1/profit-copilot/recommendations",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_ids": ["branch-1", "branch-2"],
                "from_date": "2026-07-01",
                "to_date": "2026-07-31",
                "facts": {
                    "fact_schema_version": "micro-pnl-reconciled-v1",
                    "period_start": "2026-07-01",
                    "period_end": "2026-07-31",
                    "branch_count": 2,
                    "ledger_revenue_paise": 500000,
                    "micro_revenue_paise": 500000,
                    "revenue_variance_paise": 0,
                    "ledger_cogs_paise": 100000,
                    "micro_product_cost_paise": 100000,
                    "cogs_variance_paise": 0,
                    "ledger_payroll_paise": 150000,
                    "payroll_source_paise": 150000,
                    "payroll_variance_paise": 0,
                    "cost_completeness_bps": 10000,
                    "reportable_line_count": 20,
                    "reconciled": True,
                    "branch_period_close_ready": True,
                },
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
        self.assertEqual(data["factSchemaVersion"], "micro-pnl-reconciled-v1")
        self.assertEqual(data["evaluationStatus"], "passed")

    def test_profit_copilot_rejects_unreconciled_facts(self):
        response = self.client.post(
            "/api/v1/profit-copilot/recommendations",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_ids": ["branch-1"],
                "from_date": "2026-07-01",
                "to_date": "2026-07-31",
                "facts": {
                    "fact_schema_version": "micro-pnl-reconciled-v1",
                    "period_start": "2026-07-01",
                    "period_end": "2026-07-31",
                    "branch_count": 1,
                    "ledger_revenue_paise": 1,
                    "micro_revenue_paise": 0,
                    "revenue_variance_paise": 1,
                    "ledger_cogs_paise": 0,
                    "micro_product_cost_paise": 0,
                    "cogs_variance_paise": 0,
                    "ledger_payroll_paise": 0,
                    "payroll_source_paise": 0,
                    "payroll_variance_paise": 0,
                    "cost_completeness_bps": 0,
                    "reportable_line_count": 1,
                    "reconciled": False,
                    "branch_period_close_ready": False,
                },
                "candidates": [],
            },
        )
        self.assertEqual(response.status_code, 422)

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

    def test_concierge_fallback_answers_real_operational_metrics(self):
        response = self.client.post(
            "/api/v1/concierge/respond",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_id": "branch-1",
                "channel": "web",
                "message": "Give me today's sales overview",
                "operational_context": {
                    "business_date": "2026-07-15",
                    "today_appointments": 6,
                    "open_appointments": 2,
                    "active_clients": 48,
                    "active_services": 12,
                    "today_sales_paise": 125050,
                    "open_sales": 1,
                    "recent_completed_appointments": 17,
                    "low_stock_items": 3,
                    "financials_visible": True,
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["model"], "local-operations-policy-v2")
        self.assertIn("₹1250.50", data["replyText"])
        self.assertIn("Low-stock items: 3", data["replyText"])

    @patch("main.httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_concierge_uses_ollama_text_with_deterministic_actions(self, post):
        mocked_response = Mock()
        mocked_response.raise_for_status.return_value = None
        mocked_response.json.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "reply_text": "Aaj ke live branch metrics ka detailed analysis available hai.",
                        "intent": "booking",
                        "service_id": "invented-service",
                        "handoff_required": True,
                        "safety_flags": ["invented"],
                    }
                )
            }
        }
        post.return_value = mocked_response
        os.environ["AI_PROVIDER"] = "ollama"
        os.environ["OLLAMA_MODEL"] = "llama3.2:1b"
        try:
            response = self.client.post(
                "/api/v1/concierge/respond",
                headers=self.headers,
                json={
                    "tenant_id": "tenant-1",
                    "branch_id": "branch-1",
                    "channel": "web",
                    "message": "Aaj business kaisa chal raha hai?",
                    "operational_context": {
                        "business_date": "2026-07-15",
                        "today_appointments": 6,
                        "open_appointments": 2,
                        "active_clients": 48,
                        "active_services": 12,
                        "today_sales_paise": 125050,
                        "open_sales": 1,
                        "recent_completed_appointments": 17,
                        "low_stock_items": 3,
                        "financials_visible": True,
                    },
                },
            )
        finally:
            os.environ["AI_PROVIDER"] = "local"
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["source"], "ollama_chat")
        self.assertEqual(data["model"], "llama3.2:1b")
        self.assertEqual(data["intent"], "general")
        self.assertEqual(data["serviceId"], "")
        self.assertFalse(data["handoffRequired"])

    @patch("main.httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_concierge_rejects_ollama_booking_confirmation_language(self, post):
        mocked_response = Mock()
        mocked_response.raise_for_status.return_value = None
        mocked_response.json.return_value = {
            "message": {
                "content": json.dumps(
                    {
                        "reply_text": "I can confirm your appointment for you.",
                        "intent": "general",
                        "service_id": "",
                        "handoff_required": False,
                        "safety_flags": [],
                    }
                )
            }
        }
        post.return_value = mocked_response
        os.environ["AI_PROVIDER"] = "ollama"
        try:
            response = self.client.post(
                "/api/v1/concierge/respond",
                headers=self.headers,
                json={
                    "tenant_id": "tenant-1",
                    "branch_id": "branch-1",
                    "channel": "web",
                    "message": "What can you do?",
                },
            )
        finally:
            os.environ["AI_PROVIDER"] = "local"
        data = response.json()["data"]
        self.assertEqual(data["source"], "python_deterministic")
        self.assertNotIn("confirm", data["replyText"].casefold())

    @patch("main.httpx.AsyncClient.post", new_callable=AsyncMock)
    def test_concierge_uses_anthropic_structured_response(self, post):
        mocked_response = Mock()
        mocked_response.raise_for_status.return_value = None
        mocked_response.json.return_value = {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "reply_text": "Live CRM facts ke basis par main detailed analysis de sakta hoon.",
                            "intent": "general",
                            "service_id": "",
                            "handoff_required": False,
                            "safety_flags": [],
                        }
                    ),
                }
            ]
        }
        post.return_value = mocked_response
        os.environ["AI_PROVIDER"] = "anthropic"
        os.environ["ANTHROPIC_API_KEY"] = "test-key"
        try:
            response = self.client.post(
                "/api/v1/concierge/respond",
                headers=self.headers,
                json={
                    "tenant_id": "tenant-1",
                    "branch_id": "branch-1",
                    "channel": "web",
                    "message": "Analyze the current CRM data.",
                },
            )
        finally:
            os.environ["AI_PROVIDER"] = "local"
            os.environ.pop("ANTHROPIC_API_KEY", None)
        data = response.json()["data"]
        self.assertEqual(data["source"], "anthropic_messages")
        self.assertEqual(data["intent"], "general")

    def test_migration_mapping_has_mandatory_deterministic_fallback(self):
        response = self.client.post(
            "/api/v1/migrations/mapping-suggestions",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_id": "branch-1",
                "entity": "clients",
                "source_columns": ["Customer Name", "Mobile", "Mystery"],
                "targets": [
                    {"field": "firstName", "aliases": ["customer name", "first name"]},
                    {"field": "phone", "aliases": ["mobile", "phone number"]},
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["source"], "python_deterministic")
        self.assertEqual(data["suggestions"], {"Customer Name": "firstName", "Mobile": "phone"})
        self.assertEqual(data["unmatchedColumns"], ["Mystery"])

    def test_migration_failure_assistant_returns_safe_recovery_steps(self):
        response = self.client.post(
            "/api/v1/migrations/failure-assistant",
            headers=self.headers,
            json={
                "tenant_id": "tenant-1",
                "branch_id": "branch-1",
                "job_id": "job-1",
                "entity": "clients",
                "status": "failed",
                "last_error": "staging chunk checksum mismatch",
                "error_rows": 4,
                "failed_chunks": 1,
                "approval_status": "approved",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["source"], "python_deterministic")
        self.assertTrue(any("SHA-256" in item for item in data["recommendations"]))
        self.assertTrue(any("dry-run" in item for item in data["recommendations"]))


if __name__ == "__main__":
    unittest.main()
