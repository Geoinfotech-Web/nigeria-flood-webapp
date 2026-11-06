"""Fail closed on unsafe settings when production mode is explicitly enabled."""
from urllib.parse import urlsplit


def validate_production_config(env, users):
    if env.get("APP_ENV", "").strip().lower() != "production":
        return

    if env.get("ALLOW_DEV_ADMIN_USERS", "").strip().lower() in {"1", "true", "yes"}:
        raise RuntimeError("Development admin users must be disabled in production")
    for name in ("JWT_SECRET", "API_KEY_PEPPER"):
        value = env.get(name, "").strip()
        if len(value) < 32 or len(set(value)) < 8:
            raise RuntimeError(f"{name} must be a unique, randomly generated secret of at least 32 characters")
    if env.get("JWT_SECRET", "").strip() == env.get("API_KEY_PEPPER", "").strip():
        raise RuntimeError("JWT_SECRET and API_KEY_PEPPER must be different")
    if not users:
        raise RuntimeError("Configure at least one staff user in production")

    origins = [origin.strip() for origin in env.get("CORS_ORIGINS", "").split(",")]
    for origin in origins:
        try:
            parsed = urlsplit(origin)
            valid_port = parsed.port is None or parsed.port > 0
        except ValueError:
            valid_port = False
            parsed = None
        if (not parsed or not valid_port or parsed.scheme != "https" or not parsed.hostname
                or parsed.username or parsed.password or parsed.path or parsed.query
                or parsed.fragment or "*" in origin or any(c.isspace() for c in origin)):
            raise RuntimeError("CORS_ORIGINS must contain explicit HTTPS origins in production")
