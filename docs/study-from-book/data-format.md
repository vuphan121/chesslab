# Study from Book

The Study from Book page is a reader and free-play board workspace. A student
selects a section, sees the corresponding PDF page, and explores the supplied
position on the board. Their move tree exists only for that browser session;
changing sections starts a fresh board.

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

## Archived OCR experiments

The OCR, diagram-detection, labeling, PaddleOCR/TroCR fine-tuning, and
third-party ChessOCR code were removed from this repository. The production
product does not depend on automated PDF-to-position extraction.

If automated extraction is revisited, it must be a separate, opt-in operation:
keep its client, rendered pages, and crops outside the repository; submit only
tight board crops; comply with the provider's rate limit; and persist only
structurally validated chess facts plus page metadata after review. The product
workflow remains the PDF reader plus explicitly supplied FEN positions.
