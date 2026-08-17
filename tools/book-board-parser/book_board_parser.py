#!/usr/bin/env python3
"""Offline chess-book diagram parser.

Renders a bounded chapter page range, locates diagram boards, reads each board
through ChessOCR at a deliberately slow pace, detects the turn marker, and
writes only structured chess facts plus page metadata. It is an admin tool,
not part of the running web application.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import pdfplumber
import pypdfium2 as pdfium


DEFAULT_ENDPOINT = "https://helpman.komtera.lt/predict"
DIAGRAM_RE = re.compile(r"diagram\s*(\d+)\s*[-–—]\s*(\d+)", re.IGNORECASE)
VALID_PIECES = set("prnbqkPRNBQK")


@dataclass(frozen=True)
class Rectangle:
    x: int
    y: int
    width: int
    height: int

    @property
    def x1(self) -> int:
        return self.x + self.width

    @property
    def y1(self) -> int:
        return self.y + self.height

    @property
    def area(self) -> int:
        return self.width * self.height


@dataclass(frozen=True)
class DiagramLabel:
    chapter: int
    number: int
    x: int
    y: int


def parse_piece_placement(value: str) -> str:
    """Validate and return ChessOCR's eight-rank piece-placement field."""
    ranks = value.strip().split("/")
    if len(ranks) != 8:
        raise ValueError("piece placement must have eight ranks")
    for rank in ranks:
        squares = 0
        for char in rank:
            if char in VALID_PIECES:
                squares += 1
            elif char in "12345678":
                squares += int(char)
            else:
                raise ValueError(f"invalid piece-placement character {char!r}")
        if squares != 8:
            raise ValueError(f"rank {rank!r} has {squares}, not eight, squares")
    if value.count("K") != 1 or value.count("k") != 1:
        raise ValueError("piece placement must contain one king of each color")
    return value.strip()


def overlaps(first: Rectangle, second: Rectangle) -> bool:
    overlap_x = max(0, min(first.x1, second.x1) - max(first.x, second.x))
    overlap_y = max(0, min(first.y1, second.y1) - max(first.y, second.y))
    return overlap_x * overlap_y > min(first.area, second.area) * 0.35


def detect_boards(image: Any, minimum_edge: int) -> list[Rectangle]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[Rectangle] = []
    for contour in contours:
        x, y, width, height = cv2.boundingRect(contour)
        if min(width, height) < minimum_edge or not 0.88 <= width / height <= 1.12:
            continue
        candidates.append(Rectangle(x, y, width, height))
    boards: list[Rectangle] = []
    for candidate in sorted(candidates, key=lambda rect: rect.area, reverse=True):
        if not any(overlaps(candidate, existing) for existing in boards):
            boards.append(candidate)
    return sorted(boards, key=lambda rect: (rect.y, rect.x))


def detect_turn(image: Any, board: Rectangle) -> tuple[str | None, float, str]:
    """Read the outlined triangular turn marker above a board.

    In this book it sits just above the upper-right board corner. Restricting
    the search to that location prevents title lettering from being mistaken
    for a triangle.
    """
    x0, y0, x1 = board.x, board.y, board.x1
    height = board.height
    top = max(0, y0 - round(height * 0.28))
    left = max(0, x0 - round(height * 0.12))
    right = min(image.shape[1], x1 + round(height * 0.12))
    region = image[top:y0, left:right]
    if region.size == 0:
        return None, 0.0, "no region above board"
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 140)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    choices: list[tuple[float, str]] = []
    board_area = board.width * board.height
    marker_x = x1 - board.width * 0.045
    for contour in contours:
        area = cv2.contourArea(contour)
        if not board_area * 0.00003 <= area <= board_area * 0.04:
            continue
        perimeter = cv2.arcLength(contour, True)
        vertices = cv2.approxPolyDP(contour, 0.045 * perimeter, True)
        if len(vertices) != 3:
            continue
        moments = cv2.moments(contour)
        if not moments["m00"]:
            continue
        cx = moments["m10"] / moments["m00"]
        marker_distance = abs((left + cx) - marker_x) / max(1, board.width)
        if marker_distance > 0.16:
            continue
        points = vertices.reshape(-1, 2)
        ys = points[:, 1]
        span = int(ys.max() - ys.min())
        if span < 8:
            continue
        top_count = sum(int(y <= ys.min() + span * 0.28) for y in ys)
        bottom_count = sum(int(y >= ys.max() - span * 0.28) for y in ys)
        if top_count == 1 and bottom_count >= 2:
            side = "w"
        elif bottom_count == 1 and top_count >= 2:
            side = "b"
        else:
            continue
        confidence = 0.35 + min(1.0, area / max(1, board_area * 0.001)) * 0.35 - marker_distance * 0.2
        choices.append((confidence, side))
    if not choices:
        return None, 0.0, "no triangular turn marker above board"
    confidence, side = max(choices, key=lambda pair: pair[0])
    if confidence < 0.4:
        return None, round(confidence, 2), "triangle shape below review threshold"
    return side, round(min(0.95, confidence), 2), "triangle orientation above board"


def extract_diagram_labels(pdf_path: Path, first_page: int, last_page: int, dpi: int) -> dict[int, list[DiagramLabel]]:
    labels: dict[int, list[DiagramLabel]] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for master_page in range(first_page, last_page + 1):
            text = pdf.pages[master_page - 1].extract_text() or ""
            matches = list(DIAGRAM_RE.finditer(text))
            labels[master_page] = [
                DiagramLabel(int(match.group(1)), int(match.group(2)), 0, index * round(18 * dpi / 72))
                for index, match in enumerate(matches)
            ]
    return labels


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def build_candidates(args: argparse.Namespace) -> list[dict[str, Any]]:
    output = Path(args.output)
    pages_dir = output / "pages"
    crops_dir = output / "crops"
    labels_by_page = extract_diagram_labels(Path(args.pdf), args.first_master_page, args.last_master_page, args.dpi)
    document = pdfium.PdfDocument(args.pdf)
    records: list[dict[str, Any]] = []
    next_diagram_number = args.diagram_start
    for master_page in range(args.first_master_page, args.last_master_page + 1):
        page_path = pages_dir / f"master-{master_page:03d}.png"
        pages_dir.mkdir(parents=True, exist_ok=True)
        document[master_page - 1].render(scale=args.dpi / 72).to_pil().save(page_path)
        image = cv2.imread(str(page_path))
        boards = detect_boards(image, args.minimum_board_edge)
        page_labels = [label for label in labels_by_page[master_page] if label.chapter == args.chapter]
        for index, board in enumerate(boards, 1):
            margin = round(min(board.width, board.height) * args.crop_margin)
            crop = image[max(0, board.y - margin):min(image.shape[0], board.y1 + margin), max(0, board.x - margin):min(image.shape[1], board.x1 + margin)]
            crops_dir.mkdir(parents=True, exist_ok=True)
            crop_path = crops_dir / f"ch{args.chapter}-master-{master_page:03d}-{index:02d}.png"
            cv2.imwrite(str(crop_path), crop)
            side, confidence, reason = detect_turn(image, board)
            # Decorative caption glyphs lose their text mapping in later pages.
            # This book numbers every diagram consecutively within a chapter, so
            # visual document order remains a durable source for its number.
            diagram_number = next_diagram_number
            next_diagram_number += 1
            caption = next((f"{label.chapter}-{label.number}" for label in page_labels if label.number == diagram_number), None)
            records.append({
                "id": f"ch{args.chapter}-p{master_page:03d}-{index:02d}",
                "chapter": args.chapter,
                "diagram": f"{args.chapter}-{diagram_number}",
                "diagramNumber": diagram_number,
                "diagramNumberSource": "sequential chapter order",
                "embeddedDiagramCaption": caption,
                "bookPage": master_page + args.book_page_offset,
                "masterPDFPage": master_page,
                "chapterPDFPage": master_page - args.first_master_page + 1,
                "bbox": [board.x, board.y, board.x1, board.y1],
                "cropPath": str(crop_path),
                "sideToMove": side,
                "turnConfidence": confidence,
                "turnDetection": reason,
            })
    return records


def recognize_crop(image_path: Path, endpoint: str) -> str:
    boundary = "----chesslabboardparser"
    mime = mimetypes.guess_type(image_path.name)[0] or "image/png"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{image_path.name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + image_path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(endpoint, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read())
    rows = payload.get("results") or []
    if not rows or not rows[0].get("fen"):
        raise ValueError("ChessOCR response omitted results[0].fen")
    return parse_piece_placement(str(rows[0]["fen"]))


def recognize_records(records: list[dict[str, Any]], args: argparse.Namespace, checkpoint: Path) -> None:
    existing = json.loads(checkpoint.read_text(encoding="utf-8")) if checkpoint.exists() else {}
    for index, record in enumerate(records, 1):
        identifier = record["id"]
        old = existing.get(identifier)
        if old and ("piecePlacement" in old or ("error" in old and not args.retry_errors)):
            record.update(old)
            continue
        try:
            record["piecePlacement"] = recognize_crop(Path(record["cropPath"]), args.endpoint)
            record["recognitionStatus"] = "ok"
        except Exception as error:  # checkpoint failures for deliberate retry later
            record["error"] = str(error)
            record["recognitionStatus"] = "error"
        existing[identifier] = {key: record[key] for key in ("piecePlacement", "recognitionStatus", "error") if key in record}
        write_json(checkpoint, existing)
        if index < len(records):
            time.sleep(args.delay_seconds)


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def api_book(api_url: str, book_id: str, env_file: Path) -> dict[str, Any]:
    load_env(env_file)
    credentials = json.dumps({"username": os.environ["AUTH_USERNAME"], "password": os.environ["AUTH_PASSWORD"]}).encode()
    request = urllib.request.Request(api_url.rstrip("/") + "/api/auth/login", credentials, {"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        token = json.loads(response.read())["token"]
    request = urllib.request.Request(api_url.rstrip("/") + f"/api/books/{book_id}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def validate(records: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, Any] | None:
    if not args.validate_api:
        return None
    book = api_book(args.validate_api, args.validate_book_id, Path(args.env_file))
    chapter = next(item for item in book["chapters"] if item["number"] == args.chapter)
    by_placement = {record.get("piecePlacement"): record for record in records if record.get("piecePlacement")}
    matched = side_matches = side_unknown = side_mismatches = 0
    for item in chapter["items"]:
        record = by_placement.get(item["fen"].split()[0])
        if not record:
            continue
        matched += 1
        detected = record.get("sideToMove")
        if detected is None:
            side_unknown += 1
        elif detected == item["sideToMove"]:
            side_matches += 1
        else:
            side_mismatches += 1
    return {
        "detectedBoards": len(records),
        "recognizedBoards": sum(record.get("recognitionStatus") == "ok" for record in records),
        "unmatchedDetectedBoards": len(records) - matched,
        "expectedItems": len(chapter["items"]), "matchedPiecePlacements": matched,
        "unmatchedExpectedItems": len(chapter["items"]) - matched,
        "turnMatches": side_matches, "turnUnknown": side_unknown, "turnMismatches": side_mismatches,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--chapter", required=True, type=int)
    parser.add_argument("--first-master-page", required=True, type=int)
    parser.add_argument("--last-master-page", required=True, type=int)
    parser.add_argument("--output", required=True)
    parser.add_argument("--book-page-offset", type=int, default=2)
    parser.add_argument("--diagram-start", type=int, default=1)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--minimum-board-edge", type=int, default=175)
    parser.add_argument("--crop-margin", type=float, default=0.035)
    parser.add_argument("--recognize", action="store_true")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--delay-seconds", type=float, default=5.2)
    parser.add_argument("--retry-errors", action="store_true")
    parser.add_argument("--validate-api")
    parser.add_argument("--validate-book-id", default="build-up-your-chess-1")
    parser.add_argument("--env-file", default="backend/.env")
    args = parser.parse_args()
    if args.delay_seconds < 5:
        parser.error("--delay-seconds must be at least 5 to respect the ChessOCR rate limit")
    if args.diagram_start < 1:
        parser.error("--diagram-start must be at least 1")
    output = Path(args.output)
    candidates_path = output / "candidates.json"
    records = json.loads(candidates_path.read_text(encoding="utf-8")) if candidates_path.exists() else build_candidates(args)
    write_json(candidates_path, records)
    if args.recognize:
        recognize_records(records, args, output / "recognition-checkpoint.json")
    report = validate(records, args)
    payload = {"chapter": args.chapter, "positions": records}
    if report:
        payload["validation"] = report
    write_json(output / "positions.json", payload)
    print(json.dumps({"positions": len(records), "recognized": sum("piecePlacement" in item for item in records), "validation": report}, indent=2))


if __name__ == "__main__":
    main()
