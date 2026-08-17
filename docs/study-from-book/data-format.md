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
      "sourcePage": 12
    }]
  }]
}
```

The backend validates each FEN and confirms that `sideToMove` matches the FEN.
Each chapter is stored separately under
`books/<book-id>/chapter-<number>.pdf`. The reader requests only
`/api/books/{id}/chapters/{chapterId}/source.pdf`, never a whole-book file or
a client-supplied object name. The backend authenticates to B2 and streams the
chapter bytes; neither B2 keys nor B2 download tokens reach the browser.

## Archived OCR experiments

The OCR, diagram-detection, labeling, PaddleOCR/TroCR fine-tuning, and
third-party ChessOCR experiments were removed from this repository. They did
not reliably recognize the textbook's chess figurines, so the product no
longer depends on automated PDF-to-position extraction.

If automated extraction is revisited, it must be a separate, opt-in project:
do not reintroduce OCR tooling, training images, generated crops, or model
artifacts into this repository or production app. The product workflow is the
PDF reader plus explicitly supplied FEN positions.
