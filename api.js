/* ==============================================================
   PINKEYS — api.js
   Client for the Python API. There is no API key in the website. People log
   in with their name + password and the server hands back a signed token,
   which is sent as "Authorization: Bearer <token>".
     GET  /health         is it awake, is a model loaded, how many people   (public)
     POST /register /login, GET /me, POST /me/nickname                      (accounts)
     GET  /me/status      do I have data, am I in the model                  (logged in)
     POST /collect        save my finished test (replaces my old data)       (logged in)
     POST /model/update   retrain so the model includes my data              (logged in)
     POST /identify       who does this typing look like                     (logged in)
   Admin actions need a key that lives only on the server, never here.
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

  // ---- the login session (a signed token from the server; no password is ever stored in the browser) ----
  const TOKEN_KEY = "pinkeys.token", USER_KEY = "pinkeys.user";
  const getStore = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const setStore = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: you stay logged in until the page closes */ } };
  let mem = { token: getStore(TOKEN_KEY), user: null };
  try { mem.user = JSON.parse(getStore(USER_KEY) || "null"); } catch { mem.user = null; }
  const changed = () => window.dispatchEvent(new CustomEvent("pinkeys-auth"));
  function setSession(token, user) { mem = { token, user }; setStore(TOKEN_KEY, token); setStore(USER_KEY, JSON.stringify(user)); changed(); }
  function setUser(user) { mem.user = user; setStore(USER_KEY, JSON.stringify(user)); changed(); }
  function clearSession() { mem = { token: "", user: null }; setStore(TOKEN_KEY, ""); setStore(USER_KEY, ""); changed(); }
  const loggedIn = () => !!(mem.token && mem.user);

  // one place for every request: base URL, timeout, readable errors
  async function call(path, options = {}, timeoutMs = 15000) {
    const base = baseUrl();
    if (!base) throw new Error("The API address isn't set. Put your Render address in config.js.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const { skipAuth, ...fetchOptions } = options;
    const headers = { ...(fetchOptions.headers || {}) };
    const hadToken = !skipAuth && !!mem.token;
    if (hadToken) headers.Authorization = "Bearer " + mem.token;
    let res;
    try {
      res = await fetch(base + path, { ...fetchOptions, headers, signal: ctl.signal });
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
      if (res.status === 401 && hadToken) clearSession();      // the login expired or was reset: show the logged-out state
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

  const json = (method, body, extra = {}) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...extra });

  return {
    configured, ping, wake,
    session: () => ({ ...mem }), loggedIn, setSession, setUser, clearSession,
    register: (b) => call("/register", json("POST", b, { skipAuth: true }), 30000),
    login: (b) => call("/login", json("POST", b, { skipAuth: true }), 30000),
    me: () => call("/me", {}, 10000),
    status: () => call("/me/status", { cache: "no-store" }, 20000),
    setNickname: (nickname) => call("/me/nickname", json("POST", { nickname }), 15000),
    updateModel: () => call("/model/update", { method: "POST" }, 20000),
    health: () => call("/health", { cache: "no-store" }, 8000),
    // segments = one array of logger events per typed passage
    identify(segments, topK = 5) {
      return call("/identify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: segments.map(clean), top_k: topK }),
      });
    },
    // save one finished test (the same CSV text the Download button produces). replace=true is needed
    // when the person already has saved data: the old data then becomes a hidden backup.
    collect: (csvText, replace = false) => call("/collect", json("POST", { csv: csvText, replace: !!replace }), 90000),
  };
})();

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
