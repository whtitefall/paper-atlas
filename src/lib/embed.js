// Text -> TF-IDF -> random projection -> UMAP (2D), plus k-means topic clusters.
// Runs entirely in the browser; ~1000 abstracts take a few seconds.
import { UMAP } from 'umap-js';

const STOP = new Set(('a an and are as at be been but by can could do does for from had has have how i if in into is it its ' +
  'may more most new not of on or our over such than that the their them then there these they this those through to ' +
  'under up us using via was we were what when where which while who will with within without also based both each ' +
  'paper propose proposed show results method methods approach approaches study work novel use used however can ' +
  'different between two one three first well further existing provide present demonstrate achieve performance ' +
  'task tasks problem problems data model models learning large significantly experiments state art outperforms ' +
  'set across many other only all some any very much without because thus therefore among able et al vs').split(/\s+/));

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter((t) => !STOP.has(t));
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6D2B79F5) >>> 0; return s / 4294967296; };
}

/** Build sparse TF-IDF vectors. Returns { vecs: Map<int,float>[], vocab: string[], idf }. */
export function tfidf(docs, { maxVocab = 4000, minDf = 2 } = {}) {
  const toks = docs.map(tokenize);
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const maxDf = docs.length * 0.5;
  const vocab = [...df.entries()].filter(([, c]) => c >= Math.min(minDf, docs.length) && c <= Math.max(maxDf, 2))
    .sort((a, b) => b[1] - a[1]).slice(0, maxVocab).map(([w]) => w);
  const index = new Map(vocab.map((w, i) => [w, i]));
  const idf = vocab.map((w) => Math.log((1 + docs.length) / (1 + df.get(w))) + 1);
  const vecs = toks.map((t) => {
    const m = new Map();
    for (const w of t) { const i = index.get(w); if (i !== undefined) m.set(i, (m.get(i) || 0) + 1); }
    let norm = 0;
    for (const [i, c] of m) { const v = (1 + Math.log(c)) * idf[i]; m.set(i, v); norm += v * v; }
    norm = Math.sqrt(norm) || 1;
    for (const [i, v] of m) m.set(i, v / norm);
    return m;
  });
  return { vecs, vocab, idf };
}

/** Sparse -> dense via a fixed Gaussian random projection (Johnson–Lindenstrauss). */
export function project(vecs, vocabSize, dims = 96) {
  const rand = seeded(7);
  const gauss = () => { const u = rand() || 1e-9, v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const R = new Float32Array(vocabSize * dims);
  for (let i = 0; i < R.length; i++) R[i] = gauss();
  return vecs.map((m) => {
    const out = new Array(dims).fill(0);
    for (const [i, v] of m) { const off = i * dims; for (let d = 0; d < dims; d++) out[d] += v * R[off + d]; }
    const n = Math.hypot(...out) || 1;
    return out.map((x) => x / n);
  });
}

export async function umap2d(dense, onEpoch = () => {}) {
  const n = dense.length;
  const umap = new UMAP({ nComponents: 2, nNeighbors: Math.max(2, Math.min(15, n - 1)), minDist: 0.12, random: seeded(3) });
  const nEpochs = umap.initializeFit(dense);
  for (let e = 0; e < nEpochs; e++) {
    umap.step();
    if (e % 25 === 0) { onEpoch(e / nEpochs); await new Promise((r) => setTimeout(r)); }
  }
  return umap.getEmbedding();
}

export function kmeans(points, k, iters = 40) {
  const rand = seeded(11);
  const n = points.length;
  k = Math.min(k, n);
  // k-means++ init
  const cents = [points[Math.floor(rand() * n)].slice()];
  const d2 = new Array(n).fill(Infinity);
  while (cents.length < k) {
    let sum = 0;
    for (let i = 0; i < n; i++) { const c = cents[cents.length - 1]; const d = (points[i][0] - c[0]) ** 2 + (points[i][1] - c[1]) ** 2; d2[i] = Math.min(d2[i], d); sum += d2[i]; }
    let t = rand() * sum, i = 0;
    while (i < n - 1 && (t -= d2[i]) > 0) i++;
    cents.push(points[i].slice());
  }
  const assign = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (points[i][0] - cents[c][0]) ** 2 + (points[i][1] - cents[c][1]) ** 2; if (d < bd) { bd = d; best = c; } }
      assign[i] = best;
    }
    const acc = cents.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) { const a = acc[assign[i]]; a[0] += points[i][0]; a[1] += points[i][1]; a[2]++; }
    acc.forEach((a, c) => { if (a[2]) cents[c] = [a[0] / a[2], a[1] / a[2]]; });
  }
  return { assign, centroids: cents };
}

/** Label each cluster with its most distinctive terms (mean TF-IDF in-cluster vs overall). */
export function clusterLabels(vecs, vocab, assign, k, topN = 3) {
  const global = new Float64Array(vocab.length);
  const per = Array.from({ length: k }, () => new Float64Array(vocab.length));
  const counts = new Array(k).fill(0);
  vecs.forEach((m, i) => { counts[assign[i]]++; for (const [j, v] of m) { global[j] += v; per[assign[i]][j] += v; } });
  return per.map((arr, c) => {
    const scored = [];
    for (let j = 0; j < vocab.length; j++) {
      if (!arr[j]) continue;
      const inC = arr[j] / (counts[c] || 1), all = global[j] / vecs.length;
      scored.push([vocab[j], inC * Math.log(1 + inC / (all + 1e-6))]);
    }
    return scored.sort((a, b) => b[1] - a[1]).slice(0, topN).map((s) => s[0]);
  });
}
