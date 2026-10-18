/**
 * exam.server.ts
 * Past papers and mock exams' thin API module (learning depth, phase 3).
 * Server-side only; every call is scoped by an explicit user id.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { Exam, ExamTemplate, ExamView, TemplateItem } from "~/lib/exam-types";

const templates = "/v1/exams/templates";
const exams = "/v1/exams";
const id = (value: string) => encodeURIComponent(value);

export function listTemplates(userId: string) {
  return apiFetch<{ templates: ExamTemplate[] }>(templates, userId);
}

export function getTemplate(userId: string, templateId: string) {
  return apiFetch<ExamTemplate>(`${templates}/${id(templateId)}`, userId);
}

/**
 * The paper goes through as multipart, streamed, not through apiFetch (which
 * would serialise it as JSON) — as kb.server.ts uploadDocument does.
 */
export async function uploadPaper(
  userId: string,
  file: File,
): Promise<{ status: number; error?: string; code?: string; template?: ExamTemplate }> {
  const body = new FormData();
  body.set("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${templates}`, {
      method: "POST",
      headers: { ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), [USER_ID_HEADER]: userId },
      body,
    });
  } catch {
    return { status: 503, error: "The API could not be reached." };
  }
  const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & Partial<ExamTemplate>;
  if (res.ok) return { status: res.status, template: payload as ExamTemplate };
  return { status: res.status, error: payload.error, code: payload.code };
}

export type TemplateReview = {
  title?: string;
  time_limit_minutes?: number;
  clear_time_limit?: boolean;
  items?: TemplateItem[];
  ready?: boolean;
};

export function reviewTemplate(userId: string, templateId: string, body: TemplateReview) {
  return apiFetch<ExamTemplate>(`${templates}/${id(templateId)}`, userId, { method: "PATCH", body });
}

export function deleteTemplate(userId: string, templateId: string) {
  return apiFetch<void>(`${templates}/${id(templateId)}`, userId, { method: "DELETE" });
}

export function cancelTemplate(userId: string, templateId: string) {
  return apiFetch<void>(`${templates}/${id(templateId)}/cancel`, userId, { method: "POST" });
}

/** The stored paper, streamed through with Range both ways for pdf.js. */
export async function fetchPaper(userId: string, templateId: string, request: Request): Promise<Response> {
  const forward: Record<string, string> = {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    [USER_ID_HEADER]: userId,
  };
  for (const name of ["Range", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value) forward[name] = value;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${templates}/${id(templateId)}/file`, { headers: forward, signal: request.signal });
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }
  const headers = new Headers();
  for (const name of [
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "Last-Modified",
    "Cache-Control",
    "Content-Disposition",
    "Content-Security-Policy",
    "X-Content-Type-Options",
  ]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

export function listExams(userId: string) {
  return apiFetch<{ exams: Exam[] }>(exams, userId);
}

export function createExam(userId: string, body: { template_id: string; kb_id: string }) {
  return apiFetch<Exam>(exams, userId, { method: "POST", body });
}

export function getExam(userId: string, examId: string) {
  return apiFetch<ExamView>(`${exams}/${id(examId)}`, userId);
}

export function startExam(userId: string, examId: string, timeLimitMinutes?: number) {
  return apiFetch<ExamView>(`${exams}/${id(examId)}/start`, userId, {
    method: "POST",
    body: timeLimitMinutes ? { time_limit_minutes: timeLimitMinutes } : {},
  });
}

export function saveAnswers(userId: string, examId: string, answers: { item_id: string; answer: string }[]) {
  return apiFetch<void>(`${exams}/${id(examId)}/answers`, userId, { method: "PUT", body: { answers } });
}

export function submitExam(userId: string, examId: string) {
  return apiFetch<ExamView>(`${exams}/${id(examId)}/submit`, userId, { method: "POST" });
}

export function cancelExam(userId: string, examId: string) {
  return apiFetch<void>(`${exams}/${id(examId)}/cancel`, userId, { method: "POST" });
}

export function deleteExam(userId: string, examId: string) {
  return apiFetch<void>(`${exams}/${id(examId)}`, userId, { method: "DELETE" });
}
