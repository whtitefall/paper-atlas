// View 2: similarity graph around a seed paper.
// Similarity = bibliographic coupling (shared references) + co-citation (cited together) + a bonus for direct citation.
import * as d3 from 'd3';
import { searchWorks, getWork, getWorksByIds, getCiters, settings } from '../api.js';
import { esc, status, clearStatus, tip, hideTip, tipHtml, paperCard, authorsLine, setParams } from '../ui.js';

const GRAPH_SIZE = 40;

export function mount(root, params) {
  root.innerHTML = `
  <div class="layout">
    <aside class="panel left">
      <form class="stack" id="g-form">
        <h2>相关论文图</h2>
        <p class="muted small">输入一篇论文，生成与它相似的论文网络。相似度来自“共同引用”和“被共同引用”，而不是直接的引用关系。</p>
        <label>搜索种子论文 <input name="q" placeholder="标题、关键词或 DOI" /></label>
        <button type="submit">搜索</button>
      </form>
      <ol class="list results" id="g-results"></ol>
      <div id="g-lists" hidden>
        <hr />
        <h4>前序工作 <span class="muted small">图中论文最常引用的经典</span></h4>
        <ol class="list" id="g-prior"></ol>
        <h4>衍生工作 <span class="muted small">引用了图中最多论文的新工作</span></h4>
        <ol class="list" id="g-deriv"></ol>
      </div>
    </aside>
    <section class="canvas-wrap" id="g-wrap">
      <svg id="g-svg"></svg>
      <div class="empty" id="g-empty">先搜索并选择一篇种子论文。</div>
      <div class="graph-legend" id="g-legend" hidden></div>
      <div class="hint">节点大小 = 被引次数 · 颜色 = 年份 · 连线越粗越相似</div>
    </section>
    <aside class="panel right" id="g-detail"><p class="muted">点击节点查看详情。</p></aside>
  </div>`;

  const form = root.querySelector('#g-form');
  const resultsEl = root.querySelector('#g-results');
  const svg = d3.select(root.querySelector('#g-svg'));
  const wrap = root.querySelector('#g-wrap');
  const detail = root.querySelector('#g-detail');
  let sim = null, destroyed = false, runId = 0, graph = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = new FormData(form).get('q').trim();
    if (!q) return;
    try {
      status('搜索中…');
      const res = await searchWorks(q, { limit: 8 });
      clearStatus();
      resultsEl.innerHTML = res.length ? res.map((w) => `<li><a href="#/graph?seed=${w.id}">${esc(w.title)}</a><div class="muted small">${esc(authorsLine(w, 2))} · ${w.year} · 被引 ${w.citations}</div></li>`).join('') : '<li class="muted">没有结果</li>';
    } catch (err) { status(err.message, { error: true }); }
  });

  async function build(seedId) {
    const my = ++runId;
    resultsEl.innerHTML = '';
    try {
      status('读取种子论文…');
      const seed = await getWork(seedId);
      status('读取参考文献、施引文献和相关论文…');
      const [refs, citers, related] = await Promise.all([
        getWorksByIds(seed.refs.slice(0, 150), { light: true }),
        getCiters(seed.id, 100),
        getWorksByIds(seed.related.slice(0, 25), { light: true }),
      ]);
      if (destroyed || my !== runId) return;
      const pool = new Map();
      for (const w of [seed, ...refs, ...citers, ...related]) if (!pool.has(w.id)) pool.set(w.id, w);
      graph = computeGraph(seed, pool, citers);
      status('读取前序 / 衍生工作…');
      const priorWorks = await getWorksByIds(graph.priorIds.map((p) => p.id), { light: true });
      if (destroyed || my !== runId) return;
      renderLists(graph, priorWorks, pool);
      render(graph);
      showDetail(graph.nodes[0]);
      clearStatus();
    } catch (err) {
      console.error(err);
      status(err.message || String(err), { error: true });
    }
  }

  function computeGraph(seed, pool, seedCiters) {
    const ids = [...pool.keys()];
    const refSet = new Map(ids.map((id) => [id, new Set(pool.get(id).refs)]));
    // citers inside the pool, for co-citation
    const citedBy = new Map(ids.map((id) => [id, new Set()]));
    for (const id of ids) for (const r of refSet.get(id)) if (citedBy.has(r)) citedBy.get(r).add(id);
    const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a]; for (const x of s) if (l.has(x)) n++; return n / Math.sqrt(a.size * b.size); };
    const similarity = (i, j) => {
      const direct = refSet.get(i).has(j) || refSet.get(j).has(i) ? 0.15 : 0;
      return overlap(refSet.get(i), refSet.get(j)) + overlap(citedBy.get(i), citedBy.get(j)) + direct;
    };
    const ranked = ids.filter((id) => id !== seed.id).map((id) => ({ id, s: similarity(seed.id, id) }))
      .filter((d) => d.s > 0).sort((a, b) => b.s - a.s).slice(0, GRAPH_SIZE);
    const nodeIds = [seed.id, ...ranked.map((d) => d.id)];
    const nodes = nodeIds.map((id, i) => ({ ...pool.get(id), isSeed: i === 0, simToSeed: i === 0 ? 1 : ranked[i - 1].s }));
    // edges: each node keeps its strongest few neighbours
    const pairs = [];
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const s = similarity(nodes[a].id, nodes[b].id);
      if (s > 0.02) pairs.push({ a, b, s });
    }
    const keep = new Set();
    const byNode = d3.group(pairs.flatMap((p) => [[p.a, p], [p.b, p]]), (d) => d[0]);
    for (const [, list] of byNode) list.map((d) => d[1]).sort((x, y) => y.s - x.s).slice(0, 4).forEach((p) => keep.add(p));
    const links = [...keep].map((p) => ({ source: nodes[p.a].id, target: nodes[p.b].id, s: p.s }));
    // prior works: most-referenced by graph nodes
    const inGraph = new Set(nodeIds);
    const refCount = new Map();
    for (const n of nodes) for (const r of n.refs) if (!inGraph.has(r)) refCount.set(r, (refCount.get(r) || 0) + 1);
    const priorIds = [...refCount].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, c]) => ({ id, c }));
    // derivative works: papers in the pool (outside the graph) citing many graph nodes
    const deriv = [...pool.values()].filter((w) => !inGraph.has(w.id))
      .map((w) => ({ w, c: w.refs.filter((r) => inGraph.has(r)).length })).filter((d) => d.c >= 2)
      .sort((a, b) => b.c - a.c || b.w.year - a.w.year).slice(0, 12);
    return { seed, nodes, links, priorIds, deriv, seedCiters };
  }

  function listItem(w, extra) {
    return `<li><a href="#/graph?seed=${w.id}">${esc(w.title)}</a><div class="muted small">${esc(authorsLine(w, 2))} · ${w.year} · ${extra}</div></li>`;
  }
  function renderLists(g, priorWorks, pool) {
    const pc = new Map(g.priorIds.map((p) => [p.id, p.c]));
    priorWorks.sort((a, b) => pc.get(b.id) - pc.get(a.id));
    root.querySelector('#g-prior').innerHTML = priorWorks.map((w) => listItem(w, `被图中 ${pc.get(w.id)} 篇引用`)).join('') || '<li class="muted">无</li>';
    root.querySelector('#g-deriv').innerHTML = g.deriv.map((d) => listItem(d.w, `引用图中 ${d.c} 篇`)).join('') || '<li class="muted">无</li>';
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

    const years = d3.extent(g.nodes, (n) => n.year);
    const color = d3.scaleSequential((t) => d3.interpolateYlGnBu(0.25 + 0.75 * t)).domain(years[0] === years[1] ? [years[0] - 1, years[1]] : years);
    const r = d3.scaleSqrt().domain([0, d3.max(g.nodes, (n) => n.citations) || 1]).range([5, 26]);
    const w = d3.scaleLinear().domain(d3.extent(g.links, (l) => l.s)).range([0.6, 4]);

    const links = g.links.map((l) => ({ ...l }));
    const nodes = g.nodes.map((n) => ({ ...n }));
    sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((l) => 140 - 90 * Math.min(1, l.s)).strength((l) => 0.2 + Math.min(0.8, l.s)))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide((d) => r(d.citations) + 4));

    const link = zoomG.append('g').attr('class', 'links').selectAll('line').data(links).join('line').attr('stroke-width', (l) => w(l.s));
    const node = zoomG.append('g').selectAll('g').data(nodes).join('g').attr('class', (d) => 'node' + (d.isSeed ? ' seed' : ''))
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    node.append('circle').attr('r', (d) => r(d.citations)).attr('fill', (d) => color(d.year));
    node.append('text').attr('dy', (d) => r(d.citations) + 12).attr('text-anchor', 'middle')
      .text((d) => `${(d.authors[0] || '').split(' ').slice(-1)[0]} ${d.year}`);

    const adj = new Set(links.map((l) => `${l.source.id}|${l.target.id}`));
    const isNb = (a, b) => a === b || adj.has(`${a}|${b}`) || adj.has(`${b}|${a}`);
    node.on('mouseenter', (e, d) => {
      tip(e, tipHtml(d) + `<div class="muted">与种子相似度 ${d.simToSeed.toFixed(2)}</div>`);
      node.classed('faded', (o) => !isNb(d.id, o.id));
      link.classed('faded', (l) => l.source.id !== d.id && l.target.id !== d.id);
    }).on('mousemove', (e, d) => tip(e, tipHtml(d) + `<div class="muted">与种子相似度 ${d.simToSeed.toFixed(2)}</div>`))
      .on('mouseleave', () => { hideTip(); node.classed('faded', false); link.classed('faded', false); })
      .on('click', (e, d) => { node.classed('selected', (o) => o.id === d.id); showDetail(d); });

    sim.on('tick', () => {
      link.attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y).attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    const lg = root.querySelector('#g-legend');
    lg.hidden = false;
    lg.innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${d3.range(0, 1.01, 0.1).map((t) => color(years[0] + t * (years[1] - years[0]))).join(',')})"></div><div class="row between small muted"><span>${years[0]}</span><span>${years[1]}</span></div>`;
  }

  function showDetail(n) {
    detail.innerHTML = paperCard(n, n.isSeed ? [] : [{ label: '以此为种子 →', href: `#/graph?seed=${n.id}` }])
      + (n.isSeed ? '<p class="muted small">这是种子论文。</p>' : `<p class="muted small">与种子相似度：${n.simToSeed.toFixed(3)}</p>`)
      + `<h4>图中全部论文（按相似度）</h4><ol class="list">${graph.nodes.slice(1).map((m) => `<li><a href="#/graph?seed=${m.id}">${esc(m.title)}</a> <span class="muted small">${m.year} · ${m.simToSeed.toFixed(2)}</span></li>`).join('')}</ol>`;
  }

  async function update(p) {
    let seed = p.get('seed');
    if (!seed) seed = settings.demo ? (await searchWorks('', { limit: 1 }))[0].id : 'W2626778328'; // demo: most-cited; live: "Attention Is All You Need"
    setParams('graph', { seed });
    build(seed);
  }
  update(params);

  return { update, destroy() { destroyed = true; sim?.stop(); hideTip(); } };
}
