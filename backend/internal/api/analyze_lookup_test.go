package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/chesslab/backend/internal/chess"
	"github.com/chesslab/backend/internal/storage"
	"github.com/go-chi/chi/v5"
)

const matedFEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"

func analyzeRequest(t *testing.T, h *Handler, gameID, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/games/"+gameID+"/analysis?"+query, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", gameID)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
	rec := httptest.NewRecorder()
	h.AnalyzeGame(rec, req)
	return rec
}

func newAnalysisTestHandler(t *testing.T) (*Handler, string) {
	t.Helper()
	store := storage.NewMemory()
	g, err := chess.NewGameFromFEN("g1", matedFEN)
	if err != nil {
		t.Fatal(err)
	}
	store.Save(g)
	h := &Handler{
		store:           store,
		analysisCache:   make(map[string]cachedAnalysis),
		prefetchedCloud: make(map[string]prefetchedCloudEval),
		prefetchSem:     make(chan struct{}, 1),
	}
	return h, "g1"
}

func TestLookupOnlyNeverRunsTheEngine(t *testing.T) {
	h, id := newAnalysisTestHandler(t)
	fen := "&fen=" + url.QueryEscape(matedFEN)

	first := analyzeRequest(t, h, id, "source=lookup"+fen)
	if first.Code != http.StatusNoContent {
		t.Fatalf("lookup on a finished game: status = %d, want 204", first.Code)
	}
	if entry, ok := h.analysisCache[matedFEN+"|lookup"]; !ok || entry.value.EngineName != "" || time.Now().After(entry.expiresAt) {
		t.Fatalf("expected a negative cache entry for the lookup, got %+v (present=%v)", entry, ok)
	}
	second := analyzeRequest(t, h, id, "source=lookup"+fen)
	if second.Code != http.StatusNoContent {
		t.Fatalf("cached negative lookup: status = %d, want 204", second.Code)
	}
}

func TestNormalAnalysisOfAFinishedGameStillReturnsAResult(t *testing.T) {
	h, id := newAnalysisTestHandler(t)
	rec := analyzeRequest(t, h, id, "fen="+url.QueryEscape(matedFEN))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (unchanged behaviour without source=lookup)", rec.Code)
	}
}

func TestEvalOfAFinishedGameShortCircuitsBeforeAnyLookup(t *testing.T) {
	h := &Handler{}
	req := httptest.NewRequest(http.MethodGet, "/api/eval?source=lookup&fen="+url.QueryEscape(matedFEN), nil)
	rec := httptest.NewRecorder()
	h.EvalFEN(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 with an empty evaluation for a finished game", rec.Code)
	}
}
