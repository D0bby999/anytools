package chat

// suggestions.go picks the follow-ups offered under an answer.
//
// postclaw's rule RT#10, kept: suggestions are never written by the model. They
// are a pure function of what the turn did, so there is nothing to
// hallucinate, nothing to parse, and no second call on the learner's key. The
// server sends kinds; the client owns the words, in the learner's language.
//
// The kinds are study moves, not chat filler:
//   - check:   ask me a question to check I understood (retrieval practice);
//   - simpler: explain it more simply;
//   - example: a concrete example from my documents;
//   - broaden: nothing was found, so search again with other words.

const (
	suggestCheck   = "check"
	suggestSimpler = "simpler"
	suggestExample = "example"
	suggestBroaden = "broaden"
)

// suggestionsFor returns at most three kinds for an answer.
func suggestionsFor(cited int, work *workRecord, hasKBs, handover bool) []string {
	// An answer carrying a handover block is a step in the Loop, and its next
	// move is accepting the block, not another question.
	if handover {
		return nil
	}
	if cited > 0 {
		return []string{suggestCheck, suggestSimpler, suggestExample}
	}
	searched := false
	for _, s := range work.Steps {
		if s.Tool == "rag_search" {
			searched = true
			break
		}
	}
	if hasKBs && searched {
		return []string{suggestBroaden}
	}
	return nil
}
