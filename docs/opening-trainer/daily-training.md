# Today’s Training

Today’s Training is a daily, cross-repertoire queue. A user selects the repertoires to include. The server puts every eligible scheduled entry from those repertoires into the queue, shuffles it once, and persists that order for the signed-in user.

Each displayed “line” is a repertoire/card pair that starts a playable run through the repertoire. Queue order is stored as a sparse database rank rather than rewritten consecutive positions. When a run finishes, its entry is always appended to the back of the queue, regardless of mistakes, saved progress, or Lichess popularity. The queue therefore behaves as a simple FIFO cycle: every queued entry reaches the front before an entry can come around again. The queue resumes after a refresh and is reshuffled automatically on a new database day using the saved repertoire selection.

There is no daily line-count cap. If the selected repertoires contain 640 distinct cards, the persisted queue contains all 640 entries. The queue does not shrink as the user trains; each completed entry moves from the front to the back.

This queue is independent from normal single-repertoire sessions. Normal sessions retain their existing scheduler and per-card progress behavior.
