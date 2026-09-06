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
            "model": "gemini-2.0-flash",
            "messages": [{"role": "user", "content": "hello"}],
        }
        res = client.post("/v1/chat/completions", json=payload)
        assert res.status_code == 401
        print("[PASS] gemini auth guard")
    finally:
        settings.BACKEND_MODE = prev_mode
        settings.GEMINI_API_KEY = prev_key


if __name__ == "__main__":
    test_root()
    test_health()
    test_models()
    test_local_vlm_fallback()
    test_gemini_auth_guard()
    print("all tests passed")
