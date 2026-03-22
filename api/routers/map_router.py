"""GeoJSON risk map endpoint."""
import json

from fastapi import APIRouter, Request

router = APIRouter()

RISK_COLOR = {
    "Normal":    "#22c55e",
    "Watch":     "#eab308",
    "Warning":   "#f97316",
    "Emergency": "#ef4444",
}


@router.get("/risk")
async def risk_map(request: Request):
    async with request.app.state.db.acquire() as conn:
        stations = await conn.fetch("""
            SELECT id, code, name, river, state, lat, lon, bank_full_m
            FROM gauge_stations
        """)

    features = []
    for s in stations:
        # Latest prediction (from Redis cache if available)
        cache_key = f"pred:{s['id']}"
        cached = await request.app.state.redis.get(cache_key)
        if cached:
            pred = json.loads(cached)
            risk = pred.get("overall_risk", "Normal")
            prob_24h = pred.get("horizons", {}).get("24h", {}).get("flood_prob", 0)
        else:
            risk = "Normal"
            prob_24h = 0.0

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
            "properties": {
                "id":         s["id"],
                "code":       s["code"],
                "name":       s["name"],
                "river":      s["river"],
                "state":      s["state"],
                "bank_full":  s["bank_full_m"],
                "risk_tier":  risk,
                "prob_24h":   prob_24h,
                "color":      RISK_COLOR.get(risk, "#22c55e"),
            },
        })

    return {"type": "FeatureCollection", "features": features}
