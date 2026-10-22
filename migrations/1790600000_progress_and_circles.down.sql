DROP TABLE study_cheers;
DROP TRIGGER study_circles_drop_empty ON study_circle_members;
DROP FUNCTION study_circles_drop_empty();
DROP TABLE study_circle_members;
DROP TABLE study_circles;
DROP TABLE progress_milestones;
DROP TABLE study_days;
ALTER TABLE users DROP COLUMN week_goal, DROP COLUMN rest_days, DROP COLUMN study_counted_on, DROP COLUMN study_refreshed_at;
