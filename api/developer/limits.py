"""Rate limit / quota helpers for Developer API (Redis or in-process)."""
from __future__ import annotations

import time


async def sliding_window_allow(redis, key: str, limit: int, window_sec: int = 60) -> tuple[bool, int, int]:
    """
    Simple fixed-window counter (per minute/hour bucket).
    Returns (allowed, remaining, retry_after_sec).
    """
    if limit <= 0:
        return True, 0, 0

    # Prefer Redis INCR when available
    incr = getattr(redis, "incr", None)
    expire = getattr(redis, "expire", None)
    ttl = getattr(redis, "ttl", None)

    if callable(incr) and callable(expire):
        count = await incr(key)
        if count == 1:
            await expire(key, window_sec)
        remaining = max(0, limit - int(count))
        if count > limit:
            retry = window_sec
            if callable(ttl):
                try:
                    t = await ttl(key)
                    if isinstance(t, int) and t > 0:
                        retry = t
                except Exception:
                    pass
            return False, 0, int(retry)
        return True, remaining, 0

    # Fallback for _NullRedis-style stores with get/set only
    now = time.time()
    raw = await redis.get(key)
    count = 0
    expires_at = now + window_sec
    if raw:
        try:
            count_s, exp_s = str(raw).split(":", 1)
            count = int(count_s)
            expires_at = float(exp_s)
            if expires_at < now:
                count = 0
                expires_at = now + window_sec
        except Exception:
            count = 0
            expires_at = now + window_sec

    count += 1
    ttl_left = max(1, int(expires_at - now))
    await redis.set(key, f"{count}:{expires_at}", ex=ttl_left)
    if count > limit:
        return False, 0, ttl_left
    return True, max(0, limit - count), 0
