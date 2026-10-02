package db

import "testing"

func TestPushResults(t *testing.T) {
	if bits, n := pushResults(0, 0, 0, 5); bits != 31 || n != 5 {
		t.Fatalf("five correct: bits=%d n=%d", bits, n)
	}
	if bits, n := pushResults(31, 5, 1, 0); bits != 30 || n != 5 {
		t.Fatalf("one miss after five correct: bits=%d n=%d", bits, n)
	}
	if bits, n := pushResults(0, 0, 2, 1); bits != 1 || n != 3 {
		t.Fatalf("two misses then a hit: bits=%d n=%d", bits, n)
	}
	if bits, n := pushResults(30, 5, 0, 1); bits != 29 || n != 5 {
		t.Fatalf("a hit after a miss: bits=%d n=%d", bits, n)
	}
}
