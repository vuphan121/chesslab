# Study from Book

The Study from Book page is a reader and free-play board workspace. A student
selects a section, sees the corresponding PDF page, and explores the supplied
position on the board. Their move tree exists only for that browser session;
changing sections starts a fresh board.

## Study activity tracking

The first successful move in a lesson or puzzle records one activity event for
the authenticated student. Events are deduplicated to one per user, book,
chapter, item, and UTC clock hour, so repeated moves, tabs, and request retries
do not inflate the count. Each event keeps the book/chapter context, the item
type (`lesson` or `puzzle`), and its server timestamp. Activity is separate
from completion: a student can explore freely without marking an item complete.

## Content and copyright

- Purchased source PDFs are private. The master PDF used for local preparation
  is `book-sources/Book 1.pdf`; it is gitignored and must never be committed.
- The app stores only structured chess facts (FEN, side to move, chapter/item
  identifiers, and optional source-page numbers) plus app-authored labels.
- Production book records live in Neon Postgres. Chapter PDFs live in the
  private Backblaze B2 bucket configured by `B2_*` environment variables and
  are streamed only after the app's normal authentication check.

## Active data model

`Book` contains chapters; every item is a `lesson` or `puzzle` with a FEN and
`sideToMove`. The client uses that position as a free-play starting point. It
does not load a prepared book line, reveal a solution, or persist the moves a
student makes.

```jsonc
{
  "id": "example-book",
  "title": "Example",
  "author": "Author",
  "chapters": [{
    "id": "example-ch1",
    "number": 1,
    "name": "Chapter 1",
    "items": [{
      "id": "example-ch1-1",
      "chapterId": "example-ch1",
      "type": "lesson",
      "fen": "...",
      "sideToMove": "w",
      "sourcePage": 12,
      "bookPage": 14,
      "masterPDFPage": 12
    }]
  }]
}
```

The backend validates each FEN and confirms that `sideToMove` matches the FEN.
Before validating, it rewrites each FEN's castling field from piece placement
(`chess.NormalizeSetupCastling`). A diagram doesn't show castling rights, so a
king and rook still on their home squares are assumed able to castle, and a
claimed right whose king or rook isn't home is dropped. Extraction doesn't need
to get the castling field right.
`sourcePage` is chapter-local (for the reader), while `bookPage` and
`masterPDFPage` preserve the original physical location for diagram extraction
and review.
Each chapter is stored separately under
`books/<book-id>/chapter-<number>.pdf`. The reader requests only
`/api/books/{id}/chapters/{chapterId}/source.pdf`, never a whole-book file or
a client-supplied object name. The backend authenticates to B2 and streams the
chapter bytes; neither B2 keys nor B2 download tokens reach the browser.

## Build Up Your Chess 1 source-page map

The table below is the canonical page map for the private master file
`Book 1.pdf` (263 physical PDF pages). `Book page` is the printed page number
visible in the book; `master PDF` is its 1-based physical page in the source
file. The first numbered page has an offset of two: `master PDF = book page -
2`.

The `chapter PDF` column is 1-based inside the individually stored object.
When recording a future diagram/board extraction, save all three values:
`bookPage`, `masterPDFPage`, and `chapterPDFPage`. For a diagram on chapter
page `n`, derive `masterPDFPage = chapterStartMasterPDFPage + n - 1` and
`bookPage = masterPDFPage + 2`. This avoids losing the actual book location
when a chapter is later re-exported or parsed.

| # | Chapter | Object | Book pages | Master PDF pages | Chapter PDF pages |
| --- | --- | --- | --- | --- | --- |
| 1 | Mating motifs | `books/build-up-your-chess-1/chapter-1.pdf` | 8-17 | 6-15 | 1-10 |
| 2 | Mating motifs 2 | `books/build-up-your-chess-1/chapter-2.pdf` | 18-29 | 16-27 | 1-12 |
| 3 | Basic opening principles | `books/build-up-your-chess-1/chapter-3.pdf` | 30-43 | 28-41 | 1-14 |
| 4 | Simple pawn endings | `books/build-up-your-chess-1/chapter-4.pdf` | 44-53 | 42-51 | 1-10 |
| 5 | Double check | `books/build-up-your-chess-1/chapter-5.pdf` | 54-63 | 52-61 | 1-10 |
| 6 | The value of the pieces | `books/build-up-your-chess-1/chapter-6.pdf` | 64-73 | 62-71 | 1-10 |
| 7 | The discovered attack | `books/build-up-your-chess-1/chapter-7.pdf` | 74-81 | 72-79 | 1-8 |
| 8 | Centralizing the pieces | `books/build-up-your-chess-1/chapter-8.pdf` | 82-91 | 80-89 | 1-10 |
| 9 | Mate in two moves | `books/build-up-your-chess-1/chapter-9.pdf` | 92-99 | 90-97 | 1-8 |
| 10 | The opposition | `books/build-up-your-chess-1/chapter-10.pdf` | 100-109 | 98-107 | 1-10 |
| 11 | The pin | `books/build-up-your-chess-1/chapter-11.pdf` | 110-119 | 108-117 | 1-10 |
| 12 | The double attack | `books/build-up-your-chess-1/chapter-12.pdf` | 120-127 | 118-125 | 1-8 |
| 13 | Realizing a material advantage | `books/build-up-your-chess-1/chapter-13.pdf` | 128-137 | 126-135 | 1-10 |
| 14 | Open files and Outposts | `books/build-up-your-chess-1/chapter-14.pdf` | 138-147 | 136-145 | 1-10 |
| 15 | Combinations | `books/build-up-your-chess-1/chapter-15.pdf` | 148-155 | 146-153 | 1-8 |
| 16 | Queen against pawn | `books/build-up-your-chess-1/chapter-16.pdf` | 156-163 | 154-161 | 1-8 |
| 17 | Stalemate motifs | `books/build-up-your-chess-1/chapter-17.pdf` | 164-171 | 162-169 | 1-8 |
| 18 | Forced variations | `books/build-up-your-chess-1/chapter-18.pdf` | 172-181 | 170-179 | 1-10 |
| 19 | Combinations involving promotion | `books/build-up-your-chess-1/chapter-19.pdf` | 182-191 | 180-189 | 1-10 |
| 20 | Weak points | `books/build-up-your-chess-1/chapter-20.pdf` | 192-201 | 190-199 | 1-10 |
| 21 | Pawn combinations | `books/build-up-your-chess-1/chapter-21.pdf` | 202-211 | 200-209 | 1-10 |
| 22 | The wrong bishop | `books/build-up-your-chess-1/chapter-22.pdf` | 212-221 | 210-219 | 1-10 |
| 23 | Smothered mate | `books/build-up-your-chess-1/chapter-23.pdf` | 222-231 | 220-229 | 1-10 |
| 24 | Gambits | `books/build-up-your-chess-1/chapter-24.pdf` | 232-243 | 230-241 | 1-12 |

The final test (book pages 244-251 / master PDF pages 242-249) and appendices
are intentionally not chapter objects yet. They need their own section IDs in
the study data before the reader can request them.

### Chapter 2 board-location audit

Chapter 2 (Mating motifs 2) was rendered from master PDF pages 16-27 and
checked against the existing study data. The external board recognizer found
27 diagrams on book pages 18-25. All 24 existing Chapter 2 lesson/puzzle
items matched one OCR piece placement uniquely and now store `sourcePage`,
`bookPage`, and `masterPDFPage` in Neon.

Three additional diagrams are valid board positions but are not currently a
lesson or puzzle. They remain unassigned until their intended study treatment
is chosen:

| Diagram ID | Book page | Master PDF page | Chapter PDF page | Piece placement |
| --- | --- | --- | --- | --- |
| `buyc1-ch2-p017-02` | 19 | 17 | 2 | `q1r1k2r/1b3pp1/p3p3/P1b4n/1pN1P2p/3BBP2/1P2Q1PP/R4R1K` |
| `buyc1-ch2-p017-03` | 19 | 17 | 2 | `q1r4r/1b2kpp1/p3p3/P1b5/1pN1P3/3BBPp1/1P4P1/R3QRK1` |
| `buyc1-ch2-p019-02` | 21 | 19 | 4 | `r1bq1rk1/ppp2ppp/2n5/6NQ/2BPp3/2P5/P4PPP/R1B3K1` |

## Offline board-parser workflow

The production app does not perform PDF-to-position extraction. The tracked,
opt-in admin tool at `tools/book-board-parser/` is for preparing a chapter
locally. It renders only the requested master-PDF page range, locates boards,
assigns a consecutive `chapter-diagram` number in visual reading order, reads
the outlined turn triangle, and submits tight board crops to ChessOCR for the
piece placement.

The tool enforces a five-second minimum between recognition requests and saves
a checkpoint after every crop, so an interrupted run can resume without
repeating successful calls. Its local rendered pages, crops, checkpoint, and
JSON review output belong under `tools/book-board-parser/work/` or `tmp/` and
are gitignored. It never uploads source PDF pages or writes application data.

Run it with `--validate-api http://localhost:8080` to compare the extracted
piece placements and sides to move against the current Neon records. Validation
only reports counts; new/extra diagrams remain review candidates until someone
explicitly seeds them as book items. The Chapter 1 and Chapter 2 baseline runs
produced 25/25 and 24/24 existing-record FEN and turn matches respectively;
Chapter 2 also contains three recognized diagrams not yet used as study items.

Older PaddleOCR/TroCR labeling and fine-tuning experiments remain retired. They
are neither a production dependency nor part of the offline parser.

### Importing parsed positions into Neon

`backend/cmd/importparsedboards` is the scalable follow-up to the offline
parser. It reads the ignored parser output, preserves the existing Chapters 1
and 2 record data in Neon, and replaces only Chapters 3-24 with validated
free-play lesson items. Every imported item has a source-page triple and the
original app-authored prompt `Explore the position on the board.`; it does not
copy book prose or invent a puzzle solution.

The importer is a dry run by default. `--apply` is required to upsert the
merged book data. A parsed diagram is excluded unless it has both a structurally
valid piece placement and a `w`/`b` side to move. To review exclusions, run
`tools/book-board-parser/review_failures.py` and then
`review_server.py`; the local page saves accepted corrections in ignored
`work/review/overrides.json`. Re-running the importer with that override file
includes only those accepted corrections. This makes a later book import
repeatable without ever hand-editing the production JSON blob.

## Grandmaster Preparation: Positional Play

`book-sources/positional_play.pdf` (312 physical pages) is a scan with no text
layer or bookmarks, so chapters were located by reading page headings with an
OCR library; master PDF page = printed page + 1. Boards are found with OpenCV and
read by ChessOCR through `tools/book-board-parser/parse_positional_play.py`
(resumable, same 5.2 s pacing as Build Up Your Chess 1).

| # | Chapter | Master PDF pages | Object |
| --- | --- | --- | --- |
| 1 | Introduction (three questions) | 12-23 | `books/positional-play/chapter-1.pdf` |
| 2 | Weaknesses | 24-71 | `.../chapter-2.pdf` |
| 3 | Pieces | 72-119 | `.../chapter-3.pdf` |
| 4 | Prophylaxis | 120-151 | `.../chapter-4.pdf` |
| 5 | Exercises and Solutions (one app chapter) | 152-309 | `.../chapter-5.pdf` |

Only the exercise diagrams carry a turn triangle. In-text and solution
diagrams do not, so every diagram without a detected marker is stored as White to
move, and the board header's "White to move" label is a button that switches the
side (it resets the position). Castling rights are assumed by the backend.

Pipeline: `parse_positional_play.py` -> `split_positional_play.py` (chapter PDFs)
-> `go run ./cmd/uploadbookchapter <pdf> positional-play <n>` per chapter ->
`go run ./cmd/importpositionalplay [--apply]` (dry run by default).

### Positional Play: author solutions and commentary (Solutions chapter only)

`tools/book-board-parser/commentary_parser.py` reads the Solutions pages (master
PDF 178-309) with rapidocr. The scan has no text layer and plain OCR drops the
piece figurines, so the tool matches each figurine glyph to templates in
`figurine_templates.npz`, paints the piece letter over it, then OCRs. Games are
split at the "N. White - Black" headings; the start position is the first
diagram under the heading (already read by ChessOCR). `python-chess` builds a
move tree: a move that is not legal is dropped, never guessed. Main line vs
variation is a heuristic (a line starting a text line is main unless that
position already has a main move). Each node keeps `before`/`after` commentary
and the `!?` marks. `--repair` tries one-piece edits to the OCR start position
when many moves fail (27 games were adjusted this way).

Result (150 games, 5347 moves): 37 games parse completely, 24 more fail at most
10% of moves, and 42 fail over 30%. `importpositionalplay` attaches the tree
(`Item.line`) only when at most `--max-failed-ratio` (default 0.10) of a game's
moves failed: 61 of 150 exercises. The board page shows these through
`BookLineView.tsx` (main line inline, variations indented, comments between the
moves). Known weak spots: ChessOCR misreads annotated diagrams (circles and
arrows read as pieces) and two-column reading order can split a game's score.

### Positional Play: corrections and later additions

- **Page ranges:** Exercises start on master page 152 (intro) with exercises 1-6 on
  page 153; Prophylaxis is 120-151. An earlier cut at page 154 made the Exercises PDF
  open at exercise 7.
- **Diagram order:** the book is two-column, so diagrams are numbered down the left
  column then the right (`parse_positional_play.py` patches the board sorter; the
  shared `book_board_parser` still sorts row by row for Build Up Your Chess). Item N
  of the Exercises chapter is exercise N.
- **Exercise puzzles (local only):** `importpositionalplay --exercise-puzzles` turns
  an exercise into a `puzzle` carrying the author's line when its diagram matches a
  Solutions game (exact placement, else the unique closest within 3 squares): 51 of
  150. The board page hides the line until "Show solution" and says whether the first
  move played is the author's. `--out file.json` writes the book without touching
  Neon; the local server loads it over the database copy when `BOOKS_OVERLAY_PATH`
  points at the folder (in-memory only). Nothing in Neon contains puzzle items.
- **Board page:** "Hide sidebars" (wide screens) hides the chapter list and the PDF
  column; the board grows to fit the window (up to 112 px squares, fitted to the window height like the Puzzles
  page) and is centered. The choice is kept in
  `localStorage` (`book-study-sidebars-hidden`). The chapter list scrolls inside its column.
- **Solutions chapter = one item per exercise:** only the diagram each game starts
  from is imported (150 items, "Exercise N", same numbering as Exercises); diagrams
  inside the analysis are dropped. Games without a parsed line take their side to move
  from the game's first move.
- **Author lines show moves only:** the OCR'd prose commentary is not displayed
  (it was unreliable); `BookLineView` renders moves, variations and `!?` marks. It
  scrolls inside its own box, so stepping through moves never scrolls the page.
- **Exercises and Solutions are one chapter (5):** 150 exercise items; the PDF
  (`chapter-5.pdf`, master pages 152-309) holds both. Each item has `solutionPage` (the
  page where the author's solution starts); the "View solution" button jumps the PDF
  there ("Back to exercise" returns) and, for puzzle items, also shows the author's
  line on the board. The separate Solutions chapter is gone. Item N is exercise N;
  `solutionPage = master page - 151`. The old `chapter-6.pdf` in B2 is unused.
- **All exercises are puzzles:** with `--exercise-puzzles` every exercise item is a
  `puzzle` (the book does not distinguish them). Only the 51 with a clean parsed line
  (at most 10% of moves unparsed, start diagram within 3 squares of the solution
  diagram) also carry `line`, which gives the "author's move" feedback and the line on
  the board; the other 99 just jump the PDF to the solution page.
