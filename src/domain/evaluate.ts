// Accuracy evaluation: run the certificate reader over labelled cases and measure what matters most —
// missed encumbrances (target: zero), plus owner and field accuracy. Runs entirely on this device.
// Organisations add their own annotated, anonymised certificates as a JSON test set.
import { addDays } from '../core/dates';
import { parseCertificate } from './extract';
import { normName } from './rules';
import { sampleCertificateText } from './samples';
import type { EncumbranceKind } from './types';

export interface EvalCase {
  name: string;
  text: string;
  expected: {
    kind?: 'with_encumbrances' | 'simple';
    issuedOn?: string;
    owners?: string[];
    encumbrances: { kind: EncumbranceKind; holder: string }[];
  };
}

export interface EvalResult {
  name: string;
  missed: string[];
  extra: string[];
  ownersOk: boolean;
  kindOk: boolean;
  dateOk: boolean;
}

export interface EvalSummary {
  cases: number;
  expectedEntries: number;
  missed: number;
  extra: number;
  recall: number;
  ownerAccuracy: number;
  fieldAccuracy: number;
  results: EvalResult[];
  passed: boolean;
}

const sig = (kind: string, holder: string) => `${kind}|${normName(holder)}`;

export function builtInCases(): EvalCase[] {
  const d = '2026-09-01';
  const base = sampleCertificateText(d, false);
  const withMemo = sampleCertificateText(d, true);
  const english = [
    'REPUBLIC OF CYPRUS — DEPARTMENT OF LANDS AND SURVEYS',
    'SEARCH CERTIFICATE WITH ENCUMBRANCES AND PROHIBITIONS (SAMPLE)',
    'Date of issue: 02/09/2026',
    'District: Limassol   Municipality: Germasogeia',
    'Sheet/Plan: 55/12   Plot: 401',
    'Registration No: 0/2291   Title No: 77812',
    'REGISTERED OWNERS',
    'Helen Clarke   Passport 552013377   Share 1/1',
    'ENCUMBRANCES AND PROHIBITIONS',
    'Mortgage No. M88/2021 in favour of Island Savings Bank Ltd   €95,000   date 11/05/2021',
    'Prohibition No. P12/2026 in favour of District Court of Limassol   date 20/08/2026',
    'Deposited sale contract No. 4410/2025 in favour of Mark Evans   date 03/03/2025',
  ].join('\n');
  const released = base.replace('Υποθήκη αρ. Υ1234/2019 υπέρ Τράπεζα Αιγαίου Λτδ   €180.000   ημερομηνία 14/03/2019', 'Υποθήκη αρ. Υ1234/2019 υπέρ Τράπεζα Αιγαίου Λτδ   €180.000   ημερομηνία 14/03/2019   ΕΞΑΛΕΙΦΘΗΚΕ');
  const owners = ['Ανδρέας Παπαδόπουλος', 'Μαρία Παπαδοπούλου'];
  const mortgage = { kind: 'mortgage' as const, holder: 'Τράπεζα Αιγαίου Λτδ' };
  return [
    { name: 'Greek · one mortgage', text: base, expected: { kind: 'with_encumbrances', issuedOn: d, owners, encumbrances: [mortgage] } },
    { name: 'Greek · mortgage + memo', text: withMemo, expected: { kind: 'with_encumbrances', issuedOn: d, owners, encumbrances: [mortgage, { kind: 'memo', holder: 'Ιωάννης Γεωργίου' }] } },
    { name: 'Greek · released mortgage still listed', text: released, expected: { kind: 'with_encumbrances', issuedOn: d, owners, encumbrances: [mortgage] } },
    { name: 'Greek · later issue date', text: sampleCertificateText(addDays(d, 30), true), expected: { kind: 'with_encumbrances', issuedOn: addDays(d, 30), owners, encumbrances: [mortgage, { kind: 'memo', holder: 'Ιωάννης Γεωργίου' }] } },
    {
      name: 'English · mortgage, prohibition, deposited contract',
      text: english,
      expected: {
        kind: 'with_encumbrances',
        issuedOn: '2026-09-02',
        owners: ['Helen Clarke'],
        encumbrances: [
          { kind: 'mortgage', holder: 'Island Savings Bank Ltd' },
          { kind: 'prohibition', holder: 'District Court of Limassol' },
          { kind: 'deposited_contract', holder: 'Mark Evans' },
        ],
      },
    },
  ];
}

export function evaluate(cases: EvalCase[]): EvalSummary {
  const results: EvalResult[] = [];
  let expectedEntries = 0;
  let missed = 0;
  let extra = 0;
  let ownersOk = 0;
  let fieldsOk = 0;
  for (const c of cases) {
    const got = parseCertificate([{ page: 1, lines: c.text.split(/\r?\n/) }], 'eval');
    const want = new Set(c.expected.encumbrances.map((e) => sig(e.kind, e.holder)));
    const have = new Set(got.encumbrances.map((e) => sig(e.kind, e.holder)));
    const m = [...want].filter((x) => !have.has(x));
    const x = [...have].filter((y) => !want.has(y));
    const oOk = !c.expected.owners || (c.expected.owners.length === got.owners.length && c.expected.owners.every((o) => got.owners.some((g) => normName(g.name) === normName(o))));
    const kOk = !c.expected.kind || c.expected.kind === got.kind;
    const dOk = !c.expected.issuedOn || c.expected.issuedOn === got.issuedOn;
    expectedEntries += want.size;
    missed += m.length;
    extra += x.length;
    if (oOk) ownersOk++;
    if (kOk && dOk) fieldsOk++;
    results.push({ name: c.name, missed: m.map((s) => s.replace('|', ': ')), extra: x.map((s) => s.replace('|', ': ')), ownersOk: oOk, kindOk: kOk, dateOk: dOk });
  }
  return {
    cases: cases.length,
    expectedEntries,
    missed,
    extra,
    recall: expectedEntries ? (expectedEntries - missed) / expectedEntries : 1,
    ownerAccuracy: cases.length ? ownersOk / cases.length : 1,
    fieldAccuracy: cases.length ? fieldsOk / cases.length : 1,
    results,
    passed: missed === 0,
  };
}

/** Validates an imported test set file. */
export function parseTestSet(json: unknown): EvalCase[] {
  const cases = (json as { cases?: unknown })?.cases;
  if (!Array.isArray(cases) || !cases.length) throw new Error('The test set must be a JSON object with a non-empty "cases" array.');
  return cases.map((c, i) => {
    const x = c as EvalCase;
    if (typeof x.text !== 'string' || !x.expected || !Array.isArray(x.expected.encumbrances)) throw new Error(`Case ${i + 1} needs "text" and "expected.encumbrances".`);
    return { name: x.name || `Case ${i + 1}`, text: x.text, expected: x.expected };
  });
}
