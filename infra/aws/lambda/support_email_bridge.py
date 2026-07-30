import base64
import hashlib
import hmac
import json
import os
import re
import urllib.request
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser


ALLOWED_ATTACHMENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024
_secret = None


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())


def _html_to_text(value):
    parser = _TextExtractor()
    parser.feed(value)
    return "\n".join(parser.parts)


def _message_text(message):
    plain = []
    html = []
    for part in message.walk() if message.is_multipart() else [message]:
        if part.get_content_disposition() == "attachment":
            continue
        content_type = part.get_content_type()
        if content_type not in {"text/plain", "text/html"}:
            continue
        try:
            value = part.get_content()
        except (LookupError, UnicodeDecodeError):
            value = part.get_payload(decode=True).decode("utf-8", "replace")
        (plain if content_type == "text/plain" else html).append(value)
    if plain:
        return "\n\n".join(plain).strip()
    return _html_to_text("\n".join(html)).strip()


def _attachments(message):
    accepted = []
    omitted = []
    total = 0
    for part in message.walk() if message.is_multipart() else []:
        filename = str(part.get_filename() or "").strip()
        if not filename:
            continue
        content_type = part.get_content_type().lower()
        content = part.get_payload(decode=True) or b""
        safe_name = len(filename) <= 180 and "/" not in filename and "\\" not in filename
        if (
            not safe_name
            or content_type not in ALLOWED_ATTACHMENT_TYPES
            or not content
            or len(content) > MAX_ATTACHMENT_BYTES
            or len(accepted) >= 10
            or total + len(content) > MAX_TOTAL_ATTACHMENT_BYTES
        ):
            omitted.append(filename[:180] or "unnamed")
            continue
        total += len(content)
        accepted.append(
            {
                "fileName": filename,
                "contentType": content_type,
                "dataBase64": base64.b64encode(content).decode("ascii"),
            }
        )
    return accepted, omitted


def _header_message_ids(value):
    return re.findall(r"<[^>]+>", value or "")


def build_payload(raw_message, ses_record, recipient_map):
    receipt = ses_record["ses"]["receipt"]
    mail = ses_record["ses"]["mail"]
    recipients = [value.strip().lower() for value in receipt.get("recipients", [])]
    recipient = next((value for value in recipients if value in recipient_map), None)
    if not recipient:
        raise ValueError("SES recipient is not mapped to a tenant and branch")

    message = BytesParser(policy=policy.default).parsebytes(raw_message)
    attachments, omitted = _attachments(message)
    text_body = _message_text(message)
    if omitted:
        text_body += "\n\nAttachments omitted by policy: " + ", ".join(omitted)
    message_id = str(message.get("Message-ID") or f"<{mail['messageId']}@amazonses.com>")
    scope = recipient_map[recipient]
    return {
        "eventId": f"ses:{mail['messageId']}",
        "sesMessageId": mail["messageId"],
        "tenantId": scope["tenantId"],
        "branchId": scope["branchId"],
        "from": str(message.get("From") or mail.get("source") or ""),
        "to": recipient,
        "subject": str(message.get("Subject") or "Support request"),
        "textBody": text_body,
        "messageId": message_id,
        "inReplyTo": str(message.get("In-Reply-To") or ""),
        "references": _header_message_ids(str(message.get("References") or "")),
        "spamVerdict": receipt.get("spamVerdict", {}).get("status", ""),
        "virusVerdict": receipt.get("virusVerdict", {}).get("status", ""),
        "attachments": attachments,
    }


def _webhook_secret(boto3):
    global _secret
    if _secret is None:
        response = boto3.client("secretsmanager").get_secret_value(
            SecretId=os.environ["RUNTIME_SECRET_ARN"]
        )
        values = json.loads(response["SecretString"])
        _secret = values["SUPPORT_EMAIL_WEBHOOK_SECRET"]
    return _secret


def _post(payload, secret):
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        os.environ["WEBHOOK_URL"],
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-AuraShine-Signature": f"sha256={signature}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"support webhook returned HTTP {response.status}")
        return json.loads(response.read() or b"{}")


def handler(event, _context):
    import boto3

    recipient_map = json.loads(os.environ["RECIPIENT_MAP_JSON"])
    s3 = boto3.client("s3")
    secret = _webhook_secret(boto3)
    results = []
    for record in event.get("Records", []):
        receipt = record.get("ses", {}).get("receipt", {})
        if receipt.get("spamVerdict", {}).get("status") != "PASS" or receipt.get(
            "virusVerdict", {}
        ).get("status") != "PASS":
            results.append({"ignored": True, "reason": "SES verdict"})
            continue
        message_id = record["ses"]["mail"]["messageId"]
        key = f"{os.environ.get('OBJECT_PREFIX', 'raw/')}{message_id}"
        raw_message = s3.get_object(Bucket=os.environ["BUCKET_NAME"], Key=key)[
            "Body"
        ].read()
        results.append(_post(build_payload(raw_message, record, recipient_map), secret))
    return {"processed": len(results), "results": results}
