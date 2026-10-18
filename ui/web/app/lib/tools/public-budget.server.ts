/**
 * tools/public-budget.server.ts
 * Per-client-IP budgets for the two public tool routes that do work on this
 * server (AnyTools phase 3a). They answer anyone, signed in or not, so there
 * is no user to charge: like sign-in (ip-limit.server.ts), the budget is the
 * address's.
 *
 *  - `curl-convert` parses a command with tree-sitter: CPU on this process.
 *  - `fx` may call Frankfurter, a free third-party service, on a cache miss.
 *
 * Each route's line in routes.ts carries `// budget: <name>`, and a test holds
 * those markers equal to this list (app/test/tools-server-routes.test.ts).
 */
import { clientIP, createIPLimiter } from "~/lib/ip-limit.server";

export const TOOL_BUDGETS = {
  "curl-convert": { perMinute: 30, burst: 10 },
  fx: { perMinute: 60, burst: 20 },
} as const;

export type ToolBudget = keyof typeof TOOL_BUDGETS;

function limiters() {
  const out = {} as Record<ToolBudget, (ip: string) => boolean>;
  for (const [name, b] of Object.entries(TOOL_BUDGETS)) out[name as ToolBudget] = createIPLimiter(b.perMinute, b.burst);
  return out;
}

let budgets = limiters();

/** Tests drive a route many times from one "address"; each starts fresh. */
export function __resetToolBudgetsForTests(): void {
  budgets = limiters();
}

/**
 * A 429 when this client has spent the route's budget, else null. JSON,
 * because both tools read `error` from the body of any failed answer.
 */
export function overToolBudget(name: ToolBudget, request: Request): Response | null {
  if (budgets[name](clientIP(request))) return null;
  return Response.json(
    { error: "Too many requests. Wait a minute and try again." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}
