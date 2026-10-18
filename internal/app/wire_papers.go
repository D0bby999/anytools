package app

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/relatedapi"
	"github.com/D0bby999/anytools/internal/api/researchapi"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/related"
	"github.com/D0bby999/anytools/internal/rag/papers"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/tools"
)

// wire_papers.go — scholarly search (learning depth, phase 6): research's
// paper_search tool and the knowledge base's related papers, both on the
// learner's own OpenAlex key or their share of the keyless budget.

// keylessPaperSearches is one user's daily share of the server's keyless
// OpenAlex allowance (about 100 a day per IP).
const keylessPaperSearches = 20

// paperService resolves the learner's key per call, like every BYOK lane.
type paperService struct {
	byok  *byok.Service
	usage *pg.PaperStore
	now   func() time.Time
	// openAlex and arxiv are overridable for recorded-HTTP tests.
	openAlex func(key string) *papers.OpenAlex
	arxiv    *papers.Arxiv
}

func newPaperService(pool *pg.Pool, svc *byok.Service) *paperService {
	return &paperService{byok: svc, usage: pg.NewPaperStore(pool), now: time.Now,
		openAlex: papers.NewOpenAlex, arxiv: papers.NewArxiv()}
}

// client returns an OpenAlex client on the learner's key, or — spending one of
// their keyless searches — on none.
func (s *paperService) client(ctx context.Context, userID uuid.UUID) (*papers.OpenAlex, error) {
	key, err := s.byok.PaperKeyFor(ctx, userID)
	if err != nil {
		return nil, err
	}
	if key == "" {
		ok, err := s.usage.SpendKeyless(ctx, userID, s.now(), keylessPaperSearches)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, tools.ErrPaperBudget
		}
	}
	return s.openAlex(key), nil
}

// SearchPapers implements tools.PaperSearcher: OpenAlex, then arXiv when
// OpenAlex is unavailable. A spent budget is reported, not papered over.
func (s *paperService) SearchPapers(ctx context.Context, userID uuid.UUID, query string, limit int) ([]papers.Paper, error) {
	c, err := s.client(ctx, userID)
	if errors.Is(err, tools.ErrPaperBudget) {
		return nil, err
	}
	if err == nil {
		found, serr := c.Search(ctx, query, limit, 0)
		if serr == nil {
			return found, nil
		}
		err = serr
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	found, aerr := s.arxiv.Search(ctx, query, limit)
	if aerr != nil {
		return nil, errors.Join(err, aerr)
	}
	return found, nil
}

// Recent implements related.Papers.
func (s *paperService) Recent(ctx context.Context, userID uuid.UUID, query string, limit, sinceYears int) ([]papers.Paper, error) {
	c, err := s.client(ctx, userID)
	if err != nil {
		return nil, err
	}
	return c.Search(ctx, query, limit, sinceYears)
}

// Work implements related.Papers.
func (s *paperService) Work(ctx context.Context, userID uuid.UUID, id string) (*papers.Paper, error) {
	c, err := s.client(ctx, userID)
	if err != nil {
		return nil, err
	}
	return c.Work(ctx, id)
}

// buildRelated wires the knowledge base's related papers.
func buildRelated(pool *pg.Pool, kb knowledgeSubsystem, byokService *byok.Service, paperSvc *paperService, web webDeps) *relatedapi.Handler {
	svc := related.NewService(related.Deps{
		Store:     pg.NewPaperStore(pool),
		KBs:       relatedKB{kbs: kb.service},
		Retriever: relatedRetriever{inner: kbRetriever{retriever: kb.retriever, kbs: kb.service, providers: kb.providers}},
		Models:    newChatResolver(byokService),
		Papers:    paperSvc,
		Documents: relatedDocs{inner: reportKnowledge{own: ownership{authz: kb.authz}, svc: kb.service}},
		Pages:     pageFetcher{client: web.fetchClient},
	})
	return relatedapi.NewHandler(svc)
}

type relatedKB struct{ kbs knowledgeReader }

func (r relatedKB) Describe(ctx context.Context, userID, kbID uuid.UUID) (string, []string, error) {
	kb, err := r.kbs.GetKB(ctx, userID, kbID)
	if err != nil {
		return "", nil, err
	}
	docs, err := r.kbs.ListDocuments(ctx, userID, kbID)
	if err != nil {
		return "", nil, err
	}
	titles := make([]string, 0, len(docs))
	for i, d := range docs {
		if i == 30 {
			break
		}
		titles = append(titles, d.Title)
	}
	return kb.Name, titles, nil
}

type relatedRetriever struct{ inner kbRetriever }

func (r relatedRetriever) Passages(ctx context.Context, userID, kbID uuid.UUID, query string, limit int) ([]string, error) {
	hits, err := r.inner.Search(ctx, userID, []uuid.UUID{kbID}, query, limit)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		out = append(out, h.Text)
	}
	return out, nil
}

// relatedDocs is the report-to-knowledge upload path, with its duplicate
// error translated.
type relatedDocs struct{ inner reportKnowledge }

func (d relatedDocs) AddDocument(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) error {
	err := d.inner.AddDocument(ctx, userID, kbID, filename, data)
	if errors.Is(err, researchapi.ErrAlreadyInKnowledgeBase) {
		return related.ErrAlreadyAdded
	}
	return err
}
