"""Geocoding proxy — Nominatim (OpenStreetMap), Nigeria-focused."""
import httpx
from fastapi import APIRouter, Query, HTTPException

router = APIRouter()
_client = httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "NigeriaFloodDashboard/1.0"})

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
