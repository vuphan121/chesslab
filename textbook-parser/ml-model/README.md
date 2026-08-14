# Local full-line chess-book OCR model

This folder contains the optional local ML work for recognizing complete lines
from the printed chess book: normal text, headings, player/event metadata,
chess notation, and lines mixing prose with moves. It is separate from the
parser's evidence and review workflow: the model can suggest text, but it must
never auto-approve or repair a move.

## Labeling

Label every meaningful text line in Text OCR QA. Choose its content type,
enter the exact transcription in `Reviewed text`, and set the decision to
`approved` or `corrected`.

- `chess notation`: move lines and variations. Write figurines as `K`, `Q`,
  `R`, `B`, or `N` in standard SAN, e.g. `1... Ne2+!`.
- `prose`, `heading`, and `metadata`: retain their ordinary text exactly.
- Mixed prose and move lines: preserve the full line and use `prose` unless
  the line is primarily a move sequence.
- `board artifact` / `not text`: use only for non-text material such as board
  coordinates, piece fragments, arrows, decorations, empty crops, or garbage;
  set these to `excluded`.

If a line is meaningful but hard to read, leave it `unreviewed` instead of
inventing a transcription.

## Dataset export

```powershell
python -m textbook_parser export-notation-labels `
  work\book1-ocr-benchmark\text-review-decisions.json `
  work\book1-ocr-benchmark\text-crops `
  work\book1-ocr-benchmark\text-model-dataset
```

The exporter will be widened to copy every approved/corrected meaningful text
line into `train/` and `validation/`; excluded artifacts never enter the
dataset. Each JSONL manifest stores an image path and reviewed transcription.
The split is deterministic, so model evaluations remain comparable.

## Training plan

Start a proof-of-concept after roughly 200 reviewed meaningful lines; aim for
500+ before relying on it. Include prose, headings, metadata, move numbers,
captures, checks/mates, castling, annotations, variations, and every piece
type. The primary experiment is a pretrained printed-text TrOCR checkpoint,
with its vision encoder frozen by default for CPU-friendly fine-tuning:

```powershell
python ml-model\src\train_trocr.py `
  work\book1-ocr-benchmark `
  work\book1-ocr-benchmark\trocr-current
```

The trainer uses every approved/corrected meaningful line, falling back to raw
OCR only when the reviewed field is blank (which means the raw text was
accepted). It saves its held-out metrics and best checkpoint beneath `work/`.
A downstream chess parser will identify and validate SAN spans; it is not a
second OCR model.

Keep model weights, checkpoints, and exported datasets under `work/`; they are
source-derived and must not be committed. Every predicted line returns to the
Text OCR QA page for a human decision.
