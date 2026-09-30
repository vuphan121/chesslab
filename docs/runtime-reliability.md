# Runtime reliability

This document records the safeguards around the long-lived server and its asynchronous frontend requests.

## Game state and analysis (moved to the browser, 2026-09-29)

The backend no longer holds games or runs interactive analysis. The Analysis Board and Study from Book keep the
move tree in the browser (`lib/chess/localGame.ts`, chess.js), so there is no per-game lock, request ordering
or game-store memory bound to maintain. Stockfish runs in a Web Worker, and Lichess cloud-eval, the tablebase
and the opening explorer are called directly from the page with per-position caches and in-flight
de-duplication (`lib/lichess/`). The explorer needs the Lichess token, which the backend hands to a signed-in
session through `GET /api/lichess-token`. The server-side Stockfish process now exists only for the eval
precompute (`internal/evalprecompute`).

The local game keeps an ID-to-node index for constant-time navigation. Public move-tree snapshots use
immutable structural sharing: adding or deleting a variation rebuilds only that node's ancestor path,
so previously captured snapshots remain stable without cloning the complete tree after every action.
The browser game enforces terminal positions, including legal threefold repetition keys and the
halfmove-clock-sensitive 50-move rule.

Lichess lookups use subscriber-counted in-flight requests. Leaving a position releases that caller;
the underlying fetch is aborted only when no remaining consumer needs it, so deduplication and real
network cancellation coexist. Cloud/tablebase evaluation keys use the first five FEN fields: the
halfmove clock is preserved for 50-move-rule correctness while the irrelevant fullmove number is
discarded. A wider in-flight MultiPV request can serve a narrower subscriber. Opening Explorer cache
keys use the first four FEN fields because move clocks do not affect its result. Move-tree indexes are
memoized by immutable root, and active paths are collected then reversed instead of repeatedly
prepending. Move-history cloud results are committed to React in batches, and
local Stockfish fallback evaluations are serialized behind the foreground engine.

Bulk persisted evaluations use `POST /api/position-evals` with `{ "fens": [...] }`, avoiding URL-size
limits. Positions are queried once by their clock-stripped database key, while the response maps the
result back to every full FEN requested by the browser.

## HTTP and authentication limits

- Request bodies are capped at 4 MiB.
- A client address is allowed five failed login attempts per five-minute window. Further attempts
  receive `429 Too Many Requests` with `Retry-After`; a successful login clears the failures. The
  client address normally comes from the direct TCP peer. `TRUST_PROXY_HEADERS=true` opts a deployment
  behind a managed reverse proxy into `CF-Connecting-IP`, `True-Client-IP`, and the right-most
  `X-Forwarded-For` entry. It is enabled in the Render blueprint, but stays off for local/direct
  deployments so a caller cannot evade the limiter with a forged forwarding header.
- The HTTP server applies header, read, write, idle, and maximum-header-size limits. The three-minute
  write timeout is kept generous for the cron endpoints.
- Browser time-zone values are validated against the embedded IANA database and fall back to UTC.

## Frontend and dependencies

Trainer progress is merged through atomic per-run increments rather than whole-snapshot overwrites.
Browser saves are ordered, retries carry a persistent operation ID, and the database records that ID
in the same transaction as progress and analytics. Today’s Training uses a per-user advisory lock
for queue changes and rejects stale automatic rebuilds. Mobile queue advances also carry a persistent
operation ID and their original queue date; the operation and queue move commit together, so reconnect
retries cannot rotate an entry twice or alter a new day's queue. These guarantees apply across tabs,
devices, and multiple backend instances sharing Postgres. Dated queue rows and their operation IDs are
pruned by the existing retention sweep so the daily snapshots do not grow without bound.

On phone-sized or coarse-pointer mobile devices, `OfflineSync` owns a singleton idle-scheduled catalog prefetch that downloads every
repertoire, progress map, and the complete dated Today queue, and keeps running while Opening Study is
active. Completed Today entries rotate in IndexedDB immediately; failed server advances remain in a
typed persistent outbox and sync before the server snapshot is refreshed. Both outbox flushers keep
draining records added while a flush is active. `networkFirst` and `cacheFirst` share one in-flight
operation per cache key. Cache write generations prevent an older network response from replacing a
newer local rotation or refresh; a timed-out cached read detaches only its own registry slot so a later
caller can retry safely. IndexedDB ownership changes only after the previous user’s store has been
successfully cleared; old-account in-flight reads are invalidated, and login fails closed if that
clear cannot be completed. User settings render
from defaults immediately and update from cache/network asynchronously, avoiding a blank authenticated
screen during a cold request. The service worker removes the previous versioned caches on activation
and bounds unreferenced hashed Next.js assets while retaining a grace set for concurrent page refreshes.

Board annotations, drag state, and promotion state are keyed to the current FEN and transition
through one reducer, so a position change resets them atomically without render-time state updates.
Move navigation animation uses the browser animation API and preserves the optimistic user-move path.

Chess piece images load eagerly because the board is the page's primary visual content. Production
dependency audits should remain at zero npm findings and zero reachable/imported-package Go
findings (`npm audit` and `govulncheck ./...`). The current security baseline uses Next.js 16.3.5
or newer and chi 5.3.0 or newer. `x/crypto` currently carries a module-level advisory for its
deprecated `openpgp` package; Chesslab imports only `bcrypt`, and the scanner reports no affected
package or reachable symbol.
