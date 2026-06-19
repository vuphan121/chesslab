# Chesslab

AI-powered chess opening prep tool. The goal is to help users learn and drill opening repertoires with an interactive board and eventually AI guidance.

## Monorepo structure

```
chesslab/
  frontend/   # Next.js app (React, TypeScript, Tailwind)
  backend/    # Go REST API (chess engine + game state)
```

## How to run

**Backend** (port 8080):
```bash
cd backend
go run ./cmd/server/
```

**Frontend** (port 3000):
```bash
cd frontend
npm run dev
```

Both must be running together. Frontend talks to backend at `http://localhost:8080`.

## What's built

### Chess board UI
- Custom board using chess.com icy sea board texture as a CSS sprite
- Chess.com piece set (PNG, stored in `frontend/public/pieces/`)
- Rank/file coordinates rendered inside squares (top-left and bottom-right)
- Highlights: selected square, legal move dots, last move, check (red radial)
- Move sound plays on every move (`frontend/public/sounds/move.mp3`)
- Board supports `flipped` and `squareSize` props

### Chess engine (Go backend)
- Full rules: all piece moves, castling (both sides), en passant, promotion (Q/R/B/N)
- Check, checkmate, stalemate, 50-move rule, insufficient material detection
- Legality via apply-then-check-king approach (handles pins, discovered check automatically)
- FEN parsing and generation
- REST API — see `backend/CLAUDE.md` for endpoints

### Frontend → Backend integration
- On mount, `useChessGame` creates a new game via `POST /api/games`
- Clicks go through `selectSquare` → validated move → `POST /api/games/{id}/moves`
- All game state (pieces, legal moves, turn, check, etc.) comes from the backend response

## What's next (planned)
- Opening tree: store and display known opening lines
- Repertoire builder: let user mark moves as their chosen responses
- AI suggestions: highlight book moves, flag deviations
- Promotion dialog (currently auto-promotes to queen)
- Board flip button
- Move history panel

## Tech decisions
- FEN is the universal position identifier across frontend and backend
- Chess logic lives entirely in Go — frontend has no chess logic
- Board texture is used as a CSS sprite (`background-position`) for pixel-perfect squares
