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
      id: "share-time-give-up", // drafted 21-10-2026 (agent Yankee-3); approved by the user that day ("Otherwise ok"),
      // its second line then given the give up's time (the user's change that day); dated the approval day: set the
      // release day at the export
      date: { y: 2026, m: 10, d: 21 },
      title: "Your time in a shared result, and sharing a give up",
      items: [
        "A shared result now says how long you took to restore the paper, and how many hints you used, none included.",
        "A paper you gave up on can be shared too, with a line that says you gave up and after how long.",
        "After a give up, the result now shows how long you took, as after a win.",
      ],
    },
    {
      id: "hints", // drafted 20-10-2026 (agent India-3); approved by the user that day ("OK as written"),
      // live with that day's release (the user: "push when ready"); a later release moves the date
      date: { y: 2026, m: 10, d: 20 },
      title: "Hints",
      items: [
        "Stuck? Press Hint, then pick a black bar to reveal its word in that one place. A word of the title can't be revealed.",
        "Each hint is counted in your result and in the result you share.",
      ],
    },
    {
      id: "pick-then-step", // drafted 14-10-2026; approved by the user that day, live with that day's release
      date: { y: 2026, m: 10, d: 14 },
      title: "Going through a guess's places",
      items: [
        "Clicking a guess in the list highlights its places; click it again to go through them one by one.",
        "Typing a word you already guessed highlights it the same way; press Enter again to go through its places.",
      ],
    },
    {
      id: "share-phones", // drafted 09-10-2026 and approved that day; its release was held back
      // for the review's fixes, so it went live with the release of 14-10-2026, dated so (review
      // of 14-10-2026, A1); item 1 narrowed to what the code does (review of 09-10-2026, A2/C2:
      // a practice result's link is bare, and a link opened where its day has not come yet opens
      // that place's today)
      date: { y: 2026, m: 10, d: 14 },
      title: "Shared links, and jumps on phones",
      items: [
        "The link in a shared result opens that same puzzle, on its day or later; a practice result links to today's paper.",
        "On phones and tablets, jumps to a guess's places are instant unless you turn on smooth jumps in Settings (⚙).",
      ],
    },
    {
      id: "time-settings", // drafted 09-10-2026; went live with the release the user approved that day;
      // item 2 reworded the same day, true whatever the default (user, 09-10-2026: off by default on phones),
      // and true without scroll anchoring too (review of 09-10-2026, B2: Safari, iPhone and iPad draw every block)
      date: { y: 2026, m: 10, d: 9 },
      title: "Your time, and Settings",
      items: [
        "A restored paper shows how long you took: the time the page was open and in view, from your first guess.",
        "Settings (⚙, top right) switches the smooth scroll to a guess's places on or off. Off, jumps are instant, and in most browsers long papers open faster.",
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
