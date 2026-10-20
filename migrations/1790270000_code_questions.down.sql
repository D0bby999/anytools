-- Code questions go first (with their attempts and mistakes, by cascade):
-- the narrower type CHECK would refuse them.
DELETE FROM questions WHERE type = 'code';
ALTER TABLE questions DROP CONSTRAINT questions_code_only_for_code;
ALTER TABLE questions DROP COLUMN code;
ALTER TABLE questions DROP CONSTRAINT questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
    CHECK (type IN ('mcq', 'short', 'tf', 'cloze', 'written'));
