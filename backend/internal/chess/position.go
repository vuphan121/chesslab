package chess

type CastlingRights struct {
	WK, WQ bool
	BK, BQ bool
}

type Position struct {
	Board     [64]*Piece
	Turn      Color
	Castling  CastlingRights
	EP        Square
	HalfClock int
	FullMove  int
}

func (pos *Position) PieceAt(sq Square) *Piece {
	if !sq.Valid() {
		return nil
	}
	return pos.Board[sq]
}

func (pos *Position) KingSquare(c Color) Square {
	for i := Square(0); i <= 63; i++ {
		p := pos.Board[i]
		if p != nil && p.Type == King && p.Color == c {
			return i
		}
	}
	return NoSquare
}

func (pos *Position) Clone() *Position {
	p2 := &Position{
		Turn:      pos.Turn,
		Castling:  pos.Castling,
		EP:        pos.EP,
		HalfClock: pos.HalfClock,
		FullMove:  pos.FullMove,
	}
	for i, p := range pos.Board {
		if p != nil {
			cp := *p
			p2.Board[i] = &cp
		}
	}
	return p2
}
