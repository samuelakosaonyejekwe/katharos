// Matter service: the only code that writes matter records. Store-and-hash first, extract second
//, so evidence exists even if every later step fails.
import { randomId, sha256Hex } from '../core/crypto';
import { addWorkingDays, todayISO } from '../core/dates';
import { delFile, putFile, replaceReminders, sealed, type Reminder } from '../core/db';
import { settings } from '../core/settings';
import { t } from '../core/i18n';
import { appendEvent } from './audit';
import { LAW_AS_AT, RULE_VERSION, depositDeadline, latestCert, runRules } from './rules';
import { emptyContract, type Evidence, type EvidenceKind, type Lang, type Matter } from './types';

let cache: Map<string, Matter> | null = null;
const listeners = new Set<() => void>();

export function onMatters(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  listeners.forEach((f) => f());
  try {
    channel?.postMessage({ type: 'matters-changed' });
  } catch {
    /* channel closed */
  }
}

// Keeps several open tabs/windows of the app in step.
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('katharos') : null;
channel?.addEventListener('message', (e) => {
  if (e.data?.type === 'matters-changed') {
    cache = null;
    listeners.forEach((f) => f());
  }
});

export function actor(): string {
  return settings().advocateName || 'Firm user';
}

export async function listMatters(): Promise<Matter[]> {
  if (!cache) {
    const all = await sealed.all<Matter>('matters');
    cache = new Map(all.map((m) => [m.id, m]));
  }
  return [...cache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMatter(id: string): Promise<Matter | undefined> {
  if (cache?.has(id)) return cache.get(id);
  return sealed.get<Matter>('matters', id);
}

export function forgetMatters(): void {
  cache = null;
}

async function nextRef(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = settings().matterPrefix ? `${settings().matterPrefix}-` : '';
  const nums = (await listMatters())
    .map((m) => m.matterRef.match(new RegExp(`${year}-(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  return `${prefix}${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
}

export async function createMatter(input: { firmRef: string; buyerName: string; buyerEmail: string; buyerPhone: string; buyerLang: Lang; actsOnlyForBuyer: boolean | null; valueBand: 'standard' | 'high' }): Promise<Matter> {
  const now = new Date().toISOString();
  const m: Matter = {
    id: randomId('m_'),
    matterRef: await nextRef(),
    firmRef: input.firmRef,
    instructedAt: now,
    status: 'instructed',
    actsOnlyForBuyer: input.actsOnlyForBuyer,
    valueBand: input.valueBand,
    buyer: { name: input.buyerName, email: input.buyerEmail, phone: input.buyerPhone, lang: input.buyerLang, whatsappOptIn: false },
    certRequestedAt: null,
    certificates: [],
    contract: emptyContract(),
    releaseRoute: 'unknown',
    depositStatus: 'unknown',
    findings: [],
    findingsComputedAt: null,
    reviews: {},
    report: null,
    evidence: [],
    events: [],
    questions: [],
    checklist: {},
    ruleVersion: RULE_VERSION,
    lawAsAt: LAW_AS_AT,
    notes: '',
    updatedAt: now,
  };
  await appendEvent(m, actor(), 'matter.opened', { matterRef: m.matterRef, buyerLang: input.buyerLang, actsOnlyForBuyer: input.actsOnlyForBuyer });
  await saveMatter(m, false);
  return m;
}

/** Saves a matter, recomputing findings (with the rule version and law date that produced them). */
export async function saveMatter(m: Matter, recompute = true): Promise<Matter> {
  if (recompute) {
    m.findings = runRules(m);
    m.findingsComputedAt = new Date().toISOString();
    m.ruleVersion = RULE_VERSION;
    m.lawAsAt = LAW_AS_AT;
  }
  m.releaseRoute = m.contract.formC ? 'C' : m.contract.formA.present ? 'A' : latestCert(m)?.encumbrances.some((e) => e.kind === 'mortgage' && e.status !== 'released') ? 'unknown' : 'none';
  m.depositStatus = m.contract.depositedOn ? 'deposited' : m.contract.signedOn ? 'not_deposited' : 'unknown';
  m.updatedAt = new Date().toISOString();
  await sealed.put('matters', m.id, m);
  if (cache) cache.set(m.id, m);
  await syncReminders();
  emit();
  return m;
}

export async function deleteMatter(id: string): Promise<void> {
  const m = await getMatter(id);
  if (m) for (const e of m.evidence) await delFile(e.id);
  await sealed.del('matters', id);
  cache?.delete(id);
  await syncReminders();
  emit();
}

/** Stores the original encrypted and hashed before anything reads it. */
export async function addEvidence(m: Matter, file: File, kind: EvidenceKind, source: Evidence['source']): Promise<Evidence> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const dup = m.evidence.find((e) => e.sha256 === sha256);
  if (dup) return dup;
  const ev: Evidence = {
    id: randomId('f_'),
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    sha256,
    source,
    kind,
    receivedAt: new Date().toISOString(),
  };
  await putFile(ev.id, file, file.name);
  m.evidence.push(ev);
  await appendEvent(m, actor(), 'evidence.received', { evidenceId: ev.id, filename: ev.filename, sha256, kind, source });
  await saveMatter(m, false);
  return ev;
}

export interface Deadline {
  matterId: string;
  matterRef: string;
  label: string;
  kind: 'certificate' | 'deposit' | 'payment' | 'fresh-search';
  due: string;
  done: boolean;
}

/** Every dated obligation across matters. */
export function deadlinesOf(m: Matter): Deadline[] {
  const out: Deadline[] = [];
  const base = { matterId: m.id, matterRef: m.matterRef };
  const cert = latestCert(m);
  if (cert?.issuedOn && !m.contract.signedOn) out.push({ ...base, kind: 'certificate', label: t('Sign before certificate expires (5 working days)'), due: addWorkingDays(cert.issuedOn, 5), done: false });
  const dd = depositDeadline(m);
  if (dd) out.push({ ...base, kind: 'deposit', label: t('Deposit contract at District Lands Office (6 months)'), due: dd, done: Boolean(m.contract.depositedOn) });
  for (const p of m.contract.stagedPayments) {
    if (!p.due) continue;
    out.push({ ...base, kind: 'payment', label: t('Staged payment: {label}', { label: `${p.label}${p.amount ? ` (€${p.amount.toLocaleString('en-GB')})` : ''}` }), due: p.due, done: p.paid });
    if (!p.paid) out.push({ ...base, kind: 'fresh-search', label: t('Fresh search before payment "{label}"', { label: p.label }), due: addWorkingDays(p.due, -1), done: Boolean(cert?.issuedOn && cert.issuedOn >= addWorkingDays(p.due, -5)) });
  }
  if (dd && !m.contract.depositedOn) out.push({ ...base, kind: 'fresh-search', label: t('Fresh search immediately before deposit'), due: addWorkingDays(dd, -3), done: false });
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

export async function allDeadlines(): Promise<Deadline[]> {
  return (await listMatters())
    .filter((m) => m.status !== 'closed')
    .flatMap(deadlinesOf)
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** Mirrors open deadlines into the reminder store the service worker can read (no names, no documents). */
export async function syncReminders(): Promise<void> {
  try {
    const today = todayISO();
    const list: Reminder[] = (await allDeadlines())
      .filter((d) => !d.done && d.due >= today)
      .map((d) => ({ id: `${d.matterId}:${d.kind}:${d.due}`, matterId: d.matterId, label: `${d.matterRef}: ${d.label}`, due: d.due }));
    await replaceReminders(list);
  } catch {
    /* reminders are best-effort */
  }
}
