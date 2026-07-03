# Frontend — Chesslab

Next.js 16 app (App Router, TypeScript, Tailwind CSS).

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build
npx tsc --noEmit # type check only
```

## Folder structure

```
src/
  app/
    layout.tsx          # root layout; loads Newsreader/Space Grotesk/JetBrains Mono via next/font/google
    page.tsx            # main page — "Opening Study" 3-column layout (see below)
    globals.css         # reset, background colour, .mono/.serif/.lbl tokens, ::selection
  components/
    board/
      Board.tsx         # 8×8 grid, drag-and-drop, right-click annotations, SVG overlay
      Square.tsx        # one square: texture sprite + highlights + labels + piece
      Piece.tsx         # renders a piece PNG via next/image
      Arrow.tsx         # SVG polygon arrow overlay (best-move + right-click annotations)
    analysis/
      EvalBar.tsx       # vertical eval bar (white fills from bottom) + mono readout
      TopLines.tsx      # engine score, depth, 3 lines with per-move hover preview (not on main page — see below)
      MiniBoard.tsx     # small 8×8 board used in hover popup; parses FEN on frontend
    history/
      MoveHistory.tsx   # "Move order" box — flowing PGN notation with sidelines, nav + reset buttons
    layout/
      TopBar.tsx        # logo + wordmark + book-move/turn status pills
      Logo.tsx           # 34×34 SVG logo mark
    tree/
      OpeningTree.tsx   # "Opening Tree" left panel — real Lichess explorer data, click row to play
    coach/
      Coach.tsx         # AI coach panel — live per-move explanation (pinned) + freeform chat thread
  hooks/
    useChessGame.ts     # all game state + analysis + explorer + move-tree nav; talks to Go backend
  lib/
    api/
      client.ts         # typed fetch wrappers + Analysis/Explorer/GameState (moveTree) types;
                        #   coach: explainMove/coachChat (+ CoachUnavailableError, 120s abort timeout)
    chess/
      types.ts          # shared TS types: Piece, Square, MoveNode, BoardState
      moveTree.ts       # move-tree helpers: childrenOf (null-safe), flatten, mainlineEnd
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
- Bottom mono readout (e.g. `+0.3`) below the midline hairline

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
- `MoveHistory.tsx` renders flowing PGN notation: main line inline, sidelines recursively in
  parentheses/muted (`renderContinuation` / `renderMove`). Numbers: white = odd `ply` (`ceil(ply/2)`);
  black shows a number only after a variation. Current move gets the `#d4eef9` highlight (no per-move
  eval — that's what the eval bar is for). Header has a **reset** button (leftmost) + `⟨⟨ ⟨ ⟩ ⟩⟩` nav
  buttons; nav disables at root (prev/start) and leaves (next/end).

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
- Auto-promotes to queen (promotion dialog is a planned TODO)
- Plays `public/sounds/move.mp3` after every successful move **and** on every tree navigation
- **AI coach (Path 1 — per-move explanation):** after each move/goto, once fresh analysis+explorer
  are in hand, calls `POST /coach/explain` with `{fen, lastMoveSan, analysis, explorer}` and exposes
  `coachExplanation`/`coachExplaining`/`coachError`. Debounced (`EXPLAIN_DEBOUNCE_MS = 350`) so
  holding an arrow key only explains the position you land on, and request-id-guarded (`explainReqId`)
  so a slow explanation from an earlier position can't overwrite a newer one. At the root (`san===''`)
  it clears the panel instead of calling the backend.
- **AI coach (Path 2 — freeform chat):** `sendCoachChat(message, history)` wraps `POST /coach/chat`
  (backend reads the live board position from the game store, so only `{message, history}` is sent).
  The `Coach` component owns the chat thread state and passes prior turns as `history`.
- Returns `{ boardState, selectSquare, move, legalMovesFor, gotoNode, navStart, navPrev, navNext, navEnd, reset, busy, analysis, analyzing, explorer, explorerLoading, coachExplanation, coachExplaining, coachError, sendCoachChat }`

### Page layout (page.tsx) — "Opening Study"
Recreated from a Claude-designed hi-fi mock (`design_handoff_opening_study/`, gitignored). One outer
panel (`1432px`, bg `#e4e3df`, radius 16) containing a `TopBar` and a 3-column row, each column `620px`
tall:
```
[OpeningTree 366px] [caption + Board 576px + EvalBar 15px] [MoveHistory + Coach, 388px]
```
`SQUARE_SIZE = 72`, `BOARD_SIZE = 576`.

- `TopBar`, `Board`, `EvalBar`, `MoveHistory`, `OpeningTree`, and `Coach` are all wired to real backend
  state (`useChessGame`). `Coach` shows the live per-move explanation pinned at the top of the message
  area (updating as you move, with a "thinking" indicator during the slow local-model call) and the
  freeform chat thread below it; the composer posts to `/coach/chat`. Both coach paths degrade
  gracefully: a 503 (no local model) shows "Coach is offline…", other failures show a generic error,
  and a hung request aborts after 120s (see `client.ts`) rather than freezing the panel. The coach
  needs the Go backend's coach endpoints + a local LLM (Ollama) running — see backend docs.
- Caption row: `openingName`/`openingEco` come from `explorer.openingName`/`openingEco` (the current
  position's named opening, straight from Lichess — falls back to "Starting Position"/"Custom Line" when
  null). `TopBar`'s "Book move" pill is `explorer.totalGames > 0` (i.e. some rated 2000+ game has reached
  this exact position) rather than real book-deviation tracking, but is a reasonable proxy. The row's
  right side shows `{engineName} · depth {N}` (from `analysis`, hidden when depth is 0) and a **flip
  board** icon button (`flipped` state, passed straight to `Board`).
- `OpeningTree` row click calls `onPlay(uci)` → `move(uci.slice(0,2), uci.slice(2,4))`, playing that
  continuation on the board like a normal move (triggers the same `refreshInsights` refresh).
- Design reference lives in `.design_handoff/design_handoff_opening_study/` (unzipped from the design
  handoff bundle, gitignored) — see its `README.md` for full token/spacing/interaction spec.

## Environment
`NEXT_PUBLIC_API_URL` — backend URL, defaults to `http://localhost:8080`
