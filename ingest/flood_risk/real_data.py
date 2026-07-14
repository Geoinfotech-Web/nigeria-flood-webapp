"""
Real Data Ingest — OpenMeteo + GloFAS (DB-driven)
==================================================
Fetches real observations for ALL stations registered in the database.
No station coordinates are hardcoded — adding a station to the DB is
sufficient for it to be picked up automatically on the next run.

Sources (all free, no API key required):
  OpenMeteo Forecast API  — hourly rainfall, temperature, humidity,
                            wind, pressure for every met station
  OpenMeteo Flood API     — daily GloFAS river discharge for every
                            gauge station (converted to water level
                            via Manning equation inverse)

Run:
  python real_data.py --once          # single fetch and exit
  python real_data.py --interval 3600 # poll every hour (default)
"""

import os
import logging
import time
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values

try:
    import httpx
    def _get(url):
        r = httpx.get(url, timeout=20)
        r.raise_for_status()
        return r.json()
except ImportError:
    import urllib.request, json as _json
    def _get(url):
        with urllib.request.urlopen(url, timeout=20) as resp:
            return _json.loads(resp.read())

logging.basicConfig(level=logging.INFO, format="%(asctime)s [real-data] %(message)s", force=True)
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)

OPENMETEO_BASE = "https://api.open-meteo.com/v1/forecast"
FLOOD_API_BASE = "https://flood-api.open-meteo.com/v1/flood"
MET_HISTORY_HOURS = 24 * 7

# Manning inverse constant (calibrated for Nigerian rivers)
MANNING_K = 35.0


# ── Load stations from DB ─────────────────────────────────────────────────────

def load_met_stations(conn) -> list[dict]:
    """Read all met stations with coordinates from DB."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, code, name, lat, lon FROM met_stations ORDER BY id")
        return [{"id": r[0], "code": r[1], "name": r[2], "lat": r[3], "lon": r[4]}
                for r in cur.fetchall()]


def load_gauge_stations(conn) -> list[dict]:
    """Read all gauge stations with coordinates and bank_full from DB."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, code, name, river, state, lat, lon, bank_full_m
            FROM gauge_stations ORDER BY id
        """)
        return [{"id": r[0], "code": r[1], "name": r[2], "river": r[3],
                 "state": r[4], "lat": r[5], "lon": r[6], "bank_full_m": r[7]}
                for r in cur.fetchall()]


# ── OpenMeteo fetchers ────────────────────────────────────────────────────────

def fetch_met(station: dict, hours_back: int = MET_HISTORY_HOURS) -> list[dict]:
    """Fetch recent hourly met observations from OpenMeteo."""
    past_days = max(1, min(14, (hours_back + 23) // 24))
    url = (
        f"{OPENMETEO_BASE}"
        f"?latitude={station['lat']}&longitude={station['lon']}"
        f"&hourly=precipitation,temperature_2m,relative_humidity_2m,"
        f"wind_speed_10m,surface_pressure"
        f"&past_days={past_days}&forecast_days=0&timezone=UTC"
    )
    try:
        data = _get(url)
        hourly = data.get("hourly", {})
        times  = hourly.get("time", [])
        rows   = []
        start_idx = max(0, len(times) - hours_back)
        for i, t in enumerate(times[start_idx:], start=start_idx):
            rows.append({
                "time":          datetime.fromisoformat(t).replace(tzinfo=timezone.utc),
                "rainfall_mm":   hourly["precipitation"][i] or 0.0,
                "temperature_c": hourly["temperature_2m"][i],
                "humidity_pct":  hourly["relative_humidity_2m"][i],
                "wind_speed_ms": (hourly["wind_speed_10m"][i] or 0.0) / 3.6,
                "pressure_hpa":  hourly["surface_pressure"][i],
            })
        return rows
    except Exception as exc:
        log.warning("OpenMeteo met failed [%s]: %s", station["code"], exc)
        return []


def fetch_river(station: dict) -> list[dict]:
    """Fetch GloFAS river discharge from OpenMeteo Flood API."""
    url = (
        f"{FLOOD_API_BASE}"
        f"?latitude={station['lat']}&longitude={station['lon']}"
        f"&daily=river_discharge&past_days=7&forecast_days=7&timezone=UTC"
    )
    try:
        data = _get(url)
        daily = data.get("daily", {})
        rows  = []
        for t, q in zip(daily.get("time", []), daily.get("river_discharge", [])):
            if q is None:
                continue
            q = float(q)
            # Manning inverse: h = (Q / k) ^ (1 / 1.67)
            level = round((q / MANNING_K) ** (1 / 1.67), 3) if q > 0 else 0.0
            rows.append({
                "time":          datetime.fromisoformat(t).replace(tzinfo=timezone.utc),
                "flow_rate_m3s": round(q, 2),
                "water_level_m": level,
            })
        return rows
    except Exception as exc:
        log.warning("GloFAS fetch failed [%s]: %s", station["code"], exc)
        return []


# ── DB writers ────────────────────────────────────────────────────────────────

def write_met(conn, station_id: int, rows: list[dict]):
    if not rows:
        return
    data = [(r["time"], station_id, r["rainfall_mm"], r["temperature_c"],
             r["humidity_pct"], r["wind_speed_ms"], r["pressure_hpa"])
            for r in rows]
    with conn.cursor() as cur:
        execute_values(cur, """
            WITH incoming (
                time, station_id, rainfall_mm, temperature_c,
                humidity_pct, wind_speed_ms, pressure_hpa
            ) AS (
                VALUES %s
            )
            INSERT INTO met_readings
              (time, station_id, rainfall_mm, temperature_c,
               humidity_pct, wind_speed_ms, pressure_hpa)
            SELECT
                i.time, i.station_id, i.rainfall_mm, i.temperature_c,
                i.humidity_pct, i.wind_speed_ms, i.pressure_hpa
            FROM incoming i
            WHERE NOT EXISTS (
                SELECT 1
                FROM met_readings mr
                WHERE mr.station_id = i.station_id
                  AND mr.time = i.time
            )
        """, data)
    conn.commit()


def write_gauge(conn, station_id: int, rows: list[dict]):
    if not rows:
        return
    data = [(r["time"], station_id, r["water_level_m"], r["flow_rate_m3s"])
            for r in rows]
    with conn.cursor() as cur:
        execute_values(cur, """
            WITH incoming (time, station_id, water_level_m, flow_rate_m3s) AS (
                VALUES %s
            )
            INSERT INTO gauge_readings (time, station_id, water_level_m, flow_rate_m3s)
            SELECT
                i.time, i.station_id, i.water_level_m, i.flow_rate_m3s
            FROM incoming i
            WHERE NOT EXISTS (
                SELECT 1
                FROM gauge_readings gr
                WHERE gr.station_id = i.station_id
                  AND gr.time = i.time
            )
        """, data)
    conn.commit()


# ── Main run ──────────────────────────────────────────────────────────────────

def run_once():
    conn = psycopg2.connect(DB_DSN)

    met_stations   = load_met_stations(conn)
    gauge_stations = load_gauge_stations(conn)
    log.info("Fetching data for %d met stations and %d gauge stations",
             len(met_stations), len(gauge_stations))

    # Met stations — OpenMeteo hourly
    met_ok = 0
    for s in met_stations:
        rows = fetch_met(s, hours_back=MET_HISTORY_HOURS)
        write_met(conn, s["id"], rows)
        if rows:
            met_ok += 1
            log.info("  Met %-20s %2d rows", s["code"], len(rows))

    # Gauge stations — GloFAS discharge → water level
    gauge_ok = 0
    for s in gauge_stations:
        rows = fetch_river(s)
        write_gauge(conn, s["id"], rows)
        if rows:
            gauge_ok += 1
            log.info("  Gauge %-18s %2d rows  (bank=%.1fm)",
                     s["code"], len(rows), s["bank_full_m"])

    conn.close()
    log.info("Ingest complete — %d/%d met, %d/%d gauges updated",
             met_ok, len(met_stations), gauge_ok, len(gauge_stations))


def run_continuous(interval_seconds: int = 3600):
    log.info("Starting continuous ingest (interval=%ds)…", interval_seconds)
    while True:
        try:
            run_once()
        except Exception as exc:
            log.error("Ingest cycle error: %s", exc)
        time.sleep(interval_seconds)


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--once",     action="store_true", help="Run once and exit")
    p.add_argument("--interval", type=int, default=3600, help="Poll interval (seconds)")
    args = p.parse_args()
    if args.once:
        run_once()
    else:
        run_continuous(args.interval)
