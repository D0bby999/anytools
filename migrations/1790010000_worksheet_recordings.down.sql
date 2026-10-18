-- Dropping the rows leaves their files under objects/<user>/recordings/;
-- account deletion still removes them.
DROP TABLE IF EXISTS worksheet_recordings;
