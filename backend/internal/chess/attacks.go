package chess

// IsAttacked reports whether sq is attacked by any piece belonging to `by`.
func IsAttacked(pos *Position, sq Square, by Color) bool {
	return pawnAttacks(pos, sq, by) ||
		knightAttacks(pos, sq, by) ||
		diagAttacks(pos, sq, by) ||
		lineAttacks(pos, sq, by) ||
		kingAttacks(pos, sq, by)
}

// InCheck reports whether color c's king is in check.
func InCheck(pos *Position, c Color) bool {
	k := pos.KingSquare(c)
	return k.Valid() && IsAttacked(pos, k, c.Opponent())
}

func pawnAttacks(pos *Position, sq Square, by Color) bool {
	f, r := sq.File(), sq.Rank()
	// from-rank: white pawns attack from the rank below, black from above
	fromRank := r - 1
	if by == Black {
		fromRank = r + 1
	}
	for _, df := range []int{-1, 1} {
		from := NewSquare(f+df, fromRank)
		if from.Valid() {
			p := pos.Board[from]
			if p != nil && p.Type == Pawn && p.Color == by {
				return true
			}
		}
	}
	return false
}

func knightAttacks(pos *Position, sq Square, by Color) bool {
	f, r := sq.File(), sq.Rank()
	for _, d := range [8][2]int{{1, 2}, {2, 1}, {2, -1}, {1, -2}, {-1, -2}, {-2, -1}, {-2, 1}, {-1, 2}} {
		from := NewSquare(f+d[0], r+d[1])
		if from.Valid() {
			p := pos.Board[from]
			if p != nil && p.Type == Knight && p.Color == by {
				return true
			}
		}
	}
	return false
}

func diagAttacks(pos *Position, sq Square, by Color) bool {
	f, r := sq.File(), sq.Rank()
	for _, d := range [4][2]int{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}} {
		cf, cr := f+d[0], r+d[1]
		for cf >= 0 && cf <= 7 && cr >= 0 && cr <= 7 {
			p := pos.Board[NewSquare(cf, cr)]
			if p != nil {
				if p.Color == by && (p.Type == Bishop || p.Type == Queen) {
					return true
				}
				break
			}
			cf += d[0]
			cr += d[1]
		}
	}
	return false
}

func lineAttacks(pos *Position, sq Square, by Color) bool {
	f, r := sq.File(), sq.Rank()
	for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		cf, cr := f+d[0], r+d[1]
		for cf >= 0 && cf <= 7 && cr >= 0 && cr <= 7 {
			p := pos.Board[NewSquare(cf, cr)]
			if p != nil {
				if p.Color == by && (p.Type == Rook || p.Type == Queen) {
					return true
				}
				break
			}
			cf += d[0]
			cr += d[1]
		}
	}
	return false
}

func kingAttacks(pos *Position, sq Square, by Color) bool {
	f, r := sq.File(), sq.Rank()
	for _, d := range [8][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}} {
		from := NewSquare(f+d[0], r+d[1])
		if from.Valid() {
			p := pos.Board[from]
			if p != nil && p.Type == King && p.Color == by {
				return true
			}
		}
	}
	return false
}
