import io, json, re, sys
import chess
import chess.pgn

def main(pgn_dir, ids_file, out_path):
    puzzles = {}
    for line in open(ids_file, encoding="utf8"):
        sid, name = line.strip().split(" ", 1)
        if "Woodpecker Method 2" in name:
            continue
        with open(f"{pgn_dir}/{sid}.pgn", encoding="utf8") as f:
            while True:
                g = chess.pgn.read_game(f)
                if g is None:
                    break
                m = re.search(r"(\d+)\s*$", g.headers.get("ChapterName", ""))
                if not m or "FEN" not in g.headers:
                    continue
                n = int(m.group(1))
                board = g.board()
                fen = board.fen()
                sans, ucis = [], []
                node = g
                while node.variations:
                    node = node.variations[0]
                    sans.append(board.san(node.move))
                    ucis.append(node.move.uci())
                    board.push(node.move)
                if n in puzzles:
                    print("duplicate", n, file=sys.stderr)
                puzzles[n] = {
                    "n": n,
                    "fen": fen,
                    "toMove": "white" if g.board().turn else "black",
                    "solutionSan": sans,
                    "solutionUci": ucis,
                    "source": g.headers.get("ChapterURL", ""),
                }
    out = [puzzles[k] for k in sorted(puzzles)]
    missing = [i for i in range(1, 1129) if i not in puzzles]
    empty = [p["n"] for p in out if not p["solutionUci"]]
    print("puzzles", len(out), "missing", missing, "no-solution", empty)
    with open(out_path, "w", encoding="utf8") as f:
        json.dump(out, f, indent=1)

if __name__ == "__main__":
    main(*sys.argv[1:4])
