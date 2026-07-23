"""Developer API plan catalog and payment modes."""
from __future__ import annotations

import os

from developer.keys import API_FREE_DAILY_QUOTA, API_FREE_RPM

# Paid quotas (overridable via env)
API_STARTER_RPM = int(os.getenv("API_STARTER_RPM", "300"))
API_STARTER_DAILY = int(os.getenv("API_STARTER_DAILY_QUOTA", "100000"))
API_PRO_RPM = int(os.getenv("API_PRO_RPM", "1000"))
API_PRO_DAILY = int(os.getenv("API_PRO_DAILY_QUOTA", "500000"))

PAYMENT_METHODS = (
    {
        "id": "card",
        "label": "Card",
        "description": "Visa / Mastercard / Verve (Paystack)",
    },
    {
        "id": "bank_transfer",
        "label": "Bank transfer",
        "description": "Nigerian bank transfer / Pay with Transfer",
    },
    {
        "id": "ussd",
        "label": "USSD",
        "description": "Dial USSD from supported banks",
    },
)

PLANS = {
    "free": {
        "id": "free",
        "name": "Free",
        "price_ngn_monthly": 0,
        "currency": "NGN",
        "rate_limit_per_min": API_FREE_RPM,
        "daily_quota": API_FREE_DAILY_QUOTA,
        "features": [
            "Gauges & 72h outlook",
            "Alerts & rainfall",
            "Flood-risk & urban flash",
            "Location intelligence (site, terrain, nearby)",
        ],
        "requires_payment": False,
    },
    "starter": {
        "id": "starter",
        "name": "Starter",
        "price_ngn_monthly": 25000,
        "currency": "NGN",
        "rate_limit_per_min": API_STARTER_RPM,
        "daily_quota": API_STARTER_DAILY,
        "features": [
            "Everything in Free",
            "Higher rate limits",
            "Priority location intelligence",
            "Email support",
        ],
        "requires_payment": True,
    },
    "pro": {
        "id": "pro",
        "name": "Pro",
        "price_ngn_monthly": 75000,
        "currency": "NGN",
        "rate_limit_per_min": API_PRO_RPM,
        "daily_quota": API_PRO_DAILY,
        "features": [
            "Everything in Starter",
            "Highest quotas",
            "Commercial use license",
            "Dedicated onboarding",
        ],
        "requires_payment": True,
    },
}


def list_plans() -> dict:
    return {
        "currency": "NGN",
        "payment_provider": "paystack",
        "payment_methods": list(PAYMENT_METHODS),
        "plans": list(PLANS.values()),
        "notes": (
            "Paid checkout activates after payment confirmation. "
            "Free plan issues an API key immediately."
        ),
    }


def plan_limits(plan_id: str) -> tuple[int, int]:
    plan = PLANS.get(plan_id) or PLANS["free"]
    return int(plan["rate_limit_per_min"]), int(plan["daily_quota"])
