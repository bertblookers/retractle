// SPDX-License-Identifier: AGPL-3.0-only
// Retractle's What's new, as data: drawn by retractle.js (with core.js's
// newsParts) into one screen of three parts, What's new, On the horizon and
// Earlier updates (the family's spec: the hub's notes/whats-new.md).
//
// Only what the user approved goes here. Drafts wait in news-drafts.js,
// which never leaves the development repository; an approved entry moves
// here without its `draft` flag.
//
// updates: every update a player would notice, newest first. { id, date:
// { y, m, d }, title, items }: `date` is the day it goes live (set it at
// the export); a pool switch has `era: n` instead of a date and is dated by
// that era's start in core.js's ERAS (On the horizon until then). planned:
// what's planned, { id, title, items }, never a date. Player-facing words
// only (no backlog numbers or internal names), 1-5 one-line items. An id
// never changes: retractle-seen-v1 stores the latest one a browser showed.
const RETRACTLE_NEWS = {
  updates: [
    {
      id: "time-settings", // drafted 09-10-2026; went live with the release the user approved that day
      date: { y: 2026, m: 10, d: 9 },
      title: "Your time, and Settings",
      items: [
        "A restored paper shows how long you took: the time the page was open and in view, from your first guess.",
        "Settings (⚙, top right) can turn off the smooth scroll to a guess's places: jumps are then instant, and long papers open faster.",
      ],
    },
    {
      id: "figures", // approved by the user, 09-10-2026
      date: { y: 2026, m: 10, d: 9 },
      title: "Figures and earlier days' papers",
      items: [
        "Figures are retracted too: each comes back once you've restored 40% of the words hidden in its caption, or when the game ends.",
        "« and » beside the puzzle number take you to earlier days' papers; each day keeps its own game.",
        "The score shows how much of the paper you've restored.",
      ],
    },
    {
      id: "launch", // approved by the user, 09-10-2026: launch day's releases as one entry;
      // the jump on a guess made again and the numbers after a jump and in
      // print moved here from "figures" (they went live on 08-10; T1 of the
      // re-check of 09-10-2026, approved by the user), merged into items 2
      // and 3 to keep five items
      date: { y: 2026, m: 10, d: 8 },
      title: "Launch",
      items: [
        "A famous astronomy paper a day with its words blacked out: restore every word of the title to win.",
        "A guess restores its word everywhere it appears, in all its forms (galaxy, galaxies; observe, observed). Guessing it again, or another form of it, takes you to its places.",
        "Each bar shows how many characters it hides (at once after a jump, and in print), and the guess box counts what you type the same way.",
        "Formulas are shown as in the paper, their words redacted too.",
        "Practice papers, a result to share, and a link top left to the other daily sky puzzles.",
      ],
    },
  ],
  planned: [
    {
      id: "more-papers", // approved by the user, 09-10-2026
      title: "More papers",
      items: ["More famous papers for the days to come, later some of the most-cited too. Days already played keep their papers."],
    },
  ],
};

if (typeof module !== "undefined") module.exports = RETRACTLE_NEWS;
