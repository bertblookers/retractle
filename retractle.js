// SPDX-License-Identifier: AGPL-3.0-only
// Retractle's page: loads the day's paper from arXiv, draws it redacted,
// takes guesses, saves them. The rules live in core.js (RetractleCore).

(() => {
  "use strict";
  const C = RetractleCore;
  const DAILY_KEY = "retractle-v1";           // { day, id, v, guesses, done }
  const PRACTICE_KEY = "retractle-practice-v1"; // { id, v, guesses, done }
  const FETCH_TIMEOUT = 30000;

  const $ = id => document.getElementById(id);
  const practice = new URLSearchParams(location.search).has("practice");
  const day = C.dayNumber();

  let paper = null;     // an entry of RETRACTLE_PAPERS
  let tokens = [];      // every redactable word: { w, n, el }
  let byNorm = new Map(); // normalised word -> indices into tokens
  let guesses = [];     // normalised guesses, in order
  let hits = [];        // how many places each guess restored (parallel)
  let done = null;      // null | "won" | "gaveup"
  let selected = null;  // { i, pos }: the guess whose places are lit
  let license = null;   // { text, href }: the paper's license, from arXiv's page

  /* ============ saves ============ */

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }

  function save() {
    const entry = { id: paper.id, v: paper.v, guesses, done };
    if (!practice) entry.day = day;
    try { localStorage.setItem(practice ? PRACTICE_KEY : DAILY_KEY, JSON.stringify(entry)); } catch { /* private window: play on unsaved */ }
  }

  function findPaper(id, v) {
    return RETRACTLE_PAPERS.find(p => p.id === id && p.v === v) || null;
  }

  // a practice paper: never today's daily, nor `not` (the one just played)
  function randomPaper(not) {
    const today = C.paperForDay(RETRACTLE_PAPERS, day);
    const others = RETRACTLE_PAPERS.filter(p => p !== today && p !== not);
    return others[Math.floor(Math.random() * others.length)] || today;
  }

  // A save is used only if it has the shape this code writes; anything else
  // (an older format, a hand-edited or broken entry) is started afresh.
  function validSave(s) {
    return !!s && typeof s === "object" && typeof s.id === "string" && Number.isInteger(s.v) &&
      Array.isArray(s.guesses) && s.guesses.every(g => typeof g === "string" && /^[a-z0-9]+$/.test(g)) &&
      (s.done === null || s.done === "won" || s.done === "gaveup");
  }

  // the puzzle in play and its saved guesses, if any
  function choosePuzzle() {
    if (practice) {
      const s = load(PRACTICE_KEY);
      const p = validSave(s) && findPaper(s.id, s.v);
      if (p) return { p, s };
      return { p: randomPaper(), s: null };
    }
    const p = C.paperForDay(RETRACTLE_PAPERS, day);
    const s = load(DAILY_KEY);
    return { p, s: validSave(s) && s.day === day && s.id === p.id && s.v === p.v ? s : null };
  }

  /* ============ drawing the paper ============ */

  function addParts(parts, into) {
    for (const part of parts) {
      if (part.t !== undefined) {
        into.append(part.t);
      } else if (part.w !== undefined) {
        const n = C.norm(part.w);
        if (C.isCommon(n)) { into.append(part.w); continue; }
        const el = document.createElement("span");
        el.className = "r";
        el.dataset.i = tokens.length;
        el.dataset.len = part.w.length;
        el.style.setProperty("--len", part.w.length);
        // for screen readers: a bar is "redacted, 6 letters"
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", `redacted, ${part.w.length} character${part.w.length === 1 ? "" : "s"}`);
        into.append(el);
        if (!byNorm.has(n)) byNorm.set(n, []);
        byNorm.get(n).push(tokens.length);
        tokens.push({ w: part.w, n, el });
      } else if (part.tag !== undefined) {
        const el = document.createElement("span");
        el.className = "tag";
        el.textContent = part.tag;
        into.append(el);
      } else if (part.math) {
        const el = document.createElement("span");
        el.className = "math";
        el.title = "mathematics (not part of the puzzle)";
        el.textContent = "∑";
        into.append(el);
      }
    }
  }

  function render(blocks) {
    const title = $("paper-title");
    title.replaceChildren();
    addParts(C.tokenize(paper.title), title);
    // the title's bars always show their length, as in Redactle
    for (const el of title.querySelectorAll(".r")) el.classList.add("count");
    const body = $("paper-body");
    body.replaceChildren();
    for (const b of blocks) {
      let el;
      if (b.kind === "heading") {
        el = document.createElement(`h${Math.min(b.level + 1, 5)}`);
        addParts(b.parts, el);
      } else if (b.kind === "label") {
        el = document.createElement("p");
        el.className = "label";
        el.textContent = b.text;
      } else if (b.kind === "para" || b.kind === "caption") {
        el = document.createElement("p");
        if (b.kind === "caption") el.className = "caption";
        addParts(b.parts, el);
      } else if (b.kind === "equation") {
        el = document.createElement("p");
        el.className = "equation";
        el.textContent = "∑ equation " + (b.tag || "");
      }
      if (el) body.append(el);
    }
  }

  // every token a guess restores (its plural/singular too)
  function placesOf(g) {
    const out = [];
    for (const [n, idx] of byNorm) {
      if (C.related(g, n)) out.push(...idx);
    }
    return out.sort((a, b) => a - b);
  }

  function show(t, className) {
    t.el.textContent = t.w;
    t.el.className = className;
    t.el.removeAttribute("role");
    t.el.removeAttribute("aria-label");
  }

  // restores a guess everywhere; records its number of places (the guess
  // list's "Found") and returns how many of them were still redacted
  function restore(g) {
    const places = placesOf(g);
    let fresh = 0;
    for (const i of places) {
      if (tokens[i].el.classList.contains("r")) fresh++;
      show(tokens[i], "k");
    }
    hits.push(places.length);
    return fresh;
  }

  function hiddenPlaces(g) {
    return placesOf(g).filter(i => tokens[i].el.classList.contains("r")).length;
  }

  function revealRest() {
    for (const t of tokens) {
      if (t.el.classList.contains("r")) show(t, "k given");
    }
  }

  /* ============ the guess list ============ */

  function drawGuesses() {
    const list = $("guess-list");
    list.replaceChildren();
    guesses.forEach((g, i) => {
      const tr = document.createElement("tr");
      tr.dataset.i = i;
      if (!hits[i]) tr.className = "miss";
      if (selected && selected.i === i) tr.classList.add("sel");
      const num = document.createElement("td");
      num.textContent = i + 1;
      // the word is a button, so the jump works from the keyboard too
      const word = document.createElement("td");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "guess-word";
      b.textContent = g;
      b.addEventListener("click", e => { e.stopPropagation(); select(i, true); });
      word.append(b);
      const found = document.createElement("td");
      found.textContent = hits[i];
      tr.append(num, word, found);
      tr.addEventListener("click", () => select(i, true));
      list.prepend(tr); // newest on top
    });
    $("guess-count").textContent = guesses.length ? `(${guesses.length})` : "";
    $("score").textContent = guesses.length
      ? `${guesses.length} guess${guesses.length === 1 ? "" : "es"} · ${C.accuracy(hits)}% accuracy`
      : "";
  }

  // light up a guess's places; `jump` scrolls to the next one each time
  function select(i, jump) {
    for (const el of document.querySelectorAll(".hl, .cur")) el.classList.remove("hl", "cur");
    if (!selected || selected.i !== i) selected = { i, pos: -1 };
    const places = placesOf(guesses[i]);
    for (const p of places) tokens[p].el.classList.add("hl");
    if (jump && places.length) {
      selected.pos = (selected.pos + 1) % places.length;
      const el = tokens[places[selected.pos]].el;
      el.classList.add("cur");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      say(`“${guesses[i]}”: ${selected.pos + 1} of ${places.length}`);
    }
    for (const tr of $("guess-list").children) tr.classList.toggle("sel", +tr.dataset.i === i);
  }

  function say(text) {
    $("message").textContent = text;
  }

  /* ============ playing ============ */

  // One word, or each part of "light-curve" / "Hubble's" in turn (a part
  // that is a small word or already restored is passed over). Another form
  // of an earlier guess is refused only when it would restore nothing new:
  // after "find", "found" still counts if "founded" is in the paper.
  function guess(input) {
    if (done) return;
    const parts = C.guessParts(input);
    if (parts.error !== undefined) { say(parts.error); return; }
    const said = [];
    for (const raw of parts.words) {
      let r = C.checkGuess(raw, guesses);
      if (r.error === undefined) {
        const twin = C.twinOf(r.n, guesses);
        if (twin !== undefined && hiddenPlaces(r.n) === 0) {
          r = { error: `Already restored by “${twin}”`, repeat: twin };
        }
      }
      if (r.error !== undefined) {
        if (parts.words.length === 1) {
          say(r.error);
          if (r.repeat !== undefined) select(guesses.indexOf(r.repeat), false);
          return;
        }
        continue;
      }
      guesses.push(r.n);
      const fresh = restore(r.n);
      const total = hits[hits.length - 1];
      said.push(fresh ? `“${r.n}”: restored ${fresh}×`
        : total ? `“${r.n}”: nothing new (all ${total} already restored)`
        : `“${r.n}” is not in the paper`);
    }
    if (!said.length) { say("Nothing new to restore in that"); return; }
    say(said.join(" · "));
    selected = null;
    drawGuesses();
    select(guesses.length - 1, false);
    if (C.isSolved(paper.title, guesses)) finish("won");
    save();
  }

  function finish(how) {
    done = how;
    revealRest();
    showResult();
    save();
    // said in the status line (screen readers hear it), and the keyboard
    // lands on the result's first button instead of the closed input
    say(how === "won" ? "Restored to the archive!" : `The paper was: ${paper.title}`);
    const first = $("result").querySelector("button");
    if (first) first.focus();
  }

  function link(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = text;
    return a;
  }

  // the paper's credit: authors, year, title, its arXiv page, the license
  // arXiv states for it, and that the retraction is only the game's story
  function cite() {
    const p = document.createElement("p");
    p.className = "cite";
    p.append(`${paper.by} (${paper.year}). `);
    const i = document.createElement("i");
    i.textContent = paper.title;
    p.append(i, ". ", link(C.absUrl(paper), `arXiv:${paper.id}`), ".");
    const rights = document.createElement("p");
    rights.className = "rights";
    rights.append("The work of its authors, shown here as a game: ",
      link(C.absUrl(paper), "read the original on arXiv"), ". ");
    if (license) {
      rights.append("License: ");
      rights.append(license.href ? link(license.href, license.text) : license.text);
      rights.append(". ");
    }
    rights.append("It was never really retracted.");
    return [p, rights];
  }

  function shareText() {
    const name = practice ? "Retractle practice" : `Retractle #${day}`;
    const url = location.origin + location.pathname;
    return `${name}: paper restored in ${guesses.length} guesses (${C.accuracy(hits)}% accuracy)\n${url}`;
  }

  function showResult() {
    const box = $("result");
    box.replaceChildren();
    const head = document.createElement("p");
    head.className = "result-head";
    head.textContent = done === "won" ? "Restored to the archive!" : "The paper was:";
    box.append(head, ...cite());
    const row = document.createElement("p");
    row.className = "result-actions";
    if (done === "won") {
      const share = document.createElement("button");
      share.type = "button";
      share.textContent = "Share";
      share.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(shareText()); say("Result copied"); }
        catch { say(shareText()); }
      });
      row.append(share);
    }
    if (practice) {
      const next = document.createElement("button");
      next.type = "button";
      next.textContent = "Another paper";
      next.addEventListener("click", newPractice);
      row.append(next);
    }
    if (row.children.length) box.append(row);
    box.hidden = false;
    // The stamp is the game's fiction: it never stands beside a real
    // paper's revealed title saying RETRACTED. A win stamps it RESTORED;
    // giving up takes it away.
    $("stamp").textContent = "RESTORED";
    $("stamp").classList.add("restored");
    $("stamp").hidden = done !== "won";
    $("guess-input").disabled = true;
    $("guess-submit").disabled = true;
    $("guess-form").hidden = true; // leaves the room to the paper
    $("give-up").hidden = true;
  }

  // a fresh practice paper, never the one just played
  function newPractice() {
    const p = randomPaper(paper);
    try {
      localStorage.setItem(PRACTICE_KEY, JSON.stringify({ id: p.id, v: p.v, guesses: [], done: null }));
    } catch { /* unsaved: the reload picks another random paper */ }
    location.reload();
  }

  /* ============ start ============ */

  async function fetchPaper() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(C.htmlUrl(paper), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`arXiv answered ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const blocks = C.extractBlocks(doc);
      if (!C.isPaper(doc, blocks)) throw new Error("arXiv sent a page that isn't the paper");
      license = C.paperLicense(doc);
      return blocks;
    } finally {
      clearTimeout(timer);
    }
  }

  async function start() {
    // a first visit opens How to play
    if (!load(DAILY_KEY) && !load(PRACTICE_KEY)) $("help").open = true;
    const { p, s } = choosePuzzle();
    paper = p;
    guesses = s ? s.guesses.slice() : [];
    done = s ? s.done : null;
    $("puzzle-label").textContent = practice ? "Practice paper" : `Puzzle #${day}`;
    const pb = $("practice-button");
    pb.textContent = practice ? "Back to today's paper" : "Practice";
    pb.addEventListener("click", () => {
      location.href = practice ? location.pathname : location.pathname + "?practice";
    });

    let blocks;
    try {
      blocks = await fetchPaper();
    } catch (e) {
      fail(`The paper can't be loaded from arXiv right now (${e.name === "AbortError" ? "no answer" : e.message}).`);
      return;
    }
    try {
      $("paper-status").hidden = true;
      // on a phone the list starts folded, so the paper keeps the screen
      if (matchMedia("(max-width: 760px)").matches) $("guesses-box").open = false;
      render(blocks);
      if (!practice || !s) save(); // a new practice paper is kept on reload
      hits = [];
      for (const g of guesses) restore(g);
      drawGuesses();
      if (done) {
        revealRest();
        showResult();
      } else {
        $("guess-input").disabled = false;
        $("guess-submit").disabled = false;
        $("give-up").hidden = false;
        $("guess-input").focus();
      }
    } catch (e) {
      // not arXiv's fault: start this paper afresh on the next try
      try { localStorage.removeItem(practice ? PRACTICE_KEY : DAILY_KEY); } catch { /* nothing saved */ }
      $("paper-title").replaceChildren();
      $("paper-body").replaceChildren();
      $("guess-input").disabled = $("guess-submit").disabled = true;
      fail(`Something went wrong setting up the paper (${e.message}).`);
      return;
    }
    window.__retractle = { paper, tokens, guesses: () => guesses, blocks };
  }

  // the loading line turns into the error and a way to try again
  function fail(text) {
    const st = $("paper-status");
    st.hidden = false;
    st.textContent = text + " ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "link-button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => location.reload());
    st.append(retry);
  }

  $("guess-form").addEventListener("submit", e => {
    e.preventDefault();
    const input = $("guess-input");
    guess(input.value);
    input.value = "";
    input.focus();
  });

  // a black bar shows how many characters it hides (the title's always do)
  $("paper").addEventListener("click", e => {
    const el = e.target.closest(".r");
    if (el && !el.closest("#paper-title")) el.classList.toggle("count");
  });

  $("give-up").addEventListener("click", () => {
    if (!done && confirm("Give up and show the whole paper?")) finish("gaveup");
  });

  start();
})();
