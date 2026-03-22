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
            SELECT rd.bucket, ms.code, ms.name, rd.total_rain_mm, rd.max_rain_mm
            FROM rainfall_daily rd
            JOIN met_stations ms ON ms.id = rd.station_id
            WHERE rd.bucket >= $1
            ORDER BY rd.bucket ASC, ms.code
        """, since)
    return [{"date": r["bucket"].isoformat(), **{k: r[k] for k in
             ("code","name","total_rain_mm","max_rain_mm")}} for r in rows]
