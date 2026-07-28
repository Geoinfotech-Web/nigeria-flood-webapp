"""Public Paystack webhook — activates paid subscribers after payment."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, Request

from developer.keys import activate_by_billing_ref
from services.paystack import extract_billing_ref, verify_webhook_signature

router = APIRouter(tags=["webhooks"])
log = logging.getLogger(__name__)

SUCCESS_EVENTS = {
    "charge.success",
    "subscription.create",
    "invoice.update",
}


@router.post("/paystack")
async def paystack_webhook(request: Request):
    raw = await request.body()
    signature = request.headers.get("x-paystack-signature")
    if not verify_webhook_signature(raw, signature):
        raise HTTPException(status_code=401, detail="Invalid Paystack signature")

    try:
        event = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    event_type = event.get("event") or ""
    if event_type not in SUCCESS_EVENTS:
        return {"received": True, "handled": False, "event": event_type}

    billing_ref = extract_billing_ref(event)
    if not billing_ref:
        log.warning("Paystack event %s missing billing_ref", event_type)
        return {"received": True, "handled": False, "reason": "billing_ref_missing"}

    async with request.app.state.db.acquire() as conn:
        try:
            result = await activate_by_billing_ref(conn, billing_ref=billing_ref)
        except ValueError as exc:
            if str(exc) == "billing_ref_not_found":
                log.warning("Unknown billing_ref from Paystack: %s", billing_ref)
                return {"received": True, "handled": False, "reason": "unknown_billing_ref"}
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Never return the raw API key in webhook responses
    return {
        "received": True,
        "handled": True,
        "event": event_type,
        "subscriber_id": result.get("subscriber_id"),
        "email": result.get("email"),
        "billing_ref": billing_ref,
        "key_prefix": result.get("key_prefix"),
    }
