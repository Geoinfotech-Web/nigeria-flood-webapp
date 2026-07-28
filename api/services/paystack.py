"""Paystack helpers — secret verification and connection test."""
from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any

import httpx

PAYSTACK_SECRET_KEY = (os.getenv("PAYSTACK_SECRET_KEY") or "").strip()
PAYSTACK_PUBLIC_KEY = (os.getenv("PAYSTACK_PUBLIC_KEY") or "").strip()
PAYSTACK_WEBHOOK_SECRET = (os.getenv("PAYSTACK_WEBHOOK_SECRET") or "").strip()
PAYSTACK_BASE = "https://api.paystack.co"


def secrets_status() -> dict[str, bool]:
    return {
        "secret_key_configured": bool(PAYSTACK_SECRET_KEY),
        "public_key_configured": bool(PAYSTACK_PUBLIC_KEY),
        "webhook_secret_configured": bool(PAYSTACK_WEBHOOK_SECRET),
        "ready": bool(PAYSTACK_SECRET_KEY and PAYSTACK_WEBHOOK_SECRET),
    }


def verify_webhook_signature(raw_body: bytes, signature: str | None) -> bool:
    """
    Paystack sends x-paystack-signature = HMAC SHA512 of body with secret key.
    Prefer PAYSTACK_WEBHOOK_SECRET when set; fall back to PAYSTACK_SECRET_KEY.
    """
    if not signature:
        return False
    secret = PAYSTACK_WEBHOOK_SECRET or PAYSTACK_SECRET_KEY
    if not secret:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, signature)


def extract_billing_ref(event: dict[str, Any]) -> str | None:
    data = event.get("data") or {}
    meta = data.get("metadata") or {}
    if isinstance(meta, dict):
        for key in ("billing_ref", "gfw_billing_ref", "reference_tag"):
            if meta.get(key):
                return str(meta[key]).strip()
    for key in ("reference", "id"):
        val = data.get(key)
        if val and str(val).startswith("gfw_"):
            return str(val).strip()
    return None


async def test_connection() -> dict:
    if not PAYSTACK_SECRET_KEY:
        return {"ok": False, "error": "PAYSTACK_SECRET_KEY is not set"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{PAYSTACK_BASE}/balance",
                headers={"Authorization": f"Bearer {PAYSTACK_SECRET_KEY}"},
            )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": f"Paystack returned {resp.status_code}",
                "detail": resp.text[:300],
            }
        payload = resp.json()
        return {
            "ok": True,
            "message": "Paystack connection OK",
            "public_key_configured": bool(PAYSTACK_PUBLIC_KEY),
            "data": payload.get("data"),
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
