"""
Ingest historical flood events for Nigeria and derive recurrence hotspots.

Primary source: Global Flood Database (MODIS events) via Google Earth Engine.
This yields discrete past-event flood footprints rather than the long-term JRC
wet-frequency layer already used for inundation history.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import tempfile
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [hist-events] %(message)s", force=True)
log = logging.getLogger(__name__)

GEE_KEY_FILE = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")
GEE_SA_EMAIL = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL", "")
GEE_PROJECT = os.getenv("GEE_PROJECT", "")
NIGERIA_BBOX = [2.7, 4.0, 14.7, 14.0]
DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)

SOURCE = "gfd_modis_events_v1"
FALLBACK_SOURCE = "jrc_occurrence_1984_2021"
EVENT_TABLE = "historical_flood_events"
HOTSPOT_TABLE = "historical_flood_hotspots"
GRID_STEP_DEG = 0.2
MIN_EVENT_AREA_DEG2 = 1e-5
MIN_HOTSPOT_AREA_DEG2 = 5e-5


def init_gee() -> bool:
    try:
        import ee
    except ImportError:
        log.error("earthengine-api not installed")
        return False

    try:
        if GEE_KEY_FILE and Path(GEE_KEY_FILE).exists():
            ee.Initialize(
                ee.ServiceAccountCredentials(GEE_SA_EMAIL, GEE_KEY_FILE),
                project=GEE_PROJECT or None,
            )
        else:
            ee.Initialize(project=GEE_PROJECT or None)
        return True
    except Exception as exc:
        log.error("GEE init failed: %s", exc)
        return False


def get_nigeria_geometry():
    import ee

    try:
        countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
        return countries.filter(ee.Filter.eq("country_na", "Nigeria")).geometry()
    except Exception:
        return ee.Geometry.BBox(*NIGERIA_BBOX)


def _event_properties(image, fallback_idx: int) -> dict:
    props = image.toDictionary().getInfo() or {}
    event_id = (
        props.get("id")
        or props.get("ID")
        or props.get("flood_id")
        or props.get("dfo_event_id")
        or f"gfd-{fallback_idx}"
    )
    started = props.get("start_date") or props.get("began") or props.get("started_at")
    ended = props.get("end_date") or props.get("ended") or props.get("ended_at")
    if not started:
        ts = props.get("system:time_start")
        if ts:
            started = datetime.utcfromtimestamp(int(ts) / 1000).date().isoformat()
    if not ended:
        ts = props.get("system:time_end") or props.get("system:time_start")
        if ts:
            ended = datetime.utcfromtimestamp(int(ts) / 1000).date().isoformat()
    return {
        "event_id": str(event_id),
        "event_name": str(props.get("name") or props.get("flood_name") or f"GFD event {event_id}"),
        "started_at": started,
        "ended_at": ended,
        "severity": str(props.get("dfo_severity") or props.get("severity") or "").strip() or None,
        "confidence": _to_float(props.get("clear_perc")),
        "metadata": props,
    }


def fetch_nigeria_events(start_year: int = 2000, end_year: int = 2018, limit: int | None = None) -> list[dict]:
    import ee
    from shapely.geometry import MultiPolygon, shape

    nigeria = get_nigeria_geometry()
    coll = (
        ee.ImageCollection("GLOBAL_FLOOD_DB/MODIS_EVENTS/V1")
        .filterBounds(nigeria)
        .filterDate(f"{start_year}-01-01", f"{end_year + 1}-01-01")
        .sort("system:time_start")
    )
    total = coll.size().getInfo()
    count = min(total, limit) if limit else total
    log.info("Fetching %s GFD events intersecting Nigeria", count)
    images = coll.toList(count)

    events: list[dict] = []
    for idx in range(count):
        image = ee.Image(images.get(idx))
        props = _event_properties(image, idx + 1)
        flooded = image.select("flooded").selfMask().clip(nigeria)
        vectors = flooded.reduceToVectors(
            geometry=nigeria,
            scale=250,
            geometryType="polygon",
            bestEffort=True,
            maxPixels=1_000_000_000,
            eightConnected=True,
        )
        vector_fc = ee.FeatureCollection(vectors)
        size = int(vector_fc.size().getInfo() or 0)
        if size == 0:
            continue
        geometry = vector_fc.geometry().dissolve(100)
        geojson = ee.Feature(geometry).getInfo().get("geometry")
        if not geojson:
            continue
        shp = shape(geojson)
        if shp.is_empty or shp.area < MIN_EVENT_AREA_DEG2:
            continue
        if shp.geom_type == "Polygon":
            shp = MultiPolygon([shp])
        elif shp.geom_type != "MultiPolygon":
            shp = MultiPolygon([g for g in getattr(shp, "geoms", []) if g.geom_type == "Polygon"])
        if shp.is_empty:
            continue

        centroid = shp.centroid
        events.append(
            {
                **props,
                "state": infer_state(props.get("metadata") or {}, centroid.y, centroid.x),
                "geom": shp,
                "centroid_lat": centroid.y,
                "centroid_lon": centroid.x,
            }
        )
    log.info("Prepared %s historical event footprints", len(events))
    return events


def infer_state(metadata: dict, lat: float, lon: float) -> str | None:
    text_parts = []
    for key in ("cc", "countries", "dfo_country", "region", "location", "name"):
        value = metadata.get(key)
        if isinstance(value, str):
            text_parts.append(value.lower())
    text = " ".join(text_parts)
    state_hints = [
        "abia", "adamawa", "akwa ibom", "anambra", "bauchi", "bayelsa", "benue",
        "borno", "cross river", "delta", "ebonyi", "edo", "ekiti", "enugu", "gombe",
        "imo", "jigawa", "kaduna", "kano", "katsina", "kebbi", "kogi", "kwara",
        "lagos", "nasarawa", "niger", "ogun", "ondo", "osun", "oyo", "plateau",
        "rivers", "sokoto", "taraba", "yobe", "zamfara", "abuja", "fct",
    ]
    for hint in state_hints:
        if hint in text:
            return hint.title().replace("Fct", "FCT")
    if 4.2 <= lat <= 13.9 and 2.8 <= lon <= 14.6:
        return None
    return None


def derive_hotspots(events: list[dict], grid_step_deg: float = GRID_STEP_DEG) -> list[dict]:
    from shapely.geometry import MultiPolygon, Polygon, box
    from shapely.ops import unary_union
    from shapely.prepared import prep

    if not events:
        return []

    minx, miny, maxx, maxy = NIGERIA_BBOX
    hotspot_cells = []
    prepared = [(prep(event["geom"]), event) for event in events]
    max_count = 0
    row = 0
    y = miny
    while y < maxy:
        col = 0
        x = minx
        while x < maxx:
            cell = box(x, y, min(x + grid_step_deg, maxx), min(y + grid_step_deg, maxy))
            count = 0
            states = set()
            years = set()
            for geom_prepared, event in prepared:
                if geom_prepared.intersects(cell):
                    count += 1
                    if event.get("state"):
                        states.add(event["state"])
                    if event.get("started_at"):
                        years.add(str(event["started_at"])[:4])
            if count > 0 and cell.area >= MIN_HOTSPOT_AREA_DEG2:
                max_count = max(max_count, count)
                hotspot_cells.append(
                    {
                        "row": row,
                        "col": col,
                        "geom": cell,
                        "event_count": count,
                        "states": sorted(states),
                        "years": sorted(years),
                    }
                )
            col += 1
            x += grid_step_deg
        row += 1
        y += grid_step_deg

    if not hotspot_cells or max_count <= 0:
        return []

    grouped: dict[str, list[dict]] = {"Occasional": [], "Frequent": [], "Persistent": []}
    for cell in hotspot_cells:
        count = cell["event_count"]
        if count >= 6:
            tier = "Persistent"
        elif count >= 3:
            tier = "Frequent"
        else:
            tier = "Occasional"
        cell["risk_tier"] = tier
        cell["risk_score"] = round(count / max_count, 4)
        grouped[tier].append(cell)

    hotspots = []
    for tier, cells in grouped.items():
        if not cells:
            continue
        merged = unary_union([c["geom"] for c in cells])
        geoms = [merged] if merged.geom_type == "Polygon" else list(getattr(merged, "geoms", []))
        for idx, geom in enumerate(sorted(geoms, key=lambda g: g.area, reverse=True), start=1):
            if geom.is_empty or geom.area < MIN_HOTSPOT_AREA_DEG2:
                continue
            if geom.geom_type == "Polygon":
                mp = MultiPolygon([geom])
            elif geom.geom_type == "MultiPolygon":
                mp = geom
            else:
                continue
            contributors = [c for c in cells if c["geom"].intersects(mp)]
            event_count = max((c["event_count"] for c in contributors), default=0)
            risk_score = max((c["risk_score"] for c in contributors), default=0.0)
            states = sorted({state for c in contributors for state in c["states"]})
            years = sorted({year for c in contributors for year in c["years"]})
            centroid = mp.centroid
            bounds = list(mp.bounds)
            hotspot_id = f"{SOURCE}:{tier.lower()}:{idx}"
            hotspots.append(
                {
                    "hotspot_id": hotspot_id,
                    "hotspot_name": f"{tier} hotspot {idx}",
                    "risk_tier": tier,
                    "risk_score": risk_score,
                    "event_count": int(event_count),
                    "area_km2": round(_deg2_to_km2(mp.area, centroid.y), 1),
                    "geom": mp,
                    "centroid_lat": centroid.y,
                    "centroid_lon": centroid.x,
                    "bbox_lnglat": bounds,
                    "metadata": {"states": states, "years": years},
                }
            )
    log.info("Derived %s hotspot polygons", len(hotspots))
    return hotspots


def derive_jrc_fallback_hotspots() -> list[dict]:
    """Vectorize the persisted JRC water-occurrence COG into hotspot zones."""
    import boto3
    import numpy as np
    import psycopg2
    import rasterio
    from affine import Affine
    from rasterio.enums import Resampling
    from rasterio.features import shapes
    from shapely.geometry import MultiPolygon, Polygon, shape

    with psycopg2.connect(DB_DSN) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT minio_path
            FROM flood_risk_tiles
            WHERE source = 'jrc_occurrence'
            ORDER BY created_at DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row or not row[0] or not str(row[0]).startswith("s3://"):
        log.error("No persisted JRC occurrence COG is registered")
        return []

    bucket, key = str(row[0])[5:].split("/", 1)
    client = boto3.client(
        "s3",
        endpoint_url=os.getenv("MINIO_ENDPOINT", "http://localhost:9000"),
        aws_access_key_id=os.getenv("MINIO_ROOT_USER", "minioadmin"),
        aws_secret_access_key=os.getenv("MINIO_ROOT_PASSWORD", "minioadmin"),
    )

    with tempfile.TemporaryDirectory(prefix="jrc-hotspots-") as tmp:
        path = Path(tmp) / "occurrence.tif"
        client.download_file(bucket, key, str(path))
        with rasterio.open(path) as dataset:
            out_height = max(1, dataset.height // 4)
            out_width = max(1, dataset.width // 4)
            occurrence = dataset.read(
                1,
                out_shape=(out_height, out_width),
                resampling=Resampling.average,
            )
            transform = dataset.transform * Affine.scale(
                dataset.width / out_width,
                dataset.height / out_height,
            )

    tiers = np.zeros(occurrence.shape, dtype="uint8")
    tiers[(occurrence >= 5) & (occurrence < 25)] = 1
    tiers[(occurrence >= 25) & (occurrence < 50)] = 2
    tiers[occurrence >= 50] = 3
    tier_meta = {
        1: ("Occasional", 0.15, "5–24% historical water occurrence"),
        2: ("Frequent", 0.375, "25–49% historical water occurrence"),
        3: ("Persistent", 0.75, "50–100% historical water occurrence"),
    }

    hotspots = []
    counters = {1: 0, 2: 0, 3: 0}
    for geometry, value in shapes(tiers, mask=tiers > 0, transform=transform):
        tier_value = int(value)
        geom = shape(geometry)
        if not geom.is_valid:
            geom = geom.buffer(0)
        geom = geom.simplify(0.01, preserve_topology=True)
        if geom.is_empty or geom.area < 0.001:
            continue
        if isinstance(geom, Polygon):
            geom = MultiPolygon([geom])
        elif not isinstance(geom, MultiPolygon):
            polygons = [part for part in getattr(geom, "geoms", []) if isinstance(part, Polygon)]
            if not polygons:
                continue
            geom = MultiPolygon(polygons)

        counters[tier_value] += 1
        tier, score, threshold = tier_meta[tier_value]
        centroid = geom.centroid
        hotspots.append(
            {
                "hotspot_id": f"{FALLBACK_SOURCE}:{tier.lower()}:{counters[tier_value]}",
                "hotspot_name": f"{tier} historical-water hotspot {counters[tier_value]}",
                "risk_tier": tier,
                "risk_score": score,
                "event_count": 0,
                "area_km2": round(_deg2_to_km2(geom.area, centroid.y), 1),
                "geom": geom,
                "centroid_lat": centroid.y,
                "centroid_lon": centroid.x,
                "bbox_lnglat": list(geom.bounds),
                "metadata": {
                    "method": "JRC Global Surface Water occurrence fallback",
                    "period": "1984–2021",
                    "threshold": threshold,
                },
            }
        )

    hotspots.sort(key=lambda item: (item["risk_score"], item["area_km2"]), reverse=True)
    hotspots = hotspots[:500]
    log.warning("Derived %d JRC occurrence fallback hotspots", len(hotspots))
    return hotspots


def ensure_tables(cur):
    cur.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {EVENT_TABLE} (
            id BIGSERIAL PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            event_name TEXT NOT NULL,
            started_at DATE,
            ended_at DATE,
            state TEXT,
            severity TEXT,
            confidence DOUBLE PRECISION,
            event_count INTEGER NOT NULL DEFAULT 1,
            geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
            centroid_lat DOUBLE PRECISION,
            centroid_lon DOUBLE PRECISION,
            metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_historical_flood_events_source
            ON {EVENT_TABLE} (source, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_historical_flood_events_state
            ON {EVENT_TABLE} (state);
        CREATE INDEX IF NOT EXISTS idx_historical_flood_events_geom
            ON {EVENT_TABLE} USING GIST (geom);

        CREATE TABLE IF NOT EXISTS {HOTSPOT_TABLE} (
            id BIGSERIAL PRIMARY KEY,
            hotspot_id TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            hotspot_name TEXT NOT NULL,
            risk_tier TEXT NOT NULL,
            risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            event_count INTEGER NOT NULL DEFAULT 0,
            area_km2 DOUBLE PRECISION NOT NULL DEFAULT 0,
            geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
            centroid_lat DOUBLE PRECISION,
            centroid_lon DOUBLE PRECISION,
            bbox_lnglat DOUBLE PRECISION[],
            metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_historical_flood_hotspots_source
            ON {HOTSPOT_TABLE} (source, risk_score DESC);
        CREATE INDEX IF NOT EXISTS idx_historical_flood_hotspots_tier
            ON {HOTSPOT_TABLE} (risk_tier);
        CREATE INDEX IF NOT EXISTS idx_historical_flood_hotspots_geom
            ON {HOTSPOT_TABLE} USING GIST (geom);
        """
    )


def save_events_and_hotspots(
    events: list[dict],
    hotspots: list[dict],
    *,
    source: str = SOURCE,
    replace_sources: tuple[str, ...] | None = None,
):
    import psycopg2
    from psycopg2.extras import Json

    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            ensure_tables(cur)
            sources = replace_sources or (source,)
            cur.execute(f"DELETE FROM {EVENT_TABLE} WHERE source = ANY(%s)", (list(sources),))
            cur.execute(f"DELETE FROM {HOTSPOT_TABLE} WHERE source = ANY(%s)", (list(sources),))

            for event in events:
                cur.execute(
                    f"""
                    INSERT INTO {EVENT_TABLE}
                        (event_id, source, event_name, started_at, ended_at, state, severity,
                         confidence, event_count, geom, centroid_lat, centroid_lon, metadata, updated_at)
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
                        %s, %s, %s, NOW()
                    )
                    """,
                    (
                        event["event_id"],
                        source,
                        event["event_name"],
                        event.get("started_at"),
                        event.get("ended_at"),
                        event.get("state"),
                        event.get("severity"),
                        event.get("confidence"),
                        1,
                        json.dumps(_mapping(event["geom"])),
                        event.get("centroid_lat"),
                        event.get("centroid_lon"),
                        Json(event.get("metadata") or {}),
                    ),
                )

            for hotspot in hotspots:
                cur.execute(
                    f"""
                    INSERT INTO {HOTSPOT_TABLE}
                        (hotspot_id, source, hotspot_name, risk_tier, risk_score, event_count,
                         area_km2, geom, centroid_lat, centroid_lon, bbox_lnglat, metadata, updated_at)
                    VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
                        %s, %s, %s, %s, NOW()
                    )
                    """,
                    (
                        hotspot["hotspot_id"],
                        source,
                        hotspot["hotspot_name"],
                        hotspot["risk_tier"],
                        hotspot["risk_score"],
                        hotspot["event_count"],
                        hotspot["area_km2"],
                        json.dumps(_mapping(hotspot["geom"])),
                        hotspot["centroid_lat"],
                        hotspot["centroid_lon"],
                        hotspot["bbox_lnglat"],
                        Json(hotspot.get("metadata") or {}),
                    ),
                )
        conn.commit()
        log.info("Saved %s events and %s hotspots", len(events), len(hotspots))
    finally:
        conn.close()


def _mapping(geom):
    from shapely.geometry import mapping

    return mapping(geom)


def _to_float(value) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except Exception:
        return None


def _deg2_to_km2(area_deg2: float, latitude: float) -> float:
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * math.cos(math.radians(latitude))
    return max(0.0, area_deg2 * km_per_deg_lat * km_per_deg_lon)


def run(start_year: int = 2000, end_year: int = 2018, limit: int | None = None):
    if not init_gee():
        hotspots = derive_jrc_fallback_hotspots()
        if not hotspots:
            raise RuntimeError("GEE unavailable and JRC hotspot fallback failed")
        save_events_and_hotspots([], hotspots, source=FALLBACK_SOURCE)
        return
    events = fetch_nigeria_events(start_year=start_year, end_year=end_year, limit=limit)
    hotspots = derive_hotspots(events)
    save_events_and_hotspots(
        events,
        hotspots,
        source=SOURCE,
        replace_sources=(SOURCE, FALLBACK_SOURCE),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=2018)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    run(start_year=args.start_year, end_year=args.end_year, limit=args.limit)
