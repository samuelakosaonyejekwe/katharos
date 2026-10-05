import { h, icon } from '../core/dom';
import { t } from '../core/i18n';
import { navigate, type RouteCtx } from '../core/router';
import { card } from '../core/ui';
import { pageHead } from './common';
import { showInstallHelp } from './install';

export function moreView(): HTMLElement {
  const items: [string, string, string, string][] = [
    ['/integrations', 'plug', 'Integrations', 'AI, OCR, messaging, signatures, live data — status and setup'],
    ['/desk/guide', 'book', 'Guide & rulebook', 'How it works, the checks, glossary, limits'],
    ['/settings', 'gear', 'Settings', 'Firm, security, backups, appearance'],
    ['/', 'globe', 'Public site', 'What buyers and visitors see'],
  ];
  return h(
    'div',
    { class: 'stack' },
    pageHead(t('More')),
    h('div', { class: 'list card', style: { padding: '0 16px' } }, items.map(([p, i, l, d]) => h('a', { class: 'list-item', href: `#${p}` }, icon(i, 22), h('div', { class: 'grow' }, h('div', { class: 'title' }, t(l)), h('small', { class: 'muted' }, t(d))), icon('arrowRight', 18)))),
    h('button', { class: 'btn btn-accent btn-block', onclick: () => showInstallHelp() }, icon('install', 18), t('Install app')),
  );
}

/** Web Share Target: links or text shared to Katharos from other apps. */
export function shareTargetView(ctx: RouteCtx): HTMLElement {
  const text = [ctx.query.get('title'), ctx.query.get('text'), ctx.query.get('url')].filter(Boolean).join('\n');
  const buyerLink = text.match(/#\/b\/[A-Za-z0-9_\-.]+/);
  if (buyerLink) {
    location.hash = buyerLink[0];
    location.reload();
  }
  return h(
    'div',
    { class: 'stack' },
    pageHead(t('Shared with Katharos')),
    card(null, h('div', { class: 'stack-sm' }, h('pre', { class: 'pagetext', style: { padding: '12px', whiteSpace: 'pre-wrap' } }, text || t('Nothing was shared.')), h('button', { class: 'btn btn-primary', onclick: () => navigate('/matters/new') }, icon('plus', 16), t('Open a new matter')))),
  );
}
