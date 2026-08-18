package engine

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

type Line struct {
	Score int
	Mate  int
	Depth int
	Moves []string
}

type Analysis struct {
	BestMove string
	Lines    []Line
}

type Engine struct {
	mu   sync.Mutex
	cmd  *exec.Cmd
	in   io.WriteCloser
	out  *bufio.Scanner
	Name string
}

func New(path string) (*Engine, error) {
	cmd := exec.Command(path)
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	outPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start engine: %w", err)
	}
	e := &Engine{cmd: cmd, in: in, out: bufio.NewScanner(outPipe)}
	if err := e.handshake(); err != nil {
		cmd.Process.Kill()
		return nil, err
	}
	return e, nil
}

func (e *Engine) send(s string) {
	fmt.Fprintln(e.in, s)
}

func (e *Engine) handshake() error {
	e.send("uci")
	for e.out.Scan() {
		line := e.out.Text()
		if strings.HasPrefix(line, "id name ") {
			e.Name = strings.TrimPrefix(line, "id name ")
		}
		if line == "uciok" {
			return nil
		}
	}
	return fmt.Errorf("engine closed before uciok")
}

func (e *Engine) Analyze(fen string, multiPV, depth int) (*Analysis, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.send(fmt.Sprintf("setoption name MultiPV value %d", multiPV))
	e.send("isready")
	if !e.waitFor("readyok") {
		return nil, fmt.Errorf("engine not ready")
	}
	e.send("position fen " + fen)
	e.send(fmt.Sprintf("go depth %d", depth))

	best := make(map[int]*parsedInfo)
	var bestMove string

	for e.out.Scan() {
		text := e.out.Text()
		if strings.HasPrefix(text, "bestmove") {
			parts := strings.Fields(text)
			if len(parts) >= 2 && parts[1] != "(none)" {
				bestMove = parts[1]
			}
			break
		}
		if strings.HasPrefix(text, "info") {
			if p := parseInfo(text); p != nil && len(p.moves) > 0 {
				best[p.multipv] = p
			}
		}
	}

	a := &Analysis{BestMove: bestMove}
	for i := 1; i <= multiPV; i++ {
		if p, ok := best[i]; ok {
			a.Lines = append(a.Lines, Line{
				Score: p.score,
				Mate:  p.mate,
				Depth: p.depth,
				Moves: p.moves,
			})
		}
	}
	return a, nil
}

func (e *Engine) waitFor(prefix string) bool {
	for e.out.Scan() {
		if strings.HasPrefix(e.out.Text(), prefix) {
			return true
		}
	}
	return false
}

func (e *Engine) Close() {
	e.send("quit")
	e.cmd.Wait()
}

type parsedInfo struct {
	multipv int
	score   int
	mate    int
	depth   int
	moves   []string
}

func parseInfo(s string) *parsedInfo {
	fields := strings.Fields(s)
	p := &parsedInfo{multipv: 1}
	for i := 0; i < len(fields); i++ {
		switch fields[i] {
		case "depth":
			if i+1 < len(fields) {
				p.depth, _ = strconv.Atoi(fields[i+1])
			}
		case "multipv":
			if i+1 < len(fields) {
				p.multipv, _ = strconv.Atoi(fields[i+1])
			}
		case "score":
			if i+2 < len(fields) {
				switch fields[i+1] {
				case "cp":
					p.score, _ = strconv.Atoi(fields[i+2])
				case "mate":
					p.mate, _ = strconv.Atoi(fields[i+2])
					if p.mate > 0 {
						p.score = 30000
					} else {
						p.score = -30000
					}
				}
			}
		case "pv":
			if i+1 < len(fields) {
				p.moves = fields[i+1:]
			}
			return p
		}
	}
	return nil
}
