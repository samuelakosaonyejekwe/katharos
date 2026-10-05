// App shell: navigation, top bar (connectivity, install, language, lock), banners and routing.
import { h, icon, mount } from './core/dom';
import { onUiLang, setUiLang, t, uiLang } from './core/i18n';
import { applyUpdate, isStandalone, onPwa, pwa } from './core/pwa';
import { current, match } from './core/router';
import { vault } from './core/db';
import { toast } from './core/ui';
import { showInstallHelp } from './views/install';
import { ALL_LANGS, type Lang } from './domain/types';
import { LANG_NAMES } from './i18n/langs';

const NAV = [
  { path: '/desk', label: 'Dashboard', icon: 'home', mobile: true },
  { path: '/matters', label: 'Matters', icon: 'folder', mobile: true },
  { path: '/deadlines', label: 'Deadlines', icon: 'calendar', mobile: true },
  { path: '/desk/live', label: 'Live market', icon: 'pulse', mobile: true },
  { path: '/integrations', label: 'Integrations', icon: 'plug' },
  { path: '/desk/guide', label: 'Guide & rulebook', icon: 'book' },
  { path: '/settings', label: 'Settings', icon: 'gear' },
];

let content: HTMLElement;
let titleEl: HTMLElement;
let bannerHost: HTMLElement;
let navHost: HTMLElement;
let tabHost: HTMLElement;
let topActions: HTMLElement;
let sideFoot: HTMLElement;
let brandSub: HTMLElement;
let renderSeq = 0;

function isActive(path: string, cur: string): boolean {
  return path === '/desk' ? cur === '/desk' : cur === path || cur.startsWith(`${path}/`);
}

function renderNav(): void {
  const cur = current().path;
  mount(sideFoot, h('a', { href: '#/matters/new', class: 'btn btn-primary btn-block' }, icon('plus', 18), t('New matter')));
  brandSub.textContent = t('Title Desk · Cyprus');
  mount(
    navHost,
    NAV.map((n) => h('a', { href: `#${n.path}`, class: isActive(n.path, cur) ? 'active' : '', 'aria-current': isActive(n.path, cur) ? 'page' : null }, icon(n.icon), t(n.label))),
  );
  const mobile = NAV.filter((n) => n.mobile);
  const moreActive = !mobile.some((n) => isActive(n.path, cur));
  mount(tabHost, [
    ...mobile.map((n) => h('a', { href: `#${n.path}`, class: isActive(n.path, cur) ? 'active' : '' }, icon(n.icon, 22), t(n.label === 'Live market' ? 'Live' : n.label))),
    h('a', { href: '#/more', class: moreActive ? 'active' : '' }, icon('menu', 22), t('More')),
  ]);
}

function renderTopActions(): void {
  const online = pwa.online;
  mount(
    topActions,
    h('span', { class: `status-pill ${online ? '' : 'off'}`, title: online ? t('Online — live data is refreshing') : t('Offline — everything keeps working from this device') }, h('span', { class: 'dot' }), online ? t('Online') : t('Offline')),
    !isStandalone() ? h('button', { class: 'btn btn-sm btn-accent', onclick: () => showInstallHelp() }, icon('install', 16), h('span', { class: 'hide-mobile' }, t('Install app'))) : null,
    languagePicker(),
    h('button', { class: 'icon-btn', title: t('Lock now'), 'aria-label': t('Lock now'), onclick: () => vault.lock() }, icon('lock')),
  );
}

export function languagePicker(): HTMLElement {
  const sel = h(
    'select',
    { 'aria-label': t('Interface language'), title: t('Interface language'), class: 'lang-select' },
    ALL_LANGS.map((l) => h('option', { value: l, selected: l === uiLang(), lang: l }, LANG_NAMES[l])),
  ) as HTMLSelectElement;
  sel.addEventListener('change', () => void setUiLang(sel.value as Lang));
  return h('label', { class: 'lang-pick' }, icon('globe', 18), sel);
}

function renderBanners(): void {
  mount(
    bannerHost,
    pwa.updateReady ? h('div', { class: 'banner', role: 'status' }, icon('sparkle'), t('A new version of Katharos is ready.'), h('button', { class: 'btn btn-sm', onclick: () => applyUpdate() }, t('Update now'))) : null,
    !pwa.online ? h('div', { class: 'banner warn', role: 'status' }, icon('wifiOff'), t('You are offline. Matters, checks, reports and deadlines all keep working; live data shows the last saved copy.')) : null,
  );
}

export async function renderRoute(): Promise<void> {
  const seq = ++renderSeq;
  const { path, query } = current();
  renderNav();
  const m = match(path);
  if (!m) {
    mount(content, h('div', { class: 'empty' }, h('h3', null, t('Page not found')), h('a', { href: '#/desk', class: 'btn' }, t('Go to dashboard'))));
    return;
  }
  try {
    const node = await m.route.view({ params: m.params, query, path });
    if (seq !== renderSeq) return; // a newer navigation won
    mount(content, node);
    const heading = content.querySelector('h1');
    titleEl.textContent = heading?.textContent ?? 'Katharos';
    document.title = `${titleEl.textContent} · Katharos`;
    content.parentElement?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  } catch (e) {
    console.error(e);
    mount(content, h('div', { class: 'callout danger' }, icon('alert'), h('div', null, h('strong', null, t('Something went wrong on this page.')), h('p', null, String((e as Error).message ?? e)))));
  }
}

export function renderShell(root: HTMLElement): void {
  navHost = h('nav', { class: 'nav', 'aria-label': t('Main') });
  tabHost = h('nav', { class: 'tabbar', 'aria-label': t('Main') });
  content = h('main', { class: 'content', id: 'content', tabindex: -1 });
  titleEl = h('div', { class: 'title' }, 'Katharos');
  bannerHost = h('div');
  topActions = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } });
  sideFoot = h('div', { class: 'sidebar-foot' });
  brandSub = h('small', { class: 'muted' });

  mount(
    root,
    h(
      'div',
      { class: 'shell' },
      h(
        'aside',
        { class: 'sidebar' },
        h('a', { class: 'brand', href: '#/desk' }, h('img', { src: './icons/icon.svg', alt: '' }), h('span', null, h('strong', null, 'Katharos'), brandSub)),
        navHost,
        sideFoot,
      ),
      h(
        'div',
        { class: 'main' },
        h('header', { class: 'topbar' }, h('a', { class: 'mobile-brand', href: '#/desk', 'aria-label': 'Katharos' }, h('img', { src: './icons/icon.svg', alt: '' })), titleEl, h('div', { class: 'spacer' }), topActions),
        bannerHost,
        content,
      ),
      tabHost,
    ),
  );
  renderTopActions();
  renderBanners();
  const offPwa = onPwa(() => {
    if (!content.isConnected) return offPwa();
    renderTopActions();
    renderBanners();
  });
  const offLang = onUiLang(() => {
    if (!content.isConnected) return offLang();
    renderTopActions();
    void renderRoute();
  });
  window.addEventListener('online', () => toast(t('Back online — refreshing live data'), 'ok'));
}
