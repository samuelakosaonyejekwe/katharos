import { h, icon, mount } from '../core/dom';
import { cyprusHolidays, holidayOn, iso, isWorkingDay, todayISO, workingDaysApart, addWorkingDays, fmtDate } from '../core/dates';
import { locale, t, uiLang } from '../core/i18n';
import { enableNotifications } from '../core/pwa';
import type { RouteCtx } from '../core/router';
import { card, empty, field, toast } from '../core/ui';
import { allDeadlines, type Deadline } from '../domain/matters';
import { dateChip, dueText, pageHead } from './common';

export async function deadlinesView(ctx: RouteCtx): Promise<HTMLElement> {
  const all = await allDeadlines();
  const open = all.filter((d) => !d.done);
  const today = todayISO();
  let month = ctx.query.get('m') ?? today.slice(0, 7);
  const calHost = h('div');

  const drawCal = () => {
    const [y, mo] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const start = new Date(first);
    start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7)); // Monday-first
    const days: HTMLElement[] = [];
    const dows = [...Array(7)].map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' }));
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const ds = iso(d);
      const hol = holidayOn(ds, true);
      const items = all.filter((x) => x.due === ds);
      days.push(
        h(
          'div',
          { class: `day ${ds.slice(0, 7) !== month ? 'out' : ''} ${[0, 6].includes(d.getUTCDay()) ? 'weekend' : ''} ${hol ? 'holiday' : ''} ${ds === today ? 'today' : ''}` },
          h('span', { class: 'n' }, String(d.getUTCDate())),
          hol ? h('span', { class: 'chip hol', title: hol.name }, uiLang() === 'el' ? hol.nameEl : hol.name) : null,
          items.map((x) => h('a', { class: `chip ${!x.done && x.due < today ? 'red' : ''}`, href: `#/matters/${x.matterId}?tab=deadlines`, title: `${x.matterRef}: ${x.label}` }, `${x.matterRef} ${x.label}`)),
        ),
      );
    }
    const shift = (n: number) => {
      const d = new Date(Date.UTC(y, mo - 1 + n, 1));
      month = iso(d).slice(0, 7);
      drawCal();
    };
    mount(
      calHost,
      h(
        'div',
        { class: 'stack-sm' },
        h('div', { class: 'row-between' }, h('button', { class: 'btn btn-sm', onclick: () => shift(-1), 'aria-label': t('Previous month') }, icon('arrowLeft', 16)), h('strong', null, first.toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })), h('button', { class: 'btn btn-sm', onclick: () => shift(1), 'aria-label': t('Next month') }, icon('arrowRight', 16))),
        h('div', { class: 'cal' }, dows.map((d) => h('div', { class: 'dow' }, d)), days),
      ),
    );
  };
  drawCal();

  const group = (title: string, list: Deadline[], tone: string) =>
    list.length ? card(title, h('div', { class: 'list' }, list.map((d) => h('a', { class: 'list-item', href: `#/matters/${d.matterId}?tab=deadlines` }, dateChip(d.due), h('div', { class: 'grow' }, h('div', { class: 'title' }, d.label), h('small', { class: 'muted' }, `${d.matterRef} · ${dueText(d.due)}`))))), { icon: tone === 'red' ? 'alert' : 'calendar' }) : null;

  // Working-day calculator (the five-day certificate window), usable on its own.
  const out = h('div', { class: 'callout' });
  let a = today;
  let b = addWorkingDays(today, 5);
  const calc = () => {
    const strict = workingDaysApart(a, b, true);
    const lenient = workingDaysApart(a, b, false);
    mount(out, icon('calendar'), h('span', null, strict === lenient ? t('{n} working days apart.', { n: strict }) : t('{s} working days counting public-service holidays as closed, {l} counting statutory holidays only.', { s: strict, l: lenient }), ' ', strict <= 5 ? t('Inside the five-working-day window.') : t('Outside the five-working-day window.')));
  };
  calc();

  const year = Number(today.slice(0, 4));
  const holidays = cyprusHolidays(year).filter((x) => x.date >= today).slice(0, 6);

  return h(
    'div',
    { class: 'stack' },
    pageHead(
      t('Deadlines'),
      t('Every clock across your matters: certificate windows, deposit deadlines, staged payments and the fresh searches before them.'),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            const p = await enableNotifications();
            toast(p === 'granted' ? t('Reminders on — you will be notified 3 days ahead, even with the app closed where the browser allows.') : t('Notifications are not allowed in this browser.'), p === 'granted' ? 'ok' : 'warn', 6000);
          },
        },
        icon('bell', 18),
        t('Enable reminders'),
      ),
    ),
    open.length ? null : empty('calendar', t('No open deadlines'), t('They appear automatically once a certificate or contract is read.')),
    h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, group(t('Overdue'), open.filter((d) => d.due < today), 'red'), group(t('Next 30 days'), open.filter((d) => d.due >= today && d.due <= iso(new Date(Date.parse(today) + 30 * 864e5))), ''), group(t('Later'), open.filter((d) => d.due > iso(new Date(Date.parse(today) + 30 * 864e5))), '')), card(t('Calendar'), calHost, { icon: 'calendar' })),
    h(
      'div',
      { class: 'grid-2' },
      card(
        t('Working-day calculator'),
        h('div', { class: 'stack-sm' }, h('div', { class: 'form-grid' }, field({ label: t('Certificate date'), type: 'date', value: a, onInput: (v) => ((a = v || a), calc()) }), field({ label: t('Signing date'), type: 'date', value: b, onInput: (v) => ((b = v || b), calc()) })), out),
        { icon: 'clock', help: t('Law 81(I)/2011 s.4(1A): the certificate must be dated within five working days of signing, before or after. Weekends and Cyprus public holidays (including Orthodox Easter) are not working days.') },
      ),
      card(t('Coming public holidays'), h('div', { class: 'list' }, holidays.map((x) => h('div', { class: 'list-item' }, dateChip(x.date), h('div', { class: 'grow' }, h('div', { class: 'title' }, uiLang() === 'el' ? x.nameEl : x.name), h('small', { class: 'muted' }, x.scope === 'service' ? t('Public service / banks closed') : t('Public holiday')))))), { icon: 'calendar', help: t('Computed on this device for any year, and cross-checked against a live public-holiday source when online.') }),
    ),
    h('small', { class: 'muted' }, t('Today: {d} · {w}', { d: fmtDate(today, locale()), w: isWorkingDay(today) ? t('working day') : t('not a working day') })),
  );
}
