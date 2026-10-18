# MarkLens: put it online for free

MarkLens is a website. Students photograph a question paper and their exam sheet, and the dashboard shows where marks were lost: the right answer to every question they got wrong, the topics they are weak in, and what share of their study time each subject should get.

It works for every kind of exam. Students pick theirs at the top of the Analyzer (school tests, CBSE, ICSE, ISC and state boards, NEET, JEE Main, JEE Advanced, CUET, state CETs, SSC, bank exams, UPSC Prelims, GATE, university exams, or "Any exam"), and MarkLens uses that exam's marking scheme, sections, grades and pass marks.

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
| `js/exams.js` | The exam types: marking schemes, sections by question number, grades and pass marks |
| `js/parse.js` | Reads the text of question papers, marked sheets and answer keys into questions, marks, subjects, chapters and topics, and scores multiple-choice and numerical answers |
| `js/insights.js` | Works out each question's subject, chapter and topic, ranks what to fix to win back the most marks, and shares study time between subjects |
| `js/dashboard.js` | Draws the dashboard |
| `tests/` | Automatic checks for the files above and for the AI helper (see "Checking the code" below). Not needed by the website |
| (online) | The free on-phone photo reader, Tesseract 5.1.1 (Apache 2.0), loads from jsDelivr the first time |
| `functions/api/ai.js` | The hidden helper that talks to the AI company and the search service. Your API keys live here, never in the page |
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
| `SEARCH_PROVIDER` | Text | Where correct answers are searched: `wikipedia` (default, free, no key), `tavily`, `serper`, `brave`, or `none` |
| `TAVILY_API_KEY` | Secret | Key from tavily.com (1,000 free searches a month, no card). Recommended: it finds the same question on solution sites |
| `SERPER_API_KEY` | Secret | Key from serper.dev: Google results (2,500 free searches, once) |
| `BRAVE_API_KEY` | Secret | Key from brave.com/search/api |
| `DAILY_LIMIT` | Text | AI requests per device per day (default 40) |
| `SITE_DAILY_LIMIT` | Text | AI requests per day for the whole site. A spend cap when the AI is paid for |
| `BURST_LIMIT` | Text | AI requests per device per minute (default 15) |
| `LOGIN_IP_LIMIT` | Text | Wrong access codes per network address per 15 minutes before a pause (default 50). Each device also gets 8 |
| `DB` | D1 binding | Keeps the usage counts. 100,000 free writes a day, so it suits schools |
| `RATE_LIMIT` | KV binding | Also keeps the counts, but only 1,000 free writes a day |
| `AI` | Workers AI binding | Free backup: when the main AI is busy, a Qwen model runs on Cloudflare (Settings → Bindings → Add → Workers AI, name `AI`) |

### Correct answers: which search engine

For every question a student lost marks on, the dashboard's **Correct answers** panel has a **Search Google** and a **Video solutions** link (these open Google or YouTube on the student's phone, so they always work and cost nothing). With the AI switched on, it also has **Get the answer** and **Find all answers**: the AI helper searches the web for the question, gives the results to the AI, and the AI writes the answer and a short worked solution, citing only the results it was given. For an OMR test it explains the answer in the key rather than overriding it. Answers the AI is unsure of are marked as such.

- **Out of the box: Wikipedia.** Free, needs no key. It finds the idea behind a question (the thin-lens formula, Mendel's laws) rather than the question itself.
- **Better: Tavily, free.** Sign up at **tavily.com**, copy the API key (it starts with `tvly-`), and add it in Cloudflare as a **Secret** named `TAVILY_API_KEY`, then retry the deployment as in step 3. It searches the whole web, so it often finds the same question with a worked solution. The free plan has 1,000 searches a month; each question looked up is one search.
- **Google results:** `SERPER_API_KEY` from serper.dev. **Brave:** `BRAVE_API_KEY`.
- Groq's own web-search models (compound and compound-mini) were retired on 21 September 2026, so the Groq key cannot search by itself.

Each request looks up 4 questions and counts as one AI request against the daily limits. With the `DB` binding (D1, below), worked answers are kept for 90 days, linked only to the question's words, so a class with the same paper gets them without searching again and without using up its allowance.

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
2. **Answer key.** Fill one sheet with the right answers and scan it, or type the answers (`1-B`, `2-D`, or a row of letters like `BDACB`). Put `Subject: Physics` before each subject and `Chapter: Optics` before each chapter's questions, so the dashboard can show which subjects and lessons cost marks. If the key has no Subject lines, NEET, JEE Main and SSC CGL keys get their subjects from the question numbers. `4-AC` accepts either option; `5-*` gives everyone the marks (NTA's rule for a dropped question). A question's subject and chapter follow its number, so a line added at the end still lands in the right place.
   - **Numerical answers** (JEE Main and Advanced, GATE): `21 = 12`, or a range `22 = 2.30 to 2.35`. The student's line is `21: 12`.
   - **Sections marked differently:** a line like `Marks: +4 -2 partial` applies to the questions after it. `partial` means several letters are all right and part-right answers get part marks (JEE Advanced: a mark for each right option chosen, minus 2 for any wrong one); `all` means all of them, with no part marks (GATE MSQ). `Marks: +2 -2/3` and `Marks: +1 0` work too.
   - **Topics:** `## Optics > Lenses` at the end of a line names the chapter and topic of its questions.
3. **Marking scheme.** Choose the exam at the top of the Analyzer and the boxes fill in (NEET and JEE Main: 4 and 1; CUET: 5 and 1; SSC CGL: 2 and 0.5; UPSC: 2 and 0.66). Two or more bubbles in one question count as wrong. On a test with minus marks, the dashboard also says how sure a student must be before a guess is worth it.
4. **Question paper (optional).** Under the key, paste the paper's text (copied with Google Lens or from the PDF). Each question then gets its topic, and the Correct answers panel shows the question with search links and worked answers.
5. **Students' sheets.** Take a photo of each filled sheet, keeping all four black corner squares in the photo, and tap **Read the OMR sheet**.
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
- **Correct answers:** one AI request per 4 questions looked up, about 3,000 to 4,500 tokens each, plus one search per question. **Topics with the AI:** one request per 30 questions.
- **Photo AI reader:** about 2,000 to 3,000 tokens per photo.
- **Cost:** on a paid plan priced like Groq's Qwen3 32B ($0.29 per million input tokens, $0.59 per million output tokens, mid-2026), the Google Lens route costs a fraction of a US cent per student per exam. Check the provider's current prices.

---

## Privacy: your responsibilities as the site owner

- Whenever the AI reader is available, MarkLens shows an **own-risk notice** on the page: photos go to an outside AI company, may be saved and used to improve its output, and should have names and roll numbers cropped out. There is no tick-box. The full notice is on `privacy.html`.
- The on-phone reader never sends photos anywhere. Point cautious users to it.
- In India, the **Digital Personal Data Protection Act, 2023** has rules for processing personal data, with stricter consent rules for children under 18. If schools or many students will use your site, check what applies to you. This guide isn't legal advice.
- MarkLens keeps students' results only in their own browser. Your site stores only a random device id in a cookie and a daily count of AI requests per device; with D1, counts older than 35 days are deleted. Nothing in the counts names a student.

## The dashboard: where to focus

After each paper the dashboard answers one question for the student: what should I work on to get the most marks back?

- **The exam.** The score is shown the way that exam is graded: CBSE grades (A1 to E2) with the 33% pass mark, ICSE, ISC and state-board pass marks, the 10-point university scale (O to F), or no grade at all for NEET, JEE and other ranked exams, which get accuracy, negative marks and a guessing rule instead.
- **Weak topics.** Every question gets a subject, a chapter and a topic, worked out from the question paper itself: from its headings and the words of each question (a list of about 60 chapters and 220 topics across Maths, Physics, Chemistry, Biology and English), or by the AI, which writes them onto each question line as `## Physics > Optics > Lens formula`. Topics are ranked by marks lost, and each one shows its share of the paper, so a big portion scored badly stands out.
- **Where your study time should go.** A percentage of study time for each subject (or each lesson, on a one-subject paper), plus one share for exam habits. Time is shared so that every hour wins back as many marks as possible: subjects with more marks to win back get more, and so do ones that take longer to fix. The percentages fit any amount of time before the next test.
- **Correct answers.** Every question where marks were lost, with its topic, the right option and the student's choice for an OMR test, links to search Google and YouTube, and, with the AI, the answer and a worked solution with its sources.

- **Within reach.** The score, and what it could be after working on the items in the student's plan. Ticking and unticking items moves the number.
- **Where to focus.** Every lost mark belongs to one item. Exam habits (careless slips, units and signs, presentation, timing, bubbling) are grouped across the paper; everything else is grouped by subject and lesson. Items are ordered by marks won back per hour of study. The gains and hours are estimates of what a typical student wins back, not promises.
- **Subjects and lessons.** Weakest first, with the marks within reach hatched. Subjects come from `Subject:` lines, from headings that name a subject, or from the chapter name (Optics is Physics). Lessons come from section and chapter headings, `#tags`, or the words in the question. Both can be changed in the table.
- **Question map and causes.** One box per question, filled as far as it scored, and the reasons marks were lost.
- **My papers.** Students can save each test (on their own device only) to see progress and the subjects that keep costing marks across tests.

## Checking the code

With Node.js 20 or later installed, run `node --test` in this folder. It checks the paper, sheet and answer-key readers, the exam types, the "where to focus" and study-time maths, and the AI helper's answers, topics and search services (with fake AI and search services, so nothing is sent anywhere). Run it before uploading changes to the `js` or `functions` files.

## Updating the site later

Upload changed files to the same GitHub repository, using **Add file → Upload files**. Cloudflare publishes the new version automatically within a minute.
