/* ==============================================================
   PINKEYS — identity.js
   Identity page. The API starts waking as soon as the page opens;
   a badge shows starting… / API ON / API OFF. The person types 3
   short passages and the API names the closest enrolled person.
   Enrollment is automatic: finished Test sessions are saved online
   and the server retrains itself, so there is nothing to upload.
   Requires common.js, config.js and api.js (loaded first).
   ============================================================== */

const idStart = $("idStart");
const idContinueBtn = $("idContinue");
const idApiBadge = $("idApiBadge"), idApiSpinner = $("idApiSpinner"), idApiDot = $("idApiDot");
const idApiLabel = $("idApiLabel"), idApiRetry = $("idApiRetry"), idApiDetail = $("idApiDetail");
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

/* -------------------------------------------------------------
   API STATUS
   starting (gray, spinner) -> API ON (green) | API OFF (red)
   "ON" means the server answers and can identify (a model is loaded).
   A server that answers but has nobody enrolled yet is ON, but the
   test can't start until someone has finished the Test page.
   ------------------------------------------------------------- */
const API_LOOK = {
  starting: { color: "var(--muted)",     label: "starting…" },
  on:       { color: "var(--correct)",   label: "API ON" },
  off:      { color: "var(--incorrect)", label: "API OFF" },
};
let idApiState = "starting";
let idApiTrained = false;   // a model is loaded and usable
let idPeople = 0;
let idLiveBusy = false;     // one live request at a time
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
  idContinueBtn.disabled = !(state === "on" && idApiTrained);
}

// turn a /health answer into the badge + a one-line explanation
function applyHealth(h) {
  idApiTrained = !!h.trained && !h.problem;
  idPeople = h.people || 0;
  if (h.problem) {
    setApiState("off", "The server is up, but its saved model can't be used: " + h.problem);
  } else if (idApiTrained) {
    setApiState("on", `${idPeople} ${idPeople === 1 ? "person is" : "people are"} enrolled and ready to be recognized.`);
  } else if (h.training) {
    setApiState("on", "The model is being trained from the latest tests. Check back in a minute or two.");
  } else {
    setApiState("on", "Nobody is enrolled yet. Finish the Test page first (the server learns from every finished test).");
  }
}

async function startApi() {
  if (idChecking) return;
  idChecking = true;
  idApiTrained = false;
  setApiState("starting", PinkeysApi.configured() ? "Waking the server. A free server can take up to a minute." : "");
  try {
    applyHealth(await PinkeysApi.wake({
      onTick: (s) => { if (s >= 3) idApiDetail.textContent = `Waking the server… ${s}s (a free server can take up to a minute)`; },
    }));
  } catch (err) {
    idApiTrained = false;
    setApiState("off", err.message);
  } finally {
    idChecking = false;
  }
}
idApiRetry.addEventListener("click", startApi);

// while the start screen is open, quietly keep the badge honest (and the enrolled count fresh)
setInterval(async () => {
  if (idPhase !== "start" || idChecking || idApiState === "starting") return;
  try { applyHealth(await PinkeysApi.health()); }
  catch { startApi(); }   // it stopped answering: show starting… and try to wake it again
}, 45000);

/* -------------------------------------------------------------
   FLOW: start -> running -> interstitial -> result
   ------------------------------------------------------------- */
let idPhase = "start";
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
  if (idPhase !== "running" || idLiveBusy || !idApiTrained) return;
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
idRunAgainBtn.addEventListener("click", () => { showIdPhase("start"); startApi(); });   // also refreshes the enrolled count

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
