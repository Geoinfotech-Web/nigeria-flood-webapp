"""
Historical backfill — generates 90 days of synthetic data so the ML model
has enough history to train on immediately after first docker-compose up.

Run once:  docker-compose run --rm ingest python backfill.py
"""

import os
import math
import random
import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [backfill] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)

DAYS_BACK = int(os.getenv("BACKFILL_DAYS", 90))
GAUGE_STEP_MIN = 5
MET_STEP_MIN = 15

GAUGE_PARAMS = {
    "BENUE_LOK":  dict(k=45.0, baseline=6.5, noise=0.08, flood_prob=0.004),
    "NIGER_OHO":  dict(k=38.0, baseline=5.2, noise=0.07, flood_prob=0.003),
    "ANAMBRA_OS": dict(k=32.0, baseline=4.8, noise=0.06, flood_prob=0.003),
    "KADUNA_ZAR": dict(k=18.0, baseline=2.1, noise=0.05, flood_prob=0.005),
    "SOKOTO_BIR": dict(k=22.0, baseline=3.0, noise=0.05, flood_prob=0.004),
}
DEFAULT_GAUGE = dict(k=30.0, baseline=4.0, noise=0.06, flood_prob=0.003)
MET_PARAMS = {
    "MET_ABUJA":  dict(temp_mean=28, temp_amp=4, rain_scale=18, lat=9.08),
    "MET_IBADAN": dict(temp_mean=27, temp_amp=3, rain_scale=22, lat=7.38),
    "MET_KANO":   dict(temp_mean=31, temp_amp=6, rain_scale=12, lat=12.05),
    "MET_PHC":    dict(temp_mean=26, temp_amp=2, rain_scale=28, lat=4.82),
}
DEFAULT_MET = dict(temp_mean=28, temp_amp=4, rain_scale=18, lat=9.0)

BATCH = 2000


def seasonal(ts, lat=9.0):
    doy = ts.timetuple().tm_yday
    peak = 220 if lat > 8 else 180
    return max(0.0, math.exp(-0.5 * ((doy - peak) / 130) ** 2))


def gen_gauge_rows(station_id, code, bank_full, start, end):
    p = GAUGE_PARAMS.get(code, DEFAULT_GAUGE)
    # Scale synthetic baseline to each station's bankfull so expanded gauges look plausible
    if code not in GAUGE_PARAMS and bank_full:
        p = {
            **DEFAULT_GAUGE,
            "baseline": max(1.0, float(bank_full) * 0.45),
            "k": max(12.0, float(bank_full) * 3.0),
        }
    ts = start
    flood_rem = 0
    flood_mag = 0.0
    rows = []
    while ts < end:
        sf = seasonal(ts)
        base = p["baseline"] * (0.6 + 0.8 * sf)
        if flood_rem <= 0 and random.random() < p["flood_prob"]:
            flood_rem = random.randint(12, 96)
            flood_mag = random.uniform(0.3, 0.9) * bank_full
        if flood_rem > 0:
            base += flood_mag * math.exp(-0.05 * flood_rem)
            flood_rem -= 1
        level = max(0.1, base + random.gauss(0, p["noise"]))
        flow = max(0, p["k"] * (level ** 1.67) + random.gauss(0, p["k"] * 0.02))
        rows.append((ts, station_id, round(level, 3), round(flow, 2)))
        ts += timedelta(minutes=GAUGE_STEP_MIN)
    return rows


def gen_met_rows(station_id, code, start, end):
    p = MET_PARAMS.get(code, DEFAULT_MET)
    ts = start
    rain_rem = 0
    rain_int = 0.0
    rows = []
    while ts < end:
        sf = seasonal(ts, p["lat"])
        hour = ts.hour
        temp = (p["temp_mean"] + p["temp_amp"] * math.sin(2 * math.pi * (hour - 6) / 24)
                - 3 * sf + random.gauss(0, 0.5))
        if rain_rem <= 0 and random.random() < (0.08 * sf + 0.01):
            rain_rem = random.randint(4, 24)
            rain_int = random.expovariate(1.0 / (p["rain_scale"] * sf + 1))
        if rain_rem > 0:
            rain = rain_int * random.uniform(0.4, 1.2)
            rain_rem -= 1
        else:
            rain = 0.0
        humidity = min(100, max(30, 60 + 30 * sf + (20 if rain > 0 else 0) + random.gauss(0, 3)))
        wind = max(0, random.weibullvariate(4.0, 1.8))
        pressure = round(1013 - 5 * sf + random.gauss(0, 0.8), 1)
        rows.append((ts, station_id, round(rain, 2), round(temp, 1),
                     round(humidity, 1), round(wind, 2), pressure))
        ts += timedelta(minutes=MET_STEP_MIN)
    return rows


def bulk_insert(conn, table, cols, rows):
    total = 0
    with conn.cursor() as cur:
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i+BATCH]
            placeholders = "(" + ",".join(["%s"] * len(cols)) + ")"
            sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES %s ON CONFLICT DO NOTHING"
            execute_values(cur, sql, chunk)
            total += len(chunk)
    conn.commit()
    return total


def main():
    conn = psycopg2.connect(DB_DSN)
    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = end - timedelta(days=DAYS_BACK)
    log.info("Backfilling %d days: %s → %s", DAYS_BACK, start.date(), end.date())

    with conn.cursor() as cur:
        cur.execute("SELECT id, code, bank_full_m FROM gauge_stations")
        gauge_stations = cur.fetchall()
        cur.execute("SELECT id, code FROM met_stations")
        met_stations = cur.fetchall()

    for sid, code, bank_full in gauge_stations:
        log.info("Generating gauge: %s", code)
        rows = gen_gauge_rows(sid, code, bank_full, start, end)
        n = bulk_insert(conn, "gauge_readings",
                        ["time","station_id","water_level_m","flow_rate_m3s"], rows)
        log.info("  → %d gauge readings", n)

    for sid, code in met_stations:
        log.info("Generating met: %s", code)
        rows = gen_met_rows(sid, code, start, end)
        n = bulk_insert(conn, "met_readings",
                        ["time","station_id","rainfall_mm","temperature_c",
                         "humidity_pct","wind_speed_ms","pressure_hpa"], rows)
        log.info("  → %d met readings", n)

    log.info("Backfill complete.")
    conn.close()


if __name__ == "__main__":
    main()
