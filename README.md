# MarkLens: put it online for free

MarkLens is a website. Students photograph a question paper and their exam sheet, and the dashboard shows where marks were lost.

It reads pages in three ways:

- **Google Lens · recommended for handwriting.** Students take or choose photos of every page as usual and tap **Read with Google Lens**. MarkLens opens each photo in Google Lens (through the phone's share menu, or long-press → Search with Google Lens). The student taps Text → Select all → Copy and comes back, and MarkLens picks up the text and moves to the next photo. After the last photo, the text (never the photo) is sorted into questions or marks with the AI and matched to the question paper. Without an AI key, MarkLens's built-in rules sort it instead.
- **On this phone · free.** Uses Tesseract, which runs inside the browser. Nothing is sent anywhere, and it needs no account or key.
- **AI reader** and **AI grading.** These use a free AI service, Groq by default. They are better for handwriting and can grade unmarked answers. They only appear once you add an API key (step 3).

You need a computer for setup. It takes about 20 minutes. Everything below is free.

---

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The MarkLens website |
| `privacy.html` | The privacy notice that students see |
| `omr.html` | Prints blank MarkLens OMR answer sheets (up to 200 questions on one A4 page, A–D or A–E) |
| `js/omr.js` | The OMR sheet layout and the on-phone OMR reader |
| (online) | The free on-phone photo reader, Tesseract 5.1.1 (Apache 2.0), loads from jsDelivr the first time |
| `functions/api/ai.js` | The hidden helper that talks to the AI company. Your API key lives here, never in the page |
| `_headers` | Security settings for the website |

---

## Step 1: Put the files on GitHub

1. Make a free account at **github.com**.
2. Click **+** (top right) → **New repository**.
3. Name it `marklens`. Choose **Private** if you like, because Cloudflare can still read it. Click **Create repository**.
4. On the next page, click **uploading an existing file**.
5. Open the `marklens-site` folder on your computer. Select **everything inside it** (`index.html`, `privacy.html`, `_headers`, `README.md` and the `functions` folder). Drag it all into the GitHub page.
   - Drag the *contents*, not the `marklens-site` folder itself. `index.html` must sit at the top level of the repository.
   - Use Chrome or Edge on a computer. Phones can't upload folders.
6. Click **Commit changes**.

Check: the repository's main page should list `index.html`, `privacy.html`, `_headers` and `functions`.

## Step 2: Publish the website with Cloudflare Pages

1. Make a free account at **dash.cloudflare.com**.
2. Go to **Workers & Pages** → **Create** → the **Pages** tab → **Import an existing Git repository** (it may say *Connect to Git*).
3. Connect your GitHub account and choose the `marklens` repository.
4. Use these build settings:
   - Framework preset: **None**
   - Build command: *leave empty*
   - Build output directory: `/`
5. Click **Save and Deploy**.

After a minute, you get an address like `https://marklens.pages.dev`. MarkLens works now with the free on-phone reader. The AI options stay hidden until step 3.

Cloudflare renames menus from time to time. If a button name differs, look for the closest match.

## Step 3: Switch on the AI reader with a free Groq key

1. Go to **console.groq.com** and sign up. You must be 18 or older.
2. Open **API Keys** → **Create API Key**. Copy the key; it starts with `gsk_`.
3. In Cloudflare, open your Pages project → **Settings** → **Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Name: `GROQ_API_KEY`
   - Value: paste your key
   - Add it for **Production**
4. Go to **Deployments**, open the latest one, and click **Retry deployment**. Secrets only apply to new deployments.

Open your site again. **AI reader · best for handwriting** and **Unmarked · AI grades** should now appear.

**Keep the key secret.** Don't put it in any file, in GitHub, or in a chat message. If it leaks, delete it in the Groq console and make a new one.

## Step 4 (recommended): Daily limit per device

Without this, one person could use up your free Groq allowance for everyone. MarkLens counts each phone or computer on its own (a random device id in a cookie), so a whole school on one Wi-Fi address is not treated as one visitor.

1. In Cloudflare: **Storage & Databases** → **KV** (or **Workers & Pages → KV**) → **Create namespace**. Name it `marklens-limits`.
2. Open your Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - Variable name: `RATE_LIMIT`
   - Namespace: `marklens-limits`
3. Optional: add a plain-text variable `DAILY_LIMIT` with a number, such as `30`. The default is 40 AI requests per device per day.
4. Retry the deployment as in step 3.

A per-minute limit (15 AI requests a minute per device) is always on, even without KV. The free KV plan allows 1,000 writes a day, which is about 1,000 AI requests; for a school, use a free D1 database instead (see "For schools and institutes" below). If KV runs out of writes, MarkLens keeps working and counts in memory.

---

## Optional settings

| Variable | Type | What it does |
|---|---|---|
| `AI_PROVIDER` | Text | `groq` (default), `openai` (any OpenAI-compatible service or your own AI server), `workers-ai`, or `gemini` |
| `AI_BASE_URL` | Text | For `openai`: the service's address, such as `https://api.openai.com/v1` |
| `AI_API_KEY` | Secret | For `openai`: the service's key (leave out for your own server if it needs none) |
| `AI_MODEL` | Text | Model name. Required for `openai`; elsewhere it replaces the default model |
| `AI_NAME` | Text | Name students see in the notice, such as `OpenAI` or `our school's AI server` |
| `AI_VISION` | Text | `no` if the model can't read photos. The photo AI reader is hidden; Google Lens and AI grading still work |
| `AI_MAX_IMAGES` | Text | Photos per AI request (default 1). Paid plans can take more, which reads faster |
| `AI_AUTH_HEADER` | Text | Header for the key if it isn't `Authorization: Bearer`. Azure OpenAI uses `api-key` |
| `AI_HEADERS` | Secret | Extra headers as JSON, such as a Cloudflare Access service token for a campus server |
| `AI_MAX_TOKENS_FIELD` | Text | `max_tokens` for older servers (default `max_completion_tokens`) |
| `AI_TEMPERATURE` | Text | Default 0.1. `off` leaves it out, for models that only allow their default |
| `AI_TIMEOUT_SECONDS` | Text | How long to wait for an answer (default 90) |
| `GEMINI_API_KEY` | Secret | Key from aistudio.google.com. Only used when `AI_PROVIDER` is `gemini` |
| `DAILY_LIMIT` | Text | AI requests per device per day (default 40) |
| `SITE_DAILY_LIMIT` | Text | AI requests per day for the whole site. A spend cap when the AI is paid for |
| `BURST_LIMIT` | Text | AI requests per device per minute (default 15) |
| `LOGIN_IP_LIMIT` | Text | Wrong access codes per network address per 15 minutes before a pause (default 50). Each device also gets 8 |
| `DB` | D1 binding | Keeps the usage counts. 100,000 free writes a day, so it suits schools |
| `RATE_LIMIT` | KV binding | Also keeps the counts, but only 1,000 free writes a day |
| `AI` | Workers AI binding | Free backup: when the main AI is busy, a Qwen model runs on Cloudflare (Settings → Bindings → Add → Workers AI, name `AI`) |

### About Google Gemini

**Use Gemini only if every user is an adult.** Google's Gemini API terms say the API must not be used in apps "directed towards or likely to be accessed by individuals under the age of 18". On the free tier, Google uses what you send to improve its products, and human reviewers may read it. When Gemini is on, MarkLens asks every user to confirm they are 18 or older before anything is sent.

### If the AI reader stops working

- **"busy" messages.** The AI's per-minute allowance is used up for now. It resets on its own. Check your limits in the AI provider's console, or move to a paid plan (see "For schools and institutes").
- **"did not accept this site's settings".** The AI key, address or model name is wrong. Check `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL`.
- **"allowance for this site is used up".** `SITE_DAILY_LIMIT` was reached. It resets at midnight UTC (5:30 am in India).
- **Everything fails after months of working.** The model may have been renamed or retired. Find a current image-reading model in Groq's docs (console.groq.com/docs/vision) and set it as `AI_MODEL`. The default is `qwen/qwen3.8-27b`.
- **AI options don't appear.** The key is missing, or the deployment wasn't retried after adding it.

---

## OMR sheets (multiple-choice tests)

Choose **OMR sheet** under Exam sheet. MarkLens reads its own printed OMR sheets on the phone: free, private, and with no AI, so AI limits don't apply.

1. **Print sheets.** Tap **Print blank OMR sheets** (or open `omr.html`). Choose up to 200 questions (enough for NEET's 180) and A–D or A–E, and print at 100% on A4. Photocopies work.
2. **Answer key.** Fill one sheet with the right answers and scan it, or type the answers (`1-B`, `2-D`, or a row of letters like `BDACB`). Put `Section: Physics` lines before groups of questions to name their topics. `4-AC` accepts either option; `5-*` gives everyone the marks (NTA's rule for a dropped question). A question's topic follows its number, so a line added at the end still lands in the right section.
3. **Marking scheme.** Set the marks for a right answer and the minus for a wrong one (NEET and JEE Main: 4 and 1). Two or more bubbles in one question count as wrong.
4. **Students' sheets.** Take a photo of each filled sheet, keeping all four black corner squares in the photo, and tap **Read the OMR sheet**.
   - A check image circles what was read: green = read, orange = faint or unclear, red = more than one bubble.
   - The dashboard adds accuracy, marks lost to negative marking, and bubbling mistakes.

**How it reads.** It finds the four corner squares, straightens the photo, and reads the code strip along the bottom (number of questions and options). It then compares each bubble's inside with the paper around it. Photos that are tilted, sideways, upside down, shadowed or far away all work.

If the corners or code can't be trusted (a cut-off sheet, another page), it refuses the photo rather than guess.

In tests on 74 simulated phone photos of 20- to 200-question sheets it read all 6,421 filled answers correctly, and flagged every double mark. With NTA's official NEET (UG) 2026 re-exam final key (booklet code 50, with a dropped question and a two-answer question), a 180-question student sheet was read exactly and scored 545 / 720, the same as a hand calculation. Faint marks and ticks were flagged for a look rather than guessed. Check the first few real sheets against the check image.

## For schools and institutes: their own copy, their own AI

The free Groq key is shared by everyone who uses one copy of MarkLens: about 1,000 AI requests and 200,000 tokens a day on Groq's free plan (October 2026). That is roughly 30 to 40 students a day using Google Lens, and fewer with the photo AI reader. A school needs more than that, and its usage and costs should be its own. So each institution runs **its own copy** of MarkLens on **its own free Cloudflare account**, with **its own AI**. The person who sells or sets up MarkLens pays nothing for AI or hosting.

### 1. Its own copy

Follow steps 1 and 2 above in the institution's own GitHub and Cloudflare accounts, or have them create a Cloudflare API token so you can publish it for them. Give it its own `ACCESS_CODE` (12 or more characters).

### 2. Its own AI (pick one)

| Option | Settings | Who pays |
|---|---|---|
| Groq, paid plan | `GROQ_API_KEY` (from the school's own Groq account, upgraded to the Developer plan) | The school, per use. Much higher limits than free |
| OpenAI | `AI_PROVIDER=openai`, `AI_BASE_URL=https://api.openai.com/v1`, `AI_API_KEY`, `AI_MODEL` (an image-reading model) | The school, per use |
| Azure OpenAI | `AI_PROVIDER=openai`, `AI_BASE_URL` = the resource's OpenAI v1 address, `AI_API_KEY`, `AI_AUTH_HEADER=api-key`, `AI_MODEL` = the deployment name | The school, under its Microsoft agreement |
| OpenRouter, Together and similar | `AI_PROVIDER=openai`, their `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | The school, per use |
| Cloudflare Workers AI | `AI_PROVIDER=workers-ai`, Workers AI binding `AI`, optional `AI_MODEL` | Free up to 10,000 neurons a day; then the school's Workers Paid plan |
| The school's own AI server | Ollama, vLLM or LM Studio running an open model, reached through a Cloudflare Tunnel: `AI_PROVIDER=openai`, `AI_BASE_URL=https://ai.school.in/v1`, `AI_MODEL`, `AI_NAME=our school's AI server`, optional `AI_HEADERS` for a Cloudflare Access service token. Use `AI_VISION=no` for a text-only model | The school's own hardware. Student data stays with the school |

The address must start with `https://`. Students see the AI's name (`AI_NAME`) in the own-risk notice and on the privacy page.

### 3. Fair limits and a spend cap

1. **Workers & Pages → D1 → Create database**, named `marklens-usage`.
2. Pages project → **Settings → Bindings → Add → D1 database**, variable name `DB`.
3. Set `DAILY_LIMIT` (per device per day) and `SITE_DAILY_LIMIT` (the whole school per day), then retry the deployment.

MarkLens creates its table by itself. To see usage, open the database's **Console** and run `SELECT day, n FROM ml_usage WHERE who = '*site' ORDER BY day DESC`.

### Rough sizing

- **Google Lens:** 2 or 3 text-only AI requests per student per exam, about 4,000 to 6,000 tokens.
- **Photo AI reader:** about 2,000 to 3,000 tokens per photo.
- **Cost:** on a paid plan priced like Groq's Qwen3 32B ($0.29 per million input tokens, $0.59 per million output tokens, mid-2026), the Google Lens route costs a fraction of a US cent per student per exam. Check the provider's current prices.

---

## Privacy: your responsibilities as the site owner

- Whenever the AI reader is available, MarkLens shows an **own-risk notice** on the page: photos go to an outside AI company, may be saved and used to improve its output, and should have names and roll numbers cropped out. There is no tick-box. The full notice is on `privacy.html`.
- The on-phone reader never sends photos anywhere. Point cautious users to it.
- In India, the **Digital Personal Data Protection Act, 2023** has rules for processing personal data, with stricter consent rules for children under 18. If schools or many students will use your site, check what applies to you. This guide isn't legal advice.
- MarkLens keeps students' results only in their own browser. Your site stores only a random device id in a cookie and a daily count of AI requests per device; with D1, counts older than 35 days are deleted. Nothing in the counts names a student.

## Updating the site later

Upload changed files to the same GitHub repository, using **Add file → Upload files**. Cloudflare publishes the new version automatically within a minute.
