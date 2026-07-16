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
import logging
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

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)


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

            out.append(
                {
                    "name": f"Urban cluster {idx}",
                    "state": None,
                    "geometry": mapping(g),
                    "centroid_lat": float(centroid.y),
                    "centroid_lon": float(centroid.x),
                    "area_km2": round(area_km2, 3),
                    "impervious_frac": round(impervious, 4),
                    "flat_frac": round(flat_frac, 4),
                }
            )
        except Exception as exc:
            log.warning("Skipping cluster %d: %s", idx, exc)

    log.info("Prepared %d urban footprints", len(out))
    return out


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
    parser.parse_args()
    run()
