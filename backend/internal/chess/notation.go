package chess

import "strings"

var sanPieceChar = map[PieceType]byte{
	Knight: 'N', Bishop: 'B', Rook: 'R', Queen: 'Q', King: 'K',
}

func SAN(pos *Position, m Move) string {
	if m.Flag == CastleKS {
		return suffix("O-O", pos, m)
	}
	if m.Flag == CastleQS {
		return suffix("O-O-O", pos, m)
	}

	piece := pos.Board[m.From]
	var sb strings.Builder

	if piece.Type != Pawn {
		sb.WriteByte(sanPieceChar[piece.Type])
	}

	if piece.Type != Pawn {
		lms := GenerateLegalMoves(pos)
		// Standard SAN disambiguation precedence: file alone if no competitor
		// shares it, else rank alone if no competitor shares that, else both.
		// Deciding needFile/needRank independently per competitor (the old
		// approach) over-qualifies as soon as 3+ same-type pieces converge on
		// one square with a mixed file/rank overlap — see notation_test.go.
		var sameFile, sameRank, hasCompetitor bool
		for _, lm := range lms {
			if lm.From == m.From || lm.To != m.To {
				continue
			}
			op := pos.Board[lm.From]
			if op == nil || op.Type != piece.Type || op.Color != piece.Color {
				continue
			}
			hasCompetitor = true
			if lm.From.File() == m.From.File() {
				sameFile = true
			}
			if lm.From.Rank() == m.From.Rank() {
				sameRank = true
			}
		}
		switch {
		case !hasCompetitor:
			// no disambiguation needed
		case !sameFile:
			sb.WriteByte('a' + byte(m.From.File()))
		case !sameRank:
			sb.WriteByte('1' + byte(m.From.Rank()))
		default:
			sb.WriteByte('a' + byte(m.From.File()))
			sb.WriteByte('1' + byte(m.From.Rank()))
		}
	}

	isCapture := pos.Board[m.To] != nil || m.Flag == EnPassant
	if piece.Type == Pawn && isCapture {
		sb.WriteByte('a' + byte(m.From.File()))
	}
	if isCapture {
		sb.WriteByte('x')
	}

	sb.WriteString(m.To.String())

	if m.IsPromotion() {
		sb.WriteByte('=')
		sb.WriteByte(sanPieceChar[m.PromotionPiece()])
	}

	return suffix(sb.String(), pos, m)
}

func suffix(base string, pos *Position, m Move) string {
	next := applyMove(pos, m)
	if !InCheck(next, next.Turn) {
		return base
	}
	if len(GenerateLegalMoves(next)) == 0 {
		return base + "#"
	}
	return base + "+"
}

func MovesToSANAndFENs(pos *Position, uciMoves []string) (sans []string, fens []string) {
	cur := pos
	for _, uci := range uciMoves {
		if len(uci) < 4 {
			break
		}
		from := ParseSquare(uci[:2])
		to := ParseSquare(uci[2:4])
		if !from.Valid() || !to.Valid() {
			break
		}
		to = normalizeChess960Castle(cur, from, to)
		var matched Move
		found := false
		for _, lm := range GenerateLegalMoves(cur) {
			if lm.From != from || lm.To != to {
				continue
			}
			if lm.IsPromotion() {
				var pp PieceType
				if len(uci) >= 5 {
					pp = ParsePieceType(uci[4])
				} else {
					pp = Queen
				}
				if lm.PromotionPiece() != pp {
					continue
				}
			}
			matched = lm
			found = true
			break
		}
		if !found {
			break
		}
		sans = append(sans, SAN(cur, matched))
		cur = applyMove(cur, matched)
		fens = append(fens, FEN(cur))
	}
	return
}

func MovesToSAN(pos *Position, uciMoves []string) []string {
	sans, _ := MovesToSANAndFENs(pos, uciMoves)
	return sans
}

// normalizeChess960Castle remaps Lichess cloud-eval's (and some
// Chess960-aware UCI engines') castling encoding — the king "moving onto"
// its own rook's home square (e1h1/e1a1/e8h8/e8a8 for O-O/O-O-O) — to the
// real king destination (g1/c1/g8/c8) our move generator produces, since
// GenerateLegalMoves never emits a king move further than one square. A
// king move landing on the a- or h-file from anywhere else on its home rank
// is otherwise impossible in a single legal move (a king only steps one
// square), so this can never misfire on a genuine non-castling move — it
// was a real bug: cloud-eval's own top-ranked move is very often "castle
// now" early in an opening, and matching it against the a/h-file square
// literally always failed, silently producing an empty SAN (and, worse, a
// UI arrow drawn to the wrong square) for exactly the positions where
// castling is the best move.
func normalizeChess960Castle(pos *Position, from, to Square) Square {
	piece := pos.Board[from]
	if piece == nil || piece.Type != King || from.Rank() != to.Rank() {
		return to
	}
	switch to.File() {
	case 7:
		return NewSquare(6, to.Rank()) // g-file: kingside
	case 0:
		return NewSquare(2, to.Rank()) // c-file: queenside
	default:
		return to
	}
}
