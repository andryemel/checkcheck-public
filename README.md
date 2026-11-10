# CheckCheck by Jinna

**Know who you’re dealing with.** Type who you are about to meet, hire, fund or partner with, and get a short, sourced briefing about that person or company in under a minute. Share it by link or email.

This is a standalone public demo of CheckCheck, a skill of [Jinna](https://jinna.ai), built for the OpenRouter × Meta Build Day. Every check calls **Meta Muse Ember through OpenRouter** at runtime.

- Model: `meta/muse-ember` (the only model; there is no fallback)
- Search: OpenRouter's `openrouter:web_search` server tool, Exa engine, capped at 3 searches per check
- No login, no account, no database required to run it locally

## What $1 buys

Measured on the full workflow (four real checks while building this):

| | |
|---|---|
| Cost of one check | **$0.023 to $0.024** (as reported by OpenRouter, every model call included) |
| Checks per $1 | **about 42** |
| Where the money goes | about 90% is the three web searches ($0.007 each); the model itself is about $0.002 |
| Time | 15 to 21 seconds end to end |

The page shows the real cost under every report. It is read from OpenRouter's `usage.cost`, never estimated. If a call reports no cost, the page says so instead of showing zero.

## How a check works

```
request (free text)
  │  purpose screen                 no model, no network: hiring, tenancy, credit,
  │                                 litigation and private-life requests are refused
  │  limits                         per-IP, daily checks, daily dollars (reserved up front)
  ▼
Muse Ember  ── who is the subject?  one small structured-output call (~$0.0002).
  │                                 The name must occur in the visitor's own words;
  │                                 links and e-mails are read by the app, not the model
  │  a person with no company, site, city or link → one question, nothing is researched yet
  ▼
records the app fetches itself      domain registration (RDAP), the subject's own homepage,
  │                                 optionally UK Companies House and OpenSanctions
  ▼
Muse Ember + web search (Exa, ≤3)   ONE call writes the briefing with a citation per sentence
  ▼
validation (no model)               every link is compared with what the search returned;
  │                                 the app fetches the cited pages itself and removes a
  │                                 sentence whose figure is not on its page; routine filters
  ▼
report on the page  →  share link  →  email draft
```

## What is checked, and what is not

The search returns, for each page, a URL, a title and **excerpts**. It does not say which sentence rests on which page, and it does not return the queries the model issued. The app is honest about that:

| Check | Status |
|---|---|
| A link in the report is a page the search really returned (or an official record the app fetched) | **Runs.** A link that is not is removed. |
| A figure in a sentence appears in the text of the page that sentence cites | **Runs** when the app could read the page itself. An unreadable page is treated as unknown, not as a failure. |
| Purpose restrictions (no hiring, tenancy, credit or private-life screening) | **Runs**, before any spending. |
| A person named with no anchor gets a question first | **Runs.** |
| Identity: do the pages name the subject together with an anchor the visitor gave? | **Reported** on every report as confirmed / name only / unconfirmed. |
| Sentence-level sourcing | **Does not run.** The data is not available. A source under a section means "cited by the model and really returned by the search", not "verified". |
| Same-name (namesake) filter | **Does not run.** It needs sentence-level sourcing. |
| Review of the search queries | **Does not run.** The queries are not returned. |
| UK company register and sanctions lists | Run only when their API keys are set; otherwise listed as "not searched". |

Every report lists the checks that did not run. Nothing that could not be checked is shown as passed.

## Sharing

- **Share report** stores a copy under a random 128-bit id and gives a link (`/r/<id>`) that opens without login.
- The shared copy leaves out the visitor's request, the "For your situation" section (the only place the prompt allows the visitor's situation), any remaining sentence addressed to "you", and any sentence that repeats five or more consecutive words of the request.
- Shared pages send `X-Robots-Tag: noindex` and carry a `noindex` meta tag. They are not listed anywhere.
- **Email report** opens the visitor's own mail app with the subject and link filled in. No email is sent by the server.

## Run it locally

Requires Node 20 or newer and an [OpenRouter](https://openrouter.ai) key with access to `meta/muse-ember`.

```bash
npm install
cp .env.example .env        # then put your key after OPENROUTER_API_KEY=
npm run dev                 # page on http://localhost:5199, API on http://localhost:8787
```

Or as one process, the way a host would run it:

```bash
npm run build && npm start  # http://localhost:8787
```

Other commands:

```bash
npm test         # offline tests of the demo-specific code (no key, no network)
npm run scan     # pre-publication scan for credentials in publishable files and the built page
npx tsx --env-file=.env.local scripts/test-store.ts   # store and spending-cap tests against the configured store
npm run typecheck
```

Set a **credit limit on the OpenRouter key** itself. The limits in this app are the inner wall; the key's limit is the outer one.

## Configuration

All configuration is in environment variables; see [`.env.example`](.env.example). The ones that matter in public:

| Variable | Default | Meaning |
|---|---|---|
| `CHECKS_PER_IP_PER_HOUR` | 5 | Per-visitor limit |
| `DAILY_CHECK_CAP` | 150 | Checks per UTC day, all visitors |
| `DAILY_SPEND_CAP_USD` | 5 | Dollars per UTC day. Enforced by reserving the worst case before a check starts |
| `CHECK_RESERVE_USD` | 0.06 | The worst-case cost reserved per check |
| `STORE_DRIVER` | `file` | `file` for local use, `redis` for any serverless host |
| `CHECKCHECK_MAX_OUTPUT_TOKENS` | 8000 | Output cap. Reasoning tokens count against it |
| `CHECKCHECK_TIMEOUT_MS` | 150000 | The research call is abandoned after this long |

Two separate limits apply to the model call and they fail differently: if the **output** cap is reached the report is marked "partial"; if the **input** is too long for the model the check fails with a clear message. Raising the output cap does not help with the second.

## Deploying

The project is laid out for [Vercel](https://vercel.com):

- the page is built by Vite into `public/` and served as static files;
- the whole Express app is bundled into one function (`api/index.js` → `dist-server/app.mjs`), and `vercel.json` sends every `/api/*` request to it;
- `vercel.json` also maps `/r/<id>` to the page and adds the `noindex` header to shared reports.

Facts from Vercel's documentation (November 2026) that shaped this: functions may run up to 300 seconds on every plan and can stream with `res.write()` (a check takes 10 to 20 seconds and is abandoned at 150); `express.static()` is ignored, so static files must come from `public/`; the filesystem is not persistent.

Storage on any serverless host must be Redis: set `STORE_DRIVER=redis` and either `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` that Vercel's Upstash integration sets. Counters use `INCRBY`, which is atomic.

**Status: verified on a Vercel preview deployment with an Upstash Redis store.** One complete check, its share link, the shared report from a cookie-less request, and the day's counters in Redis were all checked there. `scripts/test-store.ts` exercises the store, including a race of 10 simultaneous requests against room for 3 (exactly 3 are admitted).

## Limits of this demo

- It is not a background check. It must not be used for hiring, tenancy, credit or insurance decisions.
- It reads public pages. It can be wrong, out of date, or about a different person with the same name. Read the sources.
- Checks on companies are more reliable than checks on people, because registers and a company's own site anchor the identity.
- The file store is for one local process. Use Redis anywhere else.
- Limits are per IP address and per day; a determined visitor with many addresses is stopped by the daily caps and by the credit limit on the key, not by the per-IP limit.

## Code

```
server/
  index.ts              HTTP: /api/check (server-sent events), /api/share, /api/shared/:id
                        (api/index.js wraps the bundled app as the Vercel function)
  limits.ts  store.ts   caps and persistence (file or Redis)
  checkcheck/
    openrouter.ts       the only model client; one model, no fallback, cost per call
    extract.ts          free text → subject
    prompt.ts           the research prompt of this demo
    pipeline.ts         records → research → validation; the shared-copy sanitiser
    records/ header/    registers, domain, homepage; the header block
    validate*.ts, linkEvidence.ts, pageCache.ts, pageVerification.ts,
    routineFilters.ts, registryLines.ts …   CheckCheck's validation, reused from Jinna
client/src/
  pages/                the landing page and the shared-report page
  demo/                 API client, report panel (cost, evidence notes, share, email)
  components/checkcheck the CheckCheck report view, reused from Jinna, read-only here
```

The research prompt in this repository is an adaptation written for this demo. Jinna's production prompt, owner context, contacts and memory are not part of it.

## Licence

The code is released under the [MIT licence](LICENSE). The Jinna and CheckCheck names, the Jinna logo and the sphere artwork are trademarks and brand assets of Jinna; the licence does not grant rights to them. See [NOTICE](NOTICE.md) for third-party software and services.

## Usage statistics and request log (private)

The server keeps two private things, neither of which is served over HTTP:

- **Counters:** page views, distinct visitors per day, checks started and finished, clarifying questions, refusals, limit hits, shares, shared-report opens and spend.
- **A request log:** for each request, the time, the visitor's country (from the host's geolocation header), the request as typed, the subject read from it, how it ended, its cost and duration. No IP address is kept. The log holds the newest 5,000 entries and expires 90 days after the last write. The page tells visitors that requests are logged.

The operator reads both from the store:

```bash
STORE_DRIVER=redis npx tsx --env-file=.env.local scripts/stats.ts 14
STORE_DRIVER=redis npx tsx --env-file=.env.local scripts/requests.ts 50
```

If you run your own copy for the public, the request log holds personal data (visitors' words about named people): say so in your own privacy notice, or switch it off by removing the `logRequest` call in `server/index.ts`.
