/**
 * progress.server.ts
 * Progress and study circles from the API (the private design notes). Server-side only.
 */
import { apiFetch } from "~/lib/api.server";

export type ProgressCounts = {
  reviews: number;
  questions: number;
  explains: number;
  workouts: number;
  recordings: number;
  highlights: number;
  skill: number;
};

export type ProgressSettings = { week_goal: number; rest_days: number };

export type Milestone = { kind: MilestoneKind; target: number; value: number; reached_on?: string };

export const MILESTONE_KINDS = ["days", "streak", "weeks", "long_term", "mastered", "reviews", "workouts"] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export type Progress = {
  today: string;
  settings: ProgressSettings;
  streak: { current: number; longest: number; studied_today: boolean; rest_used: number; rest_left: number };
  week: { start: string; days: number; goal: number; met: boolean; in_a_row: number; longest: number };
  level: { level: number; days: number; from: number; next: number };
  totals: ProgressCounts;
  outcomes: {
    long_term: number;
    learning: number;
    mastered: number;
    explains_passed: number;
    right: number;
    answered: number;
  };
  milestones: Milestone[];
  calendar: { day: string; count: number }[];
  weeks: { start: string; days: number; count: ProgressCounts }[];
};

export function getProgress(userId: string) {
  return apiFetch<Progress>("/v1/progress", userId);
}

/** Home's line: the streak, this week and the level. */
export type ProgressBrief = { streak: number; studied_today: boolean; week_days: number; week_goal: number; level: number; last_studied?: string };

export function getProgressBrief(userId: string) {
  return apiFetch<ProgressBrief>("/v1/progress/brief", userId);
}

export function setProgressSettings(userId: string, settings: ProgressSettings) {
  return apiFetch<ProgressSettings>("/v1/progress/settings", userId, { method: "PUT", body: settings });
}

/** A circle as one of its members sees it. */
export type Circle = {
  id: string;
  name: string;
  invite_code: string;
  members: number;
  owner: boolean;
  nickname: string;
  created_at: string;
};

export type CircleMember = {
  id: string;
  nickname: string;
  owner: boolean;
  me: boolean;
  joined_at: string;
  cheered: boolean;
  cheers: number;
  progress: ProgressBrief;
};

export type Cheer = { from: string; circle_id: string; circle: string; at: string };

export function listCircles(userId: string) {
  return apiFetch<{ circles: Circle[]; cheers: Cheer[] }>("/v1/circles", userId);
}

export function getCircle(userId: string, id: string) {
  return apiFetch<{ circle: Circle; members: CircleMember[]; met_goal: number }>(`/v1/circles/${encodeURIComponent(id)}`, userId);
}

export function createCircle(userId: string, name: string, nickname: string) {
  return apiFetch<Circle>("/v1/circles", userId, { method: "POST", body: { name, nickname } });
}

export function joinCircle(userId: string, code: string, nickname: string) {
  return apiFetch<Circle>("/v1/circles/join", userId, { method: "POST", body: { code, nickname } });
}

export function updateCircle(userId: string, id: string, patch: { name?: string; nickname?: string }) {
  return apiFetch<void>(`/v1/circles/${encodeURIComponent(id)}`, userId, { method: "PATCH", body: patch });
}

export function newInvite(userId: string, id: string) {
  return apiFetch<{ invite_code: string }>(`/v1/circles/${encodeURIComponent(id)}/invite`, userId, { method: "POST" });
}

export function leaveCircle(userId: string, id: string) {
  return apiFetch<void>(`/v1/circles/${encodeURIComponent(id)}/leave`, userId, { method: "POST" });
}

export function removeMember(userId: string, id: string, memberId: string) {
  return apiFetch<void>(`/v1/circles/${encodeURIComponent(id)}/remove`, userId, { method: "POST", body: { member_id: memberId } });
}

export function cheerMember(userId: string, id: string, memberId: string) {
  return apiFetch<{ new: boolean }>(`/v1/circles/${encodeURIComponent(id)}/cheers`, userId, { method: "POST", body: { member_id: memberId } });
}
