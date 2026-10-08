# Retractle

**Play: <https://bertblookers.github.io/retractle/>** — *a work in progress.*

A paper has been accidentally retracted! It's on you to repair the damaged
document and make sure it's restored into the archive.

Each day one famous astronomy paper from arXiv appears with every word
blacked out, except small words like *the*, *of* and *and*. Guess a word and
it is restored everywhere it appears, in all its forms (observe, observed,
observing; galaxy, galaxies). Restore every word of the title to win. Your
score is the number of guesses and the share of them that restored
something. Each black bar shows how many characters it hides, and the
guess box counts what you type the same way.

None of these papers was really retracted: they are well-known, well-loved
papers, and the "retraction" is only the game's story.

While it is a work in progress, future papers and the rules may still
change; the papers of days already played never do.

Retractle is one of the daily sky puzzles of
[Urania's Mirror](https://bertblookers.github.io/), next to
[Muldle](https://bertblookers.github.io/muldle/).

## Where the papers come from

Retractle keeps no paper text. When you play, your browser loads the paper
straight from arXiv's own HTML version of it (`arxiv.org/html/<id>`), and
the game blacks out the words on your screen. This repository holds only
each paper's arXiv identifier, version, title, authors and year (arXiv
metadata, released under CC0). After a game, Retractle names the paper in
full, links to its arXiv page and shows the license arXiv states for it.
Copyright of every paper stays with its authors.

## Privacy

No accounts and no tracking. Everything Retractle remembers, such as your
games, is kept only in your own browser (`localStorage`). Retractle's one
outside request is the day's paper, loaded from arxiv.org.

## Run locally

It's a static site: serve the repository root with any web server, e.g.

```
python -m http.server 8082
```

then open <http://localhost:8082>. Retractle needs a network connection to
load its paper from arXiv. Locally, the Urania's Mirror mark top left
leads back to the game itself; on the live site it leads to the hub.

## Inspiration

Retractle is inspired by [Redactle](https://redactle.net), which does the
same with Wikipedia articles. Retractle is an independent hobby project with
no affiliation to or endorsement by Redactle or arXiv.

## Data & attribution

See [ATTRIBUTION.md](ATTRIBUTION.md): arXiv (the papers and their metadata)
and AGID by Kevin Atkinson (the word forms).

## License

The code is licensed under the GNU Affero General Public License v3.0; see
[LICENSE](LICENSE). SPDX: `AGPL-3.0-only`. The word-form table `lemmas.js`
is under AGID's own permissive license, in `LICENSE-AGID.txt`. The paper
list `papers.js` is arXiv metadata under CC0. `shared.css` (the look
Retractle shares with the hub) is copied from the hub's repository,
[bertblookers/bertblookers.github.io](https://github.com/bertblookers/bertblookers.github.io).
