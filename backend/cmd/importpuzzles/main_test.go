package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
)

func TestOpenReadsPlainAndZstd(t *testing.T) {
	const csv = "PuzzleId,FEN,Moves\nabc,f,m\n"
	dir := t.TempDir()

	plain := filepath.Join(dir, "p.csv")
	if err := os.WriteFile(plain, []byte(csv), 0o600); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	enc, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	enc.Write([]byte(csv))
	enc.Close()
	packed := filepath.Join(dir, "p.csv.zst")
	if err := os.WriteFile(packed, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{plain, packed} {
		r, err := open(path, "")
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		got, err := io.ReadAll(r)
		r.Close()
		if err != nil || string(got) != csv {
			t.Fatalf("%s: got %q err %v", path, got, err)
		}
	}
}
