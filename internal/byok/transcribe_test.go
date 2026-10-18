package byok_test

import (
	"context"
	"errors"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Only Gemini API keys on the parse route transcribe videos: an OpenAI entry
// ahead of it is passed over, and a route with no Gemini key is an empty
// chain, which the Knowledge Center turns into "upload or paste".
func TestTranscriberForUsesOnlyGeminiKeysOnTheParseRoute(t *testing.T) {
	svc, conns, routes := newService(t)
	user := testutil.NewUser(t, testutil.TestDB(t))
	ctx := context.Background()

	openai, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "oa", Secret: "sk-x"})
	if err != nil {
		t.Fatal(err)
	}
	if err := routes.ReplaceRoute(ctx, user, "parse", []store.RouteEntryInput{{ConnectionID: openai.ID, Model: "gpt-x"}}); err != nil {
		t.Fatal(err)
	}
	chain, err := svc.TranscriberFor(ctx, user)
	if err != nil || chain.Len() != 0 {
		t.Fatalf("OpenAI only: %d entries, %v", chain.Len(), err)
	}
	if err := chain.Do(ctx, nil); !errors.Is(err, byok.ErrNoRoute) {
		t.Fatalf("empty chain: %v", err)
	}

	gemini, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: "g", Secret: "AIza-x"})
	if err != nil {
		t.Fatal(err)
	}
	if err := routes.ReplaceRoute(ctx, user, "parse", []store.RouteEntryInput{
		{ConnectionID: openai.ID, Model: "gpt-x"},
		{ConnectionID: gemini.ID, Model: "gemini-3.6-flash"},
	}); err != nil {
		t.Fatal(err)
	}
	chain, err = svc.TranscriberFor(ctx, user)
	if err != nil || chain.Len() != 1 {
		t.Fatalf("mixed route: %d entries, %v", chain.Len(), err)
	}
	e := chain.Entries()[0]
	if e.ConnectionID != gemini.ID || e.Client.Model() != "gemini-3.6-flash" {
		t.Fatalf("entry = %+v", e)
	}
}
