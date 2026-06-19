# Backend — Chesslab

Go REST API serving chess game state. No framework beyond chi router.

## Commands

```bash
go run ./cmd/server/   # start server on :8080
go build ./...         # compile check
go test ./...          # run tests
```

## Package layout

```
cmd/server/main.go          # entry point — wires store, handler, router
internal/
  chess/
    types.go        # Color, PieceType, Square, Move, MoveFlag
    position.go     # Position struct (board + castling + EP + clocks), Clone()
    fen.go          # ParseFEN / FEN — full FEN serialisation
    attacks.go      # IsAttacked, InCheck — per-piece attack detection
    movegen.go      # GenerateLegalMoves, generatePseudo, per-piece generators
    game.go         # Game struct, ApplyMove, applyMove, game-over detection
  api/
    handlers.go     # HTTP handlers: CreateGame, GetGame, MakeMove, DeleteGame
    routes.go       # chi router setup + CORS middleware
  storage/
    memory.go       # Store interface + thread-safe in-memory implementation
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/games` | Create new game, returns full game state |
| GET | `/api/games/{id}` | Get current game state |
| POST | `/api/games/{id}/moves` | Make a move |
| DELETE | `/api/games/{id}` | Delete a game |

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
  "pieces": { "e1": { "type": "k", "color": "w" } },
  "legalMoves": [{ "from": "e2", "to": "e4", "flag": "double_push" }],
  "lastMove": { "from": "e2", "to": "e4" },
  "isCheck": false,
  "isCheckmate": false,
  "isStalemate": false,
  "isDraw": false,
  "isGameOver": false,
  "gameOverReason": ""
}
```

## Chess engine design

**Square encoding:** `rank*8 + file` (a1=0, h1=7, a8=56, h8=63)

**Move flags:** `Normal`, `DoublePush`, `EnPassant`, `CastleKS`, `CastleQS`, `PromoQ/R/B/N`

**Legality:** Generate pseudo-legal moves → apply each → check if own king is in check → filter. This handles pins and discovered checks automatically without special-casing.

**Castling checks:** King must not be in check, pass through check, or land in check. Rook path only needs to be empty (not attack-free).

**En passant:** Double pawn push sets `Position.EP` to the skip square. Captured pawn removed from `to.Rank() - dir` (one rank behind EP target).

**Promotion default:** If client sends a pawn move to the back rank without a promotion flag, `ApplyMove` defaults to queen.

**Storage:** In-memory map with `sync.RWMutex`. Swap for a DB by implementing the `storage.Store` interface.
