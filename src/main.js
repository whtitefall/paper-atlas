import { settings, clearCache } from './api.js';
import { route } from './ui.js';
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

// demo toggle
const demo = document.getElementById('demo-mode');
demo.checked = settings.demo;
demo.addEventListener('change', () => { settings.demo = demo.checked; render(true); });

// settings dialog
const dlg = document.getElementById('settings');
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('api-key').value = settings.apiKey;
  document.getElementById('clear-cache').checked = false;
  dlg.showModal();
});
dlg.addEventListener('close', async () => {
  if (dlg.returnValue !== 'save') return;
  settings.apiKey = document.getElementById('api-key').value.trim();
  if (document.getElementById('clear-cache').checked) await clearCache();
});

render(true);
