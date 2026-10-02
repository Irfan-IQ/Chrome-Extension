from typing import Any, Union

try:
    import orjson

    def json_dumps(obj: Any) -> str:
        return orjson.dumps(obj).decode("utf-8")

    def json_dumps_bytes(obj: Any) -> bytes:
        return orjson.dumps(obj)

    def json_loads(data: Union[str, bytes]) -> Any:
        return orjson.loads(data)

    HAS_ORJSON = True

except ImportError:
    import json

    def json_dumps(obj: Any) -> str:
        return json.dumps(obj)

    def json_dumps_bytes(obj: Any) -> bytes:
        return json.dumps(obj).encode("utf-8")

    def json_loads(data: Union[str, bytes]) -> Any:
        return json.loads(data)

    HAS_ORJSON = False
