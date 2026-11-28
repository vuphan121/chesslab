#!/usr/bin/env python3
from __future__ import annotations

import collections
import json
import math
from pathlib import Path

import cv2
import numpy as np

from parse_aagaard import BOOKS


def has_number_circle(image, bbox) -> bool:
    x0, y0, x1, y1 = bbox
    width = x1 - x0
    top, bottom = max(0, y0 - round(width * 0.05)), min(image.shape[0], y1 + round(width * 0.05))
    strips = (
        (max(0, x0 - round(width * 0.45)), max(0, x0 - round(width * 0.075))),
        (x1 + round(width * 0.015), min(image.shape[1], x1 + round(width * 0.36))),
    )
    for left, right in strips:
        region = image[top:bottom, left:right]
        if region.size == 0:
            continue
        dark = (cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) < 205).astype(np.uint8) * 255
        dark = cv2.dilate(dark, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            _, _, w, h = cv2.boundingRect(contour)
            if not (50 <= w <= 68 and 61 <= h <= 68):
                continue
            round_ratio = cv2.contourArea(cv2.convexHull(contour)) / (math.pi * w * h / 4)
            if 0.9 <= round_ratio <= 1.12:
                return True
    return False


def exercise_records(root: Path, chapter: int) -> list[dict]:
    records = json.loads((root / f"chapter-{chapter}" / "candidates.json").read_text(encoding="utf-8"))
    pages = {}
    found = []
    for record in records:
        page = record["masterPDFPage"]
        if page not in pages:
            pages[page] = cv2.imread(str(root / f"chapter-{chapter}" / "pages" / f"master-{page:03d}.png"))
        if has_number_circle(pages[page], record["bbox"]):
            found.append(record)
    grid_pages = {page for page, count in collections.Counter(r["masterPDFPage"] for r in found).items() if count >= 2}
    return [r for r in records if r in found or (r["masterPDFPage"] in grid_pages and r["sideToMove"])]


def main() -> None:
    root = Path("tmp/calculation")
    out = {}
    for chapter in BOOKS["calculation"]["chapters"]:
        found = exercise_records(root, chapter)
        out[chapter] = [r["diagramNumber"] for r in found]
        print(chapter, len(found), dict(collections.Counter(r["masterPDFPage"] for r in found)))
    (root / "exercises.json").write_text(json.dumps(out), encoding="utf-8")


if __name__ == "__main__":
    main()
