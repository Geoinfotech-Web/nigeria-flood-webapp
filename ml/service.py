"""
BentoML Prediction Service
==========================
Serves XGBoost + LSTM flood prediction models.
Exposes REST endpoints consumed by the FastAPI backend.

Endpoints:
  POST /predict          — single-station prediction for all horizons
  POST /predict/batch    — batch predictions for multiple stations
  GET  /health           — service health + loaded model versions

Start locally:
  bentoml serve service:FloodService --port 3000 --reload
"""

from __future__ import annotations

import os
import logging
from typing import Any

import numpy as np
import torch
import bentoml
from bentoml.io import JSON
from pydantic import BaseModel

log = logging.getLogger(__name__)

HORIZONS = [6, 12, 24, 48, 72]
FEATURE_COLS = [
    "water_level_m", "flow_rate_m3s",
    "level_change_1h", "level_change_3h",
    "rolling_rain_3h_mm", "rolling_rain_24h_mm",
    "soil_moisture_idx", "days_since_last_peak", "level_pct_bank",
]

RISK_TIERS = {
    "Watch":     (0.30, 0.50),
    "Warning":   (0.50, 0.75),
    "Emergency": (0.75, 1.01),
}


def classify_risk(prob: float) -> str:
    for tier, (lo, hi) in RISK_TIERS.items():
        if lo <= prob < hi:
            return tier
    return "Normal"


# ── Load models at startup ────────────────────────────────────────────────────
def _load_models() -> dict:
    models = {}
    for h in HORIZONS:
        try:
            models[f"xgb_{h}"] = bentoml.xgboost.load_model(f"xgb_h{h}:latest")
            log.info("Loaded xgb_h%d", h)
        except bentoml.exceptions.NotFound:
            log.warning("Model xgb_h%d not found — run train.py first", h)

        try:
            ref = bentoml.pytorch.load_model(f"lstm_h{h}:latest")
            models[f"lstm_{h}"] = ref
            log.info("Loaded lstm_h%d", h)
        except bentoml.exceptions.NotFound:
            log.warning("Model lstm_h%d not found — run train.py first", h)
    return models


_MODELS = _load_models()


# ── Schemas ───────────────────────────────────────────────────────────────────
class FeatureInput(BaseModel):
    station_id: int
    water_level_m: float
    flow_rate_m3s: float
    level_change_1h: float
    level_change_3h: float
    rolling_rain_3h_mm: float
    rolling_rain_24h_mm: float
    soil_moisture_idx: float
    days_since_last_peak: float
    level_pct_bank: float


class PredictionOutput(BaseModel):
    station_id: int
    horizons: dict[str, dict]   # {"6h": {"prob": 0.12, "risk_tier": "Normal"}, ...}


# ── Service definition ────────────────────────────────────────────────────────
svc = bentoml.Service("FloodService")


@svc.api(input=JSON(pydantic_model=FeatureInput), output=JSON(pydantic_model=PredictionOutput))
def predict(features: FeatureInput) -> PredictionOutput:
    x = np.array([[getattr(features, col) for col in FEATURE_COLS]], dtype=np.float32)
    horizons_out: dict[str, dict] = {}

    for h in HORIZONS:
        xgb_prob  = None
        lstm_prob = None
        final_prob = 0.0

        xgb_key = f"xgb_{h}"
        lstm_key = f"lstm_{h}"

        if xgb_key in _MODELS:
            xgb_prob = float(_MODELS[xgb_key].predict_proba(x)[0, 1])

        if lstm_key in _MODELS:
            with torch.no_grad():
                t = torch.tensor(x.reshape(1, 1, -1), dtype=torch.float32)
                lstm_prob = float(_MODELS[lstm_key](t)[0, 0])

        # Ensemble: average available models
        available = [p for p in [xgb_prob, lstm_prob] if p is not None]
        if available:
            final_prob = float(np.mean(available))

        horizons_out[f"{h}h"] = {
            "flood_prob": round(final_prob, 4),
            "risk_tier":  classify_risk(final_prob),
            "xgb_prob":   round(xgb_prob, 4) if xgb_prob is not None else None,
            "lstm_prob":  round(lstm_prob, 4) if lstm_prob is not None else None,
        }

    return PredictionOutput(station_id=features.station_id, horizons=horizons_out)


@svc.api(input=JSON(), output=JSON())
def health(_: Any) -> dict:
    return {
        "status": "ok",
        "loaded_models": list(_MODELS.keys()),
        "horizons": HORIZONS,
    }
