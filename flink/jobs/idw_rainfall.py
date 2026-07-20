"""
Inverse-distance-weighted (IDW) rainfall for gauge catchments.

Weights: w_i = 1 / (d_km^2 + 0.1), keep k=5 nearest mets within 250 km,
then renormalize so weights sum to 1.
"""

from __future__ import annotations

import math
from functools import lru_cache

# IDW parameters (see Handoff / plan)
IDW_POWER = 2
IDW_EPS = 0.1  # km^2 floor to avoid div-by-zero
IDW_K = 5
IDW_MAX_KM = 250.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def idw_weight(distance_km: float) -> float:
    return 1.0 / (distance_km ** IDW_POWER + IDW_EPS)


def build_gauge_met_weights(conn) -> dict[int, list[tuple[int, float]]]:
    """
    Returns {gauge_id: [(met_id, weight), ...]} with weights summing to 1.
    Computed once per job process; 26×29 is trivial.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT id, lat, lon FROM gauge_stations")
        gauges = cur.fetchall()
        cur.execute("SELECT id, lat, lon FROM met_stations")
        mets = cur.fetchall()

    weights: dict[int, list[tuple[int, float]]] = {}
    for gid, glat, glon in gauges:
        scored = []
        for mid, mlat, mlon in mets:
            d = haversine_km(float(glat), float(glon), float(mlat), float(mlon))
            if d > IDW_MAX_KM:
                continue
            scored.append((mid, d, idw_weight(d)))
        scored.sort(key=lambda x: x[1])
        top = scored[:IDW_K]
        if not top:
            # Fallback: nearest met regardless of radius
            all_scored = [
                (mid, haversine_km(float(glat), float(glon), float(mlat), float(mlon)))
                for mid, mlat, mlon in mets
            ]
            all_scored.sort(key=lambda x: x[1])
            if all_scored:
                mid, d = all_scored[0]
                weights[gid] = [(mid, 1.0)]
            else:
                weights[gid] = []
            continue
        raw = [w for _, _, w in top]
        total = sum(raw) or 1.0
        weights[gid] = [(mid, w / total) for mid, _, w in top]
    return weights


def weighted_rainfall_mm(conn, gauge_id: int, t_start, t_end, weight_map: dict) -> float:
    """IDW of per-met rainfall totals over [t_start, t_end]."""
    pairs = weight_map.get(gauge_id) or []
    if not pairs:
        return 0.0

    met_ids = [mid for mid, _ in pairs]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT station_id, COALESCE(SUM(rainfall_mm), 0)
            FROM met_readings
            WHERE station_id = ANY(%s)
              AND time >= %s AND time <= %s
            GROUP BY station_id
            """,
            (met_ids, t_start, t_end),
        )
        totals = {row[0]: float(row[1]) for row in cur.fetchall()}

    return sum(totals.get(mid, 0.0) * w for mid, w in pairs)
