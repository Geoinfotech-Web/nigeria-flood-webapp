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
  GET  /rainfall/by-state             — state rainfall ranking via nearest met to gauges
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
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from passlib.context import CryptContext
from prometheus_fastapi_instrumentator import Instrumentator

from routers import gauges, predictions, alerts, map_router, rainfall, auth, geocoding, flood_risk, exposure, boundaries, incidents, news, routing

logging.basicConfig(level=logging.INFO, format="%(asctime)s [api] %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
DB_USER = os.getenv("DB_USER", "flood")
DB_PASSWORD = os.getenv("DB_PASSWORD", "floodpass")
DB_NAME = os.getenv("DB_NAME", "flooddb")
DB_HOST = os.getenv("DB_HOST", "timescaledb")
DB_PORT = os.getenv("DB_PORT", "5432")
# Cloud Run + Cloud SQL Auth Connector uses unix socket:
# INSTANCE_CONNECTION_NAME=project:region:instance
INSTANCE_CONNECTION_NAME = (
    os.getenv("INSTANCE_CONNECTION_NAME")
    or os.getenv("CLOUD_SQL_CONNECTION_NAME")
    or ""
).strip()

if INSTANCE_CONNECTION_NAME:
    DB_DSN = (
        f"postgresql://{DB_USER}:{DB_PASSWORD}@/{DB_NAME}"
        f"?host=/cloudsql/{INSTANCE_CONNECTION_NAME}"
    )
elif DB_HOST.startswith("/cloudsql/"):
    DB_DSN = f"postgresql://{DB_USER}:{DB_PASSWORD}@/{DB_NAME}?host={DB_HOST}"
else:
    DB_DSN = (
        f"postgresql://{DB_USER}:{DB_PASSWORD}"
        f"@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

REDIS_URL = os.getenv("REDIS_URL", "").strip()
BENTOML_URL = os.getenv("BENTOML_URL", "http://bentoml:3000")
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALG = "HS256"
JWT_EXPIRE_MIN = 60 * 8  # 8 hours

# Comma-separated origins. Use "*" only for local/dev.
_CORS_RAW = os.getenv("CORS_ORIGINS", "https://gfw.ggis.africa").strip()
CORS_ORIGINS = (
    ["*"]
    if _CORS_RAW == "*"
    else [o.strip() for o in _CORS_RAW.split(",") if o.strip()]
)


class _NullRedis:
    """No-op async Redis stand-in when REDIS_URL is unset (e.g. first Cloud Run launch)."""

    async def get(self, key):
        return None

    async def set(self, key, value, ex=None, **kwargs):
        return True

    async def setex(self, key, time, value):
        return True

    async def aclose(self):
        return None


def _redis_enabled() -> bool:
    if not REDIS_URL:
        return False
    return REDIS_URL.lower() not in {"none", "disabled", "false", "off"}


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Nigeria Flood Prediction API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)
os.makedirs("/app/uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
Instrumentator().instrument(app).expose(app)

# ── DB + Redis pools ──────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    app.state.db = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=10)
    if _redis_enabled():
        app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        app.state.redis_enabled = True
        log.info("Redis connected: %s", REDIS_URL.split("@")[-1])
    else:
        app.state.redis = _NullRedis()
        app.state.redis_enabled = False
        log.warning("REDIS_URL unset/disabled — running without cache")
    app.state.http = httpx.AsyncClient(base_url=BENTOML_URL, timeout=10.0)
    async with app.state.db.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS flood_incident_reports (
                id BIGSERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                location_name TEXT NOT NULL,
                incident_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                description TEXT NOT NULL,
                water_depth_cm DOUBLE PRECISION,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                status TEXT NOT NULL DEFAULT 'unverified'
            );
            CREATE INDEX IF NOT EXISTS idx_flood_incident_reports_created
                ON flood_incident_reports (created_at DESC);
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS media_url TEXT;
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS media_type TEXT;
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS edit_token_hash TEXT;
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS affected_street TEXT;
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS flood_source TEXT;
            ALTER TABLE flood_incident_reports ADD COLUMN IF NOT EXISTS reporter_token_hash TEXT;
            CREATE TABLE IF NOT EXISTS flood_incident_verifications (
                id BIGSERIAL PRIMARY KEY,
                incident_id BIGINT NOT NULL REFERENCES flood_incident_reports(id) ON DELETE CASCADE,
                verifier_token_hash TEXT NOT NULL,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                distance_km DOUBLE PRECISION NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (incident_id, verifier_token_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_flood_incident_verifications_incident
                ON flood_incident_verifications (incident_id, created_at DESC);
        """)
    log.info("DB pool ready (Cloud SQL socket=%s)", bool(INSTANCE_CONNECTION_NAME or DB_HOST.startswith("/cloudsql/")))


@app.on_event("shutdown")
async def shutdown():
    await app.state.db.close()
    await app.state.redis.aclose()
    await app.state.http.aclose()


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    db_ok = False
    try:
        async with app.state.db.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception as exc:
        log.warning("Health DB check failed: %s", exc)
    return {
        "status": "ok" if db_ok else "degraded",
        "time": datetime.now(timezone.utc).isoformat(),
        "db": "ok" if db_ok else "error",
        "redis": "ok" if getattr(app.state, "redis_enabled", False) else "disabled",
    }


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
app.include_router(incidents.router,   prefix="/incidents", tags=["community incidents"])
app.include_router(news.router,        prefix="/news", tags=["live flood news"])
app.include_router(routing.router,     prefix="/routing", tags=["flood-aware routing"])
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
