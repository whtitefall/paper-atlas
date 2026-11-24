// Shared UI helpers.
import { t } from './i18n.js';
import { icon } from './icons.js';
import { abstractOf } from './data.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const statusEl = () => document.getElementById('status');
let statusTimer = null;
export function status(msg, { error = false, sticky = true } = {}) {
  const el = statusEl();
  clearTimeout(statusTimer);
  el.textContent = msg;
  el.className = 'status' + (error ? ' error' : '');
  if (!sticky || error) statusTimer = setTimeout(() => el.classList.add('hidden'), error ? 8000 : 2500);
}
export function clearStatus() { statusEl().classList.add('hidden'); }

const tipEl = () => document.getElementById('tooltip');
export function tip(event, html) {
  const el = tipEl();
  el.innerHTML = html;
  el.classList.remove('hidden');
  const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + w > innerWidth - 8) x = event.clientX - w - pad;
  if (y + h > innerHeight - 8) y = event.clientY - h - pad;
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';
}
export function hideTip() { tipEl().classList.add('hidden'); }

export function authorsLine(p, n = 3) {
  const list = (p.authors || '').split(', ').filter(Boolean);
  if (!list.length) return '';
  return list.slice(0, n).join(', ') + (list.length > n ? ' …' : '');
}

export const venueYear = (p) => `${p.venue} ${p.year}`;

export function tipHtml(p) {
  return `<b>${esc(p.title)}</b><div class="muted">${esc(authorsLine(p))}${p.authors ? ' · ' : ''}${esc(venueYear(p))}</div>`;
}

/** Detail card for the side panel; the abstract is filled in once loaded. `actions` = [{label, href, icon}] */
export function paperCard(p, actions = []) {
  const id = `abs-${p.gi}`;
  abstractOf(p).then((abs) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = abs ? esc(abs) : `<span class="muted">${t('noAbstract')}</span>`;
  }).catch(() => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span class="muted">${t('noAbstract')}</span>`;
  });
  const links = [
    ...actions.map((a) => `<a class="btn small" href="${esc(a.href)}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</a>`),
    p.url ? `<a class="btn small ghost" href="${esc(p.url)}" target="_blank" rel="noopener">${icon('external')}${t('source')}</a>` : '',
    p.pdf ? `<a class="btn small ghost" href="${esc(p.pdf)}" target="_blank" rel="noopener">${icon('doc')}${t('pdf')}</a>` : '',
  ].join('');
  return `<article class="paper-card">
    <h3>${esc(p.title)}</h3>
    <div class="meta">${esc(authorsLine(p, 8))}</div>
    <div class="chips"><span class="chip strong">${esc(venueYear(p))}</span></div>
    <p class="abstract" id="${id}"><span class="muted">${t('loadingAbstract')}</span></p>
    <div class="row">${links}</div>
  </article>`;
}

export function debounce(fn, ms = 200) {
  let timer; return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
}

/** Parse "#/view?x=1" */
export function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, qs] = h.split('?');
  return { view: view || 'map', params: new URLSearchParams(qs || '') };
}
export function setParams(view, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
  const next = `#/${view}${qs ? '?' + qs : ''}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** A short "Surname Year" label for graph nodes. */
export function shortLabel(p) {
  const first = (p.authors || '').split(', ')[0] || '';
  return `${first.split(' ').slice(-1)[0]} ${p.year}`.trim();
}
