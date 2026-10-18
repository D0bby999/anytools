// Package byok owns the user's own AI accounts: which credentials they have
// connected, which credential serves which capability, what to do when one
// fails, and whether the product is ready to run at all.
//
// Free + BYOK only. There is no platform key of any kind — LLM or search — so
// every call this package makes is made with a credential a user pasted, and a
// user who has connected nothing gets a clear "blocked" rather than a quiet
// fallback onto somebody else's quota.
package byok

// Function is one capability that can be routed to a connection.
//
// This constant list is the SINGLE definition. The migration's CHECK constraint
// repeats these strings because a CHECK cannot import Go, and
// functions_migration_test.go fails if the two ever disagree. Red-team RT-13
// found the plan's earlier enum missing `mastery` and `reading` for exactly the
// reason this test exists: the list was written twice, in prose, and the two
// copies drifted.
type Function string

const (
	// FunctionChat answers a grounded question from the knowledge base.
	FunctionChat Function = "chat"
	// FunctionParse turns an uploaded document into Markdown with page markers.
	FunctionParse Function = "parse"
	// FunctionEmbed turns text into vectors.
	FunctionEmbed Function = "embed"
	// FunctionQuiz generates questions with answers and explanations.
	FunctionQuiz Function = "quiz"
	// FunctionMastery builds and scores the mastery path.
	FunctionMastery Function = "mastery"
	// FunctionReading powers the immersive reading surface.
	FunctionReading Function = "reading"
	// FunctionSolve works a problem step by step.
	FunctionSolve Function = "solve"
	// FunctionResearch writes a sourced report. Its web-search KEY is a
	// search_connections row, never a route entry — a search key has no model
	// and no chain position.
	FunctionResearch Function = "research"
	// FunctionRerank reorders retrieved passages.
	FunctionRerank Function = "rerank"
	// FunctionTTS speaks an audio overview (learning depth, phase 10). It is
	// optional: without it the browser speaks the script live.
	FunctionTTS Function = "tts"
	// FunctionSTT transcribes speech: a video without captions, an audio file
	// (up-methods phase 21). Optional, like tts: the server's built-in engine
	// or the Gemini URL path may serve a learner who routes nothing here.
	FunctionSTT Function = "stt"
)

// allFunctions is the ordered list. Order is the order the Settings and
// readiness surfaces display, so it runs roughly in the sequence a user meets
// them rather than alphabetically.
var allFunctions = []Function{
	FunctionChat,
	FunctionParse,
	FunctionEmbed,
	FunctionQuiz,
	FunctionMastery,
	FunctionReading,
	FunctionSolve,
	FunctionResearch,
	FunctionRerank,
	FunctionTTS,
	FunctionSTT,
}

// AllFunctions returns every routable function, in display order. The returned
// slice is a copy: a caller that sorted or truncated the package's own slice
// would change the migration test's idea of what the enum is.
func AllFunctions() []Function {
	out := make([]Function, len(allFunctions))
	copy(out, allFunctions)
	return out
}

// ParseFunction validates a function name from a URL path or request body.
func ParseFunction(s string) (Function, bool) {
	for _, f := range allFunctions {
		if string(f) == s {
			return f, true
		}
	}
	return "", false
}

// Kind classifies what sort of client a function needs, which is what decides
// how it is verified and which seam resolves it.
type Kind int

const (
	// KindChat needs a providers.Provider — the great majority.
	KindChat Kind = iota
	// KindParse needs a parse.DocumentParser.
	KindParse
	// KindEmbed needs an embed.Embedder.
	KindEmbed
	// KindTTS needs a tts.Synthesizer.
	KindTTS
	// KindSTT needs an stt.Transcriber, or a Gemini key reading a video URL.
	KindSTT
)

// KindOf returns the client shape a function needs.
//
// Everything that is not parse or embed is a chat call, including rerank:
// AnyTools has no dedicated reranker lane, and a rerank prompt against the
// user's chat model is a capability every BYOK provider has. A cross-encoder
// reranker would be a fourth seam and a fourth verify probe for a phase that
// does not use it yet.
func KindOf(f Function) Kind {
	switch f {
	case FunctionParse:
		return KindParse
	case FunctionEmbed:
		return KindEmbed
	case FunctionTTS:
		return KindTTS
	case FunctionSTT:
		return KindSTT
	default:
		return KindChat
	}
}

// MaxChainEntries bounds a function's fallback chain.
//
// Five, because a chain is walked on the failure path: five entries means one
// unlucky turn can spend five provider timeouts before answering, which is
// already the outer edge of what a person will wait. The database CHECK repeats
// the number and the same test pins them together.
const MaxChainEntries = 5
