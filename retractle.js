// SPDX-License-Identifier: AGPL-3.0-only
// Retractle's page: loads the day's paper from arXiv, draws it redacted,
// takes guesses, saves them. The rules live in core.js (RetractleCore).

(() => {
  "use strict";
  const C = RetractleCore;
  const DAILY_KEY = "retractle-v1";           // { day, id, v, guesses, done, ms, hints? }: today's daily
  const ARCHIVE_KEY = "retractle-archive-v1"; // { "<day>": { day, id, v, guesses, done, ms, hints? } }: earlier days'
  const PRACTICE_KEY = "retractle-practice-v1"; // { id, v, guesses, done, ms, hints? }
  const NAV_KEY = "retractle-nav-focus";      // sessionStorage: the navigator's button pressed before a load
  const SETTINGS_KEY = "retractle-settings-v1"; // { glide }: the player's settings
  const FETCH_TIMEOUT = 30000;

  const $ = id => document.getElementById(id);
  const practice = new URLSearchParams(location.search).has("practice");
  const today = C.dayNumber();
  // the puzzle in play: today's, or an earlier day's from the navigator
  // ("?p=N", as in Muldle; never a day still to come). An older core.js (a
  // deploy's mixed cache) has no navigator: today's.
  const asked = C.puzzleFromQuery ? C.puzzleFromQuery(location.search, today) : null;
  const day = practice || asked === null ? today : asked;

  let paper = null;     // an entry of RETRACTLE_PAPERS
  let tokens = [];      // every redactable word: { w, n, el }
  let byNorm = new Map(); // normalised word -> indices into tokens
  let guesses = [];     // normalised guesses, in order
  let hits = [];        // how many places each guess restored (parallel)
  let hints = [];       // the hints used, in order: { n, k }, the k-th place of word n (C.saveHints)
  let done = null;      // null | "won" | "gaveup"
  let selected = null;  // { i, pos, chosen }: the guess whose places are lit (pick)
  let license = null;   // { text, href }: the paper's license, from arXiv's page
  let restored = 0;     // places the guesses restored (not those shown at the end)
  let elapsed = 0;      // ms of play so far (C.timeOfSave), or null: a game never timed
  let since = null;     // performance.now() when the stretch being timed began
  let ready = false;    // the game is set up: the clock runs only from then on

  /* ============ saves ============ */

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }

  // A game's save: "ok", "full" (no room left: every game on this site
  // shares the browser's storage) or "failed" (a private window, storage
  // blocked: play on unsaved, as before).
  function write(key, value) {
    try {
      localStorage.setItem(key, value);
      return "ok";
    } catch (e) {
      return e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        e.code === 22 || e.code === 1014) ? "full" : "failed";
    }
  }
  // The full play history is kept, never pruned (user, 09-10-2026;
  // notes/archive-storage.md): if a game can't be saved for lack of room,
  // the page says so plainly instead of losing it silently, until a save
  // of this game goes through again.
  function storageFull(full) {
    const note = $("storage-note");
    if (!note || note.hidden === !full) return; // an older index.html has none
    note.textContent = full ? "Your browser's storage for this site is full, so this game can't be saved." : "";
    note.hidden = !full;
  }
  // an earlier day's daily that couldn't move to the archive for lack of
  // room (keepPastDaily): it keeps the daily save, so today's isn't saved
  // over it
  let held = false;

  // Each day keeps its own game: today's daily in DAILY_KEY, an earlier
  // day's (played from the navigator) in the archive, by day; an earlier
  // day's game is kept there only once it has a guess or an end.
  //
  // One rule says where a day's game lives, for loading it (choosePuzzle),
  // saving it (saveKey), keeping its time (keepTime) and moving it
  // (keepPastDaily) alike, so no guess is lost (re-check of 09-10-2026,
  // R1): once the archive holds a game of that day, there, as the newer,
  // unless the daily save's carries it on (an older page saved there
  // after the archive had it); until then the daily save, if it holds
  // that day's game. `savedGame` finds it (a daily's: practice has a
  // save of its own).
  function savedGame(d) {
    const a = saveOfDay(loadArchive()[d], d), s = saveOfDay(load(DAILY_KEY), d);
    if (s && (!a || carriesOn(s, a))) return { key: DAILY_KEY, s };
    return a ? { key: ARCHIVE_KEY, s: a } : { key: null, s: null };
  }
  // whether save `s` carries game `a` on: its guesses, then more, or an
  // end `a` hasn't reached
  function carriesOn(s, a) {
    return a.guesses.every((g, i) => s.guesses[i] === g) &&
      (s.guesses.length > a.guesses.length || (!!s.done && !a.done));
  }
  // Where the next save goes: the archive once it holds this day's game
  // (by the rule above); a daily is saved as today's only while the clock
  // still shows its day and DAILY_KEY holds no later day's game, so a
  // page left open past midnight, or a clock set back, keeps its game in
  // the archive instead of writing over a newer one (pre-push review of
  // 09-10-2026, A1).
  function saveKey() {
    if (practice) return PRACTICE_KEY;
    if (day !== today || C.dayNumber() !== day || savedGame(day).key === ARCHIVE_KEY) return ARCHIVE_KEY;
    const s = load(DAILY_KEY);
    return validSave(s) && Number.isInteger(s.day) && s.day > day && (s.guesses.length || s.done)
      ? ARCHIVE_KEY : DAILY_KEY;
  }
  function save() {
    clock();
    const entry = { id: paper.id, v: paper.v, guesses, done };
    if (!practice) entry.day = day;
    if (elapsed !== null) entry.ms = Math.round(elapsed);
    // only once a hint is used, so a game without one saves what it always did
    if (hints.length) entry.hints = hints;
    const key = saveKey();
    let r = null;
    if (key === PRACTICE_KEY) r = write(PRACTICE_KEY, JSON.stringify(entry));
    else if (key === DAILY_KEY) r = held ? "full" : write(DAILY_KEY, JSON.stringify(entry));
    else if (guesses.length || done) {
      const a = loadArchive();
      a[day] = entry;
      r = write(ARCHIVE_KEY, JSON.stringify(a));
    }
    if (r !== null && r !== "failed") storageFull(r === "full");
  }

  // How long the game took (user, 09-10-2026; the measure is Claude's
  // default, which the user may change): the time the page is open and in
  // view, from the first guess to the one that restores the paper, summed
  // across visits (saved with the game as `ms`). Each call adds the
  // stretch since the last and starts a new one while the game is being
  // played and the page is in view.
  function clock() {
    const now = performance.now();
    if (since !== null && elapsed !== null) elapsed += now - since;
    since = ready && elapsed !== null && !done && guesses.length &&
      document.visibilityState === "visible" ? now : null;
  }
  // The time so far, kept when the page is hidden or left: written into
  // this game's save where it lives (savedGame: past midnight too, with no
  // guess since; re-check of 09-10-2026, R2/S1), and only while that save
  // still holds this very game, so a game another tab played on, or the
  // new paper "Another paper" chose, is left alone.
  function keepTime() {
    clock();
    if (elapsed === null || done || !guesses.length) return;
    const { key, s } = practice ? { key: PRACTICE_KEY, s: load(PRACTICE_KEY) } : savedGame(day);
    if (!key || !validSave(s) || s.id !== paper.id || s.v !== paper.v ||
        s.done || s.guesses.join() !== guesses.join()) return;
    s.ms = Math.round(elapsed);
    const all = key === ARCHIVE_KEY ? loadArchive() : null;
    if (all) all[day] = s;
    if (write(key, JSON.stringify(all || s)) === "full") storageFull(true);
  }
  document.addEventListener("visibilitychange", () => {
    if (!ready) return;
    if (document.visibilityState === "visible") clock();
    else keepTime();
  });
  addEventListener("pagehide", () => { if (ready) keepTime(); });

  // earlier days' games, by day
  function loadArchive() {
    const a = load(ARCHIVE_KEY);
    return a && typeof a === "object" && !Array.isArray(a) ? a : {};
  }

  // `s` if it is a save this code wrote for day `d`'s paper, else null
  function saveOfDay(s, d) {
    const p = C.paperForDay(RETRACTLE_PAPERS, d);
    return validSave(s) && s.day === d && s.id === p.id && s.v === p.v ? s : null;
  }

  // The daily save is taken over by the next day's daily, so an earlier
  // day's game in it moves to the archive first, where it lives from then
  // on (unless the archive holds a game of that day already that it
  // doesn't carry on: played from the navigator, or saved there by a page
  // left open past midnight, so newer; savedGame). A later day's game in it
  // (a clock set back) stays: saveKey saves today's beside it. If
  // there is no room for it, it stays where it is and today's game isn't
  // saved over it (held), and the page says so.
  function keepPastDaily() {
    const s = load(DAILY_KEY);
    if (!validSave(s) || !Number.isInteger(s.day) || s.day < 0 || s.day >= today) return;
    if (!s.guesses.length && !s.done) return;
    if (savedGame(s.day).key !== DAILY_KEY) return;
    const a = loadArchive();
    a[s.day] = s;
    held = write(ARCHIVE_KEY, JSON.stringify(a)) === "full";
  }

  function findPaper(id, v) {
    return RETRACTLE_PAPERS.find(p => p.id === id && p.v === v) || null;
  }

  // a practice paper from today's era's pool: never today's daily, nor
  // `not` (the one just played)
  function randomPaper(not) {
    const daily = C.paperForDay(RETRACTLE_PAPERS, today);
    const others = C.poolForDay(RETRACTLE_PAPERS, today).filter(p => p !== daily && p !== not);
    return others[Math.floor(Math.random() * others.length)] || daily;
  }

  // A save is used only if it has the shape this code writes; anything else
  // (an older format, a hand-edited or broken entry) is started afresh. A
  // save without hints (C.saveHints) is one; an older core.js (a deploy's
  // mixed cache) doesn't read them.
  function validSave(s) {
    return !!s && typeof s === "object" && typeof s.id === "string" && Number.isInteger(s.v) &&
      Array.isArray(s.guesses) && s.guesses.every(g => typeof g === "string" && /^[a-z0-9]+$/.test(g)) &&
      (s.done === null || s.done === "won" || s.done === "gaveup") && (!C.saveHints || C.saveHints(s) !== null);
  }

  // the puzzle in play and its saved guesses, if any
  function choosePuzzle() {
    if (practice) {
      const s = load(PRACTICE_KEY);
      const p = validSave(s) && findPaper(s.id, s.v);
      if (p) return { p, s };
      return { p: randomPaper(), s: null };
    }
    // where this day's game lives (savedGame), as saveKey saves it
    return { p: C.paperForDay(RETRACTLE_PAPERS, day), s: savedGame(day).s };
  }

  /* ============ the puzzle navigator ============ */

  // As Muldle's (user, 09-10-2026: "see muldle"): « and » step through the
  // days that have come, never one still to come; the number leads back to
  // today's. A step loads the page for that day ("?p=N"; today's has none),
  // which sets that day's game up as on its own day. A button pressed from
  // the keyboard keeps the focus across the load, so the keyboard can step
  // on; a mouse or touch press leaves it to the guess box, as on any load
  // (review of 09-10-2026: kept on the button, typed letters went nowhere
  // and Enter stepped again). Returns whether it took the focus.
  function setUpNav() {
    const label = $("puzzle-label"), nav = $("puzzle-nav");
    if (practice || !nav) {
      // an older index.html (a deploy's mixed cache) has no navigator
      label.textContent = practice ? "Practice paper" : `Puzzle #${day}`;
      return false;
    }
    // the address names the puzzle in play: today's none, an earlier one
    // its number (a day still to come was clamped to today)
    try {
      const url = new URL(location.href);
      if (url.searchParams.has("p")) {
        if (day === today) url.searchParams.delete("p");
        else url.searchParams.set("p", day);
        history.replaceState(history.state, "", url);
      }
    } catch { /* no history API: the address stays */ }
    label.textContent = "Archive";
    label.hidden = day === today;
    $("nav-num").textContent = day;
    // a screen reader hears the puzzle in play on a step's new page: in the
    // title, and as the steps' description (review of 09-10-2026)
    if (day < today) document.title = document.title.replace(/^Retractle\b/, `Retractle #${day} (archive)`);
    for (const id of ["nav-prev", "nav-next"]) $(id).setAttribute("aria-describedby", day < today ? "puzzle-label nav-today" : "nav-today");
    $("nav-prev").disabled = day <= 0;
    $("nav-next").disabled = day >= today;
    nav.hidden = false;
    const go = (to, which) => {
      to = Math.max(0, Math.min(today, to));
      if (to === day) return;
      try {
        if (which) sessionStorage.setItem(NAV_KEY, which);
        else sessionStorage.removeItem(NAV_KEY);
      } catch { /* the focus isn't kept */ }
      const url = new URL(location.href);
      url.searchParams.delete("practice");
      if (to === today) url.searchParams.delete("p");
      else url.searchParams.set("p", to);
      location.replace(url);
    };
    // a click from the keyboard (Enter, Space) has detail 0, a mouse's or a
    // touch's its count of presses; some screen readers' presses count one
    // too (NVDA or JAWS in Firefox, TalkBack on Android, VoiceOver on iOS),
    // so theirs land in the guess box (a known limit: notes/game-rules.md,
    // "The puzzle navigator")
    for (const [id, to] of [["nav-prev", day - 1], ["nav-next", day + 1], ["nav-today", today]]) {
      $(id).addEventListener("click", e => go(to, e.detail === 0 ? id : null));
    }
    let which = null;
    try {
      which = sessionStorage.getItem(NAV_KEY);
      sessionStorage.removeItem(NAV_KEY);
    } catch { /* no focus to keep */ }
    if (!["nav-prev", "nav-next", "nav-today"].includes(which)) return false;
    ($(which).disabled ? $("nav-today") : $(which)).focus();
    return true;
  }

  /* ============ drawing the paper ============ */

  // A redacted word joins the puzzle as a black bar about as wide as the
  // word, showing its number of characters (every bar: user, 08-10-2026;
  // the number is drawn once the bar comes near the screen, see
  // numberNear). The bar is restored in place. In maths too it is this HTML
  // bar, inside its MathML token (Chrome draws no ::after on a MathML
  // element, Firefox draws it in the token's flow).
  function bar(w) {
    const len = [...w].length;
    const el = document.createElement("span");
    el.className = "r";
    el.dataset.len = len;
    el.style.setProperty("--len", len);
    // for screen readers: a bar is "redacted, 6 characters"
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `redacted, ${len} character${len === 1 ? "" : "s"}`);
    const n = C.norm(w);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(tokens.length);
    tokenAt.set(el, tokens.length);
    tokens.push({ w, n, el });
    return el;
  }
  const tokenAt = new WeakMap(); // a bar's element -> its index in tokens
  let bodyFrom = 0;              // tokens before it are the title's

  const hidden = w => !C.isCommon(C.norm(w));

  function addParts(parts, into) {
    for (const part of parts) {
      if (part.t !== undefined) {
        into.append(part.t);
      } else if (part.w !== undefined) {
        into.append(hidden(part.w) ? bar(part.w) : part.w);
      } else if (part.tag !== undefined) {
        const el = document.createElement("span");
        el.className = "tag";
        el.textContent = part.tag;
        into.append(el);
      } else if (part.math) {
        // { math: true } is an older core.js's (a browser holding the old
        // file during a deploy): draw what that version drew
        into.append(typeof part.math === "object" ? drawMath(part.math) : "∑");
      }
    }
  }

  // maths, drawn as MathML from core.js's plain data (mathTree). A token
  // with a redacted word in it becomes a row of tokens, the word's holding
  // its bar; the rest keeps its text, its spaces made non-breaking so MathML
  // doesn't trim them away.
  const MATHML = "http://www.w3.org/1998/Math/MathML";
  function mathEl(name, attrs, text) {
    const el = document.createElementNS(MATHML, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function drawMath(node) {
    if (!node.parts) {
      const el = mathEl(node.m, node.a);
      for (const c of node.c) el.append(drawMath(c));
      return el;
    }
    if (!node.parts.some(p => p.w !== undefined && hidden(p.w))) {
      return mathEl(node.m, node.a, node.parts.map(p => p.w ?? p.t).join(""));
    }
    const row = mathEl("mrow", {});
    let text = "";
    const flush = () => {
      if (text) row.append(mathEl(node.m, node.a, text.replace(/^ +| +$/g, s => " ".repeat(s.length))));
      text = "";
    };
    for (const p of node.parts) {
      if (p.w !== undefined && hidden(p.w)) {
        flush();
        const el = mathEl(node.m, node.a);
        el.append(bar(p.w));
        row.append(el);
      } else {
        text += p.w ?? p.t;
      }
    }
    flush();
    return row;
  }

  // a displayed equation: its rows and cells, aligned as in the paper
  function drawEquation(rows) {
    const table = document.createElement("table");
    for (const cells of rows) {
      const tr = document.createElement("tr");
      for (const cell of cells) {
        const td = document.createElement("td");
        td.className = cell.align;
        if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
        addParts(cell.parts, td);
        tr.append(td);
      }
      table.append(tr);
    }
    return table;
  }

  function blockEl(b) {
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
      // a formula too wide for a phone scrolls inside its paragraph
      if (b.parts.some(p => p.math)) el.classList.add("has-math");
      addParts(b.parts, el);
    } else if (b.kind === "equation") {
      el = document.createElement("div");
      el.className = "equation";
      // without rows: an older core.js's block (see addParts)
      el.append(b.rows ? drawEquation(b.rows) : "∑ equation " + (b.tag || ""));
    }
    return el;
  }

  function render(blocks) {
    const title = $("paper-title");
    title.replaceChildren();
    addParts(C.tokenize(paper.title), title);
    bodyFrom = tokens.length;
    const body = $("paper-body");
    body.replaceChildren();
    figures = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === "figure") {
        // the figure, then its own caption blocks inside it
        const inner = blocks.slice(i + 1, i + 1 + b.blocks);
        i += b.blocks;
        body.append(drawFigure(b, inner));
        continue;
      }
      const el = blockEl(b);
      if (el) body.append(el);
    }
    for (const el of title.querySelectorAll("span.r")) el.classList.add("count");
    numberNear(body.children);
  }

  /* ============ figures ============ */

  // Figures are retracted too (user, 08-10-2026): each graphic is a black
  // block of its own shape until enough of the figure's caption is restored
  // (core.js's figureRevealed), then its image loads straight from
  // arxiv.org, like the text, nothing copied or proxied (user: "We just work
  // with the things that are available"), shown unchanged. Until then the
  // page holds no image address (file names and the text in an image can
  // spoil title words). A figure with no graphic is "Beyond repair" (user,
  // 08-10-2026). The links to the figure and to the PDF come when the game
  // is over: they name the paper.
  //
  // Loading (review of 08-10-2026): a figure that came back loads once it
  // comes within a screen's height of the view (a finished game of 48
  // figures doesn't fetch them all at once), with the paper's timeout. Its
  // box keeps its place and size, saying "restoring…", until the image is
  // decoded, then the image takes its place; if it can't be loaded, the box
  // stays and its credit line says so. A raster image is shown from a blob:
  // (the page's own copy in memory, so "open image" doesn't name the paper)
  // and the blob: is let go once shown; an SVG never becomes a blob:, which
  // would put a third-party document in this site's origin (every game's
  // saves) when opened on its own: it is shown from a data: address, whose
  // document has an origin of its own.
  let figures = []; // { block, el, graphic, credit, boxes, from, to (its tokens), name, images, shown, asked (its images), failed }
  const figureOf = new WeakMap(); // a figure's element -> its entry
  let figuresNear = null;         // the IntersectionObserver that starts the loads

  // "Figure 3" from a caption's tag ("Figure 3:", "Fig. 3.")
  const FIGURE_NAME = /^(?:fig(?:ure|\.)?|plate|panel)\s*[^\s:.]+/i;
  const RASTER = /^image\/(png|jpeg|gif|webp)$/;

  function drawFigure(b, inner) {
    const el = document.createElement("figure");
    el.className = "fig";
    const graphic = document.createElement("div");
    graphic.className = "fig-graphic";
    el.append(graphic);
    const from = tokens.length;
    let name = "";
    // the caption blocks, as the figure's caption (its accessible name)
    const caption = document.createElement("figcaption");
    for (const ib of inner) {
      const tag = (ib.parts || []).find(q => q.tag !== undefined);
      if (!name && tag) name = (FIGURE_NAME.exec(tag.tag.trim()) || [""])[0];
      const child = blockEl(ib);
      if (child) caption.append(child);
    }
    if (caption.children.length) el.append(caption);
    const images = b.images.map(img => ({ ...img, url: C.figureUrl ? C.figureUrl(paper, img.src) : null }))
      .filter(img => img.url);
    const credit = document.createElement("p");
    credit.className = "fig-credit";
    const f = { block: b, el, graphic, credit, boxes: [], from, to: tokens.length, name: name || "A figure",
      images, shown: false, failed: false };
    if (images.length) {
      f.boxes = images.map(img => retractedBlock(img, f.to > f.from));
      graphic.append(...f.boxes);
    } else {
      // nothing to bring back: said at once
      graphic.classList.add("beyond");
      const label = document.createElement("p");
      label.className = "fig-beyond";
      label.textContent = "Beyond repair";
      graphic.append(label, credit);
      f.shown = true;
      credit.replaceChildren(...creditParts(f));
    }
    figures.push(f);
    figureOf.set(el, f);
    return el;
  }

  // a graphic's retracted block: its shape, scaled to the column. A figure
  // whose caption hides nothing comes back only when the game is over, and
  // says so (review of 08-10-2026)
  function retractedBlock(img, captioned) {
    const el = document.createElement("div");
    el.className = "fig-bar";
    el.style.width = `${img.w}px`;
    el.style.aspectRatio = `${img.w} / ${img.h}`;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", captioned ? "retracted figure: restore more of its caption to see it"
      : "retracted figure: it comes back when the game is over");
    const label = document.createElement("span");
    label.textContent = captioned ? "retracted" : "retracted until the end";
    label.setAttribute("aria-hidden", "true");
    el.append(label);
    return el;
  }

  // what a figure's credit line says: the source, or why it can't be shown;
  // its links once the game is over
  function creditParts(f) {
    const pdf = () => link(`https://arxiv.org/pdf/${paper.id}v${paper.v}`, "the PDF");
    const html = text => link(`${C.htmlUrl(paper)}#${f.block.id}`, text);
    if (!f.images.length) {
      const why = f.block.unshown ? "This figure can't be shown here; see it in " : "This figure isn't in arXiv's HTML version; see it in ";
      return done ? [why, pdf()] : [why + "the PDF"];
    }
    if (f.failed) {
      return done ? ["This figure couldn't be loaded from arXiv right now; see it in ", html("the paper's arXiv HTML version")]
        : ["This figure couldn't be loaded from arXiv right now"];
    }
    return [done ? html("From the paper's arXiv HTML version") : "From the paper's arXiv HTML version"];
  }

  // the figures whose caption is restored far enough (all of them once the
  // game is over) come back; returns those that just did. Their images load
  // when they come near the view.
  function revealFigures(all) {
    const back = [];
    for (const f of figures) {
      if (f.shown) continue;
      let restored = 0;
      for (let i = f.from; i < f.to; i++) if (!unrestored(tokens[i])) restored++;
      if (!all && !C.figureRevealed(restored, f.to - f.from)) continue;
      f.shown = true;
      f.boxes.forEach((box, k) => {
        box.classList.add("loading");
        box.setAttribute("aria-label", `${panelName(f, k)}: restoring from arXiv`);
        box.firstChild.textContent = "restoring…";
      });
      f.credit.replaceChildren(...creditParts(f));
      f.graphic.after(f.credit);
      loadWhenNear(f);
      back.push(f);
    }
    return back;
  }

  function panelName(f, k) {
    return f.images.length > 1 ? `${f.name}, panel ${k + 1} of ${f.images.length}` : f.name;
  }

  function loadWhenNear(f) {
    if (typeof IntersectionObserver === "undefined") { loadFigure(f); return; }
    if (!figuresNear) {
      figuresNear = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          figuresNear.unobserve(e.target);
          loadFigure(figureOf.get(e.target));
        }
      }, { rootMargin: "100% 0px" });
    }
    figuresNear.observe(f.el);
  }

  // A print asks for every figure that came back and hasn't been asked for:
  // the print being laid out has them as their empty box (retractle.css
  // prints no "restoring…"), the next one has them all (review of 09-10-2026).
  addEventListener("beforeprint", () => {
    for (const f of figures) {
      if (!f.shown || f.asked) continue;
      if (figuresNear) figuresNear.unobserve(f.el);
      loadFigure(f);
    }
  });

  // an image's address for the page: a blob: of a raster image, a data: of
  // an SVG; arXiv refusing the page a copy (no CORS header) leaves its plain
  // address, anything else is a failure (no second request)
  async function imageSource(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        return url;
      }
      if (!res.ok) throw new Error(`arXiv answered ${res.status}`);
      const blob = await res.blob();
      if (RASTER.test(blob.type)) return URL.createObjectURL(blob);
      if (blob.type === "image/svg+xml") {
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }
      throw new Error(`not an image (${blob.type || "no type"})`);
    } finally {
      clearTimeout(timer);
    }
  }

  // each graphic in its box's place once decoded; a failure keeps the box
  async function loadFigure(f) {
    if (f.asked) return;
    f.asked = true;
    await Promise.all(f.images.map(async (img, k) => {
      const box = f.boxes[k];
      let src = null;
      try {
        src = await imageSource(img.url);
        const el = document.createElement("img");
        el.width = img.w;
        el.height = img.h;
        el.style.aspectRatio = `${img.w} / ${img.h}`;
        el.alt = panelName(f, k);
        el.src = src;
        await el.decode();
        box.replaceWith(el);
      } catch {
        f.failed = true;
        box.classList.replace("loading", "failed");
        box.setAttribute("aria-label", `${panelName(f, k)}: couldn't be loaded from arXiv`);
        box.firstChild.textContent = "";
      } finally {
        // shown (or not): the page's copy in memory can go
        if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
      }
    }));
    if (!f.failed) return;
    f.credit.replaceChildren(...creditParts(f));
    // said in the status line too, while it still speaks of this figure
    const message = $("message");
    if (message.textContent.endsWith(`${f.name} restored`)) message.textContent += " (it couldn't be loaded from arXiv right now)";
  }

  // once the game is over: the links (to the figure in arXiv's HTML, to the PDF)
  function linkFigures() {
    for (const f of figures) if (f.shown) f.credit.replaceChildren(...creditParts(f));
  }

  // A bar shows its number once it has the class `count`: the title's at
  // once, the paper's when their block comes within a screen's height of the
  // view. Drawing all numbers at once made a long paper's first render about
  // 1.5x slower (1201.2434: 74,205 bars; review of 08-10-2026, timings in
  // notes/render-speed.md). The number lies over its bar, so drawing it
  // late moves nothing. (An older retractle.css draws exactly the bars with
  // `count`, so a deploy's mixed cache still shows them.)
  // An IntersectionObserver answers only after the browser has painted, so
  // after an instant jump or a fast scroll the bars on screen showed no
  // number for a frame or two (re-check of 08-10-2026). Scroll and resize
  // events come before the paint: on each, and once the page is set up,
  // numberInView numbers the blocks near the view at once. The observer
  // stays for whatever else moves the page (How to play folding).
  let barBlocks = [];          // the paper's blocks with bars, top to bottom
  let unnumbered = new Set();  // those whose bars show no number yet
  let near = null;             // the IntersectionObserver

  function numberBlock(el) {
    for (const b of el.querySelectorAll("span.r")) b.classList.add("count");
    unnumbered.delete(el);
    if (near) near.unobserve(el);
  }

  function numberNear(blocks) {
    barBlocks = [...blocks].filter(el => el.querySelector("span.r"));
    unnumbered = new Set(barBlocks);
    if (typeof IntersectionObserver === "undefined") { for (const el of barBlocks) numberBlock(el); return; }
    near = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) numberBlock(e.target);
    }, { rootMargin: "100% 0px" });
    for (const el of barBlocks) near.observe(el);
    addEventListener("scroll", numberInView, { passive: true });
    addEventListener("resize", numberInView);
  }

  // the blocks within a screen's height of the view (the observer's margin),
  // numbered now; every position is read before any class is set, so the
  // layout is worked out once
  function numberInView() {
    if (!unnumbered.size) {
      removeEventListener("scroll", numberInView);
      removeEventListener("resize", numberInView);
      return;
    }
    const vh = innerHeight;
    // the blocks lie one under the other: the first that reaches the margin
    // above the view, by halving
    let lo = 0, hi = barBlocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (barBlocks[mid].getBoundingClientRect().bottom < -vh) lo = mid + 1;
      else hi = mid;
    }
    const todo = [];
    for (let i = lo; i < barBlocks.length && barBlocks[i].getBoundingClientRect().top <= 2 * vh; i++) {
      if (unnumbered.has(barBlocks[i])) todo.push(barBlocks[i]);
    }
    for (const el of todo) numberBlock(el);
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
    t.el.removeAttribute("tabindex"); // a hint's keyboard place (setRover)
  }

  // a place no guess has restored yet: a bar, or a word a hint revealed
  // (core.js's canReveal: a hint restores nothing, so a guess of that word
  // still restores it, the same in play and after a reload)
  const unrestored = t => t.el.classList.contains("r") || t.el.classList.contains("hint");

  // restores a guess everywhere; records its number of places (the guess
  // list's "Found") and returns how many of them were not restored yet
  function restore(g) {
    const places = placesOf(g);
    let fresh = 0;
    for (const i of places) {
      if (unrestored(tokens[i])) fresh++;
      show(tokens[i], "k");
    }
    hits.push(places.length);
    restored += fresh;
    return fresh;
  }

  function hiddenPlaces(g) {
    return placesOf(g).filter(i => unrestored(tokens[i])).length;
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
      const num = document.createElement("td");
      num.textContent = i + 1;
      // the word is a button, so the jump works from the keyboard too
      const word = document.createElement("td");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "guess-word";
      b.textContent = g;
      b.addEventListener("click", e => { e.stopPropagation(); pick(i); });
      word.append(b);
      markRow(tr, !!selected && selected.i === i, b);
      const found = document.createElement("td");
      found.textContent = hits[i];
      tr.append(num, word, found);
      tr.addEventListener("click", () => pick(i));
      list.prepend(tr); // newest on top
    });
    $("guess-count").textContent = guesses.length ? `(${guesses.length})` : "";
    drawScore();
  }

  // the score: guesses, the hints used (user, 20-10-2026: every use
  // counted), accuracy and how much of the paper is restored (user,
  // 09-10-2026); an older core.js (a deploy's mixed cache) leaves out what
  // it can't count
  function drawScore() {
    const parts = [];
    if (guesses.length) parts.push(`${guesses.length} guess${guesses.length === 1 ? "" : "es"}`);
    if (C.hintCount && hints.length) parts.push(C.hintCount(hints.length));
    if (guesses.length) {
      parts.push(`${C.accuracy(hits)}% accuracy`);
      if (C.restoredShare) parts.push(`${C.restoredShare(restored, tokens.length)} restored`);
    }
    $("score").textContent = parts.join(" · ");
  }

  // a guess's row marked selected or not: its look (sel) and, for a screen
  // reader, its word's button (pre-push review of 14-10-2026, C3: whether a
  // press selects a guess or steps through it depends on it)
  function markRow(tr, on, b = tr.querySelector(".guess-word")) {
    tr.classList.toggle("sel", on);
    if (!b) return;
    if (on) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }

  // light up a guess's places and select its row; `jump` goes on to its next
  // place (the first after a fresh selection, wrapping round), marks it,
  // brings it into view and counts it. Returns how many places it has.
  function select(i, jump) {
    for (const el of document.querySelectorAll(".hl, .cur")) el.classList.remove("hl", "cur");
    if (!selected || selected.i !== i) selected = { i, pos: -1, chosen: false };
    const places = placesOf(guesses[i]);
    for (const p of places) tokens[p].el.classList.add("hl");
    if (jump && places.length) {
      selected.pos = (selected.pos + 1) % places.length;
      const el = tokens[places[selected.pos]].el;
      el.classList.add("cur");
      jumpTo(el);
      say(`“${guesses[i]}”: ${selected.pos + 1} of ${places.length}`);
    }
    for (const tr of $("guess-list").children) markRow(tr, +tr.dataset.i === i);
    return places.length;
  }

  // The jump to a guess's place: smooth, unless the player turned the glide
  // off in Settings (user, 09-10-2026) or asked for less motion (review of
  // 08-10-2026): then instant ("auto" is instant, as no stylesheet sets
  // scroll-behavior). With the glide off the paper's blocks draw only near
  // the view where the browser has scroll anchoring (setUpSettings;
  // content-visibility, Claude's proposal of 09-10-2026: a long
  // paper's first screen about 2.5x faster, notes/render-speed.md); the
  // blocks it passes take a guessed height until drawn, so the jump is
  // made again in the next frames, as they get their real height.
  let jumpSeq = 0;
  function jumpTo(el) {
    const smooth = glide && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    if (glide) return;
    const seq = ++jumpSeq;
    let frames = 0;
    const again = () => {
      if (seq !== jumpSeq) return; // a newer jump took over
      el.scrollIntoView({ block: "center", behavior: "auto" });
      if (++frames < 3) requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }

  // A guess picked in the list, or guessed again (user, 08-10-2026: so the
  // player never hunts for it in the list). The first pick only selects it
  // (user, 14-10-2026: "first highlight the word, on the second click, it
  // starts going through all the appearances of that word one by one"): its
  // places lit, its row selected, the count said ("5 places highlighted"),
  // the page left where it is. A pick of the guess so chosen goes on to its
  // next place, the first after a fresh pick, wrapping round, and brings it
  // into view ("2 of 5"). A new guess lights its places too but isn't
  // chosen: a click on it, or the word typed again, is still a first pick.
  // Picking another guess, or typing another word (guess), starts over.
  // Returns whether it went on (a second pick). Either way the row comes
  // into view in the list, scrolled inside the
  // list's own box (scrolling the row into view would stop the page's jump).
  // A row out of sight goes near the top of the box, a row's room above
  // it if the box has that room (at the top of the page the box can reach
  // below the screen). On a phone in landscape the box is lower than one
  // row: the row is centred in it, so its word shows (review and re-check
  // of 08-10-2026: the room above pushed the row out of such a box, then
  // its top edge cut the word).
  function pick(i) {
    const step = !!selected && selected.i === i && selected.chosen;
    if (!step) selected = { i, pos: -1, chosen: true };
    const n = select(i, step);
    if (!n) say(`“${guesses[i]}” is not in the paper`);
    else if (!step) say(`“${guesses[i]}”: ${n} place${n === 1 ? "" : "s"} highlighted`);
    const box = $("guesses-box");
    const row = $("guess-list").querySelector(`tr[data-i="${i}"]`);
    if (!box.open || !row) return step;
    const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
    // the box's part on screen (all of it, if none is)
    let top = Math.max(b.top, 0), bottom = Math.min(b.bottom, innerHeight);
    if (bottom <= top) { top = b.top; bottom = b.bottom; }
    if (r.height > bottom - top) {
      box.scrollTop += (r.top + r.bottom) / 2 - (top + bottom) / 2;
    } else if (r.top < top || r.bottom > bottom) {
      box.scrollTop += r.top - b.top - Math.min(r.height, bottom - top - r.height);
    }
    return step;
  }

  function say(text) {
    $("message").textContent = text;
  }

  /* ============ hints ============ */

  // Hints (user, 20-10-2026: "hint buttons for when someone is stuck"; the
  // kind chosen, "Reveal a word", every use counted). Hint arms a reveal:
  // the next click or tap on a black bar in the text reveals that word in
  // that one place (Claude's call, as in Redactle), never a word of the
  // title in any form (core.js's canReveal); Hint again, or Escape, cancels.
  // From the keyboard, arming focuses a bar in view (one bar at a time
  // takes the focus, a button labelled as every bar is: "redacted, 6
  // characters"), the arrow keys go to the bar before or after, Enter or
  // Space reveals it. A screen reader's click on any bar reveals it too.
  // A guess or the game's end cancels. Used hints are saved with the game
  // and counted in the score, the result and a shared result.
  // While armed, every bar a hint may reveal has a border, the others none
  // (user, 20-10-2026: "the words you can reveal have an obvious border
  // around the bars. The words / bars you cannot reveal do not."): a bar of
  // a title word in any form is marked no-hint once the paper is drawn
  // (markRefused), the stylesheet draws the border, the arrow keys go only
  // from one bordered bar to the next, and the armed message says how many
  // there are. A pick of a bar without one is refused, free, as before.
  let armed = false;
  let rover = null; // the bar that takes the focus while armed
  const hintButton = $("hint-button"); // an older index.html has none

  // place i revealed by a hint: shown, marked as a hint's, not restored
  const showHint = i => show(tokens[i], "k hint");

  // the bars of the text a hint can't reveal (core.js's canReveal), marked
  // no-hint, once the paper is drawn and the save's guesses restored: the
  // title is the same all game, and a bar a guess restores later loses the
  // class with its bar (show)
  function markRefused() {
    const refused = new Map();
    for (let i = bodyFrom; i < tokens.length; i++) {
      const t = tokens[i];
      if (!refused.has(t.n)) refused.set(t.n, !C.canReveal(t.n, paper.title));
      if (refused.get(t.n) && t.el.classList.contains("r")) t.el.classList.add("no-hint");
    }
  }

  // a bar a hint may reveal (bordered while armed): a black bar of the
  // text, not of a title word
  const revealable = el => el.classList.contains("r") && !el.classList.contains("no-hint");
  const REVEALABLE = "span.r:not(.no-hint)";

  // a save's hints shown again (after the guesses: a place a guess restored
  // since stays restored), each on its word's k-th place if the paper still
  // has it there and it may be revealed; every saved hint counts
  function showSavedHints() {
    for (const h of hints) {
      const i = (byNorm.get(h.n) || [])[h.k];
      if (i !== undefined && i >= bodyFrom && tokens[i].el.classList.contains("r") && C.canReveal(h.n, paper.title)) showHint(i);
    }
  }

  // the bar that takes the focus: role button and in the tab order while
  // armed, a plain bar again after
  function setRover(el, focus) {
    if (rover && rover !== el) {
      rover.removeAttribute("tabindex");
      if (rover.classList.contains("r")) rover.setAttribute("role", "img");
    }
    rover = el;
    if (!el) return;
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    if (!focus) return;
    el.focus({ preventScroll: true });
    if (!onScreen(el)) el.scrollIntoView({ block: "center" });
  }

  // the part of the screen the paper shows: below its sticky title, above
  // the panel docked at the bottom on a phone (the stylesheet's breakpoint;
  // on a desktop the panel stands beside the paper)
  function paperView() {
    const title = $("paper-title").getBoundingClientRect();
    const docked = matchMedia("(max-width: 760px)").matches;
    return { top: Math.max(0, title.bottom), bottom: docked ? Math.min(innerHeight, $("panel").getBoundingClientRect().top) : innerHeight };
  }
  function onScreen(el) {
    const r = el.getBoundingClientRect(), v = paperView();
    return r.top >= v.top && r.bottom <= v.bottom && r.width > 0;
  }

  // the first bar a hint may reveal wholly on screen, or null: the blocks
  // lie one under the other, so the first reaching the view is found by
  // halving (as numberInView does)
  function barInView() {
    const v = paperView();
    let lo = 0, hi = barBlocks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (barBlocks[mid].getBoundingClientRect().bottom < v.top) lo = mid + 1;
      else hi = mid;
    }
    for (let b = lo; b < barBlocks.length && barBlocks[b].getBoundingClientRect().top < v.bottom; b++) {
      for (const el of barBlocks[b].querySelectorAll(REVEALABLE)) if (onScreen(el)) return el;
    }
    return null;
  }

  // the next bar a hint may reveal after (step 1) or before (step -1) place i
  function barFrom(i, step) {
    for (let j = i + step; j >= bodyFrom && j < tokens.length; j += step) {
      if (revealable(tokens[j].el)) return tokens[j].el;
    }
    return null;
  }

  // keyboard: whether the press came from the keyboard (a click with detail
  // 0), which then moves the focus to a bar, scrolling to the first one if
  // none is on screen; a mouse or tap leaves the page where it is
  function arm(keyboard) {
    if (done || armed || !C.canReveal) return;
    const start = barInView() || (keyboard ? barFrom(bodyFrom - 1, 1) : null);
    if (!start && !barFrom(bodyFrom - 1, 1)) { say("No black bar left in the text can be revealed"); return; }
    armed = true;
    hintButton.setAttribute("aria-pressed", "true");
    $("paper").classList.add("arming");
    // how many, said for a screen reader too (the borders are only seen)
    const can = `${$("paper-body").querySelectorAll(REVEALABLE).length} can be revealed`;
    say(keyboard ? `Hint: choose a bordered bar with the arrow keys and press Enter; ${can}. Escape cancels`
      : `Hint: click or tap a bordered bar to reveal its word; ${can}. Hint again cancels`);
    if (start) setRover(start, true);
  }

  // returns whether a bar had the focus
  function disarm() {
    if (!armed) return false;
    armed = false;
    if (hintButton) hintButton.setAttribute("aria-pressed", "false");
    $("paper").classList.remove("arming");
    const had = !!rover && document.activeElement === rover;
    setRover(null);
    return had;
  }

  // a bar picked while armed: revealed, or refused if it is a title word
  function reveal(el, keyboard) {
    const i = tokenAt.get(el);
    if (i === undefined || !el.classList.contains("r")) return;
    const t = tokens[i];
    if (i < bodyFrom || !C.canReveal(t.n, paper.title)) {
      say("That word is in the title, so a hint can't reveal it");
      return;
    }
    hints.push({ n: t.n, k: byNorm.get(t.n).indexOf(i) });
    disarm();
    showHint(i);
    say(`Revealed “${t.w}” (hint ${hints.length})`);
    drawScore();
    save();
    // on to the next guess; a tap leaves the on-screen keyboard closed
    if (keyboard || !matchMedia(C.TOUCH_ONLY).matches) $("guess-input").focus({ preventScroll: true });
  }

  if (hintButton) {
    hintButton.addEventListener("click", e => {
      if (!armed) { arm(e.detail === 0); return; }
      disarm();
      say("Hint cancelled");
    });
    $("paper").addEventListener("click", e => {
      const el = armed && e.target.closest && e.target.closest("span.r");
      if (el) reveal(el, e.detail === 0);
    });
    $("paper").addEventListener("keydown", e => {
      if (!armed || e.target !== rover) return;
      const i = tokenAt.get(rover);
      let to = null;
      if (e.key === "Enter" || e.key === " ") reveal(rover, true);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") to = barFrom(i, 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = barFrom(i, -1);
      else return;
      e.preventDefault();
      if (to) setRover(to, true);
    });
    document.addEventListener("keydown", e => {
      // Escape in the open Settings dialog closes the dialog only
      if (e.key !== "Escape" || !armed || ($("settings") && $("settings").open)) return;
      e.preventDefault();
      if (disarm()) hintButton.focus();
      say("Hint cancelled");
    });
  }

  /* ============ playing ============ */

  // One word, or each part of "light-curve" / "Hubble's" in turn (a part
  // that is a small word or already restored is passed over). Another form
  // of an earlier guess is refused only when it would restore nothing new:
  // after "find", "found" still counts if "founded" is in the paper.
  // Returns true when the field should keep what was typed: a word guessed
  // before, so Enter again goes on through its places.
  function guess(input) {
    if (done) return false;
    const parts = C.guessParts(input);
    if (parts.error !== undefined) {
      // another word typed starts a pick over (an empty field changes nothing)
      if (parts.error && selected) selected.chosen = false;
      say(parts.error);
      return false;
    }
    const said = [];
    let refused = null; // the first part refused (a single word's message)
    const again = [];   // the parts guessed before: { repeat, form }
    let other = false;  // a part refused for another reason than being
                        // guessed before or a small word (too long)
    for (const raw of parts.words) {
      let r = C.checkGuess(raw, guesses);
      if (r.error === undefined) {
        const twin = C.twinOf(r.n, guesses);
        if (twin !== undefined && hiddenPlaces(r.n) === 0) {
          r = { error: `Already restored by “${twin}”`, repeat: twin, form: true };
        }
      }
      if (r.error !== undefined) {
        refused = refused || r;
        if (r.repeat !== undefined) again.push(r);
        else if (!C.isCommon(C.norm(raw))) other = true;
        continue;
      }
      guesses.push(r.n);
      const fresh = restore(r.n);
      const total = hits[hits.length - 1];
      said.push(fresh ? `“${r.n}”: restored ${fresh}×`
        : total ? `“${r.n}”: nothing new (all ${total} already restored)`
        : `“${r.n}” is not in the paper`);
    }
    if (!said.length) {
      // Nothing new. A word guessed before (the same word, another form of
      // it that restores nothing new, or each part of a joined guess) acts
      // as if that guess were picked in the list (user, 08-10-2026: never
      // hunt for it in the list; the other form and joined guesses:
      // coordinator, same reason). The first time it only selects that
      // guess, and the message ("You already guessed …") comes after the
      // pick's own, so it stays; the same again (Enter once more: the field
      // keeps it) goes on to its next place, counted ("2 of 5"; user,
      // 14-10-2026: "It should only do this on second enter"). Any other
      // word starts over.
      if (again.length && pick(guesses.indexOf(again[0].repeat))) return true;
      if (!again.length && selected) selected.chosen = false;
      say(parts.words.length === 1 ? refused.error
        // quoted as read, as a single word's message is (re-check of
        // 08-10-2026: the field's own quotes were doubled)
        : again.length && !other && again.every(r => !r.form)
          ? `You already guessed “${C.cleanGuess ? C.cleanGuess(input) : input.trim()}”`
        : "Nothing new to restore in that");
      return again.length > 0;
    }
    // figures whose caption is now restored far enough come back
    const back = C.figureRevealed ? revealFigures(false) : [];
    if (back.length) said.push(back.length === 1 ? `${back[0].name} restored` : `${back.length} figures restored`);
    say(said.join(" · "));
    selected = null;
    drawGuesses();
    select(guesses.length - 1, false);
    if (C.isSolved(paper.title, guesses)) finish("won");
    save();
    return false;
  }

  function finish(how) {
    done = how;
    disarm();
    clock(); // stops: the time up to this guess
    revealRest();
    revealFigures(true);
    showResult();
    save();
    // said in the status line, and the keyboard lands on the result's
    // first button instead of the closed input. A screen reader hears the
    // time too, in words (pre-push review of 09-10-2026, B4); sighted
    // players see it once, in the result (re-check of 09-10-2026, R2). The
    // two versions sit side by side, each whole: a hidden part inside the
    // sentence lost its leading space in the accessibility tree ("archivein
    // 12 minutes", pre-push review of 09-10-2026, B1). The hidden part's
    // style is inline too, so an older stylesheet (a deploy's mixed cache)
    // doesn't show both (re-check of 09-10-2026, S2)
    if (how === "won" && elapsed !== null && C.playTimeWords) {
      const shown = document.createElement("span"), heard = document.createElement("span");
      shown.setAttribute("aria-hidden", "true");
      shown.textContent = "Restored to the archive!";
      heard.className = "visually-hidden";
      heard.style.cssText = "position:absolute;width:1px;height:1px;margin:0;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
      heard.textContent = `Restored to the archive in ${C.playTimeWords(elapsed)}!`;
      $("message").replaceChildren(shown, heard);
    } else say(how === "won" ? "Restored to the archive!" : `The paper was: ${paper.title}`);
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
    // a daily is shared with its number, so the link opens that puzzle, on
    // any later day too (today's as well: user, 09-10-2026). A share never
    // hints at the answer (the family's rule): no word guessed, no title.
    const url = location.origin + location.pathname + (practice ? "" : `?p=${day}`);
    // the time it took and the hints used, and a give up its own line, with
    // its time too (user, 21-10-2026): core.js's shareLine
    if (C.shareLine) return `${C.shareLine({ name, won: done === "won", guesses: guesses.length,
      accuracy: C.accuracy(hits), ms: elapsed, hints: hints.length })}\n${url}`;
    // an older core.js (a deploy's mixed cache): a win's line as before
    const used = C.hintCount ? C.hintCount(hints.length) : "";
    return `${name}: paper restored in ${guesses.length} guesses (${C.accuracy(hits)}% accuracy)${used ? ` with ${used}` : ""}\n${url}`;
  }

  function showResult() {
    const box = $("result");
    box.replaceChildren();
    const head = document.createElement("p");
    head.className = "result-head";
    head.textContent = done === "won" ? "Restored to the archive!" : "The paper was:";
    box.append(head);
    // how long it took (user, 09-10-2026), for a game timed from its start;
    // a give up's too (user, 21-10-2026), as its share says it: core.js's
    // resultTime; an older core.js (a deploy's mixed cache): a win's only
    const took = C.resultTime ? C.resultTime({ won: done === "won", guesses: guesses.length, ms: elapsed })
      : done === "won" && elapsed !== null && C.playTime ? `Restored in ${C.playTime(elapsed)}` : "";
    if (took) {
      const time = document.createElement("p");
      time.className = "result-time";
      time.textContent = took;
      box.append(time);
    }
    // the hints used (user, 20-10-2026: every use counted), won or not
    const used = C.hintCount ? C.hintCount(hints.length) : "";
    if (used) {
      const line = document.createElement("p");
      line.className = "result-hints";
      line.textContent = `${used} used`;
      box.append(line);
    }
    box.append(...cite());
    const row = document.createElement("p");
    row.className = "result-actions";
    // a give up is shared too, with its own line (user, 21-10-2026); an
    // older core.js has no line for it, so no Share
    if (done === "won" || C.shareLine) {
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
    // the other daily sky puzzles, when a game is done (add a game here once
    // it can be played: Constelle)
    const more = document.createElement("p");
    more.className = "more-games";
    const muldle = document.createElement("a");
    muldle.href = "../muldle/";
    muldle.textContent = "Muldle";
    const hub = document.createElement("a");
    hub.href = "../";
    hub.textContent = "Urania’s Mirror";
    more.append("More daily sky puzzles: ", muldle, " · all of ", hub);
    box.append(more);
    box.hidden = false;
    // The stamp is the game's fiction: it never stands beside a real
    // paper's revealed title saying RETRACTED. A win stamps it RESTORED;
    // giving up takes it away.
    $("stamp").textContent = "RESTORED";
    $("stamp").classList.add("restored");
    $("stamp").hidden = done !== "won";
    $("guess-input").disabled = true;
    $("guess-submit").disabled = true;
    if (hintButton) hintButton.disabled = hintButton.hidden = true;
    $("guess-form").hidden = true; // leaves the room to the paper
    $("give-up").hidden = true;
    linkFigures();
  }

  // a fresh practice paper, never the one just played
  function newPractice() {
    const p = randomPaper(paper);
    try {
      // the game left goes first, so a full storage can't keep it in play
      localStorage.removeItem(PRACTICE_KEY);
      localStorage.setItem(PRACTICE_KEY, JSON.stringify({ id: p.id, v: p.v, guesses: [], done: null }));
    } catch { /* unsaved: the reload picks another random paper */ }
    location.reload();
  }

  /* ============ Settings ============ */

  // Settings (user, 09-10-2026), as Muldle's: a dialog behind the gear, top
  // right. Smooth jumps (the glide): on by default with a mouse or
  // trackpad, off on a touch screen (core.js's glideOn), the player's own
  // choice first; off, the jumps are instant and, where the browser has
  // scroll anchoring, the paper draws only near the view (jumpTo, and the
  // stylesheet's .anchoring.glide-off). Kept in this
  // browser only, once the player switches it.
  let glide = true;
  function setUpSettings() {
    const kept = load(SETTINGS_KEY);
    // an older core.js (a deploy's mixed cache): on unless switched off
    glide = C.glideOn ? C.glideOn(kept, matchMedia(C.TOUCH_ONLY).matches) : !(kept && kept.glide === false);
    // Drawing only near the view needs scroll anchoring, which keeps the
    // text in place as blocks above the view get their real height. WebKit
    // (Safari, every iPhone and iPad) has none: there the text jumped as the
    // player scrolled up after a jump (review of 09-10-2026, B2), so there
    // the glide off means instant jumps only, and Settings says no more.
    const anchoring = !!(window.CSS && CSS.supports && CSS.supports("overflow-anchor", "auto"));
    document.documentElement.classList.toggle("anchoring", anchoring);
    const faster = $("glide-faster");
    if (!anchoring && faster) faster.remove();
    document.documentElement.classList.toggle("glide-off", !glide);
    const dialog = $("settings"), button = $("settings-button"), box = $("glide-toggle");
    if (!dialog || !button || !box || !dialog.showModal) return; // an older index.html
    box.checked = glide;
    box.addEventListener("change", () => {
      glide = box.checked;
      keepPlace(() => document.documentElement.classList.toggle("glide-off", !glide));
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ glide })); } catch { /* unsaved */ }
    });
    $("settings-reduced").hidden = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    button.hidden = false;
    button.addEventListener("click", () => dialog.showModal());
    $("settings-close").addEventListener("click", () => dialog.close());
    // a click on the backdrop (outside the dialog's box) closes it; only
    // the dialog's own clicks count: a key's click on the checkbox (Space)
    // comes at 0,0 (pre-push review of 09-10-2026, A1: it closed the dialog)
    dialog.addEventListener("click", e => {
      const r = dialog.getBoundingClientRect();
      if (e.target === dialog &&
        (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
    });
  }

  // Switching the glide changes the height of every block off screen (drawn
  // only near the view, or all drawn), so the view would land far from where
  // the player was reading (pre-push review of 09-10-2026, B2: the gear is
  // at the top, but the page scrolls behind the open dialog). The first
  // block reaching into the view is held where it was (the end of the paper,
  // if the view is below it), now and in the next frames, as blocks near
  // the view get their real height.
  function keepPlace(change) {
    const blocks = $("paper-body").children;
    let el = [...blocks].find(b => b.getBoundingClientRect().bottom > 0);
    const edge = el ? r => r.top : r => r.bottom;
    el = el || blocks[blocks.length - 1];
    if (!el) return change();
    const at = edge(el.getBoundingClientRect());
    change();
    let frames = 0;
    const hold = () => {
      scrollBy({ top: edge(el.getBoundingClientRect()) - at, behavior: "instant" });
      if (++frames < 4) requestAnimationFrame(hold);
    };
    hold();
  }

  /* ============ What's new ============ */

  // One fold under How to play: the latest update (What's new), On the
  // horizon (only while there are plans) and Earlier updates (folded, each
  // entry its own fold), from news.js; core.js's newsParts decides what goes
  // where and what opens. Whether this browser showed the latest update is
  // remembered (local only, nothing is sent). A draft (news-drafts.js, on
  // the development page only) is marked as one.
  const SEEN_KEY = "retractle-seen-v1"; // the id of the latest update shown

  function drawNews(returning) {
    const box = $("news");
    // an older index.html or core.js, or no news.js (a deploy's mixed
    // cache): no What's new, the game as before
    if (!box || !C.newsParts || typeof RETRACTLE_NEWS === "undefined") return;
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch { /* private window */ }
    const parts = C.newsParts(RETRACTLE_NEWS, today, seen, returning);
    if (!parts.latest && !parts.horizon.length) return;
    const fmt = d => new Date(d.y, d.m - 1, d.d)
      .toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    // a title, then its dim date ("planned" for a plan, "from" a coming
    // switch's date) and a draft's mark, a space apart so a screen reader
    // doesn't run them together
    const when = ({ entry, date }, coming) => {
      const span = document.createElement("span");
      span.className = "news-when";
      span.textContent = !date ? (coming ? "planned" : "") : (coming ? "from " : "") + fmt(date);
      if (entry.draft) {
        const mark = document.createElement("span");
        mark.className = "news-draft";
        mark.textContent = "draft";
        span.append(span.textContent ? " · " : "", mark);
      }
      return span;
    };
    const items = list => {
      const ul = document.createElement("ul");
      for (const text of list || []) {
        const li = document.createElement("li");
        li.textContent = text;
        ul.append(li);
      }
      return ul;
    };
    if (parts.latest) {
      $("news-when").replaceChildren(...when(parts.latest, false).childNodes);
      const title = document.createElement("p");
      title.className = "news-title";
      title.textContent = parts.latest.entry.title;
      $("news-latest").replaceChildren(title, items(parts.latest.entry.items));
      box.dataset.id = parts.latest.entry.id;
    }
    if (parts.horizon.length) {
      $("news-horizon-list").replaceChildren(...parts.horizon.map(h => {
        const entry = document.createElement("div");
        entry.className = "news-entry";
        entry.dataset.id = h.entry.id;
        const title = document.createElement("p");
        title.className = "news-title";
        title.append(h.entry.title, " ", when(h, true));
        entry.append(title);
        if (h.entry.items && h.entry.items.length) entry.append(items(h.entry.items));
        return entry;
      }));
      $("news-horizon").hidden = false;
    }
    if (parts.earlier.length) {
      $("news-earlier-list").replaceChildren(...parts.earlier.map(e => {
        const entry = document.createElement("details");
        entry.className = "news-entry";
        entry.dataset.id = e.entry.id;
        entry.open = e.open;
        const summary = document.createElement("summary");
        summary.append(e.entry.title, " ", when(e, false));
        entry.append(summary, items(e.entry.items));
        return entry;
      }));
      $("news-earlier").open = parts.earlierOpen;
      $("news-earlier").hidden = false;
    }
    box.open = parts.latestOpen;
    box.hidden = false;
    // shown: folded from the next visit on, until a newer update (a draft
    // isn't remembered: it may still change)
    if (parts.latest && !parts.latest.entry.draft) {
      try { localStorage.setItem(SEEN_KEY, parts.latest.entry.id); } catch { /* unsaved */ }
    }
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
    // a first visit opens How to play; a returning player, What's new on
    // an update they haven't seen
    const returning = !!(load(DAILY_KEY) || load(PRACTICE_KEY) || load(ARCHIVE_KEY));
    if (!returning) $("help").open = true;
    try {
      drawNews(returning);
    } catch (e) {
      // What's new is extra: the game plays without it
      console.error("What's new:", e);
    }
    keepPastDaily();
    const { p, s } = choosePuzzle();
    paper = p;
    guesses = s ? s.guesses.slice() : [];
    // an older core.js (a deploy's mixed cache) has no hints
    hints = s && C.saveHints ? C.saveHints(s).map(h => ({ n: h.n, k: h.k })) : [];
    done = s ? s.done : null;
    // an older core.js (a deploy's mixed cache) keeps no time
    elapsed = C.timeOfSave ? C.timeOfSave(s) : null;
    setUpSettings();
    const navFocused = setUpNav();
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
      restored = 0;
      for (const g of guesses) restore(g);
      if (C.canReveal) { markRefused(); showSavedHints(); }
      drawGuesses();
      if (C.figureRevealed) revealFigures(!!done);
      if (done) {
        revealRest();
        showResult();
      } else {
        $("guess-input").disabled = false;
        $("guess-submit").disabled = false;
        if (hintButton && C.canReveal) hintButton.disabled = hintButton.hidden = false;
        $("give-up").hidden = false;
        showLength(); // a browser may have kept the field's text over a reload
        if (!navFocused) $("guess-input").focus();
      }
      // the bars on screen show their numbers in the first paint
      numberInView();
      ready = true;
      clock(); // a game in play is timed from here while in view
    } catch (e) {
      // not arXiv's fault, and not the save's (validSave checked it): keep
      // the save, so a passing fault (a half-updated cache during a deploy)
      // costs no one their game
      $("paper-title").replaceChildren();
      $("paper-body").replaceChildren();
      $("guess-input").disabled = $("guess-submit").disabled = true;
      fail(`Something went wrong setting up the paper (${e.message}).`);
      return;
    }
    window.__retractle = { paper, tokens, guesses: () => guesses, hints: () => hints, blocks, day, today, time: () => elapsed,
      figures: () => figures.map(f => ({ id: f.block.id, name: f.name, shown: f.shown, images: f.images.length, hidden: f.to - f.from })) };
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

  // What's typed, counted as the bars count it (user, 08-10-2026: "5-5" for
  // "light-curve"), at the field's right end, after every change: typing,
  // deleting, pasting, cutting, the field cleared after a guess. Hidden
  // while the field is empty; the text keeps clear of it. Its room is half
  // the field: where wide characters (em dashes, emoji) overflow it on a
  // narrow phone, the count is asked for in fewer characters until it fits,
  // so its end, the word being typed, stays in view (re-check of
  // 08-10-2026: at 320 px the end was clipped). The stylesheet clips any
  // rest from the start.
  function showLength() {
    const input = $("guess-input");
    const out = $("guess-length");
    // an older index.html or core.js (a deploy's mixed cache): no count
    if (!out || !C.typedLengths) return;
    const fits = () => {
      const text = document.createRange();
      text.selectNodeContents(out);
      return text.getBoundingClientRect().width <= out.getBoundingClientRect().width + 0.5;
    };
    let text = C.typedLengths(input.value);
    for (let max = [...text].length - 1; ; max--) {
      out.textContent = text;
      out.hidden = !text;
      if (!text || max < 3 || fits()) break;
      text = C.typedLengths(input.value, max);
    }
    input.style.paddingRight = text ? `calc(${out.offsetWidth}px + 1rem)` : "";
  }
  $("guess-input").addEventListener("input", showLength);

  // A word guessed before stays in the field, selected: Enter again goes on
  // through its places (as a find in a page does), typing replaces it
  // (user, 14-10-2026: "It should only do this on second enter"). While it
  // stands there unedited, each click or tap into the field, and the field
  // coming back into focus, selects it whole again, so typing still
  // replaces it (pre-push review of 14-10-2026, B1: a click left a caret in
  // it, and the next word typed ran on, "quasarnebula", a counted miss).
  // The arrow keys still edit it; once edited, clicks act as usual.
  let keptWord = null;
  const isKept = () => keptWord !== null && $("guess-input").value === keptWord;
  const selectKept = () => {
    const input = $("guess-input");
    if (isKept()) input.setSelectionRange(0, input.value.length);
  };
  $("guess-input").addEventListener("input", () => { keptWord = null; });
  $("guess-input").addEventListener("focus", selectKept);
  $("guess-input").addEventListener("click", selectKept);
  // a press in the field would put a caret in the word on its release,
  // after the click (Chrome): the release leaves the selection as it is
  $("guess-input").addEventListener("mouseup", e => {
    if (document.activeElement === e.target && isKept()) e.preventDefault();
  });

  $("guess-form").addEventListener("submit", e => {
    e.preventDefault();
    disarm(); // a guess cancels a hint not yet used
    const input = $("guess-input");
    const keep = guess(input.value);
    if (!keep) input.value = "";
    keptWord = keep ? input.value : null;
    showLength();
    input.focus();
    selectKept();
  });

  $("give-up").addEventListener("click", () => {
    if (!done && confirm("Give up and show the whole paper?")) finish("gaveup");
  });

  start();
})();
