package api

import "testing"

func TestChessTempoPuzzleURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		ok   bool
	}{
		{name: "tactics link", raw: "https://chesstempo.com/chess-tactics/12345", ok: true},
		{name: "subdomain link", raw: "https://www.chesstempo.com/chess-tactics/12345", ok: true},
		{name: "other host", raw: "https://example.com/chess-tactics/12345", ok: false},
		{name: "non-https", raw: "http://chesstempo.com/chess-tactics/12345", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := chessTempoPuzzleURL(tt.raw)
			if (err == nil) != tt.ok {
				t.Fatalf("chessTempoPuzzleURL(%q) error = %v, want success = %v", tt.raw, err, tt.ok)
			}
		})
	}
}
