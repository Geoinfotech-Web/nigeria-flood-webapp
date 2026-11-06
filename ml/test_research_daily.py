import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from research_daily import (
    DAY, FEATURES, SEQUENCE_LENGTH, Reading, Sample, build_samples,
    load_and_predict, split_samples, train_horizon,
)


def readings(days=100):
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        Reading(station, start + day * DAY, 9.0 if day % 8 == 3 else 3.0, day + 1.0, 10.0)
        for station in (1, 2)
        for day in range(days)
    ]


class DailyResearchTests(unittest.TestCase):
    def test_exact_future_window_and_complete_sequence(self):
        data = readings(35)
        samples = build_samples(data, 24)
        sample = next(s for s in samples if s.station_id == 1 and s.time == data[14].time)
        self.assertEqual(sample.sequence.shape, (SEQUENCE_LENGTH, len(FEATURES)))
        self.assertEqual(sample.sequence[-1, 2], data[14].level - data[13].level)
        self.assertEqual(sample.sequence[-1, 3], data[14].level - data[11].level)
        self.assertEqual(sample.label, int(data[15].level > 8))
        self.assertFalse(any(s.time == data[34].time for s in samples))

    def test_reject_short_horizons_duplicates_and_gaps(self):
        data = readings(35)
        with self.assertRaises(ValueError):
            build_samples(data, 6)
        with self.assertRaises(ValueError):
            build_samples(data + [data[0]], 24)
        missing_time = data[16].time
        samples = build_samples([r for r in data if not (r.station_id == 1 and r.time == missing_time)], 24)
        self.assertFalse(any(s.station_id == 1 and s.time == missing_time - DAY for s in samples))
        self.assertFalse(any(s.station_id == 1 and s.time == missing_time + DAY for s in samples))

    def test_split_embargo_prevents_label_overlap(self):
        train, validation, test = split_samples(build_samples(readings(), 72), 72)
        self.assertLess(max(s.time for s in train) + timedelta(hours=72), min(s.time for s in validation))
        self.assertLess(max(s.time for s in validation) + timedelta(hours=72), min(s.time for s in test))
        for split in (train, validation, test):
            self.assertEqual({s.label for s in split}, {0, 1})

    def test_trained_artifacts_load_and_require_full_sequence(self):
        data = readings()
        samples = build_samples(data, 24)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "model"
            result = train_horizon(data, 24, output, epochs=1)
            self.assertEqual(result["feature_cadence_hours"], 24)
            self.assertIn("current_level_baseline", result["test"])
            first = load_and_predict(output, samples[-1])
            second = load_and_predict(output, samples[-1])
            np.testing.assert_allclose(first, second, rtol=0, atol=1e-7)
            self.assertTrue(all(0 <= probability <= 1 for probability in first))
            invalid = Sample(samples[-1].station_id, samples[-1].time, samples[-1].sequence[-1:], 0)
            with self.assertRaises(ValueError):
                load_and_predict(output, invalid)


if __name__ == "__main__":
    unittest.main()
