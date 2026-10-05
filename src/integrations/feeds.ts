// Live market data, fetched by each user's own browser straight from public, credible sources
// (no central server, no dependency on any one machine). Every feed has fallback sources, a
// last-known-good copy on the device, and a freshness timestamp shown in the UI.
import { raw } from '../core/db';
import { mergeLiveHolidays } from '../core/dates';
import { fetchRetry, gateway, gatewayConfigured } from './http';

export interface FeedState<T> {
  id: string;
  data: T | null;
  fetchedAt: number | null;
  source: string | null;
  error: string | null;
  stale: boolean;
}

export interface FxData {
  date: string;
  rates: Record<string, number>;
}
export interface HpiData {
  updated: string;
  series: { period: string; index: number }[];
  annualChange: { period: string; value: number } | null;
}
export interface NewsItem {
  title: string;
  link: string;
  date: string;
  source: string;
  summary: string;
}
export interface HolidayItem {
  date: string;
  name: string;
  localName: string;
}

interface Source<T> {
  name: string;
  url: string;
  parse: (res: Response) => Promise<T>;
}

interface FeedDef<T> {
  id: string;
  title: string;
  ttlMs: number;
  sources: Source<T>[];
  /** Optional: the firm's gateway can mirror this feed (another independent route). */
  gatewayPath?: string;
  after?: (data: T) => void;
}

const SYMBOLS = 'USD,GBP,ILS,RUB,UAH,CHF,AED,CNY,SEK,PLN,TRY';

// JSON-stat (Eurostat) → ordered series
function jsonStatSeries(j: any): { period: string; value: number }[] {
  const time = j.dimension?.time?.category?.index ?? {};
  return Object.entries(time as Record<string, number>)
    .sort((a, b) => a[1] - b[1])
    .map(([period, idx]) => ({ period, value: j.value?.[idx] }))
    .filter((p) => typeof p.value === 'number');
}

function stripHtml(s: string): string {
  const doc = new DOMParser().parseFromString(s, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseRssXml(xml: string, source: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.querySelectorAll('item')].slice(0, 25).map((it) => ({
    title: it.querySelector('title')?.textContent?.trim() ?? '',
    link: it.querySelector('link')?.textContent?.trim() ?? '',
    date: new Date(it.querySelector('pubDate')?.textContent ?? Date.now()).toISOString(),
    source,
    summary: stripHtml(it.querySelector('description')?.textContent ?? '').slice(0, 280),
  }));
}

const CM_PROPERTY = 'https://cyprus-mail.com/category/business/property/feed/';
const GNEWS = 'https://news.google.com/rss/search?q=cyprus+(property+OR+%22title+deeds%22+OR+%22land+registry%22+OR+%22real+estate%22)+when:14d&hl=en-GB&gl=CY&ceid=CY:en';

async function rss2json(url: string, label: string): Promise<NewsItem[]> {
  const res = await fetchRetry(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`, { timeoutMs: 12000 }, 1);
  return rss2jsonItems(await res.json(), label);
}

function rss2jsonItems(j: any, label: string): NewsItem[] {
  if (j.status !== 'ok') throw new Error(j.message ?? 'rss2json error');
  return (j.items ?? []).map((i: any) => ({
    title: String(i.title ?? '').trim(),
    link: i.link,
    date: new Date(String(i.pubDate).replace(' ', 'T') + 'Z').toISOString(),
    source: label === 'Google News' ? String(i.author || i.title?.split(' - ').at(-1) || label) : label,
    summary: stripHtml(i.description ?? '').slice(0, 280),
  }));
}

export const FEEDS = {
  fx: {
    id: 'fx',
    title: 'Euro exchange rates (ECB reference)',
    ttlMs: 60 * 60 * 1000,
    gatewayPath: '/v1/feeds/fx',
    sources: [
      {
        name: 'Frankfurter (ECB data)',
        url: `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${SYMBOLS}`,
        parse: async (r: Response) => {
          const j = await r.json();
          return { date: j.date, rates: j.rates } as FxData;
        },
      },
      {
        name: 'European Central Bank data API',
        url: `https://data-api.ecb.europa.eu/service/data/EXR/D.${SYMBOLS.split(',').filter((s) => s !== 'RUB' && s !== 'UAH' && s !== 'AED').join('+')}.EUR.SP00.A?lastNObservations=1&format=jsondata`,
        parse: async (r: Response) => {
          const j = await r.json();
          const cur = j.structure.dimensions.series.find((d: any) => d.id === 'CURRENCY').values.map((v: any) => v.id);
          const rates: Record<string, number> = {};
          let date = '';
          for (const [k, s] of Object.entries<any>(j.dataSets[0].series)) {
            const idx = Number(k.split(':')[1]);
            const obs = Object.values<any>(s.observations)[0];
            rates[cur[idx]] = obs[0];
          }
          date = j.structure.dimensions.observation[0].values.at(-1)?.id ?? '';
          return { date, rates } as FxData;
        },
      },
    ],
  } satisfies FeedDef<FxData>,
  hpi: {
    id: 'hpi',
    title: 'Cyprus house price index (Eurostat)',
    ttlMs: 12 * 60 * 60 * 1000,
    gatewayPath: '/v1/feeds/hpi',
    sources: [
      {
        name: 'Eurostat prc_hpi_q',
        url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hpi_q?geo=CY&unit=I15_Q&purchase=TOTAL&lastTimePeriod=12',
        parse: async (r: Response) => {
          const j = await r.json();
          const series = jsonStatSeries(j).map((p) => ({ period: p.period, index: p.value }));
          let annualChange: HpiData['annualChange'] = null;
          try {
            const a = await (await fetchRetry('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hpi_q?geo=CY&unit=RCH_A&purchase=TOTAL&lastTimePeriod=1', { timeoutMs: 10000 }, 1)).json();
            const last = jsonStatSeries(a).at(-1);
            if (last) annualChange = { period: last.period, value: last.value };
          } catch {
            /* optional */
          }
          return { updated: j.updated, series, annualChange } as HpiData;
        },
      },
    ],
  } satisfies FeedDef<HpiData>,
  news: {
    id: 'news',
    title: 'Cyprus property news',
    ttlMs: 15 * 60 * 1000,
    gatewayPath: '/v1/feeds/news',
    sources: [
      {
        name: 'Cyprus Mail · Google News (via rss2json)',
        url: `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(CM_PROPERTY)}`,
        parse: async (r: Response) => {
          const cm = await r.json().catch(() => ({}));
          const [own, google] = await Promise.allSettled([Promise.resolve().then(() => rss2jsonItems(cm, 'Cyprus Mail')), rss2json(GNEWS, 'Google News')]);
          const items = [own, google].flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
          if (!items.length) throw new Error('no items');
          const seen = new Set<string>();
          return items
            .filter((i) => {
              const k = i.title.toLowerCase().slice(0, 60);
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 40);
        },
      },
      {
        name: 'Cyprus Mail (direct RSS)',
        url: `https://api.allorigins.win/raw?url=${encodeURIComponent(CM_PROPERTY)}`,
        parse: async (r: Response) => parseRssXml(await r.text(), 'Cyprus Mail'),
      },
    ],
  } satisfies FeedDef<NewsItem[]>,
  holidays: {
    id: 'holidays',
    title: 'Cyprus public holidays',
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    sources: [
      {
        name: 'Nager.Date public holidays',
        url: `https://date.nager.at/api/v3/PublicHolidays/${new Date().getFullYear()}/CY`,
        parse: async (r: Response) => {
          const a = (await r.json()) as HolidayItem[];
          try {
            const b = await (await fetchRetry(`https://date.nager.at/api/v3/PublicHolidays/${new Date().getFullYear() + 1}/CY`, { timeoutMs: 10000 }, 1)).json();
            return [...a, ...b] as HolidayItem[];
          } catch {
            return a;
          }
        },
      },
    ],
    after: (items: HolidayItem[]) => {
      mergeLiveHolidays(items.map((h) => ({ date: h.date, name: h.name, localName: h.localName })));
    },
  } satisfies FeedDef<HolidayItem[]>,
};

export type FeedId = keyof typeof FEEDS;

const listeners = new Set<(id: FeedId) => void>();
export function onFeed(fn: (id: FeedId) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const inflight = new Map<FeedId, Promise<FeedState<unknown>>>();

export async function readFeed<T>(id: FeedId): Promise<FeedState<T>> {
  const s = await raw.get<FeedState<T>>('feeds', id);
  const def = FEEDS[id] as FeedDef<T>;
  if (!s) return { id, data: null, fetchedAt: null, source: null, error: null, stale: true };
  return { ...s, stale: !s.fetchedAt || Date.now() - s.fetchedAt > def.ttlMs };
}

/** Fetches a feed now, trying each source in turn, then the firm's gateway; keeps the last good copy on failure. */
export function refreshFeed<T>(id: FeedId, force = false): Promise<FeedState<T>> {
  const running = inflight.get(id);
  // A forced refresh never settles for an automatic run that may have skipped a fresh-enough feed.
  if (running && !force) return running as Promise<FeedState<T>>;
  if (running && force) return running.catch(() => undefined).then(() => refreshFeed<T>(id, true));
  const p = (async () => {
    const def = FEEDS[id] as unknown as FeedDef<T>;
    const prev = await readFeed<T>(id);
    if (!force && prev.data && !prev.stale) return prev;
    if (!navigator.onLine) return { ...prev, error: 'offline' };
    const errors: string[] = [];
    for (const src of def.sources) {
      try {
        const res = await fetchRetry(src.url, { timeoutMs: 12000, mode: 'cors', credentials: 'omit', cache: 'no-store' }, 1);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await src.parse(res);
        const next: FeedState<T> = { id, data, fetchedAt: Date.now(), source: src.name, error: null, stale: false };
        await raw.put('feeds', id, next);
        def.after?.(data);
        listeners.forEach((l) => l(id));
        return next;
      } catch (e) {
        errors.push(`${src.name}: ${(e as Error).message}`);
      }
    }
    if (def.gatewayPath && gatewayConfigured()) {
      try {
        const data = await gateway<T>(def.gatewayPath);
        const next: FeedState<T> = { id, data, fetchedAt: Date.now(), source: 'Firm gateway mirror', error: null, stale: false };
        await raw.put('feeds', id, next);
        def.after?.(data);
        listeners.forEach((l) => l(id));
        return next;
      } catch (e) {
        errors.push(`gateway: ${(e as Error).message}`);
      }
    }
    const failed = { ...prev, error: errors.join(' · ') || 'all sources failed' };
    await raw.put('feeds', id, failed);
    listeners.forEach((l) => l(id));
    return failed;
  })().finally(() => inflight.delete(id));
  inflight.set(id, p as Promise<FeedState<unknown>>);
  return p;
}

/** Refreshes every feed; returns how many now hold fresh data and which ones failed. */
export async function refreshAll(force = false): Promise<{ ok: number; failed: string[] }> {
  const ids = Object.keys(FEEDS) as FeedId[];
  const started = Date.now();
  const results = await Promise.allSettled(ids.map((id) => refreshFeed(id, force)));
  const failed: string[] = [];
  let ok = 0;
  results.forEach((r, i) => {
    const st = r.status === 'fulfilled' ? r.value : null;
    if (st && st.data && (!force || (st.fetchedAt ?? 0) >= started) && !st.error) ok++;
    else failed.push(FEEDS[ids[i]].title);
  });
  return { ok, failed };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Keeps feeds fresh while the app is open; the service worker refreshes them in the background. */
export function startFeedLoop(): void {
  const tick = () => {
    if (document.visibilityState === 'visible') void refreshAll(false);
  };
  tick();
  timer ??= setInterval(tick, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('online', () => void refreshAll(true));
  // Apply cached holidays immediately, even offline.
  void readFeed<HolidayItem[]>('holidays').then((s) => s.data && FEEDS.holidays.after(s.data));
}
