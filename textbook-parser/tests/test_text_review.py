import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from textbook_parser.text_review import build_text_review_report


class TextReviewReportTest(unittest.TestCase):
    def test_writes_source_crop_and_review_controls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pages = root / "pages"
            pages.mkdir()
            Image.new("RGB", (100, 80), "white").save(pages / "page_007.png")
            (root / "ocr.json").write_text(json.dumps([{"id": "p007-o0001", "page": 7, "bbox": [10, 10, 60, 30], "text": "1...De24!", "confidence": 11.1}]))
            count = build_text_review_report(root / "ocr.json", pages, root / "text-review.html")
            report = (root / "text-review.html").read_text(encoding="utf-8")
            self.assertEqual(count, 1)
            self.assertIn("Text OCR QA", report)
            self.assertIn("Raw Tesseract text", report)
            self.assertIn("Reviewed text", report)
            self.assertIn("1. Content type", report)
            self.assertIn("2. Reviewed text", report)
            self.assertIn("Submit &amp; next", report)
            self.assertIn("function renderCurrent", report)
            self.assertIn('type="radio"', report)
            self.assertIn('class="choice"', report)
            self.assertIn("function refresh(card)", report)
            self.assertNotIn("reviewed=card.querySelector('.reviewed').value.trim()", report)
            self.assertTrue((root / "text-crops" / "p007-o0001.png").is_file())
