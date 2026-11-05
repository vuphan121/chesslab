#!/usr/bin/env python3
"""Offline commentary/move-tree extractor for scanned chess books.

The Positional Play PDF is a scan: no text layer, and the piece figurines are
dropped by plain OCR. This tool paints a letter over every figurine (matched to
templates in figurine_templates.npz), runs rapidocr, orders the lines by
column, splits the Solutions chapter into games, and builds a move tree per
game with python-chess so only legal moves are kept. Nothing is hand-read and
nothing is written to Neon.

    python commentary_parser.py book.pdf --first-page 180 --last-page 309 \
        --positions tmp/positional-play/chapter-5/positions.json --output tmp/positional-play/commentary
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import chess
import cv2
import numpy as np
import pypdfium2 as pdfium

import book_board_parser as boards

DPI = 300
RATIO = DPI / 200
TEMPLATES = Path(__file__).with_name("figurine_templates.npz")
HEADER = re.compile(r"^(\d{1,3})\.\s+([A-Z][^0-9]{2,60}?)\s+[-–—]{1,3}\s+([A-Z].{2,60})$")
JUNK = re.compile(r"^[\sa-hｅ8]{2,}$")


def load_templates() -> tuple[np.ndarray, np.ndarray]:
    data = np.load(TEMPLATES)
    return data["centers"], data["labels"]


def render(doc: Any, page: int) -> np.ndarray:
    return cv2.cvtColor(np.array(doc[page - 1].render(scale=DPI / 72).to_pil().convert("RGB")), cv2.COLOR_RGB2BGR)


def board_boxes(image: np.ndarray) -> list[tuple[int, int, int, int]]:
    small = cv2.resize(image, None, fx=1 / RATIO, fy=1 / RATIO)
    return [(int(r.x * RATIO), int(r.y * RATIO), int(r.x1 * RATIO), int(r.y1 * RATIO)) for r in boards.detect_boards(small, 175)]


def text_components(image: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int, np.ndarray]]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    bw = (gray < 150).astype(np.uint8)
    height = bw.shape[0]
    for x0, y0, x1, y1 in boxes:
        pad = int(0.12 * (x1 - x0))
        bw[max(0, y0 - pad // 2):y1 + pad, max(0, x0 - pad):x1 + pad // 2] = 0
    count, _, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    found = []
    for i in range(1, count):
        x, y, w, h, area = stats[i]
        if 20 <= h <= 75 and 8 <= w <= 70 and area > 40 and 140 < y < height - 140:
            found.append((x, y, w, h, cv2.resize(bw[y:y + h, x:x + w] * 255, (24, 24), interpolation=cv2.INTER_AREA)))
    return found


def paint_figurines(image: np.ndarray, boxes: list[tuple[int, int, int, int]], templates: tuple[np.ndarray, np.ndarray], max_distance: float) -> tuple[np.ndarray, int]:
    centers, labels = templates
    components = text_components(image, boxes)
    painted = image.copy()
    count = 0
    if not components:
        return painted, 0
    vectors = np.array([c[4].ravel() / 255 for c in components], dtype=np.float32)
    distances = ((vectors[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
    for (x, y, w, h, _), row in zip(components, distances):
        nearest = int(row.argmin())
        letter = str(labels[nearest])
        if letter and row[nearest] <= max_distance:
            count += 1
            cv2.rectangle(painted, (x - 1, y - 1), (x + w + 1, y + h + 1), (255, 255, 255), -1)
            cv2.putText(painted, letter, (x, y + h - int(h * 0.1)), cv2.FONT_HERSHEY_DUPLEX, h / 34, (0, 0, 0), 2)
    return painted, count


def read_page(doc: Any, page: int, ocr: Any, templates: tuple[np.ndarray, np.ndarray], max_distance: float) -> dict[str, Any]:
    image = render(doc, page)
    boxes = board_boxes(image)
    painted, figurines = paint_figurines(image, boxes, templates, max_distance)
    result, _ = ocr(painted)
    width = image.shape[1]
    lines = []
    for box, text, _confidence in result or []:
        x, y = float(box[0][0]), float(box[0][1])
        if 140 < y < image.shape[0] - 140:
            lines.append({"x": x, "y": y, "column": 0 if x < width * 0.5 else 1, "text": text})
    lines.sort(key=lambda line: (line["column"], line["y"]))
    return {"page": page, "lines": lines, "boards": boxes, "figurines": figurines, "width": width}


def normalize(text: str) -> str:
    text = text.replace("†", "+").replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    text = re.sub(r"\b([KQRBN]) (?=[a-hx1l])", r"\1", text)
    text = re.sub(r"(\d) \.", r"\1.", text)
    text = re.sub(r"(?<=\d)[lI](?=\.)", "1", text)
    return text


SAN = r"(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8l]?x?[a-h][1-8l](?:=[QRBN])?)"
WORD_MOVE = re.compile(r"(?:(\d+)(\.\.\.|\.))?(" + SAN + r")([+#]?)(!!|\?\?|!\?|\?!|!|\?)?([±∓]|=|\+-|-\+|t)?[.,;:]?")
SENTENCE_END = re.compile(r"[.!?:]$")


def tokenize(line: str) -> list[tuple]:
    tokens: list[tuple] = []
    for word in line.split():
        match = WORD_MOVE.fullmatch(word)
        if match and (match.group(1) or re.search(r"[KQRBN]|x|[a-h][1-8l]", match.group(3))):
            san = re.sub(r"(?<=[a-h])l", "1", match.group(3))
            tokens.append(("move", match.group(1), match.group(2), san, match.group(5) or "", match.group(6) or "", word))
            continue
        number = re.fullmatch(r"(\d+)(\.\.\.|\.)", word)
        tokens.append(("num", number.group(1), number.group(2)) if number else ("word", word))
    return tokens


@dataclass
class Node:
    fen: str
    parent: "Node | None" = None
    san: str | None = None
    annotation: str = ""
    before: str = ""
    after: str = ""
    main: bool = False
    children: list["Node"] = field(default_factory=list)


def ply_key(board: chess.Board) -> int:
    return board.fullmove_number * 2 + (0 if board.turn == chess.WHITE else 1)


def chain_main(node: Node) -> bool:
    while node.parent is not None:
        if not node.main:
            return False
        node = node.parent
    return True


def build_tree(text: str, start_fen: str) -> tuple[Node, dict[str, Any]]:
    root = Node(start_fen, main=True)
    by_ply: dict[int, list[Node]] = {ply_key(chess.Board(start_fen)): [root]}
    tokens: list[tuple] = []
    for line in text.split("\n"):
        line_tokens = tokenize(line)
        if line_tokens:
            line_tokens[0] = line_tokens[0] + (True,)
        tokens += line_tokens
    stats: dict[str, Any] = {"moves": 0, "failed": 0, "failedTokens": []}

    def attach(parent: Node, raw: str, annotation: str) -> Node | None:
        board = chess.Board(parent.fen)
        move = None
        for candidate in {raw, re.sub(r"^([KQRBN])(\d)", r"\1", raw), re.sub(r"^([KQRBN])[1-8]", r"\1", raw)}:
            try:
                move = board.parse_san(candidate)
                break
            except ValueError:
                continue
        if move is None:
            return None
        san = board.san(move)
        board.push(move)
        for child in parent.children:
            if child.san == san:
                return child
        node = Node(board.fen(), parent, san, annotation)
        parent.children.append(node)
        by_ply.setdefault(ply_key(board), []).append(node)
        return node

    words: list[str] = []
    last: Node | None = None
    pending: tuple[int, str] | None = None
    for token in tokens:
        starts = token[-1] is True
        if token[0] == "num":
            pending = (int(token[1]), token[2])
            continue
        if token[0] == "word":
            words.append(token[1])
            continue
        number, dots, san, mark, evaluation = token[1], token[2], token[3], token[4], token[5]
        if not number and (words or last is None) and pending is None:
            words.append(token[6])
            continue
        if number:
            pending = (int(number), dots)
        had_words = bool(words)
        lead_in = ""
        if words:
            cut = max((i for i, w in enumerate(words) if SENTENCE_END.search(w)), default=-1)
            earlier, lead_in = " ".join(words[:cut + 1]), " ".join(words[cut + 1:])
            if last is not None:
                last.after = (last.after + " " + earlier).strip()
            elif earlier:
                root.before = (root.before + " " + earlier).strip()
            words = []
        node: Node | None = None
        if pending is not None:
            moveno, marker = pending
            ply = moveno * 2 + (1 if marker == "..." else 0)
            candidates: list[Node] = []
            if last is not None and ply_key(chess.Board(last.fen)) == ply:
                candidates.append(last)
            rest = [n for n in reversed(by_ply.get(ply, [])) if n not in candidates]
            candidates += [n for n in rest if chain_main(n)] + [n for n in rest if not chain_main(n)]
            for parent in candidates:
                node = attach(parent, san, mark + evaluation)
                if node is not None:
                    has_main = any(o.main for o in parent.children if o is not node)
                    if (starts and not has_main) or (parent is last and last.main and not had_words and not has_main):
                        node.main = True
                    break
            pending = None
        elif last is not None:
            node = attach(last, san, mark + evaluation)
            if node is not None and last.main and not had_words:
                node.main = True
        stats["moves"] += 1
        if node is None:
            stats["failed"] += 1
            stats["failedTokens"].append(f"{number or ''}{dots or ''}{san}")
        else:
            node.before = (node.before + " " + lead_in).strip()
        last = node
    if words and last is not None:
        last.after = (last.after + " " + " ".join(words)).strip()

    def order(node: Node) -> None:
        node.children.sort(key=lambda c: 0 if c.main else 1)
        for child in node.children:
            order(child)

    order(root)
    return root, stats


def tree_json(node: Node) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if node.san:
        out["san"] = node.san
    for key in ("annotation", "before", "after"):
        value = getattr(node, key)
        if value:
            out[key] = value
    if node.children:
        out["children"] = [tree_json(c) for c in node.children]
    return out


def castling_rights(placement: str) -> str:
    rows = placement.split("/")

    def expand(row: str) -> str:
        return "".join("." * int(ch) if ch.isdigit() else ch for ch in row)

    back_white, back_black = expand(rows[7]), expand(rows[0])
    rights = ""
    if back_white[4] == "K":
        rights += ("K" if back_white[7] == "R" else "") + ("Q" if back_white[0] == "R" else "")
    if back_black[4] == "k":
        rights += ("k" if back_black[7] == "r" else "") + ("q" if back_black[0] == "r" else "")
    return rights or "-"


def placement_variants(placement: str) -> list[tuple[str, str]]:
    rows = [[ch for ch in ("".join("." * int(c) if c.isdigit() else c for c in row))] for row in placement.split("/")]

    def pack(grid: list[list[str]]) -> str:
        out = []
        for row in grid:
            text, empty = "", 0
            for ch in row:
                if ch == ".":
                    empty += 1
                else:
                    text += (str(empty) if empty else "") + ch
                    empty = 0
            out.append(text + (str(empty) if empty else ""))
        return "/".join(out)

    variants = []
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch == "." or ch in "kK":
                continue
            name = f"{ch}{'abcdefgh'[c]}{8 - r}"
            if ch in "pP" and r in (0, 7):
                continue
            for label, replacement in (("remove", "."), ("flip", ch.swapcase())):
                copy = [list(x) for x in rows]
                copy[r][c] = replacement
                variants.append((f"{label} {name}", pack(copy)))
    return variants


def repair_start(text: str, placement: str, turn: str, moveno: int, base_failed: int, rounds: int = 3) -> tuple[str, list[str], dict[str, Any]]:
    edits: list[str] = []
    best_placement, best_failed = placement, base_failed
    best_stats: dict[str, Any] = {}
    for _ in range(rounds):
        if best_failed == 0:
            break
        choice = None
        for label, candidate in placement_variants(best_placement):
            try:
                fen = f"{candidate} {turn} {castling_rights(candidate)} - 0 {moveno}"
                _, stats = build_tree(text, fen)
            except ValueError:
                continue
            if stats["failed"] < best_failed - 1 and (choice is None or stats["failed"] < choice[0]):
                choice = (stats["failed"], label, candidate, stats)
        if choice is None:
            break
        best_failed, label, best_placement, best_stats = choice
        edits.append(label)
    return best_placement, edits, best_stats


def first_move_side(text: str) -> tuple[str, int] | None:
    for line in text.split("\n"):
        for token in tokenize(line):
            if token[0] == "move" and token[1]:
                return ("b" if token[2] == "..." else "w", int(token[1]))
    return None


@dataclass
class Game:
    number: int
    players: str
    page: int
    column: int
    y: float
    lines: list[str] = field(default_factory=list)


def split_games(pages: list[dict[str, Any]], first: int = 1) -> list[Game]:
    games: list[Game] = []
    expected = first
    for page in pages:
        for line in page["lines"]:
            match = HEADER.match(line["text"].strip())
            if match and int(match.group(1)) == expected:
                games.append(Game(expected, f"{match.group(2)} - {match.group(3)}", page["page"], line["column"], line["y"]))
                expected += 1
                continue
            if games and not games[-1].lines and re.search(r"(?:1[89]|20)[0-9][0-9]", line["text"]) and len(line["text"]) < 60:
                continue
            if games and not JUNK.match(line["text"]):
                games[-1].lines.append(line["text"])
    return games


def start_board(game: Game, pages: dict[int, dict[str, Any]], positions: dict[int, list[dict[str, Any]]]) -> dict[str, Any] | None:
    page = pages[game.page]
    mid = page["width"] * 0.5
    below = [b for b in page["boards"] if b[1] > game.y and ((b[0] + b[2]) / 2 < mid) == (game.column == 0)]
    if not below:
        return None
    x0, y0, x1, y1 = min(below, key=lambda b: b[1])
    for record in positions.get(game.page, []):
        bx0, by0, bx1, by1 = record["bbox"]
        if abs(bx0 * RATIO - x0) < 25 and abs(by0 * RATIO - y0) < 25 and record.get("piecePlacement"):
            return record
    return None


def main() -> None:
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("pdf")
    cli.add_argument("--first-page", type=int, required=True)
    cli.add_argument("--last-page", type=int, required=True)
    cli.add_argument("--positions", required=True, help="positions.json from parse_positional_play.py for the same pages")
    cli.add_argument("--output", required=True)
    cli.add_argument("--repair", action="store_true", help="try small edits to the OCR start position that make more moves legal")
    cli.add_argument("--first-exercise", type=int, default=1)
    cli.add_argument("--max-distance", type=float, default=60.0)
    args = cli.parse_args()

    from rapidocr_onnxruntime import RapidOCR

    ocr, templates = RapidOCR(), load_templates()
    doc = pdfium.PdfDocument(args.pdf)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    cache = out / "pages.json"
    cached = {p["page"]: p for p in json.loads(cache.read_text(encoding="utf-8"))} if cache.exists() else {}
    pages = []
    for number in range(args.first_page, args.last_page + 1):
        if number not in cached:
            cached[number] = read_page(doc, number, ocr, templates, args.max_distance)
            cache.write_text(json.dumps(list(cached.values()), ensure_ascii=False), encoding="utf-8")
            print("ocr page", number, flush=True)
        pages.append(cached[number])
    positions: dict[int, list[dict[str, Any]]] = {}
    for record in json.loads(Path(args.positions).read_text(encoding="utf-8"))["positions"]:
        positions.setdefault(record["masterPDFPage"], []).append(record)
    page_map = {p["page"]: p for p in pages}
    results = []
    for game in split_games(pages, args.first_exercise):
        text = normalize("\n".join(game.lines))
        record = start_board(game, page_map, positions)
        placement = record["piecePlacement"] if record else None
        side = first_move_side(text)
        entry: dict[str, Any] = {"exercise": game.number, "players": game.players, "page": game.page}
        if placement is None or side is None:
            entry["error"] = "no start diagram" if placement is None else "no moves found"
            results.append(entry)
            continue
        turn, moveno = side
        root, stats = build_tree(text, f"{placement} {turn} {castling_rights(placement)} - 0 {moveno}")
        if stats["failed"] > 0 and args.repair:
            fixed, edits, _ = repair_start(text, placement, turn, moveno, stats["failed"])
            if edits:
                root, stats = build_tree(text, f"{fixed} {turn} {castling_rights(fixed)} - 0 {moveno}")
                entry["startRepairs"] = edits
        entry.update({"diagramNumber": record["diagramNumber"], "startFen": root.fen, "stats": stats, "line": tree_json(root)})
        results.append(entry)
    (out / "games.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    moves = sum(g.get("stats", {}).get("moves", 0) for g in results)
    failed = sum(g.get("stats", {}).get("failed", 0) for g in results)
    print(json.dumps({"games": len(results), "errors": sum("error" in g for g in results), "moves": moves, "failedMoves": failed}))


if __name__ == "__main__":
    main()
