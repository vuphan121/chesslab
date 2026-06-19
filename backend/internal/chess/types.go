package chess

// Color is the side to move.
type Color uint8

const (
	White Color = iota
	Black
)

func (c Color) Opponent() Color {
	if c == White {
		return Black
	}
	return White
}

func (c Color) String() string {
	if c == White {
		return "w"
	}
	return "b"
}

// PieceType identifies the kind of piece.
type PieceType uint8

const (
	Pawn PieceType = iota + 1
	Knight
	Bishop
	Rook
	Queen
	King
)

var pieceTypeChar = map[PieceType]byte{
	Pawn: 'p', Knight: 'n', Bishop: 'b', Rook: 'r', Queen: 'q', King: 'k',
}

var charPieceType = map[byte]PieceType{
	'p': Pawn, 'n': Knight, 'b': Bishop, 'r': Rook, 'q': Queen, 'k': King,
}

func (p PieceType) Char() byte        { return pieceTypeChar[p] }
func (p PieceType) String() string    { return string([]byte{pieceTypeChar[p]}) }
func ParsePieceType(c byte) PieceType { return charPieceType[c] }

// Piece is a colored piece.
type Piece struct {
	Type  PieceType
	Color Color
}

// Square is 0-63: index = rank*8 + file
// a1=0, b1=1, …, h1=7, a2=8, …, h8=63
type Square int

const NoSquare Square = -1

func NewSquare(file, rank int) Square {
	if file < 0 || file > 7 || rank < 0 || rank > 7 {
		return NoSquare
	}
	return Square(rank*8 + file)
}

func ParseSquare(s string) Square {
	if len(s) != 2 {
		return NoSquare
	}
	return NewSquare(int(s[0]-'a'), int(s[1]-'1'))
}

func (s Square) Valid() bool { return s >= 0 && s <= 63 }
func (s Square) File() int   { return int(s) % 8 }
func (s Square) Rank() int   { return int(s) / 8 }
func (s Square) String() string {
	if !s.Valid() {
		return "-"
	}
	return string([]byte{'a' + byte(s.File()), '1' + byte(s.Rank())})
}

// MoveFlag encodes special move types so the engine can store a move in one struct.
type MoveFlag uint8

const (
	Normal     MoveFlag = iota
	DoublePush          // pawn two-square advance — sets en passant target
	EnPassant           // en passant capture
	CastleKS            // kingside castling
	CastleQS            // queenside castling
	PromoQ              // promotion to queen
	PromoR              // promotion to rook
	PromoB              // promotion to bishop
	PromoN              // promotion to knight
)

// Move is a fully-specified chess move.
type Move struct {
	From Square
	To   Square
	Flag MoveFlag
}

func (m Move) IsPromotion() bool { return m.Flag >= PromoQ }

func (m Move) PromotionPiece() PieceType {
	switch m.Flag {
	case PromoQ:
		return Queen
	case PromoR:
		return Rook
	case PromoB:
		return Bishop
	case PromoN:
		return Knight
	}
	return 0
}

func (m Move) String() string {
	s := m.From.String() + m.To.String()
	switch m.Flag {
	case PromoQ:
		s += "q"
	case PromoR:
		s += "r"
	case PromoB:
		s += "b"
	case PromoN:
		s += "n"
	}
	return s
}
