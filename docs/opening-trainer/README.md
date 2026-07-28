# Opening Trainer — documentation index

Spaced-repetition drilling of an opening repertoire, in the style of
[Chessbook](https://chessbook.com) / [Lotus Chess](https://lotuschess.com). A second page in the
Chesslab app, alongside the existing analysis workspace.

> **Status: design only. No code has been written for this feature yet.**
> These documents are the specification. `build-plan.md` is the implementation instruction set.

## The one-paragraph version

The user picks a repertoire (a parsed Lichess study), the app extracts every position in that
repertoire where it is the user's turn, and drills them. Each drill shows a position; the user must
play their repertoire move. Correct answers push the position far back in the session queue; wrong
answers bring it back soon and permanently raise its priority. Randomness is injected at three
points (queue jitter, local pick order, opponent reply choice) so a session is never a memorised
sequence. Progress persists across sessions in the browser.

## Documents

| Doc | What's in it |
|---|---|
| [design.md](design.md) | Concepts, data model, the decisions and their rationale, edge cases, non-goals |
| [scheduler.md](scheduler.md) | The scheduling algorithm in full — constants, pseudocode, worked trace, tuning notes |
| [data-format.md](data-format.md) | PGN/study parsing spec, the demo study verbatim, card-extraction rules, sidecar config, persistence schema |
| [api.md](api.md) | Backend endpoint contracts (new + modified) |
| [ui-spec.md](ui-spec.md) | Page layout, components, every screen state, design tokens, the cross-page nav dropdown |
| [build-plan.md](build-plan.md) | **Instructions for the agent(s) doing the build** — phased tasks, file manifest, acceptance criteria, test list |

Read `design.md` first. `build-plan.md` assumes you've read all the others.

## Naming, and a collision to be aware of

The user asked for the new page at `/opening-study`. The **existing** page (`/`) is called
"Opening Study" throughout the current `CLAUDE.md` files. To avoid two things with the same name:

| Route | User-facing label | What it is | In these docs |
|---|---|---|---|
| `/` | **Analysis Board** | Board + engine + Lichess explorer + AI coach | "the analysis page" |
| `/opening-study` | **Opening Study** | This feature — repertoire drilling | "the trainer page" |

In **code**, this feature is called `trainer` (`components/trainer/`, `lib/trainer/`,
`useTrainerSession`) — short, and it never collides with the word "study" that already means a
Lichess study in this codebase. Part of the build is relabelling `/`'s nav entry to "Analysis
Board" and updating the three `CLAUDE.md` files that call it "Opening Study".

## Demo content

Lichess study <https://lichess.org/study/pYmWdR27> — "Catalan", 3 chapters, a **White** repertoire
against the Open Catalan (two chapters cover `...a6`, a third covers `...Nc6` played directly).
Fetched via `https://lichess.org/api/study/pYmWdR27.pgn` and checked into the repo. Full text and
its exact expected parse are in [data-format.md](data-format.md).
