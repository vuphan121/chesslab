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
  client address is resolved by `loginClientKey` (`backend/internal/api/login_limiter.go`): it prefers
  `CF-Connecting-IP`/`True-Client-IP` when present (set authoritatively by a fronting Cloudflare edge,
  not spoofable by the caller), falling back to the right-most `X-Forwarded-For` entry — never the
  left-most, which is caller-controlled and would make the whole limiter a no-op. That XFF fallback
  assumes exactly one trusted proxy hop in front of this app; that assumption has **not** been
  empirically verified against the live Render deployment (see the comment in `loginClientKey` itself).
- The HTTP server applies header, read, write, idle, and maximum-header-size limits. The three-minute
  write timeout is kept generous for the cron endpoints.
- Browser time-zone values are validated against the embedded IANA database and fall back to UTC.

## Frontend and dependencies

Trainer progress is merged through atomic per-run increments rather than whole-snapshot overwrites.
Browser saves are ordered, retries carry a persistent operation ID, and the database records that ID
in the same transaction as progress and analytics. Today’s Training uses a per-user advisory lock
for queue changes and rejects stale automatic rebuilds. These guarantees apply across tabs, devices,
and multiple backend instances sharing Postgres.

On phones, `OfflineSync` owns a singleton idle-scheduled catalog prefetch that downloads every
repertoire and progress map and keeps running while Opening Study is active. `networkFirst` and
`cacheFirst` share one in-flight operation per cache key. A timed-out cached read detaches the stuck
operation so a later caller can retry. IndexedDB ownership changes only after the previous user’s
store has been successfully cleared. User settings render from defaults immediately and update from
cache/network asynchronously, avoiding a blank authenticated screen during a cold request.

Board annotations, drag state, and promotion state are keyed to the current FEN and transition
through one reducer, so a position change resets them atomically without render-time state updates.
Move navigation animation uses the browser animation API and preserves the optimistic user-move path.

Chess piece images load eagerly because the board is the page's primary visual content. Production
dependency audits should remain at zero npm findings and zero reachable/imported-package Go
findings (`npm audit` and `govulncheck ./...`). The current security baseline uses Next.js 16.3.5
or newer and chi 5.3.0 or newer. `x/crypto` currently carries a module-level advisory for its
deprecated `openpgp` package; Chesslab imports only `bcrypt`, and the scanner reports no affected
package or reachable symbol.
