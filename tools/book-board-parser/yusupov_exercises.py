#!/usr/bin/env python3
from __future__ import annotations

import collections
import json
import re
from pathlib import Path

import cv2
import numpy as np
import pypdfium2 as pdfium
from rapidocr_onnxruntime import RapidOCR

PDF = "book-sources/Build Up Your Chess 1 The Fundamentals - Artur Yusupov.pdf"
ROOT = Path("tools/book-board-parser/work/build-up-your-chess-1")
OUTPUT = Path("tmp/yusupov")
LABEL = r"E\s*[xz]\s*[.,]?\s*{chapter}\s*[-–—~]\s*(\d{{1,2}})(?!\d)"


def column_major(boards: list[dict]) -> list[dict]:
    middle = (min(b["bbox"][0] for b in boards) + max(b["bbox"][0] for b in boards)) / 2
    return sorted(boards, key=lambda b: (b["bbox"][0] > middle, b["bbox"][1]))


def printed_label(ocr: RapidOCR, page: np.ndarray, bbox: list[int], chapter: int) -> int | None:
    x0, y0, x1, _ = bbox
    width = x1 - x0
    crop = page[max(0, y0 - round(width * 0.2)):y0, max(0, x0 - round(width * 0.1)):x0 + round(width * 0.6)]
    for scale in (3, 2, 4):
        result, _ = ocr(cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC))
        match = re.search(LABEL.format(chapter=chapter), " ".join(row[1] for row in result or []))
        if match:
            return int(match.group(1))
    return None


def solution_pages(ocr: RapidOCR, document, chapter: int, first_master: int, after: int) -> dict[int, int]:
    pattern = re.compile(r"(?m)^\W{0,3}" + LABEL.format(chapter=chapter))
    found: dict[int, int] = {}
    pages = []
    for page in range(after + 1, after + 5):
        master = first_master + page - 1
        if master > len(document):
            break
        text = document[master - 1].get_textpage().get_text_range()
        if "Scoring" in text[:300]:
            break
        pages.append(page)
        for match in pattern.finditer(text):
            if 1 <= int(match.group(1)) <= 12:
                found.setdefault(int(match.group(1)), page)
    if len(found) < 12:
        for page in pages:
            image = cv2.cvtColor(np.array(document[first_master + page - 2].render(scale=220 / 72).to_pil().convert("RGB")), cv2.COLOR_RGB2BGR)
            result, _ = ocr(image)
            for row in result or []:
                match = pattern.search(row[1])
                if match and 1 <= int(match.group(1)) <= 12:
                    found.setdefault(int(match.group(1)), page)
    return found


def main() -> None:
    ocr = RapidOCR()
    document = pdfium.PdfDocument(PDF)
    chapters, problems = [], []
    confirmed = unread = 0
    for chapter in range(3, 25):
        positions = json.loads((ROOT / f"chapter-{chapter}" / "positions.json").read_text(encoding="utf-8"))["positions"]
        counts = collections.Counter(p["chapterPDFPage"] for p in positions)
        exercise_pages = sorted(page for page, count in counts.items() if count == 6)
        if len(exercise_pages) != 2 or exercise_pages[1] != exercise_pages[0] + 1:
            raise SystemExit(f"chapter {chapter}: unexpected exercise pages {exercise_pages}")
        first_master = positions[0]["masterPDFPage"] - positions[0]["chapterPDFPage"] + 1
        ordered = [b for page in exercise_pages for b in column_major([p for p in positions if p["chapterPDFPage"] == page])]
        solutions = solution_pages(ocr, document, chapter, first_master, exercise_pages[1])
        exercises, previous = [], exercise_pages[1] + 1
        for number, board in enumerate(ordered, 1):
            image = cv2.imread(str(ROOT / f"chapter-{chapter}" / "pages" / f"master-{board['masterPDFPage']:03d}.png"))
            label = printed_label(ocr, image, board["bbox"], chapter)
            if label is None:
                unread += 1
            elif label == number:
                confirmed += 1
            else:
                problems.append(f"chapter {chapter}: position {number} is labelled {label}")
            if number not in solutions:
                problems.append(f"chapter {chapter} exercise {number}: no solution heading, using page {previous}")
            previous = solutions.get(number, previous)
            exercises.append({"itemId": f"buyc1-ch{chapter}-diagram-{board['diagramNumber']}", "number": number, "solutionPage": previous})
        if [e["solutionPage"] for e in exercises] != sorted(e["solutionPage"] for e in exercises):
            problems.append(f"chapter {chapter}: solution pages are out of order {[e['solutionPage'] for e in exercises]}")
        chapters.append({"chapter": chapter, "exercises": exercises})
        print(f"chapter {chapter}: pages {exercise_pages}, solutions {[e['solutionPage'] for e in exercises]}", flush=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "exercises.json").write_text(json.dumps(chapters, indent=1), encoding="utf-8")
    print(f"labels confirmed {confirmed}, unread {unread}")
    print("\n".join(problems) or "no problems")


if __name__ == "__main__":
    main()
