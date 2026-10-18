/**
 * storage.server.ts
 * Settings → Storage's thin API module (drive-user-storage phase 2).
 * Server-side only: every function takes the session's user id and hands it
 * to apiFetch.
 */
import { apiFetch } from "~/lib/api.server";
import type { ExportKind, FileStorage, StorageStatus } from "~/lib/storage-types";

export type { StorageStatus } from "~/lib/storage-types";

export function getStorage(userId: string) {
  return apiFetch<StorageStatus>("/v1/me/file-storage", userId);
}

export function setStorage(userId: string, storage: FileStorage) {
  return apiFetch<StorageStatus>("/v1/me/file-storage", userId, { method: "PUT", body: { storage } });
}

export function startMove(userId: string) {
  return apiFetch<StorageStatus | { move: null; nothing_to_move: true }>("/v1/me/file-storage/move", userId, {
    method: "POST",
  });
}

export function cancelMove(userId: string) {
  return apiFetch<void>("/v1/me/file-storage/move/cancel", userId, { method: "POST" });
}

/** The API route that saves each kind of export into the learner's Drive. */
export function exportPath(kind: ExportKind, id: string, language?: string): string {
  const e = encodeURIComponent(id);
  switch (kind) {
    case "worksheet":
      return `/v1/worksheets/${e}/export/drive`;
    case "book":
      return `/v1/books/${e}/export/drive`;
    case "notebook":
      return `/v1/notebooks/${e}/export/drive`;
    case "study_notes":
      return `/v1/documents/${e}/study-notes/export/drive?language=${encodeURIComponent(language ?? "")}`;
  }
}

export function saveToDrive(userId: string, kind: ExportKind, id: string, language?: string) {
  return apiFetch<{ file_id: string; name: string; url: string }>(exportPath(kind, id, language), userId, {
    method: "POST",
  });
}
