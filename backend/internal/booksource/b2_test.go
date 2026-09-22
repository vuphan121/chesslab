package booksource

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestB2OpenStreamsOnlyRequestedObject(t *testing.T) {
	var requestedPath string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/authorize":
			if r.Header.Get("Authorization") == "" {
				t.Fatal("authorization request omitted credentials")
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"authorizationToken":"download-token","apiInfo":{"storageApi":{"downloadUrl":"`+server.URL+`"}}}`)
		case "/file/chessbook/books/example/chapter-1.pdf":
			requestedPath = r.URL.Path
			if got := r.Header.Get("Authorization"); got != "download-token" {
				t.Fatalf("download authorization = %q", got)
			}
			io.WriteString(w, "%PDF chapter 1")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	b2, err := NewB2(B2Config{KeyID: "id", ApplicationKey: "secret", Bucket: "chessbook", HTTPClient: server.Client(), AuthorizeURL: server.URL + "/authorize"})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := b2.Open(context.Background(), "books/example/chapter-1.pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	got, err := io.ReadAll(stream)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "%PDF chapter 1" || requestedPath != "/file/chessbook/books/example/chapter-1.pdf" {
		t.Fatalf("download = %q from %q", got, requestedPath)
	}
}

func TestB2OpenRejectsUnsafeObjectKey(t *testing.T) {
	b2, err := NewB2(B2Config{KeyID: "id", ApplicationKey: "secret", Bucket: "chessbook"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b2.Open(context.Background(), "../book.pdf"); err == nil {
		t.Fatal("Open accepted an unsafe key")
	}
}

// The authorization token is cached and reused across calls instead of
// re-authorizing with B2 on every single chapter download.
func TestB2OpenReusesCachedAuthorization(t *testing.T) {
	var authorizeCalls int
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/authorize":
			authorizeCalls++
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"authorizationToken":"download-token","apiInfo":{"storageApi":{"downloadUrl":"`+server.URL+`"}}}`)
		case "/file/chessbook/books/example/chapter-1.pdf":
			io.WriteString(w, "%PDF chapter 1")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	b2, err := NewB2(B2Config{KeyID: "id", ApplicationKey: "secret", Bucket: "chessbook", HTTPClient: server.Client(), AuthorizeURL: server.URL + "/authorize"})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		stream, err := b2.Open(context.Background(), "books/example/chapter-1.pdf")
		if err != nil {
			t.Fatal(err)
		}
		stream.Close()
	}
	if authorizeCalls != 1 {
		t.Fatalf("authorize was called %d times across 3 downloads, want 1 (cached)", authorizeCalls)
	}
}

// If B2 rejects a cached token as unauthorized (revoked/expired early),
// Open re-authorizes once and retries rather than failing the download.
func TestB2OpenRetriesOnceAfterUnauthorized(t *testing.T) {
	var authorizeCalls, downloadCalls int
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/authorize":
			authorizeCalls++
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"authorizationToken":"download-token","apiInfo":{"storageApi":{"downloadUrl":"`+server.URL+`"}}}`)
		case "/file/chessbook/books/example/chapter-1.pdf":
			downloadCalls++
			if downloadCalls == 1 {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			io.WriteString(w, "%PDF chapter 1")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	b2, err := NewB2(B2Config{KeyID: "id", ApplicationKey: "secret", Bucket: "chessbook", HTTPClient: server.Client(), AuthorizeURL: server.URL + "/authorize"})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := b2.Open(context.Background(), "books/example/chapter-1.pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	got, err := io.ReadAll(stream)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "%PDF chapter 1" {
		t.Fatalf("download = %q", got)
	}
	if authorizeCalls != 2 {
		t.Fatalf("authorize was called %d times, want 2 (initial + retry after 401)", authorizeCalls)
	}
	if downloadCalls != 2 {
		t.Fatalf("download was called %d times, want 2 (initial 401 + retry)", downloadCalls)
	}
}
