#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pypdfium2 as pdfium

from exercises_aagaard import exercise_records
from parse_aagaard import BOOKS

TEST_PAGES = {3: 69, 4: 87, 5: 113, 6: 139, 8: 167, 9: 215, 10: 237, 11: 263, 12: 289, 13: 321, 14: 347}
NUMBERED_SETS = {6: 152}
SEE_PAGE = re.compile(r"p\s*a\s*g\s*e\s*s?\.?\s*(\d{2,3})", re.I)


def load_positions(root: Path, chapter: int) -> list[dict[str, Any]]:
    path = root / f"chapter-{chapter}" / "positions.json"
    return json.loads(path.read_text(encoding="utf-8"))["positions"]


def caption_references(root: Path, chapter: int, records: list[dict[str, Any]], ocr: Any) -> dict[int, int]:
    image = cv2.imread(str(root / f"chapter-{chapter}" / "pages" / f"master-{TEST_PAGES[chapter]:03d}.png"))
    found = {}
    for record in records:
        x0, y0, x1, y1 = record["bbox"]
        width = x1 - x0
        crop = image[y1 + round(width * 0.07):min(image.shape[0], y1 + round(width * 0.57)), max(0, x0 - round(width * 0.08)):x1 + round(width * 0.06)]
        if crop.size == 0:
            continue
        for scale in (3, 2, 4):
            result, _ = ocr(cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC))
            match = SEE_PAGE.search(" ".join(row[1] for row in result or []))
            if match:
                found[record["diagramNumber"]] = int(match.group(1))
                break
    return found


def numbered_solution_pages(chapter: int, total: int, report: list[str], ocr: Any) -> dict[int, int]:
    document = pdfium.PdfDocument(BOOKS["thinking-inside-the-box"]["pdf"])
    start = NUMBERED_SETS[chapter]
    last = BOOKS["thinking-inside-the-box"]["chapters"][chapter][2]
    found: dict[int, int] = {}
    for page in range(start + 1, last + 1):
        result, _ = ocr(cv2.cvtColor(np.array(document[page - 1].render(scale=220 / 72).to_pil().convert("RGB")), cv2.COLOR_RGB2BGR))
        for line in (row[1] for row in result or []):
            match = re.match(r"\s*(\d)\s*[.,]\s*[A-Z].*[-–—].*(?:19|20)\d", line)
            if match and int(match.group(1)) == len(found) + 1 <= total:
                found[len(found) + 1] = page
    if len(found) != total:
        report.append(f"chapter {chapter}: found {len(found)} of {total} numbered solution headings")
    return found


def item(record: dict[str, Any]) -> dict[str, Any]:
    return {key: record.get(key) for key in ("diagramNumber", "piecePlacement", "sideToMove", "bookPage", "masterPDFPage", "chapterPDFPage")}


def build_calculation(root: Path, report: list[str]) -> list[dict[str, Any]]:
    games_path = root / "commentary" / "games.json"
    games = {(g["chapter"], g["exercise"]): g for g in json.loads(games_path.read_text(encoding="utf-8"))}
    chapters = []
    for number, (name, first, _) in BOOKS["calculation"]["chapters"].items():
        exercises = {r["diagramNumber"]: index for index, r in enumerate(exercise_records(root, number), 1)}
        items, last_solution = [], None
        for record in load_positions(root, number):
            entry = item(record)
            index = exercises.get(record["diagramNumber"])
            if index:
                entry["exercise"] = index
                game = games.get((number, index), {})
                if "page" in game:
                    entry["solutionPage"] = last_solution = game["page"] - first + 1
                else:
                    entry["solutionPage"] = last_solution
                    report.append(f"chapter {number} exercise {index}: no solution heading found")
                for key in ("startFen", "stats", "line", "firstMover"):
                    if key in game:
                        entry[key] = game[key]
                if game.get("firstMover") and record["sideToMove"] and game["firstMover"] != record["sideToMove"]:
                    report.append(f"chapter {number} exercise {index}: marker says {record['sideToMove']}, solution starts with {game['firstMover']}")
            items.append(entry)
        chapters.append({"number": number, "name": name, "items": items})
    return chapters


def build_box(root: Path, report: list[str]) -> list[dict[str, Any]]:
    from rapidocr_onnxruntime import RapidOCR

    ocr = RapidOCR()
    chapters = []
    for number, (name, first, last) in BOOKS["thinking-inside-the-box"]["chapters"].items():
        records = load_positions(root, number)
        tests = [r for r in records if number in TEST_PAGES and r["masterPDFPage"] == TEST_PAGES[number] and r["sideToMove"]]
        references = caption_references(root, number, tests, ocr) if tests else {}
        numbered = {r["diagramNumber"]: index for index, r in enumerate((r for r in records if r["masterPDFPage"] == NUMBERED_SETS.get(number)), 1)}
        solutions = numbered_solution_pages(number, len(numbered), report, ocr) if numbered else {}
        items = []
        for record in records:
            entry = item(record)
            if any(record is test for test in tests):
                entry["test"] = True
                page = references.get(record["diagramNumber"])
                if page is not None and first <= page + 1 <= last:
                    entry["solutionPage"] = page + 1 - first + 1
                else:
                    report.append(f"chapter {number} diagram {record['diagramNumber']}: no usable page reference ({page})")
            if record["diagramNumber"] in numbered:
                entry["exercise"] = numbered[record["diagramNumber"]]
                if entry["exercise"] in solutions:
                    entry["solutionPage"] = solutions[entry["exercise"]] - first + 1
            items.append(entry)
        chapters.append({"number": number, "name": name, "items": items})
    return chapters


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("book", choices=sorted(BOOKS))
    args = cli.parse_args()
    root = Path("tmp") / args.book
    report: list[str] = []
    chapters = (build_calculation if args.book == "calculation" else build_box)(root, report)
    (root / "study.json").write_text(json.dumps({"chapters": chapters}, ensure_ascii=False), encoding="utf-8")
    (root / "build-report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    items = [i for c in chapters for i in c["items"]]
    print(f"{len(chapters)} chapters, {len(items)} diagrams, {sum('exercise' in i or 'test' in i for i in items)} puzzles, "
          f"{sum(bool(i.get('solutionPage')) for i in items)} with a solution page, {sum(not i['piecePlacement'] for i in items)} unrecognized, {len(report)} report lines")


if __name__ == "__main__":
    main()
