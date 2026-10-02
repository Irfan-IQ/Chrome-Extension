import logging
from typing import Optional
import httpx

logger = logging.getLogger("server.http_client")

_shared_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    """Return a shared, persistent httpx.AsyncClient with connection pooling."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        limits = httpx.Limits(
            max_keepalive_connections=50,
            max_connections=200,
            keepalive_expiry=30.0,
        )
        _shared_client = httpx.AsyncClient(
            limits=limits,
            timeout=httpx.Timeout(30.0, connect=5.0),
        )
        logger.debug("created shared persistent httpx.AsyncClient")
    return _shared_client


async def close_http_client():
    """Close the shared client on server shutdown."""
    global _shared_client
    if _shared_client is not None and not _shared_client.is_closed:
        await _shared_client.aclose()
        _shared_client = None
        logger.debug("closed shared persistent httpx.AsyncClient")
