"""
Synthetic Flood Risk Generator
================================
Generates a realistic flood risk GeoJSON for Nigeria based on:
  - Proximity to major rivers (Benue, Niger, Kaduna, Sokoto, Anambra)
  - Current gauge water levels from TimescaleDB
  - Elevation proxy (river valleys lower)
  - Recent rainfall totals from met stations

This runs automatically when GEE credentials are not configured.
Outputs risk areas to both DB (flood_risk_areas table) and a GeoJSON file.

Run: python synthetic_flood_risk.py
"""

import os
import json
import math
import logging
import hashlib
from datetime import date, timedelta

import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [synthetic-risk] %(message)s", force=True)
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)

# Nigeria states with approximate centroids and flood exposure weights
NIGERIA_STATES = [
    # (name, lon, lat, base_flood_exposure, near_major_river)
    ("Kogi",          6.74,  7.80,  0.85, True),   # Niger-Benue confluence
    ("Anambra",       6.78,  6.22,  0.80, True),
    ("Delta",         5.95,  5.50,  0.82, True),
    ("Rivers",        7.02,  4.85,  0.78, True),
    ("Bayelsa",       6.07,  4.78,  0.90, True),
    ("Cross River",   8.33,  5.87,  0.65, False),
    ("Edo",           6.11,  6.34,  0.60, True),
    ("Imo",           7.05,  5.57,  0.55, False),
    ("Enugu",         7.51,  6.44,  0.45, False),
    ("Ebonyi",        8.09,  6.26,  0.42, False),
    ("Kaduna",        7.72, 10.52,  0.55, True),
    ("Niger",         5.58,  9.93,  0.70, True),
    ("Kebbi",         4.20, 12.45,  0.65, True),
    ("Sokoto",        5.24, 13.06,  0.60, True),
    ("Zamfara",       6.22, 12.17,  0.45, False),
    ("Katsina",       7.60, 12.98,  0.40, False),
    ("Kano",          8.52, 12.05,  0.48, False),
    ("Jigawa",        9.56, 12.22,  0.50, False),
    ("Yobe",         11.97, 12.29,  0.35, False),
    ("Borno",        13.16, 11.85,  0.40, False),
    ("Adamawa",      12.39,  9.33,  0.50, True),
    ("Taraba",       11.44,  8.00,  0.55, True),
    ("Gombe",        11.17, 10.29,  0.42, False),
    ("Bauchi",        9.84, 10.31,  0.43, False),
    ("Plateau",       8.89,  9.22,  0.38, False),
    ("Nassarawa",     8.52,  8.50,  0.50, True),
    ("Benue",         8.74,  7.34,  0.75, True),
    ("Kwara",         4.55,  8.49,  0.60, True),
    ("Oyo",           3.95,  8.16,  0.48, False),
    ("Osun",          4.58,  7.56,  0.45, False),
    ("Ondo",          4.84,  7.10,  0.52, False),
    ("Ekiti",         5.22,  7.62,  0.40, False),
    ("Lagos",         3.38,  6.52,  0.75, True),
    ("Ogun",          3.35,  7.16,  0.55, True),
    ("Abuja FCT",     7.49,  9.08,  0.42, False),
    ("Abia",          7.52,  5.45,  0.50, False),
    ("Akwa Ibom",     7.85,  4.90,  0.70, True),
]


def _make_state_polygon(lon: float, lat: float, size: float = 0.8) -> dict:
    """Approximate state as a bounding box polygon (placeholder geometry)."""
    w, s, e, n = lon - size, lat - size * 0.75, lon + size, lat + size * 0.75
    coords = [[[w, s], [e, s], [e, n], [w, n], [w, s]]]
    return {"type": "MultiPolygon", "coordinates": [coords]}


def fetch_live_risk_modifiers(conn) -> dict[int, float]:
    """
    Pull latest predictions and gauge levels → risk modifier per station.
    Returns dict of {station_id: modifier_0_to_1}.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (station_id)
                station_id, level_pct_bank, rolling_rain_24h_mm
            FROM flood_features
            ORDER BY station_id, time DESC
        """)
        rows = cur.fetchall()
    return {r[0]: min(1.0, (r[1] or 0) * 0.7 + (r[2] or 0) / 100 * 0.3)
            for r in rows}


def _seasonal_factor() -> float:
    """0.15 (dry, Jan–Mar) → 1.0 (peak wet, Aug). Sinusoid peaking doy≈220."""
    import math
    doy = date.today().timetuple().tm_yday
    return 0.15 + 0.85 * max(0, math.sin(2 * math.pi * (doy - 80) / 365))


def compute_state_risk(base_exposure: float, near_river: bool,
                       live_modifier: float = 0.0) -> tuple[float, str]:
    """Combine base exposure + seasonal factor + live gauge/rainfall → risk score + tier."""
    sf = _seasonal_factor()
    # Seasonal component: scales base_exposure down in dry season
    seasonal_score = base_exposure * sf
    # Live gauge/rainfall always contributes (real-time signal)
    score = seasonal_score * 0.55 + base_exposure * 0.15 + live_modifier * 0.30
    if near_river:
        score = min(1.0, score * 1.12)
    score = round(score, 3)

    if score >= 0.75:
        tier = "Emergency"
    elif score >= 0.50:
        tier = "Warning"
    elif score >= 0.25:
        tier = "Watch"
    else:
        tier = "Normal"
    return score, tier


def generate_synthetic_risk(export_geojson_path: str = None):
    """Generate and store synthetic flood risk areas for all Nigeria states.

    Skipped when a fresh SAR/DEM inundation product already exists (prefer real extents).
    """
    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM flood_risk_areas
                WHERE source = 'sar_dem_inundation'
                  AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
                """
            )
            inundation_count = cur.fetchone()[0]
        if inundation_count > 0:
            log.info(
                "Skipping synthetic risk — %d active SAR/DEM inundation polygons present",
                inundation_count,
            )
            conn.close()
            return {"type": "FeatureCollection", "features": [], "skipped": True}
    except Exception as exc:
        log.warning("Could not check inundation rows (%s) — continuing with synthetic", exc)

    live_modifiers = fetch_live_risk_modifiers(conn)
    avg_modifier = sum(live_modifiers.values()) / max(len(live_modifiers), 1)

    today = date.today()
    valid_from = today
    valid_to   = today + timedelta(days=7)

    rows = []
    features = []

    for name, lon, lat, base_exp, near_river in NIGERIA_STATES:
        score, tier = compute_state_risk(base_exp, near_river, avg_modifier)
        geom_dict = _make_state_polygon(lon, lat)
        geom_wkt  = _multipolygon_to_wkt(geom_dict)

        rows.append((name, "state", name, geom_wkt, score, tier,
                     "synthetic", valid_from, valid_to))

        features.append({
            "type": "Feature",
            "geometry": geom_dict,
            "properties": {
                "name":       name,
                "risk_score": score,
                "risk_tier":  tier,
                "source":     "synthetic",
                "valid_from": str(valid_from),
                "valid_to":   str(valid_to),
            },
        })

    # Clear old synthetic rows and insert fresh
    with conn.cursor() as cur:
        cur.execute("DELETE FROM flood_risk_areas WHERE source = 'synthetic'")
        for r in rows:
            cur.execute("""
                INSERT INTO flood_risk_areas
                  (name, admin_level, state, geom, risk_score, risk_tier,
                   source, valid_from, valid_to, updated_at)
                VALUES (%s, %s, %s,
                        ST_GeomFromText(%s, 4326),
                        %s, %s, %s, %s, %s, NOW())
            """, (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]))
    conn.commit()
    conn.close()

    log.info("Inserted %d synthetic risk areas into DB", len(rows))

    fc = {"type": "FeatureCollection", "features": features}
    if export_geojson_path:
        with open(export_geojson_path, "w") as f:
            json.dump(fc, f)
        log.info("GeoJSON written: %s", export_geojson_path)

    return fc


def run(export_geojson_path: str = None):
    """Scheduler entrypoint used by ingest/main.py."""
    return generate_synthetic_risk(export_geojson_path)


def _multipolygon_to_wkt(geom: dict) -> str:
    rings = []
    for poly in geom["coordinates"]:
        for ring in poly:
            pts = ", ".join(f"{x} {y}" for x, y in ring)
            rings.append(f"(({pts}))")
    return "MULTIPOLYGON(" + ",".join(rings) + ")"


if __name__ == "__main__":
    fc = generate_synthetic_risk("flood_risk_nigeria.geojson")
    log.info("Done — %d features", len(fc["features"]))
