import json, sys
import chess, chess.engine

path, sf = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf8"))
eng = chess.engine.SimpleEngine.popen_uci(sf)
for p in data:
    if p["solutionUci"]:
        continue
    b = chess.Board(p["fen"])
    info = eng.analyse(b, chess.engine.Limit(depth=24), multipv=2)
    top = info[0]
    gap = None
    if len(info) > 1:
        a, c = top["score"].white(), info[1]["score"].white()
        gap = [str(a), str(c)]
    pv = top["pv"][:7]
    if len(pv) % 2 == 0:
        pv = pv[:-1]
    sans, ucis = [], []
    for m in pv:
        sans.append(b.san(m)); ucis.append(m.uci()); b.push(m)
    p["solutionSan"], p["solutionUci"] = sans, ucis
    p["solutionSource"] = "stockfish"
    print(p["n"], str(top["score"].white()), gap, " ".join(sans))
eng.quit()
json.dump(data, open(path, "w", encoding="utf8"), indent=1)
