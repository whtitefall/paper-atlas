# Paper Atlas

Explore AI research papers from top conferences, journals and arXiv in three views. The site is fully
static: a weekly job fetches paper metadata from the venues' own websites and from arXiv, precomputes
everything, and publishes the result to GitHub Pages. The browser never calls an external API.

**Live site:** https://whtitefall.github.io/paper-atlas/ (available after the first deploy)

| View | What it shows | How it works |
| --- | --- | --- |
| **Paper map** `#/map` | Every paper on one 2D map, placed by what its abstract says. Pick conferences and journals (or select them all), years, and optionally the latest arXiv months. Colour by topic cluster, venue or year, filter by title, author or abstract, and click a paper for its abstract and most similar papers. | Title + abstract embeddings (TF-IDF + SVD, or MiniLM) laid out with UMAP over all papers at once, so any selection is a subset of the same map. k-means topic clusters labelled with their most distinctive terms. |
| **Related papers** `#/graph?seed=…` | A network of the papers most similar to a seed paper, with lists of earlier and newer similar papers. | Every paper's 20 nearest neighbours are precomputed. The graph takes the seed's neighbours plus their closest neighbours and draws the strongest links with d3-force. |
| **Knowledge flows** `#/flows?topic=…` | Papers on a topic over time, one lane per topic cluster, each linked to the most similar earlier papers. Click a paper to see what it builds on and what builds on it. | Matches the topic against titles and per-paper keywords, orders papers by when their venue took place (arXiv by submission month), and links each paper to its most similar earlier matches. This stands in for citations until citation data is added. |

The interface is available in Chinese and English (switch in the top bar).

## Data

| Source | Venues |
| --- | --- |
| ACL Anthology | ACL, EMNLP, NAACL |
| Conference virtual sites | NeurIPS, ICML, ICLR, CVPR, ICCV, ECCV |
| CVF open access | ICCV 2023 |
| AAAI OJS (OAI-PMH) | AAAI |
| ijcai.org proceedings | IJCAI |
| arXiv (OAI-PMH) | cs.AI, cs.CL, cs.CV and cs.LG preprints; the site shows the newest 12 months |

Venues in the picker without data yet (KDD, WWW, SIGIR, TPAMI, IJCV, JMLR, TACL) stay greyed out until
a fetcher is added. [scripts/README.md](scripts/README.md) lists the exact years per source, the file
formats, and how to add a source.

## Running locally

```bash
# 1. Fetch papers and build the atlas (Python 3.10+)
python -m venv .venv
.venv/bin/pip install -r requirements.txt -r scripts/requirements-build.txt   # Windows: .venv\Scripts\pip
.venv/bin/python scripts/fetch.py --all --skip arxiv     # add arXiv later; its first harvest is slow
.venv/bin/python scripts/build_atlas.py

# 2. Run the site
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main`, every
Monday, and on demand. It restores the download cache, fetches new papers, rebuilds the atlas, builds
the site and deploys it to GitHub Pages. It needs **Settings → Pages → Source** set to
**GitHub Actions**. A source that is down doesn't block the deploy; the run uses whatever was fetched.

## Project structure

```
scripts/
  fetch.py, common.py, sources/   paper fetchers, one module per source
  build_atlas.py                  embeddings, 2D map, clusters, neighbours, keywords -> public/data/atlas/
src/
  data.js         loads the static atlas: datasets, abstracts, keywords, neighbour lists
  views/map.js    paper map (canvas + d3-zoom + quadtree hit testing)
  views/graph.js  related-paper graph (SVG + d3-force)
  views/flows.js  knowledge flows (SVG timeline with topic lanes)
  venues.js       venue list, order and typical months
  i18n.js         Chinese and English strings
  ui.js, main.js  routing, tooltips, detail cards, language switch
public/logo.svg   logo
```

## Next steps

- Citation data (for example from Semantic Scholar with a free API key) to replace the similarity
  stand-in in the graph and the flows
- Fetchers for KDD, WWW, SIGIR and the journals
- Sentence-transformer embeddings (MiniLM or SPECTER2) in the weekly build
