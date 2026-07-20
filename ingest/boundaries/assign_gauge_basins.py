"""
Add gauge_stations.basin_id and populate from HydroBASINS GeoJSON.

Usage:
  # Host (DB on localhost:5432):
  python ingest/boundaries/assign_gauge_basins.py

  # Ingest container (mount ./api/data:/api_data):
  python boundaries/assign_gauge_basins.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = [
    Path(os.environ["BASINS_GEOJSON"]) if os.environ.get("BASINS_GEOJSON") else None,
    ROOT / "api" / "data" / "basins.geojson",
    Path("/api_data/basins.geojson"),
    Path("/app/data/basins.geojson"),
]

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)


def find_basins_path() -> Path:
    for p in CANDIDATES:
        if p is None:
            continue
        try:
            if p.exists():
                return p.resolve()
        except OSError:
            continue
    raise SystemExit(
        "basins.geojson not found. Run: python ingest/boundaries/fetch_hydrobasins.py"
    )


def main():
    basins_path = find_basins_path()
    print(f"Loading {basins_path} …")
    data = json.loads(basins_path.read_text(encoding="utf-8"))
    geoms = []
    basin_ids = []
    for f in data.get("features") or []:
        geom = f.get("geometry")
        props = f.get("properties") or {}
        bid = props.get("basin_id")
        if not geom or bid is None:
            continue
        g = shape(geom)
        if g.is_empty:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        geoms.append(g)
        basin_ids.append(int(bid))

    tree = STRtree(geoms)
    print(f"Indexed {len(geoms)} basins")

    conn = psycopg2.connect(DB_DSN)
    with conn.cursor() as cur:
        cur.execute(
            "ALTER TABLE gauge_stations ADD COLUMN IF NOT EXISTS basin_id BIGINT"
        )
        cur.execute("SELECT id, lat, lon FROM gauge_stations")
        gauges = cur.fetchall()

    assigned = 0
    for gid, lat, lon in gauges:
        pt = Point(float(lon), float(lat))
        idxs = list(tree.query(pt, predicate="contains"))
        if not idxs:
            idxs = list(tree.query(pt, predicate="intersects"))
        if not idxs:
            # Nearest centroid fallback for edge gauges
            best_i, best_d = None, 1e18
            for i, g in enumerate(geoms):
                d = pt.distance(g.centroid)
                if d < best_d:
                    best_d, best_i = d, i
            if best_i is None:
                continue
            bid = basin_ids[best_i]
        else:
            bid = basin_ids[int(idxs[0])]

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE gauge_stations SET basin_id = %s WHERE id = %s",
                (bid, gid),
            )
        assigned += 1

    conn.commit()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FILTER (WHERE basin_id IS NOT NULL), COUNT(*) FROM gauge_stations"
        )
        n_ok, n_all = cur.fetchone()
        cur.execute(
            "SELECT id, name, basin_id FROM gauge_stations ORDER BY name LIMIT 5"
        )
        sample = cur.fetchall()
    conn.close()
    print(f"Assigned basin_id on {assigned} gauges ({n_ok}/{n_all} non-null)")
    for row in sample:
        print(f"  {row[0]} {row[1]} → {row[2]}")


if __name__ == "__main__":
    main()
