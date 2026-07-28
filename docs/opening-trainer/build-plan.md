# Opening Trainer — build plan

**Status: built and manually verified end-to-end.** Phases 1–6 below are complete (backend
parsing/API, frontend scheduler/hook/UI); the manual verification script in Phase 7 has been run
against the demo repertoire. Divergences from the original plan, found during implementation:

- **Retry-until-correct + mandatory run-redo** (design.md §7.3/§12) replaced the original
  no-retry/no-redo design, per an explicit later build instruction.
- **`useTrainerSession` derives `boardState` fresh every render** from a raw `GameState` + the
  current `selected` square (`gameState ? toBoardState(gameState, selected) : null`) — an earlier
  version stored `boardState` as its own snapshot (always computed with `selectedSquare = null`),
  which silently broke click-to-move after the first square-select (legal-moves list was always
  empty). Caught by manual browser verification, not `tsc`/lint/build.
- **A real grading bug**, also only caught by manual verification: the played move's SAN was read
  via `gs.moveTree.children[0]`, correct only immediately after a tree reset. Since a run reuses one
  game object across many plies (tree not reset between cards, only at run start / after a wrong
  answer), this read the *wrong* node past the first move of every run — it would have silently
  misgraded correct answers as incorrect. Fixed via `flatten(gs.moveTree).get(gs.currentNodeId)`.
- The opponent-reply weighting (design.md §6) approximates "total lapses in the reply's subtree" as
  just the *immediate next card's* lapse count, not a full subtree walk — a reasonable simplification
  given the demo repertoire's shallow branching, flagged here in case a deeper repertoire needs the
  fuller computation.

The rest of this document is kept as-is (it remains an accurate build guide for the parts that
didn't change, and the phase/file breakdown below is what was actually followed).

**Audience: the agent(s) implementing this feature.** Read [design.md](design.md),
[scheduler.md](scheduler.md), [data-format.md](data-format.md), [api.md](api.md), and
[ui-spec.md](ui-spec.md) first — this document does not restate their contents, it sequences the
work and defines "done".

## 0. Ground rules

1. **Do not regress the analysis page (`/`).** Every backend change here is additive or
   optional-by-default. After each phase, load `/`, make a move, navigate the tree, paste a PGN, and
   ask the coach. If any of those changed behaviour, the change is wrong.
2. **Chess logic in Go, scheduling in TypeScript.** No SAN parsing, no FEN manipulation, no legal-move
   generation in the frontend. No scheduler arithmetic in Go.
3. **Never `Math.random()` in the scheduler.** Injected seeded RNG only, or the determinism tests are
   meaningless.
4. **Follow the surrounding style.** Inline `style={{}}` objects with numeric tokens (this codebase
   does not use Tailwind classes for layout), Go handlers in the shape of the existing ones,
   comments only where the *why* isn't obvious from the code.
5. Update `CLAUDE.md`, `backend/CLAUDE.md`, and `frontend/CLAUDE.md` in the final phase — including
   relabelling `/` as "Analysis Board" where those docs currently call it "Opening Study".
6. Phases 1–2 are independent of phases 4–6 and can be built in parallel; phase 3 is the seam.

---

## Phase 1 — Repertoire parsing (Go)

**Goal:** the demo study parses into the exact card set in `data-format.md` §2.3.

### Files

```
backend/data/repertoires/catalan-white.pgn              (new — fetch verbatim)
backend/data/repertoires/catalan-white.config.json      (new)
backend/internal/repertoire/types.go                    (new)
backend/internal/repertoire/pgn.go                      (new)
backend/internal/repertoire/pgn_test.go                 (new)
backend/internal/repertoire/config.go                   (new)
backend/internal/repertoire/build.go                    (new)
backend/internal/repertoire/build_test.go               (new)
backend/internal/repertoire/load.go                     (new)
backend/internal/repertoire/store.go                    (new)
```

Fetch the PGN with:

```bash
curl -sL https://lichess.org/api/study/pYmWdR27.pgn -o backend/data/repertoires/catalan-white.pgn
```

The sidecar content is given verbatim in `data-format.md` §3.

### Notes for the implementer

- `ParsePGN` is a **new** parser. `chess.TokenizePGNMoves` is single-game and strips variations by
  design; do not try to extend it — the PGN-paste feature depends on that behaviour.
- Reuse `chess.ParseFEN`, `chess.FEN`, `chess.GenerateLegalMoves`, `chess.SAN`,
  `chess.FindLegalMoveBySAN`, and `chess.normalizeSANToken` (export it if needed). The variation
  walk is: keep a stack of positions; `(` pushes the position *before* the previous move, `)` pops.
- Store the **engine's** canonical SAN on each node, not the file's token, so comparison later is
  against something the engine will reproduce.
- Card id = FEN with fields 5 and 6 stripped (`data-format.md` §4.1). Put that in one helper
  (`cardKey(fen string) string`) and use it everywhere — cards and reply pools both.
- Exclusion resolution happens in `build.go`, after the tree exists: mark nodes from NAGs and from
  the sidecar `path`, then prune cards from excluded subtrees. An unresolvable sidecar `path` is a
  returned error.
- `LoadDir` globs `*.pgn`, pairs each with `<base>.config.json` if present, and returns what
  parsed. Log failures loudly; do not make them fatal.

### Acceptance

- `go build ./...` and `go test ./...` pass.
- `pgn_test.go`: 3 chapters; chapters 1–2's roots equal the Catalan-`...a6` FEN, chapter 3's root
  equals the distinct Catalan-`...Nc6` FEN; chapter 1's tree has the `1. a4` sibling under the root;
  the chapter-1 intro comment is attached to the chapter root, not to a move; chapter 2 contains a
  depth-3 nested variation (`2... Rb8 … (3... Qd7 …)`); chapter 3's root move has 5 children (the
  mainline reply + 4 opponent alternates); every SAN in the file replays legally (zero parse errors).
- `build_test.go`: **exactly 60 cards**; the root card lists both of chapters 1–2's ids (not
  chapter 3, which shares nothing with them); the card after `O-O Nc6` has exactly two answers (`e3`
  primary, `Nc3` alternate); **no card exists anywhere in the `1. a4` subtree**; the reply pool for
  the position after `O-O` contains exactly `{b5, Nc6}`; chapter 3 needs no sidecar exclusions.
- If your parser produces a different card count, re-derive by hand before changing the test — the
  33 in `data-format.md` §2.3 is enumerated position by position and should be treated as correct
  until proven otherwise. If it *is* wrong, fix the doc in the same commit and say why.

---

## Phase 2 — Backend API

**Goal:** the trainer's data and position-setting are reachable over HTTP.

### Files

```
backend/internal/chess/game.go              (modify — NewGameFromFEN, ResetTo)
backend/internal/chess/game_test.go         (modify — ResetTo clears Children)
backend/internal/api/handlers.go            (modify — CreateGame optional fen; SetPosition)
backend/internal/api/repertoire_handler.go  (new)
backend/internal/api/routes.go              (modify)
backend/cmd/server/main.go                  (modify — LoadDir at startup)
```

### Notes

- `NewGameFromFEN(id, fen)` returns an error on a bad FEN; `NewGame(id)` becomes a thin wrapper over
  it with `StartFEN` and keeps its current signature so no existing call site changes.
- `ResetTo(fen)` must build a **fresh root node with an empty `Children` slice** and reset the id
  counter — the exact contract `Reset()` documents. Re-read the comment on `Reset()` in
  `game.go`: pointing `Current` at the root without clearing children is the bug that made a
  diverging PGN paste become a sideline. `ResetTo` will be called dozens of times per session, so
  getting this wrong leaks the previous card's moves into the next one.
- `CreateGame` must still accept a completely absent body. Decode into a struct with a pointer or
  check `r.ContentLength == 0`; an `io.EOF` from the decoder is not an error here.
- Serve `GET /api/repertoires/{id}` with a stable `ETag` computed once at load.

### Acceptance

- `POST /api/games` with no body behaves exactly as before (verify the analysis page still boots).
- `POST /api/games` with `{"fen": "<catalan fen>"}` returns a game whose `fen` matches and whose
  `moveTree` is a bare root.
- `POST /api/games/{id}/position` twice in a row with different FENs leaves `moveTree.children`
  empty both times.
- `GET /api/repertoires` returns the demo entry with `cardCount: 33`.
- Bad FEN → 400 with a useful message; unknown repertoire id → 404.

---

## Phase 3 — Frontend API client + types

### Files

```
frontend/src/lib/api/client.ts        (modify)
frontend/src/lib/trainer/types.ts     (new)
```

Add `listRepertoires()`, `getRepertoire(id)`, `createGame(fen?)`, `setPosition(gameId, fen)` with
types mirroring `api.md` exactly. `types.ts` holds `Repertoire`, `Chapter`, `RepNode`, `Card`,
`Answer`, `Reply`, `CardState`, `SessionState`, `SessionOptions`, `GradeEvent`, `RunState`.

### Acceptance

`npx tsc --noEmit` clean. No `any` in the new types.

---

## Phase 4 — Scheduler (pure TypeScript)

**Goal:** the algorithm, fully tested, with zero React and zero network.

### Files

```
frontend/src/lib/trainer/rng.ts            (new — mulberry32 + weightedChoice + uniform)
frontend/src/lib/trainer/scheduler.ts      (new)
frontend/src/lib/trainer/scheduler.test.ts (new)
frontend/src/lib/trainer/persistence.ts    (new)
```

Implement exactly `scheduler.md` §3–§8. Public surface:

```ts
createSession(cards: Card[], opts: SessionOptions, saved: SavedState, rng): SessionState
pickNext(s: SessionState): CardState | null
grade(s: SessionState, cardId: string, correct: boolean): void
isComplete(s: SessionState): boolean
summarise(s: SessionState): SessionSummary
```

Mutating a draft `SessionState` in place is fine — it lives in a `useRef`, not in React state (see
phase 5).

### Acceptance

All ten tests in `scheduler.md` §9 pass. If the repo has no test runner yet, add `vitest` — this is
the one part of the feature whose correctness is not visible by looking at the screen, so it does
not ship untested.

---

## Phase 5 — Session hook

### Files

```
frontend/src/hooks/useTrainerSession.ts   (new)
```

Owns: the loaded repertoire, the `SessionState` (in a `useRef`, with a `version` counter in state to
trigger renders — the session object is large and mutated per grade), the backing game id, the
current run, and the feedback state.

Exposes roughly:

```ts
{ phase, boardState, prompt, feedback, progress, lineSoFar,
  start(opts), submitMove(from, to), advance(), endSession(),
  flipped, toggleFlipped, summary }
```

Flow per `design.md` §6–§7:

1. `start` → `createGame(firstCard.fen)`, seed the scheduler from `localStorage`.
2. Begin a run → `setPosition(gameId, card.fen)`.
3. `submitMove` → `POST /moves` → read the new node's SAN → normalise → compare to
   `answers` / `excludedAnswers` → `grade()` → set feedback.
4. Correct → play the opponent reply (weighted per `design.md` §6) via another `POST /moves`; if the
   resulting card key is in the session set, continue the run; else end it.
5. Incorrect → `POST /goto` the parent node, animate the correct move, end the run.
6. Between runs, check `isComplete` → `summary`.

### Gotchas

- **Do not reuse `useChessGame`.** It fires analysis/explorer/coach on every move; those leak the
  answer and are slow. This hook talks to `/moves`, `/goto`, `/position` and nothing else.
- Guard every network round trip with a request id, the way `useChessGame` guards `askCoach` — a
  late response from the previous run must not grade the current card.
- Grade only on a **successful** move response. A failed request shows an error and changes nothing.
- Move sound: reuse `public/sounds/move.mp3` on the user's move and the opponent's reply, matching
  the rest of the app.

### Acceptance

Drive it manually: a correct answer chains into the next card in the same line; a wrong answer
rewinds, shows the correct move, and ends the run; the same position never appears twice in a row;
reloading the page and starting a new session preserves box/lapse state.

---

## Phase 6 — UI

### Files

```
frontend/src/app/opening-study/page.tsx           (new)
frontend/src/components/layout/PageSwitcher.tsx   (new)
frontend/src/components/layout/TopBar.tsx         (modify — optional props + PageSwitcher)
frontend/src/components/trainer/RepertoirePicker.tsx  (new)
frontend/src/components/trainer/TrainerBoard.tsx      (new)
frontend/src/components/trainer/LinePanel.tsx         (new)
frontend/src/components/trainer/SessionPanel.tsx      (new)
frontend/src/components/trainer/FeedbackStrip.tsx     (new)
frontend/src/components/trainer/SessionSummary.tsx    (new)
frontend/src/app/page.tsx                             (modify — TopBar props only)
```

Build to `ui-spec.md`. Reuse `Board` unchanged. Reuse `MoveHistory`'s `toFigurine` — extract it to
`lib/chess/figurine.ts` and import it from both rather than copying it.

### Acceptance

- The page dropdown appears on both pages, marks the current one, and navigates both ways.
- `/` is visually identical to before (compare screenshots).
- No eval bar, engine readout, opening tree, or coach panel anywhere on `/opening-study`.
- Every state in `ui-spec.md` §5 is reachable and handled.
- `npm run build` clean.

---

## Phase 7 — Verification and docs

### Manual verification script

Run the backend and frontend, then, in the browser preview:

1. `/` — make a move, navigate, paste a PGN, ask the coach. **All unchanged.**
2. Switch to `/opening-study` via the dropdown. Picker lists the Catalan repertoire, 33 positions.
3. Start a session. First prompt is White to move from the Catalan position.
4. Play `O-O` → correct; the opponent replies `b5` **or** `Nc6` (run it several times and confirm
   both occur — this is the cross-chapter merge working).
5. Play a deliberate wrong move → red strip, correct move shown, run ends.
6. Reach the `O-O Nc6` card and play `Nc3` → "also in your repertoire", run continues into chapter
   2's Nc3 branch.
7. Reach the root card and play `a4` → "in the study, but not part of the repertoire", graded wrong.
8. Miss the same card three times and confirm it reappears sooner each time than a clean card at the
   same box (check the "needs work" list ordering).
9. Finish or end the session → summary. Reload → progress persisted → "Drill mistakes" offers the
   missed set.

Screenshot the drilling screen and the summary.

### Docs to update

- `CLAUDE.md` — add an "Opening Trainer page" section under *What's built*, link
  `docs/opening-trainer/`, relabel the existing page "Analysis Board (`/`)", and drop the trainer
  from *What's next*.
- `backend/CLAUDE.md` — the `repertoire` package in the layout tree, the three routes in the REST
  table, and a short "Repertoire parsing" design note covering the custom-start-FEN and
  variation-preservation constraints (both are the opposite of what the PGN-paste path does, and a
  future reader will assume the two share code).
- `frontend/CLAUDE.md` — the new folders, `useTrainerSession` (and **why** it doesn't reuse
  `useChessGame`), `PageSwitcher`, and the trainer page layout.
- These docs — correct anything the build proved wrong, in the same commit that proved it.

---

## Sequencing summary

| Phase | Depends on | Parallelisable with |
|---|---|---|
| 1 Parsing | — | 4 |
| 2 API | 1 | 4 |
| 3 Client types | 2 | 4 |
| 4 Scheduler | — | 1, 2, 3 |
| 5 Hook | 3, 4 | 6's static parts |
| 6 UI | 5 | — |
| 7 Verify + docs | all | — |

## Stretch, explicitly out of v1

Do not build these unless asked. Listed so they aren't designed out accidentally:

- `POST /api/repertoires/import` (paste a PGN / a study id at runtime).
- "Explain this move" on the feedback strip, wired to `POST /coach/explain` with the card's FEN,
  `prevFen`, and the expected SAN.
- Server-side progress storage / accounts.
- Underpromotion answers (blocked by the app-wide auto-queen behaviour; the parser should warn at
  load time if a repertoire contains one).
- FSRS or SM-2 in place of the Leitner ladder.
