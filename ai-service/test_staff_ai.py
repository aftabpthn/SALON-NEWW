import os
import unittest

from fastapi.testclient import TestClient

os.environ["AI_SERVICE_TOKEN"] = "staff-ai-test-token"

from main import app  # noqa: E402


class StaffAiApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer staff-ai-test-token"}
        self.scope = {
            "tenant_id": "tenant-1",
            "branch_id": "branch-1",
            "period_start": "2026-07-01",
            "period_end": "2026-07-30",
        }

    def post(self, path, body):
        response = self.client.post(path, headers=self.headers, json={**self.scope, **body})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["data"]

    def test_staff_ai_flags_only_reviewable_evidence(self):
        attendance = self.post("/api/v1/staff-ai/attendance-anomalies", {"records": [{
            "staff_id": "staff-1", "staff_name": "Staff One", "business_date": "2026-07-02",
            "raw_status": "present", "manual_status": "absent", "clock_in_at": "2026-07-02T04:00:00Z",
            "worked_minutes": 1100, "late_minutes": 140,
        }]})
        self.assertEqual(attendance["signalCount"], 1)

        buddy = self.post("/api/v1/staff-ai/buddy-punching-signals", {"events": [
            {"staff_id": "staff-1", "external_user_id": "identity-1", "device_id": "device-1", "punch_at": "2026-07-02T04:00:00Z"},
            {"staff_id": "staff-2", "external_user_id": "identity-1", "device_id": "device-1", "punch_at": "2026-07-02T04:01:00Z"},
        ]})
        self.assertTrue(buddy["humanReviewOnly"])
        self.assertGreaterEqual(buddy["signalCount"], 2)

        attrition = self.post("/api/v1/staff-ai/attrition-risk", {"staff": [{
            "staff_id": "staff-1", "present_days": 10, "absent_days": 5,
            "overtime_minutes": 700, "operation_task_completed": 1, "operation_task_missed": 3,
        }]})
        self.assertEqual(attrition["kind"], "retention_review")
        self.assertEqual(attrition["signalCount"], 1)

        commission = self.post("/api/v1/staff-ai/commission-anomalies", {"staff": [
            {"staff_id": "staff-1", "line_count": 5, "base_paise": 100_000, "commission_paise": 10_000},
            {"staff_id": "staff-2", "line_count": 5, "base_paise": 100_000, "commission_paise": 11_000},
            {"staff_id": "staff-3", "line_count": 5, "base_paise": 100_000, "commission_paise": 50_000},
        ]})
        self.assertEqual(commission["signals"][0]["staffId"], "staff-3")

        roster = self.post("/api/v1/staff-ai/roster-recommendations", {
            "coverage": {"uncovered_appointments": 2},
            "rows": [{"staff_id": "staff-1", "schedule_date": "2026-07-03", "approved_leave": True, "appointments_count": 1}],
        })
        self.assertEqual(roster["writeAuthority"], "rust_roster_optimizer_and_manager_approval")
        self.assertEqual(roster["signalCount"], 2)

    def test_staff_ai_rejects_invalid_period(self):
        response = self.client.post(
            "/api/v1/staff-ai/attendance-anomalies",
            headers=self.headers,
            json={**self.scope, "period_end": "2026-09-01", "records": []},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
