// Minimal i18n: every UI string lives here as [Chinese, English].
// Static markup uses data-i18n / data-i18n-ph / data-i18n-title / data-i18n-html attributes;
// views call t() when they render, and re-render when the language changes.

const S = {
  // top bar
  'nav.map': ['论文地图', 'Paper map'],
  'nav.graph': ['相关论文图', 'Related papers'],
  'nav.flows': ['知识流', 'Knowledge flows'],
  'lang.toggle': ['EN', '中文'],
  'lang.title': ['Switch to English', '切换到中文'],
  'data.info': ['数据更新于 {date} · {n} 篇论文', 'Data updated {date} · {n} papers'],

  // shared
  'yearFrom': ['起始年', 'From'],
  'yearTo': ['结束年', 'To'],
  'search': ['搜索', 'Search'],
  'searching': ['搜索中…', 'Searching…'],
  'noResults': ['没有结果', 'No results'],
  'none': ['无', 'None'],
  'other': ['其他', 'Other'],
  'noAbstract': ['（无摘要）', '(no abstract)'],
  'loadingAbstract': ['正在加载摘要…', 'Loading abstract…'],
  'source': ['原文 ↗', 'Paper ↗'],
  'pdf': ['PDF ↗', 'PDF ↗'],
  'sep': ['，', ', '],
  'err.noData': ['还没有数据。先运行抓取脚本和 scripts/build_atlas.py 生成数据（见 README）。', 'No data yet. Run the fetchers and scripts/build_atlas.py first (see the README).'],
  'err.load': ['数据加载失败：{msg}', 'Could not load data: {msg}'],
  'status.loading': ['正在加载数据（{done}/{total}）…', 'Loading data ({done}/{total})…'],
  'status.loadingAbs': ['正在加载摘要（{done}/{total}）…', 'Loading abstracts ({done}/{total})…'],

  // map
  'map.title': ['论文地图', 'Paper map'],
  'map.desc': ['所有论文按摘要语义排在同一张地图上：越近越相似。', 'All papers share one map laid out by what their abstracts say: the closer, the more similar.'],
  'map.sources': ['来源', 'Sources'],
  'map.allConf': ['顶会全选', 'All conferences'],
  'map.allJournal': ['期刊全选', 'All journals'],
  'map.clear': ['清空', 'Clear'],
  'map.conf': ['顶会', 'Conferences'],
  'map.journal': ['期刊', 'Journals'],
  'map.arxiv': ['包含 arXiv 预印本', 'Include arXiv preprints'],
  'map.noArxiv': ['（还没有 arXiv 数据）', '(no arXiv data yet)'],
  'map.arxivRange': ['arXiv 范围', 'arXiv range'],
  'map.ax1': ['最近 1 个月', 'Latest month'],
  'map.axN': ['最近 {n} 个月', 'Latest {n} months'],
  'map.axAll': ['所选年份全部', 'All months in the chosen years'],
  'map.heavy': ['论文较多，加载和绘制会慢一些', 'That is a lot of papers; loading and drawing will be slower'],
  'map.unavailable': ['还没有抓取这个来源的数据', 'Not fetched yet'],
  'map.years': ['已有年份：{years}', 'Years available: {years}'],
  'venue.oddYears': ['奇数年举办', 'Held in odd years'],
  'venue.evenYears': ['偶数年举办', 'Held in even years'],
  'venue.naaclNote': ['NAACL 不是每年举办', 'NAACL is not held every year'],
  'map.selCount': ['已选 {n} 个数据集，共 {p} 篇', '{n} datasets, {p} papers'],
  'map.selNone': ['还没选任何来源', 'No source selected'],
  'map.run': ['显示', 'Show'],
  'map.filter': ['筛选（标题 / 作者 / 摘要）', 'Filter (title / author / abstract)'],
  'map.filterPh': ['输入后高亮匹配论文', 'Highlights matching papers'],
  'map.color': ['着色', 'Colour by'],
  'color.cluster': ['语义簇', 'Topic cluster'],
  'color.source': ['来源', 'Source'],
  'color.year': ['年份', 'Year'],
  'map.empty': ['选好来源和年份后点击“显示”。', 'Pick sources and years, then click “Show”.'],
  'map.hint': ['滚轮缩放 · 拖动平移 · 点击论文查看详情', 'Scroll to zoom · drag to pan · click a paper for details'],
  'map.detailEmpty': ['点击地图上的论文查看详情。', 'Click a paper on the map to see its details.'],
  'map.legendHint': ['点击图例可隐藏 / 显示该组', 'Click a legend item to hide or show it'],
  'map.count': ['共 {n} 篇', '{n} papers'],
  'map.match': ['匹配 {m} / {n} 篇', '{m} of {n} papers match'],
  'map.nearest': ['语义最相近的论文', 'Most similar papers'],
  'map.toGraph': ['相关论文图 →', 'Related papers →'],

  // graph
  'graph.title': ['相关论文图', 'Related papers'],
  'graph.desc': ['选一篇论文，生成和它语义最相近的论文网络。接入引用数据后会再加上“共同引用”。', 'Pick a paper to get a network of the most similar papers. Once citation data is added, shared citations will count too.'],
  'graph.seed': ['搜索种子论文', 'Find a seed paper'],
  'graph.seedPh': ['标题或作者', 'Title or author'],
  'graph.scope': ['在地图当前选中的来源里搜索（{n} 篇）', 'Searches the sources selected on the map ({n} papers)'],
  'graph.earlier': ['更早的相似论文', 'Earlier similar papers'],
  'graph.later': ['同期或更新的相似论文', 'Same-year or newer similar papers'],
  'graph.empty': ['先搜索并选择一篇种子论文。', 'Search for and pick a seed paper first.'],
  'graph.hint': ['节点越大越接近种子 · 颜色 = 年份 · 连线越粗越相似', 'Bigger node = closer to the seed · colour = year · thicker link = more similar'],
  'graph.detailEmpty': ['点击节点查看详情。', 'Click a node to see its details.'],
  'graph.simToSeed': ['与种子相似度 {s}', 'Similarity to seed: {s}'],
  'graph.useAsSeed': ['以此为种子 →', 'Use as seed →'],
  'graph.isSeed': ['这是种子论文。', 'This is the seed paper.'],
  'graph.all': ['图中全部论文（按相似度）', 'All papers in the graph (by similarity)'],

  // flows
  'flows.title': ['知识流', 'Knowledge flows'],
  'flows.desc': ['找出标题或摘要关键词提到这个主题的论文，按时间和语义簇排开。每篇论文连向和它最相似的更早论文，用来近似知识的延续；接入引用数据后会换成真实引用。', 'Finds papers whose title or abstract keywords mention the topic and lays them out by time and topic cluster. Each paper links to its most similar earlier papers as a stand-in for how ideas carry over; real citations will replace this once citation data is added.'],
  'flows.topic': ['主题关键词', 'Topic keywords'],
  'flows.scope': ['来源沿用地图上的选择：{venues}。所选年份共 {n} 篇。', 'Uses the sources picked on the map: {venues}. {n} papers in the chosen years.'],
  'flows.max': ['最多显示', 'Show up to'],
  'flows.nPapers': ['{n} 篇', '{n} papers'],
  'flows.run': ['生成知识流', 'Build flows'],
  'flows.matrix': ['主题簇之间的延续', 'Carry-over between topic clusters'],
  'flows.matrixDesc': ['A → B：B 簇的论文延续自 A 簇论文的次数。', 'A → B: how often papers in B build on papers in A.'],
  'flows.roots': ['源头论文', 'Key sources'],
  'flows.rootsSub': ['被后续论文延续最多', 'most built upon by later papers'],
  'flows.empty': ['输入主题后点击“生成知识流”。', 'Enter a topic and click “Build flows”.'],
  'flows.hint': ['悬停查看论文 · 点击论文高亮它的上下游 · 点空白处取消', 'Hover for details · click a paper to highlight what it builds on and what builds on it · click empty space to clear'],
  'flows.detailEmpty': ['点击论文查看它的上游与下游。', 'Click a paper to see what it builds on and what builds on it.'],
  'flows.perYear': ['每年论文数', 'Papers per year'],
  'flows.noEdges': ['这组论文之间没有足够相似的更早论文。', 'None of these papers has a similar enough earlier paper in the set.'],
  'flows.inTopic': ['延续自 {a} 篇 · 被 {b} 篇延续', 'Builds on {a} · built on by {b}'],
  'flows.lineage': ['上游 <b>{a}</b> 篇 · 下游 <b>{b}</b> 篇', '<b>{a}</b> upstream · <b>{b}</b> downstream'],
  'flows.spread': ['影响扩散到：{list}', 'Carried into: {list}'],
  'flows.directUp': ['直接延续自', 'Builds directly on'],
  'flows.directDown': ['被直接延续', 'Built on directly by'],
  'flows.rootCited': ['被延续 {n} 次', 'built on {n}×'],
  'flows.matches': ['找到 {n} 篇相关论文', 'Found {n} matching papers'],
  'flows.showing': ['，显示最相关的 {m} 篇', '; showing the {m} most relevant'],
  'err.flowsFew': ['匹配的论文太少，换个关键词或在地图里多选一些来源。', 'Too few matching papers; try other keywords or select more sources on the map.'],
};

function initial() {
  try {
    const saved = localStorage.getItem('pa.lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang = initial();

export const getLang = () => lang;

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('pa.lang', lang); } catch { /* storage blocked */ }
  applyStatic();
}

export function t(key, vars = {}) {
  const entry = S[key];
  const s = entry ? entry[lang === 'en' ? 1 : 0] : key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

/** Translate static markup under `root`. */
export function applyStatic(root = document) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
}
