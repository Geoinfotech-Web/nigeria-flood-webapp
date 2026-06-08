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
