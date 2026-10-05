package api

import "testing"

func TestBuildID(t *testing.T) {
	t.Setenv("RENDER_GIT_COMMIT", "")
	if got := buildID(); got != "unknown" {
		t.Errorf("unset: got %q", got)
	}
	t.Setenv("RENDER_GIT_COMMIT", "0123456789abcdef")
	if got := buildID(); got != "0123456" {
		t.Errorf("long commit: got %q", got)
	}
	t.Setenv("RENDER_GIT_COMMIT", "abc")
	if got := buildID(); got != "abc" {
		t.Errorf("short commit: got %q", got)
	}
}
