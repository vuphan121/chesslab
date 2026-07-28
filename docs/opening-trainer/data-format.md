# Opening Trainer — data formats

Covers: the source PGN and how it must be parsed, the demo repertoire verbatim with its exact
expected parse, the sidecar config, the repertoire JSON the API serves, and the `localStorage`
persistence schema.

## 1. Source: a Lichess study PGN

A study exports as **one PGN file containing one `[Event]`-tagged game per chapter**, via:

```bash
curl -sL https://lichess.org/api/study/pYmWdR27.pgn -o backend/data/repertoires/catalan-white.pgn
```

No auth needed for a public study. The important structural facts:

- **Chapters are separate games** in one file, separated by blank lines. A multi-game PGN reader is
  required — the existing `chess.TokenizePGNMoves` reads a single move list and cannot be reused.
- **Chapters usually start from a custom position** — and different chapters in the same study
  need not share one. All three demo chapters carry `[FEN "..."]` + `[SetUp "1"]`; chapters 1–2
  share one starting position, chapter 3 has a genuinely different one. The parser must root each
  chapter at its own FEN independently. Ignoring these tags produces garbage: every move in the
  file is illegal from the initial position.
- **Variations are nested and are the whole point.** `chess.stripParenVariations` deliberately throws
  them away for the PGN-paste feature. The trainer needs them all, at arbitrary nesting depth.
  Chapter 2 of the demo has depth-3 nesting; chapter 3 has a node with five siblings (one mainline
  reply + four opponent alternates).
- **Comments carry the teaching content** and must be preserved and attached to the correct node.
- **Move numbers can be ambiguous** for Black-first continuations (`2... c6`); the parser must not
  rely on move numbers for structure, only on token order and side-to-move.

### 1.1 Parser requirements

`repertoire.ParsePGN(text string) ([]Chapter, error)` must handle:

| Construct | Handling |
|---|---|
| `[Tag "value"]` pairs | Collected per game into a `map[string]string`. `FEN`, `SetUp`, `Event`, `ChapterName`, `StudyName`, `ChapterURL` are the ones used. |
| Multiple games in one file | Split on the tag-pair block that follows a completed movetext. |
| `[FEN]` + `[SetUp "1"]` | Root position. Absent → `chess.StartFEN`. |
| `{ comment }`, possibly multi-line | Attached to the **preceding** move's node; a comment appearing before the first move attaches to the chapter root (a "line intro"). |
| `; line comment` | Stripped to end of line. |
| `( variation )`, nested | A sibling subtree of the **previous** move, rooted at that move's *parent*. |
| `$N` NAGs | Collected onto the node. `$1 !`, `$2 ?`, `$3 !!`, `$4 ??`, `$5 !?`, `$6 ?!`. |
| Suffix annotations `Nf3!?`, `Bd7+` | Stripped for matching (reuse `chess.normalizeSANToken`); `!`/`?` suffixes are converted to the equivalent NAG. |
| `0-0` / `0-0-0` | Normalised to `O-O` / `O-O-O` (already handled by `normalizeSANToken`). |
| Result tokens `1-0 0-1 1/2-1/2 *` | End of movetext. |
| An illegal/unparseable token | Hard error naming the chapter and the token — a repertoire that silently loses half a line is worse than one that refuses to load. |

Each parsed node stores: `SAN` (canonical, from the engine, not the file), `UCI`, `FEN` after the
move, `Ply` (0 at the chapter root), `Comment`, `NAGs`, `Children`.

## 2. The demo repertoire, verbatim

Save to `backend/data/repertoires/catalan-white.pgn` exactly as fetched (last refreshed 2026-07-27,
when a third chapter was added and chapter 1 gained two extra plies on two existing sidelines):

```
[Event "Catalan: Open, a6 b5"]
[Date "2026.07.25"]
[Result "*"]
[Variant "Standard"]
[ECO "?"]
[Opening "?"]
[StudyName "Catalan"]
[ChapterName "Open, a6 b5"]
[ChapterURL "https://lichess.org/study/pYmWdR27/KXWPZNBT"]
[Annotator "https://lichess.org/@/vuphan121"]
[FEN "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"]
[SetUp "1"]
[UTCDate "2026.07.25"]
[UTCTime "08:37:53"]

{ Black wants to play b5 to keep the pawn.
White's compensation is the center and lead in development. }
1. O-O { a4 is not a great move.
Nc6 after and b4 square is weak. } (1. a4 Nc6) 1... b5 2. Ne5 Nd5 (2... c6 3. b3 cxb3 4. Nxc6 Qb6 5. Na5 Ra7 6. Nxb3) 3. a4 Bb7 4. b3 c3 (4... cxb3 5. axb5 axb5 6. Rxa8 Bxa8 7. Qxb3 { More pleasant for white } 7... Nc6) 5. e4 b4 (5... Nf6 6. Nxc3) 6. exd5 Bxd5 7. Qh5 g6 8. Qh3 *


[Event "Catalan: Open, a6 Nc6"]
[Date "2026.07.25"]
[Result "*"]
[Variant "Standard"]
[ECO "?"]
[Opening "?"]
[StudyName "Catalan"]
[ChapterName "Open, a6 Nc6"]
[ChapterURL "https://lichess.org/study/pYmWdR27/06Q5PTVN"]
[Annotator "https://lichess.org/@/vuphan121"]
[FEN "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"]
[SetUp "1"]
[UTCDate "2026.07.25"]
[UTCTime "09:03:53"]

1. O-O Nc6 2. e3 (2. Nc3 Rb8 3. e4 Be7 4. Qe2 Nxd4 5. Nxd4 Qxd4 6. Rd1 Qc5 7. e5 Nd7 8. Ne4 { Nc3 is also an idea.
An aggresive line but quite difficult to play. }) 2... Bd7 (2... Rb8 3. Nfd2 e5 (3... Qd7 4. Nxc4 b5 5. Ncd2) 4. Bxc6+ bxc6 5. dxe5 Ng4 6. Nxc4 Be6 { Remember Nfd2 after Rb8 and white have a nice position }) 3. Qe2 b5 (3... Bd6 4. Qxc4 O-O 5. Rd1) 4. b3 cxb3 5. axb3 Bd6 6. Bb2 O-O 7. Rc1 Nb4 *


[Event "Catalan: Open, Nc6"]
[Date "2026.07.26"]
[Result "*"]
[Variant "From Position"]
[FEN "r1bqkb1r/ppp2ppp/2n1pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"]
[ECO "?"]
[Opening "?"]
[StudyName "Catalan"]
[ChapterName "Open, Nc6"]
[ChapterURL "https://lichess.org/study/pYmWdR27/yrIJMxCW"]
[Annotator "https://lichess.org/@/vuphan121"]
[FEN "r1bqkb1r/ppp2ppp/2n1pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1"]
[SetUp "1"]
[UTCDate "2026.07.26"]
[UTCTime "08:55:04"]

1. Qa4 Bb4+ (1... Nd5 2. Qxc4 Nb6 3. Qd3) (1... Nd7 2. Qxc4 Nb6 3. Qd3) (1... Bd6 2. Ne5) (1... Bd7 2. Qxc4 Na5 3. Qd3 c5 4. O-O) 2. Bd2 Nd5 (2... Bxd2+ 3. Nbxd2) (2... Bd6 3. Na3 Ne4 (3... Bxa3 4. Qxa3 Nxd4 5. Nxd4 Qxd4 6. Rd1) 4. Nxc4 Nxd2 5. Nfxd2 { Try to prevent d5 to make it harder for black to develop white bishop }) 3. Bxb4 Nxb4 4. O-O Rb8 5. Na3 { Preventing b5 } 5... O-O 6. Qb5 b6 7. Qxc4 Ba6 8. Nb5 Qd5 9. Qxd5 Nxd5 10. a4 *
```

Note the comment placement quirk in chapter 1: the `{ a4 is not a great move… }` comment sits after
`1. O-O` but is *about* the `1. a4` variation that follows it. This is normal Lichess study output
and the parser should not try to be clever about it — attach it to `O-O` as written, and let the
sidecar (§3) carry the machine-readable "a4 is excluded" fact.

Chapter 3 (`[Variant "From Position"]`) carries a **duplicate `[FEN]` tag** — Lichess emits the
custom-position FEN both before and after the standard tag block for this variant type. Harmless:
`splitGames`'s tag map just takes the second occurrence (identical value here either way).

### 2.1 What these positions are

`rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1` (chapters 1–2) is the Open Catalan
after `1. d4 Nf6 2. c4 e6 3. g3 d5 4. Nf3 dxc4 5. Bg2 a6`, White to move.

`r1bqkb1r/ppp2ppp/2n1pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1` (chapter 3) is a **genuinely
different** branch of the same Open Catalan — Black plays `5... Nc6` directly instead of `5... a6`,
so the a6/b7 pawn structure differs entirely (no pawn on a6, b7 pawn still home). This is not a
transposition of the other two chapters; the repertoire is now White's answer to two distinct Black
setups against the Open Catalan, not one.

**Display caveat:** every chapter FEN has fullmove `1`, so `O-O`/`Qa4` shows as move **1** in the
trainer even though it is really later in the real game. Lichess does the same thing. Display move
numbers relative to each chapter's own start FEN and don't try to reconstruct the real numbering.

### 2.2 Trainer side

`w`. Detected from the chapter root's side-to-move when the root has children — the side that moves
first in the study is the side being trained. Overridable in the sidecar; a Black repertoire
starting from the initial position would have root side `w` and needs the override, so the sidecar
field is not optional in practice.

### 2.3 Expected parse — the card set

**86 unique cards** across 4 chapters. Chapters 1 and 2 **share their root card** (both start from
the same FEN with the same primary answer `O-O`); chapters 3 and 4 each start from their own
distinct FEN and share nothing with the others.

| Chapter | Cards touching it | Unique to it |
|---|---|---|
| 1 — "Open, a6 b5" | 16 | 15 (+ shared root) |
| 2 — "Open, a6 Nc6" | 21 | 20 (+ shared root) |
| 3 — "Open, Nc6" | 24 | 24 (own root, no sharing) |
| 4 — "Open, c5" | 26 | 26 (own root, no sharing) |
| **Total unique** | | **86** |

Cards are listed by the SAN path from their chapter's own root. `…` shows the accepted answers,
primary first.

**Chapter 1** (16 cards, including the shared root)

| # | Path to the position | Answers |
|---|---|---|
| 1 | *(chapter root, shared with ch2)* | `O-O` — `a4` **excluded**, see §3 |
| 2 | `O-O b5` | `Ne5` |
| 3 | `O-O b5 Ne5 Nd5` | `a4` |
| 4 | `O-O b5 Ne5 Nd5 a4 Bb7` | `b3` |
| 5 | `… b3 c3` | `e4` |
| 6 | `… c3 e4 b4` | `exd5` |
| 7 | `… exd5 Bxd5` | `Qh5` |
| 8 | `… Qh5 g6` | `Qh3` |
| 9 | `… e4 Nf6` | `Nxc3` |
| 10 | `… b3 cxb3` | `axb5` |
| 11 | `… cxb3 axb5 axb5` | `Rxa8` |
| 12 | `… Rxa8 Bxa8` | `Qxb3` |
| 13 | `O-O b5 Ne5 c6` | `b3` |
| 14 | `… c6 b3 cxb3` | `Nxc6` |
| 15 | `… Nxc6 Qb6` | `Na5` |
| 16 | `… Na5 Ra7` | `Nxb3` |

**Chapter 2** (21 cards; card 1 above is shared, +20 new)

| # | Path to the position | Answers |
|---|---|---|
| 17 | `O-O Nc6` | `e3`, `Nc3` *(both accepted — the study comments that Nc3 "is also an idea")* |
| 18 | `O-O Nc6 e3 Bd7` | `Qe2` |
| 19 | `… Bd7 Qe2 b5` | `b3` |
| 20 | `… b5 b3 cxb3` | `axb3` |
| 21 | `… cxb3 axb3 Bd6` | `Bb2` |
| 22 | `… Bd6 Bb2 O-O` | `Rc1` |
| 23 | `… Qe2 Bd6` | `Qxc4` |
| 24 | `… Bd6 Qxc4 O-O` | `Rd1` |
| 25 | `O-O Nc6 e3 Rb8` | `Nfd2` |
| 26 | `… Rb8 Nfd2 e5` | `Bxc6+` |
| 27 | `… Bxc6+ bxc6` | `dxe5` |
| 28 | `… dxe5 Ng4` | `Nxc4` |
| 29 | `… Rb8 Nfd2 Qd7` | `Nxc4` |
| 30 | `… Qd7 Nxc4 b5` | `Ncd2` |
| 31 | `O-O Nc6 Nc3 Rb8` | `e4` |
| 32 | `… Nc3 Rb8 e4 Be7` | `Qe2` |
| 33 | `… Qe2 Nxd4` | `Nxd4` |
| 34 | `… Nxd4 Qxd4` | `Rd1` |
| 35 | `… Rd1 Qc5` | `e5` |
| 36 | `… e5 Nd7` | `Ne4` |

**Chapter 3** ("Open, Nc6" — 24 new cards, its own independent root; White plays `1. Qa4` against
one of five Black tries, only one of which — `1... Bb4+` — is the mainline)

| # | Path to the position | Answers |
|---|---|---|
| 37 | *(chapter root)* | `Qa4` |
| 38 | `Qa4 Bb4+` | `Bd2` |
| 39 | `… Bd2 Nd5` | `Bxb4` |
| 40 | `… Bxb4 Nxb4` | `O-O` |
| 41 | `… O-O Rb8` | `Na3` |
| 42 | `… Na3 O-O` | `Qb5` |
| 43 | `… Qb5 b6` | `Qxc4` |
| 44 | `… Qxc4 Ba6` | `Nb5` |
| 45 | `… Nb5 Qd5` | `Qxd5` |
| 46 | `… Qxd5 Nxd5` | `a4` |
| 47 | `Qa4 Bb4+ Bd2 Bxd2+` | `Nbxd2` |
| 48 | `Qa4 Bb4+ Bd2 Bd6` | `Na3` |
| 49 | `… Bd6 Na3 Ne4` | `Nxc4` |
| 50 | `… Nxc4 Nxd2` | `Nfxd2` |
| 51 | `… Bd6 Na3 Bxa3` | `Qxa3` |
| 52 | `… Qxa3 Nxd4` | `Nxd4` |
| 53 | `… Nxd4 Qxd4` | `Rd1` |
| 54 | `Qa4 Nd5` | `Qxc4` |
| 55 | `… Qxc4 Nb6` | `Qd3` |
| 56 | `Qa4 Nd7` | `Qxc4` |
| 57 | `Qa4 Bd6` | `Ne5` |
| 58 | `Qa4 Bd7` | `Qxc4` |
| 59 | `… Qxc4 Na5` | `Qd3` |
| 60 | `… Qd3 c5` | `O-O` |

Line ends that produce **no** card (White to move, no recorded continuation) include: after
`8. Qh3` (ch1), after `1. a4 Nc6` (ch1 — inside an excluded subtree anyway), after `6. Nxb3` (ch1),
after `7. Qxb3 7...Nc6` (ch1 — `Nc6` is Black's reply with no further White move recorded), after
`8. Ne4` / `6. Nxc4 Be6` / `5. Ncd2` / `5. Rd1` / `7. Rc1 Nb4` (ch2), and after `10. a4` /
`3. Nbxd2` / `5. Nfxd2` / `6. Rd1` / `3. Qd3` / `2. Qxc4` / `2. Ne5` / `6. O-O` (ch3, one per
opponent-reply branch's own leaf).

Cards 31–36 exist because `Nc3` is an accepted alternate at card 17 — its subtree is reachable by
correct play. Contrast with `1. a4` in chapter 1, which is excluded, so its subtree yields nothing.
Chapter 3 needs **no exclusions at all** — every recorded move there is a genuine repertoire answer
or a legitimate opponent try.

**Chapter 4** ("Open, c5" — 26 new cards, its own independent root, added in a later update to the
source study; White plays `1. O-O` against `1... Nc6`, with `1... cxd4` as an accepted alternate that
branches into two further Black tries, `Qb6`'s own alternates `a6`/`Bc5`). Like chapter 3, it needs
no exclusions — every recorded move is a genuine answer or a legitimate opponent try — except for one
line-end with no card: after `7...b5 8. Qd3 c4 9. Qd1 Rc8`, no further White move is recorded, so
that resulting White-to-move position has no answer and no card (contrast with its sibling `8...Rc8`
alternate, which continues three more plies to `10. Nc3`). See `build_test.go`'s
`TestBuildRepertoire_Chapter4IsIndependent` and `TestBuildRepertoire_CardCount` for the enumeration
this table's counts are checked against; unlike chapters 1–3, chapter 4's individual cards aren't
hand-tabulated here — the tests are the authoritative source.

**These 86 cards are the acceptance test for the parser.** Assert the count, assert the ch1/ch2
shared root, assert card 17 has exactly two answers, assert chapters 3 and 4's roots do **not** share
a card with any other chapter, and assert no card exists in the `1. a4` subtree.

**Card count alone doesn't prove the *moves* are right.** A real bug (found via manual drilling, not
by any test at the time) had chapter 4's `9...Bxc6 10.Qxc6+ bxc6` line silently replayed as
`9...bxc6 10.Qxc6 Bxc6` instead — still 86 cards, still every token "legal," just the wrong legal
move at two plies, because `chess.FindLegalMoveBySAN` matched SAN tokens case-*insensitively* and
`Bxc6` (bishop capture) collides character-for-character with `bxc6` (pawn capture) once case is
folded — the one file letter (`b`) that coincides with a piece letter (Bishop). Fixed by comparing
case-sensitively (SAN case is semantically load-bearing, not cosmetic); the regression guard is
`TestParsePGN_AllLinesReplayExactly` in `internal/repertoire/pgn_test.go`, which independently
re-walks every root-to-leaf line in all 4 chapters and checks the freshly-generated SAN for each
replayed move is character-for-character what the tree recorded, not just *a* legal move.

## 3. Sidecar config

`backend/data/repertoires/catalan-white.config.json`, read alongside the PGN of the same basename:

```json
{
  "id": "catalan-white",
  "name": "Catalan",
  "side": "w",
  "source": "https://lichess.org/study/pYmWdR27",
  "description": "White repertoire against the Open Catalan. Three chapters: ...a6 b5, ...a6 Nc6, and direct ...Nc6 (without ...a6).",
  "excluded": [
    {
      "chapter": "Open, a6 b5",
      "path": ["a4"],
      "reason": "Study annotates this as inferior: Nc6 follows and the b4 square is weak."
    }
  ]
}
```

- `path` is the SAN sequence from the **chapter root** to the move being excluded, so it is
  unambiguous even when the same SAN appears in several places.
- `reason` is shown to the user if they play the excluded move during a drill.
- Every field except `excluded` is required. A PGN with no sidecar loads with `id` = filename,
  `name` = `StudyName`, and `side` inferred from the root (§2.2).
- A `path` that doesn't resolve is a **load error**, not a warning — a silently-ignored exclusion
  means the user gets drilled on a move the author marked as bad.

Moves carrying a `$2`/`$4`/`$6` NAG are excluded automatically with `reason` = "annotated ?/??/?! in
the study", no sidecar entry needed.

## 4. Repertoire JSON (served by the API)

```jsonc
{
  "id": "catalan-white",
  "name": "Catalan",
  "side": "w",
  "source": "https://lichess.org/study/pYmWdR27",
  "description": "...",
  "chapters": [
    // chapters need not share a startFen — chapter 3 ("Open, Nc6") has its own,
    // unrelated to chapters 1–2's, and its cards/replies never merge with theirs
    {
      "id": "ch1",
      "name": "Open, a6 b5",
      "url": "https://lichess.org/study/pYmWdR27/KXWPZNBT",
      "startFen": "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1",
      "intro": "Black wants to play b5 to keep the pawn. White's compensation is the center and lead in development.",
      "tree": {
        "san": "", "uci": "", "fen": "<startFen>", "ply": 0,
        "comment": "", "nags": [], "excluded": false,
        "children": [
          { "san": "O-O", "uci": "e1g1", "fen": "...", "ply": 1,
            "comment": "a4 is not a great move. Nc6 after and b4 square is weak.",
            "nags": [], "excluded": false, "children": [ /* ... */ ] },
          { "san": "a4", "uci": "a2a4", "fen": "...", "ply": 1,
            "comment": "", "nags": [], "excluded": true,
            "excludedReason": "Study annotates this as inferior: ...",
            "children": [ /* still present, for 'show me why' */ ] }
        ]
      }
    }
  ],
  "cards": [
    {
      "id": "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq -",
      "fen": "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq - 0 1",
      "side": "w",
      "ply": 0,
      "chapterIds": ["ch1", "ch2"],
      "pathSan": [],
      "answers": [
        { "san": "O-O", "uci": "e1g1", "fen": "...", "primary": true,
          "comment": "a4 is not a great move. ...", "chapterIds": ["ch1", "ch2"] }
      ],
      "excludedAnswers": [
        { "san": "a4", "uci": "a2a4", "reason": "Study annotates this as inferior: ..." }
      ]
    }
  ],
  "replies": {
    "<opponent-position card id>": [
      { "san": "b5",  "uci": "b7b5", "fen": "...", "chapterIds": ["ch1"] },
      { "san": "Nc6", "uci": "b8c6", "fen": "...", "chapterIds": ["ch2"] }
    ]
  }
}
```

`cards` and `replies` are both **derived** from `chapters[].tree` and could be computed on the
client. They're precomputed server-side because deriving them means replaying SAN, which is chess
logic, which belongs in Go.

`pathSan` is the SAN path from the card's *first* chapter root — used for the "line so far" display
and for debugging; it is not part of card identity.

`replies` is keyed by the same clock-stripped FEN scheme as card ids, for positions where the
**opponent** is to move.

## 5. Where the files live

```
backend/data/repertoires/
  catalan-white.pgn            # fetched from Lichess, checked in
  catalan-white.config.json    # sidecar
```

Loaded at startup by `repertoire.LoadDir("data/repertoires")`, which globs `*.pgn`, parses each with
its sidecar, and registers it. A parse failure logs loudly and skips that repertoire; the server
still starts (same policy as a missing `LICHESS_TOKEN`).

## 6. Persistence schema (Postgres, server-side)

**Superseded from the original design below.** Progress originally lived only in the browser's
`localStorage` (the envelope shown further down is what that looked like); it now syncs through the
backend to Postgres instead, so it follows the user across devices and survives clearing browser
storage — see root `CLAUDE.md`'s "Auth + server-side trainer sync" and backend `CLAUDE.md`'s "Auth +
trainer sync (Postgres)" for the full rationale. Everything database-related degrades gracefully with
no `DATABASE_URL` configured (progress just doesn't sync that session), same pattern as
Stockfish/`LICHESS_TOKEN`.

Two tables (`backend/internal/db/schema.sql`), keyed by the authenticated username rather than a
browser-local key:

```sql
-- one row per (username, repertoire, card) — this IS the learning state, never pruned
CREATE TABLE card_progress (
    username TEXT NOT NULL,
    repertoire_id TEXT NOT NULL,
    card_id TEXT NOT NULL,        -- CardKey(FEN), same key as §2 above
    box INT NOT NULL DEFAULT 0,
    lapses INT NOT NULL DEFAULT 0,
    seen INT NOT NULL DEFAULT 0,
    correct INT NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, repertoire_id, card_id)
);

-- one row per completed drill run — a log, not state; pruned on a retention
-- window (default 90 days), feeds the "lines drilled today/this week" analytics
CREATE TABLE line_attempts (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    repertoire_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    chapter_name TEXT NOT NULL,
    card_id TEXT NOT NULL,
    had_mistake BOOLEAN NOT NULL,
    played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `GET /api/progress/{repertoireId}` returns the whole `card_progress` map for the current user
  (`{"cards": {cardId: {box, lapses, seen, correct, lastSeenISO}}}`), empty if nothing drilled yet.
  `POST` upserts the merged whole map on every run boundary (not just session end) plus optionally one
  `line_attempts` row.
- Session-local fields (`dueStep`, `streak`, `introduced`, `retired`) are still **not** persisted;
  they're rebuilt at session start per `scheduler.md` §8.
- `card_id` is `CardKey(FEN)` (clock-stripped FEN), so editing the study only invalidates the
  positions that actually changed — same invalidation property the old localStorage keying had.

<details>
<summary>Original design (localStorage, pre-Postgres) — kept for historical context</summary>

One key per repertoire: `chesslab.trainer.v1.<repertoireId>`

```jsonc
{
  "version": 1,
  "repertoireId": "catalan-white",
  "updatedISO": "2026-07-26T10:11:12.000Z",
  "cards": {
    "rnbqkb1r/1pp2ppp/p3pn2/8/2pP4/5NP1/PP2PPBP/RNBQK2R w KQkq -": {
      "box": 3,
      "lapses": 1,
      "seen": 7,
      "correct": 6,
      "lastSeenISO": "2026-07-26T10:05:00.000Z"
    }
  },
  "sessions": [
    { "startedISO": "...", "endedISO": "...", "steps": 40, "correct": 34, "cardsSeen": 22 }
  ]
}
```

- `version` gates migrations. On an unknown version, **discard and start fresh** — losing drill
  history is annoying, crashing on load is worse.
- `sessions` keeps the last 20 entries, for the progress display. Trim on write.
- Writes are debounced (500 ms) and also flushed on session end and on `visibilitychange`.

</details>
