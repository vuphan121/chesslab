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
    game.go         # Game = move tree (Node root/current), ApplyMove, GotoNode, applyMove, game-over detection
    notation.go     # SAN(), MovesToSAN(), MovesToSANAndFENs()
  engine/
    stockfish.go    # Engine struct: spawns Stockfish subprocess, UCI protocol, Analyze()
  lichess/
    client.go       # Fetch() — cloud-eval (public, no auth) used as first choice in AnalyzeGame
    explorer.go     # FetchExplorer() — opening-explorer (requires LICHESS_TOKEN bearer auth)
  api/
    handlers.go     # HTTP handlers: CreateGame, GetGame, MakeMove, DeleteGame, AnalyzeGame, Explorer, GotoNode
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
| GET | `/api/games/{id}/analysis` | Run Stockfish analysis on current position |
| GET | `/api/games/{id}/explorer` | Lichess opening-explorer stats for current position |
| POST | `/api/games/{id}/goto` | Navigate to a move-tree node by id (`{ "nodeId": "3" }`) — does not discard moves |

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

## Chess engine design

**Square encoding:** `rank*8 + file` (a1=0, h1=7, a8=56, h8=63)

**Move flags:** `Normal`, `DoublePush`, `EnPassant`, `CastleKS`, `CastleQS`, `PromoQ/R/B/N`

**Legality:** Generate pseudo-legal moves → apply each → check if own king is in check → filter. This handles pins and discovered checks automatically without special-casing.

**Castling checks:** King must not be in check, pass through check, or land in check. Rook path only needs to be empty (not attack-free).

**En passant:** Double pawn push sets `Position.EP` to the skip square. Captured pawn removed from `to.Rank() - dir` (one rank behind EP target).

**Promotion default:** If client sends a pawn move to the back rank without a promotion flag, `ApplyMove` defaults to queen.

**Move tree** (`game.go`): a `Game` is a tree of `Node`s, not a linear list. Each node caches the move that reached it, its SAN, and the resulting `*Position`; `Game.Current` is the viewed node (with `Pos`/`LastMove` mirrored for handler convenience). `ApplyMove` from the current node: if the move already exists as a child it just navigates onto it (no duplicate — replaying the mainline is a no-op branch), otherwise it appends a new child. `children[0]` is the main line; playing a *different* move from a node that already has children creates a **sideline** (`children[1:]`). `GotoNode(id)` moves `Current` without discarding anything, so stepping back and exploring never loses the original line. Node ids are per-game sequential strings (`"0"` = root). Reset is client-side (creates a fresh game).

**SAN generation** (`notation.go`): `SAN(pos, move)` handles piece prefix, disambiguation (file/rank/both), capture `x`, promotion `=Q`, and check/checkmate suffix by applying the move and checking the resulting position. `MovesToSANAndFENs` steps through a sequence of UCI moves, returning both SAN strings and the FEN after each move.

**Stockfish integration** (`engine/stockfish.go`): `Engine` struct spawns the process, sends `uci` and waits for `uciok`, then for each `Analyze` call sets `MultiPV`, sends `position fen` + `go depth N`, and reads `info` lines until `bestmove`. A `sync.Mutex` serializes concurrent calls. Score from Stockfish is always from the side-to-move perspective; `AnalyzeGame` handler negates score and mate when it's black's turn.

**Storage:** In-memory map with `sync.RWMutex`. Swap for a DB by implementing the `storage.Store` interface.
