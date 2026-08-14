import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).parents[1] / "src" / "notation_model.py"
SPEC = importlib.util.spec_from_file_location("notation_model", MODULE)
assert SPEC and SPEC.loader
notation_model = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notation_model)


class NotationDatasetTest(unittest.TestCase):
    def test_exports_only_explicitly_approved_chess_notation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            crops = root / "crops"
            crops.mkdir()
            (crops / "move.png").write_bytes(b"image")
            (crops / "prose.png").write_bytes(b"image")
            decisions = {"decisions": [
                {"id": "move", "decision": "corrected", "labelKind": "chess_notation", "reviewedText": "1... Ne2+!"},
                {"id": "prose", "decision": "approved", "labelKind": "prose", "reviewedText": "A sentence."},
            ]}
            path = root / "decisions.json"
            path.write_text(json.dumps(decisions), encoding="utf-8")
            counts = notation_model.export_notation_dataset(path, crops, root / "dataset")
            self.assertEqual(counts, {"examples": 1, "train": 1, "validation": 0})
            train = (root / "dataset" / "train.jsonl").read_text(encoding="utf-8")
            self.assertIn("1... Ne2+!", train)
            self.assertNotIn("sentence", train)
