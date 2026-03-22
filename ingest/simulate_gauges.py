"""
Gauge station simulator.

Generates realistic water-level and flow-rate readings for 5 Nigerian
river gauge stations every GAUGE_INTERVAL_SECONDS (default 300 = 5 min).

Simulation model:
  - Baseline level drawn from a seasonal sinusoid (wet season Apr-Oct).
  - Occasional flood events (random walk spike lasting 6-48 h).
  - Gaussian noise on every reading.
  - Flow rate derived from Manning-style power law: Q = k * h^1.67
"""

import os
import math
import random
import logging
import time as _time
from datetime import datetime, timezone

import numpy as np
import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [gauge] %(message)s")
log = logging.getLogger(__name__)

# ── DB config ────────────────────────────────────────────────────────────────
DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)
INTERVAL = int(os.getenv("GAUGE_INTERVAL_SECONDS", 300))

# ── Station-specific parameters ──────────────────────────────────────────────
# Keyed by station code.  bank_full fetched from DB at startup.
STATION_PARAMS = {
    "BENUE_LOK": dict(k=45.0, baseline=6.5, noise=0.08, flood_prob=0.003),
    "NIGER_OHO": dict(k=38.0, baseline=5.2, noise=0.07, flood_prob=0.002),
    "ANAMBRA_OS": dict(k=32.0, baseline=4.8, noise=0.06, flood_prob=0.002),
    "KADUNA_ZAR": dict(k=18.0, baseline=2.1, noise=0.05, flood_prob=0.004),
    "SOKOTO_BIR": dict(k=22.0, baseline=3.0, noise=0.05, flood_prob=0.003),
}

# ── Persistent state per station ─────────────────────────────────────────────
_state: dict[str, dict] = {}


def seasonal_factor(ts: datetime) -> float:
    """0.0 (dry) → 1.0 (peak wet), sinusoid peaking ~Aug (doy≈220)."""
    doy = ts.timetuple().tm_yday
    return 0.5 + 0.5 * math.sin(2 * math.pi * (doy - 80) / 365)


def init_state(stations: list[dict]):
    for s in stations:
        _state[s["code"]] = {
            "flood_active": False,
            "flood_remaining": 0,
            "flood_magnitude": 0.0,
            "level": STATION_PARAMS[s["code"]]["baseline"],
        }


def next_reading(code: str, ts: datetime, bank_full: float) -> tuple[float, float]:
    p = STATION_PARAMS[code]
    st = _state[code]
    sf = seasonal_factor(ts)

    # base level: seasonal + noise
    base = p["baseline"] * (0.6 + 0.8 * sf)

    # flood event logic
    if not st["flood_active"]:
        if random.random() < p["flood_prob"]:
            st["flood_active"] = True
            st["flood_remaining"] = random.randint(12, 96)  # steps
            st["flood_magnitude"] = random.uniform(0.3, 0.9) * bank_full
    if st["flood_active"]:
        base += st["flood_magnitude"] * math.exp(-0.05 * (96 - st["flood_remaining"]))
        st["flood_remaining"] -= 1
        if st["flood_remaining"] <= 0:
            st["flood_active"] = False

    level = max(0.1, base + random.gauss(0, p["noise"]))
    flow = p["k"] * (level ** 1.67) + random.gauss(0, p["k"] * 0.02)
    flow = max(0.0, flow)
    return round(level, 3), round(flow, 2)


def insert_readings(conn, rows: list[tuple]):
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO gauge_readings (time, station_id, water_level_m, flow_rate_m3s)
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            rows,
        )
    conn.commit()


def fetch_stations(conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT id, code, bank_full_m FROM gauge_stations ORDER BY id")
        return [{"id": r[0], "code": r[1], "bank_full": r[2]} for r in cur.fetchall()]


def run():
    log.info("Connecting to database…")
    conn = psycopg2.connect(DB_DSN)
    stations = fetch_stations(conn)
    log.info("Found %d gauge stations", len(stations))
    init_state(stations)

    log.info("Starting gauge simulation (interval=%ds)…", INTERVAL)
    while True:
        ts = datetime.now(timezone.utc)
        rows = []
        for s in stations:
            level, flow = next_reading(s["code"], ts, s["bank_full"])
            rows.append((ts, s["id"], level, flow))
            log.debug("  %s → level=%.3fm  flow=%.1f m³/s", s["code"], level, flow)

        try:
            insert_readings(conn, rows)
            log.info("Inserted %d gauge readings at %s", len(rows), ts.isoformat())
        except Exception as exc:
            log.error("Insert failed: %s — reconnecting", exc)
            conn = psycopg2.connect(DB_DSN)

        _time.sleep(INTERVAL)


if __name__ == "__main__":
    run()
