# Backend — Chesslab

Go REST API serving chess game state and Stockfish analysis. No framework beyond chi router.

## Commands

```bash
go run ./cmd/server/   # start server on :8080
go build ./...         # compile check
go test ./...          # run tests
```

**With Stockfish** (required for analysis endpoint):
```bash
STOCKFISH_PATH="C:/Users/vupha/AppData/Local/Microsoft/WinGet/Packages/Stockfish.Stockfish_Microsoft.Winget.Source_8wekyb3d8bbwe/stockfish/stockfish-windows-x86-64-avx2.exe" go run ./cmd/server/
```
`STOCKFISH_PATH` defaults to `"stockfish"` (in PATH). If the engine can't start, the server still runs but `/analysis` returns 503.

**Lichess Opening Explorer token** (required for `/explorer` endpoint): the Lichess opening-explorer
API (`explorer.lichess.ovh`) requires an `Authorization: Bearer <token>` header — unlike the cloud-eval
endpoint used for `/analysis`, which is public. Get a free personal token at
[lichess.org/account/oauth/token](https://lichess.org/account/oauth/token) (no scopes needed), then put
it in `backend/.env` (gitignored, loaded automatically by `main.go` on startup):
```
LICHESS_TOKEN=lip_xxxxxxxxxxxxxxxxxxxx
```
If unset, `/explorer` returns 503 rather than failing the whole server.

## Package layout

```
cmd/server/main.go          # entry point — loads .env, reads STOCKFISH_PATH, wires engine, store, handler, router
internal/
  chess/
    types.go        # Color, PieceType, Square, Move, MoveFlag
    position.go     # Position struct (board + castling + EP + clocks), Clone()
    fen.go          # ParseFEN / FEN — full FEN serialisation
    attacks.go      # IsAttacked, InCheck — per-piece attack detection
    movegen.go      # GenerateLegalMoves, generatePseudo, per-piece generators
    game.go         # Game = move tree (Node root/current), ApplyMove, GotoNode, Reset, applyMove, game-over detection
    game_test.go    # unit test for Reset (must discard the tree, not leave stale sidelines — see PGN paste below)
    notation.go     # SAN(), MovesToSAN(), MovesToSANAndFENs()
    pgn.go          # TokenizePGNMoves, FindLegalMoveBySAN, ReplayLine — shared by api's PGN-paste
                     #   handler and coach's prefix-position theory indexing (see coach/index.go)
  engine/
    stockfish.go    # Engine struct: spawns Stockfish subprocess, UCI protocol, Analyze()
  lichess/
    client.go       # Fetch() — cloud-eval (public, no auth) used as first choice in AnalyzeGame
    explorer.go     # FetchExplorer() — opening-explorer (requires LICHESS_TOKEN bearer auth)
  api/
    handlers.go     # HTTP handlers: CreateGame, GetGame, MakeMove, DeleteGame, AnalyzeGame, Explorer, GotoNode
    pgn.go          # HTTP handler: LoadPGN — resets the tree first (Game.Reset), replays via chess.TokenizePGNMoves/FindLegalMoveBySAN
    coach_handler.go # HTTP handlers: ExplainMove (Path 1), CoachChat (Path 2)
    routes.go       # chi router setup + CORS middleware
  storage/
    memory.go       # Store interface + thread-safe in-memory implementation
  repertoire/       # Opening Trainer: parses a Lichess study PGN into drillable cards.
                     #   See "Repertoire parsing" below and docs/opening-trainer/.
    types.go        # Node/Chapter/Card/Answer/ExcludedAnswer/Reply/Repertoire
    pgn.go           # ParsePGN — multi-game tokenizer/parser (tag blocks, [FEN]/[SetUp],
                     #   nested variations preserved, comments, NAGs, !/? suffix annotations)
    config.go        # sidecar <name>.config.json (side, exclusions by chapter+SAN-path)
    build.go         # BuildRepertoire — exclusion resolution + card/reply derivation, CardKey
    load.go          # LoadDir — globs *.pgn + paired sidecar, skips (doesn't fail) on parse errors
    store.go         # in-memory read-only registry (loaded once at startup)
    pgn_test.go      # parses the demo Catalan study; asserts tree structure (custom start FEN,
                     #   intro comment placement, depth-3 nested variation)
    build_test.go    # asserts the exact 60-card enumeration, exclusion propagation, cross-chapter
                     #   reply-pool merge (see docs/opening-trainer/data-format.md §2.3)
  coach/
    index.go        # Chunk/TheoryMatch/LookupResult + Index — loads chunks.validated.json; indexes
                     #   both exact resolvedFen and, via chess.ReplayLine, every earlier position along
                     #   each chunk's own line, for "transposes toward known theory" prefix hints
    overview.go      # OverviewChunk + OverviewIndex — opening-level prose, keyword (not FEN) search
    prompt.go        # BuildExplainPrompt — grounded prompt for the per-move explanation path;
                     #   also moverAndPly/viewerName/perspectiveLine (viewer-perspective framing) and
                     #   showEngineEval (opening eval-suppression gate) — see AI coach design below
    prompt_test.go   # unit tests for perspective framing + opening eval-suppression gate
    service.go       # Service.ExplainMove — Path 1 (single grounded call; classifies move if prevFen)
    llm.go           # LLMClient interface + OllamaClient (OpenAI-compatible /v1/chat/completions,
                     #   with tool-calling support for Path 2)
    agent.go         # Agent.Chat — Path 2 (freeform, agentic tool-calling loop) + tool definitions
    tools.go         # Tools (shared by both paths, built via NewTools) — analyze_position/
                     #   explorer_stats/retrieve_theory/retrieve_opening_context/classify_move/
                     #   evaluate_move impls
    classify.go      # rule-based, book-aware move-quality classifier (eval grade + Book override)
    classify_test.go # unit tests for the eval grade + gambit/novelty book-override rules
    evaluate_test.go # unit tests for EvaluateMove (legal SAN/UCI, illegal, annotation stripping)
    overview_test.go # unit tests for the opening-overview keyword search
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/games` | Create new game, returns full game state. Optional `{"fen": "..."}` body roots it at an arbitrary position (used by the trainer + the "Analyze this line" handoff); empty/absent body is the initial position, unchanged behavior |
| GET | `/api/games/{id}` | Get current game state |
| POST | `/api/games/{id}/moves` | Make a move |
| DELETE | `/api/games/{id}` | Delete a game |
| GET | `/api/games/{id}/analysis` | Run Stockfish analysis on current position |
| GET | `/api/games/{id}/explorer` | Lichess opening-explorer stats for current position |
| POST | `/api/games/{id}/goto` | Navigate to a move-tree node by id (`{ "nodeId": "3" }`) — does not discard moves |
| POST | `/api/games/{id}/pgn` | Load a pasted PGN move list — replays from the start position, rebuilding the tree |
| POST | `/api/games/{id}/position` | Re-point an existing game at an arbitrary FEN (`{"fen": "..."}`), discarding its tree — same contract as `Game.Reset()`/`ResetTo()`. The opening trainer reuses one game object across a whole drill session instead of creating one per card |
| GET | `/api/eval?fen=<fen>` | Light White-relative eval for an arbitrary FEN (game-independent) — drives per-move eval in the move list |
| GET | `/api/repertoires` | List loaded opening-trainer repertoires (id, name, side, chapters + card counts) |
| GET | `/api/repertoires/{id}` | Full repertoire: chapters (with trees), derived cards, opponent reply pools |
| POST | `/api/games/{id}/coach/explain` | Grounded per-move explanation (Path 1) |
| POST | `/api/games/{id}/coach/chat` | Freeform agentic coach chat (Path 2) |

### Load PGN request/response
```json
// POST /api/games/{id}/pgn
{ "pgn": "1. e4 c5 2. Nf3 g6 3. d4" }
// -> full game state (same shape as below) + { "appliedPlies": N, "totalTokens": M, "error"?: "..." }
```
- Calls `Game.Reset()` first — discards the **entire** move tree (mainline + every sideline) and
  starts from a brand-new root — then replays the pasted move list through the same `Game.ApplyMove`
  normal play uses. **Was a bug:** the handler used to only `GotoNode(root)`, which moves the cursor
  but leaves the old root's `Children` in place, so pasting a line that diverged from whatever was
  already on the board silently became a *sideline* off the stale tree instead of replacing it. `Reset`
  gives the root a clean `Children` slice so a paste always replaces the game outright (`game_test.go`
  covers this). Tokenizer strips comments/NAGs/result markers/move numbers and drops parenthetical
  sidelines (mainline only), tolerates `0-0`/annotations.
- A malformed/illegal token stops the load but keeps whatever prefix applied cleanly; `error` is set and
  the status is `422` (body still carries the usable partial state). No moves parsed → `400`.

### Eval-by-FEN request/response
```json
// GET /api/eval?fen=<url-encoded FEN>
// -> { "score": 18, "mate": 0, "depth": 70 }
```
- `score`/`mate` are **White-relative** (positive = White better), consistent with the eval bar. Cloud
  eval first (already White-relative, no flip), local Stockfish fallback (side-to-move, flipped on
  Black). Light — no PV lines. Game-independent; the move list fetches it per node and caches by FEN.

### Move request body
```json
{ "from": "e2", "to": "e4", "promotion": "q" }
```
`promotion` is `"q"/"r"/"b"/"n"` — omit or leave empty to default to queen.

### Game state response
```json
{
  "id": "...",
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "turn": "w",
  "fullMove": 1,
  "pieces": { "e1": { "type": "k", "color": "w" } },
  "legalMoves": [{ "from": "e2", "to": "e4", "flag": "double_push" }],
  "lastMove": { "from": "e2", "to": "e4" },
  "isCheck": false,
  "isCheckmate": false,
  "isStalemate": false,
  "isDraw": false,
  "isGameOver": false,
  "gameOverReason": "",
  "currentNodeId": "1",
  "moveTree": {
    "id": "0", "san": "", "fen": "<start fen>", "ply": 0,
    "children": [
      { "id": "1", "san": "e4", "fen": "...", "ply": 1, "children": [
        { "id": "2", "san": "e5", "fen": "...", "ply": 2, "children": null }
      ] },
      { "id": "3", "san": "d4", "fen": "...", "ply": 1, "children": null }
    ]
  }
}
```
- `moveTree` is the full game as a **tree of positions** (root = start, `san: ""`). `children[0]` is
  the main line; `children[1:]` are sidelines/variations. Leaf `children` serialize as `null`.
- `currentNodeId` is the node currently viewed (drives the board + move-list highlight).
- `ply` is half-move depth (root 0, first move 1). Move number = `ceil(ply/2)`; white = odd ply.

### Analysis response
```json
{
  "bestMove": "e2e4",
  "score": 28,
  "mate": 0,
  "depth": 18,
  "engineName": "Stockfish 18",
  "lines": [
    {
      "score": 28,
      "mate": 0,
      "depth": 18,
      "moves": ["e4", "e5", "Nf3", "Nc6"],
      "fens": ["fen-after-e4", "fen-after-e5", "..."]
    }
  ]
}
```
- `score` is centipawns from **white's perspective** (negative = black is better)
- `mate` is `>0` if white mates in N moves, `<0` if black mates in N moves
- `moves` are SAN strings; `fens` are full FEN strings after each move (same length as `moves`)
- Returns up to 3 lines (MultiPV 3, depth 18)

### Explorer response
```json
{
  "totalGames": 659707484,
  "openingName": "King's Pawn Game",
  "openingEco": "B00",
  "moves": [
    {
      "san": "e4",
      "uci": "e2e4",
      "games": 351249688,
      "sharePct": 53.24,
      "whitePct": 48.43,
      "drawPct": 5.84,
      "blackPct": 45.74,
      "openingName": "King's Pawn Game",
      "openingEco": "B00"
    }
  ]
}
```
- Sourced from `explorer.lichess.ovh/lichess`, filtered to rated games by 2000+ players (blitz/rapid/classical)
- `openingName`/`openingEco` at the top level describe the **current** queried position; per-move fields describe the position **after** that candidate move — both come directly from Lichess (no extra lookups)
- `sharePct` is that move's share of games from the current position; `whitePct`/`drawPct`/`blackPct` are that move's own W/D/L split
- Returns 503 if `LICHESS_TOKEN` is unset or the upstream call fails

### Coach explain request/response (Path 1)
```json
// POST /api/games/{id}/coach/explain
{ "fen": "...", "prevFen": "...", "lastMoveSan": "Bd7", "viewerColor": "w", "analysis": { /* AnalysisJSON, optional */ }, "explorer": { /* ExplorerJSON, optional */ } }
// -> { "explanation": "..." }
```
- `analysis`/`explorer` are optional passthroughs of what the frontend already fetched via
  `refreshInsights` — no extra Stockfish/Lichess round trip on the backend for this path.
- `prevFen` is the position *before* the move (frontend sends the parent tree node's FEN). When
  present, the service runs the **book-aware move classifier** (`Tools.ClassifyMove(prevFen, fen)`)
  and injects the verdict into the prompt, so the explanation opens by naming the move's quality —
  and an established gambit reads as a playable "Book" move, not a mistake, even when the engine
  dislikes it. Best-effort: if classification fails (no engine / cloud miss), the explanation just
  proceeds without it.
- `viewerColor` (`"w"`/`"b"`, optional) is which side the human is currently studying from — the
  frontend derives it from the board-flip toggle and resends it on every flip (see frontend
  `useChessGame.ts`). It reframes whose perspective the explanation is written from, independent of
  who actually made the move — see "Viewer perspective" under AI coach design below. Empty defaults to
  the side that made the move (the pre-flip-feature behavior).
- Looks up `chunks.validated.json` by exact `fen` match; if nothing matches, the explanation still
  proceeds on engine/explorer grounding + general principles alone.
- Returns 503 if the coach isn't configured, 502 if the local LLM call fails.

### Coach chat request/response (Path 2 — freeform, agentic)
```json
// POST /api/games/{id}/coach/chat
{ "message": "Was my last move any good?", "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }] }
// -> { "reply": "..." }
```
- `history` is the full prior conversation (frontend keeps and resends it — the backend is
  stateless between requests, no server-side session storage).
- The handler reads the **current game's own state** from the store (via the `{id}` in the URL) —
  current FEN, last move SAN, and the FEN before that move — and injects it as context, so the user
  can ask "was my last move good?" without pasting any FEN.
- The agent can call tools mid-turn (`analyze_position`, `explorer_stats`, `retrieve_theory`,
  `retrieve_opening_context`, `classify_move`, `evaluate_move` — see below) against arbitrary FENs,
  not just the current position — e.g. "what if I'd played Nf3 instead?" `retrieve_opening_context`
  answers general "tell me about this opening" questions; `evaluate_move` answers "from this position,
  can I play X?" (the injected current FEN + the named move → legality + book-aware verdict).
- Returns 503 if unconfigured, 502 if the local LLM call fails, or if the tool-call loop exceeds
  `maxToolIterations` (4) without a final answer.

## AI coach design

**Two paths** (see `docs/ai-coach-design.md` for full rationale): Path 1 (`coach.Service`) is a
single grounded LLM call with no LLM tool-calling — analysis/explorer data is already known and is
injected straight into the prompt, and the move classifier runs server-side (not as an LLM tool) when
`prevFen` is supplied. Path 2 (`coach.Agent`) is agentic — the model decides which tools to call, in
a loop, before answering. Both share one `coach.Tools` (built in `main.go` via `coach.NewTools`), so
Path 1's classification and Path 2's tools use the same engine/index/overview/explorer plumbing.

**LLM backend:** local, not the Anthropic API — `coach.OllamaClient` (`llm.go`) talks to an
OpenAI-compatible `/v1/chat/completions` endpoint (Ollama by default, `http://localhost:11434`,
model `llama3.1:8b`), overridable via `OLLAMA_BASE_URL`/`COACH_MODEL` env vars. `llama3.1` supports
native tool-calling, which Ollama exposes through the same OpenAI-compatible `tools`/`tool_calls`
wire format — swapping to another OpenAI-compatible runtime later is just a different base URL.

**Path 2 tool-call loop** (`agent.go`): each iteration sends the full message history (including
prior tool results) back to the LLM; if the response has no `tool_calls`, that's the final answer.
Each tool call's JSON result (or a `{"error": "..."}` on failure) is appended as a `"tool"`-role
message so the model can see and adapt to failures instead of the whole request aborting. Capped at
`maxToolIterations` (4) to bound a confused model's loop.

**Tools available to the agent** (`tools.go`):
- `analyze_position(fen)` — Lichess cloud eval first, falling back to local Stockfish (same policy
  as `AnalyzeGame`), returned with SAN lines from the mover's own perspective (no white/black
  perspective flip — that's only done for the frontend's white-relative eval bar).
- `explorer_stats(fen)` — wraps `lichess.FetchExplorer`.
- `retrieve_theory(fen)` — lookup in `coach.Index` (same index Path 1 uses) — position-specific move
  commentary for this exact FEN, or, failing that, `nearby` transposition hints (see below).
- `retrieve_opening_context(query)` — keyword search over the opening-overview corpus (see below) —
  for general "tell me about this opening" questions, not position-specific ones.
- `classify_move(fenBefore, fenAfter)` — see below.
- `evaluate_move(fen, move)` — **the "from this position, can I play X?" tool.** Takes a FEN + a move
  in SAN (`Nf3`, `O-O`, `exd5`) or UCI (`g1f3`), applies it with the Go engine (the legality
  authority), and returns `{legal, move (canonical SAN), uci, resultingFen, quality}`. The LLM can't
  reliably compute a resulting FEN itself, so this is how it evaluates a user-named move; the current
  position FEN is already injected into the chat context (see below), so "can I play Nf3 here?"
  resolves without the user pasting a FEN. Implemented in `tools.go` (`EvaluateMove`) via
  `GenerateLegalMoves` + SAN/UCI matching + `MovesToSANAndFENs` for the resulting FEN, then reuses
  `ClassifyMove` for the verdict. `evaluate_test.go` covers legal SAN/UCI, illegal, annotation
  stripping.

The FEN-keyed tools work on an arbitrary FEN, not tied to the current game, so the model can reason
about hypothetical positions ("what if I'd played Nf3?").

**Two corpora, two retrieval styles.** The move-commentary corpus (`chunks.validated.json` →
`coach.Index`) is keyed by exact `resolvedFen` — it answers "what's the theory in *this position*".
The opening-overview corpus (`overview.json` → `coach.OverviewIndex`) is opening-level prose —
introductions, philosophy, typical plans, why-play-it, move-order/transposition notes — that isn't
tied to any one position, so it's retrieved by natural-language keyword match instead
(`OverviewIndex.Search`: weighted token overlap over opening/topic/title/text, stopword-filtered, no
embeddings — consistent with the "well-tagged domain, exact/keyword lookup is enough" decision). Both
are optional at startup; a missing/empty file just disables that retrieval path. The overview corpus
was hand-extracted from the 3 source PDFs' introductions (mostly Panjwani's and Davies' — the
Nielsen/Hansen excerpt on hand is only the column-bled Larsen games, no clean intro prose); each
passage carries its source book + location. No FEN-validation step is needed for it (no moves to
replay), unlike the move corpus.

**Prefix ("transposes toward known theory") hints, on top of exact-FEN lookup.** Most chunks are
hand-authored commentary anchored to the position at the END of a move sequence the author was
discussing — e.g. a chunk's `commentaryText` explains *why* to play `3...d3`, but its `resolvedFen`
is the position 4 moves later, because the passage kept going. Exact-FEN `Index.Lookup` therefore
came up completely empty for any position earlier in that same line — a user asking the coach about
`d3` itself got a generic, ungrounded answer even though the corpus had the exact reasoning, just
filed under a different FEN. (Found and fixed live: `3...d3` in the Smith-Morra Gambit Declined had
no chunk of its own at all — a genuine corpus gap, patched by hand-adding one, engine-validated
against the running backend like every other chunk. But the *general* version of this problem —
every other chunk being similarly under-anchored — can't be fixed one FEN at a time.)

Fixed at the retrieval layer instead of by re-authoring the whole corpus: `LoadIndex` now also
replays every chunk's own `moveSequence` via `chess.ReplayLine` (SAN-token replay from the start
position, shared with the PGN-paste handler — see `chess/pgn.go`) and indexes every INTERMEDIATE
FEN along the way, not just the final one, into a second map (`prefixByFEN`) keyed by
`TheoryMatch{Chunk, PliesAhead}`. `Index.Lookup(fen)` returns a `LookupResult{Exact, Prefix}`: an
exact hit if one exists (unchanged behavior), otherwise up to `maxPrefixMatches` (3) prefix hits,
nearest-first, capped to `maxPrefixLookaheadPlies` (8) — a chunk 20 plies ahead isn't a useful signal
for the move just played. `dedupePrefix` keeps only the nearest hit per source book (Author+Title),
since a single long annotated game is chunked move-by-move and would otherwise flood the result with
near-duplicate "same game, a bit further on" hits. Because indexing is FEN-keyed (not
move-sequence-text-keyed), a real transposition — the same position reached via a different move
order, possibly from a different book entirely — collides into the same map entry, which is exactly
what surfaces multiple distinct "this can continue toward variation A (Panjwani) or variation B
(Nielsen & Hansen)" hints from one lookup (verified live: the position after `7...O-O` in one
Accelerated Dragon move order returned two prefix hits from two different books, 3 and 4 plies
ahead).

Both consumers were updated for the new `LookupResult` return type: Path 1's `BuildExplainPrompt`
renders prefix hits under an explicit "no excerpt covers this EXACT position, but it continues into
..." heading (never the "covering this exact position" heading used for real exact hits), and the
system prompt has a dedicated rule forbidding the model from presenting prefix-hint commentary as
being about the current move, or narrating any of the further-ahead moves as already played. Path
2's `retrieve_theory` tool mirrors this with a `nearby`/`note` field instead of `chunks` when only
prefix hits exist. **Known limitation, not fixed by this change:** the local `llama3.1:8b` can still
hallucinate details belonging to neither the exact nor prefix commentary it was given (observed live:
one response invented "the queen sidestepped to a safe square" for a position where the last move was
actually `O-O` — the retrieved chunks were verified correct and mentioned no queen move at all). This
is the same model-size grounding weakness noted in `docs/coach-eval/results.md`, not a retrieval bug.

**Rule-based move classifier** (`classify.go`) — two axes, eval and book:

1. *Eval grade* (`classifyByEval`): runs `analyze_position` before and after the move, converts each
   side's centipawn/mate score to a win probability via the public Lichess sigmoid
   (`winPercent = 50 + 50*(2/(1+e^(-0.00368208*cp))-1)`, mate → 0/100), and buckets the **drop** in
   the mover's own win probability into Best (<1%) / Excellent (1–3.5%) / Good (3.5–7%) /
   Inaccuracy (7–10%) / Mistake (10–20%) / Blunder (≥20%). Approximates chess.com/Lichess's
   game-review categories (their real "Expected Points Model" is proprietary and rating-adjusted —
   this is a reasonable public stand-in, not a reverse-engineering). The "after" position's raw
   score is from the *opponent's* perspective (they're now on move), so it's negated before
   comparing, keeping both sides of the swing in the mover's perspective.

2. *Book context* (`applyBookContext`, applied by `Tools.ClassifyMove`): this is the fix for the
   gambit problem — a real gambit (King's/Evans/Smith-Morra/Latvian/Danish/...) deliberately accepts
   an eval/material deficit, so grading it on eval alone would mislabel established theory as a
   Mistake. `Tools.ClassifyMove` queries the explorer for the resulting position's rated-game count
   and named opening, and checks the theory corpus. `BookStatus` = established (≥25 rated games) /
   rare (1–24) / novelty (0) / unknown (explorer unavailable). Rules:
   - **established + eval grade Inaccuracy-or-worse → final `category` becomes `Book`** (a named,
     playable line — the `note` tells the LLM to explain what the sacrifice buys, not scold the
     eval). This is the override the whole feature exists for.
   - established + eval grade fine → keep the (good) grade, note it's book.
   - novelty (0 games) → keep the eval grade but note the move has *left* known theory and is
     uncharted (new ≠ bad; the eval, not the novelty, drives the verdict there).
   - unknown → fall back to the eval grade, note the DB couldn't be consulted.
   `MoveQuality` carries both `engineCategory` (raw eval) and `category` (book-aware, human-facing)
   on purpose, so the LLM can contrast them. The gambit/novelty framing is also baked into both
   paths' system prompts (`gambitPhilosophy` in `prompt.go`) so even eval-only reasoning frames these
   correctly. Verified end-to-end: the Latvian Gambit (2...f5) grades `engineCategory: Mistake` but
   `category: Book` (established, 942k games).

   **Used in both paths:** the freeform agent exposes it as the `classify_move` tool (and
   `evaluate_move`, which applies a named move then classifies it — this is what powers "from this
   position can I play X?"). Path 1 (per-move explanation) runs it server-side whenever the request
   includes `prevFen`, injecting the verdict so the explanation opens by naming the move's quality —
   e.g. an established gambit is introduced as a playable book move, not a blunder.

   **Evaluation harness:** `docs/coach-eval/run_eval.py` drives this live backend + Ollama over a
   ladder of test cases (in-corpus positions + a swing-based ladder from Best→Blunder + both gambit
   directions) and writes `docs/coach-eval/results.md` (summary table + per-case detail). Its
   classification columns replicate this package's win% formula/thresholds exactly, so they're an
   objective check on the classifier; the explanation text is the model output to eval. First run:
   classifier/book-override all correct; main weakness is `llama3.1:8b` misattributing retrieved book
   commentary (model-size issue, not a pipeline bug).

**Prompt-quality fixes (Path 1, `prompt.go`)** — addressed the eval run's findings above plus two
longstanding "next session" TODOs:

- **Viewer perspective** (`moverAndPly`, `viewerName`, `perspectiveLine`): the coach used to always
  narrate from whichever side actually made the move, with no way to address the human as the *other*
  side. `ExplainRequest.ViewerColor` (`"w"`/`"b"`, sent by the frontend from its board-flip toggle) is
  who the human is currently studying as; `perspectiveLine` compares it against the mover (derived from
  the FEN's side-to-move field, since `moverAndPly` also returns the ply for the eval-suppression gate
  below) and picks one of two framings: same side → describe the move as something "you/we" did; other
  side → describe the mover's move in the third person by name, then give only *forward-looking*
  suggestions to the viewer, explicitly forbidding the model from narrating a move for the viewer that
  hasn't been played yet (an earlier wording — "address follow-up guidance as you/we" — let the model
  invent a fictional reply move; caught by manual browser verification, not the unit tests, which is why
  the phrasing is now deliberately blunt about "has NOT moved yet"). `ViewerColor` empty defaults the
  viewer to the mover (the plain "explain whoever moved" behavior, for callers that don't track a flip
  state). The frontend clears the pinned explanation on flip rather than auto-refetching it — the "Ask
  Coach" button is a manual, not automatic, trigger (see frontend `CLAUDE.md`); asking again after a
  flip sends the updated `viewerColor` for the *current* move (not a new one).
- **Suppress engine eval in the opening** (`openingEvalPly`, `isSeriousError`, `showEngineEval`): within
  the first `openingEvalPly` (10) plies, the engine-evaluation block and the win%-lost figure are
  omitted from the prompt entirely unless the move-quality verdict is a genuine Mistake/Blunder — early
  moves are theory/development, and tiny eval swings are noise the model would otherwise narrate as
  "+0.3, the engine slightly prefers...". An unparseable ply is treated as "not the opening" so the
  gate never over-suppresses past a real position.
- **Attribution fabrication fix:** the theory-excerpt label used to be `(Title, Location)` with no
  `Author` field shown at all — and a real chunk's `Location` read *"Bent Larsen chapter, Bonus Game 2
  (Gulko - P.H. Nielsen, Esbjerg 2000)"* (the actual author is Nielsen & Hansen; the book just has a
  chapter of Larsen's own games). With the author never shown and a person's name sitting right next to
  the commentary, the model reliably invented "Bent Larsen" as the source of a fabricated quote. Fixed
  by labeling every field explicitly — `Author: ... | Book: ... | Location: ...` — and telling the
  model in the system prompt that only the `Author` field may be credited, `Location` is never a person
  to cite unless it's identical to `Author`.
- **General brevity:** the system prompt now caps a plain book move at one short sentence and
  explicitly bans citing raw game counts/percentages, quoting a source just to say "stay consistent
  with theory," and meta-commentary about "following a deliberate plan" — the eval run's explanations
  were accurate but padded with this kind of filler. `classify.go`'s `applyBookContext` notes were
  trimmed to match (no more raw game counts baked into the "How to frame it" text the model tends to
  parrot back verbatim).

## Chess engine design

**Square encoding:** `rank*8 + file` (a1=0, h1=7, a8=56, h8=63)

**Move flags:** `Normal`, `DoublePush`, `EnPassant`, `CastleKS`, `CastleQS`, `PromoQ/R/B/N`

**Legality:** Generate pseudo-legal moves → apply each → check if own king is in check → filter. This handles pins and discovered checks automatically without special-casing.

**Castling checks:** King must not be in check, pass through check, or land in check. Rook path only needs to be empty (not attack-free).

**En passant:** Double pawn push sets `Position.EP` to the skip square. Captured pawn removed from `to.Rank() - dir` (one rank behind EP target).

**Promotion default:** If client sends a pawn move to the back rank without a promotion flag, `ApplyMove` defaults to queen.

**Move tree** (`game.go`): a `Game` is a tree of `Node`s, not a linear list. Each node caches the move that reached it, its SAN, and the resulting `*Position`; `Game.Current` is the viewed node (with `Pos`/`LastMove` mirrored for handler convenience). `ApplyMove` from the current node: if the move already exists as a child it just navigates onto it (no duplicate — replaying the mainline is a no-op branch), otherwise it appends a new child. `children[0]` is the main line; playing a *different* move from a node that already has children creates a **sideline** (`children[1:]`). `GotoNode(id)` moves `Current` without discarding anything, so stepping back and exploring never loses the original line. Node ids are per-game sequential strings (`"0"` = root). A brand-new game (the frontend's reset button) is client-side (`createGame()`); within an *existing* game, `Reset()` discards the whole tree and starts over from a fresh root — used by PGN paste (see above) so a diverging paste replaces the game outright instead of leaving the old tree's children behind as a stale sideline.

**SAN generation** (`notation.go`): `SAN(pos, move)` handles piece prefix, disambiguation (file/rank/both), capture `x`, promotion `=Q`, and check/checkmate suffix by applying the move and checking the resulting position. `MovesToSANAndFENs` steps through a sequence of UCI moves, returning both SAN strings and the FEN after each move.

**Stockfish integration** (`engine/stockfish.go`): `Engine` struct spawns the process, sends `uci` and waits for `uciok`, then for each `Analyze` call sets `MultiPV`, sends `position fen` + `go depth N`, and reads `info` lines until `bestmove`. A `sync.Mutex` serializes concurrent calls. Score from Stockfish is always from the side-to-move perspective; the `AnalyzeGame`/`EvalFEN` handlers negate score and mate when it's black's turn to produce a White-relative value.

**Eval sign convention (was a bug — get this right):** the two engine sources report differently. Local
Stockfish (UCI) is **side-to-move relative**. Lichess **cloud-eval `cp`/`mate` are White-relative**
(positive = White better) *regardless of side to move* — NOT side-to-move relative (verified against the
live API; a Black-to-move position where Black mates returns `mate: -1`). Consumers therefore flip
differently:
- **White-relative consumers** — `AnalyzeGame` (eval bar) and `EvalFEN` (move-list per-move eval): do
  NOT flip cloud; flip Stockfish on Black.
- **Side-to-move consumer** — the coach's `Tools.AnalyzePosition` (feeds `classifyByEval`, which negates
  the "after" position as the opponent's view): flip cloud on Black; do NOT flip Stockfish.

Getting this backwards flips the eval/verdict on every Black-to-move position (half of all positions).

**Storage:** In-memory map with `sync.RWMutex`. Swap for a DB by implementing the `storage.Store` interface.

## Repertoire parsing (`internal/repertoire/`)

Parses a Lichess study PGN export for the opening trainer. Deliberately **not** built on top of
`chess.TokenizePGNMoves`/`ReplayLine` (the PGN-paste path above), because the two features want the
opposite behavior on both points that matter here:

- **Custom start position, independent per chapter.** A study chapter is exported with its own
  `[FEN]`/`[SetUp "1"]` tags, and chapters need not share one — the demo repertoire's first two
  chapters both start from the Open Catalan after `1.d4 Nf6 2.c4 e6 3.g3 d5 4.Nf3 dxc4 5.Bg2 a6`,
  but its third chapter starts from a different branch entirely (`5...Nc6` instead of `5...a6`).
  Neither is the initial position. `ReplayLine` hardcodes `chess.StartFEN`.
- **Variations must survive.** `chess.stripParenVariations` throws sidelines away on purpose (PGN
  paste only ever wants the mainline). The trainer's whole card set comes from walking every
  variation, so `repertoire.ParsePGN` builds the **full tree**, recursively: a `(` opens an
  alternative to the *previous* move (a sibling subtree rooted at that move's own parent, not a
  child of it — this is standard PGN semantics and easy to get backwards), parsed via a call to the
  same recursive function that doesn't disturb the outer sequence's cursor.

Both parsers do share the underlying chess primitives (`chess.FindLegalMoveBySAN`, `chess.SAN`,
`chess.ParseFEN`/`FEN`) — plus one small addition, `chess.ApplyMove` (an exported wrapper around the
package-private `applyMove`), added because the repertoire package needed a pure position-transition
function and `chess.Game.ApplyMove` is a stateful method on the move-tree type, not a plain function.

Multi-game splitting (`splitGames`): a study export is one PGN file with one `[Tag ...]` block +
movetext per chapter, no other delimiter — a new tag line encountered after movetext has already
started for the current game ends the previous one. Move-number labels (`1.`, `2...`) and result
markers (`1-0`/`*`) are stripped by the tokenizer, never emitted as tokens; `!`/`?` suffix
annotations (`Nf3!?`) are converted to the equivalent NAG (`$5`) rather than kept as literal
characters, so both NAG spellings of an annotation land on the node the same way.

**Exclusion** (`build.go`): a move can be recorded in the study but not accepted as a repertoire
answer — e.g. the demo's `1. a4` in the "Open, a6 b5" chapter, annotated in the study's own prose as
inferior. Resolved from two sources: `$2`/`$4`/`$6` NAGs (automatic) and the sidecar
`<name>.config.json`'s `excluded` list (chapter name + SAN path from that chapter's root — explicit,
never inferred from comment text). `ExcludedSubtree` propagates down from an excluded move to every
descendant, so **no cards are generated anywhere inside an excluded line** — verified in
`build_test.go` for the `1. a4 Nc6` subtree specifically.
