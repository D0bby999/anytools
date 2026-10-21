/** Mirrors youtube.Playlist. */
export type Playlist = { id: string; title: string; videos: { id: string; title: string; url: string }[]; truncated: boolean };

/** Mirrors gphotos.Session. */
export type PhotoSession = { id: string; picker_uri: string; poll_ms: number; ready: boolean };

/** What the Learning apps action answers for these intents. */
export type MediaResult =
  | { intent: "playlist-preview"; ok: true; url: string; playlist: Playlist }
  | { intent: "playlist-add"; ok: true; added: number; kbId: string }
  | { intent: "photos-start"; ok: true; session: PhotoSession }
  | { intent: "photos-poll"; ok: true; session: PhotoSession }
  | { intent: "photos-take"; ok: true; photos: number; kbId: string }
  | { intent: string; ok: false; error: string };
