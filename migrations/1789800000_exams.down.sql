DROP TABLE exam_items;
DROP TABLE exams;
DROP TABLE exam_template_batches;
DROP TABLE exam_templates;

ALTER TABLE question_attempts DROP CONSTRAINT question_attempts_id_user_unique;
ALTER TABLE question_attempts DROP CONSTRAINT question_attempts_score_bar;
ALTER TABLE question_attempts DROP COLUMN score;

-- A written question cannot survive the narrower CHECK; its attempts and
-- mistakes cascade with it.
DELETE FROM questions WHERE type = 'written';
ALTER TABLE questions DROP CONSTRAINT questions_rubric_written;
ALTER TABLE questions DROP COLUMN rubric;
ALTER TABLE questions DROP CONSTRAINT questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
    CHECK (type IN ('mcq', 'short', 'tf', 'cloze'));
