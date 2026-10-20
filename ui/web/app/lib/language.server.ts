/**
 * language.server.ts
 * Which language AnyLearn speaks before it knows the learner, and the cookie
 * that carries that choice from the sign-in page into the new account.
 *
 * Order on the sign-in page: `?lang=`, then the public page the visitor came
 * from (/vi/anylearn → vi), then the browser's Accept-Language. A signed-in
 * learner's language is their account's (users.language); app-layout fills
 * an unset one from this cookie once.
 */
import { createCookie } from "react-router";
import { isPublicLng, isSupportedLng, type PublicLng, type SupportedLng } from "~/lib/i18n";
import { useSecureCookies } from "~/lib/env.server";

export const languageCookie = createCookie("anylearn-lang", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: useSecureCookies,
  maxAge: 60 * 60 * 24 * 365,
});

/** The visitor's language when no account says otherwise. */
export async function visitorLanguage(request: Request): Promise<SupportedLng> {
  const url = new URL(request.url);
  const asked = url.searchParams.get("lang") ?? "";
  if (isSupportedLng(asked)) return asked;
  const cookie = (await languageCookie.parse(request.headers.get("Cookie"))) as unknown;
  if (typeof cookie === "string" && isSupportedLng(cookie)) return cookie;
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const from = new URL(referer);
      const first = from.pathname.split("/")[1] ?? "";
      if (from.host === url.host && isSupportedLng(first)) return first;
    } catch {
      // A malformed Referer says nothing.
    }
  }
  return pickPublicLocale(request.headers.get("Accept-Language"));
}

/**
 * The public pages' language for a visitor: the one they last opened (this
 * cookie, set by landing.tsx and the sign-in page), else their browser's.
 */
export async function publicLanguage(request: Request): Promise<PublicLng> {
  const kept = (await languageCookie.parse(request.headers.get("Cookie"))) as unknown;
  return typeof kept === "string" && isPublicLng(kept) ? kept : pickPublicLocale(request.headers.get("Accept-Language"));
}

/** `vi-VN,vi;q=0.9,en;q=0.8` -> "vi". Ranked by q, primary subtag only. */
export function pickPublicLocale(acceptLanguage: string | null): PublicLng {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag = "", ...attrs] = part.trim().split(";");
      const q = attrs.map((a) => /^\s*q=([0-9.]+)\s*$/.exec(a)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split("-")[0] ?? "", q: q === undefined ? 1 : Number(q), i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find(isPublicLng) ?? "en";
}
