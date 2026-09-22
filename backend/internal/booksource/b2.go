package booksource

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

const authorizeURL = "https://api.backblazeb2.com/b2api/v4/b2_authorize_account"

// B2 authorization tokens are valid for up to 24 hours; cache well under that
// so a clock-skew edge case never hands out a token B2 has already expired.
const authTokenTTL = 12 * time.Hour

var ErrNotFound = errors.New("book chapter not found")

type Reader interface {
	Open(ctx context.Context, objectKey string) (io.ReadCloser, error)
}

type B2Config struct {
	KeyID          string
	ApplicationKey string
	Bucket         string
	HTTPClient     *http.Client
	AuthorizeURL   string
}

type B2 struct {
	keyID          string
	applicationKey string
	bucket         string
	httpClient     *http.Client
	authorizeURL   string

	mu       sync.Mutex
	cached   *authorizeResponse
	cachedAt time.Time
}

func NewB2FromEnv() (*B2, error) {
	keyID := strings.TrimSpace(os.Getenv("B2_KEY_ID"))
	applicationKey := strings.TrimSpace(os.Getenv("B2_APPLICATION_KEY"))
	bucket := strings.TrimSpace(os.Getenv("B2_BUCKET"))
	if keyID == "" && applicationKey == "" && bucket == "" {
		return nil, nil
	}
	return NewB2(B2Config{KeyID: keyID, ApplicationKey: applicationKey, Bucket: bucket})
}

func NewB2(cfg B2Config) (*B2, error) {
	if strings.TrimSpace(cfg.KeyID) == "" || strings.TrimSpace(cfg.ApplicationKey) == "" || strings.TrimSpace(cfg.Bucket) == "" {
		return nil, fmt.Errorf("B2_KEY_ID, B2_APPLICATION_KEY, and B2_BUCKET must all be set")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 90 * time.Second}
	}
	if cfg.AuthorizeURL == "" {
		cfg.AuthorizeURL = authorizeURL
	}
	return &B2{
		keyID: cfg.KeyID, applicationKey: cfg.ApplicationKey, bucket: cfg.Bucket,
		httpClient: cfg.HTTPClient, authorizeURL: cfg.AuthorizeURL,
	}, nil
}

func (b *B2) Open(ctx context.Context, objectKey string) (io.ReadCloser, error) {
	if !safeObjectKey(objectKey) {
		return nil, fmt.Errorf("invalid B2 object key")
	}
	auth, err := b.authorize(ctx, false)
	if err != nil {
		return nil, err
	}
	resp, err := b.download(ctx, auth, objectKey)
	if err != nil {
		return nil, err
	}
	// A cached token that B2 has since revoked/expired (outside our own TTL
	// estimate) surfaces as 401 here, not from authorize() itself — force a
	// fresh token and retry exactly once rather than failing the request.
	if resp.StatusCode == http.StatusUnauthorized {
		resp.Body.Close()
		auth, err = b.authorize(ctx, true)
		if err != nil {
			return nil, err
		}
		resp, err = b.download(ctx, auth, objectKey)
		if err != nil {
			return nil, err
		}
	}
	if resp.StatusCode == http.StatusNotFound {
		resp.Body.Close()
		return nil, ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, fmt.Errorf("download B2 chapter: %s", resp.Status)
	}
	return resp.Body, nil
}

func (b *B2) download(ctx context.Context, auth authorizeResponse, objectKey string) (*http.Response, error) {
	downloadURL := strings.TrimRight(auth.APIInfo.StorageAPI.DownloadURL, "/") + "/file/" + url.PathEscape(b.bucket) + "/" + escapeObjectPath(objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create B2 download request: %w", err)
	}
	req.Header.Set("Authorization", auth.AuthorizationToken)
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download B2 chapter: %w", err)
	}
	return resp, nil
}

type authorizeResponse struct {
	AuthorizationToken string `json:"authorizationToken"`
	APIInfo            struct {
		StorageAPI struct {
			DownloadURL string `json:"downloadUrl"`
		} `json:"storageApi"`
	} `json:"apiInfo"`
}

// authorize returns a cached token when one is still within authTokenTTL,
// fetching a fresh one otherwise. force bypasses the cache (used by Open's
// retry-once-on-401 path when B2 has revoked/expired a cached token early).
func (b *B2) authorize(ctx context.Context, force bool) (authorizeResponse, error) {
	b.mu.Lock()
	if !force && b.cached != nil && time.Since(b.cachedAt) < authTokenTTL {
		auth := *b.cached
		b.mu.Unlock()
		return auth, nil
	}
	b.mu.Unlock()

	auth, err := b.fetchAuthorization(ctx)
	if err != nil {
		return authorizeResponse{}, err
	}

	b.mu.Lock()
	b.cached = &auth
	b.cachedAt = time.Now()
	b.mu.Unlock()
	return auth, nil
}

func (b *B2) fetchAuthorization(ctx context.Context) (authorizeResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.authorizeURL, nil)
	if err != nil {
		return authorizeResponse{}, fmt.Errorf("create B2 authorization request: %w", err)
	}
	credentials := base64.StdEncoding.EncodeToString([]byte(b.keyID + ":" + b.applicationKey))
	req.Header.Set("Authorization", "Basic "+credentials)
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return authorizeResponse{}, fmt.Errorf("authorize B2: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return authorizeResponse{}, fmt.Errorf("authorize B2: %s", resp.Status)
	}
	var auth authorizeResponse
	if err := json.NewDecoder(resp.Body).Decode(&auth); err != nil {
		return authorizeResponse{}, fmt.Errorf("decode B2 authorization: %w", err)
	}
	if auth.AuthorizationToken == "" || auth.APIInfo.StorageAPI.DownloadURL == "" {
		return authorizeResponse{}, fmt.Errorf("B2 authorization response omitted download details")
	}
	return auth, nil
}

func safeObjectKey(key string) bool {
	return key != "" && !strings.HasPrefix(key, "/") && path.Clean(key) == key && !strings.HasPrefix(key, "../")
}

func escapeObjectPath(key string) string {
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}
