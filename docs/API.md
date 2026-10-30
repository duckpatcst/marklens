# MarkLens API contract

The front end and the back end meet in exactly one place:

| Side | File | Owner |
|---|---|---|
| Front end | `js/api.js` (the only file that calls the back end) | Front end, changed together with this document |
| Back end | `functions/api/ai.js`, `functions/_middleware.js` | Back end |

If either side wants to change anything below, change this file in the same pull request, so the other person sees it.
`tests/api.test.mjs` checks the front-end half with a fake back end; run `node --test`.

Base address: the same site (Cloudflare Pages Functions). To use a back end on another address, see the top of `js/api.js`.

---

## Access gate (every request)

`functions/_middleware.js` runs before every page, file and API call.

| Situation | Response |
|---|---|
| No valid `ml_access` cookie, page request | `401` with the access-code page |
| No valid cookie, `/api/*` request | `401` `{"error":"locked"}` |
| `POST /__login` with form field `code` | `303` to `/`, sets `ml_access` (30 days) |
| `GET /__logout` | `303` to `/`, clears it |

Every response also sets `ml_dev`, a random device id used for the daily limits.

---

## `GET /api/ai`: is the AI on?

Front end: `MarkLensAPI.config()` returns this object, or `null` when `enabled` is false or the request fails.

```json
{
  "enabled": true,
  "provider": "groq",
  "providerName": "Groq",
  "providers": ["Groq", "OpenRouter"],
  "vision": true,
  "maxImages": 1,
  "trains": false,
  "backup": "OpenRouter",
  "search": "Wikipedia",
  "solveMax": 4,
  "topicsMax": 40
}
```

| Field | Used by the front end for |
|---|---|
| `enabled` | Showing the AI reader and AI grading at all |
| `vision` | `false` hides the photo AI reader (Lens text and grading still work) |
| `providers`, `providerName`, `backup` | The own-risk notice and the privacy page |
| `trains` | The notice says the company may use what is sent to improve its AI |
| `maxImages` | Photos per `paper` / `sheet` / `answers` request |
| `search`, `solveMax`, `topicsMax` | The Correct answers panel and topic finder batch sizes |

---

## `POST /api/ai`: one job

Front end: `MarkLensAPI.call(body, onWait)`. Body is JSON, at most 9 MB. Requests must come from the same site (checked with `Origin` / `Sec-Fetch-Site`).
Every successful reply carries `via`: the AI that answered (for example `"groq"`).

| `task` | Request body (besides `task`) | Reply |
|---|---|---|
| `paper` | `images: [dataURL]`, `first`, `last`, `total` (page numbers) | `{ text }`: the question paper as text, one question per line, `[marks]` at the end |
| `sheet` | `images`, `first`, `last`, `total`, `paper` (question paper text) | `{ text }`: one line per question, `3: 2/5 remark` |
| `answers` | `images`, `first`, `last`, `total` | `{ text }`: the student's own answers as text |
| `tidy` | `kind: "paper" \| "sheet"`, `text` (copied with Google Lens), `first`, `last`, `total`, `paper` | `{ text }`: the same, sorted into lines as above |
| `grade` | `paper`, `answers` (text), `images: []`, `exam` | `{ result: { rows: [...] } }` |
| `topics` | `exam`, `questions: [{ q, text }]` (at most `topicsMax`) | `{ text }`: each question with `## Subject > Chapter > Topic` |
| `solve` | `exam`, `questions: [{ q, text, subject, chapter, topic, type, key, marked, max }]` (at most `solveMax`) | `{ answers: [{ q, answer, working, chapter, topic, confidence, sources: [{ title, url }], search, saved }], search }` |

`images` are JPEG data URLs (`data:image/jpeg;base64,...`), already shrunk by the page.

---

## Errors

Every error reply is `{ "error": "<code>" }` with the HTTP status below. The front end shows a message for each code, so a new code needs a new message in `index.html` (the `ERR` table used by `errMsg`).

| Code | Status | Meaning | Front end does |
|---|---|---|---|
| `locked` | 401 | No access cookie | Reload, which shows the access-code page |
| `forbidden` | 403 | Not sent from this site | Shows an error |
| `bad_request` | 400 | Missing or wrong fields | Shows an error |
| `no_vision` | 400 | Photos sent but the AI cannot read photos | Suggests Google Lens |
| `too_large` | 413 | Body over 9 MB | Asks for fewer or smaller photos |
| `busy` | 429 | Free AI busy; may include `retry_after` (seconds) | **Waits and retries automatically** (up to 4 times, 60 s max each), with a countdown |
| `limit` | 429 | This device's daily allowance is used | Says to try tomorrow |
| `site_limit` | 429 | The whole site's daily allowance is used | Says it resets at midnight UTC |
| `image_rejected` | 422 | The AI refused a photo | Asks for a clearer photo |
| `invalid_json` | 502 | The AI's reply could not be read | Suggests trying again |
| `ai_setup` | 502 | Wrong key, address or model name | Tells the site owner to check the settings |
| `upstream` | 502 | Any other AI failure | Suggests trying again |
| `not_configured` | 503 | No AI set up on this site | (AI options are already hidden) |
| `offline` | (front end only) | No connection after retries | Asks to check the connection |
