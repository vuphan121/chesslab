# Today’s Training

Today’s Training is a daily, cross-repertoire queue. A user selects the repertoires to include and a daily line count. The server builds and persists that day’s ordered queue for the signed-in user.

Each line is a repertoire/card pair. Completing it cleanly places it at the back of the queue. A line with any mistake returns to the middle. The queue resumes after a refresh and is rebuilt automatically on a new database day using the saved selection and line count.

This queue is independent from normal single-repertoire sessions. Normal sessions retain their existing scheduler and per-card progress behavior.
