import logging
import re
from dataclasses import dataclass
from typing import Any, Dict

logger = logging.getLogger("server.privacy")

STRIP_KEYS = frozenset({
    "matchedText", "rawText", "ocrText", "value",
    "password", "ssn", "secret", "_el", "_words", "_lines"
})

EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
CARD_RE = re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b")
DIGIT_RE = re.compile(r"\d")


@dataclass
class PrivacyGuardStats:
    total_scans: int = 0
    fast_path_hits: int = 0
    redactions_applied: int = 0


stats = PrivacyGuardStats()


def sanitize_text(text: str) -> str:
    """Fast-path PII sanitization with zero-cost guards for clean strings."""
    if not isinstance(text, str) or not text:
        return text

    stats.total_scans += 1

    has_at = "@" in text
    has_digit = bool(DIGIT_RE.search(text))

    # Zero-cost fast path: if neither '@' nor any digit exists, it cannot be email/phone/card
    if not has_at and not has_digit:
        stats.fast_path_hits += 1
        return text

    modified = False
    result = text

    if has_at:
        new_result, n = EMAIL_RE.subn("[REDACTED_EMAIL]", result)
        if n > 0:
            result = new_result
            modified = True

    if has_digit:
        new_result, n = PHONE_RE.subn("[REDACTED_PHONE]", result)
        if n > 0:
            result = new_result
            modified = True

        new_result, n = CARD_RE.subn("[REDACTED_CARD]", result)
        if n > 0:
            result = new_result
            modified = True

    if modified:
        stats.redactions_applied += 1

    return result


def sanitize_for_log(obj: Any) -> Any:
    """Recursively redact sensitive keys and sanitize strings for safe logging."""
    if obj is None or isinstance(obj, (bool, int, float)):
        return obj

    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            if k in STRIP_KEYS:
                cleaned[k] = "[MASKED]"
            else:
                cleaned[k] = sanitize_for_log(v)
        return cleaned

    if isinstance(obj, list):
        return [sanitize_for_log(x) for x in obj]

    if isinstance(obj, str):
        return sanitize_text(obj)

    return obj


def get_privacy_stats() -> Dict[str, Any]:
    return {
        "total_scans": stats.total_scans,
        "fast_path_hits": stats.fast_path_hits,
        "redactions_applied": stats.redactions_applied,
        "fast_path_rate": (
            round(stats.fast_path_hits / stats.total_scans, 4)
            if stats.total_scans > 0
            else 0.0
        ),
    }


def reset_privacy_stats() -> None:
    stats.total_scans = 0
    stats.fast_path_hits = 0
    stats.redactions_applied = 0
