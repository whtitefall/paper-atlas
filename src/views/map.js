// View 1: the paper map. Every paper has a fixed position in one shared 2D space (computed offline by
// scripts/build_atlas.py), so choosing venues / years / arXiv just picks which papers to draw.
import * as d3 from 'd3';
import { loadIndex, loadDatasets, loadAbstracts, neighborsOf, paperAt, selection, defaultKeys, newestArxivKeys, seedRef } from '../data.js';
import { esc, status, clearStatus, tip, hideTip, tipHtml, paperCard, debounce, setParams, venueYear } from '../ui.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { VENUES, ARXIV } from '../venues.js';

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6', '#d37295', '#a0cbe8', '#8cd17d', '#fabfd2', '#79706e', '#b6992d'];
const OTHER = '\u0000other';
const HEAVY = 60000;          // warn above this many papers
const STATE_KEY = 'pa.map';   // the picker state, restored when the map opens without URL parameters

export function mount(root, params) {
  root.innerHTML = `
  <div class="layout">
    <aside class="panel left">
      <form class="stack" id="m-form" autocomplete="off">
        <h2>${t('map.title')}</h2>
        <p class="muted small">${t('map.desc')}</p>
        <fieldset class="sources">
          <legend>${t('map.sources')}</legend>
          <div class="row tight">
            <button type="button" class="ghost small" data-act="conf">${t('map.allConf')}</button>
            <button type="button" class="ghost small" data-act="journal">${t('map.allJournal')}</button>
            <button type="button" class="ghost small" data-act="clear">${t('map.clear')}</button>
          </div>
          <div class="venue-group"><div class="muted small">${t('map.conf')}</div><div class="vchips" id="m-conf"></div></div>
          <div class="venue-group"><div class="muted small">${t('map.journal')}</div><div class="vchips" id="m-journal"></div></div>
          <label class="check"><input type="checkbox" id="m-arxiv" /> <span>${t('map.arxiv')}</span> <span class="muted small" id="m-arxiv-note"></span></label>
          <label class="inline" id="m-axwrap">${t('map.arxivRange')} <select id="m-axrange">
            <option value="1">${t('map.ax1')}</option>
            <option value="3">${t('map.axN', { n: 3 })}</option>
            <option value="6">${t('map.axN', { n: 6 })}</option>
            <option value="all">${t('map.axAll')}</option>
          </select></label>
        </fieldset>
        <div class="row"><label>${t('yearFrom')} <select name="from" id="m-from"></select></label><label>${t('yearTo')} <select name="to" id="m-to"></select></label></div>
        <div class="muted small" id="m-sel"></div>
        <button type="submit">${icon('map')}${t('map.run')}</button>
      </form>
      <hr />
      <div class="stack" id="m-tools" hidden>
        <label>${t('map.filter')} <input id="m-filter" placeholder="${esc(t('map.filterPh'))}" /></label>
        <div class="muted small" id="m-count"></div>
        <label>${t('map.color')} <select id="m-color">
          <option value="cluster">${t('color.cluster')}</option>
          <option value="source">${t('color.source')}</option>
          <option value="year">${t('color.year')}</option>
        </select></label>
        <div id="m-legend" class="legend"></div>
      </div>
    </aside>
    <section class="canvas-wrap" id="m-wrap">
      <canvas id="m-canvas"></canvas>
      <div class="empty" id="m-empty">${t('map.empty')}</div>
      <div class="hint">${t('map.hint')}</div>
    </section>
    <aside class="panel right" id="m-detail"><p class="muted">${t('map.detailEmpty')}</p></aside>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const form = $('#m-form');
  const wrap = $('#m-wrap');
  const canvas = $('#m-canvas');
  const ctx = canvas.getContext('2d');
  const detail = $('#m-detail');
  const filterEl = $('#m-filter');
  const colorEl = $('#m-color');
  const legendEl = $('#m-legend');
  const countEl = $('#m-count');
  const arxivEl = $('#m-arxiv');
  const axRangeEl = $('#m-axrange');
  const fromEl = $('#m-from');
  const toEl = $('#m-to');

  let index = null;
  let destroyed = false;
  const selected = new Set();

  // ---------- source picker ----------
  function availability() {
    const years = new Map();
    for (const d of index.datasets) {
      const k = d.kind === 'preprint' ? ARXIV : d.venue;
      if (!years.has(k)) years.set(k, new Set());
      years.get(k).add(d.year);
    }
    return years;
  }
  function selectedKeys() {
    const from = +fromEl.value, to = +toEl.value;
    const venues = index.datasets.filter((d) => d.kind !== 'preprint' && d.year >= from && d.year <= to && selected.has(d.venue)).map((d) => d.key);
    return arxivEl.checked ? venues.concat(newestArxivKeys(index, axRangeEl.value, from, to)) : venues;
  }
  function renderPicker() {
    const avail = availability();
    const known = new Set(VENUES.map((v) => v.short));
    const extra = [...avail.keys()].filter((k) => k !== ARXIV && !known.has(k)).map((k) => ({ short: k, kind: 'conf', name: k }));
    const chip = (v) => {
      const yrs = avail.get(v.short);
      const note = yrs ? t('map.years', { years: [...yrs].sort().join(', ') }) : t('map.unavailable');
      const title = `${v.name} — ${note}${v.noteKey ? ' · ' + t(v.noteKey) : ''}`;
      return `<button type="button" class="vchip${selected.has(v.short) ? ' on' : ''}" data-v="${esc(v.short)}" ${yrs ? '' : 'disabled'} title="${esc(title)}">${esc(v.short)}</button>`;
    };
    $('#m-conf').innerHTML = [...VENUES.filter((v) => v.kind === 'conf'), ...extra].map(chip).join('');
    $('#m-journal').innerHTML = VENUES.filter((v) => v.kind === 'journal').map(chip).join('');
    arxivEl.disabled = !avail.has(ARXIV);
    $('#m-arxiv-note').textContent = avail.has(ARXIV) ? '' : t('map.noArxiv');
    updateSelCount();
  }
  function updateSelCount() {
    const keys = new Set(selectedKeys());
    const n = index.datasets.filter((d) => keys.has(d.key)).reduce((s, d) => s + d.n, 0);
    $('#m-axwrap').hidden = !arxivEl.checked;
    $('#m-sel').textContent = keys.size
      ? t('map.selCount', { n: keys.size, p: n.toLocaleString() }) + (n > HEAVY ? ` · ${t('map.heavy')}` : '')
      : t('map.selNone');
  }
  form.addEventListener('click', (e) => {
    const b = e.target.closest('.vchip');
    if (b && !b.disabled) {
      const v = b.dataset.v;
      selected.has(v) ? selected.delete(v) : selected.add(v);
      b.classList.toggle('on');
      updateSelCount();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const avail = availability();
    const group = act === 'clear' ? null : VENUES.filter((v) => v.kind === act && avail.has(v.short)).map((v) => v.short)
      .concat(act === 'conf' ? [...avail.keys()].filter((k) => k !== ARXIV && !VENUES.some((v) => v.short === k)) : []);
    if (!group) selected.clear();
    else if (group.every((v) => selected.has(v))) group.forEach((v) => selected.delete(v));
    else group.forEach((v) => selected.add(v));
    renderPicker();
  });
  arxivEl.addEventListener('change', updateSelCount);
  axRangeEl.addEventListener('change', updateSelCount);
  fromEl.addEventListener('change', () => { if (+fromEl.value > +toEl.value) toEl.value = fromEl.value; updateSelCount(); });
  toEl.addEventListener('change', () => { if (+toEl.value < +fromEl.value) fromEl.value = toEl.value; updateSelCount(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); show(); });

  // ---------- canvas ----------
  let papers = [];
  let transform = d3.zoomIdentity;
  let selectedPaper = null, hovered = null;
  let matchSet = null;
  let hiddenGroups = new Set();
  let colorFn = () => '#888', groupOf = () => null;
  let quad = null;
  let clusterLabels = [];
  const x = d3.scaleLinear(), y = d3.scaleLinear();

  function resize() {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (papers.length) { fitScales(r); buildQuad(); }
    draw();
  }
  function fitScales(r) {
    const px = Math.min(80, r.width * 0.08), py = 30;
    const xe = d3.extent(papers, (p) => p.x), ye = d3.extent(papers, (p) => p.y);
    // keep the aspect ratio so clusters are not stretched
    const sx = (r.width - 2 * px) / Math.max(1e-6, xe[1] - xe[0]);
    const sy = (r.height - 2 * py) / Math.max(1e-6, ye[1] - ye[0]);
    const s = Math.min(sx, sy);
    const cx = (r.width - s * (xe[1] - xe[0])) / 2, cy = (r.height - s * (ye[1] - ye[0])) / 2;
    x.domain(xe).range([cx, cx + s * (xe[1] - xe[0])]);
    y.domain(ye).range([r.height - cy, r.height - cy - s * (ye[1] - ye[0])]);
  }
  function visible(i) { return !hiddenGroups.has(groupOf(i)); }
  function buildQuad() {
    quad = d3.quadtree().x((i) => x(papers[i].x)).y((i) => y(papers[i].y)).addAll(d3.range(papers.length).filter(visible));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  const zoom = d3.zoom().scaleExtent([0.5, 60]).on('zoom', (e) => { transform = e.transform; draw(); });
  d3.select(canvas).call(zoom);

  function draw() {
    const r = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    if (!papers.length) return;
    const k = transform.k;
    const size = Math.max(1.6, Math.min(6, 2.2 * Math.sqrt(k) * Math.sqrt(4000 / Math.max(papers.length, 400))));
    const dot = (i, alpha) => {
      const px = transform.applyX(x(papers[i].x)), py = transform.applyY(y(papers[i].y));
      if (px < -6 || py < -6 || px > r.width + 6 || py > r.height + 6) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colorFn(i);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    };
    const idx = d3.range(papers.length).filter(visible);
    if (matchSet) {
      idx.forEach((i) => { if (!matchSet.has(i)) dot(i, 0.1); });
      idx.forEach((i) => { if (matchSet.has(i)) dot(i, 0.95); });
    } else idx.forEach((i) => dot(i, 0.75));
    ctx.globalAlpha = 1;
    if (colorEl.value === 'cluster') {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const c of clusterLabels) {
        if (hiddenGroups.has(c.id)) continue;
        const px = transform.applyX(x(c.x)), py = transform.applyY(y(c.y));
        ctx.lineWidth = 4; ctx.strokeStyle = css('--bg'); ctx.strokeText(c.label, px, py);
        ctx.fillStyle = css('--fg'); ctx.fillText(c.label, px, py);
      }
    }
    for (const [i, ring] of [[hovered, 1.5], [selectedPaper, 2.5]]) {
      if (i == null) continue;
      ctx.beginPath();
      ctx.arc(transform.applyX(x(papers[i].x)), transform.applyY(y(papers[i].y)), size + 3, 0, Math.PI * 2);
      ctx.lineWidth = ring; ctx.strokeStyle = css('--fg'); ctx.stroke();
    }
  }

  function find(evt) {
    if (!quad) return null;
    const [mx, my] = d3.pointer(evt, canvas);
    const [ix, iy] = transform.invert([mx, my]);
    return quad.find(ix, iy, 10 / transform.k) ?? null;
  }
  canvas.addEventListener('mousemove', (e) => {
    const i = find(e);
    if (i !== hovered) { hovered = i; draw(); }
    canvas.style.cursor = i != null ? 'pointer' : 'grab';
    if (i != null) tip(e, tipHtml(papers[i])); else hideTip();
  });
  canvas.addEventListener('mouseleave', () => { hovered = null; hideTip(); draw(); });
  canvas.addEventListener('click', (e) => { const i = find(e); if (i != null) select(papers[i]); });

  const byGi = new Map();
  async function select(p) {
    selectedPaper = byGi.get(p.gi) ?? null;
    draw();
    detail.innerHTML = paperCard(p, [{ label: t('map.toGraph'), icon: 'graph', href: `#/graph?seed=${encodeURIComponent(seedRef(p))}` }]) + `<h4>${t('map.nearest')}</h4><ol class="list" id="m-nn"></ol>`;
    try {
      const nn = await neighborsOf(p);
      const near = await Promise.all(nn.slice(0, 10).map(async ({ gi, sim }) => ({ q: await paperAt(gi), sim })));
      const list = detail.querySelector('#m-nn');
      if (!list) return;
      list.innerHTML = near.map(({ q, sim }) => `<li><a href="javascript:void 0" data-gi="${q.gi}">${esc(q.title)}</a> <span class="muted small">${esc(venueYear(q))} · ${sim.toFixed(2)}</span></li>`).join('');
      list.querySelectorAll('a[data-gi]').forEach((a) => a.addEventListener('click', async () => {
        const q = await paperAt(+a.dataset.gi);
        select(q);
        if (byGi.has(q.gi)) focusOn(byGi.get(q.gi));
      }));
    } catch (err) { console.error(err); }
  }
  function focusOn(i) {
    const r = wrap.getBoundingClientRect();
    const k = Math.max(transform.k, 4);
    const px = x(papers[i].x), py = y(papers[i].y);
    d3.select(canvas).transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(r.width / 2 - k * px, r.height / 2 - k * py).scale(k));
  }

  // ---------- colour modes & legend ----------
  function computeClusterLabels() {
    const groups = d3.group(d3.range(papers.length), (i) => papers[i].c);
    const min = Math.max(5, papers.length * 0.015);
    clusterLabels = [...groups].filter(([, m]) => m.length >= min).map(([c, m]) => ({
      id: c, label: (index.clusters[c]?.terms || []).join(' · '),
      x: d3.median(m, (i) => papers[i].x), y: d3.median(m, (i) => papers[i].y), n: m.length,
    }));
  }
  function categorical(keyOf, max = 14) {
    const counts = d3.rollups(papers, (v) => v.length, keyOf).sort((a, b) => b[1] - a[1]);
    const top = counts.slice(0, max).map((c) => c[0]);
    const key = (p) => (top.includes(keyOf(p)) ? keyOf(p) : OTHER);
    const col = (g) => (g === OTHER ? '#999' : PALETTE[top.indexOf(g) % PALETTE.length]);
    groupOf = (i) => key(papers[i]);
    colorFn = (i) => col(groupOf(i));
    return [...top, ...(counts.length > max ? [OTHER] : [])].map((g) => ({ key: g, label: g === OTHER ? t('other') : String(g), color: col(g), n: papers.filter((p) => key(p) === g).length }));
  }
  function applyColor() {
    const mode = colorEl.value;
    hiddenGroups = new Set();
    let groups = null;
    if (mode === 'cluster') {
      const ids = [...new Set(papers.map((p) => p.c))].sort((a, b) => a - b);
      const col = (c) => PALETTE[c % PALETTE.length];
      groupOf = (i) => papers[i].c;
      colorFn = (i) => col(papers[i].c);
      groups = ids.map((c) => ({ key: c, label: (index.clusters[c]?.terms || [String(c)]).join(' · '), color: col(c), n: papers.filter((p) => p.c === c).length }))
        .sort((a, b) => b.n - a.n);
    } else if (mode === 'source') {
      groups = categorical((p) => p.venue);
    } else {
      const ext = d3.extent(papers, (p) => p.year);
      const sc = d3.scaleSequential(d3.interpolateViridis).domain(ext[0] === ext[1] ? [ext[0] - 1, ext[1]] : ext);
      groups = categorical((p) => p.year, 30);
      groups.sort((a, b) => a.key - b.key).forEach((g) => { g.color = sc(g.key); });
      colorFn = (i) => sc(papers[i].year);
    }
    legendEl.innerHTML = groups.map((g, gi) => `<button class="legend-item" data-g="${gi}"><span class="sw" style="background:${g.color}"></span><span class="lbl">${esc(g.label)}</span><span class="muted">${g.n.toLocaleString()}</span></button>`).join('') + `<div class="muted small">${t('map.legendHint')}</div>`;
    legendEl.querySelectorAll('.legend-item').forEach((b) => b.addEventListener('click', () => {
      const k = groups[+b.dataset.g].key;
      hiddenGroups.has(k) ? hiddenGroups.delete(k) : hiddenGroups.add(k);
      b.classList.toggle('off');
      buildQuad(); draw();
    }));
    buildQuad();
    draw();
  }
  colorEl.addEventListener('change', applyColor);

  // ---------- filter ----------
  let abstracts = null; // gi -> abstract, loaded on first use
  async function ensureAbstracts() {
    if (abstracts) return;
    abstracts = new Map();
    const keys = [...new Set(papers.map((p) => p.key))];
    let done = 0;
    await Promise.all(keys.map(async (k) => {
      const list = await loadAbstracts(k);
      status(t('status.loadingAbs', { done: ++done, total: keys.length }));
      for (const p of papers) if (p.key === k) abstracts.set(p.gi, list[p.row] || '');
    }));
    clearStatus();
  }
  function applyFilter() {
    const q = filterEl.value.trim().toLowerCase();
    if (!q) { matchSet = null; countEl.textContent = t('map.count', { n: papers.length.toLocaleString() }); draw(); return; }
    const terms = q.split(/\s+/);
    matchSet = new Set();
    papers.forEach((p, i) => {
      const hay = `${p.title} ${p.authors} ${abstracts?.get(p.gi) || ''}`.toLowerCase();
      if (terms.every((term) => hay.includes(term))) matchSet.add(i);
    });
    countEl.textContent = t('map.match', { m: matchSet.size.toLocaleString(), n: papers.length.toLocaleString() });
    draw();
  }
  filterEl.addEventListener('input', debounce(async () => {
    applyFilter();                       // titles and authors right away
    if (filterEl.value.trim() && !abstracts) { await ensureAbstracts(); applyFilter(); }
  }, 200));

  // ---------- load & show ----------
  let runId = 0;
  async function show() {
    const keys = selectedKeys();
    const state = { v: [...selected].join(',') || 'none', from: fromEl.value, to: toEl.value, arxiv: arxivEl.checked ? '1' : '0', ax: axRangeEl.value };
    setParams('map', state);
    if (!keys.length) { status(t('map.selNone'), { error: true }); return; }
    selection.set(keys);
    try { localStorage.setItem(STATE_KEY, new URLSearchParams(state).toString()); } catch { /* storage blocked */ }
    const my = ++runId;
    try {
      const rows = await loadDatasets(keys, (done, total) => status(t('status.loading', { done, total })));
      if (destroyed || my !== runId) return;
      papers = rows;
      byGi.clear();
      papers.forEach((p, i) => byGi.set(p.gi, i));
      abstracts = null; matchSet = null; selectedPaper = null; filterEl.value = '';
      $('#m-empty').hidden = true;
      $('#m-tools').hidden = false;
      countEl.textContent = t('map.count', { n: papers.length.toLocaleString() });
      computeClusterLabels();
      transform = d3.zoomIdentity; d3.select(canvas).call(zoom.transform, transform);
      resize();
      applyColor();
      clearStatus();
    } catch (err) {
      console.error(err);
      status(t('err.load', { msg: err.message }), { error: true });
    }
  }

  // ---------- init ----------
  (async () => {
    try {
      index = await loadIndex();
    } catch (err) {
      $('#m-empty').textContent = t('err.noData');
      return;
    }
    if (destroyed) return;
    const years = [...new Set(index.datasets.map((d) => d.year))].sort();
    const opts = years.map((yv) => `<option>${yv}</option>`).join('');
    fromEl.innerHTML = opts; toEl.innerHTML = opts;
    const avail = availability();
    // URL parameters win; otherwise restore the last picker state; otherwise the newest year of every venue
    let ps = params;
    if (!params.has('v')) { try { ps = new URLSearchParams(localStorage.getItem(STATE_KEY) || ''); } catch { /* storage blocked */ } }
    const venueYears = index.datasets.filter((d) => d.kind !== 'preprint').map((d) => d.year);
    const latest = String(venueYears.length ? Math.max(...venueYears) : years.at(-1));
    const pv = ps.get('v');
    if (pv) { if (pv !== 'none') pv.split(',').forEach((v) => selected.add(v)); }
    else {
      const keys = defaultKeys(index);
      index.datasets.filter((d) => keys.includes(d.key) && d.kind !== 'preprint').forEach((d) => selected.add(d.venue));
    }
    const pick = (v) => (v && years.includes(+v) ? v : latest);
    fromEl.value = pick(ps.get('from'));
    toEl.value = pick(ps.get('to'));
    if (+fromEl.value > +toEl.value) fromEl.value = toEl.value;
    arxivEl.checked = avail.has(ARXIV) && (ps.get('arxiv') === '1' || (!venueYears.length && !pv));
    axRangeEl.value = ['1', '3', '6', 'all'].includes(ps.get('ax')) ? ps.get('ax') : '1';
    renderPicker();
    show();
  })();

  return { destroy() { destroyed = true; ro.disconnect(); hideTip(); } };
}

function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#000'; }
