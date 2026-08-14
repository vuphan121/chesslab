from __future__ import annotations

from dataclasses import dataclass


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

    @property
    def aspect(self) -> float:
        return self.width / self.height if self.height else 0.0

    def union(self, other: "Rectangle") -> "Rectangle":
        x0, y0 = min(self.x, other.x), min(self.y, other.y)
        return Rectangle(x0, y0, max(self.x1, other.x1) - x0, max(self.y1, other.y1) - y0)


def _overlap(start_a: int, end_a: int, start_b: int, end_b: int) -> int:
    return max(0, min(end_a, end_b) - max(start_a, start_b))


def _gap(start_a: int, end_a: int, start_b: int, end_b: int) -> int:
    return max(0, max(start_a, start_b) - min(end_a, end_b))


def _same_board(first: Rectangle, second: Rectangle) -> bool:
    """Whether two square-ish contours plausibly belong to one 8-by-8 board.

    Broken outer borders are common in scanned diagrams: Canny then finds
    overlapping 3-4-square regions instead of the full board. The regions are
    stitched only when they touch/overlap in one axis and substantially overlap
    (or nearly touch) in the other. A caption gap between separate diagrams is
    far larger than this tolerance.
    """
    horizontal_overlap = _overlap(first.x, first.x1, second.x, second.x1)
    vertical_overlap = _overlap(first.y, first.y1, second.y, second.y1)
    horizontal_gap = _gap(first.x, first.x1, second.x, second.x1)
    vertical_gap = _gap(first.y, first.y1, second.y, second.y1)
    size = min(max(first.width, first.height), max(second.width, second.height))
    near = max(18, round(size * 0.2))
    if horizontal_overlap >= min(first.width, second.width) * 0.23 and vertical_gap <= near:
        return True
    if vertical_overlap >= min(first.height, second.height) * 0.23 and horizontal_gap <= near:
        return True
    # Nested contours (outer border and a partial internal grid) are always
    # part of the same candidate, but do not expand its union.
    return horizontal_overlap > 0 and vertical_overlap > 0


def merge_board_fragments(rectangles: list[Rectangle]) -> list[Rectangle]:
    """Join fragmented square contours into full-board candidates."""
    remaining = sorted(rectangles, key=lambda rectangle: rectangle.area, reverse=True)
    merged: list[Rectangle] = []
    while remaining:
        group = [remaining.pop(0)]
        changed = True
        while changed:
            changed = False
            union = group[0]
            for rectangle in group[1:]:
                union = union.union(rectangle)
            keep: list[Rectangle] = []
            for rectangle in remaining:
                if any(_same_board(rectangle, member) for member in group) or _same_board(rectangle, union):
                    group.append(rectangle)
                    changed = True
                else:
                    keep.append(rectangle)
            remaining = keep
        candidate = group[0]
        for rectangle in group[1:]:
            candidate = candidate.union(rectangle)
        if 0.82 <= candidate.aspect <= 1.22:
            merged.append(candidate)
    # A component can still retain a fully-contained duplicate after a broken
    # border was stitched. Keep the largest only.
    result: list[Rectangle] = []
    for candidate in sorted(merged, key=lambda rectangle: rectangle.area, reverse=True):
        if any(
            candidate.x >= existing.x and candidate.y >= existing.y
            and candidate.x1 <= existing.x1 and candidate.y1 <= existing.y1
            for existing in result
        ):
            continue
        result.append(candidate)
    return result


def keep_complete_boards(rectangles: list[Rectangle], min_edge: int) -> list[Rectangle]:
    """Reject stitched contours that are still too small to be an 8-by-8 board.

    At a fixed render DPI, a genuine board has a consistent physical size.
    This is intentionally applied *after* fragment merging: a 4-square partial
    grid can be useful evidence for reconstructing a full board, but must not
    become a crop in its own right.
    """
    return [rectangle for rectangle in rectangles if min(rectangle.width, rectangle.height) >= min_edge]
