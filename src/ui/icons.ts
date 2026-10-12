// Interface icons as inline SVG: crisp at any size, no extra downloads.

const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const S = 'stroke="#1a1420" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';

export const ICONS = {
  heat: svg(`<path d="M10 3a2 2 0 0 1 4 0v10.3a4.5 4.5 0 1 1-4 0z" fill="#fff7ea" ${S}/><circle cx="12" cy="17" r="2.6" fill="#ff5a4a"/><rect x="11" y="8" width="2" height="8" rx="1" fill="#ff5a4a"/>`),
  crate: svg(`<rect x="3" y="6" width="18" height="14" rx="2" fill="#c0844a" ${S}/><path d="M3 11h18M9 6v14M15 6v14" ${S} fill="none"/>`),
  pause: svg(`<rect x="6" y="5" width="4" height="14" rx="1" fill="#fff7ea"/><rect x="14" y="5" width="4" height="14" rx="1" fill="#fff7ea"/>`),
  down: svg(`<path d="M12 21 4 12h5V3h6v9h5z" fill="#fff7ea" ${S}/>`),
  up: svg(`<path d="M12 3l8 9h-5v9H9v-9H4z" fill="#fff7ea" ${S}/>`),
  left: svg(`<path d="M3 12l9-8v5h9v6h-9v5z" fill="#fff7ea" ${S}/>`),
  right: svg(`<path d="M21 12l-9 8v-5H3V9h9V4z" fill="#fff7ea" ${S}/>`),
  arrowDown: svg(`<path d="M12 22 3 11h6V2h6v9h6z" fill="#ffc531" ${S}/>`),
  drill: svg(`<path d="M3 9h5v6H3z" fill="#8a8f9a" ${S}/><path d="M8 7l13 5-13 5z" fill="#c9d0da" ${S}/><path d="M11 9l2 6M14 10l1.5 4.5" stroke="#5a5f6a" stroke-width="1.5"/>`),
  cooling: svg(`<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" stroke="#7fe9ff" stroke-width="3" stroke-linecap="round"/><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" stroke="#1a1420" stroke-width="1" stroke-linecap="round" opacity=".5"/>`),
  hull: svg(`<path d="M12 2l8 3v7c0 5-4 8-8 10-4-2-8-5-8-10V5z" fill="#ff8a2a" ${S}/><path d="M12 6v12" stroke="#fff7ea" stroke-width="2"/>`),
  engine: svg(`<path d="M12 2c3 4 6 7 6 12a6 6 0 0 1-12 0c0-3 1.5-5 3-7 0 3 1.5 4 3 4 0-3-1-6 0-9z" fill="#ffc531" ${S}/>`),
  cargo: svg(`<rect x="3" y="6" width="18" height="14" rx="2" fill="#c0844a" ${S}/><path d="M3 11h18M9 6v14M15 6v14" ${S} fill="none"/>`),
  scanner: svg(`<circle cx="12" cy="12" r="9" fill="#2b6f8a" ${S}/><path d="M12 12L18 6" stroke="#7dff8a" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="5" fill="none" stroke="#7dff8a" stroke-width="1.2"/><circle cx="16" cy="9" r="1.4" fill="#7dff8a"/>`),
  recall: svg(`<path d="M12 2v11" ${S}/><path d="M7 13a5 5 0 0 0 10 0" fill="none" stroke="#ffc531" stroke-width="3"/><path d="M7 13a5 5 0 0 0 10 0" fill="none" ${S} opacity=".6"/><circle cx="12" cy="3" r="2" fill="#8a8f9a" ${S}/>`),
  gear: svg(`<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" fill="none" stroke="#fff7ea" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" stroke="#fff7ea" stroke-width="2.4" stroke-linecap="round"/>`),
};
