#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium

import commentary_parser as cp
from exercises_aagaard import exercise_records
from parse_aagaard import BOOKS

ROOT = Path("tmp/calculation")
HEADER = re.compile(r"^(\d{1,3})\s*[.,]\s*([A-Z][^0-9]{2,60}?)\s*[-–—]{1,3}\s*([A-Z].{2,80})$")
SKIP_AHEAD = 4


def join_rows(page: dict[str, Any]) -> list[str]:
    rows: list[list[dict[str, Any]]] = []
    for line in sorted(page["lines"], key=lambda item: item["y"]):
        if rows and abs(line["y"] - rows[-1][0]["y"]) < 20:
            rows[-1].append(line)
        else:
            rows.append([line])
    return [" ".join(part["text"] for part in sorted(row, key=lambda item: item["x"])) for row in rows]


def tidy_text(text: str) -> str:
    text = re.sub(r"(\d) ?(?:\. ?){2,}", r"\1...", text)
    text = cp.normalize(text)
    text = re.sub(r"((?:[a-h][1-8l](?:=[QRBN])?)|O-O(?:-O)?|=[QRBN])[t†]{1,2}(?![a-z])", r"\1+", text)
    text = re.sub(r"([+#!?])(?=\d{1,3}\.)", r"\1 ", text)
    return re.sub(r"([()\[\]])", r" \1 ", text)


def ocr_pages(pages: list[int], max_distance: float) -> dict[int, dict[str, Any]]:
    cache = ROOT / "commentary" / "pages.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cached = {p["page"]: p for p in json.loads(cache.read_text(encoding="utf-8"))} if cache.exists() else {}
    missing = [page for page in pages if page not in cached]
    if missing:
        from rapidocr_onnxruntime import RapidOCR

        ocr, templates, doc = RapidOCR(), cp.load_templates(), pdfium.PdfDocument(BOOKS["calculation"]["pdf"])
        for page in missing:
            cached[page] = cp.read_page(doc, page, ocr, templates, max_distance)
            cache.write_text(json.dumps(list(cached.values()), ensure_ascii=False), encoding="utf-8")
            print("ocr page", page, flush=True)
    return {page: cached[page] for page in pages}


def split_solutions(pages: dict[int, dict[str, Any]], total: int) -> dict[int, cp.Game]:
    games: dict[int, cp.Game] = {}
    current: cp.Game | None = None
    expected = 1
    for number in sorted(pages):
        rows = join_rows(pages[number])
        if len(pages[number]["boards"]) >= 3 and not any(HEADER.match(row.strip()) for row in rows):
            continue
        for row in rows:
            match = HEADER.match(row.strip())
            if match and expected <= int(match.group(1)) <= min(total, expected + SKIP_AHEAD):
                index = int(match.group(1))
                current = cp.Game(index, f"{match.group(2).strip()} - {match.group(3).strip()}", number, 0, 0)
                games[index] = current
                expected = index + 1
                continue
            if current is not None and not cp.JUNK.match(row):
                current.lines.append(row)
    return games


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("--chapters", default=",".join(str(c) for c in BOOKS["calculation"]["chapters"]))
    cli.add_argument("--repair", action="store_true")
    cli.add_argument("--max-distance", type=float, default=60.0)
    args = cli.parse_args()
    results = []
    for chapter in (int(c) for c in args.chapters.split(",")):
        _, _, last = BOOKS["calculation"]["chapters"][chapter]
        exercises = exercise_records(ROOT, chapter)
        positions_path = ROOT / f"chapter-{chapter}" / "positions.json"
        placements = {}
        if positions_path.exists():
            placements = {r["diagramNumber"]: r.get("piecePlacement") for r in json.loads(positions_path.read_text(encoding="utf-8"))["positions"]}
        pages = ocr_pages(list(range(exercises[0]["masterPDFPage"] + 1, last + 1)), args.max_distance)
        games = split_solutions(pages, len(exercises))
        for index, record in enumerate(exercises, 1):
            entry: dict[str, Any] = {"chapter": chapter, "exercise": index, "diagramNumber": record["diagramNumber"]}
            game = games.get(index)
            if game is None:
                entry["error"] = "no solution heading"
                results.append(entry)
                continue
            entry.update({"players": game.players, "page": game.page})
            text = tidy_text("\n".join(game.lines))
            side = cp.first_move_side(text)
            placement = placements.get(record["diagramNumber"])
            if side:
                entry["firstMover"] = side[0]
            if placement is None or side is None:
                entry["error"] = "no start diagram" if placement is None else "no moves found"
                results.append(entry)
                continue
            turn = record["sideToMove"] or side[0]
            moveno = side[1]
            try:
                root, stats = cp.build_tree(text, f"{placement} {turn} {cp.castling_rights(placement)} - 0 {moveno}", True)
                if stats["failed"] > 0 and args.repair:
                    fixed, edits, _ = cp.repair_start(text, placement, turn, moveno, stats["failed"], brackets=True)
                    if edits:
                        root, stats = cp.build_tree(text, f"{fixed} {turn} {cp.castling_rights(fixed)} - 0 {moveno}", True)
                        entry["startRepairs"] = edits
            except ValueError as error:
                entry["error"] = str(error)
                results.append(entry)
                continue
            entry.update({"startFen": root.fen, "stats": stats, "line": cp.tree_json(root)})
            results.append(entry)
        found = sum(1 for r in results if r["chapter"] == chapter and "page" in r)
        print(f"chapter {chapter}: {len(exercises)} exercises, {found} solution headings", flush=True)
    (ROOT / "commentary" / "games.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    moves = sum(g.get("stats", {}).get("moves", 0) for g in results)
    failed = sum(g.get("stats", {}).get("failed", 0) for g in results)
    clean = sum(1 for g in results if g.get("stats", {}).get("moves") and g["stats"]["failed"] <= 0.1 * g["stats"]["moves"])
    print(json.dumps({"exercises": len(results), "errors": sum("error" in g for g in results), "moves": moves, "failedMoves": failed, "cleanLines": clean}))


if __name__ == "__main__":
    main()
