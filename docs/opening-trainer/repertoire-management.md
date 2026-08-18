# Repertoire management

Opening Study has a Manage control on its setup screen. Add a repertoire with a Lichess study URL, a name, and the side to drill. The server downloads the complete PGN export and runs it through the existing full-variation repertoire parser.

The managed study stores its source URL, export, and configuration in Postgres. Selecting Update on an existing Lichess-backed repertoire downloads the whole study again and rebuilds every chapter, variation, card, and opponent-reply pool from the start. This preserves newly added chapters without merging partial state.

Existing card-progress rows remain stored by repertoire ID and FEN-derived card ID. New lines start without progress; unchanged positions retain their progress.
