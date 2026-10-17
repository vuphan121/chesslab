import json, sys, os, chess, chess.engine
from multiprocessing import Pool

SF = os.environ.get("STOCKFISH_PATH", "stockfish")
PATH = "backend/internal/woodpecker/book1.json"
DEPTH = 18
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material(b, color):
    s = 0
    for pt, v in VAL.items():
        s += v * (len(b.pieces(pt, color)) - len(b.pieces(pt, not color)))
    return s


def quiesce(b, color, alpha, beta, depth=8):
    stand = material(b, b.turn) if True else 0
    if depth == 0:
        return stand
    if stand >= beta:
        return stand
    alpha = max(alpha, stand)
    for m in b.legal_moves:
        if not (b.is_capture(m) or m.promotion):
            continue
        b.push(m)
        sc = -quiesce(b, color, -beta, -alpha, depth - 1)
        b.pop()
        if sc >= beta:
            return sc
        alpha = max(alpha, sc)
    return alpha


def settled(b, user):
    v = quiesce(b.copy(), user, -99, 99)
    return v if b.turn == user else -v


def line_from(eng, b, horizon_plies, stop_on_mate):
    out = []
    b = b.copy()
    while len(out) < horizon_plies and not b.is_game_over():
        info = eng.analyse(b, chess.engine.Limit(depth=DEPTH))
        pv = info.get("pv", [])
        if not pv:
            break
        for m in pv:
            if len(out) >= horizon_plies:
                break
            out.append(m.uci())
            b.push(m)
            if b.is_game_over():
                break
    return out, b


def work(args):
    p, eng_holder = args
    return None


_eng = None


def init():
    global _eng
    _eng = chess.engine.SimpleEngine.popen_uci(SF)
    _eng.configure({"Hash": 64, "Threads": 1})


def check(job):
    n, fen, sol, a = job
    user = chess.Board(fen).turn
    at = a["at"]
    b = chess.Board(fen)
    seen = {b.epd()}
    for u in sol[:at]:
        b.push_uci(u)
        seen.add(b.epd())
    book = chess.Board(fen)
    for u in sol:
        book.push_uci(u)
    book_mates = book.is_checkmate()
    remaining = len(sol) - at
    book_user_moves = (remaining + 1) // 2
    first = a["uci"][0]
    b.push_uci(first)
    if b.epd() in seen:
        return None
    seen.add(b.epd())
    horizon = remaining - 1
    if book_mates:
        info = _eng.analyse(b, chess.engine.Limit(depth=DEPTH))
        sc = info["score"].pov(user)
        if not sc.is_mate() or sc.mate() <= 0 or 1 + sc.mate() > book_user_moves + 3:
            return None
        horizon = 2 * sc.mate()
    line, end = line_from(_eng, b, horizon, book_mates)
    chk = chess.Board(fen)
    for u in sol[:at] + [first]:
        chk.push_uci(u)
    for u in line:
        chk.push_uci(u)
        if chk.epd() in seen:
            return None
        seen.add(chk.epd())
    if book_mates:
        if not chk.is_checkmate() or chk.turn == user:
            return None
    else:
        if chk.is_checkmate() and chk.turn == user:
            return None
        if settled(chk, user) < settled(book, user) - 1:
            return None
    return {"at": at, "uci": [first] + line}


def main():
    d = json.load(open(PATH, encoding="utf-8"))
    jobs = []
    for p in d:
        for a in p.get("alternatives", []):
            jobs.append((p["n"], p["fen"], p["solutionUci"], a))
    print(len(jobs), "candidates", flush=True)
    with Pool(12, initializer=init) as pool:
        res = pool.map(check, jobs, chunksize=8)
    by = {}
    for j, r in zip(jobs, res):
        if r:
            by.setdefault(j[0], []).append(r)
    kept = 0
    for p in d:
        alts = by.get(p["n"], [])
        kept += len(alts)
        if alts:
            p["alternatives"] = alts
        else:
            p.pop("alternatives", None)
    open(PATH, "w", encoding="utf-8", newline="\n").write(json.dumps(d, indent=1, ensure_ascii=False))
    print("kept", kept, "of", len(jobs))


if __name__ == "__main__":
    main()
