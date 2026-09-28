package evalprecompute

import (
	"reflect"
	"testing"
)

func TestOrphanKeys(t *testing.T) {
	existing := map[string]bool{"a": true, "b": true, "c": true}

	t.Run("returns cached keys no repertoire reaches, sorted", func(t *testing.T) {
		got := OrphanKeys(existing, []string{"b", "z"})
		want := []string{"a", "c"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("nothing orphaned when every cached key is live", func(t *testing.T) {
		if got := OrphanKeys(existing, []string{"a", "b", "c", "d"}); len(got) != 0 {
			t.Fatalf("got %v, want none", got)
		}
	})

	t.Run("empty cache has no orphans", func(t *testing.T) {
		if got := OrphanKeys(map[string]bool{}, []string{"a"}); len(got) != 0 {
			t.Fatalf("got %v, want none", got)
		}
	})
}
