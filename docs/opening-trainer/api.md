# Opening Trainer — backend API

Three new endpoints, two modifications to existing ones. Everything else the trainer needs
(`/moves`, `/goto`) already exists and is used unchanged.

## 1. New endpoints

### `GET /api/repertoires`

List what's loaded. Cheap — no trees, no cards.

```json
[
  {
    "id": "catalan-white",
    "name": "Catalan",
    "side": "w",
    "source": "https://lichess.org/study/pYmWdR27",
    "description": "White repertoire against the Open Catalan.",
    "chapters": [
      { "id": "ch1", "name": "Open, a6 b5", "cardCount": 16 },
      { "id": "ch2", "name": "Open, a6 Nc6", "cardCount": 21 },
      { "id": "ch3", "name": "Open, Nc6", "cardCount": 24 }
    ],
    "cardCount": 60
  }
]
```

`chapters[].cardCount` counts cards *appearing in* that chapter, so the per-chapter figures sum to
more than `cardCount` when chapters share positions. Chapters 1–2 share their root (16 + 21 + 24 =
61 vs 60 unique); chapter 3 starts from an unrelated position and shares nothing with the other two.
The UI should label them "positions in this chapter", not present them as a partition.

Returns `200` with `[]` if no repertoires loaded — never 503. An empty list is a legitimate state
and the picker has a copy for it.

### `GET /api/repertoires/{id}`

The full repertoire: chapters with their trees, the derived cards, and the reply pools. Exact shape
in [data-format.md](data-format.md) §4.

- `200` with the repertoire.
- `404` if unknown id.

Response is large-ish (the demo is ~60 KB of JSON) but static for the process lifetime — serve it
with a strong `ETag` computed once at load, and the client can cache it in memory for the session.

### `POST /api/games/{id}/position`

Re-point an existing game at an arbitrary FEN, discarding its tree. This is how one game object
serves a whole drill session instead of creating a game per card.

```json
// request
{ "fen": "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1" }
// response: the standard game-state object (same shape as POST /api/games)
```

Implemented as `Game.ResetTo(fen)` — the FEN variant of the existing `Game.Reset()`, with the same
contract: **a brand-new root with an empty `Children` slice**, counter reset to 0, `Current` = root.
Same bug class the PGN-paste handler hit: moving the cursor without clearing children leaves the old
tree hanging off the root and the next move silently becomes a sideline.

- `200` with game state.
- `400` on an unparseable FEN (`chess.ParseFEN` error, message passed through).
- `404` if the game id is unknown.

### `POST /api/repertoires/import` — **stretch, not v1**

```json
{ "pgn": "..." }              // or
{ "studyId": "pYmWdR27" }     // server fetches https://lichess.org/api/study/{id}.pgn
```

Parses and registers a repertoire in memory under a generated id. Not persisted; gone on restart.
Ship v1 with the checked-in PGN only — this endpoint means dealing with unbounded PGN input,
outbound fetch failures, and a repertoire lifetime story, none of which the feature needs to be
useful.

## 2. Modified endpoints

### `POST /api/games` — optional start FEN

Currently takes no body. Make the body optional:

```json
{ "fen": "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1" }
```

Empty body or absent/empty `fen` → the initial position, exactly as today. **The existing analysis
page must be byte-for-byte unaffected**; it sends no body and must keep working with none.

Backed by `chess.NewGameFromFEN(id, fen)`; `chess.NewGame(id)` stays as a wrapper over it with
`StartFEN` so no existing call site changes.

- `201` with game state.
- `400` on an unparseable FEN.

### `TopBar` props — frontend, listed here because it's shared

`turn` and `isBookMove` become optional so the trainer page can render the same bar with its own
right-hand pills. No backend change.

## 3. What the trainer calls, in order

```
GET  /api/repertoires                       once, on the setup screen
GET  /api/repertoires/{id}                  once, when a repertoire is selected
POST /api/games            {fen: card.fen}  once, when the session starts
POST /api/games/{id}/position {fen}         at the start of every run, and to undo a wrong answer
POST /api/games/{id}/moves {from,to}        every time the user moves
POST /api/games/{id}/moves {from,to}        to play the opponent's reply
POST /api/games            {fen}            to build a fresh game for "Analyze this line"
DELETE /api/games/{id}                      on session end / unmount
```

The undo-after-a-wrong-answer step turned out to use `/position` (not `/goto`) — the trainer never
keeps a real multi-ply move-tree in the backend game object at all (see `useTrainerSession`'s note on
why: a wrong-answer undo needs to discard back to a bare root, which `/goto` doesn't do, so every ply
within a run goes through `/position` immediately before the single move that advances it).

Explicitly **not** called: `/analysis`, `/eval`, `/explorer`, `/coach/*`. The first three would show
the user the answer; the coach is slow and isn't part of v1. `useChessGame` calls all of them after
every move, which is why the trainer needs its own hook rather than reusing it (see
[design.md](design.md) §10).

## 4. Go package layout

```
backend/internal/repertoire/
  types.go       # Repertoire, Chapter, Node, Card, Answer, Reply
  pgn.go         # ParsePGN(text) ([]Chapter, error) — multi-game, variations, comments, NAGs, [FEN]
  pgn_test.go    # parses the demo PGN; asserts structure (see data-format.md §2.3)
  build.go       # BuildRepertoire(chapters, cfg) (*Repertoire, error) — cards, replies, exclusions
  build_test.go  # asserts the 60-card expectation
  config.go      # sidecar config load + exclusion resolution
  load.go        # LoadDir(dir) ([]*Repertoire, error)
  store.go       # in-memory registry (id -> *Repertoire), mirrors storage.Memory's shape

backend/internal/api/
  repertoire_handler.go   # ListRepertoires, GetRepertoire
  handlers.go             # CreateGame gains optional fen; new SetPosition handler
  routes.go               # register the three routes
```

`repertoire` imports `chess` and nothing else from the project — it is pure parsing and derivation,
no engine, no network. That keeps `pgn_test.go`/`build_test.go` fast and hermetic, which matters
because they're the tests that actually guard this feature's correctness.

Wiring in `cmd/server/main.go`: load the directory at startup, log the count and any parse failures,
pass the store to `api.NewHandler`. A repertoire that fails to parse is skipped with a loud log, not
fatal — same policy as the coach corpora.
