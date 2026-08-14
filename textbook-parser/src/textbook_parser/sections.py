from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def build_section_corpus(layout_path: str | Path, output_path: str | Path) -> dict[str, int]:
    """Group every extracted text block by contiguous page/section ranges.

    This is an evidence-preserving stage. It intentionally does no move OCR,
    figurine replacement, or prose interpretation: those need a separate,
    human-reviewed pass.
    """
    blocks: list[dict[str, Any]] = json.loads(Path(layout_path).read_text(encoding="utf-8"))
    pages: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for block in blocks:
        pages[int(block["page"])].append(block)

    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for page_number in sorted(pages):
        page_blocks = sorted(pages[page_number], key=lambda item: (item["bbox"][1], item["bbox"][0]))
        page_sections = {str(block.get("section") or "study") for block in page_blocks}
        primary = next((name for name in ("solution", "exercise") if name in page_sections), "study")
        if current is None or current["kind"] != primary or page_number != current["lastPage"] + 1:
            current = {
                "id": f"{primary}-{page_number:03d}", "kind": primary,
                "firstPage": page_number, "lastPage": page_number, "blocks": [],
            }
            sections.append(current)
        else:
            current["lastPage"] = page_number
        current["blocks"].extend({
            "id": str(block["id"]), "page": page_number, "bbox": block["bbox"],
            "text": str(block.get("text", "")), "sourceSection": str(block.get("section") or "study"),
        } for block in page_blocks)

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(sections, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"sections": len(sections), "blocks": sum(len(section["blocks"]) for section in sections)}
