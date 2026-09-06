from fastapi.testclient import TestClient
from main import app

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

def test_completions():
    payload = {
        "model": "gemini-2.0-flash",
        "messages": [{"role": "user", "content": "ping"}]
    }
    res = client.post("/v1/chat/completions", json=payload)
    assert res.status_code == 200
    assert res.json()["choices"][0]["message"]["role"] == "assistant"
    print("[PASS] chat completions")

if __name__ == "__main__":
    test_root()
    test_health()
    test_models()
    test_completions()
    print("all tests passed")
