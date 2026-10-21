// @vitest-environment node
/**
 * calendar-feed.test.ts
 * The study calendar's public route (learning-tool-connections phase 2): only
 * a well-formed `<token>.ics` reaches the API, a token the API does not know
 * is a 404, and Google's add link subscribes to the webcal form of the URL.
 */
import { describe, expect, it, vi } from "vitest";

const readCalendarFeed = vi.fn();
vi.mock("~/lib/calendar.server", () => ({ readCalendarFeed: (t: string) => readCalendarFeed(t) }));

const { loader } = await import("~/routes/cal.$file");
const { googleCalendarAddURL } = await import("~/lib/calendar-types");

const call = (file: string) => loader({ params: { file } } as never);
const TOKEN = `test-feed-token-${"x".repeat(27)}`;

describe("GET /cal/<token>.ics", () => {
  it("serves the feed as text/calendar, uncached", async () => {
    readCalendarFeed.mockResolvedValueOnce("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    const res = (await call(`${TOKEN}.ics`)) as Response;
    expect(readCalendarFeed).toHaveBeenCalledWith(TOKEN);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
  });

  it("answers 404 for an unknown token and never asks the API about a malformed one", async () => {
    readCalendarFeed.mockReset().mockResolvedValueOnce(null);
    await expect(call(`${TOKEN}.ics`)).rejects.toMatchObject({ status: 404 });
    for (const bad of [TOKEN, "short.ics", `${TOKEN}.ics.exe`, "../../etc.ics"]) {
      await expect(call(bad)).rejects.toMatchObject({ status: 404 });
    }
    expect(readCalendarFeed).toHaveBeenCalledTimes(1);
  });
});

describe("googleCalendarAddURL", () => {
  it("hands Google the webcal form of the feed URL", () => {
    const url = new URL(googleCalendarAddURL(`https://anytools.world/cal/${TOKEN}.ics`));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/r");
    expect(url.searchParams.get("cid")).toBe(`webcal://anytools.world/cal/${TOKEN}.ics`);
  });
});
