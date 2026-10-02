import argparse
import asyncio
import json
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
        p90_idx = int(len(latencies_ms) * 0.90)
        p95_idx = int(len(latencies_ms) * 0.95)
        p99_idx = int(len(latencies_ms) * 0.99)
        print(f"P90:                  {latencies_ms[min(p90_idx, len(latencies_ms) - 1)]:.2f} ms")
        print(f"P95:                  {latencies_ms[min(p95_idx, len(latencies_ms) - 1)]:.2f} ms")
        print(f"P99:                  {latencies_ms[min(p99_idx, len(latencies_ms) - 1)]:.2f} ms")
        print(f"Max:                  {max(latencies_ms):.2f} ms")

    if ttft_ms:
        print(f"Avg TTFT:             {statistics.mean(ttft_ms):.2f} ms")

    if failures:
        print("\n--- Errors Sample ---")
        for f in failures[:5]:
            print(f"  [Status {f['status_code']}]: {f['error']}")

    print("=" * 55 + "\n")


async def main():
    parser = argparse.ArgumentParser(description="Redact Agent Server Latency & Concurrency Benchmark")
    parser.add_argument("--url", default="http://127.0.0.1:8000/v1/chat/completions", help="Endpoint to benchmark")
    parser.add_argument("--health-url", default="http://127.0.0.1:8000/health", help="Healthcheck URL")
    parser.add_argument("--concurrency", "-c", type=int, default=5, help="Number of concurrent client workers")
    parser.add_argument("--requests", "-n", type=int, default=20, help="Total requests to fire")
    parser.add_argument("--token", default="", help="Optional X-Redact-Agent-Token value")
    parser.add_argument("--stream", action="store_true", help="Send requests with stream=True")
    parser.add_argument("--prompt", default="", help="Custom prompt to benchmark")
    args = parser.parse_args()

    headers = {"Content-Type": "application/json"}
    if args.token:
        headers["X-Redact-Agent-Token"] = args.token

    payload = dict(DEFAULT_PAYLOAD)
    if args.stream:
        payload["stream"] = True
    if args.prompt:
        payload["messages"][-1]["content"] = args.prompt

    print(f"Target URL:         {args.url}")
    print(f"Total Requests:     {args.requests}")
    print(f"Concurrency:        {args.concurrency}")
    print(f"Streaming:          {args.stream}")

    limits = httpx.Limits(max_keepalive_connections=args.concurrency * 2, max_connections=args.concurrency * 4)
    async with httpx.AsyncClient(timeout=30.0, limits=limits) as client:
        # Pre-check health
        try:
            h_res = await client.get(args.health_url)
            print(f"Server health check: {h_res.status_code} ({h_res.text[:80]})")
        except Exception as e:
            print(f"Warning: healthcheck failed ({e}). Proceeding anyway...")

        queue: asyncio.Queue = asyncio.Queue()
        for i in range(args.requests):
            queue.put_nowait(i)

        results: List[Dict[str, Any]] = []
        t0 = time.perf_counter()

        workers = [
            asyncio.create_task(
                run_worker(i, queue, client, args.url, payload, headers, results)
            )
            for i in range(args.concurrency)
        ]

        await asyncio.gather(*workers)
        total_elapsed = time.perf_counter() - t0

        print_summary(results, total_elapsed, args.concurrency)


if __name__ == "__main__":
    asyncio.run(main())
