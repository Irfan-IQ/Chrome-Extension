import logging
from typing import AsyncIterator, Optional
import httpx
from fastapi import HTTPException, status
from pydantic import ValidationError

from config import settings
from engine.base import BaseEngine
from services import get_http_client, json_dumps, json_loads
from schemas import (
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    FunctionCall,
    ToolCall,
)

logger = logging.getLogger("server.vllm")


class VLLMProvider(BaseEngine):
    """High-throughput vLLM adapter for serving Qwen3-VL-30B-A3B on an H200."""

    name: str = "vllm"

    def __init__(self):
        self.endpoint = settings.VLLM_ENDPOINT.rstrip("/")
        self.model = settings.VLLM_MODEL
        self.api_key = settings.VLLM_API_KEY
        self.device = settings.DEVICE

    @property
    def model_name(self) -> str:
        return self.model

    def _get_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def is_healthy(self) -> bool:
        client = get_http_client()
        try:
            res = await client.get(
                f"{self.endpoint}/models",
                headers=self._get_headers(),
                timeout=httpx.Timeout(1.0, connect=0.5),
            )
            return res.status_code == 200
        except Exception:
            return False

    async def warmup(self) -> None:
        """Pre-warm execution graphs and KV cache if vLLM instance is reachable."""
        if not await self.is_healthy():
            logger.info("vLLM runner at %s not running; skipping active warmup", self.endpoint)
            return

        logger.info("warming up vLLM engine at %s with model %s", self.endpoint, self.model)
        warmup_req = ChatCompletionRequest(
            model=self.model,
            messages=[ChatMessage(role="user", content="ping")],
            max_tokens=1,
            stream=False,
        )
        try:
            await self.generate(warmup_req)
            logger.info("vLLM warmup complete")
        except Exception as exc:
            logger.warning("vLLM warmup encountered non-fatal error: %s", exc)

    async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
        model = req.model or self.model
        url = f"{self.endpoint}/chat/completions"

        payload = req.model_dump(exclude_none=True)
        payload["model"] = model
        payload["stream"] = False

        client = get_http_client()
        try:
            res = await client.post(
                url,
                json=payload,
                headers=self._get_headers(),
                timeout=httpx.Timeout(30.0, connect=1.0),
            )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as exc:
            logger.info("vLLM at %s not reachable (%s); using placeholder response", url, exc)
        except httpx.HTTPError as exc:
            logger.warning("vLLM transport error: %s", exc)
        else:
            if res.status_code == 200:
                try:
                    return ChatCompletionResponse.model_validate(res.json())
                except (ValueError, ValidationError) as exc:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"vLLM returned malformed response: {exc}",
                    ) from exc
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"vLLM returned HTTP {res.status_code}: {res.text[:500]}",
            )

        # Offline / developmental placeholder response
        content = (
            f"[vllm placeholder] model: {model}, device: {self.device}. "
            f"no active vLLM instance found at {self.endpoint}."
        )

        last_msg = req.messages[-1] if req.messages else None
        tool_calls = None
        finish_reason = "stop"

        if req.tools and last_msg and last_msg.role == "user":
            tool_names = [t.function.name for t in req.tools]
            if "scan_dom" in tool_names:
                tool_calls = [
                    ToolCall(
                        function=FunctionCall(
                            name="scan_dom",
                            arguments="{}",
                        )
                    )
                ]
                finish_reason = "tool_calls"
                content = None

        return ChatCompletionResponse(
            model=model,
            choices=[
                ChatCompletionResponseChoice(
                    index=0,
                    message=ChatMessage(
                        role="assistant",
                        content=content,
                        tool_calls=tool_calls,
                    ),
                    finish_reason=finish_reason,
                )
            ],
        )

    async def generate_stream(
        self, req: ChatCompletionRequest
    ) -> AsyncIterator[ChatCompletionChunk]:
        """Stream SSE chunks directly from vLLM backend or fall back to simulated stream."""
        model = req.model or self.model
        url = f"{self.endpoint}/chat/completions"

        payload = req.model_dump(exclude_none=True)
        payload["model"] = model
        payload["stream"] = True

        client = get_http_client()
        connected = False

        try:
            async with client.stream(
                "POST",
                url,
                json=payload,
                headers=self._get_headers(),
                timeout=httpx.Timeout(60.0, connect=1.0),
            ) as res:
                if res.status_code == 200:
                    connected = True
                    async for line in res.aiter_lines():
                        line = line.strip()
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk_data = json_loads(data_str)
                            yield ChatCompletionChunk.model_validate(chunk_data)
                        except Exception:
                            continue
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.HTTPError) as exc:
            if not connected:
                logger.info("vLLM streaming at %s unreachable (%s); using default generator", url, exc)
            else:
                logger.warning("vLLM streaming connection interrupted: %s", exc)

        if not connected:
            # Fall back to base class simulated streaming generator
            async for chunk in super().generate_stream(req):
                yield chunk
