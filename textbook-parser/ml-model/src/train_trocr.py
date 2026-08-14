"""Fine-tune a pretrained TrOCR line reader from Text OCR QA decisions.

The model reads one text-line crop at a time.  Board/noise labels are useful
for crop filtering, but deliberately never enter this recognizer's dataset.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import torch
from PIL import Image
from torch import nn

from train_crnn import levenshtein, read_examples, stratified_split


def batches(rows: list[dict[str, str]], processor, batch_size: int, device: torch.device):
    tokenizer = processor.tokenizer
    for start in range(0, len(rows), batch_size):
        group = rows[start : start + batch_size]
        pixels = []
        labels = []
        for row in group:
            with Image.open(row["image"]) as source:
                pixels.append(processor(images=source.convert("RGB"), return_tensors="pt").pixel_values[0])
            labels.append(torch.tensor(tokenizer(row["text"], add_special_tokens=True).input_ids, dtype=torch.long))
        target = nn.utils.rnn.pad_sequence(labels, batch_first=True, padding_value=-100)
        yield torch.stack(pixels).to(device), target.to(device)


def add_missing_characters(model, tokenizer, examples: list[dict[str, str]]) -> list[str]:
    """Preserve book-specific Unicode annotations rather than mapping to unk."""
    missing = []
    for char in sorted({character for row in examples for character in row["text"]}):
        encoded = tokenizer.encode(char, add_special_tokens=False)
        if tokenizer.unk_token_id in encoded:
            missing.append(char)
    if missing:
        tokenizer.add_tokens(missing)
        model.decoder.resize_token_embeddings(len(tokenizer))
    return missing


@torch.no_grad()
def evaluate(model, processor, rows: list[dict[str, str]], device: torch.device, max_new_tokens: int) -> dict[str, float]:
    model.eval()
    errors = characters = exact = 0
    for row in rows:
        with Image.open(row["image"]) as source:
            pixels = processor(images=source.convert("RGB"), return_tensors="pt").pixel_values.to(device)
        output = model.generate(pixels, max_new_tokens=max_new_tokens, num_beams=1)
        prediction = processor.batch_decode(output, skip_special_tokens=True)[0].strip()
        errors += levenshtein(prediction, row["text"])
        characters += len(row["text"])
        exact += prediction == row["text"]
    return {"cer": errors / characters if characters else 1.0, "exact_line_accuracy": exact / len(rows) if rows else 0.0}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune pretrained TrOCR on reviewed chess-book line crops")
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("output_directory", type=Path)
    parser.add_argument("--checkpoint", default="microsoft/trocr-small-printed")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=5e-5)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--freeze-encoder", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    try:
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    except ImportError as error:
        raise SystemExit("TrOCR requires transformers with VisionEncoderDecoderModel support") from error

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(min(4, torch.get_num_threads()))
    examples = read_examples(args.dataset_root)
    train, validation = stratified_split(examples, args.validation_fraction, args.seed)
    if len(train) < 2 or not validation:
        raise SystemExit("need at least two training examples and one validation example")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading pretrained checkpoint: {args.checkpoint}", flush=True)
    # This checkpoint ships a SentencePiece model.  Explicitly request the
    # compatible slow tokenizer rather than Transformers' optional tiktoken
    # conversion path.
    processor = TrOCRProcessor.from_pretrained(args.checkpoint, use_fast=False)
    model = VisionEncoderDecoderModel.from_pretrained(args.checkpoint)
    added_tokens = add_missing_characters(model, processor.tokenizer, examples)
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.eos_token_id = processor.tokenizer.sep_token_id
    model.generation_config.decoder_start_token_id = processor.tokenizer.cls_token_id
    model.generation_config.pad_token_id = processor.tokenizer.pad_token_id
    model.generation_config.eos_token_id = processor.tokenizer.sep_token_id
    model.to(device)
    if args.freeze_encoder:
        for parameter in model.encoder.parameters():
            parameter.requires_grad = False
    optimizer = torch.optim.AdamW((parameter for parameter in model.parameters() if parameter.requires_grad), lr=args.learning_rate)
    args.output_directory.mkdir(parents=True, exist_ok=True)
    best = {"cer": float("inf"), "exact_line_accuracy": 0.0}

    for epoch in range(1, args.epochs + 1):
        model.train()
        random.shuffle(train)
        total_loss = 0.0
        for pixels, labels in batches(train, processor, args.batch_size, device):
            result = model(pixel_values=pixels, labels=labels)
            optimizer.zero_grad()
            result.loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += float(result.loss.item())
        metrics = evaluate(model, processor, validation, device, args.max_new_tokens)
        metrics["train_loss"] = total_loss / max(1, (len(train) + args.batch_size - 1) // args.batch_size)
        if metrics["cer"] < best["cer"]:
            best = {**metrics, "epoch": epoch}
            model.save_pretrained(args.output_directory / "best")
            processor.save_pretrained(args.output_directory / "best")
        print(f"epoch {epoch:03d}: loss {metrics['train_loss']:.4f}, validation CER {metrics['cer']:.3f}, exact lines {metrics['exact_line_accuracy']:.3f}", flush=True)

    report = {
        "checkpoint": args.checkpoint, "examples": len(examples), "train": len(train), "validation": len(validation),
        "device": str(device), "freeze_encoder": args.freeze_encoder, "added_tokens": added_tokens, "best": best,
    }
    (args.output_directory / "metrics.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # Windows' default console encoding cannot render some chess symbols such
    # as ⇄. The UTF-8 metrics file retains them; console output stays portable.
    print(json.dumps(report, indent=2, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
