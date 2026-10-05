import { h, s } from '../core/dom';
import { daysBetween, fmtDate, parseISO, todayISO } from '../core/dates';
import { locale, t } from '../core/i18n';
import { badge } from '../core/ui';
import { tally } from '../domain/rules';
import { STATUSES, type Matter, type MatterStatus } from '../domain/types';

export const STATUS_LABEL: Record<MatterStatus, string> = {
  instructed: 'Instructed',
  searching: 'Searching',
  extracted: 'Documents read',
  reviewed: 'Reviewed',
  reported: 'Report issued',
  deposited: 'Contract deposited',
  transferred: 'Title transferred',
  closed: 'Closed',
};

export function statusBadge(st: MatterStatus): HTMLElement {
  const tone = st === 'closed' || st === 'transferred' ? 'green' : st === 'reported' || st === 'deposited' ? 'teal' : 'neutral';
  return badge(t(STATUS_LABEL[st]), tone);
}

export function steps(st: MatterStatus): HTMLElement {
  const idx = STATUSES.indexOf(st);
  return h('div', { class: 'steps', title: t(STATUS_LABEL[st]), 'aria-label': t(STATUS_LABEL[st]) }, STATUSES.slice(0, 7).map((_, i) => h('span', { class: i <= idx ? 'on' : '' })));
}

export function flagBadges(m: Matter): HTMLElement {
  const c = tally(m.findings);
  const unreviewed = m.findings.filter((f) => (f.severity === 'red' || f.severity === 'amber') && !m.reviews[f.key]).length;
  return h(
    'div',
    { class: 'flags' },
    c.red ? badge(`${c.red} ${t('red')}`, 'red') : null,
    c.amber ? badge(`${c.amber} ${t('amber')}`, 'amber') : null,
    c.green ? badge(`${c.green} ${t('green')}`, 'green') : null,
    unreviewed ? badge(t('{n} to review', { n: unreviewed }), 'info') : null,
  );
}

export function dateChip(iso: string): HTMLElement {
  const d = parseISO(iso);
  const left = daysBetween(todayISO(), iso);
  const tone = left < 0 ? 'red' : left <= 7 ? 'amber' : '';
  return h(
    'div',
    { class: `date-chip ${tone}`, title: fmtDate(iso, locale()) },
    h('b', null, String(d.getUTCDate())),
    h('span', null, d.toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' })),
  );
}

export function dueText(iso: string): string {
  const left = daysBetween(todayISO(), iso);
  if (left === 0) return t('due today');
  if (left < 0) return t('{n} days overdue', { n: -left });
  return t('in {n} days', { n: left });
}

/** Small dependency-free line chart. */
export function sparkline(points: { label: string; value: number }[], opts: { height?: number } = {}): SVGElement {
  const W = 600;
  const H = opts.height ?? 140;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  if (points.length < 2) return s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}` });
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const ticks = [min, min + span / 2, max];
  return s(
    'svg',
    { class: 'spark', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': points.map((p) => `${p.label}: ${p.value}`).join(', '), preserveAspectRatio: 'none' },
    ticks.map((tv) => [s('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: y(tv), y2: y(tv) }), s('text', { x: 2, y: y(tv) + 3 }, tv.toFixed(0))]),
    s('path', { class: 'area', d: area }),
    s('path', { class: 'line', d }),
    points.map((p, i) => (i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 4) === 0 ? s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' }, p.label) : null)),
    s('circle', { cx: x(points.length - 1), cy: y(vals.at(-1)!), r: 4, fill: 'var(--primary)' }),
  );
}

export function pageHead(title: string, sub?: string, actions?: Node | Node[] | null): HTMLElement {
  return h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), actions ? h('div', { class: 'row' }, actions) : null);
}
