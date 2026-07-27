package repertoire

// Store is a read-only in-memory registry of loaded repertoires. Unlike
// storage.Store (games), repertoires are static for the process lifetime —
// loaded once at startup, never written to at runtime (import-at-runtime is
// a documented stretch, not v1).
type Store struct {
	byID map[string]*Repertoire
	all  []*Repertoire
}

func NewStore(reps []*Repertoire) *Store {
	s := &Store{byID: make(map[string]*Repertoire, len(reps))}
	for _, r := range reps {
		s.byID[r.ID] = r
		s.all = append(s.all, r)
	}
	return s
}

func (s *Store) Get(id string) (*Repertoire, bool) {
	r, ok := s.byID[id]
	return r, ok
}

func (s *Store) List() []*Repertoire {
	return s.all
}
