package pg

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

// learning_loop_targets.go reads the rows evidence points at — phases 6–8's
// tables — in two ways: by id, to show what an accepted ref names, and by time
// window, to propose what a week's review could cite.
//
// Both read through ONE query per kind, so the label a suggestion shows and
// the label the same ref shows once accepted cannot drift apart. Every query
// names the owner; an id that is not theirs resolves to nothing.

// targetQuery is a kind's SELECT. Columns: id, label, detail, occurred_at,
// link, timepoint hint. {{where}} is the extra WHERE clause; $1 is always the owner.
// A placeholder rather than a Sprintf verb, because the SQL has its own `%`.
var targetQuery = map[string]string{
	loop.KindQuestionAttempt: `
		SELECT a.id, left(q.prompt, 160),
		       CASE WHEN a.is_correct THEN 'Answered correctly' ELSE 'Answered incorrectly' END,
		       a.created_at, '/quiz/bank',
		       -- The hint: a first try at a question is where you started; a
		       -- try days after an earlier one is a delayed check.
		       CASE WHEN NOT EXISTS (
		                SELECT 1 FROM question_attempts p
		                 WHERE p.user_id = a.user_id AND p.created_at < a.created_at
		                   AND (p.question_id = a.question_id
		                        OR (a.knowledge_point_id IS NOT NULL AND p.knowledge_point_id = a.knowledge_point_id)))
		            THEN 'baseline'
		            WHEN EXISTS (
		                SELECT 1 FROM question_attempts p
		                 WHERE p.user_id = a.user_id AND p.created_at <= a.created_at - interval '72 hours'
		                   AND (p.question_id = a.question_id
		                        OR (a.knowledge_point_id IS NOT NULL AND p.knowledge_point_id = a.knowledge_point_id)))
		            THEN 'delayed'
		            ELSE 'immediate' END
		  FROM question_attempts a
		  JOIN questions q ON q.id = a.question_id AND q.user_id = a.user_id
		 WHERE a.user_id = $1 AND {{where}}`,
	loop.KindKPState: `
		SELECT st.kp_id, kp.name,
		       format('Mastery %s%%, %s reviews, %s lapses',
		              round(st.mastery_estimate * 100), st.reviews, st.lapses),
		       st.updated_at, '/mastery/' || m.path_id, ''
		  FROM kp_state st
		  JOIN knowledge_points kp ON kp.id = st.kp_id AND kp.user_id = st.user_id
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		 WHERE st.user_id = $1 AND {{where}}`,
	loop.KindNote: `
		SELECT n.id, COALESCE(NULLIF(btrim(n.title), ''), left(n.body_md, 160)),
		       CASE WHEN n.created_by = 'agent' THEN 'Note written by the assistant'
		            ELSE 'Note written by you' END,
		       n.updated_at, '/notebooks/' || n.notebook_id, ''
		  FROM notes n
		 WHERE n.user_id = $1 AND {{where}}`,
	loop.KindChatMessage: `
		SELECT m.id, left(m.content, 160),
		       CASE WHEN m.role = 'user' THEN 'Your message' ELSE 'Assistant message' END
		         || CASE WHEN s.title <> '' THEN ' in ' || s.title ELSE '' END,
		       m.created_at, '/chat/' || m.session_id, ''
		  FROM chat_messages m
		  JOIN chat_sessions s ON s.id = m.session_id AND s.user_id = m.user_id
		 WHERE m.user_id = $1 AND {{where}}`,
	// An explain-back: the point explained, and its verdict. A verdict the
	// learner overrode says so — "you marked it passed" is not "passed". The
	// hint mirrors a quiz attempt's: a first explanation is a baseline, one
	// three days after an earlier one is a delayed check.
	loop.KindExplainBack: `
		SELECT e.id, 'Explained: ' || left(kp.name, 150),
		       CASE WHEN e.override_passed IS TRUE THEN 'You marked it passed (the judge found gaps)'
		            WHEN e.override_passed IS FALSE THEN 'You marked it not passed (the judge passed it)'
		            WHEN e.verdict = 'passed' THEN 'Explained back, passed'
		            WHEN e.verdict = 'failed' THEN 'Explained back, gaps found'
		            ELSE 'Explained back, not judged' END,
		       e.created_at, '/mastery/' || e.path_id,
		       CASE WHEN NOT EXISTS (
		                SELECT 1 FROM explain_back_attempts p
		                 WHERE p.user_id = e.user_id AND p.kp_id = e.kp_id AND p.created_at < e.created_at
		                   AND p.verdict <> 'pending')
		            THEN 'baseline'
		            WHEN EXISTS (
		                SELECT 1 FROM explain_back_attempts p
		                 WHERE p.user_id = e.user_id AND p.kp_id = e.kp_id
		                   AND p.created_at <= e.created_at - interval '72 hours' AND p.verdict <> 'pending')
		            THEN 'delayed'
		            ELSE 'immediate' END
		  FROM explain_back_attempts e
		  JOIN knowledge_points kp ON kp.id = e.kp_id AND kp.user_id = e.user_id
		 WHERE e.user_id = $1 AND {{where}}`,
	// A card entry: its text, the card's title and the timepoint. While the
	// card's retest is pending, a baseline's text is withheld HERE — this query
	// is what every chain, review, evidence and suggestion endpoint renders a
	// card entry with, so the learner is not cued by their first attempt
	// anywhere (loop/cards.go). The hint is the entry's own timepoint: a
	// card entry cannot be anything else (Service.checkCardEntryTimepoint).
	loop.KindCardEntry: `
		SELECT c.id,
		       CASE WHEN c.timepoint = 'baseline' AND k.status = 'retest_due'
		            THEN 'First attempt — hidden until your retest is saved'
		            ELSE left(c.body, 160) END,
		       k.title || ' · ' || CASE c.timepoint
		            WHEN 'baseline' THEN 'first attempt'
		            WHEN 'immediate' THEN 'practice'
		            WHEN 'delayed' THEN 'retest'
		            ELSE 'transfer' END,
		       c.created_at, '/loop/cards/' || k.id, c.timepoint
		  FROM card_entries c
		  JOIN skill_cards k ON k.id = c.card_id AND k.user_id = c.user_id
		 WHERE c.user_id = $1 AND {{where}}`,
	loop.KindResearchReport: `
		SELECT r.id, left(r.query, 160),
		       CASE WHEN r.kb_only THEN 'Research report from your documents'
		            ELSE 'Research report with web sources' END,
		       r.created_at, '/research/' || r.id, ''
		  FROM research_reports r
		 WHERE r.user_id = $1 AND {{where}}`,
	// A worksheet: its title, and its kind's name in place of w.kind
	// (readTargets; SQL cannot see Go's kind registry). Private worksheets
	// are excluded here AND in both filters below, so no reader of this map
	// can ever list one.
	loop.KindWorksheet: `
		SELECT w.id, left(w.title, 160), w.kind, w.updated_at, '/toolkit/' || w.id, ''
		  FROM worksheets w
		 WHERE w.user_id = $1 AND NOT w.private AND {{where}}`,
}

// byIDFilter and windowFilter are the two ways a target query is narrowed.
var byIDFilter = map[string]string{
	loop.KindQuestionAttempt: `a.id = ANY($2)`,
	loop.KindKPState:         `st.kp_id = ANY($2)`,
	loop.KindNote:            `n.id = ANY($2)`,
	loop.KindChatMessage:     `m.id = ANY($2)`,
	loop.KindResearchReport:  `r.id = ANY($2)`,
	loop.KindExplainBack:     `e.id = ANY($2)`,
	loop.KindCardEntry:       `c.id = ANY($2)`,
	loop.KindWorksheet:       `w.id = ANY($2) AND NOT w.private`,
}

// windowFilter is what a week's suggestions read. Three kinds are narrowed
// further: only notes the person wrote (the assistant's notes are not the
// learner's evidence), only the person's own messages in conversations
// linked to this state ($4), and only worksheets attached to this state ($4).
var windowFilter = map[string]string{
	loop.KindQuestionAttempt: `a.created_at >= $2 AND a.created_at < $3`,
	loop.KindKPState:         `st.updated_at >= $2 AND st.updated_at < $3 AND st.reviews > 0`,
	loop.KindNote:            `n.updated_at >= $2 AND n.updated_at < $3 AND n.created_by = 'user'`,
	loop.KindChatMessage: `m.created_at >= $2 AND m.created_at < $3 AND m.role = 'user'
		AND s.learning_state_id = $4`,
	loop.KindResearchReport: `r.created_at >= $2 AND r.created_at < $3`,
	loop.KindExplainBack:    `e.created_at >= $2 AND e.created_at < $3 AND e.verdict <> 'pending'`,
	loop.KindCardEntry:      `c.created_at >= $2 AND c.created_at < $3`,
	// Worksheets written in the week, on this state ($4), never private.
	loop.KindWorksheet: `w.updated_at >= $2 AND w.updated_at < $3 AND w.state_id = $4 AND NOT w.private`,
}

// stateScoped are the kinds whose window filter names the state ($4).
var stateScoped = map[string]bool{loop.KindChatMessage: true, loop.KindWorksheet: true}

// suggestionsPerKind caps one week's proposals of one kind. A week of heavy
// quiz use would otherwise bury the three notes that mattered.
const suggestionsPerKind = 30

// resolveTargets fills Target on each ref, one query per kind present.
func (s *LoopStore) resolveTargets(ctx context.Context, userID uuid.UUID, refs []*loop.EvidenceRef) error {
	byKind := map[string][]uuid.UUID{}
	for _, r := range refs {
		byKind[r.Kind] = append(byKind[r.Kind], r.RefID)
	}
	found := map[string]loop.Target{}
	for kind, ids := range byKind {
		q, ok := targetQuery[kind]
		if !ok {
			continue
		}
		cands, err := s.readTargets(ctx, kind, strings.Replace(q, "{{where}}", byIDFilter[kind], 1), userID, ids)
		if err != nil {
			return err
		}
		for _, c := range cands {
			found[kind+":"+c.RefID.String()] = c.Target
		}
	}
	for _, r := range refs {
		if t, ok := found[r.Kind+":"+r.RefID.String()]; ok {
			t := t
			r.Target = &t
		}
	}
	return nil
}

// Candidates lists what a user did in [from, to), newest first per kind.
func (s *LoopStore) Candidates(
	ctx context.Context, userID, stateID uuid.UUID, from, to time.Time,
) ([]loop.Candidate, error) {
	out := []loop.Candidate{}
	for _, kind := range loop.EvidenceKinds() {
		q, ok := targetQuery[kind]
		if !ok {
			continue
		}
		sql := strings.Replace(q, "{{where}}", windowFilter[kind], 1) + fmt.Sprintf(" ORDER BY 4 DESC LIMIT %d", suggestionsPerKind)
		args := []any{userID, from, to}
		if stateScoped[kind] {
			args = append(args, stateID)
		}
		cands, err := s.readTargets(ctx, kind, sql, args...)
		if err != nil {
			return nil, err
		}
		out = append(out, cands...)
	}
	return out, nil
}

func (s *LoopStore) readTargets(ctx context.Context, kind, sql string, args ...any) ([]loop.Candidate, error) {
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("evidence targets (%s): %w", kind, err)
	}
	defer rows.Close()
	var out []loop.Candidate
	for rows.Next() {
		c := loop.Candidate{Kind: kind}
		if err := rows.Scan(&c.RefID, &c.Label, &c.Detail, &c.OccurredAt, &c.Link, &c.Timepoint); err != nil {
			return nil, fmt.Errorf("evidence targets (%s): scan: %w", kind, err)
		}
		if kind == loop.KindWorksheet {
			c.Detail = worksheet.Name(c.Detail)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
