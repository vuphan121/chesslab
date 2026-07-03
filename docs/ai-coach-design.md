# AI Coach — Design Doc (Draft)

## Problem

The Coach panel is currently a static placeholder chat. We want it to actually explain opening
moves — *why* a move was played, not just *that* it's good or bad. A raw LLM API call isn't
enough: LLMs don't reliably calculate chess and will hallucinate plausible-sounding but wrong
tactical/positional claims. Chess "truth" needs to come from tools we already have (Stockfish,
Lichess data) and curated opening theory text, not from the model's parametric memory.

## Core idea

Split the system into two things the LLM is *not* trusted to know on its own, plus one thing it's
good at:

- **Numeric/tactical truth** → Stockfish eval + Lichess explorer stats (already built, see
  `backend/CLAUDE.md`)
- **Explanatory theory** ("why this move is played") → RAG over curated opening-theory documents,
  plus a small set of general chess principles
- **Synthesis into coach-voice prose** → the LLM's actual job. It writes; it doesn't invent facts.

## Two request paths

### 1. Per-move explanation (the common case)

Fires automatically after a move is played/navigated to, same trigger point as the existing
`refreshInsights` call in `useChessGame`.

```
move played
  → frontend already has fresh /analysis + /explorer results (no extra fetch needed)
  → backend coach endpoint:
      - looks up opening theory chunks for this position (RAG, keyed by ECO — see below)
      - builds a single grounded prompt: eval delta between candidate moves, explorer win%/share%,
        retrieved theory chunk(s), general principles
      - one LLM call → explanation text
  → rendered in Coach panel
```

No tool-calling round trip here — we already have the eval/explorer data for free from the
existing endpoints, so it's injected directly into the prompt instead of making the LLM decide to
fetch it.

### 2. Freeform coach chat (follow-up questions)

For things like "what if I'd played Nf3 instead?" — a position we haven't already analyzed.

```
user question
  → LLM (agentic, tool-calling enabled)
      tools available:
        - analyze_position(fen)  → wraps existing /api/games/{id}/analysis
        - explorer_stats(fen)    → wraps existing /api/games/{id}/explorer
        - retrieve_theory(query) → RAG lookup, see below
      LLM decides which tools it needs, calls them, then answers
```

## RAG design

### Corpus

Curated opening-theory documents (currently: 3 documents covering one specific opening — the
Sicilian Accelerated Dragon — with overlapping and unique line coverage across them). Scope stays
narrow — one opening at a time — to validate the pipeline before expanding to more openings.

**Status: built and validated.** All 3 documents have been hand-chunked into
`backend/data/opening-sources/accelerated-dragon/chunks.json` (254 chunks after fixes — see
`handoff.md` for what was excluded and why). Each chunk was run through
`validate_chunks.py`, which parses `moveSequence` with python-chess and replays it against the
*actual* Go backend (`POST /api/games` + `POST /api/games/{id}/moves`) — the backend's own
legality rules are the ground truth, not python-chess's. Output is
`chunks.validated.json`: the same chunks, annotated with a canonical `resolvedFen` and
`eco`/`openingName` resolved via `/explorer`. This is the file the indexing layer should read
from, not `chunks.json` directly.

The 3 documents are structured differently, which matters for chunking:
- **Annotated master games** (Nielsen & Hansen) — chapters = variation/system, content unit = a
  full annotated game with prose interleaved move-by-move
- **Repertoire w/ Q&A** (Davies) — chapters = variation, content unit = a Q&A block anchored to a
  specific move, nested inside a game
- **Repertoire w/ move-labeled parts** (Panjwani) — chapters split into "Parts" that are already
  labeled by move sequence in the source's own table of contents; closest to pre-chunked

None of the three are naturally chunked at move level — their smallest native unit (a full game,
or a Q&A block) can span many moves/positions in one chunk, which is too coarse to ground a
single-move explanation.

### Two corpora, indexed differently

**Opening-line theory** (the 3 documents, and more later)
- Chunk **per commented move or move-cluster**, one level finer than the documents' own
  structure — using paragraph breaks / Q&A blocks / diagram boundaries as natural split points,
  not whole games or whole sections. Each chunk covers the move(s) its commentary is actually
  about, not everything else in the same game/section.
- **Only chunk where there's real explanatory prose — skip bare move-list branches with no
  commentary.** All three books contain long stretches of raw variation trees (`10.Nd5 d6 11.Bg5
  (11.h3 Nd7 12.c3...) ...`) with no prose attached. Those are just engine-style lines in book
  form — the `analyze_position` tool already covers that ground. The chunks worth indexing are
  the ones with actual prose explaining *why*, anchored to whichever move they're attached to.
  See `docs/example-chunks.json` for 6 worked examples (2 per document) applying this rule.
- **Index key: `resolvedFen`, not ECO code — this changed from the original plan.** The original
  assumption was that ECO would be the primary key since `/explorer` gives it for free. In
  practice, once the real corpus was built and validated, **only 8 of 254 chunks resolved an ECO
  code** — Lichess only assigns ECO/opening names within the first several moves of a line, and
  almost all of this corpus's value is in deep, specific theory (move 10-20+) well past that
  point. ECO is too coarse to be useful as the primary key for a corpus like this.
  - **Primary key: `resolvedFen`** (from `chunks.validated.json`) — canonical, transposition-safe,
    always present regardless of how deep the line goes.
  - **ECO stays as a coarse secondary tag** — useful for grouping/browsing by opening family where
    it does resolve (mostly the first few moves of each document), not for lookup.
- Each key maps to a **list** of chunks, not a single chunk — multiple documents can cover the
  same line. Tag each chunk with its source document. Lines only one document covers just
  naturally resolve to a list of length 1, no special-casing needed.
- No embeddings/vector search needed yet — a well-tagged domain like chess openings can just use
  exact-key lookup (FEN → chunks). Revisit if/when coverage grows large enough that exact-FEN
  matching misses too many near-identical positions (e.g. differing only in irrelevant flank
  pawns) and a fuzzier match is needed.

**General principles** (center control, development, king safety, tempo, ...)
- Small, finite set — not worth indexing/retrieving at all. Bake directly into the system prompt
  or a static reference block.

### Retrieval flow (per-move path)

```
position → FEN (already have this from the move/analysis response — no extra computation)
         → look up chunks[resolvedFen]  (list, possibly from multiple sources, possibly empty)
         → include all in the grounded prompt, attributed by source
```

If a position has no matching chunk (a real position not covered by any document — will be most
positions, since the corpus only covers specific book lines), the prompt just proceeds with
eval/explorer grounding and no retrieved theory. That's fine — not every move has book commentary
attached to it in real life either.

## Open questions / not yet decided

- **Not yet built: the actual index structure.** `chunks.validated.json` is a flat list today —
  nothing groups it by `resolvedFen` yet. Next concrete step (see `handoff.md`).
- **Not yet built: the coach endpoint itself.** Where it lives in the monorepo — new package under
  `backend/internal/coach/` calling the Claude API directly, vs. a separate service. Leaning
  toward keeping it in the Go backend to reuse existing engine/lichess/storage packages.
- **Not yet set up: Anthropic API key.** Separate from the Claude Code subscription used to build
  this — needs its own key from console.anthropic.com, billed separately, stored in
  `backend/.env` as `ANTHROPIC_API_KEY` (same pattern as `LICHESS_TOKEN`). See `handoff.md`.
- How to handle documents disagreeing on why a move is played — current plan is to surface all
  sources and let the LLM synthesize/note disagreement rather than silently picking one. Not yet
  exercised in practice since we haven't built retrieval yet.
- Whether exact-FEN lookup will miss too many near-transpositions in practice once this is live
  (e.g. move-order swaps that reach the "same" position via a different FEN due to en passant/
  castling-rights bookkeeping) — revisit once the retrieval layer is built and tested against real
  gameplay.
- Some source pages use a 2-column "sidebar" layout (e.g. the "Bonus Game" insets in the Nielsen &
  Hansen book's Larsen chapter) that breaks plain top-to-bottom text extraction — the two columns
  get interleaved line-by-line. This was worked around by hand for the current corpus; a future
  automated extraction script will need to detect these pages and crop by x-position rather than
  trust default text extraction everywhere.
