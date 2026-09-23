# Opening Trainer — current UI

This file describes the shipped `/opening-study` interface. Historical component plans in
`build-plan.md` are not the source of truth for the current layout.

## Visual language

The trainer keeps Chesslab's existing warm gray/blue palette, serif headings, compact labels,
rounded white panels, and original top bar. The top bar is flush with the top of the viewport; the
page does not add a card or margin around it. The trainer background uses a subtle warm-gray to
cool-gray gradient.

## Repertoire picker

The setup page is a centered, expandable workspace designed to support a large repertoire catalog.

- `By repertoire` and `Mixed training` are the two top-level modes.
- Repertoires are searchable compact pills. Each shows its name, chapter count, and a white or black
  marker matching the trained side.
- Selecting a repertoire automatically selects every chapter. Chapters can then be independently
  selected or deselected.
- A chapter can be expanded to inspect its non-excluded lines without changing its selected state.
- The picker shows no aggregate selected-line sentence. The chapter header only shows the number of
  chapters selected.
- `Start session` is disabled until at least one chapter is selected.
- Mixed training is a separate minimal panel for resuming the cross-repertoire daily queue. It does
  not show a total number of lines.
- Repertoire management remains available from the `Manage` action.

## Drilling layout

Desktop uses three independently positioned areas:

```text
[move panel]      [centered board]  [Next line]
                                  [Do it again]
                                  [Analyze]
                                  [feedback at bottom]
```

- The move panel is pinned to the far left.
- The board is centered in the available viewport whenever that does not collide with the move
  panel. If space is tight, it is clamped immediately to the panel's right.
- The action column sits directly to the board's right with a consistent gap. `Next line` is always
  available; `Do it again` and `Analyze` appear when a run ends.
- The board scales from both viewport width and viewport height so it fills the screen without
  forcing vertical scrolling or overlapping adjacent panels.
- The Back action is directly below the top bar, aligned with the left page edge.
- The repertoire and chapter names are shown in the move panel, not in the top bar.
- The trainer has no flip-board button, engine evaluation, opening explorer, or coach; those would
  reveal information during recall.

On viewports narrower than 1040px, the page becomes a stacked layout: board, wrapped actions, then
the move panel. The board width follows the available viewport width.

## Feedback and hints

- Feedback is a large status card at the bottom of the desktop action column.
- It displays only `Correct` in green or `Incorrect` in red. It does not repeat the played or
  expected move because the board arrow communicates that information.
- The feedback region is `aria-live="polite"`.
- Hint/correction arrows use the board's smaller trainer arrow size.
- On narrow screens, feedback overlays the top of the board so it does not consume scarce vertical
  space.

## Move panel and history

The move panel header shows the repertoire and chapter. It lists the known path and moves played in
the current run in figurine notation. Completed moves are clickable for review; arrow buttons and
the keyboard's Left/Right keys step through that history. While reviewing, a link returns to the
live position. Study comments appear at the bottom after a correct answer.

## Run completion

All three completion actions remain available:

- `Next line` advances the scheduler.
- `Do it again` replays the same forced path.
- `Analyze` transfers the played line into a new Analysis Board game.

The suggested action is blue: retry after a mistaken run, or continue after a clean run. This is a
visual recommendation, not a restriction.

## States and failure handling

- Catalog loading and empty states stay inside the setup workspace.
- A catalog failure displays a concise backend connection message.
- A session cannot start with zero selected chapters.
- Network failures during drilling leave the current position available for retry and do not grade
  the card.
- Setup, drilling, line completion, and summary are separate phases; changing repertoire returns to
  setup without retaining stale board state.
