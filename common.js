/* ==============================================================
   PINKEYS — common.js
   Code shared by all three pages (index.html = Practice,
   test.html = Test, identity.html = Identity). Each page loads
   this file first, then its own script (practice.js / test.js /
   identity.js).

   Contents: data pools, general helpers, keystroke engine,
   shared `$` helper + recording badge, and the typing-task
   controller.
   ============================================================== */

/* -------------------------------------------------------------
   1. DATA POOLS
   ------------------------------------------------------------- */
const WORDS = ("the of and to in a is that for it on with as was he be at by i this had not are but from or have an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still see own men work long get here between both life being under know while last might great old year off come since against go came right used take three states himself few house use during without again place around however home small found mind think say").split(" ");

const QUOTES = [
  "Discipline outlasts motivation every single time.",
  "Small steps still move you forward.",
  "What you repeat, you eventually become.",
  "Speed without accuracy is just noise.",
  "Consistency is a quiet kind of confidence.",
  "The keyboard remembers what the mind forgets.",
  "Slow hands can still finish first.",
  "Every habit was once a decision.",
  "Courage is taking the next step while still afraid.",
  "A calm mind notices what a hurried one misses.",
  "Progress is built from ordinary days done well.",
  "Patience turns small efforts into lasting results.",
  "The best time to begin is when you feel unready.",
  "Kindness costs nothing and is remembered for years.",
  "Every expert was once a beginner who kept going.",
  "Quiet persistence beats loud intention every time."
];

const SHORT_PASSAGES = [
  "The quick brown fox jumps over the lazy dog.",
  "A journey of a thousand miles begins with a single step.",
  "She sells seashells by the seashore every summer.",
  "Practice does not make perfect, practice makes permanent.",
  "The early bird catches the worm but the second mouse gets the cheese.",
  "Typing quickly is not the same as typing well.",
  "He decided to walk instead of taking the crowded jeepney.",
  "Rain fell softly on the tin roof all night long.",
  "Never underestimate the power of a good night's sleep.",
  "The old market smelled of fresh bread and ripe mangoes.",
  "A calm sea never made a skilled sailor.",
  "Every keystroke tells a small story about the person typing.",
  "The city lights flickered as the storm rolled closer.",
  "Curiosity often leads to the most unexpected discoveries.",
  "Small habits, repeated daily, eventually shape who we become.",
];

const LONG_PASSAGES = [
  "Traffic in the city had gotten worse every year, and no one seemed to agree on a single cause. Some blamed the number of new cars on the road, others pointed to construction delays that never seemed to end. Whatever the reason, commuters had learned to leave earlier and expect the worst, treating a smooth ride home as a rare and welcome surprise.",
  "Before smartphones, people memorized phone numbers, wrote letters by hand, and read paper maps folded a dozen times. It is strange to think how quickly habits can change once a new tool arrives. What once felt essential can, within a decade, feel almost unnecessary, replaced by something faster but not always better.",
  "The clinic opened its doors at seven in the morning, but patients had already been lining up since five. A nurse walked down the row handing out numbered tickets, trying to keep the queue orderly despite the growing crowd. By noon, the waiting area was full, and the staff worked through their break just to keep up.",
  "Learning to type well is less about speed and more about rhythm. A steady, even pace with fewer mistakes will almost always beat a fast but erratic one. Over time, the fingers begin to remember patterns on their own, moving before the mind consciously decides which key comes next.",
  "Water is often taken for granted until it becomes scarce or unsafe. A single contaminated well can affect an entire neighborhood within days, spreading illness quietly before anyone realizes the source. Communities that catch these problems early, through simple reporting or observation, are often able to prevent much larger outbreaks.",
];

const QUESTIONS = [
  "Describe your morning routine from waking up to leaving the house.",
  "What is a small habit you have that most people don't know about?",
  "Explain how you would spend a completely free Saturday.",
  "Describe the last meal you cooked or ordered in detail.",
  "What is something you learned recently that surprised you?",
  "Describe your commute or trip to school or work on a typical day.",
  "What would you tell your younger self about studying or working?",
  "Describe a place you visit often and why you like it.",
];

const CATEGORY_LABEL = { quote: "Quotes", short: "Short passages", long: "Long passages", free: "Written answers" };

/* -------------------------------------------------------------
   2. GENERAL HELPERS
   ------------------------------------------------------------- */
// pickN/pick1 — random sampling from the data pools above
function pickN(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}
const pick1 = (arr) => arr[Math.floor(Math.random() * arr.length)];

// mean/stdev — used throughout section 3's feature math
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

const uid = () => "S" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();

// Split a passage into words, each word INCLUDING its trailing space (if any).
// "The quick brown" -> ["The ", "quick ", "brown"]
// The trailing space is what marks the end of a word during typing, so we
// keep it attached rather than dropping it.
function splitWords(s) {
  const parts = s.match(/\S+\s*/g);
  return parts ? parts : [""];
}

// How many characters of `typed` belong to the first `n` words of `words`.
// Used to find where each word starts in the typed string.
function wordBoundaries(words) {
  const b = [0];
  for (const w of words) b.push(b[b.length - 1] + w.length);
  return b;
}

/* ---------------------------------------------------------------
   WORD-LOCKED ALIGNMENT
   Each typed word is matched ONLY against the target word at the same
   word index. Space is a hard boundary: it ends the current word, so
   missing or extra letters can never shift the words that follow.
     target "The quick brown"   typed "Th quicvkl brown"
       word 0: "Th"      vs "The"    -> T,h ok; e missed
       word 1: "quicvkl" vs "quick"  -> q,u,i,c ok; v wrong; k,l extra
       word 2: "brown"   vs "brown"  -> all correct
   --------------------------------------------------------------- */
function alignTyped(target, typed) {
  const tWords = target.split(/\s+/).filter(Boolean);
  const tokens = [...typed.matchAll(/(\S+)(\s*)/g)].map(m => ({ body: m[1], space: m[2] }));
  const endsWithSpace = /\s$/.test(typed);
  let cursorWord = 0, cursorOffset = 0;
  if (tokens.length) {
    if (endsWithSpace) { cursorWord = tokens.length; cursorOffset = 0; }
    else { cursorWord = tokens.length - 1; cursorOffset = tokens[tokens.length - 1].body.length; }
  }
  return { tWords, tokens, cursorWord, cursorOffset };
}

/* A fixed-text task is done once every target word has been reached and
   the final word is typed exactly right (no trailing space). Mistakes in
   earlier words are scored but don't block completion — and since each
   word is judged on its own, they no longer change the typed length that
   completion depends on. */
function isComplete(target, typed) {
  const { tWords, tokens } = alignTyped(target, typed);
  if (!tWords.length || tokens.length !== tWords.length) return false;
  const last = tokens[tokens.length - 1];
  return last.space === "" && last.body === tWords[tWords.length - 1];
}

function escapeChar(ch) {
  if (ch === "<") return "&lt;";
  if (ch === "&") return "&amp;";
  return ch;
}

/* CSV writing — used by the Test page both for the Download button and for the copy
   saved online (the same text, so they can never differ). The time columns hold absolute
   ms since each task's first keystroke; the API rebuilds everything it needs from them. */
const csvEsc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';

function buildCsvText(rows, headers) {
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEsc(r[h])).join(","));
  return lines.join("\n");
}

function downloadTextFile(filename, text, mime = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* -------------------------------------------------------------
   3. KEYSTROKE ENGINE
   makeLogger()      records raw keydown/keyup timestamps, each
                     stamped as elapsed ms since logger.start() —
                     NOTE: start() is now called lazily, on the
                     first real keystroke, not when a task appears
                     on screen (see section 5's "lazy start" fix).
   computeFeatures() turns raw events into dwell/flight/DD/UU
                     averages, WPM, backspace rate, consistency.
                     Expects events[].t as an absolute, increasing
                     clock within one task — this is unrelated to
                     the CSV's delta-based time_ms column, which
                     only affects the exported file format, not
                     this in-memory computation.
   ------------------------------------------------------------- */
function makeLogger() {
  let events = [], t0 = null, down = new Set();
  return {
    start() { events = []; t0 = performance.now(); down = new Set(); },
    onKeydown(e) {
      if (t0 === null || down.has(e.key)) return;
      down.add(e.key);
      events.push({ key: e.key, type: "down", t: +(performance.now() - t0).toFixed(2), ctrl: !!e.ctrlKey });
    },
    onKeyup(e) {
      if (t0 === null) return;
      down.delete(e.key);
      events.push({ key: e.key, type: "up", t: +(performance.now() - t0).toFixed(2) });
    },
    stop() { t0 = null; return events; },
    snapshot() { return events.slice(); },   // events so far, without stopping (for live identification)
  };
}

// How many times Backspace was pressed, and how many of those were Ctrl+Backspace (delete a whole word).
// A held-down key counts once (the logger ignores auto-repeat). The two counts are separate: plain + Ctrl = total.
function countBackspaces(events) {
  let backspaces = 0, ctrlBackspaces = 0;
  for (const ev of events) {
    if (ev.type !== "down" || ev.key !== "Backspace") continue;
    if (ev.ctrl) ctrlBackspaces++; else backspaces++;
  }
  return { backspaces, ctrlBackspaces };
}

// Every metric for one finished task, in one place. `target` is the pre-generated text,
// or "" for a free-type text.
//  pre-generated: words / letters = how many the passage has.
//  free-type:     letter counts and accuracy are spellcheck ESTIMATES, and words / letters are
//                 counted on the text AFTER correction (what the spellchecker decided you meant).
function taskMetrics(events, meta, target) {
  const base = { backspaces: meta.backspaces, ctrlBackspaces: meta.ctrlBackspaces, consistency: meta.consistency };
  if (target) {
    return { ...base, kind: "pre-generated", est: null,
      wpm: meta.wpm, rawWpm: meta.rawWpm, accuracy: meta.accuracy,
      correct: meta.correct, incorrect: meta.incorrect, extra: meta.extra, missed: meta.missed,
      totalWords: target.trim().split(/\s+/).filter(Boolean).length,
      totalLetters: (target.match(/[A-Za-z]/g) || []).length };
  }
  const est = estimateFreeText(meta.typedText);
  const minutes = Math.max(meta.durationMs, 1) / 60000;
  return { ...base, kind: "free-type", est,
    wpm: meta.wpm, rawWpm: +((meta.typedText.length / 5) / minutes).toFixed(1),
    accuracy: est.accuracy != null ? est.accuracy : 0,
    correct: est.correct, incorrect: est.incorrect, extra: est.extra, missed: est.missed,
    totalWords: est.totalWords, totalLetters: est.totalLetters };
}

// Small label + value tiles (no descriptions) for the Test page's "Task complete" screen.
function renderMetricsCompact(el, M) {
  const items = [
    ["WPM", M.wpm], ["Raw WPM", M.rawWpm], ["Accuracy", M.accuracy + "%"], ["Consistency", Math.round(M.consistency) + "%"],
    ["Correct", M.correct], ["Incorrect", M.incorrect], ["Extra", M.extra], ["Missed", M.missed],
    ["Backspaces", M.backspaces], ["Ctrl+Backspaces", M.ctrlBackspaces], ["Words", M.totalWords], ["Letters", M.totalLetters],
  ];
  el.innerHTML = items.map(([label, value]) =>
    `<div class="border border-[var(--border)] rounded-lg px-2 py-1.5 text-center">` +
    `<div class="mono text-base text-[var(--ink)] leading-tight">${value}</div>` +
    `<div class="text-[11px] text-[var(--muted)] leading-tight mt-0.5">${label}</div></div>`).join("");
}

function computeFeatures(events, taskStats = null) {
  // pair each "down" with the next "up" of the same key -> one completed press
  const pending = {};
  const presses = [];
  for (const ev of events) {
    if (ev.type === "down") pending[ev.key] = ev.t;
    else if (pending[ev.key] != null) {
      presses.push({ key: ev.key, down: pending[ev.key], up: ev.t, dwell: ev.t - pending[ev.key] });
      delete pending[ev.key];
    }
  }
  presses.sort((a, b) => a.down - b.down);

  // dwell = how long a key was held; flight/DD/UU = gaps between consecutive presses
  const dwell = presses.map((p) => p.dwell);
  const flight = [], dd = [], uu = [];
  for (let i = 1; i < presses.length; i++) {
    flight.push(presses[i].down - presses[i - 1].up);
    dd.push(presses[i].down - presses[i - 1].down);
    uu.push(presses[i].up - presses[i - 1].up);
  }

  const backspaces = presses.filter((p) => p.key === "Backspace").length;
  const total = presses.length || 1;
  const durationMs = presses.length ? presses[presses.length - 1].up - presses[0].down : 0;
  const wpm = durationMs > 0 ? ((total - backspaces) / 5) / (durationMs / 60000) : 0;

  return {
    n: presses.length, meanDwell: mean(dwell), stdDwell: stdev(dwell),
    meanFlight: mean(flight), meanDD: mean(dd), meanUU: mean(uu),
    backspaceRate: backspaces / total, wpm, durationMs,
    consistency: dwell.length ? Math.max(0, 100 * (1 - stdev(dwell) / (mean(dwell) || 1))) : 0,

    // Fixed-text-only stats, threaded in from the test/identity controllers.
    // null means "not applicable" (free-text task, or live sample that didn't
    // record these) — the distance metric skips nulls pairwise.
    accuracy:  taskStats ? taskStats.accuracy  : null,
    correct:   taskStats ? taskStats.correct   : null,
    incorrect: taskStats ? taskStats.incorrect : null,
    extra:     taskStats ? taskStats.extra     : null,
    missed:    taskStats ? taskStats.missed    : null,
  };
}

/* -------------------------------------------------------------
   4. SHARED DOM
   Per-page element references now live in each page's own script.
   ------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

// recording badge (present on every page — only one task is ever live)
const recBadge = $("recBadge");
const recBadgeTime = $("recBadgeTime");

/* -------------------------------------------------------------
   5. TYPING TASK CONTROLLER
   One controller instance is created per page (practice/test/
   identity) and wires its listeners exactly once, since the DOM
   elements are static and never get torn down. Each new task
   just calls .start(target, free, onDone) again.

   This section is where all four recently-reported fixes live:

   FIX 1 — "timer starts right away": logger.start() used to run
   the moment a task appeared. Now it's deferred to the first real
   keydown (see handleFirstKey(e)), so elapsed time — and every
   downstream WPM/duration number — is measured from the first
   keystroke, not from when the passage was displayed.

   FIX 3 — "show a recording timer": handleFirstKey(e) also pops
   the fixed top-right badge (#recBadge) and starts a 200ms
   interval repainting its mm:ss readout; finish()/begin() stop
   that interval and hide the badge again.

   FIX 2 ("Enter leaks into the next task") and FIX 4 ("store the
   gap between actions, not a running clock") are handled outside
   this section — see the global keydown listener in section 9 for
   fix 2, and onTestTaskDone() in section 7 for fix 4 — but both
   exist *because* of how this controller hands events off, so
   they're noted here too.
   ------------------------------------------------------------- */
function buildStageHTML(target, typed) {
  const { tWords, tokens, cursorWord, cursorOffset } = alignTyped(target, typed);
  const span = (cls, ch) => `<span class="ch ${cls}">${escapeChar(ch)}</span>`;
  let html = "";
  let caretPlaced = false;

  for (let w = 0; w < tWords.length; w++) {
    const tWord = tWords[w];
    const tok = tokens[w];                         // what was typed for THIS word only
    const body = tok ? tok.body : "";
    const finished = !!tok && tok.space.length > 0; // space pressed = word is locked in

    // Target letters: colored by the typed letter in the same slot of this word.
    for (let i = 0; i < tWord.length; i++) {
      let cls;
      if (i < body.length) cls = body[i] === tWord[i] ? "ch-correct" : "ch-incorrect";
      else cls = finished ? "ch-missed" : "ch-pending";   // skipped letters stay inside this word
      if (w === cursorWord && i === cursorOffset) { cls += " ch-current"; caretPlaced = true; }
      html += span(cls, tWord[i]);
    }

    // Extra letters stay inside this word's slot too — they never push into the next word.
    for (let j = tWord.length; j < body.length; j++) html += span("ch-extra", body[j]);

    // The space between words.
    if (w < tWords.length - 1) {
      let cls = finished ? "ch-correct" : "ch-pending";
      if (w === cursorWord && cursorOffset >= tWord.length) { cls += " ch-current"; caretPlaced = true; }
      html += span(cls, " ");
    }
  }

  // Whole extra words typed past the end of the passage.
  for (let w = tWords.length; w < tokens.length; w++) {
    html += [...tokens[w].body].map(c => span("ch-extra", c)).join("");
    if (tokens[w].space) html += span("ch-extra", " ");
  }

  // Caret after the final character (last word fully typed, or past the end).
  if (!caretPlaced) html += span("ch-current", "\u200b");
  return html;
}

// What the person actually typed, for the results screens.
//  - fixed passage: only the typed letters, colored against the passage
//    (correct / incorrect / extra). Skipped letters aren't shown, because
//    they weren't typed.
//  - free text (empty target): the text exactly as typed.
function buildTypedHTML(target, typed) {
  if (!typed) return "";
  if (!target) return [...typed].map(escapeChar).join("");
  const { tWords, tokens } = alignTyped(target, typed);
  const span = (cls, ch) => `<span class="${cls}">${escapeChar(ch)}</span>`;
  let html = "";
  for (let w = 0; w < tokens.length; w++) {
    const tWord = tWords[w] || "";
    const body = tokens[w].body;
    for (let i = 0; i < body.length; i++) {
      let cls = "ch-extra";
      if (i < tWord.length) cls = body[i] === tWord[i] ? "ch-correct" : "ch-incorrect";
      html += span(cls, body[i]);
    }
    html += [...tokens[w].space].map(escapeChar).join("");
  }
  return html;
}

// Free-type text with the spellchecker's findings marked in place, like a pre-generated test:
//   wrong letter -> red + underlined | extra letter -> purple | missing letter -> gray + struck through
// Correct text is left plain. `est` is the result of estimateFreeText(text).
function buildFreeTypedHTML(text, est) {
  const esc = (s) => [...s].map(escapeChar).join("");
  const span = (cls, ch) => `<span class="${cls}">${escapeChar(ch)}</span>`;
  const isTokenChar = (ch) => /[A-Za-z0-9'\u2019]/.test(ch);
  let html = "", pos = 0;
  for (const mk of (est && est.marks) || []) {
    html += esc(text.slice(pos, mk.start));
    const ops = mk.ops;
    let o = 0;
    const flushMissed = () => { while (o < ops.length && ops[o].t === "m") html += span("ch-missed", ops[o++].ch); };
    for (const ch of text.slice(mk.start, mk.end)) {
      if (!isTokenChar(ch)) { flushMissed(); html += escapeChar(ch); continue; }   // a space between merged words
      flushMissed();
      const op = ops[o++];
      html += !op || op.t === "c" ? escapeChar(ch) : span(op.t === "i" ? "ch-incorrect" : "ch-extra", ch);
    }
    flushMissed();
    pos = mk.end;
  }
  return html + esc(text.slice(pos));
}

// Small key for the colors above (shown only when a free-type text has mistakes).
const FREE_TYPED_LEGEND =
  `<span class="ch-incorrect">Red</span> wrong letter &middot; <span class="ch-extra">purple</span> extra letter &middot; ` +
  `<span class="ch-missed">gray</span> missing letter &mdash; estimated by the spellchecker`;

// --- shared recording badge, used by every controller instance ---
let recTimerHandle = null;
let recStartPerf = null;
function showRecBadge() {
  recStartPerf = performance.now();
  recBadge.classList.remove("hidden");
  paintRecBadge();
  recTimerHandle = setInterval(paintRecBadge, 200);
}
function paintRecBadge() {
  const totalSec = Math.floor((performance.now() - recStartPerf) / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  recBadgeTime.textContent = `${mm}:${ss}`;
}
function hideRecBadge() {
  if (recTimerHandle) clearInterval(recTimerHandle);
  recTimerHandle = null;
  recBadge.classList.add("hidden");
}

function createTypingTaskController(opts) {
  const { stageEl, inputEl, freeInputEl, freeControlsEl, freeNextBtn, freeHintEl, fixedWrapEl, restartBtn, minFreeChars = 40,
          onProgress, progressEvery = 20 } = opts;   // onProgress(events): called every `progressEvery` key presses while typing
  const logger = makeLogger();
  let target = "";
  let free = false;
  let typed = "";
  let done = false;
  let started = false; // becomes true on the first real keystroke (FIX 1)
  let onDoneCb = null;

  function renderFixed() { stageEl.innerHTML = buildStageHTML(target, typed); }

  function updateFreeUI() {
    const trimmed = typed.trim();
    const ok = trimmed.length >= minFreeChars;
    freeNextBtn.disabled = !ok;
    freeHintEl.textContent = ok ? "Ready \u2014 press Enter to finish." : `${trimmed.length} / ${minFreeChars} characters (Enter finishes once you reach the minimum)`;
  }

  // FIX 1 + FIX 3 — don't start the clock/logger/badge until the person
  // actually presses a LETTER key. Modifiers (Shift, Ctrl, Alt, Meta),
  // navigation keys (Tab, Enter, arrows), space, digits, and symbols are
  // ignored as triggers — the clock only begins once real typing starts.
  // After that first letter, everything is recorded as usual.
  function handleFirstKey(e) {
    if (started) return;
    if (!/^[a-zA-Z]$/.test(e.key)) return; // not a letter — don't start yet
    started = true;
    logger.start();
    showRecBadge();
  }

  function finish() {
    if (done) return;
    done = true;
    hideRecBadge();
    const events = logger.stop();
    const f = computeFeatures(events);

    let meta = {
      durationMs: events.length ? events[events.length - 1].t : 0,
      typedText: typed,
      ...countBackspaces(events),
      wpm: +f.wpm.toFixed(1),
      consistency: +f.consistency.toFixed(1),
      correct: null, incorrect: null, extra: null, missed: null, accuracy: null,
    };

    if (!free) {
          let correct = 0, incorrect = 0, extra = 0, missed = 0;
          // Same word-locked alignment as the on-screen stage: each typed
          // word is only compared with the target word at its own index.
          const { tWords, tokens } = alignTyped(target, typed);
          for (let w = 0; w < tWords.length; w++) {
            const t = tWords[w];
            const c = tokens[w] ? tokens[w].body : "";
            const n = Math.max(t.length, c.length);
            for (let i = 0; i < n; i++) {
              if (i >= c.length) missed++;
              else if (i >= t.length) extra++;
              else if (c[i] === t[i]) correct++;
              else incorrect++;
            }
            // the separating space counts as a correct keystroke
            if (tokens[w] && tokens[w].space) {
              if (w < tWords.length - 1) correct += 1; else extra += tokens[w].space.length;
              if (w < tWords.length - 1) extra += tokens[w].space.length - 1;
            }
          }
          for (let w = tWords.length; w < tokens.length; w++) {
            extra += tokens[w].body.length + tokens[w].space.length;
          }
      const minutes = Math.max(meta.durationMs, 1) / 60000;
      meta = {
        ...meta,
        correct, incorrect, extra, missed,
        accuracy: typed.length ? +(100 * correct / typed.length).toFixed(1) : 0,
        wpm: +((correct / 5) / minutes).toFixed(1),
        rawWpm: +((typed.length / 5) / minutes).toFixed(1),
      };
    }
    onDoneCb && onDoneCb(events, meta);
  }

  // (re)initializes the task's visible state; does NOT start the
  // logger/timer/badge — that only happens on the first keystroke now
  let downCount = 0;
  function notifyProgress() {
    if (onProgress && ++downCount % progressEvery === 0) onProgress(logger.snapshot());
  }

  function begin() {
    downCount = 0;
    typed = "";
    done = false;
    started = false;
    logger.stop();
    hideRecBadge();
    if (free) {
      if (fixedWrapEl) fixedWrapEl.classList.add("hidden");
      freeInputEl.classList.remove("hidden");
      freeControlsEl.classList.remove("hidden");
      freeInputEl.value = "";
      updateFreeUI();
    } else {
      if (fixedWrapEl) fixedWrapEl.classList.remove("hidden");
      if (freeInputEl) freeInputEl.classList.add("hidden");
      if (freeControlsEl) freeControlsEl.classList.add("hidden");
      inputEl.value = "";
      renderFixed();
    }
    (free ? freeInputEl : inputEl).focus();
  }

  function start(newTarget, isFree, cb) {
    target = newTarget || "";
    free = !!isFree;
    onDoneCb = cb;
    begin();
  }

  function restart() { begin(); }

    inputEl.addEventListener("keydown", (e) => {
    // Tab jumps to the Restart button instead of leaving the page (the typing
    // box is the last focusable element, so without this Tab lands in the
    // browser's URL bar and Enter would reload the page).
    if (e.key === "Tab" && restartBtn) {
      e.preventDefault();
      restartBtn.focus();
      return;
    }
    // Before the timer has started, only a letter may begin the task.
    // Anything else is swallowed entirely — no timer, no character in the
    // field — so a stray Space/Enter/Shift can't corrupt the passage.
    if (!started && !/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      return;
    }
    // Space only advances a word that has at least one letter; a stray
    // space on an empty word is ignored so it can't skip a word.
    if (e.key === " " && (typed === "" || /\s$/.test(typed))) {
      e.preventDefault();
      return;
    }
    handleFirstKey(e);
    logger.onKeydown(e);
    notifyProgress();
  });
  inputEl.addEventListener("keyup", (e) => logger.onKeyup(e));
  inputEl.addEventListener("input", (e) => {
    typed = e.target.value;
    renderFixed();
    if (isComplete(target, typed)) finish();
  });

  if (freeInputEl) {
    freeInputEl.addEventListener("keydown", (e) => {
    // Tab jumps to the Restart button instead of leaving the page (the typing
    // box is the last focusable element, so without this Tab lands in the
    // browser's URL bar and Enter would reload the page).
    if (e.key === "Tab" && restartBtn) {
      e.preventDefault();
      restartBtn.focus();
      return;
    }
    // Enter finishes a free-type text (once it is long enough). Shift+Enter still adds a line break.
    // stopPropagation keeps this same Enter from also triggering a page-level "Enter = continue".
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (typed.trim().length >= minFreeChars) finish();
      return;
    }
      if (!started && !/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        return;
      }
      handleFirstKey(e);
      logger.onKeydown(e);
      notifyProgress();
    });
    freeInputEl.addEventListener("keyup", (e) => logger.onKeyup(e));
    freeInputEl.addEventListener("input", (e) => { typed = e.target.value; updateFreeUI(); });
    freeNextBtn.addEventListener("click", () => finish());
  }

  return { start, restart };
}

