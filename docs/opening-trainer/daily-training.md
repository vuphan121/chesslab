# Today’s Training

Today’s Training is a daily, cross-repertoire queue. A user selects the repertoires to include and a daily line count. The server builds and persists that day’s ordered queue for the signed-in user.

Each line is a repertoire/card pair. Queue order is stored as a sparse database rank rather than rewritten consecutive positions. A completion normally updates only the moved line's rank; the queue is rebalanced only if a rank gap is exhausted. The queue resumes after a refresh and is rebuilt automatically on a new database day using the saved selection and line count.

Daily selection first checks every selected line's saved progress: its last solve time, box, and lapse count. Overdue lines are selected before newer or recently solved lines, so a repertoire with hundreds of cards does not starve neglected work. Lichess importance then ranks lines within the same urgency band. The server checks Lichess explorer game volume after the first one to three moves of each line, then normalizes those values within that repertoire. A missed high-importance line is reinserted around the 25% mark; a clean high-importance line goes around the 75% mark. Less common lines remain closer to the prior middle/back behavior. Values are cached in Postgres and refreshed whenever a managed repertoire is imported or updated.

This queue is independent from normal single-repertoire sessions. Normal sessions retain their existing scheduler and per-card progress behavior.
