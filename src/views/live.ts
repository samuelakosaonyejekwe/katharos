// Live market: fetched by this browser directly from public sources, refreshed while open,
// refreshed in the background by the service worker where supported, and kept for offline use.
import { h, icon, mount } from '../core/dom';
import { relTime } from '../core/dates';
import { num, t } from '../core/i18n';
import { badge, card, field, spinner, toast } from '../core/ui';
import { FEEDS, onFeed, readFeed, refreshAll, refreshFeed, type FeedId, type FeedState, type FxData, type HpiData, type NewsItem } from '../integrations/feeds';
import { pageHead, sparkline } from './common';

const CURRENCIES: Record<string, string> = { GBP: 'British pound', USD: 'US dollar', ILS: 'Israeli shekel', RUB: 'Russian rouble', UAH: 'Ukrainian hryvnia', CHF: 'Swiss franc', AED: 'UAE dirham', CNY: 'Chinese yuan', SEK: 'Swedish krona', PLN: 'Polish złoty', TRY: 'Turkish lira' };

function every(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return t('every {n} min', { n: min });
  if (min < 1440) return t('every {n} h', { n: Math.round(min / 60) });
  return t('every {n} days', { n: Math.round(min / 1440) });
}

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
  const fxHost = h('div', { class: 'fill' });
  const hpiHost = h('div', { class: 'fill' });
  const newsHost = h('div');
  let amount = 250000;
  let q = '';

  const drawFx = async () => {
    const s = await readFeed<FxData>('fx');
    const conv = h('div');
    const drawConv = () =>
      mount(
        conv,
        s.data
          ? h(
              'div',
              { class: 'fx-list' },
              Object.entries(s.data.rates).map(([c, r]) => h('div', { class: 'fx-row' }, h('span', { class: 'fx-code' }, c), h('span', { class: 'fx-name muted' }, t(CURRENCIES[c] ?? c)), h('strong', { class: 'fx-amount' }, num(amount * r, 0)), h('small', { class: 'fx-rate muted' }, `€1 = ${num(r, 4)}`))),
            )
          : spinner(),
      );
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
              (() => {
                const ser = s.data!.series;
                const last = ser.at(-1);
                const prev = ser.at(-2);
                const yearAgo = ser.at(-5);
                const pct = (a?: number, b?: number) => (a && b ? `${a >= b ? '+' : ''}${num(((a - b) / b) * 100, 1)}%` : '—');
                const tiles: [string, string, string][] = [
                  [t('Latest quarter'), last ? num(last.index, 1) : '—', last?.period ?? ''],
                  [t('Previous quarter'), prev ? num(prev.index, 1) : '—', pct(last?.index, prev?.index)],
                  [t('A year earlier'), yearAgo ? num(yearAgo.index, 1) : '—', pct(last?.index, yearAgo?.index)],
                  [t('Since 2015'), last ? `${last.index >= 100 ? '+' : ''}${num(last.index - 100, 1)}%` : '—', t('2015 = 100')],
                ];
                return h('div', { class: 'glance', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' } }, tiles.map(([l, v, sub]) => h('div', { class: 'glance-item' }, h('small', { class: 'muted' }, l), h('strong', null, v), h('small', null, sub))));
              })(),
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
          if (!navigator.onLine) return toast(t('You are offline — showing the last saved data.'), 'warn');
          b.disabled = true;
          b.classList.add('busy');
          const st = await refreshFeed(id, true);
          b.disabled = false;
          b.classList.remove('busy');
          toast(st.error ? t('Could not refresh {f} — showing the last saved copy', { f: t(FEEDS[id].title) }) : t('{f} updated', { f: t(FEEDS[id].title) }), st.error ? 'warn' : 'ok');
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
      h(
        'button',
        {
          class: 'btn',
          onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            if (!navigator.onLine) return toast(t('You are offline — showing the last saved data.'), 'warn');
            b.disabled = true;
            b.classList.add('busy');
            const { ok, failed } = await refreshAll(true);
            b.disabled = false;
            b.classList.remove('busy');
            await Promise.all([drawFx(), drawHpi(), drawNews()]);
            if (!failed.length) toast(t('All {n} live sources updated', { n: ok }), 'ok');
            else toast(t('{ok} updated · still showing saved data for: {list}', { ok, list: failed.map((x) => t(x)).join(', ') }), 'warn', 7000);
          },
        },
        icon('refresh', 18),
        t('Refresh all'),
      ),
    ),
    h('div', { class: 'grid-2' }, hpiHost, fxHost),
    newsHost,
    card(
      t('Sources and fallbacks'),
      h('div', { class: 'list' }, (Object.keys(FEEDS) as FeedId[]).map((id) => h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, t(FEEDS[id].title)), h('small', { class: 'muted' }, FEEDS[id].sources.map((s) => s.name).join(' → '), ` → ${t('last good copy')}`)), badge(every(FEEDS[id].ttlMs), 'neutral')))),
      { icon: 'layers' },
    ),
  );
}
