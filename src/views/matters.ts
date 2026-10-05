import { debounce, h, icon, mount } from '../core/dom';
import { fmtDate, relTime } from '../core/dates';
import { locale, t } from '../core/i18n';
import { navigate, type RouteCtx } from '../core/router';
import { card, empty, field, toast, toggle } from '../core/ui';
import { createMatter, listMatters } from '../domain/matters';
import { hasRole } from '../core/licence';
import { latestCert, tally } from '../domain/rules';
import { BUYER_LANGS, STATUSES, type Lang, type Matter } from '../domain/types';
import { LANG_NAMES } from '../i18n/messages';
import { STATUS_LABEL, flagBadges, pageHead, statusBadge, steps } from './common';

export async function mattersView(ctx: RouteCtx): Promise<HTMLElement> {
  const all = await listMatters();
  let q = '';
  let filter = ctx.query.get('filter') ?? 'open';
  const host = h('div', { class: 'grid' });

  const matches = (m: Matter) => {
    if (filter === 'open' && m.status === 'closed') return false;
    if (filter === 'red' && !tally(m.findings).red) return false;
    if (filter === 'review' && !m.findings.some((f) => (f.severity === 'red' || f.severity === 'amber') && !m.reviews[f.key])) return false;
    if (STATUSES.includes(filter as never) && m.status !== filter) return false;
    if (!q) return true;
    const p = latestCert(m)?.property;
    const hay = [m.matterRef, m.firmRef, m.buyer.name, m.buyer.email, p?.district, p?.parcel, p?.registrationNo, p?.titleNumber, ...(latestCert(m)?.owners.map((o) => o.name) ?? [])].join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  };

  const draw = () => {
    const list = all.filter(matches);
    mount(
      host,
      list.length
        ? list.map((m) => {
            const p = latestCert(m)?.property;
            return h(
              'a',
              { class: 'matter-card', href: `#/matters/${m.id}` },
              h('div', { class: 'row-between' }, h('span', { class: 'ref' }, m.matterRef, m.firmRef ? ` · ${m.firmRef}` : ''), statusBadge(m.status)),
              h('strong', null, m.buyer.name || t('(no buyer name)')),
              h('small', { class: 'muted' }, p ? [p.district, p.parcel && `${t('plot')} ${p.parcel}`, p.registrationNo && `${t('reg.')} ${p.registrationNo}`].filter(Boolean).join(' · ') : t('No certificate yet')),
              steps(m.status),
              flagBadges(m),
              h('small', { class: 'muted' }, t('Updated {when}', { when: relTime(Date.parse(m.updatedAt)) }), ' · ', LANG_NAMES[m.buyer.lang]),
            );
          })
        : empty('folder', t('No matters match'), all.length ? t('Try another filter or search term.') : t('Open your first matter to begin.'), h('a', { class: 'btn btn-primary', href: '#/matters/new' }, icon('plus', 18), t('New matter'))),
    );
  };

  const search = h('input', { type: 'search', placeholder: t('Search by reference, buyer, owner, plot or registration number'), 'aria-label': t('Search matters') }) as HTMLInputElement;
  search.addEventListener('input', debounce(() => ((q = search.value.trim()), draw()), 120));
  const filters: [string, string][] = [
    ['open', t('Open')],
    ['review', t('To review')],
    ['red', t('Red flags')],
    ['reported', t('Reported')],
    ['all', t('All')],
  ];
  const seg = h('div', { class: 'seg', role: 'group' });
  const drawSeg = () =>
    mount(
      seg,
      filters.map(([k, l]) =>
        h(
          'button',
          {
            class: filter === k ? 'active' : '',
            onclick: () => {
              filter = k;
              drawSeg();
              draw();
            },
          },
          l,
        ),
      ),
    );
  drawSeg();
  draw();

  return h(
    'div',
    { class: 'stack' },
    pageHead(t('Matters'), t('Each matter is one purchase: certificates, contract, checks, report and deadlines, encrypted on this device.'), h('a', { class: 'btn btn-primary', href: '#/matters/new' }, icon('plus', 18), t('New matter'))),
    h(
      'div',
      { class: 'grid-4' },
      [
        ['folder', t('Open matters'), all.filter((m) => m.status !== 'closed').length, ''],
        ['scale', t('To review'), all.filter((m) => m.findings.some((f) => (f.severity === 'red' || f.severity === 'amber') && !m.reviews[f.key])).length, 'amber'],
        ['alert', t('Red flags'), all.reduce((n, m) => n + tally(m.findings).red, 0), 'red'],
        ['file', t('Reports issued'), all.filter((m) => m.report).length, 'green'],
      ].map(([i, l, v, tone]) => h('div', { class: `stat ${tone}` }, h('span', { class: 'label' }, icon(String(i), 16), String(l)), h('span', { class: 'value' }, String(v)))),
    ),
    h('div', { class: 'row' }, h('div', { style: { flex: '1 1 280px' } }, search), seg),
    host,
  );
}

export function newMatterView(): HTMLElement {
  const state = { firmRef: '', buyerName: '', buyerEmail: '', buyerPhone: '', buyerLang: 'en' as Lang, acts: true as boolean | null, high: false };
  const form = h(
    'form',
    { class: 'guide-split' },
    card(
      t('Matter details'),
      h(
      'div',
      { class: 'form-grid' },
      field({ label: hasRole('lawyer') ? t('Buyer’s name') : t('Matter name (e.g. project and unit, or borrower)'), required: true, autocomplete: 'name', onInput: (v) => (state.buyerName = v) }),
      field({ label: t('Your file reference'), placeholder: t('optional'), onInput: (v) => (state.firmRef = v) }),
      field({ label: t('Buyer’s language for the report'), value: 'en', options: BUYER_LANGS.map((l) => [l, LANG_NAMES[l]]), onInput: (v) => (state.buyerLang = v as Lang), hint: t('The report is always issued in Greek and English as well.') }),
      field({ label: t('Buyer’s email'), type: 'email', autocomplete: 'email', onInput: (v) => (state.buyerEmail = v) }),
      field({ label: t('Buyer’s mobile (international format)'), type: 'tel', placeholder: '+44…', autocomplete: 'tel', onInput: (v) => (state.buyerPhone = v), inputmode: 'tel' }),
      ),
      { icon: 'folder' },
    ),
    h('div', { class: 'stack' }, card(
      t('Before you start'),
      h(
        'div',
        { class: 'stack-sm' },
        toggle(t('This firm acts only for the buyer'), true, (v) => (state.acts = v), t('Not also for the seller or developer. If unsure, switch off and confirm later.')),
        toggle(t('High-value matter'), false, (v) => (state.high = v), t('Every reading is then routed to a person, whatever the confidence.')),
      ),
      { icon: 'shield' },
    ),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('check', 18), t('Open matter')), h('a', { class: 'btn', href: '#/matters' }, t('Cancel')))),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.buyerName.trim()) return toast(t('Enter the buyer’s name'), 'warn');
    const m = await createMatter({
      firmRef: state.firmRef.trim(),
      buyerName: state.buyerName.trim(),
      buyerEmail: state.buyerEmail.trim(),
      buyerPhone: state.buyerPhone.trim(),
      buyerLang: state.buyerLang,
      actsOnlyForBuyer: state.acts ? true : null,
      valueBand: state.high ? 'high' : 'standard',
    });
    toast(t('Matter {ref} opened', { ref: m.matterRef }), 'ok');
    navigate(`/matters/${m.id}?tab=documents`);
  });
  return h('div', { class: 'stack' }, pageHead(t('New matter'), t('Step 1 of the flow: open the matter, then upload the search certificate and the contract. Opened {date}.', { date: fmtDate(new Date().toISOString().slice(0, 10), locale()) })), form);
}

export { STATUS_LABEL };
