// The public-facing site: what anyone may see and use without a firm licence — the landing page,
// the buyer portal entry, the public guide and the live market. Nothing here exposes firm tools,
// integrations, business figures or internal documentation.
import { h, icon, mount } from '../core/dom';
import { t } from '../core/i18n';
import { activateLicence, activeLicence, removeLicence } from '../core/licence';
import { isStandalone } from '../core/pwa';
import { current, navigate } from '../core/router';
import { card, confirmDialog, toast } from '../core/ui';
import { languagePicker } from '../app';
import { showInstallHelp } from './install';

const LINKS: [string, string][] = [
  ['/', 'Home'],
  ['/b', 'My report'],
  ['/live', 'Live market'],
  ['/guide', 'Guide'],
  ['/firm', 'For law firms'],
];

export function publicShell(root: HTMLElement, content: Node): void {
  const cur = current().path;
  mount(
    root,
    h(
      'div',
      { class: 'public' },
      h(
        'header',
        { class: 'public-head' },
        h('a', { class: 'brand', href: '#/' }, h('img', { src: './icons/icon.svg', alt: '' }), h('span', null, h('strong', null, 'Katharos'), h('small', { class: 'muted' }, t('Clean title, clearly explained')))),
        h('nav', { class: 'public-nav', 'aria-label': t('Main') }, LINKS.map(([p, l]) => h('a', { href: `#${p}`, class: cur === p || (p !== '/' && cur.startsWith(p)) ? 'active' : '' }, t(l)))),
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, languagePicker(), !isStandalone() ? h('button', { class: 'btn btn-sm btn-accent', onclick: () => showInstallHelp() }, icon('install', 16), h('span', { class: 'hide-mobile' }, t('Install app'))) : null),
      ),
      h('main', { class: 'content public-content', id: 'content' }, content),
      h('footer', { class: 'public-foot' }, h('small', { class: 'muted' }, t('Katharos does not give legal advice. Reports are issued by the advocate who acts for you.'))),
    ),
  );
  const heading = (content as HTMLElement).querySelector?.('h1');
  document.title = heading?.textContent ? `${heading.textContent} · Katharos` : 'Katharos';
  window.scrollTo({ top: 0 });
}

export function landingView(): HTMLElement {
  const openLink = () => {
    const input = h('input', { type: 'url', placeholder: 'https://…#/b/…', 'aria-label': t('Your report link') }) as HTMLInputElement;
    return h(
      'form',
      {
        class: 'row',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const m = input.value.match(/#\/b\/(.+)$/);
          if (m) location.hash = `#/b/${m[1]}`;
          else toast(t('Paste the full link your lawyer sent you'), 'warn');
        },
      },
      h('div', { style: { flex: '1 1 260px' } }, input),
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('file', 18), t('Open my report')),
    );
  };
  const feature = (i: string, title: string, text: string) => h('div', { class: 'integration' }, h('div', { class: 'row' }, h('span', { class: 'empty-icon', style: { width: '40px', height: '40px', borderRadius: '12px' } }, icon(i, 20)), h('strong', null, t(title))), h('small', null, t(text)));
  return h(
    'div',
    { class: 'stack' },
    h(
      'section',
      { class: 'hero' },
      h('h1', null, t('Buying property in Cyprus? Know exactly what you are signing.')),
      h('p', null, t('Katharos helps your lawyer check the Land Registry record for hidden mortgages, charges and deadlines — and explains the result to you in your own language, on your phone.')),
      openLink(),
      h('small', null, t('Your report travels inside the link itself. It is encrypted, never stored on a server, and stays readable offline.')),
    ),
    h(
      'div',
      { class: 'grid' },
      feature('shield', 'Checked line by line', 'Every owner, mortgage, memo, prohibition and earlier contract on the certificate is checked, and each point is linked to the Greek original.'),
      feature('globe', 'In your language', 'Greek, English, Turkish, Hebrew, French, Chinese, Arabic, Portuguese, Spanish, Italian, Russian and Ukrainian.'),
      feature('calendar', 'Deadlines that protect you', 'The five-working-day certificate window, the six-month deposit deadline and a fresh search before every payment.'),
      feature('wifiOff', 'Works anywhere', 'Install it on any phone or computer. It keeps working in airplane mode.'),
      feature('scale', 'Your lawyer stays in charge', 'Software reads the documents; your advocate reviews every finding and signs the report.'),
      feature('lock', 'Private by design', 'Encrypted on your device. Nothing is shared unless your lawyer sends it to you.'),
    ),
    h(
      'div',
      { class: 'grid-2' },
      card(t('For buyers'), h('div', { class: 'stack-sm' }, h('p', null, t('Ask your conveyancing lawyer to use Katharos. When your report is ready you receive a link — open it here, install the app, and read it any time.')), h('a', { class: 'btn', href: '#/guide' }, icon('book', 16), t('How it works'))), { icon: 'users' }),
      card(t('For law firms'), h('div', { class: 'stack-sm' }, h('p', null, t('Katharos Desk is available to licensed law firms. If your firm has a licence key, activate it on this device.')), h('a', { class: 'btn btn-primary', href: '#/firm' }, icon('key', 16), t('Firm sign-in'))), { icon: 'scale' }),
    ),
  );
}

export async function firmView(): Promise<HTMLElement> {
  const lic = await activeLicence();
  if (lic) {
    return h(
      'div',
      { class: 'stack', style: { maxWidth: '640px' } },
      h('h1', null, t('Katharos Desk')),
      card(
        t('Licensed to {firm}', { firm: lic.firm }),
        h(
          'div',
          { class: 'stack-sm' },
          h('p', { class: 'muted' }, lic.exp ? t('Valid until {date}.', { date: lic.exp }) : t('No expiry date.')),
          h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/desk' }, icon('arrowRight', 18), t('Open the Desk')), h('button', { class: 'btn', onclick: async () => { if (await confirmDialog(t('Remove the licence from this device?'), t('The Desk will be locked on this device until a licence key is entered again. Matters stay encrypted on the device.'), t('Remove'), true)) { removeLicence(); navigate('/firm'); } } }, t('Remove licence'))),
        ),
        { icon: 'key' },
      ),
    );
  }
  const input = h('textarea', { rows: 3, placeholder: 'KTH1.…', 'aria-label': t('Licence key'), class: 'mono', spellcheck: 'false' }) as HTMLTextAreaElement;
  const msg = h('div');
  const form = h(
    'form',
    { class: 'stack-sm' },
    h('label', { class: 'field' }, h('span', null, t('Licence key')), input),
    msg,
    h('button', { class: 'btn btn-primary', type: 'submit' }, icon('unlock', 18), t('Activate')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const l = await activateLicence(input.value);
      toast(t('Licensed to {firm}', { firm: l.firm }), 'ok');
      navigate('/desk');
    } catch (err) {
      mount(msg, h('div', { class: 'callout danger' }, icon('alert'), (err as Error).message));
    }
  });
  return h(
    'div',
    { class: 'stack', style: { maxWidth: '640px' } },
    h('h1', null, t('For law firms')),
    h('p', { class: 'muted' }, t('Katharos Desk — the lawyer workbench for Land Registry due diligence — is available to licensed law firms only. Enter the licence key you received to use it on this device.')),
    card(t('Activate a licence'), form, { icon: 'key' }),
    h('div', { class: 'callout' }, icon('lock'), h('span', null, t('The key is checked on this device; matters and documents are encrypted with a passphrase only you know.'))),
  );
}
