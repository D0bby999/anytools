/**
 * reading-types.ts
 * Wire shapes for the notebook and the reading workspace
 * (internal/api/{notebookapi,readingapi}). Client-safe.
 */

export type Notebook = {
  id: string;
  name: string;
  is_default: boolean;
  note_count: number;
  created_at: string;
  updated_at: string;
};

export type NoteSource = { kind?: "session" | "question" | "document" | "reading"; id?: string; page?: number };

export type Note = {
  id: string;
  notebook_id: string;
  title: string;
  body_md: string;
  source: NoteSource;
  created_by: "user" | "agent";
  category_ids: string[];
  created_at: string;
  updated_at: string;
};

export type Category = { id: string; notebook_id: string; name: string; created_at: string };

export type Workspace = {
  id: string;
  document_id: string;
  progress: { page?: number; percent?: number };
  session_id?: string;
  created_at: string;
  updated_at: string;
};

export type Highlight = {
  id: string;
  workspace_id: string;
  page: number;
  text: string;
  color: "yellow" | "green" | "blue" | "pink";
  note_id?: string;
  created_at: string;
};

/** The four selection actions readingapi accepts. */
export const READING_ACTIONS = ["explain", "vocab", "quiz", "translate"] as const;
export type ReadingAction = (typeof READING_ACTIONS)[number];

/** Mirrors reading.MaxSelectionLen: longer selections are refused with a 413. */
export const MAX_SELECTION = 8000;

/** Where a note came from, as a link back into the product, or null. */
export function sourceHref(source: NoteSource): string | null {
  if (!source.id) return null;
  switch (source.kind) {
    case "document":
    case "reading":
      return source.page && source.page > 0
        ? `/documents/${source.id}?page=${source.page}`
        : `/documents/${source.id}`;
    case "session":
      return `/chat/${source.id}`;
    default:
      return null;
  }
}
