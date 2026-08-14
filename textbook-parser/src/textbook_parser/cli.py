from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .matcher import match_positions
from .models import Position, TextBlock


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def render(args: argparse.Namespace) -> None:
    import pypdfium2 as pdfium

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(args.pdf)
    for page_number in range(args.first_page, args.last_page + 1):
        page = document[page_number - 1]
        image = page.render(scale=args.dpi / 72).to_pil()
        image.save(output / f"page_{page_number:03d}.png")


def extract_text(args: argparse.Namespace) -> None:
    import pdfplumber

    blocks: list[dict] = []
    with pdfplumber.open(args.pdf) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            words = page.extract_words(use_text_flow=True, keep_blank_chars=False)
            # Text is grouped into visual lines. Label matching on individual
            # words would split "Solution" from "12:" and cannot work.
            rows: list[list[dict]] = []
            for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
                if rows and abs(rows[-1][0]["top"] - word["top"]) <= 3:
                    rows[-1].append(word)
                else:
                    rows.append([word])
            active_section = "study"
            line_number = 0
            for row in rows:
                from .labels import section_from_text

                # A textbook page often has a diagram at left and prose at
                # right on exactly the same baseline. Retaining that as one
                # "line" corrupts both labels and spatial matching. A 36pt
                # gap is safely larger than normal word spacing in this PDF.
                segments: list[list[dict]] = [[]]
                previous_x1: float | None = None
                for word in sorted(row, key=lambda item: item["x0"]):
                    if previous_x1 is not None and word["x0"] - previous_x1 > 36:
                        segments.append([])
                    segments[-1].append(word)
                    previous_x1 = word["x1"]
                for segment in segments:
                    if not segment:
                        continue
                    line_number += 1
                    text = " ".join(word["text"] for word in segment)
                    section = section_from_text(text)
                    if section:
                        active_section = section
                    blocks.append({
                        "id": f"p{page_number:03d}-t{line_number:04d}", "page": page_number,
                        "text": text, "section": active_section,
                        "bbox": [
                            min(word["x0"] for word in segment) * args.dpi / 72,
                            min(word["top"] for word in segment) * args.dpi / 72,
                            max(word["x1"] for word in segment) * args.dpi / 72,
                            max(word["bottom"] for word in segment) * args.dpi / 72,
                        ],
                    })
    _write_json(Path(args.output), blocks)
    print(f"wrote {len(blocks)} positioned text lines")


def ocr_text(args: argparse.Namespace) -> None:
    from .ocr_text import ocr_pages

    counts = ocr_pages(args.pages, args.output, args.tesseract, args.psm)
    print(f"OCR preserved {counts['blocks']} text line(s) from {counts['pages']} page(s)")


def text_review_report(args: argparse.Namespace) -> None:
    from .text_review import build_text_review_report

    count = build_text_review_report(args.ocr, args.pages, args.output, args.decisions)
    print(f"wrote text OCR QA report with {count} line(s) to {args.output}")


def export_notation_labels(args: argparse.Namespace) -> None:
    import importlib.util

    model_path = Path(__file__).parents[2] / "ml-model" / "src" / "notation_model.py"
    spec = importlib.util.spec_from_file_location("textbook_parser_ml_notation_model", model_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"could not load local model module: {model_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    counts = module.export_notation_dataset(args.decisions, args.crops, args.output, args.validation_fraction)
    print(f"exported {counts['examples']} chess-notation label(s): {counts['train']} train, {counts['validation']} validation")


def detect_boards(args: argparse.Namespace) -> None:
    import cv2
    from .board_detector import Rectangle, keep_complete_boards, merge_board_fragments

    records: list[dict] = []
    crops = Path(args.crops) if args.crops else Path(args.output).parent / "crops"
    crops.mkdir(parents=True, exist_ok=True)
    for image_path in sorted(Path(args.pages).glob("page_*.png")):
        page = int(image_path.stem.split("_")[1])
        image = cv2.imread(str(image_path))
        if image is None:
            continue
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        raw_candidates: list[Rectangle] = []
        for contour in contours:
            x, y, width, height = cv2.boundingRect(contour)
            if min(width, height) < args.min_size or not 0.86 <= width / height <= 1.14:
                continue
            raw_candidates.append(Rectangle(x, y, width, height))
        candidates = keep_complete_boards(merge_board_fragments(raw_candidates), args.min_board_size)
        for index, candidate in enumerate(candidates[:args.max_per_page], 1):
            x, y, width, height = candidate.x, candidate.y, candidate.width, candidate.height
            margin = round(height * args.crop_margin)
            crop = image[max(0, y - margin):min(image.shape[0], y + height + margin), max(0, x - margin):min(image.shape[1], x + width + margin)]
            crop_path = crops / f"p{page:03d}-{index:02d}.png"
            cv2.imwrite(str(crop_path), crop)
            records.append({
                "id": f"p{page:03d}-{index:02d}", "page": page,
                "bbox": [x, y, x + width, y + height], "kind": "study",
                "cropPath": str(crop_path), "confidence": 0.25,
            })
    _write_json(Path(args.output), records)
    print(f"wrote {len(records)} board candidates; review before recognition")


def classify_turn(args: argparse.Namespace) -> None:
    import cv2
    from .vision import detect_turn

    records = json.loads(Path(args.boards).read_text(encoding="utf-8"))
    for record in records:
        image = cv2.imread(str(Path(args.pages) / f"page_{int(record['page']):03d}.png"))
        if image is None:
            record["sideToMove"] = None
            record["turnDetection"] = "page image missing"
            continue
        result = detect_turn(image, tuple(map(int, record["bbox"])))
        record["sideToMove"] = result.side_to_move
        record["turnConfidence"] = result.confidence
        record["turnDetection"] = result.reason
    _write_json(Path(args.output), records)
    print(f"wrote turn classifications for {len(records)} diagrams")


def match(args: argparse.Namespace) -> None:
    positions = [Position.from_json(value) for value in json.loads(Path(args.positions).read_text(encoding="utf-8"))]
    blocks = [TextBlock.from_json(value) for value in json.loads(Path(args.layout).read_text(encoding="utf-8"))]
    links = match_positions(positions, blocks)
    _write_json(Path(args.output), [link.__dict__ for link in links])
    print(f"wrote {len(links)} links")


def read_boards(args: argparse.Namespace) -> None:
    from .providers import read_with_chessocr

    records = json.loads(Path(args.positions).read_text(encoding="utf-8"))
    for record in records:
        crop = record.get("cropPath")
        if not crop:
            record["boardReadError"] = "no cropPath"
            continue
        try:
            record["piecePlacement"] = read_with_chessocr(crop, args.endpoint)
        except Exception as error:  # continue building a review queue
            record["boardReadError"] = str(error)
    _write_json(Path(args.output), records)
    print(f"wrote ChessOCR results for {len(records)} diagrams")


def _pending_recognitions(records: list[dict], results: dict, retry_errors: bool) -> list[dict]:
    if retry_errors:
        return [record for record in records if record["id"] in results and not isinstance(results[record["id"]], str)]
    return [record for record in records if record["id"] not in results]


def recognize_boards(args: argparse.Namespace) -> None:
    """Recognize board crops slowly and checkpoint after every API request."""
    from .providers import read_with_chessocr

    records = json.loads(Path(args.positions).read_text(encoding="utf-8"))
    output = Path(args.output)
    results = _load_existing_json(output)
    pending = _pending_recognitions(records, results, args.retry_errors)
    for index, record in enumerate(pending, 1):
        identifier = record["id"]
        try:
            results[identifier] = read_with_chessocr(record["cropPath"], args.endpoint)
            print(f"{index}/{len(pending)} {identifier}: ok", flush=True)
        except Exception as error:
            results[identifier] = {"error": str(error)}
            print(f"{index}/{len(pending)} {identifier}: {error}", flush=True)
        _write_json(output, results)
        if index < len(pending) and args.delay_seconds:
            time.sleep(args.delay_seconds)
    complete = sum(isinstance(results.get(record["id"]), str) for record in records)
    print(f"recognized {complete}/{len(records)} boards; checkpoint: {output}")


def _load_existing_json(path: Path) -> dict:
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"recognition checkpoint must be a JSON object: {path}")
    return value


def review_with_ollama(args: argparse.Namespace) -> None:
    from .providers import ollama_review

    result = ollama_review(args.image, args.model, args.prompt, args.base_url)
    _write_json(Path(args.output), result)
    print(f"wrote local Ollama review to {args.output}")


def extract_sans(args: argparse.Namespace) -> None:
    from .san import extract_candidates

    blocks = {block.id: block for block in (TextBlock.from_json(value) for value in json.loads(Path(args.layout).read_text(encoding="utf-8")))}
    links = json.loads(Path(args.links).read_text(encoding="utf-8"))
    output = []
    for link in links:
        if link["status"] != "linked":
            continue
        ids = link.get("text_block_ids") or link.get("textBlockIds") or []
        source = [blocks[block_id] for block_id in ids if block_id in blocks]
        text = "\n".join(block.text for block in source)
        output.append({
            "positionId": link.get("position_id") or link.get("positionId"),
            "textBlockIds": ids,
            "sanCandidates": extract_candidates(text),
        })
    _write_json(Path(args.output), output)
    print(f"wrote SAN candidates for {len(output)} linked positions")


def section_corpus(args: argparse.Namespace) -> None:
    from .sections import build_section_corpus

    counts = build_section_corpus(args.layout, args.output)
    print(f"wrote {counts['sections']} section(s) with {counts['blocks']} preserved text block(s)")


def review_report(args: argparse.Namespace) -> None:
    from .report import build_review_report

    counts = build_review_report(
        args.positions, args.layout, args.links, args.output,
        recognition_path=args.recognition, reference_book_path=args.reference_book, decisions_path=args.decisions,
    )
    print(f"wrote review report to {args.output} ({sum(counts.values()) // 3} cards)")


def serve_review(args: argparse.Namespace) -> None:
    from .review_server import serve

    serve(args.directory, args.port, args.decisions_file, args.pieces_dir)


def crop_review_report(args: argparse.Namespace) -> None:
    from .crop_report import build_crop_review_report

    build_crop_review_report(args.positions, args.output, args.decisions)
    print(f"wrote crop quality review to {args.output}")


def board_review_report(args: argparse.Namespace) -> None:
    from .board_review import build_board_review_report

    build_board_review_report(args.positions, args.recognition, args.output, args.decisions)
    print(f"wrote board facts review to {args.output}")


def move_review_report(args: argparse.Namespace) -> None:
    from .move_review import build_move_review_report

    build_move_review_report(
        args.positions, args.recognition, args.layout, args.candidates,
        args.output, args.decisions,
    )
    print(f"wrote move candidate review to {args.output}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="textbook-parser")
    commands = parser.add_subparsers(dest="command", required=True)
    render_parser = commands.add_parser("render", help="render an inclusive PDF page range")
    render_parser.add_argument("pdf")
    render_parser.add_argument("output")
    render_parser.add_argument("--first-page", type=int, required=True)
    render_parser.add_argument("--last-page", type=int, required=True)
    render_parser.add_argument("--dpi", type=int, default=500)
    render_parser.set_defaults(func=render)
    text_parser = commands.add_parser("extract-text", help="extract positioned PDF text blocks")
    text_parser.add_argument("pdf")
    text_parser.add_argument("output")
    text_parser.add_argument("--dpi", type=int, default=500, help="must match the render command (default: 500)")
    text_parser.set_defaults(func=extract_text)
    ocr_parser = commands.add_parser("ocr-text", help="OCR rendered pages into raw, review-only text evidence")
    ocr_parser.add_argument("pages")
    ocr_parser.add_argument("output")
    ocr_parser.add_argument("--tesseract", default="tesseract")
    ocr_parser.add_argument("--psm", type=int, default=3)
    ocr_parser.set_defaults(func=ocr_text)
    text_review_parser = commands.add_parser("text-review-report", help="write a persistent QA page for raw text OCR")
    text_review_parser.add_argument("ocr")
    text_review_parser.add_argument("pages")
    text_review_parser.add_argument("output")
    text_review_parser.add_argument("--decisions")
    text_review_parser.set_defaults(func=text_review_report)
    labels_parser = commands.add_parser("export-notation-labels", help="export approved chess-notation QA labels for local training")
    labels_parser.add_argument("decisions")
    labels_parser.add_argument("crops")
    labels_parser.add_argument("output")
    labels_parser.add_argument("--validation-fraction", type=float, default=0.15)
    labels_parser.set_defaults(func=export_notation_labels)
    boards_parser = commands.add_parser("detect-boards", help="propose square diagram candidates")
    boards_parser.add_argument("pages")
    boards_parser.add_argument("output")
    boards_parser.add_argument("--min-size", type=int, default=400)
    boards_parser.add_argument("--min-board-size", type=int, default=700, help="minimum complete board edge in rendered pixels (default: 700)")
    boards_parser.add_argument("--max-per-page", type=int, default=8)
    boards_parser.add_argument("--crops")
    boards_parser.add_argument("--crop-margin", type=float, default=0.18)
    boards_parser.set_defaults(func=detect_boards)
    turn_parser = commands.add_parser("classify-turn", help="classify white/black triangle above each board")
    turn_parser.add_argument("pages")
    turn_parser.add_argument("boards")
    turn_parser.add_argument("output")
    turn_parser.set_defaults(func=classify_turn)
    match_parser = commands.add_parser("match", help="link numbered positions to text blocks")
    match_parser.add_argument("positions")
    match_parser.add_argument("layout")
    match_parser.add_argument("output")
    match_parser.set_defaults(func=match)
    board_reader = commands.add_parser("read-boards", help="explicitly send reviewed crops to ChessOCR")
    board_reader.add_argument("positions")
    board_reader.add_argument("output")
    board_reader.add_argument("--endpoint", default="https://helpman.komtera.lt/predict")
    board_reader.set_defaults(func=read_boards)
    recognize_parser = commands.add_parser("recognize-boards", help="rate-limit ChessOCR calls and checkpoint each result")
    recognize_parser.add_argument("positions")
    recognize_parser.add_argument("output", help="candidate-ID to piece-placement FEN checkpoint JSON")
    recognize_parser.add_argument("--endpoint", default="https://helpman.komtera.lt/predict")
    recognize_parser.add_argument("--delay-seconds", type=float, default=6.0)
    recognize_parser.add_argument("--retry-errors", action="store_true", help="retry failures already stored in the checkpoint")
    recognize_parser.set_defaults(func=recognize_boards)
    ollama_parser = commands.add_parser("ollama-review", help="ask local Ollama to review one unresolved crop")
    ollama_parser.add_argument("image")
    ollama_parser.add_argument("prompt")
    ollama_parser.add_argument("output")
    ollama_parser.add_argument("--model", required=True)
    ollama_parser.add_argument("--base-url", default="http://localhost:11434")
    ollama_parser.set_defaults(func=review_with_ollama)
    sans_parser = commands.add_parser("extract-sans", help="gather unvalidated SAN candidates from linked text")
    sans_parser.add_argument("links")
    sans_parser.add_argument("layout")
    sans_parser.add_argument("output")
    sans_parser.set_defaults(func=extract_sans)
    sections_parser = commands.add_parser("section-corpus", help="preserve every extracted text block grouped by section")
    sections_parser.add_argument("layout")
    sections_parser.add_argument("output")
    sections_parser.set_defaults(func=section_corpus)
    report_parser = commands.add_parser("review-report", help="write an offline HTML contact sheet for candidate review")
    report_parser.add_argument("positions")
    report_parser.add_argument("layout")
    report_parser.add_argument("links")
    report_parser.add_argument("output")
    report_parser.add_argument("--recognition", help="candidate-ID to ChessOCR FEN JSON map")
    report_parser.add_argument("--reference-book", help="existing book JSON to compare with candidates")
    report_parser.add_argument("--decisions", help="previously exported review-decisions.json to prefill")
    report_parser.set_defaults(func=review_report)
    server_parser = commands.add_parser("serve-review", help="serve a review report and persist decisions to a local JSON file")
    server_parser.add_argument("directory", help="ignored work directory containing review.html")
    server_parser.add_argument("--port", type=int, default=8765)
    server_parser.add_argument("--decisions-file", default="review-decisions.json")
    server_parser.add_argument("--pieces-dir", help="Chesslab public/pieces directory to expose read-only at /assets/pieces/")
    server_parser.set_defaults(func=serve_review)
    crop_report_parser = commands.add_parser("crop-review-report", help="write a crop-quality-only review page")
    crop_report_parser.add_argument("positions", help="board candidate JSON from detect-boards")
    crop_report_parser.add_argument("output")
    crop_report_parser.add_argument("--decisions")
    crop_report_parser.set_defaults(func=crop_review_report)
    board_report_parser = commands.add_parser("board-review-report", help="write a board/FEN-and-turn-only review page")
    board_report_parser.add_argument("positions", help="turn-classified candidate JSON")
    board_report_parser.add_argument("recognition", help="candidate-ID to ChessOCR FEN JSON")
    board_report_parser.add_argument("output")
    board_report_parser.add_argument("--decisions")
    board_report_parser.set_defaults(func=board_review_report)
    move_report_parser = commands.add_parser("move-review-report", help="write a human-only move-candidate review page")
    move_report_parser.add_argument("positions")
    move_report_parser.add_argument("recognition")
    move_report_parser.add_argument("layout")
    move_report_parser.add_argument("candidates")
    move_report_parser.add_argument("output")
    move_report_parser.add_argument("--decisions")
    move_report_parser.set_defaults(func=move_review_report)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
