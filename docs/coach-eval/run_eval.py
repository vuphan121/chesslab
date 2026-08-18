"""
Coach evaluation harness.

Drives the running Go backend (:8080) + local LLM (Ollama) to produce a review
table of the AI coach's per-move output across:
  - Group A: positions that ARE in the opening-theory database (Accelerated
    Dragon corpus) — the explanation should lean on the book commentary.
  - Group B: positions NOT in the corpus, spanning move-quality buckets by how
    much the engine evaluation swings (negligible / slight / ~1 pawn / blunder),
    plus a gambit to show the book-aware override.

For each case it records the objective classification (computed with the SAME
win-probability formula and thresholds as backend/internal/coach/classify.go,
so the numbers match what the coach saw) and the coach's explanation text.

Writes docs/coach-eval/results.md.

Requires: backend on :8080 (with STOCKFISH_PATH + LICHESS_TOKEN), Ollama up,
and `pip install chess requests`.
"""
import json
import math
import os
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import chess
import requests

BASE = "http://localhost:8080"
ROOT = os.path.dirname(os.path.abspath(__file__))
CHUNKS_PATH = os.path.join(
    ROOT, "..", "..", "backend", "data", "opening-sources",
    "accelerated-dragon", "chunks.validated.json",
)
OUT_PATH = os.path.join(ROOT, "results.md")




def win_percent(cp, mate, mover_is_white):
    """Mover-perspective win% from white-relative engine score/mate."""
    sign = 1 if mover_is_white else -1
    m = mate * sign
    if m > 0:
        return 100.0
    if m < 0:
        return 0.0
    x = cp * sign
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * x)) - 1)


def category_from_lost(lost):
    if lost < 1:
        return "Best"
    if lost < 3.5:
        return "Excellent"
    if lost < 7:
        return "Good"
    if lost < 10:
        return "Inaccuracy"
    if lost < 20:
        return "Mistake"
    return "Blunder"


WORSE_THAN_GOOD = {"Inaccuracy", "Mistake", "Blunder"}
BOOK_ESTABLISHED_GAMES = 25


def book_status(games):
    if games >= BOOK_ESTABLISHED_GAMES:
        return "established"
    if games > 0:
        return "rare"
    return "novelty"


def book_category(engine_cat, status, in_corpus):
    established = status == "established" or in_corpus
    if established and engine_cat in WORSE_THAN_GOOD:
        return "Book"
    return engine_cat




def tokenize_moves(seq):
    text = seq.replace("...", " ")
    out = []
    for tok in text.split():
        m = re.match(r"^\d+\.+(.*)$", tok)
        if m:
            if m.group(1):
                out.append(m.group(1))
            continue
        if re.match(r"^\d+$", tok):
            continue
        out.append(tok)
    return out


def normalize_san(tok):
    tok = re.sub(r"[!?]+$", "", tok)
    return tok.replace("0-0-0", "O-O-O").replace("0-0", "O-O")


def san_line_to_moves(san_tokens):
    """Return (uci_moves, san_list) by replaying with python-chess."""
    board = chess.Board()
    uci, sans = [], []
    for raw in san_tokens:
        tok = normalize_san(raw)
        if not tok:
            continue
        mv = board.parse_san(tok)
        sans.append(board.san(mv))
        uci.append(mv.uci())
        board.push(mv)
    return uci, sans




def new_game():
    return requests.post(f"{BASE}/api/games").json()["id"]


def play(game_id, uci):
    body = {"from": uci[0:2], "to": uci[2:4]}
    if len(uci) > 4:
        body["promotion"] = uci[4:5]
    r = requests.post(f"{BASE}/api/games/{game_id}/moves", json=body)
    r.raise_for_status()
    return r.json()


def analysis(game_id):
    try:
        return requests.get(f"{BASE}/api/games/{game_id}/analysis", timeout=30).json()
    except Exception:
        return None


def explorer(game_id):
    try:
        r = requests.get(f"{BASE}/api/games/{game_id}/explorer", timeout=15)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def explain(game_id, fen, prev_fen, san, ana, exp):
    body = {"fen": fen, "prevFen": prev_fen, "lastMoveSan": san,
            "analysis": ana, "explorer": exp}
    r = requests.post(f"{BASE}/api/games/{game_id}/coach/explain", json=body, timeout=180)
    if r.status_code != 200:
        return f"[explain error HTTP {r.status_code}: {r.text[:200]}]"
    return r.json().get("explanation", "")


def score_of(ana):
    if not ana:
        return 0, 0, 0, "?"
    return ana.get("score", 0), ana.get("mate", 0), ana.get("depth", 0), ana.get("engineName", "?")




def run_case(case, chunks_by_fen):
    game = new_game()
    uci, sans = san_line_to_moves(case["san"])
    mover_is_white = (len(uci) % 2 == 1)


    for u in uci[:-1]:
        play(game, u)
    prev_state = requests.get(f"{BASE}/api/games/{game}").json()
    prev_fen = prev_state["fen"]
    before = analysis(game)
    b_cp, b_mate, _, _ = score_of(before)


    play(game, uci[-1])
    after_state = requests.get(f"{BASE}/api/games/{game}").json()
    fen = after_state["fen"]
    last_san = sans[-1]
    after = analysis(game)
    a_cp, a_mate, a_depth, engine = score_of(after)
    exp = explorer(game)
    games = exp["totalGames"] if exp else 0
    opening = (exp.get("openingName") if exp else None) or "-"

    wp_before = win_percent(b_cp, b_mate, mover_is_white)
    wp_after = win_percent(a_cp, a_mate, mover_is_white)
    lost = max(0.0, wp_before - wp_after)
    engine_cat = category_from_lost(lost)
    status = book_status(games)
    in_corpus = fen in chunks_by_fen
    final_cat = book_category(engine_cat, status, in_corpus)

    chunk_note = ""
    if in_corpus:
        c = chunks_by_fen[fen][0]
        chunk_note = f'{c["source"]["author"]}: "{c["commentaryText"][:160]}"'

    explanation = explain(game, fen, prev_fen, last_san, after, exp)
    requests.delete(f"{BASE}/api/games/{game}")

    return {
        "group": case["group"], "id": case["id"], "desc": case["desc"],
        "line": " ".join(sans), "move": last_san,
        "prevFen": prev_fen, "fen": fen,
        "evalBefore": f"{'#' if b_mate else ''}{b_mate or b_cp}",
        "evalAfter": f"{'#' if a_mate else ''}{a_mate or a_cp}",
        "engine": engine, "depth": a_depth,
        "winLost": round(lost, 1),
        "engineCat": engine_cat, "finalCat": final_cat,
        "bookStatus": status, "games": games, "opening": opening,
        "inCorpus": in_corpus, "chunk": chunk_note,
        "explanation": explanation.strip(),
    }


CASES = [




    {"group": "B", "id": "B1", "desc": "Negligible swing — main-line Ruy Lopez developing move (Be7)",
     "san": ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"]},
    {"group": "B", "id": "B2", "desc": "Slight swing — a small waiting move in the Italian (Kh8)",
     "san": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O", "Nbd2", "Kh8"]},
    {"group": "B", "id": "B3", "desc": "Inaccuracy by eval, but still established theory -> Book override (Bd6)",
     "san": ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Bd6"]},
    {"group": "B", "id": "B4", "desc": "~1 pawn swing — clean Mistake, rarely played so NOT book-overridden (b5)",
     "san": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O", "Nbd2", "b5"]},
    {"group": "B", "id": "B5", "desc": "Blunder — loses a piece (Nxe4, no compensation)",
     "san": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O", "Nbd2", "Nxe4"]},
    {"group": "B", "id": "B6", "desc": "Blunder — hangs the queen outright (Qg4)",
     "san": ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "O-O", "d6", "Nc3", "O-O", "Bg5", "Qd7", "Nd5", "Qg4"]},
    {"group": "B", "id": "B7", "desc": "Gambit — engine actually likes it (King's Gambit, 2.f4)",
     "san": ["e4", "e5", "f4"]},
    {"group": "B", "id": "B8", "desc": "Gambit — engine dislikes it but book override keeps it playable (Latvian, 2...f5)",
     "san": ["e4", "e5", "Nf3", "f5"]},
]


def build_group_a(chunks):
    """Pick corpus chunks with real prose and turn them into A-cases."""
    picks = []
    seen = set()
    for c in chunks:
        seq = c["moveSequence"]

        if len(c["commentaryText"]) < 60:
            continue
        toks = tokenize_moves(seq)
        if len(toks) < 6:
            continue
        try:
            _, sans = san_line_to_moves([normalize_san(t) for t in toks])
        except Exception:
            continue
        key = c["resolvedFen"]
        if key in seen:
            continue
        seen.add(key)
        picks.append({
            "group": "A", "id": f"A{len(picks)+1}",
            "desc": f'In corpus — {c["source"]["author"]}',
            "san": [normalize_san(t) for t in toks],
        })
        if len(picks) == 3:
            break
    return picks


def md_escape(s):
    return s.replace("|", "\\|").replace("\n", " ").strip()


def main():
    with open(CHUNKS_PATH, encoding="utf-8") as f:
        chunks = json.load(f)
    by_fen = {}
    for c in chunks:
        by_fen.setdefault(c["resolvedFen"], []).append(c)

    cases = build_group_a(chunks) + CASES

    results = []
    for i, case in enumerate(cases):
        print(f"[{i+1}/{len(cases)}] {case['id']} {case['desc']} ...", flush=True)
        try:
            results.append(run_case(case, by_fen))
        except Exception as e:
            print(f"   FAILED: {e}", flush=True)

    write_report(results)
    print(f"\nWrote {OUT_PATH}")


def write_report(results):
    lines = []
    lines.append("# AI Coach — evaluation run\n")
    lines.append("Auto-generated by `docs/coach-eval/run_eval.py` against the live backend + local "
                 "`llama3.1:8b`. The classification columns are computed with the same win-probability "
                 "formula/thresholds as `backend/internal/coach/classify.go`, so they match what the "
                 "coach was given. **The explanation text is the model output to evaluate.**\n")
    lines.append("Categories: win% lost <1 Best · <3.5 Excellent · <7 Good · <10 Inaccuracy · "
                 "<20 Mistake · ≥20 Blunder. `final` becomes **Book** when the move is established "
                 "theory the engine dislikes (gambits).\n")


    lines.append("## Summary\n")
    lines.append("| # | Group | Move | eval before→after (cp, White+) | win% lost | engine | final | book status (games) | in corpus |")
    lines.append("|---|-------|------|--------------------------------|-----------|--------|-------|---------------------|-----------|")
    for r in results:
        lines.append(
            f"| {r['id']} | {r['group']} | {md_escape(r['move'])} | "
            f"{r['evalBefore']} → {r['evalAfter']} | {r['winLost']} | {r['engineCat']} | "
            f"**{r['finalCat']}** | {r['bookStatus']} ({r['games']}) | {'yes' if r['inCorpus'] else 'no'} |")
    lines.append("")


    lines.append("## Details\n")
    for r in results:
        lines.append(f"### {r['id']} — {md_escape(r['desc'])}\n")
        lines.append(f"- **Line:** `{md_escape(r['line'])}`")
        lines.append(f"- **Move played:** {r['move']}  ·  **engine:** {r['engine']} (depth {r['depth']})")
        lines.append(f"- **Eval (White+):** {r['evalBefore']} → {r['evalAfter']} cp  ·  "
                     f"**win% lost:** {r['winLost']}")
        lines.append(f"- **Verdict:** engine `{r['engineCat']}` → final **{r['finalCat']}**  ·  "
                     f"book {r['bookStatus']} ({r['games']} games, opening: {md_escape(r['opening'])})")
        if r["chunk"]:
            lines.append(f"- **Book commentary the coach had:** {md_escape(r['chunk'])}")
        lines.append(f"- **FEN after:** `{r['fen']}`")
        lines.append(f"\n> **Coach explanation:** {md_escape(r['explanation'])}\n")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    main()
