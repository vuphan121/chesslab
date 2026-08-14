from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

Kind = Literal["study", "exercise"]


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

    @classmethod
    def from_json(cls, value: list[float]) -> "Box":
        if len(value) != 4:
            raise ValueError(f"bbox needs four values, got {value!r}")
        return cls(*map(float, value))

    def to_json(self) -> list[float]:
        return [self.x0, self.y0, self.x1, self.y1]


@dataclass(frozen=True)
class TextBlock:
    page: int
    text: str
    bbox: Box
    section: str | None = None
    id: str | None = None

    @classmethod
    def from_json(cls, value: dict) -> "TextBlock":
        return cls(
            page=int(value["page"]), text=str(value["text"]),
            bbox=Box.from_json(value["bbox"]), section=value.get("section"), id=value.get("id"),
        )

    def to_json(self) -> dict:
        value = asdict(self)
        value["bbox"] = self.bbox.to_json()
        return {key: item for key, item in value.items() if item is not None}


@dataclass(frozen=True)
class Position:
    id: str
    page: int
    bbox: Box
    label: str | None = None
    kind: Kind = "study"
    fen: str | None = None
    side_to_move: str | None = None
    confidence: float | None = None

    @classmethod
    def from_json(cls, value: dict) -> "Position":
        return cls(
            id=str(value["id"]), page=int(value["page"]), bbox=Box.from_json(value["bbox"]),
            label=str(value["label"]) if value.get("label") is not None else None,
            kind=value.get("kind", "study"), fen=value.get("fen"),
            side_to_move=value.get("sideToMove"), confidence=value.get("confidence"),
        )


@dataclass
class Link:
    position_id: str
    status: Literal["linked", "ambiguous", "unmatched"]
    text_block_id: str | None = None
    text_block_ids: list[str] = field(default_factory=list)
    score: float | None = None
    reasons: list[str] = field(default_factory=list)
    candidates: list[dict] = field(default_factory=list)
