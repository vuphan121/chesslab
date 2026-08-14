from __future__ import annotations

import re

# Restrict labels to line starts / explicit contextual words. This prevents a
# move number such as "12. Nf3" buried in prose becoming an exercise label.
LABEL_RE = re.compile(
    r"(?im)^\s*(?:(?P<context>diagram|position|exercise|example|solution|no\.?|#)\s*)?(?P<label>\d{1,3}(?:\s*[-–]\s*\d{1,3})?)(?:\s*[.):])?(?P<rest>.*)$"
)
HEADING_RE = re.compile(r"(?i)\b(exercises?|solutions?|answers?|examples?)\b")
MOVE_START_RE = re.compile(r"^(?:\.\.\s*)?(?:[KQRBN][a-h1-8x=+#-]*|[a-h](?:x?[a-h]?[1-8])|O-O|[\u2654-\u265f])")


def label_from_text(text: str) -> str | None:
    match = LABEL_RE.search(text)
    if not match:
        return None
    # A bare `1. Qh7+` is a move line, not a diagram/exercise label. Explicit
    # `Diagram 1-6` / `Solution 12` forms remain labels regardless of what
    # follows them.
    if not match.group("context"):
        rest = match.group("rest").strip()
        if not rest or MOVE_START_RE.match(rest):
            return None
    return re.sub(r"\s+", "", match.group("label"))


def section_from_text(text: str) -> str | None:
    match = HEADING_RE.search(text)
    if not match:
        return None
    word = match.group(1).lower()
    if word.startswith("solution") or word.startswith("answer"):
        return "solution"
    if word.startswith("exercise"):
        return "exercise"
    return "study"
