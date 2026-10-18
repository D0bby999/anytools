/**
 * api.curl-convert.ts
 * POST /api/curl-convert: the curl-converter tool's server half (AnyTools
 * phase 3a), at the old site's URL, with its limits and answers:
 *
 *   { curl, target } -> 200 { code }
 *   bad JSON, no command, unknown target -> 400 { error }
 *   a command over 8000 characters -> 413 { error }
 *   a command curlconverter cannot parse -> 422 { error }
 *
 * Added here: a body read is capped before it is parsed (413), and each
 * address has a budget (429, public-budget.server.ts). Public, so no sign-in,
 * but still origin-checked like every action: getUserId refuses a cross-site
 * POST before anything runs, and its answer is otherwise unused.
 */
import type { Route } from "./+types/api.curl-convert";
import { getUserId } from "~/lib/auth.server";
import { BodyTooLargeError, readTextLimited } from "~/lib/tools/bounded-read.server";
import { MAX_CURL_CHARS, convertCurl, isCurlTarget } from "~/lib/tools/curl-convert.server";
import { overToolBudget } from "~/lib/tools/public-budget.server";

/** 8000 characters as JSON: room for every one escaped as \uXXXX, and the target. */
const MAX_BODY_BYTES = 64 * 1024;

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return fail(405, "Method not allowed");
  await getUserId(request);
  const over = overToolBudget("curl-convert", request);
  if (over) return over;

  let body: { curl?: unknown; target?: unknown };
  try {
    body = JSON.parse(await readTextLimited(request.body, MAX_BODY_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyTooLargeError) return fail(413, `curl too long (max ${MAX_CURL_CHARS} chars)`);
    return fail(400, "Invalid JSON body");
  }
  if (body === null || typeof body !== "object") return fail(400, "Invalid JSON body");

  const { curl, target } = body;
  if (typeof curl !== "string" || !curl.trim()) return fail(400, "curl is required");
  if (curl.length > MAX_CURL_CHARS) return fail(413, `curl too long (max ${MAX_CURL_CHARS} chars)`);
  if (!isCurlTarget(target)) return fail(400, "Invalid target");

  try {
    return Response.json({ code: await convertCurl(curl, target) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(422, e instanceof Error ? e.message : "Parse failed");
  }
}
