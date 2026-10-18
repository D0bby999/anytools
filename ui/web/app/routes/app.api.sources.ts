/**
 * app.api.sources.ts
 * Resource route: documentation sites and GitHub repositories (up-methods
 * phase 18).
 *
 * - The loader reads one site's pages (`?site=`), fetched when the learner
 *   opens the page list rather than on every knowledge-base load.
 * - The action adds, re-syncs, cancels and deletes. Every submission is
 *   followed by React Router's revalidation, so the knowledge base page's own
 *   loader shows the new state.
 *
 * Both call requireUserId; the API resolves every id with the caller's.
 */
import type { Route } from "./+types/app.api.sources";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import {
  addRepo,
  addSite,
  cancelSite,
  deleteRepo,
  deleteSite,
  getSite,
  resyncRepo,
  resyncSite,
} from "~/lib/sources.server";
import { splitList, type SitePage, type SourceActionData } from "~/lib/sources-types";
import { driveReason } from "~/lib/drive-storage";

export type SitePagesData = { ok: true; pages: SitePage[] } | { ok: false; error: string };

export async function loader({ request }: Route.LoaderArgs): Promise<SitePagesData> {
  const userId = await requireUserId(request);
  const site = new URL(request.url).searchParams.get("site") ?? "";
  try {
    const { pages } = await getSite(userId, site);
    return { ok: true, pages };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}

function intNumber(value: FormDataEntryValue | null, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function action({ request }: Route.ActionArgs): Promise<SourceActionData> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const kb = String(form.get("kb") ?? "");
  try {
    switch (intent) {
      case "add-site": {
        const { site } = await addSite(userId, kb, {
          url: String(form.get("url") ?? "").trim(),
          depth: intNumber(form.get("depth"), 2),
          pages: intNumber(form.get("pages"), 50),
        });
        return { ok: true, intent, title: site.title };
      }
      case "add-repo": {
        const extensions = form.getAll("ext").map(String);
        extensions.push(...splitList(String(form.get("more_ext") ?? "")));
        const { repo } = await addRepo(userId, kb, {
          url: String(form.get("url") ?? "").trim(),
          branch: String(form.get("branch") ?? "").trim(),
          path: String(form.get("path") ?? "").trim(),
          extensions,
          ignore: String(form.get("ignore") ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        });
        return { ok: true, intent, title: `${repo.owner}/${repo.name}` };
      }
      case "resync-site":
        await resyncSite(userId, id);
        return { ok: true, intent };
      case "cancel-site":
        await cancelSite(userId, id);
        return { ok: true, intent };
      case "delete-site":
        await deleteSite(userId, id);
        return { ok: true, intent };
      case "resync-repo":
        await resyncRepo(userId, id);
        return { ok: true, intent };
      case "delete-repo":
        await deleteRepo(userId, id);
        return { ok: true, intent };
    }
    return { ok: false, intent, error: "" };
  } catch (error) {
    if (error instanceof ApiError) {
      // Refused by the learner's own storage Drive (drive-user-storage
      // phase 5): the form says why, with what to do.
      const reason = driveReason(error.code);
      return { ok: false, intent, error: error.message, ...(reason ? { driveReason: reason } : {}) };
    }
    throw error;
  }
}
