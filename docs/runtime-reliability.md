# Runtime reliability

This document records the safeguards around the long-lived analysis server and its asynchronous
frontend requests.

## Game state and request ordering

- Every in-memory game has its own read/write lock. API mutations hold the write lock through the
  resulting response snapshot, while reads take the read lock. The store's map lock only protects
  the map itself; it is not used as a global game lock.
- Analysis and explorer requests include the exact FEN the user is viewing. The backend analyzes
  that FEN instead of re-reading whichever node happens to be current when the request is handled.
  Frontend request sequence numbers prevent an older response from replacing a newer position.
- Game-state JSON includes `gameOverReason` for checkmate, stalemate, the 50-move rule, and
  insufficient material.

## Analysis load

Successful analysis results are cached for ten minutes by FEN and analysis speed. Concurrent
identical requests share one cloud/Stockfish calculation. The cache is capped at 256 entries; the
existing short cloud-prefetch cache remains separate. This avoids repeated Stockfish work when the
same position is revisited without allowing the cache to grow indefinitely.

## Memory bounds

The game store retains at most 512 games. Games inactive for six hours are removed lazily whenever
the store is read or written, and the least recently used game is evicted when the cap is reached.
An evicted game returns the normal `404 game not found` response.

## HTTP and authentication limits

- Request bodies are capped at 4 MiB.
- A client address is allowed five failed login attempts per five-minute window. Further attempts
  receive `429 Too Many Requests` with `Retry-After`; a successful login clears the failures.
- The HTTP server applies header, read, write, idle, and maximum-header-size limits. The three-minute
  write timeout deliberately remains longer than the frontend's two-minute local-coach timeout.
- Browser time-zone values are validated against the embedded IANA database and fall back to UTC.

## Frontend and dependencies

Trainer progress is merged through atomic per-run increments rather than whole-snapshot overwrites.
Browser saves are ordered, retries carry a persistent operation ID, and the database records that ID
in the same transaction as progress and analytics. Today’s Training uses a per-user advisory lock
for queue changes and rejects stale automatic rebuilds. These guarantees apply across tabs, devices,
and multiple backend instances sharing Postgres.

Chess piece images load eagerly because the board is the page's primary visual content. Production
dependency audits should remain at zero npm findings and zero reachable/imported-package Go
findings (`npm audit` and `govulncheck ./...`). The current security baseline uses Next.js 16.3.5
or newer and chi 5.3.0 or newer. `x/crypto` currently carries a module-level advisory for its
deprecated `openpgp` package; Chesslab imports only `bcrypt`, and the scanner reports no affected
package or reachable symbol.
