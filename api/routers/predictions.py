"""Prediction endpoints — fetches latest features then calls BentoML."""
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

RISK_ORDER = {"Normal": 0, "Watch": 1, "Warning": 2, "Emergency": 3}


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

    # 3) Call BentoML
    try:
        resp = await request.app.state.http.post("/predict", json=features)
        resp.raise_for_status()
        result = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"BentoML unavailable: {exc}")

    # 4) Derive overall risk tier (worst across horizons)
    worst = "Normal"
    for h_data in result.get("horizons", {}).values():
        tier = h_data.get("risk_tier", "Normal")
        if RISK_ORDER.get(tier, 0) > RISK_ORDER.get(worst, 0):
            worst = tier
    result["overall_risk"] = worst

    # 5) Cache + return
    await request.app.state.redis.setex(cache_key, 30, json.dumps(result))
    return result


@router.get("/all/predictions")
async def get_all_predictions(request: Request):
    """Summary prediction for every station (for map view)."""
    async with request.app.state.db.acquire() as conn:
        stations = await conn.fetch("SELECT id FROM gauge_stations")

    results = []
    for row in stations:
        try:
            # Re-use per-station endpoint logic via direct call
            pred = await get_predictions(row["id"], request)
            results.append(pred)
        except HTTPException:
            pass
    return results
