import sys
import unittest
from email.message import EmailMessage
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from support_email_bridge import build_payload


class SupportEmailBridgeTest(unittest.TestCase):
    def test_builds_scoped_ticket_payload_from_raw_mime(self):
        message = EmailMessage()
        message["From"] = "Salon Owner <owner@example.com>"
        message["To"] = "support@example.com"
        message["Subject"] = "Billing help"
        message["Message-ID"] = "<customer-message@example.com>"
        message.set_content("Please check my invoice.")
        message.add_attachment(
            b"proof", maintype="text", subtype="plain", filename="proof.txt"
        )
        record = {
            "ses": {
                "mail": {"messageId": "ses-message-1", "source": "owner@example.com"},
                "receipt": {
                    "recipients": ["support@example.com"],
                    "spamVerdict": {"status": "PASS"},
                    "virusVerdict": {"status": "PASS"},
                },
            }
        }

        payload = build_payload(
            message.as_bytes(),
            record,
            {"support@example.com": {"tenantId": "tenant-1", "branchId": "branch-1"}},
        )

        self.assertEqual(payload["tenantId"], "tenant-1")
        self.assertEqual(payload["branchId"], "branch-1")
        self.assertEqual(payload["textBody"], "Please check my invoice.")
        self.assertEqual(payload["attachments"][0]["fileName"], "proof.txt")
        self.assertEqual(payload["spamVerdict"], "PASS")


if __name__ == "__main__":
    unittest.main()
