/* ==============================================================
   PINKEYS — api.js
   Key-free client for the Python identification API.
   The website only ever calls three PUBLIC endpoints:
     GET  /health    is it awake, is a model loaded, how many people
     POST /identify  who does this typing look like
     POST /collect   save one finished test (CSV text) for enrollment
   Retraining, reloading, profiles and reset are admin-only and need
   a key that lives on Render — never in this website.
   The address comes from config.js. If it is still the placeholder,
   a page opened from localhost / a file falls back to localhost:8000.
   ============================================================== */
const PinkeysApi = (() => {
  const PLACEHOLDER = /YOUR-SERVICE-NAME|REPLACE/i;

  function baseUrl() {
    const cfg = String((window.PINKEYS_CONFIG && window.PINKEYS_CONFIG.API_URL) || "").trim().replace(/\/+$/, "");
    if (cfg && !PLACEHOLDER.test(cfg)) return cfg;
    const h = location.hostname;
    if (location.protocol === "file:" || h === "localhost" || h === "127.0.0.1") return "http://localhost:8000";
    return "";
  }
  const configured = () => !!baseUrl();

  // one place for every request: base URL, timeout, readable errors
  async function call(path, options = {}, timeoutMs = 15000) {
    const base = baseUrl();
    if (!base) throw new Error("The API address isn't set. Put your Render address in config.js.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(base + path, { ...options, signal: ctl.signal });
    } catch (e) {
      throw new Error(e && e.name === "AbortError" ? "The API took too long to answer." : "Can't reach the API. It may be asleep or offline.");
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
      throw new Error("The server answered, but not with API data. It may still be waking up.");
    }
    return body;
  }

  // the logger records a few extra fields; the API only needs these three
  const clean = (events) => events.map(({ key, type, t }) => ({ key, type, t }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fire-and-forget nudge for a sleeping host (Render's free tier stops after ~15 idle minutes).
  // "no-cors" because a sleeping host answers with its own loading page, which has no CORS headers;
  // the request still reaches the host and starts it.
  function ping() {
    const base = baseUrl();
    if (!base) return;
    try { fetch(base + "/health", { mode: "no-cors", cache: "no-store" }).catch(() => {}); } catch { /* ignore */ }
  }

  // Wake the host and wait until the real API answers /health (up to ~2.5 minutes).
  async function wake({ onTick = () => {}, timeoutMs = 150000, intervalMs = 4000 } = {}) {
    if (!configured()) throw new Error("The API address isn't set. Put your Render address in config.js.");
    const started = Date.now();
    ping();
    for (;;) {
      onTick(Math.round((Date.now() - started) / 1000));
      try {
        const h = await call("/health", { cache: "no-store" }, 8000);
        if (h && h.status === "ok") return h;
      } catch (err) {
        if (err.status === 404) throw new Error("That address answered, but it isn't the Pinkeys API. Check config.js.");
        /* anything else: still waking up, keep trying */
      }
      if (Date.now() - started + intervalMs > timeoutMs) {
        throw new Error("The API did not wake up in time. Check that the Render service is deployed and the address in config.js is right.");
      }
      await sleep(intervalMs);
    }
  }

  return {
    configured, ping, wake,
    health: () => call("/health", { cache: "no-store" }, 8000),
    // segments = one array of logger events per typed passage
    identify(segments, topK = 5) {
      return call("/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segments.map(clean), top_k: topK }),
      });
    },
    // save one finished test: the same CSV text the Download button produces
    collect(csvText) {
      return call("/collect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      }, 90000);
    },
  };
})();

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
