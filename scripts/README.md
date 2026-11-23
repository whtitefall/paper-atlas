# Data scripts

Paper Atlas runs on static files. Two steps produce them, and neither needs an API key or OpenAlex:

1. `scripts/fetch.py` downloads accepted-paper metadata from each venue's own site and from arXiv
   into `data/papers/`.
2. `scripts/build_atlas.py` turns those files into the atlas the site reads, in `public/data/atlas/`.

The weekly GitHub Actions workflow (`.github/workflows/deploy.yml`) runs both before it deploys the site.
`data/` and `public/data/` are gitignored, so fetched papers and the atlas are build artifacts and are
never committed.

## 1. Fetch papers

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
python scripts/fetch.py --list                    # supported venue-years
python scripts/fetch.py --venue cvpr --year 2024
python scripts/fetch.py --venue acl               # all years of one venue
python scripts/fetch.py --all                     # everything; arXiv takes the longest
python scripts/fetch.py --all --skip arxiv
python scripts/fetch.py --all --refresh           # ignore the cache and refetch
```

Each venue-year is written to `data/papers/{venue}-{year}.json`, and arXiv is written per month to
`data/papers/arxiv-{yyyy}-{mm}.json`. An `index.json` in the same folder lists every file with its
paper count, abstract count and size. Raw responses are cached under `data/raw/`, so an interrupted
or repeated run only fetches what is missing.

## 2. Build the atlas

```bash
.venv/bin/pip install -r scripts/requirements-build.txt
python scripts/build_atlas.py                     # TF-IDF + SVD embeddings, no model download
python scripts/build_atlas.py --embed minilm      # sentence-transformers embeddings (pip install sentence-transformers)
python scripts/build_atlas.py --arxiv-months 6    # publish fewer arXiv months (default 12, 0 = all)
```

The script embeds each paper's title and abstract, lays every paper out on one shared 2D map with
UMAP (so any selection of venues and years is a subset of the same map), groups papers into topic
clusters with k-means and labels each cluster with its most distinctive terms, finds every paper's
20 nearest neighbours, and picks a few keywords per paper. arXiv copies of papers that also appear at a
venue are dropped, and only the newest 12 arXiv months are kept so the site stays well under GitHub
Pages' 1 GB limit.

| File in `public/data/atlas/` | Contents |
| --- | --- |
| `index.json` | Build date, embedding, datasets (venue, kind, year, month, size, offset) and clusters (terms, centre, size) |
| `{key}.json` | One dataset's papers as rows: id, title, authors, map x/y, cluster, landing page, PDF |
| `{key}.abs.json` | Abstracts in the same order, loaded only when the site needs them |
| `{key}.kw.json` | A few keywords per paper, for topic search without loading abstracts |
| `{key}.nn.bin` | Nearest neighbours: n×20 little-endian Int32 global indices, then n×20 Uint8 similarities (×255) |

A paper's global index is its dataset's `offset` plus its row, which is how neighbour lists point at
papers in other datasets.

## Sources

Every source is read in a way its robots.txt allows (see "Being polite"). For venue-years whose
abstracts sit on one page per paper, a paper whose abstract is already in the local arXiv harvest
(matched by its arXiv link or its exact normalised title) skips that request, so run `--venue arxiv`
first for the fewest requests.

| Venue key | Years | Source | Requests per venue-year |
| --- | --- | --- | --- |
| `acl`, `emnlp`, `naacl` | 2023–2026 (no NAACL in 2023 or 2026) | ACL Anthology XML on GitHub (`acl-org/acl-anthology/data/xml/{year}.{venue}.xml`): main-conference long and short papers (EMNLP's `main` volume) | 1 |
| `icml` | 2023–2026 | PMLR (`proceedings.mlr.press/{volume}/assets/bib/bibliography.bib`: v202, v235, v267, v306), abstracts included | 1 |
| `neurips` | 2023–2024 | `proceedings.neurips.cc/paper_files/paper/{year}`: listing plus one abstract page per paper | 1 + up to ~4,500 |
| `iclr` | 2024–2026 | `proceedings.iclr.cc/paper_files/paper/{year}`: listing plus one abstract page per paper | 1 + up to ~5,400 |
| `neurips` 2025–2026, `iclr` 2023, `eccv` 2026 | | Conference virtual site, robots-allowed pages only: `/virtual/{year}/papers.html` (titles) plus `/virtual/{year}/poster/{id}` (authors, abstract) | 1 + up to one per paper |
| `cvpr` | 2023–2026 | CVF open access (`openaccess.thecvf.com/CVPR{year}`): listing (titles, authors, PDF, arXiv links) plus one page per paper for the abstract | 1 + up to ~4,000 |
| `iccv` | 2023, 2025 | CVF open access, as for CVPR | 1 + up to ~2,700 |
| `eccv` | 2024 | ECVA open access (`www.ecva.net/papers.php`) plus one page per paper for the abstract | 1 + up to ~2,400 |
| `aaai` | 2023–2026 | OAI-PMH at `ojs.aaai.org/index.php/AAAI/oai`, technical-track issues only (one harvest shared by all years; its first page is refreshed weekly) | ~130 pages total |
| `ijcai` | 2023–2026 | `ijcai.org/proceedings/{year}/`: main track only, one `{n}.json` record per paper | ~700–1,300 |
| `arxiv` | 2024 to today | arXiv OAI-PMH (`export.arxiv.org/oai2`, set `cs`), filtered to cs.AI / cs.CL / cs.CV / cs.LG and bucketed by submission month (the id's yymm) | ~12 pages per month |

Sources we do not use:

- The conference virtual sites' `/static/virtual/data/{venue}-{year}-orals-posters.json` dumps.
  Their robots.txt disallows `/static`, and from 2026 the dumps no longer carry abstracts.
- The OpenReview API, which answers automated clients with a "challenge required" 403.
  Listings for the current year (and later years) are cached for a week, so new venue-years and late
  additions show up. Earlier years are cached for good. A 404, or a listing that is still empty, is
  never cached.

## Paper file schema

```json
{
  "venue": "CVPR", "year": 2024, "source": "https://openaccess.thecvf.com/", "fetched_at": "2026-11-23T05:10:39+00:00",
  "papers": [{
    "id": "2403.01234 | cvpr2024-<title-slug>",
    "title": "...", "authors": ["..."], "abstract": "...",
    "url": "<landing page>", "pdf": "<pdf url or null>",
    "arxiv_id": "2403.01234 or null", "doi": "10.xxxx/... or null",
    "categories": ["cs.CV"]
  }]
}
```

`categories` is set only on arXiv entries. arXiv files also carry `"month"` and `"categories"`
at the top level. A file larger than about 50 MB is split into `{name}-part1.json`,
`{name}-part2.json`, and so on.

## Being polite

- The User-Agent is `paper-atlas-fetcher (+https://github.com/whtitefall/paper-atlas)`.
- `common.Http` reads every host's robots.txt (cached for a week) and refuses any URL it disallows
  for our User-Agent, honouring `Crawl-delay`. There is one exception: export.arxiv.org's robots.txt
  disallows everything, but arXiv documents its OAI-PMH endpoint there for metadata harvesting
  (<https://info.arxiv.org/help/oa/index.html>).
- Requests to the same host are spaced at least 1 s apart (3 s for arXiv).
- 429 and 5xx responses are retried with exponential backoff, honouring `Retry-After`.
- Everything is cached, so normal reruns hit only new data.

## Adding a source

Add a module under `scripts/sources/` that exposes `YEARS = {"venue": [years]}` and
`fetch(http, venue, year)`. `fetch` returns `{"venue", "year", "source", "papers"}`, a list of such
dicts with a `"name"`, or `None` when nothing is published yet. Build entries with
`common.paper(...)`; ids are assigned by `fetch.py`. Then register the module in `fetch.py`.
