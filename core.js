// SPDX-License-Identifier: AGPL-3.0-only
// Retractle's rules, free of the page: which words stay visible, how a guess
// matches, the daily paper, and turning arXiv's HTML into blocks of words.
// Loaded as a classic script (global RetractleCore); Node tests require() it.

const RetractleCore = (() => {
  "use strict";

  // Never redacted, after Redactle (redactle.net shows these, 07-10-2026):
  // articles, prepositions, conjunctions, forms of "be" / "have", and a few
  // more it leaves visible (this, that, which, it, can, some, used, the "s"
  // of a possessive). Everything else, numbers included, is redacted.
  const COMMON = new Set((
    "a an the and or but if than " +
    "aboard about above across after against along amid among around as at " +
    "because before behind below beneath beside between beyond by " +
    "concerning considering despite down during except following for from " +
    "in including inside into like minus near next of off on onto opposite " +
    "out outside over past per plus regarding round since through till to " +
    "toward towards under underneath unlike until up upon versus via with " +
    "within without " +
    "is are was were be been being has have had " +
    "it this that which can some used s"
  ).split(" "));

  // a word = a run of letters and digits; anything else separates words
  // ("light-curve" is two words, "298.9" too, "Hubble's" is Hubble + s)
  const WORD = /[\p{L}\p{N}]+/gu;
  const ONE_WORD = /^[\p{L}\p{N}]+$/u;

  // case, accents and ligatures don't count: "Schrödinger" is guessed as
  // "schrodinger", "ﬁeld" as "field", "Høg" as "hog", "Łokas" as "lokas"
  const FOLD = { ø: "o", ł: "l", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", þ: "th", ı: "i" };
  function norm(word) {
    return word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[øłæœßđðþı]/g, c => FOLD[c]);
  }

  // Never redacted: the small words, and any word a keyboard can't type
  // (Greek and other scripts: "Hα", "ΛCDM"), which no one could guess.
  function isCommon(n) {
    return COMMON.has(n) || !/^[a-z0-9]+$/.test(n);
  }

  /* ============ word forms ============ */

  // A guess restores every form of its word, like Redactle's dictionary
  // matching: observe / observed / observing / observes, spectrum / spectra,
  // find / found, galaxy / galaxies. Two words match when they share a key:
  // the word itself, its base words in AGID's table (lemmas.js, loaded before
  // this file), and what it is the plural of by rule: stars -> star,
  // galaxies -> galaxy, and -es only after ss, x, z, ch, sh or o (masses ->
  // mass, haloes -> halo), so "mass" never restores "mas" (milliarcseconds)
  // nor "notes" "not"; other plurals (lenses, gases) come from the table. A
  // rule-made key needs three letters, so "us" never restores "uses";
  // numbers only match themselves. tools/build_lemmas.py mirrors this rule.
  const BASES = new Map(); // a form -> its base words

  function useLemmas(text) {
    for (const line of text.split("\n")) {
      const [base, forms] = line.split(":");
      if (!forms) continue;
      for (const code of forms.split(",")) {
        const m = /^(\d*)(.*)$/.exec(code);
        const form = base.slice(0, base.length - (Number(m[1]) || 0)) + m[2];
        if (!BASES.has(form)) BASES.set(form, []);
        BASES.get(form).push(base);
      }
    }
    keyCache.clear();
  }

  const keyCache = new Map();
  function keys(n) {
    let k = keyCache.get(n);
    if (k) return k;
    k = new Set([n]);
    if (!/\d/.test(n)) {
      for (const b of BASES.get(n) || []) k.add(b);
      const singulars = [];
      if (n.endsWith("ies")) singulars.push(n.slice(0, -3) + "y");
      if (/(ss|x|z|ch|sh|o)es$/.test(n)) singulars.push(n.slice(0, -2));
      if (n.endsWith("s") && !/(ss|us|is)$/.test(n)) singulars.push(n.slice(0, -1));
      for (const s of singulars) if (s.length >= 3) k.add(s);
    }
    keyCache.set(n, k);
    return k;
  }

  function related(a, b) {
    if (a === b) return true;
    const kb = keys(b);
    for (const x of keys(a)) if (kb.has(x)) return true;
    return false;
  }

  if (typeof RETRACTLE_LEMMAS === "string") useLemmas(RETRACTLE_LEMMAS);

  // text -> parts: { w } for a word, { t } for what lies between words
  function tokenize(text) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(WORD)) {
      if (m.index > last) parts.push({ t: text.slice(last, m.index) });
      parts.push({ w: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ t: text.slice(last) });
    return parts;
  }

  // What the player typed -> { words } (one, or the parts of a joined guess,
  // split the way the paper's words are: "light-curve" is light + curve,
  // "Hubble's" Hubble + s, "2.4" 2 + 4, as in Redactle) or { error }. Quotes
  // at the ends are dropped ("'Oumuamua").
  const JOINED = /^[\p{L}\p{N}]+(?:[-‐‑–'’.][\p{L}\p{N}]+)+$/u;
  function guessParts(input) {
    const raw = input.trim().replace(/^['’‘"“”.]+|['’‘"“”.]+$/g, "");
    if (!raw) return { error: "" };
    if (ONE_WORD.test(raw)) return { words: [raw] };
    if (JOINED.test(raw)) return { words: raw.split(/[-‐‑–'’.]/) };
    return { error: "One word at a time: letters and digits only" };
  }

  // One word -> { n } (the normalised word) or { error }. Only the same
  // word again is refused here; another form of an earlier guess is up to
  // the page, which knows whether it would still restore anything (`twinOf`).
  // `guessed` holds the earlier guesses (normalised).
  function checkGuess(input, guessed) {
    const raw = input.trim();
    if (!raw) return { error: "" };
    if (!ONE_WORD.test(raw)) return { error: "One word at a time: letters and digits only" };
    const n = norm(raw);
    if (n.length > 40) return { error: "That word is too long" };
    if (isCommon(n)) return { error: `“${raw}” is never redacted` };
    if (guessed.includes(n)) return { error: `You already guessed “${raw}”`, repeat: n };
    return { n };
  }

  // the first earlier guess that is a form of the same word, if any
  function twinOf(n, guessed) {
    return guessed.find(g => related(g, n));
  }

  // the title's words a player has to restore (common ones are given)
  function titleWords(title) {
    const out = [];
    for (const p of tokenize(title)) {
      if (p.w && !isCommon(norm(p.w)) && !out.includes(norm(p.w))) out.push(norm(p.w));
    }
    return out;
  }

  function isSolved(title, guessed) {
    return titleWords(title).every(w => guessed.some(g => related(g, w)));
  }

  // accuracy as in Redactle: the share of guesses that restored something
  function accuracy(hits) {
    if (!hits.length) return 0;
    return Math.round(100 * hits.filter(h => h > 0).length / hits.length);
  }

  /* ============ the daily paper ============ */

  // Puzzle #0 is 2026-10-08, launch day (moved from 2026-10-07, the day the
  // first release was prepared, before anything went public; the seed kept
  // its date). While Retractle is a work in progress, the epoch, the seed
  // and the pool may still change (the page says so); once it is called
  // ready they freeze, like Muldle's eras.
  const EPOCH = { y: 2026, m: 10, d: 8 };
  const SEED = 20261007;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledOrder(list, seed) {
    const arr = list.slice();
    const rand = mulberry32(seed);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // local days since the epoch: a new paper at the player's midnight
  function dayNumber(now = new Date()) {
    const epoch = new Date(EPOCH.y, EPOCH.m - 1, EPOCH.d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - epoch) / 86400000);
  }

  function paperForDay(papers, day) {
    const order = shuffledOrder(papers, SEED);
    return order[((day % order.length) + order.length) % order.length];
  }

  function htmlUrl(p) {
    return `https://arxiv.org/html/${p.id}v${p.v}`;
  }

  function absUrl(p) {
    return `https://arxiv.org/abs/${p.id}v${p.v}`;
  }

  /* ============ arXiv HTML -> blocks ============ */

  // Blocks: { kind: "heading", level, parts } | { kind: "para", parts } |
  // { kind: "caption", parts } | { kind: "label", text } (a visible label
  // such as "Abstract") | { kind: "equation", tag }. Parts are tokenize()'s,
  // plus { tag } (visible numbering: "2.1", "Figure 3:") and { math }.
  // Left out: everything before the abstract (journal front matter, the
  // document's own title: the game draws the clean arXiv one, authors),
  // dates, footnotes, tables, references, acknowledgements, and LaTeX macros
  // LaTeXML didn't know (shown raw, "\jvol").
  const SKIP = [
    ".ltx_authors", ".ltx_dates", ".ltx_bibliography", ".ltx_TOC",
    ".ltx_page_navbar", ".ltx_page_logo", ".ltx_pagination", ".ltx_pubnotes",
    ".ltx_acknowledgements", ".ltx_note", ".ltx_tabular", ".ltx_rdf",
    ".ltx_ERROR", ".ltx_title_document", "nav", "script", "style", "img",
    "svg", "button", "header", "footer",
  ].join(", ");
  const SKIP_SECTION = /^\s*(acknowledge?ments?|references|bibliography)\s*[.:]?\s*$/i;
  // acknowledgements written as a paragraph ("Acknowledgments: we thank…")
  const ACK_PARA = /^\s*acknowledge?ments?\b/i;

  function inline(el, parts) {
    return inlineNodes(el.childNodes, parts);
  }

  function inlineNodes(nodes, parts) {
    for (const n of nodes) {
      if (n.nodeType === 3) {
        parts.push(...tokenize(n.nodeValue));
      } else if (n.nodeType === 1) {
        if (n.localName === "math") parts.push({ math: true });
        else if (n.localName === "br") parts.push({ t: " " });
        else if (n.matches(SKIP)) continue;
        else if (n.classList.contains("ltx_tag")) parts.push({ tag: n.textContent });
        else inline(n, parts);
      }
    }
    return parts;
  }

  // the heading text of a section without its number ("6 Acknowledgments")
  function sectionTitle(sec) {
    const h = sec.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6");
    if (!h) return "";
    let text = "";
    for (const n of h.childNodes) {
      if (!(n.nodeType === 1 && n.classList.contains("ltx_tag"))) text += n.textContent;
    }
    return text;
  }

  // `start`: the abstract; whatever lies before it is front matter
  function walk(el, out, start) {
    for (const child of el.children) {
      if (child.matches(SKIP)) continue;
      if (child.matches(".ltx_para, .ltx_p") && ACK_PARA.test(child.textContent)) continue;
      // 4 = DOCUMENT_POSITION_FOLLOWING: the abstract comes after this child
      if (start && !child.contains(start) && (child.compareDocumentPosition(start) & 4)) continue;
      const name = child.localName;
      if (name === "section" && SKIP_SECTION.test(sectionTitle(child))) continue;
      if (/^h[1-6]$/.test(name)) {
        if (child.classList.contains("ltx_title_abstract")) {
          out.push({ kind: "label", text: child.textContent.trim() });
        } else {
          const parts = inline(child, []);
          if (parts.some(p => p.w)) out.push({ kind: "heading", level: +name[1], parts });
        }
      } else if (child.classList.contains("ltx_p")) {
        const parts = inline(child, []);
        if (parts.some(p => p.w)) out.push({ kind: "para", parts });
      } else if (name === "figcaption") {
        const parts = inline(child, []);
        if (parts.some(p => p.w)) out.push({ kind: "caption", parts });
      } else if (child.matches(".ltx_classification, .ltx_keywords")) {
        // "keywords" (a visible label) and the paper's keywords (redacted),
        // a bare line of text after the label
        const h = child.querySelector("h1, h2, h3, h4, h5, h6");
        if (h) out.push({ kind: "label", text: h.textContent.trim().replace(/[:.]$/, "") });
        const parts = inlineNodes([...child.childNodes].filter(n => n !== h), []);
        if (parts.some(p => p.w)) out.push({ kind: "para", parts });
      } else if (child.matches(".ltx_equation, .ltx_equationgroup")) {
        const tag = child.querySelector(".ltx_tag_equation");
        out.push({ kind: "equation", tag: tag ? tag.textContent.trim() : "" });
      } else {
        walk(child, out, start);
      }
    }
    return out;
  }

  // doc: a Document parsed from arxiv.org/html (DOMParser in the browser)
  function extractBlocks(doc) {
    const article = doc.querySelector("article.ltx_document") || doc.body;
    return walk(article, [], article.querySelector(".ltx_abstract"));
  }

  // the paper's license as arXiv's page states it, shown with the credits;
  // its link only if it is an https one
  function paperLicense(doc) {
    const a = doc.querySelector("#license-tr");
    if (!a) return null;
    const text = a.textContent.replace(/\s+/g, " ").trim().replace(/^License:\s*/i, "");
    const href = a.getAttribute("href") || "";
    return text ? { text, href: /^https:\/\//i.test(href) ? href : "" } : null;
  }

  // Is this arXiv's rendering of a paper (and not, say, an error page that
  // came back with status 200)? `blocks` = extractBlocks(doc).
  function isPaper(doc, blocks) {
    return !!doc.querySelector("article.ltx_document") &&
      blocks.filter(b => b.kind === "para").length >= 3;
  }

  return {
    COMMON, norm, isCommon, useLemmas, related, tokenize, guessParts,
    checkGuess, twinOf, titleWords, isSolved, accuracy, EPOCH, SEED,
    shuffledOrder, dayNumber, paperForDay, htmlUrl, absUrl, extractBlocks,
    paperLicense, isPaper,
  };
})();

if (typeof module !== "undefined") module.exports = RetractleCore;
