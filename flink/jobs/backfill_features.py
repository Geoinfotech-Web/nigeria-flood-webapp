"""
Feature backfill — computes flood_features for every 30-min interval
in the historical gauge_readings data.

Uses inverse-distance-weighted rainfall (k=5, ≤250 km) per gauge.

Run once after backfill.py has populated gauge_readings / met_readings:
  python backfill_features.py

To refresh rain columns after switching to IDW (recompute all rows):
  python backfill_features.py --replace-rain
"""

import os
import sys
import logging
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

sys.path.insert(0, str(Path(__file__).resolve().parent))
from idw_rainfall import build_gauge_met_weights, weighted_rainfall_mm

logging.basicConfig(level=logging.INFO, format="%(asctime)s [feat-backfill] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)
STEP_MIN  = int(os.getenv("FEATURE_STEP_MIN", "60"))   # real GloFAS is daily; hourly is enough
BATCH     = 500


def fetch_stations(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, code, bank_full_m FROM gauge_stations")
        return cur.fetchall()


def get_time_range(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT MIN(time), MAX(time) FROM gauge_readings")
        return cur.fetchone()


def compute_feature_row(conn, station_id, bank_full, ts, weight_map):
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

        rain_3h = weighted_rainfall_mm(
            conn, station_id, ts - timedelta(hours=3), ts, weight_map,
        )
        rain_24h = weighted_rainfall_mm(
            conn, station_id, ts - timedelta(hours=24), ts, weight_map,
        )

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


def replace_rain_columns(conn, weight_map):
    """Recompute rolling_rain_* and soil_moisture_idx for existing feature rows."""
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT station_id FROM flood_features ORDER BY 1")
        station_ids = [r[0] for r in cur.fetchall()]

    for sid in station_ids:
        log.info("Refreshing IDW rain for station_id=%s …", sid)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT time FROM flood_features WHERE station_id=%s ORDER BY time",
                (sid,),
            )
            times = [r[0] for r in cur.fetchall()]

        updated = 0
        for ts in times:
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            rain_3h = weighted_rainfall_mm(
                conn, sid, ts - timedelta(hours=3), ts, weight_map,
            )
            rain_24h = weighted_rainfall_mm(
                conn, sid, ts - timedelta(hours=24), ts, weight_map,
            )
            soil = min(1.0, rain_24h / 80.0)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE flood_features
                    SET rolling_rain_3h_mm = %s,
                        rolling_rain_24h_mm = %s,
                        soil_moisture_idx = %s
                    WHERE station_id = %s AND time = %s
                    """,
                    (round(rain_3h, 2), round(rain_24h, 2), round(soil, 4), sid, ts),
                )
            updated += 1
            if updated % 500 == 0:
                conn.commit()
                log.info("  … %d rows", updated)
        conn.commit()
        log.info("  station_id=%s: %d rows updated", sid, updated)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--replace-rain",
        action="store_true",
        help="Only refresh rolling_rain_* / soil_moisture on existing flood_features rows",
    )
    args = parser.parse_args()

    conn = psycopg2.connect(DB_DSN)
    weight_map = build_gauge_met_weights(conn)
    log.info("IDW weights ready for %d gauges", len(weight_map))

    if args.replace_rain:
        replace_rain_columns(conn, weight_map)
        conn.close()
        log.info("IDW rain refresh complete.")
        return

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
            row = compute_feature_row(conn, sid, bank_full, ts, weight_map)
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
