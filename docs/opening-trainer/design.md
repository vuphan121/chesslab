# Opening Trainer — design

## 1. Goal

Let a user drill an opening repertoire until they can play it from memory, the way Chessbook and
Lotus Chess do it:

1. Before a session, pick which repertoire (and which chapters of it) to study.
2. The app presents positions from that repertoire where it's the user's turn.
3. The user plays a move on a real board.
4. Right → the app tells them, plays the opponent's reply, and continues down the line.
5. Wrong → the app shows the correct move (and any annotation from the study), and that position
   comes back soon and more often.
6. Ordering: correct material goes to the back of the queue; failed material gets promoted; a
   deliberate amount of randomness prevents the session from becoming a fixed script.

Everything the user drills comes from a **Lichess study PGN**, not from hand-written data. The demo
repertoire is <https://lichess.org/study/pYmWdR27>.

## 2. Vocabulary

These terms are used consistently across all the trainer docs and should be used in code too.

| Term | Meaning |
|---|---|
| **Repertoire** | One parsed study. Has an id, a name, a **trainer side** (`w`/`b`), and 1..n chapters. |
| **Chapter** | One PGN game inside the study. Has its own start FEN (often not the initial position) and its own move tree. |
| **Line** | One root-to-leaf path through a chapter's tree. A chapter with variations yields many lines. |
| **Node** | A position in a chapter tree, reached by one move from its parent. Carries SAN, FEN, comment, NAGs. |
| **Card** | The unit of scheduling: **one position where it is the trainer side's turn**, plus the set of moves accepted there. Keyed by FEN, so the same position appearing in two chapters is *one* card. |
| **Answer** | An accepted move for a card. A card has a *primary* answer (the mainline continuation) and zero or more *alternates*. |
| **Run** | One continuous stretch of play: start at a card's position, answer, opponent replies, answer the next card, … until the line ends or the user errs. The presentation unit. |
| **Step** | The session's logical clock. Increments by 1 every time a card is graded. The scheduler works in steps, not wall-clock time. |
| **Session** | One sitting: a selected card set, a queue, a step counter, and per-card state. |

## 3. Where the logic lives

Following the repo's existing rule — *"chess logic lives entirely in Go; the frontend has no chess
logic"* — the split is:

**Go backend** owns everything that requires understanding chess:
- Parsing study PGN into chapter trees (nested variations, comments, NAGs, custom start FEN).
- Replaying SAN into positions, producing the FEN of every node.
- Extracting cards, deduping them by FEN.
- Serving legal moves and applying the user's attempted move (via the existing game endpoints).

**Frontend** owns everything that is scheduling and presentation:
- The scheduler (pure TypeScript, seeded RNG, unit-testable with no network).
- Session state, run chaining, feedback, progress, summary.
- Persistence of per-card memory in `localStorage`.

The scheduler is deliberately *not* on the backend. It has no chess content — it's arithmetic over
card ids — and keeping it client-side means no server session state, instant feedback, and trivial
tests. If multi-device sync is ever wanted, the same algorithm moves server-side unchanged; the
persistence schema in `data-format.md` §6 is already shaped for that.

## 4. Card extraction

Given a repertoire whose trainer side is `S`:

1. Parse each chapter into a tree rooted at its `[FEN]` header (or the initial position if there's
   no `[FEN]`/`[SetUp]` tag).
2. Walk every node in every chapter. For each node **where the side to move is `S`** and which
   **has at least one child**, emit a card:
   - `id` = the node's FEN with the halfmove and fullmove counters stripped (see §4.1).
   - `answers` = the node's children, in PGN order. `answers[0]` (the mainline continuation) is the
     **primary**; the rest are **alternates**.
   - each answer carries its SAN, UCI, resulting FEN, comment, and NAGs.
3. Merge cards with the same `id` across chapters: union the answers (dedupe by SAN), keep the
   first-seen primary, and record every chapter/line the card belongs to.
4. A node where it's `S`'s turn but which has **no** children is a line end — no card.
5. Nodes where it's the opponent's turn are not cards; their children are the **reply pool** used
   when the trainer plays the opponent's move (§6).

### 4.1 Card identity

Card id = FEN with fields 5 and 6 (halfmove clock, fullmove number) dropped:

```
rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq -
```

Dropping the clocks is what makes cross-chapter and transpositional merging work — two chapters that
reach the same position with different move counts must be one card. The en-passant field is
**kept**, because it genuinely changes the legal moves.

### 4.2 Which moves count as correct

**All of a card's recorded answers count as correct**, primary and alternates alike. Playing an
alternate is graded correct and the run continues down *that* branch.

This is the right default: a study author who records `2. e3 (2. Nc3 …)` with the comment *"Nc3 is
also an idea"* has two moves in their repertoire and should be credited for either. Marking only the
mainline correct would fail the user for playing their own repertoire.

But some variations exist to show what **not** to do. Chapter 1 of the demo study opens
`1. O-O (1. a4 Nc6)` with the comment *"a4 is not a great move. Nc6 after and b4 square is weak."*
Accepting `a4` there would be wrong. Two mechanisms handle this, both explicit — never inferred from
comment prose:

1. **NAGs.** A move annotated `$2` (`?`), `$4` (`??`), `$6` (`?!`) is excluded automatically.
2. **Sidecar config.** A `<repertoire>.config.json` next to the PGN can list moves to exclude by
   `{chapter, path}`. The demo repertoire uses this to exclude `1. a4` in chapter 1.

An excluded move is still parsed and its subtree is still walked (its positions can still be *shown*
as "here's what happens if you go wrong"), but:
- it is not an accepted answer at its parent card,
- and its subtree produces **no cards** — you can't be drilled on a line you're being told not to
  play.

If the user plays an excluded move during a drill, they get a distinct third outcome (§7.3):
*"That's in the study, but marked as not part of the repertoire"* — graded as incorrect, with the
annotation shown.

## 5. Session setup

Before the drill starts (§ui-spec 4.1):

| Choice | Default | Notes |
|---|---|---|
| Repertoire | first available | Card list is per-repertoire. |
| Chapters | all | Multi-select. Deselecting a chapter removes cards that appear *only* in it. |
| Session length | 40 steps | "Until everything is retired" is also an option. |
| New cards per session | 8 | Caps how much unseen material is introduced at once. |
| Mode | `mixed` | `mixed` = new + review; `review-only` = no new cards; `mistakes` = only cards with `lapses > 0`. |
| Show line intro | off | If on, the moves leading to the card's position are animated before the prompt. |

The selected card set + these options are frozen for the session.

## 6. Runs and opponent replies

A session is a sequence of **runs**, not isolated one-move quizzes. This is what makes it feel like
studying a repertoire rather than flashcards.

```
pick card C from the queue     (scheduler.md §3)
set the board to C's position
loop:
  prompt the user
  grade the answer                       -> updates C's state, step += 1
  if incorrect: end the run
  play the answer on the board
  if the resulting node has children:
      pick an opponent reply from the pool, play it
      if the position after the reply is a card in the session set:
          C = that card; continue loop
  end the run
```

So a correct answer flows straight into the next question in the same line, and one wrong answer
ends the run and returns to the queue. Cards consumed inside a run are graded individually and
rescheduled individually — the queue is still per-card, the run is only presentation.

**A card reached inside a run is graded even though the scheduler didn't pick it.** That's
intentional: you just demonstrated it, so it should be rescheduled. Its `dueStep` is recomputed by
the same rules.

### Opponent reply selection

From the reply pool (all recorded children of the opponent-to-move node, merged across chapters):

```
weight(reply) = 1 + WEAKNESS_W * (total lapses on cards inside reply's subtree)
```

with `WEAKNESS_W = 0.75`, then weighted-random. The effect: the trainer steers you toward the
branches you keep getting wrong, while still showing you everything. Set `WEAKNESS_W = 0` for
uniform random.

**Worked example from the demo study.** Both chapters begin `1. O-O`. Chapter 1 continues `1... b5`,
chapter 2 continues `1... Nc6`. After the user correctly plays `O-O`, the position after `O-O` has a
merged reply pool of `{b5, Nc6}` — so the same card can lead into either chapter's line, chosen at
random. This falls out of FEN-keyed merging with no special casing, and is exactly the behaviour you
want.

## 7. Grading a move

The user's move is played through the **existing** game endpoints, so legality, SAN generation,
castling, and en passant are all the Go engine's job as usual. The frontend compares the SAN the
backend reports for the new node against the card's answers.

### 7.1 SAN comparison

Normalise both sides before comparing: trim whitespace, strip trailing `+ # ! ?`, map `0-0`/`0-0-0`
to `O-O`/`O-O-O`. This is exactly what `chess.normalizeSANToken` already does in
`backend/internal/chess/pgn.go` — the frontend needs a small equivalent, or (preferred) the backend
returns already-canonical SAN and the frontend only strips check/mate suffixes.

### 7.2 Outcomes

| The played move | Outcome | Grade |
|---|---|---|
| equals the primary answer | **Correct** | correct |
| equals an alternate answer | **Correct (alternate)** | correct — run continues down that branch |
| equals an excluded move | **Not in repertoire** | incorrect |
| is legal but unrecorded | **Incorrect** | incorrect |
| is illegal | not possible — the board won't allow it | — |

### 7.3 After an incorrect answer

**Superseded by explicit user instruction — see the note at the end of this section.** The
implementation is: undo the move (`POST /position` back to the card's own FEN — not `goto`, see
§10's note on why the trainer doesn't use the tree/goto model at all), show the expected SAN as a
board-arrow hint (`bestMove` prop, reused from the analysis page's engine-line arrow) plus the
answer's comment if the study has one, and **re-prompt the same position** — the run does not
advance until the user plays a recognized answer. Grading happens once per presentation (the first
wrong attempt), not on every retry; a card the user needed three tries on this time still shows
`lapses += 1`, not `+= 3`.

*(Original decision, kept for context on what changed: "no retry-until-right loop — a second attempt
on a position you just saw the answer to teaches nothing and pollutes the statistics." A later
session's build instructions explicitly asked for undo-show-retry instead — "if i make the wrong
move then undo my move, show the correct move and make me make my move again" — which is what's
built. The run-level consequence in §6/§12 below is new too: a run with any mistake, even one
corrected via retry, must be replayed in full before moving on.)

## 8. Scheduling

Full specification in [scheduler.md](scheduler.md). In brief:

- Each card has a Leitner-style `box` (0–5) with a base gap of `[2, 4, 8, 16, 32, 64]` steps.
- Correct → `box + 1`, reschedule `step + gap` — a high box's gap exceeds a typical session length,
  which *is* "goes to the back of the queue".
- Wrong → `box - 2` (floored at 0), `lapses + 1`, reschedule `step + 2`.
- The gap is additionally scaled by `0.8 ^ lapses`, so a card you've failed before keeps coming back
  sooner **forever**, not just on the next repetition. This is the "get it wrong → see it more
  often" requirement, made durable.
- Randomness: (a) every gap is jittered ±35%; (b) when several cards are due, the next one is picked
  weighted-random from the four most-overdue rather than strictly first; (c) opponent replies are
  weighted-random (§6).
- A card retires from the session at box 5 with a streak of 2.

## 9. Persistence

`localStorage`, one entry per repertoire, schema in [data-format.md](data-format.md) §6. Stores
`box`, `lapses`, `seen`, `correct`, `lastSeenISO` per card id.

At session start, stored state is loaded and **time-decayed**: if the days since `lastSeenISO`
exceed the card's box number, demote the box by 1. This is a deliberately crude stand-in for real
inter-session spaced repetition — enough that a repertoire you haven't touched in a month comes back
to you, without building an SM-2 implementation. `dueStep` is session-local and always recomputed at
session start from the (decayed) box.

Card ids are FENs, so state survives re-importing or editing the study: unchanged positions keep
their history, changed ones simply appear as new cards.

## 10. Interaction with the existing app

**Reused as-is:** `Board` (drag/drop, click-to-move, annotations, flip), the piece/texture assets,
`POST /api/games/{id}/moves`, `POST /api/games/{id}/goto`, and the whole visual language.

**Modified:** `POST /api/games` accepts an optional start FEN; a new
`POST /api/games/{id}/position` re-points an existing game at an arbitrary FEN (so one game object
serves the whole session instead of creating dozens). `TopBar` gains the page dropdown and its
game-specific props become optional.

**Deliberately not reused:** `useChessGame`. It fires analysis, explorer, and coach refreshes after
every move. In a drill, the eval bar and the explorer would both **give away the answer**, and the
coach calls are slow. The trainer gets its own thin `useTrainerSession` hook that talks to the same
game endpoints and nothing else.

**No eval bar, no engine readout, no opening tree on the trainer page.** Not an oversight — showing
an engine evaluation next to "what's your move here?" is showing the answer.

## 11. Non-goals for v1

- Repertoire *editing* in-app. Repertoires come from a study PGN; edit it on Lichess and re-import.
- Server-side user accounts or cross-device sync. `localStorage` only.
- Live Lichess study import by URL at runtime (endpoint is sketched in `api.md` as a stretch; v1
  ships the PGN checked into the repo).
- Underpromotion answers. The board auto-promotes to queen (existing app-wide limitation), so a
  repertoire whose correct move is `=N` can't be answered. Not present in the demo study; the parser
  should *warn* at load time if it finds one.
- Coach integration. An "Explain this move" button wiring the card into `POST /coach/explain` is an
  obvious follow-up and is listed as a stretch task, not v1.
- Timed / blitz drilling modes.

## 12. Open decisions, and what was decided

| Question | Decision | Why |
|---|---|---|
| Card = position, or card = whole line? | Position, with runs for presentation | Per-position scheduling is what makes "this one square you always forget" surface; runs keep the line feel. |
| Are sibling variations on your own side correct? | Yes, unless NAG- or config-excluded | A study's alternates are part of the repertoire; the bad ones are marked explicitly, never guessed from prose. |
| Scheduler on server or client? | Client, pure, seeded RNG | No chess content, no server state, trivially testable. |
| Wall-clock or step-based scheduling? | Steps within a session; crude day-decay between sessions | An intra-session queue is what the requirement describes; full SM-2 is out of scope. |
| Retry after a wrong answer? | **Yes** — undo, show the correct move, re-prompt the same position until answered correctly (changed from the original "no retry" decision above, per explicit build instruction) | User asked for this flow directly; a single miss still only counts once toward `lapses`. |
| What happens when a run ends imperfectly? | The run **must be redone in full** ("Do it again") before "Next line" is offered; "Analyze" is available either way | Explicit build instruction: "in a line, if i make one wrong move, then when i finish that line, make me do it again." |
| Drill from the line's start each time? | No — start at the card's position | Replaying 8 moves before every question is slow. The line so far is shown in the left panel, and can optionally be animated. |
| Show the engine eval during a drill? | No | It's the answer. |
| How to "analyze" a drilled line? | Hand off to the existing Analysis Board: build a fresh game at the run's start FEN, replay the run's actual moves, navigate to `/?gameId=<id>` | Reuses the whole existing analysis stack (eval bar, coach, explorer) instead of building a second one; `useChessGame` gained an optional `initialGameId` to adopt a game instead of always creating one. |
