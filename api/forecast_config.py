"""Controls whether the existing, unvalidated forecast pipeline is exposed."""
import os


def forecasts_enabled() -> bool:
    value = os.getenv("FORECASTS_ENABLED")
    if value is None:
        return os.getenv("APP_ENV", "").strip().lower() != "production"
    return value.strip().lower() in {"1", "true", "yes"}
