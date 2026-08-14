"""Train a small, local CTC OCR baseline from Text OCR QA decisions.

This is deliberately a smoke-test trainer: its purpose is to measure whether
the reviewed line crops contain enough signal for a learned OCR model.  It
never writes predictions back to the review data.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
from PIL import Image
from torch import nn
from torch.nn import functional as F


TEXT_KINDS = {"chess_notation", "prose", "heading", "metadata"}
BLANK = 0


def read_examples(root: Path) -> list[dict[str, str]]:
    decisions = json.loads((root / "text-review-decisions.json").read_text(encoding="utf-8"))["decisions"]
    raw = {row["id"]: row["text"] for row in json.loads((root / "ocr-text.json").read_text(encoding="utf-8"))}
    examples: list[dict[str, str]] = []
    for row in decisions:
        if row.get("decision") not in {"approved", "corrected"} or row.get("labelKind") not in TEXT_KINDS:
            continue
        identifier = str(row.get("id", ""))
        # In Text OCR QA, an empty reviewed field means the raw OCR was accepted.
        text = str(row.get("reviewedText") or raw.get(identifier, "")).strip()
        image = root / "text-crops" / f"{identifier}.png"
        if identifier and text and image.is_file():
            examples.append({"id": identifier, "kind": str(row["labelKind"]), "text": text, "image": str(image)})
    return examples


def stratified_split(examples: list[dict[str, str]], fraction: float, seed: int) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    groups: dict[str, list[dict[str, str]]] = {}
    for item in examples:
        groups.setdefault(item["kind"], []).append(item)
    train: list[dict[str, str]] = []
    validation: list[dict[str, str]] = []
    rng = random.Random(seed)
    for group in groups.values():
        rng.shuffle(group)
        count = max(1, round(len(group) * fraction)) if len(group) >= 2 else 0
        validation.extend(group[:count])
        train.extend(group[count:])
    return train, validation


def load_image(path: str, height: int = 48, max_width: int = 1024) -> torch.Tensor:
    with Image.open(path) as source:
        image = source.convert("L")
        width = max(16, min(max_width, round(image.width * height / image.height)))
        image = image.resize((width, height), Image.Resampling.BILINEAR)
        values = torch.tensor(list(image.getdata()), dtype=torch.float32).reshape(height, width) / 255.0
    return 1.0 - values


def batchify(rows: list[dict[str, str]], alphabet: str, device: torch.device) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    index = {char: pos + 1 for pos, char in enumerate(alphabet)}
    images = [load_image(row["image"]) for row in rows]
    widths = torch.tensor([image.shape[1] for image in images], dtype=torch.long)
    canvas = torch.zeros((len(images), 1, 48, int(widths.max())), dtype=torch.float32)
    for position, image in enumerate(images):
        canvas[position, 0, :, : image.shape[1]] = image
    texts = [[index[char] for char in row["text"]] for row in rows]
    lengths = torch.tensor([len(text) for text in texts], dtype=torch.long)
    targets = torch.tensor([token for text in texts for token in text], dtype=torch.long)
    return canvas.to(device), widths.to(device), targets.to(device), lengths.to(device)


class CRNN(nn.Module):
    def __init__(self, classes: int) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.ReLU(), nn.MaxPool2d((2, 1)),
            nn.Conv2d(128, 128, 3, padding=1), nn.ReLU(),
        )
        self.sequence = nn.LSTM(128, 128, bidirectional=True, batch_first=True)
        self.output = nn.Linear(256, classes)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        values = self.features(images).mean(dim=2).transpose(1, 2)
        values, _ = self.sequence(values)
        return self.output(values).transpose(0, 1).log_softmax(2)


def levenshtein(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for row, left_char in enumerate(left, 1):
        current = [row]
        for column, right_char in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[column] + 1, previous[column - 1] + (left_char != right_char)))
        previous = current
    return previous[-1]


@torch.no_grad()
def evaluate(model: CRNN, rows: list[dict[str, str]], alphabet: str, device: torch.device) -> dict[str, float]:
    model.eval()
    characters = 0
    errors = 0
    exact = 0
    for row in rows:
        images, widths, _, _ = batchify([row], alphabet, device)
        output = model(images).argmax(2)[:, 0].tolist()[: int(widths[0].item()) // 4]
        tokens: list[int] = []
        for token in output:
            if token != BLANK and (not tokens or tokens[-1] != token):
                tokens.append(token)
        prediction = "".join(alphabet[token - 1] for token in tokens)
        errors += levenshtein(prediction, row["text"])
        characters += len(row["text"])
        exact += prediction == row["text"]
    return {"cer": errors / characters if characters else 1.0, "exact_line_accuracy": exact / len(rows) if rows else 0.0}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a CRNN/CTC smoke-test OCR model from Text OCR QA labels")
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(min(4, torch.get_num_threads()))

    examples = read_examples(args.dataset_root)
    train, validation = stratified_split(examples, args.validation_fraction, args.seed)
    if len(train) < 2 or not validation:
        raise SystemExit("need at least two train examples and one validation example")
    alphabet = "".join(sorted({char for row in examples for char in row["text"]}))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = CRNN(len(alphabet) + 1).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    loss_fn = nn.CTCLoss(blank=BLANK, zero_infinity=True)
    best = {"cer": float("inf"), "exact_line_accuracy": 0.0}
    args.output_directory.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        random.shuffle(train)
        for start in range(0, len(train), args.batch_size):
            batch = train[start : start + args.batch_size]
            images, widths, targets, target_lengths = batchify(batch, alphabet, device)
            output = model(images)
            input_lengths = (widths // 4).clamp_min(1)
            loss = loss_fn(output, targets, input_lengths, target_lengths)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
        metrics = evaluate(model, validation, alphabet, device)
        if metrics["cer"] < best["cer"]:
            best = {**metrics, "epoch": epoch}
            torch.save({"state_dict": model.state_dict(), "alphabet": alphabet, "metrics": best}, args.output_directory / "best.pt")
        if epoch == 1 or epoch % 10 == 0 or epoch == args.epochs:
            print(f"epoch {epoch:03d}: validation CER {metrics['cer']:.3f}, exact lines {metrics['exact_line_accuracy']:.3f}")

    report = {"examples": len(examples), "train": len(train), "validation": len(validation), "alphabet_size": len(alphabet), "device": str(device), "best": best}
    (args.output_directory / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
