# Today’s Training

Today’s Training is a daily, cross-repertoire queue. A user selects the repertoires to include and a daily line count. The server builds and persists that day’s ordered queue for the signed-in user.

Each line is a repertoire/card pair. Queue order is stored as a sparse database rank rather than rewritten consecutive positions. A completion normally updates only the moved line's rank; the queue is rebalanced only if a rank gap is exhausted. The queue resumes after a refresh and is rebuilt automatically on a new database day using the saved selection and line count.

Daily selection first checks every selected line's saved progress: its last solve time, box, and lapse count. Overdue lines are selected before newer or recently solved lines, so a repertoire with hundreds of cards does not starve neglected work. Lichess importance then ranks lines within the same urgency band. The server checks Lichess explorer game volume after the first one to three moves of each line, then normalizes those values within that repertoire. A missed high-importance line is reinserted around the 25% mark; a clean high-importance line goes around the 75% mark. Less common lines remain closer to the prior middle/back behavior. Values are cached in Postgres and refreshed whenever a managed repertoire is imported or updated.

**Within an urgency band, candidates are interleaved round-robin by chapter, not sorted purely by
importance score** (`interleaveByChapter` in `today_training_handler.go`) — was a real bug, reported
live against a multi-chapter Grunfeld repertoire: every card in a brand-new repertoire ties on
urgency (nothing's been drilled yet), so the band-internal ranking was importance alone, and
importance is Lichess popularity of each card's own early moves normalized across the *whole*
repertoire. A repertoire's single most mainstream system (that Grunfeld repertoire's Petrosian
System, which the rest of the world plays far more than its other chapters) scored near the top for
nearly all of its own cards, so it filled almost every slot in `linesPerDay` and other chapters never
surfaced at all, day after day. Grouping each band's candidates by chapter and taking one
highest-scoring card per chapter per pass keeps importance as the in-chapter ranking signal (a
chapter's own mainline still comes before its own rare sideline) while guaranteeing every chapter
with due/new cards gets a turn before any chapter repeats.

This queue is independent from normal single-repertoire sessions. Normal sessions retain their existing scheduler and per-card progress behavior.
