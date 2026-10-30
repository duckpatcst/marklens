/* MarkLens API client: the ONLY place the front end talks to the back end.
   ---------------------------------------------------------------------------------------------------------
   Front end and back end meet here and nowhere else. The contract (every request, response and error code)
   is written down in docs/API.md. If the back end changes a route or a field, this file and docs/API.md
   change with it, and no other front-end file needs to.

   Where the back end lives: same site by default (Cloudflare Pages Functions in functions/). To point the
   page at a back end somewhere else, set <meta name="marklens-api" content="https://api.example.com"> in the
   page's <head>; that server then has to allow this site in CORS, and _headers' connect-src must list it.

   MarkLensAPI.config()            GET  /api/ai   is the AI switched on, which company, what it can do
   MarkLensAPI.call(body, onWait)  POST /api/ai   one job (task: paper | sheet | answers | grade | tidy | topics | solve)
       Waits and retries when the back end says "busy" (up to 4 times, as long as it asks, max 60 s each)
       and when a phone briefly loses its connection. onWait(secondsLeft) is called once a second while
       waiting, so the page can show a countdown. Throws { code } with the back end's error code, or
       'offline' / 'upstream'.
   Runs in the browser (window.MarkLensAPI) and in Node for the tests (module.exports). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MarkLensAPI = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const PATH = '/api/ai';
  const meta = root.document && root.document.querySelector('meta[name="marklens-api"]');
  let base = String((meta && meta.content) || '').replace(/\/+$/, '');
  const url = () => base + PATH;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const online = () => !root.navigator || root.navigator.onLine !== false;

  async function config(){
    try {
      const r = await fetch(url(), { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.enabled ? j : null;
    } catch { return null; }
  }

  async function call(body, onWait, opts = {}){
    const tries = opts.tries ?? 4, wait = opts.sleep || sleep;
    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await fetch(url(), { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }); }
      catch {
        // a dropped connection on mobile data is usually brief: wait a little and send the same job again
        if (!online() || attempt >= tries) throw { code: 'offline' };
        for (let s = 8; s > 0; s--) { if (onWait) onWait(s); await wait(1000); }
        continue;
      }
      let j = null; try { j = await r.json(); } catch {}
      if (r.ok) return j || {};
      const code = (j && j.error) || 'upstream';
      if (code === 'busy' && attempt < tries) {
        const secs = Math.min(60, Number(j && j.retry_after) || 20);
        for (let s = secs; s > 0; s--) { if (onWait) onWait(s); await wait(1000); }
        continue;
      }
      throw { code };
    }
  }

  return { config, call, url, setBase: b => { base = String(b || '').replace(/\/+$/, ''); } };
});
