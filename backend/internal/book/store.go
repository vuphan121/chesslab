package book

type Store struct {
	byID map[string]*Book
	all  []*Book
}

func NewStore(books []*Book) *Store {
	s := &Store{byID: make(map[string]*Book, len(books))}
	for _, b := range books {
		s.byID[b.ID] = b
		s.all = append(s.all, b)
	}
	return s
}

func (s *Store) Get(id string) (*Book, bool) {
	b, ok := s.byID[id]
	return b, ok
}

func (s *Store) List() []*Book {
	return s.all
}
