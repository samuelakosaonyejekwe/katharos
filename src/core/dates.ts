// Cyprus business-day calendar. Computed locally (works offline for any year 1900–2099),
// then cross-checked against live public-holiday data when the device is online.

export type ISODate = string; // YYYY-MM-DD

export function iso(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function todayISO(): ISODate {
  const now = new Date();
  return iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Calendar months, clamped to month end (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

/** Orthodox Easter Sunday (Gregorian date), Meeus Julian algorithm + 13 days. */
export function orthodoxEaster(year: number): ISODate {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return iso(julian);
}

export interface Holiday {
  date: ISODate;
  name: string;
  nameEl: string;
  /** statutory = public holiday for everyone; service = public-service / bank only (offices may close). */
  scope: 'statutory' | 'service';
}

const cache = new Map<number, Holiday[]>();
const liveExtra = new Map<ISODate, Holiday>();

export function cyprusHolidays(year: number): Holiday[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const e = orthodoxEaster(year);
  const f = (md: string) => `${year}-${md}`;
  const list: Holiday[] = [
    { date: f('01-01'), name: "New Year's Day", nameEl: 'Πρωτοχρονιά', scope: 'statutory' },
    { date: f('01-06'), name: 'Epiphany', nameEl: 'Θεοφάνεια', scope: 'statutory' },
    { date: addDays(e, -48), name: 'Green Monday', nameEl: 'Καθαρή Δευτέρα', scope: 'statutory' },
    { date: f('03-25'), name: 'Greek Independence Day', nameEl: 'Εθνική Επέτειος', scope: 'statutory' },
    { date: f('04-01'), name: 'Cyprus National Day', nameEl: 'Εθνική Επέτειος ΕΟΚΑ', scope: 'statutory' },
    { date: addDays(e, -2), name: 'Orthodox Good Friday', nameEl: 'Μεγάλη Παρασκευή', scope: 'statutory' },
    { date: addDays(e, 1), name: 'Orthodox Easter Monday', nameEl: 'Δευτέρα της Λαμπρής', scope: 'statutory' },
    { date: addDays(e, 2), name: 'Orthodox Easter Tuesday', nameEl: 'Τρίτη της Λαμπρής', scope: 'service' },
    { date: f('05-01'), name: 'Labour Day', nameEl: 'Πρωτομαγιά', scope: 'statutory' },
    { date: addDays(e, 50), name: 'Kataklysmos (Whit Monday)', nameEl: 'Κατακλυσμός', scope: 'statutory' },
    { date: f('08-15'), name: 'Assumption', nameEl: 'Κοίμηση της Θεοτόκου', scope: 'statutory' },
    { date: f('10-01'), name: 'Cyprus Independence Day', nameEl: 'Ημέρα Κυπριακής Ανεξαρτησίας', scope: 'statutory' },
    { date: f('10-28'), name: 'Ochi Day', nameEl: 'Επέτειος του Όχι', scope: 'statutory' },
    { date: f('12-24'), name: 'Christmas Eve', nameEl: 'Παραμονή Χριστουγέννων', scope: 'service' },
    { date: f('12-25'), name: 'Christmas Day', nameEl: 'Χριστούγεννα', scope: 'statutory' },
    { date: f('12-26'), name: 'Boxing Day', nameEl: 'Δεύτερη μέρα Χριστουγέννων', scope: 'statutory' },
  ].sort((x, y) => x.date.localeCompare(y.date)) as Holiday[];
  cache.set(year, list);
  return list;
}

/** Adds holidays reported by a live source that the local calendar does not know (e.g. ad-hoc days). */
export function mergeLiveHolidays(items: { date: ISODate; name: string; localName?: string }[]): string[] {
  const added: string[] = [];
  for (const it of items) {
    const year = Number(it.date.slice(0, 4));
    if (cyprusHolidays(year).some((h) => h.date === it.date)) continue;
    const day = parseISO(it.date).getUTCDay();
    if (day === 0 || day === 6) continue;
    if (!liveExtra.has(it.date)) {
      liveExtra.set(it.date, { date: it.date, name: it.name, nameEl: it.localName ?? it.name, scope: 'service' });
      added.push(it.date);
    }
  }
  return added;
}

export function holidayOn(date: ISODate, includeService: boolean): Holiday | undefined {
  const h = cyprusHolidays(Number(date.slice(0, 4))).find((x) => x.date === date) ?? liveExtra.get(date);
  if (!h) return undefined;
  return h.scope === 'statutory' || includeService ? h : undefined;
}

export function isWorkingDay(date: ISODate, includeService = true): boolean {
  const dow = parseISO(date).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidayOn(date, includeService);
}

/**
 * Working days separating two dates, in either order: counts each working day after the
 * earlier date up to and including the later one. Same day = 0.
 */
export function workingDaysApart(a: ISODate, b: ISODate, includeService = true): number {
  let [from, to] = a <= b ? [a, b] : [b, a];
  let n = 0;
  while (from < to) {
    from = addDays(from, 1);
    if (isWorkingDay(from, includeService)) n++;
  }
  return n;
}

export function addWorkingDays(start: ISODate, n: number, includeService = true): ISODate {
  let d = start;
  let left = n;
  const step = n >= 0 ? 1 : -1;
  while (left !== 0) {
    d = addDays(d, step);
    if (isWorkingDay(d, includeService)) left -= step;
  }
  return d;
}

const DATE_RX = [
  /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/, // 05/03/2026 (Cypriot day-first)
  /\b(\d{4})-(\d{2})-(\d{2})\b/, // ISO
];

/** Parses the first date in a string (day-first, as used in Cyprus). */
export function findDate(text: string): ISODate | null {
  const m1 = text.match(DATE_RX[0]);
  if (m1) {
    const [d, m, y] = [Number(m1[1]), Number(m1[2]), Number(m1[3])];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const m2 = text.match(DATE_RX[1]);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

export function fmtDate(s: ISODate | null | undefined, locale = 'en-GB'): string {
  if (!s) return '—';
  try {
    return parseISO(s).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return s;
  }
}

export function relTime(ms: number, locale = 'en'): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
