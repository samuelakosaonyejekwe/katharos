// Self-explanatory guide: how it works, the rulebook, the glossary, limits, resilience and FAQ.
import { h, icon, mount } from '../core/dom';
import { fmtDate } from '../core/dates';
import { locale, t } from '../core/i18n';
import type { RouteCtx } from '../core/router';
import { settings } from '../core/settings';
import { bgrid, card, tabs } from '../core/ui';
import { LAW_AS_AT, RULEBOOK, RULE_VERSION } from '../domain/rules';
import { BUYER_LANGS, RTL, type Lang } from '../domain/types';
import { GLOSSARY, LANG_NAMES } from '../i18n/messages';
import { pageHead } from './common';
import { installWide } from './install';

const FLOW: [string, string, string][] = [
  ['Open the matter', 'Confirm the firm acts only for the buyer, pick the buyer’s language.', 'Lawyer'],
  ['Collect documents', 'Upload the search certificate “with encumbrances and prohibitions” (downloaded by you from the Land Registry portal), the contract, Form A or C, plans and permits.', 'Lawyer, buyer'],
  ['Read', 'Text layer or OCR reads the Greek; a second independent reading (AI or on-device OCR) is compared field by field. Handwriting and disagreements go to a person.', 'Katharos'],
  ['Structure', 'Owners, shares, every mortgage, memo, prohibition and deposited contract, dates and amounts — in one fixed format with page and line references.', 'Katharos'],
  ['Check', 'The rulebook marks each result red, amber or green. Rules decide; the AI only explains.', 'Katharos'],
  ['Review', 'Every finding sits next to its Greek source line. Accept, edit or reject. Nothing reaches the buyer without approval.', 'Lawyer'],
  ['Issue', 'Report in Greek, English and the buyer’s language, in the advocate’s name, with an AI-assistance statement and a SHA-256 fingerprint; sign with JCC.', 'Lawyer'],
  ['Explain', 'The buyer reads it in the portal on their phone, with a glossary, and sends questions to the lawyer.', 'Buyer, lawyer'],
  ['Track', 'Five-working-day window, six-month deposit deadline, staged payments, tax clearance and transfer — with reminders.', 'Katharos'],
  ['Watch', 'Before each payment and before deposit, a fresh certificate is compared with the last; any new entry raises an alarm.', 'Lawyer, Katharos'],
  ['Close', 'The audit trail is sealed; files are kept according to the firm’s retention policy.', 'Katharos'],
];

const LIMITS: [string, string][] = [
  ['Only advocates may give legal opinions', 'Katharos is a tool for law firms. Every buyer-facing report is the advocate’s own opinion, issued in their name; the AI never answers the buyer on its own (Advocates Law, Cap. 2).'],
  ['No Land Registry API', 'Certificates can be requested online only by the owner, their attorney or their lawyer. Katharos works on the documents the lawyer downloads and uploads.'],
  ['Greek handwriting', 'No OCR reads Greek handwriting reliably. Handwritten notes are always flagged for a person.'],
  ['AI mistakes', 'Two independent readings, a fixed format, a confidence threshold of 0.90 and mandatory lawyer review. The release target is zero missed encumbrances on an annotated test set.'],
  ['Data protection', 'Client data is encrypted on the device. Cloud processing for real matters goes through the firm’s EU gateway (Bedrock EU, Azure EU). Client data is never used for training.'],
  ['EU AI Act', 'Not a high-risk use (Annex III). Reports state that AI assisted (Art. 50); firms give users AI-literacy training (Art. 4). Katharos never scores creditworthiness.'],
  ['Changing law', 'Every rule is versioned and owned by a named advocate. Each finding records the rule version and the date of the law it applied.'],
  ['What the certificate cannot show', 'Planning violations, tax compliance, unregistered tenants, unpaid local fees and unregistered lawsuits — always listed as “lawyer to confirm”.'],
  ['WhatsApp rules', 'Only opt-in, neutral status messages leave the platform. Legal content stays in the portal.'],
  ['Certified translations', 'Where an official certified translation is required, a certified translator still provides it. Katharos speeds that up; it does not replace it.'],
];

const RESILIENCE: [string, string, string][] = [
  ['wifiOff', 'Works with no connection', 'The whole app is cached on the device by a service worker. Matters, documents, checks, reports, calendar and the Greek OCR pack (once cached) run in airplane mode.'],
  ['layers', 'Runs from several hosts', 'The same build is published to more than one independent static host. If one host — or GitHub — is down, the others serve it; an installed app keeps running from the device even if every host is down.'],
  ['refresh', 'Fresh data without a server', 'Each user’s browser fetches live data straight from public sources (ECB, Eurostat, news, holidays), with fallback sources and the last good copy. Installed apps also refresh in the background where the browser supports it.'],
  ['plug', 'No single point of failure in the integrations', 'A backup AI model, Azure OCR with on-device OCR as the final fallback, and device links (wa.me, mailto) whenever a messaging account is not connected or unavailable.'],
  ['lock', 'Data stays yours', 'Everything is encrypted with your passphrase (AES-256-GCM, PBKDF2 600,000 rounds), and an optional passkey adds a second factor. Export encrypted backups any time and restore them on any device.'],
  ['sparkle', 'Always the latest version', 'The app checks for a new version when opened and every 30 minutes, downloads it in the background and asks before switching — never mid-task.'],
];

export function guideView(ctx: RouteCtx, mode: 'public' | 'firm' = 'firm'): HTMLElement {
  let tab = ctx.query.get('tab') ?? 'how';
  if (mode === 'public' && (tab === 'rules' || tab === 'limits')) tab = 'how';
  let glossLang: Lang = 'en';

  const glance: [string, string, string][] = [
    ['shield', '16', 'Checks on every certificate'],
    ['globe', '12', 'Languages for reports and the portal'],
    ['calendar', '5 · 6', 'Working-day window · months to deposit'],
    ['wifiOff', '100%', 'Works offline once installed'],
  ];
  const faqs: [string, string][] = [
    ['Where is my data?', 'On your own device, encrypted with your passphrase. It leaves the device only when you send something — a buyer link, a pack — or use one of your own connected accounts, such as AI reading.'],
    ['What if I lose my passphrase?', 'It cannot be recovered. Export encrypted backups regularly from Settings and keep the passphrase in a password manager.'],
    ['How do I move to a new computer or phone?', 'Settings → Export backup on the old device, then Settings → Restore on the new one, with the same passphrase.'],
    ['Can colleagues share matters?', 'Export an encrypted matter file or pack and send it securely; the colleague imports it in Settings. Each person keeps their own encrypted vault.'],
    ['Is it legal advice?', 'No. Katharos is software. Reports to buyers are the advocate’s own opinion, issued in their name.'],
    ['Does the buyer need an account?', 'No. They open an encrypted link (optionally with a PIN) on any phone; it can be installed and read offline.'],
    ['Who pays for what?', 'Buyers use Katharos free. Law firms, developers and banks buy a licence; AI, cloud OCR and messaging run on their own accounts with those providers.'],
    ['Which browsers work?', 'Current Chrome, Edge, Safari (iOS 16.4+, macOS), Firefox and Samsung Internet — on Windows, macOS, Linux, ChromeOS, Android and iOS/iPadOS.'],
  ];

  const views: Record<string, () => HTMLElement> = {
    how: () =>
      h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'guide-split' },
          card(
            t('Katharos in one paragraph'),
            h('div', { class: 'stack' }, h('p', { style: { margin: 0 } }, t('Katharos Title Desk (from the Greek καθαρός, “clean”, as in a clean title) helps Cypriot conveyancing lawyers protect buyers from hidden mortgages, charges and deadline risk between reservation and transfer. It reads the Greek Land Registry search certificate and the contract, extracts every owner, mortgage, memo, prohibition and deposited contract, runs a fixed set of checks written by advocates, and shows each finding next to the exact Greek line it came from. Once the lawyer approves, it issues a report in Greek, English and the buyer’s own language, and tracks every deadline until the contract is deposited and the title transferred.')),
              h(
                'div',
                { class: 'principles' },
                [
                  ['scale', 'Rules decide, AI only explains'],
                  ['search', 'Every finding linked to its Greek source line'],
                  ['pen', 'The advocate approves every report'],
                ].map(([i, x]) => h('div', { class: 'principle' }, icon(i, 18), h('span', null, t(x)))),
              ),
            ),
            { icon: 'shield' },
          ),
          card(t('At a glance'), h('div', { class: 'glance' }, glance.map(([i, v, l]) => h('div', { class: 'glance-item' }, icon(i, 20), h('strong', null, v), h('small', null, t(l))))), { icon: 'sparkle' }),
        ),
        card(
          t('How a matter flows'),
          h('ol', { class: 'flow-grid' }, FLOW.map(([a, b, who], i) => h('li', null, h('span', { class: 'flow-n' }, String(i + 1)), h('div', null, h('strong', null, t(a)), h('div', null, h('small', { class: 'muted' }, t(who))), h('small', null, t(b)))))),
          { icon: 'arrowRight' },
        ),
        card(
          t('Who uses Katharos'),
          bgrid(
            [
              ['users', 'Buyers', 'Free. The lawyer-issued report in their own language, a timeline, a glossary and questions to the lawyer — on any phone, offline.'],
              ['scale', 'Law firms', 'Katharos Desk: matters, findings beside the Greek source, approval, multilingual reports, deadlines and an audit trail.'],
              ['layers', 'Developers', 'Pre-check the title and document pack for each unit and hand buyers’ lawyers an encrypted, fingerprinted pack.'],
              ['coins', 'Banks', 'Check collateral titles, watch for new entries before each drawdown and verify reports issued by advocates.'],
            ].map(([i, a, b]) => h('div', { class: 'integration' }, h('div', { class: 'row' }, icon(i, 18), h('strong', null, t(a))), h('small', null, t(b)))),
          ),
          { icon: 'users' },
        ),
      ),
    rules: () =>
      card(
        t('Rulebook {v} · law as at {d}', { v: RULE_VERSION, d: fmtDate(LAW_AS_AT, locale()) }),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, t('Check')), h('th', null, t('What it catches')), h('th', null, t('Basis')), h('th', null, t('Owner')))),
            h('tbody', null, RULEBOOK.map((r) => h('tr', null, h('td', null, h('strong', null, t(r.title)), h('br'), h('code', null, r.id)), h('td', null, t(r.catches)), h('td', null, r.basis), h('td', null, settings().legalPanel || t(r.owner))))),
          ),
        ),
        { icon: 'scale', help: t('Each rule is deterministic, tested code. A rule changes only when the law or Land Registry practice changes, with a new version number and release notes.') },
      ),
    glossary: () => {
      const host = h('div');
      const draw = () =>
        mount(
          host,
          h(
            'div',
            { class: 'stack' },
            h(
              'div',
              { class: 'row-between' },
              h('p', { class: 'muted', style: { margin: 0 } }, t('Land Registry terms as they appear on Greek documents, explained in plain language.')),
              (() => {
                const sel = h('select', { style: { width: 'auto' }, 'aria-label': t('Language') }, BUYER_LANGS.map((l) => h('option', { value: l, selected: l === glossLang }, LANG_NAMES[l]))) as HTMLSelectElement;
                sel.addEventListener('change', () => ((glossLang = sel.value as Lang), draw()));
                return sel;
              })(),
            ),
            h('div', { dir: RTL.includes(glossLang) ? 'rtl' : 'ltr', lang: glossLang }, bgrid(GLOSSARY.map((g) => h('section', { class: 'card card-body stack-sm' }, h('strong', null, g.tr[glossLang] ?? g.tr.en), h('span', { class: 'el', lang: 'el', dir: 'ltr' }, g.el), h('small', null, g.def[glossLang] ?? g.def.en))))),
          ),
        );
      draw();
      return host;
    },
    limits: () => bgrid(LIMITS.map(([a, b]) => h('section', { class: 'card card-body stack-sm' }, h('strong', null, icon('alert', 16), ' ', t(a)), h('small', null, t(b))))),
    resilience: () => bgrid(RESILIENCE.map(([i, a, b]) => card(t(a), h('p', null, t(b)), { icon: i }))),
    install: () => installWide(),
    faq: () => bgrid(faqs.map(([q, a]) => h('section', { class: 'card card-body stack-sm' }, h('strong', null, icon('info', 16), ' ', t(q)), h('small', null, t(a))))),
  };

  const root = h('div', { class: 'stack' });
  const render = () =>
    mount(
      root,
      pageHead(mode === 'firm' ? t('Guide & rulebook') : t('Guide'), t('Everything Katharos does, why, and where it stops.')),
      tabs(
        [
          { id: 'how', label: t('How it works') },
          { id: 'rules', label: t('Rulebook'), firm: true },
          { id: 'glossary', label: t('Glossary') },
          { id: 'limits', label: t('Limits'), firm: true },
          { id: 'resilience', label: t('Offline & resilience') },
          { id: 'install', label: t('Install') },
          { id: 'faq', label: t('FAQ') },
        ].filter((x) => mode === 'firm' || !x.firm),
        tab,
        (id) => {
          tab = id;
          history.replaceState(null, '', `#${mode === 'firm' ? '/desk/guide' : '/guide'}?tab=${id}`);
          render();
        },
      ),
      views[tab](),
    );
  render();
  return root;
}
