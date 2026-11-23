// Deterministic synthetic corpus used by the demo-data toggle and for offline testing.
// Shapes match api.normalize() output.

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const THEMES = [
  { subfield: 'Artificial Intelligence', topic: 'Natural Language Processing', words: ['language', 'transformer', 'attention', 'translation', 'pretraining', 'token', 'bert', 'text', 'generation', 'prompt'] },
  { subfield: 'Computer Vision and Pattern Recognition', topic: 'Image Recognition', words: ['image', 'convolutional', 'detection', 'segmentation', 'vision', 'pixel', 'object', 'visual', 'patch', 'resnet'] },
  { subfield: 'Artificial Intelligence', topic: 'Reinforcement Learning', words: ['reinforcement', 'policy', 'agent', 'reward', 'environment', 'exploration', 'control', 'q-learning', 'planning', 'game'] },
  { subfield: 'Computer Networks and Communications', topic: 'Graph Neural Networks', words: ['graph', 'node', 'message', 'passing', 'molecule', 'edge', 'relational', 'network', 'link', 'embedding'] },
  { subfield: 'Signal Processing', topic: 'Speech Recognition', words: ['speech', 'audio', 'acoustic', 'speaker', 'waveform', 'recognition', 'asr', 'spectrogram', 'voice', 'sound'] },
  { subfield: 'Information Systems', topic: 'Recommender Systems', words: ['recommendation', 'user', 'item', 'ranking', 'click', 'collaborative', 'filtering', 'retrieval', 'query', 'search'] },
  { subfield: 'Statistics and Probability', topic: 'Generative Models', words: ['generative', 'diffusion', 'variational', 'adversarial', 'sampling', 'likelihood', 'latent', 'density', 'score', 'synthesis'] },
  { subfield: 'Health Informatics', topic: 'Medical Imaging', words: ['medical', 'clinical', 'patient', 'mri', 'diagnosis', 'radiology', 'tumor', 'health', 'ct', 'lesion'] },
];
const GENERIC = ['learning', 'model', 'method', 'efficient', 'robust', 'scalable', 'deep', 'neural', 'framework', 'benchmark', 'approach', 'analysis'];
const TEMPL = ['{a} {b} for {c} {d}', 'Towards {e} {a} {b}', 'Learning {c} {b} with {d}', 'On the {e} of {a} {c}', '{A}: {e} {b} {d}', 'Rethinking {a} in {c} {d}'];
const NAMES = ['Li', 'Wang', 'Zhang', 'Smith', 'Garcia', 'Kim', 'Chen', 'Müller', 'Rossi', 'Tanaka', 'Singh', 'Liu', 'Brown', 'Ivanova', 'Dubois', 'Park'];
const ACRO = ['NEXUS', 'Orbit', 'Lumen', 'Prism', 'Fathom', 'Keel', 'Tessera', 'Quill', 'Sable', 'Wren'];

let CORPUS = null;
function build() {
  if (CORPUS) return CORPUS;
  const r = rng(42);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const works = [];
  const N = 900;
  for (let i = 0; i < N; i++) {
    const year = 2012 + Math.floor(Math.pow(r(), 0.6) * 13); // skew to recent
    let th = Math.floor(r() * THEMES.length);
    const theme = THEMES[th];
    const second = r() < 0.25 ? THEMES[(th + 1 + Math.floor(r() * 7)) % THEMES.length] : null;
    const w = theme.words;
    const title = pick(TEMPL)
      .replace('{a}', pick(w)).replace('{b}', pick(GENERIC)).replace('{c}', pick(second ? second.words : w))
      .replace('{d}', pick(w)).replace('{e}', pick(GENERIC)).replace('{A}', pick(ACRO))
      .replace(/^./, (c) => c.toUpperCase());
    const absWords = [];
    for (let k = 0; k < 60; k++) {
      const u = r();
      absWords.push(u < 0.55 ? pick(w) : u < 0.7 && second ? pick(second.words) : pick(GENERIC));
    }
    works.push({
      id: 'W' + (100000 + i), title, year, citations: 0, refs: [], related: [],
      abstract: 'We study ' + absWords.join(' ') + '.',
      authors: [pick(NAMES) + ' ' + String.fromCharCode(65 + Math.floor(r() * 26)) + '.', pick(NAMES) + ' ' + String.fromCharCode(65 + Math.floor(r() * 26)) + '.'],
      topic: theme.topic, subfield: theme.subfield, field: 'Computer Science',
      venue: pick(['Demo Conf on AI', 'Demo Journal of ML', 'Demo Vision Symposium']),
      doi: '', url: '#', _th: th, _th2: second ? THEMES.indexOf(second) : -1, _fit: Math.pow(r(), 3),
    });
  }
  works.sort((a, b) => a.year - b.year);
  // citations: preferential attachment to earlier, same-theme papers
  for (let i = 0; i < works.length; i++) {
    const p = works[i];
    const nref = 8 + Math.floor(r() * 18);
    const set = new Set();
    for (let t = 0; t < nref * 4 && set.size < nref && i > 0; t++) {
      const j = Math.floor(Math.pow(r(), 0.7) * i);
      const q = works[j];
      if (q.year >= p.year) continue;
      const same = q._th === p._th || q._th === p._th2;
      if ((same ? 0.9 : 0.12) * (0.25 + q._fit) > r()) set.add(q.id);
    }
    p.refs = [...set];
  }
  const byId = new Map(works.map((w) => [w.id, w]));
  for (const p of works) for (const id of p.refs) byId.get(id).citations++;
  for (const p of works) p.citations = Math.round(p.citations * (3 + 40 * p._fit));
  for (const p of works) {
    p.related = works.filter((q) => q._th === p._th && q.id !== p.id).slice(0, 400)
      .sort((a, b) => Math.abs(a.year - p.year) - Math.abs(b.year - p.year)).slice(0, 10).map((q) => q.id);
  }
  CORPUS = { works, byId };
  return CORPUS;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (w) => ({ ...w });

function match(w, q) {
  if (!q) return 1;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (w.title + ' ' + w.abstract).toLowerCase();
  let s = 0;
  for (const t of terms) if (hay.includes(t)) s++;
  return s / terms.length;
}

export async function searchWorks(q, limit) {
  await delay(120);
  const { works } = build();
  return works.map((w) => [w, match(w, q)]).filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || b[0].citations - a[0].citations).slice(0, limit).map(([w]) => clone(w));
}

export async function fetchCorpus(opts) {
  await delay(300);
  const { works } = build();
  let out = works.filter((w) => (!opts.yearFrom || w.year >= opts.yearFrom) && (!opts.yearTo || w.year <= opts.yearTo));
  if (opts.query) out = out.filter((w) => match(w, opts.query) > 0);
  out = out.sort((a, b) => b.citations - a.citations).slice(0, opts.limit || 600).map(clone);
  return { works: out, sourceName: opts.venue ? `${opts.venue}（演示）` : null };
}

export async function getWorksByIds(ids) {
  await delay(80);
  const { byId } = build();
  return ids.map((id) => byId.get(id)).filter(Boolean).map(clone);
}

export async function getWork(id) {
  await delay(80);
  const w = build().byId.get(id);
  if (!w) throw new Error('演示数据中没有这篇论文');
  return clone(w);
}

export async function getCiters(id, limit) {
  await delay(120);
  return build().works.filter((w) => w.refs.includes(id)).sort((a, b) => b.citations - a.citations).slice(0, limit).map(clone);
}
