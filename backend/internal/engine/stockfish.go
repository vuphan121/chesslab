package engine

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
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

// These bound how long we'll wait on the Stockfish subprocess before giving
// up. Without them, a wedged/hung process blocked every read forever while
// Analyze held Engine.mu — one stuck call meant every subsequent analysis
// request, for any game, hung too, with no recovery short of a process
// restart. A timeout turns that into a bounded per-request failure instead
// of a permanent server-wide outage.
const (
	handshakeTimeout = 10 * time.Second
	analyzeTimeout   = 30 * time.Second
	closeTimeout     = 5 * time.Second
	stopTimeout      = 2 * time.Second
)

var errEngineUnavailable = errors.New("engine unavailable")

type Engine struct {
	mu    sync.Mutex
	path  string
	cmd   *exec.Cmd
	in    io.WriteCloser
	lines <-chan string
	Name  string
}

func New(path string) (*Engine, error) {
	e := &Engine{path: path}
	if err := e.startLocked(); err != nil {
		return nil, err
	}
	return e, nil
}

func (e *Engine) startLocked() error {
	cmd := exec.Command(e.path)
	in, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("stdin pipe: %w", err)
	}
	outPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start engine: %w", err)
	}

	// A dedicated reader goroutine decouples "wait for the next line" from
	// "the actual blocking read" — Scan() itself has no timeout support, so
	// the only portable way to bound a wait on it is to let it block in its
	// own goroutine and have callers select on a channel with a deadline.
	lines := make(chan string, 64)
	go func() {
		scanner := bufio.NewScanner(outPipe)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()

	e.cmd, e.in, e.lines, e.Name = cmd, in, lines, ""
	if err := e.handshake(); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return err
	}
	return nil
}

func (e *Engine) send(s string) error {
	if e.in == nil {
		return errEngineUnavailable
	}
	if _, err := fmt.Fprintln(e.in, s); err != nil {
		return fmt.Errorf("%w: write command: %v", errEngineUnavailable, err)
	}
	return nil
}

// readLine waits for the next engine output line. ok is false if the
// process's stdout closed (it exited) or the timeout elapsed first.
func (e *Engine) readLine(timeout time.Duration) (line string, ok bool) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case l, open := <-e.lines:
		return l, open
	case <-timer.C:
		return "", false
	}
}

func (e *Engine) handshake() error {
	if err := e.send("uci"); err != nil {
		return err
	}
	deadline := time.Now().Add(handshakeTimeout)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return fmt.Errorf("engine handshake timed out")
		}
		line, ok := e.readLine(remaining)
		if !ok {
			return fmt.Errorf("engine closed before uciok")
		}
		if strings.HasPrefix(line, "id name ") {
			e.Name = strings.TrimPrefix(line, "id name ")
		}
		if line == "uciok" {
			return nil
		}
	}
}

func (e *Engine) Analyze(fen string, multiPV, depth int) (*Analysis, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for attempt := 0; attempt < 2; attempt++ {
		analysis, err := e.analyzeLocked(fen, multiPV, depth)
		if err == nil {
			return analysis, nil
		}
		if !errors.Is(err, errEngineUnavailable) || attempt == 1 {
			return nil, err
		}
		if restartErr := e.restartLocked(); restartErr != nil {
			return nil, fmt.Errorf("%v; restarting engine: %w", err, restartErr)
		}
	}
	return nil, errEngineUnavailable
}

func (e *Engine) analyzeLocked(fen string, multiPV, depth int) (*Analysis, error) {
	if err := e.send(fmt.Sprintf("setoption name MultiPV value %d", multiPV)); err != nil {
		return nil, err
	}
	if err := e.send("isready"); err != nil {
		return nil, err
	}
	if !e.waitFor("readyok", analyzeTimeout) {
		return nil, fmt.Errorf("%w: engine not ready", errEngineUnavailable)
	}
	if err := e.send("position fen " + fen); err != nil {
		return nil, err
	}
	if err := e.send(fmt.Sprintf("go depth %d", depth)); err != nil {
		return nil, err
	}

	best := make(map[int]*parsedInfo)
	var bestMove string

	deadline := time.Now().Add(analyzeTimeout)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			e.stopAndDrainLocked()
			return nil, fmt.Errorf("engine analysis timed out")
		}
		text, ok := e.readLine(remaining)
		if !ok {
			e.stopAndDrainLocked()
			return nil, fmt.Errorf("engine closed or timed out during analysis")
		}
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

// stopAndDrainLocked restores the UCI command boundary after a timed-out
// search. If Stockfish will not acknowledge stop with bestmove, replace the
// process so stale output can never leak into the next request.
func (e *Engine) stopAndDrainLocked() {
	if e.send("stop") == nil && e.waitFor("bestmove", stopTimeout) {
		return
	}
	_ = e.restartLocked()
}

func (e *Engine) restartLocked() error {
	e.stopProcessLocked()
	return e.startLocked()
}

func (e *Engine) stopProcessLocked() {
	if e.in != nil {
		_ = e.in.Close()
	}
	if e.cmd != nil && e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
		_ = e.cmd.Wait()
	}
	e.cmd, e.in, e.lines = nil, nil, nil
}

func (e *Engine) waitFor(prefix string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return false
		}
		line, ok := e.readLine(remaining)
		if !ok {
			return false
		}
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
}

// Close asks the engine to quit and waits for the process to exit, killing
// it if it doesn't within closeTimeout — "quit" going unanswered by a wedged
// process used to hang shutdown forever via an unbounded cmd.Wait().
func (e *Engine) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cmd == nil {
		return
	}
	_ = e.send("quit")
	done := make(chan struct{})
	go func() {
		e.cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(closeTimeout):
		_ = e.cmd.Process.Kill()
		<-done
	}
	e.cmd, e.in, e.lines = nil, nil, nil
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
