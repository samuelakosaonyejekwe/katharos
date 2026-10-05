import './styles.css';
import { renderRoute, renderShell } from './app';
import { mount, h } from './core/dom';
import { vault, requestPersistence } from './core/db';
import { initUiLang, onUiLang, t } from './core/i18n';
import { activeLicence } from './core/licence';
import { initPwa, onSwMessage } from './core/pwa';
import { current, match, navigate, route } from './core/router';
import { forgetSettings, loadSettings, settings } from './core/settings';
import { toast } from './core/ui';
import { forgetMatters, syncReminders } from './domain/matters';
import { startFeedLoop, refreshFeed, FEEDS, type FeedId } from './integrations/feeds';
import { flushOutbox } from './integrations/messaging';
import { lockScreen } from './views/lock';

// Public site — anyone may open these.
const PUBLIC = ['/', '/live', '/guide', '/firm'];
route('/', async () => (await import('./views/public')).landingView(), { public: true });
route('/live', async () => (await import('./views/live')).liveView(), { public: true });
route('/guide', async (c) => (await import('./views/guide')).guideView(c, 'public'), { public: true });
route('/firm', async () => (await import('./views/public')).firmView(), { public: true });

// Katharos Desk — licensed firms only, behind the encrypted vault.
// Views are split into separate chunks and loaded on first visit (all are precached for offline use).
route('/desk', async () => (await import('./views/dashboard')).dashboardView());
route('/matters', async (c) => (await import('./views/matters')).mattersView(c));
route('/matters/new', async () => (await import('./views/matters')).newMatterView());
route('/matters/:id', async (c) => (await import('./views/matter')).matterView(c));
route('/matters/:id/print', async (c) => (await import('./views/matter')).printView(c));
route('/deadlines', async (c) => (await import('./views/deadlines')).deadlinesView(c));
route('/desk/live', async () => (await import('./views/live')).liveView());
route('/integrations', async () => (await import('./views/integrations')).integrationsView());
route('/desk/guide', async (c) => (await import('./views/guide')).guideView(c, 'firm'));
route('/settings', async () => (await import('./views/settings')).settingsView());
route('/more', async () => (await import('./views/more')).moreView());
route('/share', async (c) => (await import('./views/more')).shareTargetView(c));

const root = document.getElementById('app')!;
let mode: 'public' | 'lock' | 'desk' | 'portal' = 'public';
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function armAutoLock(): void {
  clearTimeout(idleTimer);
  const minutes = settings().autoLockMinutes;
  if (minutes > 0 && vault.isUnlocked()) idleTimer = setTimeout(() => vault.lock(), minutes * 60_000);
}

async function afterUnlock(firstRun: boolean, seedDemo: boolean): Promise<void> {
  await loadSettings();
  if (firstRun && seedDemo) {
    const { seedDemoMatter } = await import('./domain/demo');
    await seedDemoMatter();
  }
  if (firstRun) void requestPersistence();
  renderShell(root);
  mode = 'desk';
  if (PUBLIC.includes(current().path)) navigate('/desk', true);
  await renderRoute();
  void syncReminders();
  void flushOutbox().then((n) => n && toast(t('{n} queued messages sent', { n }), 'ok'));
  armAutoLock();
}

async function renderPublic(): Promise<void> {
  const { path, query } = current();
  const m = match(path) ?? match('/')!;
  const { publicShell } = await import('./views/public');
  publicShell(root, await m.route.view({ params: m.params, query, path }));
  mode = 'public';
}

async function renderPortal(): Promise<void> {
  const { buyerPortal } = await import('./views/buyer');
  mount(root, await buyerPortal(location.hash.replace(/^#\/b\/?/, '')));
  mode = 'portal';
}

/** Decides what this URL may show: public page, buyer portal, licence gate, vault lock, or the Desk. */
async function dispatch(): Promise<void> {
  const { path } = current();
  if (path === '/b' || path.startsWith('/b/')) return renderPortal();
  const m = match(path);
  if (!m || m.route.public) return renderPublic();
  if (!(await activeLicence())) {
    toast(t('Katharos Desk is for licensed law firms — enter your licence key first.'), 'info', 5000);
    return navigate('/firm', true);
  }
  if (!vault.isUnlocked()) {
    if (mode !== 'lock') {
      mode = 'lock';
      forgetMatters();
      forgetSettings();
      lockScreen(root, (first, seed) => void afterUnlock(first, seed));
    }
    return;
  }
  if (mode !== 'desk') {
    renderShell(root);
    mode = 'desk';
  }
  return renderRoute();
}

async function boot(): Promise<void> {
  await initUiLang();
  initPwa();
  startFeedLoop();

  window.addEventListener('hashchange', () => void dispatch());
  onUiLang(() => mode === 'public' && void renderPublic());
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) window.addEventListener(ev, armAutoLock, { passive: true });
  vault.onChange((locked) => {
    if (!locked) return;
    mode = 'public';
    void dispatch();
  });
  onSwMessage((data) => {
    if (data?.type === 'FLUSH_OUTBOX') void flushOutbox();
    if (data?.type === 'FEEDS_REFRESHED') for (const id of Object.keys(FEEDS) as FeedId[]) void refreshFeed(id);
  });
  window.addEventListener('online', () => void flushOutbox());

  await dispatch();
}

boot().catch((e) => {
  console.error(e);
  mount(root, h('div', { class: 'lock' }, h('div', { class: 'lock-card' }, h('h2', null, 'Katharos could not start'), h('p', null, String((e as Error).message ?? e)), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload'))));
});
