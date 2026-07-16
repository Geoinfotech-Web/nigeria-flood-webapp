"""
Nigeria Flood Dashboard — FastAPI Backend
=========================================
10 REST endpoints + 2 WebSocket streams.

REST:
  GET  /health
  GET  /stations                      — list all gauge stations
  GET  /stations/{id}/readings        — recent gauge readings
  GET  /stations/{id}/features        — latest feature snapshot
  GET  /stations/{id}/predictions     — latest flood predictions (all horizons)
  GET  /stations/{id}/history         — hourly aggregated history
  GET  /alerts                        — recent alert log
  GET  /rainfall/daily                — 7-day daily rainfall per met station
  GET  /map/risk                      — GeoJSON FeatureCollection with risk tiers
  POST /auth/token                    — JWT login

WebSocket:
  WS   /ws/gauge-readings             — live gauge readings (every 5 min push)
  WS   /ws/predictions                — live prediction updates
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

import asyncpg
import httpx
import redis.asyncio as aioredis
from fastapi import (
    Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from prometheus_fastapi_instrumentator import Instrumentator

from routers import gauges, predictions, alerts, map_router, rainfall, auth, geocoding, flood_risk, exposure, boundaries

logging.basicConfig(level=logging.INFO, format="%(asctime)s [api] %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
DB_DSN = (
    f"postgresql://{os.getenv('DB_USER','flood')}:{os.getenv('DB_PASSWORD','floodpass')}"
    f"@{os.getenv('DB_HOST','timescaledb')}:{os.getenv('DB_PORT','5432')}"
    f"/{os.getenv('DB_NAME','flooddb')}"
)
REDIS_URL   = os.getenv("REDIS_URL", "redis://redis:6379/0")
BENTOML_URL = os.getenv("BENTOML_URL", "http://bentoml:3000")
JWT_SECRET  = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALG     = "HS256"
JWT_EXPIRE_MIN = 60 * 8  # 8 hours

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Nigeria Flood Prediction API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
Instrumentator().instrument(app).expose(app)

# ── DB + Redis pools ──────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    app.state.db    = await asyncpg.create_pool(DB_DSN, min_size=2, max_size=10)
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    app.state.http  = httpx.AsyncClient(base_url=BENTOML_URL, timeout=10.0)
    log.info("DB pool and Redis ready")


@app.on_event("shutdown")
async def shutdown():
    await app.state.db.close()
    await app.state.redis.aclose()
    await app.state.http.aclose()


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# ── Include routers ───────────────────────────────────────────────────────────
app.include_router(auth.router,        prefix="/auth",     tags=["auth"])
app.include_router(gauges.router,      prefix="/stations", tags=["gauges"])
app.include_router(predictions.router, prefix="/stations", tags=["predictions"])
app.include_router(alerts.router,      prefix="/alerts",   tags=["alerts"])
app.include_router(rainfall.router,    prefix="/rainfall", tags=["rainfall"])
app.include_router(map_router.router,  prefix="/map",      tags=["map"])
app.include_router(geocoding.router,   prefix="/geocode",  tags=["geocoding"])
app.include_router(flood_risk.router,  prefix="/flood-risk", tags=["flood-risk"])
app.include_router(exposure.router,    prefix="/exposure", tags=["exposure"])
app.include_router(boundaries.router,  prefix="/boundaries", tags=["boundaries"])


# ── WebSocket: live gauge readings ────────────────────────────────────────────
class _ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.active.remove(ws)


_gauge_manager       = _ConnectionManager()
_prediction_manager  = _ConnectionManager()


@app.websocket("/ws/gauge-readings")
async def ws_gauge_readings(websocket: WebSocket):
    await _gauge_manager.connect(websocket)
    try:
        while True:
            # Client can send "ping" keepalives
            await asyncio.wait_for(websocket.receive_text(), timeout=30)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        _gauge_manager.disconnect(websocket)


@app.websocket("/ws/predictions")
async def ws_predictions(websocket: WebSocket):
    await _prediction_manager.connect(websocket)
    try:
        while True:
            await asyncio.wait_for(websocket.receive_text(), timeout=30)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        _prediction_manager.disconnect(websocket)


# Background task: push fresh readings to WS clients every 30 s
@app.on_event("startup")
async def start_ws_broadcaster():
    asyncio.create_task(_broadcast_loop())


async def _broadcast_loop():
    await asyncio.sleep(10)  # wait for DB pool
    while True:
        try:
            async with app.state.db.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT DISTINCT ON (station_id)
                        gr.station_id, gs.code, gs.name,
                        gr.water_level_m, gr.flow_rate_m3s,
                        gr.time,
                        gs.bank_full_m,
                        ROUND((gr.water_level_m / gs.bank_full_m * 100)::numeric, 1) AS pct_bank
                    FROM gauge_readings gr
                    JOIN gauge_stations gs ON gs.id = gr.station_id
                    ORDER BY station_id, time DESC
                """)
            payload = [dict(r) for r in rows]
            # Serialise datetime
            for r in payload:
                r["time"] = r["time"].isoformat()
            await _gauge_manager.broadcast({"type": "gauge_update", "data": payload})
        except Exception as exc:
            log.warning("WS broadcast error: %s", exc)
        await asyncio.sleep(30)
