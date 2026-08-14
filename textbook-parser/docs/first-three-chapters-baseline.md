# First three chapters: baseline parser comparison

**Run date:** 2026-08-13  
**Source:** *Build Up Your Chess 1: The Fundamentals*, PDF pages 9-43  
**Reference data:** `backend/data/books/build-up-your-chess-1.json`, chapters 1-3  
**Scope:** read-only comparison. No source PDF, parser code, or saved book JSON
was changed by this test.

## Method

1. Rendered PDF pages 9-43 at 500 DPI.
2. Used local OpenCV board-candidate detection and local triangle classification.
3. Extracted positioned PDF text, inferred diagram labels, and matched candidate
   diagrams to nearby or later numbered text.
4. Submitted each already-cropped board candidate to ChessOCR for its
   piece-placement FEN.
5. Compared ChessOCR's four-field piece placement exactly with the saved
   item's FEN piece-placement field. Compared detected triangle turn with the
   saved FEN turn only when the board placement matched exactly.

ChessOCR initially returned many `502`/timeout failures when run in parallel.
The complete result below came from paced retries: one request at a time, a
six-second pause between requests, checkpointing after every crop. All 78
requests ultimately succeeded.

## Results

| Chapter | Saved Study items | Board candidates | Exact saved-board matches | Correct detected turn among matches |
| --- | ---: | ---: | ---: | ---: |
| 1: Mating motifs | 25 | 27 | 24 | 23 / 24 |
| 2: Mating motifs 2 | 24 | 30 | 21 | 15 / 21 |
| 3: Basic opening principles | 21 | 21 | 20 | 14 / 20 |
| **Total** | **70** | **78** | **65** | **52 / 65** |

Board/FEN coverage is **65/70 (92.9%)**. The detector yielded 78 board
candidates, of which 13 did not exactly match any saved Study item. These are
not automatically false positives: some are likely valid instructional or
illustrative diagrams that were intentionally not selected as lessons/puzzles.
They need classification before using candidate count as a precision metric.

## What worked

- The board-crop detector found diagrams reliably enough to recover 65 of the
  70 positions already curated for Study from Book.
- ChessOCR returned a usable board layout for every paced request. The earlier
  failures were service/rate-limit behavior, not a permanent crop failure.
- Turn detection was correct for 52 matched positions. Its use of triangle
  orientation handles the book's outlined upward white marker and filled
  downward black marker.
- A study-page smoke test correctly linked side-by-side diagrams to the
  matching right-hand numbered commentary column when an explicit label such
  as `Diagram 1-6` was available.

## Known gaps

### Board recognition

Five saved positions had no exact ChessOCR board match:

- `buyc1-ch1-lesson-1`
- `buyc1-ch2-lesson-1`
- `buyc1-ch2-lesson-2`
- `buyc1-ch2-lesson-8`
- `buyc1-ch3-lesson-6`

`buyc1-ch2-lesson-8` had a detected board only one square different from its
saved piece placement. That strongly suggests a single-piece recognition error
rather than a missed board. The other four need visual crop inspection before
deciding whether their issue is crop detection, ChessOCR recognition, or a
reference-data/page-range mismatch.

### Side to move

Among the 65 exact board matches, the triangle classifier was:

- correct: 52
- unknown: 12
- incorrect: 1

The classifier must therefore remain review-gated. `unknown` must never be
converted into a FEN turn by guesswork, and the one incorrect result confirms
that a high-confidence-looking geometric marker can still be a false match.

### Position-to-text matching

The matcher marked only 26 of the 65 exact board matches as confidently
`linked`; 39 were intentionally marked `ambiguous`. It is conservative, which
is desirable when associating a move line or commentary with a board, but it
is not yet sufficient for automated book-item creation.

This reflects real layout complexity:

- Side-by-side study diagrams may have a left caption, a repeated right
  caption, a game header, and a multi-line explanation.
- Some pages place several diagrams in one column.
- Exercise positions may be collected on one page while their numbered
  solutions appear later.
- PDF text extraction contains figurine/font substitutions and can split or
  merge visual lines.
- Move text uses chess figurines (for example, piece symbols before a square)
  alongside ordinary prose. Generic text extraction/OCR therefore cannot be
  trusted to preserve SAN: it may substitute or drop the figurine, merge it
  with a move number, or turn it into an unrelated glyph. A future text stage
  must be chess-aware and validate its output against legal moves; this is not
  currently a reviewable source of truth.

## Next work, in order

1. **Fix full-diagram cropping.** Validate an 8-by-8 grid before accepting a
   board candidate; reject partial square contours and derive the complete
   outer board boundary from its grid spacing before adding label/triangle
   margin. This is the active priority.
2. **Repeat the board benchmark.** Keep the same chapter-1-to-3 reference set
   and report board coverage, turn accuracy, link confidence, and false/extra
   candidates after each substantial cropping change.
3. **Build a review report.** Once crops are correct, use the contact sheet to
   inspect remaining FEN/turn exceptions efficiently.
4. **Improve label/caption association.** Treat repeated study labels and
   game headers as a single position group; collect the following right-column
   commentary until the next label in that column.
5. **Add exercise/solution page-range awareness.** Use chapter headings and
   solution headings to link a numbered exercise only to its later matching
   answer, rather than relying on generic spatial scoring.
6. **Add chess-guided text recognition.** Preserve figurines or normalise them
   into piece letters, then validate each candidate SAN sequence through a
   rules engine. Do not accept generic OCR output as a solution line.
7. **Evaluate a local fallback.** Use local Ollama vision only for the review
   queue (unknown/wrong triangle, failed or near-miss board recognition, or
   unreadable chess-aware text crop); do not use it for whole-page parsing.

## Crop-only follow-up: 2026-08-13

The original generic square-contour detector produced 78 candidates. Visual
inspection showed that several were fragments of the same board: a scan's
broken outer border let Canny detect separate 3-4-square regions instead of
the complete 8-by-8 diagram. Any ChessOCR result from such a fragment is
invalid by construction.

The detector now merges touching/overlapping square-grid fragments before it
creates a crop, then rejects completed candidates whose shortest edge is below
700 pixels at the benchmark's 500 DPI render. This preserves small fragments
as evidence while preventing them from being emitted as boards.

| Chapter | Full-diagram crops after fix | Curated Study items |
| --- | ---: | ---: |
| 1 | 25 | 25 |
| 2 | 25 | 24 |
| 3 | 21 | 21 |
| **Total** | **71** | **70** |

The one-crop surplus in chapter 2 is a full, legitimate diagram that is not
one of the currently curated Study items; it is no longer a partial-contour
false positive. The crop contact sheet showed every one of the 71 emitted
candidates with the complete board, diagram label, and turn marker visible.
No text extraction or ChessOCR rerun was performed as part of this crop-only
follow-up.
   report board coverage, turn accuracy, link confidence, and false/extra
   candidates after each substantial change.

## Verification

The parser unit suite passed after the comparison:

```text
Ran 9 tests
OK
```

The temporary renders, crops, raw layout extraction, and recognition outputs
are in ignored `textbook-parser/work/compare-first3/`. They are deliberately
not source-controlled because they contain rendered book pages and derived
book text.
