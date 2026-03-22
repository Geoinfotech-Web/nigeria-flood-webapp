"""
Meteorological station simulator.

Generates rainfall, temperature, humidity, wind, and pressure for
4 NIMET-style stations every MET_INTERVAL_SECONDS (default 900 = 15 min).

Rainfall model:
  - Wet season (Apr–Oct) has higher base probability and intensity.
  - Convective cells: once rain starts, it lasts 1-6 h with exponential decay.
  - Dry season: sparse events, low intensity.
"""

import os
import math
import random
import logging
import time as _time
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [met] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)
INTERVAL = int(os.getenv("MET_INTERVAL_SECONDS", 900))

# ── Station-specific climate parameters ──────────────────────────────────────
STATION_PARAMS = {
    "MET_ABUJA":  dict(temp_mean=28, temp_amp=4, rain_scale=18, lat=9.08),
    "MET_IBADAN": dict(temp_mean=27, temp_amp=3, rain_scale=22, lat=7.38),
    "MET_KANO":   dict(temp_mean=31, temp_amp=6, rain_scale=12, lat=12.05),
    "MET_PHC":    dict(temp_mean=26, temp_amp=2, rain_scale=28, lat=4.82),
}

_rain_state: dict[str, dict] = {}


def seasonal_factor(ts: datetime, lat: float) -> float:
    """Wet season fraction 0→1; equatorial stations have broader peak."""
    doy = ts.timetuple().tm_yday
    peak_doy = 220 if lat > 8 else 180
    width = 130 if lat > 8 else 160
    return max(0.0, math.exp(-0.5 * ((doy - peak_doy) / width) ** 2))


def init_rain_state(stations: list[dict]):
    for s in stations:
        _rain_state[s["code"]] = {"active": False, "remaining": 0, "intensity": 0.0}


def next_rainfall(code: str, ts: datetime, lat: float, scale: float) -> float:
    rs = _rain_state[code]
    sf = seasonal_factor(ts, lat)

    if not rs["active"]:
        prob = 0.08 * sf + 0.01  # 1-9% chance per 15-min step
        if random.random() < prob:
            rs["active"] = True
            rs["remaining"] = random.randint(4, 24)  # 15-min steps
            rs["intensity"] = random.expovariate(1.0 / (scale * sf + 1))
    if rs["active"]:
        rain = rs["intensity"] * random.uniform(0.4, 1.2)
        rs["remaining"] -= 1
        if rs["remaining"] <= 0:
            rs["active"] = False
        return round(max(0.0, rain), 2)
    return 0.0


def next_met(code: str, ts: datetime) -> dict:
    p = STATION_PARAMS[code]
    sf = seasonal_factor(ts, p["lat"])
    hour = ts.hour

    # Diurnal temperature cycle
    temp = (p["temp_mean"] + p["temp_amp"] * math.sin(2 * math.pi * (hour - 6) / 24)
            - 3 * sf  # cooler in wet season
            + random.gauss(0, 0.5))

    rain = next_rainfall(code, ts, p["lat"], p["rain_scale"])

    # Humidity inversely related to temp, higher when raining
    humidity = min(100, max(30, 60 + 30 * sf + (20 if rain > 0 else 0) + random.gauss(0, 3)))

    wind = max(0, random.weibullvariate(4.0, 1.8) + (2 if rain > 2 else 0))
    pressure = round(1013 - 5 * sf + random.gauss(0, 0.8), 1)

    return dict(
        rainfall_mm=rain,
        temperature_c=round(temp, 1),
        humidity_pct=round(humidity, 1),
        wind_speed_ms=round(wind, 2),
        pressure_hpa=pressure,
    )


def insert_readings(conn, rows: list[tuple]):
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO met_readings
              (time, station_id, rainfall_mm, temperature_c,
               humidity_pct, wind_speed_ms, pressure_hpa)
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            rows,
        )
    conn.commit()


def fetch_stations(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, code FROM met_stations ORDER BY id")
        return [{"id": r[0], "code": r[1]} for r in cur.fetchall()]


def run():
    log.info("Connecting to database…")
    conn = psycopg2.connect(DB_DSN)
    stations = fetch_stations(conn)
    log.info("Found %d met stations", len(stations))
    init_rain_state(stations)

    log.info("Starting met simulation (interval=%ds)…", INTERVAL)
    while True:
        ts = datetime.now(timezone.utc)
        rows = []
        for s in stations:
            m = next_met(s["code"], ts)
            rows.append((
                ts, s["id"],
                m["rainfall_mm"], m["temperature_c"],
                m["humidity_pct"], m["wind_speed_ms"], m["pressure_hpa"],
            ))
            log.debug("  %s → rain=%.2f mm  temp=%.1f°C", s["code"], m["rainfall_mm"], m["temperature_c"])

        try:
            insert_readings(conn, rows)
            log.info("Inserted %d met readings at %s", len(rows), ts.isoformat())
        except Exception as exc:
            log.error("Insert failed: %s — reconnecting", exc)
            conn = psycopg2.connect(DB_DSN)

        _time.sleep(INTERVAL)


if __name__ == "__main__":
    run()
