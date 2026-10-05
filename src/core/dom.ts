// Minimal, safe DOM builder. Text is always inserted as text nodes, never parsed as HTML,
// so content from documents, feeds or AI output cannot inject markup or script.

export type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> | null | undefined;

const SVG_NS = 'http://www.w3.org/2000/svg';

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

function applyProps(el: Element, props: Props): void {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') el.setAttribute('class', String(v));
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v as Record<string, string>)) {
        if (prop.startsWith('--')) (el as HTMLElement).style.setProperty(prop, val);
        else ((el as HTMLElement).style as unknown as Record<string, string>)[prop] = val;
      }
    }
    else if (k === 'dataset' && typeof v === 'object') Object.assign((el as HTMLElement).dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = Boolean(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

export function h(tag: string, props?: Props, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function s(tag: string, props?: Props, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export function mount(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

export function $(sel: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector(sel);
}

/** Debounce for inputs and resize handlers. */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// Icon set: 24px stroke icons, drawn inline so they work offline with no font or sprite download.
const ICONS: Record<string, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h14V9.5', 'M10 20v-6h4v6'],
  folder: ['M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z'],
  calendar: ['M4 6.5h16V20H4z', 'M4 10.5h16', 'M8.5 3.5v5', 'M15.5 3.5v5'],
  pulse: ['M3 12h4l2.5-6 4 12L16 12h5'],
  plug: ['M9 3v5', 'M15 3v5', 'M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z', 'M12 17v4'],
  coins: ['M12 6c4.4 0 8-1.1 8-2.5S16.4 1 12 1', 'M4 9.5C4 8.1 7.6 7 12 7s8 1.1 8 2.5-3.6 2.5-8 2.5-8-1.1-8-2.5z', 'M4 9.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5', 'M4 14.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5'],
  book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z', 'M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z'],
  gear: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  plus: ['M12 5v14', 'M5 12h14'],
  download: ['M12 4v11', 'M7 10.5 12 15.5l5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 13.5 12 8.5l5 5', 'M5 4h14'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  alert: ['M12 3.5 22 20H2z', 'M12 10v4.5', 'M12 17.5v.5'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5v.5'],
  lock: ['M6 11h12v10H6z', 'M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11'],
  unlock: ['M6 11h12v10H6z', 'M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  search: ['M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', 'M16 16l5 5'],
  shield: ['M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z', 'M9 12l2 2 4-4'],
  share: ['M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M8.6 13.5l6.8 4', 'M15.4 6.5l-6.8 4'],
  refresh: ['M20 11a8 8 0 0 0-14.3-4.9L4 8', 'M4 3.5V8h4.5', 'M4 13a8 8 0 0 0 14.3 4.9L20 16', 'M20 20.5V16h-4.5'],
  wifiOff: ['M2 2l20 20', 'M8.5 16.4a5 5 0 0 1 7 0', 'M5 12.9a10 10 0 0 1 5.2-2.7', 'M19 12.9a10 10 0 0 0-2.4-1.8', 'M12 20h.01'],
  phone: ['M7 2h10v20H7z', 'M11 18h2'],
  message: ['M4 5h16v11H8l-4 4z'],
  mail: ['M3 5h18v14H3z', 'M3 6l9 7 9-7'],
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
  scale: ['M12 3v18', 'M5 21h14', 'M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0z', 'M19 7l-3 7a3 3 0 0 0 6 0z'],
  layers: ['M12 3 2 8l10 5 10-5z', 'M2 13l10 5 10-5', 'M2 17.5l10 5 10-5'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  arrowLeft: ['M19 12H5', 'M11 6l-6 6 6 6'],
  arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
  printer: ['M6 9V3h12v6', 'M6 18H4v-7h16v7h-2', 'M7 14h10v7H7z'],
  bell: ['M6 17V11a6 6 0 1 1 12 0v6l2 2H4z', 'M10 21h4'],
  key: ['M8 15a5 5 0 1 1 3.5-1.5L21 23', 'M17 19l2-2', 'M15 17l2-2'],
  install: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4'],
  copy: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  scan: ['M4 8V4h4', 'M16 4h4v4', 'M20 16v4h-4', 'M8 20H4v-4', 'M7 12h10'],
  users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7.5', 'M22 21v-1a6 6 0 0 0-4-5.6'],
};

export function icon(name: keyof typeof ICONS | string, size = 20, cls = ''): SVGElement {
  const paths = ICONS[name] ?? ICONS.info;
  return s(
    'svg',
    {
      class: `icon ${cls}`.trim(),
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    paths.map((d) => s('path', { d })),
  );
}
