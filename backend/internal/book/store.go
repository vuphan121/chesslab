package book

import "sync"

type Store struct {
	mu     sync.RWMutex
	byID   map[string]*Book
	all    []*Book
	loader func() []*Book
}

func NewStore(books []*Book) *Store {
	s := &Store{}
	s.replace(books)
	return s
}

func (s *Store) replace(books []*Book) {
	byID := make(map[string]*Book, len(books))
	all := make([]*Book, 0, len(books))
	for _, b := range books {
		byID[b.ID] = b
		all = append(all, b)
	}
	s.mu.Lock()
	s.byID, s.all = byID, all
	s.mu.Unlock()
}

func (s *Store) SetLoader(loader func() []*Book) {
	s.mu.Lock()
	s.loader = loader
	s.mu.Unlock()
}

func (s *Store) Reload() (int, bool) {
	s.mu.RLock()
	loader := s.loader
	s.mu.RUnlock()
	if loader == nil {
		return 0, false
	}
	books := loader()
	if len(books) == 0 {
		return 0, false
	}
	s.replace(books)
	return len(books), true
}

func (s *Store) Get(id string) (*Book, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, ok := s.byID[id]
	return b, ok
}

func (s *Store) List() []*Book {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.all
}
