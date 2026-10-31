# Front end + back end: how we work, and how we merge

Two people, two branches, one meeting point. If both follow the file rules below, tomorrow's merge has no conflicts.

## Branches

| Branch | Who | What |
|---|---|---|
| `main` | Nobody works here directly | The shared starting point, including the API contract (`js/api.js`, `docs/API.md`, `tests/api.test.mjs`) |
| `frontend` | Rohith | The website: pages, styles, landing, readers, dashboard |
| `backend` | Back-end teammate | `functions/`: the API, AI providers, limits, access gate |
| `backup/original-2026-10-30` | Never touch | The site exactly as it was before this work |

## Who changes which files

| Files | Owner | The other person |
|---|---|---|
| `index.html`, `omr.html`, `privacy.html`, `css/`, `js/` (except `js/api.js`), `vendor/`, `models/`, `tools/` | Front end | Does not edit |
| `functions/` (`api/ai.js`, `_middleware.js`, anything new in there) | Back end | Does not edit |
| `js/api.js`, `docs/API.md`, `tests/api.test.mjs` | **Shared: the contract** | Change only together, and tell the other person |
| `README.md`, `_headers`, `.gitignore`, `tests/` (other files) | Shared | Small edits only; keep both sides' lines when merging |

### Back-end rules
- Keep the address `/api/ai` and the reply shapes in `docs/API.md`. Adding a new field is fine. Renaming or removing one is a contract change.
- New error code: add it to the table in `docs/API.md` and tell the front end, which needs a message for it.
- New route (for example `/api/history`): add it to `docs/API.md` and a function for it in `js/api.js`, then the front end calls that function.
- Test with `node --test` (the back end's own tests are `tests/ai.test.mjs` and `tests/fallback.test.mjs`).

### Front-end rules
- Never call `fetch('/api/...')` directly. Use `MarkLensAPI.config()` and `MarkLensAPI.call()` from `js/api.js`.
- Do not edit `functions/`.

## Tonight

**Back end (first time):**
```bash
git clone https://github.com/duckpatcst/marklens
cd marklens
git checkout -b backend origin/main
# work only in functions/ ... then
git add functions docs/API.md
git commit -m "Back end: ..."
git push -u origin backend
```

**Front end:** keep working on `frontend` and push it before you sleep.

## Run both together on one laptop

```bash
cp .dev.vars.example .dev.vars        # then put the access code (and an AI key if you have one) in it
npx wrangler pages dev .              # serves the pages AND functions/ at http://127.0.0.1:8788
```
`.dev.vars` is ignored by git, so keys never get committed. Without an AI key, MarkLens works with the on-phone reader and Google Lens, and the AI buttons stay hidden.

## Tomorrow: the merge (about 15 minutes)

On one laptop, with both branches pushed:

```bash
git fetch origin
git checkout main
git pull

git merge --no-ff origin/frontend -m "Merge front end"
node --test                            # must say: fail 0

git merge --no-ff origin/backend -m "Merge back end"
node --test                            # must say: fail 0
```

If git reports a conflict, it can only be in a shared file:
- `README.md`, `.gitignore`, `_headers`: keep **both** sides' lines.
- `js/api.js` or `docs/API.md`: the back-end version of the contract wins; then check the front end still calls it correctly.
- Then `git add <file>` and `git commit`.

Then test it for real:
```bash
npx wrangler pages dev .                                           # terminal 1
node tools/check-backend.mjs http://localhost:8788 --code YOUR_CODE  # terminal 2
```
The checker logs in like the page does and tests every rule in `docs/API.md` (access gate, `GET /api/ai` fields,
403 for other sites, error codes the page knows). It ends with **"The front end will work with this back end"** or names
exactly what does not match. Add `--live` to also send one tiny real AI job (needs an AI key in `.dev.vars`).
- [ ] The page opens after the access code
- [ ] The example paper marks itself, and one scroll flies the marks into their lessons
- [ ] Analyzer: Reload example, the table and dashboard show 21 / 38
- [ ] Pick NEET in "Which exam is next?": the Analyzer switches to the OMR example
- [ ] With an AI key in `.dev.vars`: "AI reader" appears and Google Lens text is sorted
- [ ] Anything the back end added works from the page

When every box is ticked:
```bash
git push origin main
```

## Plugging in his back end, step by step

1. **Easiest (the plan above):** his code lives in `functions/` on the same site. The page already calls `/api/ai`, so
   nothing in the front end changes. Run the checker; if it passes, the page works.
2. **He renamed or added a task:** add it to `docs/API.md`, call it through `MarkLensAPI.call({ task: '...' })` in
   `index.html`, and give any new error code a message in the `ERR` table. The checker flags unknown error codes.
3. **His back end runs on another address** (for example his own server): put it in the page head,
   `<meta name="marklens-api" content="https://his-server.example">` (already there, empty = same site), and add that
   address to `connect-src` in `_headers`. His server must then also allow this site with CORS
   (`Access-Control-Allow-Origin: <our site>`, `Access-Control-Allow-Credentials: true`) and accept our site as
   `Origin`. Option 1 avoids all of this, so prefer it.

Run the checker against any address: `node tools/check-backend.mjs https://marklens.pages.dev --code YOUR_CODE`.

## Putting it online

The live site (marklens.pages.dev) is built by Cloudflare Pages from the old GitHub account's repository. Either:
1. In Cloudflare: Workers & Pages → the MarkLens project → Settings → Builds → connect `duckpatcst/marklens`, branch `main`. Or
2. Push the merged `main` to the old repository.

Secrets (`ACCESS_CODE`, `GROQ_API_KEY` and the rest) stay in Cloudflare and need no change.
