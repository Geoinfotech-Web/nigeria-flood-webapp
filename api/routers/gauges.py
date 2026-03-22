"""Gauge station endpoints."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

router = APIRouter()


@router.get("")
async def list_stations(request: Request):
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, code, name, river, state, lat, lon, bank_full_m
            FROM gauge_stations ORDER BY id
        """)
    return [dict(r) for r in rows]


@router.get("/{station_id}/readings")
async def get_readings(
    station_id: int,
    request: Request,
    hours: int = Query(default=24, ge=1, le=168),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT time, water_level_m, flow_rate_m3s
            FROM gauge_readings
            WHERE station_id = $1 AND time >= $2
            ORDER BY time ASC
        """, station_id, since)
    if not rows:
        raise HTTPException(status_code=404, detail="No readings found")
    return [{"time": r["time"].isoformat(), **{k: r[k] for k in ("water_level_m","flow_rate_m3s")}}
            for r in rows]


@router.get("/{station_id}/features")
async def get_features(station_id: int, request: Request):
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM flood_features
            WHERE station_id = $1
            ORDER BY time DESC LIMIT 1
        """, station_id)
    if not row:
        raise HTTPException(status_code=404, detail="No features yet")
    r = dict(row)
    r["time"] = r["time"].isoformat()
    return r


@router.get("/{station_id}/history")
async def get_history(
    station_id: int,
    request: Request,
    days: int = Query(default=7, ge=1, le=30),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT bucket, avg_level_m, max_level_m, avg_flow_m3s
            FROM gauge_hourly
            WHERE station_id = $1 AND bucket >= $2
            ORDER BY bucket ASC
        """, station_id, since)
    return [{"time": r["bucket"].isoformat(), **{k: r[k] for k in
             ("avg_level_m","max_level_m","avg_flow_m3s")}} for r in rows]
