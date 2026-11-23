// View 1: 2D semantic map of a paper corpus (TF-IDF + UMAP), with search, cluster legend and colour modes.
import * as d3 from 'd3';
import { fetchCorpus, settings } from '../api.js';
import { tfidf, project, umap2d, kmeans, clusterLabels } from '../lib/embed.js';
import { esc, status, clearStatus, tip, hideTip, tipHtml, paperCard, debounce, setParams } from '../ui.js';

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#86bcb6', '#d37295', '#a0cbe8', '#8cd17d', '#fabfd2'];

export function mount(root, params) {
  const defaults = settings.demo
    ? { q: '', venue: '', from: '2012', to: '2024', n: '600' }
    : { q: '', venue: 'AAAI Conference on Artificial Intelligence', from: '2022', to: '2022', n: '600' };
  const p = (k) => params.get(k) ?? defaults[k];

  root.innerHTML = `
  <div class="layout">
    <aside class="panel left">
      <form class="stack" id="m-form">
        <h2>论文地图</h2>
        <p class="muted small">按摘要语义把论文放到二维平面上：越近越相似。</p>
        <label>关键词 <input name="q" value="${esc(p('q'))}" placeholder="例如 transformer（可空）" /></label>
        <label>会议 / 期刊 <input name="venue" value="${esc(p('venue'))}" placeholder="例如 AAAI Conference on Artificial Intelligence" /></label>
        <div class="row"><label>起始年 <input name="from" type="number" value="${esc(p('from'))}" /></label><label>结束年 <input name="to" type="number" value="${esc(p('to'))}" /></label></div>
        <label>论文数量上限 <select name="n">${[200, 400, 600, 1000, 1500].map((n) => `<option ${String(n) === p('n') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button type="submit">生成地图</button>
      </form>
      <hr />
      <div class="stack" id="m-tools" hidden>
        <label>筛选（标题 / 作者 / 摘要） <input id="m-filter" placeholder="输入后高亮匹配论文" /></label>
        <div class="muted small" id="m-count"></div>
        <label>着色 <select id="m-color"><option value="cluster">语义簇</option><option value="year">年份</option><option value="subfield">OpenAlex 子领域</option></select></label>
        <div id="m-legend" class="legend"></div>
      </div>
    </aside>
    <section class="canvas-wrap" id="m-wrap">
      <canvas id="m-canvas"></canvas>
      <div class="empty" id="m-empty">设置条件后点击“生成地图”。</div>
      <div class="hint">滚轮缩放 · 拖动平移 · 点击论文查看详情</div>
    </section>
    <aside class="panel right" id="m-detail"><p class="muted">点击地图上的论文查看详情。</p></aside>
  </div>`;

  const form = root.querySelector('#m-form');
  const wrap = root.querySelector('#m-wrap');
  const canvas = root.querySelector('#m-canvas');
  const ctx = canvas.getContext('2d');
  const detail = root.querySelector('#m-detail');
  const tools = root.querySelector('#m-tools');
  const filterEl = root.querySelector('#m-filter');
  const colorEl = root.querySelector('#m-color');
  const legendEl = root.querySelector('#m-legend');
  const countEl = root.querySelector('#m-count');

  let state = null; // { works, xy, cluster, labels, centroids }
  let transform = d3.zoomIdentity;
  let selected = null, hovered = null;
  let matchSet = null;
  let hiddenGroups = new Set();
  let colorFn = () => '#888', groupOf = () => null;
  let destroyed = false;
  let runId = 0;

  const x = d3.scaleLinear(), y = d3.scaleLinear();
  let quad = null;

  function resize() {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state) { fitScales(r); buildQuad(); }
    draw();
  }
  function fitScales(r) {
    const px = Math.min(110, r.width * 0.12), py = 40;
    x.domain(d3.extent(state.xy, (d) => d[0])).range([px, r.width - px]);
    y.domain(d3.extent(state.xy, (d) => d[1])).range([r.height - py, py]);
  }
  function buildQuad() {
    quad = d3.quadtree().x((i) => x(state.xy[i][0])).y((i) => y(state.xy[i][1])).addAll(d3.range(state.works.length));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  const zoom = d3.zoom().scaleExtent([0.5, 40]).on('zoom', (e) => { transform = e.transform; draw(); });
  d3.select(canvas).call(zoom);

  function radius(w) { return 2 + Math.min(7, Math.sqrt(Math.log1p(w.citations)) * 1.3); }
  function visible(i) { const g = groupOf(i); return !hiddenGroups.has(g); }

  function draw() {
    const r = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    if (!state) return;
    const k = transform.k;
    const dim = !!matchSet;
    for (let pass = 0; pass < 2; pass++) {
      state.works.forEach((w, i) => {
        if (!visible(i)) return;
        const isMatch = !dim || matchSet.has(i);
        if ((pass === 0) === isMatch && dim) return; // dimmed first, matches on top
        if (!dim && pass === 1) return;
        const [px, py] = transform.apply([x(state.xy[i][0]), y(state.xy[i][1])]);
        if (px < -10 || py < -10 || px > r.width + 10 || py > r.height + 10) return;
        ctx.beginPath();
        ctx.arc(px, py, radius(w) * Math.sqrt(k) * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = colorFn(i);
        ctx.globalAlpha = isMatch ? 0.85 : 0.12;
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
    // cluster labels
    if (colorEl.value === 'cluster') {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      state.centroids.forEach((c, ci) => {
        if (hiddenGroups.has(ci)) return;
        const [px, py] = transform.apply([x(c[0]), y(c[1])]);
        const label = state.labels[ci].join(' · ');
        ctx.lineWidth = 4; ctx.strokeStyle = getCss('--bg'); ctx.strokeText(label, px, py);
        ctx.fillStyle = getCss('--fg'); ctx.fillText(label, px, py);
      });
    }
    for (const [i, ring] of [[hovered, 1.5], [selected, 2.5]]) {
      if (i == null) continue;
      const [px, py] = transform.apply([x(state.xy[i][0]), y(state.xy[i][1])]);
      ctx.beginPath(); ctx.arc(px, py, radius(state.works[i]) * Math.sqrt(k) * 0.8 + 3, 0, Math.PI * 2);
      ctx.lineWidth = ring; ctx.strokeStyle = getCss('--fg'); ctx.stroke();
    }
  }

  function find(evt) {
    if (!quad) return null;
    const [mx, my] = d3.pointer(evt, canvas);
    const [ix, iy] = transform.invert([mx, my]);
    const i = quad.find(ix, iy, 12 / transform.k);
    return i != null && visible(i) ? i : null;
  }
  canvas.addEventListener('mousemove', (e) => {
    const i = find(e);
    if (i !== hovered) { hovered = i; draw(); }
    canvas.style.cursor = i != null ? 'pointer' : 'grab';
    if (i != null) tip(e, tipHtml(state.works[i])); else hideTip();
  });
  canvas.addEventListener('mouseleave', () => { hovered = null; hideTip(); draw(); });
  canvas.addEventListener('click', (e) => { const i = find(e); if (i != null) select(i); });

  function select(i) {
    selected = i;
    const w = state.works[i];
    const nn = neighbours(i, 6);
    detail.innerHTML = paperCard(w, [
      { label: '相关论文图 →', href: `#/graph?seed=${w.id}` },
    ]) + `<h4>地图上最相近的论文</h4><ol class="list">${nn.map((j) => `<li data-i="${j}"><a href="javascript:void 0">${esc(state.works[j].title)}</a> <span class="muted">${state.works[j].year}</span></li>`).join('')}</ol>`;
    detail.querySelectorAll('li[data-i]').forEach((li) => li.addEventListener('click', () => { select(+li.dataset.i); focusOn(+li.dataset.i); }));
    draw();
  }
  function neighbours(i, n) {
    const [a, b] = state.xy[i];
    return d3.range(state.works.length).filter((j) => j !== i)
      .sort((p, q) => ((state.xy[p][0] - a) ** 2 + (state.xy[p][1] - b) ** 2) - ((state.xy[q][0] - a) ** 2 + (state.xy[q][1] - b) ** 2)).slice(0, n);
  }
  function focusOn(i) {
    const r = wrap.getBoundingClientRect();
    const k = Math.max(transform.k, 3);
    const px = x(state.xy[i][0]), py = y(state.xy[i][1]);
    d3.select(canvas).transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(r.width / 2 - k * px, r.height / 2 - k * py).scale(k));
  }

  function applyColor() {
    const mode = colorEl.value;
    hiddenGroups = new Set();
    let groups;
    if (mode === 'cluster') {
      groupOf = (i) => state.cluster[i];
      colorFn = (i) => PALETTE[state.cluster[i] % PALETTE.length];
      groups = state.labels.map((l, ci) => ({ key: ci, label: l.join(' · '), color: PALETTE[ci % PALETTE.length], n: state.cluster.filter((c) => c === ci).length }));
    } else if (mode === 'subfield') {
      const counts = d3.rollups(state.works, (v) => v.length, (w) => w.subfield).sort((a, b) => b[1] - a[1]);
      const top = counts.slice(0, 11).map((c) => c[0]);
      const key = (w) => (top.includes(w.subfield) ? w.subfield : '其他');
      groupOf = (i) => key(state.works[i]);
      const col = (g) => (g === '其他' ? '#999' : PALETTE[top.indexOf(g) % PALETTE.length]);
      colorFn = (i) => col(groupOf(i));
      groups = [...top, ...(counts.length > 11 ? ['其他'] : [])].map((g) => ({ key: g, label: g, color: col(g), n: state.works.filter((w) => key(w) === g).length }));
    } else {
      const ext = d3.extent(state.works, (w) => w.year);
      const sc = d3.scaleSequential(d3.interpolateViridis).domain(ext[0] === ext[1] ? [ext[0] - 1, ext[1]] : ext);
      groupOf = () => null;
      colorFn = (i) => sc(state.works[i].year);
      groups = null;
      legendEl.innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${d3.range(0, 1.01, 0.1).map((t) => d3.interpolateViridis(t)).join(',')})"></div><div class="row between small muted"><span>${ext[0]}</span><span>${ext[1]}</span></div>`;
    }
    if (groups) {
      legendEl.innerHTML = groups.map((g) => `<button class="legend-item" data-key="${esc(g.key)}"><span class="sw" style="background:${g.color}"></span><span class="lbl">${esc(g.label)}</span><span class="muted">${g.n}</span></button>`).join('') + '<div class="muted small">点击图例可隐藏 / 显示该组</div>';
      legendEl.querySelectorAll('.legend-item').forEach((b) => b.addEventListener('click', () => {
        const k = mode === 'cluster' ? +b.dataset.key : b.dataset.key;
        hiddenGroups.has(k) ? hiddenGroups.delete(k) : hiddenGroups.add(k);
        b.classList.toggle('off');
        buildQuad(); draw();
      }));
    }
    draw();
  }
  colorEl.addEventListener('change', applyColor);

  filterEl.addEventListener('input', debounce(() => {
    const q = filterEl.value.trim().toLowerCase();
    if (!q || !state) { matchSet = null; countEl.textContent = state ? `共 ${state.works.length} 篇` : ''; draw(); return; }
    const terms = q.split(/\s+/);
    matchSet = new Set();
    state.works.forEach((w, i) => {
      const hay = (w.title + ' ' + w.authors.join(' ') + ' ' + w.abstract).toLowerCase();
      if (terms.every((t) => hay.includes(t))) matchSet.add(i);
    });
    countEl.textContent = `匹配 ${matchSet.size} / ${state.works.length} 篇`;
    draw();
  }, 150));

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  async function run() {
    const fd = new FormData(form);
    const opts = { query: fd.get('q').trim(), venue: fd.get('venue').trim(), yearFrom: +fd.get('from') || undefined, yearTo: +fd.get('to') || undefined, limit: +fd.get('n') };
    setParams('map', { q: opts.query, venue: opts.venue, from: opts.yearFrom, to: opts.yearTo, n: opts.limit });
    const my = ++runId;
    try {
      status('正在从 OpenAlex 获取论文…');
      const { works, sourceName } = await fetchCorpus(opts, (n, total) => status(`正在获取论文… ${n} / ${total}`));
      if (destroyed || my !== runId) return;
      if (works.length < 5) throw new Error(`只找到 ${works.length} 篇论文，换个条件试试。`);
      status(`正在计算文本向量（${works.length} 篇）…`);
      await new Promise((r) => setTimeout(r, 30));
      const docs = works.map((w) => `${w.title} ${w.title} ${w.abstract}`);
      const { vecs, vocab } = tfidf(docs);
      const dense = project(vecs, vocab.length);
      const xy = await umap2d(dense, (f) => status(`正在降维布局（UMAP）… ${Math.round(f * 100)}%`));
      if (destroyed || my !== runId) return;
      const k = Math.max(4, Math.min(14, Math.round(Math.sqrt(works.length / 4))));
      const { assign, centroids } = kmeans(xy, k);
      const labels = clusterLabels(vecs, vocab, assign, centroids.length);
      state = { works, xy, cluster: assign, labels, centroids, sourceName };
      selected = null; matchSet = null; filterEl.value = '';
      root.querySelector('#m-empty').hidden = true;
      tools.hidden = false;
      countEl.textContent = `共 ${works.length} 篇${sourceName ? ' · ' + sourceName : ''}`;
      transform = d3.zoomIdentity; d3.select(canvas).call(zoom.transform, transform);
      resize();
      applyColor();
      clearStatus();
    } catch (err) {
      console.error(err);
      status(err.message || String(err), { error: true });
    }
  }

  // auto-run when the URL already describes a map
  if (params.toString() || settings.demo) run();

  return {
    destroy() { destroyed = true; ro.disconnect(); hideTip(); },
  };
}

function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#000'; }
