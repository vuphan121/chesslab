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

`nextEntry` is enough to start an online run because the complete repertoire contains the card, its
chapter path, answers, opponent replies, and resulting FENs. Phone-sized or coarse-pointer mobile devices additionally fetch
`GET /api/today-training/snapshot` once and store its full `{ queueDate, settings, entries }` queue in
IndexedDB. The same low-priority background job downloads every repertoire and progress map, continues
after the picker closes and while a drill is running, and retries on the next online event. Duplicate
mounts and readers share in-flight requests, so this offline-first behavior does not create duplicate
catalog downloads.

After a mobile line finishes, the cached entry moves to the back immediately and the next cached entry
can start without a network response. The advance is sent with a stable operation ID and the snapshot's
original queue date. Failed requests enter the same persistent IndexedDB outbox used for progress and
are replayed in order after reconnecting. The server records an operation ID in the same transaction as
the queue move, making an ambiguous retry safe: a response can be lost without moving the entry twice.
Progress saves and queue advances use discriminated outbox records, so either flusher ignores the other
kind of work. A pending advance prevents a server prefetch from replacing the locally rotated snapshot,
and cache write generations reject late responses that began before a newer local write. Reconnect
flushes keep draining work that is added while a flush is already running.

If the device remains offline across a calendar-day boundary, it keeps cycling the downloaded queue
rather than blocking training. On reconnect, pending operations are applied to their original dated
queue before the current day's server snapshot replaces the local copy.

## Day boundary

The frontend sends the browser's IANA time zone (for example, `Asia/Bangkok`) in the
`X-Chesslab-Time-Zone` request header. The backend resolves the queue date in that zone and stores
that explicit date with the queue. This avoids a UTC database server starting a new queue several
hours early or late for the user. Missing or invalid time zones safely fall back to UTC. The same
local-day rule is used by training analytics.
