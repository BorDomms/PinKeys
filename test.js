/* ==============================================================
   PINKEYS — test.js
   Test page: enrollment battery for the logged-in account, saved online + CSV download.
   Requires common.js (loaded first in the HTML).
   ============================================================== */

/* -------------------------------------------------------------
   DOM REFERENCES
   ------------------------------------------------------------- */
// test tab
const testIntro = $("testIntro");
const testGate = $("testGate");
const testConsent = $("testConsent");
const testReplace = $("testReplace");
const testReplaceRow = $("testReplaceRow");
const testIntroMsg = $("testIntroMsg");
const testBeginBtn = $("testBegin");
const testRunning = $("testRunning");
const testRestartBtn = $("testRestart");
const testProgress = $("testProgress");
const testTypeBadge = $("testTypeBadge");
const testPassageText = $("testPassageText");
const testFixedWrap = $("testFixedWrap");
const testStage = $("testStage");
const testInput = $("testInput");
const testFreeInput = $("testFreeInput");
const testFixedHintRow = $("testFixedHintRow");
const testFreeControls = $("testFreeControls");
const testFreeNext = $("testFreeNext");
const testFreeHint = $("testFreeHint");
const testInterstitial = $("testInterstitial");
const testInterstitialText = $("testInterstitialText");
const testTyped = $("testTyped");
const testTypedLegend = $("testTypedLegend");
const testMetrics = $("testMetrics");
const testContinueBtn = $("testContinue");
const testDone = $("testDone");
const testDoneSummary = $("testDoneSummary");
const testDownloadBtn = $("testDownload");
const testAgainBtn = $("testAgain");
const testSaveStatus = $("testSaveStatus"), testSaveSpinner = $("testSaveSpinner"), testSaveIcon = $("testSaveIcon");
const testSaveText = $("testSaveText"), testSaveRetry = $("testSaveRetry"), testDownloadSize = $("testDownloadSize");
const testSaveReplace = $("testSaveReplace");

/* -------------------------------------------------------------
   7. TEST TAB (enrollment)
   Collects a full biometric sample for one person: name intake ->
   10 quotes + 3 short + 3 long + 4 free-text tasks in random order (buildTaskList) -> an
   interstitial confirmation between every task -> a CSV of every
   keystroke event, downloadable at the end.
   Phases: intro -> running -> interstitial -> (loops) -> done

   FIX 4 lives in onTestTaskDone() below: the logger's internal
   events (absolute ms since the task's first keystroke) get
   converted to "ms since the previous event" right before they're
   written into CSV rows — so the exported file reflects gaps
   between actions, not one continuous running clock. The internal
   computeFeatures() math is untouched; only the exported number
   changes, and buildProfilesFromRows() in section 8 reconstructs
   the absolute timeline again when reading a CSV back in.
   ------------------------------------------------------------- */
// What every session contains. Always exactly these counts (20 tasks in total);
// only the ORDER is random. Change the numbers here to change the test.
const TEST_COUNTS = { quote: 10, short: 3, long: 3, free: 4 };

function buildTaskList() {
  const tasks = [
    ...pickN(QUOTES, TEST_COUNTS.quote).map((text) => ({ type: "quote", text })),
    ...pickN(SHORT_PASSAGES, TEST_COUNTS.short).map((text) => ({ type: "short", text })),
    ...pickN(LONG_PASSAGES, TEST_COUNTS.long).map((text) => ({ type: "long", text })),
    ...pickN(QUESTIONS, TEST_COUNTS.free).map((text) => ({ type: "free", text })),
  ];
  return pickN(tasks, tasks.length);   // pickN shuffles, so this mixes all categories together
}

let testPhase = "gate"; // gate | intro | running | interstitial | done
let testParticipant = { fn: "", ln: "", nn: "" };   // always the logged-in account
let testReplaceFlag = false;                          // the person acknowledged that this test replaces their old data
let testTasks = [];
let testIdx = 0;
let testLog = [];
let testPending = null;
let testSessionId = null;
let testCsvText = "";    // the finished CSV: what Download gives you and what is saved online

const TEST_CSV_HEADERS = ["session_id", "first_name", "last_name", "nickname", "date_recorded", "task_type", "task_index", "passage_text", "key", "keydown_time", "keyup_time", "dwell", "flight", "value", "category", "test_kind"];

const testController = createTypingTaskController({
  stageEl: testStage, inputEl: testInput,
  freeInputEl: testFreeInput, freeControlsEl: testFreeControls,
  freeNextBtn: testFreeNext, freeHintEl: testFreeHint,
  fixedWrapEl: testFixedWrap, restartBtn: testRestartBtn, minFreeChars: 40,
});

function showTestPhase(phase) {
  testPhase = phase;
  testGate.classList.toggle("hidden", phase !== "gate");
  testIntro.classList.toggle("hidden", phase !== "intro");
  testRunning.classList.toggle("hidden", phase !== "running");
  testInterstitial.classList.toggle("hidden", phase !== "interstitial");
  testDone.classList.toggle("hidden", phase !== "done");
}

/* -------------------------------------------------------------
   START SCREEN
   The person is already logged in, so no names are asked. The text on this screen comes from content.js.
   If they already have saved data they must tick a second box: this new test REPLACES the old data.
   ------------------------------------------------------------- */
const CT = (window.PINKEYS_CONTENT && window.PINKEYS_CONTENT.test) || {};
let testStatus = null;       // the server's answer from GET /me/status (null = not loaded yet)
let testIntroUser = null;    // whose status that is

function updateTestBeginState() {
  const needsReplace = !!(testStatus && testStatus.has_data);
  testBeginBtn.disabled = !(testStatus && testConsent.checked && (!needsReplace || testReplace.checked));
}
testConsent.addEventListener("change", updateTestBeginState);
testReplace.addEventListener("change", updateTestBeginState);

function fillIntroText() {
  const set = (id, v) => { const el = $(id); if (el && v != null) el.innerHTML = v; };
  set("testIntroTitle", CT.title); set("testInstructionsTitle", CT.instructionsTitle); set("testInstructions", CT.instructionsHtml);
  set("testWarningTitle", CT.warningTitle); set("testWarning", CT.warningHtml);
  set("testRegulationsTitle", CT.regulationsTitle); set("testRegulations", CT.regulationsHtml);
  $("testConsentText").textContent = CT.consentText || "";
  $("testReplaceText").textContent = CT.replaceText || "";
}

async function loadTestStatus() {
  const u = PinkeysApi.session().user;
  testStatus = null;
  testReplaceRow.classList.add("hidden");
  testConsent.checked = false; testReplace.checked = false;
  updateTestBeginState();
  $("testAs").innerHTML = `Taking the test as <b>${escapeHtml(u.display_name)}</b> (${escapeHtml(u.first_name + " " + u.last_name)}).`;
  testIntroMsg.style.color = "var(--muted)";
  testIntroMsg.textContent = "Checking your account…";
  try {
    await PinkeysApi.wake({ onTick: (s) => { if (s >= 3) testIntroMsg.textContent = `Waking the server… ${s}s (a free server can take up to a minute)`; } });
    if (!PinkeysApi.loggedIn()) return;
    testStatus = await PinkeysApi.status();
    testIntroUser = u.first_name + "|" + u.last_name;
    testReplaceRow.classList.toggle("hidden", !testStatus.has_data);
    testIntroMsg.textContent = testStatus.has_data ? "You already have saved data. Taking this test again will replace it." : "";
  } catch (err) {
    if (!PinkeysApi.loggedIn()) return;       // logged out meanwhile: the gate is showing
    testIntroMsg.style.color = "var(--incorrect)";
    testIntroMsg.textContent = "Couldn't check your account: " + err.message + " Reload the page to try again.";
  }
  updateTestBeginState();
}

// show the gate or the start screen depending on whether someone is logged in (not while a test is running)
let testShownFor = null;
function syncTestAuth() {
  if (testPhase === "running" || testPhase === "interstitial" || testPhase === "done") return;
  const u = PinkeysApi.loggedIn() ? PinkeysApi.session().user : null;
  const who = u ? u.first_name + "|" + u.last_name : null;
  if (!u) { testShownFor = null; showTestPhase("gate"); return; }
  if (who === testShownFor && testPhase === "intro") return;        // e.g. only the nickname changed
  testShownFor = who;
  showTestPhase("intro");
  fillIntroText();
  loadTestStatus();
}
window.addEventListener("pinkeys-auth", syncTestAuth);
$("testGateLogin").addEventListener("click", () => PinkeysAuth.open("login"));

testBeginBtn.addEventListener("click", () => {
  PinkeysApi.ping();   // a sleeping free server takes a while to wake; start that now, so it is ready at the end
  const u = PinkeysApi.session().user;
  testParticipant = { fn: u.first_name, ln: u.last_name, nn: u.nickname || "" };
  testReplaceFlag = !!(testStatus && testStatus.has_data && testReplace.checked);
  testSessionId = uid();
  testTasks = buildTaskList();
  testIdx = 0;
  testLog = [];
  showTestPhase("running");
  startTestTask();
});

function startTestTask() {
  const task = testTasks[testIdx];
  testProgress.textContent = `Task ${testIdx + 1} of ${testTasks.length}`;
  testTypeBadge.textContent = task.type;
  testPassageText.textContent = task.text;
  testFixedHintRow.classList.toggle("hidden", task.type === "free");
  testController.start(
    task.type === "free" ? "" : task.text,
    task.type === "free",
    (events, meta) => onTestTaskDone(events, meta, task)
  );
}

function onTestTaskDone(events, meta, task) {
  // All metrics for this one test (pre-generated text vs. free-type is decided by task.type).
  const M = taskMetrics(events, meta, task.type === "free" ? "" : task.text);

  // Pair each keydown with the next keyup of the same key into one completed
  // press — one CSV row per press, not per raw event.
  const pending = {};
  const presses = [];
  for (const ev of events) {
    if (ev.type === "down") pending[ev.key] = ev;
    else if (pending[ev.key] != null) {
      presses.push({ key: ev.key, down: pending[ev.key].t, up: ev.t });
      delete pending[ev.key];
    }
  }
  presses.sort((a, b) => a.down - b.down);

  // time_ms was absolute ms since this task's first keystroke; round to
  // whole ms and derive dwell/flight from consecutive presses.
  const rows = presses.map((p, i) => {
    const keydown_time = Math.round(p.down);
    const keyup_time = Math.round(p.up);
    const prev = i > 0 ? presses[i - 1] : null;
    return {
      session_id: testSessionId,
      first_name: testParticipant.fn,
      last_name: testParticipant.ln,
      nickname: testParticipant.nn,
      date_recorded: nowIso(),
      task_type: task.type,
      task_index: testIdx,
      passage_text: task.text,
      key: p.key,
      keydown_time: keydown_time,
      keyup_time: keyup_time,
      dwell: keyup_time - keydown_time,
      flight: prev ? keydown_time - Math.round(prev.up) : 0,
      category: task.type,    // quote / short / long / free
      test_kind: M.kind,      // pre-generated / free-type
    };
  });

  // This test's metrics go right AFTER its keystrokes: one METRIC row per metric,
  // metric name in "key", its number in "value" (dwell / flight / key times stay blank on these rows). (free-type letter counts / accuracy are spellcheck estimates.)
  const metricBase = {
    session_id: testSessionId, first_name: testParticipant.fn, last_name: testParticipant.ln,
    nickname: testParticipant.nn, date_recorded: nowIso(), task_type: "METRIC", task_index: testIdx,
    passage_text: task.text, keydown_time: "", keyup_time: "", dwell: "", flight: "",
    category: task.type, test_kind: M.kind,
  };
  const metricList = [
    ["wpm", M.wpm], ["raw_wpm", M.rawWpm], ["accuracy", M.accuracy], ["consistency", M.consistency],
    ["correct", M.correct], ["incorrect", M.incorrect], ["extra", M.extra], ["missed", M.missed],
    ["backspaces", M.backspaces], ["ctrl_backspaces", M.ctrlBackspaces],
    ["total_words", M.totalWords], ["total_letters", M.totalLetters],
  ];
  for (const [metric, value] of metricList) rows.push({ ...metricBase, key: metric, value });

  testPending = { rows, task };
  const total = testTasks.filter((t) => t.type === task.type).length;
  const completed = testTasks.slice(0, testIdx + 1).filter((t) => t.type === task.type).length;
  testInterstitialText.textContent = `${CATEGORY_LABEL[task.type]}: ${completed} / ${total} complete`;
  renderMetricsCompact(testMetrics, M);
  testTyped.innerHTML = M.est ? buildFreeTypedHTML(meta.typedText, M.est) : buildTypedHTML(task.text, meta.typedText);
  testTypedLegend.innerHTML = FREE_TYPED_LEGEND;
  testTypedLegend.classList.toggle("hidden", !(M.est && M.est.marks.length));
  showTestPhase("interstitial");
}

function continueAfterTestTask() {
  testLog.push(...testPending.rows);
  testPending = null;

  if (testIdx + 1 >= testTasks.length) {
    // ---- last task done (every test already carries its own METRIC rows) ----
    showTestPhase("done");
    testDoneSummary.textContent =
      `${testLog.length} rows recorded across ${testTasks.length} tests for ` +
      `${testParticipant.fn} ${testParticipant.ln} (including ${testLog.filter((r) => r.task_type === "METRIC").length} metric rows).`;
    testCsvText = buildCsvText(testLog, TEST_CSV_HEADERS);
    testDownloadSize.textContent = formatBytes(new Blob([testCsvText]).size);
    saveTestToCloud();
  } else {
    testIdx++;
    showTestPhase("running");
    startTestTask();
  }
}
testContinueBtn.addEventListener("click", continueAfterTestTask);
testRestartBtn.addEventListener("click", () => testController.restart());

testDownloadBtn.addEventListener("click", () => {
  downloadTextFile(`pinkeys_${testParticipant.fn}_${testParticipant.ln}_${Date.now()}.csv`, testCsvText);
});

/* -------------------------------------------------------------
   SAVE ONLINE
   When the last test is done, the finished CSV is sent to the API's
   public /collect endpoint, which stores it in Supabase and folds
   this person into the model. No key is involved. If the free server
   is asleep we wake it first. A failed save can be retried, and the
   Download button always works as a fallback.
   ------------------------------------------------------------- */
const formatBytes = (n) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB");

const SAVE_LOOK = {
  saving: { color: "var(--muted)", icon: "" },
  saved:  { color: "var(--correct)", icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 12 10 18 20 6" /></svg>' },
  failed: { color: "var(--incorrect)", icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>' },
};
function setSaveStatus(state, text) {
  const look = SAVE_LOOK[state];
  testSaveStatus.style.color = look.color;
  testSaveStatus.style.borderColor = look.color;
  testSaveSpinner.classList.toggle("hidden", state !== "saving");
  testSaveIcon.classList.toggle("hidden", !look.icon);
  testSaveIcon.innerHTML = look.icon;
  testSaveText.textContent = text;
  testSaveRetry.classList.toggle("hidden", state !== "failed");
  testSaving = state === "saving";
}
let testSaving = false;
window.addEventListener("beforeunload", (e) => { if (testSaving) { e.preventDefault(); e.returnValue = ""; } });

async function saveTestToCloud(replace = testReplaceFlag) {
  if (testSaving) return;
  testSaveReplace.classList.add("hidden");
  setSaveStatus("saving", "Saving your results online…");
  try {
    await PinkeysApi.wake({ onTick: (s) => { if (s >= 3) setSaveStatus("saving", `Waking the server… ${s}s (a free server can take up to a minute)`); } });
    setSaveStatus("saving", "Saving your results online…");
    const r = await PinkeysApi.collect(testCsvText, replace);
    setSaveStatus("saved", r.duplicate ? "Already saved online." : r.replaced ? "Saved online. Your old data was replaced." : "Saved online.");
    testReplaceFlag = replace;
  } catch (err) {
    if (err.status === 401) {
      setSaveStatus("failed", "You're logged out. Log in, then press Try saving again. Your results are kept on this page.");
      PinkeysAuth.open("login");
    } else if (err.status === 409) {       // you already have data and did not tick the box (e.g. you took another test in another tab)
      setSaveStatus("failed", err.message);
      testSaveReplace.classList.remove("hidden");
    } else {
      setSaveStatus("failed", "Not saved: " + err.message + " You can still download your CSV.");
    }
  }
}
testSaveRetry.addEventListener("click", () => saveTestToCloud());
testSaveReplace.addEventListener("click", () => saveTestToCloud(true));

PinkeysApi.ping();   // wake a sleeping server while the person reads the start screen
syncTestAuth();
testAgainBtn.addEventListener("click", () => { testCsvText = ""; testPhase = "intro"; testShownFor = null; syncTestAuth(); });


/* -------------------------------------------------------------
   PAGE SHELL
   - stray-click refocuser (see practice.js for why preventDefault)
   - global Enter handler that advances the interstitial screen.
     It calls preventDefault() so the Enter keydown can't leak into
     the next task's textarea and corrupt its first keystroke.
   ------------------------------------------------------------- */
const isVisible = (el) => !el.classList.contains("hidden");

document.addEventListener("mousedown", (e) => {
  if (["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"].includes(e.target.tagName)) return;
  if (testPhase !== "running") return;
  const task = testTasks[testIdx];
  const target = task && task.type === "free" ? testFreeInput : testInput;
  e.preventDefault();
  target.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat) return;
  if (isVisible(testInterstitial)) { e.preventDefault(); continueAfterTestTask(); }
});
