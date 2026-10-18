# Prompt-injection fixture corpus

Each `.txt` file is text that could plausibly arrive inside a user's own
document — a PDF someone shared, a web page saved to a knowledge base, a
filename. Every one of them is *addressed to the model*.

They exist because the injection defense in this product has two halves that
can each rot silently:

1. the provenance envelope (`internal/tools/envelope.go`), which marks where
   untrusted text starts and stops, and
2. the system prompt (`internal/capabilities/chat/prompt.go`), which says that
   text inside that boundary is evidence, never instruction.

A test that only asserted "the model behaved" would need a model. These
fixtures instead pin the properties the CODE is responsible for, which is what
a regression would actually break:

- the fixture text survives into the envelope intact (nothing silently strips
  it, so the model sees what the attacker wrote and the transcript shows it);
- a `</document>` in the body cannot close the envelope early;
- an attribute value cannot rewrite `trust="untrusted"`;
- an instruction to search another user's knowledge base returns a tool error
  and no rows — that one is enforced by authorization, not by wording, and it
  is the only defense here that does not depend on the model at all.

Phase 11 extended the corpus to one file per technique (38 on 2026-09-26) and
tightened what "inside the envelope" means: `internal/tools/injection_corpus_test.go`
reads the wrapped text the way a MODEL reads it — invisible format characters
removed, look-alike letters folded to Latin, full-width brackets as brackets —
and still requires exactly one opening and one closing tag. It also pins the
refusals that do not depend on the model: a URL a document names is never
fetched (only URLs this turn's search returned are), an id a document names
is refused by authorization, and a spoofed citation is dropped.

A model-in-the-loop evaluation (does a given model obey these?) needs a live
key and is not part of the test suite.
Adding a fixture: name it for the technique, one technique per file.
