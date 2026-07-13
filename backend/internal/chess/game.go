package chess

import (
	"fmt"
	"strconv"
)

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

// Node is one position in the game's move tree. The root holds the starting
// position (with a zero Move and empty SAN); every other node holds the move
// that reached it plus the resulting position. Children[0] is the main line;
// Children[1:] are sidelines (alternative continuations from the same parent).
type Node struct {
	ID       string
	Move     Move
	SAN      string
	Pos      *Position
	Parent   *Node
	Children []*Node
}

type Game struct {
	ID      string
	Root    *Node
	Current *Node
	// Pos and LastMove mirror Current for convenient access from handlers.
	Pos      *Position
	LastMove *Move
	counter  int
}

func NewGame(id string) *Game {
	pos, _ := ParseFEN(StartFEN)
	root := &Node{ID: "0", Pos: pos}
	return &Game{ID: id, Root: root, Current: root, Pos: pos}
}

func (g *Game) nextID() string {
	g.counter++
	return strconv.Itoa(g.counter)
}

// setCurrent points the game at node n and syncs the mirrored fields.
func (g *Game) setCurrent(n *Node) {
	g.Current = n
	g.Pos = n.Pos
	if n.Parent != nil {
		g.LastMove = &n.Move
	} else {
		g.LastMove = nil
	}
}

// Reset discards the entire move tree (all mainline moves and sidelines) and
// starts over from a fresh starting position, as a brand-new root. Unlike
// GotoNode(g.Root.ID), which only moves the cursor and leaves old children in
// place (so replaying a diverging line becomes a sideline off the stale root),
// this actually clears the tree — used by PGN paste, which should replace the
// game outright, not branch off whatever was there before.
func (g *Game) Reset() {
	pos, _ := ParseFEN(StartFEN)
	root := &Node{ID: "0", Pos: pos}
	g.Root = root
	g.counter = 0
	g.setCurrent(root)
}

// GotoNode navigates to an existing node without discarding any moves.
func (g *Game) GotoNode(id string) error {
	if n := findNode(g.Root, id); n != nil {
		g.setCurrent(n)
		return nil
	}
	return fmt.Errorf("node not found: %s", id)
}

func findNode(n *Node, id string) *Node {
	if n.ID == id {
		return n
	}
	for _, ch := range n.Children {
		if found := findNode(ch, id); found != nil {
			return found
		}
	}
	return nil
}

func (g *Game) LegalMoves() []Move {
	return GenerateLegalMoves(g.Pos)
}

// ApplyMove plays m from the current node. Replaying an existing continuation
// just navigates onto it; a new move from a node that already has children
// creates a sideline.
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
		for _, ch := range g.Current.Children {
			if ch.Move == matched {
				g.setCurrent(ch)
				return nil
			}
		}
		node := &Node{
			ID:     g.nextID(),
			Move:   matched,
			SAN:    SAN(g.Pos, matched),
			Pos:    applyMove(g.Pos, matched),
			Parent: g.Current,
		}
		g.Current.Children = append(g.Current.Children, node)
		g.setCurrent(node)
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
