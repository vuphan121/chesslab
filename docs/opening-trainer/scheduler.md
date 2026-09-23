# Opening Trainer — scheduling algorithm

Pure function of card state + a seeded RNG. No chess knowledge, no network, no clock. Lives at
`frontend/src/lib/trainer/scheduler.ts` and must be unit-testable in isolation.

## 1. Requirements this implements

From the feature request, in the user's words:

> "whatever line or move that the user gets correct will be put to the end of the queue, and if they
> get it wrong then they will get it again more often, and add some randomness as well"

Mapped to mechanisms:

| Requirement | Mechanism |
|---|---|
| correct → back of the queue | Leitner box promotion; the gap grows `2 → 4 → 8 → 16 → 32 → 64` steps — tracked per card via `box`/`dueStep`, but see §4: **`pickNext` no longer reads this to decide what's next** |
| wrong → get it again | demote 2 boxes; `lapses` increments permanently |
| wrong → get it **more often**, over the session as a whole | a card that keeps failing also keeps failing to retire, so it simply gets drawn again and again until it doesn't — not because anything prefers it, just because it's still in the active pool everything else has left |
| randomness | `pickNext` is a plain uniform random draw over every active card (see §4) — no window, no weighting, no due-ness at all |

**This table's shape hasn't changed since the original request, but §4 has, twice.** The original
implementation read `dueStep`/`box`/`lapses` to decide what to show next (the "weighted pick from a
window" row above, and the worked trace in an earlier version of this doc). A later revision replaced
that with strict round-robin by presentation count. Both were replaced again, in the same session,
by a plain uniform draw with no memory of past performance — see §4's note for why.

## 2. State

```ts
type Box = 0 | 1 | 2 | 3 | 4 | 5

interface CardState {
  cardId: string        // FEN without clocks
  box: Box
  lapses: number        // lifetime wrong answers, persisted across sessions
  streak: number        // consecutive correct, resets to 0 on a miss
  seen: number          // lifetime presentations
  correct: number       // lifetime correct
  lastSeenISO: string | null
  // session-local, recomputed at every session start:
  retired: boolean
  dueStep: number        // still written by grade() (§5), no longer read by pickNext (§4)
}
```

There is no `introduced`/`newLimit` concept — every included card is eligible from step 0 of the
session, not drip-fed in gradually. An earlier revision had this; it was removed because the
scheduler shouldn't need to track whether you've "already learned" a card to decide whether to show
it.

```ts
interface SessionState {
  step: number                  // logical clock; +1 per graded card
  cards: Map<string, CardState>
  order: string[]               // stable card ordering; also what a fully-random pickNext draws from
  rng: () => number             // seeded, injectable — the only source of randomness anywhere here
  opts: SessionOptions
  correctCount: number
  incorrectCount: number
  lastCardId?: string | null    // pickNext's only piece of memory — see §4
}
```

## 3. Constants

```ts
export const BASE_GAP    = [2, 4, 8, 16, 32, 64]  // indexed by box
export const MAX_BOX     = 5
export const DEMOTE      = 2      // boxes lost on a miss
export const RELEARN_GAP = 2      // steps until a missed card returns
export const LAPSE_DECAY = 0.8    // gap *= LAPSE_DECAY ** lapses
export const JITTER      = 0.35   // gap *= uniform(1-J, 1+J)
export const RETIRE_STREAK = 2    // consecutive correct at MAX_BOX to retire
export const WEAKNESS_W  = 0.75   // opponent-reply weighting, in replySelection.ts (see design.md §6)
```

`PICK_WINDOW`/`LAPSE_W`/`OVERDUE_W`/`NEW_RATE` from an earlier revision are gone — `pickNext` (§4)
no longer has anything for them to tune. `sessionLength` (default 40 steps, `null` for unbounded)
still comes from the session setup screen via `SessionOptions`.

## 4. Picking the next card

```
function pickNext(s: SessionState): CardState | null
  active = cards where !retired
  if active is empty: return null                 // session complete

  // the only rule: don't immediately repeat the card just shown, if there's
  // an alternative — otherwise draw uniformly from every active card
  candidates = active.length > 1 ? active where cardId != s.lastCardId : active
  pool = candidates.length > 0 ? candidates : active
  picked = pool[floor(s.rng() * pool.length)]
  s.lastCardId = picked.cardId
  return picked
```

**This used to be a lot smarter, twice, and both times that was the actual bug.** The original
version above this line (see the requirements table's history note in §1) sorted by how overdue a
card was and weighted the draw by lapses; a later revision replaced that with strict round-robin —
always show whichever active card had been presented fewest times so far. Each version fixed one
reported complaint ("this one line keeps coming back", then "this one chapter keeps coming back") by
adding a rule that preferred whatever the session hadn't caught up to yet. That preference is
inherently front-loaded — for a repertoire drilled unevenly across many real sessions (one chapter at
`seen: 500+`, a newer one still at `seen: 0`), it reliably reproduced the exact same class of
complaint: pickNext would show *only* the least-caught-up material, chapter after chapter, until it
was caught up.

Requested explicitly over patching that rule again: remove the preference entirely.
`box`/`lapses`/`seen`/`dueStep` are all still tracked (§5 — a card still needs several correct reps
to retire, and a miss still demotes it), they just no longer influence what gets shown next. Coverage
is no longer guaranteed — a card can, by bad luck, go unseen for a long stretch of a large session —
which is the accepted tradeoff for the ordering being genuinely unpredictable, whether the session
covers a whole repertoire or a hand-picked subset of chapters.

## 5. Grading

```
function grade(s: SessionState, c: CardState, correct: boolean)
  s.step   += 1
  c.seen   += 1
  c.lastSeenISO = now()

  if correct:
      c.correct += 1
      c.streak  += 1
      c.box      = min(c.box + 1, MAX_BOX)
      if c.box == MAX_BOX and c.streak >= RETIRE_STREAK:
          c.retired = true
          return
      gap = BASE_GAP[c.box] * (LAPSE_DECAY ** c.lapses)
  else:
      c.lapses += 1
      c.streak  = 0
      c.box     = max(0, c.box - DEMOTE)
      gap       = RELEARN_GAP

  jittered  = gap * uniform(1 - JITTER, 1 + JITTER, s.rng)
  c.dueStep = s.step + max(1, round(jittered))
```

`gap` is computed from the **new** box, so the promotion takes effect immediately. `RELEARN_GAP` is
not lapse-decayed — a miss always returns in ~2 steps regardless of history; the decay applies to
the recovery ladder afterwards, which is where it matters.

## 6. Session end

The session is over when any of these holds — checked **between runs**, never mid-run, so a line is
never cut in half:

- every selected card is `retired`;
- `s.step >= opts.sessionLength` (when the user chose a fixed length);
- the user pressed *End session*.

Then persist (see `data-format.md` §6) and show the summary.

## 7. Worked trace

`pickNext` itself has nothing left to trace — it's a uniform draw over whatever's active, so "which
card comes next" isn't a function of prior answers at all (only "not the same card twice in a row"
is). What's still worth tracing is `grade()`'s box/gap math, which is unchanged and is where "wrong →
see it more often" actually lives now (a card that keeps failing keeps failing to retire, so it stays
in the active pool everything else eventually leaves).

One card, jitter disabled (multiplier fixed at 1.0) so the numbers are checkable by hand:

| presentation | result | box | lapses | gap | new dueStep (unused by pickNext, kept for `grade()`'s own bookkeeping) |
|---|---|---|---|---|---|
| 1 | ✓ | 0→1 | 0 | `4 × 0.8⁰` = 4 | step+4 |
| 2 | ✗ | 1→0 | 0→1 | relearn 2 | step+2 |
| 3 | ✓ | 0→1 | 1 | `4 × 0.8¹` = 3.2 → 3 | step+3 |
| 4 | ✓ | 1→2 | 1 | `8 × 0.8¹` = 6.4 → 6 | step+6 |

Compare presentation 3 here against presentation 1 of a card with 0 lapses at the same box: same box
transition (0→1), but the lapsed card's gap is 3 instead of 4 — 20% shorter, permanently, at every
box from here on. That's "get it wrong → see it more often" in its entirety now; nothing about
*when* this card gets drawn next depends on that gap, only how long it takes to retire once drawn.

## 8. Cross-session decay

At session start, for each card with stored state:

```
days = floor((now - lastSeenISO) / 1 day)
box = clamp(box, 0, MAX_BOX)
if days > BASE_GAP[box]:  box = max(0, box - 1)
dueStep = 0                    // unused by pickNext now, but still initialized for grade()'s sake
retired = false
```

A card decays by one box only after it exceeds that box's actual review interval: 2, 4, 8, 16, 32,
or 64 days. A box-5 card therefore stays in box 5 after a short absence instead of being demoted
merely because the numeric box index is 5. Crude on purpose — see `design.md` §9. Anything more principled means
implementing SM-2 or FSRS, which is a separate decision with its own doc.

## 9. Testing

`scheduler.test.ts` covers, with a fixed seed:

1. A correct answer moves the card strictly further out than a wrong one from the same state.
2. Box progression `0→1→2→3→4→5` over six consecutive correct answers, with the documented gaps
   (jitter stubbed to 1.0).
3. A miss demotes by exactly 2 (and floors at 0 from box 0 and box 1).
4. `lapses` monotonically shortens the gap: `gap(box=3, lapses=0) > gap(box=3, lapses=1) > …`, and
   never goes below 1.
5. Retirement fires only at box 5 with streak ≥ 2, and a retired card is never picked again.
6. `pickNext` draws roughly uniformly across active cards regardless of `seen`/`box`/`lapses` — cards
   seeded with wildly different history (`seen: 500` vs. `seen: 20` vs. never-attempted) each land
   within a few percent of their fair share over thousands of draws. This is the test that would have
   caught both retired designs (overdue-window, then round-robin-by-seen), which both failed it by
   construction.
7. Every card is immediately eligible — no gradual new-card introduction (no `newLimit` concept).
8. Determinism: two runs with the same seed and the same answer sequence produce identical pick
   orders. (This is the test that catches accidental use of `Math.random`.)
9. `pickNext` never repeats the same card back-to-back while another active card exists.
10. A session where the answer for one specific card is always wrong ends with that card having the
    lowest box and the highest presentation count of the set — still true under uniform-random
    selection, since once its siblings retire (by answering correctly) it's the only card left to
    draw.
11. Mode filtering (`mistakes` / `review-only`) restricts the pool `pickNext` draws from correctly.
12. Cross-session decay uses `BASE_GAP[box]`, including the high-box short-absence regression case.
