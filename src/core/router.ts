// Hash router: works on any static host or sub-path (GitHub Pages, Cloudflare, Netlify, a USB stick)
// with no server rewrites — part of what lets the app run from any mirror.

export interface RouteCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

export type View = (ctx: RouteCtx) => Promise<Node> | Node;

interface Route {
  pattern: RegExp;
  keys: string[];
  view: View;
  public?: boolean;
}

const routes: Route[] = [];

export function route(path: string, view: View, opts: { public?: boolean } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/\//g, '\\/').replace(/:(\w+)\*?/g, (m, k) => {
      keys.push(k);
      return m.endsWith('*') ? '(.+)' : '([^/]+)';
    })}\\/?$`,
  );
  routes.push({ pattern, keys, view, public: opts.public });
}

export function current(): { path: string; query: URLSearchParams } {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(q) };
}

export function match(path: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function navigate(path: string, replace = false): void {
  const target = `#${path}`;
  if (replace) history.replaceState(null, '', target);
  else if (location.hash !== target) location.hash = target;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function link(path: string): string {
  return `#${path}`;
}
