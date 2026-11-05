#!/usr/bin/env python3
"""Parse Grandmaster Preparation - Positional Play, chapter by chapter.

Resumable offline batch runner built on book_board_parser. Master PDF page =
printed page + 1. Boards are located with OpenCV and read by ChessOCR; nothing
is hand-read and nothing is written to Neon.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import book_board_parser as parser

CHAPTERS: dict[int, tuple[str, int, int]] = {
    0: ("Introduction", 12, 23),
    1: ("Weaknesses", 24, 71),
    2: ("Pieces", 72, 119),
    3: ("Prophylaxis", 120, 153),
    4: ("Exercises", 154, 177),
    5: ("Solutions", 178, 309),
}


def chapter_args(args: argparse.Namespace, chapter: int, first: int, last: int, recognize: bool) -> argparse.Namespace:
    return argparse.Namespace(
        pdf=args.pdf, chapter=chapter, first_master_page=first, last_master_page=last,
        output=str(Path(args.output_root) / f"chapter-{chapter}"),
        book_page_offset=-1, diagram_start=1, dpi=200, minimum_board_edge=175, crop_margin=0.035,
        recognize=recognize, endpoint=parser.DEFAULT_ENDPOINT, delay_seconds=5.2, retry_errors=args.retry_errors,
        validate_api=None, validate_book_id="positional-play", env_file="backend/.env",
    )


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("pdf")
    cli.add_argument("--output-root", default="tmp/positional-play")
    cli.add_argument("--chapters", default="0,1,2,3,4,5")
    cli.add_argument("--retry-errors", action="store_true")
    args = cli.parse_args()
    for chapter in (int(c) for c in args.chapters.split(",")):
        _, first, last = CHAPTERS[chapter]
        current = chapter_args(args, chapter, first, last, True)
        output = Path(current.output)
        candidates = output / "candidates.json"
        records = json.loads(candidates.read_text(encoding="utf-8")) if candidates.exists() else parser.build_candidates(current)
        parser.write_json(candidates, records)
        parser.recognize_records(records, current, output / "recognition-checkpoint.json")
        parser.write_json(output / "positions.json", {"chapter": chapter, "positions": records})
        print(f"chapter {chapter}: {len(records)} boards, {sum('piecePlacement' in r for r in records)} recognized", flush=True)


if __name__ == "__main__":
    main()
