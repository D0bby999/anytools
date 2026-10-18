-- Skill evidence cards (plans/260926-2301-learning-depth, phase 8).
--
-- A card is a guided view over one evidence chain: the learner names a real
-- situation, keeps an unaided first attempt, practises, and retests after a
-- delay. Every entry is also an evidence ref on the card's chain, so the Loop's
-- gates count cards with no special case (internal/learning/loop/cards.go).

-- ──────────────────────────────────────────────────────────────── skill_cards
CREATE TABLE skill_cards (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_id uuid NOT NULL,
    -- The chain is created with the card, in the same transaction.
    chain_id uuid NOT NULL,

    -- The list is repeated in Go as loop.CardKinds(); a test compares them.
    kind  text NOT NULL CHECK (kind IN
              ('reading', 'writing', 'speaking', 'listening', 'vocabulary', 'grammar', 'field_note')),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    -- {"situation": "…", "standard": "…", …}: the kind's setup fields.
    setup jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(setup) = 'object'),

    -- open:       no baseline yet, or the retest is done;
    -- retest_due: the baseline is saved and the delayed retest is not. While a
    --             card is here its baseline is withheld from every endpoint.
    --             Whether the retest may be written TODAY is retest_due_on
    --             compared with the learner's local day, decided in Go.
    -- closed:     the learner wrote the reflection; no more entries.
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'retest_due', 'closed')),

    baseline_at   timestamptz,
    -- A calendar day in the learner's zone (learning.LocalDay), not an instant:
    -- "due on the 11th" stays the 11th whatever hour the baseline was written.
    retest_due_on date,
    closed_at     timestamptz,
    -- {"held": "…", "missed": "…", "next": "…"}
    reflection jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reflection) = 'object'),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT skill_cards_state_fk FOREIGN KEY (state_id, user_id)
        REFERENCES learning_states (id, user_id) ON DELETE CASCADE,
    CONSTRAINT skill_cards_chain_fk FOREIGN KEY (chain_id, user_id)
        REFERENCES evidence_chains (id, user_id) ON DELETE CASCADE,
    CONSTRAINT skill_cards_id_user_unique UNIQUE (id, user_id),
    -- One card per chain: the card IS the chain's guided view.
    CONSTRAINT skill_cards_chain_unique UNIQUE (chain_id),
    CONSTRAINT skill_cards_baseline_dates CHECK ((baseline_at IS NULL) = (retest_due_on IS NULL)),
    CONSTRAINT skill_cards_retest_needs_baseline CHECK (status <> 'retest_due' OR baseline_at IS NOT NULL)
);

CREATE INDEX skill_cards_state_idx ON skill_cards (user_id, state_id, created_at DESC);
CREATE INDEX skill_cards_retest_idx ON skill_cards (user_id, retest_due_on) WHERE status = 'retest_due';

-- ─────────────────────────────────────────────────────────────── card_entries
-- The table exists as a phase-0 stub (1789775000_groundwork). Nothing could
-- write a stub row through the API, and a row with no card is not an entry, so
-- any that exist are removed before the columns become NOT NULL.
DELETE FROM evidence_refs WHERE kind = 'card_entry';
DELETE FROM card_entries;

ALTER TABLE card_entries
    ADD COLUMN card_id uuid NOT NULL,
    ADD COLUMN timepoint text NOT NULL
        CHECK (timepoint IN ('baseline', 'immediate', 'delayed', 'transfer')),
    -- What the learner wrote: an attempt, a transcript, a description. Saved
    -- as-is; nothing rewrites it.
    ADD COLUMN body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
    ADD COLUMN prompt_level text NOT NULL DEFAULT 'unaided'
        CHECK (prompt_level IN ('unaided', 'light_cue', 'heavy_cue')),
    -- [{"kind": "note"|"document"|"quiz_attempt", "id": "…", "page": 3}]. The
    -- ids are resolved with user_id = the caller on save AND on render.
    ADD COLUMN links jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(links) = 'array'),
    ADD CONSTRAINT card_entries_card_fk FOREIGN KEY (card_id, user_id)
        REFERENCES skill_cards (id, user_id) ON DELETE CASCADE;

-- The unaided first attempt is kept once. A new baseline is a new card.
CREATE UNIQUE INDEX card_entries_one_baseline ON card_entries (card_id) WHERE timepoint = 'baseline';
CREATE INDEX card_entries_card_idx ON card_entries (user_id, card_id, created_at);

-- Entries are evidence: once written they are what happened. An UPDATE is
-- refused here as well as in Go, so no later code path can "correct" one.
CREATE FUNCTION card_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'card entries cannot be changed' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER card_entries_no_update BEFORE UPDATE ON card_entries
    FOR EACH ROW EXECUTE FUNCTION card_entries_immutable();
