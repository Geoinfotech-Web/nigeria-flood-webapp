"""API key generation, hashing, and DB helpers for the Developer API."""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import date, datetime, timezone

API_KEY_PEPPER = os.getenv("API_KEY_PEPPER", "gfw-dev-pepper-change-me")
API_FREE_RPM = int(os.getenv("API_FREE_RPM", "60"))
API_FREE_DAILY_QUOTA = int(os.getenv("API_FREE_DAILY_QUOTA", "10000"))
API_SUBSCRIBE_IP_PER_HOUR = int(os.getenv("API_SUBSCRIBE_IP_PER_HOUR", "5"))


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(f"{API_KEY_PEPPER}:{raw_key}".encode("utf-8")).hexdigest()


def generate_api_key(env: str = "live") -> tuple[str, str, str]:
    """Return (raw_key, key_id, key_prefix). Secret shown once to the caller."""
    prefix = "gfw_live_" if env == "live" else "gfw_test_"
    secret = secrets.token_urlsafe(32)
    raw = f"{prefix}{secret}"
    key_id = f"key_{uuid.uuid4().hex[:16]}"
    return raw, key_id, raw[:16]


async def ensure_developer_tables(conn) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS api_subscribers (
            id           BIGSERIAL PRIMARY KEY,
            email        TEXT NOT NULL UNIQUE,
            org_name     TEXT NOT NULL DEFAULT '',
            status       TEXT NOT NULL DEFAULT 'active',
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT api_subscribers_status_chk CHECK (status IN ('active', 'suspended', 'pending_payment'))
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id                  BIGSERIAL PRIMARY KEY,
            key_id              TEXT NOT NULL UNIQUE,
            key_prefix          TEXT NOT NULL,
            key_hash            TEXT NOT NULL UNIQUE,
            subscriber_id       BIGINT NOT NULL REFERENCES api_subscribers(id) ON DELETE CASCADE,
            plan                TEXT NOT NULL DEFAULT 'free',
            env                 TEXT NOT NULL DEFAULT 'live',
            rate_limit_per_min  INTEGER NOT NULL DEFAULT 60,
            daily_quota         INTEGER NOT NULL DEFAULT 10000,
            revoked_at          TIMESTAMPTZ,
            last_used_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT api_keys_env_chk CHECK (env IN ('live', 'test'))
        );

        CREATE INDEX IF NOT EXISTS idx_api_keys_subscriber
            ON api_keys (subscriber_id) WHERE revoked_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
            ON api_keys (key_prefix);

        CREATE TABLE IF NOT EXISTS api_usage_daily (
            subscriber_id  BIGINT NOT NULL REFERENCES api_subscribers(id) ON DELETE CASCADE,
            day            DATE NOT NULL,
            request_count  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (subscriber_id, day)
        );

        ALTER TABLE api_subscribers
            ADD COLUMN IF NOT EXISTS preferred_plan TEXT NOT NULL DEFAULT 'free',
            ADD COLUMN IF NOT EXISTS payment_method TEXT,
            ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'none',
            ADD COLUMN IF NOT EXISTS billing_ref TEXT;

        -- Widen legacy plan check (free-only) to paid tiers
        ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_plan_chk;
        ALTER TABLE api_keys
            ADD CONSTRAINT api_keys_plan_chk
            CHECK (plan IN ('free', 'starter', 'pro'));

        ALTER TABLE api_subscribers DROP CONSTRAINT IF EXISTS api_subscribers_status_chk;
        ALTER TABLE api_subscribers
            ADD CONSTRAINT api_subscribers_status_chk
            CHECK (status IN ('active', 'suspended', 'pending_payment'));
        """
    )


async def lookup_active_key(conn, raw_key: str) -> dict | None:
    key_hash = hash_api_key(raw_key)
    row = await conn.fetchrow(
        """
        SELECT
            k.id AS key_row_id,
            k.key_id,
            k.key_prefix,
            k.subscriber_id,
            k.plan,
            k.env,
            k.rate_limit_per_min,
            k.daily_quota,
            s.email,
            s.org_name,
            s.status AS subscriber_status
        FROM api_keys k
        JOIN api_subscribers s ON s.id = k.subscriber_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL
        """,
        key_hash,
    )
    if not row:
        return None
    if row["subscriber_status"] != "active":
        return None
    return dict(row)


async def touch_key_used(conn, key_row_id: int) -> None:
    await conn.execute(
        "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
        key_row_id,
    )


async def increment_daily_usage(conn, subscriber_id: int) -> int:
    today = date.today()
    row = await conn.fetchrow(
        """
        INSERT INTO api_usage_daily (subscriber_id, day, request_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (subscriber_id, day)
        DO UPDATE SET request_count = api_usage_daily.request_count + 1
        RETURNING request_count
        """,
        subscriber_id,
        today,
    )
    return int(row["request_count"])


async def get_daily_usage(conn, subscriber_id: int) -> int:
    row = await conn.fetchrow(
        """
        SELECT request_count FROM api_usage_daily
        WHERE subscriber_id = $1 AND day = $2
        """,
        subscriber_id,
        date.today(),
    )
    return int(row["request_count"]) if row else 0


async def create_subscriber_with_key(
    conn,
    *,
    email: str,
    org_name: str,
    env: str = "live",
    plan: str = "free",
    payment_method: str | None = None,
) -> dict:
    from developer.plans import PLANS, plan_limits

    email_n = email.strip().lower()
    org = (org_name or "").strip() or "Independent"
    plan_id = (plan or "free").strip().lower()
    if plan_id not in PLANS:
        raise ValueError("invalid_plan")

    plan_meta = PLANS[plan_id]
    rpm, daily = plan_limits(plan_id)
    pay_method = (payment_method or "").strip().lower() or None
    if plan_meta["requires_payment"] and pay_method not in {"card", "bank_transfer", "ussd"}:
        raise ValueError("payment_method_required")

    existing = await conn.fetchrow(
        "SELECT id, status FROM api_subscribers WHERE email = $1",
        email_n,
    )
    if existing:
        if existing["status"] == "suspended":
            raise ValueError("subscriber_suspended")
        active = await conn.fetchrow(
            """
            SELECT id FROM api_keys
            WHERE subscriber_id = $1 AND revoked_at IS NULL AND env = $2
            LIMIT 1
            """,
            existing["id"],
            env,
        )
        if active:
            raise ValueError("already_subscribed")
        subscriber_id = existing["id"]
        await conn.execute(
            """
            UPDATE api_subscribers
            SET org_name = $1,
                preferred_plan = $2,
                payment_method = $3,
                billing_status = $4,
                status = $5,
                updated_at = NOW()
            WHERE id = $6
            """,
            org,
            plan_id,
            pay_method,
            "none" if not plan_meta["requires_payment"] else "pending",
            "active" if not plan_meta["requires_payment"] else "pending_payment",
            subscriber_id,
        )
    else:
        subscriber_id = await conn.fetchval(
            """
            INSERT INTO api_subscribers (
                email, org_name, preferred_plan, payment_method, billing_status, status
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            email_n,
            org,
            plan_id,
            pay_method,
            "none" if not plan_meta["requires_payment"] else "pending",
            "active" if not plan_meta["requires_payment"] else "pending_payment",
        )

    # Paid plans: record billing intent; key issued after payment confirmation
    if plan_meta["requires_payment"]:
        billing_ref = f"gfw_{plan_id}_{subscriber_id}_{secrets.token_hex(4)}"
        await conn.execute(
            "UPDATE api_subscribers SET billing_ref = $1, updated_at = NOW() WHERE id = $2",
            billing_ref,
            subscriber_id,
        )
        return {
            "subscriber_id": subscriber_id,
            "email": email_n,
            "org_name": org,
            "api_key": None,
            "key_id": None,
            "key_prefix": None,
            "plan": plan_id,
            "payment_method": pay_method,
            "billing_status": "pending",
            "billing_ref": billing_ref,
            "checkout": {
                "status": "pending",
                "provider": "paystack",
                "amount_ngn": plan_meta["price_ngn_monthly"],
                "currency": "NGN",
                "message": (
                    "Payment checkout will complete activation. "
                    "Use billing_ref when confirming payment."
                ),
            },
            "rate_limit_per_min": rpm,
            "daily_quota": daily,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    raw, key_id, key_prefix = generate_api_key(env)
    await conn.execute(
        """
        INSERT INTO api_keys (
            key_id, key_prefix, key_hash, subscriber_id, plan, env,
            rate_limit_per_min, daily_quota
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        key_id,
        key_prefix,
        hash_api_key(raw),
        subscriber_id,
        plan_id,
        env,
        rpm,
        daily,
    )

    return {
        "subscriber_id": subscriber_id,
        "email": email_n,
        "org_name": org,
        "api_key": raw,
        "key_id": key_id,
        "key_prefix": key_prefix,
        "plan": plan_id,
        "payment_method": None,
        "billing_status": "none",
        "rate_limit_per_min": rpm,
        "daily_quota": daily,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


async def rotate_key(conn, *, email: str, current_raw_key: str, env: str = "live") -> dict:
    email_n = email.strip().lower()
    current = await lookup_active_key(conn, current_raw_key)
    if not current or current["email"] != email_n:
        raise ValueError("invalid_key")

    await conn.execute(
        "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1",
        current["key_row_id"],
    )
    raw, key_id, key_prefix = generate_api_key(env)
    await conn.execute(
        """
        INSERT INTO api_keys (
            key_id, key_prefix, key_hash, subscriber_id, plan, env,
            rate_limit_per_min, daily_quota
        ) VALUES ($1, $2, $3, $4, 'free', $5, $6, $7)
        """,
        key_id,
        key_prefix,
        hash_api_key(raw),
        current["subscriber_id"],
        env,
        int(current["rate_limit_per_min"] or API_FREE_RPM),
        int(current["daily_quota"] or API_FREE_DAILY_QUOTA),
    )
    return {
        "subscriber_id": current["subscriber_id"],
        "email": email_n,
        "org_name": current["org_name"],
        "api_key": raw,
        "key_id": key_id,
        "key_prefix": key_prefix,
        "plan": current["plan"],
        "rate_limit_per_min": int(current["rate_limit_per_min"] or API_FREE_RPM),
        "daily_quota": int(current["daily_quota"] or API_FREE_DAILY_QUOTA),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
