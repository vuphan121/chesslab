# AI Coach — Session Handoff (2026-07-03)

Read `ai-coach-design.md` first for the architecture. This doc is about *state*: what's actually
built, what's next, and gotchas worth knowing before continuing.

## What's done

1. **Design doc** (`docs/ai-coach-design.md`) — two-path architecture (grounded single-shot for
   per-move explanations, agentic tool-calling for freeform chat), chunking rules, indexing
   strategy. Kept up to date with what's below.

2. **Corpus: hand-chunked and engine-validated.**
   - `backend/data/opening-sources/accelerated-dragon/chunks.json` — **254 chunks**, hand-authored
     source of truth. Each chunk: `{moveSequence, commentaryText, source: {title, author,
     location}}`.
   - `backend/data/opening-sources/accelerated-dragon/chunks.validated.json` — same 254 chunks,
     each annotated with `resolvedFen`, `eco`, `openingName` from replaying the moves against the
     live Go backend. **This is the file to build the index from, not `chunks.json`.**
   - `backend/data/opening-sources/accelerated-dragon/validate_chunks.py` — the validation script.
     Re-run it any time `chunks.json` changes: parses `moveSequence` with python-chess (SAN
     parsing only — not the legality authority), replays each move via
     `POST /api/games/{id}/moves` against the real backend (backend must be running on :8080),
     resolves ECO via `/explorer`, writes both output files. Needs `pip install chess requests`.
   - `backend/data/opening-sources/accelerated-dragon/validation_report.json` — pass/fail detail
     for the last validation run.
   - Source PDFs (3 books) live in the same folder, **gitignored**
     (`backend/data/opening-sources/` in `.gitignore`) — copyrighted material, not committed.
   - Coverage: 46 chunks from *The Sicilian Accelerated Dragon* (Nielsen & Hansen), 62 from
     *Opening Repertoire: The Accelerated Dragon* (Davies), 146 from *The Hyper Accelerated
     Dragon* (Panjwani, the full 387-page book).

3. **Key finding that changed the design:** only 8/254 chunks resolved an ECO code (most of this
   corpus is deep theory past where Lichess assigns opening names). Indexing plan changed from
   "key by ECO" to "key by `resolvedFen`, ECO as a coarse secondary tag." Already reflected in the
   design doc.

## What's next, in priority order

1. **Build the index.** `chunks.validated.json` is currently a flat list — nothing groups it by
   position yet. Need: a `map[fen][]Chunk` (or a JSON file shaped that way) keyed by
   `resolvedFen`. Given only 254 chunks, this can just be a JSON file loaded into memory at Go
   backend startup — no database needed at this scale.

2. **Build the coach endpoint** (`backend/internal/coach/`, new package). Per-move path first
   (design doc's "Path 1" — grounded single-shot, no tool-calling needed since `/analysis` and
   `/explorer` data is already fetched by the frontend on every move via `refreshInsights`).
   Needs the index from step 1, plus an Anthropic API key (see below).

3. **Get an Anthropic API key.** This is separate from the Claude Code subscription used to build
   everything so far — it's billed separately, pay-as-you-go. Get one from
   [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys), put it in
   `backend/.env` as `ANTHROPIC_API_KEY=sk-ant-...` (same pattern as `LICHESS_TOKEN`, gitignored,
   loaded automatically by `main.go`).

4. **Freeform coach chat** (design doc's "Path 2" — agentic, tool-calling). Lower priority, build
   after Path 1 works end-to-end.

5. **Wire up the frontend.** `frontend/src/components/coach/Coach.tsx` is currently a static
   placeholder conversation — needs to call the new backend endpoint instead.

## Known gaps / accepted tradeoffs

- **5 chunks were dropped** from an original 259 during validation, rather than risk fabricating
  moves to force them to pass:
  - 2 from the "From the Larsen Chapter" compressed game-summary section (Nielsen & Hansen) — the
    source text there is a 2-column layout with column-bleed that made a few intermediate moves
    genuinely unrecoverable from the extracted text.
  - 3 from deeply-nested sub-variations in the Panjwani book (Chapter 1/2) where reconstructing
    the exact branch of a many-times-nested parenthetical tree from flattened text became too
    uncertain to trust.
  - All other validation failures (15 of the original 20) were successfully root-caused and fixed
    — see git history / `validation_report.json` from this session for detail on what each one
    was.
- **Corpus covers exactly one opening** (Sicilian Accelerated Dragon) — intentional scope, to
  prove the pipeline before expanding to more openings.
- **Chunking was done by hand** (interactively, this session), not by an automated LLM-extraction
  pipeline — reasonable at 3 documents, but if/when scaling to 20-30+ documents, revisit building
  the automated extraction step (LLM does the chunking, `validate_chunks.py`-style engine
  validation still gates what enters the corpus either way).

## Gotchas learned this session (useful if extending the pipeline)

- **PDF extraction:** `pdftoppm`/poppler isn't installed on this machine, so the built-in PDF page
  renderer doesn't work. Used `pdfplumber` (Python) for text extraction instead — works fine, just
  needs `pip install pdfplumber pypdf`.
- **2-column/sidebar PDF layouts** (e.g. "Bonus Game" insets) break plain top-to-bottom text
  extraction — the two columns interleave line-by-line. Fix: crop the page by x-position
  (`page.crop((0, 0, width*0.42, height))` for the left column, etc.) and extract each column
  separately.
- **python-chess SAN quirks** if extending `validate_chunks.py`: needs `O-O`/`O-O-O` (capital
  letter O), not `0-0`/`0-0-0` (zero) — the source books use the zero form, so the script
  normalizes it. Move-number tokens (`12.`, `12...`) need stripping before parsing. Trailing
  annotation symbols (`!?`, `!!`, `??`, etc.) need stripping too, or `parse_san` rejects the token.
- **Validation only checks legality, not whether a chunk's `moveSequence` is a *sensible*
  reconstruction** — python-chess + backend replay will happily validate a move sequence that
  transcribed a completely different (but still legal) branch than the one the comment is
  actually about. Several of this session's bugs were exactly that: legal-looking sequences that
  had silently drifted into the wrong sub-variation. Worth spot-checking a sample of
  `chunks.validated.json` against source pages before fully trusting it, not just relying on the
  validator passing.
