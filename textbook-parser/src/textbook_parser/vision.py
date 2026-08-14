from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TurnDetection:
    side_to_move: str | None
    confidence: float
    reason: str


def detect_turn(image, board_bbox: tuple[int, int, int, int]) -> TurnDetection:
    """Classify a filled white/black triangle immediately above a board.

    This deliberately returns unknown for an outlined triangle, page ornament,
    or weak contrast. A wrong FEN turn is worse than a review-queue item.
    """
    import cv2

    x0, y0, x1, y1 = board_bbox
    height = y1 - y0
    top = max(0, y0 - round(height * 0.28))
    left, right = max(0, x0 - round(height * 0.12)), min(image.shape[1], x1 + round(height * 0.12))
    region = image[top:y0, left:right]
    if region.size == 0:
        return TurnDetection(None, 0.0, "no region above board")
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY) if len(region.shape) == 3 else region
    edges = cv2.Canny(gray, 40, 140)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    board_area = height * (x1 - x0)
    choices: list[tuple[float, str]] = []
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
        # A side-to-move symbol is normally centred over the diagram.
        horizontal = abs((left + cx) - (x0 + x1) / 2) / max(1, x1 - x0)
        if horizontal > 0.48:
            continue
        points = vertices.reshape(-1, 2)
        ys = points[:, 1]
        # This book uses an upward open triangle for White and a downward
        # filled triangle for Black. Orientation is robust for both an outline
        # marker on white paper and a solid black marker; fill brightness is
        # not. Reject nearly flat/degenerate contours.
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
        scale = min(1.0, area / max(1, board_area * 0.001))
        choices.append((0.35 + scale * 0.35 - horizontal * 0.2, side))
    if not choices:
        return TurnDetection(None, 0.0, "no triangular turn marker above board")
    confidence, side = max(choices, key=lambda choice: choice[0])
    if confidence < 0.4:
        return TurnDetection(None, confidence, "triangle shape below review threshold")
    return TurnDetection(side, round(min(0.95, confidence), 2), "triangle orientation above board")
