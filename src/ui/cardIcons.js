// Line icons for the Gauntlet's cards (game/rogue.js: perks, supplies, curses), 32x32, drawn in currentColor.
// cardIcon(name) -> an <svg> string (the draft's cards and chips, the HUD's run strip).

// a skull (20 wide, 5..25 high) and its eyes / teeth, for the curse icons
const SK = 'M16 5c-6 0-10 4-10 9.5 0 3.2 1.6 5.4 4 6.8V25h12v-3.7c2.4-1.4 4-3.6 4-6.8C26 9 22 5 16 5z';
const SKE = '<circle cx="12.3" cy="15" r="2.2" fill="currentColor" stroke="none"/><circle cx="19.7" cy="15" r="2.2" fill="currentColor" stroke="none"/><path d="M13.5 25v-3M16 25v-3M18.5 25v-3"/>';
const skull = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke-width="${(2 / s).toFixed(2)}"><path d="${SK}"/>${SKE}</g>`;
const dot = (x, y, r = 1.8) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const HEART = 'M16 27S4 19.5 4 11.8A6.3 6.3 0 0 1 16 9a6.3 6.3 0 0 1 12 2.8C28 19.5 16 27 16 27z';
const DROP = 'M16 4s-8.5 10-8.5 15.5a8.5 8.5 0 0 0 17 0C24.5 14 16 4 16 4z';
const MAG = 'M11 4h10l-1 8 3 16H13L10 12z';
const CRATE = '<path d="M5 10.5L16 5l11 5.5v11L16 27 5 21.5z"/>';

const ICONS = {
  // perks
  bullet: '<path d="M13 27V13c0-4.5 3-9 3-9s3 4.5 3 9v14z"/><path d="M11 27h10M13 14h6"/>',
  skullaim: `<circle cx="16" cy="16" r="13.5"/><path d="M16 1v4.5M16 26.5V31M1 16h4.5M26.5 16H31"/>${skull(7.9, 7.4, 0.52)}`,
  reload: '<path d="M25.5 12.5A10 10 0 1 0 26 19"/><path d="M26.5 5v7.5H19"/>',
  bolt: '<path d="M18 3L7 18h8l-2 11 12-16h-8z"/>',
  mag: `<path d="${MAG}"/><path d="M11.5 9h9M13 16h8"/>`,
  aim: '<circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="3.5"/><path d="M16 2v6M16 24v6M2 16h6M24 16h6"/>',
  run: '<path d="M4 8l8 8-8 8M13 8l8 8-8 8"/><path d="M23 10l6 6-6 6" opacity=".45"/>',
  heart: `<path d="${HEART}"/><path d="M16 13.5v8M12 17.5h8"/>`,
  drop: `<path d="${DROP}"/><path d="M12.5 20a3.5 3.5 0 0 0 3 3.5"/>`,
  shield: '<path d="M16 3l10 4v8.5c0 6.5-4.5 10.8-10 13.5-5.5-2.7-10-7-10-13.5V7z"/><path d="M16 8v16" opacity=".55"/>',
  crate: `${CRATE}<path d="M5 10.5L16 16l11-5.5M16 16v11"/>`,
  pierce: '<path d="M3 16h23M20 10l6 6-6 6"/><path d="M10 7v18M15 9v14" opacity=".6"/>',
  blast: '<path d="M16 2l3 9 9-4-6 8 8 3-9 2 3 9-8-6-8 6 3-9-9-2 8-3-6-8 9 4z"/>',
  die: `<rect x="5" y="5" width="22" height="22" rx="4"/>${dot(11, 11)}${dot(21, 11)}${dot(16, 16)}${dot(11, 21)}${dot(21, 21)}`,
  knife: '<path d="M6 26l4-4M10 22l2.5 2.5M8.5 20.5L23 6l4-1-1 4-14.5 14.5"/>',
  pulse: '<path d="M3 17h6l3-7 4 13 3-9 2 3h8"/>',
  // supplies
  grenade: '<circle cx="14" cy="19" r="8.5"/><path d="M11 10.5V7h6v3.5M17 8.5l6-3M10 19h8M14 15v8"/>',
  flame: '<path d="M16 29c-5 0-8.5-3.5-8.5-8.5 0-6.5 6.5-8.5 5.5-16 4.5 2.5 9 7 9 13.5 1.2-1 2-2.8 2.2-4 1.3 2 1.8 4.2 1.8 6.5 0 5-4 8.5-10 8.5z"/>',
  ammo: '<path d="M6 27V15l2.5-6 2.5 6v12zM13.5 27V15l2.5-6 2.5 6v12zM21 27V15l2.5-6 2.5 6v12z"/><path d="M5 21h22" opacity=".55"/>',
  plank: `<path d="M4 8l25 6-1 4L3 12z"/><path d="M4 24l25-6-1-4L3 20z"/>${dot(8, 11, 1.1)}${dot(24, 15, 1.1)}${dot(8, 21, 1.1)}${dot(24, 17, 1.1)}`,
  medkit: '<rect x="4.5" y="9" width="23" height="18" rx="2.5"/><path d="M12 9V5.5h8V9M16 13.5v9M11.5 18h9"/>',
  gear: '<path d="M10 9h12a4 4 0 0 1 4 4v14H6V13a4 4 0 0 1 4-4z"/><path d="M12.5 9V5.5h7V9M6 17.5h20M13 17.5v4h6v-4"/>',
  // curses
  skullrun: `${skull(8.5, 3.5, 0.78)}<path d="M1.5 11h5M1 16.5h6M1.5 22h5"/>`,
  skullshield: `<path d="M16 2l12 4.5v9c0 7-5.5 11.5-12 14.5C9.5 27 4 22.5 4 15.5v-9z"/>${skull(7.2, 7.4, 0.55)}`,
  claw: '<path d="M9 4c-2.5 8-3.5 16-3 24M17 3c-1.8 9-2.5 17-2 26M25 4c-1 8-1.5 16-1.5 24"/>',
  swarm: `${skull(0, 0.5, 0.5)}${skull(16, 0.5, 0.5)}${skull(0, 15.5, 0.5)}${skull(16, 15.5, 0.5)}${skull(8, 8, 0.5)}`,
  emptycrate: `${CRATE}<path d="M10.5 12.5l11 9M21.5 12.5l-11 9"/>`,
  halfmag: `<path d="${MAG}"/><path d="M11.8 17.5h9.2l1.7 9.5H13.3z" fill="currentColor" stroke="none"/>`,
  wound: `<path d="${HEART}"/><path d="M16 9.5l-2.5 5 3.5 3-3 4 2 5"/>`,
  rust: '<path d="M3 10h21v5.5H13.5l-2 7H6l2-7H3z"/><path d="M24 12.5h5"/><path d="M16 19v3M19.5 19v5M23 19v2"/>',
  weight: '<path d="M11.5 11a4.5 4.5 0 0 1 9 0"/><path d="M7 11h18l3 16H4z"/><path d="M12 19h8" opacity=".6"/>',
  paw: '<ellipse cx="16" cy="21" rx="6" ry="5"/><ellipse cx="7.5" cy="13" rx="2.6" ry="3.4"/><ellipse cx="12.5" cy="7.5" rx="2.6" ry="3.4"/><ellipse cx="19.5" cy="7.5" rx="2.6" ry="3.4"/><ellipse cx="24.5" cy="13" rx="2.6" ry="3.4"/>',
  jaws: '<path d="M4 9c6 5 18 5 24 0M4 23c6-5 18-5 24 0"/><path d="M8 10.8l2 4.2 2.5-3.5 2.5 4 2.5-4 2.5 3.5 2-4.2M8 21.2l2-4.2 2.5 3.5 2.5-4 2.5 4 2.5-3.5 2 4.2"/>',
  boomer: '<circle cx="16" cy="19" r="10"/><circle cx="16" cy="6" r="3.5"/><circle cx="11" cy="17" r="2"/><circle cx="20.5" cy="21.5" r="2.6"/><circle cx="18.5" cy="13.5" r="1.4"/>',
  leap: `<path d="M4 26C7 14 16 7 28 6"/><path d="M22 3l6 3-3 6"/>${dot(6, 28.5, 1.6)}`,
  moon: `<path d="M21 4a12 12 0 1 0 7 17.5A10 10 0 0 1 21 4z"/><path d="M11 26.5v2.5M15 27.5v3" opacity=".7"/>`,
  heli: '<path d="M3 7h26M16 7v4"/><path d="M8 11h12.5c4 0 7 2.7 7 6s-3 5.5-7 5.5H12c-3.5 0-6-2.5-6-6"/><path d="M13 22.5v4M21 22.5v4M10 26.5h14M6 16.5H2"/>',
  bulb: '<path d="M11.5 20.5c-2.5-2-4-4.5-4-7.5a8.5 8.5 0 0 1 17 0c0 3-1.5 5.5-4 7.5v3h-9z"/><path d="M12.5 27h7M4 4l24 24"/>',
  fist: '<path d="M9 14V9.5a2 2 0 0 1 4 0V14M13 13V7.5a2 2 0 0 1 4 0V13M17 13V8.5a2 2 0 0 1 4 0V14M21 14v-2.5a2 2 0 0 1 4 0V19c0 5-3.5 9-8.5 9h-1C10.5 28 7 24 7 19v-3a2 2 0 0 1 2-2z"/>',
  eye: `<path d="M2 16s5-8.5 14-8.5S30 16 30 16s-5 8.5-14 8.5S2 16 2 16z"/><circle cx="16" cy="16" r="4.5"/>${dot(16, 16, 1.6)}`,
  skullfire: `${skull(5, 8.5, 0.69)}<path d="M10 9.5c-.3-2.8 1.5-4 1.8-6.8 2 1.7 3 3.4 3 5.3.9-.9 1.4-2 1.4-3.5 2 1.8 3 3.5 3 5.4.9-.7 1.4-1.8 1.4-2.8 1.4 1.4 1.5 2.9 1.4 4.3"/>`,
  nodrop: `<path d="${DROP}"/><path d="M4 4l24 24"/>`,
};

/** the icon `name` as an <svg> string (a blank frame for an unknown one) */
export function cardIcon(name, cls = 'cf-ci') {
  return `<svg class="${cls}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? '<rect x="6" y="6" width="20" height="20" rx="3"/>'}</svg>`;
}
