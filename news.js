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
  ],
  planned: [
  ],
};

if (typeof module !== "undefined") module.exports = RETRACTLE_NEWS;
