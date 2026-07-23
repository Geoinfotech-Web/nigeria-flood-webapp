"""Prediction endpoints — fetches latest features then calls BentoML."""
import json

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

RISK_ORDER = {"Normal": 0, "Watch": 1, "Warning": 2, "Emergency": 3}


def _normalize_horizon_keys(horizons: dict) -> dict:
    """Map \"6\" / 6 → \"6h\" so frontend lookups stay consistent."""
    out: dict = {}
    for raw, value in (horizons or {}).items():
        if value is None:
            continue
        key = str(raw).strip().lower()
        if key.isdigit():
            key = f"{key}h"
        elif key.endswith("h") and key[:-1].isdigit():
            pass
        else:
            digits = "".join(ch for ch in key if ch.isdigit())
            if digits:
                key = f"{digits}h"
        out[key] = value
    return out


@router.get("/all/predictions")
async def get_all_predictions(request: Request):
    """Summary prediction for every station (for Expert gauge console / map).

    Must be declared before /{station_id}/predictions so "all" is not parsed as an id.
    """
    async with request.app.state.db.acquire() as conn:
        stations = await conn.fetch("SELECT id FROM gauge_stations")

    results = []
    for row in stations:
        try:
            pred = await get_predictions(row["id"], request)
            results.append(pred)
        except HTTPException:
            pass
    return results


@router.get("/{station_id}/predictions")
async def get_predictions(station_id: int, request: Request):
    # 1) Try Redis cache (30 s TTL)
    cache_key = f"pred:{station_id}"
    cached = await request.app.state.redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # 2) Fetch latest features from DB
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT ff.*, gs.bank_full_m
            FROM flood_features ff
            JOIN gauge_stations gs ON gs.id = ff.station_id
            WHERE ff.station_id = $1
            ORDER BY ff.time DESC LIMIT 1
        """, station_id)

    if not row:
        raise HTTPException(status_code=404, detail="No feature data for station")

    features = {
        "station_id":           station_id,
        "water_level_m":        row["water_level_m"],
        "flow_rate_m3s":        row["flow_rate_m3s"],
        "level_change_1h":      row["level_change_1h"],
        "level_change_3h":      row["level_change_3h"],
        "rolling_rain_3h_mm":   row["rolling_rain_3h_mm"],
        "rolling_rain_24h_mm":  row["rolling_rain_24h_mm"],
        "soil_moisture_idx":    row["soil_moisture_idx"],
        "days_since_last_peak": row["days_since_last_peak"],
        "level_pct_bank":       row["level_pct_bank"],
    }

    # 3) Call BentoML — fall back to bankfull heuristic when ML service is offline
    try:
        resp = await request.app.state.http.post("/predict", json=features)
        resp.raise_for_status()
        result = resp.json()
    except Exception as exc:
        result = _heuristic_prediction(station_id, features)
        result["fallback"] = "heuristic"
        result["ml_error"] = str(exc)

    # Canonical horizon keys: "6h", "12h", … (ML historically returned "6", "12")
    if isinstance(result.get("horizons"), dict):
        result["horizons"] = _normalize_horizon_keys(result["horizons"])

    # 4) Derive overall risk tier (worst across horizons)
    worst = "Normal"
    for h_data in result.get("horizons", {}).values():
        tier = h_data.get("risk_tier", "Normal")
        if RISK_ORDER.get(tier, 0) > RISK_ORDER.get(worst, 0):
            worst = tier
    result["overall_risk"] = worst
    if "station_id" not in result:
        result["station_id"] = station_id

    # 5) Cache + return
    await request.app.state.redis.setex(cache_key, 30, json.dumps(result))
    return result


def _heuristic_prediction(station_id: int, features: dict) -> dict:
    """Bankfull-based outlook used when BentoML is not deployed yet."""
    pct = float(features.get("level_pct_bank") or 0.0)
    rain24 = float(features.get("rolling_rain_24h_mm") or 0.0)
    change3h = float(features.get("level_change_3h") or 0.0)

    score = pct
    if rain24 > 40:
        score += 0.08
    if change3h > 0.3:
        score += 0.05

    if score >= 0.95:
        tier, base_prob = "Emergency", 0.88
    elif score >= 0.80:
        tier, base_prob = "Warning", 0.68
    elif score >= 0.65:
        tier, base_prob = "Watch", 0.42
    else:
        tier, base_prob = "Normal", max(0.05, min(0.35, score * 0.4))

    horizons = {}
    for h, bump in ((6, 0.0), (12, 0.02), (24, 0.04), (48, 0.06), (72, 0.08)):
        prob = round(min(0.99, max(0.01, base_prob + bump)), 3)
        horizons[f"{h}h"] = {
            "flood_prob": prob,
            "risk_tier": tier,
            "xgb_prob": prob,
            "lstm_prob": None,
        }

    return {
        "station_id": station_id,
        "horizons": horizons,
        "model_version": "heuristic-bankfull-v1",
    }
