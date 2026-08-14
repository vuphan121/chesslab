import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.review_server import DecisionStore, normalize_decisions


class ReviewServerTest(unittest.TestCase):
    def test_store_writes_portable_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review-decisions.json"
            store = DecisionStore(path)
            result = store.write({"decisions": [{"id": "p001-01", "decision": "corrected", "sideToMove": "w", "textBlockIds": ["t1"], "notes": "fixed"}]})
            self.assertEqual(result["version"], 1)
            self.assertEqual(store.read()["decisions"][0]["notes"], "fixed")
            self.assertEqual(json.loads(path.read_text())["decisions"][0]["decision"], "corrected")

    def test_rejects_invalid_turn(self) -> None:
        with self.assertRaises(ValueError):
            normalize_decisions({"decisions": [{"id": "p001-01", "sideToMove": "black"}]})

    def test_store_merges_partial_updates_and_keeps_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review-decisions.json"
            store = DecisionStore(path)
            store.write({"decisions": [{"id": "p001-01", "decision": "approved"}]})
            store.write({"decisions": [{"id": "p001-02", "decision": "corrected", "notes": "new"}]})
            decisions = {record["id"]: record for record in store.read()["decisions"]}
            self.assertEqual(set(decisions), {"p001-01", "p001-02"})
            self.assertTrue(path.with_suffix(".json.bak").is_file())
            history = path.with_name("review-decisions-history.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(history), 2)
            self.assertEqual(json.loads(history[-1])["changes"][0]["id"], "p001-02")
