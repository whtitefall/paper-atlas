// Flat line icons in the style of the logo: a 16 px grid, round strokes in the current text colour,
// and filled dots for papers. icon(name) returns inline SVG markup.
const DOT = 'fill="currentColor" stroke="none"';

const PATHS = {
  // papers placed on a map
  map: `<circle cx="4" cy="10.5" r="1.9" ${DOT}/><circle cx="8.5" cy="5" r="1.9" ${DOT}/><circle cx="12" cy="10.5" r="1.9" ${DOT}/>`
    + `<circle cx="8" cy="13.4" r="1.2" ${DOT}/><circle cx="13" cy="4.2" r="1.2" ${DOT}/><circle cx="3.6" cy="4.6" r="1.2" ${DOT}/>`,
  // papers linked by similarity, like the logo
  graph: `<path d="M8 3.5 3.5 12h9Z"/><circle cx="8" cy="3.5" r="2" ${DOT}/><circle cx="3.5" cy="12" r="2" ${DOT}/><circle cx="12.5" cy="12" r="2" ${DOT}/>`,
  // papers building on earlier ones over time
  flows: '<path d="M2.5 13.5h11M3.5 10 7 6l3 2.5 3-4"/>'
    + `<circle cx="3.5" cy="10" r="1.6" ${DOT}/><circle cx="7" cy="6" r="1.6" ${DOT}/><circle cx="10" cy="8.5" r="1.6" ${DOT}/><circle cx="13" cy="4.5" r="1.6" ${DOT}/>`,
  // re-centre the graph on this paper
  target: `<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.1" ${DOT}/>`,
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.1 3.1"/>',
  external: '<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>',
  doc: '<path d="M9.5 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V5ZM9.5 1.75V5h3.25M5.75 8.5h4.5M5.75 11h3"/>',
  globe: '<circle cx="8" cy="8" r="5.75"/><path d="M2.25 8h11.5M8 2.25C9.8 3.9 10.6 5.8 10.6 8S9.8 12.1 8 13.75C6.2 12.1 5.4 10.2 5.4 8S6.2 3.9 8 2.25Z"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Put icon(el.dataset.icon) in front of every [data-icon] element under root. */
export function applyIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.querySelector(':scope > svg.icon')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}
