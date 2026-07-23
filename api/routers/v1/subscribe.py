"""Developer API — subscribe / rotate keys / plans (public endpoints)."""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from developer.keys import (
    API_SUBSCRIBE_IP_PER_HOUR,
    create_subscriber_with_key,
    rotate_key,
)
from developer.limits import sliding_window_allow
from developer.plans import list_plans

router = APIRouter(tags=["Developer API"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class SubscribeBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=254)
    org_name: str = Field("", max_length=200)
    env: str = Field("live", pattern="^(live|test)$")
    plan: str = Field("free", pattern="^(free|starter|pro)$")
    payment_method: str | None = Field(
        default=None,
        description="Required for paid plans: card | bank_transfer | ussd",
    )


class RotateBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=254)
    current_api_key: str = Field(..., min_length=20)
    env: str = Field("live", pattern="^(live|test)$")


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


@router.get("/plans")
async def plans():
    """List subscription plans and accepted payment methods."""
    return list_plans()


@router.post("/subscribe")
async def subscribe(body: SubscribeBody, request: Request):
    """
    Self-serve subscribe. Free plan returns an API key once.
    Paid plans record payment preference and return a pending checkout reference
    (key issued after payment confirmation).
    """
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")

    ip = _client_ip(request)
    allowed, _, retry = await sliding_window_allow(
        request.app.state.redis,
        f"gfw:subscribe-ip:{ip}",
        API_SUBSCRIBE_IP_PER_HOUR,
        3600,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many subscribe attempts from this IP",
            headers={"Retry-After": str(retry or 3600)},
        )

    try:
        async with request.app.state.db.acquire() as conn:
            result = await create_subscriber_with_key(
                conn,
                email=email,
                org_name=body.org_name,
                env=body.env,
                plan=body.plan,
                payment_method=body.payment_method,
            )
    except ValueError as exc:
        code = str(exc)
        if code == "already_subscribed":
            raise HTTPException(
                status_code=409,
                detail="Email already has an active key. Use POST /v1/keys/rotate.",
            ) from exc
        if code == "subscriber_suspended":
            raise HTTPException(status_code=403, detail="Subscriber account suspended") from exc
        if code == "invalid_plan":
            raise HTTPException(status_code=422, detail="Invalid plan") from exc
        if code == "payment_method_required":
            raise HTTPException(
                status_code=422,
                detail="Paid plans require payment_method: card, bank_transfer, or ussd",
            ) from exc
        raise HTTPException(status_code=400, detail=code) from exc

    if result.get("api_key"):
        message = "Store this API key now — it will not be shown again."
    else:
        message = (
            "Subscription recorded. Complete payment to activate your API key "
            f"(ref {result.get('billing_ref')})."
        )

    return {
        **result,
        "message": message,
        "base_url": "/v1",
        "auth_header": "X-API-Key",
        "limits": {
            "plan": result.get("plan"),
            "requests_per_min": result.get("rate_limit_per_min"),
            "daily_quota": result.get("daily_quota"),
        },
        "disclaimer": (
            "Flood forecasts are approximate and for early awareness only. "
            "Confirm with NIHSA / official sources before operational decisions."
        ),
    }


@router.post("/keys/rotate")
async def rotate(body: RotateBody, request: Request):
    """Revoke the current key and issue a new one (shown once)."""
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")

    raw = body.current_api_key.strip()
    header_key = request.headers.get("x-api-key")
    if header_key and not raw:
        raw = header_key.strip()

    try:
        async with request.app.state.db.acquire() as conn:
            result = await rotate_key(
                conn,
                email=email,
                current_raw_key=raw,
                env=body.env,
            )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid email or API key") from exc

    return {
        **result,
        "message": "Previous key revoked. Store the new key now — it will not be shown again.",
        "auth_header": "X-API-Key",
    }
