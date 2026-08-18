package repertoire

import "sync"

type Store struct {
	mu   sync.RWMutex
	byID map[string]*Repertoire
	all  []*Repertoire
}

func NewStore(reps []*Repertoire) *Store {
	s := &Store{byID: make(map[string]*Repertoire, len(reps))}
	for _, r := range reps {
		s.upsert(r)
	}
	return s
}

func (s *Store) Get(id string) (*Repertoire, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.byID[id]
	return r, ok
}

func (s *Store) List() []*Repertoire {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]*Repertoire(nil), s.all...)
}

func (s *Store) Upsert(r *Repertoire) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.upsert(r)
}

func (s *Store) upsert(r *Repertoire) {
	if _, exists := s.byID[r.ID]; exists {
		for i, existing := range s.all {
			if existing.ID == r.ID {
				s.all[i] = r
				break
			}
		}
	} else {
		s.all = append(s.all, r)
	}
	s.byID[r.ID] = r
}
