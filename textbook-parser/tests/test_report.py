import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.report import build_review_report


class ReviewReportTest(unittest.TestCase):
    def test_report_includes_match_turn_and_escaped_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "crops").mkdir()
            (root / "crops" / "board.png").write_bytes(b"not inspected by report")
            (root / "positions.json").write_text(json.dumps([{
                "id": "p001-01", "page": 1, "bbox": [10, 20, 110, 120],
                "cropPath": str(root / "crops" / "board.png"), "sideToMove": "w", "turnConfidence": 0.8,
            }]))
            (root / "layout.json").write_text(json.dumps([{
                "id": "text-1", "page": 1, "text": "Diagram 1 <unsafe>", "bbox": [12, 1, 100, 10], "section": "study",
            }]))
            (root / "links.json").write_text(json.dumps([{
                "position_id": "p001-01", "status": "linked", "text_block_ids": ["text-1"], "reasons": ["exact label"],
            }]))
            (root / "recognition.json").write_text(json.dumps({"p001-01": "8/8/8/8/8/8/8/K6k"}))
            (root / "book.json").write_text(json.dumps({"chapters": [{"number": 1, "items": [{
                "id": "item-1", "fen": "8/8/8/8/8/8/8/K6k w - - 0 1", "sideToMove": "w",
            }]}]}))
            counts = build_review_report(root / "positions.json", root / "layout.json", root / "links.json", root / "review.html", root / "recognition.json", root / "book.json")
            report = (root / "review.html").read_text(encoding="utf-8")
            self.assertEqual(counts["saved_match"], 1)
            self.assertEqual(counts["turn_correct"], 1)
            self.assertIn("item-1", report)
            self.assertIn("Diagram 1 &lt;unsafe&gt;", report)
            self.assertIn("crops/board.png", report)
            self.assertIn("Export decisions", report)
            self.assertIn("Approve with corrections", report)
