// The public-facing site for buyers, law firms, developers and banks. Buyers use everything here
// free; professionals buy a licence (paid to the licence store, not to any server we run) and then
// use Katharos Desk. Nothing here exposes internal planning, keys or integrations.
import { h, icon, mount } from '../core/dom';
import { sha256Hex } from '../core/crypto';
import { publicConfig, type Role } from '../core/config';
import { t } from '../core/i18n';
import { activateLicence, activeLicence, removeLicence, ROLE_LABEL } from '../core/licence';
import { isStandalone } from '../core/pwa';
import { current, navigate } from '../core/router';
import { canGoBack, goBack } from '../core/nav';
import { badge, bgrid, card, confirmDialog, dropZone, toast } from '../core/ui';
import { languagePicker } from '../app';
import { showInstallHelp } from './install';

const LINKS: [string, string][] = [
  ['/', 'Home'],
  ['/b', 'My report'],
  ['/firm', 'For professionals'],
  ['/verify', 'Verify'],
  ['/live', 'Live market'],
  ['/guide', 'Guide'],
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
        canGoBack() ? h('button', { class: 'icon-btn back-btn', title: t('Back'), 'aria-label': t('Back'), onclick: () => goBack() }, icon('arrowLeft')) : null,
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

const feature = (i: string, title: string, text: string) =>
  h('div', { class: 'integration' }, h('div', { class: 'row' }, h('span', { class: 'empty-icon', style: { width: '40px', height: '40px', borderRadius: '12px' } }, icon(i, 20)), h('strong', null, t(title))), h('small', null, t(text)));

export function landingView(): HTMLElement {
  const input = h('input', { type: 'url', placeholder: 'https://…#/b/…', 'aria-label': t('Your report link') }) as HTMLInputElement;
  const open = h(
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
  return h(
    'div',
    { class: 'stack' },
    h(
      'section',
      { class: 'hero' },
      h('h1', null, t('Buying property in Cyprus? Know exactly what you are signing.')),
      h('p', null, t('Katharos helps your lawyer check the Land Registry record for hidden mortgages, charges and deadlines — and explains the result to you in your own language, on your phone.')),
      open,
      h('small', null, t('Your report travels inside the link itself. It is encrypted, never stored on a server, and stays readable offline.')),
    ),
    bgrid([
      feature('shield', 'Checked line by line', 'Every owner, mortgage, memo, prohibition and earlier contract on the certificate is checked, and each point is linked to the Greek original.'),
      feature('globe', 'In your language', 'Greek, English, Turkish, Hebrew, French, Chinese, Arabic, Portuguese, Spanish, Italian, Russian and Ukrainian.'),
      feature('calendar', 'Deadlines that protect you', 'The five-working-day certificate window, the six-month deposit deadline and a fresh search before every payment.'),
      feature('wifiOff', 'Works anywhere', 'Install it on any phone or computer. It keeps working in airplane mode.'),
      feature('scale', 'Your lawyer stays in charge', 'Software reads the documents; your advocate reviews every finding and signs the report.'),
      feature('lock', 'Private by design', 'Encrypted on your device. Nothing is shared unless your lawyer sends it to you.'),
    ]),
    h('h2', null, t('Who Katharos is for')),
    bgrid([
      card(t('Buyers'), h('div', { class: 'stack-sm' }, h('p', null, t('Free. Open the link your lawyer sends you, read your report in your language, follow the deadlines and ask questions.')), h('a', { class: 'btn', href: '#/guide' }, icon('book', 16), t('How it works'))), { icon: 'users' }),
      card(t('Law firms'), h('div', { class: 'stack-sm' }, h('p', null, t('Read Greek search certificates and contracts, run the checks, issue multilingual reports in your name and watch every deadline.')), h('a', { class: 'btn btn-primary', href: '#/firm' }, icon('key', 16), t('Plans and sign-in'))), { icon: 'scale' }),
      card(t('Developers'), h('div', { class: 'stack-sm' }, h('p', null, t('Pre-check the title and document pack for each unit before sale, and hand buyers’ lawyers a clean, verifiable pack.')), h('a', { class: 'btn', href: '#/firm' }, icon('key', 16), t('Plans and sign-in'))), { icon: 'layers' }),
      card(t('Banks'), h('div', { class: 'stack-sm' }, h('p', null, t('Check the title of the collateral, see every registered charge and deadline, and verify reports issued by advocates.')), h('a', { class: 'btn', href: '#/firm' }, icon('key', 16), t('Plans and sign-in'))), { icon: 'coins' }),
    ]),
    card(t('Verify a report'), h('div', { class: 'stack-sm' }, h('p', null, t('Received a Katharos report or document pack? Check that it is exactly the one that was issued — free, on this device.')), h('a', { class: 'btn', href: '#/verify' }, icon('shield', 16), t('Verify'))), { icon: 'shield' }),
  );
}

const PLANS: { role: Role; icon: string; title: string; points: string[] }[] = [
  {
    role: 'lawyer',
    icon: 'scale',
    title: 'Law firms',
    points: ['Matters, Greek certificate and contract reading, all checks', 'Reports in Greek, English and the buyer’s language, issued in your name', 'Buyer portal links, deadline watch and reminders', 'Your own AI, OCR and messaging accounts — billed to you by those providers'],
  },
  {
    role: 'developer',
    icon: 'layers',
    title: 'Developers',
    points: ['Pre-check title, owners, mortgages and separate-title status per unit', 'Export encrypted, fingerprinted document packs for buyers’ lawyers', 'Deadline and fresh-search watch across your projects', 'Reports to buyers stay with their own lawyer'],
  },
  {
    role: 'bank',
    icon: 'coins',
    title: 'Banks',
    points: ['Check collateral titles: every mortgage, memo, prohibition and deposited contract', 'Import packs from lawyers and developers and verify their fingerprints', 'Watch for new entries before each drawdown', 'Everything stays encrypted on your own devices'],
  },
];

export async function firmView(): Promise<HTMLElement> {
  const [lic, cfg] = await Promise.all([activeLicence(), publicConfig()]);
  const plans = bgrid(
    PLANS.map((p) =>
      card(
        t(p.title),
        h(
          'div',
          { class: 'stack-sm' },
          h('ul', { class: 'features' }, p.points.map((x) => h('li', null, icon('check', 16), h('span', null, t(x))))),
          cfg.checkout[p.role] ? h('a', { class: 'btn btn-primary', href: cfg.checkout[p.role], target: '_blank', rel: 'noopener' }, icon('arrowRight', 16), t('Buy a licence')) : h('small', { class: 'muted' }, cfg.contact ? t('Contact {c} for a licence.', { c: cfg.contact }) : t('Licences are available on request.')),
        ),
        { icon: p.icon },
      ),
    ),
  );

  const status = lic
    ? card(
        t('Licensed to {firm}', { firm: lic.holder || '—' }),
        h(
          'div',
          { class: 'stack-sm' },
          h('div', { class: 'row' }, lic.roles.map((r) => badge(t(ROLE_LABEL[r]), 'teal')), badge(lic.exp ? t('Valid until {date}.', { date: lic.exp }) : t('No expiry date.'), 'neutral')),
          h(
            'div',
            { class: 'row' },
            h('a', { class: 'btn btn-primary', href: '#/desk' }, icon('arrowRight', 18), t('Open the Desk')),
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  if (await confirmDialog(t('Remove the licence from this device?'), t('The Desk will be locked on this device until a licence key is entered again. Matters stay encrypted on the device.'), t('Remove'), true)) {
                    await removeLicence();
                    navigate('/firm', true);
                  }
                },
              },
              t('Remove licence'),
            ),
          ),
        ),
        { icon: 'key' },
      )
    : (() => {
        const input = h('textarea', { rows: 3, placeholder: t('Paste your licence key'), 'aria-label': t('Licence key'), class: 'mono', spellcheck: 'false' }) as HTMLTextAreaElement;
        const msg = h('div');
        const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('unlock', 18), t('Activate')) as HTMLButtonElement;
        const form = h('form', { class: 'stack-sm' }, h('label', { class: 'field' }, h('span', null, t('Licence key')), input), msg, btn);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          btn.disabled = true;
          try {
            const l = await activateLicence(input.value);
            toast(t('Licensed to {firm}', { firm: l.holder || '—' }), 'ok');
            navigate('/desk');
          } catch (err) {
            mount(msg, h('div', { class: 'callout danger' }, icon('alert'), (err as Error).message));
          }
          btn.disabled = false;
        });
        return card(t('Activate a licence'), h('div', { class: 'stack-sm' }, form, h('small', { class: 'muted' }, t('The key arrives by email after purchase. Activating it registers this device; you can move it later by removing it here.'))), { icon: 'key' });
      })();

  const how = card(
    t('How licensing works'),
    h('ol', { class: 'install-steps' }, [t('Choose the plan for your organisation below and complete the purchase.'), t('Your licence key arrives by email straight away.'), t('Paste it here on each device you use; renewals and invoices are handled by the licence store.'), t('Connect your own AI, OCR and messaging accounts in Integrations — or use the free on-device tools.')].map((x) => h('li', null, h('span', null, x)))),
    { icon: 'info' },
  );
  return h(
    'div',
    { class: 'stack' },
    h('h1', null, t('For professionals')),
    h('p', { class: 'muted', style: { maxWidth: '75ch', margin: 0 } }, t('Katharos Desk is the professional workbench for Land Registry due diligence in Cyprus. Choose the plan for your organisation, then activate your licence key on each device you use.')),
    h('div', { class: 'guide-split' }, status, how),
    plans,
    h('div', { class: 'callout' }, icon('lock'), h('span', null, t('Your matters and documents never leave your devices unless you send them. AI reading, cloud OCR and messaging use your own accounts with those providers, so you control the data and the bill.'))),
  );
}

/** Free integrity check: does this file match the fingerprint printed on the report or pack? */
export function verifyView(): HTMLElement {
  const out = h('div');
  let fileHash = '';
  let fileName = '';
  const expected = h('input', { type: 'text', class: 'mono', placeholder: t('Fingerprint (64 characters)'), 'aria-label': t('Fingerprint') }) as HTMLInputElement;
  const compare = () => {
    const want = expected.value.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
    if (!fileHash) return;
    mount(
      out,
      h('div', { class: 'stack-sm' }, h('div', null, h('strong', null, fileName), h('div', null, h('code', null, fileHash))), !want ? h('small', { class: 'muted' }, t('Paste the fingerprint printed on the report or pack to compare.')) : want === fileHash ? h('div', { class: 'callout ok' }, icon('check'), t('Match — this file is exactly the one that was fingerprinted.')) : h('div', { class: 'callout danger' }, icon('alert'), t('No match — this file differs from the one that was fingerprinted.'))),
    );
  };
  expected.addEventListener('input', compare);
  return h(
    'div',
    { class: 'stack' },
    h('h1', null, t('Verify a report or pack')),
    h('p', { class: 'muted', style: { maxWidth: '75ch', margin: 0 } }, t('Check that a signed report PDF, a document pack or any evidence file is exactly the one that was issued. The file is checked on this device and never uploaded.')),
    h(
      'div',
      { class: 'guide-split' },
      card(
        t('Check a file'),
        h(
          'div',
          { class: 'stack' },
          dropZone(t('Choose the file to verify'), '*/*', async ([f]) => {
            fileName = f.name;
            fileHash = await sha256Hex(new Uint8Array(await f.arrayBuffer()));
            compare();
          }),
          h('label', { class: 'field' }, h('span', null, t('Fingerprint (SHA-256) stated by the issuer')), expected),
          out,
        ),
        { icon: 'shield' },
      ),
      card(
        t('How verification works'),
        h(
          'div',
          { class: 'stack-sm' },
          h('ol', { class: 'install-steps' }, [t('Every Katharos report, signed PDF and pack carries a SHA-256 fingerprint — a 64-character code unique to that exact file.'), t('Choose the file you received and paste the fingerprint the issuer gave you.'), t('If even one character of the file was changed, the fingerprints will not match.')].map((x) => h('li', null, h('span', null, x)))),
          h('div', { class: 'callout' }, icon('info'), h('span', null, t('A match proves the file was not changed. To confirm who issued it, also check the advocate’s qualified electronic signature (JCC) in your PDF reader.'))),
        ),
        { icon: 'info' },
      ),
    ),
  );
}
