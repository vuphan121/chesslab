package chess

import (
	"fmt"
	"strconv"
	"strings"
)

const StartFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

// ParseFEN parses a FEN string into a Position.
func ParseFEN(fen string) (*Position, error) {
	parts := strings.Fields(fen)
	if len(parts) < 4 {
		return nil, fmt.Errorf("invalid FEN: too few fields")
	}

	pos := &Position{EP: NoSquare, FullMove: 1}

	// 1. Piece placement — FEN rank order is 8..1 (top to bottom)
	ranks := strings.Split(parts[0], "/")
	if len(ranks) != 8 {
		return nil, fmt.Errorf("invalid FEN: expected 8 ranks")
	}
	for ri, rankStr := range ranks {
		rank := 7 - ri // FEN row 0 → rank index 7 (rank 8)
		file := 0
		for _, ch := range rankStr {
			if ch >= '1' && ch <= '8' {
				file += int(ch - '0')
				continue
			}
			color := White
			lower := ch
			if ch >= 'a' && ch <= 'z' {
				color = Black
			} else {
				lower = ch + 32 // to lower
			}
			pt := ParsePieceType(byte(lower))
			if pt == 0 {
				return nil, fmt.Errorf("unknown piece char %q", ch)
			}
			sq := NewSquare(file, rank)
			pos.Board[sq] = &Piece{Type: pt, Color: color}
			file++
		}
	}

	// 2. Active color
	switch parts[1] {
	case "w":
		pos.Turn = White
	case "b":
		pos.Turn = Black
	default:
		return nil, fmt.Errorf("invalid active color %q", parts[1])
	}

	// 3. Castling availability
	for _, ch := range parts[2] {
		switch ch {
		case 'K':
			pos.Castling.WK = true
		case 'Q':
			pos.Castling.WQ = true
		case 'k':
			pos.Castling.BK = true
		case 'q':
			pos.Castling.BQ = true
		}
	}

	// 4. En passant target
	if parts[3] != "-" {
		pos.EP = ParseSquare(parts[3])
	}

	// 5 & 6. Clocks (optional)
	if len(parts) >= 5 {
		if n, err := strconv.Atoi(parts[4]); err == nil {
			pos.HalfClock = n
		}
	}
	if len(parts) >= 6 {
		if n, err := strconv.Atoi(parts[5]); err == nil {
			pos.FullMove = n
		}
	}

	return pos, nil
}

// FEN serialises a Position back to a FEN string.
func FEN(pos *Position) string {
	var sb strings.Builder

	// Piece placement
	for ri := 0; ri < 8; ri++ {
		rank := 7 - ri
		empty := 0
		for file := 0; file < 8; file++ {
			p := pos.Board[NewSquare(file, rank)]
			if p == nil {
				empty++
				continue
			}
			if empty > 0 {
				sb.WriteByte(byte('0' + empty))
				empty = 0
			}
			ch := p.Type.Char()
			if p.Color == White {
				ch -= 32 // to upper
			}
			sb.WriteByte(ch)
		}
		if empty > 0 {
			sb.WriteByte(byte('0' + empty))
		}
		if ri < 7 {
			sb.WriteByte('/')
		}
	}

	// Active color
	sb.WriteByte(' ')
	sb.WriteString(pos.Turn.String())

	// Castling
	sb.WriteByte(' ')
	castle := ""
	if pos.Castling.WK {
		castle += "K"
	}
	if pos.Castling.WQ {
		castle += "Q"
	}
	if pos.Castling.BK {
		castle += "k"
	}
	if pos.Castling.BQ {
		castle += "q"
	}
	if castle == "" {
		castle = "-"
	}
	sb.WriteString(castle)

	// EP + clocks
	sb.WriteString(fmt.Sprintf(" %s %d %d", pos.EP.String(), pos.HalfClock, pos.FullMove))

	return sb.String()
}
