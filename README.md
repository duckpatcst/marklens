# MarkLens: put it online for free

MarkLens is a website. Students photograph a question paper and their marked exam sheet, and the dashboard shows where marks were lost.

Students add every page at once: **Scan pages** opens the camera inside MarkLens so they can photograph page after page, or they pick photos or a PDF from the phone. Each page is read automatically as soon as it is added; nobody copies or pastes text. MarkLens finds the teacher's **red-pen marks**, matches them to the questions, shows a cut-out of each mark next to it so students can check it, and compares the marks with the teacher's total.

It reads pages in three ways:

- **On this phone · free.** Nothing is sent anywhere and it needs no account or key. Printed text is read by Tesseract. The teacher's marks are read by MarkLens's own red-pen reader: it finds the red ink in the photo and reads the digits with a small model trained for this (99.3% on the standard handwritten-digit test). Best for printed papers and clear marks.
- **Google reader** (recommended). Every page goes to Google Cloud Vision, Google's text reader for apps, which reads handwriting very well. MarkLens then looks at the photo itself to tell the teacher's red writing from the student's. Google Lens itself can't be connected to a website; Cloud Vision is the official way. It appears once you add a Google key (step 3).
- **AI reader** and **AI grading.** These use a free AI service, Groq by default. The AI gets each sheet as a grey page with the teacher's red ink kept bright red, so it knows which writing is the teacher's. It can also grade unmarked answers. They appear once you add an AI key (step 4).

With both keys, the Google reader reads the pages and the AI matches each red mark to its question. That is the most accurate setup.

You need a computer for setup. It takes about 30 minutes.

---

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The MarkLens website |
| `privacy.html` | The privacy notice that students see |
| `js/redpen.js`, `js/redpen-worker.js` | The red-pen reader: finds the teacher's red ink and reads the marks, on the phone |
| `models/digits-v1.json` | The small digit model the red-pen reader uses (77 KB) |
| `js/google.js` | Turns the Google reader's words into lines and tags the teacher's red writing |
| `js/scanner.js` | The camera inside MarkLens, for scanning page after page |
| `js/pdf-pages.js`, `vendor/pdfjs/` | Opens PDFs (pdf.js 6.4, Apache 2.0), only when someone adds one |
| (online) | Tesseract 5.1.1 (Apache 2.0), for printed text on the phone, loads from jsDelivr the first time |
| `functions/api/ai.js` | The hidden helper that talks to Google and the AI company. Your keys live here, never in the page |
| `functions/_middleware.js` | The access-code gate |
| `_headers` | Security settings for the website |
| `tests/`, `tools/` | Checks for developers, and the code that trained the digit model. The website doesn't need them |

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

Check: the repository's main page should list `index.html`, `privacy.html`, `_headers`, `functions`, `js`, `models` and `vendor`.

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

## Step 3 (recommended): Switch on the Google reader

The Google reader uses Google Cloud Vision. The first 1,000 pages each month are free; after that Google charges about $1.50 per 1,000 pages. Google asks for a payment card to switch it on, even for the free pages.

1. Go to **console.cloud.google.com** and sign in. Create a project (top bar → project picker → **New project**), for example `marklens`.
2. Open **Billing** and link a billing account to the project.
3. Open **APIs & Services** → **Library**, search for **Cloud Vision API** and click **Enable**.
4. Open **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Copy the key.
5. Click the new key → **API restrictions** → **Restrict key** → tick only **Cloud Vision API** → **Save**. Then the key can't be used for anything else.
6. Protect yourself from a surprise bill:
   - **Billing** → **Budgets & alerts** → create a budget of, say, $2 with email alerts.
   - **APIs & Services** → **Cloud Vision API** → **Quotas** → lower the requests per day (for example 1,000).
7. In Cloudflare, open your Pages project → **Settings** → **Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Name: `GOOGLE_VISION_API_KEY`
   - Value: paste your key
   - Add it for **Production**
8. Go to **Deployments**, open the latest one, and click **Retry deployment**.

Open your site again. **Google reader · Recommended** should now appear, and MarkLens picks it by default.

If Google ever refuses the key (billing off, API disabled), MarkLens switches to the next reader by itself and tells the student.

## Step 4: Switch on the AI reader with a free Groq key

1. Go to **console.groq.com** and sign up. You must be 18 or older.
2. Open **API Keys** → **Create API Key**. Copy the key; it starts with `gsk_`.
3. In Cloudflare, open your Pages project → **Settings** → **Variables and Secrets** → **Add**:
   - Type: **Secret**
   - Name: `GROQ_API_KEY`
   - Value: paste your key
   - Add it for **Production**
4. Go to **Deployments**, open the latest one, and click **Retry deployment**. Secrets only apply to new deployments.

Open your site again. **AI reader** and **Unmarked · AI grades** should now appear. If the Google reader is on too, the AI also matches the Google reader's red marks to the questions.

**Keep the key secret.** Don't put it in any file, in GitHub, or in a chat message. If it leaks, delete it in the Groq console and make a new one.

## Step 5 (recommended): Daily limit per visitor

Without this, one person could use up your free Groq allowance, or your free Google pages, for everyone.

1. In Cloudflare: **Storage & Databases** → **KV** (or **Workers & Pages → KV**) → **Create namespace**. Name it `marklens-limits`.
2. Open your Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - Variable name: `RATE_LIMIT`
   - Namespace: `marklens-limits`
3. Optional: add a plain-text variable `DAILY_LIMIT` with a number, such as `60`. The default is 80 requests per visitor per day. Reading a page takes one request (two with the AI on), so 80 is about three full exams.
4. Retry the deployment as in step 3.

A short per-minute limit (30 requests a minute) is always on, even without KV.

---

## Optional settings

| Variable | Type | What it does |
|---|---|---|
| `GOOGLE_VISION_API_KEY` | Secret | Turns on the Google reader (step 3) |
| `AI_PROVIDER` | Text | `groq` (default) or `gemini` |
| `GEMINI_API_KEY` | Secret | Key from aistudio.google.com. Only used when `AI_PROVIDER` is `gemini` |
| `AI_MODEL` | Text | Use a different model, for example if the provider retires the default |
| `DAILY_LIMIT` | Text | AI requests per visitor per day (needs `RATE_LIMIT`) |
| `AI` | Workers AI binding | Free backup: when Groq is busy, the same Qwen model runs on Cloudflare (Settings → Bindings → Add → Workers AI, name `AI`) |

### About Google Gemini

**Use Gemini only if every user is an adult.** Google's Gemini API terms say the API must not be used in apps "directed towards or likely to be accessed by individuals under the age of 18". On the free tier, Google uses what you send to improve its products, and human reviewers may read it. When Gemini is on, MarkLens asks every user to confirm they are 18 or older before anything is sent.

### About Google Cloud Vision

Cloud Vision comes under Google Cloud's terms, not the Gemini API terms above, and I found no rule against apps used by under-18s like Gemini's. Google says photos sent for reading are handled in memory, not written to disk, and not used to train its models ([Cloud Vision data usage](https://cloud.google.com/vision/docs/data-usage)). Check the terms yourself before you rely on this; this guide isn't legal advice.

### If the Google reader stops working

- **Every page says "The Google reader is not set up correctly".** The key is wrong, the Cloud Vision API is not enabled, or billing is off. MarkLens switches to the next reader meanwhile.
- **"busy" messages.** Your daily quota in Google Cloud is used up. It resets the next day.

### If the AI reader stops working

- **"busy" messages.** The free Groq allowance is used up for now. It resets on its own. Check your limits in the Groq console.
- **Everything fails after months of working.** The model may have been renamed or retired. Find a current image-reading model in Groq's docs (console.groq.com/docs/vision) and set it as `AI_MODEL`. The default is `qwen/qwen3.8-27b`.
- **AI options don't appear.** The key is missing, or the deployment wasn't retried after adding it.

---

## Privacy: your responsibilities as the site owner

- Whenever the Google reader or the AI reader is chosen, MarkLens shows a notice on the page saying where photos go and that names and roll numbers should be cropped out. There is no tick-box. The full notice is on `privacy.html`.
- The on-phone reader never sends photos anywhere. Point cautious users to it.
- In India, the **Digital Personal Data Protection Act, 2023** has rules for processing personal data, with stricter consent rules for children under 18. If schools or many students will use your site, check what applies to you. This guide isn't legal advice.
- MarkLens keeps students' results only in their own browser. The only thing your site stores is a daily request count per internet address, which is deleted after two days.

## Updating the site later

Upload changed files to the same GitHub repository, using **Add file → Upload files**, or merge a pull request on GitHub. Cloudflare publishes the new version automatically within a minute.

A pull request also gets its own preview address from Cloudflare (**Deployments** → the branch). The access-code gate keeps previews locked unless `ACCESS_CODE` is also set for the **Preview** environment, so add it there (and the keys) if you want to try a preview first.

## For developers

- `node --test tests/*.test.mjs` runs the checks: the red-pen reader, the digit model against the training code, the Google reader's text handling and the `/api/ai` function with the AI companies replaced by stubs.
- `tools/digits/train.py` trains the digit model from MNIST (see the top of the file). `tools/redpen-bench/make_sheets.py` makes synthetic marked answer sheets to measure the red-pen reader. On 24 such pages it finds 97% of marks and reads 91% exactly, finds every teacher's total, and reports no false marks. Real photos vary more, so the table always shows the cut-out mark for checking.
