# Frontend — Chesslab

Next.js 16 app (App Router, TypeScript, Tailwind CSS).

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build
npx tsc --noEmit # type check only
npm run test     # vitest (currently just lib/trainer/scheduler.test.ts)
```

## Folder structure

```
src/
  app/
    layout.tsx          # root layout; loads Newsreader/Space Grotesk/JetBrains Mono via next/font/google
    page.tsx            # Analysis Board page — 3-column layout (see below); wraps in <Suspense> for
                        #   useSearchParams (?gameId= adoption, see Opening Trainer below)
    opening-study/
      page.tsx          # Opening Trainer page — setup / drilling / line-complete / summary states
    globals.css         # reset, background colour, .mono/.serif/.lbl tokens, ::selection
  components/
    board/
      Board.tsx         # 8×8 grid, drag-and-drop, right-click annotations, SVG overlay
      Square.tsx        # one square: texture sprite + highlights + labels + piece
      Piece.tsx         # renders a piece PNG via next/image
      Arrow.tsx         # SVG polygon arrow overlay (best-move + right-click annotations)
    analysis/
      EvalBar.tsx       # vertical eval bar (white fills from bottom) — no number (readout moved to caption)
      TopLines.tsx      # engine score, depth, 3 lines with per-move hover preview (not on main page — see below)
      MiniBoard.tsx     # small 8×8 board used in hover popup; parses FEN on frontend
    history/
      MoveHistory.tsx   # "Move order" panel — opening-name header, Lichess-style row move list
                        #   (figurines + per-move eval, even columns), nav/reset, PGN paste box
    layout/
      TopBar.tsx        # wordmark + PageSwitcher + turn/book-move pills, OR an arbitrary `right` node
                        #   (the trainer page passes its own) — logo mark removed
      Logo.tsx           # 34×34 SVG logo mark (no longer used on the page)
      PageSwitcher.tsx  # top-bar dropdown: Analysis Board / Opening Study, current page checked
    tree/
      OpeningTree.tsx   # "Opening Tree" panel (now under the board) — real Lichess explorer data, click row to play
    coach/
      Coach.tsx         # AI coach panel (left column) — "Ask Coach" button for a per-move explanation
                        #   (pinned, manual not automatic) + freeform chat thread
    trainer/
      RepertoirePicker.tsx  # setup screen — repertoire/chapter pick, new-cards/mode
      LinePanel.tsx         # chapter name + intro comment + line-so-far + answer comment
      FeedbackStrip.tsx     # correct / correct-alt / incorrect / excluded / line-end states
      SessionSummary.tsx    # end-of-session stats + Drill mistakes / Same again / Change repertoire
  hooks/
    useChessGame.ts     # all game state + analysis + explorer + move-tree nav + loadPgn; talks to Go backend.
                        #   Optional `initialGameId` param adopts an existing game (via `getGame`) instead
                        #   of always `createGame()` — used by the trainer's "Analyze this line" handoff.
    useTrainerSession.ts # Opening Trainer session/run state machine — see below; deliberately does NOT
                        #   reuse useChessGame (analysis/explorer/coach calls would leak the answer)
  lib/
    api/
      client.ts         # typed fetch wrappers + Analysis/Explorer/GameState (moveTree) types;
                        #   loadPGN, evalFen (per-move eval), coach: explainMove (incl. viewerColor)/coachChat
                        #   (+ CoachUnavailableError, 120s abort timeout); createGame(fen?), setPosition,
                        #   listRepertoires, getRepertoire for the trainer
    chess/
      types.ts          # shared TS types: Piece, Square, MoveNode, BoardState
      moveTree.ts       # move-tree helpers: childrenOf (null-safe), flatten, mainlineEnd
      figurine.ts       # toFigurine (SAN → figurine glyph) — extracted from MoveHistory so the
                        #   trainer's LinePanel can share it rather than duplicate it
    trainer/
      types.ts          # Repertoire/Chapter/RepNode/Card/Answer/Reply wire types (mirror the Go API),
                        #   plus CardState/SessionState/SessionOptions/SessionSummary
      rng.ts            # mulberry32 seeded PRNG + weightedChoice/uniform — scheduler never uses Math.random
      scheduler.ts      # pure Leitner-box scheduler: createSession/pickNext/grade/isComplete/summarise
      scheduler.test.ts # vitest — 10 cases per docs/opening-trainer/scheduler.md §9
      persistence.ts    # localStorage load/save/merge (chesslab.trainer.v1.<repertoireId>)
      cardKey.ts        # cardKey(fen) — mirrors Go's CardKey (strip halfmove/fullmove FEN fields)
```

## Key conventions

### Board texture sprite
`public/board-texture.png` is the chess.com icy sea board (1600×1600, 8×8 grid of 200px squares).
Each `Square` and `MiniBoard` square uses it as a CSS `background-image` with:
- `background-size: ${squareSize * 8}px`
- `background-position: -${spriteCol * squareSize}px -${spriteRow * squareSize}px`

`spriteCol = FILES.indexOf(file)` (a=0..h=7)
`spriteRow = RANKS.indexOf(rank)` ('8'=0..'1'=7)

### Piece images
Stored in `public/pieces/{color}{type}.png` — e.g. `wp.png`, `bk.png`.
Named with chess.com two-char convention: `w`/`b` + `p`/`n`/`b`/`r`/`q`/`k`.

### Square colour (for label text)
`isDark = (spriteCol + spriteRow) % 2 === 1`
Dark squares get a lighter label colour; light squares get a darker one.

### Drag-and-drop (Board.tsx)
All pointer events are handled at the board `<div>` level (not individual squares).
- `onPointerDown`: if own piece → start drag state; otherwise → `onSquareClick`
- `setPointerCapture` on the board keeps events firing even outside the element
- `hasMoved` flag (>5px) distinguishes clicks from drags
- `onPointerUp`: no movement → `onSquareClick(from)`; drag + legal target → `onMove(from, target)`
- Floating dragged piece rendered via `createPortal(document.body)` at `position: fixed`
- `document.body.style.cursor = 'grabbing'` set via `useEffect` during drag

### Right-click annotations (Board.tsx)
chess.com-style arrows/circles, drawn with the right mouse button — independent of the left-click
drag/select state above (`e.button === 2` branches before the piece-drag logic in all three pointer
handlers; `onContextMenu` is preventDefault'd to suppress the native menu).
- `rightDownSquare` (a ref, not state — doesn't need to trigger renders on its own) tracks the square
  where the right button went down; `rightDragTo` (state) tracks the live square under the cursor for
  the in-progress preview arrow.
- On `pointerup`: same square → toggle a circle (`circles: Set<string>`) on that square. Different
  square → toggle an arrow (`arrows: {from,to}[]`) — drawing the exact same arrow again removes it.
- Both are cleared by a `useEffect` keyed on `boardState.fen`, so they reset on every move, every
  `gotoNode` navigation (including the `ArrowLeft`/`ArrowRight` keyboard handler in `page.tsx`, which
  calls `navPrev`/`navNext`), and when playing an `OpeningTree` continuation — anything that changes
  the position.
- Rendered in the same SVG overlay as the (currently unused) best-move `Arrow`, in `ANNOTATION_COLOR =
  'rgba(255, 152, 0, 0.8)'` (orange) — circles as plain SVG `<circle>` rings, arrows via the existing
  `Arrow` component with a `color` override.

### Keyboard move navigation (page.tsx)
A `window` `keydown` listener (skipped when focus is in an `<input>`/`<textarea>`, e.g. the Coach
composer) maps `ArrowLeft`/`ArrowRight` to `navPrev`/`navNext` — the same tree-aware nav the Move Order
box's `⟨`/`⟩` buttons use. This is also how right-click annotations get cleared "by navigating", per
the annotation behavior above.

### Arrow (Arrow.tsx)
SVG polygon: 7-point shape (shaft + triangular head) rendered as `position: absolute` overlay on the board wrapper div. Uses `rgba(110, 110, 120, 0.55)` (transparent grey). Arrow is hidden while dragging.

### Eval bar (EvalBar.tsx)
- Width 15px, height matches board (576px at `squareSize=72` on the main page)
- `whitePct = 50 + 50 * Math.tanh(score / 400)`, clamped 3–97%
- For mate: `whitePct = mate > 0 ? 97 : 3`
- White section: `position: absolute; bottom: 0; height: ${whitePct}%` with 0.35s transition
- No number in the bar itself — the readout (`Lichess Cloud · depth 55 · +0.3`) is in the caption row,
  right-aligned, left of the flip-board button (see Page layout). `formatEval` lives in `page.tsx`.
- The bar does **not** reorient when the board is flipped (white fill stays at the bottom); the score
  value is White-relative and unaffected by flip.

### TopLines + MiniBoard (hover preview)
- Each move in an engine line is a `<span>` token with `onMouseEnter`/`onMouseLeave`
- Hovering a move token calls `handleEnter(fen, e)` which sets popup state with the FEN and Y position
- Popup renders `<MiniBoard>` via `createPortal(document.body)` at `position: fixed`, to the left of the panel
- `MiniBoard` parses FEN entirely on the frontend (no extra API call) — same texture sprite as main board
- Not rendered on the current main page (no room in the 3-column "Opening Study" layout); still available for reuse elsewhere

### Move tree & sidelines
The game is a **tree**, not a linear list — the backend never truncates, so stepping back keeps every
move (see backend CLAUDE.md for the node model). `boardState.moveTree` is the root node,
`boardState.currentNodeId` the viewed node.
- Playing a move that differs from the current node's existing continuation creates a **sideline**
  (`children[1:]`); replaying the existing move just navigates onto it.
- `lib/chess/moveTree.ts`: `childrenOf(node)` normalizes Go's `null` leaf children to `[]`; `flatten(root)`
  builds an `id → { node, parentId }` map; `mainlineEnd(node)` follows `children[0]` to the leaf.
- `MoveHistory.tsx` renders a **Lichess-style move list** (`renderRows` / `renderCell`): one full move
  per row — `[number] [white cell] [black cell]`, the two move cells `flex: 1` so the columns fill the
  width evenly. Each cell shows the move in **figurine notation** (`toFigurine` maps `KQRBN` → `♚♛♜♝♞`;
  pawn moves/castling unchanged) with a **per-move eval** on the right (`formatMoveEval`, White-relative).
  The current move is a full **blue cell** highlight (`#4a90d9`, white text). Sidelines are still
  rendered inline in parentheses as an indented row under their branch move (the old `renderContinuation`
  / `renderMove` inline path, reused).
- **Per-move eval:** `MoveHistory` keeps a `Record<fen, FenEval>` in state and a `useEffect` on
  `moveTree` walks the mainline FENs, fetching any missing one via `evalFen(fen)` (`GET /api/eval`)
  **sequentially** (to avoid hammering the endpoint) and caching by FEN so navigation never refetches.
- Header (top of the panel): the **full opening name + ECO** (`openingName`/`openingEco` props from
  `page.tsx`), allowed to **wrap** to multiple lines so a long name is never truncated (this is why it
  was moved out of the caption row — wrapping there pushed the board down). Below it: the **Move order**
  label + a **reset** button (leftmost) + `⟨⟨ ⟨ ⟩ ⟩⟩` nav buttons; nav disables at root (prev/start) and
  leaves (next/end).
- **PGN paste** (bottom of the panel, `flexShrink: 0`): a textarea + "Load PGN" button → `onLoadPgn` →
  `useChessGame.loadPgn` → `POST /api/games/{id}/pgn`. On a partial/illegal paste it throws with a
  "Loaded N/M moves — …" message shown inline under the box; the valid prefix still loads. The backend
  fully discards whatever was on the board first (`Game.Reset()`) before replaying the paste, so a line
  that diverges from the current position replaces the game outright rather than becoming a sideline
  off the old tree — see backend `CLAUDE.md` (was a real bug, fixed this session).

### useChessGame hook
- Creates a game on mount (`createGame()`)
- `selectSquare(sq)` — click-to-move flow (select piece, then destination)
- `move(from, to)` — direct drag-and-drop move, bypasses selection state; also used by `OpeningTree` to
  play a continuation (splits its `uci` into `from`/`to`). Works from any node — playing from a
  back-navigated position branches a sideline.
- `legalMovesFor(square)` — returns legal target squares for a piece without selecting it (used during drag for dot/highlight rendering)
- `gotoNode(id)` — navigate to a tree node (via `POST /goto` `{nodeId}`); **plays the move sound** so
  stepping back/forward is audible, and never discards moves.
- `navStart / navPrev / navNext / navEnd` — tree-aware nav computed from `flatten`/`mainlineEnd`
  (prev = parent, next = `children[0]`, start = root, end = current line's leaf). Used by the Move Order
  nav buttons and the `ArrowLeft`/`ArrowRight` keyboard handler in `page.tsx`.
- `refreshInsights(gameId, fen, san)` — awaits `runAnalysis` + `runExplorer` in parallel, then fires
  the per-move coach explanation with the fresh values; called after every move/goto/reset. `san` is
  the SAN of the move that reached the current node (`sanForNode`), empty at the root.
- `runAnalysis(gameId)` — calls `GET /api/games/{id}/analysis`, updates `analysis`/`analyzing`
- `runExplorer(gameId)` — calls `GET /api/games/{id}/explorer`, updates `explorer`/`explorerLoading`;
  silently keeps the previous value on failure (e.g. `LICHESS_TOKEN` unset)
- `reset()` — starts a fresh game (`createGame()`), clearing the whole tree; wired to the Move Order reset button
- `loadPgn(pgn)` — replaces the whole game with a pasted PGN move list (`POST /api/games/{id}/pgn`),
  replayed from the start; plays the move sound + `refreshInsights`. Throws with a "Loaded N/M moves — …"
  message if the paste didn't fully parse (valid prefix still loads). Wired to the Move Order PGN box.
- Auto-promotes to queen (promotion dialog is a planned TODO)
- Plays `public/sounds/move.mp3` after every successful move **and** on every tree navigation
- **Board orientation (`flipped`/`toggleFlipped`) lives in this hook**, not `page.tsx` — flipping is
  also which side the coach addresses (see below), so the hook needs to own it. `page.tsx` just
  destructures `flipped`/`toggleFlipped` from the hook and passes `flipped` straight to `Board` as
  before; the flip button's `onClick` calls `toggleFlipped`.
- **AI coach (Path 1 — per-move explanation) is manually triggered, not automatic.** An earlier version
  fired `POST /coach/explain` after every move/goto once fresh analysis+explorer were in hand, debounced
  350ms. That meant scrubbing through a game (holding an arrow key, or just reviewing move by move at a
  normal pace) could queue up several real local-LLM calls back-to-back — the debounce only filtered
  navigations *within* the window, it didn't cancel a call already in flight, and Ollama serves one
  request at a time, so the queue was felt as UI lag. Replaced with an explicit **`askCoach()`** the
  "Ask Coach" button (`Coach.tsx`) calls: reads the *current* `gs`/`analysis`/`explorer`/`flipped` from
  state (not passed-in snapshots) and posts `{fen, prevFen, lastMoveSan, viewerColor, analysis,
  explorer}` (`viewerColor` = `flipped ? 'b' : 'w'`) to `POST /coach/explain`, exposing
  `coachExplanation`/`coachExplaining`/`coachError`. No-ops at the root (no move to explain — `Coach`
  disables the button via `canAsk={!atStart}`, passed from `page.tsx`). Still request-id-guarded
  (`explainReqId`) so a stale response from a position/perspective the user has since left can't
  overwrite what's shown; there's no `AbortController`/backend cancellation, since a *manual* action is
  never queued the way automatic-on-every-navigation was.
- **`refreshInsights(gameId)`** (analysis + explorer only, called after every move/goto/reset/PGN load)
  clears any pinned coach explanation/error back to idle instead of re-fetching one — the old
  explanation belongs to the position that's now behind you; hit "Ask Coach" again for the new one.
- **Flipping also clears the pinned explanation** (`toggleFlipped`) — it was framed for the old
  perspective ("you/we" meant the other side), so it's now stale; re-ask for the new side rather than
  silently re-fetching (which is exactly the automatic-call pattern this design moved away from).
- **AI coach (Path 2 — freeform chat):** `sendCoachChat(message, history)` wraps `POST /coach/chat`
  (backend reads the live board position from the game store, so only `{message, history}` is sent).
  The `Coach` component owns the chat thread state and passes prior turns as `history`.
- Returns `{ boardState, selectSquare, move, legalMovesFor, gotoNode, navStart, navPrev, navNext, navEnd, reset, loadPgn, busy, analysis, analyzing, explorer, explorerLoading, coachExplanation, coachExplaining, coachError, askCoach, sendCoachChat, flipped, toggleFlipped }`

### Page layout (page.tsx) — "Analysis Board"
Originally from a Claude-designed hi-fi mock (`design_handoff_opening_study/`, gitignored), since
reworked into a **Coach | Board | Move order** layout. One outer panel (`1432px`, bg `#e8e8e6` — same
as the page, so no visible frame; no drop shadow) containing a `TopBar` and a 3-column row:
```
[Coach, SIDE_WIDTH 371px]  [caption + Board 576px + EvalBar 15px + OpeningTree]  [MoveHistory, 371px]
```
`SQUARE_SIZE = 72`, `BOARD_SIZE = 576`. The two **side columns** are pinned to `height: BOARD_SIZE` and
pushed down by `BOARD_TOP_OFFSET` (= caption-row height 30 + column gap 14 = 44/45) so their tops and
bottoms line up with the board (not the caption above it). The **caption row** holds only the engine
readout (`{engineName} · depth {N} · {formatEval}`) + flip button, right-aligned; the opening name/ECO
moved into the `MoveHistory` header. The **OpeningTree** sits under the board (fixed `height: 260`,
scrolls internally).

- `TopBar`, `Board`, `EvalBar`, `MoveHistory`, `OpeningTree`, and `Coach` are all wired to real backend
  state (`useChessGame`). `Coach`'s per-move explanation is pinned at the top of the message area but
  manually triggered — an "Ask Coach" button (idle prompt if nothing's asked yet, "Ask again"/"Try
  again" once something is, disabled at the root and while a request is in flight, with a "thinking"
  indicator during the slow local-model call) — plus the freeform chat thread below it; the composer
  posts to `/coach/chat`. Both coach paths degrade gracefully: a 503 (no local model) shows "Coach is
  offline…", other failures show a generic error, and a hung request aborts after 120s (see `client.ts`)
  rather than freezing the panel. The coach needs the Go backend's coach endpoints + a local LLM
  (Ollama) running — see backend docs.
- Opening name/ECO: `openingName`/`openingEco` come from `explorer.openingName`/`openingEco` (the current
  position's named opening, straight from Lichess — falls back to "Starting Position"/"Custom Line" when
  null) and are passed to `MoveHistory`, which renders them (full, wrapping) in its header. `TopBar`'s
  "Book move" pill is `explorer.totalGames > 0` (i.e. some rated 2000+ game has reached this exact
  position) rather than real book-deviation tracking, but is a reasonable proxy. The caption row above
  the board shows `{engineName} · depth {N} · {formatEval}` (from `analysis`, hidden when depth is 0)
  and a **flip board** icon button (`onClick={toggleFlipped}`, from the hook — see `useChessGame`
  above). `flipped` is passed straight to `Board` for the visual flip and does not affect the eval bar
  (still White-relative either way), but it **does** re-frame the coach: `viewerColor` on the next "Ask
  Coach" request addresses whichever side is now at the bottom as "you/we", even when the other side
  made the move (see the backend's "Viewer perspective" design note). Flipping clears any pinned
  explanation rather than auto-refetching it for the new side — see `useChessGame` above.
- `OpeningTree` row click calls `onPlay(uci)` → `move(uci.slice(0,2), uci.slice(2,4))`, playing that
  continuation on the board like a normal move (triggers the same `refreshInsights` refresh).
- Design reference lives in `.design_handoff/design_handoff_opening_study/` (unzipped from the design
  handoff bundle, gitignored) — see its `README.md` for full token/spacing/interaction spec.

### Page layout (opening-study/page.tsx) — "Opening Trainer"
Same outer-panel styling as the Analysis Board (`1432px`, `#e8e8e6`, `TopBar` on top), but a state
machine over `useTrainerSession().phase`: `setup` (just `RepertoirePicker`, centered) →
`drilling`/`line-complete` (the 3-column `LinePanel | Board+FeedbackStrip | (empty)` layout — no
eval bar, no `OpeningTree`, no `Coach`, since any of those would show the answer) → `summary`
(`SessionSummary`, centered). `TopBar`'s `right` prop shows the repertoire name instead of the usual
turn/book-move pills.

- The caption row above the board shows `{turn} to move — play your repertoire move` (left) and
  `step {n}[ / {sessionLength}]` + the flip button (right, same SVG as the Analysis Board's).
  `flipped` defaults to the repertoire's own side (`rep.side === 'b'`) at session start, so a Black
  repertoire opens with Black at the bottom.
- Board interaction (`selectSquare`/`move`/`legalMovesFor`) is hand-rolled in `useTrainerSession`,
  mirroring `useChessGame`'s click-to-move/drag pattern exactly — **`boardState` must be a value
  derived fresh every render from the raw `GameState` + current `selected`**
  (`gameState ? toBoardState(gameState, selected) : null`), never stored as its own state snapshot.
  An earlier version stored `boardState` directly (always computed with `selectedSquare=null`),
  which made `legalMoves` permanently empty and silently broke click-to-move after the very first
  square-select — caught during manual browser verification, not by `tsc`/lint, since it type-checks
  fine either way.
- `FeedbackStrip` sits directly under the board; when `phase === 'line-complete'` a row below it
  shows **Analyze** (always available) plus either **"Do it again"** (the run had a mistake) or
  **"Next line"** (clean run) — never both — per `useTrainerSession`'s run-completion rule (see the
  root `CLAUDE.md`'s "Opening Trainer page" section for the full flow rationale).

## Environment
`NEXT_PUBLIC_API_URL` — backend URL, defaults to `http://localhost:8080`
