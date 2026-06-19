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
    layout.tsx        # root layout, sets page title
    page.tsx          # main page — mounts the board
    globals.css       # minimal reset + background colour (#e8e8e6)
  components/
    board/
      Board.tsx       # 8×8 grid, passes rank/file labels into squares
      Square.tsx      # one square: texture sprite + highlights + labels + piece
      Piece.tsx       # renders a piece PNG via next/image
  hooks/
    useChessGame.ts   # all game state; talks to Go backend
  lib/
    api/
      client.ts       # typed fetch wrappers (createGame, makeMove, getGame)
    chess/
      types.ts        # shared TS types: Piece, Square, BoardState
```

## Key conventions

### Board texture sprite
`public/board-texture.png` is the chess.com icy sea board (1600×1600, 8×8 grid of 200px squares).
Each `Square` component uses it as a CSS `background-image` with:
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

### useChessGame hook
- Creates a game on mount (`createGame()`)
- `selectSquare(sq)` handles: deselect, move attempt, piece selection
- Auto-promotes to queen (promotion dialog is a planned TODO)
- Plays `public/sounds/move.mp3` after every successful move
- Returns `{ boardState, selectSquare, reset, busy }`

## Environment
`NEXT_PUBLIC_API_URL` — backend URL, defaults to `http://localhost:8080`
