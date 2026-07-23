"""HTTP middleware: X-API-Key auth + rate/quota for /v1 routes."""
from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from developer.keys import (
    API_FREE_DAILY_QUOTA,
    API_FREE_RPM,
    get_daily_usage,
    increment_daily_usage,
    lookup_active_key,
    touch_key_used,
)
from developer.limits import sliding_window_allow

log = logging.getLogger(__name__)

# Paths under /v1 that do not require an API key
_PUBLIC_PREFIXES = (
    "/v1/health",
    "/v1/plans",
    "/v1/subscribe",
    "/v1/keys/rotate",
    "/v1/docs",
    "/v1/redoc",
    "/v1/openapi.json",
)


def _is_public_v1(path: str) -> bool:
    if path == "/v1" or path == "/v1/":
        return True
    for p in _PUBLIC_PREFIXES:
        if path == p or path.startswith(p + "/"):
            return True
    # rotate requires key in body but also X-API-Key — not public
    return False


class DeveloperApiMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/v1"):
            return await call_next(request)

        if request.method == "OPTIONS":
            return await call_next(request)

        if _is_public_v1(path):
            return await call_next(request)

        raw_key = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
        if not raw_key:
            return JSONResponse(
                status_code=401,
                content={
                    "detail": "Missing API key. Pass header X-API-Key.",
                    "docs": "/v1/docs",
                },
            )

        try:
            async with request.app.state.db.acquire() as conn:
                record = await lookup_active_key(conn, raw_key.strip())
        except Exception as exc:
            log.exception("API key lookup failed: %s", exc)
            return JSONResponse(
                status_code=503,
                content={"detail": "API key service unavailable"},
            )

        if not record:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or revoked API key"},
            )

        rpm = int(record.get("rate_limit_per_min") or API_FREE_RPM)
        daily = int(record.get("daily_quota") or API_FREE_DAILY_QUOTA)
        key_id = record["key_id"]

        allowed, remaining, retry_after = await sliding_window_allow(
            request.app.state.redis,
            f"gfw:rpm:{key_id}",
            rpm,
            60,
        )
        if not allowed:
            return JSONResponse(
                status_code=429,
                headers={
                    "Retry-After": str(retry_after or 60),
                    "X-RateLimit-Limit": str(rpm),
                    "X-RateLimit-Remaining": "0",
                },
                content={
                    "detail": "Rate limit exceeded",
                    "limit_per_min": rpm,
                    "retry_after_sec": retry_after or 60,
                },
            )

        try:
            async with request.app.state.db.acquire() as conn:
                used = await get_daily_usage(conn, record["subscriber_id"])
                if used >= daily:
                    return JSONResponse(
                        status_code=429,
                        headers={
                            "Retry-After": "3600",
                            "X-RateLimit-Limit": str(rpm),
                            "X-RateLimit-Remaining": str(remaining),
                            "X-DailyQuota-Limit": str(daily),
                            "X-DailyQuota-Remaining": "0",
                        },
                        content={
                            "detail": "Daily quota exceeded",
                            "daily_quota": daily,
                        },
                    )
                used = await increment_daily_usage(conn, record["subscriber_id"])
                await touch_key_used(conn, record["key_row_id"])
        except Exception as exc:
            log.warning("Usage tracking failed (continuing): %s", exc)
            used = 0

        request.state.api_subscriber = record
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(rpm)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-DailyQuota-Limit"] = str(daily)
        response.headers["X-DailyQuota-Remaining"] = str(max(0, daily - used))
        return response
