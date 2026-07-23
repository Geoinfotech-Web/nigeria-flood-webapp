"""Curated stable Developer API data endpoints (wrap existing handlers)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request

from routers import alerts, gauges, geocoding, predictions, rainfall
from routers.exposure import (
    affected_settlements_summary,
    nearby_roads,
    nearby_settlements,
    site_assessment,
)
from routers.flood_risk import (
    flood_risk_geojson,
    impact_summary,
    risk_summary,
    urban_flash_summary,
)

router = APIRouter(tags=["Developer API"])


@router.get("/health")
async def v1_health(request: Request):
    db_ok = False
    try:
        async with request.app.state.db.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "ggis-flood-watch-developer-api",
        "version": "1.0.0",
        "time": datetime.now(timezone.utc).isoformat(),
        "db": "ok" if db_ok else "error",
    }


@router.get("/stations")
async def v1_stations(request: Request):
    """List monitored gauge stations."""
    return await gauges.list_stations(request)


@router.get("/stations/{station_id}/latest")
async def v1_station_latest(station_id: int, request: Request):
    """Latest water level / flow reading for a gauge."""
    return await gauges.get_latest_reading(station_id, request)


@router.get("/stations/{station_id}/outlook")
async def v1_station_outlook(station_id: int, request: Request):
    """72-hour flood outlook (risk tiers + probabilities) for a gauge."""
    return await predictions.get_predictions(station_id, request)


@router.get("/alerts")
async def v1_alerts(
    request: Request,
    limit: int = Query(default=50, le=200),
    status: str | None = Query(default=None),
):
    """Recent flood alert log entries."""
    return await alerts.get_alerts(request, limit=limit, status=status)


@router.get("/rainfall/daily")
async def v1_rainfall_daily(
    request: Request,
    days: int = Query(default=7, ge=1, le=30),
):
    """Daily rainfall totals by meteorological station."""
    return await rainfall.rainfall_daily(request, days=days)


@router.get("/flood-risk/summary")
async def v1_flood_risk_summary(request: Request):
    """National flood-risk area summary by tier."""
    return await risk_summary(request)


@router.get("/flood-risk/urban-flash")
async def v1_urban_flash(request: Request):
    """Urban flash-flood alert summary (Likely / Highly Likely)."""
    return await urban_flash_summary(request)


@router.get("/flood-risk/geojson")
async def v1_flood_risk_geojson(
    request: Request,
    source: str | None = Query(default=None),
):
    """Flood risk polygons as GeoJSON (optional source filter)."""
    return await flood_risk_geojson(request, source=source)


@router.get("/exposure/affected-settlements")
async def v1_affected_settlements(
    request: Request,
    min_tier: str = Query(default="Warning"),
    radius_km: float = Query(default=25, ge=5, le=80),
    limit: int = Query(default=100, ge=10, le=500),
):
    """Towns/villages near gauges with elevated (Warning+) outlook."""
    return await affected_settlements_summary(
        request,
        radius_km=radius_km,
        min_tier=min_tier,
        limit=limit,
    )


# ── Location intelligence ─────────────────────────────────────────────────────


@router.get("/location/search")
async def v1_location_search(
    q: str = Query(..., min_length=2),
    limit: int = Query(default=6, ge=1, le=10),
):
    """Geocode a place name (Nigeria-focused search)."""
    return await geocoding.geocode_search(q=q, limit=limit)


@router.get("/location/reverse")
async def v1_location_reverse(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Reverse-geocode a lat/lon to a place label."""
    return await geocoding.reverse_geocode(lat=lat, lon=lon)


@router.get("/location/terrain")
async def v1_location_terrain(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """Elevation and approximate slope at a point."""
    return await geocoding.terrain_at_point(lat=lat, lon=lon)


@router.get("/location/site-assessment")
async def v1_location_site_assessment(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(2.0, ge=0.5, le=10),
):
    """Flood site assessment for a lat/lon (susceptibility + nearby zones)."""
    return await site_assessment(request, lat=lat, lon=lon, radius_km=radius_km)


@router.get("/location/nearby-settlements")
async def v1_location_nearby_settlements(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(25, ge=5, le=80),
    limit: int = Query(8, ge=1, le=20),
):
    """Neighbouring settlements with flood susceptibility enrichment."""
    return await nearby_settlements(
        request, lat=lat, lon=lon, radius_km=radius_km, limit=limit
    )


@router.get("/location/nearby-roads")
async def v1_location_nearby_roads(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(12, ge=2, le=40),
    limit: int = Query(20, ge=1, le=50),
):
    """Major roads near a point, classified by flood susceptibility."""
    return await nearby_roads(
        request, lat=lat, lon=lon, radius_km=radius_km, limit=limit
    )


@router.get("/location/impact-summary")
async def v1_location_impact_summary(
    request: Request,
    station_id: int | None = Query(default=None),
    area_name: str | None = Query(default=None),
    admin_level: str | None = Query(default=None),
):
    """Scoped impact summary (optional station or flood-risk area)."""
    return await impact_summary(
        request,
        station_id=station_id,
        area_name=area_name,
        admin_level=admin_level,
    )
