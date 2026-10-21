/** Mirrors classroom.Course. */
export type ClassroomCourse = { id: string; name: string; section?: string; link?: string; kb_id?: string; new: number };

/** Mirrors classroom.Item. */
export type ClassroomItem = {
  key: string;
  kind: "drive" | "youtube" | "link" | "form" | "notebook" | "gem" | "post";
  title: string;
  url?: string;
  file_id?: string;
  from: string;
  imported: boolean;
  updated?: string;
};

/** Mirrors classroom.ImportReport. */
export type ClassroomImport = { kb_id: string; imported: number; failed: number; drive_files: string[] };

/** What the Google Classroom page's action answers. */
export type ClassroomAction =
  | { intent: "link"; ok: true }
  | { intent: "import"; ok: true; report: ClassroomImport }
  | { intent: "drive"; ok: true; count: number; kbId: string }
  | { intent: string; ok: false; error: string };
