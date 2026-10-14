# Usage analytics

The site counts visits and what people do on the page with [GoatCounter](https://www.goatcounter.com/). It sets no
cookies and stores no personal data, so the page needs no consent banner. This file is the reference for anyone,
person or agent, working to grow the site's readership: what is measured, what each number means, and how to read it.

## Setup

| Piece | Where | Notes |
| --- | --- | --- |
| Site code | `GOATCOUNTER` in `site/js/analytics.js` | The `CODE` in `https://CODE.goatcounter.com`. Empty turns analytics off. Public, not a secret. |
| Tracking | `site/js/analytics.js` | Loads `https://gc.zgo.at/count.js`, sends one page view and the events below. Skips localhost. |
| API token | `GOATCOUNTER_TOKEN` repository secret | Read-only ("Read statistics") key from GoatCounter → user menu → API. Never commit it. |
| Daily snapshot | `.github/workflows/analytics.yml`, `pipeline/analytics-snapshot.mjs` | Writes the last 30 days to the `analytics` branch every day at 05:15 UTC. Does nothing until the secret is set. |

Page paths drop the `/Grid-Records` GitHub Pages prefix, so the home page is `/` both there and on the custom domain.

## How GoatCounter counts

- A **visit** is a page view, counted once per visitor session per page (GoatCounter's own session handling, which
  uses a short-lived hash rather than a cookie). Reloads within the session don't add to it.
- An **event** is counted at most once per page view by `track()`, and GoatCounter also collapses repeats within a
  session. So an event's count reads as "visits in which this happened", and dividing by visits gives a rate.
- **Referrers** (`toprefs`) are the sites people came from. Search engines and social sites are grouped by GoatCounter.
  Campaigns come from `utm_campaign` or `ref` query parameters, so tag links posted elsewhere, for example
  `?utm_campaign=reddit-uk-energy`.
- Ad and tracker blockers block count.js, so all numbers are a floor. Treat trends as more reliable than totals.

## Events

Every event name sent by `site/js/analytics.js`. Keep this table in step with that file.

### Reach and attention

| Event | Fires when | Why it matters |
| --- | --- | --- |
| `section-seen-now`, `-records`, `-story`, `-about` | That section's heading scrolls into view | How far down the page readers get, by section |
| `scroll-25`, `-50`, `-75`, `-100` | The bottom of the window passes that share of the page | Depth of reading |
| `engaged-30s`, `-2m`, `-5m`, `-15m` | The tab has been visible for that long in total | Attention; bounce is roughly visits minus `engaged-30s` |
| `arrive-shared-settings` | The page opened with records settings in the address (`#...`) | People sharing a specific record view |
| `outbound-<host>` | A link to another site is clicked; title holds the full URL | Which sources and credits people follow |

### Records tool

| Event | Fires when |
| --- | --- |
| `records-measure-<preset>` | A measure is picked, for example `records-measure-gas`, `records-measure-custom` |
| `records-mode-below`, `records-mode-above` | The record type is switched |
| `records-unit-gw`, `records-unit-pct` | Units are switched |
| `records-thresholds-edit` | Thresholds are typed in |
| `records-sources-edit` | The custom group's source editor is opened |
| `records-sources-change` | A source is ticked or unticked |
| `timeline-range-7`, `-30`, `-365`, `-all` | The "measure over time" range is changed |
| `timeline-scale-linear`, `timeline-scale-log` | The timeline scale is changed |

### The story

| Event | Fires when |
| --- | --- |
| `chapter-open-1` … `chapter-open-5` | A chapter is opened. Chapter 1 starts open, so it counts every visit |
| `chapter-next-2` … `chapter-next-5` | A "Next" button at the end of a chapter is used |
| `details-open-<summary>` | Any other disclosure is opened, named from its summary, e.g. `details-open-about-the-battery-data` |
| `battery-range-3`, `-14`, `-90` | The battery chart range is changed |
| `battery-source-pn`, `battery-source-b1610` | The battery source used in records is changed |
| `battery-origins-run` | "Work it out" is pressed to run the battery origins model |

## Key metrics

These are the numbers to move. Rates are event count divided by visits over the same range.

| Metric | Definition | Reads as |
| --- | --- | --- |
| Visits | Sum of page counts | Readership |
| Visits per day | `daily` in the snapshot | Growth trend |
| Referral mix | `toprefs` shares | Which channels bring readers |
| Engaged rate | `engaged-30s` / visits | Share who stay past a glance |
| Deep read rate | `scroll-75` / visits | Share who reach the story |
| Tool use rate | Visits with any `records-*` event / visits (approximate with the largest `records-*` count) | Share who play with the records tool |
| Story completion | `chapter-open-5` / `chapter-open-2` | How far chapter readers get |
| Share rate | `arrive-shared-settings` / visits | How often record views are shared |

## Reading the numbers

### From the `analytics` branch (no credentials)

```
git fetch origin analytics
git show origin/analytics:latest.json | jq '{visits, daily, events: [.events[] | {name, count}], toprefs}'
git log --oneline origin/analytics          # one commit per day
git show origin/analytics:snapshots/2026-10-20.json
```

`latest.json` holds: `range`, `visits`, `pageviewsTotal`, `eventsTotal`, `daily` (date → count), `pages` and
`events` (each with `name`, `title`, `count`, `daily`), `eventRates` (event → count / visits), and the breakdowns
`toprefs`, `campaigns`, `browsers`, `systems`, `sizes` (screen size class) and `locations` (country), each a list of
`{name, count}`.

### From the GoatCounter API (needs the token)

The API is at `https://CODE.goatcounter.com/api/v0`, with `Authorization: Bearer $GOATCOUNTER_TOKEN`, and allows 4
requests a second. Dates are RFC 3339.

```
API=https://CODE.goatcounter.com/api/v0
H="Authorization: Bearer $GOATCOUNTER_TOKEN"
curl -sH "$H" "$API/stats/total?start=2026-10-01T00:00:00Z"                # page views and events by day
curl -sH "$H" "$API/stats/hits?start=2026-10-01T00:00:00Z&limit=100"      # every page and event, with counts
curl -sH "$H" "$API/stats/toprefs?start=2026-10-01T00:00:00Z"             # referrers
curl -sH "$H" "$API/stats/hits/PATH_ID"                                    # referrers for one page
```

Other breakdowns: `/stats/campaigns`, `/stats/browsers`, `/stats/systems`, `/stats/sizes`, `/stats/locations`.
The full schema is at https://www.goatcounter.com/api.json. Raw hits can be exported as CSV with `POST /export`.

A Claude cloud session needs the token as an environment secret and `*.goatcounter.com` allowed in its network
policy to call the API directly; otherwise read the `analytics` branch.

## Adding an event

Call `track('name')` from `site/js/analytics.js` (or import it), or add a selector to `CLICKS` or `CHANGES` there.
Names are lowercase, hyphenated, start with the area (`records-`, `chapter-`, `battery-`), and must not start with `/`.
Add the event to the tables above in the same change.
