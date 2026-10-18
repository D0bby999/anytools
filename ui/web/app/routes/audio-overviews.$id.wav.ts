/**
 * audio-overviews.$id.wav.ts
 * Resource route (loader only): an audio overview's WAV, from 'self', with
 * range support. Not under app-layout, so it calls requireUserId itself; the
 * API checks ownership.
 */
import type { Route } from "./+types/audio-overviews.$id.wav";
import { requireUserId } from "~/lib/auth.server";
import { fetchOverviewAudio } from "~/lib/audio.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return fetchOverviewAudio(userId, params.id, request);
}
