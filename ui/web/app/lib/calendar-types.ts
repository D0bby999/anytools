/** Mirrors calendar.Include. */
export type CalendarInclude = { review: boolean; loop: boolean; body: boolean };

/** Mirrors calendar.Feed. */
export type CalendarFeed = {
  token: string;
  named: boolean;
  include: CalendarInclude;
  created_at: string;
  fetched_at?: string;
};

/** Google Calendar's "add by URL" link for a feed (webcal, so Google subscribes). */
export function googleCalendarAddURL(feedURL: string): string {
  const webcal = feedURL.replace(/^https?:\/\//, "webcal://");
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}

/** Mirrors gcal.Link. */
export type GCalLink = { calendar_id: string; synced_at?: string; last_error?: string; created_at: string };
