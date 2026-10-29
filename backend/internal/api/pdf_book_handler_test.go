package api

import "testing"

func TestPDFBookObjectKey(t *testing.T) {
	if key, ok := PDFBookObjectKey("pdfbooks/", "positional_play"); !ok || key != "pdfbooks/positional_play.pdf" {
		t.Fatalf("key = %q, %v", key, ok)
	}
	for _, bad := range []string{"", "../x", "a/b", "A", "a.pdf", "-a"} {
		if _, ok := PDFBookObjectKey("pdfbooks", bad); ok {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestPDFBookTitle(t *testing.T) {
	if got := pdfBookTitle("positional_play"); got != "Positional Play" {
		t.Fatalf("title = %q", got)
	}
}
