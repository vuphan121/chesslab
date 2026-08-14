from __future__ import annotations

import json
import random
import shutil
from pathlib import Path


def export_notation_dataset(
    decisions_path: str | Path,
    crops_directory: str | Path,
    output_directory: str | Path,
    validation_fraction: float = 0.15,
    seed: int = 42,
) -> dict[str, int]:
    """Export only explicitly approved chess-notation labels for local training."""
    value = json.loads(Path(decisions_path).read_text(encoding="utf-8"))
    rows = value.get("decisions", []) if isinstance(value, dict) else value
    examples = []
    for row in rows:
        if row.get("labelKind") != "chess_notation" or row.get("decision") not in {"approved", "corrected"}:
            continue
        identifier = str(row.get("id", ""))
        text = str(row.get("reviewedText", "")).strip()
        crop = Path(crops_directory) / f"{identifier}.png"
        if identifier and text and crop.is_file():
            examples.append((identifier, text, crop))
    random.Random(seed).shuffle(examples)
    output = Path(output_directory)
    train_dir, validation_dir = output / "train", output / "validation"
    train_dir.mkdir(parents=True, exist_ok=True)
    validation_dir.mkdir(parents=True, exist_ok=True)
    validation_count = max(1, round(len(examples) * validation_fraction)) if len(examples) >= 8 else 0
    manifests: dict[str, list[dict[str, str]]] = {"train": [], "validation": []}
    for index, (identifier, text, crop) in enumerate(examples):
        split = "validation" if index < validation_count else "train"
        target = (validation_dir if split == "validation" else train_dir) / crop.name
        shutil.copy2(crop, target)
        manifests[split].append({"id": identifier, "image": str(target.relative_to(output).as_posix()), "text": text})
    for split, manifest in manifests.items():
        (output / f"{split}.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in manifest), encoding="utf-8")
    charset = "".join(sorted({character for _, text, _ in examples for character in text}))
    (output / "charset.txt").write_text(charset + "\n", encoding="utf-8")
    return {"examples": len(examples), "train": len(manifests["train"]), "validation": len(manifests["validation"])}
