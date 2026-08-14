from __future__ import annotations

import re

FIGURINES = str.maketrans({
    "♔": "K", "♚": "K", "♕": "Q", "♛": "Q", "♖": "R", "♜": "R",
    "♗": "B", "♝": "B", "♘": "N", "♞": "N",
})
SAN_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:O-O-O|O-O|[KQRBN]?(?:[a-h]|[1-8])?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z0-9])"
)


def extract_candidates(text: str) -> list[str]:
    """Normalise figurines and return possible SAN tokens, not validated SAN."""
    candidates: list[str] = []
    for line in text.splitlines():
        normalised = line.translate(FIGURINES).replace("0-0-0", "O-O-O").replace("0-0", "O-O")
        # Bare squares such as "h2" also occur in prose. Requiring a move
        # number keeps this stage deliberately conservative; an unresolved
        # diagram is cheaper to review than an invented solution line.
        if not re.search(r"\b\d+\s*\.\s*(?:\.\.\s*)?", normalised):
            continue
        candidates.extend(SAN_RE.findall(normalised))
    return candidates
