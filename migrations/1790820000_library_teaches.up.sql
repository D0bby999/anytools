-- the private design notes phase 6: the language an item is for
-- learning, apart from the one it is written in. The next catalogue load
-- (its version changed with this column) fills it.
ALTER TABLE library_items ADD COLUMN teaches TEXT NOT NULL DEFAULT ''
    CONSTRAINT library_items_teaches_check CHECK (teaches = '' OR teaches ~ '^[a-z]{2,3}$');
CREATE INDEX library_items_teaches ON library_items (teaches, language_rank, position) WHERE teaches <> '';
