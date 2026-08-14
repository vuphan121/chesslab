import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.crop_report import build_crop_review_report


class CropReviewReportTest(unittest.TestCase):
    def test_writes_crop_quality_controls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "crop.png").write_bytes(b"not rendered in this test")
            (root / "boards.json").write_text(json.dumps([{"id": "p001-01", "page": 1, "bbox": [1, 2, 3, 4], "cropPath": str(root / "crop.png")}]))
            build_crop_review_report(root / "boards.json", root / "crop-quality.html")
            result = (root / "crop-quality.html").read_text(encoding="utf-8")
            self.assertIn("Crop quality review", result)
            self.assertIn("Partial / needs recrop", result)
            self.assertIn("crop.png", result)
