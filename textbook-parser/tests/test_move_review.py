import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.move_review import build_move_review_report


class MoveReviewReportTest(unittest.TestCase):
    def test_writes_human_only_move_review_controls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "positions.json").write_text(json.dumps([{"id": "p001-01", "page": 1, "sideToMove": "w"}]))
            (root / "recognition.json").write_text(json.dumps({"p001-01": "8/8/8/8/8/8/8/K6k"}))
            (root / "layout.json").write_text(json.dumps([{"id": "t1", "text": "1. Kh2"}]))
            (root / "candidates.json").write_text(json.dumps([{"positionId": "p001-01", "textBlockIds": ["t1"], "sanCandidates": ["Kh2"]}]))
            build_move_review_report(root / "positions.json", root / "recognition.json", root / "layout.json", root / "candidates.json", root / "move-review.html")
            report = (root / "move-review.html").read_text(encoding="utf-8")
            self.assertIn("Move candidate review", report)
            self.assertIn("Every OCR move candidate requires human approval", report)
            self.assertIn("Approved or corrected SAN line", report)
