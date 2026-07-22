"""
Urban flash-flood classifier (short-range, 3-hourly)
====================================================
Loads precomputed ``urban_footprints``, fetches OpenMeteo 24h rainfall
forecasts at each centroid (batched), and writes Likely / Highly Likely
polygons into ``flood_risk_areas`` with ``source='urban_flash_flood'``.

No GEE dependency — footprints are refreshed monthly by
``urban_footprints.py``.

Tunable thresholds at top of file.

Run:
  DB_HOST=localhost python ingest/flood_risk/urban_flash_flood.py
"""

from __future__ import annotations

import argparse
import logging
import os
from datetime import date, timedelta

log = logging.getLogger(__name__)
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [urban-flash] %(message)s",
    )

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)

OPENMETEO_BASE = "https://api.open-meteo.com/v1/forecast"
SOURCE = "urban_flash_flood"
ADMIN_LEVEL = "urban_flash"

# ── Tunable classification thresholds ─────────────────────────────────────────
RAIN_3H_HIGHLY_MM = 25.0   # max rolling 3h sum → Highly Likely (with susceptibility)
RAIN_24H_HIGHLY_MM = 50.0  # 24h total → Highly Likely (with susceptibility)
RAIN_24H_LIKELY_MM = 25.0  # 24h total → Likely
IMPERVIOUS_MIN = 0.40
FLAT_FRAC_MIN = 0.30
SCORE_HIGHLY = 0.85
SCORE_LIKELY = 0.55

# OpenMeteo allows multiple locations per request via comma-separated coords
BATCH_SIZE = 50


def _get(url: str) -> dict:
    try:
        import httpx

        r = httpx.get(url, timeout=60)
        r.raise_for_status()
        return r.json()
    except ImportError:
        import json as _json
        import urllib.request

        with urllib.request.urlopen(url, timeout=60) as resp:
            return _json.loads(resp.read())


def load_footprints(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, state,
                   ST_AsGeoJSON(geom)::text AS geometry,
                   centroid_lat, centroid_lon,
                   area_km2, impervious_frac, flat_frac
            FROM urban_footprints
            ORDER BY area_km2 DESC
            """
        )
        rows = cur.fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "state": r[2],
            "geometry": r[3],
            "centroid_lat": float(r[4]),
            "centroid_lon": float(r[5]),
            "area_km2": float(r[6] or 0),
            "impervious_frac": float(r[7] or 0),
            "flat_frac": float(r[8] or 0),
        }
        for r in rows
    ]


def _rolling_max_sum(values: list[float], window: int) -> float:
    if not values:
        return 0.0
    n = len(values)
    best = 0.0
    for i in range(n):
        end = min(i + window, n)
        s = sum(values[i:end])
        if s > best:
            best = s
    return best


def fetch_rainfall_batch(footprints: list[dict]) -> dict[int, dict]:
    """
    Return {footprint_id: {rain_3h_max, rain_24h}} for a batch.
    OpenMeteo multi-location returns a list when multiple coords are requested.
    """
    if not footprints:
        return {}

    lats = ",".join(f"{f['centroid_lat']:.4f}" for f in footprints)
    lons = ",".join(f"{f['centroid_lon']:.4f}" for f in footprints)
    url = (
        f"{OPENMETEO_BASE}"
        f"?latitude={lats}&longitude={lons}"
        f"&hourly=precipitation"
        f"&forecast_days=1&timezone=UTC"
    )

    try:
        data = _get(url)
    except Exception as exc:
        log.warning("OpenMeteo batch failed (%d pts): %s", len(footprints), exc)
        return {}

    # Single location → dict; multi → list of dicts
    payloads = data if isinstance(data, list) else [data]
    if len(payloads) != len(footprints):
        log.warning(
            "OpenMeteo returned %d payloads for %d footprints — aligning by index",
            len(payloads),
            len(footprints),
        )

    results = {}
    for i, fp in enumerate(footprints):
        if i >= len(payloads):
            break
        hourly = payloads[i].get("hourly") or {}
        precip = [float(v or 0.0) for v in (hourly.get("precipitation") or [])]
        # Next 24 hours
        precip_24 = precip[:24]
        rain_24h = sum(precip_24)
        rain_3h_max = _rolling_max_sum(precip_24, 3)
        results[fp["id"]] = {
            "rain_3h_max": rain_3h_max,
            "rain_24h": rain_24h,
        }
    return results


def classify(fp: dict, rain: dict) -> dict | None:
    rain_3h = rain.get("rain_3h_max", 0.0)
    rain_24h = rain.get("rain_24h", 0.0)
    impervious = fp["impervious_frac"]
    flat = fp["flat_frac"]
    susceptible = impervious >= IMPERVIOUS_MIN or flat >= FLAT_FRAC_MIN

    if (
        (rain_3h >= RAIN_3H_HIGHLY_MM or rain_24h >= RAIN_24H_HIGHLY_MM)
        and susceptible
    ):
        return {
            "tier": "Highly Likely",
            "score": SCORE_HIGHLY,
            "rain_3h_max": rain_3h,
            "rain_24h": rain_24h,
        }

    if rain_24h >= RAIN_24H_LIKELY_MM:
        return {
            "tier": "Likely",
            "score": SCORE_LIKELY,
            "rain_3h_max": rain_3h,
            "rain_24h": rain_24h,
        }

    return None


def save_alerts(conn, alerts: list[dict], valid_from: date, valid_to: date):
    import json

    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM flood_risk_areas WHERE source = %s", (SOURCE,)
        )
        for a in alerts:
            geom = a["geometry"]
            if isinstance(geom, str):
                geom = json.loads(geom)
            # Ensure MultiPolygon WKT via PostGIS from GeoJSON
            cur.execute(
                """
                INSERT INTO flood_risk_areas
                  (name, admin_level, state, geom, risk_score, risk_tier,
                   source, valid_from, valid_to, updated_at)
                VALUES (
                  %s, %s, %s,
                  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
                  %s, %s, %s, %s, %s, NOW()
                )
                """,
                (
                    a["name"],
                    ADMIN_LEVEL,
                    a.get("state"),
                    json.dumps(geom),
                    a["score"],
                    a["tier"],
                    SOURCE,
                    valid_from,
                    valid_to,
                ),
            )
    conn.commit()
    log.info("Wrote %d urban flash-flood alerts", len(alerts))


def ensure_table(conn):
    """No-op if flood_risk_areas exists; create urban_footprints if missing."""
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
    """
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def run():
    import psycopg2

    today = date.today()
    valid_from = today
    valid_to = today + timedelta(days=1)

    conn = psycopg2.connect(DB_DSN)
    try:
        ensure_table(conn)
        footprints = load_footprints(conn)
        if not footprints:
            log.warning(
                "No urban_footprints in DB — run urban_footprints.py first; "
                "clearing any stale urban_flash_flood rows"
            )
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM flood_risk_areas WHERE source = %s", (SOURCE,)
                )
            conn.commit()
            return

        log.info("Loaded %d urban footprints", len(footprints))
        rain_by_id: dict[int, dict] = {}
        for start in range(0, len(footprints), BATCH_SIZE):
            batch = footprints[start : start + BATCH_SIZE]
            rain_by_id.update(fetch_rainfall_batch(batch))
            log.info(
                "  Rainfall fetched for %d / %d footprints",
                min(start + BATCH_SIZE, len(footprints)),
                len(footprints),
            )

        alerts = []
        for fp in footprints:
            rain = rain_by_id.get(fp["id"])
            if not rain:
                continue
            result = classify(fp, rain)
            if not result:
                continue
            alerts.append(
                {
                    "id": fp["id"],
                    "name": fp["name"],
                    "state": fp.get("state"),
                    "geometry": fp["geometry"],
                    "tier": result["tier"],
                    "score": result["score"],
                }
            )

        # One alert per footprint; prefer Highly Likely if classify were ever dual
        by_id: dict[int, dict] = {}
        for a in alerts:
            prev = by_id.get(a["id"])
            if not prev or (
                a["tier"] == "Highly Likely" and prev["tier"] != "Highly Likely"
            ):
                by_id[a["id"]] = a
        alerts = list(by_id.values())

        save_alerts(conn, alerts, valid_from, valid_to)
        highly = sum(1 for a in alerts if a["tier"] == "Highly Likely")
        likely = sum(1 for a in alerts if a["tier"] == "Likely")
        log.info(
            "Urban flash flood complete — %d Highly Likely, %d Likely (of %d footprints)",
            highly,
            likely,
            len(footprints),
        )
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Short-range urban flash-flood classifier (OpenMeteo)"
    )
    parser.parse_args()
    run()
