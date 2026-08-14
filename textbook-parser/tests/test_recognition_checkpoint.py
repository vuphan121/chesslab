import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.cli import _load_existing_json, _pending_recognitions


class RecognitionCheckpointTest(unittest.TestCase):
    def test_missing_checkpoint_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(_load_existing_json(Path(directory) / "missing.json"), {})

    def test_existing_checkpoint_must_be_object(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            path.write_text(json.dumps([]), encoding="utf-8")
            with self.assertRaises(ValueError):
                _load_existing_json(path)

    def test_retry_selects_only_existing_errors(self) -> None:
        records = [{"id": "ok"}, {"id": "error"}, {"id": "missing"}]
        results = {"ok": "8/8/8/8/8/8/8/8", "error": {"error": "timeout"}}
        self.assertEqual(_pending_recognitions(records, results, True), [{"id": "error"}])
        self.assertEqual(_pending_recognitions(records, results, False), [{"id": "missing"}])
