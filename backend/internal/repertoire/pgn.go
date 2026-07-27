package repertoire

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/chesslab/backend/internal/chess"
)

var (
	tagLineRe        = regexp.MustCompile(`^\[(\S+)\s+"(.*)"\]$`)
	moveNumberPrefix = regexp.MustCompile(`^\d+\.+`)
)

// gameBlock is one game's raw tag pairs + concatenated movetext, before
// tokenizing/parsing.
type gameBlock struct {
	tags     map[string]string
	movetext string
}

// ParsePGN parses a multi-game study export (one chapter per game, each
// carrying its own [FEN]/[SetUp] and full variation tree) into Chapters.
// Returns an error naming the chapter and token on the first illegal or
// unparseable move — a repertoire that silently drops half a line is worse
// than one that refuses to load.
func ParsePGN(text string) ([]*Chapter, error) {
	blocks, err := splitGames(text)
	if err != nil {
		return nil, err
	}

	chapters := make([]*Chapter, 0, len(blocks))
	for i, b := range blocks {
		label := b.tags["ChapterName"]
		if label == "" {
			label = fmt.Sprintf("chapter %d", i+1)
		}

		startFEN := chess.StartFEN
		if fen, ok := b.tags["FEN"]; ok && b.tags["SetUp"] == "1" {
			startFEN = fen
		}

		toks, err := tokenizeMovetext(b.movetext)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", label, err)
		}

		root, err := parseChapterMovetext(startFEN, toks, label)
		if err != nil {
			return nil, err
		}

		chapters = append(chapters, &Chapter{
			ID:       fmt.Sprintf("ch%d", i+1),
			Name:     label,
			URL:      b.tags["ChapterURL"],
			StartFEN: startFEN,
			Root:     root,
		})
	}
	return chapters, nil
}

// splitGames splits a PGN file into per-game tag blocks + movetext. A study
// export separates chapters as consecutive "[Tag ...]... movetext" games
// with no other delimiter, so a new tag block encountered after movetext has
// already started ends the previous game.
func splitGames(text string) ([]gameBlock, error) {
	var blocks []gameBlock
	tags := map[string]string{}
	var mt strings.Builder

	flush := func() {
		if len(tags) == 0 && mt.Len() == 0 {
			return
		}
		blocks = append(blocks, gameBlock{tags: tags, movetext: mt.String()})
		tags = map[string]string{}
		mt.Reset()
	}

	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if m := tagLineRe.FindStringSubmatch(trimmed); m != nil {
			if mt.Len() > 0 {
				flush()
			}
			tags[m[1]] = m[2]
			continue
		}
		mt.WriteString(trimmed)
		mt.WriteString(" ")
	}
	flush()

	if len(blocks) == 0 {
		return nil, fmt.Errorf("no games found in PGN")
	}
	return blocks, nil
}

type tokKind int

const (
	tokMove tokKind = iota
	tokComment
	tokNAG
	tokLParen
	tokRParen
)

type token struct {
	kind tokKind
	text string // move SAN (annotation-stripped) or comment text
	nag  int
}

// tokenizeMovetext scans one chapter's movetext into a flat token stream:
// moves, comments, NAGs, and paren boundaries. Move-number labels and result
// markers are dropped entirely (never emitted as tokens).
func tokenizeMovetext(s string) ([]token, error) {
	var toks []token
	i, n := 0, len(s)

	for i < n {
		c := s[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++

		case c == '{':
			end := strings.IndexByte(s[i+1:], '}')
			if end < 0 {
				return nil, fmt.Errorf("unterminated comment")
			}
			text := strings.Join(strings.Fields(s[i+1:i+1+end]), " ")
			toks = append(toks, token{kind: tokComment, text: text})
			i = i + 1 + end + 1

		case c == '(':
			toks = append(toks, token{kind: tokLParen})
			i++

		case c == ')':
			toks = append(toks, token{kind: tokRParen})
			i++

		case c == '$':
			j := i + 1
			for j < n && s[j] >= '0' && s[j] <= '9' {
				j++
			}
			if j == i+1 {
				return nil, fmt.Errorf("malformed NAG at byte %d", i)
			}
			val, _ := strconv.Atoi(s[i+1 : j])
			toks = append(toks, token{kind: tokNAG, nag: val})
			i = j

		default:
			j := i
			for j < n && !isMovetextBreak(s[j]) {
				j++
			}
			word := s[i:j]
			i = j
			if isResultToken(word) {
				continue
			}
			word = moveNumberPrefix.ReplaceAllString(word, "")
			san, nag := splitAnnotationSuffix(word)
			if san == "" {
				continue
			}
			toks = append(toks, token{kind: tokMove, text: san})
			if nag != 0 {
				toks = append(toks, token{kind: tokNAG, nag: nag})
			}
		}
	}
	return toks, nil
}

func isMovetextBreak(c byte) bool {
	switch c {
	case ' ', '\t', '\n', '\r', '{', '(', ')', '$':
		return true
	}
	return false
}

func isResultToken(s string) bool {
	switch s {
	case "1-0", "0-1", "1/2-1/2", "*":
		return true
	}
	return false
}

// splitAnnotationSuffix strips trailing !/? suffix-annotations (as opposed to
// $N NAGs) from a move token and returns the equivalent NAG, so both
// notations for the same annotation end up on the node the same way.
func splitAnnotationSuffix(s string) (san string, nag int) {
	suf := ""
	for len(s) > 0 && (s[len(s)-1] == '!' || s[len(s)-1] == '?') {
		suf = string(s[len(s)-1]) + suf
		s = s[:len(s)-1]
	}
	switch suf {
	case "!!":
		return s, 3
	case "??":
		return s, 4
	case "!?":
		return s, 5
	case "?!":
		return s, 6
	case "!":
		return s, 1
	case "?":
		return s, 2
	default:
		return s, 0
	}
}

// parseChapterMovetext builds one chapter's move tree from its token stream,
// starting at startFEN.
func parseChapterMovetext(startFEN string, toks []token, label string) (*Node, error) {
	pos, err := chess.ParseFEN(startFEN)
	if err != nil {
		return nil, fmt.Errorf("%s: bad start FEN: %w", label, err)
	}
	root := &Node{FEN: startFEN, Pos: pos}
	if _, err := parseSeq(toks, 0, root, label); err != nil {
		return nil, err
	}
	return root, nil
}

// parseSeq consumes tokens starting at idx, extending the chain from
// `current`. A '(' opens a variation that is an alternative to `current`'s
// own move — i.e. a sibling subtree rooted at current.Parent — parsed via a
// recursive call that does not disturb `current` in the outer sequence. A
// ')' or end-of-input ends the current sequence.
func parseSeq(toks []token, idx int, current *Node, label string) (int, error) {
	for idx < len(toks) {
		t := toks[idx]
		switch t.kind {
		case tokComment:
			if current.Comment == "" {
				current.Comment = t.text
			} else {
				current.Comment += " " + t.text
			}
			idx++

		case tokNAG:
			current.NAGs = append(current.NAGs, t.nag)
			idx++

		case tokRParen:
			return idx + 1, nil

		case tokLParen:
			if current.Parent == nil {
				return 0, fmt.Errorf("%s: variation opens with no move played yet", label)
			}
			next, err := parseSeq(toks, idx+1, current.Parent, label)
			if err != nil {
				return 0, err
			}
			idx = next

		case tokMove:
			m, ok := chess.FindLegalMoveBySAN(current.Pos, t.text)
			if !ok {
				return 0, fmt.Errorf("%s: illegal or unrecognized move %q after ply %d", label, t.text, current.Ply)
			}
			san := chess.SAN(current.Pos, m)
			nextPos := chess.ApplyMove(current.Pos, m)
			child := &Node{
				SAN:    san,
				UCI:    m.String(),
				FEN:    chess.FEN(nextPos),
				Pos:    nextPos,
				Ply:    current.Ply + 1,
				Parent: current,
			}
			current.Children = append(current.Children, child)
			current = child
			idx++
		}
	}
	return idx, nil
}
