# Textbook parser design

## Goal and boundary

This is an **offline authoring tool**, not a runtime part of Chesslab. It
produces reviewable candidate data for the existing `backend/internal/book`
legality gate. Purchased PDFs, rendered pages, OCR text, crops, and candidate
JSON stay under `textbook-parser/work/` (ignored by Git). Final app content
must continue to use fresh, original `prompt` and `note` text; this tool must
not copy book commentary into the app.

## What is matched

Every detected diagram receives a stable ID, page, board bounding box, a crop
path, an optional label, optional piece-layout FEN, and triangle classification.
Every text block retains its page and bounding box. This geometry is essential:
labels alone are not enough when a study page has two diagrams and two lines
side by side.

There are two matching modes.

| Mode | Diagram source | Candidate text | Primary rule |
| --- | --- | --- | --- |
| `study` | A diagram embedded in instructional prose | Blocks on the same page, then nearby pages | Same explicit number; otherwise spatial proximity (same column first) |
| `exercise` | A numbered exercise diagram | Blocks under a Solutions heading, often on following pages | Exact exercise number and a solution section; page order breaks ties |

The parser never guesses an exercise answer just because it is close on a page.
When a label is absent or ties, it writes an `ambiguous` review item instead
of creating a link.

## Pipeline

1. **Render** source pages at 400-600 DPI.
2. **Extract a section corpus** with PDF word coordinates. Preserve every text
   block, including symbols, unusual glyphs, and OCR damage, in its original
   page/section/geometry context. This inexpensive first pass is the source
   evidence for later processing, even when the PDF's chess font substitutes
   figurines with corrupted glyphs. Do not discard blocks merely because they
   are not immediately parseable as prose or SAN.
   When that text layer corrupts chess-font glyphs, `ocr-text` may create a
   second, raw Tesseract evidence layer from rendered pages. It likewise
   preserves lines and coordinates only; it does not choose between OCR and
   PDF text, recognise moves, or repair symbols.
3. **Propose boards** from large square image contours. A scanned outer board
   border may be broken into overlapping partial grid contours, so those are
   merged into a completed square before a crop is emitted. Completed boards
   below the configured physical pixel size are rejected as text/layout
   fragments. Each accepted crop includes a generous top margin so the
   side-to-move triangle is retained.
4. **Read board and turn.** Submit a crop to ChessOCR for piece placement.
   The local triangle heuristic returns `w`, `b`, or `unknown`; it must not
   invent an answer on weak evidence.
5. **Link position to text.** Use numbered labels plus page geometry and
   section headings (`Exercises`, `Solutions`, etc.). A small manifest can
   mark page ranges as `study`, `exercise`, or `solution` where book layout is
   nonstandard.
6. **Extract SAN candidates** from the linked text. Candidates are evidence,
   never a solution line.
7. **Review the queue.** A missing or structurally implausible OCR board,
   unknown turn, ambiguous link, missing move candidate, or move that cannot
   be reconciled with the reviewed position opens a local review UI. The tool
   must flag and preserve evidence; it must never guess, repair, or
   auto-approve a FEN, turn, move, or commentary association. A person enters
   every correction and approval. Existing backend validation remains the
   final mandatory check before book JSON is created.

## Local Ollama policy

Do not send whole pages to a vision LLM. More importantly, do not use an LLM
to self-review or correct a flagged board or move. A local model may only be
run explicitly to expose additional evidence for the human; it cannot alter a
matching decision, FEN, turn, or move sequence.

## Optional recognition adapters

`read-board` sends only an already-cropped board diagram to the existing
ChessOCR endpoint and records its four-field piece placement. `ollama-review`
sends exactly one crop (or one small text snippet) to a local Ollama instance;
it requires a vision model and requests a schema-validated, low-temperature
answer. Neither command runs as part of `render`, `detect-boards`, or `match`;
neither may write a correction into final data.

`extract-sans` gathers the lines referenced by each confirmed link and emits
normalised *candidate* SAN tokens alongside the source block IDs. It does not
declare a line correct. A later validation stage must add the reviewed
side-to-move/castling fields to the board layout and replay every candidate
move with `python-chess` and the backend's canonical SAN validator.

## Output contracts

`layout.json` is a list of positioned text blocks. Its coordinates are scaled
to the same DPI as rendered pages (500 by default), so spatial matching never
mixes PDF points with PNG pixels:

```json
{"page": 12, "text": "Diagram 7 ...", "bbox": [72, 120, 290, 155]}
```

`sections.json` groups every `layout.json` block into contiguous study,
exercise, and solution ranges. It is deliberately lossless: downstream
figurine-aware OCR or move parsing reads this corpus and sends uncertain
results to review instead of replacing the preserved source text.

`positions.json` is a list of diagram records. `label`, `fen`, and
`sideToMove` are nullable until reviewed:

```json
{"id":"p012-01","page":12,"bbox":[90,210,510,630],"label":"7","kind":"study"}
```

The matcher accepts both simple exercise labels (`12`) and study labels
(`1-6`). It infers a missing label only from an immediately adjacent caption
with a recognised `Diagram 7`/`Exercise 7` form. Its inferred label is an
evidence reason in `links.json`, not a replacement for human review.

For a confirmed anchor caption, `textBlockIds` includes the contiguous text
lines in its column up to the next numbered anchor. This ties the position to
the associated move sequence and commentary while keeping the original layout
evidence available for later SAN extraction and review.

`links.json` contains the selected text block plus evidence. An `ambiguous`
record always contains candidates and reasons, so review does not require
re-running extraction.
