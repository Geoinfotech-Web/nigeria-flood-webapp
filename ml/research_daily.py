"""Isolated daily-cadence research models. Not for operational flood warnings."""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import xgboost
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

DAY = timedelta(days=1)
SEQUENCE_LENGTH = 12
FEATURES = ("level_m", "discharge_m3s", "level_change_1d", "level_change_3d", "level_pct_bank")
HORIZONS = (24, 48, 72)


@dataclass(frozen=True)
class Reading:
    station_id: int
    time: datetime
    level: float
    discharge: float
    bank_full: float


@dataclass(frozen=True)
class Sample:
    station_id: int
    time: datetime
    sequence: np.ndarray
    label: int


class FloodLSTM(nn.Module):
    def __init__(self, input_size: int, hidden: int = 64, layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, layers, batch_first=True, dropout=dropout)
        self.fc = nn.Linear(hidden, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        return torch.sigmoid(self.fc(out[:, -1, :]))


def load_readings(path: Path) -> list[Reading]:
    readings = []
    with path.open(newline="", encoding="utf-8-sig") as stream:
        for row in csv.DictReader(stream):
            time = datetime.fromisoformat(row["time"].replace("Z", "+00:00"))
            if time.utcoffset() is None:
                raise ValueError("Reading timestamps must include a timezone")
            time = time.astimezone(timezone.utc)
            level, discharge, bank = (float(row[k]) for k in ("water_level_m", "flow_rate_m3s", "bank_full_m"))
            if time.time() != datetime.min.time() or not all(map(math.isfinite, (level, discharge, bank))) or bank <= 0:
                raise ValueError("Readings must be finite, daily UTC values with a positive bank-full level")
            readings.append(Reading(int(row["station_id"]), time, level, discharge, bank))
    if not readings:
        raise ValueError("No readings were provided")
    return readings


def build_samples(readings: list[Reading], horizon: int) -> list[Sample]:
    if horizon not in HORIZONS:
        raise ValueError("Daily data supports only 24, 48, and 72 hour research horizons")
    stations: dict[int, dict[datetime, Reading]] = defaultdict(dict)
    for row in readings:
        if row.time in stations[row.station_id]:
            raise ValueError(f"Duplicate timestamp for station {row.station_id}: {row.time}")
        stations[row.station_id][row.time] = row
    samples = []
    for station_id, series in stations.items():
        for current_time in sorted(series):
            sequence = []
            for offset in range(SEQUENCE_LENGTH - 1, -1, -1):
                time = current_time - offset * DAY
                needed = [series.get(time - lag * DAY) for lag in (0, 1, 3)]
                if any(row is None for row in needed):
                    break
                now, previous, prior_three = needed
                sequence.append((now.level, now.discharge, now.level - previous.level,
                                 now.level - prior_three.level, now.level / now.bank_full))
            future = [series.get(current_time + day * DAY) for day in range(1, horizon // 24 + 1)]
            if len(sequence) != SEQUENCE_LENGTH or any(row is None for row in future):
                continue
            label = int(any(row.level > 0.8 * row.bank_full for row in future))
            samples.append(Sample(station_id, current_time, np.asarray(sequence, dtype=np.float32), label))
    if not samples:
        raise ValueError("No complete daily sequences and future windows are available")
    return samples


def split_samples(samples: list[Sample], horizon: int) -> tuple[list[Sample], list[Sample], list[Sample]]:
    dates = sorted({sample.time for sample in samples})
    if len(dates) < 20:
        raise ValueError("At least 20 distinct sample dates are required")
    validation_start, test_start = dates[int(len(dates) * .6)], dates[int(len(dates) * .8)]
    embargo = timedelta(hours=horizon)
    train = [s for s in samples if s.time + embargo < validation_start]
    validation = [s for s in samples if validation_start <= s.time and s.time + embargo < test_start]
    test = [s for s in samples if s.time >= test_start]
    for name, split in (("train", train), ("validation", validation), ("test", test)):
        if not split or len({s.label for s in split}) != 2:
            raise ValueError(f"{name} split must contain examples from both proxy-label classes")
    return train, validation, test


def prepare_sequences(samples: list[Sample], mean: np.ndarray, scale: np.ndarray) -> np.ndarray:
    values = np.stack([s.sequence for s in samples])
    return ((values - mean) / scale).astype(np.float32)


def probabilities(xgb: XGBClassifier, lstm: FloodLSTM, sequences: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    xgb_probs = xgb.predict_proba(sequences[:, -1, :])[:, 1]
    lstm.eval()
    with torch.no_grad():
        lstm_probs = lstm(torch.from_numpy(sequences)).cpu().numpy().reshape(-1)
    return xgb_probs, lstm_probs


def metrics(labels: np.ndarray, probabilities_: np.ndarray) -> dict:
    return {
        "auc_roc": float(roc_auc_score(labels, probabilities_)),
        "f1_at_0_5": float(f1_score(labels, probabilities_ >= .5, zero_division=0)),
    }


def train_horizon(readings: list[Reading], horizon: int, output: Path, epochs: int) -> dict:
    train, validation, test = split_samples(build_samples(readings, horizon), horizon)
    scaler = StandardScaler().fit(np.concatenate([s.sequence for s in train]))
    x_train = prepare_sequences(train, scaler.mean_, scaler.scale_)
    x_validation = prepare_sequences(validation, scaler.mean_, scaler.scale_)
    x_test = prepare_sequences(test, scaler.mean_, scaler.scale_)
    y_train = np.asarray([s.label for s in train], dtype=np.float32)
    y_validation = np.asarray([s.label for s in validation], dtype=np.float32)
    y_test = np.asarray([s.label for s in test], dtype=np.float32)

    model = XGBClassifier(n_estimators=300, max_depth=6, learning_rate=.05,
                          scale_pos_weight=max(1., (1 - y_train.mean()) / y_train.mean()),
                          eval_metric="auc", random_state=42, n_jobs=2)
    model.fit(x_train[:, -1, :], y_train, verbose=False)
    torch.manual_seed(42)
    lstm = FloodLSTM(len(FEATURES))
    optimizer = torch.optim.Adam(lstm.parameters(), lr=.001)
    inputs = torch.from_numpy(x_train)
    labels = torch.from_numpy(y_train).unsqueeze(1)
    for _ in range(epochs):
        lstm.train()
        optimizer.zero_grad()
        loss = nn.functional.binary_cross_entropy(lstm(inputs), labels)
        loss.backward()
        optimizer.step()

    val_xgb, val_lstm = probabilities(model, lstm, x_validation)
    test_xgb, test_lstm = probabilities(model, lstm, x_test)
    result = {
        "purpose": "RESEARCH ONLY: modelled discharge and derived levels; not validated flood forecasts",
        "horizon_hours": horizon,
        "feature_names": FEATURES,
        "sequence_length": SEQUENCE_LENGTH,
        "feature_cadence_hours": 24,
        "label": "future derived water level > 0.8 * bank_full, not verified flood events",
        "versions": {"numpy": np.__version__, "torch": torch.__version__, "xgboost": xgboost.__version__},
        "counts": {name: {"samples": len(split), "positive": sum(s.label for s in split),
                          "positive_stations": len({s.station_id for s in split if s.label})}
                   for name, split in (("train", train), ("validation", validation), ("test", test))},
        "validation": {"xgboost": metrics(y_validation, val_xgb), "lstm": metrics(y_validation, val_lstm)},
        "test": {"xgboost": metrics(y_test, test_xgb), "lstm": metrics(y_test, test_lstm)},
        "split_ranges": {name: [min(s.time for s in split).isoformat(), max(s.time for s in split).isoformat()]
                         for name, split in (("train", train), ("validation", validation), ("test", test))},
        "scaler_mean": scaler.mean_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
    }
    for name, split, labels_ in (("validation", validation, y_validation), ("test", test, y_test)):
        current_ratio = np.asarray([sample.sequence[-1, -1] for sample in split])
        result[name]["current_level_baseline"] = {
            "auc_roc": float(roc_auc_score(labels_, current_ratio)),
            "f1_at_bankfull_ratio_0_8": float(f1_score(labels_, current_ratio > .8, zero_division=0)),
        }
    output.mkdir(parents=True, exist_ok=False)
    model.save_model(output / "xgboost.json")
    torch.save(lstm.state_dict(), output / "lstm.pt")
    (output / "metadata.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    for i in (0, len(test) - 1):
        np.testing.assert_allclose(
            load_and_predict(output, test[i]), (test_xgb[i], test_lstm[i]), rtol=1e-5, atol=1e-6,
        )
    return result


def load_and_predict(output: Path, sample: Sample) -> tuple[float, float]:
    metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
    if metadata["feature_names"] != list(FEATURES) or metadata["sequence_length"] != SEQUENCE_LENGTH:
        raise ValueError("Incompatible research model metadata")
    if sample.sequence.shape != (SEQUENCE_LENGTH, len(FEATURES)):
        raise ValueError("A complete daily feature sequence is required")
    sequence = prepare_sequences([sample], np.asarray(metadata["scaler_mean"]), np.asarray(metadata["scaler_scale"]))
    model = XGBClassifier()
    model.load_model(output / "xgboost.json")
    lstm = FloodLSTM(len(FEATURES))
    lstm.load_state_dict(torch.load(output / "lstm.pt", map_location="cpu", weights_only=True))
    xgb_probs, lstm_probs = probabilities(model, lstm, sequence)
    return float(xgb_probs[0]), float(lstm_probs[0])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Local research CSV export")
    parser.add_argument("--output", type=Path, required=True, help="New research artifact directory")
    parser.add_argument("--horizon", type=int, choices=HORIZONS, required=True)
    parser.add_argument("--epochs", type=int, default=30)
    args = parser.parse_args()
    if args.epochs < 1:
        parser.error("--epochs must be positive")
    torch.set_num_threads(2)
    random.seed(42)
    np.random.seed(42)
    result = train_horizon(load_readings(args.input), args.horizon, args.output, args.epochs)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
