import httpx
import respx
from fastapi.testclient import TestClient
from main import app
from config import settings

client = TestClient(app)


def test_root():
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    print("[PASS] root")


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    print("[PASS] health")


def test_models():
    res = client.get("/v1/models")
    assert res.status_code == 200
    assert len(res.json()["data"]) > 0
    print("[PASS] models")


def test_local_vlm_fallback():
    prev = settings.BACKEND_MODE
    settings.BACKEND_MODE = "local_vlm"
    try:
        payload = {
            "model": "Qwen/Qwen2.5-VL-7B-Instruct",
            "messages": [{"role": "user", "content": "redact page"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "scan_dom",
                        "description": "scan dom",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
        }
        res = client.post("/v1/chat/completions", json=payload)
        assert res.status_code == 200
        choice = res.json()["choices"][0]
        assert choice["finish_reason"] == "tool_calls"
        assert choice["message"]["tool_calls"][0]["function"]["name"] == "scan_dom"
        print("[PASS] local vlm tool call fallback")
    finally:
        settings.BACKEND_MODE = prev


def test_gemini_auth_guard():
    prev_mode = settings.BACKEND_MODE
    prev_key = settings.GEMINI_API_KEY
    settings.BACKEND_MODE = "gemini_cloud"
    settings.GEMINI_API_KEY = ""
    try:
        payload = {
            "model": settings.GEMINI_MODEL,
            "messages": [{"role": "user", "content": "hello"}],
        }
        res = client.post("/v1/chat/completions", json=payload)
        assert res.status_code == 401
        print("[PASS] gemini auth guard")
    finally:
        settings.BACKEND_MODE = prev_mode
        settings.GEMINI_API_KEY = prev_key


def test_gemini_happy_path_mocked():
    """GeminiProvider should translate a real-shaped Gemini response into
    an OpenAI-style ChatCompletionResponse. The outbound call is mocked
    so no real API key or network access is required."""
    prev_mode = settings.BACKEND_MODE
    prev_key = settings.GEMINI_API_KEY
    settings.BACKEND_MODE = "gemini_cloud"
    settings.GEMINI_API_KEY = "test-key"
    try:
        with respx.mock(base_url="https://generativelanguage.googleapis.com") as mock:
            mock.post(url__regex=r"/v1beta/models/.*:generateContent").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "candidates": [{
                            "content": {
                                "role": "model",
                                "parts": [{"text": "hello back"}],
                            },
                            "finishReason": "STOP",
                        }],
                        "usageMetadata": {
                            "promptTokenCount": 4,
                            "candidatesTokenCount": 2,
                        },
                    },
                )
            )
            res = client.post("/v1/chat/completions", json={
                "model": settings.GEMINI_MODEL,
                "messages": [{"role": "user", "content": "hi"}],
            })
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["choices"][0]["message"]["content"] == "hello back"
        assert body["usage"]["total_tokens"] == 6
        print("[PASS] gemini happy path (mocked)")
    finally:
        settings.BACKEND_MODE = prev_mode
        settings.GEMINI_API_KEY = prev_key


def test_gemini_upstream_error_mocked():
    """A Gemini 500 must surface as a 500 to the caller, with the error
    message passed through."""
    prev_mode = settings.BACKEND_MODE
    prev_key = settings.GEMINI_API_KEY
    settings.BACKEND_MODE = "gemini_cloud"
    settings.GEMINI_API_KEY = "test-key"
    try:
        with respx.mock(base_url="https://generativelanguage.googleapis.com") as mock:
            mock.post(url__regex=r"/v1beta/models/.*:generateContent").mock(
                return_value=httpx.Response(500, json={"error": {"message": "upstream exploded"}})
            )
            res = client.post("/v1/chat/completions", json={
                "model": settings.GEMINI_MODEL,
                "messages": [{"role": "user", "content": "hi"}],
            })
        assert res.status_code == 500
        assert "upstream exploded" in res.json()["detail"]
        print("[PASS] gemini upstream error (mocked)")
    finally:
        settings.BACKEND_MODE = prev_mode
        settings.GEMINI_API_KEY = prev_key


def test_auth_token_required_when_set():
    """When AUTH_TOKEN is configured, calls without the matching header
    are rejected before they ever reach the engine."""
    prev_token = settings.AUTH_TOKEN
    prev_mode = settings.BACKEND_MODE
    settings.AUTH_TOKEN = "s3cret"
    settings.BACKEND_MODE = "local_vlm"
    try:
        payload = {"model": "x", "messages": [{"role": "user", "content": "hi"}]}

        res_missing = client.post("/v1/chat/completions", json=payload)
        assert res_missing.status_code == 401

        res_wrong = client.post(
            "/v1/chat/completions", json=payload,
            headers={"X-Redact-Agent-Token": "nope"},
        )
        assert res_wrong.status_code == 401

        res_ok = client.post(
            "/v1/chat/completions", json=payload,
            headers={"X-Redact-Agent-Token": "s3cret"},
        )
        assert res_ok.status_code == 200

        # Metadata endpoints stay open even when auth is on.
        assert client.get("/health").status_code == 200
        print("[PASS] auth token enforced on /v1/chat/completions")
    finally:
        settings.AUTH_TOKEN = prev_token
        settings.BACKEND_MODE = prev_mode


def test_local_vlm_bad_response_surfaces_error():
    """A reachable-but-broken local VLM must raise 502 instead of silently
    falling back to the placeholder (prevents masking real bugs)."""
    prev_mode = settings.BACKEND_MODE
    prev_endpoint = getattr(settings, "LOCAL_VLM_ENDPOINT", "")
    settings.BACKEND_MODE = "local_vlm"
    try:
        with respx.mock() as mock:
            mock.post(url__regex=r".*/chat/completions$").mock(
                return_value=httpx.Response(500, text="internal boom")
            )
            res = client.post("/v1/chat/completions", json={
                "model": "Qwen/Qwen2.5-VL-7B-Instruct",
                "messages": [{"role": "user", "content": "hi"}],
            })
        assert res.status_code == 502
        assert "500" in res.json()["detail"]
        print("[PASS] local vlm 5xx surfaces as 502")
    finally:
        settings.BACKEND_MODE = prev_mode


if __name__ == "__main__":
    test_root()
    test_health()
    test_models()
    test_local_vlm_fallback()
    test_gemini_auth_guard()
    test_gemini_happy_path_mocked()
    test_gemini_upstream_error_mocked()
    test_auth_token_required_when_set()
    test_local_vlm_bad_response_surfaces_error()
    print("all tests passed")
