import { route } from './ui.js';
import { applyStatic, getLang, setLang, t } from './i18n.js';
import { loadIndex } from './data.js';
import { applyIcons } from './icons.js';
import * as mapView from './views/map.js';
import * as graphView from './views/graph.js';
import * as flowsView from './views/flows.js';

const views = { map: mapView, graph: graphView, flows: flowsView };
const app = document.getElementById('app');
let current = null;
let currentName = null;

function render(force = false) {
  const { view, params } = route();
  const name = views[view] ? view : 'map';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  if (!force && name === currentName && current?.update) { current.update(params); return; }
  current?.destroy?.();
  app.innerHTML = '';
  currentName = name;
  current = views[name].mount(app, params);
}

window.addEventListener('hashchange', () => render());
applyIcons();

// "Data updated <date> · <n> papers", from the atlas index
const info = document.getElementById('data-info');
async function showInfo() {
  try {
    const index = await loadIndex();
    const date = (index.generated_at || '').slice(0, 10);
    info.textContent = t('data.info', { date, n: index.n.toLocaleString() });
  } catch {
    info.textContent = '';
  }
}

// language
applyStatic();
showInfo();
document.getElementById('lang-btn').addEventListener('click', () => {
  setLang(getLang() === 'zh' ? 'en' : 'zh');
  showInfo();
  render(true);
});

render(true);
