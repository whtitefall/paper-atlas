// View 3: knowledge flows for a topic. Papers that mention the topic are laid out on a timeline, one lane per
// topic cluster. There is no citation data yet, so each paper links to its most similar earlier papers in the set
// (from the precomputed nearest-neighbour lists) as a stand-in for how ideas carry over.
import * as d3 from 'd3';
import { loadIndex, loadDatasets, loadKeywords, loadNeighbors, selection, seedRef } from '../data.js';
import { esc, status, clearStatus, tip, hideTip, tipHtml, paperCard, setParams, venueYear } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { VENUES, VENUE_MONTH, ARXIV } from '../venues.js';

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#b07aa1', '#edc948', '#9c755f'];
const MAX_LANES = 7;
const OTHER = -1;
const SIZES = [300, 600, 1000];
const MAX_PARENTS = 2;     // links per paper to earlier papers
const PARENT_SLACK = 0.05; // a second link must be almost as similar as the first

export function mount(root, params) {
  const p = (k, d) => params.get(k) ?? d;
  root.innerHTML = `
  <div class="layout">
    <aside class="panel left">
      <form class="stack" id="f-form" autocomplete="off">
        <h2>${t('flows.title')}</h2>
        <p class="muted small">${t('flows.desc')}</p>
        <label>${t('flows.topic')} <input name="topic" value="${esc(p('topic', 'transformer'))}" /></label>
        <div class="row"><label>${t('yearFrom')} <select name="from" id="f-from"></select></label><label>${t('yearTo')} <select name="to" id="f-to"></select></label></div>
        <label>${t('flows.max')} <select name="n">${SIZES.map((n) => `<option value="${n}" ${String(n) === p('n', '600') ? 'selected' : ''}>${t('flows.nPapers', { n })}</option>`).join('')}</select></label>
        <div class="muted small" id="f-scope"></div>
        <button type="submit">${icon('flows')}${t('flows.run')}</button>
      </form>
      <div id="f-side" hidden>
        <hr />
        <div class="muted small" id="f-found"></div>
        <h4>${t('flows.matrix')}</h4>
        <p class="muted small">${t('flows.matrixDesc')}</p>
        <div id="f-matrix"></div>
        <h4>${t('flows.roots')} <span class="muted small">${t('flows.rootsSub')}</span></h4>
        <ol class="list" id="f-roots"></ol>
      </div>
    </aside>
    <section class="canvas-wrap scroll" id="f-wrap">
      <svg id="f-svg"></svg>
      <div class="empty" id="f-empty">${t('flows.empty')}</div>
      <div class="hint">${t('flows.hint')}</div>
    </section>
    <aside class="panel right" id="f-detail"><p class="muted">${t('flows.detailEmpty')}</p></aside>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const form = $('#f-form');
  const fromEl = $('#f-from');
  const toEl = $('#f-to');
  const wrap = $('#f-wrap');
  const svg = d3.select($('#f-svg'));
  const detail = $('#f-detail');
  let index = null, destroyed = false, runId = 0;

  // ---------- scope: the venues picked on the map, over this view's own year range ----------
  function scope() {
    const keys = new Set(selection.get() || []);
    const picked = index.datasets.filter((d) => keys.has(d.key));
    const venues = new Set((picked.length ? picked : index.datasets).filter((d) => d.kind !== 'preprint').map((d) => d.venue));
    // arXiv is large, so only the months picked on the map are included
    const all = index.datasets.filter((d) => (d.kind === 'preprint' ? keys.has(d.key) : venues.has(d.venue)));
    const from = +fromEl.value || -Infinity, to = +toEl.value || Infinity;
    return { venues, all, inRange: all.filter((d) => d.year >= from && d.year <= to), arxiv: picked.some((d) => d.kind === 'preprint') };
  }
  function updateScope() {
    const s = scope();
    const order = (v) => { const i = VENUES.findIndex((x) => x.short === v); return i < 0 ? 99 : i; };
    const names = [...s.venues].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    if (s.arxiv) names.push(ARXIV);
    const n = s.inRange.reduce((acc, d) => acc + d.n, 0);
    $('#f-scope').textContent = t('flows.scope', { venues: names.join(t('sep')) || t('none'), n: n.toLocaleString() });
    return s;
  }
  fromEl.addEventListener('change', () => { if (+fromEl.value > +toEl.value) toEl.value = fromEl.value; updateScope(); });
  toEl.addEventListener('change', () => { if (+toEl.value < +fromEl.value) fromEl.value = toEl.value; updateScope(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  // ---------- matching & analysis ----------
  const normalise = (s) => s.toLowerCase().replace(/[-_/]+/g, ' ');
  const timeOf = (q) => q.year + ((q.month || VENUE_MONTH[q.venue] || 6) - 0.5) / 12;

  async function run() {
    const fd = new FormData(form);
    const topic = String(fd.get('topic') || '').trim();
    const max = +fd.get('n') || 600;
    if (!topic || !index) return;
    setParams('flows', { topic, from: fromEl.value, to: toEl.value, n: max });
    const my = ++runId;
    const keys = updateScope().inRange.map((d) => d.key);
    try {
      if (!keys.length) throw new Error(t('map.selNone'));
      let done = 0;
      const total = keys.length * 2;
      const tick = () => status(t('status.loading', { done: ++done, total }));
      const [papers, kws] = await Promise.all([
        loadDatasets(keys, tick),
        Promise.all(keys.map((k) => loadKeywords(k).then((v) => { tick(); return [k, v]; }))),
      ]);
      if (destroyed || my !== runId) return;
      const kw = new Map(kws);

      // every term must start a word in the title or the keywords; title hits count more
      const terms = normalise(topic).split(/\s+/).filter(Boolean);
      const res = terms.map((w) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'));
      const phrase = terms.join(' ');
      const scored = [];
      for (const q of papers) {
        const title = normalise(q.title);
        const words = normalise(kw.get(q.key)?.[q.row] || '');
        let score = 0;
        let ok = true;
        for (const re of res) {
          const a = re.test(title), b = re.test(words);
          if (!a && !b) { ok = false; break; }
          score += (a ? 3 : 0) + (b ? 1 : 0);
        }
        if (!ok) continue;
        if (terms.length > 1 && title.includes(phrase)) score += 2;
        scored.push({ q, score, h: hash(q.gi) });
      }
      if (scored.length < 5) throw new Error(t('err.flowsFew'));
      // keep the best matches; ties are broken by a stable hash so no year is favoured
      scored.sort((a, b) => b.score - a.score || a.h - b.h);
      const M = scored.slice(0, max).map((s) => s.q);

      status(t('status.loading', { done: 0, total: 1 }));
      const nnKeys = [...new Set(M.map((q) => q.key))];
      const nns = new Map(await Promise.all(nnKeys.map(async (k) => [k, await loadNeighbors(k)])));
      if (destroyed || my !== runId) return;
      const D = analyse(M, nns);
      D.found = scored.length;
      render(D);
      clearStatus();
    } catch (err) {
      console.error(err);
      if (err.status === 404) $('#f-empty').textContent = t('err.noData');
      status(err.status ? t('err.load', { msg: err.message }) : err.message, { error: true });
    }
  }

  function analyse(M, nns) {
    const pos = new Map(M.map((q, i) => [q.gi, i]));
    const time = M.map(timeOf);
    const up = M.map(() => []);   // earlier papers each paper builds on: [{ i, s }]
    const down = M.map(() => []); // later papers that build on it
    const edges = [];
    M.forEach((q, i) => {
      const { k, idx, sim } = nns.get(q.key);
      let best = null;
      for (let j = 0; j < k && up[i].length < MAX_PARENTS; j++) {
        const o = pos.get(idx[q.row * k + j]);
        if (o === undefined || time[o] >= time[i]) continue;
        const s = sim[q.row * k + j] / 255;
        if (best === null) best = s;
        else if (s < best - PARENT_SLACK) break;
        edges.push({ from: o, to: i, s });
        up[i].push({ i: o, s });
        down[o].push({ i, s });
      }
    });
    const counts = d3.rollups(M, (v) => v.length, (q) => q.c).sort((a, b) => b[1] - a[1]);
    const top = counts.slice(0, MAX_LANES).map((c) => c[0]);
    const lanes = counts.length > MAX_LANES ? [...top, OTHER] : top;
    const lane = M.map((q) => (top.includes(q.c) ? q.c : OTHER));
    const flow = d3.rollups(edges, (v) => v.length, (e) => lane[e.from], (e) => lane[e.to]);
    const matrix = [];
    for (const [a, list] of flow) for (const [b, n] of list) matrix.push({ a, b, n });
    matrix.sort((x, y) => y.n - x.n);
    const roots = d3.range(M.length).filter((i) => down[i].length)
      .sort((a, b) => down[b].length - down[a].length || time[a] - time[b]);
    return { M, time, up, down, edges, lanes, lane, matrix, roots };
  }

  function lineage(D, i, dir) {
    const seen = new Set();
    const stack = [i];
    while (stack.length) {
      const c = stack.pop();
      for (const { i: n } of D[dir][c]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    return seen;
  }

  // ---------- drawing ----------
  function render(D) {
    const { M } = D;
    $('#f-empty').hidden = true;
    svg.selectAll('*').remove();
    const laneName = (l) => (l === OTHER ? t('other') : (index.clusters[l]?.terms || [String(l)]).slice(0, 2).join(' · '));
    const laneIdx = new Map(D.lanes.map((l, i) => [l, i]));
    const color = (l) => (l === OTHER ? '#999' : PALETTE[laneIdx.get(l) % PALETTE.length]);

    const width = Math.max(760, wrap.clientWidth);
    const m = { top: 130, right: 28, bottom: 36, left: 190 };
    // lane height grows with the number of papers in it (sqrt, so small lanes stay readable)
    const laneCount = d3.rollup(d3.range(M.length), (v) => v.length, (i) => D.lane[i]);
    const minH = 56;
    const avail = Math.max(D.lanes.length * 90, wrap.clientHeight - m.top - m.bottom - 8);
    const sq = D.lanes.map((l) => Math.sqrt(laneCount.get(l) || 0));
    const sqSum = d3.sum(sq) || 1;
    const laneHs = sq.map((v) => minH + (avail - minH * D.lanes.length) * (v / sqSum));
    const laneY = [];
    laneHs.reduce((acc, h, i) => { laneY[i] = acc; return acc + h; }, m.top);
    const height = m.top + d3.sum(laneHs) + m.bottom;
    svg.attr('width', width).attr('height', height);

    const y0 = d3.min(M, (q) => q.year), y1 = d3.max(M, (q) => q.year);
    const date = (tv) => new Date(Date.UTC(Math.floor(tv), 0, 1) + (tv % 1) * 365.25 * 864e5);
    const x = d3.scaleUtc().domain([new Date(Date.UTC(y0, 0, 1)), new Date(Date.UTC(y1 + 1, 0, 1))]).range([m.left, width - m.right]);
    const maxDown = d3.max(D.down, (d) => d.length) || 1;
    const r = d3.scaleSqrt().domain([0, maxDown]).range([2.5, 11]);

    // stable jitter: half a month either way in time, and a spread across the lane height
    const monthPx = x(date(y0 + 1 / 12)) - x(date(y0));
    const px = M.map((q, i) => x(date(D.time[i])) + (hash(q.gi) - 0.5) * monthPx * 0.9);
    const py = M.map((q, i) => {
      const li = laneIdx.get(D.lane[i]);
      // papers many others build on sit closer to the middle of their lane
      const spread = 0.46 * (1 - Math.min(0.8, Math.log1p(D.down[i].length) / Math.log1p(maxDown)));
      return laneY[li] + laneHs[li] * 0.5 + (hash(q.gi * 7 + 3) - 0.5) * 2 * spread * laneHs[li];
    });

    // --- top: papers per year, stacked by lane ---
    const years = d3.range(y0, y1 + 1);
    const table = years.map((yr) => { const row = { year: yr }; for (const l of D.lanes) row[l] = 0; return row; });
    M.forEach((q, i) => { table[q.year - y0][D.lane[i]]++; });
    const stack = d3.stack().keys(D.lanes)(table);
    const ys = d3.scaleLinear().domain([0, d3.max(stack.at(-1), (d) => d[1]) || 1]).range([m.top - 22, 18]);
    const gTop = svg.append('g');
    const barPad = Math.min(12, (x(new Date(Date.UTC(y0 + 1, 0, 1))) - x(new Date(Date.UTC(y0, 0, 1)))) * 0.08);
    gTop.selectAll('g').data(stack).join('g').attr('fill', (s) => color(s.key)).attr('opacity', 0.85)
      .selectAll('rect').data((s) => s.map((d) => ({ d, key: s.key }))).join('rect')
      .attr('x', ({ d }) => x(new Date(Date.UTC(d.data.year, 0, 1))) + barPad)
      .attr('width', ({ d }) => Math.max(1, x(new Date(Date.UTC(d.data.year + 1, 0, 1))) - x(new Date(Date.UTC(d.data.year, 0, 1))) - 2 * barPad))
      .attr('y', ({ d }) => ys(d[1])).attr('height', ({ d }) => Math.max(0, ys(d[0]) - ys(d[1])))
      .append('title').text(({ d, key }) => `${laneName(key)} · ${d.data.year}: ${d[1] - d[0]}`);
    gTop.append('text').attr('x', 24).attr('y', 60).attr('class', 'axis-label').text(t('flows.perYear'));
    gTop.append('g').attr('transform', `translate(${m.left - 4},0)`).call(d3.axisLeft(ys).ticks(3)).attr('class', 'axis');

    // --- lanes ---
    const gL = svg.append('g');
    D.lanes.forEach((l, i) => {
      const top = laneY[i], h = laneHs[i];
      gL.append('rect').attr('x', m.left).attr('y', top).attr('width', width - m.left - m.right).attr('height', h).attr('class', i % 2 ? 'lane odd' : 'lane');
      gL.append('rect').attr('x', 8).attr('y', top + h / 2 - 6).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', color(l));
      const name = laneName(l);
      gL.append('text').attr('x', 24).attr('y', top + h / 2 + 3).attr('class', 'lane-label').text(name.length > 26 ? name.slice(0, 25) + '…' : name)
        .append('title').text(`${name} · ${laneCount.get(l) || 0}`);
    });
    const span = y1 - y0 + 1;
    const ticks = span >= 4 ? x.ticks(d3.utcYear.every(1)) : x.ticks(d3.utcMonth.every(span >= 2 ? 3 : 1));
    const fmtMonth = (d) => (getLang() === 'zh' ? `${d.getUTCMonth() + 1}月` : d3.utcFormat('%b')(d));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`)
      .call(d3.axisBottom(x).tickValues(ticks).tickFormat((d) => (d.getUTCMonth() ? fmtMonth(d) : d.getUTCFullYear())));

    // --- links: earlier paper -> later paper ---
    const gE = svg.append('g').attr('class', 'flows');
    const path = (e) => {
      const ax = px[e.from], ay = py[e.from], bx = px[e.to], by = py[e.to];
      const mx = (ax + bx) / 2;
      return `M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx},${by}`;
    };
    const edgeSel = gE.selectAll('path').data(D.edges).join('path').attr('d', path).attr('stroke', (e) => color(D.lane[e.from]));

    // --- papers ---
    const gN = svg.append('g');
    const tipFor = (i) => tipHtml(M[i]) + `<div class="muted">${t('flows.inTopic', { a: D.up[i].length, b: D.down[i].length })}</div>`;
    const nodeSel = gN.selectAll('circle').data(d3.range(M.length)).join('circle').attr('class', 'flow-node')
      .attr('cx', (i) => px[i]).attr('cy', (i) => py[i]).attr('r', (i) => r(D.down[i].length)).attr('fill', (i) => color(D.lane[i]))
      .on('mouseenter mousemove', (e, i) => tip(e, tipFor(i)))
      .on('mouseleave', hideTip)
      .on('click', (e, i) => { e.stopPropagation(); focus(i); });
    gN.selectAll('text').data(D.roots.slice(0, 8)).join('text').attr('class', 'flow-label')
      .attr('x', (i) => px[i] + r(D.down[i].length) + 3).attr('y', (i) => py[i] + 4)
      .text((i) => (M[i].title.length > 30 ? M[i].title.slice(0, 29) + '…' : M[i].title));
    svg.on('click', () => focus(null));

    function focus(i) {
      if (i == null) {
        nodeSel.classed('faded', false).classed('sel', false);
        edgeSel.classed('faded', false).classed('hl', false);
        detail.innerHTML = `<p class="muted">${t('flows.detailEmpty')}</p>`;
        return;
      }
      const anc = lineage(D, i, 'up'), des = lineage(D, i, 'down');
      const on = new Set([i, ...anc, ...des]);
      nodeSel.classed('faded', (o) => !on.has(o)).classed('sel', (o) => o === i);
      const inDown = (o) => o === i || des.has(o);
      const inUp = (o) => o === i || anc.has(o);
      const lit = (e) => (inDown(e.from) && inDown(e.to)) || (inUp(e.from) && inUp(e.to));
      edgeSel.classed('hl', lit).classed('faded', (e) => !lit(e));
      const q = M[i];
      const li = ({ i: o, s }) => `<li><a href="javascript:void 0" data-i="${o}">${esc(M[o].title)}</a> <span class="muted small">${esc(venueYear(M[o]))} · ${esc(laneName(D.lane[o]))} · ${s.toFixed(2)}</span></li>`;
      const spread = d3.rollups([...des], (v) => v.length, (o) => D.lane[o]).sort((a, b) => b[1] - a[1]);
      const none = `<li class="muted">${t('none')}</li>`;
      detail.innerHTML = paperCard(q, [{ label: t('map.toGraph'), icon: 'graph', href: `#/graph?seed=${encodeURIComponent(seedRef(q))}` }])
        + `<p class="small">${t('flows.lineage', { a: anc.size, b: des.size })}</p>`
        + (spread.length ? `<p class="small muted">${esc(t('flows.spread', { list: spread.map(([l, n]) => `${laneName(l)} ${n}`).join(t('sep')) }))}</p>` : '')
        + `<h4>${t('flows.directUp')}</h4><ol class="list">${D.up[i].map(li).join('') || none}</ol>`
        + `<h4>${t('flows.directDown')}</h4><ol class="list">${[...D.down[i]].sort((a, b) => b.s - a.s).slice(0, 15).map(li).join('') || none}</ol>`;
      detail.querySelectorAll('a[data-i]').forEach((a) => a.addEventListener('click', () => reveal(+a.dataset.i)));
    }
    function reveal(i) {
      focus(i);
      wrap.scrollTo({ top: py[i] - wrap.clientHeight / 2, left: px[i] - wrap.clientWidth / 2, behavior: 'smooth' });
    }

    // --- side panel ---
    $('#f-side').hidden = false;
    $('#f-found').textContent = t('flows.matches', { n: D.found.toLocaleString() }) + (D.found > M.length ? t('flows.showing', { m: M.length.toLocaleString() }) : '');
    const maxN = D.matrix[0]?.n || 1;
    const short = (s) => (s.length > 18 ? s.slice(0, 17) + '…' : s);
    $('#f-matrix').innerHTML = D.matrix.slice(0, 12).map((d) => `
      <div class="flow-row" title="${esc(laneName(d.a))} → ${esc(laneName(d.b))}: ${d.n}">
        <span class="sw" style="background:${color(d.a)}"></span><span class="lbl">${esc(short(laneName(d.a)))} → ${esc(short(laneName(d.b)))}</span><span class="muted small">${d.n}</span>
        <span class="bar"><i style="width:${Math.max(1, (100 * d.n) / maxN)}%;background:${color(d.a)}"></i></span>
      </div>`).join('') || `<p class="muted small">${t('flows.noEdges')}</p>`;
    $('#f-roots').innerHTML = D.roots.slice(0, 12).map((i) => `<li><a href="javascript:void 0" data-i="${i}">${esc(M[i].title)}</a> <span class="muted small">${esc(venueYear(M[i]))} · ${t('flows.rootCited', { n: D.down[i].length })}</span></li>`).join('')
      || `<li class="muted">${t('none')}</li>`;
    root.querySelectorAll('#f-roots a[data-i]').forEach((a) => a.addEventListener('click', () => reveal(+a.dataset.i)));
    detail.innerHTML = `<p class="muted">${t('flows.detailEmpty')}</p>`;
  }

  // ---------- init ----------
  (async () => {
    try {
      index = await loadIndex();
    } catch (err) {
      $('#f-empty').textContent = t('err.noData');
      return;
    }
    if (destroyed) return;
    const years = [...new Set(scope().all.map((d) => d.year))].sort();
    const opts = years.map((yv) => `<option>${yv}</option>`).join('');
    fromEl.innerHTML = opts;
    toEl.innerHTML = opts;
    const pick = (v, fallback) => (years.includes(+v) ? String(v) : String(fallback ?? ''));
    fromEl.value = pick(params.get('from'), years[0]);
    toEl.value = pick(params.get('to'), years.at(-1));
    updateScope();
    if (params.get('topic')) run();
  })();

  return { destroy() { destroyed = true; hideTip(); } };
}

/** Deterministic pseudo-random number in [0, 1) for an integer. */
function hash(n) {
  let v = (n | 0) ^ 0x9e3779b9;
  v = Math.imul(v ^ (v >>> 16), 0x85ebca6b);
  v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}
