-- Developer API keys / subscribers (GGIS Flood Watch public API)
CREATE TABLE IF NOT EXISTS api_subscribers (
    id           BIGSERIAL PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    org_name     TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_subscribers_status_chk CHECK (status IN ('active', 'suspended'))
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
    CONSTRAINT api_keys_plan_chk CHECK (plan IN ('free')),
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
