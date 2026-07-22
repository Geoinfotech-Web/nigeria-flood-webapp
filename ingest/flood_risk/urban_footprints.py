"""
Urban built-up footprints from GEE (monthly)
=============================================
Extracts ESA WorldCover built-up (class 50) clusters for Nigeria,
computes per-cluster impervious_frac and flat_frac (SRTM slope /
height-above-drainage), and upserts into ``urban_footprints``.

Used by the short-range urban flash-flood classifier
(``urban_flash_flood.py``) which only needs centroids + static
susceptibility — no GEE on the 3-hourly path.

Run:
  DB_HOST=localhost GEE_SERVICE_ACCOUNT_EMAIL=... GEE_SERVICE_ACCOUNT_KEY=... \\
    python ingest/flood_risk/urban_footprints.py
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
from pathlib import Path

log = logging.getLogger(__name__)
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [urban-footprints] %(message)s",
    )

GEE_KEY_FILE = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")
GEE_SA_EMAIL = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL", "")

# Min area (km²) to keep; largest N clusters retained after filter
MIN_AREA_KM2 = 2.0
MAX_CLUSTERS = 400
# Height-above-drainage threshold (m) for "flat / flood-prone"
HAD_MAX_M = 15.0
SLOPE_MAX_DEG = 2.0
# Vectorize at ~300 m (WorldCover native is 10 m; coarsen for tractability)
VECTORIZE_SCALE_M = 300

NIGERIA_BBOX = [2.7, 4.0, 14.7, 14.0]

# OSM places + admin polygons used to replace "Urban cluster N" labels
_REPO_ROOT = Path(__file__).resolve().parents[2]
_DATA_DIR = Path(os.getenv("GFW_DATA_DIR", str(_REPO_ROOT / "api" / "data")))
_PLACES_PATH = _DATA_DIR / "exposure_places.geojson"
_LGAS_PATH = _DATA_DIR / "admin_lgas.geojson"

# Prefer cities/towns near the cluster; fall back to containing LGA
_CITY_MAX_KM = 40.0
_TOWN_MAX_KM = 25.0
_VILLAGE_MAX_KM = 5.0

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)

# Lazily loaded naming gazetteer
_NAME_INDEX: dict | None = None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _load_name_index() -> dict:
    """Load settlement points + LGA polygons for place naming."""
    global _NAME_INDEX
    if _NAME_INDEX is not None:
        return _NAME_INDEX

    from shapely.geometry import shape

    places: list[dict] = []
    if _PLACES_PATH.exists():
        with _PLACES_PATH.open(encoding="utf-8") as f:
            fc = json.load(f)
        for feat in fc.get("features") or []:
            props = feat.get("properties") or {}
            name = (props.get("name") or "").strip()
            geom = feat.get("geometry") or {}
            if not name or geom.get("type") != "Point":
                continue
            coords = geom.get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = float(coords[0]), float(coords[1])
            cls = (props.get("class") or props.get("place") or "Village").title()
            if cls not in ("City", "Town", "Village"):
                cls = "Village"
            places.append({"name": name, "lat": lat, "lon": lon, "class": cls})
    else:
        log.warning("Places file missing: %s", _PLACES_PATH)

    lgas: list[dict] = []
    if _LGAS_PATH.exists():
        with _LGAS_PATH.open(encoding="utf-8") as f:
            fc = json.load(f)
        for feat in fc.get("features") or []:
            props = feat.get("properties") or {}
            name = (props.get("name") or "").strip()
            geom = feat.get("geometry")
            if not name or not geom:
                continue
            try:
                g = shape(geom)
            except Exception:
                continue
            lgas.append(
                {
                    "name": name,
                    "state": (props.get("state") or "").strip() or None,
                    "geom": g,
                }
            )
    else:
        log.warning("LGA file missing: %s", _LGAS_PATH)

    _NAME_INDEX = {"places": places, "lgas": lgas}
    log.info(
        "Loaded naming gazetteer: %d places, %d LGAs",
        len(places),
        len(lgas),
    )
    return _NAME_INDEX


def resolve_place_name(lat: float, lon: float) -> tuple[str, str | None]:
    """
    Return (display_name, state) for an urban-cluster centroid.

    Prefers nearby City / Town from OSM places; otherwise the containing LGA.
    Display name is ``Place, State`` when state is known.
    """
    from shapely.geometry import Point

    idx = _load_name_index()
    point = Point(lon, lat)

    lga_name = None
    state = None
    for lga in idx["lgas"]:
        try:
            if lga["geom"].contains(point) or lga["geom"].intersects(point):
                lga_name = lga["name"]
                state = lga.get("state")
                break
        except Exception:
            continue

    # Distance-first among City/Town so a nearby town beats a distant city.
    best: tuple[float, int, str] | None = None  # (dist_km, class_rank, name)
    best_village: tuple[float, int, str] | None = None
    for place in idx["places"]:
        dist = _haversine_km(lat, lon, place["lat"], place["lon"])
        cls = place["class"]
        if cls == "City" and dist <= _CITY_MAX_KM:
            cand = (dist, 0, place["name"])
            if best is None or cand < best:
                best = cand
        elif cls == "Town" and dist <= _TOWN_MAX_KM:
            cand = (dist, 1, place["name"])
            if best is None or cand < best:
                best = cand
        elif cls == "Village" and dist <= _VILLAGE_MAX_KM:
            cand = (dist, 2, place["name"])
            if best_village is None or cand < best_village:
                best_village = cand

    if best is not None:
        place_name = best[2]
    elif best_village is not None:
        place_name = best_village[2]
    else:
        place_name = lga_name
    if not place_name:
        place_name = f"Urban area ({lat:.2f}N, {lon:.2f}E)"

    if state:
        display = f"{place_name}, {state}"
    else:
        display = place_name
    return display, state


def init_gee() -> bool:
    try:
        import ee
    except ImportError:
        log.error("earthengine-api not installed: pip install earthengine-api")
        return False
    try:
        if GEE_KEY_FILE and Path(GEE_KEY_FILE).exists():
            creds = ee.ServiceAccountCredentials(GEE_SA_EMAIL, GEE_KEY_FILE)
            ee.Initialize(creds)
            log.info("GEE initialised with service account")
        else:
            ee.Initialize()
            log.info("GEE initialised with default credentials")
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


def build_footprints():
    """
    Return list of dicts:
      name, geometry (GeoJSON), centroid_lat, centroid_lon,
      area_km2, impervious_frac, flat_frac
    """
    import ee

    nigeria = get_nigeria_geometry()

    worldcover = (
        ee.ImageCollection("ESA/WorldCover/v200")
        .first()
        .select("Map")
        .clip(nigeria)
    )
    built = worldcover.eq(50).selfMask().rename("built")

    # Coarsen before vectorize so we get city-scale clusters, not pixel noise
    built_coarse = built.reproject(crs="EPSG:4326", scale=VECTORIZE_SCALE_M)

    vectors = built_coarse.reduceToVectors(
        geometry=nigeria,
        scale=VECTORIZE_SCALE_M,
        geometryType="polygon",
        eightConnected=True,
        labelProperty="built",
        maxPixels=1e10,
        bestEffort=True,
    )

    # Area filter in m²
    min_area_m2 = MIN_AREA_KM2 * 1e6
    vectors = vectors.map(
        lambda f: f.set("area_m2", f.geometry().area(maxError=100))
    ).filter(ee.Filter.gte("area_m2", min_area_m2))

    # Keep largest N by area
    vectors = vectors.sort("area_m2", False).limit(MAX_CLUSTERS)

    # Static susceptibility layers
    srtm = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(nigeria)
    slope = ee.Terrain.slope(srtm)
    focal_min = srtm.focal_min(radius=1000, units="meters", kernelType="circle")
    height_above_drain = srtm.subtract(focal_min)
    flat = (
        slope.lt(SLOPE_MAX_DEG)
        .And(height_above_drain.lte(HAD_MAX_M))
        .rename("flat")
    )
    # Built fraction inside each cluster (should be ~1 for pure built clusters,
    # but coarse vectorize can include mixed pixels)
    built_frac_img = worldcover.eq(50).rename("impervious")

    stacked = built_frac_img.addBands(flat)

    stats = stacked.reduceRegions(
        collection=vectors,
        reducer=ee.Reducer.mean(),
        scale=VECTORIZE_SCALE_M,
        tileScale=4,
    )

    # Pull to client in chunks if needed; for <=400 features getInfo is fine
    log.info("Fetching urban cluster features from GEE…")
    fc = stats.getInfo()
    features_raw = fc.get("features") or []
    log.info("GEE returned %d clusters", len(features_raw))

    from shapely.geometry import MultiPolygon, Polygon, mapping, shape

    out = []
    for idx, feat in enumerate(features_raw, start=1):
        props = feat.get("properties") or {}
        geom_raw = feat.get("geometry")
        if not geom_raw:
            continue
        try:
            g = shape(geom_raw)
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty:
                continue
            # Simplify ~0.005 deg ≈ 500 m
            g = g.simplify(0.005, preserve_topology=True)
            if g.is_empty:
                continue
            if isinstance(g, Polygon):
                g = MultiPolygon([g])
            elif not isinstance(g, MultiPolygon):
                # GeometryCollection etc.
                polys = [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]
                if not polys:
                    continue
                g = MultiPolygon(polys) if len(polys) > 1 else MultiPolygon([polys[0]])

            centroid = g.centroid
            area_km2 = float(props.get("area_m2") or 0) / 1e6
            if area_km2 <= 0:
                # Approximate from geometry (deg² → rough km² near equator)
                area_km2 = g.area * 111.0 * 111.0

            impervious = float(props.get("impervious") or 0.0)
            flat_frac = float(props.get("flat") or 0.0)
            # Clamp
            impervious = max(0.0, min(1.0, impervious))
            flat_frac = max(0.0, min(1.0, flat_frac))

            c_lat, c_lon = float(centroid.y), float(centroid.x)
            place_name, state = resolve_place_name(c_lat, c_lon)

            out.append(
                {
                    "name": place_name,
                    "state": state,
                    "geometry": mapping(g),
                    "centroid_lat": c_lat,
                    "centroid_lon": c_lon,
                    "area_km2": round(area_km2, 3),
                    "impervious_frac": round(impervious, 4),
                    "flat_frac": round(flat_frac, 4),
                }
            )
        except Exception as exc:
            log.warning("Skipping cluster %d: %s", idx, exc)

    log.info("Prepared %d urban footprints", len(out))
    return out


def rename_existing_in_db() -> int:
    """
    Rename footprints already in the DB using OSM places + LGAs, and sync
    ``flood_risk_areas`` rows with ``source='urban_flash_flood'`` by centroid.
    """
    import psycopg2

    ensure_table()
    conn = psycopg2.connect(DB_DSN)
    updated = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, centroid_lat, centroid_lon
                FROM urban_footprints
                ORDER BY id
                """
            )
            rows = cur.fetchall()
            if not rows:
                log.warning("No urban_footprints to rename")
                return 0

            renamed: list[dict] = []
            for fid, lat, lon in rows:
                name, state = resolve_place_name(float(lat), float(lon))
                renamed.append(
                    {
                        "id": fid,
                        "name": name,
                        "state": state,
                        "lat": float(lat),
                        "lon": float(lon),
                    }
                )

            for r in renamed:
                cur.execute(
                    """
                    UPDATE urban_footprints
                    SET name = %s, state = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (r["name"], r["state"], r["id"]),
                )
                updated += 1

            # Sync active urban flash alerts to the nearest footprint name
            cur.execute(
                """
                SELECT id, ST_Y(ST_Centroid(geom)), ST_X(ST_Centroid(geom))
                FROM flood_risk_areas
                WHERE source = 'urban_flash_flood'
                """
            )
            alerts = cur.fetchall()
            for aid, alat, alon in alerts:
                best = None
                best_d = 1e9
                for r in renamed:
                    d = _haversine_km(float(alat), float(alon), r["lat"], r["lon"])
                    if d < best_d:
                        best_d = d
                        best = r
                if best is None or best_d > 5.0:
                    # Fallback: name the alert centroid directly
                    name, state = resolve_place_name(float(alat), float(alon))
                else:
                    name, state = best["name"], best["state"]
                cur.execute(
                    """
                    UPDATE flood_risk_areas
                    SET name = %s, state = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (name, state, aid),
                )
                log.info(
                    "Urban flash area %s → %s (%.1f km to footprint)",
                    aid,
                    name,
                    best_d if best is not None else -1,
                )

        conn.commit()
    finally:
        conn.close()
    log.info("Renamed %d urban footprints (+ synced urban flash alerts)", updated)
    return updated


def _multipolygon_to_wkt(geom: dict) -> str:
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        coords = [coords]
    rings = []
    for poly in coords:
        for ring in poly:
            pts = ", ".join(f"{x} {y}" for x, y in ring)
            rings.append(f"(({pts}))")
    return "MULTIPOLYGON(" + ",".join(rings) + ")"


def save_to_db(features: list[dict]):
    import psycopg2

    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM urban_footprints")
            for feat in features:
                wkt = _multipolygon_to_wkt(feat["geometry"])
                cur.execute(
                    """
                    INSERT INTO urban_footprints
                      (name, state, geom, centroid_lat, centroid_lon,
                       area_km2, impervious_frac, flat_frac, updated_at)
                    VALUES (%s, %s, ST_GeomFromText(%s, 4326), %s, %s,
                            %s, %s, %s, NOW())
                    """,
                    (
                        feat["name"],
                        feat.get("state"),
                        wkt,
                        feat["centroid_lat"],
                        feat["centroid_lon"],
                        feat["area_km2"],
                        feat["impervious_frac"],
                        feat["flat_frac"],
                    ),
                )
        conn.commit()
    finally:
        conn.close()
    log.info("Saved %d urban footprints to DB", len(features))


def ensure_table():
    """Create urban_footprints if missing (dev / already-running DB)."""
    import psycopg2

    ddl = """
    CREATE TABLE IF NOT EXISTS urban_footprints (
        id               SERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        state            TEXT,
        geom             GEOMETRY(MultiPolygon, 4326) NOT NULL,
        centroid_lat     DOUBLE PRECISION NOT NULL,
        centroid_lon     DOUBLE PRECISION NOT NULL,
        area_km2         DOUBLE PRECISION NOT NULL DEFAULT 0,
        impervious_frac  DOUBLE PRECISION NOT NULL DEFAULT 0,
        flat_frac        DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_urban_footprints_geom
        ON urban_footprints USING GIST (geom);
    CREATE INDEX IF NOT EXISTS idx_urban_footprints_centroid
        ON urban_footprints (centroid_lat, centroid_lon);
    """
    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(ddl)
        conn.commit()
    finally:
        conn.close()


def run():
    if not init_gee():
        log.error("GEE not available — cannot build urban footprints")
        sys.exit(1)

    ensure_table()
    features = build_footprints()
    if not features:
        log.error("No urban footprints produced")
        sys.exit(1)
    save_to_db(features)
    log.info("Urban footprints complete — %d clusters", len(features))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="GEE ESA WorldCover urban footprints for Nigeria"
    )
    parser.add_argument(
        "--rename-only",
        action="store_true",
        help="Rename existing DB footprints (and urban flash alerts) "
        "from OSM places + LGAs without re-running GEE",
    )
    args = parser.parse_args()
    if args.rename_only:
        n = rename_existing_in_db()
        if n <= 0:
            sys.exit(1)
    else:
        run()
