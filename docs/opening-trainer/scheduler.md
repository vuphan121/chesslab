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
| correct → back of the queue | Leitner box promotion; the gap grows `2 → 4 → 8 → 16 → 32 → 64` steps, and a gap larger than the session length is functionally "gone for the session" |
| wrong → get it again | demote 2 boxes, reschedule 2 steps out |
| wrong → get it **more often** | `0.8 ^ lapses` multiplier on every future gap for that card, permanently |
| randomness | ±35% jitter on gaps, weighted pick from a 4-card window, weighted opponent replies |

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
  introduced: boolean
  retired: boolean
  dueStep: number
}
```

```ts
interface SessionState {
  step: number                  // logical clock; +1 per graded card
  cards: Map<string, CardState>
  order: string[]               // stable card ordering, used to break ties deterministically
  rng: () => number             // seeded, injectable
  opts: SessionOptions
  log: GradeEvent[]             // for the end-of-session summary
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
export const PICK_WINDOW = 4      // choose randomly among the N most-overdue
export const LAPSE_W     = 1.0    // pick weight per lapse
export const OVERDUE_W   = 0.25   // pick weight per step overdue
export const NEW_RATE    = 0.3    // chance of introducing a new card when reviews are also due
export const WEAKNESS_W  = 0.75   // opponent-reply weighting (see design.md §6)
```

Every one of these is exported and takes an override from `SessionOptions`, so tuning doesn't
require touching the algorithm. `NEW_LIMIT` (concurrent unlearned cards, default 8) and
`sessionLength` (default 40 steps) come from the session setup screen.

## 4. Picking the next card

```
function pickNext(s: SessionState): CardState | null
  active   = cards where introduced && !retired
  due      = active where dueStep <= s.step
  newPool  = cards where !introduced
  inFlight = count(active where box < 2)

  // 1. introduce new material
  if newPool nonempty and inFlight < opts.newLimit:
      if due is empty or s.rng() < NEW_RATE:
          c = newPool in `order` sequence, first entry
          c.introduced = true
          c.dueStep    = s.step
          return c

  // 2. nothing due and nothing to introduce -> advance the clock
  if due is empty:
      if active is empty: return null              // session complete
      s.step = min(dueStep over active)
      due = active where dueStep <= s.step

  // 3. weighted pick from the most-overdue window
  sort due by (dueStep asc, order-index asc)       // total order -> deterministic
  window = due[0 .. PICK_WINDOW-1]
  weight(c) = (1 + LAPSE_W * c.lapses) * (1 + OVERDUE_W * (s.step - c.dueStep))
  return weightedChoice(window, weight, s.rng)
```

Two notes on step 3. The window is what keeps randomness bounded: the queue order still dominates
(you always draw from the front), but you can't predict which of the next few it will be. And the
weight makes a card you've failed twice roughly 3× as likely to be drawn as a clean card sitting at
the same place in the queue.

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

Five cards `A B C D E`, all introduced, all `box 0 / dueStep 0 / lapses 0`. **Jitter disabled**
(multiplier fixed at 1.0) so the numbers are checkable by hand; the RNG's pick choices are noted.

| step | due (dueStep) | picked | result | box | lapses | gap | new dueStep |
|---|---|---|---|---|---|---|---|
| 0 | A0 B0 C0 D0 E0 | B | ✓ | 0→1 | 0 | `4 × 0.8⁰` = 4 | 1+4 = **5** |
| 1 | A0 C0 D0 E0 | D | ✗ | 0→0 | 0→1 | relearn 2 | 2+2 = **4** |
| 2 | A0 C0 E0 | A | ✓ | 0→1 | 0 | 4 | 3+4 = **7** |
| 3 | C0 E0 | C | ✓ | 0→1 | 0 | 4 | 4+4 = **8** |
| 4 | E0 D4 | D | ✓ | 0→1 | 1 | `4 × 0.8¹` = 3.2 → 3 | 5+3 = **8** |
| 5 | E0 B5 | E | ✓ | 0→1 | 0 | 4 | 6+4 = **10** |
| 6 | B5 | B | ✓ | 1→2 | 0 | 8 | 7+8 = **15** |
| 7 | A7 | A | ✓ | 1→2 | 0 | 8 | 8+8 = **16** |
| 8 | C8 D8 | D (2× weight) | ✓ | 1→2 | 1 | `8 × 0.8` = 6.4 → 6 | 9+6 = **15** |

Read the two things this is meant to show:

- **Step 4 vs step 2.** `D` and `A` are both at box 0→1, but `D` has one lapse, so its next gap is 3
  instead of 4. It will keep being 20% shorter at every box from now on. That's "get it wrong → see
  it more often", and it doesn't wear off after one correct answer.
- **Step 8.** `C` and `D` are both due at step 8. `C`'s pick weight is `(1+0)×(1+0) = 1`; `D`'s is
  `(1+1)×(1+0) = 2`. `D` is twice as likely to be drawn even from the same queue slot.

With jitter on, every `new dueStep` in that table would shift by up to ±35%, so no two sessions
present the same order.

## 8. Cross-session decay

At session start, for each card with stored state:

```
days = floor((now - lastSeenISO) / 1 day)
if days > box:  box = max(0, box - 1)
dueStep = 0                    // everything starts due; pick order does the rest
introduced = box > 0 || seen > 0
retired = false
```

A box-5 card left alone for six days drops to box 4 and gets asked once more; a box-1 card left for
two days drops to 0. Crude on purpose — see `design.md` §9. Anything more principled means
implementing SM-2 or FSRS, which is a separate decision with its own doc.

## 9. Testing

`scheduler.test.ts` must cover, with a fixed seed:

1. A correct answer moves the card strictly further out than a wrong one from the same state.
2. Box progression `0→1→2→3→4→5` over six consecutive correct answers, with the documented gaps
   (jitter stubbed to 1.0).
3. A miss demotes by exactly 2 (and floors at 0 from box 0 and box 1).
4. `lapses` monotonically shortens the gap: `gap(box=3, lapses=0) > gap(box=3, lapses=1) > …`, and
   never goes below 1.
5. Retirement fires only at box 5 with streak ≥ 2, and a retired card is never picked again.
6. `pickNext` never returns a card whose `dueStep > step` while another is due.
7. Fast-forward: with all cards scheduled ahead, `step` jumps to the minimum `dueStep` and does not
   silently skip a card.
8. New-card introduction respects `newLimit` and stops when the pool is exhausted.
9. Determinism: two runs with the same seed and the same answer sequence produce identical pick
   orders. (This is the test that catches accidental use of `Math.random`.)
10. A 40-step simulated session where the answer for one specific card is always wrong ends with
    that card having the lowest box and the highest presentation count of the set.
