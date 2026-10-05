// Katharos Desk — the lawyer's workbench for one matter.
import { h, icon, mount, type Child } from '../core/dom';
import { randomId, sha256Hex } from '../core/crypto';
import { addWorkingDays, fmtDate, relTime, todayISO } from '../core/dates';
import { getFile } from '../core/db';
import { locale, t, uiLang } from '../core/i18n';
import { navigate, type RouteCtx } from '../core/router';
import { settings } from '../core/settings';
import { badge, card, confirmDialog, copyText, downloadBlob, dropZone, empty, field, kv, modal, progressBar, severityTone, spinner, tabs, toast, toggle } from '../core/ui';
import { appendEvent, verifyChain } from '../domain/audit';
import { actor, addEvidence, deadlinesOf, deleteMatter, getMatter, saveMatter } from '../domain/matters';
import { readCertificate, readContract } from '../domain/reader';
import { buildReport, issueReport, reportLangs, severityLabel, unreviewed } from '../domain/report';
import { RULEBOOK, latestCert, previousCert, tally } from '../domain/rules';
import { buildPack, packLink } from '../domain/share';
import { findingText } from '../domain/text';
import { BUYER_LANGS, RTL, STATUSES, type CertOrigin, type Certificate, type Decision, type EncumbranceKind, type Evidence, type EvidenceKind, type Finding, type Lang, type Matter, type MatterStatus, type SourceRef } from '../domain/types';
import { aiAvailable, aiDraftAnswer, aiExplain } from '../integrations/ai';
import { gatewayConfigured } from '../integrations/http';
import { NEUTRAL, SUBJECT, mailLink, notifyBuyer, waLink } from '../integrations/messaging';
import { renderPdfPage } from '../integrations/ocr';
import { screenName } from '../integrations/screening';
import { GLOSSARY, LANG_NAMES, msg, ui } from '../i18n/messages';
import { STATUS_LABEL, dateChip, dueText, pageHead, statusBadge, steps } from './common';

const fl = (): Lang => uiLang() as Lang;

type Tab = 'overview' | 'documents' | 'facts' | 'findings' | 'report' | 'deadlines' | 'watch' | 'buyer' | 'audit';

export async function matterView(ctx: RouteCtx): Promise<HTMLElement> {
  const m = await getMatter(ctx.params.id);
  if (!m) return empty('folder', t('Matter not found'), t('It may have been deleted on another device or tab.'), h('a', { class: 'btn', href: '#/matters' }, t('All matters')));
  let tab = (ctx.query.get('tab') as Tab) ?? 'overview';
  const root = h('div', { class: 'stack' });
  const body = h('div');

  const redraw = async () => {
    const counts = tally(m.findings);
    const pending = unreviewed(m).length;
    const tabItems = [
      { id: 'overview', label: t('Overview') },
      { id: 'documents', label: t('Documents'), count: m.evidence.length },
      { id: 'facts', label: t('Facts') },
      { id: 'findings', label: t('Findings'), count: pending || counts.red, tone: pending ? 'red' : counts.red ? 'red' : '' },
      { id: 'report', label: t('Report & share') },
      { id: 'deadlines', label: t('Deadlines') },
      { id: 'watch', label: t('Watch'), count: m.certificates.length },
      { id: 'buyer', label: t('Buyer'), count: m.questions.filter((q) => !q.answer).length, tone: 'amber' },
      { id: 'audit', label: t('Audit trail') },
    ];
    mount(
      root,
      pageHead(
        `${m.matterRef} · ${m.buyer.name}`,
        [m.firmRef && `${t('Firm ref.')} ${m.firmRef}`, `${t('Opened')} ${fmtDate(m.instructedAt.slice(0, 10), locale())}`, `${t('Report language')}: ${LANG_NAMES[m.buyer.lang]}`].filter(Boolean).join(' · '),
        [statusBadge(m.status)],
      ),
      m.notes.startsWith('SAMPLE') ? h('div', { class: 'callout warn' }, icon('info'), m.notes) : null,
      tabs(tabItems, tab, (id) => {
        tab = id as Tab;
        history.replaceState(null, '', `#/matters/${m.id}?tab=${id}`);
        void redraw();
      }),
      body,
    );
    mount(body, spinner());
    const views: Record<Tab, () => Promise<Node> | Node> = {
      overview: () => overview(m, go),
      documents: () => documents(m, redraw),
      facts: () => facts(m, redraw),
      findings: () => findings(m, redraw),
      report: () => report(m, redraw),
      deadlines: () => deadlinesTab(m),
      watch: () => watch(m, go),
      buyer: () => buyerTab(m, redraw),
      audit: () => audit(m),
    };
    mount(body, await views[tab]());
  };
  const go = (id: Tab) => {
    tab = id;
    history.replaceState(null, '', `#/matters/${m.id}?tab=${id}`);
    void redraw();
  };
  await redraw();
  return root;
}

// ------------------------------------------------------------------ overview

function nextSteps(m: Matter): { label: string; done: boolean; tab: Tab }[] {
  const cert = latestCert(m);
  const deadline = deadlinesOf(m).find((d) => d.kind === 'fresh-search' && !d.done);
  return [
    { label: t('Upload the search certificate “with encumbrances and prohibitions”'), done: Boolean(cert), tab: 'documents' },
    { label: t('Upload the draft contract (and Form A or C)'), done: m.evidence.some((e) => e.kind === 'contract'), tab: 'documents' },
    { label: t('Check the facts read from the documents'), done: Boolean(m.contract.signedOn || m.contract.sellers.length), tab: 'facts' },
    { label: t('Decide every red and amber finding'), done: Boolean(cert) && unreviewed(m).length === 0, tab: 'findings' },
    { label: t('Issue the report in Greek, English and {lang}', { lang: LANG_NAMES[m.buyer.lang] }), done: Boolean(m.report), tab: 'report' },
    { label: t('Share the report with the buyer'), done: m.events.some((e) => e.kind === 'buyer.shared'), tab: 'report' },
    { label: deadline ? t('Fresh search before {what}', { what: fmtDate(deadline.due, locale()) }) : t('Fresh search before each payment and before deposit'), done: !deadline, tab: 'watch' },
    { label: t('Deposit the contract at the District Lands Office'), done: Boolean(m.contract.depositedOn), tab: 'facts' },
  ];
}

function overview(m: Matter, go: (t: Tab) => void): HTMLElement {
  const cert = latestCert(m);
  const c = tally(m.findings);
  const statusSel = h('select', { 'aria-label': t('Status') }, STATUSES.map((s) => h('option', { value: s, selected: m.status === s }, t(STATUS_LABEL[s])))) as HTMLSelectElement;
  statusSel.addEventListener('change', async () => {
    const from = m.status;
    m.status = statusSel.value as MatterStatus;
    await appendEvent(m, actor(), 'status.changed', { from, to: m.status });
    await saveMatter(m, false);
    toast(t('Status updated'), 'ok');
  });
  const ns = nextSteps(m);
  const nextIdx = ns.findIndex((s) => !s.done);
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'grid-4' },
      h('button', { class: `stat ${c.red ? 'red' : 'green'}`, onclick: () => go('findings') }, h('span', { class: 'label' }, t('Red')), h('span', { class: 'value' }, String(c.red))),
      h('button', { class: `stat ${c.amber ? 'amber' : ''}`, onclick: () => go('findings') }, h('span', { class: 'label' }, t('Amber')), h('span', { class: 'value' }, String(c.amber))),
      h('button', { class: 'stat green', onclick: () => go('findings') }, h('span', { class: 'label' }, t('Green')), h('span', { class: 'value' }, String(c.green))),
      h('button', { class: 'stat', onclick: () => go('deadlines') }, h('span', { class: 'label' }, t('Next deadline')), h('span', { class: 'value', style: { fontSize: '1.1rem' } }, deadlinesOf(m).find((d) => !d.done) ? fmtDate(deadlinesOf(m).find((d) => !d.done)!.due, locale()) : '—')),
    ),
    h(
      'div',
      { class: 'grid-2' },
      card(
        t('What to do next'),
        h(
          'ol',
          { class: 'timeline' },
          ns.map((s, i) => h('li', { class: s.done ? 'done' : i === nextIdx ? 'now' : '' }, h('span', { class: 'node' }, s.done ? icon('check', 16) : String(i + 1)), h('div', null, h('button', { class: 'btn btn-ghost btn-sm', style: { padding: 0, minHeight: 0, whiteSpace: 'normal', textAlign: 'start' }, onclick: () => go(s.tab) }, s.label)))),
        ),
        { icon: 'arrowRight', help: t('The guided flow: open, collect, read, structure, check, review, issue, explain, track, watch, close.') },
      ),
      card(
        t('Summary'),
        h(
          'div',
          { class: 'stack' },
          kv([
            [t('Buyer'), `${m.buyer.name}${m.buyer.email ? ` · ${m.buyer.email}` : ''}${m.buyer.phone ? ` · ${m.buyer.phone}` : ''}`],
            [t('Property'), cert ? [cert.property.district, cert.property.municipality, cert.property.sheet && `${t('sheet/plan')} ${cert.property.sheet}/${cert.property.plan ?? '?'}`, cert.property.parcel && `${t('plot')} ${cert.property.parcel}`].filter(Boolean).join(' · ') : t('No certificate yet')],
            [t('Registered owners'), cert?.owners.map((o) => `${o.name} (${o.share})`).join(', ') || '—'],
            [t('Release route'), { A: t('Form A'), B: t('Form B'), C: t('Form C (no release protection)'), none: t('No mortgage'), unknown: t('Not established') }[m.releaseRoute]],
            [t('Contract'), m.contract.signedOn ? t('Signed {date}', { date: fmtDate(m.contract.signedOn, locale()) }) : t('Not signed yet')],
            [t('Deposit'), m.contract.depositedOn ? t('Deposited {date}', { date: fmtDate(m.contract.depositedOn, locale()) }) : t('Not deposited')],
            [t('Lawyer independence'), m.actsOnlyForBuyer ? badge(t('Acts only for the buyer'), 'green') : m.actsOnlyForBuyer === false ? badge(t('Conflict'), 'red') : badge(t('To confirm'), 'amber')],
            [t('Rulebook'), `${m.ruleVersion} · ${t('law as at')} ${fmtDate(m.lawAsAt, locale())}`],
          ]),
          steps(m.status),
          h('div', { class: 'field' }, h('label', null, t('Status')), statusSel),
        ),
        { icon: 'folder' },
      ),
    ),
    card(
      t('Notes'),
      (() => {
        const ta = h('textarea', { rows: 3, placeholder: t('Private notes for the firm (not shared with the buyer)') }, m.notes) as HTMLTextAreaElement;
        ta.addEventListener('change', async () => {
          m.notes = ta.value;
          await saveMatter(m, false);
          toast(t('Saved'), 'ok', 1500);
        });
        return ta;
      })(),
      { icon: 'pen' },
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', onclick: () => exportMatter(m) }, icon('download', 18), t('Export matter file')),
      h(
        'button',
        {
          class: 'btn btn-ghost',
          onclick: async () => {
            if (await confirmDialog(t('Delete this matter?'), t('The matter, its documents and its audit trail will be deleted from this device. Export it first if the firm’s retention policy requires.'), t('Delete'), true)) {
              await deleteMatter(m.id);
              toast(t('Matter deleted'), 'ok');
              navigate('/matters');
            }
          },
        },
        icon('trash', 18),
        t('Delete matter'),
      ),
    ),
  );
}

async function exportMatter(m: Matter): Promise<void> {
  const pass = await promptPassword();
  if (!pass) return;
  const files: Record<string, string> = {};
  for (const ev of m.evidence) {
    const f = await getFile(ev.id);
    if (f)
      files[ev.id] = await new Promise<string>((r) => {
        const fr = new FileReader();
        fr.onload = () => r(String(fr.result));
        fr.readAsDataURL(f);
      });
  }
  const { sealExport } = await import('../core/backup');
  downloadBlob(await sealExport({ matter: m, files }, pass, 'katharos-matter'), `${m.matterRef}.katharos.json`);
  await appendEvent(m, actor(), 'matter.exported', { encrypted: true });
  await saveMatter(m, false);
  toast(t('Encrypted matter file saved — send the password separately'), 'ok');
}

function promptPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    const p = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 }) as HTMLInputElement;
    let done = false;
    const md = modal(
      t('Protect the matter file'),
      h('div', { class: 'stack-sm' }, h('p', { class: 'muted' }, t('The file is encrypted with this password. Share the password by a different channel.')), h('div', { class: 'field' }, h('label', null, t('Password (10+ characters)')), p)),
      [
        h('button', { class: 'btn', onclick: () => md.close() }, t('Cancel')),
        h('button', { class: 'btn btn-primary', onclick: () => { if (p.value.length < 10) return toast(t('Use at least 10 characters'), 'warn'); done = true; md.close(); resolve(p.value); } }, t('Export')),
      ],
      { onClose: () => !done && resolve(null) },
    );
    p.focus();
  });
}

// ------------------------------------------------------------------ documents

const KIND_LABEL: Record<EvidenceKind, string> = {
  search_certificate: 'Search certificate',
  contract: 'Sale contract',
  form_a: 'Form A',
  form_c: 'Form C',
  plan: 'Plot or title plan',
  permit: 'Permit',
  seller_authority: 'Seller’s authority',
  buyer_document: 'Buyer document',
  signed_report: 'Signed report',
  other: 'Other',
};

function documents(m: Matter, redraw: () => Promise<void>): HTMLElement {
  let kind: EvidenceKind = latestCert(m) ? 'contract' : 'search_certificate';
  let source: Evidence['source'] = 'registry';
  let origin: CertOrigin = 'downloaded_by_buyer_lawyer';
  let autoRead = true;
  const progressHost = h('div');

  const run = async (ev: Evidence) => {
    const pb = progressBar();
    mount(progressHost, card(t('Reading {name}', { name: ev.filename }), pb.el, { icon: 'scan' }));
    try {
      if (ev.kind === 'search_certificate') {
        const c = await readCertificate(m, ev, origin, (s, f) => pb.set(f ?? 0, t(s)));
        toast(t('Certificate read: {n} entries, confidence {c}%', { n: c.encumbrances.length, c: Math.round(c.confidence * 100) }), c.confidence >= 0.9 ? 'ok' : 'warn');
      } else if (ev.kind === 'contract' || ev.kind === 'form_a' || ev.kind === 'form_c') {
        const r = await readContract(m, ev, (s, f) => pb.set(f ?? 0, t(s)));
        toast(r.filled.length ? t('Contract read — filled: {f}', { f: r.filled.join(', ') }) : t('Contract read — nothing new to fill'), 'ok');
      }
    } catch (e) {
      toast(t('Reading failed: {e}', { e: (e as Error).message }), 'error', 8000);
    }
    mount(progressHost);
    await redraw();
  };

  const onFiles = async (files: File[]) => {
    for (const f of files) {
      if (f.size > 40 * 1024 * 1024) {
        toast(t('{name} is larger than 40 MB', { name: f.name }), 'warn');
        continue;
      }
      const ev = await addEvidence(m, f, kind, source);
      toast(t('Stored and fingerprinted: {name}', { name: f.name }), 'ok', 2000);
      if (autoRead && ['search_certificate', 'contract', 'form_a', 'form_c'].includes(kind)) await run(ev);
    }
    await redraw();
  };

  const kindSel = field({ label: t('Document type'), value: kind, options: (Object.keys(KIND_LABEL) as EvidenceKind[]).map((k) => [k, t(KIND_LABEL[k])]), onInput: (v) => (kind = v as EvidenceKind) });
  const srcSel = field({
    label: t('Where it came from'),
    value: source,
    options: [
      ['registry', t('Land Registry portal (downloaded by us)')],
      ['firm', t('Our firm')],
      ['client', t('The buyer')],
      ['other', t('Seller’s side / other')],
    ],
    onInput: (v) => {
      source = v as Evidence['source'];
      origin = v === 'registry' ? 'downloaded_by_buyer_lawyer' : v === 'other' ? 'supplied_by_seller' : 'unknown';
    },
    hint: t('Certificates supplied by the seller’s side are flagged.'),
  });

  const list = m.evidence.length
    ? h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, t('Document')), h('th', null, t('Type')), h('th', { class: 'hide-mobile' }, t('Fingerprint (SHA-256)')), h('th', null, t('Received')), h('th', null, ''))),
          h(
            'tbody',
            null,
            [...m.evidence].reverse().map((ev) => {
              const readable = ['search_certificate', 'contract', 'form_a', 'form_c'].includes(ev.kind);
              const read = m.certificates.some((c) => c.evidenceId === ev.id) || (ev.kind !== 'search_certificate' && Boolean(ev.text));
              return h(
                'tr',
                null,
                h('td', null, h('strong', null, ev.filename), h('br'), h('small', { class: 'muted' }, `${(ev.size / 1024).toFixed(0)} KB${ev.pages ? ` · ${ev.pages} ${t('pages')}` : ''}`)),
                h('td', null, t(KIND_LABEL[ev.kind]), read ? h('div', null, badge(t('read'), 'green')) : null),
                h('td', { class: 'hide-mobile' }, h('code', { title: ev.sha256 }, `${ev.sha256.slice(0, 16)}…`)),
                h('td', null, h('small', null, relTime(Date.parse(ev.receivedAt)))),
                h(
                  'td',
                  { class: 'num' },
                  h(
                    'div',
                    { class: 'row', style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
                    readable ? h('button', { class: 'btn btn-sm', onclick: () => run(ev), title: t('Read again') }, icon('scan', 16), h('span', { class: 'hide-mobile' }, read ? t('Re-read') : t('Read'))) : null,
                    h('button', { class: 'btn btn-sm', onclick: () => viewSource(m, { evidenceId: ev.id, page: 1, line: 0, text: '' }), title: t('View') }, icon('eye', 16)),
                    h('button', { class: 'btn btn-sm', onclick: async () => { const f = await getFile(ev.id); if (f) downloadBlob(f, ev.filename); }, title: t('Download') }, icon('download', 16)),
                  ),
                ),
              );
            }),
          ),
        ),
      )
    : empty('file', t('No documents yet'), t('Upload the Land Registry search certificate first — ideally downloaded by you from the Land Registry portal.'));

  return h(
    'div',
    { class: 'stack' },
    card(
      t('Add documents'),
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'form-grid' }, kindSel, srcSel),
        toggle(t('Read automatically after upload'), true, (v) => (autoRead = v), t('Two independent readings are compared field by field; anything uncertain goes to a person.')),
        dropZone(t('Upload documents'), 'application/pdf,image/*,text/plain', onFiles),
        h('div', { class: 'callout' }, icon('lock'), h('span', null, t('Each file is encrypted and fingerprinted (SHA-256) before anything reads it, so the evidence record exists even if a later step fails.'))),
      ),
      { icon: 'upload', help: t('Search certificates can only be ordered online by the owner, their attorney or their lawyer. There is no Land Registry API, so download the PDF from the portal and upload it here.') },
    ),
    progressHost,
    card(t('Evidence'), list, { icon: 'file' }),
  );
}

/** Side-by-side source viewer: the document page beside the extracted lines, with the finding’s line highlighted. */
export async function viewSource(m: Matter, ref: SourceRef): Promise<void> {
  const ev = m.evidence.find((e) => e.id === ref.evidenceId);
  if (!ev) return toast(t('Source document not found'), 'warn');
  const file = await getFile(ev.id);
  const textHost = h('div', { class: 'pagetext' });
  const pageHost = h('div', { class: 'canvas-wrap' });
  let page = Math.max(1, ref.page || 1);
  const total = ev.text?.length ?? ev.pages ?? 1;
  const pager = h('div', { class: 'row' });
  const draw = async () => {
    const pt = ev.text?.find((p) => p.page === page);
    mount(
      textHost,
      pt
        ? pt.lines.map((line, i) => {
            const hl = page === ref.page && (i + 1 === ref.line || (ref.text && line.replace(/\s+/g, ' ').trim() === ref.text.trim()));
            const el = h('div', { class: hl ? 'hl' : '' }, h('span', { class: 'ln' }, String(i + 1)), line);
            if (hl) setTimeout(() => el.scrollIntoView({ block: 'center' }), 50);
            return el;
          })
        : h('div', null, t('No extracted text for this page yet — read the document first.')),
    );
    mount(pageHost);
    if (file?.type === 'application/pdf') {
      const canvas = h('canvas') as HTMLCanvasElement;
      pageHost.append(canvas);
      try {
        await renderPdfPage(file, page, canvas, Math.min(560, pageHost.clientWidth || 560));
      } catch {
        mount(pageHost, h('p', { class: 'muted', style: { padding: '12px' } }, t('Could not render this page.')));
      }
    } else if (file?.type.startsWith('image/')) {
      pageHost.append(h('img', { src: URL.createObjectURL(file), alt: ev.filename, style: { width: '100%' } }));
    } else {
      pageHost.append(h('p', { class: 'muted', style: { padding: '12px' } }, t('Text document — see the extracted lines.')));
    }
    mount(
      pager,
      h('button', { class: 'btn btn-sm', disabled: page <= 1, onclick: () => (page--, draw()) }, icon('arrowLeft', 16)),
      h('span', null, t('Page {p} of {n}', { p: page, n: total })),
      h('button', { class: 'btn btn-sm', disabled: page >= total, onclick: () => (page++, draw()) }, icon('arrowRight', 16)),
    );
  };
  modal(`${ev.filename}`, h('div', { class: 'stack' }, ref.text ? h('div', { class: 'callout' }, icon('search'), h('span', null, t('Highlighted: '), h('code', null, ref.text))) : null, pager, h('div', { class: 'viewer' }, pageHost, textHost), h('small', { class: 'muted' }, `SHA-256 ${ev.sha256}`)), null, { wide: true });
  await draw();
}

// ------------------------------------------------------------------ facts (structured data, editable)

function facts(m: Matter, redraw: () => Promise<void>): HTMLElement {
  const cert = latestCert(m);
  const c = m.contract;
  const changes: string[] = [];
  const set = <T>(label: string, apply: (v: T) => void) => (v: T) => {
    apply(v);
    if (!changes.includes(label)) changes.push(label);
  };
  const date = (label: string, value: string | null, apply: (v: string | null) => void, hint?: string) => field({ label, type: 'date', value: value ?? '', hint, onInput: set(label, (v: string) => apply(v || null)) });

  const sellersHost = h('div', { class: 'stack-sm' });
  const drawSellers = () =>
    mount(
      sellersHost,
      c.sellers.map((s, i) =>
        h(
          'div',
          { class: 'form-grid', style: { alignItems: 'end' } },
          field({ label: t('Seller name'), value: s.name, onInput: set('sellers', (v: string) => (c.sellers[i].name = v)) }),
          field({ label: t('ID / company no.'), value: s.idNumber ?? '', onInput: set('sellers', (v: string) => (c.sellers[i].idNumber = v || null)) }),
          field({ label: t('Share'), value: s.share, onInput: set('sellers', (v: string) => (c.sellers[i].share = v)) }),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (c.sellers.splice(i, 1), changes.push('sellers'), drawSellers()) }, icon('trash', 16), t('Remove')),
        ),
      ),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (c.sellers.push({ name: '', idNumber: null, share: '1/1' }), drawSellers()) }, icon('plus', 16), t('Add seller')),
    );
  drawSellers();

  const paymentsHost = h('div', { class: 'stack-sm' });
  const drawPayments = () =>
    mount(
      paymentsHost,
      c.stagedPayments.map((p, i) =>
        h(
          'div',
          { class: 'form-grid', style: { alignItems: 'end' } },
          field({ label: t('Instalment'), value: p.label, onInput: set('payments', (v: string) => (c.stagedPayments[i].label = v)) }),
          field({ label: t('Due'), type: 'date', value: p.due ?? '', onInput: set('payments', (v: string) => (c.stagedPayments[i].due = v || null)) }),
          field({ label: t('Amount (€)'), type: 'number', value: p.amount ?? '', onInput: set('payments', (v: string) => (c.stagedPayments[i].amount = v ? Number(v) : null)) }),
          h('div', { class: 'row' }, toggle(t('Paid'), p.paid, set('payments', (v: boolean) => (c.stagedPayments[i].paid = v))), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (c.stagedPayments.splice(i, 1), changes.push('payments'), drawPayments()) }, icon('trash', 16))),
        ),
      ),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (c.stagedPayments.push({ id: randomId('p_'), label: t('Instalment {n}', { n: c.stagedPayments.length + 1 }), due: null, amount: null, paid: false }), drawPayments()) }, icon('plus', 16), t('Add staged payment')),
    );
  drawPayments();

  const encHost = h('div', { class: 'stack-sm' });
  const kinds: EncumbranceKind[] = ['mortgage', 'memo', 'prohibition', 'deposited_contract', 'lease', 'easement', 'other'];
  const drawEnc = () => {
    if (!cert) return mount(encHost, h('p', { class: 'muted' }, t('Read a search certificate first.')));
    mount(
      encHost,
      cert.encumbrances.length ? null : h('p', { class: 'muted' }, t('No entries were read. If the certificate lists any, add them here.')),
      cert.encumbrances.map((e, i) =>
        h(
          'div',
          { class: 'card', style: { padding: '12px', boxShadow: 'none' } },
          h(
            'div',
            { class: 'form-grid', style: { alignItems: 'end' } },
            field({ label: t('Kind'), value: e.kind, options: kinds.map((k) => [k, msg(`kind.${k}`, fl())]), onInput: set('encumbrances', (v: string) => (cert.encumbrances[i].kind = v as EncumbranceKind)) }),
            field({ label: t('In favour of'), value: e.holder, onInput: set('encumbrances', (v: string) => (cert.encumbrances[i].holder = v)) }),
            field({ label: t('Amount (€)'), type: 'number', value: e.amount ?? '', onInput: set('encumbrances', (v: string) => (cert.encumbrances[i].amount = v ? Number(v) : null)) }),
            field({ label: t('Registered on'), type: 'date', value: e.registeredOn ?? '', onInput: set('encumbrances', (v: string) => (cert.encumbrances[i].registeredOn = v || null)) }),
            field({ label: t('Status'), value: e.status, options: [['active', t('Active')], ['released', t('Released')], ['unknown', t('Unknown')]], onInput: set('encumbrances', (v: string) => (cert.encumbrances[i].status = v as 'active')) }),
          ),
          h('div', { class: 'row', style: { marginTop: '8px' } }, e.needsHuman ? badge(t('needs human reading'), 'amber') : null, e.source ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => viewSource(m, e.source!) }, icon('eye', 16), t('Source line')) : null, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (cert.encumbrances.splice(i, 1), changes.push('encumbrances'), drawEnc()) }, icon('trash', 16), t('Remove'))),
        ),
      ),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (cert.encumbrances.push({ id: randomId('e_'), kind: 'mortgage', holder: '', amount: null, registeredOn: null, reference: null, status: 'active' }), drawEnc()) }, icon('plus', 16), t('Add entry')),
    );
  };
  drawEnc();

  const save = async () => {
    if (!changes.length) return toast(t('No changes to save'), 'info');
    // Facts about the outside world are never silently overwritten: every edit is logged.
    await appendEvent(m, actor(), 'facts.edited', { fields: [...changes] });
    await saveMatter(m);
    toast(t('Saved — checks re-run'), 'ok');
    await redraw();
  };

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'callout' }, icon('info'), h('span', null, t('These are the facts the rules check. They were read from the documents — correct anything that is wrong. Every change is recorded in the audit trail and the checks re-run immediately.'))),
    card(
      t('Contract'),
      h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'form-grid' },
          date(t('Signed on'), c.signedOn, (v) => (c.signedOn = v), t('Starts the six-month deposit deadline')),
          date(t('Seller registered as owner on'), c.sellerRegisteredOn, (v) => (c.sellerRegisteredOn = v), t('Only if later than signing')),
          date(t('Deposited at District Lands Office on'), c.depositedOn, (v) => (c.depositedOn = v)),
          field({ label: t('Price (€)'), type: 'number', value: c.price ?? '', onInput: set('price', (v: string) => (c.price = v ? Number(v) : null)) }),
          field({ label: t('Contract payment account (IBAN)'), value: c.paymentAccount ?? '', onInput: set('paymentAccount', (v: string) => (c.paymentAccount = v || null)) }),
        ),
        h('h4', null, t('Sellers')),
        sellersHost,
        h('h4', null, t('Release of the mortgage')),
        toggle(t('Form A attached (signed by lender and seller)'), c.formA.present, set('formA', (v: boolean) => (c.formA.present = v))),
        h(
          'div',
          { class: 'form-grid' },
          field({ label: t('Form A lenders (comma-separated)'), value: c.formA.lenders.join(', '), onInput: set('formA', (v: string) => (c.formA.lenders = v.split(',').map((x) => x.trim()).filter(Boolean))) }),
          field({ label: t('Form A account (IBAN)'), value: c.formA.account ?? '', onInput: set('formA', (v: string) => (c.formA.account = v || null)) }),
          field({ label: t('Form A amount (€)'), type: 'number', value: c.formA.amount ?? '', onInput: set('formA', (v: string) => (c.formA.amount = v ? Number(v) : null)) }),
        ),
        toggle(t('Buyer is signing Form C (waives release protection)'), c.formC, set('formC', (v: boolean) => (c.formC = v))),
        h('h4', null, t('Staged payments')),
        paymentsHost,
      ),
      { icon: 'file' },
    ),
    card(
      cert ? t('Latest search certificate — {date}', { date: fmtDate(cert.issuedOn, locale()) }) : t('Search certificate'),
      cert
        ? h(
            'div',
            { class: 'stack' },
            h(
              'div',
              { class: 'form-grid' },
              field({ label: t('Certificate type'), value: cert.kind, options: [['with_encumbrances', t('With encumbrances and prohibitions')], ['simple', t('Simple')], ['unknown', t('Unknown')]], onInput: set('certificate', (v: string) => (cert.kind = v as Certificate['kind'])) }),
              date(t('Issued on'), cert.issuedOn, (v) => (cert.issuedOn = v)),
              field({ label: t('Separate title for the unit'), value: cert.separateTitle === null ? '' : String(cert.separateTitle), options: [['', t('Not confirmed')], ['true', t('Yes')], ['false', t('No — part of a larger plot')]], onInput: set('certificate', (v: string) => (cert.separateTitle = v === '' ? null : v === 'true')) }),
              field({ label: t('Handwritten regions'), type: 'number', value: cert.handwrittenRegions, onInput: set('certificate', (v: string) => (cert.handwrittenRegions = Number(v) || 0)) }),
            ),
            h(
              'div',
              { class: 'form-grid' },
              (['district', 'municipality', 'sheet', 'plan', 'parcel', 'registrationNo', 'titleNumber'] as const).map((k) => field({ label: t({ district: 'District', municipality: 'Municipality / community', sheet: 'Sheet', plan: 'Plan', parcel: 'Plot', registrationNo: 'Registration no.', titleNumber: 'Title no.' }[k]), value: cert.property[k] ?? '', onInput: set('property', (v: string) => (cert.property[k] = v || null)) })),
            ),
            h('h4', null, t('Registered owners')),
            h(
              'div',
              { class: 'stack-sm' },
              cert.owners.map((o, i) =>
                h(
                  'div',
                  { class: 'form-grid', style: { alignItems: 'end' } },
                  field({ label: t('Owner'), value: o.name, onInput: set('owners', (v: string) => (cert.owners[i].name = v)) }),
                  field({ label: t('ID'), value: o.idNumber ?? '', onInput: set('owners', (v: string) => (cert.owners[i].idNumber = v || null)) }),
                  field({ label: t('Share'), value: o.share, onInput: set('owners', (v: string) => (cert.owners[i].share = v)) }),
                ),
              ),
              h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (cert.owners.push({ name: '', idNumber: null, share: '1/1' }), changes.push('owners'), void redraw()) }, icon('plus', 16), t('Add owner')),
            ),
            h('h4', null, t('Encumbrances and prohibitions')),
            encHost,
            h('small', { class: 'muted' }, t('Read by: {r} · confidence {c}%', { r: cert.readBy.join(' + '), c: Math.round(cert.confidence * 100) }), cert.disagreements.length ? ` · ${t('readings disagree on')}: ${cert.disagreements.join(', ')}` : ''),
          )
        : h('p', { class: 'muted' }, t('No certificate read yet.')),
      { icon: 'shield' },
    ),
    h('div', { class: 'row', style: { position: 'sticky', bottom: '76px', zIndex: 5 } }, h('button', { class: 'btn btn-primary', onclick: save }, icon('check', 18), t('Save and re-run checks'))),
    card(t('Matter settings'), h('div', { class: 'stack-sm' }, toggle(t('Firm acts only for the buyer'), m.actsOnlyForBuyer === true, set('independence', (v: boolean) => (m.actsOnlyForBuyer = v ? true : null))), toggle(t('High-value matter (always human-reviewed)'), m.valueBand === 'high', set('valueBand', (v: boolean) => (m.valueBand = v ? 'high' : 'standard'))), field({ label: t('Buyer’s report language'), value: m.buyer.lang, options: BUYER_LANGS.map((l) => [l, LANG_NAMES[l]]), onInput: set('buyerLang', (v: string) => (m.buyer.lang = v as Lang)) }), h('div', { class: 'form-grid' }, field({ label: t('Buyer email'), value: m.buyer.email, onInput: set('buyer', (v: string) => (m.buyer.email = v)) }), field({ label: t('Buyer mobile'), value: m.buyer.phone, onInput: set('buyer', (v: string) => (m.buyer.phone = v)) })), toggle(t('Buyer opted in to WhatsApp status messages'), m.buyer.whatsappOptIn, set('buyer', (v: boolean) => (m.buyer.whatsappOptIn = v)))), { icon: 'gear' }),
  );
}

// ------------------------------------------------------------------ findings (lawyer review)

function findingCard(m: Matter, f: Finding, previewLang: Lang, redraw: () => Promise<void>): HTMLElement {
  const r = m.reviews[f.key];
  const decide = async (decision: Decision, note = '') => {
    m.reviews[f.key] = { decision, note, by: actor(), at: new Date().toISOString() };
    await appendEvent(m, actor(), 'finding.decided', { key: f.key, decision, note, ruleVersion: f.ruleVersion, severity: f.severity });
    if (m.status === 'extracted' && unreviewed(m).length === 0) m.status = 'reviewed';
    await saveMatter(m, false);
    await redraw();
  };
  const rule = RULEBOOK.find((x) => x.id === f.ruleId);
  return h(
    'article',
    { class: `finding ${f.severity} ${r ? `decided-${r.decision}` : ''}` },
    h('div', { class: 'bar' }),
    h(
      'div',
      { class: 'body' },
      h('div', { class: 'meta' }, badge(severityLabel(f.severity, fl()), severityTone(f.severity)), h('span', null, t(rule?.title ?? f.ruleId)), h('span', null, '·'), h('span', null, f.basis), f.needsLawyer ? badge(t('lawyer to confirm'), 'info') : null),
      h('div', { class: 'text', dir: RTL.includes(previewLang) ? 'rtl' : 'auto', lang: previewLang }, findingText(f, previewLang)),
      r?.decision === 'edited' ? h('div', { class: 'callout' }, icon('pen'), h('span', null, h('strong', null, t('Advocate’s wording: ')), r.note)) : null,
      f.sources.map((s) => h('div', { class: 'source', role: 'button', tabindex: 0, title: t('Open the source document at this line'), onclick: () => viewSource(m, s) }, `p.${s.page}${s.line ? ` l.${s.line}` : ''} · ${s.text}`)),
      f.severity === 'red' || f.severity === 'amber' || r
        ? h(
            'div',
            { class: 'decision' },
            r ? h('small', { class: 'muted' }, t('{d} by {by} {when}', { d: t(r.decision), by: r.by, when: relTime(Date.parse(r.at)) })) : null,
            h('button', { class: `btn btn-sm ${r?.decision === 'accepted' ? 'btn-primary' : ''}`, onclick: () => decide('accepted') }, icon('check', 16), t('Accept')),
            h(
              'button',
              {
                class: `btn btn-sm ${r?.decision === 'edited' ? 'btn-primary' : ''}`,
                onclick: () => {
                  const ta = h('textarea', { rows: 4 }, r?.note || findingText(f, fl())) as HTMLTextAreaElement;
                  const md = modal(t('Edit the wording'), h('div', { class: 'stack-sm' }, h('p', { class: 'muted' }, t('Your wording replaces the standard sentence in every language of the report, marked as the advocate’s note.')), ta), [h('button', { class: 'btn', onclick: () => md.close() }, t('Cancel')), h('button', { class: 'btn btn-primary', onclick: async () => (md.close(), await decide('edited', ta.value.trim())) }, t('Save'))]);
                },
              },
              icon('pen', 16),
              t('Edit'),
            ),
            h('button', { class: `btn btn-sm ${r?.decision === 'rejected' ? 'btn-danger' : ''}`, onclick: async () => { if (f.severity !== 'red' || (await confirmDialog(t('Reject a red finding?'), t('It will be left out of the report. The rejection is recorded in the audit trail.'), t('Reject'), true))) await decide('rejected'); } }, icon('x', 16), t('Reject')),
          )
        : null,
    ),
  );
}

function findings(m: Matter, redraw: () => Promise<void>): HTMLElement {
  if (!m.certificates.length) return empty('scale', t('No findings yet'), t('Upload and read a search certificate — the checks run automatically.'), h('a', { class: 'btn btn-primary', href: `#/matters/${m.id}?tab=documents` }, icon('upload', 18), t('Upload documents')));
  let previewLang: Lang = fl();
  let sev = 'all';
  const host = h('div', { class: 'stack-sm' });
  const draw = () => mount(host, m.findings.filter((f) => sev === 'all' || f.severity === sev || (sev === 'open' && (f.severity === 'red' || f.severity === 'amber') && !m.reviews[f.key])).map((f) => findingCard(m, f, previewLang, redraw)));
  draw();
  const c = tally(m.findings);
  const explainHost = h('div');
  const pending = unreviewed(m).length;
  return h(
    'div',
    { class: 'stack' },
    pending ? h('div', { class: 'callout warn' }, icon('alert'), h('span', null, t('{n} red/amber findings need your decision before the report can be issued.', { n: pending }))) : h('div', { class: 'callout ok' }, icon('check'), h('span', null, t('Every red and amber finding has a decision. You can issue the report.'))),
    h(
      'div',
      { class: 'row-between' },
      h(
        'div',
        { class: 'seg' },
        [
          ['all', `${t('All')} (${m.findings.length})`],
          ['open', `${t('To decide')} (${pending})`],
          ['red', `${t('Red')} (${c.red})`],
          ['amber', `${t('Amber')} (${c.amber})`],
          ['green', `${t('Green')} (${c.green})`],
          ['info', `${t('Info')} (${c.info})`],
        ].map(([k, l]) => h('button', { class: sev === k ? 'active' : '', onclick: (e: Event) => { sev = k; (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('button').forEach((b) => b.classList.remove('active')); (e.currentTarget as HTMLElement).classList.add('active'); draw(); } }, l)),
      ),
      h(
        'div',
        { class: 'row' },
        h('label', { class: 'muted' }, t('Preview in')),
        (() => {
          const sel = h('select', { style: { width: 'auto' } }, BUYER_LANGS.map((l) => h('option', { value: l, selected: l === previewLang }, LANG_NAMES[l]))) as HTMLSelectElement;
          sel.addEventListener('change', () => ((previewLang = sel.value as Lang), draw()));
          return sel;
        })(),
        aiAvailable()
          ? h(
              'button',
              {
                class: 'btn btn-sm',
                onclick: async () => {
                  mount(explainHost, spinner(t('Drafting a plain-language explanation…')));
                  try {
                    const text = await aiExplain(m.findings.filter((f) => m.reviews[f.key]?.decision !== 'rejected').map((f) => findingText(f, 'en')), m.buyer.lang);
                    mount(explainHost, card(t('Draft explanation for the buyer (AI — review before sending)'), h('div', { class: 'stack-sm' }, h('div', { dir: RTL.includes(m.buyer.lang) ? 'rtl' : 'auto', style: { whiteSpace: 'pre-wrap' } }, text), h('button', { class: 'btn btn-sm', onclick: () => copyText(text) }, icon('copy', 16), t('Copy'))), { icon: 'sparkle' }));
                    await appendEvent(m, actor(), 'ai.explained', { lang: m.buyer.lang });
                    await saveMatter(m, false);
                  } catch (e) {
                    mount(explainHost, h('div', { class: 'callout danger' }, icon('alert'), (e as Error).message));
                  }
                },
              },
              icon('sparkle', 16),
              t('AI explain'),
            )
          : null,
      ),
    ),
    explainHost,
    host,
    h('small', { class: 'muted' }, t('Rulebook {v} · law as at {d} · computed {when}', { v: m.ruleVersion, d: fmtDate(m.lawAsAt, locale()), when: m.findingsComputedAt ? relTime(Date.parse(m.findingsComputedAt)) : '—' })),
  );
}

// ------------------------------------------------------------------ report, signature, share

export function reportDoc(m: Matter, lang: Lang): HTMLElement {
  const r = buildReport(m, lang);
  const issued = m.report;
  const dir = RTL.includes(lang) ? 'rtl' : 'ltr';
  return h(
    'article',
    { class: 'report', dir, lang },
    h(
      'div',
      { class: 'r-head' },
      h('div', null, h('h1', null, ui('report', lang)), h('div', null, `${r.firm || '—'} · ${r.matterRef}`), h('div', { class: 'small' }, issued ? ui('issuedBy', lang, { name: issued.advocate, date: fmtDate(issued.issuedAt.slice(0, 10), locale()) }) : 'DRAFT — not issued')),
      h('div', { class: 'small', style: { textAlign: 'end' } }, LANG_NAMES[lang]),
    ),
    h('p', null, h('strong', null, `${ui('property', lang)}: `), r.property),
    r.owners.length ? h('p', null, h('strong', null, `${ui('owners', lang)}: `), r.owners.join(' · ')) : null,
    r.lines.map((l) => h('div', { class: 'r-line' }, h('div', { class: `sev ${l.severity}` }, severityLabel(l.severity, lang)), h('div', null, l.note ? h('div', null, l.note, h('div', { class: 'small' }, `— ${r.advocate}`)) : l.text, l.source ? h('div', { class: 'small', dir: 'auto' }, `${ui('original', lang)}: ${l.source}`) : null, h('div', { class: 'small' }, l.basis)))),
    r.deadlines.length ? [h('h3', { style: { marginTop: '16px' } }, ui('deadlines', lang)), h('ul', null, r.deadlines.map((d) => h('li', null, `${d.label}: ${fmtDate(d.due, locale())}${d.done ? ' ✓' : ''}`)))] : null,
    h('p', { class: 'small', style: { marginTop: '16px' } }, ui('aiNotice', lang)),
    lang !== 'el' ? h('p', { class: 'small' }, ui('translationNotice', lang)) : null,
    h('p', { class: 'small' }, `Rulebook ${r.ruleVersion} · law as at ${r.lawAsAt}`),
    issued ? h('p', { class: 'fp' }, `${ui('fingerprint', lang)}: ${issued.fingerprint}`) : null,
  );
}

async function report(m: Matter, redraw: () => Promise<void>): Promise<HTMLElement> {
  let lang: Lang = m.buyer.lang;
  const preview = h('div');
  const drawPreview = () => mount(preview, reportDoc(m, lang));
  drawPreview();
  const pending = unreviewed(m);
  const langs = reportLangs(m);

  const issueCard = card(
    m.report ? t('Issued') : t('Issue the report'),
    m.report
      ? h(
          'div',
          { class: 'stack-sm' },
          kv([
            [t('Issued'), `${fmtDate(m.report.issuedAt.slice(0, 10), locale())} · ${m.report.advocate}`],
            [t('Languages'), m.report.langs.map((l) => LANG_NAMES[l]).join(', ')],
            [t('Fingerprint'), h('code', null, m.report.fingerprint)],
            [t('Qualified signature'), m.report.signedEvidenceId ? badge(t('Signed PDF stored'), 'green') : badge(t('Not yet signed'), 'amber')],
          ]),
          (await sha256Hex(JSON.stringify(langs.map((l) => buildReport(m, l))))) !== m.report.fingerprint ? h('div', { class: 'callout warn' }, icon('alert'), t('Facts or decisions changed since issue. Re-issue to update the fingerprint.')) : null,
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { await issueReport(m, aiAvailable() || m.certificates.some((c) => c.readBy.includes('ai'))); toast(t('Report re-issued'), 'ok'); await redraw(); } }, icon('refresh', 16), t('Re-issue'))),
        )
      : h(
          'div',
          { class: 'stack-sm' },
          pending.length ? h('div', { class: 'callout warn' }, icon('alert'), t('{n} red/amber findings still need a decision.', { n: pending.length })) : null,
          !settings().advocateName ? h('div', { class: 'callout warn' }, icon('alert'), h('span', null, t('Set the issuing advocate’s name in '), h('a', { href: '#/settings' }, t('Settings')), '.')) : null,
          h('p', { class: 'muted' }, t('Issuing records the advocate’s name, the time, the rule version and a SHA-256 fingerprint of the report in all three languages. Nothing reaches the buyer without this approval.')),
          h(
            'button',
            {
              class: 'btn btn-primary',
              disabled: pending.length > 0 || !settings().advocateName,
              onclick: async () => {
                try {
                  await issueReport(m, aiAvailable() || m.certificates.some((c) => c.readBy.includes('ai')));
                  toast(t('Report issued'), 'ok');
                  await redraw();
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              },
            },
            icon('check', 18),
            t('Approve and issue'),
          ),
        ),
    { icon: 'scale' },
  );

  const signCard = card(
    t('Qualified e-signature (JCC)'),
    h(
      'div',
      { class: 'stack-sm' },
      h('ol', { class: 'install-steps' }, [t('Print the report to PDF (button below).'), t('Sign the PDF with your JCC qualified certificate in JCC Sign.'), t('Upload the signed PDF here — it is stored as evidence and fingerprinted.')].map((s) => h('li', null, h('span', null, s)))),
      h(
        'div',
        { class: 'row' },
        h('a', { class: 'btn', href: `#/matters/${m.id}/print?langs=${langs.join(',')}`, target: '_blank' }, icon('printer', 16), t('Print / save as PDF')),
        h(
          'button',
          {
            class: 'btn',
            disabled: !m.report,
            onclick: async () => {
              const { pickFiles } = await import('../core/ui');
              const [f] = await pickFiles('application/pdf', false);
              if (!f || !m.report) return;
              const ev = await addEvidence(m, f, 'signed_report', 'firm');
              m.report.signedEvidenceId = ev.id;
              await appendEvent(m, actor(), 'report.signed', { evidenceId: ev.id, sha256: ev.sha256 });
              await saveMatter(m, false);
              toast(t('Signed report stored'), 'ok');
              await redraw();
            },
          },
          icon('upload', 16),
          t('Upload signed PDF'),
        ),
      ),
    ),
    { icon: 'pen', help: t('JCC is the only qualified trust service provider on Cyprus’s trusted list. No public signing API was found, so signing happens in JCC Sign and the signed file is stored here.') },
  );

  const shareHost = h('div', { class: 'stack-sm' });
  const shareCard = card(
    t('Share with the buyer'),
    h(
      'div',
      { class: 'stack-sm' },
      h('p', { class: 'muted' }, t('Creates an encrypted link to the buyer portal. The report travels inside the link itself — no server stores it — and the buyer can save it on their phone and read it offline.')),
      (() => {
        const pin = h('input', { type: 'text', inputmode: 'numeric', placeholder: t('Optional PIN to send separately (recommended)'), maxlength: 12 }) as HTMLInputElement;
        const btn = h(
          'button',
          {
            class: 'btn btn-primary',
            disabled: !m.report,
            onclick: async () => {
              const { url, length } = await packLink(buildPack(m), pin.value.trim() || undefined);
              await appendEvent(m, actor(), 'buyer.shared', { pin: Boolean(pin.value.trim()), length });
              await saveMatter(m, false);
              const neutral = NEUTRAL[m.buyer.lang];
              mount(
                shareHost,
                h('div', { class: 'field' }, h('label', null, t('Buyer link')), h('textarea', { rows: 3, readonly: true, class: 'mono' }, url)),
                h(
                  'div',
                  { class: 'row' },
                  h('button', { class: 'btn btn-sm', onclick: () => copyText(url) }, icon('copy', 16), t('Copy link')),
                  h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, icon('eye', 16), t('Preview as buyer')),
                  m.buyer.phone ? h('a', { class: 'btn btn-sm', href: waLink(m.buyer.phone, `${neutral}\n${url}`), target: '_blank', rel: 'noopener' }, icon('message', 16), 'WhatsApp') : null,
                  m.buyer.email ? h('a', { class: 'btn btn-sm', href: mailLink(m.buyer.email, SUBJECT[m.buyer.lang], `${neutral}\n\n${url}`) }, icon('mail', 16), t('Email')) : null,
                  gatewayConfigured() && m.buyer.email && settings().emailViaGateway ? h('button', { class: 'btn btn-sm', onclick: async () => toast(t('Email {r}', { r: await notifyBuyer('email', m.buyer.email, m.buyer.lang, url) }), 'ok') }, icon('mail', 16), t('Send via gateway')) : null,
                  gatewayConfigured() && m.buyer.phone && m.buyer.whatsappOptIn && settings().whatsappEnabled ? h('button', { class: 'btn btn-sm', onclick: async () => toast(t('WhatsApp {r}', { r: await notifyBuyer('whatsapp', m.buyer.phone, m.buyer.lang) }), 'ok') }, icon('message', 16), t('WhatsApp template')) : null,
                  h('button', { class: 'btn btn-sm', onclick: () => downloadBlob(new Blob([url], { type: 'text/plain' }), `${m.matterRef}-buyer-link.txt`) }, icon('download', 16), t('Save link')),
                ),
                pin.value ? h('div', { class: 'callout warn' }, icon('key'), t('Send the PIN by a different channel (e.g. phone call or SMS).')) : null,
                h('small', { class: 'muted' }, t('Messages contain only a neutral status line and the link — legal content stays in the portal.')),
              );
            },
          },
          icon('share', 16),
          t('Create buyer link'),
        );
        return h('div', { class: 'row' }, h('div', { style: { flex: '1 1 220px' } }, pin), btn);
      })(),
      !m.report ? h('small', { class: 'muted' }, t('Issue the report first.')) : null,
      shareHost,
    ),
    { icon: 'share' },
  );

  const langSel = h('select', { style: { width: 'auto' }, 'aria-label': t('Preview language') }, BUYER_LANGS.map((l) => h('option', { value: l, selected: l === lang }, LANG_NAMES[l]))) as HTMLSelectElement;
  langSel.addEventListener('change', () => ((lang = langSel.value as Lang), drawPreview()));
  return h('div', { class: 'stack' }, h('div', { class: 'grid' }, issueCard, signCard, shareCard), card(t('Preview'), h('div', { class: 'stack' }, langSel, preview), { icon: 'eye' }));
}

export async function printView(ctx: RouteCtx): Promise<HTMLElement> {
  const m = await getMatter(ctx.params.id);
  if (!m) return h('p', null, t('Matter not found'));
  const langs = (ctx.query.get('langs')?.split(',').filter((l) => BUYER_LANGS.includes(l as Lang)) as Lang[]) ?? reportLangs(m);
  setTimeout(() => window.print(), 600);
  return h('div', { class: 'stack' }, h('div', { class: 'row no-print' }, h('h1', { class: 'sr-only' }, t('Print report')), h('button', { class: 'btn btn-primary', onclick: () => window.print() }, icon('printer', 18), t('Print / save as PDF')), h('a', { class: 'btn', href: `#/matters/${m.id}?tab=report` }, t('Back'))), langs.map((l) => reportDoc(m, l)));
}

// ------------------------------------------------------------------ deadlines

function icsFor(m: Matter): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Katharos//Title Desk//EN', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  for (const d of deadlinesOf(m)) {
    const day = d.due.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${m.id}-${d.kind}-${day}@katharos`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `SUMMARY:${m.matterRef}: ${d.label.replace(/[,;]/g, ' ')}`, 'BEGIN:VALARM', 'TRIGGER:-P2D', 'ACTION:DISPLAY', 'DESCRIPTION:Katharos deadline', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function deadlinesTab(m: Matter): HTMLElement {
  const list = deadlinesOf(m);
  const cert = latestCert(m);
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'callout' }, icon('calendar'), h('span', null, t('Working days are counted with Cyprus public holidays, including Orthodox Easter, computed on this device. Certificate window: 5 working days either side of signing. Deposit: 6 months from signing (or the seller’s registration, if later).'))),
    card(
      t('Deadlines for this matter'),
      list.length
        ? h('div', { class: 'list' }, list.map((d) => h('div', { class: 'list-item' }, dateChip(d.due), h('div', { class: 'grow' }, h('div', { class: 'title' }, d.label), h('small', { class: 'muted' }, d.done ? t('done') : dueText(d.due))), d.done ? badge(t('done'), 'green') : null)))
        : empty('calendar', t('No deadlines yet'), t('Add the signing date or a certificate to start the clocks.')),
      { icon: 'calendar', actions: list.length ? h('button', { class: 'btn btn-sm', onclick: () => downloadBlob(new Blob([icsFor(m)], { type: 'text/calendar' }), `${m.matterRef}.ics`) }, icon('download', 16), t('Add to calendar (.ics)')) : null },
    ),
    cert?.issuedOn && !m.contract.signedOn ? h('div', { class: 'callout warn' }, icon('clock'), t('This certificate is usable for a contract signed by {date}.', { date: fmtDate(addWorkingDays(cert.issuedOn, 5), locale()) })) : null,
  );
}

// ------------------------------------------------------------------ watch

function watch(m: Matter, go: (t: Tab) => void): HTMLElement {
  const certs = [...m.certificates].sort((a, b) => (a.issuedOn ?? a.addedAt).localeCompare(b.issuedOn ?? b.addedAt));
  const watchFindings = m.findings.filter((f) => f.ruleId === 'WATCH');
  const prev = previousCert(m);
  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'callout' }, icon('shield'), h('span', null, t('Anything registered after the certificate and before deposit ranks ahead of the buyer. Upload a fresh search before every staged payment and before deposit; Katharos compares it with the previous one and raises an alarm on any new entry.'))),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: () => go('documents') }, icon('upload', 18), t('Upload a fresh search'))),
    card(
      prev ? t('Comparison with the previous search') : t('Comparison'),
      watchFindings.length ? h('div', { class: 'stack-sm' }, watchFindings.map((f) => h('div', { class: `callout ${f.severity === 'red' ? 'danger' : f.severity === 'green' ? 'ok' : f.severity === 'amber' ? 'warn' : ''}` }, icon(f.severity === 'green' ? 'check' : 'alert'), findingText(f, fl())))) : h('p', { class: 'muted' }, t('A comparison appears once there are two certificates.')),
      { icon: 'refresh' },
    ),
    card(
      t('Certificate history'),
      certs.length
        ? h(
            'ol',
            { class: 'timeline' },
            certs.map((c, i) =>
              h(
                'li',
                { class: i === certs.length - 1 ? 'now' : 'done' },
                h('span', { class: 'node' }, String(i + 1)),
                h(
                  'div',
                  null,
                  h('strong', null, fmtDate(c.issuedOn, locale())),
                  ' ',
                  badge(`${c.encumbrances.filter((e) => e.status !== 'released').length} ${t('active entries')}`, 'neutral'),
                  ' ',
                  badge(`${Math.round(c.confidence * 100)}%`, c.confidence >= 0.9 ? 'green' : 'amber'),
                  h('div', null, h('small', { class: 'muted' }, c.encumbrances.map((e) => `${msg(`kind.${e.kind}`, fl())}: ${e.holder}`).join(' · ') || t('no entries'))),
                ),
              ),
            ),
          )
        : empty('shield', t('No certificates yet'), t('Upload the first search certificate.')),
      { icon: 'clock' },
    ),
  );
}

// ------------------------------------------------------------------ buyer questions + screening

function buyerTab(m: Matter, redraw: () => Promise<void>): HTMLElement {
  const qInput = h('textarea', { rows: 2, placeholder: t('Paste or type the buyer’s question') }) as HTMLTextAreaElement;
  const screenHost = h('div', { class: 'stack-sm' });
  const parties = [...new Set([...(latestCert(m)?.owners.map((o) => o.name) ?? []), ...m.contract.sellers.map((s) => s.name), m.buyer.name.replace(/\(sample\)/, '').trim()])].filter(Boolean);
  return h(
    'div',
    { class: 'stack' },
    card(
      t('Buyer’s questions'),
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'muted' }, t('Questions arrive by email or WhatsApp from the buyer portal. Record them here, answer them yourself — the AI may draft, only you send — and the answers travel in the next buyer link.')),
        h(
          'div',
          { class: 'row' },
          h('div', { style: { flex: '1 1 280px' } }, qInput),
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                if (!qInput.value.trim()) return;
                m.questions.push({ id: randomId('q_'), at: new Date().toISOString(), text: qInput.value.trim(), answer: null, answeredAt: null, draftedByAi: false });
                await appendEvent(m, actor(), 'question.recorded', {});
                await saveMatter(m, false);
                await redraw();
              },
            },
            icon('plus', 16),
            t('Add question'),
          ),
        ),
        m.questions.length
          ? m.questions.map((q) => {
              const ans = h('textarea', { rows: 3, placeholder: t('Your answer') }, q.answer ?? '') as HTMLTextAreaElement;
              return h(
                'div',
                { class: 'card', style: { padding: '12px', boxShadow: 'none' } },
                h('div', { class: 'stack-sm' }, h('strong', { dir: 'auto' }, q.text), h('small', { class: 'muted' }, relTime(Date.parse(q.at))), ans),
                h(
                  'div',
                  { class: 'row', style: { marginTop: '8px' } },
                  aiAvailable()
                    ? h(
                        'button',
                        {
                          class: 'btn btn-sm',
                          onclick: async (e: Event) => {
                            const b = e.currentTarget as HTMLButtonElement;
                            b.disabled = true;
                            try {
                              ans.value = await aiDraftAnswer(q.text, m.findings.filter((f) => m.reviews[f.key]?.decision !== 'rejected').map((f) => findingText(f, 'en')), m.buyer.lang);
                              q.draftedByAi = true;
                            } catch (err) {
                              toast((err as Error).message, 'error');
                            }
                            b.disabled = false;
                          },
                        },
                        icon('sparkle', 16),
                        t('AI draft'),
                      )
                    : null,
                  h(
                    'button',
                    {
                      class: 'btn btn-sm btn-primary',
                      onclick: async () => {
                        q.answer = ans.value.trim() || null;
                        q.answeredAt = q.answer ? new Date().toISOString() : null;
                        await appendEvent(m, actor(), 'question.answered', { id: q.id, aiDrafted: q.draftedByAi });
                        await saveMatter(m, false);
                        toast(t('Answer saved — it will be included in the next buyer link'), 'ok');
                      },
                    },
                    icon('check', 16),
                    t('Save answer'),
                  ),
                ),
              );
            })
          : h('p', { class: 'muted' }, t('No questions yet.')),
      ),
      { icon: 'message' },
    ),
    card(
      t('Party screening (sanctions & PEP)'),
      h(
        'div',
        { class: 'stack-sm' },
        h('p', { class: 'muted' }, t('Optional: screen owners, sellers and the buyer against international sanctions and politically-exposed-person lists. Results are leads for your compliance officer, not a decision.')),
        h(
          'div',
          { class: 'row' },
          parties.map((p) =>
            h(
              'button',
              {
                class: 'btn btn-sm',
                onclick: async () => {
                  mount(screenHost, spinner(t('Screening {name}…', { name: p })));
                  try {
                    const hits = await screenName(p);
                    await appendEvent(m, actor(), 'party.screened', { name: p, hits: hits.length, top: hits[0]?.score ?? 0 });
                    await saveMatter(m, false);
                    mount(screenHost, hits.length ? hits.slice(0, 5).map((x) => h('a', { class: 'list-item', href: x.url, target: '_blank', rel: 'noopener noreferrer' }, badge(`${Math.round(x.score * 100)}%`, x.score > 0.8 ? 'red' : 'amber'), h('div', { class: 'grow' }, h('div', { class: 'title' }, x.caption), h('small', { class: 'muted' }, [...x.topics, ...x.datasets.slice(0, 3)].join(' · '))))) : h('div', { class: 'callout ok' }, icon('check'), t('No matches for {name}.', { name: p })));
                  } catch (e) {
                    mount(screenHost, h('div', { class: 'callout warn' }, icon('alert'), (e as Error).message));
                  }
                },
              },
              icon('search', 16),
              p,
            ),
          ),
        ),
        screenHost,
      ),
      { icon: 'users' },
    ),
    card(t('Glossary sent with the report'), h('div', null, GLOSSARY.map((g) => h('div', { class: 'term' }, h('strong', null, g.tr[fl()] ?? g.tr.en), ' ', h('span', { class: 'el' }, g.el), h('div', { class: 'muted' }, g.def[fl()] ?? g.def.en)))), { icon: 'book' }),
  );
}

// ------------------------------------------------------------------ audit

async function audit(m: Matter): Promise<HTMLElement> {
  const chain = await verifyChain(m.events);
  const rows: Child = [...m.events].reverse().map((e) =>
    h('tr', null, h('td', null, h('small', null, `#${e.seq}`)), h('td', null, h('small', null, new Date(e.at).toLocaleString(locale()))), h('td', null, e.actor), h('td', null, h('code', null, e.kind)), h('td', { class: 'hide-mobile' }, h('small', { class: 'mono' }, JSON.stringify(e.detail).slice(0, 160)))),
  );
  return h(
    'div',
    { class: 'stack' },
    chain.ok ? h('div', { class: 'callout ok' }, icon('shield'), t('Audit chain intact: {n} events, each sealed with the hash of the one before.', { n: m.events.length })) : h('div', { class: 'callout danger' }, icon('alert'), t('Audit chain broken at event {n}. The record may have been altered.', { n: chain.brokenAt ?? '?' })),
    card(
      t('Audit trail'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, t('When')), h('th', null, t('Who')), h('th', null, t('What')), h('th', { class: 'hide-mobile' }, t('Detail')))), h('tbody', null, rows))),
      { icon: 'clock', actions: h('button', { class: 'btn btn-sm', onclick: () => downloadBlob(new Blob([JSON.stringify(m.events, null, 2)], { type: 'application/json' }), `${m.matterRef}-audit.json`) }, icon('download', 16), t('Export')) },
    ),
    h('small', { class: 'muted' }, t('Append-only: events are never edited or deleted. Today is {d}.', { d: fmtDate(todayISO(), locale()) })),
  );
}
