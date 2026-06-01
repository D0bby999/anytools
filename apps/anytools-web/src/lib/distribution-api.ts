/**
 * Typed HTTP client for the distribution-cron internal admin API.
 *
 * Used exclusively from server components and server actions — never imported
 * into client components. The base URL and token never reach the browser.
 *
 * Base URL: DISTRIBUTION_INTERNAL_URL (e.g. http://distribution-cron:3010)
 * Auth:     X-Internal-Token header (shared secret, Docker-network only)
 * Actor:    X-Actor-Email header (admin email from Better Auth session)
 */

// ── shared types ──────────────────────────────────────────────────────────────

export interface BrandRow {
  slug: string;
  name: string;
  primaryColor: string;
  secondaryColor: string | null;
  logoUrl: string | null;
  websiteUrl: string;
  rssUrl: string | null;
  amazonTrackingTag: string | null;
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
}

export interface CredentialRow {
  brandSlug: string;
  platformId: string;
  platformAccountId: string;
  enabled: boolean;
  consecutiveFailures: number;
  lastUsedAt: string | null;
  lastFailureAt: string | null;
  lastSuccessfulRefreshAt: string | null;
}

export type PostStatus = 'scheduled' | 'in_flight' | 'posted' | 'failed' | 'cancelled';

export interface PostRow {
  id: string;
  brandSlug: string;
  platformId: string;
  blogSlug: string;
  templateId: string | null;
  scheduledFor: string;
  postedAt: string | null;
  platformPostId: string | null;
  platformPostUrl: string | null;
  status: PostStatus;
  failureReason: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  contentPayload: Record<string, unknown>;
  createdAt: string;
}

export interface TemplateRow {
  id: string;
  brandSlug: string;
  platformId: string;
  variant: string;
  titleTemplate: string;
  bodyTemplate: string;
  imageTemplateSvgPath: string | null;
  enabled: boolean;
}

export interface DashboardBrandStat {
  brandSlug: string;
  total: number;
  posted: number;
  failed: number;
}

export interface TopPin {
  brandSlug: string;
  postId: string;
  platformPostUrl: string | null;
  clicks: number;
}

export interface DashboardData {
  window_days: number;
  brands: DashboardBrandStat[];
  top_pins: TopPin[];
}

export interface PatchBrandInput {
  name?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string;
  websiteUrl?: string;
  amazonTrackingTag?: string;
  status?: 'active' | 'paused' | 'archived';
}

// ── validation helpers ────────────────────────────────────────────────────────
// anytools-web does not have zod in its dependencies.
// These guards validate inputs at the server-action boundary before they reach
// the internal API, preventing injection of malformed data.

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertPostStatus(value: unknown): PostStatus {
  const valid: PostStatus[] = ['scheduled', 'in_flight', 'posted', 'failed', 'cancelled'];
  if (!valid.includes(value as PostStatus)) {
    throw new Error(`Invalid status value: ${String(value)}`);
  }
  return value as PostStatus;
}

export interface PostsFilter {
  platform?: string;
  status?: PostStatus;
  from?: string;
  to?: string;
}

/** Validate a PostsFilter object; throws on invalid fields. */
export function validatePostsFilter(raw: {
  platform?: unknown;
  status?: unknown;
  from?: unknown;
  to?: unknown;
}): PostsFilter {
  const filter: PostsFilter = {};
  if (raw.platform !== undefined) {
    filter.platform = assertNonEmptyString(raw.platform, 'platform');
  }
  if (raw.status !== undefined) {
    filter.status = assertPostStatus(raw.status);
  }
  if (raw.from !== undefined) {
    const s = assertNonEmptyString(raw.from, 'from');
    if (Number.isNaN(Date.parse(s))) throw new Error('from must be a valid ISO date string');
    filter.from = s;
  }
  if (raw.to !== undefined) {
    const s = assertNonEmptyString(raw.to, 'to');
    if (Number.isNaN(Date.parse(s))) throw new Error('to must be a valid ISO date string');
    filter.to = s;
  }
  return filter;
}

// ── client factory ────────────────────────────────────────────────────────────

export interface DistributionApiOptions {
  /** Admin's email — forwarded as X-Actor-Email so audit rows record who acted. */
  actorEmail: string;
}

class DistributionApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DistributionApiError';
  }
}

async function apiFetch<T>(path: string, init: RequestInit, actorEmail: string): Promise<T> {
  const base = process.env.DISTRIBUTION_INTERNAL_URL ?? 'http://distribution-cron:3010';
  const token = process.env.INTERNAL_API_TOKEN ?? '';

  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': token,
      'X-Actor-Email': actorEmail,
      ...(init.headers as Record<string, string> | undefined),
    },
    // Server actions are already server-side; no need to cache internal API calls.
    cache: 'no-store',
  });

  if (!res.ok) {
    let msg = `Internal API error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore parse failure — use default message
    }
    throw new DistributionApiError(res.status, msg);
  }

  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ── public API ─────────────────────────────────────────────────────────────────

export function createDistributionApi(opts: DistributionApiOptions) {
  const { actorEmail } = opts;
  const get = <T>(path: string) => apiFetch<T>(path, { method: 'GET' }, actorEmail);
  const post = <T>(path: string, body?: unknown) =>
    apiFetch<T>(
      path,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
      actorEmail,
    );
  const patch = <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }, actorEmail);

  return {
    getDashboard(opts: { brand?: string; days?: number } = {}): Promise<DashboardData> {
      const q = buildQuery({
        brand: opts.brand,
        days: opts.days !== undefined ? String(opts.days) : undefined,
      });
      return get<DashboardData>(`/admin/dashboard${q}`);
    },

    getBrands(): Promise<BrandRow[]> {
      return get<BrandRow[]>('/admin/brands');
    },

    patchBrand(slug: string, updates: PatchBrandInput): Promise<BrandRow> {
      return patch<BrandRow>(`/admin/brands/${encodeURIComponent(slug)}`, updates);
    },

    getCredentials(): Promise<CredentialRow[]> {
      return get<CredentialRow[]>('/admin/credentials');
    },

    getPosts(brandSlug: string, filter: PostsFilter = {}): Promise<PostRow[]> {
      const q = buildQuery({
        platform: filter.platform,
        status: filter.status,
        from: filter.from,
        to: filter.to,
      });
      return get<PostRow[]>(`/admin/brands/${encodeURIComponent(brandSlug)}/posts${q}`);
    },

    getPost(brandSlug: string, postId: string): Promise<PostRow> {
      return get<PostRow>(
        `/admin/brands/${encodeURIComponent(brandSlug)}/posts/${encodeURIComponent(postId)}`,
      );
    },

    retryPost(brandSlug: string, postId: string): Promise<PostRow> {
      return post<PostRow>(
        `/admin/brands/${encodeURIComponent(brandSlug)}/posts/${encodeURIComponent(postId)}/retry`,
      );
    },

    cancelPost(brandSlug: string, postId: string): Promise<PostRow> {
      return post<PostRow>(
        `/admin/brands/${encodeURIComponent(brandSlug)}/posts/${encodeURIComponent(postId)}/cancel`,
      );
    },

    getTemplates(brandSlug: string): Promise<TemplateRow[]> {
      return get<TemplateRow[]>(`/admin/brands/${encodeURIComponent(brandSlug)}/templates`);
    },

    toggleTemplate(brandSlug: string, templateId: string, enabled: boolean): Promise<TemplateRow> {
      return patch<TemplateRow>(
        `/admin/brands/${encodeURIComponent(brandSlug)}/templates/${encodeURIComponent(templateId)}`,
        { enabled },
      );
    },

    getAuditLog(brandSlug: string): Promise<unknown[]> {
      return get<unknown[]>(`/admin/brands/${encodeURIComponent(brandSlug)}/audit`);
    },
  };
}

export { DistributionApiError };
