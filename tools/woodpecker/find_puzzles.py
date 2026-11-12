import argparse, json
import chess


def material(board):
    counts = {}
    for piece in board.piece_map().values():
        counts.setdefault(piece.color, {}).setdefault(piece.piece_type, 0)
        counts[piece.color][piece.piece_type] += 1
    return counts


def matches(fen, allowed, required, min_pawns):
    board = chess.Board(fen)
    types = {p.piece_type for p in board.piece_map().values()}
    pawns = len(board.pieces(chess.PAWN, chess.WHITE)) + len(board.pieces(chess.PAWN, chess.BLACK))
    return types <= allowed and required <= types and pawns >= min_pawns


def main():
    cli = argparse.ArgumentParser(description="List Woodpecker puzzles whose only non-king material is the given piece types.")
    cli.add_argument("--book", default="backend/internal/woodpecker/book1.json")
    cli.add_argument("--min", type=int, default=1)
    cli.add_argument("--max", type=int, default=400)
    cli.add_argument("--pieces", default="rp", help="piece letters allowed besides kings (r, p, n, b, q)")
    cli.add_argument("--require", default="rp", help="piece letters that must be present")
    cli.add_argument("--min-pawns", type=int, default=1)
    args = cli.parse_args()
    to_type = lambda letters: {chess.Piece.from_symbol(c).piece_type for c in letters} | set()
    allowed = to_type(args.pieces) | {chess.KING}
    required = to_type(args.require)
    puzzles = json.load(open(args.book, encoding="utf-8"))
    found = [p for p in puzzles if args.min <= p["n"] <= args.max and matches(p["fen"], allowed, required, args.min_pawns)]
    for p in found:
        print(f"#{p['n']:<5} {p['toMove']:<6} {len(p['solutionSan'])} moves  {p['solutionSan'][0]:<8} {p['fen']}")
    print(f"{len(found)} puzzles")


if __name__ == "__main__":
    main()
