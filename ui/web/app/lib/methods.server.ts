/**
 * methods.server.ts
 * "Add to my knowledge" for a learning-methods video: the link import into
 * the knowledge base named for the guide, made the first time. Only a video
 * the guide lists can be added, and the name is the server's, in the
 * learner's language; one named in any of the four languages is reused, so
 * changing language does not make a second.
 */
import { ApiError } from "~/lib/api.server";
import { addLink, createKB, listKBs } from "~/lib/kb.server";
import { VIDEO_IDS } from "~/lib/methods";
import type { SaveResult } from "~/components/methods/video-list";

export const KB_NAMES: Record<string, string> = {
  en: "Learning methods",
  vi: "Phương pháp học",
  es: "Métodos de estudio",
  pt: "Métodos de estudo",
};

export async function saveVideo(userId: string, language: string | undefined, form: FormData): Promise<SaveResult> {
  const video = String(form.get("video") ?? "");
  if (!VIDEO_IDS.has(video)) return { video, error: "not_listed" };
  const names = new Set(Object.values(KB_NAMES));
  try {
    const kbs = (await listKBs(userId)).knowledge_bases.map((k) => k.kb);
    const kb = kbs.find((k) => names.has(k.name)) ?? (await createKB(userId, KB_NAMES[language ?? ""] ?? KB_NAMES.en!));
    await addLink(userId, kb.id, `https://www.youtube.com/watch?v=${video}`, false);
    return { video, kbId: kb.id, kbName: kb.name };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { video, error: error.message };
    throw error;
  }
}
