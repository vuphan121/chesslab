package storage

import (
	"sync"
	"time"

	"github.com/chesslab/backend/internal/chess"
)

type Store interface {
	Save(g *chess.Game)
	Get(id string) (*chess.Game, bool)
	Delete(id string)
}

type Memory struct {
	mu         sync.Mutex
	games      map[string]gameEntry
	ttl        time.Duration
	maxEntries int
	now        func() time.Time
}

type gameEntry struct {
	game       *chess.Game
	lastAccess time.Time
}

const (
	defaultGameTTL      = 6 * time.Hour
	defaultMaxGameCount = 512
)

func NewMemory() *Memory {
	return newMemory(defaultGameTTL, defaultMaxGameCount, time.Now)
}

func newMemory(ttl time.Duration, maxEntries int, now func() time.Time) *Memory {
	return &Memory{games: make(map[string]gameEntry), ttl: ttl, maxEntries: maxEntries, now: now}
}

func (m *Memory) Save(g *chess.Game) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.pruneExpired(now)
	if _, exists := m.games[g.ID]; !exists && len(m.games) >= m.maxEntries {
		m.evictOldest()
	}
	m.games[g.ID] = gameEntry{game: g, lastAccess: now}
}

func (m *Memory) Get(id string) (*chess.Game, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.pruneExpired(now)
	entry, ok := m.games[id]
	if !ok {
		return nil, false
	}
	entry.lastAccess = now
	m.games[id] = entry
	return entry.game, true
}

func (m *Memory) Delete(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.games, id)
}

func (m *Memory) pruneExpired(now time.Time) {
	for id, entry := range m.games {
		if now.Sub(entry.lastAccess) >= m.ttl {
			delete(m.games, id)
		}
	}
}

func (m *Memory) evictOldest() {
	var oldestID string
	var oldest time.Time
	for id, entry := range m.games {
		if oldestID == "" || entry.lastAccess.Before(oldest) {
			oldestID = id
			oldest = entry.lastAccess
		}
	}
	if oldestID != "" {
		delete(m.games, oldestID)
	}
}
