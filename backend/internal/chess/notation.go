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
		var needFile, needRank bool
		for _, lm := range lms {
			if lm.From == m.From || lm.To != m.To {
				continue
			}
			op := pos.Board[lm.From]
			if op == nil || op.Type != piece.Type || op.Color != piece.Color {
				continue
			}
			if lm.From.File() == m.From.File() {
				needRank = true
			} else {
				needFile = true
			}
		}
		if needFile {
			sb.WriteByte('a' + byte(m.From.File()))
		}
		if needRank {
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
