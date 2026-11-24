// View 2: related-paper graph around a seed paper, built from the precomputed nearest-neighbour lists
// (semantic similarity of title + abstract). Citation-based similarity can be added once citation data exists.
import * as d3 from 'd3';
import { loadIndex, loadDatasets, loadDataset, neighborsOf, paperAt, selection, defaultKeys, matcher, seedRef } from '../data.js';
import { esc, status, clearStatus, tip, hideTip, tipHtml, paperCard, authorsLine, setParams, venueYear, shortLabel } from '../ui.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

const FIRST_HOP = 20;
const MAX_NODES = 36;

export function mount(root, params) {
  root.innerHTML = `
  <div class="layout">
    <aside class="panel left">
      <form class="stack" id="g-form" autocomplete="off">
        <h2>${t('graph.title')}</h2>
        <p class="muted small">${t('graph.desc')}</p>
        <label>${t('graph.seed')} <input name="q" placeholder="${esc(t('graph.seedPh'))}" /></label>
        <div class="muted small" id="g-scope"></div>
        <button type="submit">${icon('search')}${t('search')}</button>
      </form>
      <ol class="list results" id="g-results"></ol>
      <div id="g-lists" hidden>
        <hr />
        <h4>${t('graph.earlier')}</h4>
        <ol class="list" id="g-earlier"></ol>
        <h4>${t('graph.later')}</h4>
        <ol class="list" id="g-later"></ol>
      </div>
    </aside>
    <section class="canvas-wrap" id="g-wrap">
      <svg id="g-svg"></svg>
      <div class="empty" id="g-empty">${t('graph.empty')}</div>
      <div class="graph-legend" id="g-legend" hidden></div>
      <div class="hint">${t('graph.hint')}</div>
    </section>
    <aside class="panel right" id="g-detail"><p class="muted">${t('graph.detailEmpty')}</p></aside>
  </div>`;

  const form = root.querySelector('#g-form');
  const resultsEl = root.querySelector('#g-results');
  const svg = d3.select(root.querySelector('#g-svg'));
  const wrap = root.querySelector('#g-wrap');
  const detail = root.querySelector('#g-detail');
  let sim = null, destroyed = false, runId = 0, graph = null, scopeKeys = [];

  async function scopePapers() {
    const index = await loadIndex();
    scopeKeys = (selection.get() || []).filter((k) => index.datasets.some((d) => d.key === k));
    if (!scopeKeys.length) scopeKeys = defaultKeys(index);
    const n = index.datasets.filter((d) => scopeKeys.includes(d.key)).reduce((s, d) => s + d.n, 0);
    root.querySelector('#g-scope').textContent = t('graph.scope', { n: n.toLocaleString() });
    return loadDatasets(scopeKeys, (done, total) => status(t('status.loading', { done, total })));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = new FormData(form).get('q').trim();
    if (!q) return;
    try {
      status(t('searching'));
      const papers = await scopePapers();
      const titleHit = matcher(q);
      const terms = q.toLowerCase().split(/\s+/);
      const hits = papers.filter((p) => titleHit(`${p.title} ${p.authors}`))
        .map((p) => ({ p, score: terms.filter((term) => p.title.toLowerCase().includes(term)).length }))
        .sort((a, b) => b.score - a.score || b.p.year - a.p.year).slice(0, 12).map((h) => h.p);
      clearStatus();
      resultsEl.innerHTML = hits.length
        ? hits.map((p) => `<li><a href="#/graph?seed=${encodeURIComponent(seedRef(p))}">${esc(p.title)}</a><div class="muted small">${esc(authorsLine(p, 2))} · ${esc(venueYear(p))}</div></li>`).join('')
        : `<li class="muted">${t('noResults')}</li>`;
    } catch (err) { status(t('err.load', { msg: err.message }), { error: true }); }
  });

  async function findSeed(ref) {
    const [key, ...rest] = ref.split('~');
    const id = rest.join('~');
    const rows = await loadDataset(key);
    return rows.find((p) => p.id === id) || null;
  }

  async function build(seed) {
    const my = ++runId;
    resultsEl.innerHTML = '';
    status(t('status.loading', { done: 0, total: 1 }));
    // first hop: the seed's nearest neighbours; second hop: the closest neighbours of the closest first-hop papers
    const nodes = new Map([[seed.gi, { gi: seed.gi, p: seed, sim: 1, hop: 0 }]]);
    const nnOf = new Map([[seed.gi, await neighborsOf(seed)]]);
    for (const { gi, sim: s } of nnOf.get(seed.gi).slice(0, FIRST_HOP)) nodes.set(gi, { gi, sim: s, hop: 1 });
    const first = [...nodes.values()].filter((n) => n.hop === 1).sort((a, b) => b.sim - a.sim);
    for (const n of first) {
      n.p = await paperAt(n.gi);
      nnOf.set(n.gi, await neighborsOf(n.p));
    }
    for (const n of first.slice(0, 12)) {
      for (const m of nnOf.get(n.gi).slice(0, 4)) {
        if (nodes.size >= MAX_NODES) break;
        if (!nodes.has(m.gi)) nodes.set(m.gi, { gi: m.gi, sim: n.sim * m.sim, hop: 2 });
      }
    }
    for (const n of nodes.values()) {
      if (!n.p) n.p = await paperAt(n.gi);
      if (!nnOf.has(n.gi)) nnOf.set(n.gi, await neighborsOf(n.p));
    }
    if (destroyed || my !== runId) return;
    // edges: keep each node's strongest links to other nodes in the graph
    const best = new Map();
    for (const [gi, list] of nnOf) {
      if (!nodes.has(gi)) continue;
      for (const { gi: other, sim: s } of list) {
        if (other === gi || !nodes.has(other)) continue;
        const key = gi < other ? `${gi}|${other}` : `${other}|${gi}`;
        if (!best.has(key) || best.get(key).s < s) best.set(key, { a: gi, b: other, s });
      }
    }
    const perNode = d3.group([...best.values()].flatMap((e) => [[e.a, e], [e.b, e]]), (d) => d[0]);
    const keep = new Set();
    for (const [, list] of perNode) list.map((d) => d[1]).sort((x, y) => y.s - x.s).slice(0, 4).forEach((e) => keep.add(e));
    graph = {
      seed,
      nodes: [...nodes.values()].sort((a, b) => b.sim - a.sim),
      links: [...keep].map((e) => ({ source: e.a, target: e.b, s: e.s })),
    };
    renderLists(graph);
    render(graph);
    showDetail(graph.nodes[0]);
    clearStatus();
  }

  function item(n) {
    return `<li><a href="#/graph?seed=${encodeURIComponent(seedRef(n.p))}">${esc(n.p.title)}</a><div class="muted small">${esc(authorsLine(n.p, 2))} · ${esc(venueYear(n.p))} · ${n.sim.toFixed(2)}</div></li>`;
  }
  function renderLists(g) {
    const others = g.nodes.filter((n) => n.hop > 0);
    const earlier = others.filter((n) => n.p.year < g.seed.year);
    const later = others.filter((n) => n.p.year >= g.seed.year);
    root.querySelector('#g-earlier').innerHTML = earlier.slice(0, 10).map(item).join('') || `<li class="muted">${t('none')}</li>`;
    root.querySelector('#g-later').innerHTML = later.slice(0, 10).map(item).join('') || `<li class="muted">${t('none')}</li>`;
    root.querySelector('#g-lists').hidden = false;
  }

  function render(g) {
    root.querySelector('#g-empty').hidden = true;
    sim?.stop();
    svg.selectAll('*').remove();
    const { width, height } = wrap.getBoundingClientRect();
    svg.attr('viewBox', [0, 0, width, height]);
    const zoomG = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.3, 6]).on('zoom', (e) => zoomG.attr('transform', e.transform)));

    const years = d3.extent(g.nodes, (n) => n.p.year);
    const color = d3.scaleSequential((v) => d3.interpolateYlGnBu(0.3 + 0.7 * v)).domain(years[0] === years[1] ? [years[0] - 1, years[1]] : years);
    const simExt = d3.extent(g.nodes.filter((n) => n.hop > 0), (n) => n.sim);
    const r = d3.scaleLinear().domain(simExt[0] === undefined ? [0, 1] : simExt).range([6, 20]).clamp(true);
    const radius = (n) => (n.hop === 0 ? 22 : r(n.sim));
    const w = d3.scaleLinear().domain(d3.extent(g.links, (l) => l.s)).range([0.6, 4]);

    const links = g.links.map((l) => ({ ...l }));
    const nodes = g.nodes.map((n) => ({ ...n, id: n.gi }));
    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => 150 - 100 * Math.min(1, l.s)).strength((l) => 0.2 + 0.8 * Math.min(1, l.s)))
      .force('charge', d3.forceManyBody().strength(-240))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide((d) => radius(d) + 4));

    const link = zoomG.append('g').attr('class', 'links').selectAll('line').data(links).join('line').attr('stroke-width', (l) => w(l.s));
    const node = zoomG.append('g').selectAll('g').data(nodes).join('g').attr('class', (d) => 'node' + (d.hop === 0 ? ' seed' : ''))
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    node.append('circle').attr('r', radius).attr('fill', (d) => color(d.p.year));
    node.append('text').attr('dy', (d) => radius(d) + 12).attr('text-anchor', 'middle').text((d) => shortLabel(d.p));

    const adj = new Set(links.map((l) => `${l.source.id}|${l.target.id}`));
    const isNb = (a, b) => a === b || adj.has(`${a}|${b}`) || adj.has(`${b}|${a}`);
    const tipFor = (d) => tipHtml(d.p) + (d.hop ? `<div class="muted">${t('graph.simToSeed', { s: d.sim.toFixed(2) })}</div>` : '');
    node.on('mouseenter', (e, d) => {
      tip(e, tipFor(d));
      node.classed('faded', (o) => !isNb(d.id, o.id));
      link.classed('faded', (l) => l.source.id !== d.id && l.target.id !== d.id);
    }).on('mousemove', (e, d) => tip(e, tipFor(d)))
      .on('mouseleave', () => { hideTip(); node.classed('faded', false); link.classed('faded', false); })
      .on('click', (e, d) => { node.classed('selected', (o) => o.id === d.id); showDetail(d); });

    sim.on('tick', () => {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    const lg = root.querySelector('#g-legend');
    lg.hidden = false;
    const ys = d3.range(years[0], years[1] + 1);
    lg.innerHTML = ys.map((yv) => `<span class="year-key"><span class="sw" style="background:${color(yv)}"></span>${yv}</span>`).join('');
  }

  function showDetail(n) {
    detail.innerHTML = paperCard(n.p, n.hop === 0 ? [] : [{ label: t('graph.useAsSeed'), icon: 'target', href: `#/graph?seed=${encodeURIComponent(seedRef(n.p))}` }])
      + (n.hop === 0 ? `<p class="muted small">${t('graph.isSeed')}</p>` : `<p class="muted small">${t('graph.simToSeed', { s: n.sim.toFixed(3) })}</p>`)
      + `<h4>${t('graph.all')}</h4><ol class="list">${graph.nodes.slice(1).map(item).join('')}</ol>`;
  }

  async function update(p) {
    try {
      const ref = p.get('seed');
      if (!ref) {
        // no seed yet: suggest a few papers from the current sources
        const papers = await scopePapers();
        clearStatus();
        const step = Math.max(1, Math.floor(papers.length / 6));
        const picks = papers.filter((_, i) => i % step === 0).slice(0, 6);
        resultsEl.innerHTML = picks.map((q) => `<li><a href="#/graph?seed=${encodeURIComponent(seedRef(q))}">${esc(q.title)}</a><div class="muted small">${esc(venueYear(q))}</div></li>`).join('');
        return;
      }
      setParams('graph', { seed: ref });
      scopePapers().catch(() => {}).finally(clearStatus);
      const seed = await findSeed(ref);
      if (!seed) throw new Error(ref);
      await build(seed);
    } catch (err) {
      console.error(err);
      if (err.status === 404 || /index\.json/.test(err.message)) root.querySelector('#g-empty').textContent = t('err.noData');
      else status(t('err.load', { msg: err.message }), { error: true });
    }
  }
  update(params);

  return { update, destroy() { destroyed = true; sim?.stop(); hideTip(); } };
}
