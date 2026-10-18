package providers

import "testing"

// Mistral answers 422 to any field its schema does not define, so the fields
// the OpenAI transport adds must not reach it — and must still reach everyone
// else, or streaming usage and reasoning effort are silently lost there.
func TestMistralRequestsCarryNoFieldMistralRejects(t *testing.T) {
	req := ChatRequest{
		Messages: []Message{{Role: "user", Content: "hi"}},
		Options: map[string]any{
			OptThinkingLevel:     "high",
			OptRepetitionPenalty: 1.1,
			OptEnableThinking:    true,
			OptTemperature:       0.3,
		},
	}
	mistral := NewOpenAIProvider(ProviderMistral, "k", "https://api.mistral.ai/v1", "m").buildRequestBody("m", req, true)
	for _, k := range strictSchemaDropped {
		if _, ok := mistral[k]; ok {
			t.Errorf("%s reached Mistral", k)
		}
	}
	if _, ok := mistral["temperature"]; !ok {
		t.Error("temperature was stripped, but Mistral accepts it")
	}

	other := NewOpenAIProvider(ProviderDeepSeek, "k", "https://api.deepseek.com/v1", "m").buildRequestBody("m", req, true)
	for _, k := range []string{"stream_options", OptReasoningEffort} {
		if _, ok := other[k]; !ok {
			t.Errorf("%s was stripped for a provider that accepts it", k)
		}
	}
}
