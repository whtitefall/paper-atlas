// Data layer: OpenAlex (live) or a synthetic corpus (demo mode).
// All views talk to the functions exported here, never to fetch() directly.
import * as mock from './mock.js';

const BASE = 'https://api.openalex.org';
const FIELDS = [
  'id', 'title', 'publication_year', 'cited_by_count', 'referenced_works',
  'related_works', 'primary_topic', 'abstract_inverted_index', 'authorships',
  'primary_location', 'doi',
].join(',');
const LIGHT_FIELDS = 'id,title,publication_year,cited_by_count,primary_topic,authorships,doi';

export const settings = {
  get apiKey() { return safeGet('pa.apiKey') || ''; },
  set apiKey(v) { safeSet('pa.apiKey', v || ''); },
  get demo() { return safeGet('pa.demo') === '1'; },
  set demo(v) { safeSet('pa.demo', v ? '1' : '0'); },
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

// ---------- tiny IndexedDB cache (falls back to memory) ----------
const mem = new Map();
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open('paper-atlas', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('http');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  const d = await db();
  if (!d) return undefined;
  return new Promise((res) => {
    const r = d.transaction('http').objectStore('http').get(key);
    r.onsuccess = () => { if (r.result) mem.set(key, r.result); res(r.result); };
    r.onerror = () => res(undefined);
  });
}
async function cachePut(key, val) {
  mem.set(key, val);
  const d = await db();
  if (!d) return;
  d.transaction('http', 'readwrite').objectStore('http').put(val, key);
}
export async function clearCache() {
  mem.clear();
  const d = await db();
  if (d) d.transaction('http', 'readwrite').objectStore('http').clear();
}

// ---------- HTTP ----------
export let requestCount = 0;
async function get(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const key = url.toString();
  const cached = await cacheGet(key);
  if (cached) return cached;
  if (settings.apiKey) url.searchParams.set('api_key', settings.apiKey);
  requestCount++;
  const resp = await fetch(url);
  if (resp.status === 429) throw new Error('OpenAlex 今日免费额度已用完（429）。可在“设置”中填写免费 API key，或打开“演示数据”。');
  if (!resp.ok) throw new Error(`OpenAlex 请求失败：HTTP ${resp.status}`);
  const json = await resp.json();
  await cachePut(key, json);
  return json;
}

// ---------- normalisation ----------
const shortId = (u) => (u ? String(u).replace('https://openalex.org/', '') : u);

export function abstractFromIndex(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(' ');
}

export function normalize(w) {
  const pt = w.primary_topic;
  return {
    id: shortId(w.id),
    title: w.title || '(untitled)',
    year: w.publication_year,
    citations: w.cited_by_count || 0,
    refs: (w.referenced_works || []).map(shortId),
    related: (w.related_works || []).map(shortId),
    abstract: w.abstract ?? abstractFromIndex(w.abstract_inverted_index),
    authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean),
    topic: pt?.display_name || '未分类',
    subfield: pt?.subfield?.display_name || '未分类',
    field: pt?.field?.display_name || '未分类',
    venue: w.primary_location?.source?.display_name || '',
    doi: w.doi || '',
    url: w.doi || w.id,
  };
}

/** OpenAlex often has a preprint and a published version of the same paper; keep the more-cited one. */
export function dedupe(works) {
  const best = new Map();
  for (const w of works) {
    const k = w.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (w.authors[0] || '');
    const prev = best.get(k);
    if (!prev || w.citations > prev.citations) best.set(k, w);
  }
  return works.filter((w) => best.get(w.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (w.authors[0] || '')) === w);
}

// ---------- public API ----------

/** Full-text search, most relevant first. */
export async function searchWorks(query, { limit = 10 } = {}) {
  if (settings.demo) return mock.searchWorks(query, limit);
  const j = await get('/works', { search: query, 'per-page': limit, select: LIGHT_FIELDS });
  return dedupe(j.results.map(normalize));
}

/** Resolve a venue name to an OpenAlex source id. */
export async function findSource(name) {
  if (settings.demo) return null;
  const j = await get('/sources', { search: name, 'per-page': 1, select: 'id,display_name' });
  return j.results[0] ? { id: shortId(j.results[0].id), name: j.results[0].display_name } : null;
}

/**
 * A corpus for the map / flows views.
 * opts: { query, venue, yearFrom, yearTo, limit, sort }
 */
export async function fetchCorpus(opts, onProgress = () => {}) {
  if (settings.demo) return mock.fetchCorpus(opts);
  const filters = [];
  let sourceName = null;
  if (opts.venue) {
    const s = await findSource(opts.venue);
    if (!s) throw new Error(`没有找到会议/期刊：${opts.venue}`);
    filters.push(`primary_location.source.id:${s.id}`);
    sourceName = s.name;
  }
  if (opts.yearFrom || opts.yearTo) filters.push(`publication_year:${opts.yearFrom || ''}-${opts.yearTo || ''}`);
  filters.push('has_abstract:true');
  const perPage = 200;
  const limit = opts.limit || 600;
  const out = [];
  let cursor = '*';
  while (out.length < limit && cursor) {
    const j = await get('/works', {
      search: opts.query || undefined,
      filter: filters.join(','),
      sort: opts.sort || (opts.query ? undefined : 'cited_by_count:desc'),
      'per-page': Math.min(perPage, limit - out.length),
      cursor,
      select: FIELDS,
    });
    out.push(...j.results.map(normalize));
    cursor = j.meta.next_cursor;
    onProgress(out.length, Math.min(limit, j.meta.count));
    if (!j.results.length) break;
  }
  return { works: dedupe(out), sourceName };
}

/** Fetch works by id, 50 per request. */
export async function getWorksByIds(ids, { light = false } = {}) {
  if (settings.demo) return mock.getWorksByIds(ids);
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const j = await get('/works', {
      filter: `openalex_id:${chunk.join('|')}`,
      'per-page': 50,
      select: light ? LIGHT_FIELDS + ',referenced_works' : FIELDS,
    });
    out.push(...j.results.map(normalize));
  }
  return out;
}

export async function getWork(id) {
  if (settings.demo) return mock.getWork(id);
  const j = await get(`/works/${id}`, { select: FIELDS });
  return normalize(j);
}

/** Most-cited works that cite `id`. */
export async function getCiters(id, limit = 100) {
  if (settings.demo) return mock.getCiters(id, limit);
  const j = await get('/works', {
    filter: `cites:${id}`, sort: 'cited_by_count:desc', 'per-page': limit,
    select: LIGHT_FIELDS + ',referenced_works',
  });
  return dedupe(j.results.map(normalize));
}
