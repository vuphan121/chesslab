# Opening Trainer — documentation index

Spaced-repetition drilling of an opening repertoire, in the style of
[Chessbook](https://chessbook.com) / [Lotus Chess](https://lotuschess.com), alongside Chesslab's
analysis and book-study workspaces.

> **Status: implemented.** The documents retain the design rationale, while `ui-spec.md` describes
> the current shipped interface. Historical build instructions remain in `build-plan.md`.

## The one-paragraph version

The user picks a repertoire and any subset of its chapters, then plays each line from memory on a
real board. Wrong answers are corrected and retried; completed runs can be analyzed, repeated, or
followed by another randomly selected line. Progress is synchronized through the backend, and mixed
training combines due work from multiple repertoires.

## Documents

| Doc | What's in it |
|---|---|
| [design.md](design.md) | Concepts, data model, the decisions and their rationale, edge cases, non-goals |
| [scheduler.md](scheduler.md) | The scheduling algorithm in full — constants, pseudocode, worked trace, tuning notes |
| [data-format.md](data-format.md) | PGN/study parsing spec, the demo study verbatim, card-extraction rules, sidecar config, persistence schema |
| [api.md](api.md) | Backend endpoint contracts (new + modified) |
| [ui-spec.md](ui-spec.md) | Current setup, drilling, responsive layout, and interaction behavior |
| [build-plan.md](build-plan.md) | **Instructions for the agent(s) doing the build** — phased tasks, file manifest, acceptance criteria, test list |
| [../changes-2026-09-23.md](../changes-2026-09-23.md) | Latest UI redesign and reliability work |

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

Lichess study <https://lichess.org/study/pYmWdR27> — "Catalan", 6 chapters, a **White** repertoire
covering open and closed Catalan systems.
Fetched via `https://lichess.org/api/study/pYmWdR27.pgn` and checked into the repo. Full text and
its exact expected parse are in [data-format.md](data-format.md).
