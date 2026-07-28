"""Staff admin API — manage subscribers, mint in-house keys, billing settings."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from developer.keys import (
    activate_paid_subscriber,
    mint_key_for_subscriber,
)
from developer.plans import PLANS, list_plans
from routers.auth import require_admin, require_staff, require_super_admin

router = APIRouter(tags=["Admin"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class InternalSubscriberBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=254)
    org_name: str = Field(..., min_length=1, max_length=200)
    plan: str = Field("pro", pattern="^(free|starter|pro|internal)$")
    env: str = Field("live", pattern="^(live|test)$")
    notes: str = Field("", max_length=500)
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=100_000)
    daily_quota: int | None = Field(default=None, ge=1, le=50_000_000)
    mint_key: bool = True


class MintKeyBody(BaseModel):
    plan: str = Field("pro", pattern="^(free|starter|pro|internal)$")
    env: str = Field("live", pattern="^(live|test)$")
    revoke_existing: bool = True
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=100_000)
    daily_quota: int | None = Field(default=None, ge=1, le=50_000_000)


class BillingSettingsBody(BaseModel):
    public_subscribe_enabled: bool = False
    paystack_enabled: bool = False
    paystack_test_mode: bool = True
    notes: str = Field("", max_length=1000)


def _row_to_subscriber(row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "org_name": row["org_name"],
        "status": row["status"],
        "subscriber_type": row.get("subscriber_type") or "external",
        "preferred_plan": row.get("preferred_plan") or "free",
        "payment_method": row.get("payment_method"),
        "billing_status": row.get("billing_status") or "none",
        "billing_ref": row.get("billing_ref"),
        "notes": row.get("notes") or "",
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        "active_key_prefix": row.get("active_key_prefix"),
        "active_plan": row.get("active_plan"),
        "active_env": row.get("active_env"),
        "last_used_at": row["last_used_at"].isoformat() if row.get("last_used_at") else None,
        "usage_today": int(row.get("usage_today") or 0),
    }


@router.get("/me")
async def admin_me(user: dict = Depends(require_staff)):
    return {
        "username": user["username"],
        "role": user["role"],
        "capabilities": {
            "manage_subscribers": user["role"] in {"admin", "super_admin"},
            "configure_billing": user["role"] == "super_admin",
        },
    }


@router.get("/plans")
async def admin_plans(_: dict = Depends(require_staff)):
    return list_plans()


@router.get("/subscribers")
async def list_subscribers(
    request: Request,
    q: str | None = Query(default=None),
    subscriber_type: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    _: dict = Depends(require_staff),
):
    clauses = ["TRUE"]
    args: list = []
    if q and q.strip():
        args.append(f"%{q.strip().lower()}%")
        clauses.append(f"(LOWER(s.email) LIKE ${len(args)} OR LOWER(s.org_name) LIKE ${len(args)})")
    if subscriber_type in {"external", "internal"}:
        args.append(subscriber_type)
        clauses.append(f"COALESCE(s.subscriber_type, 'external') = ${len(args)}")
    if status_filter in {"active", "suspended", "pending_payment"}:
        args.append(status_filter)
        clauses.append(f"s.status = ${len(args)}")
    args.append(limit)
    where = " AND ".join(clauses)
    sql = f"""
        SELECT
            s.id, s.email, s.org_name, s.status, s.subscriber_type, s.preferred_plan,
            s.payment_method, s.billing_status, s.billing_ref, s.notes,
            s.created_at, s.updated_at,
            k.key_prefix AS active_key_prefix,
            k.plan AS active_plan,
            k.env AS active_env,
            k.last_used_at,
            COALESCE(u.request_count, 0) AS usage_today
        FROM api_subscribers s
        LEFT JOIN LATERAL (
            SELECT key_prefix, plan, env, last_used_at
            FROM api_keys
            WHERE subscriber_id = s.id AND revoked_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
        ) k ON TRUE
        LEFT JOIN api_usage_daily u
            ON u.subscriber_id = s.id AND u.day = CURRENT_DATE
        WHERE {where}
        ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
        LIMIT ${len(args)}
    """
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return {"subscribers": [_row_to_subscriber(dict(r)) for r in rows], "count": len(rows)}


@router.get("/subscribers/{subscriber_id}")
async def get_subscriber(
    subscriber_id: int,
    request: Request,
    _: dict = Depends(require_staff),
):
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                s.id, s.email, s.org_name, s.status, s.subscriber_type, s.preferred_plan,
                s.payment_method, s.billing_status, s.billing_ref, s.notes,
                s.created_at, s.updated_at,
                k.key_prefix AS active_key_prefix,
                k.plan AS active_plan,
                k.env AS active_env,
                k.last_used_at,
                COALESCE(u.request_count, 0) AS usage_today
            FROM api_subscribers s
            LEFT JOIN LATERAL (
                SELECT key_prefix, plan, env, last_used_at
                FROM api_keys
                WHERE subscriber_id = s.id AND revoked_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            ) k ON TRUE
            LEFT JOIN api_usage_daily u
                ON u.subscriber_id = s.id AND u.day = CURRENT_DATE
            WHERE s.id = $1
            """,
            subscriber_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Subscriber not found")
        keys = await conn.fetch(
            """
            SELECT key_id, key_prefix, plan, env, rate_limit_per_min, daily_quota,
                   revoked_at, last_used_at, created_at
            FROM api_keys
            WHERE subscriber_id = $1
            ORDER BY created_at DESC
            LIMIT 20
            """,
            subscriber_id,
        )
        usage = await conn.fetch(
            """
            SELECT day, request_count
            FROM api_usage_daily
            WHERE subscriber_id = $1
            ORDER BY day DESC
            LIMIT 30
            """,
            subscriber_id,
        )
    return {
        "subscriber": _row_to_subscriber(dict(row)),
        "keys": [
            {
                "key_id": k["key_id"],
                "key_prefix": k["key_prefix"],
                "plan": k["plan"],
                "env": k["env"],
                "rate_limit_per_min": k["rate_limit_per_min"],
                "daily_quota": k["daily_quota"],
                "revoked_at": k["revoked_at"].isoformat() if k["revoked_at"] else None,
                "last_used_at": k["last_used_at"].isoformat() if k["last_used_at"] else None,
                "created_at": k["created_at"].isoformat() if k["created_at"] else None,
            }
            for k in keys
        ],
        "usage": [
            {"day": u["day"].isoformat(), "request_count": u["request_count"]}
            for u in usage
        ],
    }


@router.post("/subscribers/internal")
async def create_internal_subscriber(
    body: InternalSubscriberBody,
    request: Request,
    user: dict = Depends(require_admin),
):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")
    org = body.org_name.strip()
    plan_id = body.plan.strip().lower()

    async with request.app.state.db.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id, status FROM api_subscribers WHERE email = $1",
            email,
        )
        if existing:
            if existing["status"] == "suspended":
                raise HTTPException(status_code=403, detail="Subscriber is suspended")
            subscriber_id = int(existing["id"])
            await conn.execute(
                """
                UPDATE api_subscribers
                SET org_name = $1,
                    preferred_plan = $2,
                    subscriber_type = 'internal',
                    notes = $3,
                    status = 'active',
                    billing_status = 'none',
                    updated_at = NOW()
                WHERE id = $4
                """,
                org,
                plan_id if plan_id != "internal" else "pro",
                body.notes.strip(),
                subscriber_id,
            )
        else:
            subscriber_id = await conn.fetchval(
                """
                INSERT INTO api_subscribers (
                    email, org_name, preferred_plan, subscriber_type, notes,
                    billing_status, status
                ) VALUES ($1, $2, $3, 'internal', $4, 'none', 'active')
                RETURNING id
                """,
                email,
                org,
                plan_id if plan_id != "internal" else "pro",
                body.notes.strip(),
            )

        key_payload = None
        if body.mint_key:
            key_payload = await mint_key_for_subscriber(
                conn,
                subscriber_id=subscriber_id,
                plan=plan_id,
                env=body.env,
                revoke_existing=True,
                rate_limit_per_min=body.rate_limit_per_min,
                daily_quota=body.daily_quota,
            )

    return {
        "subscriber_id": subscriber_id,
        "email": email,
        "org_name": org,
        "subscriber_type": "internal",
        "plan": plan_id if plan_id != "internal" else "pro",
        "created_by": user["username"],
        "message": (
            "Store this API key now — it will not be shown again."
            if key_payload and key_payload.get("api_key")
            else "Internal subscriber saved."
        ),
        **(key_payload or {}),
    }


@router.post("/subscribers/{subscriber_id}/keys")
async def mint_subscriber_key(
    subscriber_id: int,
    body: MintKeyBody,
    request: Request,
    user: dict = Depends(require_admin),
):
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, org_name, status FROM api_subscribers WHERE id = $1",
            subscriber_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Subscriber not found")
        if row["status"] == "suspended":
            raise HTTPException(status_code=403, detail="Subscriber is suspended")
        try:
            result = await mint_key_for_subscriber(
                conn,
                subscriber_id=subscriber_id,
                plan=body.plan,
                env=body.env,
                revoke_existing=body.revoke_existing,
                rate_limit_per_min=body.rate_limit_per_min,
                daily_quota=body.daily_quota,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        **result,
        "email": row["email"],
        "org_name": row["org_name"],
        "minted_by": user["username"],
        "message": "Store this API key now — it will not be shown again.",
    }


@router.post("/subscribers/{subscriber_id}/suspend")
async def suspend_subscriber(
    subscriber_id: int,
    request: Request,
    user: dict = Depends(require_admin),
):
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM api_subscribers WHERE id = $1",
            subscriber_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Subscriber not found")
        await conn.execute(
            """
            UPDATE api_subscribers
            SET status = 'suspended', updated_at = NOW()
            WHERE id = $1
            """,
            subscriber_id,
        )
        await conn.execute(
            """
            UPDATE api_keys
            SET revoked_at = NOW()
            WHERE subscriber_id = $1 AND revoked_at IS NULL
            """,
            subscriber_id,
        )
    return {
        "subscriber_id": subscriber_id,
        "status": "suspended",
        "suspended_by": user["username"],
    }


@router.post("/subscribers/{subscriber_id}/activate-paid")
async def activate_paid(
    subscriber_id: int,
    request: Request,
    user: dict = Depends(require_admin),
):
    async with request.app.state.db.acquire() as conn:
        try:
            result = await activate_paid_subscriber(conn, subscriber_id=subscriber_id)
        except ValueError as exc:
            code = str(exc)
            if code == "subscriber_not_found":
                raise HTTPException(status_code=404, detail="Subscriber not found") from exc
            raise HTTPException(status_code=400, detail=code) from exc
    return {
        **result,
        "activated_by": user["username"],
        "message": "Payment marked active. Store the API key now — it will not be shown again.",
    }


async def _get_setting(conn, key: str) -> dict:
    row = await conn.fetchrow(
        "SELECT value, updated_at, updated_by FROM platform_settings WHERE key = $1",
        key,
    )
    if not row:
        return {}
    value = row["value"]
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = {}
    return {
        "value": value or {},
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        "updated_by": row["updated_by"],
    }


@router.get("/settings/billing")
async def get_billing_settings(
    request: Request,
    user: dict = Depends(require_staff),
):
    async with request.app.state.db.acquire() as conn:
        stored = await _get_setting(conn, "billing")
    value = stored.get("value") or {}
    secret = bool((os.getenv("PAYSTACK_SECRET_KEY") or "").strip())
    public = bool((os.getenv("PAYSTACK_PUBLIC_KEY") or "").strip())
    webhook = bool((os.getenv("PAYSTACK_WEBHOOK_SECRET") or "").strip())
    return {
        "public_subscribe_enabled": bool(value.get("public_subscribe_enabled", False)),
        "paystack_enabled": bool(value.get("paystack_enabled", False)),
        "paystack_test_mode": bool(value.get("paystack_test_mode", True)),
        "notes": value.get("notes") or "",
        "payment_provider": "paystack",
        "secrets": {
            "secret_key_configured": secret,
            "public_key_configured": public,
            "webhook_secret_configured": webhook,
            "ready": secret and webhook,
        },
        "webhook_url": f"{(os.getenv('PUBLIC_API_BASE_URL') or '').rstrip('/')}/webhooks/paystack",
        "updated_at": stored.get("updated_at"),
        "updated_by": stored.get("updated_by"),
        "can_edit": user["role"] == "super_admin",
        "plans": list(PLANS.values()),
    }


@router.put("/settings/billing")
async def put_billing_settings(
    body: BillingSettingsBody,
    request: Request,
    user: dict = Depends(require_super_admin),
):
    payload = {
        "public_subscribe_enabled": body.public_subscribe_enabled,
        "paystack_enabled": body.paystack_enabled,
        "paystack_test_mode": body.paystack_test_mode,
        "notes": body.notes.strip(),
    }
    async with request.app.state.db.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO platform_settings (key, value, updated_at, updated_by)
            VALUES ('billing', $1::jsonb, NOW(), $2)
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            """,
            json.dumps(payload),
            user["username"],
        )
    return {
        **payload,
        "updated_by": user["username"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "message": "Billing settings saved. Secrets remain in Secret Manager / env only.",
    }


@router.post("/billing/test-connection")
async def test_paystack_connection(
    request: Request,
    _: dict = Depends(require_super_admin),
):
    from services.paystack import test_connection

    result = await test_connection()
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Paystack not configured")
    return result
