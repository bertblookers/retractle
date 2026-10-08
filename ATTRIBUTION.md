# Data & attribution

The AGPL-3.0 code license covers the game code only. The data and services
below are used under their own terms and credited here.

## arXiv — the papers of Retractle

Retractle's papers are loaded at play time, in the player's browser, from
[arXiv](https://arxiv.org)'s HTML rendering of each paper
(`https://arxiv.org/html/<id>v<version>`); the game keeps no copy of any
paper's text. Copyright of each paper stays with its authors, under the
license arXiv states for it, which the game shows after each puzzle together
with the paper's citation and a link to its arXiv page. No paper in the game
was ever retracted: the retraction is only the game's story.

The paper list (`papers.js`) holds arXiv metadata only: each
paper's identifier, version, title, authors and year, taken from the arXiv
API. arXiv releases this metadata under the
[CC0 1.0 Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/).
Two titles are written without their TeX markup.

> Thank you to arXiv for use of its open access interoperability.

Retractle is not affiliated with or endorsed by arXiv.

## AGID — word forms

The table that lets a guess restore every form of a word
(`lemmas.js`) is built from AGID, the Automatically Generated
Inflection Database, version 2016.01.19, Copyright 2000-2016 by Kevin
Atkinson (<http://wordlist.aspell.net>). Only certain forms are kept, in a
compact encoding; plurals the game forms by rule are left out. AGID was
built from several sources, among them:

- WordNet 1.6 Copyright 1997 by Princeton University. All rights reserved.
- The UK Advanced Cryptics Dictionary, Copyright (c) J Ross Beresford
  1993-1999. All Rights Reserved.
- The Moby lexicon and the ENABLE2K word lists (public domain).

AGID's full copyright and source notice, with the complete notices of those
sources, is in [`LICENSE-AGID.txt`](LICENSE-AGID.txt).

## Redactle — the idea

Retractle's rules follow [Redactle](https://redactle.net), a game of
guessing a redacted Wikipedia article: which small words stay visible, a
guess restoring every form of its word, the title as the goal, accuracy as
the score. No code or artwork of Redactle is used. Retractle has no affiliation
with Redactle.

## Urania's Mirror

Retractle is one of the games of
[Urania's Mirror](https://bertblookers.github.io/), whose repository
([bertblookers/bertblookers.github.io](https://github.com/bertblookers/bertblookers.github.io))
is the source of `shared.css`, under the same AGPL-3.0 license.
