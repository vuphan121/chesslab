package booksource

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Object struct {
	Key  string `json:"fileName"`
	Size int64  `json:"contentLength"`
}

type Lister interface {
	List(ctx context.Context, prefix string) ([]Object, error)
}

func (b *B2) apiCall(ctx context.Context, auth authorizeResponse, endpoint string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	apiURL := strings.TrimRight(auth.APIInfo.StorageAPI.APIURL, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL+"/b2api/v4/"+endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", auth.AuthorizationToken)
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("B2 %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("B2 %s: %s %s", endpoint, resp.Status, strings.TrimSpace(string(msg)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (b *B2) bucketID(ctx context.Context, auth authorizeResponse) (string, error) {
	if id := auth.APIInfo.StorageAPI.BucketID; id != "" {
		return id, nil
	}
	var out struct {
		Buckets []struct {
			BucketID string `json:"bucketId"`
		} `json:"buckets"`
	}
	err := b.apiCall(ctx, auth, "b2_list_buckets", map[string]any{"accountId": auth.AccountID, "bucketName": b.bucket}, &out)
	if err != nil {
		return "", err
	}
	if len(out.Buckets) == 0 {
		return "", fmt.Errorf("B2 bucket %q not found", b.bucket)
	}
	return out.Buckets[0].BucketID, nil
}

func (b *B2) List(ctx context.Context, prefix string) ([]Object, error) {
	auth, err := b.authorize(ctx, false)
	if err != nil {
		return nil, err
	}
	bucketID, err := b.bucketID(ctx, auth)
	if err != nil {
		return nil, err
	}
	var out struct {
		Files []Object `json:"files"`
	}
	err = b.apiCall(ctx, auth, "b2_list_file_names", map[string]any{"bucketId": bucketID, "prefix": prefix, "maxFileCount": 1000}, &out)
	if err != nil {
		return nil, err
	}
	return out.Files, nil
}

func (b *B2) Upload(ctx context.Context, objectKey, contentType string, data io.ReadSeeker, size int64) error {
	if !safeObjectKey(objectKey) {
		return fmt.Errorf("invalid B2 object key")
	}
	hash := sha1.New()
	if _, err := io.Copy(hash, data); err != nil {
		return err
	}
	if _, err := data.Seek(0, io.SeekStart); err != nil {
		return err
	}
	auth, err := b.authorize(ctx, false)
	if err != nil {
		return err
	}
	bucketID, err := b.bucketID(ctx, auth)
	if err != nil {
		return err
	}
	var target struct {
		UploadURL          string `json:"uploadUrl"`
		AuthorizationToken string `json:"authorizationToken"`
	}
	if err := b.apiCall(ctx, auth, "b2_get_upload_url", map[string]any{"bucketId": bucketID}, &target); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.UploadURL, data)
	if err != nil {
		return err
	}
	req.ContentLength = size
	req.Header.Set("Authorization", target.AuthorizationToken)
	req.Header.Set("X-Bz-File-Name", escapeObjectPath(objectKey))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Bz-Content-Sha1", hex.EncodeToString(hash.Sum(nil)))
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("upload to B2: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("upload to B2: %s %s", resp.Status, strings.TrimSpace(string(msg)))
	}
	return nil
}
