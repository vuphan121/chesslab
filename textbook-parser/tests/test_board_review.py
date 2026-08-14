import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.board_review import build_board_review_report


class BoardReviewReportTest(unittest.TestCase):
    def test_writes_board_fact_controls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "crop.png").write_bytes(b"not rendered here")
            (root / "positions.json").write_text(json.dumps([{"id":"p001-01","page":1,"bbox":[1,2,3,4],"cropPath":str(root / "crop.png"),"sideToMove":"w","turnConfidence":0.8,"turnDetection":"triangle"}]))
            (root / "recognition.json").write_text(json.dumps({"p001-01":"8/8/8/8/8/8/8/K6k"}))
            build_board_review_report(root / "positions.json", root / "recognition.json", root / "board-review.html")
            report = (root / "board-review.html").read_text(encoding="utf-8")
            self.assertIn("Board facts review", report)
            self.assertIn("ChessOCR placement", report)
            self.assertIn("Correct side to move", report)
            self.assertIn("Textbook diagram", report)
            self.assertIn("Chesslab board preview", report)
            self.assertIn("assets/pieces/", report)
            self.assertIn("function renderBoard", report)
