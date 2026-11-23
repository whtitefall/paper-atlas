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

| Venue key | Years | Source | Requests per venue-year |
| --- | --- | --- | --- |
| `acl`, `emnlp`, `naacl` | 2023–2025 (no NAACL 2023) | ACL Anthology XML on GitHub (`acl-org/acl-anthology/data/xml/{year}.{venue}.xml`): main-conference long and short papers (EMNLP's `main` volume) | 1 |
| `neurips`, `icml`, `iclr`, `cvpr` | 2023–2025 | Conference virtual site JSON (`https://{host}/static/virtual/data/{venue}-{year}-orals-posters.json`) | 1 (+1 for CVPR: CVF listing, adds PDF and arXiv links) |
| `iccv` | 2025 | Virtual site JSON as above, plus the CVF listing | 2 |
| `iccv` | 2023 | CVF open access (`openaccess.thecvf.com/ICCV2023`): listing plus one page per paper for the abstract | ~2,100 |
| `eccv` | 2024 | Virtual site JSON (`eccv.ecva.net`) | 1 |
| `aaai` | 2023–2025 | OAI-PMH at `ojs.aaai.org/index.php/AAAI/oai`, technical-track issues only (one harvest shared by all years) | ~100 pages total |
| `ijcai` | 2023–2025 | `ijcai.org/proceedings/{year}/`: main track only, one `{n}.json` record per paper | ~700–1,000 |
| `arxiv` | 2024 to today | arXiv OAI-PMH (`export.arxiv.org/oai2`, set `cs`), filtered to cs.AI / cs.CL / cs.CV / cs.LG and bucketed by submission month (the id's yymm) | a few hundred pages total |

ICLR and NeurIPS are not read from the OpenReview API, because it answers automated clients with a
"challenge required" 403. ICML comes from its virtual site rather than proceedings.mlr.press
because the virtual site returns the whole year, abstracts included, in one request.

## Paper file schema

```json
{
  "venue": "CVPR", "year": 2024, "source": "https://cvpr.thecvf.com/", "fetched_at": "2026-11-23T05:10:39+00:00",
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
- Requests to the same host are spaced at least 1 s apart (3 s for arXiv).
- 429 and 5xx responses are retried with exponential backoff, honouring `Retry-After`.
- Everything is cached, so normal reruns hit only new data.

## Adding a source

Add a module under `scripts/sources/` that exposes `YEARS = {"venue": [years]}` and
`fetch(http, venue, year)`. `fetch` returns `{"venue", "year", "source", "papers"}`, a list of such
dicts with a `"name"`, or `None` when nothing is published yet. Build entries with
`common.paper(...)`; ids are assigned by `fetch.py`. Then register the module in `fetch.py`.
