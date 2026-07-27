# Chesslab

AI-powered chess opening prep tool. Two pages, switchable via a dropdown in the top bar:
- **Analysis Board** (`/`) — a Lichess opening database, a chessboard with Stockfish analysis,
  move-tree navigation (with sidelines), and an AI coach (grounded per-move explanations + freeform
  tool-calling chat, backed by a local LLM via Ollama — see backend/CLAUDE.md).
- **Opening Study** (`/opening-study`) — spaced-repetition drilling of a repertoire parsed from a
  Lichess study (Chessbook/Lotus style). See `docs/opening-trainer/` for the full design; summarized
  below under "Opening Trainer".

## Monorepo structure

```
chesslab/
  frontend/   # Next.js app (React, TypeScript, Tailwind)
  backend/    # Go REST API (chess engine + game state + Lichess integrations)
```

## How to run

**Backend** (port 8080):
```bash
cd backend
STOCKFISH_PATH="C:/Users/vupha/AppData/Local/Microsoft/WinGet/Packages/Stockfish.Stockfish_Microsoft.Winget.Source_8wekyb3d8bbwe/stockfish/stockfish-windows-x86-64-avx2.exe" go run ./cmd/server/
```
`STOCKFISH_PATH` defaults to `stockfish` in PATH (works in any new terminal after winget install).

The Opening Tree panel needs a Lichess API token — see `backend/CLAUDE.md` for how to get one and set
`LICHESS_TOKEN` in `backend/.env` (gitignored). Without it, `/explorer` returns 503 and the tree panel
just stays empty; everything else still works.

**Frontend** (port 3000):
```bash
cd frontend
npm run dev
```

Both must be running together. Frontend talks to backend at `http://localhost:8080`.

`.claude/launch.json` has both configured for the `preview_start` tool if you're driving this with
Claude Code.

## What's built

### Analysis Board page (frontend/src/app/page.tsx)
A single-screen 3-column workspace, originally from a Claude-designed hi-fi mock
(`.design_handoff/design_handoff_opening_study/`, gitignored), since reworked into a
**Coach | Board | Move order** layout:
```
[Coach]  [caption row + Board + Eval bar]   [Move order]
         [Opening Tree, under the board]
```
- **Coach** (left column): the AI coach — an "Ask Coach" button for a per-move explanation (manual, not
  automatic — see below) + freeform tool-calling chat, backed by a local LLM (see below). Narrow and
  tall; its panel height is pinned to the board height.
- **Board + eval bar** (center): see below. Below the board sits the **Opening Tree** (live Lichess
  opening-explorer stats — per-move games/share%/W-D-L, click a row to play that continuation), a
  compact fixed-height scrollable panel.
- **Caption row** (above the board): engine name + depth + eval readout (right-aligned, left of the
  flip-board button). The opening name/ECO used to live here but moved to the Move order header so a
  long name can wrap without pushing the board down.
- **Move order** (right column): move-tree navigation with sidelines (see below). Header shows the full
  opening name + ECO (wraps, never truncated) and a **PGN paste** box at the bottom. Narrow and tall;
  panel height pinned to the board height.
- The outer card background matches the page background (no visible frame/border) and the two side
  columns are offset down by the caption-row height so their tops/bottoms line up with the board.

### Chess board UI
- Custom board using chess.com icy sea board texture as a CSS sprite
- Chess.com piece set (PNG, stored in `frontend/public/pieces/`)
- Rank/file coordinates rendered inside squares (top-left and bottom-right)
- Highlights: selected square, legal move dots, last move, check (red radial gradient)
- Move sound plays on every move **and every move-tree navigation** (`frontend/public/sounds/move.mp3`)
- Board supports `flipped` (wired to a toolbar button, state lives in `useChessGame` — flipping also
  re-frames the AI coach's perspective, see below) and `squareSize` props

### Drag-and-drop piece movement
- Pointer Events API (`onPointerDown` / `onPointerMove` / `onPointerUp`) on the board div
- `setPointerCapture` keeps drag smooth even when cursor leaves the board
- Piece disappears from source square while dragging (floating piece via `createPortal` to `document.body`)
- Legal target squares show dots during drag; hovering a legal target turns it blue (`#7ecae8`)
- Click (< 5px movement) still works through the same pointer handlers

### Right-click board annotations
chess.com-style arrows and circles, drawn with the right mouse button (independent of the left-click
drag/move logic above):
- Right-click drag → orange arrow; right-click the same square again with no drag → circle toggle
- Drawing the exact same arrow again removes it
- Annotations reset automatically whenever the position changes (move played, tree navigation, or
  playing an Opening Tree continuation)

### Move tree with sidelines
Games are stored as a **tree**, not a linear move list — navigating backward never discards moves.
- Playing a different move from an already-visited position creates a **sideline** (variation);
  replaying an existing continuation just navigates onto it, no duplicates
- Move Order panel renders a **Lichess-style move list**: one full move per row (`N. white  black`),
  the two move columns filling the width evenly, each move shown in **figurine notation** (`♞f3`) with
  a **per-move eval** to its right (White-relative, from `GET /api/eval?fen=` — cloud-first, cached by
  FEN). The current move is highlighted with a full blue cell. Sidelines are still rendered inline in
  parentheses as an indented row under the move they branch from.
- `⟨⟨ ⟨ ⟩ ⟩⟩` nav buttons (start/prev/next/end) plus a **reset** button that starts a fresh game
- `ArrowLeft`/`ArrowRight` keyboard shortcuts step through the tree the same way (ignored while typing
  in the Coach composer)
- **PGN paste** (box at the bottom of the Move order panel): paste a move list → `POST
  /api/games/{id}/pgn` discards whatever's currently on the board (`Game.Reset()`, not just a cursor
  move — a paste that diverges from the current line used to silently become a sideline off the old
  tree, a bug fixed this session) and replays the new list from the start position; a partial/illegal
  paste loads the valid prefix and reports how far it got.

### Stockfish + Lichess cloud eval integration
- Stockfish 18 runs as a subprocess (UCI protocol), managed by `backend/internal/engine/`
- `AnalyzeGame` tries Lichess's public cloud-eval API first (deep precomputed analysis, no auth needed),
  falling back to local Stockfish if the position isn't cached
- After every move and navigation, frontend calls `GET /api/games/{id}/analysis`
- **Eval bar**: vertical bar next to the board; white section fills from bottom using a `tanh` curve
  clamped 3–97% (no number in the bar itself)
- **Engine name + depth + eval readout**: shown in the caption row, right-aligned (e.g. "Lichess
  Cloud · depth 55 · +0.3")
- **Sign convention (important, was a bug):** Lichess cloud-eval `cp`/`mate` are **White-relative**
  (positive = White better), *regardless of side to move* — NOT side-to-move relative. Local Stockfish
  (UCI) IS side-to-move relative. So the two consumers flip differently: the eval bar / `AnalyzeGame` /
  `EvalFEN` want White-relative (no flip on cloud, flip Stockfish on Black), while the coach's
  `AnalyzePosition` wants side-to-move (flip cloud on Black, no flip Stockfish). See Tech decisions.

### Lichess Opening Explorer integration
- `GET /api/games/{id}/explorer` proxies `explorer.lichess.ovh` (rated 2000+ games), requires
  `LICHESS_TOKEN` (see `backend/CLAUDE.md` — this endpoint needs a bearer token unlike cloud-eval)
- Returns per-move games/share%/W-D-L plus each candidate move's own named opening + ECO, straight from
  Lichess (no extra per-move lookups needed)
- Drives the Opening Tree panel, the caption's opening name/ECO, and the top bar's "Book move" pill
  (`totalGames > 0` for the current position — a proxy, not real book-deviation tracking)

### Chess engine (Go backend)
- Full rules: all piece moves, castling (both sides), en passant, promotion (Q/R/B/N)
- Check, checkmate, stalemate, 50-move rule, insufficient material detection
- Legality via apply-then-check-king approach (handles pins, discovered check automatically)
- FEN parsing and generation; SAN generation with disambiguation, check/checkmate suffix
- Game state is a move tree (`chess.Node`), not a linear history — see backend/CLAUDE.md
- REST API — see `backend/CLAUDE.md` for endpoints

### AI coach (backend `internal/coach/`, frontend `components/coach/Coach.tsx`)
Grounded chess coaching backed by a **local LLM** (Ollama + `llama3.1:8b` by default — no Anthropic
key; overridable via `OLLAMA_BASE_URL`/`COACH_MODEL`). The LLM writes prose; it never invents chess
facts — those come from Stockfish/Lichess and a curated opening-theory corpus. Two paths:
- **Path 1 — per-move explanation** (`POST /coach/explain`): triggered by an **"Ask Coach" button**,
  not automatic — an earlier version fired on every move/navigation, but that queued up several slow
  local-LLM calls when scrubbing through a game (Ollama serves one request at a time), which was felt
  as UI lag. Retrieves book commentary for the exact position (FEN-keyed corpus), runs the **book-aware
  move classifier** (so a gambit reads as a playable "Book" move, not a blunder even when the engine
  dislikes it), and folds in the eval/explorer data the frontend already has → one grounded explanation,
  shown pinned atop the Coach panel. Cleared back to idle on navigation/flip (see frontend `CLAUDE.md`).
- **Path 2 — freeform chat** (`POST /coach/chat`): an agentic tool-calling loop. Tools:
  `analyze_position`, `explorer_stats`, `retrieve_theory` (position-specific book text),
  `retrieve_opening_context` (opening-level prose — "what's the idea behind this opening?"),
  `classify_move`, and `evaluate_move` (applies a named move via the engine → powers "from this
  position, can I play X?"). The backend injects the live board position, so no FEN-pasting needed.
- **Corpus**: hand-chunked, engine-validated opening theory (currently the Sicilian Accelerated
  Dragon). See `backend/CLAUDE.md` and `docs/ai-coach-design.md`. Evaluation harness +
  results in `docs/coach-eval/`.
- **Viewer perspective:** flipping the board (see above) re-explains the current move addressing
  whichever side is now at the bottom as "you/we" — even if the other side made the move, in which case
  the move is described in the third person and only forward-looking suggestions are given (the coach
  never claims a move was played that wasn't). Independent of who actually moved; see backend
  `CLAUDE.md`'s "Prompt-quality fixes" for the framing logic and a fabrication bug this caught.
- **Opening-eval suppression:** in the first ~10 plies, the per-move explanation omits the engine
  evaluation entirely unless the move is a genuine Mistake/Blunder — early moves are theory/development
  and a tiny eval swing is noise, not something to quote at the player.

### Frontend → Backend integration
- On mount, `useChessGame` creates a new game via `POST /api/games` (or adopts an existing one via
  `?gameId=` — see "Opening Trainer" below, "Analyze this line" handoff)
- Clicks/drags go through `selectSquare` / `move(from, to)` → `POST /api/games/{id}/moves`
- Tree navigation goes through `gotoNode(id)` → `POST /api/games/{id}/goto`
- All game state (pieces, legal moves, turn, check, move tree, etc.) comes from the backend response
- After every move/navigation, frontend calls `GET /api/games/{id}/analysis` and `GET /api/games/{id}/explorer`
  in parallel (`refreshInsights`)

### Top bar page switcher (`components/layout/PageSwitcher.tsx`)
A dropdown next to the wordmark on every page, listing Analysis Board / Opening Study with the
current page checked; `next/link` navigation, closes on outside click/Escape. `TopBar` takes an
optional `right` prop that replaces its default turn/book-move pills entirely — the trainer page
passes its own (the repertoire name), the analysis page still passes `turn`/`isBookMove` as before.

### Opening Trainer page (`/opening-study` — `frontend/src/app/opening-study/page.tsx`)
Spaced-repetition drilling of a repertoire parsed from a Lichess study (Chessbook/Lotus style).
Full design in `docs/opening-trainer/` (read `design.md` first); this section covers what's
actually built and where the implementation diverged from or extended that design.

**Backend** (`backend/internal/repertoire/`): `ParsePGN` parses a multi-chapter study export (each
chapter rooted at its own `[FEN]`/`[SetUp]`, full variation tree preserved — this is a *new* parser,
deliberately not sharing code with `chess.TokenizePGNMoves`, which is single-game and strips
variations by design for the PGN-paste feature). `BuildRepertoire` resolves exclusions (sidecar
`.config.json` + `$2/$4/$6` NAGs) and derives the card set + opponent reply pools, keyed by
`CardKey(fen)` (clock-stripped FEN) so the same position reached via different chapters/move-orders
merges into one card. Demo repertoire: `backend/data/repertoires/catalan-white.{pgn,config.json}` —
fetched from `https://lichess.org/study/pYmWdR27`, 86 cards across 4 chapters (a 4th chapter, "Open,
c5", was added to the source study after the first 3 — verified by `internal/repertoire/*_test.go`,
including the card-count assertion and independence checks in `docs/opening-trainer/data-format.md`
§2.3; unlike chapters 1–3, chapter 4's individual cards aren't hand-tabulated in that doc, just its
totals — see the doc for why). New endpoints: `GET /api/repertoires`,
`GET /api/repertoires/{id}`, `POST /api/games/{id}/position` (re-points an existing game at an
arbitrary FEN, discarding its tree — same contract as `Game.Reset()`, see backend `CLAUDE.md`).
`POST /api/games` gained an optional `{fen}` body (defaults to the initial position, unchanged for
the analysis page).

**Frontend scheduler** (`frontend/src/lib/trainer/scheduler.ts`): pure TypeScript, seeded RNG
(`rng.ts`, `mulberry32`), no chess knowledge — a Leitner-box ladder (`BASE_GAP = [2,4,8,16,32,64]`)
with lapse-based gap decay (`0.8 ** lapses`) so a card you've failed keeps returning sooner
*permanently*, not just on the next rep. Fully covered by `scheduler.test.ts` (10 cases: promotion
gaps, demotion floor, lapse decay, retirement, determinism under a fixed seed, etc.) — this is the
one part of the feature whose correctness isn't visible by looking at the screen. `persistence.ts`
saves per-card `{box, lapses, seen, correct, lastSeenISO}` to `localStorage`
(`chesslab.trainer.v1.<repertoireId>`), with crude cross-session day-based box decay at session
start (`createSession`).

**Session hook** (`hooks/useTrainerSession.ts`) — deliberately does *not* reuse `useChessGame` (which
fires analysis/explorer/coach after every move — would both leak the answer and be slow). Owns the
scheduler session, the current run, and the actual drill flow, which is stricter than the original
design doc's "no retry" decision (superseded — see below):

- **Correct answer** (primary or alternate): grades the card correct, shows a brief "✓ Correct" /
  "✓ Also in your repertoire" flash, then plays the opponent's reply (weighted toward whichever
  continuation has more lapses recorded against cards in its subtree — approximated here as the
  *immediate* next card's lapse count, not a full subtree walk) and advances into the next card in
  the same run, or ends the run if there's no further recorded continuation (out of book).
- **Wrong answer** (including a recognized-but-excluded move): grades the card incorrect *once* per
  presentation, shows the expected move + any study comment, **undoes the move and re-prompts the
  same position** — the user must retry until they play a recognized answer before the run
  continues. This replaces design.md §7.3/§12's original "no retry" decision; the user asked for
  undo-show-retry explicitly and it's what's implemented.
- **Run completion**: if the run had *any* mistake (even one later corrected via retry), the only
  way forward is **"Do it again"** (replays the same run from its starting card) — no "Next line"
  option is offered until a clean pass. A clean run offers **"Next line"** (advances the scheduler
  via `pickNext`). Both states also offer **"Analyze"**.
- **"Analyze this line"**: builds a fresh game at the run's starting FEN, replays every move
  actually played this run (both sides, via sequential `POST /moves` calls) on a **new** backend game
  object, then navigates to `/?gameId=<newId>` — `useChessGame` picks up an existing game via that
  query param (see above) instead of creating a fresh one, handing the exact line to the full
  Analysis Board (eval bar, coach, explorer, everything — none of which the trainer itself shows,
  since they'd give away the answer).

**A real bug found and fixed during manual verification**: the played move's SAN was originally read
via `gs.moveTree.children[0]`, which is only "the move just played" immediately after a tree reset.
Within a run the tree accumulates every ply (the game object is reused across the whole session, per
design), so by the second move in a run this was reading the *wrong* node's SAN entirely — it would
have silently misgraded correct answers as wrong past the first move of every line. Fixed by looking
the played node up via `flatten(gs.moveTree).get(gs.currentNodeId)?.node`, the same pattern
`useChessGame`'s `nodeMeta` already uses.

**A second real bug, reported by actual use** (not caught by any test — the scheduler's own unit
tests are chess-agnostic and never exercise `useTrainerSession`'s repertoire-aware layer): "Do it
again" could visibly replay a *different* line than the one just failed, and "Next line" after a
clean pass could hand back the exact card that was just answered correctly. Root cause: a run starts
at its **chapter's** beginning (`resolveRunStartCard`), not at the specific card the scheduler picked
as due, and the opponent's reply at every branch point was chosen by unseeded weighted-random
(`pickOpponentReply`) with no memory of *why* the run started. Two consequences: (1) two runs from
the same start could wander down different siblings and diverge after the first branch — "Do it
again" wasn't reproducible; (2) if the random walk never actually reached the due card down a
different branch, that card's due status never resolved, so the scheduler would just hand it straight
back out on the very next "Next line" — a real repeat, not a perceived one. Fixed by
`dueTargetPathRef`: when a run starts (`startSession`/`nextLine`), it's set to the due card's own
`pathSan` (the SAN path from chapter root — already computed server-side for the "line so far"
display); `pickOpponentReply` now forces the reply matching that path for as long as one remains,
falling back to the original weighted-random choice once the path is exhausted (or doesn't match,
e.g. the due card's recorded path came from a different chapter than the one this run resolved to —
safe no-op fallback, not a regression). `redoLine` deliberately leaves the ref untouched, so a redo
retraces the same forced path. Not covered by an automated test (it's fundamentally about random-walk
behavior across many runs) — verify by actually drilling a multi-branch chapter.

**UI components** (`components/trainer/`): `RepertoirePicker` (setup screen — repertoire/chapter
selection, new-cards/mode options — a session-length control existed early on but was removed as
unneeded; sessions always run "until done" now), `LinePanel` (chapter name + intro comment + line
so far, reusing `toFigurine`, now extracted to `lib/chess/figurine.ts` so both this and
`MoveHistory` share one implementation), `FeedbackStrip` (correct/incorrect/excluded states,
`aria-live="polite"`), `SessionSummary` (end-of-session stats + "Drill mistakes"/"Same
again"/"Change repertoire"). No eval bar, engine readout, or opening tree on this page — see
`docs/opening-trainer/design.md` §10 for why.

## What's next (planned)
- **Coach explanation quality — decision: accept current state, rely on human verification, stop
  chasing this with more prompt rules.** A single session iteratively tightened `prompt.go`'s system
  prompt against `llama3.1:8b` roughly a dozen times (see backend `CLAUDE.md`'s "Prompt-quality
  fixes" — fabricated sources, meta-commentary leaking into output, invented tactical/strategic
  claims, gambit language on non-gambit positions, wrong side attribution), and each fix closed the
  specific case caught while the model found a new failure — trending toward *more* basic errors, not
  fewer (misnaming which piece was moved; describing an entirely different move than the one played,
  despite it being stated verbatim in the prompt). That's a capability ceiling, not a prompt-wording
  gap — further iteration here has a low expected return. If explanation *quality* becomes a priority
  again, the first thing to try is swapping `COACH_MODEL` for a larger local model and re-running
  `docs/coach-eval/run_eval.py`, not more system-prompt edits. Until then, treat Path 1's free-text
  explanation as "directionally useful, needs a human reading it critically," not ground truth — the
  verdict/book-status/eval data it's grounded in is trustworthy (that's rule-based), the prose
  wrapped around it isn't reliably so.
- **Cache per-move coach explanations.** `askCoach` currently re-calls the LLM every time, even for a
  position it's already explained this session (e.g. clicking "Ask again" with nothing changed, or
  navigating away and back). Since Path 1's grounding inputs are deterministic per (FEN, prevFEN,
  lastMoveSan, viewerColor) — not per request — the explanation could be cached keyed on those,
  turning a repeat ask into an instant cache hit instead of another 15-30s local-LLM call. Open
  question: where the cache lives (in-memory in the Go backend, keyed like `coach.Index`; or
  frontend-side like `MoveHistory`'s per-FEN eval cache) and whether flipping the board (which
  changes `viewerColor`) should count as a cache-key change (yes) or invalidate/reuse the same-side
  explanation (no — different viewer means different prose).
- Expand the opening-context corpus beyond the Accelerated Dragon (see `docs/handoff.md`)
- Repertoire builder: let user mark moves as their chosen responses
- Real book-deviation tracking (currently approximated by explorer game count > 0)
- Promotion dialog (currently auto-promotes to queen)

## Deployment (Render)

`render.yaml` (repo root) is a Render Blueprint deploying two services: `chesslab-backend` (Go +
Stockfish, `backend/Dockerfile` — Render's native Go runtime can't `apt-get install stockfish`, hence
Docker) and `chesslab-frontend` (Next.js **static export** — both pages are fully client-rendered
with no API routes/middleware, so `next.config.ts` sets `output: 'export'` and it deploys as a plain
static site, not a Node service). See `backend/.env.example` / `frontend/.env.example` for the env
vars each service needs.

**The AI coach is deliberately not deployed.** There's no Ollama instance on Render; `/coach/explain`
and `/coach/chat` return 503 in production exactly like the existing "Stockfish unavailable" /
"`LICHESS_TOKEN` unset" degradation paths already handle — no code branch exists for this specifically,
it falls out of `newCoachDeps` wiring an `OllamaClient` that just fails to connect. Everything else
(board, engine analysis, opening explorer, opening trainer) is unaffected.

`ALLOWED_ORIGIN` (backend) restricts CORS to the deployed frontend's origin instead of the local-dev
default of `*`. `PORT` is read from the environment (Render sets it automatically) instead of the old
hardcoded `:8080`. `GET /healthz` exists purely for Render's health check, which otherwise probes `/`
and gets chi's default 404.

## Tech decisions
- FEN is the universal position identifier across frontend and backend
- Chess logic lives entirely in Go — frontend has no chess logic
- Board texture is used as a CSS sprite (`background-position`) for pixel-perfect squares
- **Eval sign:** Stockfish/UCI reports side-to-move relative; Lichess cloud-eval reports White-relative
  (verified against the live API). The backend normalizes per consumer: the eval bar / `AnalyzeGame` /
  `EvalFEN` emit White-relative (flip Stockfish on Black, never flip cloud); the coach's
  `AnalyzePosition` emits side-to-move for `classifyByEval` (flip cloud on Black, never flip Stockfish).
  Getting this wrong flips the eval on every Black-to-move position — it was a real bug, see git history.
- Game state is a tree of positions, not a linear list — enables sidelines and non-destructive backward navigation
- Per-move eval in the move list comes from a game-independent `GET /api/eval?fen=` endpoint, fetched
  lazily and cached by FEN on the frontend (design note: the app previously had *no* per-move eval on
  purpose — "that's what the eval bar is for" — but the Lichess-style move list reintroduced it)
