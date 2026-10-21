/**
 * classroom.server.ts
 * Google Classroom (learning-tool-connections phase 6).
 */
import { apiFetch } from "~/lib/api.server";
import type { ClassroomCourse, ClassroomImport, ClassroomItem } from "~/lib/classroom-types";

export function listCourses(userId: string) {
  return apiFetch<{ courses: ClassroomCourse[] }>("/v1/classroom/courses", userId);
}

export function listItems(userId: string, courseId: string) {
  return apiFetch<{ items: ClassroomItem[] }>(`/v1/classroom/courses/${encodeURIComponent(courseId)}/items`, userId);
}

export function linkCourse(userId: string, courseId: string, name: string, kbId: string) {
  return apiFetch<{ kb_id: string }>(`/v1/classroom/courses/${encodeURIComponent(courseId)}/link`, userId, {
    method: "POST",
    body: { name, kb_id: kbId },
  });
}

export function importItems(userId: string, courseId: string, keys: string[]) {
  return apiFetch<ClassroomImport>(`/v1/classroom/courses/${encodeURIComponent(courseId)}/import`, userId, {
    method: "POST",
    body: { keys },
  });
}

export function markSeen(userId: string, courseId: string, fileIds: string[]) {
  return apiFetch<{ ok: boolean }>(`/v1/classroom/courses/${encodeURIComponent(courseId)}/seen`, userId, {
    method: "POST",
    body: { file_ids: fileIds },
  });
}
