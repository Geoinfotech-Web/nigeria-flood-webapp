"""
Flink Feature Engineering Job — Python (PyFlink)
=================================================
Polls TimescaleDB every 30 s via JDBC, computes rolling features
for each gauge station, and writes results to flood_features.

Features computed:
  - level_change_1h     : water level delta over last 1 h
  - level_change_3h     : water level delta over last 3 h
  - rolling_rain_3h_mm  : total rainfall in catchment over 3 h
  - rolling_rain_24h_mm : total rainfall in catchment over 24 h
  - soil_moisture_idx   : proxy = rolling_rain_24h / max_possible (capped 0-1)
  - days_since_last_peak: days since last local maximum > 0.85 * bank_full
  - level_pct_bank      : water_level / bank_full

Run:  docker exec flood_flink_jobmanager \
        /opt/flink/bin/flink run --python /opt/flink/jobs/flood_features.py

NOTE: For local dev this also runs as a standalone Python script
      (no Flink cluster needed) using the --standalone flag:
        python flood_features.py --standalone
"""

import os
import sys
import time
import logging
import argparse
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [flink-feat] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','timescaledb')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)
POLL_INTERVAL = int(os.getenv("FLINK_POLL_SECONDS", 30))


def get_conn():
    return psycopg2.connect(DB_DSN)


def fetch_stations(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, code, bank_full_m FROM gauge_stations")
        return cur.fetchall()


def compute_features(conn, station_id: int, bank_full: float, now: datetime) -> dict | None:
    """
    Pull recent gauge + met data and compute features for this station.
    Returns None if insufficient data.
    """
    with conn.cursor() as cur:
        # Latest gauge reading
        cur.execute("""
            SELECT water_level_m, flow_rate_m3s, time
            FROM gauge_readings
            WHERE station_id = %s
            ORDER BY time DESC LIMIT 1
        """, (station_id,))
        latest = cur.fetchone()
        if not latest:
            return None
        level, flow, ts_latest = latest

        # Level 1h ago
        cur.execute("""
            SELECT water_level_m FROM gauge_readings
            WHERE station_id = %s AND time <= %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, ts_latest - timedelta(hours=1)))
        row_1h = cur.fetchone()
        level_1h_ago = row_1h[0] if row_1h else level

        # Level 3h ago
        cur.execute("""
            SELECT water_level_m FROM gauge_readings
            WHERE station_id = %s AND time <= %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, ts_latest - timedelta(hours=3)))
        row_3h = cur.fetchone()
        level_3h_ago = row_3h[0] if row_3h else level

        # Nearby rainfall (nearest met stations — use all for simplicity)
        cur.execute("""
            SELECT COALESCE(SUM(rainfall_mm), 0)
            FROM met_readings
            WHERE time >= %s AND time <= %s
        """, (ts_latest - timedelta(hours=3), ts_latest))
        rain_3h = cur.fetchone()[0]

        cur.execute("""
            SELECT COALESCE(SUM(rainfall_mm), 0)
            FROM met_readings
            WHERE time >= %s AND time <= %s
        """, (ts_latest - timedelta(hours=24), ts_latest))
        rain_24h = cur.fetchone()[0]

        # Days since last peak (water_level > 0.85 * bank_full)
        cur.execute("""
            SELECT time FROM gauge_readings
            WHERE station_id = %s AND water_level_m > %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, 0.85 * bank_full))
        last_peak = cur.fetchone()
        if last_peak:
            days_since = (now - last_peak[0].replace(tzinfo=timezone.utc)).total_seconds() / 86400
        else:
            days_since = 999.0

    soil_moisture = min(1.0, rain_24h / 80.0)  # 80 mm/day ≈ saturation proxy
    level_pct = level / bank_full if bank_full > 0 else 0.0

    return {
        "time": ts_latest,
        "station_id": station_id,
        "water_level_m": round(level, 3),
        "flow_rate_m3s": round(flow, 2),
        "level_change_1h": round(level - level_1h_ago, 4),
        "level_change_3h": round(level - level_3h_ago, 4),
        "rolling_rain_3h_mm": round(float(rain_3h), 2),
        "rolling_rain_24h_mm": round(float(rain_24h), 2),
        "soil_moisture_idx": round(soil_moisture, 4),
        "days_since_last_peak": round(days_since, 2),
        "level_pct_bank": round(level_pct, 4),
    }


def upsert_features(conn, features: list[dict]):
    cols = [
        "time", "station_id", "water_level_m", "flow_rate_m3s",
        "level_change_1h", "level_change_3h",
        "rolling_rain_3h_mm", "rolling_rain_24h_mm",
        "soil_moisture_idx", "days_since_last_peak", "level_pct_bank",
    ]
    rows = [tuple(f[c] for c in cols) for f in features]
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""
            INSERT INTO flood_features ({','.join(cols)})
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            rows,
        )
    conn.commit()


def run_standalone():
    """Standalone polling loop — used in local dev without a Flink cluster."""
    log.info("Standalone mode — polling every %ds", POLL_INTERVAL)
    conn = get_conn()
    stations = fetch_stations(conn)
    log.info("Stations: %s", [s[1] for s in stations])

    while True:
        now = datetime.now(timezone.utc)
        features = []
        for sid, code, bank_full in stations:
            try:
                f = compute_features(conn, sid, bank_full, now)
                if f:
                    features.append(f)
                    log.debug("  %s → level=%.2fm (%.0f%% bank)  Δ1h=%.3f",
                              code, f["water_level_m"], f["level_pct_bank"]*100,
                              f["level_change_1h"])
            except Exception as exc:
                log.warning("Feature compute error for %s: %s", code, exc)

        if features:
            try:
                upsert_features(conn, features)
                log.info("Wrote %d feature rows", len(features))
            except Exception as exc:
                log.error("Upsert error: %s — reconnecting", exc)
                conn = get_conn()

        time.sleep(POLL_INTERVAL)


def run_flink():
    """PyFlink entry point (called when submitted to Flink cluster)."""
    try:
        from pyflink.datastream import StreamExecutionEnvironment
        from pyflink.common import WatermarkStrategy
    except ImportError:
        log.error("PyFlink not available — falling back to standalone mode")
        run_standalone()
        return

    env = StreamExecutionEnvironment.get_execution_environment()
    env.set_parallelism(1)
    log.info("PyFlink environment ready — running feature job")
    # For simplicity the PyFlink job delegates to the same polling logic.
    # A production version would use Flink JDBC source + window operators.
    run_standalone()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--standalone", action="store_true",
                        help="Run polling loop without Flink cluster")
    args = parser.parse_args()

    if args.standalone:
        run_standalone()
    else:
        run_flink()
