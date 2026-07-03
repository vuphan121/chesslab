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
- Index key: **ECO code** as primary key — we already get this for free from the `/explorer`
  response (`openingEco`), and it's how the source documents are naturally organized
- Each key maps to a **list** of chunks, not a single chunk — multiple documents can cover the
  same line. Tag each chunk with its source document. Lines only one document covers just
  naturally resolve to a list of length 1, no special-casing needed.
- FEN used underneath as a canonicalization key so transposed move orders that reach the same
  position resolve to the same theory, instead of being treated as unrelated lines
- No embeddings/vector search needed yet — a well-tagged domain like chess openings can just use
  exact-key lookup (ECO → chunks). Revisit if/when coverage grows large enough that ECO alone is
  too coarse.

**General principles** (center control, development, king safety, tempo, ...)
- Small, finite set — not worth indexing/retrieving at all. Bake directly into the system prompt
  or a static reference block.

### Retrieval flow (per-move path)

```
position → ECO code (from explorer response)
         → look up chunks[ECO]  (list, possibly from multiple sources)
         → include all in the grounded prompt, attributed by source
```

## Open questions / not yet decided

- Where the coach endpoint lives in the monorepo — new package under `backend/internal/coach/`
  calling the Claude API directly, vs. a separate service. Leaning toward keeping it in the Go
  backend to reuse existing engine/lichess/storage packages.
- Chunk storage format for the theory corpus — likely a structured file (JSON keyed by ECO) for
  now, given only 3 source documents; revisit if corpus grows.
- How to handle documents disagreeing on why a move is played — current plan is to surface all
  sources and let the LLM synthesize/note disagreement rather than silently picking one.
- Scaling indexing beyond ECO-code granularity once corpus covers many openings (ECO can be coarse
  for long lines).
