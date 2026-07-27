package coach

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// maxToolIterations bounds the tool-call loop so a confused model can't spin
// forever — each iteration is one round-trip to the local LLM.
const maxToolIterations = 4

const agentSystemPrompt = `You are a chess opening coach answering freeform follow-up questions about
a game in progress. You are NOT a chess engine — never invent tactical or positional claims from
memory. Use the tools available to you to get real data:

- analyze_position: Stockfish/Lichess evaluation and best lines for any FEN.
- explorer_stats: Lichess opening-explorer game stats (win rates, popularity) for any FEN.
- retrieve_theory: curated book commentary for an exact FEN (position-specific), if the corpus
  covers it (currently just the Sicilian Accelerated Dragon — most positions won't match, which is
  fine). If there's no exact match, the result may still include "nearby" hints — positions a few
  moves ahead, via the same continuation, that ARE covered. Use those only to say this position can
  transpose toward known theory; never present them as commentary on the position you asked about,
  and never describe those further-ahead moves as already played.
- retrieve_opening_context: curated book prose ABOUT an opening as a whole — its introduction,
  strategic philosophy, typical plans, why players choose it, move-order notes. Use this (not
  retrieve_theory) when the user asks a general question about the opening rather than about one
  position, e.g. "what's the idea behind the Accelerated Dragon?" or "why would I play this?".
- classify_move: move-quality verdict for a move given the FEN before and after it. It returns BOTH
  an engineCategory (raw eval grade) and a book-aware category, plus a bookStatus and a "note".
- evaluate_move: THE tool for "from this position, can I play <move>?" — give it a FEN and a move
  (SAN like "Nf3"/"O-O" or UCI like "g1f3"). The engine checks legality, and if legal returns the
  resulting position and the same book-aware quality verdict as classify_move. Always use this to
  judge a move the user names (never guess the resulting position yourself).

` + gambitPhilosophy + `

Call tools whenever the question needs current facts about a position you don't already have in
this conversation. Don't call a tool for something you already know from earlier in the
conversation. Once you have what you need, answer in 2-5 sentences, coach voice: direct and
concrete, no filler — but never trade away the actual substance to stay short. If a tool result
gives you a concrete reason (what a move stops, prepares, fights for, or transposes to; a tactical
point; a plan), state that reason plainly rather than a generic verdict like "this is a solid book
move." Only stay to 1-2 sentences when there genuinely is nothing concrete beyond the verdict itself.
Never restate the same point twice in different words just to fill space.
` + generalPrinciples

// ChatTurn is one message in the conversation history the frontend maintains
// and resends — the coach agent itself is stateless between requests.
type ChatTurn struct {
	Role    string // "user" or "assistant"
	Content string
}

// PositionContext tells the agent what's currently on the board, so the user
// can ask "was my last move good?" without pasting FENs — the caller (the
// HTTP handler) reads this straight from the game store.
type PositionContext struct {
	FEN         string // current position
	PrevFEN     string // position before the last move, empty at the game's start
	LastMoveSAN string
}

// Agent is the freeform, tool-calling coach chat (design doc "Path 2") —
// unlike Service (Path 1), it has its own engine access so it can fetch
// analysis/explorer data for positions the frontend hasn't already looked up.
type Agent struct {
	Tools *Tools
	LLM   LLMClient
}

func NewAgent(tools *Tools, llm LLMClient) *Agent {
	return &Agent{Tools: tools, LLM: llm}
}

// Chat answers one user message, running the tool-call loop as needed, and
// returns the final assistant reply text.
func (a *Agent) Chat(ctx context.Context, pos PositionContext, history []ChatTurn, userMessage string) (string, error) {
	messages := []ChatMessage{
		{Role: "system", Content: agentSystemPrompt},
		{Role: "system", Content: buildPositionContextMessage(pos)},
	}
	for _, t := range history {
		messages = append(messages, ChatMessage{Role: t.Role, Content: t.Content})
	}
	messages = append(messages, ChatMessage{Role: "user", Content: userMessage})

	tools := toolDefs()

	for i := 0; i < maxToolIterations; i++ {
		result, err := a.LLM.ChatCompletion(ctx, messages, tools)
		if err != nil {
			return "", err
		}
		if len(result.ToolCalls) == 0 {
			return result.Content, nil
		}

		messages = append(messages, ChatMessage{Role: "assistant", Content: result.Content, ToolCalls: result.ToolCalls})
		for _, tc := range result.ToolCalls {
			output := a.executeTool(tc.Name, tc.Arguments)
			messages = append(messages, ChatMessage{Role: "tool", ToolCallID: tc.ID, Name: tc.Name, Content: output})
		}
	}

	return "", fmt.Errorf("coach agent: exceeded %d tool-call iterations without a final answer", maxToolIterations)
}

func buildPositionContextMessage(pos PositionContext) string {
	var b strings.Builder
	b.WriteString("Current game state:\n")
	fmt.Fprintf(&b, "- Current position (FEN): %s\n", pos.FEN)
	if pos.LastMoveSAN != "" {
		fmt.Fprintf(&b, "- Last move played: %s\n", pos.LastMoveSAN)
	}
	if pos.PrevFEN != "" {
		fmt.Fprintf(&b, "- Position before that move (FEN): %s\n", pos.PrevFEN)
		b.WriteString("  (use this with classify_move's fenBefore/fenAfter to judge the last move, without asking the user for FENs)\n")
	}
	b.WriteString("When the user asks whether they can/should play a move \"from this position\" or \"here\", " +
		"call evaluate_move with the Current position FEN above and the move they named.\n")
	return b.String()
}

func toolDefs() []ToolDef {
	fenOnlySchema := json.RawMessage(`{
		"type": "object",
		"properties": { "fen": { "type": "string", "description": "FEN of the position" } },
		"required": ["fen"]
	}`)

	return []ToolDef{
		{
			Name:        "analyze_position",
			Description: "Runs Stockfish (or Lichess's cached cloud eval) on a FEN. Returns evaluation and best lines from the perspective of the side to move in that FEN.",
			Parameters:  fenOnlySchema,
		},
		{
			Name:        "explorer_stats",
			Description: "Looks up Lichess opening-explorer stats (rated 2000+ games) for a FEN — per-move game counts, share%, and win/draw/loss split.",
			Parameters:  fenOnlySchema,
		},
		{
			Name:        "retrieve_theory",
			Description: "Looks up curated opening-theory book commentary for an exact FEN (position-specific). Only covers specific book lines (currently: Sicilian Accelerated Dragon) — most positions will have no match, which is a normal result, not an error.",
			Parameters:  fenOnlySchema,
		},
		{
			Name:        "retrieve_opening_context",
			Description: "Searches curated book prose ABOUT an opening as a whole — introduction, strategic philosophy, typical plans, why it's chosen, move-order notes — by keyword query (not by FEN). Use for general questions about an opening rather than about one position. Pass a query including the opening name and the topic, e.g. \"Accelerated Dragon philosophy initiative\".",
			Parameters: json.RawMessage(`{
				"type": "object",
				"properties": { "query": { "type": "string", "description": "keywords: opening name + what you want to know about it" } },
				"required": ["query"]
			}`),
		},
		{
			Name:        "evaluate_move",
			Description: "Given a FEN and a move the user named (SAN like \"Nf3\"/\"O-O\" or UCI like \"g1f3\"), applies it with the engine and returns whether it's `legal`, the canonical `move` SAN, the `resultingFen`, and a book-aware `quality` verdict (same shape as classify_move). Use this for any \"can I play X from here?\" / \"is X a good move here?\" question — do not compute the resulting position yourself.",
			Parameters: json.RawMessage(`{
				"type": "object",
				"properties": {
					"fen": { "type": "string", "description": "FEN of the position to play the move from" },
					"move": { "type": "string", "description": "the move in SAN (e.g. Nf3, O-O, exd5) or UCI (e.g. g1f3)" }
				},
				"required": ["fen", "move"]
			}`),
		},
		{
			Name:        "classify_move",
			Description: "Book-aware move-quality verdict for a move, given the FEN before and after it. Returns `engineCategory` (raw eval grade: Best/Excellent/Good/Inaccuracy/Mistake/Blunder), `category` (the human-facing verdict — becomes \"Book\" when the move is established theory that the engine happens to dislike, e.g. a gambit), `bookStatus` (established/rare/novelty/unknown), `bookGames`, `openingName`, and a `note` explaining how to present it. TRUST the `category` and `note` over `engineCategory`: do not call an established/gambit line a mistake just because the engine eval dips. (If you only have the position before the move, prefer evaluate_move, which computes the after-position for you.)",
			Parameters: json.RawMessage(`{
				"type": "object",
				"properties": {
					"fenBefore": { "type": "string", "description": "FEN before the move was played" },
					"fenAfter": { "type": "string", "description": "FEN after the move was played" }
				},
				"required": ["fenBefore", "fenAfter"]
			}`),
		},
	}
}

// executeTool runs one tool call and returns its JSON-encoded result (or a
// JSON-encoded {"error": "..."} — fed back to the model as the tool's
// output rather than aborting the conversation, so it can adapt).
func (a *Agent) executeTool(name, argsJSON string) string {
	var fenArgs struct {
		FEN string `json:"fen"`
	}

	switch name {
	case "analyze_position":
		if err := json.Unmarshal([]byte(argsJSON), &fenArgs); err != nil {
			return toolError(err)
		}
		result, err := a.Tools.AnalyzePosition(fenArgs.FEN)
		if err != nil {
			return toolError(err)
		}
		return toolJSON(result)

	case "explorer_stats":
		if err := json.Unmarshal([]byte(argsJSON), &fenArgs); err != nil {
			return toolError(err)
		}
		result, err := a.Tools.ExplorerStats(fenArgs.FEN)
		if err != nil {
			return toolError(err)
		}
		return toolJSON(result)

	case "retrieve_theory":
		if err := json.Unmarshal([]byte(argsJSON), &fenArgs); err != nil {
			return toolError(err)
		}
		theory := a.Tools.RetrieveTheory(fenArgs.FEN)
		if len(theory.Exact) > 0 {
			return toolJSON(struct {
				Chunks []Chunk `json:"chunks"`
			}{Chunks: theory.Exact})
		}
		if len(theory.Prefix) > 0 {
			return toolJSON(struct {
				Chunks []Chunk       `json:"chunks"`
				Nearby []TheoryMatch `json:"nearby"`
				Note   string        `json:"note"`
			}{
				Chunks: nil,
				Nearby: theory.Prefix,
				Note: "no commentary covers this exact position, but 'nearby' lists positions a few plies " +
					"ahead (via the same continuation) that the corpus DOES cover — pliesAhead is how many " +
					"half-moves from now. Use these only as directional/transposition hints (\"this can " +
					"continue toward...\"), never as commentary on the current position or as moves already played.",
			})
		}
		return `{"chunks": [], "note": "no book commentary covers this exact position or anything nearby"}`

	case "retrieve_opening_context":
		var args struct {
			Query string `json:"query"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return toolError(err)
		}
		chunks := a.Tools.RetrieveOpeningContext(args.Query)
		if len(chunks) == 0 {
			return `{"chunks": [], "note": "no opening-context prose matched this query"}`
		}
		return toolJSON(struct {
			Chunks []OverviewChunk `json:"chunks"`
		}{Chunks: chunks})

	case "classify_move":
		var args struct {
			FenBefore string `json:"fenBefore"`
			FenAfter  string `json:"fenAfter"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return toolError(err)
		}
		quality, err := a.Tools.ClassifyMove(args.FenBefore, args.FenAfter)
		if err != nil {
			return toolError(err)
		}
		return toolJSON(quality)

	case "evaluate_move":
		var args struct {
			FEN  string `json:"fen"`
			Move string `json:"move"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return toolError(err)
		}
		result, err := a.Tools.EvaluateMove(args.FEN, args.Move)
		if err != nil {
			return toolError(err)
		}
		return toolJSON(result)

	default:
		return toolError(fmt.Errorf("unknown tool %q", name))
	}
}

func toolJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return toolError(err)
	}
	return string(b)
}

func toolError(err error) string {
	b, _ := json.Marshal(struct {
		Error string `json:"error"`
	}{Error: err.Error()})
	return string(b)
}
