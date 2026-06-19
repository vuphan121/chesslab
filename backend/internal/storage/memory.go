package storage

import (
	"sync"

	"github.com/chesslab/backend/internal/chess"
)

type Store interface {
	Save(g *chess.Game)
	Get(id string) (*chess.Game, bool)
	Delete(id string)
}

type Memory struct {
	mu    sync.RWMutex
	games map[string]*chess.Game
}

func NewMemory() *Memory {
	return &Memory{games: make(map[string]*chess.Game)}
}

func (m *Memory) Save(g *chess.Game) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.games[g.ID] = g
}

func (m *Memory) Get(id string) (*chess.Game, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	g, ok := m.games[id]
	return g, ok
}

func (m *Memory) Delete(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.games, id)
}
