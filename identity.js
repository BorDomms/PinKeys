/* ==============================================================
   PINKEYS — identity.js
   Identity page. You must be logged in. The API starts waking as soon as
   the page opens (badge: starting… / API ON / API OFF). Your account decides
   what you can do: no saved test -> take the Test; saved but not in the model
   -> press Update model and wait; in the model -> type 3 short passages and the
   API names the closest enrolled person.
   Requires common.js, content.js, config.js, api.js and auth.js (loaded first).
   ============================================================== */

const idGate = $("idGate");
const idStart = $("idStart");
const idContinueBtn = $("idContinue");
const idUpdateBtn = $("idUpdate");
const idApiBadge = $("idApiBadge"), idApiSpinner = $("idApiSpinner"), idApiDot = $("idApiDot");
const idApiLabel = $("idApiLabel"), idApiRetry = $("idApiRetry"), idApiDetail = $("idApiDetail");
const idUserMsg = $("idUserMsg"), idUserSpinner = $("idUserSpinner"), idDisclaimer = $("idDisclaimer");
const idRunning = $("idRunning");
const idRestartBtn = $("idRestart");
const idProgress = $("idProgress");
const idLiveGuess = $("idLiveGuess");
const idPassageText = $("idPassageText");
const idStage = $("idStage");
const idInput = $("idInput");
const idInterstitial = $("idInterstitial");
const idInterstitialText = $("idInterstitialText");
const idTyped = $("idTyped");
const idContinueTaskBtn = $("idContinueTask");
const idResult = $("idResult");
const idApiSummary = $("idApiSummary"), idApiBody = $("idApiBody"), idApiNote = $("idApiNote");
const idRunAgainBtn = $("idRunAgain");

const CI = (window.PINKEYS_CONTENT && window.PINKEYS_CONTENT.identity) || {};
const say = (key, fallback) => CI[key] || fallback;
$("idIntro").textContent = say("intro", "Type 3 short passages and the system will guess who you are from how you type.");
$("idGateText").textContent = say("loggedOut", "Log in to use Identity.");
$("idGateLogin").addEventListener("click", () => PinkeysAuth.open("login"));

/* -------------------------------------------------------------
   THE API BADGE
   starting (gray, spinner) -> API ON (green) | API OFF (red)
   "ON" means the server answers. What YOU can do then depends on your account (below).
   ------------------------------------------------------------- */
const API_LOOK = {
  starting: { color: "var(--muted)",     label: "starting…" },
  on:       { color: "var(--correct)",   label: "API ON" },
  off:      { color: "var(--incorrect)", label: "API OFF" },
};
let idApiState = "starting";
let idChecking = false;

function setApiState(state, detail) {
  idApiState = state;
  const look = API_LOOK[state];
  idApiBadge.style.color = look.color;
  idApiBadge.style.borderColor = look.color;
  idApiLabel.textContent = look.label;
  idApiSpinner.classList.toggle("hidden", state !== "starting");
  idApiDot.classList.toggle("hidden", state === "starting");
  idApiRetry.classList.toggle("hidden", state !== "off");
  idApiDetail.textContent = detail || "";
  renderUserState();
}

async function startApi() {
  if (idChecking) return;
  idChecking = true;
  setApiState("starting", PinkeysApi.configured() ? "Waking the server. A free server can take up to a minute." : "");
  try {
    const h = await PinkeysApi.wake({
      onTick: (s) => { if (s >= 3) idApiDetail.textContent = `Waking the server… ${s}s (a free server can take up to a minute)`; },
    });
    setApiState("on", h.problem ? "The server is up, but its saved model can't be used yet: " + h.problem : "");
    await refreshUserState();
  } catch (err) {
    setApiState("off", err.message);
  } finally {
    idChecking = false;
  }
}
idApiRetry.addEventListener("click", startApi);

/* -------------------------------------------------------------
   YOUR ACCOUNT'S STATE  (from the server: GET /me/status)
     no_data       you have not taken the Test          -> both buttons off
     too_few       your saved test is too short          -> both buttons off
     needs_update  you have data the model hasn't seen   -> Update on, Start off
     training      the model is being updated            -> both off, we keep checking
     blocked       update can't help yet (see message)   -> both off
     ready         you are in the model                  -> Start on, Update off
   ------------------------------------------------------------- */
let idUser = null;          // the last /me/status answer
let idPollTimer = null;
let idShownFor = null;

function renderUserState() {
  const on = idApiState === "on", st = idUser;
  let msg = "Checking your account…", spin = false;
  if (idApiState === "starting") { msg = "Waiting for the server…"; spin = true; }
  else if (!on) msg = "The server isn't reachable right now, so your account can't be checked.";
  else if (st) {
    if (st.state === "no_data") msg = say("noData", "Take the Test to participate here.");
    else if (st.state === "too_few") msg = st.detail;
    else if (st.state === "needs_update") msg = say("needsUpdate", "Your test data is saved, but the model doesn't include it yet. Press Update model.") + (st.detail ? " (Last time: " + st.detail + ")" : "");
    else if (st.state === "training") { msg = say("training", "The model is being updated…"); spin = true; }
    else if (st.state === "blocked") msg = st.detail;
    else if (st.state === "ready") msg = say("ready", "You're in the model. You can start the live test.");
  } else spin = true;
  idUserMsg.textContent = msg;
  idUserSpinner.classList.toggle("hidden", !spin);
  idUpdateBtn.disabled = !(on && st && st.can_update);
  idContinueBtn.disabled = !(on && st && st.can_start);
  const showDisclaimer = on && st && (st.state === "needs_update" || st.state === "training");
  idDisclaimer.classList.toggle("hidden", !showDisclaimer);
  if (showDisclaimer) {
    idDisclaimer.innerHTML = say("disclaimerHtml", "Updating the model takes some time (often a minute or more). While you wait, you can enjoy {practice}.")
      .replace("{practice}", '<a href="index.html" class="underline">Practice mode</a>');
  }
}

async function refreshUserState() {
  clearTimeout(idPollTimer);
  if (!PinkeysApi.loggedIn() || idApiState !== "on") return;
  try {
    idUser = await PinkeysApi.status();
    if (idApiState === "on" && idUser.model_people != null && idUser.state !== "no_data") {
      idApiDetail.textContent = `The model currently knows ${idUser.model_people} ${idUser.model_people === 1 ? "person" : "people"}.`;
    }
  } catch (err) {
    if (!PinkeysApi.loggedIn()) return;                 // logged out meanwhile: the gate is showing
    if (err.status === undefined) setApiState("off", err.message);
    else { idUserMsg.textContent = "Couldn't check your account: " + err.message; }
    return;
  }
  renderUserState();
  // while the model is being updated keep checking every few seconds; otherwise quietly every 45 s
  idPollTimer = setTimeout(() => { if (idPhase === "start") refreshUserState(); else if (idUser && idUser.state === "training") refreshUserState(); },
    idUser.state === "training" ? 4000 : 45000);
}

idUpdateBtn.addEventListener("click", async () => {
  idUpdateBtn.disabled = true;
  idUserMsg.textContent = "Starting the update…";
  try {
    await PinkeysApi.updateModel();
  } catch (err) {
    idUserMsg.textContent = err.message;
    await refreshUserState();
    return;
  }
  idUser = { ...(idUser || {}), state: "training", can_update: false, can_start: false };
  renderUserState();
  setTimeout(refreshUserState, 2500);
});

// show the gate or the start screen depending on whether someone is logged in
function syncIdAuth() {
  if (idPhase === "running" || idPhase === "interstitial") return;
  const u = PinkeysApi.loggedIn() ? PinkeysApi.session().user : null;
  if (!u) { idShownFor = null; idUser = null; clearTimeout(idPollTimer); showIdPhase("gate"); return; }
  const who = u.first_name + "|" + u.last_name;
  if (who === idShownFor && (idPhase === "start" || idPhase === "result")) return;   // e.g. only the nickname changed
  idShownFor = who; idUser = null;
  showIdPhase("start");
  renderUserState();
  if (idApiState === "on") refreshUserState(); else if (!idChecking) startApi();
}
window.addEventListener("pinkeys-auth", syncIdAuth);

/* -------------------------------------------------------------
   FLOW: start -> running -> interstitial -> result
   ------------------------------------------------------------- */
let idPhase = "gate";
let idTasks = [];
let idIdx = 0;
let idLiveSegments = [];   // one array of events per finished passage (the API keeps each passage's clock separate)
let idPendingEvents = null;

const idController = createTypingTaskController({
  stageEl: idStage, inputEl: idInput, restartBtn: idRestartBtn,
  onProgress: (events) => idOnProgress(events),   // live guess from the API
});

function showIdPhase(phase) {
  idPhase = phase;
  idGate.classList.toggle("hidden", phase !== "gate");
  idStart.classList.toggle("hidden", phase !== "start");
  idRunning.classList.toggle("hidden", phase !== "running");
  idInterstitial.classList.toggle("hidden", phase !== "interstitial");
  idResult.classList.toggle("hidden", phase !== "result");
}

idContinueBtn.addEventListener("click", () => {
  idTasks = pickN(SHORT_PASSAGES, 3);
  idIdx = 0;
  idLiveSegments = [];
  showIdPhase("running");
  startIdTask();
});

function startIdTask() {
  idLiveGuess.classList.remove("hidden");
  idLiveGuess.textContent = "Live guess: start typing…";
  idProgress.textContent = `Live sample ${idIdx + 1} of ${idTasks.length}`;
  idPassageText.textContent = idTasks[idIdx];
  idController.start(idTasks[idIdx], false, onIdTaskDone);
}

function onIdTaskDone(events, meta) {
  idPendingEvents = events;
  idInterstitialText.textContent = `Live samples: ${idIdx + 1} / ${idTasks.length} complete`;
  idTyped.innerHTML = buildTypedHTML(idTasks[idIdx], meta.typedText);
  showIdPhase("interstitial");
}

function continueAfterIdTask() {
  idLiveSegments.push(idPendingEvents);
  idPendingEvents = null;
  if (idIdx + 1 >= idTasks.length) {
    showIdResult();
  } else {
    idIdx++;
    showIdPhase("running");
    startIdTask();
  }
}
idContinueTaskBtn.addEventListener("click", continueAfterIdTask);
idRestartBtn.addEventListener("click", () => idController.restart());

// while someone types: send what we have so far, show the current best guess
async function idOnProgress(events) {
  if (idPhase !== "running" || idLiveBusy || !(idUser && idUser.can_start)) return;
  idLiveBusy = true;
  try {
    const r = await PinkeysApi.identify([...idLiveSegments, events], 3);
    if (idPhase !== "running") return;
    const res = r.result, pct = (res.confidence * 100).toFixed(0);
    idLiveGuess.textContent = res.status === "insufficient_data"
      ? `Live guess: listening… (${r.n_keystrokes} key presses so far)`
      : res.status === "unknown"
        ? `Live guess: nobody enrolled matches well so far (closest: ${res.best_match}, ${pct}%)`
        : `Live guess: ${res.best_match} — ${pct}% (${r.n_keystrokes} key presses)`;
  } catch (err) {
    idLiveGuess.textContent = "Live guess unavailable: " + err.message;
  } finally {
    idLiveBusy = false;
  }
}

const ID_SCORER_COLUMNS = ["digraph", "lda", "svm", "rf", "knn", "manhattan"];
async function showIdResult() {
  showIdPhase("result");
  idApiSummary.textContent = "Asking the API…";
  idApiBody.innerHTML = ""; idApiNote.textContent = "";
  try {
    const r = await PinkeysApi.identify(idLiveSegments, 10);
    const res = r.result, pct = (x) => (x * 100).toFixed(1) + "%";
    idApiSummary.innerHTML =
      res.status === "match" ? `<b>${escapeHtml(res.label)}</b> — ${pct(res.confidence)} confidence`
      : res.status === "unknown" ? `No enrolled person matches well enough. Closest: <b>${escapeHtml(res.best_match)}</b> at ${pct(res.confidence)} (needs ${pct(res.threshold)}).`
      : "Not enough typing to decide yet.";
    idApiBody.innerHTML = r.ranking.map((row, i) => `
      <tr class="border-b border-[var(--border)]">
        <td class="py-2 pr-3">${i + 1}</td>
        <td class="py-2 pr-3">${escapeHtml(row.name)}</td>
        <td class="py-2 pr-3 mono">${pct(row.probability)}</td>
        ${ID_SCORER_COLUMNS.map((s) => `<td class="py-2 pr-3 mono text-[var(--muted)]">${row.per_scorer[s] != null ? pct(row.per_scorer[s]) : "—"}</td>`).join("")}
      </tr>`).join("");
    idApiNote.textContent = `Based on ${r.n_keystrokes} key presses. The probability averages six models; the grey columns show each one's own opinion.`;
  } catch (err) {
    idApiSummary.textContent = "API unavailable: " + err.message;
  }
}
idRunAgainBtn.addEventListener("click", () => { showIdPhase("start"); renderUserState(); refreshUserState(); });

/* -------------------------------------------------------------
   PAGE SHELL
   Stray-click refocuser and Enter-to-continue, as on the Test page.
   ------------------------------------------------------------- */
const isVisible = (el) => !el.classList.contains("hidden");

document.addEventListener("mousedown", (e) => {
  if (["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"].includes(e.target.tagName)) return;
  if (idPhase !== "running") return;
  e.preventDefault();
  idInput.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat) return;
  if (isVisible(idInterstitial)) { e.preventDefault(); continueAfterIdTask(); }
});

startApi();   // wake the API the moment the page opens
syncIdAuth();
