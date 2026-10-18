/**
 * low-day.server.ts
 * The Home "Low day" switch (up-methods phase 13). up asks for no record of a
 * low day itself, so there is no server state: the switch is a cookie that
 * names the learner and the local day it was turned on, and it lapses by
 * itself when that day ends. Naming the learner keeps a shared browser's other
 * account out of it.
 */
import { createCookie } from "react-router";
import { useSecureCookies } from "~/lib/env.server";

type LowDay = { user: string; day: string };

const lowDayCookie = createCookie("__anytools_low_day", {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: useSecureCookies,
  // Two days covers every zone's "today"; the day check does the real work.
  maxAge: 60 * 60 * 48,
});

/** Whether the switch is on for this learner on this local day. */
export async function isLowDay(request: Request, userId: string, today: string): Promise<boolean> {
  const value = (await lowDayCookie.parse(request.headers.get("Cookie"))) as LowDay | null;
  return !!value && value.user === userId && value.day === today;
}

/** The Set-Cookie header that turns the switch on or off for today. */
export function lowDayHeader(on: boolean, userId: string, today: string): Promise<string> {
  return on
    ? lowDayCookie.serialize({ user: userId, day: today } satisfies LowDay)
    : lowDayCookie.serialize("", { maxAge: 0 });
}
