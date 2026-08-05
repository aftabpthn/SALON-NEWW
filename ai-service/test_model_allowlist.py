import unittest

from main import ConciergeGovernance, ConciergeRequest, model_permitted  # noqa: E402


def request_with(allowlist):
    return ConciergeRequest(
        tenant_id="tenant-1",
        branch_id="branch-1",
        channel="web",
        message="what is my rebooking rate",
        governance=ConciergeGovernance(model_allowlist=allowlist),
    )


class ModelAllowlistTests(unittest.TestCase):
    """The allow-list hint sent by the CRM.

    This is a spend guard, not the enforcement point: the CRM re-checks the
    model named on the reply. These tests only assert that a call the CRM would
    discard is not paid for in the first place.
    """

    def test_unset_allowlist_permits_any_model(self):
        payload = request_with([])
        self.assertTrue(model_permitted(payload, "gpt-5.4-mini"))
        self.assertTrue(model_permitted(payload, "claude-haiku-4-5-20251001"))

    def test_named_allowlist_is_exhaustive(self):
        payload = request_with(["gpt-5.4-mini"])
        self.assertTrue(model_permitted(payload, "gpt-5.4-mini"))
        # A model the tenant did not approve is refused even when it is the
        # stronger one — approval is the whole point of the setting.
        self.assertFalse(model_permitted(payload, "gpt-5.4"))

    def test_matching_ignores_case_and_padding(self):
        payload = request_with(["  GPT-5.4-Mini  "])
        self.assertTrue(model_permitted(payload, "gpt-5.4-mini"))
        self.assertFalse(model_permitted(payload, "gpt-5.4-minis"))

    def test_blank_entries_do_not_form_an_allowlist(self):
        # A settings field saved with empty rows must not read as "allow nothing",
        # which would take AI offline for the tenant.
        payload = request_with(["", "   "])
        self.assertTrue(model_permitted(payload, "gpt-5.4-mini"))


if __name__ == "__main__":
    unittest.main()
