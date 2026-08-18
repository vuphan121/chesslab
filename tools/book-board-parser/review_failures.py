#!/usr/bin/env python3
"""Build a local review queue for diagrams the automatic parser skipped."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import cv2


def is_issue(record: dict) -> str | None:
    if record.get("recognitionStatus") != "ok":
        return record.get("error", "ChessOCR did not return a valid piece placement")
    if record.get("sideToMove") not in {"w", "b"}:
        return record.get("turnDetection", "side-to-move marker could not be read")
    return None


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--parser-root", default="tools/book-board-parser/work/build-up-your-chess-1")
    cli.add_argument("--output", default="tools/book-board-parser/work/review/queue.json")
    args = cli.parse_args()
    root, output = Path(args.parser_root), Path(args.output)
    contexts = output.parent / "contexts"
    crops = output.parent / "crops"
    items: list[dict] = []
    for chapter in range(3, 25):
        payload = json.loads((root / f"chapter-{chapter}" / "positions.json").read_text(encoding="utf-8"))
        for record in payload["positions"]:
            reason = is_issue(record)
            if not reason:
                continue
            page = cv2.imread(str(root / f"chapter-{chapter}" / "pages" / f"master-{record['masterPDFPage']:03d}.png"))
            x0, y0, x1, y1 = record["bbox"]
            margin_x, margin_y = round((x1 - x0) * .18), round((y1 - y0) * .35)
            context = page[max(0, y0 - margin_y):min(page.shape[0], y1 + margin_y), max(0, x0 - margin_x):min(page.shape[1], x1 + margin_x)]
            context_name = f"{record['diagram']}.png"
            contexts.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(contexts / context_name), context)
            crop_name = f"{record['diagram']}.png"
            crops.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(record["cropPath"], crops / crop_name)
            placement, side = record.get("piecePlacement", ""), record.get("sideToMove", "")
            items.append({
                "chapter": chapter, "diagram": record["diagram"], "reason": reason,
                "piecePlacement": placement, "sideToMove": side,
                "parsedFen": f"{placement} {side if side in {'w', 'b'} else '?'} - - 0 1" if placement else "No parsed FEN",
                "bookPage": record["bookPage"], "masterPDFPage": record["masterPDFPage"], "chapterPDFPage": record["chapterPDFPage"],
                "context": f"contexts/{context_name}", "crop": f"crops/{crop_name}", "accepted": False,
            })
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"items": items}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(items)} review items to {output}")


if __name__ == "__main__":
    main()
