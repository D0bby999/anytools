/**
 * mastery-form.ts
 * Turns ProposalEditor's plain form fields back into the modules the approve
 * endpoint takes. Kept out of the route module so it is testable on its own.
 */
import type { ProposedModule } from "~/lib/study-types";

/** Rebuilds the approved modules from ProposalEditor's plain fields. */
export function parseApproval(form: FormData): ProposedModule[] {
  const count = Math.min(20, Number(form.get("modules") ?? 0) || 0);
  let types: Record<string, string> = {};
  try {
    types = JSON.parse(String(form.get("types") ?? "{}")) as Record<string, string>;
  } catch {
    types = {};
  }
  // Points the knowledge base hardly covers, by name: kept, they stay marked.
  let outside: string[] = [];
  try {
    const parsed = JSON.parse(String(form.get("outside") ?? "[]")) as unknown;
    outside = Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    outside = [];
  }
  const modules: ProposedModule[] = [];
  for (let i = 0; i < count; i++) {
    if (!form.get(`module-${i}-keep`)) continue;
    const points = String(form.get(`module-${i}-points`) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, type: types[name] ?? "concept", ...(outside.includes(name) ? { outside_source: true } : {}) }));
    modules.push({
      name: String(form.get(`module-${i}-name`) ?? "").trim(),
      objective: String(form.get(`module-${i}-objective`) ?? "").trim(),
      pass_threshold: Number(form.get(`module-${i}-threshold`) ?? 0.7) || 0.7,
      knowledge_points: points,
    });
  }
  return modules;
}
