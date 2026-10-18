-- Reverse of 1789630800_notebook_reading. Child-first: the composite foreign
-- keys govern rows, not DDL, so the drop order is the dependency order read
-- backwards.
DROP TABLE IF EXISTS reading_highlights;
DROP TABLE IF EXISTS reading_workspaces;
DROP TABLE IF EXISTS note_category_links;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS note_categories;
DROP TABLE IF EXISTS notebooks;
