/**
 * video-notes-types.ts
 * A YouTube video's study notes. Mirrors internal/capabilities/videonotes.
 * Every string is a model's (or, for chapter titles, the video creator's)
 * and is rendered as text only.
 */

export type VideoNotePoint = { text: string; at?: number };

export type VideoNoteSection = {
  start: number;
  end: number;
  title: string;
  summary: string;
  points: VideoNotePoint[];
};

export type VideoNotes = {
  id: string;
  document_id: string;
  language: string;
  sections: VideoNoteSection[];
  /** The creator's chapters were the section boundaries. */
  from_chapters: boolean;
  model: string;
  created_at: string;
  /** The transcript was replaced after these were written. */
  stale: boolean;
};

/** The languages offered for notes, besides the video's own. */
export const NOTE_LANGUAGES = ["en", "vi"] as const;
