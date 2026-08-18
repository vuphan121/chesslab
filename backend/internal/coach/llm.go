package coach

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type ChatMessage struct {
	Role       string
	Content    string
	ToolCallID string
	Name       string
	ToolCalls  []ToolCall
}

type ToolCall struct {
	ID        string
	Name      string
	Arguments string
}

type ToolDef struct {
	Name        string
	Description string
	Parameters  json.RawMessage
}

type ChatResult struct {
	Content   string
	ToolCalls []ToolCall
}

type LLMClient interface {
	Chat(ctx context.Context, systemPrompt, userPrompt string) (string, error)
	ChatCompletion(ctx context.Context, messages []ChatMessage, tools []ToolDef) (ChatResult, error)
}

type OllamaClient struct {
	BaseURL string
	Model   string
	HTTP    *http.Client
}

func NewOllamaClient(baseURL, model string) *OllamaClient {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	if model == "" {
		model = "llama3.1:8b"
	}
	return &OllamaClient{
		BaseURL: baseURL,
		Model:   model,
		HTTP:    &http.Client{Timeout: 90 * time.Second},
	}
}

type wireFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type wireToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function wireFunctionCall `json:"function"`
}

type wireMessage struct {
	Role       string         `json:"role"`
	Content    string         `json:"content"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
	Name       string         `json:"name,omitempty"`
	ToolCalls  []wireToolCall `json:"tool_calls,omitempty"`
}

type wireFunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

type wireTool struct {
	Type     string          `json:"type"`
	Function wireFunctionDef `json:"function"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []wireMessage `json:"messages"`
	Tools    []wireTool    `json:"tools,omitempty"`
	Stream   bool          `json:"stream"`
}

type chatResponse struct {
	Choices []struct {
		Message wireMessage `json:"message"`
	} `json:"choices"`
	Error string `json:"error"`
}

func (c *OllamaClient) Chat(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	result, err := c.ChatCompletion(ctx, []ChatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userPrompt},
	}, nil)
	if err != nil {
		return "", err
	}
	return result.Content, nil
}

func (c *OllamaClient) ChatCompletion(ctx context.Context, messages []ChatMessage, tools []ToolDef) (ChatResult, error) {
	reqBody := chatRequest{
		Model:    c.Model,
		Messages: toWireMessages(messages),
		Tools:    toWireTools(tools),
		Stream:   false,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return ChatResult{}, fmt.Errorf("marshaling chat request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResult{}, fmt.Errorf("building chat request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return ChatResult{}, fmt.Errorf("calling local LLM at %s: %w", c.BaseURL, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ChatResult{}, fmt.Errorf("reading chat response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return ChatResult{}, fmt.Errorf("local LLM returned %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed chatResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return ChatResult{}, fmt.Errorf("parsing chat response: %w", err)
	}
	if parsed.Error != "" {
		return ChatResult{}, fmt.Errorf("local LLM error: %s", parsed.Error)
	}
	if len(parsed.Choices) == 0 {
		return ChatResult{}, fmt.Errorf("local LLM returned no choices")
	}

	msg := parsed.Choices[0].Message
	result := ChatResult{Content: msg.Content}
	for _, tc := range msg.ToolCalls {
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: tc.Function.Arguments,
		})
	}
	return result, nil
}

func toWireMessages(messages []ChatMessage) []wireMessage {
	out := make([]wireMessage, 0, len(messages))
	for _, m := range messages {
		wm := wireMessage{
			Role:       m.Role,
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
			Name:       m.Name,
		}
		for _, tc := range m.ToolCalls {
			wm.ToolCalls = append(wm.ToolCalls, wireToolCall{
				ID:   tc.ID,
				Type: "function",
				Function: wireFunctionCall{
					Name:      tc.Name,
					Arguments: tc.Arguments,
				},
			})
		}
		out = append(out, wm)
	}
	return out
}

func toWireTools(tools []ToolDef) []wireTool {
	if len(tools) == 0 {
		return nil
	}
	out := make([]wireTool, 0, len(tools))
	for _, t := range tools {
		out = append(out, wireTool{
			Type: "function",
			Function: wireFunctionDef{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.Parameters,
			},
		})
	}
	return out
}
