#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

import book_board_parser as parser

_detect_boards = parser.detect_boards


def column_major_boards(image, minimum_edge):
    middle = image.shape[1] / 2
    squared = [parser.Rectangle(r.x, r.y, r.height, r.height) if r.width > r.height * 1.05 else r for r in _detect_boards(image, minimum_edge)]
    return sorted(squared, key=lambda r: (r.x + r.width / 2 > middle, r.y))


def side_turn_marker(image, board):
    left = board.x1 - round(board.width * 0.012)
    right = min(image.shape[1], board.x1 + round(board.width * 0.17))
    top = max(0, board.y - round(board.height * 0.05))
    bottom = min(image.shape[0], board.y1 + round(board.height * 0.05))
    region = image[top:bottom, left:right]
    if region.size == 0:
        return None, 0.0, "no region right of board"
    dark = (cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) < 160).astype(np.uint8) * 255
    contours, _ = cv2.findContours(dark, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    choices = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if not (board.width * 0.04 <= w <= board.width * 0.13 and board.width * 0.035 <= h <= board.width * 0.13):
            continue
        hull = cv2.convexHull(contour)
        hull_area = cv2.contourArea(hull)
        fill = hull_area / (w * h)
        if not 0.35 <= fill <= 0.68:
            continue
        mask = np.zeros(dark.shape, np.uint8)
        cv2.drawContours(mask, [hull], -1, 255, -1)
        shape = mask[y:y + h, x:x + w] > 0
        band = max(1, h // 4)
        upper = shape[:band].sum()
        lower = shape[-band:].sum()
        if lower > upper * 1.8:
            side = "w"
        elif upper > lower * 1.8:
            side = "b"
        else:
            continue
        choices.append((abs(fill - 0.5), side, (top + y + h / 2 - board.y) / board.height))
    if not choices:
        return None, 0.0, "no triangle right of board"
    _, side, _ = min(choices)
    return side, 0.9, "triangle orientation right of board"


parser.detect_boards = column_major_boards
parser.detect_turn = side_turn_marker

BOOKS: dict[str, dict] = {
    "calculation": {
        "pdf": "book-sources/Grandmaster Preparation Calculation - Jacob Aagaard.pdf",
        "chapters": {
            1: ("Candidate Moves", 16, 43),
            2: ("Combinational Vision", 44, 77),
            3: ("Prophylaxis", 78, 103),
            4: ("Comparison", 104, 123),
            5: ("Elimination", 124, 145),
            6: ("Intermediate Moves", 146, 163),
            7: ("Imagination", 164, 199),
            8: ("Traps", 200, 220),
            9: ("Tests", 221, 251),
            10: ("Difficult Positions", 252, 298),
        },
    },
    "thinking-inside-the-box": {
        "pdf": "book-sources/Grandmaster Preparation Thinking Inside the Box - Jacob Aagaard.pdf",
        "chapters": {
            1: ("Simple but Difficult", 28, 37),
            2: ("The Psychology of Chess Improvement", 38, 67),
            3: ("Who Are You?", 68, 85),
            4: ("Decision Making", 86, 111),
            5: ("Four Types of Decisions", 112, 137),
            6: ("Simple Decisions", 138, 155),
            7: ("What is Calculation?", 156, 165),
            8: ("The Calculation Process", 166, 213),
            9: ("Abstract Thinking", 214, 235),
            10: ("Strategic Concepts", 236, 261),
            11: ("Dynamic Strategic Concepts", 262, 287),
            12: ("Openings", 288, 319),
            13: ("Analyse Your Own Games", 320, 345),
            14: ("Training Methods", 346, 361),
        },
    },
}


def main() -> None:
    cli = argparse.ArgumentParser()
    cli.add_argument("book", choices=sorted(BOOKS))
    cli.add_argument("--chapters")
    cli.add_argument("--retry-errors", action="store_true")
    cli.add_argument("--detect-only", action="store_true")
    args = cli.parse_args()
    config = BOOKS[args.book]
    chapters = [int(c) for c in args.chapters.split(",")] if args.chapters else list(config["chapters"])
    for chapter in chapters:
        _, first, last = config["chapters"][chapter]
        output = Path("tmp") / args.book / f"chapter-{chapter}"
        current = argparse.Namespace(
            pdf=config["pdf"], chapter=chapter, first_master_page=first, last_master_page=last, output=str(output),
            book_page_offset=-1, diagram_start=1, dpi=200, minimum_board_edge=175, crop_margin=0.035,
            endpoint=parser.DEFAULT_ENDPOINT, delay_seconds=5.2, retry_errors=args.retry_errors,
        )
        candidates = output / "candidates.json"
        records = json.loads(candidates.read_text(encoding="utf-8")) if candidates.exists() else parser.build_candidates(current)
        parser.write_json(candidates, records)
        if args.detect_only:
            unknown = sum(r["sideToMove"] is None for r in records)
            print(f"chapter {chapter}: {len(records)} boards, {unknown} without a turn marker", flush=True)
            continue
        parser.recognize_records(records, current, output / "recognition-checkpoint.json")
        parser.write_json(output / "positions.json", {"chapter": chapter, "positions": records})
        print(f"chapter {chapter}: {len(records)} boards, {sum('piecePlacement' in r for r in records)} recognized", flush=True)


if __name__ == "__main__":
    main()
