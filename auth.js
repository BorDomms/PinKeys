/* ==============================================================
   PINKEYS — auth.js
   The top-right controls on every page, right to left:  User · How-to (?) · Mode.
   (Mode is the Practice / Test / Identity selector already in each page's HTML.)
     • User button: "Log in" when logged out; the nickname (or first name) when logged in.
       Clicking it opens a small dropdown: change/add nickname, Log out.
       ▸ Future account options go in the spot marked "FUTURE" below.
     • "?" button: hover to peek, move away to close, click to keep it open until you click elsewhere.
       Its text comes from content.js.
     • Log-in / Create-account window.
   Needs api.js (and optionally content.js) loaded first. Pages react to log-ins with:
       window.addEventListener("pinkeys-auth", ...)      and   PinkeysAuth.open("login" | "register")
   ============================================================== */
const PinkeysAuth = (() => {
  const page = document.body.dataset.page || "practice";
  const content = (window.PINKEYS_CONTENT && window.PINKEYS_CONTENT.howTo && window.PINKEYS_CONTENT.howTo[page]) || null;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const INPUT = "w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[var(--ink)]";
  const BTN_PRIMARY = "bg-[var(--ink)] text-white rounded-full px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity";
  const USER_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg>`;

  /* ------------------------------------------------------------ user button + dropdown */
  const userMount = $("userMount");
  let menuOpen = false;

  function renderUser() {
    if (!userMount) return;
    const s = PinkeysApi.session();
    if (!PinkeysApi.loggedIn()) {
      menuOpen = false;
      userMount.innerHTML = `<button type="button" id="pkUserBtn" class="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm text-[var(--text)] hover:border-[var(--ink)] transition-colors">${USER_ICON}<span>Log in</span></button>`;
      $("pkUserBtn").addEventListener("click", () => open("login"));
      return;
    }
    const u = s.user;
    userMount.innerHTML = `
      <div class="relative">
        <button type="button" id="pkUserBtn" aria-haspopup="true" aria-expanded="${menuOpen}" title="${esc(u.first_name + " " + u.last_name)}"
          class="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-2 pr-3.5 py-1.5 text-sm text-[var(--text)] hover:border-[var(--ink)] transition-colors">
          <span class="w-7 h-7 rounded-full bg-[var(--ink)] text-white flex items-center justify-center">${USER_ICON}</span>
          <span class="max-w-[9rem] truncate">${esc(u.display_name)}</span>
        </button>
        <div id="pkMenu" class="${menuOpen ? "" : "hidden"} absolute right-0 top-full mt-2 w-72 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg p-4">
          <div class="text-sm font-medium truncate">${esc(u.display_name)}</div>
          <div class="text-xs text-[var(--muted)] mb-4 truncate">${esc(u.first_name + " " + u.last_name)}</div>
          <label class="block text-xs text-[var(--muted)] mb-1.5" for="pkNick">Nickname</label>
          <div class="flex gap-2">
            <input id="pkNick" type="text" maxlength="30" autocomplete="off" value="${esc(u.nickname || "")}" placeholder="Add a nickname" class="${INPUT} min-w-0" />
            <button type="button" id="pkNickSave" class="shrink-0 border border-[var(--border)] rounded-lg px-3 text-sm hover:border-[var(--ink)] disabled:opacity-50 transition-colors">${u.nickname ? "Save" : "Add"}</button>
          </div>
          <p id="pkNickMsg" class="text-xs mt-1.5 min-h-[1rem]"></p>

          <!-- FUTURE: more account options (perks, settings…) go here, above the Log out button -->
          <div id="pkMenuExtras"></div>

          <div class="border-t border-[var(--border)] mt-3 pt-2">
            <button type="button" id="pkLogout" class="w-full text-left text-sm rounded-lg px-2 py-2 hover:bg-[var(--bg)] transition-colors">Log out</button>
          </div>
        </div>
      </div>`;
    $("pkUserBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
    $("pkMenu").addEventListener("click", (e) => e.stopPropagation());
    $("pkLogout").addEventListener("click", () => { PinkeysApi.clearSession(); });
    $("pkNickSave").addEventListener("click", saveNickname);
    $("pkNick").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveNickname(); } });
  }

  function toggleMenu(force) {
    menuOpen = force === undefined ? !menuOpen : force;
    const m = $("pkMenu"), b = $("pkUserBtn");
    if (m) m.classList.toggle("hidden", !menuOpen);
    if (b) b.setAttribute("aria-expanded", String(menuOpen));
  }

  async function saveNickname() {
    const msg = $("pkNickMsg"), btn = $("pkNickSave"), value = $("pkNick").value.trim();
    msg.style.color = "var(--muted)"; msg.textContent = "Saving…"; btn.disabled = true;
    try {
      const r = await PinkeysApi.setNickname(value);
      menuOpen = true;
      PinkeysApi.setUser(r.user);          // re-renders the button with the new name
      const m2 = $("pkNickMsg");
      if (m2) { m2.style.color = "var(--correct)"; m2.textContent = value ? "Nickname saved." : "Nickname removed. Your first name is shown instead."; }
    } catch (err) {
      msg.style.color = "var(--incorrect)"; msg.textContent = err.message; btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------ the "?" widget */
  const howMount = $("howtoMount");
  function renderHowTo() {
    if (!howMount) return;
    howMount.innerHTML = `
      <div class="relative" id="pkHow">
        <button type="button" id="pkHowBtn" aria-label="How to use this page" aria-expanded="false"
          class="w-9 h-9 rounded-full border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-sm font-semibold text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)] transition-colors">?</button>
        <div id="pkHowPanel" class="hidden absolute right-0 top-full pt-2 z-50">
          <div class="w-80 max-w-[85vw] max-h-[70vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg p-4 text-sm leading-relaxed">
            <div class="font-semibold mb-2">${esc(content ? content.title : "How to use this page")}</div>
            <div class="space-y-2">${content ? content.html : "<p>No instructions yet.</p>"}</div>
          </div>
        </div>
      </div>`;
    const wrap = $("pkHow"), btn = $("pkHowBtn"), panel = $("pkHowPanel");
    let pinned = false;
    const show = () => { panel.classList.remove("hidden"); btn.setAttribute("aria-expanded", "true"); };
    const hide = () => { panel.classList.add("hidden"); btn.setAttribute("aria-expanded", "false"); };
    wrap.addEventListener("mouseenter", show);                         // hover: peek
    wrap.addEventListener("mouseleave", () => { if (!pinned) hide(); }); // move away: collapse, unless clicked open
    btn.addEventListener("focus", show);
    btn.addEventListener("blur", () => { if (!pinned) setTimeout(() => { if (!wrap.contains(document.activeElement) && !pinned) hide(); }, 0); });
    btn.addEventListener("click", (e) => { e.stopPropagation(); pinned = !pinned; pinned ? show() : null; btn.classList.toggle("text-[var(--ink)]", pinned); btn.classList.toggle("border-[var(--ink)]", pinned); });
    document.addEventListener("click", (e) => {                         // click anywhere else: let go
      if (wrap.contains(e.target)) return;
      pinned = false; btn.classList.remove("text-[var(--ink)]", "border-[var(--ink)]"); hide();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { pinned = false; btn.classList.remove("text-[var(--ink)]", "border-[var(--ink)]"); hide(); } });
  }

  /* ------------------------------------------------------------ the log in / create account window */
  let mode = "login", modal = null, busy = false;

  function buildModal() {
    modal = document.createElement("div");
    modal.id = "pkModal";
    modal.className = "hidden fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40";
    modal.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="pkModalTitle" class="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-xl p-6 sm:p-7">
        <div class="flex items-start justify-between gap-4 mb-4">
          <h2 id="pkModalTitle" class="text-xl font-semibold">Log in</h2>
          <button type="button" id="pkClose" aria-label="Close" class="text-[var(--muted)] hover:text-[var(--text)] text-2xl leading-none">&times;</button>
        </div>
        <div class="flex bg-[var(--bg)] border border-[var(--border)] rounded-full p-[3px] mb-5">
          <button type="button" data-mode="login" class="flex-1 rounded-full py-2 text-sm transition-colors">Log in</button>
          <button type="button" data-mode="register" class="flex-1 rounded-full py-2 text-sm transition-colors">Create account</button>
        </div>
        <form id="pkForm" novalidate class="space-y-3">
          <label class="block"><span class="block text-xs text-[var(--muted)] mb-1">First name</span><input id="pkFirst" type="text" maxlength="60" autocomplete="given-name" class="${INPUT}" /></label>
          <label class="block"><span class="block text-xs text-[var(--muted)] mb-1">Last name</span><input id="pkLast" type="text" maxlength="60" autocomplete="family-name" class="${INPUT}" /></label>
          <label id="pkNickRow" class="block"><span class="block text-xs text-[var(--muted)] mb-1">Nickname (optional)</span><input id="pkNickReg" type="text" maxlength="30" autocomplete="nickname" class="${INPUT}" /></label>
          <label class="block"><span class="block text-xs text-[var(--muted)] mb-1">Password</span><input id="pkPass" type="password" maxlength="200" autocomplete="current-password" class="${INPUT}" /></label>
          <label id="pkConfirmRow" class="block"><span class="block text-xs text-[var(--muted)] mb-1">Confirm password</span><input id="pkConfirm" type="password" maxlength="200" autocomplete="new-password" class="${INPUT}" /></label>
          <p id="pkFormMsg" role="alert" class="text-sm min-h-[1.25rem]"></p>
          <button type="submit" id="pkSubmit" class="${BTN_PRIMARY} w-full">Log in</button>
        </form>
        <p id="pkHint" class="text-xs text-[var(--muted)] mt-4"></p>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    $("pkClose").addEventListener("click", close);
    modal.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("pkForm").addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) close(); });
  }

  function setMode(m) {
    mode = m;
    const reg = m === "register";
    $("pkModalTitle").textContent = reg ? "Create account" : "Log in";
    $("pkSubmit").textContent = reg ? "Create account" : "Log in";
    $("pkNickRow").classList.toggle("hidden", !reg);
    $("pkConfirmRow").classList.toggle("hidden", !reg);
    $("pkPass").setAttribute("autocomplete", reg ? "new-password" : "current-password");
    $("pkHint").textContent = reg
      ? "Two people can't use the same first and last name. A nickname is optional and can be changed later. There is no email, so keep your password safe: only the site owner can reset it."
      : "Use the first name, last name and password you registered with.";
    modal.querySelectorAll("[data-mode]").forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle("bg-[var(--ink)]", on); b.classList.toggle("text-white", on); b.classList.toggle("text-[var(--muted)]", !on);
    });
    $("pkFormMsg").textContent = "";
  }

  function open(m = "login") {
    if (!modal) buildModal();
    setMode(m);
    modal.classList.remove("hidden");
    setTimeout(() => $("pkFirst").focus(), 0);
  }
  function close() { if (modal && !busy) modal.classList.add("hidden"); }

  async function submit() {
    if (busy) return;
    const msg = $("pkFormMsg"), btn = $("pkSubmit"), reg = mode === "register";
    const body = { first_name: $("pkFirst").value.trim(), last_name: $("pkLast").value.trim(), password: $("pkPass").value };
    const fail = (t) => { msg.style.color = "var(--incorrect)"; msg.textContent = t; };
    if (!body.first_name || !body.last_name) return fail("Please enter your first and last name.");
    if (!body.password) return fail("Please enter your password.");
    if (reg) {
      if (body.password.length < 8) return fail("Your password must be at least 8 characters.");
      if (body.password !== $("pkConfirm").value) return fail("The two passwords don't match.");
      body.password_confirm = $("pkConfirm").value;
      body.nickname = $("pkNickReg").value.trim();
    }
    busy = true; btn.disabled = true; msg.style.color = "var(--muted)"; msg.textContent = "One moment…";
    try {
      // Login goes straight to Supabase (no waiting for the API). register/login also store the session.
      msg.textContent = reg ? "Creating your account…" : "Logging in…";
      if (reg) await PinkeysApi.register(body); else await PinkeysApi.login(body);
      busy = false;
      $("pkPass").value = ""; $("pkConfirm").value = "";
      modal.classList.add("hidden");
      PinkeysApi.ping();        // start waking the API now, for the pages that need it
    } catch (err) {
      fail(err.message);
    } finally {
      busy = false; btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------ start up */
  document.addEventListener("click", () => { if (menuOpen) toggleMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menuOpen) toggleMenu(false); });
  window.addEventListener("pinkeys-auth", renderUser);
  renderHowTo();
  renderUser();

  return { open, close, user: () => PinkeysApi.session().user, loggedIn: () => PinkeysApi.loggedIn() };
})();
