from typing import Any, Dict, List, Optional
from schemas import FunctionCall, FunctionDefinition, ToolCall, ToolDefinition
from services.json_utils import json_dumps, json_loads

KNOWN_TOOLS = {
    "scan_dom",
    "take_screenshot",
    "scan_ocr",
    "fuse_detections",
    "redact",
    "verify_redaction",
    "get_page_context",
    "click_element",
    "navigate_to",
    "open_tab",
}


def is_known_tool(name: str) -> bool:
    return name in KNOWN_TOOLS


from services.cache_service import get_cache_service


def openai_tools_to_gemini(tools: Optional[List[ToolDefinition]]) -> Optional[List[Dict[str, Any]]]:
    if not tools:
        return None

    cache = get_cache_service()
    key_str = "|".join(f"{t.function.name}:{t.function.description}:{id(t)}" for t in tools)
    cache_key = f"gemini_tools:{cache._hash_key(key_str)}"

    def _convert():
        decls = []
        for t in tools:
            fn = t.function
            decls.append({
                "name": fn.name,
                "description": fn.description or "",
                "parameters": fn.parameters or {"type": "object", "properties": {}},
            })
        return [{"functionDeclarations": decls}]

    return cache.get_or_compute(cache_key, _convert)



def gemini_call_to_openai(fn_call: Dict[str, Any]) -> ToolCall:
    name = fn_call.get("name", "")
    args = fn_call.get("args", {})
    return ToolCall(
        function=FunctionCall(
            name=name,
            arguments=json_dumps(args) if isinstance(args, dict) else str(args),
        )
    )


def openai_call_to_gemini(tool_call: ToolCall) -> Dict[str, Any]:
    name = tool_call.function.name
    raw_args = tool_call.function.arguments
    args = {}
    if raw_args:
        try:
            args = json_loads(raw_args)
        except Exception:
            args = {}
    return {
        "functionCall": {
            "name": name,
            "args": args,
        }
    }
