# Book Board Parser

Offline admin tool for extracting chess diagrams from a bounded PDF chapter.
It writes page metadata, diagram numbers, piece placements, and a best-effort
side-to-move classification. It is not imported by the backend or frontend.

The parser sends only tight board crops to ChessOCR, waits at least 5 seconds
between requests, and checkpoints every response. Re-run the same command to
resume without re-calling already completed positions.

## Install

```powershell
python -m pip install -r tools/book-board-parser/requirements.txt
```

## Run

Use the ranges in `docs/study-from-book/data-format.md`:

```powershell
python tools/book-board-parser/book_board_parser.py 'book-sources/Book 1.pdf' `
  --chapter 2 --first-master-page 16 --last-master-page 27 `
  --output tmp/book-board-parser/chapter-2 --recognize `
  --validate-api http://localhost:8080
```

The output's `positions.json` has one record per detected board:

- `diagram` / `diagramNumber` in visual top-to-bottom chapter order. This book
  numbers diagrams consecutively, while its decorative caption font stops
  exposing some digits to PDF text extraction after the early pages. Any
  readable caption is retained as `embeddedDiagramCaption` for review;
- `sideToMove`, confidence, and detection reason from the triangle above the
  board (unknown is preserved rather than guessed);
- `piecePlacement` from ChessOCR after structural validation;
- `bookPage`, `masterPDFPage`, and `chapterPDFPage` for durable source links.

`--validate-api` compares parsed placements and detected turns with a current
book record in Neon, using credentials from `backend/.env`. It reports only
counts, including detected boards that do not yet have a book record; it never
writes to the database.

## Tests

```powershell
python -m unittest tools/book-board-parser/test_book_board_parser.py
```

## Parse the remaining chapters

`parse_remaining.py` processes Chapters 3-24 sequentially using the canonical
page ranges. It uses the same checkpointing and 5.2-second minimum request
interval, and generates `docs/study-from-book/board-parser-errors.md` for only
the diagrams the tool could not recognize or whose turn marker was unknown.
It never corrects those diagrams or writes to Neon.

```powershell
python tools/book-board-parser/parse_remaining.py 'book-sources/Book 1.pdf'
```
