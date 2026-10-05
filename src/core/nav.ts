// Back navigation that always does the expected thing: return to the previous page of this app,
// or — when a page was opened directly (a shared link, a notification, a bookmark) — go to its
// logical parent instead of leaving the app.
import { current, navigate } from './router';

const stack: string[] = [];

export function trackNavigation(): void {
  const push = () => {
    const p = current().path;
    if (stack.length > 1 && stack[stack.length - 2] === p) stack.pop();
    else if (stack.at(-1) !== p) stack.push(p);
  };
  push();
  window.addEventListener('hashchange', push);
}

export function parentOf(path: string): string {
  if (/^\/matters\/[^/]+\/print$/.test(path)) return path.replace(/\/print$/, '');
  if (path.startsWith('/matters/')) return '/matters';
  if (path === '/desk') return '/';
  const desk = ['/matters', '/deadlines', '/desk/live', '/integrations', '/desk/guide', '/settings', '/more', '/share'];
  if (desk.includes(path)) return '/desk';
  return '/';
}

export function canGoBack(): boolean {
  const p = current().path;
  return p !== '/' && p !== '/desk';
}

export function goBack(): void {
  if (stack.length > 1) history.back();
  else navigate(parentOf(current().path), true);
}
