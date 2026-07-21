"""Geocoding proxy — Nominatim (OpenStreetMap), Nigeria-focused."""
import httpx
from fastapi import APIRouter, Query, HTTPException

router = APIRouter()
_client = httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "GGISFloodWatch/1.0"})

NOMINATIM = "https://nominatim.openstreetmap.org/search"


@router.get("/search")
async def geocode_search(
    q: str = Query(..., min_length=2, description="Place name to search"),
    limit: int = Query(default=5, le=10),
    country: str = Query(default="ng", description="ISO country code"),
):
    """Search for places using Nominatim. Defaults to Nigeria."""
    try:
        resp = await _client.get(NOMINATIM, params={
            "q": q,
            "format": "json",
            "countrycodes": country,
            "limit": limit,
            "addressdetails": 1,
        })
        resp.raise_for_status()
        results = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Geocoding unavailable: {exc}")

    return [
        {
            "display_name": r["display_name"],
            "name":         r.get("name", r["display_name"].split(",")[0]),
            "lat":          float(r["lat"]),
            "lon":          float(r["lon"]),
            "type":         r.get("type"),
            "bbox":         [float(x) for x in r["boundingbox"]],
            # bbox from Nominatim is [south, north, west, east] → reorder to [west,south,east,north]
            "bbox_lnglat":  [float(r["boundingbox"][2]), float(r["boundingbox"][0]),
                             float(r["boundingbox"][3]), float(r["boundingbox"][1])],
        }
        for r in results
    ]


@router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(...),
    lon: float = Query(...),
):
    """Reverse geocode a lat/lon to a place usable by the public outlook panel."""
    try:
        resp = await _client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lon,
                "format": "json",
                "addressdetails": 1,
                "zoom": 14,
            },
        )
        resp.raise_for_status()
        r = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Reverse geocoding unavailable: {exc}")

    addr = r.get("address", {}) or {}
    name = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("suburb")
        or addr.get("county")
        or addr.get("state")
        or r.get("name")
        or "Your location"
    )
    display = r.get("display_name") or f"{name}, Nigeria"
    street = (
        addr.get("road")
        or addr.get("pedestrian")
        or addr.get("residential")
        or addr.get("footway")
        or addr.get("path")
    )
    street_address = ", ".join(
        part for part in [
            " ".join(part for part in [addr.get("house_number"), street] if part),
            addr.get("suburb") or addr.get("neighbourhood"),
            addr.get("city") or addr.get("town") or addr.get("village"),
            addr.get("state"),
        ] if part
    )
    bbox = r.get("boundingbox")
    bbox_lnglat = None
    if bbox and len(bbox) == 4:
        bbox_lnglat = [float(bbox[2]), float(bbox[0]), float(bbox[3]), float(bbox[1])]

    return {
        "display_name": display,
        "street": street,
        "street_address": street_address or display,
        "name": name,
        "lat": lat,
        "lon": lon,
        "city": addr.get("city") or addr.get("town") or addr.get("village"),
        "state": addr.get("state"),
        "country": addr.get("country") or "Nigeria",
        "type": r.get("type") or addr.get("place") or "locality",
        "bbox": [float(x) for x in bbox] if bbox else None,
        "bbox_lnglat": bbox_lnglat,
        "from_geolocation": True,
    }


@router.get("/terrain")
async def terrain_at_point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """
    Elevation (m) and approximate slope (deg) at a point using Open-Meteo
    SRTM-derived elevation samples around the location.
    """
    import math

    # ~150 m offsets in degrees (approximate at mid-latitudes)
    dlat = 150.0 / 111_320.0
    dlon = 150.0 / max(111_320.0 * abs(math.cos(math.radians(lat))), 1e-6)
    lats = [lat, lat + dlat, lat - dlat, lat, lat]
    lons = [lon, lon, lon, lon + dlon, lon - dlon]

    try:
        resp = await _client.get(
            "https://api.open-meteo.com/v1/elevation",
            params={
                "latitude": ",".join(f"{v:.6f}" for v in lats),
                "longitude": ",".join(f"{v:.6f}" for v in lons),
            },
        )
        resp.raise_for_status()
        elevs = resp.json().get("elevation") or []
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Terrain service unavailable: {exc}")

    if len(elevs) < 5 or elevs[0] is None:
        raise HTTPException(status_code=404, detail="No elevation available for this location")

    center = float(elevs[0])
    neighbors = [float(e) for e in elevs[1:5] if e is not None]
    if not neighbors:
        return {
            "lat": lat,
            "lon": lon,
            "elevation_m": round(center, 1),
            "slope_deg": None,
            "slope_class": None,
            "source": "open-meteo/SRTM",
        }

    # Gradients along N-S and E-W axes (rise / 150 m run)
    rise_ns = abs(float(elevs[1]) - float(elevs[2])) / 2.0 if elevs[1] is not None and elevs[2] is not None else 0.0
    rise_ew = abs(float(elevs[3]) - float(elevs[4])) / 2.0 if elevs[3] is not None and elevs[4] is not None else 0.0
    # Prefer max directional gradient; fall back to center vs neighbors
    rise = max(rise_ns, rise_ew, max(abs(e - center) for e in neighbors))
    slope_deg = math.degrees(math.atan(rise / 150.0))

    if slope_deg < 1:
        slope_class = "Very flat"
    elif slope_deg < 3:
        slope_class = "Flat"
    elif slope_deg < 8:
        slope_class = "Gentle"
    elif slope_deg < 15:
        slope_class = "Moderate"
    else:
        slope_class = "Steep"

    return {
        "lat": lat,
        "lon": lon,
        "elevation_m": round(center, 1),
        "slope_deg": round(slope_deg, 1),
        "slope_class": slope_class,
        "source": "open-meteo/SRTM",
    }
