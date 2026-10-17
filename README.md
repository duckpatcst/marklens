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

## Step 4 (recommended): Daily limit per visitor

Without this, one person could use up your free Groq allowance for everyone.

1. In Cloudflare: **Storage & Databases** → **KV** (or **Workers & Pages → KV**) → **Create namespace**. Name it `marklens-limits`.
2. Open your Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - Variable name: `RATE_LIMIT`
   - Namespace: `marklens-limits`
3. Optional: add a plain-text variable `DAILY_LIMIT` with a number, such as `30`. The default is 40 AI requests per visitor per day.
4. Retry the deployment as in step 3.

A short per-minute limit (6 requests a minute) is always on, even without KV.

---

## Optional settings

| Variable | Type | What it does |
|---|---|---|
| `AI_PROVIDER` | Text | `groq` (default) or `gemini` |
| `GEMINI_API_KEY` | Secret | Key from aistudio.google.com. Only used when `AI_PROVIDER` is `gemini` |
| `AI_MODEL` | Text | Use a different model, for example if the provider retires the default |
| `DAILY_LIMIT` | Text | AI requests per visitor per day (needs `RATE_LIMIT`) |
| `AI` | Workers AI binding | Free backup: when Groq is busy, the same Qwen model runs on Cloudflare (Settings → Bindings → Add → Workers AI, name `AI`) |

### About Google Gemini

**Use Gemini only if every user is an adult.** Google's Gemini API terms say the API must not be used in apps "directed towards or likely to be accessed by individuals under the age of 18". On the free tier, Google uses what you send to improve its products, and human reviewers may read it. When Gemini is on, MarkLens asks every user to confirm they are 18 or older before anything is sent.

### If the AI reader stops working

- **"busy" messages.** The free Groq allowance is used up for now. It resets on its own. Check your limits in the Groq console.
- **Everything fails after months of working.** The model may have been renamed or retired. Find a current image-reading model in Groq's docs (console.groq.com/docs/vision) and set it as `AI_MODEL`. The default is `qwen/qwen3.8-27b`.
- **AI options don't appear.** The key is missing, or the deployment wasn't retried after adding it.

---

## Privacy: your responsibilities as the site owner

- Whenever the AI reader is available, MarkLens shows an **own-risk notice** on the page: photos go to an outside AI company, may be saved and used to improve its output, and should have names and roll numbers cropped out. There is no tick-box. The full notice is on `privacy.html`.
- The on-phone reader never sends photos anywhere. Point cautious users to it.
- In India, the **Digital Personal Data Protection Act, 2023** has rules for processing personal data, with stricter consent rules for children under 18. If schools or many students will use your site, check what applies to you. This guide isn't legal advice.
- MarkLens keeps students' results only in their own browser. The only thing your site stores is a daily request count per internet address, which is deleted after two days.

## Updating the site later

Upload changed files to the same GitHub repository, using **Add file → Upload files**. Cloudflare publishes the new version automatically within a minute.
