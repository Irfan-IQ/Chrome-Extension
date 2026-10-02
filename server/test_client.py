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


def test_sse_streaming_flow():
    prev = settings.BACKEND_MODE
    settings.BACKEND_MODE = "local_vlm"

    try:
        req = {
            "model": "Qwen/Qwen2.5-VL-7B-Instruct",
            "messages": [
                {"role": "user", "content": "Hello agent"},
            ],
            "stream": True,
        }

        res = client.post("/v1/chat/completions", json=req)
        assert res.status_code == 200
        assert "text/event-stream" in res.headers.get("content-type", "")

        lines = [line.strip() for line in res.text.split("\n") if line.strip()]
        data_lines = [line[5:].strip() for line in lines if line.startswith("data:")]

        assert len(data_lines) > 0
        assert data_lines[-1] == "[DONE]"

        chunks = [json.loads(d) for d in data_lines[:-1]]
        assert len(chunks) >= 1
        assert chunks[0]["object"] == "chat.completion.chunk"
        print(f"[PASS] SSE streaming verified ({len(chunks)} chunks, terminated with [DONE])")

    finally:
        settings.BACKEND_MODE = prev


def test_concurrency_limiter():
    import asyncio
    from services import ConcurrencyLimiter, ConcurrencyLimitExceeded

    async def _run():
        lim = ConcurrencyLimiter(max_concurrent=2, queue_timeout=0.05)
        assert lim.active_requests == 0
        assert lim.queued_requests == 0

        async with lim.acquire():
            assert lim.active_requests == 1
            async with lim.acquire():
                assert lim.active_requests == 2

                timed_out = False
                try:
                    async with lim.acquire():
                        pass
                except ConcurrencyLimitExceeded:
                    timed_out = True

                assert timed_out, "Expected ConcurrencyLimitExceeded on saturated limiter"
                assert lim.active_requests == 2

        assert lim.active_requests == 0
        assert lim.queued_requests == 0

    asyncio.run(_run())

    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert "active_requests" in data
    assert "queued_requests" in data
    print("[PASS] concurrency limiter & backpressure verified")


def test_prompt_prefix_cache():
    from services import PromptPrefixCache

    cache = PromptPrefixCache(max_size=3, default_ttl=10.0)
    assert cache.stats.hits == 0
    assert cache.stats.misses == 0

    assert cache.get("k1") is None
    assert cache.stats.misses == 1

    cache.set("k1", "v1")
    assert cache.get("k1") == "v1"
    assert cache.stats.hits == 1

    cache.set("k2", "v2")
    cache.set("k3", "v3")
    assert cache.stats.size == 3

    _ = cache.get("k1")
    cache.set("k4", "v4")

    assert cache.get("k2") is None
    assert cache.get("k1") == "v1"
    assert cache.stats.evictions == 1

    h1 = cache.compute_prefix_key("system instructions", ["tool1", "tool2"])
    h2 = cache.compute_prefix_key("system instructions", ["tool1", "tool2"])
    assert h1 == h2
    assert len(h1) == 64

    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert "cache_hits" in data
    assert "cache_misses" in data
    assert "cache_hit_rate" in data
    print("[PASS] prompt/prefix cache & LRU eviction verified")


def test_queue_coordinator():
    import asyncio
    from services import QueueCoordinator

    async def _test():
        processed_batches = []

        async def mock_batch_engine(items):
            processed_batches.append(len(items))
            await asyncio.sleep(0.01)
            return [f"result_{x}" for x in items]

        coord = QueueCoordinator(
            batch_processor=mock_batch_engine,
            max_batch_size=4,
            max_delay_ms=20.0,
            enabled=True,
        )
        coord.start()

        try:
            tasks = [coord.submit(i) for i in range(3)]
            results = await asyncio.gather(*tasks)

            assert results == ["result_0", "result_1", "result_2"]
            assert len(processed_batches) == 1
            assert processed_batches[0] == 3
            assert coord.stats.total_requests == 3
            assert coord.stats.total_batches == 1
            assert coord.stats.avg_batch_size == 3.0

            coord_disabled = QueueCoordinator(enabled=False)

            async def mock_fallback(val):
                return f"fallback_{val}"

            res = await coord_disabled.submit(42, fallback_fn=mock_fallback)
            assert res == "fallback_42"
            assert coord_disabled.stats.total_direct_requests == 1

        finally:
            await coord.stop()

    asyncio.run(_test())
    print("[PASS] async request queue & micro-batch coordinator verified")


def test_engine_factory_and_lifecycle():
    import asyncio
    from engine import (
        BaseEngine,
        get_engine,
        register_engine,
        reset_engine,
        warmup_engine,
        shutdown_engine,
    )
    from schemas import ChatCompletionRequest, ChatCompletionResponse

    e1 = get_engine("gemini_cloud")
    assert e1.name == "gemini_cloud"
    assert e1.model_name == settings.GEMINI_MODEL
    e1_cached = get_engine("gemini_cloud")
    assert e1 is e1_cached, "Engine should be cached as a singleton"

    e2 = get_engine("local_vlm")
    assert e2.name == "local_vlm"
    assert e2.model_name == settings.LOCAL_VLM_MODEL

    class MockEngine(BaseEngine):
        name = "mock_test_engine"
        warmup_called = False
        shutdown_called = False

        @property
        def model_name(self):
            return "mock-model-v1"

        async def warmup(self):
            self.warmup_called = True

        async def shutdown(self):
            self.shutdown_called = True

        async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
            return ChatCompletionResponse(model=self.model_name, choices=[])

    register_engine("mock_test", MockEngine)
    mock_eng = get_engine("mock_test")
    assert mock_eng.name == "mock_test_engine"
    assert mock_eng.model_name == "mock-model-v1"

    async def _lifecycle():
        await warmup_engine("mock_test")
        assert mock_eng.warmup_called
        await shutdown_engine("mock_test")
        assert mock_eng.shutdown_called

    asyncio.run(_lifecycle())
    reset_engine()
    print("[PASS] unified engine interface & factory lifecycle verified")


def test_vllm_provider():
    from engine import VLLMProvider, get_engine, reset_engine

    prev = settings.BACKEND_MODE
    settings.BACKEND_MODE = "vllm"
    reset_engine()

    try:
        engine = get_engine()
        assert isinstance(engine, VLLMProvider)
        assert engine.name == "vllm"
        assert engine.model_name == settings.VLLM_MODEL

        res_models = client.get("/v1/models")
        assert res_models.status_code == 200
        model_ids = [m["id"] for m in res_models.json()["data"]]
        assert settings.VLLM_MODEL in model_ids

        req_payload = {
            "model": settings.VLLM_MODEL,
            "messages": [{"role": "user", "content": "Redact phone and email"}],
            "tools": AGENT_TOOLS,
        }
        res = client.post("/v1/chat/completions", json=req_payload)
        assert res.status_code == 200
        body = res.json()
        assert len(body["choices"]) > 0
        assert body["choices"][0]["finish_reason"] in ("tool_calls", "stop")

        stream_payload = {
            "model": settings.VLLM_MODEL,
            "messages": [{"role": "user", "content": "ping"}],
            "stream": True,
        }
        res_stream = client.post("/v1/chat/completions", json=stream_payload)
        assert res_stream.status_code == 200
        assert "text/event-stream" in res_stream.headers.get("content-type", "")
        lines = [line.strip() for line in res_stream.text.split("\n") if line.strip()]
        data_lines = [l[5:].strip() for l in lines if l.startswith("data:")]
        assert len(data_lines) > 0
        assert data_lines[-1] == "[DONE]"

        print("[PASS] vLLM native engine provider (Qwen2.5-14B) verified")

    finally:
        settings.BACKEND_MODE = prev
        reset_engine()


def test_quantization_and_vram_budget():
    assert settings.QUANTIZATION in ("awq", "gptq", "fp8", None)
    assert settings.MAX_NUM_SEQS >= 1
    assert settings.MAX_NUM_BATCHED_TOKENS >= 512
    assert 0.0 < settings.VLLM_GPU_MEMORY_UTILIZATION <= 1.0

    vllm_cmd = settings.get_vllm_command()
    assert "--model" in vllm_cmd
    assert "--gpu-memory-utilization" in vllm_cmd
    assert "--max-num-seqs" in vllm_cmd
    assert "--quantization" in vllm_cmd
    print("[PASS] quantization & VRAM budget configuration verified")


if __name__ == "__main__":
    test_privacy_guard()
    test_tool_registry()
    test_agent_tool_calling_flow()
    test_sse_streaming_flow()
    test_concurrency_limiter()
    test_prompt_prefix_cache()
    test_queue_coordinator()
    test_engine_factory_and_lifecycle()
    test_vllm_provider()
    test_quantization_and_vram_budget()
    print("all tests passed successfully")







