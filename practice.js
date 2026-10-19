/* ==============================================================
   PINKEYS — practice.js
   Practice page: free typing practice with mode switcher. Nothing is saved.
   Requires common.js (loaded first in the HTML).
   ============================================================== */

/* -------------------------------------------------------------
   DOM REFERENCES
   ------------------------------------------------------------- */
// practice tab
const practiceControls = $("practiceControls");
const wcDivider = $("wcDivider");
const wordCountGroup = $("wordCountGroup");
const practiceRestartBtn = $("practiceRestart");
const practiceTask = $("practiceTask");
const practiceStage = $("practiceStage");
const practiceInput = $("practiceInput");
const practiceFixedWrap = $("practiceFixedWrap");
const practiceFixedHint = $("practiceFixedHint");
const practiceFreeInput = $("practiceFreeInput");
const practiceFreeControls = $("practiceFreeControls");
const practiceFreeNext = $("practiceFreeNext");
const practiceFreeHint = $("practiceFreeHint");
const pTyped = $("pTyped");
const pTypedLegend = $("pTypedLegend");
const pBreakdown = $("pBreakdown");
const pBreakdownNote = $("pBreakdownNote");
const pBreakdownBody = $("pBreakdownBody");
const pUnchecked = $("pUnchecked");
const practiceResult = $("practiceResult");
const practiceAgainBtn = $("practiceAgain");
const pStat = {
  wpm: $("pWpm"), rawWpm: $("pRawWpm"), accuracy: $("pAccuracy"), consistency: $("pConsistency"),
  correct: $("pCorrect"), incorrect: $("pIncorrect"), extra: $("pExtra"), missed: $("pMissed"),
  backspaces: $("pBackspaces"), ctrlBackspaces: $("pCtrlBackspaces"),
  words: $("pWords"), letters: $("pLetters"), wordsDesc: $("pWordsDesc"), lettersDesc: $("pLettersDesc"),
};

/* -------------------------------------------------------------
   6. PRACTICE TAB
   Free typing practice — nothing is saved. Mode switcher picks
   which pool practiceTarget() draws from; word-count pills only
   apply in "words" mode. The "active" look on mode/word-count
   pills is just two small Tailwind class lists swapped in and
   out (setPillActive) — no custom CSS class needed for that state.
   ------------------------------------------------------------- */
const WORD_COUNTS = [10, 25, 50];
let practiceMode = "words";
let practiceWordCount = 25;

// Tailwind classes for a pill button's selected vs. unselected look
const PILL_ON = ["bg-[var(--ink)]", "text-white", "border-[var(--ink)]"];
const PILL_OFF = ["border-[var(--border)]", "text-[var(--muted)]"];
function setPillActive(btn, active) {
  if (active) { btn.classList.remove(...PILL_OFF); btn.classList.add(...PILL_ON); }
  else { btn.classList.remove(...PILL_ON); btn.classList.add(...PILL_OFF); }
}

function practiceTarget() {
  if (practiceMode === "words") return pickN(WORDS, practiceWordCount).join(" ");
  if (practiceMode === "quote") return pick1(QUOTES);
  if (practiceMode === "short") return pick1(SHORT_PASSAGES);
  return pick1(LONG_PASSAGES);
}

const practiceController = createTypingTaskController({
  stageEl: practiceStage, inputEl: practiceInput, restartBtn: practiceRestartBtn,
  freeInputEl: practiceFreeInput, freeControlsEl: practiceFreeControls,
  freeNextBtn: practiceFreeNext, freeHintEl: practiceFreeHint,
  fixedWrapEl: practiceFixedWrap, minFreeChars: 10,
});

function startPracticeTask() {
  practiceTask.classList.remove("hidden");
  practiceResult.classList.add("hidden");
  pBreakdown.classList.add("hidden");
  const free = practiceMode === "free";
  practiceTargetText = free ? "" : practiceTarget();
  practiceFixedHint.classList.toggle("hidden", free);
  practiceController.start(practiceTargetText, free, onPracticeDone);
}

let practiceTargetText = "";   // the passage being typed (empty in free mode)

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Fill the stat boxes from one task's metrics (see taskMetrics in common.js).
function showPracticeMetrics(M) {
  pStat.wpm.textContent = M.wpm;
  pStat.rawWpm.textContent = M.rawWpm;
  pStat.accuracy.textContent = M.accuracy + "%";
  pStat.consistency.textContent = Math.round(M.consistency) + "%";
  pStat.correct.textContent = M.correct;
  pStat.incorrect.textContent = M.incorrect;
  pStat.extra.textContent = M.extra;
  pStat.missed.textContent = M.missed;
  pStat.backspaces.textContent = M.backspaces;
  pStat.ctrlBackspaces.textContent = M.ctrlBackspaces;
  pStat.words.textContent = M.totalWords;
  pStat.letters.textContent = M.totalLetters;
  const free = M.kind === "free-type";
  pStat.wordsDesc.textContent = free ? "Words after spellcheck" : "Words in the passage";
  pStat.lettersDesc.textContent = free ? "Letters after spellcheck" : "Letters in the passage";
}

// Free type: also show a word-by-word table of every correction the checker made.
function showFreeBreakdown(est) {
  pBreakdownNote.textContent =
    `Estimated from spelling, in letters. ${est.checked} word${est.checked === 1 ? "" : "s"} checked, ` +
    `${est.flagged} corrected, ${est.unchecked} skipped.`;
  pBreakdownBody.innerHTML = est.details.length
    ? est.details.map((d) => `
      <tr class="border-b border-[var(--border)]">
        <td class="py-2 pr-4 mono">${escHtml(d.word)}</td>
        <td class="py-2 pr-4 mono">${escHtml(d.guess)}</td>
        <td class="py-2 pr-4 mono">${d.correct}</td>
        <td class="py-2 pr-4 mono">${d.incorrect}</td>
        <td class="py-2 pr-4 mono">${d.extra}</td>
        <td class="py-2 pr-4 mono">${d.missed}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="py-3 text-[var(--muted)]">No misspelled words found.</td></tr>`;
  pUnchecked.textContent = est.uncheckedWords.length
    ? "Skipped: " + est.uncheckedWords.map((u) => `${u.word} (${u.why})`).join(", ")
    : "";
  pUnchecked.classList.toggle("hidden", !est.uncheckedWords.length);
  pBreakdown.classList.remove("hidden");
}

function onPracticeDone(events, meta) {
  const M = taskMetrics(events, meta, practiceTargetText);
  // pre-generated: typed letters colored against the passage; free-type: your text with spelling mistakes marked
  pTyped.innerHTML = M.est ? buildFreeTypedHTML(meta.typedText, M.est) : buildTypedHTML(practiceTargetText, meta.typedText);
  pTypedLegend.innerHTML = FREE_TYPED_LEGEND;
  pTypedLegend.classList.toggle("hidden", !(M.est && M.est.marks.length));
  showPracticeMetrics(M);
  if (M.est) showFreeBreakdown(M.est);
  practiceTask.classList.add("hidden");
  practiceResult.classList.remove("hidden");
}

// mode pills: Random words / Quote / Short text / Long text
practiceControls.querySelectorAll("[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    practiceControls.querySelectorAll("[data-mode]").forEach((b) => setPillActive(b, false));
    setPillActive(btn, true);
    practiceMode = btn.dataset.mode;
    const showWordCount = practiceMode === "words";
    wcDivider.classList.toggle("hidden", !showWordCount);
    wordCountGroup.classList.toggle("hidden", !showWordCount);
    startPracticeTask();
  });
});
// word-count pills: only meaningful in "words" mode
wordCountGroup.querySelectorAll("[data-wc]").forEach((btn) => {
  btn.addEventListener("click", () => {
    wordCountGroup.querySelectorAll("[data-wc]").forEach((b) => setPillActive(b, false));
    setPillActive(btn, true);
    practiceWordCount = +btn.dataset.wc;
    startPracticeTask();
  });
});
practiceRestartBtn.addEventListener("click", () => practiceController.restart());
practiceAgainBtn.addEventListener("click", startPracticeTask);


/* -------------------------------------------------------------
   PAGE SHELL
   Clicking anywhere on the card (not on a real control) refocuses
   the typing field. preventDefault() on mousedown stops the
   browser's own blur from undoing the refocus.
   ------------------------------------------------------------- */
document.addEventListener("mousedown", (e) => {
  if (["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"].includes(e.target.tagName)) return;
  if (practiceTask.classList.contains("hidden")) return;
  e.preventDefault();
  (practiceMode === "free" ? practiceFreeInput : practiceInput).focus();
});

// initial content
startPracticeTask();
