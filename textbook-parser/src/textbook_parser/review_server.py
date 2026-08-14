from __future__ import annotations

import argparse
import json
import os
import shutil
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


MAX_BODY_BYTES = 2_000_000
VALID_DECISIONS = {"unreviewed", "approved", "corrected", "excluded"}
VALID_CROP_QUALITIES = {"unreviewed", "complete", "partial", "not_board", "unclear"}


def normalize_decisions(value: Any) -> dict[str, Any]:
    """Validate the portable review checkpoint format before writing it."""
    records = value.get("decisions") if isinstance(value, dict) else value
    if not isinstance(records, list):
        raise ValueError("expected an object with a decisions list")
    decisions: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not record["id"]:
            raise ValueError("every decision needs a non-empty string id")
        decision = record.get("decision", "unreviewed")
        if decision not in VALID_DECISIONS:
            raise ValueError(f"invalid decision for {record['id']}: {decision!r}")
        side = record.get("sideToMove", "")
        if side not in ("", "w", "b"):
            raise ValueError(f"invalid sideToMove for {record['id']}: {side!r}")
        text_ids = record.get("textBlockIds", [])
        if not isinstance(text_ids, list) or not all(isinstance(item, str) for item in text_ids):
            raise ValueError(f"textBlockIds for {record['id']} must be a string list")
        crop_quality = record.get("cropQuality", "unreviewed")
        if crop_quality not in VALID_CROP_QUALITIES:
            raise ValueError(f"invalid cropQuality for {record['id']}: {crop_quality!r}")
        decisions.append({
            "id": record["id"], "decision": decision,
            "piecePlacement": str(record.get("piecePlacement", "")),
            "sideToMove": side, "textBlockIds": text_ids,
            "sanSequence": str(record.get("sanSequence", "")),
            "reviewedText": str(record.get("reviewedText", "")),
            "labelKind": str(record.get("labelKind", "")),
            "notes": str(record.get("notes", "")), "cropQuality": crop_quality,
        })
    return {"version": 1, "decisions": decisions}


class DecisionStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"version": 1, "decisions": []}
        return normalize_decisions(json.loads(self.path.read_text(encoding="utf-8")))

    def write(self, value: Any) -> dict[str, Any]:
        incoming = normalize_decisions(value)
        # A review page can show only a subset of cards.  Treat writes as
        # updates by ID so that saving one newly reviewed card never drops the
        # decisions for cards that are currently hidden from that page.
        existing = {record["id"]: record for record in self.read()["decisions"]}
        incoming_by_id = {record["id"]: record for record in incoming["decisions"]}
        changes = [record for identifier, record in incoming_by_id.items() if existing.get(identifier) != record]
        existing.update(incoming_by_id)
        normalized = {"version": 1, "decisions": list(existing.values())}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Keep an append-only recovery trail. A normal UI save changes one
        # decision, so this is compact even when the browser sends the merged
        # checkpoint back to the server.
        if changes:
            history = self.path.with_name(f"{self.path.stem}-history.jsonl")
            with history.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"savedAtMs": round(time.time() * 1000), "changes": changes}, ensure_ascii=False) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        if self.path.exists():
            shutil.copy2(self.path, self.path.with_suffix(self.path.suffix + ".bak"))
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, self.path)
        return normalized

    def clear(self) -> None:
        if self.path.exists():
            self.path.unlink()


def make_handler(directory: Path, store: DecisionStore, pieces_directory: Path | None = None):
    class ReviewHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, directory=str(directory), **kwargs)

        def _send_json(self, status: HTTPStatus, value: Any) -> None:
            body = json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _is_decision_path(self) -> bool:
            return self.path.split("?", 1)[0] == "/api/decisions"

        def _piece_asset(self) -> Path | None:
            prefix = "/assets/pieces/"
            path = self.path.split("?", 1)[0]
            if not pieces_directory or not path.startswith(prefix):
                return None
            filename = path.removeprefix(prefix)
            if Path(filename).name != filename or not filename.endswith(".png"):
                return None
            asset = pieces_directory / filename
            return asset if asset.is_file() else None

        def do_GET(self) -> None:  # noqa: N802 - HTTP handler API
            if self._is_decision_path():
                self._send_json(HTTPStatus.OK, store.read())
                return
            asset = self._piece_asset()
            if asset:
                body = asset.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def do_PUT(self) -> None:  # noqa: N802 - HTTP handler API
            if not self._is_decision_path():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "invalid review decision payload length")
                return
            try:
                value = json.loads(self.rfile.read(length))
                self._send_json(HTTPStatus.OK, store.write(value))
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

        def do_DELETE(self) -> None:  # noqa: N802 - HTTP handler API
            if not self._is_decision_path():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            store.clear()
            self._send_json(HTTPStatus.OK, {"version": 1, "decisions": []})

    return ReviewHandler


def serve(directory: str | Path, port: int = 8765, decisions_file: str = "review-decisions.json", pieces_dir: str | Path | None = None) -> None:
    root = Path(directory).resolve()
    if not root.is_dir():
        raise ValueError(f"review directory does not exist: {root}")
    store = DecisionStore(root / decisions_file)
    pieces_directory = Path(pieces_dir).resolve() if pieces_dir else None
    if pieces_directory and not pieces_directory.is_dir():
        raise ValueError(f"pieces directory does not exist: {pieces_directory}")
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(root, store, pieces_directory))
    print(f"Review server: http://127.0.0.1:{port}/review.html")
    print(f"Decisions file: {store.path}")
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve an offline textbook review report with decision persistence")
    parser.add_argument("directory")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--decisions-file", default="review-decisions.json")
    parser.add_argument("--pieces-dir")
    args = parser.parse_args()
    serve(args.directory, args.port, args.decisions_file, args.pieces_dir)


if __name__ == "__main__":
    main()
