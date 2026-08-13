# Study from Book — data format & extraction pipeline

Covers: the `Book`/`Chapter`/`Item` JSON schema the backend loads and serves, how that data gets
produced from a source PDF, and the ChessOCR API used as a cross-check during extraction.

## 1. Copyright approach (read this before adding another book)

Source PDFs live in `book-sources/` (gitignored) — personal, purchased copies, never committed.
Derived data lives in `backend/data/books/` (also gitignored). What actually goes into that derived
JSON matters:

- **FEN positions and SAN/UCI move sequences are facts, not copyrightable expression** — these are
  extracted directly from the book's diagrams and solution lines and stored as-is.
- **Every `prompt` and `note` string is original text, written fresh for the app** — never a
  transcription, paraphrase, or "lightly edited" version of the book's own prose. The book's actual
  explanatory paragraphs, game annotations, and commentary are never stored anywhere in this
  pipeline or its output.
- **"Show solution" plays the real move sequence on the board, not book text** — same reasoning
  applies to any future in-app "reveal" feature. If a request ever asks for the book's literal
  wording, the correct response is the same original-explanation pattern already used everywhere
  else here, not a copy.

## 2. `Book` / `Chapter` / `Item` schema

Mirrors `backend/internal/book/types.go` field-for-field (the Go structs already carry `json` tags,
so there's no separate DTO layer the way `internal/repertoire` needs one for its move-tree).

```jsonc
{
  "id": "build-up-your-chess-1",
  "title": "Build Up Your Chess 1: The Fundamentals",
  "author": "Artur Yusupov",
  "chapters": [
    {
      "id": "buyc1-ch1",
      "number": 1,
      "name": "Mating motifs",          // short factual chapter title, not book prose
      "items": [
        {
          "id": "buyc1-ch1-lesson-1",
          "chapterId": "buyc1-ch1",
          "type": "lesson",              // "lesson" | "puzzle"
          "fen": "6k1/8/p7/r1r2Pp1/3R2Pp/1p6/1P4P1/3R2K1 w - - 0 1",
          "sideToMove": "w",              // must agree with the FEN's own side to move
          "prompt": "White to move. Play through the line and see how the rooks force the king to the edge of the board.",
          "solution": ["Rd8+", "Kg7", "R1d7+", "Kf6", "Rf8+", "Ke5", "Re8+", "Kf4", "Rd4+", "Kg3", "Re3#"],
          "solutionUci": ["d4d8", "h8g7", "d1d7", "g7f6", "d8f8", "f6e5", "f8e8", "e5f4", "d7d4", "f4g3", "e8e3"],
          "note": "Two rooks alone can hunt a lone king down: each check cuts off a rank or file, herding the king toward a corner until it runs out of squares."
        }
      ]
    }
  ]
}
```

- `solution` (SAN) is what's authored by hand during extraction; `solutionUci` is **derived at
  backend load time**, not written by hand — see §3.
- `note` is optional; when present it's shown once the item's content is revealed (lesson started,
  or puzzle solved/revealed).
- Lesson items always carry a full `solution` (the book's own worked line, replayed move by move on
  start). Puzzle items carry the line the book gives as the answer; the user is never forced to
  match it move-by-move to make progress — see root `CLAUDE.md`'s "Study from Book" section for why
  puzzles are free-play rather than strict-match.

## 3. Backend loading & the legality QA gate

`internal/book.LoadDir` (mirrors `internal/repertoire.LoadDir`'s glob-and-skip-on-error shape, closer
in spirit to `coach.LoadIndex`'s "load one finished JSON" since there's no PGN to parse) unmarshals
each `*.json` in the books directory, then **validates every item**:

1. `chess.ParseFEN` — the FEN must actually parse.
2. `sideToMove` must agree with the FEN's own side-to-move field.
3. Every `solution` move is replayed via `chess.FindLegalMoveBySAN` + `chess.ApplyMove`, ply by ply,
   from the item's FEN — an illegal or misspelled move is a hard load error naming the exact chapter
   and item, not a silently-skipped one.
4. **`solutionUci` is derived during this same replay**, not authored — each SAN ply's resolved
   `chess.Move` gets recorded as its UCI form (`internal/book/load.go`'s `validateBook`). The
   frontend needs UCI (`from`/`to` squares) to actually play a move via the same `makeMove` endpoint
   normal play uses; SAN alone isn't enough to drive that.

This is the QA gate that catches transcription mistakes made while reading a diagram — see §5 for
two real examples it caught (and one it couldn't).

## 4. Extraction pipeline (how a chapter actually gets produced)

There is no OCR/automation step that goes straight from PDF to JSON — book diagrams here use a
figurine line-art style, not a photo of a physical board or a lichess/chess.com-style digital
render, and the PDF's own text layer is unreliable for this font (garbled substitutions observed,
e.g. "typical" extracting as "rypical"). The actual pipeline:

1. **Render pages to images.** `book-sources/render_pages.py` (gitignored, generic PDF-page-to-PNG
   utility — no book content in the script itself) wraps `pypdfium2` to render a page range at a
   given DPI into a scratch directory. Diagrams get individually cropped from these renders (higher
   DPI — 500–900 — for anything ambiguous) rather than fed to anything at low resolution. Crop
   generously around each diagram (include the label and a margin on every side) — the API detects
   the board's own bounding box within the submitted image, so a tight/clipped crop is the actual
   failure mode (see below), not a loose one.
2. **Read every diagram's board layout via the ChessOCR API (§5) — this is the sole board-reading
   method now, not a hand-read.** Run `book-sources/chessocr.py <crop>.png` for each diagram and take
   its board-layout FEN as the piece placement, full stop — do not additionally hand-derive a FEN
   from the image yourself and cross-check the two. (An earlier version of this pipeline did a
   hand-read plus an API cross-check; that's been dropped in favor of API-only, on the reasoning that
   a second manual read is the effort this step exists to save.) If the API fails to detect a board
   or the crop looks suspicious (clipped rank, wrong image), re-crop wider — a too-tight crop that
   clips a rank returns a *plausible-looking wrong* FEN (an `8` empty-rank where the real rank has
   pieces) rather than an obvious error, so a suspiciously clean-looking result is still worth a
   second look at the crop bounds, not the board itself. Still read by eye, since the API doesn't
   return them: side-to-move (the small △/▼ triangle next to each diagram — white/black to move
   respectively) and the solution's SAN sequence, transcribed from the accompanying text.
   **Known gap with API-only reading:** §5.2 records a case where the API's own read was wrong on a
   piece color, and it went uncaught until the downstream move-simulation step (§4.3, next) failed to
   parse a resulting move — that step remains the real backstop now that there's no second human read
   to catch a bad API result directly, so don't skip it.
3. **Simulate the full solution line with a rules engine before trusting a mate claim — and check
   canonical SAN, not just legality.** For any solution ending in `#`, don't rely on manual
   read-through to confirm it's genuinely checkmate (`backend`'s own load-time validation only checks
   that each move is *legal*, not that a claimed mate actually is one). Verify with `python-chess`:
   ```python
   import chess
   b = chess.Board("<fen> <turn> <castling> - 0 1")
   for san in ["Rxe4", "dxe4", "..."]:
       m = b.parse_san(san)
       assert b.san(m) == san, f"backend needs exact SAN — got {b.san(m)!r}"
       b.push(m)
   assert b.is_checkmate()
   ```
   **The `b.san(m) == san` check is not optional** — `parse_san` is lenient (it accepts an
   unnecessary disambiguation prefix, like `Raf1` when only one rook can actually reach `f1`, and
   silently resolves it) but the backend's `FindLegalMoveBySAN` requires an exact string match
   against its own generated canonical SAN (see backend `CLAUDE.md`'s "Repertoire parsing" section —
   the same exactness requirement that fixed the `Bxc6`/`bxc6` case-sensitivity bug applies here).
   Skipping this check is how two real bugs got through chapter 2's own `python-chess` pass and only
   surfaced when the Go backend's `LoadDir` actually rejected them: an over-disambiguated `Raf1`
   (should've been plain `Rf1` — the other rook was pinned to its own king and couldn't legally reach
   f1 at all) and a missing check symbol on `Rxe4` (the capturing rook opened direct fire on a king
   that, at that point in the line, hadn't castled away from e8 yet — easy to miss when skimming the
   book's own prose, which had also omitted it because the author's next line was the recapture).
   This also catches castling-rights mistakes in the hand-built FEN (a `parse_san` failure on `O-O`
   is usually a missing `K`/`Q`/`k`/`q` in the FEN, not an illegal move in the book). **Fastest way to
   run this for a whole chapter at once:** load the actual JSON file being edited and validate every
   item's `fen`/`solution` in one pass, rather than a hand-copied per-item snippet — that's what
   caught these two, since a snippet copied by hand from notes can silently drift from what's
   actually in the file.
4. **Write original `prompt`/`note` text** per item — never copied/paraphrased from the book (§1).
5. **Run the backend's `LoadDir` validation** (§3) as the final gate before considering an item done.

## 5. ChessOCR API (third-party, not part of this repo)

A hosted chess-diagram-recognition service, used purely as a second opinion during extraction — not
integrated into the running app, not something this repo controls or is responsible for uptime/
correctness of.

```
POST https://helpman.komtera.lt/predict
Content-Type: multipart/form-data
  file: <binary image>   # the field name is exactly "file"
```

Response:
```jsonc
{
  "results": [
    {
      "fen": "6k1/8/p7/r1r2Pp1/3R2Pp/1p6/1P4P1/3R2K1",  // board layout only — 4 FEN fields, not 6
      "xc": 0.565, "yc": 0.423, "width": 0.699, "height": 0.709  // detected board's bbox within the submitted image, normalized 0-1
    }
  ],
  "status": 0,
  "id": "20260807160154009",
  "message": null
}
```

- `fen` is **board layout only** — no side-to-move, castling rights, or en passant fields. Those
  three (especially side-to-move, driven by the diagram's own △/▼ symbol) still have to be read by
  hand and appended before the FEN is usable.
- No documented rate limit or auth requirement observed; treat it as a courtesy, not a guaranteed
  SLA — it's someone else's server (`https://helpman.komtera.lt/chessocr/` is the human-facing page
  this endpoint backs; no public API docs beyond what's captured here).
- `book-sources/chessocr.py` (gitignored alongside `render_pages.py` for the same reason — pure
  utility code, no book content) wraps the POST above as a one-line `predict(image_path) -> str`
  call, so a future extraction session doesn't need to reconstruct the multipart request by hand.

### 5.1 Known limitation

The API returns *a* legal-looking board layout; it does not know which pieces are meant to be
bystanders versus part of the puzzle's actual solution, and it can't tell you if a diagram was
misread in a way that still parses as a valid position. Cross-checking against it is a second
independent read, not a proof of correctness on its own — the backend's move-legality validation
(§3) is what actually catches "this piece's color is wrong but the position still looks plausible."

### 5.2 Real mistakes it caught during Chapter 1 extraction

- A lesson diagram's black king was hand-read as h8; the API (and a closer re-read of the same crop)
  showed it was actually on g8. The move sequence given in the book was legal either way (a rook
  check along the back rank doesn't distinguish the two squares), so this was **not** caught by the
  backend's legality validator — only the independent second read caught it.
- A puzzle diagram had a queen hand-read as white; it was actually black. That queen never moves in
  the puzzle's own solution line, so — same as above — the legality validator had nothing to catch;
  only the cross-check surfaced it.

Both are now examples of why extraction should always cross-check bystander pieces, not just the
ones directly involved in a solution line — those are exactly the pieces the legality gate can't see.
