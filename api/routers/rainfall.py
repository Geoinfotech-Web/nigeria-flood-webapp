from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Request

router = APIRouter()


@router.get("/daily")
async def rainfall_daily(
    request: Request,
    days: int = Query(default=7, ge=1, le=30),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                date_trunc('day', mr.time) AS bucket,
                ms.code,
                ms.name,
                SUM(mr.rainfall_mm) AS total_rain_mm,
                MAX(mr.rainfall_mm) AS max_rain_mm
            FROM met_readings mr
            JOIN met_stations ms ON ms.id = mr.station_id
            WHERE mr.time >= $1
            GROUP BY 1, 2, 3
            ORDER BY bucket ASC, ms.code
        """, since)
    return [{"date": r["bucket"].isoformat(), **{k: r[k] for k in
             ("code","name","total_rain_mm","max_rain_mm")}} for r in rows]


@router.get("/by-state")
async def rainfall_by_state(
    request: Request,
    days: int = Query(default=1, ge=1, le=7),
):
    """
    Rank Nigerian states by rainfall using each gauge's nearest met station,
    then averaging total rain over the requested window by gauge.state.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH nearest_met AS (
                SELECT
                    gs.id AS gauge_id,
                    gs.state,
                    (
                        SELECT ms.id
                        FROM met_stations ms
                        ORDER BY ms.geom <-> gs.geom
                        LIMIT 1
                    ) AS met_id
                FROM gauge_stations gs
                WHERE gs.state IS NOT NULL
            ),
            met_totals AS (
                SELECT
                    mr.station_id AS met_id,
                    SUM(mr.rainfall_mm) AS total_rain_mm
                FROM met_readings mr
                WHERE mr.time >= $1
                GROUP BY mr.station_id
            )
            SELECT
                nm.state,
                AVG(COALESCE(mt.total_rain_mm, 0)) AS avg_rain_mm,
                MAX(COALESCE(mt.total_rain_mm, 0)) AS max_rain_mm,
                COUNT(*)::int AS gauge_count
            FROM nearest_met nm
            LEFT JOIN met_totals mt ON mt.met_id = nm.met_id
            GROUP BY nm.state
            ORDER BY avg_rain_mm DESC, nm.state
            """,
            since,
        )
    return [
        {
            "state": r["state"],
            "avg_rain_mm": round(float(r["avg_rain_mm"] or 0), 1),
            "max_rain_mm": round(float(r["max_rain_mm"] or 0), 1),
            "gauge_count": r["gauge_count"],
        }
        for r in rows
    ]
