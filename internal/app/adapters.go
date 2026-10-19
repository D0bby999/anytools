package app

// adapters.go holds every seam between two subsystems that were built on
// different branches against consumer-defined interfaces.
//
// The rule this file exists to keep: a package declares the interface it needs
// (`knowledge.Providers`, `runtime.ChatProviderResolver`, `tools.Retriever` …)
// and NOTHING in that package knows who implements it. The implementations
// live here, in the one package that is allowed to import everything, so that
// adding phase 7's quiz capability does not mean phase 5 growing an import of
// phase 4.
//
// Every adapter below replaced a stand-in that was deliberately honest rather
// than fake — `unconfiguredProviders`, `runtime.UnavailableResolver`, a nil
// authorizer, three unmounted tools. The stand-ins are gone; what each of them
// used to say ("no provider is configured") is now said only when it is true.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// ─────────────────────────────────────────── knowledge.Providers over BYOK

// ErrNoEmbedRoute is what the Knowledge Center gets when the user has routed
// no embedding model. knowledge.ProcessDocument turns it into the sentence the
// document row carries, so the text here is for logs, not for a person.
var ErrNoEmbedRoute = errors.New("no embedding model is configured for this account")

// byokProviders resolves a user's parse and embed lanes at the moment a job
// runs — never at boot, because a credential can be revoked between the upload
// and the parse, and a service holding one Embedder would be holding one user's
// key for everybody.
type byokProviders struct{ svc *byok.Service }

// newProviders wires the Knowledge Center's provider seam onto BYOK.
func newProviders(svc *byok.Service) knowledge.Providers { return byokProviders{svc: svc} }

// ParserChain returns the user's PDF-reading chain, best first.
//
// The chain is handed over whole rather than walked here: parse.Batcher owns
// the walk, because only it knows that a fallback means restarting the document
// from page 1, and only it can publish the downgrade event RT-14 asks for.
//
// A connection on cooldown is dropped — that is the byok chain's own rule, and
// the point of persisting a cooldown is not to spend a request rediscovering
// it. But if EVERY entry is cooling down the whole chain is kept: an empty
// chain means "no model is configured", and telling a user to add a key they
// already added is worse than one likely-429 call.
func (p byokProviders) ParserChain(ctx context.Context, userID knowledge.UserID) ([]knowledge.Parser, error) {
	chain, err := p.svc.ParserFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	entries := chain.Entries()
	if len(entries) == 0 {
		// Not an error: a user with no parse route can still index .docx,
		// .pptx, .epub, .md, .txt and any PDF that carries a text layer.
		return nil, nil
	}

	now := time.Now()
	usable := make([]byok.Entry[parse.DocumentParser], 0, len(entries))
	for _, e := range entries {
		if !e.Settings.CoolingDownAt(now) {
			usable = append(usable, e)
		}
	}
	if len(usable) == 0 {
		usable = entries
	}

	out := make([]knowledge.Parser, 0, len(usable))
	for _, e := range usable {
		out = append(out, pageParser{inner: e.Client})
	}
	return out, nil
}

// EmbedderFor returns the FIRST routed embedding lane, and only the first.
//
// This is the one seam where the byok chain's failover is deliberately not
// used. A knowledge base pins exactly one embedding model and one width
// (knowledge.Store.PinEmbeddingRoute); silently answering a batch from a second
// lane would write vectors from a different space into the same column, where
// every distance comparison against them is meaningless and every result still
// looks plausible. Failing is the correct answer — the user fixes the route.
func (p byokProviders) EmbedderFor(ctx context.Context, userID knowledge.UserID) (knowledge.Embedder, error) {
	chain, err := p.svc.EmbedderFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	entries := chain.Entries()
	if len(entries) == 0 {
		return nil, ErrNoEmbedRoute
	}
	return routedEmbedder{inner: entries[0].Client}, nil
}

// pageParser adapts a parse.DocumentParser (phase 4's client shape: bytes plus
// two page numbers) to parse.PageParser (phase 5's seam: one PageRequest).
//
// The two exist separately because phase 4 owns the wire formats and phase 5
// owns the windowing; this is the entire difference between them.
type pageParser struct{ inner parse.DocumentParser }

// ProviderName is the LANE, not the model: it is stored in
// documents.processed_by and shown to the user next to the model id.
func (p pageParser) ProviderName() string { return p.inner.Name() }

// ParsePages converts one window. A photo (up-methods phase 16) is one page
// whose request carries the photo's own type.
func (p pageParser) ParsePages(ctx context.Context, req parse.PageRequest) (parse.PageResult, error) {
	var (
		res parse.Result
		err error
	)
	if parse.IsImageMIME(req.MIME) {
		res, err = p.inner.ParseImage(ctx, req.Data, req.MIME)
	} else {
		res, err = p.inner.ParsePages(ctx, req.Data, req.Start, req.End)
	}
	if err != nil {
		return parse.PageResult{}, err
	}
	return parse.PageResult{
		Markdown:     res.Markdown,
		Finish:       pageFinish(res),
		Model:        p.inner.Model(),
		InputTokens:  res.InputTokens,
		OutputTokens: res.OutputTokens,
	}, nil
}

// pageFinish maps a client's stop field onto the three outcomes the batcher
// acts on.
//
// The distinction is load-bearing and is not cosmetic: PageFinishTruncated
// makes the batcher halve the window and re-parse, which is how a 10-page
// request that hit an output ceiling still produces all ten pages.
// PageFinishOther does not, because halving a window a safety filter refused
// just refuses it four more times.
//
// parse.Result carries `Truncated` for "did not stop cleanly", which is a
// superset of both. The reason strings below are the three clients' own:
// Gemini MAX_TOKENS, OpenAI incomplete:max_output_tokens, Anthropic max_tokens.
func pageFinish(res parse.Result) parse.PageFinish {
	if !res.Truncated {
		return parse.PageFinishStop
	}
	reason := strings.ToLower(res.FinishReason)
	switch {
	case strings.Contains(reason, "max_tokens"),
		strings.Contains(reason, "max_output_tokens"),
		strings.Contains(reason, "length"):
		return parse.PageFinishTruncated
	}
	return parse.PageFinishOther
}

// routedEmbedder adapts embed.Embedder to knowledge.Embedder. The shapes differ
// in one place only: knowledge needs the WIDTH back with the vectors, because
// it stores the native width beside a zero-padded vector and a query filters on
// it.
type routedEmbedder struct{ inner embed.Embedder }

func (e routedEmbedder) Model() string        { return e.inner.Model() }
func (e routedEmbedder) ProviderName() string { return e.inner.Name() }

// Embed returns one vector per input, in order, plus the width they share.
//
// The width is measured off the vectors rather than read from
// embed.Embedder.Dims(), which is legitimately zero for a route nobody has
// verified. Measuring it also catches the case the caller cannot: a provider
// that returns a ragged batch would otherwise be stored as if every row were
// the pinned width.
func (e routedEmbedder) Embed(ctx context.Context, texts []string, task knowledge.EmbedTask) ([][]float32, int, error) {
	vectors, err := e.inner.Embed(ctx, texts, embedTask(task))
	if err != nil {
		return nil, 0, err
	}
	if len(vectors) == 0 {
		return nil, 0, nil
	}
	dims := len(vectors[0])
	for i, v := range vectors {
		if len(v) != dims {
			return nil, 0, fmt.Errorf("%w: vector %d is %d wide, the batch is %d",
				embed.ErrDimensionMismatch, i, len(v), dims)
		}
	}
	return vectors, dims, nil
}

// embedTask is total over knowledge.EmbedTask. An unknown value maps to the
// QUERY type for the reason embed.geminiTaskType gives: a query embedded as a
// document is one bad search, a corpus embedded as queries is a bad index.
func embedTask(t knowledge.EmbedTask) embed.Task {
	if t == knowledge.EmbedDocument {
		return embed.TaskDocument
	}
	return embed.TaskQuery
}

// ──────────────────────────────── runtime.ChatProviderResolver over BYOK

// byokChatResolver resolves the user's chat chain per TURN.
//
// Per turn and not per process: a user can rotate a key or reorder their chain
// between two turns of one session, and the turn row records which connection
// actually served it (AC3).
type byokChatResolver struct{ svc *byok.Service }

// newChatResolver wires the runtime's provider seam onto BYOK.
func newChatResolver(svc *byok.Service) runtime.ChatProviderResolver {
	return byokChatResolver{svc: svc}
}

// ChatFor implements runtime.ChatProviderResolver.
//
// Every "the user has nothing usable here" case collapses to
// runtime.ErrNoProvider, which the orchestrator classifies as NO_PROVIDER and
// marks NOT retryable — correct, because the fix is in Settings, not in trying
// again.
func (r byokChatResolver) ChatFor(ctx context.Context, userID uuid.UUID, function string) (runtime.ChatProvider, error) {
	return r.ChatPreferring(ctx, userID, function, uuid.Nil, "")
}

// ChatPreferring implements runtime.PreferringResolver: the same chain with
// the learner's pick for the conversation tried first. The rest of the route
// stays behind it, so a pick in cooldown still gets an answer, and the turn
// row says which connection gave it (RT-14).
func (r byokChatResolver) ChatPreferring(
	ctx context.Context, userID uuid.UUID, function string, connectionID uuid.UUID, model string,
) (runtime.ChatProvider, error) {
	fn, ok := byok.ParseFunction(function)
	if !ok {
		return nil, fmt.Errorf("%w: %q is not a routable function", runtime.ErrNoProvider, function)
	}
	chain, err := r.svc.ChatFor(ctx, userID, fn)
	if err != nil {
		if errors.Is(err, byok.ErrNoRoute) {
			return nil, runtime.ErrNoProvider
		}
		return nil, err
	}
	if chain.Len() == 0 {
		// Either nothing is routed, or every routed entry was unbuildable —
		// a disabled subscription lane, or a provider with no chat client.
		// Both are "configure something in Settings".
		return nil, runtime.ErrNoProvider
	}
	if connectionID != uuid.Nil {
		chain.Prefer(connectionID, model)
	}
	first := chain.Entries()[0]
	return &chatChain{
		chain:         chain,
		firstProvider: first.Provider,
		firstModel:    entryModel(first),
	}, nil
}

func entryModel(e byok.Entry[providers.Provider]) string {
	if e.Model != "" {
		return e.Model
	}
	return e.Client.DefaultModel()
}

// chatChain is one turn's view of the user's chat chain as a single
// runtime.ChatProvider.
//
// Name() and DefaultModel() report the connection that ACTUALLY answered once
// one has, and the first entry before that. The capability re-reads them after
// each call and writes them onto the turn row, so a silent downgrade to the
// second lane is visible rather than recorded as the first (RT-14).
type chatChain struct {
	chain         *byok.Chain[providers.Provider]
	firstProvider string
	firstModel    string

	served     atomic.Pointer[servedLane]
	streamUsed atomic.Bool
}

type servedLane struct{ provider, model string }

// Name implements runtime.ChatProvider.
func (c *chatChain) Name() string {
	if s := c.served.Load(); s != nil {
		return s.provider
	}
	return c.firstProvider
}

// DefaultModel implements runtime.ChatProvider: the model the chain will use,
// or — after a call — the one it used.
func (c *chatChain) DefaultModel() string {
	if s := c.served.Load(); s != nil {
		return s.model
	}
	return c.firstModel
}

// Chat implements runtime.ChatProvider.
func (c *chatChain) Chat(ctx context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	return c.call(ctx, req, nil)
}

// ChatStream implements runtime.ChatProvider.
func (c *chatChain) ChatStream(ctx context.Context, req runtime.ChatRequest, onChunk func(runtime.StreamChunk)) (*runtime.ChatResponse, error) {
	return c.call(ctx, req, onChunk)
}

// call walks the chain, converting DTOs in both directions.
//
// The one rule here that is not plumbing: once a chunk has reached the caller,
// a failure is wrapped in byok.ErrStopChain. The chain's normal move is to try
// the next connection, and the next connection starts its answer from the
// beginning — into a stream the reader is already watching, with no frame that
// means "ignore the last four sentences". The failed entry is still benched;
// only the walk stops.
func (c *chatChain) call(
	ctx context.Context, req runtime.ChatRequest, onChunk func(runtime.StreamChunk),
) (*runtime.ChatResponse, error) {
	var out *runtime.ChatResponse

	err := c.chain.Do(ctx, func(ctx context.Context, client providers.Provider, e byok.Entry[providers.Provider]) error {
		model := c.modelFor(req.Model, e)
		pr := toProviderRequest(req, model)

		var (
			resp    *providers.ChatResponse
			callErr error
		)
		if onChunk == nil {
			resp, callErr = client.Chat(ctx, pr)
		} else {
			resp, callErr = client.ChatStream(ctx, pr, func(chunk providers.StreamChunk) {
				if chunk.Content != "" || chunk.Thinking != "" {
					c.streamUsed.Store(true)
				}
				onChunk(runtime.StreamChunk{
					Content: chunk.Content, Thinking: chunk.Thinking, Done: chunk.Done,
				})
			})
		}

		if callErr != nil {
			if c.streamUsed.Load() {
				return fmt.Errorf("%w: %w", byok.ErrStopChain, callErr)
			}
			return callErr
		}
		if resp == nil {
			return errors.New("provider returned no response")
		}

		out = fromProviderResponse(resp)
		c.served.Store(&servedLane{provider: e.Provider, model: model})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// modelFor picks the model id for one entry.
//
// A session's model_hint is a deliberate choice and wins. But the capability
// hands DefaultModel() straight back to us when there is no hint, so a request
// naming exactly the first entry's model is our own echo rather than a choice —
// pinning it onto a fallback entry would send an OpenAI model id to Anthropic.
func (c *chatChain) modelFor(requested string, e byok.Entry[providers.Provider]) string {
	if requested != "" && requested != c.firstModel {
		return requested
	}
	if e.Model != "" {
		return e.Model
	}
	// Empty lets the client fall back to its own configured default.
	return e.Client.DefaultModel()
}

// toProviderRequest converts runtime's narrowed DTOs to providers'.
func toProviderRequest(req runtime.ChatRequest, model string) providers.ChatRequest {
	msgs := make([]providers.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		msgs = append(msgs, providers.Message{
			Role:       m.Role,
			Content:    m.Content,
			Thinking:   m.Thinking,
			Images:     toProviderImages(m.Images),
			ToolCalls:  toProviderToolCalls(m.ToolCalls),
			ToolCallID: m.ToolCallID,
		})
	}
	defs := make([]providers.ToolDefinition, 0, len(req.Tools))
	for _, d := range req.Tools {
		defs = append(defs, providers.ToolDefinition{
			Type: d.Type,
			Function: providers.ToolFunctionSchema{
				Name:        d.Function.Name,
				Description: d.Function.Description,
				Parameters:  d.Function.Parameters,
			},
		})
	}
	return providers.ChatRequest{Messages: msgs, Tools: defs, Model: model, Options: req.Options}
}

// toProviderImages carries solve's photographed problem across the seam. The
// providers package already speaks images on every vision wire format (OpenAI
// image_url parts, Anthropic image blocks); the runtime narrowing had dropped
// the field, and this is where it comes back.
func toProviderImages(images []runtime.Image) []providers.ImageContent {
	if len(images) == 0 {
		return nil
	}
	out := make([]providers.ImageContent, 0, len(images))
	for _, img := range images {
		out = append(out, providers.ImageContent{MimeType: img.MimeType, Data: img.Data})
	}
	return out
}

func toProviderToolCalls(calls []runtime.ToolCall) []providers.ToolCall {
	if len(calls) == 0 {
		return nil
	}
	out := make([]providers.ToolCall, 0, len(calls))
	for _, c := range calls {
		out = append(out, providers.ToolCall{
			ID: c.ID, Name: c.Name, Arguments: c.Arguments,
			RawArguments: c.RawArguments, ArgsParseError: c.ArgsParseError,
		})
	}
	return out
}

// fromProviderResponse converts back.
//
// RawFinishReason is carried deliberately: FinishReason is overwritten to
// "tool_calls" whenever tool calls are present, which hides a safety or refusal
// termination behind what looks like an ordinary tool round.
func fromProviderResponse(resp *providers.ChatResponse) *runtime.ChatResponse {
	out := &runtime.ChatResponse{
		Content:         resp.Content,
		Thinking:        resp.Thinking,
		FinishReason:    resp.FinishReason,
		RawFinishReason: resp.RawFinishReason,
	}
	for _, c := range resp.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, runtime.ToolCall{
			ID: c.ID, Name: c.Name, Arguments: c.Arguments,
			RawArguments: c.RawArguments, ArgsParseError: c.ArgsParseError,
		})
	}
	if resp.Usage != nil {
		out.Usage = &runtime.Usage{
			PromptTokens:        resp.Usage.PromptTokens,
			CompletionTokens:    resp.Usage.CompletionTokens,
			TotalTokens:         resp.Usage.TotalTokens,
			CacheCreationTokens: resp.Usage.CacheCreationTokens,
			CacheReadTokens:     resp.Usage.CacheReadTokens,
			ThinkingTokens:      resp.Usage.ThinkingTokens,
			CostUSD:             resp.Usage.CostUSD,
		}
	}
	return out
}

// ───────────────────────────────────────────────── tools ports over phase 5

// ownership answers the tools' and chatapi's "is this the caller's?" in the
// (bool, error) shape both of them declare, over the authz package's sentinel.
//
// The collapse of "not yours" and "does not exist" into a single false happens
// inside authz; nothing here may widen it, or the endpoint becomes an existence
// oracle for other people's knowledge bases.
type ownership struct{ authz *authz.Authorizer }

// OwnsKB implements tools.Authorizer and chatapi.KBAuthorizer.
func (o ownership) OwnsKB(ctx context.Context, userID, kbID uuid.UUID) (bool, error) {
	err := o.authz.OwnsKB(ctx, userID, kbID)
	if errors.Is(err, authz.ErrNoAccess) {
		return false, nil
	}
	if err != nil {
		// A lookup failure is not a decision. Returning (false, err) lets the
		// caller say "could not check" rather than "not yours".
		return false, err
	}
	return true, nil
}

// OwnsDocument implements tools.Authorizer.
func (o ownership) OwnsDocument(ctx context.Context, userID, docID uuid.UUID) (bool, error) {
	_, err := o.authz.OwnsDocument(ctx, userID, docID)
	if errors.Is(err, authz.ErrNoAccess) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// kbRetriever is `rag_search`'s back end: embed the question, then run the
// hybrid RRF statement over the knowledge bases the tool already authorized.
//
// The embedding step lives HERE rather than in internal/tools because it is the
// step that has to agree with how the corpus was indexed, and that agreement is
// a property of the Knowledge Center: the same model, and the opposite task.
type kbRetriever struct {
	retriever hybridSearch
	kbs       knowledgeReader
	providers knowledge.Providers
}

// knowledgeReader and hybridSearch are the two narrow slices these adapters
// consume, declared next to their consumer rather than taken as the concrete
// *knowledge.Service and *retrieve.Retriever.
//
// The reason is testability of the part that carries the risk: the rule about
// which knowledge bases may be searched, and with which embedding, is decided
// here, and a test of it should not need 50 000 seeded chunks to observe.
// *knowledge.Service and *retrieve.Retriever are the only production
// implementations.
type knowledgeReader interface {
	GetKB(ctx context.Context, userID, kbID uuid.UUID) (*knowledge.KB, error)
	ListDocuments(ctx context.Context, userID, kbID uuid.UUID) ([]knowledge.Document, error)
	DocumentContent(ctx context.Context, userID, docID uuid.UUID, page int) (*knowledge.DocumentContent, error)
}

type hybridSearch interface {
	Search(ctx context.Context, q retrieve.Query) ([]retrieve.Hit, error)
}

// Search implements tools.Retriever.
//
// Knowledge bases whose pinned route no longer matches the user's current embed
// route are DROPPED, not searched: their vectors are in a different space, and
// ranking a new question against them returns confident nonsense rather than an
// error. If that leaves nothing, the call fails with retrieve.ErrNeedsReembed
// so the turn says "reindex it" instead of "nothing matched" — the two have
// very different remedies and only one of them is true.
func (r kbRetriever) Search(
	ctx context.Context, userID uuid.UUID, kbIDs []uuid.UUID, query string, limit int,
) ([]tools.Chunk, error) {
	if len(kbIDs) == 0 {
		return nil, nil
	}
	embedder, err := r.providers.EmbedderFor(ctx, userID)
	if err != nil {
		return nil, err
	}

	usable := make([]uuid.UUID, 0, len(kbIDs))
	dims := 0
	stale := 0
	for _, id := range kbIDs {
		kb, err := r.kbs.GetKB(ctx, userID, id)
		if err != nil {
			if errors.Is(err, authz.ErrNoAccess) {
				// Deleted between the session's authorization and this call.
				continue
			}
			return nil, err
		}
		switch {
		case kb.Dims == 0:
			// Nothing indexed yet. Not an error, and not "stale": there is
			// simply nothing in it to find.
		case kb.NeedsReembed || kb.EmbeddingModel != embedder.Model():
			stale++
		default:
			usable = append(usable, id)
			dims = kb.Dims
		}
	}

	if len(usable) == 0 {
		if stale > 0 {
			return nil, retrieve.ErrNeedsReembed
		}
		return nil, nil
	}

	// EmbedQuery, never EmbedDocument. A task-aware model places a question
	// near the answers it should retrieve rather than near other questions, and
	// getting this wrong degrades retrieval silently — every call succeeds.
	vectors, gotDims, err := embedder.Embed(ctx, []string{query}, knowledge.EmbedQuery)
	if err != nil {
		return nil, err
	}
	if len(vectors) != 1 {
		return nil, fmt.Errorf("rag: embed route returned %d vectors for one question", len(vectors))
	}
	if gotDims != dims {
		// The route changed width since indexing. Same remedy as a model
		// change, and the same reason not to search anyway.
		return nil, retrieve.ErrNeedsReembed
	}

	hits, err := r.retriever.Search(ctx, retrieve.Query{
		UserID: userID, KBIDs: usable, Text: query,
		Vector: vectors[0], Dims: dims, Limit: limit,
	})
	if err != nil {
		return nil, err
	}
	if stale > 0 {
		slog.Info("rag_search: knowledge bases skipped pending reindex",
			"skipped", stale, "searched", len(usable))
	}

	out := make([]tools.Chunk, 0, len(hits))
	for _, h := range hits {
		out = append(out, tools.Chunk{
			ID:            h.ChunkID.String(),
			DocumentID:    h.DocumentID.String(),
			DocumentTitle: h.Title,
			Page:          h.PageStart,
			Text:          h.Text,
			Score:         h.Score,
			Seconds:       h.Seconds,
			AITranscript:  h.AITranscript,
			Lines:         h.Lines,
			PageEnd:       h.PageEnd,
			Sheet:         h.Sheet,
			PhotoModel:    h.PhotoModel,
		})
	}
	return out, nil
}

// kbSourceReader is `read_source`'s back end: one page of parsed Markdown.
type kbSourceReader struct{ kbs knowledgeReader }

// ReadPage implements tools.SourceReader.
func (s kbSourceReader) ReadPage(ctx context.Context, userID, docID uuid.UUID, page int) (tools.Page, error) {
	content, err := s.kbs.DocumentContent(ctx, userID, docID, page)
	switch {
	case errors.Is(err, authz.ErrNoAccess):
		return tools.Page{}, tools.ErrNotFound
	case errors.Is(err, knowledge.ErrNoParsedContent):
		// The document is the caller's; it has just not finished processing.
		// Reported as an empty page, which the tool renders as "that page is
		// empty" — not as "no such document", which would deny a file the user
		// can see in the Knowledge Center.
		return tools.Page{DocumentID: docID.String(), Page: page}, nil
	case err != nil:
		return tools.Page{}, err
	}

	p := tools.Page{
		DocumentID: content.Document.ID.String(),
		Title:      content.Document.Title,
		Page:       page,
		PageCount:  content.Document.PageCount,
	}
	if len(content.Pages) > 0 {
		p.Text = content.Pages[0].Markdown
		p.Page = content.Pages[0].Number
	}
	return p, nil
}

// kbFileLister is `kb_files`' back end.
type kbFileLister struct{ kbs knowledgeReader }

// Files implements tools.FileLister.
func (l kbFileLister) Files(ctx context.Context, userID, kbID uuid.UUID) ([]tools.File, error) {
	docs, err := l.kbs.ListDocuments(ctx, userID, kbID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return nil, tools.ErrNotFound
		}
		return nil, err
	}
	out := make([]tools.File, 0, len(docs))
	for _, d := range docs {
		out = append(out, tools.File{
			DocumentID: d.ID.String(),
			Title:      d.Title,
			Pages:      d.PageCount,
			Status:     d.Status,
		})
	}
	return out, nil
}
