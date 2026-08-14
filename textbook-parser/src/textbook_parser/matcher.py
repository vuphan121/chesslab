from __future__ import annotations

from dataclasses import replace
from math import hypot
import re

from .labels import label_from_text
from .models import Link, Position, TextBlock


def _section(block: TextBlock) -> str:
    return (block.section or "study").lower()


def _infer_label(position: Position, blocks: list[TextBlock]) -> tuple[Position, str | None]:
    if position.label:
        return position, None
    height = position.bbox.y1 - position.bbox.y0
    nearby = []
    for block in blocks:
        label = label_from_text(block.text)
        if block.page != position.page or not label:
            continue
        x_overlap = min(position.bbox.x1, block.bbox.x1) - max(position.bbox.x0, block.bbox.x0)
        explicit_caption = bool(re.match(r"^\s*(diagram|position|exercise|example|solution)\b", block.text, re.I))
        if (x_overlap <= 0 and not explicit_caption) or not position.bbox.y0 - height * 0.55 <= block.bbox.y1 <= position.bbox.y0 + height * 0.15:
            continue
        nearby.append((abs(position.bbox.y0 - block.bbox.y1), label))
    if not nearby:
        return position, None
    _, label = min(nearby, key=lambda candidate: candidate[0])
    return replace(position, label=label), "inferred label from adjacent caption"


def _score(position: Position, block: TextBlock) -> tuple[float, list[str]]:
    label = label_from_text(block.text)
    reasons: list[str] = []
    score = 0.0
    if position.label and label == position.label:
        score += 1000.0
        reasons.append("exact numbered label")
    elif position.label:
        score -= 1000.0
        reasons.append("different numbered label")

    page_gap = abs(position.page - block.page)
    score -= page_gap * 90.0
    if page_gap == 0:
        reasons.append("same page")
        px, py = position.bbox.center
        tx, ty = block.bbox.center
        distance = hypot(px - tx, py - ty)
        score -= distance / 8.0
        # A side-by-side page should prefer the same column over a slightly
        # closer block above/below the other diagram.
        overlap = min(position.bbox.x1, block.bbox.x1) - max(position.bbox.x0, block.bbox.x0)
        if overlap > 0:
            score += 25.0
            reasons.append("same column")
        # Study diagrams in this book frequently have the board at left and a
        # duplicate caption followed by the explanatory line at right. Prefer
        # that caption once its number has already established the match.
        if position.kind == "study" and position.label and label == position.label and block.bbox.x0 >= position.bbox.x1:
            score += 240.0
            reasons.append("description column right of diagram")
    return score, reasons


def _same_column(first: TextBlock, second: TextBlock) -> bool:
    overlap = min(first.bbox.x1, second.bbox.x1) - max(first.bbox.x0, second.bbox.x0)
    narrower = min(first.bbox.x1 - first.bbox.x0, second.bbox.x1 - second.bbox.x0)
    return overlap > max(10, narrower * 0.25)


def _context_ids(anchor: TextBlock, blocks: list[TextBlock]) -> list[str]:
    """Return the caption and its following move/commentary lines.

    A new numbered caption in the same column is a hard boundary. The generous
    maximum keeps a paragraph on a sparse page together while preventing a
    whole chapter from being linked if OCR loses a caption.
    """
    anchor_id = anchor.id
    if not anchor_id:
        return []
    result = [anchor_id]
    maximum_y = anchor.bbox.y1 + 1400
    for block in sorted(blocks, key=lambda candidate: (candidate.page, candidate.bbox.y0)):
        if block.id == anchor_id or block.page != anchor.page or block.bbox.y0 < anchor.bbox.y1:
            continue
        if block.bbox.y0 > maximum_y or _section(block) != _section(anchor) or not _same_column(anchor, block):
            continue
        if label_from_text(block.text):
            break
        if block.id:
            result.append(block.id)
    return result


def match_positions(positions: list[Position], blocks: list[TextBlock]) -> list[Link]:
    links: list[Link] = []
    for original_position in positions:
        position, inference_reason = _infer_label(original_position, blocks)
        candidates = blocks
        if position.kind == "exercise":
            candidates = [block for block in blocks if _section(block) == "solution" and block.page >= position.page]

        scored = []
        for index, block in enumerate(candidates):
            score, reasons = _score(position, block)
            if position.kind == "exercise":
                if position.label and label_from_text(block.text) != position.label:
                    continue
                reasons.append("solution section after exercise")
            elif abs(block.page - position.page) > 1:
                continue
            scored.append((score, index, block, reasons))

        scored.sort(key=lambda item: item[0], reverse=True)
        if not scored:
            reasons = ["no eligible text block"]
            if inference_reason:
                reasons.insert(0, inference_reason)
            links.append(Link(position.id, "unmatched", reasons=reasons))
            continue

        best = scored[0]
        review = [
            {"textBlockId": block.id or f"block-{index}", "page": block.page, "score": round(score, 2), "text": block.text[:160]}
            for score, index, block, _ in scored[:3]
        ]
        second_score = scored[1][0] if len(scored) > 1 else None
        # Exact label matches are decisive. Proximity-only decisions must be
        # clearly separated; a close tie is intentionally sent to review.
        exact = position.label and label_from_text(best[2].text) == position.label
        if not exact and second_score is not None and best[0] - second_score < 40:
            reasons = best[3] + ["spatial score too close to next candidate"]
            if inference_reason:
                reasons.insert(0, inference_reason)
            links.append(Link(position.id, "ambiguous", reasons=reasons, candidates=review))
            continue
        reasons = best[3]
        if inference_reason:
            reasons = [inference_reason, *reasons]
        anchor_id = best[2].id or f"block-{best[1]}"
        links.append(Link(position.id, "linked", anchor_id, _context_ids(best[2], blocks), round(best[0], 2), reasons, review))
    return links
