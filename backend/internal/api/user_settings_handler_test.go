package api

import "testing"

func TestValidPieceTheme(t *testing.T) {
	tests := []struct {
		theme string
		want  bool
	}{
		{theme: "classic", want: true},
		{theme: "glass", want: true},
		{theme: "", want: false},
		{theme: "neo", want: false},
	}

	for _, tt := range tests {
		if got := validPieceTheme(tt.theme); got != tt.want {
			t.Errorf("validPieceTheme(%q) = %v, want %v", tt.theme, got, tt.want)
		}
	}
}
