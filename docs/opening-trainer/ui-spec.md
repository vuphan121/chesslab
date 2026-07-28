# Opening Trainer — UI specification

The trainer must look like it was always part of the app. Same page background, same panel
treatment, same type scale, same pill language. Nothing new gets invented visually except the page
dropdown and the correct/incorrect feedback colours.

## 1. Design tokens (existing — reuse, don't redefine)

| Token | Value | Where it's already used |
|---|---|---|
| Page background | `#e8e8e6` | `body`, `page.tsx` outer card |
| Panel | `background: #fff`, `borderRadius: 11`, `boxShadow: 0 1px 3px rgba(0,0,0,0.06), inset 0 0 0 1px rgba(0,0,0,0.05)` | `TopBar`, `MoveHistory` |
| Primary text | `#1c1b18` / `#37352f` | body, eval readout |
| Muted text | `#6a675f` | pill text |
| Faint text | `#a3a099`, `#b4b1a8` | caption, section labels |
| Hairline | `#eae8e2` | button borders |
| Pill (neutral) | bg `#f0efe9`, `fontSize 12`, `fontWeight 600`, `borderRadius 8`, `padding 6px 13px` | `TopBar` |
| Pill (positive) | fg `oklch(0.48 0.11 155)`, bg `oklch(0.955 0.038 155)` | "Book move" pill |
| Accent blue | `#4a90d9` (fills), `#2f6db0` (wordmark) | move-list highlight |
| Section label | `.lbl` — 11px / 600 / `letter-spacing 1.3px` / uppercase | panel headers |
| Mono | `.mono` class (tabular numerals) | evals, counts |
| Board | `SQUARE_SIZE = 72`, `BOARD_SIZE = 576` | `page.tsx` |
| Side column | `SIDE_WIDTH = 371`, outer width `1432`, padding `24`, column gap `20` | `page.tsx` |

**New tokens, and only these:**

| Token | Value | Use |
|---|---|---|
| Correct | fg `oklch(0.45 0.13 152)`, bg `oklch(0.95 0.045 152)` | correct feedback strip, square flash |
| Incorrect | fg `oklch(0.5 0.16 25)`, bg `oklch(0.955 0.04 25)` | wrong feedback strip, square flash |
| Excluded | fg `oklch(0.55 0.11 75)`, bg `oklch(0.96 0.05 75)` | "not in your repertoire" |

Chosen in the same oklch family as the existing "Book move" green so they sit together.

## 2. Cross-page navigation

New component `frontend/src/components/layout/PageSwitcher.tsx`, rendered inside `TopBar`
immediately after the `Chesslab` wordmark, on **every** page.

- Trigger: a neutral pill showing the current page name + a 10px chevron. Same pill styling as the
  existing status pills, plus `cursor: pointer` and a `#eae8e2` hairline border to read as
  interactive.
- Click → a popover directly below (`position: absolute`, panel treatment, `minWidth: 220`,
  `padding: 6`, `zIndex: 50`), listing every page as a `next/link`:

  | Label | Route | Sub-label |
  |---|---|---|
  | Analysis Board | `/` | Board, engine, explorer, AI coach |
  | Opening Study | `/opening-study` | Drill your repertoire |

- Current page: `#4a90d9` text with a small check on the right; others `#37352f`, hover
  `background: #f6f5f1`.
- Closes on outside click, on `Escape`, and on navigation. Keyboard: `Enter`/`Space` opens,
  `ArrowUp`/`ArrowDown` move, `Enter` selects.
- Uses `usePathname()` for the active entry. Page list is a module-level `const PAGES` array so
  adding a third page is one line.

`TopBar` props become `{ turn?: Color; isBookMove?: boolean; right?: ReactNode }`. When `right` is
given it replaces the default pills; the analysis page keeps passing `turn`/`isBookMove` and looks
identical to today.

## 3. Route and file layout

```
frontend/src/app/opening-study/page.tsx        # 'use client'; owns which screen is showing
frontend/src/components/trainer/
  RepertoirePicker.tsx     # setup screen
  TrainerBoard.tsx         # centre column: prompt caption + Board + feedback strip
  LinePanel.tsx            # left column: chapter, line so far, annotation
  SessionPanel.tsx         # right column: progress, streak, missed list, end button
  SessionSummary.tsx       # end screen
  FeedbackStrip.tsx        # the correct/incorrect/excluded bar under the board
frontend/src/hooks/useTrainerSession.ts
frontend/src/lib/trainer/{types,scheduler,rng,persistence}.ts
```

The page is a three-state machine: `setup` → `drilling` → `summary`, with `summary` → `setup` and
`summary` → `drilling` (restart with the same options).

## 4. Screens

### 4.1 Setup

One centred panel, `width: 720`, inside the standard outer card under `TopBar`.

```
┌─ Opening Study ──────────────────────────────────────────┐
│  CHOOSE A REPERTOIRE                          .lbl        │
│  ┌───────────────────────────────────────────────────┐    │
│  │ ● Catalan                          [White] 60 pos │    │  <- selected: 1px #4a90d9 ring
│  │   White repertoire against the Open Catalan...    │    │
│  │   3 chapters · from lichess.org/study/pYmWdR27    │    │
│  └───────────────────────────────────────────────────┘    │
│                                                           │
│  CHAPTERS                                     .lbl        │
│  [✓] Open, a6 b5      16 positions                        │
│  [✓] Open, a6 Nc6     21 positions                        │
│  [✓] Open, Nc6        24 positions                        │
│                                                           │
│  SESSION                                      .lbl        │
│  Length      [ 20 ] [ 40 ] [ 80 ] [ Until done ]          │  <- segmented, 40 default
│  New cards   [ 4 ] [ 8 ] [ 16 ] [ None ]                  │  <- 8 default
│  Mode        [ Mixed ] [ Review only ] [ Mistakes ]       │  <- Mixed default
│                                                           │
│  Your progress: 18 / 33 positions learned · 86% accuracy  │  <- from localStorage; omitted if none
│                                                           │
│                                 [ Start session ]         │  <- #4a90d9, white text, radius 8
└───────────────────────────────────────────────────────────┘
```

- Side is shown as a pill (`White` / `Black`), not a choice — it's a property of the repertoire.
- Segmented controls: neutral pill row, selected segment `#4a90d9` on white text.
- "Mistakes" mode is disabled with a tooltip when no card has `lapses > 0`.
- Deselecting every chapter disables Start.
- Empty state (no repertoires loaded): the panel shows "No repertoires loaded" plus the path
  `backend/data/repertoires/` and the `curl` command from `data-format.md` §1.

### 4.2 Drilling

Same three-column skeleton as the analysis page, same widths, same `BOARD_TOP_OFFSET` alignment.

```
[ LinePanel 371 ]   [ prompt caption + Board 576 ]   [ SessionPanel 371 ]
                    [ FeedbackStrip                ]
```

**No eval bar, no engine readout, no opening tree.** See `design.md` §10 — they'd show the answer.
The 15px + 11px gap the eval bar occupied is dropped, so the centre column is exactly `BOARD_SIZE`
wide; keep the outer width at 1432 and let the extra space fall into the column gaps.

**Prompt caption** (replaces the analysis page's engine readout, same 30px row):

- Left: `White to move — play your repertoire move` in 13px `#37352f`, the side word in `600`.
- Right: a mono `#a3a099` progress readout `card 7 / 33 · step 12 / 40`, then the flip button
  (same SVG, same styling as the analysis page).
- Board orientation defaults to the **trainer side at the bottom** and is remembered per
  repertoire.

**LinePanel** (left, `height: BOARD_SIZE`, panel treatment, scrolls internally):

- Header: chapter name (19px / 500, wraps, never truncated — same treatment as `MoveHistory`'s
  opening name) + a `.lbl` "CHAPTER" above it.
- Chapter intro comment, if any, in `.serif` 14px `#4a4740`, shown only at the start of a run.
- "LINE SO FAR": the moves from the chapter root to the current position in figurine notation
  (reuse `MoveHistory`'s `toFigurine`), laid out as `N. white  black` rows. The move being asked
  about is a `#f0efe9` cell with a blinking caret; nothing beyond it is shown — **the panel must
  never render moves the user hasn't answered yet.**
- After a graded answer, the answer's study comment appears below in `.serif`, prefixed by a small
  `“` glyph. This is the payoff for parsing comments — the user gets the author's actual words at
  the moment they need them.

**FeedbackStrip** (under the board, `height: 56`, `flexShrink: 0`, panel treatment, colours from §1):

| State | Content |
|---|---|
| `prompting` | empty, `background: transparent` — the strip holds its height so nothing jumps |
| `correct` | ✓ `Correct — 3. a4` · streak count on the right |
| `correct-alt` | ✓ `Also in your repertoire — 2. Nc3` · "mainline is 2. e3" on the right |
| `incorrect` | ✗ `Not your move — you played 3. b4, the line is 3. a4` · `[ Show the line ]` |
| `excluded` | ! `2... a4 is in the study, but marked as not part of the repertoire` + the sidecar `reason` |
| `line-end` | `End of line — 8. Qh3` · `[ Next ]` |

Transitions are the only animation: 180 ms fade for the strip, a 220 ms tint flash on the
destination square (correct/incorrect colour at 45% alpha), and the corrective move played at
~450 ms so the eye can follow it. Respect `prefers-reduced-motion` by dropping to instant.

**SessionPanel** (right, `height: BOARD_SIZE`, panel treatment):

- `.lbl` "SESSION" header + an `[ End session ]` text button.
- A progress bar: correct (green) / incorrect (red) / remaining (`#f0efe9`), 6px tall, radius 3.
- Three mono stat tiles: `Correct 11/13`, `Accuracy 85%`, `Streak 4`.
- "LEARNED": `18 / 33` with a second thin bar (cards at box ≥ 4).
- "NEEDS WORK": the up-to-6 cards with the most lapses, each a row showing the move number, the
  expected move in figurine notation, and a red `×N` lapse count. Clicking a row is a **no-op
  during drilling** (jumping to a card on demand would let the user farm easy positions) — it's a
  readout, and it becomes clickable on the summary screen.

**Keyboard:** `Enter`/`Space` advances after a graded answer (same as clicking Next); `f` flips the
board; `Escape` opens the end-session confirm. Arrow keys are **not** bound — there is no history to
scrub through, and reusing the analysis page's handler here would be misleading.

### 4.3 Summary

Replaces the three columns with one centred panel, `width: 720`.

- Headline: `You drilled 22 positions in 40 steps` + accuracy as a large `.mono` figure.
- Ring or bar breakdown: correct / incorrect / not reached.
- "MISSED" table: expected move, chapter, lapse count, and a `Drill these` button starting a new
  session in `mistakes` mode with exactly that set.
- "LEARNED THIS SESSION": cards that reached box 5.
- Buttons: `[ Drill mistakes ]` (disabled if none) · `[ Same again ]` · `[ Change repertoire ]`.

## 5. States that must be handled

| Situation | Behaviour |
|---|---|
| `GET /api/repertoires` fails | Setup panel shows "Can't reach the backend" + the `go run ./cmd/server/` command; retry button. |
| Repertoire loads but has 0 cards | Named error: "this study has no positions for the side being trained" — usually a wrong `side` in the sidecar. |
| A move request fails mid-drill | Show an inline error in the feedback strip, leave the position untouched, allow retry. Never grade a card on a network failure. |
| User navigates away mid-session | Flush persistence on `visibilitychange`; no confirm dialog. |
| Session set is exhausted before `sessionLength` | End early and say so on the summary ("everything retired in 26 steps"). |
| Window narrower than 1432 | Same as the analysis page today: the outer card is fixed-width and the page scrolls horizontally. Not a regression to fix here. |

## 6. Accessibility

- The board is already pointer-only; the trainer does not make that worse, but the feedback strip
  must be an `aria-live="polite"` region so the result is announced.
- Correct/incorrect are never signalled by colour alone — every state carries a glyph (`✓ ✗ !`) and
  the move text.
- Focus is moved to the feedback strip's advance button after grading, so `Enter` continues without
  a mouse.
