# Paper Atlas

A browser-only web app for exploring research papers, with three views:

| View | What it shows | How it works |
| --- | --- | --- |
| **Paper map** `#/map` | All papers of a venue or query laid out on a 2D plane by meaning. Search to highlight, colour by cluster / year / subfield, click a paper for details. | Title + abstract → TF-IDF → 96-dim random projection → UMAP (2D). k-means clusters, each labelled with its most distinctive terms. |
| **Related-paper graph** `#/graph?seed=W…` | A network of the papers most similar to a seed paper, plus "prior works" and "derivative works" lists. | Candidate pool = the seed's references + its most-cited citing papers + OpenAlex related works. Similarity = bibliographic coupling (shared references) + co-citation (cited together) + a bonus for direct citation. The top 40 are drawn as a force-directed graph. |
| **Knowledge flows** `#/flows?topic=…` | The most-cited papers on a topic, placed by year × research subfield, with curves for citations between them. Click a paper to highlight its upstream sources and downstream influence. | Takes the top-N most-cited papers for the topic, puts them in swim lanes by OpenAlex primary-topic subfield, and counts citation flows between subfields. |

All data comes from [OpenAlex](https://openalex.org). The browser calls the API directly and caches responses in IndexedDB.

The UI text is currently in Chinese.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/, deployable to any static host (GitHub Pages, Vercel, Netlify)
```

The **demo data** toggle in the top bar switches to a built-in synthetic corpus and makes no network requests, which is handy for working on the UI offline.

## OpenAlex usage limits

OpenAlex now meters requests. Without an API key, everyone behind the same IP address shares a free budget of about $0.10 per day (roughly 100 requests).
A paper map takes about 2–9 requests, a related-paper graph about 5–7, and a knowledge-flow view about 2–4. Repeat visits are served from the local cache.
A free key (about $1 per day of budget) is available at <https://openalex.org/settings/api>. Paste it into **Settings** in the app; it is stored only in your browser.

## Project structure

```
src/
  api.js          OpenAlex client: caching, cursor paging, batched lookups by id, de-duplication; demo mode routes to mock.js
  mock.js         Deterministic synthetic corpus (900 papers, 8 research areas, with citations)
  lib/embed.js    TF-IDF, random projection, UMAP, k-means, cluster labels
  views/map.js    Paper map (canvas + d3-zoom + quadtree hit testing)
  views/graph.js  Related-paper graph (SVG + d3-force)
  views/flows.js  Knowledge flows (SVG swim-lane timeline + citation curves)
  ui.js, main.js  Routing, status messages, tooltips, detail cards
```

## Possible next steps

- Precompute a venue's map offline with real sentence embeddings (e.g. SPECTER2) instead of in-browser TF-IDF
- Add a small backend proxy that holds the API key and caches responses server-side
- Lasso selection and an author view on the map; multiple seeds for the graph; a Sankey view of flows between time periods
