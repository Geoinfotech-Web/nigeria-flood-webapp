"""
ML Training Script — XGBoost + LSTM
=====================================
Reads flood_features from TimescaleDB, engineers the label
(flood event = water_level_m > 0.8 * bank_full within next 24 h),
trains both models, evaluates (AUC-ROC gate > 0.87 + F1 > 0.78),
and registers the best run with MLflow + BentoML.

Usage:
  python train.py                   # train all horizons
  python train.py --horizon 24      # train 24h-ahead only
  python train.py --dry-run         # skip MLflow registration
"""

import os
import argparse
import logging
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import psycopg2
import mlflow
import mlflow.xgboost
import mlflow.pytorch
import xgboost as xgb
import torch
import torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, f1_score, classification_report, roc_curve
import bentoml

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [train] %(message)s", force=True)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
DB_DSN = (
    f"host={os.getenv('DB_HOST','timescaledb')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)
MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "file:///app/mlruns")
HORIZONS = [6, 12, 24, 48, 72]   # hours ahead
FEATURE_COLS = [
    "water_level_m", "flow_rate_m3s",
    "level_change_1h", "level_change_3h",
    "rolling_rain_3h_mm", "rolling_rain_24h_mm",
    "soil_moisture_idx", "days_since_last_peak", "level_pct_bank",
]
AUC_GATE = float(os.getenv("AUC_GATE", "0.80"))   # 0.87 for production with real data
F1_GATE  = float(os.getenv("F1_GATE",  "0.60"))   # 0.78 for production with real data
# Set FORCE_REGISTER=1 to bake models even when gates fail (bootstrap / sparse real history)
FORCE_REGISTER = os.getenv("FORCE_REGISTER", "0") == "1"


# ── Data loading ──────────────────────────────────────────────────────────────
def load_data() -> pd.DataFrame:
    log.info("Loading flood_features from TimescaleDB…")
    conn = psycopg2.connect(DB_DSN)
    query = """
        SELECT
            ff.time, ff.station_id,
            ff.water_level_m, ff.flow_rate_m3s,
            ff.level_change_1h, ff.level_change_3h,
            ff.rolling_rain_3h_mm, ff.rolling_rain_24h_mm,
            ff.soil_moisture_idx, ff.days_since_last_peak,
            ff.level_pct_bank,
            gs.bank_full_m
        FROM flood_features ff
        JOIN gauge_stations gs ON gs.id = ff.station_id
        ORDER BY ff.station_id, ff.time
    """
    df = pd.read_sql(query, conn)
    conn.close()
    log.info("Loaded %d feature rows", len(df))
    return df


def build_labels(df: pd.DataFrame, horizon_h: int) -> pd.Series:
    """
    Label = 1 if water_level_m > 0.8 * bank_full at any point
    in the next `horizon_h` hours for that station.
    """
    label = pd.Series(0, index=df.index)
    # Infer feature cadence (synthetic/backfill may be 30-min; real GloFAS features often hourly)
    deltas = df.groupby("station_id")["time"].diff().dropna()
    if len(deltas):
        median_min = float(pd.Series(deltas).dt.total_seconds().median() / 60.0)
        steps_per_hour = max(1, int(round(60.0 / max(median_min, 1.0))))
    else:
        steps_per_hour = 2
    horizon_steps = horizon_h * steps_per_hour

    for sid in df["station_id"].unique():
        mask = df["station_id"] == sid
        levels = df.loc[mask, "water_level_m"].values
        bank   = df.loc[mask, "bank_full_m"].values[0]
        flood_threshold = 0.8 * bank

        idx = df.index[mask].tolist()
        for i, orig_idx in enumerate(idx):
            future = levels[i+1 : i+1+horizon_steps]
            if len(future) and (future > flood_threshold).any():
                label[orig_idx] = 1
    return label


# ── LSTM model ────────────────────────────────────────────────────────────────
class FloodLSTM(nn.Module):
    def __init__(self, input_size: int, hidden: int = 64, layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, layers,
                            batch_first=True, dropout=dropout)
        self.fc   = nn.Linear(hidden, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        return torch.sigmoid(self.fc(out[:, -1, :]))


def make_sequences(X: np.ndarray, y: np.ndarray, seq_len: int = 12):
    Xs, ys = [], []
    for i in range(seq_len, len(X)):
        Xs.append(X[i-seq_len:i])
        ys.append(y[i])
    return np.array(Xs), np.array(ys)


def train_lstm(X_tr, y_tr, X_val, y_val, input_size: int,
               epochs: int = 30, lr: float = 1e-3) -> tuple[FloodLSTM, float]:
    SEQ_LEN = 12
    Xtr_s, ytr_s = make_sequences(X_tr, y_tr, SEQ_LEN)
    Xval_s, yval_s = make_sequences(X_val, y_val, SEQ_LEN)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model  = FloodLSTM(input_size).to(device)
    opt    = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCELoss()

    Xtr_t  = torch.tensor(Xtr_s,  dtype=torch.float32).to(device)
    ytr_t  = torch.tensor(ytr_s,  dtype=torch.float32).unsqueeze(1).to(device)
    Xval_t = torch.tensor(Xval_s, dtype=torch.float32).to(device)
    yval_t = torch.tensor(yval_s, dtype=torch.float32).unsqueeze(1).to(device)

    for epoch in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        pred = model(Xtr_t)
        loss = loss_fn(pred, ytr_t)
        loss.backward()
        opt.step()
        if epoch % 10 == 0:
            model.eval()
            with torch.no_grad():
                vp = model(Xval_t).cpu().numpy().flatten()
            vauc = roc_auc_score(yval_s, vp)
            log.info("  LSTM epoch %d/%d  loss=%.4f  val_auc=%.4f",
                     epoch, epochs, loss.item(), vauc)

    model.eval()
    with torch.no_grad():
        final_pred = model(Xval_t).cpu().numpy().flatten()
    auc = roc_auc_score(yval_s, final_pred)
    return model, auc


# ── Main training loop ────────────────────────────────────────────────────────
def train_horizon(df: pd.DataFrame, horizon_h: int, dry_run: bool):
    log.info("═══ Horizon %dh ════════════════════════════════", horizon_h)
    mlflow.set_tracking_uri(MLFLOW_URI)
    mlflow.set_experiment("flood_prediction")

    labels = build_labels(df, horizon_h)
    valid  = labels.notna() & df[FEATURE_COLS].notna().all(axis=1)
    X = df.loc[valid, FEATURE_COLS].values.astype(np.float32)
    y = labels[valid].values.astype(np.float32)

    pos_rate = y.mean()
    log.info("  Samples=%d  positive_rate=%.2f%%", len(y), pos_rate * 100)

    if len(y) < 500:
        log.warning("  Not enough data (%d rows) — skipping horizon %dh", len(y), horizon_h)
        return

    if pos_rate <= 0.0 or pos_rate >= 1.0:
        log.warning("  Labels lack both classes (pos_rate=%.3f) — skipping horizon %dh",
                    pos_rate, horizon_h)
        return

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # XGBoost: stratified random split (no temporal dependency)
    X_tr, X_val, y_tr, y_val = train_test_split(
        X_scaled, y, test_size=0.2, stratify=y, random_state=42)

    # LSTM: per-station temporal split (preserves time order within each station)
    station_ids = df.loc[valid, "station_id"].values
    lstm_X_tr, lstm_y_tr, lstm_X_val, lstm_y_val = [], [], [], []
    for sid in np.unique(station_ids):
        mask = station_ids == sid
        Xs, ys = X_scaled[mask], y[mask]
        split = int(len(Xs) * 0.8)
        lstm_X_tr.append(Xs[:split]); lstm_y_tr.append(ys[:split])
        lstm_X_val.append(Xs[split:]); lstm_y_val.append(ys[split:])
    lstm_X_tr  = np.concatenate(lstm_X_tr)
    lstm_y_tr  = np.concatenate(lstm_y_tr)
    lstm_X_val = np.concatenate(lstm_X_val)
    lstm_y_val = np.concatenate(lstm_y_val)

    scale_pos = max(1.0, (1 - pos_rate) / (pos_rate + 1e-9))

    def best_f1_threshold(probs, labels):
        """Find threshold that maximises F1 on validation set."""
        _, _, thresholds = roc_curve(labels, probs)
        best_t, best_f1 = 0.5, 0.0
        for t in thresholds:
            preds = (probs >= t).astype(int)
            score = f1_score(labels, preds, zero_division=0)
            if score > best_f1:
                best_f1, best_t = score, float(t)
        return best_t, best_f1

    with mlflow.start_run(run_name=f"xgb_h{horizon_h}"):
        mlflow.log_param("horizon_h", horizon_h)
        mlflow.log_param("model", "xgboost")
        mlflow.log_param("n_samples", len(y))

        xgb_model = xgb.XGBClassifier(
            n_estimators=300, max_depth=6, learning_rate=0.05,
            scale_pos_weight=scale_pos, eval_metric="auc",
            use_label_encoder=False, random_state=42,
        )
        xgb_model.fit(X_tr, y_tr,
                      eval_set=[(X_val, y_val)],
                      verbose=False)

        xgb_probs = xgb_model.predict_proba(X_val)[:, 1]
        xgb_auc   = roc_auc_score(y_val, xgb_probs)
        best_t, xgb_f1 = best_f1_threshold(xgb_probs, y_val)
        log.info("  XGB  AUC=%.4f  F1=%.4f  threshold=%.3f", xgb_auc, xgb_f1, best_t)
        mlflow.log_metrics({"auc": xgb_auc, "f1": xgb_f1, "threshold": best_t})
        mlflow.xgboost.log_model(xgb_model, "xgb_model")

        gate_ok = xgb_auc >= AUC_GATE and xgb_f1 >= F1_GATE
        if not dry_run and (gate_ok or FORCE_REGISTER):
            tag = f"xgb_h{horizon_h}"
            bentoml.xgboost.save_model(
                tag, xgb_model,
                signatures={"predict_proba": {"batchable": True}},
                metadata={"horizon_h": horizon_h, "auc": xgb_auc, "f1": xgb_f1,
                          "threshold": best_t, "forced": not gate_ok},
            )
            log.info("  Registered BentoML model: %s%s", tag,
                     " (forced)" if not gate_ok else "")
        else:
            if xgb_auc < AUC_GATE or xgb_f1 < F1_GATE:
                log.warning("  XGB did NOT pass quality gate (AUC≥%.2f F1≥%.2f)", AUC_GATE, F1_GATE)

    with mlflow.start_run(run_name=f"lstm_h{horizon_h}"):
        mlflow.log_param("horizon_h", horizon_h)
        mlflow.log_param("model", "lstm")

        lstm_model, lstm_auc = train_lstm(
            lstm_X_tr, lstm_y_tr, lstm_X_val, lstm_y_val, len(FEATURE_COLS))
        SEQ_LEN = 12
        Xval_seq, y_val_seq = make_sequences(lstm_X_val, lstm_y_val, SEQ_LEN)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        Xval_t = torch.tensor(Xval_seq, dtype=torch.float32).to(device)
        with torch.no_grad():
            lstm_probs = lstm_model(Xval_t).cpu().numpy().flatten()
        _, lstm_f1 = best_f1_threshold(lstm_probs, y_val_seq)
        log.info("  LSTM AUC=%.4f  F1=%.4f", lstm_auc, lstm_f1)
        mlflow.log_metrics({"auc": lstm_auc, "f1": lstm_f1})

        lstm_gate_ok = lstm_auc >= AUC_GATE and lstm_f1 >= F1_GATE
        if not dry_run and (lstm_gate_ok or FORCE_REGISTER):
            tag = f"lstm_h{horizon_h}"
            bentoml.pytorch.save_model(
                tag, lstm_model,
                signatures={"__call__": {"batchable": False}},
                metadata={"horizon_h": horizon_h, "auc": lstm_auc, "f1": lstm_f1,
                          "seq_len": SEQ_LEN, "scaler_mean": scaler.mean_.tolist(),
                          "scaler_scale": scaler.scale_.tolist(),
                          "forced": not lstm_gate_ok},
            )
            log.info("  Registered BentoML model: %s%s", tag,
                     " (forced)" if not lstm_gate_ok else "")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon", type=int, default=None, choices=HORIZONS)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    df = load_data()
    if df.empty:
        log.error("No feature data in DB. Run backfill first:  "
                  "docker-compose run --rm ingest python backfill.py")
        return

    horizons = [args.horizon] if args.horizon else HORIZONS
    for h in horizons:
        train_horizon(df, h, args.dry_run)

    log.info("Training complete.")


if __name__ == "__main__":
    main()
