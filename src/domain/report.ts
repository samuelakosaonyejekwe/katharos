// The advocate's report: Greek, English and the buyer's language, issued in the
// advocate's name with an AI-assistance statement (EU AI Act Art. 50) and a tamper-evident fingerprint.
import { sha256Hex } from '../core/crypto';
import { settings } from '../core/settings';
import { UI, msg, ui } from '../i18n/messages';
import { appendEvent } from './audit';
import { actor, deadlinesOf, saveMatter } from './matters';
import { LAW_AS_AT, RULE_VERSION, latestCert } from './rules';
import { findingText } from './text';
import type { Finding, Lang, Matter, Severity } from './types';

export interface ReportLine {
  key: string;
  severity: Severity;
  text: string;
  note: string | null;
  basis: string;
  source: string | null;
}

export interface ReportContent {
  lang: Lang;
  matterRef: string;
  firm: string;
  advocate: string;
  property: string;
  owners: string[];
  certificateDate: string | null;
  lines: ReportLine[];
  deadlines: { label: string; due: string; done: boolean }[];
  ruleVersion: string;
  lawAsAt: string;
}

export function reportLangs(m: Matter): Lang[] {
  return [...new Set<Lang>(['el', 'en', m.buyer.lang])];
}

/** Findings that go into the report: everything not rejected by the advocate. */
export function approvedFindings(m: Matter): Finding[] {
  return m.findings.filter((f) => m.reviews[f.key]?.decision !== 'rejected');
}

/** Red and amber findings must each carry a decision before the report can be issued. */
export function unreviewed(m: Matter): Finding[] {
  return m.findings.filter((f) => (f.severity === 'red' || f.severity === 'amber') && !m.reviews[f.key]);
}

export function propertyLine(m: Matter): string {
  const p = latestCert(m)?.property ?? m.contract.property;
  const bits = [p.district, p.municipality, p.sheet && `${msg('field.sheet', 'en')} ${p.sheet}`, p.plan && `${msg('field.plan', 'en')} ${p.plan}`, p.parcel && `${msg('field.parcel', 'en')} ${p.parcel}`, p.registrationNo && `Reg. ${p.registrationNo}`, p.titleNumber && `Title ${p.titleNumber}`];
  return bits.filter(Boolean).join(' · ') || '—';
}

export function buildReport(m: Matter, lang: Lang): ReportContent {
  const cert = latestCert(m);
  const s = settings();
  return {
    lang,
    matterRef: m.matterRef,
    firm: s.firmName,
    advocate: m.report?.advocate ?? s.advocateName,
    property: propertyLine(m),
    owners: (cert?.owners ?? []).map((o) => `${o.name}${o.share ? ` (${o.share})` : ''}`),
    certificateDate: cert?.issuedOn ?? null,
    lines: approvedFindings(m).map((f) => {
      const r = m.reviews[f.key];
      return {
        key: f.key,
        severity: f.severity,
        text: findingText(f, lang),
        note: r?.decision === 'edited' ? r.note : null,
        basis: f.basis,
        source: f.sources[0]?.text ?? null,
      };
    }),
    deadlines: deadlinesOf(m)
      .filter((d) => d.kind === 'deposit' || d.kind === 'payment' || d.kind === 'certificate')
      .map((d) => ({ label: d.kind === 'deposit' ? ui('dl_deposit', lang) : d.kind === 'certificate' ? ui('dl_certificate', lang) : `${ui('dl_payment', lang)}: ${d.label.split(': ').slice(1).join(': ')}`, due: d.due, done: d.done })),
    ruleVersion: m.report?.ruleVersion ?? RULE_VERSION,
    lawAsAt: m.report?.lawAsAt ?? LAW_AS_AT,
  };
}

export async function fingerprint(m: Matter): Promise<string> {
  const content = reportLangs(m).map((l) => buildReport(m, l));
  return sha256Hex(JSON.stringify(content));
}

export async function issueReport(m: Matter, aiAssisted: boolean): Promise<void> {
  const pending = unreviewed(m);
  if (pending.length) throw new Error(`${pending.length} red/amber findings still need a decision`);
  const s = settings();
  if (!s.advocateName) throw new Error('Set the issuing advocate’s name in Settings first');
  m.report = {
    issuedAt: new Date().toISOString(),
    advocate: s.advocateName,
    langs: reportLangs(m),
    fingerprint: '',
    ruleVersion: RULE_VERSION,
    lawAsAt: LAW_AS_AT,
    signedEvidenceId: null,
    aiAssisted,
  };
  m.report.fingerprint = await fingerprint(m);
  if (['instructed', 'searching', 'extracted', 'reviewed'].includes(m.status)) m.status = 'reported';
  await appendEvent(m, actor(), 'report.issued', { fingerprint: m.report.fingerprint, langs: m.report.langs, ruleVersion: RULE_VERSION, lawAsAt: LAW_AS_AT });
  await saveMatter(m, false);
}

export function severityLabel(s: Severity, lang: Lang): string {
  return ui(`severity_${s}`, lang);
}

export { UI };
