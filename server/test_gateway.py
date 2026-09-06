"""
server/test_gateway.py — Quick automated test for Part 1 FastAPI Gateway endpoints.
"""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Redact Agent Backend Gateway"
    print("[PASS] GET / passed")

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "backend_mode" in data
    assert "device" in data
    print(f"[PASS] GET /health passed (mode: {data['backend_mode']}, device: {data['device']})")

def test_models():
    response = client.get("/v1/models")
    assert response.status_code == 200
    data = response.json()
    assert data["object"] == "list"
    assert len(data["data"]) > 0
    print(f"[PASS] GET /v1/models passed ({len(data['data'])} models available)")

def test_chat_completions():
    payload = {
        "model": "gemini-2.0-flash",
        "messages": [
            {"role": "user", "content": "Hello Redact Agent!"}
        ]
    }
    response = client.post("/v1/chat/completions", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["object"] == "chat.completion"
    assert len(data["choices"]) > 0
    assert data["choices"][0]["message"]["role"] == "assistant"
    print("[PASS] POST /v1/chat/completions passed")

if __name__ == "__main__":
    print("Running Part 1 Gateway verification tests...")
    test_root()
    test_health()
    test_models()
    test_chat_completions()
    print("\nALL PART 1 TESTS PASSED SUCCESSFULLY!")

