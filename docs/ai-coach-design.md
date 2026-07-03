# AI Coach — Design Doc (Draft)

## Problem

The Coach panel started as a static placeholder chat. The goal was to make it actually explain
opening moves — *why* a move was played, not just *that* it's good or bad. A raw LLM API call isn't
enough: LLMs don't reliably calculate chess and will hallucinate plausible-sounding but wrong
tactical/positional claims. Chess "truth" needs to come from tools we already have (Stockfish,
Lichess data) and curated opening theory text, not from the model's parametric memory. (Status: now
built and wired end-to-end — see the Status section below.)

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

**Status: built** (`backend/internal/coach/agent.go`, `POST /api/games/{id}/coach/chat`).

```
user question
  → PositionContext injected (current FEN, FEN before the last move, last move SAN) — read from
    the game store via the {id} in the URL, so the user never has to paste a FEN
  → LLM (agentic, tool-calling enabled via Ollama/llama3.1's native tool-calling support)
      tools available (backend/internal/coach/tools.go):
        - analyze_position(fen)         → Lichess cloud eval → Stockfish fallback, any FEN
        - explorer_stats(fen)           → wraps lichess.FetchExplorer
        - retrieve_theory(fen)          → exact-FEN lookup in the same Index Path 1 uses
        - classify_move(fenBefore, fenAfter) → rule-based move-quality verdict, see below
      LLM decides which tools it needs, calls them (up to 4 iterations), then answers
```

One deviation from the original plan: `retrieve_theory` takes a `fen`, not a free-text `query` —
the corpus is indexed by exact FEN only (no embeddings/text search, see below), so a FEN is what
the lookup actually needs. A future text-query interface would still have to resolve to a FEN
internally before hitting the same index.

### Rule-based, book-aware move-quality classifier

Added per explicit request: chess.com/Lichess-style Best/Excellent/Good/Inaccuracy/Mistake/Blunder
labels, as a tool the Path 2 agent can call (`classify_move`, `backend/internal/coach/classify.go`).

**Two axes on purpose — eval AND book — because engine eval alone is the wrong yardstick for
opening theory.** A raw eval grade would flag legitimate gambits (King's, Evans, Smith-Morra,
Latvian, Danish, ...) as mistakes, since they deliberately accept a material/eval deficit for
development, initiative, or attack. The user's point: a *real* gambit is playable, not a mistake, and
a coach for humans has to say so.

*Eval grade* — chess.com's actual algorithm ("Expected Points Model") is proprietary and
rating-adjusted, so this is a public approximation (checked via web search — chess.com's support
docs describe the categories in terms of win-probability lost, not raw centipawns, which is why this
thresholds on win% not centipawn swing: the same numeric swing means very different things in a
balanced vs. an already-lopsided position):

1. Analyze the FEN before and after the move (two `analyze_position` calls).
2. Convert both to win probability with the public Lichess sigmoid:
   `winPercent = 50 + 50 * (2/(1+e^(-0.00368208*cp)) - 1)` (mate → 0 or 100).
3. Express both in the *mover's* perspective — the "after" position's raw score is from the
   opponent's perspective (they're now on move), so it's negated first.
4. Bucket the win% drop: Best (<1%), Excellent (1–3.5%), Good (3.5–7%), Inaccuracy (7–10%),
   Mistake (10–20%), Blunder (≥20%). This is `engineCategory`.

*Book context* (the fix) — `Tools.ClassifyMove` then queries the explorer for the resulting
position's rated-game count + named opening, and checks the theory corpus, producing a `BookStatus`
(established ≥25 games / rare 1–24 / novelty 0 / unknown). The final human-facing `category`:

- **established theory + eval grade Inaccuracy-or-worse → `Book`** (with a `note` telling the LLM to
  explain what the sacrifice buys, not scold the eval). This is the whole point of the feature.
- established + good eval → keep the good grade, note it's book.
- novelty (0 games) → keep the eval grade, but note the move has *left* known theory — uncharted, and
  "new ≠ bad", so let the eval (not the mere novelty) drive the verdict. This is the "move hasn't
  existed" case the user raised.
- unknown (explorer down) → fall back to eval grade, note the DB couldn't be consulted.

The 25-game threshold and the win% buckets are heuristics, tunable in `classify.go`. The same
gambit/novelty framing is also baked into both paths' system prompts (`gambitPhilosophy`), so even
eval-only reasoning (no `classify_move` call) frames gambits correctly. **Now wired into both paths:**
the agent exposes `classify_move`; Path 1 (per-move explanation) runs the classifier server-side when
`prevFen` is provided and opens the explanation by naming the verdict (a gambit is introduced as a
playable book move, not a blunder). Verified end-to-end: Latvian Gambit 2...f5 → `engineCategory:
Mistake` but `category: Book` (established, 942k games); Path 1 opens with "This is the Latvian
Gambit, an established opening theory…" instead of calling it a mistake.

### "From this position, can I play X?" — the evaluate_move tool

A gap surfaced once the chat was in real use: to answer "can I play Nf3 here?" the agent needs the
FEN *after* the named move, but an LLM can't reliably generate a FEN. So `evaluate_move(fen, move)`
(agent tool, `tools.go`) applies the move with the Go engine — the legality authority — and returns
`{legal, canonical SAN, uci, resultingFen, quality}` where `quality` is the same book-aware verdict.
The current board FEN is already injected into the chat context, so the user asks in plain language
("from this position, can I play f5?") and the agent calls `evaluate_move(currentFen, "f5")`. Verified:
from 1.e4 e5 2.Nf3, "can I play f5?" → the coach confirms it's legal, names the Latvian Gambit, and
says to ignore the engine's "Mistake" tag since it's a known gambit line.

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

**Opening-overview context** (`overview.json` → `coach.OverviewIndex`) — **built.** This is the
second corpus: opening-*level* prose that isn't about any single position — introductions,
strategic philosophy, typical plans, why-play-it, the "it feels like playing White / you get the
initiative" framing, move-order/transposition notes, study advice, risk profiles. Move-keyed FEN
lookup is the wrong tool for these (there's no one position they attach to), so:
- Stored as a flat list of `{opening, topic, title, text, source{title,author,location}}`. No
  `moveSequence`/`resolvedFen`, so no engine-validation step is needed (nothing to replay) — unlike
  the move corpus. Hand-extracted from the 3 source PDFs' introductions (mostly Panjwani and Davies;
  the Nielsen/Hansen excerpt on hand is only the column-bled Larsen games, no clean intro prose).
- **Retrieved by natural-language keyword match**, not FEN — `OverviewIndex.Search` scores weighted
  token overlap (opening/topic/title weighted above body text), stopword-filtered, returns top-K.
  Still no embeddings — a well-tagged, single-opening corpus doesn't need them yet; revisit if the
  corpus grows to many openings and keyword overlap starts returning near-misses.
- Exposed to the Path 2 agent as the `retrieve_opening_context(query)` tool (distinct from the
  FEN-keyed `retrieve_theory`). The agent picks it for general "what's the idea behind this opening?"
  questions. Not used by Path 1 (per-move) at all — that path is inherently position-specific.

**General principles** (center control, development, king safety, tempo, ...)
- Small, finite set — not worth indexing/retrieving at all. Baked directly into the system prompt
  (`generalPrinciples` + `gambitPhilosophy` in `prompt.go`).

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

## LLM backend: local model, not the Anthropic API

**Decision:** the coach calls a locally-served, OpenAI-compatible chat endpoint (Ollama) instead
of the Anthropic API — the user doesn't plan to get a billed `ANTHROPIC_API_KEY`.
`backend/internal/coach/llm.go` defines an `LLMClient` interface so the concrete backend is
swappable; `OllamaClient` is the only implementation so far, pointed at `http://localhost:11434`
(`OLLAMA_BASE_URL`) running `llama3.1:8b` (`COACH_MODEL`) — a reasonable fit for the dev machine's
Ryzen 7 / 16GB RAM / no GPU, and confirmed to support native tool-calling (needed for Path 2)
through Ollama's OpenAI-compatible `tools`/`tool_calls` format. Moving to llama.cpp server or a
hosted API later is just a different base URL/model, not a code change. **Installed and running**
(Ollama v0.31.1 via winget, `llama3.1:8b` pulled — see `handoff.md`).

## Status (see `handoff.md` for full detail)

- **Both paths built and wired up.** Path 1: `coach.Service.ExplainMove`,
  `POST /api/games/{id}/coach/explain`. Path 2: `coach.Agent.Chat`,
  `POST /api/games/{id}/coach/chat`, with the tool-call loop and rule-based `classify_move`
  classifier described above.
- **Local LLM is installed and verified working end-to-end**, not just wired: Ollama + `llama3.1:8b`
  running locally, both endpoints tested with real (non-mocked) requests through the full stack —
  see `handoff.md` for the specific test transcripts.
- **Frontend is wired up.** `Coach.tsx` shows the live per-move explanation + freeform chat thread;
  see `handoff.md` / `frontend/CLAUDE.md`.
- **Evaluation harness** (`docs/coach-eval/run_eval.py` → `results.md`): drives the live stack over a
  ladder of test cases (in-corpus positions + a swing-based ladder), objectively scoring the classifier
  (same math as `classify.go`) and capturing the explanation prose. First run confirms the classifier +
  book-override are correct; the main quality gap is `llama3.1:8b` **misattributing** retrieved book
  commentary (a model-size issue, not a retrieval bug) — a larger local model or a stricter
  no-fabricated-sources prompt is the follow-up. See `handoff.md` item 10.

## Open questions / not yet decided

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
