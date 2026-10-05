// The rulebook. Rules decide; AI only explains.
// Every finding carries the rule version and the date of the law it applied, so a report
// can be reproduced years later.
import { addDays, addMonths, addWorkingDays, daysBetween, holidayOn, todayISO, workingDaysApart, type ISODate } from '../core/dates';
import type { Certificate, Encumbrance, Finding, Matter, Owner, PropertyId, Severity, SourceRef } from './types';

export const RULE_VERSION = '2026.10.1';
export const LAW_AS_AT = '2026-09-11';

export interface RuleInfo {
  id: string;
  title: string;
  catches: string;
  basis: string;
  owner: string; // the legal-panel advocate who owns the rule (set in Settings)
}

export const RULEBOOK: RuleInfo[] = [
  { id: 'CERT_TYPE', title: 'Certificate type', catches: 'A "simple" certificate that omits encumbrances and prohibitions', basis: 'Law 81(I)/2011 as amended; DLS guidance', owner: 'Legal panel' },
  { id: 'CERT_DATE', title: 'Certificate date', catches: 'A certificate dated more than five working days from signing, counted with Cyprus public holidays including Orthodox Easter', basis: 'Law 81(I)/2011 s.4(1A)', owner: 'Legal panel' },
  { id: 'OWNERS', title: 'Owners and shares', catches: 'A registered co-owner missing from the contract, shares that do not add up, name or ID mismatches', basis: 'Contract validity; lawyer rule', owner: 'Legal panel' },
  { id: 'PROPERTY', title: 'Property identity', catches: 'Sheet, plan, plot, registration number or title that differ between certificate and contract', basis: 'Lawyer rule', owner: 'Legal panel' },
  { id: 'MORTGAGE', title: 'Mortgages', catches: 'Any mortgage without a matching Form A signed by each lender', basis: 'Law 81(I)/2011 s.3A', owner: 'Legal panel' },
  { id: 'FORM_C', title: 'Form C', catches: 'A buyer about to waive the release protection', basis: 'Law 81(I)/2011 s.3A', owner: 'Legal panel' },
  { id: 'MEMO', title: 'Memos and prohibitions', catches: "Any creditor's memo or prohibition, and that it blocks Forms A and C", basis: 'DLS guidance', owner: 'Legal panel' },
  { id: 'DEPOSITED', title: 'Earlier deposited contracts', catches: "Another buyer's contract already deposited against the property", basis: 'Law 81(I)/2011', owner: 'Legal panel' },
  { id: 'SEPARATE_TITLE', title: 'Separate title', catches: "A unit that is only part of a larger plot, so the developer's mortgage cannot yet be released", basis: 'DLS guidance', owner: 'Legal panel' },
  { id: 'PAYMENT_ROUTE', title: 'Payment route', catches: 'Contract payment clauses that do not send the money to the account named in Form A', basis: 'Law 81(I)/2011 Form A', owner: 'Legal panel' },
  { id: 'DEPOSIT_DEADLINE', title: 'Deposit deadline', catches: "The six-month deadline from signing, or from the seller's registration as owner", basis: 'Law 81(I)/2011 s.3(1)', owner: 'Legal panel' },
  { id: 'WATCH', title: 'Changes since last search', catches: 'Any mortgage, memo, prohibition or contract registered since the previous certificate; a fresh search before each staged payment', basis: 'Katharos Watch', owner: 'Legal panel' },
  { id: 'ORIGIN', title: 'Document origin', catches: "A certificate supplied by the seller's side, or inconsistent with earlier copies", basis: 'Lawyer rule (fraud risk)', owner: 'Legal panel' },
  { id: 'OUTSIDE', title: 'Outside the certificate', catches: 'Planning approval, tax clearance, local-authority fees and tenants, which the certificate cannot show', basis: 'Marked "lawyer to confirm"', owner: 'Legal panel' },
  { id: 'HUMAN', title: 'Human-reading rule', catches: 'Handwriting, confidence below 0.90, missing title number, undated entries, high-value matters, disagreeing readings', basis: 'Confidence rule', owner: 'Legal panel' },
  { id: 'INDEPENDENCE', title: 'Lawyer independence', catches: 'A firm that also acts for the seller or developer', basis: 'Buyer protection', owner: 'Legal panel' },
];

const basisOf = (id: string) => RULEBOOK.find((r) => r.id === id)?.basis ?? '';

// ------------------------------------------------------------------ helpers

const GREEK_TO_LATIN: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

/** Normalises names for comparison across Greek and Latin scripts. */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[α-ως]/g, (c) => GREEK_TO_LATIN[c] ?? c)
    .replace(/(ltd|limited|llc|plc|λτδ|ltd\.|co\.)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(ou|oy)\b/g, 'u')
    .replace(/(th|ch|ph)/g, (m) => m[0])
    .replace(/y/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const ta = new Set(x.split(' ').filter((w) => w.length > 1));
  const tb = new Set(y.split(' ').filter((w) => w.length > 1));
  if (!ta.size || !tb.size) return false;
  let common = 0;
  ta.forEach((w) => {
    if ([...tb].some((v) => v === w || (w.length > 3 && v.length > 3 && (v.startsWith(w.slice(0, 4)) || w.startsWith(v.slice(0, 4)))))) common++;
  });
  return common / Math.min(ta.size, tb.size) >= 0.99 || common / Math.max(ta.size, tb.size) >= 0.6;
}

function sameOwner(a: Owner, b: Owner): boolean {
  if (a.idNumber && b.idNumber) return a.idNumber.replace(/\W/g, '').toUpperCase() === b.idNumber.replace(/\W/g, '').toUpperCase();
  return sameName(a.name, b.name);
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a);
}

/** Sums share strings such as "1/2", "1/4", "2/8" exactly; returns [numerator, denominator]. */
export function sumShares(shares: string[]): [number, number] | null {
  let n = 0;
  let d = 1;
  for (const s of shares) {
    const m = s.trim().match(/^(\d+)\s*\/\s*(\d+)$/) ?? (s.trim() === '' ? null : s.trim().match(/^(1)$/));
    if (!m) return null;
    const sn = Number(m[1]);
    const sd = m[2] ? Number(m[2]) : 1;
    if (!sd) return null;
    n = n * sd + sn * d;
    d = d * sd;
    const g = gcd(n, d) || 1;
    n /= g;
    d /= g;
  }
  return [n, d];
}

export function normIban(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

function normField(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s.]+/g, '')
    .replace(/^0+(?=\d)/, '');
}

export function latestCert(m: Matter): Certificate | undefined {
  return [...m.certificates].sort((a, b) => (a.issuedOn ?? a.addedAt).localeCompare(b.issuedOn ?? b.addedAt)).at(-1);
}

export function previousCert(m: Matter): Certificate | undefined {
  const sorted = [...m.certificates].sort((a, b) => (a.issuedOn ?? a.addedAt).localeCompare(b.issuedOn ?? b.addedAt));
  return sorted.length > 1 ? sorted.at(-2) : undefined;
}

export function encSignature(e: Encumbrance): string {
  return [e.kind, normName(e.holder), e.registeredOn ?? '', normField(e.reference)].join('|');
}

function src(...refs: (SourceRef | undefined)[]): SourceRef[] {
  return refs.filter((r): r is SourceRef => Boolean(r));
}

function fmtAmount(n: number | null): string {
  return n ? ` (€${n.toLocaleString('en-GB')})` : '';
}

function dateSuffix(d: string | null): string {
  return d ? `, ${d}` : '';
}

export function depositDeadline(m: Matter): ISODate | null {
  const c = m.contract;
  if (!c.signedOn) return null;
  const start = c.sellerRegisteredOn && c.sellerRegisteredOn > c.signedOn ? c.sellerRegisteredOn : c.signedOn;
  return addMonths(start, 6);
}

/** Latest date the contract can be signed so this certificate is still within five working days. */
export function certificateSignBy(cert: Certificate): ISODate | null {
  return cert.issuedOn ? addWorkingDays(cert.issuedOn, 5, true) : null;
}

// ------------------------------------------------------------------ the engine

type Emit = (ruleId: string, subject: string, severity: Severity, msg: string, params?: Finding['params'], sources?: SourceRef[], needsLawyer?: boolean) => void;

export function runRules(m: Matter, today: ISODate = todayISO()): Finding[] {
  const out: Finding[] = [];
  const emit: Emit = (ruleId, subject, severity, msg, params = {}, sources = [], needsLawyer = false) =>
    out.push({ key: `${ruleId}:${subject}`, ruleId, ruleVersion: RULE_VERSION, severity, msg, params, basis: basisOf(ruleId), sources, needsLawyer });

  // Independence
  if (m.actsOnlyForBuyer === null) emit('INDEPENDENCE', 'confirm', 'amber', 'indep.notConfirmed');
  else if (m.actsOnlyForBuyer === false) emit('INDEPENDENCE', 'conflict', 'red', 'indep.conflict');

  const cert = latestCert(m);
  const prev = previousCert(m);
  const c = m.contract;

  if (!cert) {
    emit('CERT_TYPE', 'missing', 'red', 'cert.missing');
  } else {
    // Certificate type
    if (cert.kind === 'simple') emit('CERT_TYPE', cert.id, 'red', 'cert.simple');
    else if (cert.kind === 'unknown') emit('CERT_TYPE', cert.id, 'amber', 'cert.kindUnknown');
    else emit('CERT_TYPE', cert.id, 'green', 'cert.ok');

    // Five working days, either side of signing. Counted strictly (all public-service holidays off)
    // and leniently (statutory only); if the two disagree, a lawyer decides. The certificate judged is
    // the one closest to signing — later fresh searches (Watch) do not replace it.
    const signing = c.signedOn;
    const atSigning = signing
      ? [...m.certificates].filter((x) => x.issuedOn).sort((a, b) => workingDaysApart(a.issuedOn!, signing) - workingDaysApart(b.issuedOn!, signing))[0] ?? cert
      : cert;
    const issuedAtSigning = atSigning.issuedOn;
    if (issuedAtSigning && signing) {
      const id = atSigning.id;
      const strict = workingDaysApart(issuedAtSigning, signing, true);
      const lenient = workingDaysApart(issuedAtSigning, signing, false);
      if (strict <= 5 && lenient <= 5) emit('CERT_DATE', id, 'green', 'date.ok', { days: lenient });
      else if (strict <= 5 && lenient > 5) {
        const [from, to] = issuedAtSigning < signing ? [issuedAtSigning, signing] : [signing, issuedAtSigning];
        let name = '';
        for (let d = addDays(from, 1); d <= to && !name; d = addDays(d, 1)) {
          const h = holidayOn(d, true);
          if (h && !holidayOn(d, false)) name = `${h.name} (${d})`;
        }
        emit('CERT_DATE', id, 'amber', 'date.boundary', { holiday: name || 'a public-service holiday' }, [], true);
      } else emit('CERT_DATE', id, 'red', 'date.late', { days: lenient });
    } else if (cert.issuedOn && !signing) {
      const by = certificateSignBy(cert)!;
      emit('CERT_DATE', cert.id, by < today ? 'red' : 'info', 'date.pending', { date: by });
    } else {
      emit('CERT_DATE', cert.id, 'amber', 'date.missing');
    }

    // Owners and shares
    if (!cert.owners.length) emit('OWNERS', 'none', 'amber', 'owners.none', {}, [], true);
    else {
      let problems = 0;
      for (const o of cert.owners) {
        if (c.sellers.length && !c.sellers.some((s) => sameOwner(o, s))) {
          emit('OWNERS', `missing:${normName(o.name)}`, 'red', 'owners.missing', { name: o.name }, src(o.source));
          problems++;
        }
      }
      for (const s of c.sellers) {
        if (!cert.owners.some((o) => sameOwner(o, s))) {
          emit('OWNERS', `extra:${normName(s.name)}`, 'red', 'owners.extraSeller', { name: s.name });
          problems++;
        }
      }
      const total = sumShares(cert.owners.map((o) => o.share || '1/1'));
      if (!total || total[0] !== total[1]) {
        emit('OWNERS', 'shares', 'red', 'owners.shares', { total: total ? `${total[0]}/${total[1]}` : '?' }, src(...cert.owners.map((o) => o.source)));
        problems++;
      }
      if (!problems && c.sellers.length) emit('OWNERS', 'ok', 'green', 'owners.ok');
    }

    // Property identity
    const fields: (keyof PropertyId)[] = ['district', 'sheet', 'plan', 'parcel', 'registrationNo', 'titleNumber'];
    let mismatches = 0;
    for (const f of fields) {
      const a = cert.property[f];
      const b = c.property[f];
      if (a && b && normField(a) !== normField(b)) {
        emit('PROPERTY', f, 'red', 'property.mismatch', { field: `field.${f}`, cert: a, contract: b });
        mismatches++;
      }
    }
    if (!mismatches && fields.some((f) => cert.property[f] && c.property[f])) emit('PROPERTY', 'ok', 'green', 'property.ok');

    // Mortgages and Form A
    const active = cert.encumbrances.filter((e) => e.status !== 'released');
    const mortgages = active.filter((e) => e.kind === 'mortgage');
    if (!mortgages.length) emit('MORTGAGE', 'none', 'green', 'mortgage.none');
    for (const mg of mortgages) {
      const covered = c.formA.present && c.formA.lenders.some((l) => sameName(l, mg.holder));
      if (covered) emit('MORTGAGE', mg.id, 'green', 'mortgage.formA', { holder: mg.holder }, src(mg.source));
      else emit('MORTGAGE', mg.id, 'red', 'mortgage.noFormA', { holder: mg.holder, amount: fmtAmount(mg.amount) }, src(mg.source));
    }

    // Form C
    if (c.formC) emit('FORM_C', 'signed', mortgages.length ? 'red' : 'amber', 'formc.signed', {}, [], true);

    // Memos and prohibitions
    const blocking = active.filter((e) => e.kind === 'memo' || e.kind === 'prohibition');
    if (!blocking.length) emit('MEMO', 'none', 'green', 'memo.none');
    for (const b of blocking) emit('MEMO', b.id, 'red', 'memo.found', { kind: `kind.${b.kind}`, holder: b.holder, date: dateSuffix(b.registeredOn) }, src(b.source));

    // Earlier deposited contracts
    const deposited = active.filter((e) => e.kind === 'deposited_contract');
    if (!deposited.length) emit('DEPOSITED', 'none', 'green', 'deposited.none');
    for (const d of deposited) emit('DEPOSITED', d.id, 'red', 'deposited.found', { holder: d.holder, date: dateSuffix(d.registeredOn) }, src(d.source));

    // Separate title
    if (cert.separateTitle === false) emit('SEPARATE_TITLE', cert.id, 'amber', 'title.noSeparate', {}, [], true);
    else if (cert.separateTitle === null) emit('SEPARATE_TITLE', cert.id, 'amber', 'title.unknown', {}, [], true);

    // Payment route
    if (mortgages.length || c.formA.present) {
      const ca = normIban(c.paymentAccount);
      const fa = normIban(c.formA.account);
      if (!ca || !fa) emit('PAYMENT_ROUTE', 'missing', 'amber', 'payment.missing');
      else if (ca !== fa) emit('PAYMENT_ROUTE', 'mismatch', 'red', 'payment.mismatch', { contract: c.paymentAccount ?? '', formA: c.formA.account ?? '' });
      else emit('PAYMENT_ROUTE', 'ok', 'green', 'payment.ok');
    }

    // Watch: compare with the previous certificate
    if (prev) {
      const before = new Set(prev.encumbrances.filter((e) => e.status !== 'released').map(encSignature));
      const now = new Set(active.map(encSignature));
      const added = active.filter((e) => !before.has(encSignature(e)));
      const removed = prev.encumbrances.filter((e) => e.status !== 'released' && !now.has(encSignature(e)));
      for (const e of added) emit('WATCH', `new:${e.id}`, 'red', 'watch.new', { prev: prev.issuedOn ?? '?', kind: `kind.${e.kind}`, holder: e.holder, date: dateSuffix(e.registeredOn) }, src(e.source));
      if (added.some((e) => e.kind === 'memo' || e.kind === 'prohibition')) emit('WATCH', 'memoBlocks', 'red', 'watch.newMemo');
      for (const e of removed) emit('WATCH', `gone:${encSignature(e)}`, 'info', 'watch.removed', { kind: `kind.${e.kind}`, holder: e.holder });
      if (!added.length && !removed.length) emit('WATCH', 'clean', 'green', 'watch.clean', { prev: prev.issuedOn ?? '?' });

      // Origin consistency: same issue date, different register
      if (prev.issuedOn && prev.issuedOn === cert.issuedOn && (added.length || removed.length)) emit('ORIGIN', `inconsistent:${cert.id}`, 'red', 'origin.inconsistent');
    }

    // Fresh search before a staged payment
    const next = c.stagedPayments.filter((p) => !p.paid && p.due && p.due >= today).sort((a, b) => a.due!.localeCompare(b.due!))[0];
    if (next?.due && daysBetween(today, next.due) <= 14 && cert.issuedOn && workingDaysApart(cert.issuedOn, next.due) > 5) {
      emit('WATCH', `fresh:${next.id}`, 'amber', 'watch.fresh', { date: next.due });
    }

    // Origin
    if (cert.origin === 'supplied_by_seller') emit('ORIGIN', `seller:${cert.id}`, 'amber', 'origin.seller', {}, [], true);

    // Human-reading rule — absolute for handwriting.
    const reasons: string[] = [];
    if (cert.handwrittenRegions > 0) reasons.push('reason.handwriting');
    if (cert.confidence < 0.9) reasons.push('reason.confidence');
    if (!cert.property.titleNumber && !cert.property.registrationNo) reasons.push('reason.title');
    if (cert.encumbrances.some((e) => !e.registeredOn)) reasons.push('reason.undated');
    if (m.valueBand === 'high') reasons.push('reason.highValue');
    if (cert.disagreements.length) reasons.push(`reason.disagree|${cert.disagreements.join(', ')}`);
    if (reasons.length) emit('HUMAN', cert.id, 'amber', 'human.review', { reasons: reasons.join(';') }, [], true);
  }

  // Deposit deadline
  const deadline = depositDeadline(m);
  if (c.depositedOn) emit('DEPOSIT_DEADLINE', 'done', deadline && c.depositedOn > deadline ? 'amber' : 'green', 'deposit.done', { date: c.depositedOn });
  else if (!deadline) emit('DEPOSIT_DEADLINE', 'unsigned', 'info', 'deposit.unsigned');
  else {
    const left = daysBetween(today, deadline);
    if (left < 0) emit('DEPOSIT_DEADLINE', 'overdue', 'red', 'deposit.overdue', { date: deadline });
    else if (left <= 30) emit('DEPOSIT_DEADLINE', 'soon', 'amber', 'deposit.soon', { date: deadline, days: left });
    else emit('DEPOSIT_DEADLINE', 'due', 'info', 'deposit.due', { date: deadline });
  }

  // Outside the certificate — always listed, always for the lawyer to confirm.
  for (const k of ['planning', 'tax', 'fees', 'tenants']) emit('OUTSIDE', k, 'info', `outside.${k}`, {}, [], true);

  const order: Record<Severity, number> = { red: 0, amber: 1, info: 2, green: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function tally(findings: Finding[]): Record<Severity, number> {
  const t: Record<Severity, number> = { red: 0, amber: 0, green: 0, info: 0 };
  for (const f of findings) t[f.severity]++;
  return t;
}
