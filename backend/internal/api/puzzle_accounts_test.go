package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	_ "modernc.org/sqlite"

	"github.com/chesslab/backend/internal/auth"
	"github.com/chesslab/backend/internal/book"
	"github.com/chesslab/backend/internal/db"
	"github.com/chesslab/backend/internal/puzzle"
	"github.com/chesslab/backend/internal/puzzledb"
	"github.com/chesslab/backend/internal/repertoire"
)

func TestTwoAccountsHaveIndependentPuzzleRatingsOverHTTP(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	store, err := db.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	const alice, bob = "__chesslab_http_alice__", "__chesslab_http_bob__"
	cleanup := func() {
		conn, err := pgx.Connect(context.Background(), databaseURL)
		if err != nil {
			return
		}
		defer conn.Close(context.Background())
		for _, u := range []string{alice, bob} {
			_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE username = $1`, u)
		}
	}
	cleanup()
	defer cleanup()
	for _, u := range []string{alice, bob} {
		if err := store.SeedUser(ctx, u, "password-for-"+u); err != nil {
			t.Fatal(err)
		}
	}

	sqliteDB, err := sql.Open("sqlite", "file:accounts_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	sqliteDB.SetMaxOpenConns(1)
	defer sqliteDB.Close()
	puzzles := puzzledb.NewFromDB(sqliteDB)
	if err := puzzles.EnsureSchema(ctx); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 30; i++ {
		id := fmt.Sprintf("pz%02d", i)
		rating := 1980 + i
		if _, err := sqliteDB.Exec(`INSERT INTO puzzles VALUES (?, ?, ?, ?, ?)`, id, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1 e8g8", rating, "fork"); err != nil {
			t.Fatal(err)
		}
		if _, err := sqliteDB.Exec(`INSERT INTO puzzle_themes VALUES (?, ?, ?)`, "fork", puzzle.RatingKey(rating, int64(i*7919)), id); err != nil {
			t.Fatal(err)
		}
	}
	if err := puzzles.WriteThemeCounts(ctx, map[string]int{"fork": 30}); err != nil {
		t.Fatal(err)
	}

	authCfg := auth.Config{Username: alice, Password: "unused", JWTSecret: []byte("test-secret")}
	handler := NewHandler(nil, repertoire.NewStore(nil), book.NewStore(nil), store, authCfg, nil, "")
	handler.SetPuzzleStore(puzzles)
	server := httptest.NewServer(NewRouter(handler))
	defer server.Close()

	t.Setenv("AUTH_USERNAME", alice)
	t.Setenv("LICHESS_USERNAME", "alices-lichess")
	t.Setenv("LICHESS_PUZZLE_TOKEN", "token")

	tokenFor := func(user string) string {
		token, err := authCfg.IssueToken(user)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	tokens := map[string]string{alice: tokenFor(alice), bob: tokenFor(bob)}

	call := func(user, method, path string, body any) (int, map[string]any) {
		t.Helper()
		var reader *bytes.Reader
		if body != nil {
			raw, _ := json.Marshal(body)
			reader = bytes.NewReader(raw)
		} else {
			reader = bytes.NewReader(nil)
		}
		req, err := http.NewRequest(method, server.URL+path, reader)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if user != "" {
			req.Header.Set("Authorization", "Bearer "+tokens[user])
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	forkRating := func(user string) (rating float64, attempts float64) {
		t.Helper()
		status, out := call(user, "GET", "/api/puzzles/themes", nil)
		if status != http.StatusOK {
			t.Fatalf("themes for %s: %d %v", user, status, out)
		}
		for _, raw := range out["themes"].([]any) {
			th := raw.(map[string]any)
			if th["key"] == "fork" {
				return th["rating"].(float64), th["attempts"].(float64)
			}
		}
		t.Fatalf("fork theme missing for %s", user)
		return 0, 0
	}

	if status, _ := call("", "GET", "/api/puzzles/themes", nil); status != http.StatusUnauthorized {
		t.Fatalf("signed-out requests must be refused, got %d", status)
	}

	if r, a := forkRating(alice); r != 2000 || a != 0 {
		t.Fatalf("alice starts at 2000 with no attempts, got %v/%v", r, a)
	}
	if r, a := forkRating(bob); r != 2000 || a != 0 {
		t.Fatalf("bob starts at 2000 with no attempts, got %v/%v", r, a)
	}

	status, next := call(alice, "POST", "/api/puzzles/next", map[string]any{"theme": "fork", "count": 1})
	if status != http.StatusOK {
		t.Fatalf("next: %d %v", status, next)
	}
	picked := next["puzzles"].([]any)[0].(map[string]any)["id"].(string)

	status, won := call(alice, "POST", "/api/puzzles/result", map[string]any{"operationId": "shared-op", "puzzleId": picked, "theme": "fork", "solved": true})
	if status != http.StatusOK || won["ratingBefore"].(float64) != 2000 || won["ratingAfter"].(float64) <= 2000 {
		t.Fatalf("alice solving should raise her rating from 2000: %d %v", status, won)
	}
	aliceAfter := won["ratingAfter"].(float64)

	if r, a := forkRating(alice); r != aliceAfter || a != 1 {
		t.Fatalf("alice's themes should show %v with 1 attempt, got %v/%v", aliceAfter, r, a)
	}
	if r, a := forkRating(bob); r != 2000 || a != 0 {
		t.Fatalf("alice's result must not touch bob, got %v/%v", r, a)
	}

	status, lost := call(bob, "POST", "/api/puzzles/result", map[string]any{"operationId": "shared-op", "puzzleId": picked, "theme": "fork", "solved": false})
	if status != http.StatusOK || lost["ratingBefore"].(float64) != 2000 || lost["ratingAfter"].(float64) >= 2000 {
		t.Fatalf("bob failing the same puzzle with the same operation id is his own first play from 2000: %d %v", status, lost)
	}
	if r, a := forkRating(alice); r != aliceAfter || a != 1 {
		t.Fatalf("bob's result must not touch alice, got %v/%v", r, a)
	}

	status, replay := call(bob, "POST", "/api/puzzles/result", map[string]any{"operationId": "shared-op", "puzzleId": picked, "theme": "fork", "solved": false})
	if status != http.StatusOK || replay["ratingAfter"] != lost["ratingAfter"] || replay["attempts"].(float64) != 1 {
		t.Fatalf("a repeated submission by the same account must not count twice: %d %v", status, replay)
	}

	today := time.Now().Format(time.DateOnly)
	path := fmt.Sprintf("/api/statistics?from=%s&to=%s", today, today)
	aliceStats, bobStats := map[string]any{}, map[string]any{}
	if status, aliceStats = call(alice, "GET", path, nil); status != http.StatusOK {
		t.Fatalf("alice statistics: %d %v", status, aliceStats)
	}
	if status, bobStats = call(bob, "GET", path, nil); status != http.StatusOK {
		t.Fatalf("bob statistics: %d %v", status, bobStats)
	}
	totals := func(stats map[string]any) float64 { return stats["totals"].(map[string]any)["puzzles"].(float64) }
	if totals(aliceStats) != 1 || totals(bobStats) != 1 {
		t.Fatalf("each account should see only its own single play: alice %v bob %v", totals(aliceStats), totals(bobStats))
	}
	syncOf := func(stats map[string]any) bool { return stats["puzzleSync"].(map[string]any)["configured"].(bool) }
	if !syncOf(aliceStats) || syncOf(bobStats) {
		t.Fatalf("only the account linked to the Lichess settings sees puzzle sync: alice %v bob %v", syncOf(aliceStats), syncOf(bobStats))
	}
	if status, out := call(bob, "POST", "/api/statistics/sync-puzzles", nil); status != http.StatusForbidden {
		t.Fatalf("bob must not be able to sync alice's Lichess puzzles, got %d %v", status, out)
	}
}
