// Static data layer: reads the atlas that scripts/build_atlas.py writes to public/data/atlas/.
// The site never calls an external API at runtime; everything is a static file next to the page.

const BASE = `${import.meta.env.BASE_URL}data/atlas/`;

async function fetchJson(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${path}`), { status: r.status });
  return r.json();
}

let indexPromise = null;
/** { generated_at, embed, n, k_nn, datasets: [{key, venue, kind, year, month, n, offset}], clusters: [{id, terms, x, y, n}] } */
export function loadIndex() {
  if (!indexPromise) indexPromise = fetchJson('index.json').catch((e) => { indexPromise = null; throw e; });
  return indexPromise;
}

const datasetCache = new Map();
/** Papers of one dataset: { gi, row, key, id, title, authors, x, y, c, url, pdf, year, month, venue, kind } */
export function loadDataset(key) {
  if (!datasetCache.has(key)) {
    const p = fetchJson(`${key}.json`).then((d) => d.rows.map((r, i) => ({
      gi: d.offset + i, row: i, key, id: r[0], title: r[1], authors: r[2], x: r[3], y: r[4], c: r[5], url: r[6], pdf: r[7],
      year: d.year, month: d.month, venue: d.venue, kind: d.kind,
    }))).catch((e) => { datasetCache.delete(key); throw e; });
    datasetCache.set(key, p);
  }
  return datasetCache.get(key);
}

export async function loadDatasets(keys, onProgress = () => {}) {
  let done = 0;
  const parts = await Promise.all(keys.map((k) => loadDataset(k).then((rows) => { onProgress(++done, keys.length); return rows; })));
  return parts.flat();
}

const absCache = new Map();
export function loadAbstracts(key) {
  if (!absCache.has(key)) {
    const p = fetchJson(`${key}.abs.json`).catch((e) => { absCache.delete(key); throw e; });
    absCache.set(key, p);
  }
  return absCache.get(key);
}

const kwCache = new Map();
/** A few salient terms per paper ("a; b; c"), same order as the dataset. Empty strings if the file is missing. */
export function loadKeywords(key) {
  if (!kwCache.has(key)) {
    kwCache.set(key, fetchJson(`${key}.kw.json`).catch((e) => { console.warn(e); return []; }));
  }
  return kwCache.get(key);
}

export async function abstractOf(paper) {
  const all = await loadAbstracts(paper.key);
  return all[paper.row] || '';
}

const nnCache = new Map();
/** { idx: Int32Array (n*k global indices), sim: Uint8Array (n*k, similarity*255), k } */
export function loadNeighbors(key) {
  if (!nnCache.has(key)) {
    const p = Promise.all([loadIndex(), fetch(`${BASE}${key}.nn.bin`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${key}.nn.bin`);
      return r.arrayBuffer();
    })]).then(([index, buf]) => {
      const ds = index.datasets.find((d) => d.key === key);
      const k = index.k_nn;
      const cells = ds.n * k;
      return { k, idx: new Int32Array(buf, 0, cells), sim: new Uint8Array(buf, cells * 4, cells) };
    }).catch((e) => { nnCache.delete(key); throw e; });
    nnCache.set(key, p);
  }
  return nnCache.get(key);
}

/** The dataset a global index belongs to. */
export function datasetOf(index, gi) {
  const ds = index.datasets;
  let lo = 0, hi = ds.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ds[mid].offset <= gi) lo = mid; else hi = mid - 1;
  }
  return ds[lo];
}

export async function paperAt(gi) {
  const index = await loadIndex();
  const ds = datasetOf(index, gi);
  return (await loadDataset(ds.key))[gi - ds.offset];
}

/** Nearest neighbours of a paper: [{ gi, sim }] most similar first. */
export async function neighborsOf(paper) {
  const { k, idx, sim } = await loadNeighbors(paper.key);
  const out = [];
  for (let j = 0; j < k; j++) out.push({ gi: idx[paper.row * k + j], sim: sim[paper.row * k + j] / 255 });
  return out;
}

/** Remembers which datasets the map shows, so other views search the same sources. */
export const selection = {
  get() { try { return JSON.parse(localStorage.getItem('pa.selection') || 'null'); } catch { return null; } },
  set(keys) { try { localStorage.setItem('pa.selection', JSON.stringify(keys)); } catch { /* storage blocked */ } },
};

/** Default selection: every conference and journal dataset of the newest year. arXiv is opt-in (it is large). */
export function defaultKeys(index) {
  const venues = index.datasets.filter((d) => d.kind !== 'preprint');
  if (!venues.length) return newestArxivKeys(index, 1);
  const latest = Math.max(...venues.map((d) => d.year));
  return venues.filter((d) => d.year === latest).map((d) => d.key);
}

/** arXiv datasets of the newest `months` months (a month can be split into several parts). */
export function newestArxivKeys(index, months, from = -Infinity, to = Infinity) {
  const ax = index.datasets.filter((d) => d.kind === 'preprint' && d.year >= from && d.year <= to);
  const ym = (d) => d.year * 100 + (d.month || 0);
  const keep = new Set([...new Set(ax.map(ym))].sort((a, b) => b - a).slice(0, months === 'all' ? undefined : +months));
  return ax.filter((d) => keep.has(ym(d))).map((d) => d.key);
}

/** How a paper is named in links, e.g. #/graph?seed=acl-2024~2024.acl-long.12 (stable across rebuilds). */
export const seedRef = (p) => `${p.key}~${p.id}`;

/** Simple title/author/abstract matcher: every term must appear. */
export function matcher(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (text) => { const s = text.toLowerCase(); return terms.every((t) => s.includes(t)); };
}
