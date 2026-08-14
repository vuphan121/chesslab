from __future__ import annotations

import base64
import json
import mimetypes
import os
import urllib.request
from pathlib import Path


def read_with_chessocr(image_path: str | Path, endpoint: str = "https://helpman.komtera.lt/predict") -> str:
    """Return the four-field board layout reported by ChessOCR.

    It intentionally does not construct a full FEN: turn, castling, and en
    passant are separate reviewed facts.
    """
    path = Path(image_path)
    data = path.read_bytes()
    boundary = "----textbookparser"
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        endpoint, data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read())
    results = payload.get("results") or []
    if not results or not results[0].get("fen"):
        raise ValueError(f"ChessOCR found no board in {path}: {payload}")
    return str(results[0]["fen"])


def ollama_review(image_path: str | Path, model: str, prompt: str, base_url: str = "http://localhost:11434") -> dict:
    """Ask a local vision model a narrow, schema-constrained review question."""
    image = base64.b64encode(Path(image_path).read_bytes()).decode("ascii")
    schema = {
        "type": "object",
        "properties": {
            "answer": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"},
        },
        "required": ["answer", "confidence", "reason"],
    }
    payload = json.dumps({
        "model": model,
        "stream": False,
        "format": schema,
        "options": {"temperature": 0},
        "messages": [{"role": "user", "content": prompt, "images": [image]}],
    }).encode()
    request = urllib.request.Request(
        base_url.rstrip("/") + "/api/chat", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.loads(response.read())
    answer = json.loads(result["message"]["content"])
    if not isinstance(answer.get("answer"), str) or not isinstance(answer.get("confidence"), (int, float)):
        raise ValueError(f"Ollama response did not satisfy review schema: {answer!r}")
    return answer
