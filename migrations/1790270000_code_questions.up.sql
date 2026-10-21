-- Code exercises (the private design notes, phase 4;
-- owner decision 4): a Python question whose answer is code, run against its
-- tests in the learner's browser (Pyodide), never on the server. `code` holds
-- what the browser needs to run it, shown before the attempt: the module the
-- tests import the learner's code as, the starting code and the tests. The
-- solution is the question's `answer`, shown only after the attempt, as any
-- answer is.
ALTER TABLE questions DROP CONSTRAINT questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
    CHECK (type IN ('mcq', 'short', 'tf', 'cloze', 'written', 'code'));

ALTER TABLE questions ADD COLUMN code jsonb
    CHECK (code IS NULL OR jsonb_typeof(code) = 'object');
ALTER TABLE questions ADD CONSTRAINT questions_code_only_for_code
    CHECK ((type = 'code') = (code IS NOT NULL));
