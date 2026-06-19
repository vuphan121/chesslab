package chess

import "fmt"

func applyMove(pos *Position, m Move) *Position {
	next := pos.Clone()
	piece := next.Board[m.From]
	next.Board[m.From] = nil
	next.EP = NoSquare
	next.HalfClock++

	switch m.Flag {
	case DoublePush:
		next.Board[m.To] = piece
		dir := 1
		if pos.Turn == Black {
			dir = -1
		}
		next.EP = NewSquare(m.From.File(), m.From.Rank()+dir)
		next.HalfClock = 0

	case EnPassant:
		next.Board[m.To] = piece
		dir := 1
		if pos.Turn == Black {
			dir = -1
		}
		// captured pawn sits one rank behind the EP target square
		next.Board[NewSquare(m.To.File(), m.To.Rank()-dir)] = nil
		next.HalfClock = 0

	case CastleKS:
		next.Board[m.To] = piece
		rank := m.From.Rank()
		next.Board[NewSquare(5, rank)] = next.Board[NewSquare(7, rank)]
		next.Board[NewSquare(7, rank)] = nil

	case CastleQS:
		next.Board[m.To] = piece
		rank := m.From.Rank()
		next.Board[NewSquare(3, rank)] = next.Board[NewSquare(0, rank)]
		next.Board[NewSquare(0, rank)] = nil

	case PromoQ, PromoR, PromoB, PromoN:
		next.Board[m.To] = &Piece{Type: m.PromotionPiece(), Color: pos.Turn}
		next.HalfClock = 0

	default:
		if next.Board[m.To] != nil {
			next.HalfClock = 0
		}
		if piece.Type == Pawn {
			next.HalfClock = 0
		}
		next.Board[m.To] = piece
	}

	updateCastling(&next.Castling, m.From, m.To)

	if pos.Turn == Black {
		next.FullMove++
	}
	next.Turn = pos.Turn.Opponent()
	return next
}

func updateCastling(c *CastlingRights, from, to Square) {
	if from == NewSquare(4, 0) {
		c.WK, c.WQ = false, false
	}
	if from == NewSquare(4, 7) {
		c.BK, c.BQ = false, false
	}
	if from == NewSquare(7, 0) || to == NewSquare(7, 0) {
		c.WK = false
	}
	if from == NewSquare(0, 0) || to == NewSquare(0, 0) {
		c.WQ = false
	}
	if from == NewSquare(7, 7) || to == NewSquare(7, 7) {
		c.BK = false
	}
	if from == NewSquare(0, 7) || to == NewSquare(0, 7) {
		c.BQ = false
	}
}

type Game struct {
	ID       string
	Pos      *Position
	History  []Move
	LastMove *Move
}

func NewGame(id string) *Game {
	pos, _ := ParseFEN(StartFEN)
	return &Game{ID: id, Pos: pos}
}

func (g *Game) LegalMoves() []Move {
	return GenerateLegalMoves(g.Pos)
}

func (g *Game) ApplyMove(m Move) error {
	legal := g.LegalMoves()

	for i, lm := range legal {
		if lm.From != m.From || lm.To != m.To {
			continue
		}
		if lm.IsPromotion() {
			want := m.Flag
			if !m.IsPromotion() {
				want = PromoQ
			}
			if lm.Flag != want {
				continue
			}
		}
		matched := legal[i]
		g.Pos = applyMove(g.Pos, matched)
		g.History = append(g.History, matched)
		g.LastMove = &g.History[len(g.History)-1]
		return nil
	}

	return fmt.Errorf("illegal move: %s→%s", m.From, m.To)
}

func (g *Game) IsCheck() bool      { return InCheck(g.Pos, g.Pos.Turn) }
func (g *Game) HasLegalMoves() bool { return len(g.LegalMoves()) > 0 }
func (g *Game) IsCheckmate() bool  { return g.IsCheck() && !g.HasLegalMoves() }
func (g *Game) IsStalemate() bool  { return !g.IsCheck() && !g.HasLegalMoves() }
func (g *Game) Is50MoveRule() bool { return g.Pos.HalfClock >= 100 }

func (g *Game) IsInsufficientMaterial() bool {
	var pieces int
	for _, p := range g.Pos.Board {
		if p != nil {
			pieces++
		}
	}
	return pieces == 2
}

func (g *Game) IsDraw() bool    { return g.IsStalemate() || g.Is50MoveRule() || g.IsInsufficientMaterial() }
func (g *Game) IsGameOver() bool { return g.IsCheckmate() || g.IsDraw() }

func (g *Game) GameOverReason() string {
	switch {
	case g.IsCheckmate():
		return "checkmate"
	case g.IsStalemate():
		return "stalemate"
	case g.Is50MoveRule():
		return "50-move rule"
	case g.IsInsufficientMaterial():
		return "insufficient material"
	}
	return ""
}
