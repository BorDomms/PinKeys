/* ==============================================================
   PINKEYS — test.js
   Test page: enrollment battery + CSV export.
   Requires common.js (loaded first in the HTML).
   ============================================================== */

/* -------------------------------------------------------------
   DOM REFERENCES
   ------------------------------------------------------------- */
// test tab
const testIntro = $("testIntro");
const testFirstName = $("testFirstName");
const testLastName = $("testLastName");
const testNickname = $("testNickname");
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

let testPhase = "intro"; // intro | running | interstitial | done
let testParticipant = { fn: "", ln: "", nn: "" };
let testTasks = [];
let testIdx = 0;
let testLog = [];
let testPending = null;
let testSessionId = null;

const testController = createTypingTaskController({
  stageEl: testStage, inputEl: testInput,
  freeInputEl: testFreeInput, freeControlsEl: testFreeControls,
  freeNextBtn: testFreeNext, freeHintEl: testFreeHint,
  fixedWrapEl: testFixedWrap, restartBtn: testRestartBtn, minFreeChars: 40,
});

function showTestPhase(phase) {
  testPhase = phase;
  testIntro.classList.toggle("hidden", phase !== "intro");
  testRunning.classList.toggle("hidden", phase !== "running");
  testInterstitial.classList.toggle("hidden", phase !== "interstitial");
  testDone.classList.toggle("hidden", phase !== "done");
}

// "Begin test" only enables once both name fields are filled in
function updateTestBeginState() {
  testBeginBtn.disabled = !(testFirstName.value.trim() && testLastName.value.trim());
}
testFirstName.addEventListener("input", updateTestBeginState);
testLastName.addEventListener("input", updateTestBeginState);

testBeginBtn.addEventListener("click", () => {
  testParticipant = { fn: testFirstName.value.trim(), ln: testLastName.value.trim(), nn: testNickname.value.trim() };
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
  } else {
    testIdx++;
    showTestPhase("running");
    startTestTask();
  }
}
testContinueBtn.addEventListener("click", continueAfterTestTask);
testRestartBtn.addEventListener("click", () => testController.restart());

testDownloadBtn.addEventListener("click", () => {
  const headers = ["session_id", "first_name", "last_name", "nickname", "date_recorded", "task_type", "task_index", "passage_text", "key", "keydown_time", "keyup_time", "dwell", "flight", "value", "category", "test_kind"];
  downloadCsv(`pinkeys_${testParticipant.fn}_${testParticipant.ln}_${Date.now()}.csv`, testLog, headers);
});
testAgainBtn.addEventListener("click", () => {
  testFirstName.value = ""; testLastName.value = ""; testNickname.value = "";
  updateTestBeginState();
  showTestPhase("intro");
});


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
