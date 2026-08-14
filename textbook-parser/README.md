# Textbook parser

An offline, review-first pipeline for turning personally owned chess-book PDFs
into candidates for Chesslab's Study from Book JSON. It is deliberately not a
web feature and does not write source text or page images into the repository.

Start with [docs/design.md](docs/design.md), then use the commands below.

## Source-book note

`book-sources/Book 1.pdf` is the current test source. It uses the same broad
layout family as the original benchmark: study pages pair prose with numbered
diagrams, then compact multi-diagram exercise pages, followed later by
solutions. The tool therefore keeps page geometry and section boundaries as
first-class evidence; do not assume that a nearby exercise diagram and its
answer live on the same page.

The sample also confirms that the embedded chess font can yield corrupted
glyphs in the PDF text layer even where ordinary prose extracts cleanly. Keep
all section text unchanged in `sections.json`; use a later figurine-aware OCR
step for complete text lines and route uncertainty to human review.

```powershell
cd textbook-parser
python -m textbook_parser render ..\book-sources\my-book.pdf work\pages --first-page 1 --last-page 12
python -m textbook_parser extract-text ..\book-sources\my-book.pdf work\layout.json --dpi 500
python -m textbook_parser section-corpus work\layout.json work\sections.json
python -m textbook_parser ocr-text work\pages work\ocr-text.json --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe"
python -m textbook_parser text-review-report work\ocr-text.json work\pages work\text-review.html
python -m textbook_parser export-notation-labels work\text-review-decisions.json work\text-crops work\text-model-dataset
python -m textbook_parser detect-boards work\pages work\boards.json
python -m textbook_parser classify-turn work\pages work\boards.json work\positions.json
python -m textbook_parser match work\positions.json work\layout.json work\links.json
python -m textbook_parser extract-sans work\links.json work\layout.json work\san-candidates.json
python -m textbook_parser review-report work\positions.json work\layout.json work\links.json work\review.html --recognition work\recognition.json --reference-book ..\backend\data\books\build-up-your-chess-1.json
python -m textbook_parser serve-review work\compare-first3
python -m textbook_parser crop-review-report work\crop-fix-v2\boards.json work\crop-fix-v2\crop-quality.html
python -m textbook_parser recognize-boards work\crop-fix-v2\positions.json work\crop-fix-v2\recognition.json --delay-seconds 6
python -m textbook_parser board-review-report work\crop-fix-v2\positions.json work\crop-fix-v2\recognition.json work\crop-fix-v2\board-review.html
python -m textbook_parser move-review-report work\crop-fix-v2\positions.json work\crop-fix-v2\recognition.json work\compare-first3\layout.json work\compare-first3\san-candidates.json work\crop-fix-v2\move-review.html
```

`positions.json` is the reviewed output of board detection/recognition. The
matcher is useful before every position has a FEN: it links a numbered diagram
to the text block that describes it, preserving page and bounding-box evidence
for review.

The only required dependencies are listed in `pyproject.toml`. Board detection
uses OpenCV when available. ChessOCR and local Ollama are optional adapters;
they are never used without an explicit CLI command.

`review-report` writes a local, filterable HTML contact sheet. It references
the already-generated crop files rather than embedding them, so keep it inside
the same ignored `work/` directory as the crops and source-derived text.
When served with `serve-review`, every edit is also saved to
`work/.../review-decisions.json` (in addition to browser storage). Exporting
still produces a portable checkpoint; pass it back with `--decisions` when
regenerating the report. Decisions never change the saved book JSON directly.

The parser never self-corrects a board, turn, move, or commentary link. A
failed or questionable recognition is surfaced in a local review page with its
source evidence. Only a human review decision can supply an approved FEN or
SAN line; the backend still validates it before it becomes book JSON.

`section-corpus` is the next text-processing boundary: it retains every
extracted text block (including chess-font glyphs) in study, exercise, and
solution sections. Interpret symbols only in a later review-gated step.

`ocr-text` is an optional local Tesseract baseline for pages whose embedded
chess font is corrupt. Its JSON is raw OCR evidence with line coordinates; it
does not overwrite the PDF text layer or infer moves.

`text-review-report` creates a focused one-line QA page: source crop beside
raw OCR and review fields. Label every meaningful line, including prose,
headings, metadata, chess notation, and mixed prose-plus-move lines. Enter
figurines using standard SAN letters (`K`, `Q`, `R`, `B`, `N`). Mark only board
fragments, coordinates, decorative elements, empty crops, and unusable garbage
as `board artifact` or `not text`, then exclude them. When served with
`serve-review`, edits persist to a dedicated local decisions JSON file.

The optional local chess-notation model, its dataset exporter, and all
model-specific guidance live in [ml-model/README.md](ml-model/README.md).
