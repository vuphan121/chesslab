package chess

func GenerateLegalMoves(pos *Position) []Move {
	pseudo := generatePseudo(pos)
	legal := pseudo[:0]
	for _, m := range pseudo {
		next := applyMove(pos, m)
		if !InCheck(next, pos.Turn) {
			legal = append(legal, m)
		}
	}
	return legal
}

func LegalMovesFrom(pos *Position, from Square) []Move {
	var out []Move
	for _, m := range GenerateLegalMoves(pos) {
		if m.From == from {
			out = append(out, m)
		}
	}
	return out
}

func generatePseudo(pos *Position) []Move {
	var moves []Move
	for sq := Square(0); sq <= 63; sq++ {
		p := pos.Board[sq]
		if p == nil || p.Color != pos.Turn {
			continue
		}
		switch p.Type {
		case Pawn:
			moves = append(moves, pawnMoves(pos, sq)...)
		case Knight:
			moves = append(moves, knightMoves(pos, sq)...)
		case Bishop:
			moves = append(moves, slidingMoves(pos, sq, [][2]int{{1, 1}, {1, -1}, {-1, 1}, {-1, -1}})...)
		case Rook:
			moves = append(moves, slidingMoves(pos, sq, [][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}})...)
		case Queen:
			moves = append(moves, slidingMoves(pos, sq, [][2]int{
				{1, 0}, {-1, 0}, {0, 1}, {0, -1},
				{1, 1}, {1, -1}, {-1, 1}, {-1, -1},
			})...)
		case King:
			moves = append(moves, kingMoves(pos, sq)...)
		}
	}
	return moves
}

func pawnMoves(pos *Position, from Square) []Move {
	var moves []Move
	f, r := from.File(), from.Rank()
	c := pos.Board[from].Color

	dir := 1
	startRank := 1
	promoRank := 7
	if c == Black {
		dir = -1
		startRank = 6
		promoRank = 0
	}

	addPawn := func(to Square, flag MoveFlag) {
		if to.Rank() == promoRank {
			moves = append(moves,
				Move{from, to, PromoQ},
				Move{from, to, PromoR},
				Move{from, to, PromoB},
				Move{from, to, PromoN},
			)
		} else {
			moves = append(moves, Move{from, to, flag})
		}
	}

	to := NewSquare(f, r+dir)
	if to.Valid() && pos.Board[to] == nil {
		addPawn(to, Normal)
		if r == startRank {
			to2 := NewSquare(f, r+2*dir)
			if to2.Valid() && pos.Board[to2] == nil {
				moves = append(moves, Move{from, to2, DoublePush})
			}
		}
	}

	for _, df := range []int{-1, 1} {
		to := NewSquare(f+df, r+dir)
		if !to.Valid() {
			continue
		}
		target := pos.Board[to]
		if target != nil && target.Color != c {
			addPawn(to, Normal)
		} else if to == pos.EP {
			moves = append(moves, Move{from, to, EnPassant})
		}
	}

	return moves
}

func knightMoves(pos *Position, from Square) []Move {
	var moves []Move
	f, r := from.File(), from.Rank()
	c := pos.Board[from].Color
	for _, d := range [8][2]int{{1, 2}, {2, 1}, {2, -1}, {1, -2}, {-1, -2}, {-2, -1}, {-2, 1}, {-1, 2}} {
		to := NewSquare(f+d[0], r+d[1])
		if to.Valid() {
			if t := pos.Board[to]; t == nil || t.Color != c {
				moves = append(moves, Move{from, to, Normal})
			}
		}
	}
	return moves
}

func slidingMoves(pos *Position, from Square, dirs [][2]int) []Move {
	var moves []Move
	c := pos.Board[from].Color
	for _, d := range dirs {
		cf, cr := from.File()+d[0], from.Rank()+d[1]
		for cf >= 0 && cf <= 7 && cr >= 0 && cr <= 7 {
			to := NewSquare(cf, cr)
			t := pos.Board[to]
			if t == nil {
				moves = append(moves, Move{from, to, Normal})
			} else {
				if t.Color != c {
					moves = append(moves, Move{from, to, Normal})
				}
				break
			}
			cf += d[0]
			cr += d[1]
		}
	}
	return moves
}

func kingMoves(pos *Position, from Square) []Move {
	var moves []Move
	f, r := from.File(), from.Rank()
	c := pos.Board[from].Color
	for _, d := range [8][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}} {
		to := NewSquare(f+d[0], r+d[1])
		if to.Valid() {
			if t := pos.Board[to]; t == nil || t.Color != c {
				moves = append(moves, Move{from, to, Normal})
			}
		}
	}

	opp := c.Opponent()
	if c == White && from == NewSquare(4, 0) {
		if pos.Castling.WK && castleKSClear(pos, 0, opp) {
			moves = append(moves, Move{from, NewSquare(6, 0), CastleKS})
		}
		if pos.Castling.WQ && castleQSClear(pos, 0, opp) {
			moves = append(moves, Move{from, NewSquare(2, 0), CastleQS})
		}
	}
	if c == Black && from == NewSquare(4, 7) {
		if pos.Castling.BK && castleKSClear(pos, 7, opp) {
			moves = append(moves, Move{from, NewSquare(6, 7), CastleKS})
		}
		if pos.Castling.BQ && castleQSClear(pos, 7, opp) {
			moves = append(moves, Move{from, NewSquare(2, 7), CastleQS})
		}
	}

	return moves
}

func castleKSClear(pos *Position, rank int, opp Color) bool {
	sqF := NewSquare(5, rank)
	sqG := NewSquare(6, rank)
	if pos.Board[sqF] != nil || pos.Board[sqG] != nil {
		return false
	}
	sqE := NewSquare(4, rank)
	return !IsAttacked(pos, sqE, opp) &&
		!IsAttacked(pos, sqF, opp) &&
		!IsAttacked(pos, sqG, opp)
}

func castleQSClear(pos *Position, rank int, opp Color) bool {
	sqB := NewSquare(1, rank)
	sqC := NewSquare(2, rank)
	sqD := NewSquare(3, rank)
	if pos.Board[sqB] != nil || pos.Board[sqC] != nil || pos.Board[sqD] != nil {
		return false
	}

	sqE := NewSquare(4, rank)
	return !IsAttacked(pos, sqE, opp) &&
		!IsAttacked(pos, sqD, opp) &&
		!IsAttacked(pos, sqC, opp)
}
