# Upstream Attribution: timestamp-converter

- Core parsing/formatting: native `Date` + `Intl.DateTimeFormat`.
- Timezone-aware formatting: [`date-fns-tz`](https://github.com/marnusw/date-fns-tz) (MIT) — uses the Intl APIs underneath, gives us a clean `formatInTimeZone` helper.
- Date pattern formatting: [`date-fns`](https://github.com/date-fns/date-fns) (MIT) — used by date-fns-tz transitively.

We expose: `parseTimestamp` (auto-detect format), four output converters, `formatInZone`, `relativeFromNow`, and a curated common-timezone list.
