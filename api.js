/* ==============================================================
   PINKEYS — api.js
   Small client for the Python identification API (pinkeys_api/).
   Only the Identity page loads this. Settings are remembered in
   the browser: on/off + URL in localStorage, the API key in
   sessionStorage (forgotten when the tab closes).
   ============================================================== */
const PinkeysApi = (() => {
  const DEFAULT_URL = "http://localhost:8000";
  // Merely touching localStorage can throw (blocked storage, some file:// setups), so every access is guarded.
  const store = (name) => { try { return window[name]; } catch { return null; } };
  const get = (name, key, fallback) => { try { const v = store(name).getItem(key); return v == null ? fallback : v; } catch { return fallback; } };
  const put = (name, key, value) => { try { store(name).setItem(key, value); } catch { /* storage blocked: settings just won't persist */ } };

  // The live settings are held in memory; storage is only used to remember them between visits,
  // so everything still works when the browser blocks storage.
  let current = null;
  function settings() {
    if (!current) {
      current = {
        enabled: get("localStorage", "pinkeys.api.enabled", "0") === "1",
        url: get("localStorage", "pinkeys.api.url", DEFAULT_URL),
        key: get("sessionStorage", "pinkeys.api.key", ""),
      };
    }
    return { ...current };
  }
  function save(s) {
    current = { enabled: !!s.enabled, url: s.url || DEFAULT_URL, key: s.key || "" };
    put("localStorage", "pinkeys.api.enabled", current.enabled ? "1" : "0");
    put("localStorage", "pinkeys.api.url", current.url);
    put("sessionStorage", "pinkeys.api.key", current.key);
  }

  // one place for every request: base URL, key header, timeout, readable errors
  async function call(path, options = {}, timeoutMs = 15000) {
    const s = settings();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const headers = { ...(options.headers || {}) };
    if (s.key) headers["X-API-Key"] = s.key;
    let res;
    try {
      res = await fetch(s.url.replace(/\/+$/, "") + path, { ...options, headers, signal: ctl.signal });
    } catch (e) {
      throw new Error(e && e.name === "AbortError" ? "The API took too long to answer." : `Can't reach the API at ${s.url}. Is it running?`);
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const d = body && body.detail;
      const err = new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : `API error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    if (body === null) {   // 200 OK but not JSON: e.g. a sleeping host's loading page
      throw new Error("The server answered, but not with API data. If it is a free Render server it may still be waking up: press Wake up API.");
    }
    return body;
  }

  // the logger records a few extra fields; the API only needs these three
  const clean = (events) => events.map(({ key, type, t }) => ({ key, type, t }));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wake a sleeping host (Render's free tier stops a service after ~15 idle minutes; the next request starts it,
  // which takes up to about a minute). Two steps:
  //  1. one plain GET, sent "no-cors": a sleeping host answers with its own loading page, which has no CORS
  //     headers and would otherwise make the browser refuse the request. The request still reaches the host.
  //     (A GET on purpose: sleeping Render services are reported to wake on GET but not always on POST.)
  //  2. poll /health until the real API answers.
  async function wake({ onTick = () => {}, timeoutMs = 150000, intervalMs = 4000 } = {}) {
    const base = settings().url.replace(/\/+$/, "");
    const started = Date.now();
    try { fetch(base + "/health", { mode: "no-cors", cache: "no-store" }).catch(() => {}); } catch { /* ignore */ }
    for (;;) {
      onTick(Math.round((Date.now() - started) / 1000));
      try {
        const h = await call("/health", { cache: "no-store" }, 8000);
        if (h && h.status === "ok") return h;                 // the loading page is HTML, so h is null until the API is up
      } catch (err) {
        if (err.status === 404) throw new Error("That address answered, but it isn't the Pinkeys API. Check the URL.");
        /* anything else: still waking up, keep trying */
      }
      if (Date.now() - started + intervalMs > timeoutMs) {
        throw new Error("The API did not wake up in time. Press Wake up API to try again, and check the URL and that the service is deployed.");
      }
      await sleep(intervalMs);
    }
  }

  return {
    settings, save, wake,
    health: () => call("/health", {}, 4000),
    reload: () => call("/reload", { method: "POST" }, 60000),   // ask the server to fetch the newest model from Supabase
    enroll(files) {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      return call("/enroll", { method: "POST", body: fd }, 120000);   // training can take a while
    },
    // segments = one array of logger events per typed passage
    identify(segments, topK = 5) {
      return call("/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segments.map(clean), top_k: topK }),
      });
    },
  };
})();

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
