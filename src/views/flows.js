// View 3: knowledge flows for a topic. Papers on a year axis, one swim-lane per research subfield;
// curves are citations inside the corpus, so you can see where ideas came from and where they went.
import * as d3 from 'd3';
import { fetchCorpus, settings } from '../api.js';
import { esc, status, clearStatus, tip, hideTip, tipHtml, paperCard, setParams } from '../ui.js';

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#b07aa1', '#edc948', '#9c755f'];
const MAX_LANES = 7;

export function mount(root, params) {
  const p = (k, d) => params.get(k) ?? d;
  root.innerHTML = `
  <div class="layout">
    <aside class="panel left">
      <form class="stack" id="f-form">
        <h2>知识流</h2>
        <p class="muted small">取一个主题下被引最多的论文，按年份和研究子领域排开；曲线是这些论文之间的引用，颜色跟随“知识来源”所在的子领域。</p>
        <label>主题 <input name="topic" value="${esc(p('topic', settings.demo ? 'transformer' : 'transformer'))}" /></label>
        <div class="row"><label>起始年 <input name="from" type="number" value="${esc(p('from', settings.demo ? '2012' : '2010'))}" /></label><label>结束年 <input name="to" type="number" value="${esc(p('to', '2025'))}" /></label></div>
        <label>论文数量 <select name="n">${[200, 400, 600, 800].map((n) => `<option ${String(n) === p('n', '400') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button type="submit">生成知识流</button>
      </form>
      <div id="f-side" hidden>
        <hr />
        <h4>子领域之间的知识流</h4>
        <p class="muted small">A → B：B 子领域的论文引用 A 子领域的论文次数。</p>
        <div id="f-matrix"></div>
        <h4>知识源头 <span class="muted small">在本主题内被引最多</span></h4>
        <ol class="list" id="f-roots"></ol>
      </div>
    </aside>
    <section class="canvas-wrap scroll" id="f-wrap">
      <svg id="f-svg"></svg>
      <div class="empty" id="f-empty">输入主题后点击“生成知识流”。</div>
      <div class="hint">悬停查看论文 · 点击论文高亮它的“知识谱系”（上游来源与下游影响）· 点空白处取消</div>
    </section>
    <aside class="panel right" id="f-detail"><p class="muted">点击论文查看它的上游与下游。</p></aside>
  </div>`;

  const form = root.querySelector('#f-form');
  const wrap = root.querySelector('#f-wrap');
  const svgEl = root.querySelector('#f-svg');
  const svg = d3.select(svgEl);
  const detail = root.querySelector('#f-detail');
  let destroyed = false, runId = 0, data = null;

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  async function run() {
    const fd = new FormData(form);
    const opts = { query: fd.get('topic').trim(), yearFrom: +fd.get('from') || undefined, yearTo: +fd.get('to') || undefined, limit: +fd.get('n'), sort: 'cited_by_count:desc' };
    if (!opts.query) return;
    setParams('flows', { topic: opts.query, from: opts.yearFrom, to: opts.yearTo, n: opts.limit });
    const my = ++runId;
    try {
      status('正在获取主题论文…');
      const { works } = await fetchCorpus(opts, (n, t) => status(`正在获取主题论文… ${n} / ${t}`));
      if (destroyed || my !== runId) return;
      if (works.length < 5) throw new Error('论文太少，换个主题或扩大年份范围。');
      data = analyse(works);
      render(data);
      clearStatus();
    } catch (err) { console.error(err); status(err.message || String(err), { error: true }); }
  }

  function analyse(works) {
    works = works.filter((w) => w.year);
    const byId = new Map(works.map((w) => [w.id, w]));
    const counts = d3.rollups(works, (v) => v.length, (w) => w.subfield).sort((a, b) => b[1] - a[1]);
    const top = counts.slice(0, MAX_LANES).map((c) => c[0]);
    const lanes = counts.length > MAX_LANES ? [...top, '其他'] : top;
    const laneOf = (w) => (top.includes(w.subfield) ? w.subfield : '其他');
    const edges = [];
    const up = new Map(works.map((w) => [w.id, []]));   // what w cites
    const down = new Map(works.map((w) => [w.id, []])); // who cites w
    for (const w of works) for (const r of w.refs) if (byId.has(r)) { edges.push({ from: r, to: w.id }); up.get(w.id).push(r); down.get(r).push(w.id); }
    const inDeg = new Map(works.map((w) => [w.id, down.get(w.id).length]));
    const flow = d3.rollups(edges, (v) => v.length, (e) => laneOf(byId.get(e.from)), (e) => laneOf(byId.get(e.to)));
    const matrix = [];
    for (const [a, list] of flow) for (const [b, n] of list) matrix.push({ a, b, n });
    matrix.sort((x, y) => y.n - x.n);
    return { works, byId, lanes, laneOf, edges, up, down, inDeg, matrix };
  }

  function lineage(id, dir) {
    const seen = new Set(); const stack = [id];
    while (stack.length) { const c = stack.pop(); for (const n of data[dir].get(c)) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
    return seen;
  }

  function render(D) {
    root.querySelector('#f-empty').hidden = true;
    svg.selectAll('*').remove();
    const width = Math.max(720, wrap.clientWidth);
    const m = { top: 130, right: 24, bottom: 36, left: 170 };
    // lane height grows with the number of papers in it (sqrt, so small lanes stay readable)
    const laneCount = d3.rollup(D.works, (v) => v.length, (w) => D.laneOf(w));
    const minH = 56;
    const avail = Math.max(D.lanes.length * 90, wrap.clientHeight - m.top - m.bottom - 8);
    const sq = D.lanes.map((l) => Math.sqrt(laneCount.get(l) || 0));
    const sqSum = d3.sum(sq) || 1;
    const laneHs = sq.map((v) => minH + (avail - minH * D.lanes.length) * (v / sqSum));
    const laneY = [];
    laneHs.reduce((acc, hh, i) => { laneY[i] = acc; return acc + hh; }, m.top);
    const height = m.top + d3.sum(laneHs) + m.bottom;
    svg.attr('width', width).attr('height', height);
    const years = d3.extent(D.works, (w) => w.year);
    const x = d3.scaleLinear().domain([years[0] - 0.5, years[1] + 0.5]).range([m.left, width - m.right]);
    const laneIdx = new Map(D.lanes.map((l, i) => [l, i]));
    const color = (lane) => (lane === '其他' ? '#999' : PALETTE[laneIdx.get(lane) % PALETTE.length]);
    const r = d3.scaleSqrt().domain([0, d3.max(D.works, (w) => w.citations) || 1]).range([2.5, 14]);

    // deterministic jitter so the layout is stable between renders
    const h = (s) => { let v = 2166136261; for (const c of s) v = Math.imul(v ^ c.charCodeAt(0), 16777619); return ((v >>> 0) % 10000) / 10000; };
    for (const w of D.works) {
      const li = laneIdx.get(D.laneOf(w));
      w._x = x(w.year) + (h(w.id) - 0.5) * (x(1) - x(0)) * 0.8;
      // more-cited papers sit closer to the lane centre
      const spread = 0.46 * (1 - Math.min(0.8, Math.log1p(w.citations) / Math.log1p(d3.max(D.works, (q) => q.citations))));
      w._y = laneY[li] + laneHs[li] * 0.5 + (h(w.id + 'y') - 0.5) * 2 * spread * laneHs[li];
    }

    // --- top: stacked yearly counts per lane ---
    const yearsAll = d3.range(years[0], years[1] + 1);
    const table = yearsAll.map((yr) => { const row = { year: yr }; for (const l of D.lanes) row[l] = 0; return row; });
    for (const w of D.works) table[w.year - years[0]][D.laneOf(w)]++;
    const stack = d3.stack().keys(D.lanes)(table);
    const ys = d3.scaleLinear().domain([0, d3.max(stack.at(-1), (d) => d[1]) || 1]).range([m.top - 22, 18]);
    const area = d3.area().x((d) => x(d.data.year)).y0((d) => ys(d[0])).y1((d) => ys(d[1])).curve(d3.curveMonotoneX);
    const gTop = svg.append('g');
    gTop.selectAll('path').data(stack).join('path').attr('d', area).attr('fill', (d) => color(d.key)).attr('opacity', 0.8)
      .append('title').text((d) => d.key);
    gTop.append('text').attr('x', 24).attr('y', 60).attr('class', 'axis-label').text('每年论文数');
    gTop.append('g').attr('transform', `translate(${m.left - 4},0)`).call(d3.axisLeft(ys).ticks(3)).attr('class', 'axis');

    // --- lanes ---
    const gL = svg.append('g');
    D.lanes.forEach((l, i) => {
      const y0 = laneY[i], laneH = laneHs[i];
      gL.append('rect').attr('x', m.left).attr('y', y0).attr('width', width - m.left - m.right).attr('height', laneH).attr('class', i % 2 ? 'lane odd' : 'lane');
      gL.append('rect').attr('x', 8).attr('y', y0 + laneH / 2 - 6).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', color(l));
      gL.append('text').attr('x', 24).attr('y', y0 + laneH / 2 + 3).attr('class', 'lane-label').text(l.length > 22 ? l.slice(0, 21) + '…' : l).append('title').text(l);
    });
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.min(yearsAll.length, 16)).tickFormat(d3.format('d')));

    // --- citation curves ---
    const gE = svg.append('g').attr('class', 'flows');
    const path = (e) => {
      const a = D.byId.get(e.from), b = D.byId.get(e.to);
      const mx = (a._x + b._x) / 2;
      return `M${a._x},${a._y} C${mx},${a._y} ${mx},${b._y} ${b._x},${b._y}`;
    };
    const edgeSel = gE.selectAll('path').data(D.edges).join('path').attr('d', path)
      .attr('stroke', (e) => color(D.laneOf(D.byId.get(e.from))));

    // --- papers ---
    const gN = svg.append('g');
    const nodeSel = gN.selectAll('circle').data(D.works).join('circle').attr('class', 'flow-node')
      .attr('cx', (w) => w._x).attr('cy', (w) => w._y).attr('r', (w) => r(w.citations)).attr('fill', (w) => color(D.laneOf(w)))
      .on('mouseenter mousemove', (e, w) => tip(e, tipHtml(w) + `<div class="muted">主题内被引 ${D.inDeg.get(w.id)} · 引用主题内 ${D.up.get(w.id).length}</div>`))
      .on('mouseleave', hideTip)
      .on('click', (e, w) => { e.stopPropagation(); focus(w); });
    // labels for the biggest in-topic roots
    const roots = [...D.works].sort((a, b) => D.inDeg.get(b.id) - D.inDeg.get(a.id)).slice(0, 12);
    gN.selectAll('text').data(roots.slice(0, 8)).join('text').attr('class', 'flow-label').attr('x', (w) => w._x + r(w.citations) + 3).attr('y', (w) => w._y + 4)
      .text((w) => (w.title.length > 28 ? w.title.slice(0, 27) + '…' : w.title));
    svg.on('click', () => focus(null));

    function focus(w) {
      if (!w) {
        nodeSel.classed('faded', false).classed('sel', false); edgeSel.classed('faded', false).classed('hl', false);
        detail.innerHTML = '<p class="muted">点击论文查看它的上游与下游。</p>';
        return;
      }
      const anc = lineage(w.id, 'up'), des = lineage(w.id, 'down');
      const on = new Set([w.id, ...anc, ...des]);
      nodeSel.classed('faded', (o) => !on.has(o.id)).classed('sel', (o) => o.id === w.id);
      const inDown = (id) => id === w.id || des.has(id);
      const inUp = (id) => id === w.id || anc.has(id);
      edgeSel.classed('hl', (e) => (inDown(e.from) && inDown(e.to)) || (inUp(e.from) && inUp(e.to)))
        .classed('faded', (e) => !((inDown(e.from) && inDown(e.to)) || (inUp(e.from) && inUp(e.to))));
      const directUp = D.up.get(w.id).map((id) => D.byId.get(id)).sort((a, b) => b.citations - a.citations);
      const directDown = D.down.get(w.id).map((id) => D.byId.get(id)).sort((a, b) => b.citations - a.citations);
      const li = (q) => `<li><a href="javascript:void 0" data-id="${q.id}">${esc(q.title)}</a> <span class="muted small">${q.year} · ${esc(D.laneOf(q))}</span></li>`;
      const spreadTo = d3.rollups([...des].map((id) => D.byId.get(id)), (v) => v.length, (q) => D.laneOf(q)).sort((a, b) => b[1] - a[1]);
      detail.innerHTML = paperCard(w, [{ label: '相关论文图 →', href: `#/graph?seed=${w.id}` }])
        + `<p class="small">上游来源 <b>${anc.size}</b> 篇 · 下游影响 <b>${des.size}</b> 篇</p>`
        + (spreadTo.length ? `<p class="small muted">影响扩散到：${spreadTo.map(([l, n]) => `${esc(l)} ${n}`).join('，')}</p>` : '')
        + `<h4>直接引用（主题内）</h4><ol class="list">${directUp.slice(0, 15).map(li).join('') || '<li class="muted">无</li>'}</ol>`
        + `<h4>被直接引用（主题内）</h4><ol class="list">${directDown.slice(0, 15).map(li).join('') || '<li class="muted">无</li>'}</ol>`;
      detail.querySelectorAll('a[data-id]').forEach((a) => a.addEventListener('click', () => focus(D.byId.get(a.dataset.id))));
    }

    // --- side panel ---
    root.querySelector('#f-side').hidden = false;
    const maxN = D.matrix[0]?.n || 1;
    root.querySelector('#f-matrix').innerHTML = D.matrix.slice(0, 12).map((d) => `
      <div class="flow-row" title="${esc(d.a)} → ${esc(d.b)}：${d.n}">
        <span class="sw" style="background:${color(d.a)}"></span><span class="lbl">${esc(short(d.a))} → ${esc(short(d.b))}</span><span class="muted small">${d.n}</span>
        <span class="bar"><i style="width:${Math.max(1, (100 * d.n) / maxN)}%;background:${color(d.a)}"></i></span>
      </div>`).join('') || '<p class="muted small">这组论文之间没有引用关系。</p>';
    root.querySelector('#f-roots').innerHTML = roots.map((w) => `<li><a href="javascript:void 0" data-id="${w.id}">${esc(w.title)}</a> <span class="muted small">${w.year} · 主题内被引 ${D.inDeg.get(w.id)}</span></li>`).join('');
    root.querySelectorAll('#f-roots a[data-id]').forEach((a) => a.addEventListener('click', () => {
      const w = D.byId.get(a.dataset.id); focus(w);
      wrap.scrollTo({ top: w._y - wrap.clientHeight / 2, left: w._x - wrap.clientWidth / 2, behavior: 'smooth' });
    }));
  }

  run();
  return { destroy() { destroyed = true; hideTip(); } };
}

const short = (s) => (s.length > 18 ? s.slice(0, 17) + '…' : s);
