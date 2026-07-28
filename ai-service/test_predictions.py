"""Tests for the prediction scoring endpoint.

The service only ever scores the features Rust sends it. These cover the two
properties that matter for safety: it never returns a bare point estimate, and
it never scores a subject with less history than the caller asked for.
"""

import os
import unittest

from fastapi.testclient import TestClient

os.environ.setdefault("AI_SERVICE_TOKEN", "prediction-test-token")

from main import PREDICTION_MODEL_VERSION, app  # noqa: E402

TOKEN = "prediction-test-token"


class PredictionApiTests(unittest.TestCase):
    def setUp(self):
        os.environ["AI_PROVIDER"] = "local"
        # main.py reads the token per request, so set it here rather than at
        # import: another test module importing first must not decide it.
        self._previous_token = os.environ.get("AI_SERVICE_TOKEN")
        os.environ["AI_SERVICE_TOKEN"] = TOKEN
        self.client = TestClient(app)
        self.headers = {"Authorization": f"Bearer {TOKEN}"}

    def tearDown(self):
        # Put the token back, so a module that set it at import time still
        # works when it runs after this one.
        if self._previous_token is None:
            os.environ.pop("AI_SERVICE_TOKEN", None)
        else:
            os.environ["AI_SERVICE_TOKEN"] = self._previous_token

    def post(self, body):
        response = self.client.post(
            "/api/v1/predictions", headers=self.headers, json=body
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]

    def test_return_window_is_a_range_with_a_model_version(self):
        data = self.post(
            {
                "tenant_id": "tenant-1",
                "branch_id": "branch-1",
                "kind": "client_return_window",
                "unit": "days",
                "minimum_samples": 3,
                "subjects": [
                    {
                        "subject_id": "client-1",
                        "subject_name": "Priya",
                        "sample_size": 12,
                        "features": {
                            "visit_frequency_days": 30.0,
                            "recency_days": 10.0,
                            "total_visits": 12.0,
                        },
                    }
                ],
            }
        )
        self.assertEqual(data["model_version"], PREDICTION_MODEL_VERSION)
        prediction = data["predictions"][0]
        # A range, never a single date.
        self.assertLess(prediction["lower_value"], prediction["upper_value"])
        self.assertEqual(prediction["subject_id"], "client-1")
        # Plenty of history, so confidence is allowed to be high.
        self.assertEqual(prediction["confidence"], "high")
        self.assertTrue(any("interval" in signal for signal in prediction["signals"]))

    def test_a_sparse_subject_is_never_scored(self):
        data = self.post(
            {
                "tenant_id": "tenant-1",
                "kind": "client_return_window",
                "minimum_samples": 3,
                "subjects": [
                    {
                        "subject_id": "client-sparse",
                        "sample_size": 1,
                        "features": {"visit_frequency_days": 30.0, "recency_days": 5.0},
                    }
                ],
            }
        )
        self.assertEqual(
            data["predictions"],
            [],
            "a subject below the minimum sample size must not be scored",
        )

    def test_confidence_tracks_the_amount_of_history(self):
        def confidence_for(sample_size):
            data = self.post(
                {
                    "tenant_id": "tenant-1",
                    "kind": "client_churn_risk",
                    "minimum_samples": 3,
                    "subjects": [
                        {
                            "subject_id": "client-1",
                            "sample_size": sample_size,
                            "features": {"churn_risk_score": 60.0, "recency_days": 40.0},
                        }
                    ],
                }
            )
            return data["predictions"][0]["confidence"]

        self.assertEqual(confidence_for(3), "low")
        self.assertEqual(confidence_for(6), "medium")
        self.assertEqual(confidence_for(12), "high")

    def test_bounded_metrics_stay_inside_their_limits(self):
        data = self.post(
            {
                "tenant_id": "tenant-1",
                "kind": "client_churn_risk",
                "minimum_samples": 1,
                "subjects": [
                    {
                        "subject_id": "client-max",
                        "sample_size": 20,
                        "features": {"churn_risk_score": 98.0, "recency_days": 200.0},
                    },
                    {
                        "subject_id": "client-min",
                        "sample_size": 20,
                        "features": {"churn_risk_score": 2.0, "recency_days": 1.0},
                    },
                ],
            }
        )
        for prediction in data["predictions"]:
            self.assertGreaterEqual(prediction["lower_value"], 0.0)
            self.assertLessEqual(prediction["upper_value"], 100.0)

    def test_every_prediction_kind_is_scorable(self):
        cases = {
            "client_churn_risk": {"churn_risk_score": 50.0, "recency_days": 30.0},
            "client_return_window": {"visit_frequency_days": 28.0, "recency_days": 7.0},
            "no_show_risk": {"no_show_rate_bps": 1200.0, "cancellation_rate_bps": 400.0},
            "service_demand": {
                "current_bookings": 20.0,
                "previous_bookings": 14.0,
                "current_repeat_clients": 6.0,
            },
            "staff_utilization": {
                "current_booked_minutes": 6000.0,
                "current_scheduled_minutes": 9000.0,
            },
            "appointment_load": {"weekday_1_completed": 30.0, "weekday_2_completed": 25.0},
            "revenue_forecast": {"revenue_2026-07-01": 500000.0, "revenue_2026-07-02": 450000.0},
            "inventory_reorder_risk": {
                "stock_quantity": 20.0,
                "consumed_units": 90.0,
                "history_days": 90.0,
                "reorder_point": 25.0,
            },
            "membership_renewal_risk": {"failure_count": 2.0, "days_until_expiry": 5.0},
        }
        for kind, features in cases.items():
            data = self.post(
                {
                    "tenant_id": "tenant-1",
                    "kind": kind,
                    "minimum_samples": 1,
                    "subjects": [
                        {
                            "subject_id": f"subject-{kind}",
                            "sample_size": 30,
                            "features": features,
                        }
                    ],
                }
            )
            self.assertEqual(
                len(data["predictions"]), 1, f"{kind} produced no prediction"
            )
            prediction = data["predictions"][0]
            self.assertLessEqual(
                prediction["lower_value"],
                prediction["upper_value"],
                f"{kind} returned an inverted range",
            )
            self.assertTrue(prediction["signals"], f"{kind} returned no signals")

    def test_an_unknown_kind_is_not_invented(self):
        data = self.post(
            {
                "tenant_id": "tenant-1",
                "kind": "lottery_numbers",
                "minimum_samples": 1,
                "subjects": [
                    {"subject_id": "s1", "sample_size": 50, "features": {"x": 1.0}}
                ],
            }
        )
        self.assertEqual(
            data["predictions"], [], "an unsupported kind must not be scored"
        )


if __name__ == "__main__":
    unittest.main()
