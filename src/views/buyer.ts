// Katharos Buyer: the portal a buyer opens from their lawyer's link — any phone, any
// language, no account, and readable offline once opened. The data travels inside the link.
import { h, icon, mount } from '../core/dom';
import { daysBetween, fmtDate, todayISO } from '../core/dates';
import { canPromptInstall, isStandalone, promptInstall } from '../core/pwa';
import { modal } from '../core/ui';
import { needsPin, openPack, type BuyerPack } from '../domain/share';
import { RTL, STATUSES, ALL_LANGS, type Lang } from '../domain/types';
import { GLOSSARY, LANG_NAMES, ui } from '../i18n/messages';
import { installInstructions } from './install';

const SAVED = 'katharos.buyer.links';

function savedLinks(): { token: string; ref: string; at: string }[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? '[]');
  } catch {
    return [];
  }
}

function remember(token: string, ref: string): void {
  try {
    const list = savedLinks().filter((l) => l.token !== token);
    list.unshift({ token, ref, at: new Date().toISOString() });
    localStorage.setItem(SAVED, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* private mode */
  }
}

function guessLang(): Lang {
  const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return (ALL_LANGS as string[]).includes(n) ? (n as Lang) : 'en';
}

export async function buyerPortal(token: string): Promise<HTMLElement> {
  const root = h('div', { class: 'portal' });
  document.title = 'Katharos';
  if (!token) {
    renderEmpty(root);
    return root;
  }
  if (needsPin(token)) {
    renderPin(root, token);
    return root;
  }
  try {
    renderPack(root, await openPack(token), token);
  } catch {
    renderError(root);
  }
  return root;
}

function renderEmpty(root: HTMLElement): void {
  const lang = guessLang();
  const input = h('input', { type: 'url', placeholder: 'https://…#/b/…', 'aria-label': 'Link' }) as HTMLInputElement;
  mount(
    root,
    h('div', { class: 'portal-hero' }, h('h1', null, ui('portal', lang)), h('small', null, ui('notAdvice', lang))),
    h('div', { class: 'card card-body stack-sm' }, input, h('button', { class: 'btn btn-primary', onclick: () => { const m = input.value.match(/#\/b\/(.+)$/); if (m) location.hash = `#/b/${m[1]}`; } }, ui('open', lang))),
    savedLinks().length ? h('div', { class: 'card card-body' }, h('div', { class: 'list' }, savedLinks().map((l) => h('a', { class: 'list-item', href: `#/b/${l.token}` }, icon('file', 18), h('div', { class: 'grow' }, h('div', { class: 'title' }, l.ref), h('small', { class: 'muted' }, fmtDate(l.at.slice(0, 10)))))))) : null,
  );
}

function renderError(root: HTMLElement): void {
  const lang = guessLang();
  mount(root, h('div', { class: 'portal-hero' }, h('h1', null, ui('portal', lang))), h('div', { class: 'callout danger' }, icon('alert'), ui('wrongPin', lang)));
}

function renderPin(root: HTMLElement, token: string): void {
  const lang = guessLang();
  const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'one-time-code', 'aria-label': ui('enterPin', lang) }) as HTMLInputElement;
  const msg = h('div');
  const form = h('form', { class: 'card card-body stack-sm' }, h('label', null, ui('enterPin', lang)), pin, msg, h('button', { class: 'btn btn-primary', type: 'submit' }, icon('unlock', 18), ui('open', lang)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      renderPack(root, await openPack(token, pin.value.trim()), token);
    } catch {
      mount(msg, h('div', { class: 'callout danger' }, icon('alert'), ui('wrongPin', lang)));
    }
  });
  mount(root, h('div', { class: 'portal-hero' }, h('h1', null, ui('portal', lang)), h('small', null, ui('notAdvice', lang))), form);
  pin.focus();
}

function renderPack(root: HTMLElement, pack: BuyerPack, token: string): void {
  remember(token, `${pack.matterRef} · ${pack.property.slice(0, 40)}`);
  let lang: Lang = (() => {
    try {
      const saved = localStorage.getItem('katharos.buyer.lang') as Lang | null;
      if (saved && (ALL_LANGS as string[]).includes(saved)) return saved;
    } catch {
      /* ignore */
    }
    return pack.lang;
  })();

  const draw = () => {
    const contentLang: Lang = pack.langs.includes(lang) ? lang : pack.lang;
    const dir = RTL.includes(lang) ? 'rtl' : 'ltr';
    root.setAttribute('dir', dir);
    root.setAttribute('lang', lang);
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
    const statusIdx = STATUSES.indexOf(pack.status);
    const byTone = (s: string) => pack.findings.filter((f) => f.severity === s);
    const langSel = h('select', { 'aria-label': ui('language', lang), style: { width: 'auto', background: 'rgb(255 255 255 / 14%)', color: '#fff', borderColor: 'transparent' } }, ALL_LANGS.map((l) => h('option', { value: l, selected: l === lang, style: { color: '#111' } }, LANG_NAMES[l]))) as HTMLSelectElement;
    langSel.addEventListener('change', () => {
      lang = langSel.value as Lang;
      try {
        localStorage.setItem('katharos.buyer.lang', lang);
      } catch {
        /* ignore */
      }
      draw();
    });
    const question = h('textarea', { rows: 3, placeholder: ui('ask', lang), dir: 'auto' }) as HTMLTextAreaElement;
    const qText = () => `${pack.matterRef}: ${question.value.trim()}`;

    mount(
      root,
      h(
        'div',
        { class: 'portal-hero' },
        h('div', { class: 'row-between' }, h('small', null, pack.firm || 'Katharos'), langSel),
        h('h1', { style: { margin: '4px 0' } }, ui('portal', lang)),
        h('div', null, pack.property),
        pack.issuedAt ? h('small', null, ui('issuedBy', lang, { name: pack.advocate.name, date: fmtDate(pack.issuedAt.slice(0, 10)) })) : null,
        h(
          'div',
          { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn btn-sm', onclick: () => window.print() }, icon('printer', 16), ui('print', lang)),
          !isStandalone() ? h('button', { class: 'btn btn-sm', onclick: async () => { if (canPromptInstall()) await promptInstall(); else modal(ui('install', lang), installInstructions()); } }, icon('install', 16), ui('install', lang)) : null,
        ),
      ),
      h('div', { class: 'callout ok' }, icon('wifiOff'), ui('savedOffline', lang)),
      h(
        'section',
        { class: 'card card-body' },
        h('h2', null, ui('timeline', lang)),
        h('ol', { class: 'timeline' }, STATUSES.slice(0, 7).map((s, i) => h('li', { class: i < statusIdx ? 'done' : i === statusIdx ? 'now' : '' }, h('span', { class: 'node' }, i < statusIdx ? icon('check', 14) : String(i + 1)), h('div', null, ui(`st_${s}`, lang))))),
      ),
      pack.deadlines.length
        ? h(
            'section',
            { class: 'card card-body' },
            h('h2', null, ui('deadlines', lang)),
            h('div', { class: 'list' }, pack.deadlines.map((d) => h('div', { class: 'list-item' }, icon(d.done ? 'check' : 'calendar', 18), h('div', { class: 'grow' }, h('div', { class: 'title' }, d.label[contentLang] ?? d.label[pack.lang] ?? ''), h('small', { class: 'muted' }, fmtDate(d.due), !d.done && daysBetween(todayISO(), d.due) >= 0 ? ` · ${daysBetween(todayISO(), d.due)}d` : ''))))),
          )
        : null,
      h(
        'section',
        { class: 'card card-body stack-sm' },
        h('h2', null, ui('report', lang)),
        contentLang !== lang ? h('small', { class: 'muted' }, LANG_NAMES[contentLang]) : null,
        ['red', 'amber', 'info', 'green'].flatMap((sev) =>
          byTone(sev).map((f) => h('article', { class: `finding ${sev}` }, h('div', { class: 'bar' }), h('div', { class: 'body' }, h('div', { class: 'meta' }, h('strong', null, ui(`severity_${sev}`, lang))), h('div', { class: 'text', dir: RTL.includes(contentLang) ? 'rtl' : 'ltr', lang: contentLang }, f.note ?? f.text[contentLang] ?? f.text[pack.lang] ?? '')))),
        ),
        h('small', { class: 'muted' }, ui('aiNotice', lang)),
        h('small', { class: 'muted' }, ui('translationNotice', lang)),
        pack.fingerprint ? h('small', { class: 'mono muted' }, `${ui('fingerprint', lang)}: ${pack.fingerprint}`) : null,
      ),
      pack.answers.length ? h('section', { class: 'card card-body' }, h('h2', null, ui('questions', lang)), pack.answers.map((a) => h('div', { class: 'term' }, h('strong', { dir: 'auto' }, a.q), h('div', { dir: 'auto', style: { whiteSpace: 'pre-wrap' } }, a.a)))) : null,
      h(
        'section',
        { class: 'card card-body stack-sm' },
        h('h2', null, ui('questions', lang)),
        question,
        h(
          'div',
          { class: 'row' },
          pack.advocate.email ? h('a', { class: 'btn btn-primary', href: '#', onclick: (e: Event) => { e.preventDefault(); if (question.value.trim()) location.href = `mailto:${encodeURIComponent(pack.advocate.email)}?subject=${encodeURIComponent(pack.matterRef)}&body=${encodeURIComponent(qText())}`; } }, icon('mail', 16), ui('sendEmail', lang)) : null,
          pack.advocate.phone ? h('a', { class: 'btn', href: '#', onclick: (e: Event) => { e.preventDefault(); if (question.value.trim()) window.open(`https://wa.me/${pack.advocate.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(qText())}`, '_blank', 'noopener'); } }, icon('message', 16), ui('sendWhatsApp', lang)) : null,
        ),
        h('small', { class: 'muted' }, ui('notAdvice', lang)),
      ),
      h('section', { class: 'card card-body' }, h('h2', null, ui('glossary', lang)), GLOSSARY.map((g) => h('div', { class: 'term' }, h('strong', null, g.tr[lang] ?? g.tr.en), ' ', h('span', { class: 'el', lang: 'el' }, `(${g.el})`), h('div', { class: 'muted' }, g.def[lang] ?? g.def.en)))),
      h('p', { class: 'muted', style: { textAlign: 'center' } }, h('small', null, 'Katharos')),
    );
  };
  draw();
}
