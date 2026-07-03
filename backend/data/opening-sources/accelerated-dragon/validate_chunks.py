"""
Validates hand-chunked opening-theory chunks against the live Go backend.

For each chunk in chunks.json:
  1. Parse moveSequence (SAN) into a list of moves using python-chess (as a SAN
     parser/disambiguator only — legality truth comes from step 2, not this).
  2. Replay those moves against the actual running backend (localhost:8080) via
     POST /api/games + POST /api/games/{id}/moves. If the backend rejects any
     move, the chunk fails validation.
  3. On success, resolve the final position's ECO/opening name via the
     backend's /explorer endpoint (Lichess-backed) and record the canonical FEN.

Does NOT modify chunks.json. Writes:
  - chunks.validated.json  (only chunks that passed, annotated with fen/eco)
  - validation_report.json (per-chunk pass/fail detail for everything)
"""
import json
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import chess
import requests

BACKEND = "http://localhost:8080"
CHUNKS_PATH = r"D:\chesslab\backend\data\opening-sources\accelerated-dragon\chunks.json"
VALIDATED_PATH = r"D:\chesslab\backend\data\opening-sources\accelerated-dragon\chunks.validated.json"
REPORT_PATH = r"D:\chesslab\backend\data\opening-sources\accelerated-dragon\validation_report.json"


def tokenize_moves(move_sequence: str):
    text = move_sequence.replace("...", " ")
    tokens = []
    for tok in text.split():
        m = re.match(r"^\d+\.+(.*)$", tok)
        if m:
            rest = m.group(1)
            if rest:
                tokens.append(rest)
            continue
        if re.match(r"^\d+$", tok):
            continue
        tokens.append(tok)
    return tokens


def normalize_san(tok: str) -> str:
    tok = re.sub(r"[!?]+$", "", tok)
    tok = tok.replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    return tok


def parse_moves(move_sequence: str):
    board = chess.Board()
    uci_moves = []
    for raw_tok in tokenize_moves(move_sequence):
        tok = normalize_san(raw_tok)
        if not tok:
            continue
        try:
            move = board.parse_san(tok)
        except Exception as e:
            return None, f"SAN parse failed on '{raw_tok}' (normalized '{tok}'): {e}"
        uci_moves.append(move.uci())
        board.push(move)
    return uci_moves, None


def replay_on_backend(uci_moves):
    r = requests.post(f"{BACKEND}/api/games")
    r.raise_for_status()
    game = r.json()
    game_id = game["id"]
    fen = game["fen"]
    try:
        for uci in uci_moves:
            frm, to = uci[0:2], uci[2:4]
            promo = uci[4:5] if len(uci) > 4 else ""
            body = {"from": frm, "to": to}
            if promo:
                body["promotion"] = promo
            resp = requests.post(f"{BACKEND}/api/games/{game_id}/moves", json=body)
            if resp.status_code != 200:
                return None, game_id, f"backend rejected move {uci} ({frm}->{to}): HTTP {resp.status_code} {resp.text[:200]}"
            fen = resp.json()["fen"]
        return fen, game_id, None
    except Exception as e:
        return None, game_id, f"exception during replay: {e}"


def resolve_eco(game_id):
    try:
        r = requests.get(f"{BACKEND}/api/games/{game_id}/explorer")
        if r.status_code != 200:
            return None, None
        data = r.json()
        return data.get("openingEco"), data.get("openingName")
    except Exception:
        return None, None


def cleanup(game_id):
    try:
        requests.delete(f"{BACKEND}/api/games/{game_id}")
    except Exception:
        pass


def main():
    with open(CHUNKS_PATH, encoding="utf-8") as f:
        chunks = json.load(f)

    validated = []
    report = []

    for i, chunk in enumerate(chunks):
        move_seq = chunk["moveSequence"]
        uci_moves, err = parse_moves(move_seq)
        if err:
            report.append({"index": i, "source": chunk["source"], "moveSequence": move_seq, "status": "FAIL_PARSE", "reason": err})
            continue

        fen, game_id, err = replay_on_backend(uci_moves)
        if err:
            report.append({"index": i, "source": chunk["source"], "moveSequence": move_seq, "status": "FAIL_REPLAY", "reason": err})
            cleanup(game_id)
            continue

        eco, opening_name = resolve_eco(game_id)
        cleanup(game_id)

        validated_chunk = dict(chunk)
        validated_chunk["resolvedFen"] = fen
        validated_chunk["eco"] = eco
        validated_chunk["openingName"] = opening_name
        validated.append(validated_chunk)
        report.append({"index": i, "source": chunk["source"], "moveSequence": move_seq, "status": "PASS", "eco": eco})

        if (i + 1) % 25 == 0:
            print(f"...{i + 1}/{len(chunks)} processed")

    with open(VALIDATED_PATH, "w", encoding="utf-8") as f:
        json.dump(validated, f, indent=2, ensure_ascii=False)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    n_pass = sum(1 for r in report if r["status"] == "PASS")
    n_fail_parse = sum(1 for r in report if r["status"] == "FAIL_PARSE")
    n_fail_replay = sum(1 for r in report if r["status"] == "FAIL_REPLAY")
    print(f"\n{n_pass}/{len(chunks)} passed")
    print(f"{n_fail_parse} failed SAN parsing")
    print(f"{n_fail_replay} failed backend replay (illegal per Go engine)")
    print(f"\nWrote {VALIDATED_PATH}")
    print(f"Wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
