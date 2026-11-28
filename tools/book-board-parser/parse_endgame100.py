#!/usr/bin/env python3
"""Parse 100 Endgame Patterns You Must Know (Jesus de la Villa): every diagram of each of the 100 patterns.

The PDF is an e-book: diagrams are embedded square images, so they are located from the PDF's own image objects
(no OpenCV). Pattern and chapter headings come from the text layer ("PATTERN n Title", "CHAPTER n" plus the
title line); full pattern titles come from the contents pages. Each diagram is cropped and read by ChessOCR
(5.2 s apart, checkpointed, resumable). The side to move comes from a "White/Black to move" phrase in the
pattern's text when there is one, otherwise it is left unknown. Nothing is hand-read and nothing is written to Neon.

    python parse_endgame100.py "book-sources/100 Endgame Patterns You Must Know - Jesus de la Villa.pdf" --output-root tmp/endgame100 [--detect-only]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as raw

import book_board_parser as parser

DPI = 200
CHAPTER_COUNT = 15


def page_lines(document, index: int) -> list[str]:
    return [line.strip() for line in document[index].get_textpage().get_text_range().replace("\r", "").split("\n")]


def structure(document) -> tuple[dict[int, tuple[int, str]], dict[int, tuple[int, str]]]:
    patterns: dict[int, tuple[int, str]] = {}
    chapters: dict[int, tuple[int, str]] = {}
    for index in range(30, len(document)):
        lines = page_lines(document, index)
        for position, line in enumerate(lines):
            match = re.match(r"PATTERN\s+(\d+)\s*(.*)$", line)
            if match and int(match.group(1)) not in patterns:
                patterns[int(match.group(1))] = (index + 1, match.group(2))
            match = re.match(r"CHAPTER\s+(\d+)\s*$", line)
            if match and int(match.group(1)) not in chapters:
                chapters[int(match.group(1))] = (index + 1, lines[position + 1] if position + 1 < len(lines) else "")
    return patterns, chapters


def contents_titles(document, chapter_titles: list[str]) -> list[str]:
    lines: list[str] = []
    for index in range(4, 9):
        lines += page_lines(document, index)
    skip = re.compile(r"^(Contents|OceanofPDF\.com|Chapter \d+|Pattern \d+|Introduction|)$")
    titles: list[str] = []
    expected = iter(chapter_titles)
    chapter = next(expected, None)
    started = False
    for line in lines:
        if skip.match(line):
            continue
        if chapter is not None and line == chapter:
            started = True
            chapter = next(expected, None)
            continue
        if started:
            if line in ("Exercises", "Solutions to the exercises"):
                break
            titles.append(line)
    return titles


def all_diagrams(document, first_page: int, last_page: int):
    found = []
    for page_number in range(first_page, last_page + 1):
        page = document[page_number - 1]
        boxes = []
        for obj in page.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE]):
            x0, y0, x1, y1 = obj.get_bounds()
            width, height = x1 - x0, y1 - y0
            if width >= 150 and 0.9 <= width / height <= 1.1:
                boxes.append((x0, y1 - width, x1, y1))
        boxes.sort(key=lambda b: (-round(b[3] / 20), b[0]))
        found += [(page_number, box) for box in boxes]
    return found


def side_hint(document, first_page: int, diagram_page: int) -> str | None:
    start = first_page if diagram_page == first_page else diagram_page
    text = " ".join(" ".join(page_lines(document, i)) for i in range(start - 1, diagram_page))
    match = re.search(r"\b(White|Black)\s+to\s+(?:move|play)\b", text)
    return {"White": "w", "Black": "b"}[match.group(1)] if match else None


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("pdf")
    cli.add_argument("--output-root", default="tmp/endgame100")
    cli.add_argument("--detect-only", action="store_true")
    cli.add_argument("--retry-errors", action="store_true")
    args = cli.parse_args()
    root = Path(args.output_root)
    document = pdfium.PdfDocument(args.pdf)
    patterns, chapters = structure(document)
    chapter_names = [chapters[n][1] for n in range(1, CHAPTER_COUNT + 2)]
    titles = contents_titles(document, chapter_names)
    if len(titles) != 100:
        print(f"warning: {len(titles)} contents titles, using the heading text where they do not line up")
    chapter_first = {n: chapters[n][0] for n in range(1, CHAPTER_COUNT + 1)}
    chapter_last = {n: chapters[n + 1][0] - 1 for n in range(1, CHAPTER_COUNT + 1)}
    structure_out = {"chapters": [{"number": n, "name": chapters[n][1], "firstPage": chapter_first[n], "lastPage": chapter_last[n]} for n in range(1, CHAPTER_COUNT + 1)], "patterns": []}
    records = []
    for number in range(1, 101):
        first, heading = patterns[number]
        last = (patterns[number + 1][0] - 1) if number < 100 else chapter_last[CHAPTER_COUNT]
        chapter = max(n for n in range(1, CHAPTER_COUNT + 1) if chapter_first[n] <= first)
        title = titles[number - 1] if len(titles) == 100 else heading
        diagrams = all_diagrams(document, first, max(first, last))
        entry = {"pattern": number, "chapter": chapter, "title": title, "firstPage": first, "diagramPages": [p for p, _ in diagrams]}
        structure_out["patterns"].append(entry)
        scale = DPI / 72
        margin = 6
        crop_dir = root / f"chapter-{chapter}" / "crops"
        crop_dir.mkdir(parents=True, exist_ok=True)
        for position, (page, box) in enumerate(diagrams, 1):
            x0, y0, x1, y1 = box
            height = document[page - 1].get_size()[1]
            image = document[page - 1].render(scale=scale, crop=(0, 0, 0, 0)).to_pil()
            crop = image.crop((round((x0 - margin) * scale), round((height - y1 - margin) * scale), round((x1 + margin) * scale), round((height - y0 + margin) * scale)))
            suffix = "" if position == 1 else f"-{position}"
            crop_path = crop_dir / f"pattern-{number:03d}{suffix}.png"
            crop.save(crop_path)
            records.append({
                "id": f"ch{chapter}-pattern-{number:03d}{suffix}", "chapter": chapter, "pattern": number, "position": position,
                "title": title, "masterPDFPage": first, "chapterPDFPage": first - chapter_first[chapter] + 1,
                "diagramPage": page, "moreInPattern": len(diagrams) > 1, "cropPath": str(crop_path), "sideToMove": side_hint(document, first, page),
            })
    parser.write_json(root / "structure.json", structure_out)
    print(f"{len(records)} diagrams found; {sum(r['sideToMove'] is not None for r in records)} have a side-to-move phrase")
    if args.detect_only:
        parser.write_json(root / "candidates.json", records)
        return
    namespace = argparse.Namespace(endpoint=parser.DEFAULT_ENDPOINT, delay_seconds=5.2, retry_errors=args.retry_errors)
    for chapter in range(1, CHAPTER_COUNT + 1):
        mine = [r for r in records if r["chapter"] == chapter]
        out = root / f"chapter-{chapter}"
        parser.recognize_records(mine, namespace, out / "recognition-checkpoint.json")
        parser.write_json(out / "positions.json", {"chapter": chapter, "positions": mine})
        print(f"chapter {chapter}: {len(mine)} patterns, {sum('piecePlacement' in r for r in mine)} recognized", flush=True)


if __name__ == "__main__":
    main()
