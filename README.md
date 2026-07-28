# Chesslab

**An AI-powered chess opening trainer** — a real-time analysis board backed by Stockfish and a local
LLM coach, paired with a spaced-repetition drilling tool that turns a Lichess study into a
repertoire you actually remember.

[![Go](https://img.shields.io/badge/backend-Go-00ADD8?logo=go&logoColor=white)](backend)
[![Next.js](https://img.shields.io/badge/frontend-Next.js-000000?logo=nextdotjs&logoColor=white)](frontend)
[![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)](frontend)
[![Stockfish](https://img.shields.io/badge/engine-Stockfish%2018-769656)](https://stockfishchess.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Contents

- [What it does](#what-it-does)
- [Analysis Board](#analysis-board)
- [AI Coach](#ai-coach)
- [Opening Study (spaced-repetition trainer)](#opening-study-spaced-repetition-trainer)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Deployment](#deployment)
- [License](#license)

## What it does

Chesslab is two tools sharing one Go chess engine and one login:

| | |
|---|---|
| **Analysis Board** (`/`) | A Lichess-style opening database + Stockfish analysis board, with move-tree navigation (sidelines included) and an AI coach that explains *this* position, grounded in real engine and book data — not a chatbot guessing at chess. |
| **Opening Study** (`/opening-study`) | Feed it a Lichess study URL and it becomes a spaced-repetition drilling deck: play your repertoire from memory, get corrected instantly, and let a Leitner-style scheduler decide what you see next. |

Everything below the UI is real: legal-move generation, check/mate/stalemate detection, SAN
notation with disambiguation, and move trees with non-destructive sideline navigation are all
hand-written in Go — no chess.js, no python-chess. Stockfish and Lichess's public APIs do the
engine work; a local LLM (via Ollama) does the explaining.

## Analysis Board

A three-column workspace — **Coach | Board | Move order** — around a custom chess.com-styled board.

- **Full legal-move chess engine**, written from scratch in Go: castling (both sides), en passant,
  promotion, check/checkmate/stalemate, the 50-move rule, and insufficient-material draws. Legality
  is computed by applying every pseudo-legal move and checking the resulting king safety, which
  handles pins and discovered checks for free instead of special-casing them.
- **Move tree, not a move list.** Every game is a tree of positions. Navigating backward never
  discards a move; playing a different move from an earlier point creates a sideline instead of
  overwriting history. The move list renders Lichess-style — one row per full move, figurine
  notation, per-move evaluation — with sidelines nested inline.
- **Stockfish 18 + Lichess cloud eval.** Every position is analyzed by Lichess's precomputed
  cloud-eval API first (deep, instant, no auth needed), falling back to a local Stockfish subprocess
  when the position isn't cached. An eval bar and a live depth/score readout sit next to the board.
- **Live Opening Explorer.** Real games-played / win-rate / draw-rate stats from Lichess's database
  (2000+ rated players) for the current position, with each candidate move's own named opening —
  click a row to play it.
- **Drag-and-drop and click-to-move**, chess.com-style right-click arrows and circles, PGN paste
  (discards the board and replays from scratch — a partial/illegal paste loads whatever prefix
  parsed cleanly), and keyboard move navigation.

## AI Coach

Grounded chess coaching, not free-associated chatbot chess. A local LLM (Ollama + `llama3.1:8b` by
default — **no Anthropic API key, no cloud LLM cost**) writes the prose, but it never invents a
chess fact: every claim it makes is backed by Stockfish, Lichess, or a curated, engine-validated
opening-theory corpus.

**Two ways to ask:**

- **"Ask Coach"** — a one-click, grounded explanation of the move just played. It retrieves book
  commentary for the *exact* position from a hand-chunked, engine-validated theory corpus, runs a
  rule-based move-quality classifier, and folds in the live engine eval and Opening Explorer data —
  then hands all of it to the LLM to turn into readable prose. Re-frames itself if you flip the
  board, addressing whichever side you're studying as "you," never claiming a move was played that
  wasn't.
- **Freeform chat** — an agentic tool-calling loop with six tools: analyze any position, pull live
  Opening Explorer stats, retrieve position-specific theory or opening-level context ("what's the
  idea behind this opening?"), classify a move's quality, or evaluate a hypothetical ("from here,
  can I play Nf3?").

**The move classifier is book-aware, not just eval-based** — a real gambit (King's, Evans,
Smith-Morra, Latvian...) deliberately gives up material for initiative, so grading it on raw engine
eval alone would mislabel established theory as a blunder. The classifier checks the Opening
Explorer for how often a move has actually been played by strong players and overrides the verdict
accordingly: an established sacrifice reads as "Book," not "Mistake," while a genuine novelty is
flagged as uncharted rather than automatically bad.

## Opening Study (spaced-repetition trainer)

Point it at a Lichess study export and it becomes a drilling deck, Chessbook/Lotus-style.

- **Parses a full multi-chapter study PGN** into a repertoire: every chapter's own custom start
  position, every variation preserved as a real tree (not just the mainline), with inferior lines
  the study itself annotated as `?`/`??` — or explicitly listed in a sidecar config — excluded from
  drilling entirely, subtree and all.
- **Leitner-box scheduler**, pure and fully unit-tested: promotion gaps widen on a correct answer,
  a lapse permanently shortens the gap for that card (not just the next rep), and every card is
  eligible from the first session — no artificial "new card" throttling.
- **Play it, don't just review it.** Each drill replays the position on a real board; a wrong answer
  shows the expected move and any study commentary, then undoes and re-prompts until you find it.
  A correct answer plays the opponent's most-often-missed reply and keeps going deeper into the
  line — or lets you jump straight into the full Analysis Board (engine, coach, explorer, everything
  the trainer itself hides so it doesn't give away the answer) to study the line you just played.
- **Progress follows you.** A single login gates the whole app, and drilling progress (per-card box,
  lapse count, accuracy) syncs to Postgres instead of living only in one browser — pick up a session
  on a different device and the scheduler already knows what you know.

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        FE["Next.js frontend<br/>(React, TypeScript)"]
    end

    subgraph Server["Go backend"]
        API["chi REST API"]
        ENGINE["Hand-written chess engine<br/>(movegen, SAN, move tree)"]
        COACH["AI coach<br/>(grounded prompt + tool-calling agent)"]
        REP["Repertoire parser<br/>(study PGN -> drill cards)"]
    end

    SF["Stockfish 18<br/>(subprocess, UCI)"]
    LICHESS["Lichess public APIs<br/>(cloud eval + opening explorer)"]
    OLLAMA["Ollama<br/>(local LLM, llama3.1:8b)"]
    PG[("Postgres<br/>(auth + trainer progress)")]

    FE <--> API
    API --> ENGINE
    API --> COACH
    API --> REP
    ENGINE --> SF
    API --> LICHESS
    COACH --> OLLAMA
    API --> PG
```

Both features share the same Go chess engine and the same login — there's no duplicated chess logic
between the Analysis Board and the trainer, and no chess logic at all on the frontend. FEN is the
universal position identifier passed between them.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Go, [chi](https://github.com/go-chi/chi) router, no other framework |
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Chess engine | Hand-written in Go — movegen, FEN, SAN, move tree, PGN parsing |
| Position analysis | Stockfish 18 (subprocess/UCI) + Lichess cloud-eval API |
| Opening data | Lichess Opening Explorer API |
| AI coach LLM | Ollama, OpenAI-compatible `/v1/chat/completions`, default `llama3.1:8b` |
| Auth | Single-login JWT (`golang-jwt`), bcrypt-hashed credential in Postgres |
| Persistence | Postgres (trainer progress + drilling analytics) — optional, degrades gracefully |
| Deployment | Render Blueprint (`render.yaml`) — Go+Stockfish in Docker, Next.js as a Node service |

## Getting started

### Prerequisites

- **Go** 1.21+ and **Node.js** 18+
- **Stockfish** — a binary on your `PATH`, or point `STOCKFISH_PATH` at one directly
- Optional: a free [Lichess API token](https://lichess.org/account/oauth/token) (powers the Opening
  Explorer panel — without it, everything else still works)
- Optional: [Ollama](https://ollama.com/) with `llama3.1:8b` pulled (powers the AI coach — without
  it, everything else still works)
- Optional: a Postgres database (Neon works well) for cross-device trainer progress sync — without
  it, the trainer still works, it just won't remember progress between sessions

None of the optional pieces block startup — each missing dependency degrades that one feature to a
clear error response instead of failing the whole app.

### 1. Clone and configure the backend

```bash
git clone https://github.com/vuphan121/chesslab.git
cd chesslab/backend
cp .env.example .env
```

Edit `.env` and set at minimum `AUTH_USERNAME`/`AUTH_PASSWORD` — the server refuses to start without
them, since they gate the whole site. Everything else in `.env.example` is optional; see
[Configuration](#configuration).

### 2. Run the backend

```bash
go run ./cmd/server/
```

Listens on `:8080`. On first boot with `DATABASE_URL` set, it also migrates the schema and seeds
your login credential into Postgres.

### 3. Run the frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), log in with the credentials from step 1, and
you're in.

## Configuration

**Backend** (`backend/.env`, see `backend/.env.example` for the full annotated list):

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_USERNAME`, `AUTH_PASSWORD` | **Yes** | The single login gating the whole app |
| `STOCKFISH_PATH` | No (default `stockfish`) | Path to the Stockfish binary |
| `LICHESS_TOKEN` | No | Enables the Opening Explorer panel |
| `DATABASE_URL` | No | Enables cross-device trainer progress sync + analytics (Postgres) |
| `JWT_SECRET` | No (random at boot) | Set explicitly in production so tokens survive a redeploy |
| `OLLAMA_BASE_URL`, `COACH_MODEL` | No | Point the AI coach at a non-default Ollama instance/model |
| `ALLOWED_ORIGIN` | No (default `*`) | Restrict CORS to your deployed frontend in production |

**Frontend** (`frontend/.env.local`, see `frontend/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | No (default `http://localhost:8080`) | Backend API origin |

## Testing

```bash
# Backend — chess engine, repertoire parser, AI coach classifier, all unit-tested
cd backend && go test ./...

# Frontend — the spaced-repetition scheduler (pure logic, no chess knowledge)
cd frontend && npm run test

# Type check
cd frontend && npx tsc --noEmit
```

## Project layout

```
chesslab/
  backend/    # Go REST API — chess engine, Stockfish/Lichess integration, AI coach, repertoire parser
  frontend/   # Next.js app — Analysis Board + Opening Study pages
  docs/       # Design docs: AI coach architecture, opening-trainer data formats/scheduler/API
  render.yaml # Render Blueprint for deployment
```

## Deployment

`render.yaml` deploys two services on [Render](https://render.com): the Go backend (with Stockfish,
via Docker) and the Next.js frontend (as a Node web service). The AI coach is intentionally not part
of the deployed stack — there's no hosted Ollama instance — so `/coach/*` endpoints return 503 in
production while the rest of the app (board, engine analysis, opening explorer, opening trainer) is
fully functional. See `backend/.env.example` and `frontend/.env.example` for what each service
needs.

## License

[MIT](LICENSE)
