-- 1790090000_drive_storage, reversed. The files stay in the learners' Drives;
-- only Longplay's record of where they are is dropped. Move every learner's
-- files back to the server (phase 2) before running this.

DROP TABLE drive_folders;
DROP TABLE drive_files;
