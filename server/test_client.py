import json
from fastapi.testclient import TestClient
from main import app
from config import settings
from services import sanitize_for_log, sanitize_text, is_known_tool, KNOWN_TOOLS

client = TestClient(app)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "scan_dom",
            "description": "Analyze webpage DOM for PII.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": "Capture visible page screenshot.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "redact",
            "description": "Redact specified detection IDs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "detectionIds": {"type": "array", "items": {"type": "string"}},
                    "method": {"type": "string", "enum": ["MASK", "BLACK_BOX"]},
                },
                "required": ["detectionIds", "method"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_redaction",
            "description": "Confirm all detections are masked.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def test_privacy_guard():
    raw = "User email is test.user@example.com and phone is +1-555-123-4567"
    cleaned = sanitize_text(raw)
    assert "test.user@example.com" not in cleaned
    assert "[REDACTED_EMAIL]" in cleaned
    assert "[REDACTED_PHONE]" in cleaned

    payload = {
        "matchedText": "super_secret_password",
        "category": "password",
        "nested": {"value": "secret123", "safe": "ok"},
    }
    masked = sanitize_for_log(payload)
    assert masked["matchedText"] == "[MASKED]"
    assert masked["nested"]["value"] == "[MASKED]"
    assert masked["nested"]["safe"] == "ok"
    print("[PASS] privacy guard sanitization")


def test_tool_registry():
    assert is_known_tool("scan_dom")
    assert is_known_tool("redact")
    assert is_known_tool("click_element")
    assert not is_known_tool("arbitrary_eval_cmd")
    print(f"[PASS] tool registry check ({len(KNOWN_TOOLS)} tools verified)")


def test_agent_tool_calling_flow():
    prev = settings.BACKEND_MODE
    settings.BACKEND_MODE = "local_vlm"

    try:
        # Step 1: send user task with agent tools
        step1_req = {
            "model": "Qwen/Qwen2.5-VL-7B-Instruct",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a privacy-first browser agent. Use available tools to redact PII.",
                },
                {"role": "user", "content": "Redact all personal info on this page"},
            ],
            "tools": AGENT_TOOLS,
        }

        res1 = client.post("/v1/chat/completions", json=step1_req)
        assert res1.status_code == 200
        choice1 = res1.json()["choices"][0]
        assert choice1["finish_reason"] == "tool_calls"
        assert choice1["message"]["tool_calls"][0]["function"]["name"] == "scan_dom"
        print("[PASS] agent step 1: tool call emitted (scan_dom)")

        # Step 2: feed back tool result
        tool_call_id = choice1["message"]["tool_calls"][0]["id"]
        step2_req = {
            "model": "Qwen/Qwen2.5-VL-7B-Instruct",
            "messages": [
                {"role": "user", "content": "Redact all personal info on this page"},
                choice1["message"],
                {
                    "role": "tool",
                    "name": "scan_dom",
                    "tool_call_id": tool_call_id,
                    "content": json.dumps({"detectionCount": 2, "categorySummary": {"email": 1, "phone": 1}}),
                },
            ],
            "tools": AGENT_TOOLS,
        }

        res2 = client.post("/v1/chat/completions", json=step2_req)
        assert res2.status_code == 200
        choice2 = res2.json()["choices"][0]
        assert choice2["message"]["role"] == "assistant"
        print("[PASS] agent step 2: tool response processed")

    finally:
        settings.BACKEND_MODE = prev


if __name__ == "__main__":
    test_privacy_guard()
    test_tool_registry()
    test_agent_tool_calling_flow()
    print("all part 3 tests passed")
