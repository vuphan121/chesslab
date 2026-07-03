# AI Coach — Session Handoff (2026-07-03)

Read `ai-coach-design.md` first for the architecture. This doc is about *state*: what's actually
built, what's next, and gotchas worth knowing before continuing.

**Repo/push status:** pushed to `github.com/vuphan121/chesslab` (private). As of this doc, there
may be one unpushed local commit (the PDFs + corpus commit) — run `git status` / `git log
origin/main..HEAD` to check, and push if it's still sitting local-only.

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
   - Source PDFs (3 books) live in the same folder and **are committed** — repo is private, so
     this is being used as personal backup/reference rather than public redistribution. If the
     repo is ever made public or shared, reconsider: the PDFs are copyrighted, and
     `chunks.json`/`chunks.validated.json` also contain substantial verbatim quoted commentary
     from those books, not just original notes.
   - Coverage: 46 chunks from *The Sicilian Accelerated Dragon* (Nielsen & Hansen), 62 from
     *Opening Repertoire: The Accelerated Dragon* (Davies), 146 from *The Hyper Accelerated
     Dragon* (Panjwani, the full 387-page book).

3. **Key finding that changed the design:** only 8/254 chunks resolved an ECO code (most of this
   corpus is deep theory past where Lichess assigns opening names). Indexing plan changed from
   "key by ECO" to "key by `resolvedFen`, ECO as a coarse secondary tag." Already reflected in the
   design doc.

## What's next, in priority order

1. ~~Build the index.~~ **Done.** `backend/internal/coach/index.go` — `LoadIndex` reads
   `chunks.validated.json` and groups it into an in-memory `map[fen][]Chunk` at startup (no
   separate precomputed file; grouping 254 chunks is trivial at process start). `Index.Lookup(fen)`
   returns the chunks for an exact FEN, or `nil` if uncovered.

2. ~~Build the coach endpoint.~~ **Done** (Path 1 only — per-move explanation). New
   `backend/internal/coach/` package:
   - `index.go` — the FEN→chunks index (see above).
   - `llm.go` — `LLMClient` interface + `OllamaClient`, which POSTs to an OpenAI-compatible
     `/v1/chat/completions` endpoint. **Decision: local model via Ollama, not the Anthropic API**
     (user doesn't plan to get an Anthropic key — see below). Defaults to
     `http://localhost:11434` / `llama3.1:8b`, overridable via `OLLAMA_BASE_URL`/`COACH_MODEL` env
     vars. Swapping to llama.cpp server or a hosted API later is just a different base URL, since
     both speak the same OpenAI-compatible shape.
   - `prompt.go` — `BuildExplainPrompt` assembles system+user prompt from FEN, last move, engine
     lines, explorer stats, and matched theory chunks (or says plainly there's no book coverage).
   - `service.go` — `Service.ExplainMove` ties index lookup + prompt + LLM call together.
   - Wired into the API as `POST /api/games/{id}/coach/explain`
     (`backend/internal/api/coach_handler.go`), body `{fen, lastMoveSan, analysis?, explorer?}` —
     `analysis`/`explorer` reuse the existing `AnalysisJSON`/`ExplorerJSON` shapes so the frontend
     can pass through what `refreshInsights` already fetched, no extra backend round trip.
   - Wired into `main.go` via `newCoachService()` — loads the index (path from `COACH_CHUNKS_PATH`,
     default `data/opening-sources/accelerated-dragon/chunks.validated.json`) and builds the Ollama
     client. If the index fails to load, the coach still runs on engine/explorer grounding alone
     rather than failing the whole server (same pattern as the Stockfish/Lichess-token fallbacks).
   - **Verified end-to-end** (2026-07-03): started the backend, played the exact 18-move line from
     the corpus's first chunk, confirmed the resulting FEN matches `resolvedFen` exactly, hit
     `/coach/explain` — request decodes, index lookup finds the chunk, prompt builds, and the call
     reaches the LLM client, failing only at the final HTTP call since Ollama isn't installed yet
     (502 with a clear "connection refused" message, not a crash).

3. ~~Not using the Anthropic API — install a local model.~~ **Done.** User's call: no plan to get an
   `ANTHROPIC_API_KEY` — the coach runs entirely on a locally-served model. Installed **Ollama**
   (`winget install Ollama.Ollama`, v0.31.1) and pulled **`llama3.1:8b`** (~4.9GB, Q4-ish default
   quant) — a good fit for this machine (Ryzen 7, 16GB RAM, no GPU). Ollama auto-starts as a
   background service on `localhost:11434` after install, no manual `ollama serve` needed.
   Confirmed `llama3.1:8b` supports native tool-calling through Ollama's OpenAI-compatible
   `tools`/`tool_calls` wire format (tested directly against `/v1/chat/completions` before wiring
   up Path 2 — see below).

4. ~~Freeform coach chat (Path 2).~~ **Done.** New in `backend/internal/coach/`:
   - `llm.go` — extended `LLMClient`/`OllamaClient` with `ChatCompletion` (tools + multi-turn
     messages, OpenAI-compatible wire format), keeping the old `Chat` (Path 1) as a thin wrapper
     around it.
   - `tools.go` — `Tools` struct wrapping the four tool implementations: `AnalyzePosition` (Lichess
     cloud eval → Stockfish fallback, same policy as `AnalyzeGame`, works on any FEN not just a
     stored game's current position), `ExplorerStats`, `RetrieveTheory` (same `Index` Path 1 uses),
     `ClassifyMove` (see item 6 below).
   - `agent.go` — `Agent.Chat` runs the tool-call loop (max 4 iterations): call the LLM with tool
     defs, if it returns `tool_calls` execute them and feed `{"error":...}` or the JSON result back
     as `"tool"`-role messages, repeat; first response with no tool calls is the final answer.
   - Wired into the API as `POST /api/games/{id}/coach/chat`
     (`backend/internal/api/coach_handler.go`), body `{message, history: [{role, content}]}` —
     history is frontend-maintained and resent each turn (backend is stateless between requests).
   - **Important fix found during testing:** the handler originally ignored the `{id}` in the URL
     entirely, so the model had no idea what position was being discussed unless the user pasted a
     FEN into their message by hand. Fixed by having `CoachChat` read the game's current node from
     the store and inject `PositionContext{FEN, PrevFEN, LastMoveSAN}` as a system message — this is
     what makes "was my last move any good?" work with no FEN pasting. `PrevFEN` (the parent node's
     FEN) is what lets the model call `classify_move` on the last move without being told either FEN.
   - **Verified end-to-end** (2026-07-03): played into the same Accelerated Dragon line as the Path 1
     test, then asked the chat endpoint "Was my last move any good?" with no history — got back a
     real "Mistake" verdict grounded in an actual `classify_move` tool call. Follow-up "What opening
     is this?" (with history) correctly answered "Hyper Accelerated Dragon" via `retrieve_theory`/
     `explorer_stats`, proving multi-turn history round-trips work.

5. ~~Wire up the frontend.~~ **Done** — both coach paths are live in the browser (verified
   end-to-end against the running backend + Ollama):
   - `frontend/src/lib/api/client.ts` — added `explainMove`, `coachChat`, the `ChatTurn` type, a
     `CoachUnavailableError` (503 → "coach offline"), and a **120s `AbortController` timeout** on the
     coach fetches so a hung local-model request surfaces an error instead of freezing the panel.
   - `frontend/src/hooks/useChessGame.ts` — Path 1 fires from the refresh flow: `refreshInsights`
     now awaits fresh analysis+explorer and then calls `/coach/explain` with them (+ `fen`,
     `lastMoveSan` from the current tree node via `sanForNode`). **Debounced 350ms** (holding an
     arrow key only explains the landing position) and **request-id-guarded** (a slow earlier
     explanation can't overwrite a newer one); at the root it clears the panel. Exposes
     `coachExplanation`/`coachExplaining`/`coachError` + `sendCoachChat(message, history)` for Path 2
     (the backend reads the live position from the store, so only `{message, history}` is sent).
   - `frontend/src/components/coach/Coach.tsx` — rebuilt from the static placeholder: live per-move
     explanation pinned at top (with a 3-dot "thinking" indicator during the slow call), freeform
     chat thread below, optimistic user bubble + pending indicator, disabled composer while sending,
     graceful error bubbles. `page.tsx` passes the new props.
   - **Verified in-browser**: 1.e4 auto-produced an explanation (~18s local inference); "what is the
     main idea of this opening?" returned the Accelerated Dragon overview prose (confirming
     `retrieve_opening_context` fires from the chat path); the user bubble + reply rendered and the
     composer re-enabled. `npm run build` + `tsc --noEmit` both clean.
   - **Perf note**: local `llama3.1:8b` CPU inference is ~15-20s per LLM call; a Path 2 chat that
     chains tool calls can take longer (each iteration is another call). This is expected, not a bug
     — the "thinking" indicators and 120s timeout exist for exactly this. A smaller/faster model or a
     GPU would cut it down.

6. ~~Rule-based move-quality tool.~~ **Done**, per explicit user request (chess.com-style
   Inaccuracy/Mistake/Blunder labels). `backend/internal/coach/classify.go`:
   - *Eval grade* (`classifyByEval`): converts engine score/mate to win probability using the public
     Lichess sigmoid (`50 + 50*(2/(1+e^(-0.00368208*cp))-1)`, mate → 0/100) rather than raw
     centipawns — a fixed centipawn swing means very different things in balanced vs. lopsided
     positions, so win% is the right axis (also how chess.com/Lichess do it per public docs — checked
     via web search; their exact thresholds/model are proprietary). Buckets: Best <1%, Excellent
     1–3.5%, Good 3.5–7%, Inaccuracy 7–10%, Mistake 10–20%, Blunder ≥20%.

7. ~~Book-aware classification (the gambit problem).~~ **Done**, per explicit user request: a real
   gambit is playable, not a mistake, even when the engine dislikes it; and a move that's never been
   played (a novelty) is uncharted, not automatically bad. `applyBookContext` in `classify.go` +
   `Tools.ClassifyMove` in `tools.go`:
   - `Tools.ClassifyMove` queries the explorer for the resulting position's rated-game count + named
     opening and checks the theory corpus → `BookStatus` (established ≥25 games / rare 1–24 /
     novelty 0 / unknown). **Established theory + eval grade Inaccuracy-or-worse → final `category`
     flips to `Book`** with a human `note` explaining the sacrifice; novelties keep the eval grade but
     get a "left known theory, judge on eval, new≠bad" note. `MoveQuality` carries both
     `engineCategory` (raw) and `category` (book-aware) so the LLM can contrast them.
   - Also baked the gambit/novelty philosophy into BOTH paths' system prompts (`gambitPhilosophy` in
     `prompt.go`) so even eval-only reasoning (no `classify_move` call) frames gambits right.
   - `classify_test.go` deterministically covers the override rules; **verified end-to-end** too:
     Latvian Gambit 2...f5 → `engineCategory: Mistake` but `category: Book` (established, 942k games),
     and the coach called it "a recognized Latvian Gambit line," not a mistake. (Note found while
     testing: modern cloud eval is kinder to early gambits than expected — the King's and Danish
     Gambits' key moves actually grade Best/Good on eval, so the override only visibly fires on lines
     the engine still genuinely dislikes like the Latvian.)
   - Threshold (25 games) and win% buckets are heuristics, tunable in `classify.go`.
   - `classify_move` is exposed as a Path 2 agent tool. (Later wired into Path 1 too — see item 9 —
     so per-move explanations now open by naming the verdict.)

8. ~~Opening-level context corpus (introductions / philosophy / "why play it").~~ **Done**, per
   explicit user request: the move corpus only covered position-specific theory, with nowhere for
   prose like "the Accelerated Dragon feels like playing White because you get the initiative" to
   live. Added a **second corpus + a second retrieval path**:
   - `backend/data/opening-sources/accelerated-dragon/overview.json` — 13 hand-extracted passages
     of opening-level prose (`{opening, topic, title, text, source}`), no moves/FEN so no
     validation step needed. Extracted from the 3 PDFs' introductions with `pdfplumber`: mostly
     **Panjwani** (the rich "My Favorite Sicilian" / "Accelerated Dragon State of Mind" / "An
     Inclusive Opening" intro — including the exact "feels like playing White", initiative/tempo,
     and "engines value material, humans value initiative" passages) and **Davies** (what the
     opening is, why 2...g6 avoids the Rossolimo, the Maroczy concern + counterplay, transpositions,
     study advice). The **Nielsen/Hansen PDF on hand is only the Larsen-chapter bonus games** (its
     Preface/Introduction pages aren't in that excerpt, and the 2-column layout column-bleeds), so
     no clean overview prose was pulled from it — noted rather than fabricated. Topics tagged:
     introduction / move-order / engine-vs-human / philosophy / style-fit / typical-plans / maroczy
     / transpositions / study-advice / risk. Davies' figurine encoding (Ì→N, Í→B, Ë→Q, Î→R, Ê→K)
     was normalized during extraction.
   - `backend/internal/coach/overview.go` — `OverviewChunk` + `OverviewIndex` with a keyword search
     (`Search`): weighted token overlap (opening/topic/title weighted above body text),
     stopword-filtered, top-K. **No embeddings** — consistent with the move corpus's "well-tagged
     domain, exact/keyword lookup is enough" decision; revisit if the corpus grows to many openings.
   - Exposed to the Path 2 agent as a distinct tool `retrieve_opening_context(query)` (vs the
     FEN-keyed `retrieve_theory`); loaded in `main.go` from `COACH_OVERVIEW_PATH` (default
     `data/opening-sources/accelerated-dragon/overview.json`), optional like the move index.
   - `overview_test.go` covers ranking/limit/no-match/nil-safety; **verified end-to-end** too:
     "why should I play this as Black even though the engine likes White?" pulled the exact
     feels-like-White/initiative framing, and "look up the study advice" correctly reproduced
     Davies' play-games-first → blitz → then-study sequence with attribution.
   - **To extend to more openings:** drop more `{opening, topic, title, text, source}` passages into
     `overview.json` (or a per-opening file + glob later); keyword search already keys on the
     `opening` field, so multiple openings coexist without code changes. If auto-extracting from
     PDFs at scale, watch the 2-column/sidebar layout bleed (crop by x-position) and figurine
     normalization noted above.

9. ~~Surface the move-quality verdict in Path 1 + let chat evaluate a move "from this position".~~
   **Done** (both verified end-to-end against the running backend + Ollama):
   - **Path 1 classification** — `Service` now holds the shared `*Tools`; `ExplainMove` runs
     `Tools.ClassifyMove(prevFen, fen)` when the request carries `prevFen`, and injects the
     book-aware verdict into the prompt so the explanation opens by naming the move's quality. Wiring:
     `ExplainMoveRequest`/`ExplainRequest` gained `prevFen`; the frontend computes it from the current
     tree node's parent (`nodeMeta` in `useChessGame.ts`) and sends it. Best-effort — if classify
     fails (no engine/cloud miss), the explanation just proceeds without it. Verified: 1.e4 opens
     "A solid book move!"; the Latvian Gambit 2...f5 opens "This is the Latvian Gambit, an established
     opening theory…" (not a blunder).
   - **`evaluate_move(fen, move)` tool** — the "from this position, can I play X?" enabler. Applies a
     user-named move (SAN or UCI) with the Go engine (legality authority) and returns
     `{legal, move, uci, resultingFen, quality}`; the current FEN is already injected into chat
     context, so the user needn't paste anything. Impl in `tools.go` (`EvaluateMove`, reuses
     `GenerateLegalMoves`/`SAN`/`MovesToSANAndFENs` + `ClassifyMove`); `evaluate_test.go` covers
     legal SAN/UCI, illegal, annotation stripping. Verified: from 1.e4 e5 2.Nf3, "can I play f5?" →
     coach confirms legal, names the Latvian Gambit, says to ignore the engine's Mistake tag.
   - **Refactor**: both paths now share one `coach.Tools` (built via `coach.NewTools` in `main.go`);
     `NewService(tools, llm)` / `NewAgent(tools, llm)`. `classifyByEval` + `applyBookContext` were
     split out of `ClassifyMove` into a reusable `classifyWithBook` so `EvaluateMove` shares the
     grading path.
   - **Perf note**: Path 1 now does 2 extra `analyze_position` calls per move (before+after) for the
     verdict — both hit Lichess cloud first (fast/cached), so it adds ~1-2s, dwarfed by the ~17s LLM
     call. Fine in practice.

10. **Evaluation harness + first review run.** `docs/coach-eval/run_eval.py` drives the live backend +
    Ollama over a ladder of test cases and writes `docs/coach-eval/results.md` (a summary table + full
    per-case detail: line, FENs, the book chunk the coach was given, and the explanation). The
    classification columns are computed with the *same* win% formula/thresholds as `classify.go`, so
    they're an objective yardstick; the explanation prose is the subjective output to judge. Re-run any
    time (backend on :8080 + Ollama up, `pip install chess requests`, `python docs/coach-eval/run_eval.py`).
    Cases: 3 in-corpus positions (Group A) + a Group-B ladder — negligible→Best/Excellent, slight→Good,
    Inaccuracy, ~1-pawn Mistake, piece/queen-drop Blunders, and both gambit-override directions.
    **Findings from the run:**
    - Classifier ladder + book override are correct across every case (the numbers are trustworthy).
    - A clean *non-book* Inaccuracy is nearly impossible to construct: a slightly-bad-but-playable move
      has usually been played 25+ times by 2000+ players → counts as established → gets the Book label.
      Non-book bad moves jump straight to Mistake/Blunder. (So the corpus/`b5` "rare (3 games)" case is
      the clean non-book Mistake; most mild eval dips on real moves resolve to Book.)
    - **Main quality weakness — model attribution.** On corpus cases the *right* chunk is retrieved, but
      `llama3.1:8b` misattributes it (credits "Bent Larsen", invents a Panjwani quote) and sometimes
      confuses the side to move. Retrieval/pipeline is correct; this is an 8B-model limitation. If output
      quality matters, try a larger local model (or tighten the prompt to forbid naming a source not in
      the provided chunk) — worth a follow-up. Blunder/eval-only explanations read honestly and well.

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
