# managed-repertoires

Config sidecars for **DB-managed** opening-trainer repertoires. Unlike
`../repertoires/` (loaded from `*.pgn` on every boot), these are stored in the
`repertoire_sources` Postgres table and are the source of truth.

Each `<id>.config.json` is a `repertoire.Config`:

```json
{
  "id": "trompowsky",
  "name": "Trompowsky",
  "side": "b",
  "source": "https://lichess.org/study/gGYpOH20",
  "description": "...",
  "excluded": [{ "chapter": "...", "path": ["a4"], "reason": "..." }]
}
```

To seed / update the database from these files:

```bash
DATABASE_URL=<target> go run ./cmd/seedrepertoires
```

It fetches each study's PGN from Lichess fresh, `ParseAndBuild`-validates it, and
upserts `{id, source_url, pgn, config}`. The server's `loadManagedRepertoires`
replays these rows at boot, overriding any file-based repertoire of the same `id`.
`LICHESS_TOKEN` is optional — public studies export anonymously, and a token that
lacks the `study:read` scope is retried without auth.

The in-app "Manage repertoires" screen writes to the same table directly (no
redeploy needed); these committed sidecars just make a seed reproducible.
