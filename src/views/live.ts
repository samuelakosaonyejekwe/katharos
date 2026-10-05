// Live market: fetched by this browser directly from public sources, refreshed while open,
// refreshed in the background by the service worker where supported, and kept for offline use.
import { h, icon, mount } from '../core/dom';
import { relTime } from '../core/dates';
import { num, t } from '../core/i18n';
import { badge, card, field, spinner } from '../core/ui';
import { FEEDS, onFeed, readFeed, refreshAll, refreshFeed, type FeedId, type FeedState, type FxData, type HpiData, type NewsItem } from '../integrations/feeds';
import { pageHead, sparkline } from './common';

const CURRENCIES: Record<string, string> = { GBP: 'British pound', USD: 'US dollar', ILS: 'Israeli shekel', RUB: 'Russian rouble', UAH: 'Ukrainian hryvnia', CHF: 'Swiss franc', AED: 'UAE dirham', CNY: 'Chinese yuan', SEK: 'Swedish krona', PLN: 'Polish złoty' };

function freshness(s: FeedState<unknown>): HTMLElement {
  return h(
    'small',
    { class: 'muted' },
    s.fetchedAt ? t('Updated {when}', { when: relTime(s.fetchedAt) }) : t('Not fetched yet'),
    s.source ? ` · ${s.source}` : '',
    s.error && s.data ? h('span', null, ' · ', badge(t('showing last saved copy'), 'amber')) : null,
    s.error && !s.data ? h('span', null, ' · ', badge(t('unavailable'), 'red')) : null,
  );
}

export async function liveView(): Promise<HTMLElement> {
  const fxHost = h('div');
  const hpiHost = h('div');
  const newsHost = h('div');
  let amount = 250000;
  let q = '';

  const drawFx = async () => {
    const s = await readFeed<FxData>('fx');
    const conv = h('div', { class: 'grid-4' });
    const drawConv = () => mount(conv, s.data ? Object.entries(s.data.rates).map(([c, r]) => h('div', { class: 'stat' }, h('span', { class: 'label' }, `${c} · ${t(CURRENCIES[c] ?? c)}`), h('span', { class: 'value', style: { fontSize: '1.25rem' } }, num(amount * r, 0)), h('span', { class: 'sub' }, `€1 = ${num(r, 4)} ${c}`))) : spinner());
    drawConv();
    mount(
      fxHost,
      card(
        t('What the price is in the buyer’s currency'),
        h('div', { class: 'stack' }, field({ label: t('Price in euro'), type: 'number', value: amount, inputmode: 'decimal', onInput: (v) => ((amount = Number(v) || 0), drawConv()) }), conv, freshness(s as FeedState<unknown>), s.data ? h('small', { class: 'muted' }, t('ECB reference rates of {d}. Indicative only — the bank’s rate on the day applies.', { d: s.data.date })) : null),
        { icon: 'coins', actions: refreshBtn('fx') },
      ),
    );
  };

  const drawHpi = async () => {
    const s = await readFeed<HpiData>('hpi');
    mount(
      hpiHost,
      card(
        t('Cyprus residential property prices'),
        s.data
          ? h(
              'div',
              { class: 'stack-sm' },
              h('div', { class: 'row' }, h('strong', { style: { fontSize: '1.6rem' } }, num(s.data.series.at(-1)?.index ?? 0, 1)), h('span', { class: 'muted' }, t('index, 2015 = 100 · {p}', { p: s.data.series.at(-1)?.period ?? '' })), s.data.annualChange ? badge(t('{v}% on a year earlier', { v: `${s.data.annualChange.value > 0 ? '+' : ''}${s.data.annualChange.value}` }), s.data.annualChange.value >= 0 ? 'teal' : 'amber') : null),
              sparkline(s.data.series.map((p) => ({ label: p.period, value: p.index }))),
              freshness(s as FeedState<unknown>),
              h('small', { class: 'muted' }, t('Eurostat house price index (prc_hpi_q), all dwellings. Built from transaction data; Cyprus has no public register of actual sale prices.')),
            )
          : spinner(t('Fetching from Eurostat…')),
        { icon: 'pulse', actions: refreshBtn('hpi') },
      ),
    );
  };

  const drawNews = async () => {
    const s = await readFeed<NewsItem[]>('news');
    const items = (s.data ?? []).filter((n) => !q || `${n.title} ${n.summary}`.toLowerCase().includes(q.toLowerCase()));
    const watchWords = /title deed|land registry|κτηματολ|mortgage|foreclos|kedipes|non-eu|foreign buyer|golden|permanent residenc|vat|amnesty|planning|ban/i;
    mount(
      newsHost,
      card(
        t('Property news'),
        h(
          'div',
          { class: 'stack-sm' },
          (() => {
            const inp = h('input', { type: 'search', placeholder: t('Filter headlines (e.g. title deeds, VAT, Paphos)'), value: q }) as HTMLInputElement;
            inp.addEventListener('input', () => ((q = inp.value), void drawNews().then(() => newsHost.querySelector('input')?.focus())));
            return inp;
          })(),
          s.data
            ? h(
                'div',
                { class: 'list' },
                items.slice(0, 30).map((n) => h('a', { class: 'news-item', href: n.link, target: '_blank', rel: 'noopener noreferrer' }, h('strong', null, n.title, watchWords.test(n.title) ? h('span', null, ' ', badge(t('relevant to due diligence'), 'amber')) : null), n.summary ? h('small', null, n.summary) : null, h('small', { class: 'muted' }, `${n.source} · ${relTime(Date.parse(n.date))}`))),
                !items.length ? h('p', { class: 'muted' }, t('No headlines match.')) : null,
              )
            : spinner(t('Fetching headlines…')),
          freshness(s as FeedState<unknown>),
        ),
        { icon: 'globe', actions: refreshBtn('news') },
      ),
    );
  };

  function refreshBtn(id: FeedId): HTMLElement {
    return h(
      'button',
      {
        class: 'btn btn-sm',
        'aria-label': t('Refresh'),
        onclick: async (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement;
          b.disabled = true;
          await refreshFeed(id, true);
          b.disabled = false;
        },
      },
      icon('refresh', 16),
    );
  }

  await Promise.all([drawFx(), drawHpi(), drawNews()]);
  const off = onFeed((id) => {
    if (!fxHost.isConnected) return off();
    if (id === 'fx') void drawFx();
    if (id === 'hpi') void drawHpi();
    if (id === 'news') void drawNews();
  });
  void refreshAll(false);

  return h(
    'div',
    { class: 'stack' },
    pageHead(
      t('Live market'),
      t('Fetched by this device straight from public sources — no central server — refreshed every few minutes while open and in the background where your browser allows. The last good copy stays available offline.'),
      h('button', { class: 'btn', onclick: () => void refreshAll(true) }, icon('refresh', 18), t('Refresh all')),
    ),
    h('div', { class: 'grid-2' }, hpiHost, fxHost),
    newsHost,
    card(
      t('Sources and fallbacks'),
      h('div', { class: 'list' }, (Object.keys(FEEDS) as FeedId[]).map((id) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, t(FEEDS[id].title)), h('small', { class: 'muted' }, FEEDS[id].sources.map((s) => s.name).join(' → '), 'gatewayPath' in FEEDS[id] ? ` → ${t('firm gateway mirror')}` : '', ` → ${t('last good copy')}`)), badge(t('every {n} min', { n: Math.round(FEEDS[id].ttlMs / 60000) }), 'neutral')))),
      { icon: 'layers' },
    ),
  );
}
