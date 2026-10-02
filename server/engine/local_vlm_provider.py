import json
import logging
import httpx
from fastapi import HTTPException, status
from pydantic import ValidationError

from config import settings
from engine.base import BaseEngine
from services import get_http_client
from schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    FunctionCall,
    ToolCall,
    UsageInfo,
)

logger = logging.getLogger("server.local_vlm")


class LocalVLMProvider(BaseEngine):
    name: str = "local_vlm"

    def __init__(self):
        self.endpoint = settings.LOCAL_VLM_ENDPOINT.rstrip("/")
        self.model = settings.LOCAL_VLM_MODEL
        self.device = settings.DEVICE

    @property
    def model_name(self) -> str:
        return self.model

    async def is_healthy(self) -> bool:
        client = get_http_client()
        try:
            res = await client.get(f"{self.endpoint}/models", timeout=httpx.Timeout(1.0))
            return res.status_code == 200
        except Exception:
            return False


    async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
        model = req.model or self.model
        url = f"{self.endpoint}/chat/completions"

        payload = req.model_dump(exclude_none=True)
        payload["model"] = model

        # Error-handling policy:
        #   * Connection / DNS / timeout error → treat as "no local runner
        #     attached" and fall through to the deterministic placeholder
        #     response. This keeps the dev loop ergonomic — people can run
        #     the server without having Ollama / vLLM up.
        #   * HTTP response arrived but non-2xx, or 2xx with malformed body
        #     → the runner is attached but misbehaving. Surface the error
        #     so bugs don't hide behind the placeholder.
        client = get_http_client()
        try:
            res = await client.post(url, json=payload, timeout=httpx.Timeout(10.0, connect=1.0))
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout) as exc:
            logger.info("local VLM at %s not reachable (%s); using placeholder response", url, exc)
        except httpx.HTTPError as exc:
            # Unexpected transport-layer httpx error. Log at WARNING so it
            # is visible, but still return the placeholder — the request
            # must not 500 just because the optional local VLM failed.
            logger.warning("local VLM transport error: %s", exc)
        else:
            if res.status_code == 200:
                try:
                    return ChatCompletionResponse.model_validate(res.json())
                except (ValueError, ValidationError) as exc:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"local VLM returned a malformed response: {exc}",
                    ) from exc
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"local VLM returned HTTP {res.status_code}: {res.text[:500]}",
            )

        content = (
            f"[local vlm placeholder] model: {model}, device: {self.device}. "
            f"no active local runner found at {self.endpoint}."
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
            usage=UsageInfo(prompt_tokens=10, completion_tokens=10, total_tokens=20),
        )
