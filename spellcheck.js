/* ==============================================================
   PINKEYS — spellcheck.js
   Estimates correct / incorrect / extra / missed LETTERS for a
   free-text (written) answer, where there is no fixed passage to
   compare against. Requires dictionary.js (loaded first).

   CONTEXT-AWARE: corrections are chosen for the whole sentence at
   once (a "noisy channel" model), not one word at a time.

     cost of a reading = edit cost  (how far the typed letters are
                                     from the intended words)
                       + language cost (how unlikely the intended
                                     words are in that order, from
                                     the bundled word-pair data)

   The cheapest reading wins (Viterbi search). Each typed word that
   isn't in the dictionary can be read as:
     - a nearby word (up to 1-3 edits depending on length; a swap
       of two neighbouring letters counts as ONE edit)
     - two words run together          "goingon"    -> going on
   and each pair of neighbouring words can have its space moved:
                                        "goin gnon"  -> going on
   Letters are then compared against the winning reading, and the
   space is ignored, so a misplaced space isn't a letter error:
     letter matches             -> correct
     letter swapped             -> incorrect
     letter typed, not intended -> extra
     letter intended, not typed -> missed

   Words that are in the dictionary are trusted as typed (this does
   NOT catch real-word mistakes like "their" for "there"). Names
   (capitalised mid-sentence), numbers, apostrophe words and words
   with nothing close are "unchecked": left out of every count.

   These are ESTIMATES, which is why test.js keeps them in separate
   free_* rows and out of the Identity ranking.

   TUNING: the constants just below are the knobs.
   ============================================================== */
const SPELL = (() => {
  // ---- tuning knobs (costs are in "nats": bigger = less likely) ----
  const EDIT = 11.0;      // cost of one edit (insert / delete / swap / wrong key); higher = trust what was typed more
  const SPACE_MAX_EDITS = 1.5;  // a moved / merged space is only believed if the letters need at most ~1 other edit
  const EXTRA_COST = 1.3; // an unexplained EXTRA letter (vs. 1.0 for a missing one): people drop letters more than they add random ones
  const EDIT_POW = 1.0;   // >1 makes several mistakes in one word much less likely than one
  const SHIFT_PEN = 10.0; // extra cost when a space is moved between two words
  const SPLIT_PEN = 8.0;  // extra cost when one typed word is read as two ("goingon" -> "going on")
  const MERGE_PEN = 10.0; // extra cost when two typed words are read as one ("ca' t" -> "can't")
  const SKIP_PEN = 40;    // cost of giving up on a word nothing else can explain (it is then left unchecked)
  const LAMBDA = 0.7;     // weight of the word-pair data vs. plain word frequency
  const UNI_W = 1.0;      // how much plain word frequency counts (lower = rarer words get a fairer chance)
  const LM_WEIGHT = 1.0;  // how much the language model counts against edit cost
  const SUB_NEAR = 0.8;   // wrong letter on a neighbouring key (in edits)
  const SUB_FAR = 1.2;    // wrong letter on a distant key (in edits)
  const TRANSPOSE = 0.8;  // cost of swapping two neighbouring letters (in edits); a very common slip

  // Words the bundled dictionary lacks but you want treated as correct. Add your own,
  // lowercase, separated by spaces (names of places, local terms, jargon...).
  const EXTRA_WORDS = "sunday monday tuesday wednesday thursday friday saturday " +
    "january february march april june july august september october november december " +
    "jeepney jeepneys okay email online website wifi";

  // Contractions are real words. They are stored with the apostrophe, so a slip inside one
  // ("ca' t", "dont", "cant't") is corrected like any other word.
  const CONTRACTIONS = ("can't don't won't isn't aren't wasn't weren't didn't doesn't hasn't haven't hadn't " +
    "couldn't wouldn't shouldn't mustn't needn't shan't ain't i'm i've i'll i'd you're you've you'll you'd " +
    "he's she's it's that's there's here's what's who's let's how's where's when's why's we're we've we'll we'd " +
    "they're they've they'll they'd he'll she'll he'd she'd it'll that'll there'll who'll y'all o'clock ma'am " +
    "could've would've should've must've might've who've what're").split(" ");

  // ---- load dictionary + language model ----
  const words = DICT_WORDS.split(" ");
  const baseCount = words.length;
  const idx = new Map();
  words.forEach((w, i) => idx.set(w, i));
  for (const w of EXTRA_WORDS.split(/\s+/)) if (w && !idx.has(w)) { idx.set(w, words.length); words.push(w); }

  const uniCost = [];                                        // -ln P(word)
  for (let i = 0; i < baseCount; i++) uniCost.push(parseInt(DICT_UNI[i], 36) / 2);
  for (let i = baseCount; i < words.length; i++) uniCost.push(12);  // extra words: moderately rare
  for (const w of CONTRACTIONS) if (!idx.has(w)) { idx.set(w, words.length); words.push(w); uniCost.push(6.5); }

  // Contractions have no word-pair data of their own, so they borrow it from their first word:
  // "don't" is treated like "do" when looking up what usually comes before / after it.
  const ROOTS = ("don't:do can't:can won't:will isn't:is aren't:are wasn't:was weren't:were didn't:did doesn't:does " +
    "hasn't:has haven't:have hadn't:had couldn't:could wouldn't:would shouldn't:should mustn't:must needn't:need " +
    "shan't:shall ain't:is i'm:am i've:have i'll:will i'd:would you're:are you've:have you'll:will you'd:would " +
    "he's:is she's:is it's:is that's:is there's:is here's:is what's:is who's:is let's:let how's:is where's:is " +
    "when's:is why's:is we're:are we've:have we'll:will we'd:would they're:are they've:have they'll:will " +
    "they'd:would he'll:will she'll:will he'd:would she'd:would it'll:will that'll:will there'll:will who'll:will " +
    "could've:could would've:would should've:should must've:must might've:might who've:have what're:are").split(" ");
  const proxy = [];
  for (const pair of ROOTS) {
    const [c, r] = pair.split(":");
    if (idx.has(c) && idx.has(r)) proxy[idx.get(c)] = idx.get(r);
  }

  // add a word on the fly (used for possessives like "dog's"); returns its index
  function addWord(w, cost) {
    if (idx.has(w)) return idx.get(w);
    idx.set(w, words.length); words.push(w); uniCost.push(cost);
    return words.length - 1;
  }
  const bi = new Map();                                      // (prev*131072 + word) -> -ln P(word | prev)
  for (const g of DICT_BIGRAMS.split(";")) {
    const prevIdx = parseInt(g.slice(0, 4), 36);
    for (let p = 4; p + 5 <= g.length; p += 5) {
      bi.set(prevIdx * 131072 + parseInt(g.slice(p, p + 4), 36), parseInt(g[p + 4], 36) / 2.5);
    }
  }

  const byLen = [];
  words.forEach((w, i) => { (byLen[w.length] = byLen[w.length] || []).push(i); });

  // cost of `wi` following `prev` (prev = -1 at the start of a sentence)
  function lmCost(wi, prev) {
    const u = uniCost[wi] * UNI_W;
    if (prev < 0) return u;
    const pp = proxy[prev] !== undefined ? proxy[prev] : prev;
    const wp = proxy[wi] !== undefined ? proxy[wi] : wi;
    let p = (1 - LAMBDA) * Math.exp(-u);
    const q = bi.get(pp * 131072 + wp);
    if (q !== undefined) p += LAMBDA * Math.exp(-(q + (wp !== wi ? 1 : 0)));   // a contraction is a bit rarer than its root
    return -Math.log(p);
  }

  // ---- bounded Damerau-Levenshtein (a swap of neighbours = 1 edit) ----
  const R0 = new Int32Array(48), R1 = new Int32Array(48), R2 = new Int32Array(48);
  function dl(a, b, max) {
    const n = a.length, m = b.length;
    if (n - m > max || m - n > max) return max + 1;
    let p2 = R2, p1 = R1, cur = R0;
    for (let j = 0; j <= m; j++) p1[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      let rowMin = i;
      const ai = a.charCodeAt(i - 1);
      for (let j = 1; j <= m; j++) {
        let v = p1[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1);
        const del = p1[j] + 1; if (del < v) v = del;
        const ins = cur[j - 1] + 1; if (ins < v) v = ins;
        if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
          const t = p2[j - 2] + 1; if (t < v) v = t;
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const tmp = p2; p2 = p1; p1 = cur; cur = tmp;
    }
    return p1[m];
  }

  // ---- keyboard-aware edit cost, in "edits" (1 = one dropped / added letter) ----
  //   missing letter 1.0 | extra letter EXTRA_COST (1.0 if it just doubles a letter) | swap of two neighbouring letters TRANSPOSE
  //   wrong letter on a neighbouring key SUB_NEAR | on a distant key SUB_FAR
  const KEYPOS = {};
  ["qwertyuiop", "asdfghjkl", "zxcvbnm"].forEach((row, r) => {
    for (let c = 0; c < row.length; c++) KEYPOS[row[c]] = [r, c + [0, 0.25, 0.75][r]];
  });
  function subCost(x, y) {
    if (x === y) return 0;
    const p = KEYPOS[x], q = KEYPOS[y];
    if (!p || !q) return SUB_FAR;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1.45 ? SUB_NEAR : SUB_FAR;
  }
  function wdl(a, b) {
    const n = a.length, m = b.length;
    const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) d[i][0] = i;
    for (let j = 0; j <= m; j++) d[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const extra = (i > 1 && a[i - 1] === a[i - 2]) || (i < n && a[i - 1] === a[i]) ? 1 : EXTRA_COST;   // doubled letter = ordinary slip
        let v = Math.min(d[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]), d[i - 1][j] + extra, d[i][j - 1] + 1);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + TRANSPOSE);
        d[i][j] = v;
      }
    }
    return d[n][m];
  }

  // dictionary words within maxD edits of s: [{i, d}] (d = weighted edits), best (edit + frequency) first
  const memo = new Map();
  function near(s, maxD, k) {
    const key = s + "|" + maxD + "|" + k;
    if (memo.has(key)) return memo.get(key);
    const out = [];
    if (s.length <= 40) {
      for (let L = Math.max(1, s.length - maxD); L <= s.length + maxD; L++) {
        const arr = byLen[L];
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const i = arr[n];
          if (dl(s, words[i], maxD) <= maxD) {
            const d = wdl(s, words[i]);                      // weighted cost used for scoring
            out.push({ i, d, sc: editCost(d) + uniCost[i] * UNI_W });
          }
        }
      }
      out.sort((a, b) => a.sc - b.sc);
      if (out.length > k) out.length = k;
    }
    memo.set(key, out);
    return out;
  }

  // cost of a word needing `d` edits: grows faster than linearly when EDIT_POW > 1
  const editCost = (d) => (d > 0 ? EDIT * Math.pow(d, EDIT_POW) : 0);

  const maxEdits = (len) => (len <= 3 ? 1 : len <= 5 ? 2 : 3);

  // a piece of a run-together word must itself be a real word (one letter: only a / i)
  function exactPiece(s) {
    if (s.length === 1 && s !== "a" && s !== "i") return [];
    return idx.has(s) ? [{ i: idx.get(s), d: 0 }] : [];
  }

  // candidates for one half of a moved space: real words within 1 edit (one letter must be a/i)
  function pieceCands(s) {
    if (s.length === 1) return idx.has(s) ? [{ i: idx.get(s), d: 0 }] : [];
    return near(s, 1, 4);
  }

  // ---- letter-by-letter alignment of typed vs intended (Levenshtein + backtrace) ----
  function alignCounts(typed, guess) {
    const n = typed.length, m = guess.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + (typed[i - 1] === guess[j - 1] ? 0 : 1),
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1
        );
      }
    }
    let correct = 0, incorrect = 0, extra = 0, missed = 0;
    const ops = [];   // walked backwards, reversed at the end:  c correct | i wrong letter | e extra | m missing
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (typed[i - 1] === guess[j - 1] ? 0 : 1)) {
        if (typed[i - 1] === guess[j - 1]) { correct++; ops.push({ t: "c", ch: typed[i - 1] }); }
        else { incorrect++; ops.push({ t: "i", ch: typed[i - 1] }); }
        i--; j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { extra++; ops.push({ t: "e", ch: typed[i - 1] }); i--; }
      else { missed++; ops.push({ t: "m", ch: guess[j - 1] }); j--; }
    }
    ops.reverse();
    return { correct, incorrect, extra, missed, ops };
  }

  // ---- the whole-text decoder ----
  // tokens: [{ raw, lower, flagged, breakBefore, singles, splits }] with no skipped tokens inside a run
  function decode(T) {
    const n = T.length;
    const best = Array.from({ length: n + 1 }, () => new Map());
    best[0].set(-1, { cost: 0, last: -1, back: null, unit: null });

    const relax = (pos, last, cost, from, unit) => {
      const m = best[pos], cur = m.get(last);
      if (!cur || cost < cur.cost) m.set(last, { cost, last, back: from, unit });
    };

    for (let pos = 0; pos < n; pos++) {
      const tok = T[pos];
      for (const node of best[pos].values()) {
        if (tok.skip) { relax(pos + 1, -1, node.cost, node, { from: pos, to: pos + 1, skip: true }); continue; }
        const prev = tok.breakBefore ? -1 : node.last;

        // 0) nothing explains this word on its own: leave it unchecked, at a high cost,
        //    so any reading that does explain it (a merge, a shifted space) wins first
        if (tok.noSingle) relax(pos + 1, -1, node.cost + SKIP_PEN, node, { from: pos, to: pos + 1, skip: true });

        // 1) one typed word -> one intended word
        for (const c of tok.singles) {
          const cost = node.cost + editCost(c.d) + LM_WEIGHT * lmCost(c.i, prev);
          relax(pos + 1, c.i, cost, node, { from: pos, to: pos + 1, guess: [c.i] });
        }
        // 2) one typed word -> two intended words ("goingon" -> "going on")
        for (const s of tok.splits) {
          const cost = node.cost + editCost(s.d1) + editCost(s.d2) + SPLIT_PEN
            + LM_WEIGHT * (lmCost(s.i1, prev) + lmCost(s.i2, s.i1));
          relax(pos + 1, s.i2, cost, node, { from: pos, to: pos + 1, guess: [s.i1, s.i2] });
        }
        // 3) two typed words -> two intended words with the space moved ("goin gnon" -> "going on")
        const nxt = T[pos + 1];
        if (nxt && !nxt.skip && !nxt.breakBefore && (tok.flagged || nxt.flagged)) {
          const joined = tok.lower + nxt.lower;
          for (const delta of [-2, -1, 1, 2]) {
            const k = tok.lower.length + delta;
            if (k < 1 || k > joined.length - 1) continue;
            const L = pieceCands(joined.slice(0, k));
            const R = pieceCands(joined.slice(k));
            for (const l of L.slice(0, 3)) {
              for (const r of R.slice(0, 3)) {
                if (l.d + r.d > SPACE_MAX_EDITS) continue;
                const cost = node.cost + editCost(l.d) + editCost(r.d) + SHIFT_PEN
                  + LM_WEIGHT * (lmCost(l.i, prev) + lmCost(r.i, l.i));
                relax(pos + 2, r.i, cost, node, { from: pos, to: pos + 2, guess: [l.i, r.i] });
              }
            }
          }
          // 4) two typed words -> ONE intended word (a stray space inside it: "ca' t" -> "can't")
          const all = tok.lower + nxt.lower;
          if (all.length >= 3 && all.length <= 24) {
            for (const c of near(all, maxEdits(all.length), 4)) {
              if (c.d > SPACE_MAX_EDITS) continue;
              const cost = node.cost + editCost(c.d) + MERGE_PEN + LM_WEIGHT * lmCost(c.i, prev);
              relax(pos + 2, c.i, cost, node, { from: pos, to: pos + 2, guess: [c.i] });
            }
          }
        }
      }
    }

    let end = null;
    for (const node of best[n].values()) if (!end || node.cost < end.cost) end = node;
    const units = [];
    for (let node = end; node && node.unit; node = node.back) units.push(node.unit);
    return units.reverse();
  }

  return { idx, words, near, maxEdits, pieceCands, exactPiece, alignCounts, decode, addWord, uniCost };
})();

function estimateFreeText(text) {
  const res = {
    correct: 0, incorrect: 0, extra: 0, missed: 0, flagged: 0, unchecked: 0, checked: 0, accuracy: null,
    details: [],          // one entry per corrected unit (shown on the Practice page)
    uncheckedWords: [],   // skipped words, with the reason
    marks: [],            // where the mistakes are in the text: {start, end, ops} (used to color "What you typed")
    reading: [],          // the intended text the checker settled on, word by word
    totalWords: 0,        // words in that corrected text
    totalLetters: 0,      // letters (A-Z) in that corrected text
  };

  // ---- 1. tokenise and decide which words can be checked at all ----
  const T = [];
  const re = /[A-Za-z0-9'\u2019]+/g;
  let m, lastEnd = 0;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const between = text.slice(lastEnd, m.index);
    lastEnd = m.index + raw.length;

    // normalise: curly apostrophes, lowercase, drop opening quote marks
    let lower = raw.replace(/\u2019/g, "'").toLowerCase().replace(/^'+/, "");
    // A trailing apostrophe is a closing quote / plural possessive ("dogs'", 'helo'), unless the word is
    // really a contraction split by a stray space ("ca' t", "don' t"): a lone t / s / d / m / ll / re / ve follows.
    if (/'$/.test(lower)) {
      const base = lower.replace(/'+$/, "");
      const splitContraction = /^\s?(t|s|d|m|ll|re|ve)(?![A-Za-z'\u2019])/i.test(text.slice(m.index + raw.length));
      if (base && (SPELL.idx.has(base) || !splitContraction)) lower = base;
    }

    const lead = raw.length - raw.replace(/^['\u2019]+/, "").length;     // opening quote marks that were dropped
    const tok = { raw, lower, start: m.index + lead, end: m.index + lead + lower.length, skip: false, noSingle: false, skipWhy: "", flagged: false,
                  breakBefore: /[.!?\n]/.test(between), singles: [], splits: [] };
    const startsSentence = /(^|[.!?]\s+|\n\s*)$/.test(text.slice(0, m.index));
    const hardSkip = (why) => { tok.skip = true; tok.skipWhy = why; };      // never checked
    const softSkip = (why) => { tok.noSingle = true; tok.skipWhy = why; };  // unchecked unless a merge / shift explains it

    const poss = lower.match(/^(.+)'s$/);
    if (!lower) hardSkip("punctuation");
    else if (/[0-9]/.test(lower)) hardSkip("number");
    else if (SPELL.idx.has(lower)) {
      tok.singles = [{ i: SPELL.idx.get(lower), d: 0 }];                    // real word / contraction: trusted
    } else if (poss && SPELL.idx.has(poss[1])) {
      tok.singles = [{ i: SPELL.addWord(lower, SPELL.uniCost[SPELL.idx.get(poss[1])] + 1.5), d: 0 }];  // possessive: dog's
    } else if (/^[A-Z]/.test(raw) && raw.length > 1 && !startsSentence) {
      hardSkip("looks like a name");                                         // unknown capitalised word mid-sentence
    } else {
      tok.flagged = true;
      const w = lower;
      if (w.length === 1 || w.length > 38) softSkip(w.length === 1 ? "single letter" : "too long");
      else {
        tok.singles = SPELL.near(w, SPELL.maxEdits(w.length), 20);          // read as one nearby word
        for (let k = 1; k < w.length; k++) {                                 // read as two words run together
          const L = SPELL.exactPiece(w.slice(0, k)), R = SPELL.exactPiece(w.slice(k));
          for (const l of L.slice(0, 2)) for (const r of R.slice(0, 2)) {
            tok.splits.push({ i1: l.i, d1: l.d, i2: r.i, d2: r.d });
          }
        }
        if (!tok.singles.length && !tok.splits.length) softSkip("no close dictionary word");
      }
    }
    T.push(tok);
  }

  // ---- 2. pick the best reading of the whole text ----
  const units = SPELL.decode(T);

  // ---- 3. count letters per unit ----
  for (const u of units) {
    if (u.skip) {
      const t = T[u.from];
      if (t.skipWhy === "punctuation") continue;      // stray apostrophes etc. aren't words
      res.unchecked++; res.uncheckedWords.push({ word: t.raw, why: t.skipWhy });
      res.reading.push(t.raw);
      continue;
    }
    const toks = T.slice(u.from, u.to);
    const typed = toks.map((t) => t.lower).join("");
    const intended = u.guess.map((i) => SPELL.words[i]).join("");
    res.checked += toks.length;
    for (const i of u.guess) res.reading.push(SPELL.words[i]);
    if (typed === intended && toks.length === u.guess.length) { res.correct += typed.length; continue; }
    const { ops, ...c } = SPELL.alignCounts(typed, intended);
    res.correct += c.correct; res.incorrect += c.incorrect; res.extra += c.extra; res.missed += c.missed;
    if (ops.some((o) => o.t !== "c")) res.marks.push({ start: toks[0].start, end: toks[toks.length - 1].end, ops });
    if (typed !== intended || toks.length !== u.guess.length) {
      res.flagged++;
      res.details.push({ word: toks.map((t) => t.raw).join(" "), guess: u.guess.map((i) => SPELL.words[i]).join(" "), ...c });
    }
  }

  // totals are measured on the CORRECTED text (what the checker decided you meant)
  res.totalWords = res.reading.length;
  res.totalLetters = res.reading.join("").replace(/[^A-Za-z]/g, "").length;

  const denom = res.correct + res.incorrect + res.extra;
  res.accuracy = denom ? +(100 * res.correct / denom).toFixed(1) : null;
  return res;
}
