# Today’s Training

Today’s Training is a daily, cross-repertoire queue. A user selects the repertoires to include. The server puts every eligible scheduled entry from those repertoires into the queue, shuffles it once, and persists that order for the signed-in user.

Each displayed “line” is a repertoire/card pair that starts a playable run through the repertoire. Queue order is stored as a sparse database rank rather than rewritten consecutive positions. When a run finishes, its entry is always appended to the back of the queue, regardless of mistakes, saved progress, or Lichess popularity. The queue therefore behaves as a simple FIFO cycle: every queued entry reaches the front before an entry can come around again. The queue resumes after a refresh and is reshuffled automatically on a new local calendar day using the saved repertoire selection.

Queue rebuilds and advances take a transaction-scoped per-user database lock. An automatic rebuild
also verifies that the settings it originally read are still current after acquiring that lock.
This keeps simultaneous browser/device requests from losing an advance or restoring stale settings.

There is no daily line-count cap. If the selected repertoires contain 640 distinct cards, the persisted queue contains all 640 entries. The queue does not shrink as the user trains; each completed entry moves from the front to the back.

This queue is independent from normal single-repertoire sessions. Normal sessions retain their existing scheduler and per-card progress behavior.

## API payload and mobile cache

The Today’s Training endpoints return a compact queue summary rather than serializing every persisted
entry after each line:

```json
{
  "settings": { "repertoireIds": ["catalan-white"] },
  "entryCount": 900,
  "nextEntry": { "repertoireId": "catalan-white", "cardId": "..." }
}
```

`nextEntry` is enough to start a run because the complete repertoire contains the card, its chapter
path, answers, opponent replies, and resulting FENs. On phone-sized devices, one shared low-priority
background job downloads every repertoire and progress map into IndexedDB. That job continues after
the picker closes and while a drill is running, and retries on the next online event. Duplicate mounts
and readers share in-flight requests, so this offline-first behavior does not create duplicate catalog
downloads.

The persisted Today queue order itself remains server-owned. Cached repertoire lines can be drilled
offline, but advancing the mixed Today queue still requires the server to return its next entry.

## Day boundary

The frontend sends the browser's IANA time zone (for example, `Asia/Bangkok`) in the
`X-Chesslab-Time-Zone` request header. The backend resolves the queue date in that zone and stores
that explicit date with the queue. This avoids a UTC database server starting a new queue several
hours early or late for the user. Missing or invalid time zones safely fall back to UTC. The same
local-day rule is used by training analytics.
