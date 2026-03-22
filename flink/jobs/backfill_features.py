"""
Feature backfill — computes flood_features for every 30-min interval
in the historical gauge_readings data.

Run once after backfill.py has populated gauge_readings / met_readings:
  python backfill_features.py
"""

import os
import logging
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO, format="%(asctime)s [feat-backfill] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)
STEP_MIN  = 30   # compute a feature row every 30 minutes
BATCH     = 500


def fetch_stations(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, code, bank_full_m FROM gauge_stations")
        return cur.fetchall()


def get_time_range(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT MIN(time), MAX(time) FROM gauge_readings")
        return cur.fetchone()


def compute_feature_row(conn, station_id, bank_full, ts):
    with conn.cursor() as cur:
        # Latest reading at or before ts
        cur.execute("""
            SELECT water_level_m, flow_rate_m3s FROM gauge_readings
            WHERE station_id=%s AND time <= %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, ts))
        row = cur.fetchone()
        if not row or row[0] is None:
            return None
        level, flow = row

        cur.execute("""
            SELECT water_level_m FROM gauge_readings
            WHERE station_id=%s AND time <= %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, ts - timedelta(hours=1)))
        r = cur.fetchone()
        level_1h = r[0] if r else level

        cur.execute("""
            SELECT water_level_m FROM gauge_readings
            WHERE station_id=%s AND time <= %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, ts - timedelta(hours=3)))
        r = cur.fetchone()
        level_3h = r[0] if r else level

        cur.execute("""
            SELECT COALESCE(SUM(rainfall_mm),0) FROM met_readings
            WHERE time >= %s AND time <= %s
        """, (ts - timedelta(hours=3), ts))
        rain_3h = float(cur.fetchone()[0])

        cur.execute("""
            SELECT COALESCE(SUM(rainfall_mm),0) FROM met_readings
            WHERE time >= %s AND time <= %s
        """, (ts - timedelta(hours=24), ts))
        rain_24h = float(cur.fetchone()[0])

        cur.execute("""
            SELECT time FROM gauge_readings
            WHERE station_id=%s AND water_level_m > %s AND time <= %s
            ORDER BY time DESC LIMIT 1
        """, (station_id, 0.85 * bank_full, ts))
        pk = cur.fetchone()
        days_since = ((ts - pk[0].replace(tzinfo=timezone.utc)).total_seconds() / 86400
                      if pk else 999.0)

    return (
        ts, station_id,
        round(level, 3), round(flow, 2),
        round(level - level_1h, 4),
        round(level - level_3h, 4),
        round(rain_3h, 2), round(rain_24h, 2),
        round(min(1.0, rain_24h / 80.0), 4),
        round(days_since, 2),
        round(level / bank_full if bank_full else 0, 4),
    )


COLS = [
    "time","station_id","water_level_m","flow_rate_m3s",
    "level_change_1h","level_change_3h",
    "rolling_rain_3h_mm","rolling_rain_24h_mm",
    "soil_moisture_idx","days_since_last_peak","level_pct_bank",
]


def main():
    conn = psycopg2.connect(DB_DSN)
    stations = fetch_stations(conn)
    t_min, t_max = get_time_range(conn)
    if not t_min:
        log.error("No gauge readings found. Run ingest/backfill.py first.")
        return

    t_min = t_min.replace(tzinfo=timezone.utc) + timedelta(hours=24)  # need 24h lookback
    t_max = t_max.replace(tzinfo=timezone.utc)
    log.info("Backfilling features from %s to %s (%d stations)",
             t_min.date(), t_max.date(), len(stations))

    for sid, code, bank_full in stations:
        log.info("Processing station %s …", code)
        ts = t_min
        batch = []
        total = 0
        while ts <= t_max:
            row = compute_feature_row(conn, sid, bank_full, ts)
            if row:
                batch.append(row)
            if len(batch) >= BATCH:
                with conn.cursor() as cur:
                    execute_values(cur,
                        f"INSERT INTO flood_features ({','.join(COLS)}) VALUES %s "
                        f"ON CONFLICT DO NOTHING", batch)
                conn.commit()
                total += len(batch)
                log.info("  %s: %d rows written …", code, total)
                batch = []
            ts += timedelta(minutes=STEP_MIN)

        if batch:
            with conn.cursor() as cur:
                execute_values(cur,
                    f"INSERT INTO flood_features ({','.join(COLS)}) VALUES %s "
                    f"ON CONFLICT DO NOTHING", batch)
            conn.commit()
            total += len(batch)

        log.info("  %s: %d total rows", code, total)

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM flood_features")
        log.info("Total flood_features rows: %d", cur.fetchone()[0])
    conn.close()
    log.info("Feature backfill complete.")


if __name__ == "__main__":
    main()
