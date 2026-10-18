package providers

// openai_strict_compat.go — Mistral's chat endpoint validates its request body
// strictly: a field it does not define fails the call with 422
// "extra_forbidden" instead of being ignored. The OpenAI transport sends a few
// such fields (stream_options on every stream, the reasoning/DashScope
// passthroughs when a caller sets them), so a Mistral connection gets them
// stripped. Mistral reports streaming usage in its final chunk without being
// asked, so dropping stream_options loses nothing.

// strictSchemaDropped are the body fields Mistral does not define.
var strictSchemaDropped = []string{
	"stream_options",
	"repetition_penalty",
	OptReasoningEffort,
	OptEnableThinking,
	OptThinkingBudget,
}

// applyStrictSchemaCompat strips strictSchemaDropped for providers that
// refuse unknown fields. A no-op for every other provider.
func (p *OpenAIProvider) applyStrictSchemaCompat(body map[string]interface{}) {
	if p.name != ProviderMistral {
		return
	}
	for _, k := range strictSchemaDropped {
		delete(body, k)
	}
}
