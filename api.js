/* ==============================================================
   PINKEYS — api.js
   Client for the Python API and for Supabase Auth. There is no secret in the website.
   LOGIN does not use the Python API: register / login / nickname talk to Supabase Auth directly, so they
   work while the Render API sleeps. People log in with first name + last name + password; behind the scenes
   the pair becomes a made-up email (see emailFor). Supabase hands back an access token (about 1 hour) and a
   refresh token; this file renews it quietly, and sends it to the API as "Authorization: Bearer <token>".
   Needs in config.js: SUPABASE_URL, SUPABASE_ANON_KEY (the public one), LOGIN_EMAIL_DOMAIN (optional).
     GET  /health         is it awake, is a model loaded, how many people   (public)
     GET  /me                                                               (accounts)
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

  // ---- the login session (Supabase tokens; no password is ever stored in the browser) ----
  const TOKEN_KEY = "pinkeys.token", USER_KEY = "pinkeys.user", REFRESH_KEY = "pinkeys.refresh", EXP_KEY = "pinkeys.exp";
  const getStore = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const setStore = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked: you stay logged in until the page closes */ } };
  let mem = { token: getStore(TOKEN_KEY), user: null, refresh: getStore(REFRESH_KEY), exp: Number(getStore(EXP_KEY)) || 0 };
  try { mem.user = JSON.parse(getStore(USER_KEY) || "null"); } catch { mem.user = null; }
  const changed = () => window.dispatchEvent(new CustomEvent("pinkeys-auth"));
  function setSession(token, user, refresh = mem.refresh, exp = mem.exp) {
    mem = { token, user, refresh, exp };
    setStore(TOKEN_KEY, token); setStore(USER_KEY, JSON.stringify(user)); setStore(REFRESH_KEY, refresh); setStore(EXP_KEY, String(exp || ""));
    changed();
  }
  function setUser(user) { mem.user = user; setStore(USER_KEY, JSON.stringify(user)); changed(); }
  function clearSession() { mem = { token: "", user: null, refresh: "", exp: 0 }; [TOKEN_KEY, USER_KEY, REFRESH_KEY, EXP_KEY].forEach((k) => setStore(k, "")); changed(); }
  const loggedIn = () => !!(mem.token && mem.user);

  // ---- Supabase Auth (talks to Supabase directly; the Python API is not involved) ----
  const cfg = () => window.PINKEYS_CONFIG || {};
  const sbUrl = () => String(cfg().SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const sbKey = () => String(cfg().SUPABASE_ANON_KEY || "").trim();
  const emailDomain = () => String(cfg().LOGIN_EMAIL_DOMAIN || "pinkeys-login.com").trim();
  const loginConfigured = () => !!(sbUrl() && sbKey() && !PLACEHOLDER.test(sbUrl()));

  // Same rules as accounts.py (name_key). Two names that differ only in capitals, spaces, hyphens or accents are one account.
  function keyPart(text) {
    const out = [];
    for (const ch of String(text || "").toLowerCase().replace(/ß/g, "ss").normalize("NFKD")) {
      if (/\p{M}/u.test(ch)) continue;                                  // é -> e
      if (/^[a-z0-9]$/.test(ch)) out.push(ch);
      else if (/^[\p{L}\p{N}]$/u.test(ch)) out.push("u" + ch.codePointAt(0).toString(16));
      else out.push("-");                                               // space, hyphen, apostrophe ...
    }
    return out.join("").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  }
  function nameKey(first, last) {
    const f = keyPart(first), l = keyPart(last);
    if (!f || !l) throw new Error("Please enter both a first and a last name.");
    return f + "__" + l;
  }
  async function emailFor(first, last) {
    const bytes = new TextEncoder().encode(nameKey(first, last));
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 40) + "@" + emailDomain();
  }
  const tidy = (v) => String(v || "").normalize("NFC").replace(/[^\P{C}]/gu, "").split(/\s+/).filter(Boolean).join(" ");
  function cleanName(v, what) {
    const s = tidy(v);
    if (!s) throw new Error(`Please enter your ${what}.`);
    if (s.length > 60) throw new Error(`Your ${what} is too long (the limit is 60 characters).`);
    if (!/\p{L}/u.test(s)) throw new Error(`Your ${what} must contain letters.`);
    return s;
  }
  function cleanNick(v) {
    const s = tidy(v);
    if (s.length > 30) throw new Error("A nickname can be at most 30 characters.");
    return s;
  }
  function displayName(first, nick) {
    if (nick && nick.trim()) return nick.trim();
    const w = String(first || "").trim().split(/[\s-]+/)[0] || "";
    return w && (w === w.toLowerCase() || w === w.toUpperCase()) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
  }
  function userFromSb(u) {
    const m = (u && u.user_metadata) || {};
    return { first_name: m.first_name || "", last_name: m.last_name || "", nickname: m.nickname || "", display_name: displayName(m.first_name, m.nickname) };
  }
  function sessionFromAuth(r) {
    const exp = r.expires_at ? r.expires_at * 1000 : Date.now() + (r.expires_in || 3600) * 1000;
    setSession(r.access_token, userFromSb(r.user), r.refresh_token || mem.refresh, exp);
  }
  function sbError(status, data) {
    const code = (data && (data.error_code || data.code)) || "", text = String((data && (data.msg || data.message || data.error_description)) || "");
    let msg = text || `Login service error ${status}`;
    if (code === "invalid_credentials" || /invalid login/i.test(text)) msg = "Wrong name or password.";
    else if (code === "user_already_exists" || /already registered/i.test(text)) msg = "An account with this first and last name already exists. Please log in instead.";
    else if (code === "weak_password") msg = "That password is too weak. Please use at least 8 characters.";
    else if (status === 429 || /rate limit/i.test(code + text)) msg = "Too many tries. Please wait a few minutes and try again.";
    const err = new Error(msg);
    err.status = status;
    return err;
  }
  async function sbCall(path, { method = "POST", body, token } = {}) {
    if (!loginConfigured()) throw new Error("Login isn't set up yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to config.js.");
    const headers = { apikey: sbKey(), "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let res;
    try {
      res = await fetch(sbUrl() + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    } catch {
      throw new Error("Can't reach the login service. Check your internet connection.");
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw sbError(res.status, data);
    return data || {};
  }

  // renew the access token (they last about an hour). Only a refusal from Supabase logs you out, never a network hiccup.
  let refreshing = null;
  function refresh() {
    if (!mem.refresh) return Promise.resolve(false);
    if (!refreshing) {
      refreshing = (async () => {
        try {
          sessionFromAuth(await sbCall("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: mem.refresh } }));
          return true;
        } catch (e) {
          if ([400, 401, 403, 422].includes(e.status)) clearSession();
          return false;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }
  async function freshToken() {
    if (mem.token && mem.exp && Date.now() > mem.exp - 60000) await refresh();
    return mem.token;
  }

  // one place for every request: base URL, timeout, readable errors
  async function call(path, options = {}, timeoutMs = 15000) {
    const base = baseUrl();
    if (!base) throw new Error("The API address isn't set. Put your Render address in config.js.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const { skipAuth, _retried, ...fetchOptions } = options;
    const headers = { ...(fetchOptions.headers || {}) };
    if (!skipAuth) await freshToken();
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
      if (res.status === 401 && hadToken && !_retried && (await refresh())) return call(path, { ...options, _retried: true }, timeoutMs);
      if (res.status === 401 && hadToken) clearSession();      // the login really expired: show the logged-out state
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
    loginConfigured,
    session: () => ({ token: mem.token, user: mem.user }), loggedIn, setSession, setUser, clearSession,
    // create an account (straight at Supabase, no waiting for the API). Logs the person in.
    async register(b) {
      const first = cleanName(b.first_name, "first name"), last = cleanName(b.last_name, "last name"), nick = cleanNick(b.nickname);
      const pw = String(b.password || "");
      if (pw.length < 8) throw new Error("Your password must be at least 8 characters.");
      if (pw !== b.password_confirm) throw new Error("The two passwords don't match.");
      const r = await sbCall("/auth/v1/signup", { body: { email: await emailFor(first, last), password: pw, data: { first_name: first, last_name: last, nickname: nick } } });
      if (!r.access_token) throw new Error("The account was made, but the project still wants email confirmation. In Supabase: Authentication > Providers > Email > turn off 'Confirm email'.");
      sessionFromAuth(r);
      return { user: mem.user };
    },
    async login(b) {
      const r = await sbCall("/auth/v1/token?grant_type=password", { body: { email: await emailFor(b.first_name, b.last_name), password: String(b.password || "") } });
      sessionFromAuth(r);
      return { user: mem.user };
    },
    // set or clear the nickname; returns { user } like before
    async setNickname(nickname) {
      const token = await freshToken();
      const u = await sbCall("/auth/v1/user", { method: "PUT", token, body: { data: { nickname: cleanNick(nickname) } } });
      return { user: userFromSb(u) };
    },
    // change my password (needs the new one typed twice by the caller). Not wired to a button yet.
    async changePassword(newPassword) {
      if (String(newPassword || "").length < 8) throw new Error("Your password must be at least 8 characters.");
      const token = await freshToken();
      await sbCall("/auth/v1/user", { method: "PUT", token, body: { password: newPassword } });
      return { ok: true };
    },
    me: () => call("/me", {}, 10000),
    status: () => call("/me/status", { cache: "no-store" }, 20000),
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
