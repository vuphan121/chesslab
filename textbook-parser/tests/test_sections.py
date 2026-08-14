import json
import tempfile
import unittest
from pathlib import Path

from textbook_parser.sections import build_section_corpus


class SectionCorpusTest(unittest.TestCase):
    def test_preserves_all_blocks_and_splits_section_ranges(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            layout = [
                {"id": "p001-t1", "page": 1, "bbox": [0, 1, 2, 3], "text": "♘f3", "section": "study"},
                {"id": "p002-t1", "page": 2, "bbox": [0, 1, 2, 3], "text": "Exercises", "section": "exercise"},
                {"id": "p003-t1", "page": 3, "bbox": [0, 1, 2, 3], "text": "Solution 1", "section": "solution"},
            ]
            (root / "layout.json").write_text(json.dumps(layout), encoding="utf-8")
            counts = build_section_corpus(root / "layout.json", root / "sections.json")
            value = json.loads((root / "sections.json").read_text(encoding="utf-8"))
            self.assertEqual(counts, {"sections": 3, "blocks": 3})
            self.assertEqual(value[0]["blocks"][0]["text"], "♘f3")
            self.assertEqual([section["kind"] for section in value], ["study", "exercise", "solution"])
