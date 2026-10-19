/* ==============================================================
   PINKEYS — identity.js
   Identity page: CSV upload + live comparison.
   Requires common.js (loaded first in the HTML).
   ============================================================== */

/* -------------------------------------------------------------
   DOM REFERENCES
   ------------------------------------------------------------- */
// identity tab
const idUpload = $("idUpload");
const idFileInput = $("idFileInput");
const idUploadStatus = $("idUploadStatus");
const idContinueBtn = $("idContinue");
const idRunning = $("idRunning");
const idRestartBtn = $("idRestart");
const idProgress = $("idProgress");
const idPassageText = $("idPassageText");
const idStage = $("idStage");
const idInput = $("idInput");
const idInterstitial = $("idInterstitial");
const idInterstitialText = $("idInterstitialText");
const idTyped = $("idTyped");
const idContinueTaskBtn = $("idContinueTask");
const idResult = $("idResult");
const idResultSummary = $("idResultSummary");
const idResultBody = $("idResultBody");
const idRunAgainBtn = $("idRunAgain");

/* -------------------------------------------------------------
   8. IDENTITY TAB
   buildProfilesFromRows() re-hydrates uploaded CSV(s) into one
   feature vector per enrolled session. The person then types 3
   live short passages, and dist() (section 3) ranks stored
   profiles by similarity to that live sample.
   Phases: upload -> running -> interstitial -> result

   Because of FIX 4 above, a row's time_ms is now a gap since the
   previous event rather than an absolute clock — so before this
   can call computeFeatures() (which expects an absolute, increasing
   timeline), it has to re-accumulate those gaps back into absolute
   time, per (session, task), in file order.
   ------------------------------------------------------------- */
function buildProfilesFromRows(rows) {
  const bySession = {};

  // ---- pass 1: keystroke events (SUMMARY / METRIC rows are read in pass 2) ----
  for (const r of rows) {
    if (r.task_type === "SUMMARY" || r.task_type === "METRIC") continue;
    const sid = r.session_id || `${r.first_name}_${r.last_name}`;
    if (!bySession[sid]) {
      bySession[sid] = {
        meta: { fn: r.first_name, ln: r.last_name, nn: r.nickname },
        events: [],
        summary: {},            // old-format CSVs: session SUMMARY rows
        fixedTasks: new Set(),  // which fixed-text (quote/short/long) tasks this session had
        fixedMetrics: { correct: 0, incorrect: 0, extra: 0, missed: 0, tasks: new Set() },  // from per-test METRIC rows
      };
    }
    const down = parseFloat(r.keydown_time);
    const up   = parseFloat(r.keyup_time);
    if (Number.isFinite(down) && Number.isFinite(up)) {
      bySession[sid].events.push({ key: r.key, type: "down", t: down });
      bySession[sid].events.push({ key: r.key, type: "up",   t: up });
    }
    if (r.task_type === "quote" || r.task_type === "short" || r.task_type === "long") bySession[sid].fixedTasks.add(r.task_index);
  }

  // ---- pass 2: metric rows — metric name in "key", number in "value" (older files: "dwell") ----
  for (const r of rows) {
    const sid = r.session_id || `${r.first_name}_${r.last_name}`;
    if (!bySession[sid]) continue;
    // newer files: number in "value"; older files kept it in "dwell"
    const v = parseFloat(r.value !== undefined && r.value !== "" ? r.value : r.dwell);
    if (!Number.isFinite(v)) continue;
    if (r.task_type === "SUMMARY") bySession[sid].summary[r.key] = v;   // older CSVs: one block at the end
    else if (r.task_type === "METRIC" && r.test_kind === "pre-generated") {
      // newer CSVs: a block after every test. Only pre-generated tests feed the profile.
      const fm = bySession[sid].fixedMetrics;
      if (r.key in fm && r.key !== "tasks") fm[r.key] += v;
      fm.tasks.add(r.task_index);
    }
  }

  // ---- assemble ----
  return Object.values(bySession).map((s) => {
    s.events.sort((a, b) => a.t - b.t);

    // Counts are totals over the fixed-text tests; normalize per test so sessions with
    // different test counts are comparable. If the CSV has no metric data, pass null and
    // the metric skips these features.
    let taskStats = null;
    const fm = s.fixedMetrics;
    if (fm.tasks.size > 0) {
      const n = fm.tasks.size, typed = fm.correct + fm.incorrect + fm.extra;
      taskStats = {
        accuracy: typed ? 100 * fm.correct / typed : null,
        correct: fm.correct / n, incorrect: fm.incorrect / n, extra: fm.extra / n, missed: fm.missed / n,
      };
    } else if (Object.keys(s.summary).length > 0) {
      const nFixed = Math.max(s.fixedTasks.size, 1);
      taskStats = {
        accuracy:  Number.isFinite(s.summary.accuracy)  ? s.summary.accuracy  : null,
        correct:   Number.isFinite(s.summary.correct)   ? s.summary.correct   / nFixed : null,
        incorrect: Number.isFinite(s.summary.incorrect) ? s.summary.incorrect / nFixed : null,
        extra:     Number.isFinite(s.summary.extra)     ? s.summary.extra     / nFixed : null,
        missed:    Number.isFinite(s.summary.missed)    ? s.summary.missed    / nFixed : null,
      };
    }

    return { meta: s.meta, features: computeFeatures(s.events, taskStats) };
  });
}

let idPhase = "upload"; // upload | running | interstitial | result
let idProfiles = [];
let idTasks = [];
let idIdx = 0;
let idLiveEvents = [];
let idLiveSegments = [];   // one array of events per finished passage (the API keeps each passage's clock separate)
let idPendingEvents = null;
let idSummary = null;   // running totals across the 3 live short passages

const idController = createTypingTaskController({
  stageEl: idStage, inputEl: idInput, restartBtn: idRestartBtn,
  onProgress: (events) => idOnProgress(events),   // live guess from the Python API (if enabled)
});

function showIdPhase(phase) {
  idPhase = phase;
  idUpload.classList.toggle("hidden", phase !== "upload");
  idRunning.classList.toggle("hidden", phase !== "running");
  idInterstitial.classList.toggle("hidden", phase !== "interstitial");
  idResult.classList.toggle("hidden", phase !== "result");
}

// reads every uploaded CSV, parses it, and builds one profile per session found
idFileInput.addEventListener("change", async (e) => {
  const files = [...e.target.files];
  let allRows = [];
  for (const file of files) {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) continue;
    const headers = rows[0];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length < headers.length) continue;
      const obj = {};
      headers.forEach((h, hi) => (obj[h] = rows[i][hi]));
      allRows.push(obj);
    }
  }
  idProfiles = buildProfilesFromRows(allRows);
  idUploadStatus.textContent = idProfiles.length
    ? `Loaded ${idProfiles.length} profile(s): ${idProfiles.map((p) => `${p.meta.fn} ${p.meta.ln}`).join(", ")}`
    : "No valid profiles found.";
  idContinueBtn.disabled = idProfiles.length === 0 && !idApiTrained;
  if (PinkeysApi.settings().enabled && files.length) await idEnrollViaApi(files);
});

idContinueBtn.addEventListener("click", () => {
  idTasks = pickN(SHORT_PASSAGES, 3);
  idIdx = 0;
  idLiveEvents = [];
  idLiveSegments = [];
  idSummary = { correct: 0, incorrect: 0, extra: 0, missed: 0, countedFixed: 0 };
  showIdPhase("running");
  startIdTask();
});

function startIdTask() {
  const live = PinkeysApi.settings().enabled && idApiTrained;
  idLiveGuess.classList.toggle("hidden", !live);
  if (live) idLiveGuess.textContent = "Live guess (Python API): start typing…";
  idProgress.textContent = `Live sample ${idIdx + 1} of ${idTasks.length}`;
  idPassageText.textContent = idTasks[idIdx];
  idController.start(idTasks[idIdx], false, onIdTaskDone);
}

function onIdTaskDone(events, meta) {
  idPendingEvents = events;

  // Live samples are always fixed-text short passages, so these are present.
  if (meta && meta.correct != null) {
    idSummary.correct   += meta.correct;
    idSummary.incorrect += meta.incorrect;
    idSummary.extra     += meta.extra;
    idSummary.missed    += meta.missed;
    idSummary.countedFixed++;
  }

  idInterstitialText.textContent = `Live samples: ${idIdx + 1} / ${idTasks.length} complete`;
  idTyped.innerHTML = buildTypedHTML(idTasks[idIdx], meta.typedText);
  showIdPhase("interstitial");
}

function continueAfterIdTask() {
  idLiveEvents.push(...idPendingEvents);
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

/* -------------------------------------------------------------
   PYTHON API (optional)
   Everything here is skipped unless the "Use the Python API" box is
   ticked. The in-browser comparison below keeps working on its own.
   ------------------------------------------------------------- */
const idApiOn = $("idApiOn"), idApiFields = $("idApiFields"), idApiUrl = $("idApiUrl"), idApiKey = $("idApiKey");
const idApiTest = $("idApiTest"), idApiWake = $("idApiWake"), idApiReload = $("idApiReload"), idApiStatus = $("idApiStatus"), idLiveGuess = $("idLiveGuess");
const idApiResult = $("idApiResult"), idApiSummary = $("idApiSummary"), idApiBody = $("idApiBody"), idApiNote = $("idApiNote");
let idApiTrained = false;   // true once the API has a trained model
let idApiReadOnly = false;  // a hosted copy that serves a fixed model and refuses uploads
let idLiveBusy = false;     // one live request at a time

(function loadApiSettings() {
  const s = PinkeysApi.settings();
  idApiOn.checked = s.enabled; idApiUrl.value = s.url; idApiKey.value = s.key;
  idApiFields.classList.toggle("hidden", !s.enabled);
})();

function idSaveApiSettings() {
  PinkeysApi.save({ enabled: idApiOn.checked, url: idApiUrl.value.trim(), key: idApiKey.value });
  idApiFields.classList.toggle("hidden", !idApiOn.checked);
  idApiStatus.textContent = "";
  idApiTrained = false;
}
[idApiOn, idApiUrl, idApiKey].forEach((el) => el.addEventListener("change", idSaveApiSettings));

// shared by "Test connection" and "Wake up API": turn a /health answer into a status line
function idApplyHealth(h) {
  idApiTrained = !!h.trained;
  idApiReadOnly = !!h.read_only;
  let msg;
  if (h.problem) msg = "Connected, but the server's saved model can't be used: " + h.problem;
  else if (h.trained && h.read_only) msg = `Awake and ready. The server has a model for ${h.people} people (read-only: uploading CSVs here won't change it).`;
  else if (h.trained) msg = `Connected. The API already has a model for ${h.people} people. Upload CSVs below to replace it, or just continue.`;
  else if (h.storage && h.storage.problem) msg = "Awake, but there is no model yet. " + h.storage.problem;
  else if (h.read_only) msg = "Awake, but this server has no model yet. On your computer run  python train.py YOUR.csv --push , then press Load newest model.";
  else msg = "Connected, but it has no model yet. Upload the enrollment CSVs below to train it.";
  idApiStatus.textContent = msg;
  idContinueBtn.disabled = idProfiles.length === 0 && !idApiTrained;
}

const idAsleepHint = " If it is a free Render server it may be asleep: press Wake up API.";

async function idCheckApi() {
  idApiStatus.textContent = "Connecting…";
  try {
    idApplyHealth(await PinkeysApi.health());
  } catch (err) {
    idApiTrained = false;
    idApiStatus.textContent = err.message + (/Can't reach|too long/.test(err.message) ? idAsleepHint : "");
  }
}

async function idWakeApi() {
  idApiWake.disabled = idApiTest.disabled = true;
  try {
    idApplyHealth(await PinkeysApi.wake({
      onTick: (s) => { idApiStatus.textContent = `Waking the API… ${s}s (a free server can take up to a minute)`; },
    }));
  } catch (err) {
    idApiTrained = false;
    idApiStatus.textContent = err.message;
  } finally {
    idApiWake.disabled = idApiTest.disabled = false;
  }
}
idApiWake.addEventListener("click", idWakeApi);

// after training a new model on your computer (train.py ... --push): tell the server to fetch it
async function idReloadApi() {
  idApiReload.disabled = true;
  idApiStatus.textContent = "Asking the API to load the newest model from Supabase…";
  try {
    idApplyHealth(await PinkeysApi.reload());
    idApiStatus.textContent = "Loaded. " + idApiStatus.textContent;
  } catch (err) {
    idApiStatus.textContent = "Could not load the newest model: " + err.message + (/Can't reach|too long|waking up/.test(err.message) ? idAsleepHint : "");
  } finally {
    idApiReload.disabled = false;
  }
}
idApiReload.addEventListener("click", idReloadApi);
idApiTest.addEventListener("click", idCheckApi);

async function idEnrollViaApi(files) {
  if (idApiReadOnly) {
    idApiStatus.textContent = "The API is read-only, so these files only feed the in-browser comparison. Its own model is unchanged.";
    return;
  }
  idApiStatus.textContent = "Training the API's model on these files…";
  try {
    const r = await PinkeysApi.enroll(files);
    idApiTrained = true;
    const acc = r.cross_validation && r.cross_validation.ensemble ? r.cross_validation.ensemble.accuracy_full_tests : null;
    idApiStatus.textContent = `API trained on ${Object.keys(r.people).length} people (${r.tests} tests)` +
      (acc != null ? `; on held-out tests it named the right person ${(100 * acc).toFixed(0)}% of the time.` : ".");
    idContinueBtn.disabled = false;
  } catch (err) {
    idApiTrained = false;
    idApiStatus.textContent = "API enrollment failed: " + err.message + (/Can't reach|too long/.test(err.message) ? idAsleepHint : "");
  }
}

// while someone types: send what we have so far, show the current best guess
async function idOnProgress(events) {
  if (idPhase !== "running" || idLiveBusy || !PinkeysApi.settings().enabled || !idApiTrained) return;
  idLiveBusy = true;
  try {
    const r = await PinkeysApi.identify([...idLiveSegments, events], 3);
    if (idPhase !== "running") return;
    const res = r.result, pct = (res.confidence * 100).toFixed(0);
    idLiveGuess.textContent = res.status === "insufficient_data"
      ? `Live guess (Python API): listening… (${r.n_keystrokes} key presses so far)`
      : res.status === "unknown"
        ? `Live guess (Python API): nobody enrolled matches well so far (closest: ${res.best_match}, ${pct}%)`
        : `Live guess (Python API): ${res.best_match} — ${pct}% (${r.n_keystrokes} key presses)`;
  } catch (err) {
    idLiveGuess.textContent = "Live guess unavailable: " + err.message;
  } finally {
    idLiveBusy = false;
  }
}

const ID_SCORER_COLUMNS = ["digraph", "lda", "svm", "rf", "knn", "manhattan"];
async function idShowApiResult() {
  const on = PinkeysApi.settings().enabled && idApiTrained;
  idApiResult.classList.toggle("hidden", !on);
  if (!on) return;
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

// ranks every uploaded profile against the live sample just recorded
function showIdResult() {
  idShowApiResult();   // asks the Python API in the background (if enabled)

  // Build the live sample's features with the same shape as the stored
  // profiles — including the fixed-text stats collected across all 3 samples.
  const nFixed = Math.max(idSummary?.countedFixed || 0, 1);
  const liveStats = idSummary && idSummary.countedFixed ? {
    accuracy:  null, // computed below from aggregated counts
    correct:   idSummary.correct   / nFixed,
    incorrect: idSummary.incorrect / nFixed,
    extra:     idSummary.extra     / nFixed,
    missed:    idSummary.missed    / nFixed,
  } : null;
  // accuracy for the live sample = correct / (correct+incorrect+extra)
  if (liveStats) {
    const denom = idSummary.correct + idSummary.incorrect + idSummary.extra;
    liveStats.accuracy = denom ? 100 * idSummary.correct / denom : null;
  }
  const liveFeat = computeFeatures(idLiveEvents, liveStats);

  // z-scored distance against the uploaded cohort
  const distFn = makeZScoredDist([...idProfiles, { meta: { fn: "__live__" }, features: liveFeat }]);
  const ranked = idProfiles
    .map((p) => ({ ...p, d: distFn(liveFeat, p.features) }))
    .sort((a, b) => a.d - b.d);

  const finite = ranked.map((r) => r.d).filter(Number.isFinite);
  const maxD = Math.max(...finite, 1);
  const best = ranked[0];

  idResultSummary.innerHTML = best
    ? `<b>${best.meta.fn} ${best.meta.ln}</b>${best.meta.nn ? ` ("${best.meta.nn}")` : ""} — ${(100 * (1 - best.d / maxD)).toFixed(1)}% similarity`
    : "No profiles to compare.";

  idResultBody.innerHTML = ranked.map((r, i) => {
    const sim = Number.isFinite(r.d) ? (100 * (1 - r.d / maxD)).toFixed(1) + "%" : "—";
    const acc = Number.isFinite(r.features.accuracy) ? r.features.accuracy.toFixed(1) + "%" : "—";
    return `
      <tr class="border-b border-[var(--border)]">
        <td class="py-3 pr-4">${i + 1}</td>
        <td class="py-3 pr-4">${r.meta.fn} ${r.meta.ln}${r.meta.nn ? ` (${r.meta.nn})` : ""}</td>
        <td class="py-3 pr-4">${sim}</td>
        <td class="py-3 pr-4 mono">${r.features.meanDwell.toFixed(1)}ms</td>
        <td class="py-3 pr-4 mono">${r.features.meanFlight.toFixed(1)}ms</td>
        <td class="py-3 pr-4 mono">${r.features.wpm.toFixed(1)}</td>
        <td class="py-3 pr-4 mono">${acc}</td>
      </tr>
    `;
  }).join("");

  showIdPhase("result");
}
idRunAgainBtn.addEventListener("click", () => showIdPhase("upload"));


/* -------------------------------------------------------------
   PAGE SHELL
   Same stray-click refocuser and Enter-to-continue handler as
   test.js, for this page's screens.
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
