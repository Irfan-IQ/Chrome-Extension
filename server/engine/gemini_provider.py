import json
import re
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
from services import gemini_call_to_openai, openai_tools_to_gemini

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"


class GeminiProvider(BaseEngine):
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY.strip()
        self.model = settings.GEMINI_MODEL

    def _parse_data_url(self, url: str):
        match = re.match(r"^data:(image/[a-zA-Z0-9.+]+);base64,(.+)$", url)
        if match:
            return match.group(1), match.group(2)
        return None, None

    def _convert_messages(self, messages):
        system_texts = []
        contents = []

        for msg in messages:
            if msg.role == "system":
                if isinstance(msg.content, str):
                    system_texts.append(msg.content)
                elif isinstance(msg.content, list):
                    for part in msg.content:
                        if part.type == "text" and part.text:
                            system_texts.append(part.text)
                continue

            role = "model" if msg.role == "assistant" else "user"
            parts = []

            if msg.tool_calls:
                for tc in msg.tool_calls:
                    args = {}
                    if tc.function.arguments:
                        try:
                            args = json.loads(tc.function.arguments)
                        except Exception:
                            args = {}
                    parts.append({
                        "functionCall": {
                            "name": tc.function.name,
                            "args": args,
                        }
                    })

            if msg.role == "tool":
                resp = {}
                if msg.content:
                    if isinstance(msg.content, str):
                        try:
                            resp = json.loads(msg.content)
                        except Exception:
                            resp = {"result": msg.content}
                    elif isinstance(msg.content, dict):
                        resp = msg.content
                parts.append({
                    "functionResponse": {
                        "name": msg.name or "tool",
                        "response": resp,
                    }
                })

            if msg.content:
                if isinstance(msg.content, str):
                    parts.append({"text": msg.content})
                elif isinstance(msg.content, list):
                    for part in msg.content:
                        if part.type == "text" and part.text:
                            parts.append({"text": part.text})
                        elif part.type == "image_url" and part.image_url:
                            mime, b64 = self._parse_data_url(part.image_url.url)
                            if mime and b64:
                                parts.append({
                                    "inline_data": {
                                        "mime_type": mime,
                                        "data": b64,
                                    }
                                })

            if parts:
                contents.append({"role": role, "parts": parts})

        system_instruction = None
        if system_texts:
            system_instruction = {"parts": [{"text": "\n\n".join(system_texts)}]}

        return contents, system_instruction

    async def generate(self, req: ChatCompletionRequest) -> ChatCompletionResponse:
        api_key = self.api_key
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="GEMINI_API_KEY not set in server/.env",
            )

        model = req.model or self.model
        endpoint = f"{GEMINI_BASE}{model}:generateContent"

        contents, sys_inst = self._convert_messages(req.messages)
        gemini_tools = openai_tools_to_gemini(req.tools)

        body = {
            "contents": contents,
            "generationConfig": {
                "temperature": req.temperature if req.temperature is not None else 0.1,
                "maxOutputTokens": req.max_tokens or 2048,
            },
        }
        if sys_inst:
            body["system_instruction"] = sys_inst
        if gemini_tools:
            body["tools"] = gemini_tools
            body["toolConfig"] = {"functionCallingConfig": {"mode": "AUTO"}}

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                res = await client.post(
                    endpoint,
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": api_key,
                    },
                    json=body,
                )
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"error reaching gemini: {str(e)}",
                )

        if res.status_code != 200:
            err_msg = res.text
            try:
                err_data = res.json()
                err_msg = err_data.get("error", {}).get("message", err_msg)
            except Exception:
                pass
            raise HTTPException(
                status_code=res.status_code,
                detail=f"gemini error: {err_msg}",
            )

        data = res.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="empty response from gemini",
            )

        cand = candidates[0]
        content = cand.get("content", {})
        parts = content.get("parts", [])

        tool_calls = []
        text_parts = []

        for p in parts:
            if "functionCall" in p:
                tool_calls.append(gemini_call_to_openai(p["functionCall"]))
            elif "text" in p:
                text_parts.append(p["text"])

        finish_reason = "tool_calls" if tool_calls else "stop"
        reply_content = "".join(text_parts).strip() if text_parts else None

        choice = ChatCompletionResponseChoice(
            index=0,
            message=ChatMessage(
                role="assistant",
                content=reply_content,
                tool_calls=tool_calls if tool_calls else None,
            ),
            finish_reason=finish_reason,
        )

        prompt_tokens = data.get("usageMetadata", {}).get("promptTokenCount", 0)
        completion_tokens = data.get("usageMetadata", {}).get("candidatesTokenCount", 0)

        return ChatCompletionResponse(
            model=model,
            choices=[choice],
            usage=UsageInfo(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
        )
