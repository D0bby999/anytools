'use server';

import { requireAdmin } from '@/lib/auth-guards';
import { type TemplateRow, createDistributionApi } from '@/lib/distribution-api';
import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ brandSlug: string }> }): Promise<Metadata> {
  const { brandSlug } = await params;
  return { title: `Templates — ${brandSlug} — Distribution Admin` };
}

// ── server action ─────────────────────────────────────────────────────────────

// Form actions must return void — errors are surfaced by the page re-render.
async function toggleTemplateAction(formData: FormData): Promise<void> {
  'use server';
  // requireAdmin must be first — validates session before reading input.
  const session = await requireAdmin();

  const brandSlug = formData.get('brandSlug');
  const templateId = formData.get('templateId');
  const enabledRaw = formData.get('enabled');

  if (typeof brandSlug !== 'string' || typeof templateId !== 'string') return;

  const enabled = enabledRaw === 'true';

  const api = createDistributionApi({ actorEmail: session.user.email });
  try {
    await api.toggleTemplate(brandSlug, templateId, enabled);
  } catch {
    // Swallow for v1 — page re-renders with current state on next load.
    return;
  }

  revalidatePath(`/admin/distribution/brands/${brandSlug}/templates`);
}

// ── page ───────────────────────────────────────────────────────────────────────

export default async function BrandTemplatesPage({
  params,
}: { params: Promise<{ brandSlug: string; locale: string }> }) {
  const session = await requireAdmin();
  const { brandSlug, locale } = await params;

  const api = createDistributionApi({ actorEmail: session.user.email });

  let templates: TemplateRow[] | null;
  try {
    templates = await api.getTemplates(brandSlug);
  } catch {
    templates = null;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">
          Templates — <span className="font-mono capitalize">{brandSlug}</span>
        </h1>
        <Link
          href={`/${locale}/admin/distribution/brands/${brandSlug}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← back to brand
        </Link>
      </div>

      {/*
        Template preview is intentionally read-only in v1. Executing Handlebars
        server-side with user-supplied helpers would risk RCE; rendering via the
        internal API with sample data requires a preview endpoint that does not
        yet exist. For now the raw template text is shown so operators can verify
        content without triggering execution. Full live-preview is deferred.
      */}
      <div className="mb-4 rounded border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Template text is shown read-only. Live preview (rendered output) is deferred to v2.
        Enable/disable toggles take effect immediately for new posts — existing scheduled posts are
        not affected.
      </div>

      {!templates ? (
        <p className="text-destructive text-sm">Could not load templates.</p>
      ) : templates.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No templates configured for <strong>{brandSlug}</strong>.
        </p>
      ) : (
        <div className="space-y-4">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border bg-card p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="font-medium">
                    {t.variant}
                    <span className="ml-2 text-xs text-muted-foreground font-mono">
                      {t.platformId}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{t.id}</div>
                </div>

                {/* Enable/disable toggle */}
                <form action={toggleTemplateAction}>
                  <input type="hidden" name="brandSlug" value={brandSlug} />
                  <input type="hidden" name="templateId" value={t.id} />
                  <input type="hidden" name="enabled" value={t.enabled ? 'false' : 'true'} />
                  <button
                    type="submit"
                    className={`rounded px-3 py-1 text-xs font-medium border ${
                      t.enabled
                        ? 'border-destructive text-destructive hover:bg-destructive/10'
                        : 'border-green-600 text-green-700 hover:bg-green-50'
                    }`}
                  >
                    {t.enabled ? 'Disable' : 'Enable'}
                  </button>
                </form>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground mb-2">
                  Title template
                </summary>
                {/* Raw template text — not executed, not rendered as HTML */}
                <pre className="rounded bg-muted px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap">
                  {t.titleTemplate}
                </pre>
              </details>

              <details className="text-sm mt-2">
                <summary className="cursor-pointer text-muted-foreground mb-2">
                  Body template
                </summary>
                <pre className="rounded bg-muted px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap">
                  {t.bodyTemplate}
                </pre>
              </details>

              {t.imageTemplateSvgPath && (
                <p className="mt-2 text-xs text-muted-foreground">
                  SVG path: <code className="font-mono">{t.imageTemplateSvgPath}</code>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
