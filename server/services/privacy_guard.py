import re
from typing import Any

STRIP_KEYS = {
    "matchedText", "rawText", "ocrText", "value",
    "password", "ssn", "secret", "_el", "_words", "_lines"
}

EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
CARD_RE = re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b")


def sanitize_text(text: str) -> str:
    if not isinstance(text, str):
        return text
    text = EMAIL_RE.sub("[REDACTED_EMAIL]", text)
    text = PHONE_RE.sub("[REDACTED_PHONE]", text)
    text = CARD_RE.sub("[REDACTED_CARD]", text)
    return text


def sanitize_for_log(obj: Any) -> Any:
    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            if k in STRIP_KEYS:
                cleaned[k] = "[MASKED]"
            else:
                cleaned[k] = sanitize_for_log(v)
        return cleaned
    elif isinstance(obj, list):
        return [sanitize_for_log(x) for x in obj]
    elif isinstance(obj, str):
        return sanitize_text(obj)
    return obj
