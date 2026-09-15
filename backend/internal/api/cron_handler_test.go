package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRefreshAllRepertoiresRequiresCronSecret(t *testing.T) {
	h := &Handler{}

	t.Run("unset CRON_SECRET refuses outright, even with a header", func(t *testing.T) {
		t.Setenv("CRON_SECRET", "")
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/refresh-repertoires", nil)
		req.Header.Set("X-Cron-Secret", "anything")
		h.RefreshAllRepertoires(w, req)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
		}
	})

	t.Run("missing header is rejected", func(t *testing.T) {
		t.Setenv("CRON_SECRET", "the-real-secret")
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/refresh-repertoires", nil)
		h.RefreshAllRepertoires(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong secret is rejected", func(t *testing.T) {
		t.Setenv("CRON_SECRET", "the-real-secret")
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/refresh-repertoires", nil)
		req.Header.Set("X-Cron-Secret", "not-it")
		h.RefreshAllRepertoires(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
		}
	})

	t.Run("correct secret passes auth and only then hits the db-required check", func(t *testing.T) {
		// h.db is nil in this test Handler — proves the secret check runs
		// (and passes) before the 503 that a nil db store would otherwise
		// also produce, by checking the response is the DB message, not
		// the "not configured"/"unauthorized" ones from the two cases above.
		t.Setenv("CRON_SECRET", "the-real-secret")
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/cron/refresh-repertoires", nil)
		req.Header.Set("X-Cron-Secret", "the-real-secret")
		h.RefreshAllRepertoires(w, req)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
		}
		if body := w.Body.String(); !strings.Contains(body, "database sync") {
			t.Fatalf("body = %q, want it to mention database sync", body)
		}
	})
}
