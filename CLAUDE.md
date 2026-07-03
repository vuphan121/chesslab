# Chesslab

AI-powered chess opening prep tool — an interactive "Opening Study" workspace combining a Lichess
opening database, a chessboard with Stockfish analysis, move-tree navigation (with sidelines), and an
AI coach (grounded per-move explanations + freeform tool-calling chat, backed by a local LLM via
Ollama — see backend/CLAUDE.md).

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

### Opening Study page (frontend/src/app/page.tsx)
A single-screen 3-column workspace recreated from a Claude-designed hi-fi mock
(`.design_handoff/design_handoff_opening_study/`, gitignored):
```
[Opening Tree] [caption row + Board + Eval bar] [Move order + Coach]
```
- **Opening Tree** (left): live Lichess opening-explorer stats — per-move games/share%/W-D-L, click a
  row to play that continuation.
- **Caption row**: opening name + ECO chip (from Lichess), engine name + depth readout, flip-board button.
- **Board + eval bar** (center): see below.
- **Move order + Coach** (right): move-tree navigation with sidelines (see below); Coach is the live
  AI coach — auto per-move explanation + freeform tool-calling chat, backed by a local LLM (see below).

### Chess board UI
- Custom board using chess.com icy sea board texture as a CSS sprite
- Chess.com piece set (PNG, stored in `frontend/public/pieces/`)
- Rank/file coordinates rendered inside squares (top-left and bottom-right)
- Highlights: selected square, legal move dots, last move, check (red radial gradient)
- Move sound plays on every move **and every move-tree navigation** (`frontend/public/sounds/move.mp3`)
- Board supports `flipped` (wired to a toolbar button) and `squareSize` props

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
- Move Order panel renders flowing PGN-style notation, with sidelines shown inline in parentheses
- `⟨⟨ ⟨ ⟩ ⟩⟩` nav buttons (start/prev/next/end) plus a **reset** button that starts a fresh game
- `ArrowLeft`/`ArrowRight` keyboard shortcuts step through the tree the same way (ignored while typing
  in the Coach composer)

### Stockfish + Lichess cloud eval integration
- Stockfish 18 runs as a subprocess (UCI protocol), managed by `backend/internal/engine/`
- `AnalyzeGame` tries Lichess's public cloud-eval API first (deep precomputed analysis, no auth needed),
  falling back to local Stockfish if the position isn't cached
- After every move and navigation, frontend calls `GET /api/games/{id}/analysis`
- **Eval bar**: vertical bar next to the board; white section fills from bottom using a `tanh` curve
  clamped 3–97%, with a small mono score readout
- **Engine name + depth**: shown in the caption row (e.g. "Lichess Cloud · depth 55")

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
- **Path 1 — per-move explanation** (`POST /coach/explain`): fires automatically after each
  move/navigation. Retrieves book commentary for the exact position (FEN-keyed corpus), runs the
  **book-aware move classifier** (so a gambit reads as a playable "Book" move, not a blunder even when
  the engine dislikes it), and folds in the eval/explorer data the frontend already has → one grounded
  explanation, shown pinned atop the Coach panel.
- **Path 2 — freeform chat** (`POST /coach/chat`): an agentic tool-calling loop. Tools:
  `analyze_position`, `explorer_stats`, `retrieve_theory` (position-specific book text),
  `retrieve_opening_context` (opening-level prose — "what's the idea behind this opening?"),
  `classify_move`, and `evaluate_move` (applies a named move via the engine → powers "from this
  position, can I play X?"). The backend injects the live board position, so no FEN-pasting needed.
- **Corpus**: hand-chunked, engine-validated opening theory (currently the Sicilian Accelerated
  Dragon). See `backend/CLAUDE.md` and `docs/ai-coach-design.md`. Evaluation harness +
  results in `docs/coach-eval/`.

### Frontend → Backend integration
- On mount, `useChessGame` creates a new game via `POST /api/games`
- Clicks/drags go through `selectSquare` / `move(from, to)` → `POST /api/games/{id}/moves`
- Tree navigation goes through `gotoNode(id)` → `POST /api/games/{id}/goto`
- All game state (pieces, legal moves, turn, check, move tree, etc.) comes from the backend response
- After every move/navigation, frontend calls `GET /api/games/{id}/analysis` and `GET /api/games/{id}/explorer`
  in parallel (`refreshInsights`)

## What's next (planned)
- Improve coach explanation quality — the eval run (`docs/coach-eval/`) shows `llama3.1:8b`
  misattributes retrieved book commentary; try a larger local model or a stricter no-fabricated-sources
  prompt
- Expand the opening-context corpus beyond the Accelerated Dragon (see `docs/handoff.md`)
- Repertoire builder: let user mark moves as their chosen responses
- Real book-deviation tracking (currently approximated by explorer game count > 0)
- Promotion dialog (currently auto-promotes to queen)

## Tech decisions
- FEN is the universal position identifier across frontend and backend
- Chess logic lives entirely in Go — frontend has no chess logic
- Board texture is used as a CSS sprite (`background-position`) for pixel-perfect squares
- Stockfish score is reported from side-to-move perspective; backend negates when it's black's turn to give a consistent white-positive eval bar
- Game state is a tree of positions, not a linear list — enables sidelines and non-destructive backward navigation
