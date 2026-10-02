import argparse
import asyncio
import json
import math
import statistics
import time
from typing import Any, Dict, List, Optional
import httpx


DEFAULT_PAYLOAD: Dict[str, Any] = {
    "model": "Qwen/Qwen2.5-14B-Instruct",
    "messages": [
        {"role": "system", "content": "You are a helpful and fast assistant."},
        {"role": "user", "content": "Ping test for server latency and throughput."},
    ],
    "temperature": 0.1,
    "max_tokens": 64,
    "stream": False,
}

EXTENSION_SAMPLE_PAYLOAD: Dict[str, Any] = {
    "model": "Qwen/Qwen2.5-14B-Instruct",
    "messages": [
        {
            "role": "system",
            "content": "You are the Redact Agent. Analyze DOM and visual content to detect sensitive information.",
        },
        {
            "role": "user",
            "content": "Scan the current page for any PII like emails or SSNs.",
        },
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "scan_dom",
                "description": "Scans visible DOM tree for textual PII elements",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "categories": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Categories to inspect",
                        }
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "redact",
                "description": "Redacts target element by id with specified technique",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "targetId": {"type": "string"},
                        "method": {"type": "string"},
                    },
                    "required": ["targetId"],
                },
            },
        },
    ],
    "tool_choice": "auto",
    "temperature": 0.1,
    "max_tokens": 512,
    "stream": False,
}


async def send_single_request(
    client: httpx.AsyncClient,
    url: str,
    payload: Dict[str, Any],
    headers: Dict[str, str],
) -> Dict[str, Any]:
    t0 = time.perf_counter()
    status_code = 0
    error: Optional[str] = None
    ttft: Optional[float] = None
    total_time: float = 0.0

    try:
        if payload.get("stream"):
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                status_code = response.status_code
                async for chunk in response.aiter_raw():
                    if ttft is None and chunk:
                        ttft = time.perf_counter() - t0
                total_time = time.perf_counter() - t0
        else:
            response = await client.post(url, json=payload, headers=headers)
            status_code = response.status_code
            total_time = time.perf_counter() - t0
            ttft = total_time
            if response.status_code >= 400:
                error = f"HTTP {response.status_code}: {response.text[:120]}"
    except Exception as exc:
        total_time = time.perf_counter() - t0
        error = str(exc)

    return {
        "status_code": status_code,
        "latency_sec": total_time,
        "ttft_sec": ttft or total_time,
        "error": error,
    }


async def run_worker(
    worker_id: int,
    queue: asyncio.Queue,
    client: httpx.AsyncClient,
    url: str,
    payload: Dict[str, Any],
    headers: Dict[str, str],
    results: List[Dict[str, Any]],
):
    while not queue.empty():
        try:
            _ = queue.get_nowait()
        except asyncio.QueueEmpty:
            break

        res = await send_single_request(client, url, payload, headers)
        results.append(res)
        queue.task_done()


def print_summary(results: List[Dict[str, Any]], total_elapsed: float, concurrency: int):
    total_reqs = len(results)
    successes = [r for r in results if 200 <= r["status_code"] < 300]
    failures = [r for r in results if r["error"] or r["status_code"] >= 400]

    latencies_ms = [r["latency_sec"] * 1000.0 for r in successes]
    ttft_ms = [r["ttft_sec"] * 1000.0 for r in successes if r.get("ttft_sec")]

    rps = total_reqs / total_elapsed if total_elapsed > 0 else 0.0

    print("\n" + "=" * 55)
    print("           REDACT AGENT SERVER BENCHMARK RESULTS")
    print("=" * 55)
    print(f"Total Requests:       {total_reqs}")
    print(f"Concurrency:          {concurrency}")
    print(f"Total Time Taken:     {total_elapsed:.2f} s")
    print(f"Throughput (RPS):     {rps:.2f} req/s")
    print(f"Success Count:        {len(successes)}")
    print(f"Failure Count:        {len(failures)}")

    if latencies_ms:
        latencies_ms.sort()
        print("\n--- Latency Distribution (ms) ---")
        print(f"Min:                  {min(latencies_ms):.2f} ms")
        print(f"Average:              {statistics.mean(latencies_ms):.2f} ms")
        print(f"Median (P50):         {statistics.median(latencies_ms):.2f} ms")
        p90_idx = max(0, min(len(latencies_ms) - 1, math.ceil(0.90 * len(latencies_ms)) - 1))
        p95_idx = max(0, min(len(latencies_ms) - 1, math.ceil(0.95 * len(latencies_ms)) - 1))
        p99_idx = max(0, min(len(latencies_ms) - 1, math.ceil(0.99 * len(latencies_ms)) - 1))
        print(f"P90:                  {latencies_ms[p90_idx]:.2f} ms")
        print(f"P95:                  {latencies_ms[p95_idx]:.2f} ms")
        print(f"P99:                  {latencies_ms[p99_idx]:.2f} ms")
        print(f"Max:                  {max(latencies_ms):.2f} ms")

    if ttft_ms:
        print(f"Avg TTFT:             {statistics.mean(ttft_ms):.2f} ms")

    if failures:
        print("\n--- Errors Sample ---")
        for f in failures[:5]:
            print(f"  [Status {f['status_code']}]: {f['error']}")

    print("=" * 55 + "\n")


async def verify_extension_contract(
    client: httpx.AsyncClient,
    base_url: str = "http://127.0.0.1:8000",
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, bool]:
    """
    Verifies that the server strictly complies with Chrome Extension's contract:
    1. /health returns 200, status='ok', active_model, backend_mode
    2. /metrics returns 200, uptime_seconds, requests_per_second, p95_latency_ms
    3. /v1/models returns standard OpenAI list
    4. /v1/chat/completions non-streaming returns standard OpenAI format with choices/message
    5. /v1/chat/completions streaming returns text/event-stream chunks ending with data: [DONE]
    """
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    base_url = base_url.rstrip("/")
    results: Dict[str, bool] = {}

    # 1. Health contract
    h_resp = await client.get(f"{base_url}/health", headers=req_headers)
    assert h_resp.status_code == 200, f"/health returned status {h_resp.status_code}"
    h_json = h_resp.json()
    assert h_json.get("status") == "ok", "Expected status='ok' in /health response"
    assert "active_model" in h_json, "Missing active_model in /health"
    assert "backend_mode" in h_json, "Missing backend_mode in /health"
    results["health_endpoint"] = True

    # 2. Metrics contract
    m_resp = await client.get(f"{base_url}/metrics", headers=req_headers)
    assert m_resp.status_code == 200, f"/metrics returned status {m_resp.status_code}"
    m_json = m_resp.json()
    assert "uptime_seconds" in m_json, "Missing uptime_seconds in /metrics"
    assert "p95_latency_ms" in m_json, "Missing p95_latency_ms in /metrics"
    assert "requests_per_second" in m_json, "Missing requests_per_second in /metrics"
    results["metrics_endpoint"] = True

    # 3. Models contract
    models_resp = await client.get(f"{base_url}/v1/models", headers=req_headers)
    assert models_resp.status_code == 200, f"/v1/models returned status {models_resp.status_code}"
    models_json = models_resp.json()
    assert models_json.get("object") == "list", "Expected object='list' in /v1/models"
    assert isinstance(models_json.get("data"), list), "Expected data list in /v1/models"
    results["models_endpoint"] = True

    # 4. Chat completions non-streaming
    payload = dict(EXTENSION_SAMPLE_PAYLOAD)
    payload["stream"] = False
    chat_resp = await client.post(f"{base_url}/v1/chat/completions", json=payload, headers=req_headers)
    assert chat_resp.status_code == 200, f"/v1/chat/completions returned status {chat_resp.status_code}"
    chat_json = chat_resp.json()
    assert "choices" in chat_json and len(chat_json["choices"]) > 0, "No choices in chat completions response"
    choice = chat_json["choices"][0]
    assert "message" in choice, "No message in chat completion choice"
    msg = choice["message"]
    assert msg.get("role") == "assistant", f"Expected role assistant, got {msg.get('role')}"
    has_content = msg.get("content") is not None
    has_tools = msg.get("tool_calls") is not None
    assert has_content or has_tools, "Choice must contain either content or tool_calls"
    results["chat_completions_non_streaming"] = True

    # 5. Chat completions SSE streaming
    stream_payload = dict(EXTENSION_SAMPLE_PAYLOAD)
    stream_payload["stream"] = True
    async with client.stream("POST", f"{base_url}/v1/chat/completions", json=stream_payload, headers=req_headers) as s_resp:
        assert s_resp.status_code == 200, f"Streaming returned status {s_resp.status_code}"
        assert "text/event-stream" in s_resp.headers.get("content-type", "")
        chunks = []
        async for line in s_resp.aiter_lines():
            clean = line.strip()
            if clean.startswith("data:"):
                chunks.append(clean[5:].strip())
        assert len(chunks) > 0, "No SSE chunks received"
        assert chunks[-1] == "[DONE]", f"Final chunk was not [DONE], got {chunks[-1]}"
    results["chat_completions_sse_streaming"] = True

    return results


async def run_stress_benchmark(
    client: httpx.AsyncClient,
    url: str,
    payload: Dict[str, Any],
    headers: Dict[str, str],
    concurrency: int = 5,
    total_requests: int = 20,
) -> Dict[str, Any]:
    queue: asyncio.Queue = asyncio.Queue()
    for i in range(total_requests):
        queue.put_nowait(i)

    results: List[Dict[str, Any]] = []
    t0 = time.perf_counter()

    workers = [
        asyncio.create_task(
            run_worker(i, queue, client, url, payload, headers, results)
        )
        for i in range(concurrency)
    ]
    await asyncio.gather(*workers)
    total_elapsed = time.perf_counter() - t0

    successes = [r for r in results if 200 <= r["status_code"] < 300]
    latencies_ms = [r["latency_sec"] * 1000.0 for r in successes]

    p95 = 0.0
    if latencies_ms:
        sorted_lats = sorted(latencies_ms)
        p95_idx = max(0, min(len(sorted_lats) - 1, math.ceil(0.95 * len(sorted_lats)) - 1))
        p95 = sorted_lats[p95_idx]

    return {
        "total_requests": len(results),
        "concurrency": concurrency,
        "total_time_sec": round(total_elapsed, 3),
        "rps": round(len(results) / total_elapsed, 2) if total_elapsed > 0 else 0.0,
        "success_count": len(successes),
        "failure_count": len(results) - len(successes),
        "avg_latency_ms": round(statistics.mean(latencies_ms), 2) if latencies_ms else 0.0,
        "p95_latency_ms": round(p95, 2),
        "results": results,
    }


async def main():
    parser = argparse.ArgumentParser(description="Redact Agent Server Latency & Concurrency Benchmark")
    parser.add_argument("--url", default="http://127.0.0.1:8000/v1/chat/completions", help="Endpoint to benchmark")
    parser.add_argument("--health-url", default="http://127.0.0.1:8000/health", help="Healthcheck URL")
    parser.add_argument("--concurrency", "-c", type=int, default=5, help="Number of concurrent client workers")
    parser.add_argument("--requests", "-n", type=int, default=20, help="Total requests to fire")
    parser.add_argument("--token", default="", help="Optional X-Redact-Agent-Token value")
    parser.add_argument("--stream", action="store_true", help="Send requests with stream=True")
    parser.add_argument("--prompt", default="", help="Custom prompt to benchmark")
    parser.add_argument("--verify-contract", action="store_true", help="Verify extension API contract compatibility")
    args = parser.parse_args()

    headers = {"Content-Type": "application/json"}
    if args.token:
        headers["X-Redact-Agent-Token"] = args.token

    payload = dict(DEFAULT_PAYLOAD)
    if args.stream:
        payload["stream"] = True
    if args.prompt:
        payload["messages"][-1]["content"] = args.prompt

    limits = httpx.Limits(max_keepalive_connections=args.concurrency * 2, max_connections=args.concurrency * 4)
    async with httpx.AsyncClient(timeout=30.0, limits=limits) as client:
        base_u = args.url.split("/v1")[0] if "/v1" in args.url else "http://127.0.0.1:8000"

        if args.verify_contract:
            print("\n--- Verifying Chrome Extension Contract Compatibility ---")
            try:
                contract_res = await verify_extension_contract(client, base_url=base_u, headers=headers)
                for k, v in contract_res.items():
                    print(f"  [OK] {k}: passed")
                print("--- Extension Contract Verified Successfully ---\n")
            except Exception as e:
                print(f"  [FAIL] Contract verification failed: {e}\n")

        print(f"Target URL:         {args.url}")
        print(f"Total Requests:     {args.requests}")
        print(f"Concurrency:        {args.concurrency}")
        print(f"Streaming:          {args.stream}")

        try:
            h_res = await client.get(args.health_url)
            print(f"Server health check: {h_res.status_code} ({h_res.text[:80]})")
        except Exception as e:
            print(f"Warning: healthcheck failed ({e}). Proceeding anyway...")

        summary = await run_stress_benchmark(
            client=client,
            url=args.url,
            payload=payload,
            headers=headers,
            concurrency=args.concurrency,
            total_requests=args.requests,
        )

        print_summary(summary["results"], summary["total_time_sec"], summary["concurrency"])


if __name__ == "__main__":
    asyncio.run(main())
