from __future__ import annotations

import csv
import io
import re
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any


PAGE_RE = re.compile(r"(\d+)$")


def parse_tesseract_tsv(tsv: str, page: int) -> list[dict[str, Any]]:
    """Turn Tesseract's word TSV into visual-line evidence without interpretation."""
    lines: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
        text = (row.get("text") or "").strip()
        if row.get("level") != "5" or not text:
            continue
        lines[(row["block_num"], row["par_num"], row["line_num"])].append(row)
    result: list[dict[str, Any]] = []
    for index, words in enumerate(lines.values(), 1):
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        right = max(int(word["left"]) + int(word["width"]) for word in words)
        bottom = max(int(word["top"]) + int(word["height"]) for word in words)
        result.append({
            "id": f"p{page:03d}-o{index:04d}", "page": page,
            "bbox": [left, top, right, bottom],
            "text": " ".join(word["text"] for word in words),
            "confidence": round(sum(float(word.get("conf") or 0) for word in words) / len(words), 2),
            "source": "tesseract",
        })
    return result


def ocr_pages(
    pages_directory: str | Path,
    output_path: str | Path,
    tesseract_path: str = "tesseract",
    psm: int = 3,
) -> dict[str, int]:
    """OCR rendered pages into raw text evidence. No moves are parsed here."""
    blocks: list[dict[str, Any]] = []
    pages = sorted(Path(pages_directory).glob("page_*.png"))
    for image_path in pages:
        match = PAGE_RE.search(image_path.stem)
        if not match:
            continue
        page = int(match.group(1))
        result = subprocess.run(
            [tesseract_path, str(image_path), "stdout", "tsv", "--psm", str(psm)],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        blocks.extend(parse_tesseract_tsv(result.stdout, page))
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    import json

    output.write_text(json.dumps(blocks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"pages": len(pages), "blocks": len(blocks)}
