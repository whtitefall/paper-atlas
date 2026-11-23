// Shared UI helpers.
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

export function authorsLine(w, n = 3) {
  if (!w.authors?.length) return '';
  return w.authors.slice(0, n).join(', ') + (w.authors.length > n ? ' 等' : '');
}

export function tipHtml(w) {
  return `<b>${esc(w.title)}</b><div class="muted">${esc(authorsLine(w))} · ${w.year ?? ''} · 被引 ${w.citations.toLocaleString()}</div>`;
}

/** Detail card for the side panel. `actions` = [{label, href}] */
export function paperCard(w, actions = []) {
  const abs = w.abstract ? esc(w.abstract.length > 900 ? w.abstract.slice(0, 900) + '…' : w.abstract) : '<span class="muted">（无摘要）</span>';
  return `<article class="paper-card">
    <h3>${esc(w.title)}</h3>
    <div class="meta">${esc(authorsLine(w, 6))}</div>
    <div class="meta">${w.year ?? ''}${w.venue ? ' · ' + esc(w.venue) : ''} · 被引 ${w.citations.toLocaleString()}</div>
    <div class="chips"><span class="chip">${esc(w.subfield)}</span><span class="chip">${esc(w.topic)}</span></div>
    <p class="abstract">${abs}</p>
    <div class="row">${actions.map((a) => `<a class="btn small" href="${esc(a.href)}" ${a.external ? 'target="_blank" rel="noopener"' : ''}>${esc(a.label)}</a>`).join('')}
    ${w.url && w.url !== '#' ? `<a class="btn small ghost" href="${esc(w.url.startsWith('http') ? w.url : 'https://openalex.org/' + w.id)}" target="_blank" rel="noopener">原文 ↗</a>` : ''}</div>
  </article>`;
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
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
