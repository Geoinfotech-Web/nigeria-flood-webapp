from fastapi import APIRouter, Query, Request

router = APIRouter()


@router.get("")
async def get_alerts(
    request: Request,
    limit: int = Query(default=50, le=200),
    status: str = Query(default=None),
):
    query = """
        SELECT al.id, al.created_at, gs.code AS station_code,
               gs.name AS station_name, al.risk_tier,
               al.flood_prob, al.channel, al.status
        FROM alert_log al
        JOIN gauge_stations gs ON gs.id = al.station_id
    """
    params = []
    if status:
        query += " WHERE al.status = $1"
        params.append(status)
    query += f" ORDER BY al.created_at DESC LIMIT {limit}"

    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(query, *params)

    return [{**dict(r), "created_at": r["created_at"].isoformat()} for r in rows]
