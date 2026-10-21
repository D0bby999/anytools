/**
 * feeds.$feedId.tsx
 * One podcast feed or YouTube playlist or channel (up-methods phase 17): its
 * entries, each with its date, its length and whether it is already in the
 * knowledge base. The learner ticks entries and adds them; each becomes an
 * ordinary document. Nothing is transcribed here: an episode waits for a
 * transcript, and its own page shows each engine's cost or time first.
 *
 * The keyless YouTube feed lists only the latest 15 videos, and the page
 * says so; a YouTube Data API key lists a whole playlist.
 */
import { useEffect } from "react";
import { Form, redirect, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { Route } from "./+types/feeds.$feedId";
import { appTitle, raw } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { Button } from "~/components/ui/button";
import { EntryPicker, FeedControls, FeedNotice } from "~/components/knowledge/feed-entries";
import {
  addFeedEntries,
  checkFeed,
  deleteFeed,
  getFeed,
  markFeedSeen,
  setFeedAutoAdd,
} from "~/lib/feeds.server";
import { entryState, type FeedActionData } from "~/lib/feeds-types";
import { PageHeader } from "~/components/ui/page-header";
import { DateText } from "~/components/ui/date-text";
import { BookMeta } from "~/components/doc/book-meta";
import { DocSection } from "~/components/reading/doc-section";

/** How often the list refreshes while entries are being added. */
const POLL_MS = 2500;

export function meta({ data, matches }: Route.MetaArgs) {
  return [
    { title: data?.feed ? appTitle(matches, raw(data.feed.title || data.feed.url)) : appTitle(matches) },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    return await getFeed(user.id, params.feedId);
  } catch (error) {
    // Another user's feed answers 404 exactly like a missing one.
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

function failure(intent: string, errorKey: string, error: unknown): FeedActionData {
  return { ok: false, intent, errorKey, errorDetail: error instanceof ApiError ? error.message : "" };
}

export async function action({ request, params }: Route.ActionArgs): Promise<FeedActionData | Response> {
  const { user } = await requireUser(request);
  const feedId = params.feedId;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  switch (intent) {
    case "check":
      try {
        const { new: found } = await checkFeed(user.id, feedId);
        return { ok: true, intent, count: found };
      } catch (error) {
        return failure(intent, "feed.errors.checkFailed", error);
      }
    case "add": {
      const entries = form.getAll("entry").map(String).filter(Boolean);
      try {
        const { queued } = await addFeedEntries(user.id, feedId, entries);
        return { ok: true, intent, count: queued.length };
      } catch (error) {
        return failure(intent, "feed.errors.addFailed", error);
      }
    }
    case "seen":
      try {
        await markFeedSeen(user.id, feedId);
        return { ok: true, intent };
      } catch (error) {
        return failure(intent, "feed.errors.updateFailed", error);
      }
    case "auto-add":
      try {
        await setFeedAutoAdd(user.id, feedId, form.get("auto_add") === "on");
        return { ok: true, intent };
      } catch (error) {
        return failure(intent, "feed.errors.updateFailed", error);
      }
    case "delete": {
      const kbId = String(form.get("kbId") ?? "");
      try {
        await deleteFeed(user.id, feedId);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          return failure(intent, "feed.errors.deleteFailed", error);
        }
      }
      return redirect(kbId ? `/knowledge/${encodeURIComponent(kbId)}` : "/knowledge");
    }
  }
  return { ok: false, intent, errorKey: "feed.errors.updateFailed", errorDetail: "" };
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("knowledge");
  const { feed, entries, limits } = loaderData;
  const revalidator = useRevalidator();
  const adding = entries.some((e) => entryState(e) === "queued");

  // While entries are being downloaded, refresh until they settle.
  useEffect(() => {
    if (!adding) return;
    const id = window.setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [adding, revalidator]);

  return (
    <div>
      <PageHeader title={feed.title || feed.url} className="mb-0">
        <BookMeta
          label={t("feed.metaLabel")}
          items={[
            { label: t("feed.back"), to: `/knowledge/${feed.kb_id}` },
            { label: t(`feed.kind.${feed.kind}`) },
            {
              label: (
                <span className="break-all">
                  <span className="sr-only">{t("feed.source")}: </span>
                  {feed.url}
                </span>
              ),
            },
            { label: t("feed.entryCount", { count: entries.length }) },
            ...(feed.last_checked_at
              ? [
                  {
                    label: (
                      <>
                        {t("card.updated")} <DateText iso={feed.last_checked_at} />
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </PageHeader>

      <FeedNotice feed={feed} limits={limits} />
      <FeedControls feed={feed} limits={limits} />

      <DocSection title={t("feed.entriesLabel")} id="lp-feed-entries">
        <p className="text-sm leading-6 text-muted-foreground">{t("feed.pickHint")}</p>
        <EntryPicker feedId={feed.id} entries={entries} limits={limits} />
      </DocSection>

      <Form method="post" className="mt-16 border-t pt-6">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="kbId" value={feed.kb_id} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          onClick={(event) => {
            if (!window.confirm(t("feed.deleteConfirm"))) event.preventDefault();
          }}
          className="border-destructive text-destructive hover:bg-destructive-soft"
        >
          <Trash2 aria-hidden="true" />
          {t("feed.delete")}
        </Button>
      </Form>
    </div>
  );
}
