import json
from typing import Any, Dict, List, Optional
from schemas import FunctionCall, FunctionDefinition, ToolCall, ToolDefinition

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


def openai_tools_to_gemini(tools: Optional[List[ToolDefinition]]) -> Optional[List[Dict[str, Any]]]:
    if not tools:
        return None
    decls = []
    for t in tools:
        fn = t.function
        decls.append({
            "name": fn.name,
            "description": fn.description or "",
            "parameters": fn.parameters or {"type": "object", "properties": {}},
        })
    return [{"functionDeclarations": decls}]


def gemini_call_to_openai(fn_call: Dict[str, Any]) -> ToolCall:
    name = fn_call.get("name", "")
    args = fn_call.get("args", {})
    return ToolCall(
        function=FunctionCall(
            name=name,
            arguments=json.dumps(args) if isinstance(args, dict) else str(args),
        )
    )


def openai_call_to_gemini(tool_call: ToolCall) -> Dict[str, Any]:
    name = tool_call.function.name
    raw_args = tool_call.function.arguments
    args = {}
    if raw_args:
        try:
            args = json.loads(raw_args)
        except Exception:
            args = {}
    return {
        "functionCall": {
            "name": name,
            "args": args,
        }
    }
