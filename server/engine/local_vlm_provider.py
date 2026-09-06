import json
import httpx
from fastapi import HTTPException, status

from config import settings
from engine.base import BaseEngine
from schemas import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    FunctionCall,
    ToolCall,
    UsageInfo,
)


class LocalVLMProvider(BaseEngine):
    def __init__(self):
        self.endpoint = settings.LOCAL_VLM_ENDPOINT.rstrip("/")
        self.model = settings.LOCAL_VLM_MODEL
        self.device = settings.DEVICE

    async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
        model = req.model or self.model
        url = f"{self.endpoint}/chat/completions"

        payload = req.model_dump(exclude_none=True)
        payload["model"] = model

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=1.0)) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    return ChatCompletionResponse.model_validate(data)
        except Exception:
            pass

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
