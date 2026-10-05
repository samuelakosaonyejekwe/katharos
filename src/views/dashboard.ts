import { h, icon } from '../core/dom';
import { fmtDate, relTime, todayISO, addDays } from '../core/dates';
import { requestPersistence, storageEstimate } from '../core/db';
import { locale, num, t, uiLang } from '../core/i18n';
import { isStandalone, pwa } from '../core/pwa';
import { settings } from '../core/settings';
import { badge, card, empty, severityTone } from '../core/ui';
import { allDeadlines, listMatters } from '../domain/matters';
import { findingText } from '../domain/text';
import { readFeed, refreshFeed, type FxData, type HpiData, type NewsItem } from '../integrations/feeds';
import { dateChip, dueText, flagBadges, pageHead, sparkline, statusBadge, steps } from './common';
import { showInstallHelp } from './install';

export async function dashboardView(): Promise<HTMLElement> {
  const matters = await listMatters();
  const open = matters.filter((m) => m.status !== 'closed');
  const today = todayISO();
  const deadlines = (await allDeadlines()).filter((d) => !d.done);
  const soon = deadlines.filter((d) => d.due <= addDays(today, 14));
  const overdue = deadlines.filter((d) => d.due < today);
  const reds = open.reduce((n, m) => n + m.findings.filter((f) => f.severity === 'red' && m.reviews[f.key]?.decision !== 'rejected').length, 0);
  const toReview = open.flatMap((m) => m.findings.filter((f) => (f.severity === 'red' || f.severity === 'amber') && !m.reviews[f.key]).map((f) => ({ m, f })));
  const name = settings().advocateName;

  const stats = h(
    'div',
    { class: 'grid-4' },
    h('a', { class: 'stat', href: '#/matters' }, h('span', { class: 'label' }, icon('folder', 16), t('Open matters')), h('span', { class: 'value' }, String(open.length)), h('span', { class: 'sub' }, t('{n} in total', { n: matters.length }))),
    h('a', { class: `stat ${reds ? 'red' : 'green'}`, href: '#/matters?filter=red' }, h('span', { class: 'label' }, icon('alert', 16), t('Red flags')), h('span', { class: 'value' }, String(reds)), h('span', { class: 'sub' }, t('{n} findings await a decision', { n: toReview.length }))),
    h('a', { class: `stat ${overdue.length ? 'red' : soon.length ? 'amber' : 'green'}`, href: '#/deadlines' }, h('span', { class: 'label' }, icon('calendar', 16), t('Deadlines · 14 days')), h('span', { class: 'value' }, String(soon.length)), h('span', { class: 'sub' }, overdue.length ? t('{n} overdue', { n: overdue.length }) : t('none overdue'))),
    h('a', { class: 'stat', href: '#/matters?filter=reported' }, h('span', { class: 'label' }, icon('file', 16), t('Reports issued')), h('span', { class: 'value' }, String(matters.filter((m) => m.report).length)), h('span', { class: 'sub' }, t('in three languages each'))),
  );

  const attention = card(
    t('Needs your decision'),
    toReview.length
      ? h(
          'div',
          { class: 'list' },
          toReview.slice(0, 7).map(({ m, f }) =>
            h('a', { class: 'list-item', href: `#/matters/${m.id}?tab=findings` }, badge(t(f.severity === 'red' ? 'Red' : 'Amber'), severityTone(f.severity)), h('div', { class: 'grow' }, h('div', { class: 'title' }, findingText(f, uiLang())), h('small', { class: 'muted' }, `${m.matterRef} · ${m.buyer.name}`))),
          ),
          toReview.length > 7 ? h('small', { class: 'muted' }, t('and {n} more', { n: toReview.length - 7 })) : null,
        )
      : empty('check', t('Nothing waiting'), t('Every red and amber finding has a decision.')),
    { icon: 'scale', help: t('Rules decide, the AI only explains. A report can be issued once every red and amber finding is accepted, edited or rejected by the advocate.') },
  );

  const upcoming = card(
    t('Upcoming deadlines'),
    deadlines.length
      ? h(
          'div',
          { class: 'list' },
          deadlines.slice(0, 7).map((d) => h('a', { class: 'list-item', href: `#/matters/${d.matterId}?tab=deadlines` }, dateChip(d.due), h('div', { class: 'grow' }, h('div', { class: 'title' }, d.label), h('small', { class: 'muted' }, `${d.matterRef} · ${dueText(d.due)}`)))),
        )
      : empty('calendar', t('No open deadlines'), t('Deadlines appear as soon as a certificate or contract is read.')),
    { icon: 'calendar', actions: h('a', { class: 'btn btn-sm', href: '#/deadlines' }, t('Calendar')) },
  );

  const recent = card(
    t('Recent matters'),
    matters.length
      ? h(
          'div',
          { class: 'list' },
          matters.slice(0, 5).map((m) =>
            h('a', { class: 'list-item', href: `#/matters/${m.id}` }, h('div', { class: 'grow' }, h('div', { class: 'row-between' }, h('span', { class: 'title' }, `${m.matterRef} · ${m.buyer.name}`), statusBadge(m.status)), steps(m.status), flagBadges(m))),
          ),
        )
      : empty('folder', t('No matters yet'), t('Open your first matter and upload a Land Registry search certificate.'), h('a', { class: 'btn btn-primary', href: '#/matters/new' }, icon('plus', 18), t('New matter'))),
    { icon: 'folder', actions: h('a', { class: 'btn btn-sm btn-primary', href: '#/matters/new' }, icon('plus', 16), t('New')) },
  );

  const market = h('div');
  void renderMarket(market);

  const device = card(t('This device'), await deviceInfo(), { icon: 'phone' });

  return h(
    'div',
    { class: 'stack' },
    pageHead(name ? t('Welcome, {name}', { name }) : t('Dashboard'), t('{date} · everything below works offline', { date: fmtDate(today, locale()) })),
    stats,
    h('div', { class: 'grid-2' }, attention, upcoming),
    h('div', { class: 'grid-2' }, recent, market),
    device,
  );
}

async function renderMarket(host: HTMLElement): Promise<void> {
  const [fx, hpi, news] = await Promise.all([readFeed<FxData>('fx'), readFeed<HpiData>('hpi'), readFeed<NewsItem[]>('news')]);
  const draw = () =>
    card(
      t('Live market'),
      h(
        'div',
        { class: 'stack-sm' },
        hpi.data
          ? h(
              'div',
              null,
              h('div', { class: 'row-between' }, h('strong', null, t('Cyprus house price index')), hpi.data.annualChange ? badge(`${hpi.data.annualChange.value > 0 ? '+' : ''}${hpi.data.annualChange.value}% y/y`, hpi.data.annualChange.value >= 0 ? 'teal' : 'amber') : null),
              sparkline(hpi.data.series.map((p) => ({ label: p.period, value: p.index })), { height: 110 }),
            )
          : null,
        fx.data ? h('div', { class: 'row' }, ['GBP', 'USD', 'ILS', 'RUB'].filter((c) => fx.data!.rates[c]).map((c) => badge(`€1 = ${num(fx.data!.rates[c], 2)} ${c}`, 'neutral'))) : null,
        news.data ? h('div', { class: 'list' }, news.data.slice(0, 3).map((n) => h('a', { class: 'news-item', href: n.link, target: '_blank', rel: 'noopener noreferrer' }, h('strong', null, n.title), h('small', { class: 'muted' }, `${n.source} · ${relTime(Date.parse(n.date))}`)))) : null,
        !hpi.data && !fx.data && !news.data ? h('p', { class: 'muted' }, t('Fetching live data…')) : null,
        h('small', { class: 'muted' }, fx.fetchedAt ? t('Updated {when} · sources: ECB, Eurostat, Cyprus Mail, Google News', { when: relTime(fx.fetchedAt) }) : t('Sources: ECB, Eurostat, Cyprus Mail, Google News')),
      ),
      { icon: 'pulse', actions: h('a', { class: 'btn btn-sm', href: '#/desk/live' }, t('Open')) },
    );
  host.replaceChildren(draw());
  if (fx.stale || hpi.stale || news.stale) {
    await Promise.allSettled([refreshFeed('fx'), refreshFeed('hpi'), refreshFeed('news')]);
    const [a, b, c] = await Promise.all([readFeed<FxData>('fx'), readFeed<HpiData>('hpi'), readFeed<NewsItem[]>('news')]);
    Object.assign(fx, a);
    Object.assign(hpi, b);
    Object.assign(news, c);
    if (host.isConnected) host.replaceChildren(draw());
  }
}

async function deviceInfo(): Promise<HTMLElement> {
  const est = await storageEstimate();
  const persisted = await requestPersistence();
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  return h(
    'div',
    { class: 'grid-4' },
    h('div', { class: 'stack-sm' }, h('strong', null, t('Installed')), isStandalone() ? badge(t('Yes — running as an app'), 'green') : h('button', { class: 'btn btn-sm btn-accent', onclick: () => showInstallHelp() }, icon('install', 16), t('Install now'))),
    h('div', { class: 'stack-sm' }, h('strong', null, t('Offline ready')), 'serviceWorker' in navigator && navigator.serviceWorker.controller ? badge(t('Yes'), 'green') : badge(t('After first reload'), 'amber')),
    h('div', { class: 'stack-sm' }, h('strong', null, t('Storage')), badge(persisted ? t('Protected from eviction') : t('Best effort'), persisted ? 'green' : 'amber'), est ? h('small', { class: 'muted' }, t('{used} used of {quota}', { used: mb(est.usage), quota: mb(est.quota) })) : null),
    h('div', { class: 'stack-sm' }, h('strong', null, t('Version')), h('code', null, pwa.version || 'dev'), h('small', { class: 'muted' }, t('Updates install automatically'))),
  );
}
